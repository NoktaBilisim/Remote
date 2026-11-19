// WS upgrade + kimlik (mimari-protokol §1, G-10, AC-14..19, 120): /ws/tech (Origin + çerez + oturum sahibi),
// /ws/guest (sorgu dizesi yok; `Sec-WebSocket-Protocol: rs.v1, rs.ticket.*|rs.reconnect.*`; checkPublicClient
// kuralı ticket kind'ı ile). Ret upgrade öncesi HTTP 403. Ping 30 sn, 2 pong kaçarsa terminate; teknisyen
// oturumu 60 sn'de bir yeniden doğrulanır (G-04; P7/S-P3-8: yetkiler tazelenir, rol değişimi/pasif kullanıcı →
// endByTechnician). Ticket/token/çerez loglanmaz. Kimlik dalları ws-auth.ts'te.
import type { IncomingMessage } from "node:http";
import { STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";
import { WS_MAX_PAYLOAD, WS_SUBPROTOCOL, type ServerOutbound } from "@remote/contracts/ws";
import { WS_DEVICE_PATH } from "@remote/contracts/ws-device";
import type { FastifyInstance } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import { newId } from "../lib/ids.ts";
import { cidrMatcher } from "../lib/ip.ts";
import { FixedWindowCounter } from "../lib/rate.ts";
import { jsonPeer, offeredProtocols, type UpgradeReject } from "../lib/ws-upgrade.ts";
import { WS_CAP_REC } from "@remote/contracts/ws-rec";
import { WS_CAP_MULTI } from "@remote/contracts/ws-multi";
import type { Peer } from "./types.ts";
import type { RequestChannels } from "../requests/ws.ts";
import { bindFsrv } from "./fsrv.ts";
import { bindChat, unbindChat } from "./chat.ts";
import type { Rooms } from "./rooms.ts";
import { createGate } from "../unattended/gate.ts";
import { revalidateDevice } from "./rooms-device.ts";
import { activeVoiceCount } from "./voice.ts";
import { guestUpgrade, revalidateMember, revalidateTech, techUpgrade, type UpgradeCtx } from "./ws-auth.ts";

export interface SignalingOptions {
  pingMs?: number;
  revalidateMs?: number;
  /** Yalnız testler: `/ws/device` kimliksiz soket tavanları (varsayılan K-P27-21 sabitleri 1000 / IP başına 5). */
  deviceUnauth?: { max: number; perIp: number };
  /** Yalnız testler (D-P27-K1): `/ws/device` kimlik doğrulandıktan sonra, hub'a eklemeden önce beklenen kanca. */
  deviceBeforeAttach?: (deviceId: string) => Promise<void>;
}

type Role = "tech" | "guest" | "request" | "panel";

/** P27 `/ws/device` (unattended/device-ws.ts): kendi WebSocketServer'ı, alt protokolü ve 4 KB sınırı vardır. */
export interface DeviceChannel {
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, clientIp: string): void;
  close(): void;
}

function reject(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** Fastify trustProxy ile aynı kural: güvenilen proxy zincirinden ilk güvenilmeyen adres (G-11). */
function clientIpOf(trusted: (ip: string) => boolean, req: IncomingMessage): string {
  const xff = String(req.headers["x-forwarded-for"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .reverse();
  let ip = req.socket.remoteAddress ?? "";
  for (const next of xff) {
    if (!trusted(ip)) break;
    ip = next;
  }
  return ip;
}

function upgradeCtx(app: FastifyInstance, rooms: Rooms, wss: WebSocketServer, missed: WeakMap<WebSocket, number>): UpgradeCtx {
  const trusted = cidrMatcher(app.env.TRUSTED_PROXY_CIDR);
  const clientIp = (req: IncomingMessage): string => clientIpOf(trusted, req);
  return {
    app,
    rooms,
    policy: { setupEnforced: app.mfaSetupEnforced },
    // S-P2/S-P3-7: upgrade IP limiti (31/dk, 60 sn kilit) DB'ye gitmeden önce; teknisyen ve misafir ayrı sayılır.
    // Aşan çerçeve (> WS_MAX_PAYLOAD) ws kütüphanesince 1009 ile kapatılır (S-P3-1).
    guestIp: new FixedWindowCounter(31, 60_000, 60_000),
    techIp: new FixedWindowCounter(31, 60_000, 60_000),
    clientIp,
    ctxOf: (req) => ({ ip: clientIp(req), userAgent: String(req.headers["user-agent"] ?? ""), requestId: newId() }),
    accept: (req, socket, head, role, onOpen) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        missed.set(ws, 0);
        ws.on("pong", () => missed.set(ws, 0));
        // Protokol hatası (ör. > WS_MAX_PAYLOAD → 1009): ws kapanışı kendisi yapar; dinleyicisiz 'error' süreci düşürür.
        ws.on("error", (err: Error & { code?: string }) => app.log.info({ role, code: err.code }, "ws protokol hatası"));
        rooms.metrics.inc("rs_ws_connections_total", { role });
        const peer: Peer = jsonPeer<ServerOutbound>(ws);
        // P28e §6.1: `rs.cap.rec1` (konsol VP8 kaydedebilir / misafir gösterge çizebilir); misafirde katılımlı oda kapısı handlers/rec'te.
        if ((role === "tech" || role === "guest") && offeredProtocols(req).includes(WS_CAP_REC)) peer.rec = true;
        // P28c §4.4: misafir `rs.cap.multi1` (gözetimsiz odada da okunur — pano/yazdırmadan farklı).
        if (role === "guest" && offeredProtocols(req).includes(WS_CAP_MULTI)) peer.multi = true;
        onOpen(ws, peer);
      });
    },
  };
}

function roleOf(pathname: string, channels: RequestChannels | undefined): Role | null {
  if (pathname === "/ws/tech") return "tech";
  if (pathname === "/ws/guest") return "guest";
  if (pathname === "/ws/request" && channels) return "request";
  if (pathname === "/ws/panel" && channels) return "panel";
  return null;
}

function onUpgrade(
  u: UpgradeCtx,
  channels: RequestChannels | undefined,
  device: DeviceChannel | undefined,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === WS_DEVICE_PATH && device) {
    socket.on("error", () => socket.destroy());
    return device.upgrade(req, socket, head, u.clientIp(req));
  }
  const role = roleOf(url.pathname, channels);
  if (!role) return reject(socket, 404);
  socket.on("error", () => socket.destroy());
  const channelAccept = (r: "request" | "panel", onOpen: (ws: WebSocket) => void): void =>
    u.accept(req, socket, head, r, (ws) => onOpen(ws));
  const run = (): Promise<UpgradeReject | null> => {
    if (role === "tech") return techUpgrade(u, req, url, socket, head);
    if (role === "guest") return guestUpgrade(u, req, url, socket, head);
    if (!channels) return Promise.resolve({ status: 404, reason: "path" });
    return role === "request"
      ? channels.request(req, url, u.ctxOf(req), channelAccept)
      : channels.panel(req, url, u.ctxOf(req), channelAccept);
  };
  run()
    .then((r) => {
      if (!r) return;
      u.rooms.metrics.inc("rs_ws_rejected_total", { role, reason: r.reason });
      u.app.log.info({ role, reason: r.reason }, "ws upgrade reddedildi");
      reject(socket, r.status);
    })
    .catch((err: unknown) => {
      u.app.log.error({ err }, "ws upgrade hatası");
      reject(socket, 500);
    });
}

/** Ping 30 sn (2 pong kaçarsa terminate) + teknisyen oturumu 60 sn'de bir yeniden doğrulanır. */
function startTimers(u: UpgradeCtx, wss: WebSocketServer, missed: WeakMap<WebSocket, number>, opts: SignalingOptions): () => void {
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
  const stopDevices = startDeviceRevalidation(u, opts.revalidateMs ?? 60_000);
  const revalidate = setInterval(() => {
    for (const room of u.rooms.techRooms()) {
      const t = room.tech;
      if (t) void revalidateTech(u, room, t).catch((err: unknown) => u.app.log.error({ err }, "ws teknisyen yeniden doğrulama hatası"));
      // P28c Y-PC-2 / O-PC-3: üyelerin kimlik oturumu da 60 sn'de doğrulanır; düşerse yalnız üye çıkar (oda sürer).
      for (const m of [...room.multi.members.values()])
        if (m.conn) void revalidateMember(u, room, m).catch((err: unknown) => u.app.log.error({ err }, "ws üye yeniden doğrulama hatası"));
    }
  }, opts.revalidateMs ?? 60_000);
  ping.unref();
  revalidate.unref();
  return () => {
    clearInterval(ping);
    clearInterval(revalidate);
    stopDevices();
  };
}

/**
 * P27 (O-P27-3, K-P27-18): gözetimsiz odalar teknisyen bağlı olmasa da `revalidateMs`'de bir yeniden doğrulanır (grant /
 * iptal / yerel anahtar / imza kapısı). `rooms.clock` üzerinde (sahte saatle test edilir; AC-338 ≤ 60 sn yedek yol).
 */
function startDeviceRevalidation(u: UpgradeCtx, ms: number): () => void {
  const gate = createGate(u.app.env);
  let stopped = false;
  let handle: unknown;
  const tick = (): void => {
    for (const room of [...u.rooms.values()].filter((r) => r.unattended))
      void revalidateDevice(u.rooms, gate, room).catch((err: unknown) => u.app.log.error({ err }, "ws cihaz yeniden doğrulama hatası"));
    if (!stopped) handle = u.rooms.clock.setTimeout(tick, ms);
  };
  handle = u.rooms.clock.setTimeout(tick, ms);
  return () => {
    stopped = true;
    u.rooms.clock.clearTimeout(handle);
  };
}

export function attachSignaling(
  app: FastifyInstance,
  rooms: Rooms,
  opts: SignalingOptions = {},
  channels?: RequestChannels,
  panelCount?: () => Record<string, number>,
  device?: DeviceChannel,
): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: WS_MAX_PAYLOAD,
    perMessageDeflate: false,
    handleProtocols: (p) => (p.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false),
  });
  const missed = new WeakMap<WebSocket, number>();
  const u = upgradeCtx(app, rooms, wss, missed);
  if (app.hasDecorator("fsrv")) bindFsrv(rooms, app.fsrv.service); // P28b: wiring.ts kurar, sinyal bağlar
  rooms.unattendedGate = createGate(app.env); // P28c D-PC-K4: devir TX'i hedefin cihaz erişimini yeniden okur
  // P22 (§4.3): sohbet şifreleme + firma müşteri kovası aşımında panellere `queue.alert` (talep hub'ı).
  bindChat(rooms, {
    secrets: app.secrets,
    ...(app.hasDecorator("requestHub")
      ? { alert: (tenantId: string, until: string) => app.requestHub.publish(tenantId, { t: "queue.alert", kind: "rate_limited", until }) }
      : {}),
  });
  // Etiketsiz seri: toplam; P8b `role="request"|"panel"` serileri (devops metrik adı).
  // P28c §8: bağlı üye sayısı rol başına (tenant etiketi yok).
  rooms.metrics.gauge("rs_multi_members", "Çoklu teknisyen bağlı üyeler (anlık)", () => {
    const n = { participant: 0, observer: 0 };
    for (const r of rooms.values()) for (const m of r.multi.members.values()) if (m.conn) n[m.role] += 1;
    return n;
  });
  // P28d §6: etkin sesli görüşme sayısı (etiketsiz).
  rooms.metrics.gauge("rs_voice_active", "Etkin sesli görüşmeler (anlık)", () => activeVoiceCount(rooms.values()));
  rooms.metrics.gauge("rs_ws_connections", "Açık WS bağlantıları (anlık)", () => ({
    "": wss.clients.size,
    ...(panelCount ? panelCount() : {}),
  }));
  app.server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => onUpgrade(u, channels, device, req, socket, head));
  const stopTimers = startTimers(u, wss, missed, opts);
  // preClose: server.close() yükseltilmiş soketleri beklemesin diye önce WS'ler kapatılır.
  app.addHook("preClose", async () => {
    stopTimers();
    channels?.stop();
    device?.close();
    u.guestIp.close();
    u.techIp.close();
    rooms.shutdown();
    unbindChat(rooms);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  });
}
