// P9 kullanıcı ve yetki yönetimi (AC-69, 71, 73, 74, 115; mimari-api "Yönetim"). Gerçek MySQL + fastify.inject;
// canlı yansıma testleri gerçek dinleyen sunucu + WS istemcileriyle (signal-flow).
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import { PERMISSION_KEYS } from "@remote/contracts/permissions";
import type { CreateUserResponse, UserDetail, UserListResponse } from "@remote/contracts/api/users";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createSupportSessionRow,
  createTenant,
  createUser,
  loginAs,
  loginRequest,
  makeApp,
  ORIGIN,
  testDb,
  type Session,
  type TestUser,
} from "../helpers/app.ts";
import { admitted, startLive, techSession, type Live } from "../helpers/signal-flow.ts";

let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(() => app.close());

const db = () => testDb();

let ipSeq = 0;
/** Her giriş ayrı test IP'sinden (IP başına 20/dk giriş sınırı bu dosyanın toplam girişine takılmasın). */
async function signIn(user: TestUser): Promise<Session> {
  const res = await app.inject(
    loginRequest(user.email, user.password, { remoteAddress: `10.9.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}` }),
  );
  if (res.statusCode !== 200) throw new Error(`login ${res.statusCode}`);
  const jar = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
  const token = jar[SESSION_COOKIE] ?? "";
  const csrf = jar[CSRF_COOKIE] ?? "";
  return { token, headers: { cookie: `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}`, "x-csrf-token": csrf, origin: ORIGIN } };
}
const ALL_TRUE = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true]));

async function tenantWithAdmin(perms?: Record<string, boolean>) {
  const t = await createTenant();
  const admin = await createUser({ tenantId: t.id, role: "ADMIN", ...(perms ? { perms } : {}) });
  return { tenantId: t.id, admin, s: await signIn(admin) };
}

const req = (s: Session, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: s.headers, ...(payload === undefined ? {} : { payload: payload as object }) });

const newEmail = () => `p9-${Math.random().toString(36).slice(2)}@example.test`;

async function create(s: Session, body: Record<string, unknown>) {
  return req(s, "POST", "/users", { email: newEmail(), fullName: "Yeni Kullanıcı", role: "USER", ...body });
}

describe("P9 kullanıcı oluşturma", () => {
  it("AC-71/AC-73: USER tümü kapalı, ADMIN tümü açık başlar; detay tanımdaki HER anahtarı içerir (sessions.terminate, support_requests.*, customers.*)", async () => {
    const { s } = await tenantWithAdmin();
    const u = (await create(s, { role: "USER" })).json<CreateUserResponse>();
    expect(Object.keys(u.user.permissions).sort()).toEqual([...PERMISSION_KEYS].sort());
    expect(Object.values(u.user.permissions).every((v) => v === false)).toBe(true);
    for (const k of ["sessions.terminate", "support_requests.view", "support_requests.accept", "customers.view", "customers.delete"])
      expect(u.user.permissions).toHaveProperty(k, false);
    const a = (await create(s, { role: "ADMIN" })).json<CreateUserResponse>();
    expect(Object.values(a.user.permissions).every((v) => v === true)).toBe(true);
    // normalize: varsayılana eşit satır saklanmaz
    expect(await db().userPermission.count({ where: { userId: { in: [u.user.id, a.user.id] } } })).toBe(0);
  });

  it("geçici şifre yalnız oluşturma yanıtında; must_change_password=1, argon2id hash, audit'te şifre yok; ilk girişte şifre değişimi zorunlu", async () => {
    const { s, tenantId } = await tenantWithAdmin();
    const email = newEmail();
    const res = await create(s, { email: email.toUpperCase(), permissions: { "sessions.view": true } });
    expect(res.statusCode).toBe(201);
    const out = res.json<CreateUserResponse>();
    expect(out.temporaryPassword).toMatch(/^[A-Za-z2-9]{16}$/);
    expect(out.user).toMatchObject({ email, role: "USER", status: "ACTIVE", mustChangePassword: true, lastLoginAt: null });
    expect(out.user.permissions["sessions.view"]).toBe(true);
    const row = await db().user.findUniqueOrThrow({ where: { id: out.user.id } });
    expect(row).toMatchObject({ tenantId, mustChangePassword: true });
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
    const detail = await req(s, "GET", `/users/${out.user.id}`);
    expect(detail.body).not.toContain(out.temporaryPassword);
    const audits = await db().auditLog.findMany({ where: { entityId: out.user.id } });
    expect(audits.map((a) => a.action).sort()).toEqual(["user.created", "user.permission_changed"]);
    expect(JSON.stringify(audits, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v))).not.toContain(out.temporaryPassword);
    const login = await app.inject(loginRequest(email, out.temporaryPassword));
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ mustChangePassword: true });
  });

  it("çift gönderim / aynı e-posta → 409 fields.email; geçersiz girdi 400 (tanımsız anahtar, SUPER_ADMIN rolü, bozuk e-posta)", async () => {
    const { s } = await tenantWithAdmin();
    const email = newEmail();
    expect((await create(s, { email })).statusCode).toBe(201);
    const dup = await create(s, { email });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.fields).toHaveProperty("email");
    const bad = await create(s, { permissions: { "yok.anahtar": true } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields).toHaveProperty(["permissions.yok.anahtar"]);
    expect((await create(s, { role: "SUPER_ADMIN" })).statusCode).toBe(400);
    expect((await create(s, { email: "abc" })).statusCode).toBe(400);
    expect((await create(s, { fullName: "A" })).statusCode).toBe(400);
    expect((await create(s, { extra: 1 })).statusCode).toBe(400);
  });

  it("AC-73: Admin sahip olmadığı yetkiyi veremez (403) — açık anahtar ya da ADMIN rolü varsayılanıyla; açıkça false gönderirse 201", async () => {
    const { s } = await tenantWithAdmin({ "audit.export": false });
    const r1 = await create(s, { permissions: { "audit.export": true } });
    expect(r1.statusCode).toBe(403);
    expect(r1.json().error.fields).toHaveProperty(["permissions.audit.export"]);
    expect((await create(s, { role: "ADMIN" })).statusCode).toBe(403);
    const ok = await create(s, { role: "ADMIN", permissions: { "audit.export": false } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json<CreateUserResponse>().user.permissions["audit.export"]).toBe(false);
    expect(
      await db().user.count({
        where: { email: { contains: "p9-" }, role: "ADMIN", permissions: { some: { permKey: "audit.export", granted: true } } },
      }),
    ).toBe(0);
  });

  it("users.create yetkisi yoksa 403; Super Admin firma seçmeden 403", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id, role: "USER", perms: { "users.view": true } });
    expect((await create(await signIn(u), {})).statusCode).toBe(403);
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    expect((await create(await signIn(sa), {})).statusCode).toBe(403);
  });
});

describe("P9 kullanıcı listesi", () => {
  it("AC-69: liste sayfalı (üst 100), filtreli; yalnız kendi tenant'ı; boş sonuç; pageSize 101 → 400; users.view yoksa 403", async () => {
    const a = await tenantWithAdmin();
    const b = await tenantWithAdmin();
    for (let i = 0; i < 3; i++) await create(a.s, { fullName: `Zeynep ${i}` });
    const passive = await createUser({ tenantId: a.tenantId, role: "USER", status: "PASSIVE" });
    const page = (await req(a.s, "GET", "/users?pageSize=2&page=1")).json<UserListResponse>();
    expect(page).toMatchObject({ page: 1, pageSize: 2, total: 4 }); // admin + 3 (pasif hariç)
    expect(page.items).toHaveLength(2);
    const all = (await req(a.s, "GET", "/users?status=all&pageSize=100")).json<UserListResponse>();
    expect(all.total).toBe(5);
    expect(all.items.map((i) => i.id)).toContain(passive.id);
    expect((await req(a.s, "GET", "/users?status=passive")).json<UserListResponse>().items.map((i) => i.id)).toEqual([passive.id]);
    expect((await req(a.s, "GET", "/users?role=ADMIN")).json<UserListResponse>().items.map((i) => i.id)).toEqual([a.admin.id]);
    expect((await req(a.s, "GET", "/users?q=zeynep")).json<UserListResponse>().total).toBe(3);
    expect((await req(a.s, "GET", "/users?q=yokboyle")).json<UserListResponse>()).toMatchObject({ items: [], total: 0 });
    expect((await req(a.s, "GET", "/users?pageSize=101")).statusCode).toBe(400);
    expect((await req(a.s, "GET", "/users?q=x")).statusCode).toBe(400);
    const bList = (await req(b.s, "GET", "/users?status=all&pageSize=100")).body;
    expect(bList).not.toContain(a.tenantId);
    expect(bList).not.toContain(a.admin.id);
    expect(bList).not.toContain(passive.id);
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    expect((await req(b.s, "GET", "/users?status=all")).body).not.toContain(sa.id);
    const plain = await createUser({ tenantId: a.tenantId, role: "USER" });
    expect((await req(await signIn(plain), "GET", "/users")).statusCode).toBe(403);
    const created = all.items.find((i) => i.id === a.admin.id);
    expect(created?.lastLoginAt).not.toBeNull();
  });

  it("Super Admin hesabı /users/:id ile görünmez (404)", async () => {
    const a = await tenantWithAdmin();
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    expect((await req(a.s, "GET", `/users/${sa.id}`)).statusCode).toBe(404);
    expect((await req(a.s, "GET", "/users/geçersiz")).statusCode).toBe(404);
  });
});

describe("P9 kullanıcı düzenleme ve yetki audit'i", () => {
  it("AC-74: her yetki değişikliği ayrı audit satırı — kim (user_id), kime (entity_id), permKey, eski → yeni; değişmeyen anahtar yazılmaz", async () => {
    const { s, admin, tenantId } = await tenantWithAdmin();
    const u = (await create(s, { permissions: { "sessions.view": true } })).json<CreateUserResponse>().user;
    const res = await req(s, "PATCH", `/users/${u.id}`, {
      permissions: { ...u.permissions, "sessions.view": false, "remote_control.use": true, "audit.view": true },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json<UserDetail>();
    expect(d.permissions).toMatchObject({ "sessions.view": false, "remote_control.use": true, "audit.view": true });
    const rows = await db().auditLog.findMany({ where: { entityId: u.id, action: "user.permission_changed" }, orderBy: { id: "asc" } });
    const changes = rows
      .slice(1)
      .map((r) => ({ old: r.oldValue, next: r.newValue, userId: r.userId, tenantId: r.tenantId, entity: r.entity }));
    expect(changes).toEqual([
      {
        old: { permKey: "sessions.view", granted: true },
        next: { permKey: "sessions.view", granted: false },
        userId: admin.id,
        tenantId,
        entity: "users",
      },
      {
        old: { permKey: "remote_control.use", granted: false },
        next: { permKey: "remote_control.use", granted: true },
        userId: admin.id,
        tenantId,
        entity: "users",
      },
      {
        old: { permKey: "audit.view", granted: false },
        next: { permKey: "audit.view", granted: true },
        userId: admin.id,
        tenantId,
        entity: "users",
      },
    ]);
    // aynı harita tekrar → değişiklik yok, yeni satır yok
    await req(s, "PATCH", `/users/${u.id}`, { permissions: d.permissions });
    expect(await db().auditLog.count({ where: { entityId: u.id, action: "user.permission_changed" } })).toBe(4);
  });

  it("AC-74: rol değişimi user.updated (eski → yeni rol) + etkin kümede değişen her anahtar için permission_changed", async () => {
    const { s } = await tenantWithAdmin();
    const u = (await create(s, {})).json<CreateUserResponse>().user;
    const res = await req(s, "PATCH", `/users/${u.id}`, { role: "ADMIN", fullName: "Terfi Eden" });
    expect(res.json<UserDetail>()).toMatchObject({ role: "ADMIN", fullName: "Terfi Eden" });
    const upd = await db().auditLog.findFirstOrThrow({ where: { entityId: u.id, action: "user.updated" } });
    expect(upd.oldValue).toEqual({ role: "USER", fullName: "Yeni Kullanıcı" });
    expect(upd.newValue).toEqual({ role: "ADMIN", fullName: "Terfi Eden" });
    expect(await db().auditLog.count({ where: { entityId: u.id, action: "user.permission_changed" } })).toBe(PERMISSION_KEYS.length);
  });

  it("AC-73: PATCH ile sahip olunmayan yetkiyi verme / değiştirme 403; Admin kendinden geniş yetkili hesabı yönetemez (canManage=false, PATCH/pasif 403)", async () => {
    const { s, tenantId } = await tenantWithAdmin({ "audit.export": false });
    const u = (await create(s, {})).json<CreateUserResponse>().user;
    expect((await req(s, "PATCH", `/users/${u.id}`, { permissions: { "audit.export": true } })).statusCode).toBe(403);
    expect((await req(s, "PATCH", `/users/${u.id}`, { role: "ADMIN" })).statusCode).toBe(403);
    expect((await req(s, "PATCH", `/users/${u.id}`, { role: "ADMIN", permissions: { "audit.export": false } })).statusCode).toBe(200);
    const strong = await createUser({ tenantId, role: "ADMIN" });
    const detail = (await req(s, "GET", `/users/${strong.id}`)).json<UserDetail>();
    expect(detail).toMatchObject({ canManage: false, isSelf: false });
    expect((await req(s, "PATCH", `/users/${strong.id}`, { fullName: "Değişmez" })).statusCode).toBe(403);
    expect((await req(s, "POST", `/users/${strong.id}/deactivate`, {})).statusCode).toBe(403);
    expect((await db().user.findUniqueOrThrow({ where: { id: strong.id } })).status).toBe("ACTIVE");
  });

  it("kendi hesabı: rol/yetki değiştirilemez ve pasife alınamaz (403); ad değişimi ve değişmeyen tam harita serbest", async () => {
    const { s, admin } = await tenantWithAdmin();
    expect((await req(s, "PATCH", `/users/${admin.id}`, { role: "USER" })).statusCode).toBe(403);
    expect((await req(s, "PATCH", `/users/${admin.id}`, { permissions: { "audit.view": false } })).statusCode).toBe(403);
    const ok = await req(s, "PATCH", `/users/${admin.id}`, { fullName: "Kendi Adım", permissions: ALL_TRUE });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<UserDetail>()).toMatchObject({ fullName: "Kendi Adım", isSelf: true, canManage: true });
    expect((await req(s, "POST", `/users/${admin.id}/deactivate`, {})).statusCode).toBe(403);
  });

  it("PATCH: boş gövde 400, e-posta çakışması 409, users.edit yoksa 403", async () => {
    const { s, tenantId } = await tenantWithAdmin();
    const u = (await create(s, {})).json<CreateUserResponse>().user;
    const other = (await create(s, {})).json<CreateUserResponse>().user;
    expect((await req(s, "PATCH", `/users/${u.id}`, {})).statusCode).toBe(400);
    expect((await req(s, "PATCH", `/users/${u.id}`, { email: other.email })).statusCode).toBe(409);
    const viewer = await createUser({ tenantId, role: "USER", perms: { "users.view": true } });
    expect((await req(await signIn(viewer), "PATCH", `/users/${u.id}`, { fullName: "X Y" })).statusCode).toBe(403);
  });
});

describe("P9 pasife alma / yeniden etkinleştirme", () => {
  it("AC-115/AC-65: pasife alınan kullanıcının oturumları iptal (401), giriş yapamaz, bekleyen kod oturumu CANCELLED(auth_revoked); tekrar → 409; reactivate → giriş açılır", async () => {
    const { s, tenantId } = await tenantWithAdmin();
    const u = await createUser({ tenantId, role: "USER", perms: { "sessions.view": true } });
    const us = await signIn(u);
    const fresh = makeApp(); // giriş denemeleri ayrı IP kovasında (20/dk; dosyadaki diğer girişlerden bağımsız)
    await fresh.ready();
    const pending = await createSupportSessionRow({ tenantId, technicianId: u.id });
    const res = await req(s, "POST", `/users/${u.id}/deactivate`);
    expect(res.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: us.headers })).statusCode).toBe(401);
    expect((await fresh.inject(loginRequest(u.email, u.password))).statusCode).toBe(401);
    expect(await db().supportSession.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({
      status: "CANCELLED",
      endedBy: "SYSTEM",
      endReason: "auth_revoked",
      activeCode: null,
    });
    const audit = await db().auditLog.findFirstOrThrow({ where: { entityId: u.id, action: "user.deactivated" } });
    expect(audit.newValue).toMatchObject({ status: "PASSIVE", revokedSessions: 1, cancelledSessions: 1 });
    expect((await req(s, "POST", `/users/${u.id}/deactivate`, {})).statusCode).toBe(409);
    expect((await req(s, "POST", `/users/${u.id}/reactivate`, {})).statusCode).toBe(204);
    expect((await fresh.inject(loginRequest(u.email, u.password))).statusCode).toBe(200);
    expect((await req(s, "POST", `/users/${u.id}/reactivate`, {})).statusCode).toBe(409);
    await fresh.close();
  });
});

describe("P9 canlı yansıma (AC-115, G-04)", () => {
  let live: Live | undefined;
  afterEach(async () => {
    await live?.close();
    live = undefined;
  });

  async function liveAdmin(l: Live, tenantId: string): Promise<{ admin: TestUser; s: Session }> {
    const admin = await createUser({ tenantId, role: "ADMIN" });
    return { admin, s: await loginAs(l.app, admin) };
  }
  const call = (l: Live, s: Session, method: "POST" | "PATCH", url: string, payload: object) =>
    l.app.inject({ method, url: `/api/v1${url}`, headers: s.headers, payload });

  it("AC-115: teknisyen pasife alınınca etkin oturum 5 sn içinde biter — iki tarafa session.ended{auth_revoked}, teknisyen 4401, DB ENDED", async () => {
    live = await startLive();
    const t = await techSession(live);
    const g = await admitted(live, t);
    const { s } = await liveAdmin(live, t.tenantId);
    expect((await call(live, s, "POST", `/users/${t.tech.id}/deactivate`, {})).statusCode).toBe(204);
    expect((await g.guest.waitFor("session.ended", 5000)).reason).toBe("auth_revoked");
    expect((await t.ws.waitFor("session.ended", 5000)).reason).toBe("auth_revoked");
    expect((await t.ws.closed).code).toBe(4401);
    expect(await db().supportSession.findUniqueOrThrow({ where: { id: t.sessionId } })).toMatchObject({
      status: "ENDED",
      endReason: "auth_revoked",
    });
  });

  it("AC-115: file_transfer.use kaldırılınca caps.update; remote_control.use kaldırılınca caps daralır; oturum sürer", async () => {
    live = await startLive();
    const t = await techSession(live);
    const g = await admitted(live, t);
    expect(g.hello.caps).toEqual(expect.arrayContaining(["file_transfer", "remote_control"]));
    const { s } = await liveAdmin(live, t.tenantId);
    expect((await call(live, s, "PATCH", `/users/${t.tech.id}`, { permissions: { "file_transfer.use": false } })).statusCode).toBe(200);
    const u1 = await g.guest.waitFor("caps.update", 5000);
    expect(u1.caps).not.toContain("file_transfer");
    expect(u1.caps).toContain("remote_control");
    expect((await call(live, s, "PATCH", `/users/${t.tech.id}`, { permissions: { "remote_control.use": false } })).statusCode).toBe(200);
    const u2 = await g.guest.waitFor("caps.update", 5000);
    expect(u2.caps).toEqual([]);
    expect(live.app.rooms.size).toBe(1);
  });

  it("AC-115: rol değişimi teknisyenin odalarını sonlandırır (auth_revoked)", async () => {
    live = await startLive();
    const t = await techSession(live);
    const g = await admitted(live, t);
    const { s } = await liveAdmin(live, t.tenantId);
    expect((await call(live, s, "PATCH", `/users/${t.tech.id}`, { role: "ADMIN" })).statusCode).toBe(200);
    expect((await g.guest.waitFor("session.ended", 5000)).reason).toBe("auth_revoked");
  });
});
