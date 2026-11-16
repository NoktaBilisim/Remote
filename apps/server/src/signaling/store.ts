// Tek kullanımlık, süreli gizli değer deposu (joinNonce, wsTicket, mimari §3.5). Anahtar düz değer değil
// SHA-256'sı; `take` aynı senkron adımda kontrol + silme yapar (yarış yok). Kayıt sayısı üst sınırlı.
import { newSecretToken, sha256Hex } from "../lib/ids.ts";
import type { Clock } from "./types.ts";

interface Item<T> {
  value: T;
  expiresAt: number;
}

export class OneTimeStore<T> {
  private readonly items = new Map<string, Item<T>>();
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly max: number;

  constructor(clock: Clock, ttlMs: number, max = 20_000) {
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.max = max;
  }

  get size(): number {
    return this.items.size;
  }

  /** Yeni değer üretir; dolarsa süresi geçmişleri, yine doluysa en eskiyi atar. */
  /** `ttlMs` verilirse bu kayıt için depo varsayılanı yerine (P28u `ask` odası bileti 150 sn). */
  issue(value: T, ttlMs = this.ttlMs): { token: string; expiresAt: number } {
    if (this.items.size >= this.max) this.prune();
    if (this.items.size >= this.max) {
      const oldest = this.items.keys().next().value;
      if (oldest !== undefined) this.items.delete(oldest);
    }
    const token = newSecretToken();
    const expiresAt = this.clock.now() + ttlMs;
    this.items.set(sha256Hex(token), { value, expiresAt });
    return { token, expiresAt };
  }

  /** Geçerliyse değeri döndürür ve siler; yoksa/süresi geçmişse null (yine silinir). */
  take(token: string): T | null {
    const key = sha256Hex(token);
    const item = this.items.get(key);
    this.items.delete(key);
    return item && item.expiresAt > this.clock.now() ? item.value : null;
  }

  prune(): void {
    const t = this.clock.now();
    for (const [k, v] of this.items) if (v.expiresAt <= t) this.items.delete(k);
  }
}
