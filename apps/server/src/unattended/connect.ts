// POST /unattended/devices/:id/connect (mimari-p27 §4.3 r2; AC-273, 293, 296, 297, 336, 338, 339). Ön koşul zinciri sırayla,
// ilk başarısız döner: yetki → kullanıcı kovası (20/sa) → cihaz + grant (404) → step-up VAR → yerel anahtar → adres → SMTP →
// imza kapısı → çevrimiçi → meşgul. Yetkili karar TX'te: cihaz FOR UPDATE → iptal/yerel → grant FOR SHARE → meşgul → teknisyen
// kilidi + açık oturum sınırı → PENDING satır (60 sn, kod yok) → step-up KOŞULLU tüketim (count≠1 → 401, TX geri) → audit.
// Commit sonrası: oda + bilet + cihaza `connect`; 60 sn içinde kabul yoksa CANCELLED(device_timeout). Her ret audit'lenir.
// P28u r3 (mimari-p28u §r3.4; AC-430, 433, 434, 435): tek kip (cihaz kullanıcıya sormaz). Kullanıcı kovası → … → 8 çevrimiçi →
// 8a `direct1` (409 DEVICE_OUTDATED, step-up tüketilmeden) → 9 meşgul → TX. Gönderim anında `direct1` yeniden (S-P28u-r3-1):
// soket arada eski servisle yenilendiyse oturum CANCELLED(protocol) + 409 DEVICE_OUTDATED. Audit ret alanı `failReason` + `mode`.
import { STEP_UP_MAX_AGE_SEC } from "@remote/contracts/api/auth";
import type { UnattendedConnectResponse } from "@remote/contracts/api/unattended";
import { AUTH_AUDIT, UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { deviceIndicatorText, type DeviceOutbound } from "@remote/contracts/ws-device";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { AuthContext } from "../auth/session.ts";
import type { ErrorCode } from "@remote/contracts/errors";
import { AppError } from "../lib/errors.ts";

type ConnectMessage = Extract<DeviceOutbound, { t: "connect" }>;
import type { FixedWindowCounter } from "../lib/rate.ts";
import type { Rooms } from "../signaling/rooms.ts";
import type { Room } from "../signaling/types.ts";
import { endDeviceRoom, preAdmitDevice } from "../signaling/rooms-device.ts";
import { deviceVerdict } from "./device-access.ts";
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

/** Yarış testi kancası (S-P28u-r3-1): TX commit'i ile oda kaydı/gönderim arası. Üretimde boş. */
export const connectTestSeams: { afterTx?: (o: Opened) => Promise<void> } = {};

/** Tel/metrik/audit kip etiketi: r3'te tek değer (`connect.consent` tarihsel adı, K-P28u-r3-3). */
const MODE = "ask";

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
  // P28c O-PC-4: tek yardımcı (`deviceVerdict`); ret kodları ve sırası değişmez (step-up grant ile yerel anahtar arasında).
  const verdict = deviceVerdict({ ...dev, revokedAt: null }, d.gate);
  if (!auth.totpEnabled) throw refuse("step_up", "MFA_SETUP_REQUIRED");
  const at = auth.stepUpAt?.getTime();
  if (at === undefined || d.now() - at > STEP_UP_MAX_AGE_SEC * 1000) throw refuse("step_up", "MFA_STEP_UP_REQUIRED");
  if (verdict === "local_disabled") throw refuse("local_disabled", "DEVICE_LOCAL_DISABLED");
  if (((await repo.contactCounts(d.db, tenantId, [dev.customerId])).get(dev.customerId) ?? 0) === 0)
    throw refuse("no_contact", "NOTIFY_CONTACT_REQUIRED");
  if ((await d.mail.configFor(tenantId)) === null) throw refuse("no_channel", "NOTIFY_CHANNEL_UNAVAILABLE");
  if (verdict === "unsigned") throw refuse("unsigned", "UNATTENDED_DISABLED");
  // P29 (K-P29-12, AC-479): kurulum sürüyor → çevrimiçi denetiminden ÖNCE 409 (servis kurulumda durur); step-up TX'te tüketilir, burada değil.
  if (d.hub.isUpdating(id)) throw refuse("updating", "DEVICE_UPDATING");
  if (!d.hub.isOnline(id)) throw refuse("offline", "DEVICE_OFFLINE");
  if (!d.hub.has(id, "direct1")) throw refuse("outdated", "DEVICE_OUTDATED"); // 8a (AC-435)
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
    d.metrics.inc("rs_unattended_connect_total", { mode: MODE, result: err.result });
    await auditConnect(d, ctx, auth, tenantId, id, { failReason: err.result, mode: MODE });
    throw err.err;
  }
  d.metrics.inc("rs_unattended_connect_total", { mode: MODE, result: "ok" });
  if (opened.method === "recovery_code") notifyRecovery(d, ctx, auth, tenantId, opened);
  if (connectTestSeams.afterTx) await connectTestSeams.afterTx(opened);
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
  const { ticket, expiresAt } = preAdmitDevice(d.rooms, row, {
    deviceId: o.deviceId,
    deviceName: o.deviceName,
    customerId: o.customerId,
  });
  const room = d.rooms.get(o.sessionId);
  const tenantName = auth.actingTenant?.name ?? auth.tenant?.name ?? "";
  const recording = room ? await recordingDecision(d, ctx, auth, tenantId, o, room) : false;
  const msg = connectMessage(d, ctx, auth, o, { ticket, expiresAt, tenantName: tenantName || "Destek" });
  const sent = d.hub.sendDirect(o.deviceId, recording ? { ...msg, recording: true } : msg);
  if (sent === "outdated") {
    // S-P28u-r3-1: 8a sonrası soket `direct1`'siz yenilendi — eski servise `connect` gitmez; anlamlı ret.
    if (room) await endDeviceRoom(d.rooms, room, "device_timeout", "protocol");
    d.metrics.inc("rs_unattended_connect_total", { mode: MODE, result: "outdated" });
    await auditConnect(d, ctx, auth, tenantId, o.deviceId, { failReason: "outdated", mode: MODE, sessionId: o.sessionId });
    throw new AppError("DEVICE_OUTDATED");
  }
  if (room && sent === "offline") await endDeviceRoom(d.rooms, room, "device_timeout");
  else if (room) armTimeout(d, room);
  return { sessionId: o.sessionId };
}

/**
 * P28e §2.2 (P28u §13 kancası): `recording = unattended_recording_enabled ∧ recording_enabled ∧ cihaz record1 ∧ kota/disk`.
 * Politika açık ama cihaz eski → kayıt yok + `hello.unattended.recordOutdated` + audit `recording.start` fail `device_outdated`
 * (K6: eski servis `rec.state` alırsa soketi kapatır; gösterge eki yardımcıda, `indicatorText`'e ek konmaz). Kota/disk →
 * fail `quota`. Karar bekleyen odaya yazılır; admit TX'i ayarı yeniden okur (`startPolicy`).
 */
async function recordingDecision(
  d: ConnectDeps,
  ctx: AuditContext,
  auth: AuthContext,
  tenantId: string,
  o: Opened,
  room: Room,
): Promise<boolean> {
  const svc = d.rooms.rec;
  const u = room.unattended;
  if (!svc || !u) return false;
  const s = await d.db.tenantSettings.findUnique({
    where: { tenantId },
    select: { recordingEnabled: true, unattendedRecordingEnabled: true },
  });
  if (!s?.recordingEnabled || !s.unattendedRecordingEnabled) return false;
  const fail = (reason: "device_outdated" | "quota") =>
    svc
      .auditStartFail({
        tenantId,
        sessionId: o.sessionId,
        basis: "tenant_policy",
        reason,
        actor: { kind: "user", userId: auth.user.id, username: auth.user.email, ctx },
      })
      .catch((err: unknown) => d.log.error({ err }, "kayıt başlatma reddi audit'i yazılamadı"));
  if (!d.hub.has(o.deviceId, "record1")) {
    u.recordOutdated = true;
    await fail("device_outdated");
    return false;
  }
  if (!(await svc.canOffer(tenantId))) {
    await fail("quota");
    return false;
  }
  u.recording = true;
  return true;
}

/** §6.2 `connect` (K-P28u-r3-3, r3-7): `consent:"ask"` (cihaz sormaz) + P27 gösterge metni. */
function connectMessage(
  d: ConnectDeps,
  ctx: AuditContext,
  auth: AuthContext,
  o: Opened,
  t: { ticket: string; expiresAt: number; tenantName: string },
): ConnectMessage {
  const test = d.gate.mode === "unsigned";
  const name = auth.user.fullName;
  const base = {
    t: "connect" as const,
    sessionId: o.sessionId,
    ticket: t.ticket,
    techName: name.slice(0, 120),
    tenantName: t.tenantName.slice(0, 120),
    techIp: ctx.ip.length >= 2 ? ctx.ip.slice(0, 45) : "bilinmiyor",
    expiresInSec: Math.max(1, Math.round((t.expiresAt - d.now()) / 1000)),
  };
  return { ...base, consent: "ask", indicatorText: deviceIndicatorText(name, t.tenantName, test) };
}

/** §2 adım 8 (K-P28u-r3-4): `timing.requestConnectMs` (60 sn) içinde kabul yoksa CANCELLED(device_timeout). */
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
