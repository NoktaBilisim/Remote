// E2E için sahte API (yalnız test). docs/mimari-api.md "Auth" sözleşmesini taklit eder.
// SSR'daki /auth/me çağrısı da buraya geldiği için Playwright route mock yerine küçük bir HTTP sunucusu.
import { createServer } from "node:http";
// Çerez/başlık adları tek kaynaktan (Node 24 .ts tür ayıklama ile doğrudan okunur)
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "@remote/contracts/api/auth";
import { handleAccount } from "./mock-account.mjs";
import { handleBranding } from "./mock-branding.mjs";
import { auditUser, handleAudit } from "./mock-audit.mjs";
import { handleCustomers } from "./mock-customers.mjs";
import { handleP15, p15User } from "./mock-p15.mjs";
import { handleP16, p16User } from "./mock-p16.mjs";
import { handleHistory, historyUser } from "./mock-history.mjs";
import { handleRequests, requestUser } from "./mock-requests.mjs";
import { handleLobby, handleSessions, lobbyHook, sessionUser } from "./mock-sessions.mjs";
import { handleUsers, usersUser } from "./mock-users.mjs";
import { ageRoom, attachWs, revokeControl, strayGrant, wsLog } from "./mock-ws.mjs";

const PORT = Number(process.env.MOCK_API_PORT ?? 4010);
const CSRF = "csrf-test-token";

const users = {
  "s-ok": {
    id: "01JUSER0000000000000000001",
    email: "teknisyen@ornek.com",
    fullName: "Ayşe Teknisyen",
    role: "USER",
    mustChangePassword: false,
  },
  "s-must": {
    id: "01JUSER0000000000000000002",
    email: "yeni@ornek.com",
    fullName: "Yeni Kullanıcı",
    role: "ADMIN",
    mustChangePassword: true,
  },
};
const accounts = {
  "teknisyen@ornek.com": { password: "DogruSifre123!", session: "s-ok" },
  "yeni@ornek.com": { password: "GeciciSifre123!", session: "s-must" },
};

const err = (code, message, extra = {}) => ({ error: { code, message, requestId: "01JREQ00000000000000000000", ...extra } });

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .filter(Boolean)
      .map((p) => {
        const [k, ...v] = p.trim().split("=");
        return [k, decodeURIComponent(v.join("="))];
      }),
  );
}

function send(res, status, body, setCookies = [], extra = {}) {
  const headers = { "Content-Type": "application/json; charset=utf-8", ...extra };
  if (setCookies.length) headers["Set-Cookie"] = setCookies;
  res.writeHead(status, headers);
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

const sessionCookies = (token) => [
  `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict`,
  `${CSRF_COOKIE}=${CSRF}; Path=/; Secure; SameSite=Strict`,
];
const clearCookies = [`${SESSION_COOKIE}=; Path=/; Secure; Max-Age=0`, `${CSRF_COOKIE}=; Path=/; Secure; Max-Age=0`];

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

/** /auth/me gövdesi (çekirdek sahte kullanıcılar); P10/P12 hesap/marka kullanıcıları kendi modüllerinde çözülür → null. */
function resolveMe(session) {
  const tenant = { id: "01JTENANT", name: "Demo Firma" };
  const p15 = p15User(session);
  if (p15) return p15;
  const p16 = p16User(session);
  if (p16) return p16;
  const au = auditUser(session);
  if (au) return { user: au.user, permissions: au.permissions, tenant: au.tenant, actingTenant: au.actingTenant };
  const uu = usersUser(session);
  if (uu) return { user: uu.user, permissions: uu.permissions, tenant: uu.tenant, actingTenant: uu.actingTenant };
  const ru = requestUser(session);
  if (ru) return { user: ru.user, permissions: ru.permissions, tenant: ru.tenant, actingTenant: ru.actingTenant };
  const hu = historyUser(session);
  if (hu) return { user: hu.user, permissions: hu.permissions, tenant: hu.tenant, actingTenant: hu.actingTenant };
  const su = sessionUser(session);
  if (su) return { tenant, ...su };
  const user = users[session];
  if (!user) return null;
  return { user, permissions: ["sessions.view", "sessions.create", "sessions.delete"], tenant };
}

const srv = createServer(async (req, res) => {
  const c = cookies(req);
  const session = c[SESSION_COOKIE];
  const url = req.url ?? "";
  // P5 e2e: sahte sunucunun aldığı file.meta / quality.summary kaydı (yalnız test)
  const logHit = req.method === "GET" && url.match(/^\/__e2e\/ws-log\/([0-9A-Z]{26})$/);
  if (logHit) return send(res, 200, wsLog.get(logHit[1]) ?? []);
  // P7 e2e: canlı yetki kaldırma (AC-115) — misafire control.revoke + caps.update, teknisyene control.state{VIEW,SYSTEM}
  const revokeHit = req.method === "GET" && url.match(/^\/__e2e\/revoke\/([0-9A-Z]{26})$/);
  if (revokeHit) return send(res, revokeControl(revokeHit[1]) ? 200 : 404, {});
  // P7 düzeltme 1 (S7-2): teknisyene istenmemiş control.state{GRANTED} (sunucu kuralını atlayan yarış/hata taklidi)
  const strayHit = req.method === "GET" && url.match(/^\/__e2e\/stray-grant\/([0-9A-Z]{26})$/);
  if (strayHit) return send(res, strayGrant(strayHit[1]) ? 200 : 404, {});
  // TEST-P7-3: oda zaman damgalarını geçmişe çek (?ms=), 30 sn kurallarını beklemeden sınamak için
  const ageHit = req.method === "GET" && url.match(/^\/__e2e\/age\/([0-9A-Z]{26})\?ms=(\d+)$/);
  if (ageHit) return send(res, ageRoom(ageHit[1], Number(ageHit[2])) ? 200 : 404, {});
  // P13b-L: lobi durumu kancası (/__e2e/lobby/<oturum>?waiting=&arrivals=, /__e2e/lobby-calls/<çerez>)
  const lh = req.method === "GET" && lobbyHook(url);
  if (lh) return send(res, lh.status, lh.body);
  // P13b-L: panel geneli lobi sayacı ucu — tüm sahte kullanıcılar için (panel kabuğu her sayfada yoklar)
  if (req.method === "GET" && url.split("?")[0] === "/api/v1/sessions/waiting")
    return handleLobby(res, { session, me: resolveMe(session), send, err });
  const csrfOk = req.headers[CSRF_HEADER.toLowerCase()] === CSRF && c[CSRF_COOKIE] === CSRF;
  // Backend gibi: durum değiştiren isteklerde Origin allowlist'te olmalı (ADR-0008)
  if (req.method !== "GET" && req.headers.origin !== (process.env.MOCK_ALLOWED_ORIGIN ?? "http://localhost:3217"))
    return send(res, 403, err("FORBIDDEN", "Origin reddedildi."));

  // P10: hesap güvenliği / SMTP (girişte yalnız kendi hesaplarını işler, diğerlerini aşağıya bırakır)
  if (await handleAccount(req, res, { url, session, csrfOk, send, err, readJson, sessionCookies })) return;
  // P12: tema, avatar, logo, herkese açık marka (u-br*, u-brsa-*; /public/branding herkes)
  if (await handleBranding(req, res, { url, session, csrfOk, send, err })) return;

  if (req.method === "POST" && url === "/api/v1/auth/login") {
    const { login = "", password = "" } = req.__body ?? (await readJson(req));
    if (login === "kilitli@ornek.com")
      return send(res, 423, err("ACCOUNT_LOCKED", "Çok fazla hatalı deneme. Hesap geçici olarak kilitlendi."), [], {
        "Retry-After": "878",
      });
    if (login === "hata500@ornek.com") return send(res, 500, err("INTERNAL", "Sunucu hatası oluştu."));
    const acc = accounts[login.toLowerCase()];
    if (!acc || acc.password !== password) return send(res, 401, err("UNAUTHENTICATED", "Giriş bilgileri hatalı."));
    const user = users[acc.session];
    return send(res, 200, { user, mfaRequired: false, mustChangePassword: user.mustChangePassword }, sessionCookies(acc.session));
  }

  if (req.method === "GET" && url === "/api/v1/auth/me") {
    // Yavaş API simülasyonu (kararsızlık testi): MOCK_ME_DELAY_MS=400 pnpm e2e
    const delay = Number(process.env.MOCK_ME_DELAY_MS ?? 0);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    if (session === "s-broken") return send(res, 503, err("INTERNAL", "Hazır değil"));
    const me = resolveMe(session);
    return me ? send(res, 200, me) : send(res, 401, err("UNAUTHENTICATED", "Oturum gerekli."));
  }

  if (req.method === "POST" && url === "/api/v1/auth/password/change") {
    if (!users[session]) return send(res, 401, err("UNAUTHENTICATED", "Oturum gerekli."));
    if (!csrfOk) return send(res, 403, err("FORBIDDEN", "CSRF doğrulaması başarısız."));
    const { current, next } = await readJson(req);
    if (current !== "GeciciSifre123!" && current !== "DogruSifre123!")
      return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { current: "Mevcut şifre hatalı." } }));
    if (typeof next !== "string" || next.length < 12)
      return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { next: "En az 12 karakter." } }));
    return send(res, 204, undefined, sessionCookies("s-ok"));
  }

  if (req.method === "POST" && url === "/api/v1/auth/logout") {
    if (!csrfOk) return send(res, 403, err("FORBIDDEN", "CSRF doğrulaması başarısız."));
    return send(res, 204, undefined, clearCookies);
  }

  if (await handleP15(req, res, { url, session, csrfOk, send, err, readJson })) return;
  if (await handleP16(req, res, { url, session, csrfOk, send, err, readJson })) return;
  if (await handleAudit(req, res, { url, session, csrfOk, send, err, readJson })) return;
  if (await handleUsers(req, res, { url, session, csrfOk, send, err, readJson })) return;
  if (await handleCustomers(req, res, { url, session, csrfOk, send, err, readJson })) return;
  if (await handleRequests(req, res, { url, session, csrfOk, send, err, readJson })) return;
  if (await handleHistory(req, res, { url, session, csrfOk, send, err, readJson })) return;
  if (await handleSessions(req, res, { url, session, csrfOk, send, err, readJson })) return;

  send(res, 404, err("NOT_FOUND", "Bulunamadı."));
});
attachWs(srv);
srv.listen(PORT, "127.0.0.1", () => console.log(`mock-api :${PORT}`));
