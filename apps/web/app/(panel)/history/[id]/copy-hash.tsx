"use client";

import { Copy } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { t } from "@/lib/i18n";
import { copyText } from "@/lib/use-now";

/** SHA-256 kısaltılmış gösterim (ilk 8 … son 8) + tam değeri kopyalama; tam değer `title`'da (TEST-P8-1). */
export function CopyHash({ value, testId }: { value: string; testId?: string }) {
  const toast = useToast();
  const short = value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value;
  const copy = async () => {
    const ok = await copyText(value);
    toast(ok ? t("toast.copied") : t("toast.copyFailed"), ok ? "success" : "danger");
  };
  // -my-2.5: 44 px dokunma hedefi satır yüksekliğini büyütmesin, kod metniyle hizalı kalsın.
  return (
    <span className="-my-2.5 inline-flex items-center gap-1 whitespace-nowrap" data-testid={testId}>
      <code className="font-mono text-xs text-fg-muted" title={value}>
        {short}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={t("h.file.copySha")}
        title={t("h.file.copySha")}
        className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-transform duration-150 ease-out hover:bg-surface-muted hover:text-fg active:scale-[0.97]"
      >
        <Copy aria-hidden className="size-4" />
      </button>
    </span>
  );
}
