// Oda + lobi durum makinesi (mimari-protokol §1, §3.1; akışlar A1, A4, A5). Tek instance, bellek içi.
// DB'ye yalnız oturum bitişi (ACTIVE→ENDED) yazılır; tüketim admit.ts'te tek atomik UPDATE ile. Lobi işlemleri rooms-lobby.ts'te.
import type { BindingRequest, IssueOutcome } from "./binding.ts";
import type { FastifyBaseLogger } from "fastify";
import type { PermissionKey } from "@remote/contracts/permissions";
import type { GuestKind, SessionEndedReason } from "@remote/contracts/ws";
import { WS_CLOSE } from "@remote/contracts/ws";
import type { AuditContext } from "../audit/service.ts";
import type { Db } from "../lib/db.ts";
import type { Metrics } from "../ops/metrics.ts";
import type { RoomNotifier } from "../sessions/service.ts";
import { OneTimeStore } from "./store.ts";
import type { TurnConfig } from "./turn.ts";
import {
  DEFAULT_TIMING,
  realClock,
  type Clock,
  type Guest,
  type Peer,
  type Room,
  type TechConn,
  type TechnicianLiveControl,
  type Timing,
} from "./types.ts";
import { recordEnded, scheduleActive, sendGuestJoined, sendHelloGuest, sendHelloTech, syncDisconnect } from "./active.ts";
import { newControl } from "./control.ts";
import { closeControlOnEnd, narrowCaps, resetOnGuestGone, revokeOnTechChange } from "./control-revoke.ts";
import { endDeviceRoom } from "./rooms-device.ts";
import * as lobby from "./rooms-lobby.ts";
import { pending, type RoomRow } from "./rooms-lobby.ts";

export { admitHash } from "./rooms-lobby.ts";

interface RoomsDeps {
  db: Db;
  log: FastifyBaseLogger;
  turn: TurnConfig;
  metrics: Metrics;
  clock?: Clock;
  timing?: Partial<Timing>;
}

const SYSTEM_CTX: AuditContext = { ip: "", userAgent: "signaling", requestId: "" };

export class Rooms implements RoomNotifier, TechnicianLiveControl {
  readonly db: Db;
  readonly log: FastifyBaseLogger;
  /** P11 (G-13): panel kaydı (system_settings `turn`) değişince `settings/system.ts` günceller; yoksa env. */
  turn: TurnConfig;
  readonly metrics: Metrics;
  readonly clock: Clock;
  readonly timing: Timing;
  readonly nonces: OneTimeStore<{ sessionId: string; kind: GuestKind; clientVersion?: string }>;
  readonly tickets: OneTimeStore<{ sessionId: string; guestId: string; gen?: number }>;
  /** P8b: talep servisine geri çağrılar (admit sonrası bağlanma zamanlayıcısı iptali; yetki kaybında bağlanamadı). */
  requestHooks?: { admitted(requestId: string): void; failed(requestId: string): void };
  /**
   * P8c (ADR-0017, protokol §6): `binding.request` verme TX'i — bindings servisi bağlar. Yoksa (test/eski kurulum) teklif
   * gönderilmez. Kayıt oturum yetkisi vermez; bu kanca yalnız admit edilmiş AGENT misafirin soketinden çağrılır.
   */
  bindingIssuer?: (room: Room, guest: Guest, req: BindingRequest) => Promise<IssueOutcome>;
  /** P27: gözetimsiz oda bitti (teardown) — DeviceHub cihaza `disconnect` + audit/metrik yazar (commit sonrası, en iyi çaba). */
  deviceEnded?: (room: Room, reason: SessionEndedReason) => void;
  /** P27: DeviceHub — müşteri pasifinde iptal edilen cihazların soketi/odası (customers/service.ts, commit sonrası). */
  devices?: { revoked(deviceId: string): void };
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
  values(): IterableIterator<Room> {
    return this.rooms.values();
  } // P13b-L salt okuma (lobby-count.ts)
  get(sessionId: string): Room | undefined {
    return this.rooms.get(sessionId);
  }
  live(room: Room): boolean {
    return !room.ending && this.rooms.get(room.sessionId) === room;
  }

  /** P27: rooms-device.ts `preAdmitDevice` de kullanır. */
  getOrCreate(row: RoomRow): Room {
    let room = this.rooms.get(row.id);
    if (!room) {
      room = {
        sessionId: row.id,
        tenantId: row.tenantId,
        technicianId: row.technicianId,
        technicianName: row.technician.fullName,
        expiresAt: row.expiresAt.getTime(),
        lobby: new Map(),
        admitting: false,
        admitFails: 0,
        rejectedIps: new Set(),
        caps: [],
        fileMeta: { quotas: new Map(), auditAt: new Map() },
        control: newControl(),
        timers: {},
        ending: false,
        lobbyArrivals: 0,
      };
      this.rooms.set(row.id, room);
    }
    return room;
  }

  /** Lobiye (TICKETED) misafir ekler — join (A1). Ret listesi → 403, lobi dolu → 409 LOBBY_FULL. */
  addGuest(row: RoomRow, g: lobby.AddGuestInput): { guestId: string; admitCode: string; wsTicket: string } {
    return lobby.addGuest(this, row, g);
  }
  /** P8b ön-kabul (talep istemcisi; rooms-lobby.ts). */
  preAdmitGuest(row: RoomRow, g: lobby.PreAdmitInput): lobby.TicketOut {
    return lobby.preAdmitGuest(this, row, g);
  }
  /** Talep oturumu için yeniden ticket (oturum hâlâ PENDING). Misafir yoksa null. */
  reissueRequestTicket(sessionId: string, requestId: string): lobby.TicketOut | null {
    return lobby.reissueRequestTicket(this, sessionId, requestId);
  }
  /** Ticket ile gelen misafir → LOBBY (lobby.wait + teknisyene peer.pending). */
  attachGuest(room: Room, guest: Guest, peer: Peer): void {
    lobby.attachGuest(this, room, guest, peer);
  }
  /** Lobiden çıkış: misafire (gerekirse) session.ended, teknisyene peer.pending.left. */
  leaveLobby(room: Room, guest: Guest, why: "left" | "timeout" | "rejected", ended?: SessionEndedReason): void {
    lobby.leaveLobby(this, room, guest, why, ended);
  }

  /**
   * Boş oda silinir. Ret listesi / hatalı kod sayacı taşıyan oda (AC-113 tekrar katılımı engellemek için) yalnız
   * PENDING süresi bitene kadar tutulur; o anda yeniden kontrol edilip silinir (S-P3-4, sınırlı yaşam).
   */
  dropRoomIfIdle(room: Room, ticketedId?: string): void {
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
  async finish(
    room: Room,
    reason: SessionEndedReason,
    endedBy: "TECH" | "CUSTOMER" | "SYSTEM",
    ctx: AuditContext = SYSTEM_CTX,
  ): Promise<void> {
    if (!this.live(room)) return;
    room.ending = true;
    if (room.admitted) await recordEnded(this, room, reason, endedBy, ctx);
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
    if (room.unattended) this.deviceEnded?.(room, reason);
    closeControlOnEnd(this, room); // §3.3 K5-d: session.ended sonrası, en iyi çaba (beklenmez)
  }

  /** Yetki iptali (G-04, AC-115): teknisyenin tüm odaları `auth_revoked` ile biter. */
  async endByTechnician(userId: string): Promise<void> {
    const mine = [...this.rooms.values()].filter((r) => r.technicianId === userId);
    await Promise.all(mine.map((r) => this.finish(r, "auth_revoked", "SYSTEM")));
  }

  /** P9 (AC-70, AC-115): tenant pasife alındı — o tenant'ın tüm odaları (lobi dahil) `tenant_passive` ile biter. */
  async endByTenant(tenantId: string): Promise<void> {
    const mine = [...this.rooms.values()].filter((r) => r.tenantId === tenantId);
    await Promise.all(mine.map((r) => this.finish(r, "tenant_passive", "SYSTEM")));
  }

  /** Yetki değişimi (S-P3-8): bağlı teknisyenin yetki kümesi tazelenir (sonraki admit caps'i buradan), caps yalnız daralır. */
  async applyPermChange(userId: string, permissions: Iterable<PermissionKey>): Promise<void> {
    const perms: ReadonlySet<PermissionKey> = new Set(permissions);
    const jobs: Promise<void>[] = [];
    for (const room of this.rooms.values()) {
      if (room.technicianId !== userId || room.ending) continue;
      // P27 (§4.4): `unattended.connect` düştüyse gözetimsiz oda `permission` ile biter (PENDING ise DB CANCELLED).
      if (room.unattended && !perms.has("unattended.connect")) {
        jobs.push(endDeviceRoom(this, room, "permission"));
        continue;
      }
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
