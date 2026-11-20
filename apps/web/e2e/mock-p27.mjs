// E2E sahte API — P27-K8 gözetimsiz erişim arayüzü (mimari-p27 §4.2, §6). Yalnız test. Sözleşme contracts api/unattended.ts.
// Çerez u-<senaryo>-<rastgele>. Senaryolar:
//   unm      ADMIN (connect+manage, users/customers/history görüntüleme); mod `unsigned` (TEST bandı). 4 cihaz: MUHASEBE-PC
//            (bağlanabilir), DEPO-PC (çevrimdışı, bildirim başarısız), YENI-PC (doğrulanmadı, anahtar uyarısı, grant yok),
//            KASA-PC (yerel kapalı). Yazımlar step-up ister (TOTP "123456"); connect step-up'ı tüketir.
//   unsmtp   aynı, mod `signed`; MUHASEBE-PC nedeni `smtp`, status.notifyChannel=false → Bağlan ve Kayıt kodu oluştur pasif.
//   unoff    mod `off` (available=false) → kırmızı bant, düğmeler pasif.
//   untech   USER yalnız connect; yalnız grant'lı MUHASEBE-PC. untech0: hiç cihaz yok.
//   unempty  ADMIN, cihaz ve kod yok. unpoll: ilk liste (SSR) başarılı, sonraki yoklamalar 500 (kısmi durum).
//   unnone   gözetimsiz yetkisi yok (menü öğesi yok, sayfa uyarı).
//   unacc    P32: unm gibi ADMIN, mod `unsigned-accepted` (bant yok); DEPO-PC SHA'sı listede değil (signatureOk=false);
//            kayıt kodu yanıtında `agentSha256` (kurulum notu, S-P32-8). unaccsa: aynı, SUPER_ADMIN firma bağlamında.
import { stepUpInputSchema } from "@remote/contracts/api/auth";
import { putDeviceGrantsInputSchema, putNotifyContactsInputSchema } from "@remote/contracts/api/unattended";

const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const TENANT = { id: "01JTNP2700000000000000000A", name: "Demo Firma", slug: "demo" };
const SELF = "01JMSP2700000000000000000A";
export const P27 = {
  ACME: "01JCSP2700000000000000000A",
  BETA: "01JCSP2700000000000000000B",
  D1: "01JDVP2700000000000000000A",
  D2: "01JDVP2700000000000000000B",
  D3: "01JDVP2700000000000000000C",
  D4: "01JDVP2700000000000000000D",
  TECH: "01JMSP2700000000000000000B",
  SESSION: "01JSSP2700000000000000000A",
};
const KINDS = /^u-(unm|unsmtp|unoff|untech0|untech|unempty|unpoll|unnone|unaccsa|unacc)-/;

export function p27User(cookie) {
  const m = cookie?.match(KINDS);
  if (!m) return null;
  const kind = m[1];
  const tech = kind.startsWith("untech");
  const sa = kind === "unaccsa";
  const perms =
    kind === "unnone"
      ? ["customers.view"]
      : tech
        ? ["unattended.connect"]
        : ["unattended.connect", "unattended.manage", "users.view", "customers.view", "session_history.view"];
  return {
    kind,
    user: {
      id: SELF,
      email: "un@ornek.com",
      username: null,
      fullName: "Ufuk Yönetici",
      role: sa ? "SUPER_ADMIN" : tech ? "USER" : "ADMIN",
      tenantId: sa ? null : TENANT.id,
      theme: "SYSTEM",
      mustChangePassword: false,
    },
    permissions: perms,
    tenant: sa ? null : TENANT,
    actingTenant: sa ? TENANT : null,
    mfa: { enabled: true, required: true, stage: "ok", recoveryCodesLeft: 10 },
  };
}

const dev = (o) => ({
  customerId: P27.ACME,
  customerName: "Acme Ltd.",
  online: true,
  localEnabled: true,
  signatureOk: true,
  lastSeenAt: iso(-60_000),
  lastSessionAt: null,
  grantCount: 0,
  canConnect: false,
  connectBlockedReason: "no_grant",
  verified: true,
  notifyFailed: false,
  replacedAlert: false,
  osVersion: "Windows 11 Pro 23H2",
  agentVersion: "1.4.0",
  signed: false,
  lastIp: "203.0.113.20",
  registeredIp: "203.0.113.20",
  registeredAt: iso(-3 * 86_400_000),
  grants: [],
  ...o,
});
/** P32: sunucu `UNATTENDED_AGENT_SHA256` (kayıt kodu yanıtı `agentSha256`; K1 sözleşme bağımlılığı). */
export const AGENT_SHA = "3f2a9c1b".concat("0".repeat(48), "77e4d0aa");
const ME_GRANT = { userId: SELF, name: "Ufuk Yönetici", avatarUrl: null };

function devices(kind) {
  if (kind === "unempty" || kind === "untech0") return [];
  const smtp = kind === "unsmtp";
  const d1 = dev({
    id: P27.D1,
    name: "MUHASEBE-PC",
    grantCount: 1,
    grants: [ME_GRANT],
    canConnect: !smtp,
    connectBlockedReason: smtp ? "smtp" : null,
    lastSessionAt: iso(-86_400_000),
  });
  if (kind === "untech") return [d1];
  return [
    d1,
    dev({
      id: P27.D2,
      name: "DEPO-PC",
      online: false,
      notifyFailed: true,
      grantCount: 1,
      grants: [ME_GRANT],
      connectBlockedReason: "offline",
      signatureOk: !kind.startsWith("unacc"),
    }),
    dev({
      id: P27.D3,
      name: "YENI-PC",
      customerId: P27.BETA,
      customerName: "Beta A.Ş.",
      verified: false,
      replacedAlert: true,
      registeredIp: "198.51.100.9",
    }),
    dev({ id: P27.D4, name: "KASA-PC", localEnabled: false, grantCount: 1, grants: [ME_GRANT], connectBlockedReason: "local_disabled" }),
  ];
}

const stores = new Map();
function store(cookie, kind) {
  let s = stores.get(cookie);
  if (!s) {
    const empty = kind === "unempty";
    s = {
      stepUpUntil: 0,
      listCalls: 0,
      devices: devices(kind),
      codes: empty
        ? []
        : [
            {
              id: "01JRCP2700000000000000000A",
              customerId: P27.ACME,
              customerName: "Acme Ltd.",
              createdBy: { id: SELF, name: "Ufuk Yönetici" },
              expiresAt: iso(20 * 3_600_000),
            },
          ],
      contacts: { [P27.ACME]: [{ email: "bt@acme.example", phone: null }], [P27.BETA]: [] },
    };
    stores.set(cookie, s);
  }
  return s;
}

const gateOf = (kind) =>
  kind === "unoff"
    ? { mode: "off", available: false }
    : kind === "unsmtp"
      ? { mode: "signed", available: true }
      : kind.startsWith("unacc")
        ? { mode: "unsigned-accepted", available: true }
        : { mode: "unsigned", available: true };
/** `notifyChannel`: firmanın SMTP kaydı (yalnız `unsmtp`'de yok). */
const mode = (kind) => ({ ...gateOf(kind), notifyChannel: kind !== "unsmtp" });
const LIST_KEYS = ["osVersion", "agentVersion", "signed", "lastIp", "registeredIp", "registeredAt", "grants"];
const listItem = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => !LIST_KEYS.includes(k)));
const BASE = process.env.MOCK_PUBLIC_BASE_URL ?? "http://localhost:3217";
const CUSTOMER_REF = { [P27.ACME]: "acmeacmeacmeacme", [P27.BETA]: "betabetabetabeta" };
const customer = (id) => ({
  id,
  name: id === P27.ACME ? "Acme Ltd." : "Beta A.Ş.",
  status: "ACTIVE",
  fileLabel: "Firma",
  contactName: null,
  phone: null,
  email: null,
  note: null,
  refRotatedAt: null,
  passiveAt: null,
  anonymizedAt: null,
  createdAt: iso(-30 * 86_400_000),
  defaultPriority: null,
  slaMinutes: null,
  // K12: gerçek sözleşmede ACTIVE müşteri bağlantı taşır (mock-customers.mjs link() ile aynı biçim)
  downloadUrl: `${BASE}/api/v1/public/agent/request-download?ref=${CUSTOMER_REF[id] ?? "p27p27p27p27p27p"}`,
  fileName: `NoktaDestek-Firma-${CUSTOMER_REF[id] ?? "p27p27p27p27p27p"}.exe`,
  webFormUrl: null,
  lastRequestAt: null,
  requestCount: 0,
  sessionCount: 0,
});
const session = {
  id: P27.SESSION,
  status: "ENDED",
  code: null,
  techVerifyCode: "1234",
  technician: { id: SELF, name: "Ufuk Yönetici" },
  createdAt: iso(-86_400_000),
  expiresAt: iso(-86_000_000),
  endedAt: iso(-85_000_000),
  endedBy: "TECH",
  endReason: null,
  mode: "UNATTENDED",
  startedAt: iso(-86_300_000),
  durationSec: 1200,
  customerName: "MUHASEBE-PC",
  ticketNo: null,
  tenant: null,
  source: "TECH",
  waitSec: null,
  customerFirm: { id: P27.ACME, name: "Acme Ltd." },
  anonymized: false,
  waitingGuests: 0,
};

function listDevices(s, kind, q) {
  s.listCalls += 1;
  if (kind === "unpoll" && s.listCalls > 1)
    return [500, { error: { code: "INTERNAL", message: "Beklenmeyen hata.", requestId: "01JREQ00000000000000000000" } }];
  const text = (q.get("q") ?? "").toLocaleLowerCase("tr");
  const st = q.get("state") ?? "all";
  const items = s.devices
    .filter(
      (d) =>
        (!text || `${d.name} ${d.customerName}`.toLocaleLowerCase("tr").includes(text)) &&
        (!q.get("customerId") || d.customerId === q.get("customerId")) &&
        (st === "all" || d.online === (st === "online")),
    )
    .map(listItem);
  return [200, { items, nextCursor: null }];
}

/** true → yanıt verildi. */
export async function handleP27(req, res, { url, session: cookie, csrfOk, send, err, readJson }) {
  const who = p27User(cookie);
  if (!who) return false;
  const [path, qs] = url.split("?");
  const q = new URLSearchParams(qs ?? "");
  const s = store(cookie, who.kind);
  const m = req.method;
  const ok = (status, body) => (send(res, status, body, [], { "Cache-Control": "no-store" }), true);
  const stepUp = () => Date.now() > s.stepUpUntil && ok(401, err("MFA_STEP_UP_REQUIRED", "Bu işlem için kimliğinizi yeniden doğrulayın."));
  if (m === "GET" && path === "/api/v1/auth/me") return ok(200, who);
  if (m !== "GET" && !csrfOk) return ok(403, err("CSRF_INVALID", "CSRF doğrulaması başarısız."));
  if (m === "POST" && path === "/api/v1/auth/step-up") {
    const p = stepUpInputSchema.safeParse(await readJson(req));
    if (!p.success || p.data.code !== "123456") return ok(400, err("VALIDATION", "Doğrulama hatası", { fields: { code: "Kod hatalı" } }));
    s.stepUpUntil = Date.now() + 300_000;
    return ok(200, { stepUpUntil: iso(300_000), method: p.data.method });
  }
  if (path === "/api/v1/unattended/status") return ok(200, mode(who.kind));
  if (m === "GET" && path === "/api/v1/unattended/devices") return ok(...listDevices(s, who.kind, q));
  const dm = path.match(/^\/api\/v1\/unattended\/devices\/([0-9A-Z]{26})(?:\/(grants|revoke|connect))?$/);
  if (dm) return deviceRoute(req, s, who, dm[1], dm[2], { ok, err, stepUp, readJson });
  if (path.startsWith("/api/v1/unattended/registration-codes")) return codesRoute(req, s, who, path, { ok, err, stepUp, readJson });
  const cm = path.match(/^\/api\/v1\/unattended\/customers\/([0-9A-Z]{26})\/contacts$/);
  if (cm) {
    if (m === "GET") return ok(200, { items: s.contacts[cm[1]] ?? [] });
    const su = stepUp();
    if (su) return su;
    const p = putNotifyContactsInputSchema.safeParse(await readJson(req));
    if (!p.success) return ok(400, err("VALIDATION", "Doğrulama hatası", { fields: { "items.0.email": "E-posta adresi geçersiz" } }));
    s.contacts[cm[1]] = p.data.items;
    return ok(200, { items: p.data.items });
  }
  return otherRoutes(m, path, q, { ok, err });
}

function otherRoutes(m, path, q, { ok, err }) {
  if (m !== "GET") return false;
  if (path === "/api/v1/customers/options")
    return ok(200, {
      items: [
        { id: P27.ACME, name: "Acme Ltd.", status: "ACTIVE" },
        { id: P27.BETA, name: "Beta A.Ş.", status: "ACTIVE" },
      ],
    });
  const cu = path.match(/^\/api\/v1\/customers\/([0-9A-Z]{26})(\/requests|\/sessions)?$/);
  if (cu) return cu[2] ? ok(200, { items: [], page: 1, pageSize: 25, total: 0 }) : ok(200, customer(cu[1]));
  if (path === "/api/v1/users/options" && q.get("unattendedGrantable") === "1")
    return ok(200, {
      items: [
        { id: SELF, fullName: "Ufuk Yönetici", status: "ACTIVE" },
        { id: P27.TECH, fullName: "Tuna Teknisyen", status: "ACTIVE" },
      ],
    });
  if (path === "/api/v1/sessions" && q.get("mode") === "UNATTENDED")
    return ok(200, {
      items: q.get("deviceId") === P27.D1 ? [session] : [],
      page: 1,
      pageSize: 20,
      total: q.get("deviceId") === P27.D1 ? 1 : 0,
    });
  if (path.startsWith("/api/v1/sessions/")) return ok(404, err("NOT_FOUND", "Bulunamadı."));
  return false;
}

async function deviceRoute(req, s, who, id, action, { ok, err, stepUp, readJson }) {
  const d = s.devices.find(
    (x) => x.id === id && (who.permissions.includes("unattended.manage") || x.grants.some((g) => g.userId === SELF)),
  );
  if (!d) return ok(404, err("NOT_FOUND", "Bulunamadı."));
  if (!action && req.method === "GET") {
    const manage = who.permissions.includes("unattended.manage");
    return ok(200, manage ? d : { ...d, lastIp: null, registeredIp: null, registeredAt: null, grants: null });
  }
  if (action === "connect") {
    const su = stepUp();
    if (su) return su;
    if (!d.canConnect)
      return ok(409, err(d.connectBlockedReason === "offline" ? "DEVICE_OFFLINE" : "DEVICE_LOCAL_DISABLED", "Bağlanılamaz"));
    s.stepUpUntil = 0;
    return ok(200, { sessionId: "01JSSP2700000000000000000B" });
  }
  if (action === "revoke") {
    s.devices = s.devices.filter((x) => x.id !== id);
    return (ok(204, undefined), true);
  }
  const p = putDeviceGrantsInputSchema.safeParse(await readJson(req));
  if (!p.success) return ok(400, err("VALIDATION", "Doğrulama hatası"));
  if (p.data.userIds.some((u) => !d.grants.some((g) => g.userId === u))) {
    const su = stepUp();
    if (su) return su;
  }
  const names = { [SELF]: "Ufuk Yönetici", [P27.TECH]: "Tuna Teknisyen" };
  d.grants = p.data.userIds.map((u) => ({ userId: u, name: names[u] ?? "?", avatarUrl: null }));
  d.grantCount = d.grants.length;
  if (d.grants.length) d.verified = true;
  return ok(200, { grants: d.grants });
}

async function codesRoute(req, s, who, path, { ok, err, stepUp, readJson }) {
  const id = path.split("/")[5];
  if (req.method === "GET") return ok(200, { items: s.codes });
  if (req.method === "DELETE") {
    s.codes = s.codes.filter((c) => c.id !== id);
    return ok(204, undefined);
  }
  const su = stepUp();
  if (su) return su;
  const { customerId } = await readJson(req);
  if (who.kind === "unsmtp") return ok(409, err("NOTIFY_CHANNEL_UNAVAILABLE", "Bildirim e-postası yapılandırılmamış — Ayarlar → SMTP"));
  if (!(s.contacts[customerId] ?? []).length) return ok(409, err("NOTIFY_CONTACT_REQUIRED", "Müşterinin bildirim adresi yok"));
  return ok(201, {
    id: "01JRCP2700000000000000000B",
    code: "ABCD-1234-EFGH-5678",
    expiresAt: iso(24 * 3_600_000),
    downloadUrl: "/api/v1/unattended/download",
    ...(who.kind.startsWith("unacc") ? { agentSha256: AGENT_SHA } : {}),
  });
}
