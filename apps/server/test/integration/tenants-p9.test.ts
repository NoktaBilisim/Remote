// P9 Super Admin firma yönetimi, firma geçişi ve tenant ayarları (AC-70, AC-4, AC-115 tenant pasif, AC-145 servis yolu,
// mimari-e10 §3.4 revokeForTenant). Gerçek MySQL + inject; canlı oda testi gerçek dinleyen sunucu + WS ile.
import type { SwitchTenantResponse, TenantItem, TenantListResponse, TenantSettingsView } from "@remote/contracts/api/tenants";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSupportSessionRow, createTenant, createUser, loginRequest, makeApp, testDb, type Session } from "../helpers/app.ts";
import { signIn } from "../helpers/auth.ts";
import { createRequestRow } from "../helpers/requests.ts";
import { admitted, startLive, techSession, type Live } from "../helpers/signal-flow.ts";
import { newId, sha256Hex } from "../../src/lib/ids.ts";

let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(() => app.close());

const db = () => testDb();
let ipSeq = 0;
const nextIp = () => `10.8.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const call = (s: Session, method: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: object, a: FastifyInstance = app) =>
  a.inject({ method, url: `/api/v1${url}`, headers: s.headers, ...(payload === undefined ? {} : { payload }) });

const superAdmin = async () => signIn(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }), nextIp());
const slug = () => `p9-${newId().toLowerCase().slice(-10)}`;

describe("AC-70 firma CRUD (Super Admin)", () => {
  it("AC-70: oluşturma → 201, ayar satırı ve sistem aydınlatma metni v1 aynı TX'te, audit; kısa ad çakışması 409; geçersiz girdi 400", async () => {
    const sa = await superAdmin();
    const s1 = slug();
    const res = await call(sa, "POST", "/admin/tenants", { name: "  Acme Bilişim ", slug: s1 });
    expect(res.statusCode).toBe(201);
    const t = res.json<TenantItem>();
    expect(t).toMatchObject({ name: "Acme Bilişim", slug: s1, status: "ACTIVE", activeUserCount: 0 });
    expect(await db().tenantSettings.findUnique({ where: { tenantId: t.id } })).toMatchObject({ sessionTtlMin: 15 });
    const consent = await db().consentText.findFirstOrThrow({ where: { tenantId: t.id, isCurrent: true } });
    expect(consent).toMatchObject({ version: 1, createdBy: null });
    expect(consent.body).toContain("Acme Bilişim");
    expect(consent.sha256).toBe(sha256Hex(consent.body));
    expect(await db().auditLog.count({ where: { entityId: t.id, action: "tenant.created" } })).toBe(1);
    const dup = await call(sa, "POST", "/admin/tenants", { name: "Başka", slug: s1 });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.fields).toHaveProperty("slug");
    for (const bad of [
      { name: "A", slug: slug() },
      { name: "Firma", slug: "Büyük Harf" },
      { name: "Firma", slug: "-tire" },
      { name: "Firma" },
      { name: "Firma", slug: slug(), x: 1 },
    ]) {
      expect((await call(sa, "POST", "/admin/tenants", bad)).statusCode).toBe(400);
    }
  });

  it("AC-70: liste sayfalı/filtreli (üst 100), detay, düzenleme (+audit eski → yeni); bilinmeyen id 404", async () => {
    const sa = await superAdmin();
    const t = (await call(sa, "POST", "/admin/tenants", { name: "Liste Firması", slug: slug() })).json<TenantItem>();
    const list = (await call(sa, "GET", `/admin/tenants?q=${encodeURIComponent("Liste Firm")}&pageSize=100`)).json<TenantListResponse>();
    expect(list.items.map((i) => i.id)).toContain(t.id);
    expect((await call(sa, "GET", "/admin/tenants?pageSize=101")).statusCode).toBe(400);
    expect((await call(sa, "GET", "/admin/tenants?q=yokboylebirfirma")).json<TenantListResponse>()).toMatchObject({ items: [], total: 0 });
    expect((await call(sa, "GET", `/admin/tenants/${t.id}`)).json<TenantItem>().id).toBe(t.id);
    const s2 = slug();
    const upd = await call(sa, "PATCH", `/admin/tenants/${t.id}`, { name: "Yeni Ad", slug: s2 });
    expect(upd.json<TenantItem>()).toMatchObject({ name: "Yeni Ad", slug: s2 });
    const a = await db().auditLog.findFirstOrThrow({ where: { entityId: t.id, action: "tenant.updated" } });
    expect(a.oldValue).toMatchObject({ name: "Liste Firması" });
    expect(a.newValue).toEqual({ name: "Yeni Ad", slug: s2 });
    expect((await call(sa, "PATCH", `/admin/tenants/${t.id}`, {})).statusCode).toBe(400);
    expect((await call(sa, "GET", `/admin/tenants/${newId()}`)).statusCode).toBe(404);
    expect((await call(sa, "POST", `/admin/tenants/${newId()}/deactivate`, {})).statusCode).toBe(404);
  });
});

describe("AC-70 firma geçişi", () => {
  it("AC-70: Super Admin firmaya geçer (/auth/me actingTenant, /users o firmanın), audit; pasif/yok firma 404; null ile çıkar → tenant uçları 403", async () => {
    const sa = await superAdmin();
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id, role: "USER" });
    expect((await call(sa, "GET", "/users")).statusCode).toBe(403);
    const sw = await call(sa, "POST", "/admin/switch-tenant", { tenantId: t.id });
    expect(sw.statusCode).toBe(200);
    expect(sw.json<SwitchTenantResponse>().actingTenant).toMatchObject({ id: t.id, slug: t.slug });
    expect((await call(sa, "GET", "/auth/me")).json()).toMatchObject({ actingTenant: { id: t.id } });
    expect((await call(sa, "GET", "/users")).body).toContain(u.id);
    const audit = await db().auditLog.findFirstOrThrow({ where: { tenantId: t.id, action: "tenant.switched" } });
    expect(audit).toMatchObject({ entity: "auth_sessions", oldValue: { actingTenantId: null }, newValue: { actingTenantId: t.id } });
    const passive = await createTenant("PASSIVE");
    expect((await call(sa, "POST", "/admin/switch-tenant", { tenantId: passive.id })).statusCode).toBe(404);
    expect((await call(sa, "POST", "/admin/switch-tenant", { tenantId: newId() })).statusCode).toBe(404);
    expect((await call(sa, "POST", "/admin/switch-tenant", { tenantId: "x" })).statusCode).toBe(400);
    expect((await call(sa, "POST", "/admin/switch-tenant", { tenantId: null })).json<SwitchTenantResponse>()).toEqual({
      actingTenant: null,
    });
    expect((await call(sa, "GET", "/users")).statusCode).toBe(403);
  });
});

describe("AC-70 firma pasife alma", () => {
  let live: Live | undefined;
  afterEach(async () => {
    await live?.close();
    live = undefined;
  });

  it("AC-70/AC-145: pasif firmanın kullanıcıları giriş yapamaz, açık oturumları iptal; bekleyen kod oturumu CANCELLED(tenant_passive); bekleyen talep TENANT_PASSIVE; kayıt geçersiz; 409; reactivate", async () => {
    const sa = await superAdmin();
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const as = await signIn(app, admin, nextIp());
    const pending = await createSupportSessionRow({ tenantId: t.id, technicianId: admin.id });
    const done = await createSupportSessionRow({ tenantId: t.id, technicianId: admin.id, status: "ENDED" });
    const reqRow = await createRequestRow(t.id);
    const binding = await db().deviceBinding.create({
      data: {
        id: newId(),
        tenantId: t.id,
        keyHash: sha256Hex(newId()),
        clientVersion: "0.10.0",
        firstSessionId: done.id,
        lastSessionId: done.id,
        lastUsedAt: new Date(),
      },
    });

    const res = await call(sa, "POST", `/admin/tenants/${t.id}/deactivate`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json<TenantItem>().status).toBe("PASSIVE");
    expect((await call(as, "GET", "/auth/me")).statusCode).toBe(401);
    expect(await db().authSession.count({ where: { userId: admin.id, revokedAt: null } })).toBe(0);
    expect((await app.inject(loginRequest(admin.email, admin.password, { remoteAddress: "10.7.0.1" }))).statusCode).toBe(401);
    expect(await db().supportSession.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({
      status: "CANCELLED",
      endedBy: "SYSTEM",
      endReason: "tenant_passive",
      activeCode: null,
    });
    expect(await db().supportRequest.findUniqueOrThrow({ where: { id: reqRow.id } })).toMatchObject({
      status: "CANCELLED",
      cancelReason: "TENANT_PASSIVE",
    });
    expect(await db().deviceBinding.findUniqueOrThrow({ where: { id: binding.id } })).toMatchObject({
      revokeReason: "TENANT_PASSIVE",
      keyHash: null,
    });
    const audit = await db().auditLog.findFirstOrThrow({ where: { entityId: t.id, action: "tenant.deactivated" } });
    expect(audit.newValue).toMatchObject({ status: "PASSIVE", revokedSessions: 1, cancelledSessions: 1 });
    expect((await call(sa, "POST", `/admin/tenants/${t.id}/deactivate`, {})).statusCode).toBe(409);
    expect((await call(sa, "POST", `/admin/tenants/${t.id}/reactivate`, {})).json<TenantItem>().status).toBe("ACTIVE");
    expect((await app.inject(loginRequest(admin.email, admin.password, { remoteAddress: "10.7.0.2" }))).statusCode).toBe(200);
    expect((await call(sa, "POST", `/admin/tenants/${t.id}/reactivate`, {})).statusCode).toBe(409);
  });

  it("AC-70/AC-115: pasife almada etkin oturum 5 sn içinde biter — iki tarafa session.ended{tenant_passive}, DB ENDED", async () => {
    live = await startLive();
    const t = await techSession(live);
    const g = await admitted(live, t);
    const sa = await signIn(live.app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }), nextIp());
    expect((await call(sa, "POST", `/admin/tenants/${t.tenantId}/deactivate`, {}, live.app)).statusCode).toBe(200);
    expect((await g.guest.waitFor("session.ended", 5000)).reason).toBe("tenant_passive");
    expect((await t.ws.waitFor("session.ended", 5000)).reason).toBe("tenant_passive");
    expect(await db().supportSession.findUniqueOrThrow({ where: { id: t.sessionId } })).toMatchObject({
      status: "ENDED",
      endedBy: "SYSTEM",
      endReason: "tenant_passive",
    });
    expect(live.app.rooms.size).toBe(0);
  });
});

describe("AC-4 tenant ayarları", () => {
  it("AC-4: session_ttl_min 15–30 dışı → 400 fields.sessionTtlMin; aralık içi kaydedilir + audit eski → yeni; diğer aralıklar da 400", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const s = await signIn(app, admin, nextIp());
    expect((await call(s, "GET", "/settings/tenant")).json<TenantSettingsView>()).toEqual({
      logoUrl: null,
      sessionTtlMin: 15,
      maxOpenSessions: 3,
      maxActiveHours: 4,
      maxFileMb: 100,
      retentionDays: 365,
      requireTech2fa: true,
      mfaRememberDevice: true, // P27a (AC-331): varsayılan açık
      smtp: null,
      fileServerMode: false, // P28b (AC-354): varsayılan P2P
      fileRetentionDays: 1,
      avReady: expect.any(Boolean), // serial-system-settings dışında ClamAV satırı yok → false
      storage: { usedBytes: 0, quotaBytes: 20 * 1024 ** 3 },
    });
    for (const v of [14, 31, 20.5, "20"]) {
      const r = await call(s, "PUT", "/settings/tenant", { sessionTtlMin: v });
      expect(r.statusCode, String(v)).toBe(400);
      expect(r.json().error.fields).toHaveProperty("sessionTtlMin");
    }
    for (const bad of [{ maxOpenSessions: 11 }, { maxActiveHours: 0 }, { maxFileMb: 2049 }, { retentionDays: 89 }, {}, { smtpHost: "x" }]) {
      expect((await call(s, "PUT", "/settings/tenant", bad)).statusCode).toBe(400);
    }
    const ok = await call(s, "PUT", "/settings/tenant", { sessionTtlMin: 30, maxOpenSessions: 3 });
    expect(ok.json<TenantSettingsView>()).toMatchObject({ sessionTtlMin: 30, maxOpenSessions: 3 });
    const audit = await db().auditLog.findFirstOrThrow({ where: { tenantId: t.id, action: "tenant_settings.updated" } });
    expect(audit.oldValue).toEqual({ sessionTtlMin: 15 });
    expect(audit.newValue).toEqual({ sessionTtlMin: 30 });
    // yeni oturum yeni TTL ile
    const tech = await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.create": true } });
    const created = await call(await signIn(app, tech, nextIp()), "POST", "/sessions", {});
    const row = await db().supportSession.findUniqueOrThrow({ where: { id: created.json<{ id: string }>().id } });
    expect(Math.round((row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000)).toBe(30);
  });

  it("AC-4: settings.view / settings.edit yoksa 403; Super Admin firma seçmeden 403", async () => {
    const t = await createTenant();
    const viewer = await createUser({ tenantId: t.id, role: "USER", perms: { "settings.view": true } });
    const vs = await signIn(app, viewer, nextIp());
    expect((await call(vs, "GET", "/settings/tenant")).statusCode).toBe(200);
    expect((await call(vs, "PUT", "/settings/tenant", { sessionTtlMin: 20 })).statusCode).toBe(403);
    const none = await createUser({ tenantId: t.id, role: "USER" });
    expect((await call(await signIn(app, none, nextIp()), "GET", "/settings/tenant")).statusCode).toBe(403);
    expect((await call(await superAdmin(), "GET", "/settings/tenant")).statusCode).toBe(403);
  });
});
