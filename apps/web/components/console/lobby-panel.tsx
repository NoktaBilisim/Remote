"use client";

import { UserCheck, UserX, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useNow } from "@/lib/use-now";
import { MAX_ADMIT_ATTEMPTS, REJECT_SUGGEST, type Pending, type TechState } from "@/lib/webrtc/tech-machine";

/** Konsol lobi paneli (DESIGN §6.1, §8; AC-112/113): bekleyenler (≤3), kabul kodu, kalan hak, satır başına Reddet. */
export function LobbyPanel({
  state,
  onAdmit,
  onReject,
}: {
  state: Pick<TechState, "pending" | "admitBusy" | "wrongCodes" | "lastError" | "rejects">;
  onAdmit: (code: string) => void;
  onReject: (p: Pending) => void;
}) {
  const now = useNow();
  const [code, setCode] = useState("");
  const [local, setLocal] = useState<string | undefined>();
  const left = MAX_ADMIT_ATTEMPTS - state.wrongCodes;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(code)) return setLocal(t("cl.codeFormat"));
    setLocal(undefined);
    onAdmit(code);
    setCode("");
  };
  const error =
    local ??
    (state.lastError === "ADMIT_CODE_INVALID"
      ? t("cl.wrong", { n: left })
      : state.lastError === "CONFLICT"
        ? t("cl.conflict")
        : state.lastError === "OTHER"
          ? t("cl.other")
          : undefined);

  return (
    <section aria-labelledby="lobi-t" data-testid="lobby-panel" className="flex w-full max-w-xl flex-col gap-4 rounded-lg border border-border bg-surface p-4 text-fg shadow-md sm:p-6">
      <h2 id="lobi-t" className="inline-flex items-center gap-2 text-lg font-semibold">
        <Users aria-hidden className="size-5 text-fg-muted" />
        {t("cl.title", { n: state.pending.length })}
      </h2>
      <form onSubmit={submit} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <TextField
          label={t("cl.code")}
          hint={t("cl.codeHint")}
          error={error}
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={code}
          disabled={state.admitBusy}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
          data-testid="admit-input"
          className="sm:w-56"
        />
        <Button type="submit" loading={state.admitBusy} className="sm:mt-7" data-testid="admit-submit">
          {!state.admitBusy && <UserCheck aria-hidden className="size-4" />}
          {t("cl.admit")}
        </Button>
      </form>
      <ul className="flex flex-col divide-y divide-border border-t border-border">
        {state.pending.map((p) => (
          <li key={p.guestId} data-testid="lobby-guest" className="flex items-center gap-3 py-3">
            <Avatar name={p.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{p.name}</p>
              <p className="text-xs text-fg-muted">
                {t(p.guestKind === "AGENT" ? "cl.kindAgent" : "cl.kindBrowser")} ·{" "}
                <span className="tabular-nums">{t("cl.waitingFor", { time: now === null ? "—" : formatRemaining(now - Date.parse(p.since)) })}</span>
              </p>
            </div>
            <Button variant="danger-ghost" onClick={() => onReject(p)} aria-label={t("cl.rejectRow", { name: p.name })}>
              <UserX aria-hidden className="size-4" />
              <span aria-hidden>{t("cl.reject")}</span>
            </Button>
          </li>
        ))}
      </ul>
      {state.rejects >= REJECT_SUGGEST && (
        <Alert tone="warning">
          {t("cl.leaked")}
        </Alert>
      )}
    </section>
  );
}
