// Oda + lobi durum makinesi (mimari-protokol §1, §3.1; akışlar A1, A4, A5). Tek instance, bellek içi.
// DB'ye yalnız oturum bitişi (ACTIVE→ENDED) yazılır; tüketim admit.ts'te tek atomik UPDATE ile.
import { randomInt } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { PermissionKey } from "@remote/contracts/permissions";
import type { GuestKind, SessionEndedReason } from "@remote/contracts/ws";
import { WS_CLOSE } from "@remote/contracts/ws";
import { writeAudit, type AuditContext } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { newId, sha256Hex } from "../lib/ids.ts";
import type { Metrics } from "../ops/metrics.ts";
import type { GuestConsent } from "../public/consent.ts";
import * as repo from "../sessions/repo.ts";
import type { RoomNotifier } from "../sessions/service.ts";
import { OneTimeStore } from "./store.ts";
import type { TurnConfig } from "./turn.ts";
import { DEFAULT_TIMING, LOBBY_MAX, realClock, type Clock, type Guest, type Peer, type Room, type TechConn, type Timing } from "./types.ts";
import { scheduleActive, sendGuestJoined, sendHelloGuest, sendHelloTech, syncDisconnect } from "./active.ts";
import { closeControlOnEnd, narrowCaps, newControl, resetOnGuestGone, revokeOnTechChange } from "./control.ts";

export interface RoomsDeps {
  db: Db;
  log: FastifyBaseLogger;
  turn: TurnConfig;
  metrics: Metrics;
  clock?: Clock;
  timing?: Partial<Timing>;
}

type RoomRow = Pick<repo.SignalSessionRow, "id" | "tenantId" | "technicianId" | "technician" | "expiresAt">;
export const admitHash = (guestId: string, code: string): string => sha256Hex(`${guestId}:${code}`);
const SYSTEM_CTX: AuditContext = { ip: "", userAgent: "signaling", requestId: "" };

/**
 * Canlı oturumlara yetki/hesap değişikliğinin yansıması (S-P3-8, AC-115, G-04). Kullanıcı/yetki/oturum servisleri
 * (P9 deaktivasyon/yetki/rol, P10 logout-all/reset-mfa) commit sonrası `app.rooms` üzerinden doğrudan çağırır;
 * /ws/tech 60 sn yeniden doğrulaması yalnız yedek yoldur.
 */
export interface TechnicianLiveControl {
  /** Teknisyenin tüm odaları `session.ended{auth_revoked}` ile biter (teknisyen soketi 4401). */
  endByTechnician(userId: string): Promise<void>;
  /** Yeni etkin yetkiler: caps daralırsa `caps.update`, `remote_control` düştüyse `control.revoke{permission}`. */
  applyPermChange(userId: string, permissions: Iterable<PermissionKey>): Promise<void>;
}

export class Rooms implements RoomNotifier, TechnicianLiveControl {
  readonly db: Db;
  readonly log: FastifyBaseLogger;
  readonly turn: TurnConfig;
  readonly metrics: Metrics;
  readonly clock: Clock;
  readonly timing: Timing;
  readonly nonces: OneTimeStore<{ sessionId: string; kind: GuestKind }>;
  readonly tickets: OneTimeStore<{ sessionId: string; guestId: string }>;
  private readonly rooms = new Map<string, Room>();
  readonly reconnect = new Map<string, string>(); // sha256(reconnectToken) → sessionId

  constructor(d: RoomsDeps) {
    this.db = d.db;
    this.log = d.log;
    this.turn = d.turn;
    this.metrics = d.metrics;
    this.clock = d.clock ?? realClock;
    this.timing = { ...DEFAULT_TIMING, ...d.timing };
    this.nonces = new OneTimeStore(this.clock, this.timing.nonceMs);
    this.tickets = new OneTimeStore(this.clock, this.timing.ticketMs);
  }

  get size(): number {
    return this.rooms.size;
  }
  /** Admit edilmiş (ACTIVE) oda sayısı — /metrics `rs_active_sessions`. */
  get activeCount(): number {
    let n = 0;
    for (const r of this.rooms.values()) if (r.admitted && !r.ending) n++;
    return n;
  }
  get(sessionId: string): Room | undefined {
    return this.rooms.get(sessionId);
  }
  live(room: Room): boolean {
    return !room.ending && this.rooms.get(room.sessionId) === room;
  }

  private getOrCreate(row: RoomRow): Room {
    let room = this.rooms.get(row.id);
    if (!room) {
      room = { sessionId: row.id, tenantId: row.tenantId, technicianId: row.technicianId, technicianName: row.technician.fullName, expiresAt: row.expiresAt.getTime(), lobby: new Map(), admitting: false, admitFails: 0, rejectedIps: new Set(), caps: [], fileMeta: { quotas: new Map(), auditAt: new Map() }, control: newControl(), timers: {}, ending: false };
      this.rooms.set(row.id, room);
    }
    return room;
  }

  /** Lobiye (TICKETED) misafir ekler — join (A1). Ret listesi → 403, lobi dolu → 409 LOBBY_FULL. */
  addGuest(row: RoomRow, g: { name: string; email?: string; kind: GuestKind; ipKey: string; consent: GuestConsent }): { guestId: string; admitCode: string; wsTicket: string } {
    const room = this.getOrCreate(row);
    if (room.admitted) throw new AppError("SESSION_CONSUMED");
    if (room.rejectedIps.has(g.ipKey)) throw new AppError("FORBIDDEN", { message: "Bu oturuma katılımınız teknisyen tarafından reddedildi." });
    if (room.lobby.size >= LOBBY_MAX) throw new AppError("LOBBY_FULL");
    const id = newId();
    // Lobide kod tekil olmalı: aksi halde teknisyenin girdiği kod iki misafirle eşleşebilir.
    const taken = (c: string): boolean => [...room.lobby.values()].some((o) => o.admitHash === admitHash(o.id, c));
    let code = String(randomInt(0, 10_000)).padStart(4, "0");
    while (taken(code)) code = String(randomInt(0, 10_000)).padStart(4, "0");
    const guest: Guest = { id, name: g.name, ...(g.email ? { email: g.email } : {}), kind: g.kind, ipKey: g.ipKey, admitHash: admitHash(id, code), consent: g.consent, state: "TICKETED", since: this.clock.now() };
    guest.timer = this.clock.setTimeout(() => {
      if (guest.state === "TICKETED" && room.lobby.get(id) === guest) this.dropRoomIfIdle(room, id);
    }, this.timing.ticketMs);
    room.lobby.set(id, guest);
    const { token } = this.tickets.issue({ sessionId: row.id, guestId: id });
    return { guestId: id, admitCode: code, wsTicket: token };
  }

  /** Ticket ile gelen misafir → LOBBY (lobby.wait + teknisyene peer.pending). */
  attachGuest(room: Room, guest: Guest, peer: Peer): void {
    this.clock.clearTimeout(guest.timer);
    guest.state = "LOBBY";
    guest.peer = peer;
    guest.since = this.clock.now();
    const expiresAt = guest.since + this.timing.lobbyMs;
    guest.timer = this.clock.setTimeout(() => this.leaveLobby(room, guest, "timeout", "lobby_timeout"), this.timing.lobbyMs);
    peer.send({ t: "lobby.wait", expiresAt: new Date(expiresAt).toISOString() });
    room.tech?.peer.send(pending(guest));
  }

  /** Lobiden çıkış: misafire (gerekirse) session.ended, teknisyene peer.pending.left. */
  leaveLobby(room: Room, guest: Guest, why: "left" | "timeout" | "rejected", ended?: SessionEndedReason): void {
    if (room.lobby.get(guest.id) !== guest) return;
    this.clock.clearTimeout(guest.timer);
    room.lobby.delete(guest.id);
    if (ended) {
      guest.peer?.send({ t: "session.ended", reason: ended });
      guest.peer?.close(WS_CLOSE.NORMAL, ended);
    }
    if (guest.state === "LOBBY") room.tech?.peer.send({ t: "peer.pending.left", guestId: guest.id, reason: why });
    this.dropRoomIfIdle(room);
  }

  /**
   * Boş oda silinir. Ret listesi / hatalı kod sayacı taşıyan oda (AC-113 tekrar katılımı engellemek için) yalnız
   * PENDING süresi bitene kadar tutulur; o anda yeniden kontrol edilip silinir (S-P3-4, sınırlı yaşam).
   */
  private dropRoomIfIdle(room: Room, ticketedId?: string): void {
    if (ticketedId) room.lobby.delete(ticketedId);
    if (room.tech || room.admitted || room.lobby.size > 0 || this.rooms.get(room.sessionId) !== room) return;
    const left = room.expiresAt - this.clock.now();
    if ((room.rejectedIps.size === 0 && room.admitFails === 0) || left <= 0) {
      this.clock.clearTimeout(room.timers.idle);
      this.rooms.delete(room.sessionId);
      return;
    }
    if (room.timers.idle === undefined) {
      room.timers.idle = this.clock.setTimeout(() => {
        room.timers.idle = undefined;
        this.dropRoomIfIdle(room);
      }, left);
    }
  }

  attachTech(row: RoomRow, conn: TechConn): Room {
    const room = this.getOrCreate(row);
    const old = room.tech;
    room.tech = conn;
    old?.peer.close(WS_CLOSE.REPLACED, "replaced");
    // §3.3 K3: yeni konsol (sekme değişimi / yeniden bağlanma) yalnız görüntüleme ile başlar; misafire önce revoke{reconnect}.
    if (room.admitted) revokeOnTechChange(this, room);
    void narrowCaps(this, room, conn.permissions); // bağlanma anındaki güncel yetki (S-P3-8)
    sendHelloTech(this, room);
    for (const g of room.lobby.values()) if (g.state === "LOBBY") conn.peer.send(pending(g));
    if (room.admitted?.peer) room.admitted.peer.send({ t: "peer.joined", role: "tech" });
    syncDisconnect(this, room);
    return room;
  }

  detachTech(room: Room, peer: Peer): void {
    if (!this.live(room) || room.tech?.peer !== peer) return;
    room.tech = undefined;
    if (room.admitted) {
      revokeOnTechChange(this, room); // AC-24, §3.3 K3: önce control.revoke{reconnect}, sonra peer.left
      room.admitted.peer?.send({ t: "peer.left", role: "tech", reason: "disconnect" });
      syncDisconnect(this, room);
    } else this.dropRoomIfIdle(room);
  }

  detachGuest(room: Room, guest: Guest, peer: Peer): void {
    if (!this.live(room) || guest.peer !== peer) return;
    if (guest.state !== "ADMITTED") return this.leaveLobby(room, guest, "left");
    guest.peer = undefined;
    room.share = { state: "stopped" }; // QA-P4-12: misafir yokken paylaşım sürmüyor
    resetOnGuestGone(this, room); // A4/AC-24: controlState=VIEW; yeniden bağlanan istemci kapıyı kapalı başlatır
    room.tech?.peer.send({ t: "peer.left", role: "guest", reason: "disconnect" });
    syncDisconnect(this, room);
  }

  /**
   * Yeniden bağlanma (G-10): açık misafir soketi varken çağrılmaz (ws.ts 403 + audit). Lobi yok; yeni token.
   * Eski soket kapanıyor ama `close` olayı henüz işlenmemişse (F5 yarışı, TEST-P4-1) önce ayrılma uygulanır;
   * eski soketin geç gelen `close`'u `guest.peer !== peer` koruması ile etkisiz kalır.
   */
  reattachGuest(room: Room, peer: Peer): void {
    const guest = room.admitted;
    if (!guest) return;
    if (guest.peer) this.detachGuest(room, guest, guest.peer);
    guest.peer = peer;
    sendHelloGuest(this, room, guest);
    sendGuestJoined(room, guest);
    syncDisconnect(this, room);
  }

  startActive(room: Room, guest: Guest, consumedAt: number, maxHours: number): void {
    scheduleActive(this, room, guest, consumedAt, maxHours);
  }

  /** Oturumu bitirir: ACTIVE ise DB ENDED + audit (tek TX), sonra tüm taraflara session.ended ve kapanış. */
  async finish(room: Room, reason: SessionEndedReason, endedBy: "TECH" | "CUSTOMER" | "SYSTEM", ctx: AuditContext = SYSTEM_CTX): Promise<void> {
    if (!this.live(room)) return;
    room.ending = true;
    if (room.admitted) {
      try {
        await this.db.$transaction(async (tx) => {
          if ((await repo.endActive(tx, room.sessionId, new Date(this.clock.now()), endedBy, reason)) === 0) return;
          const actor = endedBy === "TECH" && room.tech ? { userId: room.tech.userId, username: room.tech.username } : { username: endedBy === "CUSTOMER" ? "customer" : "system" };
          await writeAudit(tx, ctx, { tenantId: room.tenantId, ...actor, action: "session.ended", entity: "support_sessions", entityId: room.sessionId, result: "success", oldValue: { status: "ACTIVE" }, newValue: { status: "ENDED", endedBy, reason } });
        });
      } catch (err) {
        this.log.error({ err, sessionId: room.sessionId }, "oturum bitişi DB'ye yazılamadı");
      }
    }
    this.teardown(room, reason);
  }

  /** DB'yi başka katman güncelledi (iptal, zorla sonlandırma): yalnız bildir ve kapat. */
  closeSession(sessionId: string, reason: SessionEndedReason): void {
    const room = this.rooms.get(sessionId);
    if (!room || room.ending) return;
    room.ending = true;
    this.teardown(room, reason);
  }

  private teardown(room: Room, reason: SessionEndedReason): void {
    for (const t of Object.values(room.timers)) this.clock.clearTimeout(t);
    const msg = { t: "session.ended", reason } as const;
    const peers = [room.tech?.peer, room.admitted?.peer, ...[...room.lobby.values()].map((g) => g.peer)];
    for (const g of room.lobby.values()) this.clock.clearTimeout(g.timer);
    if (room.reconnectHash) this.reconnect.delete(room.reconnectHash);
    this.rooms.delete(room.sessionId);
    this.metrics.inc("rs_sessions_ended_total", { reason });
    for (const p of peers) {
      p?.send(msg);
      p?.close(reason === "auth_revoked" && p === room.tech?.peer ? WS_CLOSE.AUTH_REVOKED : WS_CLOSE.NORMAL, reason);
    }
    closeControlOnEnd(this, room); // §3.3 K5-d: session.ended sonrası, en iyi çaba (beklenmez)
  }

  /** Yetki iptali (G-04, AC-115): teknisyenin tüm odaları `auth_revoked` ile biter. */
  async endByTechnician(userId: string): Promise<void> {
    const mine = [...this.rooms.values()].filter((r) => r.technicianId === userId);
    await Promise.all(mine.map((r) => this.finish(r, "auth_revoked", "SYSTEM")));
  }

  /** Yetki değişimi (S-P3-8): bağlı teknisyenin yetki kümesi tazelenir (sonraki admit caps'i buradan), caps yalnız daralır. */
  async applyPermChange(userId: string, permissions: Iterable<PermissionKey>): Promise<void> {
    const perms: ReadonlySet<PermissionKey> = new Set(permissions);
    const jobs: Promise<void>[] = [];
    for (const room of this.rooms.values()) {
      if (room.technicianId !== userId || room.ending) continue;
      if (room.tech?.userId === userId) room.tech.permissions = perms;
      jobs.push(narrowCaps(this, room, perms));
    }
    await Promise.all(jobs);
  }

  techRooms(): Room[] {
    return [...this.rooms.values()].filter((r) => r.tech);
  }

  shutdown(): void {
    for (const room of [...this.rooms.values()]) this.closeSession(room.sessionId, "server");
  }
}

const pending = (g: Guest) =>
  ({ t: "peer.pending", guestId: g.id, name: g.name, guestKind: g.kind, since: new Date(g.since).toISOString() }) as const;
