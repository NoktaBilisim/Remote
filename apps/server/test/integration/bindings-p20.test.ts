// P20 K1 çoklu firma kaydı — gerçek MySQL + dinleyen sunucu (mimari-e11 §8d.2, §8d.9 sunucu satırı; protokol §6.1;
// AC-254, S-P20-4). Regresyon: çoklu dalda başka firmanın kaydı ASLA REPLACED olmaz; eski dal (`previousKey`) aynen.
import { afterEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/lib/ids.ts";
import { createTenant, createUser, loginAs, testDb, type Session } from "../helpers/app.ts";
import { createRequestSettings, requestClient, waitMsg } from "../helpers/requests.ts";
import { startLive, TECH_PERMS, type Live } from "../helpers/signal-flow.ts";
import { FAKE_METRICS_TOKEN } from "../helpers/secrets.ts";
import type { WsClient } from "../helpers/ws.ts";

const REQ_PERMS = { ...TECH_PERMS, "support_requests.view": true, "support_requests.accept": true };
let ipSeq = 0;
const nextIp = () => `198.51.140.${(++ipSeq % 250) + 1}`;

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});

interface Firm {
  tenantId: string;
  genRef: string;
  tech: Session;
}
interface Ctx {
  l: Live;
  rc: ReturnType<typeof requestClient>;
  logs: string[];
  firm: () => Promise<Firm>;
}

async function boot(): Promise<Ctx> {
  const logs: string[] = [];
  const { default: pino } = await import("pino");
  const logger = pino({ level: "info" }, { write: (s: string) => void logs.push(s) });
  live = await startLive({ env: { TRUSTED_PROXY_CIDR: "127.0.0.1/32", METRICS_TOKEN: FAKE_METRICS_TOKEN }, logger });
  const l = live;
  return {
    l,
    rc: requestClient(l.app, l.base),
    logs,
    firm: async () => {
      const t = await createTenant();
      // WS upgrade kovası (31/dk/IP) çok oturumlu testte dolmasın: yerel adres güvenilen CIDR (P14a AC-210 muafiyeti)
      const genRef = await createRequestSettings(t.id, { trustedCidrs: ["127.0.0.1/32"] });
      const u = await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS });
      return { tenantId: t.id, genRef, tech: await loginAs(l.app, u) };
    },
  };
}

/** Genel ref'le talep → kabul → misafir WS hello (istemci sürümü ticket'a talep kaydından geçer). */
async function guestOf(x: Ctx, f: Firm, version: string) {
  const consentTextId = (await testDb().consentText.findFirstOrThrow({ where: { tenantId: f.tenantId, isCurrent: true } })).id;
  const c = await x.rc.createReq(f.genRef, nextIp(), { version, consentTextId });
  expect(c.statusCode, c.body).toBe(201);
  const { requestId, requestSecret } = c.json<{ requestId: string; requestSecret: string }>();
  const reqWs = await x.rc.reqWs(requestSecret);
  await waitMsg(reqWs, "request.state");
  const acc = await x.rc.accept(f.tech.headers, requestId);
  expect(acc.statusCode, acc.body).toBe(200);
  const { wsTicket } = await waitMsg<{ wsTicket: string }>(reqWs, "request.accepted");
  const guest = await x.rc.guestWs(wsTicket);
  await guest.waitFor("hello");
  return { guest, sessionId: acc.json<{ sessionId: string }>().sessionId };
}

/** 0.10.0 misafirle tek kayıt (eski dal) → anahtar; oturum sonra kapatılır. */
async function legacyKey(x: Ctx, f: Firm): Promise<string> {
  const { guest, sessionId } = await guestOf(x, f, "0.10.0");
  await guest.waitFor("binding.offer");
  guest.send({ t: "binding.request" });
  const key = (await guest.waitFor("binding.issued")).bindingKey;
  // teknisyenin açık oturum sınırı: oturum kapanır, kayıt kalır
  guest.send({ t: "session.end" });
  await expect.poll(async () => (await testDb().supportSession.findUniqueOrThrow({ where: { id: sessionId } })).status).not.toBe("ACTIVE");
  return key;
}

/** Sıradaki `binding.issued` ya da `error` (hangisi önce gelirse). */
async function reply(g: WsClient): Promise<Record<string, unknown>> {
  const hit = (m: { t: string }) => m.t === "binding.issued" || m.t === "error";
  await expect.poll(() => g.msgs.some(hit)).toBe(true);
  return g.msgs.splice(g.msgs.findIndex(hit), 1)[0] as Record<string, unknown>;
}
const rowOf = (key: string) => testDb().deviceBinding.findFirst({ where: { keyHash: sha256Hex(key) } });
const metrics = async (x: Ctx) =>
  (await x.l.app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${FAKE_METRICS_TOKEN}` } })).body;

describe("AC-254 / S-P20-4 çoklu firma kaydı (sunucu)", () => {
  it("AC-254 / S-P20-4 (regresyon): previousKeys başka firmanın anahtarını taşırsa o kayıt REPLACED olmaz; yeni kayıt previousIndex null", async () => {
    const x = await boot();
    const a = await x.firm();
    const b = await x.firm();
    const kA = await legacyKey(x, a);
    const { guest } = await guestOf(x, b, "0.12.0");
    expect(await guest.waitFor("binding.offer")).toEqual({ t: "binding.offer", multi: true });
    guest.send({ t: "binding.request", previousKeys: [kA] });
    const m = await reply(guest);
    expect(m).toMatchObject({ t: "binding.issued", renewed: false, previousIndex: null });
    expect(await rowOf(kA)).toMatchObject({ tenantId: a.tenantId, revokedAt: null, revokeReason: null });
    expect(await testDb().auditLog.count({ where: { tenantId: a.tenantId, action: "binding.revoked" } })).toBe(0);
    const issued = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: b.tenantId, action: "binding.issued" } });
    expect(issued.newValue).toMatchObject({ renewed: false, multi: true, replacedOtherTenant: false });
    expect(await rowOf(m.bindingKey as string)).toMatchObject({ tenantId: b.tenantId, revokedAt: null });
    const joined = x.logs.join("\n");
    expect(joined).not.toContain(kA);
    expect(joined).not.toContain(m.bindingKey as string);
    expect(await metrics(x)).toMatch(/rs_bindings_issued_total\{renewed="false",multi="true"\} 1/);
  });

  it("AC-254: aynı firmanın en son kullanılan kaydı yenilenir (previousIndex = listedeki sıra); aynı firma fazlası REPLACED, başka firma dokunulmaz", async () => {
    const x = await boot();
    const a = await x.firm();
    const b = await x.firm();
    const k1 = await legacyKey(x, a);
    const k2 = await legacyKey(x, a);
    const kB = await legacyKey(x, b);
    await testDb().deviceBinding.update({ where: { keyHash: sha256Hex(k1) }, data: { lastUsedAt: new Date(Date.now() - 60_000) } });
    const r2 = await testDb().deviceBinding.findFirstOrThrow({ where: { keyHash: sha256Hex(k2) } });
    const { guest, sessionId } = await guestOf(x, a, "0.12.0");
    await guest.waitFor("binding.offer");
    guest.send({ t: "binding.request", previousKeys: [kB, k1, k2], full: true });
    const m = await reply(guest);
    expect(m).toMatchObject({ t: "binding.issued", renewed: true, previousIndex: 2 });
    expect(await testDb().deviceBinding.findUniqueOrThrow({ where: { id: r2.id } })).toMatchObject({
      keyHash: sha256Hex(m.bindingKey as string),
      lastSessionId: sessionId,
      revokedAt: null,
    });
    expect(await testDb().deviceBinding.findFirstOrThrow({ where: { tenantId: a.tenantId, revokeReason: "REPLACED" } })).toMatchObject({
      keyHash: null,
    });
    expect(await rowOf(kB)).toMatchObject({ tenantId: b.tenantId, revokedAt: null });
    expect(await testDb().auditLog.count({ where: { tenantId: b.tenantId, action: "binding.revoked" } })).toBe(0);
    expect(await testDb().auditLog.count({ where: { tenantId: a.tenantId, action: "binding.revoked" } })).toBe(1);
    // aynı oturumda ikinci istek: cur yolu; previousIndex yalnız cur'un anahtarı listedeyse sayı olur
    guest.send({ t: "binding.request", previousKeys: [m.bindingKey as string] });
    expect(await reply(guest)).toMatchObject({ t: "binding.issued", renewed: true, previousIndex: 0 });
    expect(await testDb().deviceBinding.count({ where: { tenantId: a.tenantId, revokedAt: null } })).toBe(1);
  });

  it("AC-254: 5 doluyken (full) eşleşen firma kaydı yoksa error BINDING_LIMIT; hiçbir kayıt değişmez, audit binding.denied capacity, oturum sürer", async () => {
    const x = await boot();
    const a = await x.firm();
    const b = await x.firm();
    const keys: string[] = [];
    for (let i = 0; i < 5; i++) keys.push(await legacyKey(x, a));
    const before = await testDb().deviceBinding.findMany({ where: { tenantId: a.tenantId }, orderBy: { id: "asc" } });
    const { guest } = await guestOf(x, b, "0.12.0");
    await guest.waitFor("binding.offer");
    guest.send({ t: "binding.request", previousKeys: keys, full: true });
    expect(await reply(guest)).toMatchObject({ t: "error", code: "BINDING_LIMIT" });
    expect(await testDb().deviceBinding.findMany({ where: { tenantId: a.tenantId }, orderBy: { id: "asc" } })).toEqual(before);
    expect(await testDb().deviceBinding.count({ where: { tenantId: b.tenantId } })).toBe(0);
    const d = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: b.tenantId, action: "binding.denied" } });
    expect(d.newValue).toEqual({ reason: "capacity" });
    expect(await metrics(x)).toMatch(/rs_binding_denied_total\{reason="capacity"\} 1/);
    // oturum sürer: bağlantı açık, aynı oturumda full'süz istek yeni kayıt alır
    guest.send({ t: "binding.request", previousKeys: keys });
    expect(await reply(guest)).toMatchObject({ t: "binding.issued", renewed: false, previousIndex: null });
  });

  it("AC-254: teklif yalnız ≥ 0.12.0'a multi taşır; 0.11.x teklifinde previousKeys → CONFLICT; eski dal (previousKey) başka firma kaydını bugünkü gibi REPLACED eder", async () => {
    const x = await boot();
    const a = await x.firm();
    const b = await x.firm();
    const kA = await legacyKey(x, a);
    const old = await guestOf(x, b, "0.11.3");
    expect(await old.guest.waitFor("binding.offer")).toEqual({ t: "binding.offer" });
    old.guest.send({ t: "binding.request", previousKeys: [kA] });
    expect(await reply(old.guest)).toMatchObject({ t: "error", code: "CONFLICT" });
    expect(await testDb().deviceBinding.count({ where: { tenantId: b.tenantId } })).toBe(0);
    old.guest.send({ t: "binding.request", previousKey: kA });
    const m = await reply(old.guest);
    expect(m).toMatchObject({ t: "binding.issued", renewed: false });
    expect(m).not.toHaveProperty("previousIndex");
    expect(await testDb().deviceBinding.findFirstOrThrow({ where: { tenantId: a.tenantId } })).toMatchObject({ revokeReason: "REPLACED" });
    const issued = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: b.tenantId, action: "binding.issued" } });
    expect(issued.newValue).toMatchObject({ replacedOtherTenant: true });
    expect(issued.newValue).not.toHaveProperty("multi");
  });

  it("AC-254: previousKey + previousKeys birlikte → error VALIDATION (soket açık, kayıt yok); 6 anahtar → 1008", async () => {
    const x = await boot();
    const a = await x.firm();
    const k = await legacyKey(x, a);
    const g = await guestOf(x, a, "0.12.0");
    await g.guest.waitFor("binding.offer");
    g.guest.send({ t: "binding.request", previousKey: k, previousKeys: [k] });
    expect(await reply(g.guest)).toMatchObject({ t: "error", code: "VALIDATION" });
    expect(await rowOf(k)).toMatchObject({ revokedAt: null });
    g.guest.send({ t: "binding.request", previousKeys: [k] });
    expect(await reply(g.guest)).toMatchObject({ t: "binding.issued", renewed: true, previousIndex: 0 });
    g.guest.send({ t: "binding.request", previousKeys: [k, k, k, k, k, k] });
    expect((await g.guest.closed).code).toBe(1008);
  });

  it("AC-254 / K0: aynı anahtar kümesini ters sırayla taşıyan eşzamanlı iki oturum kilitlenmeden yanıtlanır; her oturumda tek etkin kayıt", async () => {
    const x = await boot();
    const a = await x.firm();
    const keys: string[] = [];
    for (let i = 0; i < 4; i++) keys.push(await legacyKey(x, a));
    const g1 = await guestOf(x, a, "0.12.0");
    const g2 = await guestOf(x, a, "0.12.0");
    await Promise.all([g1.guest.waitFor("binding.offer"), g2.guest.waitFor("binding.offer")]);
    g1.guest.send({ t: "binding.request", previousKeys: keys });
    g2.guest.send({ t: "binding.request", previousKeys: [...keys].reverse() });
    const [m1, m2] = await Promise.all([reply(g1.guest), reply(g2.guest)]);
    expect(m1, JSON.stringify(m1)).toMatchObject({ t: "binding.issued" });
    expect(m2, JSON.stringify(m2)).toMatchObject({ t: "binding.issued" });
    // biri en son kullanılanı yeniler + kalan 3'ü REPLACED; diğeri eşleşme bulamaz → yeni kayıt
    expect([m1.renewed, m2.renewed].sort()).toEqual([false, true]);
    expect(await testDb().deviceBinding.count({ where: { tenantId: a.tenantId, revokedAt: null } })).toBe(2);
    for (const s of [g1.sessionId, g2.sessionId])
      expect(await testDb().deviceBinding.count({ where: { lastSessionId: s, revokedAt: null } })).toBe(1);
    expect(await testDb().deviceBinding.count({ where: { tenantId: a.tenantId, revokeReason: "REPLACED" } })).toBe(3);
  });
});
