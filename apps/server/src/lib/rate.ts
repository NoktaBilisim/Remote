// Bellek içi sabit pencereli sayaç (tek instance, ADR-0005). Login IP limiti ve hesap+IP kilidi
// (G-23) bunu kullanır; P2/P3 limitleri aynı sınıfı kullanır. Süreç yeniden başlarsa sıfırlanır.
// S2-1: kayıt sayısı üst sınırlı (dolunca en eski kayıt atılır — Map ekleme sırası); süresi dolan
// kayıtlar istek yolunda değil, periyodik (unref'li) zamanlayıcıyla temizlenir.
// S3-1 / K11: atarken kilidi süren kayıt atlanır (en eskiden en çok EVICT_SCAN kayda bakılır); hepsi
// kilitliyse yeni kayıt eklenmez ve olay "kilitli" sayılır (fail-closed) — sahte anahtarla kilit silinemez.

const EVICT_SCAN = 32;

interface Entry {
  count: number;
  windowEnds: number;
  blockedUntil: number;
}

export interface CounterOptions {
  maxEntries?: number;
  sweepIntervalMs?: number;
  now?: () => number;
}

export class FixedWindowCounter {
  private readonly entries = new Map<string, Entry>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly blockMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly timer: NodeJS.Timeout | undefined;

  /** `limit`: kaçıncı olayda kilit başlar; `windowMs`: sayım penceresi; `blockMs`: kilit süresi. */
  constructor(limit: number, windowMs: number, blockMs: number, opts: CounterOptions = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.blockMs = blockMs;
    this.maxEntries = opts.maxEntries ?? 50_000;
    this.now = opts.now ?? Date.now;
    const every = opts.sweepIntervalMs ?? 30_000;
    if (every > 0) {
      this.timer = setInterval(() => this.prune(), every);
      this.timer.unref();
    }
  }

  get size(): number {
    return this.entries.size;
  }

  /** Kilitliyse kalan saniye, değilse 0. */
  blockedFor(key: string): number {
    const entry = this.entries.get(key);
    const left = entry ? entry.blockedUntil - this.now() : 0;
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  /** Kapasite doluysa kilidi bitmiş en eski kaydı atar; atılacak kayıt yoksa false. O(EVICT_SCAN). */
  private makeRoom(t: number): boolean {
    if (this.entries.size < this.maxEntries) return true;
    let scanned = 0;
    for (const [k, e] of this.entries) {
      if (e.blockedUntil <= t) {
        this.entries.delete(k);
        return true;
      }
      if (++scanned >= EVICT_SCAN) break;
    }
    return false;
  }

  /** Bir olay sayar; bu olayla limit aşıldıysa (veya tablo kilitli kayıtlarla doluysa) true döner. O(1). */
  hit(key: string): boolean {
    const t = this.now();
    let entry = this.entries.get(key);
    if (!entry || entry.windowEnds <= t) {
      const blockedUntil = entry?.blockedUntil ?? 0;
      this.entries.delete(key); // yeniden ekleme → en yeni sıraya geçer
      if (!this.makeRoom(t)) return true;
      entry = { count: 0, windowEnds: t + this.windowMs, blockedUntil };
      this.entries.set(key, entry);
    }
    entry.count += 1;
    if (entry.count < this.limit) return false;
    entry.blockedUntil = t + this.blockMs;
    entry.count = 0;
    return true;
  }

  /** Geçerli penceredeki olay sayısı (pencere bittiyse 0). */
  count(key: string): number {
    const entry = this.entries.get(key);
    return entry && entry.windowEnds > this.now() ? entry.count : 0;
  }

  /** Anahtarı hemen kilitler (dış eşik hesabı aşıldığında; S8b-6). Kayıt yoksa ve tablo kilitli kayıtlarla doluysa eklenmez. */
  block(key: string): void {
    const t = this.now();
    let entry = this.entries.get(key);
    if (!entry) {
      if (!this.makeRoom(t)) return;
      entry = { count: 0, windowEnds: t + this.windowMs, blockedUntil: 0 };
      this.entries.set(key, entry);
    }
    entry.blockedUntil = t + this.blockMs;
    entry.count = 0;
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  /** Penceresi ve kilidi bitmiş kayıtları siler (zamanlayıcıdan çağrılır). */
  prune(): void {
    const t = this.now();
    for (const [k, e] of this.entries) if (e.windowEnds <= t && e.blockedUntil <= t) this.entries.delete(k);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
