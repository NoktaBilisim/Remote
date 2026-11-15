"use client";

import { CircleDot, Eraser, MoveUpRight, PenLine, Signal, Square, Undo2 } from "lucide-react";
import { useEffect } from "react";
import { ChatPanel } from "@/components/collab/chat-panel";
import { FilesPanel } from "@/components/collab/files-panel";
import { chatFilesOptions } from "@/components/collab/tab-options";
import type { DrawTool } from "@/components/collab/annot-layer";
import { QualityPanel } from "@/components/console/quality-panel";
import { Segmented } from "@/components/ui/segmented";
import { ANNOT_COLORS, type AnnotColor } from "@/lib/dc/ctl";
import type { Collab } from "@/lib/dc/use-collab";
import { t } from "@/lib/i18n";
import type { useQuality } from "@/lib/webrtc/use-quality";

type Tab = "chat" | "files" | "quality";

/** Konsol yan paneli: Sohbet / Dosyalar / Kalite (anında sekme geçişi, DESIGN §3). */
export function CollabSide({
  collab,
  quality,
  canFiles,
  peerName,
  tab,
  onTab,
}: {
  collab: Collab;
  quality: ReturnType<typeof useQuality>;
  canFiles: boolean;
  peerName: string;
  tab: Tab;
  onTab: (t: Tab) => void;
}) {
  // Gelen dosya teklifi: kabul diyaloğu Dosyalar sekmesinde → teklif gelince oraya geç (onay görünmeden bekleyemez)
  const offer = collab.transfers.find((x) => x.dir === "in" && x.status === "pending")?.fid;
  useEffect(() => {
    if (offer && canFiles) onTab("files");
  }, [offer]); // eslint-disable-line react-hooks/exhaustive-deps -- yalnız yeni teklifte
  return (
    <aside
      aria-label={t("p5.side")}
      className="flex w-full flex-col gap-3 rounded-lg border border-border bg-surface p-3 xl:w-96 xl:shrink-0"
      data-testid="collab-side"
    >
      <Segmented<Tab>
        label={t("p5.side")}
        value={tab}
        onChange={onTab}
        options={[
          ...chatFilesOptions(collab.chat.unread),
          { value: "quality", label: t("p5.tab.quality"), icon: <Signal aria-hidden className="size-4" /> },
        ]}
      />
      {tab === "chat" && <ChatPanel collab={collab} peerName={peerName} />}
      {tab === "files" && <FilesPanel collab={collab} allowed={canFiles} peerName={peerName} />}
      {tab === "quality" && <QualityPanel last={quality.last} verdict={quality.verdict} />}
    </aside>
  );
}
export type { Tab as CollabTab };

const SWATCH: Record<AnnotColor, string> = {
  red: "bg-annot-red",
  yellow: "bg-annot-yellow",
  green: "bg-annot-green",
  blue: "bg-annot-blue",
};

/** İşaretleme araç çubuğu (AC-56): araç seçimi (yeniden tıklama kapatır), 4 renk, geri al, temizle. */
export function AnnotToolbar({
  tool,
  color,
  onTool,
  onColor,
  onUndo,
  onClear,
  disabledHint,
}: {
  /** P7: kontrol yakalanırken işaretleme kapalı (iki mod çakışmaz); verilirse düğmeler pasif + açıklama. */
  disabledHint?: string | null;
  tool: DrawTool | null;
  color: AnnotColor;
  onTool: (t: DrawTool | null) => void;
  onColor: (c: AnnotColor) => void;
  onUndo: () => void;
  onClear: () => void;
}) {
  const tools: [DrawTool, typeof PenLine, string][] = [
    ["pen", PenLine, t("p5.a.pen")],
    ["arrow", MoveUpRight, t("p5.a.arrow")],
    ["rect", Square, t("p5.a.rect")],
    ["laser", CircleDot, t("p5.a.laser")],
  ];
  const btn =
    "inline-flex size-11 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-muted hover:text-fg aria-pressed:bg-primary-surface aria-pressed:text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";
  const off = Boolean(disabledHint);
  return (
    <div
      role="toolbar"
      aria-label={t("p5.a.toolbar")}
      aria-disabled={off || undefined}
      title={disabledHint ?? undefined}
      className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-sm"
      data-testid="annot-toolbar"
    >
      {tools.map(([k, Icon, label]) => (
        <button
          key={k}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={tool === k}
          disabled={off}
          onClick={() => onTool(tool === k ? null : k)}
          className={btn}
          data-testid={`annot-${k}`}
        >
          <Icon aria-hidden className="size-4" />
        </button>
      ))}
      <span aria-hidden className="mx-1 h-6 w-px bg-border" />
      {ANNOT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={t(`p5.a.color.${c}`)}
          aria-pressed={color === c}
          disabled={off}
          onClick={() => onColor(c)}
          className={btn}
        >
          <span
            aria-hidden
            className={`size-4 rounded-full ${SWATCH[c]} ${color === c ? "ring-2 ring-fg ring-offset-1 ring-offset-surface" : ""}`}
          />
        </button>
      ))}
      <span aria-hidden className="mx-1 h-6 w-px bg-border" />
      <button
        type="button"
        aria-label={t("p5.a.undo")}
        title={t("p5.a.undo")}
        disabled={off}
        onClick={onUndo}
        className={btn}
        data-testid="annot-undo"
      >
        <Undo2 aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        aria-label={t("p5.a.clear")}
        title={t("p5.a.clear")}
        disabled={off}
        onClick={onClear}
        className={btn}
        data-testid="annot-clear"
      >
        <Eraser aria-hidden className="size-4" />
      </button>
    </div>
  );
}
