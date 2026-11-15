// P7 kontrolün sunucu kaynaklı geri alınması (A4, A5; AC-24, 115; G-04, G-09; §3.3 K3, K5-d): yetki daralması,
// taraf kopması, oturum sonu. Kapatma yönündeki hiçbir yol DB yazımını beklemez: önce bellek + mesaj, sonra kayıt.
import { CONTROL_AUDIT } from "@remote/contracts/audit";
import type { PermissionKey } from "@remote/contracts/permissions";
import type { Cap, ControlRevokeReason } from "@remote/contracts/ws";
import { writeAudit } from "../audit/service.ts";
import { closeState, logFail, recordClose, SYSTEM, SYSTEM_CTX, systemClose } from "./control-record.ts";
import type { Rooms } from "./rooms.ts";
import type { Room } from "./types.ts";

/**
 * Sunucu kaynaklı kapatma (A5, AC-115, G-04): misafire `control.revoke` (istemci kapıyı kapatır, açamaz), teknisyene
 * `control.state{VIEW, SYSTEM}`. Kontrol açıktıysa REVOKED/SYSTEM kaydı yazılır.
 */
export async function revokeControl(rooms: Rooms, room: Room, reason: ControlRevokeReason): Promise<void> {
  const r = closeState(room.control);
  if (!r) return;
  room.admitted?.peer?.send({ t: "control.revoke", reason });
  room.tech?.peer.send({ t: "control.state", state: "VIEW", source: "SYSTEM" });
  rooms.metrics.inc("rs_control_total", { event: `revoke_${reason}` });
  if (r.opened) await recordClose(rooms, room, r.granting, systemClose({ reason }), "control_revoke_audit_failed");
}

/**
 * Misafir kopması (A4, AC-24): kontrol VIEW'a döner, teknisyen `control.state{VIEW, RECONNECT}` alır; yeniden bağlanan
 * istemci kapıyı kapalı başlatır. Açık kontrol REVOKED/RECONNECT olarak kaydedilir. Bekleyen monitör isteği temizlenir
 * (S7-15; K3 teknisyen tarafıyla simetrik): yeniden bağlanan istemci diyaloğu görmedi, teknisyen CONFLICT almaz.
 */
export function resetOnGuestGone(rooms: Rooms, room: Room): void {
  room.control.monitorPending = undefined;
  room.guestEnv = undefined; // K8: yeniden bağlanan istemci hello sonrası yeni env.state gönderir
  const r = closeState(room.control);
  if (!r) return;
  room.tech?.peer.send({ t: "control.state", state: "VIEW", source: "RECONNECT" });
  rooms.metrics.inc("rs_control_total", { event: "reset_guest_gone" });
  if (r.opened)
    void recordClose(
      rooms,
      room,
      r.granting,
      {
        source: "RECONNECT",
        action: CONTROL_AUDIT.REVOKED,
        ctx: SYSTEM_CTX,
        actor: SYSTEM,
        extra: { reason: "disconnect", side: "guest" },
      },
      "control_revoke_audit_failed",
    );
}

/**
 * Teknisyen kopması / sekme değişimi (§3.3 K3): VIEW, bekleyen monitör isteği temizlenir; bağlı (ADMITTED) misafire
 * **her zaman** `control.revoke{reconnect}` — çağıran ardından `peer.left{tech}` / `peer.joined{tech}` gönderir (sıra:
 * önce revoke). Açık kontrol REVOKED/RECONNECT olarak kaydedilir.
 */
export function revokeOnTechChange(rooms: Rooms, room: Room): void {
  room.control.monitorPending = undefined;
  const r = closeState(room.control);
  room.admitted?.peer?.send({ t: "control.revoke", reason: "reconnect" });
  rooms.metrics.inc("rs_control_total", { event: "revoke_reconnect" });
  if (r?.opened)
    void recordClose(
      rooms,
      room,
      r.granting,
      { source: "RECONNECT", action: CONTROL_AUDIT.REVOKED, ctx: SYSTEM_CTX, actor: SYSTEM, extra: { reason: "disconnect", side: "tech" } },
      "control_revoke_audit_failed",
    );
}

/**
 * Oturum sonu (§3.3 K5-d): `session.ended` gönderildikten sonra, açık kontrol için en iyi çabayla REVOKED/SYSTEM +
 * `control.revoked{session_ended}`. Yazılamazsa log + ref; bitişi engellemez (beklenmez).
 */
export function closeControlOnEnd(rooms: Rooms, room: Room): void {
  room.control.monitorPending = undefined;
  const r = closeState(room.control);
  if (!r?.opened) return;
  rooms.metrics.inc("rs_control_total", { event: "revoke_session_ended" });
  void recordClose(rooms, room, r.granting, systemClose({ reason: "session_ended" }), "control_end_audit_failed");
}

const CAP_PERM: Record<Cap, PermissionKey> = { remote_control: "remote_control.use", file_transfer: "file_transfer.use" };

/**
 * Yetki daralması (S-P3-8, AC-115, G-09): caps yalnız daralır (genişleme yeni oturumda). Değişirse misafire
 * `caps.update`; `remote_control` düştüyse açık/bekleyen kontrol `control.revoke{permission}` ile kapanır.
 */
export async function narrowCaps(rooms: Rooms, room: Room, perms: ReadonlySet<PermissionKey>): Promise<void> {
  const next = room.caps.filter((cap) => perms.has(CAP_PERM[cap]));
  if (next.length === room.caps.length) return;
  const old = room.caps;
  room.caps = next;
  room.admitted?.peer?.send({ t: "caps.update", caps: next });
  rooms.metrics.inc("rs_control_total", { event: "caps_narrowed" });
  const jobs: Promise<void>[] = [];
  if (!next.includes("remote_control")) jobs.push(revokeControl(rooms, room, "permission"));
  jobs.push(
    writeAudit(rooms.db, SYSTEM_CTX, {
      tenantId: room.tenantId,
      ...SYSTEM,
      action: CONTROL_AUDIT.CAPS_CHANGED,
      entity: "support_sessions",
      entityId: room.sessionId,
      result: "success",
      oldValue: { caps: old.join(",") },
      newValue: { caps: next.join(",") },
    }).catch((err: unknown) => void logFail(rooms, room, "caps_audit_failed", err)),
  );
  await Promise.all(jobs);
}
