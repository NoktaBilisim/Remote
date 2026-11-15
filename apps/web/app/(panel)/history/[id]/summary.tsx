import { END_REASON_LABELS, labelOf, SESSION_ENDED_BY_LABELS, SESSION_MODE_LABELS, SESSION_SOURCE_LABELS } from "@remote/contracts/labels";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { formatDateTime, formatDuration } from "@/lib/format";
import { isAnonymized } from "@/lib/history/anonymized";
import { t } from "@/lib/i18n";
import { closedSlaView } from "@/lib/requests/p18";
import { SlaBadge } from "../../requests/request-badges";
import { DurationCell } from "../history-list";
import { none, Rows, type D, type RowList } from "./sections";

/** P8c (AC-179, AC-180): müşteri firma; detaya bağlantı yalnız `customers.view` ile. Müşterisizde boş ("—"). */
function FirmCell({ firm, canCustomers }: { firm: D["customerFirm"]; canCustomers: boolean }) {
  if (!firm) return none;
  if (!canCustomers) return <span data-testid="history-detail-firm">{firm.name}</span>;
  return (
    <Link href={`/customers/${firm.id}`} className="font-medium text-primary hover:underline" data-testid="history-detail-firm">
      {firm.name}
    </Link>
  );
}

const endedByText = (s: D) =>
  s.endedBy
    ? `${labelOf(SESSION_ENDED_BY_LABELS, s.endedBy)}${s.endedBy === "ADMIN" && s.terminatedBy ? ` — ${s.terminatedBy.name}` : ""}`
    : null;

/** Zaman satırları: oluşturma, başlangıç, bitiş (sürüyor / yok), süre. */
const timeRows = (s: D): RowList => [
  ["h.d.created", formatDateTime(s.createdAt)],
  ["h.d.started", s.startedAt ? formatDateTime(s.startedAt) : <span className="text-fg-muted">{t("h.d.notStarted")}</span>],
  ["h.d.ended", s.endedAt ? formatDateTime(s.endedAt) : s.status === "ACTIVE" ? t("h.d.ongoing") : none],
  ["h.d.duration", <DurationCell key="du" s={s} />],
];

/** Müşteri satırları — P13a (AC-197): kişisel alanlar null ise "kayıt yok" değil "Anonimleştirildi". */
const customerRows = (s: D): RowList => {
  const anon = isAnonymized(s);
  return [
    ["h.d.customer", s.customerName ?? <span className="text-fg-muted italic">{t(anon ? "h.anon.customer" : "h.noCustomer")}</span>],
    ["h.d.email", s.customerEmail ?? (anon ? <span className="text-fg-muted italic">{t("h.anon.customer")}</span> : none)],
  ];
};

/** Özet: başlangıç/bitiş/süre, müşteri, sonlandıran (AC-62). */
export function Summary({ s, showTenant, canCustomers = false }: { s: D; showTenant: boolean; canCustomers?: boolean }) {
  const rows: RowList = [
    ["h.d.status", <StatusBadge key="st" status={s.status} />],
    ...timeRows(s),
    ["h.d.mode", s.mode ? labelOf(SESSION_MODE_LABELS, s.mode) : t("h.mode.none")],
    ["h.d.source", labelOf(SESSION_SOURCE_LABELS, s.source)],
    ["h.d.tech", s.technician.name],
    ...(showTenant && s.tenant ? ([["h.d.tenant", s.tenant.name]] as RowList) : []),
    ["h.d.firm", <FirmCell key="cf" firm={s.customerFirm} canCustomers={canCustomers} />],
    ...customerRows(s),
    ["h.d.endedBy", endedByText(s) ?? none],
    ["h.d.endReason", s.endReason ? labelOf(END_REASON_LABELS, s.endReason) : none],
  ];
  return <Rows rows={rows} />;
}

type Req = NonNullable<D["request"]>;

/** P18 (§8b.8, AC-257): SLA hedefi + aşıldı/içinde; SLA'sız talepte satır yok. */
const slaRows = (r: Req): RowList =>
  r.slaDueAt
    ? [
        [
          "rq.sla.target",
          <span key="sla" className="inline-flex flex-wrap items-center gap-2" data-testid="history-request-sla">
            <time dateTime={r.slaDueAt} className="tabular-nums">
              {formatDateTime(r.slaDueAt)}
            </time>
            {r.slaBreached !== null && <SlaBadge view={closedSlaView(r)} />}
          </span>,
        ],
      ]
    : [];

/** P8b (AC-158): "Destek talebi" bölümü — talep zamanı, bekleme (talep→kabul), P18 SLA hedefi + aşıldı/içinde, ad, telefon, e-posta, açıklama (düz metin). */
export function RequestInfo({ r }: { r: Req }) {
  const rows: RowList = [
    ["h.r.created", formatDateTime(r.createdAt)],
    ["h.r.accepted", r.acceptedAt ? formatDateTime(r.acceptedAt) : none],
    ["h.r.wait", r.waitSec !== null ? formatDuration(r.waitSec) : none],
    ...slaRows(r),
    ["h.r.name", r.customerName ?? none],
    ["h.r.phone", r.customerPhone ?? none],
    ["h.r.email", r.customerEmail ?? none],
    [
      "h.r.description",
      r.description ? (
        <span className="whitespace-pre-wrap" data-testid="history-request-description">
          {r.description}
        </span>
      ) : (
        none
      ),
    ],
  ];
  return <Rows rows={rows} />;
}
