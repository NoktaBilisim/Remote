/*
 * P16 (AC-242, mimari-e11 §7.5, §7.8) firma kalıcı silme sözleşmesinin web yüzü + saf yardımcılar. Şema/alan tanımı
 * contracts'ta (`@remote/contracts/api/tenants`); burada yalnız yeniden dışa aktarım, Türkçe adım etiketleri, uygunluk
 * ve hata eşlemesi (vitest: `purge.test.ts`).
 */
import {
  TENANT_PURGE_CANCEL_CONFLICT_MESSAGE,
  TENANT_PURGE_DELAY_HOURS,
  TENANT_PURGE_OPEN_JOB_MESSAGE,
  TENANT_PURGE_PASSIVE_DAYS,
  TENANT_PURGE_PREVIEW_REQUIRED_MESSAGE,
  TENANT_PURGE_STEPS,
  TENANT_REACTIVATE_PURGE_PARTIAL_MESSAGE,
  TENANT_REACTIVATE_PURGE_SCHEDULED_MESSAGE,
  type TenantPurgeCounts,
  type TenantPurgeStatus,
  type TenantPurgeStep,
} from "@remote/contracts/api/tenants";
import { ApiError } from "@/lib/api";

export {
  TENANT_PURGE_CANCEL_CONFLICT_MESSAGE,
  TENANT_PURGE_DELAY_HOURS,
  TENANT_PURGE_OPEN_JOB_MESSAGE,
  TENANT_PURGE_PASSIVE_DAYS,
  TENANT_PURGE_PREVIEW_REQUIRED_MESSAGE,
  TENANT_PURGE_STEPS,
  TENANT_REACTIVATE_PURGE_PARTIAL_MESSAGE,
  TENANT_REACTIVATE_PURGE_SCHEDULED_MESSAGE,
};
export {
  TENANT_NAME_MAX,
  TENANT_PURGE_NOT_ELIGIBLE_MESSAGE,
  TENANT_PURGE_OPEN_STATES,
  TENANT_PURGE_PREVIEW_TTL_MIN,
} from "@remote/contracts/api/tenants";
export type {
  PurgeJobItem,
  PurgeJobsResponse,
  TenantPurgeBadge,
  TenantPurgeCancelResponse,
  TenantPurgeCounts,
  TenantPurgeInput,
  TenantPurgePreviewResponse,
  TenantPurgeScheduledResponse,
  TenantPurgeState,
  TenantPurgeStatus,
  TenantPurgeStep,
} from "@remote/contracts/api/tenants";

/** RUNNING işte durum yoklaması (mimari §7.8: 3 sn). */
export const PURGE_RUNNING_POLL_MS = 3_000;
/** Super Admin bandı yoklaması (mimari §7.8: 60 sn). */
export const PURGE_BANNER_POLL_MS = 60_000;
/** Silinmeyen audit kayıtlarının saklama süresi (gün; ADR-0030, kılavuz metni). */
export const PURGE_AUDIT_RETAIN_DAYS = 730;

/** Adım → kullanıcıya gösterilen Türkçe etiket (sayım satırları ve RUNNING adım çubuğu). */
export const PURGE_STEP_LABELS: Readonly<Record<TenantPurgeStep, string>> = {
  FENCE: "Hazırlık",
  SESSION_FILES: "Oturum dosya kayıtları",
  SESSION_CONSENTS: "Aydınlatma onayları",
  REQUEST_UNLINK: "Talep–oturum bağları",
  BINDINGS: "Kayıtlı bilgisayarlar",
  SESSIONS: "Destek oturumları",
  REQUESTS: "Destek talepleri",
  REQUEST_BLOCKS: "Talep engelleri",
  REQUEST_REFS: "Talep bağlantıları",
  CUSTOMERS: "Müşteriler",
  SETTINGS: "Firma ayarları",
  CONSENT_TEXTS: "Aydınlatma metinleri",
  USER_CHILDREN: "Kullanıcı yetki ve oturum kayıtları",
  USERS: "Kullanıcılar",
  TENANT_ROW: "Firma kaydı",
  FILES: "Dosyalar (logo, resim, aktarım)",
  DONE: "Tamamlandı",
};

const DAY_MS = 86_400_000;

export type PurgeEligibility =
  | { kind: "active" }
  | { kind: "wait"; eligibleAt: string }
  /** `passiveSince` bilinmiyor (sunucu alanı göndermedi) ya da 30 gün doldu → düğme açık; son karar sunucuda. */
  | { kind: "eligible" };

/** Firma silinebilir mi (arayüz ipucu; sunucu DB saatiyle yeniden doğrular → 409 `PURGE_NOT_ELIGIBLE`). */
export function purgeEligibility(t: { status: string; passiveSince?: string | null }, now: number): PurgeEligibility {
  if (t.status !== "PASSIVE") return { kind: "active" };
  if (!t.passiveSince) return { kind: "eligible" };
  const at = Date.parse(t.passiveSince) + TENANT_PURGE_PASSIVE_DAYS * DAY_MS;
  if (!Number.isFinite(at) || at <= now) return { kind: "eligible" };
  return { kind: "wait", eligibleAt: new Date(at).toISOString() };
}

/** RUNNING adım çubuğu: 1 tabanlı sıra, toplam ve yüzde (0..100, tamsayı). */
export function purgeProgress(s: Pick<TenantPurgeStatus, "state" | "step" | "stepIndex" | "stepCount">): {
  current: number;
  total: number;
  pct: number;
  label: string;
} {
  const total = s.stepCount > 0 ? s.stepCount : TENANT_PURGE_STEPS.length;
  const idx = s.state === "DONE" ? total - 1 : Math.min(Math.max(0, s.stepIndex), total - 1);
  const pct = s.state === "DONE" ? 100 : Math.round((idx / Math.max(1, total - 1)) * 100);
  return { current: idx + 1, total, pct, label: PURGE_STEP_LABELS[s.step] ?? s.step };
}

/** Önizleme sayımları adım sırasıyla (bilinmeyen anahtar sona, ham adla). */
export function purgeCountRows(counts: TenantPurgeCounts): { step: string; label: string; count: number }[] {
  const known = TENANT_PURGE_STEPS.filter((k) => typeof counts[k] === "number").map((k) => ({
    step: k as string,
    label: PURGE_STEP_LABELS[k],
    count: counts[k] as number,
  }));
  const extra = Object.entries(counts)
    .filter(([k, v]) => !(TENANT_PURGE_STEPS as readonly string[]).includes(k) && typeof v === "number")
    .map(([k, v]) => ({ step: k, label: k, count: v as number }));
  return [...known, ...extra];
}

/** SCHEDULED işte başlamaya kalan süre (ms; ≥ 0). `now` null (hidrasyon öncesi) → null. */
export const purgeRemainingMs = (scheduledFor: string, now: number | null): number | null =>
  now === null ? null : Math.max(0, Date.parse(scheduledFor) - now);

/**
 * Silme/iptal/önizleme hatası → arayüz eylemi. `field`: ad alanının altında; `preview`: önizleme yeniden alınmalı (428);
 * `refresh`: durum değişti (açık iş/iptal çakışması) — panel yenilenir; `notEligible`: tarih ya da neden.
 */
export type PurgeUiError =
  | { kind: "field"; message: string }
  | { kind: "preview"; message: string }
  | { kind: "refresh"; message: string }
  | { kind: "notEligible"; eligibleAt: string | null; message: string }
  | { kind: "other" };

export function purgeErrorOf(e: unknown): PurgeUiError {
  if (!(e instanceof ApiError)) return { kind: "other" };
  if (e.status === 400 && e.fields?.confirmName) return { kind: "field", message: e.fields.confirmName };
  if (e.code === "PREVIEW_REQUIRED") return { kind: "preview", message: e.message || TENANT_PURGE_PREVIEW_REQUIRED_MESSAGE };
  if (e.code === "PURGE_NOT_ELIGIBLE") return { kind: "notEligible", eligibleAt: e.fields?.eligibleAt ?? null, message: e.message };
  if (e.status === 409 && e.code === "CONFLICT")
    return {
      kind: "refresh",
      message: e.message || (e.fields?.jobId ? TENANT_PURGE_OPEN_JOB_MESSAGE : TENANT_PURGE_CANCEL_CONFLICT_MESSAGE),
    };
  return { kind: "other" };
}

/** Yeniden etkinleştirme 409'u silme işinden mi (genel "zaten aktif"ten ayrılır)? */
export const isReactivatePurgeConflict = (e: unknown): e is ApiError =>
  e instanceof ApiError &&
  e.status === 409 &&
  (e.message === TENANT_REACTIVATE_PURGE_SCHEDULED_MESSAGE || e.message === TENANT_REACTIVATE_PURGE_PARTIAL_MESSAGE);

/** `lastError` hata sınıfı → Türkçe (FAILED kartı). Bilinmeyen sınıf ham gösterilir. */
export const PURGE_ERROR_LABELS: Readonly<Record<string, string>> = {
  db_fk: "veritabanı bağımlılık hatası",
  db_signal: "veritabanı koruması reddetti",
  fs: "dosya sistemi hatası",
  invalid_job: "iş geçersiz",
  other: "beklenmeyen hata",
};
export const purgeErrorLabel = (c: string | null): string => (c ? (PURGE_ERROR_LABELS[c] ?? c) : PURGE_ERROR_LABELS.other!);
