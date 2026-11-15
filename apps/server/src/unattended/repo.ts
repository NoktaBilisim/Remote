// P27 gözetimsiz erişim veri erişimi (mimari-p27 §3, §4.2, §4.3 r2). Her sorgu tenant kapsamlı. Cihaz satır kilidi
// (`lockDevice`, FOR UPDATE) revoke / grants / (K3) connect / admit / device.state TX'lerinin ORTAK ilk adımıdır; kilit
// sırası her yerde cihaz → teknisyen (K-P27-17).
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";

type Tx = Prisma.TransactionClient;
type DbOrTx = Db | Tx;

/** Liste/ayrıntı satırı: müşteri adı, grant sayısı, çağıranın grant'ı, son oturum. */
export function deviceSelect(userId: string) {
  return {
    id: true,
    name: true,
    customerId: true,
    osVersion: true,
    agentVersion: true,
    binarySha256: true,
    signed: true,
    localEnabled: true,
    lastSeenAt: true,
    lastIp: true,
    registeredIp: true,
    verifiedAt: true,
    notifyFailedAt: true,
    createdAt: true,
    customer: { select: { name: true } },
    _count: { select: { grants: true } },
    grants: { where: { userId }, select: { id: true } },
    sessions: { select: { createdAt: true }, orderBy: { createdAt: "desc" as const }, take: 1 },
  } satisfies Prisma.UnattendedDeviceSelect;
}
export type DeviceRow = Prisma.UnattendedDeviceGetPayload<{ select: ReturnType<typeof deviceSelect> }>;

export interface ListFilter {
  tenantId: string;
  userId: string;
  /** false → yalnız çağıranın grant'lı olduğu cihazlar (AC-293). */
  manage: boolean;
  q?: string | undefined;
  customerId?: string | undefined;
  /** online → yalnız bu id'ler; offline → bu id'ler hariç. */
  online?: { ids: string[]; want: boolean } | undefined;
  after?: { name: string; id: string } | undefined;
  take: number;
}

export async function listDevices(db: DbOrTx, f: ListFilter): Promise<DeviceRow[]> {
  const where: Prisma.UnattendedDeviceWhereInput = {
    tenantId: f.tenantId,
    revokedAt: null,
    ...(f.manage ? {} : { grants: { some: { userId: f.userId, tenantId: f.tenantId } } }),
    ...(f.q ? { name: { contains: f.q } } : {}),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.online ? { id: f.online.want ? { in: f.online.ids } : { notIn: f.online.ids } } : {}),
    ...(f.after ? { OR: [{ name: { gt: f.after.name } }, { name: f.after.name, id: { gt: f.after.id } }] } : {}),
  };
  return db.unattendedDevice.findMany({ where, select: deviceSelect(f.userId), orderBy: [{ name: "asc" }, { id: "asc" }], take: f.take });
}

/** Keyset imleci = son öğenin id'si; imleç cihazının adı (etkin, bu tenant). Yoksa null → 400. */
export async function cursorOf(db: DbOrTx, tenantId: string, id: string): Promise<{ name: string; id: string } | null> {
  return db.unattendedDevice.findFirst({ where: { id, tenantId }, select: { name: true, id: true } });
}

export async function getDevice(db: DbOrTx, tenantId: string, userId: string, id: string): Promise<DeviceRow | null> {
  return db.unattendedDevice.findFirst({ where: { id, tenantId, revokedAt: null }, select: deviceSelect(userId) });
}

/** Müşteri başına bildirim adresi sayısı (canConnect `no_contacts`). */
export async function contactCounts(db: DbOrTx, tenantId: string, customerIds: string[]): Promise<Map<string, number>> {
  if (customerIds.length === 0) return new Map();
  const rows = await db.customerNotifyContact.groupBy({
    by: ["customerId"],
    where: { tenantId, customerId: { in: [...new Set(customerIds)] } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.customerId, r._count._all]));
}

export interface LockedDevice {
  id: string;
  name: string;
  revoked_at: Date | null;
  local_enabled: number | boolean;
  verified_at: Date | null;
}

/** Cihaz satır kilidi (§4.3 r2 (a)); iptal edilmiş satır da döner (çağıran karar verir). */
export async function lockDevice(tx: Tx, tenantId: string, id: string): Promise<LockedDevice | null> {
  const rows = await tx.$queryRaw<LockedDevice[]>`SELECT id, name, revoked_at, local_enabled, verified_at FROM unattended_devices
    WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`;
  return rows[0] ?? null;
}

export async function grantUserIds(db: DbOrTx, tenantId: string, deviceId: string): Promise<string[]> {
  const rows = await db.unattendedDeviceGrant.findMany({
    where: { tenantId, deviceId },
    select: { userId: true },
    orderBy: { userId: "asc" },
  });
  return rows.map((r) => r.userId);
}

export async function grantViews(db: DbOrTx, tenantId: string, deviceId: string) {
  return db.unattendedDeviceGrant.findMany({
    where: { tenantId, deviceId },
    select: { userId: true, user: { select: { fullName: true, avatarPath: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** Grant verilebilir aday kullanıcılar (firma içi; rol/durum/yetki çağıranda süzülür). */
export async function candidateUsers(tx: Tx, tenantId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return tx.user.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true, role: true, status: true, permissions: { select: { permKey: true, granted: true } } },
  });
}

/** Firmadaki iptal edilmemiş cihaz sayısı (AC-336 SMTP step-up koşulu). */
export const activeDeviceCount = (db: DbOrTx, tenantId: string): Promise<number> =>
  db.unattendedDevice.count({ where: { tenantId, revokedAt: null } });
