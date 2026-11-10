"use client";

import type { CreateSessionResponse } from "@remote/contracts/api/sessions";
import { CircleX, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, withoutLeadingTitle, type UiError } from "@/lib/error-message";
import { retryMinutes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { CancelDialog } from "./cancel-dialog";
import { CreatedSession } from "./created-session";

type State =
  | { kind: "creating" }
  | { kind: "ok"; data: CreateSessionResponse; ttlMinutes: number; cancelled: boolean }
  | { kind: "limit"; message: string }
  | { kind: "rate"; minutes: number }
  | { kind: "error"; error: UiError };

/** "Yeni destek oturumu" (AC-1, 3, 9, 11, 12): açılınca oluşturur; link yalnız bu yanıtta gösterilir. */
export function NewSessionDialog({
  canCancel,
  onClose,
  onChanged,
}: {
  canCancel: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "creating" });
  const [confirming, setConfirming] = useState(false);
  const started = useRef(false);
  const router = useRouter();

  const create = useCallback(async () => {
    setState({ kind: "creating" });
    try {
      const data = await api<CreateSessionResponse>("POST", "/sessions", {});
      const ttlMinutes = Math.max(1, Math.round((Date.parse(data.expiresAt) - Date.now()) / 60_000));
      setState({ kind: "ok", data, ttlMinutes, cancelled: false });
      onChanged();
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      if (e instanceof ApiError && e.code === "OPEN_SESSION_LIMIT") setState({ kind: "limit", message: e.message });
      else if (e instanceof ApiError && e.status === 429) setState({ kind: "rate", minutes: retryMinutes(e.retryAfter) });
      else setState({ kind: "error", error: toUiError(e) });
    }
  }, [onChanged, router]);

  // Tek istek: StrictMode'daki çift efekt çalıştırmasında ref korunur (çift oturum açılmaz)
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void create();
  }, [create]);

  const ok = state.kind === "ok" ? state : null;
  return (
    <>
      <Dialog
        open
        onClose={onClose}
        testId="new-session-dialog"
        title={t("d.title")}
        description={ok ? t("d.subtitle", { minutes: ok.ttlMinutes }) : undefined}
        footer={
          <>
            {ok && canCancel && !ok.cancelled && (
              <Button
                variant="secondary"
                onClick={() => setConfirming(true)}
                className="border-danger/40 text-danger hover:bg-danger-surface"
              >
                <CircleX aria-hidden className="size-4" />
                {t("d.cancelSession")}
              </Button>
            )}
            {state.kind === "error" && (
              <Button variant="secondary" onClick={create} className="sm:ml-auto">
                <RotateCw aria-hidden className="size-4" />
                {t("err.retry")}
              </Button>
            )}
            <Button variant={ok ? "secondary" : "primary"} onClick={onClose} className={state.kind === "error" ? "" : "sm:ml-auto"}>
              {t("d.close")}
            </Button>
          </>
        }
      >
        {state.kind === "creating" && (
          <div aria-busy="true" data-testid="creating">
            <p className="sr-only" role="status">{t("d.creating")}</p>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-2 h-11 w-full" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          </div>
        )}
        {ok && <CreatedSession data={ok.data} cancelled={ok.cancelled} />}
        {state.kind === "limit" && (
          <Alert tone="warning" testId="limit-error">
            <p className="font-medium">{t("d.limitTitle")}</p>
            {/* TO-P2-1: başlık + tek açıklama; sunucu mesajı başlığı tekrarlıyorsa o cümle atılır, boş kalırsa yönlendirme metni */}
            <p className="mt-1">{withoutLeadingTitle(state.message, t("d.limitTitle")) || t("d.limitHint")}</p>
          </Alert>
        )}
        {state.kind === "rate" && (
          <Alert tone="locked" testId="rate-error">
            <p className="font-medium">{t("d.rateTitle")}</p>
            <p className="mt-1">{t("d.rateBody", { minutes: state.minutes })}</p>
          </Alert>
        )}
        {state.kind === "error" && <FormError error={state.error} />}
      </Dialog>
      <CancelDialog
        session={confirming && ok ? { id: ok.data.id, code: ok.data.code } : null}
        onClose={() => setConfirming(false)}
        onDone={() => {
          setConfirming(false);
          if (ok) setState({ ...ok, cancelled: true });
          onChanged();
        }}
      />
    </>
  );
}
