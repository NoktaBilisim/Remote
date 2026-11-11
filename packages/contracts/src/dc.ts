// DataChannel sözleşmesi (docs/mimari-protokol.md §4). P4: temel zarf + kanal adları; P5: `ctl` mesajları (chat,
// annot.*, file.*, ping), `file` kanalı çerçevesi ve alınan bayt sınırı; P7: `input` kanalı. DC'de `control.*` tipi YOKTUR (kontrol isteği
// yalnız WS'den); strict şema bilinmeyen tipi/alanı reddeder (G-09).
import { z } from "zod";

/** Teknisyen offer'da açar. `input` yalnız AGENT; BROWSER misafir bu kanalı kabul etmez/kapatır. */
export const DC_LABELS = { CTL: "ctl", FILE: "file", INPUT: "input" } as const;
export type DcLabel = (typeof DC_LABELS)[keyof typeof DC_LABELS];

/** `ctl` kanalında tek JSON mesajı üst sınırı (UTF-8 bayt). */
export const DC_CTL_MAX_BYTES = 16 * 1024;

/** Her DC JSON mesajının ortak zarfı: `{ t, id? }` (WS ile aynı kalıp). */
export const dcEnvelopeSchema = z.object({ t: z.string().min(1).max(32), id: z.string().max(26).optional() });
export type DcEnvelope = z.infer<typeof dcEnvelopeSchema>;

/** UTF-8 bayt uzunluğu (ortam bağımsız: lib'de TextEncoder/Buffer yok). */
function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * Ham `ctl` çerçevesini zarf olarak doğrular; boyut aşımı, ikili veri, geçersiz JSON veya zarfsız nesne → null
 * (alıcı mesajı düşürür). Tipe özgü doğrulama P5 şemalarıyla yapılır.
 */
export function parseDcEnvelope(raw: unknown): DcEnvelope | null {
  if (typeof raw !== "string" || utf8Bytes(raw) > DC_CTL_MAX_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = dcEnvelopeSchema.safeParse(json);
  return r.success ? r.data : null;
}

// ---------------------------------------------------------------------------------------------------------------
// P5 — `ctl` mesajları (mimari-protokol §4.1)

/** AC-35: chat metni üst sınırı (karakter). Alıcı `textContent` ile basar. */
export const CHAT_MAX_CHARS = 2000;
/** AC-56: tek çizgide en çok nokta. */
export const ANNOT_MAX_POINTS = 500;
/** AC-57: lazer gönderim sıklığı üst sınırı (mesaj/sn) ve alıcıda sönümleme süresi (ms). */
export const LASER_MAX_PER_SEC = 30;
export const LASER_FADE_MS = 1000;
/** Tenant `max_file_mb` tavanı (2048 MiB) — DB CHECK `session_files.size_bytes ≤ 2147483648` ile aynı. */
export const FILE_MAX_BYTES_CAP = 2048 * 1024 * 1024;
/** AC-53 varsayılanı (tenant ayarı yoksa). */
export const DEFAULT_MAX_FILE_MB = 100;
/** Alıcı ret sonrası yeni teklifleri otomatik reddettiği süre (§4.1). */
export const FILE_REJECT_COOLDOWN_MS = 30_000;

export const ANNOT_TOOLS = ["pen", "arrow", "rect"] as const;
export const ANNOT_COLORS = ["red", "yellow", "green", "blue"] as const;

/** Tenant `max_file_mb` → bayt (tavanla sınırlı). */
export function maxFileBytes(maxFileMb: number): number {
  return Math.min(Math.max(0, Math.floor(maxFileMb)) * 1024 * 1024, FILE_MAX_BYTES_CAP);
}

const msgId = z.string().regex(/^[A-Za-z0-9_-]{1,26}$/);
const unit = z.number().min(0).max(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
/** Transfer kimliği (gönderen üretir). */
const fid = msgId;

export const chatSchema = z.strictObject({
  t: z.literal("chat"),
  id: msgId,
  text: z.string().min(1).max(CHAT_MAX_CHARS),
  ts: z.number().int().min(0),
});
export const annotStrokeSchema = z.strictObject({
  t: z.literal("annot.stroke"),
  id: msgId,
  tool: z.enum(ANNOT_TOOLS),
  color: z.enum(ANNOT_COLORS),
  pts: z.array(z.tuple([unit, unit])).min(1).max(ANNOT_MAX_POINTS),
});
export const annotLaserSchema = z.strictObject({ t: z.literal("annot.laser"), x: unit, y: unit });
export const annotUndoSchema = z.strictObject({ t: z.literal("annot.undo"), id: msgId.optional() });
export const annotClearSchema = z.strictObject({ t: z.literal("annot.clear"), id: msgId.optional() });
/**
 * `name` ham gelir: alıcı **gösterimden önce** `sanitizeFileName` uygular (contracts/files). `size` beyandır;
 * sınır alınan bayt sayacıyla uygulanır (`FileReceiveGuard`). `idx`: `file` kanalı çerçevesindeki `fidIndex`
 * (uint16) — alıcı parçayı teklife bağlar (protokole P5'te eklendi, implementation.md sapma notu).
 */
export const fileOfferSchema = z.strictObject({
  t: z.literal("file.offer"),
  fid,
  idx: z.number().int().min(0).max(0xffff),
  name: z.string().min(1).max(255),
  size: z.number().int().min(0).max(FILE_MAX_BYTES_CAP),
  sha256,
});
export const fileAcceptSchema = z.strictObject({ t: z.literal("file.accept"), fid });
export const fileRejectSchema = z.strictObject({ t: z.literal("file.reject"), fid });
export const fileCancelSchema = z.strictObject({ t: z.literal("file.cancel"), fid });
export const fileDoneSchema = z.strictObject({ t: z.literal("file.done"), fid });
/** Alıcının SHA-256 doğrulama sonucu (AC-54); `ok=false` → alıcı dosyayı siler, iki taraf "Dosya bozuk". */
export const fileResultSchema = z.strictObject({ t: z.literal("file.result"), fid, ok: z.boolean() });
export const pingSchema = z.strictObject({ t: z.literal("ping"), id: msgId.optional() });

export const ctlMessageSchema = z.discriminatedUnion("t", [
  chatSchema, annotStrokeSchema, annotLaserSchema, annotUndoSchema, annotClearSchema,
  fileOfferSchema, fileAcceptSchema, fileRejectSchema, fileCancelSchema, fileDoneSchema, fileResultSchema, pingSchema,
]);
export type CtlMessage = z.infer<typeof ctlMessageSchema>;
export type CtlType = CtlMessage["t"];

/** G-09/AC-119: `file_transfer` yeteneğine bağlı ctl tipleri; misafir caps'te yoksa `file.offer` → otomatik `file.reject`, diğerleri düşer. */
export const FILE_CTL_TYPES: ReadonlySet<CtlType> = new Set(["file.offer", "file.accept", "file.reject", "file.cancel", "file.done", "file.result"]);

/** Ham `ctl` çerçevesi → tipli mesaj; boyut/JSON/şema hatasında null (alıcı düşürür). */
export function parseCtlMessage(raw: unknown): CtlMessage | null {
  if (parseDcEnvelope(raw) === null) return null;
  const r = ctlMessageSchema.safeParse(JSON.parse(raw as string));
  return r.success ? r.data : null;
}

/** Misafir tarafı yetenek filtresi (G-09): mesaj bu caps ile kabul edilebilir mi. */
export function ctlAllowed(t: CtlType, caps: readonly string[]): boolean {
  return !FILE_CTL_TYPES.has(t) || caps.includes("file_transfer");
}

// ---------------------------------------------------------------------------------------------------------------
// P5 — `file` kanalı (mimari-protokol §4.2): `fidIndex(uint16) | seq(uint32) | payload(≤ 16 KB)`, big-endian.

export const FILE_CHUNK_HEADER_BYTES = 6;
export const FILE_CHUNK_MAX_PAYLOAD = 16 * 1024;
/** Akış kontrolü (gönderen): eşik ve bekleme sınırı. */
export const FILE_BUFFERED_LOW_THRESHOLD = 1024 * 1024;
export const FILE_BUFFERED_MAX = 4 * 1024 * 1024;

export interface FileChunk {
  fidIndex: number;
  seq: number;
  payload: Uint8Array;
}

export function encodeFileChunk(fidIndex: number, seq: number, payload: Uint8Array): Uint8Array {
  if (payload.byteLength > FILE_CHUNK_MAX_PAYLOAD) throw new RangeError("payload > 16 KB");
  const out = new Uint8Array(FILE_CHUNK_HEADER_BYTES + payload.byteLength);
  const v = new DataView(out.buffer);
  v.setUint16(0, fidIndex & 0xffff);
  v.setUint32(2, seq >>> 0);
  out.set(payload, FILE_CHUNK_HEADER_BYTES);
  return out;
}

/** Bozuk/aşırı büyük çerçeve → null (alıcı transferi iptal eder). */
export function decodeFileChunk(frame: ArrayBuffer | Uint8Array): FileChunk | null {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  if (bytes.byteLength < FILE_CHUNK_HEADER_BYTES || bytes.byteLength > FILE_CHUNK_HEADER_BYTES + FILE_CHUNK_MAX_PAYLOAD) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { fidIndex: v.getUint16(0), seq: v.getUint32(2), payload: bytes.subarray(FILE_CHUNK_HEADER_BYTES) };
}

/**
 * §4.2/5 alınan bayt sayacı: beyan edilen `size`'a güvenilmez. `add` sınır aşımında "exceeded" döner (alıcı
 * iptal eder + `.part` siler); sıra dışı `seq` "out_of_order". `complete()` yalnız alınan = beyan iken true.
 */
export class FileReceiveGuard {
  private received = 0;
  private nextSeq = 0;
  private readonly limit: number;
  private readonly declared: number;

  constructor(declaredSize: number, maxBytes: number) {
    this.declared = declaredSize;
    this.limit = Math.min(declaredSize, maxBytes);
  }

  get bytes(): number {
    return this.received;
  }

  add(chunk: Pick<FileChunk, "seq" | "payload">): "ok" | "exceeded" | "out_of_order" {
    if (chunk.seq !== this.nextSeq) return "out_of_order";
    this.nextSeq += 1;
    this.received += chunk.payload.byteLength;
    return this.received > this.limit ? "exceeded" : "ok";
  }

  complete(): boolean {
    return this.received === this.declared;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// P7 — `input` kanalı (mimari-protokol §4.3; AC-47..50, 101, 104). Yalnız AGENT misafir kabul eder; uygulama kararı
// istemcideki izin kapısındadır (`gate.IsOpen()` SendInput'tan hemen önce). Koordinatlar aktif monitöre göre 0..1 (AC-49).

export const MOUSE_BUTTONS = ["l", "r", "m"] as const;
/** Tekerlek delta sınırı (WHEEL_DELTA=120 × 10). */
export const WHEEL_MAX = 1200;

export const mouseMoveSchema = z.strictObject({ t: z.literal("m.move"), x: unit, y: unit });
export const mouseButtonSchema = z.strictObject({ t: z.literal("m.btn"), b: z.enum(MOUSE_BUTTONS), down: z.boolean(), x: unit, y: unit });
export const mouseWheelSchema = z.strictObject({
  t: z.literal("m.wheel"),
  dx: z.number().int().min(-WHEEL_MAX).max(WHEEL_MAX),
  dy: z.number().int().min(-WHEEL_MAX).max(WHEEL_MAX),
});
/**
 * `code` = KeyboardEvent.code (yalnız harf/rakam, ≤ 32 — Go `internal/input` ile aynı, QA-P7-3); `key` yalnız
 * yazdırılabilir karakter için (Türkçe → KEYEVENTF_UNICODE).
 */
export const keySchema = z.strictObject({ t: z.literal("k"), code: z.string().regex(/^[A-Za-z0-9]{1,32}$/), down: z.boolean(), key: z.string().min(1).max(4).optional() });
/** Odak kaybında takılı tuş önleme. */
export const keyReleaseAllSchema = z.strictObject({ t: z.literal("k.release_all") });

export const inputMessageSchema = z.discriminatedUnion("t", [mouseMoveSchema, mouseButtonSchema, mouseWheelSchema, keySchema, keyReleaseAllSchema]);
export type InputMessage = z.infer<typeof inputMessageSchema>;

/** Ham `input` çerçevesi → tipli mesaj; boyut/JSON/şema hatasında null (alıcı düşürür). */
export function parseInputMessage(raw: unknown): InputMessage | null {
  if (parseDcEnvelope(raw) === null) return null;
  const r = inputMessageSchema.safeParse(JSON.parse(raw as string));
  return r.success ? r.data : null;
}
