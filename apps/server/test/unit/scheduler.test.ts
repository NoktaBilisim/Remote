import type { FastifyBaseLogger } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startScheduler, type Scheduler } from "../../src/jobs/scheduler.ts";
import type { Db } from "../../src/lib/db.ts";

// Sahte db: expireDue yalnız supportSession.findMany'yi çağırır (boş liste → oturum yok).
function fakeDb(findMany: () => Promise<unknown[]>) {
  const spy = vi.fn(findMany);
  return { db: { supportSession: { findMany: spy } } as unknown as Db, findMany: spy };
}
function fakeLog() {
  const error = vi.fn();
  return { log: { info: vi.fn(), error } as unknown as FastifyBaseLogger, error };
}

let jobs: Scheduler | undefined;
afterEach(() => {
  jobs?.stop();
  vi.useRealTimers();
});

describe("jobs/scheduler (QA-P2-8)", () => {
  it("AC-5: turlar üst üste binmez; çalışan tur varken ikinci çağrı 0 döner ve db'ye gitmez", async () => {
    let release: (v: unknown[]) => void = () => undefined;
    let hold = true;
    const { db, findMany } = fakeDb(() => (hold ? new Promise((r) => (release = r)) : Promise.resolve([])));
    jobs = startScheduler(db, fakeLog().log, 60_000);
    const first = jobs.runExpiry();
    expect(await jobs.runExpiry()).toBe(0);
    expect(findMany).toHaveBeenCalledTimes(1);
    hold = false;
    release([]);
    expect(await first).toBe(0);
    await jobs.runExpiry(); // bayrak serbest kaldı
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("AC-5: hata yutulmaz, log.error'a gider; sonraki tur yeniden dener", async () => {
    let fail = true;
    const { db, findMany } = fakeDb(() => (fail ? Promise.reject(new Error("db düştü")) : Promise.resolve([])));
    const { log, error } = fakeLog();
    jobs = startScheduler(db, log, 60_000);
    expect(await jobs.runExpiry()).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatchObject({ job: "session-expiry", err: expect.any(Error) });
    fail = false;
    expect(await jobs.runExpiry()).toBe(0);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("AC-5: zamanlayıcı aralıkta tetikler; stop sonrası tetiklemez", async () => {
    vi.useFakeTimers();
    const { db, findMany } = fakeDb(() => Promise.resolve([]));
    jobs = startScheduler(db, fakeLog().log, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(findMany).toHaveBeenCalledTimes(1);
    jobs.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
