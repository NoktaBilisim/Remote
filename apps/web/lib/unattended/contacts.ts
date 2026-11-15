/*
 * Müşteri gözetimsiz bildirim adresleri formu (AC-296, 337): satırlar ↔ PUT gövdesi, istemci doğrulaması (paylaşılan
 * `putNotifyContactsInputSchema`) ve sunucu alan hatalarının (`fields["items.<i>.email"]`) satır anahtarına eşlenmesi.
 */
import { NOTIFY_CONTACTS_MAX, putNotifyContactsInputSchema, type NotifyContact, type PutNotifyContactsInput } from "./contract";

export interface ContactRow {
  /** Yalnız React anahtarı (sunucuya gitmez). */
  key: number;
  email: string;
  phone: string;
}

export type ContactErrors = Record<string, string>;

let seq = 0;
export const newRow = (c?: NotifyContact): ContactRow => ({ key: ++seq, email: c?.email ?? "", phone: c?.phone ?? "" });
export const rowsOf = (items: readonly NotifyContact[]): ContactRow[] => items.map(newRow);
export const canAddRow = (rows: readonly ContactRow[]): boolean => rows.length < NOTIFY_CONTACTS_MAX;

/** Karşılaştırma imzası (kirli mi?) — boş telefon ile null aynı. */
export const signature = (rows: readonly Pick<ContactRow, "email" | "phone">[]): string =>
  JSON.stringify(rows.map((r) => [r.email.trim(), r.phone.trim()]));

export function bodyOf(rows: readonly ContactRow[]): PutNotifyContactsInput {
  return { items: rows.map((r) => ({ email: r.email.trim(), ...(r.phone.trim() ? { phone: r.phone.trim() } : {}) })) };
}

/** İstemci doğrulaması: geçerliyse gövde, değilse `items.<i>.<alan>` → mesaj. */
export function validateContacts(rows: readonly ContactRow[]): { body?: PutNotifyContactsInput; errors: ContactErrors } {
  const body = bodyOf(rows);
  const p = putNotifyContactsInputSchema.safeParse(body);
  if (p.success) return { body, errors: {} };
  const errors: ContactErrors = {};
  for (const issue of p.error.issues) {
    const key = issue.path.map(String).join(".");
    errors[key] ??= issue.message;
  }
  return { errors };
}

/** Satır alanı hata anahtarı. */
export const fieldKey = (i: number, field: "email" | "phone"): string => `items.${i}.${field}`;
