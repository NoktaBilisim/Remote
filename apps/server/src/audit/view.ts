// Audit okuma görünümü (P11; AC-76, G-15; güvenlik koşulu B-P10 / gereksinimler-sonra-acik "P11 audit ekranında SMTP").
// Yazımda maskelenmiş olsa da değerler okumada YENİDEN maskelenir (savunma derinliği: eski/elle yazılmış satır).
// Dış gönderim kayıtlarında (e-posta, test uçları, SMTP) yalnız izinli alanlar döner; `reason` yalnız sınıf belirteci
// (`[a-z_]{1,40}`) olarak — ham hata metni, yanıt kodu, banner hiçbir anahtarla dönmez.
import type { AuditJson } from "@remote/contracts/api/audit";
import { maskValue, type JsonValue } from "./mask.ts";

/** `mail.*`, `session.email`, `settings.*.test`, adında `smtp` geçen eylemler. */
export function isOutboundAction(action: string): boolean {
  return action.startsWith("mail.") || action === "session.email" || /^settings\..+\.test$/.test(action) || /smtp/i.test(action);
}

/** Dış gönderim kayıtlarında açık kalan alanlar (ilkel değerler; iç içe nesne/dizi düşer). */
const OUTBOUND_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "recipient",
  "subject",
  "result",
  "reason",
  "channel",
  "latencyMs",
  "host",
  "port",
  "database",
  "user",
]);
const REASON_CLASS = /^[a-z_]{1,40}$/;

function projectOutbound(v: JsonValue): AuditJson {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const out: { [k: string]: AuditJson } = {};
  for (const [k, inner] of Object.entries(v)) {
    if (!OUTBOUND_KEYS.has(k)) continue;
    if (inner !== null && typeof inner === "object") continue;
    if (k === "reason") out[k] = typeof inner === "string" && REASON_CLASS.test(inner) ? inner : "other";
    else out[k] = typeof inner === "string" ? inner.slice(0, 254) : inner;
  }
  return out;
}

/** DB JSON → yanıt değeri: maske (her zaman) + dış gönderimde izinli alan izdüşümü. */
export function auditValueView(action: string, raw: unknown): AuditJson | null {
  if (raw === null || raw === undefined) return null;
  const masked = maskValue(raw as JsonValue);
  return isOutboundAction(action) ? projectOutbound(masked) : (masked as AuditJson);
}
