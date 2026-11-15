/*
 * Dosya gönderen taraf ("gönder" parçası, lib/dc/files.ts): özet → teklif → kabulde parça pompası; kendi teklif
 * hızı sınırı ve yanıtsız teklif zaman aşımı (TEST-P5-1); gönderen raporu (file.meta) transfer başına bir kez.
 */
import { sanitizeFileName } from "@remote/contracts/files";
import { pumpChunks } from "./chunk-sender";
import { newId, type CtlMessage, type FileDirection, type FileResult } from "./ctl";
import { fileRisk, OFFER_TIMEOUT_MS, SELF_OFFER_LIMIT, sha256Hex, type OutState, type TransferStore } from "./file-model";

type FidMsg<T extends CtlMessage["t"]> = Extract<CtlMessage, { t: T }>;

export class FileSender {
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
    // O-P28a-2 / §4.4: yön başına tek aktif aktarım — yazdırma aktarımı sürerken dosya teklifi başlamaz
    if (this.activeOut() || this.d.extBusy?.()) return "busy";
    const t0 = this.s.now();
    this.sentOffers = this.sentOffers.filter((x) => t0 - x < SELF_OFFER_LIMIT.windowMs);
    if (this.sentOffers.length >= SELF_OFFER_LIMIT.max && this.d.selfThrottle?.() !== false) return "rate";
    const fid = newId();
    const st: OutState = {
      t: { fid, dir: "out", name: file.name, size: file.size, done: 0, status: "hashing", ...fileRisk(file.name) },
      idx: this.s.nextIdx(),
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

  private async pump(st: OutState) {
    this.s.set(st, { status: "sending" });
    const done = await pumpChunks(this.d.file, st.idx, st.file, {
      aborted: () => st.abort,
      onProgress: (n) => this.s.set(st, { done: n }),
      delayMs: this.d.chunkDelayMs,
    });
    if (done) this.d.sendCtl({ t: "file.done", fid: st.t.fid });
  }

  /** Bağlantı koptu/oturum bitti: aktif gönderimler durur. */
  dispose() {
    for (const o of this.s.out.values()) {
      o.abort = true;
      this.clearOffer(o);
    }
  }
}
