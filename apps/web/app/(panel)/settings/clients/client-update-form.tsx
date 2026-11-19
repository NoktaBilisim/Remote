"use client";

import type { ClientUpdateSettings } from "@remote/contracts/api/update";
import { Info, MonitorDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { SaveBar } from "@/components/ui/save-bar";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { useHydrated } from "@/lib/use-hydrated";

const FORM_ID = "client-update-form";

/**
 * İstemci otomatik güncelleme anahtarı (AC-485). İyimser kayıt yok: anahtar taslağı değiştirir, Kaydet (SaveBar) PUT eder,
 * başarıda toast; kirliyken ayrılma uyarısı SaveBar'da. Sunucu `fields.autoUpdate` alanın altına, diğer hatalar form üstüne.
 */
export function ClientUpdateForm({ initial, canEdit }: { initial: ClientUpdateSettings; canEdit: boolean }) {
  const ready = useHydrated();
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState(initial.autoUpdate);
  const [value, setValue] = useState(initial.autoUpdate);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<UiError | null>(null);
  const dirty = canEdit && value !== saved;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setFormError(null);
    setFieldError(undefined);
    try {
      const r = await api<ClientUpdateSettings>("PUT", "/settings/client-update", { autoUpdate: value });
      setSaved(r.autoUpdate);
      setValue(r.autoUpdate);
      toast(t("upd.set.saved"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      const f = err instanceof ApiError && err.status === 400 ? err.fields?.autoUpdate : undefined;
      if (f) setFieldError(f);
      else setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setValue(saved);
    setFieldError(undefined);
    setFormError(null);
  };

  return (
    <section
      aria-labelledby="upd-set-h"
      className="mt-6 flex max-w-3xl flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6"
      data-testid="client-update-settings"
    >
      <h2 id="upd-set-h" className="flex items-center gap-2 text-base font-semibold text-fg">
        <MonitorDown aria-hidden className="size-5 text-fg-muted" />
        {t("upd.set.section")}
      </h2>
      {!canEdit && (
        <Alert tone="warning" testId="settings-readonly">
          {t("set.readonly")}
        </Alert>
      )}
      <FormError error={formError} />
      <form
        id={FORM_ID}
        onSubmit={(e) => void submit(e)}
        noValidate
        className="flex flex-col gap-2"
        data-testid="client-update-form"
        data-ready={ready ? "true" : "false"}
      >
        <Switch
          label={t("upd.set.switch")}
          checked={value}
          onChange={(v) => {
            setValue(v);
            setFieldError(undefined);
          }}
          disabled={!canEdit || busy}
          description={t("upd.set.hint")}
          onText={t("rset.on")}
          offText={t("rset.off")}
          testId="upd-auto"
        />
        {fieldError && (
          <p className="text-xs font-medium text-danger" role="alert" data-testid="upd-auto-error">
            {fieldError}
          </p>
        )}
      </form>
      <p className="flex items-start gap-2 text-xs text-fg-muted" data-testid="upd-set-note">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t("upd.set.note")}
      </p>
      <SaveBar
        dirty={dirty}
        busy={busy}
        formId={FORM_ID}
        onReset={reset}
        message={t("upd.set.unsaved")}
        leaveBody={t("upd.set.leaveBody")}
      />
    </section>
  );
}
