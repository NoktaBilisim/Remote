"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { copyText } from "@/lib/use-now";

/**
 * Bağlantı kopyalama (AC-169): pano API'si → 2 sn "Kopyalandı" (`Check`, `role=status`). API yoksa veya izin
 * reddedilirse bağlantı salt okunur alanda **seçili** gösterilir (kullanıcı Ctrl+C ile alır).
 * `srLabel`: ekran okuyucu için kimin bağlantısı olduğu ("Bağlantıyı kopyala: Acme").
 * `manualLabel` (P28g): yedek alanın etiketi — bağlantı dışı metin (ör. Linux başlatma komutu) için.
 */
export function CopyLink({
  url,
  srLabel,
  testId = "copy-link",
  className = "",
  manualLabel,
}: {
  url: string;
  srLabel: string;
  testId?: string;
  className?: string;
  manualLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (state === "manual") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [state]);

  const copy = async () => {
    const ok = await copyText(url);
    if (!ok) return setState("manual");
    setState("copied");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`} data-testid={testId} data-state={state}>
      <Button type="button" variant="secondary" onClick={() => void copy()} aria-label={srLabel} className="self-start">
        {state === "copied" ? <Check aria-hidden className="size-4 text-success" /> : <Copy aria-hidden className="size-4" />}
        {t("cu.copy")}
      </Button>
      <span role="status" className={state === "copied" ? "text-xs font-medium text-success" : "sr-only"}>
        {state === "copied" ? t("cu.copied") : ""}
      </span>
      {state === "manual" && (
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={id} className="text-xs text-fg-muted">
            {manualLabel ?? t("cu.copyManual")}
          </label>
          <input
            ref={inputRef}
            id={id}
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            data-testid="copy-link-manual"
            className="min-h-11 w-full min-w-0 rounded-md border border-border bg-surface-muted px-3 font-mono text-xs text-fg"
          />
        </div>
      )}
    </div>
  );
}
