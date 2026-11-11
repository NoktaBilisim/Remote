// Gelen WS mesajlarının işlenmesi (mimari-protokol §1–3, AC-17..20): JSON + zod (strict) → aksi 1008;
// 50 mesaj/sn token-bucket → 1008 + log `ws_rate_exceeded`; relay yalnız aynı odanın karşı tarafına ve
// alanlar yeniden kurularak (gelen nesne aktarılmaz). Lobi misafiri yalnız `session.end` gönderebilir.
// P7: control.request/release/cancel, monitor.request/denied, control.state, env.state → control.ts (§3.3, ADR-0013).
import { guestInboundSchema, techInboundSchema, WS_CLOSE, WS_MAX_PAYLOAD } from "@remote/contracts/ws";
import type { z } from "zod";
import { admitGuest, rejectGuest } from "./admit.ts";
import { handleFileMeta, handleQualitySummary } from "./collab.ts";
import { handleControlClose, handleControlRequest, handleControlState, handleEnvState, handleMonitorDenied, handleMonitorRequest, onShareMonitor } from "./control.ts";
import type { Rooms } from "./rooms.ts";
import type { Clock, Guest, Peer, Room } from "./types.ts";

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

/** Ham çerçeveyi doğrular; geçersizse bağlantıyı 1008 ile kapatır ve null döner. */
export function parseFrame<T extends z.ZodType>(rooms: Rooms, peer: Peer, bucket: TokenBucket, schema: T, data: Buffer, isBinary: boolean): z.infer<T> | null {
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
  return parsed.success ? parsed.data : fail("ws_invalid_message");
}

export async function onTechMessage(rooms: Rooms, room: Room, peer: Peer, bucket: TokenBucket, data: Buffer, isBinary: boolean): Promise<void> {
  const tech = room.tech;
  if (!rooms.live(room) || tech?.peer !== peer) return;
  const m = parseFrame(rooms, peer, bucket, techInboundSchema, data, isBinary);
  if (!m) return;
  const guest = room.admitted?.peer;
  switch (m.t) {
    case "guest.admit":
      await admitGuest(rooms, room, tech, m.admitCode);
      return;
    case "guest.reject":
      await rejectGuest(rooms, room, tech, m.guestId);
      return;
    case "sdp.offer":
      guest?.send({ t: "sdp.offer", sdp: m.sdp });
      return;
    case "ice":
      guest?.send(iceOut(m));
      return;
    case "ice.restart":
      guest?.send({ t: "ice.restart" });
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
  }
}

export async function onGuestMessage(rooms: Rooms, room: Room, guest: Guest, peer: Peer, bucket: TokenBucket, data: Buffer, isBinary: boolean): Promise<void> {
  if (!rooms.live(room) || guest.peer !== peer) return;
  const m = parseFrame(rooms, peer, bucket, guestInboundSchema, data, isBinary);
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
  const tech = room.tech?.peer;
  switch (m.t) {
    case "sdp.answer":
      tech?.send({ t: "sdp.answer", sdp: m.sdp });
      return;
    case "ice":
      tech?.send(iceOut(m));
      return;
    case "share.state": {
      const snap = { state: m.state, ...(m.monitors ? { monitors: m.monitors } : {}), ...(m.activeMonitor !== undefined ? { activeMonitor: m.activeMonitor } : {}) };
      room.share = snap; // QA-P4-12: teknisyen yeniden bağlanınca hello.share
      tech?.send({ t: "share.state", ...snap });
      await onShareMonitor(rooms, room, guest, m.activeMonitor); // P7: karşılanan monitör isteği → monitor.granted
      return;
    }
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
  }
}

const iceOut = (m: { candidate: string; sdpMid?: string | undefined; sdpMLineIndex?: number | undefined }) =>
  ({ t: "ice", candidate: m.candidate, ...(m.sdpMid !== undefined ? { sdpMid: m.sdpMid } : {}), ...(m.sdpMLineIndex !== undefined ? { sdpMLineIndex: m.sdpMLineIndex } : {}) }) as const;
