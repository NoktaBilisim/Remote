// device_bindings erişimi (mimari-e10 §3.3–3.4, §15.2–15.4; db-notlari P8c-1 "Backend-dev için").
// Kurallar: geçersizleştirmede `revokedAt` + `revokeReason` + `keyHash: null` HER ZAMAN birlikte (CHECK);
// `activeSessionId` STORED üretilmiş sütundur — asla yazılmaz (MySQL 3105).
import type { BindingRevokeReason } from "@remote/contracts/api/bindings";
import { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type DbOrTx = Db | Prisma.TransactionClient;

const revokeData = (reason: BindingRevokeReason, now: Date) => ({ revokedAt: now, revokeReason: reason, keyHash: null });

/** Kullanım anı çözümleme (§3.4 "Kullanım"): etkin satır + tenant, müşteri, saklama süresi tek sorguda (UQ key_hash). */
const useSelect = {
  id: true,
  tenantId: true,
  customerId: true,
  lastUsedAt: true,
  tenant: {
    select: {
      name: true,
      logoPath: true,
      status: true,
      deletedAt: true,
      settings: { select: { retentionDays: true } },
      requestSettings: { select: { waitMinutes: true, trustedCidrs: true, waEnabled: true, waRecipients: true } },
    },
  },
  customer: { select: { id: true, name: true, status: true } },
} as const;
export type BindingUseRow = Prisma.DeviceBindingGetPayload<{ select: typeof useSelect }>;

export function findActiveByHash(db: DbOrTx, keyHash: string): Promise<BindingUseRow | null> {
  return db.deviceBinding.findFirst({ where: { keyHash, revokedAt: null }, select: useSelect });
}

/** Talep TX'inde koşullu kullanım (§3.4): count 0 → BINDING_INVALID + ROLLBACK. `last_used_at` yalnız başarılı talepte (K21). */
export async function touchForRequest(tx: DbOrTx, id: string, keyHash: string, now: Date): Promise<number> {
  const r = await tx.deviceBinding.updateMany({ where: { id, keyHash, revokedAt: null }, data: { lastUsedAt: now } });
  return r.count;
}

export function countPendingOfBinding(tx: DbOrTx, tenantId: string, bindingId: string): Promise<number> {
  return tx.supportRequest.count({ where: { bindingId, tenantId, status: "PENDING" } });
}

export function pendingOfBinding(tx: DbOrTx, tenantId: string, bindingId: string) {
  return tx.supportRequest.findMany({ where: { bindingId, tenantId, status: "PENDING" }, select: { id: true } });
}

// ---------------- Verme (§15.3) ----------------

export type IssueRow = { id: string; tenantId: string; customerId: string | null; keyHash: string | null };

type LockedRow = { id: string; tenant_id: string; customer_id: string | null; key_hash: string | null };
const toIssueRow = (r: LockedRow | undefined): IssueRow | null =>
  r ? { id: r.id, tenantId: r.tenant_id, customerId: r.customer_id, keyHash: r.key_hash } : null;

/**
 * Adım 1: oturumun etkin kaydı (en çok 1, UQ active_session_id) — satır kilidi. Sütunlar KİLİTLİ okumanın kendisinden
 * (son commit) döner: ayrı bir `findUnique` REPEATABLE READ anlık görüntüsünü okur ve eşzamanlı isteğin yeniden
 * denemesinde kazananın satırını göremez (→ P2002; §15.3 eşzamanlı test).
 */
export async function lockActiveOfSession(tx: Prisma.TransactionClient, sessionId: string): Promise<IssueRow | null> {
  const rows = await tx.$queryRaw<
    LockedRow[]
  >`SELECT id, tenant_id, customer_id, key_hash FROM device_bindings WHERE active_session_id = ${sessionId} FOR UPDATE`;
  return toIssueRow(rows[0]);
}

/** Adım 2: `previousKey`'in etkin satırı — satır kilidi (sütunlar kilitli okumadan). */
export async function lockActiveByHash(tx: Prisma.TransactionClient, keyHash: string): Promise<IssueRow | null> {
  const rows = await tx.$queryRaw<
    LockedRow[]
  >`SELECT id, tenant_id, customer_id, key_hash FROM device_bindings WHERE key_hash = ${keyHash} AND revoked_at IS NULL FOR UPDATE`;
  return toIssueRow(rows[0]);
}

/**
 * P20 çoklu dal (mimari-e11 §8d.2 adım 2, S-P20-4): `previousKeys` özetlerinden YALNIZ oturum tenant'ının etkin satırları,
 * kilitli; en son kullanılan önce. İki adım (db-notlari "P20"):
 *  1) kilitsiz aday okuma `key_hash IN (…) AND tenant_id = ?` (UQ key_hash aralığı) → yalnız bu tenant'ın kimlikleri;
 *     başka tenant'ın satırı ne döner ne kilitlenir (RR'de kilitli okuma, tenant süzgecine takılan satırı da kilitlerdi).
 *  2) kimlikler PK sırasıyla (`FORCE INDEX (PRIMARY)` + `ORDER BY id`; küçük tabloda iyimser plan tenant indeksini
 *     tarayıp o sırayla kilitliyordu) `FOR UPDATE` → eşzamanlı istekler aynı sırayla kilitler (kilitlenme yok);
 *     koşullar son commit'e göre yeniden denetlenir (arada yenilenen/iptal edilen satır düşer). `tenant_id` değişmez,
 *     eşleşen `key_hash` yeni satırda doğamaz (anahtar rastgele) → aday kümesi yalnız küçülebilir.
 */
export async function lockActiveByHashesForTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  keyHashes: readonly string[],
): Promise<(IssueRow & { lastUsedAt: Date })[]> {
  if (keyHashes.length === 0) return [];
  const hashes = Prisma.join([...keyHashes]);
  const cand = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM device_bindings FORCE INDEX (device_bindings_key_hash_key)
    WHERE key_hash IN (${hashes}) AND tenant_id = ${tenantId} AND revoked_at IS NULL`;
  if (cand.length === 0) return [];
  const ids = Prisma.join(cand.map((r) => r.id).sort());
  const rows = await tx.$queryRaw<(LockedRow & { last_used_at: Date })[]>`SELECT id, tenant_id, customer_id, key_hash, last_used_at
    FROM device_bindings FORCE INDEX (PRIMARY) WHERE id IN (${ids}) AND tenant_id = ${tenantId} AND revoked_at IS NULL ORDER BY id FOR UPDATE`;
  return rows
    .filter((r) => r.key_hash !== null && keyHashes.includes(r.key_hash))
    .sort((a, b) => b.last_used_at.getTime() - a.last_used_at.getTime() || (a.id < b.id ? -1 : 1))
    .map((r) => ({ id: r.id, tenantId: r.tenant_id, customerId: r.customer_id, keyHash: r.key_hash, lastUsedAt: r.last_used_at }));
}

/** Yerinde güncelleme (yeni anahtar, oturum, son kullanım, sayaç). `last_session_id` = oturum → UQ'ya girer. */
export async function renew(
  tx: DbOrTx,
  id: string,
  d: { keyHash: string; customerId: string | null; sessionId: string; clientVersion: string; now: Date },
): Promise<void> {
  // updateMany = tek UPDATE (son commit'i okur). Prisma `update` MySQL'de önce anlık görüntüden SELECT yapar; eşzamanlı
  // isteğin yeniden denemesinde kazananın satırını bulamaz (P2025).
  const r = await tx.deviceBinding.updateMany({
    where: { id, revokedAt: null },
    data: {
      keyHash: d.keyHash,
      customerId: d.customerId,
      lastSessionId: d.sessionId,
      lastUsedAt: d.now,
      clientVersion: d.clientVersion,
      issueCount: { increment: 1 },
    },
  });
  if (r.count !== 1) throw new Error("binding_renew_missing");
}

export async function insertBinding(
  tx: DbOrTx,
  d: { id: string; tenantId: string; customerId: string | null; keyHash: string; sessionId: string; clientVersion: string; now: Date },
): Promise<void> {
  await tx.deviceBinding.create({
    data: {
      id: d.id,
      tenantId: d.tenantId,
      customerId: d.customerId,
      keyHash: d.keyHash,
      clientVersion: d.clientVersion,
      firstSessionId: d.sessionId,
      lastSessionId: d.sessionId,
      lastUsedAt: d.now,
      createdAt: d.now,
    },
    select: { id: true },
  });
}

// ---------------- Geçersizleştirme ----------------

export async function revokeById(tx: DbOrTx, id: string, tenantId: string, reason: BindingRevokeReason, now: Date): Promise<number> {
  const r = await tx.deviceBinding.updateMany({ where: { id, tenantId, revokedAt: null }, data: revokeData(reason, now) });
  return r.count;
}

/** "Bu bilgisayarı unut" (§3.4): anahtar özetiyle; satır yoksa 0. */
export async function revokeByHash(tx: DbOrTx, keyHash: string, reason: BindingRevokeReason, now: Date): Promise<number> {
  const r = await tx.deviceBinding.updateMany({ where: { keyHash, revokedAt: null }, data: revokeData(reason, now) });
  return r.count;
}

/** Müşteri (customerId) ya da Genel (null) kayıtları toplu — IX(tenant_id, customer_id, revoked_at). */
export async function revokeForOwner(
  tx: DbOrTx,
  tenantId: string,
  customerId: string | null,
  reason: BindingRevokeReason,
  now: Date,
): Promise<number> {
  const r = await tx.deviceBinding.updateMany({ where: { tenantId, customerId, revokedAt: null }, data: revokeData(reason, now) });
  return r.count;
}

export async function revokeForTenant(tx: DbOrTx, tenantId: string, now: Date, limit: number): Promise<number> {
  const r = await tx.deviceBinding.updateMany({ where: { tenantId, revokedAt: null }, data: revokeData("TENANT_PASSIVE", now), limit });
  return r.count;
}

/** Pasif/silinmiş tenant'ların etkin kayıtları olan tenant kimlikleri (30 sn süpürücü yedeği). */
export async function passiveTenantsWithBindings(db: DbOrTx, take: number): Promise<string[]> {
  const rows = await db.deviceBinding.findMany({
    where: { revokedAt: null, tenant: { is: { OR: [{ status: { not: "ACTIVE" } }, { deletedAt: { not: null } }] } } },
    select: { tenantId: true },
    distinct: ["tenantId"],
    take,
  });
  return rows.map((r) => r.tenantId);
}

/**
 * Boşta kalma (V28): son kullanımdan `retention_days` geçmiş etkin kayıtlar — IX(revoked_at, last_used_at), partili.
 * S16-14 (P16 G2): `revoked_at` DB saatiyle (S16-3 tetikleyicisi `[UTC − 1 g, UTC + 1 dk]`); aday seçimi iş saatiyle
 * (`cutoff`). `revokeData` ile aynı üçlü (revoked_at + revoke_reason + key_hash NULL; CHECK).
 */
export async function expireIdle(db: DbOrTx, tenantId: string, cutoff: Date, limit: number): Promise<number> {
  return db.$executeRaw`UPDATE device_bindings
    SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = 'EXPIRED', key_hash = NULL, updated_at = UTC_TIMESTAMP(3)
    WHERE tenant_id = ${tenantId} AND revoked_at IS NULL AND last_used_at <= ${cutoff}
    LIMIT ${limit}`;
}
