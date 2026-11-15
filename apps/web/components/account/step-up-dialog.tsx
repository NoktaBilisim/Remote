"use client";

import { KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import type { StepUpMethod, StepUpResponse } from "@/lib/account/contract";
import { buildStepUp, lowRecoveryLeft, stepUpErrorOf } from "@/lib/account/step-up";
import { api, setStepUpHandler } from "@/lib/api";
import { t } from "@/lib/i18n";

type Phase = { kind: "closed" } | { kind: "ask" } | { kind: "low"; left: number };

/**
 * P14a (AC-215) step-up: hassas uç 401 `MFA_STEP_UP_REQUIRED` döndüğünde `lib/api` bu sağlayıcının işleyicisini
 * çağırır; diyalog kod ister (`POST /auth/step-up`), başarıda istek bir kez tekrarlanır. Panel kabuğunda tek örnek.
 * - Odak tuzağı: native `<dialog>` + `showModal()` (DESIGN §6.1; arka plan inert). İlk odak kod alanında.
 * - "Kurtarma kodu kullan" ↔ "Uygulama kodunu kullan" geçişi; alan temizlenir ve yeniden odaklanır.
 * - Hata alanın altında görünür ve `aria-live="assertive"` bölgesinde duyurulur.
 * - Kurtarma koduyla doğrulandıysa ve kalan kod ≤ 3 ise diyalog kapanmadan önce yenileme uyarısı (+ hesap sayfası bağlantısı).
 */
export function StepUpProvider({ children }: { children?: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: "closed" });
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const finish = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setPhase({ kind: "closed" });
  }, []);

  useEffect(
    () =>
      setStepUpHandler(
        () =>
          new Promise<boolean>((resolve) => {
            resolver.current = resolve;
            setPhase({ kind: "ask" });
          }),
      ),
    [],
  );
  // Sağlayıcı kalkarsa (çıkış) bekleyen istek "vazgeçildi" ile sonuçlanır
  useEffect(() => () => resolver.current?.(false), []);

  return (
    <>
      {children}
      <StepUpDialog
        phase={phase}
        onVerified={(r) => {
          const left = lowRecoveryLeft(r);
          if (left === null) finish(true);
          else setPhase({ kind: "low", left });
        }}
        onContinue={() => finish(true)}
        onCancel={() => finish(false)}
      />
    </>
  );
}

function StepUpDialog({
  phase,
  onVerified,
  onContinue,
  onCancel,
}: {
  phase: Phase;
  onVerified: (r: StepUpResponse) => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<StepUpMethod>("TOTP");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = phase.kind !== "closed";

  // Her açılışta temiz başla (TOTP); yöntem değişince alan temizlenir ve odak alana gelir
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    if (open) {
      setMethod("TOTP");
      setValue("");
      setError(undefined);
    }
  }
  useEffect(() => {
    if (phase.kind === "ask") inputRef.current?.focus();
  }, [phase.kind, method]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const r = buildStepUp(method, value);
    if (!r.body) {
      setError(r.error);
      inputRef.current?.focus();
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      // Step-up ucunun kendisi step-up istemez; yine de yakalama döngüsü olmasın
      const res = await api<StepUpResponse>("POST", "/auth/step-up", r.body, undefined, { stepUp: false });
      onVerified(res);
    } catch (err) {
      const m = stepUpErrorOf(err, method);
      setError(m.message);
      if (m.clear) setValue("");
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    setMethod((m) => (m === "TOTP" ? "RECOVERY" : "TOTP"));
    setValue("");
    setError(undefined);
  };

  const low = phase.kind === "low";
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return;
        if (low) onContinue();
        else onCancel();
      }}
      size="sm"
      testId="step-up-dialog"
      title={low ? t("su.lowTitle") : t("su.title")}
      description={low ? undefined : t(method === "TOTP" ? "su.body" : "su.bodyRecovery")}
      footer={
        low ? (
          <Button data-autofocus className="sm:ml-auto" onClick={onContinue} data-testid="step-up-continue">
            {t("su.continue")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={toggle} disabled={busy} className="sm:mr-auto" data-testid="step-up-mode">
              {method === "TOTP" ? <KeyRound aria-hidden className="size-4" /> : <Smartphone aria-hidden className="size-4" />}
              {t(method === "TOTP" ? "mfa.v.useRecovery" : "mfa.v.useCode")}
            </Button>
            <Button variant="secondary" onClick={onCancel} disabled={busy} data-testid="step-up-cancel">
              {t("su.cancel")}
            </Button>
            <Button type="submit" form="step-up-form" loading={busy} data-testid="step-up-submit">
              {!busy && <ShieldCheck aria-hidden className="size-4" />}
              {busy ? t("mfa.v.submitting") : t("mfa.v.submit")}
            </Button>
          </>
        )
      }
    >
      {low ? (
        <Alert tone="warning" testId="step-up-low">
          <p>{t("su.low", { n: phase.left })}</p>
          <Link href="/account#mfa-h" className="mt-1 inline-flex min-h-11 items-center font-medium underline" onClick={onContinue}>
            {t("su.lowLink")}
          </Link>
        </Alert>
      ) : (
        <form id="step-up-form" noValidate onSubmit={submit} className="flex flex-col gap-2">
          {method === "TOTP" ? (
            <TextField
              key="totp"
              ref={inputRef}
              name="code"
              label={t("mfa.v.code")}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
              disabled={busy}
              error={error}
              className="[&_input]:font-mono [&_input]:tracking-widest"
              data-testid="step-up-code"
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
              disabled={busy}
              error={error}
              className="[&_input]:font-mono"
              data-testid="step-up-recovery"
            />
          )}
          {/* Hata duyurusu: bölge baştan DOM'da, içerik değişince okunur (görünür metin alanın altında) */}
          <p className="sr-only" aria-live="assertive" data-testid="step-up-live">
            {error ?? ""}
          </p>
        </form>
      )}
    </Dialog>
  );
}
