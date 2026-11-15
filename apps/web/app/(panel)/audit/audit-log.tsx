"use client";

import { ChevronRight, ChevronsDown, Eye, EyeOff, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { actionLabel, auditActor, auditPayload, reasonLabel } from "@/lib/audit/actions";
import { AUDIT_RESULT_LABELS, type AuditItem, type AuditListResponse, type AuditResult } from "@/lib/audit/contract";
import { auditApiPath, type AuditFilters } from "@/lib/audit/query";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { formatDateTime, formatNumber, formatTimeSeconds } from "@/lib/format";
import { t } from "@/lib/i18n";

const who = (a: AuditItem) => auditActor(a).name ?? t("au.system");
/** P16: firma etiketi — silinmiş firmada "Silinmiş firma #…" (sunucu üretir). */
const tenantOf = (a: AuditItem) => a.tenantLabel ?? a.tenantName;

/** P16 (S16-1): kimlik maskesi uygulanmış satır rozeti (nötr; metin + ikon). */
function MaskedBadge() {
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

function UserCell({ a }: { a: AuditItem }) {
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

function ActionCell({ action }: { action: string }) {
  const label = actionLabel(action);
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-fg" title={label}>
        {label}
      </span>
      {label !== action && (
        <span className="truncate font-mono text-xs text-fg-muted" title={action}>
          {action}
        </span>
      )}
    </span>
  );
}

const detailLabel = (a: AuditItem) => t("au.detailOf", { action: actionLabel(a.action), time: formatDateTime(a.createdAt) });

/**
 * Audit listesi (AC-76): ≥ lg tablo (kap `relative` → sr-only metin kaptan kaçmaz; Ayrıntı sütunu sağa sabit, 2xl altında yalnız ikon), dar ekranda kart; satır başına yalnız "Ayrıntı" (salt okunur — düzenle/sil yok).
 * Sayfalama keyset: "Daha fazla yükle" sonraki 50 kaydı ekler (`nextCursor`); hata satır altında, düğme yeniden dener.
 */
export function AuditLog({ initial, filters, showTenant }: { initial: AuditListResponse; filters: AuditFilters; showTenant: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AuditItem | null>(null);

  const more = async () => {
    if (!cursor || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<AuditListResponse>("GET", auditApiPath(filters, cursor));
      setItems((x) => [...x, ...r.items.filter((n) => !x.some((o) => o.id === n.id))]);
      setCursor(r.nextCursor);
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setError(toUiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  // Firma sütunu varken (Super Admin) IP sütunu 2xl altında gizlenir; IP ayrıntı penceresinde ve kartta kalır (1280 px'te kap taşmaz)
  const ipCol = showTenant ? "hidden 2xl:table-cell" : "";

  const detailBtn = (a: AuditItem) => (
    <Button variant="ghost" className="px-3" aria-label={detailLabel(a)} onClick={() => setOpen(a)} data-testid="audit-detail-open">
      <Eye aria-hidden className="size-4" />
      <span className="sr-only 2xl:not-sr-only">{t("au.detail")}</span>
    </Button>
  );

  return (
    <>
      <div className="relative hidden overflow-x-auto rounded-lg border border-border bg-surface lg:block" data-testid="audit-table-box">
        <table className="w-full text-left text-sm" data-testid="audit-table">
          <caption className="sr-only">{t("au.title")}</caption>
          <thead className="bg-surface-muted text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("au.col.time")}
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("au.col.user")}
              </th>
              {showTenant && (
                <th scope="col" className="px-3 py-3 font-medium">
                  {t("au.col.tenant")}
                </th>
              )}
              <th scope="col" className="px-3 py-3 font-medium">
                {t("au.col.action")}
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("au.col.entity")}
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("au.col.result")}
              </th>
              <th scope="col" className={`px-3 py-3 font-medium ${ipCol}`}>
                {t("au.col.ip")}
              </th>
              <th scope="col" className="sticky right-0 bg-surface-muted px-3 py-3 text-right font-medium">
                <span className="sr-only">{t("au.col.detail")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((a) => (
              <tr key={a.id} data-testid="audit-row" className="group hover:bg-surface-muted">
                <td className="px-3 py-2 whitespace-nowrap tabular-nums text-fg">
                  <time dateTime={a.createdAt}>{formatDateTime(a.createdAt)}</time>
                </td>
                <td className="max-w-48 px-3 py-2">
                  <UserCell a={a} />
                </td>
                {showTenant && (
                  <td className="max-w-36 truncate px-3 py-2 whitespace-nowrap text-fg" title={tenantOf(a) ?? undefined}>
                    {tenantOf(a) ?? <span className="text-fg-muted">—</span>}
                  </td>
                )}
                <td className="max-w-60 px-3 py-2">
                  <ActionCell action={a.action} />
                </td>
                <td className="max-w-36 truncate px-3 py-2 whitespace-nowrap text-fg-muted" title={a.entity}>
                  {a.entity}
                </td>
                <td className="px-3 py-2">
                  <ResultBadge result={a.result} />
                </td>
                {/* IPv6 / ağ öneki (S-P13a: müşteri kaydında `…/24`, `…::/48`) tabloyu genişletmesin: dar sütunda kırpılır, tam değer title + ayrıntıda */}
                <td
                  className={`max-w-32 truncate px-3 py-2 font-mono text-xs whitespace-nowrap text-fg-muted ${ipCol}`}
                  title={a.ipAddress ?? undefined}
                >
                  {a.ipAddress ?? "—"}
                </td>
                <td className="sticky right-0 bg-surface px-3 py-1 text-right group-hover:bg-surface-muted">{detailBtn(a)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 lg:hidden" data-testid="audit-cards">
        {items.map((a) => (
          <li key={a.id} data-testid="audit-card">
            <button
              type="button"
              onClick={() => setOpen(a)}
              aria-label={detailLabel(a)}
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left hover:bg-surface-muted"
            >
              <Avatar name={who(a)} src={a.avatarUrl} size="sm" tombstone={auditActor(a).tombstone} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-fg">{actionLabel(a.action)}</span>
                  <ResultBadge result={a.result} />
                </span>
                <span className="mt-1 block truncate text-xs text-fg-muted">
                  {[who(a), showTenant ? tenantOf(a) : null, a.entity].filter(Boolean).join(" · ")}
                </span>
                {a.identityMasked && (
                  <span className="mt-1 block">
                    <MaskedBadge />
                  </span>
                )}
                <span className="mt-0.5 block text-xs tabular-nums text-fg-muted">
                  {formatDateTime(a.createdAt)}
                  {a.ipAddress ? ` · ${a.ipAddress}` : ""}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-muted" />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className="text-sm text-fg-muted tabular-nums" data-testid="audit-count">
          {t("au.shown", { n: formatNumber(items.length) })}
          {!cursor && ` · ${t("au.end")}`}
        </p>
        {cursor && (
          <Button variant="secondary" loading={busy} onClick={more} data-testid="audit-more">
            {!busy && <ChevronsDown aria-hidden className="size-4" />}
            {t("au.more")}
          </Button>
        )}
      </div>
      {error && (
        <div className="mt-3">
          <Alert tone="danger" testId="audit-more-error">
            <p className="font-medium">{t("au.moreFailed")}</p>
            <p className="mt-1">{error}</p>
          </Alert>
        </div>
      )}

      <AuditDetailDialog item={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
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

function AuditDetailDialog({ item, onClose }: { item: AuditItem | null; onClose: () => void }) {
  const payload = item ? auditPayload(item) : null;
  return (
    <Dialog
      open={item !== null}
      onClose={onClose}
      title={t("au.d.title")}
      description={item ? `${actionLabel(item.action)} · ${formatDateTime(item.createdAt)}` : undefined}
      testId="audit-detail"
      footer={
        <Button variant="secondary" className="sm:ml-auto" onClick={onClose} data-autofocus>
          {t("d.close")}
        </Button>
      }
    >
      {item && payload && (
        <div className="flex flex-col gap-4">
          {item.identityMasked && (
            <Alert tone="info" testId="audit-masked-note">
              {t("au.d.maskedNote")}
            </Alert>
          )}
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
              <ActionCell action={item.action} />
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
            {item.userAgent && (
              <Row term={t("au.d.ua")}>
                <span className="text-xs">{item.userAgent}</span>
              </Row>
            )}
            <Row term={t("au.d.id")}>
              <span className="font-mono text-xs">{item.id}</span>
            </Row>
          </dl>
          {payload.kind === "reason" ? (
            <section aria-label={t("au.d.reason")} className="flex flex-col gap-2" data-testid="audit-detail-reason">
              <dl>
                <Row term={t("au.d.reason")}>
                  {payload.reason === null ? (
                    <span className="text-fg-muted">{t("au.d.noReason")}</span>
                  ) : (
                    <span className="flex min-w-0 flex-col" data-testid="audit-reason">
                      <span>{reasonLabel(payload.reason)}</span>
                      {reasonLabel(payload.reason) !== payload.reason && (
                        <span className="font-mono text-xs text-fg-muted">{payload.reason}</span>
                      )}
                    </span>
                  )}
                </Row>
              </dl>
              <p className="flex items-start gap-2 text-xs text-fg-muted">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t("au.d.mailNote")}
              </p>
            </section>
          ) : (
            <>
              <ValueBlock title={t("au.d.old")} value={payload.oldValue} testId="audit-old" />
              <ValueBlock title={t("au.d.new")} value={payload.newValue} testId="audit-new" />
            </>
          )}
          <p className="text-xs text-fg-muted">{t("au.d.readonly")}</p>
        </div>
      )}
    </Dialog>
  );
}
