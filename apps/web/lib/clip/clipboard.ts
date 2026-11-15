/*
 * P28a pano işi — teknisyen konsolu (mimari-p28 §4.5, §6; AC-343..346; r2 D-P28a-4).
 * Gönder (TO_CUSTOMER): `navigator.clipboard.readText()` → boş / > 64 KB yerelde durur → WS `clip.push{cid, bytes}` →
 *   misafir DC `clip.ready{cid}` → `clip.data` parçaları → WS `clip.status`.
 * Al (TO_TECH): WS `clip.pull{cid}` → misafir DC `clip.data` → birleştir + doğrula → `navigator.clipboard.writeText()`.
 * Kimlik yöne bağlı ve tek kullanımlık: push cid'i yalnız `clip.ready`'yi, pull cid'i yalnız gelen `clip.data`'yı kabul eder;
 * bekleyen iş yoksa / cid eşleşmezse mesaj düşer. Pano içeriği DOM'a, `console.*`'a, duruma (state) hiç girmez; bayt
 * tamponu gönderimden sonra sıfırlanır. Sunucu `error` zarf kimliği taşımaz → yalnız son istekle (5 sn) eşlenir (P7 kalıbı).
 */
import { CLIP_MAX_BYTES, CLIP_PENDING_TIMEOUT_MS, type ClipDirection, type ClipResult } from "@remote/contracts/ws-clip-print";
import { ClipAssembler, splitClip, utf8, type ClipChunk } from "./chunks";

export interface ClipboardLike {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export type ReadOutcome = { kind: "ok"; bytes: Uint8Array } | { kind: "empty" | "tooLarge" | "denied" | "unsupported" };

/** Tarayıcı panosunu okur; ret (izin / Firefox "Yapıştır" menüsü kapatıldı) → `denied` (R-P28a-3). */
export async function readClipboard(cb: ClipboardLike | undefined): Promise<ReadOutcome> {
  if (!cb || typeof cb.readText !== "function") return { kind: "unsupported" };
  let text: string;
  try {
    text = await cb.readText();
  } catch {
    return { kind: "denied" };
  }
  if (!text) return { kind: "empty" };
  const bytes = utf8(text);
  if (bytes.length > CLIP_MAX_BYTES) {
    bytes.fill(0);
    return { kind: "tooLarge" };
  }
  return { kind: "ok", bytes };
}

/** Panoya yazar; ret (kullanıcı etkinliği süresi doldu / izin yok) → `denied`. Metin başarısızlıkta gösterilmez. */
export async function writeClipboard(cb: ClipboardLike | undefined, text: string): Promise<"ok" | "denied" | "unsupported"> {
  if (!cb || typeof cb.writeText !== "function") return "unsupported";
  try {
    await cb.writeText(text);
    return "ok";
  } catch {
    return "denied";
  }
}

/** Panel bildirimi (metne panel çevirir): sunucu/misafir sonucu, yerel ret, sunucu kapısı hatası. */
export type ClipNotice =
  | { kind: "result"; dir: ClipDirection; result: ClipResult }
  | { kind: "local"; code: "readDenied" | "writeDenied" | "unsupported" | "empty" | "tooLarge" }
  | { kind: "server"; message: string };

export type ClipPhase = "reading" | "requested" | "sending" | "receiving" | "writing";
export interface ClipView {
  dir: ClipDirection;
  phase: ClipPhase;
}

type WsOut = { t: "clip.push"; cid: string; bytes: number } | { t: "clip.pull"; cid: string };
type CtlOut = { t: "clip.data"; cid: string } & ClipChunk;

export interface ClipDeps {
  sendWs: (m: WsOut) => void;
  /** DC `ctl`'e yazar; kanal kapalıysa false. */
  sendCtl: (m: CtlOut) => boolean;
  newId: () => string;
  clipboard: () => ClipboardLike | undefined;
  onChange: (v: ClipView | null) => void;
  notify: (n: ClipNotice) => void;
  now?: () => number;
}

/** Sunucunun `error`'u bu süre içinde gelirse son pano isteğine aittir. */
export const CLIP_ERROR_WINDOW_MS = 5_000;
/** Yerel emniyet: sunucu `clip.status{TIMEOUT}`'u (10 sn) gelmezse iş yine kapanır. */
export const CLIP_LOCAL_TIMEOUT_MS = CLIP_PENDING_TIMEOUT_MS + 5_000;

interface Job extends ClipView {
  cid: string;
  at: number;
  bytes?: Uint8Array;
  asm?: ClipAssembler;
  timer?: ReturnType<typeof setTimeout>;
}

export class ClipJobs {
  private job: Job | null = null;
  private reading = false;
  private readonly now: () => number;

  constructor(private d: ClipDeps) {
    this.now = d.now ?? Date.now;
  }

  get busy(): boolean {
    return this.job !== null || this.reading;
  }

  /** "Panoyu gönder": kullanıcı tıklaması içinde çağrılır (readText kullanıcı etkinliği ister). */
  async push(): Promise<void> {
    if (this.busy) return;
    this.reading = true;
    this.d.onChange({ dir: "TO_CUSTOMER", phase: "reading" });
    const r = await readClipboard(this.d.clipboard());
    this.reading = false;
    if (r.kind !== "ok") {
      this.d.onChange(null);
      const code = r.kind === "denied" ? "readDenied" : r.kind;
      return this.d.notify({ kind: "local", code });
    }
    const cid = this.d.newId();
    this.start({ cid, dir: "TO_CUSTOMER", phase: "requested", at: this.now(), bytes: r.bytes });
    this.d.sendWs({ t: "clip.push", cid, bytes: r.bytes.length });
  }

  /** "Müşteri panosunu al". */
  pull(): void {
    if (this.busy) return;
    const cid = this.d.newId();
    this.start({ cid, dir: "TO_TECH", phase: "requested", at: this.now(), asm: new ClipAssembler() });
    this.d.sendWs({ t: "clip.pull", cid });
  }

  private start(j: Job) {
    j.timer = setTimeout(() => this.finish(j, { kind: "result", dir: j.dir, result: "TIMEOUT" }), CLIP_LOCAL_TIMEOUT_MS);
    this.job = j;
    this.emit();
  }

  private emit() {
    this.d.onChange(this.job ? { dir: this.job.dir, phase: this.job.phase } : null);
  }

  private finish(j: Job, n: ClipNotice | null) {
    if (this.job !== j) return;
    clearTimeout(j.timer);
    j.bytes?.fill(0);
    j.bytes = undefined;
    j.asm = undefined;
    this.job = null;
    this.emit();
    if (n) this.d.notify(n);
  }

  /** DC `clip.ready` / `clip.data`. */
  onCtl(m: { t: "clip.ready"; cid: string } | ({ t: "clip.data"; cid: string } & ClipChunk)): void {
    const j = this.job;
    if (!j || j.cid !== m.cid) return;
    if (m.t === "clip.ready") return this.onReady(j);
    if (j.dir !== "TO_TECH" || !j.asm || (j.phase !== "requested" && j.phase !== "receiving")) return;
    const r = j.asm.push(m);
    if (r.kind === "more") {
      if (j.phase !== "receiving") {
        j.phase = "receiving";
        this.emit();
      }
      return;
    }
    if (r.kind === "error") return this.finish(j, { kind: "result", dir: "TO_TECH", result: r.result });
    j.phase = "writing";
    j.asm = undefined;
    this.emit();
    void this.write(j, r.text);
  }

  private onReady(j: Job) {
    if (j.dir !== "TO_CUSTOMER" || j.phase !== "requested" || !j.bytes) return;
    const parts = splitClip(j.bytes);
    j.bytes.fill(0);
    j.bytes = undefined;
    if (!parts) return this.finish(j, { kind: "result", dir: "TO_CUSTOMER", result: "ERROR" });
    for (const p of parts) {
      if (!this.d.sendCtl({ t: "clip.data", cid: j.cid, ...p })) {
        return this.finish(j, { kind: "result", dir: "TO_CUSTOMER", result: "ERROR" });
      }
    }
    j.phase = "sending";
    this.emit();
  }

  private async write(j: Job, text: string) {
    const r = await writeClipboard(this.d.clipboard(), text);
    if (r === "ok") return this.finish(j, { kind: "result", dir: "TO_TECH", result: "OK" });
    this.finish(j, { kind: "local", code: r === "denied" ? "writeDenied" : "unsupported" });
  }

  /** WS `clip.status`. Al yönünde OK, veri DC'den gelene kadar işi kapatmaz (WS/DC sırası garanti değil). */
  onStatus(m: { cid: string; result: ClipResult }): void {
    const j = this.job;
    if (!j || j.cid !== m.cid) return;
    if (j.dir === "TO_TECH" && m.result === "OK") return;
    if (j.phase === "writing") return;
    this.finish(j, { kind: "result", dir: j.dir, result: m.result });
  }

  /** WS `error` (FORBIDDEN / CONFLICT / RATE_LIMITED / VALIDATION): yalnız yanıt beklenen son istekle eşlenir. */
  onError(message: string): boolean {
    const j = this.job;
    if (!j || j.phase !== "requested" || this.now() - j.at > CLIP_ERROR_WINDOW_MS) return false;
    this.finish(j, { kind: "server", message });
    return true;
  }

  /** Müşteri ayrıldı / kanal kapandı / kontrol kapandı: bekleyen iş bildirimle kapanır. */
  abort(result: ClipResult = "DISCONNECTED"): void {
    if (this.job) this.finish(this.job, { kind: "result", dir: this.job.dir, result });
  }

  dispose(): void {
    if (this.job) this.finish(this.job, null);
  }
}
