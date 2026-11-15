// Web talep formu bot kapısı token'ı (mimari-e11 §8c.2 m.3; AC-259, S-P19-1, S-P19-T4).
// token = base64url("v1" ‖ issuedAtMs (8 B) ‖ nonce (16 B) ‖ HMAC-SHA256(k, "wf1|bootId|ref|issuedAt|nonce")); k = anahtar
// halkasından HKDF (`web-form-token`), yeni env yok. `bootId` süreç açılışında üretilir (bellekte; token'a ve loga yazılmaz):
// yeniden başlatma sonrası önceki sürecin token'ları HMAC'te düşer → boşalan nonce kümesi yeniden kullanım açığı doğurmaz.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WEB_FORM_MIN_DELAY_MS, WEB_FORM_TOKEN_TTL_MS } from "@remote/contracts/api/requests";
import type { SecretBox } from "../lib/crypto.ts";

const VERSION = Buffer.from("v1", "utf8");
const TOKEN_BYTES = VERSION.length + 8 + 16 + 32;
/** ADR-0005 tek instance: kullanılmış nonce kümesi üst sınırı (30 dk TTL). */
export const FORM_NONCE_MAX = 100_000;

export type FormTokenCheck =
  { ok: true; nonce: string; expiresAt: number } | { ok: false; reason: "token" } | { ok: false; reason: "fast"; retryAfterMs: number };

/**
 * Kullanılmış nonce kümesi. `consume` varlık denetimi ile eklemeyi AYNI senkron adımda yapar (Map has + set; araya await
 * girmez) → aynı token'la eşzamanlı N istekten yalnız biri geçer. Doluysa önce süresi geçenler atılır; hâlâ doluysa
 * `full` (çağıran fail-closed reddeder; eski girdi atılmaz — atılsaydı o token yeniden kullanılabilirdi).
 */
export class FormNonceStore {
  private readonly used = new Map<string, number>();
  private readonly now: () => number;
  private readonly max: number;

  constructor(now: () => number, max = FORM_NONCE_MAX) {
    this.now = now;
    this.max = max;
  }

  get size(): number {
    return this.used.size;
  }

  consume(nonce: string, expiresAt: number): "ok" | "used" | "full" {
    const t = this.now();
    const prev = this.used.get(nonce);
    if (prev !== undefined && prev > t) return "used";
    if (this.used.size >= this.max) {
      for (const [k, exp] of this.used) if (exp <= t) this.used.delete(k);
      if (this.used.size >= this.max) return "full";
    }
    this.used.set(nonce, expiresAt);
    return "ok";
  }
}

export class FormTokens {
  private readonly bootId = randomBytes(16).toString("hex");
  readonly nonces: FormNonceStore;
  private readonly secrets: SecretBox;
  private readonly now: () => number;

  constructor(secrets: SecretBox, now: () => number, maxNonces = FORM_NONCE_MAX) {
    this.secrets = secrets;
    this.now = now;
    this.nonces = new FormNonceStore(now, maxNonces);
  }

  private mac(ref: string, issuedAt: number, nonce: string): Buffer {
    return Buffer.from(this.secrets.mac("web-form-token", `wf1|${this.bootId}|${ref}|${issuedAt}|${nonce}`), "hex");
  }

  issue(ref: string): string {
    const issuedAt = this.now();
    const nonce = randomBytes(16);
    const at = Buffer.alloc(8);
    at.writeBigUInt64BE(BigInt(issuedAt));
    return Buffer.concat([VERSION, at, nonce, this.mac(ref, issuedAt, nonce.toString("hex"))]).toString("base64url");
  }

  /** Biçim + HMAC (ref'e bağlı) + yaş. Tüketmez: `< 2 sn` reddinde token geçerli kalır (aynı token 2 sn sonra geçer). */
  verify(token: string, ref: string): FormTokenCheck {
    const raw = Buffer.from(token, "base64url");
    if (raw.length !== TOKEN_BYTES || !raw.subarray(0, VERSION.length).equals(VERSION)) return { ok: false, reason: "token" };
    const issuedAt = Number(raw.readBigUInt64BE(VERSION.length));
    const nonce = raw.subarray(VERSION.length + 8, VERSION.length + 24).toString("hex");
    const given = raw.subarray(VERSION.length + 24);
    if (!timingSafeEqual(given, this.mac(ref, issuedAt, nonce))) return { ok: false, reason: "token" };
    const age = this.now() - issuedAt;
    if (age < 0 || age > WEB_FORM_TOKEN_TTL_MS) return { ok: false, reason: "token" };
    if (age < WEB_FORM_MIN_DELAY_MS) return { ok: false, reason: "fast", retryAfterMs: WEB_FORM_MIN_DELAY_MS - age };
    return { ok: true, nonce, expiresAt: issuedAt + WEB_FORM_TOKEN_TTL_MS };
  }
}
