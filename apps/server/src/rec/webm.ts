// P28e WebM başlık denetimi (mimari-p28e r2 §2 `webm.ts`, §5.1; AC-375, S-P28e-7, T9/T13/T16). Sunucu medyayı ÇÖZMEZ; yalnız
// bölümün ilk parçasındaki EBML başlığı + `Tracks` okunur: tam bir video izi (`TrackType = 1`, `V_VP8`/`V_VP9`). Ses izi, ikinci
// iz, başka kodek, `webm` dışı DocType, `Tracks`'tan önce `Cluster` ya da bozuk EBML → ret. `p > 0` parçasında EBML sihri
// (ikinci gömülü WebM) kesin ret; Cluster başlangıcı `REC_REQUIRE_CLUSTER_START` bayrağına bağlı (K7 ölçümü).
import { REC_REQUIRE_CLUSTER_START } from "@remote/contracts/ws-rec";

const ID_EBML = 0x1a45dfa3;
const ID_DOCTYPE = 0x4282;
const ID_SEGMENT = 0x18538067;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_TYPE = 0x83;
const ID_CODEC_ID = 0x86;
const ID_CLUSTER = 0x1f43b675;
const TRACK_TYPE_VIDEO = 1;
const VIDEO_CODECS: ReadonlySet<string> = new Set(["V_VP8", "V_VP9"]);
/** Bilinmeyen boyut (canlı MediaRecorder `Segment`'i). */
const UNKNOWN = -1;

export type WebmVerdict = { ok: true } | { ok: false; reason: "ebml" | "doctype" | "tracks" | "audio" | "track_count" | "codec" };

interface Element {
  id: number;
  /** Veri başlangıcı. */
  data: number;
  /** Veri boyu; `UNKNOWN` yalnız Segment/Cluster için anlamlı. */
  size: number;
}

/** Element kimliği (işaret bitleri korunur, 1..4 bayt) + boyut (1..8 bayt, işaret biti atılır). Bozuksa null. */
function readElement(b: Buffer, pos: number): Element | null {
  const first = b[pos];
  if (first === undefined || first === 0) return null;
  const idLen = Math.clz32(first) - 23; // 0x80 → 1, 0x40 → 2 …
  if (idLen < 1 || idLen > 4 || pos + idLen > b.length) return null;
  const id = b.readUIntBE(pos, idLen);
  const s = pos + idLen;
  const sFirst = b[s];
  if (sFirst === undefined || sFirst === 0) return null;
  const sLen = Math.clz32(sFirst) - 23;
  if (sLen < 1 || sLen > 8 || s + sLen > b.length) return null;
  let size = sFirst & (0xff >> sLen);
  let allOnes = size === 0xff >> sLen;
  for (let i = 1; i < sLen; i++) {
    const v = b[s + i] ?? 0;
    allOnes &&= v === 0xff;
    size = size * 256 + v;
  }
  if (allOnes) return { id, data: s + sLen, size: UNKNOWN };
  if (size > Number.MAX_SAFE_INTEGER) return null;
  return { id, data: s + sLen, size };
}

/** `[start, end)` aralığındaki çocuk elementler; boyutu bilinmeyen ya da aralığı aşan çocukta durur (null). */
function children(b: Buffer, start: number, end: number): Element[] | null {
  const out: Element[] = [];
  let pos = start;
  while (pos < end) {
    const e = readElement(b, pos);
    if (!e || e.size === UNKNOWN || e.data + e.size > end) return null;
    out.push(e);
    pos = e.data + e.size;
  }
  return out;
}

const text = (b: Buffer, e: Element): string => b.toString("latin1", e.data, e.data + e.size).replace(/\0+$/, "");
const uint = (b: Buffer, e: Element): number => (e.size >= 1 && e.size <= 6 ? b.readUIntBE(e.data, e.size) : -1);

function checkTracks(b: Buffer, tracks: Element): WebmVerdict {
  const kids = children(b, tracks.data, tracks.data + tracks.size);
  if (!kids) return { ok: false, reason: "ebml" };
  const entries = kids.filter((k) => k.id === ID_TRACK_ENTRY);
  for (const entry of entries) {
    const fields = children(b, entry.data, entry.data + entry.size);
    if (!fields) return { ok: false, reason: "ebml" };
    const type = fields.find((f) => f.id === ID_TRACK_TYPE);
    if (!type || uint(b, type) !== TRACK_TYPE_VIDEO) return { ok: false, reason: "audio" };
    const codec = fields.find((f) => f.id === ID_CODEC_ID);
    if (!codec || !VIDEO_CODECS.has(text(b, codec))) return { ok: false, reason: "codec" };
  }
  return entries.length === 1 ? { ok: true } : { ok: false, reason: "track_count" };
}

/** Bölümün ilk parçası (`p = 0`): EBML başlığı + Segment içinde Cluster'dan önce `Tracks` → tek video izi. */
export function checkWebmHeader(b: Buffer): WebmVerdict {
  const ebml = readElement(b, 0);
  if (!ebml || ebml.id !== ID_EBML || ebml.size === UNKNOWN) return { ok: false, reason: "ebml" };
  const head = children(b, ebml.data, ebml.data + ebml.size);
  if (!head) return { ok: false, reason: "ebml" };
  const doctype = head.find((e) => e.id === ID_DOCTYPE);
  if (!doctype || text(b, doctype) !== "webm") return { ok: false, reason: "doctype" };
  const seg = readElement(b, ebml.data + ebml.size);
  if (!seg || seg.id !== ID_SEGMENT) return { ok: false, reason: "ebml" };
  const end = seg.size === UNKNOWN ? b.length : Math.min(b.length, seg.data + seg.size);
  let pos = seg.data;
  while (pos < end) {
    const e = readElement(b, pos);
    if (!e) return { ok: false, reason: "ebml" };
    if (e.id === ID_TRACKS) return e.size === UNKNOWN || e.data + e.size > b.length ? { ok: false, reason: "ebml" } : checkTracks(b, e);
    if (e.id === ID_CLUSTER || e.size === UNKNOWN) return { ok: false, reason: "tracks" };
    pos = e.data + e.size;
  }
  return { ok: false, reason: "tracks" };
}

const startsWith = (b: Buffer, id: number): boolean => b.length >= 4 && b.readUInt32BE(0) === id;

/**
 * `p > 0` gövdesi (S-P28e-7): EBML sihriyle başlıyorsa (ikinci gömülü WebM / yeni iz bildirimi) kesin ret. Cluster başlangıcı
 * yalnız `requireCluster` (varsayılan `REC_REQUIRE_CLUSTER_START`) açıkken zorunlu.
 */
export function checkWebmContinuation(b: Buffer, requireCluster: boolean = REC_REQUIRE_CLUSTER_START): WebmVerdict {
  if (startsWith(b, ID_EBML)) return { ok: false, reason: "ebml" };
  if (requireCluster && !startsWith(b, ID_CLUSTER)) return { ok: false, reason: "ebml" };
  return { ok: true };
}
