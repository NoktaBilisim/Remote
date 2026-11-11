// WS upgrade + kimlik (mimari-protokol §1, G-10, AC-14..19, 120): /ws/tech (Origin + çerez + oturum sahibi),
// /ws/guest (sorgu dizesi yok; `Sec-WebSocket-Protocol: rs.v1, rs.ticket.*|rs.reconnect.*`; checkPublicClient
// kuralı ticket kind'ı ile). Ret upgrade öncesi HTTP 403. Ping 30 sn, 2 pong kaçarsa terminate; teknisyen
// oturumu 60 sn'de bir yeniden doğrulanır (G-04; P7/S-P3-8: yetkiler tazelenir, rol değişimi/pasif kullanıcı →
// endByTechnician). Ticket/token/çerez loglanmaz.
import type { IncomingMessage } from "node:http";
import { STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";
import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import { WS_MAX_PAYLOAD, WS_RECONNECT_PREFIX, WS_SUBPROTOCOL, WS_TICKET_PREFIX } from "@remote/contracts/ws";
import type { FastifyInstance } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { publicClientAllowed } from "../auth/guards.ts";
import { findUserById } from "../auth/repo.ts";
import { canSignIn, resolveSession } from "../auth/session.ts";
import { newId, sha256Hex } from "../lib/ids.ts";
import { cidrMatcher, ipKey } from "../lib/ip.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import * as repo from "../sessions/repo.ts";
import { onGuestMessage, onTechMessage, TokenBucket } from "./handlers.ts";
import type { Rooms } from "./rooms.ts";
import type { Peer, Room } from "./types.ts";

/** S-P4-T3-2: `reconnect.conflict` audit'i oda başına bu aralıkta en çok 1 kez. */
export const RECONNECT_CONFLICT_AUDIT_MS = 60_000;

export interface SignalingOptions {
  pingMs?: number;
  revalidateMs?: number;
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
type Reject = { status: 403 | 404 | 429; reason: string };

function reject(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

const peerOf = (ws: WebSocket): Peer => ({
  send: (m) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  },
  close: (code, reason) => ws.close(code, reason),
  isOpen: () => ws.readyState === WebSocket.OPEN,
});

export function attachSignaling(app: FastifyInstance, rooms: Rooms, opts: SignalingOptions = {}): void {
  const { env, db } = app;
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD, perMessageDeflate: false, handleProtocols: (p) => (p.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false) });
  const trusted = cidrMatcher(env.TRUSTED_PROXY_CIDR);
  // S-P2/S-P3-7: upgrade IP limiti (31/dk, 60 sn kilit) DB'ye gitmeden önce; teknisyen ve misafir ayrı sayılır.
  // Aşan çerçeve (> WS_MAX_PAYLOAD) ws kütüphanesince 1009 ile kapatılır (S-P3-1).
  const guestIp = new FixedWindowCounter(31, 60_000, 60_000);
  const techIp = new FixedWindowCounter(31, 60_000, 60_000);
  rooms.metrics.gauge("rs_ws_connections", "Açık WS bağlantıları (anlık)", () => wss.clients.size);
  const missed = new WeakMap<WebSocket, number>();

  /** Fastify trustProxy ile aynı kural: güvenilen proxy zincirinden ilk güvenilmeyen adres (G-11). */
  const clientIp = (req: IncomingMessage): string => {
    const xff = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean).reverse();
    let ip = req.socket.remoteAddress ?? "";
    for (const next of xff) {
      if (!trusted(ip)) break;
      ip = next;
    }
    return ip;
  };
  const ctxOf = (req: IncomingMessage): AuditContext => ({ ip: clientIp(req), userAgent: String(req.headers["user-agent"] ?? ""), requestId: newId() });

  const accept = (req: IncomingMessage, socket: Duplex, head: Buffer, role: "tech" | "guest", onOpen: (ws: WebSocket, peer: Peer) => void): void => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      missed.set(ws, 0);
      ws.on("pong", () => missed.set(ws, 0));
      // Protokol hatası (ör. > WS_MAX_PAYLOAD → 1009): ws kapanışı kendisi yapar; dinleyicisiz 'error' süreci düşürür.
      ws.on("error", (err: Error & { code?: string }) => app.log.info({ role, code: err.code }, "ws protokol hatası"));
      rooms.metrics.inc("rs_ws_connections_total", { role });
      onOpen(ws, peerOf(ws));
    });
  };

  async function tech(req: IncomingMessage, url: URL, socket: Duplex, head: Buffer): Promise<Reject | null> {
    const key = ipKey(clientIp(req));
    if (techIp.blockedFor(key) > 0 || techIp.hit(key)) return { status: 429, reason: "rate" };
    const origin = req.headers.origin;
    if (!origin || !env.allowedOrigins.includes(origin)) return { status: 403, reason: "origin" };
    const sessionId = url.searchParams.get("sessionId") ?? "";
    const token = cookieValue(req.headers.cookie, SESSION_COOKIE);
    if (!ULID.test(sessionId) || !token) return { status: 403, reason: "credentials" };
    const auth = await resolveSession(db, token, new Date());
    if (!auth || auth.user.mustChangePassword) return { status: 403, reason: "auth" };
    const row = await repo.findForSignal(db, sessionId);
    // AC-15: yalnız oturum sahibi (Admin dahil başkası hayır); PENDING (süresi dolmamış) ya da odası canlı ACTIVE.
    const open = row && ((row.status === "PENDING" && row.expiresAt.getTime() > Date.now()) || (row.status === "ACTIVE" && rooms.get(row.id)));
    if (!row || row.technicianId !== auth.user.id || !open) return { status: 403, reason: "session" };
    accept(req, socket, head, "tech", (ws, peer) => {
      const conn = { peer, userId: auth.user.id, username: auth.user.email, authToken: token, permissions: auth.permissions, role: auth.user.role, ctx: ctxOf(req) };
      const room = rooms.attachTech(row, conn);
      const bucket = new TokenBucket(rooms.clock);
      ws.on("message", (data: Buffer, bin) => void onTechMessage(rooms, room, peer, bucket, data, bin).catch((err: unknown) => app.log.error({ err }, "ws teknisyen mesajı işlenemedi")));
      ws.on("close", () => rooms.detachTech(room, peer));
    });
    return null;
  }

  async function guest(req: IncomingMessage, url: URL, socket: Duplex, head: Buffer): Promise<Reject | null> {
    if (url.search !== "") return { status: 403, reason: "query" }; // sızmış biçim reddedilir (G-10)
    const ctx = ctxOf(req);
    const key = ipKey(ctx.ip);
    if (guestIp.blockedFor(key) > 0 || guestIp.hit(key)) return { status: 429, reason: "rate" };
    const protos = String(req.headers["sec-websocket-protocol"] ?? "").split(",").map((s) => s.trim());
    const creds = protos.filter((p) => p.startsWith(WS_TICKET_PREFIX) || p.startsWith(WS_RECONNECT_PREFIX));
    const cred = creds[0];
    if (!protos.includes(WS_SUBPROTOCOL) || creds.length !== 1 || !cred) return { status: 403, reason: "protocol" };
    const isTicket = cred.startsWith(WS_TICKET_PREFIX);
    const value = cred.slice(isTicket ? WS_TICKET_PREFIX.length : WS_RECONNECT_PREFIX.length);
    if (!TOKEN.test(value)) return { status: 403, reason: "protocol" };

    let room: Room | undefined;
    if (isTicket) {
      const t = rooms.tickets.take(value);
      room = t ? rooms.get(t.sessionId) : undefined;
      const g = t && room ? room.lobby.get(t.guestId) : undefined;
      if (!room || !g || g.state !== "TICKETED") return { status: 403, reason: "ticket" };
      if (!publicClientAllowed(req.headers, env.allowedOrigins, g.kind)) return { status: 403, reason: "client_kind" };
      const r = room;
      accept(req, socket, head, "guest", (ws, peer) => bindGuest(ws, peer, r, g, ctx, () => rooms.attachGuest(r, g, peer)));
      return null;
    }
    const sessionId = rooms.reconnect.get(sha256Hex(value));
    room = sessionId ? rooms.get(sessionId) : undefined;
    const g = room?.admitted;
    if (!room || !g) return { status: 403, reason: "reconnect" };
    if (!publicClientAllowed(req.headers, env.allowedOrigins, g.kind)) return { status: 403, reason: "client_kind" };
    // TEST-P4-1: F5'te eski soket kapanış el sıkışmasındayken (CLOSING) yeni bağlantı gelebilir; yalnız OPEN soket çakışmadır.
    if (g.peer?.isOpen()) {
      // S-P4-T3-2: tekrarlanan çakışma denemesi audit'i şişirmesin — oda başına dakikada en çok 1 kayıt.
      const now = rooms.clock.now();
      if (room.reconnectConflictAuditAt === undefined || now - room.reconnectConflictAuditAt >= RECONNECT_CONFLICT_AUDIT_MS) {
        room.reconnectConflictAuditAt = now;
        await writeAudit(db, ctx, { tenantId: room.tenantId, username: "customer", action: "reconnect.conflict", entity: "support_sessions", entityId: room.sessionId, result: "fail" });
      }
      return { status: 403, reason: "reconnect_conflict" };
    }
    const r = room;
    accept(req, socket, head, "guest", (ws, peer) => bindGuest(ws, peer, r, g, ctx, () => rooms.reattachGuest(r, peer)));
    return null;
  }

  function bindGuest(ws: WebSocket, peer: Peer, room: Room, g: NonNullable<Room["admitted"]>, ctx: AuditContext, attach: () => void): void {
    if (!rooms.live(room)) return void ws.close(1000, "ended");
    g.ctx = ctx; // P7: kontrol onayı kaydı bu bağlantının ip/user_agent'ı ile
    attach();
    const bucket = new TokenBucket(rooms.clock);
    ws.on("message", (data: Buffer, bin) => void onGuestMessage(rooms, room, g, peer, bucket, data, bin).catch((err: unknown) => app.log.error({ err }, "ws misafir mesajı işlenemedi")));
    ws.on("close", () => rooms.detachGuest(room, g, peer));
  }

  app.server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://x");
    const role = url.pathname === "/ws/tech" ? "tech" : url.pathname === "/ws/guest" ? "guest" : null;
    if (!role) return reject(socket, 404);
    socket.on("error", () => socket.destroy());
    (role === "tech" ? tech(req, url, socket, head) : guest(req, url, socket, head))
      .then((r) => {
        if (!r) return;
        rooms.metrics.inc("rs_ws_rejected_total", { role, reason: r.reason });
        app.log.info({ role, reason: r.reason }, "ws upgrade reddedildi");
        reject(socket, r.status);
      })
      .catch((err: unknown) => {
        app.log.error({ err }, "ws upgrade hatası");
        reject(socket, 500);
      });
  });

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      const n = missed.get(ws) ?? 0;
      if (n >= 2) ws.terminate();
      else {
        missed.set(ws, n + 1);
        ws.ping();
      }
    }
  }, opts.pingMs ?? 30_000);
  const revalidate = setInterval(() => {
    for (const room of rooms.techRooms()) {
      const t = room.tech;
      if (!t) continue;
      void revalidateTech(room, t).catch((err: unknown) => app.log.error({ err }, "ws teknisyen yeniden doğrulama hatası"));
    }
  }, opts.revalidateMs ?? 60_000);

  /**
   * Yedek yol (S-P3-8, AC-115): oturum geçersiz → bu oda `auth_revoked`; kullanıcı pasif / tenant pasif / rol değişti →
   * teknisyenin TÜM odaları biter; aksi halde güncel yetkiler `applyPermChange` ile caps'e yansır.
   */
  async function revalidateTech(room: Room, t: NonNullable<Room["tech"]>): Promise<void> {
    const a = await resolveSession(db, t.authToken, new Date());
    if (a && a.user.role === t.role) return rooms.applyPermChange(t.userId, a.permissions);
    const user = a ? null : await findUserById(db, t.userId);
    if (a || !user || !canSignIn(user)) return rooms.endByTechnician(t.userId);
    return rooms.finish(room, "auth_revoked", "SYSTEM");
  }
  ping.unref();
  revalidate.unref();
  // preClose: server.close() yükseltilmiş soketleri beklemesin diye önce WS'ler kapatılır.
  app.addHook("preClose", async () => {
    clearInterval(ping);
    clearInterval(revalidate);
    guestIp.close();
    techIp.close();
    rooms.shutdown();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  });
}
