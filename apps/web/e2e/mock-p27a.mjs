// E2E sahte API — P27a "Bu cihazı 30 gün hatırla" (mimari-p27a §4). Yalnız test; mock-account.mjs'ten çağrılır.
// Girişler (şifre DogruSifre123!): hatirla@ornek.com (ADMIN, kutu açık), sa2fa@ornek.com (SUPER_ADMIN, kutu yok).
// Çerezler: u-td-* (ADMIN; 3 cihaz, "…FAIL" silmesi 500; /users/:id hedef kullanıcı 2 cihaz), u-tdempty-* (liste boş),
// u-tdbad-* (ilk liste GET 500), u-tdsa-* (SUPER_ADMIN, Hesabım'da bölüm yok). TOTP "123456".
import { mfaVerifyInputSchema } from "@remote/contracts/api/auth";
import { PERMISSION_KEYS } from "@remote/contracts/permissions";

const PASSWORD = "DogruSifre123!";
const TENANT = { id: "01JTENTD000000000000000001", name: "Demo Firma", slug: "demo" };
export const TD_TARGET = "01JTDTARGET000000000000001";
const logins = { "hatirla@ornek.com": "tdv", "sa2fa@ornek.com": "tdvsa" };
const stores = new Map();

const devices = () => [
  {
    id: "01JTD0000000000000000CRNT1",
    uaSummary: "Chrome · Windows",
    ip: "203.0.113.10",
    createdAt: "2026-11-01T09:30:00.000Z",
    lastUsedAt: "2026-11-14T07:05:00.000Z",
    expiresAt: "2026-12-01T09:30:00.000Z",
    current: true,
  },
  {
    id: "01JTD00000000000000000NEW2",
    uaSummary: "Firefox · macOS",
    ip: "198.51.100.7",
    createdAt: "2026-11-10T12:00:00.000Z",
    lastUsedAt: null,
    expiresAt: "2026-12-10T12:00:00.000Z",
    current: false,
  },
  {
    id: "01JTD0000000000000000FA1X3",
    uaSummary: "Safari · iOS",
    ip: "2001:db8::1",
    createdAt: "2026-11-05T08:00:00.000Z",
    lastUsedAt: "2026-11-06T08:00:00.000Z",
    expiresAt: "2026-12-05T08:00:00.000Z",
    current: false,
  },
];

function st(cookie) {
  const m = cookie?.match(/^a-(tdv|tdvsa)-|^u-(td|tdempty|tdbad|tdsa)-/);
  if (!m) return null;
  let s = stores.get(cookie);
  if (s) return s;
  const kind = m[1] ?? m[2];
  const sa = kind === "tdvsa" || kind === "tdsa";
  s = {
    kind,
    role: sa ? "SUPER_ADMIN" : "ADMIN",
    stage: kind.startsWith("tdv") ? "verify" : "ok",
    items: kind === "tdempty" ? [] : devices(),
    listCalls: 0,
    remember: true,
    target: { count: 2 },
  };
  stores.set(cookie, s);
  return s;
}

const me = (s) => ({
  user: {
    id: "01JTDADM000000000000000001",
    email: "hatirla@ornek.com",
    username: null,
    fullName: "Hale Hatırlı",
    role: s.role,
    tenantId: s.role === "SUPER_ADMIN" ? null : TENANT.id,
    theme: "SYSTEM",
    mustChangePassword: false,
  },
  permissions: PERMISSION_KEYS.filter((k) => !k.startsWith("support_requests.")),
  tenant: s.role === "SUPER_ADMIN" ? null : TENANT,
  actingTenant: null,
  mfa: {
    enabled: true,
    required: true,
    stage: s.stage,
    recoveryCodesLeft: 8,
    rememberDeviceAvailable: s.stage === "verify" && s.role !== "SUPER_ADMIN" && s.remember,
  },
});

const settings = (s) => ({
  sessionTtlMin: 15,
  maxOpenSessions: 3,
  maxActiveHours: 4,
  maxFileMb: 100,
  retentionDays: 365,
  requireTech2fa: true,
  mfaRememberDevice: s.remember,
  smtp: null,
});

const target = (s) => ({
  id: TD_TARGET,
  email: "teknisyen.td@ornek.com",
  username: null,
  fullName: "Tolga Teknisyen",
  role: "USER",
  status: "ACTIVE",
  lastLoginAt: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  avatarUrl: null,
  totpEnabled: true,
  mustChangePassword: false,
  version: 1,
  permissions: Object.fromEntries(PERMISSION_KEYS.map((k) => [k, k === "sessions.view"])),
  isSelf: false,
  canManage: true,
  trustedDeviceCount: s.target.count,
});

async function verify(res, s, body, { send, err }) {
  const p = mfaVerifyInputSchema.safeParse(body);
  if (!p.success) return send(res, 400, err("VALIDATION", "Doğrulama hatası"));
  if (!("code" in p.data) || p.data.code !== "123456") return send(res, 401, err("UNAUTHENTICATED", "Kod hatalı."));
  const remembered = p.data.rememberDevice === true && me(s).mfa.rememberDeviceAvailable;
  s.stage = "ok";
  return send(res, 200, { user: me(s).user, recoveryCodesLeft: 8, deviceRemembered: remembered });
}

function devicesRoute(req, res, s, path, { send, err }) {
  if (req.method === "GET") {
    s.listCalls += 1;
    if (s.kind === "tdbad" && s.listCalls === 1) return send(res, 500, err("INTERNAL", "Beklenmeyen hata."));
    return send(res, 200, { items: s.items }, [], { "Cache-Control": "no-store" });
  }
  if (req.method !== "DELETE") return send(res, 405, err("METHOD", "Yöntem desteklenmiyor."));
  const id = path.split("/")[5];
  if (!id) {
    const n = s.items.length;
    s.items = [];
    return send(res, 200, { revoked: n, currentCleared: true });
  }
  if (id.includes("FA1X")) return send(res, 500, err("INTERNAL", "Sunucu hatası oluştu."));
  const d = s.items.find((x) => x.id === id);
  if (!d) return send(res, 404, err("NOT_FOUND", "Bulunamadı."));
  s.items = s.items.filter((x) => x.id !== id);
  return send(res, 200, { revoked: 1, currentCleared: d.current });
}

/** true → yanıt verildi. */
export async function handleP27a(req, res, ctx) {
  const { url, session, csrfOk, send, err, readJson, sessionCookies } = ctx;
  const path = url.split("?")[0];
  const post = req.method === "POST";
  if (post && path === "/api/v1/auth/login") {
    const body = await readJson(req);
    const kind = logins[String(body.login ?? "").toLowerCase()];
    if (!kind) return ((req.__body = body), false);
    if (body.password !== PASSWORD) return (send(res, 401, err("UNAUTHENTICATED", "Giriş bilgileri hatalı.")), true);
    const token = `a-${kind}-${Math.random().toString(36).slice(2)}`;
    send(
      res,
      200,
      { user: me(st(token)).user, mfaRequired: true, mfaSetupRequired: false, mustChangePassword: false },
      sessionCookies(token),
    );
    return true;
  }
  const s = st(session);
  // Diğer sahte hesaplar (P10/P12 Hesabım): hatırlanan cihaz yok → boş liste (bölüm boş durumda)
  if (!s && session && req.method === "GET" && path === "/api/v1/auth/trusted-devices") return (send(res, 200, { items: [] }), true);
  if (!s) return false;
  if (req.method === "GET" && path === "/api/v1/auth/me") return (send(res, 200, me(s)), true);
  if (req.method !== "GET" && !csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);
  if (post && path === "/api/v1/auth/mfa/verify") return (verify(res, s, await readJson(req), ctx), true);
  if (path.startsWith("/api/v1/auth/trusted-devices")) return (devicesRoute(req, res, s, path, ctx), true);
  if (path === "/api/v1/settings/tenant") {
    if (req.method === "PUT") {
      const b = await readJson(req);
      if (typeof b.mfaRememberDevice === "boolean") s.remember = b.mfaRememberDevice;
    }
    return (send(res, 200, settings(s)), true);
  }
  if (req.method === "GET" && path === `/api/v1/users/${TD_TARGET}`) return (send(res, 200, target(s)), true);
  if (post && path === `/api/v1/users/${TD_TARGET}/forget-devices`) {
    const n = s.target.count;
    s.target.count = 0;
    return (send(res, 200, { revoked: n }), true);
  }
  return false;
}
