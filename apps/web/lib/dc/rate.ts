import { CHAT_SEND_PER_SEC } from "@remote/contracts/dc";

/*
 * Alıcı tarafı hız sınırı (S-P5-1/2/6): karşı tarafın DataChannel girdisi (teklif, sohbet, çizim) bu tarafta
 * işlenmeden/sunucuya yansıtılmadan önce sınırlanır; aşan mesaj sessizce düşer.
 */
export class RateWindow {
  private hits: number[] = [];
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}
  /** Pencerede yer varsa sayar ve true döner; yoksa false (sayılmaz). */
  take(): boolean {
    const t = this.now();
    while (this.hits.length && t - this.hits[0]! >= this.windowMs) this.hits.shift();
    if (this.hits.length >= this.max) return false;
    this.hits.push(t);
    return true;
  }
}

/**
 * Gelen chat / annot için alıcı sınırları (mesaj / sn). Lazer gönderende de 30/sn (annot.ts).
 * AC-227: alıcı chat sınırı gönderen sınırının 2 katı — gönderen kayan pencereye uyduğu sürece, paketler ağda
 * sıkışıp art arda gelse de alıcıda sessiz düşme olmaz (sel koruması S-P5-6 yine sınırlı).
 */
export const IN_LIMITS = { chat: CHAT_SEND_PER_SEC * 2, annot: 30, laser: 30 } as const;

/** AC-227: gönderen tarafta sohbet sınırı (kayan 1 sn penceresinde `CHAT_SEND_PER_SEC`); aşan gönderim reddedilir. */
export function chatSendLimiter(now: () => number = Date.now): RateWindow {
  return new RateWindow(CHAT_SEND_PER_SEC, 1000, now);
}

export function inboundLimiter(now: () => number = Date.now) {
  const w = {
    chat: new RateWindow(IN_LIMITS.chat, 1000, now),
    annot: new RateWindow(IN_LIMITS.annot, 1000, now),
    laser: new RateWindow(IN_LIMITS.laser, 1000, now),
  };
  return (t: string): boolean =>
    t === "chat" ? w.chat.take() : t === "annot.laser" ? w.laser.take() : t.startsWith("annot.") ? w.annot.take() : true;
}
