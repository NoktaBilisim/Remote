// P27a-K4: hatırlanan cihazların kullanıcı/firma/ayar tarafı (mimari-p27a §3.3, §3.4, §4; AC-328, AC-330, AC-331, AC-334).
// Gerçek MySQL + fastify.inject. Satırlar doğrudan repo ile üretilir (verify akışı K3'ün testlerinde).
import type { TenantSettingsView } from "@remote/contracts/api/tenants";
import type { ForgetDevicesResponse, UserDetail } from "@remote/contracts/api/users";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTrustedDevice, deleteExpired } from "../../src/auth/trusted-device-repo.ts";
import { hashTrustedDeviceSecret, newTrustedDeviceSecret } from "../../src/auth/trusted-device.ts";
import { replay } from "../../src/cli/erasure.ts";
import { ErasureLedger } from "../../src/ops/erasure-ledger.ts";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTenant, createUser, loginStepUp, makeApp, testDb, testFixtureDb, type Session, type TestUser } from "../helpers/app.ts";
import { signIn } from "../helpers/auth.ts";

let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(() => app.close());

const db = () => testDb();
let ipSeq = 0;
const nextIp = () => `10.27.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

const call = (s: Session, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: s.headers, ...(payload === undefined ? {} : { payload: payload as object }) });

async function remember(userId: string, now = new Date()): Promise<string> {
  const r = await db().$transaction((tx) =>
    createTrustedDevice(tx, {
      userId,
      tokenHash: hashTrustedDeviceSecret(newTrustedDeviceSecret()),
      uaSummary: "Chrome · Windows",
      ip: "203.0.113.7",
      now,
    }),
  );
  return r.id;
}
const devices = (where: { userId?: string; tenantId?: string }) => db().trustedDevice.count({ where });

async function tenantWithAdmin() {
  const t = await createTenant();
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const user = await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.view": true } });
  return { tenantId: t.id, admin, user, s: await signIn(app, admin, nextIp()) };
}

async function lastAudit(action: string, entityId: string) {
  return db().auditLog.findFirstOrThrow({ where: { action, entityId }, orderBy: { id: "desc" } });
}

describe("P27a-K4 AC-328 geçersiz kılma noktaları (kullanıcı/firma/ayar)", () => {
  it("AC-328 Admin 2FA sıfırlaması kullanıcının tüm cihazlarını aynı TX'te siler; audit user.mfa_reset revokedTrustedDevices", async () => {
    const { user, s } = await tenantWithAdmin();
    await db().user.update({ where: { id: user.id }, data: { totpEnabled: true, totpSecretEnc: new Uint8Array(40) } });
    await remember(user.id);
    await remember(user.id);
    const r = await call(s, "POST", `/users/${user.id}/reset-mfa`, {});
    expect(r.statusCode, r.body).toBe(204);
    expect(await devices({ userId: user.id })).toBe(0);
    const a = await db().auditLog.findFirstOrThrow({ where: { entityId: user.id, action: { contains: "mfa_reset" } } });
    expect(a.newValue).toMatchObject({ mfaEnabled: false, revokedTrustedDevices: 2 });
  });

  it("AC-328 kullanıcı pasife alınınca cihazlar silinir; audit user.deactivated revokedTrustedDevices; başka kullanıcınınki kalır", async () => {
    const { admin, user, s } = await tenantWithAdmin();
    await remember(user.id);
    const other = await createUser({ tenantId: admin.tenantId, role: "USER" });
    await remember(other.id);
    expect((await call(s, "POST", `/users/${user.id}/deactivate`, {})).statusCode).toBe(204);
    expect(await devices({ userId: user.id })).toBe(0);
    expect(await devices({ userId: other.id })).toBe(1);
    expect((await lastAudit("user.deactivated", user.id)).newValue).toMatchObject({ status: "PASSIVE", revokedTrustedDevices: 1 });
  });

  it("AC-328 firma pasife alınınca firmanın tüm cihazları silinir; audit tenant.deactivated revokedTrustedDevices; başka firma etkilenmez", async () => {
    const a = await tenantWithAdmin();
    const b = await tenantWithAdmin();
    await remember(a.admin.id);
    await remember(a.user.id);
    await remember(b.user.id);
    const sa = await signIn(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }), nextIp());
    expect((await call(sa, "POST", `/admin/tenants/${a.tenantId}/deactivate`, {})).statusCode).toBe(200);
    expect(await devices({ tenantId: a.tenantId })).toBe(0);
    expect(await devices({ tenantId: b.tenantId })).toBe(1);
    expect((await lastAudit("tenant.deactivated", a.tenantId)).newValue).toMatchObject({ status: "PASSIVE", revokedTrustedDevices: 2 });
  });
});

describe("P27a-K4 AC-331 firma ayarı mfaRememberDevice", () => {
  it("AC-331 varsayılan açık; kapatınca firmanın tüm cihazları silinir + audit eski→yeni ve sayı; açmak eskileri geri getirmez", async () => {
    const a = await tenantWithAdmin();
    const b = await tenantWithAdmin();
    await remember(a.admin.id);
    await remember(a.user.id);
    await remember(b.user.id);
    expect((await call(a.s, "GET", "/settings/tenant")).json<TenantSettingsView>().mfaRememberDevice).toBe(true);
    const off = await call(a.s, "PUT", "/settings/tenant", { mfaRememberDevice: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json<TenantSettingsView>().mfaRememberDevice).toBe(false);
    expect(await devices({ tenantId: a.tenantId })).toBe(0);
    expect(await devices({ tenantId: b.tenantId })).toBe(1);
    const audit = await db().auditLog.findFirstOrThrow({
      where: { tenantId: a.tenantId, action: "tenant_settings.updated" },
      orderBy: { id: "desc" },
    });
    expect(audit.oldValue).toEqual({ mfaRememberDevice: true });
    expect(audit.newValue).toEqual({ mfaRememberDevice: false, revokedTrustedDevices: 2 });
    // Aynı değer → yazma/audit yok; yeniden açma cihazları geri getirmez ve silme yapmaz.
    expect((await call(a.s, "PUT", "/settings/tenant", { mfaRememberDevice: false })).statusCode).toBe(200);
    expect(await db().auditLog.count({ where: { tenantId: a.tenantId, action: "tenant_settings.updated" } })).toBe(1);
    await remember(a.user.id); // (kapalıyken oluşmaz — K3; burada yalnız açmanın silmediğini sınar)
    const on = await call(a.s, "PUT", "/settings/tenant", { mfaRememberDevice: true });
    expect(on.json<TenantSettingsView>().mfaRememberDevice).toBe(true);
    expect(await devices({ tenantId: a.tenantId })).toBe(1);
    const last = await db().auditLog.findFirstOrThrow({
      where: { tenantId: a.tenantId, action: "tenant_settings.updated" },
      orderBy: { id: "desc" },
    });
    expect(last.newValue).toEqual({ mfaRememberDevice: true });
  });

  it("AC-331 settings.edit olmayan 403; geçersiz tip 400", async () => {
    const t = await createTenant();
    const viewer = await createUser({ tenantId: t.id, role: "USER", perms: { "settings.view": true } });
    const vs = await signIn(app, viewer, nextIp());
    expect((await call(vs, "PUT", "/settings/tenant", { mfaRememberDevice: false })).statusCode).toBe(403);
    const { s } = await tenantWithAdmin();
    expect((await call(s, "PUT", "/settings/tenant", { mfaRememberDevice: "no" })).statusCode).toBe(400);
  });
});

describe("P27a-K4 AC-330 Admin: sayı + tümünü kaldır", () => {
  it("AC-330 GET /users/:id trustedDeviceCount yalnız süresi dolmamışları sayar; forget-devices hepsini siler + audit admin", async () => {
    const { admin, user, s } = await tenantWithAdmin();
    await remember(user.id);
    await remember(user.id);
    // Süresi dolmuş satır (31 gün önce oluşturulmuş): sayıya girmez, silmede sayılır.
    await remember(user.id, new Date(Date.now() - 31 * 86_400_000));
    expect((await call(s, "GET", `/users/${user.id}`)).json<UserDetail>().trustedDeviceCount).toBe(2);
    const r = await call(s, "POST", `/users/${user.id}/forget-devices`, {});
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json<ForgetDevicesResponse>()).toEqual({ revoked: 3 });
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(await devices({ userId: user.id })).toBe(0);
    expect((await call(s, "GET", `/users/${user.id}`)).json<UserDetail>().trustedDeviceCount).toBe(0);
    const a = await lastAudit("auth.trusted_device_revoked", user.id);
    expect(a).toMatchObject({ userId: admin.id, entity: "users", result: "success", newValue: { reason: "admin", count: 3 } });
    // Çift gönderim: 0 cihazda da 200 (idempotent), sürüm değişmez.
    const again = await call(s, "POST", `/users/${user.id}/forget-devices`, {});
    expect(again.json<ForgetDevicesResponse>()).toEqual({ revoked: 0 });
  });

  it("AC-330 kendi hesabı 403 (+ fail audit), başka firma 404, daha geniş yetkili 403, users.edit yok 403, gövde fazlası 400", async () => {
    const { admin, s } = await tenantWithAdmin();
    await remember(admin.id);
    expect((await call(s, "POST", `/users/${admin.id}/forget-devices`, {})).statusCode).toBe(403);
    expect(await devices({ userId: admin.id })).toBe(1);
    const fail = await db().auditLog.findFirstOrThrow({ where: { entityId: admin.id, result: "fail" }, orderBy: { id: "desc" } });
    expect(fail.newValue).toMatchObject({ op: "forget_devices" });

    const other = await tenantWithAdmin();
    await remember(other.user.id);
    expect((await call(s, "POST", `/users/${other.user.id}/forget-devices`, {})).statusCode).toBe(404);
    expect(await devices({ userId: other.user.id })).toBe(1);

    // users.edit'li ama dar yetkili Admin → tam yetkili Admin'i yönetemez.
    const narrow = await createUser({ tenantId: admin.tenantId, role: "USER", perms: { "users.view": true, "users.edit": true } });
    const ns = await signIn(app, narrow, nextIp());
    expect((await call(ns, "POST", `/users/${admin.id}/forget-devices`, {})).statusCode).toBe(403);
    const viewer = await createUser({ tenantId: admin.tenantId, role: "USER", perms: { "users.view": true } });
    const vs = await signIn(app, viewer, nextIp());
    expect((await call(vs, "POST", `/users/${narrow.id}/forget-devices`, {})).statusCode).toBe(403);
    expect((await call(s, "POST", `/users/${narrow.id}/forget-devices`, { all: true })).statusCode).toBe(400);
  });
});

describe("P27a-K4 AC-334 veri yaşam döngüsü", () => {
  it("AC-334 saklama işi süresi dolmuşları siler (sayaç trustedDevices), geçerlileri bırakır", async () => {
    const { user } = await tenantWithAdmin();
    const live = await remember(user.id);
    const old = await remember(user.id, new Date(Date.now() - 31 * 86_400_000));
    // Saklama işi seri projede (retention-p13a-job: trustedDevices sayacı); burada global adımın repo işlevi.
    expect(await deleteExpired(db(), new Date(), 5000)).toBeGreaterThanOrEqual(1);
    expect(await db().trustedDevice.count({ where: { id: old } })).toBe(0);
    expect(await db().trustedDevice.count({ where: { id: live } })).toBe(1);
  });

  it("AC-334 kullanıcı kalıcı silme (purgeTx) kalan cihaz satırlarını da siler (savunma)", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const gone: TestUser = await createUser({ tenantId: t.id, role: "USER", status: "PASSIVE" });
    await remember(gone.id); // pasif geçişi atlanmış (eski veri) satır
    const s = await loginStepUp(app, admin);
    const etag = (await call(s, "GET", `/users/${gone.id}`)).headers.etag as string;
    const r = await app.inject({
      method: "DELETE",
      url: `/api/v1/users/${gone.id}`,
      headers: { ...s.headers, "if-match": etag },
      payload: { confirmName: "Test Kullanıcı" },
    });
    expect(r.statusCode, r.body).toBe(204);
    expect(await devices({ userId: gone.id })).toBe(0);
    expect((await db().user.findUniqueOrThrow({ where: { id: gone.id } })).status).toBe("DELETED");
  });

  it("AC-334 KVKK erasure:replay kullanıcının cihaz satırlarını siler", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.view": true } });
    await remember(u.id);
    const path = join(await mkdtemp(join(tmpdir(), "rs-ledger-p27a-")), "erasure-ledger.jsonl");
    await new ErasureLedger(path).append({ type: "user", id: u.id, at: new Date().toISOString() });
    expect((await replay(testFixtureDb(), path)).users).toBe(1);
    expect(await devices({ userId: u.id })).toBe(0);
  });
});
