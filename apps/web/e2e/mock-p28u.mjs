// E2E sahte API — P28u-K7 gözetimsiz izinli/izinsiz bağlantı arayüzü (mimari-p28u §5, §10). Yalnız test. Sözleşme contracts
// api/unattended.ts. Çerez u-p28u<senaryo>-<rastgele>. Senaryolar:
//   p28ufull   ADMIN: connect+manage+silent, settings.view+edit; politika açık → status.silentAllowed=true.
//              Cihazlar: AKTIF-PC (userState active, bağlanabilir), ESKI-PC (outdated, userState null), KILIT-PC (locked).
//   p28unopol  aynı yetkiler, politika kapalı → silentAllowed=false (kutu yok); politika ekranında açma akışı (ack + step-up).
//   p28unoperm `unattended.silent` yok (politika açık) → silentAllowed=false.
//   p28uro     politika salt okunur (settings.view, settings.edit yok).
// Yazımlar step-up ister (TOTP "123456"); connect step-up'ı tüketir, politika açma tüketmez.
import { stepUpInputSchema } from "@remote/contracts/api/auth";
import { putUnattendedPolicyInputSchema, unattendedConnectInputSchema } from "@remote/contracts/api/unattended";

const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const TENANT = { id: "01JTNP28V0000000000000000A", name: "Demo Firma", slug: "demo" };
const SELF = "01JMSP28V0000000000000000A";
export const P28U = {
  D1: "01JDVP28V0000000000000000A",
  D2: "01JDVP28V0000000000000000B",
  D3: "01JDVP28V0000000000000000C",
  SESSION: "01JSSP28V0000000000000000A",
};
const KINDS = /^u-(p28ufull|p28unopol|p28unoperm|p28uro)-/;

export function p28uUser(cookie) {
  const m = cookie?.match(KINDS);
  if (!m) return null;
  const kind = m[1];
  const perms = ["unattended.connect", "unattended.manage", "settings.view"];
  if (kind !== "p28unoperm") perms.push("unattended.silent");
  if (kind !== "p28uro") perms.push("settings.edit");
  return {
    kind,
    user: {
      id: SELF,
      email: "p28u@ornek.com",
      username: null,
      fullName: "Pınar Yönetici",
      role: "ADMIN",
      tenantId: TENANT.id,
      theme: "SYSTEM",
      mustChangePassword: false,
    },
    permissions: perms,
    tenant: TENANT,
    actingTenant: null,
    mfa: { enabled: true, required: true, stage: "ok", recoveryCodesLeft: 10 },
  };
}

const dev = (o) => ({
  customerId: "01JCSP28V0000000000000000A",
  customerName: "Acme Ltd.",
  online: true,
  localEnabled: true,
  signatureOk: true,
  lastSeenAt: iso(-60_000),
  lastSessionAt: null,
  grantCount: 1,
  canConnect: true,
  connectBlockedReason: null,
  verified: true,
  notifyFailed: false,
  replacedAlert: false,
  userState: "active",
  ...o,
});
const DETAIL = {
  osVersion: "Windows 11 Pro 23H2",
  agentVersion: "1.5.0",
  signed: true,
  lastIp: null,
  registeredIp: null,
  registeredAt: null,
  grants: null,
};

const stores = new Map();
function store(cookie, kind) {
  let s = stores.get(cookie);
  if (!s) {
    s = {
      stepUpUntil: 0,
      policy:
        kind === "p28unopol"
          ? { silentEnabled: false, ackAt: null, ackByName: null }
          : { silentEnabled: true, ackAt: iso(-86_400_000), ackByName: "Pınar Yönetici" },
      devices: [
        dev({ id: P28U.D1, name: "AKTIF-PC" }),
        dev({ id: P28U.D2, name: "ESKI-PC", userState: null, canConnect: false, connectBlockedReason: "outdated" }),
        dev({ id: P28U.D3, name: "KILIT-PC", userState: "locked" }),
      ],
    };
    stores.set(cookie, s);
  }
  return s;
}

/** true → yanıt verildi. */
export async function handleP28u(req, res, { url, session: cookie, csrfOk, send, err, readJson }) {
  const who = p28uUser(cookie);
  if (!who) return false;
  const [path] = url.split("?");
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
  const silentPerm = who.permissions.includes("unattended.silent");
  if (path === "/api/v1/unattended/status")
    return ok(200, { mode: "signed", available: true, notifyChannel: true, silentAllowed: s.policy.silentEnabled && silentPerm });
  if (m === "GET" && path === "/api/v1/unattended/devices") return ok(200, { items: s.devices, nextCursor: null });
  if (path === "/api/v1/unattended/policy") return policyRoute(req, s, who, { ok, err, stepUp, readJson });
  const dm = path.match(/^\/api\/v1\/unattended\/devices\/([0-9A-Z]{26})(\/connect)?$/);
  if (!dm) return false;
  const d = s.devices.find((x) => x.id === dm[1]);
  if (!d) return ok(404, err("NOT_FOUND", "Bulunamadı."));
  if (!dm[2]) return m === "GET" ? ok(200, { ...d, ...DETAIL }) : false;
  const p = unattendedConnectInputSchema.safeParse(await readJson(req));
  if (!p.success) return ok(400, err("VALIDATION", "Doğrulama hatası", { fields: { reason: p.error.issues[0]?.message ?? "Geçersiz" } }));
  if (p.data.silent && !silentPerm) return ok(403, err("FORBIDDEN", "Yetkiniz yok."));
  if (p.data.silent && !s.policy.silentEnabled)
    return ok(409, err("SILENT_DISABLED", "Firma politikası izin istemeden bağlanmaya izin vermiyor"));
  const su = stepUp();
  if (su) return su;
  if (d.connectBlockedReason === "outdated") return ok(409, err("DEVICE_OUTDATED", "Cihazdaki servis güncel değil — güncelleyin"));
  s.stepUpUntil = 0;
  return ok(200, { sessionId: P28U.SESSION });
}

async function policyRoute(req, s, who, { ok, err, stepUp, readJson }) {
  if (req.method === "GET") return ok(200, s.policy);
  if (req.method !== "PUT") return false;
  if (!who.permissions.includes("settings.edit")) return ok(403, err("FORBIDDEN", "Yetkiniz yok."));
  const p = putUnattendedPolicyInputSchema.safeParse(await readJson(req));
  if (!p.success) return ok(400, err("VALIDATION", "Doğrulama hatası"));
  if (p.data.silentEnabled && !s.policy.silentEnabled) {
    if (p.data.ack !== true)
      return ok(400, err("VALIDATION", "Doğrulama hatası", { fields: { ack: "Açmak için bilgilendirme kutusunu işaretleyin" } }));
    const su = stepUp();
    if (su) return su;
    s.policy = { silentEnabled: true, ackAt: iso(), ackByName: who.user.fullName };
  } else s.policy = { ...s.policy, silentEnabled: p.data.silentEnabled };
  return ok(200, s.policy);
}

// AC-445 (QA P28u tur 1, madde 7): "Bağlantı kipi" filtresi için üç kipli fikstürler. Geçmiş (u-hun-*, mock-history.mjs) ve
// audit (u-auun-*, mock-audit.mjs) bunları kullanır; her kipin satırı görünür bir işaret taşır (geçmişte ticket no, audit'te
// teknisyen / cihaz adı). Kipsiz satırlar (katılımlı oturumlar, `consentRequested:"ask"` taşıyan connect) hiçbir kipte görünmez.

/** Geçmiş seed sırası → kip + ticket no (u-hun USER: TECHS[0] + TENANTS[0] → çift sıra, < 60; ENDED satırlar). */
export const P28U_HISTORY_MODES = new Map([
  [0, { consentMode: "silent", ticketNo: "UN-SESSIZ-00" }],
  [12, { consentMode: "silent", ticketNo: "UN-SESSIZ-12" }],
  [6, { consentMode: "asked", ticketNo: "UN-IZINLI-06" }],
  [18, { consentMode: "asked", ticketNo: "UN-IZINLI-18" }],
  [8, { consentMode: "no_user", ticketNo: "UN-KULLANICISIZ-08" }],
]);

const AUS = { silent: "01JSSP28VAU00000000000000S", asked: "01JSSP28VAU00000000000000A", noUser: "01JSSP28VAU00000000000000N" };
const TECH = {
  silent: { userId: "01JMSP28VAU0000000000000S1", username: "selin@ornek.com", userFullName: "Selin Arslan" },
  asked: { userId: "01JMSP28VAU0000000000000A1", username: "murat@ornek.com", userFullName: "Murat Çelik" },
  noUser: { userId: "01JMSP28VAU0000000000000N1", username: "kemal@ornek.com", userFullName: "Kemal Öztürk" },
};
export const P28U_AUDIT_DEVICE = "01JDVP28V0000000000000000A";

/** Audit satırları (mock-audit `base` ile tamamlanır; en yeni önce). `newValue.consentMode` sözleşmeyle aynı yerde (§9.1). */
export function p28uAuditRows(base, iso) {
  const ss = (o) => base({ entity: "support_sessions", ...o });
  return [
    ss({
      id: "2012",
      createdAt: iso(60_000),
      action: "auth.login",
      entity: "auth_sessions",
      entityId: null,
      newValue: { method: "password" },
    }),
    ss({
      id: "2011",
      createdAt: iso(120_000),
      ...TECH.noUser,
      action: "unattended.session.ended",
      entityId: AUS.noUser,
      newValue: { consentMode: "no_user" },
    }),
    ss({
      id: "2010",
      createdAt: iso(180_000),
      ...TECH.noUser,
      action: "unattended.session.started",
      entityId: AUS.noUser,
      newValue: { consentMode: "no_user" },
    }),
    ss({
      id: "2009",
      createdAt: iso(240_000),
      ...TECH.noUser,
      action: "unattended.connect",
      entityId: AUS.noUser,
      newValue: { consentRequested: "ask" },
    }),
    ss({
      id: "2008",
      createdAt: iso(300_000),
      ...TECH.asked,
      action: "unattended.session.started",
      entityId: AUS.asked,
      newValue: { consentMode: "asked" },
    }),
    ss({
      id: "2007",
      createdAt: iso(360_000),
      userId: null,
      username: `device:${P28U_AUDIT_DEVICE}`,
      userFullName: null,
      action: "unattended.consent",
      entityId: AUS.asked,
      newValue: { consentMode: "asked", decision: "granted", ms: 4200, deviceId: P28U_AUDIT_DEVICE, technicianId: TECH.asked.userId },
    }),
    ss({
      id: "2006",
      createdAt: iso(420_000),
      ...TECH.asked,
      action: "unattended.connect",
      entityId: AUS.asked,
      newValue: { consentRequested: "ask" },
    }),
    ss({
      id: "2005",
      createdAt: iso(480_000),
      ...TECH.silent,
      action: "unattended.session.started",
      entityId: AUS.silent,
      newValue: { consentMode: "silent" },
    }),
    ss({
      id: "2004",
      createdAt: iso(540_000),
      ...TECH.silent,
      action: "unattended.connect",
      entityId: AUS.silent,
      newValue: { consentMode: "silent", silentReason: "Gece bakım penceresinde sunucu güncellemesi" },
    }),
  ];
}
