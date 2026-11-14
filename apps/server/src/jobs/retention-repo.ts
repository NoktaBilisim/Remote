// Saklama işinin (P13a, mimari-p13 §2; AC-197, AC-198) veri erişimi. Oturum adımı tenant kapsamlıdır; audit / giriş
// oturumu / sıfırlama bağlantısı adımları firmadan bağımsızdır (global). Yetkiler: db-notlari "P13a" (app → session_files
// DELETE, session_consents UPDATE(ip, user_agent), audit_logs DELETE yalnız 730 günden eski — tetikleyici).
import type { Db } from "../lib/db.ts";
import { REQUEST_TX_OPTIONS } from "../lib/db.ts";

/** Anonimleştirilebilen (bitmiş) oturum durumları; CHECK `support_sessions_anonymized_chk` ile aynı küme. */
export const FINISHED_STATUSES = ["ENDED", "EXPIRED", "CANCELLED"] as const;

export interface SessionBatchResult {
  /** Partide seçilen aday sayısı (döngü sonu: < limit). */
  selected: number;
  sessions: number;
  consents: number;
  files: number;
}

/**
 * Tek parti, tek TX: aday id'ler (IX tenant_id, anonymized_at, created_at) → dosya meta satırları silinir → onay
 * kayıtlarının ip/user_agent'ı NULL → oturumun kişisel alanları NULL + anonymized_at. Son UPDATE `anonymized_at IS NULL`
 * koşullu (eşzamanlı ikinci tur 0 satır sayar). Onay kararı, seviye, kaynak, metin sürümü/özeti kalır (KVKK kanıtı).
 */
export async function anonymizeSessionBatch(db: Db, tenantId: string, cutoff: Date, now: Date, limit: number): Promise<SessionBatchResult> {
  return db.$transaction(async (tx) => {
    const rows = await tx.supportSession.findMany({
      where: { tenantId, anonymizedAt: null, createdAt: { lt: cutoff }, status: { in: [...FINISHED_STATUSES] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true },
    });
    if (rows.length === 0) return { selected: 0, sessions: 0, consents: 0, files: 0 };
    const ids = rows.map((r) => r.id);
    const files = await tx.sessionFile.deleteMany({ where: { tenantId, sessionId: { in: ids } } });
    const consents = await tx.sessionConsent.updateMany({
      where: { tenantId, sessionId: { in: ids }, OR: [{ ip: { not: null } }, { userAgent: { not: null } }] },
      data: { ip: null, userAgent: null },
    });
    const sessions = await tx.supportSession.updateMany({
      where: { tenantId, id: { in: ids }, anonymizedAt: null, status: { in: [...FINISHED_STATUSES] } },
      data: { customerName: null, customerEmail: null, note: null, guestNetKey: null, guestIpKey: null, anonymizedAt: now },
    });
    return { selected: rows.length, sessions: sessions.count, consents: consents.count, files: files.count };
  }, REQUEST_TX_OPTIONS);
}

/**
 * 730 günden eski audit kayıtları (parti). Kesme noktası hem iş saatine (`cutoff`) hem DB saatine göre alınır ve küçüğü
 * kullanılır: tetikleyici (audit_logs_retention_only_delete) 730 günden yeni TEK satırda tüm ifadeyi geri alır; iş saati
 * DB'den ileride olsa bile ifade tetikleyicinin sınırını aşmaz. UTC_TIMESTAMP ifade başı, tetikleyicinin SYSDATE'i satır
 * anı → tetikleyici sınırı her zaman bu sınırdan sonradır.
 */
export async function deleteOldAudit(db: Db, cutoff: Date, limit: number): Promise<number> {
  return db.$executeRaw`DELETE FROM audit_logs WHERE created_at < LEAST(${cutoff}, UTC_TIMESTAMP(3) - INTERVAL 730 DAY) ORDER BY created_at, id LIMIT ${limit}`;
}

/** Süresi ve (varsa) iptal zamanı `cutoff`'tan eski giriş oturumları: max(expires_at, revoked_at) + 7 g. */
export async function deleteOldAuthSessions(db: Db, cutoff: Date, limit: number): Promise<number> {
  const r = await db.authSession.deleteMany({ where: { expiresAt: { lt: cutoff }, OR: [{ revokedAt: null }, { revokedAt: { lt: cutoff } }] }, limit });
  return r.count;
}

/** Süresi `cutoff`'tan eski şifre sıfırlama bağlantıları (expires_at + 7 g). */
export async function deleteOldResetTokens(db: Db, cutoff: Date, limit: number): Promise<number> {
  const r = await db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: cutoff } }, limit });
  return r.count;
}
