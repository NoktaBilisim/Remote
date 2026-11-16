// P28b K9 B3 birim: öz-sınama yoklama zinciri (wiring.ts createAvPoller) — açılışta / up→down geçişinde kısa aralıklı yeniden
// deneme, sınırlı bütçe, 10 dk turu, kapanışta zamanlayıcı kalmaması; Scanner.poll({fastRetry}) `av_down` sayacına katılmaz.
import { describe, expect, it } from "vitest";
import { AV_SELFTEST_INTERVAL_MS } from "@remote/contracts/ws-fsrv";
import { AV_FAST_RETRY_MAX, AV_FAST_RETRY_MS, createAvPoller } from "../../src/fsrv/wiring.ts";
import { ScanQueue } from "../../src/fsrv/scan-queue.ts";
import { Scanner } from "../../src/fsrv/scan.ts";
import { ClamdClient } from "../../src/fsrv/clamd.ts";
import { createMetrics } from "../../src/ops/metrics.ts";
import { FakeClock } from "../helpers/ws.ts";

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Saati ilerletir ve zincirin async adımlarının bitmesini bekler. */
async function step(clock: FakeClock, ms: number): Promise<void> {
  clock.advance(ms);
  await flush();
}

function harness(results: (i: number) => boolean) {
  const clock = new FakeClock();
  const calls: { at: number; fast: boolean }[] = [];
  const poller = createAvPoller(async (fast) => {
    calls.push({ at: clock.now(), fast });
    return results(calls.length);
  }, clock);
  return { clock, calls, poller };
}

describe("K9 B3 AV yoklama zinciri (sahte saat)", () => {
  it("varsayılanlar: 30 sn × 19 < 10 dk tur (remote-watch ardışık 2 tur penceresinde up=1 olur)", () => {
    expect(AV_FAST_RETRY_MS).toBe(30_000);
    expect(AV_FAST_RETRY_MS * AV_FAST_RETRY_MAX).toBeLessThan(AV_SELFTEST_INTERVAL_MS);
  });

  it("açılışta clamd imza yüklerken düşer → 30 sn'de bir yeniden dener, ulaşınca 10 dk turuna döner", async () => {
    const { clock, calls, poller } = harness((i) => i >= 4); // ilk 3 yoklama erişilemez
    await poller.start();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.fast).toBe(false);
    expect(clock.hasTimerIn(AV_FAST_RETRY_MS)).toBe(true);
    await step(clock, AV_FAST_RETRY_MS);
    await step(clock, AV_FAST_RETRY_MS);
    await step(clock, AV_FAST_RETRY_MS);
    expect(calls.map((c) => c.fast)).toEqual([false, true, true, true]);
    expect(clock.hasTimerIn(AV_SELFTEST_INTERVAL_MS)).toBe(true);
    expect(clock.pending).toBe(1);
    await step(clock, AV_SELFTEST_INTERVAL_MS);
    expect(calls).toHaveLength(5);
    expect(calls[4]?.fast).toBe(false);
    poller.stop();
  });

  it("hiç açılmayan clamd (staging profil kapalı): bütçe biter, sonra yalnız 10 dk turu; bütçe başarısız turda yenilenmez", async () => {
    const { clock, calls, poller } = harness(() => false);
    await poller.start();
    for (let i = 0; i < AV_FAST_RETRY_MAX; i++) await step(clock, AV_FAST_RETRY_MS);
    expect(calls).toHaveLength(1 + AV_FAST_RETRY_MAX);
    expect(clock.hasTimerIn(AV_SELFTEST_INTERVAL_MS)).toBe(true);
    await step(clock, AV_FAST_RETRY_MS * 5); // hızlı deneme kalmadı
    expect(calls).toHaveLength(1 + AV_FAST_RETRY_MAX);
    await step(clock, AV_SELFTEST_INTERVAL_MS);
    expect(calls).toHaveLength(2 + AV_FAST_RETRY_MAX);
    expect(calls.at(-1)?.fast).toBe(false);
    expect(clock.hasTimerIn(AV_SELFTEST_INTERVAL_MS)).toBe(true); // yine 10 dk, 30 sn değil
    poller.stop();
  });

  it("up→down geçişi (imza yeniden yükleme penceresi): bütçe başarıdan sonra yenilenir, hızlı denemeyle up=1'e döner", async () => {
    let up = true;
    const { clock, calls, poller } = harness(() => up);
    await poller.start();
    up = false;
    await step(clock, AV_SELFTEST_INTERVAL_MS);
    expect(clock.hasTimerIn(AV_FAST_RETRY_MS)).toBe(true);
    up = true;
    await step(clock, AV_FAST_RETRY_MS);
    expect(calls.map((c) => c.fast)).toEqual([false, false, true]);
    expect(clock.hasTimerIn(AV_SELFTEST_INTERVAL_MS)).toBe(true);
    poller.stop();
  });

  it("yoklama hata fırlatsa da zincir kopmaz; stop() sonrası zamanlayıcı kalmaz ve uçuştaki yoklama yenisini kurmaz", async () => {
    const clock = new FakeClock();
    let release: (() => void) | undefined;
    let n = 0;
    const poller = createAvPoller(async () => {
      n++;
      if (n === 1) throw new Error("beklenmeyen");
      await new Promise<void>((r) => (release = r));
      return true;
    }, clock);
    await poller.start();
    expect(clock.hasTimerIn(AV_FAST_RETRY_MS)).toBe(true);
    clock.advance(AV_FAST_RETRY_MS); // ikinci yoklama uçuşta
    await flush();
    expect(clock.pending).toBe(0);
    poller.stop();
    release?.();
    await flush();
    expect(clock.pending).toBe(0);
    expect(n).toBe(2);
  });
});

describe("K9 B3 Scanner.poll fastRetry", () => {
  it("hızlı denemeler av_down ardışıklık sayacına katılmaz (yalnız 10 dk turları sayılır)", async () => {
    const errors: object[] = [];
    const s = new Scanner({
      client: new ClamdClient({ cidr: "172.30.2.0/28", retryTotalMs: 0, connectTimeoutMs: 200 }),
      queue: new ScanQueue(new FakeClock()),
      target: async () => ({ host: "172.30.2.5", port: 1 }),
      metrics: createMetrics(),
      log: { warn: () => undefined, error: (o) => void errors.push(o) },
      now: Date.now,
    });
    await s.poll();
    await s.poll({ fastRetry: true });
    await s.poll({ fastRetry: true });
    expect(s.up).toBe(0);
    expect(errors).toEqual([]);
    await s.poll();
    expect(errors).toEqual([{ alarm: "av_down" }]);
  });
});
