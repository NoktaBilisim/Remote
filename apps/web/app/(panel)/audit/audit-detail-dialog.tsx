"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  auditClientOs,
  auditItemLabel,
  auditPayload,
  clientUpdateReasonLabel,
  CLIENT_OS_FIELD_LABEL,
  reasonLabel,
} from "@/lib/audit/actions";
import type { AuditItem } from "@/lib/audit/contract";
import { formatDateTime, formatTimeSeconds } from "@/lib/format";
import { t } from "@/lib/i18n";
import { ActionCell, ResultBadge, tenantOf, UserCell } from "./audit-cells";

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium text-fg-muted sm:text-sm">{term}</dt>
      <dd className="min-w-0 text-sm break-words text-fg">{children}</dd>
    </div>
  );
}

/** Değer bloğu: JSON yalnız metin düğümü olarak `<pre>`'ye basılır (HTML olarak YORUMLANMAZ). */
function ValueBlock({ title, value, testId }: { title: string; value: string | null; testId: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      {value === null ? (
        <p className="text-sm text-fg-muted">{t("au.d.empty")}</p>
      ) : (
        <pre
          tabIndex={0}
          data-testid={testId}
          className="max-h-64 overflow-auto rounded-md border border-border bg-canvas p-3 font-mono text-xs whitespace-pre-wrap break-all text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          {value}
        </pre>
      )}
    </section>
  );
}

/** Kayıt alanları: zaman, kullanıcı, firma, işlem, varlık, sonuç, IP, tarayıcı, kimlik. */
function DetailRows({ item }: { item: AuditItem }) {
  return (
    <dl className="flex flex-col gap-2">
      <Row term={t("au.col.time")}>
        <time dateTime={item.createdAt} className="tabular-nums">
          {formatDateTime(item.createdAt)} ({formatTimeSeconds(item.createdAt)})
        </time>
      </Row>
      <Row term={t("au.col.user")}>
        <UserCell a={item} />
      </Row>
      {tenantOf(item) && <Row term={t("au.col.tenant")}>{tenantOf(item)}</Row>}
      <Row term={t("au.col.action")}>
        <ActionCell item={item} />
      </Row>
      <Row term={t("au.col.entity")}>{item.entity}</Row>
      {item.entityId && (
        <Row term={t("au.d.entityId")}>
          <span className="font-mono text-xs">{item.entityId}</span>
        </Row>
      )}
      <Row term={t("au.col.result")}>
        <ResultBadge result={item.result} />
      </Row>
      <Row term={t("au.col.ip")}>
        <span className="font-mono text-xs">{item.ipAddress ?? "—"}</span>
      </Row>
      {auditClientOs(item) && (
        <Row term={CLIENT_OS_FIELD_LABEL}>
          <span data-testid="audit-client-os">{auditClientOs(item)}</span>
        </Row>
      )}
      {clientUpdateReasonLabel(item) && (
        <Row term={t("au.d.reason")}>
          <span data-testid="audit-update-reason">{clientUpdateReasonLabel(item)}</span>
        </Row>
      )}
      {item.userAgent && (
        <Row term={t("au.d.ua")}>
          <span className="text-xs">{item.userAgent}</span>
        </Row>
      )}
      <Row term={t("au.d.id")}>
        <span className="font-mono text-xs">{item.id}</span>
      </Row>
    </dl>
  );
}

/** Gönderim kaydı: yalnız neden (etiket + ham kod) ve posta notu. */
function ReasonBlock({ reason }: { reason: string | null }) {
  return (
    <section aria-label={t("au.d.reason")} className="flex flex-col gap-2" data-testid="audit-detail-reason">
      <dl>
        <Row term={t("au.d.reason")}>
          {reason === null ? (
            <span className="text-fg-muted">{t("au.d.noReason")}</span>
          ) : (
            <span className="flex min-w-0 flex-col" data-testid="audit-reason">
              <span>{reasonLabel(reason)}</span>
              {reasonLabel(reason) !== reason && <span className="font-mono text-xs text-fg-muted">{reason}</span>}
            </span>
          )}
        </Row>
      </dl>
      <p className="flex items-start gap-2 text-xs text-fg-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t("au.d.mailNote")}
      </p>
    </section>
  );
}

function DetailBody({ item }: { item: AuditItem }) {
  const payload = auditPayload(item);
  return (
    <div className="flex flex-col gap-4">
      {item.identityMasked && (
        <Alert tone="info" testId="audit-masked-note">
          {t("au.d.maskedNote")}
        </Alert>
      )}
      <DetailRows item={item} />
      {payload.kind === "reason" ? (
        <ReasonBlock reason={payload.reason} />
      ) : (
        <>
          <ValueBlock title={t("au.d.old")} value={payload.oldValue} testId="audit-old" />
          <ValueBlock title={t("au.d.new")} value={payload.newValue} testId="audit-new" />
        </>
      )}
      <p className="text-xs text-fg-muted">{t("au.d.readonly")}</p>
    </div>
  );
}

export function AuditDetailDialog({ item, onClose }: { item: AuditItem | null; onClose: () => void }) {
  return (
    <Dialog
      open={item !== null}
      onClose={onClose}
      title={t("au.d.title")}
      description={item ? `${auditItemLabel(item)} · ${formatDateTime(item.createdAt)}` : undefined}
      testId="audit-detail"
      footer={
        <Button variant="secondary" className="sm:ml-auto" onClick={onClose} data-autofocus>
          {t("d.close")}
        </Button>
      }
    >
      {item && <DetailBody item={item} />}
    </Dialog>
  );
}
