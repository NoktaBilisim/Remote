import { describe, expect, it } from "vitest";
import { encodeFileChunk } from "@remote/contracts/dc";
import { AUTO_KEEP, FileTransfers, OFFER_LIMIT, PEER_META_LIMIT, sha256Hex, type FileChannelLike, type Transfer } from "./files";
import { Sha256 } from "./sha256";
import { inboundLimiter, IN_LIMITS } from "./rate";
import type { CtlMessage, FileMetaMsg } from "./ctl";

const hexOf = async (u: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", u.slice()))].map((b) => b.toString(16).padStart(2, "0")).join("");
const frame = (idx: number, seq: number, p: Uint8Array) => encodeFileChunk(idx, seq, p).slice().buffer as ArrayBuffer;
const SHA = "a".repeat(64);

function rig(clock: { t: number }, inbound: "TO_CUSTOMER" | "TO_TECH" = "TO_CUSTOMER") {
  const ctl: CtlMessage[] = [];
  const meta: FileMetaMsg[] = [];
  let list: Transfer[] = [];
  const file: FileChannelLike = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    send: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const ft = new FileTransfers({
    inbound,
    file,
    sendCtl: (m) => ctl.push(m),
    sendMeta: (m) => meta.push(m),
    onChange: (l) => (list = l),
    allowed: () => true,
    now: () => clock.t,
  });
  return {
    ft,
    ctl,
    meta,
    get list() {
      return list;
    },
  };
}
type Offer = Extract<CtlMessage, { t: "file.offer" }>;
const offer = (fid: string, idx = 0, size = 1, sha = SHA): Offer => ({ t: "file.offer", fid, idx, name: `${fid}.txt`, size, sha256: sha });

describe("S-P5-4 artımlı SHA-256", () => {
  it("WebCrypto ile aynı; parça sınırlarından bağımsız", async () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70_000]) {
      const d = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
      const h = new Sha256();
      for (let o = 0; o < n; o += 37) h.update(d.subarray(o, o + 37));
      expect(h.hex()).toBe(await hexOf(d));
      expect(await sha256Hex(new Blob([d]))).toBe(await hexOf(d));
    }
  });
});

describe("S-P5-1/2 teklif seli", () => {
  it("10 sn'de en çok 3 teklif işlenir; aşan sessizce düşer (ret/meta/liste yok)", async () => {
    const c = { t: 0 };
    const r = rig(c);
    for (let i = 0; i < 10; i++) await r.ft.onCtl(offer(`f${i}`, i));
    expect(r.ft.dropped).toBe(10 - OFFER_LIMIT.max);
    expect(r.list).toHaveLength(OFFER_LIMIT.max);
    expect(r.ctl.filter((m) => m.t === "file.reject")).toHaveLength(OFFER_LIMIT.max - 1); // ilki bekliyor, diğerleri busy
    c.t += OFFER_LIMIT.windowMs;
    await r.ft.onCtl(offer("yeni", 50));
    expect(r.list.some((x) => x.fid === "yeni")).toBe(true);
  });
  it("21 sahte teklif + gerçek transfer → OK raporu gider; otomatik ret raporu dakikada ≤5 ve tekil", async () => {
    const c = { t: 0 };
    const r = rig(c);
    const data = new TextEncoder().encode("gercek");
    const sha = await sha256Hex(data.slice().buffer);
    await r.ft.onCtl({ ...offer("A", 0, data.length, sha), name: "A.txt" });
    for (let i = 1; i <= 21; i++) {
      c.t += 3_400; // sınırın altında kalacak hızda
      await r.ft.onCtl(offer(`s${i % 3}`.concat(String(i)), i));
    }
    const rej = r.meta.filter((m) => m.result === "REJECTED");
    expect(rej.length).toBeLessThanOrEqual(PEER_META_LIMIT.max * 2); // 71 sn → en çok iki pencere
    await r.ft.accept("A");
    r.ft.onFrame(frame(0, 0, data));
    await r.ft.onCtl({ t: "file.done", fid: "A" });
    expect(r.meta.at(-1)).toMatchObject({ result: "OK", fileName: "A.txt" });
  });
  it("aynı teklifin yinelenen otomatik reddi tek rapor", async () => {
    const c = { t: 0 };
    const r = rig(c);
    await r.ft.onCtl(offer("bekleyen"));
    for (let i = 0; i < 4; i++) {
      c.t += 4_000;
      await r.ft.onCtl({ ...offer(`x${i}`, i + 1), name: "ayni.txt" });
    }
    expect(r.meta.filter((m) => m.fileName === "ayni.txt")).toHaveLength(1);
  });
  it("onay beklerken iptal seli sınırlı rapor üretir; liste otomatik ret satırlarını sınırlar", async () => {
    const c = { t: 0 };
    const r = rig(c);
    for (let i = 0; i < 30; i++) {
      c.t += 4_000;
      await r.ft.onCtl(offer(`p${i}`, i, i + 1));
      await r.ft.onCtl({ t: "file.cancel", fid: `p${i}` });
    }
    // 120 sn → en çok 2–3 pencere
    expect(r.meta.filter((m) => m.result === "CANCELLED").length).toBeLessThanOrEqual(PEER_META_LIMIT.max * 3);
    const b = rig(c);
    await b.ft.onCtl(offer("bekleyen"));
    for (let i = 0; i < 40; i++) {
      c.t += 4_000;
      await b.ft.onCtl(offer(`z${i}`, i + 1));
    }
    expect(b.list.filter((x) => x.auto).length).toBe(AUTO_KEEP);
    expect(b.list.some((x) => x.fid === "bekleyen" && x.status === "pending")).toBe(true);
  });
});

describe("S-P5-3 gönderen raporu", () => {
  it("transfer sonunda gönderen de file.meta gönderir (yön = giden); ret ve iptal de raporlanır", async () => {
    const c = { t: 0 };
    const r = rig(c, "TO_TECH"); // konsol: gelen TO_TECH → giden (gönderen raporu) TO_CUSTOMER
    expect(await r.ft.send(new File(["abc"], "a.txt"))).toBe("ok");
    const fid = (r.ctl.find((m) => m.t === "file.offer") as { fid: string }).fid;
    await r.ft.onCtl({ t: "file.accept", fid });
    await r.ft.onCtl({ t: "file.result", fid, ok: true });
    await r.ft.onCtl({ t: "file.result", fid, ok: true }); // yineleme → ikinci rapor yok
    expect(r.meta).toEqual([
      expect.objectContaining({
        direction: "TO_CUSTOMER",
        fileName: "a.txt",
        sizeBytes: 3,
        result: "OK",
        sha256: await sha256Hex(new Blob(["abc"])),
      }),
    ]);
    c.t += 1;
    await r.ft.send(new File(["x"], "b.txt"));
    const fid2 = (r.ctl.filter((m) => m.t === "file.offer").at(-1) as { fid: string }).fid;
    await r.ft.onCtl({ t: "file.reject", fid: fid2 });
    expect(r.meta.at(-1)).toMatchObject({ fileName: "b.txt", result: "REJECTED" });
  });
});

describe("S-P5-5 indirme türü", () => {
  it("doğrulanmış dosyanın Blob'u application/octet-stream", async () => {
    const urls: Blob[] = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b: Blob) => (urls.push(b), "blob:x");
    try {
      const r = rig({ t: 0 });
      const d = new TextEncoder().encode("<html>");
      await r.ft.onCtl(offer("h", 0, d.length, await sha256Hex(d.slice().buffer)));
      await r.ft.accept("h");
      r.ft.onFrame(frame(0, 0, d));
      await r.ft.onCtl({ t: "file.done", fid: "h" });
      expect(urls[0]?.type).toBe("application/octet-stream");
      expect(await urls[0]?.text()).toBe("<html>");
    } finally {
      URL.createObjectURL = orig;
    }
  });
});

describe("S-P5-6 gelen chat/annot hız sınırı", () => {
  it("chat 10/sn (gönderen 5/sn × 2, AC-227), çizim 30/sn, lazer 30/sn; pencere geçince yeniden", () => {
    let t = 0;
    const allow = inboundLimiter(() => t);
    const count = (k: string, n: number) => Array.from({ length: n }, () => allow(k)).filter(Boolean).length;
    expect(count("chat", 20)).toBe(IN_LIMITS.chat);
    expect(count("annot.stroke", 100)).toBe(IN_LIMITS.annot);
    expect(count("annot.laser", 100)).toBe(IN_LIMITS.laser);
    expect(allow("file.offer")).toBe(true);
    t = 1000;
    expect(allow("chat")).toBe(true);
  });
});
