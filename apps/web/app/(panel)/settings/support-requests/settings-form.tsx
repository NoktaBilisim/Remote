"use client";

import {
  BellRing,
  Copy,
  Flag,
  Globe,
  KeyRound,
  Link2,
  Mail,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Timer,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MailTestDialog } from "@/components/account/mail-test-dialog";
import { useId, useState, type ReactNode } from "react";
import { FormError } from "@/components/form-error";
import { LeaveDialog } from "@/components/leave-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import {
  MAX_RECIPIENTS,
  MAX_TRUSTED_CIDRS,
  WAIT_MAX,
  WAIT_MIN,
  type SupportRequestSettings,
  type WhatsappTestResponse,
} from "@/lib/requests/contract";
import { buildInput, isDirty, toState, type SettingsErrorKey, type SettingsState } from "@/lib/requests/settings-form";
import { normalizePhone } from "@/lib/requests/validate";
import { REQUEST_PRIORITIES, type RequestPriority } from "@/lib/requests/p18";
import { labelOf, PRIORITY_LABELS } from "@remote/contracts/labels";
import { SLA_MINUTES_MAX, SLA_MINUTES_MIN } from "@remote/contracts/api/requests";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { copyText } from "@/lib/use-now";

const errText = (e: SettingsErrorKey | string | undefined): string | undefined =>
  e === undefined ? undefined : e.startsWith("msg:") ? e.slice(4) : t(`srs.err.${e}` as MessageKey);

function Section({ id, title, Icon, children }: { id: string; title: string; Icon: typeof Link2; children: ReactNode }) {
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

/** Satır listesi düzenleyici (alıcılar / CIDR): satır başına alan + kaldır, en çok `max` satır. */
function ListEditor({
  label,
  values,
  onChange,
  max,
  errors,
  errorKey,
  placeholder,
  addLabel,
  removeLabel,
  disabled,
  testId,
  inputMode,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  max: number;
  errors: Record<string, string>;
  errorKey: string;
  placeholder: string;
  addLabel: string;
  removeLabel: (v: string, i: number) => string;
  disabled: boolean;
  testId: string;
  inputMode?: "tel" | "text";
}) {
  const listErr = errText(errors[errorKey]);
  const listId = useId();
  return (
    <fieldset className="flex flex-col gap-2" data-testid={testId} aria-describedby={listErr ? `${listId}-e` : undefined}>
      <legend className="mb-1 text-sm font-medium text-fg">
        {label}{" "}
        <span className="font-normal text-fg-muted tabular-nums">
          ({values.length}/{max})
        </span>
      </legend>
      {values.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
          <TextField
            label={`${label} ${i + 1}`}
            className="min-w-0 flex-1 [&>label]:sr-only"
            value={v}
            inputMode={inputMode}
            placeholder={placeholder}
            disabled={disabled}
            error={errText(errors[`${errorKey}.${i}`])}
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            aria-label={removeLabel(v, i)}
            className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-danger-surface hover:text-danger disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 aria-hidden className="size-4" />
          </button>
        </div>
      ))}
      {listErr && (
        <p id={`${listId}-e`} className="text-xs font-medium text-danger">
          {listErr}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        className="self-start"
        disabled={disabled || values.length >= max}
        onClick={() => onChange([...values, ""])}
      >
        <Plus aria-hidden className="size-4" />
        {addLabel}
      </Button>
    </fieldset>
  );
}

/**
 * Ayarlar > Destek talepleri (AC-129, 131, 142, 150–152). Kaydedilmemiş değişiklikte sayfadan ayrılma uyarısı;
 * submit sırasında alanlar kilitli; sunucu 400 `fields` aynı yollarla alanlara yansır.
 */
export function SettingsForm({ initial }: { initial: SupportRequestSettings }) {
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [st, setSt] = useState<SettingsState>(() => toState(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<UiError | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testError, setTestError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [mailTestOpen, setMailTestOpen] = useState(false);
  const dirty = isDirty(st, toState(saved));

  // TEST-P8b-1: menü bağlantısı, geri tuşu ve yenileme/kapama — oturum geçmişi notuyla aynı koruma.
  const guard = useLeaveGuard(dirty && !saving);

  const set = (patch: Partial<SettingsState>) => setSt((s) => ({ ...s, ...patch }));
  const unauth = (e: unknown) => {
    if (isUnauthenticated(e)) {
      router.replace(EXPIRED_LOGIN_PATH);
      return true;
    }
    return false;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const { input, errors: errs } = buildInput(st, saved.email);
    setErrors(errs);
    setFormError(null);
    if (!input) {
      setFormError({ message: t("srs.fixErrors"), tone: "danger" });
      return;
    }
    setSaving(true);
    try {
      const next = await api<SupportRequestSettings>("PUT", "/settings/support-requests", input);
      setSaved(next);
      setSt(toState(next));
      toast(t("srs.saved"));
    } catch (err) {
      if (unauth(err)) return;
      if (err instanceof ApiError && err.status === 400 && err.fields) {
        setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, `msg:${v}`])));
        setFormError({ message: t("srs.fixErrors"), tone: "danger" });
      } else setFormError(toUiError(err));
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    setRotating(true);
    setRotateError(null);
    try {
      const next = await api<SupportRequestSettings>("POST", "/settings/support-requests/rotate-ref", {});
      setSaved((s) => ({
        ...s,
        downloadUrl: next.downloadUrl,
        fileName: next.fileName,
        refPrefix: next.refPrefix,
        refRotatedAt: next.refRotatedAt,
        webFormUrl: next.webFormUrl,
      }));
      setRotateOpen(false);
      toast(t("srs.dl.rotated"));
    } catch (err) {
      if (!unauth(err)) setRotateError(toUiError(err));
    } finally {
      setRotating(false);
    }
  };

  const sendTest = async () => {
    setTestResult(null);
    const phone = normalizePhone(testPhone);
    if (!phone) {
      setTestError(t("srs.err.phone"));
      return;
    }
    setTestError(undefined);
    setTesting(true);
    try {
      const r = await api<WhatsappTestResponse>("POST", "/settings/support-requests/whatsapp/test", { phone });
      setTestResult({ ok: r.ok, message: r.message || (r.ok ? t("srs.wa.testOk") : t("srs.wa.testFail")) });
    } catch (err) {
      if (unauth(err)) return;
      if (err instanceof ApiError && err.status === 400 && err.fields?.phone) setTestError(err.fields.phone);
      else setTestResult({ ok: false, message: toUiError(err).message });
    } finally {
      setTesting(false);
    }
  };

  const copy = async (url = saved.downloadUrl) => {
    const ok = await copyText(url);
    toast(ok ? t("srs.dl.copied") : t("srs.dl.copyFailed"), ok ? "success" : "danger");
  };
  const warnings = new Set(saved.channelWarnings ?? []);

  return (
    <div className="mt-6 flex max-w-3xl flex-col gap-6">
      <Section id="dl" title={t("srs.dl.title")} Icon={Link2}>
        <p className="text-sm text-fg-muted">{t("srs.dl.body")}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code
            data-testid="download-url"
            className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-3 py-2.5 font-mono text-sm text-fg break-all"
          >
            {saved.downloadUrl}
          </code>
          <Button type="button" variant="secondary" onClick={() => void copy()} className="shrink-0" data-testid="download-url-copy">
            <Copy aria-hidden className="size-4" />
            {t("srs.dl.copy")}
          </Button>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-fg-muted">{t("srs.dl.fileName")}</dt>
          <dd className="font-mono text-fg break-all" data-testid="download-file-name">
            {saved.fileName}
          </dd>
          <dt className="text-fg-muted">{t("srs.dl.rotatedAt")}</dt>
          <dd className="text-fg tabular-nums">{saved.refRotatedAt ? formatDateTime(saved.refRotatedAt) : t("srs.dl.never")}</dd>
        </dl>
        <Button type="button" variant="danger-ghost" className="self-start" onClick={() => setRotateOpen(true)}>
          <RefreshCw aria-hidden className="size-4" />
          {t("srs.dl.rotate")}
        </Button>
      </Section>

      <form onSubmit={save} noValidate className="flex flex-col gap-6" data-testid="settings-form">
        {formError && <FormError error={formError} />}
        <fieldset disabled={saving} className="flex flex-col gap-6">
          <Section id="wait" title={t("srs.wait.title")} Icon={Timer}>
            <TextField
              label={t("srs.wait.label")}
              type="number"
              inputMode="numeric"
              min={WAIT_MIN}
              max={WAIT_MAX}
              className="max-w-48"
              value={st.waitMinutes}
              onChange={(e) => set({ waitMinutes: e.target.value })}
              error={errText(errors.waitMinutes)}
              hint={t("srs.wait.hint", { min: WAIT_MIN, max: WAIT_MAX })}
            />
          </Section>

          {/* P18 (AC-257): firma varsayılan önceliği ve SLA hedefi (müşteri tanımı öncelikli) */}
          <Section id="prio" title={t("srs.prio.title")} Icon={Flag}>
            <p className="text-sm text-fg-muted">{t("srs.prio.body")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label={t("srs.prio.label")}
                value={st.priority}
                onChange={(e) => set({ priority: e.target.value as RequestPriority })}
                options={[...REQUEST_PRIORITIES].reverse().map((p) => ({ value: p, label: labelOf(PRIORITY_LABELS, p) }))}
                data-testid="default-priority"
              />
              <TextField
                label={t("srs.sla.label")}
                type="number"
                inputMode="numeric"
                min={SLA_MINUTES_MIN}
                max={SLA_MINUTES_MAX}
                value={st.slaMinutes}
                onChange={(e) => set({ slaMinutes: e.target.value })}
                error={errText(errors.defaultSlaMinutes)}
                hint={t("srs.sla.hint", { min: SLA_MINUTES_MIN, max: SLA_MINUTES_MAX })}
                data-testid="default-sla"
              />
            </div>
            <Link
              href="/settings/business-hours"
              className="inline-flex min-h-11 items-center gap-2 self-start rounded-md px-1 text-sm font-medium text-primary hover:underline"
            >
              <Timer aria-hidden className="size-4" />
              {t("srs.sla.hoursLink")}
            </Link>
          </Section>

          {/* P15 (AC-239): kabul kodu — açıkken kabul, müşteri ekranındaki 4 haneli kodla tamamlanır (AC-112) */}
          <Section id="ac" title={t("srs.ac.title")} Icon={KeyRound}>
            <Switch
              label={t("srs.ac.label")}
              checked={st.acceptCode}
              onChange={(v) => set({ acceptCode: v })}
              description={t("srs.ac.desc")}
              onText={t("rq.on")}
              offText={t("rq.off")}
              testId="accept-code-switch"
            />
          </Section>

          <Section id="wa" title={t("srs.notify.title")} Icon={MessageSquare}>
            {saved.whatsapp.insecure && (
              <Alert tone="warning" testId="wa-insecure">
                {t("srs.wa.insecure")}
              </Alert>
            )}
            {!saved.whatsapp.serviceConfigured && (
              <Alert tone="warning" testId="wa-unconfigured">
                {t("srs.wa.unconfigured")}
              </Alert>
            )}
            <Switch
              label={t("srs.wa.label")}
              checked={st.waEnabled}
              onChange={(v) => set({ waEnabled: v })}
              description={t("srs.wa.desc")}
              onText={t("rq.on")}
              offText={t("rq.off")}
              testId="wa-switch"
            />
            <ListEditor
              label={t("srs.wa.recipients")}
              values={st.waRecipients}
              onChange={(v) => set({ waRecipients: v })}
              max={MAX_RECIPIENTS}
              errors={errors}
              errorKey="whatsapp.recipients"
              placeholder="0532 000 00 00"
              addLabel={t("srs.wa.add")}
              removeLabel={(v, i) => t("srs.wa.remove", { v: v || String(i + 1) })}
              disabled={saving}
              testId="wa-recipients"
              inputMode="tel"
            />
            <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-start">
              <TextField
                label={t("srs.wa.testPhone")}
                inputMode="tel"
                className="min-w-0 flex-1"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                error={testError}
                hint={t("srs.wa.testHint")}
              />
              <Button type="button" variant="secondary" className="shrink-0 sm:mt-7" loading={testing} onClick={() => void sendTest()}>
                {!testing && <Send aria-hidden className="size-4" />}
                {t("srs.wa.test")}
              </Button>
            </div>
            {testResult && (
              <Alert tone={testResult.ok ? "success" : "danger"} testId="wa-test-result">
                {testResult.message}
              </Alert>
            )}
            <div className="flex flex-col gap-4 border-t border-border pt-4" data-testid="mail-channel">
              <Switch
                label={t("srs.mail.label")}
                checked={st.mailEnabled}
                onChange={(v) => set({ mailEnabled: v })}
                disabled={!saved.email.smtpConfigured && !st.mailEnabled}
                description={saved.email.smtpConfigured ? t("srs.mail.desc") : t("srs.mail.needSmtp")}
                onText={t("rq.on")}
                offText={t("rq.off")}
                testId="mail-switch"
              />
              {errText(errors["email.enabled"]) && <p className="text-xs font-medium text-danger">{errText(errors["email.enabled"])}</p>}
              {!saved.email.smtpConfigured && (
                <Link
                  href="/settings/smtp"
                  className="inline-flex min-h-11 items-center gap-2 self-start rounded-md px-1 text-sm font-medium text-primary hover:underline"
                  data-testid="mail-smtp-link"
                >
                  <Mail aria-hidden className="size-4" />
                  {t("srs.mail.goSmtp")}
                </Link>
              )}
              <ListEditor
                label={t("srs.mail.recipients")}
                values={st.mailRecipients}
                onChange={(v) => set({ mailRecipients: v })}
                max={MAX_RECIPIENTS}
                errors={errors}
                errorKey="email.recipients"
                placeholder="destek@ornek.com"
                addLabel={t("srs.mail.add")}
                removeLabel={(v, i) => t("srs.mail.remove", { v: v || String(i + 1) })}
                disabled={saving}
                testId="mail-recipients"
              />
              <Button
                type="button"
                variant="secondary"
                className="self-start"
                disabled={!saved.email.smtpConfigured}
                onClick={() => setMailTestOpen(true)}
                data-testid="mail-test-open"
              >
                <Send aria-hidden className="size-4" />
                {t("srs.mail.test")}
              </Button>
            </div>
          </Section>

          {/* P19 (AC-259): web talep formu — kapalıyken /r/<ref> tek tip 404 (kill switch, S-P19-T9) */}
          <Section id="wf" title={t("srs.wf.title")} Icon={Globe}>
            <Switch
              label={t("srs.wf.label")}
              checked={st.webForm}
              onChange={(v) => set({ webForm: v })}
              description={t("srs.wf.desc")}
              onText={t("rq.on")}
              offText={t("rq.off")}
              testId="web-form-switch"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code
                data-testid="web-form-url"
                className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-3 py-2.5 font-mono text-sm text-fg break-all"
              >
                {saved.webFormUrl}
              </code>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void copy(saved.webFormUrl)}
                className="shrink-0"
                data-testid="web-form-url-copy"
              >
                <Copy aria-hidden className="size-4" />
                {t("srs.wf.copy")}
              </Button>
            </div>
            {!saved.webFormEnabled && (
              <p className="text-xs text-fg-muted" data-testid="web-form-off-hint">
                {t("srs.wf.offHint")}
              </p>
            )}
          </Section>

          {/* P19 (AC-261): müşteriye durum bildirimi kanalları; açık ama kullanılamayan kanal → uyarı bandı */}
          <Section id="cn" title={t("srs.cn.title")} Icon={BellRing}>
            <p className="text-sm text-fg-muted">{t("srs.cn.body")}</p>
            {(
              [
                ["sms", "notifySms", MessageSquareText, "/settings/sms"],
                ["whatsapp", "notifyWa", MessageCircle, null],
                ["email", "notifyEmail", Mail, "/settings/smtp"],
              ] as const
            ).map(([ch, key, Icon, href]) => (
              <div key={ch} className="flex flex-col gap-2" data-testid={`notify-${ch}`}>
                <Switch
                  label={t(`srs.cn.${ch}` as MessageKey)}
                  checked={st[key]}
                  onChange={(v) => set({ [key]: v } as Partial<SettingsState>)}
                  onText={t("rq.on")}
                  offText={t("rq.off")}
                  testId={`notify-${ch}-switch`}
                />
                {warnings.has(ch) && (
                  <Alert tone="warning" testId={`channel-warning-${ch}`}>
                    <span className="flex flex-col gap-1">
                      <span>{t(`srs.cn.warn.${ch}` as MessageKey)}</span>
                      {href && (
                        <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 self-start font-medium underline">
                          <Icon aria-hidden className="size-4" />
                          {t(`srs.cn.go.${ch}` as MessageKey)}
                        </Link>
                      )}
                    </span>
                  </Alert>
                )}
              </div>
            ))}
          </Section>

          <Section id="cidr" title={t("srs.cidr.title")} Icon={ShieldCheck}>
            <p className="text-sm text-fg-muted">{t("srs.cidr.body")}</p>
            <ListEditor
              label={t("srs.cidr.label")}
              values={st.trustedCidrs}
              onChange={(v) => set({ trustedCidrs: v })}
              max={MAX_TRUSTED_CIDRS}
              errors={errors}
              errorKey="trustedCidrs"
              placeholder="203.0.113.0/24"
              addLabel={t("srs.cidr.add")}
              removeLabel={(v, i) => t("srs.cidr.remove", { v: v || String(i + 1) })}
              disabled={saving}
              testId="cidr-list"
            />
          </Section>
        </fieldset>

        {/* TEST-P8b-3: çubuk yalnız kaydedilmemiş değişiklikte (veya kayıt sürerken); mobilde tek satır, geri al ikon. */}
        {(dirty || saving) && (
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
              className="shrink-0 px-3 sm:px-4"
              disabled={saving}
              onClick={() => {
                setSt(toState(saved));
                setErrors({});
                setFormError(null);
              }}
            >
              <RotateCcw aria-hidden className="size-4" />
              <span className="sr-only sm:not-sr-only">{t("srs.revert")}</span>
            </Button>
            <Button type="submit" loading={saving} className="shrink-0">
              {!saving && <Save aria-hidden className="size-4" />}
              {t("srs.save")}
            </Button>
          </div>
        )}
      </form>

      <Dialog
        open={rotateOpen}
        onClose={() => !rotating && setRotateOpen(false)}
        size="sm"
        role="alertdialog"
        testId="rotate-dialog"
        title={t("srs.dl.rotateTitle")}
        description={t("srs.dl.rotateBody")}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setRotateOpen(false)} disabled={rotating} className="sm:ml-auto">
              {t("rq.rj.cancel")}
            </Button>
            <Button variant="danger" loading={rotating} onClick={() => void rotate()}>
              {!rotating && <RefreshCw aria-hidden className="size-4" />}
              {t("srs.dl.rotateConfirm")}
            </Button>
          </>
        }
      >
        {rotateError && <FormError error={rotateError} />}
      </Dialog>
      <LeaveDialog guard={guard} body={t("srs.leaveBody")} />
      <MailTestDialog
        open={mailTestOpen}
        onClose={() => setMailTestOpen(false)}
        path="/settings/support-requests/email/test"
        title={t("srs.mail.test")}
        body={t("srs.mail.testBody")}
        testId="mail-test-dialog"
      />
    </div>
  );
}
