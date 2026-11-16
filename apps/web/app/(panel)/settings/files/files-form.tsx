"use client";

import { AV_NOT_READY_HINT, FILE_MODE_CONSENT_LABEL, type TenantStorageUsage } from "@remote/contracts/api/fsrv";
import { FILE_RETENTION_DAYS_MAX, FILE_RETENTION_DAYS_MIN } from "@remote/contracts/ws-fsrv";
import { CalendarClock, HardDrive, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { SaveBar } from "@/components/ui/save-bar";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import type { TenantSettingsView } from "@/lib/account/contract";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { buildFilesBody, usagePct, type FilesErrors, type FilesSaved } from "@/lib/fsrv/settings";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useFocusFirstError } from "@/lib/use-focus-error";
import { useHydrated } from "@/lib/use-hydrated";

const FORM_ID = "files-form";

export interface FilesInitial extends FilesSaved {
  /** null → sunucu henüz bildirmiyor (K3 öncesi) — anahtar açılabilir, sunucu 409 ile karar verir. */
  avReady: boolean | null;
  storage: TenantStorageUsage | null;
}

/** Kullanım / kota çubuğu (AC-362); bilgi yoksa kısmi durum. */
function Usage({ storage }: { storage: TenantStorageUsage | null }) {
  const id = useId();
  if (!storage)
    return (
      <Alert tone="info" testId="fset-usage-missing">
        {t("fset.usageMissing")}
      </Alert>
    );
  const pct = usagePct(storage);
  return (
    <div className="flex flex-col gap-1" data-testid="fset-usage">
      <p id={id} className="text-sm text-fg">
        {t("fset.usage", { used: formatBytes(storage.usedBytes), quota: formatBytes(storage.quotaBytes) })}
      </p>
      <progress className="h-2 w-full accent-primary" max={100} value={pct} aria-labelledby={id} />
      {pct >= 90 && (
        <Alert tone="warning" testId="fset-usage-high">
          {t("fset.usageHigh")}
        </Alert>
      )}
    </div>
  );
}

/**
 * P28b Dosyalar ayarı (AC-354). Anahtar kapalıyken açılabilmesi için son ClamAV testi başarılı olmalı (`avReady`); değilse pasif
 * + neden. Kapalı → açık geçişte aydınlatma onay kutusu görünür ve zorunludur (`consentUpdated: true` yalnız bu geçişte gider).
 * Sunucu 409 `AV_NOT_READY` / 400 alan hataları ilgili alana; diğerleri form üstüne. Kirliyken SaveBar + ayrılma uyarısı.
 */
export function FilesForm({ initial, canEdit }: { initial: FilesInitial; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const ready = useHydrated();
  const { formRef, focusError } = useFocusFirstError();
  const [saved, setSaved] = useState<FilesSaved>({ fileServerMode: initial.fileServerMode, fileRetentionDays: initial.fileRetentionDays });
  const [on, setOn] = useState(initial.fileServerMode);
  const [days, setDays] = useState(String(initial.fileRetentionDays));
  const [consent, setConsent] = useState(false);
  const [avReady, setAvReady] = useState(initial.avReady);
  const [storage, setStorage] = useState(initial.storage);
  const [errors, setErrors] = useState<FilesErrors>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const turningOn = on && !saved.fileServerMode;
  const dirty = canEdit && (on !== saved.fileServerMode || days.trim() !== String(saved.fileRetentionDays));
  const avBlocked = avReady === false && !saved.fileServerMode;
  const consentId = useId();

  const reset = () => {
    setOn(saved.fileServerMode);
    setDays(String(saved.fileRetentionDays));
    setConsent(false);
    setErrors({});
    setFormError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !dirty) return;
    const r = buildFilesBody({ on, days, consent }, saved);
    if (!r.body) {
      setErrors(r.errors);
      focusError();
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const v = await api<TenantSettingsView>("PUT", "/settings/tenant", r.body);
      const next = { fileServerMode: v.fileServerMode ?? on, fileRetentionDays: v.fileRetentionDays ?? Number(days) };
      setSaved(next);
      setOn(next.fileServerMode);
      setDays(String(next.fileRetentionDays));
      setConsent(false);
      setErrors({});
      if (v.avReady !== undefined) setAvReady(v.avReady);
      if (v.storage) setStorage(v.storage);
      toast(t("fset.saved"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      const f = err instanceof ApiError && (err.status === 400 || err.status === 409) ? err.fields : undefined;
      if (f && (f.fileServerMode || f.consentUpdated || f.fileRetentionDays)) {
        setErrors({ fileServerMode: f.fileServerMode, consentUpdated: f.consentUpdated, fileRetentionDays: f.fileRetentionDays });
        if (err instanceof ApiError && err.code === "AV_NOT_READY") setAvReady(false);
        focusError();
      } else setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="fset-h"
      className="mt-6 flex max-w-3xl flex-col gap-6 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6"
      data-testid="files-settings"
    >
      <h2 id="fset-h" className="flex items-center gap-2 text-base font-semibold text-fg">
        <ShieldCheck aria-hidden className="size-5 text-fg-muted" />
        {t("fset.section")}
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
        data-testid="files-form"
        data-ready={ready ? "true" : "false"}
      >
        <div className="flex flex-col gap-2">
          <Switch
            label={t("fset.mode")}
            checked={on}
            onChange={(v) => {
              setOn(v);
              setErrors((x) => ({ ...x, fileServerMode: undefined, consentUpdated: undefined }));
            }}
            disabled={!canEdit || busy || (avBlocked && !on)}
            description={avBlocked ? AV_NOT_READY_HINT : t("fset.modeHint")}
            onText={t("fset.on")}
            offText={t("fset.off")}
            testId="fset-mode"
          />
          {errors.fileServerMode && (
            <p className="text-xs font-medium text-danger" role="alert" data-testid="fset-mode-error">
              {errors.fileServerMode}
            </p>
          )}
          {turningOn && (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-canvas p-3" data-testid="fset-consent-box">
              <p className="text-xs text-fg-muted">{t("fset.consentHint")}</p>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => {
                    setConsent(e.target.checked);
                    setErrors((x) => ({ ...x, consentUpdated: undefined }));
                  }}
                  disabled={busy}
                  aria-invalid={errors.consentUpdated ? true : undefined}
                  aria-describedby={errors.consentUpdated ? consentId : undefined}
                  className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary"
                  data-testid="fset-consent"
                />
                <span>{FILE_MODE_CONSENT_LABEL}</span>
              </label>
              {errors.consentUpdated && (
                <p id={consentId} className="text-xs font-medium text-danger" data-testid="fset-consent-error">
                  {errors.consentUpdated}
                </p>
              )}
            </div>
          )}
        </div>
        <fieldset className="flex min-w-0 flex-col gap-4" aria-labelledby="fset-ret">
          <legend id="fset-ret" className="mb-4 flex items-center gap-2 text-base font-semibold text-fg">
            <CalendarClock aria-hidden className="size-5 text-fg-muted" />
            {t("fset.retention")}
          </legend>
          <TextField
            className="max-w-xs"
            label={t("fset.days")}
            name="fileRetentionDays"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={1}
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              setErrors((x) => ({ ...x, fileRetentionDays: undefined }));
            }}
            error={errors.fileRetentionDays}
            hint={t("fset.daysHint", { min: FILE_RETENTION_DAYS_MIN, max: FILE_RETENTION_DAYS_MAX })}
            disabled={!canEdit || busy}
            data-testid="fset-days"
          />
        </fieldset>
        <fieldset className="flex min-w-0 flex-col gap-2" aria-labelledby="fset-st">
          <legend id="fset-st" className="mb-4 flex items-center gap-2 text-base font-semibold text-fg">
            <HardDrive aria-hidden className="size-5 text-fg-muted" />
            {t("fset.storage")}
          </legend>
          <Usage storage={storage} />
        </fieldset>
      </form>
      <SaveBar dirty={dirty} busy={busy} formId={FORM_ID} onReset={reset} message={t("fset.unsaved")} leaveBody={t("fset.leaveBody")} />
    </section>
  );
}
