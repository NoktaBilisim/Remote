// E2E sahte API — P18 H4 (AC-255..258): kuyruk önceliği/atama/SLA, kabul öncesi mesajlaşma (H3 uçları §8b.5 şekliyle),
// mesai saatleri + tatiller. Yalnız test. Çerez: u-p18<rol>-<oda>; aynı <oda> = aynı firma verisi (iki tarayıcı testi).
//   p18adm  ADMIN "Selin Teknik": view, accept, assign, message, settings.view/edit
//   p18usr  USER  "Can Usta": view, accept (assign/message YOK; ayarlar salt okunur: settings.view)
// Kuyruk (oda başına): A Ayşe (NORMAL, SLA ≈ +65 sn), B Ali (NORMAL, mesai dışı), C Deniz (LOW, Can Usta'ya atanmış,
// müşteri programı mesajlaşmayı desteklemiyor), D Hata (LOW, mesaj ucu 500).
// Kancalar: GET /__e2e/p18/sockets/<çerez> → {open}; /__e2e/p18/custmsg/<oda>?id= (müşteri mesajı + request.activity);
// /__e2e/p18/assign/<oda>?id=&to= (başka yöneticinin ataması → request.updated); /__e2e/p18/remove/<oda>?id=.
import { WebSocketServer } from "ws";
import {
  assignRequestInputSchema,
  businessHoursSchema,
  compareQueue,
  holidayInputSchema,
  HOLIDAY_DAY_CONFLICT_MESSAGE,
  importTrHolidaysInputSchema,
  priorityInputSchema,
  slaBreachedAt,
  ASSIGNEE_INVALID_MESSAGE,
  sendRequestMessageInputSchema,
} from "@remote/contracts/api/requests";
import { TR_HOLIDAYS } from "@remote/contracts/holidays-tr";

const TENANT = { id: "01JTNP1800000000000000000A", name: "Demo Firma" };
export const P18 = {
  ME: "01JMSP1800000000000000000A",
  CAN: "01JMSP1800000000000000000B",
  ECE: "01JMSP1800000000000000000C",
  A: "01JRQP1800000000000000000A",
  B: "01JRQP1800000000000000000B",
  C: "01JRQP1800000000000000000C",
  D: "01JRQP1800000000000000000D",
};
const SESSION = "01JRQSES180000000000000001";
const USERS = [
  { id: P18.CAN, fullName: "Can Usta", status: "ACTIVE" },
  { id: P18.ECE, fullName: "Ece Yıldız", status: "ACTIVE" },
  { id: P18.ME, fullName: "Selin Teknik", status: "ACTIVE" },
];
const iso = (ms) => new Date(ms).toISOString();
let idSeq = 0;
const newId = () => `01JMSG${String(++idSeq).padStart(20, "0")}`;

export function p18User(cookie) {
  const m = cookie?.match(/^u-(p18adm|p18usr)-([a-z0-9]+)$/);
  if (!m) return null;
  const adm = m[1] === "p18adm";
  return {
    kind: m[1],
    room: m[2],
    user: {
      id: adm ? P18.ME : P18.CAN,
      email: adm ? "selin@ornek.com" : "can@ornek.com",
      fullName: adm ? "Selin Teknik" : "Can Usta",
      role: adm ? "ADMIN" : "USER",
      mustChangePassword: false,
    },
    permissions: adm
      ? [
          "sessions.view",
          "support_requests.view",
          "support_requests.accept",
          "support_requests.assign",
          "support_requests.message",
          "settings.view",
          "settings.edit",
        ]
      : ["sessions.view", "support_requests.view", "support_requests.accept", "settings.view"],
    tenant: TENANT,
    actingTenant: null,
  };
}

const base = (o) => ({
  status: "PENDING",
  cancelReason: null,
  closedAt: null,
  customerEmail: null,
  clientVersion: "0.12.0",
  acceptedBy: null,
  rejectMessage: null,
  sessionId: null,
  knownDevice: false,
  networkMatch: "NONE",
  customerFirm: null,
  viaBinding: false,
  bindingRevoked: false,
  staleSource: false,
  priority: "NORMAL",
  assignedTo: null,
  slaDueAt: null,
  afterHours: false,
  ...o,
});

const rooms = new Map();
function room(name) {
  let r = rooms.get(name);
  if (r) return r;
  const t0 = Date.now();
  r = {
    pending: [
      base({
        id: P18.A,
        requestCode: "123456",
        createdAt: iso(t0 - 9 * 60_000),
        customerName: "Ayşe Yılmaz",
        customerPhone: "+905321112233",
        description: "Yazıcı çalışmıyor",
        slaDueAt: iso(t0 + 65_000),
      }),
      base({
        id: P18.B,
        requestCode: "654321",
        createdAt: iso(t0 - 4 * 60_000),
        customerName: "Ali Demir",
        customerPhone: "+905301112233",
        description: "Muhasebe programı açılmıyor",
        afterHours: true,
      }),
      base({
        id: P18.C,
        requestCode: "111222",
        createdAt: iso(t0 - 2 * 60_000),
        customerName: "Deniz Kaya",
        customerPhone: "+905051112233",
        description: "E-posta gönderilemiyor",
        priority: "LOW",
        assignedTo: { id: P18.CAN, name: "Can Usta" },
        clientVersion: "0.11.0",
      }),
      base({
        id: P18.D,
        requestCode: "333444",
        createdAt: iso(t0 - 60_000),
        customerName: "Hata Testi",
        customerPhone: "+905051112244",
        description: "Ağ sorunu",
        priority: "LOW",
      }),
    ],
    messages: new Map([
      [
        P18.A,
        [
          {
            id: newId(),
            sender: "CUSTOMER",
            senderName: null,
            body: "Merhaba <b>acil</b> https://kotu.example/x",
            createdAt: iso(t0 - 60_000),
          },
          // H3: çözülemeyen gövde → null ("Mesaj okunamadı")
          { id: newId(), sender: "CUSTOMER", senderName: null, body: null, createdAt: iso(t0 - 50_000) },
        ],
      ],
      [P18.B, []],
      [P18.C, []],
    ]),
    hours: {
      enabled: true,
      timeZone: "Europe/Istanbul",
      afterHoursMode: "ACCEPT",
      week: [[{ from: "09:00", to: "18:00" }], [{ from: "09:00", to: "18:00" }], [], [], [], [], []],
    },
    holidays: [{ id: "01JHDY0000000000000000000A", day: "2026-04-23", name: "Ulusal Egemenlik ve Çocuk Bayramı", openUntil: null }],
    sockets: new Set(),
  };
  rooms.set(name, r);
  return r;
}

const view = (it) => ({
  ...it,
  waitSec: Math.floor((Date.now() - Date.parse(it.createdAt)) / 1000),
  slaBreached: slaBreachedAt(it, Date.now()),
});
const push = (r, m) => {
  for (const s of r.sockets) if (s.ws.readyState === 1) s.ws.send(JSON.stringify(m));
};
const updated = (r, it) =>
  push(r, { t: "request.updated", id: it.id, priority: it.priority, assignedTo: it.assignedTo, slaDueAt: it.slaDueAt });

const wss = new WebSocketServer({ noServer: true });
/** /ws/panel upgrade (mock-ws.mjs yönlendirir). true → işlendi. */
export function p18PanelUpgrade(req, sock, head, cookie) {
  const who = p18User(cookie);
  if (!who) return false;
  wss.handleUpgrade(req, sock, head, (ws) => {
    const r = room(who.room);
    const s = { ws, cookie };
    r.sockets.add(s);
    ws.on("close", () => r.sockets.delete(s));
    ws.on("message", () => ws.close(1008));
    ws.send(JSON.stringify({ t: "queue.count", pending: r.pending.length }));
  });
  return true;
}

// Sabit saat (önizleme): mock "şu an" kapalı + sonraki açılış
const hoursView = (h) => ({ ...h, openNow: !h.enabled, nextOpeningAt: h.enabled ? "2026-11-16T06:00:00.000Z" : null });

function hook(url, send, res) {
  const sk = url.match(/^\/__e2e\/p18\/sockets\/([^?]+)$/);
  if (sk) {
    const who = p18User(sk[1]);
    const n = who ? [...room(who.room).sockets].filter((s) => s.cookie === sk[1] && s.ws.readyState === 1).length : 0;
    return (send(res, 200, { open: n }), true);
  }
  const m = url.match(/^\/__e2e\/p18\/(custmsg|assign|remove)\/([a-z0-9]+)\?(.*)$/);
  if (!m) return false;
  const r = room(m[2]);
  const q = new URLSearchParams(m[3]);
  const it = r.pending.find((x) => x.id === q.get("id"));
  if (!it) return (send(res, 404, {}), true);
  if (m[1] === "custmsg") {
    const at = iso(Date.now());
    (r.messages.get(it.id) ?? r.messages.set(it.id, []).get(it.id)).push({
      id: newId(),
      sender: "CUSTOMER",
      senderName: null,
      body: q.get("body") ?? "Bekliyorum",
      createdAt: at,
    });
    push(r, { t: "request.activity", id: it.id, kind: "message", sender: "CUSTOMER", at });
  } else if (m[1] === "assign") {
    const u = USERS.find((x) => x.id === q.get("to"));
    it.assignedTo = u ? { id: u.id, name: u.fullName } : null;
    updated(r, it);
  } else {
    r.pending = r.pending.filter((x) => x.id !== it.id);
    push(r, { t: "request.removed", id: it.id, status: "CANCELLED" });
  }
  send(res, 200, {});
  return true;
}

const fieldsOf = (error) => Object.fromEntries(error.issues.map((i) => [i.path.join("."), i.message]));

export async function handleP18(req, res, { url, session, csrfOk, send, err, readJson }) {
  if (req.method === "GET" && hook(url, send, res)) return true;
  const who = p18User(session);
  if (!who) return false;
  const r = room(who.room);
  const path = url.split("?")[0];
  const q = new URLSearchParams(url.split("?")[1] ?? "");
  const can = (p) => who.permissions.includes(p);
  const forbidden = () => (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
  if (req.method !== "GET" && !csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);
  const ns = { "Cache-Control": "no-store" };

  if (path === "/api/v1/support-requests/count") return (send(res, 200, { pending: r.pending.length }), true);
  if (path === "/api/v1/support-requests" && req.method === "GET") {
    if (q.get("tab") === "history") return (send(res, 200, { items: [], page: 1, pageSize: 25, total: 0 }, [], ns), true);
    const a = q.get("assigned");
    const items = r.pending
      .filter((x) => (a === "me" ? x.assignedTo?.id === who.user.id : a === "none" ? x.assignedTo === null : true))
      .sort(compareQueue)
      .map(view);
    return (send(res, 200, { items, page: 1, pageSize: 50, total: items.length }, [], ns), true);
  }
  if (path === "/api/v1/users/options" && req.method === "GET")
    return (send(res, 200, { items: q.get("assignable") === "1" ? USERS : [] }, [], ns), true);

  const am = path.match(/^\/api\/v1\/support-requests\/([0-9A-Z]{26})\/(accept|assign|priority|messages)$/);
  if (am) {
    const it = r.pending.find((x) => x.id === am[1]);
    const action = am[2];
    if (action === "messages") {
      if (am[1] === P18.D) return (send(res, 500, err("INTERNAL", "Sunucu hatası.")), true);
      if (!it) return (send(res, 409, err("REQUEST_CLOSED", "Talep kapandı.")), true);
      const chat = it.clientVersion < "0.12.0" ? "UNSUPPORTED" : "SUPPORTED";
      const list = r.messages.get(it.id) ?? [];
      if (req.method === "GET") {
        const after = q.get("after");
        const i = after ? list.findIndex((x) => x.id === after) : -1;
        return (send(res, 200, { items: list.slice(i + 1), customerChat: chat }, [], ns), true);
      }
      if (!can("support_requests.message")) return forbidden();
      const p = sendRequestMessageInputSchema.safeParse(await readJson(req));
      if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
      const text = p.data.body;
      if (chat === "UNSUPPORTED") return (send(res, 409, err("CHAT_UNSUPPORTED", "Müşterinin programı mesajlaşmayı desteklemiyor.")), true);
      if (text === "hızlı") return (send(res, 429, err("RATE_LIMITED", "Çok hızlı.")), true);
      const msg = { id: newId(), sender: "TECH", senderName: who.user.fullName, body: text, createdAt: iso(Date.now()) };
      list.push(msg);
      r.messages.set(it.id, list);
      return (send(res, 201, { id: msg.id, createdAt: msg.createdAt }), true);
    }
    if (!it) return (send(res, 409, err("REQUEST_CLOSED", "Talep kapandı.")), true);
    if (action === "accept") {
      if (!can("support_requests.accept")) return forbidden();
      r.pending = r.pending.filter((x) => x.id !== it.id);
      push(r, { t: "request.removed", id: it.id, status: "ACCEPTED" });
      return (send(res, 200, { sessionId: SESSION, consoleUrl: `/sessions/${SESSION}/console` }), true);
    }
    if (!can("support_requests.assign")) return forbidden();
    const raw = await readJson(req);
    if (action === "assign") {
      const p = assignRequestInputSchema.safeParse(raw);
      if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
      const u = p.data.userId && USERS.find((x) => x.id === p.data.userId);
      if (p.data.userId && !u)
        return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { userId: ASSIGNEE_INVALID_MESSAGE } })), true);
      it.assignedTo = u ? { id: u.id, name: u.fullName } : null;
    } else {
      const p = priorityInputSchema.safeParse(raw);
      if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
      it.priority = p.data.priority;
    }
    updated(r, it);
    return (send(res, 200, view(it)), true);
  }

  if (path === "/api/v1/settings/business-hours") {
    if (req.method === "GET") return (send(res, 200, hoursView(r.hours), [], ns), true);
    if (!can("settings.edit")) return forbidden();
    const p = businessHoursSchema.safeParse(await readJson(req));
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
    r.hours = p.data;
    return (send(res, 200, hoursView(r.hours)), true);
  }
  if (path === "/api/v1/settings/holidays" && req.method === "GET") {
    const y = q.get("year") ?? "";
    return (send(res, 200, { items: r.holidays.filter((h) => h.day.startsWith(`${y}-`)) }, [], ns), true);
  }
  if (path.startsWith("/api/v1/settings/holidays") && !can("settings.edit")) return forbidden();
  if (path === "/api/v1/settings/holidays" && req.method === "POST") {
    const p = holidayInputSchema.safeParse(await readJson(req));
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
    if (r.holidays.some((h) => h.day === p.data.day)) return (send(res, 409, err("CONFLICT", HOLIDAY_DAY_CONFLICT_MESSAGE)), true);
    const h = { id: `01JHDY${String(++idSeq).padStart(20, "0")}`, ...p.data };
    r.holidays.push(h);
    return (send(res, 201, h), true);
  }
  if (path === "/api/v1/settings/holidays/import-tr" && req.method === "POST") {
    const p = importTrHolidaysInputSchema.safeParse(await readJson(req));
    const list = p.success ? TR_HOLIDAYS[p.data.year] : undefined;
    if (!list) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { year: "Bu yıl için liste yok" } })), true);
    let added = 0;
    for (const h of list) {
      if (r.holidays.some((x) => x.day === h.day)) continue;
      r.holidays.push({ id: `01JHDY${String(++idSeq).padStart(20, "0")}`, ...h });
      added++;
    }
    return (send(res, 200, { added, skipped: list.length - added }), true);
  }
  const hd = path.match(/^\/api\/v1\/settings\/holidays\/([0-9A-Z]{26})$/);
  if (hd && req.method === "DELETE") {
    const before = r.holidays.length;
    r.holidays = r.holidays.filter((h) => h.id !== hd[1]);
    return (r.holidays.length === before ? send(res, 404, err("NOT_FOUND", "Bulunamadı.")) : send(res, 204, undefined), true);
  }
  return false;
}
