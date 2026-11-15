import { describe, expect, it, vi } from "vitest";
import { encodeFileChunk } from "@remote/contracts/dc";
import { chatReducer, initialChat, prepareChat } from "./chat";
import { annotReducer, contentRect, initialAnnot, laserAlpha, normalize, simplify } from "./annot";
import { FileTransfers, fileRisk, sha256Hex, type FileChannelLike, type Transfer } from "./files";
import type { CtlMessage, FileMetaMsg } from "./ctl";
import { evaluate, QualityAgg, sampleFromStats, type Sample } from "../webrtc/stats";
import { readResume, writeResume } from "../guest-resume";

const enc = (s: string) => new TextEncoder().encode(s);
const frame = (idx: number, seq: number, p: Uint8Array) => encodeFileChunk(idx, seq, p).slice().buffer as ArrayBuffer;

function rig(opts: { allowed?: boolean; max?: number; now?: () => number } = {}) {
  const ctl: CtlMessage[] = [];
  const meta: FileMetaMsg[] = [];
  let list: Transfer[] = [];
  const file: FileChannelLike = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const ft = new FileTransfers({
    inbound: "TO_CUSTOMER",
    file,
    sendCtl: (m) => ctl.push(m),
    sendMeta: (m) => meta.push(m),
    onChange: (l) => (list = l),
    allowed: () => opts.allowed ?? true,
    maxBytes: opts.max,
    now: opts.now,
  });
  return {
    ft,
    ctl,
    meta,
    file,
    get list() {
      return list;
    },
  };
}

describe("dosya transferi (AC-36, 53, 54, 117, 119)", () => {
  it("teklifin idx alanıyla eşler, SHA-256 doğrular, meta OK", async () => {
    const r = rig();
    const data = enc("merhaba");
    await r.ft.onCtl({
      t: "file.offer",
      fid: "f1",
      idx: 7,
      name: "../../a‮txt.exe",
      size: data.length,
      sha256: await sha256Hex(data.slice().buffer),
    });
    expect(r.list[0]?.name).toBe("atxt.exe");
    expect(r.list[0]?.dangerous).toBe(true);
    r.ft.accept("f1");
    r.ft.onFrame(frame(0, 0, data)); // yanlış idx → yok sayılır
    r.ft.onFrame(frame(7, 0, data));
    await r.ft.onCtl({ t: "file.done", fid: "f1" });
    expect(r.list[0]?.status).toBe("ok");
    expect(r.ctl.at(-1)).toEqual({ t: "file.result", fid: "f1", ok: true });
    expect(r.meta.at(-1)).toMatchObject({ result: "OK", direction: "TO_CUSTOMER", sizeBytes: 7 });
  });
  it("file.done son parçadan önce gelirse (ayrı DC) parçalar tamamlanınca doğrular", async () => {
    const r = rig();
    const a = enc("parca-1-");
    const b = enc("parca-2");
    const all = new Uint8Array([...a, ...b]);
    await r.ft.onCtl({ t: "file.offer", fid: "f9", idx: 1, name: "b.txt", size: all.length, sha256: await sha256Hex(all.slice().buffer) });
    r.ft.accept("f9");
    r.ft.onFrame(frame(1, 0, a));
    await r.ft.onCtl({ t: "file.done", fid: "f9" });
    expect(r.list[0]?.status).toBe("receiving");
    r.ft.onFrame(frame(1, 1, b));
    await vi.waitFor(() => expect(r.list[0]?.status).toBe("ok"));
    expect(r.meta.at(-1)?.result).toBe("OK");
  });
  it("bozuk SHA-256 → tampon atılır, 'corrupt', meta CORRUPT, indirme adresi yok", async () => {
    const r = rig();
    await r.ft.onCtl({ t: "file.offer", fid: "f2", idx: 0, name: "a.txt", size: 3, sha256: "0".repeat(64) });
    r.ft.accept("f2");
    r.ft.onFrame(frame(0, 0, enc("abc")));
    await r.ft.onCtl({ t: "file.done", fid: "f2" });
    expect(r.list[0]?.status).toBe("corrupt");
    expect(r.list[0]?.url).toBeUndefined();
    expect(r.meta.at(-1)?.result).toBe("CORRUPT");
  });
  it("sınır ALINAN bayt ile: beyandan fazla veri → iptal + CANCELLED", async () => {
    const r = rig({ max: 4 });
    await r.ft.onCtl({ t: "file.offer", fid: "f3", idx: 0, name: "a.bin", size: 2, sha256: "a".repeat(64) });
    r.ft.accept("f3");
    r.ft.onFrame(frame(0, 0, enc("abc")));
    expect(r.list[0]?.status).toBe("tooLarge");
    expect(r.ctl.at(-1)).toEqual({ t: "file.cancel", fid: "f3" });
    expect(r.meta.at(-1)?.result).toBe("CANCELLED");
  });
  it("sıra dışı parça → transfer bozuk sayılır", async () => {
    const r = rig();
    await r.ft.onCtl({ t: "file.offer", fid: "f4", idx: 1, name: "a.bin", size: 10, sha256: "a".repeat(64) });
    r.ft.accept("f4");
    r.ft.onFrame(frame(1, 3, enc("ab")));
    expect(r.list[0]?.status).toBe("corrupt");
  });
  it("aynı fid ile ikinci teklif reddedilir, mevcut transfer değişmez", async () => {
    const r = rig();
    const offer = { t: "file.offer", fid: "f5", idx: 0, name: "a.txt", size: 1, sha256: "a".repeat(64) } as const;
    await r.ft.onCtl(offer);
    await r.ft.onCtl({ ...offer, idx: 9 });
    expect(r.list).toHaveLength(1);
    expect(r.list[0]?.status).toBe("pending");
    expect(r.ft.inCount).toBe(1);
    expect(r.ctl.at(-1)).toEqual({ t: "file.reject", fid: "f5" });
  });
  it("yetki yoksa (G-09) teklif otomatik ret, listede görünmez; ret sonrası 30 sn otomatik ret", async () => {
    const r = rig({ allowed: false });
    await r.ft.onCtl({ t: "file.offer", fid: "x", idx: 0, name: "a", size: 1, sha256: "a".repeat(64) });
    expect(r.list).toHaveLength(0);
    expect(r.ctl.at(-1)).toEqual({ t: "file.reject", fid: "x" });
    let now = 1_000;
    const c = rig({ now: () => now });
    await c.ft.onCtl({ t: "file.offer", fid: "a", idx: 0, name: "a", size: 1, sha256: "a".repeat(64) });
    c.ft.reject("a");
    now += 10_000;
    await c.ft.onCtl({ t: "file.offer", fid: "b", idx: 1, name: "b", size: 1, sha256: "a".repeat(64) });
    expect(c.list.find((x) => x.fid === "b")).toMatchObject({ status: "rejected", auto: "cooldown" });
  });
  it("gönderen sınırı aşan dosyayı teklif etmez", async () => {
    const r = rig({ max: 2 });
    expect(await r.ft.send(new File([enc("abc")], "a.bin"))).toBe("tooLarge");
  });
  it("çift uzantı vurgulanır", () => {
    expect(fileRisk("fatura.pdf.exe")).toEqual({ dangerous: true, double: true });
    expect(fileRisk("rapor.pdf")).toEqual({ dangerous: false, double: false });
  });
});

describe("sohbet (AC-35, 52)", () => {
  it("düz metin saklanır, okunmamış sayılır, uzun metin reddedilir", () => {
    const xss = "<img src=x onerror=alert(1)>";
    let s = chatReducer(initialChat, { type: "in", id: "1", text: xss, ts: 1, visible: false });
    expect(s.items[0]?.text).toBe(xss);
    expect(s.unread).toBe(1);
    s = chatReducer(s, { type: "read" });
    expect(s.unread).toBe(0);
    expect(prepareChat("a".repeat(2001))).toBeNull();
    expect(prepareChat("  ")).toBeNull();
  });
});

describe("işaretleme (AC-56, 57)", () => {
  it("object-contain alanına göre normalize, ≤500 nokta, geri al/temizle, lazer söner", () => {
    const r = contentRect(200, 100, 100, 100);
    expect(r).toEqual({ x: 50, y: 0, w: 100, h: 100 });
    expect(normalize(100, 50, r)).toEqual([0.5, 0.5]);
    expect(normalize(0, 0, r)).toEqual([0, 0]);
    expect(simplify(Array.from({ length: 1200 }, (_, i) => [i / 1200, 0] as [number, number]))).toHaveLength(500);
    let s = annotReducer(initialAnnot, { t: "annot.stroke", id: "a", tool: "pen", color: "red", pts: [[0, 0]] });
    s = annotReducer(s, { t: "annot.stroke", id: "b", tool: "rect", color: "blue", pts: [[0, 0]] });
    expect(annotReducer(s, { t: "annot.undo", id: "b" }).strokes.map((x) => x.id)).toEqual(["a"]);
    expect(annotReducer(s, { t: "annot.clear" }).strokes).toEqual([]);
    expect(laserAlpha({ x: 0, y: 0, at: 0 }, 1000)).toBe(0);
    expect(laserAlpha({ x: 0, y: 0, at: 0 }, 500)).toBeCloseTo(0.5);
  });
});

describe("kalite (AC-44..46)", () => {
  const smp = (at: number, rttMs: number, fps = 30): Sample => ({
    at,
    fps,
    kbps: 1000,
    rttMs,
    lossPct: 0,
    width: 1920,
    height: 1080,
    connType: "relay",
  });
  it("3 sn süren eşik aşımı uyarı, kısa sıçrama değil", () => {
    expect(evaluate([smp(0, 50), smp(1000, 50), smp(2000, 400)]).level).toBe("ok");
    expect(evaluate([0, 1000, 2000, 3000].map((t) => smp(t, 400)))).toEqual({ level: "warn", issues: ["rtt"] });
    expect(evaluate([0, 1000, 2000, 3000].map((t) => smp(t, 50, 1))).level).toBe("bad");
  });
  it("özet ort/min/maks + bağlantı tipi", () => {
    const a = new QualityAgg();
    expect(a.summary()).toBeNull();
    a.add(smp(0, 100, 10));
    a.add(smp(1, 200, 30));
    expect(a.summary()).toEqual({
      t: "quality.summary",
      fps: { avg: 20, min: 10, max: 30 },
      kbps: { avg: 1000, min: 1000, max: 1000 },
      rttMs: { avg: 150, min: 100, max: 200 },
      connType: "relay",
    });
  });
});

describe("kalite örneği — RTCStatsReport (Map olmayan maplike)", () => {
  it("values() ile okunur; FPS, RTT, çözünürlük, bağlantı tipi", () => {
    const recs = [
      {
        id: "v",
        type: "inbound-rtp",
        kind: "video",
        framesPerSecond: 30,
        bytesReceived: 1000,
        packetsLost: 0,
        packetsReceived: 10,
        frameWidth: 1280,
        frameHeight: 720,
      },
      { id: "t", type: "transport", selectedCandidatePairId: "p" },
      { id: "p", type: "candidate-pair", localCandidateId: "l", currentRoundTripTime: 0.012 },
      { id: "l", type: "local-candidate", candidateType: "host" },
    ];
    const m = new Map(recs.map((r) => [r.id, r]));
    // Gerçek tarayıcıdaki gibi: Map örneği değil, [Symbol.iterator] çift döner, values() kayıt döner
    const report = { values: () => m.values(), [Symbol.iterator]: () => m.entries() };
    const s = sampleFromStats(report as never, { c: null }, 1000);
    expect(s).toMatchObject({ fps: 30, rttMs: 12, width: 1280, height: 720, connType: "host" });
  });
});

describe("S-P4-T3-1 dönüş kaydı yaşı", () => {
  it("120 sn'den eski kayıt okunmaz", () => {
    const m = new Map<string, string>();
    const s = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    const rec = { reconnectToken: "x".repeat(43), technicianName: "T", customerName: "C", verifyCode: "1234", sessionRef: "r" };
    writeResume("k", rec, s, 1_000);
    expect(readResume("k", s, 100_000)).toEqual(rec);
    expect(readResume("k", s, 1_000 + 120_001)).toBeNull();
  });
});
