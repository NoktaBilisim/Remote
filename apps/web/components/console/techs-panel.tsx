"use client";

import type { OutgoingInvite, OutgoingInvitesResponse } from "@remote/contracts/api/multi";
import type { TechRosterEntry } from "@remote/contracts/ws-multi";
import { INVITE_POLL_MS, MAX_TECHS } from "@remote/contracts/ws-multi";
import { ArrowRightLeft, ChevronDown, LogOut, MousePointer2, Undo2, UserPlus, Users, WifiOff, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH } from "@/lib/api";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import { multiUiError, multiWsMessage } from "@/lib/multi/errors";
import { ROLE_LABEL_KEY, sortedRoster, type Seat } from "@/lib/multi/roster";
import type { useTechSession } from "@/lib/webrtc/use-tech-session";
import { InviteDialog } from "./invite-dialog";

type Tech = ReturnType<typeof useTechSession>;

/** Gönderilen bir devir/ayrılma komutundan sonra 5 sn içinde gelen `error{}` toast olur (WS hatası istek kimliği taşımaz). */
function useActionErrors(ts: Tech) {
  const toast = useToast();
  const since = useRef(0);
  useEffect(
    () =>
      ts.subscribe((m) => {
        if (m.t === "error" && Date.now() - since.current < 5_000) {
          since.current = 0;
          toast(t("mt.actionFailed", { message: multiWsMessage(m.code, m.message) }), "danger");
        }
      }),
    [ts, toast],
  );
  return useCallback(() => void (since.current = Date.now()), []);
}

/**
 * Bekleyen giden davetler (K1c `GET /sessions/:id/invites`, AC-364): sunucu listesi tek doğru kaynak — sayfa yenilenince de
 * görünür, devirde yeni sahip görür. Yoklama davet bildirimiyle aynı (`INVITE_POLL_MS`, 429 → Retry-After, 403/404 → dur);
 * 201 / geri çekme / roster değişiminde hemen yeniden okunur. Süresi dolan satır istemcide de düşer.
 */
function useOutgoingInvites(sessionId: string, enabled: boolean, rosterKey: string, now: number | null) {
  const router = useRouter();
  const [items, setItems] = useState<OutgoingInvite[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let next = INVITE_POLL_MS;
      try {
        const r = await api<OutgoingInvitesResponse>("GET", `/sessions/${sessionId}/invites`);
        if (stopped) return;
        setItems(r.items);
      } catch (e) {
        if (stopped) return;
        if (e instanceof ApiError && e.status === 401) {
          stopped = true;
          return router.replace(EXPIRED_LOGIN_PATH);
        }
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
          stopped = true;
          return setItems([]);
        }
        if (e instanceof ApiError && e.status === 429) next = Math.max((e.retryAfter ?? 0) * 1000, INVITE_POLL_MS);
      }
      if (!stopped) timer = setTimeout(() => void poll(), next);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, sessionId, router, rosterKey, tick]);
  // Sahiplik düşünce (devir) eski satırlar görünmez; 403/404 yoklamayı durdurur
  const live = enabled ? items.filter((i) => now === null || Date.parse(i.expiresAt) > now) : [];
  const add = useCallback((i: OutgoingInvite) => {
    setItems((xs) => (xs.some((x) => x.inviteId === i.inviteId) ? xs : [...xs, i]));
    setTick((n) => n + 1);
  }, []);
  const drop = useCallback((id: string) => {
    setItems((xs) => xs.filter((x) => x.inviteId !== id));
    setTick((n) => n + 1);
  }, []);
  return { live, add, drop };
}

/**
 * Konsol "Teknisyenler" (mimari-p28c §10, AC-364..369): roster (ad, rol, "Oturum sahibi" rozeti, bağlantı), sahipte "Davet et",
 * "Kontrolü ver/geri al", "Oturumu devret" (onay), bekleyen davette "Geri çek"; üyede "Oturumdan ayrıl" (onay).
 */
export function TechsPanel({
  ts,
  sessionId,
  seat,
  canInvite,
  inviteBlock,
  now,
}: {
  ts: Tech;
  sessionId: string;
  seat: Seat;
  canInvite: boolean;
  /** Yerel olarak bilinen kalıcı pasiflik nedeni (ör. `asked` gözetimsiz oda). */
  inviteBlock: string | null;
  now: number | null;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "transfer"; to: TechRosterEntry } | { kind: "leave" } | null>(null);
  const toast = useToast();
  const mark = useActionErrors(ts);
  const { roster, tid } = ts.state;
  const live = ts.state.phase === "live";
  const list = sortedRoster(roster);
  // Bekleyen davet satırı + "Geri çek" sahip kapısıyla (GET/DELETE yetki anahtarı istemez); "Davet et" ayrıca `sessions.invite`
  const inv = useOutgoingInvites(sessionId, seat.owner && live, list.map((e) => e.tid).join(","), now);
  const count = Math.max(list.length, 1);
  const owner = seat.owner && canInvite;
  const full = list.length + inv.live.length >= MAX_TECHS;
  const block = inviteBlock ?? (full ? t("mt.full") : null);

  const revoke = async (i: OutgoingInvite) => {
    try {
      await api("DELETE", `/sessions/${sessionId}/invites/${i.inviteId}`);
      toast(t("mt.revoked"), "success");
    } catch (e) {
      if (!(e instanceof ApiError && (e.status === 410 || e.status === 404))) return toast(multiUiError(e).message, "danger");
    }
    inv.drop(i.inviteId);
  };
  const act = (fn: () => void) => {
    mark();
    fn();
  };

  if (!live && list.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-surface" data-testid="techs-panel">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-fg hover:bg-surface-muted"
        data-testid="techs-toggle"
      >
        <Users aria-hidden className="size-4 text-fg-muted" />
        <span>{t("mt.techs")}</span>
        <span
          className="inline-flex min-w-6 items-center justify-center rounded-full bg-surface-muted px-1.5 text-xs font-semibold tabular-nums text-fg"
          data-testid="techs-count"
        >
          {count}/{MAX_TECHS}
        </span>
        <ChevronDown aria-hidden className={`ml-auto size-4 text-fg-muted ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={panelId} className="flex flex-col gap-3 border-t border-border p-3">
          <p className="text-xs text-fg-muted">{t("mt.panelDesc")}</p>
          <ul className="flex flex-col gap-2" aria-label={t("mt.panelTitle")}>
            {list.map((e) => (
              <RosterRow
                key={e.tid}
                e={e}
                me={e.tid === tid}
                ownerActions={owner && live && e.tid !== tid && e.role !== "observer" && e.connected}
                onGive={() => act(() => ts.handover(e.tid))}
                onTransfer={() => setConfirm({ kind: "transfer", to: e })}
              />
            ))}
            {seat.owner &&
              inv.live.map((i) => (
                <li
                  key={i.inviteId}
                  className="flex items-center gap-3 rounded-md border border-dashed border-border px-2 py-1"
                  data-testid="techs-pending"
                >
                  <Avatar name={i.inviteeName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-fg">{i.inviteeName}</p>
                    <p className="text-xs text-fg-muted tabular-nums">
                      {t("mt.pending", { left: now === null ? "—" : formatRemaining(Date.parse(i.expiresAt) - now) })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => void revoke(i)}
                    aria-label={t("mt.revokeRow", { name: i.inviteeName })}
                    className="w-11 px-0"
                    data-testid="techs-revoke"
                  >
                    <X aria-hidden className="size-4" />
                  </Button>
                </li>
              ))}
          </ul>
          <PanelActions
            owner={owner}
            seat={seat}
            live={live}
            block={block}
            onInvite={() => setInviting(true)}
            onTakeBack={() => tid && act(() => ts.handover(tid))}
            onLeave={() => setConfirm({ kind: "leave" })}
          />
        </div>
      )}
      {owner && (
        <InviteDialog
          sessionId={sessionId}
          open={inviting}
          onClose={() => setInviting(false)}
          onInvited={(i) => {
            inv.add(i);
            toast(t("mt.invited", { name: i.inviteeName }), "success");
          }}
        />
      )}
      <ConfirmDialog
        confirm={confirm}
        onClose={() => setConfirm(null)}
        onTransfer={(to) => act(() => ts.transfer(to.tid))}
        onLeave={() => ts.leave()}
      />
    </section>
  );
}

function RosterRow(p: { e: TechRosterEntry; me: boolean; ownerActions: boolean; onGive: () => void; onTransfer: () => void }) {
  const { e } = p;
  return (
    <li className="flex flex-col gap-2 rounded-md px-2 py-1 sm:flex-row sm:items-center" data-testid="techs-row" data-role={e.role}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={e.name} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">
            {e.name} {p.me && <span className="font-normal text-fg-muted">{t("mt.you")}</span>}
          </p>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
            <span data-testid="techs-role">{t(ROLE_LABEL_KEY[e.role])}</span>
            {e.owner && (
              <span className="rounded-full bg-primary-surface px-2 py-0.5 font-medium text-primary" data-testid="techs-owner">
                {t("mt.owner")}
              </span>
            )}
            {!e.connected && (
              <span className="inline-flex items-center gap-1 text-danger">
                <WifiOff aria-hidden className="size-3.5" />
                {t("mt.offline")}
              </span>
            )}
          </p>
        </div>
      </div>
      {p.ownerActions && (
        <div className="flex flex-wrap gap-2">
          {e.role === "participant" && (
            <Button variant="secondary" onClick={p.onGive} aria-label={t("mt.giveControlRow", { name: e.name })} data-testid="techs-give">
              <MousePointer2 aria-hidden className="size-4" />
              {t("mt.giveControl")}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={p.onTransfer}
            aria-label={t("mt.transferRow", { name: e.name })}
            data-testid="techs-transfer"
          >
            <ArrowRightLeft aria-hidden className="size-4" />
            {t("mt.transfer")}
          </Button>
        </div>
      )}
    </li>
  );
}

function PanelActions(p: {
  owner: boolean;
  seat: Seat;
  live: boolean;
  block: string | null;
  onInvite: () => void;
  onTakeBack: () => void;
  onLeave: () => void;
}) {
  const reasonId = useId();
  if (!p.seat.owner)
    return (
      <Button variant="danger-ghost" onClick={p.onLeave} className="self-start" data-testid="techs-leave">
        <LogOut aria-hidden className="size-4" />
        {t("mt.leave")}
      </Button>
    );
  if (!p.owner) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={p.onInvite}
          disabled={!p.live || p.block !== null}
          aria-describedby={p.block ? reasonId : undefined}
          data-testid="techs-invite"
        >
          <UserPlus aria-hidden className="size-4" />
          {t("mt.invite")}
        </Button>
        {!p.seat.controller && (
          <Button variant="secondary" onClick={p.onTakeBack} disabled={!p.live} data-testid="techs-takeback">
            <Undo2 aria-hidden className="size-4" />
            {t("mt.takeBack")}
          </Button>
        )}
      </div>
      {p.block && (
        <p id={reasonId} className="text-xs text-warning" data-testid="techs-invite-block">
          {p.block}
        </p>
      )}
    </div>
  );
}

type Confirm = { kind: "transfer"; to: TechRosterEntry } | { kind: "leave" } | null;

/** Oturum devri / ayrılma onayı (yıkıcı; odak "Vazgeç"te). */
function ConfirmDialog(p: { confirm: Confirm; onClose: () => void; onTransfer: (to: TechRosterEntry) => void; onLeave: () => void }) {
  const c = p.confirm;
  const transfer = c?.kind === "transfer";
  return (
    <Dialog
      open={c !== null}
      onClose={p.onClose}
      title={transfer ? t("mt.transferTitle", { name: c.to.name }) : t("mt.leaveTitle")}
      description={transfer ? t("mt.transferBody", { name: c.to.name }) : t("mt.leaveBody")}
      size="sm"
      role="alertdialog"
      testId="techs-confirm"
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={p.onClose} className="sm:ml-auto">
            {t("mt.keep")}
          </Button>
          <Button
            variant="danger"
            data-testid="techs-confirm-ok"
            onClick={() => {
              if (c?.kind === "transfer") p.onTransfer(c.to);
              else p.onLeave();
              p.onClose();
            }}
          >
            {transfer ? <ArrowRightLeft aria-hidden className="size-4" /> : <LogOut aria-hidden className="size-4" />}
            {transfer ? t("mt.transfer") : t("mt.leave")}
          </Button>
        </>
      }
    />
  );
}
