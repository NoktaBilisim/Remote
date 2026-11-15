// E2E sahte API — P16 (AC-241 kullanıcı kalıcı silme, AC-242 firma silme işi, S16-1 maskeli audit). Yalnız test.
// Sözleşme: contracts api/{users,tenants,audit}.ts (mimari-e11 §7.5). Çerez: u-p16<senaryo>-<rastgele>. Senaryolar:
//   p16adm   ADMIN (users.view/edit/delete, audit.view). Kullanıcılar: Pelin Pasif (PASSIVE, silinebilir), Ahmet Aktif
//            (ACTIVE → "önce pasife alın"), Oya Oturumlu (PASSIVE, açık oturum → 409). Silme ilk istekte 401
//            MFA_STEP_UP_REQUIRED; POST /auth/step-up TOTP "123456" → 5 dk.
//   p16sa    SUPER_ADMIN. Firmalar: Eski Ticaret (40 g pasif, silinebilir), Yeni Pasif (5 g → "Silinebilir: <tarih>"),
//            Aktif Firma, Koşan Firma (RUNNING; her GET bir adım ilerler, 3. GET'te DONE + firma satırı silinir),
//            Hatalı Firma (FAILED). Açık işler bantta. GET /audit: canlı + maskeli (silinmiş kullanıcı) + silinmiş firma satırı.
//   p16sabrk SUPER_ADMIN, Eski Ticaret için silme durumu 500 (kısmi durum).
//   p16sa0   SUPER_ADMIN, açık iş yok (bant görünmez).
//   p16admnd ADMIN, users.delete YOK (AC-237: "Kalıcı sil" düğmesi görünmez; DELETE 403). Kullanıcılar p16adm ile aynı.
import { stepUpInputSchema } from "@remote/contracts/api/auth";
import { confirmNameMatches, deleteUserInputSchema, parseUserIfMatch } from "@remote/contracts/api/users";
import { TENANT_PURGE_STEPS, TENANT_REACTIVATE_PURGE_SCHEDULED_MESSAGE, tenantPurgeInputSchema } from "@remote/contracts/api/tenants";
import { PERMISSION_KEYS } from "@remote/contracts/permissions";

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const TENANT = { id: "01JTNP1600000000000000000A", name: "Demo Firma", slug: "demo" };
const SELF = "01JMSP1600000000000000000A";
export const P16 = {
  PELIN: "01JMSP1600000000000000000B",
  AHMET: "01JMSP1600000000000000000C",
  OYA: "01JMSP1600000000000000000D",
  T_OLD: "01JTNP1600000000000000000B",
  T_NEW: "01JTNP1600000000000000000C",
  T_ACT: "01JTNP1600000000000000000D",
  T_RUN: "01JTNP1600000000000000000E",
  T_FAIL: "01JTNP1600000000000000000F",
};

export function p16User(cookie) {
  const m = cookie?.match(/^u-(p16admnd|p16adm|p16sa|p16sabrk|p16sa0)-/);
  if (!m) return null;
  const kind = m[1];
  const sa = kind !== "p16adm" && kind !== "p16admnd";
  return {
    kind,
    user: {
      id: SELF,
      email: sa ? "kurucu@ornek.com" : "admin@ornek.com",
      username: null,
      fullName: sa ? "Kurucu Yönetici" : "Ada Yönetici",
      role: sa ? "SUPER_ADMIN" : "ADMIN",
      tenantId: sa ? null : TENANT.id,
      theme: "SYSTEM",
      mustChangePassword: false,
    },
    permissions: sa
      ? ["audit.view"]
      : kind === "p16admnd"
        ? ["users.view", "users.edit", "audit.view"]
        : ["users.view", "users.edit", "users.delete", "audit.view"],
    tenant: sa ? null : TENANT,
    actingTenant: null,
    mfa: { enabled: true, required: true, stage: "ok", recoveryCodesLeft: 10 },
  };
}

const perms = (v) => Object.fromEntries(PERMISSION_KEYS.map((k) => [k, v]));
const user = (o) => ({
  username: null,
  role: "USER",
  mustChangePassword: false,
  totpEnabled: false,
  avatarUrl: null,
  lastLoginAt: null,
  createdAt: iso(Date.now() - 90 * DAY),
  version: 3,
  permissions: perms(false),
  isSelf: false,
  canManage: true,
  ...o,
});
const tenant = (o) => ({
  status: "PASSIVE",
  activeUserCount: 0,
  createdAt: iso(Date.now() - 400 * DAY),
  updatedAt: iso(Date.now() - DAY),
  passiveSince: null,
  purge: null,
  ...o,
});
const status = (o) => ({
  step: "FENCE",
  stepIndex: 0,
  stepCount: TENANT_PURGE_STEPS.length,
  counts: {},
  attempts: 0,
  lastError: null,
  startedAt: null,
  heartbeatAt: null,
  finishedAt: null,
  cancelledAt: null,
  ...o,
});
/** Nesneden anahtarları çıkarır (yanıt izdüşümü). */
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const stepAt = (i) => ({ step: TENANT_PURGE_STEPS[i], stepIndex: i });

const stores = new Map();
function store(cookie, kind) {
  let s = stores.get(cookie);
  if (s) return s;
  const now = Date.now();
  s = {
    stepUpUntil: 0,
    users: [
      user({ id: SELF, email: "admin@ornek.com", fullName: "Ada Yönetici", role: "ADMIN", status: "ACTIVE", isSelf: true }),
      user({ id: P16.PELIN, email: "pelin@ornek.com", fullName: "Pelin Pasif", status: "PASSIVE" }),
      user({ id: P16.AHMET, email: "ahmet@ornek.com", fullName: "Ahmet Aktif", status: "ACTIVE" }),
      user({ id: P16.OYA, email: "oya@ornek.com", fullName: "Oya Oturumlu", status: "PASSIVE", openSession: true }),
    ],
    tenants: [
      tenant({ id: P16.T_OLD, name: "Eski Ticaret A.Ş.", slug: "eski-ticaret", passiveSince: iso(now - 40 * DAY) }),
      tenant({ id: P16.T_NEW, name: "Yeni Pasif Ltd.", slug: "yeni-pasif", passiveSince: iso(now - 5 * DAY) }),
      tenant({ id: P16.T_ACT, name: "Aktif Firma", slug: "aktif", status: "ACTIVE", activeUserCount: 4 }),
      ...(kind === "p16sa0"
        ? []
        : [
            tenant({ id: P16.T_RUN, name: "Koşan Firma", slug: "kosan", passiveSince: iso(now - 60 * DAY) }),
            tenant({ id: P16.T_FAIL, name: "Hatalı Firma", slug: "hatali", passiveSince: iso(now - 70 * DAY) }),
          ]),
    ],
    jobs:
      kind === "p16sa0"
        ? {}
        : {
            [P16.T_RUN]: status({
              jobId: "01JJOBP1600000000000000RUN",
              state: "RUNNING",
              ...stepAt(13),
              scheduledFor: iso(now - DAY),
              startedAt: iso(now - 600_000),
              heartbeatAt: iso(now - 5_000),
              counts: { SESSIONS: 120, USERS: 3 },
            }),
            [P16.T_FAIL]: status({
              jobId: "01JJOBP160000000000000FAIL",
              state: "FAILED",
              ...stepAt(9),
              scheduledFor: iso(now - 2 * DAY),
              startedAt: iso(now - DAY),
              attempts: 3,
              lastError: "db_fk",
            }),
          },
    previews: new Map(),
    seq: 0,
  };
  stores.set(cookie, s);
  return s;
}

const badge = (j) =>
  j && ["SCHEDULED", "RUNNING", "FAILED"].includes(j.state) ? { state: j.state, scheduledFor: j.scheduledFor, step: j.step } : null;

const auditItems = () => {
  const now = Date.now();
  const base = { ipAddress: "198.51.100.7", userAgent: "Mozilla/5.0", avatarUrl: null, result: "success", identityMasked: false };
  return [
    {
      ...base,
      id: "01JAUDP1600000000000000001",
      createdAt: iso(now - 60_000),
      tenantId: TENANT.id,
      tenantName: TENANT.name,
      tenantLabel: TENANT.name,
      userId: SELF,
      username: "kurucu@ornek.com",
      userFullName: "Kurucu Yönetici",
      actorLabel: "Kurucu Yönetici",
      action: "tenant.purge_scheduled",
      entity: "tenants",
      entityId: P16.T_OLD,
      oldValue: null,
      newValue: { jobId: "01JJOB", scheduledFor: iso(now + DAY) },
    },
    {
      ...base,
      id: "01JAUDP1600000000000000002",
      createdAt: iso(now - 3_600_000),
      tenantId: TENANT.id,
      tenantName: TENANT.name,
      tenantLabel: TENANT.name,
      userId: "01JMSP16000000000000DE1E7E",
      username: "p***@***",
      userFullName: "Silinmiş kullanıcı #DE1E7E",
      actorLabel: "Silinmiş kullanıcı #DE1E7E",
      identityMasked: true,
      action: "auth.login",
      entity: "users",
      entityId: "01JMSP16000000000000DE1E7E",
      oldValue: null,
      newValue: { email: "***", fullName: "***" },
    },
    {
      ...base,
      id: "01JAUDP1600000000000000003",
      createdAt: iso(now - 7_200_000),
      tenantId: "01JTNP16000000000000AB12CD",
      tenantName: null,
      tenantLabel: "Silinmiş firma #AB12CD",
      userId: null,
      username: "system",
      userFullName: null,
      actorLabel: null,
      identityMasked: true,
      action: "tenant.purged",
      entity: "tenants",
      entityId: "01JTNP16000000000000AB12CD",
      oldValue: null,
      newValue: { jobId: "01JJOBX", counts: { USERS: 2 } },
    },
  ];
};

/** true → istek işlendi. */
export async function handleP16(req, res, { url, session, csrfOk, send, err, readJson }) {
  const who = p16User(session);
  if (!who) return false;
  const [path] = url.split("?");
  const s = store(session, who.kind);
  const m = req.method;
  const ok = (status, body, headers = {}) => (send(res, status, body, [], { "Cache-Control": "no-store", ...headers }), true);
  if (m === "GET" && path === "/api/v1/auth/me") return ok(200, who);
  if (m !== "GET" && !csrfOk) return ok(403, err("CSRF_INVALID", "CSRF doğrulaması başarısız."));
  const sa = who.user.role === "SUPER_ADMIN";
  const needStepUp = () =>
    Date.now() > s.stepUpUntil && ok(401, err("MFA_STEP_UP_REQUIRED", "Bu işlem için kimliğinizi yeniden doğrulayın."));

  if (m === "POST" && path === "/api/v1/auth/step-up") {
    const p = stepUpInputSchema.safeParse(await readJson(req));
    if (!p.success || p.data.code !== "123456") return ok(400, err("VALIDATION", "Doğrulama hatası", { fields: { code: "Kod hatalı" } }));
    s.stepUpUntil = Date.now() + 300_000;
    return ok(200, { stepUpUntil: iso(s.stepUpUntil), method: p.data.method });
  }

  // ---- Kullanıcılar (ADMIN) ----
  if (!sa && m === "GET" && path === "/api/v1/users") {
    const items = s.users.map((u) => omit(u, ["permissions", "version", "isSelf", "canManage", "openSession"]));
    return ok(200, { items, page: 1, pageSize: 25, total: items.length });
  }
  const um = path.match(/^\/api\/v1\/users\/([0-9A-Z]{26})$/);
  if (!sa && um) {
    const u = s.users.find((x) => x.id === um[1]);
    if (!u) return ok(404, err("NOT_FOUND", "Bulunamadı."));
    if (m === "GET") {
      return ok(200, omit(u, ["openSession"]));
    }
    if (m === "DELETE") {
      if (!who.permissions.includes("users.delete")) return ok(403, err("FORBIDDEN", "Bu işlem için yetkiniz yok."));
      const su = needStepUp();
      if (su) return su;
      const v = parseUserIfMatch(req.headers["if-match"]);
      if (v === null) return ok(428, err("PRECONDITION_REQUIRED", "If-Match gerekli."));
      if (v !== u.version) return ok(409, err("STALE_WRITE", "Kayıt değişti."));
      const p = deleteUserInputSchema.safeParse(await readJson(req));
      if (u.status === "ACTIVE") return ok(409, err("CONFLICT", "Önce kullanıcıyı pasife alın"));
      if (u.openSession) return ok(409, err("CONFLICT", "Kullanıcının açık destek oturumu var; oturum kapanınca tekrar deneyin"));
      if (!p.success || !confirmNameMatches(p.data.confirmName, u.fullName))
        return ok(400, err("VALIDATION", "Doğrulama hatası", { fields: { confirmName: "Yazdığınız ad kullanıcının adıyla eşleşmiyor" } }));
      s.users = s.users.filter((x) => x.id !== u.id);
      return (send(res, 204, undefined), true);
    }
  }

  // ---- Firmalar ve silme işi (SUPER_ADMIN) ----
  if (sa && m === "GET" && path === "/api/v1/admin/tenants") {
    const items = s.tenants.map((x) => ({ ...x, purge: badge(s.jobs[x.id]) }));
    return ok(200, { items, page: 1, pageSize: 25, total: items.length });
  }
  if (sa && m === "GET" && path === "/api/v1/admin/purge-jobs") {
    const items = Object.entries(s.jobs)
      .filter(([, j]) => ["SCHEDULED", "RUNNING", "FAILED"].includes(j.state))
      .map(([tid, j]) => ({
        jobId: j.jobId,
        tenantId: tid,
        tenantName: s.tenants.find((x) => x.id === tid)?.name ?? null,
        state: j.state,
        scheduledFor: j.scheduledFor,
      }));
    return ok(200, { items });
  }
  const tm = path.match(/^\/api\/v1\/admin\/tenants\/([0-9A-Z]{26})(\/purge|\/reactivate)?$/);
  if (sa && tm) {
    const id = tm[1];
    const tn = s.tenants.find((x) => x.id === id);
    const job = s.jobs[id];
    if (!tm[2] && m === "GET") return tn ? ok(200, { ...tn, purge: badge(job) }) : ok(404, err("NOT_FOUND", "Bulunamadı."));
    if (tm[2] === "/reactivate" && m === "POST") {
      if (job?.state === "SCHEDULED") return ok(409, err("CONFLICT", TENANT_REACTIVATE_PURGE_SCHEDULED_MESSAGE));
      if (!tn) return ok(404, err("NOT_FOUND", "Bulunamadı."));
      tn.status = "ACTIVE";
      tn.passiveSince = null;
      return ok(200, tn);
    }
    if (tm[2] !== "/purge") return false;
    if (m === "GET") {
      if (who.kind === "p16sabrk" && id === P16.T_OLD) return ok(500, err("INTERNAL", "Sunucu hatası."));
      if (!job) return ok(404, err("NOT_FOUND", "Silme işi yok."));
      if (job.state === "RUNNING") {
        // Her yoklamada ilerler: 13 → 14 → 16 (DONE) + firma satırı silinir
        const next = Math.min(job.stepIndex + (job.stepIndex >= 14 ? 2 : 1), TENANT_PURGE_STEPS.length - 1);
        Object.assign(job, stepAt(next), { heartbeatAt: iso(Date.now()) });
        if (next === TENANT_PURGE_STEPS.length - 1) {
          Object.assign(job, { state: "DONE", finishedAt: iso(Date.now()) });
          s.tenants = s.tenants.filter((x) => x.id !== id);
        }
      }
      return ok(200, job);
    }
    if (m === "DELETE") {
      const su = needStepUp();
      if (su) return su;
      if (!job) return ok(404, err("NOT_FOUND", "Silme işi yok."));
      if (job.state !== "SCHEDULED") return ok(409, err("CONFLICT", "Yalnız başlamamış (zamanlanmış) silme işi iptal edilebilir."));
      Object.assign(job, { state: "CANCELLED", cancelledAt: iso(Date.now()) });
      return ok(200, { jobId: job.jobId, state: "CANCELLED" });
    }
    if (m === "POST") {
      const p = tenantPurgeInputSchema.safeParse(await readJson(req));
      if (!p.success) {
        const fields = Object.fromEntries(p.error.issues.map((i) => [i.path.join("."), i.message]));
        return ok(400, err("VALIDATION", "Doğrulama hatası", { fields }));
      }
      if (!tn) return ok(404, err("NOT_FOUND", "Bulunamadı."));
      if (tn.status !== "PASSIVE")
        return ok(409, err("PURGE_NOT_ELIGIBLE", "Firma henüz kalıcı silinemez.", { fields: { reason: "not_passive" } }));
      const eligibleAt = Date.parse(tn.passiveSince) + 30 * DAY;
      if (eligibleAt > Date.now())
        return ok(409, err("PURGE_NOT_ELIGIBLE", "Firma henüz kalıcı silinemez.", { fields: { eligibleAt: iso(eligibleAt) } }));
      if (job && ["SCHEDULED", "RUNNING"].includes(job.state))
        return ok(409, err("CONFLICT", "Bu firma için açık bir silme işi var.", { fields: { jobId: job.jobId, state: job.state } }));
      if (p.data.dryRun) {
        const previewId = `pv-${id}-${++s.seq}-e2etestonly`;
        s.previews.set(previewId, { used: false, tenantId: id });
        return ok(200, {
          previewId,
          expiresAt: iso(Date.now() + 15 * 60_000),
          tenant: { id, name: tn.name },
          passiveSince: tn.passiveSince,
          eligibleAt: iso(eligibleAt),
          counts: { SESSION_FILES: 12, SESSIONS: 340, REQUESTS: 95, CUSTOMERS: 18, USERS: 6 },
          files: { count: 27, bytes: 15_728_640 },
          auditRetained: 4210,
        });
      }
      const su = needStepUp();
      if (su) return su;
      const pv = s.previews.get(p.data.previewId);
      if (!pv || pv.used || pv.tenantId !== id)
        return ok(428, err("PREVIEW_REQUIRED", "Önizlemenin süresi doldu ya da geçersiz; önizlemeyi yeniden alın."));
      if (!confirmNameMatches(p.data.confirmName, tn.name))
        return ok(400, err("VALIDATION", "Doğrulama hatası", { fields: { confirmName: "Yazdığınız ad firma adıyla eşleşmiyor" } }));
      pv.used = true;
      if (job?.state === "FAILED") {
        Object.assign(job, { state: "RUNNING", attempts: 0, lastError: null });
        return ok(202, { jobId: job.jobId, state: "RUNNING", scheduledFor: job.scheduledFor });
      }
      const scheduledFor = iso(Date.now() + 24 * 3_600_000);
      s.jobs[id] = status({ jobId: `01JJOBP16NEW${String(s.seq).padStart(14, "0")}`, state: "SCHEDULED", scheduledFor });
      return ok(202, { jobId: s.jobs[id].jobId, state: "SCHEDULED", scheduledFor });
    }
  }

  // ---- Audit ----
  if (m === "GET" && path === "/api/v1/audit") return ok(200, { items: auditItems(), nextCursor: null });
  return false;
}
