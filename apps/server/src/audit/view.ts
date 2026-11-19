// Audit okuma görünümü (P11; AC-76, G-15; güvenlik koşulu B-P10 / gereksinimler-sonra-acik "P11 audit ekranında SMTP").
// Yazımda maskelenmiş olsa da değerler okumada YENİDEN maskelenir (savunma derinliği: eski/elle yazılmış satır).
// Dış gönderim kayıtlarında (e-posta, test uçları, SMTP) yalnız izinli alanlar döner; `reason` yalnız sınıf belirteci
// (`[a-z_]{1,40}`) olarak — ham hata metni, yanıt kodu, banner hiçbir anahtarla dönmez.
// P16 (AC-241, S16-1, ADR-0030 m.4): kimlik maskesi FAIL-CLOSED — liste, CSV ve oturum zaman çizelgesi bu dosyadaki
// `identityView`/`actorLabelOf` ile çalışır (tek görünüm kuralı).
import type { AuditJson } from "@remote/contracts/api/audit";
import {
  AUDIT_ENTITY,
  AUDIT_IDENTITY_KEYS,
  PORTAL_USERS_ENTITY,
  deletedTenantLabel,
  deletedUserLabel,
  maskIdentity,
} from "@remote/contracts/audit";
import { MASK, maskValue, type JsonValue } from "./mask.ts";

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

/** `AUDIT_IDENTITY_KEYS` anahtarlarının değeri (iç içe dahil) `"***"`; null kalır. */
function maskIdentityKeys(v: JsonValue): JsonValue {
  if (Array.isArray(v)) return v.map(maskIdentityKeys);
  if (v === null || typeof v !== "object") return v;
  const out: { [k: string]: JsonValue } = {};
  for (const [k, inner] of Object.entries(v))
    out[k] = AUDIT_IDENTITY_KEYS.has(k) ? (inner === null ? null : MASK) : maskIdentityKeys(inner);
  return out;
}

/** D-P28u-K1-1: izinsiz bağlantı gerekçesinin audit anahtarı (`unattended.connect.newValue`). */
export const SILENT_REASON_KEY = "silentReason";

/** Değer üst düzeyde gerekçe taşıyor mu (okuma tarafında oturum sorgusu yalnız bunlar için). */
export const carriesSilentReason = (raw: unknown): boolean =>
  raw !== null && typeof raw === "object" && !Array.isArray(raw) && SILENT_REASON_KEY in raw;

/** Gerekçe anahtarı (iç içe dahil) `"***"`; null kalır. */
function maskSilentReason(v: JsonValue): JsonValue {
  if (Array.isArray(v)) return v.map(maskSilentReason);
  if (v === null || typeof v !== "object") return v;
  const out: { [k: string]: JsonValue } = {};
  for (const [k, inner] of Object.entries(v)) out[k] = k === SILENT_REASON_KEY ? (inner === null ? null : MASK) : maskSilentReason(inner);
  return out;
}

/**
 * Gerekçe görünür mü (D-P28u-K1-1, T6): çağıranda `session_history.view` ∧ satır bir oturuma ait ∧ o oturum var ve
 * anonimleştirilmemiş (`visible` = `reasonVisibleSessions`). Aksi her durumda maskeli (fail-closed).
 */
export function silentReasonVisible(
  r: { entity: string; entityId: string | null; tenantId: string | null },
  canViewHistory: boolean,
  visible: ReadonlySet<string>,
): boolean {
  return canViewHistory && r.entity === "support_sessions" && r.entityId !== null && visible.has(`${r.tenantId}:${r.entityId}`);
}

/**
 * DB JSON → yanıt değeri: maske (her zaman) + `identityMasked` ise kimlik anahtarları + `hideSilentReason` ise izinsiz
 * bağlantı gerekçesi + dış gönderimde izinli alan izdüşümü (izdüşüm maskeden SONRA: `recipient` maskeli kalır).
 */
export function auditValueView(action: string, raw: unknown, identityMasked = false, hideSilentReason = true): AuditJson | null {
  if (raw === null || raw === undefined) return null;
  const base = maskValue(raw as JsonValue);
  const ident = identityMasked ? maskIdentityKeys(base) : base;
  const masked = hideSilentReason ? maskSilentReason(ident) : ident;
  return isOutboundAction(action) ? projectOutbound(masked) : (masked as AuditJson);
}

/** Kimlik kararı için kullanıcı bilgisi (satırı olmayan id haritada yoktur). */
interface IdentityUser {
  fullName: string;
  status: string;
}

/** Kullanıcı satırı yok ya da mezar taşı → silinmiş sayılır (fail-closed). */
const userGone = (id: string, users: ReadonlyMap<string, IdentityUser>): boolean => {
  const u = users.get(id);
  return !u || u.status === "DELETED";
};

/** Aktör etiketi: canlı kullanıcıda ad, silinmiş/yok ise "Silinmiş kullanıcı #XXXXXX". */
export function actorLabelOf(id: string, users: ReadonlyMap<string, IdentityUser>): string {
  const u = users.get(id);
  return u && u.status !== "DELETED" ? u.fullName : deletedUserLabel(id);
}

interface IdentityRow {
  userId: string | null;
  username: string | null;
  entity: string;
  entityId: string | null;
  tenantId: string | null;
  /** Firma satırı varsa adı; yoksa null. */
  tenantName: string | null;
}

interface IdentityResult {
  masked: boolean;
  username: string | null;
  actorLabel: string | null;
  tenantLabel: string | null;
}

/**
 * ADR-0030 m.4: satır şu durumlardan birinde kimlik maskelidir — aktör kullanıcısı yok/DELETED; `entity = users` hedefi
 * yok/DELETED; `tenant_id` dolu ama firma satırı yok. Maskeli satırda `username` → `maskIdentity`.
 * P21 (K-P21-14, r2 S-P21-2): `entity = portal_users` ve `entity_id` portal hesabı artık yok (`portalUsers` = sayfada var
 * olan hesaplar) → maskeli. Olmayan hesap denemesi (`entity_id` NULL) maskelenmez. `portalUsers` verilmezse fail-closed.
 */
export function identityView(
  r: IdentityRow,
  users: ReadonlyMap<string, IdentityUser>,
  portalUsers: ReadonlySet<string> = new Set(),
): IdentityResult {
  const tenantGone = r.tenantId !== null && r.tenantName === null;
  const masked =
    (r.userId !== null && userGone(r.userId, users)) ||
    (r.entity === AUDIT_ENTITY.USERS && r.entityId !== null && userGone(r.entityId, users)) ||
    (r.entity === PORTAL_USERS_ENTITY && r.entityId !== null && !portalUsers.has(r.entityId)) ||
    tenantGone;
  return {
    masked,
    username: masked && r.username !== null ? maskIdentity(r.username) : r.username,
    actorLabel: r.userId ? actorLabelOf(r.userId, users) : null,
    tenantLabel: r.tenantId ? (r.tenantName ?? deletedTenantLabel(r.tenantId)) : null,
  };
}

/** P21: sayfadaki portal hesabı kimlikleri (`entity = portal_users` satırlarının `entity_id`'si). */
export const identityPortalUserIds = (rows: readonly { entity: string; entityId: string | null }[]): string[] => [
  ...new Set(rows.flatMap((r) => (r.entity === PORTAL_USERS_ENTITY && r.entityId ? [r.entityId] : []))),
];

/** Sayfadaki kullanıcı kimlikleri: `user_id` ∪ `entity = users` satırlarının `entity_id`'si. */
export const identityUserIds = (rows: readonly { userId: string | null; entity: string; entityId: string | null }[]): string[] =>
  rows.flatMap((r) => [...(r.userId ? [r.userId] : []), ...(r.entity === AUDIT_ENTITY.USERS && r.entityId ? [r.entityId] : [])]);
