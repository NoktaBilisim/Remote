/*
 * P28b sunucu üzerinden dosya aktarımı (mimari-p28b §5, §9; AC-355..360, 363). `lib/dc/files.ts` `FileTransfers` ile aynı
 * dış yüz (liste `Transfer[]`, gönder/kabul/ret/iptal) → `files-panel.tsx` ve kabul diyaloğu (AC-36/116) aynen kullanılır.
 * Bayt WS'den geçmez: WS yalnız kimlik/boyut/özet/durum (`fsrv.*`), içerik HTTPS (`upload.ts`, `download.ts`; Bearer belirteç).
 * Akış (gönderen): özet → `fsrv.init{xid}` → `fsrv.upload{fid, token}` → sıralı PUT → `fsrv.status` SCANNING → CLEAN (teklif
 * açık, "Müşteri onayı bekleniyor") → DELIVERED / REJECTED / INFECTED / SCAN_FAILED … Alıcı: `fsrv.offer` → mevcut diyalog →
 * `fsrv.accept` → `fsrv.download{token}` → akış + SHA-256 → `fsrv.result{ok}`.
 * Durum WS oturumuna bağlıdır (DataChannel yeniden kurulsa da yükleme sürer). Yazdırma belgesi (`purpose: "PRINT"`) listeye
 * girmez; `sendPrint` geri çağrılarıyla P28a `PrintJobs`'a bağlanır (§5.3).
 */
import { sanitizeFileName } from "@remote/contracts/files";
import { describeFsrvStatus } from "@remote/contracts/labels";
import { STORAGE_QUOTA_MESSAGE } from "@remote/contracts/api/fsrv";
import {
  FSRV_MAX_BYTES,
  FSRV_PRINT_FILE_NAME,
  type FsrvPurpose,
  type FsrvStatusReason,
  type FsrvWireState,
} from "@remote/contracts/ws-fsrv";
import type { ServerOutbound } from "@remote/contracts/ws";
import { fileRisk, sha256Hex, type Transfer } from "../dc/files";
import type { FileDirection } from "../dc/ctl";
import { t } from "../i18n";
import { downloadVerified } from "./download";
import { uploadChunks, type UploadResult } from "./upload";

/** İstemci → sunucu `fsrv.*` (contracts `fsrvInbound`). */
export type FsrvOut =
  | { t: "fsrv.init"; xid: string; name: string; size: number; sha256: string; purpose: FsrvPurpose; pid?: string }
  | { t: "fsrv.accept"; fid: string }
  | { t: "fsrv.reject"; fid: string }
  | { t: "fsrv.result"; fid: string; ok: boolean }
  | { t: "fsrv.cancel"; fid: string };

type Msg<T extends string> = Extract<ServerOutbound, { t: T }>;
export type FsrvIn = Msg<"fsrv.upload"> | Msg<"fsrv.status"> | Msg<"fsrv.offer"> | Msg<"fsrv.download">;

export type SendResult = "ok" | "tooLarge" | "busy" | "denied" | "rate" | "empty";

export interface FsrvDeps {
  /** Bu tarafa gelen yön (konsol TO_TECH, müşteri TO_CUSTOMER). */
  inbound: FileDirection;
  sendWs: (m: FsrvOut) => void;
  onChange: (list: Transfer[]) => void;
  /** Etkin sınır (bayt) = min(firma `maxFileMb`, 256 MiB). */
  maxBytes: number;
  allowed: () => boolean;
  /** Giden yönde başka aktarım (yazdırma) sürüyor → dosya "busy". */
  extBusy?: () => boolean;
  fetch?: typeof fetch;
  sha256?: (b: Blob) => Promise<string>;
  newXid: () => string;
  retryDelayMs?: (attempt: number) => number;
}

/** Yazdırma (P28a) bağlantısı: aşama geri çağrıları. */
export interface PrintUploadCallbacks {
  onUploading: (sent: number) => void;
  onScanning: () => void;
  /** Temiz, misafire teklif edildi → P28a "Müşteri onayı bekleniyor". */
  onClean: () => void;
  /** Teslim edilmedi: virüslü / taranamadı / kapı reddi / yükleme hatası — metin hazır. */
  onFail: (message: string) => void;
}

interface OutRec {
  t: Transfer;
  xid: string;
  fid?: string;
  file: Blob;
  abort: AbortController;
  print?: PrintUploadCallbacks;
}
interface InRec {
  t: Transfer;
  sha?: string;
  abort?: AbortController;
}

const KEEP = 100;
const OUT_ACTIVE = new Set<Transfer["status"]>(["hashing", "uploading", "scanning", "offered"]);
const IN_ACTIVE = new Set<Transfer["status"]>(["pending", "receiving", "verifying"]);
/** Gönderende kalıcı son durum (geç gelen ara durum geri almasın). */
const FINAL = new Set<Transfer["status"]>(["ok", "corrupt", "rejected", "cancelled", "infected", "scanFailed", "gate", "tooLarge"]);

/** Tel durumu → satır durumu (+ sunucu metni). */
function wireToRow(state: FsrvWireState, reason?: FsrvStatusReason, signature?: string): Pick<Transfer, "status" | "note"> | null {
  const note = describeFsrvStatus(state, reason, signature) ?? undefined;
  switch (state) {
    case "INFECTED":
      return { status: "infected", note };
    case "SCAN_FAILED":
      return { status: "scanFailed", note };
    case "REJECTED":
      return { status: reason ? "gate" : "rejected", note };
    case "CORRUPT":
      return { status: "corrupt", note };
    case "CANCELLED":
      return { status: "cancelled", note };
    case "DELIVERED":
      return { status: "ok", note };
    case "SCANNING":
      return { status: "scanning" };
    default:
      return null;
  }
}

export class FsrvTransfers {
  private out = new Map<string, OutRec>();
  private byFid = new Map<string, string>();
  private prints = new Map<string, OutRec>();
  private inc = new Map<string, InRec>();
  private list: Transfer[] = [];

  constructor(private d: FsrvDeps) {}

  get transfers(): Transfer[] {
    return this.list;
  }
  /** Giden yönde etkin dosya (yükleme/tarama/açık teklif) — yazdırma bu sırada başlamaz. */
  get outBusy(): boolean {
    return [...this.out.values()].some((o) => OUT_ACTIVE.has(o.t.status));
  }
  get printBusy(): boolean {
    return [...this.prints.values()].some((p) => p.t.status === "hashing" || p.t.status === "uploading" || p.t.status === "scanning");
  }

  private put(x: Transfer) {
    const i = this.list.findIndex((y) => y.fid === x.fid && y.dir === x.dir);
    this.list = i < 0 ? [...this.list, x].slice(-KEEP) : this.list.map((y, j) => (j === i ? x : y));
    this.d.onChange(this.list);
  }
  private patch(rec: { t: Transfer; print?: PrintUploadCallbacks }, p: Partial<Transfer>) {
    rec.t = { ...rec.t, ...p };
    if (!rec.print) this.put(rec.t); // yazdırma belgesi dosya listesine girmez
  }

  private awaitingNote(): string {
    return t(this.d.inbound === "TO_TECH" ? "fsrv.st.awaitCustomer" : "fsrv.st.awaitTech");
  }

  /** Dosya gönder (FILE). */
  async send(file: File): Promise<SendResult> {
    if (!this.d.allowed()) return "denied";
    if (file.size === 0) return "empty";
    if (file.size > Math.min(this.d.maxBytes, FSRV_MAX_BYTES)) return "tooLarge";
    if (this.outBusy || this.d.extBusy?.()) return "busy";
    const xid = this.d.newXid();
    const name = file.name.slice(0, 255) || "dosya";
    const rec: OutRec = {
      xid,
      file,
      abort: new AbortController(),
      t: { fid: xid, dir: "out", name, size: file.size, done: 0, status: "hashing", ...fileRisk(sanitizeFileName(name)) },
    };
    this.out.set(xid, rec);
    this.put(rec.t);
    const sha = await (this.d.sha256 ?? sha256Hex)(file);
    if (rec.t.status !== "hashing") return "ok"; // bu sırada iptal edildi
    this.d.sendWs({ t: "fsrv.init", xid, name, size: file.size, sha256: sha, purpose: "FILE" });
    return "ok";
  }

  /** Yazdırma belgesini sunucu yolundan yükler (§5.3): ad sabit `belge.pdf`, `pid` ve boyut `print.request` ile aynı. */
  sendPrint(pid: string, file: Blob, sha: string, cb: PrintUploadCallbacks): void {
    for (const p of this.prints.values()) p.abort.abort();
    this.prints.clear();
    const xid = this.d.newXid();
    const rec: OutRec = {
      xid,
      file,
      abort: new AbortController(),
      print: cb,
      t: { fid: xid, dir: "out", name: FSRV_PRINT_FILE_NAME, size: file.size, done: 0, status: "hashing", dangerous: false, double: false },
    };
    this.prints.set(xid, rec);
    this.d.sendWs({ t: "fsrv.init", xid, name: FSRV_PRINT_FILE_NAME, size: file.size, sha256: sha, purpose: "PRINT", pid });
  }

  /**
   * Yazdırma işi iptal / bitti: yükleme durur; sunucu satırı `print.cancel` ya da oda kapanışıyla temizlenir. Kayıt bir sonraki
   * işe kadar tutulur: `print.status{ERROR}` önce gelse de geç gelen virüs/taranamadı metni işe yazılır (§5.3).
   */
  dropPrint(): void {
    for (const p of this.prints.values()) p.abort.abort();
  }

  private findOut(m: { fid?: string; xid?: string }): OutRec | undefined {
    const xid = m.xid ?? (m.fid ? this.byFid.get(m.fid) : undefined);
    return xid ? (this.out.get(xid) ?? this.prints.get(xid)) : undefined;
  }

  /** Sunucudan gelen `fsrv.*`. */
  onWs(m: FsrvIn): void {
    if (m.t === "fsrv.upload") return void this.onUpload(m);
    if (m.t === "fsrv.status") return this.onStatus(m);
    if (m.t === "fsrv.offer") return this.onOffer(m);
    if (m.t === "fsrv.download") return void this.onDownload(m);
  }

  private async onUpload(m: Msg<"fsrv.upload">) {
    const rec = this.out.get(m.xid) ?? this.prints.get(m.xid);
    if (!rec || rec.t.status !== "hashing") return;
    rec.fid = m.fid;
    this.byFid.set(m.fid, m.xid);
    this.patch(rec, { status: "uploading", done: 0 });
    rec.print?.onUploading(0);
    const r: UploadResult = await uploadChunks({
      fid: m.fid,
      token: m.token,
      file: rec.file,
      signal: rec.abort.signal,
      fetch: this.d.fetch,
      retryDelayMs: this.d.retryDelayMs,
      onProgress: (sent) => {
        if (rec.t.status !== "uploading") return;
        this.patch(rec, { done: sent });
        rec.print?.onUploading(sent);
      },
    });
    if (r === "ok" || r === "aborted") {
      const now = rec.t.status as Transfer["status"]; // await sonrası güncel durum (daraltma bayat)
      if (r === "ok" && now === "uploading") {
        this.patch(rec, { status: "scanning", done: rec.t.size });
        rec.print?.onScanning();
      }
      return;
    }
    if (FINAL.has(rec.t.status)) return;
    // Kalıcı hata: sunucu satırı iptal edilir (10 dk beklemeden kota boşalsın)
    this.d.sendWs({ t: "fsrv.cancel", fid: m.fid });
    const note = r === "quota" ? STORAGE_QUOTA_MESSAGE : t("fsrv.uploadFailed");
    this.patch(rec, { status: r === "quota" ? "gate" : "cancelled", note });
    rec.print?.onFail(note);
  }

  private onStatus(m: Msg<"fsrv.status">) {
    const rec = this.findOut(m);
    if (rec) return this.outStatus(rec, m);
    if (m.fid) this.inStatus(m.fid, m);
  }

  private outStatus(rec: OutRec, m: Msg<"fsrv.status">) {
    if (FINAL.has(rec.t.status)) return;
    if (m.state === "CLEAN") {
      this.patch(rec, { status: "offered", done: rec.t.size, note: this.awaitingNote() });
      return rec.print?.onClean();
    }
    const row = wireToRow(m.state, m.reason, m.signature);
    if (!row) return;
    if (row.status === "scanning") {
      if (rec.t.status !== "uploading" && rec.t.status !== "hashing") return;
      this.patch(rec, { status: "scanning", done: rec.t.size });
      return rec.print?.onScanning();
    }
    rec.abort.abort();
    this.patch(rec, row);
    // Yazdırmada teslim (DELIVERED) P28a `print.status`'la biter; diğer son durumlar metniyle hata
    if (row.status !== "ok") rec.print?.onFail(row.note ?? t("cp.print.res.ERROR"));
  }

  /** Alıcı tarafı: teklif öncesi ilerleme / virüs / taranamadı bildirimi; teklif sonrası gönderenin iptali. */
  private inStatus(fid: string, m: Msg<"fsrv.status">) {
    const known = this.inc.get(fid);
    if (known) {
      if (FINAL.has(known.t.status)) return;
      if (m.state === "UPLOADING" || m.state === "SCANNING") {
        if (known.t.status === "uploading" || known.t.status === "scanning")
          this.patch(known, { status: m.state === "UPLOADING" ? "uploading" : "scanning", pct: m.progress });
        return;
      }
      const row = wireToRow(m.state, m.reason, m.signature);
      if (!row || row.status === "ok" || m.state === "CLEAN") return;
      known.abort?.abort();
      return this.patch(known, row);
    }
    if (m.state === "UPLOADING" || m.state === "SCANNING" || m.state === "INFECTED" || m.state === "SCAN_FAILED") {
      const row = wireToRow(m.state, m.reason, m.signature);
      const rec: InRec = {
        t: {
          fid,
          dir: "in",
          name: t("fsrv.incoming"),
          size: 0,
          done: 0,
          status: m.state === "UPLOADING" ? "uploading" : (row?.status ?? "scanning"),
          dangerous: false,
          double: false,
          ...(m.progress !== undefined ? { pct: m.progress } : {}),
          ...(row?.note ? { note: row.note } : {}),
        },
      };
      this.inc.set(fid, rec);
      this.put(rec.t);
    }
  }

  private onOffer(m: Msg<"fsrv.offer">) {
    // Yazdırma belgesi tarayıcıda açılmaz (Go istemci P28a diyaloğunda işler); tarayıcı misafiri/konsol reddeder
    if (m.purpose === "PRINT") return this.d.sendWs({ t: "fsrv.reject", fid: m.fid });
    const name = sanitizeFileName(m.name);
    const prev = this.inc.get(m.fid);
    const base: Transfer = { fid: m.fid, dir: "in", name, size: m.size, done: 0, status: "pending", ...fileRisk(name) };
    const rec: InRec = { t: base, sha: m.sha256 };
    this.inc.set(m.fid, rec);
    if (prev) this.list = this.list.filter((x) => !(x.dir === "in" && x.fid === m.fid));
    if (!this.d.allowed()) {
      this.d.sendWs({ t: "fsrv.reject", fid: m.fid });
      return this.patch(rec, { status: "rejected", auto: "caps" });
    }
    if (m.size > this.d.maxBytes) {
      this.d.sendWs({ t: "fsrv.reject", fid: m.fid });
      return this.patch(rec, { status: "tooLarge", auto: "tooLarge" });
    }
    this.put(rec.t);
  }

  accept(fid: string): void {
    const rec = this.inc.get(fid);
    if (!rec || rec.t.status !== "pending") return;
    this.patch(rec, { status: "receiving", done: 0 });
    this.d.sendWs({ t: "fsrv.accept", fid });
  }

  reject(fid: string): void {
    const rec = this.inc.get(fid);
    if (!rec || rec.t.status !== "pending") return;
    this.d.sendWs({ t: "fsrv.reject", fid });
    this.patch(rec, { status: "rejected" });
  }

  private async onDownload(m: Msg<"fsrv.download">) {
    const rec = this.inc.get(m.fid);
    if (!rec || rec.t.status !== "receiving" || !rec.sha) return;
    rec.abort = new AbortController();
    const r = await downloadVerified({
      fid: m.fid,
      token: m.token,
      size: rec.t.size,
      sha256: rec.sha,
      signal: rec.abort.signal,
      fetch: this.d.fetch,
      onProgress: (n) => rec.t.status === "receiving" && this.patch(rec, { done: n }),
    });
    if (r.kind === "aborted" || rec.t.status !== "receiving") return;
    const ok = r.kind === "ok";
    this.d.sendWs({ t: "fsrv.result", fid: m.fid, ok });
    if (ok) this.patch(rec, { status: "ok", done: rec.t.size, ...(r.url ? { url: r.url } : {}) });
    else this.patch(rec, { status: "corrupt", note: t(r.kind === "corrupt" ? "fsrv.dlCorrupt" : "fsrv.dlFailed") });
  }

  cancel(id: string, dir: "in" | "out"): void {
    if (dir === "out") {
      const rec = this.out.get(id);
      if (!rec || !OUT_ACTIVE.has(rec.t.status)) return;
      rec.abort.abort();
      if (rec.fid) this.d.sendWs({ t: "fsrv.cancel", fid: rec.fid });
      return this.patch(rec, { status: "cancelled", note: undefined });
    }
    const rec = this.inc.get(id);
    if (!rec || !IN_ACTIVE.has(rec.t.status)) return;
    rec.abort?.abort();
    this.d.sendWs({ t: "fsrv.cancel", fid: id });
    this.patch(rec, { status: "cancelled" });
  }

  /** WS oturumu bitti: etkin akışlar durur, object URL'ler serbest. */
  dispose(): void {
    for (const r of [...this.out.values(), ...this.prints.values()]) r.abort.abort();
    for (const r of this.inc.values()) {
      r.abort?.abort();
      if (r.t.url) URL.revokeObjectURL(r.t.url);
    }
    this.out.clear();
    this.prints.clear();
    this.inc.clear();
  }
}
