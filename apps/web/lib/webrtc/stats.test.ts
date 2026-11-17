import { describe, expect, it } from "vitest";
import { evaluate, sampleFromStats, type Prev, type Sample } from "./stats";

// P28d (mimari-p28d §8, §9): kalite panelinde ses paket kaybı (AC-376)
const audio = (lost: number, recv: number) => ({
  id: "a",
  type: "inbound-rtp",
  kind: "audio",
  bytesReceived: recv * 100,
  packetsLost: lost,
  packetsReceived: recv,
});
const video = {
  id: "v",
  type: "inbound-rtp",
  kind: "video",
  framesPerSecond: 30,
  bytesReceived: 1000,
  packetsLost: 0,
  packetsReceived: 10,
};

describe("AC-376 ses paket kaybı (stats.ts)", () => {
  it("iki örnekte packetsLost/packetsReceived farkından audioLossPct", () => {
    const prev: Prev = { c: null };
    // İlk örnek: fark penceresi yok → null
    expect(sampleFromStats([video, audio(0, 100)], prev, 1000).audioLossPct).toBeNull();
    // +6 kayıp, +94 alındı → %6
    expect(sampleFromStats([video, audio(6, 194)], prev, 2000).audioLossPct).toBeCloseTo(6);
    // Kayıpsız 50 paket → %0
    expect(sampleFromStats([video, audio(6, 244)], prev, 3000).audioLossPct).toBe(0);
  });

  it("ses paketi yokken (görüşme dışı) null; sayaç donunca (görüşme bitti) yeniden null", () => {
    const prev: Prev = { c: null };
    expect(sampleFromStats([video, audio(0, 0)], prev, 1000).audioLossPct).toBeNull();
    expect(sampleFromStats([video, audio(0, 0)], prev, 2000).audioLossPct).toBeNull();
    expect(sampleFromStats([video], prev, 3000).audioLossPct).toBeNull();
    sampleFromStats([video, audio(0, 100)], prev, 4000);
    expect(sampleFromStats([video, audio(1, 199)], prev, 5000).audioLossPct).toBeCloseTo(1);
    expect(sampleFromStats([video, audio(1, 199)], prev, 6000).audioLossPct).toBeNull();
  });

  it("eşik üstü ses kaybı ≥ 3 sn sürerse audioLoss sorunu (uyarı > %5, kötü > %10); kısa sıçrama değil", () => {
    const smp = (at: number, audioLossPct: number | null): Sample => ({
      at,
      fps: 30,
      kbps: 1000,
      rttMs: 20,
      lossPct: 0,
      audioLossPct,
      width: 1280,
      height: 720,
      connType: "host",
    });
    const ticks = [0, 1000, 2000, 3000];
    expect(evaluate(ticks.map((t) => smp(t, 7)))).toEqual({ level: "warn", issues: ["audioLoss"] });
    expect(evaluate(ticks.map((t) => smp(t, 12)))).toEqual({ level: "bad", issues: ["audioLoss"] });
    expect(evaluate(ticks.map((t) => smp(t, 5)))).toEqual({ level: "ok", issues: [] });
    expect(evaluate([smp(0, 0), smp(1000, 0), smp(2000, 0), smp(3000, 12)]).level).toBe("ok");
    expect(evaluate(ticks.map((t) => smp(t, null)))).toEqual({ level: "ok", issues: [] });
  });
});
