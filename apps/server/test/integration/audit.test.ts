import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { writeAudit } from "../../src/audit/service.ts";
import { createTenant, createUser, loginAs, loginRequest, makeApp, testDb } from "../helpers/app.ts";

let app: FastifyInstance;
beforeEach(() => {
  app = makeApp();
});
afterEach(() => app.close());

describe("audit", () => {
  it("AC-75: login kaydı tüm alanları taşır; şifre hiçbir alanda yok", async () => {
    const t = await createTenant();
    const u = await createUser({ tenantId: t.id });
    await app.inject(
      loginRequest(u.email, "Yanlis-Sifre-999", {
        remoteAddress: "198.51.100.77",
        headers: { origin: "https://rs.test:4450", "user-agent": "VitestUA" },
      }),
    );
    await loginAs(app, u);
    const rows = await testDb().auditLog.findMany({ where: { userId: u.id }, orderBy: { id: "asc" } });
    expect(rows[0]).toMatchObject({
      id: expect.any(BigInt),
      createdAt: expect.any(Date),
      tenantId: t.id,
      userId: u.id,
      username: u.email,
      action: "auth.login",
      entity: "users",
      entityId: u.id,
      newValue: { reason: "invalid_credentials" },
      ipAddress: "198.51.100.77",
      userAgent: "VitestUA",
      result: "fail",
      correlationId: expect.stringMatching(/^[0-9A-Z]{26}$/),
    });
    expect(rows[1]).toMatchObject({ action: "auth.login", result: "success" });
    expect(JSON.stringify(rows, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v))).not.toMatch(
      /Yanlis-Sifre-999|Dogru-Sifre-123/,
    );
  });

  it("AC-75: writeAudit gizli değerleri DB'ye *** olarak yazar, perm_key açık kalır", async () => {
    const t = await createTenant();
    await writeAudit(
      testDb(),
      { ip: "192.0.2.1", userAgent: "x", requestId: "01JTESTAUDIT00000000000000" },
      {
        tenantId: t.id,
        action: "settings.updated",
        entity: "tenant_settings",
        entityId: t.id,
        oldValue: { smtpPassword: "eski-gizli", perm_key: "audit.view" },
        newValue: { smtpPassword: "yeni-gizli", turnCredential: "c", ticket: "t", perm_key: "audit.view", host: "smtp.example.test" },
        result: "success",
      },
    );
    const row = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: t.id, action: "settings.updated" } });
    expect(row.oldValue).toEqual({ smtpPassword: "***", perm_key: "audit.view" });
    expect(row.newValue).toEqual({
      smtpPassword: "***",
      turnCredential: "***",
      ticket: "***",
      perm_key: "audit.view",
      host: "smtp.example.test",
    });
  });
});
