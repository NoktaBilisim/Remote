// P28a pano + yazdırma DataChannel `ctl` mesajları (mimari-p28 §4.4, r2 O-P28a-1/2; AC-345, 346, 348, 350). `dc.ts`
// `ctlMessageSchema` birliğine eklenir. PDF baytları mevcut `file` kanalı çerçevesiyle (`fidIndex = print.offer.idx`) gider.
// Misafir alıcı kuralı (§4.4): mesaj yalnız `caps`'te ilgili değer varsa, kimlik sunucudan WS ile gelmiş ve hâlâ bekliyorsa
// ve kapı açıksa uygulanır. Go eşi `internal/dc`; ortak örnekler `fixtures/clip-print.json` (`dc`).
import { z } from "zod";
import { CLIP_CHUNK_BYTES, CLIP_MAX_CHUNKS, CLIP_PRINT_ID_PATTERN, PRINT_MAX_BYTES, PRINT_MIN_BYTES } from "./ws-clip-print.ts";

/** `clip.data.b64` üst sınırı: 8192 ham bayt → base64 (dolgulu) 10 924 karakter. */
export const CLIP_CHUNK_B64_MAX = Math.ceil(CLIP_CHUNK_BYTES / 3) * 4;

const cpId = z.string().regex(CLIP_PRINT_ID_PATTERN);

/** guest → tech: misafir WS `clip.push`'u kabul etti; konsol ancak bundan sonra `clip.data` gönderir. */
export const clipReadySchema = z.strictObject({ t: z.literal("clip.ready"), cid: cpId });
/**
 * İki yön: UTF-8 baytları 8 KB parçalar hâlinde standart base64 (dolgulu). Alıcı `seq` ardışıklığını, toplam ≤ 64 KB'ı,
 * `last` sonrası UTF-8 geçerliliğini ve U+0000 yokluğunu denetler; push'ta toplam = `clip.push.bytes`.
 */
export const clipDataSchema = z.strictObject({
  t: z.literal("clip.data"),
  cid: cpId,
  seq: z
    .number()
    .int()
    .min(0)
    .max(CLIP_MAX_CHUNKS - 1),
  last: z.boolean(),
  b64: z
    .string()
    .min(4)
    .max(CLIP_CHUNK_B64_MAX)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
/** guest → tech: misafir bayt almaya hazır (varsayılan yazıcı var, başka TO_CUSTOMER aktarım yok). */
export const printReadySchema = z.strictObject({ t: z.literal("print.ready"), pid: cpId });
/**
 * tech → guest: pid başına TEK offer (r2 O-P28a-2). `size` = WS'de yetkilenen `sizeBytes`; `name` gösterimden önce
 * `sanitizeFileName` + gösterim süzgecinden geçer (G-06). `idx` dosya ve yazdırma için ortak sayaçtan.
 */
export const printOfferSchema = z.strictObject({
  t: z.literal("print.offer"),
  pid: cpId,
  idx: z.number().int().min(0).max(0xffff),
  name: z.string().min(1).max(255),
  size: z.number().int().min(PRINT_MIN_BYTES).max(PRINT_MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
/** tech → guest: son parçadan sonra; alıcı bayt sayısı + SHA-256 + ilk 5 bayt `%PDF-` denetler. */
export const printDoneSchema = z.strictObject({ t: z.literal("print.done"), pid: cpId });

/** `dc.ts` `ctlMessageSchema` birliğine eklenen üyeler. */
export const ctlClipPrintMessages = [clipReadySchema, clipDataSchema, printReadySchema, printOfferSchema, printDoneSchema] as const;

/** G-09: `clipboard` yeteneğine bağlı ctl tipleri. */
export const CLIP_CTL_TYPES: ReadonlySet<string> = new Set(["clip.ready", "clip.data"]);
/** G-09: `print` yeteneğine bağlı ctl tipleri. */
export const PRINT_CTL_TYPES: ReadonlySet<string> = new Set(["print.ready", "print.offer", "print.done"]);
