// P14a A3 entegrasyon (gerçek MySQL): AC-208 (kod kapısı metriği /metrics'te), AC-209 (kapı 503'ünde kova tüketilmez),
// AC-210 (/ws/request güvenilen CIDR wsUpgrade muafiyeti), AC-211/212 (MySQL "TLS gerekli" testi → `tls` + metrik),
// AC-216 (/ws/panel oturum başına 30/dk → upgrade kabul + close 4429 `retry=`).
// system_settings satırına YAZMAZ (MySQL testi yalnız denemedir); satır yazan testler p14a-a3-settings (seri projede).
import { createServer, type Server, type Socket } from "node:net";
import { parsePanelRetry, WS_REQUEST_CLOSE } from "@remote/contracts/ws-request";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ipKey } from "../../src/lib/ip.ts";
import { REQUEST_GATE } from "../../src/requests/service.ts";
import { createTenant, createUser, loginAs, ORIGIN, testDb, type Session } from "../helpers/app.ts";
import { createRequestRow, createRequestSettings, requestClient } from "../helpers/requests.ts";
import { FAKE_METRICS_TOKEN } from "../helpers/secrets.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { connect, techHeaders } from "../helpers/ws.ts";

const ENV = { TRUSTED_PROXY_CIDR: "127.0.0.1/32", METRICS_TOKEN: FAKE_METRICS_TOKEN };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let live: Live;
beforeAll(async () => {
  live = await startLive({ env: ENV });
});
afterAll(async () => live.close());

const metrics = async (): Promise<string> =>
  (await live.app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${FAKE_METRICS_TOKEN}` } })).body;
const statusOf = async (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "open",
    (e: unknown) => (e instanceof Error ? e.message : "?"),
  );

/** Ayar satırı kilidini serbest bırakılana dek tutar (security-p8b-fix2 kalıbı). */
function holdSettingsLock(tenantId: string): { locked: Promise<void>; release: () => void; done: Promise<unknown> } {
  let onLocked!: () => void;
  let release!: () => void;
  const locked = new Promise<void>((r) => (onLocked = r));
  const free = new Promise<void>((r) => (release = r));
  const done = testDb().$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT tenant_id FROM tenant_request_settings WHERE tenant_id = ${tenantId} FOR UPDATE`;
      onLocked();
      await free;
    },
    { timeout: 30_000 },
  );
  return { locked, release, done };
}

describe("AC-208: kod denemesi kapısı metriği", () => {
  it("AC-208: aynı IP'den 11. başarısız kod → 429 ve /metrics'te rs_guest_code_rate_limited_total{scope=\"ip\"}", async () => {
    const ip = "198.18.208.7";
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await live.app.inject({
        method: "POST",
        url: "/api/v1/public/sessions/resolve",
        headers: { "x-forwarded-for": ip, origin: ORIGIN },
        payload: { code: String(10_000_000 + i), clientKind: "BROWSER" },
      });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 404)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    const m = await metrics();
    expect(m).toMatch(/rs_guest_code_rate_limited_total\{scope="ip"\} [1-9]/);
    expect(m).toContain("# TYPE rs_mysql_test_failed_total counter");
  });
});

describe("AC-209: talep kapısı sırası", () => {
  it("AC-209: kapı doluyken 5 ardışık 503 NOT_READY IP/önek kovasını tüketmez; ardından aynı IP 201; tenant kovası yalnız commit sonrası", async () => {
    const rc = requestClient(live.app, "");
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const consentTextId = await rc.consentId(ref, "203.0.113.200");
    const hold = holdSettingsLock(t.id);
    await hold.locked;
    // Kapıyı doldur: 2 çalışan (kilitte) + 16 bekleyen; farklı IP'ler (aynı /24 ≤ 20 → önek kovası dolmaz).
    const flood = Array.from({ length: REQUEST_GATE.perKey + REQUEST_GATE.maxWaitingPerKey }, (_, i) =>
      rc.createReq(ref, `203.0.113.${i + 1}`, { consentTextId }),
    );
    let fill: Awaited<(typeof flood)[number]>[] = [];
    let busy: number[] = [];
    try {
      await expect.poll(() => live.app.requests.gateLoad.waiting).toBe(REQUEST_GATE.maxWaitingPerKey);
      // Eski sırada (kova → kapı) bu 5 deneme ipKey kovasını (5/sa) tüketir, 6. istek 429 olurdu.
      busy = [];
      for (let i = 0; i < 5; i++) busy.push((await rc.createReq(ref, "198.51.100.77", { consentTextId })).statusCode);
    } finally {
      hold.release();
      await hold.done;
      fill = await Promise.all(flood);
    }
    expect(busy).toEqual([503, 503, 503, 503, 503]);
    const ok = await rc.createReq(ref, "198.51.100.77", { consentTextId });
    expect(ok.statusCode).toBe(201);
    const created = fill.filter((r) => r.statusCode === 201).length + 1;
    expect(live.app.requests.d.limits.tenantAll.count(t.id)).toBe(created);
    expect(await testDb().supportRequest.count({ where: { tenantId: t.id } })).toBe(created);
  });

  it("AC-209: TX'te reddedilen talep (bekleyen sınırı) tenant kovasını artırmaz", async () => {
    const rc = requestClient(live.app, "");
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const consentTextId = await rc.consentId(ref, "198.51.101.9");
    const instance = "a".repeat(22);
    expect((await rc.createReq(ref, "198.51.101.9", { consentTextId, instance })).statusCode).toBe(201);
    const dup = await rc.createReq(ref, "198.51.101.10", { consentTextId, instance }); // aynı istemci örneği → REQUEST_PENDING
    expect(dup.statusCode).toBe(409);
    expect(live.app.requests.d.limits.tenantAll.count(t.id)).toBe(1);
  });
});

describe("S14-1 / S14-4: talep kapısı güvenlik düzeltmeleri", () => {
  it("AC-209/S14-1: kilitli IP'nin 50 paralel isteği kapıda yuva/kuyruk tutmaz (hepsi 429); meşru talep 201", async () => {
    const rc = requestClient(live.app, "");
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const other = await createTenant();
    const otherRef = await createRequestSettings(other.id);
    const consentTextId = await rc.consentId(ref, "198.18.141.1");
    const otherConsent = await rc.consentId(otherRef, "198.18.142.1");
    const attacker = "198.18.140.66";
    const ipCounter = live.app.requests.d.limits.createIp;
    for (let i = 0; i < 6; i++) ipCounter.hit(ipKey(attacker)); // 6. olay 15 dk kilidi başlatır
    expect(ipCounter.blockedFor(ipKey(attacker))).toBeGreaterThan(0);
    const hold = holdSettingsLock(t.id); // kapıya girenler kilitte asılı kalır → yuva tuttuklarını görürüz
    await hold.locked;
    let codes: number[] = [];
    try {
      const flood = await Promise.all(Array.from({ length: 50 }, () => rc.createReq(ref, attacker, { consentTextId })));
      codes = flood.map((r) => r.statusCode);
      expect(live.app.requests.gateLoad).toEqual({ running: 0, waiting: 0 });
      // Kilit sürerken başka firmanın meşru müşterisi ortak (global) kapıdan geçer.
      expect((await rc.createReq(otherRef, "198.18.142.1", { consentTextId: otherConsent })).statusCode).toBe(201);
    } finally {
      hold.release();
      await hold.done;
    }
    expect(new Set(codes)).toEqual(new Set([429]));
    expect((await rc.createReq(ref, "198.18.141.1", { consentTextId })).statusCode).toBe(201);
    expect(await testDb().supportRequest.count({ where: { tenantId: t.id, ipKey: ipKey(attacker) } })).toBe(0);
  });

  it("AC-205/S14-4: ön bakıştan sonra pasife alınan tenant'a talep yazılmaz (TX içinde FOR SHARE yeniden okuma → 404)", async () => {
    const rc = requestClient(live.app, "");
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const consentTextId = await rc.consentId(ref, "198.18.143.1");
    const hold = holdSettingsLock(t.id);
    await hold.locked;
    let res: Awaited<ReturnType<typeof rc.createReq>>;
    try {
      const pending = rc.createReq(ref, "198.18.143.1", { consentTextId });
      await expect.poll(() => live.app.requests.gateLoad.running).toBe(1); // ön bakış (tenant aktif) geçti
      await testDb().tenant.update({ where: { id: t.id }, data: { status: "PASSIVE" } });
      hold.release();
      res = await pending;
    } finally {
      hold.release();
      await hold.done;
    }
    expect(res.statusCode).toBe(404);
    expect(await testDb().supportRequest.count({ where: { tenantId: t.id } })).toBe(0);
  });
});

describe("AC-210: /ws/request güvenilen CIDR muafiyeti", () => {
  const upgrades = async (secret: string, ip: string, n: number): Promise<string[]> => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = connect(`${live.base}/ws/request`, ["rs.v1", `rs.req.${secret}`], { "x-forwarded-for": ip });
      out.push(await statusOf(p));
      const c = await p.catch(() => null);
      if (c) {
        c.ws.terminate();
        await c.closed;
      }
    }
    return out;
  };

  it("AC-210: güvenilen CIDR'dan 35 upgrade hep açılır; CIDR dışı aynı yükte 31. → 429", async () => {
    const tt = await createTenant();
    await createRequestSettings(tt.id, { trustedCidrs: ["192.0.2.0/24"] });
    const trustedReq = await createRequestRow(tt.id, { ip: "192.0.2.10" });
    expect(new Set(await upgrades(trustedReq.secret, "192.0.2.10", 35))).toEqual(new Set(["open"]));

    const tu = await createTenant();
    await createRequestSettings(tu.id);
    const plainReq = await createRequestRow(tu.id, { ip: "198.18.210.10" });
    const res = await upgrades(plainReq.secret, "198.18.210.10", 31);
    expect(res.slice(0, 30).every((s) => s === "open")).toBe(true);
    expect(res[30]).toBe("HTTP 429");
    // Kilitliyken güvenilmeyen IP'den bir sonraki de 429 (sayım yok ama ret var).
    expect((await upgrades(plainReq.secret, "198.18.210.10", 1))[0]).toBe("HTTP 429");
  });
});

describe("AC-216: /ws/panel kimlik oturumu başına 30/dk", () => {
  it('AC-216: 31. upgrade kabul edilir ve hemen close(4429, "retry=<sn>"); IP kovası değil oturum kovası (her denemede farklı IP); başka oturum etkilenmez', async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id, role: "USER", perms: { "support_requests.view": true } });
    const s = await loginAs(live.app, u);
    const panelFrom = (token: string, ip: string) =>
      connect(`${live.base}/ws/panel`, ["rs.v1"], { ...techHeaders(token, ORIGIN), "x-forwarded-for": ip });
    for (let i = 0; i < 30; i++) {
      const c = await panelFrom(s.token, `198.18.216.${i + 1}`);
      c.ws.close();
      const closed = await c.closed;
      expect(closed.code).not.toBe(WS_REQUEST_CLOSE.TOO_MANY);
    }
    const limited = await panelFrom(s.token, "198.18.216.99");
    const closed = await limited.closed;
    expect(closed.code).toBe(4429);
    const retry = parsePanelRetry(closed.reason);
    expect(retry).not.toBeNull();
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    // Aynı kullanıcının başka oturumu (ayrı kova) bağlanır.
    const s2 = await loginAs(live.app, u);
    const other = await panelFrom(s2.token, "198.18.216.100");
    await sleep(100);
    expect(other.ws.readyState).toBe(other.ws.OPEN);
    other.ws.close();
    await other.closed;
    expect(await metrics()).toMatch(/rs_ws_rejected_total\{role="panel",reason="session_rate"\} [1-9]/);
  });
});

/** caching_sha2 ilan eden ama TLS (CLIENT_SSL) ilan ETMEYEN sahte MySQL v10 el sıkışması. */
function fakeMysqlNoTls(): Promise<{ server: Server; port: number }> {
  const hello = Buffer.concat([
    Buffer.from([0x0a]),
    Buffer.from("8.4.0-fake\0", "latin1"),
    Buffer.from([1, 0, 0, 0]),
    Buffer.alloc(8, 0x41),
    Buffer.from([0]),
    Buffer.from([0x09, 0x82]), // MYSQL | CONNECT_WITH_DB | PROTOCOL_41 | SECURE_CONNECTION (SSL yok)
    Buffer.from([0xff]),
    Buffer.from([0x02, 0x00]),
    Buffer.from([0x08, 0x00]), // PLUGIN_AUTH
    Buffer.from([21]),
    Buffer.alloc(10, 0),
    Buffer.alloc(12, 0x42),
    Buffer.from([0]),
    Buffer.from("caching_sha2_password\0", "latin1"),
  ]);
  const head = Buffer.from([hello.length & 0xff, (hello.length >> 8) & 0xff, 0, 0]);
  const server = createServer((sock: Socket) => {
    sock.on("error", () => undefined);
    sock.write(Buffer.concat([head, hello]));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, port: (server.address() as { port: number }).port })));
}

describe('AC-211/AC-212: MySQL "TLS gerekli" testi', () => {
  const dbUrl = new URL(process.env.TEST_DATABASE_URL ?? "mysql://x@127.0.0.1/x");
  let sSuper: Session;
  beforeAll(async () => {
    sSuper = await loginAs(live.app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
  });
  const test = (payload: object) =>
    live.app.inject({ method: "POST", url: "/api/v1/admin/settings/mysql/test", headers: sSuper.headers, payload });
  const tlsCount = async (): Promise<number> => Number(/rs_mysql_test_failed_total\{class="tls"\} (\d+)/.exec(await metrics())?.[1] ?? 0);

  it("AC-211: TLS ilan etmeyen sunucuya requireTls ile test → tls sınıfı (şifre gönderilmez), metrik artar", async () => {
    const fake = await fakeMysqlNoTls();
    try {
      const before = await tlsCount();
      const r = await test({ host: "127.0.0.1", port: fake.port, database: "remote", user: "app", password: "x", requireTls: true });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ ok: false, message: expect.stringMatching(/TLS/), latencyMs: null });
      expect(await tlsCount()).toBe(before + 1);
      const audit = await testDb().auditLog.findFirstOrThrow({ where: { action: "settings.mysql.test" }, orderBy: { id: "desc" } });
      expect(audit.newValue).toMatchObject({ requireTls: true, result: "fail", reason: "tls" });
    } finally {
      await new Promise((r) => fake.server.close(r));
    }
  });

  it("AC-211: gerçek MySQL (kendinden imzalı sertifika) requireTls → tls; requireTls kapalıyken (loopback) başarı", async () => {
    const base = {
      host: dbUrl.hostname,
      port: Number(dbUrl.port),
      database: dbUrl.pathname.slice(1),
      user: decodeURIComponent(dbUrl.username),
      password: decodeURIComponent(dbUrl.password),
    };
    const strict = await test({ ...base, requireTls: true });
    expect(strict.json()).toMatchObject({ ok: false, message: expect.stringMatching(/TLS/) });
    const plain = await test({ ...base, requireTls: false });
    expect(plain.json()).toMatchObject({ ok: true });
  });

  it("AC-212: başarısız test sınıfı metrikte (connect) — bağlanılamayan port", async () => {
    const r = await test({ host: "127.0.0.1", port: 1, database: "remote", user: "app", password: "x" });
    expect(r.json()).toMatchObject({ ok: false });
    expect(await metrics()).toMatch(/rs_mysql_test_failed_total\{class="connect"\} [1-9]/);
  });
});
