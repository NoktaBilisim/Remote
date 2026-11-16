// P28b WS `fsrv.*` kapısı ve yönlendirme (mimari-p28b §5.2–5.4, r2 D-P28b-3/5; AC-355..360). Kapı 1–6 burada (ilk tutan döner,
// `fsrv.status{xid, REJECTED, reason}`), 7–8 `FsrvService.begin` TX'inde. Bayt WS'den geçmez; yükleme/indirme HTTPS + belirteç.
// Misafir şemasında `fsrv.*` yalnız SERVER odası + `hasFsrv` sokette (handlers.ts); teknisyende her zaman (P2P → MODE).
// Oda kapanışı / taraf ayrılması kancaları `fsrv/lifecycle.ts`'e bağlanır. Kapı retleri audit'e yazılmaz (metrik + log).
import { maxFileBytes } from "@remote/contracts/dc";
import { ID_REUSE_WINDOW } from "@remote/contracts/ws-clip-print";
import {
  FILE_RETENTION_DAYS_DEFAULT,
  FSRV_CHUNK_BYTES,
  FSRV_INIT_PER_MIN,
  FSRV_MAX_BYTES,
  FSRV_PRINT_MAX_BYTES,
  type FsrvDirection,
  type FsrvGateReason,
} from "@remote/contracts/ws-fsrv";
import type { TechInbound } from "@remote/contracts/ws";
import { CUSTOMER_USERNAME, type AuditContext } from "../audit/service.ts";
import * as lifecycle from "../fsrv/lifecycle.ts";
import type { AuditActor, FsrvService, Side } from "../fsrv/service.ts";
import type { TokenActor } from "../fsrv/tokens.ts";
import { newId } from "../lib/ids.ts";
import { actorMay, failPrint } from "./clip-print.ts";
import { hasFsrv } from "./rooms-features.ts";
import { sendController } from "./members.ts";
import type { Rooms } from "./rooms.ts";
import type { FsrvRoom, Guest, Peer, Room, TechConn } from "./types.ts";

type FsrvMsg = Extract<TechInbound, { t: `fsrv.${string}` }>;
type InitMsg = Extract<FsrvMsg, { t: "fsrv.init" }>;

/** Mesajı gönderen taraf: teknisyen bağlantısı ya da ADMITTED misafir. */
export type FsrvFrom = { side: "tech"; peer: Peer; tech: TechConn } | { side: "guest"; peer: Peer; guest: Guest };

const MINUTE_MS = 60_000;
const GUEST_CTX: AuditContext = { ip: "", userAgent: "signaling", requestId: "" };

/** Uygulama bağlantısı (ws.ts `attachSignaling`): servis çıkışını odalara bağlar. Misafire yalnız SERVER + hasFsrv sokete yazılır. */
export function bindFsrv(rooms: Rooms, svc: FsrvService): void {
  rooms.fsrv = svc;
  svc.sink = {
    send(sessionId, side, msg) {
      const room = rooms.get(sessionId);
      if (!room || !rooms.live(room)) return;
      if (side === "tech") return sendController(room, msg); // P28c: teknisyen yönü yalnız kontrol sahibi
      const p = room.admitted?.peer;
      if (p && room.fileMode === "SERVER" && hasFsrv(room, p)) p.send(msg); // eski Go katı ayrıştırır
    },
    printFailed(sessionId, pid) {
      const room = rooms.get(sessionId);
      if (room && rooms.live(room)) failPrint(rooms, room, pid);
    },
  };
}

/** Oda kapandı (teardown): belirteçler + açık aktarımlar (PRINT teklifi EXPIRED, diğerleri CANCELLED). */
export function fsrvRoomClosed(rooms: Rooms, room: Room): void {
  const svc = rooms.fsrv;
  if (!svc || room.fileMode !== "SERVER") return;
  void lifecycle
    .roomClosed(svc, room.sessionId)
    .catch((err: unknown) => rooms.log.error({ err, ref: newId(), sessionId: room.sessionId }, "fsrv oda kapanışı işlenemedi"));
}

/** Misafir/teknisyen ayrıldı: o tarafın indirme belirteçleri düşer (teklif oda kapanana dek açık). */
export function fsrvSideGone(rooms: Rooms, room: Room, who: "TECH" | "CUSTOMER"): void {
  if (rooms.fsrv && room.fileMode === "SERVER") lifecycle.sideGone(rooms.fsrv, room.sessionId, who);
}

const stateOf = (room: Room): FsrvRoom => (room.fsrv ??= { initTimes: [], xids: [], starting: new Set() });

/** `fsrv.*` dağıtımı (handlers.ts). */
export async function handleFsrv(rooms: Rooms, room: Room, from: FsrvFrom, m: FsrvMsg): Promise<void> {
  if (m.t === "fsrv.init") return handleInit(rooms, room, from, m);
  const svc = rooms.fsrv;
  if (!svc || room.fileMode !== "SERVER") return;
  const side: Side = from.side;
  switch (m.t) {
    case "fsrv.accept": {
      // D-P28b-K1-3: teknisyen alıcıysa güncel yetki + oda caps'i yeniden denetlenir (init'ten sonra daralmış olabilir).
      if (from.side === "tech" && !techMayFile(room, from.tech)) return;
      const actor: TokenActor = from.side === "tech" ? { kind: "TECH", userId: from.tech.userId } : { kind: "CUSTOMER" };
      return lifecycle.accept(svc, room.sessionId, m.fid, side, actor);
    }
    case "fsrv.reject":
      return lifecycle.reject(svc, room.sessionId, m.fid, side);
    case "fsrv.result":
      return lifecycle.result(svc, room.sessionId, m.fid, side, m.ok);
    case "fsrv.cancel":
      return lifecycle.cancel(svc, room.sessionId, m.fid, side);
  }
}

const techMayFile = (room: Room, tech: TechConn): boolean =>
  room.caps.includes("file_transfer") && tech.permissions.has("file_transfer.use");

/** Kapı adımı 2 (§5.2, D-P28b-3): FILE → dosya yetkisi/caps; PRINT → P28a bekleyen işle pid + boyut eşleşmesi, ≤ 20 MiB. */
function permissionGate(room: Room, from: FsrvFrom, m: InitMsg): boolean {
  if (m.purpose === "FILE") {
    return from.side === "guest" ? room.caps.includes("file_transfer") : techMayFile(room, from.tech);
  }
  if (from.side !== "tech" || !actorMay(room, from.tech, "print") || room.control.state !== "GRANTED") return false;
  const p = room.clipPrint.printPending;
  return p !== null && p.pid === m.pid && p.sizeBytes === m.size && m.size <= FSRV_PRINT_MAX_BYTES;
}

/** Kapı 1–6 (ilk tutan döner). Geçerse null; xid tekrarı `"reuse"` (VALIDATION, durum mesajı yok). */
function gate(rooms: Rooms, room: Room, svc: FsrvService | undefined, from: FsrvFrom, m: InitMsg): FsrvGateReason | "reuse" | null {
  if (room.fileMode !== "SERVER") return "MODE";
  const st = stateOf(room);
  if (st.xids.includes(m.xid)) return "reuse";
  st.xids.push(m.xid);
  if (st.xids.length > ID_REUSE_WINDOW) st.xids.shift();
  if (!permissionGate(room, from, m)) return "FORBIDDEN";
  const g = room.admitted?.peer;
  if (!svc || !g || !hasFsrv(room, g)) return "UNSUPPORTED";
  const dir = directionOf(from);
  if (st.starting.has(dir) || svc.busy(room.sessionId, dir)) return "BUSY";
  if (m.size > Math.min(maxFileBytes(room.maxFileMb ?? 0), FSRV_MAX_BYTES)) return "TOO_LARGE";
  const now = rooms.clock.now();
  st.initTimes = st.initTimes.filter((t) => now - t < MINUTE_MS);
  if (st.initTimes.length >= FSRV_INIT_PER_MIN) return "RATE_LIMITED";
  st.initTimes.push(now);
  return null;
}

const directionOf = (from: FsrvFrom): FsrvDirection => (from.side === "tech" ? "TO_CUSTOMER" : "TO_TECH");

function senderOf(from: FsrvFrom): AuditActor {
  if (from.side === "tech") return { userId: from.tech.userId, username: from.tech.username, ctx: from.tech.ctx };
  return { username: CUSTOMER_USERNAME, ctx: from.guest.ctx ?? GUEST_CTX };
}

function refuse(rooms: Rooms, room: Room, from: FsrvFrom, m: InitMsg, reason: FsrvGateReason): void {
  from.peer.send({ t: "fsrv.status", xid: m.xid, state: "REJECTED", reason });
  rooms.metrics.inc("rs_fsrv_denied_total", { reason: reason.toLowerCase() });
  rooms.log.info({ event: "fsrv_init_rejected", reason, sessionId: room.sessionId, side: from.side }, "fsrv.init reddedildi");
  // Go K5: bekleyen yazdırma işi 8 dk beklemesin — teknisyenin PRINT yüklemesi reddedildiyse iş ERROR ile kapanır.
  if (m.purpose === "PRINT" && m.pid && from.side === "tech") failPrint(rooms, room, m.pid);
}

async function handleInit(rooms: Rooms, room: Room, from: FsrvFrom, m: InitMsg): Promise<void> {
  const svc = rooms.fsrv;
  const g = gate(rooms, room, svc, from, m);
  if (g === "reuse") return from.peer.send({ t: "error", code: "VALIDATION", message: "Bu işlem kimliği daha önce kullanıldı." });
  if (g !== null || !svc) return refuse(rooms, room, from, m, g ?? "UNSUPPORTED");
  const st = stateOf(room);
  const direction = directionOf(from);
  st.starting.add(direction);
  let out: Awaited<ReturnType<FsrvService["begin"]>>;
  try {
    const s = await rooms.db.tenantSettings.findUnique({ where: { tenantId: room.tenantId }, select: { fileRetentionDays: true } });
    out = await svc.begin({
      sessionId: room.sessionId,
      tenantId: room.tenantId,
      direction,
      purpose: m.purpose,
      xid: m.xid,
      name: m.name,
      size: m.size,
      sha256: m.sha256,
      ...(m.pid ? { pid: m.pid } : {}),
      retentionDays: s?.fileRetentionDays ?? FILE_RETENTION_DAYS_DEFAULT,
      sender: senderOf(from),
    });
  } catch (err) {
    rooms.log.error({ err, ref: newId(), event: "fsrv_begin_failed", sessionId: room.sessionId }, "fsrv yüklemesi başlatılamadı");
    from.peer.send({ t: "error", code: "INTERNAL", message: "Dosya yüklemesi başlatılamadı." });
    if (m.purpose === "PRINT" && m.pid && from.side === "tech") failPrint(rooms, room, m.pid);
    return;
  } finally {
    st.starting.delete(direction);
  }
  if ("reject" in out) return refuse(rooms, room, from, m, out.reject);
  const t = svc.transfers.get(out.fid);
  if (!rooms.live(room)) {
    // Oda begin sürerken kapandı: roomClosed bu aktarımı görmedi → yetim satır/.part kalmasın.
    if (t) await svc.abortUpload(t, "room_closed");
    return;
  }
  from.peer.send({ t: "fsrv.upload", xid: m.xid, fid: out.fid, token: out.token, chunkBytes: FSRV_CHUNK_BYTES, chunks: out.chunks });
}
