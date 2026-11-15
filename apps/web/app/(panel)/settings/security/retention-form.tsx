"use client";

import { CalendarClock, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SaveBar } from "@/components/ui/save-bar";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import type { TenantSettingsView } from "@/lib/account/contract";
import { checkRetentionDays, RETENTION_DEFAULT_DAYS, RETENTION_LIMITS } from "@/lib/account/retention";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useHydrated } from "@/lib/use-hydrated";

const FORM_ID = "retention-form";

/**
 * P13a (AC-197): firma veri saklama süresi (gün, 90–730). PUT /settings/tenant `{ retentionDays }` (settings.edit; salt
 * okunurda alan pasif — üstteki 2FA bölümü "yalnız görüntüleme" uyarısını zaten gösterir). Kirliyken SaveBar + ayrılma uyarısı;
 * istemci aralık kontrolü istek göndermez; sunucu 400 `fields.retentionDays` alana, diğer hatalar form üstüne.
 */
export function RetentionForm({ initial, canEdit }: { initial: number; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const ready = useHydrated();
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(String(initial));
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusErr, setFocusErr] = useState(0);
  /** Düşürmede onay (QA): kayıttan önce bekleyen yeni değer; artırmada onay yok. */
  const [confirm, setConfirm] = useState<number | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const dirty = canEdit && value.trim() !== String(saved);

  useEffect(() => {
    if (focusErr) ref.current?.focus();
  }, [focusErr]);

  const reset = () => {
    setValue(String(saved));
    setFieldError(undefined);
    setFormError(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !dirty) return;
    const c = checkRetentionDays(value);
    if (c.days === undefined) {
      setFieldError(c.error);
      setFocusErr((n) => n + 1);
      return;
    }
    // Süre kısalırsa bu geceki işte daha eski kayıtlar geri alınamaz biçimde anonimleşir → önce onay
    if (c.days < saved) setConfirm(c.days);
    else void save(c.days);
  };

  const save = async (days: number) => {
    setBusy(true);
    setFormError(null);
    try {
      const r = await api<TenantSettingsView>("PUT", "/settings/tenant", { retentionDays: days });
      setSaved(r.retentionDays);
      setValue(String(r.retentionDays));
      setFieldError(undefined);
      toast(t("ret.saved", { days: formatNumber(r.retentionDays) }));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.status === 400 && err.fields?.retentionDays) {
        setFieldError(err.fields.retentionDays);
        setFocusErr((n) => n + 1);
      } else setFormError(toUiError(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <section
      aria-labelledby="ret-h"
      className="flex max-w-3xl flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6"
      data-testid="retention-section"
    >
      <h2 id="ret-h" className="flex items-center gap-2 text-base font-semibold text-fg">
        <CalendarClock aria-hidden className="size-5 text-fg-muted" />
        {t("ret.title")}
      </h2>
      <FormError error={formError} />
      <form id={FORM_ID} onSubmit={submit} noValidate data-testid="retention-form" data-ready={ready ? "true" : "false"}>
        <TextField
          ref={ref}
          className="max-w-xs"
          label={t("ret.label")}
          name="retentionDays"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setFieldError(undefined);
          }}
          error={fieldError}
          hint={t("ret.hint", { min: RETENTION_LIMITS.min, max: RETENTION_LIMITS.max, def: RETENTION_DEFAULT_DAYS })}
          disabled={!canEdit || busy}
          maxLength={4}
          data-testid="retention-days"
        />
      </form>
      <Dialog
        open={confirm !== null}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        role="alertdialog"
        size="sm"
        testId="retention-confirm"
        title={t("ret.confirmTitle")}
        description={confirm !== null ? t("ret.confirmBody", { from: formatNumber(saved), to: formatNumber(confirm) }) : undefined}
        footer={
          <>
            <Button
              variant="secondary"
              data-autofocus
              disabled={busy}
              className="sm:ml-auto"
              onClick={() => setConfirm(null)}
              data-testid="retention-confirm-cancel"
            >
              {t("rq.rj.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => confirm !== null && void save(confirm)}
              data-testid="retention-confirm-ok"
            >
              {!busy && <TriangleAlert aria-hidden className="size-4" />}
              {t("ret.confirmOk")}
            </Button>
          </>
        }
      />
      <SaveBar
        dirty={dirty && confirm === null}
        busy={busy}
        formId={FORM_ID}
        onReset={reset}
        message={t("ret.unsaved")}
        leaveBody={t("ret.leaveBody")}
      />
    </section>
  );
}
