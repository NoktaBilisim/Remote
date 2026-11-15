"use client";

import { Clock, Mail, MessageCircle, MessageSquareText, MoonStar, Send, type LucideIcon } from "lucide-react";
import type { CreateRequestResponse, NotifyChoice, WebFormInfo } from "@remote/contracts/api/requests";
import { useEffect, useId, useRef, useState } from "react";
import { FormError } from "@/components/form-error";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { buildWebRequest, emptyDraft, newClientInstanceId, remainingDelay, submitFailure, type FormDraft } from "@/lib/web-request/flow";
import { ChatRetentionNotice } from "./chat-retention-notice";

/** Formda alanı olmayan hata (ref, token, aydınlatma metni kimliği…) genel mesaja yansır; aksi kullanıcı takılır. */
const SHOWN = new Set(["customerName", "phone", "email", "description", "consent"]);
const fieldlessError = (errs: Record<string, string>): string | undefined => Object.entries(errs).find(([k]) => !SHOWN.has(k))?.[1];

const CHANNELS: [keyof NotifyChoice, LucideIcon][] = [
  ["sms", MessageSquareText],
  ["whatsapp", MessageCircle],
  ["email", Mail],
];

/**
 * Web talep formu (AC-259): ad, telefon, e-posta (ops.), açıklama, aydınlatma metni + onay, bildirim kutucukları (yalnız
 * firmanın açtığı kanallar, varsayılan işaretsiz), gizli `website` alanı, düğmenin hemen üstünde AC-292 satırı.
 * Gönderim token alındıktan 2 sn önce yapılmaz (düğmede geri sayım); 4xx/429/503 sonrası yeni token alınır.
 */
export function WebRequestForm({
  tenantRef,
  info,
  issuedAt,
  refreshInfo,
  onCreated,
  onNotFound,
}: {
  tenantRef: string;
  info: WebFormInfo;
  issuedAt: number;
  refreshInfo: () => Promise<WebFormInfo | null>;
  onCreated: (r: CreateRequestResponse, customerName: string) => void;
  onNotFound: () => void;
}) {
  const [d, setD] = useState<FormDraft>(emptyDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(() => remainingDelay(issuedAt, Date.now(), info.minDelayMs));
  const instance = useRef<string>("");
  const hintId = useId();
  const set = (p: Partial<FormDraft>) => setD((x) => ({ ...x, ...p }));

  // 2 sn sayacı her yeni token'la (issuedAt) yeniden kurulur
  useEffect(() => {
    const tick = () => setWait(remainingDelay(issuedAt, Date.now(), info.minDelayMs));
    tick();
    const h = setInterval(tick, 250);
    return () => clearInterval(h);
  }, [issuedAt, info.minDelayMs]);

  const closed = !info.businessHours.openNow && info.businessHours.afterHoursMode === "REJECT";
  const channels = CHANNELS.filter(([c]) => info.channels[c]);
  const retentionShown = Number.isInteger(info.chatRetentionDays) && info.chatRetentionDays > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !retentionShown) return;
    instance.current ||= newClientInstanceId();
    const { body, errors: errs } = buildWebRequest(d, {
      ref: tenantRef,
      formToken: info.formToken,
      clientInstanceId: instance.current,
      info,
    });
    setErrors(errs);
    setFormErr(null);
    if (!body) return setFormErr({ message: fieldlessError(errs) ?? t("wr.fixErrors"), tone: "danger" });
    if (remainingDelay(issuedAt, Date.now(), info.minDelayMs) > 0) return setFormErr({ message: t("wr.fast"), tone: "danger" });
    setBusy(true);
    try {
      const r = await api<CreateRequestResponse>("POST", "/public/web-requests", body);
      onCreated(r, body.customerName);
    } catch (err) {
      const { failure, refreshToken } = submitFailure(err, t("err.network"));
      if (failure.kind === "notFound") return onNotFound();
      if (failure.kind === "fields") {
        setErrors(failure.fields);
        setFormErr({ message: fieldlessError(failure.fields) ?? t("wr.fixErrors"), tone: "danger" });
      } else
        setFormErr({
          message: failure.kind === "busy" ? t("wr.busy") : failure.kind === "fast" ? t("wr.fast") : failure.message,
          tone: "danger",
        });
      if (refreshToken) await refreshInfo();
    } finally {
      setBusy(false);
    }
  };

  const ready = !busy && retentionShown && wait === 0;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="wr-form" data-wait={wait > 0 || undefined}>
      <section aria-labelledby="wr-h" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
        <div>
          <h1 id="wr-h" className="text-xl font-semibold text-fg">
            {t("wr.heading", { name: info.tenant.name })}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">{t("wr.intro")}</p>
        </div>
        {!info.businessHours.openNow && (
          <p
            className="flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm text-fg"
            data-testid="wr-after-hours"
            role="status"
          >
            <MoonStar aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
            <span>
              {closed ? t("wr.closed") : t("wr.afterHours")}
              {info.businessHours.nextOpeningAt && ` ${t("wr.nextOpen", { at: formatDateTime(info.businessHours.nextOpeningAt) })}`}
            </span>
          </p>
        )}
        {formErr && <FormError error={formErr} />}
        <fieldset disabled={busy || closed} className="flex flex-col gap-4">
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
          {/* Gizli alan (bot kapısı): ekran dışı, sekmeyle ulaşılmaz, ekran okuyucudan gizli */}
          <div aria-hidden className="absolute top-0 -left-full size-px overflow-hidden">
            <label>
              Website
              <input
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={d.website}
                onChange={(e) => set({ website: e.target.value })}
                data-testid="wr-website"
              />
            </label>
          </div>
          {channels.length > 0 && (
            <fieldset className="flex flex-col gap-1" data-testid="wr-notify">
              <legend className="mb-1 text-sm font-medium text-fg">{t("wr.notify")}</legend>
              <p className="mb-1 text-xs text-fg-muted">{t("wr.notifyHint")}</p>
              {channels.map(([c, Icon]) => (
                <label key={c} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-fg">
                  <input
                    type="checkbox"
                    checked={d.notify[c]}
                    onChange={(e) => set({ notify: { ...d.notify, [c]: e.target.checked } })}
                    className="size-5 shrink-0 cursor-pointer accent-primary"
                    data-testid={`wr-notify-${c}`}
                  />
                  <Icon aria-hidden className="size-4 text-fg-muted" />
                  {t(`wr.notify.${c}` as MessageKey)}
                </label>
              ))}
            </fieldset>
          )}
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-fg">
            <input
              type="checkbox"
              checked={d.consent}
              onChange={(e) => set({ consent: e.target.checked })}
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby={errors.consent ? `${hintId}-c` : undefined}
              className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary"
              data-testid="wr-consent"
            />
            <span>{t("wr.consent")}</span>
          </label>
          {errors.consent && (
            <p id={`${hintId}-c`} className="-mt-2 text-xs font-medium text-danger">
              {errors.consent}
            </p>
          )}
          <details className="rounded-md border border-border bg-canvas px-3 py-2 text-sm" data-testid="wr-consent-text">
            <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">
              {t("gj.consentRead")}{" "}
              <span className="font-normal text-fg-muted">{t("gj.consentVersion", { v: info.consentText.version })}</span>
            </summary>
            <p className="pb-2 whitespace-pre-line text-fg-muted">{info.consentText.body}</p>
          </details>
        </fieldset>
        {retentionShown && <ChatRetentionNotice days={info.chatRetentionDays} id={hintId} />}
        <Button
          type="submit"
          loading={busy}
          disabled={!ready || closed}
          aria-describedby={retentionShown ? hintId : undefined}
          className="self-start"
          data-testid="wr-submit"
        >
          {!busy && (wait > 0 ? <Clock aria-hidden className="size-4" /> : <Send aria-hidden className="size-4" />)}
          {wait > 0 ? t("wr.submitWait", { s: Math.ceil(wait / 1000) }) : t("wr.submit")}
        </Button>
      </section>
    </form>
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
