"use client";

import { Lock, Send, Server, Trash2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SaveBar } from "@/components/ui/save-bar";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { MailTestDialog } from "@/components/account/mail-test-dialog";
import { SMTP_DEFAULT_PORTS, type SmtpSecurity, type SmtpSettingsView, type TenantSettingsView } from "@/lib/account/contract";
import {
  buildSmtpInput,
  smtpCredsAllowed,
  smtpDirty,
  smtpPortOptions,
  smtpServerFields,
  suggestPort,
  toSmtpState,
  type SmtpField,
  type SmtpState,
} from "@/lib/account/smtp-form";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

const FORM_ID = "smtp-form";

function Section({ id, title, Icon, children }: { id: string; title: string; Icon: typeof Server; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
      <h2 id={`${id}-h`} className="flex items-center gap-2 text-base font-semibold text-fg">
        <Icon aria-hidden className="size-5 text-fg-muted" />
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * SMTP Ayarları (AC-79, 80, 122; ortak standart §2.1). Port yalnız izinli değerlerden seçilir (25/465/587/2525, B-P10-1);
 * güvenlik seçimi portu önerir (25/465/587). "Yok" seçiliyken kullanıcı adı/şifre pasif (B-P10-5). Şifre forma geri
 * yazılmaz: kayıtlıysa "kayıtlı — değiştirmek için yazın", boş bırakılırsa korunur. Kayıt PUT /settings/tenant `{ smtp }`;
 * 400 `HOST_NOT_ALLOWED` sunucu alanına genel mesajla düşer. Tüm alanlar boşaltılıp kaydedilirse onayla `smtp: null`.
 * "Test Maili Gönder" kayıtlı ayarla çalışır (kirliyken pasif), alıcıyı diyalogda sorar, sonucu diyalogda gösterir.
 */
export function SmtpForm({ initial, canEdit }: { initial: SmtpSettingsView | null; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const base = useMemo(() => toSmtpState(saved), [saved]);
  const [st, setSt] = useState<SmtpState>(base);
  const [errors, setErrors] = useState<Partial<Record<SmtpField, string>>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [focusErr, setFocusErr] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = smtpDirty(st, base);

  useEffect(() => {
    if (focusErr) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusErr]);

  const set = (k: keyof SmtpState) => (e: { target: { value: string } }) => {
    setSt((s) => ({ ...s, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const setSecurity = (security: SmtpSecurity) => {
    setSt((s) => ({ ...s, security, port: suggestPort(s.port, security) }));
    setErrors((x) => ({
      ...x,
      security: undefined,
      port: undefined,
      ...(smtpCredsAllowed(security) ? {} : { user: undefined, password: undefined }),
    }));
  };
  const reset = () => {
    setSt(base);
    setErrors({});
    setFormError(null);
  };

  const put = async (smtp: unknown) => {
    setBusy(true);
    setFormError(null);
    try {
      const r = await api<TenantSettingsView>("PUT", "/settings/tenant", { smtp });
      setSaved(r.smtp);
      setSt(toSmtpState(r.smtp));
      setErrors({});
      toast(t(r.smtp ? "smtp.saved" : "smtp.cleared"));
      setConfirmClear(false);
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      setConfirmClear(false);
      if (err instanceof ApiError && err.status === 400) {
        if (err.code === "HOST_NOT_ALLOWED") setErrors({ host: err.message || t("smtp.hostNotAllowed") });
        else if (err.fields) {
          const { errors: fe, rest } = smtpServerFields(err.fields);
          setErrors(fe);
          if (rest.length) setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
        } else setFormError(toUiError(err));
        setFocusErr((n) => n + 1);
      } else setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit || busy) return;
    const r = buildSmtpInput(st);
    if (r.input === undefined) {
      setErrors(r.errors);
      setFocusErr((n) => n + 1);
      return;
    }
    if (r.input === null) {
      if (!saved) return reset();
      setConfirmClear(true);
      return;
    }
    void put(r.input);
  };

  const credsOn = smtpCredsAllowed(st.security);
  const hasPw = Boolean(saved?.hasPassword) && credsOn;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {!canEdit && (
        <Alert tone="warning" testId="settings-readonly">
          {t("set.readonly")}
        </Alert>
      )}
      {!saved && (
        <Alert tone="warning" testId="smtp-unconfigured">
          {t("smtp.unconfigured")}
        </Alert>
      )}
      {formError && <FormError error={formError} />}
      <form id={FORM_ID} ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-6" data-testid="smtp-form">
        <fieldset disabled={!canEdit || busy} className="flex flex-col gap-6">
          <Section id="srv" title={t("smtp.server")} Icon={Server}>
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
          </Section>

          <Section id="auth" title={t("smtp.auth")} Icon={Lock}>
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
          </Section>

          <Section id="from" title={t("smtp.from")} Icon={UserRound}>
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
          </Section>
        </fieldset>
      </form>

      <Section id="test" title={t("smtp.testTitle")} Icon={Send}>
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
            <Button
              type="button"
              variant="danger-ghost"
              disabled={busy}
              onClick={() => {
                setSt({ ...toSmtpState(null), port: "" });
                setConfirmClear(true);
              }}
              data-testid="smtp-clear"
            >
              <Trash2 aria-hidden className="size-4" />
              {t("smtp.clear")}
            </Button>
          )}
        </div>
      </Section>

      {canEdit && (
        <SaveBar
          dirty={dirty && !confirmClear}
          busy={busy}
          formId={FORM_ID}
          onReset={reset}
          message={t("smtp.unsaved")}
          leaveBody={t("smtp.leaveBody")}
        />
      )}

      <Dialog
        open={confirmClear}
        onClose={() => {
          if (busy) return;
          setConfirmClear(false);
          reset();
        }}
        role="alertdialog"
        size="sm"
        testId="smtp-clear-dialog"
        title={t("smtp.clearTitle")}
        description={t("smtp.clearBody")}
        footer={
          <>
            <Button
              variant="secondary"
              data-autofocus
              disabled={busy}
              className="sm:ml-auto"
              onClick={() => {
                setConfirmClear(false);
                reset();
              }}
            >
              {t("rq.rj.cancel")}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void put(null)} data-testid="smtp-clear-confirm">
              {!busy && <Trash2 aria-hidden className="size-4" />}
              {t("smtp.clear")}
            </Button>
          </>
        }
      />
      <MailTestDialog
        open={testOpen}
        onClose={() => setTestOpen(false)}
        path="/settings/smtp/test"
        title={t("smtp.test")}
        body={t("smtp.testDialogBody")}
        testId="smtp-test-dialog"
      />
    </div>
  );
}
