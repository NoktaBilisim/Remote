"use client";

import { CircleX, Download, Paperclip, ShieldAlert, Upload, UserCheck, UserX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { BIG_MEM_WARN_BYTES, canStreamToDisk, shouldWarnLargeWrite, type Transfer } from "@/lib/dc/files";
import type { Collab } from "@/lib/dc/use-collab";
import { formatBytes } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";

/** G-03/AC-116: "Kabul et" 1,5 sn sonra etkin; varsayılan odak "Reddet" (ret güvenli eylem → hep etkin, odaklanabilir). */
const ARM_MS = 1500;
const ACTIVE = new Set(["hashing", "offered", "sending", "receiving", "verifying"]);

function Row({ x, mb, onCancel }: { x: Transfer; mb: number; onCancel: () => void }) {
  const pct = x.size ? Math.floor((x.done / x.size) * 100) : 100;
  const tone =
    x.status === "ok"
      ? "text-success"
      : ["corrupt", "tooLarge"].includes(x.status)
        ? "text-danger"
        : x.status === "timeout"
          ? "text-warning"
          : "text-fg-muted";
  const Icon = x.dir === "out" ? Upload : Download;
  return (
    <li className="flex flex-col gap-1 rounded-md border border-border p-3" data-testid="file-row" data-status={x.status} data-dir={x.dir}>
      <div className="flex items-center gap-2">
        <Icon aria-hidden className="size-4 shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg" title={x.name}>
          {x.name}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-fg-muted">{formatBytes(x.size)}</span>
        {ACTIVE.has(x.status) && (
          <Button variant="ghost" aria-label={t("p5.files.cancel", { name: x.name })} onClick={onCancel} data-testid="file-cancel">
            <CircleX aria-hidden className="size-4" />
          </Button>
        )}
      </div>
      {(x.status === "sending" || x.status === "receiving") && (
        <progress className="h-2 w-full accent-primary" max={100} value={pct} aria-label={t("p5.files.progress", { name: x.name })} />
      )}
      <div className="flex items-center gap-2 text-xs">
        <span role="status" className={tone}>
          {t(`p5.files.st.${x.status}` as MessageKey, { pct })}
          {x.auto && ` — ${t(`p5.files.auto.${x.auto}` as MessageKey, { mb })}`}
        </span>
        {/* S-P5-T2-1: disk yolunda url yok; uyarı yine de gösterilir */}
        {x.dir === "in" && x.status === "ok" && x.dangerous && (
          <span className="inline-flex items-center gap-1 text-danger" data-testid="file-row-danger">
            <ShieldAlert aria-hidden className="size-4" />
            {t(x.double ? "p5.files.rowDouble" : "p5.files.rowDanger")}
          </span>
        )}
        {x.dir === "in" && x.status === "ok" && x.url && (
          <a
            href={x.url}
            download={x.name}
            className="ml-auto inline-flex min-h-11 items-center gap-1 font-medium text-primary hover:underline"
            data-testid="file-download"
          >
            <Download aria-hidden className="size-4" />
            {t("p5.files.download")}
          </a>
        )}
      </div>
    </li>
  );
}

/** Dosya transferi (AC-36, 53, 54, 117, 119). `allowed=false` → gönderim pasif + açıklama (G-09). */
export function FilesPanel({ collab, allowed, peerName }: { collab: Collab; allowed: boolean; peerName: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<"tooLarge" | "busy" | "denied" | "rate" | null>(null);
  const [armedFid, setArmedFid] = useState<string | null>(null);
  const pending = collab.transfers.find((x) => x.dir === "in" && x.status === "pending") ?? null;
  const armed = pending !== null && armedFid === pending.fid;

  useEffect(() => {
    if (!pending) return;
    const fid = pending.fid;
    const id = setTimeout(() => setArmedFid(fid), ARM_MS);
    return () => clearTimeout(id);
  }, [pending?.fid]); // eslint-disable-line react-hooks/exhaustive-deps -- yalnız yeni teklifte yeniden kur

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const r = await collab.sendFile(f);
    setMsg(r === "ok" ? null : r);
    if (input.current) input.current.value = "";
  };

  return (
    <div className="flex flex-col gap-3" data-testid="files-panel">
      {!allowed ? (
        <Alert tone="warning" testId="files-denied">
          {t("p5.files.noCap")}
        </Alert>
      ) : (
        <div className="flex flex-col gap-1">
          <input
            ref={input}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            data-testid="file-input"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <Button variant="secondary" disabled={!collab.ready} onClick={() => input.current?.click()} data-testid="file-send">
            <Upload aria-hidden className="size-4" />
            {t("p5.files.send")}
          </Button>
          <p className="text-xs text-fg-muted">{t("p5.files.limit", { mb: collab.maxMb })}</p>
        </div>
      )}
      {msg && (
        <Alert tone="danger" testId="file-error">
          {t(`p5.files.err.${msg}`, { mb: collab.maxMb })}
        </Alert>
      )}
      {collab.transfers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-fg-muted" data-testid="files-empty">
          <Paperclip aria-hidden className="size-6" />
          <p>{collab.ready ? t("p5.files.empty") : t("p5.connecting")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("p5.files.list")}>
          {[...collab.transfers].reverse().map((x) => (
            <Row key={`${x.dir}.${x.fid}`} x={x} mb={collab.maxMb} onCancel={() => collab.cancel(x.fid, x.dir)} />
          ))}
        </ul>
      )}
      <Dialog
        open={pending !== null}
        onClose={() => pending && collab.reject(pending.fid)}
        title={t("p5.files.offerTitle", { name: peerName })}
        role="alertdialog"
        size="sm"
        testId="file-offer"
        description={
          pending ? (
            <span className="break-all">
              <b>{pending.name}</b> · {formatBytes(pending.size)}
            </span>
          ) : null
        }
        footer={
          <>
            <Button
              variant="secondary"
              data-autofocus
              onClick={() => pending && collab.reject(pending.fid)}
              className="sm:ml-auto"
              data-testid="file-reject"
            >
              <UserX aria-hidden className="size-4" />
              {t("p5.files.reject")}
            </Button>
            <Button onClick={() => pending && collab.accept(pending.fid)} disabled={!armed} data-testid="file-accept">
              <UserCheck aria-hidden className="size-4" />
              {t("p5.files.accept")}
            </Button>
          </>
        }
      >
        {pending && shouldWarnLargeWrite(pending.size) && (
          // S-P5-T2-1 (P13a): tarayıcı kayıt penceresi seçilen dosyayı hemen oluşturur/boşaltır → uyarı diyalogdan ÖNCE
          <Alert tone="warning" testId="file-big">
            <span className="block">{t("p5.files.bigDisk")}</span>
            <span className="mt-1 block font-semibold" data-testid="file-big-overwrite">
              {t("p5.files.bigDiskWarn")}
            </span>
          </Alert>
        )}
        {pending && pending.size > BIG_MEM_WARN_BYTES && !canStreamToDisk() && (
          <Alert tone="warning" testId="file-big">
            {t("p5.files.bigMem")}
          </Alert>
        )}
        {pending?.dangerous && (
          <Alert tone="danger" testId="file-danger">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <ShieldAlert aria-hidden className="size-4" />
              {t("p5.files.dangerTitle")}
            </span>
            <span className="block">{t(pending.double ? "p5.files.double" : "p5.files.danger")}</span>
          </Alert>
        )}
      </Dialog>
    </div>
  );
}
