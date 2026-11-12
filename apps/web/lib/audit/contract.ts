/*
 * P11 audit log sözleşmesinin web yüzü: tek kaynak `@remote/contracts/api/audit` (docs/mimari-api.md "Yönetim";
 * AC-76, 124). Burada şema/alan tanımı yok; yalnız yeniden dışa aktarım.
 */
export {
  AUDIT_ACTION_GROUPS,
  AUDIT_DEFAULT_RANGE_DAYS,
  AUDIT_MAX_RANGE_DAYS,
  AUDIT_PAGE_SIZE,
  AUDIT_RANGE_TOO_LONG,
  AUDIT_RESULT_LABELS,
  AUDIT_RESULTS,
  auditActionFilterSchema,
} from "@remote/contracts/api/audit";
export type { AuditItem, AuditJson, AuditListResponse, AuditResult } from "@remote/contracts/api/audit";
