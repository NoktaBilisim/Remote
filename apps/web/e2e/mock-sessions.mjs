// E2E sahte API — oturum uçları (docs/implementation.md "## Backend (P2)" sözleşmesi). Yalnız test.
// Test izolasyonu: her test kendi oturum çerezini üretir ("u-<senaryo>-<rastgele>"); durum çerez başına tutulur.
import { REC_CONSENT_LINE, REC_CONSENT_LINE_SHA256 } from "@remote/contracts/ws-rec";
import { randomBytes } from "node:crypto";
import { customerRef } from "./mock-customers.mjs";
import { endRoom } from "./mock-ws.mjs";

const BASE = process.env.MOCK_PUBLIC_BASE_URL ?? "http://localhost:3217";
const ALL = ["sessions.view", "sessions.create", "sessions.delete"];
const TECH = { id: "01JUSER0000000000000000009", name: "Mehmet Kaya" };
// P13b-L: aynı firmada başka teknisyen (ADMIN / Super Admin listesinde görünür; lobi sayacına girmez)
const OTHER_TECH = { id: "01JUSER0000000000000000010", name: "Zeynep Ak" };
const LOBBY_TENANT = { id: "01JTENANT", name: "Demo Firma" };
export const ulid = () =>
  "01J" +
  randomBytes(16)
    .toString("hex")
    .toUpperCase()
    .replace(/[ILOU]/g, "A")
    .slice(0, 23);
const token = () => randomBytes(32).toString("base64url");
const code = () => String(10_000_000 + Math.floor(Math.random() * 89_999_999));
const iso = (ms) => new Date(Date.now() + ms).toISOString();

const lists = new Map(); // çerez → SessionView[] (+ gizli token)
const byToken = new Map(); // token → kayıt
const byRef = new Map(); // ref → kayıt
export const byId = new Map(); // id → kayıt (konsol, WS)
export const tickets = new Map(); // wsTicket → { rec, name, admitCode } (P4 join)
const nonces = new Map(); // joinNonce → kayıt
const CONSENT = {
  id: "01JCQNSENT0000000000000003",
  version: 3,
  sha256: "a".repeat(64),
  body: "Nokta Bilişim destek oturumu boyunca adınızı, IP adresinizi ve tarayıcı bilginizi oturum kaydı amacıyla işler. Ekran görüntünüz kaydedilmez.",
};
const listCalls = new Map(); // çerez → GET /sessions sayısı (u-flaky-*: ilki 200, sonrakiler 500)
const dead = new Set(); // u-expire-*: ilk 401'den sonra çerez geçersiz (/auth/me de 401)
const SLOW_MS = 1500; // u-slow-*: liste ve oluşturma gecikmesi (loading iskeleti testleri)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Çerezden kullanıcı: u-* teknisyen; u-noperm-* yetkisiz; u-admin-* yönetici.
 * Senaryolar: u-seed-* (4 kayıt), u-broken-* (liste 500), u-flaky-* (ilk liste 200, yenilemeler 500),
 * u-slow-* (liste/oluşturma gecikmeli), u-expire-* (liste 200, POST'lar 401), u-limit-* (409), u-rate-* (429).
 * P5: u-p5-* `file_transfer.use` yetkili (müşteriye caps=[file_transfer]); u-p5nf-* yetkisiz (caps=[]). İkisinde maxFileMb=1.
 * P7: u-p7-* `remote_control.use` yetkili; u-p7np-* yetkisiz (sunucu control.request → FORBIDDEN).
 * P28d: u-p28d-* / u-p28drec-* / u-p28dold-* `sessions.voice` yetkili (ses odası, mock-ws.mjs voice*). P33: u-p33mac-* aynı.
 */
export function sessionUser(cookie) {
  if (!cookie?.startsWith("u-") || dead.has(cookie)) return null;
  // P13b-L: u-lobadm-* ADMIN; u-sa-* firma seçmemiş Super Admin; u-sat-* firma seçmiş Super Admin
  const sa = cookie.startsWith("u-sa-") || cookie.startsWith("u-sat-");
  const admin = cookie.startsWith("u-admin-") || cookie.startsWith("u-lobadm-") || sa;
  return {
    user: {
      id: TECH.id,
      email: "mehmet@ornek.com",
      fullName: TECH.name,
      role: sa ? "SUPER_ADMIN" : admin ? "ADMIN" : "USER",
      mustChangePassword: false,
    },
    permissions: cookie.startsWith("u-noperm-")
      ? []
      : admin
        ? [...ALL, "sessions.terminate"]
        : cookie.startsWith("u-p5-")
          ? [...ALL, "file_transfer.use"]
          : cookie.startsWith("u-p7-")
            ? [...ALL, "remote_control.use"]
            : cookie.startsWith("u-p28-")
              ? [...ALL, "remote_control.use", "remote_control.clipboard", "file_transfer.print"]
              : /^u-(p28d(rec|old)?|p33mac)-/.test(cookie)
                ? [...ALL, "sessions.voice"]
                : cookie.startsWith("u-p28b-")
                  ? [...ALL, "file_transfer.use", "remote_control.use", "file_transfer.print"]
                  : ALL,
    ...(sa ? { tenant: null, actingTenant: cookie.startsWith("u-sat-") ? LOBBY_TENANT : null } : {}),
  };
}

/*
 * P13b-L lobi göstergesi (mimari-lobi §9.3). Bellekteki oda durumu taklidi: oturum → { waiting, arrivals }.
 * Kanca: GET /__e2e/lobby/<oturum>?waiting=n&arrivals=m (sorgusuz → kayıt silinir = sunucu yeniden başladı, sayı 0).
 * GET /__e2e/lobby-calls/<çerez> → { calls } waiting ucu çağrı sayısı.
 * GET /__e2e/lobby-extra/<çerez>?id=&waiting=&arrivals= → listesi başka sahte modülde olan kullanıcı (ör. u-rqadm-*)
 * için "kendi oturumu" lobi kaydı (talep + lobi başlık sırası testi).
 * Senaryolar: u-lobbyfail-* (ilk waiting 200, sonrakiler 500), u-lobbyrate-* (ilk 200, sonrakiler 429 Retry-After: 30).
 * u-noreq-* = varsayılan teknisyen (support_requests.view yok).
 */
const lobbyState = new Map();
const lobbyCalls = new Map();
const lobbyExtra = new Map(); // çerez → Map(id → { waiting, arrivals })
export function lobbyHook(url) {
  const m = url.match(/^\/__e2e\/lobby\/([0-9A-Z]{26})(?:\?(.*))?$/);
  if (m) {
    const q = new URLSearchParams(m[2] ?? "");
    if (!q.has("waiting")) lobbyState.delete(m[1]);
    else lobbyState.set(m[1], { waiting: Number(q.get("waiting")), arrivals: Number(q.get("arrivals") ?? q.get("waiting")) });
    return { status: 200, body: {} };
  }
  const x = url.match(/^\/__e2e\/lobby-extra\/([^/?]+)\?(.*)$/);
  if (x) {
    const q = new URLSearchParams(x[2]);
    const m2 = lobbyExtra.get(decodeURIComponent(x[1])) ?? new Map();
    m2.set(q.get("id"), { waiting: Number(q.get("waiting")), arrivals: Number(q.get("arrivals") ?? q.get("waiting")) });
    lobbyExtra.set(decodeURIComponent(x[1]), m2);
    return { status: 200, body: {} };
  }
  const c = url.match(/^\/__e2e\/lobby-calls\/([^/?]+)$/);
  if (c) return { status: 200, body: { calls: lobbyCalls.get(decodeURIComponent(c[1])) ?? 0 } };
  return null;
}
const waitingOf = (v) => (v.status === "PENDING" ? (lobbyState.get(v.id)?.waiting ?? 0) : 0);

/**
 * GET /api/v1/sessions/waiting (mimari-lobi §4.1): `me` = /auth/me karşılığı (mock-api çözer; bilinmeyen sahte kullanıcı
 * → boş yanıt). Yalnız kendi PENDING oturumlarım; firma seçmemiş Super Admin 403; no-store.
 */
export function handleLobby(res, { session, me, send, err }) {
  const H = { "Cache-Control": "no-store" };
  if (!session || dead.has(session)) return send(res, 401, err("UNAUTHENTICATED", "Oturum gerekli."), [], H);
  lobbyCalls.set(session, (lobbyCalls.get(session) ?? 0) + 1);
  if (!me) return send(res, 200, { count: 0, sessions: [] }, [], H);
  if (!me.permissions.includes("sessions.view")) return send(res, 403, err("FORBIDDEN", "Yetkiniz yok."), [], H);
  if (me.user.role === "SUPER_ADMIN" && !me.actingTenant) return send(res, 403, err("FORBIDDEN", "Önce bir firma seçin."), [], H);
  const n = lobbyCalls.get(session);
  if (session.startsWith("u-lobbyfail-") && n > 1) return send(res, 500, err("INTERNAL", "Sunucu hatası."), [], H);
  if (session.startsWith("u-lobbyrate-") && n > 1)
    return send(res, 429, err("RATE_LIMITED", "Çok fazla istek."), [], { ...H, "Retry-After": "30" });
  const sessions = (lists.get(session) ?? [])
    .map((r) => r.view)
    .filter((v) => v.technician.id === me.user.id && waitingOf(v) > 0)
    .map((v) => ({ id: v.id, waiting: waitingOf(v), arrivals: lobbyState.get(v.id).arrivals }))
    .concat([...(lobbyExtra.get(session) ?? new Map())].filter(([, e]) => e.waiting > 0).map(([id, e]) => ({ id, ...e })))
    .sort((a, b) => a.id.localeCompare(b.id));
  return send(res, 200, { count: sessions.reduce((a, s) => a + s.waiting, 0), sessions }, [], H);
}

function newSession(status = "PENDING", minutesAgo = 0, technician = TECH) {
  const t = token();
  const s = {
    id: ulid(),
    status,
    code: status === "PENDING" ? code() : null,
    techVerifyCode: String(1000 + Math.floor(Math.random() * 8999)),
    technician,
    createdAt: iso(-minutesAgo * 60_000),
    expiresAt: iso((15 - minutesAgo) * 60_000),
    endedAt: status === "PENDING" || status === "ACTIVE" ? null : iso(0),
    endedBy: null,
    endReason: null,
  };
  const rec = { view: s, token: t, ref: t + s.id };
  byToken.set(t, rec);
  byRef.set(rec.ref, rec);
  byId.set(s.id, rec);
  return rec;
}

function listFor(cookie) {
  if (!lists.has(cookie)) {
    const seed = ["u-seed-", "u-admin-", "u-flaky-", "u-expire-"].some((p) => cookie.startsWith(p))
      ? [newSession("PENDING", 1), newSession("ACTIVE", 20), newSession("EXPIRED", 40), newSession("CANCELLED", 50)]
      : // P13b-L: iki kendi PENDING oturumum + (ADMIN / Super Admin) başka teknisyenin PENDING oturumu
        ["u-lob", "u-noreq-", "u-sa-", "u-sat-"].some((p) => cookie.startsWith(p))
        ? [
            newSession("PENDING", 2),
            newSession("PENDING", 1),
            ...(["u-lobadm-", "u-sa-", "u-sat-"].some((p) => cookie.startsWith(p)) ? [newSession("PENDING", 3, OTHER_TECH)] : []),
          ]
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
// "B": ABUSE_EMAIL ve Super Admin e-postası yok → resolve abuseEmail: null (bildir bağlantısı gizlenir)
byToken.set(fixed("B"), Object.assign(newSession("PENDING"), { noAbuse: true }));
// "L" (P12 QA-2, AC-81): firmanın yüklenmiş logosu var → resolve tenant.logoUrl dolu (dosya mock-branding.mjs'den sunulur)
export const TENANT_LOGO_URL = "/api/v1/files/logo/demo/public-demo-logo-0001.png";
byToken.set(fixed("L"), Object.assign(newSession("PENDING"), { tenantLogo: TENANT_LOGO_URL }));
// "V" (P15, AC-236): teknisyenin avatarı var → resolve technician.avatarUrl oturuma bağlı imzalı URL (≤ 10 dk);
// oturum PENDING/ACTIVE değilse 403. Baytlar 1×1 PNG.
byToken.set(fixed("V"), Object.assign(newSession("PENDING"), { techAvatar: true }));
const AVATAR_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const techAvatarUrl = (rec) =>
  `/api/v1/public/sessions/${rec.view.id}/tech-avatar?exp=${Math.floor(Date.now() / 1000) + 600}&sig=${"a".repeat(64)}`;
// P22 (AC-292): "Q" resolve yanıtında chatRetentionDays yok → satır çizilmez, tarayıcı yolu pasif
byToken.set(fixed("Q"), Object.assign(newSession("PENDING"), { noRetention: true }));
// P6 (AC-27) indirme ucu: "D" istemci yayında değil (503 NOT_READY), "G" indirme anında oturum iptal (410)
byToken.set(fixed("D"), Object.assign(newSession("PENDING"), { agent: "notReady" }));
byToken.set(fixed("G"), Object.assign(newSession("PENDING"), { agent: "gone" }));
// Gerçek sunucu 302 → /downloads/Destek-<kod>.exe (Caddy, attachment). E2E'de Caddy yok: aynı yolu sahte API sunar.
const DOWNLOAD_BASE = `http://127.0.0.1:${process.env.MOCK_API_PORT ?? 4010}`;

/** true → istek işlendi. */
export async function handleSessions(req, res, { url, session, csrfOk, send, err, readJson }) {
  const path = url.split("?")[0];
  const q = new URLSearchParams(url.split("?")[1] ?? "");

  const ta = req.method === "GET" && path.match(/^\/api\/v1\/public\/sessions\/([0-9A-Z]{26})\/tech-avatar$/);
  if (ta) {
    const rec = [...byToken.values()].find((r) => r.view.id === ta[1] && r.techAvatar);
    const exp = Number(q.get("exp"));
    if (!rec || !/^[a-f0-9]{64}$/.test(q.get("sig") ?? "") || !(exp * 1000 > Date.now()))
      return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    if (rec.view.status !== "PENDING" && rec.view.status !== "ACTIVE") return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "private, no-store" });
    return (res.end(AVATAR_PNG), true);
  }
  if (path === "/api/v1/public/sessions/resolve" && req.method === "POST") {
    const { token: tk, clientKind } = await readJson(req);
    if (clientKind !== "BROWSER") return (send(res, 400, err("VALIDATION", "Geçersiz istek.")), true);
    const fe = FIXED_ERR[tk];
    if (fe) return (send(res, fe[0], err(fe[1], fe[2]), [], fe[0] === 429 ? { "Retry-After": "900" } : {}), true);
    const rec = byToken.get(tk);
    if (!rec) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
    if (rec.view.status === "CANCELLED") return (send(res, 410, err("SESSION_CANCELLED", "Oturum iptal edildi.")), true);
    if (rec.view.status === "EXPIRED") return (send(res, 410, err("SESSION_EXPIRED", "Süresi doldu.")), true);
    // Gerçek sunucu gibi: kabul edilmiş/bitmiş oturumun linki tekrar açılamaz (F5 dönüşü rs.reconnect.* ile)
    if (rec.view.status === "ACTIVE" || rec.view.status === "ENDED")
      return (send(res, 410, err("SESSION_CONSUMED", "Bu bağlantı zaten kullanıldı.")), true);
    const body = {
      sessionRef: rec.ref,
      tenant: { name: "Demo Firma", logoUrl: rec.tenantLogo ?? null },
      technician: { name: rec.view.technician.name, avatarUrl: rec.techAvatar ? techAvatarUrl(rec) : null },
      techVerifyCode: rec.view.techVerifyCode,
      expiresAt: rec.view.expiresAt,
      joinNonce: token(),
      nonceExpiresAt: iso(60_000),
      consentText: rec.recOffer
        ? { ...CONSENT, recording: { offered: true, line: REC_CONSENT_LINE, lineSha256: REC_CONSENT_LINE_SHA256 } }
        : CONSENT,
      abuseEmail: rec.noAbuse ? null : "kotuye-kullanim@ornek.com",
      // P22 (AC-292): onay düğmesi üstündeki saklama satırı; `noRetention` → alan yok (düğme pasif kalmalı)
      ...(rec.noRetention ? {} : { chatRetentionDays: 90 }),
    };
    nonces.set(body.joinNonce, rec);
    return (send(res, 200, body), true);
  }
  if (path === "/api/v1/public/sessions/join" && req.method === "POST") {
    const b = await readJson(req);
    const rec = nonces.get(b.joinNonce);
    if (!rec) return (send(res, 410, err("NONCE_INVALID", "İstek süresi doldu.")), true);
    nonces.delete(b.joinNonce);
    if (b.consentAccepted !== true || b.consentTextId !== CONSENT.id) return (send(res, 400, err("VALIDATION", "Doğrulama hatası")), true);
    const name = String(b.customerName ?? "").trim();
    if (name.length < 2)
      return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { customerName: "Ad en az 2 karakter olmalı" } })), true);
    const wsTicket = token();
    const admitCode = String(1000 + Math.floor(Math.random() * 8999));
    tickets.set(wsTicket, { rec, name, admitCode });
    return (send(res, 200, { wsTicket, admitCode, technicianName: rec.view.technician.name }), true);
  }
  // P28f (AC-390): platform başına ikili kapısı. Senaryolar tarayıcıda page.route ile ezilir (false / 429 / 500).
  if (path === "/api/v1/public/agent/availability" && req.method === "GET")
    return (
      send(res, 200, { windows: true, macos: true, linux: true, macosTestBuild: false, macosSigning: "adhoc" }, [], {
        "Cache-Control": "public, max-age=60",
      }),
      true
    );
  if (path === "/api/v1/public/agent/download" && req.method === "GET") {
    const os = q.get("os") ?? "windows";
    if (os !== "windows" && os !== "macos" && os !== "linux") return (send(res, 400, err("VALIDATION", "Geçersiz istek.")), true);
    const rec = byRef.get(q.get("ref") ?? "");
    if (!rec) return (send(res, 404, err("NOT_FOUND", "Bulunamadı."), [], { "Cache-Control": "no-store" }), true);
    if (rec.agent === "notReady")
      return (
        send(
          res,
          503,
          err("NOT_READY", "İndirme şu anda kullanılamıyor. Biraz sonra tekrar deneyin ya da tarayıcıdan paylaşımı kullanın."),
          [],
          { "Cache-Control": "no-store" },
        ),
        true
      );
    if (rec.agent === "gone" || rec.view.status === "CANCELLED")
      return (send(res, 410, err("SESSION_CANCELLED", "Oturum iptal edildi.")), true);
    if (rec.view.status === "EXPIRED") return (send(res, 410, err("SESSION_EXPIRED", "Süresi doldu.")), true);
    if (rec.view.status !== "PENDING") return (send(res, 410, err("SESSION_CONSUMED", "Bu bağlantı zaten kullanıldı.")), true);
    // P28g: Linux ELF uzantısız (Caddy `agent_bin_file`)
    const ext = os === "macos" ? ".zip" : os === "linux" ? "" : ".exe";
    res.writeHead(302, { Location: `${DOWNLOAD_BASE}/downloads/Destek-${rec.view.code}${ext}`, "Cache-Control": "no-store" });
    res.end();
    return true;
  }
  const dl = path.match(/^\/downloads\/(Destek-\d{8}(?:\.(exe|zip))?)$/);
  if (dl && req.method === "GET") {
    const zip = dl[2] === "zip";
    res.writeHead(200, {
      "Content-Type": zip ? "application/zip" : "application/octet-stream",
      "Content-Disposition": `attachment; filename="${dl[1]}"`,
    });
    res.end(zip ? "PK-e2e" : dl[2] ? "MZ-e2e" : "\x7fELF-e2e");
    return true;
  }
  if (path === "/api/v1/public/sessions/status" && req.method === "GET") {
    const rec = byRef.get(q.get("ref") ?? "");
    if (!rec) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
    return (send(res, 200, { status: rec.view.status }), true);
  }

  if (!path.startsWith("/api/v1/sessions")) return false;
  const who = sessionUser(session);
  if (!who) return (send(res, 401, err("UNAUTHENTICATED", "Oturum gerekli.")), true);
  if (!who.permissions.length) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
  const list = listFor(session);

  if (path === "/api/v1/sessions" && req.method === "GET") {
    if (session.startsWith("u-broken-")) return (send(res, 500, err("INTERNAL", "Sunucu hatası.")), true);
    const n = (listCalls.get(session) ?? 0) + 1;
    listCalls.set(session, n);
    if (session.startsWith("u-flaky-") && n > 1) return (send(res, 500, err("INTERNAL", "Sunucu hatası.")), true);
    if (session.startsWith("u-slow-")) await sleep(SLOW_MS);
    const items = list.map((r) => ({ ...r.view, waitingGuests: waitingOf(r.view) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return (send(res, 200, { items, page: 1, pageSize: Number(q.get("pageSize") ?? 25), total: items.length }), true);
  }
  const one = path.match(/^\/api\/v1\/sessions\/([0-9A-Z]{26})$/);
  if (one && req.method === "GET") {
    const rec = list.find((r) => r.view.id === one[1]);
    return (rec ? send(res, 200, rec.view) : send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
  }
  if (!csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);
  if (session.startsWith("u-expire-")) return (dead.add(session), send(res, 401, err("UNAUTHENTICATED", "Oturum gerekli.")), true);
  if (path === "/api/v1/sessions" && req.method === "POST") {
    if (session.startsWith("u-limit-"))
      return (
        send(res, 409, err("OPEN_SESSION_LIMIT", "Açık oturum sınırına ulaştınız. Yeni oturum için bekleyen bir oturumu iptal edin.")),
        true
      );
    if (session.startsWith("u-rate-")) return (send(res, 429, err("RATE_LIMITED", "Çok fazla istek."), [], { "Retry-After": "600" }), true);
    if (session.startsWith("u-slow-")) await sleep(SLOW_MS);
    // P8c (AC-180): customerId → aynı kullanıcının aktif müşterisi; yoksa 404
    const { customerId } = await readJson(req);
    const firm = customerId ? customerRef(session, customerId) : null;
    if (customerId && !firm) return (send(res, 404, err("NOT_FOUND", "Müşteri bulunamadı.")), true);
    const rec = newSession();
    // P5: sunucu hello/peer.joined'a caps + maxFileMb koyar (küçük sınır: 100 MB'lık dosya üretmeden sınır testi)
    if (session.startsWith("u-p5")) Object.assign(rec, { caps: session.startsWith("u-p5-") ? ["file_transfer"] : [], maxFileMb: 1 });
    if (session.startsWith("u-p7"))
      Object.assign(rec, { caps: session.startsWith("u-p7-") ? ["remote_control"] : [], canControl: session.startsWith("u-p7-") });
    // P28a: u-p28-* kontrol + pano + yazdırma yetkili (caps dört değer)
    if (session.startsWith("u-p28-"))
      Object.assign(rec, { caps: ["remote_control", "clipboard", "print"], canControl: true, canClip: true, canPrint: true });
    // P28b: u-p28b-* SERVER modu oturum (sunucu caps'ten file_transfer/print'i çıkarır, §5.4a); maxFileMb 5
    if (session.startsWith("u-p28b-"))
      Object.assign(rec, { caps: ["remote_control"], canControl: true, canPrint: true, fileMode: "SERVER", maxFileMb: 5 });
    // P28e: u-p28ec* → kayıt teklif edilir (resolve consentText.recording); u-p28ecnoack* → sunucu revoke'a yanıt vermez
    if (session.startsWith("u-p28ec")) Object.assign(rec, { recOffer: true, recAck: !session.startsWith("u-p28ecnoack") });
    // P28d: u-p28d* → ses odası (teknisyen hello tid/roster, misafire roster + `from`); u-p28drec* ayrıca kayıt teklifi (AC-375);
    // u-p28dold* aynı kullanıcı, misafir sahte Hızlı Destek istemcisi (voice1 yok → guestVoice=false, AC-379)
    // P33: u-p33mac* → aynı ses odası, misafir sahte Mac istemcisi (`rs.cap.voice1` bildirir → guestVoice=true, AC-541/552)
    if (/^u-(p28d(rec|old)?|p33mac)-/.test(session)) Object.assign(rec, { voice: true, canVoice: true });
    if (session.startsWith("u-p28drec-")) Object.assign(rec, { recOffer: true, recAck: true });
    list.push(rec);
    const v = rec.view;
    const body = {
      id: v.id,
      link: `${BASE}/session/${rec.token}`,
      code: v.code,
      techVerifyCode: v.techVerifyCode,
      expiresAt: v.expiresAt,
      status: "PENDING",
      customerFirm: firm,
    };
    return (send(res, 201, body), true);
  }
  const term = path.match(/^\/api\/v1\/sessions\/([^/]+)\/terminate$/);
  if (term && req.method === "POST") {
    if (!who.permissions.includes("sessions.terminate")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    const rec = list.find((r) => r.view.id === term[1]);
    if (!rec) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
    if (rec.view.status !== "ACTIVE") return (send(res, 409, err("CONFLICT", "Oturum aktif değil.")), true);
    Object.assign(rec.view, { status: "ENDED", endedAt: iso(0), endedBy: "ADMIN", endReason: "admin" });
    endRoom(rec.view.id, "admin");
    return (send(res, 200, { status: "ENDED", endedBy: "ADMIN" }), true);
  }
  const m = path.match(/^\/api\/v1\/sessions\/([^/]+)\/cancel$/);
  if (m && req.method === "POST") {
    const rec = list.find((r) => r.view.id === m[1]);
    if (!rec) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
    if (rec.view.status !== "PENDING") return (send(res, 409, err("CONFLICT", "Oturum bekleme durumunda değil.")), true);
    Object.assign(rec.view, { status: "CANCELLED", code: null, endedAt: iso(0), endedBy: "TECH" });
    endRoom(rec.view.id, "cancelled");
    return (send(res, 200, { status: "CANCELLED" }), true);
  }
  return false;
}
