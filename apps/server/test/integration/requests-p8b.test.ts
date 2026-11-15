// P8b-1 destek talepleri — gerçek MySQL + dinleyen sunucu. AC-129..161 (sunucu kısmı); mimari-e9 §13, mimari-protokol §5.
import { newSecretToken } from "../../src/lib/ids.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSupportSessionRow, createTenant, createUser, loginAs, ORIGIN, testDb, type Session, type TestUser } from "../helpers/app.ts";
import { createRequestRow, createRequestSettings, retryNotReady } from "../helpers/requests.ts";
import { startLive, TECH_PERMS, type Live } from "../helpers/signal-flow.ts";
import { connect, techHeaders } from "../helpers/ws.ts";

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const REQ_PERMS = { ...TECH_PERMS, "support_requests.view": true, "support_requests.accept": true };
const errCode = (r: { json: <T>() => T }) => r.json<{ error: { code: string } }>().error.code;

let live: Live;
beforeEach(async () => {
  live = await startLive({ env: PROXY });
});
afterEach(async () => live.close());

let ipSeq = 0;
const nextIp = () => `203.0.${113 + (Math.floor(ipSeq / 250) % 3)}.${(ipSeq++ % 250) + 1}`;
const instance = () => newSecretToken().slice(0, 22);

async function tenantWithRef(o: { trustedCidrs?: string[] } = {}) {
  const t = await createTenant();
  const ref = await createRequestSettings(t.id, o);
  return { tenantId: t.id, ref };
}

async function tenantInfo(ref: string, ip = nextIp()) {
  return live.app.inject({ method: "GET", url: `/api/v1/public/requests/tenant?ref=${ref}`, headers: { "x-forwarded-for": ip } });
}

async function createReq(ref: string, o: { ip?: string; version?: string; consentTextId?: string; instance?: string } = {}) {
  const ip = o.ip ?? nextIp();
  const consentTextId = o.consentTextId ?? (await tenantInfo(ref, ip)).json<{ consentText: { id: string } }>().consentText.id;
  return live.app.inject({
    method: "POST",
    url: "/api/v1/public/requests",
    headers: { "x-forwarded-for": ip },
    payload: {
      ref,
      clientInstanceId: o.instance ?? instance(),
      clientVersion: o.version ?? "0.9.0",
      customerName: "Ayşe Müşteri",
      phone: "0532 123 45 67",
      description: "Yazıcı çalışmıyor lütfen yardım",
      consentTextId,
      consentAccepted: true,
    },
  });
}

async function tech(tenantId: string, perms: Record<string, boolean> = REQ_PERMS): Promise<{ user: TestUser; s: Session }> {
  const user = await createUser({ tenantId, role: "USER", perms });
  return { user, s: await loginAs(live.app, user) };
}

const accept = (s: Session, id: string) =>
  live.app.inject({ method: "POST", url: `/api/v1/support-requests/${id}/accept`, headers: s.headers, payload: {} });
const reqWs = (secret: string, headers: Record<string, string> = {}) =>
  connect(`${live.base}/ws/request`, ["rs.v1", `rs.req.${secret}`], headers);

describe("P8b-1 public talep uçları", () => {
  it("AC-134/135: talep oluşturulur (201, sır yalnız yanıtta), DB'de PENDING + audit PII'siz", async () => {
    const { tenantId, ref } = await tenantWithRef();
    const info = await tenantInfo(ref);
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({ waitMinutes: 30, consentText: { version: 1 } });
    const r = await createReq(ref);
    expect(r.statusCode).toBe(201);
    const body = r.json<{ requestId: string; requestSecret: string; requestCode: string; position: number }>();
    expect(body.requestSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.position).toBe(1);
    const row = await testDb().supportRequest.findUniqueOrThrow({ where: { id: body.requestId } });
    expect(row).toMatchObject({ tenantId, status: "PENDING", customerPhone: "+905321234567", networkMatch: "NONE", knownDevice: false });
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { entityId: body.requestId, action: "request.created" } });
    const text = JSON.stringify(audit, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v));
    expect(text).not.toContain("Ayşe");
    expect(text).not.toContain("5321234567");
    expect(text).not.toContain(body.requestSecret);
  });

  it("AC-132: bilinmeyen ve bozuk ref aynı 404 (oracle yok); tarayıcı Origin'i ile talep 403", async () => {
    const unknown = await tenantInfo("abcdefghijklmnop");
    const malformed = await tenantInfo("x");
    expect(unknown.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(404);
    const strip = (b: string) => b.replace(/"requestId":"[0-9A-Z]{26}"/, "");
    expect(strip(unknown.body)).toBe(strip(malformed.body));
    const { ref } = await tenantWithRef();
    const consentTextId = (await tenantInfo(ref)).json<{ consentText: { id: string } }>().consentText.id;
    const browser = await live.app.inject({
      method: "POST",
      url: "/api/v1/public/requests",
      headers: { origin: ORIGIN },
      payload: { ref, consentTextId },
    });
    expect(browser.statusCode).toBe(403);
    const dl = await live.app.inject({
      method: "GET",
      url: "/api/v1/public/agent/request-download?ref=abcdefghijklmnop",
      headers: { "x-forwarded-for": nextIp() },
    });
    expect(dl.statusCode).toBe(404);
    expect(strip(dl.body)).toBe(strip(unknown.body));
  });

  it("AC-139: aynı istemci örneğinden ikinci bekleyen talep 409 REQUEST_PENDING", async () => {
    const { ref } = await tenantWithRef();
    const inst = instance();
    expect((await createReq(ref, { instance: inst })).statusCode).toBe(201);
    const again = await createReq(ref, { instance: inst });
    expect(again.statusCode).toBe(409);
    expect(errCode(again)).toBe("REQUEST_PENDING");
  });

  it("AC-133 / §13.4: MIN_AGENT_VERSION altındaki istemci 426 CLIENT_OUTDATED", async () => {
    await live.close();
    live = await startLive({ env: { ...PROXY, MIN_AGENT_VERSION: "1.0.0" } });
    const { ref } = await tenantWithRef();
    const r = await createReq(ref, { version: "0.9.0" });
    expect(r.statusCode).toBe(426);
    expect(errCode(r)).toBe("CLIENT_OUTDATED");
  });

  it("AC-141: iptal ucu her durumda 204; geçerli sır → CANCELLED", async () => {
    const { ref } = await tenantWithRef();
    const c = (await createReq(ref)).json<{ requestId: string; requestSecret: string }>();
    const fake = await live.app.inject({
      method: "POST",
      url: "/api/v1/public/requests/cancel",
      headers: { "x-forwarded-for": nextIp() },
      payload: { requestSecret: newSecretToken() },
    });
    expect(fake.statusCode).toBe(204);
    const ok = await live.app.inject({
      method: "POST",
      url: "/api/v1/public/requests/cancel",
      headers: { "x-forwarded-for": nextIp() },
      payload: { requestSecret: c.requestSecret },
    });
    expect(ok.statusCode).toBe(204);
    expect((await testDb().supportRequest.findUniqueOrThrow({ where: { id: c.requestId } })).status).toBe("CANCELLED");
  });

  it("AC-143: 60 eşzamanlı talepte (503 → Retry-After ile yeniden deneme) tam 50 kabul edilir, kalanlar 429 QUEUE_FULL, hiç 500 yok", async () => {
    const { ref } = await tenantWithRef({ trustedCidrs: ["203.0.112.0/22"] }); // ayrıcalıklı kaynak: 40 eşiği ve IP/net sınırları uygulanmaz
    const consentTextId = (await tenantInfo(ref)).json<{ consentText: { id: string } }>().consentText.id;
    // Kapı (S8b-5) ve yük altında kontrollü 503 NOT_READY gelebilir; istemci gibi Retry-After'a uyup yeniden dener.
    const res = await Promise.all(
      Array.from({ length: 60 }, (_, i) => retryNotReady(() => createReq(ref, { consentTextId, ip: `203.0.113.${(i % 200) + 1}` }))),
    );
    const codes = res.map((r) => r.statusCode);
    expect(codes.filter((c) => c >= 500)).toEqual([]);
    expect(codes.filter((c) => c === 201)).toHaveLength(50);
    expect(codes.filter((c) => c === 429)).toHaveLength(10);
    expect(res.filter((r) => r.statusCode === 429).every((r) => errCode(r) === "QUEUE_FULL")).toBe(true);
    const positions = res.filter((r) => r.statusCode === 201).map((r) => r.json<{ position: number }>().position);
    expect(new Set(positions).size).toBe(50);
  }, 60_000);
});

describe("P8b-1 kabul / ret", () => {
  it("AC-153: çift kabul 50 tekrarda tek kazanan; kaybeden 409 REQUEST_TAKEN; tek oturum", async () => {
    const t = await createTenant();
    const techs = await Promise.all(Array.from({ length: 10 }, () => tech(t.id)));
    for (let i = 0; i < 50; i++) {
      const { id } = await createRequestRow(t.id);
      const a = techs[i % 10];
      const b = techs[(i + 5) % 10];
      if (!a || !b) throw new Error("tech yok");
      const [ra, rb] = await Promise.all([accept(a.s, id), accept(b.s, id)]);
      const codes = [ra.statusCode, rb.statusCode].sort();
      expect(codes).toEqual([200, 409]);
      expect(errCode(ra.statusCode === 409 ? ra : rb)).toBe("REQUEST_TAKEN");
      const sessions = await testDb().supportSession.findMany({ where: { requestId: id } });
      expect(sessions).toHaveLength(1);
      // açık oturum sınırına takılmamak için kazananın oturumunu süresi dolmuş say
      await testDb().supportSession.updateMany({
        where: { requestId: id },
        data: { createdAt: new Date(Date.now() - 61_000), expiresAt: new Date(Date.now() - 1000) },
      });
    }
  }, 120_000);

  it("AC-153: açık oturum sınırında kabul 409 OPEN_SESSION_LIMIT, talep PENDING kalır", async () => {
    const t = await createTenant();
    const x = await tech(t.id);
    for (let i = 0; i < 3; i++) await createSupportSessionRow({ tenantId: t.id, technicianId: x.user.id });
    const { id } = await createRequestRow(t.id);
    const r = await accept(x.s, id);
    expect(r.statusCode).toBe(409);
    expect(errCode(r)).toBe("OPEN_SESSION_LIMIT");
    expect((await testDb().supportRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
  });

  it("AC-147/148: yetkisiz kullanıcı 403; başka tenant'ın talebi 404; liste yalnız kendi tenant'ı", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const ra = await createRequestRow(a.id);
    const rb = await createRequestRow(b.id);
    const noPerm = await tech(a.id, TECH_PERMS);
    expect((await accept(noPerm.s, ra.id)).statusCode).toBe(403);
    expect((await live.app.inject({ method: "GET", url: "/api/v1/support-requests", headers: noPerm.s.headers })).statusCode).toBe(403);
    const bt = await tech(b.id);
    expect((await accept(bt.s, ra.id)).statusCode).toBe(404);
    expect((await live.app.inject({ method: "GET", url: `/api/v1/support-requests/${ra.id}`, headers: bt.s.headers })).statusCode).toBe(
      404,
    );
    const list = await live.app.inject({ method: "GET", url: "/api/v1/support-requests", headers: bt.s.headers });
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain(rb.id);
    expect(list.body).not.toContain(ra.id);
    const count = await live.app.inject({ method: "GET", url: "/api/v1/support-requests/count", headers: bt.s.headers });
    expect(count.json()).toEqual({ pending: 1 });
  });

  it("AC-157: ret mesajında iletişim bilgisi 400; geçerli ret → REJECTED ve /ws/request request.closed", async () => {
    const { tenantId, ref } = await tenantWithRef();
    const c = (await createReq(ref)).json<{ requestId: string; requestSecret: string }>();
    const ws = await reqWs(c.requestSecret);
    await ws.waitFor("request.state" as never);
    const x = await tech(tenantId);
    const bad = await live.app.inject({
      method: "POST",
      url: `/api/v1/support-requests/${c.requestId}/reject`,
      headers: x.s.headers,
      payload: { message: "Beni 0532 123 45 67'den arayın" },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await live.app.inject({
      method: "POST",
      url: `/api/v1/support-requests/${c.requestId}/reject`,
      headers: x.s.headers,
      payload: { message: "Şu an müsait değiliz" },
    });
    expect(ok.statusCode).toBe(204);
    const closed = (await ws.waitFor("request.closed" as never)) as unknown as { status: string; message: string };
    expect(closed).toMatchObject({ status: "REJECTED", message: "Şu an müsait değiliz" });
    expect((await ws.closed).code).toBe(1000);
    const again = await accept(x.s, c.requestId);
    expect(again.statusCode).toBe(409);
    expect(errCode(again)).toBe("REQUEST_CLOSED");
  });
});

describe("P8b-1 WebSocket kanalları", () => {
  it("AC-139/154: sahte sır /ws/request 403; geçerli sır request.state alır; kabulde ticket ile /ws/guest ön-kabullü hello", async () => {
    const { tenantId, ref } = await tenantWithRef();
    await expect(reqWs(newSecretToken())).rejects.toThrow("HTTP 403");
    const c = (await createReq(ref)).json<{ requestId: string; requestSecret: string; requestCode: string }>();
    await expect(reqWs(c.requestSecret, { origin: ORIGIN })).rejects.toThrow("HTTP 403"); // tarayıcı değil, yalnız istemci
    const ws = await reqWs(c.requestSecret);
    const st = (await ws.waitFor("request.state" as never)) as unknown as { position: number };
    expect(st.position).toBe(1);
    const x = await tech(tenantId);
    const acc = await accept(x.s, c.requestId);
    expect(acc.statusCode).toBe(200);
    const { sessionId } = acc.json<{ sessionId: string }>();
    const m = (await ws.waitFor("request.accepted" as never)) as unknown as { wsTicket: string; techVerifyCode: string };
    expect(m.techVerifyCode).toMatch(/^\d{4}$/);

    // /ws/guest: talep sırrı ticket yerine kullanılamaz; sahte ticket reddedilir
    await expect(connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${c.requestSecret}`])).rejects.toThrow(/HTTP 40[13]/);
    await expect(connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${newSecretToken()}`])).rejects.toThrow(/HTTP 40[13]/);

    const techWs = await connect(`${live.base}/ws/tech?sessionId=${sessionId}`, ["rs.v1"], techHeaders(x.s.token, ORIGIN));
    await techWs.waitFor("hello");
    const guest = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${m.wsTicket}`]);
    const hello = await guest.waitFor("hello");
    expect(hello).toMatchObject({ role: "guest", sessionId, guestKind: "AGENT" });
    await techWs.waitFor("peer.joined");
    const sess = await testDb().supportSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(sess).toMatchObject({ status: "ACTIVE", requestId: c.requestId });
    // ticket tek kullanımlık
    await expect(connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${m.wsTicket}`])).rejects.toThrow(/HTTP 40[13]/);
  });

  it("AC-154: başka talebin ticket'ı / sırrı bu talebin oturumuna bağlanamaz; yeniden bağlanan istemci yeni ticket alır, eskisi geçersiz", async () => {
    const { tenantId, ref } = await tenantWithRef();
    const c = (await createReq(ref)).json<{ requestId: string; requestSecret: string }>();
    const ws1 = await reqWs(c.requestSecret);
    await ws1.waitFor("request.state" as never);
    const x = await tech(tenantId);
    expect((await accept(x.s, c.requestId)).statusCode).toBe(200);
    const t1 = (await ws1.waitFor("request.accepted" as never)) as unknown as { wsTicket: string };
    const ws2 = await reqWs(c.requestSecret); // yeniden bağlanma: eski soket 4409, yeni ticket
    expect((await ws1.closed).code).toBe(4409);
    const t2 = (await ws2.waitFor("request.accepted" as never)) as unknown as { wsTicket: string };
    expect(t2.wsTicket).not.toBe(t1.wsTicket);
    await expect(connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${t1.wsTicket}`])).rejects.toThrow(/HTTP 40[13]/);
  });

  it("AC-141: /ws/request normal kapanış (1000) talebi iptal eder", async () => {
    const { ref } = await tenantWithRef();
    const c = (await createReq(ref)).json<{ requestId: string; requestSecret: string }>();
    const ws = await reqWs(c.requestSecret);
    await ws.waitFor("request.state" as never);
    ws.ws.close(1000);
    await ws.closed;
    for (let i = 0; i < 40; i++) {
      if ((await testDb().supportRequest.findUniqueOrThrow({ where: { id: c.requestId } })).status !== "PENDING") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const row = await testDb().supportRequest.findUniqueOrThrow({ where: { id: c.requestId } });
    expect(row).toMatchObject({ status: "CANCELLED", cancelReason: "CUSTOMER" });
  });

  it("AC-146/147/148: /ws/panel yetkisiz 403; yetkili queue.count + request.new alır (networkMatch/knownDevice); logout → 4401", async () => {
    const { tenantId, ref } = await tenantWithRef();
    const noPerm = await tech(tenantId, TECH_PERMS);
    await expect(connect(`${live.base}/ws/panel`, ["rs.v1"], techHeaders(noPerm.s.token, ORIGIN))).rejects.toThrow("HTTP 403");
    await expect(connect(`${live.base}/ws/panel`, ["rs.v1"], { origin: ORIGIN })).rejects.toThrow("HTTP 403");
    const x = await tech(tenantId);
    const other = await tech((await createTenant()).id);
    const panel = await connect(`${live.base}/ws/panel`, ["rs.v1"], techHeaders(x.s.token, ORIGIN));
    const otherPanel = await connect(`${live.base}/ws/panel`, ["rs.v1"], techHeaders(other.s.token, ORIGIN));
    expect(await panel.waitFor("queue.count" as never)).toMatchObject({ pending: 0 });
    await otherPanel.waitFor("queue.count" as never);
    const c = (await createReq(ref)).json<{ requestId: string }>();
    const n = (await panel.waitFor("request.new" as never)) as unknown as Record<string, unknown>;
    expect(n).toMatchObject({ id: c.requestId, networkMatch: "NONE", knownDevice: false, customerName: "Ayşe Müşteri" });
    expect(n).not.toHaveProperty("phone");
    await new Promise((r) => setTimeout(r, 100));
    expect(otherPanel.msgs.some((m) => (m as { t: string }).t === "request.new")).toBe(false); // tenant izolasyonu
    await live.app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: x.s.headers });
    expect((await panel.closed).code).toBe(4401);
  });
});

describe("P8b-1 süpürücü / anonimleştirme / geçmiş", () => {
  it("AC-142: süresi dolan PENDING talep EXPIRED olur", async () => {
    const t = await createTenant();
    const { id } = await createRequestRow(t.id, { createdAt: new Date(Date.now() - 31 * 60_000) });
    const { sweepRequests } = await import("../../src/requests/jobs.ts");
    await sweepRequests(live.app.requests);
    expect((await testDb().supportRequest.findUniqueOrThrow({ where: { id } })).status).toBe("EXPIRED");
  });

  it("AC-159: kapanmış eski talepte kişisel veri anonimleştirilir", async () => {
    const t = await createTenant();
    const old = new Date(Date.now() - 400 * 86_400_000); // varsayılan retention_days 365
    const { id } = await createRequestRow(t.id, { createdAt: old });
    await testDb().supportRequest.update({ where: { id }, data: { status: "EXPIRED", closedAt: old } });
    const { anonymizeRequests } = await import("../../src/requests/jobs.ts");
    await anonymizeRequests(live.app.requests);
    const row = await testDb().supportRequest.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ customerName: null, customerPhone: null, description: null, ip: null });
    expect(row.anonymizedAt).not.toBeNull();
  });

  it("AC-158: talepten açılan oturum geçmişte source=REQUEST ve waitSec ile döner", async () => {
    const t = await createTenant();
    const x = await tech(t.id);
    const { id } = await createRequestRow(t.id, { createdAt: new Date(Date.now() - 90_000) });
    const { sessionId } = (await accept(x.s, id)).json<{ sessionId: string }>();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN", perms: { "sessions.view": true, "session_history.view": true } });
    const as = await loginAs(live.app, admin);
    const list = await live.app.inject({ method: "GET", url: "/api/v1/sessions?source=REQUEST", headers: as.headers });
    expect(list.statusCode).toBe(200);
    const item = list.json<{ items: { id: string; source: string; waitSec: number | null }[] }>().items.find((i) => i.id === sessionId);
    expect(item?.source).toBe("REQUEST");
    expect(item?.waitSec).toBeGreaterThanOrEqual(89);
    const detail = await live.app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/history`, headers: as.headers });
    expect(detail.json<{ request: { id: string } | null }>().request).toMatchObject({ id });
  });
});
