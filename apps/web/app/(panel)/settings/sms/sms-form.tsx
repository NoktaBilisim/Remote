"use client";

import { KeyRound, MessageSquareText, RotateCcw, Save, Send, Trash2 } from "lucide-react";
import { SMS_API_KEY_REENTER, SMS_KEY_UNREADABLE_WARNING, type SmsSettingsView, type SmsTestResponse } from "@remote/contracts/api/notify";
import { normalizePhone } from "@remote/contracts/api/requests";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { FormError } from "@/components/form-error";
import { LeaveDialog } from "@/components/leave-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { buildSmsInput, smsDirty, smsToState, type SmsFormState } from "@/lib/notify/sms-form";
import { useLeaveGuard } from "@/lib/use-leave-guard";

function Section({ id, title, Icon, children }: { id: string; title: string; Icon: typeof KeyRound; children: ReactNode }) {
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
 * SMS ayarları (ortak standart §2.3): adres (boş = sistem varsayılanı), API anahtarı (maskeli; kayıtlı değer forma
 * gelmez, boş bırakılırsa korunur; "Anahtarı sil" onaylı), başlık, Kaydet; "Test SMS Gönder" sonucu ekranda.
 * Bantlar: anahtar okunamıyor (`keyUnreadable`), güvensiz adres, kullanılamıyor.
 */
export function SmsForm({ initial, canEdit }: { initial: SmsSettingsView; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [st, setSt] = useState<SmsFormState>(() => smsToState(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testError, setTestError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const dirty = smsDirty(st, smsToState(saved));
  const guard = useLeaveGuard(dirty && !saving);
  const set = (p: Partial<SmsFormState>) => setSt((s) => ({ ...s, ...p }));
  const unauth = (e: unknown) => {
    if (!isUnauthenticated(e)) return false;
    router.replace(EXPIRED_LOGIN_PATH);
    return true;
  };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    const { input, errors: errs } = buildSmsInput(st);
    setErrors(errs);
    setFormError(null);
    if (!input) return setFormError({ message: t("srs.fixErrors"), tone: "danger" });
    setSaving(true);
    try {
      const next = await api<SmsSettingsView>("PUT", "/settings/sms", input);
      setSaved(next);
      setSt(smsToState(next));
      toast(t("sms.saved"));
    } catch (err) {
      if (unauth(err)) return;
      if (err instanceof ApiError && err.status === 400 && err.fields && Object.keys(err.fields).length) {
        const f = { ...err.fields };
        if (f.apiKey === SMS_API_KEY_REENTER) f.apiKey = t("sms.keyReenter");
        setErrors(f);
        setFormError({ message: t("srs.fixErrors"), tone: "danger" });
      } else if (err instanceof ApiError && err.code === "HOST_NOT_ALLOWED") setErrors({ url: err.message || t("sms.hostNotAllowed") });
      else setFormError(toUiError(err));
    } finally {
      setSaving(false);
      setConfirmRemove(false);
    }
  };

  const sendTest = async () => {
    setTestResult(null);
    const phone = normalizePhone(testPhone);
    if (!phone) return setTestError(t("srs.err.phone"));
    setTestError(undefined);
    setTesting(true);
    try {
      const r = await api<SmsTestResponse>("POST", "/settings/sms/test", { phone });
      setTestResult({ ok: r.ok, message: r.message });
    } catch (err) {
      if (unauth(err)) return;
      if (err instanceof ApiError && err.status === 400 && err.fields?.phone) setTestError(err.fields.phone);
      else setTestResult({ ok: false, message: toUiError(err).message });
    } finally {
      setTesting(false);
    }
  };

  const unusableReason = !saved.usable && !saved.keyUnreadable && !saved.insecure;
  return (
    <div className="mt-6 flex max-w-3xl flex-col gap-6">
      {saved.keyUnreadable && (
        <Alert tone="warning" testId="sms-key-unreadable">
          {SMS_KEY_UNREADABLE_WARNING}
        </Alert>
      )}
      {saved.insecure && (
        <Alert tone="warning" testId="sms-insecure">
          {t("sms.insecure")}
        </Alert>
      )}
      {unusableReason && (
        <Alert tone="info" testId="sms-unusable">
          {t("sms.unusable")}
        </Alert>
      )}
      {saved.usable && (
        <Alert tone="success" testId="sms-usable">
          {t("sms.usable")}
        </Alert>
      )}
      {!canEdit && (
        <Alert tone="locked" testId="sms-readonly">
          {t("sms.readonly")}
        </Alert>
      )}
      <form onSubmit={save} noValidate className="flex flex-col gap-6" data-testid="sms-form">
        {formError && <FormError error={formError} />}
        <fieldset disabled={saving || !canEdit} className="flex flex-col gap-6">
          <Section id="sms-conn" title={t("sms.conn")} Icon={MessageSquareText}>
            <TextField
              label={t("sms.url")}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={saved.defaultUrl ? t("sms.urlDefault") : "https://sms.ornek.com"}
              value={st.url}
              error={errors.url}
              hint={saved.defaultUrl ? t("sms.urlHintDefault") : t("sms.urlHintNoDefault")}
              onChange={(e) => set({ url: e.target.value })}
              data-testid="sms-url"
            />
            <TextField
              label={t("sms.header")}
              maxLength={11}
              autoComplete="off"
              value={st.header}
              error={errors.header}
              hint={t("sms.headerHint")}
              onChange={(e) => set({ header: e.target.value })}
              data-testid="sms-header"
            />
          </Section>
          <Section id="sms-key" title={t("sms.key")} Icon={KeyRound}>
            <TextField
              label={t("sms.apiKey")}
              type="password"
              revealable
              autoComplete="new-password"
              spellCheck={false}
              value={st.apiKey}
              disabled={st.removeKey}
              placeholder={saved.apiKeySet ? t("sms.keySaved") : ""}
              error={errors.apiKey}
              hint={saved.apiKeySet ? t("sms.keyKeep") : t("sms.keyNone")}
              onChange={(e) => set({ apiKey: e.target.value })}
              data-testid="sms-api-key"
            />
            {saved.apiKeySet &&
              (st.removeKey ? (
                <p className="flex flex-wrap items-center gap-2 text-sm text-danger" data-testid="sms-key-remove-pending">
                  {t("sms.keyWillRemove")}
                  <Button type="button" variant="ghost" onClick={() => set({ removeKey: false })}>
                    <RotateCcw aria-hidden className="size-4" />
                    {t("srs.revert")}
                  </Button>
                </p>
              ) : (
                <Button
                  type="button"
                  variant="danger-ghost"
                  className="self-start"
                  onClick={() => setConfirmRemove(true)}
                  data-testid="sms-key-remove"
                >
                  <Trash2 aria-hidden className="size-4" />
                  {t("sms.keyRemove")}
                </Button>
              ))}
          </Section>
        </fieldset>
        {saved.updatedAt && <p className="text-xs text-fg-muted">{t("sms.updatedAt", { at: formatDateTime(saved.updatedAt) })}</p>}
        {(dirty || saving) && canEdit && (
          <div
            className="sticky bottom-0 z-10 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 shadow-lg sm:px-4 sm:py-3"
            data-testid="save-bar"
          >
            <p className="min-w-0 flex-1 text-xs font-medium text-warning sm:text-sm" role="status">
              {t("srs.dirty")}
            </p>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setSt(smsToState(saved));
                setErrors({});
                setFormError(null);
              }}
            >
              <RotateCcw aria-hidden className="size-4" />
              <span className="sr-only sm:not-sr-only">{t("srs.revert")}</span>
            </Button>
            <Button type="submit" loading={saving} data-testid="sms-save">
              {!saving && <Save aria-hidden className="size-4" />}
              {t("srs.save")}
            </Button>
          </div>
        )}
      </form>

      <Section id="sms-test" title={t("sms.test")} Icon={Send}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <TextField
            label={t("sms.testPhone")}
            type="tel"
            inputMode="tel"
            className="min-w-0 flex-1"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            error={testError}
            hint={dirty ? t("sms.testDirty") : t("sms.testHint")}
            disabled={!canEdit}
            data-testid="sms-test-phone"
          />
          <Button
            type="button"
            variant="secondary"
            className="shrink-0 sm:mt-7"
            loading={testing}
            disabled={!canEdit}
            onClick={() => void sendTest()}
            data-testid="sms-test-send"
          >
            {!testing && <Send aria-hidden className="size-4" />}
            {t("sms.test")}
          </Button>
        </div>
        {testResult && (
          <Alert tone={testResult.ok ? "success" : "danger"} testId="sms-test-result">
            {testResult.message}
          </Alert>
        )}
      </Section>

      <Dialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        size="sm"
        role="alertdialog"
        testId="sms-key-remove-dialog"
        title={t("sms.keyRemoveTitle")}
        description={t("sms.keyRemoveBody")}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirmRemove(false)} className="sm:ml-auto">
              {t("rq.rj.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                set({ removeKey: true, apiKey: "" });
                setConfirmRemove(false);
              }}
              data-testid="sms-key-remove-confirm"
            >
              <Trash2 aria-hidden className="size-4" />
              {t("sms.keyRemove")}
            </Button>
          </>
        }
      />
      <LeaveDialog guard={guard} body={t("srs.leaveBody")} />
    </div>
  );
}
