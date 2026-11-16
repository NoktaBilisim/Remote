// P28b ClamAV sistem ayarı (Super Admin; mimari-p28b §4, §7.2–7.3 r2; AC-353, 359, 361). Kurallar DB CHECK
// `system_settings_clamav_chk` ile birebir (db-notlari "P28b"). Hedef kuralı (K-P28b-16): çözülen TÜM adresler
// `CLAMAV_ALLOWED_CIDR` içinde olmalı — yalnız sunucuda denetlenir (aksi 400 `HOST_NOT_ALLOWED`); şema yalnız biçimi doğrular.
import { z } from "zod";

export const CLAMAV_DEFAULT_PORT = 3310;
/** Test ucu: kullanıcı başına dakikada en çok. */
export const CLAMAV_TEST_PER_MIN = 6;

const HOST_MESSAGE = "Sunucu adı veya IP adresi girin (harf, rakam, nokta, iki nokta üst üste, tire; en çok 253 karakter)";
const PORT_MESSAGE = "Port 1-65535 arası olmalı";

/** DB: `^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$` (ad / IPv4 / köşeli parantezsiz IPv6). Kırpılır, küçük harfe çevrilir. */
export const clamavHostSchema = z
  .string({ error: HOST_MESSAGE })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9.:-]{0,252}$/, HOST_MESSAGE);
const clamavPortSchema = z.number({ error: PORT_MESSAGE }).int(PORT_MESSAGE).min(1, PORT_MESSAGE).max(65535, PORT_MESSAGE);

/** PUT /admin/settings/clamav (Super Admin + step-up). host/port değişince `lastTest = null` (yeniden test gerekir). */
export const clamavSettingsInputSchema = z.strictObject({
  host: clamavHostSchema,
  port: clamavPortSchema.default(CLAMAV_DEFAULT_PORT),
});
export type ClamavSettingsInput = z.input<typeof clamavSettingsInputSchema>;
export type ClamavSettingsData = z.output<typeof clamavSettingsInputSchema>;

/** POST /admin/settings/clamav/test. Boşsa kayıtlı (panel, yoksa env) hedef; verilen host aynı CIDR kuralından geçer. */
export const clamavTestInputSchema = z.strictObject({
  host: clamavHostSchema.optional(),
  port: clamavPortSchema.optional(),
});
export type ClamavTestInput = z.input<typeof clamavTestInputSchema>;

/** `value_json.lastTest` (DB JSON şeması ile aynı): yalnız kayıtlı hedefle yapılan test yazılır; öz-sınama yanlışlığı `ok:false`. */
export interface ClamavLastTest {
  ok: boolean;
  /** ISO an. */
  at: string;
  /** `ClamAV x.y.z/<db>/<tarih>` ham `VERSION` yanıtı (≤ 200). */
  version?: string | null;
  /** İmza veritabanı tarihi (ISO). */
  dbDate?: string | null;
  message?: string | null;
}

/** GET/PUT yanıtı. Panel kaydı yoksa `source:"env"` (`CLAMAV_HOST`/`CLAMAV_PORT`); hiçbiri yoksa `host: null` ("Henüz yapılandırılmadı"). */
export interface ClamavSettingsView {
  host: string | null;
  port: number;
  source: "panel" | "env";
  lastTest: ClamavLastTest | null;
  /** Son yoklamadaki imza yaşı (gün); bilinmiyorsa null. */
  signatureAgeDays?: number | null;
  /** İmza yaşı > `AV_STALE_DAYS` (AC-361 uyarı bandı). */
  stale: boolean;
}

/** Test başarısı = PING `PONG` + EICAR `FOUND` + şifreli zip `Heuristics.Encrypted.*` (AC-353, D-P28b-1). */
export interface ClamavTestResponse {
  ok: boolean;
  eicarDetected: boolean;
  encryptedDetected: boolean;
  version: string | null;
  dbDate: string | null;
  signatureAgeDays: number | null;
  stale: boolean;
  /** Başarısızlıkta sabit sınıf metni (`CLAMAV_TEST_MESSAGES`); ham clamd yanıtı yalnız sunucu logunda. */
  message?: string;
}

export const CLAMAV_TEST_REASONS = ["unconfigured", "unreachable", "timeout", "no_eicar", "encrypted_off", "error"] as const;
export type ClamavTestReason = (typeof CLAMAV_TEST_REASONS)[number];
export const CLAMAV_TEST_MESSAGES: Readonly<Record<ClamavTestReason | "ok", string>> = {
  ok: "Bağlantı başarılı; test imzası ve şifreli arşiv algılandı.",
  unconfigured: "Virüs tarama sunucusu yapılandırılmamış.",
  unreachable: "Virüs tarama servisine ulaşılamadı.",
  timeout: "Virüs tarama servisi zamanında yanıt vermedi.",
  no_eicar: "Test imzası (EICAR) algılanmadı; imza veritabanını denetleyin.",
  encrypted_off: "Şifreli arşiv algılaması kapalı",
  error: "Virüs tarama servisi beklenmeyen bir yanıt verdi.",
};
/** 400 `HOST_NOT_ALLOWED` `fields.host` metni (hedef `av` alt ağı dışında). */
export const CLAMAV_HOST_NOT_ALLOWED_MESSAGE = "Adres virüs tarama ağının dışında";
/** AC-361 uyarı bandı. */
export const CLAMAV_STALE_WARNING = "Virüs imzaları 3 günden eski; güncelleme servisini denetleyin";

// --- clamd yanıt sınıflandırması (K0'da 1.5.4 ile doğrulandı; §7.2 — `MaxScanTime` genel sınırdan ÖNCE eşlenir) ---
export const AV_EICAR_SIGNATURE = "Eicar-Test-Signature";
export const AV_ENCRYPTED_PREFIX = "Heuristics.Encrypted.";
export const AV_LIMITS_PREFIX = "Heuristics.Limits.Exceeded";
export const AV_MAX_SCAN_TIME_SIGNATURE = "Heuristics.Limits.Exceeded.MaxScanTime";

// --- Öz-sınama girdileri (§7.3, D-P28b-1) ---
/**
 * EICAR test dizesi iki parça: tam dize hiçbir dosyada düz durmaz (host AV'si kaynağı/imajı karantinaya almasın); yalnız
 * bellekte `avEicar()` ile birleşir. Zararsız standart test dizesidir (68 bayt ASCII).
 */
const EICAR_HEAD = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$";
const EICAR_TAIL = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
export const avEicar = (): string => EICAR_HEAD + EICAR_TAIL;

/**
 * Parolalı (ZipCrypto, `zip -0 -P`) küçük zip, base64. İçerik zararsız: `selftest.txt` = "remote-support av selftest\n".
 * clamd `AlertEncryptedArchive yes` ile `Heuristics.Encrypted.Zip FOUND` döner (K0); `stream: OK` = yanlış yapılandırma.
 */
export const AV_SELFTEST_ENCRYPTED_ZIP_B64 =
  "UEsDBAoACQAAAAAAcF3y7bx1JwAAABsAAAAMAAAAc2VsZnRlc3QudHh0u+AYOdvwB8cbSNXOFhLe8D+7WUKIbXbBqw5xA1ZW2UtQq1cJk7oqUEsHCPLtvHUnAAAAGwAAAFBLAQIeAwoACQAAAAAAcF3y7bx1JwAAABsAAAAMAAAAAAAAAAAAAACkgQAAAABzZWxmdGVzdC50eHRQSwUGAAAAAAEAAQA6AAAAYQAAAAAA";
