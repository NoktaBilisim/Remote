// P28e bellek içi sınırlar (mimari-p28e r2 §5.1 S-P28e-5, §5.4 S-P28e-3; ADR-0005 — yeniden başlatmada sıfırlanır).
// `PutGate`: belirteç başına tek uçuş + kayan pencerede ≤ REC_PUT_PER_MIN PUT/dk + süreç geneli semafor REC_PUT_CONCURRENCY.
// `ViewBuckets`: `userId + rid` jeton kovası (kapasite REC_VIEW_BURST_PARTS, dolum REC_VIEW_REFILL_PER_MIN/dk); yeni izleme
// belirteci kovayı sıfırlamaz; REC_VIEW_BUCKET_IDLE_MS kullanılmayan kova atılır.
import {
  REC_PUT_CONCURRENCY,
  REC_PUT_PER_MIN,
  REC_VIEW_BUCKET_IDLE_MS,
  REC_VIEW_BURST_PARTS,
  REC_VIEW_REFILL_PER_MIN,
} from "@remote/contracts/ws-rec";

const MINUTE_MS = 60_000;

export class PutGate {
  private readonly inflight = new Set<string>();
  private readonly windows = new Map<string, number[]>();
  private running = 0;
  private readonly concurrency: number;

  constructor(concurrency: number = REC_PUT_CONCURRENCY) {
    this.concurrency = concurrency;
  }

  /** Giriş: başarılıysa bırakma fonksiyonu (idempotent), değilse null (429). `key` = belirteç özeti. */
  enter(key: string, now: number): (() => void) | null {
    if (this.inflight.has(key) || this.running >= this.concurrency) return null;
    const w = (this.windows.get(key) ?? []).filter((t) => now - t < MINUTE_MS);
    if (w.length >= REC_PUT_PER_MIN) {
      this.windows.set(key, w);
      return null;
    }
    w.push(now);
    this.windows.set(key, w);
    this.inflight.add(key);
    this.running++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.inflight.delete(key);
      this.running--;
    };
  }

  /** Düşen belirtecin penceresi (bellek). */
  forget(key: string): void {
    this.windows.delete(key);
  }

  get busy(): number {
    return this.running;
  }
}

interface Bucket {
  tokens: number;
  at: number;
}

export class ViewBuckets {
  private readonly map = new Map<string, Bucket>();
  private readonly perMs = REC_VIEW_REFILL_PER_MIN / MINUTE_MS;

  /** Bir jeton tüketir: 0 → geçti; > 0 → bekleme (sn, `Retry-After`). */
  take(key: string, now: number): number {
    this.prune(now);
    const b = this.map.get(key) ?? { tokens: REC_VIEW_BURST_PARTS, at: now };
    b.tokens = Math.min(REC_VIEW_BURST_PARTS, b.tokens + (now - b.at) * this.perMs);
    b.at = now;
    this.map.set(key, b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil((1 - b.tokens) / this.perMs / 1000));
  }

  private prune(now: number): void {
    for (const [k, b] of this.map) if (now - b.at > REC_VIEW_BUCKET_IDLE_MS) this.map.delete(k);
  }
}
