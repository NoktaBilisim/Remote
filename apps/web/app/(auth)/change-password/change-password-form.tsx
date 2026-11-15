"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type RefObject } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { TextField } from "@/components/ui/text-field";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { parsePasswordChange } from "@/lib/auth-schema";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { focusFirstField, NewPasswordFields, PasswordSubmit } from "../password-fields";

function useChangePassword(formRef: RefObject<HTMLFormElement | null>, onDone?: () => void) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<UiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function onError(err: unknown) {
    // Sözleşme: yanlış mevcut şifre → 400 (fields.current); 401 → oturum düşmüş
    if (isUnauthenticated(err)) {
      router.replace(EXPIRED_LOGIN_PATH);
      return;
    }
    if (err instanceof ApiError && err.status === 400) {
      setErrors(err.fields ?? { current: t("pw.error.current") });
      setSubmitting(false);
      return;
    }
    setServerError(toUiError(err));
    setSubmitting(false);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || done) return;
    const parsed = parsePasswordChange(Object.fromEntries(new FormData(e.currentTarget)));
    setServerError(null);
    if (!parsed.ok) {
      const fe = parsed.errors;
      setErrors(fe);
      focusFirstField(formRef, ["current", "next", "confirm"], fe);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await api<void>("POST", "/auth/password/change", parsed.value);
      if (onDone) {
        formRef.current?.reset();
        setSubmitting(false);
        onDone();
        return;
      }
      setDone(true);
      router.replace("/");
      router.refresh();
    } catch (err) {
      onError(err);
    }
  }

  return { errors, serverError, submitting, done, onSubmit };
}

/**
 * AC-66: POST /auth/password/change { current, next } → 204 (+ yeni oturum çerezi; diğer oturumlar kapanır).
 * `onDone` verilirse (P10 Hesap güvenliği sayfası) yönlendirme yerine form temizlenir ve çağıran bildirim gösterir.
 */
export function ChangePasswordForm({ onDone }: { onDone?: () => void } = {}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { errors, serverError, submitting, done, onSubmit } = useChangePassword(formRef, onDone);

  if (done) return <Alert tone="success">{t("pw.success")}</Alert>;

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={t("pw.title")}>
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
      <PasswordSubmit submitting={submitting} label={t("pw.submit")} />
    </form>
  );
}
