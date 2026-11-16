// P28e K3 birim: WebM başlık denetimi (AC-375, S-P28e-7), parça kabul kararı (S-P28e-1/2, §5.1, §7), sınırlar (S-P28e-3/5),
// P28b `.rsf` biçiminin kayıt parçasıyla gidiş-dönüşü (K-P28e-6).
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REC_PUT_CONCURRENCY, REC_PUT_PER_MIN, REC_STOP_GRACE_MS, REC_VIEW_BURST_PARTS } from "@remote/contracts/ws-rec";
import { FSRV_CHUNK_BYTES } from "@remote/contracts/ws-fsrv";
import { BoxError, chunkOffset, makeHeader, openBox, sealChunk } from "../../src/fsrv/box.ts";
import { decidePart, type DecideInput } from "../../src/rec/accept.ts";
import { PutGate, ViewBuckets } from "../../src/rec/limits.ts";
import { checkWebmContinuation, checkWebmHeader } from "../../src/rec/webm.ts";
import { CLUSTER_PART, VIDEO_WEBM, el, track, webm } from "../helpers/rec-webm-k3.ts";
import type { RoomRec } from "../../src/rec/types.ts";

describe("AC-375 webm.ts başlık denetimi", () => {
  it("AC-375 tek VP8/VP9 video izi geçer", () => {
    expect(checkWebmHeader(VIDEO_WEBM())).toEqual({ ok: true });
    expect(checkWebmHeader(webm([track(1, "V_VP9")]))).toEqual({ ok: true });
  });
  it("AC-375 ses izi, ikinci iz, başka kodek, matroska, Tracks'tan önce Cluster, bozuk EBML reddedilir", () => {
    expect(checkWebmHeader(webm([track(1, "V_VP8"), track(2, "A_OPUS")]))).toMatchObject({ ok: false, reason: "audio" });
    expect(checkWebmHeader(webm([track(2, "A_OPUS")]))).toMatchObject({ ok: false, reason: "audio" });
    expect(checkWebmHeader(webm([track(1, "V_VP8"), track(1, "V_VP8")]))).toMatchObject({ ok: false, reason: "track_count" });
    expect(checkWebmHeader(webm([track(1, "V_MPEG4/ISO/AVC")]))).toMatchObject({ ok: false, reason: "codec" });
    expect(checkWebmHeader(webm([track(1, "V_VP8")], "matroska"))).toMatchObject({ ok: false, reason: "doctype" });
    expect(checkWebmHeader(webm([track(1, "V_VP8")], "webm", true))).toMatchObject({ ok: false, reason: "tracks" });
    expect(checkWebmHeader(webm([]))).toMatchObject({ ok: false, reason: "track_count" });
    expect(checkWebmHeader(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]))).toMatchObject({ ok: false, reason: "ebml" });
    expect(checkWebmHeader(randomBytes(512))).toMatchObject({ ok: false });
    expect(checkWebmHeader(VIDEO_WEBM().subarray(0, 40))).toMatchObject({ ok: false });
  });
  it("S-P28e-7 p>0: EBML sihri kesin ret; Cluster kuralı yalnız bayrakla", () => {
    expect(checkWebmContinuation(VIDEO_WEBM())).toMatchObject({ ok: false });
    expect(checkWebmContinuation(CLUSTER_PART())).toEqual({ ok: true });
    expect(checkWebmContinuation(randomBytes(100).fill(1, 0, 4))).toEqual({ ok: true });
    expect(checkWebmContinuation(randomBytes(100).fill(1, 0, 4), true)).toMatchObject({ ok: false });
  });
  // Gerçek Chromium (Playwright, `video/webm;codecs=vp8`, canvas, timeslice 1 sn) parçaları: p>0 element ortasından başlar
  // (ör. `46e1 a1 …` = önceki parçada kalan BlockGroup kimliğinin boyut vint'i + Block) → ilk bayt kimlik denetimi yanlış ret olur.
  const real = (n: number): Buffer => readFileSync(new URL(`../fixtures/rec-chromium/p${n}.webm`, import.meta.url));
  it("D-P28e-K1-2 gerçek Chromium parçaları: p=0 başlık geçer, p>0 (Cluster ile başlamayan) geçer — yanlış pozitif yok", () => {
    expect(checkWebmHeader(real(0))).toEqual({ ok: true });
    for (const n of [1, 3]) {
      expect(real(n).readUInt32BE(0)).not.toBe(0x1f43b675);
      expect(checkWebmContinuation(real(n))).toEqual({ ok: true });
    }
  });
  it("D-P28e-K1-2 p>0 gövdesinde gömülü WebM (ses izli) ya da Tracks reddedilir; çıplak 4 bayt sihir eşleşmesi reddedilmez", () => {
    const audio = webm([track(1, "V_VP8"), track(2, "A_OPUS")]);
    expect(checkWebmContinuation(Buffer.concat([Buffer.from([0x00]), audio]))).toMatchObject({ ok: false, reason: "ebml" });
    expect(checkWebmContinuation(Buffer.concat([real(1), VIDEO_WEBM()]))).toMatchObject({ ok: false, reason: "ebml" });
    const tracks = el(0x1654ae6b, track(2, "A_OPUS"));
    expect(checkWebmContinuation(Buffer.concat([real(1).subarray(0, 500), tracks, real(3)]))).toMatchObject({
      ok: false,
      reason: "tracks",
    });
    const bare = Buffer.from(real(1));
    bare.write("1a45dfa3", 1000, "hex");
    bare.write("1654ae6b", 2000, "hex");
    expect(checkWebmContinuation(bare)).toEqual({ ok: true });
  });
});

const T0 = 1_800_000_000_000;
const room = (o: Partial<RoomRec> = {}): RoomRec => ({
  rid: "R",
  basis: "consent",
  state: "active",
  recorderConnId: "c",
  series: 0,
  nextPart: 0,
  lastPartAt: undefined,
  ...o,
});
const base = (o: Partial<DecideInput> = {}): DecideInput => ({
  rec: { state: "ACTIVE", startedAt: new Date(T0), stoppedAt: null, durationMs: 0, sizeBytes: 0 },
  room: room(),
  last: null,
  exists: false,
  s: 0,
  p: 0,
  durationMs: 5000,
  size: 1000,
  seriesStartMs: T0,
  now: T0 + 6000,
  ...o,
});

describe("AC-383 parça kabul kararı (§5.1, §5.3)", () => {
  it("AC-383 ilk parça, sıra, idempotans, yeni bölüm kuralı, ofset sınırlama", () => {
    expect(decidePart(base())).toEqual({ kind: "accept", offsetMs: 0, next: 1 });
    const last = { series: 0, count: 3, offsetMs: 0, durationMs: 15_000 };
    const busy = { rec: { state: "ACTIVE", startedAt: new Date(T0), stoppedAt: null, durationMs: 15_000, sizeBytes: 3000 } };
    expect(decidePart(base({ ...busy, last, p: 3, seriesStartMs: undefined, now: T0 + 20_000 }))).toEqual({
      kind: "accept",
      offsetMs: 15_000,
      next: 4,
    });
    expect(decidePart(base({ ...busy, last, p: 5, now: T0 + 20_000 }))).toEqual({ kind: "order", next: 3 });
    expect(decidePart(base({ last, p: 1, exists: true }))).toEqual({ kind: "dup", next: 3 });
    expect(decidePart(base({ ...busy, last, s: 1, p: 2, now: T0 + 20_000 }))).toEqual({ kind: "conflict" });
    // İstemci saati geçmişte → son parça bitişine; gelecekte → now'a sınırlanır.
    expect(decidePart(base({ ...busy, last, s: 2, p: 0, seriesStartMs: T0, now: T0 + 30_000 }))).toMatchObject({ offsetMs: 15_000 });
    expect(decidePart(base({ ...busy, last, s: 2, p: 0, seriesStartMs: T0 + 99_999, now: T0 + 30_000 }))).toMatchObject({
      offsetMs: 30_000,
    });
  });
  it("S-P28e-1 durma payı: aynı bölüm, ≤ 4 parça, süre sınırı; yeni bölüm ve pay sonrası 404", () => {
    const last = { series: 0, count: 2, offsetMs: 0, durationMs: 10_000 };
    const stopped = { state: "STOPPED", startedAt: new Date(T0), stoppedAt: new Date(T0 + 12_000), durationMs: 10_000, sizeBytes: 2000 };
    const r = room({ state: "stopped", stopSeries: 0, stopNext: 2, stoppedAt: T0 + 12_000 });
    const g = (o: Partial<DecideInput>) => decidePart(base({ rec: stopped, room: r, last, now: T0 + 13_000, durationMs: 2000, ...o }));
    expect(g({ p: 2 })).toMatchObject({ kind: "accept" });
    expect(g({ s: 1, p: 0 })).toEqual({ kind: "gone", result: "stopped" });
    expect(g({ p: 2, durationMs: 5000 })).toEqual({ kind: "gone", result: "stopped" }); // 10 + 5 > 12 + 2 sn
    expect(g({ p: 2, now: T0 + 12_000 + REC_STOP_GRACE_MS + 1 })).toEqual({ kind: "gone", result: "stopped" });
    const far = { series: 0, count: 6, offsetMs: 0, durationMs: 10_000 };
    expect(g({ p: 6, last: far })).toEqual({ kind: "gone", result: "stopped" }); // 6 ≥ stopNext + 4
    expect(decidePart(base({ room: undefined }))).toEqual({ kind: "gone", result: "gone" });
  });
  it("S-P28e-2 kaynak eş yokken yalnız uçuştaki tek parça", () => {
    const last = { series: 0, count: 2, offsetMs: 0, durationMs: 10_000 };
    const rec = { state: "ACTIVE", startedAt: new Date(T0), stoppedAt: null, durationMs: 10_000, sizeBytes: 2000 };
    const r = room({ sourceGone: { at: T0 + 11_000, series: 0, next: 2 } });
    const tail = { rec, room: r, last, p: 2, seriesStartMs: undefined, durationMs: 1500, now: T0 + 12_000 };
    expect(decidePart(base(tail))).toMatchObject({ kind: "accept", offsetMs: 10_000 }); // 10 + 1,5 ≤ 11 + 2 sn
    expect(decidePart(base({ ...tail, durationMs: 5000 }))).toEqual({ kind: "gone", result: "nosource" }); // 15 > 13 sn
    expect(decidePart(base({ ...tail, now: T0 + 11_000 + REC_STOP_GRACE_MS + 1 }))).toEqual({ kind: "gone", result: "nosource" });
    expect(decidePart(base({ rec, room: r, last, s: 1, p: 0, now: T0 + 12_000 }))).toEqual({ kind: "gone", result: "nosource" });
  });
  it("D-P28e-K1-1 kaynak eş yokken (next ilerlemez) ikinci parça nosource, aynı parça dup", () => {
    const r = room({ series: 0, nextPart: 3, sourceGone: { at: T0 + 11_000, series: 0, next: 2 } });
    const rec = { state: "ACTIVE", startedAt: new Date(T0), stoppedAt: null, durationMs: 11_000, sizeBytes: 3000 };
    const last = { series: 0, count: 3, offsetMs: 0, durationMs: 11_000 };
    const next = { rec, room: r, last, seriesStartMs: undefined, durationMs: 500, now: T0 + 12_500 };
    expect(decidePart(base({ ...next, p: 3 }))).toEqual({ kind: "gone", result: "nosource" });
    expect(decidePart(base({ ...next, p: 2, exists: true }))).toEqual({ kind: "dup", next: 3 });
  });
  it("AC-384 oran tavanı ve S-P28e-7 süre şişirme", () => {
    const rec = { state: "ACTIVE", startedAt: new Date(T0), stoppedAt: null, durationMs: 0, sizeBytes: 33_554_000 };
    expect(decidePart(base({ rec, size: 2_000_000 }))).toEqual({ kind: "rate" });
    expect(decidePart(base({ durationMs: 15_000, now: T0 + 1000 }))).toMatchObject({ kind: "accept" });
    const long = { state: "ACTIVE", startedAt: new Date(T0), stoppedAt: null, durationMs: 15_000, sizeBytes: 1 };
    const last = { series: 0, count: 1, offsetMs: 0, durationMs: 15_000 };
    expect(decidePart(base({ rec: long, last, p: 1, seriesStartMs: undefined, durationMs: 15_000, now: T0 + 1000 }))).toEqual({
      kind: "invalid",
    });
  });
});

describe("S-P28e-3/5 bellek sınırları", () => {
  it("S-P28e-5 tek uçuş, dakikada 30 PUT, semafor; bırakma idempotent", () => {
    const g = new PutGate();
    const rel = g.enter("a", 0);
    expect(rel).not.toBeNull();
    expect(g.enter("a", 1)).toBeNull();
    rel?.();
    rel?.();
    expect(g.busy).toBe(0);
    for (let i = 1; i < REC_PUT_PER_MIN; i++) g.enter("a", i)?.();
    expect(g.enter("a", 100)).toBeNull();
    expect(g.enter("a", 60_001)).not.toBeNull();
    const s = new PutGate(2);
    s.enter("x", 0);
    s.enter("y", 0);
    expect(s.enter("z", 0)).toBeNull();
    expect(REC_PUT_CONCURRENCY).toBe(32);
  });
  it("S-P28e-3 kova: 126 jeton, sonra Retry-After; dolum 24/dk", () => {
    const b = new ViewBuckets();
    for (let i = 0; i < REC_VIEW_BURST_PARTS; i++) expect(b.take("u:r", T0)).toBe(0);
    expect(b.take("u:r", T0)).toBeGreaterThan(0);
    expect(b.take("u:r", T0 + 2600)).toBe(0);
    expect(b.take("v:r", T0)).toBe(0);
  });
});

describe("AC-383 P28b .rsf kayıt parçasıyla (K-P28e-6)", () => {
  const keys = { deriveFileKey: () => Buffer.alloc(32, 7) };
  const roundtrip = async (size: number): Promise<Buffer> => {
    const plain = randomBytes(size);
    const header = makeHeader(1, size);
    const sealed: Buffer[] = [];
    for (let n = 0; n * FSRV_CHUNK_BYTES < size; n++)
      sealed.push(sealChunk(keys.deriveFileKey(), header, size, n, plain.subarray(n * FSRV_CHUNK_BYTES, (n + 1) * FSRV_CHUNK_BYTES)));
    const file = Buffer.concat([header, ...sealed]);
    expect(chunkOffset(0)).toBe(header.length);
    const fh = {
      read: async (buf: Buffer, off: number, len: number, pos: number) => {
        const n = file.copy(buf, off, pos, Math.min(pos + len, file.length));
        return { bytesRead: Math.max(0, n) };
      },
    };
    const out: Buffer[] = [];
    // @ts-expect-error -- test: FileHandle'ın yalnız `read`i kullanılır
    for await (const seg of openBox(fh, { keys, keyVer: 1, plainSize: size, tenantId: "T", fid: "F" })) out.push(seg);
    const got = Buffer.concat(out);
    expect(got.equals(plain)).toBe(true);
    expect(file.includes(plain.subarray(0, 32))).toBe(false);
    return file;
  };
  it("AC-383 2 MiB ve 64 KiB'e hizasız boy gidiş-dönüş; bozulma BoxError", async () => {
    await roundtrip(2_097_152);
    await roundtrip(65_536 * 3 + 17);
    const f = await roundtrip(1000);
    f[60] = (f[60] ?? 0) ^ 1;
    const fh = { read: async (buf: Buffer, off: number, len: number, pos: number) => ({ bytesRead: f.copy(buf, off, pos, pos + len) }) };
    const it2 = async () => {
      // @ts-expect-error -- test: FileHandle'ın yalnız `read`i kullanılır
      for await (const _ of openBox(fh, { keys, keyVer: 1, plainSize: 1000, tenantId: "T", fid: "F" })) void _;
    };
    await expect(it2()).rejects.toBeInstanceOf(BoxError);
  });
});
