"use client";

import { ChevronRight, ChevronsDown, Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { auditActor, auditItemLabel } from "@/lib/audit/actions";
import type { AuditItem, AuditListResponse } from "@/lib/audit/contract";
import { auditApiPath, type AuditFilters } from "@/lib/audit/query";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { ActionCell, detailLabel, MaskedBadge, ResultBadge, tenantOf, UserCell, who } from "./audit-cells";
import { AuditDetailDialog } from "./audit-detail-dialog";

/** Keyset sayfalama: "Daha fazla yükle" sonraki kayıtları ekler (yinelenen id atlanır); oturum düşmüşse girişe. */
function useAuditMore(initial: AuditListResponse, filters: AuditFilters) {
  const router = useRouter();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  return { items, cursor, busy, error, more };
}

type TableProps = { items: AuditItem[]; showTenant: boolean; onOpen: (a: AuditItem) => void };
const thCls = "px-3 py-3 font-medium";
/** Firma sütunu varken (Super Admin) IP sütunu 2xl altında gizlenir; IP ayrıntı penceresinde ve kartta kalır (1280 px'te kap taşmaz). */
const ipColOf = (showTenant: boolean) => (showTenant ? "hidden 2xl:table-cell" : "");

function AuditHead({ showTenant }: { showTenant: boolean }) {
  return (
    <thead className="bg-surface-muted text-xs text-fg-muted">
      <tr>
        <th scope="col" className={thCls}>
          {t("au.col.time")}
        </th>
        <th scope="col" className={thCls}>
          {t("au.col.user")}
        </th>
        {showTenant && (
          <th scope="col" className={thCls}>
            {t("au.col.tenant")}
          </th>
        )}
        <th scope="col" className={thCls}>
          {t("au.col.action")}
        </th>
        <th scope="col" className={thCls}>
          {t("au.col.entity")}
        </th>
        <th scope="col" className={thCls}>
          {t("au.col.result")}
        </th>
        <th scope="col" className={`${thCls} ${ipColOf(showTenant)}`}>
          {t("au.col.ip")}
        </th>
        <th scope="col" className="sticky right-0 bg-surface-muted px-3 py-3 text-right font-medium">
          <span className="sr-only">{t("au.col.detail")}</span>
        </th>
      </tr>
    </thead>
  );
}

function AuditRow({ a, showTenant, onOpen }: { a: AuditItem; showTenant: boolean; onOpen: (a: AuditItem) => void }) {
  return (
    <tr data-testid="audit-row" className="group hover:bg-surface-muted">
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
        <ActionCell item={a} />
      </td>
      <td className="max-w-36 truncate px-3 py-2 whitespace-nowrap text-fg-muted" title={a.entity}>
        {a.entity}
      </td>
      <td className="px-3 py-2">
        <ResultBadge result={a.result} />
      </td>
      {/* IPv6 / ağ öneki (S-P13a: müşteri kaydında `…/24`, `…::/48`) tabloyu genişletmesin: dar sütunda kırpılır, tam değer title + ayrıntıda */}
      <td
        className={`max-w-32 truncate px-3 py-2 font-mono text-xs whitespace-nowrap text-fg-muted ${ipColOf(showTenant)}`}
        title={a.ipAddress ?? undefined}
      >
        {a.ipAddress ?? "—"}
      </td>
      <td className="sticky right-0 bg-surface px-3 py-1 text-right group-hover:bg-surface-muted">
        <Button variant="ghost" className="px-3" aria-label={detailLabel(a)} onClick={() => onOpen(a)} data-testid="audit-detail-open">
          <Eye aria-hidden className="size-4" />
          <span className="sr-only 2xl:not-sr-only">{t("au.detail")}</span>
        </Button>
      </td>
    </tr>
  );
}

function AuditTable({ items, showTenant, onOpen }: TableProps) {
  return (
    <div className="relative hidden overflow-x-auto rounded-lg border border-border bg-surface lg:block" data-testid="audit-table-box">
      <table className="w-full text-left text-sm" data-testid="audit-table">
        <caption className="sr-only">{t("au.title")}</caption>
        <AuditHead showTenant={showTenant} />
        <tbody className="divide-y divide-border">
          {items.map((a) => (
            <AuditRow key={a.id} a={a} showTenant={showTenant} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditCard({ a, showTenant, onOpen }: { a: AuditItem; showTenant: boolean; onOpen: (a: AuditItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(a)}
      aria-label={detailLabel(a)}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left hover:bg-surface-muted"
    >
      <Avatar name={who(a)} src={a.avatarUrl} size="sm" tombstone={auditActor(a).tombstone} />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          {/* T-P29-2: başlık kesilmez, sarar — "İstemci güncellemesi bulundu/atlandı/…" ayırt edici sonu kart açılmadan görünür */}
          <span className="min-w-0 font-medium break-words text-fg">{auditItemLabel(a)}</span>
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
  );
}

function AuditCards({ items, showTenant, onOpen }: TableProps) {
  return (
    <ul className="flex flex-col gap-2 lg:hidden" data-testid="audit-cards">
      {items.map((a) => (
        <li key={a.id} data-testid="audit-card">
          <AuditCard a={a} showTenant={showTenant} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

/** Sayaç + "Daha fazla yükle"; yükleme hatası satır altında (düğme yeniden dener). */
function AuditFooter({ m }: { m: ReturnType<typeof useAuditMore> }) {
  return (
    <>
      <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className="text-sm text-fg-muted tabular-nums" data-testid="audit-count">
          {t("au.shown", { n: formatNumber(m.items.length) })}
          {!m.cursor && ` · ${t("au.end")}`}
        </p>
        {m.cursor && (
          <Button variant="secondary" loading={m.busy} onClick={m.more} data-testid="audit-more">
            {!m.busy && <ChevronsDown aria-hidden className="size-4" />}
            {t("au.more")}
          </Button>
        )}
      </div>
      {m.error && (
        <div className="mt-3">
          <Alert tone="danger" testId="audit-more-error">
            <p className="font-medium">{t("au.moreFailed")}</p>
            <p className="mt-1">{m.error}</p>
          </Alert>
        </div>
      )}
    </>
  );
}

/**
 * Audit listesi (AC-76): ≥ lg tablo (kap `relative` → sr-only metin kaptan kaçmaz; Ayrıntı sütunu sağa sabit, 2xl altında yalnız ikon), dar ekranda kart; satır başına yalnız "Ayrıntı" (salt okunur — düzenle/sil yok).
 * Sayfalama keyset: "Daha fazla yükle" sonraki 50 kaydı ekler (`nextCursor`); hata satır altında, düğme yeniden dener.
 */
export function AuditLog({ initial, filters, showTenant }: { initial: AuditListResponse; filters: AuditFilters; showTenant: boolean }) {
  const m = useAuditMore(initial, filters);
  const [open, setOpen] = useState<AuditItem | null>(null);
  return (
    <>
      <AuditTable items={m.items} showTenant={showTenant} onOpen={setOpen} />
      <AuditCards items={m.items} showTenant={showTenant} onOpen={setOpen} />
      <AuditFooter m={m} />
      <AuditDetailDialog item={open} onClose={() => setOpen(null)} />
    </>
  );
}
