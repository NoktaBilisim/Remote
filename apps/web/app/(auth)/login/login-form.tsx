"use client";

import { KeyRound, LogIn } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { api, ApiError, safeNext } from "@/lib/api";
import type { LoginResponse } from "@/lib/account/contract";
import { fieldErrors, loginInput } from "@/lib/auth-schema";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

/** AC-64/65: giriş formu — alan bazlı doğrulama, 401/423/429/ağ hatası durumları. */
export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<UiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = loginInput.safeParse(data);
    setServerError(null);
    if (!parsed.success) {
      const fe = fieldErrors(parsed.error, data);
      setErrors(fe);
      const first = Object.keys(fe)[0];
      if (first) formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const res = await api<LoginResponse>("POST", "/auth/login", parsed.data);
      const target = safeNext(next, window.location.origin);
      // P10 (AC-67): 2FA kodu adımı → zorunlu şifre değişimi → zorunlu 2FA kurulumu → hedef (panel kabuğu da aynı sırayı uygular)
      const keepNext = target === "/" ? "" : `?next=${encodeURIComponent(target)}`;
      if (res.mfaRequired && !res.mfaSetupRequired) router.replace(`/login/2fa${keepNext}`);
      else if (res.mustChangePassword) router.replace("/change-password");
      else if (res.mfaSetupRequired) router.replace("/2fa/setup");
      else router.replace(target);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields) setErrors(err.fields);
      setServerError(toUiError(err, { 401: t("login.error.invalid") }));
      setSubmitting(false);
    }
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={t("login.title")}>
      <FormError error={serverError} />
      <TextField
        name="login"
        label={t("login.login")}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        disabled={submitting}
        error={errors.login}
      />
      <TextField
        name="password"
        type="password"
        label={t("login.password")}
        autoComplete="current-password"
        required
        revealable
        disabled={submitting}
        error={errors.password}
      />
      <Button type="submit" loading={submitting} className="mt-2 w-full">
        {!submitting && <LogIn aria-hidden className="size-4" />}
        {submitting ? t("login.submitting") : t("login.submit")}
      </Button>
      {/* AC-66: e-posta ile şifre sıfırlama */}
      <Link
        href="/forgot-password"
        className="inline-flex min-h-11 items-center justify-center gap-2 self-center rounded-md px-3 text-sm font-medium text-primary hover:underline"
        data-testid="forgot-link"
      >
        <KeyRound aria-hidden className="size-4" />
        {t("login.forgot")}
      </Link>
    </form>
  );
}
