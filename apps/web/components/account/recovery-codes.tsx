"use client";

import { Check, Copy, Download } from "lucide-react";
import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDateTime, istanbulDay } from "@/lib/format";
import { t } from "@/lib/i18n";
import { recoveryFileName, recoveryFileText } from "@/lib/account/recovery";
import { copyText } from "@/lib/use-now";

/**
 * AC-67: 10 kurtarma kodu — yalnız bir kez gösterilir. Kopyala / .txt indir; "Kaydettim" işaretlenmeden devam edilemez
 * (yanlışlıkla kapatmaya karşı). Kodlar listede mono, `aria-label` ile tek tek okunur; sayfa yenilenirse bir daha gelmez.
 */
export function RecoveryCodes({
  codes,
  account,
  onDone,
  doneLabel,
  testId = "recovery-codes",
}: {
  codes: string[];
  account: string;
  onDone: () => void;
  doneLabel: string;
  testId?: string;
}) {
  const id = useId();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  const copy = async () => {
    const ok = await copyText(codes.join("\n"));
    setCopied(ok ? "ok" : "fail");
  };
  const download = () => {
    const text = recoveryFileText(codes, {
      title: t("mfa.rc.fileTitle"),
      account,
      note: t("mfa.rc.fileNote"),
      createdAt: formatDateTime(Date.now()),
    });
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = recoveryFileName(istanbulDay());
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      <Alert tone="warning">{t("mfa.rc.once")}</Alert>
      <ol className="grid grid-cols-2 gap-2 rounded-md border border-border bg-canvas p-3" aria-label={t("mfa.rc.listLabel")}>
        {codes.map((c) => (
          <li key={c} className="text-center font-mono text-sm tracking-wide text-fg tabular-nums" data-testid="recovery-code">
            {c}
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="secondary" onClick={() => void copy()} className="flex-1" data-testid="rc-copy">
          {copied === "ok" ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
          {t("mfa.rc.copy")}
        </Button>
        <Button type="button" variant="secondary" onClick={download} className="flex-1" data-testid="rc-download">
          <Download aria-hidden className="size-4" />
          {t("mfa.rc.download")}
        </Button>
      </div>
      <p role="status" className={`text-xs ${copied === "fail" ? "text-danger" : "text-success"}`}>
        {copied === "ok" ? t("mfa.rc.copied") : copied === "fail" ? t("mfa.rc.copyFailed") : ""}
      </p>
      <label htmlFor={`${id}-saved`} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-fg">
        <input
          id={`${id}-saved`}
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="size-5 shrink-0 accent-primary"
          data-testid="rc-saved"
        />
        {t("mfa.rc.saved")}
      </label>
      <Button type="button" onClick={onDone} disabled={!saved} className="w-full" data-testid="rc-done">
        {doneLabel}
      </Button>
    </div>
  );
}
