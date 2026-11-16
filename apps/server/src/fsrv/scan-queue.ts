// P28b adil tarama kuyruğu (mimari-p28b §7.2 O-P28b-3, K-P28b-22; güvenlik D-r2-3). Sistem genelinde `AV_CONCURRENCY` yuva;
// aynı anda en çok bir > `AV_LARGE_BYTES` tarama; firma başına en çok 1 etkin; bekleyen toplam ≤ 20, firma başına ≤ 3 (aşan
// hemen BUSY). Boşalan yuva firmalar arasında round-robin (firma içinde FIFO). Bekleme sınırı küçük dosyada 30 sn; büyük
// dosyada D-r2-3 gereği tarama bütçesi + pay (75 sn) — tek firmanın büyük taramaları diğer firmaların büyük dosyalarını BUSY
// yapamaz. Sınır sabitleri sunucuya yereldir (contracts değişmez).
import { AV_CONCURRENCY, AV_LARGE_BYTES, AV_QUEUE_MAX, AV_QUEUE_WAIT_MS, AV_TENANT_QUEUE_MAX } from "@remote/contracts/ws-fsrv";

/** D-r2-3: büyük dosya kuyruğu bekleme sınırı (AV_SCAN_TIMEOUT_MS 60 sn + 15 sn pay). */
export const AV_LARGE_QUEUE_WAIT_MS = 75_000;

export interface QueueClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export interface QueueOptions {
  concurrency?: number;
  largeBytes?: number;
  queueMax?: number;
  tenantQueueMax?: number;
  waitMs?: number;
  largeWaitMs?: number;
}

/** Yuva bırakma işlevi (bir kez). */
export type Release = () => void;

interface Waiter {
  tenantId: string;
  large: boolean;
  resolve(r: Release | "BUSY"): void;
  timer: unknown;
}

export class ScanQueue {
  private readonly o: Required<QueueOptions>;
  private readonly clock: QueueClock;
  private readonly waiting = new Map<string, Waiter[]>();
  private readonly active = new Set<string>();
  private running = 0;
  private largeRunning = false;
  private order: string[] = [];
  private cursor = 0;

  constructor(clock: QueueClock, o: QueueOptions = {}) {
    this.clock = clock;
    this.o = {
      concurrency: o.concurrency ?? AV_CONCURRENCY,
      largeBytes: o.largeBytes ?? AV_LARGE_BYTES,
      queueMax: o.queueMax ?? AV_QUEUE_MAX,
      tenantQueueMax: o.tenantQueueMax ?? AV_TENANT_QUEUE_MAX,
      waitMs: o.waitMs ?? AV_QUEUE_WAIT_MS,
      largeWaitMs: o.largeWaitMs ?? AV_LARGE_QUEUE_WAIT_MS,
    };
  }

  /** Bekleyen iş sayısı (`rs_av_queue_depth`). */
  get depth(): number {
    let n = 0;
    for (const q of this.waiting.values()) n += q.length;
    return n;
  }

  acquire(tenantId: string, sizeBytes: number): Promise<Release | "BUSY"> {
    const large = sizeBytes > this.o.largeBytes;
    const mine = this.waiting.get(tenantId) ?? [];
    if (this.depth >= this.o.queueMax || mine.length >= this.o.tenantQueueMax) return Promise.resolve("BUSY");
    return new Promise((resolve) => {
      const w: Waiter = { tenantId, large, resolve, timer: undefined };
      w.timer = this.clock.setTimeout(() => this.expire(w), large ? this.o.largeWaitMs : this.o.waitMs);
      mine.push(w);
      this.waiting.set(tenantId, mine);
      if (!this.order.includes(tenantId)) this.order.push(tenantId);
      this.pump();
    });
  }

  private expire(w: Waiter): void {
    const q = this.waiting.get(w.tenantId);
    const i = q?.indexOf(w) ?? -1;
    if (!q || i < 0) return;
    q.splice(i, 1);
    if (q.length === 0) this.dropTenant(w.tenantId);
    w.resolve("BUSY");
  }

  private dropTenant(tenantId: string): void {
    this.waiting.delete(tenantId);
    const i = this.order.indexOf(tenantId);
    if (i < 0) return;
    this.order.splice(i, 1);
    if (this.cursor > i) this.cursor--;
  }

  private pump(): void {
    while (this.running < this.o.concurrency && this.order.length > 0) {
      let picked: Waiter | undefined;
      for (let k = 0; k < this.order.length; k++) {
        const idx = (this.cursor + k) % this.order.length;
        const tenantId = this.order[idx] ?? "";
        const head = this.waiting.get(tenantId)?.[0];
        if (!head || this.active.has(tenantId) || (head.large && this.largeRunning)) continue;
        picked = head;
        this.cursor = idx + 1;
        break;
      }
      if (!picked) return;
      this.start(picked);
    }
  }

  private start(w: Waiter): void {
    const q = this.waiting.get(w.tenantId) ?? [];
    q.shift();
    if (q.length === 0) this.dropTenant(w.tenantId);
    this.clock.clearTimeout(w.timer);
    this.running++;
    this.active.add(w.tenantId);
    if (w.large) this.largeRunning = true;
    let released = false;
    w.resolve(() => {
      if (released) return;
      released = true;
      this.running--;
      this.active.delete(w.tenantId);
      if (w.large) this.largeRunning = false;
      this.pump();
    });
  }
}
