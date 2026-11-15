"use client";

import { Lock, Send, Server, Trash2, UserRound } from "lucide-react";
import { SettingsSection } from "@/components/settings/section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { SMTP_DEFAULT_PORTS } from "@/lib/account/contract";
import { smtpCredsAllowed, smtpPortOptions } from "@/lib/account/smtp-form";
import { t } from "@/lib/i18n";
import type { useSmtpForm } from "./use-smtp-form";

type Form = ReturnType<typeof useSmtpForm>;
type Props = { f: Form; canEdit: boolean };

/** Salt okunur ve "yapılandırılmamış" bantları. */
export function SmtpBanners({ canEdit, configured }: { canEdit: boolean; configured: boolean }) {
  return (
    <>
      {!canEdit && (
        <Alert tone="warning" testId="settings-readonly">
          {t("set.readonly")}
        </Alert>
      )}
      {!configured && (
        <Alert tone="warning" testId="smtp-unconfigured">
          {t("smtp.unconfigured")}
        </Alert>
      )}
    </>
  );
}

/** Güvenlik seçimi + port ipucu / hata + "Yok" uyarısı. */
function SecurityField({ f: { st, errors, busy, setSecurity }, canEdit }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-fg" aria-hidden>
        {t("smtp.security")}
      </span>
      <Segmented
        label={t("smtp.security")}
        value={st.security}
        onChange={setSecurity}
        disabled={!canEdit || busy}
        options={[
          { value: "NONE", label: t("smtp.sec.NONE") },
          { value: "SSL", label: t("smtp.sec.SSL") },
          { value: "STARTTLS", label: t("smtp.sec.STARTTLS") },
        ]}
      />
      {errors.security ? (
        <p className="text-xs font-medium text-danger" role="alert" data-testid="smtp-security-error">
          {errors.security}
        </p>
      ) : (
        <p className="text-xs text-fg-muted" data-testid="smtp-port-hint">
          {t("smtp.portHint", { port: SMTP_DEFAULT_PORTS[st.security] })}
        </p>
      )}
      {st.security === "NONE" && (
        <Alert tone="warning" testId="smtp-insecure">
          {t("smtp.insecure")}
        </Alert>
      )}
    </div>
  );
}

export function SmtpServerSection(p: Props) {
  const { st, errors, set } = p.f;
  return (
    <SettingsSection id="srv" title={t("smtp.server")} Icon={Server}>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <TextField
          label={t("smtp.host")}
          value={st.host}
          onChange={set("host")}
          error={errors.host}
          placeholder="smtp.ornek.com"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          maxLength={253}
          data-testid="smtp-host"
        />
        <SelectField
          label={t("smtp.port")}
          value={st.port}
          onChange={set("port")}
          error={errors.port}
          options={smtpPortOptions(st.port, (port) => t("smtp.portInvalid", { port }))}
          data-testid="smtp-port"
        />
      </div>
      <SecurityField {...p} />
    </SettingsSection>
  );
}

/** Şifre: forma geri yazılmaz; kayıtlıysa yer tutucu + "boş bırakılırsa korunur". */
function PasswordField({ f: { st, errors, set, saved }, credsOn }: { f: Form; credsOn: boolean }) {
  const hasPw = Boolean(saved?.hasPassword) && credsOn;
  return (
    <TextField
      label={t("smtp.password")}
      type="password"
      revealable
      value={credsOn ? st.password : ""}
      onChange={set("password")}
      disabled={!credsOn}
      error={errors.password}
      placeholder={hasPw ? "••••••••" : undefined}
      hint={!credsOn ? undefined : hasPw ? t("smtp.passwordKept") : t("smtp.passwordHint")}
      autoComplete="new-password"
      maxLength={200}
      data-testid="smtp-password"
    />
  );
}

export function SmtpAuthSection({ f }: { f: Form }) {
  const { st, errors, set, saved } = f;
  const credsOn = smtpCredsAllowed(st.security);
  return (
    <SettingsSection id="auth" title={t("smtp.auth")} Icon={Lock}>
      {!credsOn && (
        <p className="text-sm text-fg-muted" data-testid="smtp-no-creds">
          {t("smtp.noCreds")}
          {saved?.user ? ` ${t("smtp.credsWillClear")}` : ""}
        </p>
      )}
      <TextField
        label={t("smtp.user")}
        value={credsOn ? st.user : ""}
        onChange={set("user")}
        disabled={!credsOn}
        error={errors.user}
        hint={credsOn ? t("smtp.userHint") : undefined}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
        maxLength={190}
        data-testid="smtp-user"
      />
      <PasswordField f={f} credsOn={credsOn} />
    </SettingsSection>
  );
}

export function SmtpFromSection({ f: { st, errors, set } }: { f: Form }) {
  return (
    <SettingsSection id="from" title={t("smtp.from")} Icon={UserRound}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("smtp.fromName")}
          value={st.fromName}
          onChange={set("fromName")}
          error={errors.fromName}
          placeholder={t("app.name")}
          maxLength={100}
          autoComplete="off"
          data-testid="smtp-from-name"
        />
        <TextField
          label={t("smtp.fromEmail")}
          type="email"
          value={st.fromEmail}
          onChange={set("fromEmail")}
          error={errors.fromEmail}
          placeholder="destek@ornek.com"
          maxLength={190}
          autoComplete="off"
          spellCheck={false}
          data-testid="smtp-from-email"
        />
      </div>
    </SettingsSection>
  );
}

/** Test maili (kayıtlı ayarla; kirliyken pasif) + "Ayarları temizle". */
export function SmtpTestSection({ f: { saved, dirty, busy, setTestOpen, askClear }, canEdit }: Props) {
  return (
    <SettingsSection id="test" title={t("smtp.testTitle")} Icon={Send}>
      <p className="text-sm text-fg-muted" id="smtp-test-note">
        {!saved ? t("smtp.testNeedsConfig") : dirty ? t("smtp.testNeedsSave") : t("smtp.testBody")}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="secondary"
          disabled={!saved || dirty || !canEdit}
          aria-describedby="smtp-test-note"
          onClick={() => setTestOpen(true)}
          data-testid="smtp-test-open"
        >
          <Send aria-hidden className="size-4" />
          {t("smtp.test")}
        </Button>
        {saved && canEdit && (
          <Button type="button" variant="danger-ghost" disabled={busy} onClick={askClear} data-testid="smtp-clear">
            <Trash2 aria-hidden className="size-4" />
            {t("smtp.clear")}
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}

export function SmtpClearDialog({ f: { confirmClear, busy, cancelClear, put } }: { f: Form }) {
  return (
    <Dialog
      open={confirmClear}
      onClose={() => {
        if (busy) return;
        cancelClear();
      }}
      role="alertdialog"
      size="sm"
      testId="smtp-clear-dialog"
      title={t("smtp.clearTitle")}
      description={t("smtp.clearBody")}
      footer={
        <>
          <Button variant="secondary" data-autofocus disabled={busy} className="sm:ml-auto" onClick={cancelClear}>
            {t("rq.rj.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void put(null)} data-testid="smtp-clear-confirm">
            {!busy && <Trash2 aria-hidden className="size-4" />}
            {t("smtp.clear")}
          </Button>
        </>
      }
    />
  );
}
