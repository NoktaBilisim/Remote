"use client";

import { LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { SMTP_SEND_FAILED_MESSAGE, smtpTestInputSchema, type SmtpTestResponse } from "@/lib/account/contract";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

/**
 * Test maili diyaloğu (AC-80, 151): alıcı sorar → POST `path` `{ to }`. Sonuç diyalogda kalır: 200 ok → başarı,
 * 200 `ok:false` / 502 `UPSTREAM` / 400 `HOST_NOT_ALLOWED` → sunucunun genel hata metni, 429 → kilit tonu (5/dk).
 * B-P10-1: sunucu hata sınıfı (bağlantı/TLS/kimlik) döndürmez; tek genel mesaj olduğu gibi gösterilir, yoksa sözleşmedeki
 * `SMTP_SEND_FAILED_MESSAGE`.
 * Test sonuçlanana kadar (başarısız test ~12 sn sürebilir) diyalog kapatılamaz: Esc / X `onDismiss` ile yutulur, Kapat
 * pasif; bekleme metni `role="status"` ile duyurulur (P10 test raporu bulgu 1).
 */
export function MailTestDialog({
  open,
  onClose,
  path,
  title,
  body,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  path: string;
  title: string;
  body: string;
  testId: string;
}) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "danger" | "locked"; message: string } | null>(null);

  const close = () => {
    if (busy) return;
    setResult(null);
    setError(undefined);
    onClose();
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setResult(null);
    const parsed = smtpTestInputSchema.safeParse({ to });
    if (!parsed.success) {
      setError(to.trim() ? t("v.email") : t("v.required"));
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      const r = await api<SmtpTestResponse | { ok: boolean; message: string }>("POST", path, parsed.data);
      setResult(
        r.ok
          ? { tone: "success", message: r.message || t("smtp.testOk", { to: parsed.data.to }) }
          : { tone: "danger", message: r.message || SMTP_SEND_FAILED_MESSAGE },
      );
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.status === 400 && err.fields?.to) setError(err.fields.to);
      else {
        const ui = toUiError(err);
        setResult({
          tone: ui.tone,
          message: err instanceof ApiError && err.status === 502 ? err.message || SMTP_SEND_FAILED_MESSAGE : ui.message,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} onDismiss={close} size="sm" testId={testId} title={title} description={body}>
      <form noValidate onSubmit={send} className="flex flex-col gap-4">
        <TextField
          data-autofocus
          label={t("smtp.testTo")}
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          error={error}
          autoComplete="email"
          spellCheck={false}
          disabled={busy}
          data-testid="mail-test-to"
        />
        {busy && (
          <p role="status" className="flex items-start gap-2 text-sm text-fg-muted" data-testid="mail-test-waiting">
            <LoaderCircle aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" />
            {t("smtp.testWaiting")}
          </p>
        )}
        {result && (
          <Alert tone={result.tone} testId="mail-test-result">
            {result.message}
          </Alert>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>
            {t("d.close")}
          </Button>
          <Button type="submit" loading={busy} data-testid="mail-test-send">
            {!busy && <Send aria-hidden className="size-4" />}
            {t("smtp.testSend")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
