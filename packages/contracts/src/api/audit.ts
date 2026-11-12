// P11 audit ekranı sözleşmesi (mimari §3.3, mimari-api "Yönetim"; AC-76, AC-124, G-15, G-16).
// GET /audit (keyset sayfalı, COUNT yok), GET /audit/export.csv (akış, ≤ 50.000), PUT/PATCH/DELETE/POST → 405.
import { z } from "zod";

export const AUDIT_PAGE_SIZE = 50;
/** `from` verilmezse `to`dan (yoksa şimdiden) geriye bu kadar gün. */
export const AUDIT_DEFAULT_RANGE_DAYS = 30;
/** Aralık (from..to) bu sınırı aşarsa 400 `fields.from` (audit 730 gün tutulur). */
export const AUDIT_MAX_RANGE_DAYS = 731;
export const AUDIT_EXPORT_MAX_ROWS = 50_000;
export const AUDIT_EXPORT_TOO_MANY = "En çok 50.000 satır dışa aktarılabilir; tarih aralığını daraltın";
export const AUDIT_RANGE_TOO_LONG = `Tarih aralığı en çok ${AUDIT_MAX_RANGE_DAYS} gün olabilir`;

export const AUDIT_RESULTS = ["success", "fail"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const isoDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Geçersiz tarih");

/**
 * İşlem filtresi: tam değer (`auth.login`) veya önek (`auth.*` → `auth.` ile başlayanlar). Küçük harf, rakam, `_`,
 * nokta ile ayrılmış parçalar; en çok 60 karakter (sütun genişliği).
 */
export const auditActionFilterSchema = z
  .string()
  .trim()
  .max(60, "İşlem en çok 60 karakter olabilir")
  .regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*(\.\*)?$/, "İşlem adı geçersiz (ör. auth.login veya auth.*)");

/** Opak keyset imleci (sunucu üretir; içeriğine güvenilmez, biçim dışı → 400 `fields.cursor`). */
export const auditCursorSchema = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/, "Geçersiz sayfa imleci");

/**
 * GET /audit ve GET /audit/export.csv sorgusu. Tarihler Europe/Istanbul günü (`to` dahil). `tenantId` yalnız firma
 * seçmemiş Super Admin'de uygulanır; firma kapsamındaki kullanıcıda (Admin/User, geçiş yapmış Super Admin) yok sayılır.
 * `cursor` CSV'de yok sayılır.
 */
export const listAuditQuerySchema = z
  .strictObject({
    from: z.preprocess(blankToUndefined, isoDaySchema.optional()),
    to: z.preprocess(blankToUndefined, isoDaySchema.optional()),
    tenantId: z.preprocess(blankToUndefined, z.string().regex(ULID, "Geçersiz firma").optional()),
    userId: z.preprocess(blankToUndefined, z.string().regex(ULID, "Geçersiz kullanıcı").optional()),
    action: z.preprocess(blankToUndefined, auditActionFilterSchema.optional()),
    result: z.preprocess(blankToUndefined, z.enum(AUDIT_RESULTS, { error: "Sonuç geçersiz" }).optional()),
    cursor: z.preprocess(blankToUndefined, auditCursorSchema.optional()),
  })
  .superRefine((q, ctx) => {
    if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: "custom", path: ["to"], message: "Bitiş tarihi başlangıçtan önce olamaz" });
  });
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

export type AuditJson = string | number | boolean | null | AuditJson[] | { [key: string]: AuditJson };

/**
 * Audit satırı. `oldValue`/`newValue` sunucuda okuma tarafında da maskelenir (savunma derinliği); dış gönderim
 * kayıtlarında (`mail.*`, `session.email`, `settings.*.test`, SMTP) yalnız izinli alanlar ve `reason` SINIFI döner —
 * ham hata metni, yanıt kodu, banner asla. `avatarUrl` P12'ye kadar null (UI baş harf rozeti gösterir).
 */
export interface AuditItem {
  /** BIGINT → dize. */
  id: string;
  createdAt: string;
  tenantId: string | null;
  tenantName: string | null;
  userId: string | null;
  /** Kayıt anındaki kullanıcı adı/e-posta (`system`, `customer` gibi aktörler dahil). */
  username: string | null;
  /** Güncel ad soyad (kullanıcı kaydı varsa). */
  userFullName: string | null;
  avatarUrl: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  oldValue: AuditJson | null;
  newValue: AuditJson | null;
  ipAddress: string | null;
  userAgent: string | null;
  result: AuditResult;
}

export interface AuditListResponse {
  items: AuditItem[];
  /** Sonraki sayfa için `cursor`; son sayfada null. Toplam sayı dönmez (büyük aralıkta COUNT pahalı). */
  nextCursor: string | null;
}

/** CSV sütunları (sıra sabit). Firma seçmemiş Super Admin'de 2. sütun `AUDIT_CSV_TENANT_COLUMN`. */
export const AUDIT_CSV_COLUMNS = ["Tarih", "Kullanıcı", "Ad Soyad", "İşlem", "Varlık", "Kayıt", "Sonuç", "IP adresi", "Tarayıcı", "Eski değer", "Yeni değer"] as const;
export const AUDIT_CSV_TENANT_COLUMN = "Firma";

export const AUDIT_RESULT_LABELS: Readonly<Record<AuditResult, string>> = {
  success: "Başarılı",
  fail: "Başarısız",
};

/** İşlem filtresi açılır listesi (önek → etiket). Bilinmeyen action ekranda ham gösterilir. */
export const AUDIT_ACTION_GROUPS: readonly { prefix: string; label: string }[] = [
  { prefix: "auth.*", label: "Giriş ve hesap güvenliği" },
  { prefix: "user.*", label: "Kullanıcı ve yetki" },
  { prefix: "tenant.*", label: "Firma" },
  { prefix: "tenant_settings.*", label: "Firma ayarları" },
  { prefix: "settings.*", label: "Ayarlar ve testler" },
  { prefix: "session.*", label: "Oturum" },
  { prefix: "guest.*", label: "Misafir (lobi)" },
  { prefix: "control.*", label: "Uzaktan kontrol" },
  { prefix: "monitor.*", label: "Monitör" },
  { prefix: "file.*", label: "Dosya transferi" },
  { prefix: "request.*", label: "Destek talebi" },
  { prefix: "customer.*", label: "Müşteri" },
  { prefix: "binding.*", label: "Kayıtlı bilgisayar" },
  { prefix: "mail.*", label: "E-posta" },
  { prefix: "consent_text.*", label: "Aydınlatma metni (sistem)" },
  { prefix: "audit.*", label: "Audit dışa aktarma" },
];

/** 405 yanıtı mesajı (`METHOD_NOT_ALLOWED`; AC-76: audit kayıtları değiştirilemez/silinemez). */
export const AUDIT_READ_ONLY_MESSAGE = "Audit kayıtları salt okunurdur; değiştirilemez veya silinemez.";
