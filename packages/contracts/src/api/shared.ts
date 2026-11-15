// İç modül (PT-K1, mimari-temizlik §3.7-1): `customers.ts`, `requests.ts` ve `sessions.ts`'in ortak kullandığı öğeler.
// Burada tanımlanır ki üç modül birbirini import etmesin (döngü yok). package.json `exports`'una EKLENMEZ; tüketiciler
// bu adları bugünkü yollarından (`@remote/contracts/api/{customers,requests,sessions}`) almaya devam eder.

// ---------------------------------------------------------------------------------------------------------------
// customers.ts'ten (P8c)
// ---------------------------------------------------------------------------------------------------------------

export const CUSTOMER_STATUSES = ["ACTIVE", "PASSIVE"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Talep/oturum/seçim kutusundaki müşteri firma özeti. */
export interface CustomerFirmRef {
  id: string;
  name: string;
  status: CustomerStatus;
}

// ---------------------------------------------------------------------------------------------------------------
// requests.ts'ten (P8b, P18)
// ---------------------------------------------------------------------------------------------------------------

// P18 (mimari-e11 §8b.3; AC-257): öncelik ve kuyruk sırası.
export const REQUEST_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];
/** SLA hedefi sınırları (dakika; DB CHECK 5..1440 ile aynı). */
export const SLA_MINUTES_MIN = 5;
export const SLA_MINUTES_MAX = 1440;

/** Telefon → E.164 (`+905xxxxxxxxx`) ya da null (AC-134). Boşluk, `-`, `(`, `)` yok sayılır. */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s\-()]/g, "");
  const tr = /^(?:\+90|0)?(5\d{9})$/.exec(s);
  if (tr?.[1]) return `+90${tr[1]}`;
  const intl = /^\+?([1-9]\d{7,14})$/.exec(s);
  return intl?.[1] ? `+${intl[1]}` : null;
}

// ---------------------------------------------------------------------------------------------------------------
// sessions.ts'ten (P4)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Misafir adında yasak karakterler (S-P4-3, S-P4-T2-1): Unicode kategori tabanlı — Cc (C0/C1 kontrol), Cf (biçim:
 * U+00AD, U+061C, U+200B–200F, bidi U+202A–202E/2066–2069, U+2060–2064, U+FEFF, U+FFF9–FFFB, etiketler U+E0000–E007F),
 * Zl/Zp (U+2028/2029) + U+034F (CGJ, Mn) ve U+180E. Ad teknisyen ekranında ve audit'te görünür; yön/görünmez
 * karakterle sahte ad üretimi engellenir. ZWJ'li emoji desteklenmez (bilinçli).
 */
export const UNSAFE_NAME_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034F\u180E]/u;
