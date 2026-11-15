// E2E sahte API — P19 J5 (AC-259, 261, 263): herkese açık web talep formu (/r/<ref>), /ws/request (sahte), talep ayarı
// web formu/bildirim kanalları, müşteri CSV dışa/içe aktarma, kuyruk/geçmiş "Web" kaynak rozeti. Yalnız test.
// Çerez: u-p19<rol>-<oda>. p19adm ADMIN: customers.view/create/import/export (edit YOK), settings.edit,
// support_requests.view; p19noimp USER: customers.view/create (import YOK) → "İçe aktar" gizli.
// Ref'ler (a-z2-7, 16): webformaaaaaaaaa (normal), webformnoretenti (AC-292 satırı yok → düğme pasif),
// webformratelimit (ilk POST 429 RATE_LIMITED), webformtokenbadx (ilk POST 400 FORM_TOKEN_INVALID); diğerleri 404.
// Kancalar: GET /__e2e/p19/gets/<ref> → {gets, posts, last}; GET /__e2e/p19/accept/<ref>?admit=1 (bağlı sokete
// request.chat false + request.accepted); GET /__e2e/p19/techmsg/<ref>?body= (teknisyen mesajı).
import { WebSocketServer } from "ws";
import { webRequestInputSchema } from "@remote/contracts/api/requests";
import { SEND_FAILED_MESSAGES, SMS_API_KEY_REENTER, SMS_TEST_MESSAGES, smsSettingsInputSchema } from "@remote/contracts/api/notify";

const TENANT = { id: "01JTNP1900000000000000000A", name: "Demo Firma" };
const REFS = {
  webformaaaaaaaaa: { retention: 30 },
  webformnoretenti: { retention: 0 },
  webformratelimit: { retention: 30, firstFail: [429, "RATE_LIMITED", "Lütfen birkaç saniye sonra tekrar deneyin."] },
  webformtokenbadx: { retention: 30, firstFail: [400, "FORM_TOKEN_INVALID", "Formun süresi doldu, sayfayı yenileyin."] },
};
const state = new Map(); // ref → {gets, posts, last, tokens: Map(token → issuedAt), secret, sockets:Set}
const st = (ref) =>
  state.get(ref) ?? state.set(ref, { gets: 0, posts: 0, last: null, tokens: new Map(), secret: null, sockets: new Set() }).get(ref);
const iso = (ms) => new Date(ms).toISOString();
let seq = 0;

export function p19User(cookie) {
  const m = cookie?.match(/^u-(p19adm|p19noimp|p19tech|p19technl)-([a-z0-9]+)$/);
  if (!m) return null;
  const adm = m[1] === "p19adm";
  if (m[1] === "p19tech" || m[1] === "p19technl")
    return {
      room: m[2],
      user: {
        id: "01JMSP1900000000000000000C",
        email: "tech@ornek.com",
        fullName: "Mehmet Teknik",
        role: "USER",
        mustChangePassword: false,
      },
      permissions: ["sessions.view", "sessions.create", "sessions.delete", ...(m[1] === "p19tech" ? ["sessions.send_link"] : [])],
      tenant: TENANT,
      actingTenant: null,
    };
  return {
    room: m[2],
    user: {
      id: adm ? "01JMSP1900000000000000000A" : "01JMSP1900000000000000000B",
      email: adm ? "admin@ornek.com" : "user@ornek.com",
      fullName: adm ? "Selin Teknik" : "Can Usta",
      role: adm ? "ADMIN" : "USER",
      mustChangePassword: false,
    },
    permissions: adm
      ? [
          "customers.view",
          "customers.create",
          "customers.import",
          "customers.export",
          "settings.view",
          "settings.edit",
          "support_requests.view",
        ]
      : ["customers.view", "customers.create"],
    tenant: TENANT,
    actingTenant: null,
  };
}

const settings = new Map();
const smsStore = new Map();
const smsLog = [];
const smsInitial = () => ({
  url: null,
  defaultUrl: true,
  header: null,
  apiKeySet: true,
  keyUnreadable: true,
  insecure: false,
  usable: false,
  updatedAt: null,
});
const baseSettings = () => ({
  downloadUrl: "http://localhost:3217/api/v1/public/agent/request-download?ref=webformaaaaaaaaa",
  fileName: "NoktaDestek-Demo-webformaaaaaaaaa.exe",
  refPrefix: "webf",
  refRotatedAt: null,
  waitMinutes: 30,
  trustedCidrs: [],
  whatsapp: { enabled: false, recipients: [], serviceConfigured: true, insecure: false },
  email: { enabled: false, recipients: [], smtpConfigured: false },
  requireAcceptCode: false,
  defaultPriority: "NORMAL",
  defaultSlaMinutes: null,
  webFormEnabled: false,
  webFormUrl: "http://localhost:3217/r/webformaaaaaaaaa",
  notifySmsEnabled: true,
  notifyWhatsappEnabled: false,
  notifyEmailEnabled: false,
  channelWarnings: ["sms"],
});

const webItem = (o) => ({
  id: "01JRQP1900000000000000000A",
  requestCode: "246810",
  networkMatch: "NONE",
  knownDevice: false,
  status: "EXPIRED",
  cancelReason: null,
  createdAt: iso(Date.now() - 3_600_000),
  closedAt: iso(Date.now() - 1_800_000),
  waitSec: 1800,
  customerName: "Web Müşteri",
  customerPhone: "+905321112233",
  customerEmail: null,
  description: "Formdan geldi",
  clientVersion: null,
  source: "WEB",
  acceptedBy: null,
  rejectMessage: null,
  sessionId: null,
  customerFirm: null,
  viaBinding: false,
  bindingRevoked: false,
  staleSource: false,
  priority: "NORMAL",
  assignedTo: null,
  slaDueAt: null,
  slaBreached: false,
  afterHours: false,
  ...o,
});

const wss = new WebSocketServer({ noServer: true, handleProtocols: (p) => (p.has("rs.v1") ? "rs.v1" : false) });

/** /ws/panel (p19 kullanıcısı: bildirim soketi sessiz) ve /ws/request (sahte talep soketi). true → işlendi. */
export function p19Upgrade(req, sock, head, cookie, url, protos) {
  if (url.pathname === "/ws/panel") {
    if (!p19User(cookie)) return false;
    wss.handleUpgrade(req, sock, head, (ws) => {
      ws.on("message", () => ws.close(1008));
      ws.send(JSON.stringify({ t: "queue.count", pending: 0 }));
    });
    return true;
  }
  if (url.pathname !== "/ws/request") return false;
  const secret = protos.find((p) => p.startsWith("rs.req."))?.slice(7);
  const ref = [...state.entries()].find(([, s]) => s.secret && s.secret === secret)?.[0];
  if (!ref || !req.headers.origin || !protos.includes("rs.cap.chat1")) {
    sock.destroy();
    return true;
  }
  wss.handleUpgrade(req, sock, head, (ws) => {
    const s = st(ref);
    s.sockets.add(ws);
    ws.on("close", () => s.sockets.delete(ws));
    const now = Date.now();
    ws.send(
      JSON.stringify({
        t: "request.state",
        status: "PENDING",
        requestCode: "135790",
        position: 2,
        createdAt: iso(now),
        expiresAt: iso(now + 30 * 60_000),
        serverTime: iso(now),
      }),
    );
    ws.send(JSON.stringify({ t: "request.messages", items: [] }));
    ws.on("message", (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return ws.close(1008);
      }
      if (m.t === "request.message")
        ws.send(
          JSON.stringify({
            t: "request.message",
            id: `01JMSG${String(++seq).padStart(20, "0")}`,
            sender: "CUSTOMER",
            body: m.body,
            createdAt: iso(Date.now()),
            clientMsgId: m.clientMsgId,
          }),
        );
      else if (m.t === "request.decline" || m.t === "request.cancel") ws.close(1000);
    });
  });
  return true;
}

function hook(url, send, res) {
  const m = url.match(/^\/__e2e\/p19\/(gets|accept|techmsg)\/([a-z2-7]{16})(?:\?(.*))?$/);
  if (!m) return false;
  const s = st(m[2]);
  const q = new URLSearchParams(m[3] ?? "");
  if (m[1] === "gets") return (send(res, 200, { gets: s.gets, posts: s.posts, last: s.last }), true);
  const out =
    m[1] === "accept"
      ? [
          { t: "request.chat", enabled: false },
          {
            t: "request.accepted",
            wsTicket: "T".repeat(43),
            technicianName: "Selin Teknik",
            techVerifyCode: "4821",
            ticketExpiresAt: iso(Date.now() + 60_000),
            ...(q.get("admit") ? { admitCode: "7351" } : {}),
          },
        ]
      : [
          {
            t: "request.message",
            id: `01JMSG${String(++seq).padStart(20, "0")}`,
            sender: "TECH",
            senderName: "Selin Teknik",
            body: q.get("body") ?? "Merhaba",
            createdAt: iso(Date.now()),
          },
        ];
  for (const ws of s.sockets) for (const o of out) ws.send(JSON.stringify(o));
  send(res, 200, { sockets: s.sockets.size });
  return true;
}

async function readRaw(req) {
  let raw = "";
  for await (const c of req) raw += c;
  return raw;
}

export async function handleP19(req, res, { url, session, csrfOk, send, err, readJson }) {
  if (req.method === "GET" && hook(url, send, res)) return true;
  const path = url.split("?")[0];
  const q = new URLSearchParams(url.split("?")[1] ?? "");
  const ns = { "Cache-Control": "no-store" };

  // --- public: web talep formu ---
  if (path === "/api/v1/public/web-requests/form" && req.method === "GET") {
    const ref = q.get("ref") ?? "";
    const cfg = REFS[ref];
    if (!cfg) return (send(res, 404, err("REQUEST_REF_INVALID", "Bağlantı geçersiz.")), true);
    const s = st(ref);
    s.gets++;
    const token = `tok${ref}${s.gets}`.padEnd(24, "x");
    s.tokens.set(token, Date.now());
    const info = {
      tenant: { name: TENANT.name, logoUrl: null },
      consentText: { id: "01JC5ST0000000000000000001", version: 3, body: "Aydınlatma metni gövdesi.", sha256: "a".repeat(64) },
      chatRetentionDays: cfg.retention,
      channels: { sms: true, whatsapp: false, email: true },
      businessHours: { openNow: true, nextOpeningAt: null, afterHoursMode: "ACCEPT" },
      formToken: token,
      minDelayMs: 2000,
    };
    return (send(res, 200, info, [], ns), true);
  }
  if (path === "/api/v1/public/web-requests" && req.method === "POST") {
    if (!req.headers.origin) return (send(res, 403, err("CSRF_INVALID", "Köken doğrulanamadı.")), true);
    const body = await readJson(req);
    const ref = typeof body.ref === "string" ? body.ref : "";
    const cfg = REFS[ref];
    if (!cfg) return (send(res, 404, err("REQUEST_REF_INVALID", "Bağlantı geçersiz.")), true);
    const s = st(ref);
    s.posts++;
    s.last = body;
    const issued = s.tokens.get(body.formToken);
    s.tokens.delete(body.formToken);
    if (cfg.firstFail && s.posts === 1) {
      const [status, code, message] = cfg.firstFail;
      return (send(res, status, err(code, message, status === 429 ? { retryAfterSec: 2 } : {})), true);
    }
    if (issued === undefined) return (send(res, 400, err("FORM_TOKEN_INVALID", "Formun süresi doldu, sayfayı yenileyin.")), true);
    if (Date.now() - issued < 2000) return (send(res, 429, err("RATE_LIMITED", "Lütfen birkaç saniye sonra tekrar deneyin.")), true);
    const r = webRequestInputSchema.safeParse(body);
    if (!r.success) {
      const fields = Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
      return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields })), true);
    }
    s.secret = `S${ref}`.padEnd(43, "s");
    return (
      send(res, 201, {
        requestId: "01JRQP1900000000000000000B",
        requestSecret: s.secret,
        requestCode: "135790",
        expiresAt: iso(Date.now() + 1_800_000),
        position: 2,
      }),
      true
    );
  }
  if (path === "/api/v1/public/requests/cancel" && req.method === "POST") {
    const body = await readJson(req);
    for (const s of state.values()) if (s.secret && s.secret === body.requestSecret) for (const ws of s.sockets) ws.close(1000);
    return (send(res, 204, undefined), true);
  }

  // --- panel (p19 kullanıcıları) ---
  const who = p19User(session);
  if (!who) return false;
  // AC-260: bağlantı gönderimi (oturumların kendisi mock-sessions.mjs'de)
  const sl = path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})\/send-link(\/options)?$/);
  if (sl) {
    if (!who.permissions.includes("sessions.send_link")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    if (sl[2] && req.method === "GET") return (send(res, 200, { sms: true, whatsapp: true, suggestedPhone: null }, [], ns), true);
    if (!sl[2] && req.method === "POST") {
      if (!csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);
      const b = await readJson(req);
      if (b.phone === "+905320000429")
        return (send(res, 429, err("RATE_LIMITED", "Çok fazla gönderim.", { retryAfterSec: 3 }), [], { "Retry-After": "3" }), true);
      if (b.phone === "+905320000502")
        return (send(res, 502, err("UPSTREAM", SEND_FAILED_MESSAGES[b.channel] ?? "x", { fields: { reason: "unreachable" } })), true);
      if (b.phone === "+905320000409") return (send(res, 409, err("CHANNEL_UNAVAILABLE", "Bu kanal şu an kullanılamıyor.")), true);
      smsLog.push(b);
      return (send(res, 200, { sent: true }), true);
    }
  }
  if (req.method !== "GET" && !csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);
  const can = (p) => who.permissions.includes(p);
  const forbidden = () => (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);

  if (path === "/api/v1/settings/sms") {
    const cur = smsStore.get(who.room) ?? smsInitial();
    if (req.method === "GET") return (send(res, 200, cur, [], ns), true);
    if (req.method === "PUT") {
      if (!can("settings.edit")) return forbidden();
      const b = await readJson(req);
      const r = smsSettingsInputSchema.safeParse(b);
      if (!r.success) {
        const fields = Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
        return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields })), true);
      }
      if (r.data.url !== cur.url && cur.apiKeySet && (b.apiKey === undefined || b.apiKey === ""))
        return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { apiKey: SMS_API_KEY_REENTER } })), true);
      const keySet = b.apiKey === null ? false : b.apiKey ? true : cur.apiKeySet;
      const next = {
        ...cur,
        url: r.data.url,
        header: r.data.header,
        apiKeySet: keySet,
        keyUnreadable: b.apiKey ? false : b.apiKey === null ? false : cur.keyUnreadable,
        updatedAt: new Date().toISOString(),
      };
      next.usable = next.apiKeySet && !next.keyUnreadable && (next.url !== null || next.defaultUrl);
      smsStore.set(who.room, next);
      return (send(res, 200, next), true);
    }
  }
  if (path === "/api/v1/settings/sms/test" && req.method === "POST") {
    if (!can("settings.edit")) return forbidden();
    const b = await readJson(req);
    const cur = smsStore.get(who.room) ?? smsInitial();
    const ok = cur.usable && b.phone !== "+905320000502";
    return (
      send(res, 200, { ok, message: ok ? SMS_TEST_MESSAGES.ok : SMS_TEST_MESSAGES.unconfigured, reason: ok ? null : "unconfigured" }),
      true
    );
  }
  if (path === "/api/v1/support-requests/count") return (send(res, 200, { pending: 0 }), true);
  if (path === "/api/v1/support-requests" && req.method === "GET") {
    const src = q.get("source");
    const items = q.get("tab") === "history" && src !== "AGENT" ? [webItem({})] : [];
    return (send(res, 200, { items, page: 1, pageSize: 25, total: items.length }, [], ns), true);
  }
  if (path === "/api/v1/settings/support-requests") {
    if (!can("settings.edit")) return forbidden();
    const cur = settings.get(who.room) ?? baseSettings();
    if (req.method === "GET") return (send(res, 200, cur, [], ns), true);
    if (req.method === "PUT") {
      const b = await readJson(req);
      const next = {
        ...cur,
        webFormEnabled: b.webFormEnabled ?? cur.webFormEnabled,
        notifySmsEnabled: b.notifySmsEnabled ?? cur.notifySmsEnabled,
        notifyWhatsappEnabled: b.notifyWhatsappEnabled ?? cur.notifyWhatsappEnabled,
        notifyEmailEnabled: b.notifyEmailEnabled ?? cur.notifyEmailEnabled,
      };
      next.channelWarnings = [next.notifySmsEnabled && "sms", next.notifyEmailEnabled && "email"].filter(Boolean);
      settings.set(who.room, next);
      return (send(res, 200, next), true);
    }
  }
  if (path === "/api/v1/customers" && req.method === "GET") {
    if (!can("customers.view")) return forbidden();
    return (send(res, 200, { items: [], page: 1, pageSize: 25, total: 0 }, [], ns), true);
  }
  if (path === "/api/v1/customers/general-link" && req.method === "GET")
    return (send(res, 200, { downloadUrl: baseSettings().downloadUrl, fileName: baseSettings().fileName }, [], ns), true);
  if (path === "/api/v1/customers/export.csv" && req.method === "GET") {
    if (!can("customers.export")) return forbidden();
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="musteriler-20261115.csv"`,
      "Cache-Control": "no-store",
    });
    res.end(`﻿Ad;Yetkili kişi;Telefon;E-posta;Not;Dosya etiketi;Varsayılan öncelik;SLA (dk);Durum\r\nAcme;;;;;;Normal;;Aktif\r\n`);
    return true;
  }
  if (path === "/api/v1/customers/import/preview" && req.method === "POST") {
    if (!["customers.import", "customers.create", "customers.view"].every(can)) return forbidden();
    const raw = await readRaw(req);
    if (raw.includes("BOZUK"))
      return (
        send(
          res,
          400,
          err("VALIDATION", "Doğrulama hatası", { fields: { file: "“Ad” sütunu bulunamadı. İlk satır sütun başlıklarını içermeli." } }),
        ),
        true
      );
    return (
      send(res, 200, {
        previewId: "P".repeat(22),
        total: 4,
        counts: { create: 2, conflict: 1, error: 1 },
        rows: [
          { line: 2, kind: "create", name: "Yeni A", contactName: "Ali", phone: "+905321112233", email: null },
          { line: 3, kind: "create", name: "Yeni B", contactName: null, phone: null, email: "b@ornek.com" },
          { line: 4, kind: "conflict", name: "Acme", contactName: null, phone: null, email: null },
          { line: 5, kind: "error", name: "=KÖTÜ", contactName: null, phone: "12", email: null },
        ],
        errors: [{ line: 5, column: "Telefon", message: "Telefon numarası geçersiz" }],
        errorsTruncated: false,
        warnings: ["“Bilinmeyen” sütunu yok sayıldı."],
      }),
      true
    );
  }
  if (path === "/api/v1/customers/import/commit" && req.method === "POST") {
    const b = await readJson(req);
    if (b.onConflict === "update" && !can("customers.edit")) return forbidden();
    return (send(res, 200, { total: 4, created: 2, updated: 0, skipped: 1, failed: 1 }), true);
  }
  return false;
}
