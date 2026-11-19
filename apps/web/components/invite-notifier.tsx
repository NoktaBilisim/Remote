"use client";

import type { IncomingInvite, IncomingInvitesResponse } from "@remote/contracts/api/multi";
import { INVITE_POLL_MS } from "@remote/contracts/ws-multi";
import { LogIn, MonitorCog, UserPlus, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useJoin, type JoinTarget } from "@/components/multi/use-join";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH } from "@/lib/api";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import { multiUiError } from "@/lib/multi/errors";
import { useNow } from "@/lib/use-now";

/** Yalnız yeni gelen davetler (önceki listede olmayan) toast üretir; ilk yoklama da bildirir (bekleyen davet kaçmasın). */
export function newInvites(prev: ReadonlySet<string>, items: readonly IncomingInvite[]): IncomingInvite[] {
  return items.filter((i) => !prev.has(i.inviteId));
}

/** 5 sn yoklama (ADR-0029 kalıbı, K-PC-5). 401 → giriş; 403/404 → dur; 429 → `Retry-After`; ağ/5xx → sessizce sonraki tur. */
function useIncomingInvites(enabled: boolean) {
  const router = useRouter();
  const toast = useToast();
  const toastRef = useRef(toast);
  const [items, setItems] = useState<IncomingInvite[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seen = new Set<string>();
    const poll = async () => {
      let next = INVITE_POLL_MS;
      try {
        const r = await api<IncomingInvitesResponse>("GET", "/sessions/invites");
        if (stopped) return;
        for (const i of newInvites(seen, r.items)) toastRef.current(t("mt.newInvite", { from: i.fromName }), "info", { durationMs: 8_000 });
        seen = new Set(r.items.map((i) => i.inviteId));
        setItems(r.items);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          stopped = true;
          return router.replace(EXPIRED_LOGIN_PATH);
        }
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return void (stopped = true);
        if (e instanceof ApiError && e.status === 429) next = Math.max((e.retryAfter ?? 0) * 1000, INVITE_POLL_MS);
      }
      if (!stopped) timer = setTimeout(() => void poll(), next);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, router, tick]);
  const drop = useCallback((id: string) => setItems((xs) => xs.filter((x) => x.inviteId !== id)), []);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { items, drop, refresh };
}

/**
 * Davet bildirimi (mimari-p28c §10, AC-364): panelin her sayfasında; kart "<Ad> sizi <müşteri> oturumuna davet ediyor", kalan
 * süre, "Katıl" / "Reddet". Gözetimsizde kabul step-up ister (lib/api). Süresi dolan kart
 * istemcide düşer (sunucu da 410 verir). Boşken hiçbir şey çizilmez.
 */
export function InviteNotifier({ enabled }: { enabled: boolean }) {
  const { items, drop, refresh } = useIncomingInvites(enabled);
  const toast = useToast();
  const now = useNow();
  const [busyReject, setBusyReject] = useState<string | null>(null);
  const join = useJoin((j, e) => {
    toast(e.message, "danger");
    if (j.kind === "invite") refresh();
  });
  const live = items.filter((i) => now === null || Date.parse(i.expiresAt) > now);
  const reject = async (i: IncomingInvite) => {
    setBusyReject(i.inviteId);
    try {
      await api("POST", `/sessions/invites/${i.inviteId}/reject`);
      drop(i.inviteId);
    } catch (e) {
      // K5 D-1: kart yalnız başarıda veya 410'da (davet zaten yok) düşer; diğer hatada kalır, kullanıcı tekrar deneyebilir.
      if (e instanceof ApiError && e.status === 410) drop(i.inviteId);
      else toast(multiUiError(e).message, "danger");
    } finally {
      setBusyReject(null);
    }
  };
  if (!enabled || live.length === 0) return null;
  return (
    <section
      aria-labelledby="mt-inv-t"
      className="mb-4 flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary-surface p-3"
      data-testid="invite-notifier"
    >
      <h2 id="mt-inv-t" className="flex items-center gap-2 text-sm font-semibold text-fg">
        <UserPlus aria-hidden className="size-4 text-primary" />
        {t("mt.notifTitle")}
      </h2>
      <ul className="flex flex-col gap-2">
        {live.map((i) => (
          <InviteCard
            key={i.inviteId}
            i={i}
            now={now}
            joining={join.busyId === i.inviteId}
            rejecting={busyReject === i.inviteId}
            onJoin={() => void join.start(targetOf(i))}
            onReject={() => void reject(i)}
          />
        ))}
      </ul>
    </section>
  );
}

const targetOf = (i: IncomingInvite): JoinTarget => ({ kind: "invite", id: i.inviteId });

function InviteCard(p: {
  i: IncomingInvite;
  now: number | null;
  joining: boolean;
  rejecting: boolean;
  onJoin: () => void;
  onReject: () => void;
}) {
  const { i } = p;
  const left = p.now === null ? "—" : formatRemaining(Date.parse(i.expiresAt) - p.now);
  const busy = p.joining || p.rejecting;
  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 sm:flex-row sm:items-center"
      data-testid="invite-card"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{t("mt.notifBody", { from: i.fromName, customer: i.customerName })}</p>
        <p className="text-xs text-fg-muted tabular-nums">{t("mt.notifLeft", { left })}</p>
        {i.unattended && (
          <p className="mt-1 flex items-center gap-1 text-xs text-fg-muted">
            <MonitorCog aria-hidden className="size-3.5" />
            {t("mt.unattendedNote")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          variant="secondary"
          onClick={p.onReject}
          loading={p.rejecting}
          disabled={busy}
          aria-label={t("mt.rejectRow", { customer: i.customerName })}
          data-testid="invite-reject"
        >
          {!p.rejecting && <UserX aria-hidden className="size-4" />}
          {t("mt.reject")}
        </Button>
        <Button
          onClick={p.onJoin}
          loading={p.joining}
          disabled={busy}
          aria-label={t("mt.joinRow", { customer: i.customerName })}
          data-testid="invite-join"
        >
          {!p.joining && <LogIn aria-hidden className="size-4" />}
          {t("mt.join")}
        </Button>
      </div>
    </li>
  );
}
