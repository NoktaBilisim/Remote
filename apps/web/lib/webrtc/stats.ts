/*
 * Kalite ölçümü (AC-44..46): 1 sn'de bir getStats → örnek; 3 sn süren eşik aşımı uyarı/kötü (AC-45);
 * özet (ort/min/maks FPS, kbps, RTT + bağlantı tipi) 60 sn'de bir ve oturum sonunda `quality.summary`.
 */
import type { Agg, ConnType, QualitySummaryMsg } from "../dc/ctl";

export interface Sample {
  at: number;
  fps: number | null;
  kbps: number | null;
  rttMs: number | null;
  lossPct: number | null;
  width: number | null;
  height: number | null;
  connType: ConnType | null;
}
interface Counters {
  at: number;
  bytes: number;
  lost: number;
  recv: number;
}
export interface Prev {
  c: Counters | null;
}

type Rec = Record<string, unknown> & { type: string; id: string };
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** RTCStatsReport Map örneği değildir (maplike): düz yayma [anahtar, değer] çiftleri verir → values() kullanılır. */
function records(report: Iterable<Rec> | Map<string, Rec>): Rec[] {
  const vals = (report as Map<string, Rec>).values;
  return typeof vals === "function" ? [...vals.call(report)] : [...(report as Iterable<Rec>)];
}

/** Seçili aday çifti ve yerel adayın türü (relay / srflx / host). */
function selectedPair(all: Rec[]): { pair: Rec | undefined; connType: ConnType | null } {
  const byId = new Map(all.map((r) => [r.id, r]));
  const transport = all.find((r) => r.type === "transport");
  const pair =
    (transport && byId.get(String(transport.selectedCandidatePairId))) ??
    all.find((r) => r.type === "candidate-pair" && r.nominated === true && r.state === "succeeded");
  const local = pair ? byId.get(String(pair.localCandidateId)) : undefined;
  const ct = local?.candidateType;
  const connType: ConnType | null = ct === "relay" ? "relay" : ct === "srflx" || ct === "prflx" ? "srflx" : ct === "host" ? "host" : null;
  return { pair, connType };
}

/** Önceki sayaçlara göre bit hızı ve kayıp yüzdesi; ölçülemiyorsa null. */
function rates(c: Counters | null, p: Counters | null): { kbps: number | null; lossPct: number | null } {
  if (!c || !p || c.at <= p.at) return { kbps: null, lossPct: null };
  const kbps = Math.max(0, ((c.bytes - p.bytes) * 8) / (c.at - p.at));
  const lost = c.lost - p.lost;
  const tot = lost + (c.recv - p.recv);
  return { kbps, lossPct: tot > 0 ? Math.max(0, (lost / tot) * 100) : 0 };
}

/** RTCStatsReport (veya düz dizi) → örnek. `prev` bitrate/kayıp farkı için güncellenir. */
export function sampleFromStats(report: Iterable<Rec> | Map<string, Rec>, prev: Prev, at: number): Sample {
  const all = records(report);
  const inV = all.find((r) => r.type === "inbound-rtp" && r.kind === "video");
  const { pair, connType } = selectedPair(all);
  const rtt = num(pair?.currentRoundTripTime);
  const c: Counters | null = inV
    ? { at, bytes: num(inV.bytesReceived) ?? 0, lost: num(inV.packetsLost) ?? 0, recv: num(inV.packetsReceived) ?? 0 }
    : null;
  const { kbps, lossPct } = rates(c, prev.c);
  prev.c = c;
  return {
    at,
    fps: num(inV?.framesPerSecond) ?? (inV ? 0 : null),
    kbps,
    rttMs: rtt === null ? null : rtt * 1000,
    lossPct,
    width: num(inV?.frameWidth),
    height: num(inV?.frameHeight),
    connType,
  };
}

export type Level = "ok" | "warn" | "bad";
export type Issue = "rtt" | "loss" | "fps";
const SUSTAIN_MS = 3000;
const WARN = { rtt: 300, loss: 5, fps: 5 };
const BAD = { rtt: 600, loss: 10, fps: 2 };

function issues(s: Sample, th: typeof WARN): Issue[] {
  const out: Issue[] = [];
  if (s.rttMs !== null && s.rttMs > th.rtt) out.push("rtt");
  if (s.lossPct !== null && s.lossPct > th.loss) out.push("loss");
  if (s.fps !== null && s.fps < th.fps) out.push("fps");
  return out;
}

/** Son örneklerde ≥ 3 sn kesintisiz süren sorunlar → seviye + nedenler (AC-45). */
export function evaluate(samples: Sample[]): { level: Level; issues: Issue[] } {
  const last = samples[samples.length - 1];
  if (!last) return { level: "ok", issues: [] };
  const sustained = (th: typeof WARN): Issue[] => {
    const window = samples.filter((s) => s.at >= last.at - SUSTAIN_MS);
    if (!window.length || last.at - (window[0] as Sample).at < SUSTAIN_MS - 500) return [];
    return issues(last, th).filter((i) => window.every((s) => issues(s, th).includes(i)));
  };
  const bad = sustained(BAD);
  if (bad.length) return { level: "bad", issues: bad };
  const warn = sustained(WARN);
  return warn.length ? { level: "warn", issues: warn } : { level: "ok", issues: [] };
}

/** Özet biriktirici. */
export class QualityAgg {
  private v: Record<"fps" | "kbps" | "rttMs", number[]> = { fps: [], kbps: [], rttMs: [] };
  private conn: ConnType | null = null;
  add(s: Sample) {
    for (const k of ["fps", "kbps", "rttMs"] as const) {
      const x = s[k];
      if (x !== null) this.v[k].push(x);
    }
    if (s.connType) this.conn = s.connType;
  }
  get empty() {
    return this.v.fps.length === 0 && this.v.kbps.length === 0;
  }
  private static agg(a: number[]): Agg {
    if (!a.length) return { avg: 0, min: 0, max: 0 };
    return { avg: Math.round(a.reduce((x, y) => x + y, 0) / a.length), min: Math.round(Math.min(...a)), max: Math.round(Math.max(...a)) };
  }
  summary(): QualitySummaryMsg | null {
    if (this.empty) return null;
    return {
      t: "quality.summary",
      fps: QualityAgg.agg(this.v.fps),
      kbps: QualityAgg.agg(this.v.kbps),
      rttMs: QualityAgg.agg(this.v.rttMs),
      connType: this.conn ?? "host",
    };
  }
}

export const SUMMARY_INTERVAL_MS = 60_000;
