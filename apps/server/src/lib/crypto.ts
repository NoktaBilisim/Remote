// Gizli alan şifreleme (mimari §3.2, AC-78, T15): AES-256-GCM, biçim `ver(1B) | iv(12B) | tag(16B) | ciphertext`.
// Anahtarlar APP_ENCRYPTION_KEYS'ten; yeni yazım en yüksek sürümle, okuma `ver` baytına göre (rotasyon).
// Anahtar yoksa (yalnız dev/test; prod env.ts'de zorunlu) süreç başına rastgele tek anahtar.
// B-P10-8: her şifreli değer AAD ile `tablo.sütun:satır` bağlamına bağlanır (`aadFor`); başka satıra/sütuna taşınan
// değer çözülemez. AAD'siz eski biçim okunmaz (P10 öncesi prod verisi yok — implementation.md P10 Düzeltme turu 1).
// B-P10-7: `mac` — anahtarlı özet (HMAC-SHA-256, anahtar HKDF ile amaç etiketine göre türetilir; şifreleme anahtarıyla
// aynı bayt dizisi doğrudan kullanılmaz). Rotasyonda eski sürümlerin özeti de denenir (`macCandidates`).
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

let processKeys: Map<number, Buffer> | undefined;

/** AAD bağlamları — tek yer (yeni şifreli sütun buraya eklenir). */
export const aadFor = {
  totpSecret: (userId: string): string => `users.totp_secret_enc:${userId}`,
  smtpPassword: (tenantId: string): string => `tenant_settings.smtp_pass_enc:${tenantId}`,
  /** P11: `system_settings.secret_enc` — `turn` satırı. */
  systemSecret: (key: "turn"): string => `system_settings.secret_enc:${key}`,
  /** P11 (B-P11-1): `mysql` satırı hedefe (host:port:user) bağlı — hedef değişince kayıtlı şifre çözülemez. */
  mysqlSecret: (t: { host: string; port: number; user: string }): string =>
    `system_settings.secret_enc:mysql:${t.host.toLowerCase()}:${t.port}:${t.user}`,
  /** S-P13b-3: `whatsapp` satırı servis anahtarı, adresin kökenine (şema+host+port) bağlı — köken değişince çözülemez. */
  whatsappApiKey: (origin: string): string => `system_settings.secret_enc:whatsapp:${origin}`,
} as const;

/** HKDF amaç etiketleri (anahtar ayrımı). */
export type MacPurpose = "recovery-code" | "avatar-url" | "purge-preview";

export class SecretBox {
  private readonly keys: Map<number, Buffer>;
  private readonly current: number;
  private readonly macKeys = new Map<string, Buffer>();

  constructor(keys: Map<number, Buffer> | null) {
    processKeys ??= new Map([[1, randomBytes(32)]]);
    this.keys = keys ?? processKeys;
    this.current = Math.max(...this.keys.keys());
  }

  encrypt(plain: string, aad: string): Uint8Array<ArrayBuffer> {
    const key = this.keys.get(this.current);
    if (!key) throw new Error("şifreleme anahtarı yok");
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    c.setAAD(Buffer.from(aad, "utf8"));
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    const out = new Uint8Array(new ArrayBuffer(29 + ct.length));
    out.set([this.current], 0);
    out.set(iv, 1);
    out.set(c.getAuthTag(), 13);
    out.set(ct, 29);
    return out;
  }

  /** Bilinmeyen sürüm / bozuk veri / yanlış anahtar / yanlış AAD → hata (çağıran "ayar okunamadı" olarak ele alır). */
  decrypt(data: Uint8Array, aad: string): string {
    const buf = Buffer.from(data);
    if (buf.length < 30) throw new Error("şifreli veri kısa");
    const key = this.keys.get(buf[0] ?? 0);
    if (!key) throw new Error("şifreleme anahtarı sürümü bilinmiyor");
    const d = createDecipheriv("aes-256-gcm", key, buf.subarray(1, 13));
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(buf.subarray(13, 29));
    return Buffer.concat([d.update(buf.subarray(29)), d.final()]).toString("utf8");
  }

  private macKey(ver: number, purpose: MacPurpose): Buffer {
    const id = `${ver}:${purpose}`;
    let k = this.macKeys.get(id);
    if (!k) {
      const base = this.keys.get(ver);
      if (!base) throw new Error("şifreleme anahtarı sürümü bilinmiyor");
      k = Buffer.from(hkdfSync("sha256", base, Buffer.alloc(0), `remote-support/${purpose}/v1`, 32));
      this.macKeys.set(id, k);
    }
    return k;
  }

  /** HMAC-SHA-256 hex (64) — güncel anahtar sürümüyle (yeni yazım). */
  mac(purpose: MacPurpose, value: string): string {
    return createHmac("sha256", this.macKey(this.current, purpose)).update(value, "utf8").digest("hex");
  }

  /** Tüm anahtar sürümleriyle özetler (doğrulama; rotasyondan önce yazılmış kayıtlar da eşleşir). */
  macCandidates(purpose: MacPurpose, value: string): string[] {
    return [...this.keys.keys()].map((v) => createHmac("sha256", this.macKey(v, purpose)).update(value, "utf8").digest("hex"));
  }
}
