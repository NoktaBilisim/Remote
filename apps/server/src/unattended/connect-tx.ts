// POST /unattended/devices/:id/connect TX'i (mimari-p27 §4.3 adım 10 + r2 TX içi yeniden denetim, K-P27-17; AC-273, 338).
// Kilit sırası: cihaz (FOR UPDATE) → grant (FOR SHARE) → teknisyen (lockTechnician) — revoke / PUT grants / device.state /
// admit-device aynı cihaz kilidini alır, kilitlenme yok. Step-up en sonda koşullu tüketilir (K-P27-5): count≠1 → 401, TX geri.
import { STEP_UP_MAX_AGE_SEC } from "@remote/contracts/api/auth";
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { AppError } from "../lib/errors.ts";
import { newId, newSecretToken, sha256Hex } from "../lib/ids.ts";
import { newTechVerifyCode } from "../sessions/codes.ts";
import * as srepo from "../sessions/repo.ts";
import type { ConnectDeps } from "./connect.ts";
import * as repo from "./repo.ts";

/** PENDING cihaz oturumu ömrü (DB `support_sessions_ttl_chk`: talep/cihaz 60 ± 5 sn). */
export const DEVICE_CONNECT_WINDOW_MS = 60_000;

export interface Opened {
  sessionId: string;
  deviceId: string;
  deviceName: string;
  customerId: string;
  expiresAt: Date;
  method: "totp" | "recovery_code";
}

type Tx = Prisma.TransactionClient;

/** Zincir reddi: metrik sonucu + audit nedeni + kullanıcıya dönecek hata. */
export class Refusal extends Error {
  readonly result: string;
  readonly err: AppError;
  constructor(result: string, err: AppError) {
    super(result);
    this.result = result;
    this.err = err;
  }
}
const no = (result: string, code: ConstructorParameters<typeof AppError>[0]) => new Refusal(result, new AppError(code));

/** (a)–(e): yetkili yeniden denetim; kaybeden eşzamanlı istek burada `DEVICE_BUSY` alır. */
async function recheck(tx: Tx, d: ConnectDeps, auth: AuthContext, tenantId: string, deviceId: string, now: Date): Promise<void> {
  const dev = await repo.lockDevice(tx, tenantId, deviceId);
  if (!dev || dev.revoked_at) throw no("not_found", "NOT_FOUND");
  if (!dev.local_enabled) throw no("local_disabled", "DEVICE_LOCAL_DISABLED");
  if (!(await repo.lockGrant(tx, tenantId, deviceId, auth.user.id))) throw no("not_found", "NOT_FOUND");
  if ((await repo.openDeviceSessions(tx, tenantId, deviceId, now)) > 0) throw no("busy", "DEVICE_BUSY");
  await srepo.lockTechnician(tx, auth.user.id);
  const settings = await srepo.sessionSettings(tx, tenantId);
  if (!settings) throw new Error("tenant_settings satırı yok");
  if ((await srepo.countOpen(tx, auth.user.id, now)) >= settings.maxOpenSessions) throw no("limit", "OPEN_SESSION_LIMIT");
}

/** (g): `UPDATE auth_sessions SET step_up_at = NULL WHERE … step_up_at >= now − 300 sn`; count≠1 → 401. */
async function consumeStepUp(tx: Tx, auth: AuthContext, now: Date): Promise<void> {
  const r = await tx.authSession.updateMany({
    where: { id: auth.sessionId, revokedAt: null, stepUpAt: { gte: new Date(now.getTime() - STEP_UP_MAX_AGE_SEC * 1000) } },
    data: { stepUpAt: null },
  });
  if (r.count !== 1) throw no("step_up", "MFA_STEP_UP_REQUIRED");
}

/** PENDING cihaz oturumu satırı (kod yok; belirteç hiç döndürülmez). */
async function insertPending(
  tx: Tx,
  o: { id: string; tenantId: string; technicianId: string; dev: repo.DeviceRow; now: Date; expiresAt: Date },
): Promise<void> {
  await srepo.insertSession(tx, {
    id: o.id,
    tenantId: o.tenantId,
    technicianId: o.technicianId,
    tokenHash: sha256Hex(newSecretToken()),
    activeCode: null,
    techVerifyCode: newTechVerifyCode(),
    status: "PENDING",
    createdAt: o.now,
    expiresAt: o.expiresAt,
    deviceId: o.dev.id,
    customerId: o.dev.customerId,
    customerName: o.dev.name,
  });
}

export function openDeviceSession(
  d: ConnectDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  dev: repo.DeviceRow,
  method: Opened["method"],
): Promise<Opened> {
  return d.db.$transaction(async (tx) => {
    const now = new Date(d.now());
    await recheck(tx, d, auth, tenantId, dev.id, now);
    const sessionId = newId();
    const expiresAt = new Date(now.getTime() + DEVICE_CONNECT_WINDOW_MS);
    await insertPending(tx, { id: sessionId, tenantId, technicianId: auth.user.id, dev, now, expiresAt });
    await consumeStepUp(tx, auth, now);
    await writeAudit(tx, ctx, {
      tenantId,
      userId: auth.user.id,
      username: auth.user.email,
      action: UNATTENDED_AUDIT.CONNECT,
      entity: "support_sessions",
      entityId: sessionId,
      result: "success",
      newValue: { deviceId: dev.id, ip: ctx.ip, stepUpMethod: method },
    });
    return { sessionId, deviceId: dev.id, deviceName: dev.name, customerId: dev.customerId, expiresAt, method };
  });
}
