// guest.admit / guest.reject (mimari-protokol §3, §3.1, §3.2; A1). Tüketim yalnız burada: tek atomik koşullu
// UPDATE (repo.consumeForAdmit) + audit aynı TX; hello/peer.joined ancak commit sonrası (P3 giriş şartı 2).
import type { SessionEndedReason } from "@remote/contracts/ws";
import { effectivePermissions, type Role } from "@remote/contracts/permissions";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { ipKey, netKey } from "../lib/ip.ts";
import { syncDisconnect } from "./active.ts";
import { recordViewConsent } from "../public/consent.ts";
import * as repo from "../sessions/repo.ts";
import { admitHash, type Rooms } from "./rooms.ts";
import { ADMIT_FAIL_MAX, type Guest, type Peer, type Room, type TechConn } from "./types.ts";
import { safeEqual } from "../lib/ids.ts";

export type AdmitResult = "admitted" | "invalid" | "conflict";

const actor = (t: TechConn) => ({ userId: t.userId, username: t.username });

/**
 * P8 (AC-62): müşteri adı/e-postası admit UPDATE'inde yazılır. join şeması uzunluğu kod noktasıyla sayar (QA-P8-2,
 * DB CHAR_LENGTH ile aynı); buradaki NULL'a düşme yalnız gerçekten geçersiz değerde (savunma) — CHECK admit'i düşürmesin.
 */
function customerOf(g: Guest): { name: string | null; email: string | null } {
  const name = [...g.name].length >= 2 ? g.name : null;
  return { name, email: name ? (g.email ?? null) : null };
}

export async function admitGuest(rooms: Rooms, room: Room, tech: TechConn, code: string): Promise<AdmitResult> {
  const audit = (result: "success" | "fail", newValue: Record<string, string>, tx: Parameters<typeof writeAudit>[0] = rooms.db) =>
    writeAudit(tx, tech.ctx, {
      tenantId: room.tenantId,
      ...actor(tech),
      action: result === "success" ? "guest.admitted" : "guest.admit",
      entity: "support_sessions",
      entityId: room.sessionId,
      result,
      newValue,
    });
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
      const keys = guest.netKey && guest.ipKey ? { guestIpKey: guest.ipKey, guestNetKey: guest.netKey } : {};
      const rid = guest.requestId; // P15 (AC-239): kabul kodlu talep oturumu — tüketim `AND request_id = :rid`
      const extra = rid ? { ...keys, requestId: rid } : keys;
      if ((await repo.consumeForAdmit(tx, room.sessionId, now, guest.kind, customerOf(guest), extra)) !== 1) return false; // count=0 → consent yazılmaz
      // Talep oturumunda onay kaydı bu bağlantının IP/UA'sıyla (admitRequestGuest ile aynı kural, §5.2 adım 2).
      const c = rid
        ? { ...guest.consent, at: now, ip: guest.ctx?.ip ?? "", userAgent: (guest.ctx?.userAgent ?? "").slice(0, 300) }
        : guest.consent;
      await recordViewConsent(tx, room.sessionId, room.tenantId, c, rid);
      await audit(
        "success",
        {
          guestId: guest.id,
          guestKind: guest.kind,
          consentTextId: c.textId,
          consentVersion: String(c.version),
          consentSha256: c.sha256,
          ...(rid ? { via: "request", requestId: rid } : {}),
        },
        tx,
      );
      return true;
    });
  } finally {
    room.admitting = false;
  }
  if (!ok) {
    // count=0: iptal / süre dolumu / başka admit kazandı (§3.2 adım 2). Oda iptalle kapanmış olabilir.
    const row = await repo.findStatus(rooms.db, room.sessionId);
    const reason: SessionEndedReason =
      row?.status === "CANCELLED" ? "cancelled" : row?.status === "PENDING" || row?.status === "EXPIRED" ? "timeout" : "rejected";
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
  if (guest.requestId) rooms.requestHooks?.admitted(guest.requestId); // P15 (AC-239): bağlanma zamanlayıcısı durur
  const limits = await repo.activeLimits(rooms.db, room.tenantId);
  room.maxFileMb = limits.maxFileMb;
  rooms.startActive(room, guest, now.getTime(), limits.maxActiveHours);
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
  await writeAudit(rooms.db, tech.ctx, {
    tenantId: room.tenantId,
    ...actor(tech),
    action: "guest.rejected",
    entity: "support_sessions",
    entityId: room.sessionId,
    result: "success",
    newValue: { guestId },
  }); // S-P13a-1: ad yok
}

/**
 * P8b ön-kabullü misafir (mimari-protokol §5.2, mimari-e9 §13.2): lobi/admitCode yok. Caps teknisyenin DB'deki etkin
 * yetkilerinden (TechConn aranmaz); kullanıcı/tenant pasifse UPDATE yok → oturum CANCELLED(auth_revoked) + talep
 * CONNECT_FAILED (talep servisi). Tüketim `AND request_id = :rid` ile; aynı TX'te onay kaydı (bu bağlantının IP/UA'sı,
 * request_id) + audit `guest.admitted{via:"request", requestId, acceptedBy}` (actor customer; müşteri adı yok —
 * mimari-e9 §13.7, QA-P8b-11). Teknisyen yoksa kopma zamanlayıcısı hemen başlar.
 *
 * S8b-2: aynı misafire eşzamanlı iki /ws/guest (eski + yeni kuşak ticket) gelebilir. `room.admitting` ilk await'ten
 * önce kurulur; `guest.peer` yalnız admit kazanılınca bu bağlantıya atanır; kaybeden yalnız kendi soketini kapatır.
 */
export async function admitRequestGuest(rooms: Rooms, room: Room, guest: Guest, peer: Peer, ctx: AuditContext): Promise<AdmitResult> {
  const requestId = guest.requestId;
  if (!requestId || room.admitted || room.admitting) {
    peer.close(1008, "conflict"); // oturum sürüyor (diğer bağlantı); yalnız bu yinelenen soket kapanır
    rooms.metrics.inc("rs_admit_total", { result: "conflict" });
    return "conflict";
  }
  const endGuest = (reason: SessionEndedReason): void => {
    peer.send({ t: "session.ended", reason });
    peer.close(1000, reason);
  };
  room.admitting = true; // ilk await'ten önce: ikinci bağlantı DB'ye gitmeden yukarıda reddedilir
  const now = new Date(rooms.clock.now());
  let ok = false;
  let perms: Set<string>;
  try {
    const tech = await rooms.db.user.findUnique({
      where: { id: room.technicianId },
      select: {
        role: true,
        status: true,
        deletedAt: true,
        tenantId: true,
        tenant: { select: { status: true, deletedAt: true } },
        permissions: { select: { permKey: true, granted: true } },
      },
    });
    const active =
      tech &&
      tech.status === "ACTIVE" &&
      tech.deletedAt === null &&
      (tech.tenantId === null || (tech.tenant?.status === "ACTIVE" && tech.tenant.deletedAt === null));
    if (!tech || !active) {
      endGuest("auth_revoked");
      rooms.requestHooks?.failed(requestId);
      rooms.metrics.inc("rs_admit_total", { result: "request_auth_revoked" });
      return "conflict";
    }
    perms = new Set(effectivePermissions(tech.role as Role, tech.permissions));
    ok = await rooms.db.$transaction(async (tx) => {
      const keys = { guestIpKey: ipKey(ctx.ip), guestNetKey: netKey(ctx.ip) };
      if ((await repo.consumeForAdmit(tx, room.sessionId, now, guest.kind, customerOf(guest), { ...keys, requestId })) !== 1) return false;
      const consent = { ...guest.consent, at: now, ip: ctx.ip, userAgent: ctx.userAgent.slice(0, 300) };
      await recordViewConsent(tx, room.sessionId, room.tenantId, consent, requestId);
      await writeAudit(tx, ctx, {
        tenantId: room.tenantId,
        username: "customer",
        action: "guest.admitted",
        entity: "support_sessions",
        entityId: room.sessionId,
        result: "success",
        newValue: {
          via: "request",
          requestId,
          acceptedBy: room.technicianId,
          guestKind: guest.kind,
          consentTextId: consent.textId,
          consentSha256: consent.sha256,
        },
      });
      return true;
    });
  } finally {
    room.admitting = false;
  }
  if (!ok) {
    endGuest("timeout"); // §5.2 adım 3: talep süpürücüde CONNECT_FAILED
    rooms.metrics.inc("rs_admit_total", { result: "conflict" });
    return "conflict";
  }
  if (!rooms.live(room)) {
    peer.close(1000, "ended");
    return "conflict";
  }
  rooms.requestHooks?.admitted(requestId);
  room.lobby.delete(guest.id);
  guest.state = "ADMITTED";
  guest.peer = peer; // S8b-2: yalnız kazanan bağlantı
  room.admitted = guest;
  room.caps = [
    ...(perms.has("remote_control.use") ? (["remote_control"] as const) : []),
    ...(perms.has("file_transfer.use") ? (["file_transfer"] as const) : []),
  ];
  const limits = await repo.activeLimits(rooms.db, room.tenantId);
  room.maxFileMb = limits.maxFileMb;
  rooms.startActive(room, guest, now.getTime(), limits.maxActiveHours);
  syncDisconnect(rooms, room); // §13.2 teknisyen-yok zamanlayıcısı
  rooms.metrics.inc("rs_admit_total", { result: "admitted" });
  // Soket admit sürerken kapandıysa `close` olayı (guest.peer henüz atanmamışken) etkisiz kaldı; ayrılmayı şimdi uygula.
  if (!peer.isOpen()) rooms.detachGuest(room, guest, peer);
  return "admitted";
}
