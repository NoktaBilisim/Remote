/*
 * P28a uzaktan yazdırma — teknisyen konsolu gönderen tarafı (mimari-p28 §4.3–4.5, §6; AC-348..350; r2 Y-P28a-1, O-P28a-2).
 * Akış: PDF denetimi (`%PDF-`, ≤ 20 MB) → SHA-256 → WS `print.request{pid, sizeBytes}` → misafir DC `print.ready{pid}` →
 * DC `print.offer{pid, idx, name, size, sha256}` (pid başına TEK teklif) + `file` kanalı parçaları (ortak `idx` sayacı) +
 * `print.done` → "Müşteri onayı bekleniyor" → WS `print.status`. "Vazgeç" → WS `print.cancel`. Kontrol VIEW'a dönünce
 * bekleyen iş yerelde "Kontrol izni kapandı, yazdırma iptal edildi" ile biter (sunucu da iptal eder; geç gelen durum yok sayılır).
 * Ret / yanıtsızlık sonrası 30 sn yerel bekleme (sunucu kuralının aynası, K7 kalıbı). Dosya adı yalnız DC'de (WS/audit'te yok).
 */
import { PRINT_CONSENT_TIMEOUT_MS, PRINT_DENY_COOLDOWN_MS, type PrintResult } from "@remote/contracts/ws-clip-print";
import { pumpChunks } from "../dc/chunk-sender";
import type { FileChannelLike } from "../dc/file-model";
import type { PrintUploadCallbacks } from "../fsrv/transfers";
import { checkPdf } from "./pdf-check";

/** P28b (§5.3): SERVER modunda `sending` = sunucuya yükleme, ardından `scanning` (virüs taraması). */
export type PrintPhase = "hashing" | "requested" | "sending" | "scanning" | "waiting" | "done";
/** `VIEW` = kontrol izni kapandığı için yerelde iptal (r2 Y-P28a-1); `SERVER` = sunucu kapısı reddetti (`message`). */
export type PrintOutcome = PrintResult | "VIEW" | "SERVER";

export interface PrintView {
  pid: string;
  name: string;
  size: number;
  phase: PrintPhase;
  /** Gönderilen bayt. */
  sent: number;
  /** Onay beklemesinin başladığı an (ms) — kalan saniye göstergesi. */
  waitingSince: number | null;
  outcome: PrintOutcome | null;
  pages?: number;
  message?: string;
}

export type PrintFieldError = "notPdf" | "tooLarge" | "busy";

export interface PrintState {
  job: PrintView | null;
  fieldError: PrintFieldError | null;
  /** Ret / yanıtsızlık sonrası düğme bu ana kadar pasif (ms). */
  cooldownUntil: number;
}

type WsOut = { t: "print.request"; pid: string; sizeBytes: number } | { t: "print.cancel"; pid: string };
type CtlOut = { t: "print.offer"; pid: string; idx: number; name: string; size: number; sha256: string } | { t: "print.done"; pid: string };

export interface PrintDeps {
  sendWs: (m: WsOut) => void;
  sendCtl: (m: CtlOut) => boolean;
  /** `file` kanalı (yoksa null — bağlantı yok). */
  file: () => FileChannelLike | null;
  /** Dosya + yazdırma ortak `fidIndex` sayacı (O-P28a-2). */
  nextIdx: () => number | null;
  /** Giden yönde dosya aktarımı sürüyor (§4.4 yön başına tek aktarım). */
  fileBusy: () => boolean;
  sha256: (b: Blob) => Promise<string>;
  newId: () => string;
  onChange: (s: PrintState) => void;
  now?: () => number;
  delayMs?: () => number;
  /**
   * P28b (§5.3, D-P28b-3): SERVER modunda belge DC yerine sunucu yolundan (`fsrv.init{PRINT, pid}`, ad `belge.pdf`, boyut =
   * `print.request.sizeBytes`). true → sunucu yolu üstlendi (DC `print.offer`/çerçeve/`print.done` gönderilmez).
   */
  viaServer?: (pid: string, file: Blob, sha: string, cb: PrintUploadCallbacks) => boolean;
  /** P28b: iş bitti/iptal → sunucu yüklemesi durur. */
  dropServer?: () => void;
}

/** Sunucunun `error`'u bu süre içinde gelirse son yazdırma isteğine aittir (zarf kimliği hataya yansımaz). */
export const PRINT_ERROR_WINDOW_MS = 5_000;
/** Sunucu iptali ile VIEW geçişi arasında kabul edilen en uzun aralık (aynı olayın iki mesajı). */
const VIEW_RELABEL_MS = 2_000;
const ACTIVE = new Set<PrintPhase>(["hashing", "requested", "sending", "scanning", "waiting"]);
const COOLDOWN = new Set<PrintOutcome>(["REJECTED", "TIMEOUT"]);

/** Onay diyaloğunda kalan saniye (60 sn, AC-349); bekleme yoksa null. */
export function consentLeftSec(job: PrintView | null, now: number | null): number | null {
  if (!job || job.phase !== "waiting" || job.waitingSince === null || now === null) return null;
  return Math.max(0, Math.ceil((job.waitingSince + PRINT_CONSENT_TIMEOUT_MS - now) / 1000));
}

export class PrintJobs {
  private s: PrintState = { job: null, fieldError: null, cooldownUntil: 0 };
  private file: Blob | null = null;
  private sha = "";
  private requestedAt = 0;
  /** Sunucu kaynaklı `CANCELLED` anı (kullanıcı "Vazgeç"i değil) — VIEW'dan hemen önce gelirse nedeni düzeltilir. */
  private serverCancelAt = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;

  constructor(private d: PrintDeps) {
    this.now = d.now ?? Date.now;
  }

  get state(): PrintState {
    return this.s;
  }
  /** Yazdırma aktarımı `file` kanalını kullanıyor / kullanacak (dosya teklifi "busy" olur). */
  get transferring(): boolean {
    const p = this.s.job?.phase;
    return p === "hashing" || p === "requested" || p === "sending" || p === "scanning";
  }
  get active(): boolean {
    return this.s.job !== null && ACTIVE.has(this.s.job.phase);
  }

  private set(patch: Partial<PrintState>) {
    this.s = { ...this.s, ...patch };
    this.d.onChange(this.s);
  }
  private patchJob(pid: string, patch: Partial<PrintView>) {
    if (this.s.job?.pid !== pid) return;
    this.set({ job: { ...this.s.job, ...patch } });
  }
  private finish(pid: string, outcome: PrintOutcome, extra: Partial<PrintView> = {}) {
    if (this.s.job?.pid !== pid || !ACTIVE.has(this.s.job.phase)) return;
    this.d.dropServer?.();
    this.file = null;
    this.sha = "";
    const cooldownUntil = COOLDOWN.has(outcome) ? this.now() + PRINT_DENY_COOLDOWN_MS : this.s.cooldownUntil;
    this.set({ job: { ...this.s.job, phase: "done", outcome, waitingSince: null, ...extra }, cooldownUntil });
  }

  /** Dosya seçildi: denetim → özet → `print.request`. */
  async start(file: File): Promise<void> {
    if (this.active) return;
    const check = await checkPdf(file);
    if (check !== "ok") return this.set({ fieldError: check });
    if (this.d.fileBusy()) return this.set({ fieldError: "busy" });
    const pid = this.d.newId();
    this.file = file;
    this.set({
      fieldError: null,
      job: { pid, name: file.name || "belge.pdf", size: file.size, phase: "hashing", sent: 0, waitingSince: null, outcome: null },
    });
    const sha = await this.d.sha256(file);
    if (this.s.job?.pid !== pid || this.s.job.phase !== "hashing") return; // bu sırada iptal edildi
    this.sha = sha;
    this.requestedAt = this.now();
    this.patchJob(pid, { phase: "requested" });
    this.d.sendWs({ t: "print.request", pid, sizeBytes: file.size });
  }

  /** DC `print.ready{pid}`: tek teklif + parçalar + `print.done`. */
  async onReady(pid: string): Promise<void> {
    const j = this.s.job;
    const file = this.file;
    if (!j || j.pid !== pid || j.phase !== "requested" || !file) return;
    if (this.d.viaServer?.(pid, file, this.sha, this.serverCallbacks(pid))) {
      this.file = null;
      return this.patchJob(pid, { phase: "sending", sent: 0 });
    }
    const ch = this.d.file();
    const idx = this.d.nextIdx();
    if (!ch || idx === null) return this.finish(pid, "ERROR");
    this.patchJob(pid, { phase: "sending" });
    const name = j.name.slice(0, 255) || "belge.pdf";
    if (!this.d.sendCtl({ t: "print.offer", pid, idx, name, size: j.size, sha256: this.sha })) return this.finish(pid, "ERROR");
    const live = () => this.s.job?.pid === pid && this.s.job.phase === "sending";
    const ok = await pumpChunks(ch, idx, file, {
      aborted: () => !live(),
      onProgress: (n) => this.patchJob(pid, { sent: n }),
      delayMs: this.d.delayMs,
    });
    if (!live()) return;
    if (!ok || !this.d.sendCtl({ t: "print.done", pid })) return this.finish(pid, "ERROR");
    this.file = null;
    this.patchJob(pid, { phase: "waiting", waitingSince: this.now() });
  }

  /** P28b sunucu yolu aşamaları; virüs/taranamadı metni `print.status{ERROR}`'dan önce ya da sonra gelse de kazanır. */
  private serverCallbacks(pid: string): PrintUploadCallbacks {
    const live = () => this.s.job?.pid === pid && (this.s.job.phase === "sending" || this.s.job.phase === "scanning");
    return {
      onUploading: (sent) => live() && this.patchJob(pid, { phase: "sending", sent }),
      onScanning: () => live() && this.patchJob(pid, { phase: "scanning", sent: this.s.job?.size ?? 0 }),
      onClean: () => live() && this.patchJob(pid, { phase: "waiting", waitingSince: this.now() }),
      onFail: (message) => {
        const j = this.s.job;
        if (j?.pid !== pid) return;
        if (j.phase === "done" && j.outcome === "ERROR") return this.set({ job: { ...j, outcome: "SERVER", message } });
        this.finish(pid, "SERVER", { message });
      },
    };
  }

  /** WS `print.status`. Bitmiş / başka iş için gelen durum yok sayılır. */
  onStatus(m: { pid: string; result: PrintResult; pages?: number }): void {
    if (m.result === "CANCELLED" && this.s.job?.pid === m.pid && ACTIVE.has(this.s.job.phase)) this.serverCancelAt = this.now();
    this.finish(m.pid, m.result, m.pages !== undefined ? { pages: m.pages } : {});
  }

  /** "Vazgeç": sunucuya `print.cancel` (özet sürerken henüz istek gitmemiştir). */
  cancel(): void {
    const j = this.s.job;
    if (!j || !ACTIVE.has(j.phase)) return;
    if (j.phase !== "hashing") this.d.sendWs({ t: "print.cancel", pid: j.pid });
    this.finish(j.pid, "CANCELLED");
  }

  /** Kontrol izni kapandı (VIEW): bekleyen iş iptal (sunucu da iptal eder, r2 Y-P28a-1). */
  controlClosed(): void {
    const j = this.s.job;
    if (j && ACTIVE.has(j.phase)) return this.finish(j.pid, "VIEW");
    // Sunucu iptali (`print.status{CANCELLED}`) `control.state{VIEW}`'dan önce geldiyse neden yine kontrol kapanışıdır
    if (j?.outcome === "CANCELLED" && this.now() - this.serverCancelAt < VIEW_RELABEL_MS) this.set({ job: { ...j, outcome: "VIEW" } });
  }

  /** WS `error`: yalnız yanıt beklenen son istekle eşlenir. */
  onError(message: string): boolean {
    const j = this.s.job;
    if (!j || j.phase !== "requested" || this.now() - this.requestedAt > PRINT_ERROR_WINDOW_MS) return false;
    this.finish(j.pid, "SERVER", { message });
    return true;
  }

  /** Müşteri ayrıldı / kanal kapandı. */
  peerGone(): void {
    const j = this.s.job;
    if (j && ACTIVE.has(j.phase)) this.finish(j.pid, "DISCONNECTED");
  }

  clearFieldError(): void {
    if (this.s.fieldError) this.set({ fieldError: null });
  }

  dispose(): void {
    this.file = null;
    this.sha = "";
  }
}
