// P21 portal kişisel verisinin silme yolları (mimari-p21 §3.4, K-P21-9; db-notlari "P21" silme sırası oturum → hesap):
//  - müşteri anonimleştirme TX'inde `deletePortalOfCustomer` (hesaplar + oturumlar),
//  - saklama işi: süresi dolan/iptal edilen oturum + 7 g (global) ve pasif hesap `retention_days` sonra (firma başına; SYSTEM audit).
// Firma silme `jobs/tenant-purge-repo.ts` SESSIONS adımında (K1). Silme her modda yapılır (giriş oturumu kalıbı; P16 dry modu
// yalnız anonimleştirilmiş destek verisinin kalıcı silinmesini kapsar).
import { PORTAL_AUDIT, PORTAL_USERS_ENTITY } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

const DAY_MS = 86_400_000;
const SESSION_GRACE_DAYS = 7;
const BATCH = 500;

/** Anonimleştirme TX'inde: müşterinin tüm portal oturumları sonra hesapları silinir. Dönen: silinen hesap sayısı. */
export async function deletePortalOfCustomer(tx: Prisma.TransactionClient, tenantId: string, customerId: string): Promise<number> {
  const users = await tx.portalUser.findMany({ where: { tenantId, customerId }, select: { id: true } });
  if (users.length === 0) return 0;
  const ids = users.map((u) => u.id);
  await tx.portalSession.deleteMany({ where: { tenantId, portalUserId: { in: ids } } });
  const r = await tx.portalUser.deleteMany({ where: { tenantId, customerId, id: { in: ids } } });
  return r.count;
}

/** Global: `expires_at < now − 7 g` veya `revoked_at < now − 7 g` oturumları (partili). */
export async function deleteOldPortalSessions(db: Db, now: Date, limit: number): Promise<number> {
  const cutoff = new Date(now.getTime() - SESSION_GRACE_DAYS * DAY_MS);
  const rows = await db.portalSession.findMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    select: { id: true },
    take: limit,
  });
  if (rows.length === 0) return 0;
  const r = await db.portalSession.deleteMany({ where: { id: { in: rows.map((x) => x.id) } } });
  return r.count;
}

/**
 * Firma başına: PASSIVE ve `passive_at < now − retention_days` hesaplar → TX [oturumlar → hesap → audit
 * `portal.account_deleted {reason: retention}` (SYSTEM; e-posta yazılmaz)]. Dönen: silinen hesap sayısı.
 */
export async function purgePassivePortalAccounts(
  db: Db,
  ctx: AuditContext,
  t: { tenantId: string; retentionDays: number },
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - t.retentionDays * DAY_MS);
  let total = 0;
  for (;;) {
    const rows = await db.portalUser.findMany({
      where: { tenantId: t.tenantId, status: "PASSIVE", passiveAt: { lt: cutoff } },
      select: { id: true },
      take: BATCH,
    });
    let deleted = 0;
    for (const { id } of rows) {
      const done = await db.$transaction(async (tx) => {
        await tx.portalSession.deleteMany({ where: { portalUserId: id, tenantId: t.tenantId } });
        const r = await tx.portalUser.deleteMany({ where: { id, tenantId: t.tenantId, status: "PASSIVE", passiveAt: { lt: cutoff } } });
        if (r.count === 0) return false;
        await writeAudit(tx, ctx, {
          tenantId: t.tenantId,
          username: "system",
          action: PORTAL_AUDIT.ACCOUNT_DELETED,
          entity: PORTAL_USERS_ENTITY,
          entityId: id,
          result: "success",
          newValue: { reason: "retention" },
        });
        return true;
      });
      if (done) deleted++;
    }
    total += deleted;
    if (rows.length < BATCH || deleted === 0) return total;
  }
}

/** `rs_portal_sessions_active` göstergesi (saklama işinde güncellenir). */
export function countActivePortalSessions(db: Db, now: Date): Promise<number> {
  return db.portalSession.count({ where: { revokedAt: null, expiresAt: { gt: now } } });
}
