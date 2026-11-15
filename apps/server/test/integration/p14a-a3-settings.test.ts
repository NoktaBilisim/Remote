// P14a A3 — paylaşılan `system_settings` (mysql, turn) satırlarını yazan testler: seri projede (vitest.config.ts) koşar.
// AC-211: "TLS gerekli" kalıcılığı + DB CHECK; AC-217: değişmeyen kayıt → yazım/audit yok, SYSTEM_AUDIT JSDoc ↔ kayıt
// (gizli alan `***`), `_` içeren önekle audit filtresi (LIKE jokeri kaçışı).
// Yazımlar servis katmanından (route'taki step-up/kota korumalarından bağımsız sözleşme), okuma /audit ucundan.
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SYSTEM_AUDIT } from "@remote/contracts/audit";
import { writeAudit } from "../../src/audit/service.ts";
import type { AuthContext } from "../../src/auth/session.ts";
import { systemDeps } from "../../src/settings/routes.ts";
import { deleteTurnSettings, getMysqlSettings, saveMysqlSettings, saveTurnSettings } from "../../src/settings/system.ts";
import { createUser, loginAs, makeApp, testDb, testFixtureDb, type Session, type TestUser } from "../helpers/app.ts";
import { FAKE_P11_TURN_SECRET } from "../helpers/secrets.ts";

const ctx = { ip: "127.0.0.1", userAgent: "vitest", requestId: "p14a-a3" };
let app: FastifyInstance;
let su: TestUser;
let sSu: Session;
let auth: AuthContext;
const MY = { host: "db.p14a.test", port: 3306, database: "rapor", user: "rapor" };

beforeAll(async () => {
  app = makeApp();
  await app.ready();
  su = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
  sSu = await loginAs(app, su);
  auth = { user: { id: su.id, email: su.email } } as AuthContext;
  await testFixtureDb().$executeRawUnsafe("DELETE FROM system_settings WHERE `key` = 'mysql'");
});
afterAll(async () => {
  await testFixtureDb().$executeRawUnsafe("DELETE FROM system_settings WHERE `key` = 'mysql'");
  await deleteTurnSettings(systemDeps(app), ctx, auth);
  await app.close();
});

const audits = (action: string) => testDb().auditLog.findMany({ where: { action, userId: su.id }, orderBy: { id: "asc" } });

describe('AC-211: MySQL "TLS gerekli" kaydı', () => {
  it("AC-211: requireTls kaydedilir ve görünümde döner; değişimi audit'e yazılır (eski → yeni)", async () => {
    const d = systemDeps(app);
    await saveMysqlSettings(d, ctx, auth, { ...MY, password: "Sifre-p14a-1", requireTls: false });
    expect((await getMysqlSettings(d)).requireTls).toBe(false);
    await saveMysqlSettings(d, ctx, auth, { ...MY, requireTls: true });
    const view = await getMysqlSettings(d);
    expect(view).toMatchObject({ ...MY, requireTls: true, hasPassword: true, source: "panel" });
    const row = await testDb().systemSetting.findUniqueOrThrow({ where: { key: "mysql" } });
    expect(row.valueJson).toEqual({ ...MY, requireTls: true });
    const last = (await audits(SYSTEM_AUDIT.MYSQL_UPDATED)).at(-1);
    expect(last?.oldValue).toMatchObject({ requireTls: false });
    expect(last?.newValue).toMatchObject({ requireTls: true });
    expect(last?.newValue).not.toHaveProperty("password"); // şifre değişmedi
  });

  it("AC-211: DB CHECK — requireTls yalnız boolean; bilinmeyen anahtar hâlâ reddedilir", async () => {
    const put = (json: object) =>
      testDb().$executeRawUnsafe("UPDATE system_settings SET value_json = ? WHERE `key` = 'mysql'", JSON.stringify(json));
    await expect(put({ ...MY, requireTls: "evet" })).rejects.toThrow(/system_settings_mysql_chk/);
    await expect(put({ ...MY, requireTls: true, x: 1 })).rejects.toThrow(/system_settings_mysql_chk/);
    await expect(put({ ...MY })).resolves.toBe(1); // eski biçim (anahtarsız) geçerli → okuyucu false sayar
    expect((await getMysqlSettings(systemDeps(app))).requireTls).toBe(false);
  });
});

describe("AC-217: değişmeyen PUT → yazım ve audit yok; SYSTEM_AUDIT JSDoc ↔ kayıt", () => {
  it('AC-217: mysql — aynı değerlerle (şifresiz) iki kez kayıt yeni audit/updated_at üretmez; şifre değişimi password:"***"', async () => {
    const d = systemDeps(app);
    await saveMysqlSettings(d, ctx, auth, { ...MY, requireTls: true, password: "Sifre-p14a-2" });
    const n = (await audits(SYSTEM_AUDIT.MYSQL_UPDATED)).length;
    const pwAudit = (await audits(SYSTEM_AUDIT.MYSQL_UPDATED)).at(-1);
    expect(pwAudit?.newValue).toMatchObject({ password: "***" }); // servis "changed" yazar, mask.ts *** yapar (JSDoc)
    expect(JSON.stringify([pwAudit?.oldValue, pwAudit?.newValue])).not.toContain("Sifre-p14a-2");
    const before = (await testDb().systemSetting.findUniqueOrThrow({ where: { key: "mysql" } })).updatedAt;
    await saveMysqlSettings(d, ctx, auth, { ...MY, requireTls: true });
    expect((await audits(SYSTEM_AUDIT.MYSQL_UPDATED)).length).toBe(n);
    expect((await testDb().systemSetting.findUniqueOrThrow({ where: { key: "mysql" } })).updatedAt).toEqual(before);
  });

  it('AC-217: turn — aynı adres listesi (sıra dahil), yeni secret yok → audit yok; secret değişimi secret:"***"', async () => {
    const d = systemDeps(app);
    const urls = ["stun:p14a.test:3478", "turn:p14a.test:3478"];
    await saveTurnSettings(d, ctx, auth, { urls, secret: FAKE_P11_TURN_SECRET });
    const first = await audits(SYSTEM_AUDIT.TURN_UPDATED);
    expect(first.at(-1)?.newValue).toMatchObject({ urls, secret: "***" });
    await saveTurnSettings(d, ctx, auth, { urls: [...urls] });
    expect((await audits(SYSTEM_AUDIT.TURN_UPDATED)).length).toBe(first.length);
    await saveTurnSettings(d, ctx, auth, { urls: [...urls].reverse() }); // sıra değişti → değişiklik
    expect((await audits(SYSTEM_AUDIT.TURN_UPDATED)).length).toBe(first.length + 1);
  });
});

describe("AC-217: `_` önekli audit eylem filtresi", () => {
  it("AC-217: action=tenant_settings.* yalnız gerçek öneki döndürür (`_` LIKE jokeri değil, harfiyen)", async () => {
    const base = { tenantId: null, userId: su.id, username: su.email, entity: "tenant_settings", result: "success" as const };
    await writeAudit(testDb(), ctx, { ...base, action: "tenant_settings.p14a_probe" });
    await writeAudit(testDb(), ctx, { ...base, action: "tenantXsettings.p14a_probe" }); // `_` joker olsaydı eşleşirdi
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/audit?userId=${su.id}&action=tenant_settings.*`,
      headers: sSu.headers,
    });
    expect(r.statusCode).toBe(200);
    const actions = r.json<{ items: { action: string }[] }>().items.map((i) => i.action);
    expect(actions).toContain("tenant_settings.p14a_probe");
    expect(actions).not.toContain("tenantXsettings.p14a_probe");
    expect(actions.every((a) => a.startsWith("tenant_settings."))).toBe(true);
    // Tam ad (önek değil) da `_` ile birebir.
    const exact = await app.inject({
      method: "GET",
      url: `/api/v1/audit?userId=${su.id}&action=settings.mysql.updated`,
      headers: sSu.headers,
    });
    expect(exact.json<{ items: { action: string }[] }>().items.every((i) => i.action === SYSTEM_AUDIT.MYSQL_UPDATED)).toBe(true);
  });
});
