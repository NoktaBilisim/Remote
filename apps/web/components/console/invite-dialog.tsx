"use client";

import type { CreateInviteResponse, InviteCandidate, InviteCandidatesResponse } from "@remote/contracts/api/multi";
import { Search, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { FormError } from "@/components/form-error";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { joinBlockedMessage, multiUiError } from "@/lib/multi/errors";

type Load = { kind: "loading" } | { kind: "error" } | { kind: "blocked"; message: string } | { kind: "ok"; items: InviteCandidate[] };

export interface SentInvite {
  inviteId: string;
  expiresAt: string;
  name: string;
}

/** Aday listesi (`GET …/invite-candidates`): 409 `CLIENT_UNSUPPORTED` / `JOIN_NOT_ALLOWED` → kalıcı pasif neden (AC-372, V-PC-5). */
function useCandidates(sessionId: string, open: boolean, onBlocked: (m: string) => void) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [seenOpen, setSeenOpen] = useState(false);
  // Her açılışta yükleniyor durumundan başlar (render sırasında, efektsiz)
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (open) setLoad({ kind: "loading" });
  }
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    let off = false;
    api<InviteCandidatesResponse>("GET", `/sessions/${sessionId}/invite-candidates`).then(
      (r) => !off && setLoad({ kind: "ok", items: r.items }),
      (e: unknown) => {
        if (off) return;
        const m = joinBlockedMessage(e);
        if (m) onBlocked(m);
        setLoad(m ? { kind: "blocked", message: m } : { kind: "error" });
      },
    );
    return () => {
      off = true;
    };
  }, [open, sessionId, onBlocked, tick]);
  const retry = useCallback(() => {
    setLoad({ kind: "loading" });
    setTick((n) => n + 1);
  }, []);
  return { load, retry };
}

/**
 * "Teknisyen davet et" (mimari-p28c §10, AC-364): aynı firmadan uygun kullanıcılar (sunucu §4.3 zincirini uygular), ada göre arama,
 * satırda "Davet et". 201 → bekleyen davet satırı (teknisyenler paneli, "Geri çek"). Durumlar: yükleniyor, boş, hata, pasif, liste.
 */
export function InviteDialog({
  sessionId,
  open,
  onClose,
  onInvited,
  onBlocked,
}: {
  sessionId: string;
  open: boolean;
  onClose: () => void;
  onInvited: (i: SentInvite) => void;
  onBlocked: (message: string) => void;
}) {
  const { load, retry } = useCandidates(sessionId, open, onBlocked);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const searchId = useId();
  const close = () => {
    if (busy) return;
    setQ("");
    setError(null);
    onClose();
  };
  const invite = async (c: InviteCandidate) => {
    setBusy(c.userId);
    setError(null);
    try {
      const r = await api<CreateInviteResponse>("POST", `/sessions/${sessionId}/invites`, { userId: c.userId });
      onInvited({ inviteId: r.inviteId, expiresAt: r.expiresAt, name: c.fullName });
      setQ("");
      onClose();
    } catch (e) {
      const m = joinBlockedMessage(e);
      if (m) onBlocked(m);
      setError(multiUiError(e));
    } finally {
      setBusy(null);
    }
  };
  const needle = q.trim().toLocaleLowerCase("tr");
  const shown = load.kind === "ok" ? load.items.filter((c) => c.fullName.toLocaleLowerCase("tr").includes(needle)) : [];
  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("mt.inviteTitle")}
      description={t("mt.inviteDesc")}
      testId="invite-dialog"
      footer={
        <Button variant="secondary" onClick={close} disabled={busy !== null}>
          {t("mt.keep")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <FormError error={error} />
        {load.kind === "loading" && (
          <div className="flex flex-col gap-2" aria-busy data-testid="invite-loading">
            <span className="sr-only">{t("mt.loadingCandidates")}</span>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        )}
        {load.kind === "error" && <LoadError onRetry={retry} />}
        {load.kind === "blocked" && (
          <Alert tone="warning" testId="invite-blocked">
            {load.message}
          </Alert>
        )}
        {load.kind === "ok" && load.items.length === 0 && (
          <EmptyState Icon={Users} title={t("mt.candidatesEmpty")} body={t("mt.candidatesEmptyHint")} testId="invite-empty" />
        )}
        {load.kind === "ok" && load.items.length > 0 && (
          <>
            <div className="relative">
              <label htmlFor={searchId} className="sr-only">
                {t("mt.search")}
              </label>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
              <input
                id={searchId}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("mt.search")}
                data-testid="invite-search"
                className="min-h-11 w-full rounded-md border border-border bg-surface py-2 pr-3 pl-9 text-base text-fg shadow-sm placeholder:text-fg-muted sm:text-sm"
              />
            </div>
            {shown.length === 0 ? (
              <p className="py-4 text-center text-sm text-fg-muted" data-testid="invite-nomatch">
                {t("mt.noMatch")}
              </p>
            ) : (
              <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto" data-testid="invite-list">
                {shown.map((c) => (
                  <li key={c.userId} className="flex items-center gap-3 rounded-md px-1 py-1 hover:bg-surface-muted">
                    <Avatar name={c.fullName} src={c.avatarUrl} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{c.fullName}</span>
                    <Button
                      variant="secondary"
                      onClick={() => void invite(c)}
                      loading={busy === c.userId}
                      disabled={busy !== null}
                      aria-label={t("mt.inviteRow", { name: c.fullName })}
                      data-testid="invite-send"
                    >
                      {busy !== c.userId && <UserPlus aria-hidden className="size-4" />}
                      {t("mt.invite")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
