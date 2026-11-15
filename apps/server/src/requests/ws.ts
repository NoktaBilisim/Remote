// /ws/request ve /ws/panel upgrade + mesaj işleme (mimari-protokol §5.1, §5.3; mimari-e9 §2.1–2.2). Upgrade yolu
// signaling/ws.ts'teki ortak yönlendiriciden gelir (aynı WebSocketServer, ping, maxPayload — kopyalanmaz).
// Talep sırrı yalnız subprotocol'de; ret upgrade öncesi HTTP (403/426/429). Sır, çerez ve ticket loglanmaz.
import type { IncomingMessage } from "node:http";
import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import { BINDING_MIN_CLIENT_VERSION } from "@remote/contracts/api/bindings";
import { WS_SUBPROTOCOL } from "@remote/contracts/ws";
import {
  requestInboundChatSchema,
  requestInboundSchema,
  requestMessageEnvelopeSchema,
  WS_REQUEST_CAP_CHAT,
  WS_REQUEST_CLOSE,
  WS_REQUEST_PREFIX,
  WS_REQUEST_RATE_PER_SEC,
  panelRetryReason,
  type PanelOutbound,
  type RequestChatOutbound,
  type RequestOutbound,
} from "@remote/contracts/ws-request";
import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import type { AuditContext } from "../audit/service.ts";
import { publicClientAllowed } from "../auth/guards.ts";
import { resolveSession } from "../auth/session.ts";
import { sha256Hex } from "../lib/ids.ts";
import { cidrListMatcher, ipKey } from "../lib/ip.ts";
import { compareVersions, isOutdated } from "../lib/version.ts";
import { TokenBucket } from "../signaling/handlers.ts";
import type { JsonPeer, PanelConn, RequestConn } from "./hub.ts";
import { blocked, hitBlocked } from "./limits.ts";
import * as repo from "./repo.ts";
import type { RequestService } from "./service.ts";

export type UpgradeReject = { status: 403 | 404 | 426 | 429; reason: string };
type Accept = (role: "request" | "panel", onOpen: (ws: WebSocket) => void) => void;

const SECRET = /^[A-Za-z0-9_-]{43}$/;

export function jsonPeer<T>(ws: WebSocket): JsonPeer<T> {
  return {
    send: (m) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    },
    close: (code, reason) => ws.close(code, reason),
    isOpen: () => ws.readyState === WebSocket.OPEN,
  };
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export interface RequestChannels {
  request(req: IncomingMessage, url: URL, ctx: AuditContext, accept: Accept): Promise<UpgradeReject | null>;
  panel(req: IncomingMessage, url: URL, ctx: AuditContext, accept: Accept): Promise<UpgradeReject | null>;
  stop(): void;
}

export function requestChannels(app: FastifyInstance, svc: RequestService, revalidateMs = 60_000): RequestChannels {
  const { env, db } = app;
  const policy = { setupEnforced: app.mfaSetupEnforced };
  const { hub, limits, rooms } = svc.d;

  async function request(req: IncomingMessage, url: URL, ctx: AuditContext, accept: Accept): Promise<UpgradeReject | null> {
    if (url.search !== "") return { status: 403, reason: "query" };
    // P19 (§8c.2 m.1, S-P19-3): Origin varsa BROWSER (izinli köken şart), yoksa AGENT kuralı. Satır bulunduktan sonra tür ↔
    // `source` eşleşmeli (web sırrı ajandan, ajan sırrı tarayıcıdan kullanılamaz).
    const kind = req.headers.origin !== undefined ? "BROWSER" : "AGENT";
    if (!publicClientAllowed(req.headers, env.allowedOrigins, kind)) return { status: 403, reason: "client_kind" };
    const ip = ipKey(ctx.ip);
    // P14a (AC-210): `wsUpgrade` kovası güvenilen CIDR'ı (talebin tenant ayarı) sayılmaz → sayım güven belirlenince. Burada
    // yalnız zaten kilitli anahtar reddedilir (sayım yok); ref kovası herkese aynen.
    if (blocked(limits.wsUpgrade, ip) > 0 || blocked(limits.refInvalid, ip) > 0) return { status: 429, reason: "rate" };
    const protos = String(req.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((s) => s.trim());
    const creds = protos.filter((p) => p.startsWith(WS_REQUEST_PREFIX));
    const secret = creds[0]?.slice(WS_REQUEST_PREFIX.length) ?? "";
    if (!protos.includes(WS_SUBPROTOCOL) || creds.length !== 1 || !SECRET.test(secret)) return { status: 403, reason: "protocol" };
    const row = await repo.findBySecretHash(db, sha256Hex(secret));
    if (!row) {
      // Geçersiz sır denemesi req.ref_invalid kovasına sayılır (§5.1).
      const e = svc.refInvalid(ip);
      return { status: e.code === "RATE_LIMITED" ? 429 : 403, reason: "secret" };
    }
    if (row.source !== (kind === "BROWSER" ? "WEB" : "AGENT")) return { status: 403, reason: "client_kind" };
    const now = Date.now();
    const sess = row.session;
    const accepted = row.status === "ACCEPTED" && sess?.status === "PENDING" && sess.expiresAt.getTime() > now;
    if (row.status !== "PENDING" && !accepted) return { status: 403, reason: "state" };
    const settings = await repo.settingsByTenant(db, row.tenantId);
    const trusted = settings ? cidrListMatcher(repo.jsonStrings(settings.trustedCidrs))(ctx.ip) : false;
    if (!trusted && hitBlocked(limits.wsUpgrade, ip) > 0) return { status: 429, reason: "rate" };
    if (!trusted && hub.ipFull(ip)) return { status: 429, reason: "ip_sockets" }; // G-E9-9; güvenilen CIDR muaf (G-E9-16)
    // S-P19-13: sürüm kapıları (426, legacy) yalnız AGENT dalında; WEB satırı hiçbir sürüm kapısından geçmez. AGENT'ta
    // client_version DB CHECK'i gereği NULL olamaz; olursa fail-closed.
    let legacy = false;
    if (row.source === "AGENT") {
      if (row.clientVersion === null) return { status: 403, reason: "client_kind" };
      if (isOutdated(row.clientVersion, env.MIN_AGENT_VERSION)) return { status: 426, reason: "outdated" };
      legacy = compareVersions(row.clientVersion, BINDING_MIN_CLIENT_VERSION) < 0;
    }

    // P18 H3: yetenek bildirimi (sürüme bakılmaz; P19 tarayıcısının clientVersion'ı yok). Yanıt yine yalnız rs.v1.
    const caps = { chat: protos.includes(WS_REQUEST_CAP_CHAT) };
    accept("request", (ws) => {
      const peer = jsonPeer<RequestOutbound | RequestChatOutbound>(ws);
      const conn: RequestConn = {
        peer,
        caps,
        requestId: row.id,
        tenantId: row.tenantId,
        ipKey: ip,
        trusted,
        legacy,
      };
      hub.attachRequest(conn);
      if (row.status === "PENDING") {
        void hub.pushStates(row.tenantId);
        void svc.messages.sendHistory(conn).catch((err: unknown) => svc.logErr(err, "request_ws_history"));
      } else if (sess) {
        const t = rooms.reissueRequestTicket(sess.id, row.id);
        if (t)
          peer.send({
            t: "request.accepted",
            wsTicket: t.wsTicket,
            technicianName: sess.technician.fullName.slice(0, 100),
            techVerifyCode: sess.techVerifyCode,
            ticketExpiresAt: new Date(t.expiresAt).toISOString(),
            ...(t.admitCode ? { admitCode: t.admitCode } : {}),
          });
      }
      const bucket = new TokenBucket(rooms.clock, WS_REQUEST_RATE_PER_SEC);
      const cancel = async (): Promise<void> => {
        const fresh = await repo.findById(db, row.id);
        if (fresh) await svc.customerCancel(ctx, fresh);
      };
      // S-P18-T1 (bağlayıcı): (c) genel kova (5/sn; aşım 1008) → JSON → şema → sohbet kovaları (messages.ts; aşım
      // `error RATE_LIMITED`, soket açık); (a) şema sokete göre — yeteneksiz sokette `request.message` şema dışı → 1008;
      // (b) `switch (msg.t)`: yalnız cancel/decline iptal yoluna.
      const inbound = caps.chat ? requestInboundChatSchema : requestInboundSchema;
      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (!hub.isAttached(conn)) return;
        let msg: unknown;
        try {
          msg = !bucket.take() || isBinary ? null : JSON.parse(data.toString("utf8"));
        } catch {
          msg = null;
        }
        const parsed = inbound.safeParse(msg);
        if (!parsed.success && caps.chat && requestMessageEnvelopeSchema.safeParse(msg).success) {
          // S-P18-K1: zarf geçerli, gövde (S-P18-T8 kuralları) değil → soket açık kalır; talep düşmez. Gövde loglanmaz.
          const reason = parsed.error.issues[0]?.message ?? "Mesaj geçersiz";
          rooms.metrics.inc("rs_request_messages_rejected_total", { reason: "validation" }); // S-P18-K7 (P20 §8d.5)
          hub.sendChatError(row.id, "VALIDATION", reason.slice(0, 300));
          return;
        }
        if (!parsed.success) {
          rooms.metrics.inc("rs_ws_closed_policy_total", { reason: "request_invalid_message" });
          return void ws.close(1008, "policy");
        }
        const m = parsed.data;
        switch (m.t) {
          case "request.cancel":
          case "request.decline": // §5.1: aynı yol
            void cancel().catch((err: unknown) => svc.logErr(err, "request_ws_cancel"));
            return;
          case "request.message":
            void svc.messages.fromCustomer(ctx, conn, m.body, m.clientMsgId).catch((err: unknown) => svc.logErr(err, "request_ws_message"));
            return;
          default: {
            const never: never = m;
            return never;
          }
        }
      });
      ws.on("close", (code: number) => {
        if (!hub.detachRequest(conn)) return;
        if (code === 1000) return void cancel().catch((err: unknown) => svc.logErr(err, "request_ws_close"));
        // Kopma: PENDING ise 120 sn tolerans (AC-141); ACCEPTED talepte 60 sn bağlanma penceresi geçerli.
        void repo.findById(db, row.id).then((fresh) => {
          if (fresh?.status === "PENDING" && !hub.isAttached(conn)) {
            hub.setDisconnect(
              row.id,
              () => void svc.cancelSystem(row.id, "DISCONNECTED").catch((e: unknown) => svc.logErr(e, "request_disconnect")),
              svc.d.timing.requestDisconnectMs,
            );
          }
        });
      });
    });
    return null;
  }

  async function panel(req: IncomingMessage, url: URL, ctx: AuditContext, accept: Accept): Promise<UpgradeReject | null> {
    if (url.search !== "") return { status: 403, reason: "query" };
    if (hitBlocked(limits.panelUpgrade, ipKey(ctx.ip)) > 0) return { status: 429, reason: "rate" };
    const origin = req.headers.origin;
    if (!origin || !env.allowedOrigins.includes(origin)) return { status: 403, reason: "origin" };
    const token = cookieValue(req.headers.cookie, SESSION_COOKIE);
    const auth = token ? await resolveSession(db, token, new Date(), policy) : null;
    if (!token || !auth || auth.user.mustChangePassword) return { status: 403, reason: "auth" };
    if (!auth.permissions.has("support_requests.view") || !auth.tenantId) return { status: 403, reason: "permission" };
    const tenantId = auth.tenantId;
    // P14a (AC-216): tarayıcı el sıkışma yanıtını okuyamaz → oturum kovası aşımında upgrade kabul edilip hemen
    // 4429 `retry=<sn>` ile kapatılır (WS'de Retry-After yok). IP kovası (yukarıda, HTTP 429) aynen.
    const sessionKey = sha256Hex(token);
    let wait = limits.panelSession.blockedFor(sessionKey);
    if (wait === 0 && limits.panelSession.hit(sessionKey)) wait = limits.panelSession.blockedFor(sessionKey);
    if (wait > 0) {
      rooms.metrics.inc("rs_ws_rejected_total", { role: "panel", reason: "session_rate" });
      accept("panel", (ws) => ws.close(WS_REQUEST_CLOSE.TOO_MANY, panelRetryReason(wait)));
      return null;
    }
    accept("panel", (ws) => {
      const conn: PanelConn = { peer: jsonPeer<PanelOutbound>(ws), userId: auth.user.id, tokenHash: sessionKey, token, tenantId };
      if (!hub.addPanel(conn)) return void ws.close(WS_REQUEST_CLOSE.TOO_MANY, "too_many");
      void repo.countPending(db, tenantId).then((pending) => conn.peer.send({ t: "queue.count", pending }));
      ws.on("message", () => {
        rooms.metrics.inc("rs_ws_closed_policy_total", { reason: "panel_inbound" });
        ws.close(1008, "policy"); // tek yönlü kanal
      });
      ws.on("close", () => hub.removePanel(conn));
    });
    return null;
  }

  /** Yedek yol (G-E9-14): 60 sn'de bir oturum + yetki + acting tenant; değiştiyse 4401. */
  const revalidate = setInterval(() => {
    for (const c of hub.panelConns()) {
      void resolveSession(db, c.token, new Date(), policy)
        .then((a) => {
          if (!a || a.user.mustChangePassword || !a.permissions.has("support_requests.view") || a.tenantId !== c.tenantId)
            hub.closePanel(c);
        })
        .catch((err: unknown) => svc.logErr(err, "panel_revalidate"));
    }
  }, revalidateMs);
  revalidate.unref();

  return { request, panel, stop: () => clearInterval(revalidate) };
}
