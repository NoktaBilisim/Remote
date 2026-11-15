"use client";

import { Mail, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { sessionEmailInputSchema, type SessionEmailResponse } from "@/lib/account/contract";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

/**
 * AC-10: "Linki e-postayla gönder" — POST /sessions/:id/email `{ to, link }`. Sonuç satır içinde: başarı (alıcıyla),
 * 429 (saatte 20; kilit tonu), 502 (SMTP yok/gönderilemedi — sunucunun genel mesajı), 404/410 (oturum artık bekliyor değil).
 */
export function SessionEmail({ sessionId, link, disabled }: { sessionId: string; link: string; disabled: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "danger" | "locked"; message: string } | null>(null);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setResult(null);
    const parsed = sessionEmailInputSchema.safeParse({ to, link });
    if (!parsed.success) {
      setError(to.trim() ? t("v.email") : t("v.required"));
      inputRef.current?.focus();
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await api<SessionEmailResponse>("POST", `/sessions/${sessionId}/email`, parsed.data);
      setResult({ tone: "success", message: t("d.mail.sent", { to: parsed.data.to }) });
      setTo("");
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.status === 400 && err.fields?.to) setError(err.fields.to);
      else {
        const ui = toUiError(err, { 404: t("d.mail.gone"), 410: t("d.mail.gone") });
        setResult({
          tone: ui.tone,
          message: err instanceof ApiError && err.status === 502 ? err.message || t("d.mail.failed") : ui.message,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button
        variant="secondary"
        className="self-start"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        data-testid="session-email-open"
      >
        <Mail aria-hidden className="size-4" />
        {t("d.mail.open")}
      </Button>
    );
  }
  return (
    <form noValidate onSubmit={send} className="flex flex-col gap-2" data-testid="session-email-form" aria-label={t("d.mail.open")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <TextField
          ref={inputRef}
          label={t("d.mail.to")}
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          error={error}
          hint={t("d.mail.hint")}
          autoComplete="off"
          spellCheck={false}
          disabled={busy || disabled}
          className="min-w-0 flex-1"
          data-testid="session-email-to"
        />
        <Button type="submit" loading={busy} disabled={disabled} className="shrink-0 sm:mt-7" data-testid="session-email-send">
          {!busy && <Send aria-hidden className="size-4" />}
          {t("d.mail.send")}
        </Button>
      </div>
      {result && (
        <Alert tone={result.tone} testId="session-email-result">
          {result.message}
        </Alert>
      )}
    </form>
  );
}
