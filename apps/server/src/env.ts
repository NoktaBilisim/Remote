// Ortam değişkenleri tek giriş noktası (mimari §8.1). Doğrulanmamış process.env başka yerde okunmaz.
// P1 yalnız kullandığı anahtarları ister; diğerleri (APP_ENCRYPTION_KEYS, TURN_*, METRICS_TOKEN …)
// ilgili pakette eklenir.
import { isIP } from "node:net";
import { z } from "zod";

const cidr = z.string().refine((v) => {
  const [addr, bits, ...rest] = v.split("/");
  if (!addr || bits === undefined || rest.length > 0 || !/^\d{1,3}$/.test(bits)) return false;
  const family = isIP(addr);
  return family !== 0 && Number(bits) <= (family === 4 ? 32 : 128);
}, "CIDR olmalı (ör. 172.30.0.2/32)");

const origin = z.url().transform((v) => new URL(v).origin);

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
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  })
  .refine((e) => e.NODE_ENV !== "production" || e.TRUSTED_PROXY_CIDR, {
    path: ["TRUSTED_PROXY_CIDR"],
    message: "production'da zorunlu (aksi halde tüm istemciler proxy IP'sini paylaşır)",
  })
  .refine((e) => e.NODE_ENV !== "production" || e.SESSION_REF_KEY, {
    path: ["SESSION_REF_KEY"],
    message: "production'da zorunlu (aksi halde süreç başına rastgele anahtar üretilir)",
  })
  .transform((e) => {
    const list = e.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const allowedOrigins = (list.length > 0 ? list : [e.PUBLIC_BASE_URL]).map((o) => origin.parse(o));
    return { ...e, allowedOrigins };
  });

export type Env = z.infer<typeof schema>;

/** Hata mesajı yalnız anahtar adlarını içerir; değerler (DATABASE_URL parolası) yazılmaz. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Geçersiz ortam değişkenleri — ${keys}`);
  }
  return parsed.data;
}
