/*
 * P28e konsol yükleyicisi (mimari-p28e r2 §5, §5.3, §7). `PUT /api/v1/rec/:rid/series/:s/parts/:p`, kimlik YALNIZ
 * `Authorization: Bearer <yükleme belirteci>` (URL'de asla, çerez gönderilmez). Tek eşzamanlı PUT, FIFO, bellekte en çok
 * 3 parça kuyruğu (≈ 15 sn); taşarsa en eski atılır (`rec.error{upload_failed}` GÖNDERİLMEZ — gözcü karar verir).
 * Yeniden deneme 1/2/4 sn; 429 → `Retry-After` kadar bekle. Bir parça atılırsa bölüm kırılır: o bölümün kalan parçaları
 * atılır ve kaydediciden yeni bölüm istenir (`onBroken`) — sunucu bitişik parça ister (409 `{next}`).
 */
import { API_BASE } from "../api";
import { REC_PART_MAX_BYTES, REC_UPLOAD_QUEUE_PARTS, REC_UPLOAD_RETRY_MS } from "@remote/contracts/ws-rec";
import type { RecPart } from "./recorder";

export interface UploadTarget {
  rid: string;
  token: string;
}

/** Ölümcül sonuç: `quota` (409 STORAGE_QUOTA), `invalid` (400), `gone` (404/401/403 — belirteç düştü / kaynak yok). */
export type UploadFatal = "quota" | "invalid" | "gone";

export interface UploaderDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Bölüm `series` kırıldı (parça atıldı / sıra dışı) → kaydedici yeni bölüm açar. */
  onBroken: (series: number) => void;
  onFatal: (kind: UploadFatal) => void;
}

export const partPath = (rid: string, s: number, p: number) => `${API_BASE}/rec/${encodeURIComponent(rid)}/series/${s}/parts/${p}`;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Outcome = "ok" | "skip" | "broken" | "retry" | "fatal";

export class Uploader {
  private queue: RecPart[] = [];
  private target: UploadTarget | null = null;
  private running = false;
  private broken = new Set<number>();
  /** Test kancası: atılan / başarısız parça sayısı (UI'ya yansımaz; §9). */
  dropped = 0;
  sent = 0;
  private readonly d: Required<Omit<UploaderDeps, "onBroken" | "onFatal">> & UploaderDeps;

  constructor(deps: UploaderDeps) {
    this.d = { fetch: (...a) => fetch(...a), sleep: defaultSleep, ...deps };
  }

  /** Yeni belirteç (`hello.rec.upload` / `rec.state.upload`); kırık bölüm kaydı sıfırlanır. */
  setTarget(t: UploadTarget | null): void {
    this.target = t;
    if (!t) this.queue = [];
    this.broken.clear();
  }

  get pending(): number {
    return this.queue.length;
  }

  enqueue(p: RecPart): void {
    if (this.broken.has(p.series)) return;
    if (p.blob.size > REC_PART_MAX_BYTES) return this.breakSeries(p.series);
    this.queue.push(p);
    while (this.queue.length > REC_UPLOAD_QUEUE_PARTS) {
      const old = this.queue.shift() as RecPart;
      this.breakSeries(old.series);
    }
    void this.pump();
  }

  clear(): void {
    this.queue = [];
  }

  private breakSeries(series: number): void {
    this.dropped++;
    if (this.broken.has(series)) return;
    this.broken.add(series);
    this.queue = this.queue.filter((q) => q.series !== series);
    this.d.onBroken(series);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && this.target) {
        const p = this.queue[0] as RecPart;
        const out = await this.sendWithRetry(p, this.target);
        if (this.queue[0] === p) this.queue.shift();
        if (out === "ok") this.sent++;
        else if (out === "broken") this.breakSeries(p.series);
        else if (out === "fatal") this.queue = [];
      }
    } finally {
      this.running = false;
    }
  }

  private async sendWithRetry(p: RecPart, t: UploadTarget): Promise<Outcome> {
    for (let attempt = 0; ; attempt++) {
      const r = await this.put(p, t);
      if (r.kind !== "retry") return r.kind;
      if (this.target !== t) return "skip"; // belirteç değişti
      if (r.wait !== undefined) {
        await this.d.sleep(r.wait);
        attempt--; // 429 deneme sayılmaz
        continue;
      }
      const delay = REC_UPLOAD_RETRY_MS[attempt];
      if (delay === undefined) return "broken";
      await this.d.sleep(delay);
    }
  }

  private async put(p: RecPart, t: UploadTarget): Promise<{ kind: Outcome; wait?: number }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${t.token}`,
      "Content-Type": "video/webm",
      "X-Rec-Duration-Ms": String(p.durationMs),
    };
    if (p.part === 0 && p.seriesStartMs !== undefined) headers["X-Rec-Series-Start-Ms"] = String(Math.floor(p.seriesStartMs));
    let res: Response;
    try {
      res = await this.d.fetch(partPath(t.rid, p.series, p.part), {
        method: "PUT",
        headers,
        body: p.blob,
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      return { kind: "retry" };
    }
    return classify(res, p, (k) => this.d.onFatal(k));
  }
}

/** Yanıt → sonuç (saf; birim testli). */
export async function classify(res: Response, p: RecPart, fatal: (k: UploadFatal) => void): Promise<{ kind: Outcome; wait?: number }> {
  if (res.ok) return { kind: "ok" };
  if (res.status === 429) {
    const ra = Number(res.headers.get("Retry-After"));
    return { kind: "retry", wait: Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : 1000 };
  }
  if (res.status === 409) {
    const body = (await res.json().catch(() => null)) as { next?: unknown; error?: { code?: unknown } } | null;
    if (body?.error?.code === "STORAGE_QUOTA") {
      fatal("quota");
      return { kind: "fatal" };
    }
    if (body && typeof body.next === "number") return { kind: body.next > p.part ? "skip" : "broken" };
    return { kind: "broken" }; // yeni bölüm kuralı (CONFLICT): yeni bölüm açılır
  }
  if (res.status === 400) {
    fatal("invalid");
    return { kind: "fatal" };
  }
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    fatal("gone");
    return { kind: "fatal" };
  }
  return { kind: "retry" };
}
