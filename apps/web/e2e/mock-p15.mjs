// E2E sahte API — P15 (AC-232 Super Admin şifre sıfırlama, AC-235 talep engelleri). Yalnız test.
// Çerez: u-p15<senaryo>-<rastgele>. Senaryolar:
//   p15sa     SUPER_ADMIN; 3 Super Admin (kendisi + etkin + pasif). Sıfırlama ilk istekte 401 MFA_STEP_UP_REQUIRED;
//             POST /auth/step-up TOTP "123456" → 5 dk. Geçici şifre "Gecici-Sifre-9Xk2".
//   p15sa1    SUPER_ADMIN, tek Super Admin (yalnız kendisi) → boş durum (CLI yolu)
//   p15sabrk  SUPER_ADMIN, liste ilk GET'te 500 (sonra 200 → "Tekrar dene")
//   p15bl     ADMIN, support_requests.block; 2 etkin + 1 süresi dolmuş engel
//   p15blempty ADMIN, engel yok · p15blbrk ADMIN, liste ilk GET'te 500 · p15blfull ADMIN, used = max
//   p15blno   USER, block yetkisi yok
import { stepUpInputSchema } from "@remote/contracts/api/auth";
import { REQUEST_BLOCKS_MAX, REQUEST_BLOCK_EXISTS_MESSAGE, createRequestBlockInputSchema } from "@remote/contracts/api/request-blocks";

const TENANT = { id: "01JTENP1500000000000000001", name: "Demo Firma" };
const SELF = "01JUSP1500000000000000000A";
const iso = (ms) => new Date(ms).toISOString();
const fieldsOf = (error) => Object.fromEntries(error.issues.map((i) => [i.path.join("."), i.message]));

export function p15User(cookie) {
  const m = cookie?.match(/^u-(p15sa|p15sa1|p15sabrk|p15bl|p15blempty|p15blbrk|p15blfull|p15blno)-/);
  if (!m) return null;
  const kind = m[1];
  const sa = kind.startsWith("p15sa");
  return {
    kind,
    user: {
      id: SELF,
      email: sa ? "kurucu@ornek.com" : "admin@ornek.com",
      username: null,
      fullName: sa ? "Kurucu Yönetici" : "Ada Yönetici",
      role: sa ? "SUPER_ADMIN" : kind === "p15blno" ? "USER" : "ADMIN",
      tenantId: sa ? null : TENANT.id,
      theme: "SYSTEM",
      mustChangePassword: false,
    },
    // support_requests.view /ws/panel açar (bu sahte modülde yok) → verilmez
    permissions: sa ? [] : kind === "p15blno" ? ["sessions.view"] : ["sessions.view", "support_requests.block"],
    tenant: sa ? null : TENANT,
    actingTenant: null,
    mfa: { enabled: true, required: true, stage: "ok", recoveryCodesLeft: 10 },
  };
}

const stores = new Map();
function store(cookie, kind) {
  let s = stores.get(cookie);
  if (s) return s;
  const now = Date.now();
  const by = { id: SELF, fullName: "Ada Yönetici" };
  s = {
    stepUpUntil: 0,
    listHits: 0,
    blocks:
      kind === "p15bl" || kind === "p15blfull"
        ? [
            {
              id: "01JBLK0000000000000000000A",
              kind: "IP",
              cidr: "203.0.113.7/32",
              deviceFingerprint: null,
              expiresAt: iso(now + 86_400_000),
              expired: false,
              note: "Tekrarlayan sahte talep",
              createdAt: iso(now - 3_600_000),
              createdBy: by,
            },
            {
              id: "01JBLK0000000000000000000B",
              kind: "DEVICE",
              cidr: null,
              deviceFingerprint: "a1b2c3d4",
              expiresAt: null,
              expired: false,
              note: null,
              createdAt: iso(now - 7_200_000),
              createdBy: by,
            },
            {
              id: "01JBLK0000000000000000000C",
              kind: "IP",
              cidr: "2001:db8::/48",
              deviceFingerprint: null,
              expiresAt: iso(now - 60_000),
              expired: true,
              note: null,
              createdAt: iso(now - 90_000_000),
              createdBy: by,
            },
          ]
        : [],
    seq: 0,
  };
  stores.set(cookie, s);
  return s;
}

const superadmins = (kind) => [
  { id: SELF, fullName: "Kurucu Yönetici", email: "kurucu@ornek.com", status: "ACTIVE", totpEnabled: true, self: true },
  ...(kind === "p15sa1"
    ? []
    : [
        {
          id: "01JUSP1500000000000000000B",
          fullName: "Burak Sistem",
          email: "burak@ornek.com",
          status: "ACTIVE",
          totpEnabled: true,
          self: false,
        },
        {
          id: "01JUSP1500000000000000000C",
          fullName: "Cem Eski",
          email: "cem@ornek.com",
          status: "PASSIVE",
          totpEnabled: false,
          self: false,
        },
      ]),
];

/** true → istek işlendi. */
export async function handleP15(req, res, { url, session, csrfOk, send, err, readJson }) {
  const who = p15User(session);
  if (!who) return false;
  const [path, qs = ""] = url.split("?");
  const q = new URLSearchParams(qs);
  const s = store(session, who.kind);
  const m = req.method;
  if (m === "GET" && path === "/api/v1/auth/me") return (send(res, 200, who), true);
  if (m !== "GET" && !csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);
  const isSa = who.user.role === "SUPER_ADMIN";

  if (m === "POST" && path === "/api/v1/auth/step-up") {
    const p = stepUpInputSchema.safeParse(await readJson(req));
    if (!p.success || p.data.code !== "123456")
      return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: { code: "Kod hatalı" } })), true);
    s.stepUpUntil = Date.now() + 300_000;
    return (send(res, 200, { stepUpUntil: iso(s.stepUpUntil), method: p.data.method }), true);
  }

  if (path === "/api/v1/admin/superadmins" && m === "GET") {
    if (!isSa) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    if (who.kind === "p15sabrk" && s.listHits++ === 0) return (send(res, 500, err("INTERNAL", "Sunucu hatası.")), true);
    return (send(res, 200, { items: superadmins(who.kind) }, [], { "Cache-Control": "no-store" }), true);
  }
  const rs = path.match(/^\/api\/v1\/admin\/superadmins\/([0-9A-Z]{26})\/reset-password$/);
  if (rs && m === "POST") {
    if (!isSa) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    if (Date.now() > s.stepUpUntil)
      return (send(res, 401, err("MFA_STEP_UP_REQUIRED", "Bu işlem için kimliğinizi yeniden doğrulayın.")), true);
    if (rs[1] === SELF) return (send(res, 403, err("FORBIDDEN", "Kendi şifrenizi bu yolla sıfırlayamazsınız.")), true);
    const t = superadmins(who.kind).find((x) => x.id === rs[1] && x.status === "ACTIVE");
    if (!t) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
    return (send(res, 200, { temporaryPassword: "Gecici-Sifre-9Xk2", revokedSessions: 2 }), true);
  }

  if (path === "/api/v1/request-blocks" || path.startsWith("/api/v1/request-blocks/")) {
    if (!who.permissions.includes("support_requests.block")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    if (m === "GET" && path === "/api/v1/request-blocks") {
      if (who.kind === "p15blbrk" && s.listHits++ === 0) return (send(res, 500, err("INTERNAL", "Sunucu hatası.")), true);
      const all = q.get("includeExpired") === "true";
      const items = s.blocks.filter((b) => all || !b.expired);
      const used = who.kind === "p15blfull" ? REQUEST_BLOCKS_MAX : s.blocks.length;
      return (
        send(res, 200, { items, page: 1, pageSize: 25, total: items.length, used, max: REQUEST_BLOCKS_MAX }, [], {
          "Cache-Control": "no-store",
        }),
        true
      );
    }
    if (m === "POST" && path === "/api/v1/request-blocks") {
      const p = createRequestBlockInputSchema.safeParse(await readJson(req));
      if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
      if (p.data.source !== "CIDR") return (send(res, 400, err("VALIDATION", "Doğrulama hatası")), true);
      if (s.blocks.some((b) => b.cidr === p.data.cidr && !b.expired))
        return (send(res, 409, err("CONFLICT", REQUEST_BLOCK_EXISTS_MESSAGE)), true);
      const now = Date.now();
      s.blocks.unshift({
        id: `01JBLKNEW${String(++s.seq).padStart(17, "0")}`,
        kind: "IP",
        cidr: p.data.cidr,
        deviceFingerprint: null,
        expiresAt: p.data.durationHours === null ? null : iso(now + p.data.durationHours * 3_600_000),
        expired: false,
        note: p.data.note ?? null,
        createdAt: iso(now),
        createdBy: { id: SELF, fullName: who.user.fullName },
      });
      return (send(res, 201, s.blocks[0]), true);
    }
    const dm = path.match(/^\/api\/v1\/request-blocks\/([0-9A-Z]{26})$/);
    if (dm && m === "DELETE") {
      const n = s.blocks.length;
      s.blocks = s.blocks.filter((b) => b.id !== dm[1]);
      return (n === s.blocks.length ? send(res, 404, err("NOT_FOUND", "Bulunamadı.")) : send(res, 204, undefined), true);
    }
  }
  return false;
}
