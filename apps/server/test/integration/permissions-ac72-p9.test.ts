// AC-72 (P9): yetki listesi koddaki TEK `permissions` tanımından üretilir — tanıma geçici bir modül eklenince başka
// hiçbir değişiklik yapmadan kullanıcı detayında (toggle ekranının kaynağı) görünür, PATCH ile verilebilir, audit'e girer
// ve rol varsayılanına (ADMIN açık, USER kapalı) uyar. Geçici modül yalnız bu dosyada `vi.mock` ile eklenir.
import { vi } from "vitest";

vi.mock("@remote/contracts/permissions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@remote/contracts/permissions")>();
  const PERMISSION_MODULES = [
    ...real.PERMISSION_MODULES,
    { key: "p9_gecici", actions: ["view", "use"] },
  ] as unknown as typeof real.PERMISSION_MODULES;
  const PERMISSION_KEYS = real.permissionKeysOf(PERMISSION_MODULES);
  return {
    ...real,
    PERMISSION_MODULES,
    PERMISSION_KEYS,
    effectivePermissions: (
      role: Parameters<typeof real.effectivePermissions>[0],
      overrides: Parameters<typeof real.effectivePermissions>[1],
    ) => real.effectivePermissionsFrom(PERMISSION_KEYS, role, overrides),
  };
});

import type { CreateUserResponse, UserDetail } from "@remote/contracts/api/users";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createUser, loginAs, makeApp, testDb } from "../helpers/app.ts";

let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(() => app.close());

describe("AC-72 tek tanım", () => {
  it("AC-72: permissions'a eklenen geçici anahtar başka değişiklik olmadan listede görünür, verilir, audit'e girer; ADMIN'de varsayılan açık", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const s = await loginAs(app, admin);
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: s.headers });
    expect(me.json<{ permissions: string[] }>().permissions).toEqual(expect.arrayContaining(["p9_gecici.view", "p9_gecici.use"]));

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: s.headers,
      payload: { email: `ac72-${t.id.toLowerCase()}@example.test`, fullName: "Geçici Anahtar", role: "USER" },
    });
    expect(res.statusCode).toBe(201);
    const u = res.json<CreateUserResponse>().user;
    expect(u.permissions).toMatchObject({ "p9_gecici.view": false, "p9_gecici.use": false });

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${u.id}`,
      headers: s.headers,
      payload: { permissions: { "p9_gecici.use": true } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<UserDetail>().permissions).toMatchObject({ "p9_gecici.use": true, "p9_gecici.view": false });
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { entityId: u.id, action: "user.permission_changed" } });
    expect(audit.newValue).toEqual({ permKey: "p9_gecici.use", granted: true });

    const a2 = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: s.headers,
      payload: { email: `ac72a-${t.id.toLowerCase()}@example.test`, fullName: "Geçici Admin", role: "ADMIN" },
    });
    expect(a2.json<CreateUserResponse>().user.permissions).toMatchObject({ "p9_gecici.view": true, "p9_gecici.use": true });
  });
});
