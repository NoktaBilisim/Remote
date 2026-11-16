// P28e güvenlik tur 2 birim: gömülü EBML/Tracks taraması doğrusal ve bütçeli (Y-P28e-K2-1), parça sınırında bölünmüş gömülü
// başlık (D-P28e-K2-2). Desenler güvenlik ajanının scratchpad betiklerinden (dos.ts / dos2.ts) uyarlandı.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCAN_CHILDREN, SCAN_TAIL_BYTES, checkWebmContinuation, checkWebmHeader } from "../../src/rec/webm.ts";
import { CLUSTER_PART, VIDEO_WEBM, el, track, webm } from "../helpers/rec-webm-k3.ts";

const MiB2 = 2 * 1024 * 1024;
const MAGIC = { ebml: [0x1a, 0x45, 0xdf, 0xa3], tracks: [0x16, 0x54, 0xae, 0x6b] } as const;
type Magic = keyof typeof MAGIC;

/** Güvenlik ajanı deseni: 10 baytlık birim `EC 88 <sihir> 1xxxxxxx` (Void içinde sihir, boyut tamponun sonuna dek). */
function agentPattern(n: number, m: Magic): Buffer {
  const units = Math.floor(n / 10);
  const b = Buffer.alloc(units * 10);
  for (let u = 0; u < units; u++) {
    const o = u * 10;
    const size = b.length - (o + 10);
    b.set([0xec, 0x88, ...MAGIC[m], 0x10 | ((size >>> 24) & 15), (size >>> 16) & 255, (size >>> 8) & 255, size & 255], o);
  }
  return b;
}

/** Yeni algoritmanın en kötüsü: her eşleşmede çocuk bütçesinin hemen altında temiz Void + bozuk bayt (yoklama "miss"). */
function nearBudget(n: number, m: Magic): Buffer {
  const voids = Buffer.alloc((SCAN_CHILDREN - 1) * 2);
  for (let i = 0; i < voids.length; i += 2) voids.set([0xec, 0x80], i); // EC 80 = boyutu 0 olan Void
  const data = Buffer.concat([voids, Buffer.from([0x00])]);
  const unit = Buffer.concat([Buffer.from([0x11, ...MAGIC[m], 0x40, data.length]), data]); // ilk bayt sihir değil
  return Buffer.concat(Array.from({ length: Math.ceil(n / unit.length) }, () => unit)).subarray(0, n);
}

/** Sık çıplak sihir: boyut vint'i geçersiz (0x00) → element ayrışmaz, bütçe tüketmez; kabul edilir. Doğrusal büyüme ölçüsü. */
function bareMagic(n: number, m: Magic): Buffer {
  const unit = Buffer.from([0x11, ...MAGIC[m], 0x00, 0x22]); // ilk bayt sihir değil (o kesin ret kuralı)
  return Buffer.concat(Array.from({ length: Math.ceil(n / unit.length) }, () => unit)).subarray(0, n);
}

/** Isınma + en iyi 3 koşu (ms). */
function bestMs(b: Buffer): number {
  checkWebmContinuation(b, false);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    checkWebmContinuation(b, false);
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

/** Belirlenimci PRNG (xorshift32) — kararsız test olmasın. */
function prng(seed: number): (n: number) => Buffer {
  let x = seed >>> 0 || 1;
  return (n) => {
    const b = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      b[i] = x & 0xff;
    }
    return b;
  };
}

const real = (n: number): Buffer => readFileSync(new URL(`../fixtures/rec-chromium/p${n}.webm`, import.meta.url));

describe("Y-P28e-K2-1 gömülü tarama doğrusal ve bütçeli", () => {
  it.each(["ebml", "tracks"] as const)("Y-P28e-K2-1 ajan deseni (%s) 2 MiB: ret ve < 200 ms", (m) => {
    const b = agentPattern(MiB2, m);
    const t = performance.now();
    const v = checkWebmContinuation(b, false);
    expect(performance.now() - t).toBeLessThan(200);
    expect(v).toMatchObject({ ok: false, reason: m });
  });

  it.each(["ebml", "tracks"] as const)("Y-P28e-K2-1 bütçe sınırında her eşleşme (%s) 2 MiB: toplam bütçe → ret, < 200 ms", (m) => {
    const b = nearBudget(MiB2, m);
    const t = performance.now();
    const v = checkWebmContinuation(b, false);
    expect(performance.now() - t).toBeLessThan(200);
    expect(v).toMatchObject({ ok: false, reason: m });
  });

  it.each(["ebml", "tracks"] as const)("Y-P28e-K2-1 sık çıplak sihir (%s): kabul, 2 MiB < 200 ms, büyüme doğrusal (oran < 15)", (m) => {
    const big = bareMagic(MiB2, m);
    const small = bareMagic(200_000, m);
    expect(checkWebmContinuation(big, false)).toEqual({ ok: true });
    const tBig = bestMs(big);
    const tSmall = bestMs(small);
    expect(tBig).toBeLessThan(200);
    expect(tBig / Math.max(tSmall, 1)).toBeLessThan(15);
  });

  it("Y-P28e-K2-1 ajan deseni büyümesi doğrusal: 2 MiB / 200 kB < 15", () => {
    const tBig = bestMs(agentPattern(MiB2, "ebml"));
    const tSmall = bestMs(agentPattern(200_000, "ebml"));
    expect(tBig / Math.max(tSmall, 1)).toBeLessThan(15);
  });

  it("Y-P28e-K2-1 Void dolgusu çocuk bütçesini aşarsa DocType'a varmadan ret (atlatma yok)", () => {
    const pad = Array.from({ length: SCAN_CHILDREN + 1 }, () => Buffer.from([0xec, 0x80]));
    const hdr = el(0x1a45dfa3, ...pad, el(0x4282, Buffer.from("webm")));
    expect(checkWebmContinuation(Buffer.concat([Buffer.from([0x00]), hdr, Buffer.alloc(100, 0x11)]), false)).toMatchObject({
      ok: false,
      reason: "ebml",
    });
  });

  it("Y-P28e-K2-1 yanlış pozitif yok: gerçek Chromium parçaları (kuyrukla da) ve rastgele veriye enjekte sihir", () => {
    for (const n of [1, 3]) expect(checkWebmContinuation(real(n))).toEqual({ ok: true });
    expect(checkWebmContinuation(real(1), undefined, real(0).subarray(-SCAN_TAIL_BYTES))).toEqual({ ok: true });
    expect(checkWebmContinuation(real(3), undefined, real(1).subarray(-SCAN_TAIL_BYTES))).toEqual({ ok: true });
    const rnd = prng(0x5eed);
    let rejected = 0;
    for (let i = 0; i < 300; i++) {
      const b = rnd(64 * 1024);
      const pos = rnd(4).readUInt32BE(0) % (b.length - 4);
      b.set(i % 2 ? MAGIC.ebml : MAGIC.tracks, pos);
      if (b.readUInt32BE(0) === 0x1a45dfa3) continue; // ilk bayt sihri ayrı kural (kesin ret)
      if (!checkWebmContinuation(b, false).ok) rejected++;
    }
    expect(rejected).toBe(0);
  });
});

describe("D-P28e-K2-2 parça sınırında bölünmüş gömülü başlık", () => {
  const hdr = webm([track(1, "V_VP8"), track(2, "A_OPUS")]).subarray(0, 40); // EBML başlığı + Segment başı
  const filler = Buffer.alloc(200, 0x11);

  it("D-P28e-K2-2 başlık parça sonunda kesik (sihir + boyut bu parçada) → ret", () => {
    const head = webm([track(1, "V_VP8")]);
    const ebmlLen = 4 + 1 + (head[4] ?? 0) - 0x80;
    for (const cut of [6, 10, ebmlLen - 1]) {
      expect(checkWebmContinuation(Buffer.concat([filler, head.subarray(0, cut)]), false)).toMatchObject({ ok: false, reason: "ebml" });
    }
    // Sihir + kesik boyut vint'i (2 baytlık vint'in ilk baytı) da ret.
    expect(checkWebmContinuation(Buffer.concat([filler, Buffer.from([...MAGIC.ebml, 0x40])]), false)).toMatchObject({ ok: false });
  });

  it("D-P28e-K2-2 sihrin kendisi sınırda bölünürse önceki parçanın kuyruğuyla yakalanır", () => {
    const prev = Buffer.concat([filler, hdr.subarray(0, 2)]);
    const next = Buffer.concat([hdr.subarray(2), filler]);
    expect(checkWebmContinuation(prev, false)).toEqual({ ok: true });
    expect(checkWebmContinuation(next, false)).toEqual({ ok: true }); // kuyruksuz: görünmez
    expect(checkWebmContinuation(next, false, prev.subarray(-SCAN_TAIL_BYTES))).toMatchObject({ ok: false, reason: "ebml" });
    const tr = el(0x1654ae6b, track(2, "A_OPUS"));
    const p2 = Buffer.concat([filler, tr.subarray(0, 3)]);
    const n2 = Buffer.concat([tr.subarray(3), filler]);
    expect(checkWebmContinuation(n2, false, p2.subarray(-SCAN_TAIL_BYTES))).toMatchObject({ ok: false, reason: "tracks" });
  });

  it("D-P28e-K2-2 tam gömülü video WebM ve kuyruklu temiz parça davranışı değişmez", () => {
    expect(checkWebmContinuation(Buffer.concat([Buffer.from([0x00]), VIDEO_WEBM()]), false)).toMatchObject({ ok: false });
    expect(checkWebmContinuation(filler, false, filler.subarray(-SCAN_TAIL_BYTES))).toEqual({ ok: true });
  });

  it("D-P28e-K2-2 kuyrukta tamamen kalan meşru p=0 Tracks'ı p=1'de yeniden yargılanmaz (yanlış durdurma yok)", () => {
    const full = VIDEO_WEBM();
    const tracksAt = full.indexOf(Buffer.from(MAGIC.tracks));
    const tracksEnd = tracksAt + 4 + 1 + (full[tracksAt + 4] ?? 0) - 0x80;
    const p0 = full.subarray(0, tracksEnd); // yalnız başlık içeren ilk parça: Tracks son 64 baytta
    expect(p0.length - tracksAt).toBeLessThanOrEqual(SCAN_TAIL_BYTES);
    expect(checkWebmContinuation(CLUSTER_PART(), false, p0.subarray(-SCAN_TAIL_BYTES))).toEqual({ ok: true });
  });
});

describe("D-P28e-K3-1 p=0: Tracks sonrası gövde gömülü EBML/Tracks için taranır", () => {
  it("D-P28e-K3-1 geçerli video başlığı + ardına eklenmiş ikinci (ses izli) WebM → ret", () => {
    expect(checkWebmHeader(Buffer.concat([VIDEO_WEBM(), webm([track(1, "A_OPUS")])]))).toMatchObject({ ok: false, reason: "ebml" });
    expect(checkWebmHeader(Buffer.concat([VIDEO_WEBM(), el(0x1654ae6b, track(2, "A_OPUS"))]))).toMatchObject({
      ok: false,
      reason: "tracks",
    });
  });

  it.each(["ebml", "tracks"] as const)("D-P28e-K3-1 p=0 sonrasında kötü niyetli 2 MiB desen (%s) → ret, < 200 ms", (m) => {
    for (const pat of [agentPattern(MiB2, m), nearBudget(MiB2, m)]) {
      const b = Buffer.concat([VIDEO_WEBM(), pat]);
      const t = performance.now();
      const v = checkWebmHeader(b);
      expect(performance.now() - t).toBeLessThan(200);
      expect(v).toMatchObject({ ok: false, reason: m });
    }
  });

  it("D-P28e-K3-1 yanlış pozitif yok: gerçek Chromium p0 ve tek video WebM kabul", () => {
    expect(checkWebmHeader(real(0))).toEqual({ ok: true });
    expect(checkWebmHeader(VIDEO_WEBM())).toEqual({ ok: true });
  });
});
