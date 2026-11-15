"use client";

import { Paperclip, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { SaveBar } from "@/components/ui/save-bar";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import type { TenantSettingsView } from "@/lib/account/contract";
import {
  checkLimits,
  LIMIT_FIELDS,
  LIMITS,
  limitFieldErrors,
  type LimitErrors,
  type LimitField,
  type LimitValues,
} from "@/lib/account/limits";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatNumber } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { useHydrated } from "@/lib/use-hydrated";

const FORM_ID = "limits-form";
const pick = (s: LimitValues): LimitValues => ({
  sessionTtlMin: s.sessionTtlMin,
  maxActiveHours: s.maxActiveHours,
  maxOpenSessions: s.maxOpenSessions,
  maxFileMb: s.maxFileMb,
});
const toText = (v: LimitValues) => Object.fromEntries(LIMIT_FIELDS.map((k) => [k, String(v[k])])) as Record<LimitField, string>;

const GROUPS: { id: string; title: MessageKey; Icon: typeof Timer; fields: LimitField[] }[] = [
  { id: "lim-session", title: "gen.sessions", Icon: Timer, fields: ["sessionTtlMin", "maxActiveHours", "maxOpenSessions"] },
  { id: "lim-file", title: "gen.files", Icon: Paperclip, fields: ["maxFileMb"] },
];

/**
 * P14b (AC-224): firma oturum ve dosya sınırları — PUT /settings/tenant (settings.edit; salt okunurda alanlar pasif + uyarı).
 * İstemci doğrulaması contracts şemasıyla (istek gönderilmez, ilk hatalı alana odak); sunucu 400 `fields.<alan>` ilgili alana,
 * diğer hatalar form üstüne. Kirliyken SaveBar + ayrılma uyarısı. Audit (eski → yeni) sunucuda.
 */
export function LimitsForm({ initial, canEdit }: { initial: TenantSettingsView; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const ready = useHydrated();
  const [saved, setSaved] = useState<LimitValues>(() => pick(initial));
  const [values, setValues] = useState(() => toText(pick(initial)));
  const [errors, setErrors] = useState<LimitErrors>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusErr, setFocusErr] = useState(0);
  const refs = useRef<Partial<Record<LimitField, HTMLInputElement | null>>>({});
  const dirty = canEdit && LIMIT_FIELDS.some((k) => values[k].trim() !== String(saved[k]));

  useEffect(() => {
    if (!focusErr) return;
    const first = LIMIT_FIELDS.find((k) => errors[k]);
    if (first) refs.current[first]?.focus();
    // yalnız yeni hata turunda odak taşınır
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusErr]);

  const reset = () => {
    setValues(toText(saved));
    setErrors({});
    setFormError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !dirty) return;
    const c = checkLimits(values, saved);
    if (!c.body) {
      setErrors(c.errors);
      setFocusErr((n) => n + 1);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const r = await api<TenantSettingsView>("PUT", "/settings/tenant", c.body);
      const next = pick(r);
      setSaved(next);
      setValues(toText(next));
      setErrors({});
      toast(t("gen.saved"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      const fe = err instanceof ApiError && err.status === 400 ? limitFieldErrors(err.fields) : {};
      if (Object.keys(fe).length > 0) {
        setErrors(fe);
        setFocusErr((n) => n + 1);
      } else setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="gen-h"
      className="mt-6 flex max-w-3xl flex-col gap-6 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6"
      data-testid="limits-section"
    >
      <h2 id="gen-h" className="sr-only">
        {t("gen.title")}
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
        data-testid="limits-form"
        data-ready={ready ? "true" : "false"}
        className="flex flex-col gap-6"
      >
        {GROUPS.map(({ id, title, Icon, fields }) => (
          <fieldset key={id} className="flex min-w-0 flex-col gap-4" aria-labelledby={id}>
            <legend id={id} className="mb-4 flex items-center gap-2 text-base font-semibold text-fg">
              <Icon aria-hidden className="size-5 text-fg-muted" />
              {t(title)}
            </legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fields.map((k) => (
                <TextField
                  key={k}
                  ref={(el) => {
                    refs.current[k] = el;
                  }}
                  label={t(`gen.f.${k}` as MessageKey)}
                  name={k}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={values[k]}
                  onChange={(e) => {
                    const v = e.target.value;
                    setValues((s) => ({ ...s, [k]: v }));
                    setErrors((s) => ({ ...s, [k]: undefined }));
                  }}
                  error={errors[k]}
                  hint={t(`gen.h.${k}` as MessageKey, { min: formatNumber(LIMITS[k].min), max: formatNumber(LIMITS[k].max) })}
                  disabled={!canEdit || busy}
                  data-testid={`limit-${k}`}
                />
              ))}
            </div>
          </fieldset>
        ))}
      </form>
      <SaveBar dirty={dirty} busy={busy} formId={FORM_ID} onReset={reset} message={t("gen.unsaved")} leaveBody={t("gen.leaveBody")} />
    </section>
  );
}
