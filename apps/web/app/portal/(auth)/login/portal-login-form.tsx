"use client";

import { totpCodeSchema } from "@remote/contracts/api/auth";
import { portalLoginInputSchema, type PortalMe } from "@remote/contracts/api/portal";
import { Info, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { ApiError } from "@/lib/api";
import { fieldErrors } from "@/lib/auth-schema";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { portalApi } from "@/lib/portal/api";
import { PORTAL_CHANGE_PASSWORD, PORTAL_HOME } from "@/lib/portal/paths";

/** Gönderilecek giriş gövdesi; kod alanı göründükten sonra kod her istekte gider (kodsuz tekrar kova hakkı harcar). */
export function buildPortalLogin(
  data: { email?: unknown; password?: unknown; totpCode?: unknown },
  tenantSlug: string,
  needCode: boolean,
): { ok: true; body: ReturnType<typeof portalLoginInputSchema.parse> } | { ok: false; errors: Record<string, string> } {
  const raw = { email: data.email, password: data.password, tenantSlug, ...(needCode ? { totpCode: data.totpCode } : {}) };
  const r = portalLoginInputSchema.safeParse(raw);
  const errors: Record<string, string> = r.success ? {} : fieldErrors(r.error, raw);
  if (needCode && !totpCodeSchema.safeParse(data.totpCode).success)
    errors.totpCode = typeof data.totpCode === "string" && data.totpCode ? t("mfa.v.codeInvalid") : t("v.required");
  if (!r.success || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, body: r.data };
}

/**
 * Portal giriş formu (AC-262; mimari-p21 §5.2): e-posta + şifre (+ gizli firma kısa adı). 403 `MFA_REQUIRED` → aynı formda
 * 6 haneli kod alanı belirir, aynı istek kodla tekrarlanır. 401'de sunucu metni gösterilir ("Kod hatalı.", geçici şifre süresi
 * doldu); 423 kalan süre, 429 hız sınırı. Başarıda sabit hedef (`next` yok).
 */
export function PortalLoginForm({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<UiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needCode, setNeedCode] = useState(false);

  const focus = (name: string) => formRef.current?.querySelector<HTMLInputElement>(`[name="${name}"]`)?.focus();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const b = buildPortalLogin(Object.fromEntries(new FormData(e.currentTarget)), tenantSlug, needCode);
    setServerError(null);
    if (!b.ok) {
      setErrors(b.errors);
      const first = ["email", "password", "totpCode"].find((k) => b.errors[k]);
      if (first) focus(first);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const me = await portalApi<PortalMe>("POST", "/portal/auth/login", b.body);
      router.replace(me.user.mustChangePassword ? PORTAL_CHANGE_PASSWORD : PORTAL_HOME);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.status === 403 && err.code === "MFA_REQUIRED") {
        setNeedCode(true);
        requestAnimationFrame(() => focus("totpCode"));
        return;
      }
      if (err instanceof ApiError && err.status === 400 && err.fields) setErrors(err.fields);
      setServerError(toUiError(err, { 401: err instanceof ApiError && err.message ? err.message : t("portal.login.invalid") }));
    }
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label={t("portal.login.title")}>
      <FormError error={serverError} />
      <TextField
        name="email"
        type="email"
        label={t("portal.login.email")}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        disabled={submitting}
        error={errors.email}
        data-testid="portal-email"
      />
      <TextField
        name="password"
        type="password"
        label={t("portal.login.password")}
        autoComplete="current-password"
        required
        revealable
        disabled={submitting}
        error={errors.password}
        data-testid="portal-password"
      />
      {needCode && (
        <>
          <p role="status" className="flex items-start gap-2 rounded-md bg-primary-surface p-3 text-sm text-fg" data-testid="portal-code-needed">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            {t("portal.login.codeNeeded")}
          </p>
          <TextField
            name="totpCode"
            label={t("portal.login.code")}
            hint={t("portal.login.codeHint")}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            disabled={submitting}
            error={errors.totpCode}
            className="[&_input]:font-mono [&_input]:tracking-widest"
            data-testid="portal-code"
          />
        </>
      )}
      <Button type="submit" loading={submitting} className="mt-2 w-full" data-testid="portal-login-submit">
        {!submitting && <LogIn aria-hidden className="size-4" />}
        {submitting ? t("portal.login.submitting") : t("portal.login.submit")}
      </Button>
      <p className="text-center text-sm text-fg-muted" data-testid="portal-forgot">
        {t("portal.login.forgot")}
      </p>
    </form>
  );
}
