// /api/v1/sessions ve /api/v1/public/sessions sözleşmesi (mimari-api.md, P2 kısmı).
// P3: resolve joinNonce/nonceExpiresAt, join, terminate. P4: resolve consentText + abuseEmail, join consentTextId zorunlu (G-24, AC-127).
// P8: oturum geçmişi — liste filtreleri, SessionListItem, SessionHistoryDetail, PATCH, CSV (mimari-api "Oturum geçmişi (P8)").
// P8c (mimari-api "Mevcut uçlara ekler"): POST /sessions `customerId`, `customerFirm` alanları, geçmiş müşteri firma filtresi + CSV.
// P13b-L (mimari-lobi §4.3): lobi göstergesi — GET /sessions/waiting, SessionListItem.waitingGuests.
import { z } from "zod";
import { UNSAFE_NAME_CHARS, type CustomerFirmRef } from "./shared.ts";
import { FILE_DIRECTIONS, FILE_RESULTS, qualitySummarySchema, type QualitySummary } from "../ws.ts";

export const SESSION_STATUSES = ["PENDING", "ACTIVE", "ENDED", "EXPIRED", "CANCELLED"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_ENDED_BY = ["TECH", "CUSTOMER", "ADMIN", "SYSTEM"] as const;
export type SessionEndedBy = (typeof SESSION_ENDED_BY)[number];

/** Liste üst sınırı (mimari-api.md "Sayfalama"). */
export const SESSION_PAGE_SIZE_MAX = 100;

/** Token: 32 bayt base64url = 43 karakter (AC-1). Kod: 8 hane (AC-3). */
export const sessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Geçersiz bağlantı");
export const sessionCodeSchema = z.string().regex(/^\d{8}$/, "Kod 8 haneli olmalı");

/** P8c (AC-180): `customerId` verilirse `customers.view` + aynı tenant'ın AKTİF müşterisi olmalı (yoksa 404). */
export const createSessionInputSchema = z.strictObject({
  customerId: z
    .string()
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Geçersiz müşteri")
    .optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;

/** P8b r2 (§13.4, G-E9-4): AGENT istemci sürümü; yoksa sunucu `0.0.0` sayar (MIN_AGENT_VERSION doluysa 426). */
const resolveClientVersion = z
  .string()
  .regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/, "Geçersiz istemci sürümü")
  .optional();
export const resolveSessionInputSchema = z.union([
  z.object({ token: sessionTokenSchema, clientKind: z.enum(["BROWSER", "AGENT"]), clientVersion: resolveClientVersion }),
  z.object({ code: sessionCodeSchema, clientKind: z.enum(["BROWSER", "AGENT"]), clientVersion: resolveClientVersion }),
]);
export type ResolveSessionInput = z.infer<typeof resolveSessionInputSchema>;

export const sessionStatusQuerySchema = z.object({ ref: z.string().regex(/^[A-Za-z0-9_-]{43}[0-9A-HJKMNP-TV-Z]{26}$/) });

/** POST /sessions yanıtı. `link` yalnız burada döner (düz token DB'de yok, G-22). */
export interface CreateSessionResponse {
  id: string;
  /** `${PUBLIC_BASE_URL}/session/<token>` */
  link: string;
  /** 8 hane, boşluksuz; ekranda "4829 1376" biçiminde gösterilir. */
  code: string;
  techVerifyCode: string;
  expiresAt: string;
  status: "PENDING";
  /** P8c (AC-180): seçilen müşteri firma; yoksa null. */
  customerFirm: CustomerFirmRef | null;
}

/** GET /sessions öğesi ve GET /sessions/:id gövdesi. `code` yalnız PENDING iken dolu; link hiç yok. */
export interface SessionView {
  id: string;
  status: SessionStatus;
  code: string | null;
  techVerifyCode: string;
  technician: { id: string; name: string };
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
  endedBy: SessionEndedBy | null;
  endReason: string | null;
}

export interface SessionListResponse {
  items: SessionListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CancelSessionResponse {
  status: "CANCELLED";
}

/** Tenant'ın güncel KVKK aydınlatma metni (P4, AC-29/127). `sha256` = SHA-256(UTF-8 body) hex. */
export interface ConsentTextView {
  id: string;
  version: number;
  /** Düz metin; istemci `textContent` ile basar (HTML değildir). */
  body: string;
  sha256: string;
}

/** POST /public/sessions/resolve yanıtı. */
export interface ResolveSessionResponse {
  /** Opak; GET /public/sessions/status?ref= yoklaması için. Token değildir. */
  sessionRef: string;
  tenant: { name: string; logoUrl: string | null };
  /**
   * P15 (AC-236): `avatarUrl` teknisyenin avatarı varsa oturuma bağlı imzalı URL
   * (`/api/v1/public/sessions/<sessionId>/tech-avatar?exp=&sig=`, ≤ `TECH_AVATAR_URL_TTL_SEC`); yoksa null → baş harf rozeti.
   * Oturum PENDING/ACTIVE değilse (bitti/iptal/süresi doldu) URL 403 döner.
   */
  technician: { name: string; avatarUrl: string | null };
  techVerifyCode: string;
  expiresAt: string;
  /** Tek kullanımlık, 60 sn; istemci türüne (clientKind) bağlıdır (ADR-0012). */
  joinNonce: string;
  nonceExpiresAt: string;
  /** Karşılamada gösterilip onaylanan metin; join'de `consentTextId` olarak geri gönderilir (P4). */
  consentText: ConsentTextView;
  /** "Kötüye kullanımı bildir" `mailto:` adresi (AC-125): ABUSE_EMAIL; production'da yoksa null (bağlantı gizlenir). Super Admin e-postasına düşme yalnız production dışında (S-P4-1). */
  abuseEmail: string | null;
}

export { UNSAFE_NAME_CHARS } from "./shared.ts";

/** POST /public/sessions/join (mimari-api.md). `consentTextId` oturumun tenant'ının güncel sürümü değilse 400 VALIDATION, fields.consentTextId (G-24, AC-127). */
export const joinSessionInputSchema = z.strictObject({
  joinNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Geçersiz istek"),
  customerName: z
    .string()
    .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Ad görünmez veya kontrol karakteri içeremez")
    .trim()
    // Uzunluk kod noktasıyla (DB CHECK CHAR_LENGTH ile tutarlı, QA-P8-2): tek emoji 1 karakter sayılır.
    .refine((v) => [...v].length >= 2, "Ad en az 2 karakter olmalı")
    .refine((v) => [...v].length <= 100, "Ad en çok 100 karakter olabilir"),
  customerEmail: z.email().max(190).optional(),
  consentTextId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Aydınlatma metni geçersiz"),
  consentAccepted: z.literal(true, "Aydınlatma metni onaylanmalı"),
});
export type JoinSessionInput = z.infer<typeof joinSessionInputSchema>;

/** iceServers ve reconnectToken YOK — admit sonrası `hello`'da (G-01, G-13). */
export interface JoinSessionResponse {
  /** WS `Sec-WebSocket-Protocol: rs.v1, rs.ticket.<wsTicket>`; 60 sn, tek kullanımlık. */
  wsTicket: string;
  /** 4 hane; yalnız bu misafire gösterilir, müşteri teknisyene okur. */
  admitCode: string;
  technicianName: string;
}

export const terminateSessionInputSchema = z.strictObject({ reason: z.string().trim().max(200).optional() });
export type TerminateSessionInput = z.infer<typeof terminateSessionInputSchema>;
export interface TerminateSessionResponse {
  status: "ENDED";
  endedBy: "ADMIN";
}

export interface PublicSessionStatusResponse {
  status: SessionStatus;
}

// --- P8: oturum geçmişi (mimari-api "Oturum geçmişi (P8)"; AC-60..63, 124) ---

/** P27 (mimari-p27 §3.5, §4.6): `UNATTENDED` = gözetimsiz cihaz oturumu (`device_id` dolu; geçmiş filtresi "Gözetimsiz"). */
export const SESSION_MODES = ["AGENT", "BROWSER", "UNATTENDED"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

/** P8b (AC-158): oturum kaynağı — `request_id IS NULL` → TECH (link/kod), değilse REQUEST (müşteri talebi). */
export const SESSION_SOURCES = ["TECH", "REQUEST"] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

export const SESSION_LIST_SORTS = ["createdAt:desc", "createdAt:asc"] as const;
export type SessionListSort = (typeof SESSION_LIST_SORTS)[number];

/** CSV dışa aktarma üst sınırı (§5): aşılırsa 400 VALIDATION `fields.to`, yarım dosya üretilmez. */
export const SESSION_EXPORT_MAX_ROWS = 50_000;
export const SESSION_EXPORT_TOO_MANY = "En çok 50.000 satır dışa aktarılabilir; tarih aralığını daraltın";

const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Geçersiz kimlik");

/**
 * P8c (AC-179) geçmiş müşteri FİRMA filtresi: `none` (müşterisiz) ya da müşteri kimliği. Sorgu parametresi adı
 * `customerFirm`'dür — P8 `customer` parametresi misafir adı aramasıdır ve kırılmaz (sapma, implementation.md P8c-1).
 */
export const sessionCustomerFilterSchema = z.union([z.literal("none"), ulidSchema]);
export type SessionCustomerFilter = z.infer<typeof sessionCustomerFilterSchema>;

/** Geçerli takvim günü (YYYY-MM-DD); Europe/Istanbul günü olarak yorumlanır (§1). */
const isoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Geçersiz tarih");

/**
 * GET /sessions ve GET /sessions/export.csv sorgusu (§1). Bilinmeyen parametre 400 (strict). `technicianId` USER'da,
 * `tenantId` firma seçili olan veya SUPER_ADMIN olmayan rollerde sunucuda yok sayılır (kapsam ezer, §2).
 * Export'ta `page`/`pageSize` yok sayılır.
 */
export const listSessionsQuerySchema = z
  .strictObject({
    status: z.enum(SESSION_STATUSES).optional(),
    mode: z.enum(SESSION_MODES).optional(),
    source: z.enum(SESSION_SOURCES).optional(),
    from: isoDaySchema.optional(),
    to: isoDaySchema.optional(),
    technicianId: ulidSchema.optional(),
    tenantId: ulidSchema.optional(),
    customer: z
      .string()
      .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Görünmez veya kontrol karakteri içeremez")
      .trim()
      .min(2, "En az 2 karakter girin")
      .max(100)
      .optional(),
    customerFirm: sessionCustomerFilterSchema.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(SESSION_PAGE_SIZE_MAX).default(25),
    sort: z.enum(SESSION_LIST_SORTS).default("createdAt:desc"),
  })
  .superRefine((q, ctx) => {
    if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: "custom", path: ["to"], message: "Bitiş tarihi başlangıçtan önce olamaz" });
  });
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;
/** Export aynı filtreleri kullanır (sayfalama yok sayılır). */
export const exportSessionsQuerySchema = listSessionsQuerySchema;
export type ExportSessionsQuery = ListSessionsQuery;

/** GET /sessions öğesi (§1). E-posta ve not listede yok (veri en aza indirme). */
export interface SessionListItem extends SessionView {
  mode: SessionMode | null;
  /** = consumed_at (admit = ACTIVE başlangıcı, mimari §3.1 P3 kararı). */
  startedAt: string | null;
  /** startedAt ve endedAt doluysa saniye (aşağı yuvarlanmış); aksi halde null (ACTIVE'de UI canlı hesaplar). */
  durationSec: number | null;
  customerName: string | null;
  ticketNo: string | null;
  /** Yalnız SUPER_ADMIN firma seçmeden listelerken dolu. */
  tenant: { id: string; name: string } | null;
  /** P8b (AC-158). */
  source: SessionSource;
  /** REQUEST: talep→kabul saniyesi (accepted_at − request.created_at); TECH: null. */
  waitSec: number | null;
  /** P8c (AC-179): müşteri firma; müşterisiz oturumda null (UI boş gösterir, "Genel" değil). */
  customerFirm: CustomerFirmRef | null;
  /**
   * P13a (AC-197): saklama işi oturumu anonimleştirdi (`anonymized_at IS NOT NULL`). true iken `customerName`,
   * `customerEmail`, `note`, talep PII'si null; `files` boş; zaman çizelgesinde müşteri adı yok. Ticket no, süre, mod,
   * kalite kalır. Düzenleme 409 `SESSION_ANONYMIZED`.
   */
  anonymized: boolean;
  /**
   * P13b-L (AC-305): bekleme odasındaki (LOBBY) misafir sayısı, 0..LOBBY_GUEST_MAX. Sunucu belleğinden gelir;
   * PENDING olmayan satırda 0. Yalnız sayı (AC-311).
   */
  waitingGuests: number;
}

/** P8b (AC-158): geçmiş detayında "Destek talebi" bölümü. Anonimleştirilmiş talepte PII null. */
export interface SessionRequestInfo {
  id: string;
  createdAt: string;
  acceptedAt: string | null;
  waitSec: number | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  description: string | null;
  /** P18 (mimari-e11 §8b.8, AC-257): talebin SLA hedefi (ISO); SLA'sız talepte null. */
  slaDueAt: string | null;
  /** P18: `slaBreachedAt(talep, yanıt anı)` — CSV "SLA aşıldı" ile aynı hesap; SLA yoksa null (CSV'de boş hücre). */
  slaBreached: boolean | null;
}

export const CONSENT_LEVELS = ["VIEW", "CONTROL"] as const;
export type ConsentLevel = (typeof CONSENT_LEVELS)[number];
export const CONSENT_DECISIONS = ["GRANTED", "DENIED", "REVOKED"] as const;
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number];
/** session_consents.source (P7: TECH; P27: UNATTENDED — gözetimsiz otomatik kabul, metinsiz, §2 adım 5). */
export const CONSENT_RECORD_SOURCES = ["UI", "HOTKEY", "RECONNECT", "SYSTEM", "TECH", "UNATTENDED"] as const;
export type ConsentRecordSource = (typeof CONSENT_RECORD_SOURCES)[number];

/** Onay kaydı (§3). `ip` ve `user_agent` API'de dönmez (veri en aza indirme). */
export interface SessionConsentRecord {
  id: string;
  at: string;
  level: ConsentLevel;
  decision: ConsentDecision;
  source: ConsentRecordSource;
  consentText: { id: string; version: number; sha256: string } | null;
}

/**
 * Kontrol dönemi (§3): GRANTED → ilk REVOKED. Kapanış yoksa `revokedAt`/`revokedSource` null (UI "Kapanış kaydı yok";
 * bitiş tahmin edilmez, ADR-0013 K5-d). Eşleşmeyen audit → `revokedReason`/`selfElevated` null.
 */
export interface ControlPeriod {
  grantedAt: string;
  revokedAt: string | null;
  revokedSource: ConsentRecordSource | null;
  revokedReason: string | null;
  selfElevated: boolean | null;
}

export interface SessionFileRecord {
  id: string;
  direction: (typeof FILE_DIRECTIONS)[number];
  fileName: string;
  sizeBytes: number;
  sha256: string;
  result: (typeof FILE_RESULTS)[number];
  createdAt: string;
  /**
   * P15 (AC-238): satırı yazan taraf. Aynı aktarımın iki raporu (`match_key`) tek satıra indirgenir; teknisyen raporu
   * varsa o gösterilir. Eski (P15 öncesi) satırlar `TECH`.
   */
  reportedBy: "TECH" | "CUSTOMER";
  /** P15 (AC-238): teknisyen raporlu ya da iki tarafça eşleşen → true ("Doğrulanmış"); yalnız müşteri → false ("Müşteri bildirimi"). */
  verified: boolean;
}

export const TIMELINE_ACTORS = ["TECH", "CUSTOMER", "ADMIN", "SYSTEM"] as const;
export type TimelineActor = (typeof TIMELINE_ACTORS)[number];

/**
 * Zaman çizelgesine giren audit action'ları ve her biri için izinli `details` anahtarları (§3 tablo). Listede olmayan
 * action ya da anahtar dönmez; IP/UA/maskeli değer hiç dönmez.
 */
export const TIMELINE_DETAIL_KEYS = {
  "session.created": ["ttlMin"],
  "guest.pending": ["name"],
  "guest.rejected": ["name"],
  "guest.admitted": ["name", "guestKind"],
  "guest.admit": ["reason"],
  "reconnect.conflict": [],
  "control.requested": ["request"],
  "control.granted": ["selfElevated"],
  "control.denied": [],
  "control.revoked": ["source", "reason", "side"],
  "control.released": ["via"],
  "control.cancelled": ["by", "source"],
  "monitor.requested": ["monitorId"],
  "monitor.granted": ["monitorId"],
  "monitor.denied": ["monitorId"],
  "session.caps_changed": ["oldCaps", "newCaps"],
  "session.cancelled": [],
  "session.expired": [],
  "session.terminated": ["reason"],
  "session.ended": ["reason", "endedBy"],
} as const satisfies Record<string, readonly string[]>;
export type TimelineAction = keyof typeof TIMELINE_DETAIL_KEYS;
export const TIMELINE_ACTIONS = Object.keys(TIMELINE_DETAIL_KEYS) as TimelineAction[];

export type TimelineDetailValue = string | number | boolean | null;

export interface TimelineEvent {
  at: string;
  /** İzin listesindeki action (bilinmeyen değer UI'da ham gösterilir). */
  action: string;
  actor: TimelineActor;
  actorName: string | null;
  result: "success" | "fail";
  details: Record<string, TimelineDetailValue>;
}

/** Zaman çizelgesi / onay / dosya listelerinin üst sınırı (§3). */
export const SESSION_HISTORY_LIST_MAX = 500;

/** GET /sessions/:id/history ve PATCH /sessions/:id yanıtı (§3, AC-62). */
/** Geçmiş detayı canlı lobi durumu taşımaz (mimari-lobi §4.2). */
export interface SessionHistoryDetail extends Omit<SessionListItem, "waitingGuests"> {
  customerEmail: string | null;
  note: string | null;
  /** Yalnız endedBy=ADMIN iken dolu (sonlandıran yönetici). */
  terminatedBy: { id: string; name: string } | null;
  quality: QualitySummary | null;
  files: SessionFileRecord[];
  consents: SessionConsentRecord[];
  controlPeriods: ControlPeriod[];
  timeline: TimelineEvent[];
  timelineTruncated: boolean;
  /** P8b (AC-158): talepten doğan oturumda dolu; TECH kaynağında null. */
  request: SessionRequestInfo | null;
}

/** DB `quality_summary` JSON'u (t/id yok). Ayrıştırılamazsa detay `quality: null` döner. */
export const storedQualitySummarySchema = qualitySummarySchema.omit({ t: true, id: true });

export const TICKET_NO_MAX = 50;
export const NOTE_MAX = 4000;

/** Not: CRLF → LF normalize edilir; `\n` ve `\t` serbest; diğer Cc ile bidi/sıfır genişlik Cf (ve Zl/Zp) yasak (§4). */
const hasUnsafeNoteChars = (v: string): boolean => UNSAFE_NAME_CHARS.test(v.replace(/[\n\t]/g, ""));

/**
 * PATCH /sessions/:id (§4, AC-63). En az bir alan; boş metin ve null → NULL; gönderilmeyen alan değişmez.
 * `note` uzunluğu UTF-16 birimiyle sayılır (DB CHAR_LENGTH'ten her zaman ≥; CHECK tetiklenmez).
 */
export const updateSessionInputSchema = z
  .strictObject({
    ticketNo: z
      .string()
      .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Ticket no görünmez veya kontrol karakteri içeremez")
      .trim()
      .max(TICKET_NO_MAX, `Ticket no en çok ${TICKET_NO_MAX} karakter olabilir`)
      .nullable()
      .transform((v) => (v === "" ? null : v))
      .optional(),
    note: z
      .string()
      .overwrite((v) => v.replace(/\r\n/g, "\n")) // CRLF → LF (dba P8: DB satır sonu olarak yalnız \n saklar); tek \r yasak
      .refine((v) => !hasUnsafeNoteChars(v), "Not görünmez veya kontrol karakteri içeremez")
      .max(NOTE_MAX, `Not en çok ${NOTE_MAX} karakter olabilir`)
      .nullable()
      .transform((v) => (v === "" ? null : v))
      .optional(),
  })
  .refine((o) => o.ticketNo !== undefined || o.note !== undefined, { message: "Değiştirilecek alan yok", path: ["_"] });
export type UpdateSessionInput = z.input<typeof updateSessionInputSchema>;
export type UpdateSessionData = z.output<typeof updateSessionInputSchema>;

/** CSV sütunları (§5, sabit sıra). `Firma` yalnız SUPER_ADMIN firma seçmeden dışa aktarırken eklenir (2. sütun). */
export const SESSION_CSV_COLUMNS = [
  "Oturum No",
  "Oluşturma",
  "Başlangıç",
  "Bitiş",
  "Süre",
  "Durum",
  "Mod",
  // P8b (AC-158): kaynak + bekleme (HH:MM:SS). Telefon ve açıklama CSV'ye girmez (veri en aza indirme).
  "Kaynak",
  // P8c (AC-179): müşterisiz oturumda boş hücre.
  "Müşteri firma",
  "Bekleme",
  "Teknisyen",
  "Müşteri",
  "Ticket No",
  "Sonlandıran",
  "Bitiş nedeni",
  "Not",
  // P15 (AC-238): "N doğrulanmış; M müşteri bildirimi" (dosya yoksa ve anonimleştirilmişte boş).
  "Dosyalar",
  // P18 (AC-257, K-P18-6): "Evet" / "Hayır" / boş (talepsiz oturum ya da SLA'sız talep).
  "SLA aşıldı",
] as const;
/** P13a (AC-197): 409 `SESSION_ANONYMIZED` mesajı (mimari-p13 §3). */
export const SESSION_ANONYMIZED_MESSAGE = "Bu oturum saklama süresi dolduğu için anonimleştirildi; düzenlenemez.";
/** P13a (AC-197): anonimleştirilmiş satırda "Müşteri" hücresine yazılan değer (sütun kümesi değişmez; Not boş). */
export const SESSION_CSV_ANONYMIZED = "Anonimleştirildi";
export const SESSION_CSV_TENANT_COLUMN = "Firma";

/**
 * P10 (AC-10): POST /sessions/:id/email — oturum bağlantısını müşteriye e-postayla gönder (sessions.create; yalnız
 * oturumun kendi teknisyeni, PENDING ve süresi dolmamış). `link`: POST /sessions yanıtındaki bağlantı — düz token DB'de
 * olmadığı için sunucu bağlantıyı yeniden üretemez; gelen bağlantının `${PUBLIC_BASE_URL}/session/<token>` biçiminde ve
 * token'ın bu oturuma ait olduğu doğrulanır (başka adres gönderilemez). Teknisyen başına 20/sa → 429 (+Retry-After).
 * Gönderim hatası 502 `UPSTREAM`; SMTP ayarı yoksa 502 (mesaj "Önce SMTP ayarlarını yapın").
 */
export const sessionEmailInputSchema = z.strictObject({
  to: z.string().trim().max(254, "E-posta en çok 254 karakter olabilir").pipe(z.email("E-posta adresi geçersiz")),
  link: z.string().max(300, "Bağlantı geçersiz"),
});
export type SessionEmailInput = z.infer<typeof sessionEmailInputSchema>;
export interface SessionEmailResponse {
  sent: true;
}
/** AC-10: teknisyen başına saatlik oturum bağlantısı e-postası üst sınırı (G-23). */
export const SESSION_EMAIL_PER_HOUR = 20;

// --- P13b-L: bekleme odası (lobi) göstergesi (mimari-lobi §4.3, ADR-0029; AC-304..315) ---

/** Oda başına bekleme odası üst sınırı (AC-113); sunucu `signaling/types.ts` LOBBY_MAX bu değeri kullanır. */
export const LOBBY_GUEST_MAX = 3;
/** Web yoklama aralığı (V-L1). */
export const LOBBY_POLL_MS = 10_000;
/** GET /sessions/waiting kullanıcı başına dakikalık üst sınır (AC-314); 61. istek 429. */
export const SESSIONS_WAITING_PER_MIN = 60;

/**
 * GET /sessions/waiting yanıtı: yalnız kendi PENDING oturumlarım (waiting ≥ 1), `id`'ye göre sıralı; `count` = Σ waiting.
 * `arrivals` oda başına monoton artan LOBBY geliş sayacıdır (toast tekilleştirme, mimari-lobi §6.3). Strict: ad, e-posta
 * gibi ek alan şema ihlalidir (AC-311).
 */
export const waitingSessionsResponseSchema = z.strictObject({
  count: z.number().int().min(0),
  sessions: z.array(
    z.strictObject({
      id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      waiting: z.number().int().min(1).max(LOBBY_GUEST_MAX),
      arrivals: z.number().int().min(1),
    }),
  ),
});
export type WaitingSessionsResponse = z.infer<typeof waitingSessionsResponseSchema>;

/** P15 (AC-236): imzalı teknisyen avatarı URL'sinin ömrü (sn; mimari ≤ 10 dk). */
export const TECH_AVATAR_URL_TTL_SEC = 600;
export const techAvatarQuerySchema = z.strictObject({
  exp: z.string().regex(/^\d{1,12}$/),
  sig: z.string().regex(/^[a-f0-9]{64}$/),
});
