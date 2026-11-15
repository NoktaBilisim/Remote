// E2E sahte API — kullanıcı ve firma yönetimi (P9; mimari-api "Yönetim", contracts api/users + api/tenants). Yalnız test.
// Çerez: u-us<senaryo>-<rastgele>. Senaryolar:
//   usadm   ADMIN, audit.export HARİÇ tüm yetkiler (kilitli anahtar; "Elif Yönetici" audit.export'a sahip → canManage=false)
//   usro    USER, yalnız users.view (salt okunur)
//   usempty ADMIN tüm yetkiler, kullanıcı listesi boş
//   usbroken liste ilk istekte 500 (sonra 200 → "Tekrar dene")
//   usslow  liste 1,5 sn gecikmeli (iskelet)
//   ussa    SUPER_ADMIN; firma bağlamı `switch-tenant` ile değişir (başlangıçta yok)
import { PERMISSION_KEYS } from "@remote/contracts/permissions";
import { createUserInputSchema, updateUserInputSchema } from "@remote/contracts/api/users";
import { createTenantInputSchema, switchTenantInputSchema, updateTenantInputSchema } from "@remote/contracts/api/tenants";

const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
const all = (v) => Object.fromEntries(PERMISSION_KEYS.map((k) => [k, v]));
let seq = 100;
const newId = (p) => `${p}${String(seq++).padStart(26 - p.length, "0")}`;
// Kimlikler geçerli ULID alfabesinde (I, L, O, U yok) — sayfa /users/[id] biçim denetimi yapar.
export const US = {
  SELF: "01JKS00000000000000000000A",
  CAN: "01JKS00000000000000000000B",
  ELIF: "01JKS00000000000000000000C",
  OLD: "01JKS00000000000000000000D",
};
export const TN = { DEMO: "01JTN00000000000000000000A", ACME: "01JTN00000000000000000000B", OLD: "01JTN00000000000000000000C" };

const ADMIN_NO_EXPORT = PERMISSION_KEYS.filter((k) => k !== "audit.export");

export function usersUser(cookie) {
  const m = cookie?.match(/^u-(usadm|usro|usempty|usbroken|usslow|ussa)-/);
  if (!m) return null;
  const kind = m[1];
  const role = kind === "ussa" ? "SUPER_ADMIN" : kind === "usro" ? "USER" : "ADMIN";
  const s = ustore(cookie, kind);
  const permissions = kind === "usadm" ? ADMIN_NO_EXPORT : kind === "usro" ? ["users.view", "sessions.view"] : [...PERMISSION_KEYS];
  const acting = s.acting ? s.tenants.find((x) => x.id === s.acting) : null;
  return {
    user: {
      id: US.SELF,
      email: "zeynep@ornek.com",
      username: null,
      fullName: "Zeynep Koç",
      role,
      tenantId: role === "SUPER_ADMIN" ? null : TN.DEMO,
      theme: "SYSTEM",
      mustChangePassword: false,
    },
    permissions,
    tenant: role === "SUPER_ADMIN" ? null : { id: TN.DEMO, name: "Demo Firma", slug: "demo" },
    actingTenant: acting ? { id: acting.id, name: acting.name, slug: acting.slug } : null,
    kind,
  };
}

const user = (o) => ({
  username: null,
  status: "ACTIVE",
  mustChangePassword: false,
  totpEnabled: false,
  lastLoginAt: iso(-3_600_000),
  createdAt: iso(-40 * 86_400_000),
  ...o,
});
const tenant = (o) => ({ status: "ACTIVE", activeUserCount: 3, createdAt: iso(-90 * 86_400_000), updatedAt: iso(-86_400_000), ...o });

const stores = new Map();
function ustore(cookie, kind) {
  let s = stores.get(cookie);
  if (s) return s;
  const users =
    kind === "usempty"
      ? []
      : [
          user({
            id: US.SELF,
            email: "zeynep@ornek.com",
            fullName: "Zeynep Koç",
            role: "ADMIN",
            totpEnabled: true,
            permissions: kind === "usadm" ? { ...all(true), "audit.export": false } : all(true),
          }),
          user({
            id: US.CAN,
            email: "can.aydin@ornek.com",
            fullName: "Can Aydın",
            role: "USER",
            lastLoginAt: null,
            totpEnabled: true,
            permissions: {
              ...all(false),
              "sessions.view": true,
              "sessions.create": true,
              "remote_control.use": true,
              "file_transfer.use": true,
              "session_history.view": true,
            },
          }),
          user({ id: US.ELIF, email: "elif@ornek.com", fullName: "Elif Yönetici", role: "ADMIN", permissions: all(true) }),
          user({
            id: US.OLD,
            email: "eski@ornek.com",
            fullName: "Eski Teknisyen",
            role: "USER",
            status: "PASSIVE",
            permissions: all(false),
          }),
        ];
  const tenants = [
    tenant({ id: TN.ACME, name: "Acme Bilişim", slug: "acme" }),
    tenant({ id: TN.DEMO, name: "Demo Firma", slug: "demo" }),
    tenant({ id: TN.OLD, name: "Eski Müşteri A.Ş.", slug: "eski-musteri", status: "PASSIVE", activeUserCount: 0 }),
  ];
  s = { users, tenants, acting: null, fails: new Set() };
  stores.set(cookie, s);
  return s;
}

const fieldsOf = (error) => Object.fromEntries(error.issues.map((i) => [i.path.length ? i.path.join(".") : "_", i.message]));
const fold = (v) => v.toLocaleLowerCase("tr-TR");

export async function handleUsers(req, res, { url, session, csrfOk, send, err, readJson }) {
  const path = url.split("?")[0];
  const isUsers = path === "/api/v1/users" || path.startsWith("/api/v1/users/");
  const isAdmin = path.startsWith("/api/v1/admin/");
  if (!isUsers && !isAdmin) return false;
  const who = usersUser(session);
  if (!who) return false;
  const s = ustore(session, who.kind);
  if (req.method !== "GET" && !csrfOk) return (send(res, 403, err("CSRF_INVALID", "CSRF doğrulaması başarısız.")), true);
  const can = (p) => who.permissions.includes(p);
  const q = new URLSearchParams(url.split("?")[1] ?? "");
  const own = new Set(who.permissions);
  const isSa = who.user.role === "SUPER_ADMIN";
  const canManage = (u) => isSa || Object.entries(u.permissions).every(([k, v]) => !v || own.has(k));
  const detail = (u) => ({ ...u, isSelf: u.id === US.SELF, canManage: canManage(u) });
  const listItem = (u) => {
    const d = { ...u };
    delete d.permissions;
    return d;
  };
  const grantsForeign = (perms) => !isSa && Object.entries(perms ?? {}).some(([k, v]) => v && !own.has(k));
  const foreignFields = (perms) =>
    Object.fromEntries(
      Object.entries(perms ?? {})
        .filter(([k, v]) => v && !own.has(k))
        .map(([k]) => [`permissions.${k}`, "Sahip olmadığınız yetkiyi veremezsiniz"]),
    );

  if (isAdmin) {
    if (!isSa) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    if (path === "/api/v1/admin/switch-tenant" && req.method === "POST") {
      const p = switchTenantInputSchema.safeParse(await readJson(req));
      if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
      const x = p.data.tenantId && s.tenants.find((y) => y.id === p.data.tenantId && y.status === "ACTIVE");
      if (p.data.tenantId && !x) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
      s.acting = x ? x.id : null;
      return (send(res, 200, { actingTenant: x ? { id: x.id, name: x.name, slug: x.slug } : null }), true);
    }
    if (path === "/api/v1/admin/tenants" && req.method === "GET") {
      const st = q.get("status") ?? "all";
      const k = fold(q.get("q") ?? "");
      const items = s.tenants
        .filter((x) => st === "all" || x.status === st.toUpperCase())
        .filter((x) => !k || fold(`${x.name} ${x.slug}`).includes(k))
        .sort((a, b) => a.name.localeCompare(b.name, "tr"));
      const page = Number(q.get("page") ?? 1);
      const pageSize = Number(q.get("pageSize") ?? 25);
      return (send(res, 200, { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length }), true);
    }
    if (path === "/api/v1/admin/tenants" && req.method === "POST") {
      const p = createTenantInputSchema.safeParse(await readJson(req));
      if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
      if (s.tenants.some((x) => x.slug === p.data.slug))
        return (send(res, 409, err("CONFLICT", "Çakışma", { fields: { slug: "Bu kısa ad başka bir firmada kullanılıyor" } })), true);
      const x = tenant({ id: newId("01JTN"), ...p.data, activeUserCount: 0, createdAt: iso(), updatedAt: iso() });
      s.tenants.push(x);
      return (send(res, 201, x), true);
    }
    const tm = path.match(/^\/api\/v1\/admin\/tenants\/([0-9A-Z]{26})(?:\/(deactivate|reactivate))?$/);
    if (!tm) return false;
    const x = s.tenants.find((y) => y.id === tm[1]);
    if (!x) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
    if (!tm[2] && req.method === "PATCH") {
      const p = updateTenantInputSchema.safeParse(await readJson(req));
      if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
      if (p.data.slug && s.tenants.some((y) => y.id !== x.id && y.slug === p.data.slug))
        return (send(res, 409, err("CONFLICT", "Çakışma", { fields: { slug: "Bu kısa ad başka bir firmada kullanılıyor" } })), true);
      Object.assign(x, Object.fromEntries(Object.entries(p.data).filter(([, v]) => v !== undefined)), { updatedAt: iso() });
      return (send(res, 200, x), true);
    }
    if (tm[2] && req.method === "POST") {
      const target = tm[2] === "deactivate" ? "PASSIVE" : "ACTIVE";
      if (x.status === target) return (send(res, 409, err("CONFLICT", "Durum zaten bu.")), true);
      x.status = target;
      if (target === "PASSIVE" && s.acting === x.id) s.acting = null;
      return (send(res, 204, undefined), true);
    }
    return false;
  }

  // /users — Super Admin firma bağlamı olmadan 403 (tenantScope)
  if (isSa && !s.acting) return (send(res, 403, err("FORBIDDEN", "Önce firma seçin.")), true);
  if (path === "/api/v1/users" && req.method === "GET") {
    if (!can("users.view")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    if (who.kind === "usslow") await new Promise((r) => setTimeout(r, 1500));
    if (who.kind === "usbroken" && !s.fails.has("list")) {
      s.fails.add("list");
      return (send(res, 500, err("INTERNAL", "Sunucu hatası.")), true);
    }
    const st = q.get("status") ?? "active";
    const role = q.get("role") ?? "all";
    const k = fold(q.get("q") ?? "");
    const items = s.users
      .filter((u) => st === "all" || u.status === st.toUpperCase())
      .filter((u) => role === "all" || u.role === role)
      .filter((u) => !k || fold(`${u.fullName} ${u.email}`).includes(k))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "tr"));
    const page = Number(q.get("page") ?? 1);
    const pageSize = Number(q.get("pageSize") ?? 25);
    return (
      send(res, 200, { items: items.slice((page - 1) * pageSize, page * pageSize).map(listItem), page, pageSize, total: items.length }),
      true
    );
  }
  if (path === "/api/v1/users" && req.method === "POST") {
    if (!can("users.create")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
    const p = createUserInputSchema.safeParse(await readJson(req));
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
    if (s.users.some((u) => u.email === p.data.email))
      return (send(res, 409, err("CONFLICT", "Çakışma", { fields: { email: "Bu e-posta adresi başka bir hesapta kullanılıyor" } })), true);
    const permissions = { ...all(p.data.role === "ADMIN"), ...(p.data.permissions ?? {}) };
    if (grantsForeign(permissions))
      return (send(res, 403, err("FORBIDDEN", "Sahip olmadığınız yetkiyi veremezsiniz.", { fields: foreignFields(permissions) })), true);
    const u = user({
      id: newId("01JKS"),
      email: p.data.email,
      fullName: p.data.fullName,
      role: p.data.role,
      mustChangePassword: true,
      lastLoginAt: null,
      createdAt: iso(),
      permissions,
    });
    s.users.push(u);
    // B-P9-1: sahte e2e geçici şifresi (gerçek ortamda geçerli değil, p9-users.spec doğrular) — gitleaks satır istisnası.
    return (send(res, 201, { user: detail(u), temporaryPassword: "Gx7-kP2m-Qw9r-Lt4z" }), true); // gitleaks:allow
  }
  const um = path.match(/^\/api\/v1\/users\/([0-9A-Z]{26})(?:\/(deactivate|reactivate|reset-mfa))?$/);
  if (!um) return false;
  if (!can("users.view")) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
  const u = s.users.find((y) => y.id === um[1]);
  if (!u) return (send(res, 404, err("NOT_FOUND", "Bulunamadı.")), true);
  if (!um[2] && req.method === "GET") return (send(res, 200, detail(u)), true);
  if (!can("users.edit") || !canManage(u)) return (send(res, 403, err("FORBIDDEN", "Yetkiniz yok.")), true);
  if (!um[2] && req.method === "PATCH") {
    const p = updateUserInputSchema.safeParse(await readJson(req));
    if (!p.success) return (send(res, 400, err("VALIDATION", "Doğrulama hatası", { fields: fieldsOf(p.error) })), true);
    // Sunucu (users/service.ts updateUser) ile aynı kural: anahtar başına gövde > mevcut ezme (eski rol varsayılanından
    // farklı değer) > YENİ rolün varsayılanı (roleDefaultGranted: ADMIN açık, USER kapalı). Etkin kümede değişen her
    // anahtar işlemi yapanda olmalı (assertGrantable) → değilse 403 fields["permissions.<anahtar>"].
    const role = p.data.role ?? u.role;
    const oldDef = u.role === "ADMIN";
    const after = Object.fromEntries(
      PERMISSION_KEYS.map((k) => [k, p.data.permissions?.[k] ?? (u.permissions[k] !== oldDef ? u.permissions[k] : role === "ADMIN")]),
    );
    const changed = PERMISSION_KEYS.filter((k) => after[k] !== u.permissions[k]);
    if (u.id === US.SELF && (role !== u.role || changed.length > 0))
      return (send(res, 403, err("FORBIDDEN", "Kendi rolünüzü veya yetkilerinizi değiştiremezsiniz.")), true);
    const missing = isSa ? [] : changed.filter((k) => !own.has(k));
    if (missing.length)
      return (
        send(
          res,
          403,
          err("FORBIDDEN", "Sahip olmadığınız bir yetkiyi veremez veya değiştiremezsiniz.", {
            fields: Object.fromEntries(missing.map((k) => [`permissions.${k}`, "Bu yetkiye sahip değilsiniz"])),
          }),
        ),
        true
      );
    if (p.data.email && s.users.some((y) => y.id !== u.id && y.email === p.data.email))
      return (send(res, 409, err("CONFLICT", "Çakışma", { fields: { email: "Bu e-posta adresi başka bir hesapta kullanılıyor" } })), true);
    if (p.data.fullName) u.fullName = p.data.fullName;
    if (p.data.email) u.email = p.data.email;
    u.role = role;
    u.permissions = after;
    return (send(res, 200, detail(u)), true);
  }
  // P10 (AC-115): 2FA sıfırlama
  if (um[2] === "reset-mfa" && req.method === "POST") {
    if (u.id === US.SELF) return (send(res, 403, err("FORBIDDEN", "Kendi 2FA'nızı buradan sıfırlayamazsınız.")), true);
    if (!u.totpEnabled) return (send(res, 409, err("CONFLICT", "2FA zaten kapalı.")), true);
    u.totpEnabled = false;
    return (send(res, 204, undefined), true);
  }
  if (um[2] && req.method === "POST") {
    if (u.id === US.SELF) return (send(res, 403, err("FORBIDDEN", "Kendinizi pasife alamazsınız.")), true);
    const target = um[2] === "deactivate" ? "PASSIVE" : "ACTIVE";
    if (u.status === target) return (send(res, 409, err("CONFLICT", "Durum zaten bu.")), true);
    u.status = target;
    return (send(res, 204, undefined), true);
  }
  return false;
}
