// Tenant aydınlatma metni düzenleme (P11; AC-29, AC-127, G-24). Her kayıt yeni sürüm (eski sürümler değişmez —
// body/sha256/version DB'de güncellenemez); audit'e yalnız `{version, sha256}` (gövde yazılmaz).
import {
  CONSENT_VERSIONS_MAX,
  type ConsentTextSaveResponse,
  type ConsentTextSettings,
  type ConsentTextVersion,
} from "@remote/contracts/api/system-settings";
import { SYSTEM_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Db } from "../lib/db.ts";
import { publishConsentText } from "../public/consent.ts";

type Row = { id: string; version: number; sha256: string; createdAt: Date; creator: { fullName: string } | null };
const toVersion = (r: Row): ConsentTextVersion => ({
  id: r.id,
  version: r.version,
  sha256: r.sha256,
  createdAt: r.createdAt.toISOString(),
  createdByName: r.creator?.fullName ?? null,
});

export async function getConsentSettings(db: Db, tenantId: string): Promise<ConsentTextSettings> {
  const select = { id: true, version: true, sha256: true, createdAt: true, creator: { select: { fullName: true } } } as const;
  const [current, versions] = await Promise.all([
    db.consentText.findFirst({ where: { tenantId, isCurrent: true }, select: { ...select, body: true } }),
    db.consentText.findMany({ where: { tenantId }, orderBy: { version: "desc" }, take: CONSENT_VERSIONS_MAX, select }),
  ]);
  return { current: current ? { ...toVersion(current), body: current.body } : null, versions: versions.map(toVersion) };
}

/** Gövde güncel sürümle aynıysa yeni sürüm yok, audit yok (`changed:false`; çift gönderim güvenli). */
export async function saveConsentText(
  db: Db,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  body: string,
): Promise<ConsentTextSaveResponse> {
  const changed = await db.$transaction(async (tx) => {
    const out = await publishConsentText(tx, tenantId, body, auth.user.id);
    if (!out) return false;
    await writeAudit(tx, ctx, {
      tenantId,
      userId: auth.user.id,
      username: auth.user.email,
      action: SYSTEM_AUDIT.CONSENT_TEXT_UPDATED,
      entity: "consent_texts",
      entityId: out.id,
      result: "success",
      ...(out.previous ? { oldValue: { version: out.previous.version, sha256: out.previous.sha256 } } : {}),
      newValue: { version: out.version, sha256: out.sha256 },
    });
    return true;
  });
  return { ...(await getConsentSettings(db, tenantId)), changed };
}
