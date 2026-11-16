"use client";

import { EyeOff, Info, Plug, TriangleAlert } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { CONSENT_DIALOG_SEC, SILENT_REASON_MAX, SILENT_REASON_MIN } from "@/lib/unattended/contract";
import { buildConnectBody, reasonLength, reasonOver } from "@/lib/unattended/consent";
import type { ConnectFlow } from "./use-connect";
import { UserState } from "./user-state";

const FORM_ID = "un-connect-form";

/** Gerekçe alanı (20–500 kod noktası, sayaç, alan hatası `fields.reason`). Metin alanı kalıbı `history/[id]/note-form.tsx`. */
export function ReasonField({
  value,
  onChange,
  error,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  busy: boolean;
}) {
  const id = useId();
  const n = reasonLength(value);
  const bad = Boolean(error) || reasonOver(value);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {t("un.silent.reason")}
      </label>
      <textarea
        id={id}
        name="reason"
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
        aria-invalid={bad ? true : undefined}
        aria-describedby={`${id}-hint ${id}-count${error ? ` ${id}-err` : ""}`}
        data-testid="un-silent-reason"
        className={`w-full resize-y rounded-md border bg-surface px-3 py-2 text-base text-fg shadow-sm focus-visible:border-ring disabled:opacity-60 sm:text-sm ${bad ? "border-danger" : "border-border"}`}
      />
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        {error ? (
          <p id={`${id}-err`} className="font-medium text-danger" data-testid="un-silent-reason-error">
            {error}
          </p>
        ) : (
          <p id={`${id}-hint`} className="text-fg-muted">
            {t("un.silent.reasonHint", { min: SILENT_REASON_MIN, max: SILENT_REASON_MAX })}
          </p>
        )}
        <p
          id={`${id}-count`}
          className={`tabular-nums ${reasonOver(value) ? "text-danger" : "text-fg-muted"}`}
          data-testid="un-silent-count"
        >
          {t("un.silent.counter", { n: formatNumber(n), max: formatNumber(SILENT_REASON_MAX) })}
        </p>
      </div>
    </div>
  );
}

/** Diyalog gövdesi — diyalog her açıldığında yeniden bağlanır (kutu her açılışta işaretsiz, AC-430). */
function ConnectForm({ flow, silentAllowed }: { flow: ConnectFlow; silentAllowed: boolean }) {
  const [silent, setSilent] = useState(false);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | undefined>();
  const reasonError = localError ?? flow.reasonError;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = buildConnectBody(silentAllowed && silent, reason);
    if ("error" in r) return setLocalError(r.error);
    setLocalError(undefined);
    void flow.submit(r.body);
  };
  return (
    <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="un-connect-form">
      <FormError error={flow.error} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-fg-muted">{t("un.consent.userState")}</dt>
        <dd>
          <UserState state={flow.target?.userState} />
        </dd>
      </dl>
      <p className="flex items-start gap-2 text-sm text-fg-muted" data-testid="un-connect-ask-info">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t("un.consent.askInfo", { sec: CONSENT_DIALOG_SEC })}
      </p>
      {silentAllowed && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-canvas p-3" data-testid="un-silent-box">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-fg">
            <input
              type="checkbox"
              checked={silent}
              onChange={(e) => {
                setSilent(e.target.checked);
                setLocalError(undefined);
              }}
              disabled={flow.busy}
              className="size-5 shrink-0 cursor-pointer accent-primary"
              data-testid="un-silent"
            />
            <EyeOff aria-hidden className="size-4 text-warning" />
            {t("un.silent.toggle")}
          </label>
          {silent && (
            <>
              <ReasonField
                value={reason}
                onChange={(v) => {
                  setReason(v);
                  setLocalError(undefined);
                }}
                error={reasonError}
                busy={flow.busy}
              />
              <p className="flex items-start gap-2 rounded-md bg-warning-surface p-2 text-sm text-warning" data-testid="un-silent-warn">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t("un.silent.warn")}
              </p>
              <p className="text-xs text-fg-muted">{t("un.silent.monitor")}</p>
            </>
          )}
        </div>
      )}
      <p className="text-xs text-fg-muted">{t("un.consent.stepUp")}</p>
    </form>
  );
}

/**
 * Tek "Bağlan" diyaloğu (mimari-p28u §10, V-PU3, AC-430): cihaz kullanıcı durumu, "Kullanıcı varsa izin istenir" bilgisi;
 * `status.silentAllowed` ise "İzin istemeden bağlan" kutusu + gerekçe + uyarı. Gönder → step-up (401'de) → konsol.
 */
export function ConnectDialog({ flow, silentAllowed }: { flow: ConnectFlow; silentAllowed: boolean }) {
  const d = flow.target;
  return (
    <Dialog
      open={d !== null}
      onClose={flow.close}
      title={t("un.consent.title", { name: d?.name ?? "" })}
      description={t("un.consent.desc")}
      testId="un-connect-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={flow.close} disabled={flow.busy} data-testid="un-connect-cancel">
            {t("c.dismiss")}
          </Button>
          <Button type="submit" form={FORM_ID} loading={flow.busy} data-testid="un-connect-submit">
            {!flow.busy && <Plug aria-hidden className="size-4" />}
            {t("un.connect")}
          </Button>
        </>
      }
    >
      {d && <ConnectForm key={d.id} flow={flow} silentAllowed={silentAllowed} />}
    </Dialog>
  );
}
