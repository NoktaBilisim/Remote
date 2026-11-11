// E2E sahte API — oturum geçmişi (P8, mimari-api "Oturum geçmişi (P8)"). Yalnız test.
// Çerez: u-h<senaryo>-<rastgele>. Senaryolar: hu (USER, tüm P8 yetkileri), hro (USER, yalnız view), hadm (ADMIN),
// hsa (SUPER_ADMIN, firma seçmemiş), hempty (veri yok), hbroken (liste 500), hbig (CSV 400 > 50.000), hrate (CSV 429).
import { listSessionsQuerySchema, updateSessionInputSchema } from "@remote/contracts/api/sessions";

const P = ["sessions.view", "session_history.view", "session_history.edit", "session_history.export"];
const TECHS = [
  { id: "01JTECH0000000000000000001", name: "Mehmet Kaya" },
  { id: "01JTECH0000000000000000002", name: "Zeynep Ak" },
];
const TENANTS = [
  { id: "01JTENA0000000000000000001", name: "Demo Firma" },
  { id: "01JTENA0000000000000000002", name: "Örnek Lojistik" },
];
const STATUSES = ["ENDED", "ENDED", "ENDED", "CANCELLED", "EXPIRED", "ACTIVE"];
const NAMES = ["Ayşe Yılmaz", "Ali Demir", "=HYPERLINK(\"x\")", "Can %_ Öz", null, "Fatma Şahin"];
const DAY = 86_400_000;
const BASE = Date.parse("2026-11-10T09:00:00Z");
export const RICH_ID = "01JHXST0000000000000000000";
export const BROWSER_ID = "01JHXSTBRWSR00000000000002";

export function historyUser(cookie) {
  const m = cookie?.match(/^u-(hu|hro|hadm|hsa|hempty|hbroken|hbig|hrate)-/);
  if (!m) return null;
  const role = m[1] === "hadm" ? "ADMIN" : m[1] === "hsa" ? "SUPER_ADMIN" : "USER";
  const permissions = m[1] === "hro" ? ["sessions.view", "session_history.view"] : P;
  return {
    user: { id: TECHS[0].id, email: "mehmet@ornek.com", fullName: TECHS[0].name, role, mustChangePassword: false },
    permissions,
    tenant: role === "SUPER_ADMIN" ? null : TENANTS[0],
    actingTenant: null,
    kind: m[1],
  };
}

function seed() {
  const items = [];
  for (let i = 0; i < 80; i++) {
    const status = STATUSES[i % STATUSES.length];
    const created = BASE - Math.floor(i / 4) * DAY - (i % 4) * 3_600_000;
    const started = status === "ENDED" || status === "ACTIVE" ? created + 60_000 : null;
    const ended = status === "ACTIVE" ? null : created + 60_000 + (i + 1) * 97_000;
    items.push({
      id: i === 0 ? RICH_ID : i === 2 ? BROWSER_ID : `01JHXST${String(i).padStart(19, "0")}`,
      status,
      code: null,
      techVerifyCode: "1234",
      technician: TECHS[i % 2],
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + 15 * 60_000).toISOString(),
      endedAt: ended ? new Date(ended).toISOString() : null,
      endedBy: status === "ENDED" ? (i % 3 === 0 ? "ADMIN" : "TECH") : status === "CANCELLED" ? "TECH" : status === "EXPIRED" ? "SYSTEM" : null,
      endReason: status === "ENDED" ? (i === 0 ? "admin" : i === 6 ? "yeni_neden" : "tech") : status === "EXPIRED" ? "expired" : status === "CANCELLED" ? "cancelled" : null,
      mode: started ? (i % 4 < 2 ? "AGENT" : "BROWSER") : null,
      startedAt: started ? new Date(started).toISOString() : null,
      durationSec: started && ended ? Math.floor((ended - started) / 1000) : null,
      customerName: started || status === "CANCELLED" ? NAMES[i % NAMES.length] : null,
      ticketNo: i === 2 ? "INC-1002" : null,
      tenant: TENANTS[i < 60 ? 0 : 1],
      customerEmail: null,
      note: null,
    });
  }
  return items;
}

const stores = new Map();
const store = (cookie) => stores.get(cookie) ?? stores.set(cookie, seed()).get(cookie);
const istDay = (iso) => new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10);

function scoped(who, cookie) {
  if (who.kind === "hempty") return [];
  const all = store(cookie);
  if (who.user.role === "SUPER_ADMIN") return all;
  const own = all.filter((s) => s.tenant.id === TENANTS[0].id);
  return who.user.role === "USER" ? own.filter((s) => s.technician.id === who.user.id) : own;
}

function filter(items, q, who) {
  return items
    .filter((s) => !q.status || s.status === q.status)
    .filter((s) => !q.mode || s.mode === q.mode)
    .filter((s) => !q.from || istDay(s.createdAt) >= q.from)
    .filter((s) => !q.to || istDay(s.createdAt) <= q.to)
    .filter((s) => who.user.role === "USER" || !q.technicianId || s.technician.id === q.technicianId)
    .filter((s) => who.user.role !== "SUPER_ADMIN" || !q.tenantId || s.tenant.id === q.tenantId)
    .filter((s) => !q.customer || (s.customerName ?? "").toLocaleLowerCase("tr").includes(q.customer.toLocaleLowerCase("tr")))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

const listItem = (s, who) => {
  const rest = { ...s };
  delete rest.customerEmail; // listede e-posta ve not yok (veri en aza indirme)
  delete rest.note;
  return { ...rest, tenant: who.user.role === "SUPER_ADMIN" ? s.tenant : null };
};

function detail(s, who) {
  const rich = s.id === RICH_ID;
  const at = (min) => new Date(Date.parse(s.createdAt) + min * 60_000).toISOString();
  return {
    ...listItem(s, who),
    customerEmail: rich ? "ayse@ornek.com" : s.customerEmail,
    note: s.note,
    terminatedBy: s.endedBy === "ADMIN" ? { id: "01JADMN0000000000000000001", name: "Yönetici Kişi" } : null,
    quality: rich ? { fps: { avg: 24.5, min: 10, max: 30 }, kbps: { avg: 2400, min: 800, max: 3100 }, rttMs: { avg: 42, min: 20, max: 140 }, connType: "relay" } : null,
    files: rich ? [{ id: "01JFILE0000000000000000001", direction: "TO_CUSTOMER", fileName: "kurulum.msi", sizeBytes: 1_572_864, sha256: "ab".repeat(32), result: "OK", createdAt: at(5) }] : [],
    consents: rich
      ? [
          { id: "01JCONS0000000000000000001", at: at(1), level: "VIEW", decision: "GRANTED", source: "UI", consentText: { id: "01JCQNSENT0000000000000003", version: 3, sha256: "a".repeat(64) } },
          { id: "01JCONS0000000000000000002", at: at(2), level: "CONTROL", decision: "GRANTED", source: "UI", consentText: null },
          { id: "01JCONS0000000000000000003", at: at(3), level: "CONTROL", decision: "REVOKED", source: "HOTKEY", consentText: null },
        ]
      : [],
    controlPeriods: rich
      ? [
          { grantedAt: at(2), revokedAt: at(3), revokedSource: "HOTKEY", revokedReason: null, selfElevated: true },
          { grantedAt: at(4), revokedAt: null, revokedSource: null, revokedReason: null, selfElevated: null },
        ]
      : [],
    timeline: rich
      ? [
          { at: at(0), action: "session.created", actor: "TECH", actorName: "Mehmet Kaya", result: "success", details: { ttlMin: 15 } },
          { at: at(1), action: "guest.admit", actor: "CUSTOMER", actorName: "Ayşe Yılmaz", result: "fail", details: { reason: "code" } },
          { at: at(1), action: "control.requested", actor: "TECH", actorName: "Mehmet Kaya", result: "success", details: { request: 1 } },
          { at: at(2), action: "control.granted", actor: "CUSTOMER", actorName: "Ayşe Yılmaz", result: "success", details: { selfElevated: true } },
          { at: at(3), action: "control.revoked", actor: "CUSTOMER", actorName: "Ayşe Yılmaz", result: "success", details: { source: "HOTKEY", reason: null, side: "guest" } },
          { at: at(6), action: "gelecek.olay", actor: "SYSTEM", actorName: null, result: "success", details: {} },
          { at: at(9), action: "session.ended", actor: "ADMIN", actorName: "Yönetici Kişi", result: "success", details: { reason: "admin", endedBy: "ADMIN" } },
        ]
      : [],
    timelineTruncated: rich,
  };
}

const csvCell = (v) => {
  let c = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(c)) c = `'${c}`;
  return /[;"\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c;
};

/** true → istek işlendi. */
export async function handleHistory(req, res, { url, session, csrfOk, send, err, readJson }) {
  const who = historyUser(session);
  if (!who) return false;
  const path = url.split("?")[0];
  const raw = Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? ""));
  if (req.method === "GET" && (path === "/api/v1/sessions" || path === "/api/v1/sessions/export.csv")) {
    if (who.kind === "hbroken" && path === "/api/v1/sessions") return send(res, 500, err("INTERNAL", "Sunucu hatası.")), true;
    const parsed = listSessionsQuerySchema.safeParse(raw);
    if (!parsed.success) return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { [String(parsed.error.issues[0]?.path[0] ?? "_")]: parsed.error.issues[0]?.message } })), true;
    const q = parsed.data;
    const rows = filter(scoped(who, session), q, who);
    if (path === "/api/v1/sessions") {
      const items = rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((s) => listItem(s, who));
      return send(res, 200, { items, page: q.page, pageSize: q.pageSize, total: rows.length }, [], { "Cache-Control": "no-store" }), true;
    }
    if (!who.permissions.includes("session_history.export")) return send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true;
    if (who.kind === "hrate") return send(res, 429, err("RATE_LIMITED", "Çok fazla istek."), [], { "Retry-After": "60" }), true;
    if (who.kind === "hbig") return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { to: "En çok 50.000 satır dışa aktarılabilir; tarih aralığını daraltın" } })), true;
    const head = ["Oturum No", "Oluşturma", "Durum", "Müşteri", "Ticket No"];
    const body = rows.map((s) => [s.id, s.createdAt, s.status, s.customerName, s.ticketNo].map(csvCell).join(";"));
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="oturumlar-20261111-1200.csv"',
      "Cache-Control": "no-store",
      "X-Echo-Query": new URLSearchParams(raw).toString(),
    });
    res.end("﻿" + [head.join(";"), ...body].join("\r\n") + "\r\n");
    return true;
  }
  const hm = path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})\/history$/);
  if (hm && req.method === "GET") {
    const s = scoped(who, session).find((x) => x.id === hm[1]);
    return s ? send(res, 200, detail(s, who)) : send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true;
  }
  const pm = path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})$/);
  if (pm && req.method === "PATCH") {
    if (!csrfOk) return send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true;
    if (!who.permissions.includes("session_history.edit")) return send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true;
    const s = scoped(who, session).find((x) => x.id === pm[1]);
    if (!s) return send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true;
    const parsed = updateSessionInputSchema.safeParse(await readJson(req));
    if (!parsed.success) return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { [String(parsed.error.issues[0]?.path[0])]: parsed.error.issues[0]?.message } })), true;
    if (parsed.data.ticketNo === "HATA-400") return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { ticketNo: "Sunucu bu ticket no'yu reddetti" } })), true;
    if (parsed.data.ticketNo !== undefined) s.ticketNo = parsed.data.ticketNo;
    if (parsed.data.note !== undefined) s.note = parsed.data.note;
    return send(res, 200, detail(s, who)), true;
  }
  return false;
}
