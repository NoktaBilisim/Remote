// P27 gözetimsiz erişim gece temizliği (mimari-p27 §3.6; AC-275 temizlik). Saklama işinin global adımlarında koşar
// (jobs/retention.ts — P27a `trustedDevices` kalıbı; ayrı zamanlayıcı satırı yerine, sapma implementation.md P27-K4).
//  - Kayıt kodu: kullanılmış ya da süresi dolmuş + 7 g → DELETE.
//  - Cihaz: `revoked_at < now − 30 g` ve kendisine bağlı oturum (anonimleştirme `device_id`'yi NULL'lar) ya da kayıt kodu
//    yoksa DELETE (grant'lar iptal TX'inde zaten silindi; savunma olarak aynı partide). Parti ≤ 500.
import { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { TX_OPTIONS } from "../lib/db.ts";

const DAY_MS = 86_400_000;
const CODE_GRACE_DAYS = 7;
const DEVICE_REVOKED_DAYS = 30;
export const UNATTENDED_CLEANUP_BATCH = 500;

/** Kullanılmış/süresi dolmuş kodlar (+7 g). Dönen: silinen satır. */
export async function deleteOldRegistrationCodes(db: Db, now: Date, limit: number): Promise<number> {
  const cut = new Date(now.getTime() - CODE_GRACE_DAYS * DAY_MS);
  return db.$executeRaw`DELETE FROM unattended_registration_codes
    WHERE (used_at < ${cut}) OR (used_at IS NULL AND expires_at < ${cut})
    LIMIT ${limit}`;
}

/** 30 g önce iptal edilmiş, oturumu ve kodu kalmamış cihazlar (tek TX: grant'lar → cihazlar). */
export async function deleteRevokedDevices(db: Db, now: Date, limit: number): Promise<number> {
  const cut = new Date(now.getTime() - DEVICE_REVOKED_DAYS * DAY_MS);
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT d.id FROM unattended_devices d
      WHERE d.revoked_at < ${cut}
        AND NOT EXISTS (SELECT 1 FROM support_sessions s WHERE s.device_id = d.id AND s.tenant_id = d.tenant_id)
        AND NOT EXISTS (SELECT 1 FROM unattended_registration_codes c WHERE c.device_id = d.id)
      ORDER BY d.revoked_at LIMIT ${limit}`;
    if (rows.length === 0) return 0;
    const ids = Prisma.join(rows.map((r) => r.id));
    await tx.$executeRaw`DELETE FROM unattended_device_grants WHERE device_id IN (${ids})`;
    return tx.$executeRaw`DELETE FROM unattended_devices WHERE id IN (${ids}) AND revoked_at < ${cut}`;
  }, TX_OPTIONS);
}
