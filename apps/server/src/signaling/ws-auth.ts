// /ws/tech ve /ws/guest upgrade kimlik dalları (mimari-protokol §1, G-10, AC-14..19, 120). Yönlendirme, ping ve
// kapanış signaling/ws.ts'te; burada yalnız kimlik/yetki kararı ve açılan soketin odaya bağlanması. Ret upgrade
// öncesi HTTP (403/426/429). Ticket/token/çerez loglanmaz.
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import { WS_RECONNECT_PREFIX, WS_SUBPROTOCOL, WS_TICKET_PREFIX } from "@remote/contracts/ws";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import { publicClientAllowed } from "../auth/guards.ts";
import { findUserById } from "../auth/repo.ts";
import { canSignIn, resolveSession, type AuthContext, type SessionPolicy } from "../auth/session.ts";
import { sha256Hex } from "../lib/ids.ts";
import { ipKey, netKey } from "../lib/ip.ts";
import type { FixedWindowCounter } from "../lib/rate.ts";
import { isOutdated, UNDECLARED_AGENT_VERSION } from "../lib/version.ts";
import { cookieValue, offeredProtocols, type UpgradeReject } from "../lib/ws-upgrade.ts";
import * as repo from "../sessions/repo.ts";
import { createGate } from "../unattended/gate.ts";
import { admitRequestGuest } from "./admit.ts";
import { admitDeviceGuest } from "./admit-device.ts";
import { onGuestMessage, onTechMessage, TokenBucket } from "./handlers.ts";
import { featuresOf, fsrvOf } from "./rooms-features.ts";
import type { Rooms } from "./rooms.ts";
import type { Guest, Peer, Room } from "./types.ts";

/** S-P4-T3-2: `reconnect.conflict` audit'i oda başına bu aralıkta en çok 1 kez. */
const RECONNECT_CONFLICT_AUDIT_MS = 60_000;

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** attachSignaling'in dallarla paylaştığı durum (tek WebSocketServer üzerinden kabul, IP kovaları, audit bağlamı). */
export interface UpgradeCtx {
  app: FastifyInstance;
  rooms: Rooms;
  policy: SessionPolicy;
  techIp: FixedWindowCounter;
  guestIp: FixedWindowCounter;
  clientIp(req: IncomingMessage): string;
  ctxOf(req: IncomingMessage): AuditContext;
  accept(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    role: "tech" | "guest" | "request" | "panel",
    onOpen: (ws: WebSocket, peer: Peer) => void,
  ): void;
}

type SignalRow = repo.SignalSessionRow;

/** AC-15: PENDING (süresi dolmamış) ya da odası canlı ACTIVE oturuma bağlanılır. */
const signalable = (rooms: Rooms, row: SignalRow): boolean =>
  (row.status === "PENDING" && row.expiresAt.getTime() > Date.now()) || (row.status === "ACTIVE" && rooms.get(row.id) !== undefined);

/** /ws/tech: IP kovası → Origin → çerez + oturum → yalnız oturum sahibi (Admin dahil başkası hayır). */
export async function techUpgrade(
  u: UpgradeCtx,
  req: IncomingMessage,
  url: URL,
  socket: Duplex,
  head: Buffer,
): Promise<UpgradeReject | null> {
  const key = ipKey(u.clientIp(req));
  if (u.techIp.blockedFor(key) > 0 || u.techIp.hit(key)) return { status: 429, reason: "rate" };
  const origin = req.headers.origin;
  if (!origin || !u.app.env.allowedOrigins.includes(origin)) return { status: 403, reason: "origin" };
  const sessionId = url.searchParams.get("sessionId") ?? "";
  const token = cookieValue(req.headers.cookie, SESSION_COOKIE);
  if (!ULID.test(sessionId) || !token) return { status: 403, reason: "credentials" };
  const auth = await resolveSession(u.app.db, token, new Date(), u.policy);
  if (!auth || auth.user.mustChangePassword) return { status: 403, reason: "auth" };
  const row = await repo.findForSignal(u.app.db, sessionId);
  if (!row || row.technicianId !== auth.user.id || !signalable(u.rooms, row)) return { status: 403, reason: "session" };
  u.accept(req, socket, head, "tech", (ws, peer) => openTech(u, req, ws, peer, row, auth, token));
  return null;
}

function openTech(u: UpgradeCtx, req: IncomingMessage, ws: WebSocket, peer: Peer, row: SignalRow, auth: AuthContext, token: string): void {
  const conn = {
    peer,
    userId: auth.user.id,
    username: auth.user.email,
    authToken: token,
    permissions: auth.permissions,
    role: auth.user.role,
    ctx: u.ctxOf(req),
  };
  const room = u.rooms.attachTech(row, conn);
  const bucket = new TokenBucket(u.rooms.clock);
  ws.on(
    "message",
    (data: Buffer, bin) =>
      void onTechMessage(u.rooms, room, peer, bucket, data, bin).catch((err: unknown) =>
        u.app.log.error({ err }, "ws teknisyen mesajı işlenemedi"),
      ),
  );
  ws.on("close", () => u.rooms.detachTech(room, peer));
}

/** `rs.v1` + tam olarak bir `rs.ticket.*` | `rs.reconnect.*` değeri; biçim uymazsa null. */
function guestCredential(req: IncomingMessage): { isTicket: boolean; value: string } | null {
  const protos = offeredProtocols(req);
  const creds = protos.filter((p) => p.startsWith(WS_TICKET_PREFIX) || p.startsWith(WS_RECONNECT_PREFIX));
  const cred = creds[0];
  if (!protos.includes(WS_SUBPROTOCOL) || creds.length !== 1 || !cred) return null;
  const isTicket = cred.startsWith(WS_TICKET_PREFIX);
  const value = cred.slice(isTicket ? WS_TICKET_PREFIX.length : WS_RECONNECT_PREFIX.length);
  return TOKEN.test(value) ? { isTicket, value } : null;
}

/** /ws/guest: sorgu dizesi yok (G-10) → IP kovası → subprotocol kimliği → ticket ya da yeniden bağlanma dalı. */
export async function guestUpgrade(
  u: UpgradeCtx,
  req: IncomingMessage,
  url: URL,
  socket: Duplex,
  head: Buffer,
): Promise<UpgradeReject | null> {
  if (url.search !== "") return { status: 403, reason: "query" }; // sızmış biçim reddedilir (G-10)
  const ctx = u.ctxOf(req);
  const key = ipKey(ctx.ip);
  if (u.guestIp.blockedFor(key) > 0 || u.guestIp.hit(key)) return { status: 429, reason: "rate" };
  const cred = guestCredential(req);
  if (!cred) return { status: 403, reason: "protocol" };
  const conn = { req, socket, head, ctx };
  return cred.isTicket ? ticketGuest(u, conn, cred.value) : reconnectGuest(u, conn, cred.value);
}

type GuestConn = { req: IncomingMessage; socket: Duplex; head: Buffer; ctx: AuditContext };

function ticketGuest(u: UpgradeCtx, c: GuestConn, value: string): UpgradeReject | null {
  const { rooms, app } = u;
  const t = rooms.tickets.take(value);
  const room = t ? rooms.get(t.sessionId) : undefined;
  const g = t && room ? room.lobby.get(t.guestId) : undefined;
  if (!room || !g || g.state !== "TICKETED") return { status: 403, reason: "ticket" };
  if (!publicClientAllowed(c.req.headers, app.env.allowedOrigins, g.kind)) return { status: 403, reason: "client_kind" };
  if (room.unattended) return deviceTicket(u, c, room, g, t?.gen);
  // P8b r2 (§13.4): AGENT sürümü nonce/talep kaydından (yeniden beyan yok).
  if (g.kind === "AGENT" && isOutdated(g.clientVersion ?? UNDECLARED_AGENT_VERSION, app.env.MIN_AGENT_VERSION))
    return { status: 426, reason: "outdated" };
  if (g.requestId) {
    // P8b §5.2: ön-kabullü misafir — ticket kuşağı güncel olmalı (yeniden bağlanan /ws/request eskisini geçersiz kılar).
    if (t?.gen !== g.ticketGen) return { status: 403, reason: "ticket" };
    if (!g.admitHash) {
      // S8b-2: g.peer burada atanmaz (eşzamanlı ikinci bağlantı ezmesin); admitRequestGuest kazanınca atar.
      openGuest(
        u,
        c,
        room,
        g,
        (peer) =>
          void admitRequestGuest(rooms, room, g, peer, c.ctx).catch((err: unknown) =>
            app.log.error({ err }, "talep misafiri kabul edilemedi"),
          ),
      );
      return null;
    }
    // P15 (AC-239): kabul kodlu talep oturumu — normal lobi akışı (lobby.wait + peer.pending; tüketim guest.admit'te).
    g.ipKey = ipKey(c.ctx.ip);
    g.netKey = netKey(c.ctx.ip);
  }
  openGuest(u, c, room, g, (peer) => rooms.attachGuest(room, g, peer));
  return null;
}

/**
 * P27 (§2 adım 4–5): gözetimsiz yardımcının bileti — sürüm denetimi yok (servis ikilisi ayrı ürün; kapı `device.auth`'ta),
 * kuşak eşleşmeli; kabul `admitDeviceGuest` (otomatik, yeniden denetimli). `g.peer` yalnız kazanan bağlantıya atanır.
 */
function deviceTicket(u: UpgradeCtx, c: GuestConn, room: Room, g: Guest, gen: number | undefined): UpgradeReject | null {
  if (gen !== g.ticketGen) return { status: 403, reason: "ticket" };
  const deps = { gate: createGate(u.app.env), secrets: u.app.secrets };
  openGuest(u, c, room, g, (peer) => {
    void admitDeviceGuest(u.rooms, room, g, peer, c.ctx, deps).catch((err: unknown) =>
      u.app.log.error({ err }, "gözetimsiz misafir kabul edilemedi"),
    );
  });
  return null;
}

async function reconnectGuest(u: UpgradeCtx, c: GuestConn, value: string): Promise<UpgradeReject | null> {
  const sessionId = u.rooms.reconnect.get(sha256Hex(value));
  const room = sessionId ? u.rooms.get(sessionId) : undefined;
  const g = room?.admitted;
  if (!room || !g) return { status: 403, reason: "reconnect" };
  if (!publicClientAllowed(c.req.headers, u.app.env.allowedOrigins, g.kind)) return { status: 403, reason: "client_kind" };
  // TEST-P4-1: F5'te eski soket kapanış el sıkışmasındayken (CLOSING) yeni bağlantı gelebilir; yalnız OPEN soket çakışmadır.
  if (g.peer?.isOpen()) {
    await auditReconnectConflict(u, room, c.ctx);
    return { status: 403, reason: "reconnect_conflict" };
  }
  openGuest(u, c, room, g, (peer) => u.rooms.reattachGuest(room, peer));
  return null;
}

/** S-P4-T3-2: tekrarlanan çakışma denemesi audit'i şişirmesin — oda başına dakikada en çok 1 kayıt. */
async function auditReconnectConflict(u: UpgradeCtx, room: Room, ctx: AuditContext): Promise<void> {
  const now = u.rooms.clock.now();
  if (room.reconnectConflictAuditAt !== undefined && now - room.reconnectConflictAuditAt < RECONNECT_CONFLICT_AUDIT_MS) return;
  room.reconnectConflictAuditAt = now;
  await writeAudit(u.app.db, ctx, {
    tenantId: room.tenantId,
    username: "customer",
    action: "reconnect.conflict",
    entity: "support_sessions",
    entityId: room.sessionId,
    result: "fail",
  });
}

function openGuest(u: UpgradeCtx, c: GuestConn, room: Room, g: Guest, attach: (peer: Peer) => void): void {
  const protocols = offeredProtocols(c.req);
  u.accept(c.req, c.socket, c.head, "guest", (ws, peer) => bindGuest(u, ws, peer, { room, g, ctx: c.ctx, protocols }, () => attach(peer)));
}

function bindGuest(
  u: UpgradeCtx,
  ws: WebSocket,
  peer: Peer,
  bind: { room: Room; g: Guest; ctx: AuditContext; protocols: readonly string[] },
  attach: () => void,
): void {
  const { room, g, ctx, protocols } = bind;
  const { rooms } = u;
  if (!rooms.live(room)) return void ws.close(1000, "ended");
  g.ctx = ctx; // P7: kontrol onayı kaydı bu bağlantının ip/user_agent'ı ile
  peer.features = featuresOf(protocols, room, g); // P28a §4.2: soket başına; gözetimsiz odada okunmaz (O-P28a-4)
  if (fsrvOf(protocols, room, g)) peer.fsrv = true; // P28b §5.1: rs.cap.fsrv1 / BROWSER; gözetimsiz odada okunmaz
  attach();
  const bucket = new TokenBucket(rooms.clock);
  ws.on(
    "message",
    (data: Buffer, bin) =>
      void onGuestMessage(rooms, room, g, peer, bucket, data, bin).catch((err: unknown) =>
        u.app.log.error({ err }, "ws misafir mesajı işlenemedi"),
      ),
  );
  ws.on("close", () => rooms.detachGuest(room, g, peer));
}

/**
 * Yedek yol (S-P3-8, AC-115): oturum geçersiz → bu oda `auth_revoked`; kullanıcı pasif / tenant pasif / rol değişti →
 * teknisyenin TÜM odaları biter; aksi halde güncel yetkiler `applyPermChange` ile caps'e yansır.
 */
export async function revalidateTech(u: UpgradeCtx, room: Room, t: NonNullable<Room["tech"]>): Promise<void> {
  const { rooms, app } = u;
  const a = await resolveSession(app.db, t.authToken, new Date(), u.policy);
  if (a && a.user.role === t.role) return rooms.applyPermChange(t.userId, a.permissions);
  const user = a ? null : await findUserById(app.db, t.userId);
  if (a || !user || !canSignIn(user)) return rooms.endByTechnician(t.userId);
  return rooms.finish(room, "auth_revoked", "SYSTEM");
}
