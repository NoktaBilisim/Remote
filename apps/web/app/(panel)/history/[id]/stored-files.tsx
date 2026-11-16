"use client";

import type { StoredFileItem, StoredFileLinkResponse } from "@remote/contracts/api/fsrv";
import { FILE_DIRECTION_LABELS, STORED_FILE_STATE_LABELS, describeFsrvStatus, labelOf } from "@remote/contracts/labels";
import { Download, Printer, Upload } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { formatBytes, formatDateTime } from "@/lib/format";
import { fetchBlob } from "@/lib/fsrv/download";
import { t } from "@/lib/i18n";
import { DataTable, type Col } from "./data-table";

/** Durum metni: yazdırma belgesi saklanmaz; ret/iptal "teslim edilmedi"; virüslü/taranamadı ayrıntılı (AC-358/359/360). */
function stateText(f: StoredFileItem): string {
  if (f.purpose === "PRINT") return t("sf.print");
  if (f.state === "INFECTED") return describeFsrvStatus("INFECTED", null, f.signature) ?? "";
  if (f.state === "SCAN_FAILED") return describeFsrvStatus("SCAN_FAILED", f.scanReason) ?? "";
  if (f.state === "CLEAN") return t(f.canDownload || f.expiresAt ? "sf.stored" : "sf.clean");
  return labelOf(STORED_FILE_STATE_LABELS, f.state);
}

/** Tarayıcıya kaydet: Blob → geçici adres → `a[download]` (adres hemen serbest). */
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * P28b (AC-360): oturumun sunucuda saklanan dosyaları. "İndir" yalnız `canDownload` (teslim edilmiş FILE + iki yetki): link ucu
 * (çerez + CSRF) → 5 dk belirteç → içerik `fetch` + `Authorization: Bearer` (URL'de belirteç yok) → Blob.
 */
export function StoredFiles({ sessionId, items }: { sessionId: string; items: StoredFileItem[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (f: StoredFileItem) => {
    if (busy) return;
    setBusy(f.id);
    setError(null);
    try {
      const link = await api<StoredFileLinkResponse>("POST", `/sessions/${sessionId}/stored-files/${f.id}/link`, {});
      const blob = await fetchBlob(f.id, link.token, f.sizeBytes);
      if (!blob) setError(t("sf.dlFailed"));
      else save(blob, f.name);
    } catch (e) {
      setError(toUiError(e).message);
    } finally {
      setBusy(null);
    }
  };

  const cols: Col<StoredFileItem>[] = [
    {
      head: t("sf.name"),
      cell: (f) => (
        <span className="inline-flex items-center gap-1.5" data-testid="sf-name">
          {f.purpose === "PRINT" && <Printer aria-hidden className="size-4 text-fg-muted" />}
          {f.name}
        </span>
      ),
      className: "min-w-48 wrap-break-word",
    },
    {
      head: t("h.file.dir"),
      className: "whitespace-nowrap",
      cell: (f) => (
        <span className="inline-flex items-center gap-1.5">
          {f.direction === "TO_CUSTOMER" ? (
            <Upload aria-hidden className="size-4 text-fg-muted" />
          ) : (
            <Download aria-hidden className="size-4 text-fg-muted" />
          )}
          {labelOf(FILE_DIRECTION_LABELS, f.direction)}
        </span>
      ),
    },
    {
      head: t("h.file.size"),
      cell: (f) => <span className="tabular-nums">{formatBytes(f.sizeBytes)}</span>,
      className: "whitespace-nowrap",
    },
    {
      head: t("sf.state"),
      cell: (f) => (
        <span
          className={f.state === "INFECTED" || f.state === "SCAN_FAILED" ? "text-danger" : f.canDownload ? "text-success" : "text-fg"}
          data-testid="sf-state"
        >
          {stateText(f)}
        </span>
      ),
    },
    {
      head: t("sf.until"),
      className: "whitespace-nowrap",
      cell: (f) => <span className="tabular-nums">{f.expiresAt ? formatDateTime(f.expiresAt) : "—"}</span>,
    },
    {
      head: t("sf.action"),
      className: "whitespace-nowrap",
      cell: (f) =>
        f.canDownload ? (
          <Button
            variant="secondary"
            loading={busy === f.id}
            disabled={busy !== null && busy !== f.id}
            aria-label={t("sf.downloadName", { name: f.name })}
            onClick={() => void download(f)}
            data-testid="sf-download"
          >
            {busy !== f.id && <Download aria-hidden className="size-4" />}
            {t("sf.download")}
          </Button>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert tone="danger" testId="sf-error">
          {error}
        </Alert>
      )}
      <DataTable label={t("sf.title")} testId="stored-files" rowTestId="sf-row" items={items} cols={cols} />
    </div>
  );
}
