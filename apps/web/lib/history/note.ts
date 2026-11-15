// Not/ticket formu saf mantığı (AC-63): değişen alanlar ve sözleşme şemasıyla alan bazlı doğrulama.
import { updateSessionInputSchema, type UpdateSessionInput } from "@remote/contracts/api/sessions";
import { t } from "@/lib/i18n";

export type Fields = { ticketNo: string; note: string };
export type Errors = Partial<Record<keyof Fields, string>>;

/** Yalnız değişen alanlar; boş metin → null (sunucu NULL yazar). Değişiklik yoksa null. */
export function buildPatch(initial: Fields, current: Fields): UpdateSessionInput | null {
  const out: UpdateSessionInput = {};
  if (current.ticketNo.trim() !== initial.ticketNo.trim()) out.ticketNo = current.ticketNo.trim() || null;
  if (current.note !== initial.note) out.note = current.note === "" ? null : current.note;
  return Object.keys(out).length ? out : null;
}

/** Sözleşme şemasıyla (contracts updateSessionInputSchema) alan bazlı Türkçe hata. */
export function validateNote(patch: UpdateSessionInput): Errors {
  const r = updateSessionInputSchema.safeParse(patch);
  if (r.success) return {};
  const e: Errors = {};
  for (const i of r.error.issues) {
    const k = i.path[0];
    if (k !== "ticketNo" && k !== "note") continue;
    if (e[k]) continue;
    e[k] = i.code === "too_big" ? t(k === "ticketNo" ? "h.n.v.ticketLong" : "h.n.v.noteLong") : t("h.n.v.chars");
  }
  return e;
}
