"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthExit } from "@/components/auth-exit";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { recoveryCodeSchema, totpCodeSchema, type MfaVerifyResponse } from "@/lib/account/contract";
import { api, ApiError, safeNext } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

type Mode = "code" | "recovery";

/**
 * AC-67: POST /auth/mfa/verify `{ code }` | `{ recoveryCode }` → `{ user }`. 401 = kod hatalı (alan hatası, alan
 * temizlenir ve odaklanır), 429 = 5 dk'da 5 deneme aşıldı (kilit tonu). Başarıda panel kabuğu kalan adımları
 * (zorunlu şifre değişimi) uygular.
 */
export function MfaVerifyForm({ next }: { next: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("code");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [serverError, setServerError] = useState<UiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const switchMode = () => {
    setMode((m) => (m === "code" ? "recovery" : "code"));
    setValue("");
    setError(undefined);
    setServerError(null);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setServerError(null);
    const parsed = mode === "code" ? totpCodeSchema.safeParse(value) : recoveryCodeSchema.safeParse(value);
    if (!parsed.success) {
      setError(value.trim() ? t(mode === "code" ? "mfa.v.codeInvalid" : "mfa.v.recoveryInvalid") : t("v.required"));
      inputRef.current?.focus();
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      const body = mode === "code" ? { code: parsed.data } : { recoveryCode: parsed.data };
      const res = await api<MfaVerifyResponse>("POST", "/auth/mfa/verify", body);
      router.replace(res.user.mustChangePassword ? "/change-password" : safeNext(next, window.location.origin));
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && (err.status === 401 || err.status === 400)) {
        setValue("");
        setError(t(mode === "code" ? "mfa.v.wrongCode" : "mfa.v.wrongRecovery"));
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      setServerError(toUiError(err));
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="mt-1 flex flex-col gap-4" aria-label={t("mfa.v.title")} data-testid="mfa-verify-form">
      <p className="mb-2 text-sm text-fg-muted">{t(mode === "code" ? "mfa.v.subtitle" : "mfa.v.recoverySubtitle")}</p>
      <FormError error={serverError} />
      {mode === "code" ? (
        <TextField
          key="code"
          ref={inputRef}
          name="code"
          label={t("mfa.v.code")}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
          disabled={submitting}
          error={error}
          className="[&_input]:font-mono [&_input]:tracking-widest"
          data-testid="mfa-code"
        />
      ) : (
        <TextField
          key="recovery"
          ref={inputRef}
          name="recoveryCode"
          label={t("mfa.v.recovery")}
          hint={t("mfa.v.recoveryHint")}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={20}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={submitting}
          error={error}
          className="[&_input]:font-mono"
          data-testid="mfa-recovery"
        />
      )}
      <Button type="submit" loading={submitting} className="mt-2 w-full" data-testid="mfa-submit">
        {!submitting && <ShieldCheck aria-hidden className="size-4" />}
        {submitting ? t("mfa.v.submitting") : t("mfa.v.submit")}
      </Button>
      <Button type="button" variant="secondary" onClick={switchMode} disabled={submitting} className="w-full" data-testid="mfa-mode">
        <KeyRound aria-hidden className="size-4" />
        {t(mode === "code" ? "mfa.v.useRecovery" : "mfa.v.useCode")}
      </Button>
      <AuthExit disabled={submitting} />
    </form>
  );
}
