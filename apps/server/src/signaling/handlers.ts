// Gelen WS mesajlarının işlenmesi (mimari-protokol §1–3, AC-17..20): JSON + zod (strict) → aksi 1008;
// 50 mesaj/sn token-bucket → 1008 + log `ws_rate_exceeded`; relay yalnız aynı odanın karşı tarafına ve
// alanlar yeniden kurularak (gelen nesne aktarılmaz). Lobi misafiri yalnız `session.end` gönderebilir.
// P7: control.request/release/cancel, monitor.request/denied, control.state, env.state → control.ts (§3.3, ADR-0013).
// P28a: clip.*/print.* → clip-print.ts; misafir şeması soketin bildirdiği özelliğe göre (yeteneksiz sokette → 1008).
import {
  BINDING_REQUEST_EXCLUSIVE_MESSAGE,
  bindingRequestEnvelopeSchema,
  guestInboundSchemaFor,
  type GuestInboundFull,
  SHARE_STATE_MIN_INTERVAL_MS,
  techInboundSchema,
  WS_CLOSE,
  WS_MAX_PAYLOAD,
} from "@remote/contracts/ws";
import type { z } from "zod";
import { seatMay } from "@remote/contracts/ws-multi";
import { handleHandover, handleMemberLeave, handleTechRemove, handleTransfer, relayGuestToTech, relayTechToGuest } from "./member-cmds.ts";
import { controllerOf, logOnce, seatOf, sendTechs, type Seat } from "./members.ts";
import { admitGuest, rejectGuest } from "./admit.ts";
import { handleFileMeta, handleQualitySummary } from "./collab.ts";
import {
  handleControlClose,
  handleControlRequest,
  handleControlState,
  handleEnvState,
  handleMonitorDenied,
  handleMonitorRequest,
  onShareMonitor,
} from "./control.ts";
import { handleBindingRequest } from "./binding.ts";
import {
  handleClipConsent,
  handleClipReport,
  handleClipRequest,
  handlePrintCancel,
  handlePrintReport,
  handlePrintRequest,
} from "./clip-print.ts";
import { handleFsrv } from "./fsrv.ts";
import { handleRecConsent, handleRecError, handleRecRevoke } from "./rec.ts";
import type { Rooms } from "./rooms.ts";
import { hasFsrv, hasVoice } from "./rooms-features.ts";
import { handleGuestVoice, handleTechVoice } from "./voice.ts";
import type { Clock, Guest, Peer, Room, TechConn } from "./types.ts";

export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly rate: number;
  private readonly clock: Clock;

  constructor(clock: Clock, ratePerSec = 50) {
    this.clock = clock;
    this.rate = ratePerSec;
    this.tokens = ratePerSec;
    this.last = clock.now();
  }

  take(): boolean {
    const t = this.clock.now();
    this.tokens = Math.min(this.rate, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * Ham çerçeveyi doğrular; geçersizse bağlantıyı 1008 ile kapatır ve null döner. `soft` şema hatasında çağrılır; true
 * dönerse (çağıran `error` gönderdi) bağlantı açık kalır.
 */
function parseFrame<T extends z.ZodType>(
  rooms: Rooms,
  peer: Peer,
  bucket: TokenBucket,
  schema: T,
  data: Buffer,
  isBinary: boolean,
  soft?: (json: unknown) => boolean,
): z.infer<T> | null {
  const fail = (reason: string): null => {
    rooms.log.warn({ event: reason }, "ws mesajı reddedildi");
    rooms.metrics.inc("rs_ws_closed_policy_total", { reason });
    peer.close(WS_CLOSE.POLICY, reason);
    return null;
  };
  if (!bucket.take()) return fail("ws_rate_exceeded");
  if (isBinary) return fail("ws_binary");
  if (data.length > WS_MAX_PAYLOAD) return fail("ws_too_large");
  let json: unknown;
  try {
    json = JSON.parse(data.toString("utf8"));
  } catch {
    return fail("ws_invalid_json");
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return parsed.data;
  return soft?.(json) ? null : fail("ws_invalid_message");
}

type TechMsg = z.infer<typeof techInboundSchema>;
type GuestMsg = GuestInboundFull;
const NO_FEATURES = new Set<never>();

export async function onTechMessage(
  rooms: Rooms,
  room: Room,
  peer: Peer,
  bucket: TokenBucket,
  data: Buffer,
  isBinary: boolean,
): Promise<void> {
  const seat = rooms.live(room) ? seatOf(room, peer) : null;
  if (!seat) return;
  const tech = seat.conn;
  const m = parseFrame(rooms, peer, bucket, techInboundSchema, data, isBinary);
  if (!m) return;
  // P28c (§4.4, D-PC-6): rol kapısı her teknisyen mesajından önce, varsayılan-ret.
  const observer = seat.member?.role === "observer";
  if (!seatMay(m.t, { owner: seat.owner, controller: controllerOf(room) === tech, observer })) return roleDenied(rooms, room, tech, m.t);
  if ((m.t === "guest.admit" || m.t === "guest.reject") && room.requestId && !room.acceptCode) {
    // P8b §5.2 adım 5: talep oturumunda lobi yok.
    tech.peer.send({ t: "error", code: "CONFLICT", message: "Talep oturumunda lobi yok; müşteri onayıyla otomatik bağlanır." });
    return;
  }
  if (m.t === "sdp.offer" || m.t === "ice" || m.t === "ice.restart") return relayTechToGuest(room, seat, m);
  if (await multiAction(rooms, room, seat, m)) return;
  await techAction(rooms, room, tech, peer, m);
}

/** Rol kapısı reddi: `error{FORBIDDEN}` + `rs_multi_denied_total{type}`; log oda başına dakikada 1. */
function roleDenied(rooms: Rooms, room: Room, tech: TechConn, type: string): void {
  const voice = type.startsWith("voice."); // P28d AC-378: izleyici konuşamaz
  tech.peer.send({
    t: "error",
    code: "FORBIDDEN",
    message: voice ? "İzleyici sesli görüşmede konuşamaz." : "Yalnız kontrol sahibi kullanabilir.",
  });
  rooms.metrics.inc("rs_multi_denied_total", { type });
  if (logOnce(room, "denied", rooms.clock.now()))
    rooms.log.info({ event: "multi_role_denied", type, sessionId: room.sessionId }, "rol kapısı mesajı reddetti");
}

/** P28c teknisyen komutları (§5.1–§5.4). */
async function multiAction(rooms: Rooms, room: Room, seat: Seat, m: TechMsg): Promise<boolean> {
  switch (m.t) {
    case "control.handover":
      handleHandover(rooms, room, seat, m.to);
      return true;
    case "session.transfer":
      await handleTransfer(rooms, room, seat, m.to);
      return true;
    case "member.leave":
      handleMemberLeave(rooms, room, seat);
      return true;
    case "voice.request":
    case "voice.join":
    case "voice.end":
      handleTechVoice(rooms, room, seat.conn, m); // P28d §4.2
      return true;
    default:
      return false;
  }
}

/**
 * P28u §6.4 (K-P28u-9, AC-439): `silent` odada kontrol GRANTED değilken (izleme kipi) teknisyenin dosya teklifi reddedilir.
 */
function silentFileBlocked(rooms: Rooms, room: Room, tech: TechConn, m: TechMsg): boolean {
  if (room.unattended?.consentMode !== "silent" || room.control.state === "GRANTED") return false;
  if (m.t !== "file.meta" && m.t !== "fsrv.init") return false;
  tech.peer.send({ t: "error", code: "FORBIDDEN", message: "İzleme kipinde dosya gönderilemez; önce müdahale edin." });
  rooms.metrics.inc("rs_file_meta_total", { result: "silent_view" });
  return true;
}

async function techAction(rooms: Rooms, room: Room, tech: TechConn, peer: Peer, m: TechMsg): Promise<void> {
  if (silentFileBlocked(rooms, room, tech, m)) return;
  switch (m.t) {
    case "guest.admit":
      await admitGuest(rooms, room, tech, m.admitCode);
      return;
    case "guest.reject":
      await rejectGuest(rooms, room, tech, m.guestId);
      return;
    case "file.meta":
      if (room.admitted) await handleFileMeta(rooms, room, { side: "tech", peer }, m);
      else tech.peer.send({ t: "error", code: "CONFLICT", message: "Oturum henüz başlamadı." });
      return;
    case "quality.summary":
      await handleQualitySummary(rooms, room, { fps: m.fps, kbps: m.kbps, rttMs: m.rttMs, connType: m.connType });
      return;
    case "control.request":
      await handleControlRequest(rooms, room, tech);
      return;
    case "control.release":
      await handleControlClose(rooms, room, tech, "release");
      return;
    case "control.cancel":
      await handleControlClose(rooms, room, tech, "cancel");
      return;
    case "monitor.request":
      await handleMonitorRequest(rooms, room, tech, m.monitorId);
      return;
    case "session.end":
      if (room.admitted) await rooms.finish(room, "tech", "TECH", tech.ctx);
      else tech.peer.send({ t: "error", code: "CONFLICT", message: "Bekleyen oturum iptal ile kapatılır." });
      return;
    case "clip.push":
    case "clip.pull":
      handleClipRequest(rooms, room, tech, m);
      return;
    case "print.request":
      handlePrintRequest(rooms, room, tech, m);
      return;
    case "print.cancel":
      handlePrintCancel(rooms, room, tech, m.pid);
      return;
    case "fsrv.init":
    case "fsrv.accept":
    case "fsrv.reject":
    case "fsrv.result":
    case "fsrv.cancel":
      if (room.admitted) await handleFsrv(rooms, room, { side: "tech", peer, tech }, m);
      else tech.peer.send({ t: "error", code: "CONFLICT", message: "Oturum henüz başlamadı." });
      return;
    case "rec.error":
      await handleRecError(rooms, room, tech, m.code); // P28e §6.2: yalnız kaydediciden
      return;
  }
}

export async function onGuestMessage(
  rooms: Rooms,
  room: Room,
  guest: Guest,
  peer: Peer,
  bucket: TokenBucket,
  data: Buffer,
  isBinary: boolean,
): Promise<void> {
  if (!rooms.live(room) || guest.peer !== peer) return;
  // P28b §5.2 adım 1: `fsrv.*` yalnız SERVER odası + hasFsrv sokette şemada (aksi 1008).
  // P28e §6.1: `rec.*` yalnız `rs.cap.rec1` bildiren katılımlı oda soketinde şemada (aksi 1008).
  const schema = guestInboundSchemaFor(
    peer.features ?? NO_FEATURES,
    room.fileMode === "SERVER" && hasFsrv(room, peer),
    peer.rec === true && !room.unattended,
    peer.multi === true, // P28c §4.4: `to`'lu sdp.answer/ice + tech.remove yalnız multi1 sokette
    hasVoice(room, peer), // P28d §4.1: `voice.*` yalnız ses destekli sokette (aksi 1008)
  );
  const m = parseFrame(rooms, peer, bucket, schema, data, isBinary, (json) => {
    // P20 (protokol §6.1): zarfı geçerli `binding.request`te previousKey + previousKeys → error VALIDATION, soket açık.
    if (guest.state !== "ADMITTED" || !bindingRequestEnvelopeSchema.safeParse(json).success) return false;
    peer.send({ t: "error", code: "VALIDATION", message: BINDING_REQUEST_EXCLUSIVE_MESSAGE });
    return true;
  });
  if (!m) return;
  if (guest.state !== "ADMITTED") {
    // §3.1: kabul edilmemiş misafirden SDP/ICE/share → 1008 (relay yok, G-01).
    if (m.t === "session.end") rooms.leaveLobby(room, guest, "left");
    else {
      rooms.metrics.inc("rs_ws_closed_policy_total", { reason: "ws_not_admitted" });
      peer.close(WS_CLOSE.POLICY, "not_admitted");
    }
    return;
  }
  await guestAction(rooms, room, guest, peer, m);
}

async function guestAction(rooms: Rooms, room: Room, guest: Guest, peer: Peer, m: GuestMsg): Promise<void> {
  switch (m.t) {
    case "sdp.answer":
    case "ice":
      relayGuestToTech(rooms, room, m);
      return;
    case "tech.remove":
      handleTechRemove(rooms, room, guest, peer, m.tid);
      return;
    case "share.state":
      await onShareState(rooms, room, guest, m);
      return;
    case "control.state":
      await handleControlState(rooms, room, guest, { state: m.state, source: m.source });
      return;
    case "env.state":
      handleEnvState(rooms, room, guest, m);
      return;
    case "monitor.denied":
      await handleMonitorDenied(rooms, room, guest, m.monitorId);
      return;
    case "file.meta":
      await handleFileMeta(rooms, room, { side: "guest", peer }, m);
      return;
    case "session.end":
      await rooms.finish(room, "customer", "CUSTOMER");
      return;
    case "binding.request":
      await handleBindingRequest(rooms, room, guest, peer, m);
      return;
    case "clip.consent":
      handleClipConsent(rooms, room, guest, m.on);
      return;
    case "clip.report":
      handleClipReport(rooms, room, m);
      return;
    case "print.report":
      handlePrintReport(rooms, room, m);
      return;
    case "fsrv.init":
    case "fsrv.accept":
    case "fsrv.reject":
    case "fsrv.result":
    case "fsrv.cancel":
      await handleFsrv(rooms, room, { side: "guest", peer, guest }, m);
      return;
    case "rec.consent":
      await handleRecConsent(rooms, room, guest, peer, m.lineSha256);
      return;
    case "rec.revoke":
      await handleRecRevoke(rooms, room, guest);
      return;
    case "voice.answer":
    case "voice.end":
      handleGuestVoice(rooms, room, guest, m); // P28d §4.2
      return;
  }
}

async function onShareState(rooms: Rooms, room: Room, guest: Guest, m: Extract<GuestMsg, { t: "share.state" }>): Promise<void> {
  const snap = {
    state: m.state,
    ...(m.monitors ? { monitors: m.monitors } : {}),
    ...(m.activeMonitor !== undefined ? { activeMonitor: m.activeMonitor } : {}),
    // P15 (AC-234): neden kodu + yöntem (0.11+ istemci); alanlar yeniden kurulur, gelen nesne aktarılmaz.
    ...(m.reason !== undefined ? { reason: m.reason } : {}),
    ...(m.method !== undefined ? { method: m.method } : {}),
  };
  room.share = snap; // QA-P4-12: teknisyen yeniden bağlanınca hello.share
  relayShareState(rooms, room);
  await onShareMonitor(rooms, room, guest, m.activeMonitor); // P7: karşılanan monitör isteği → monitor.granted
}

/**
 * P15 (S17-2): `share.state` teknisyene oda başına en çok `SHARE_STATE_MIN_INTERVAL_MS`'de bir iletilir. Aralık
 * içindekiler düşürülmez, birleştirilir: aralık sonunda `room.share`'deki EN SON durum tek mesajla gider (son durum
 * kaybolmaz). Monitör karşılama denetimi (onShareMonitor) her mesajda çalışır; yalnız konsola yayın sınırlanır.
 */
export function relayShareState(rooms: Rooms, room: Room): void {
  const send = (): void => {
    room.shareSentAt = rooms.clock.now();
    if (room.share) sendTechs(room, { t: "share.state", ...room.share });
  };
  const wait = room.shareSentAt === undefined ? 0 : room.shareSentAt + SHARE_STATE_MIN_INTERVAL_MS - rooms.clock.now();
  if (wait <= 0 && room.timers.share === undefined) return send();
  if (room.timers.share !== undefined) return;
  room.timers.share = rooms.clock.setTimeout(
    () => {
      room.timers.share = undefined;
      if (rooms.live(room)) send();
    },
    Math.max(wait, 0),
  );
}
