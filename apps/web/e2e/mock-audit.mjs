// E2E sahte API — P11 audit log, sistem ayarları (MySQL/TURN), aydınlatma metni (mimari-api "Yönetim";
// contracts api/audit + api/system-settings). Yalnız test. Çerez: u-au<senaryo>-<rastgele>. Senaryolar:
//   auadm    ADMIN, tüm yetkiler; 60 audit kaydı (50 + "Daha fazla yükle" ile 10)
//   auview   USER, audit.view + settings.view (CSV yok, aydınlatma metni salt okunur)
//   aunone   USER, audit/ayar yetkisi yok (menüde Audit log yok, sayfa 403 durumu)
//   auempty  ADMIN, audit listesi boş
//   aubroken ADMIN, audit listesi ilk istekte 500 (sonra 200 → "Tekrar dene"); "Daha fazla yükle" ilk denemede 500
//   ausa     SUPER_ADMIN (firma seçmemiş): firma filtresi + sistem ayarları; WhatsApp servisi env kaynaklı (P12b)
//   ausawa0  SUPER_ADMIN, WhatsApp servisi hiç yapılandırılmamış (panel yok, env yok → url null)
//   ausarsv  SUPER_ADMIN, panelde P19 URL kuralına uymayan eski adres (kullanıcı bilgisi içerir) → "yeniden kaydedin" bandı
//   ausains  SUPER_ADMIN, WhatsApp servisi panelde http:// + genel adres (insecure, canlı ortam varsayımı)
//   ausabrk  SUPER_ADMIN, WhatsApp ayarı ilk GET'te 500 (sonra 200 → "Tekrar dene")
//   ausadef  SUPER_ADMIN, WhatsApp servisi panel yok + env yok → adres null, source "env" (yapılandırılmamış)
//   ausasu   SUPER_ADMIN, P14a step-up (AC-215): sistem ayarı yazımı son 5 dk'da step-up ister (401 MFA_STEP_UP_REQUIRED);
//            POST /auth/step-up TOTP "123456" geçer, "000000" → 429; kurtarma kodu "ABCDE-FGHIJ" bir kez geçer (kalan 2),
//            ikinci kullanımda 400 fields.code. MySQL kaydı panelde, requireTls=true (AC-211).
import { PERMISSION_KEYS } from "@remote/contracts/permissions";
import { listAuditQuerySchema } from "@remote/contracts/api/audit";
import { stepUpInputSchema } from "@remote/contracts/api/auth";
import {
  MYSQL_PASSWORD_REQUIRED_MESSAGE,
  WA_API_KEY_REENTER,
  WA_TEST_MESSAGES,
  consentTextInputSchema,
  mysqlSettingsInputSchema,
  turnSettingsInputSchema,
  whatsappAdminTestInputSchema,
  whatsappSettingsInputSchema,
} from "@remote/contracts/api/system-settings";

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
  const m = cookie?.match(/^u-(auadm|auview|aunone|auempty|aubroken|ausa(?:wa0|ins|brk|def|su|rsv)?)-/);
  if (!m) return null;
  const kind = m[1];
  const role = kind.startsWith("ausa") ? "SUPER_ADMIN" : kind === "auview" || kind === "aunone" ? "USER" : "ADMIN";
  const permissions =
    kind === "auview" ? ["audit.view", "settings.view", "sessions.view"] : kind === "aunone" ? ["sessions.view"] : ALL_NO_WS;
  return {
    user: {
      id: AU.SELF,
      email: "derya@ornek.com",
      username: null,
      fullName: "Derya Kaya",
      role,
      tenantId: role === "SUPER_ADMIN" ? null : AU.T1,
      theme: "SYSTEM",
      mustChangePassword: false,
    },
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
    base({
      id: "1060",
      createdAt: iso(60_000),
      action: "auth.login",
      entity: "auth_sessions",
      entityId: null,
      newValue: { method: "password" },
    }),
    base({
      id: "1059",
      createdAt: iso(120_000),
      action: "auth.login",
      result: "fail",
      userId: null,
      username: "kotu@ornek.com",
      userFullName: null,
      entity: "auth_sessions",
      entityId: null,
      newValue: { reason: "bad_password" },
    }),
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
    base({
      id: "1057",
      createdAt: iso(240_000),
      action: "mail.sent",
      entity: "mail",
      entityId: null,
      result: "fail",
      newValue: { reason: "auth", kind: "session_link" },
    }),
    base({ id: "1056", createdAt: iso(300_000), action: "yeni.bilinmeyen_olay", entity: "misc", entityId: null }),
    // P13a: saklama işi (sistem, yalnız sayılar) + WhatsApp test reason kodu (Türkçe etiket)
    base({
      id: "1055b",
      createdAt: iso(330_000),
      action: "retention.run",
      userId: null,
      username: "system",
      userFullName: null,
      ipAddress: null,
      userAgent: null,
      entity: "retention",
      entityId: null,
      newValue: { sessions: 3, consents: 4, files: 1, requests: 0, customers: 0, bindings: 0 },
    }),
    // P13a güvenlik turu (backend): müşteri kaynaklı kayıtlarda IP yalnız ağ öneki (/24, IPv6 /48), UA boş
    base({
      id: "1055d",
      createdAt: iso(370_000),
      action: "guest.pending",
      userId: null,
      username: "customer",
      userFullName: null,
      ipAddress: "203.0.113.0/24",
      userAgent: null,
      entity: "support_sessions",
      entityId: "01JHXST0000000000000000004",
      newValue: { mode: "BROWSER" },
    }),
    base({
      id: "1055c",
      createdAt: iso(380_000),
      action: "request.created",
      userId: null,
      username: "customer",
      userFullName: null,
      ipAddress: "2001:db8:1234::/48",
      userAgent: null,
      entity: "support_requests",
      entityId: "01JREQH0000000000000000001",
      newValue: { status: "PENDING" },
    }),
    base({
      id: "1055a",
      createdAt: iso(360_000),
      action: "settings.whatsapp.test",
      entity: "system_settings",
      entityId: null,
      result: "fail",
      newValue: { recipient: "90532*****00", result: "fail", reason: "unreachable" },
    }),
  ];
  for (let i = 0; i < 51; i++) {
    items.push(
      base({
        id: String(1055 - i),
        createdAt: iso(400_000 + i * 3_600_000),
        action: i % 3 === 0 ? "session.created" : "customer.updated",
        entity: i % 3 === 0 ? "support_sessions" : "customers",
        entityId: "01JCU00000000000000000000A",
        result: i % 7 === 0 ? "fail" : "success",
        tenantId: i % 2 ? AU.T2 : AU.T1,
        tenantName: i % 2 ? "Acme Bilişim" : "Demo Firma",
      }),
    );
  }
  return items;
}

const stores = new Map();
// P12b (AC-196): WhatsApp servis adresi — sözleşme docs/mimari-api.md "Yönetim" whatsapp satırları
const WA_ENV_URL = "http://10.20.0.5:3000";
const waEnv = (kind) => ({
  url: kind === "ausawa0" ? null : WA_ENV_URL,
  source: "env",
  insecure: false,
  updatedAt: null,
  apiKeySet: kind === "ausa",
  apiKeySource: kind === "ausa" ? "env" : null,
});
function waInitial(kind) {
  if (kind === "ausadef") return { url: null, source: "env", insecure: false, updatedAt: null, apiKeySet: false, apiKeySource: null };
  if (kind === "ausarsv")
    return {
      url: "https://kul:sifre@wa.ornek.com",
      source: "panel",
      insecure: false,
      updatedAt: iso(3_600_000),
      apiKeySet: false,
      apiKeySource: null,
    };
  if (kind === "ausains")
    return {
      url: "http://203.0.113.50:3000",
      source: "panel",
      insecure: true,
      updatedAt: iso(3_600_000),
      apiKeySet: false,
      apiKeySource: null,
    };
  return waEnv(kind);
}
/** Sunucunun `isInsecureServiceUrl(url, production)` taklidi: canlı ortam varsayımı, http:// + özel ağ dışı → güvensiz. */
const waInsecure = (u) => /^http:\/\//i.test(u) && !/^http:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u);
/** Sunucu doğrulaması: contracts `whatsappSettingsInputSchema` (alan mesajları sunucunun). "red.example" = sunucu reddi taklidi. */
function waParse(body) {
  const p = whatsappSettingsInputSchema.safeParse(body);
  if (!p.success) return { fields: fieldsOf(p.error) };
  // P13a (B-P12b-4): sunucu WHATWG kanonik biçimde saklar (şema/host küçük harf, sondaki / yok)
  p.data.url = new URL(p.data.url).href.replace(/\/+$/, "");
  if (p.data.url.includes("red.example")) return { fields: { url: "Bu adres kabul edilmiyor" } };
  return { url: p.data.url, apiKey: p.data.apiKey };
}

function astore(cookie, kind) {
  let s = stores.get(cookie);
  if (s) return s;
  s = {
    items: seedItems(kind),
    fails: new Set(),
    mysql: {
      host: "mysql",
      port: 3306,
      database: "remote",
      user: "app",
      requireTls: kind === "ausasu",
      hasPassword: true,
      updatedAt: null,
      source: kind === "ausasu" ? "panel" : "env",
      matchesRunning: true,
    },
    stepUpUntil: 0,
    usedRecovery: new Set(),
    mysqlPuts: [],
    wa: waInitial(kind),
    waTests: [],
    turn: {
      urls: ["turn:turn.ornek.com:3478", "turns:turn.ornek.com:443?transport=tcp"],
      hasSecret: true,
      source: "panel",
      updatedAt: iso(86_400_000),
    },
    consent: [
      {
        id: "01JCT00000000000000000000B",
        version: 2,
        sha256: "b".repeat(64),
        createdAt: iso(2 * 86_400_000),
        createdByName: "Derya Kaya",
        body: "Bu oturumda teknisyen ekranınızı görüntüleyebilir. Onayınızla uzaktan kontrol alabilir. Kayıtlar 730 gün saklanır.",
      },
      {
        id: "01JCT00000000000000000000A",
        version: 1,
        sha256: "a".repeat(64),
        createdAt: iso(30 * 86_400_000),
        createdByName: null,
        body: "Sistem varsayılan aydınlatma metni — ekran paylaşımı yalnız sizin onayınızla başlar ve istediğiniz an durur.",
      },
    ],
  };
  stores.set(cookie, s);
  return s;
}

const fieldsOf = (error) => Object.fromEntries(error.issues.map((i) => [i.path.length ? i.path.join(".") : "_", i.message]));
const day = (isoStr) => new Date(isoStr).toISOString().slice(0, 10);
const consentView = (s) => ({
  current: s.consent[0] ?? null,
  versions: s.consent.map((c) => ({
    id: c.id,
    version: c.version,
    sha256: c.sha256,
    createdAt: c.createdAt,
    createdByName: c.createdByName,
  })),
});

export async function handleAudit(req, res, { url, session, csrfOk, send, err, readJson }) {
  const who = auditUser(session);
  if (!who) return false;
  const [path, qs = ""] = url.split("?");
  const isAudit = path === "/api/v1/audit" || path.startsWith("/api/v1/audit/");
  const isSys = path.startsWith("/api/v1/admin/settings/");
  const isConsent = path === "/api/v1/settings/consent-text";
  const isUsers = path === "/api/v1/users" && req.method === "GET";
  const isTenants = path === "/api/v1/admin/tenants" && req.method === "GET";
  const isStepUp = path === "/api/v1/auth/step-up" && req.method === "POST" && who.kind === "ausasu";
  if (!isAudit && !isSys && !isConsent && !isUsers && !isTenants && !isStepUp) return false;
  const s = astore(session, who.kind);
  const can = (p) => who.permissions.includes(p);
  const isSa = who.user.role === "SUPER_ADMIN";
  if (req.method !== "GET" && !csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);

  if (isUsers) {
    if (!can("users.view") || isSa) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    const users = [
      { id: AU.SELF, fullName: "Derya Kaya", email: "derya@ornek.com" },
      { id: AU.CAN, fullName: "Can Aydın", email: "can.aydin@ornek.com" },
      { id: AU.ELIF, fullName: "Elif Yönetici", email: "elif@ornek.com" },
    ].map((u) => ({
      ...u,
      username: null,
      role: "USER",
      status: "ACTIVE",
      mustChangePassword: false,
      totpEnabled: false,
      lastLoginAt: null,
      createdAt: iso(0),
    }));
    return (send(res, 200, { items: users, page: 1, pageSize: 100, total: users.length }), true);
  }
  if (isTenants) {
    if (!isSa) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    const items = [
      { id: AU.T2, name: "Acme Bilişim", slug: "acme" },
      { id: AU.T1, name: "Demo Firma", slug: "demo" },
    ].map((x) => ({ ...x, status: "ACTIVE", activeUserCount: 2, createdAt: iso(0), updatedAt: iso(0) }));
    return (send(res, 200, { items, page: 1, pageSize: 100, total: items.length }), true);
  }

  if (isAudit) {
    // AC-76: salt okunur — değiştiren yöntemler 405
    if (req.method !== "GET")
      return (send(res, 405, err("METHOD_NOT_ALLOWED", "Audit kayıtları salt okunurdur; değiştirilemez veya silinemez.")), true);
    if (!can("audit.view")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    const p = listAuditQuerySchema.safeParse(Object.fromEntries(new URLSearchParams(qs)));
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
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
      if (!can("audit.export")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
      const csv = "﻿Tarih;Kullanıcı;İşlem\r\n" + rows.map((a) => `${a.createdAt};${a.username ?? ""};${a.action}`).join("\r\n");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="audit-2026-11-12.csv"',
      });
      res.end(csv);
      return true;
    }
    if (path !== "/api/v1/audit") return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
    if (who.kind === "aubroken" && !s.fails.has(q.cursor ? "more" : "list")) {
      s.fails.add(q.cursor ? "more" : "list");
      return (send(res, 500, err("INTERNAL", "Sunucu hatası.")), true);
    }
    const offset = q.cursor ? Number(q.cursor.slice(3)) : 0;
    const page = rows.slice(offset, offset + 50);
    const next = offset + 50 < rows.length ? `cur${String(offset + 50).padStart(3, "0")}` : null;
    return (send(res, 200, { items: page, nextCursor: next }), true);
  }

  if (isConsent) {
    if (isSa) return (send(res, 403, err("FORBIDDEN", "Önce firma seçin.")), true);
    if (req.method === "GET") {
      if (!can("settings.view") && !can("settings.edit")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
      return (send(res, 200, consentView(s)), true);
    }
    if (req.method === "PUT") {
      if (!can("settings.edit")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
      const p = consentTextInputSchema.safeParse(await readJson(req));
      if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
      // Tenant başına 10/saat (B-P11-6) — e2e tetikleyicisi: gövdede "[hiz-siniri]"
      if (p.data.body.includes("[hiz-siniri]"))
        return (
          send(res, 429, err("RATE_LIMITED", "Çok fazla istek. Lütfen biraz sonra tekrar deneyin."), [], { "Retry-After": "1500" }),
          true
        );
      const cur = s.consent[0];
      if (cur && cur.body === p.data.body) return (send(res, 200, { ...consentView(s), changed: false }), true);
      const v = (cur?.version ?? 0) + 1;
      s.consent.unshift({
        id: `01JCT0000000000000000000${String(v).padStart(2, "0")}`,
        version: v,
        sha256: String(v).repeat(64).slice(0, 64),
        createdAt: new Date().toISOString(),
        createdByName: who.user.fullName,
        body: p.data.body,
      });
      return (send(res, 200, { ...consentView(s), changed: true }), true);
    }
    return false;
  }

  // P14a (AC-215) step-up: TOTP veya kurtarma kodu; hatalı kod 400 fields.code (backend sapması), çok deneme 429
  if (isStepUp) {
    const p = stepUpInputSchema.safeParse(await readJson(req));
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
    const { method, code } = p.data;
    if (method === "TOTP" && code === "000000")
      return (send(res, 429, err("RATE_LIMITED", "Çok fazla deneme."), [], { "Retry-After": "300" }), true);
    const ok = method === "TOTP" ? code === "123456" : code.replace("-", "") === "ABCDEFGHIJ" && !s.usedRecovery.has(code);
    if (!ok) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { code: "Kod hatalı" } })), true);
    if (method === "RECOVERY") s.usedRecovery.add(code);
    s.stepUpUntil = Date.now() + 300_000;
    return (
      send(res, 200, {
        stepUpUntil: new Date(s.stepUpUntil).toISOString(),
        method,
        ...(method === "RECOVERY" ? { recoveryCodesLeft: 2 } : {}),
      }),
      true
    );
  }

  // Sistem ayarları — yalnız SUPER_ADMIN (rol kontrolü)
  if (!isSa) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
  // ausasu: yazımlar (PUT/DELETE) son 5 dk içinde step-up ister (sunucu `requireStepUp`)
  if (who.kind === "ausasu" && (req.method === "PUT" || req.method === "DELETE") && Date.now() > s.stepUpUntil)
    return (send(res, 401, err("MFA_STEP_UP_REQUIRED", "Bu işlem için kimliğinizi yeniden doğrulayın.")), true);
  if (path === "/api/v1/admin/settings/mysql" && req.method === "GET") return (send(res, 200, s.mysql), true);
  if (path === "/api/v1/admin/settings/mysql" && req.method === "PUT") {
    const body = await readJson(req);
    const p = mysqlSettingsInputSchema.safeParse(body);
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
    const { password, ...rest } = p.data;
    s.mysqlPuts.push(body);
    // Kayıtlı şifre yalnız aynı host + port + kullanıcı için (backend kuralı)
    if (!password && (rest.host !== s.mysql.host || rest.port !== s.mysql.port || rest.user !== s.mysql.user))
      return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { password: MYSQL_PASSWORD_REQUIRED_MESSAGE } })), true);
    s.mysql = {
      ...rest,
      hasPassword: s.mysql.hasPassword || Boolean(password),
      updatedAt: new Date().toISOString(),
      source: "panel",
      matchesRunning: rest.host === "mysql",
    };
    return (
      send(res, 200, {
        ...s.mysql,
        restartRequired: true,
        message: "Ayar kaydedildi. Uygulamak için sunucudaki .env (DATABASE_URL) güncellenip servis yeniden başlatılmalıdır.",
      }),
      true
    );
  }
  if (path === "/api/v1/admin/settings/mysql/test" && req.method === "POST") {
    const p = mysqlSettingsInputSchema.safeParse(await readJson(req));
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
    if (!p.data.password && (p.data.host !== s.mysql.host || p.data.user !== s.mysql.user) && !p.data.host.endsWith(".example"))
      return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { password: MYSQL_PASSWORD_REQUIRED_MESSAGE } })), true);
    if (p.data.host === "rate.example")
      return (send(res, 429, err("RATE_LIMITED", "Çok fazla test. Bir dakika sonra tekrar deneyin."), [], { "Retry-After": "42" }), true);
    if (p.data.host === "slow.example") await new Promise((r) => setTimeout(r, 1200));
    if (p.data.host === "bad.example") return (send(res, 200, { ok: false, message: "Sunucuya bağlanılamadı." }), true);
    return (send(res, 200, { ok: true, message: "Bağlantı başarılı.", latencyMs: 12 }), true);
  }
  if (path === "/api/v1/admin/settings/whatsapp" && req.method === "GET") {
    if (who.kind === "ausabrk" && !s.fails.has("wa")) {
      s.fails.add("wa");
      return (send(res, 500, err("INTERNAL", "Sunucu hatası.")), true);
    }
    return (send(res, 200, s.wa), true);
  }
  if (path === "/api/v1/admin/settings/whatsapp" && req.method === "PUT") {
    const p = waParse(await readJson(req));
    if (p.fields) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: p.fields })), true);
    const url = p.url;
    // S-P13b-3: yok/"" → koru; null → sil; dolu → yeni. Köken değişip anahtar verilmezse yeniden giriş istenir.
    const origin = (u) => new URL(u).origin;
    const prevKey = s.wa.apiKeySource === "panel";
    if (p.apiKey === undefined || p.apiKey === "") {
      if (prevKey && s.wa.url && origin(s.wa.url) !== origin(url))
        return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { apiKey: WA_API_KEY_REENTER } })), true);
    }
    const keySet = p.apiKey === null ? false : p.apiKey ? true : prevKey;
    s.wa = {
      url,
      source: "panel",
      insecure: waInsecure(url),
      updatedAt: new Date().toISOString(),
      apiKeySet: keySet,
      apiKeySource: keySet ? "panel" : null,
    };
    return (send(res, 200, s.wa), true);
  }
  if (path === "/api/v1/admin/settings/whatsapp" && req.method === "DELETE") {
    s.wa = who.kind === "ausadef" ? waInitial(who.kind) : waEnv(who.kind);
    return (send(res, 200, s.wa), true); // sunucu: 200 + güncel (env) görünüm
  }
  if (path === "/api/v1/admin/settings/whatsapp/test" && req.method === "POST") {
    const tp = whatsappAdminTestInputSchema.safeParse(await readJson(req));
    if (!tp.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(tp.error) })), true);
    const phone = tp.data.phoneNumber;
    // 5/dk/kullanıcı → 6. istek 429
    const now = Date.now();
    s.waTests = s.waTests.filter((x) => now - x < 60_000);
    if (s.waTests.length >= 5)
      return (
        send(res, 429, err("RATE_LIMITED", "Çok fazla test denendi. Bir dakika sonra tekrar deneyin."), [], { "Retry-After": "60" }),
        true
      );
    s.waTests.push(now);
    // Sunucunun sabit mesajları (contracts WA_TEST_MESSAGES); güvensiz adreste istek gönderilmez.
    if (!s.wa.url) return (send(res, 200, { ok: false, message: WA_TEST_MESSAGES.unconfigured }), true);
    if (s.wa.insecure) return (send(res, 200, { ok: false, message: WA_TEST_MESSAGES.insecure }), true);
    if (phone.endsWith("8888888")) return (send(res, 200, { ok: false, message: WA_TEST_MESSAGES.unauthorized }), true); // servis 401
    if (phone.endsWith("9999999")) return (send(res, 200, { ok: false, message: WA_TEST_MESSAGES.unreachable }), true);
    return (send(res, 200, { ok: true, message: WA_TEST_MESSAGES.ok }), true);
  }
  if (path === "/api/v1/admin/settings/turn" && req.method === "GET") return (send(res, 200, s.turn), true);
  if (path === "/api/v1/admin/settings/turn" && req.method === "PUT") {
    const p = turnSettingsInputSchema.safeParse(await readJson(req));
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
    s.turn = {
      urls: p.data.urls,
      hasSecret: s.turn.hasSecret || Boolean(p.data.secret),
      source: "panel",
      updatedAt: new Date().toISOString(),
    };
    return (send(res, 200, s.turn), true);
  }
  if (path === "/api/v1/admin/settings/turn" && req.method === "DELETE") {
    s.turn = { urls: ["stun:stun.ornek.com:3478"], hasSecret: true, source: "env", updatedAt: null };
    return (send(res, 204, undefined), true);
  }
  return false;
}
