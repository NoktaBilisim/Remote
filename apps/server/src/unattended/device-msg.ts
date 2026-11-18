// P27 kimliği doğrulanmış cihazdan gelen mesajlar (mimari-p27 §4.4; AC-275, 294, 295): `connect.result` (ok:false → oturum
// CANCELLED(<neden>)), `device.state` (cihaz kilidi → DB + audit; false → oda hemen `local_disabled`), `session.closed`
// (yardımcı çıktı; oda sürüyorsa biter), `device.unregister` (iptal UNINSTALLED + soket kapanır). Mesaj yalnız kendi
// cihazının odasına etki eder (başka cihazın sessionId'si yok sayılır).
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import type { SessionEndedReason } from "@remote/contracts/ws";
import type { DeviceConnectFailReason, DeviceConsentInbound, DeviceInbound } from "@remote/contracts/ws-device";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Rooms } from "../signaling/rooms.ts";
import { sendHelloTech } from "../signaling/active.ts";
import { endDeviceRoom, finishDevice } from "../signaling/rooms-device.ts";
import type { Room } from "../signaling/types.ts";
import type { DeviceConn, DeviceHub } from "./hub.ts";
import { lockDevice } from "./repo.ts";

export interface MsgDeps {
  rooms: Rooms;
  hub: DeviceHub;
  now: () => number;
}

/**
 * K3 kararı (K1 notu): `helper_failed`, `no_console`, `busy` yalnız DB bitiş nedenidir; konsola `device_timeout` ("Cihaz
 * yanıt vermedi") gider. `local_disabled` / `indicator_failed` konsolda da aynı adla görünür.
 * P28u: `protocol` (D-P28u-5) yalnız DB nedeni → `device_timeout`. r3: `consent_*` tel değeri değil (şema reddeder).
 */
export function consoleReasonOf(r: DeviceConnectFailReason): SessionEndedReason {
  return r === "local_disabled" || r === "indicator_failed" ? r : "device_timeout";
}

function ownRoom(d: MsgDeps, conn: DeviceConn, sessionId: string): Room | undefined {
  const room = d.rooms.get(sessionId);
  return room && room.unattended?.deviceId === conn.deviceId && d.rooms.live(room) ? room : undefined;
}

const base = (conn: DeviceConn) => ({
  tenantId: conn.tenantId,
  username: "device",
  entity: "unattended_devices",
  entityId: conn.deviceId,
  result: "success" as const,
});

/** AC-295: yerel anahtar beyanı (servis tek kaynak); false → cihazın odaları hemen biter. */
async function onState(d: MsgDeps, conn: DeviceConn, ctx: AuditContext, enabled: boolean): Promise<void> {
  await d.rooms.db.$transaction(async (tx) => {
    const dev = await lockDevice(tx, conn.tenantId, conn.deviceId);
    if (!dev || dev.revoked_at || Boolean(dev.local_enabled) === enabled) return;
    await tx.unattendedDevice.update({ where: { id: conn.deviceId }, data: { localEnabled: enabled } });
    await writeAudit(tx, ctx, {
      ...base(conn),
      action: UNATTENDED_AUDIT.LOCAL_STATE,
      oldValue: { enabled: !enabled },
      newValue: { enabled },
    });
  });
  if (!enabled) await finishDevice(d.rooms, conn.deviceId, "local_disabled");
}

/** §5.3 kaldırma: iptal UNINSTALLED (revoked_by NULL, last_ip NULL, grant'lar silinir) + audit; commit sonrası hub. */
async function onUnregister(d: MsgDeps, conn: DeviceConn, ctx: AuditContext): Promise<void> {
  const done = await d.rooms.db.$transaction(async (tx) => {
    const dev = await lockDevice(tx, conn.tenantId, conn.deviceId);
    if (!dev || dev.revoked_at) return false;
    await tx.unattendedDevice.update({
      where: { id: conn.deviceId },
      data: { revokedAt: new Date(d.now()), revokedBy: null, revokeReason: "UNINSTALLED", lastIp: null },
    });
    const grants = await tx.unattendedDeviceGrant.deleteMany({ where: { tenantId: conn.tenantId, deviceId: conn.deviceId } });
    await writeAudit(tx, ctx, {
      ...base(conn),
      action: UNATTENDED_AUDIT.DEVICE_REVOKED,
      newValue: { reason: "UNINSTALLED", removedGrants: grants.count },
    });
    return true;
  });
  if (done) d.hub.revoked(conn.deviceId);
  else conn.close(1000, "unregistered");
}

/** §6.2: başka cihazın / canlı olmayan odanın mesajı ya da tekrar → yok sayılır + metrik. */
function rejected(d: MsgDeps, t: string): void {
  d.rooms.metrics.inc("rs_unattended_device_msg_rejected_total", { t });
}

type ConsentResult = Extract<DeviceConsentInbound, { t: "consent.result" }>;

/**
 * §8.1 (K-P28u-r3-4; AC-433): cihaz sormadan açtı ve `{mode:"no_user"}` bildirdi — yalnız bu cihazın PENDING odasına,
 * oturum başına tek (şema `asked`'ı zaten reddeder → admit `consent_missing`). Admit'te bekleyen söz varsa çözülür.
 */
function onConsent(d: MsgDeps, conn: DeviceConn, m: ConsentResult): void {
  const room = ownRoom(d, conn, m.sessionId);
  const u = room?.unattended;
  if (!room || !u || u.consentMode || room.admitted) return rejected(d, m.t);
  u.consentMode = m.mode;
  u.consentWait?.();
  // K7 devri: konsol kipi öğrensin — teknisyen bağlıysa güncel hello (`unattended.consentMode`); sözleşme değişmez.
  if (room.tech) sendHelloTech(d.rooms, room);
}

/** P28u yeni C→S mesajları (yalnız `consent1` soket; device-ws ayrıştırma sırası). */
function onConsentMessage(d: MsgDeps, conn: DeviceConn, m: DeviceConsentInbound): void {
  switch (m.t) {
    case "device.user":
      conn.userState = m.state;
      conn.userStateAt = d.now();
      return;
    case "consent.result":
      return onConsent(d, conn, m);
    case "intervene.result":
      if (!ownRoom(d, conn, m.sessionId) || !d.hub.intervene.settle(m.sessionId, m)) rejected(d, m.t);
      return;
  }
}

export async function onDeviceMessage(
  d: MsgDeps,
  conn: DeviceConn,
  ctx: AuditContext,
  m: DeviceInbound | DeviceConsentInbound,
): Promise<void> {
  switch (m.t) {
    case "device.user":
    case "consent.result":
    case "intervene.result":
      return onConsentMessage(d, conn, m);
    case "connect.result": {
      const room = ownRoom(d, conn, m.sessionId);
      if (room && !m.ok && m.reason) await endDeviceRoom(d.rooms, room, consoleReasonOf(m.reason), m.reason);
      return;
    }
    case "device.state":
      return onState(d, conn, ctx, m.localEnabled);
    case "session.closed": {
      const room = ownRoom(d, conn, m.sessionId);
      // D-P28u-K1-2: yeniden katılım penceresinde de süzgeç yok — servis beklenen yardımcı çıkışında (logoff kabulü) zaten
      // `session.closed` göndermez (agent-win `core.go watch`); gelen her bildirim gerçek bitiştir ve nedeniyle hemen yazılır.
      if (room) await endDeviceRoom(d.rooms, room, m.reason === "session_changed" ? "session_changed" : "customer", m.reason);
      return;
    }
    case "device.unregister":
      return onUnregister(d, conn, ctx);
  }
}
