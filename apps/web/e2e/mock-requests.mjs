// E2E sahte API — destek talepleri (P8b-1; mimari-api "Destek talepleri (P8b)", mimari-protokol §5.3). Yalnız test.
// Çerez: u-rq<senaryo>-<rastgele>. Senaryolar: rqadm (ADMIN, tüm yetkiler), rqro (USER, yalnız view),
// rqsa (SUPER_ADMIN, firma seçmemiş), rqempty (bekleyen yok), rqbroken (liste 500).
// Test kancası: GET /__e2e/rq/<olay>/<çerez>[?id=] → o kullanıcının /ws/panel soketlerine olay iter
// (newfirm: müşteri firmalı request.new — AC-176).
// GET /__e2e/rq/sockets/<çerez> → { open } açık soket sayısı (olay öncesi senkron noktası, QA-P8b-12).
import { WebSocketServer } from "ws";
import {
  emailTestInputSchema,
  rejectMessageSchema,
  updateRequestSettingsInputSchema,
  whatsappTestInputSchema,
} from "@remote/contracts/api/requests";
import { SMTP_SEND_FAILED_MESSAGE } from "@remote/contracts/api/tenants";
import { REQUEST_BLOCK_NO_SOURCE_MESSAGE, createRequestBlockInputSchema } from "@remote/contracts/api/request-blocks";

const ADMIN_P = [
  "sessions.view",
  "sessions.create",
  "session_history.view",
  "support_requests.view",
  "support_requests.accept",
  "settings.view",
  "settings.edit",
];
const TENANT = { id: "01JTENA0000000000000000001", name: "Demo Firma" };
const now = () => Date.now();
const iso = (ms) => new Date(ms).toISOString();
export const RQ = {
  A: "01JRQ00000000000000000000A",
  B: "01JRQ00000000000000000000B",
  C: "01JRQ00000000000000000000C",
  NEW: "01JRQ0000000000000000000NW",
  NEWFIRM: "01JRQ0000000000000000000NF",
};
export const RQ_SESSION = "01JRQSES000000000000000001";

export function requestUser(cookie) {
  const m = cookie?.match(/^u-(rqadm|rqblk|rqmail|rqro|rqsa|rqempty|rqbroken|rqcu|rqcuro|rqcuempty|rqcubroken|rqcuslow)-/);
  if (!m) return null;
  const role = m[1] === "rqsa" ? "SUPER_ADMIN" : m[1] === "rqro" ? "USER" : "ADMIN";
  return {
    user: { id: "01JUSRQ0000000000000000001", email: "rq@ornek.com", fullName: "Selin Teknik", role, mustChangePassword: false },
    // P8c: rqcu = ADMIN + customers.*; rqcuro = USER yalnız customers.view (+ talepler, geçmiş yok).
    // rqcuempty / rqcubroken / rqcuslow: rqcu yetkileri, müşteri durum senaryoları (mock-customers.mjs)
    permissions:
      m[1] === "rqro"
        ? ["sessions.view", "support_requests.view"]
        : /^rqcu(empty|broken|slow)?$/.test(m[1])
          ? [...ADMIN_P, "customers.view", "customers.create", "customers.edit", "customers.delete"]
          : m[1] === "rqcuro"
            ? ["sessions.view", "sessions.create", "support_requests.view", "customers.view"]
            : m[1] === "rqblk"
              ? [...ADMIN_P, "support_requests.block"] // P15 (AC-235) kısayolu
              : ADMIN_P,
    tenant: role === "SUPER_ADMIN" ? null : TENANT,
    actingTenant: null,
    kind: m[1],
  };
}

const item = (o) => ({
  status: "PENDING",
  cancelReason: null,
  closedAt: null,
  customerEmail: null,
  clientVersion: "0.9.0",
  acceptedBy: null,
  rejectMessage: null,
  sessionId: null,
  knownDevice: false,
  customerFirm: null,
  viaBinding: false,
  bindingRevoked: false,
  staleSource: false,
  // P18 (AC-256..258): sunucu her öğede gönderir
  priority: "NORMAL",
  assignedTo: null,
  slaDueAt: null,
  slaBreached: false,
  afterHours: false,
  ...o,
});

function seed(kind) {
  if (kind === "rqempty") return { pending: [], history: [] };
  const t0 = now();
  return {
    pending: [
      item({
        id: RQ.A,
        requestCode: "123456",
        networkMatch: "NONE",
        createdAt: iso(t0 - 9 * 60_000),
        waitSec: 540,
        customerName: "Ayşe Yılmaz",
        customerPhone: "+905321112233",
        customerEmail: "ayse@ornek.com",
        description: "Yazıcı çalışmıyor, bkz. https://kotu.example/x <b>kalın</b>",
      }),
      item({
        id: RQ.B,
        requestCode: "654321",
        networkMatch: "TRUSTED",
        knownDevice: true,
        createdAt: iso(t0 - 4 * 60_000),
        waitSec: 240,
        customerName: "Ali Demir",
        customerPhone: "+905301112233",
        description: "Muhasebe programı açılmıyor",
      }),
      item({
        id: RQ.C,
        requestCode: "111222",
        networkMatch: "PREFIX",
        createdAt: iso(t0 - 60_000),
        waitSec: 60,
        customerName: "Can Öz",
        customerPhone: "+905051112233",
        description: "E-posta gönderilemiyor",
      }),
    ],
    history: [
      item({
        id: "01JRQH0000000000000000000A",
        requestCode: "222333",
        networkMatch: "IP",
        status: "ACCEPTED",
        createdAt: iso(t0 - 86_400_000),
        closedAt: iso(t0 - 86_000_000),
        waitSec: 400,
        customerName: "Fatma Şahin",
        customerPhone: "+905441112233",
        description: "Ekran donuyor",
        acceptedBy: { id: "01JUSRQ0000000000000000001", name: "Selin Teknik" },
        sessionId: "01JHXST0000000000000000000",
      }),
      item({
        id: "01JRQH0000000000000000000B",
        requestCode: "444555",
        networkMatch: "NONE",
        status: "REJECTED",
        createdAt: iso(t0 - 2 * 86_400_000),
        closedAt: iso(t0 - 2 * 86_400_000 + 300_000),
        waitSec: 300,
        customerName: "Mert Kara",
        customerPhone: "+905441112244",
        description: "Program kurulumu",
        rejectMessage: "Mesai saatleri dışındayız, sizi arayacağız",
      }),
      item({
        id: "01JRQH0000000000000000000C",
        requestCode: "666777",
        networkMatch: "NONE",
        status: "CANCELLED",
        cancelReason: "CUSTOMER",
        createdAt: iso(t0 - 3 * 86_400_000),
        closedAt: iso(t0 - 3 * 86_400_000 + 60_000),
        waitSec: 60,
        customerName: null,
        customerPhone: null,
        description: null,
      }),
    ],
  };
}

const settingsSeed = (kind) => ({
  downloadUrl: "http://localhost:3217/api/v1/public/agent/request-download?ref=abcdefghijklmnop",
  fileName: "NoktaDestek-DemoFirma-abcdefghijklmnop.exe",
  refPrefix: "abcd",
  refRotatedAt: null,
  waitMinutes: 30,
  trustedCidrs: ["203.0.113.0/24"],
  whatsapp: { enabled: false, recipients: [], serviceConfigured: true, insecure: false },
  // P10: rqmail = SMTP ayarlı firma (AC-151)
  email: { enabled: false, recipients: [], smtpConfigured: kind === "rqmail" },
  requireAcceptCode: false,
  defaultPriority: "NORMAL",
  defaultSlaMinutes: null,
});

const stores = new Map();
export const store = (cookie, kind) =>
  stores.get(cookie) ?? stores.set(cookie, { ...seed(kind), settings: settingsSeed(kind) }).get(cookie);
const sockets = new Map(); // çerez → Set<ws>
const pushTo = (cookie, m) => {
  for (const ws of sockets.get(cookie) ?? []) if (ws.readyState === 1) ws.send(JSON.stringify(m));
};
const count = (cookie) => pushTo(cookie, { t: "queue.count", pending: stores.get(cookie)?.pending.length ?? 0 });

const wss = new WebSocketServer({ noServer: true });

/** /ws/panel upgrade: çerez + view yetkisi + tenant bağlamı; aksi 403 (soket yok edilir). */
// P14a (AC-216): oturum başına upgrade sayısı ve sıradaki n upgrade'i 4429 `retry=1` ile kapatma kancası
const upgrades = new Map();
const limitNext = new Map();

export function panelUpgrade(req, sock, head, session) {
  const who = requestUser(session);
  // P9 (mock-users.mjs): u-us* kullanıcıları da support_requests.view taşır → bildirim soketi açık kalır, olay itilmez
  if (!who && /^u-us(adm|empty|broken|slow|sa)-/.test(session ?? "") && !new URL(req.url ?? "/", "http://m").search) {
    return wss.handleUpgrade(req, sock, head, (ws) => ws.on("message", () => ws.close(1008)));
  }
  if (!who || who.user.role === "SUPER_ADMIN" || new URL(req.url ?? "/", "http://m").search) {
    sock.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    return sock.destroy();
  }
  wss.handleUpgrade(req, sock, head, (ws) => {
    upgrades.set(session, (upgrades.get(session) ?? 0) + 1);
    const lim = limitNext.get(session) ?? 0;
    if (lim > 0) {
      // Sunucu gibi: upgrade kabul + hemen 4429 (tarayıcı WS el sıkışma başlığını okuyamaz)
      limitNext.set(session, lim - 1);
      return ws.close(4429, "retry=1");
    }
    store(session, who.kind);
    const set = sockets.get(session) ?? sockets.set(session, new Set()).get(session);
    set.add(ws);
    ws.on("close", () => set.delete(ws));
    ws.on("message", () => ws.close(1008));
    count(session);
  });
}

function e2eHook(url, send, res) {
  // QA-P8b-12: senkron noktası — o çerezin AÇIK /ws/panel soket sayısı (olay itmeden önce testte beklenir)
  const sk = url.match(/^\/__e2e\/rq\/sockets\/([^?]+)$/);
  if (sk) return (send(res, 200, { open: [...(sockets.get(sk[1]) ?? [])].filter((ws) => ws.readyState === 1).length }), true);
  const up = url.match(/^\/__e2e\/rq\/upgrades\/([^?]+)$/);
  if (up) return (send(res, 200, { upgrades: upgrades.get(up[1]) ?? 0 }), true);
  const lim = url.match(/^\/__e2e\/rq\/limit4429\/([^?]+)\?n=(\d+)$/);
  if (lim) return (limitNext.set(lim[1], Number(lim[2])), send(res, 200, {}), true);
  const m = url.match(/^\/__e2e\/rq\/(new|newfirm|removed|alert|declined|close4401)\/([^?]+)(?:\?id=([0-9A-Z]{26}))?$/);
  if (!m) return false;
  const [, ev, cookie, id] = m;
  const s = stores.get(cookie);
  if (!s) return (send(res, 404, {}), true);
  if (ev === "new") {
    const it = item({
      id: RQ.NEW,
      requestCode: "777888",
      networkMatch: "NONE",
      createdAt: iso(now()),
      waitSec: 0,
      customerName: "Yeni Müşteri",
      customerPhone: "+905551112233",
      description: "Bilgisayar çok yavaş",
    });
    s.pending.push(it);
    pushTo(cookie, {
      t: "request.new",
      id: it.id,
      requestCode: it.requestCode,
      customerName: it.customerName,
      preview: it.description,
      networkMatch: "NONE",
      knownDevice: false,
      createdAt: it.createdAt,
      customerFirm: null,
      viaBinding: false,
      bindingRevoked: false,
      staleSource: false,
    });
    count(cookie);
  } else if (ev === "newfirm") {
    // AC-176: müşteri ref'iyle açılmış talep — toast'ta firma adı
    const firm = { id: "01JC5ST0000000000000000001", name: "Şişli Bilişim Ltd.", status: "ACTIVE" };
    const it = item({
      id: RQ.NEWFIRM,
      requestCode: "999000",
      networkMatch: "NONE",
      createdAt: iso(now()),
      waitSec: 0,
      customerName: "Firma Müşterisi",
      customerPhone: "+905551112244",
      description: "Sunucuya erişilemiyor",
      customerFirm: firm,
    });
    s.pending.push(it);
    pushTo(cookie, {
      t: "request.new",
      id: it.id,
      requestCode: it.requestCode,
      customerName: it.customerName,
      preview: it.description,
      networkMatch: "NONE",
      knownDevice: false,
      createdAt: it.createdAt,
      customerFirm: { id: firm.id, name: firm.name }, // ws-request: strictObject {id,name}
      viaBinding: false,
      bindingRevoked: false,
      staleSource: false,
    });
    count(cookie);
  } else if (ev === "removed") {
    s.pending = s.pending.filter((x) => x.id !== id);
    pushTo(cookie, { t: "request.removed", id, status: "ACCEPTED" });
    count(cookie);
  } else if (ev === "alert") pushTo(cookie, { t: "queue.alert", kind: "rate_limited", until: iso(now() + 15 * 60_000) });
  else if (ev === "declined") pushTo(cookie, { t: "request.declined", id: id ?? RQ.A, sessionId: RQ_SESSION });
  else if (ev === "close4401") for (const ws of sockets.get(cookie) ?? []) ws.close(4401);
  send(res, 200, {});
  return true;
}

const fieldsOf = (error) => Object.fromEntries(error.issues.map((i) => [i.path.join("."), i.message]));

/** true → istek işlendi. */
export async function handleRequests(req, res, { url, session, csrfOk, send, err, readJson }) {
  if (req.method === "GET" && e2eHook(url, send, res)) return true;
  const who = requestUser(session);
  if (!who) return false;
  const path = url.split("?")[0];
  const q = new URLSearchParams(url.split("?")[1] ?? "");
  const s = store(session, who.kind);
  const can = (p) => who.permissions.includes(p);
  const write = req.method !== "GET";
  if (write && !csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);

  if (path === "/api/v1/support-requests/count" && req.method === "GET") return (send(res, 200, { pending: s.pending.length }), true);
  if (path === "/api/v1/support-requests" && req.method === "GET") {
    if (!can("support_requests.view")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    if (who.kind === "rqbroken") return (send(res, 500, err("INTERNAL", "Sunucu hatası.")), true);
    const cf = q.get("customer");
    const byFirm = (x) => !cf || (cf === "general" ? x.customerFirm === null : x.customerFirm?.id === cf);
    if (q.get("tab") === "history") {
      const items = s.history.filter((x) => (!q.get("status") || x.status === q.get("status")) && byFirm(x));
      return (send(res, 200, { items, page: 1, pageSize: 25, total: items.length }, [], { "Cache-Control": "no-store" }), true);
    }
    const pend = s.pending.filter(byFirm);
    return (send(res, 200, { items: pend, page: 1, pageSize: 50, total: pend.length }, [], { "Cache-Control": "no-store" }), true);
  }
  const am = path.match(/^\/api\/v1\/support-requests\/([0-9A-Z]{26})\/(accept|reject)$/);
  if (am && req.method === "POST") {
    if (!can("support_requests.accept")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    const it = s.pending.find((x) => x.id === am[1]);
    if (!it) return (send(res, 409, err("REQUEST_CLOSED", "Talep kapandı.")), true);
    if (am[2] === "accept") {
      if (it.id === RQ.B) return (send(res, 409, err("REQUEST_TAKEN", "Talep başka bir teknisyen tarafından alındı")), true);
      s.pending = s.pending.filter((x) => x.id !== it.id);
      count(session);
      return (send(res, 200, { sessionId: RQ_SESSION, consoleUrl: `/sessions/${RQ_SESSION}/console` }), true);
    }
    const body = await readJson(req);
    const parsed = rejectMessageSchema.safeParse(body.message);
    if (!parsed.success)
      return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { message: parsed.error.issues[0]?.message } })), true);
    s.pending = s.pending.filter((x) => x.id !== it.id);
    s.history.unshift({ ...it, status: "REJECTED", rejectMessage: parsed.data, closedAt: iso(now()) });
    count(session);
    return (send(res, 204, undefined), true);
  }

  // P15 (AC-235): "Bu kaynağı engelle" — B talebinin cihaz anahtarı yok (kaynak yok mesajı)
  if (path === "/api/v1/request-blocks" && req.method === "POST") {
    if (!can("support_requests.block")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    const parsed = createRequestBlockInputSchema.safeParse(await readJson(req));
    if (!parsed.success || parsed.data.source !== "REQUEST")
      return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: parsed.success ? {} : fieldsOf(parsed.error) })), true);
    if (parsed.data.target === "DEVICE" && parsed.data.requestId === RQ.B)
      return (send(res, 409, err("CONFLICT", REQUEST_BLOCK_NO_SOURCE_MESSAGE)), true);
    (s.blocks ??= []).push(parsed.data);
    return (send(res, 201, { id: "01JBLKRQ000000000000000001" }), true);
  }

  if (path.startsWith("/api/v1/settings/support-requests")) {
    if (!can("settings.edit")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    if (path === "/api/v1/settings/support-requests" && req.method === "GET") return (send(res, 200, s.settings), true);
    if (path === "/api/v1/settings/support-requests" && req.method === "PUT") {
      const parsed = updateRequestSettingsInputSchema.safeParse(await readJson(req));
      if (!parsed.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(parsed.error) })), true);
      if (parsed.data.waitMinutes === 99)
        return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { waitMinutes: "Sunucu bu süreyi reddetti" } })), true);
      Object.assign(s.settings, {
        waitMinutes: parsed.data.waitMinutes,
        trustedCidrs: parsed.data.trustedCidrs,
        whatsapp: { ...s.settings.whatsapp, ...parsed.data.whatsapp },
        email: { ...s.settings.email, ...parsed.data.email },
        ...(parsed.data.requireAcceptCode !== undefined ? { requireAcceptCode: parsed.data.requireAcceptCode } : {}),
        ...(parsed.data.defaultPriority !== undefined ? { defaultPriority: parsed.data.defaultPriority } : {}),
        ...(parsed.data.defaultSlaMinutes !== undefined ? { defaultSlaMinutes: parsed.data.defaultSlaMinutes } : {}),
      });
      return (send(res, 200, s.settings), true);
    }
    if (path === "/api/v1/settings/support-requests/rotate-ref" && req.method === "POST") {
      Object.assign(s.settings, {
        downloadUrl: s.settings.downloadUrl.replace(/ref=.*/, "ref=zyxwvutsrqponmlk"),
        fileName: "NoktaDestek-DemoFirma-zyxwvutsrqponmlk.exe",
        refPrefix: "zyxw",
        refRotatedAt: iso(now()),
      });
      return (send(res, 200, s.settings), true);
    }
    if (path === "/api/v1/settings/support-requests/whatsapp/test" && req.method === "POST") {
      const parsed = whatsappTestInputSchema.safeParse(await readJson(req));
      if (!parsed.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(parsed.error) })), true);
      if (parsed.data.phone === "+905009999999") return (send(res, 502, err("UPSTREAM", "WhatsApp servisine ulaşılamadı.")), true);
      return (send(res, 200, { ok: true, message: "Test mesajı gönderildi." }), true);
    }
    if (path === "/api/v1/settings/support-requests/email/test" && req.method === "POST") {
      const parsed = emailTestInputSchema.safeParse(await readJson(req));
      if (!parsed.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(parsed.error) })), true);
      if (!s.settings.email.smtpConfigured) return (send(res, 502, err("UPSTREAM", "Önce SMTP ayarlarını yapın")), true);
      if (parsed.data.to === "fail@ornek.com") return (send(res, 200, { ok: false, message: SMTP_SEND_FAILED_MESSAGE }), true);
      return (send(res, 200, { ok: true, message: "Test maili gönderildi." }), true);
    }
  }
  return false;
}
