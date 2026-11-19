// P29 servis dosyası belirteçleri (mimari-p29 §4.4 r2, S-P29-T-10). Bellekte (tek instance, ADR-0005): 32 bayt rastgele,
// `{deviceId, sha256, exp}`, tek kullanım (ilk alımda silinir), cihaz başına en çok 1 canlı belirteç. Belirteç loglanmaz;
// yalnız `update.token` WS mesajıyla cihaza gider ve `Authorization: Bearer` ile geri gelir. Ayrıca global eşzamanlı akış sayacı.
import { randomBytes } from "node:crypto";

interface Entry {
  deviceId: string;
  sha256: string;
  exp: number;
}

export class ServiceTokens {
  private readonly byToken = new Map<string, Entry>();
  private readonly byDevice = new Map<string, string>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private streams = 0;
  readonly maxStreams: number;

  constructor(o: { ttlSec: number; maxStreams: number; now: () => number }) {
    this.ttlMs = o.ttlSec * 1000;
    this.maxStreams = o.maxStreams;
    this.now = o.now;
  }

  /** Yeni belirteç; cihazın önceki canlı belirteci geçersizleşir. */
  issue(deviceId: string, sha256: string): string {
    this.sweep();
    const old = this.byDevice.get(deviceId);
    if (old) this.byToken.delete(old);
    const token = randomBytes(32).toString("base64url");
    this.byToken.set(token, { deviceId, sha256, exp: this.now() + this.ttlMs });
    this.byDevice.set(deviceId, token);
    return token;
  }

  /** Tek kullanım: geçerliyse kaydı döner ve siler; yok/süresi dolmuş → null. */
  take(token: string): Entry | null {
    const e = this.byToken.get(token);
    if (!e) return null;
    this.byToken.delete(token);
    if (this.byDevice.get(e.deviceId) === token) this.byDevice.delete(e.deviceId);
    return e.exp > this.now() ? e : null;
  }

  /** Akış yuvası al (global sınır); alınamazsa false. Bırakma tek kez (çağıran `release`'i bir kez çağırır). */
  acquireStream(): (() => void) | null {
    if (this.streams >= this.maxStreams) return null;
    this.streams += 1;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.streams -= 1;
    };
  }

  get activeStreams(): number {
    return this.streams;
  }

  private sweep(): void {
    const t = this.now();
    for (const [tok, e] of this.byToken)
      if (e.exp <= t) {
        this.byToken.delete(tok);
        if (this.byDevice.get(e.deviceId) === tok) this.byDevice.delete(e.deviceId);
      }
  }
}
