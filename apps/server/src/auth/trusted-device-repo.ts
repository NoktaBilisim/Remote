// P27a güvenilir cihaz veri erişimi (mimari-p27a §2, §3, §3.4; AC-328, 332, 334, 335b). `trusted_devices`'a giden TEK
// yol: tüm geçersiz kılma noktaları (§3.4) buradaki silme işlevlerini çağırır, kopya sorgu yazılmaz (T9).
// Satır id'si gizli değildir; doğrulama `token_hash` ile (r3). `token_hash` dışarı yalnız `findById` ile çıkar (K3'ün
// sabit zamanlı karşılaştırması için); liste/sayı işlevleri özeti seçmez.
import { TRUSTED_DEVICE_MAX_PER_USER } from "@remote/contracts/api/auth";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { newId } from "../lib/ids.ts";
import { trustedDeviceExpiresAt } from "./trusted-device.ts";

type DbOrTx = Db | Prisma.TransactionClient;

const rowSelect = {
  id: true,
  tenantId: true,
  userId: true,
  tokenHash: true,
  uaSummary: true,
  ip: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
} as const;
export type TrustedDeviceRow = Prisma.TrustedDeviceGetPayload<{ select: typeof rowSelect }>;

const listSelect = { id: true, uaSummary: true, ip: true, createdAt: true, lastUsedAt: true, expiresAt: true } as const;
export type TrustedDeviceListRow = Prisma.TrustedDeviceGetPayload<{ select: typeof listSelect }>;

/** Girişte çerezdeki id ile PK araması (r3). Sahiplik (`userId`/`tenantId`) ve süre denetimi çağıranda (§5.1). */
export function findById(db: DbOrTx, id: string): Promise<TrustedDeviceRow | null> {
  return db.trustedDevice.findUnique({ where: { id }, select: rowSelect });
}

export interface CreateTrustedDeviceInput {
  userId: string;
  tokenHash: string;
  /** ≤ 80 karakter, kontrol karakteri yok (DB CHECK). */
  uaSummary: string;
  ip: string;
  now: Date;
  /** Aynı tarayıcının eski çerezindeki satır id'si: kullanıcıya aitse silinir (bir tarayıcı = bir satır, §5.2). */
  replaceId?: string;
}

export interface CreatedTrustedDevice {
  id: string;
  tenantId: string;
  expiresAt: Date;
  /** Sınır (≤ 10) nedeniyle düşen en eski satır sayısı → audit `revoked {reason:"limit"}` (AC-332). */
  evicted: number;
}

/**
 * `mfaVerify` TX'i içinde çağrılır (§5.2). Sıra: kullanıcı satırı `FOR UPDATE` (paralel iki doğrulamada sınır aşılmasın,
 * AC-332) → `replaceId` silme → INSERT → sınır üstü en eskiyi silme. `tenant_id` kilitli kullanıcı satırından kopyalanır
 * (K-P27a-2: firmasız hesap — Super Admin — için satır oluşmaz; çağıran `rememberAllowed` ile zaten buraya gelmez).
 */
export async function createTrustedDevice(tx: Prisma.TransactionClient, input: CreateTrustedDeviceInput): Promise<CreatedTrustedDevice> {
  const locked = await tx.$queryRaw<{ tenant_id: string | null }[]>`SELECT tenant_id FROM users WHERE id = ${input.userId} FOR UPDATE`;
  const tenantId = locked[0]?.tenant_id;
  if (!tenantId) throw new Error("trusted device: kullanıcı yok veya firmasız");
  if (input.replaceId) await tx.trustedDevice.deleteMany({ where: { id: input.replaceId, userId: input.userId } });
  const id = newId();
  const expiresAt = trustedDeviceExpiresAt(input.now);
  await tx.trustedDevice.create({
    data: {
      id,
      tenantId,
      userId: input.userId,
      tokenHash: input.tokenHash,
      uaSummary: input.uaSummary,
      ip: input.ip,
      createdAt: input.now,
      expiresAt,
    },
  });
  const evicted = await deleteOverLimit(tx, input.userId);
  return { id, tenantId, expiresAt, evicted };
}

/** Kullanıcı başına en yeni `TRUSTED_DEVICE_MAX_PER_USER` satır kalır; fazlası (en eski `created_at`) silinir. */
async function deleteOverLimit(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  const extra = await tx.trustedDevice.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: TRUSTED_DEVICE_MAX_PER_USER,
    select: { id: true },
  });
  if (extra.length === 0) return 0;
  const r = await tx.trustedDevice.deleteMany({ where: { id: { in: extra.map((e) => e.id) }, userId } });
  return r.count;
}

export interface RotateTrustedDeviceInput {
  id: string;
  oldHash: string;
  newHash: string;
  ip: string;
  now: Date;
}

/** `rotated`: döndürüldü · `mismatch`: satır var, özet değişmiş (aynı nesil yarışı) · `gone`: satır arada silindi. */
export type RotateResult = "rotated" | "mismatch" | "gone";

/**
 * Döndürme (K-P27a-11): koşullu UPDATE `WHERE id = ? AND token_hash = :old`. `expires_at` değişmez (K-P27a-3).
 * D-P27a-K1: 0 satırda nedeni ayırmak için satır KİLİTLİ okunur (`FOR SHARE` son işlenmiş sürümü görür; TX anlık
 * görüntüsü silinmiş satırı hâlâ gösterirdi). Ek kilit yok: aynı PK'yi UPDATE zaten kilitledi (kayıt ya da boşluk).
 */
export async function rotate(db: DbOrTx, input: RotateTrustedDeviceInput): Promise<RotateResult> {
  const r = await db.trustedDevice.updateMany({
    where: { id: input.id, tokenHash: input.oldHash },
    data: { tokenHash: input.newHash, lastUsedAt: input.now, ip: input.ip },
  });
  if (r.count === 1) return "rotated";
  const still = await db.$queryRaw<{ id: string }[]>`SELECT id FROM trusted_devices WHERE id = ${input.id} FOR SHARE`;
  return still.length > 0 ? "mismatch" : "gone";
}

/** Profil listesi (AC-329): süresi dolmamış satırlar, en yeni önce, ≤ `TRUSTED_DEVICE_MAX_PER_USER`. */
export function listForUser(db: DbOrTx, userId: string, now: Date): Promise<TrustedDeviceListRow[]> {
  return db.trustedDevice.findMany({
    where: { userId, expiresAt: { gt: now } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TRUSTED_DEVICE_MAX_PER_USER,
    select: listSelect,
  });
}

/** Admin sayısı (AC-330): süresi dolmamış satırlar. */
export function countForUser(db: DbOrTx, userId: string, now: Date): Promise<number> {
  return db.trustedDevice.count({ where: { userId, expiresAt: { gt: now } } });
}

/**
 * Kullanıcının tümü (`id` yoksa) ya da yalnız kendi satırı (`id`): başka kullanıcının id'si 0 döner (çağıran 404).
 * Süresi dolmuş satırlar da silinir (sayıya girer). §3.4: şifre değişimi/sıfırlama, 2FA sıfırlama/etkinleştirme, tüm
 * cihazlardan çıkış, pasif, profil, Admin, yeniden kullanım, kalıcı silme.
 */
export async function deleteForUser(db: DbOrTx, userId: string, id?: string): Promise<number> {
  const r = await db.trustedDevice.deleteMany({ where: id === undefined ? { userId } : { userId, id } });
  return r.count;
}

/**
 * `deleteForUser`'ın kullanıcı satırı ZATEN X kilitliyken kullanılan biçimi (2FA etkinleştirme TX'i). Olmayan satırları
 * silen `DELETE … WHERE user_id = ?` dizinde boşluk kilidi alır ve eşzamanlı ekleme/silmelerle kilitlenmeye (1213)
 * girer; burada önce kilitsiz okunur, yalnız var olan satırlar PK ile silinir. Yarış yok: yeni satır (`createTrustedDevice`)
 * aynı kullanıcı satırını `FOR UPDATE` bekler.
 */
export async function deleteForLockedUser(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  const ids = await tx.trustedDevice.findMany({ where: { userId }, select: { id: true } });
  if (ids.length === 0) return 0;
  const r = await tx.trustedDevice.deleteMany({ where: { userId, id: { in: ids.map((x) => x.id) } } });
  return r.count;
}

/** Firmanın tümü (§3.4: firma pasif, firma ayarı kapatıldı). */
export async function deleteForTenant(db: DbOrTx, tenantId: string): Promise<number> {
  const r = await db.trustedDevice.deleteMany({ where: { tenantId } });
  return r.count;
}

/** Saklama işi (§3.3): `expires_at < now` satırları parti halinde; audit'lenmez (sayaç metriği). */
export async function deleteExpired(db: DbOrTx, now: Date, limit: number): Promise<number> {
  const r = await db.trustedDevice.deleteMany({ where: { expiresAt: { lt: now } }, limit });
  return r.count;
}
