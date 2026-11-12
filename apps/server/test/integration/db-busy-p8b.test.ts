// QA-P8b-1: yük altında DB çekişmesi — meşru talep 5xx-500 almaz. Kök neden: Prisma etkileşimli TX varsayılan
// maxWait 2 sn; talep TX'inin ilk ifadesi `tenant_request_settings … FOR UPDATE` (G-E9-10) ile seri kuyrukta havuz
// (10 bağlantı) dolunca P2028 → 500. Düzeltme: `TX_OPTIONS` (db.ts) + geçici DB hatası → 503 NOT_READY + Retry-After.
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.ts";
import { createDb } from "../../src/lib/db.ts";
import { DB_BUSY_RETRY_SEC } from "../../src/lib/errors.ts";
import { createTenant, testDb, testEnv } from "../helpers/app.ts";
import { createRequestSettings, requestClient, retryNotReady } from "../helpers/requests.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";

const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const errCode = (r: { json: <T>() => T }) => r.json<{ error: { code: string } }>().error.code;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let live: Live | undefined;
afterEach(async () => {
  await live?.close();
  live = undefined;
});

/** Ayar satırı kilidini `ms` boyunca tutar (başka bir istemcinin uzun TX'i / yüklü DB benzetimi). */
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

describe("QA-P8b-1 yük altında talep oluşturma", () => {
  it("AC-143: ayar kilidi 3 sn tutulurken 60 eşzamanlı talep (503 → Retry-After ile yeniden deneme) → tam 50×201 + 10×429 QUEUE_FULL, hiç 500 yok", async () => {
    live = await startLive({ env: PROXY });
    const rc = requestClient(live.app, live.base);
    const t = await createTenant();
    const ref = await createRequestSettings(t.id, { trustedCidrs: ["203.0.112.0/22"] });
    const consentTextId = await rc.consentId(ref, "203.0.113.1");
    const hold = holdSettingsLock(t.id, 3_000); // eski varsayılan maxWait (2 sn) bu beklemede P2028 → 500 veriyordu
    await hold.locked;
    // S8b-5 kapısı: tenant başına 2 TX kilitte bekler, 16'sı kuyrukta, fazlası hemen 503 + Retry-After (bağlantı tutmaz).
    const res = await Promise.all(Array.from({ length: 60 }, (_, i) => retryNotReady(() => rc.createReq(ref, `203.0.113.${i + 1}`, { consentTextId }))));
    await hold.done;
    const codes = res.map((r) => r.statusCode);
    expect(codes.filter((c) => c >= 500)).toEqual([]);
    expect(res.some((r) => r.retries > 0)).toBe(true); // kapı gerçekten devreye girdi
    expect(codes.filter((c) => c === 201)).toHaveLength(50);
    expect(res.filter((r) => r.statusCode === 429).map(errCode)).toEqual(Array.from({ length: 10 }, () => "QUEUE_FULL"));
  }, 60_000);

  it("QA-P8b-1: havuz dolu (bağlantı alınamıyor) → 503 NOT_READY + Retry-After; gövdede SQL/stack yok, 500 değil", async () => {
    const t = await createTenant();
    const ref = await createRequestSettings(t.id);
    const url = new URL(testEnv().DATABASE_URL);
    url.searchParams.set("connectionLimit", "1");
    url.searchParams.set("acquireTimeout", "500");
    const db = createDb(url.toString());
    const app = buildApp({ mfaSetupEnforcement: false, env: testEnv(PROXY), db });
    await app.ready();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let onHeld!: () => void;
    const held = new Promise<void>((r) => (onHeld = r));
    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        onHeld();
        await gate;
      },
      { timeout: 20_000 },
    );
    try {
      await held;
      const r = await app.inject({ method: "GET", url: `/api/v1/public/requests/tenant?ref=${ref}`, headers: { "x-forwarded-for": "198.51.100.77" } });
      expect(r.statusCode).toBe(503);
      expect(r.headers["retry-after"]).toBe(String(DB_BUSY_RETRY_SEC));
      expect(errCode(r)).toBe("NOT_READY");
      expect(r.body).not.toMatch(/pool|SELECT|prisma|at /i);
    } finally {
      release();
      await holder;
      await app.close();
      await db.$disconnect();
    }
    // havuz serbest kalınca aynı istek başarılı (yeniden deneme güvenli)
    const again = buildApp({ mfaSetupEnforcement: false, env: testEnv(PROXY), db: testDb() });
    const ok = await again.inject({ method: "GET", url: `/api/v1/public/requests/tenant?ref=${ref}`, headers: { "x-forwarded-for": "198.51.100.78" } });
    expect(ok.statusCode).toBe(200);
    await again.close();
  }, 30_000);
});
