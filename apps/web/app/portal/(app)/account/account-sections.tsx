"use client";

import type { PortalTotpSetupResponse } from "@remote/contracts/api/portal";
import { totpCodeSchema } from "@remote/contracts/api/auth";
import { Check, Copy, ShieldCheck, ShieldOff, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { groupSecret } from "@/lib/account/contract";
import { ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { portalApi, portalGateTarget } from "@/lib/portal/api";
import { copyText } from "@/lib/use-now";
import { PortalPasswordForm } from "../../portal-password-form";

export function PasswordSection() {
  const toast = useToast();
  return <PortalPasswordForm onDone={() => toast(t("portal.acc.pwDone"))} />;
}

type Mfa = { kind: "idle" } | { kind: "starting" } | { kind: "scan"; data: PortalTotpSetupResponse } | { kind: "disabling" };

/** Kod alanı: yalnız rakam, 6 hane, mono. */
function CodeField({ value, onChange, error, disabled }: { value: string; onChange: (v: string) => void; error?: string; disabled: boolean }) {
  return (
    <TextField
      name="code"
      label={t("mfa.v.code")}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      error={error}
      disabled={disabled}
      className="[&_input]:font-mono [&_input]:tracking-widest"
      data-testid="portal-mfa-code"
    />
  );
}

function useMfaActions(onChanged: () => void) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<UiError | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const fail = (e: unknown, codeField: string) => {
    const to = portalGateTarget(e);
    if (to) return router.replace(to);
    if (e instanceof ApiError && e.status === 400) {
      setFields(e.fields ?? { [codeField]: t("mfa.v.wrongCode") });
      return;
    }
    setErr(toUiError(e));
  };
  const call = async (path: string, body: object, done: string, codeField = "code") => {
    setBusy(true);
    setErr(null);
    setFields({});
    try {
      await portalApi<void>("POST", path, body);
      toast(t(done === "on" ? "portal.acc.mfaEnabled" : "portal.acc.mfaDisabled"));
      onChanged();
      router.refresh();
    } catch (e) {
      fail(e, codeField);
    } finally {
      setBusy(false);
    }
  };
  return { busy, setBusy, err, setErr, fields, setFields, call, fail };
}

/** Kod istemci kuralı (sunucuyla aynı şema). */
const codeError = (code: string): string | undefined =>
  totpCodeSchema.safeParse(code).success ? undefined : code ? t("mfa.v.codeInvalid") : t("v.required");

function SetupForm({ data, a, onCancel }: { data: PortalTotpSetupResponse; a: ReturnType<typeof useMfaActions>; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const secret = data.secret.replace(/\s+/g, "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ce = codeError(code);
    if (ce) return a.setFields({ code: ce });
    void a.call("/portal/account/totp/enable", { code }, "on");
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" data-testid="portal-mfa-setup">
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-fg">
        <li>{t("mfa.s.step1")}</li>
        <li>{t("mfa.s.step2")}</li>
        <li>{t("mfa.s.step3")}</li>
      </ol>
      {/* QR yalnız açık zeminde okunur → iki temada logo-surface kartı (DESIGN §5) */}
      <div className="flex justify-center">
        <div className="rounded-md border border-border bg-logo-surface p-2">
          <img src={data.qrDataUrl} alt={t("mfa.s.qrAlt")} width={192} height={192} className="size-48" data-testid="portal-mfa-qr" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-fg" id="portal-mfa-key">
          {t("mfa.s.manual")}
        </p>
        <div className="flex items-stretch gap-2">
          <code
            aria-labelledby="portal-mfa-key"
            className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-3 py-2.5 text-center font-mono text-sm break-all text-fg"
          >
            {groupSecret(secret)}
          </code>
          <Button type="button" variant="secondary" aria-label={t("mfa.s.copyKey")} className="shrink-0 px-3" onClick={async () => setCopied(await copyText(secret))}>
            {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
          </Button>
        </div>
        <p role="status" className="text-xs text-success">
          {copied ? t("mfa.s.keyCopied") : ""}
        </p>
      </div>
      <FormError error={a.err} />
      <CodeField value={code} onChange={setCode} error={a.fields.code} disabled={a.busy} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" loading={a.busy} data-testid="portal-mfa-enable">
          {!a.busy && <ShieldCheck aria-hidden className="size-4" />}
          {t("portal.acc.mfaEnable")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={a.busy}>
          <X aria-hidden className="size-4" />
          {t("portal.acc.mfaCancel")}
        </Button>
      </div>
    </form>
  );
}

function DisableForm({ a, onCancel }: { a: ReturnType<typeof useMfaActions>; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const pwRef = useRef<HTMLInputElement>(null);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    const errs: Record<string, string> = {};
    if (!password) errs.password = t("v.required");
    const ce = codeError(code);
    if (ce) errs.code = ce;
    if (Object.keys(errs).length) {
      a.setFields(errs);
      if (errs.password) pwRef.current?.focus();
      return;
    }
    void a.call("/portal/account/totp/disable", { password, code }, "off");
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" data-testid="portal-mfa-disable-form">
      <p className="text-sm text-fg-muted">{t("portal.acc.mfaDisableBody")}</p>
      <FormError error={a.err} />
      <TextField
        ref={pwRef}
        name="password"
        type="password"
        label={t("pw.current")}
        autoComplete="current-password"
        revealable
        error={a.fields.password}
        disabled={a.busy}
      />
      <CodeField value={code} onChange={setCode} error={a.fields.code} disabled={a.busy} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="danger" loading={a.busy} data-testid="portal-mfa-disable-confirm">
          {!a.busy && <ShieldOff aria-hidden className="size-4" />}
          {t("portal.acc.mfaDisable")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={a.busy}>
          <X aria-hidden className="size-4" />
          {t("portal.acc.mfaCancel")}
        </Button>
      </div>
    </form>
  );
}

/**
 * İsteğe bağlı TOTP (K-P21-5): kapalıyken "Aç" → `POST /portal/account/totp/setup` (QR sunucuda) → kod → `enable`; açıkken
 * "Kapat" → şifre + kod → `disable`. Kurtarma kodu yok (cihaz kaybında Admin "Şifreyi sıfırla").
 */
export function MfaSection({ enabled }: { enabled: boolean }) {
  const [mfa, setMfa] = useState<Mfa>({ kind: "idle" });
  const a = useMfaActions(() => setMfa({ kind: "idle" }));
  const reset = () => {
    a.setErr(null);
    a.setFields({});
    setMfa({ kind: "idle" });
  };
  const start = async () => {
    a.setErr(null);
    setMfa({ kind: "starting" });
    try {
      setMfa({ kind: "scan", data: await portalApi<PortalTotpSetupResponse>("POST", "/portal/account/totp/setup", {}) });
    } catch (e) {
      setMfa({ kind: "idle" });
      a.fail(e, "code");
    }
  };
  return (
    <div className="flex flex-col gap-4" data-testid="portal-mfa" data-enabled={enabled}>
      <Alert tone={enabled ? "success" : "warning"} testId="portal-mfa-state">
        <span className="font-medium">{enabled ? t("portal.acc.mfaOn") : t("portal.acc.mfaOff")}</span> —{" "}
        {enabled ? t("portal.acc.mfaOnBody") : t("portal.acc.mfaOffBody")}
      </Alert>
      {mfa.kind === "scan" && <SetupForm data={mfa.data} a={a} onCancel={reset} />}
      {mfa.kind === "disabling" && <DisableForm a={a} onCancel={reset} />}
      {(mfa.kind === "idle" || mfa.kind === "starting") && (
        <>
          <FormError error={a.err} />
          {enabled ? (
            <Button variant="danger-ghost" className="self-start" onClick={() => setMfa({ kind: "disabling" })} data-testid="portal-mfa-off">
              <ShieldOff aria-hidden className="size-4" />
              {t("portal.acc.mfaDisable")}
            </Button>
          ) : (
            <Button className="self-start" loading={mfa.kind === "starting"} onClick={() => void start()} data-testid="portal-mfa-on">
              {mfa.kind !== "starting" && <ShieldCheck aria-hidden className="size-4" />}
              {t("portal.acc.mfaStart")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
