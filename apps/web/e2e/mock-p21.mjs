// E2E sahte API — P21 müşteri portalı (AC-262; mimari-p21 §4.2–4.3). Yalnız test. Gövdeler gerçek contracts şemalarıyla
// ayrıştırılır (strict: ref/customerId → 400). Portal çerezi: `p-<senaryo>-<8 a-z2-7>`; senaryolar ok | must | mfa | empty |
// partial | broken. Portal talebinin ref'i `webformz<son ek>` (mock-p19 /ws/request + /__e2e/p19/accept kancası).
// Panel: u-p21adm-<oda> (customers.view + customers.portal), u-p21ro-<oda> (customers.view; portal yetkisi yok),
// u-p21pas-<oda> (yetkili; müşteri pasif). Kanca: GET /__e2e/p21/last/<portal çerezi> → son POST /portal/requests gövdesi.
import { CSRF_HEADER, passwordChangeInputSchema } from "@remote/contracts/api/auth";
import {
  PORTAL_CSRF_COOKIE,
  PORTAL_SESSION_COOKIE,
  PORTAL_TENANT_COOKIE,
  portalAccountCreateInputSchema,
  portalListQuerySchema,
  portalLoginInputSchema,
  portalRequestInputSchema,
  portalThemeInputSchema,
  portalTotpDisableInputSchema,
  portalTotpEnableInputSchema,
} from "@remote/contracts/api/portal";
import { p19AdoptSecret } from "./mock-p19.mjs";

const CSRF = "portal-csrf-test";
const BASE = process.env.MOCK_PUBLIC_BASE_URL ?? "http://localhost:3217";
const SLUG = "acme";
export const P21 = {
  CUSTOMER: "01JP21C0ST000000000000000A",
  OWN_RQ: "01JP21RQ000000000000000001",
  OWN_SS: "01JP21SS000000000000000001",
  OTHER_RQ: "01JP21RQ00000000000000000B",
  OTHER_SS: "01JP21SS00000000000000000B",
};
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const A32 = "abcdefghijklmnopqrstuvwxyz234567";
const rnd = () => Array.from({ length: 8 }, () => A32[Math.floor(Math.random() * 32)]).join("");

const LOGINS = {
  "ali@acme.com": { password: "DogruSifre123!", scen: "ok" },
  "yeni@acme.com": { password: "GeciciSifre123!", scen: "must" },
  "mfa@acme.com": { password: "DogruSifre123!", scen: "mfa" },
  "suresi@acme.com": { password: "GeciciSifre123!", expired: true },
  "kilitli@acme.com": { locked: true },
};

const portalState = new Map(); // token → { scen, mustChange, totp, theme, last }
function pstate(token) {
  const m = token?.match(/^p-(ok|must|mfa|empty|partial|broken)-([a-z2-7]{8})$/);
  if (!m) return null;
  if (!portalState.has(token))
    portalState.set(token, { scen: m[1], suffix: m[2], mustChange: m[1] === "must", totp: m[1] === "mfa", theme: "SYSTEM", last: null });
  return portalState.get(token);
}

const me = (s) => ({
  user: {
    id: `p21user-${s.suffix}`,
    email: "ali@acme.com",
    fullName: "Ali Müşteri",
    theme: s.theme,
    mustChangePassword: s.mustChange,
    totpEnabled: s.totp,
  },
  customer: { name: "Acme Lojistik A.Ş." },
  provider: { name: "Demo Firma", logoUrl: "/img/logo.png" },
  links: {
    downloadUrl: `${BASE}/api/v1/public/agent/request-download?ref=webformz${s.suffix}`,
    fileName: `NoktaDestek-Acme-webformz${s.suffix}.exe`,
  },
});

const rqItem = (id, i = 0) => ({
  id,
  requestCode: `48${String(1000 + i)}`,
  status: i % 3 === 0 ? "ACCEPTED" : i % 3 === 1 ? "CANCELLED" : "PENDING",
  source: i % 2 ? "AGENT" : "WEB",
  priority: "NORMAL",
  requesterName: i === 1 ? null : "Ali Müşteri",
  createdAt: iso(-(i + 1) * 3_600_000),
  closedAt: i % 3 === 2 ? null : iso(-(i + 1) * 3_600_000 + 600_000),
  sessionId: i === 0 ? P21.OWN_SS : null,
});
const ssItem = (id, i = 0) => ({
  id,
  status: "ENDED",
  mode: i % 2 ? "BROWSER" : "AGENT",
  technicianName: "Selin Teknik",
  customerName: i === 1 ? null : "Ali Müşteri",
  ticketNo: i === 0 ? "ITSM-1042" : null,
  createdAt: iso(-(i + 1) * 3_600_000),
  startedAt: iso(-(i + 1) * 3_600_000 + 60_000),
  endedAt: iso(-(i + 1) * 3_600_000 + 1_765_000),
  durationSec: 1705,
});
const OWN_RQS = [
  rqItem(P21.OWN_RQ, 0),
  ...Array.from({ length: 29 }, (_, i) => rqItem(`01JP21RQ0000000000000${String(i + 10).padStart(5, "0")}`, i + 1)),
];
const OWN_SSS = [ssItem(P21.OWN_SS, 0), ssItem("01JP21SS000000000000000002", 1)];

const portalCookies = (token) => [
  `${PORTAL_SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict`,
  `${PORTAL_CSRF_COOKIE}=${CSRF}; Path=/; Secure; SameSite=Strict`,
  `${PORTAL_TENANT_COOKIE}=${SLUG}; Path=/; SameSite=Lax; Max-Age=31536000`,
];
const clearPortal = [`${PORTAL_SESSION_COOKIE}=; Path=/; Secure; Max-Age=0`, `${PORTAL_CSRF_COOKIE}=; Path=/; Secure; Max-Age=0`];

const fieldsOf = (error) => Object.fromEntries(error.issues.map((i) => [String(i.path[0] ?? "form"), i.message]));

function page(items, url, send, res, err) {
  const q = Object.fromEntries(new URL(url, "http://x").searchParams);
  const r = portalListQuerySchema.safeParse(q);
  if (!r.success) return send(res, 400, err("VALIDATION", "Geçersiz sorgu.", { fields: fieldsOf(r.error) }));
  const { page: p, pageSize } = r.data;
  return send(res, 200, { items: items.slice((p - 1) * pageSize, p * pageSize), page: p, pageSize, total: items.length });
}

async function handleLogin(req, res, { send, err, readJson }) {
  const r = portalLoginInputSchema.safeParse(await readJson(req));
  if (!r.success) return send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(r.error) }));
  const { email, password, tenantSlug, totpCode } = r.data;
  const acc = tenantSlug === SLUG ? LOGINS[email] : undefined;
  if (acc?.locked) return send(res, 423, err("ACCOUNT_LOCKED", "Hesap geçici olarak kilitlendi."), [], { "Retry-After": "878" });
  if (!acc || acc.password !== password) return send(res, 401, err("UNAUTHENTICATED", "E-posta veya şifre hatalı."));
  if (acc.expired)
    return send(
      res,
      401,
      err("UNAUTHENTICATED", "Geçici şifrenin süresi doldu (72 saat). Destek sağlayıcınızdan yeniden sıfırlama isteyin."),
    );
  if (acc.scen === "mfa" && !totpCode) return send(res, 403, err("MFA_REQUIRED", "Doğrulama kodu gerekli."));
  if (acc.scen === "mfa" && totpCode !== "123456") return send(res, 401, err("UNAUTHENTICATED", "Kod hatalı."));
  const token = `p-${acc.scen}-${rnd()}`;
  return send(res, 200, me(pstate(token)), portalCookies(token));
}

/** Portal oturumlu uçlar. true → işlendi. */
async function handlePortal(req, res, ctx) {
  const { url, send, err, readJson, cookies } = ctx;
  const path = url.split("?")[0];
  const s = pstate(cookies[PORTAL_SESSION_COOKIE]);
  if (!s) return (send(res, 401, err("UNAUTHENTICATED", "Oturum gerekli.")), true);
  const write = req.method !== "GET";
  if (write && !(req.headers[CSRF_HEADER.toLowerCase()] === CSRF && cookies[PORTAL_CSRF_COOKIE] === CSRF))
    return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);
  const free = ["/api/v1/portal/me", "/api/v1/portal/auth/logout", "/api/v1/portal/account/password"];
  if (s.mustChange && !(free.includes(path) && (req.method === "GET" || path !== "/api/v1/portal/me")))
    return (send(res, 403, err("PASSWORD_CHANGE_REQUIRED", "Önce şifrenizi değiştirin.")), true);
  const k = `${req.method} ${path}`;
  if (k === "GET /api/v1/portal/me") return (send(res, 200, me(s)), true);
  if (k === "PATCH /api/v1/portal/me") {
    const r = portalThemeInputSchema.safeParse(await readJson(req));
    if (!r.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası")), true);
    s.theme = r.data.theme;
    return (send(res, 200, me(s)), true);
  }
  if (k === "POST /api/v1/portal/auth/logout")
    return (portalState.delete(cookies[PORTAL_SESSION_COOKIE]), send(res, 204, undefined, clearPortal), true);
  if (k === "POST /api/v1/portal/account/password") {
    const r = passwordChangeInputSchema.safeParse(await readJson(req));
    if (!r.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(r.error) })), true);
    if (r.data.current !== "GeciciSifre123!" && r.data.current !== "DogruSifre123!")
      return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { current: "Mevcut şifre hatalı." } })), true);
    s.mustChange = false;
    return (send(res, 204), true);
  }
  if (k === "POST /api/v1/portal/account/totp/setup") {
    if (s.totp) return (send(res, 409, err("CONFLICT", "İki adımlı doğrulama zaten açık.")), true);
    const qr = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
    return (send(res, 200, { secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP", qrDataUrl: qr }), true);
  }
  if (k === "POST /api/v1/portal/account/totp/enable" || k === "POST /api/v1/portal/account/totp/disable") {
    const on = path.endsWith("enable");
    const r = (on ? portalTotpEnableInputSchema : portalTotpDisableInputSchema).safeParse(await readJson(req));
    if (!r.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(r.error) })), true);
    if (r.data.code !== "123456") return (send(res, 400, err("VALIDATION", "Kod hatalı.", { fields: { code: "Kod hatalı." } })), true);
    if (!on && r.data.password !== "DogruSifre123!")
      return (send(res, 400, err("VALIDATION", "Şifre hatalı.", { fields: { password: "Şifre hatalı." } })), true);
    s.totp = on;
    return (send(res, 204), true);
  }
  if (k === "GET /api/v1/portal/request-form")
    return (
      send(res, 200, {
        tenant: { name: "Demo Firma", logoUrl: null },
        consentText: { id: "01JP21C0NSENT0000000000001", version: 3, body: "Aydınlatma metni (test).", sha256: "a".repeat(64) },
        chatRetentionDays: 30,
        channels: { sms: true, whatsapp: false, email: true },
        businessHours: { openNow: true, nextOpeningAt: null, afterHoursMode: "ACCEPT" },
      }),
      true
    );
  if (k === "POST /api/v1/portal/requests") {
    const body = await readJson(req);
    s.last = body;
    const r = portalRequestInputSchema.safeParse(body);
    if (!r.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(r.error) })), true);
    return (
      send(res, 201, {
        requestId: "01JP21NEWRQ000000000000001",
        requestSecret: p19AdoptSecret(`webformz${s.suffix}`),
        requestCode: "135790",
        expiresAt: iso(1_800_000),
        position: 2,
      }),
      true
    );
  }
  const listRq = s.scen === "empty" ? [] : OWN_RQS;
  const listSs = s.scen === "empty" ? [] : OWN_SSS;
  if (path === "/api/v1/portal/requests" && req.method === "GET") {
    if (s.scen === "broken") return (send(res, 500, err("INTERNAL", "Sunucu hatası.")), true);
    return (page(listRq, url, send, res, err), true);
  }
  if (path === "/api/v1/portal/sessions" && req.method === "GET") {
    if (s.scen === "partial" || s.scen === "broken") return (send(res, 500, err("INTERNAL", "Sunucu hatası.")), true);
    return (page(listSs, url, send, res, err), true);
  }
  const one = req.method === "GET" && path.match(/^\/api\/v1\/portal\/(requests|sessions)\/([0-9A-Z]{26})$/);
  if (one) {
    // IDOR: başka müşterinin kaydı ile olmayan kayıt AYNI 404 gövdesi (mimari-p21 §5.3)
    const found = (one[1] === "requests" ? listRq : listSs).find((x) => x.id === one[2]);
    return (found ? send(res, 200, found) : send(res, 404, err("NOT_FOUND", "Kayıt bulunamadı.")), true);
  }
  return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
}

// ------------------------------------------------------------------------------------------------ panel (K6)

const PANEL = /^u-(p21adm|p21ro|p21pas)-([a-z0-9]+)$/;
export function p21User(cookie) {
  const m = cookie?.match(PANEL);
  if (!m) return null;
  return {
    user: {
      id: "01JP21ADM00000000000000001",
      email: "admin@demo.com",
      fullName: "Deniz Admin",
      role: m[1] === "p21ro" ? "USER" : "ADMIN",
      mustChangePassword: false,
    },
    permissions: m[1] === "p21ro" ? ["customers.view"] : ["customers.view", "customers.edit", "customers.portal"],
    tenant: { id: "01JP21TENANT00000000000001", name: "Demo Firma" },
    actingTenant: null,
  };
}
const accStores = new Map();
let accSeq = 100;
const account = (o) => ({
  id: `01JP21ACC00000000000000${String(accSeq++).padStart(3, "0")}`,
  status: "ACTIVE",
  totpEnabled: false,
  mustChangePassword: true,
  tempPasswordExpired: false,
  lastLoginAt: null,
  createdAt: iso(-86_400_000),
  passiveAt: null,
  ...o,
});
function accounts(cookie) {
  if (!accStores.has(cookie))
    accStores.set(cookie, [
      account({
        email: "ali@acme.com",
        fullName: "Ali Müşteri",
        mustChangePassword: false,
        totpEnabled: true,
        lastLoginAt: iso(-3_600_000),
      }),
      account({ email: "eski@acme.com", fullName: "Eski Çalışan", tempPasswordExpired: true }),
    ]);
  return accStores.get(cookie);
}
const customerDetail = (passive) => ({
  id: P21.CUSTOMER,
  name: "Acme Lojistik A.Ş.",
  status: passive ? "PASSIVE" : "ACTIVE",
  fileLabel: "Acme",
  contactName: "Ali Müşteri",
  phone: null,
  email: null,
  note: null,
  refRotatedAt: null,
  passiveAt: passive ? iso(-86_400_000) : null,
  anonymizedAt: null,
  createdAt: iso(-30 * 86_400_000),
  defaultPriority: null,
  slaMinutes: null,
  downloadUrl: passive ? null : `${BASE}/api/v1/public/agent/request-download?ref=acmeref234567abc`,
  fileName: passive ? null : "NoktaDestek-Acme-acmeref234567abc.exe",
  webFormUrl: null,
  lastRequestAt: null,
  requestCount: 0,
  sessionCount: 0,
});

async function handlePanel(req, res, { url, session, csrfOk, send, err, readJson }) {
  const m = session?.match(PANEL);
  if (!m) return false;
  const path = url.split("?")[0];
  if (req.method === "GET" && path === `/api/v1/customers/${P21.CUSTOMER}`)
    return (send(res, 200, customerDetail(m[1] === "p21pas")), true);
  const pa = path.match(
    /^\/api\/v1\/customers\/([0-9A-Z]{26})\/portal-accounts(?:\/([0-9A-Z]{26})\/(deactivate|reactivate|reset-password))?$/,
  );
  if (!pa) return false;
  if (m[1] === "p21ro") return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
  if (pa[1] !== P21.CUSTOMER) return (send(res, 404, err("NOT_FOUND", "Kayıt bulunamadı.")), true);
  if (req.method !== "GET" && !csrfOk) return (send(res, 403, err("FORBIDDEN", "CSRF doğrulaması başarısız.")), true);
  const list = accounts(session);
  if (!pa[2] && req.method === "GET") return (send(res, 200, { items: list, loginUrl: `${BASE}/portal/login?tenant=${SLUG}` }), true);
  if (!pa[2] && req.method === "POST") {
    const r = portalAccountCreateInputSchema.safeParse(await readJson(req));
    if (!r.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(r.error) })), true);
    if (list.some((a) => a.email === r.data.email))
      return (
        send(
          res,
          409,
          err("CONFLICT", "Bu e-posta adresiyle portal hesabı açılamaz.", {
            fields: { email: "Bu e-posta adresiyle portal hesabı açılamaz." },
          }),
        ),
        true
      );
    const a = account({ ...r.data, createdAt: iso() });
    list.push(a);
    return (send(res, 201, { account: a, temporaryPassword: "Gecici-Sifre-7Kq2xZ" }), true);
  }
  const a = list.find((x) => x.id === pa[2]);
  if (!a) return (send(res, 404, err("NOT_FOUND", "Kayıt bulunamadı.")), true);
  if (pa[3] === "deactivate") Object.assign(a, { status: "PASSIVE", passiveAt: iso() });
  if (pa[3] === "reactivate") Object.assign(a, { status: "ACTIVE", passiveAt: null });
  if (pa[3] === "reset-password") {
    if (a.status !== "ACTIVE") return (send(res, 409, err("CONFLICT", "Pasif hesabın şifresi sıfırlanamaz.")), true);
    Object.assign(a, { mustChangePassword: true, tempPasswordExpired: false, totpEnabled: false });
    return (send(res, 200, { temporaryPassword: "Yeni-Gecici-9Lm4" }), true);
  }
  return (send(res, 200, a), true);
}

/** Tüm P21 uçları. Genel Origin denetiminden SONRA, `handleCustomers`'tan ÖNCE çağrılır. */
export async function handleP21(req, res, ctx) {
  const { url, send } = ctx;
  const hk = req.method === "GET" && url.match(/^\/__e2e\/p21\/last\/(p-[a-z]+-[a-z2-7]{8})$/);
  if (hk) return (send(res, 200, { last: pstate(hk[1])?.last ?? null }), true);
  if (url.startsWith("/api/v1/portal/")) {
    if (req.method === "POST" && url === "/api/v1/portal/auth/login") return (await handleLogin(req, res, ctx), true);
    return handlePortal(req, res, ctx);
  }
  return handlePanel(req, res, ctx);
}
