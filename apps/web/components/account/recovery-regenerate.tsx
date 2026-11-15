"use client";

import { RefreshCw, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { RecoveryCodes } from "@/components/account/recovery-codes";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { buildRecoveryRegenerate } from "@/lib/account/recovery";
import { stepUpErrorOf } from "@/lib/account/step-up";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { MfaRecoveryCodesResponse } from "@remote/contracts/api/auth";

/**
 * P15 (AC-231) "Kurtarma kodlarını yenile": diyalog uygulamadaki 6 haneli kodu ister (kurtarma koduyla yenileme yok),
 * `POST /auth/mfa/recovery-codes` → 10 yeni kod YALNIZ bir kez gösterilir (kopyala / indir / "Kaydettim"). Eski kodlar
 * sunucuda aynı anda geçersizleşir. Hatalı kod alan altında + `aria-live`; 5 hatalı denemede 429 → "N dakika sonra".
 * Kodlar görünürken Esc / X diyaloğu kapatmaz (kaydedilmeden kaybolmasın); yalnız "Kaydettim" + "Kapat".
 */
export function RecoveryRegenerate({ account }: { account: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const start = () => {
    setCode("");
    setError(undefined);
    setCodes(null);
    setOpen(true);
  };
  const cancel = () => {
    if (busy || codes) return;
    setOpen(false);
  };
  const done = () => {
    setOpen(false);
    setCodes(null);
    toast(t("acc.rg.done"));
    router.refresh(); // kalan kod sayısı
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const r = buildRecoveryRegenerate(code);
    if (!r.body) {
      setError(t(r.error ?? "mfa.v.codeInvalid"));
      inputRef.current?.focus();
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      const res = await api<MfaRecoveryCodesResponse>("POST", "/auth/mfa/recovery-codes", r.body, undefined, { stepUp: false });
      setCode("");
      setCodes(res.codes);
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      const m = stepUpErrorOf(err, "TOTP");
      setError(m.message);
      if (m.clear) setCode("");
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" className="self-start" onClick={start} data-testid="acc-rc-regenerate">
        <RefreshCw aria-hidden className="size-4" />
        {t("acc.rg.open")}
      </Button>
      <Dialog
        open={open}
        onClose={cancel}
        onDismiss={cancel}
        size="sm"
        testId="recovery-regenerate-dialog"
        title={codes ? t("mfa.rc.title") : t("acc.rg.title")}
        description={codes ? undefined : t("acc.rg.body")}
        footer={
          codes ? undefined : (
            <>
              <Button variant="secondary" onClick={cancel} disabled={busy} className="sm:ml-auto">
                {t("su.cancel")}
              </Button>
              <Button type="submit" form="recovery-regenerate-form" loading={busy} data-testid="rg-submit">
                {!busy && <ShieldCheck aria-hidden className="size-4" />}
                {t("acc.rg.submit")}
              </Button>
            </>
          )
        }
      >
        {codes ? (
          <RecoveryCodes codes={codes} account={account} onDone={done} doneLabel={t("acc.rg.close")} testId="rg-codes" />
        ) : (
          <form id="recovery-regenerate-form" noValidate onSubmit={submit} className="flex flex-col gap-3">
            <Alert tone="warning">{t("acc.rg.warn")}</Alert>
            <TextField
              ref={inputRef}
              name="code"
              label={t("mfa.v.code")}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              disabled={busy}
              error={error}
              data-autofocus
              className="[&_input]:font-mono [&_input]:tracking-widest"
              data-testid="rg-code"
            />
            <p className="sr-only" aria-live="assertive" data-testid="rg-live">
              {error ?? ""}
            </p>
          </form>
        )}
      </Dialog>
    </>
  );
}
