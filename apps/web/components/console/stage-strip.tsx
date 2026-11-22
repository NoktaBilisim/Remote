import { SHARE_METHOD_LABELS } from "@remote/contracts/labels";
import { AppWindow, Expand, LoaderCircle, Maximize, Minimize, MonitorCog, ScanSearch } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/segmented";
import { t } from "@/lib/i18n";

export type ViewMode = "fit" | "actual";

/** Şeridin içeriği (çağıranın verdiği düğümler). */
export interface StripContent {
  tools: ReactNode;
  controlBar: ReactNode;
  shareMethod: string | null;
  monitors: ReactNode;
  monitorBusy: boolean;
}
/** Görünüm (Sığdır / %100) ve tam ekran durumu. */
interface StripView {
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  full: boolean;
  onToggleFull: () => void;
}
/** Şerit ölçümü (`useStripFit`). */
interface StripFit {
  compact: boolean;
  tight: boolean;
}

/**
 * Sahnenin üst araç şeridi (görüntünün dışında — QA görsel bulgu: P5'te sağ üstte görüntünün ~60 px'ini kapatıyordu):
 * işaretleme araçları, kontrol çubuğu, pencere modu rozeti, monitör seçimi, görünüm + tam ekran (dar sahnede menüde).
 */
export function StageStrip({
  stripRef,
  fit,
  view,
  content: c,
  showing,
}: {
  stripRef: RefObject<HTMLDivElement | null>;
  fit: StripFit;
  view: StripView;
  content: StripContent;
  showing: boolean;
}) {
  return (
    <div
      ref={stripRef}
      className="relative z-20 flex flex-wrap items-center gap-2 border-b border-border bg-surface p-2"
      data-testid="stage-tools"
      data-compact={fit.compact}
      data-tight={fit.tight}
    >
      {/* AC-498 r2: işaretleme kontrol sırasında ve %100 görünümde de kullanılabilir */}
      {showing && c.tools}
      {c.controlBar}
      {showing && c.shareMethod === "WGC" && <WindowShareBadge method={c.shareMethod} />}
      <StripViewArea fit={fit} view={view} content={c} showing={showing} />
    </div>
  );
}

/** Monitör seçimi + görünüm + tam ekran: geniş sahnede satır içi, dar sahnede tek "Görünüm" menüsünde. */
function StripViewArea({ fit, view, content: c, showing }: { fit: StripFit; view: StripView; content: StripContent; showing: boolean }) {
  const viewSeg = <ViewSegment mode={view.mode} onMode={view.onMode} />;
  const fullBtn = <FullscreenButton full={view.full} onToggle={view.onToggleFull} />;
  if (!fit.compact)
    return (
      <>
        {c.monitors}
        {showing && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {viewSeg}
            {fullBtn}
          </div>
        )}
      </>
    );
  if (!showing && !c.monitors) return null;
  return (
    <div className="ml-auto shrink-0">
      <ViewMenu tight={fit.tight} monitorBusy={c.monitorBusy}>
        {c.monitors}
        {showing && viewSeg}
        {showing && fullBtn}
      </ViewMenu>
    </div>
  );
}

function ViewSegment({ mode, onMode }: { mode: ViewMode; onMode: (m: ViewMode) => void }) {
  return (
    <Segmented<ViewMode>
      label={t("cs.view")}
      value={mode}
      onChange={onMode}
      options={[
        { value: "fit", label: t("cs.fit"), icon: <Expand aria-hidden className="size-4" /> },
        { value: "actual", label: t("cs.actual"), icon: <ScanSearch aria-hidden className="size-4" /> },
      ]}
    />
  );
}

function FullscreenButton({ full, onToggle }: { full: boolean; onToggle: () => void }) {
  return (
    <Button variant="secondary" onClick={onToggle} aria-pressed={full} data-testid="stage-fullscreen">
      {full ? <Minimize aria-hidden className="size-4" /> : <Maximize aria-hidden className="size-4" />}
      {full ? t("cs.exitFullscreen") : t("cs.fullscreen")}
    </Button>
  );
}

/** P17 (AC-248): pencere modu konsolda görünür; DXGI/GDI'da rozet yok (görünüm değişmez). */
function WindowShareBadge({ method }: { method: string }) {
  const hint = t("cs.windowShareHint", { method: SHARE_METHOD_LABELS.WGC ?? "Pencere yakalama" });
  return (
    <span
      data-testid="stage-share-mode"
      data-method={method}
      title={hint}
      className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent-surface px-2.5 text-xs font-medium whitespace-nowrap text-accent-fg"
    >
      <AppWindow aria-hidden className="size-3.5" />
      {t("cs.windowShare")}
      <span className="sr-only">{` — ${hint}`}</span>
    </span>
  );
}

/** Dar sahnede monitör / görünüm / tam ekran tek "Görünüm" menüsünde; monitör isteği beklerken tetikleyicide gösterge. */
function ViewMenu({ tight, monitorBusy, children }: { tight: boolean; monitorBusy: boolean; children: ReactNode }) {
  return (
    <Menu
      label={t("cs.viewMenu")}
      icon={<MonitorCog aria-hidden className="size-4" />}
      labelClassName={tight ? "sr-only" : undefined}
      title={tight ? t("cs.viewMenu") : undefined}
      testId="stage-view-menu"
      align="end"
      busy={
        monitorBusy ? (
          <>
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            <span className="sr-only">{t("cs.viewMenuBusy")}</span>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 p-2">{children}</div>
    </Menu>
  );
}
