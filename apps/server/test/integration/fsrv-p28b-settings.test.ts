// P28b K3 — ClamAV ayarı (Super Admin), tenant Dosyalar ayarı, kota, /health clamav ve D-r2-1 (av ağından gelen istek reddi).
// `system_settings.clamav` satırını yazar (tüm uygulamaların paylaştığı satır) → serial-system-settings projesinde; sonunda silinir.
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLAMAV_HOST_NOT_ALLOWED_MESSAGE, CLAMAV_TEST_MESSAGES, CLAMAV_TEST_PER_MIN } from "@remote/contracts/api/clamav";
import { FSRV_AUDIT, TENANT_AUDIT } from "@remote/contracts/audit";
import { AV_CIDR, startFakeClamd, type FakeClamd } from "../helpers/fake-clamd.ts";
import { createTenant, createUser, loginAs, loginStepUp, makeApp, testDb, testFixtureDb, type Session } from "../helpers/app.ts";

let app: FastifyInstance;
let fake: FakeClamd;
let sa: Session;

const clearRow = () => testFixtureDb().systemSetting.deleteMany({ where: { key: "clamav" } });

beforeAll(async () => {
  fake = await startFakeClamd();
  app = makeApp({
    env: fake.env(),
    fsrvTest: {
      ...fake.test,
      lookupAll: async (h) =>
        h === "clamav.test" || h === "10.89.0.10" ? ["10.89.0.10"] : h === "outside.test" ? ["10.89.0.10", "192.168.5.5"] : ["127.0.0.1"],
    },
  });
  await app.ready();
  await clearRow();
  sa = await loginStepUp(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
});
afterAll(async () => {
  await clearRow();
  await app.close();
  await fake.close();
});
beforeEach(() => {
  fake.mode = "ok";
  fake.signatureAgeMs = 3_600_000;
});

const testAv = (payload: object = {}, s: Session = sa) =>
  app.inject({ method: "POST", url: "/api/v1/admin/settings/clamav/test", headers: s.headers, payload });

describe("AC-353 ClamAV ayarı ve testi (Super Admin)", () => {
  it("AC-353 GET env kaynağı; PUT CIDR dışı / loopback / bir adresi dışarıda host → 400 HOST_NOT_ALLOWED; uygun host kaydedilir + audit", async () => {
    const g = await app.inject({ method: "GET", url: "/api/v1/admin/settings/clamav", headers: sa.headers });
    expect(g.statusCode).toBe(200);
    expect(g.json()).toMatchObject({ host: "clamav.test", port: fake.port, source: "env", lastTest: null });
    for (const host of ["localhost", "outside.test", "127.0.0.1"]) {
      const r = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings/clamav",
        headers: sa.headers,
        payload: { host, port: 3310 },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toMatchObject({ code: "HOST_NOT_ALLOWED", fields: { host: CLAMAV_HOST_NOT_ALLOWED_MESSAGE } });
    }
    const ok = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/settings/clamav",
      headers: sa.headers,
      payload: { host: "10.89.0.10", port: fake.port },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ host: "10.89.0.10", source: "panel", lastTest: null });
    expect(await testDb().auditLog.count({ where: { action: FSRV_AUDIT.CLAMAV_UPDATED, userId: { not: null } } })).toBeGreaterThan(0);
  });

  it("AC-353 test: PONG + EICAR + şifreli zip → ok; lastTest yazılır (kayıtlı hedef); audit settings.clamav.test", async () => {
    const r = await testAv();
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, eicarDetected: true, encryptedDetected: true, signatureAgeDays: 0, stale: false });
    const g = await app.inject({ method: "GET", url: "/api/v1/admin/settings/clamav", headers: sa.headers });
    expect(g.json().lastTest).toMatchObject({ ok: true });
    expect(await testDb().auditLog.count({ where: { action: FSRV_AUDIT.CLAMAV_TEST } })).toBeGreaterThan(0);
  });

  it("AC-353 şifreli arşiv algılaması kapalı → ok:false + 'Şifreli arşiv algılaması kapalı'; erişilemeyen → unreachable metni", async () => {
    fake.mode = "noEncrypted";
    const r = await testAv();
    expect(r.json()).toMatchObject({
      ok: false,
      eicarDetected: true,
      encryptedDetected: false,
      message: CLAMAV_TEST_MESSAGES.encrypted_off,
    });
    const down = await testAv({ host: "10.89.0.10", port: 9 });
    expect(down.json()).toMatchObject({ ok: false, message: CLAMAV_TEST_MESSAGES.unreachable });
    fake.mode = "ok";
    await testAv(); // lastTest yeniden ok
  });

  it("AC-361 imza yaşı > 3 gün → stale:true (test + /health); /health HTTP 200 kalır", async () => {
    fake.signatureAgeMs = 4 * 86_400_000;
    const r = await testAv();
    expect(r.json()).toMatchObject({ ok: true, signatureAgeDays: 4, stale: true });
    await app.fsrv.scanner.poll();
    const h = await app.inject({ method: "GET", url: "/health" });
    expect(h.statusCode).toBe(200);
    expect(h.json()).toMatchObject({ status: "ok", clamav: { configured: true, reachable: true, signatureAgeDays: 4, stale: true } });
    fake.signatureAgeMs = 3_600_000;
    await app.fsrv.scanner.poll();
  });

  it("D-P28b-1 yoklamada öz-sınama yanlışlığı → lastTest ok:false (anahtar açılamaz); erişilemezlik lastTest'i değiştirmez", async () => {
    fake.mode = "noEncrypted";
    await app.fsrv.scanner.poll();
    expect(app.fsrv.scanner.misconfigured).toBe(true);
    const g = await app.inject({ method: "GET", url: "/api/v1/admin/settings/clamav", headers: sa.headers });
    expect(g.json().lastTest).toMatchObject({ ok: false, message: CLAMAV_TEST_MESSAGES.encrypted_off });
    fake.mode = "ok";
    await app.fsrv.scanner.poll();
    expect(app.fsrv.scanner.misconfigured).toBe(false);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/settings/clamav", headers: sa.headers })).json().lastTest.ok).toBe(false);
    expect((await testAv()).json().ok).toBe(true); // yalnız elle test geri getirir
  });

  it("AC-353 Admin erişemez (403); test ucu 6/dk/kullanıcı → 7. istek 429", async () => {
    const t = await createTenant();
    const admin = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/settings/clamav", headers: admin.headers })).statusCode).toBe(403);
    const other = await loginStepUp(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    for (let i = 0; i < CLAMAV_TEST_PER_MIN; i++) expect((await testAv({}, other)).statusCode).toBe(200);
    expect((await testAv({}, other)).statusCode).toBe(429);
  });
});

describe("AC-354 tenant Dosyalar ayarı (AV kapısı, aydınlatma onayı) ve AC-362 kota", () => {
  it("AC-354 lastTest başarısızken açma → 409 AV_NOT_READY; onaysız → 400 consentUpdated; onaylı → açılır + audit consentAck; görünümde avReady + storage", async () => {
    const t = await createTenant();
    const admin = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    const put = (payload: object) => app.inject({ method: "PUT", url: "/api/v1/settings/tenant", headers: admin.headers, payload });
    await testDb().systemSetting.update({
      where: { key: "clamav" },
      data: { valueJson: { host: "10.89.0.10", port: fake.port, lastTest: null } },
    });
    const notReady = await put({ fileServerMode: true, consentUpdated: true });
    expect(notReady.statusCode).toBe(409);
    expect(notReady.json().error.code).toBe("AV_NOT_READY");
    const sa2 = await loginStepUp(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" })); // sa'nın test kotası doldu
    expect((await testAv({}, sa2)).json().ok).toBe(true);
    const noConsent = await put({ fileServerMode: true });
    expect(noConsent.statusCode).toBe(400);
    expect(noConsent.json().error.fields).toHaveProperty("consentUpdated");
    const ok = await put({ fileServerMode: true, consentUpdated: true, fileRetentionDays: 3 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      fileServerMode: true,
      fileRetentionDays: 3,
      avReady: true,
      storage: { usedBytes: 0, quotaBytes: 20 * 1024 ** 3 },
    });
    const audit = await testDb().auditLog.findFirst({
      where: { tenantId: t.id, action: TENANT_AUDIT.SETTINGS_UPDATED },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.newValue).toMatchObject({ fileServerMode: true, fileRetentionDays: 3, consentAck: true });
    expect((await put({ fileRetentionDays: 8 })).statusCode).toBe(400);
    // kapatma kapısız
    expect((await put({ fileServerMode: false })).json().fileServerMode).toBe(false);
  });

  it("AC-362 Super Admin kota PATCH → audit tenant.storage_quota eski→yeni; aralık dışı 400; Admin 403", async () => {
    const t = await createTenant();
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/tenants/${t.id}`,
      headers: sa.headers,
      payload: { storageQuotaGb: 50 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ storageQuotaGb: 50, storage: { usedBytes: 0, quotaBytes: 50 * 1024 ** 3 } });
    const a = await testDb().auditLog.findFirst({ where: { tenantId: t.id, action: FSRV_AUDIT.STORAGE_QUOTA } });
    expect(a).toMatchObject({ oldValue: { storageQuotaGb: 20 }, newValue: { storageQuotaGb: 50 } });
    expect(
      (await app.inject({ method: "PATCH", url: `/api/v1/admin/tenants/${t.id}`, headers: sa.headers, payload: { storageQuotaGb: 0 } }))
        .statusCode,
    ).toBe(400);
    const admin = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    expect(
      (await app.inject({ method: "PATCH", url: `/api/v1/admin/tenants/${t.id}`, headers: admin.headers, payload: { storageQuotaGb: 60 } }))
        .statusCode,
    ).toBe(403);
  });
});

describe("D-r2-1 av alt ağından gelen istek gövde okunmadan reddedilir", () => {
  it("D-r2-1 av ağı kaynak IP'sinden /api/v1/auth/login → 404 ve audit satırı yok; /health da kapalı", async () => {
    const before = await testDb().auditLog.count();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress: "10.89.0.10",
      headers: { origin: "https://rs.test:4450", "user-agent": "veri-sizdirma" },
      payload: { login: "x@example.test", password: "y" },
    });
    expect(r.statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/health", remoteAddress: "::ffff:10.89.0.10" })).statusCode).toBe(404);
    expect(await testDb().auditLog.count({ where: { userAgent: "veri-sizdirma" } })).toBe(0);
    expect(await testDb().auditLog.count()).toBeGreaterThanOrEqual(before);
    expect(AV_CIDR).toBe("10.89.0.0/24");
  });
});
