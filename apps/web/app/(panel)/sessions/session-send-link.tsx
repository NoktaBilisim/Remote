"use client";

import { MessageSquare, MessageSquareText, Send, Smartphone } from "lucide-react";
import type { SendLinkChannel, SendLinkOptions, SendLinkResponse } from "@remote/contracts/api/notify";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import { availableChannels, checkLinkPhone, sendLinkFailure } from "@/lib/notify/send-link";

type Load = { kind: "idle" } | { kind: "loading" } | { kind: "ok"; options: SendLinkOptions } | { kind: "error"; message: string };

/**
 * AC-260: "SMS / WhatsApp ile gönder" — GET …/send-link/options (yalnız kullanılabilir kanallar, talepten doğan oturumda
 * önerilen telefon) → kanal + telefon (E.164 önizleme) → POST …/send-link. Sonuç toast + satır içi; 429'da geri sayım.
 */
export function SessionSendLink({ sessionId, link, disabled }: { sessionId: string; link: string; disabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [load, setLoad] = useState<Load>({ kind: "idle" });
  const [channel, setChannel] = useState<SendLinkChannel>("SMS");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "danger" | "warning"; message: string } | null>(null);
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until === null) return;
    const h = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= until) setUntil(null);
    }, 1000);
    return () => clearInterval(h);
  }, [until]);

  const open = async () => {
    setLoad({ kind: "loading" });
    try {
      const options = await api<SendLinkOptions>("GET", `/sessions/${sessionId}/send-link/options`);
      const chs = availableChannels(options);
      if (chs[0]) setChannel(chs[0]);
      setPhone(options.suggestedPhone ?? "");
      setLoad({ kind: "ok", options });
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setLoad({ kind: "error", message: toUiError(e).message });
    }
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || until !== null) return;
    setResult(null);
    const chk = checkLinkPhone(phone, channel);
    if (!chk.e164) {
      setPhoneError(chk.error);
      inputRef.current?.focus();
      return;
    }
    setPhoneError(undefined);
    setBusy(true);
    try {
      await api<SendLinkResponse>("POST", `/sessions/${sessionId}/send-link`, { channel, phone: chk.e164, link });
      const message = t(channel === "SMS" ? "sl.sentSms" : "sl.sentWa", { phone: chk.e164 });
      setResult({ tone: "success", message });
      toast(message);
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      const f = sendLinkFailure(err, channel, t("err.generic"));
      if (f.kind === "phone") setPhoneError(f.message);
      else if (f.kind === "rate") {
        const at = Date.now() + f.retryAfterSec * 1000;
        setNow(Date.now());
        setUntil(at);
        setResult({ tone: "warning", message: t("sl.rate") });
      } else setResult({ tone: f.tone, message: f.message });
    } finally {
      setBusy(false);
    }
  };

  if (load.kind === "idle")
    return (
      <Button variant="secondary" className="self-start" disabled={disabled} onClick={() => void open()} data-testid="send-link-open">
        <Smartphone aria-hidden className="size-4" />
        {t("sl.open")}
      </Button>
    );
  if (load.kind === "loading")
    return (
      <div className="flex flex-col gap-2" data-testid="send-link-loading" aria-busy>
        <span className="sr-only">{t("sl.loading")}</span>
        <Skeleton className="h-11 w-48" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  if (load.kind === "error")
    return (
      <Alert tone="danger" testId="send-link-load-error">
        <span className="flex flex-col gap-2">
          {load.message}
          <Button variant="secondary" className="self-start" onClick={() => void open()}>
            {t("wr.retry")}
          </Button>
        </span>
      </Alert>
    );

  const chs = availableChannels(load.options);
  if (chs.length === 0)
    return (
      <Alert tone="info" testId="send-link-none">
        {t("sl.none")}
      </Alert>
    );
  const preview = checkLinkPhone(phone, channel).e164;
  const waitLeft = until === null ? 0 : until - now;
  return (
    <form noValidate onSubmit={send} className="flex flex-col gap-2" data-testid="send-link-form" aria-label={t("sl.open")}>
      {chs.length > 1 ? (
        <Segmented
          label={t("sl.channel")}
          value={channel}
          onChange={(v) => {
            setChannel(v);
            setPhoneError(undefined);
          }}
          disabled={busy}
          options={chs.map((c) => ({
            value: c,
            label: c === "SMS" ? "SMS" : "WhatsApp",
            icon: c === "SMS" ? <MessageSquareText aria-hidden className="size-4" /> : <MessageSquare aria-hidden className="size-4" />,
          }))}
        />
      ) : (
        <p className="text-sm text-fg-muted" data-testid="send-link-single">
          {t("sl.via", { channel: channel === "SMS" ? "SMS" : "WhatsApp" })}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <TextField
          ref={inputRef}
          label={t("sl.phone")}
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setPhoneError(undefined);
          }}
          error={phoneError}
          hint={preview ? t("sl.preview", { e164: preview }) : t("sl.hint")}
          autoComplete="off"
          disabled={busy || disabled}
          className="min-w-0 flex-1"
          data-testid="send-link-phone"
        />
        <Button
          type="submit"
          loading={busy}
          disabled={disabled || until !== null}
          className="shrink-0 sm:mt-7"
          data-testid="send-link-send"
        >
          {!busy && <Send aria-hidden className="size-4" />}
          {until !== null ? t("sl.wait", { t: formatRemaining(waitLeft) }) : t("sl.send")}
        </Button>
      </div>
      {result && (
        <Alert tone={result.tone} testId="send-link-result">
          {result.message}
        </Alert>
      )}
    </form>
  );
}
