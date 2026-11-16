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
