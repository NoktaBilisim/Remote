/*
 * P28e MSE oynatıcı motoru (mimari-p28e r2 §7, §5.4; K-P28e-5; K0s §4). `<video src>` ve `Range` YOK: parçalar
 * `GET /api/v1/rec/:rid/series/:s/parts/:p` + `Authorization: Bearer <izleme belirteci>` ile `fetch` edilir (URL'de belirteç
 * yok, çerez gönderilmez) ve `SourceBuffer("video/webm; codecs=vp8")`'e `segments` kipinde eklenir.
 *  - Her bölüm kendi zamanına: `timestampOffset = series.offsetMs / 1000`. Bölüm değişiminde `timestampOffset`'ten ÖNCE
 *    `sourceBuffer.abort()` ZORUNLU (K0s: aksi `InvalidStateError`).
 *  - Önden en çok 30 sn tampon; seek → hedefi içeren bölüm baştan (p=0 başlık) eklenir; çekilen parçalar bellekte tutulur.
 *  - Bölümler arası boşluk atlanır (sonraki bölümün başına). 429 → `Retry-After` kadar bekle, "yükleniyor" (§5.4).
 *  - 404/401/403 → izleme belirteci düştü: `expired` (kullanıcı tıklamasıyla yeni POST /view; audit tıklama başına).
 * Bloblar için `blob:` URL (`media-src 'self' blob:`, S-P28e-11); `destroy()` `revokeObjectURL` yapar.
 */
import type { RecordingSeriesItem } from "@remote/contracts/api/recording";
import { REC_VIEW_PREBUFFER_MS } from "@remote/contracts/ws-rec";
import { API_BASE } from "../api";
import { REC_MSE_TYPE } from "./support";

export type PlayerStatus = "loading" | "ready" | "throttled" | "expired" | "error" | "ended";

export interface Segment {
  s: number;
  start: number;
  end: number;
}

/** Bölümlerin zaman aralıkları (sn). Parça yoksa bölüm atlanır. */
export function segmentsOf(series: RecordingSeriesItem[]): Segment[] {
  return series
    .filter((x) => x.parts.length > 0)
    .map((x) => {
      const last = x.parts[x.parts.length - 1] as RecordingSeriesItem["parts"][number];
      return { s: x.s, start: x.offsetMs / 1000, end: (last.offsetMs + last.durationMs) / 1000 };
    })
    .sort((a, b) => a.start - b.start);
}

/** `t` (sn) anında oynatılacak bölüm indeksi: içeren bölüm, boşluktaysa sonraki; sonrası yoksa -1. */
export function segmentAt(segs: Segment[], t: number): number {
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i] as Segment;
    if (t < g.end - 0.05) return i;
  }
  return -1;
}

/** Zaman çizgisi boşlukları (sn): başlangıç, bölümler arası ve son. */
export function gapsOf(segs: Segment[], total: number): { start: number; end: number }[] {
  const gaps: { start: number; end: number }[] = [];
  let at = 0;
  for (const g of segs) {
    if (g.start - at > 1) gaps.push({ start: at, end: g.start });
    at = Math.max(at, g.end);
  }
  if (total - at > 1) gaps.push({ start: at, end: total });
  return gaps;
}

export const recPartUrl = (rid: string, s: number, p: number) => `${API_BASE}/rec/${encodeURIComponent(rid)}/series/${s}/parts/${p}`;

class Expired extends Error {}

interface PlayerDeps {
  rid: string;
  token: string;
  series: RecordingSeriesItem[];
  durationMs: number;
  video: HTMLVideoElement;
  onStatus: (s: PlayerStatus) => void;
  fetch?: typeof fetch;
}

export class RecPlayer {
  private ms = new MediaSource();
  private sb: SourceBuffer | null = null;
  private url: string;
  private cache = new Map<string, ArrayBuffer>();
  private segs: Segment[];
  private byS = new Map<number, RecordingSeriesItem>();
  /** Ekleme imleci: bölüm indeksi + sonraki parça. */
  private cur = { i: 0, p: 0 };
  private appendedS: number | null = null;
  private gen = 0;
  private wake: (() => void) | null = null;
  private dead = false;
  private token: string;
  private readonly f: typeof fetch;
  /** Test kancası: bölüm geçişinde yapılan `abort()` sayısı. */
  aborts = 0;
  fetched = 0;

  constructor(private d: PlayerDeps) {
    this.f = d.fetch ?? ((...a) => fetch(...a));
    this.token = d.token;
    this.segs = segmentsOf(d.series);
    for (const x of d.series) this.byS.set(x.s, x);
    this.url = URL.createObjectURL(this.ms);
    d.video.src = this.url;
    this.ms.addEventListener("sourceopen", () => this.open(), { once: true });
    d.video.addEventListener("seeking", this.onSeek);
    d.video.addEventListener("timeupdate", this.onTime);
    d.video.addEventListener("waiting", this.onTime);
  }

  get segments(): Segment[] {
    return this.segs;
  }

  /** Belirteç yenilendi (kullanıcı "Devam et"e bastı → yeni POST /view). */
  resume(token: string): void {
    this.token = token;
    this.d.onStatus("loading");
    this.kick();
  }

  destroy(): void {
    this.dead = true;
    this.gen++;
    this.kick();
    const v = this.d.video;
    v.removeEventListener("seeking", this.onSeek);
    v.removeEventListener("timeupdate", this.onTime);
    v.removeEventListener("waiting", this.onTime);
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(this.url);
    this.cache.clear();
  }

  private open(): void {
    try {
      this.sb = this.ms.addSourceBuffer(REC_MSE_TYPE);
      this.sb.mode = "segments";
      this.ms.duration = Math.max(0.1, this.d.durationMs / 1000);
    } catch {
      return this.d.onStatus("error");
    }
    void this.loop();
  }

  private onSeek = () => {
    if (this.isBuffered(this.d.video.currentTime)) return;
    const i = segmentAt(this.segs, this.d.video.currentTime);
    if (i < 0) return;
    this.cur = { i, p: 0 };
    this.appendedS = null; // aynı bölüme de yeniden başlık eklenir (abort + offset)
    this.gen++;
    this.kick();
  };

  private onTime = () => {
    const v = this.d.video;
    const t = v.currentTime;
    if (!this.isBuffered(t)) {
      // Boşluk atlama: `t` bir boşluktaysa ya da içinde bulunduğu bölüm tamamen eklenmiş ama tampon bitmişse (kuyruk
      // kaybı ≤ 1,5 sn, K0s) sonraki bölümün başına geç.
      let i = -1;
      for (let k = 0; k < this.segs.length; k++) if ((this.segs[k] as Segment).start <= t + 0.01) i = k;
      const next = this.segs[i + 1];
      const inGap = i >= 0 && t >= (this.segs[i] as Segment).end - 0.05;
      if (next && (i < 0 || inGap || this.cur.i > i)) v.currentTime = next.start + 0.01;
    }
    this.kick();
  };

  private isBuffered(t: number): boolean {
    const b = this.sb?.buffered;
    if (!b) return false;
    for (let k = 0; k < b.length; k++) if (t >= b.start(k) && t < b.end(k) - 0.1) return true;
    return false;
  }

  private ahead(): number {
    const b = this.sb?.buffered;
    const t = this.d.video.currentTime;
    if (!b) return 0;
    for (let k = 0; k < b.length; k++) if (t >= b.start(k) - 0.2 && t < b.end(k)) return b.end(k) - t;
    return 0;
  }

  private kick(): void {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  private sleep(ms?: number): Promise<void> {
    return new Promise((res) => {
      const t = ms === undefined ? undefined : setTimeout(() => this.kick(), ms);
      this.wake = () => {
        clearTimeout(t);
        res();
      };
    });
  }

  private async loop(): Promise<void> {
    this.d.onStatus("loading");
    while (!this.dead) {
      const g = this.segs[this.cur.i];
      if (!g) {
        if (this.ms.readyState === "open" && !this.sb?.updating) {
          try {
            this.ms.endOfStream();
          } catch {
            /* zaten kapalı */
          }
        }
        this.d.onStatus("ready");
        await this.sleep();
        continue;
      }
      if (this.ahead() * 1000 >= REC_VIEW_PREBUFFER_MS && this.appendedS !== null) {
        this.d.onStatus("ready");
        await this.sleep(1000);
        continue;
      }
      const gen = this.gen;
      try {
        await this.step(g, gen);
      } catch (e) {
        if (e instanceof Expired) {
          this.d.onStatus("expired");
          await this.sleep();
          continue;
        }
        if (this.dead) return;
        this.d.onStatus("error");
        return;
      }
    }
  }

  private async step(g: Segment, gen: number): Promise<void> {
    const series = this.byS.get(g.s) as RecordingSeriesItem;
    const part = series.parts[this.cur.p];
    if (!part) {
      this.cur = { i: this.cur.i + 1, p: 0 };
      return;
    }
    const buf = await this.fetchPart(g.s, part.p);
    if (gen !== this.gen || this.dead) return;
    const sb = this.sb as SourceBuffer;
    await idle(sb);
    if (this.appendedS !== g.s) {
      // K0s: bölüm değişiminde timestampOffset'ten önce abort() zorunlu
      sb.abort();
      this.aborts++;
      sb.timestampOffset = g.start;
      this.appendedS = g.s;
    }
    sb.appendBuffer(buf);
    await idle(sb);
    if (gen !== this.gen) return;
    this.cur = { i: this.cur.i, p: this.cur.p + 1 };
    this.d.onStatus(this.ahead() > 0 ? "ready" : "loading");
  }

  private async fetchPart(s: number, p: number): Promise<ArrayBuffer> {
    const key = `${s}:${p}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    for (;;) {
      const res = await this.f(recPartUrl(this.d.rid, s, p), {
        headers: { Authorization: `Bearer ${this.token}` },
        credentials: "omit",
        cache: "no-store",
      });
      if (res.status === 429) {
        const ra = Number(res.headers.get("Retry-After"));
        this.d.onStatus("throttled");
        await this.sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 1000);
        if (this.dead) throw new Error("kapandı");
        continue;
      }
      if (res.status === 404 || res.status === 401 || res.status === 403) throw new Expired();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      this.fetched++;
      this.cache.set(key, buf);
      return buf;
    }
  }
}

function idle(sb: SourceBuffer): Promise<void> {
  if (!sb.updating) return Promise.resolve();
  return new Promise((res, rej) => {
    const ok = () => {
      sb.removeEventListener("error", bad);
      res();
    };
    const bad = () => {
      sb.removeEventListener("updateend", ok);
      rej(new Error("SourceBuffer hatası"));
    };
    sb.addEventListener("updateend", ok, { once: true });
    sb.addEventListener("error", bad, { once: true });
  });
}
