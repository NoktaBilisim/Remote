// P18 H3 — kabul öncesi mesajlaşma (mimari-e11 §8b.4–8b.7, §8b.13; AC-255; S-P18-T1/T2/T3/T4/T5c/T8/T9/T10).
// Gerçek MySQL + canlı sunucu (sahte /ws/request istemcisi: `rs.cap.chat1` ile ve olmadan). Hız testleri sahte saatle.
import { Writable } from "node:stream";
import type { RequestMessageListResponse, SendRequestMessageResponse } from "@remote/contracts/api/requests";
import type { TenantPurgePreviewResponse, TenantPurgeScheduledResponse } from "@remote/contracts/api/tenants";
import { MESSAGES_PER_SENDER_MAX } from "@remote/contracts/api/requests";
import { WS_REQUEST_CAP_CHAT } from "@remote/contracts/ws-request";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main as cryptoMain, CLI_ACTOR } from "../../src/cli/crypto.ts";
import { TenantPurgeRunner } from "../../src/jobs/tenant-purge.ts";
import { aadFor, SecretBox } from "../../src/lib/crypto.ts";
import { newId } from "../../src/lib/ids.ts";
import { anonymizeRequestsOf } from "../../src/requests/jobs.ts";
import { CAP_MESSAGE, RATE_MESSAGE } from "../../src/requests/messages.ts";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import {
  createTenant,
  createUser,
  loginRequest,
  markStepUp,
  ORIGIN,
  testDb,
  testFixtureDb,
  type Session,
  type TestUser,
} from "../helpers/app.ts";
import { createRequestRow, createRequestSettings, requestClient, waitMsg } from "../helpers/requests.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { makeDue, makeEligible, seedPurgeTenant, tenantRowCounts } from "../helpers/tenant-purge.ts";
import { connect, FakeClock, type WsClient } from "../helpers/ws.ts";

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
type Res = { statusCode: number; json: <T>() => T; body: string };
const err = (r: Res) => r.json<{ error: { code: string; message: string } }>().error;
const db = () => testDb();

let live: Live;
let clock: FakeClock;
/** S-P18-T9: hata yolu log yakalama (bütün app logları). */
const logLines: string[] = [];
const logStream = new Writable({
  write(chunk: Buffer, _enc, cb) {
    logLines.push(chunk.toString("utf8"));
    cb();
  },
});

beforeAll(async () => {
  clock = new FakeClock();
  live = await startLive({ env: PROXY, signaling: { clock }, logger: pino({ level: "info" }, logStream) });
});
afterAll(() => live.close());

/** Giriş IP kovası (20/dk) dosya içinde paylaşılmasın: her girişe ayrı XFF IP'si. */
let loginSeq = 0;
async function loginAs(app: Live["app"], user: TestUser): Promise<Session> {
  const ip = `198.18.${Math.floor(++loginSeq / 200)}.${(loginSeq % 200) + 1}`;
  const res = await app.inject(loginRequest(user.email, user.password, { headers: { origin: ORIGIN, "x-forwarded-for": ip } }));
  if (res.statusCode !== 200) throw new Error(`login başarısız: ${res.statusCode} ${res.body}`);
  const jar = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
  const session = jar[SESSION_COOKIE] ?? "";
  const csrf = jar[CSRF_COOKIE] ?? "";
  return {
    token: session,
    headers: { cookie: `${SESSION_COOKIE}=${session}; ${CSRF_COOKIE}=${csrf}`, "x-csrf-token": csrf, origin: ORIGIN },
  };
}
async function loginStepUp(app: Live["app"], user: TestUser): Promise<Session> {
  const s = await loginAs(app, user);
  await testDb().user.updateMany({
    where: { id: user.id, totpEnabled: false },
    data: { totpEnabled: true, totpSecretEnc: new Uint8Array(40), totpLastStep: null },
  });
  await markStepUp(s);
  return s;
}

const call = (s: Session, method: "GET" | "POST", url: string, payload?: object) =>
  live.app.inject({ method, url: `/api/v1${url}`, headers: s.headers, ...(payload === undefined ? {} : { payload }) }) as Promise<Res>;
const send = (s: Session, id: string, body: string, clientMsgId = newId()) =>
  call(s, "POST", `/support-requests/${id}/messages`, { body, clientMsgId });
const list = (s: Session, id: string, after?: string) =>
  call(s, "GET", `/support-requests/${id}/messages${after ? `?after=${after}` : ""}`);
/** Talep+gönderici 1/sn penceresini geçir (sahte saat). */
const tick = () => clock.advance(1_100);
const reqWs = (secret: string, chat = true): Promise<WsClient> =>
  connect(`${live.base}/ws/request`, ["rs.v1", `rs.req.${secret}`, ...(chat ? [WS_REQUEST_CAP_CHAT] : [])]);
const metric = (line: string): number => {
  const m = live.app.metrics
    .render()
    .split("\n")
    .find((l) => l.startsWith(line));
  return m ? Number(m.slice(m.lastIndexOf(" ") + 1)) : 0;
};
const rowsOf = (requestId: string) => db().sessionMessage.count({ where: { requestId } });
const settle = () => new Promise((r) => setTimeout(r, 150));
const isOpen = (c: WsClient) => c.ws.readyState === c.ws.OPEN;

async function firm() {
  const t = await createTenant();
  await createRequestSettings(t.id);
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const s = await loginAs(live.app, admin);
  const r = await createRequestRow(t.id);
  return { t, admin, s, r };
}

describe("AC-255 çift yönlü mesajlaşma", () => {
  it("AC-255: yetenekli sahte istemci ↔ panel; gövdesiz request.activity; talep PENDING kalır (S-P18-T1)", async () => {
    const { t, s, r } = await firm();
    const rc = requestClient(live.app, live.base);
    const panel = await rc.panelWs(s.token);
    await waitMsg(panel, "queue.count");
    const cust = await reqWs(r.secret);
    expect(await waitMsg<{ items: unknown[] }>(cust, "request.messages")).toEqual({ t: "request.messages", items: [] });

    tick();
    const sent = await send(s, r.id, "Merhaba, birazdan bağlanıyorum", "tech-1");
    expect(sent.statusCode, sent.body).toBe(201);
    const { id: techMsgId } = sent.json<SendRequestMessageResponse>();
    const got = await waitMsg<Record<string, unknown>>(cust, "request.message");
    expect(got).toMatchObject({ id: techMsgId, sender: "TECH", body: "Merhaba, birazdan bağlanıyorum" });
    expect(typeof got.senderName).toBe("string");
    expect(got.clientMsgId).toBeUndefined();
    const act = await waitMsg<Record<string, unknown>>(panel, "request.activity");
    expect(act).toEqual({ t: "request.activity", id: r.id, kind: "message", sender: "TECH", at: expect.any(String) });

    tick();
    cust.send({ t: "request.message", body: "  Yazıcı yine\r\nkağıt sıkıştırdı 👩\u200D💻 ", clientMsgId: "c-1" });
    const echo = await waitMsg<Record<string, unknown>>(cust, "request.message");
    expect(echo).toMatchObject({ sender: "CUSTOMER", clientMsgId: "c-1", body: "Yazıcı yine\nkağıt sıkıştırdı 👩\u200D💻" });
    expect(echo.senderName).toBeUndefined();
    clock.advance(1_000); // activity penceresi (≤ 1/sn) sonu
    const act2 = await waitMsg<Record<string, unknown>>(panel, "request.activity");
    expect(act2).toMatchObject({ id: r.id, sender: "CUSTOMER" });
    expect(JSON.stringify(panel.msgs)).not.toContain("kağıt");

    const l = await list(s, r.id);
    expect(l.statusCode).toBe(200);
    const body = l.json<RequestMessageListResponse>();
    expect(body.customerChat).toBe("SUPPORTED");
    expect(body.items.map((i) => [i.sender, i.body])).toEqual([
      ["TECH", "Merhaba, birazdan bağlanıyorum"],
      ["CUSTOMER", "Yazıcı yine\nkağıt sıkıştırdı 👩\u200D💻"],
    ]);
    expect(body.items[1]?.senderName).toBeNull();
    const after = (await list(s, r.id, techMsgId)).json<RequestMessageListResponse>();
    expect(after.items.map((i) => i.sender)).toEqual(["CUSTOMER"]);

    expect((await db().supportRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING");
    expect(isOpen(cust)).toBe(true);
    const audits = await db().auditLog.findMany({ where: { tenantId: t.id, action: "request.message_sent" }, orderBy: { id: "asc" } });
    expect(audits.map((a) => a.newValue)).toEqual([
      { sender: "TECH", chars: 30 },
      { sender: "CUSTOMER", chars: [..."Yazıcı yine\nkağıt sıkıştırdı 👩\u200D💻"].length },
    ]);
    expect(audits[1]?.userId).toBeNull();
    expect(JSON.stringify(audits.map((a) => [a.oldValue, a.newValue]))).not.toContain("Merhaba");
    cust.ws.close();
    panel.ws.close();
  });

  it("AC-255: yeniden bağlantıda son mesajlar request.messages ile gelir; aynı clientMsgId çift kayıt üretmez", async () => {
    const { s, r } = await firm();
    tick();
    const a = await send(s, r.id, "İlk mesaj", "dup-1"); // soket yok → OFFLINE, saklanır
    expect(a.statusCode).toBe(201);
    tick();
    const b = await send(s, r.id, "İlk mesaj", "dup-1");
    expect(b.json<SendRequestMessageResponse>().id).toBe(a.json<SendRequestMessageResponse>().id);
    expect(await rowsOf(r.id)).toBe(1);
    expect((await list(s, r.id)).json<RequestMessageListResponse>().customerChat).toBe("OFFLINE");
    const cust = await reqWs(r.secret);
    const hist = await waitMsg<{ items: { body: string; sender: string }[] }>(cust, "request.messages");
    expect(hist.items).toMatchObject([{ sender: "TECH", body: "İlk mesaj" }]);
    tick();
    cust.send({ t: "request.message", body: "selam", clientMsgId: "c-dup" });
    await waitMsg(cust, "request.message");
    tick();
    cust.send({ t: "request.message", body: "selam", clientMsgId: "c-dup" });
    const again = await waitMsg<{ clientMsgId: string }>(cust, "request.message");
    expect(again.clientMsgId).toBe("c-dup");
    expect(await rowsOf(r.id)).toBe(2);
    cust.ws.close();
  });
});

describe("AC-255 doğrulama, yetki, tenant, durum", () => {
  it("AC-255 / S-P18-T8: 1.001 karakter → 400 VALIDATION; bidi/U+2028 → 400; 1.000 → 201", async () => {
    const { s, r } = await firm();
    for (const bad of ["x".repeat(1001), "a\u202Eb", "a\u2028b", "  "]) {
      const res = await send(s, r.id, bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(err(res).code).toBe("VALIDATION");
    }
    tick();
    expect((await send(s, r.id, "ğ".repeat(1000))).statusCode).toBe(201);
    expect(await rowsOf(r.id)).toBe(1);
  });

  it("AC-255 / S-P18-T3: view yoksa okuma/yazma 403; view var message yoksa yazma 403, okuma 200", async () => {
    const { t, r } = await firm();
    const none = await loginAs(live.app, await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.view": true } }));
    expect((await list(none, r.id)).statusCode).toBe(403);
    expect((await send(none, r.id, "Merhaba")).statusCode).toBe(403);
    const viewer = await loginAs(live.app, await createUser({ tenantId: t.id, role: "USER", perms: { "support_requests.view": true } }));
    expect((await list(viewer, r.id)).statusCode).toBe(200);
    expect((await send(viewer, r.id, "Merhaba")).statusCode).toBe(403);
    const writer = await loginAs(
      live.app,
      await createUser({ tenantId: t.id, role: "USER", perms: { "support_requests.view": true, "support_requests.message": true } }),
    );
    tick();
    expect((await send(writer, r.id, "Merhaba")).statusCode).toBe(201);
  });

  it("AC-255: başka tenant'ın talebi 404 (okuma ve yazma); geçersiz id 404", async () => {
    const { r } = await firm();
    const other = await firm();
    expect((await list(other.s, r.id)).statusCode).toBe(404);
    expect((await send(other.s, r.id, "Merhaba")).statusCode).toBe(404);
    expect((await list(other.s, "nope")).statusCode).toBe(404);
    expect(await rowsOf(r.id)).toBe(0);
  });

  it("AC-255: PENDING dışı talep → 409 REQUEST_CLOSED (okuma ve yazma)", async () => {
    const { s, r } = await firm();
    const rej = await call(s, "POST", `/support-requests/${r.id}/reject`, { message: "Şu an müsait değiliz" });
    expect(rej.statusCode, rej.body).toBe(204);
    tick();
    expect(err(await send(s, r.id, "Merhaba")).code).toBe("REQUEST_CLOSED");
    expect(err(await list(s, r.id)).code).toBe("REQUEST_CLOSED");
  });

  it("S-P18-T5c: firma bağlamındaki Super Admin TECH olarak yazabilir; mesaj o tenant'a yazılır", async () => {
    const { t, r } = await firm();
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const ss = await loginAs(live.app, sa);
    const sw = await live.app.inject({
      method: "POST",
      url: "/api/v1/admin/switch-tenant",
      headers: ss.headers,
      payload: { tenantId: t.id },
    });
    expect(sw.statusCode, sw.body).toBeLessThan(300);
    tick();
    const res = await send(ss, r.id, "Super Admin yazdı");
    expect(res.statusCode, res.body).toBe(201);
    const row = await db().sessionMessage.findFirstOrThrow({ where: { requestId: r.id } });
    expect(row).toMatchObject({ tenantId: t.id, sender: "TECH", senderUserId: sa.id });
  });
});

describe("AC-255 / S-P18-T4 hız ve tavanlar", () => {
  it("AC-255: aynı talepte < 1 sn ikinci mesaj → REST 429 RATE_LIMITED; WS error RATE_LIMITED, soket açık", async () => {
    const { s, r } = await firm();
    tick();
    expect((await send(s, r.id, "bir")).statusCode).toBe(201);
    const second = await send(s, r.id, "iki");
    expect(second.statusCode).toBe(429);
    expect(err(second)).toMatchObject({ code: "RATE_LIMITED", message: RATE_MESSAGE });

    const cust = await reqWs(r.secret);
    await waitMsg(cust, "request.messages");
    cust.send({ t: "request.message", body: "a", clientMsgId: "w1" });
    await waitMsg(cust, "request.message");
    cust.send({ t: "request.message", body: "b", clientMsgId: "w2" });
    expect(await waitMsg(cust, "error")).toEqual({ t: "error", code: "RATE_LIMITED", message: RATE_MESSAGE });
    await settle();
    expect(isOpen(cust)).toBe(true);
    expect(await rowsOf(r.id)).toBe(2);
    expect((await db().supportRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING");
    cust.ws.close();
  });

  it("S-P18-T4: gönderici başına 200 tavanı — TECH tavanda 429, müşteri kanalı etkilenmez", async () => {
    const { t, s, admin, r } = await firm();
    await testFixtureDb().sessionMessage.createMany({
      data: Array.from({ length: MESSAGES_PER_SENDER_MAX }, (_, i) => ({
        id: newId(),
        tenantId: t.id,
        requestId: r.id,
        sender: "TECH",
        senderUserId: admin.id,
        clientMsgId: `cap-${i}`,
        bodyEnc: new Uint8Array(31),
        bodyChars: 2,
      })),
    });
    tick();
    const res = await send(s, r.id, "tavan");
    expect(res.statusCode).toBe(429);
    expect(err(res).message).toBe(CAP_MESSAGE);
    const cust = await reqWs(r.secret);
    await waitMsg(cust, "request.messages");
    tick();
    cust.send({ t: "request.message", body: "müşteri yazabilir", clientMsgId: "c-cap" });
    expect(await waitMsg(cust, "request.message")).toMatchObject({ sender: "CUSTOMER" });
    const rej = await db().auditLog.findMany({ where: { tenantId: t.id, action: "request.message_rejected" } });
    expect(rej.map((a) => a.newValue)).toEqual([{ reason: "cap", sender: "TECH" }]);
    cust.ws.close();
  });

  it("S-P18-T4: firma müşteri kovası 300/dk aşımı → error RATE_LIMITED + panel queue.alert + reason tenant_rate", async () => {
    const { t, s, r } = await firm();
    const panel = await requestClient(live.app, live.base).panelWs(s.token);
    await waitMsg(panel, "queue.count");
    const cust = await reqWs(r.secret);
    await waitMsg(cust, "request.messages");
    const bucket = live.app.requests.messages.tenantCustomer;
    for (let i = 0; i < 300; i++) bucket.hit(t.id);
    const before = metric('rs_request_messages_rejected_total{reason="tenant_rate"}');
    tick();
    cust.send({ t: "request.message", body: "kova", clientMsgId: "k1" });
    expect(await waitMsg(cust, "error")).toMatchObject({ code: "RATE_LIMITED" });
    expect(await waitMsg(panel, "queue.alert")).toMatchObject({ kind: "rate_limited" });
    expect(metric('rs_request_messages_rejected_total{reason="tenant_rate"}')).toBe(before + 1);
    expect(await rowsOf(r.id)).toBe(0);
    expect(isOpen(cust)).toBe(true);
    cust.ws.close();
    panel.ws.close();
  });
});

describe("AC-255 geriye uyum (0.11.0 istemci — yetenek bildirmeyen soket)", () => {
  it("AC-255: yeteneksiz sokete yeni tipte 0 çerçeve; teknisyen POST → 409 CHAT_UNSUPPORTED; kapanışta request.chat yok", async () => {
    const { s, r } = await firm();
    const old = await reqWs(r.secret, false);
    await waitMsg(old, "request.state");
    tick();
    const res = await send(s, r.id, "Merhaba");
    expect(res.statusCode).toBe(409);
    expect(err(res).code).toBe("CHAT_UNSUPPORTED");
    expect((await list(s, r.id)).json<RequestMessageListResponse>().customerChat).toBe("UNSUPPORTED");
    const rej = await call(s, "POST", `/support-requests/${r.id}/reject`, { message: "Şu an müsait değiliz" });
    expect(rej.statusCode).toBe(204);
    await waitMsg(old, "request.closed");
    await old.closed;
    const seen = old.msgs.map((m) => (m as { t: string }).t);
    expect(seen.filter((x) => x === "request.message" || x === "request.messages" || x === "request.chat")).toEqual([]);
    expect(await rowsOf(r.id)).toBe(0);
  });

  it("S-P18-T1: yeteneksiz sokette request.message → 1008, session_messages satırı 0", async () => {
    const { r } = await firm();
    const old = await reqWs(r.secret, false);
    await waitMsg(old, "request.state");
    old.send({ t: "request.message", body: "Merhaba", clientMsgId: "x1" });
    expect((await old.closed).code).toBe(1008);
    expect(await rowsOf(r.id)).toBe(0);
  });

  it("S-P18-T1: yetenekli sokette şema dışı mesaj yine 1008; ret sonrası request.chat{enabled:false} sonra request.closed", async () => {
    const { s, r } = await firm();
    const cust = await reqWs(r.secret);
    await waitMsg(cust, "request.messages");
    await call(s, "POST", `/support-requests/${r.id}/reject`, { message: "Şu an müsait değiliz" });
    await waitMsg(cust, "request.closed");
    const order = cust.msgs.map((m) => (m as { t: string }).t);
    expect(order).toContain("request.chat");
    const r2 = await firm();
    const c2 = await reqWs(r2.r.secret);
    await waitMsg(c2, "request.messages");
    c2.send({ t: "request.message", body: "x", clientMsgId: "x", requestId: r.id });
    expect((await c2.closed).code).toBe(1008);
  });
});

describe("AC-255 saklama ve şifreleme (ADR-0025 m.1–m.2, S-P18-T2/T9)", () => {
  it("AC-255: body_enc düz metni içermez; AAD başka satıra taşınınca çözülmez → body null + decrypt metriği", async () => {
    const { s, r } = await firm();
    tick();
    const a = (await send(s, r.id, "Gizli içerik ALFA")).json<SendRequestMessageResponse>();
    tick();
    const b = (await send(s, r.id, "İkinci mesaj")).json<SendRequestMessageResponse>();
    const rowA = await db().sessionMessage.findUniqueOrThrow({ where: { id: a.id } });
    expect(Buffer.from(rowA.bodyEnc).includes(Buffer.from("ALFA"))).toBe(false);
    expect(rowA.bodyEnc[0]).toBeGreaterThan(0);
    // satıra bağlı AAD: doğru AAD çözer, başka satırın AAD'si çözmez
    expect(live.app.secrets.decrypt(rowA.bodyEnc, aadFor.sessionMessage(rowA.tenantId, r.id, a.id))).toBe("Gizli içerik ALFA");
    expect(() => live.app.secrets.decrypt(rowA.bodyEnc, aadFor.sessionMessage(rowA.tenantId, r.id, b.id))).toThrow();
    const before = metric('rs_crypto_decrypt_failures_total{table="session_messages"}');
    await testFixtureDb().$executeRaw`UPDATE session_messages SET body_enc = ${Buffer.from(rowA.bodyEnc)} WHERE id = ${b.id}`;
    const items = (await list(s, r.id)).json<RequestMessageListResponse>().items;
    expect(items.map((i) => i.body)).toEqual(["Gizli içerik ALFA", null]);
    expect(metric('rs_crypto_decrypt_failures_total{table="session_messages"}')).toBe(before + 1);
  });

  it("AC-255 saklama önce: INSERT hatası → iletim yok (yankı/panel yok), error INTERNAL; S-P18-T9 hata logunda gövde 0 kez", async () => {
    const { s, r } = await firm();
    const panel = await requestClient(live.app, live.base).panelWs(s.token);
    await waitMsg(panel, "queue.count");
    const cust = await reqWs(r.secret);
    await waitMsg(cust, "request.messages");
    const svc = live.app.requests.messages;
    const orig = svc.insertRow;
    svc.insertRow = () => Promise.reject(new Error("enjekte INSERT hatası"));
    try {
      tick();
      cust.send({ t: "request.message", body: "SIZINTI-GOVDE-123", clientMsgId: "fail-1" });
      expect(await waitMsg(cust, "error")).toMatchObject({ code: "INTERNAL" });
    } finally {
      svc.insertRow = orig;
    }
    await settle();
    expect(cust.msgs.some((m) => (m as { t: string }).t === "request.message")).toBe(false);
    expect(panel.msgs.some((m) => (m as { t: string }).t === "request.activity")).toBe(false);
    expect(await rowsOf(r.id)).toBe(0);
    const logs = logLines.join("");
    expect(logs).toContain("request_message_store");
    expect(logs).not.toContain("SIZINTI-GOVDE-123");
    cust.ws.close();
    panel.ws.close();
  });

  it("S-P18-T10: PENDING okuma audit'siz, rs_request_messages_read_total artar", async () => {
    const { t, s, r } = await firm();
    const before = metric("rs_request_messages_read_total");
    expect((await list(s, r.id)).statusCode).toBe(200);
    expect(metric("rs_request_messages_read_total")).toBe(before + 1);
    expect(await db().auditLog.count({ where: { tenantId: t.id, entityId: r.id } })).toBe(0);
  });
});

describe("AC-255 → AC-264 retention ve firma silme", () => {
  it("AC-255 retention: talep anonimleşince aynı TX'te mesaj satırı 0; sayaç purgedMessages", async () => {
    const t = await createTenant();
    await createRequestSettings(t.id);
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const now = new Date(clock.now());
    const old = await createRequestRow(t.id, { createdAt: new Date(now.getTime() - 200 * 86_400_000) });
    const young = await createRequestRow(t.id);
    for (const [rid, n] of [
      [old.id, 3],
      [young.id, 2],
    ] as const)
      await testFixtureDb().sessionMessage.createMany({
        data: Array.from({ length: n }, (_, i) => ({
          id: newId(),
          tenantId: t.id,
          requestId: rid,
          sender: "TECH",
          senderUserId: admin.id,
          clientMsgId: `r-${i}`,
          bodyEnc: new Uint8Array(31),
          bodyChars: 2,
        })),
      });
    // anonim olmayan talebin mesajı app ile silinemez (tetikleyici)
    await expect(db().sessionMessage.deleteMany({ where: { requestId: old.id } })).rejects.toThrow();
    const counts = { messages: 0 };
    expect(await anonymizeRequestsOf(live.app.requests, { tenantId: t.id, retentionDays: 90 }, now, counts)).toBe(1);
    expect(counts.messages).toBe(3);
    expect(await rowsOf(old.id)).toBe(0);
    expect(await rowsOf(young.id)).toBe(2);
    expect((await db().supportRequest.findUniqueOrThrow({ where: { id: old.id } })).anonymizedAt).not.toBeNull();
  });

  it("AC-242 regresyon (P18 MESSAGES): önizleme sayısı = silinen; firma silme sonrası session_messages ve business_holidays 0", async () => {
    const saUser = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const sa = await loginStepUp(live.app, saUser);
    const f = await seedPurgeTenant(live.app);
    await makeEligible(live.app, sa, f.tenantId);
    const url = `/api/v1/admin/tenants/${f.tenantId}/purge`;
    const p = await live.app.inject({ method: "POST", url, headers: sa.headers, payload: { dryRun: true } });
    expect(p.statusCode, p.body).toBe(200);
    const pv = p.json<TenantPurgePreviewResponse>();
    expect(pv.counts.MESSAGES).toBe(1);
    const sc = await live.app.inject({
      method: "POST",
      url,
      headers: sa.headers,
      payload: { dryRun: false, previewId: pv.previewId, confirmName: f.tenantName },
    });
    expect(sc.statusCode, sc.body).toBe(202);
    const jobId = sc.json<TenantPurgeScheduledResponse>().jobId;
    await makeDue(jobId);
    const runner = new TenantPurgeRunner({
      db: testDb(),
      store: live.app.uploads,
      ledger: live.app.erasureLedger,
      metrics: live.app.metrics,
      log: live.app.log,
    });
    expect(await runner.runJob(jobId)).toBe("done");
    const rows = await tenantRowCounts(f.tenantId);
    expect(rows.session_messages).toBe(0);
    expect(rows.business_holidays).toBe(0);
    const st = await live.app.inject({ method: "GET", url, headers: sa.headers });
    expect(st.json<{ counts: Record<string, number> }>().counts.MESSAGES).toBe(pv.counts.MESSAGES);
  });
});

describe("S-P18-T2 cli crypto:check-retire / crypto:rewrap (migrator)", () => {
  const k7 = Buffer.alloc(32, 7);
  const k8 = Buffer.alloc(32, 8);
  const keysEnv = `v7:${k7.toString("base64")},v8:${k8.toString("base64")}`;
  const io = () => {
    const o = { out: "", err: "" };
    return { o, io: { out: (s: string) => void (o.out += s), err: (s: string) => void (o.err += s) } };
  };
  const env = () => ({ MIGRATE_DATABASE_URL: process.env.TEST_MIGRATE_DATABASE_URL, APP_ENCRYPTION_KEYS: keysEnv });

  it("S-P18-T2: v7 satırları check-retire'da sayılır; --dry yazmaz; rewrap sonrası 0, aynı AAD ile v8 çözer; audit crypto.rewrap", async () => {
    const { t, admin, r } = await firm();
    const v7 = new SecretBox(new Map([[7, k7]]));
    const ids = [newId(), newId()];
    for (const [i, id] of ids.entries())
      await testFixtureDb().sessionMessage.create({
        data: {
          id,
          tenantId: t.id,
          requestId: r.id,
          sender: "TECH",
          senderUserId: admin.id,
          clientMsgId: `k-${i}`,
          bodyEnc: v7.encrypt(`eski anahtar ${i}`, aadFor.sessionMessage(t.id, r.id, id)),
          bodyChars: 14,
        },
      });
    const c1 = io();
    expect(await cryptoMain(["crypto:check-retire", "7"], env(), c1.io)).toBe(1);
    expect(c1.o.out).toContain("satir=2");
    const dry = io();
    expect(await cryptoMain(["crypto:rewrap", "session_messages", "--from", "7", "--dry"], env(), dry.io)).toBe(0);
    expect(dry.o.out).toContain("satir=2");
    expect((await db().sessionMessage.findUniqueOrThrow({ where: { id: ids[0] } })).bodyEnc[0]).toBe(7);
    const real = io();
    expect(await cryptoMain(["crypto:rewrap", "session_messages", "--from", "7"], env(), real.io)).toBe(0);
    expect(real.o.out).toContain("hedef=8");
    const c2 = io();
    expect(await cryptoMain(["crypto:check-retire", "7"], env(), c2.io)).toBe(0);
    const v8 = new SecretBox(new Map([[8, k8]]));
    for (const [i, id] of ids.entries()) {
      const row = await db().sessionMessage.findUniqueOrThrow({ where: { id } });
      expect(row.bodyEnc[0]).toBe(8);
      expect(v8.decrypt(row.bodyEnc, aadFor.sessionMessage(t.id, r.id, id))).toBe(`eski anahtar ${i}`);
    }
    expect(real.o.out + real.o.err + dry.o.out).not.toContain("eski anahtar");
    const audit = await db().auditLog.findMany({
      where: { action: "crypto.rewrap", username: CLI_ACTOR },
      orderBy: { id: "desc" },
      take: 2,
    });
    expect(audit.map((a) => a.newValue)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "session_messages", fromVer: 7, toVer: 8, rows: 2, failed: 0, dry: false }),
      ]),
    );
  });

  it("S-P18-T2: kullanım hataları — migrator URL yok, bilinmeyen tablo, halkada olmayan / güncel sürüm → 2", async () => {
    const c = io();
    expect(await cryptoMain(["crypto:check-retire", "7"], {}, c.io)).toBe(2);
    expect(await cryptoMain(["crypto:rewrap", "users", "--from", "7"], env(), c.io)).toBe(2);
    expect(await cryptoMain(["crypto:rewrap", "session_messages", "--from", "9"], env(), c.io)).toBe(2);
    expect(await cryptoMain(["crypto:rewrap", "session_messages", "--from", "8"], env(), c.io)).toBe(2);
    expect(await cryptoMain(["crypto:check-retire"], env(), c.io)).toBe(2);
  });
});
