"use client";

import {
  UNATTENDED_CODE_SENDS_MAX,
  type CustomerSendChannel,
  type CustomerSendOptions,
  type SendTarget,
} from "@remote/contracts/api/customer-send";
import { Mail, MessageCircle, MessageSquareText, Send, Settings, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { SelectField } from "@/components/ui/select-field";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { blockedChannels, canSend, recipientKind, usableChannels } from "@/lib/customer-send";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import { checkLinkPhone } from "@/lib/notify/send-link";
import { useHydrated } from "@/lib/use-hydrated";
import { useSendToCustomer } from "./use-send-to-customer";

/** AC-426: her kanalın anlamlı ikonu. */
const CHANNEL_ICON: Record<CustomerSendChannel, LucideIcon> = {
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  SMS: MessageSquareText,
};

type Hook = ReturnType<typeof useSendToCustomer>;

function LoadingState() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" data-testid="cs-loading">
      <p className="sr-only" role="status">
        {t("customerSend.loading")}
      </p>
      <Skeleton className="h-11 w-56" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/** Yetkili ama kullanılamayan kanallar: neden + (yetki varsa) ayar bağlantısı. Boş ve kısmi durumda ortak. */
function BlockedList({ options }: { options: CustomerSendOptions }) {
  const blocked = blockedChannels(options);
  if (blocked.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-sm text-fg-muted" data-testid="cs-blocked">
      <p className="font-medium text-fg">{t("customerSend.unavailable")}</p>
      <ul className="flex flex-col gap-1">
        {blocked.map((c) => {
          const Icon = CHANNEL_ICON[c.channel];
          const name = t(`customerSend.ch.${c.channel}`);
          return (
            <li key={c.channel} className="flex flex-wrap items-center gap-x-2">
              <Icon aria-hidden className="size-4" />
              <span>
                {name}: {c.block ? t(`customerSend.block.${c.block}`) : t("customerSend.block.unconfigured")}
              </span>
              {c.settingsHref && (
                <Link
                  href={c.settingsHref}
                  className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline"
                  data-testid={`cs-settings-${c.channel}`}
                >
                  <Settings aria-hidden className="size-4" />
                  {t("customerSend.settings", { channel: name })}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChannelPicker({ h, channels }: { h: Hook; channels: CustomerSendChannel[] }) {
  const name = useId();
  // Tek kanal (ör. kayıt kodu yalnız e-posta, O-LG-3): seçim yok, yalnız bilgi satırı.
  const only = channels.length === 1 ? channels[0] : undefined;
  if (only) {
    const Icon = CHANNEL_ICON[only];
    return (
      <p className="flex items-center gap-2 text-sm text-fg-muted" data-testid="cs-channel-single">
        <Icon aria-hidden className="size-4" />
        {t("customerSend.via", { channel: t(`customerSend.ch.${only}`) })}
      </p>
    );
  }
  return (
    <fieldset className="flex flex-col gap-1.5" disabled={h.s.busy}>
      <legend className="mb-1.5 text-sm font-medium text-fg">{t("customerSend.channel")}</legend>
      <div className="flex flex-wrap gap-2" data-testid="cs-channels">
        {channels.map((c) => {
          const Icon = CHANNEL_ICON[c];
          return (
            <label
              key={c}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg-muted hover:bg-surface-muted has-checked:border-primary has-checked:bg-primary-surface has-checked:text-primary"
            >
              <input
                type="radio"
                name={name}
                value={c}
                checked={h.s.channel === c}
                onChange={() => h.dispatch({ type: "channel", channel: c })}
                className="size-4 accent-primary"
                data-testid={`cs-channel-${c}`}
              />
              <Icon aria-hidden className="size-4" />
              {t(`customerSend.ch.${c}`)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function RecipientField({
  h,
  options,
  inputRef,
}: {
  h: Hook;
  options: CustomerSendOptions;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const listId = useId();
  const channel = h.s.channel ?? "EMAIL";
  const kind = recipientKind(channel);
  const choices = options.recipients[kind];
  const value = h.s.to[kind];
  if (options.recipientsLocked) {
    if (choices.length === 0)
      return (
        <Alert tone="info" testId="cs-no-recipients">
          {t("customerSend.noRecipients")}
        </Alert>
      );
    return (
      <SelectField
        label={t("customerSend.toLocked")}
        options={choices.map((c) => ({ value: c.value, label: c.value }))}
        value={value}
        onChange={(e) => h.dispatch({ type: "to", value: e.target.value })}
        error={h.s.fieldError}
        hint={t("customerSend.lockedHint")}
        disabled={h.s.busy}
        data-testid="cs-to"
      />
    );
  }
  const e164 = kind === "phone" && channel !== "EMAIL" ? checkLinkPhone(value, channel).e164 : undefined;
  const hint =
    kind === "email" ? t("customerSend.emailHint") : e164 ? t("customerSend.phonePreview", { e164 }) : t("customerSend.phoneHint");
  return (
    <>
      <TextField
        ref={inputRef}
        label={kind === "email" ? t("customerSend.toEmail") : t("customerSend.toPhone")}
        type={kind === "email" ? "email" : "tel"}
        inputMode={kind === "email" ? "email" : "tel"}
        value={value}
        onChange={(e) => h.dispatch({ type: "to", value: e.target.value })}
        error={h.s.fieldError}
        hint={hint}
        list={choices.length > 0 ? listId : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={h.s.busy}
        data-testid="cs-to"
      />
      {choices.length > 0 && (
        <datalist id={listId}>
          {choices.map((c) => (
            <option key={c.value} value={c.value} />
          ))}
        </datalist>
      )}
    </>
  );
}

/** AC-407: sunucunun ürettiği metin olduğu gibi, salt okunur; istemcide yeniden üretilmez. */
function Preview({ options, channel }: { options: CustomerSendOptions; channel: CustomerSendChannel }) {
  const id = useId();
  const p = options.previews[channel];
  if (!p) return null;
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-1.5" data-testid="cs-preview">
      <h3 id={`${id}-h`} className="text-sm font-medium text-fg">
        {t("customerSend.preview")}
      </h3>
      {p.subject !== null && (
        <p className="text-sm text-fg wrap-anywhere">
          <span className="text-fg-muted">{t("customerSend.subject")}: </span>
          <span data-testid="cs-preview-subject">{p.subject}</span>
        </p>
      )}
      <pre
        tabIndex={0}
        aria-labelledby={`${id}-h`}
        data-testid="cs-preview-text"
        className="max-h-64 overflow-y-auto rounded-md border border-border bg-surface-muted p-3 font-sans text-sm whitespace-pre-wrap text-fg wrap-anywhere"
      >
        {p.text}
      </pre>
      <p className="text-xs text-fg-muted">{t("customerSend.previewNote")}</p>
    </section>
  );
}

function ReadyForm({ h, options, formId }: { h: Hook; options: CustomerSendOptions; formId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const channels = usableChannels(options);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await h.send();
    if (!ok) inputRef.current?.focus();
  };
  if (channels.length === 0 || !h.s.channel)
    return (
      <div className="flex flex-col gap-4">
        <EmptyState Icon={Send} title={t("customerSend.none")} body={t("customerSend.noneBody")} testId="cs-empty" headingLevel={2} />
        <BlockedList options={options} />
      </div>
    );
  const remaining = options.remainingSends;
  return (
    <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" data-testid="cs-form">
      <ChannelPicker h={h} channels={channels} />
      <RecipientField h={h} options={options} inputRef={inputRef} />
      <Preview options={options} channel={h.s.channel} />
      {remaining !== null && (
        <p className="text-sm text-fg-muted tabular-nums" data-testid="cs-remaining">
          {remaining > 0 ? t("customerSend.remaining", { n: remaining, max: UNATTENDED_CODE_SENDS_MAX }) : t("customerSend.noneLeft")}
        </p>
      )}
      {h.s.result && (
        <Alert tone={h.s.result.tone} testId="cs-result">
          {h.s.result.message}
        </Alert>
      )}
      <BlockedList options={options} />
    </form>
  );
}

function Body({ h, formId }: { h: Hook; formId: string }) {
  if (h.s.load.kind === "loading") return <LoadingState />;
  if (h.s.load.kind === "error")
    return (
      <div data-testid="cs-load-error">
        <LoadError onRetry={() => void h.load()} />
      </div>
    );
  return <ReadyForm h={h} options={h.s.load.options} formId={formId} />;
}

/**
 * LG-3 (AC-405..409, 426; mimari-link-gonderme §9): tek "Müşteriye gönder" düğmesi + diyalog. Üç giriş noktası
 * (oturum kartı, kayıt kodu gösterimi, müşteri ayrıntısı) yalnız `target` ile ayrışır. Diyalog `document.body`'ye
 * taşınır (üst diyalog/form içinde iç içe DOM olmasın); başarıdan sonra açık kalır (ikinci kanal).
 */
export function SendToCustomerDialog({
  target,
  testId = "customer-send-open",
  disabled = false,
  className = "",
}: {
  target: SendTarget;
  testId?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const hydrated = useHydrated();
  const h = useSendToCustomer(target);
  const formId = useId();
  const ready = h.s.load.kind === "ready" && h.s.channel !== null;
  const close = () => {
    if (!h.s.busy) setOpen(false);
  };
  const footer = (
    <>
      <Button variant="secondary" className="sm:ml-auto" onClick={close} disabled={h.s.busy} data-testid="cs-close">
        {t("customerSend.close")}
      </Button>
      {ready && (
        <Button type="submit" form={formId} loading={h.s.busy} disabled={!canSend(h.s) && !h.s.busy} data-testid="cs-send">
          {!h.s.busy && <Send aria-hidden className="size-4" />}
          {h.s.rateUntil !== null ? t("customerSend.wait", { t: formatRemaining(h.waitMs) }) : t("customerSend.send")}
        </Button>
      )}
    </>
  );
  return (
    <>
      <Button
        variant="secondary"
        className={`self-start ${className}`}
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          void h.load();
        }}
        data-testid={testId}
      >
        <Send aria-hidden className="size-4" />
        {t("customerSend.open")}
      </Button>
      {hydrated &&
        createPortal(
          <Dialog
            open={open}
            onClose={close}
            title={t("customerSend.title")}
            description={t(`customerSend.desc.${target.kind}`)}
            footer={footer}
            testId="cs-dialog"
          >
            <Body h={h} formId={formId} />
          </Dialog>,
          document.body,
        )}
    </>
  );
}
