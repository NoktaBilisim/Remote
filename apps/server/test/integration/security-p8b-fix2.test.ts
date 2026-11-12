// P8b-1 düzeltme turu 2 (güvenlik Tur 2): S8b-5 talep kapısı, S8b-6 hesap kilidi geçici DB hatasında fail-closed.
import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { pino, type Logger } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.ts";
import { REQUEST_GATE } from "../../src/requests/service.ts";
import type { Db } from "../../src/lib/db.ts";
import { createTenant, createUser, loginAs, loginRequest, makeApp, testDb, testEnv, type TestUser } from "../helpers/app.ts";
import { createRequestSettings, requestClient, retryNotReady } from "../helpers/requests.ts";

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Ayar satırı kilidini `ms` boyunca tutar (yavaş DB / uzun TX benzetimi). */
function holdSettingsLock(tenantId: string, ms: number): { locked: Promise<void>; done: Promise<void> } {
  let onLocked!: () => void;
  const locked = new Promise<void>((r) => (onLocked = r));
  const done = testDb().$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT tenant_id FROM tenant_request_settings WHERE tenant_id = ${tenantId} FOR UPDATE`;
      onLocked();
      await sleep(ms);
    },
    { timeout: ms + 10_000 },
  );
  return { locked, done };
}

describe("S8b-5 talep oluşturma kapısı", () => {
  it("AC-143/S8b-5: iki tenant'ta kilit tutulurken 60 eşzamanlı talep — kapı ≤ global, havuzda boş bağlantı kalır, giriş + /auth/me kilit bitmeden döner; sonunda hepsi 201, hiç 500 yok", async () => {
    const HOLD_MS = 6_000;
    const a = makeApp({ env: PROXY });
    app = a;
    const rc = requestClient(a, "");
    const tenants = await Promise.all([0, 1].map(async () => {
      const t = await createTenant();
      const ref = await createRequestSettings(t.id, { trustedCidrs: ["203.0.112.0/22"] });
      return { id: t.id, ref, consentTextId: await rc.consentId(ref, "203.0.113.1") };
    }));
    const user = await createUser({ tenantId: tenants[0]?.id ?? null });
    const holds = tenants.map((t) => holdSettingsLock(t.id, HOLD_MS));
    let holdsOpen = true;
    const holdsSettled = Promise.allSettled(holds.map((h) => h.done)).then((r) => {
      holdsOpen = false;
      return r;
    });
    await Promise.all(holds.map((h) => h.locked));

    // Kapı doluluğu flood boyunca örneklenir (QA-P8b-14 (a)): çalışan iş hiçbir an global sınırı aşmamalı.
    let maxRunning = 0;
    const sampler = setInterval(() => (maxRunning = Math.max(maxRunning, a.requests.gateLoad.running)), 5);
    const stop = new AbortController();
    const flood = Promise.all(
      Array.from({ length: 60 }, (_, i) => {
        const t = tenants[i % 2];
        if (!t) throw new Error("tenant yok");
        // Kilit 6 sn: kuyruk dolu → anında 503 ile her deneme ~250 ms; 30 deneme kilit bitmeden tükenebilirdi.
        return retryNotReady(() => rc.createReq(t.ref, `203.0.113.${i + 1}`, { consentTextId: t.consentTextId }), { attempts: 200, signal: stop.signal });
      }),
    );
    const floodSettled = Promise.allSettled([flood]);

    let probeWhileHeld = false;
    let meWhileHeld = false;
    let meStatus = 0;
    let elapsed = Number.POSITIVE_INFINITY;
    let gateEngaged = { running: 0, waiting: 0 };
    try {
      // Kapı devrede: global dolu ve kuyrukta bekleyen var (sabit uyku yerine gözlenebilir senkron noktası).
      await expect.poll(() => a.requests.gateLoad.running === REQUEST_GATE.global && a.requests.gateLoad.waiting > 0).toBe(true);
      gateEngaged = a.requests.gateLoad;
      // Havuzda boş bağlantı: kilitsiz sorgu kilit bitmeden döner (kapı yokken 10 bağlantı da kilit kuyruğunda olurdu).
      await testDb().$queryRaw`SELECT 1`;
      probeWhileHeld = holdsOpen;
      const started = performance.now();
      const s = await loginAs(a, user);
      const me = await a.inject({ method: "GET", url: "/api/v1/auth/me", headers: s.headers });
      elapsed = performance.now() - started;
      meStatus = me.statusCode;
      meWhileHeld = holdsOpen;
    } catch (err) {
      stop.abort(); // test düşerse yeniden denemeler durur; app kapanmadan flood biter (QA-P8b-14 (c))
      throw err;
    } finally {
      await floodSettled;
      await holdsSettled;
      clearInterval(sampler);
    }

    expect(gateEngaged.running).toBe(REQUEST_GATE.global);
    expect(gateEngaged.waiting).toBeGreaterThan(0);
    expect(maxRunning).toBeLessThanOrEqual(REQUEST_GATE.global);
    expect(probeWhileHeld).toBe(true);
    expect(meStatus).toBe(200);
    expect(meWhileHeld).toBe(true);
    expect(elapsed).toBeLessThan(HOLD_MS - 1_000); // kapı yokken giriş kilit bitimini (~HOLD_MS) bekler

    const res = await flood;
    const codes = res.map((r) => r.statusCode);
    expect(codes.filter((c) => c >= 500)).toEqual([]);
    expect(codes.filter((c) => c === 201)).toHaveLength(60);
    for (const t of tenants) expect(await testDb().supportRequest.count({ where: { tenantId: t.id, status: "PENDING" } })).toBe(30);
  }, 90_000);

  it("S8b-5: kapı 503'ü Retry-After taşır, gövdede SQL/stack yok; tenant kovası tüketilmez", async () => {
    app = makeApp({ env: PROXY });
    const rc = requestClient(app, "");
    const t = await createTenant();
    const ref = await createRequestSettings(t.id, { trustedCidrs: ["203.0.112.0/22"] });
    const consentTextId = await rc.consentId(ref, "203.0.113.1");
    const hold = holdSettingsLock(t.id, 2_000);
    await hold.locked;
    const res = await Promise.all(Array.from({ length: 40 }, (_, i) => rc.createReq(ref, `203.0.113.${i + 1}`, { consentTextId })));
    await hold.done;
    const busy = res.filter((r) => r.statusCode === 503);
    expect(busy.length).toBeGreaterThanOrEqual(40 - 2 - 16); // 2 çalışan + 16 kuyruk dışındakiler hemen 503
    for (const r of busy) {
      expect(r.headers["retry-after"]).toBe("5");
      expect(r.json<{ error: { code: string } }>().error.code).toBe("NOT_READY");
      expect(r.body).not.toMatch(/SELECT|prisma|gate_|at /i);
    }
    expect(res.filter((r) => r.statusCode >= 500 && r.statusCode !== 503)).toEqual([]);
    // Kapıda reddedilenler tenant saatlik kovasını tüketmedi: 201 sayısı kadar sayılmış olmalı.
    const accepted = res.filter((r) => r.statusCode === 201).length;
    expect(app.requests.d.limits.tenantKnown.count(t.id)).toBe(accepted);
  }, 30_000);
});

// ---------------------------------------------------------------- S8b-6

const transient = () => Object.assign(new Error("Transaction API error"), { name: "PrismaClientKnownRequestError", code: "P2028" });

/** testDb üzerinde hata enjeksiyonu: sayaç UPDATE'leri (`$executeRaw`), TX'ler (`$transaction`, audit) ve/veya TX dışı audit yazımı (`auditLog.create`) düşer. */
function faultyDb(f: { counter: boolean; tx: boolean; audit?: boolean }): Db {
  const base = testDb();
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "$executeRaw" && f.counter) return () => Promise.reject(transient());
      if (prop === "$transaction" && f.tx) return () => Promise.reject(transient());
      if (prop === "auditLog" && f.audit) return { create: () => Promise.reject(transient()) };
      const v: unknown = Reflect.get(target, prop);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

function captureLogs(): { logger: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const l of chunk.toString().split("\n")) if (l.trim()) lines.push(JSON.parse(l) as Record<string, unknown>);
      cb();
    },
  });
  const logger: Logger = pino({ level: "warn" }, stream);
  return { logger, lines };
}

const wrongFrom = (a: FastifyInstance, u: TestUser, i: number) => a.inject(loginRequest(u.email, "yanlis-sifre-000", { remoteAddress: `198.18.${Math.floor(i / 200)}.${(i % 200) + 1}` }));

describe("S8b-6 geçici DB hatasında hesap kilidi", () => {
  it("AC-65/S8b-6: sayaç ve audit yazılamazken 20 hatalı deneme (çok IP) → hesap yine kilitlenir (423), doğru şifre de 423; alarm logu PII'siz", async () => {
    const { logger, lines } = captureLogs();
    app = buildApp({ env: testEnv(), db: faultyDb({ counter: true, tx: true }), logger });
    const user = await createUser({ tenantId: (await createTenant()).id });
    const codes: number[] = [];
    for (let i = 0; i < 20; i++) codes.push((await wrongFrom(app, user, i)).statusCode);
    expect(codes.slice(0, 19).every((c) => c === 401)).toBe(true);
    expect(codes[19]).toBe(423);
    expect((await app.inject(loginRequest(user.email, user.password, { remoteAddress: "192.0.2.10" }))).statusCode).toBe(423);
    const alarms = lines.filter((l) => l.alarm === "auth_fail_counter_fallback" || l.alarm === "auth_fail_unrecorded");
    expect(alarms.length).toBeGreaterThanOrEqual(20);
    const text = JSON.stringify(alarms);
    expect(text).not.toContain(user.email);
    expect(text).not.toContain("yanlis-sifre");
    expect(text).not.toMatch(/198\.18\./);
  });

  it("AC-65/S8b-6: DB'de 15 hata varken sayaç yazılamazsa 5. yedek hatada kilit (DB + bellek birlikte sayılır)", async () => {
    const user = await createUser({ tenantId: (await createTenant()).id });
    await testDb().user.update({ where: { id: user.id }, data: { failedLoginCount: 15, failedWindowAt: new Date() } });
    app = buildApp({ env: testEnv({ LOG_LEVEL: "silent" }), db: faultyDb({ counter: true, tx: false }) });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await wrongFrom(app, user, i)).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 423]);
    expect((await app.inject(loginRequest(user.email, user.password, { remoteAddress: "192.0.2.11" }))).statusCode).toBe(423);
    // audit TX'i çalıştı: başarısız denemeler ve kilit kaydı yazıldı
    const locked = await testDb().auditLog.findMany({ where: { userId: user.id, action: "auth.locked" } });
    expect(locked.map((r) => r.newValue)).toEqual([{ scope: "account", minutes: 15 }]);
  });

  it("AC-65/S8b-6: yalnız audit TX'i düşerse sayaç TX dışında artar ve DB kilidi yazılır; yanıt 503 değil 401/423", async () => {
    app = buildApp({ env: testEnv({ LOG_LEVEL: "silent" }), db: faultyDb({ counter: false, tx: true }) });
    const user = await createUser({ tenantId: (await createTenant()).id });
    const codes: number[] = [];
    for (let i = 0; i < 20; i++) codes.push((await wrongFrom(app, user, i)).statusCode);
    expect(codes.filter((c) => c === 503)).toEqual([]);
    expect(codes[19]).toBe(423);
    const row = await testDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil?.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });

  it("AC-65: başarılı giriş yedek kovayı sıfırlar", async () => {
    const user = await createUser({ tenantId: (await createTenant()).id });
    const faulty = buildApp({ env: testEnv({ LOG_LEVEL: "silent" }), db: faultyDb({ counter: true, tx: false }) });
    for (let i = 0; i < 3; i++) await wrongFrom(faulty, user, i);
    expect(faulty.authLimits.accountFallback.count(user.id)).toBe(3);
    await loginAs(faulty, user);
    expect(faulty.authLimits.accountFallback.count(user.id)).toBe(0);
    await faulty.close();
  });
});

describe("S8b-7 kilitli hesap dalında audit yazılamazsa", () => {
  it("AC-65/S8b-7: DB yazmaları düşerken kilitli hesap 423 (doğru/yanlış şifre), kilitsiz hesap 401, hiç 5xx yok; alarm logu PII'siz", async () => {
    const { logger, lines } = captureLogs();
    app = buildApp({ env: testEnv(), db: faultyDb({ counter: true, tx: true, audit: true }), logger });
    const tenantId = (await createTenant()).id;
    const lockedUser = await createUser({ tenantId });
    const openUser = await createUser({ tenantId });
    await testDb().user.update({ where: { id: lockedUser.id }, data: { lockedUntil: new Date(Date.now() + 10 * 60_000) } });
    const before = await testDb().auditLog.count({ where: { userId: lockedUser.id } });

    const lockedWrong = await wrongFrom(app, lockedUser, 0);
    const lockedRight = await app.inject(loginRequest(lockedUser.email, lockedUser.password, { remoteAddress: "192.0.2.20" }));
    const openWrong = await wrongFrom(app, openUser, 1);
    const ghost = await app.inject(loginRequest("yok-boyle-biri@example.test", "yanlis-sifre-000", { remoteAddress: "192.0.2.21" }));

    expect(lockedWrong.statusCode).toBe(423);
    expect(lockedRight.statusCode).toBe(423);
    expect(Number(lockedRight.headers["retry-after"])).toBeGreaterThan(0);
    expect(openWrong.statusCode).toBe(401);
    expect(ghost.statusCode).toBe(401);
    expect([lockedWrong, lockedRight, openWrong, ghost].filter((r) => r.statusCode >= 500)).toEqual([]);
    expect(await testDb().auditLog.count({ where: { userId: lockedUser.id } })).toBe(before); // gerçekten yazılamadı

    const alarms = lines.filter((l) => l.alarm === "auth_fail_unrecorded" && l.locked === true);
    expect(alarms.map((l) => l.userId)).toEqual([lockedUser.id, lockedUser.id]);
    const text = JSON.stringify(alarms);
    expect(text).not.toContain(lockedUser.email);
    expect(text).not.toContain("yanlis-sifre");
    expect(text).not.toContain(lockedUser.password);
    expect(text).not.toMatch(/198\.18\.|192\.0\.2\./);
  });
});
