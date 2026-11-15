// Ortam değişkenleri tek giriş noktası (mimari §8.1). Doğrulanmamış process.env başka yerde okunmaz.
// Her paket yalnız kullandığı anahtarları ister; diğerleri (APP_ENCRYPTION_KEYS …)
// ilgili pakette eklenir.
import { isIP } from "node:net";
import { waApiKeySchema, waServiceUrlSchema } from "@remote/contracts/api/system-settings";
import { z } from "zod";

const cidr = z.string().refine((v) => {
  const [addr, bits, ...rest] = v.split("/");
  if (!addr || bits === undefined || rest.length > 0 || !/^\d{1,3}$/.test(bits)) return false;
  const family = isIP(addr);
  return family !== 0 && Number(bits) <= (family === 4 ? 32 : 128);
}, "CIDR olmalı (ör. 172.30.0.2/32)");

const origin = z.url().transform((v) => new URL(v).origin);

/** `v1:<base64 32 bayt>[,v2:...]` (mimari §3.2, §8.1). Sürüm 1..255 tekil; her anahtar tam 32 bayt. */
export function parseEncryptionKeys(raw: string): Map<number, Buffer> | null {
  const keys = new Map<number, Buffer>();
  for (const part of raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const m = /^v(\d{1,3}):([A-Za-z0-9+/]+={0,2})$/.exec(part);
    if (!m?.[1] || !m[2]) return null;
    const ver = Number(m[1]);
    const key = Buffer.from(m[2], "base64");
    if (ver < 1 || ver > 255 || keys.has(ver) || key.length !== 32) return null;
    keys.set(ver, key);
  }
  return keys.size > 0 ? keys : null;
}

/** S14-7: herkesçe bilinen/zayıf anahtar — tüm baytları aynı (CI'daki 32 sıfır bayt dahil). Production'da reddedilir. */
export const isWeakEncryptionKey = (key: Buffer): boolean => key.every((b) => b === key[0]);

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    PUBLIC_BASE_URL: z.url().refine((v) => /^https?:\/\//.test(v), "http(s) URL olmalı"),
    DATABASE_URL: z.string().startsWith("mysql://"),
    // Güvenilen proxy'ler (G-11): compose'da caddy .2 + web .3 = 172.30.0.2/31 (tek CIDR).
    // Boşsa X-Forwarded-For hiç okunmaz.
    TRUSTED_PROXY_CIDR: cidr.optional(),
    // Virgülle ayrılmış origin listesi; boşsa PUBLIC_BASE_URL origin'i.
    ALLOWED_ORIGINS: z.string().optional(),
    // sessionRef HMAC anahtarı (mimari-api.md "Ortak kurallar"). Production'da zorunlu (S-P2-7); geliştirme/
    // testte boşsa süreç başına rastgele üretilir (yeniden başlatmada eski ref'ler 404 olur).
    SESSION_REF_KEY: z.string().min(32, "en az 32 karakter olmalı").optional(),
    // TURN (mimari §8.1, ADR-0007, §8.3.1): virgüllü URL listesi; boşsa iceServers boş (yalnız P2P/host).
    TURN_URLS: z.string().optional(),
    // coturn `static-auth-secret`; turn:/turns: URL'si varsa zorunlu. Loglanmaz.
    TURN_SECRET: z.string().min(32, "en az 32 karakter olmalı (coturn başlatıcısı)").optional(),
    TURN_CRED_TTL_MIN: z.coerce.number().int().min(5).max(60).default(20),
    // /metrics Bearer (AC-89). Boşsa /metrics kapalı (404).
    METRICS_TOKEN: z.string().min(16, "en az 16 karakter olmalı").optional(),
    // "Kötüye kullanımı bildir" mailto: adresi (AC-125, K10). Boşsa dev/test'te ilk aktif Super Admin e-postası (V13);
    // production'da boşsa resolve `abuseEmail: null` döner — Super Admin adresi açığa çıkmaz (S-P4-1).
    ABUSE_EMAIL: z.email().max(190).optional(),
    // Windows istemcisi (P6, mimari §8.1, ADR-0010, G-07): volume'daki ikilinin yolu ve deploy betiğinin
    // attestation + SHA256SUMS doğrulamasından sonra yazdığı SHA-256. İkisi dolu ve dosya hash'i eşleşmedikçe indirme 503.
    AGENT_BINARY_PATH: z.string().startsWith("/", "mutlak yol olmalı").optional(),
    AGENT_SHA256: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "64 haneli onaltılık SHA-256 olmalı")
      .transform((v) => v.toLowerCase())
      .optional(),
    // P8b (mimari-e9 §6, §13.5, AC-150/152): whatsapp-bildirim servisi; sistem düzeyi, tenant değiştiremez. Prod'da http:// +
    // özel olmayan adres → kanal kapalı (fail-closed, notify/whatsapp.ts).
    // G-P13b-2 (repo public): yerleşik varsayılan adres YOK; boş → kanal yapılandırılmamış (K13 "kanal kapalı" ile aynı:
    // gönderim yok, testler sabit "yapılandırılmamış" yanıtı). Adres yalnız bu env ya da Super Admin panel kaydından gelir.
    // B-P12b-3: panel kaydıyla aynı kural (waServiceUrlSchema: http/https, kullanıcı:şifre/?/# yok, ≤ 200; sondaki / kırpılır);
    // uymazsa açılış durur (değer hata mesajına yazılmaz).
    WHATSAPP_SERVICE_URL: waServiceUrlSchema.optional(),
    // S-P13b-3: servisin `x-api-key` anahtarı (16–256, boşluk/kontrol karakteri yok). Yalnız env adresiyle birlikte gönderilir
    // (panel adresine panel anahtarı gider). Loglanmaz; değer hata mesajına yazılmaz.
    WHATSAPP_SERVICE_API_KEY: waApiKeySchema.optional(),
    // P8b r2 (§13.4, G-E9-4): asgari Windows istemci sürümü; boş = kontrol yok. Düşük sürüm → 426 CLIENT_OUTDATED.
    MIN_AGENT_VERSION: z
      .string()
      .regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/, "x.y.z biçiminde olmalı")
      .optional(),
    // P10 (mimari §3.2, §8.1): `*_enc` alanlarının AES-256-GCM anahtarları; yeni yazım en yüksek sürümle, okuma `ver`
    // baytına göre (rotasyon: yeni sürüm eklenir, eski okunabilir kalır). Production'da zorunlu; geliştirme/testte boşsa
    // süreç başına rastgele (yeniden başlatmada kayıtlı SMTP şifresi/TOTP sırrı çözülemez). Loglanmaz.
    APP_ENCRYPTION_KEYS: z
      .string()
      .refine((v) => parseEncryptionKeys(v) !== null, "v1:<base64 32 bayt>[,v2:...] biçiminde olmalı")
      .optional(),
    // P12 (AC-84, T16): logo/avatar yükleme kökü; `{tenantId|system}/{rastgele}.{png|jpg|webp}` altında. Kalıcı volume,
    // `node` kullanıcısı yazabilmeli (compose/runbook: devops). Mutlak yol.
    UPLOADS_DIR: z.string().startsWith("/", "mutlak yol olmalı").default("/data/uploads"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    // P16 (AC-240, ADR-0030 m.6, mimari-e11 §7.7): gece kalıcı silme modu. `dry` (varsayılan) aday sayılarını audit'e yazar,
    // hiçbir satır silmez; `on` 30 g önce anonimleşmiş satırları siler. Staging `on`; prod ilk `dry` raporu kontrol edilince.
    RETENTION_PURGE_MODE: z.enum(["dry", "on"]).default("dry"),
  })
  .refine((e) => e.NODE_ENV !== "production" || e.TRUSTED_PROXY_CIDR, {
    path: ["TRUSTED_PROXY_CIDR"],
    message: "production'da zorunlu (aksi halde tüm istemciler proxy IP'sini paylaşır)",
  })
  .refine((e) => e.NODE_ENV !== "production" || e.SESSION_REF_KEY, {
    path: ["SESSION_REF_KEY"],
    message: "production'da zorunlu (aksi halde süreç başına rastgele anahtar üretilir)",
  })
  .refine((e) => e.NODE_ENV !== "production" || e.APP_ENCRYPTION_KEYS, {
    path: ["APP_ENCRYPTION_KEYS"],
    message: "production'da zorunlu (aksi halde şifreli ayarlar yeniden başlatmada okunamaz)",
  })
  .refine(
    (e) =>
      e.NODE_ENV !== "production" || ![...(parseEncryptionKeys(e.APP_ENCRYPTION_KEYS ?? "")?.values() ?? [])].some(isWeakEncryptionKey),
    {
      path: ["APP_ENCRYPTION_KEYS"],
      message: "production'da zayıf anahtar (tüm baytları aynı) kabul edilmez; openssl rand -base64 32 ile üretin",
    },
  )
  .refine((e) => e.TURN_SECRET || !/(^|,)\s*turns?:/.test(e.TURN_URLS ?? ""), {
    path: ["TURN_SECRET"],
    message: "turn:/turns: URL'si varken zorunlu",
  })
  .transform((e) => {
    const list =
      e.ALLOWED_ORIGINS?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    const allowedOrigins = (list.length > 0 ? list : [e.PUBLIC_BASE_URL]).map((o) => origin.parse(o));
    const turnUrls =
      e.TURN_URLS?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    const encryptionKeys = e.APP_ENCRYPTION_KEYS ? parseEncryptionKeys(e.APP_ENCRYPTION_KEYS) : null;
    return { ...e, WHATSAPP_SERVICE_URL: e.WHATSAPP_SERVICE_URL ?? "", allowedOrigins, turnUrls, encryptionKeys };
  });

export type Env = z.infer<typeof schema>;

/**
 * Boş ("" / yalnız boşluk) değer = tanımsız. Compose `${X:-}` opsiyonel değişkeni boş dize geçirir; aksi halde
 * min()/email() doğrulaması sunucuyu açtırmaz. Zorunlu alanlar (prod'da SESSION_REF_KEY …) boşken yine "eksik" hatası verir.
 */
function withoutBlanks(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v === undefined || v.trim() !== ""));
}

/** Hata mesajı yalnız anahtar adlarını içerir; değerler (DATABASE_URL parolası) yazılmaz. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(withoutBlanks(source));
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Geçersiz ortam değişkenleri — ${keys}`);
  }
  return parsed.data;
}
