/*
 * Dosya gönderen taraf ("gönder" parçası, lib/dc/files.ts): özet → teklif → kabulde parça pompası; kendi teklif
 * hızı sınırı ve yanıtsız teklif zaman aşımı (TEST-P5-1); gönderen raporu (file.meta) transfer başına bir kez.
 */
import { encodeFileChunk, FILE_BUFFERED_MAX as BUFFER_HIGH, FILE_CHUNK_MAX_PAYLOAD as CHUNK_BYTES } from "@remote/contracts/dc";
import { sanitizeFileName } from "@remote/contracts/files";
import { newId, type CtlMessage, type FileDirection, type FileResult } from "./ctl";
import { fileRisk, OFFER_TIMEOUT_MS, SELF_OFFER_LIMIT, sha256Hex, type OutState, type TransferStore } from "./file-model";

type FidMsg<T extends CtlMessage["t"]> = Extract<CtlMessage, { t: T }>;

export class FileSender {
  private outCount = 0;
  /** Gönderilen tekliflerin zamanları (SELF_OFFER_LIMIT). */
  private sentOffers: number[] = [];

  constructor(private s: TransferStore) {}

  private get d() {
    return this.s.d;
  }

  /** Gönderen raporu (mimari-protokol §3 file.meta): transfer başına bir kez, yön = giden. */
  private senderMeta(st: OutState, result: FileResult) {
    if (st.reported || !st.sha) return;
    st.reported = true;
    const direction: FileDirection = this.d.inbound === "TO_CUSTOMER" ? "TO_TECH" : "TO_CUSTOMER";
    const fileName = sanitizeFileName(st.t.name.slice(0, 255)) || "dosya";
    this.d.sendMeta({
      t: "file.meta",
      fid: st.t.fid,
      direction,
      fileName,
      sizeBytes: Math.min(st.t.size, 2 ** 31),
      sha256: st.sha,
      result,
    });
  }
  private activeOut = () => [...this.s.out.values()].some((o) => ["offered", "hashing", "sending"].includes(o.t.status));

  /** Gönderim başlatır; sonuç: başladı / sınır aşımı / zaten aktif transfer / yetki yok. */
  async send(file: File): Promise<"ok" | "tooLarge" | "busy" | "denied" | "rate"> {
    if (!this.d.allowed()) return "denied";
    if (file.size > this.s.max) return "tooLarge";
    if (this.activeOut()) return "busy";
    const t0 = this.s.now();
    this.sentOffers = this.sentOffers.filter((x) => t0 - x < SELF_OFFER_LIMIT.windowMs);
    if (this.sentOffers.length >= SELF_OFFER_LIMIT.max && this.d.selfThrottle?.() !== false) return "rate";
    const fid = newId();
    const st: OutState = {
      t: { fid, dir: "out", name: file.name, size: file.size, done: 0, status: "hashing", ...fileRisk(file.name) },
      idx: this.outCount++ & 0xffff,
      file,
      sha: "",
      abort: false,
    };
    this.s.out.set(fid, st);
    this.s.put(st.t);
    st.sha = this.d.corruptSha?.() ? "0".repeat(64) : await sha256Hex(file);
    if (st.abort) return "ok";
    this.s.set(st, { status: "offered" });
    this.sentOffers.push(this.s.now());
    st.offerTimer = setTimeout(() => this.offerTimedOut(st), this.d.offerTimeoutMs?.() || OFFER_TIMEOUT_MS);
    this.d.sendCtl({ t: "file.offer", fid, idx: st.idx, name: file.name.slice(0, 255) || "dosya", size: file.size, sha256: st.sha });
    return "ok";
  }

  /** Yanıtsız teklif: alıcıya iptal (ulaştıysa diyaloğu kapanır), gönderen raporu, kilit açılır. */
  private offerTimedOut(st: OutState) {
    st.offerTimer = undefined;
    if (st.t.status !== "offered") return;
    st.abort = true;
    this.s.set(st, { status: "timeout" });
    this.d.sendCtl({ t: "file.cancel", fid: st.t.fid });
    this.senderMeta(st, "CANCELLED");
  }
  private clearOffer(st: OutState) {
    clearTimeout(st.offerTimer);
    st.offerTimer = undefined;
  }

  /** Kullanıcı gönderimi iptal etti. */
  cancel(fid: string) {
    const st = this.s.out.get(fid);
    if (!st || !["hashing", "offered", "sending"].includes(st.t.status)) return;
    st.abort = true;
    this.clearOffer(st);
    this.s.set(st, { status: "cancelled" });
    if (st.sha) {
      this.d.sendCtl({ t: "file.cancel", fid });
      this.senderMeta(st, "CANCELLED");
    }
  }

  async onAccept(m: FidMsg<"file.accept">) {
    const st = this.s.out.get(m.fid);
    if (st?.t.status === "offered") {
      this.clearOffer(st);
      await this.pump(st);
    }
  }
  onReject(m: FidMsg<"file.reject">) {
    const st = this.s.out.get(m.fid);
    if (st?.t.status === "offered") {
      this.clearOffer(st);
      this.s.set(st, { status: "rejected" });
      this.senderMeta(st, "REJECTED");
    }
  }
  /** Karşı taraf iptal etti (giden yön). */
  onCancel(m: FidMsg<"file.cancel">) {
    const o = this.s.out.get(m.fid);
    if (o && ["offered", "sending"].includes(o.t.status)) {
      o.abort = true;
      this.clearOffer(o);
      this.s.set(o, { status: "cancelled" });
      this.senderMeta(o, "CANCELLED");
    }
  }
  onResult(m: FidMsg<"file.result">) {
    const st = this.s.out.get(m.fid);
    if (st?.t.status === "sending") {
      this.s.set(st, { status: m.ok ? "ok" : "corrupt", done: st.t.size });
      this.senderMeta(st, m.ok ? "OK" : "CORRUPT");
    }
  }

  private waitLow(): Promise<void> {
    const ch = this.d.file;
    return new Promise((res) => {
      const fn = () => {
        ch.removeEventListener("bufferedamountlow", fn);
        res();
      };
      ch.addEventListener("bufferedamountlow", fn);
    });
  }

  private async pump(st: OutState) {
    this.s.set(st, { status: "sending" });
    const ch = this.d.file;
    let seq = 0;
    for (let off = 0; off < st.file.size; off += CHUNK_BYTES) {
      if (st.abort || ch.readyState !== "open") return;
      if (ch.bufferedAmount > BUFFER_HIGH) await this.waitLow();
      const delay = this.d.chunkDelayMs?.() ?? 0;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (st.abort || ch.readyState !== "open") return;
      const part = new Uint8Array(await st.file.slice(off, off + CHUNK_BYTES).arrayBuffer());
      ch.send(encodeFileChunk(st.idx, seq++, part) as Uint8Array<ArrayBuffer>);
      this.s.set(st, { done: Math.min(off + part.byteLength, st.t.size) });
    }
    if (!st.abort) this.d.sendCtl({ t: "file.done", fid: st.t.fid });
  }

  /** Bağlantı koptu/oturum bitti: aktif gönderimler durur. */
  dispose() {
    for (const o of this.s.out.values()) {
      o.abort = true;
      this.clearOffer(o);
    }
  }
}
