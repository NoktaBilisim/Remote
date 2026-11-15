"use client";

import { CircleX, ClipboardCopy, ClipboardPaste, FileText, Printer } from "lucide-react";
import { useId, useRef } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { FeatureReason, FeatureState } from "@/lib/clip/feature-state";
import type { ClipPrint } from "@/lib/clip/use-clip-print";
import { formatBytes } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { consentLeftSec, type PrintView } from "@/lib/print/print-send";

/*
 * P28a "Pano ve yazdırma" bölümü (mimari-p28 §6; AC-343..352, 404). Düğmeler animasyonsuz (sık işlem). Yetki yoksa düğme
 * gizli; pasif düğmenin nedeni altında görünür ve `aria-describedby` ile bağlıdır. 5 durum: iskelet (bağlantı kuruluyor),
 * boş (müşteri yok → neden), hata (sonuç metni / alan hatası), kısmi (yalnız biri uygun), başarılı.
 */

const reasonKey = (r: FeatureReason) => `cp.r.${r}` as MessageKey;
/** Neden metni çizilecek mi? "busy" (iş sürüyor) için metin yok; aria-describedby yalnız çizilen öğeye bağlanır. */
const hasReason = (s: FeatureState): s is FeatureState & { reason: FeatureReason } => !!s.reason && s.reason !== "busy";

function Reason({ s, id, cooldownSec, testId }: { s: FeatureState; id: string; cooldownSec: number; testId: string }) {
  if (!hasReason(s)) return null;
  return (
    <p id={id} className="text-xs text-fg-muted" data-testid={testId}>
      {t(reasonKey(s.reason), { sec: cooldownSec })}
    </p>
  );
}

const DONE_TONE: Record<string, string> = {
  PRINTED: "text-success",
  CANCELLED: "text-warning",
  VIEW: "text-warning",
  REJECTED: "text-warning",
  TIMEOUT: "text-warning",
};

function printStatus(j: PrintView, now: number | null): { text: string; tone: string } {
  if (j.phase === "hashing") return { text: t("cp.print.st.hashing"), tone: "text-fg-muted" };
  if (j.phase === "requested") return { text: t("cp.print.st.requested"), tone: "text-fg-muted" };
  if (j.phase === "sending")
    return { text: t("cp.print.st.sending", { pct: j.size ? Math.floor((j.sent / j.size) * 100) : 100 }), tone: "text-fg-muted" };
  if (j.phase === "waiting") return { text: t("cp.print.st.waiting", { sec: consentLeftSec(j, now) ?? 60 }), tone: "text-fg-muted" };
  const o = j.outcome ?? "ERROR";
  const text =
    o === "SERVER"
      ? (j.message ?? t("cp.print.res.ERROR"))
      : o === "PRINTED" && j.pages !== undefined
        ? t("cp.print.res.PRINTED", { pages: j.pages })
        : t(`cp.print.res.${o === "PRINTED" ? "PRINTED_NOPAGES" : o}` as MessageKey);
  return { text, tone: DONE_TONE[o] ?? "text-danger" };
}

function PrintRow({ j, now, onCancel }: { j: PrintView; now: number | null; onCancel: () => void }) {
  const st = printStatus(j, now);
  const active = j.phase !== "done";
  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-border p-3"
      data-testid="print-row"
      data-phase={j.phase}
      data-outcome={j.outcome ?? ""}
    >
      <div className="flex items-center gap-2">
        <FileText aria-hidden className="size-4 shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg" title={j.name}>
          {j.name}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-fg-muted">{formatBytes(j.size)}</span>
      </div>
      {j.phase === "sending" && (
        <progress
          className="h-2 w-full accent-primary"
          max={100}
          value={j.size ? Math.floor((j.sent / j.size) * 100) : 100}
          aria-label={t("cp.print.progress", { name: j.name })}
        />
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span role="status" className={st.tone} data-testid="print-status">
          {st.text}
        </span>
        {active && (
          <Button variant="ghost" className="ml-auto" onClick={onCancel} data-testid="print-cancel">
            <CircleX aria-hidden className="size-4" />
            {t("cp.print.cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function ClipPrintPanel({ cp, now }: { cp: ClipPrint; now: number | null }) {
  const headId = useId();
  const clipReason = useId();
  const printReason = useId();
  const input = useRef<HTMLInputElement>(null);
  const { clipState: c, printState: p, clipView, print } = cp;
  if (!c.visible && !p.visible) return null;
  const loading = c.reason === "loading" || p.reason === "loading";
  const pick = (f: File | undefined) => {
    if (f) cp.startPrint(f);
    if (input.current) input.current.value = "";
  };

  return (
    <section
      aria-labelledby={headId}
      className="flex flex-col gap-3 border-t border-border pt-3"
      data-testid="clip-print"
      aria-busy={loading || undefined}
    >
      <h2 id={headId} className="text-sm font-semibold text-fg">
        {t("cp.title")}
      </h2>
      {loading ? (
        <div className="flex flex-col gap-2" data-testid="clip-print-loading">
          <span className="sr-only">{t("cp.loading")}</span>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : (
        <>
          {c.visible && (
            <div className="flex flex-col gap-2" data-testid="clip-block">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="grow"
                  disabled={!c.enabled}
                  loading={clipView?.dir === "TO_CUSTOMER"}
                  aria-describedby={hasReason(c) ? clipReason : undefined}
                  onClick={cp.push}
                  data-testid="clip-push"
                >
                  {clipView?.dir !== "TO_CUSTOMER" && <ClipboardPaste aria-hidden className="size-4" />}
                  {t("cp.clip.push")}
                </Button>
                <Button
                  variant="secondary"
                  className="grow"
                  disabled={!c.enabled}
                  loading={clipView?.dir === "TO_TECH"}
                  aria-describedby={hasReason(c) ? clipReason : undefined}
                  onClick={cp.pull}
                  data-testid="clip-pull"
                >
                  {clipView?.dir !== "TO_TECH" && <ClipboardCopy aria-hidden className="size-4" />}
                  {t("cp.clip.pull")}
                </Button>
              </div>
              <Reason s={c} id={clipReason} cooldownSec={0} testId="clip-reason" />
              {clipView && (
                <p role="status" className="text-xs text-fg-muted" data-testid="clip-progress">
                  {t(clipView.dir === "TO_CUSTOMER" ? "cp.clip.sending" : "cp.clip.receiving")}
                </p>
              )}
              {c.enabled && <p className="text-xs text-fg-muted">{t("cp.clip.hint")}</p>}
            </div>
          )}
          {p.visible && (
            <div className="flex flex-col gap-2" data-testid="print-block">
              <input
                ref={input}
                type="file"
                accept="application/pdf"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                data-testid="print-input"
                onChange={(e) => pick(e.target.files?.[0])}
              />
              <Button
                variant="secondary"
                disabled={!p.enabled}
                aria-describedby={hasReason(p) ? printReason : undefined}
                onClick={() => {
                  cp.clearPrintError();
                  input.current?.click();
                }}
                data-testid="print-pick"
              >
                <Printer aria-hidden className="size-4" />
                {t("cp.print")}
              </Button>
              <Reason s={p} id={printReason} cooldownSec={cp.cooldownSec} testId="print-reason" />
              {p.enabled && <p className="text-xs text-fg-muted">{t("cp.print.limit")}</p>}
              {print.fieldError && (
                <Alert tone="danger" testId="print-error">
                  {t(`cp.print.err.${print.fieldError}`)}
                </Alert>
              )}
              {print.job && <PrintRow j={print.job} now={now} onCancel={cp.cancelPrint} />}
            </div>
          )}
        </>
      )}
    </section>
  );
}
