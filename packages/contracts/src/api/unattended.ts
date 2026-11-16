// P27 gözetimsiz erişim REST sözleşmesi (`/api/v1/unattended/*`; mimari-p27 §4.2–4.5, §6, §7.2; AC-273, 275, 293, 296, 297,
// 336, 337, 339). Tek kaynak: sunucu girdiyi bu şemalarla doğrular, web `lib/unattended/contract.ts` cephesinden alır.
// Kayıt kodu düz hâliyle yalnız üretim yanıtında bir kez döner; listede, audit'te, logda yoktur.
import { z } from "zod";
import { UNATTENDED_AUDIT, UNATTENDED_POLICY_AUDIT } from "../audit.ts";
import type { ErrorCode } from "../errors.ts";
import type { ConsentMode, DeviceUserState } from "../unattended-consent.ts";
import { B64URL_32_PATTERN, DEVICE_SHA256_PATTERN, DEVICE_VERSION_PATTERN, deviceTextSchema } from "../ws-device.ts";
import { UNSAFE_NAME_CHARS } from "./shared.ts";
import { optionalPhoneSchema } from "./customers.ts";
import { notifyEmailKey } from "./requests.ts";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ulid = z.string().regex(ULID, "Geçersiz kimlik");
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

// ------------------------------------------------------------------------------------------- mod / imza kapısı (AC-297)

/** Env `UNATTENDED_MODE` (§4.5): `off` her şey 409; `unsigned` yalnız `DEPLOY_ENV=staging`; `signed` imza + SHA-256 listesi. */
export const UNATTENDED_MODES = ["off", "unsigned", "signed"] as const;
export type UnattendedMode = (typeof UNATTENDED_MODES)[number];

/** GET /unattended/status (`connect` ∨ `manage`). `available=false` → panel bandı, Bağlan ve Kayıt kodu düğmeleri pasif. */
export interface UnattendedStatus {
  mode: UnattendedMode;
  available: boolean;
  /**
   * Firmanın kendi SMTP kaydı var mı (kayıt kodu / bağlantı ön koşulu, `NOTIFY_CHANNEL_UNAVAILABLE` ile aynı denetim).
   * false → "Kayıt kodu oluştur" baştan pasif + `UNATTENDED_ERROR_MESSAGES.NOTIFY_CHANNEL_UNAVAILABLE`. Firma seçilmemişse false.
   */
  notifyChannel: boolean;
  /**
   * P28u (§5.2, AC-430): firma politikası açık ∧ çağıranda `unattended.silent` — `ConnectDialog` "İzin istemeden bağlan" kutusunu
   * yalnız true iken çizer (sunucu zincirde yine zorlar). K3 doldurur — o zamana kadar gelmeyebilir (yoksa false).
   */
  silentAllowed?: boolean;
}

// ------------------------------------------------------------------------------------------- hata metinleri

/** P27 hata kodlarının Türkçe metni (sunucu zarf `message`'ı ve web aynı metni kullanır). */
export const UNATTENDED_ERROR_MESSAGES = {
  UNATTENDED_DISABLED: "Gözetimsiz erişim kod imzası olmadan kullanılamaz",
  DEVICE_OFFLINE: "Cihaz çevrimdışı",
  DEVICE_BUSY: "Cihazda başka bir gözetimsiz bağlantı var",
  DEVICE_LOCAL_DISABLED: "Yerel olarak kapalı",
  NOTIFY_CONTACT_REQUIRED: "Müşterinin bildirim adresi yok — adres yokken bu müşterinin cihazlarına bağlanılamaz",
  NOTIFY_CHANNEL_UNAVAILABLE: "Bildirim e-postası yapılandırılmamış — Ayarlar → SMTP",
  REGISTRATION_CODE_INVALID: "Kayıt kodu geçersiz, kullanılmış ya da süresi dolmuş",
  // P28u (mimari-p28u §5).
  DEVICE_OUTDATED: "Cihazdaki servis güncel değil — güncelleyin",
  SILENT_DISABLED: "Firma politikası izin istemeden bağlanmaya izin vermiyor",
  INTERVENE_PENDING: "Önceki komut henüz tamamlanmadı",
  INTERVENE_FAILED: "Cihaz komutu uygulayamadı",
} as const satisfies Partial<Record<ErrorCode, string>>;

/** Panel bantları (§4.5, §6): mod `off` ve `unsigned` (O-P27-6). */
export const UNATTENDED_OFF_BANNER = UNATTENDED_ERROR_MESSAGES.UNATTENDED_DISABLED;
export const UNATTENDED_TEST_BANNER = "TEST ortamı — imzasız servis. Gerçek müşteri cihazı kaydetmeyin.";

// ------------------------------------------------------------------------------------------- kayıt kodu (AC-273, §3.3)

/** 16 karakter Crockford base32 (80 bit); gösterim `XXXX-XXXX-XXXX-XXXX`. */
export const REGISTRATION_CODE_LENGTH = 16;
export const REGISTRATION_CODE_TTL_HOURS = 24;
export const REGISTRATION_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const REGISTRATION_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{16}$/;

/** Girdi normalizasyonu (§4.2): tire ve her tür boşluk atılır, büyük harfe çevrilir. Biçim denetimi `registrationCodeSchema`'da. */
export function normalizeRegistrationCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/** `ABCD1234EFGH5678` → `ABCD-1234-EFGH-5678` (gösterim; kopyalanan metin de bu biçimdir). */
export function formatRegistrationCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join("-");
}

export const REGISTRATION_CODE_MESSAGE = "Kayıt kodu 16 karakter olmalı (ör. ABCD-1234-EFGH-5678)";
export const registrationCodeSchema = z
  .string()
  .max(64, REGISTRATION_CODE_MESSAGE)
  .transform(normalizeRegistrationCode)
  .pipe(z.string().regex(REGISTRATION_CODE_RE, REGISTRATION_CODE_MESSAGE));

/** POST /unattended/registration-codes (`manage` + step-up, tüketmez). */
export const createRegistrationCodeInputSchema = z.strictObject({ customerId: ulid });
export type CreateRegistrationCodeInput = z.infer<typeof createRegistrationCodeInputSchema>;

/** Üretim yanıtı — `code` (gösterim biçiminde) yalnız burada, bir kez. `downloadUrl` = `/api/v1/unattended/download`. */
export interface CreatedRegistrationCode {
  id: string;
  code: string;
  expiresAt: string;
  downloadUrl: string;
}

/** GET /unattended/registration-codes öğesi — bekleyen (kullanılmamış, süresi dolmamış) kodlar; kodun kendisi YOK. */
export interface RegistrationCodeItem {
  id: string;
  customerId: string;
  customerName: string;
  /** Kodu üreten kullanıcı; kullanıcı silinmişse null. */
  createdBy: { id: string; name: string } | null;
  expiresAt: string;
}
export interface RegistrationCodeListResponse {
  items: RegistrationCodeItem[];
}

// ------------------------------------------------------------------------------------------- cihaz kaydı (servis → sunucu)

/**
 * POST /unattended/register (cihaz; çerezsiz, Origin'siz, kayıt kodu kimliği). `publicKey` Ed25519 açık anahtarı (b64url 32
 * bayt). `signed`/`sha256` kapı beyanıdır (AC-297) — kimlik doğrulama değil.
 */
export const registerDeviceInputSchema = z.strictObject({
  code: registrationCodeSchema,
  publicKey: z.string().regex(B64URL_32_PATTERN, "Geçersiz açık anahtar"),
  name: deviceTextSchema,
  osVersion: deviceTextSchema,
  version: z.string().regex(DEVICE_VERSION_PATTERN, "Geçersiz sürüm"),
  sha256: z.string().regex(DEVICE_SHA256_PATTERN, "Geçersiz özet"),
  signed: z.boolean(),
});
export type RegisterDeviceInput = z.input<typeof registerDeviceInputSchema>;
export type RegisterDeviceData = z.output<typeof registerDeviceInputSchema>;
export interface RegisterDeviceResponse {
  deviceId: string;
  tenantName: string;
  customerName: string;
}

// ------------------------------------------------------------------------------------------- cihaz listesi / ayrıntı (AC-275)

/** `unattended_devices.revoke_reason` (ikili CHECK). */
export const UNATTENDED_REVOKE_REASONS = ["ADMIN", "UNINSTALLED", "CUSTOMER_PASSIVE"] as const;
export type UnattendedRevokeReason = (typeof UNATTENDED_REVOKE_REASONS)[number];

export const DEVICE_LIST_STATES = ["online", "offline", "all"] as const;
export type DeviceListState = (typeof DEVICE_LIST_STATES)[number];
export const DEVICE_PAGE_SIZE = 50;
export const DEVICE_PAGE_SIZE_MAX = 100;
/** Panel çevrimiçi durumunu bu aralıkla REST yoklamasıyla tazeler (ADR-0029 kalıbı; panel için WS yok). */
export const DEVICE_POLL_MS = 15_000;

/**
 * GET /unattended/devices (`connect` ∨ `manage`). `manage` yoksa yalnız grant'lı cihazlar. Keyset sayfalı (opak `cursor`,
 * biçim dışı → 400 `fields.cursor`). Bilinmeyen parametre 400 (strict).
 */
export const listDevicesQuerySchema = z.strictObject({
  q: z.preprocess(blankToUndefined, z.string().trim().max(64, "Arama en çok 64 karakter olabilir").optional()),
  customerId: z.preprocess(blankToUndefined, ulid.optional()),
  state: z.preprocess(blankToUndefined, z.enum(DEVICE_LIST_STATES).default("all")),
  cursor: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{4,64}$/, "Geçersiz sayfa imleci")
      .optional(),
  ),
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(DEVICE_PAGE_SIZE_MAX).default(DEVICE_PAGE_SIZE)),
});
export type ListDevicesQuery = z.output<typeof listDevicesQuerySchema>;

/**
 * `canConnect=false` iken düğme ipucunu seçer (§4.2, AC-336). Öncelik sırası sunucuda: `no_grant` (çağıranın cihaz yetkisi
 * ya da `unattended.connect`'i yok) → `unsigned` (imza kapısı) → `offline` → `outdated` (P28u: soket `consent1` bildirmedi,
 * AC-435) → `local_disabled` → `no_contacts` → `smtp`.
 * `smtp` ayrıca "Kayıt kodu oluştur" düğmesini de pasif yapar.
 */
export const CONNECT_BLOCKED_REASONS = ["no_grant", "unsigned", "offline", "outdated", "local_disabled", "no_contacts", "smtp"] as const;
export type ConnectBlockedReason = (typeof CONNECT_BLOCKED_REASONS)[number];
export const CONNECT_BLOCKED_REASON_LABELS: Readonly<Record<ConnectBlockedReason, string>> = {
  no_grant: "Bu cihaza bağlanma yetkiniz yok",
  unsigned: UNATTENDED_ERROR_MESSAGES.UNATTENDED_DISABLED,
  offline: "Cihaz çevrimdışı",
  outdated: UNATTENDED_ERROR_MESSAGES.DEVICE_OUTDATED,
  local_disabled: "Yerel olarak kapalı",
  no_contacts: "Adres yokken bu müşterinin cihazlarına bağlanılamaz",
  smtp: UNATTENDED_ERROR_MESSAGES.NOTIFY_CHANNEL_UNAVAILABLE,
};

export interface DeviceListItem {
  id: string;
  name: string;
  customerId: string;
  customerName: string;
  online: boolean;
  /** Son yerel anahtar beyanı (AC-295); false → "Yerel olarak kapalı". */
  localEnabled: boolean;
  /** İmza kapısı bu cihazı geçiriyor mu (mod + beyan + SHA listesi); false → "İmzasız" rozeti. */
  signatureOk: boolean;
  lastSeenAt: string | null;
  lastSessionAt: string | null;
  grantCount: number;
  /** grant ∧ `connect` ∧ online ∧ localEnabled ∧ signatureOk ∧ adres var ∧ tenant SMTP kaydı var (sunucu hesaplar). */
  canConnect: boolean;
  connectBlockedReason: ConnectBlockedReason | null;
  /** r2 (O-P27-5): ilk grant verildi (`verified_at` dolu); false → "Yeni — doğrulanmadı". */
  verified: boolean;
  /** r2 (Y-P27-1): son `UNATTENDED_STARTED` bildirimi FAILED → "Son bildirim gönderilemedi". */
  notifyFailed: boolean;
  /** r2 (D-P27-3): 10 dk'da > 3 kez 4409 → "Anahtar başka yerden kullanılıyor olabilir". */
  replacedAlert: boolean;
  /**
   * P28u (§5.4, AC-429): cihazdaki kullanıcı durumu (hub belleği); çevrimdışı / eski servis → null. Yalnız çağıranın grant'ı
   * olan cihazda dolu; hiçbir dışa aktarım/audit'te yok (D-P28u-6). K4 doldurur — o zamana kadar gelmeyebilir.
   */
  userState?: DeviceUserState | null;
}
export interface DeviceListResponse {
  items: DeviceListItem[];
  /** Son sayfada null. */
  nextCursor: string | null;
}

/** Cihaz–teknisyen yetkisi (grant) satırı. */
export interface DeviceGrant {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * GET /unattended/devices/:id (`connect` + grant ∨ `manage`; yoksa 404). `manage` alanları (`lastIp`, `registeredIp`,
 * `registeredAt`, `grants`) yalnız `manage` sahibine dolu döner, diğerine null.
 */
export interface DeviceDetail extends DeviceListItem {
  osVersion: string;
  agentVersion: string;
  signed: boolean;
  lastIp: string | null;
  registeredIp: string | null;
  registeredAt: string | null;
  grants: DeviceGrant[] | null;
}

/** PUT /unattended/devices/:id/grants (`manage`; ekleme varsa step-up, tüketmez) — tam küme; boş dizi = tümünü kapat. */
export const DEVICE_GRANTS_MAX = 200;
export const putDeviceGrantsInputSchema = z.strictObject({
  userIds: z
    .array(ulid)
    .max(DEVICE_GRANTS_MAX, `En çok ${DEVICE_GRANTS_MAX} teknisyen`)
    .refine((a) => new Set(a).size === a.length, { message: "Kullanıcılar benzersiz olmalı" }),
});
export type PutDeviceGrantsInput = z.infer<typeof putDeviceGrantsInputSchema>;
export interface DeviceGrantsResponse {
  grants: DeviceGrant[];
}

/** POST /unattended/devices/:id/connect (`connect` + grant + step-up TÜKETİLİR) → konsol `/sessions/:id/console`. */
export interface UnattendedConnectResponse {
  sessionId: string;
}

// ------------------------------------------------------------------------------------------- P28u izinli / izinsiz bağlantı

/** Gerekçe sınırları (kod noktası, kırpılmış) — DB `support_sessions_silent_reason_chk` ile aynı (K1). */
export const SILENT_REASON_MIN = 20;
export const SILENT_REASON_MAX = 500;
export const SILENT_REASON_MESSAGE = `Gerekçe ${SILENT_REASON_MIN}–${SILENT_REASON_MAX} karakter olmalı`;

/**
 * İzinsiz bağlantı gerekçesi (§5.1, AC-437): kırpılır; 20..500 kod noktası; satır sonu yalnız `\n` (DB `\r`'yi reddeder — K1
 * devir notu 2); kontrol (Cc), biçim (Cf, yön/görünmez), Zl/Zp, U+034F, U+180E yok. DB CHECK'inden katı (alt küme) — zod'u
 * geçen her değer DB'ye yazılabilir.
 */
export const silentReasonSchema = z
  .string()
  .max(SILENT_REASON_MAX * 4, SILENT_REASON_MESSAGE)
  .trim()
  .refine((v) => !UNSAFE_NAME_CHARS.test(v.replaceAll("\n", "")), "Görünmez veya kontrol karakteri içeremez")
  .refine((v) => {
    const n = [...v].length;
    return n >= SILENT_REASON_MIN && n <= SILENT_REASON_MAX;
  }, SILENT_REASON_MESSAGE);

/**
 * POST /unattended/devices/:id/connect girdisi (§5.1): `{}` → izinli (`ask`); `{silent: true, reason}` → izinsiz. `silent` ⇔
 * `reason`; her ihlal `fields.reason` ile 400 `VALIDATION` (K-P28u-12). Bilinmeyen alan 400.
 */
export const unattendedConnectInputSchema = z
  .strictObject({ silent: z.literal(true).optional(), reason: silentReasonSchema.optional() })
  .superRefine((v, ctx) => {
    if (v.silent && v.reason === undefined) ctx.addIssue({ code: "custom", path: ["reason"], message: "Gerekçe zorunlu" });
    if (!v.silent && v.reason !== undefined)
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Gerekçe yalnız izin istemeden bağlanmada girilir" });
  });
export type UnattendedConnectInput = z.input<typeof unattendedConnectInputSchema>;
export type UnattendedConnectData = z.output<typeof unattendedConnectInputSchema>;

/** §5.1 adım 2c: `ask` isteğinde teknisyen×cihaz başına bu kadar saniyede 1 (yalnız TX başarısında sayılır). */
export const CONNECT_ASK_COOLDOWN_SEC = 60;

/** GET /unattended/policy (`manage` ∧ `settings.view`) ve PUT yanıtı (AC-436). */
export interface UnattendedPolicyView {
  silentEnabled: boolean;
  /** Aydınlatma kutusunun son işaretlendiği an (kapatınca korunur — iz). */
  ackAt: string | null;
  /** Son işaretleyen; kullanıcı silinmişse null. */
  ackByName: string | null;
}

/**
 * PUT /unattended/policy (`manage` ∧ `settings.edit`). `false→true`: `ack !== true` → 400 `fields.ack`, step-up (tüketmez)
 * yoksa 401 `MFA_STEP_UP_REQUIRED`; `true→false` step-up istemez; aynı değer → 200, audit yok. Geçiş kuralı mevcut değere
 * bağlı olduğundan şemada DEĞİL serviste (K3). Açarken `enabled=1, ack_at, ack_by` tek UPDATE (DB CHECK, K1 notu 4).
 */
export const putUnattendedPolicyInputSchema = z.strictObject({ silentEnabled: z.boolean(), ack: z.literal(true).optional() });
export type PutUnattendedPolicyInput = z.infer<typeof putUnattendedPolicyInputSchema>;
export const POLICY_ACK_REQUIRED_MESSAGE = "Açmak için bilgilendirme kutusunu işaretleyin";

// ------------------------------------------------------------------------------------------- P28u müdahale (AC-442..444)

/** POST /sessions/:id/unattended/lock — boş gövde. */
export const interveneLockInputSchema = z.strictObject({});
/** POST /sessions/:id/unattended/logoff — `confirm: true` zorunlu (yanlışlıkla API çağrısına karşı). */
export const interveneLogoffInputSchema = z.strictObject({ confirm: z.literal(true, { error: "Onay gerekli" }) });
export type InterveneLogoffInput = z.infer<typeof interveneLogoffInputSchema>;
export interface InterveneLockResponse {
  ok: true;
}
export interface InterveneLogoffResponse {
  ok: true;
  /** Sunucu yeniden katılım penceresini açtı (`rejoinUntil`). */
  rejoin: boolean;
}
/** `intervene.result` bekleme süreleri ve oda başına kova (§5.3). */
export const INTERVENE_LOCK_TIMEOUT_MS = 5_000;
export const INTERVENE_LOGOFF_TIMEOUT_MS = 15_000;
export const INTERVENE_PER_MIN = 6;

// ------------------------------------------------------------------------------------------- bildirim adresleri (AC-296, 337)

/** Müşteri başına en çok bildirim adresi (§3.4). */
export const NOTIFY_CONTACTS_MAX = 5;

export const notifyContactSchema = z.strictObject({
  email: z.string().trim().max(254, "E-posta en çok 254 karakter olabilir").pipe(z.email("E-posta adresi geçersiz")),
  /** E.164'e normalize; boş/yok → null. */
  phone: optionalPhoneSchema.optional().transform((v) => v ?? null),
});
export type NotifyContactInput = z.input<typeof notifyContactSchema>;

/**
 * PUT /unattended/customers/:customerId/contacts (`manage` + step-up, tüketmez) — tam küme 0..5. Tekillik `notifyEmailKey`
 * ile (`Ad+1@x` ≡ `ad@x`); çakışan satır `fields["items.<i>.email"]`. Gönderim adresi normalize edilmez.
 */
export const putNotifyContactsInputSchema = z.strictObject({
  items: z
    .array(notifyContactSchema)
    .max(NOTIFY_CONTACTS_MAX, `En çok ${NOTIFY_CONTACTS_MAX} adres`)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((c, i) => {
        const key = notifyEmailKey(c.email);
        if (seen.has(key)) ctx.addIssue({ code: "custom", path: [i, "email"], message: "Bu adres listede zaten var" });
        seen.add(key);
      });
    }),
});
export type PutNotifyContactsInput = z.input<typeof putNotifyContactsInputSchema>;
export type PutNotifyContactsData = z.output<typeof putNotifyContactsInputSchema>;

export interface NotifyContact {
  email: string;
  phone: string | null;
}
export interface NotifyContactsResponse {
  items: NotifyContact[];
}

// ------------------------------------------------------------------------------------------- etiketler

/** P28u (§10): kip rozeti / filtre etiketleri. */
export const CONSENT_MODE_LABELS: Readonly<Record<ConsentMode, string>> = {
  asked: "İzinli",
  no_user: "Kullanıcı yok",
  silent: "İzinsiz",
};

/** P28u (§10, AC-429): cihaz listesi "Kullanıcı" sütunu (null → "—"). */
export const DEVICE_USER_STATE_LABELS: Readonly<Record<DeviceUserState, string>> = {
  active: "Aktif",
  locked: "Kilitli",
  none: "Oturum yok",
};

export const UNATTENDED_REVOKE_REASON_LABELS: Readonly<Record<UnattendedRevokeReason, string>> = {
  ADMIN: "Yönetici iptal etti",
  UNINSTALLED: "Cihazdan kaldırıldı",
  CUSTOMER_PASSIVE: "Müşteri pasife alındı",
};

/** P27 audit eylemlerinin Türkçe etiketleri (web `AUDIT_ACTION_LABELS`'a yayılır). */
export const UNATTENDED_AUDIT_LABELS: Readonly<Record<string, string>> = {
  [UNATTENDED_AUDIT.CODE_CREATED]: "Gözetimsiz kayıt kodu oluşturuldu",
  [UNATTENDED_AUDIT.CODE_CANCELLED]: "Gözetimsiz kayıt kodu iptal edildi",
  [UNATTENDED_AUDIT.DEVICE_REGISTERED]: "Gözetimsiz cihaz kaydedildi",
  [UNATTENDED_AUDIT.DEVICE_REVOKED]: "Gözetimsiz cihaz iptal edildi",
  [UNATTENDED_AUDIT.DEVICE_AUTH]: "Gözetimsiz cihaz kimlik doğrulaması",
  [UNATTENDED_AUDIT.DEVICE_REPLACED]: "Gözetimsiz cihaz anahtarı başka yerden kullanılıyor olabilir",
  [UNATTENDED_AUDIT.GRANT_CHANGED]: "Cihaz yetkileri değişti",
  [UNATTENDED_AUDIT.CONTACTS_CHANGED]: "Gözetimsiz bildirim adresleri değişti",
  [UNATTENDED_AUDIT.NOTIFY_FAILED]: "Gözetimsiz bağlantı bildirimi gönderilemedi",
  [UNATTENDED_AUDIT.CONNECT]: "Gözetimsiz bağlantı isteği",
  [UNATTENDED_AUDIT.SESSION_STARTED]: "Gözetimsiz bağlantı başladı",
  [UNATTENDED_AUDIT.SESSION_ENDED]: "Gözetimsiz bağlantı bitti",
  [UNATTENDED_AUDIT.LOCAL_STATE]: "Cihazda yerel anahtar değişti",
  [UNATTENDED_AUDIT.CONSENT]: "Gözetimsiz bağlantı onayı (cihaz kullanıcısı)",
  [UNATTENDED_AUDIT.CONTROL_TOGGLE]: "Gözetimsiz oturumda kontrol değişti",
  [UNATTENDED_AUDIT.LOCK]: "Uzak oturum kilitlendi",
  [UNATTENDED_AUDIT.LOGOFF]: "Uzak kullanıcı oturumu kapatıldı",
  [UNATTENDED_AUDIT.REJOIN]: "Gözetimsiz bağlantı yeniden kuruldu",
  [UNATTENDED_AUDIT.SILENT_NOTIFY]: "İzinsiz bağlantı bildirimi (dört göz)",
  [UNATTENDED_POLICY_AUDIT]: "Gözetimsiz erişim politikası değişti",
};
