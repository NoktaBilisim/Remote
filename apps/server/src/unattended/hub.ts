// P27 DeviceHub (mimari-p27 §4.4; AC-275, 293, 295, 339): bellek içi kimliği doğrulanmış cihaz soketleri (deviceId → bağlantı;
// tek instance, ADR-0005). `DeviceLink` (service.ts) uygulaması: çevrimiçi durumu, iptal (soket 4401 + oda `device_revoked`),
// yetki geri alma (oda `permission`). 4409 sayacı: cihaz başına 10 dk kayan pencere; > 3 → `replacedAlert` rozeti + audit
// `unattended.device.replaced` (10 dk'da ≤ 1). Oda bitişinde cihaza `disconnect` (yedek yol) + audit/metrik.
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { WS_DEVICE_CLOSE, type DeviceOutbound } from "@remote/contracts/ws-device";
import type { SessionEndedReason } from "@remote/contracts/ws";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import type { Metrics } from "../ops/metrics.ts";
import type { Rooms } from "../signaling/rooms.ts";
import { finishDevice } from "../signaling/rooms-device.ts";
import type { Room } from "../signaling/types.ts";
import type { DeviceLink } from "./service.ts";

export const REPLACED_WINDOW_MS = 10 * 60_000;
export const REPLACED_ALERT_OVER = 3;
const SYSTEM_CTX: AuditContext = { ip: "", userAgent: "device-hub", requestId: "" };

/** Kimliği doğrulanmış cihaz bağlantısı (device-ws.ts üretir). */
export interface DeviceConn {
  deviceId: string;
  tenantId: string;
  ip: string;
  send(msg: DeviceOutbound): void;
  close(code: number, reason: string): void;
}

export interface HubDeps {
  db: Db;
  rooms: Rooms;
  metrics: Metrics;
  log: { error(obj: object, msg: string): void };
  now: () => number;
}

export class DeviceHub implements DeviceLink {
  private readonly conns = new Map<string, DeviceConn>();
  private readonly replacedAt = new Map<string, number[]>();
  private readonly replacedAuditAt = new Map<string, number>();
  private readonly d: HubDeps;

  constructor(d: HubDeps) {
    this.d = d;
    d.rooms.deviceEnded = (room, reason) => this.roomEnded(room, reason);
    d.rooms.devices = this;
    d.metrics.gauge("rs_unattended_devices_online", "Bağlı (kimliği doğrulanmış) gözetimsiz cihazlar", () => this.conns.size);
  }

  get size(): number {
    return this.conns.size;
  }
  onlineIds(): readonly string[] {
    return [...this.conns.keys()];
  }
  isOnline(deviceId: string): boolean {
    return this.conns.has(deviceId);
  }
  get(deviceId: string): DeviceConn | undefined {
    return this.conns.get(deviceId);
  }

  /** Son 10 dk'daki 4409 sayısı (pencere dışı kayıtlar atılır). */
  private replacedCount(deviceId: string): number {
    const since = this.d.now() - REPLACED_WINDOW_MS;
    const list = (this.replacedAt.get(deviceId) ?? []).filter((t) => t > since);
    if (list.length === 0) this.replacedAt.delete(deviceId);
    else this.replacedAt.set(deviceId, list);
    return list.length;
  }

  replacedAlert(deviceId: string): boolean {
    return this.replacedCount(deviceId) > REPLACED_ALERT_OVER;
  }

  /** Kimlik doğrulandı: aynı cihazın eski soketi 4409 ile kapanır (yeni kalır) ve sayaç artar (D-P27-3). */
  attach(conn: DeviceConn): void {
    const old = this.conns.get(conn.deviceId);
    this.conns.set(conn.deviceId, conn);
    if (!old) return;
    old.close(WS_DEVICE_CLOSE.REPLACED, "replaced");
    this.d.metrics.inc("rs_unattended_device_replaced_total");
    this.replacedAt.set(conn.deviceId, [...(this.replacedAt.get(conn.deviceId) ?? []), this.d.now()]);
    if (this.replacedAlert(conn.deviceId)) void this.auditReplaced(conn);
  }

  private async auditReplaced(conn: DeviceConn): Promise<void> {
    const now = this.d.now();
    const last = this.replacedAuditAt.get(conn.deviceId);
    if (last !== undefined && now - last < REPLACED_WINDOW_MS) return;
    this.replacedAuditAt.set(conn.deviceId, now);
    await writeAudit(
      this.d.db,
      { ...SYSTEM_CTX, ip: conn.ip },
      {
        tenantId: conn.tenantId,
        username: "device",
        action: UNATTENDED_AUDIT.DEVICE_REPLACED,
        entity: "unattended_devices",
        entityId: conn.deviceId,
        result: "fail",
        newValue: { replacedIn10Min: this.replacedCount(conn.deviceId) },
      },
    ).catch((err: unknown) => this.d.log.error({ err }, "cihaz değiştirildi audit'i yazılamadı"));
  }

  /** Soket kapandı; yalnız güncel bağlantıysa çıkarılır (4409 ile düşen eski soket yeniyi silmez). */
  detach(conn: DeviceConn): boolean {
    if (this.conns.get(conn.deviceId) !== conn) return false;
    this.conns.delete(conn.deviceId);
    return true;
  }

  send(deviceId: string, msg: DeviceOutbound): boolean {
    const c = this.conns.get(deviceId);
    if (!c) return false;
    c.send(msg);
    return true;
  }

  /** AC-275: `revoked{}` + 4401; cihazın odaları `device_revoked`. */
  revoked(deviceId: string): void {
    const c = this.conns.get(deviceId);
    if (c) {
      this.conns.delete(deviceId);
      c.send({ t: "revoked" });
      c.close(WS_DEVICE_CLOSE.AUTH_FAILED, "revoked");
    }
    void finishDevice(this.d.rooms, deviceId, "device_revoked").catch((err: unknown) =>
      this.d.log.error({ err, deviceId }, "iptal edilen cihazın odası bitirilemedi"),
    );
  }

  /** AC-293: yetkisi kalkan teknisyenlerin bu cihazdaki odaları `permission`. */
  grantsRemoved(deviceId: string, userIds: readonly string[]): void {
    for (const userId of userIds)
      void finishDevice(this.d.rooms, deviceId, "permission", userId).catch((err: unknown) =>
        this.d.log.error({ err, deviceId }, "yetkisi kalkan teknisyenin odası bitirilemedi"),
      );
  }

  /** Rooms.teardown kancası: cihaza `disconnect` (yedek yol) + metrik + audit `unattended.session.ended`. */
  private roomEnded(room: Room, reason: SessionEndedReason): void {
    const dev = room.unattended;
    if (!dev) return;
    this.send(dev.deviceId, { t: "disconnect", sessionId: room.sessionId, reason });
    const dbReason = dev.dbEndReason ?? reason;
    this.d.metrics.inc("rs_unattended_sessions_ended_total", { reason: dbReason });
    const started = room.admitted?.since;
    void writeAudit(this.d.db, SYSTEM_CTX, {
      tenantId: room.tenantId,
      username: "system",
      action: UNATTENDED_AUDIT.SESSION_ENDED,
      entity: "support_sessions",
      entityId: room.sessionId,
      result: "success",
      newValue: {
        deviceId: dev.deviceId,
        technicianId: room.technicianId,
        reason: dbReason,
        started: room.admitted !== undefined,
        durationSec: started === undefined ? 0 : Math.max(0, Math.round((this.d.now() - started) / 1000)),
      },
    }).catch((err: unknown) => this.d.log.error({ err }, "gözetimsiz oturum bitişi audit'i yazılamadı"));
  }

  /** Firma pasife alındı (tenants/deactivate.ts commit sonrası): firmanın cihaz soketleri 4401; yeniden auth da 4401 alır. */
  closeByTenant(tenantId: string): number {
    let n = 0;
    for (const [id, c] of this.conns) {
      if (c.tenantId !== tenantId) continue;
      this.conns.delete(id);
      c.close(WS_DEVICE_CLOSE.AUTH_FAILED, "tenant_passive");
      n += 1;
    }
    return n;
  }

  closeAll(): void {
    for (const c of this.conns.values()) c.close(1001, "shutdown");
    this.conns.clear();
  }
}
