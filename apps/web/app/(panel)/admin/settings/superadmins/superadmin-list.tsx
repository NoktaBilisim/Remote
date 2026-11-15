"use client";

import type { SuperadminItem, SuperadminResetResponse } from "@remote/contracts/api/users";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { TemporaryPasswordDialog } from "@/components/temp-password-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { StatusPill } from "../../../users/user-list";

/**
 * Super Admin listesi (P15, AC-232). Satır: baş harf rozeti, ad, e-posta, durum, 2FA. Etkin ve kendisi olmayan satırda
 * "Şifre sıfırla" → onay (`alertdialog`, odak Vazgeç) → POST (step-up gerekiyorsa `lib/api` diyaloğu açar, istek bir kez
 * tekrarlanır) → geçici şifre bir kez (kopyalamadan kapatmaya uyarı). Kendi satırında düğme yok ("siz").
 */
export function SuperadminList({ items }: { items: SuperadminItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [target, setTarget] = useState<SuperadminItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [result, setResult] = useState<{ name: string; r: SuperadminResetResponse } | null>(null);

  const close = () => {
    if (busy) return;
    setTarget(null);
    setError(null);
  };
  const reset = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<SuperadminResetResponse>("POST", `/admin/superadmins/${target.id}/reset-password`, {});
      setResult({ name: target.fullName, r });
      setTarget(null);
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      if (e instanceof ApiError && e.status === 404) {
        setTarget(null);
        toast(t("sa.gone"), "danger");
        router.refresh();
      } else setError(toUiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" aria-label={t("sa.listLabel")}>
        {items.map((x) => (
          <li
            key={x.id}
            data-testid="superadmin-row"
            data-self={x.self ? "true" : "false"}
            className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={x.fullName} />
              <div className="min-w-0">
                <p className="font-medium break-words text-fg">
                  {x.fullName}
                  {x.self && <span className="ml-1 text-sm font-normal text-fg-muted">({t("us.you")})</span>}
                </p>
                <p className="text-sm break-all text-fg-muted">{x.email}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <StatusPill status={x.status} />
                  <span className="inline-flex items-center gap-1">
                    {x.totpEnabled ? <ShieldCheck aria-hidden className="size-3.5" /> : <ShieldOff aria-hidden className="size-3.5" />}
                    {x.totpEnabled ? t("sa.mfaOn") : t("sa.mfaOff")}
                  </span>
                </p>
              </div>
            </div>
            {!x.self && x.status === "ACTIVE" && (
              <Button
                variant="secondary"
                className="shrink-0 self-start sm:self-center"
                onClick={() => setTarget(x)}
                aria-label={t("sa.resetFor", { name: x.fullName })}
                data-testid="superadmin-reset"
              >
                <KeyRound aria-hidden className="size-4" />
                <span aria-hidden>{t("sa.reset")}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Dialog
        open={target !== null}
        onClose={close}
        role="alertdialog"
        size="sm"
        testId="superadmin-reset-dialog"
        title={t("sa.confirmTitle", { name: target?.fullName ?? "" })}
        description={t("sa.confirmBody")}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={close} disabled={busy} className="sm:ml-auto">
              {t("su.cancel")}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void reset()} data-testid="superadmin-reset-confirm">
              {!busy && <KeyRound aria-hidden className="size-4" />}
              {t("sa.confirm")}
            </Button>
          </>
        }
      >
        {error && <FormError error={error} />}
      </Dialog>

      {result && (
        <TemporaryPasswordDialog
          password={result.r.temporaryPassword}
          title={t("sa.pwTitle", { name: result.name })}
          description={t("sa.pwDesc", { n: result.r.revokedSessions })}
          testId="superadmin-temp-password"
          onDone={() => {
            setResult(null);
            toast(t("sa.done"));
          }}
        />
      )}
    </>
  );
}
