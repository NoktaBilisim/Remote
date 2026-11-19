// P3 sinyalizasyon test yardımcıları: sahte saat (AC-13/25), sahte Peer (ağsız oda testleri), gerçek WS istemcisi.
import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import type { ServerOutbound } from "@remote/contracts/ws";
import { WS_CAP_SCHAT } from "@remote/contracts/ws-chat";
import type { PermissionKey } from "@remote/contracts/permissions";
import pino from "pino";
import { WebSocket, type ClientOptions } from "ws";
import { createMetrics } from "../../src/ops/metrics.ts";
import { acceptConsent } from "../../src/public/consent.ts";
import * as repo from "../../src/sessions/repo.ts";
import { Rooms } from "../../src/signaling/rooms.ts";
import type { Clock, Peer, TechConn } from "../../src/signaling/types.ts";
import { createSupportSessionRow, createTenant, createUser, currentConsentId, testDb } from "./app.ts";
import { FAKE_TURN_SECRET } from "./secrets.ts";

export class FakeClock implements Clock {
  t = Date.now();
  private seq = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();
  now = (): number => this.t;
  setTimeout = (fn: () => void, ms: number): unknown => {
    this.timers.set(++this.seq, { at: this.t + ms, fn });
    return this.seq;
  };
  clearTimeout = (h: unknown): void => {
    this.timers.delete(h as number);
  };
  /** Bekleyen zamanlayıcı sayısı. */
  get pending(): number {
    return this.timers.size;
  }
  /** Şu andan `ms` sonra tam vadeli zamanlayıcı var mı (async kurulan zamanlayıcıyı beklemek için). */
  hasTimerIn(ms: number): boolean {
    return [...this.timers.values()].some((v) => v.at === this.t + ms);
  }
  /** Saati ilerletir; aradaki zamanlayıcıları sırayla çalıştırır. */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, v]) => v.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
    }
    this.t = target;
  }
}

export interface FakePeer extends Peer {
  sent: ServerOutbound[];
  closed: { code: number; reason: string } | null;
  of<T extends ServerOutbound["t"]>(t: T): Extract<ServerOutbound, { t: T }>[];
}

export function fakePeer(): FakePeer {
  const p: FakePeer = {
    sent: [],
    closed: null,
    send: (m) => void p.sent.push(m),
    close: (code, reason) => void (p.closed ??= { code, reason }),
    isOpen: () => p.closed === null,
    of: <T extends ServerOutbound["t"]>(t: T) => p.sent.filter((m): m is Extract<ServerOutbound, { t: T }> => m.t === t),
  };
  return p;
}

export const TURN = { urls: ["stun:turn.test:3478", "turn:turn.test:3478?transport=udp"], secret: FAKE_TURN_SECRET, ttlMin: 60 };
export const silentLog = pino({ level: "silent" });

export function makeRooms(clock: Clock = new FakeClock()): Rooms {
  return new Rooms({ db: testDb(), log: silentLog, turn: TURN, metrics: createMetrics(), clock });
}

/** Tenant + teknisyen + PENDING oturum + odaya bağlı sahte teknisyen. */
export async function roomFixture(rooms: Rooms, perms: PermissionKey[] = ["sessions.create", "remote_control.use"]) {
  const tenant = await createTenant();
  const user = await createUser({ tenantId: tenant.id, role: "USER", perms: Object.fromEntries(perms.map((p) => [p, true])) });
  const s = await createSupportSessionRow({ tenantId: tenant.id, technicianId: user.id });
  const row = await repo.findForSignal(testDb(), s.id);
  if (!row) throw new Error("oturum yok");
  const techPeer = fakePeer();
  const tech: TechConn = {
    peer: techPeer,
    userId: user.id,
    username: user.email,
    authToken: "x",
    permissions: new Set(perms),
    role: "USER",
    ctx: { ip: "10.0.0.1", userAgent: "test", requestId: "r" },
  };
  const room = rooms.attachTech(row, tech);
  const consent = await acceptConsent(testDb(), tenant.id, await currentConsentId(tenant.id), { ip: "203.0.113.7", userAgent: "test-ua" });
  /** join + ticket ile WS → LOBBY. */
  const guest = (ipKey = "203.0.113.7", kind: "BROWSER" | "AGENT" = "BROWSER") => {
    const g = rooms.addGuest(row, { name: "Ayşe Müşteri", kind, ipKey, consent });
    const t = rooms.tickets.take(g.wsTicket);
    const entry = t ? room.lobby.get(t.guestId) : undefined;
    if (!entry) throw new Error("ticket geçersiz");
    const peer = fakePeer();
    rooms.attachGuest(room, entry, peer);
    return { ...g, entry, peer };
  };
  return { tenant, user, session: s, row, room, tech, techPeer, guest, consent };
}

export interface WsClient {
  ws: WebSocket;
  msgs: ServerOutbound[];
  waitFor<T extends ServerOutbound["t"]>(t: T, ms?: number): Promise<Extract<ServerOutbound, { t: T }>>;
  closed: Promise<{ code: number; reason: string }>;
  send(o: object): void;
}

/**
 * Açılırsa istemci; upgrade reddedilirse HTTP durum koduyla reject. P22 (r2 §15.2): yeni konsol `/ws/tech`'e her zaman
 * `rs.cap.schat1` bildirir — burada da eklenir (eski konsol davranışı `connectRaw` ile denenir).
 */
export function connect(
  url: string,
  protocols: string[],
  headers: Record<string, string> = {},
  opts: ClientOptions = {},
): Promise<WsClient> {
  const tech = new URL(url).pathname === "/ws/tech" && !protocols.includes(WS_CAP_SCHAT);
  return connectRaw(url, tech ? [...protocols, WS_CAP_SCHAT] : protocols, headers, opts);
}

/** Alt protokol listesine dokunmadan bağlanır. */
export function connectRaw(
  url: string,
  protocols: string[],
  headers: Record<string, string> = {},
  opts: ClientOptions = {},
): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocols, { ...opts, headers });
    const msgs: ServerOutbound[] = [];
    const waiters: (() => void)[] = [];
    ws.on("message", (d: Buffer) => {
      msgs.push(JSON.parse(d.toString()) as ServerOutbound);
      waiters.splice(0).forEach((w) => w());
    });
    const closed = new Promise<{ code: number; reason: string }>((r) =>
      ws.on("close", (code, reason) => r({ code, reason: reason.toString() })),
    );
    ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on("error", (e) => reject(e));
    ws.on("open", () =>
      resolve({
        ws,
        msgs,
        closed,
        send: (o) => ws.send(JSON.stringify(o)),
        waitFor: (t, ms = 10_000) =>
          // QA-P8b-1: yük altında 3 sn tavanı yetmiyor; mesaj gelince hemen döner
          new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`beklenen mesaj gelmedi: ${t}`)), ms);
            const check = () => {
              const m = msgs.find((x) => x.t === t);
              if (!m) return void waiters.push(check);
              msgs.splice(msgs.indexOf(m), 1);
              clearTimeout(timer);
              res(m as Extract<ServerOutbound, { t: typeof t }>);
            };
            check();
          }),
      }),
    );
  });
}

export const techHeaders = (token: string, origin: string) => ({ origin, cookie: `${SESSION_COOKIE}=${token}` });
