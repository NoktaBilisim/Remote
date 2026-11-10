import { describe, expect, it } from "vitest";
import { FixedWindowCounter } from "../../src/lib/rate.ts";

const counter = (limit: number, windowMs: number, blockMs: number, t: { v: number }, maxEntries?: number) =>
  new FixedWindowCounter(limit, windowMs, blockMs, { now: () => t.v, sweepIntervalMs: 0, ...(maxEntries ? { maxEntries } : {}) });

describe("FixedWindowCounter", () => {
  it("AC-65: 5. olayda kilit başlar, 15 dk sürer, anahtarlar bağımsız", () => {
    const t = { v: 0 };
    const c = counter(5, 900_000, 900_000, t);
    for (let i = 0; i < 4; i++) expect(c.hit("a|1.1.1.1")).toBe(false);
    expect(c.hit("a|1.1.1.1")).toBe(true);
    expect(c.blockedFor("a|1.1.1.1")).toBe(900);
    expect(c.blockedFor("a|2.2.2.2")).toBe(0);
    t.v = 900_001;
    expect(c.blockedFor("a|1.1.1.1")).toBe(0);
  });

  it("AC-65: pencere dolunca sayaç sıfırlanır; reset kilidi kaldırır", () => {
    const t = { v: 0 };
    const c = counter(3, 1000, 5000, t);
    c.hit("k");
    c.hit("k");
    t.v = 1001;
    expect(c.hit("k")).toBe(false);
    c.hit("k");
    expect(c.hit("k")).toBe(true);
    c.reset("k");
    expect(c.blockedFor("k")).toBe(0);
  });

  it("AC-65: kayıt sayısı üst sınırda sabit kalır (en eski atılır), hit süresi büyümez (S2-1)", () => {
    const t = { v: 0 };
    const c = counter(5, 3_600_000, 900_000, t, 1000);
    for (let i = 0; i < 1000; i++) c.hit(`k${i}`);
    const started = performance.now();
    for (let i = 1000; i < 101_000; i++) c.hit(`k${i}`);
    const perHitMs = (performance.now() - started) / 100_000;
    expect(c.size).toBe(1000);
    expect(perHitMs).toBeLessThan(0.05); // O(1); eski O(n) sweep'te ~ms
    c.hit("k100999");
    expect(c.size).toBe(1000);
  });

  it("K11/S3-1: kapasite doluyken etkin kilit kaydı atılmaz; hepsi kilitliyse yeni anahtar kilitli sayılır", () => {
    const t = { v: 0 };
    const c = counter(1, 60_000, 900_000, t, 40);
    expect(c.hit("saldirgan")).toBe(true); // limit 1 → ilk olayda kilit
    for (let i = 0; i < 39; i++) c.hit(`sahte${i}`); // hepsi kilitli kayıt (limit 1)
    expect(c.size).toBe(40);
    expect(c.hit("yeni")).toBe(true); // ilk 32 kayıt kilitli → eklenmez, fail-closed
    expect(c.size).toBe(40);
    expect(c.blockedFor("saldirgan")).toBe(900);
  });

  it("K11/S3-1: kilidi biten en eski kayıt atılır, kilitli olan korunur", () => {
    const t = { v: 0 };
    const c = counter(2, 1000, 900_000, t, 3);
    c.hit("kilitli");
    c.hit("kilitli"); // kilit 15 dk
    c.hit("a");
    c.hit("b");
    t.v = 2000; // a, b pencereleri bitti; kilit sürüyor
    expect(c.hit("yeni")).toBe(false);
    expect(c.size).toBe(3);
    expect(c.blockedFor("kilitli")).toBe(898);
  });

  it("AC-65: prune penceresi ve kilidi biten kayıtları siler, aktif kilidi korur", () => {
    const t = { v: 0 };
    const c = counter(2, 1000, 10_000, t);
    c.hit("biten");
    c.hit("kilitli");
    c.hit("kilitli");
    t.v = 5000;
    c.prune();
    expect(c.size).toBe(1);
    expect(c.blockedFor("kilitli")).toBe(5);
  });

  it("AC-65: zamanlayıcı süreci açık tutmaz ve close ile durur", () => {
    const c = new FixedWindowCounter(5, 1000, 1000, { sweepIntervalMs: 10 });
    expect(() => c.close()).not.toThrow();
  });
});
