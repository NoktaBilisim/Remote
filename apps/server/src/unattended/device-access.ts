// P28c (mimari-p28c §2, O-PC-4): gözetimsiz cihaza erişim TEK yardımcısı. `unattended_device_grants` satırı (kullanıcı + tenant)
// ∧ cihaz iptal edilmemiş ∧ yerel anahtar açık ∧ imza kapısı. Super Admin dahil herkes için grant satırı şart (bypass yok).
// Neden döner (bool değil): `connect.ts precheck` farklı hata kodlarını belirli sırayla verir; `revalidateDevice` bitiş nedenini seçer.
import type { Db } from "../lib/db.ts";
import type { UnattendedGate } from "./gate.ts";

export type DeviceVerdict = "ok" | "not_found" | "revoked" | "local_disabled" | "no_grant" | "unsigned";

export interface DeviceAccessRow {
  revokedAt: Date | null;
  localEnabled: boolean;
  signed: boolean;
  binarySha256: string;
  grants: readonly unknown[];
}

/** Saf karar (satır zaten okunmuş; `grants` bu kullanıcının bu tenant'taki grant satırları). Sıra: iptal → yerel → grant → imza. */
export function deviceVerdict(row: DeviceAccessRow | null, gate: UnattendedGate): DeviceVerdict {
  if (!row) return "not_found";
  if (row.revokedAt) return "revoked";
  if (!row.localEnabled) return "local_disabled";
  if (row.grants.length === 0) return "no_grant";
  if (!gate.allows({ signed: row.signed, sha256: row.binarySha256 })) return "unsigned";
  return "ok";
}

export async function deviceAccess(
  db: Db,
  gate: UnattendedGate,
  tenantId: string,
  userId: string,
  deviceId: string,
): Promise<DeviceVerdict> {
  const row = await db.unattendedDevice.findFirst({
    where: { id: deviceId, tenantId },
    select: {
      revokedAt: true,
      localEnabled: true,
      signed: true,
      binarySha256: true,
      grants: { where: { userId, tenantId }, select: { id: true } },
    },
  });
  return deviceVerdict(row, gate);
}

/** `deviceAccessOk(db, tenantId, userId, deviceId)` (§2). */
export async function deviceAccessOk(db: Db, gate: UnattendedGate, tenantId: string, userId: string, deviceId: string): Promise<boolean> {
  return (await deviceAccess(db, gate, tenantId, userId, deviceId)) === "ok";
}
