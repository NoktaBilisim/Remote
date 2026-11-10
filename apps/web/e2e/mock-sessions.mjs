// E2E sahte API — oturum uçları (docs/implementation.md "## Backend (P2)" sözleşmesi). Yalnız test.
// Test izolasyonu: her test kendi oturum çerezini üretir ("u-<senaryo>-<rastgele>"); durum çerez başına tutulur.
import { randomBytes } from "node:crypto";

const BASE = process.env.MOCK_PUBLIC_BASE_URL ?? "http://localhost:3217";
const ALL = ["sessions.view", "sessions.create", "sessions.delete"];
const TECH = { id: "01JUSER0000000000000000009", name: "Mehmet Kaya" };
const ulid = () => "01J" + randomBytes(16).toString("hex").toUpperCase().replace(/[ILOU]/g, "A").slice(0, 23);
const token = () => randomBytes(32).toString("base64url");
const code = () => String(10_000_000 + Math.floor(Math.random() * 89_999_999));
const iso = (ms) => new Date(Date.now() + ms).toISOString();

const lists = new Map(); // çerez → SessionView[] (+ gizli token)
const byToken = new Map(); // token → kayıt
const byRef = new Map(); // ref → kayıt
const listCalls = new Map(); // çerez → GET /sessions sayısı (u-flaky-*: ilki 200, sonrakiler 500)
const dead = new Set(); // u-expire-*: ilk 401'den sonra çerez geçersiz (/auth/me de 401)
const SLOW_MS = 1500; // u-slow-*: liste ve oluşturma gecikmesi (loading iskeleti testleri)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Çerezden kullanıcı: u-* teknisyen; u-noperm-* yetkisiz; u-admin-* yönetici.
 * Senaryolar: u-seed-* (4 kayıt), u-broken-* (liste 500), u-flaky-* (ilk liste 200, yenilemeler 500),
 * u-slow-* (liste/oluşturma gecikmeli), u-expire-* (liste 200, POST'lar 401), u-limit-* (409), u-rate-* (429).
 */
export function sessionUser(cookie) {
  if (!cookie?.startsWith("u-") || dead.has(cookie)) return null;
  const admin = cookie.startsWith("u-admin-");
  return {
    user: { id: TECH.id, email: "mehmet@ornek.com", fullName: TECH.name, role: admin ? "ADMIN" : "USER", mustChangePassword: false },
    permissions: cookie.startsWith("u-noperm-") ? [] : ALL,
  };
}

function newSession(status = "PENDING", minutesAgo = 0) {
  const t = token();
  const s = {
    id: ulid(),
    status,
    code: status === "PENDING" ? code() : null,
    techVerifyCode: String(1000 + Math.floor(Math.random() * 8999)),
    technician: TECH,
    createdAt: iso(-minutesAgo * 60_000),
    expiresAt: iso((15 - minutesAgo) * 60_000),
    endedAt: status === "PENDING" || status === "ACTIVE" ? null : iso(0),
    endedBy: null,
    endReason: null,
  };
  const rec = { view: s, token: t, ref: t + s.id };
  byToken.set(t, rec);
  byRef.set(rec.ref, rec);
  return rec;
}

function listFor(cookie) {
  if (!lists.has(cookie)) {
    const seed = ["u-seed-", "u-admin-", "u-flaky-", "u-expire-"].some((p) => cookie.startsWith(p))
      ? [newSession("PENDING", 1), newSession("ACTIVE", 20), newSession("EXPIRED", 40), newSession("CANCELLED", 50)]
      : [];
    lists.set(cookie, seed);
  }
  return lists.get(cookie);
}

// Sabit test token'ları (43 karakter): müşteri sayfası 410/404/429 türleri
const fixed = (ch) => ch.repeat(43);
const FIXED_ERR = {
  [fixed("E")]: [410, "SESSION_EXPIRED", "Bağlantının süresi doldu."],
  [fixed("C")]: [410, "SESSION_CANCELLED", "Oturum iptal edildi."],
  [fixed("U")]: [410, "SESSION_CONSUMED", "Bu bağlantı zaten kullanıldı."],
  [fixed("R")]: [429, "RATE_LIMITED", "Çok fazla deneme."],
  [fixed("N")]: [404, "NOT_FOUND", "Bulunamadı."],
};
byToken.set(fixed("A"), newSession("PENDING"));
byToken.get(fixed("A")).token = fixed("A");

/** true → istek işlendi. */
export async function handleSessions(req, res, { url, session, csrfOk, send, err, readJson }) {
  const path = url.split("?")[0];
  const q = new URLSearchParams(url.split("?")[1] ?? "");

  if (path === "/api/v1/public/sessions/resolve" && req.method === "POST") {
    const { token: tk, clientKind } = await readJson(req);
    if (clientKind !== "BROWSER") return send(res, 400, err("VALIDATION", "Geçersiz istek.")), true;
    const fe = FIXED_ERR[tk];
    if (fe) return send(res, fe[0], err(fe[1], fe[2]), [], fe[0] === 429 ? { "Retry-After": "900" } : {}), true;
    const rec = byToken.get(tk);
    if (!rec) return send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true;
    if (rec.view.status === "CANCELLED") return send(res, 410, err("SESSION_CANCELLED", "Oturum iptal edildi.")), true;
    if (rec.view.status === "EXPIRED") return send(res, 410, err("SESSION_EXPIRED", "Süresi doldu.")), true;
    const body = {
      sessionRef: rec.ref,
      tenant: { name: "Demo Firma", logoUrl: null },
      technician: { name: rec.view.technician.name, avatarUrl: null },
      techVerifyCode: rec.view.techVerifyCode,
      expiresAt: rec.view.expiresAt,
    };
    return send(res, 200, body), true;
  }
  if (path === "/api/v1/public/sessions/status" && req.method === "GET") {
    const rec = byRef.get(q.get("ref") ?? "");
    if (!rec) return send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true;
    return send(res, 200, { status: rec.view.status }), true;
  }

  if (!path.startsWith("/api/v1/sessions")) return false;
  const who = sessionUser(session);
  if (!who) return send(res, 401, err("UNAUTHENTICATED", "Oturum gerekli.")), true;
  if (!who.permissions.length) return send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true;
  const list = listFor(session);

  if (path === "/api/v1/sessions" && req.method === "GET") {
    if (session.startsWith("u-broken-")) return send(res, 500, err("INTERNAL", "Sunucu hatası.")), true;
    const n = (listCalls.get(session) ?? 0) + 1;
    listCalls.set(session, n);
    if (session.startsWith("u-flaky-") && n > 1) return send(res, 500, err("INTERNAL", "Sunucu hatası.")), true;
    if (session.startsWith("u-slow-")) await sleep(SLOW_MS);
    const items = list.map((r) => r.view).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return send(res, 200, { items, page: 1, pageSize: Number(q.get("pageSize") ?? 25), total: items.length }), true;
  }
  if (!csrfOk) return send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true;
  if (session.startsWith("u-expire-")) return dead.add(session), send(res, 401, err("UNAUTHENTICATED", "Oturum gerekli.")), true;
  if (path === "/api/v1/sessions" && req.method === "POST") {
    if (session.startsWith("u-limit-"))
      return send(res, 409, err("OPEN_SESSION_LIMIT", "Açık oturum sınırına ulaştınız. Yeni oturum için bekleyen bir oturumu iptal edin.")), true;
    if (session.startsWith("u-rate-"))
      return send(res, 429, err("RATE_LIMITED", "Çok fazla istek."), [], { "Retry-After": "600" }), true;
    if (session.startsWith("u-slow-")) await sleep(SLOW_MS);
    const rec = newSession();
    list.push(rec);
    const v = rec.view;
    const body = { id: v.id, link: `${BASE}/session/${rec.token}`, code: v.code, techVerifyCode: v.techVerifyCode, expiresAt: v.expiresAt, status: "PENDING" };
    return send(res, 201, body), true;
  }
  const m = path.match(/^\/api\/v1\/sessions\/([^/]+)\/cancel$/);
  if (m && req.method === "POST") {
    const rec = list.find((r) => r.view.id === m[1]);
    if (!rec) return send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true;
    if (rec.view.status !== "PENDING") return send(res, 409, err("CONFLICT", "Oturum bekleme durumunda değil.")), true;
    Object.assign(rec.view, { status: "CANCELLED", code: null, endedAt: iso(0), endedBy: "TECH" });
    return send(res, 200, { status: "CANCELLED" }), true;
  }
  return false;
}
