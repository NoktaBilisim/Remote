// P28c audit + metrik yardımcıları (mimari-p28c §8, §9; AC-370). Tüm olaylar `entity=support_sessions`, `entity_id=sessionId`.
// Ret alt kodu `failReason` (audit maskesi `/code/i` anahtarını gizler; K0 sapma 4). Sohbet/ad içeriği loga yazılmaz.
import { MULTI_AUDIT, type MultiAuditAction } from "@remote/contracts/audit";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { JsonObject } from "../audit/mask.ts";
import { newId } from "../lib/ids.ts";
import type { Rooms } from "./rooms.ts";
import type { Room } from "./types.ts";

export { MULTI_AUDIT };
export const MULTI_SYSTEM_CTX: AuditContext = { ip: "", userAgent: "signaling", requestId: "" };
export type MultiActor = { userId?: string; username: string };
export const SYSTEM_ACTOR: MultiActor = { username: "system" };
export const CUSTOMER_ACTOR: MultiActor = { username: "customer" };

/** En iyi çaba (beklenmez); hata log + ref. */
export function auditMulti(
  rooms: Rooms,
  room: Pick<Room, "tenantId" | "sessionId">,
  ctx: AuditContext,
  actor: MultiActor,
  action: MultiAuditAction,
  newValue: JsonObject,
  result: "success" | "fail" = "success",
): Promise<void> {
  return writeAudit(rooms.db, ctx, {
    tenantId: room.tenantId,
    ...actor,
    action,
    entity: "support_sessions",
    entityId: room.sessionId,
    result,
    newValue,
  }).catch((err: unknown) => {
    rooms.log.error(
      { err, ref: newId(), event: "multi_audit_failed", action, sessionId: room.sessionId },
      "çoklu teknisyen audit'i yazılamadı",
    );
  });
}

/** D-PC-3: aynı (kullanıcı, oturum, ret nedeni) için `fail` audit'i dakikada en çok 1. */
const failSeen = new WeakMap<Rooms, Map<string, number>>();
export function failAuditAllowed(rooms: Rooms, userId: string, sessionId: string, failReason: string): boolean {
  let m = failSeen.get(rooms);
  if (!m) failSeen.set(rooms, (m = new Map()));
  const now = rooms.clock.now();
  if (m.size > 5_000) for (const [k, t] of m) if (now - t >= 60_000) m.delete(k);
  const key = `${userId}:${sessionId}:${failReason}`;
  const at = m.get(key);
  if (at !== undefined && now - at < 60_000) return false;
  m.set(key, now);
  return true;
}

/** `rs_multi_invites_total{result}`. */
export const countInvite = (rooms: Rooms, result: "sent" | "accepted" | "rejected" | "expired"): void =>
  rooms.metrics.inc("rs_multi_invites_total", { result });
