"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { API_BASE, EXPIRED_LOGIN_PATH } from "@/lib/api";
import { retryMinutes } from "@/lib/format";
import { exportApiPath, type HistoryFilters } from "@/lib/history/query";
import { t } from "@/lib/i18n";

/** Content-Disposition'dan dosya adı; yoksa sabit ad. Yol/ayraç karakterleri atılır. */
export function fileNameFrom(header: string | null): string {
  const m = header ? /filename="?([^";]+)"?/i.exec(header) : null;
  const name = m?.[1]?.replace(/[\\/:*?"<>|]/g, "").trim();
  return name || "oturumlar.csv";
}

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; fields?: Record<string, string> } } | null;
  if (res.status === 429) return t("h.exportRate", { minutes: retryMinutes(Number(res.headers.get("Retry-After")) || undefined) });
  const field = body?.error?.fields ? Object.values(body.error.fields)[0] : undefined;
  return field || body?.error?.message || t("err.generic");
}

/**
 * "Dışa aktar (CSV)" (AC-63, 124): yalnız session_history.export yetkisinde render edilir (sunucu da denetler).
 * fetch + blob: 400 (> 50.000 satır), 429 ve ağ hatası sayfada okunur hata olarak gösterilir (indirme yerine JSON dosyası değil).
 */
export function ExportButton({ filters }: { filters: Partial<HistoryFilters> }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(API_BASE + exportApiPath(filters), { credentials: "same-origin", cache: "no-store", headers: { Accept: "text/csv" } });
      if (res.status === 401) return router.replace(EXPIRED_LOGIN_PATH);
      if (!res.ok) return setError(await errorText(res));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileNameFrom(res.headers.get("Content-Disposition"));
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast(t("h.exported"));
    } catch {
      setError(t("err.network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <Button variant="secondary" onClick={run} loading={busy} data-testid="export-csv" aria-describedby="export-hint">
        {!busy && <Download aria-hidden className="size-4" />}
        {busy ? t("h.exporting") : t("h.export")}
      </Button>
      <p id="export-hint" className="text-xs text-fg-muted sm:text-right">
        {t("h.exportHint")}
      </p>
      {error && (
        <Alert tone="danger" testId="export-error">
          <p className="font-medium">{t("h.exportFailed")}</p>
          <p className="mt-1">{error}</p>
        </Alert>
      )}
    </div>
  );
}
