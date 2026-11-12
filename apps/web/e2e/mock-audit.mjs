// E2E sahte API — P11 audit log, sistem ayarları (MySQL/TURN), aydınlatma metni (mimari-api "Yönetim";
// contracts api/audit + api/system-settings). Yalnız test. Çerez: u-au<senaryo>-<rastgele>. Senaryolar:
//   auadm    ADMIN, tüm yetkiler; 60 audit kaydı (50 + "Daha fazla yükle" ile 10)
//   auview   USER, audit.view + settings.view (CSV yok, aydınlatma metni salt okunur)
//   aunone   USER, audit/ayar yetkisi yok (menüde Audit log yok, sayfa 403 durumu)
//   auempty  ADMIN, audit listesi boş
//   aubroken ADMIN, audit listesi ilk istekte 500 (sonra 200 → "Tekrar dene"); "Daha fazla yükle" ilk denemede 500
//   ausa     SUPER_ADMIN (firma seçmemiş): firma filtresi + sistem ayarları
import { PERMISSION_KEYS } from "@remote/contracts/permissions";
import { listAuditQuerySchema } from "@remote/contracts/api/audit";
import { MYSQL_PASSWORD_REQUIRED_MESSAGE, consentTextInputSchema, mysqlSettingsInputSchema, turnSettingsInputSchema } from "@remote/contracts/api/system-settings";

export const AU = {
  SELF: "01JAV00000000000000000000A",
  CAN: "01JAV00000000000000000000B",
  ELIF: "01JAV00000000000000000000C",
  T1: "01JAT00000000000000000000A",
  T2: "01JAT00000000000000000000B",
};

// support_requests.view panel WS'sini (/ws/panel) açar; bu sahte API'de o kanal yok → kapalı tutulur
const ALL_NO_WS = PERMISSION_KEYS.filter((k) => !k.startsWith("support_requests."));

export function auditUser(cookie) {
  const m = cookie?.match(/^u-(auadm|auview|aunone|auempty|aubroken|ausa)-/);
  if (!m) return null;
  const kind = m[1];
  const role = kind === "ausa" ? "SUPER_ADMIN" : kind === "auview" || kind === "aunone" ? "USER" : "ADMIN";
  const permissions =
    kind === "auview" ? ["audit.view", "settings.view", "sessions.view"] : kind === "aunone" ? ["sessions.view"] : ALL_NO_WS;
  return {
    user: { id: AU.SELF, email: "derya@ornek.com", username: null, fullName: "Derya Kaya", role, tenantId: role === "SUPER_ADMIN" ? null : AU.T1, theme: "SYSTEM", mustChangePassword: false },
    permissions,
    tenant: role === "SUPER_ADMIN" ? null : { id: AU.T1, name: "Demo Firma", slug: "demo" },
    actingTenant: null,
    kind,
  };
}

const NOW = Date.now();
const iso = (ms) => new Date(NOW - ms).toISOString();
const base = (o) => ({
  tenantId: AU.T1,
  tenantName: "Demo Firma",
  userId: AU.CAN,
  username: "can.aydin@ornek.com",
  userFullName: "Can Aydın",
  avatarUrl: null,
  entity: "users",
  entityId: AU.CAN,
  oldValue: null,
  newValue: null,
  ipAddress: "203.0.113.7",
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130",
  result: "success",
  ...o,
});

function seedItems(kind) {
  if (kind === "auempty") return [];
  const items = [
    base({ id: "1060", createdAt: iso(60_000), action: "auth.login", entity: "auth_sessions", entityId: null, newValue: { method: "password" } }),
    base({ id: "1059", createdAt: iso(120_000), action: "auth.login", result: "fail", userId: null, username: "kotu@ornek.com", userFullName: null, entity: "auth_sessions", entityId: null, newValue: { reason: "bad_password" } }),
    base({
      id: "1058",
      createdAt: iso(180_000),
      action: "user.updated",
      userId: AU.ELIF,
      username: "elif@ornek.com",
      userFullName: "Elif Yönetici",
      avatarUrl: "/img/nokta-kucuk.png",
      oldValue: { fullName: "Can Aydin" },
      newValue: { fullName: "<img src=x onerror=alert(1)>Can" },
    }),
    base({ id: "1057", createdAt: iso(240_000), action: "mail.sent", entity: "mail", entityId: null, result: "fail", newValue: { reason: "auth", kind: "session_link" } }),
    base({ id: "1056", createdAt: iso(300_000), action: "yeni.bilinmeyen_olay", entity: "misc", entityId: null }),
  ];
  for (let i = 0; i < 55; i++) {
    items.push(base({ id: String(1055 - i), createdAt: iso(400_000 + i * 3_600_000), action: i % 3 === 0 ? "session.created" : "customer.updated", entity: i % 3 === 0 ? "support_sessions" : "customers", entityId: "01JCU00000000000000000000A", result: i % 7 === 0 ? "fail" : "success", tenantId: i % 2 ? AU.T2 : AU.T1, tenantName: i % 2 ? "Acme Bilişim" : "Demo Firma" }));
  }
  return items;
}

const stores = new Map();
function astore(cookie, kind) {
  let s = stores.get(cookie);
  if (s) return s;
  s = {
    items: seedItems(kind),
    fails: new Set(),
    mysql: { host: "mysql", port: 3306, database: "remote", user: "app", hasPassword: true, updatedAt: null, source: "env", matchesRunning: true },
    turn: { urls: ["turn:turn.ornek.com:3478", "turns:turn.ornek.com:443?transport=tcp"], hasSecret: true, source: "panel", updatedAt: iso(86_400_000) },
    consent: [
      { id: "01JCT00000000000000000000B", version: 2, sha256: "b".repeat(64), createdAt: iso(2 * 86_400_000), createdByName: "Derya Kaya", body: "Bu oturumda teknisyen ekranınızı görüntüleyebilir. Onayınızla uzaktan kontrol alabilir. Kayıtlar 730 gün saklanır." },
      { id: "01JCT00000000000000000000A", version: 1, sha256: "a".repeat(64), createdAt: iso(30 * 86_400_000), createdByName: null, body: "Sistem varsayılan aydınlatma metni — ekran paylaşımı yalnız sizin onayınızla başlar ve istediğiniz an durur." },
    ],
  };
  stores.set(cookie, s);
  return s;
}

const fieldsOf = (error) => Object.fromEntries(error.issues.map((i) => [i.path.length ? i.path.join(".") : "_", i.message]));
const day = (isoStr) => new Date(isoStr).toISOString().slice(0, 10);
const consentView = (s) => ({ current: s.consent[0] ?? null, versions: s.consent.map((c) => ({ id: c.id, version: c.version, sha256: c.sha256, createdAt: c.createdAt, createdByName: c.createdByName })) });

export async function handleAudit(req, res, { url, session, csrfOk, send, err, readJson }) {
  const who = auditUser(session);
  if (!who) return false;
  const [path, qs = ""] = url.split("?");
  const isAudit = path === "/api/v1/audit" || path.startsWith("/api/v1/audit/");
  const isSys = path.startsWith("/api/v1/admin/settings/");
  const isConsent = path === "/api/v1/settings/consent-text";
  const isUsers = path === "/api/v1/users" && req.method === "GET";
  const isTenants = path === "/api/v1/admin/tenants" && req.method === "GET";
  if (!isAudit && !isSys && !isConsent && !isUsers && !isTenants) return false;
  const s = astore(session, who.kind);
  const can = (p) => who.permissions.includes(p);
  const isSa = who.user.role === "SUPER_ADMIN";
  if (req.method !== "GET" && !csrfOk) return send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true;

  if (isUsers) {
    if (!can("users.view") || isSa) return send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true;
    const users = [
      { id: AU.SELF, fullName: "Derya Kaya", email: "derya@ornek.com" },
      { id: AU.CAN, fullName: "Can Aydın", email: "can.aydin@ornek.com" },
      { id: AU.ELIF, fullName: "Elif Yönetici", email: "elif@ornek.com" },
    ].map((u) => ({ ...u, username: null, role: "USER", status: "ACTIVE", mustChangePassword: false, totpEnabled: false, lastLoginAt: null, createdAt: iso(0) }));
    return send(res, 200, { items: users, page: 1, pageSize: 100, total: users.length }), true;
  }
  if (isTenants) {
    if (!isSa) return send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true;
    const items = [
      { id: AU.T2, name: "Acme Bilişim", slug: "acme" },
      { id: AU.T1, name: "Demo Firma", slug: "demo" },
    ].map((x) => ({ ...x, status: "ACTIVE", activeUserCount: 2, createdAt: iso(0), updatedAt: iso(0) }));
    return send(res, 200, { items, page: 1, pageSize: 100, total: items.length }), true;
  }

  if (isAudit) {
    // AC-76: salt okunur — değiştiren yöntemler 405
    if (req.method !== "GET") return send(res, 405, err("METHOD_NOT_ALLOWED", "Audit kayıtları salt okunurdur; değiştirilemez veya silinemez.")), true;
    if (!can("audit.view")) return send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true;
    const p = listAuditQuerySchema.safeParse(Object.fromEntries(new URLSearchParams(qs)));
    if (!p.success) return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true;
    const q = p.data;
    const rows = s.items.filter(
      (a) =>
        (!q.action || (q.action.endsWith(".*") ? a.action.startsWith(q.action.slice(0, -1)) : a.action === q.action)) &&
        (!q.result || a.result === q.result) &&
        (!q.userId || a.userId === q.userId) &&
        (!q.tenantId || !isSa || a.tenantId === q.tenantId) &&
        (!q.from || day(a.createdAt) >= q.from) &&
        (!q.to || day(a.createdAt) <= q.to),
    );
    if (path === "/api/v1/audit/export.csv") {
      if (!can("audit.export")) return send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true;
      const csv = "﻿Tarih;Kullanıcı;İşlem\r\n" + rows.map((a) => `${a.createdAt};${a.username ?? ""};${a.action}`).join("\r\n");
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="audit-2026-11-12.csv"' });
      res.end(csv);
      return true;
    }
    if (path !== "/api/v1/audit") return send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true;
    if (who.kind === "aubroken" && !s.fails.has(q.cursor ? "more" : "list")) {
      s.fails.add(q.cursor ? "more" : "list");
      return send(res, 500, err("INTERNAL", "Sunucu hatası.")), true;
    }
    const offset = q.cursor ? Number(q.cursor.slice(3)) : 0;
    const page = rows.slice(offset, offset + 50);
    const next = offset + 50 < rows.length ? `cur${String(offset + 50).padStart(3, "0")}` : null;
    return send(res, 200, { items: page, nextCursor: next }), true;
  }

  if (isConsent) {
    if (isSa) return send(res, 403, err("FORBIDDEN", "Önce firma seçin.")), true;
    if (req.method === "GET") {
      if (!can("settings.view") && !can("settings.edit")) return send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true;
      return send(res, 200, consentView(s)), true;
    }
    if (req.method === "PUT") {
      if (!can("settings.edit")) return send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true;
      const p = consentTextInputSchema.safeParse(await readJson(req));
      if (!p.success) return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true;
      // Tenant başına 10/saat (B-P11-6) — e2e tetikleyicisi: gövdede "[hiz-siniri]"
      if (p.data.body.includes("[hiz-siniri]")) return send(res, 429, err("RATE_LIMITED", "Çok fazla istek. Lütfen biraz sonra tekrar deneyin."), [], { "Retry-After": "1500" }), true;
      const cur = s.consent[0];
      if (cur && cur.body === p.data.body) return send(res, 200, { ...consentView(s), changed: false }), true;
      const v = (cur?.version ?? 0) + 1;
      s.consent.unshift({ id: `01JCT0000000000000000000${String(v).padStart(2, "0")}`, version: v, sha256: String(v).repeat(64).slice(0, 64), createdAt: new Date().toISOString(), createdByName: who.user.fullName, body: p.data.body });
      return send(res, 200, { ...consentView(s), changed: true }), true;
    }
    return false;
  }

  // Sistem ayarları — yalnız SUPER_ADMIN (rol kontrolü)
  if (!isSa) return send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true;
  if (path === "/api/v1/admin/settings/mysql" && req.method === "GET") return send(res, 200, s.mysql), true;
  if (path === "/api/v1/admin/settings/mysql" && req.method === "PUT") {
    const body = await readJson(req);
    const p = mysqlSettingsInputSchema.safeParse(body);
    if (!p.success) return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true;
    const { password, ...rest } = p.data;
    // Kayıtlı şifre yalnız aynı host + port + kullanıcı için (backend kuralı)
    if (!password && (rest.host !== s.mysql.host || rest.port !== s.mysql.port || rest.user !== s.mysql.user))
      return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { password: MYSQL_PASSWORD_REQUIRED_MESSAGE } })), true;
    s.mysql = { ...rest, hasPassword: s.mysql.hasPassword || Boolean(password), updatedAt: new Date().toISOString(), source: "panel", matchesRunning: rest.host === "mysql" };
    return send(res, 200, { ...s.mysql, restartRequired: true, message: "Ayar kaydedildi. Uygulamak için sunucudaki .env (DATABASE_URL) güncellenip servis yeniden başlatılmalıdır." }), true;
  }
  if (path === "/api/v1/admin/settings/mysql/test" && req.method === "POST") {
    const p = mysqlSettingsInputSchema.safeParse(await readJson(req));
    if (!p.success) return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true;
    if (!p.data.password && (p.data.host !== s.mysql.host || p.data.user !== s.mysql.user) && !p.data.host.endsWith(".example"))
      return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { password: MYSQL_PASSWORD_REQUIRED_MESSAGE } })), true;
    if (p.data.host === "rate.example") return send(res, 429, err("RATE_LIMITED", "Çok fazla test. Bir dakika sonra tekrar deneyin."), [], { "Retry-After": "42" }), true;
    if (p.data.host === "slow.example") await new Promise((r) => setTimeout(r, 1200));
    if (p.data.host === "bad.example") return send(res, 200, { ok: false, message: "Sunucuya bağlanılamadı." }), true;
    return send(res, 200, { ok: true, message: "Bağlantı başarılı.", latencyMs: 12 }), true;
  }
  if (path === "/api/v1/admin/settings/turn" && req.method === "GET") return send(res, 200, s.turn), true;
  if (path === "/api/v1/admin/settings/turn" && req.method === "PUT") {
    const p = turnSettingsInputSchema.safeParse(await readJson(req));
    if (!p.success) return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true;
    s.turn = { urls: p.data.urls, hasSecret: s.turn.hasSecret || Boolean(p.data.secret), source: "panel", updatedAt: new Date().toISOString() };
    return send(res, 200, s.turn), true;
  }
  if (path === "/api/v1/admin/settings/turn" && req.method === "DELETE") {
    s.turn = { urls: ["stun:stun.ornek.com:3478"], hasSecret: true, source: "env", updatedAt: null };
    return send(res, 204, undefined), true;
  }
  return false;
}
