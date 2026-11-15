"use client";

import { Check, Copy, KeyRound, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";
import { copyText } from "@/lib/use-now";

/**
 * Geçici şifre adımı (P9 yeni kullanıcı; P15 AC-232 Super Admin şifre sıfırlama): salt okunur mono alan + Kopyala; pano
 * yoksa alan seçilir. Kopyalamadan kapatmaya çalışınca uyarı ("Şifreye dön" güvenli seçim). Kapatınca bir daha gösterilmez.
 * `secondary`: isteğe bağlı ikinci düğme (ör. "Yetkileri düzenle") → `onDone(true)`.
 */
export function TemporaryPasswordDialog({
  password,
  title,
  description,
  secondary,
  testId,
  onDone,
}: {
  password: string;
  title: string;
  description: string;
  secondary?: { label: string; Icon: LucideIcon; testId: string };
  testId: string;
  onDone: (secondary: boolean) => void;
}) {
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");
  const [warn, setWarn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  // Uyarı açılınca odak güvenli seçime ("Şifreye dön"): Enter yanlışlıkla kapatmasın
  useEffect(() => {
    if (warn) backRef.current?.focus();
  }, [warn]);

  const doCopy = async () => {
    if (await copyText(password)) {
      setCopy("copied");
      setWarn(false);
    } else {
      setCopy("manual");
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };
  const tryClose = (edit: boolean) => {
    if (copy === "idle" && !warn) return setWarn(true);
    onDone(edit);
  };

  return (
    <Dialog
      open
      onClose={() => onDone(false)}
      // Esc/X: uyarı açıkken güvenli seçim (şifreye dön), değilse kopyalanmadıysa uyarı
      onDismiss={() => (warn ? setWarn(false) : tryClose(false))}
      testId={testId}
      title={title}
      description={description}
      footer={
        warn ? (
          <>
            <Button ref={backRef} variant="secondary" onClick={() => setWarn(false)} className="sm:ml-auto">
              {t("us.pw.back")}
            </Button>
            <Button variant="danger-ghost" onClick={() => onDone(false)} data-testid="pw-close-anyway">
              {t("us.pw.closeAnyway")}
            </Button>
          </>
        ) : (
          <>
            {secondary && (
              <Button variant="secondary" onClick={() => tryClose(true)} className="sm:ml-auto" data-testid={secondary.testId}>
                <secondary.Icon aria-hidden className="size-4" />
                {secondary.label}
              </Button>
            )}
            <Button onClick={() => tryClose(false)} className={secondary ? undefined : "sm:ml-auto"} data-testid="pw-done">
              <Check aria-hidden className="size-4" />
              {t("us.pw.done")}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <Alert tone="warning">{t("us.pw.once")}</Alert>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium text-fg">
            <KeyRound aria-hidden className="size-4 text-fg-muted" />
            {t("us.pw.label")}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={inputRef}
              id={id}
              readOnly
              value={password}
              autoComplete="off"
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
              data-testid="temp-password"
              className="min-h-11 w-full min-w-0 rounded-md border border-border bg-surface-muted px-3 font-mono text-base tracking-wide text-fg sm:text-sm"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => void doCopy()}
              data-autofocus
              data-testid="pw-copy"
              className="shrink-0"
            >
              {copy === "copied" ? <Check aria-hidden className="size-4 text-success" /> : <Copy aria-hidden className="size-4" />}
              {t("us.pw.copy")}
            </Button>
          </div>
          <p
            role="status"
            className={copy === "idle" ? "sr-only" : `text-xs font-medium ${copy === "copied" ? "text-success" : "text-fg-muted"}`}
          >
            {copy === "copied" ? t("us.pw.copied") : copy === "manual" ? t("us.pw.manual") : ""}
          </p>
        </div>
        {warn && (
          <Alert tone="danger" testId="pw-not-copied">
            {t("us.pw.notCopied")}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
