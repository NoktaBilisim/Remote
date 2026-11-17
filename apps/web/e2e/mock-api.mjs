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
import { handleP18, p18User } from "./mock-p18.mjs";
import { handleP19, p19User } from "./mock-p19.mjs";
import { handleP27, p27User } from "./mock-p27.mjs";
import { handleP28u, p28uUser } from "./mock-p28u.mjs";
import { handleP28e, handleRecBytes, p28eUser, p28eViews } from "./mock-p28e.mjs";
import { emptyInvites, handleP28c, p28cUser } from "./mock-p28c.mjs";
import { handleHistory, historyUser } from "./mock-history.mjs";
import { handleLg, lgOutbox } from "./mock-lg.mjs";
import { handleFsrvBytes, handleP28b, handleStoredLink, p28bUser } from "./mock-p28b.mjs";
import { handleRequests, requestUser } from "./mock-requests.mjs";
import { handleLobby, handleSessions, lobbyHook, sessionUser } from "./mock-sessions.mjs";
import { handleUsers, usersUser } from "./mock-users.mjs";
import { recHook, recRid, voiceHook } from "./mock-ws.mjs";
import { ageRoom, attachWs, fsrvOfferToTech, fsrvWsLog, guestRoster, revokeControl, strayGrant, wsLog } from "./mock-ws.mjs";

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
  const p27 = p27User(session);
  if (p27) return p27;
  const p28u = p28uUser(session);
  if (p28u) return p28u;
  const p28e = p28eUser(session);
  if (p28e) return p28e;
  const p28c = p28cUser(session);
  if (p28c) return p28c;
  const p28b = p28bUser(session);
  if (p28b) return { user: p28b.user, permissions: p28b.permissions, tenant: p28b.tenant, actingTenant: p28b.actingTenant };
  const p15 = p15User(session);
  if (p15) return p15;
  const p16 = p16User(session);
  if (p16) return p16;
  const p19 = p19User(session);
  if (p19) return { user: p19.user, permissions: p19.permissions, tenant: p19.tenant, actingTenant: p19.actingTenant };
  const p18 = p18User(session);
  if (p18) return { user: p18.user, permissions: p18.permissions, tenant: p18.tenant, actingTenant: p18.actingTenant };
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
  // P28b: bayt uçları çerez/CSRF/Origin okumaz (yalnız Bearer) — genel denetimlerden önce
  if (await handleFsrvBytes(req, res, { url, send, err })) return;
  // P28e: kayıt parça uçları (yalnız Bearer) + test kancaları
  if (await handleRecBytes(req, res, { url, send, err })) return;
  const rh = req.method === "GET" && url.match(/^\/__e2e\/rec\/([0-9A-Z]{26})(?:\?(.*))?$/);
  if (rh) return send(res, 200, recHook(rh[1], new URLSearchParams(rh[2] ?? "")) ?? { rid: recRid(rh[1]) });
  const rv = req.method === "GET" && url.match(/^\/__e2e\/rec-views\/([\w-]+)$/);
  if (rv) return send(res, 200, { views: p28eViews(rv[1]) });
  const fo = req.method === "GET" && url.match(/^\/__e2e\/fsrv-offer\/([0-9A-Z]{26})$/);
  if (fo) return send(res, fsrvOfferToTech(fo[1], "musteri-log.txt", "P28b müşteri dosyası\n") ? 200 : 404, {});
  const fw = req.method === "GET" && url.match(/^\/__e2e\/fsrv-ws\/([0-9A-Z]{26})$/);
  if (fw) return send(res, 200, fsrvWsLog(fw[1]));
  // P5 e2e: sahte sunucunun aldığı file.meta / quality.summary kaydı (yalnız test)
  const logHit = req.method === "GET" && url.match(/^\/__e2e\/ws-log\/([0-9A-Z]{26})$/);
  if (logHit) return send(res, 200, wsLog.get(logHit[1]) ?? []);
  // P7 e2e: canlı yetki kaldırma (AC-115) — misafire control.revoke + caps.update, teknisyene control.state{VIEW,SYSTEM}
  const revokeHit = req.method === "GET" && url.match(/^\/__e2e\/revoke\/([0-9A-Z]{26})$/);
  if (revokeHit) return send(res, revokeControl(revokeHit[1]) ? 200 : 404, {});
  // P28c K2b: misafire iki teknisyenli roster (müşteri "Bağlı teknisyenler" + "Çıkar")
  const grHit = req.method === "GET" && url.match(/^\/__e2e\/guest-roster\/([0-9A-Z]{26})$/);
  if (grHit) return send(res, guestRoster(grHit[1]) ? 200 : 404, {});
  // P7 düzeltme 1 (S7-2): teknisyene istenmemiş control.state{GRANTED} (sunucu kuralını atlayan yarış/hata taklidi)
  const strayHit = req.method === "GET" && url.match(/^\/__e2e\/stray-grant\/([0-9A-Z]{26})$/);
  if (strayHit) return send(res, strayGrant(strayHit[1]) ? 200 : 404, {});
  // P28d: ses durumu kancası (/__e2e/voice/<oturum>?timeout|cool|stray)
  const vh = req.method === "GET" && url.match(/^\/__e2e\/voice\/([0-9A-Z]{26})(?:\?(.*))?$/);
  if (vh) {
    const out = voiceHook(vh[1], new URLSearchParams(vh[2] ?? ""));
    return send(res, out ? 200 : 404, out ?? {});
  }
  // TEST-P7-3: oda zaman damgalarını geçmişe çek (?ms=), 30 sn kurallarını beklemeden sınamak için
  const ageHit = req.method === "GET" && url.match(/^\/__e2e\/age\/([0-9A-Z]{26})\?ms=(\d+)$/);
  if (ageHit) return send(res, ageRoom(ageHit[1], Number(ageHit[2])) ? 200 : 404, {});
  // P13b-L: lobi durumu kancası (/__e2e/lobby/<oturum>?waiting=&arrivals=, /__e2e/lobby-calls/<çerez>)
  // LG-3: sahte SMTP/WA yakalayıcısının son mesajı (/__e2e/lg-outbox/<çerez>) — e2e önizleme = gönderilen metin karşılaştırması
  const lgHit = req.method === "GET" && url.match(/^\/__e2e\/lg-outbox\/([\w-]+)$/);
  if (lgHit) return send(res, 200, lgOutbox(lgHit[1]));
  const lh = req.method === "GET" && lobbyHook(url);
  if (lh) return send(res, lh.status, lh.body);
  // P13b-L: panel geneli lobi sayacı ucu — tüm sahte kullanıcılar için (panel kabuğu her sayfada yoklar)
  if (req.method === "GET" && url.split("?")[0] === "/api/v1/sessions/waiting")
    return handleLobby(res, { session, me: resolveMe(session), send, err });
  const csrfOk = req.headers[CSRF_HEADER.toLowerCase()] === CSRF && c[CSRF_COOKIE] === CSRF;
  // P28c: davet yoklaması panel kabuğunda her sayfada — P28c senaryosu dışındaki tüm kullanıcılara boş liste
  if (req.method === "GET" && emptyInvites(url) && !p28cUser(session)) return send(res, resolveMe(session) ? 200 : 401, { items: [] });
  // Backend gibi: durum değiştiren isteklerde Origin allowlist'te olmalı (ADR-0008)
  if (req.method !== "GET" && req.headers.origin !== (process.env.MOCK_ALLOWED_ORIGIN ?? "http://localhost:3217"))
    return send(res, 403, err("FORBIDDEN", "Origin reddedildi."));

  // P28b: ClamAV / Dosyalar ayarı (u-fsa-*, u-fad*-*) ve geçmiş indirme bağlantısı (u-hfs-*)
  if (await handleP28b(req, res, { url, session, csrfOk, send, err, readJson })) return;
  if (handleStoredLink(req, res, { url, csrfOk, send, err })) return;
  // LG-3: müşteriye gönder (POST /customer-send/options, /customer-send) — oturumlu tüm sahte kullanıcılar
  if (await handleLg(req, res, { url, session, csrfOk, send, err, readJson })) return;
  // P10: hesap güvenliği / SMTP (girişte yalnız kendi hesaplarını işler, diğerlerini aşağıya bırakır)
  if (await handleAccount(req, res, { url, session, csrfOk, send, err, readJson, sessionCookies })) return;
  // P12: tema, avatar, logo, herkese açık marka (u-br*, u-brsa-*; /public/branding herkes)
  if (await handleBranding(req, res, { url, session, csrfOk, send, err })) return;
  // P27-K8: gözetimsiz erişim arayüzü (u-un*)
  if (await handleP27(req, res, { url, session, csrfOk, send, err, readJson })) return;
  // P28u-K7: izinli/izinsiz bağlantı, politika (u-p28u*)
  if (await handleP28u(req, res, { url, session, csrfOk, send, err, readJson })) return;
  // P28c-K2: çoklu teknisyen (u-p28c*)
  if (await handleP28c(req, res, { url, session, csrfOk, send, err, readJson })) return;
  // P28e-K7: oturum kaydı ayarı, geçmiş kayıt bölümü/oynatıcı (u-p28e*)
  if (await handleP28e(req, res, { url, session, csrfOk, send, err, readJson })) return;

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
  if (await handleP19(req, res, { url, session, csrfOk, send, err, readJson })) return;
  if (await handleP18(req, res, { url, session, csrfOk, send, err, readJson })) return;
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
