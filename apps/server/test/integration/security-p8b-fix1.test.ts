// P8b-1 düzeltme turu 1 — güvenlik/QA bulguları: S8b-1 (WhatsApp yönlendirme izlenmez), S8b-2 (eşzamanlı iki /ws/guest),
// S8b-3 (request.created audit'inde IP yok), QA-P8b-11 (guest.admitted{via:"request"} müşteri adı taşımaz; AC-160).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { netKey } from "../../src/lib/ip.ts";
import { WhatsappNotifier } from "../../src/notify/whatsapp.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import { createTenant, createUser, loginAs, ORIGIN, testDb } from "../helpers/app.ts";
import { createRequestSettings, requestClient, waitMsg } from "../helpers/requests.ts";
import { startLive, TECH_PERMS, type Live } from "../helpers/signal-flow.ts";
import { connect, FakeClock, techHeaders } from "../helpers/ws.ts";

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const REQ_PERMS = { ...TECH_PERMS, "support_requests.view": true, "support_requests.accept": true };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let live: Live | undefined;
const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await live?.close();
  live = undefined;
  for (const s of servers.splice(0)) await s.close();
});

/** Basit HTTP sunucusu (127.0.0.1, rastgele port); her isteğin yolunu kaydeder. */
async function httpServer(handle: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; paths: string[] }> {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url ?? "");
    req.resume();
    req.on("end", () => handle(req, res));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  servers.push({
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  });
  return { url: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`, paths };
}

describe("S8b-1 WhatsApp istemcisi yönlendirme izlemez", () => {
  it("AC-150 / S8b-1: servis 307 döndürürse gönderim başarısız; yönlendirilen adrese hiç istek gitmez", async () => {
    const target = await httpServer((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end("{}"));
    const redirector = await httpServer((req, res) => res.writeHead(307, { location: `${target.url}${req.url ?? "/"}` }).end());
    const t = await createTenant();
    const clock = new FakeClock();
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const n = new WhatsappNotifier({
      url: redirector.url,
      production: false,
      publicBaseUrl: ORIGIN,
      db: testDb(),
      log,
      metrics: createMetrics(),
      clock,
    });
    expect(await n.test("+905321112233")).toMatchObject({ ok: false });
    n.notifyNewRequest(t.id, "Firma", ["+905321112234"], "123456");
    await expect.poll(() => redirector.paths.filter((p) => p === "/send-message").length).toBe(1);
    await sleep(100);
    expect(redirector.paths).toEqual(["/test-send", "/send-message"]);
    expect(target.paths).toEqual([]);
    n.close();
  });
});

describe("S8b-3 / QA-P8b-11 talep audit'leri", () => {
  async function acceptedTicket() {
    live = await startLive({ env: PROXY });
    const rc = requestClient(live.app, live.base);
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const ip = "198.51.100.91";
    const c = (await rc.createReq(ref, ip)).json<{ requestId: string; requestSecret: string }>();
    const ws = await rc.reqWs(c.requestSecret);
    await waitMsg(ws, "request.state");
    const tech = await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS });
    const s = await loginAs(live.app, tech);
    const acc = await rc.accept(s.headers, c.requestId);
    expect(acc.statusCode).toBe(200);
    const { wsTicket } = await waitMsg<{ wsTicket: string }>(ws, "request.accepted");
    return { rc, ip, c, ws, tech, wsTicket, sessionId: acc.json<{ sessionId: string }>().sessionId };
  }

  it("AC-160 / S8b-3 / S-P13a-1: request.created audit newValue'da müşteri IP'si yok (ip_address sütununda yalnız /24 öneki), clientVersion var", async () => {
    const { ip, c } = await acceptedTicket();
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: c.requestId, action: "request.created" } });
    expect(a.newValue).toEqual({
      clientVersion: "0.9.0",
      via: "ref",
      customerId: null,
      // P19 (§8c.7): kaynak + seçilen bildirim kanalları (AGENT'ta hep kapalı)
      source: "AGENT",
      notify: { sms: false, whatsapp: false, email: false },
    }); // P8c: via + customerId (mimari-e10 §8)
    expect(JSON.stringify(a.newValue)).not.toContain(ip);
    // S-P13a-1: müşteri kaydında tam IP değil ağ öneki (/24), UA yok
    expect(a.ipAddress).toBe(netKey(ip));
    expect(a.ipAddress).not.toBe(ip);
    expect(a.userAgent).toBeNull();
  });

  it('AC-160 / QA-P8b-11: guest.admitted{via:"request"} yalnız requestId/acceptedBy + onay özeti taşır; müşteri adı yok', async () => {
    const { rc, c, tech, wsTicket, sessionId } = await acceptedTicket();
    const g = await rc.guestWs(wsTicket);
    await waitMsg(g, "hello");
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: sessionId, action: "guest.admitted" } });
    expect(a.newValue).toMatchObject({ via: "request", requestId: c.requestId, acceptedBy: tech.id });
    expect(Object.keys(a.newValue as object).sort()).toEqual([
      "acceptedBy",
      "consentSha256",
      "consentTextId",
      "guestKind",
      "requestId",
      "via",
    ]);
    expect(JSON.stringify(a.newValue)).not.toContain("Ayşe");
  });
});

describe("S8b-2 ön-kabullü misafirde eşzamanlı iki /ws/guest", () => {
  it("AC-154 / S8b-2: eski ve yeni kuşak ticket'la iki bağlantı admit'e yarışır → tek kazanan hello alır, kaybeden yalnız kendi soketiyle kapanır; tek admit", async () => {
    live = await startLive({ env: PROXY });
    const rc = requestClient(live.app, live.base);
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const c = (await rc.createReq(ref, "198.51.100.92")).json<{ requestId: string; requestSecret: string }>();
    const ws1 = await rc.reqWs(c.requestSecret);
    await waitMsg(ws1, "request.state");
    const tech = await createUser({ tenantId: t.id, role: "USER", perms: REQ_PERMS });
    const s = await loginAs(live.app, tech);
    const acc = await rc.accept(s.headers, c.requestId);
    expect(acc.statusCode).toBe(200);
    const { sessionId } = acc.json<{ sessionId: string }>();
    const { wsTicket: ticket1 } = await waitMsg<{ wsTicket: string }>(ws1, "request.accepted");

    // A'nın admit TX'i oturum satırı kilidinde beklerken (yüklü DB benzetimi) yeni kuşak ticket'la B bağlanır.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let onLocked!: () => void;
    const locked = new Promise<void>((r) => (onLocked = r));
    const holder = testDb().$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM support_sessions WHERE id = ${sessionId} FOR UPDATE`;
        onLocked();
        await gate;
      },
      { timeout: 20_000 },
    );
    await locked;
    try {
      const a = await rc.guestWs(ticket1);
      await sleep(200); // A admit'e girdi (TX kilitte bekliyor)
      const ws2 = await rc.reqWs(c.requestSecret); // /ws/request yeniden bağlanır → gen2
      const { wsTicket: ticket2 } = await waitMsg<{ wsTicket: string }>(ws2, "request.accepted");
      expect(ticket2).not.toBe(ticket1);
      const b = await rc.guestWs(ticket2);
      expect(await b.closed).toMatchObject({ code: 1008, reason: "conflict" }); // kaybeden yalnız kendi soketi
      release();
      await holder;
      expect(await waitMsg(a, "hello")).toMatchObject({ role: "guest", guestKind: "AGENT" }); // kazanan A, soketi açık
      expect(a.ws.readyState).toBe(a.ws.OPEN);
      expect(b.msgs.some((m) => m.t === "hello")).toBe(false);
      expect(await testDb().auditLog.count({ where: { entityId: sessionId, action: "guest.admitted" } })).toBe(1);
      expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("ACTIVE");
      // admitted misafirin soketi A: oturumdaki mesajlar A'ya akar (B'ye değil) — teknisyenin bağlanmasıyla peer.joined
      const techWs = await connect(`${live.base}/ws/tech?sessionId=${sessionId}`, ["rs.v1"], techHeaders(s.token, ORIGIN));
      await waitMsg(techWs, "hello");
      expect(await waitMsg(a, "peer.joined")).toMatchObject({ role: "tech" });
      techWs.ws.close();
      a.ws.close();
    } finally {
      release();
      await holder.catch(() => undefined);
    }
  }, 30_000);
});

describe("AC-143 bekleyen sınır aşımı audit'i (düzeltme turu 1)", () => {
  it("AC-143 / AC-160: IP başına 3 aşımı pending.ip/ip, önek (/24) başına 10 aşımı pending.prefix/prefix olarak ayrı audit'lenir", async () => {
    live = await startLive({ env: PROXY });
    const rc = requestClient(live.app, live.base);
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const rateAudits = async () =>
      (await testDb().auditLog.findMany({ where: { tenantId: t.id, action: "request.rate_limited" }, orderBy: { id: "asc" } })).map(
        (a) => a.newValue,
      );

    for (let i = 0; i < 3; i++) expect((await rc.createReq(ref, "198.51.131.7")).statusCode).toBe(201);
    expect((await rc.createReq(ref, "198.51.131.7")).statusCode).toBe(429);
    expect(await rateAudits()).toEqual([{ bucket: "pending.ip", keyType: "ip" }]);

    for (let i = 10; i < 17; i++) expect((await rc.createReq(ref, `198.51.131.${i}`)).statusCode).toBe(201); // /24'te 3 + 7 = 10 bekleyen
    const over = await rc.createReq(ref, "198.51.131.50");
    expect(over.statusCode).toBe(429);
    expect(await rateAudits()).toEqual([
      { bucket: "pending.ip", keyType: "ip" },
      { bucket: "pending.prefix", keyType: "prefix" },
    ]);
  });
});
