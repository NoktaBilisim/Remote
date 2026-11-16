/*
 * P28e konsol kaydedicisi (mimari-p28e r2 §7, K-P28e-4/16/17, ADR-0034). Yalnız video izi (AC-375: ses izi akışa hiç girmez),
 * `video/webm;codecs=vp8`, hedef 1,5 Mbit/s, `start(5000)` → her `dataavailable` bir parça. Bölüm = bir MediaRecorder
 * çalışması; geçiş zamanlayıcıyla DEĞİL parça sayısıyla (60. parçada) yapılır — arka planda zamanlayıcı kısıtlansa da
 * `part_no` 0..59'u aşmaz.
 *
 * Kapanış kipleri:
 *  - `flush` (bölüm geçişi, oturum sonu; K-P28e-17): `requestData()` → ilgili `dataavailable` en çok 500 ms beklenir →
 *    `stop()` (geçişte yeni kaydedici AYNI görevde başlar). `requestData` ve `stop` kuyruğu ayrı bloblar üretir; bunlar
 *    bölümün son parçasına BİRLEŞTİRİLİR (aynı WebM akışının ardışık baytları) → `p` hiçbir zaman 59'u aşmaz.
 *  - `now` (rıza geri alma, kota/politika/hata, kaynak eş ayrıldı; AC-382 ≤ 2 sn): beklemeden `stop()`; kuyruk blobu
 *    yine son parça olarak verilir (sunucu durma payı §5.3 ile kabul eder ya da 404'ler).
 * Saf mantık: MediaRecorder fabrikası ve saat enjekte edilir (vitest sahte kaydediciyle sınar).
 */
import {
  REC_MIME_TYPE,
  REC_PART_DURATION_MAX_MS,
  REC_PART_DURATION_MIN_MS,
  REC_PART_MS,
  REC_REQUEST_DATA_WAIT_MS,
  REC_SERIES_PARTS,
  REC_TARGET_BPS,
} from "@remote/contracts/ws-rec";

/** Kaydedicinin kullandığı MediaRecorder yüzeyi (test için daraltılmış). */
export interface RecorderLike {
  readonly state: string;
  start(timeslice: number): void;
  stop(): void;
  requestData(): void;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
}

export interface RecPart {
  series: number;
  part: number;
  blob: Blob;
  durationMs: number;
  /** Yalnız `part = 0`: bölüm başlangıcı (epoch ms; `X-Rec-Series-Start-Ms`). */
  seriesStartMs?: number;
}

export type CloseMode = "flush" | "now";

export interface SeriesRecorderDeps {
  create: (stream: MediaStream) => RecorderLike;
  now?: () => number;
  /** Bölüm başına parça (vars. `REC_SERIES_PARTS` = 60). Test küçültür; üretimde değişmez. */
  seriesParts?: number;
  partMs?: number;
  waitMs?: number;
  onPart: (p: RecPart) => void;
  /** Kaydedici açılamadı / hata verdi (konsol `rec.error{recorder_failed}` gönderir). */
  onError: () => void;
}

/** Tarayıcı fabrikası: yalnız video izi, VP8, hedef bit hızı. */
export function browserRecorder(stream: MediaStream): RecorderLike {
  const video = stream.getVideoTracks()[0];
  if (!video) throw new Error("video izi yok");
  const mr = new MediaRecorder(new MediaStream([video]), { mimeType: REC_MIME_TYPE, videoBitsPerSecond: REC_TARGET_BPS });
  return mr as unknown as RecorderLike; // olay işleyicileri yalnız `data` alanını okur
}

export const clampDuration = (ms: number): number => Math.min(REC_PART_DURATION_MAX_MS, Math.max(REC_PART_DURATION_MIN_MS, Math.round(ms)));

interface Run {
  rec: RecorderLike;
  series: number;
  next: number;
  startedAt: number;
  partStart: number;
  /** Kapanış sürüyor: gelen bloblar son parçada birleşir. */
  closing: Blob[] | null;
  waiter: (() => void) | null;
  done: Promise<void>;
}

export class SeriesRecorder {
  private run: Run | null = null;
  private stream: MediaStream | null = null;
  private readonly d: Required<Omit<SeriesRecorderDeps, "onPart" | "onError" | "create">> & SeriesRecorderDeps;

  constructor(deps: SeriesRecorderDeps) {
    this.d = {
      now: Date.now,
      seriesParts: REC_SERIES_PARTS,
      partMs: REC_PART_MS,
      waitMs: REC_REQUEST_DATA_WAIT_MS,
      ...deps,
    };
  }

  /** Etkin bölüm numarası (yoksa null). */
  get series(): number | null {
    return this.run?.series ?? null;
  }

  /** Yeni bölümü `series`'den, `p = 0`'dan başlatır (açık bölüm varsa önce `now` ile kapatılır). */
  start(stream: MediaStream, series: number): boolean {
    if (this.run) void this.close("now");
    this.stream = stream;
    return this.open(series);
  }

  /** Açık bölümü kapatır; tüm parçalar `onPart`'a verildiğinde çözülür. */
  close(mode: CloseMode): Promise<void> {
    const r = this.run;
    if (!r) return Promise.resolve();
    this.run = null;
    return this.finish(r, mode, [], false);
  }

  private open(series: number): boolean {
    let rec: RecorderLike;
    try {
      rec = this.d.create(this.stream as MediaStream);
    } catch {
      this.d.onError();
      return false;
    }
    const at = this.d.now();
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((res) => (resolveDone = res));
    const r: Run = { rec, series, next: 0, startedAt: at, partStart: at, closing: null, waiter: null, done };
    rec.ondataavailable = (e) => this.onData(r, e.data);
    rec.onstop = () => {
      r.waiter?.();
      resolveDone();
    };
    rec.onerror = () => {
      if (this.run === r) {
        this.run = null;
        void this.finish(r, "now", [], false);
        this.d.onError();
      }
    };
    this.run = r;
    try {
      rec.start(this.d.partMs);
    } catch {
      this.run = null;
      this.d.onError();
      return false;
    }
    return true;
  }

  private onData(r: Run, blob: Blob): void {
    if (r.closing) {
      if (blob.size > 0) r.closing.push(blob);
      r.waiter?.();
      return;
    }
    if (blob.size === 0) return; // boş parça (görüntü durgun/sessiz) atlanır; süre bir sonrakine eklenir
    if (r.next === this.d.seriesParts - 1) {
      // 60. parça: bölüm geçişi (K-P28e-16). Parça tutulur, requestData/stop kuyruğu buna eklenir.
      if (this.run === r) {
        this.run = null;
        void this.finish(r, "flush", [blob], true);
      }
      return;
    }
    this.emit(r, [blob]);
  }

  private emit(r: Run, blobs: Blob[]): void {
    const now = this.d.now();
    const blob = blobs.length === 1 ? (blobs[0] as Blob) : new Blob(blobs, { type: "video/webm" });
    const part: RecPart = { series: r.series, part: r.next, blob, durationMs: clampDuration(now - r.partStart) };
    if (r.next === 0) part.seriesStartMs = r.startedAt;
    r.next++;
    r.partStart = now;
    this.d.onPart(part);
  }

  /** Kapanış: (flush) requestData + ≤ waitMs bekleme → stop (+ geçişte aynı görevde yeni bölüm) → kuyruk → son parça. */
  private async finish(r: Run, mode: CloseMode, held: Blob[], rotate: boolean): Promise<void> {
    r.closing = held;
    if (mode === "flush" && r.rec.state === "recording") {
      await this.waitData(r, () => r.rec.requestData());
    }
    r.waiter = null;
    if (r.rec.state !== "inactive") {
      try {
        r.rec.stop();
      } catch {
        /* zaten durmuş */
      }
      if (rotate && this.stream) this.open(r.series + 1);
      // `stop` olayı son `dataavailable`'dan sonra gelir; olay gelmezse (bozuk kaydedici) en çok 4 × bekleme
      await Promise.race([r.done, new Promise<void>((res) => setTimeout(res, this.d.waitMs * 4))]);
    } else if (rotate && this.stream) this.open(r.series + 1);
    const blobs = r.closing;
    r.closing = null;
    r.waiter = null;
    if (blobs.length && r.next < this.d.seriesParts) this.emit(r, blobs);
  }

  private waitData(r: Run, kick: () => void): Promise<void> {
    return new Promise<void>((res) => {
      const t = setTimeout(done, this.d.waitMs);
      function done() {
        clearTimeout(t);
        r.waiter = null;
        res();
      }
      r.waiter = done;
      try {
        kick();
      } catch {
        done();
      }
    });
  }
}
