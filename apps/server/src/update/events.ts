// P29 olay işleme (mimari-p29 §4.5–4.7, r2 §14.4; AC-487..489). Servis (WS `update.event`, kaynak `device`) ve taşınabilir istemci
// (POST /public/agent/update-events, kaynak `binding` | `anonymous`) ortak: metrik (etiketler yalnız enum) → kimlikliyse audit
// `client.update.*` → servis ise cihaz durum sütunları (§3.2; dört alan tek UPDATE). `source` istemciden gelmez, kimlik kanalından
// belirlenir. Kimliksiz olay audit'e yazılmaz (V-P29-6). Anahtar/belirteç/yol hiçbir log/audit/metrikte yok.
import {
  isUpdateSecurityReason,
  type UpdateComponent,
  type UpdateEvent,
  type UpdateEventSource,
  type UpdatePlatform,
} from "@remote/contracts/api/update";
import { CLIENT_UPDATE_AUDIT_BY_EVENT } from "@remote/contracts/audit";
import type { JsonObject } from "../audit/mask.ts";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import type { Db } from "../lib/db.ts";
import { netKey } from "../lib/ip.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import type { Metrics } from "../ops/metrics.ts";

export interface EventDeps {
  db: Db;
  metrics: Metrics;
  now: () => number;
}

/** Saatlik bütçe: pencerede `limit`'e ulaşıldıysa false (sayılmaz), aksi sayar ve true. Sayaç `limit + 1` ile kurulur. */
export function takeBudget(counter: FixedWindowCounter, key: string, limit: number): boolean {
  if (counter.count(key) >= limit) return false;
  counter.hit(key);
  return true;
}

interface Labels {
  platform: UpdatePlatform;
  component: UpdateComponent;
  source: UpdateEventSource;
}

/** §4.6 m.2: olay metriği + güvenlik reddi metriği. */
export function countEvent(m: Metrics, l: Labels, e: UpdateEvent): void {
  m.inc("rs_agent_update_total", { platform: l.platform, component: l.component, result: e.type, source: l.source });
  if (e.type === "failed" && isUpdateSecurityReason(e.reason))
    m.inc("rs_agent_update_rejected_total", { reason: e.reason ?? "", source: l.source });
}

export function countRateLimited(m: Metrics, l: Labels, n = 1): void {
  if (n > 0) m.inc("rs_agent_update_total", { platform: l.platform, component: l.component, result: "rate_limited", source: l.source }, n);
}

function auditValue(e: UpdateEvent, l: Labels): JsonObject {
  return {
    fromVersion: e.fromVersion,
    version: e.version,
    ...(e.reason ? { reason: e.reason } : {}),
    platform: l.platform,
    component: l.component,
    source: l.source,
  };
}

const resultOf = (e: UpdateEvent): "success" | "fail" => (e.type === "failed" || e.type === "rolled_back" ? "fail" : "success");

type Tx = Prisma.TransactionClient;

/** §3.2 durum yazımı (dört alan tek UPDATE, `WHERE id AND tenant_id AND revoked_at IS NULL`); değişen satır sayısı. */
async function writeDeviceState(tx: Tx, deviceId: string, tenantId: string, e: UpdateEvent, at: Date): Promise<number> {
  const where = { id: deviceId, tenantId, revokedAt: null };
  if (e.type === "installed") {
    const r = await tx.unattendedDevice.updateMany({
      where,
      data: { updateState: null, updateVersion: null, updateReason: null, updateAt: null },
    });
    return r.count;
  }
  const state =
    e.type === "available" ? "AVAILABLE" : e.type === "failed" ? "FAILED" : e.type === "rolled_back" ? "ROLLED_BACK" : "SKIPPED";
  // §4.7: `available` sürüm başına bir kez — aynı satır zaten AVAILABLE/v ise değişmez (NULL-güvenli koşul) → audit yok.
  const dedupe: Prisma.UnattendedDeviceWhereInput =
    e.type === "available"
      ? {
          OR: [
            { updateState: null },
            { updateState: { not: "AVAILABLE" } },
            { updateVersion: null },
            { updateVersion: { not: e.version } },
          ],
        }
      : {};
  const r = await tx.unattendedDevice.updateMany({
    where: { ...where, ...dedupe },
    data: { updateState: state, updateVersion: e.version, updateReason: e.reason ?? null, updateAt: at },
  });
  return r.count;
}

/** Servis olayı (WS, kaynak `device`): durum sütunları + audit aynı TX'te. Satır değişmediyse (iptal / yinelenen available) audit yok. */
export async function recordDeviceEvent(
  d: EventDeps,
  ctx: AuditContext,
  conn: { deviceId: string; tenantId: string },
  e: UpdateEvent,
): Promise<void> {
  const l: Labels = { platform: "windows", component: "service", source: "device" };
  countEvent(d.metrics, l, e);
  await d.db.$transaction(async (tx) => {
    if ((await writeDeviceState(tx, conn.deviceId, conn.tenantId, e, new Date(d.now()))) === 0) return;
    await writeAudit(tx, ctx, {
      tenantId: conn.tenantId,
      username: "device",
      action: CLIENT_UPDATE_AUDIT_BY_EVENT[e.type],
      entity: "unattended_devices",
      entityId: conn.deviceId,
      result: resultOf(e),
      newValue: auditValue(e, l),
    });
  });
}

/** `update.state{installing}` (§4.3): yalnız durum (reason NULL) + metrik; audit yok. */
export async function recordInstalling(d: EventDeps, conn: { deviceId: string; tenantId: string }, version: string): Promise<void> {
  d.metrics.inc("rs_agent_update_total", { platform: "windows", component: "service", result: "installing", source: "device" });
  await d.db.unattendedDevice.updateMany({
    where: { id: conn.deviceId, tenantId: conn.tenantId, revokedAt: null },
    data: { updateState: "INSTALLING", updateVersion: version, updateReason: null, updateAt: new Date(d.now()) },
  });
}

/**
 * Kayıtlı bilgisayar olayı (kaynak `binding`): ilgili tenant'ın audit'ine, entity `device_bindings`. KVKK (S-P13a-1): müşteri
 * bilgisayarı aktörlü satırda tam IP ve UA tutulmaz — IP ağ önekine indirilir, UA yazılmaz (username §4.7 gereği `client`).
 */
export async function auditBindingEvent(
  db: Db,
  ctx: AuditContext,
  b: { bindingId: string; tenantId: string },
  e: UpdateEvent,
  l: { platform: UpdatePlatform; component: UpdateComponent },
): Promise<void> {
  const customerCtx: AuditContext = { ip: ctx.ip ? netKey(ctx.ip) : "", userAgent: "", requestId: ctx.requestId };
  await writeAudit(db, customerCtx, {
    tenantId: b.tenantId,
    username: "client",
    action: CLIENT_UPDATE_AUDIT_BY_EVENT[e.type],
    entity: "device_bindings",
    entityId: b.bindingId,
    result: resultOf(e),
    newValue: auditValue(e, { ...l, source: "binding" }),
  });
}
