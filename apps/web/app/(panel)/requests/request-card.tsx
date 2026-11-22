"use client";

import { Ellipsis, Info, MessageSquare, ShieldBan, ShieldOff, UserCheck, UserX } from "lucide-react";
import { labelOf, REQUEST_STATUS_LABELS } from "@remote/contracts/labels";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { closeMenu, Menu } from "@/components/ui/menu";
import { t } from "@/lib/i18n";
import { REQUEST_VERIFY_HINT, type RequestStatus, type SupportRequestItem } from "@/lib/requests/contract";
import { AssignMenuItems, type AssignActions } from "./assign-menu";
import { CardFacts, ClosedInfo, P18Badges, RequestCode, SourceIndicator } from "./request-card-parts";

const STATUS_PILL: Record<RequestStatus, string> = {
  PENDING: "bg-accent-surface text-accent-fg",
  ACCEPTED: "bg-success-surface text-success",
  CANCELLED: "bg-surface-muted text-fg-muted",
  EXPIRED: "bg-surface-muted text-fg-muted",
  REJECTED: "bg-danger-surface text-danger",
  CONNECT_FAILED: "bg-warning-surface text-warning",
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span
      data-testid="request-status"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_PILL[status]}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {labelOf(REQUEST_STATUS_LABELS, status)}
    </span>
  );
}

interface RequestCardProps {
  item: SupportRequestItem;
  now?: number | null;
  canAccept?: boolean;
  busy?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  /** P8c r2 (§15.2): verilirse ve kayıt etkinse kart menüsünde "Bu bilgisayarın kaydını iptal et" (`customers.edit` + `support_requests.view`). */
  onRevokeBinding?: () => void;
  /** P15 (AC-235): verilirse kart menüsünde "Bu kaynağı engelle" (`support_requests.block`). */
  onBlock?: () => void;
  /** P18: oturumdaki kullanıcı ("Size atandı" çipi, "Bana ata"). */
  meId?: string;
  /** P18: sunucu saati ofseti (SLA sayacı). */
  offsetMs?: number;
  /** P18 (AC-256, 257): verilirse menüde atama/öncelik öğeleri (`support_requests.assign`). */
  assign?: AssignActions;
  /** P18 (AC-255): verilirse "Mesajlar" düğmesi (kabul öncesi yazışma paneli). */
  onThread?: () => void;
  unread?: number;
}

const dangerItem =
  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-3 text-left text-sm text-danger hover:bg-danger-surface";

/** Kart menüsü öğesi: menüyü kapatır, sonra eylemi çalıştırır. */
function DangerItem({ testId, Icon, label, onRun }: { testId: string; Icon: typeof ShieldBan; label: string; onRun: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        closeMenu(e.currentTarget);
        onRun();
      }}
      data-testid={testId}
      className={dangerItem}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {label}
    </button>
  );
}

/** "Diğer" menüsü (atama/öncelik, engelle, kaydı iptal et); öğe yoksa null. Bileşen değil, öğe üretir (ağaç aynı). */
function cardMenu(p: RequestCardProps, name: string, pending: boolean): ReactNode {
  const { item, onRevokeBinding, onBlock, assign } = p;
  const canRevoke = Boolean(onRevokeBinding && item.viaBinding);
  const assignItems = pending && assign ? <AssignMenuItems item={item} actions={assign} /> : null;
  if (!(canRevoke || onBlock || assignItems)) return null;
  return (
    <Menu
      label={t("rq.more")}
      icon={<Ellipsis aria-hidden className="size-4" />}
      align="end"
      testId="request-menu"
      panelLabel={t("rq.moreFor", { name })}
    >
      {assignItems}
      {assignItems && (onBlock || canRevoke) && <div aria-hidden className="my-1 border-t border-border" />}
      {onBlock && <DangerItem testId="request-block" Icon={ShieldBan} label={t("bl.rq.open")} onRun={onBlock} />}
      {canRevoke && (
        <DangerItem testId="request-revoke-binding" Icon={ShieldOff} label={t("rq.revoke.open")} onRun={() => onRevokeBinding?.()} />
      )}
    </Menu>
  );
}

/** "Mesajlar" düğmesi + okunmamış sayısı. */
function ThreadButton({ name, unread, onClick }: { name: string; unread: number; onClick: () => void }) {
  return (
    <Button
      variant="secondary"
      onClick={onClick}
      aria-label={unread > 0 ? t("th.openUnread", { name, n: unread }) : t("th.openFor", { name })}
      data-testid="thread-open"
      className="shrink-0"
    >
      <MessageSquare aria-hidden className="size-4" />
      {t("th.open")}
      {unread > 0 && (
        <span
          data-testid="thread-unread"
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-on-primary tabular-nums"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Button>
  );
}

/** Bekleyen talep alt çubuğu: doğrulama ipucu, mesajlar, menü, reddet/kabul et. */
function PendingBar({ p, name, menu }: { p: RequestCardProps; name: string; menu: ReactNode }) {
  const busy = p.busy ?? false;
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
      <p className="flex min-w-0 flex-1 items-start gap-2 text-sm text-fg-muted" data-testid="request-hint">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        {REQUEST_VERIFY_HINT}
      </p>
      {p.onThread && <ThreadButton name={name} unread={p.unread ?? 0} onClick={p.onThread} />}
      {menu}
      {(p.canAccept ?? false) && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="secondary" onClick={p.onReject} disabled={busy} aria-label={t("rq.rejectFor", { name })}>
            <UserX aria-hidden className="size-4" />
            {t("rq.reject")}
          </Button>
          <Button onClick={p.onAccept} loading={busy} aria-label={t("rq.acceptFor", { name })}>
            {!busy && <UserCheck aria-hidden className="size-4" />}
            {t("rq.accept")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Kartın sol sütunu: ad + durum, P18 rozetleri, bilgiler, açıklama, kapanış bilgisi. */
function CardMain({ p, name, titleId, pending }: { p: RequestCardProps; name: string; titleId: string; pending: boolean }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id={titleId} className="text-base font-semibold text-fg wrap-anywhere">
          {name}
        </h3>
        {!pending && <RequestStatusBadge status={p.item.status} />}
      </div>
      <P18Badges item={p.item} pending={pending} now={p.now ?? null} meId={p.meId} offsetMs={p.offsetMs ?? 0} />
      <CardFacts item={p.item} pending={pending} now={p.now} />
      <p
        className="mt-3 rounded-md bg-canvas px-3 py-2 text-sm whitespace-pre-wrap text-fg wrap-anywhere"
        data-testid="request-description"
      >
        {p.item.description ?? t("rq.noDescription")}
      </p>
      {!pending && <ClosedInfo item={p.item} />}
    </div>
  );
}

/** Talep kartı (AC-146): ad, telefon, e-posta, açıklama düz metin (React metin düğümü — bağlantıya çevrilmez). */
export function RequestCard(p: RequestCardProps) {
  const { item } = p;
  const pending = item.status === "PENDING";
  const name = item.customerName ?? t("rq.anon");
  const titleId = `talep-${item.id}-t`;
  const menu = cardMenu(p, name, pending);
  return (
    <article
      id={`talep-${item.id}`}
      aria-labelledby={titleId}
      data-testid="request-card"
      data-status={item.status}
      className="scroll-mt-24 rounded-lg border border-border bg-surface p-4 shadow-sm target:ring-2 target:ring-ring sm:p-5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <CardMain p={p} name={name} titleId={titleId} pending={pending} />
        <div className="flex shrink-0 flex-col gap-3 lg:w-64">
          <RequestCode code={item.requestCode} />
          <SourceIndicator item={item} />
        </div>
      </div>
      {pending && <PendingBar p={p} name={name} menu={menu} />}
      {!pending && menu && <div className="mt-4 flex justify-end border-t border-border pt-4">{menu}</div>}
    </article>
  );
}
