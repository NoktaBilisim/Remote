// P28u izinsiz bağlantı politikası (mimari-p28u §5.2, §8.1, §8.4; AC-430, 436, 437, 440; K-P28u-13, K-P28u-21; O-P28u-2).
// `GET/PUT /unattended/policy`: `false→true` aydınlatma kutusu (`ack`) + step-up (tüketmez); `true→false` step-up'sız; aynı değer
// 200, audit yok. TX: `tenant_settings` FOR UPDATE → tek UPDATE (`enabled`, `ack_at`, `ack_by` — DB CHECK) → audit. Commit
// sonrası: kapatıldıysa `finishSilent` (PENDING silent satırları tenant koşullu toplu iptal + canlı silent odalar), dört göz
// e-postası. Connect / admit TX'leri politikayı `FOR SHARE` ve `unattended.silent`'i DB'den yeniden okur (yarış kapanışı).
import type { PutUnattendedPolicyInput, UnattendedPolicyView } from "@remote/contracts/api/unattended";
import { POLICY_ACK_REQUIRED_MESSAGE } from "@remote/contracts/api/unattended";
import { STEP_UP_MAX_AGE_SEC } from "@remote/contracts/api/auth";
import { UNATTENDED_POLICY_AUDIT } from "@remote/contracts/audit";
import { effectivePermissions, type Role } from "@remote/contracts/permissions";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import type { Rooms } from "../signaling/rooms.ts";
import { endDeviceRoom } from "../signaling/rooms-device.ts";
import { revokeMemberEverywhere } from "../signaling/member-life.ts";

type Tx = Prisma.TransactionClient;
type DbOrTx = Db | Tx;

/** Firma politikası (kilitsiz; zincir 2b ve `status.silentAllowed`). Satır yoksa kapalı. */
export async function silentPolicyEnabled(db: DbOrTx, tenantId: string): Promise<boolean> {
  const s = await db.tenantSettings.findUnique({ where: { tenantId }, select: { unattendedSilentEnabled: true } });
  return s?.unattendedSilentEnabled === true;
}

/** TX içi (zincir 10, admit): `tenant_settings` FOR SHARE — eşzamanlı `PUT /policy` (FOR UPDATE) commit'ini bekler. */
export async function lockSilentPolicy(tx: Tx, tenantId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ on: number | bigint | boolean }[]>`SELECT unattended_silent_enabled AS \`on\`
    FROM tenant_settings WHERE tenant_id = ${tenantId} FOR SHARE`;
  const v = rows[0]?.on;
  return v === true || Number(v) === 1;
}

/** `unattended.silent` DB'den yeniden (oturum önbelleği değil): etkin kullanıcı, bu tenant, rol varsayılanı + toggle'lar. */
export async function userHasSilent(db: DbOrTx, tenantId: string, userId: string): Promise<boolean> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true, deletedAt: true, tenantId: true, permissions: { select: { permKey: true, granted: true } } },
  });
  if (!u || u.status !== "ACTIVE" || u.deletedAt !== null) return false;
  if (u.role !== "SUPER_ADMIN" && u.tenantId !== tenantId) return false;
  return effectivePermissions(u.role as Role, u.permissions).includes("unattended.silent");
}

/**
 * O-P28u-2 / K-P28u-21 (admit/rejoin TX'i, kapıdan sonra): oturum `silent` ise politika (FOR SHARE) ∧ teknisyende
 * `unattended.silent` yeniden; değilse false (çağıran `permission` ile bitirir). `silent` olmayan oturumda true.
 */
export async function silentStillAllowed(tx: Tx, tenantId: string, sessionId: string, technicianId: string): Promise<boolean> {
  const s = await tx.supportSession.findFirst({ where: { id: sessionId, tenantId }, select: { consentMode: true } });
  if (s?.consentMode !== "silent") return true;
  return (await lockSilentPolicy(tx, tenantId)) && (await userHasSilent(tx, tenantId, technicianId));
}

/** `GET /unattended/status.silentAllowed` (AC-430): politika ∧ çağıranda `unattended.silent`. */
export async function silentAllowedFor(db: Db, auth: AuthContext, tenantId: string | null): Promise<boolean> {
  if (tenantId === null || !auth.permissions.has("unattended.silent")) return false;
  return silentPolicyEnabled(db, tenantId);
}

export async function getPolicy(db: Db, tenantId: string): Promise<UnattendedPolicyView> {
  const s = await db.tenantSettings.findUnique({
    where: { tenantId },
    select: { unattendedSilentEnabled: true, unattendedSilentAckAt: true, silentAcker: { select: { fullName: true } } },
  });
  return {
    silentEnabled: s?.unattendedSilentEnabled === true,
    ackAt: s?.unattendedSilentAckAt?.toISOString() ?? null,
    ackByName: s?.silentAcker?.fullName ?? null,
  };
}

export interface PolicyDeps {
  db: Db;
  rooms: Rooms;
  now: () => number;
  log: { error(obj: object, msg: string): void };
}

export interface PolicyChange {
  view: UnattendedPolicyView;
  /** Değer değişti mi (aynı değer → false; audit/e-posta/kesme yok). */
  changed: boolean;
  old: boolean;
}

/** Geçiş kuralı mevcut değere bağlı (şemada değil burada): açarken ack (400) → step-up (401, tüketilmez). */
function assertEnable(auth: AuthContext, input: PutUnattendedPolicyInput, now: number): void {
  if (input.ack !== true) throw new AppError("VALIDATION", { fields: { ack: POLICY_ACK_REQUIRED_MESSAGE } });
  if (!auth.totpEnabled) throw new AppError("MFA_SETUP_REQUIRED");
  const at = auth.stepUpAt?.getTime();
  if (at === undefined || now - at > STEP_UP_MAX_AGE_SEC * 1000) throw new AppError("MFA_STEP_UP_REQUIRED");
}

export async function putPolicy(
  d: PolicyDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  input: PutUnattendedPolicyInput,
): Promise<PolicyChange> {
  const r = await d.db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ on: number | bigint | boolean }[]>`SELECT unattended_silent_enabled AS \`on\`
      FROM tenant_settings WHERE tenant_id = ${tenantId} FOR UPDATE`;
    if (rows.length === 0) throw new AppError("NOT_FOUND");
    const old = rows[0]?.on === true || Number(rows[0]?.on) === 1;
    if (old === input.silentEnabled) return { old, changed: false };
    const now = new Date(d.now());
    if (input.silentEnabled) {
      assertEnable(auth, input, now.getTime());
      await tx.tenantSettings.update({
        where: { tenantId },
        data: { unattendedSilentEnabled: true, unattendedSilentAckAt: now, unattendedSilentAckBy: auth.user.id },
      });
    } else {
      await tx.tenantSettings.update({ where: { tenantId }, data: { unattendedSilentEnabled: false } });
    }
    await writeAudit(tx, ctx, {
      tenantId,
      userId: auth.user.id,
      username: auth.user.email,
      action: UNATTENDED_POLICY_AUDIT,
      entity: "tenant_settings",
      entityId: tenantId,
      result: "success",
      oldValue: { silentEnabled: old },
      newValue: { silentEnabled: input.silentEnabled, ...(input.silentEnabled ? { ack: true, stepUp: true } : {}) },
    });
    return { old, changed: true };
  });
  if (r.changed && !input.silentEnabled) await finishSilent(d, tenantId);
  return { view: await getPolicy(d.db, tenantId), changed: r.changed, old: r.old };
}

/**
 * §8.4 (AC-440, O-P28u-2): tenant'ın `silent` oturumlarını `permission` ile bitirir — önce DB'de PENDING silent satırlar TEK
 * UPDATE ile (tenant koşullu; henüz odası olmayanlar da kaçmaz) `CANCELLED(permission)`, sonra canlı odası olanlar
 * `endDeviceRoom` (ACTIVE → ENDED + `session.ended`, PENDING → soket kapanır). `technicianId` verilirse yalnız o teknisyen
 * (`unattended.silent` geri alımı — K4 `applyPermChange` buradan çağırır). Hata fırlatmaz.
 */
export async function finishSilent(d: PolicyDeps, tenantId: string, technicianId?: string): Promise<number> {
  const scope = { tenantId, consentMode: "silent", ...(technicianId ? { technicianId } : {}) };
  try {
    const open = await d.db.supportSession.findMany({
      where: { ...scope, status: { in: ["PENDING", "ACTIVE"] } },
      select: { id: true },
    });
    const now = new Date(d.now());
    await d.db.supportSession.updateMany({
      where: { ...scope, status: "PENDING" },
      data: { status: "CANCELLED", activeCode: null, endedAt: now, endedBy: "SYSTEM", endReason: "permission" },
    });
    // P28c (§2): yetki dalında (teknisyen verildi) kullanıcının üye olduğu silent odalarda yalnız üye düşer.
    if (technicianId)
      revokeMemberEverywhere(d.rooms, technicianId, (r) => r.tenantId === tenantId && r.unattended?.consentMode === "silent");
    const live = open.map((s) => d.rooms.get(s.id)).filter((room) => room !== undefined && room.tenantId === tenantId);
    await Promise.all(live.map((room) => (room ? endDeviceRoom(d.rooms, room, "permission") : undefined)));
    return open.length;
  } catch (err) {
    d.log.error({ err, tenantId }, "izinsiz oturumlar politika/yetki geri alımında bitirilemedi");
    return 0;
  }
}
