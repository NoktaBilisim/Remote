// P15 (AC-235, G-E9-17; mimari-e11 §6): talep engelleri — IP/önek veya cihaz. Uçlar `/api/v1/request-blocks`
// (`support_requests.block`, etkin tenant). Engelli kaynaktan gelen talep diğer reddedilen taleplerle aynı tek tip
// yanıtı alır (429 `RATE_LIMITED` + `REQUEST_BUSY_MESSAGE`) ve kuyruğa düşmez.
import { z } from "zod";
import { blockCidrSchema } from "./requests.ts";

/** Tenant başına üst sınır (DB'de değil, uygulamada; ekleme TX'inde tenant kilidi altında sayılır). */
export const REQUEST_BLOCKS_MAX = 1000;
export const REQUEST_BLOCK_PAGE_SIZE_MAX = 100;
export const REQUEST_BLOCK_KINDS = ["IP", "DEVICE"] as const;
export type RequestBlockKind = (typeof REQUEST_BLOCK_KINDS)[number];
/** Süre: 1 sa – 1 yıl; `null` = süresiz. */
export const REQUEST_BLOCK_MIN_HOURS = 1;
export const REQUEST_BLOCK_MAX_HOURS = 24 * 365;
/** Arayüz hazır seçenekleri (saat; null süresiz). */
export const REQUEST_BLOCK_DURATION_PRESETS: readonly (number | null)[] = [1, 24, 24 * 7, 24 * 30, null];
export const REQUEST_BLOCK_NOTE_MAX = 200;
/** Süresi dolan engel satırı bu kadar gün sonra saklama işinde silinir (IP kişisel veri; mimari-e11 §6 kararı). */
export const REQUEST_BLOCK_EXPIRED_RETENTION_DAYS = 30;
/**
 * Hata kodları (`POST /request-blocks`):
 * - 400 `VALIDATION` — gövde/şema; `fields.cidr` (CIDR biçimi/önek), `fields.prefixLen`, `fields.durationHours`, `fields.note`.
 * - 404 `NOT_FOUND` — `source: "REQUEST"` talebi bu tenant'ta yok (DELETE'te: engel yok).
 * - 409 `CONFLICT` + `REQUEST_BLOCK_EXISTS_MESSAGE` — aynı hedef zaten engelli (süresi dolmamış); `fields.cidr` (IP) veya
 *   `fields.target` (cihaz) aynı metni taşır.
 * - 409 `CONFLICT` + `REQUEST_BLOCKS_LIMIT_MESSAGE` — tenant başına `REQUEST_BLOCKS_MAX` doldu (alan yok).
 * - 409 `CONFLICT` + `REQUEST_BLOCK_NO_SOURCE_MESSAGE` — talebin IP'si/cihaz anahtarı yok (alan yok).
 * - 403 `FORBIDDEN` (`support_requests.block` yok) · 429 `RATE_LIMITED` (30 yazma/dk).
 */
export const REQUEST_BLOCKS_LIMIT_MESSAGE = `Firma başına en çok ${REQUEST_BLOCKS_MAX} engel eklenebilir. Önce eski engelleri kaldırın.`;
export const REQUEST_BLOCK_EXISTS_MESSAGE = "Bu kaynak zaten engelli.";
export const REQUEST_BLOCK_NO_SOURCE_MESSAGE = "Bu talebin kaynak bilgisi yok (anonimleştirilmiş veya cihaz anahtarı gönderilmemiş).";

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Geçersiz kimlik");
const durationHours = z
  .number()
  .int("Tam sayı olmalı")
  .min(REQUEST_BLOCK_MIN_HOURS, `En az ${REQUEST_BLOCK_MIN_HOURS} saat`)
  .max(REQUEST_BLOCK_MAX_HOURS, "En çok 1 yıl")
  .nullable();
/** DB `request_blocks_note_chk`: 1..200, kırpılmış, Cc/Cf/Zl/Zp yok. Boş → yok. */
const note = z
  .string()
  .trim()
  .max(REQUEST_BLOCK_NOTE_MAX, `En çok ${REQUEST_BLOCK_NOTE_MAX} karakter`)
  .refine((v) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v), "Görünmez veya kontrol karakteri içeremez")
  .transform((v) => (v === "" ? undefined : v))
  .optional();

/**
 * POST /request-blocks. `CIDR`: elle IP/önek (IPv4 /24–/32, IPv6 /48–/128; önek yoksa tek adres). `REQUEST`: Talepler
 * ekranındaki "Bu kaynağı engelle" kısayolu — IP veya cihaz sunucuda talep satırından alınır (panel IP'yi/cihaz anahtarını
 * görmez). `prefixLen` yalnız `target: "IP"` ile; verilmezse tek adres.
 */
export const createRequestBlockInputSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("CIDR"), cidr: blockCidrSchema, durationHours, note }),
  z
    .strictObject({
      source: z.literal("REQUEST"),
      requestId: ulid,
      target: z.enum(REQUEST_BLOCK_KINDS),
      prefixLen: z.number().int().min(24).max(128).optional(),
      durationHours,
      note,
    })
    .refine((v) => v.prefixLen === undefined || v.target === "IP", { path: ["prefixLen"], message: "Önek yalnız IP engelinde" }),
]);
export type CreateRequestBlockInput = z.input<typeof createRequestBlockInputSchema>;
export type CreateRequestBlockData = z.output<typeof createRequestBlockInputSchema>;

export const listRequestBlocksQuerySchema = z.strictObject({
  kind: z.enum(REQUEST_BLOCK_KINDS).optional(),
  /** false (varsayılan): yalnız etkin engeller; true: süresi dolmuşlar da (saklama işi silene kadar). */
  includeExpired: z.enum(["true", "false"]).default("false"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(REQUEST_BLOCK_PAGE_SIZE_MAX).default(25),
});
export type ListRequestBlocksQuery = z.infer<typeof listRequestBlocksQuerySchema>;

export interface RequestBlockItem {
  id: string;
  kind: RequestBlockKind;
  /** IP engelinde normalize CIDR (`203.0.113.0/24`, tek adres `/32`/`/128`); cihazda null. */
  cidr: string | null;
  /** Cihaz engelinde anahtar özetinin ilk 8 hanesi (yalnız ayırt etmek için; anahtar değil); IP'de null. */
  deviceFingerprint: string | null;
  /** null = süresiz. */
  expiresAt: string | null;
  expired: boolean;
  note: string | null;
  createdAt: string;
  createdBy: { id: string; fullName: string };
}

export interface RequestBlockListResponse {
  items: RequestBlockItem[];
  page: number;
  pageSize: number;
  total: number;
  /** Tenant'taki toplam satır (süresi dolmuşlar dahil) ve üst sınır — "x / 1000" göstergesi. */
  used: number;
  max: number;
}

export const requestBlockIdSchema = ulid;
