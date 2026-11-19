// P27 `/ws/device` soket yaşam döngüsü (mimari-p27 §4.4, r2 D-P27-1 / K-P27-21; AC-273, 339). Upgrade öncesi: sorgu dizesi
// yok (G-10), Origin YOK (tarayıcıdan açılamaz), alt protokol `rs.device.v1`, IP kovası 31/dk (60 sn kilit), kimliksiz soket
// tavanı süreç geneli 1000 + IP başına 5 (aşımda 503, soket hiç açılmaz). Açılışta `device.hello{nonce}`; 10 sn içinde geçerli
// `device.auth` yoksa 4401. Kimliksiz soket hiçbir mesaj almaz. Mesaj ≤ 4 KB (1009), cihaz başına 5 msg/sn (aşım 1008).
// Ping 30 sn / 2 kayıp → terminate. Nonce/imza/IP dışı içerik loglanmaz.
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";
import {
  DEVICE_ANNOUNCED_FEATURES,
  DEVICE_AUTH_TIMEOUT_MS,
  DEVICE_FEATURE_BY_SUBPROTOCOL,
  deviceAuthSchema,
  deviceConsentInboundSchema,
  deviceInboundSchema,
  WS_DEVICE_CLOSE,
  WS_DEVICE_MAX_PAYLOAD,
  WS_DEVICE_PROTOCOL_VERSION,
  WS_DEVICE_RATE_PER_SEC,
  WS_DEVICE_SUBPROTOCOL,
  type DeviceConsentOutbound,
  type DeviceRecordOutbound,
  type DeviceFeature,
  type DeviceOutbound,
} from "@remote/contracts/ws-device";
import type { FastifyInstance } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import type { AuditContext } from "../audit/service.ts";
import { newId } from "../lib/ids.ts";
import { ipKey } from "../lib/ip.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { jsonPeer, offeredProtocols } from "../lib/ws-upgrade.ts";
import { TokenBucket } from "../signaling/handlers.ts";
import type { DeviceChannel } from "../signaling/ws.ts";
import { authenticateDevice, deviceLiveState, type AuthDeps } from "./device-auth.ts";
import { onDeviceMessage } from "./device-msg.ts";
import { createGate } from "./gate.ts";
import type { DeviceConn, DeviceHub } from "./hub.ts";

/** K-P27-21: sabit (env yok); yalnız testler `createDeviceChannel` seçeneğiyle küçültür. */
export const UNAUTH_MAX = 1000;
export const UNAUTH_PER_IP = 5;

interface Ctx {
  app: FastifyInstance;
  hub: DeviceHub;
  wss: WebSocketServer;
  auth: AuthDeps;
  ipBucket: FixedWindowCounter;
  unauth: { total: number; perIp: Map<string, number>; max: number; maxPerIp: number };
  missed: WeakMap<WebSocket, number>;
  /** Yalnız testler (D-P27-K1 yarışı): kimlik doğrulandıktan sonra, hub'a eklemeden önce. */
  beforeAttach?: ((deviceId: string) => Promise<void>) | undefined;
}

type Peer = ReturnType<typeof jsonPeer<DeviceOutbound | DeviceConsentOutbound | DeviceRecordOutbound>>;

/** Soket başına kimlik durumu (open ↔ beginAuth). */
interface SockState {
  conn: DeviceConn | undefined;
  authing: boolean;
  /** P28u §6.1: upgrade'de bildirilen belirteçler (bilinmeyen yok sayılır; kimlik değildir). */
  caps: ReadonlySet<DeviceFeature>;
}

/** `rs.cap.*` alt protokol belirteçleri → yetenek kümesi (P28a kalıbı). */
function capsOf(req: IncomingMessage): ReadonlySet<DeviceFeature> {
  const out = new Set<DeviceFeature>();
  for (const p of offeredProtocols(req)) {
    const f = DEVICE_FEATURE_BY_SUBPROTOCOL[p];
    if (f) out.add(f);
  }
  return out;
}

function reject(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** Upgrade öncesi ret nedeni ya da null (kabul). */
function precheck(c: Ctx, req: IncomingMessage, key: string): { status: number; reason: string } | null {
  if (new URL(req.url ?? "/", "http://x").search !== "") return { status: 403, reason: "query" };
  if (req.headers.origin !== undefined) return { status: 403, reason: "origin" };
  if (!offeredProtocols(req).includes(WS_DEVICE_SUBPROTOCOL)) return { status: 403, reason: "protocol" };
  if (c.ipBucket.blockedFor(key) > 0 || c.ipBucket.hit(key)) return { status: 429, reason: "rate" };
  if (c.unauth.total >= c.unauth.max || (c.unauth.perIp.get(key) ?? 0) >= c.unauth.maxPerIp) {
    c.app.metrics.inc("rs_unattended_device_auth_total", { result: "unauth_cap" });
    return { status: 503, reason: "unauth_cap" };
  }
  return null;
}

/** Kimliksiz sayaçtan tek kez düşüren işlev (auth başarısı ya da kapanış — hangisi önce). */
function holdUnauth(c: Ctx, key: string): () => void {
  c.unauth.total += 1;
  c.unauth.perIp.set(key, (c.unauth.perIp.get(key) ?? 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    c.unauth.total -= 1;
    const n = (c.unauth.perIp.get(key) ?? 1) - 1;
    if (n <= 0) c.unauth.perIp.delete(key);
    else c.unauth.perIp.set(key, n);
  };
}

function upgrade(c: Ctx, req: IncomingMessage, socket: Duplex, head: Buffer, ip: string): void {
  const key = ipKey(ip);
  const r = precheck(c, req, key);
  if (r) {
    c.app.metrics.inc("rs_ws_rejected_total", { role: "device", reason: r.reason });
    return reject(socket, r.status);
  }
  const release = holdUnauth(c, key);
  socket.once("close", release);
  c.wss.handleUpgrade(req, socket, head, (ws) => {
    c.missed.set(ws, 0);
    ws.on("pong", () => c.missed.set(ws, 0));
    ws.on("error", (err: Error & { code?: string }) => c.app.log.info({ role: "device", code: err.code }, "ws protokol hatası"));
    c.app.metrics.inc("rs_ws_connections_total", { role: "device" });
    const ctx: AuditContext = { ip, userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300), requestId: newId() };
    open(c, ws, ctx, release, capsOf(req));
  });
}

function open(c: Ctx, ws: WebSocket, ctx: AuditContext, release: () => void, caps: ReadonlySet<DeviceFeature>): void {
  const peer = jsonPeer<DeviceOutbound | DeviceConsentOutbound | DeviceRecordOutbound>(ws);
  const nonce = randomBytes(32).toString("base64url");
  const bucket = new TokenBucket(c.app.rooms.clock, WS_DEVICE_RATE_PER_SEC);
  const s: SockState = { conn: undefined, authing: false, caps };
  const clock = c.app.rooms.clock;
  const timer = clock.setTimeout(() => {
    if (!s.conn) ws.close(WS_DEVICE_CLOSE.AUTH_FAILED, "auth_timeout");
  }, DEVICE_AUTH_TIMEOUT_MS);
  peer.send({ t: "device.hello", v: WS_DEVICE_PROTOCOL_VERSION, nonce });
  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary || !bucket.take()) return ws.close(1008, isBinary ? "binary" : "rate");
    const json = parseJson(data);
    if (!s.conn) return beginAuth(c, ws, peer, { ctx, nonce, json, s, release });
    // K2 devir: önce taban şema; `consent1` sokette olmazsa P28u birliği (belirteçsizde denenmez → 1008).
    const base = deviceInboundSchema.safeParse(json);
    const m = base.success ? base : s.conn.caps.has("consent1") ? deviceConsentInboundSchema.safeParse(json) : base;
    if (!m.success) return ws.close(1008, "invalid");
    const deps = { rooms: c.app.rooms, hub: c.hub, now: () => c.app.rooms.clock.now() };
    void onDeviceMessage(deps, s.conn, ctx, m.data).catch((err: unknown) =>
      c.app.log.error({ err, t: m.data.t }, "cihaz mesajı işlenemedi"),
    );
  });
  ws.on("close", () => {
    clock.clearTimeout(timer);
    release();
    if (s.conn && c.hub.detach(s.conn)) void touchLastSeen(c, s.conn.deviceId);
  });
}

/** Kimliksiz sokette tek izinli mesaj `device.auth` (ikincisi / biçim dışı → 1008). */
function beginAuth(
  c: Ctx,
  ws: WebSocket,
  peer: Peer,
  a: { ctx: AuditContext; nonce: string; json: unknown; s: SockState; release: () => void },
): void {
  const m = deviceAuthSchema.safeParse(a.json);
  if (!m.success || a.s.authing) return ws.close(1008, "invalid");
  a.s.authing = true;
  void authenticate(c, ws, peer, a.ctx, a.nonce, m.data, a.s.caps)
    .then((ok) => {
      a.s.conn = ok;
      if (ok) a.release();
    })
    .catch((err: unknown) => {
      c.app.log.error({ err }, "cihaz kimlik doğrulaması başarısız");
      ws.close(1011, "error");
    });
}

function parseJson(data: Buffer): unknown {
  try {
    return JSON.parse(data.toString("utf8"));
  } catch {
    return undefined;
  }
}

async function authenticate(
  c: Ctx,
  ws: WebSocket,
  peer: Peer,
  ctx: AuditContext,
  nonce: string,
  m: Parameters<typeof authenticateDevice>[3],
  caps: ReadonlySet<DeviceFeature>,
): Promise<DeviceConn | undefined> {
  const out = await authenticateDevice(c.auth, ctx, nonce, m);
  if (out.ok) await c.beforeAttach?.(m.deviceId);
  if (ws.readyState !== WebSocket.OPEN) return undefined;
  if (!out.ok) {
    if (out.revoked) peer.send({ t: "revoked" });
    ws.close(out.code, out.reason);
    return undefined;
  }
  const conn: DeviceConn = { deviceId: m.deviceId, tenantId: out.tenantId, ip: ctx.ip, send: peer.send, close: peer.close, caps };
  if (!(await confirmAttached(c, ws, peer, conn))) return undefined;
  peer.send({ t: "device.ready", tenantName: out.tenantName.slice(0, 120), customerName: out.customerName.slice(0, 120) });
  // P28u §6.1: `device.ready` değişmez; yalnız belirteci bildiren sokete hemen ardından `device.features`. S-P28u-r3-5 / r3.3:
  // yankı `DEVICE_ANNOUNCED_FEATURES` ile süzülür — `direct1` yalnız `DeviceConn.caps`'te (eski Go `validFeatures` katı).
  const announced = DEVICE_ANNOUNCED_FEATURES.filter((f) => caps.has(f));
  if (announced.length > 0) peer.send({ t: "device.features", caps: announced });
  return conn;
}

/**
 * D-P27-K1: hub'a ekle → durumu yeniden oku. Okuma ile ekleme arasında iptal / firma pasifi commit edildiyse (hub çağrısı
 * soketi henüz bulamamıştı) burada `revoked{}` + 4401 / 4401 ile kapanır; hub zaten kapattıysa (detach false) dokunulmaz.
 */
async function confirmAttached(c: Ctx, ws: WebSocket, peer: Peer, conn: DeviceConn): Promise<boolean> {
  c.hub.attach(conn);
  const state = await deviceLiveState(c.auth.db, conn.deviceId);
  if (state === "ok" && ws.readyState === WebSocket.OPEN && c.hub.get(conn.deviceId) === conn) return true;
  if (!c.hub.detach(conn)) return false;
  if (state !== "ok") c.app.metrics.inc("rs_unattended_device_auth_total", { result: state });
  if (state === "revoked") peer.send({ t: "revoked" });
  ws.close(WS_DEVICE_CLOSE.AUTH_FAILED, state);
  return false;
}

async function touchLastSeen(c: Ctx, deviceId: string): Promise<void> {
  await c.app.db.unattendedDevice
    .updateMany({ where: { id: deviceId, revokedAt: null }, data: { lastSeenAt: new Date() } })
    .catch((err: unknown) => c.app.log.error({ err }, "cihaz last_seen_at yazılamadı"));
}

function startPing(c: Ctx, pingMs: number): NodeJS.Timeout {
  const t = setInterval(() => {
    for (const ws of c.wss.clients) {
      const n = c.missed.get(ws) ?? 0;
      if (n >= 2) ws.terminate();
      else {
        c.missed.set(ws, n + 1);
        ws.ping();
      }
    }
  }, pingMs);
  t.unref();
  return t;
}

/** signaling/ws.ts `attachSignaling`'e verilen `/ws/device` kanalı. */
export function createDeviceChannel(
  app: FastifyInstance,
  hub: DeviceHub,
  opts: { pingMs?: number; unauth?: { max: number; perIp: number }; beforeAttach?: (deviceId: string) => Promise<void> } = {},
): DeviceChannel & { unauthCount(): number } {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: WS_DEVICE_MAX_PAYLOAD,
    perMessageDeflate: false,
    handleProtocols: (p) => (p.has(WS_DEVICE_SUBPROTOCOL) ? WS_DEVICE_SUBPROTOCOL : false),
  });
  const origin = new URL(app.env.PUBLIC_BASE_URL).origin;
  const auth: AuthDeps = { db: app.db, gate: createGate(app.env), metrics: app.metrics, origin, now: Date.now, failAuditAt: new Map() };
  const c: Ctx = {
    app,
    hub,
    wss,
    auth,
    ipBucket: new FixedWindowCounter(31, 60_000, 60_000),
    unauth: { total: 0, perIp: new Map(), max: opts.unauth?.max ?? UNAUTH_MAX, maxPerIp: opts.unauth?.perIp ?? UNAUTH_PER_IP },
    missed: new WeakMap(),
    beforeAttach: opts.beforeAttach,
  };
  const ping = startPing(c, opts.pingMs ?? 30_000);
  return {
    upgrade: (req, socket, head, ip) => upgrade(c, req, socket, head, ip),
    unauthCount: () => c.unauth.total,
    close: () => {
      clearInterval(ping);
      c.ipBucket.close();
      hub.closeAll();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
