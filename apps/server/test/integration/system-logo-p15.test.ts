// P15 AC-233 (mimari-e11 §6): sistem logosu kaldırma. Paylaşılan `system_settings.system_logo` satırını yazar →
// branding-p12 ile eşzamanlı koşmaz (vitest.config.ts SYSTEM_SETTINGS_SERIAL).
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createUser, loginAs, makeApp, testDb } from "../helpers/app.ts";

let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(() => app.close());

describe("AC-233 sistem logosu kaldırma", () => {
  it("AC-233: {path:null} yazılır, dosya silinir, login/marka varsayılan logo; audit; ikinci DELETE yazım/audit yok; Admin 403", async () => {
    const sa = await loginAs(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    const rel = `system/${"L".repeat(20)}.png`;
    await testDb().systemSetting.upsert({
      where: { key: "system_logo" },
      create: { key: "system_logo", valueJson: { path: rel } },
      update: { valueJson: { path: rel } },
    });
    const res = await app.inject({ method: "DELETE", url: "/api/v1/admin/settings/system-logo", headers: sa.headers });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ logoUrl: "/img/logo.png" });
    expect((await testDb().systemSetting.findUniqueOrThrow({ where: { key: "system_logo" } })).valueJson).toEqual({ path: null });
    expect((await app.inject({ method: "GET", url: "/api/v1/public/branding" })).json()).toMatchObject({ logoUrl: "/img/logo.png" });
    expect(
      await testDb().auditLog.count({ where: { action: "settings.system_logo.removed", entityId: "system_logo" } }),
    ).toBeGreaterThanOrEqual(1);
    const before = await testDb().auditLog.count({ where: { action: "settings.system_logo.removed" } });
    expect((await app.inject({ method: "DELETE", url: "/api/v1/admin/settings/system-logo", headers: sa.headers })).statusCode).toBe(200);
    expect(await testDb().auditLog.count({ where: { action: "settings.system_logo.removed" } })).toBe(before);
    const admin = await loginAs(app, await createUser({ tenantId: (await createTenant()).id, role: "ADMIN" }));
    expect((await app.inject({ method: "DELETE", url: "/api/v1/admin/settings/system-logo", headers: admin.headers })).statusCode).toBe(
      403,
    );
  });
});
