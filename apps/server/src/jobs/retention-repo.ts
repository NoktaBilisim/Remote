// Saklama işinin (P13a, mimari-p13 §2; AC-197, AC-198) veri erişimi. Oturum adımı tenant kapsamlıdır; audit / giriş
// oturumu / sıfırlama bağlantısı adımları firmadan bağımsızdır (global). Yetkiler: db-notlari "P13a" (app → session_files
// DELETE, session_consents UPDATE(ip, user_agent), audit_logs DELETE yalnız 730 günden eski — tetikleyici).
import { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { REQUEST_TX_OPTIONS, TX_OPTIONS } from "../lib/db.ts";
import { lockTenantRecording } from "../rec/repo.ts";
import type { Tx } from "../rec/types.ts";

/** Anonimleştirilebilen (bitmiş) oturum durumları; CHECK `support_sessions_anonymized_chk` ile aynı küme. */
const FINISHED_STATUSES = ["ENDED", "EXPIRED", "CANCELLED"] as const;

interface SessionBatchResult {
  /** Partide seçilen aday sayısı (döngü sonu: < limit). */
  selected: number;
  sessions: number;
  consents: number;
  files: number;
  /** P28b: aynı TX'te silinen `session_stored_files` satırları. */
  storedFiles: number;
  /** P28e (§3.4, AC-386): aynı TX'te silinen kayıtlar (parçalarıyla; satır kalmaz). */
  recordings: number;
  /** P22 (mimari-p22 §3.3, AC-264): aynı TX'te silinen oturum sohbeti satırları. */
  messages: number;
  /**
   * P22 (r2 §15.3): aday listesi mesaj bütçesiyle kısaltıldı ya da parti doluydu → firmada aday kalmış olabilir; döngü
   * sürer (`selected < limit` tek başına yetmez: kısaltılmış parti hep küçüktür).
   */
  more: boolean;
}

/** P22 (r2 §15.3, S-P22-3): bir anonimleştirme TX'inde silinecek oturum sohbeti satırı üst sınırı. */
export const SESSION_MSG_DELETE_BUDGET = 20_000;

/**
 * Aday oturumları (`created_at` sırasıyla) mesaj toplamı `budget`'ı aşmayacak şekilde kısaltır; ilk oturum her zaman
 * alınır (tek oturum tasarım tavanı ≤ ~10.000 satır). Saf fonksiyon.
 */
export function trimByMessageBudget(ids: readonly string[], counts: ReadonlyMap<string, number>, budget: number): string[] {
  const out: string[] = [];
  let total = 0;
  for (const id of ids) {
    const n = counts.get(id) ?? 0;
    if (out.length > 0 && total + n > budget) break;
    out.push(id);
    total += n;
  }
  return out;
}

/** Aday oturumların sohbet satırı sayıları (IX(session_id, tenant_id, created_at); TX'ten önce, r2 §15.3). */
async function messageCounts(db: Db, tenantId: string, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db.$queryRaw<{ session_id: string; n: bigint | number }[]>`SELECT session_id, COUNT(*) AS n
    FROM session_messages WHERE tenant_id = ${tenantId} AND session_id IN (${Prisma.join(ids)}) GROUP BY session_id`;
  return new Map(rows.map((r) => [r.session_id, Number(r.n)]));
}

/**
 * P28e (§3.4, §5.5): oturumların kayıtları — parçalar → kayıtlar DELETE (disk `beforeTx`'te silindi). Kilit tek yardımcıyla
 * (`tenants` → kayıtlar artan id); kayıt yoksa tenant kilidi alınmaz. Dönen: silinen kayıt sayısı.
 */
async function deleteSessionRecordings(tx: Tx, tenantId: string, sessionIds: string[]): Promise<number> {
  const recs = await tx.sessionRecording.findMany({ where: { tenantId, sessionId: { in: sessionIds } }, select: { id: true } });
  if (recs.length === 0) return 0;
  const ids = (
    await lockTenantRecording(
      tx,
      tenantId,
      recs.map((r) => r.id),
    )
  ).map((r) => r.id);
  if (ids.length === 0) return 0;
  await tx.sessionRecordingPart.deleteMany({ where: { tenantId, recordingId: { in: ids } } });
  return (await tx.sessionRecording.deleteMany({ where: { tenantId, id: { in: ids } } })).count;
}

/**
 * Tek parti, tek TX: aday id'ler (IX tenant_id, anonymized_at, created_at) → dosya meta satırları silinir → onay
 * kayıtlarının ip/user_agent'ı NULL → oturumun kişisel alanları NULL + anonymized_at → oturum sohbeti satırları silinir.
 * Son UPDATE `anonymized_at IS NULL` koşullu (eşzamanlı ikinci tur 0 satır sayar). Onay kararı, seviye, kaynak, metin
 * sürümü/özeti kalır (KVKK kanıtı).
 * P28u (§3.3, K-P28u-15): izinsiz bağlantı gerekçesi (`silent_reason`) NULL; `consent_mode` kalır (kişisel değil; CHECK zorlar).
 * P22 (§3.3, r2 §15.3): adaylar TX'ten ÖNCE mesaj sayılarıyla `msgBudget`'a göre kısaltılır (en az 1 oturum); TX aynı
 * kısaltılmış listeyle sınırlanır. `beforeTx` de yalnız bu listeyi alır.
 */
export async function anonymizeSessionBatch(
  db: Db,
  tenantId: string,
  cutoff: Date,
  limit: number,
  beforeTx?: (sessionIds: string[]) => Promise<void>,
  msgBudget = SESSION_MSG_DELETE_BUDGET,
): Promise<SessionBatchResult> {
  const where = { tenantId, anonymizedAt: null, createdAt: { lt: cutoff }, status: { in: [...FINISHED_STATUSES] } };
  const order = [{ createdAt: "asc" as const }, { id: "asc" as const }];
  const empty = { selected: 0, sessions: 0, consents: 0, files: 0, storedFiles: 0, recordings: 0, messages: 0, more: false };
  const all = (await db.supportSession.findMany({ where, orderBy: order, take: limit, select: { id: true } })).map((r) => r.id);
  if (all.length === 0) return empty;
  const picked = trimByMessageBudget(all, await messageCounts(db, tenantId, all), msgBudget);
  const more = picked.length < all.length || all.length === limit;
  // P28b (§3.3): saklanan dosyaların diski TX'ten ÖNCE silinir (TX geri alınırsa satır CLEAN kalır → mutabakat EXPIRED yapar).
  if (beforeTx) await beforeTx(picked);
  return db.$transaction(async (tx) => {
    const rows = await tx.supportSession.findMany({ where: { ...where, id: { in: picked } }, orderBy: order, select: { id: true } });
    if (rows.length === 0) return { ...empty, selected: picked.length, more };
    const ids = rows.map((r) => r.id);
    const recordings = await deleteSessionRecordings(tx, tenantId, ids);
    const stored = await tx.sessionStoredFile.deleteMany({ where: { tenantId, sessionId: { in: ids } } });
    const files = await tx.sessionFile.deleteMany({ where: { tenantId, sessionId: { in: ids } } });
    const consents = await tx.sessionConsent.updateMany({
      where: { tenantId, sessionId: { in: ids }, OR: [{ ip: { not: null } }, { userAgent: { not: null } }] },
      data: { ip: null, userAgent: null },
    });
    // S16-14: `anonymized_at` DB saatiyle (UTC_TIMESTAMP(3); sunucu `--default-time-zone=+00:00`) yazılır — iş mantıksal
    // saatle (`now`/`cutoff`) aday seçer, ama damga S16-3 tetikleyicisinin `[−1 g, +1 dk]` aralığında kalır.
    const sessions = await tx.$executeRaw`UPDATE support_sessions
      SET customer_name = NULL, customer_email = NULL, note = NULL, guest_net_key = NULL, guest_ip_key = NULL, device_id = NULL,
          silent_reason = NULL, anonymized_at = UTC_TIMESTAMP(3)
      WHERE tenant_id = ${tenantId} AND id IN (${Prisma.join(ids)}) AND anonymized_at IS NULL
        AND status IN (${Prisma.join([...FINISHED_STATUSES])})`;
    // P22 (§3.3, AC-264): UPDATE'ten SONRA (silme kalkanı tetikleyicisi aynı TX'teki `anonymized_at`'i görür). Join koşulu
    // eşzamanlı başka tur yüzünden UPDATE'in atladığı (anonim olmayan) oturumun mesajına dokunmaz; `request_id IS NULL`
    // savunma (oturum satırında hep NULL — K-P22-13).
    const messages = await tx.$executeRaw`DELETE m FROM session_messages m
      JOIN support_sessions s ON s.id = m.session_id AND s.tenant_id = m.tenant_id
      WHERE m.tenant_id = ${tenantId} AND m.session_id IN (${Prisma.join(ids)})
        AND s.anonymized_at IS NOT NULL AND m.request_id IS NULL`;
    return {
      selected: picked.length,
      sessions,
      consents: consents.count,
      files: files.count,
      storedFiles: stored.count,
      recordings,
      messages,
      more,
    };
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
  const r = await db.authSession.deleteMany({
    where: { expiresAt: { lt: cutoff }, OR: [{ revokedAt: null }, { revokedAt: { lt: cutoff } }] },
    limit,
  });
  return r.count;
}

/** Süresi `cutoff`'tan eski şifre sıfırlama bağlantıları (expires_at + 7 g). */
export async function deleteOldResetTokens(db: Db, cutoff: Date, limit: number): Promise<number> {
  const r = await db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: cutoff } }, limit });
  return r.count;
}

// ---------------- P16 G2: gece kalıcı silme (`purgeAnonymized`, AC-240; ADR-0030 m.2, mimari-e11 §7.2) ----------------
// Kesme anı DB saatiyle (S16-8): `UTC_TIMESTAMP(3) − 30 g − 1 sa`. Tetikleyici satır anında `UTC_SYSDATE − 30 g` ile
// denetler (≥ ifade başı) → 1 saatlik pay, sınırdaki adayın SIGNAL alıp partiyi her gece geri aldırmasını önler.
// Her parti tek TX; sıra çocuktan ebeveyne (session_files → session_consents → support_sessions → talepler).
// Sıralama yalnız `anonymized_at` (`, id` eklenmez: kaplayan IX yerine filtre+sıralama planına düşer — db-notlari "P16").

/** Gece silme partisi (ADR-0030 m.2). */
export const PURGE_BATCH = 500;

const PURGE_CUT = Prisma.sql`(UTC_TIMESTAMP(3) - INTERVAL 30 DAY - INTERVAL 1 HOUR)`;

interface PurgeBindingsResult {
  selected: number;
  bindings: number;
}

/**
 * Adım 1 (B*): `revoked_at < cut` olan ve anonim olmayan hiçbir talebin bağlanmadığı kayıtlar. Bağlı (anonim) taleplerin
 * `binding_id`'si NULL'lanır, sonra kayıt silinir. NOT EXISTS'te `NO_SEMIJOIN` (materyalizasyon yerine bağımlı alt sorgu,
 * IX(binding_id, tenant_id, status); db-notlari "P16" EXPLAIN).
 */
export async function purgeBindingsBatch(db: Db, tenantId: string, limit: number): Promise<PurgeBindingsResult> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT /*+ NO_SEMIJOIN(@sq) */ b.id FROM device_bindings b
      WHERE b.tenant_id = ${tenantId} AND b.revoked_at < ${PURGE_CUT}
        AND NOT EXISTS (SELECT /*+ QB_NAME(sq) */ 1 FROM support_requests r
          WHERE r.binding_id = b.id AND r.tenant_id = b.tenant_id AND r.anonymized_at IS NULL)
      LIMIT ${limit}`;
    if (rows.length === 0) return { selected: 0, bindings: 0 };
    const ids = Prisma.join(rows.map((r) => r.id));
    // Yalnız anonim taleplerde (ADR kuralı); anonim olmayan bağlı talep belirirse kayıt DELETE'i FK ile parti geri alınır.
    await tx.$executeRaw`UPDATE support_requests SET binding_id = NULL, updated_at = UTC_TIMESTAMP(3)
      WHERE tenant_id = ${tenantId} AND binding_id IN (${ids}) AND anonymized_at IS NOT NULL`;
    const bindings = await tx.$executeRaw`DELETE FROM device_bindings
      WHERE tenant_id = ${tenantId} AND id IN (${ids}) AND revoked_at < ${PURGE_CUT}`;
    return { selected: rows.length, bindings };
  }, TX_OPTIONS);
}

interface PurgeSessionsResult {
  selected: number;
  sessions: number;
  consents: number;
  files: number;
  requests: number;
}

type RawQuery = Pick<Db, "$queryRaw">;

/** Adım 2 adayları (TX içinde ve diskin TX'ten önce silinmesi için aynı koşul). */
function purgeSessionCandidates(q: RawQuery, tenantId: string, limit: number) {
  return q.$queryRaw<{ id: string; request_id: string | null }[]>`SELECT s.id, s.request_id FROM support_sessions s
    WHERE s.tenant_id = ${tenantId} AND s.anonymized_at < ${PURGE_CUT}
      AND NOT EXISTS (SELECT 1 FROM device_bindings b WHERE b.first_session_id = s.id AND b.tenant_id = s.tenant_id)
      AND NOT EXISTS (SELECT 1 FROM device_bindings b WHERE b.last_session_id = s.id AND b.tenant_id = s.tenant_id)
    ORDER BY s.anonymized_at
    LIMIT ${limit}`;
}

/**
 * Adım 2 (S*): `anonymized_at < cut` olan ve hiçbir kaydın `first/last_session_id`'si olmayan oturumlar. Sıra
 * `session_files` → `session_consents` (tetikleyici üst oturumu okur; oturumdan ÖNCE) → `support_sessions` → bağlı
 * talepler (`anonymized_at < cut`, başka oturum/onay başvurusu yok).
 */
export async function purgeSessionsBatch(
  db: Db,
  tenantId: string,
  limit: number,
  beforeTx?: (sessionIds: string[]) => Promise<void>,
): Promise<PurgeSessionsResult> {
  // P28b K8 (QA m.1): savunma amaçlı silinen saklanan dosya satırlarının diski TX'ten ÖNCE silinir (anonimleştirmeyle aynı yön).
  if (beforeTx) await beforeTx((await purgeSessionCandidates(db, tenantId, limit)).map((r) => r.id));
  return db.$transaction(async (tx) => {
    const rows = await purgeSessionCandidates(tx, tenantId, limit);
    if (rows.length === 0) return { selected: 0, sessions: 0, consents: 0, files: 0, requests: 0 };
    const ids = Prisma.join(rows.map((r) => r.id));
    // P28e (§3.4): recording_parts → recordings önce (anonimleştirme zaten sildi; savunma — sayı `files`'a eklenir).
    const recs = await deleteSessionRecordings(
      tx,
      tenantId,
      rows.map((r) => r.id),
    );
    // P28b (§3.3): stored_files → files → consents → sessions (anonimleştirme zaten sildi; savunma — sayı `files`'a eklenir).
    const stored = recs + (await tx.$executeRaw`DELETE FROM session_stored_files WHERE tenant_id = ${tenantId} AND session_id IN (${ids})`);
    const files = stored + (await tx.$executeRaw`DELETE FROM session_files WHERE tenant_id = ${tenantId} AND session_id IN (${ids})`);
    const consents = await tx.$executeRaw`DELETE FROM session_consents WHERE tenant_id = ${tenantId} AND session_id IN (${ids})`;
    const sessions = await tx.$executeRaw`DELETE FROM support_sessions
      WHERE tenant_id = ${tenantId} AND id IN (${ids}) AND anonymized_at < ${PURGE_CUT}`;
    const reqIds = rows.flatMap((r) => (r.request_id === null ? [] : [r.request_id]));
    const requests =
      reqIds.length === 0
        ? 0
        : await tx.$executeRaw`DELETE FROM support_requests
            WHERE tenant_id = ${tenantId} AND id IN (${Prisma.join(reqIds)}) AND anonymized_at < ${PURGE_CUT}
              AND NOT EXISTS (SELECT 1 FROM support_sessions s WHERE s.request_id = support_requests.id AND s.tenant_id = support_requests.tenant_id)
              AND NOT EXISTS (SELECT 1 FROM session_consents c WHERE c.request_id = support_requests.id AND c.tenant_id = support_requests.tenant_id)`;
    return { selected: rows.length, sessions, consents, files, requests };
  }, TX_OPTIONS);
}

/** Adım 3 (R*): `anonymized_at < cut` olan, oturumu ve onay başvurusu olmayan talepler (tek ifade, parti). */
export async function purgeOrphanRequestsBatch(db: Db, tenantId: string, limit: number): Promise<number> {
  return db.$executeRaw`DELETE FROM support_requests
    WHERE tenant_id = ${tenantId} AND anonymized_at < ${PURGE_CUT}
      AND NOT EXISTS (SELECT 1 FROM support_sessions s WHERE s.request_id = support_requests.id AND s.tenant_id = support_requests.tenant_id)
      AND NOT EXISTS (SELECT 1 FROM session_consents c WHERE c.request_id = support_requests.id AND c.tenant_id = support_requests.tenant_id)
    ORDER BY anonymized_at
    LIMIT ${limit}`;
}

interface PurgeCandidates {
  sessions: number;
  consents: number;
  files: number;
  requests: number;
  bindings: number;
}

/**
 * `RETENTION_PURGE_MODE=dry`: aynı aday koşulları `COUNT` ile; hiçbir satır değişmez. Tahmindir: aynı turda silinecek
 * kayıtların serbest bırakacağı oturumlar (adım 1 → 2 zinciri) sayılmaz; talepler "aday olmayan oturumu yok" koşuluyla.
 */
export async function countPurgeCandidates(db: Db, tenantId: string): Promise<PurgeCandidates> {
  const n = (rows: { n: bigint | number }[]): number => Number(rows[0]?.n ?? 0);
  const candidateSession = Prisma.sql`s.tenant_id = ${tenantId} AND s.anonymized_at < ${PURGE_CUT}
    AND NOT EXISTS (SELECT 1 FROM device_bindings b WHERE b.first_session_id = s.id AND b.tenant_id = s.tenant_id)
    AND NOT EXISTS (SELECT 1 FROM device_bindings b WHERE b.last_session_id = s.id AND b.tenant_id = s.tenant_id)`;
  const bindings = n(
    await db.$queryRaw<{ n: bigint }[]>`SELECT /*+ NO_SEMIJOIN(@sq) */ COUNT(*) AS n FROM device_bindings b
      WHERE b.tenant_id = ${tenantId} AND b.revoked_at < ${PURGE_CUT}
        AND NOT EXISTS (SELECT /*+ QB_NAME(sq) */ 1 FROM support_requests r
          WHERE r.binding_id = b.id AND r.tenant_id = b.tenant_id AND r.anonymized_at IS NULL)`,
  );
  const sessions = n(await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM support_sessions s WHERE ${candidateSession}`);
  const consents = n(
    await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM session_consents c JOIN support_sessions s
      ON s.id = c.session_id AND s.tenant_id = c.tenant_id WHERE ${candidateSession}`,
  );
  const files = n(
    await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM session_files f JOIN support_sessions s
      ON s.id = f.session_id AND s.tenant_id = f.tenant_id WHERE ${candidateSession}`,
  );
  const requests = n(
    await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM support_requests r
      WHERE r.tenant_id = ${tenantId} AND r.anonymized_at < ${PURGE_CUT}
        AND NOT EXISTS (SELECT 1 FROM support_sessions s WHERE s.request_id = r.id AND s.tenant_id = r.tenant_id
          AND NOT (${candidateSession}))`,
  );
  return { sessions, consents, files, requests, bindings };
}

/** Çakışma (mimari-e11 §7.2): açık firma silme işi (SCHEDULED | RUNNING | FAILED) olan firma gece işinde atlanır. */
export async function hasOpenPurgeJob(db: Db, tenantId: string): Promise<boolean> {
  const row = await db.tenantPurgeJob.findFirst({
    where: { tenantId, state: { in: ["SCHEDULED", "RUNNING", "FAILED"] } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Global adım (S16-10): DONE/CANCELLED iş satırları bitiş/iptal + 730 g sonra. Tetikleyici
 * (`tenant_purge_jobs_delete_guard`) satır anında `≤ UTC_SYSDATE − 730 g` ister → aynı 1 saatlik pay.
 */
const JOB_CUT = Prisma.sql`(UTC_TIMESTAMP(3) - INTERVAL 730 DAY - INTERVAL 1 HOUR)`;

export async function deleteOldPurgeJobs(db: Db, limit: number): Promise<number> {
  return db.$executeRaw`DELETE FROM tenant_purge_jobs
    WHERE state IN ('DONE', 'CANCELLED') AND COALESCE(finished_at, cancelled_at) < ${JOB_CUT}
    LIMIT ${limit}`;
}

export async function countOldPurgeJobs(db: Db): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM tenant_purge_jobs
    WHERE state IN ('DONE', 'CANCELLED') AND COALESCE(finished_at, cancelled_at) < ${JOB_CUT}`;
  return Number(rows[0]?.n ?? 0);
}
