/*
 * P15 (AC-235) talep engelleri — formun saf mantığı (bileşenden ayrı, birim testli). Tek kaynak contracts
 * `api/request-blocks` (şema, süre seçenekleri, sınırlar, mesajlar); burada şema tanımı yok.
 */
import {
  REQUEST_BLOCK_DURATION_PRESETS,
  REQUEST_BLOCK_EXISTS_MESSAGE,
  REQUEST_BLOCK_NOTE_MAX,
  createRequestBlockInputSchema,
  type CreateRequestBlockInput,
  type RequestBlockKind,
} from "@remote/contracts/api/request-blocks";
import { ApiError, NetworkError } from "@/lib/api";
import { t } from "@/lib/i18n";

export { REQUEST_BLOCK_NOTE_MAX };

/** Seçim değeri: saat (dize) ya da "none" (süresiz). */
export type DurationValue = string;
const DURATION_NONE = "none";

/** Süre seçenekleri (contracts hazır listesi): 1 sa, 1 gün, 7 gün, 30 gün, süresiz. */
export function durationOptions(): { value: DurationValue; label: string }[] {
  return REQUEST_BLOCK_DURATION_PRESETS.map((h) => ({ value: h === null ? DURATION_NONE : String(h), label: durationLabel(h) }));
}
function durationLabel(h: number | null): string {
  if (h === null) return t("bl.dur.none");
  if (h < 24) return t("bl.dur.hours", { n: h });
  return t("bl.dur.days", { n: h / 24 });
}
const hoursOf = (v: DurationValue): number | null => (v === DURATION_NONE ? null : Number(v));

export interface BlockDraft {
  cidr: string;
  duration: DurationValue;
  note: string;
}
export const emptyBlockDraft = (): BlockDraft => ({ cidr: "", duration: "24", note: "" });
export type BlockErrors = Partial<Record<"cidr" | "note" | "durationHours", string>>;

function issuesToErrors(issues: { path: PropertyKey[]; message: string }[]): BlockErrors {
  const out: BlockErrors = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? "");
    if ((k === "cidr" || k === "note" || k === "durationHours") && !out[k]) out[k] = i.message;
  }
  return out;
}

/** "Engel ekle" (elle IP/önek): gövde ya da alan hataları (istek atılmaz). Boş hedef → "Zorunlu alan". */
export function buildCidrBlock(d: BlockDraft): { body?: CreateRequestBlockInput; errors: BlockErrors } {
  if (d.cidr.trim() === "") return { errors: { cidr: t("v.required") } };
  const input = { source: "CIDR" as const, cidr: d.cidr, durationHours: hoursOf(d.duration), note: d.note };
  const p = createRequestBlockInputSchema.safeParse(input);
  if (!p.success) return { errors: issuesToErrors(p.error.issues) };
  return { body: input, errors: {} };
}

/** Talepler ekranı kısayolu: hedef IP veya cihaz; IP/cihaz anahtarı panelde değil, sunucuda talepten alınır. */
export function buildRequestBlock(
  requestId: string,
  target: RequestBlockKind,
  d: Pick<BlockDraft, "duration" | "note">,
): { body?: CreateRequestBlockInput; errors: BlockErrors } {
  const input = { source: "REQUEST" as const, requestId, target, durationHours: hoursOf(d.duration), note: d.note };
  const p = createRequestBlockInputSchema.safeParse(input);
  if (!p.success) return { errors: issuesToErrors(p.error.issues) };
  return { body: input, errors: {} };
}

/** Sunucu hatası → alan hataları (400 `fields`, 409 "zaten engelli" → hedef alanı) ya da form üstü metin (sınır, kaynak yok…). */
export function blockErrorOf(e: unknown): { fields: BlockErrors; message?: string } {
  if (e instanceof NetworkError) return { fields: {}, message: t("err.network") };
  if (e instanceof ApiError) {
    if (e.status === 400 && e.fields && Object.keys(e.fields).length) {
      const fields: BlockErrors = {};
      for (const [k, v] of Object.entries(e.fields)) if (k === "cidr" || k === "note" || k === "durationHours") fields[k] = v;
      return Object.keys(fields).length ? { fields } : { fields: {}, message: Object.values(e.fields)[0] };
    }
    if (e.status === 409 && e.message === REQUEST_BLOCK_EXISTS_MESSAGE) return { fields: { cidr: e.message } };
    return { fields: {}, message: e.message || t("err.generic") };
  }
  return { fields: {}, message: t("err.generic") };
}

/** Liste satırının hedef metni: IP engelinde CIDR (`/32`, `/128` tek adres gösterilir), cihazda parmak izi. */
export function blockTarget(b: { kind: RequestBlockKind; cidr: string | null; deviceFingerprint: string | null }): string {
  if (b.kind === "DEVICE") return t("bl.device", { fp: b.deviceFingerprint ?? "—" });
  const c = b.cidr ?? "—";
  return /\/(32|128)$/.test(c) ? c.replace(/\/(32|128)$/, "") : c;
}
