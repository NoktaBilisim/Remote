"use client";

import type { CreateSessionResponse } from "@remote/contracts/api/sessions";
import { Building2, Copy, Timer } from "lucide-react";
import { useId } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CodeDisplay } from "@/components/ui/code-display";
import { useToast } from "@/components/ui/toast";
import { formatRemaining, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { copyText, useNow } from "@/lib/use-now";
import { SendToCustomerDialog } from "@/components/send-to-customer/send-to-customer-dialog";

/** Oluşturulan oturumun link + kod + doğrulama kodu + geçerlilik geri sayımı (AC-1, 3, 9). */
export function CreatedSession({ data, cancelled }: { data: CreateSessionResponse; cancelled: boolean }) {
  const id = useId();
  const toast = useToast();
  const now = useNow();
  const left = now === null ? null : Date.parse(data.expiresAt) - now;
  const expired = left !== null && left <= 0;
  const invalid = cancelled || expired;

  const copy = async (text: string) => {
    const ok = await copyText(text);
    toast(ok ? t("toast.copied") : t("toast.copyFailed"), ok ? "success" : "danger");
  };

  return (
    <div className="flex flex-col gap-4">
      {cancelled && (
        <Alert tone="danger" testId="dialog-cancelled">
          {t("d.cancelled")}
        </Alert>
      )}
      {!cancelled && expired && (
        <Alert tone="warning" testId="dialog-expired">
          {t("d.expired")}
        </Alert>
      )}
      {data.customerFirm && (
        <p className="flex items-center gap-2 text-sm text-fg" data-testid="session-customer-firm">
          <Building2 aria-hidden className="size-4 text-fg-muted" />
          <span className="text-fg-muted">{t("d.customerFirm")}</span>
          <span className="font-medium wrap-anywhere">{data.customerFirm.name}</span>
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-link`} className="text-sm font-medium text-fg">
          {t("d.link")}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={`${id}-link`}
            readOnly
            value={data.link}
            data-testid="session-link"
            aria-describedby={`${id}-note`}
            onFocus={(e) => e.currentTarget.select()}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface-muted px-3 font-mono text-sm text-fg"
          />
          <Button variant="secondary" onClick={() => copy(data.link)} disabled={invalid} aria-label={t("d.copyLink")}>
            <Copy aria-hidden className="size-4" />
            {t("d.copy")}
          </Button>
        </div>
        <p id={`${id}-note`} className="text-xs text-fg-muted">
          {t("d.linkNote")}
        </p>
        {/* LG-3 (AC-405): tek "Müşteriye gönder"; kanallar (e-posta `sessions.create`, SMS/WA `send_link`) sunucudan */}
        <SendToCustomerDialog target={{ kind: "SESSION", sessionId: data.id, link: data.link }} disabled={invalid} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-labelledby={`${id}-code`} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-4">
          <h3 id={`${id}-code`} className="text-sm font-medium text-fg">
            {t("d.code")}
          </h3>
          <CodeDisplay code={data.code} testId="session-code" />
          {/* TO-P2-2: link "Kopyala" ile aynı varyant (secondary) */}
          <Button
            variant="secondary"
            onClick={() => copy(data.code)}
            disabled={invalid}
            aria-label={t("d.copyCode")}
            className="self-start"
          >
            <Copy aria-hidden className="size-4" />
            {t("d.copy")}
          </Button>
          <p className="text-xs text-fg-muted">{t("d.codeHint")}</p>
        </section>
        <section aria-labelledby={`${id}-verify`} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-4">
          <h3 id={`${id}-verify`} className="text-sm font-medium text-fg">
            {t("d.verify")}
          </h3>
          <CodeDisplay code={data.techVerifyCode} testId="verify-code" />
          <p className="text-xs text-fg-muted">{t("d.verifyHint")}</p>
        </section>
      </div>

      {!invalid && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-fg-muted" data-testid="validity">
          <Timer aria-hidden className="size-4" />
          {t("d.validity")}
          <span className="font-semibold tabular-nums text-fg">
            {t("d.validityLeft", {
              time: left === null ? "—" : formatRemaining(left),
              end: formatTime(data.expiresAt),
            })}
          </span>
        </p>
      )}
    </div>
  );
}
