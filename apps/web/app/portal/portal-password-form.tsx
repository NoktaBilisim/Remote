"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { TextField } from "@/components/ui/text-field";
import { ApiError } from "@/lib/api";
import { parsePasswordChange } from "@/lib/auth-schema";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { portalApi, portalExpiredPath } from "@/lib/portal/api";
import { PORTAL_HOME } from "@/lib/portal/paths";
import { focusFirstField, NewPasswordFields, PasswordSubmit } from "../(auth)/password-fields";

/**
 * Portal şifre değişimi (mimari-p21 §4.2 `POST /portal/account/password`, `passwordChangeInputSchema` aynen): mevcut + yeni +
 * tekrar. 400 `fields.current` alana; 401 (oturum düştü / 5 hatalı → oturum iptal) portal girişine. Başarıda sunucu yeni
 * çerezleri yazar; `onDone` yoksa (zorunlu değişim) portala geçilir, varsa form temizlenir ve çağıran bildirim gösterir.
 */
export function PortalPasswordForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<UiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const parsed = parsePasswordChange(Object.fromEntries(new FormData(e.currentTarget)));
    setServerError(null);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      focusFirstField(formRef, ["current", "next", "confirm"], parsed.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await portalApi<void>("POST", "/portal/account/password", parsed.value);
      if (onDone) {
        formRef.current?.reset();
        setSubmitting(false);
        onDone();
        return;
      }
      router.replace(PORTAL_HOME);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.status === 401) return router.replace(portalExpiredPath());
      if (err instanceof ApiError && err.status === 400) {
        setErrors(err.fields ?? { current: t("pw.error.current") });
        return;
      }
      setServerError(toUiError(err));
    }
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={t("portal.pw.title")}>
      <FormError error={serverError} />
      <TextField
        name="current"
        type="password"
        label={t("pw.current")}
        autoComplete="current-password"
        required
        revealable
        disabled={submitting}
        error={errors.current}
      />
      <NewPasswordFields submitting={submitting} errors={errors} />
      <PasswordSubmit submitting={submitting} label={t("pw.submit")} testId="portal-pw-submit" />
    </form>
  );
}
