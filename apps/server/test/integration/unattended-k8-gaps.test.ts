// P27 kapanış — K8 sözleşme boşlukları: `GET /sessions?deviceId=` (cihaz ayrıntısı "son 20 gözetimsiz oturum", AC-275) ve
// `GET /users/options?unattendedGrantable=1` (yetki ekranı, AC-293; yalnız `unattended.manage`). Gerçek MySQL (app kullanıcısı).
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createUser, loginAs, makeApp, type Session, type TestUser } from "../helpers/app.ts";
import { createCustomerRow } from "../helpers/requests.ts";
import { createDeviceRow, deviceSessionRow, UNSIGNED_ENV } from "../helpers/unattended.ts";

let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp({ env: { ...UNSIGNED_ENV }, p10: { mfaSetupEnforcement: false } });
  await app.ready();
});
afterAll(async () => app.close());

const get = (s: Session, url: string) => app.inject({ method: "GET", url, headers: s.headers });
const ids = async (s: Session, url: string): Promise<string[]> =>
  (await get(s, url)).json<{ items: { id: string }[] }>().items.map((i) => i.id);

interface Firm {
  tenantId: string;
  admin: TestUser;
  tech: TestUser;
  deviceId: string;
  otherDeviceId: string;
}

async function firm(): Promise<Firm> {
  const t = await createTenant();
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const tech = await createUser({ tenantId: t.id, role: "USER", perms: { "unattended.connect": true, "session_history.view": true } });
  const customer = await createCustomerRow(t.id);
  const deviceId = await createDeviceRow({ tenantId: t.id, customerId: customer.id });
  const otherDeviceId = await createDeviceRow({ tenantId: t.id, customerId: customer.id, name: "PC-2" });
  return { tenantId: t.id, admin, tech, deviceId, otherDeviceId };
}

const devUrl = (deviceId: string) => `/api/v1/sessions?mode=UNATTENDED&deviceId=${deviceId}&pageSize=20`;

describe("P27 kapanış: GET /sessions deviceId filtresi", () => {
  it("AC-275: yalnız o cihazın oturumları (200); USER yalnız kendininkini görür; başka firma aynı kimlikle boş liste", async () => {
    const f = await firm();
    const byAdmin = await deviceSessionRow(f.tenantId, f.admin.id, f.deviceId);
    const byTech = await deviceSessionRow(f.tenantId, f.tech.id, f.deviceId);
    await deviceSessionRow(f.tenantId, f.admin.id, f.otherDeviceId);
    const res = await get(await loginAs(app, f.admin), devUrl(f.deviceId));
    expect(res.statusCode).toBe(200);
    expect(new Set(res.json<{ items: { id: string }[] }>().items.map((i) => i.id))).toEqual(new Set([byAdmin, byTech]));
    expect(await ids(await loginAs(app, f.tech), devUrl(f.deviceId))).toEqual([byTech]);
    const g = await firm();
    const other = await get(await loginAs(app, g.admin), devUrl(f.deviceId));
    expect(other.statusCode).toBe(200);
    expect(other.json<{ items: unknown[]; total: number }>()).toMatchObject({ items: [], total: 0 });
  });

  it("AC-275: geçersiz deviceId 400; cihazın oturumu yoksa boş liste", async () => {
    const f = await firm();
    const s = await loginAs(app, f.admin);
    expect((await get(s, "/api/v1/sessions?deviceId=abc")).statusCode).toBe(400);
    expect(await ids(s, devUrl(f.otherDeviceId))).toEqual([]);
  });
});

describe("P27 kapanış: GET /users/options?unattendedGrantable=1", () => {
  it("AC-293: yalnız manage sahibi (USER dahil) — etkin, connect yetkili, kendi firması; alanlar id/ad/durum", async () => {
    const f = await firm();
    const manager = await createUser({ tenantId: f.tenantId, role: "USER", perms: { "unattended.manage": true } });
    const plain = await createUser({ tenantId: f.tenantId, role: "USER" });
    const passive = await createUser({ tenantId: f.tenantId, role: "USER", status: "PASSIVE", perms: { "unattended.connect": true } });
    const g = await firm();
    const res = await get(await loginAs(app, manager), "/api/v1/users/options?unattendedGrantable=1");
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: { id: string; fullName: string; status: string }[] }>().items;
    const got = new Set(items.map((i) => i.id));
    expect(got).toEqual(new Set([f.admin.id, f.tech.id]));
    for (const id of [manager.id, plain.id, passive.id, g.admin.id, g.tech.id]) expect(got.has(id)).toBe(false);
    for (const i of items) expect(Object.keys(i).sort()).toEqual(["fullName", "id", "status"]);
  });

  it("AC-293 en az yetki: manage yoksa grantable 403; yalnız manage ile genel liste 403; tenantId parametresi kapsamı aşamaz", async () => {
    const f = await firm();
    const g = await firm();
    const manager = await createUser({ tenantId: f.tenantId, role: "USER", perms: { "unattended.manage": true } });
    const viewer = await createUser({ tenantId: f.tenantId, role: "USER", perms: { "users.view": true } });
    const m = await loginAs(app, manager);
    expect((await get(await loginAs(app, viewer), "/api/v1/users/options?unattendedGrantable=1")).statusCode).toBe(403);
    expect((await get(m, "/api/v1/users/options")).statusCode).toBe(403);
    expect((await get(m, "/api/v1/users/options?assignable=1")).statusCode).toBe(403);
    expect((await get(await loginAs(app, f.tech), "/api/v1/users/options?unattendedGrantable=1")).statusCode).toBe(403);
    const cross = await ids(m, `/api/v1/users/options?unattendedGrantable=1&tenantId=${g.tenantId}`);
    expect(cross).not.toContain(g.admin.id);
    expect(cross).toContain(f.admin.id);
  });
});
