"use client";

import type { CreateSessionResponse } from "@remote/contracts/api/sessions";
import { CircleX, Plus, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CustomerCombobox } from "@/components/customer-combobox";
import { FormError } from "@/components/form-error";
import type { ComboOption } from "@/components/ui/combobox";
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
  | { kind: "pick" }
  | { kind: "creating" }
  | { kind: "ok"; data: CreateSessionResponse; ttlMinutes: number; cancelled: boolean }
  | { kind: "limit"; message: string }
  | { kind: "rate"; minutes: number }
  | { kind: "error"; error: UiError };

/** "Yeni destek oturumu" (AC-1, 3, 9, 11, 12): açılınca oluşturur; link yalnız bu yanıtta gösterilir. */
export function NewSessionDialog({
  canCancel,
  canPickCustomer = false,
  onClose,
  onChanged,
}: {
  canCancel: boolean;
  /** P8c (AC-180): `customers.view` → önce isteğe bağlı müşteri firma seçimi; yoksa bugünkü gibi anında oluşturur. */
  canPickCustomer?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [state, setState] = useState<State>({ kind: canPickCustomer ? "pick" : "creating" });
  const [customer, setCustomer] = useState<ComboOption | null>(null);
  const [customerError, setCustomerError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const started = useRef(false);
  const router = useRouter();

  const create = useCallback(async (customerId?: string) => {
    setState({ kind: "creating" });
    try {
      const data = await api<CreateSessionResponse>("POST", "/sessions", customerId ? { customerId } : {});
      const ttlMinutes = Math.max(1, Math.round((Date.parse(data.expiresAt) - Date.now()) / 60_000));
      setState({ kind: "ok", data, ttlMinutes, cancelled: false });
      onChanged();
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      // AC-180: pasif / başka firmanın müşterisi → 404; seçime geri dönülür
      if (customerId && e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        setCustomerError(e.status === 404 ? t("d.customerGone") : t("d.customerForbidden"));
        setState({ kind: "pick" });
        return;
      }
      if (e instanceof ApiError && e.code === "OPEN_SESSION_LIMIT") setState({ kind: "limit", message: e.message });
      else if (e instanceof ApiError && e.status === 429) setState({ kind: "rate", minutes: retryMinutes(e.retryAfter) });
      else setState({ kind: "error", error: toUiError(e) });
    }
  }, [onChanged, router]);

  // Tek istek: StrictMode'daki çift efekt çalıştırmasında ref korunur (çift oturum açılmaz)
  useEffect(() => {
    if (started.current || canPickCustomer) return;
    started.current = true;
    void create();
  }, [create, canPickCustomer]);

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
              <Button variant="secondary" onClick={() => void create(customer?.id)} className="sm:ml-auto">
                <RotateCw aria-hidden className="size-4" />
                {t("err.retry")}
              </Button>
            )}
            <Button variant={ok || state.kind === "pick" ? "secondary" : "primary"} onClick={onClose} className={state.kind === "error" ? "" : "sm:ml-auto"}>
              {state.kind === "pick" ? t("rq.rj.cancel") : t("d.close")}
            </Button>
            {state.kind === "pick" && (
              <Button type="submit" form="new-session-pick" data-testid="new-session-create">
                <Plus aria-hidden className="size-4" />
                {t("d.create")}
              </Button>
            )}
          </>
        }
      >
        {state.kind === "pick" && (
          <form
            id="new-session-pick"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setCustomerError(undefined);
              void create(customer?.id);
            }}
          >
            <CustomerCombobox
              label={t("d.customer")}
              value={customer}
              onChange={(o) => {
                setCustomer(o);
                setCustomerError(undefined);
              }}
              hint={t("d.customerHint")}
              error={customerError}
              testId="new-session-customer"
            />
          </form>
        )}
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
