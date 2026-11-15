// Web talep formu bot kapısı token'ı (mimari-e11 §8c.2 m.3; AC-259, S-P19-1, S-P19-T4, S-P19-K1).
// token = base64url("v2" ‖ issuedAtMs (8 B) ‖ part (8 B) ‖ nonce (16 B) ‖ HMAC-SHA256(k, "wf2|bootId|ref|issuedAt|part|nonce"));
// k = anahtar halkasından HKDF (`web-form-token`), yeni env yok. `bootId` süreç açılışında üretilir (bellekte; token'a ve loga
// yazılmaz): yeniden başlatma sonrası önceki sürecin token'ları HMAC'te düşer → boşalan nonce kümesi yeniden kullanım açığı
// doğurmaz. `part` firmanın kümedeki bölme anahtarıdır (firma kimliğinden HMAC türevi; kimliği açık taşımaz, HMAC kapsamında →
// istemci başka firmanın bölmesine yazamaz). Tüketim anında firma DB'siz ve senkron bilinir (T4: ilk await'ten önce).
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WEB_FORM_MIN_DELAY_MS, WEB_FORM_TOKEN_TTL_MS } from "@remote/contracts/api/requests";
import type { SecretBox } from "../lib/crypto.ts";

const VERSION = Buffer.from("v2", "utf8");
const AT = VERSION.length;
const PART = AT + 8;
const NONCE = PART + 8;
const MAC = NONCE + 16;
const TOKEN_BYTES = MAC + 32;
/** ADR-0005 tek instance: kullanılmış nonce kümesi toplam üst sınırı (30 dk TTL; bellek tavanı, S-P19-K1 öncesiyle aynı). */
const FORM_NONCE_MAX = 100_000;
/** S-P19-K1: firma başı üst sınır — bir firmanın bölmesi dolarsa yalnız o firmanın formu reddeder. */
const FORM_NONCE_TENANT_MAX = 10_000;

type FormTokenCheck =
  | { ok: true; part: string; nonce: string; expiresAt: number }
  | { ok: false; reason: "token" }
  | { ok: false; reason: "fast"; retryAfterMs: number };

/**
 * Firma bölmeli kullanılmış nonce kümesi. `consume` varlık denetimi ile eklemeyi AYNI senkron adımda yapar (Map has + set;
 * araya await girmez) → aynı token'la eşzamanlı N istekten yalnız biri geçer. Bölme ya da toplam doluysa önce süresi
 * geçenler atılır; hâlâ doluysa `full` (çağıran fail-closed reddeder; eski girdi atılmaz — atılsaydı o token yeniden
 * kullanılabilirdi). Boşalan bölme silinir (bellek firma sayısıyla büyümez).
 */
export class FormNonceStore {
  private readonly parts = new Map<string, Map<string, number>>();
  private total = 0;
  private readonly now: () => number;
  private readonly max: number;
  private readonly tenantMax: number;

  constructor(now: () => number, max = FORM_NONCE_MAX, tenantMax = FORM_NONCE_TENANT_MAX) {
    this.now = now;
    this.max = max;
    this.tenantMax = Math.min(tenantMax, max);
  }

  get size(): number {
    return this.total;
  }

  private sweep(part: string, used: Map<string, number>, t: number): void {
    for (const [k, exp] of used)
      if (exp <= t) {
        used.delete(k);
        this.total -= 1;
      }
    if (used.size === 0) this.parts.delete(part);
  }

  consume(part: string, nonce: string, expiresAt: number): "ok" | "used" | "full" {
    const t = this.now();
    let used = this.parts.get(part);
    const prev = used?.get(nonce);
    if (prev !== undefined && prev > t) return "used";
    if (used && used.size >= this.tenantMax) {
      this.sweep(part, used, t);
      if (used.size >= this.tenantMax) return "full";
    }
    if (this.total >= this.max) {
      for (const [p, m] of this.parts) this.sweep(p, m, t);
      if (this.total >= this.max) return "full";
    }
    used = this.parts.get(part);
    if (!used) {
      used = new Map();
      this.parts.set(part, used);
    }
    if (!used.has(nonce)) this.total += 1;
    used.set(nonce, expiresAt);
    return "ok";
  }
}

export class FormTokens {
  private readonly bootId = randomBytes(16).toString("hex");
  readonly nonces: FormNonceStore;
  private readonly secrets: SecretBox;
  private readonly now: () => number;

  constructor(secrets: SecretBox, now: () => number, maxNonces = FORM_NONCE_MAX, tenantMaxNonces = FORM_NONCE_TENANT_MAX) {
    this.secrets = secrets;
    this.now = now;
    this.nonces = new FormNonceStore(now, maxNonces, tenantMaxNonces);
  }

  private mac(ref: string, issuedAt: number, part: string, nonce: string): Buffer {
    return Buffer.from(this.secrets.mac("web-form-token", `wf2|${this.bootId}|${ref}|${issuedAt}|${part}|${nonce}`), "hex");
  }

  /** Firma bölme anahtarı (8 B): firma kimliği token'da açık taşınmaz. */
  private part(tenantId: string): Buffer {
    return Buffer.from(this.secrets.mac("web-form-token", `wf2-part|${tenantId}`), "hex").subarray(0, 8);
  }

  issue(ref: string, tenantId: string): string {
    const issuedAt = this.now();
    const nonce = randomBytes(16);
    const part = this.part(tenantId);
    const at = Buffer.alloc(8);
    at.writeBigUInt64BE(BigInt(issuedAt));
    const mac = this.mac(ref, issuedAt, part.toString("hex"), nonce.toString("hex"));
    return Buffer.concat([VERSION, at, part, nonce, mac]).toString("base64url");
  }

  /** Biçim + HMAC (ref'e bağlı) + yaş. Tüketmez: `< 2 sn` reddinde token geçerli kalır (aynı token 2 sn sonra geçer). */
  verify(token: string, ref: string): FormTokenCheck {
    const raw = Buffer.from(token, "base64url");
    if (raw.length !== TOKEN_BYTES || !raw.subarray(0, AT).equals(VERSION)) return { ok: false, reason: "token" };
    const issuedAt = Number(raw.readBigUInt64BE(AT));
    const part = raw.subarray(PART, NONCE).toString("hex");
    const nonce = raw.subarray(NONCE, MAC).toString("hex");
    if (!timingSafeEqual(raw.subarray(MAC), this.mac(ref, issuedAt, part, nonce))) return { ok: false, reason: "token" };
    const age = this.now() - issuedAt;
    if (age < 0 || age > WEB_FORM_TOKEN_TTL_MS) return { ok: false, reason: "token" };
    if (age < WEB_FORM_MIN_DELAY_MS) return { ok: false, reason: "fast", retryAfterMs: WEB_FORM_MIN_DELAY_MS - age };
    return { ok: true, part, nonce, expiresAt: issuedAt + WEB_FORM_TOKEN_TTL_MS };
  }
}
