import { ArrowLeft, CircleX, Power, RotateCcw } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";
import type { DrawInput, DrawTool } from "@/components/collab/annot-layer";
import { AnnotToolbar } from "@/components/console/collab-side";
import { ControlButton } from "@/components/console/control-button";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t } from "@/lib/i18n";
import type { AnnotColor } from "@/lib/dc/ctl";
import type { Collab } from "@/lib/dc/use-collab";
import type { SpecialComboId } from "@/lib/control/input";
import type { ControlState } from "@/lib/control/machine";
import type { TechState } from "@/lib/webrtc/tech-machine";
import { CONSENT_END_REASONS } from "@/lib/unattended/consent";

/**
 * Oturum bitti ekranı (neden + listeye dönüş). P28u (AC-432): gözetimsiz izinli istek reddedildi / yanıtsız kaldıysa "Yeniden dene"
 * cihaz ayrıntısına götürür (tek Bağlan yolu; yeni step-up ister — metinde yazar).
 */
export function ConsoleEnded({ end, deviceId = null }: { end: TechState["end"]; deviceId?: string | null }) {
  const retry = deviceId !== null && end !== null && CONSENT_END_REASONS.includes(end);
  return (
    <section
      role="status"
      data-testid="console-ended"
      className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-6"
    >
      <h2 className="text-lg font-semibold text-fg">{t("c.endedTitle")}</h2>
      <p className="text-sm text-fg-muted">{t(`c.reason.${end ?? "server"}`)}</p>
      {retry && (
        <div className="flex flex-col gap-1" data-testid="console-consent-retry">
          <Link
            href={`/unattended/${deviceId}`}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <RotateCcw aria-hidden className="size-4" />
            {t("un.consent.retry")}
          </Link>
          <p className="text-xs text-fg-muted">{t("un.consent.retryNote")}</p>
        </div>
      )}
      <Link href="/sessions" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline">
        <ArrowLeft aria-hidden className="size-4" />
        {t("c.back")}
      </Link>
    </section>
  );
}

/** Bitir (canlı) / iptal (bekleme) onayı: yıkıcı, odak "Vazgeç"te. */
export function ConfirmEndDialog({
  open,
  live,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  live: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={live ? t("c.endTitle") : t("c.cancelTitle")}
      description={live ? t("c.endBody") : t("c.cancelBody")}
      size="sm"
      role="alertdialog"
      testId="console-confirm"
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={onClose} disabled={busy} className="sm:ml-auto">
            {t("c.keep")}
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm} data-testid="console-confirm-ok">
            {!busy && (live ? <Power aria-hidden className="size-4" /> : <CircleX aria-hidden className="size-4" />)}
            {live ? t("c.end") : t("c.cancel")}
          </Button>
        </>
      }
    />
  );
}

/** Sahnenin işaretleme girdisi: DC hazırsa katman; araç seçiliyse çizim/lazer gönderimi. */
export function annotInput(collab: Collab, drawTool: DrawTool | null, color: AnnotColor) {
  if (!collab.ready) return null;
  const input: DrawInput | null = drawTool
    ? {
        tool: drawTool,
        color,
        onStroke: (s) => collab.sendAnnot({ t: "annot.stroke", id: s.id, tool: s.tool, color: s.color, pts: s.pts }),
        onLaser: (x, y) => collab.sendAnnot({ t: "annot.laser", x, y }),
      }
    : null;
  return { state: collab.annot, input };
}

/** İşaretleme araç çubuğu (kontrol yakalanırken pasif, nedeni ipucunda). */
export function ConsoleAnnotTools({
  collab,
  tool,
  color,
  onTool,
  onColor,
  capturing,
}: {
  collab: Collab;
  tool: DrawTool | null;
  color: AnnotColor;
  onTool: (t: DrawTool | null) => void;
  onColor: (c: AnnotColor) => void;
  capturing: boolean;
}) {
  if (!collab.ready) return null;
  return (
    <AnnotToolbar
      tool={tool}
      color={color}
      onTool={onTool}
      onColor={onColor}
      onUndo={() => collab.sendAnnot({ t: "annot.undo", ...(collab.annot.strokes.at(-1) ? { id: collab.annot.strokes.at(-1)?.id } : {}) })}
      onClear={() => collab.sendAnnot({ t: "annot.clear" })}
      disabledHint={capturing ? t("p7.annotOff") : null}
    />
  );
}

/** P7 kontrol çubuğu (yalnız Hızlı Destek misafiri; düğme remote_control.use ile). */
export function ConsoleControlBar(p: {
  canControl: boolean;
  control: ControlState;
  now: number | null;
  available: boolean;
  onRequest: () => void;
  onRelease: () => void;
  onCancel: () => void;
  onKeys: (id: SpecialComboId) => void;
  releaseRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <>
      {p.canControl && (
        <ControlButton
          s={p.control}
          now={p.now}
          available={p.available}
          onRequest={p.onRequest}
          onRelease={p.onRelease}
          onCancel={p.onCancel}
          onKeys={p.onKeys}
          releaseRef={p.releaseRef}
        />
      )}
    </>
  );
}
