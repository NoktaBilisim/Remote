// Audit değer maskesi (mimari §3.3, G-15, AC-75). Tek dosya, iki liste:
// 1) izinli liste önce uygulanır (anahtar adı tam eşleşme → ilkel değer açık kalır; değer nesne/dizi ise
//    içi yine özyinelemeli taranır — S1-7),
// 2) kara liste anahtar adına regex ile uygulanır → "***". Değer tarafında tarama yok.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "perm_key",
  "permKey",
  "action",
  "entity",
  "level",
  "decision",
  "source",
  "direction",
  "result",
  "reason",
  // P8 session.updated: ticket numarası gizli değildir; `ticket` kara liste kalıbı (wsTicket) yüzünden açıkça izinli.
  "ticketNo",
  // P8b (mimari-e9 §12): bildirim kanalı, hız kovası ve anahtar türü (`key` kalıbına takılmasın).
  "channel",
  "bucket",
  "keyType",
  // P13a retention.run (mimari-p13 §2): yalnız satır sayısı; `token` kalıbına takılmasın.
  "resetTokens",
  // P16 retention.run dry modu (AC-240): `purgeCandidates` nesnesi yalnız sayılar; `candidate` (ICE) kalıbına takılmasın.
  "purgeCandidates",
  // P13b auth.superadmin_reset (mimari-p13 §7.7): boolean bayrak; `pass` kalıbına takılmasın (parola/hash hiç yazılmaz).
  "mustChangePassword",
  // S-P13b-3 WhatsApp servis anahtarı: yalnız var/yok ve değişti bayrakları (değer `apiKey: "***"`).
  "apiKeySet",
  "apiKeyChanged",
]);

const MASKED_KEY = /pass|secret|token|key|nonce|totp|code|ticket|credential|recovery|cookie|authorization|sdp|candidate|admit/i;

export const MASK = "***";

/** Telefon maskesi (§5.3): `+905321234567` → `+90*******4567` (ilk 3 + son 4). */
export function maskPhone(phone: string): string {
  if (phone.length <= 7) return MASK;
  return `${phone.slice(0, 3)}${"*".repeat(phone.length - 7)}${phone.slice(-4)}`;
}

/** P8c (K19): e-posta maskesi `m***@alan`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at <= 0 ? MASK : `${email.slice(0, 1)}***${email.slice(at)}`;
}

/** Müşteri alanlarının audit görünümü girdisi (eksik alan audit'e girmez). */
export interface CustomerAuditFields {
  name?: string;
  fileLabel?: string;
  status?: string;
  refPrefix?: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  note?: string | null;
}

/**
 * K19 (mimari-e10 §15.6): müşteri olaylarının TEK audit görünümü — izinli liste. Açık: ad (firma), etiket, durum,
 * ref ilk 4. Telefon `maskPhone`, e-posta `m***@alan`, yetkili kişi ve not yalnız `"<dolu>"`/`null` (boşaltma görünür).
 * Listede olmayan alan audit'e girmez.
 */
export function customerAuditView(c: CustomerAuditFields): JsonObject {
  const out: JsonObject = {};
  if (c.name !== undefined) out.name = c.name;
  if (c.fileLabel !== undefined) out.fileLabel = c.fileLabel;
  if (c.status !== undefined) out.status = c.status;
  if (c.refPrefix !== undefined) out.refPrefix = c.refPrefix.slice(0, 4);
  if (c.contactName !== undefined) out.contactName = c.contactName === null ? null : "<dolu>";
  if (c.phone !== undefined) out.phone = c.phone === null ? null : maskPhone(c.phone);
  if (c.email !== undefined) out.email = c.email === null ? null : maskEmail(c.email);
  if (c.note !== undefined) out.note = c.note === null ? null : "<dolu>";
  return out;
}

export function maskValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(maskValue);
  if (value === null || typeof value !== "object") return value;
  const out: JsonObject = {};
  for (const [key, inner] of Object.entries(value)) {
    if (ALLOWED_KEYS.has(key)) out[key] = maskValue(inner);
    else if (MASKED_KEY.test(key)) out[key] = MASK;
    else out[key] = maskValue(inner);
  }
  return out;
}
