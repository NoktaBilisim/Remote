// P28u müdahale komutlarının bekleyen yanıtları (mimari-p28u §5.3, §6.3; AC-442–444). hub.ts "dokunan böler" sınırı nedeniyle
// ayrı: oturum başına tek bekleyen komut (`INTERVENE_PENDING`), `intervene.result` yalnız aynı `id` ile eşleşir, süre aşımı
// `timeout`. Zamanlayıcı `rooms.clock` üzerinde (sahte saatle test edilir).
import type { InterveneCommand, InterveneFailReason } from "@remote/contracts/ws-device";
import type { Clock } from "../signaling/types.ts";

export interface InterveneOutcome {
  ok: boolean;
  reason?: InterveneFailReason;
}

interface Pending {
  id: string;
  cmd: InterveneCommand;
  resolve: (o: InterveneOutcome) => void;
  timer: unknown;
}

export class InterveneWaits {
  private readonly pending = new Map<string, Pending>();
  private readonly clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  has(sessionId: string): boolean {
    return this.pending.has(sessionId);
  }

  /** Komut gönderilmeden ÖNCE kaydedilir (yanıt yarışı yok); `ms` dolunca `timeout`. */
  wait(sessionId: string, id: string, cmd: InterveneCommand, ms: number): Promise<InterveneOutcome> {
    return new Promise((resolve) => {
      const timer = this.clock.setTimeout(() => {
        if (this.pending.get(sessionId)?.id !== id) return;
        this.pending.delete(sessionId);
        resolve({ ok: false, reason: "timeout" });
      }, ms);
      this.pending.set(sessionId, { id, cmd, resolve, timer });
    });
  }

  /** Cihazdan gelen sonuç; eşleşmezse false (yok sayılır). */
  settle(sessionId: string, m: { id: string; cmd: InterveneCommand; ok: boolean; reason?: InterveneFailReason | undefined }): boolean {
    const p = this.pending.get(sessionId);
    if (p?.id !== m.id || p.cmd !== m.cmd) return false;
    this.pending.delete(sessionId);
    this.clock.clearTimeout(p.timer);
    p.resolve(m.ok ? { ok: true } : { ok: false, reason: m.reason ?? "api_error" });
    return true;
  }
}
