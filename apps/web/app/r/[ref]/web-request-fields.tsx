"use client";

import { Clock, Mail, MessageCircle, MessageSquareText, MoonStar, Send, type LucideIcon } from "lucide-react";
import type { NotifyChoice, WebFormInfo } from "@remote/contracts/api/requests";
import { useId } from "react";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import type { FormDraft } from "@/lib/web-request/flow";

const CHANNELS: [keyof NotifyChoice, LucideIcon][] = [
  ["sms", MessageSquareText],
  ["whatsapp", MessageCircle],
  ["email", Mail],
];

type SetDraft = (p: Partial<FormDraft>) => void;

/** Mesai dışı satırı: kabul (talep bırakılabilir) ya da red (form kapalı) + bir sonraki açılış. */
export function AfterHoursNote({ hours, closed }: { hours: WebFormInfo["businessHours"]; closed: boolean }) {
  return (
    <p className="flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm text-fg" data-testid="wr-after-hours" role="status">
      <MoonStar aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
      <span>
        {closed ? t("wr.closed") : t("wr.afterHours")}
        {hours.nextOpeningAt && ` ${t("wr.nextOpen", { at: formatDateTime(hours.nextOpeningAt) })}`}
      </span>
    </p>
  );
}

/** Ad, telefon, e-posta (bildirimde e-posta seçiliyse zorunlu ipucu), açıklama, gizli `website` alanı. */
export function ContactFields({ d, errors, set }: { d: FormDraft; errors: Record<string, string>; set: SetDraft }) {
  return (
    <>
      <TextField
        label={t("wr.name")}
        autoComplete="name"
        maxLength={100}
        value={d.customerName}
        error={errors.customerName}
        onChange={(e) => set({ customerName: e.target.value })}
        data-testid="wr-name"
      />
      <TextField
        label={t("wr.phone")}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        maxLength={40}
        placeholder="0532 000 00 00"
        value={d.phone}
        error={errors.phone}
        onChange={(e) => set({ phone: e.target.value })}
        data-testid="wr-phone"
      />
      <TextField
        label={t("wr.email")}
        type="email"
        autoComplete="email"
        maxLength={254}
        value={d.email}
        hint={d.notify.email ? t("wr.emailRequired") : t("wr.optional")}
        error={errors.email}
        onChange={(e) => set({ email: e.target.value })}
        data-testid="wr-email"
      />
      <Description value={d.description} error={errors.description} onChange={(v) => set({ description: v })} />
      <Honeypot value={d.website} onChange={(v) => set({ website: v })} />
    </>
  );
}

/** Gizli alan (bot kapısı): ekran dışı, sekmeyle ulaşılmaz, ekran okuyucudan gizli. */
function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div aria-hidden className="absolute top-0 -left-full size-px overflow-hidden">
      <label>
        Website
        <input
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid="wr-website"
        />
      </label>
    </div>
  );
}

function Description({ value, error, onChange }: { value: string; error?: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {t("wr.desc")}
      </label>
      <textarea
        id={id}
        rows={4}
        maxLength={500}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : undefined}
        className={`w-full rounded-md border bg-surface px-3 py-2 text-base text-fg shadow-sm placeholder:text-fg-muted focus-visible:border-ring sm:text-sm ${
          error ? "border-danger" : "border-border"
        }`}
        data-testid="wr-desc"
      />
      {error && (
        <p id={`${id}-e`} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Bildirim kutucukları: yalnız firmanın açtığı kanallar (varsayılan işaretsiz); hiçbiri açık değilse yok. */
export function NotifyChoices({
  enabled,
  notify,
  onChange,
}: {
  enabled: WebFormInfo["channels"];
  notify: NotifyChoice;
  onChange: (n: NotifyChoice) => void;
}) {
  const channels = CHANNELS.filter(([c]) => enabled[c]);
  if (channels.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-1" data-testid="wr-notify">
      <legend className="mb-1 text-sm font-medium text-fg">{t("wr.notify")}</legend>
      <p className="mb-1 text-xs text-fg-muted">{t("wr.notifyHint")}</p>
      {channels.map(([c, Icon]) => (
        <label key={c} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-fg">
          <input
            type="checkbox"
            checked={notify[c]}
            onChange={(e) => onChange({ ...notify, [c]: e.target.checked })}
            className="size-5 shrink-0 cursor-pointer accent-primary"
            data-testid={`wr-notify-${c}`}
          />
          <Icon aria-hidden className="size-4 text-fg-muted" />
          {t(`wr.notify.${c}` as MessageKey)}
        </label>
      ))}
    </fieldset>
  );
}

interface ConsentProps {
  checked: boolean;
  error?: string;
  /** Hata satırı kimliği `${hintId}-c`. */
  hintId: string;
  text: WebFormInfo["consentText"];
  onChange: (v: boolean) => void;
}

/** Onay kutusu + hata satırı + aydınlatma metni (sürümüyle, metin düğümü). */
export function ConsentFields({ checked, error, hintId, text, onChange }: ConsentProps) {
  return (
    <>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-fg">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${hintId}-c` : undefined}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary"
          data-testid="wr-consent"
        />
        <span>{t("wr.consent")}</span>
      </label>
      {error && (
        <p id={`${hintId}-c`} className="-mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      )}
      <details className="rounded-md border border-border bg-canvas px-3 py-2 text-sm" data-testid="wr-consent-text">
        <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">
          {t("gj.consentRead")} <span className="font-normal text-fg-muted">{t("gj.consentVersion", { v: text.version })}</span>
        </summary>
        <p className="pb-2 whitespace-pre-line text-fg-muted">{text.body}</p>
      </details>
    </>
  );
}

interface SubmitProps {
  busy: boolean;
  /** Token sonrası kalan bekleme (ms); > 0 iken düğmede geri sayım. */
  wait: number;
  disabled: boolean;
  describedBy?: string;
}

export function SubmitButton({ busy, wait, disabled, describedBy }: SubmitProps) {
  return (
    <Button type="submit" loading={busy} disabled={disabled} aria-describedby={describedBy} className="self-start" data-testid="wr-submit">
      {!busy && (wait > 0 ? <Clock aria-hidden className="size-4" /> : <Send aria-hidden className="size-4" />)}
      {wait > 0 ? t("wr.submitWait", { s: Math.ceil(wait / 1000) }) : t("wr.submit")}
    </Button>
  );
}
