"use client";

import { Download, Info, KeyRound, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { CopyLink } from "@/components/copy-link";
import { CustomerCombobox } from "@/components/customer-combobox";
import { FormError } from "@/components/form-error";
import { SendToCustomerDialog } from "@/components/send-to-customer/send-to-customer-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ComboOption } from "@/components/ui/combobox";
import { Dialog } from "@/components/ui/dialog";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import type { UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { CONNECT_BLOCKED_REASON_LABELS, type CreatedRegistrationCode } from "@/lib/unattended/contract";
import { installNote, isContactMissing, isSmtpMissing, unattendedUiError } from "@/lib/unattended/errors";

type Failure = { ui: UiError; contactFor?: string };

/** Kod bir kez gösterilir (AC-273): kopyala, müşteriye gönder (LG), indir, 3 adım + UAC satırı (O-P27-4, AC-342). */
function CodeResult({ created, riskAccepted }: { created: CreatedRegistrationCode; riskAccepted: boolean }) {
  const note = installNote(riskAccepted, created.agentSha256);
  return (
    <div className="flex flex-col gap-4" data-testid="un-code-result">
      <Alert tone="success">{t("un.code.once")}</Alert>
      <p className="font-mono text-2xl font-bold tracking-wider text-fg break-all" data-testid="un-code-value">
        {created.code}
      </p>
      <div className="flex flex-wrap items-start gap-2">
        <CopyLink url={created.code} srLabel={t("un.code.copy")} testId="un-code-copy" />
        {/* LG-3 (AC-415): gönderim yolu yalnız bu tek gösterimde; diyalog kapanınca kod bellekten atılır */}
        <SendToCustomerDialog target={{ kind: "UNATTENDED_CODE", codeId: created.id, code: created.code }} testId="un-code-send" />
      </div>
      <p className="text-sm text-fg-muted tabular-nums">{t("un.code.expires", { at: formatDateTime(created.expiresAt) })}</p>
      <a
        href={created.downloadUrl}
        download
        data-testid="un-code-download"
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-md border border-border bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-muted"
      >
        <Download aria-hidden className="size-4" />
        {t("un.code.download")}
      </a>
      {note && (
        <p className="flex items-start gap-2 text-sm text-fg-muted wrap-anywhere" data-testid="un-code-unsigned-note">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span title={created.agentSha256 ? `SHA-256 ${created.agentSha256}` : undefined}>{note}</span>
        </p>
      )}
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-fg" data-testid="un-code-steps">
        <li>{t("un.code.step1")}</li>
        <li>{t("un.code.step2")}</li>
        <li>{t("un.code.step3")}</li>
      </ol>
      <p className="flex items-start gap-2 text-sm text-warning" data-testid="un-code-uac">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t("un.code.uac")}
      </p>
    </div>
  );
}

function useCodeForm(onSmtpMissing: () => void) {
  const router = useRouter();
  const [customer, setCustomer] = useState<ComboOption | null>(null);
  const [fieldError, setFieldError] = useState<string>();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedRegistrationCode | null>(null);
  const reset = () => (setCustomer(null), setFieldError(undefined), setFailure(null), setCreated(null));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!customer) return setFieldError(t("un.code.customerRequired"));
    setBusy(true);
    setFailure(null);
    try {
      setCreated(await api<CreatedRegistrationCode>("POST", "/unattended/registration-codes", { customerId: customer.id }));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (isSmtpMissing(err)) onSmtpMissing();
      setFailure({ ui: unattendedUiError(err), contactFor: isContactMissing(err) ? customer.id : undefined });
    } finally {
      setBusy(false);
    }
  };
  const pick = (v: ComboOption | null) => (setCustomer(v), setFieldError(undefined));
  return { customer, pick, fieldError, failure, busy, created, submit, reset, refresh: () => router.refresh() };
}

function PickFooter({ formId, busy, onCancel }: { formId: string; busy: boolean; onCancel: () => void }) {
  return (
    <>
      <Button variant="secondary" className="sm:ml-auto" onClick={onCancel} disabled={busy}>
        {t("su.cancel")}
      </Button>
      <Button type="submit" form={formId} loading={busy} data-testid="un-code-submit">
        {!busy && <KeyRound aria-hidden className="size-4" />}
        {t("un.code.submit")}
      </Button>
    </>
  );
}

function PickForm({ formId, f }: { formId: string; f: ReturnType<typeof useCodeForm> }) {
  return (
    <form id={formId} noValidate onSubmit={(e) => void f.submit(e)} className="flex flex-col gap-3">
      <CustomerCombobox
        label={t("un.code.customer")}
        value={f.customer}
        onChange={f.pick}
        error={f.fieldError}
        disabled={f.busy}
        testId="un-code-customer"
      />
      <FormError error={f.failure?.ui ?? null} />
      {f.failure?.contactFor && (
        <Link
          href={`/customers/${f.failure.contactFor}#bildirim-adresleri`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
        >
          {t("un.code.addContacts")}
        </Link>
      )}
    </form>
  );
}

/** Kayıt kodu oluştur diyaloğu: müşteri seç → (step-up, `lib/api`) → kod bir kez. Kapatınca bekleyen kodlar tazelenir. */
function CodeDialog({
  open,
  onClose,
  onSmtpMissing,
  riskAccepted,
}: {
  open: boolean;
  onClose: () => void;
  onSmtpMissing: () => void;
  riskAccepted: boolean;
}) {
  const f = useCodeForm(onSmtpMissing);
  const formId = useId();
  const close = () => {
    if (f.busy) return;
    if (f.created) f.refresh();
    f.reset();
    onClose();
  };
  const footer = f.created ? (
    <Button data-autofocus className="sm:ml-auto" onClick={close} data-testid="un-code-close">
      {t("un.code.close")}
    </Button>
  ) : (
    <PickFooter formId={formId} busy={f.busy} onCancel={close} />
  );
  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("un.code.title")}
      description={f.created ? undefined : t("un.code.desc")}
      footer={footer}
      testId="un-code-dialog"
    >
      {f.created ? <CodeResult created={f.created} riskAccepted={riskAccepted} /> : <PickForm formId={formId} f={f} />}
    </Dialog>
  );
}

/**
 * "Kayıt kodu oluştur" (`KeyRound`, `manage`): kapı kapalıysa ya da firma SMTP kaydı yoksa pasif + görünür neden (AC-336).
 * Sunucu 409 `NOTIFY_CHANNEL_UNAVAILABLE` dönerse düğme bu sayfa açık kaldıkça aynı nedenle pasifleşir.
 */
export function CreateCodeButton({
  block,
  riskAccepted = false,
  testId = "un-create-code",
}: {
  block: string | null;
  /** P32: kapı `unsigned-accepted` → sonuçta kurulum notu (S-P32-8). */
  riskAccepted?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [smtpMissing, setSmtpMissing] = useState(false);
  const reason = block ?? (smtpMissing ? CONNECT_BLOCKED_REASON_LABELS.smtp : null);
  const reasonId = useId();
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        disabled={reason !== null}
        aria-describedby={reason ? reasonId : undefined}
        onClick={() => setOpen(true)}
        data-testid={testId}
      >
        <KeyRound aria-hidden className="size-4" />
        {t("un.createCode")}
      </Button>
      {reason && (
        <p id={reasonId} className="max-w-64 text-xs text-fg-muted" data-testid={`${testId}-reason`}>
          {reason}
        </p>
      )}
      <CodeDialog open={open} onClose={() => setOpen(false)} onSmtpMissing={() => setSmtpMissing(true)} riskAccepted={riskAccepted} />
    </div>
  );
}
