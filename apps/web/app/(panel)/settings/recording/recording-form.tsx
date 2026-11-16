"use client";

import {
  REC_RETENTION_FORWARD_HINT,
  REC_SOLE_MANAGER_WARNING,
  REC_UNATTENDED_REQUIRES_ENABLED_MESSAGE,
  type RecordingSettingsView,
} from "@remote/contracts/api/recording";
import { FILE_MODE_CONSENT_LABEL } from "@remote/contracts/api/fsrv";
import { REC_RETENTION_MIN } from "@remote/contracts/ws-rec";
import { CalendarClock, HardDrive, Info, MonitorCog, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { SaveBar } from "@/components/ui/save-bar";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatBytes, formatDateTime } from "@/lib/format";
import { usagePct } from "@/lib/fsrv/settings";
import { t } from "@/lib/i18n";
import {
  buildRecordingBody,
  effectiveUnattended,
  isDirty,
  type RecSettingsDraft,
  type RecSettingsErrors,
  type RecSettingsSaved,
} from "@/lib/rec/settings";
import { useFocusFirstError } from "@/lib/use-focus-error";
import { useHydrated } from "@/lib/use-hydrated";

const FORM_ID = "rec-settings-form";

const draftOf = (s: RecSettingsSaved): RecSettingsDraft => ({
  enabled: s.enabled,
  days: String(s.retentionDays),
  unattended: s.unattendedEnabled,
  consent: false,
  notice: false,
});

function AckBox(p: {
  testId: string;
  intro: string;
  label: string;
  checked: boolean;
  error?: string;
  busy: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-canvas p-3" data-testid={`${p.testId}-box`}>
      <p className="text-xs text-fg-muted">{p.intro}</p>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-fg">
        <input
          type="checkbox"
          checked={p.checked}
          onChange={(e) => p.onChange(e.target.checked)}
          disabled={p.busy}
          aria-invalid={p.error ? true : undefined}
          aria-describedby={p.error ? id : undefined}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary"
          data-testid={p.testId}
        />
        <span>{p.label}</span>
      </label>
      {p.error && (
        <p id={id} className="text-xs font-medium text-danger" data-testid={`${p.testId}-error`}>
          {p.error}
        </p>
      )}
    </div>
  );
}

function Usage({ storage }: { storage: RecordingSettingsView["storage"] }) {
  const id = useId();
  const pct = usagePct(storage);
  return (
    <div className="flex flex-col gap-1" data-testid="rset-usage">
      <p id={id} className="text-sm text-fg">
        {t("fset.usage", { used: formatBytes(storage.usedBytes), quota: formatBytes(storage.quotaBytes) })}
      </p>
      <progress className="h-2 w-full accent-primary" max={100} value={pct} aria-labelledby={id} />
      {pct >= 90 && (
        <Alert tone="warning" testId="rset-usage-high">
          {t("fset.usageHigh")}
        </Alert>
      )}
    </div>
  );
}

/** Kayıt/hata eşlemesi: sunucu `fields.*` ilgili alana, diğerleri form üstüne. */
function useSave(saved: RecSettingsSaved, maxDays: number, onSaved: (v: RecordingSettingsView) => void) {
  const router = useRouter();
  const toast = useToast();
  const { formRef, focusError } = useFocusFirstError();
  const [errors, setErrors] = useState<RecSettingsErrors>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (d: RecSettingsDraft) => {
    const r = buildRecordingBody(d, saved, maxDays);
    if (!r.body) {
      setErrors(r.errors);
      return focusError();
    }
    setBusy(true);
    setFormError(null);
    try {
      const v = await api<RecordingSettingsView>("PUT", "/settings/recording", r.body);
      setErrors({});
      onSaved(v);
      toast(t("rset.saved"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      const f = err instanceof ApiError && err.status === 400 ? err.fields : undefined;
      const keys = ["enabled", "retentionDays", "unattendedEnabled", "consentUpdated", "employeeNoticeAck"] as const;
      if (f && keys.some((k) => f[k])) {
        setErrors(Object.fromEntries(keys.filter((k) => f[k]).map((k) => [k, f[k]])));
        focusError();
      } else setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };
  return { formRef, errors, setErrors, formError, setFormError, busy, save };
}

/**
 * Oturum kaydı formu (AC-380, 447). Açma geçişlerinde ilgili onay kutusu görünür ve zorunludur; gözetimsiz anahtarı açmak
 * step-up ister (lib/api 401 → StepUpDialog → tek tekrar). Ana anahtar kapanınca gözetimsiz de kapanır. Kirliyken SaveBar.
 */
export function RecordingForm({ initial, canEdit }: { initial: RecordingSettingsView; canEdit: boolean }) {
  const ready = useHydrated();
  const [view, setView] = useState(initial);
  const saved: RecSettingsSaved = view;
  const [d, setD] = useState<RecSettingsDraft>(() => draftOf(initial));
  const { formRef, errors, setErrors, formError, setFormError, busy, save } = useSave(saved, view.maxRetentionDays, (v) => {
    setView(v);
    setD(draftOf(v));
  });
  const dirty = canEdit && isDirty(d, saved);
  const unattended = effectiveUnattended(d);
  const set = (patch: Partial<RecSettingsDraft>, clear: (keyof RecSettingsErrors)[]) => {
    setD((x) => ({ ...x, ...patch }));
    setErrors((e) => ({ ...e, ...Object.fromEntries(clear.map((k) => [k, undefined])) }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy && dirty) void save(d);
  };
  const reset = () => {
    setD(draftOf(saved));
    setErrors({});
    setFormError(null);
  };
  const disabled = !canEdit || busy;

  return (
    <section
      aria-labelledby="rset-h"
      className="mt-6 flex max-w-3xl flex-col gap-6 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6"
      data-testid="rec-settings"
    >
      <h2 id="rset-h" className="flex items-center gap-2 text-base font-semibold text-fg">
        <Video aria-hidden className="size-5 text-fg-muted" />
        {t("rset.section")}
      </h2>
      {!canEdit && (
        <Alert tone="warning" testId="settings-readonly">
          {t("set.readonly")}
        </Alert>
      )}
      <FormError error={formError} />
      <form
        id={FORM_ID}
        ref={formRef}
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-6"
        data-testid="rec-settings-form"
        data-ready={ready ? "true" : "false"}
      >
        <div className="flex flex-col gap-2">
          <Switch
            label={t("rset.switch")}
            checked={d.enabled}
            onChange={(v) => set({ enabled: v, ...(v ? {} : { unattended: false }) }, ["enabled", "consentUpdated", "unattendedEnabled"])}
            disabled={disabled}
            description={t("rset.switchHint")}
            onText={t("rset.on")}
            offText={t("rset.off")}
            testId="rset-enabled"
          />
          {d.enabled && !saved.enabled && (
            <AckBox
              testId="rset-consent"
              intro={t("rset.consentHint")}
              label={FILE_MODE_CONSENT_LABEL}
              checked={d.consent}
              error={errors.consentUpdated}
              busy={busy}
              onChange={(v) => set({ consent: v }, ["consentUpdated"])}
            />
          )}
          <p className="flex items-start gap-2 text-xs text-fg-muted" data-testid="rset-safari">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t("rset.safari")}
          </p>
        </div>

        <fieldset className="flex min-w-0 flex-col gap-4" aria-labelledby="rset-ret">
          <legend id="rset-ret" className="mb-4 flex items-center gap-2 text-base font-semibold text-fg">
            <CalendarClock aria-hidden className="size-5 text-fg-muted" />
            {t("rset.retention")}
          </legend>
          <TextField
            className="max-w-xs"
            label={t("rset.days")}
            name="retentionDays"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            value={d.days}
            onChange={(e) => set({ days: e.target.value }, ["retentionDays"])}
            error={errors.retentionDays}
            hint={`${t("rset.daysHint", { min: REC_RETENTION_MIN, max: view.maxRetentionDays })} ${REC_RETENTION_FORWARD_HINT}.`}
            disabled={disabled}
            data-testid="rset-days"
          />
        </fieldset>

        <fieldset className="flex min-w-0 flex-col gap-2" aria-labelledby="rset-un">
          <legend id="rset-un" className="mb-4 flex items-center gap-2 text-base font-semibold text-fg">
            <MonitorCog aria-hidden className="size-5 text-fg-muted" />
            {t("rset.unattended")}
          </legend>
          <Switch
            label={t("rset.unSwitch")}
            checked={unattended}
            onChange={(v) => set({ unattended: v }, ["unattendedEnabled", "employeeNoticeAck"])}
            disabled={disabled || !d.enabled}
            description={d.enabled ? t("rset.unHint") : REC_UNATTENDED_REQUIRES_ENABLED_MESSAGE}
            onText={t("rset.on")}
            offText={t("rset.off")}
            testId="rset-unattended"
          />
          {errors.unattendedEnabled && (
            <p className="text-xs font-medium text-danger" role="alert" data-testid="rset-unattended-error">
              {errors.unattendedEnabled}
            </p>
          )}
          {unattended && !saved.unattendedEnabled && (
            <AckBox
              testId="rset-notice"
              intro={t("rset.unAckIntro")}
              label={t("rset.unAck")}
              checked={d.notice}
              error={errors.employeeNoticeAck}
              busy={busy}
              onChange={(v) => set({ notice: v }, ["employeeNoticeAck"])}
            />
          )}
          {saved.unattendedEnabled && view.unattendedAckAt && (
            <p className="text-sm text-fg-muted" data-testid="rset-ack-at">
              {t("rset.ackAt", { at: formatDateTime(view.unattendedAckAt) })}
            </p>
          )}
          {view.soleManager && (
            <Alert tone="warning" testId="rset-sole-manager">
              {REC_SOLE_MANAGER_WARNING}
            </Alert>
          )}
        </fieldset>

        <fieldset className="flex min-w-0 flex-col gap-2" aria-labelledby="rset-st">
          <legend id="rset-st" className="mb-4 flex items-center gap-2 text-base font-semibold text-fg">
            <HardDrive aria-hidden className="size-5 text-fg-muted" />
            {t("rset.storage")}
          </legend>
          <Usage storage={view.storage} />
        </fieldset>
      </form>
      <SaveBar dirty={dirty} busy={busy} formId={FORM_ID} onReset={reset} message={t("rset.unsaved")} leaveBody={t("rset.leaveBody")} />
    </section>
  );
}
