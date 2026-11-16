import type { SessionListItem } from "@remote/contracts/api/sessions";
import { labelOf, SESSION_MODE_LABELS, SESSION_SOURCE_LABELS } from "@remote/contracts/labels";
import { ChevronRight, Video } from "lucide-react";
import Link from "next/link";
import { AnonymizedBadge, StatusBadge } from "@/components/ui/badge";
import { formatDateTime, formatDuration } from "@/lib/format";
import { isAnonymized } from "@/lib/history/anonymized";
import { t } from "@/lib/i18n";
import { LiveDuration } from "./live-duration";

interface Props {
  items: SessionListItem[];
  showTechnician: boolean;
  showTenant: boolean;
}

export function DurationCell({ s }: { s: Pick<SessionListItem, "status" | "startedAt" | "durationSec"> }) {
  if (s.durationSec !== null) return <>{formatDuration(s.durationSec)}</>;
  if (s.status === "ACTIVE" && s.startedAt) return <LiveDuration startedAt={s.startedAt} />;
  return <span className="text-fg-muted">—</span>;
}

/** P13a (AC-197): anonimleştirilmiş oturumda ad yerine "Anonimleştirildi" rozeti (ad sunucudan zaten null gelir). */
const customer = (s: SessionListItem) =>
  isAnonymized(s) ? <AnonymizedBadge /> : (s.customerName ?? <span className="text-fg-muted italic">{t("h.noCustomer")}</span>);
const mode = (s: SessionListItem) => (s.mode ? labelOf(SESSION_MODE_LABELS, s.mode) : t("h.mode.none"));
/** P8b (AC-158): talepten doğan oturumda kaynak + bekleme süresi (TECH'te gösterilmez — varsayılan yol). */
function SourceNote({ s, compact = false }: { s: Pick<SessionListItem, "source" | "waitSec">; compact?: boolean }) {
  if (s.source !== "REQUEST") return null;
  const wait = s.waitSec !== null ? t("h.waitShort", { d: formatDuration(s.waitSec) }) : null;
  return (
    <span
      data-testid="history-source"
      title={wait ?? undefined}
      className="inline-flex items-center gap-1 rounded-full bg-primary-surface px-2 py-0.5 text-xs font-medium whitespace-nowrap text-primary"
    >
      {labelOf(SESSION_SOURCE_LABELS, s.source)}
      {wait && <span className={compact ? "sr-only" : "font-normal"}>· {wait}</span>}
    </span>
  );
}

/**
 * P28e (§9): kayıt işareti — kayıtlı oturumda `Video` ikonu (`aria-label`), aksi boş. Tabloda ayrı sütun değil, Süre
 * hücresinde sürenin solunda (K10: SUPER_ADMIN 1280 px'te ayrı sütun tabloyu taşırıyordu — TEST-P8-2); kartta durum rozetinin yanında.
 */
function RecMark({ s }: { s: Pick<SessionListItem, "hasRecording"> }) {
  if (!s.hasRecording) return null;
  return (
    <span role="img" aria-label={t("h.rec.has")} title={t("h.rec.has")} data-testid="history-rec" className="inline-flex text-primary">
      <Video aria-hidden className="size-4" />
    </span>
  );
}

const detailLabel = (s: SessionListItem) => t("h.open", { name: s.customerName ?? formatDateTime(s.createdAt) });

/** Oturum geçmişi: ≥ md tablo, dar ekranda kart (aynı veri). Satırın tamamı değil, müşteri adı bağlantıdır (klavye/ekran okuyucu tek hedef). */
export function HistoryList({ items, showTechnician, showTenant }: Props) {
  // P8c (AC-179): "Müşteri firma" sütunu sayfada müşterili oturum varsa görünür (müşterisiz satırda boş); kart/detay/CSV her zaman taşır.
  const showFirm = items.some((s) => s.customerFirm);
  // Firma sütunu da açıkken (SUPER_ADMIN) < 2xl'de en az öncelikli "Bağlantı" gizlenir; tablo kaba sığar (TEST-P8-2).
  // Bağlantı filtresi, kart görünümü ve ayrıntı sayfası bu bilgiyi göstermeye devam eder.
  const modeCol = showTenant ? "hidden 2xl:table-cell" : "";
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
        <table className="w-full text-left text-sm" data-testid="history-table">
          <caption className="sr-only">{t("h.title")}</caption>
          <thead className="bg-surface-muted text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("h.col.created")}
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("h.col.customer")}
              </th>
              {showFirm && (
                <th scope="col" className="px-3 py-3 font-medium">
                  {t("h.col.firm")}
                </th>
              )}
              {showTenant && (
                <th scope="col" className="px-3 py-3 font-medium">
                  {t("h.col.tenant")}
                </th>
              )}
              {showTechnician && (
                <th scope="col" className="px-3 py-3 font-medium">
                  {t("h.col.tech")}
                </th>
              )}
              <th scope="col" className="px-3 py-3 font-medium">
                {t("h.col.status")}
              </th>
              <th scope="col" className={`px-3 py-3 font-medium ${modeCol}`}>
                {t("h.col.mode")}
              </th>
              <th scope="col" className="px-3 py-3 text-right font-medium">
                {t("h.col.duration")}
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                {t("h.col.ticket")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((s) => (
              <tr key={s.id} data-testid="history-row" className="hover:bg-surface-muted">
                <td className="px-3 py-2 whitespace-nowrap tabular-nums text-fg">{formatDateTime(s.createdAt)}</td>
                <td className="max-w-56 px-3 py-2">
                  <Link
                    href={`/history/${s.id}`}
                    aria-label={detailLabel(s)}
                    className="inline-flex min-h-11 max-w-full items-center font-medium text-primary hover:underline"
                  >
                    <span className="truncate">{customer(s)}</span>
                  </Link>
                </td>
                {showFirm && (
                  <td
                    className="max-w-40 truncate px-3 py-2 whitespace-nowrap text-fg"
                    title={s.customerFirm?.name}
                    data-testid="history-firm"
                  >
                    {s.customerFirm?.name ?? ""}
                  </td>
                )}
                {showTenant && (
                  <td className="max-w-36 truncate px-3 py-2 whitespace-nowrap text-fg" title={s.tenant?.name}>
                    {s.tenant?.name ?? "—"}
                  </td>
                )}
                {showTechnician && (
                  <td className="max-w-36 truncate px-3 py-2 whitespace-nowrap text-fg" title={s.technician.name}>
                    {s.technician.name}
                  </td>
                )}
                <td className="px-3 py-2">
                  <StatusBadge status={s.status} />
                </td>
                <td className={`px-3 py-2 whitespace-nowrap text-fg ${modeCol}`}>
                  <div className="flex flex-col items-start gap-1">
                    {mode(s)}
                    <SourceNote s={s} compact />
                  </div>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-fg">
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <RecMark s={s} />
                    <DurationCell s={s} />
                  </span>
                </td>
                <td className="max-w-32 truncate px-3 py-2 whitespace-nowrap text-fg" title={s.ticketNo ?? undefined}>
                  {s.ticketNo ?? <span className="text-fg-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden" data-testid="history-cards">
        {items.map((s) => (
          <li key={s.id} data-testid="history-card">
            <Link
              href={`/history/${s.id}`}
              aria-label={detailLabel(s)}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 hover:bg-surface-muted"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-fg">{customer(s)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <RecMark s={s} />
                    <StatusBadge status={s.status} />
                  </span>
                </div>
                {s.source === "REQUEST" && (
                  <div className="mt-1">
                    <SourceNote s={s} />
                  </div>
                )}
                <p className="mt-1 text-xs tabular-nums text-fg-muted">
                  {formatDateTime(s.createdAt)} · {mode(s)} · <DurationCell s={s} />
                </p>
                {(showTechnician || showTenant || s.ticketNo || s.customerFirm) && (
                  <p className="mt-1 truncate text-xs text-fg-muted">
                    {[
                      s.customerFirm?.name ?? null,
                      showTenant ? s.tenant?.name : null,
                      showTechnician ? s.technician.name : null,
                      s.ticketNo ? `#${s.ticketNo}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
