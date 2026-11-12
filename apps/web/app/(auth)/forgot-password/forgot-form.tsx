"use client";

import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { passwordForgotInputSchema } from "@/lib/account/contract";
import { api } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

/**
 * AC-66: POST /auth/password/forgot `{ email }` → 202 her durumda. Başarı metni hesabın varlığını söylemez ("kayıtlı
 * bir hesap varsa…"). 429 → kilit tonu; ağ/sunucu hatası → tekrar dene (form korunur).
 */
export function ForgotForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [serverError, setServerError] = useState<UiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setServerError(null);
    const parsed = passwordForgotInputSchema.safeParse({ email: email.trim() });
    if (!parsed.success) {
      setError(email.trim() ? t("v.email") : t("v.required"));
      inputRef.current?.focus();
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      await api<void>("POST", "/auth/password/forgot", parsed.data);
      setSent(true);
    } catch (err) {
      setServerError(toUiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const back = (
    <Link href="/login" className="inline-flex min-h-11 items-center justify-center gap-2 self-center rounded-md px-3 text-sm font-medium text-primary hover:underline">
      <ArrowLeft aria-hidden className="size-4" />
      {t("fp.back")}
    </Link>
  );

  if (sent) {
    return (
      <div className="flex flex-col gap-4" data-testid="forgot-sent">
        <Alert tone="success">
          <p className="font-medium">{t("fp.sentTitle")}</p>
          <p className="mt-1">{t("fp.sentBody")}</p>
        </Alert>
        {back}
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={t("fp.title")} data-testid="forgot-form">
      <FormError error={serverError} />
      <TextField
        ref={inputRef}
        name="email"
        type="email"
        label={t("fp.email")}
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={submitting}
        error={error}
      />
      <Button type="submit" loading={submitting} className="mt-2 w-full">
        {!submitting && <Mail aria-hidden className="size-4" />}
        {submitting ? t("fp.submitting") : t("fp.submit")}
      </Button>
      {back}
    </form>
  );
}
