// P8c-1 bilgisayar kaydı — gerçek MySQL + dinleyen sunucu. AC-181 (WS verme), 182 (kayıtla talep), 184 (kayıt yetkisi
// sınırlı, anahtar log/audit'te yok), 185 (geçersizleşme, tek tip yanıt), 186 (unut), 187 (tek kayıt / müşteri bağı),
// mimari-e10 §15.1 (bayat kaynak), K20 hız kovaları, §10 metrikler.
import { BINDING_INVALID_MESSAGE } from "@remote/contracts/api/bindings";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expireIdleBindings } from "../../src/bindings/service.ts";
import { Prisma } from "../../src/generated/prisma/client.ts";
import { sha256Hex } from "../../src/lib/ids.ts";
import { RequestService } from "../../src/requests/service.ts";
import { createTenant, createUser, loginAs, ORIGIN, testDb, type Session } from "../helpers/app.ts";
import { createCustomerRow, createRequestSettings, requestClient, waitMsg } from "../helpers/requests.ts";
import { admitted, joinGuest, startLive, TECH_PERMS, techSession, type Live } from "../helpers/signal-flow.ts";
import { FAKE_METRICS_TOKEN, FAKE_TURN_SECRET } from "../helpers/secrets.ts";
import { connect, techHeaders, type WsClient } from "../helpers/ws.ts";
import { seedTenantConsent } from "../../prisma/seed-consent.ts";

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const REQ_PERMS = { ...TECH_PERMS, "support_requests.view": true, "support_requests.accept": true, "customers.view": true, "customers.edit": true };
const asText = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? String(x) : x));
const errOf = (r: { json: <T>() => T }) => r.json<{ error: { code: string; message: string } }>().error;
let ipSeq = 0;
const nextIp = () => `198.51.130.${(++ipSeq % 250) + 1}`;

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});

interface Ctx {
  l: Live;
  rc: ReturnType<typeof requestClient>;
  tenantId: string;
  genRef: string;
  tech: Session;
  logs: string[];
}
const TURN_ENV = { TURN_URLS: "stun:turn.test:3478,turn:turn.test:3478?transport=udp", TURN_SECRET: FAKE_TURN_SECRET };
async function boot(extraEnv: Record<string, string> = {}): Promise<Ctx> {
  const logs: string[] = [];
  const { default: pino } = await import("pino");
  const logger = pino({ level: "info" }, { write: (s: string) => void logs.push(s) });
  live = await startLive({ env: { ...PROXY, METRICS_TOKEN: FAKE_METRICS_TOKEN, ...extraEnv }, logger });
  const rc = requestClient(live.app, live.base);
  const t = await createTenant();
  const genRef = await createRequestSettings(t.id);
  const u = await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS });
  return { l: live, rc, tenantId: t.id, genRef, tech: await loginAs(live.app, u), logs };
}

/** ref veya kayıtla talep → kabul → misafir WS hello. */
async function acceptedGuest(x: Ctx, src: { ref?: string; bindingKey?: string; version?: string }) {
  const ip = nextIp();
  const consentTextId = (await testDb().consentText.findFirstOrThrow({ where: { tenantId: x.tenantId, isCurrent: true } })).id;
  const extra: Record<string, unknown> = src.bindingKey ? { ref: undefined, bindingKey: src.bindingKey } : {};
  const c = await x.rc.createReq(src.ref ?? x.genRef, ip, { version: src.version ?? "0.10.0", consentTextId, extra });
  expect(c.statusCode, c.body).toBe(201);
  const { requestId, requestSecret } = c.json<{ requestId: string; requestSecret: string }>();
  const reqWs = await x.rc.reqWs(requestSecret);
  await waitMsg(reqWs, "request.state");
  const acc = await x.rc.accept(x.tech.headers, requestId);
  expect(acc.statusCode, acc.body).toBe(200);
  const { wsTicket } = await waitMsg<{ wsTicket: string }>(reqWs, "request.accepted");
  const guest = await x.rc.guestWs(wsTicket);
  await guest.waitFor("hello");
  return { requestId, sessionId: acc.json<{ sessionId: string }>().sessionId, guest };
}

async function issue(guest: WsClient, previousKey?: string) {
  await guest.waitFor("binding.offer");
  guest.send({ t: "binding.request", ...(previousKey ? { previousKey } : {}) });
  return guest.waitFor("binding.issued");
}

const status = (x: Ctx, bindingKey: string, ip = nextIp()) =>
  x.l.app.inject({ method: "POST", url: "/api/v1/public/bindings/status", headers: { "x-forwarded-for": ip }, payload: { bindingKey, clientVersion: "0.10.0" } });
const FAKE_KEY = `rsb_${"A".repeat(43)}`;

describe("AC-181 kayıt verme (WS)", () => {
  it("AC-181: ≥0.10.0 AGENT misafire teklif; binding.issued yalnız isteyene; DB'de yalnız SHA-256; müşteri oturumdan; audit + metrik", async () => {
    const x = await boot();
    const c = await createCustomerRow(x.tenantId, { name: "Kayıt Firması" });
    const g = await acceptedGuest(x, { ref: c.requestRef });
    const msg = await issue(g.guest);
    expect(msg).toMatchObject({ t: "binding.issued", customerFirmName: "Kayıt Firması", renewed: false });
    expect(msg.bindingKey).toMatch(/^rsb_[A-Za-z0-9_-]{43}$/);
    const row = await testDb().deviceBinding.findFirstOrThrow({ where: { tenantId: x.tenantId } });
    expect(row).toMatchObject({ keyHash: sha256Hex(msg.bindingKey), customerId: c.id, revokedAt: null, clientVersion: "0.10.0" });
    expect(asText(row)).not.toContain(msg.bindingKey);
    const a = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: x.tenantId, action: "binding.issued" } });
    expect(a.newValue).toMatchObject({ customerId: c.id, renewed: false });
    // aynı oturumda ikinci istek: teklif bağlantıya işlendi → aynı satır yenilenir (tek etkin kayıt)
    g.guest.send({ t: "binding.request" });
    const again = await g.guest.waitFor("binding.issued");
    expect(again.renewed).toBe(true);
    expect(await testDb().deviceBinding.count({ where: { tenantId: x.tenantId, revokedAt: null } })).toBe(1);
    g.guest.send({ t: "binding.request" });
    await g.guest.waitFor("binding.issued");
    g.guest.send({ t: "binding.request" });
    expect(await g.guest.waitFor("error")).toMatchObject({ code: "RATE_LIMITED" });
    const metrics = (await x.l.app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${FAKE_METRICS_TOKEN}` } })).body;
    expect(metrics).toMatch(/rs_bindings_issued_total\{renewed="false"\} [1-9]/);
    expect(metrics).toMatch(/rs_bindings_issued_total\{renewed="true"\} [1-9]/);
    expect(metrics).toMatch(/rs_requests_created_total\{via="ref"\} [1-9]/);
    expect(metrics).toMatch(/rs_customers_active /);
    expect(x.logs.join("\n")).not.toContain(msg.bindingKey);
  });

  it("AC-181 / AC-191: 0.9.x istemci teklif almaz; binding.request → CONFLICT, kayıt yazılmaz", async () => {
    const x = await boot();
    const g = await acceptedGuest(x, { version: "0.9.1" });
    await new Promise((r) => setTimeout(r, 200));
    expect(g.guest.msgs.some((m) => m.t === "binding.offer")).toBe(false);
    g.guest.send({ t: "binding.request" });
    expect(await g.guest.waitFor("error")).toMatchObject({ code: "CONFLICT" });
    expect(await testDb().deviceBinding.count({ where: { tenantId: x.tenantId } })).toBe(0);
  });

  it("§15.1: kaynak ref yenilendikten sonra kabul edilen talepte kayıt verilmez (binding.denied audit)", async () => {
    const x = await boot();
    const c = await createCustomerRow(x.tenantId);
    const ip = nextIp();
    const consentTextId = (await testDb().consentText.findFirstOrThrow({ where: { tenantId: x.tenantId, isCurrent: true } })).id;
    const cr = (await x.rc.createReq(c.requestRef, ip, { version: "0.10.0", consentTextId })).json<{ requestId: string; requestSecret: string }>();
    const reqWs = await x.rc.reqWs(cr.requestSecret);
    await waitMsg(reqWs, "request.state");
    await testDb().customer.update({ where: { id: c.id }, data: { refRotatedAt: new Date(Date.now() + 1000) } });
    const acc = await x.rc.accept(x.tech.headers, cr.requestId);
    expect(acc.statusCode).toBe(200);
    const { wsTicket } = await waitMsg<{ wsTicket: string }>(reqWs, "request.accepted");
    const guest = await x.rc.guestWs(wsTicket);
    await guest.waitFor("binding.offer");
    guest.send({ t: "binding.request" });
    expect(await guest.waitFor("error")).toMatchObject({ code: "CONFLICT", message: "Kayıt verilemedi" });
    expect(await testDb().deviceBinding.count({ where: { tenantId: x.tenantId } })).toBe(0);
    expect(await testDb().auditLog.findFirstOrThrow({ where: { tenantId: x.tenantId, action: "binding.denied" } })).toMatchObject({ result: "fail" });
  });
});

describe("AC-182 / AC-184 / AC-185 / AC-186 / AC-187 kayıtla talep ve geçersizleşme", () => {
  it("AC-182/184: kayıtla talep kaydın müşterisine düşer (viaBinding); status firma+müşteri adı; 1 bekleyen sınırı; anahtar audit/log'da yok", async () => {
    const x = await boot();
    const c = await createCustomerRow(x.tenantId, { name: "Kayıtlı Firma" });
    const g = await acceptedGuest(x, { ref: c.requestRef });
    const { bindingKey } = await issue(g.guest);
    const st = await status(x, bindingKey);
    expect(st.statusCode, st.body).toBe(200);
    expect(st.json()).toMatchObject({ customer: { name: "Kayıtlı Firma" }, consentText: { id: expect.any(String) } });
    const consentTextId = st.json<{ consentText: { id: string } }>().consentText.id;
    const body = (ip: string) => x.rc.createReq("unused", ip, { consentTextId, extra: { ref: undefined, bindingKey }, version: "0.10.0" });
    const r1 = await body(nextIp());
    expect(r1.statusCode, r1.body).toBe(201);
    const id1 = r1.json<{ requestId: string }>().requestId;
    expect(await testDb().supportRequest.findUniqueOrThrow({ where: { id: id1 } })).toMatchObject({ customerId: c.id, bindingId: expect.any(String) });
    const item = (await x.l.app.inject({ method: "GET", url: `/api/v1/support-requests/${id1}`, headers: x.tech.headers })).json();
    expect(item).toMatchObject({ customerFirm: { id: c.id }, viaBinding: true, bindingRevoked: false });
    const r2 = await body(nextIp());
    expect(r2.statusCode).toBe(409); // kayıt başına 1 bekleyen
    const audits = asText(await testDb().auditLog.findMany({ where: { tenantId: x.tenantId } }));
    expect(audits).not.toContain(bindingKey);
    expect(audits).not.toContain(bindingKey.slice(4, 20));
    expect(x.logs.join("\n")).not.toContain(bindingKey);
    const created = await testDb().auditLog.findFirstOrThrow({ where: { entityId: id1, action: "request.created" } });
    expect(created.newValue).toMatchObject({ via: "binding", customerId: c.id });
  });

  it("AC-184: kayıt anahtarı oturum çözümleme/katılma uçlarında işe yaramaz (400/404)", async () => {
    const x = await boot();
    const g = await acceptedGuest(x, {});
    const { bindingKey } = await issue(g.guest);
    const resolve = await x.l.app.inject({ method: "POST", url: "/api/v1/public/sessions/resolve", headers: { "x-forwarded-for": nextIp() }, payload: { code: bindingKey } });
    expect([400, 401, 404]).toContain(resolve.statusCode);
    const resolve2 = await x.l.app.inject({ method: "POST", url: "/api/v1/public/sessions/resolve", headers: { "x-forwarded-for": nextIp() }, payload: { bindingKey } });
    expect([400, 401, 404]).toContain(resolve2.statusCode);
    const join = await x.l.app.inject({ method: "POST", url: "/api/v1/public/sessions/join", headers: { "x-forwarded-for": nextIp() }, payload: { bindingKey, name: "X" } });
    expect([400, 401, 404]).toContain(join.statusCode);
    await expect(x.rc.guestWs(bindingKey)).rejects.toThrow();
  });

  it("AC-185/170: müşteri ref yenilemesi kaydı geçersizler (key_hash NULL); geçersiz ve hiç olmayan anahtar aynı BINDING_INVALID", async () => {
    const x = await boot();
    const c = await createCustomerRow(x.tenantId);
    const g = await acceptedGuest(x, { ref: c.requestRef });
    const { bindingKey } = await issue(g.guest);
    const admin = await createUser({ tenantId: x.tenantId, role: "ADMIN" });
    const as = await loginAs(x.l.app, admin);
    expect((await x.l.app.inject({ method: "POST", url: `/api/v1/customers/${c.id}/rotate-ref`, headers: as.headers, payload: {} })).statusCode).toBe(200);
    const row = await testDb().deviceBinding.findFirstOrThrow({ where: { tenantId: x.tenantId } });
    expect(row).toMatchObject({ keyHash: null, revokeReason: "CUSTOMER_ROTATED" });
    const s1 = await status(x, bindingKey);
    const s2 = await status(x, FAKE_KEY);
    expect(s1.statusCode).toBe(404);
    expect(errOf(s1)).toMatchObject({ code: "BINDING_INVALID", message: BINDING_INVALID_MESSAGE });
    const strip = (b: string) => b.replace(/"requestId":"[^"]*"/, "");
    expect(strip(s1.body)).toBe(strip(s2.body));
    const consentTextId = (await testDb().consentText.findFirstOrThrow({ where: { tenantId: x.tenantId, isCurrent: true } })).id;
    const cr = await x.rc.createReq("unused", nextIp(), { consentTextId, extra: { ref: undefined, bindingKey }, version: "0.10.0" });
    expect(cr.statusCode).toBe(404);
    expect(errOf(cr).code).toBe("BINDING_INVALID");
  });

  it("AC-185: panelden tek kayıt iptali (revoke-binding) 204 → bekleyen talep BINDING_REVOKED; ikinci kez 409; kayıtsız talep 404; Genel ref yenilemesi Genel kayıtları düşürür", async () => {
    const x = await boot();
    const g = await acceptedGuest(x, {});
    const { bindingKey } = await issue(g.guest);
    const consentTextId = (await testDb().consentText.findFirstOrThrow({ where: { tenantId: x.tenantId, isCurrent: true } })).id;
    const r = (await x.rc.createReq("unused", nextIp(), { consentTextId, extra: { ref: undefined, bindingKey }, version: "0.10.0" })).json<{ requestId: string }>();
    const rv = (id: string) => x.l.app.inject({ method: "POST", url: `/api/v1/support-requests/${id}/revoke-binding`, headers: x.tech.headers, payload: {} });
    expect((await rv(r.requestId)).statusCode).toBe(204);
    expect(await testDb().supportRequest.findUniqueOrThrow({ where: { id: r.requestId } })).toMatchObject({ status: "CANCELLED", cancelReason: "BINDING_REVOKED" });
    expect((await rv(r.requestId)).statusCode).toBe(409);
    expect((await rv(g.requestId)).statusCode).toBe(404); // ref'ten açılmış, kaydı yok
    expect((await testDb().deviceBinding.findFirstOrThrow({ where: { tenantId: x.tenantId } })).revokeReason).toBe("ADMIN_REVOKED");

    const g2 = await acceptedGuest(x, {});
    await issue(g2.guest);
    const admin = await loginAs(x.l.app, await createUser({ tenantId: x.tenantId, role: "ADMIN" }));
    expect((await x.l.app.inject({ method: "POST", url: "/api/v1/settings/support-requests/rotate-ref", headers: admin.headers, payload: {} })).statusCode).toBe(200);
    expect(await testDb().deviceBinding.count({ where: { tenantId: x.tenantId, revokedAt: null } })).toBe(0);
    expect(await testDb().deviceBinding.count({ where: { tenantId: x.tenantId, revokeReason: "GENERAL_ROTATED" } })).toBe(1);
  });

  it("AC-185/171: müşteri pasife alınınca kayıtları düşer; saklama süresi kadar kullanılmayan kayıt EXPIRED", async () => {
    const x = await boot();
    const c = await createCustomerRow(x.tenantId);
    const g = await acceptedGuest(x, { ref: c.requestRef });
    await issue(g.guest);
    const admin = await loginAs(x.l.app, await createUser({ tenantId: x.tenantId, role: "ADMIN" }));
    await x.l.app.inject({ method: "POST", url: `/api/v1/customers/${c.id}/deactivate`, headers: admin.headers, payload: {} });
    expect((await testDb().deviceBinding.findFirstOrThrow({ where: { tenantId: x.tenantId } })).revokeReason).toBe("CUSTOMER_PASSIVE");

    const g2 = await acceptedGuest(x, {});
    await issue(g2.guest);
    expect(await expireIdleBindings(x.l.app.requests, new Date(Date.now() + 10 * 86_400_000))).toBe(0);
    expect(await expireIdleBindings(x.l.app.requests, new Date(Date.now() + 731 * 86_400_000))).toBeGreaterThanOrEqual(1);
    expect(await testDb().deviceBinding.count({ where: { tenantId: x.tenantId, revokeReason: "EXPIRED", keyHash: null } })).toBe(1);
  });

  it("AC-186: public revoke her durumda 204; etkin kayıt FORGOTTEN + key_hash NULL", async () => {
    const x = await boot();
    const g = await acceptedGuest(x, {});
    const { bindingKey } = await issue(g.guest);
    const rv = (payload: unknown) => x.l.app.inject({ method: "POST", url: "/api/v1/public/bindings/revoke", headers: { "x-forwarded-for": nextIp() }, payload: payload as Record<string, unknown> });
    expect((await rv({ bindingKey: FAKE_KEY })).statusCode).toBe(204);
    expect((await rv({ foo: 1 })).statusCode).toBe(204);
    expect((await rv({ bindingKey })).statusCode).toBe(204);
    expect(await testDb().deviceBinding.findFirstOrThrow({ where: { tenantId: x.tenantId } })).toMatchObject({ revokeReason: "FORGOTTEN", keyHash: null });
    expect((await rv({ bindingKey })).statusCode).toBe(204);
    expect(await testDb().auditLog.count({ where: { tenantId: x.tenantId, action: "binding.revoked" } })).toBe(1);
  });

  it("AC-187: müşterisiz oturum aynı tenant kaydının müşteri bağını korur (renewed); başka tenant'ta previousKey → eski kayıt REPLACED", async () => {
    const x = await boot();
    const c = await createCustomerRow(x.tenantId, { name: "Korunan Firma" });
    const g1 = await acceptedGuest(x, { ref: c.requestRef });
    const k1 = (await issue(g1.guest)).bindingKey;
    const g2 = await acceptedGuest(x, {}); // Genel ref'ten, müşterisiz oturum
    const m2 = await issue(g2.guest, k1);
    expect(m2).toMatchObject({ renewed: true, customerFirmName: "Korunan Firma" });
    expect(await testDb().deviceBinding.count({ where: { tenantId: x.tenantId } })).toBe(1);
    expect((await status(x, k1)).statusCode).toBe(404); // eski anahtar artık geçersiz (yeni anahtar verildi)
    expect((await status(x, m2.bindingKey)).statusCode).toBe(200);

    // başka tenant
    const t2 = await createTenant();
    const gen2 = await createRequestSettings(t2.id);
    const tech2 = await loginAs(x.l.app, await createUser({ tenantId: t2.id, role: "USER", perms: REQ_PERMS }));
    const y: Ctx = { ...x, tenantId: t2.id, genRef: gen2, tech: tech2 };
    const g3 = await acceptedGuest(y, {});
    const m3 = await issue(g3.guest, m2.bindingKey);
    expect(m3).toMatchObject({ renewed: false, customerFirmName: null });
    expect(await testDb().deviceBinding.findFirstOrThrow({ where: { tenantId: x.tenantId } })).toMatchObject({ revokeReason: "REPLACED", keyHash: null });
    const replaced = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: x.tenantId, action: "binding.revoked" } });
    expect(asText(replaced)).not.toContain(t2.id); // karşı tenant kimliği yazılmaz
  });
});

describe("K20 hız kovaları", () => {
  it("K20: binding.status IP başına 60/dk → 61. 429", async () => {
    const x = await boot();
    const g = await acceptedGuest(x, {});
    const { bindingKey } = await issue(g.guest);
    const ip = "198.51.140.9";
    for (let i = 0; i < 60; i++) expect((await status(x, bindingKey, ip)).statusCode, String(i)).toBe(200);
    expect((await status(x, bindingKey, ip)).statusCode).toBe(429);
    expect((await status(x, bindingKey, "198.51.140.10")).statusCode).toBe(200);
  });
});

// ------------------------------------------------------------------ P8c-1 düzeltme turu 1 (QA 1–7, güvenlik B-P8c-1..6)

const consentOf = async (tenantId: string) => (await testDb().consentText.findFirstOrThrow({ where: { tenantId, isCurrent: true } })).id;
const viaKey = async (x: Ctx, bindingKey: string, ip = nextIp()) => x.rc.createReq("unused", ip, { consentTextId: await consentOf(x.tenantId), extra: { ref: undefined, bindingKey }, version: "0.10.0" });
const metricsOf = async (x: Ctx) => (await x.l.app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${FAKE_METRICS_TOKEN}` } })).body;

describe("AC-181 negatif yollar (kayıt yazılmaz)", () => {
  it("AC-181: lobideki (admit öncesi) misafirin binding.request'i 1008 ile kapanır; BROWSER misafir teklif almaz ve FORBIDDEN; teklifsiz AGENT CONFLICT — hiçbirinde kayıt yok", async () => {
    const x = await boot();
    const t = await techSession(x.l, x.tenantId);
    // admit öncesi (lobi): ADMITTED değil → 1008, teklif yok
    const lobby = await joinGuest(x.l, t);
    lobby.ws.send({ t: "binding.request" });
    expect((await lobby.ws.closed).code).toBe(1008);
    expect(lobby.ws.msgs.some((m) => m.t === "binding.offer")).toBe(false);
    // admit edilmiş BROWSER misafir: teklif yok, istek FORBIDDEN
    const t2 = await techSession(x.l, x.tenantId);
    const b = await admitted(x.l, t2);
    await new Promise((r) => setTimeout(r, 200));
    expect(b.guest.msgs.some((m) => m.t === "binding.offer")).toBe(false);
    b.guest.send({ t: "binding.request" });
    expect(await b.guest.waitFor("error")).toMatchObject({ code: "FORBIDDEN" });
    expect(await testDb().deviceBinding.count({ where: { tenantId: x.tenantId } })).toBe(0);
    expect(await metricsOf(x)).toMatch(/rs_binding_denied_total\{reason="browser"\} [1-9]/);
  });

  it("AC-181 / B-P8c-1: müşteri pasife alındıktan sonra oturumda kayıt verilmez (inactive) — binding.denied audit + metrik", async () => {
    const x = await boot();
    const c = await createCustomerRow(x.tenantId);
    const g = await acceptedGuest(x, { ref: c.requestRef });
    await g.guest.waitFor("binding.offer");
    await testDb().customer.update({ where: { id: c.id }, data: { status: "PASSIVE", passiveAt: new Date() } });
    g.guest.send({ t: "binding.request" });
    expect(await g.guest.waitFor("error")).toMatchObject({ code: "CONFLICT" });
    expect(await testDb().deviceBinding.count({ where: { tenantId: x.tenantId } })).toBe(0);
    expect((await testDb().auditLog.findFirstOrThrow({ where: { tenantId: x.tenantId, action: "binding.denied" } })).newValue).toMatchObject({ reason: "inactive" });
    expect(await metricsOf(x)).toMatch(/rs_binding_denied_total\{reason="inactive"\} [1-9]/);
  });
});

describe("§15.1 (2)(3) iptal edilmiş kayıttan açılan talep", () => {
  it("§15.1 (2)(3) / AC-185: kayıt iptal edildikten sonra bekleyen talep viaBinding=false, bindingRevoked=true; kabulde kayıt verilmez (CONFLICT, binding.denied stale_source)", async () => {
    const x = await boot();
    const c = await createCustomerRow(x.tenantId);
    const g = await acceptedGuest(x, { ref: c.requestRef });
    const { bindingKey } = await issue(g.guest);
    const cr = await viaKey(x, bindingKey);
    expect(cr.statusCode, cr.body).toBe(201);
    const { requestId, requestSecret } = cr.json<{ requestId: string; requestSecret: string }>();
    // iptal (bekleyen kalsın diye doğrudan DB; panel ucu bekleyeni de kapatır)
    await testDb().deviceBinding.updateMany({ where: { tenantId: x.tenantId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "ADMIN_REVOKED", keyHash: null } });
    const item = (await x.l.app.inject({ method: "GET", url: `/api/v1/support-requests/${requestId}`, headers: x.tech.headers })).json();
    expect(item).toMatchObject({ viaBinding: false, bindingRevoked: true, staleSource: true, customerFirm: { id: c.id } });
    const reqWs = await x.rc.reqWs(requestSecret);
    await waitMsg(reqWs, "request.state");
    const acc = await x.rc.accept(x.tech.headers, requestId);
    expect(acc.statusCode, acc.body).toBe(200);
    const { wsTicket } = await waitMsg<{ wsTicket: string }>(reqWs, "request.accepted");
    const guest = await x.rc.guestWs(wsTicket);
    await guest.waitFor("binding.offer");
    guest.send({ t: "binding.request" });
    expect(await guest.waitFor("error")).toMatchObject({ code: "CONFLICT", message: "Kayıt verilemedi" });
    expect(await testDb().deviceBinding.count({ where: { tenantId: x.tenantId, revokedAt: null } })).toBe(0);
    const denied = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: x.tenantId, action: "binding.denied" } });
    expect(denied).toMatchObject({ result: "fail", newValue: { reason: "stale_source", requestId } });
  });
});

describe("§15.3 oturum başına tek etkin kayıt (servis)", () => {
  it("§15.3 / AC-181: aynı oturumda iki farklı previousKey + anahtarsız istek → tek etkin satır; previousKey cur varken yok sayılır", async () => {
    const x = await boot();
    const ka = (await issue((await acceptedGuest(x, {})).guest)).bindingKey;
    const kb = (await issue((await acceptedGuest(x, {})).guest)).bindingKey;
    const g = await acceptedGuest(x, {});
    const m1 = await issue(g.guest, ka); // prev aynı tenant → A satırı yerinde, bu oturuma geçer
    expect(m1.renewed).toBe(true);
    g.guest.send({ t: "binding.request", previousKey: kb }); // cur var → kb yok sayılır
    expect((await g.guest.waitFor("binding.issued")).renewed).toBe(true);
    g.guest.send({ t: "binding.request" });
    const m3 = await g.guest.waitFor("binding.issued");
    expect(await testDb().deviceBinding.count({ where: { lastSessionId: g.sessionId, revokedAt: null } })).toBe(1);
    expect(await testDb().deviceBinding.count({ where: { tenantId: x.tenantId, revokedAt: null } })).toBe(2); // A (bu oturumda) + B (dokunulmadı)
    expect((await status(x, kb)).statusCode).toBe(200);
    expect((await status(x, m3.bindingKey)).statusCode).toBe(200);
    expect((await status(x, ka)).statusCode).toBe(404);
  });

  it("§15.3: eşzamanlı iki binding.request → ikisi de yanıtlanır, tek etkin satır (UQ yeniden deneme)", async () => {
    const x = await boot();
    const g = await acceptedGuest(x, {});
    await g.guest.waitFor("binding.offer");
    g.guest.send({ t: "binding.request" });
    g.guest.send({ t: "binding.request" });
    await expect.poll(() => g.guest.msgs.filter((m) => m.t === "binding.issued" || m.t === "error").length).toBe(2);
    const a = await g.guest.waitFor("binding.issued");
    const b = await g.guest.waitFor("binding.issued");
    expect([a.renewed, b.renewed].sort()).toEqual([false, true]);
    expect(await testDb().deviceBinding.count({ where: { tenantId: x.tenantId } })).toBe(1);
    expect(await testDb().deviceBinding.count({ where: { lastSessionId: g.sessionId, revokedAt: null } })).toBe(1);
  });
});

describe("AC-184 kayıt anahtarı yalnız talep açar", () => {
  it("AC-184: bindingKey ile /ws/request, /ws/guest reconnect ve /ws/tech (TURN kimlik bilgisinin tek kaynağı WS hello/ice.servers) reddedilir", async () => {
    const x = await boot(TURN_ENV);
    const g = await acceptedGuest(x, {});
    const { bindingKey } = await issue(g.guest);
    await expect(x.rc.reqWs(bindingKey)).rejects.toThrow(/HTTP 40[34]/);
    await expect(connect(`${x.l.base}/ws/guest`, ["rs.v1", `rs.reconnect.${bindingKey}`])).rejects.toThrow(/HTTP 40[34]/);
    await expect(connect(`${x.l.base}/ws/guest`, ["rs.v1", `rs.ticket.${bindingKey}`])).rejects.toThrow(/HTTP 40[34]/);
    await expect(connect(`${x.l.base}/ws/tech?sessionId=${g.sessionId}`, ["rs.v1"], techHeaders(bindingKey, ORIGIN))).rejects.toThrow(/HTTP 40[34]/);
    expect(x.logs.join("\n")).not.toContain(bindingKey);
  });
});

describe("K20 / §15.7-1 kayıtla talep kovalardan muaf değil", () => {
  it("K20: aynı IP'den kayıtla talepler E9 req.create.ip kovasına sayılır (6. istek 429 + rate audit)", async () => {
    const x = await boot();
    const g = await acceptedGuest(x, {});
    const { bindingKey } = await issue(g.guest);
    const ip = "198.51.141.7";
    for (let i = 0; i < 5; i++) {
      const r = await viaKey(x, bindingKey, ip);
      expect(r.statusCode, `${i} ${r.body}`).toBe(201);
      expect((await x.rc.cancel(r.json<{ requestSecret: string }>().requestSecret, ip)).statusCode).toBe(204);
    }
    expect((await viaKey(x, bindingKey, ip)).statusCode).toBe(429);
    const a = await testDb().auditLog.findMany({ where: { tenantId: x.tenantId, action: "request.rate_limited" } });
    expect(a.map((r) => (r.newValue as { bucket: string }).bucket)).toContain("req.create.ip");
  });

  it("K20 / §5.3: req.create.binding kayıt başına 6/sa → farklı IP'lerden 7. talep 429", async () => {
    const x = await boot();
    const g = await acceptedGuest(x, {});
    const { bindingKey } = await issue(g.guest);
    for (let i = 0; i < 6; i++) {
      const ip = nextIp();
      const r = await viaKey(x, bindingKey, ip);
      expect(r.statusCode, `${i} ${r.body}`).toBe(201);
      expect((await x.rc.cancel(r.json<{ requestSecret: string }>().requestSecret, ip)).statusCode).toBe(204);
    }
    expect((await viaKey(x, bindingKey)).statusCode).toBe(429);
    const a = await testDb().auditLog.findMany({ where: { tenantId: x.tenantId, action: "request.rate_limited" } });
    expect(a.map((r) => (r.newValue as { bucket: string }).bucket)).toContain("req.create.binding");
  });
});

describe("B-P8c-5 biçim dışı anahtar", () => {
  it("B-P8c-5 / AC-185: biçim dışı bindingKey status ve talepte 404 BINDING_INVALID ve req.ref_invalid kovasına sayılır (11. deneme 429)", async () => {
    const x = await boot();
    const ip = "198.51.142.3";
    const st = await status(x, "bozuk", ip);
    expect(st.statusCode).toBe(404);
    expect(errOf(st).code).toBe("BINDING_INVALID");
    const cr = await viaKey(x, "rsb_kisa", ip);
    expect(cr.statusCode).toBe(404);
    expect(errOf(cr).code).toBe("BINDING_INVALID");
    for (let i = 0; i < 8; i++) expect((await status(x, `x${i}`, ip)).statusCode).toBe(404);
    expect((await status(x, "yine-bozuk", ip)).statusCode).toBe(429);
  });
});

describe("B-P8c-1 pasife alma yarışı", () => {
  it("B-P8c-1 / AC-171: pasife alma ile yarışta kalmış bekleyen talep kabul edilemez (REQUEST_CLOSED) ve CUSTOMER_PASSIVE ile iptal edilir; pasife alma audit'i gerçek iptal sayısını yazar", async () => {
    const x = await boot();
    const c = await createCustomerRow(x.tenantId);
    const ip = nextIp();
    const cr = await x.rc.createReq(c.requestRef, ip, { version: "0.10.0", consentTextId: await consentOf(x.tenantId) });
    expect(cr.statusCode, cr.body).toBe(201);
    const { requestId } = cr.json<{ requestId: string }>();
    // yarış penceresinin sonucu: müşteri pasif, talep hâlâ PENDING (süpürücü henüz geçmedi)
    await testDb().customer.update({ where: { id: c.id }, data: { status: "PASSIVE", passiveAt: new Date() } });
    const acc = await x.rc.accept(x.tech.headers, requestId);
    expect(acc.statusCode).toBe(409);
    expect(errOf(acc).code).toBe("REQUEST_CLOSED");
    expect(await testDb().supportRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ status: "CANCELLED", cancelReason: "CUSTOMER_PASSIVE", acceptedBy: null });
    expect(await testDb().supportSession.count({ where: { requestId } })).toBe(0);
    // talep TX'i pasif müşteriyi FOR SHARE ile görür: yeni talep yazılmaz (tek 404)
    const again = await x.rc.createReq(c.requestRef, nextIp(), { version: "0.10.0", consentTextId: await consentOf(x.tenantId) });
    expect(again.statusCode).toBe(404);

    const c2 = await createCustomerRow(x.tenantId);
    const p1 = await x.rc.createReq(c2.requestRef, nextIp(), { version: "0.10.0", consentTextId: await consentOf(x.tenantId) });
    const p2 = await x.rc.createReq(c2.requestRef, nextIp(), { version: "0.10.0", consentTextId: await consentOf(x.tenantId) });
    expect([p1.statusCode, p2.statusCode]).toEqual([201, 201]);
    const admin = await loginAs(x.l.app, await createUser({ tenantId: x.tenantId, role: "ADMIN" }));
    expect((await x.l.app.inject({ method: "POST", url: `/api/v1/customers/${c2.id}/deactivate`, headers: admin.headers, payload: {} })).statusCode).toBe(200);
    expect(await testDb().supportRequest.count({ where: { customerId: c2.id, status: "PENDING" } })).toBe(0);
    const d = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: x.tenantId, action: "customer.deactivated", entityId: c2.id } });
    expect(d.newValue).toMatchObject({ cancelledRequests: 2 });
  });

  it("B-P8c-1 / AC-171: ön kontrol (resolveRef) ACTIVE gördükten sonra pasife alma commit olursa talep TX'indeki kilitli müşteri kontrolü talebi yazmaz (tek 404)", async () => {
    const x = await boot();
    const c = await createCustomerRow(x.tenantId);
    const real = RequestService.prototype.resolveRef;
    // Yarış benzetimi: peek ACTIVE döndükten SONRA, TX'ten ÖNCE müşteri pasife alınır (pasife alma TX'inin commit'i).
    const spy = vi.spyOn(RequestService.prototype, "resolveRef").mockImplementation(async function (this: RequestService, ref: unknown) {
      const r = await real.call(this, ref);
      if (r?.customer?.id === c.id) await testDb().customer.update({ where: { id: c.id }, data: { status: "PASSIVE", passiveAt: new Date() } });
      return r;
    });
    try {
      const cr = await x.rc.createReq(c.requestRef, nextIp(), { version: "0.10.0", consentTextId: await consentOf(x.tenantId) });
      expect(spy).toHaveBeenCalled();
      expect(cr.statusCode).toBe(404);
      expect(errOf(cr).code).toBe("REQUEST_REF_INVALID");
    } finally {
      spy.mockRestore();
    }
    expect(await testDb().supportRequest.count({ where: { customerId: c.id } })).toBe(0);
  });
});

/** InnoDB kilitlenme kurbanının Prisma 7 sürücü bağdaştırıcısı şekli (P2034 / 1213). */
const deadlock = () => Object.assign(new Prisma.PrismaClientKnownRequestError("Deadlock found when trying to get lock", { code: "P2034", clientVersion: "test" }), { meta: { driverAdapterError: { cause: { code: 1213 } } } });

describe("B-P8c2-2 pasife alma / ref yenilemede geçici DB hatası", () => {
  const adminOf = async (x: Ctx) => loginAs(x.l.app, await createUser({ tenantId: x.tenantId, role: "ADMIN" }));

  it("B-P8c2-2 / AC-171: pasife alma TX'i kilitlenme kurbanı olursa bir kez yeniden denenir → 200, tek audit, kayıtlar düşer", async () => {
    const x = await boot();
    const admin = await adminOf(x);
    const c = await createCustomerRow(x.tenantId);
    const spy = vi.spyOn(testDb(), "$transaction").mockRejectedValueOnce(deadlock());
    try {
      const r = await x.l.app.inject({ method: "POST", url: `/api/v1/customers/${c.id}/deactivate`, headers: admin.headers, payload: {} });
      expect(r.statusCode, r.body).toBe(200);
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      spy.mockRestore();
    }
    expect(await testDb().customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "PASSIVE" });
    expect(await testDb().auditLog.count({ where: { tenantId: x.tenantId, action: "customer.deactivated", entityId: c.id } })).toBe(1);
  });

  it("B-P8c2-2 / AC-170: ref yenileme TX'i kilitlenme kurbanı olursa bir kez yeniden denenir → 200, tek audit, yeni ref", async () => {
    const x = await boot();
    const admin = await adminOf(x);
    const c = await createCustomerRow(x.tenantId);
    const spy = vi.spyOn(testDb(), "$transaction").mockRejectedValueOnce(deadlock());
    try {
      const r = await x.l.app.inject({ method: "POST", url: `/api/v1/customers/${c.id}/rotate-ref`, headers: admin.headers, payload: {} });
      expect(r.statusCode, r.body).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect((await testDb().customer.findUniqueOrThrow({ where: { id: c.id } })).requestRef).not.toBe(c.requestRef);
    expect(await testDb().auditLog.count({ where: { tenantId: x.tenantId, action: "customer.ref_rotated", entityId: c.id } })).toBe(1);
  });

  it("B-P8c2-2: yeniden deneme tek seferlik — iki ardışık geçici hata 503 NOT_READY (500 değil), müşteri ACTIVE kalır", async () => {
    const x = await boot();
    const admin = await adminOf(x);
    const c = await createCustomerRow(x.tenantId);
    const spy = vi.spyOn(testDb(), "$transaction").mockRejectedValueOnce(deadlock()).mockRejectedValueOnce(deadlock());
    try {
      const r = await x.l.app.inject({ method: "POST", url: `/api/v1/customers/${c.id}/deactivate`, headers: admin.headers, payload: {} });
      expect(r.statusCode).toBe(503);
      expect(errOf(r).code).toBe("NOT_READY");
      expect(r.headers["retry-after"]).toBeDefined();
    } finally {
      spy.mockRestore();
    }
    expect(await testDb().customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "ACTIVE" });
  });
});

describe("B-P8c-3 revoke-binding yetkisi", () => {
  it("B-P8c-3: customers.edit olup support_requests.view olmayan kullanıcı revoke-binding'de 403", async () => {
    const x = await boot();
    const g = await acceptedGuest(x, {});
    const { bindingKey } = await issue(g.guest);
    const r = (await viaKey(x, bindingKey)).json<{ requestId: string }>();
    const u = await loginAs(x.l.app, await createUser({ tenantId: x.tenantId, role: "USER", perms: { "customers.view": true, "customers.edit": true } }));
    const res = await x.l.app.inject({ method: "POST", url: `/api/v1/support-requests/${r.requestId}/revoke-binding`, headers: u.headers, payload: {} });
    expect(res.statusCode).toBe(403);
    expect(await testDb().deviceBinding.count({ where: { tenantId: x.tenantId, revokedAt: null } })).toBe(1);
  });
});

describe("AC-192 talepten doğan oturumda TURN", () => {
  it("AC-192: müşteri ref'iyle açılmış talep kabulünde teknisyenin ilk ice.servers'ı TURN girdisi içerir ve peer.joined'dan ÖNCE gelir", async () => {
    const x = await boot(TURN_ENV);
    const c = await createCustomerRow(x.tenantId);
    const cr = await x.rc.createReq(c.requestRef, nextIp(), { version: "0.10.0", consentTextId: await consentOf(x.tenantId) });
    const { requestId, requestSecret } = cr.json<{ requestId: string; requestSecret: string }>();
    const reqWs = await x.rc.reqWs(requestSecret);
    await waitMsg(reqWs, "request.state");
    const acc = await x.rc.accept(x.tech.headers, requestId);
    expect(acc.statusCode, acc.body).toBe(200);
    const { sessionId } = acc.json<{ sessionId: string }>();
    const tech = await connect(`${x.l.base}/ws/tech?sessionId=${sessionId}`, ["rs.v1"], techHeaders(x.tech.token, ORIGIN));
    await expect.poll(() => tech.msgs.some((m) => m.t === "hello")).toBe(true);
    const techHello = tech.msgs.find((m) => m.t === "hello");
    expect(techHello).toMatchObject({ iceServers: [] }); // PENDING: TURN yok (G-01)
    const { wsTicket } = await waitMsg<{ wsTicket: string }>(reqWs, "request.accepted");
    const guest = await x.rc.guestWs(wsTicket);
    await guest.waitFor("hello");
    await expect.poll(() => tech.msgs.some((m) => m.t === "peer.joined")).toBe(true);
    const order = tech.msgs.map((m) => m.t);
    const iceAt = order.indexOf("ice.servers");
    expect(iceAt).toBeGreaterThanOrEqual(0);
    expect(iceAt).toBeLessThan(order.indexOf("peer.joined"));
    const ice = tech.msgs[iceAt] as Extract<(typeof tech.msgs)[number], { t: "ice.servers" }>;
    expect(ice.iceServers.some((s) => [s.urls].flat().some((u) => u.startsWith("turn:")) && s.username && s.credential)).toBe(true);
    expect(await testDb().supportSession.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ customerId: c.id, status: "ACTIVE" });
  });
});

describe("AC-188 seed aydınlatma metni", () => {
  it("AC-188: seed, eski sistem metnindeki tenant'a yeni sürüm yazar (bilgisayar kaydı, saklama, 'Bu bilgisayarı unut'); yeniden çalıştırma idempotent", async () => {
    const t = await createTenant();
    const before = await testDb().consentText.findFirstOrThrow({ where: { tenantId: t.id, isCurrent: true } });
    expect(await seedTenantConsent(testDb(), { id: t.id, name: "Seed Firma" })).toBe(true);
    const cur = await testDb().consentText.findFirstOrThrow({ where: { tenantId: t.id, isCurrent: true } });
    expect(cur.version).toBe(before.version + 1);
    expect(cur.createdBy).toBeNull();
    for (const s of ["Bu bilgisayarı unut", "kayıt anahtarı", "saklama süresi", "tek yönlü özeti", "Seed Firma"]) expect(cur.body).toContain(s);
    expect((await testDb().consentText.findUniqueOrThrow({ where: { id: before.id } })).isCurrent).toBe(false);
    expect(await seedTenantConsent(testDb(), { id: t.id, name: "Seed Firma" })).toBe(false);
    expect(await testDb().consentText.count({ where: { tenantId: t.id } })).toBe(2);
    expect(await testDb().auditLog.count({ where: { tenantId: t.id, action: "consent_text.created", entityId: cur.id } })).toBe(1);
  });
});
