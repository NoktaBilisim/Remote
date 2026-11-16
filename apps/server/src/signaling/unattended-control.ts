// P28u gözetimsiz odada kontrol geçişi kancaları (mimari-p28u §8.2, §8.2a; AC-439; K-P28u-10, K-P28u-16). `control_toggle`
// audit'i her gözetimsiz kipte tek yoldan (açılış `onGranted`, kapanış `recordClose` / `onView`); `controlOn` bayrağı çift
// yazımı önler (açılışı hiç commit edilmemiş kapanış yazılmaz). Kontrol isteği: AC-116 sayacı yerine oda başına 30/dk.
import { UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { writeAudit } from "../audit/service.ts";
import { logFail, SYSTEM, SYSTEM_CTX } from "./control-record.ts";
import type { Rooms } from "./rooms.ts";
import type { Room } from "./types.ts";

/** K-P28u-16: gözetimsiz odada oda başına dakikada en çok bu kadar `control.request`. */
export const UNATTENDED_CONTROL_PER_MIN = 30;

/** Kontrol açıldı (`on`) / kapandı; gözetimsiz olmayan odada ya da durum değişmediyse no-op. Beklenmez (en iyi çaba). */
export function controlToggled(rooms: Rooms, room: Room, on: boolean): void {
  const u = room.unattended;
  if (!u || Boolean(u.controlOn) === on) return;
  u.controlOn = on;
  void writeAudit(rooms.db, SYSTEM_CTX, {
    tenantId: room.tenantId,
    ...SYSTEM,
    action: UNATTENDED_AUDIT.CONTROL_TOGGLE,
    entity: "support_sessions",
    entityId: room.sessionId,
    result: "success",
    newValue: { from: on ? "view" : "control", to: on ? "control" : "view", consentMode: u.consentMode ?? null },
  }).catch((err: unknown) => void logFail(rooms, room, "unattended_control_toggle_audit_failed", err));
}

/** Gözetimsiz oda kovası: sınır aşıldıysa true (istek iletilmez). */
export function unattendedControlLimited(rooms: Rooms, room: Room): boolean {
  const u = room.unattended;
  if (!u) return false;
  const now = rooms.clock.now();
  const recent = (u.controlReqAt ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= UNATTENDED_CONTROL_PER_MIN) {
    u.controlReqAt = recent;
    rooms.metrics.inc("rs_control_total", { event: "unattended_rate" });
    return true;
  }
  u.controlReqAt = [...recent, now];
  return false;
}
