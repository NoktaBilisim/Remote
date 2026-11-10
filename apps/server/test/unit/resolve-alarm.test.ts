import { describe, expect, it, vi } from "vitest";
import { ClientIpIsProxyAlarm, ResolveFailedAlarm } from "../../src/sessions/public.ts";

describe("ResolveFailedAlarm (G-02, S-P2-3)", () => {
  it("AC-3: eşik (100/dk) aşılınca pencere başına tek alarm; önek sayısı raporlanır", () => {
    let t = 0;
    const onAlarm = vi.fn();
    const a = new ResolveFailedAlarm(onAlarm, { now: () => t });
    for (let i = 0; i < 100; i++) a.record(`p${i % 7}`);
    expect(onAlarm).not.toHaveBeenCalled();
    a.record("p99");
    expect(onAlarm).toHaveBeenCalledExactlyOnceWith({ failed: 101, prefixes: 8, windowSec: 60 });
    for (let i = 0; i < 50; i++) a.record("p1");
    expect(onAlarm).toHaveBeenCalledTimes(1);
    t = 60_000; // yeni pencere: sayaç sıfırlanır
    for (let i = 0; i < 100; i++) a.record("p1");
    expect(onAlarm).toHaveBeenCalledTimes(1);
    a.record("p1");
    expect(onAlarm).toHaveBeenLastCalledWith({ failed: 101, prefixes: 1, windowSec: 60 });
  });

  it("AC-3: önek kümesi üst sınırlı (bellek)", () => {
    const onAlarm = vi.fn();
    const a = new ResolveFailedAlarm(onAlarm, { threshold: 5, maxPrefixes: 3, now: () => 0 });
    for (let i = 0; i < 10; i++) a.record(`p${i}`);
    expect(onAlarm).toHaveBeenCalledExactlyOnceWith({ failed: 6, prefixes: 3, windowSec: 60 });
  });
});

describe("ClientIpIsProxyAlarm (S-P2-T2-1)", () => {
  it("S-P2-T2-1: proxy IP'si dakikada en çok bir alarm; proxy dışı IP alarm üretmez", () => {
    let t = 0;
    const onAlarm = vi.fn();
    const a = new ClientIpIsProxyAlarm("172.30.0.2/31", onAlarm, { now: () => t });
    a.check("198.51.100.4");
    expect(onAlarm).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) a.check("172.30.0.3");
    expect(onAlarm).toHaveBeenCalledTimes(1);
    t = 59_999;
    a.check("172.30.0.2");
    expect(onAlarm).toHaveBeenCalledTimes(1);
    t = 60_000;
    a.check("172.30.0.3");
    expect(onAlarm).toHaveBeenCalledTimes(2);
  });

  it("S-P2-T2-1: TRUSTED_PROXY_CIDR boşsa hiç alarm yok", () => {
    const onAlarm = vi.fn();
    new ClientIpIsProxyAlarm(undefined, onAlarm).check("172.30.0.3");
    expect(onAlarm).not.toHaveBeenCalled();
  });
});
