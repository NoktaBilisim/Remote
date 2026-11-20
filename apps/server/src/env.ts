// Ortam değişkenleri tek giriş noktası (mimari §8.1). Doğrulanmamış process.env başka yerde okunmaz.
// Her paket yalnız kullandığı anahtarları ister; diğerleri (APP_ENCRYPTION_KEYS …)
// ilgili pakette eklenir.
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { serviceUrlSchema } from "@remote/contracts/api/notify";
import { UNATTENDED_MODES } from "@remote/contracts/api/unattended";
import { waApiKeySchema, waServiceUrlSchema } from "@remote/contracts/api/system-settings";
import { z } from "zod";

const cidr = z.string().refine((v) => {
  const [addr, bits, ...rest] = v.split("/");
  if (!addr || bits === undefined || rest.length > 0 || !/^\d{1,3}$/.test(bits)) return false;
  const family = isIP(addr);
  return family !== 0 && Number(bits) <= (family === 4 ? 32 : 128);
}, "CIDR olmalı (ör. 172.30.0.2/32)");

const origin = z.url().transform((v) => new URL(v).origin);

/** IPv4 noktalı yazımı → 32 bit (geçersizse null). */
function ipv4ToInt(addr: string): number | null {
  if (isIP(addr) !== 4) return null;
  return addr.split(".").reduce((n, o) => n * 256 + Number(o), 0);
}

/** IPv4 CIDR → [ilk, son] (geçersizse null). */
function ipv4Range(v: string): [number, number] | null {
  const [addr, bits] = v.split("/");
  const base = addr ? ipv4ToInt(addr) : null;
  if (base === null || bits === undefined || !/^\d{1,2}$/.test(bits) || Number(bits) > 32) return null;
  const size = 2 ** (32 - Number(bits));
  const first = base - (base % size);
  return [first, first + size - 1];
}

const RFC1918: [number, number][] = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].map((c) => ipv4Range(c) as [number, number]);

/**
 * P28b D-r2-5 (O-P28b-1): ClamAV hedefinin izinli alt ağı. Geniş/yanlış değer panel hedefini yeniden "herhangi bir özel adres"
 * yapardı → IPv4, RFC 1918 içinde, önek /24../30, ağ adresiyle yazılmış olmalı (compose `av` ağı `AV_SUBNET` ile aynı).
 */
const avCidr = z.string().refine((v) => {
  const [addr, bits, ...rest] = v.split("/");
  if (!addr || bits === undefined || rest.length > 0 || !/^\d{1,2}$/.test(bits)) return false;
  const prefix = Number(bits);
  const r = ipv4Range(v);
  if (!r || prefix < 24 || prefix > 30 || ipv4ToInt(addr) !== r[0]) return false;
  return RFC1918.some(([a, b]) => r[0] >= a && r[1] <= b);
}, "IPv4 RFC 1918 alt ağı olmalı, önek /24../30, ağ adresiyle (ör. 172.30.2.0/28)");

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

/** İki IPv4 CIDR örtüşüyor mu (IPv6 TRUSTED_PROXY_CIDR IPv4 alt ağla örtüşmez). */
function cidrOverlap(a: string, b: string): boolean {
  const x = ipv4Range(a);
  const y = ipv4Range(b);
  return x !== null && y !== null && x[0] <= y[1] && y[0] <= x[1];
}

/** a ile b aynı dizin ya da biri ötekinin altında mı (sondaki / yok sayılır). */
function nestedPath(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/\/+$/, "") + "/";
  return n(a).startsWith(n(b)) || n(b).startsWith(n(a));
}

/**
 * Caddy `agent_exe_file` / `agent_zip_file` / `agent_bin_file` (P28g) snippet'lerinin sunduğu dosyaların server konteynerindeki
 * yolu (deploy/Caddyfile).
 */
export const AGENT_BINARY_PATH_FIXED = "/data/downloads/NoktaDestek.exe";
export const MAC_AGENT_PATH_FIXED = "/data/downloads/NoktaDestek-macOS.zip";
export const LINUX_AGENT_PATH_FIXED = "/data/downloads/NoktaDestek-linux";
/** P29 (mimari-p29 §9.1): imzalı güncelleme manifestlerinin klasörü (agent_downloads volume'u, deploy/agent/publish-manifest.sh yazar). */
export const UPDATE_MANIFEST_DIR_FIXED = "/data/downloads/update";

/**
 * P29 (mimari-p29 §9.1, K-P29-1/5): `UPDATE_MANIFEST_PUBKEYS` = virgüllü, en çok 2 adet Ed25519 açık anahtarı (base64url, dolgusuz,
 * 43 karakter = 32 bayt; `build/update-keys/<env>.pub` ile aynı). Gizli değildir. Geçersizse null.
 */
export function parseUpdatePubkeys(raw: string): Buffer[] | null {
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 1 || parts.length > 2 || new Set(parts).size !== parts.length) return null;
  const keys: Buffer[] = [];
  for (const p of parts) {
    if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(p)) return null;
    const key = Buffer.from(p, "base64url");
    if (key.length !== 32) return null;
    keys.push(key);
  }
  return keys;
}

/** S14-7: herkesçe bilinen/zayıf anahtar — tüm baytları aynı (CI'daki 32 sıfır bayt dahil). Production'da reddedilir. */
const isWeakEncryptionKey = (key: Buffer): boolean => key.every((b) => b === key[0]);

/** P32 (mimari-p32 §4.1, S-P32-6): izinli servis SHA-256 listesinin üst sınırı (her modda). */
export const UNATTENDED_SIGNED_SHA256_MAX = 20;

/**
 * P32 (S-P32-r2-2) izinli SHA listesinin TEK normalizasyonu: `,` ile böl → her öğe kırpılır → küçük harf → boş öğe atılır.
 * Sıra korunur, tekrar ATILMAZ. Sınır, üyelik, `unattendedSignedSha256` kümesi ve `listFingerprint` bunu kullanır.
 */
export function normalizeShaList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * P32 (AC-527a, S-P32-r2-2) liste parmak izi — remote-watch (`deploy/ops/remote-watch.sh`) aynı tanımı uygular:
 * `normalizeShaList` → bayt sırasıyla sırala (öğeler yalnız [0-9a-f]; kabukta `LC_ALL=C sort`) → `,` ile birleştir (sonda satır
 * sonu yok) → UTF-8 SHA-256 → ilk 12 küçük hex hane. Boş liste → boş dizenin SHA-256'sı (`e3b0c44298fc`).
 */
export function listFingerprint(raw: string | undefined): string {
  const joined = normalizeShaList(raw).sort().join(",");
  return createHash("sha256").update(joined, "utf8").digest("hex").slice(0, 12);
}

/**
 * P27 (§4.5 r2, K-P27-22; AC-342) + P32 (mimari-p32 §4.1; AC-523, 524, 533): DEPLOY_ENV zorunluluğu; `unsigned` ⇔ staging;
 * `unsigned-accepted` ⇔ production|staging; `signed`/`unsigned-accepted` → liste zorunlu; `unsigned-accepted` → ajan SHA'sı ve
 * sürümü zorunlu, SHA listede. Mesajlar yalnız anahtar adı + kural (değer yok).
 */
function deployEnvRules(
  e: {
    NODE_ENV: string;
    DEPLOY_ENV?: string | undefined;
    UNATTENDED_MODE: string;
    UNATTENDED_SIGNED_SHA256?: string | undefined;
    UNATTENDED_AGENT_SHA256?: string | undefined;
    UNATTENDED_AGENT_VERSION?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  const mode = e.UNATTENDED_MODE;
  const list = normalizeShaList(e.UNATTENDED_SIGNED_SHA256);
  if (!e.DEPLOY_ENV && e.NODE_ENV === "production") issue("DEPLOY_ENV", "DEPLOY_ENV gerekli (production)");
  if (!e.DEPLOY_ENV && mode !== "off") issue("DEPLOY_ENV", "DEPLOY_ENV gerekli (UNATTENDED_MODE off değil)");
  if (mode === "unsigned" && e.DEPLOY_ENV !== "staging") issue("UNATTENDED_MODE", "unsigned yalnız DEPLOY_ENV=staging iken kabul edilir");
  if (mode === "unsigned-accepted" && e.DEPLOY_ENV !== "production" && e.DEPLOY_ENV !== "staging")
    issue("UNATTENDED_MODE", "unsigned-accepted yalnız DEPLOY_ENV=production|staging iken kabul edilir");
  if ((mode === "signed" || mode === "unsigned-accepted") && list.length === 0)
    issue("UNATTENDED_SIGNED_SHA256", "signed/unsigned-accepted modda zorunlu");
  if (list.length > UNATTENDED_SIGNED_SHA256_MAX)
    issue("UNATTENDED_SIGNED_SHA256", `en çok ${UNATTENDED_SIGNED_SHA256_MAX} öğe (eski sürümleri runbook §27.9 ile çıkarın)`);
  if (mode !== "unsigned-accepted") return;
  if (!e.UNATTENDED_AGENT_SHA256 || !e.UNATTENDED_AGENT_VERSION)
    issue(
      "UNATTENDED_AGENT_SHA256",
      "unsigned-accepted modda UNATTENDED_AGENT_SHA256 ve UNATTENDED_AGENT_VERSION zorunlu (publish-servis.sh --tag)",
    );
  else if (!list.includes(e.UNATTENDED_AGENT_SHA256))
    issue("UNATTENDED_AGENT_SHA256", "izinli listede değil — panelden indirilen servis listede değil (publish-servis.sh ile yayınlayın)");
}

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
    // P28f (mimari-p28f §8.1, S-P28f-3): macOS istemcisi zip'i (AGENT_* kalıbı). İkisi dolu ve dosya hash'i eşleşmedikçe
    // macOS indirmesi 503 ve availability `macos:false`. Production'da yol sabit (MAC_AGENT_PATH_FIXED; aşağıdaki refine).
    MAC_AGENT_PATH: z.string().startsWith("/", "mutlak yol olmalı").optional(),
    MAC_AGENT_SHA256: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "64 haneli onaltılık SHA-256 olmalı")
      .transform((v) => v.toLowerCase())
      .optional(),
    // P28f-r4 (K-P28f-r4-2): yayındaki macOS zip'inin imza türü; publish-mac.sh --apply yazar. Boş = yok → availability
    // `adhoc` sayar (S-r4-8: bilinmeyen değer asla notarized değil; geçersiz değer açılış hatası).
    MAC_AGENT_SIGNING: z.enum(["adhoc", "notarized"]).optional(),
    // P28g (mimari-p28g §8.1, S-P28g-12): Linux istemcisi tek ELF (MAC_AGENT_* kalıbı). İkisi dolu ve dosya hash'i eşleşmedikçe
    // Linux indirmesi 503 ve availability `linux:false`. Production'da yol sabit (LINUX_AGENT_PATH_FIXED; aşağıdaki refine).
    LINUX_AGENT_PATH: z.string().startsWith("/", "mutlak yol olmalı").optional(),
    LINUX_AGENT_SHA256: z
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
    // K13 geçici çözümü (kullanıcı kararı 2026-11-15): `true` → WhatsApp hedefi için düz http (genel adres, anahtar dahil)
    // güvensiz sayılmaz, kanal açılır; açılışta `whatsapp_insecure_http_allowed` alarmı, Super Admin ekranında uyarı. Yalnız
    // WhatsApp (SMS kuralı değişmez). Yalnız `true`/`false`; varsayılan `false`. Servis HTTPS'e geçince kaldırılır.
    WHATSAPP_ALLOW_INSECURE_HTTP: z
      .enum(["true", "false"], "true veya false olmalı")
      .default("false")
      .transform((v) => v === "true"),
    // P19 J3 (§8c.4, S-P19-T5): firmaların sistem varsayılanı smsportal adresi (boş = varsayılan yok). userinfo/sorgu/parça
    // reddedilir; değer hata mesajına yazılmaz. Değişimi kayıtlı anahtarları çözülemez kılar (runbook §26.3).
    SMSPORTAL_URL: z.preprocess((v) => (v === "" ? undefined : v), serviceUrlSchema.optional()),
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
    // P28b (mimari-p28b §11.3, ADR-0032): saklanan dosya kökü `{tenantId}/{rastgele}.rsf`; volume `stored_files` (yedeğe girmez).
    FILES_DIR: z.string().startsWith("/", "mutlak yol olmalı").default("/data/files"),
    // ClamAV (clamd) env hedefi: Super Admin panel kaydı yoksa kullanılır (compose: clamav / 3310). Boş = ayar yok (fail-closed).
    CLAMAV_HOST: z
      .string()
      .max(253)
      .regex(/^[A-Za-z0-9.-]+$/, "konak adı ya da IPv4 olmalı")
      .optional(),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    // O-P28b-1 / D-r2-5: ClamAV hedefinin izinli alt ağı (compose: AV_SUBNET). Boş = sunucu modu çalışmaz (HOST_NOT_ALLOWED).
    CLAMAV_ALLOWED_CIDR: avCidr.optional(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    // P16 (AC-240, ADR-0030 m.6, mimari-e11 §7.7): gece kalıcı silme modu. `dry` (varsayılan) aday sayılarını audit'e yazar,
    // hiçbir satır silmez; `on` 30 g önce anonimleşmiş satırları siler. Staging `on`; prod ilk `dry` raporu kontrol edilince.
    RETENTION_PURGE_MODE: z.enum(["dry", "on"]).default("dry"),
    // P27 (mimari-p27 §4.5, §8.1, K-P27-3/22; AC-297, 342): dağıtım ortamı ve gözetimsiz erişim imza kapısı. DEPLOY_ENV
    // varsayılansız: production'da ya da UNATTENDED_MODE ≠ off iken zorunlu; `unsigned` yalnız staging.
    DEPLOY_ENV: z.enum(["production", "staging", "development"]).optional(),
    // P32 (ADR-0042): `unsigned-accepted` = prod'da imzasız servis, risk kabul (yalnız production|staging; deployEnvRules).
    UNATTENDED_MODE: z.enum(UNATTENDED_MODES).default("off"),
    // `signed` / `unsigned-accepted` modda zorunlu: virgüllü 64-hex izinli servis ikilisi SHA-256 listesi (adı tarihsel).
    // publish-servis.sh yalnız `vX.Y.Z` (attestation'lı Release) SHA'sını ekler; elle yalnız çıkarılır. Her modda ≤ 20 öğe.
    UNATTENDED_SIGNED_SHA256: z
      .string()
      .regex(/^[0-9a-fA-F]{64}(\s*,\s*[0-9a-fA-F]{64})*$/, "virgüllü 64 haneli onaltılık SHA-256 listesi olmalı")
      .optional(),
    // Servis ikilisi indirme ucu (AGENT_* kalıbı): ikisi dolu ve dosya hash'i eşleşmedikçe 503.
    UNATTENDED_AGENT_PATH: z.string().startsWith("/", "mutlak yol olmalı").optional(),
    UNATTENDED_AGENT_SHA256: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "64 haneli onaltılık SHA-256 olmalı")
      .transform((v) => v.toLowerCase())
      .optional(),
    // P32 (mimari-p32 §4.1, AC-533): yayınlanan servis sürümü (publish-servis.sh `--tag vX.Y.Z` yazar; `dir-*` boşaltır).
    // Müşteri mesajının doğrulama bloğunda gösterilir; `unsigned-accepted` modda zorunlu, diğer modlarda boşsa sürüm yazılmaz.
    UNATTENDED_AGENT_VERSION: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, "X.Y.Z biçiminde olmalı")
      .optional(),
    // P29 (mimari-p29 §9.1, K-P29-5): imzalı güncelleme manifestleri. Boş = güncelleme uçları her zaman 204 / update.none.
    // Production'da yol sabit (UPDATE_MANIFEST_DIR_FIXED). Dolu iken UPDATE_MANIFEST_PUBKEYS zorunlu (aşağıdaki refine).
    UPDATE_MANIFEST_DIR: z.string().startsWith("/", "mutlak yol olmalı").optional(),
    // Virgüllü ≤ 2 Ed25519 açık anahtarı (base64url 43 karakter; gizli değil). Ortamın build/update-keys/<env>.pub dosyasıyla aynı.
    UPDATE_MANIFEST_PUBKEYS: z
      .string()
      .refine((v) => parseUpdatePubkeys(v) !== null, "virgüllü en çok 2 adet base64url (43 karakter) Ed25519 açık anahtarı olmalı")
      .optional(),
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
  // S-P28f-3: sunucunun hash'lediği dosya = Caddy'nin sunduğu dosya (aynı `agent_downloads` volume'u; server /data/downloads,
  // Caddy /srv/downloads). Production'da başka yol reddedilir; geliştirme/test geçici dizin kullanabilir.
  .refine((e) => e.NODE_ENV !== "production" || !e.AGENT_BINARY_PATH || e.AGENT_BINARY_PATH === AGENT_BINARY_PATH_FIXED, {
    path: ["AGENT_BINARY_PATH"],
    message: `production'da yalnız ${AGENT_BINARY_PATH_FIXED} (Caddy'nin sunduğu dosya)`,
  })
  .refine((e) => e.NODE_ENV !== "production" || !e.MAC_AGENT_PATH || e.MAC_AGENT_PATH === MAC_AGENT_PATH_FIXED, {
    path: ["MAC_AGENT_PATH"],
    message: `production'da yalnız ${MAC_AGENT_PATH_FIXED} (Caddy'nin sunduğu dosya)`,
  })
  .refine((e) => e.NODE_ENV !== "production" || !e.LINUX_AGENT_PATH || e.LINUX_AGENT_PATH === LINUX_AGENT_PATH_FIXED, {
    path: ["LINUX_AGENT_PATH"],
    message: `production'da yalnız ${LINUX_AGENT_PATH_FIXED} (Caddy'nin sunduğu dosya)`,
  })
  .refine((e) => e.NODE_ENV !== "production" || !e.UPDATE_MANIFEST_DIR || e.UPDATE_MANIFEST_DIR === UPDATE_MANIFEST_DIR_FIXED, {
    path: ["UPDATE_MANIFEST_DIR"],
    message: `production'da yalnız ${UPDATE_MANIFEST_DIR_FIXED} (agent_downloads volume'u)`,
  })
  .refine((e) => !e.UPDATE_MANIFEST_DIR || e.UPDATE_MANIFEST_PUBKEYS, {
    path: ["UPDATE_MANIFEST_PUBKEYS"],
    message: "UPDATE_MANIFEST_DIR doluyken zorunlu (manifest imzası doğrulanmadan sunulmaz)",
  })
  .refine((e) => !e.CLAMAV_ALLOWED_CIDR || !e.TRUSTED_PROXY_CIDR || !cidrOverlap(e.CLAMAV_ALLOWED_CIDR, e.TRUSTED_PROXY_CIDR), {
    path: ["CLAMAV_ALLOWED_CIDR"],
    message: "TRUSTED_PROXY_CIDR ile çakışmamalı (D-r2-5)",
  })
  .refine((e) => !nestedPath(e.FILES_DIR, e.UPLOADS_DIR), {
    path: ["FILES_DIR"],
    message: "UPLOADS_DIR ile aynı ya da iç içe olamaz (yetim taraması karışır)",
  })
  .superRefine(deployEnvRules)
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
    return {
      ...e,
      WHATSAPP_SERVICE_URL: e.WHATSAPP_SERVICE_URL ?? "",
      SMSPORTAL_URL: e.SMSPORTAL_URL ?? "",
      allowedOrigins,
      turnUrls,
      encryptionKeys,
      updateManifestPubkeys: e.UPDATE_MANIFEST_PUBKEYS ? (parseUpdatePubkeys(e.UPDATE_MANIFEST_PUBKEYS) ?? []) : [],
      unattendedSignedSha256: new Set(normalizeShaList(e.UNATTENDED_SIGNED_SHA256)),
    };
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

/** K-P28f-r4-2: production + macOS zip yayında (MAC_AGENT_SHA256 dolu) + MAC_AGENT_SIGNING boş → açılışta uyarı (hata değil). */
export function macSigningUnsetInProduction(env: Pick<Env, "NODE_ENV" | "MAC_AGENT_SHA256" | "MAC_AGENT_SIGNING">): boolean {
  return env.NODE_ENV === "production" && !!env.MAC_AGENT_SHA256 && !env.MAC_AGENT_SIGNING;
}
