// P12b (AC-196, AC-152 r3): Super Admin WhatsApp servis adresi — GET/PUT/DELETE /admin/settings/whatsapp + /test.
// Gerçek MySQL. `system_settings.whatsapp` satırı TÜM uygulama örneklerinin açılışta okuduğu paylaşılan satırdır: bu dosya
// vitest.config.ts'te ayrı projede (groupOrder 1) diğer entegrasyon dosyalarından SONRA, tek başına çalışır.
import { WA_API_KEY_REENTER, WA_TEST_MESSAGES, WA_URL_MESSAGE, type WhatsappSettingsView } from "@remote/contracts/api/system-settings";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hotp, base32Decode, stepOf } from "../../src/auth/mfa.ts";
import { createDb, type Db } from "../../src/lib/db.ts";
// P14a (AC-215): sistem ayarı yazımları step-up ister → varsayılan giriş `loginStepUp`; gerçek 2FA kuran production
// senaryoları düz giriş (`plainLogin`) + kurulum + `markStepUp`.
import {
  createTenant,
  createUser,
  loginAs as plainLogin,
  loginStepUp as loginAs,
  makeApp,
  markStepUp,
  testDb,
  type Session,
  type TestUser,
} from "../helpers/app.ts";
import { createRequestSettings, startFakeWhatsapp, type FakeWhatsapp } from "../helpers/requests.ts";
import { FAKE_APP_ENCRYPTION_KEYS, FAKE_WA_ENV_API_KEY, FAKE_WA_PANEL_API_KEY } from "../helpers/secrets.ts";

const W = "/api/v1/admin/settings/whatsapp";
const PROXY = { TRUSTED_PROXY_CIDR: "127.0.0.1/32" };
const PHONE = "+905321112233";

let envFake: FakeWhatsapp;
let panelFake: FakeWhatsapp;
let app: FastifyInstance;
let mig: Db | undefined;
let superAdmin: TestUser;
let sSuper: Session;
const extraApps: FastifyInstance[] = [];

const call = (a: FastifyInstance, s: Session | null, method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: unknown) =>
  a.inject({ method, url, headers: s?.headers ?? {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
const view = (r: { json: <T>() => T }) => r.json<WhatsappSettingsView>();
const audits = (action: string, userId = superAdmin.id) =>
  testDb().auditLog.findMany({ where: { action, userId, entity: "system_settings" }, orderBy: { id: "asc" } });
const resetRow = () => mig?.$executeRawUnsafe("DELETE FROM system_settings WHERE `key` = 'whatsapp'");
const testSends = (f: FakeWhatsapp) => f.hits.filter((h) => h.path === "/test-send");

beforeAll(async () => {
  const migratorUrl = process.env.TEST_MIGRATE_DATABASE_URL;
  if (!migratorUrl) throw new Error("TEST_MIGRATE_DATABASE_URL tanımlı değil (scripts/test-db.sh up)");
  mig = createDb(migratorUrl);
  await resetRow();
  envFake = await startFakeWhatsapp();
  panelFake = await startFakeWhatsapp();
  app = makeApp({ env: { ...PROXY, WHATSAPP_SERVICE_URL: envFake.url } });
  await app.ready();
  superAdmin = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
  sSuper = await loginAs(app, superAdmin);
});
beforeEach(() => {
  envFake.hits.length = 0;
  panelFake.hits.length = 0;
  envFake.plan = () => 200;
  panelFake.plan = () => 200;
});
afterEach(async () => {
  for (const a of extraApps.splice(0)) await a.close();
});
afterAll(async () => {
  await resetRow();
  await app.close();
  await Promise.all([envFake.close(), panelFake.close()]);
  await mig?.$disconnect();
});

describe("P12b WhatsApp servis adresi (AC-196)", () => {
  it("AC-196: kayıt yokken etkin adres env (source env, updatedAt null); no-store", async () => {
    const r = await call(app, sSuper, "GET", W);
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(view(r)).toEqual({ url: envFake.url, source: "env", insecure: false, updatedAt: null, apiKeySet: false, apiKeySource: null });
  });

  it("AC-196: PUT panel kaydı env'in yerine yeniden başlatmasız geçer — sonraki ilk bildirim ve test yeni adrese; audit eski→yeni", async () => {
    const put = await call(app, sSuper, "PUT", W, { url: `${panelFake.url}/` });
    expect(put.statusCode, put.body).toBe(200);
    const v = view(put);
    expect(v).toMatchObject({ url: panelFake.url, source: "panel", insecure: false });
    expect(Date.parse(v.updatedAt ?? "")).toBeGreaterThan(Date.now() - 60_000);
    expect((await testDb().systemSetting.findUniqueOrThrow({ where: { key: "whatsapp" } })).valueJson).toEqual({ url: panelFake.url });
    expect(view(await call(app, sSuper, "GET", W))).toEqual(v);
    const [a] = await audits("settings.whatsapp.updated");
    expect(a).toMatchObject({
      tenantId: null,
      entityId: "whatsapp",
      result: "success",
      oldValue: { url: envFake.url, source: "env" },
      newValue: { url: panelFake.url, source: "panel" },
    });

    // kayıttan sonraki ilk bildirim (gerçek talep akışı) yeni adrese
    const t = await createTenant();
    const ref = await createRequestSettings(t.id, { waEnabled: true, waRecipients: [PHONE] });
    const ip = "198.51.100.196";
    const info = await app.inject({ method: "GET", url: `/api/v1/public/requests/tenant?ref=${ref}`, headers: { "x-forwarded-for": ip } });
    const consentTextId = info.json<{ consentText: { id: string } }>().consentText.id;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/public/requests",
      headers: { "x-forwarded-for": ip },
      payload: {
        ref,
        clientInstanceId: "B".repeat(22),
        clientVersion: "0.9.0",
        customerName: "Ayşe Müşteri",
        phone: "0532 123 45 67",
        description: "Yazıcı çalışmıyor lütfen yardım",
        consentTextId,
        consentAccepted: true,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    await expect.poll(() => panelFake.hits.filter((h) => h.path === "/send-message").length).toBe(1);
    // ilk test de yeni adrese
    const tr = await call(app, sSuper, "POST", `${W}/test`, { phoneNumber: PHONE });
    expect(tr.json()).toEqual({ ok: true, message: WA_TEST_MESSAGES.ok });
    expect(testSends(panelFake)).toEqual([{ path: "/test-send", body: { phoneNumber: "905321112233" } }]);
    expect(envFake.hits).toEqual([]);
  });

  it("AC-196: yeniden açılan süreç panel kaydını açılışta okur (tenant ayar yanıtında adres yok)", async () => {
    const second = makeApp({ env: { WHATSAPP_SERVICE_URL: envFake.url } });
    extraApps.push(second);
    await second.ready();
    expect(second.whatsapp.effectiveUrl).toBe(panelFake.url);
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN", perms: { "settings.view": true, "settings.edit": true } });
    const s = await loginAs(second, admin);
    const g = await call(second, s, "GET", "/api/v1/settings/support-requests");
    expect(g.statusCode).toBe(200);
    expect(g.json<{ whatsapp: object }>().whatsapp).toMatchObject({ serviceConfigured: true, insecure: false });
    expect(g.body).not.toContain(panelFake.url.replace("http://", ""));
    expect(g.body).not.toContain(envFake.url.replace("http://", ""));
    // tenant testi de etkin (panel) adrese; yanıt yalnız {ok, message}
    const tt = await call(second, s, "POST", "/api/v1/settings/support-requests/whatsapp/test", { phone: PHONE });
    expect(tt.json()).toEqual({ ok: true, message: WA_TEST_MESSAGES.ok });
    expect(testSends(panelFake)).toHaveLength(1);
  });

  it("AC-196: DELETE env'e döner ({url:null} satırı), audit; ikinci DELETE değişiklik/audit yok; test env adresine", async () => {
    const d = await call(app, sSuper, "DELETE", W);
    expect(d.statusCode).toBe(200);
    expect(view(d)).toEqual({ url: envFake.url, source: "env", insecure: false, updatedAt: null, apiKeySet: false, apiKeySource: null });
    expect((await testDb().systemSetting.findUniqueOrThrow({ where: { key: "whatsapp" } })).valueJson).toEqual({ url: null });
    const del = await audits("settings.whatsapp.deleted");
    expect(del).toHaveLength(1);
    expect(del[0]).toMatchObject({ oldValue: { url: panelFake.url, source: "panel" }, newValue: { url: envFake.url, source: "env" } });
    expect((await call(app, sSuper, "DELETE", W)).statusCode).toBe(200);
    expect(await audits("settings.whatsapp.deleted")).toHaveLength(1);
    expect(app.whatsapp.effectiveUrl).toBe(envFake.url);
    expect((await call(app, sSuper, "POST", `${W}/test`, { phoneNumber: PHONE })).json()).toMatchObject({ ok: true });
    expect(testSends(envFake)).toHaveLength(1);
    expect(panelFake.hits).toEqual([]);
  });

  it("AC-196: geçersiz adres 400 VALIDATION fields.url (kayıt değişmez)", async () => {
    const before = await audits("settings.whatsapp.updated");
    for (const url of [
      "ftp://x",
      "http://wa\u200b.test",
      "http://u:p@wa.test",
      "http://wa.test?a=1",
      "http://wa.test#f",
      "http://wa test",
      "http://wa.test\n",
      "http://",
      "http:///",
      "",
      `https://${"a".repeat(193)}`,
      5,
      null,
    ]) {
      const r = await call(app, sSuper, "PUT", W, { url });
      expect(r.statusCode, JSON.stringify(url)).toBe(400);
      expect(r.json<{ error: { code: string; fields: Record<string, string> } }>().error).toMatchObject({
        code: "VALIDATION",
        fields: { url: WA_URL_MESSAGE },
      });
    }
    for (const payload of [{}, { url: "http://wa.test", extra: 1 }])
      expect((await call(app, sSuper, "PUT", W, payload)).statusCode).toBe(400);
    expect(await audits("settings.whatsapp.updated")).toHaveLength(before.length);
    expect(view(await call(app, sSuper, "GET", W)).source).toBe("env");
  });

  it("AC-196: Admin ve User 403, oturumsuz 401, CSRF başlığı olmadan 403 — uçların hiçbiri çalışmaz", async () => {
    const t = await createTenant();
    const admin = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    const user = await loginAs(
      app,
      await createUser({ tenantId: t.id, role: "USER", perms: { "settings.view": true, "settings.edit": true } }),
    );
    const calls = [
      ["GET", W, undefined],
      ["PUT", W, { url: "http://wa.test" }],
      ["DELETE", W, undefined],
      ["POST", `${W}/test`, { phoneNumber: PHONE }],
    ] as const;
    for (const s of [admin, user]) {
      for (const [m, u, p] of calls) {
        const r = await call(app, s, m, u, p);
        expect(r.statusCode, `${m} ${u}`).toBe(403);
        expect(r.body).not.toContain(envFake.url.replace("http://", ""));
      }
    }
    for (const [m, u, p] of calls) expect((await call(app, null, m, u, p)).statusCode).toBe(401);
    const noCsrf = { cookie: sSuper.headers.cookie, origin: sSuper.headers.origin };
    expect((await app.inject({ method: "PUT", url: W, headers: noCsrf, payload: { url: "http://wa.test" } })).statusCode).toBe(403);
    expect(await testDb().systemSetting.findUniqueOrThrow({ where: { key: "whatsapp" } })).toMatchObject({ valueJson: { url: null } });
    expect(envFake.hits).toEqual([]);
  });

  it("AC-196: test — servis hatası, 3xx (izlenmez), ulaşılamaz → 200 ok:false sabit mesaj; audit numara maskeli + neden; geçersiz numara 400", async () => {
    const tester = await createUser({ tenantId: null, role: "SUPER_ADMIN" }); // ayrı hız kovası
    const s = await loginAs(app, tester);
    const target = await startFakeWhatsapp();
    try {
      envFake.plan = () => 500;
      const e = await call(app, s, "POST", `${W}/test`, { phoneNumber: "0532 111 22 33" });
      expect(e.statusCode).toBe(200);
      expect(e.json()).toEqual({ ok: false, message: WA_TEST_MESSAGES.http_error });
      expect(e.body).not.toContain("success"); // servis yanıt gövdesi yansıtılmaz

      // 307 → başka adres: yönlendirme izlenmez
      await call(app, sSuper, "PUT", W, { url: panelFake.url });
      panelFake.plan = () => 307;
      const r = await call(app, s, "POST", `${W}/test`, { phoneNumber: PHONE });
      expect(r.json()).toEqual({ ok: false, message: WA_TEST_MESSAGES.redirect });
      expect(target.hits).toEqual([]);

      await call(app, sSuper, "PUT", W, { url: "http://127.0.0.1:9" }); // kapalı port
      const u = await call(app, s, "POST", `${W}/test`, { phoneNumber: PHONE });
      expect(u.json()).toEqual({ ok: false, message: WA_TEST_MESSAGES.unreachable });
      expect(u.body).not.toContain("127.0.0.1");

      const bad = await call(app, s, "POST", `${W}/test`, { phoneNumber: "abc" });
      expect(bad.statusCode).toBe(400);
      expect(bad.json<{ error: { fields: Record<string, string> } }>().error.fields).toHaveProperty("phoneNumber");

      const rows = await audits("settings.whatsapp.test", tester.id);
      expect(rows.map((a) => [a.result, (a.newValue as { reason?: string }).reason])).toEqual([
        ["fail", "http_error"],
        ["fail", "redirect"],
        ["fail", "unreachable"],
      ]);
      for (const a of rows) expect(a.newValue).toMatchObject({ recipient: "+90******2233" }); // QA: tenant testiyle aynı anahtar
      for (const a of rows) expect(a.newValue).not.toHaveProperty("phone");
      expect(JSON.stringify(rows.map((a) => [a.oldValue, a.newValue]))).not.toContain("5321112233");
    } finally {
      await target.close();
      await call(app, sSuper, "DELETE", W);
    }
  });

  it("AC-196: test kullanıcı başına dakikada 5 (6. → 429, Retry-After); başka Super Admin etkilenmez", async () => {
    const a = await loginAs(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    const b = await loginAs(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await call(app, a, "POST", `${W}/test`, { phoneNumber: PHONE })).statusCode);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    const last = await call(app, a, "POST", `${W}/test`, { phoneNumber: PHONE });
    expect(last.statusCode).toBe(429);
    expect(Number(last.headers["retry-after"])).toBeGreaterThan(0);
    expect((await call(app, b, "POST", `${W}/test`, { phoneNumber: PHONE })).statusCode).toBe(200);
    expect(testSends(envFake)).toHaveLength(6);
  });
});

describe("P12b düzeltme turu 1 (B-P12b-1, -2, -5)", () => {
  it("B-P12b-2: eşzamanlı PUT/DELETE sonrası bellekteki etkin adres = DB = GET (yazım + uygulama sıralı)", async () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://wa${i}.p12b.test`);
    for (let round = 0; round < 5; round++) {
      // P13a: sistem ayarı yazımı kullanıcı başına 10/dk → her tur ayrı Super Admin (7 yazım)
      const sr = await loginAs(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
      const rs = await Promise.all([...urls.map((url) => call(app, sr, "PUT", W, { url })), call(app, sr, "DELETE", W)]);
      expect(rs.map((r) => r.statusCode)).toEqual(Array(urls.length + 1).fill(200));
      const row = await testDb().systemSetting.findUniqueOrThrow({ where: { key: "whatsapp" } });
      const dbUrl = (row.valueJson as { url: string | null }).url ?? envFake.url;
      expect(app.whatsapp.effectiveUrl).toBe(dbUrl);
      expect(view(await call(app, sSuper, "GET", W)).url).toBe(dbUrl);
    }
    await call(app, sSuper, "DELETE", W);
    expect(app.whatsapp.effectiveUrl).toBe(envFake.url);
  });

  it("B-P12b-1: DB'de ayrıştırılamayan panel adresi (CHECK'ten geçen) → açılışta kanal kapalı (fail-closed), GET 200 insecure, test istek göndermez", async () => {
    await mig?.$executeRawUnsafe(
      "INSERT INTO system_settings (`key`, value_json, secret_enc, updated_at) VALUES ('whatsapp', ?, NULL, NOW(3)) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = NOW(3)",
      JSON.stringify({ url: "http://a:99999" }),
    );
    try {
      const a2 = makeApp({ env: { WHATSAPP_SERVICE_URL: envFake.url } });
      extraApps.push(a2);
      await a2.ready();
      expect({ url: a2.whatsapp.effectiveUrl, insecure: a2.whatsapp.insecure, usable: a2.whatsapp.usable }).toEqual({
        url: "http://a:99999",
        insecure: true,
        usable: false,
      });
      const s = await loginAs(a2, superAdmin);
      const g = await call(a2, s, "GET", W);
      expect(g.statusCode).toBe(200);
      expect(view(g)).toMatchObject({ source: "panel", insecure: true });
      expect((await call(a2, s, "POST", `${W}/test`, { phoneNumber: PHONE })).json()).toEqual({
        ok: false,
        message: WA_TEST_MESSAGES.insecure,
      });
      expect(envFake.hits).toEqual([]);
    } finally {
      await resetRow();
    }
  });

  it("B-P12b-5: test ucu tüm Super Admin'ler için dakikada 20 (21. → 429), kişi başı 5 ayrıca", async () => {
    const a3 = makeApp({ env: { WHATSAPP_SERVICE_URL: envFake.url } });
    extraApps.push(a3);
    await a3.ready();
    const sessions = await Promise.all(
      Array.from({ length: 5 }, async () => loginAs(a3, await createUser({ tenantId: null, role: "SUPER_ADMIN" }))),
    );
    const codes: number[] = [];
    for (const s of sessions)
      for (let i = 0; i < 5; i++) codes.push((await call(a3, s, "POST", `${W}/test`, { phoneNumber: PHONE })).statusCode);
    expect(codes.filter((c) => c === 200)).toHaveLength(20);
    expect(codes.slice(20)).toEqual([429, 429, 429, 429, 429]);
    expect(testSends(envFake)).toHaveLength(20);
  });
});

describe("P12b WhatsApp güvensiz adres — production (AC-196, AC-150, K13)", () => {
  /** Production'da Super Admin 2FA kurulumundan geçer (B-P10-3). */
  async function prodSuper(a: FastifyInstance): Promise<Session> {
    const s = await plainLogin(a, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    const setup = (await call(a, s, "POST", "/api/v1/auth/mfa/setup", {})).json<{ secret: string }>();
    const en = await call(a, s, "POST", "/api/v1/auth/mfa/enable", { code: hotp(base32Decode(setup.secret), stepOf(Date.now())) });
    expect(en.statusCode, en.body).toBe(200);
    await markStepUp(s);
    return s;
  }

  it("AC-196: http + genel adres kaydedilir ama insecure=true, kanal kapalı, test istek göndermeden ok:false; tenant yanıtı insecure, adres yok; https'e geçince açılır", async () => {
    const prod = makeApp({
      env: {
        ...PROXY,
        NODE_ENV: "production",
        SESSION_REF_KEY: "k".repeat(40),
        APP_ENCRYPTION_KEYS: FAKE_APP_ENCRYPTION_KEYS,
        WHATSAPP_SERVICE_URL: envFake.url,
      },
    });
    extraApps.push(prod);
    await prod.ready();
    const s = await prodSuper(prod);
    try {
      expect(view(await call(prod, s, "GET", W))).toMatchObject({ url: envFake.url, insecure: false }); // loopback http güvenli
      const put = await call(prod, s, "PUT", W, { url: "http://203.0.113.10:3000" });
      expect(put.statusCode, put.body).toBe(200);
      expect(view(put)).toMatchObject({ url: "http://203.0.113.10:3000", source: "panel", insecure: true });
      expect({ insecure: prod.whatsapp.insecure, usable: prod.whatsapp.usable }).toEqual({ insecure: true, usable: false });
      const tr = await call(prod, s, "POST", `${W}/test`, { phoneNumber: PHONE });
      expect(tr.statusCode).toBe(200);
      expect(tr.json()).toEqual({ ok: false, message: "Servis güvenli yapılandırılmamış." });
      const a = await testDb().auditLog.findFirstOrThrow({
        where: { action: "settings.whatsapp.test", entity: "system_settings" },
        orderBy: { id: "desc" },
      });
      expect(a.newValue).toMatchObject({ result: "fail", reason: "insecure" });

      const t = await createTenant();
      await testDb().tenantSettings.update({ where: { tenantId: t.id }, data: { requireTech2fa: false } });
      const admin = await createUser({ tenantId: t.id, role: "USER", perms: { "settings.view": true, "settings.edit": true } });
      const sa = await loginAs(prod, admin);
      const g = await call(prod, sa, "GET", "/api/v1/settings/support-requests");
      expect(g.statusCode, g.body).toBe(200);
      expect(g.json<{ whatsapp: object }>().whatsapp).toMatchObject({ serviceConfigured: true, insecure: true });
      expect(g.body).not.toContain("203.0.113.10");

      const https = await call(prod, s, "PUT", W, { url: "https://wa.example.test" });
      expect(view(https)).toMatchObject({ insecure: false });
      expect(prod.whatsapp.usable).toBe(true);
    } finally {
      await call(prod, s, "DELETE", W);
    }
    expect(prod.whatsapp.effectiveUrl).toBe(envFake.url);
  });
});

describe("P13a sistem ayarları (B-P12b-4, B-P12b-5, T33; mimari-p13 §3)", () => {
  it("B-P12b-4: büyük harfli şema / ondalık IPv4 kanonik biçimde saklanır; görünmez karakter 400", async () => {
    const s = await loginAs(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    try {
      const up = await call(app, s, "PUT", W, { url: "HTTPS://WA.P13A.Test/" });
      expect(up.statusCode, up.body).toBe(200);
      expect(view(up)).toMatchObject({ url: "https://wa.p13a.test", source: "panel" });
      expect((await testDb().systemSetting.findUniqueOrThrow({ where: { key: "whatsapp" } })).valueJson).toEqual({
        url: "https://wa.p13a.test",
      });
      expect(view(await call(app, s, "PUT", W, { url: "http://3232235777:3000" })).url).toBe("http://192.168.1.1:3000");
      for (const url of ["http://wa​.p13a.test", "http://wa.p13a.test/a‮b", "http://wa.p13a.test "]) {
        const r = await call(app, s, "PUT", W, { url });
        expect(r.statusCode, JSON.stringify(url)).toBe(400);
        expect(r.json<{ error: { fields: Record<string, string> } }>().error.fields).toEqual({ url: WA_URL_MESSAGE });
      }
    } finally {
      await call(app, s, "DELETE", W);
    }
  });

  it("B-P12b-5: değer değişmediyse PUT 200 döner, audit yazılmaz", async () => {
    const su = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const s = await loginAs(app, su);
    try {
      expect((await call(app, s, "PUT", W, { url: "https://same.p13a.test" })).statusCode).toBe(200);
      const n = (await audits("settings.whatsapp.updated", su.id)).length;
      const again = await call(app, s, "PUT", W, { url: "HTTPS://SAME.p13a.test/" }); // kanonik olarak aynı
      expect(again.statusCode).toBe(200);
      expect(view(again)).toMatchObject({ url: "https://same.p13a.test", source: "panel" });
      expect(await audits("settings.whatsapp.updated", su.id)).toHaveLength(n);
    } finally {
      await call(app, s, "DELETE", W);
    }
  });

  it("B-P12b-5: sistem ayarı PUT/DELETE kullanıcı başına dakikada 10 (11. → 429 + Retry-After); başka kullanıcı etkilenmez; 400 kotayı tüketmez", async () => {
    const a = await loginAs(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    const b = await loginAs(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    try {
      expect((await call(app, a, "PUT", W, { url: "ftp://x" })).statusCode).toBe(400);
      const codes: number[] = [];
      for (let i = 0; i < 10; i++)
        codes.push((await call(app, a, i % 2 ? "DELETE" : "PUT", W, i % 2 ? undefined : { url: `https://rl${i}.p13a.test` })).statusCode);
      expect(codes).toEqual(Array(10).fill(200));
      for (const [m, u, p] of [
        ["PUT", W, { url: "https://rl.p13a.test" }],
        ["DELETE", W, undefined],
        ["DELETE", "/api/v1/admin/settings/turn", undefined],
        ["PUT", "/api/v1/admin/settings/mysql", { host: "db.p13a.test", port: 3306, database: "x", user: "u", password: "p" }],
      ] as const) {
        const r = await call(app, a, m, u, p);
        expect(r.statusCode, `${m} ${u}`).toBe(429);
        expect(r.json<{ error: { code: string } }>().error.code).toBe("RATE_LIMITED");
        expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
      }
      expect((await call(app, a, "GET", W)).statusCode).toBe(200); // okuma sınırlı değil
      expect((await call(app, b, "DELETE", W)).statusCode).toBe(200);
    } finally {
      await call(app, b, "DELETE", W);
    }
  });

  it('G-P13b-2: env verilmemiş ve panel kaydı yoksa yerleşik adres yok → url null, kaynak `env`, test istek atmadan "yapılandırılmamış"', async () => {
    const def = makeApp({ env: { WHATSAPP_SERVICE_URL: "" } });
    extraApps.push(def);
    await def.ready();
    const s = await loginAs(def, superAdmin);
    expect(view(await call(def, s, "GET", W))).toMatchObject({ url: null, source: "env", insecure: false });
    expect((await call(def, s, "POST", `${W}/test`, { phoneNumber: PHONE })).json()).toEqual({
      ok: false,
      message: WA_TEST_MESSAGES.unconfigured,
    });
    expect(view(await call(app, sSuper, "GET", W)).source).toBe("env");
  });

  it("T33: canlıda http:// + link-local (169.254.169.254, [fe80::1]) güvensiz → kanal kapalı", async () => {
    const prod = makeApp({
      env: {
        ...PROXY,
        NODE_ENV: "production",
        SESSION_REF_KEY: "k".repeat(40),
        APP_ENCRYPTION_KEYS: FAKE_APP_ENCRYPTION_KEYS,
        WHATSAPP_SERVICE_URL: envFake.url,
      },
    });
    extraApps.push(prod);
    await prod.ready();
    const s = await plainLogin(prod, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    const setup = (await call(prod, s, "POST", "/api/v1/auth/mfa/setup", {})).json<{ secret: string }>();
    expect(
      (await call(prod, s, "POST", "/api/v1/auth/mfa/enable", { code: hotp(base32Decode(setup.secret), stepOf(Date.now())) })).statusCode,
    ).toBe(200);
    await markStepUp(s);
    try {
      for (const url of ["http://169.254.169.254", "http://[fe80::1]:3000"]) {
        const put = await call(prod, s, "PUT", W, { url });
        expect(put.statusCode, put.body).toBe(200);
        expect(view(put)).toMatchObject({ insecure: true });
        expect(prod.whatsapp.usable).toBe(false);
      }
      expect(view(await call(prod, s, "PUT", W, { url: "http://[::1]:3000" }))).toMatchObject({ insecure: false }); // loopback özel
    } finally {
      await call(prod, s, "DELETE", W);
    }
  });
});

describe("S-P13b-3 WhatsApp servis anahtarı (x-api-key)", () => {
  const ENV_KEY = FAKE_WA_ENV_API_KEY;
  const PANEL_KEY = FAKE_WA_PANEL_API_KEY;
  type ErrBody = { error: { code: string; fields: Record<string, string> } };
  beforeEach(async () => {
    await resetRow();
  });
  const keyedApp = async () => {
    const a = makeApp({ env: { ...PROXY, WHATSAPP_SERVICE_URL: envFake.url, WHATSAPP_SERVICE_API_KEY: ENV_KEY } });
    extraApps.push(a);
    await a.ready();
    return { a, s: await loginAs(a, superAdmin) };
  };

  it("S-P13b-3: env anahtarı env adresiyle gider; panel adresi + anahtar şifreli saklanır, yanıtta/audit'te değer yok; panel anahtarı başlıkta", async () => {
    const { a, s } = await keyedApp();
    expect(view(await call(a, s, "GET", W))).toMatchObject({ source: "env", apiKeySet: true, apiKeySource: "env" });
    expect((await call(a, s, "POST", `${W}/test`, { phoneNumber: PHONE })).json()).toEqual({ ok: true, message: WA_TEST_MESSAGES.ok });
    expect(testSends(envFake).at(-1)?.apiKey).toBe(ENV_KEY);

    const put = await call(a, s, "PUT", W, { url: panelFake.url, apiKey: PANEL_KEY });
    expect(put.statusCode, put.body).toBe(200);
    expect(view(put)).toMatchObject({ source: "panel", apiKeySet: true, apiKeySource: "panel" });
    expect(put.body).not.toContain(PANEL_KEY);
    expect((await call(a, s, "GET", W)).body).not.toContain(PANEL_KEY);
    const row = await testDb().systemSetting.findUniqueOrThrow({ where: { key: "whatsapp" } });
    expect(row.secretEnc).not.toBeNull();
    expect(Buffer.from(row.secretEnc ?? new Uint8Array()).toString("latin1")).not.toContain(PANEL_KEY);
    const [audit] = (await audits("settings.whatsapp.updated")).slice(-1);
    expect(audit?.oldValue).toMatchObject({ source: "env", apiKeySet: true, apiKey: "***" });
    expect(audit?.newValue).toMatchObject({ url: panelFake.url, source: "panel", apiKeySet: true, apiKey: "***", apiKeyChanged: true });
    expect(JSON.stringify([audit?.oldValue, audit?.newValue])).not.toContain(PANEL_KEY);
    await call(a, s, "POST", `${W}/test`, { phoneNumber: PHONE });
    expect(testSends(panelFake).at(-1)?.apiKey).toBe(PANEL_KEY);

    // Alan yok / "" → korunur (değişiklik yok → audit yok)
    const n = (await audits("settings.whatsapp.updated")).length;
    for (const body of [{ url: panelFake.url }, { url: panelFake.url, apiKey: "" }]) {
      expect(view(await call(a, s, "PUT", W, body))).toMatchObject({ apiKeySet: true, apiKeySource: "panel" });
    }
    expect((await audits("settings.whatsapp.updated")).length).toBe(n);
    await call(a, s, "POST", `${W}/test`, { phoneNumber: PHONE });
    expect(testSends(panelFake).at(-1)?.apiKey).toBe(PANEL_KEY);
  });

  it("S-P13b-3: adres kökeni değişirken anahtar verilmezse 400 fields.apiKey; null → silinir (env anahtarı panel adresine gitmez); DELETE env'e döner", async () => {
    const { a, s } = await keyedApp();
    await call(a, s, "PUT", W, { url: panelFake.url, apiKey: PANEL_KEY });
    const moved = await call(a, s, "PUT", W, { url: envFake.url });
    expect(moved.statusCode).toBe(400);
    expect(moved.json<ErrBody>().error).toMatchObject({ code: "VALIDATION", fields: { apiKey: WA_API_KEY_REENTER } });
    expect(view(await call(a, s, "GET", W))).toMatchObject({ url: panelFake.url, apiKeySource: "panel" });

    const cleared = await call(a, s, "PUT", W, { url: envFake.url, apiKey: null });
    expect(view(cleared)).toMatchObject({ url: envFake.url, source: "panel", apiKeySet: false, apiKeySource: null });
    const [audit] = (await audits("settings.whatsapp.updated")).slice(-1);
    expect(audit?.oldValue).toMatchObject({ apiKeySet: true, apiKey: "***" });
    expect(audit?.newValue).toMatchObject({ apiKeySet: false, apiKeyChanged: true });
    expect(audit?.newValue).not.toHaveProperty("apiKey");
    await call(a, s, "POST", `${W}/test`, { phoneNumber: PHONE });
    expect(testSends(envFake).at(-1)?.apiKey).toBeUndefined();

    await call(a, s, "PUT", W, { url: envFake.url, apiKey: PANEL_KEY });
    const del = await call(a, s, "DELETE", W);
    expect(view(del)).toMatchObject({ source: "env", apiKeySet: true, apiKeySource: "env" });
    expect((await testDb().systemSetting.findUniqueOrThrow({ where: { key: "whatsapp" } })).secretEnc).toBeNull();
    const [delAudit] = (await audits("settings.whatsapp.deleted")).slice(-1);
    expect(delAudit?.oldValue).toMatchObject({ apiKeySet: true, apiKey: "***" });
    expect(delAudit?.newValue).toMatchObject({ source: "env", apiKeySet: true, apiKey: "***" });
    await call(a, s, "POST", `${W}/test`, { phoneNumber: PHONE });
    expect(testSends(envFake).at(-1)?.apiKey).toBe(ENV_KEY);
  });

  it('S-P13b-3: servis 401 → test yanıtı "Servis anahtarı reddetti." + audit reason unauthorized; geçersiz anahtar 400', async () => {
    const { a, s } = await keyedApp();
    envFake.plan = () => 401;
    expect((await call(a, s, "POST", `${W}/test`, { phoneNumber: PHONE })).json()).toEqual({
      ok: false,
      message: WA_TEST_MESSAGES.unauthorized,
    });
    expect(WA_TEST_MESSAGES.unauthorized).toBe("Servis anahtarı reddetti.");
    const [t] = (await audits("settings.whatsapp.test")).slice(-1);
    expect(t?.newValue).toMatchObject({ result: "fail", reason: "unauthorized" });
    for (const apiKey of [
      "kisa",
      "bosluklu anahtar 0123456789",
      "ç".repeat(20),
      `${"a".repeat(20)}\u200B`,
      `a${"\u0007"}${"b".repeat(20)}`,
      "x".repeat(257),
      12345,
    ]) {
      const r = await call(a, s, "PUT", W, { url: panelFake.url, apiKey });
      expect(r.statusCode, String(apiKey)).toBe(400);
      expect(r.json<ErrBody>().error.fields).toHaveProperty("apiKey");
    }
    expect(view(await call(a, s, "GET", W)).source).toBe("env");
  });
});
