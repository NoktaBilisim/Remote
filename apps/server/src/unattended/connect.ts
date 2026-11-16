// POST /unattended/devices/:id/connect (mimari-p27 §4.3 r2; AC-273, 293, 296, 297, 336, 338, 339). Ön koşul zinciri sırayla,
// ilk başarısız döner: yetki → kullanıcı kovası (20/sa) → cihaz + grant (404) → step-up VAR → yerel anahtar → adres → SMTP →
// imza kapısı → çevrimiçi → meşgul. Yetkili karar TX'te: cihaz FOR UPDATE → iptal/yerel → grant FOR SHARE → meşgul → teknisyen
// kilidi + açık oturum sınırı → PENDING satır (60 sn, kod yok) → step-up KOŞULLU tüketim (count≠1 → 401, TX geri) → audit.
// Commit sonrası: oda + bilet + cihaza `connect`; 60 sn içinde kabul yoksa CANCELLED(device_timeout). Her ret audit'lenir.
import { STEP_UP_MAX_AGE_SEC } from "@remote/contracts/api/auth";
import type { UnattendedConnectResponse } from "@remote/contracts/api/unattended";
import { AUTH_AUDIT, UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { deviceIndicatorText } from "@remote/contracts/ws-device";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { ErrorCode } from "@remote/contracts/errors";
import { AppError } from "../lib/errors.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import type { Rooms } from "../signaling/rooms.ts";
import { endDeviceRoom, preAdmitDevice } from "../signaling/rooms-device.ts";
import { openDeviceSession, Refusal, type Opened } from "./connect-tx.ts";
import type { DeviceHub } from "./hub.ts";
import { recoveryConnectMail, sendInternalNotice } from "./mail.ts";
import * as repo from "./repo.ts";
import type { UnattendedDeps } from "./service.ts";

export interface ConnectDeps extends UnattendedDeps {
  hub: DeviceHub;
  rooms: Rooms;
  metrics: { inc(name: string, labels?: Record<string, string>): void };
  limit: FixedWindowCounter;
}

const refuse = (result: string, code: ErrorCode): Refusal => new Refusal(result, new AppError(code));

async function auditConnect(d: ConnectDeps, ctx: AuditContext, auth: AuthContext, tenantId: string, deviceId: string, v: object) {
  await writeAudit(d.db, ctx, {
    tenantId,
    userId: auth.user.id,
    username: auth.user.email,
    action: UNATTENDED_AUDIT.CONNECT,
    entity: "unattended_devices",
    entityId: deviceId,
    result: "fail",
    newValue: { deviceId, ip: ctx.ip, ...v },
  });
}

/** Adım 3–9 (TX öncesi hızlı ret; doğru hata kodu için). */
async function precheck(d: ConnectDeps, auth: AuthContext, tenantId: string, id: string): Promise<repo.DeviceRow> {
  const dev = await repo.getDevice(d.db, tenantId, auth.user.id, id);
  if (!dev || dev.grants.length === 0) throw refuse("not_found", "NOT_FOUND");
  if (!auth.totpEnabled) throw refuse("step_up", "MFA_SETUP_REQUIRED");
  const at = auth.stepUpAt?.getTime();
  if (at === undefined || d.now() - at > STEP_UP_MAX_AGE_SEC * 1000) throw refuse("step_up", "MFA_STEP_UP_REQUIRED");
  if (!dev.localEnabled) throw refuse("local_disabled", "DEVICE_LOCAL_DISABLED");
  if (((await repo.contactCounts(d.db, tenantId, [dev.customerId])).get(dev.customerId) ?? 0) === 0)
    throw refuse("no_contact", "NOTIFY_CONTACT_REQUIRED");
  if ((await d.mail.configFor(tenantId)) === null) throw refuse("no_channel", "NOTIFY_CHANNEL_UNAVAILABLE");
  if (!d.gate.allows({ signed: dev.signed, sha256: dev.binarySha256 })) throw refuse("unsigned", "UNATTENDED_DISABLED");
  if (!d.hub.isOnline(id)) throw refuse("offline", "DEVICE_OFFLINE");
  if ((await repo.openDeviceSessions(d.db, tenantId, id, new Date(d.now()))) > 0) throw refuse("busy", "DEVICE_BUSY");
  return dev;
}

/** D-P27-6: bu oturumdaki son başarılı step-up'ın yöntemi (audit `auth.step_up`); bulunamazsa "totp". */
async function stepUpMethod(d: ConnectDeps, auth: AuthContext): Promise<"totp" | "recovery_code"> {
  const row = await d.db.auditLog.findFirst({
    where: { entity: "auth_sessions", entityId: auth.sessionId, action: AUTH_AUDIT.STEP_UP, result: "success" },
    orderBy: { id: "desc" },
    select: { newValue: true },
  });
  const v = row?.newValue as { method?: unknown } | null | undefined;
  return v?.method === "RECOVERY" ? "recovery_code" : "totp";
}

/** Zincir + TX; ret → audit fail + metrik + hata. */
export async function connectDevice(
  d: ConnectDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  id: string,
): Promise<UnattendedConnectResponse> {
  let opened: Opened;
  try {
    if (!auth.permissions.has("unattended.connect")) throw refuse("forbidden", "FORBIDDEN");
    if (d.limit.blockedFor(auth.user.id) > 0 || d.limit.hit(auth.user.id))
      throw new Refusal("limit", new AppError("RATE_LIMITED", { retryAfterSec: d.limit.blockedFor(auth.user.id) || 3600 }));
    const dev = await precheck(d, auth, tenantId, id);
    const method = await stepUpMethod(d, auth);
    opened = await openDeviceSession(d, ctx, auth, tenantId, dev, method);
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    d.metrics.inc("rs_unattended_connect_total", { result: err.result });
    await auditConnect(d, ctx, auth, tenantId, id, { reason: err.result });
    throw err.err;
  }
  d.metrics.inc("rs_unattended_connect_total", { result: "ok" });
  if (opened.method === "recovery_code") notifyRecovery(d, ctx, auth, tenantId, opened);
  return afterCommit(d, ctx, auth, tenantId, opened);
}

/** Commit sonrası (§2 adım 2): oda + bilet → cihaza `connect`; gönderilemezse oturum hemen biter. */
async function afterCommit(
  d: ConnectDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  o: Opened,
): Promise<UnattendedConnectResponse> {
  const row = {
    id: o.sessionId,
    tenantId,
    technicianId: auth.user.id,
    technician: { fullName: auth.user.fullName },
    expiresAt: o.expiresAt,
  };
  const { ticket, expiresAt } = preAdmitDevice(d.rooms, row, { deviceId: o.deviceId, deviceName: o.deviceName, customerId: o.customerId });
  const room = d.rooms.get(o.sessionId);
  const tenantName = auth.actingTenant?.name ?? auth.tenant?.name ?? "";
  const sent = d.hub.send(o.deviceId, {
    t: "connect",
    sessionId: o.sessionId,
    ticket,
    techName: auth.user.fullName.slice(0, 120),
    tenantName: tenantName.slice(0, 120) || "Destek",
    techIp: ctx.ip.length >= 2 ? ctx.ip.slice(0, 45) : "bilinmiyor",
    expiresInSec: Math.max(1, Math.round((expiresAt - d.now()) / 1000)),
    indicatorText: deviceIndicatorText(auth.user.fullName, tenantName || "Destek", d.gate.mode === "unsigned"),
    // P28u-K2 tip uyumu (sözleşmede zorunlu); silent dalı + 8a `DEVICE_OUTDATED` kapısı K3.
    consent: "ask",
  });
  if (room && !sent) await endDeviceRoom(d.rooms, room, "device_timeout");
  else if (room) armTimeout(d, room);
  return { sessionId: o.sessionId };
}

/** §2 adım 8: `timing.requestConnectMs` (60 sn) içinde kabul yoksa CANCELLED(device_timeout). */
function armTimeout(d: ConnectDeps, room: NonNullable<ReturnType<Rooms["get"]>>): void {
  d.rooms.clock.setTimeout(() => {
    if (!d.rooms.live(room) || room.admitted || room.admitting) return;
    void endDeviceRoom(d.rooms, room, "device_timeout").catch((err: unknown) => d.log.error({ err }, "cihaz zaman aşımı işlenemedi"));
  }, d.rooms.timing.requestConnectMs);
}

/** D-P27-6 / AC-339: kurtarma koduyla gözetimsiz bağlantı → diğer `manage` sahiplerine e-posta (en iyi çaba). */
function notifyRecovery(d: ConnectDeps, ctx: AuditContext, auth: AuthContext, tenantId: string, o: Opened): void {
  void sendInternalNotice({
    db: d.db,
    mail: d.mail,
    ctx,
    tenantId,
    actor: { userId: auth.user.id, username: auth.user.email },
    perms: ["unattended.manage"],
    kind: "unattended_recovery_connect",
    entity: "unattended_devices",
    entityId: o.deviceId,
    content: recoveryConnectMail({ user: auth.user.fullName, device: o.deviceName, at: new Date(d.now()), ip: ctx.ip }),
  }).catch((err: unknown) =>
    d.log.error({ err, event: "unattended_recovery_notify_failed" }, "kurtarma kodu bağlantı bildirimi gönderilemedi"),
  );
}
