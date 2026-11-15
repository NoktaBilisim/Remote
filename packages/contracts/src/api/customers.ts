// Müşteri firmalar (P8c) REST sözleşmesi — mimari-api "Müşteriler ve bilgisayar kaydı (P8c)", mimari-e10 §3.1, §3.6, §15.
// Tek kaynak: sunucu girdileri bu şemalarla doğrular, web aynı tipleri ve `foldKey`/`suggestFileLabel`'ı kullanır.
// DB'deki ikinci emniyet: migration `20261112120000_p8c_customers` CHECK'leri (not alanında `\t` de yasak — db-notlari P8c).
import { z } from "zod";
import { normalizePhone, REQUEST_PRIORITIES, SLA_MINUTES_MAX, SLA_MINUTES_MIN, type RequestPriority } from "./requests.ts";
import { UNSAFE_NAME_CHARS } from "./sessions.ts";

export { customerFilterSchema, type CustomerFilter } from "./requests.ts";
export { sessionCustomerFilterSchema, type SessionCustomerFilter } from "./sessions.ts";

// ---------------------------------------------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------------------------------------------

export const CUSTOMER_STATUSES = ["ACTIVE", "PASSIVE"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Liste durum filtresi (AC-166): vars. `active`. */
export const CUSTOMER_STATUS_FILTERS = ["active", "passive", "all"] as const;
export type CustomerStatusFilter = (typeof CUSTOMER_STATUS_FILTERS)[number];

export const CUSTOMER_LIST_SORTS = ["name:asc", "createdAt:desc"] as const;
export type CustomerListSort = (typeof CUSTOMER_LIST_SORTS)[number];

export const CUSTOMER_PAGE_SIZE_DEFAULT = 50;
export const CUSTOMER_PAGE_SIZE_MAX = 100;
/** Detay sekmeleri (AC-178). */
export const CUSTOMER_TAB_PAGE_SIZE_DEFAULT = 25;
/** `GET /customers/options` en çok sonuç (combobox). */
export const CUSTOMER_OPTIONS_MAX = 20;

export const CUSTOMER_NAME_MIN = 2;
export const CUSTOMER_NAME_MAX = 100;
export const CUSTOMER_CONTACT_MAX = 80;
export const CUSTOMER_EMAIL_MAX = 254;
export const CUSTOMER_NOTE_MAX = 1000;
export const FILE_LABEL_MAX = 20;
/** DB sütun genişlikleri (name_key VARCHAR(200), search_key VARCHAR(400)); `customerKeys` bu sınırlarda keser. */
export const CUSTOMER_NAME_KEY_MAX = 200;
export const CUSTOMER_SEARCH_KEY_MAX = 400;

/** AC-167: ad çakışması (409 `fields.name`). */
export const CUSTOMER_NAME_CONFLICT_MESSAGE = "Bu adla bir müşteri zaten var";

// ---------------------------------------------------------------------------------------------------------------
// Katlama ve etiket (mimari-e10 §3.6; web + server ortak; fixture `fixtures/customers.json`)
// ---------------------------------------------------------------------------------------------------------------

const TR_FOLD: Readonly<Record<string, string>> = {
  İ: "i",
  I: "i",
  ı: "i",
  Ş: "s",
  ş: "s",
  Ğ: "g",
  ğ: "g",
  Ç: "c",
  ç: "c",
  Ö: "o",
  ö: "o",
  Ü: "u",
  ü: "u",
};

/**
 * Harf ve Türkçe karakter duyarsız anahtar: NFKC → Türkçe harfler ASCII'ye → `toLowerCase()` (Türkçe harfler önceden
 * eşlendiği için yer ayarsız güvenli) → NFKD + birleşik işaretler silinir → boşluk dizileri tek boşluk → trim.
 * Noktalama korunur ("Ltd." ≠ "Ltd").
 */
export function foldKey(s: string): string {
  return [...s.normalize("NFKC")]
    .map((c) => TR_FOLD[c] ?? c)
    .join("")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Yalnız ASCII rakamlar (telefon araması). */
export const digitsOf = (s: string): string => s.replace(/[^0-9]/g, "");

const TR_ASCII: Readonly<Record<string, string>> = {
  ı: "i",
  İ: "I",
  ş: "s",
  Ş: "S",
  ğ: "g",
  Ğ: "G",
  ç: "c",
  Ç: "C",
  ö: "o",
  Ö: "O",
  ü: "u",
  Ü: "U",
};

/**
 * Dosya etiketi önerisi (AC-130, AC-167; P8b `fileLabelOf` buraya taşındı, davranış aynı): Türkçe harfler ASCII'ye,
 * NFKD + birleşik işaretler silinir, `[^A-Za-z0-9]` silinir, ilk 20; boşsa `Firma`.
 */
export function suggestFileLabel(name: string): string {
  const ascii = [...name]
    .map((c) => TR_ASCII[c] ?? c)
    .join("")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, FILE_LABEL_MAX);
  return ascii || "Firma";
}

const clip = (s: string, max: number): string => {
  const cps = [...s];
  return cps.length <= max ? s : cps.slice(0, max).join("").trimEnd();
};

/**
 * DB anahtarları (mimari-e10 §3.1): `nameKey = foldKey(name)`; `searchKey = nameKey + " " + foldKey(contactName) + " " +
 * rakamlar(phone)`. CHECK `customers_search_key_chk` searchKey'in nameKey ile başlamasını ister; sütun sınırlarında kesilir.
 */
export function customerKeys(name: string, contactName: string | null, phone: string | null): { nameKey: string; searchKey: string } {
  const nameKey = clip(foldKey(name), CUSTOMER_NAME_KEY_MAX);
  const searchKey = clip(`${nameKey} ${foldKey(contactName ?? "")} ${digitsOf(phone ?? "")}`, CUSTOMER_SEARCH_KEY_MAX);
  return { nameKey, searchKey: searchKey.startsWith(nameKey) ? searchKey : nameKey };
}

// ---------------------------------------------------------------------------------------------------------------
// Alan şemaları (mimari-api P8c "Alan şemaları")
// ---------------------------------------------------------------------------------------------------------------

const codePoints = (v: string): number => [...v].length;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const emptyToNull = (v: string | null): string | null => (v === null || v === "" ? null : v);

/** Firma adı: trim, 2..100 kod noktası, Cc/Cf/Zl/Zp yok. */
export const customerFirmNameSchema = z
  .string()
  .max(500, `Ad en çok ${CUSTOMER_NAME_MAX} karakter olabilir`)
  .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Ad görünmez veya kontrol karakteri içeremez")
  .trim()
  .refine((v) => codePoints(v) >= CUSTOMER_NAME_MIN, `Ad en az ${CUSTOMER_NAME_MIN} karakter olmalı`)
  .refine((v) => codePoints(v) <= CUSTOMER_NAME_MAX, `Ad en çok ${CUSTOMER_NAME_MAX} karakter olabilir`);

/** Dosya etiketi: `[A-Za-z0-9]{1,20}` (verilmezse `suggestFileLabel(name)`). */
export const fileLabelSchema = z.string().regex(/^[A-Za-z0-9]{1,20}$/, "Dosya etiketi yalnız harf ve rakam içerebilir (en çok 20)");

/** Yetkili kişi: trim, 0..80, Cc/Cf/Zl/Zp yok; `""`/`null` → `null`. */
export const contactNameSchema = z
  .string()
  .max(400, `En çok ${CUSTOMER_CONTACT_MAX} karakter olabilir`)
  .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Görünmez veya kontrol karakteri içeremez")
  .trim()
  .refine((v) => codePoints(v) <= CUSTOMER_CONTACT_MAX, `En çok ${CUSTOMER_CONTACT_MAX} karakter olabilir`)
  .nullable()
  .transform(emptyToNull);

const PHONE_INVALID = "Telefon numarası geçersiz";

/** Telefon (AC-134 kuralı): `""`/`null` → `null`; aksi E.164. */
export const optionalPhoneSchema = z
  .string()
  .max(40, PHONE_INVALID)
  .nullable()
  .transform((v, ctx) => {
    if (v === null || v.trim() === "") return null;
    const n = normalizePhone(v);
    if (n === null) {
      ctx.addIssue({ code: "custom", message: PHONE_INVALID });
      return z.NEVER;
    }
    return n;
  });

/** E-posta: `""`/`null` → `null`; ≤ 254, geçerli biçim. */
export const optionalEmailNullable = z
  .string()
  .trim()
  .max(CUSTOMER_EMAIL_MAX, `E-posta en çok ${CUSTOMER_EMAIL_MAX} karakter olabilir`)
  .nullable()
  .transform(emptyToNull)
  .pipe(z.email("E-posta adresi geçersiz").nullable());

/** Not: `\n` dışındaki Cc (`\t`, tek `\r` dahil) ve Cf/Zl/Zp yasak (DB `customers_note_chk` ile aynı). */
const hasUnsafeCustomerNoteChars = (v: string): boolean => UNSAFE_NAME_CHARS.test(v.replace(/\n/g, ""));

/** Not: CRLF → LF, trim, 0..1000 kod noktası, düz metin; `""`/`null` → `null`. */
export const customerNoteSchema = z
  .string()
  .max(4000, `Not en çok ${CUSTOMER_NOTE_MAX} karakter olabilir`)
  .overwrite((v) => v.replace(/\r\n/g, "\n"))
  .refine((v) => !hasUnsafeCustomerNoteChars(v), "Not sekme, görünmez veya kontrol karakteri içeremez")
  .trim()
  .refine((v) => codePoints(v) <= CUSTOMER_NOTE_MAX, `Not en çok ${CUSTOMER_NOTE_MAX} karakter olabilir`)
  .nullable()
  .transform(emptyToNull);

export const customerStatusSchema = z.enum(CUSTOMER_STATUSES);

/** P18 (AC-257): müşteri varsayılan önceliği; `null` = firma varsayılanı. */
export const customerPrioritySchema = z.enum(REQUEST_PRIORITIES).nullable();
/** P18 (AC-257): müşteri SLA hedefi (dakika 5..1440); `null` = firma varsayılanı. */
export const customerSlaMinutesSchema = z
  .number()
  .int("Tam sayı olmalı")
  .min(SLA_MINUTES_MIN, `En az ${SLA_MINUTES_MIN} dakika`)
  .max(SLA_MINUTES_MAX, `En çok ${SLA_MINUTES_MAX} dakika`)
  .nullable();

// ---------------------------------------------------------------------------------------------------------------
// Girdi şemaları
// ---------------------------------------------------------------------------------------------------------------

/** POST /customers (AC-167). Opsiyonel alanlar verilmezse NULL; `fileLabel` verilmezse `suggestFileLabel(name)`. */
export const createCustomerInputSchema = z.strictObject({
  name: customerFirmNameSchema,
  fileLabel: fileLabelSchema.optional(),
  contactName: contactNameSchema.optional(),
  phone: optionalPhoneSchema.optional(),
  email: optionalEmailNullable.optional(),
  note: customerNoteSchema.optional(),
  defaultPriority: customerPrioritySchema.optional(),
  slaMinutes: customerSlaMinutesSchema.optional(),
});
export type CreateCustomerInput = z.input<typeof createCustomerInputSchema>;
export type CreateCustomerData = z.output<typeof createCustomerInputSchema>;

/**
 * PATCH /customers/:id (AC-167, AC-195): tüm alanlar opsiyonel, en az biri. Kişisel alanlarda `null`/`""` boşaltır;
 * ad ve dosya etiketi boşaltılamaz. Pasif müşteride de serbest.
 */
export const updateCustomerInputSchema = z
  .strictObject({
    name: customerFirmNameSchema.optional(),
    fileLabel: fileLabelSchema.optional(),
    contactName: contactNameSchema.optional(),
    phone: optionalPhoneSchema.optional(),
    email: optionalEmailNullable.optional(),
    note: customerNoteSchema.optional(),
    defaultPriority: customerPrioritySchema.optional(),
    slaMinutes: customerSlaMinutesSchema.optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), { message: "Değiştirilecek alan yok", path: ["_"] });
export type UpdateCustomerInput = z.input<typeof updateCustomerInputSchema>;
export type UpdateCustomerData = z.output<typeof updateCustomerInputSchema>;

/** POST /customers/:id/rotate-ref | deactivate | reactivate — gövde `{}` (UI onay diyaloğu). */
export const customerActionInputSchema = z.strictObject({});

const qSchema = (min: number) =>
  z
    .string()
    .max(400, "Arama en çok 100 karakter olabilir")
    .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Görünmez veya kontrol karakteri içeremez")
    .trim()
    .refine((v) => codePoints(v) >= min, `En az ${min} karakter girin`)
    .refine((v) => codePoints(v) <= 100, "Arama en çok 100 karakter olabilir");

/** GET /customers (AC-166). `q` boş/boşluksa yok sayılır; verilirse trim sonrası 2..100. */
export const listCustomersQuerySchema = z.strictObject({
  q: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), qSchema(2).optional()),
  status: z.enum(CUSTOMER_STATUS_FILTERS).default("active"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(CUSTOMER_PAGE_SIZE_MAX).default(CUSTOMER_PAGE_SIZE_DEFAULT),
  sort: z.enum(CUSTOMER_LIST_SORTS).default("name:asc"),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

/** GET /customers/options (combobox; ≤ 20, `name_key` sırası). Yeni oturum yalnız `active` ister. */
export const customerOptionsQuerySchema = z.strictObject({
  q: qSchema(0).optional(),
  status: z.enum(["active", "all"]).default("active"),
});
export type CustomerOptionsQuery = z.infer<typeof customerOptionsQuerySchema>;

/** GET /customers/:id/requests | /sessions (AC-178): yeniden eskiye, vars. 25, üst 100. */
export const customerTabQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(CUSTOMER_PAGE_SIZE_MAX).default(CUSTOMER_TAB_PAGE_SIZE_DEFAULT),
});
export type CustomerTabQuery = z.infer<typeof customerTabQuerySchema>;

export const customerIdSchema = z.string().regex(ULID, "Geçersiz kimlik");

// ---------------------------------------------------------------------------------------------------------------
// Yanıt tipleri
// ---------------------------------------------------------------------------------------------------------------

/** Talep/oturum/seçim kutusundaki müşteri firma özeti. */
export interface CustomerFirmRef {
  id: string;
  name: string;
  status: CustomerStatus;
}

/** Liste öğesi (AC-166). Kişisel alanlar listede YOK (yalnız detayda). Sayaçlar türetilir (tüm durumlar). */
export interface CustomerListItem {
  id: string;
  name: string;
  status: CustomerStatus;
  /** `${PUBLIC_BASE_URL}/api/v1/public/agent/request-download?ref=<ref>`; pasifte null (AC-169). */
  downloadUrl: string | null;
  /** `NoktaDestek-<fileLabel>-<ref>.exe`; pasifte null. */
  fileName: string | null;
  createdAt: string;
  lastRequestAt: string | null;
  requestCount: number;
}

/** GET /customers/:id ve yazma uçlarının yanıtı (AC-178). Anonimleştirilmişse kişisel alanlar null + `anonymizedAt`. */
export interface CustomerDetail extends CustomerListItem {
  fileLabel: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  refRotatedAt: string | null;
  passiveAt: string | null;
  anonymizedAt: string | null;
  /** Tenant geneli oturum sayısı (USER için Oturumlar sekmesi yine `historyScope`). */
  sessionCount: number;
  /** P18 (AC-257): null = firma varsayılanı. */
  defaultPriority: RequestPriority | null;
  /** P18 (AC-257): SLA hedefi dakika; null = firma varsayılanı. */
  slaMinutes: number | null;
}

export interface CustomerListResponse {
  items: CustomerListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CustomerOptionsResponse {
  items: CustomerFirmRef[];
}

/** GET /customers/general-link (AC-175): salt okunur Genel bağlantı. */
export interface GeneralLinkResponse {
  downloadUrl: string;
  fileName: string;
}

// ---------------------------------------------------------------------------------------------------------------
// P19 — müşteri CSV dışa/içe aktarma (AC-263; mimari-e11 §8c.5, §8c.6; S-P19-4, 8, 14)
// ---------------------------------------------------------------------------------------------------------------

/** Ortak sütunlar (sıra sabit). Ref dışa aktarılmaz (K-P19-5). `Durum` içe aktarmada yok sayılır. */
export const CUSTOMER_CSV_COLUMNS = [
  "Ad",
  "Yetkili kişi",
  "Telefon",
  "E-posta",
  "Not",
  "Dosya etiketi",
  "Varsayılan öncelik",
  "SLA (dk)",
  "Durum",
] as const;
export type CustomerCsvColumn = (typeof CUSTOMER_CSV_COLUMNS)[number];

/** Dışa aktarma üst sınırı (aşımda 400, yarım dosya yok) ve dakika başına istek (kullanıcı). */
export const CUSTOMER_EXPORT_MAX_ROWS = 50_000;
export const CUSTOMER_EXPORTS_PER_MIN = 10;
/** İçe aktarma: dosya ≤ 2 MB, ≤ 5 000 veri satırı, kayıt ≤ 8 KB; önizleme 10/sa/kullanıcı, 15 dk geçerli. */
export const CUSTOMER_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const CUSTOMER_IMPORT_MAX_ROWS = 5_000;
export const CUSTOMER_IMPORT_MAX_RECORD_CHARS = 8 * 1024;
export const CUSTOMER_IMPORT_PREVIEWS_PER_HOUR = 10;
export const CUSTOMER_IMPORT_PREVIEW_TTL_MS = 15 * 60_000;
/** Önizleme yanıtında en çok gösterilen satır ve hata sayısı (sayaçlar tümünü sayar). */
export const CUSTOMER_IMPORT_PREVIEW_ROWS = 50;
export const CUSTOMER_IMPORT_ERRORS_MAX = 500;
/** multipart dosya alanı. */
export const CUSTOMER_IMPORT_FIELD = "file";

export const CUSTOMER_IMPORT_MESSAGES = {
  noFile: "Bir CSV dosyası seçin.",
  notUtf8: "Dosya UTF-8 değil. Excel'de 'CSV UTF-8' olarak kaydedin.",
  tooManyRows: "En çok 5.000 satır",
  tooLarge: "Dosya en çok 2 MB olabilir.",
  noNameColumn: "“Ad” sütunu bulunamadı. İlk satır sütun başlıklarını içermeli.",
  empty: "Dosyada içe aktarılacak satır yok.",
  previewRequired: "Önizlemenin süresi doldu ya da geçersiz; dosyayı yeniden yükleyin.",
  busy: "Başka bir içe aktarma sürüyor",
  exportTooMany: "En çok 50.000 müşteri dışa aktarılabilir.",
} as const;

/** GET /customers/export.csv: `status` vars. `all` (Durum sütunu dosyadadır). */
export const exportCustomersQuerySchema = z.strictObject({
  status: z.enum(CUSTOMER_STATUS_FILTERS).default("all"),
});
export type ExportCustomersQuery = z.infer<typeof exportCustomersQuerySchema>;

export const CUSTOMER_IMPORT_CONFLICT_MODES = ["skip", "update"] as const;
export type CustomerImportConflictMode = (typeof CUSTOMER_IMPORT_CONFLICT_MODES)[number];

/** POST /customers/import/commit. `update` ayrıca `customers.edit` ister. */
export const importCommitInputSchema = z.strictObject({
  previewId: z.string().regex(/^[A-Za-z0-9_-]{22}$/, "Geçersiz önizleme"),
  onConflict: z.enum(CUSTOMER_IMPORT_CONFLICT_MODES),
});
export type ImportCommitInput = z.infer<typeof importCommitInputSchema>;

/** Önizleme satır sınıfı: `create` (ad firmada yok), `conflict` (aynı ad var, pasifler dahil), `error`. */
export const CUSTOMER_IMPORT_ROW_KINDS = ["create", "conflict", "error"] as const;
export type CustomerImportRowKind = (typeof CUSTOMER_IMPORT_ROW_KINDS)[number];

export interface ImportPreviewRow {
  /** Dosyadaki fiziksel satır (1 = başlık). */
  line: number;
  kind: CustomerImportRowKind;
  /** Dosyadaki ad (hatalı satırda ham hücre; boş olabilir). */
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
}

export interface ImportRowError {
  line: number;
  /** `CUSTOMER_CSV_COLUMNS` başlığı; satır düzeyindeki hata (tırnak, uzunluk, tekrar) için `null`. */
  column: CustomerCsvColumn | null;
  message: string;
}

/** POST /customers/import/preview 200. Sayılar "tahmin": uygulama çakışmayı yeniden hesaplar. */
export interface ImportPreview {
  previewId: string;
  total: number;
  counts: Record<CustomerImportRowKind, number>;
  rows: ImportPreviewRow[];
  errors: ImportRowError[];
  /** Hata sayısı `errors.length`'ten büyükse yanıtta yalnız ilk 500 vardır. */
  errorsTruncated: boolean;
  warnings: string[];
}

/** POST /customers/import/commit 200 (audit `customer.imported` ile aynı özet). */
export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}
