// P13a (AC-197): anonimleştirilmiş oturum. Sözleşme tek kaynak: contracts `SessionListItem.anonymized`, hata kodu
// `SESSION_ANONYMIZED` (409, `@remote/contracts/errors`).
import type { SessionListItem } from "@remote/contracts/api/sessions";
import type { ErrorCode } from "@remote/contracts/errors";
import { ApiError } from "@/lib/api";

export const SESSION_ANONYMIZED = "SESSION_ANONYMIZED" satisfies ErrorCode;

/** Saklama işi oturumu anonimleştirdi mi. */
export const isAnonymized = (s: Pick<SessionListItem, "anonymized">): boolean => s.anonymized;

/** Düzenleme isteği anonimleştirilmiş oturuma çarptı (yarış: sayfa açıkken saklama işi çalıştı). */
export const isAnonymizedError = (e: unknown): boolean => e instanceof ApiError && e.status === 409 && e.code === SESSION_ANONYMIZED;
