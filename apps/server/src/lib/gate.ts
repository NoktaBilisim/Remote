// Süreç içi eşzamanlılık kapısı (S8b-5; tek instance, ADR-0005). Anahtar (tenant) başına ve toplamda en çok N iş
// aynı anda çalışır; fazlası FIFO kuyrukta kısa süre bekler. Kuyruk doluysa hemen, bekleme süresi dolarsa zaman
// aşımıyla `GateBusyError` atılır. Amaç: seri kuyruklu DB TX'lerinin ortak bağlantı havuzunun yalnız küçük bir
// kısmını tutması (bekleyenler bağlantı tutmaz).

export interface GateOptions {
  /** Anahtar başına eşzamanlı çalışan iş. */
  perKey: number;
  /** Toplam eşzamanlı çalışan iş. */
  global: number;
  /** Anahtar başına kuyrukta bekleyebilecek iş. */
  maxWaitingPerKey: number;
  /** Toplam kuyruk üst sınırı (bellek sınırı). */
  maxWaiting: number;
  /** Kuyrukta en uzun bekleme (ms). */
  waitMs: number;
}

export class GateBusyError extends Error {
  readonly reason: "full" | "timeout";
  constructor(reason: "full" | "timeout") {
    super(`gate_${reason}`);
    this.reason = reason;
  }
}

interface Waiter {
  key: string;
  start: () => void;
  timer: NodeJS.Timeout;
}

export class ConcurrencyGate {
  private readonly o: GateOptions;
  private active = 0;
  private readonly activeByKey = new Map<string, number>();
  private readonly queue: Waiter[] = [];
  private readonly waitingByKey = new Map<string, number>();

  constructor(o: GateOptions) {
    this.o = o;
  }

  get running(): number {
    return this.active;
  }

  get waiting(): number {
    return this.queue.length;
  }

  /** `fn`'i kapı içinde çalıştırır; kapı doluysa veya bekleme aşılırsa `GateBusyError`. */
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(key);
    try {
      return await fn();
    } finally {
      this.release(key);
    }
  }

  private canRun(key: string): boolean {
    return this.active < this.o.global && (this.activeByKey.get(key) ?? 0) < this.o.perKey;
  }

  private take(key: string): void {
    this.active += 1;
    this.activeByKey.set(key, (this.activeByKey.get(key) ?? 0) + 1);
  }

  private acquire(key: string): Promise<void> {
    if (this.canRun(key)) {
      this.take(key);
      return Promise.resolve();
    }
    const waitingKey = this.waitingByKey.get(key) ?? 0;
    if (this.queue.length >= this.o.maxWaiting || waitingKey >= this.o.maxWaitingPerKey) return Promise.reject(new GateBusyError("full"));
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        key,
        start: resolve,
        timer: setTimeout(() => {
          this.dequeue(waiter);
          reject(new GateBusyError("timeout"));
        }, this.o.waitMs),
      };
      this.queue.push(waiter);
      this.waitingByKey.set(key, waitingKey + 1);
    });
  }

  private dequeue(w: Waiter): void {
    const i = this.queue.indexOf(w);
    if (i >= 0) this.queue.splice(i, 1);
    const n = (this.waitingByKey.get(w.key) ?? 1) - 1;
    if (n > 0) this.waitingByKey.set(w.key, n);
    else this.waitingByKey.delete(w.key);
  }

  private release(key: string): void {
    this.active -= 1;
    const n = (this.activeByKey.get(key) ?? 1) - 1;
    if (n > 0) this.activeByKey.set(key, n);
    else this.activeByKey.delete(key);
    // FIFO: çalışabilecek ilk bekleyenleri başlat (başka anahtarın sınırı dolu olanı atla).
    for (let i = 0; i < this.queue.length && this.active < this.o.global;) {
      const w = this.queue[i];
      if (w && this.canRun(w.key)) {
        clearTimeout(w.timer);
        this.dequeue(w);
        this.take(w.key);
        w.start();
      } else i += 1;
    }
  }
}
