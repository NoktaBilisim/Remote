"use client";

import { EyeOff } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { auditActor, auditItemLabel } from "@/lib/audit/actions";
import { AUDIT_RESULT_LABELS, type AuditItem, type AuditResult } from "@/lib/audit/contract";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";

export const who = (a: AuditItem) => auditActor(a).name ?? t("au.system");
/** P16: firma etiketi — silinmiş firmada "Silinmiş firma #…" (sunucu üretir). */
export const tenantOf = (a: AuditItem) => a.tenantLabel ?? a.tenantName;

export const detailLabel = (a: AuditItem) => t("au.detailOf", { action: auditItemLabel(a), time: formatDateTime(a.createdAt) });

/** P16 (S16-1): kimlik maskesi uygulanmış satır rozeti (nötr; metin + ikon). */
export function MaskedBadge() {
  return (
    <span
      data-testid="audit-masked"
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium whitespace-nowrap text-fg-muted"
    >
      <EyeOff aria-hidden className="size-3.5" />
      {t("au.masked")}
    </span>
  );
}

/** Sonuç rozeti: renk + metin + nokta (yalnız renge dayanmaz). */
export function ResultBadge({ result }: { result: AuditResult }) {
  const ok = result === "success";
  return (
    <span
      data-testid="audit-result-badge"
      data-result={result}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${ok ? "bg-success-surface text-success" : "bg-danger-surface text-danger"}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${ok ? "bg-success" : "bg-danger"}`} />
      {AUDIT_RESULT_LABELS[result]}
    </span>
  );
}

export function UserCell({ a }: { a: AuditItem }) {
  const name = who(a);
  const display = auditActor(a).name;
  const sub = display && a.username && a.username !== display ? a.username : null;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={name} src={a.avatarUrl} size="sm" testId="audit-avatar" tombstone={auditActor(a).tombstone} />
      <span className="min-w-0">
        <span className="block truncate text-fg" title={name}>
          {name}
        </span>
        {sub && (
          <span className="block truncate text-xs text-fg-muted" title={sub}>
            {sub}
          </span>
        )}
        {a.identityMasked && (
          <span className="mt-0.5 block">
            <MaskedBadge />
          </span>
        )}
      </span>
    </span>
  );
}

export function ActionCell({ item }: { item: Pick<AuditItem, "action" | "newValue"> }) {
  const action = item.action;
  const label = auditItemLabel(item);
  return (
    // Tablo hücresinde `truncate` sütunu daraltmaz; P28c uzun `session.*` adları tabloyu taşırmasın diye kap sınırlı ve satır kırılır
    <span className="flex max-w-44 min-w-0 flex-col">
      <span className="text-fg">{label}</span>
      {label !== action && <span className="font-mono text-xs text-fg-muted wrap-anywhere">{action}</span>}
    </span>
  );
}
