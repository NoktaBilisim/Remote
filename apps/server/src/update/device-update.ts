// P29 `/ws/device` güncelleme eki (mimari-p29 §4.3; AC-479, 485, 487, 488, 492, 493). Yalnız `update1` bildiren sokette:
// `device.ready` sonrası her zaman `update.offer` ya da `update.none` (sunucunun P29 desteğini duyurur; servis C→S `update.*`
// mesajlarını ancak bunu aldıktan sonra yollar). Cihaz başına saatlik sınırlar (`deviceId` anahtarlı); aşan mesaj yok sayılır
// + metrik (soket kapatılmaz). `update.token` yalnız `policy=auto` ∧ istenen sürüm = sunulabilir sürüm > cihaz sürümü iken.
import { UPDATE_LIMITS } from "@remote/contracts/api/update";
import type { DeviceUpdateInbound } from "@remote/contracts/ws-device";
import type { AuditContext } from "../audit/service.ts";
import { compareVersions } from "../lib/version.ts";
import type { DeviceConn, DeviceHub } from "../unattended/hub.ts";
import { countRateLimited, recordDeviceEvent, recordInstalling, takeBudget } from "./events.ts";
import type { UpdateService } from "./service.ts";

const SERVICE_LABELS = { platform: "windows", component: "service" } as const;

export interface DeviceUpdateDeps {
  updates: UpdateService;
  hub: DeviceHub;
}

/** `device.ready` sonrası ilk teklif (yalnız `update1`). */
export async function announceUpdate(d: DeviceUpdateDeps, conn: DeviceConn): Promise<void> {
  if (!conn.caps.has("update1")) return;
  d.hub.sendUpdate(conn.deviceId, await d.updates.serviceOutbound(conn.tenantId));
}

/** Politika değişti (AC-485, ≤ 60 sn): firmanın açık `update1` soketlerine yeni teklif. */
export async function rebroadcastPolicy(d: DeviceUpdateDeps, tenantId: string): Promise<void> {
  const conns = d.hub.updateConnsOf(tenantId);
  if (conns.length === 0) return;
  const msg = await d.updates.serviceOutbound(tenantId);
  for (const c of conns) d.hub.sendUpdate(c.deviceId, msg);
}

async function onCheck(d: DeviceUpdateDeps, conn: DeviceConn): Promise<void> {
  const u = d.updates;
  if (!takeBudget(u.limits.deviceCheck, conn.deviceId, UPDATE_LIMITS.deviceChecksPerHour)) {
    u.metrics.inc("rs_agent_update_check_total", { ...SERVICE_LABELS, result: "rate_limited" });
    return;
  }
  const msg = await u.serviceOutbound(conn.tenantId);
  u.metrics.inc("rs_agent_update_check_total", { ...SERVICE_LABELS, result: msg.t === "update.offer" ? "offer" : "none" });
  d.hub.sendUpdate(conn.deviceId, msg);
}

async function onTokenRequest(d: DeviceUpdateDeps, conn: DeviceConn, version: string): Promise<void> {
  const u = d.updates;
  if (!takeBudget(u.limits.deviceToken, conn.deviceId, UPDATE_LIMITS.deviceTokenRequestsPerHour)) {
    u.metrics.inc("rs_agent_update_download_total", { component: "service", result: "rate_limited" });
    return;
  }
  const [o, policy] = await Promise.all([u.store.offer("service-windows"), u.tenantPolicy(conn.tenantId)]);
  const current = conn.version ?? "0.0.0";
  const ok = o !== null && policy === "auto" && o.manifest.version === version && compareVersions(version, current) > 0;
  d.hub.sendUpdate(
    conn.deviceId,
    ok ? { t: "update.token", version, token: u.tokens.issue(conn.deviceId, o.manifest.sha256) } : { t: "update.none" },
  );
}

/** C→S `update.*` (device-ws yalnız `update1` sokette ayrıştırıp buraya verir). */
export async function onDeviceUpdateMessage(
  d: DeviceUpdateDeps,
  conn: DeviceConn,
  ctx: AuditContext,
  m: DeviceUpdateInbound,
): Promise<void> {
  const u = d.updates;
  switch (m.t) {
    case "update.check":
      return onCheck(d, conn);
    case "update.token.request":
      return onTokenRequest(d, conn, m.version);
    case "update.state":
      if (!takeBudget(u.limits.deviceState, conn.deviceId, UPDATE_LIMITS.deviceChecksPerHour)) {
        countRateLimited(u.metrics, { ...SERVICE_LABELS, source: "device" });
        return;
      }
      d.hub.markUpdating(conn.deviceId, UPDATE_LIMITS.deviceUpdatingTtlSec * 1000);
      return recordInstalling(u, conn, m.version);
    case "update.event": {
      if (!takeBudget(u.limits.deviceEvents, conn.deviceId, UPDATE_LIMITS.deviceEventsPerHour)) {
        countRateLimited(u.metrics, { ...SERVICE_LABELS, source: "device" });
        return;
      }
      const event = { type: m.type, version: m.version, fromVersion: m.fromVersion, at: m.at, ...(m.reason ? { reason: m.reason } : {}) };
      return recordDeviceEvent(u, ctx, conn, event);
    }
  }
}
