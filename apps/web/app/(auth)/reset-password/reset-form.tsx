"use client";

import { ArrowLeft, KeyRound, Link2Off } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { RESET_TOKEN_RE } from "@/lib/account/contract";
import { readResetToken } from "@/lib/account/reset-token";
import { api, ApiError } from "@/lib/api";
import { parseNewPassword } from "@/lib/auth-schema";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { focusFirstField, NewPasswordFields, PasswordSubmit } from "../password-fields";

type TokenState = { kind: "reading" } | { kind: "invalid" } | { kind: "ok"; token: string };

function useResetToken() {
  const [token, setToken] = useState<TokenState>({ kind: "reading" });
  useEffect(() => {
    const tk = readResetToken(window.location);
    // Token adres çubuğunda/geçmişte kalmasın
    if (window.location.hash || window.location.search) window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL parçası yalnız istemcide okunur (tek seferlik)
    setToken(tk && RESET_TOKEN_RE.test(tk) ? { kind: "ok", token: tk } : { kind: "invalid" });
  }, []);
  return [token, setToken] as const;
}

function useResetSubmit(formRef: RefObject<HTMLFormElement | null>) {
  const router = useRouter();
  const [token, setToken] = useResetToken();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<UiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || token.kind !== "ok") return;
    setServerError(null);
    const parsed = parseNewPassword(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.ok) {
      setErrors(parsed.errors);
      focusFirstField(formRef, ["next", "confirm"], parsed.errors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await api<void>("POST", "/auth/password/reset", { token: token.token, next: parsed.value });
      router.replace("/login?reason=reset");
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.status === 410) return setToken({ kind: "invalid" });
      if (err instanceof ApiError && err.status === 400 && err.fields?.next) return setErrors({ next: err.fields.next });
      setServerError(toUiError(err));
    }
  }

  return { token, errors, serverError, submitting, onSubmit };
}

function ResetReading() {
  return (
    <div aria-busy="true" className="mt-6 flex flex-col gap-4">
      <span className="sr-only">{t("panel.loading")}</span>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

function ResetInvalid() {
  return (
    <div className="mt-4 flex flex-col gap-4" data-testid="reset-invalid">
      <Alert tone="warning">
        <p className="flex items-center gap-2 font-medium">
          <Link2Off aria-hidden className="size-4" />
          {t("rp.invalidTitle")}
        </p>
        <p className="mt-1">{t("rp.invalidBody")}</p>
      </Alert>
      <Link
        href="/forgot-password"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-hover"
      >
        <KeyRound aria-hidden className="size-4" />
        {t("rp.newLink")}
      </Link>
      <Link
        href="/login"
        className="inline-flex min-h-11 items-center justify-center gap-2 self-center rounded-md px-3 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t("fp.back")}
      </Link>
    </div>
  );
}

/**
 * AC-66: POST /auth/password/reset `{ token, next }` → 204 → giriş ekranı ("şifreniz değiştirildi"). 410
 * `RESET_TOKEN_INVALID` → "bağlantı geçersiz veya süresi dolmuş" + yeni bağlantı iste. 400 `fields.next` alana yansır.
 */
export function ResetForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const { token, errors, serverError, submitting, onSubmit } = useResetSubmit(formRef);

  if (token.kind === "reading") return <ResetReading />;
  if (token.kind === "invalid") return <ResetInvalid />;

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={onSubmit}
      className="mt-1 flex flex-col gap-4"
      aria-label={t("rp.title")}
      data-testid="reset-form"
    >
      <p className="mb-2 text-sm text-fg-muted">{t("rp.subtitle")}</p>
      <FormError error={serverError} />
      <NewPasswordFields submitting={submitting} errors={errors} />
      <PasswordSubmit submitting={submitting} label={t("rp.submit")} testId="reset-submit" />
    </form>
  );
}
