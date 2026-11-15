"use client";

import { Inbox, RotateCw, Settings, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRequestNotifier } from "@/components/request-notifier";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { t } from "@/lib/i18n";
import type { RequestSource } from "@remote/contracts/api/requests";
import type { SupportRequestItem } from "@/lib/requests/contract";
import { useNow } from "@/lib/use-now";
import type { AssignedFilter } from "@/lib/requests/p18";
import { AssignDialog, type AssignActions } from "./assign-menu";
import { CardMenuDialogs, useCardMenus } from "./card-dialogs";
import { RejectDialog } from "./reject-dialog";
import { RequestThread } from "./request-thread";
import { RequestCard } from "./request-card";
import { useAcceptFlow, useAssignFlow } from "./use-queue-actions";
import { useQueueList, useQueueLive, useQueueThread, useWide } from "./use-request-queue";

interface QueueProps {
  initial: SupportRequestItem[];
  canAccept: boolean;
  canSettings: boolean;
  /** P8c r2 (§15.2) + B-P8c-3: `customers.edit` ve `support_requests.view`. */
  canRevoke?: boolean;
  /** P15 (AC-235): `support_requests.block` → kart menüsünde "Bu kaynağı engelle". */
  canBlock?: boolean;
  /** P8c (AC-176): müşteri filtresi (`general` | ULID); yenilemelerde de uygulanır. */
  customer?: string;
  /** P18: oturumdaki kullanıcı (atama filtresi, "Bana ata", kabul onayı). */
  meId?: string;
  /** P18 (AC-256): `me` = bana atanan, `none` = atanmamış. */
  assigned?: AssignedFilter;
  /** P19 (AC-259): kaynak filtresi (`AGENT` | `WEB`). */
  source?: RequestSource;
  /** P18 (AC-256, 257): `support_requests.assign` → atama ve öncelik menüsü. */
  canAssign?: boolean;
  /** P18 (AC-255, S-P18-T3): `support_requests.message` → mesaj yazma alanı. */
  canMessage?: boolean;
}

/** Kuyruk ekranının bileşenler arası paylaşılan durumu (RequestQueue kancalarının çıktısı). */
interface Queue {
  p: QueueProps;
  meId: string;
  now: number | null;
  wide: boolean;
  connected: boolean;
  toast: ReturnType<typeof useToast>;
  th: ReturnType<typeof useQueueThread>;
  list: ReturnType<typeof useQueueList>;
  acc: ReturnType<typeof useAcceptFlow>;
  asg: ReturnType<typeof useAssignFlow>;
  menus: ReturnType<typeof useCardMenus>;
}

/**
 * Bekleyen talepler kuyruğu (AC-146, 149, 153, 157): ilk liste sunucudan; /ws/panel olaylarıyla canlı.
 * request.new → liste REST'ten tazelenir (WS önizlemesi telefon/e-posta taşımaz); request.removed → kart düşer;
 * soket yokken 15 sn'de bir yoklama (kısmi durum: son başarılı liste korunur, üstte uyarı).
 */
export function RequestQueue(p: QueueProps) {
  const toast = useToast();
  const now = useNow(1000);
  const wide = useWide();
  const { subscribe, connected } = useRequestNotifier();
  const filter = { customer: p.customer, assigned: p.assigned, source: p.source, meId: p.meId ?? "" };
  const th = useQueueThread();
  const list = useQueueList(p.initial, filter, th);
  useQueueLive(subscribe, connected, list, th, filter);
  const acc = useAcceptFlow(filter.meId, list.drop);
  const asg = useAssignFlow(filter.meId, list.drop, list.replace);
  const menus = useCardMenus();
  const q: Queue = { p, meId: filter.meId, now, wide, connected, toast, th, list, acc, asg, menus };
  return (
    <>
      <QueueMain q={q} />
      <QueueDialogs q={q} />
    </>
  );
}

/** Kısmi durum: son başarılı liste korunur, üstte uyarı + "Tekrar dene". */
function StaleBar({ refreshing, onRetry }: { refreshing: boolean; onRetry: () => void }) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      <Alert tone="warning" testId="queue-stale">
        {t("rq.stale")}
      </Alert>
      <Button variant="secondary" onClick={onRetry} loading={refreshing} className="shrink-0">
        {!refreshing && <RotateCw aria-hidden className="size-4" />}
        {t("err.retry")}
      </Button>
    </div>
  );
}

const emptyLink = "inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline";

/** Boş kuyruk: atama filtresinde "Tüm talepler", değilse (yetki varsa) ayarlara yönlendirme. */
function QueueEmpty({ assigned, customer, canSettings }: { assigned?: AssignedFilter; customer?: string; canSettings: boolean }) {
  return (
    <EmptyState
      Icon={assigned === "me" ? UserCheck : Inbox}
      title={assigned === "me" ? t("rq.as.emptyMine") : assigned === "none" ? t("rq.as.emptyNone") : t("rq.emptyTitle")}
      body={assigned ? t("rq.as.emptyBody") : t("rq.emptyBody")}
      testId="requests-empty"
      action={
        assigned ? (
          <Link href={customer ? `/requests?customer=${encodeURIComponent(customer)}` : "/requests"} className={emptyLink}>
            <Inbox aria-hidden className="size-4" />
            {t("rq.as.all")}
          </Link>
        ) : (
          canSettings && (
            <Link href="/settings/support-requests" className={emptyLink}>
              <Settings aria-hidden className="size-4" />
              {t("rq.emptyAction")}
            </Link>
          )
        )
      }
    />
  );
}

/** Kartın atama/öncelik eylemleri (`support_requests.assign` ve oturum kullanıcısı varsa). */
function assignActions({ p, meId, asg }: Queue, it: SupportRequestItem): AssignActions | undefined {
  if (!(p.canAssign && meId)) return undefined;
  return {
    meId,
    busy: asg.assignBusy === it.id,
    onOpenAssign: () => {
      asg.setAssignError(null);
      asg.setAssigning(it);
    },
    onAssign: (userId) => void asg.assignTo(it, userId),
    onPriority: (pr) => void asg.setPriority(it, pr),
  };
}

function QueueCards({ q }: { q: Queue }) {
  const { p, acc, menus, th } = q;
  return (
    <ol className="flex flex-col gap-4" aria-label={t("rq.listLabel")}>
      {q.list.items.map((it) => (
        <li key={it.id}>
          <RequestCard
            item={it}
            now={q.now}
            canAccept={p.canAccept}
            busy={acc.busyId === it.id}
            onAccept={() => acc.requestAccept(it)}
            onReject={() => acc.setRejecting(it)}
            onRevokeBinding={p.canRevoke ? () => menus.setRevoking(it) : undefined}
            onBlock={p.canBlock ? () => menus.setBlocking(it) : undefined}
            meId={q.meId}
            offsetMs={q.list.offsetMs}
            assign={assignActions(q, it)}
            onThread={() => th.openThread(it)}
            unread={th.unread[it.id] ?? 0}
          />
        </li>
      ))}
    </ol>
  );
}

/** Kabul öncesi yazışma (AC-255): geniş ekranda sağ panel, dar ekranda diyalog. */
function threadView({ p, th, connected }: Queue) {
  const { thread } = th;
  return (
    thread && (
      <RequestThread
        key={thread.id}
        requestId={thread.id}
        customerName={thread.name}
        canSend={p.canMessage ?? false}
        closed={thread.closed}
        activity={th.activity[thread.id] ?? 0}
        connected={connected}
        onClose={() => th.setThread(null)}
        headingLevel={2}
      />
    )
  );
}

function QueueMain({ q }: { q: Queue }) {
  const { list, th, wide } = q;
  const view = threadView(q);
  return (
    <>
      {list.stale && <StaleBar refreshing={list.refreshing} onRetry={() => void list.refresh()} />}
      <p className="sr-only" aria-live="polite" data-testid="queue-count-live">
        {t("rq.countLive", { n: list.items.length })}
      </p>
      <div className={th.thread && wide ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]" : ""}>
        <div className="min-w-0">
          {list.items.length === 0 ? (
            <QueueEmpty assigned={q.p.assigned} customer={q.p.customer} canSettings={q.p.canSettings} />
          ) : (
            <QueueCards q={q} />
          )}
        </div>
        {th.thread && wide && (
          <aside
            aria-label={t("th.panel")}
            className="rounded-lg border border-border bg-surface p-4 shadow-sm lg:sticky lg:top-20"
            data-testid="thread-panel"
          >
            {view}
          </aside>
        )}
      </div>
      {!wide && (
        <Dialog open={th.thread !== null} onClose={() => th.setThread(null)} testId="thread-dialog" title={t("th.panel")}>
          {view}
        </Dialog>
      )}
    </>
  );
}

/** K-P18-3: başkasına atanmış talebi kabul onayı. */
function AcceptAssignedDialog({ acc }: { acc: Queue["acc"] }) {
  const { confirmAccept, setConfirmAccept } = acc;
  return (
    <Dialog
      open={confirmAccept !== null}
      onClose={() => setConfirmAccept(null)}
      size="sm"
      role="alertdialog"
      testId="accept-assigned-dialog"
      title={t("rq.as.confirmTitle")}
      description={confirmAccept?.assignedTo ? t("rq.as.confirmBody", { name: confirmAccept.assignedTo.name }) : undefined}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={() => setConfirmAccept(null)} className="sm:ml-auto">
            {t("rq.rj.cancel")}
          </Button>
          <Button onClick={() => confirmAccept && void acc.accept(confirmAccept)} data-testid="accept-assigned-confirm">
            <UserCheck aria-hidden className="size-4" />
            {t("rq.as.confirmAccept")}
          </Button>
        </>
      }
    />
  );
}

function QueueDialogs({ q }: { q: Queue }) {
  const { asg, acc, list, toast } = q;
  const { assigning } = asg;
  return (
    <>
      <AssignDialog
        item={assigning}
        busy={assigning !== null && asg.assignBusy === assigning.id}
        error={asg.assignError}
        onClose={() => asg.setAssigning(null)}
        onSubmit={(userId) => assigning && void asg.assignTo(assigning, userId, true)}
      />
      <AcceptAssignedDialog acc={acc} />
      <RejectDialog
        item={acc.rejecting}
        onClose={() => acc.setRejecting(null)}
        onDone={(id) => {
          acc.setRejecting(null);
          list.drop(id);
          toast(t("rq.rj.done"));
        }}
        onGone={(id, code) => {
          acc.setRejecting(null);
          list.drop(id);
          toast(code === "REQUEST_TAKEN" ? t("rq.err.taken") : t("rq.err.closed"), "danger");
        }}
      />
      <CardMenuDialogs menus={q.menus} onRemoved={list.drop} onRefresh={() => void list.refresh()} />
    </>
  );
}
