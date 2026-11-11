// guest.admit / guest.reject (mimari-protokol §3, §3.1, §3.2; A1). Tüketim yalnız burada: tek atomik koşullu
// UPDATE (repo.consumeForAdmit) + audit aynı TX; hello/peer.joined ancak commit sonrası (P3 giriş şartı 2).
import type { SessionEndedReason } from "@remote/contracts/ws";
import { writeAudit } from "../audit/service.ts";
import { recordViewConsent } from "../public/consent.ts";
import * as repo from "../sessions/repo.ts";
import { admitHash, type Rooms } from "./rooms.ts";
import { ADMIT_FAIL_MAX, type Room, type TechConn } from "./types.ts";
import { safeEqual } from "../lib/ids.ts";

export type AdmitResult = "admitted" | "invalid" | "conflict";

const actor = (t: TechConn) => ({ userId: t.userId, username: t.username });

export async function admitGuest(rooms: Rooms, room: Room, tech: TechConn, code: string): Promise<AdmitResult> {
  const audit = (result: "success" | "fail", newValue: Record<string, string>, tx: Parameters<typeof writeAudit>[0] = rooms.db) =>
    writeAudit(tx, tech.ctx, { tenantId: room.tenantId, ...actor(tech), action: result === "success" ? "guest.admitted" : "guest.admit", entity: "support_sessions", entityId: room.sessionId, result, newValue });
  const conflict = async (why: string): Promise<AdmitResult> => {
    tech.peer.send({ t: "error", code: "CONFLICT", message: "Katılımcı kabul edilemedi: oturum artık uygun durumda değil." });
    await audit("fail", { reason: why });
    rooms.metrics.inc("rs_admit_total", { result: "conflict" });
    return "conflict";
  };
  if (room.admitted || room.admitting) return conflict("already_admitted");
  const guest = [...room.lobby.values()].find((g) => g.state === "LOBBY" && safeEqual(g.admitHash, admitHash(g.id, code)));
  if (!guest) {
    room.admitFails += 1;
    tech.peer.send({ t: "error", code: "ADMIT_CODE_INVALID", message: "Kod eşleşmedi. Müşterinin ekranındaki kodu tekrar sorun." });
    await audit("fail", { reason: "code_mismatch", fails: String(room.admitFails) });
    rooms.metrics.inc("rs_admit_total", { result: "invalid" });
    if (room.admitFails >= ADMIT_FAIL_MAX) for (const g of [...room.lobby.values()]) rooms.leaveLobby(room, g, "rejected", "rejected");
    return "invalid";
  }

  room.admitting = true; // aynı odada ikinci admit DB'ye gitmeden CONFLICT alır
  const now = new Date(rooms.clock.now());
  let ok = false;
  try {
    ok = await rooms.db.$transaction(async (tx) => {
      if ((await repo.consumeForAdmit(tx, room.sessionId, now, guest.kind)) !== 1) return false; // count=0 → consent yazılmaz
      await recordViewConsent(tx, room.sessionId, room.tenantId, guest.consent);
      const c = guest.consent;
      await audit("success", { guestId: guest.id, name: guest.name, guestKind: guest.kind, consentTextId: c.textId, consentVersion: String(c.version), consentSha256: c.sha256 }, tx);
      return true;
    });
  } finally {
    room.admitting = false;
  }
  if (!ok) {
    // count=0: iptal / süre dolumu / başka admit kazandı (§3.2 adım 2). Oda iptalle kapanmış olabilir.
    const row = await repo.findStatus(rooms.db, room.sessionId);
    const reason: SessionEndedReason = row?.status === "CANCELLED" ? "cancelled" : row?.status === "PENDING" || row?.status === "EXPIRED" ? "timeout" : "rejected";
    if (rooms.live(room)) for (const g of [...room.lobby.values()]) rooms.leaveLobby(room, g, "rejected", reason);
    return conflict(`status_${row?.status ?? "missing"}`);
  }
  if (!rooms.live(room)) return "conflict"; // pratikte olmaz: ACTIVE'e geçen oturumu iptal edemez

  rooms.clock.clearTimeout(guest.timer);
  room.lobby.delete(guest.id);
  for (const g of [...room.lobby.values()]) rooms.leaveLobby(room, g, "rejected", "rejected");
  guest.state = "ADMITTED";
  room.admitted = guest;
  room.caps = [
    ...(tech.permissions.has("remote_control.use") ? (["remote_control"] as const) : []),
    ...(tech.permissions.has("file_transfer.use") ? (["file_transfer"] as const) : []),
  ];
  const hours = await repo.maxActiveHours(rooms.db, room.tenantId);
  rooms.startActive(room, guest, now.getTime(), hours);
  rooms.metrics.inc("rs_admit_total", { result: "admitted" });
  return "admitted";
}

/** Ret (AC-113): misafire session.ended{rejected}, ipKey bu oturumun ret listesine, kod geçerli kalır. */
export async function rejectGuest(rooms: Rooms, room: Room, tech: TechConn, guestId: string): Promise<void> {
  const guest = room.lobby.get(guestId);
  if (!guest || guest.state !== "LOBBY") {
    tech.peer.send({ t: "error", code: "NOT_FOUND", message: "Bekleyen katılımcı bulunamadı." });
    return;
  }
  room.rejectedIps.add(guest.ipKey);
  rooms.leaveLobby(room, guest, "rejected", "rejected");
  await writeAudit(rooms.db, tech.ctx, { tenantId: room.tenantId, ...actor(tech), action: "guest.rejected", entity: "support_sessions", entityId: room.sessionId, result: "success", newValue: { guestId, name: guest.name } });
}
