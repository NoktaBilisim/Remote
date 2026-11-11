/*
 * P5 `ctl` DataChannel sözleşmesi ve sunucuya giden P5 WS mesajları — tek kaynak `@remote/contracts/{dc,ws}`;
 * bu dosya yalnız web tarafının kısa adlarını ve küçük yardımcılarını toplar.
 */
import { ANNOT_COLORS, ANNOT_TOOLS, CHAT_MAX_CHARS, parseCtlMessage, type CtlMessage } from "@remote/contracts/dc";
import type { FileMeta, QualitySummary } from "@remote/contracts/ws";

export { ANNOT_COLORS, ANNOT_TOOLS, type CtlMessage };
export type AnnotColor = (typeof ANNOT_COLORS)[number];
export type AnnotTool = (typeof ANNOT_TOOLS)[number];
export const CHAT_MAX = CHAT_MAX_CHARS;

/** Ham ctl çerçevesi → doğrulanmış mesaj; boyut aşımı/ikili/bilinmeyen tip/fazla alan → null (düşürülür). */
export const parseCtl = parseCtlMessage;

/** Kısa rastgele kimlik (≤ 26). */
export const newId = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 24);
};

export type FileMetaMsg = FileMeta;
export type FileResult = FileMeta["result"];
export type FileDirection = FileMeta["direction"];
export type QualitySummaryMsg = QualitySummary & { t: "quality.summary" };
export type Agg = QualitySummary["fps"];
export type ConnType = QualitySummary["connType"];
export type P5Outbound = FileMetaMsg | QualitySummaryMsg;
