/*
 * Müşteri formu (AC-167, AC-195): istemci doğrulaması contracts zod şemalarıyla (sunucuyla aynı kural).
 * Oluşturmada boş isteğe bağlı alan gönderilmez; düzenlemede yalnız değişen alanlar gider, boşaltılan alan `null` olur.
 */
import type { z } from "zod";
import { createCustomerInputSchema, updateCustomerInputSchema, type CreateCustomerInput, type CustomerDetail, type UpdateCustomerInput } from "./contract";

export const CUSTOMER_FIELDS = ["name", "fileLabel", "contactName", "phone", "email", "note"] as const;
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];
export type CustomerDraft = Record<CustomerField, string>;
export type CustomerErrors = Partial<Record<CustomerField, string>>;

export const emptyDraft = (): CustomerDraft => ({ name: "", fileLabel: "", contactName: "", phone: "", email: "", note: "" });

export function draftOf(c: CustomerDetail): CustomerDraft {
  return {
    name: c.name,
    fileLabel: c.fileLabel,
    contactName: c.contactName ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    note: c.note ?? "",
  };
}

/** Zod hatası → alan başına ilk mesaj (bilinmeyen yol yok sayılır). */
export function errorsOf(error: z.ZodError): CustomerErrors {
  const out: CustomerErrors = {};
  for (const i of error.issues) {
    const k = i.path[0];
    if (typeof k === "string" && (CUSTOMER_FIELDS as readonly string[]).includes(k) && !out[k as CustomerField]) out[k as CustomerField] = i.message;
  }
  return out;
}

/** Sunucu `fields` (400/409) → form alanları; tanınmayan anahtarlar `rest`te kalır (form üstü hata). */
export function serverFieldErrors(fields: Record<string, string> | undefined): { errors: CustomerErrors; rest: string[] } {
  const errors: CustomerErrors = {};
  const rest: string[] = [];
  for (const [k, v] of Object.entries(fields ?? {})) {
    if ((CUSTOMER_FIELDS as readonly string[]).includes(k)) errors[k as CustomerField] = v;
    else rest.push(v);
  }
  return { errors, rest };
}

export type FormResult<T> = { ok: true; body: T } | { ok: false; errors: CustomerErrors };

export function buildCreate(d: CustomerDraft): FormResult<CreateCustomerInput> {
  const body: CreateCustomerInput = { name: d.name };
  if (d.fileLabel.trim()) body.fileLabel = d.fileLabel.trim();
  if (d.contactName.trim()) body.contactName = d.contactName;
  if (d.phone.trim()) body.phone = d.phone;
  if (d.email.trim()) body.email = d.email;
  if (d.note.trim()) body.note = d.note;
  const r = createCustomerInputSchema.safeParse(body);
  return r.success ? { ok: true, body } : { ok: false, errors: errorsOf(r.error) };
}

/** Değişen alanlar; hiçbiri değişmediyse `body` boş nesne (çağıran istek atmaz). Boşaltılan kişisel alan → `null`. */
export function buildPatch(d: CustomerDraft, original: CustomerDetail): FormResult<UpdateCustomerInput> {
  const before = draftOf(original);
  const body: UpdateCustomerInput = {};
  for (const k of CUSTOMER_FIELDS) {
    if (d[k] === before[k]) continue;
    if (k === "name" || k === "fileLabel") body[k] = d[k].trim();
    else body[k] = d[k].trim() === "" ? null : d[k];
  }
  if (Object.keys(body).length === 0) return { ok: true, body };
  const r = updateCustomerInputSchema.safeParse(body);
  return r.success ? { ok: true, body } : { ok: false, errors: errorsOf(r.error) };
}

export const isDirty = (d: CustomerDraft, base: CustomerDraft) => CUSTOMER_FIELDS.some((k) => d[k] !== base[k]);

/** Kod noktası sayısı (not sayacı sunucu kuralıyla aynı birimde). */
export const codePointLength = (s: string) => [...s].length;
