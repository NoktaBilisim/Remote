"use client";

import { Check, Copy, RotateCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { RecoveryCodes } from "@/components/account/recovery-codes";
import { AuthExit } from "@/components/auth-exit";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { groupSecret, totpCodeSchema, type MfaEnableResponse, type MfaSetupResponse } from "@/lib/account/contract";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { copyText } from "@/lib/use-now";

type Step =
  { kind: "loading" } | { kind: "error"; error: UiError } | { kind: "scan"; data: MfaSetupResponse } | { kind: "codes"; codes: string[] };

/**
 * 2FA kurulumu (AC-67): POST /auth/mfa/setup → QR + elle anahtar → 6 haneli kodla POST /auth/mfa/enable → 10 kurtarma
 * kodu (bir kez). `gate`: zorunlu kurulum kapısı (çıkış dışında kaçış yok); değilse "Vazgeç" hesap sayfasına döner.
 * Kurulum isteği bir kez atılır (StrictMode çift effect'i yeni sır üretip QR'ı geçersiz kılmasın).
 */
export function MfaSetup({ gate, account, doneHref }: { gate: boolean; account: string; doneHref: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string>();
  const [submitError, setSubmitError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const started = useRef(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const start = useCallback(async () => {
    setStep({ kind: "loading" });
    try {
      const data = await api<MfaSetupResponse>("POST", "/auth/mfa/setup", {});
      setStep({ kind: "scan", data });
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      // Zaten etkin (başka sekmede kuruldu) → hesap sayfası
      if (e instanceof ApiError && e.status === 409) return router.replace(gate ? "/" : "/account");
      setStep({ kind: "error", error: toUiError(e) });
    }
  }, [router, gate]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  const enable = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setSubmitError(null);
    const parsed = totpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setCodeError(code ? t("mfa.v.codeInvalid") : t("v.required"));
      codeRef.current?.focus();
      return;
    }
    setCodeError(undefined);
    setBusy(true);
    try {
      const r = await api<MfaEnableResponse>("POST", "/auth/mfa/enable", { code: parsed.data });
      setStep({ kind: "codes", codes: r.recoveryCodes });
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && (err.status === 400 || err.status === 401)) {
        setCode("");
        setCodeError(t("mfa.v.wrongCode"));
        requestAnimationFrame(() => codeRef.current?.focus());
      } else setSubmitError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === "loading") {
    return (
      <div aria-busy="true" data-testid="mfa-setup-loading" className="flex flex-col items-center gap-4">
        <span className="sr-only">{t("panel.loading")}</span>
        <Skeleton className="size-48" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  if (step.kind === "error") {
    return (
      <div className="flex flex-col gap-4" data-testid="mfa-setup-error">
        <FormError error={step.error} />
        <Button variant="secondary" onClick={() => void start()} className="self-start">
          <RotateCw aria-hidden className="size-4" />
          {t("err.retry")}
        </Button>
        {gate && <AuthExit />}
      </div>
    );
  }

  if (step.kind === "codes") {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" testId="mfa-enabled">
          {t("mfa.s.enabled")}
        </Alert>
        <h2 className="text-base font-semibold text-fg">{t("mfa.rc.title")}</h2>
        <p className="text-sm text-fg-muted">{t("mfa.rc.body")}</p>
        <RecoveryCodes
          codes={step.codes}
          account={account}
          doneLabel={t("mfa.s.continue")}
          onDone={() => {
            router.replace(doneHref);
            router.refresh();
          }}
        />
      </div>
    );
  }

  const { data } = step;
  const secret = data.secret.replace(/\s+/g, "");
  return (
    <form noValidate onSubmit={enable} className="flex flex-col gap-4" data-testid="mfa-setup-form" aria-label={t("mfa.s.title")}>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-fg">
        <li>{t("mfa.s.step1")}</li>
        <li>{t("mfa.s.step2")}</li>
        <li>{t("mfa.s.step3")}</li>
      </ol>
      {/* QR yalnız açık zeminde okunur → iki temada logo-surface kartı */}
      <div className="flex justify-center">
        <div className="rounded-md border border-border bg-logo-surface p-2">
          <img src={data.qrDataUrl} alt={t("mfa.s.qrAlt")} width={192} height={192} className="size-48" data-testid="mfa-qr" />
        </div>
      </div>
      {secret && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-fg" id="mfa-key-l">
            {t("mfa.s.manual")}
          </p>
          <div className="flex items-stretch gap-2">
            <code
              aria-labelledby="mfa-key-l"
              className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-3 py-2.5 text-center font-mono text-sm break-all text-fg"
              data-testid="mfa-secret"
            >
              {groupSecret(secret)}
            </code>
            <Button
              type="button"
              variant="secondary"
              aria-label={t("mfa.s.copyKey")}
              className="shrink-0 px-3"
              onClick={async () => setKeyCopied(await copyText(secret))}
            >
              {keyCopied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
            </Button>
          </div>
          <p role="status" className="text-xs text-success">
            {keyCopied ? t("mfa.s.keyCopied") : ""}
          </p>
        </div>
      )}
      <FormError error={submitError} />
      <TextField
        ref={codeRef}
        label={t("mfa.v.code")}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        error={codeError}
        disabled={busy}
        className="[&_input]:font-mono [&_input]:tracking-widest"
        data-testid="mfa-setup-code"
      />
      <Button type="submit" loading={busy} className="w-full" data-testid="mfa-enable">
        {!busy && <ShieldCheck aria-hidden className="size-4" />}
        {t("mfa.s.enable")}
      </Button>
      {gate ? (
        <AuthExit disabled={busy} />
      ) : (
        <Link
          href="/account"
          className="inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium text-primary hover:underline"
        >
          {t("mfa.s.cancel")}
        </Link>
      )}
    </form>
  );
}
