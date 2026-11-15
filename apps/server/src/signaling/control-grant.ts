// P7 `control.state` (guest → S → tech) izin/kapatma kararının kaydı (AC-29, 50, 99, 111; §3.3). Açma yönü (GRANTED)
// fail-closed: kayıt 800 ms içinde yazılamazsa kontrol geri alınır (G-15). Giriş control.ts `handleControlState`.
import { CONTROL_AUDIT } from "@remote/contracts/audit";
import type { ControlSource } from "@remote/contracts/ws";
import { writeAudit } from "../audit/service.ts";
import { onControlClosed } from "./clip-print.ts";
import {
  CONTROL_AUDIT_TIMEOUT_MS,
  CUSTOMER,
  guestCtx,
  logFail,
  recordControl,
  recordRevoked,
  settleWithin,
  systemClose,
  unexpected,
} from "./control-record.ts";
import type { Rooms } from "./rooms.ts";
import type { ConsentSource, Guest, Room } from "./types.ts";

/** K8: GRANTED audit'i için istemcinin yönetici durumu; env.state hiç gelmediyse "unknown". */
const selfElevatedOf = (room: Room): "true" | "false" | "unknown" =>
  room.guestEnv === undefined ? "unknown" : room.guestEnv.selfElevated ? "true" : "false";

/** GRANTED kabul edilebilir mi; değilse misafir kapısı gerekirse kapatılır ve false döner. */
function grantAllowed(rooms: Rooms, room: Room, guest: Guest): boolean {
  const c = room.control;
  if (c.state !== "REQUESTED" || c.granting) {
    // §3.3 K2 (QA-P7-4, S7-2): bekleyen istek yokken gelen izin kaydedilmez/iletilmez. VIEW'da (iptal/bırakma ile çapraz
    // yarış veya istenmemiş izin) misafirin kapısı kapatılır; GRANTED'de tekrar — yok say.
    if (c.state === "VIEW" && !c.granting) guest.peer?.send({ t: "control.revoke", reason: "stale" });
    unexpected(rooms, room, "control_state_unexpected", { state: "GRANTED" });
    return false;
  }
  if (!room.caps.includes("remote_control")) {
    // Yetkisi kaldırılmış teknisyene izin verilemez: kapı hemen kapatılır (AC-115).
    c.state = "VIEW";
    c.epoch += 1;
    guest.peer?.send({ t: "control.revoke", reason: "permission" });
    rooms.metrics.inc("rs_control_total", { event: "grant_without_cap" });
    return false;
  }
  return true;
}

/** `source`: `UI` (yerel "İzin ver") ya da P27 `UNATTENDED` (yalnız gözetimsiz odada; control.ts süzer). */
export async function onGranted(rooms: Rooms, room: Room, guest: Guest, source: "UI" | "UNATTENDED" = "UI"): Promise<void> {
  const c = room.control;
  if (!rooms.live(room) || room.admitted !== guest) return;
  if (!grantAllowed(rooms, room, guest)) return;
  const epoch = c.epoch;
  c.granting = true;
  c.interrupt = undefined;
  const write = recordControl(rooms, room, "GRANTED", source, guestCtx(guest), CUSTOMER, CONTROL_AUDIT.GRANTED, {
    selfElevated: selfElevatedOf(room),
  });
  const outcome = await settleWithin(rooms.clock, write, CONTROL_AUDIT_TIMEOUT_MS);
  c.granting = false;
  if (outcome !== "ok") return grantFailed(rooms, room, guest, write, outcome);
  if (!rooms.live(room) || c.epoch !== epoch) {
    // Kayıt yazılırken kontrol kapatıldı (bırakma, yetki, kopma, oturum sonu): zaman çizelgesi o kapatmayla dengelenir.
    const rec = c.interrupt ?? systemClose({ reason: "superseded" });
    c.interrupt = undefined;
    await recordRevoked(rooms, room, rec).catch((err: unknown) => void logFail(rooms, room, "control_audit_balance_failed", err));
    return;
  }
  c.state = "GRANTED";
  room.tech?.peer.send({ t: "control.state", state: "GRANTED", source });
  rooms.metrics.inc("rs_control_total", { event: "granted" });
}

/** G-15 fail-closed: kayıt yoksa kontrol yok. Geç commit edilen GRANTED (timeout) bir REVOKED ile dengelenir. */
function grantFailed(rooms: Rooms, room: Room, guest: Guest, write: Promise<void>, outcome: "error" | "timeout"): void {
  const c = room.control;
  const ref = logFail(rooms, room, outcome === "timeout" ? "control_grant_audit_timeout" : "control_grant_audit_failed", outcome);
  rooms.metrics.inc("rs_control_total", { event: `grant_audit_${outcome}` });
  const balance = c.interrupt ?? systemClose({ reason: "audit" });
  c.interrupt = undefined;
  c.state = "VIEW";
  c.epoch += 1;
  if (rooms.live(room)) {
    guest.peer?.send({ t: "control.revoke", reason: "audit" });
    room.tech?.peer.send({ t: "error", code: "INTERNAL", message: `Kontrol kaydı yazılamadı; kontrol geri alındı (ref: ${ref}).` });
  }
  if (outcome === "timeout") {
    void write
      .then(
        () => recordRevoked(rooms, room, balance),
        () => undefined,
      )
      .catch((err: unknown) => void logFail(rooms, room, "control_audit_balance_failed", err));
  }
}

export async function onView(rooms: Rooms, room: Room, guest: Guest, source: ControlSource): Promise<void> {
  const c = room.control;
  if (!rooms.live(room) || room.admitted !== guest) return;
  if (source === "DENIED") return onDenied(rooms, room, guest);
  if (c.state === "VIEW") return; // sunucu kapattıktan sonraki istemci onayı (SYSTEM) — zaten kayıtlı
  const was = c.state;
  c.state = "VIEW";
  c.epoch += 1;
  onControlClosed(rooms, room); // P28a (Y-P28a-1): müşteri kontrolü kapattı
  room.tech?.peer.send({ t: "control.state", state: "VIEW", source });
  if (was === "REQUESTED") {
    // §3.3 K6: bekleyen istek müşteri kararı olmadan istemcide kapandı (ör. PeerConnection koptu). Consent yok (müşteriye
    // ret atfedilmez), 30 sn bekleme/sayaç yok; control.requested'in kapanışı audit control.cancelled{by:"agent"} (en iyi çaba).
    rooms.metrics.inc("rs_control_total", { event: "cancelled_by_agent" });
    void writeAudit(rooms.db, guestCtx(guest), {
      tenantId: room.tenantId,
      ...CUSTOMER,
      action: CONTROL_AUDIT.CANCELLED,
      entity: "support_sessions",
      entityId: room.sessionId,
      result: "success",
      newValue: { by: "agent", source },
    }).catch((err: unknown) => void logFail(rooms, room, "control_cancel_audit_failed", err));
    return;
  }
  rooms.metrics.inc("rs_control_total", { event: `revoked_${source.toLowerCase()}` });
  // AC-111: müşteri kapattı (UI) / kısayol (HOTKEY) / istemci kendiliğinden kapattı (SYSTEM).
  const consentSource: ConsentSource = source === "HOTKEY" || source === "SYSTEM" ? source : "UI";
  await recordControl(rooms, room, "REVOKED", consentSource, guestCtx(guest), CUSTOMER, CONTROL_AUDIT.REVOKED).catch(
    (err: unknown) => void logFail(rooms, room, "control_revoke_audit_failed", err),
  );
}

async function onDenied(rooms: Rooms, room: Room, guest: Guest): Promise<void> {
  const c = room.control;
  if (c.state !== "REQUESTED") return; // ret yalnız bekleyen isteğe; tekrarlar kayıt şişirmez
  c.state = "VIEW";
  c.epoch += 1;
  c.deniedAt = rooms.clock.now();
  room.tech?.peer.send({ t: "control.state", state: "VIEW", source: "DENIED" });
  rooms.metrics.inc("rs_control_total", { event: "denied" });
  await recordControl(rooms, room, "DENIED", "UI", guestCtx(guest), CUSTOMER, CONTROL_AUDIT.DENIED).catch(
    (err: unknown) => void logFail(rooms, room, "control_deny_audit_failed", err),
  );
}
