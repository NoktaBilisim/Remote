// P28e parça kabul kararı — saf fonksiyon (mimari-p28e r2 §5.1, §5.3, §7; S-P28e-1/2/7, AC-383/384). Ön denetim (kilitsiz) ve
// TX içi kesin denetim AYNI kuralı çağırır (yalnız girdiler farklı anlıktır). Sıra: oda/durum (404) → sıra/bölüm (409) →
// süre şişirme (400 + stop{invalid}) → oran tavanı (409 + stop{rate}). Kota/disk DB/disk okuması ister, çağıranda.
import {
  REC_DURATION_SLACK_MS,
  REC_MAX_BYTES_PER_HOUR,
  REC_RATE_SLACK_BYTES,
  REC_STOP_GRACE_MS,
  REC_STOP_GRACE_PARTS,
  REC_STOP_OFFSET_SLACK_MS,
} from "@remote/contracts/ws-rec";
import type { RecPartResult, RoomRec } from "./types.ts";

const HOUR_MS = 3_600_000;

export type PartDecision =
  | { kind: "accept"; offsetMs: number; next: number }
  | { kind: "dup"; next: number }
  | { kind: "order"; next: number }
  | { kind: "conflict" }
  | { kind: "gone"; result: Extract<RecPartResult, "gone" | "stopped" | "nosource"> }
  | { kind: "invalid" }
  | { kind: "rate" };

export interface DecideInput {
  rec: { state: string; startedAt: Date; stoppedAt: Date | null; durationMs: number; sizeBytes: bigint | number };
  room: RoomRec | undefined;
  /** Son bölüm (yoksa null). */
  last: { series: number; count: number; offsetMs: number; durationMs: number } | null;
  exists: boolean;
  s: number;
  p: number;
  durationMs: number;
  size: number;
  /** `X-Rec-Series-Start-Ms` (yalnız p = 0). */
  seriesStartMs: number | undefined;
  now: number;
}

/** Sıra ve ofset (§5.1 m.4): yeni bölüm başı `clamp(start, son parça bitişi, now)`; bölüm içi önceki parçaların süresi. */
function sequence(i: DecideInput): PartDecision {
  const started = i.rec.startedAt.getTime();
  const lastS = i.last?.series ?? -1;
  if (i.last && i.s === lastS) {
    if (i.p !== i.last.count) return { kind: "order", next: i.last.count };
    return { kind: "accept", offsetMs: i.last.offsetMs + i.last.durationMs, next: i.p + 1 };
  }
  if (i.s < lastS || i.p !== 0) return { kind: "conflict" };
  const lastEnd = started + (i.last ? i.last.offsetMs + i.last.durationMs : 0);
  const start = Math.min(Math.max(i.seriesStartMs ?? i.now, lastEnd), Math.max(i.now, lastEnd));
  return { kind: "accept", offsetMs: start - started, next: 1 };
}

/** Durma payı (S-P28e-1) / kaynak eş yok (S-P28e-2). null = uygun. */
function gate(i: DecideInput, offsetMs: number): PartDecision | null {
  const room = i.room;
  if (!room || i.rec.state === "DELETED") return { kind: "gone", result: "gone" };
  if (i.rec.state === "ACTIVE" && room.state === "active") {
    const sg = room.sourceGone;
    if (sg && !(i.s === sg.series && i.p === sg.next && i.now - sg.at <= REC_STOP_GRACE_MS)) return { kind: "gone", result: "nosource" };
    return null;
  }
  const stoppedAt = room.stoppedAt ?? i.rec.stoppedAt?.getTime();
  const dbStop = i.rec.stoppedAt?.getTime() ?? stoppedAt;
  const ok =
    room.stopSeries !== undefined &&
    room.stopNext !== undefined &&
    stoppedAt !== undefined &&
    dbStop !== undefined &&
    i.now - stoppedAt <= REC_STOP_GRACE_MS &&
    i.s === room.stopSeries &&
    i.p >= room.stopNext &&
    i.p < room.stopNext + REC_STOP_GRACE_PARTS &&
    offsetMs + i.durationMs <= dbStop - i.rec.startedAt.getTime() + REC_STOP_OFFSET_SLACK_MS;
  return ok ? null : { kind: "gone", result: "stopped" };
}

export function decidePart(i: DecideInput): PartDecision {
  if (i.exists) {
    const g = gate(i, 0);
    if (g?.kind === "gone" && g.result === "gone") return g;
    return { kind: "dup", next: i.last && i.last.series === i.s ? i.last.count : i.p + 1 };
  }
  const seq = sequence(i);
  const g = gate(i, seq.kind === "accept" ? seq.offsetMs : 0);
  if (g) return g;
  if (seq.kind !== "accept") return seq;
  const elapsed = i.now - i.rec.startedAt.getTime();
  if (i.rec.durationMs + i.durationMs > elapsed + REC_DURATION_SLACK_MS) return { kind: "invalid" };
  const cap = (REC_MAX_BYTES_PER_HOUR * Math.max(0, elapsed)) / HOUR_MS + REC_RATE_SLACK_BYTES;
  if (Number(i.rec.sizeBytes) + i.size > cap) return { kind: "rate" };
  return seq;
}
