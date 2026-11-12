// S8b-5: süreç içi eşzamanlılık kapısı (tenant başına / toplam sınır, sınırlı kuyruk, bekleme zaman aşımı).
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConcurrencyGate, GateBusyError } from "../../src/lib/gate.ts";

const OPTS = { perKey: 2, global: 3, maxWaitingPerKey: 2, maxWaiting: 3, waitMs: 1_000 };

function deferred() {
  let resolve!: () => void;
  const p = new Promise<void>((r) => (resolve = r));
  return { p, resolve };
}

/** Kapıda çalışan iş: `release` çağrılana kadar sürer; `started` başladı mı. */
function job(g: ConcurrencyGate, key: string) {
  const d = deferred();
  const state = { started: false, error: undefined as unknown };
  const done = g.run(key, async () => {
    state.started = true;
    await d.p;
  }).catch((e: unknown) => {
    state.error = e;
  });
  return { state, release: d.resolve, done };
}

const tick = () => new Promise((r) => setImmediate(r));

afterEach(() => vi.useRealTimers());

describe("ConcurrencyGate (S8b-5)", () => {
  it("S8b-5: anahtar başına 2, toplam 3 eşzamanlı; fazlası bekler, bitince FIFO başlar", async () => {
    const g = new ConcurrencyGate(OPTS);
    const a1 = job(g, "a");
    const a2 = job(g, "a");
    const a3 = job(g, "a");
    const b1 = job(g, "b");
    const c1 = job(g, "c");
    await tick();
    expect([a1, a2, a3, b1, c1].map((j) => j.state.started)).toEqual([true, true, false, true, false]);
    expect(g.running).toBe(3);
    expect(g.waiting).toBe(2);
    b1.release(); // toplam yer açıldı: a hâlâ 2'de → sıradaki uygun c1 başlar (a3 atlanır)
    await tick();
    await tick();
    expect(c1.state.started).toBe(true);
    expect(a3.state.started).toBe(false);
    a1.release();
    await tick();
    await tick();
    expect(a3.state.started).toBe(true);
    [a2, a3, c1].forEach((j) => j.release());
    await Promise.all([a1, a2, a3, b1, c1].map((j) => j.done));
    expect(g.running).toBe(0);
    expect(g.waiting).toBe(0);
  });

  it("S8b-5: kuyruk doluysa hemen GateBusyError(full) — anahtar ve toplam sınırı", async () => {
    const g = new ConcurrencyGate(OPTS);
    const run = [job(g, "a"), job(g, "a"), job(g, "b")];
    const wait = [job(g, "a"), job(g, "a")];
    const fullKey = job(g, "a"); // anahtar kuyruğu (2) dolu
    const wb = job(g, "b"); // toplam kuyruk 3. kayıt
    const fullAll = job(g, "c"); // toplam kuyruk (3) dolu
    await fullKey.done;
    await fullAll.done;
    expect(fullKey.state.error).toBeInstanceOf(GateBusyError);
    expect((fullKey.state.error as GateBusyError).reason).toBe("full");
    expect((fullAll.state.error as GateBusyError).reason).toBe("full");
    expect(wb.state.error).toBeUndefined();
    for (const j of [...run, ...wait, wb]) {
      j.release();
      await tick();
    }
    await Promise.all([...run, ...wait, wb].map((j) => j.done));
    expect(g.running).toBe(0);
  });

  it("S8b-5: bekleme süresi aşılınca GateBusyError(timeout); kuyruktan çıkar, sayaçlar tutarlı", async () => {
    vi.useFakeTimers();
    const g = new ConcurrencyGate(OPTS);
    const r1 = job(g, "a");
    const r2 = job(g, "a");
    const w = job(g, "a");
    await vi.advanceTimersByTimeAsync(1_001);
    await w.done;
    expect((w.state.error as GateBusyError).reason).toBe("timeout");
    expect(w.state.started).toBe(false);
    expect(g.waiting).toBe(0);
    r1.release();
    r2.release();
    await Promise.all([r1.done, r2.done]);
    expect(g.running).toBe(0);
  });

  it("S8b-5: iş hata atarsa yer yine serbest kalır, hata aynen yükselir", async () => {
    const g = new ConcurrencyGate(OPTS);
    await expect(g.run("a", () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(g.running).toBe(0);
  });
});
