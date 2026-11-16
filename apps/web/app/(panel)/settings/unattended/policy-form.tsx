"use client";

import { EyeOff, Info, MailCheck, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { SaveBar } from "@/components/ui/save-bar";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { unattendedUiError } from "@/lib/unattended/errors";
import type { UnattendedPolicyView } from "@/lib/unattended/contract";
import { POLICY_ACK_REQUIRED_MESSAGE } from "@remote/contracts/api/unattended";
import { useHydrated } from "@/lib/use-hydrated";

const FORM_ID = "un-policy-form";

/** Açıklama satırları (KVKK, gizli izleme yok, panelde kullanıcı durumu — D-P28u-6, dört göz). */
function PolicyNotes() {
  const rows = [
    { Icon: ShieldAlert, key: "un.policy.kvkk" as const },
    { Icon: EyeOff, key: "un.policy.noSecret" as const },
    { Icon: Info, key: "un.policy.userState" as const },
    { Icon: MailCheck, key: "un.policy.fourEyes" as const },
    { Icon: Info, key: "un.policy.perm" as const },
  ];
  return (
    <ul className="flex flex-col gap-2 text-sm text-fg-muted" data-testid="un-policy-notes">
      {rows.map(({ Icon, key }) => (
        <li key={key} className="flex items-start gap-2">
          <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t(key)}
        </li>
      ))}
    </ul>
  );
}

function AckBox({ checked, onChange, error, busy }: { checked: boolean; onChange: (v: boolean) => void; error?: string; busy: boolean }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-canvas p-3" data-testid="un-policy-ack-box">
      <p className="text-xs text-fg-muted">{t("un.policy.ackIntro")}</p>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-fg">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? id : undefined}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary"
          data-testid="un-policy-ack"
        />
        <span>{t("un.policy.ack")}</span>
      </label>
      {error && (
        <p id={id} className="text-xs font-medium text-danger" data-testid="un-policy-ack-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Gözetimsiz politika formu (AC-436). Açma: aydınlatma kutusu zorunlu → Kaydet → 401'de `StepUpDialog` (lib/api) → yineleme.
 * Kapatma onaysız (güvenli yön; `ack` gönderilmez). Sunucu `fields.ack` alana, diğer hatalar form üstüne. Kirliyken SaveBar.
 */
export function PolicyForm({ initial, canEdit }: { initial: UnattendedPolicyView; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const ready = useHydrated();
  const [saved, setSaved] = useState(initial);
  const [on, setOn] = useState(initial.silentEnabled);
  const [ack, setAck] = useState(false);
  const [ackError, setAckError] = useState<string | undefined>();
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const turningOn = on && !saved.silentEnabled;
  const dirty = canEdit && on !== saved.silentEnabled;

  const reset = () => {
    setOn(saved.silentEnabled);
    setAck(false);
    setAckError(undefined);
    setFormError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !dirty) return;
    if (turningOn && !ack) return setAckError(POLICY_ACK_REQUIRED_MESSAGE);
    setBusy(true);
    setFormError(null);
    try {
      const v = await api<UnattendedPolicyView>(
        "PUT",
        "/unattended/policy",
        on ? { silentEnabled: true, ack: true } : { silentEnabled: false },
      );
      setSaved(v);
      setOn(v.silentEnabled);
      setAck(false);
      setAckError(undefined);
      toast(t(v.silentEnabled ? "un.policy.savedOn" : "un.policy.savedOff"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      const f = err instanceof ApiError && err.status === 400 ? err.fields?.ack : undefined;
      if (f) setAckError(f);
      else setFormError(err instanceof ApiError ? unattendedUiError(err) : toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="un-policy-h"
      className="mt-6 flex max-w-3xl flex-col gap-6 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6"
      data-testid="un-policy"
    >
      <h2 id="un-policy-h" className="flex items-center gap-2 text-base font-semibold text-fg">
        <EyeOff aria-hidden className="size-5 text-fg-muted" />
        {t("un.policy.section")}
      </h2>
      {!canEdit && (
        <Alert tone="warning" testId="settings-readonly">
          {t("set.readonly")}
        </Alert>
      )}
      <FormError error={formError} />
      <form
        id={FORM_ID}
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4"
        data-testid="un-policy-form"
        data-ready={ready ? "true" : "false"}
      >
        <Switch
          label={t("un.policy.switch")}
          checked={on}
          onChange={(v) => {
            setOn(v);
            setAckError(undefined);
          }}
          disabled={!canEdit || busy}
          description={t("un.policy.switchHint")}
          onText={t("un.policy.on")}
          offText={t("un.policy.off")}
          testId="un-policy-switch"
        />
        {turningOn && <AckBox checked={ack} onChange={(v) => (setAck(v), setAckError(undefined))} error={ackError} busy={busy} />}
        {saved.silentEnabled && saved.ackAt && (
          <p className="text-sm text-fg-muted" data-testid="un-policy-last">
            {t("un.policy.lastAck", { name: saved.ackByName ?? t("un.policy.deletedUser"), at: formatDateTime(saved.ackAt) })}
          </p>
        )}
      </form>
      <PolicyNotes />
      <SaveBar
        dirty={dirty}
        busy={busy}
        formId={FORM_ID}
        onReset={reset}
        message={t("un.policy.unsaved")}
        leaveBody={t("un.policy.leaveBody")}
      />
    </section>
  );
}
