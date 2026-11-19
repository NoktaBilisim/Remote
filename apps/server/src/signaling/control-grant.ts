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
import { sendController } from "./members.ts";
import type { Rooms } from "./rooms.ts";
import type { ConsentSource, Guest, Room } from "./types.ts";
import { controlToggled } from "./unattended-control.ts";

/** K8: GRANTED audit'i için istemcinin yönetici durumu; env.state hiç gelmediyse "unknown". */
/**
 * İşletim sistemi izni yüzünden diyaloğun açılmadığı kaynaklar (P28f `OS_PERMISSION`, P28g `WAYLAND_NO_CONTROL`): yalnız bekleyen
 * isteği iptal eder; audit `source` ve metrik adı bu değerden. Kaynak–OS eşleşmesi `handleControlState`'te denetlenir.
 */
const OS_CANCEL_SOURCES: Partial<Record<ControlSource, "os_permission" | "wayland_no_control">> = {
  OS_PERMISSION: "os_permission",
  WAYLAND_NO_CONTROL: "wayland_no_control",
};

/**
 * P28g K10 (D-P28g-K1-2): Linux X11 `OS_PERMISSION`'ı (XTest/XI2/kısayol/kilit izleyicisi yok) audit ve metrikte macOS
 * Erişilebilirlik izninden ayrılır: `linux_no_control`. macOS kaydı (AC-391) değişmez.
 */
const cancelSourceOf = (source: ControlSource, guest: Guest): "os_permission" | "wayland_no_control" | "linux_no_control" | undefined => {
  const s = OS_CANCEL_SOURCES[source];
  return s === "os_permission" && guest.clientOs === "linux" ? "linux_no_control" : s;
};

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
  controlToggled(rooms, room, true); // P28u §8.2
  sendController(room, { t: "control.state", state: "GRANTED", source });
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
    sendController(room, { t: "error", code: "INTERNAL", message: `Kontrol kaydı yazılamadı; kontrol geri alındı (ref: ${ref}).` });
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
  // P28f (§4.2): OS_PERMISSION yalnız bekleyen isteği iptal eder; başka fazda yok sayılır (asla REVOKED/consent kaydı olmaz).
  // P28g (§4.2, S-P28g-12): WAYLAND_NO_CONTROL aynı kural.
  const cancelSource = cancelSourceOf(source, guest);
  if (cancelSource && c.state !== "REQUESTED") {
    rooms.metrics.inc("rs_control_total", { event: `${cancelSource}_ignored` });
    return;
  }
  if (c.state === "VIEW") return; // sunucu kapattıktan sonraki istemci onayı (SYSTEM) — zaten kayıtlı
  const was = c.state;
  c.state = "VIEW";
  c.epoch += 1;
  onControlClosed(rooms, room); // P28a (Y-P28a-1): müşteri kontrolü kapattı
  sendController(room, { t: "control.state", state: "VIEW", source });
  if (was === "REQUESTED") {
    // §3.3 K6: bekleyen istek müşteri kararı olmadan istemcide kapandı (ör. PeerConnection koptu). Consent yok (müşteriye
    // ret atfedilmez), 30 sn bekleme/sayaç yok; control.requested'in kapanışı audit control.cancelled{by:"agent"} (en iyi çaba).
    // P28f (§4.2, AC-391): OS_PERMISSION = misafirde Erişilebilirlik izni yok; P28g (AC-399): WAYLAND_NO_CONTROL = Wayland
    // portalında girdi izni yok; K10: Linux X11'de OS_PERMISSION = kontrol koşulu yok. Aynı iptal yolu; audit kaynağı
    // `os_permission` / `wayland_no_control` / `linux_no_control`.
    rooms.metrics.inc("rs_control_total", { event: cancelSource ? `cancelled_${cancelSource}` : "cancelled_by_agent" });
    void writeAudit(rooms.db, guestCtx(guest), {
      tenantId: room.tenantId,
      ...CUSTOMER,
      action: CONTROL_AUDIT.CANCELLED,
      entity: "support_sessions",
      entityId: room.sessionId,
      result: "success",
      newValue: { by: "agent", source: cancelSource ?? source },
    }).catch((err: unknown) => void logFail(rooms, room, "control_cancel_audit_failed", err));
    return;
  }
  rooms.metrics.inc("rs_control_total", { event: `revoked_${source.toLowerCase()}` });
  controlToggled(rooms, room, false); // P28u §8.2
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
  sendController(room, { t: "control.state", state: "VIEW", source: "DENIED" });
  rooms.metrics.inc("rs_control_total", { event: "denied" });
  await recordControl(rooms, room, "DENIED", "UI", guestCtx(guest), CUSTOMER, CONTROL_AUDIT.DENIED).catch(
    (err: unknown) => void logFail(rooms, room, "control_deny_audit_failed", err),
  );
}
