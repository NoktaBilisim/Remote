// P11 sistem ayarları (MySQL, TURN; AC-77, AC-78, G-13) ve aydınlatma metni düzenleme (AC-29, AC-127). Gerçek MySQL.
// system_settings satırları paylaşılır (anahtar başına tek satır): bu dosya başta mysql satırını migrator ile temizler,
// TURN'ü API ile "varsayılana döndürür". TURN değerleri diğer dosyaların beklentisiyle uyumlu (turn: + secret).
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../src/lib/db.ts";
import { aadFor } from "../../src/lib/crypto.ts";
import type { ProbeResult, ProbeTarget } from "../../src/settings/mysql-probe.ts";
import { CONSENT_SAVE_PER_HOUR } from "../../src/settings/routes.ts";
import { createTenant, createUser, loginStepUp as loginAs, makeApp, testDb, type Session, type TestUser } from "../helpers/app.ts";
import { FAKE_P11_TURN_SECRET as SECRET } from "../helpers/secrets.ts";

const dbUrl = new URL(process.env.TEST_DATABASE_URL ?? "mysql://x@127.0.0.1/x");
const REAL = {
  host: dbUrl.hostname,
  port: Number(dbUrl.port),
  database: dbUrl.pathname.slice(1),
  user: decodeURIComponent(dbUrl.username),
};
const REAL_PW = decodeURIComponent(dbUrl.password);
const TURN_ENV = { TURN_URLS: "stun:env.p11.test:3478,turn:env.p11.test:3478", TURN_SECRET: "e".repeat(40) };
const failingProbe =
  (sink: ProbeTarget[]) =>
  async (t: ProbeTarget): Promise<ProbeResult> => (
    sink.push(t),
    {
      ok: false,
      reason: "connect",
      latencyMs: 3,
      err: Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:3306 secret-detail"), { code: "ECONNREFUSED" }),
    }
  );

let app: FastifyInstance;
let fakeApp: FastifyInstance;
let probes: ProbeTarget[] = [];
let superAdmin: TestUser;
let sSuper: Session;
let mig: Db | undefined;

beforeAll(async () => {
  const migratorUrl = process.env.TEST_MIGRATE_DATABASE_URL;
  if (!migratorUrl) throw new Error("TEST_MIGRATE_DATABASE_URL tanımlı değil (scripts/test-db.sh up)");
  mig = createDb(migratorUrl);
  await mig.$executeRawUnsafe("DELETE FROM system_settings WHERE `key` = 'mysql'");
  app = makeApp({ env: TURN_ENV });
  fakeApp = makeApp({ env: TURN_ENV, p11: { mysqlProbe: (t) => failingProbe(probes)(t) } });
  await Promise.all([app.ready(), fakeApp.ready()]);
  superAdmin = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
  sSuper = await loginAs(app, superAdmin);
  await app.inject({ method: "DELETE", url: "/api/v1/admin/settings/turn", headers: sSuper.headers });
});
afterAll(async () => {
  await app.inject({ method: "DELETE", url: "/api/v1/admin/settings/turn", headers: sSuper.headers });
  await Promise.all([app.close(), fakeApp.close()]);
  await mig?.$disconnect();
});

const req = (a: FastifyInstance, s: Session, method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: object) =>
  a.inject({ method, url: `/api/v1${url}`, headers: s.headers, ...(payload ? { payload } : {}) });
const lastAudit = (action: string) =>
  testDb().auditLog.findFirstOrThrow({ where: { action, userId: superAdmin.id }, orderBy: { id: "desc" } });

describe("MySQL ayarları (AC-77, AC-78)", () => {
  it("AC-77: kayıt yokken görünüm DATABASE_URL'den (source env); şifre dönmez", async () => {
    const res = await req(app, sSuper, "GET", "/admin/settings/mysql");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(res.body)).toEqual({
      ...REAL,
      requireTls: false,
      hasPassword: true,
      updatedAt: null,
      source: "env",
      matchesRunning: true,
    });
    expect(res.body).not.toContain(REAL_PW);
  });

  it("AC-78: PUT şifreyi AES-256-GCM (AAD mysql + hedef) saklar, geri yazmaz; boş şifre korur; audit maskeli; yeniden başlatma bilgisi", async () => {
    const pw = "Panel-Sifre-p11-1";
    const res = await req(app, sSuper, "PUT", "/admin/settings/mysql", {
      host: "Db.Internal.Test",
      port: 3307,
      database: "rapor_db",
      user: "rapor",
      password: pw,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({
      host: "db.internal.test",
      port: 3307,
      database: "rapor_db",
      user: "rapor",
      hasPassword: true,
      source: "panel",
      matchesRunning: false,
      restartRequired: true,
    });
    expect(body.message).toMatch(/\.env.*yeniden başlatılmalıdır/);
    expect(res.body).not.toContain(pw);
    const row = await testDb().systemSetting.findUniqueOrThrow({ where: { key: "mysql" } });
    expect(row.valueJson).toEqual({ host: "db.internal.test", port: 3307, database: "rapor_db", user: "rapor", requireTls: false });
    expect(Buffer.from(row.secretEnc ?? []).toString("latin1")).not.toContain(pw);
    const target = { host: "db.internal.test", port: 3307, user: "rapor" };
    expect(app.secrets.decrypt(row.secretEnc ?? new Uint8Array(), aadFor.mysqlSecret(target))).toBe(pw);
    expect(() => app.secrets.decrypt(row.secretEnc ?? new Uint8Array(), aadFor.systemSecret("turn"))).toThrow();
    // B-P11-1 (savunma derinliği): başka hedefin bağlamıyla çözülemez
    for (const t of [
      { ...target, host: "evil.p11.test" },
      { ...target, port: 3306 },
      { ...target, user: "root" },
    ])
      expect(() => app.secrets.decrypt(row.secretEnc ?? new Uint8Array(), aadFor.mysqlSecret(t))).toThrow();
    const audit = await lastAudit("settings.mysql.updated");
    expect(audit).toMatchObject({ tenantId: null, entity: "system_settings", entityId: "mysql", result: "success" });
    expect(audit.newValue).toMatchObject({ host: "db.internal.test", password: "***" });
    expect(JSON.stringify([audit.oldValue, audit.newValue])).not.toContain(pw);

    // aynı hedef (host/port/kullanıcı), farklı veritabanı + boş şifre → kayıtlı şifre korunur
    const again = await req(app, sSuper, "PUT", "/admin/settings/mysql", {
      host: "db.internal.test",
      port: 3307,
      database: "rapor_db2",
      user: "rapor",
      password: "",
    });
    expect(again.statusCode).toBe(200);
    expect(JSON.parse(again.body)).toMatchObject({ port: 3307, database: "rapor_db2", hasPassword: true });
    const row2 = await testDb().systemSetting.findUniqueOrThrow({ where: { key: "mysql" } });
    expect(Buffer.from(row2.secretEnc ?? []).equals(Buffer.from(row.secretEnc ?? []))).toBe(true);
    expect((await lastAudit("settings.mysql.updated")).newValue).not.toHaveProperty("password");
  });

  it("AC-77: geçersiz girdi 400 (port dizesi, veritabanı adı, host, fazla alan)", async () => {
    for (const p of [{ ...REAL, port: "3306" }, { ...REAL, database: "a b" }, { ...REAL, host: "a/b" }, { ...REAL, extra: 1 }, {}]) {
      const res = await req(app, sSuper, "PUT", "/admin/settings/mysql", p);
      expect(res.statusCode, JSON.stringify(p)).toBe(400);
    }
  });

  it("AC-77: gerçek MySQL'e test — başarı, kimlik reddi, veritabanı yok, bağlanılamadı (sınıflı genel mesaj); audit'te şifre yok", async () => {
    const s = await loginAs(app, superAdmin);
    const ok = JSON.parse((await req(app, s, "POST", "/admin/settings/mysql/test", { ...REAL, password: REAL_PW })).body);
    expect(ok).toEqual({ ok: true, message: "Bağlantı başarılı.", latencyMs: expect.any(Number) });
    const auth = JSON.parse((await req(app, s, "POST", "/admin/settings/mysql/test", { ...REAL, password: "yanlis-sifre" })).body);
    expect(auth).toMatchObject({ ok: false, message: expect.stringMatching(/Kimlik reddedildi/) });
    const nodb = JSON.parse(
      (await req(app, s, "POST", "/admin/settings/mysql/test", { ...REAL, database: "p11_yok_db", password: REAL_PW })).body,
    );
    expect(nodb).toMatchObject({ ok: false, message: expect.stringMatching(/Veritabanı bulunamadı/) });
    const conn = JSON.parse((await req(app, s, "POST", "/admin/settings/mysql/test", { ...REAL, port: 9, password: "x" })).body);
    // B-P11-4: başarısızlıkta süre dönmez (port tarama sinyali)
    expect(conn).toEqual({ ok: false, message: "Sunucuya bağlanılamadı.", latencyMs: null });
    for (const r of [auth, nodb]) expect(r.latencyMs).toBeNull();
    const audit = await lastAudit("settings.mysql.test");
    expect(audit).toMatchObject({ result: "fail", entityId: "mysql" });
    expect(audit.newValue).toMatchObject({ reason: "connect", port: 9, result: "fail" });
    expect(audit.newValue).not.toHaveProperty("latencyMs");
    const all = await testDb().auditLog.findMany({
      where: { action: "settings.mysql.test", userId: superAdmin.id },
      select: { newValue: true },
    });
    expect(JSON.stringify(all)).not.toContain(REAL_PW);
    expect(JSON.stringify(all)).not.toContain("yanlis-sifre");
  });

  it("AC-78: boş şifrede kayıtlı şifre yalnız aynı host/port/kullanıcı için kullanılır; farklı hedef → 400 fields.password", async () => {
    const s = await loginAs(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" })); // ayrı hız kovası
    await req(app, s, "PUT", "/admin/settings/mysql", { ...REAL, password: REAL_PW });
    expect(JSON.parse((await req(app, s, "POST", "/admin/settings/mysql/test", { ...REAL })).body)).toMatchObject({ ok: true });
    const other = await req(app, s, "POST", "/admin/settings/mysql/test", { ...REAL, host: "baska.p11.test" });
    expect(other.statusCode).toBe(400);
    expect(JSON.parse(other.body).error.fields.password).toMatch(/şifreyi girin/);
    expect(JSON.parse((await req(app, s, "GET", "/admin/settings/mysql")).body)).toMatchObject({ source: "panel", matchesRunning: true });
  });

  it("AC-78 (B-P11-1): kayıtlı şifre varken hedef değişen PUT şifresiz → 400; iki adımlı akış şifreyi yeni hosta göndermez", async () => {
    const s = await loginAs(app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    expect((await req(app, s, "PUT", "/admin/settings/mysql", { ...REAL, password: REAL_PW })).statusCode).toBe(200);
    const before = await testDb().systemSetting.findUniqueOrThrow({ where: { key: "mysql" } });
    for (const change of [{ host: "evil.p11.test" }, { port: REAL.port + 1 }, { user: "baska" }]) {
      const res = await req(app, s, "PUT", "/admin/settings/mysql", { ...REAL, ...change });
      expect(res.statusCode, JSON.stringify(change)).toBe(400);
      expect(JSON.parse(res.body).error.fields.password).toMatch(/şifreyi girin/);
    }
    const after = await testDb().systemSetting.findUniqueOrThrow({ where: { key: "mysql" } });
    expect(after.valueJson).toEqual(before.valueJson);
    expect(Buffer.from(after.secretEnc ?? []).equals(Buffer.from(before.secretEnc ?? []))).toBe(true);

    // İki adım: PUT (şifresiz, farklı host) reddedildi → şifresiz test yeni hosta şifre göndermez (probe çağrılmaz)
    const sf = await loginAs(fakeApp, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    probes = [];
    expect((await req(fakeApp, sf, "PUT", "/admin/settings/mysql", { ...REAL, host: "evil.p11.test" })).statusCode).toBe(400);
    const t1 = await req(fakeApp, sf, "POST", "/admin/settings/mysql/test", { ...REAL, host: "evil.p11.test" });
    expect(t1.statusCode).toBe(400);
    expect(probes).toHaveLength(0);

    // Savunma derinliği: satırın hedefi PUT dışından değişse bile (eski şifre, eski hedefin AAD'si) şifre çözülmez,
    // "kayıtlı şifre yok" sayılır — probe çağrılmaz, GET hasPassword:false.
    await testDb().systemSetting.update({ where: { key: "mysql" }, data: { valueJson: { ...REAL, host: "evil.p11.test" } } });
    const t2 = await req(fakeApp, sf, "POST", "/admin/settings/mysql/test", { ...REAL, host: "evil.p11.test" });
    expect(t2.statusCode).toBe(200);
    expect(JSON.parse(t2.body)).toEqual({ ok: false, message: expect.stringMatching(/Kayıtlı şifre okunamadı/), latencyMs: null });
    expect(probes).toHaveLength(0);
    expect(JSON.parse((await req(app, s, "GET", "/admin/settings/mysql")).body)).toMatchObject({
      host: "evil.p11.test",
      hasPassword: false,
    });

    // Yeni hedef için şifre girilince yalnız O şifre kullanılır; kayıtlı eski şifre yeni hosta gitmez
    expect(
      (await req(app, s, "PUT", "/admin/settings/mysql", { ...REAL, host: "evil.p11.test", password: "yeni-hedef-sifresi" })).statusCode,
    ).toBe(200);
    expect((await req(fakeApp, sf, "POST", "/admin/settings/mysql/test", { ...REAL, host: "evil.p11.test" })).statusCode).toBe(200);
    expect(probes).toEqual([{ ...REAL, host: "evil.p11.test", password: "yeni-hedef-sifresi", requireTls: false }]);
    expect(JSON.stringify(probes)).not.toContain(REAL_PW);
    // sonraki testler için gerçek hedefe dön
    expect((await req(app, s, "PUT", "/admin/settings/mysql", { ...REAL, password: REAL_PW })).statusCode).toBe(200);
  });

  it("AC-77 (B-P11-4): test için tüm Super Admin'lerde ortak 20/dk kovası (21. → 429)", async () => {
    const sink: ProbeTarget[] = [];
    const g = makeApp({ env: TURN_ENV, p11: { mysqlProbe: failingProbe(sink) } });
    await g.ready();
    try {
      const sessions = await Promise.all(
        Array.from({ length: 6 }, async () => loginAs(g, await createUser({ tenantId: null, role: "SUPER_ADMIN" }))),
      );
      const body = { host: "10.0.0.2", database: "d", user: "u", password: "p" };
      for (const s of sessions.slice(0, 5))
        for (let i = 0; i < 4; i++) expect((await req(g, s, "POST", "/admin/settings/mysql/test", body)).statusCode).toBe(200);
      const last = sessions[5];
      if (!last) throw new Error("oturum yok");
      const res = await req(g, last, "POST", "/admin/settings/mysql/test", body);
      expect(res.statusCode).toBe(429);
      expect(res.headers["retry-after"]).toBeDefined();
      expect(sink).toHaveLength(20);
    } finally {
      await g.close();
    }
  });

  it("AC-77: test 5/dk/kullanıcı (6. → 429); ham sürücü hatası yanıtta yok", async () => {
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const s = await loginAs(fakeApp, sa);
    probes = [];
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await req(fakeApp, s, "POST", "/admin/settings/mysql/test", {
        host: "10.0.0.1",
        database: "d",
        user: "u",
        password: "p",
      });
      codes.push(res.statusCode);
      expect(res.body).not.toContain("ECONNREFUSED");
      expect(res.body).not.toContain("secret-detail");
    }
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    expect(probes).toHaveLength(5);
    expect(probes[0]).toEqual({ host: "10.0.0.1", port: 3306, database: "d", user: "u", password: "p", requireTls: false });
  });

  it("AC-77/AC-69: yalnız SUPER_ADMIN — Admin 403", async () => {
    const t = await createTenant();
    const s = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    for (const [m, u] of [
      ["GET", "/admin/settings/mysql"],
      ["PUT", "/admin/settings/mysql"],
      ["POST", "/admin/settings/mysql/test"],
      ["GET", "/admin/settings/turn"],
      ["PUT", "/admin/settings/turn"],
      ["DELETE", "/admin/settings/turn"],
    ] as const) {
      expect((await req(app, s, m, u, m === "GET" || m === "DELETE" ? undefined : {})).statusCode, `${m} ${u}`).toBe(403);
    }
  });
});

describe("TURN ayarları (AC-78, G-13)", () => {
  it("AC-78: panel yokken env; turn: için secret zorunlu; PUT secret'ı şifreler, döndürmez; odalar yeni ayarı kullanır; DELETE env'e döner", async () => {
    const env0 = JSON.parse((await req(app, sSuper, "GET", "/admin/settings/turn")).body);
    expect(env0).toEqual({ urls: ["stun:env.p11.test:3478", "turn:env.p11.test:3478"], hasSecret: true, source: "env", updatedAt: null });

    const noSecret = await req(app, sSuper, "PUT", "/admin/settings/turn", { urls: ["turn:turn.p11.test:3478"] });
    expect(noSecret.statusCode).toBe(400);
    expect(JSON.parse(noSecret.body).error.fields.secret).toMatch(/gizli anahtar/);
    for (const bad of [{ urls: [] }, { urls: ["http://x.test"] }, { urls: ["turn:a.test", "turn:a.test"], secret: SECRET }])
      expect((await req(app, sSuper, "PUT", "/admin/settings/turn", bad)).statusCode).toBe(400);

    const urls = ["stun:stun.p11.test:3478", "turn:turn.p11.test:3478"];
    const put = await req(app, sSuper, "PUT", "/admin/settings/turn", { urls, secret: SECRET });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(put.body)).toMatchObject({ urls, hasSecret: true, source: "panel", updatedAt: expect.any(String) });
    expect(put.body).not.toContain(SECRET);
    expect(app.rooms.turn).toMatchObject({ urls, secret: SECRET });
    const audit = await lastAudit("settings.turn.updated");
    expect(audit.newValue).toEqual({ urls, secret: "***" });
    expect(JSON.stringify([audit.oldValue, audit.newValue])).not.toContain(SECRET);

    // yeniden başlatma: yeni örnek açılışta panel kaydını yükler
    const fresh = makeApp({ env: TURN_ENV });
    await fresh.ready();
    expect(fresh.rooms.turn).toMatchObject({ urls, secret: SECRET });
    await fresh.close();

    // secret boş → korunur
    const keep = await req(app, sSuper, "PUT", "/admin/settings/turn", { urls: ["turn:turn.p11.test:3478"], secret: "" });
    expect(JSON.parse(keep.body)).toMatchObject({ hasSecret: true, urls: ["turn:turn.p11.test:3478"] });
    expect(app.rooms.turn.secret).toBe(SECRET);

    const del = await req(app, sSuper, "DELETE", "/admin/settings/turn");
    expect(JSON.parse(del.body)).toEqual(env0);
    expect(app.rooms.turn).toMatchObject({ urls: ["stun:env.p11.test:3478", "turn:env.p11.test:3478"], secret: TURN_ENV.TURN_SECRET });
    expect((await lastAudit("settings.turn.deleted")).newValue).toEqual({ source: "env" });
    // idempotent: ikinci DELETE değişiklik/audit üretmez
    const n = await testDb().auditLog.count({ where: { action: "settings.turn.deleted", userId: superAdmin.id } });
    expect((await req(app, sSuper, "DELETE", "/admin/settings/turn")).statusCode).toBe(200);
    expect(await testDb().auditLog.count({ where: { action: "settings.turn.deleted", userId: superAdmin.id } })).toBe(n);
  });
});

describe("Aydınlatma metni (AC-29, AC-127)", () => {
  const BODY = (tag: string) => `Bu bir P11 test aydınlatma metnidir (${tag}) — çğıöşü İ. Veriler KVKK kapsamında işlenir.`;

  it("AC-29: GET güncel + sürümler; PUT yeni sürüm (eski is_current=0); aynı gövde → changed:false; audit'te gövde yok", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const s = await loginAs(app, admin);
    const g = JSON.parse((await req(app, s, "GET", "/settings/consent-text")).body);
    expect(g.current).toMatchObject({ version: 1, createdByName: null, body: expect.any(String) });
    expect(g.versions).toHaveLength(1);

    const body = BODY("v2");
    const put = await req(app, s, "PUT", "/settings/consent-text", { body: `  ${body.replace(" — ", "\r\n")}  ` });
    expect(put.statusCode).toBe(200);
    const out = JSON.parse(put.body);
    expect(out).toMatchObject({ changed: true, current: { version: 2, body: body.replace(" — ", "\n"), createdByName: "Test Kullanıcı" } });
    expect(out.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(await testDb().consentText.count({ where: { tenantId: t.id, isCurrent: true } })).toBe(1);
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { action: "settings.consent_text.updated", tenantId: t.id } });
    expect(audit.newValue).toEqual({ version: 2, sha256: out.current.sha256 });
    expect(audit.oldValue).toMatchObject({ version: 1 });
    expect(JSON.stringify([audit.oldValue, audit.newValue])).not.toContain("P11 test aydınlatma");

    const same = JSON.parse((await req(app, s, "PUT", "/settings/consent-text", { body: body.replace(" — ", "\n") })).body);
    expect(same).toMatchObject({ changed: false, current: { version: 2 } });
    expect(await testDb().auditLog.count({ where: { action: "settings.consent_text.updated", tenantId: t.id } })).toBe(1);
  });

  it("AC-29: geçersiz gövde 400; settings.edit yoksa 403; firma seçmemiş Super Admin 403; tenant izolasyonu", async () => {
    const t = await createTenant();
    const other = await createTenant();
    const s = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    for (const b of [{ body: "kısa" }, { body: `${"a".repeat(60)}\u202E` }, { body: "a".repeat(20_001) }, {}])
      expect((await req(app, s, "PUT", "/settings/consent-text", b)).statusCode).toBe(400);
    const viewer = await loginAs(app, await createUser({ tenantId: t.id, perms: { "settings.view": true } }));
    expect((await req(app, viewer, "GET", "/settings/consent-text")).statusCode).toBe(200);
    expect((await req(app, viewer, "PUT", "/settings/consent-text", { body: BODY("x") })).statusCode).toBe(403);
    expect((await req(app, sSuper, "GET", "/settings/consent-text")).statusCode).toBe(403);
    const otherBody = (await testDb().consentText.findFirstOrThrow({ where: { tenantId: other.id } })).id;
    expect((await req(app, s, "GET", "/settings/consent-text")).body).not.toContain(otherBody);
  });

  it("AC-29 (B-P11-6): kayıt tenant başına 10/saat (11. → 429); başka tenant etkilenmez", async () => {
    const t = await createTenant();
    const other = await createTenant();
    const s = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    const s2 = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" })); // aynı tenant, başka kullanıcı
    for (let i = 0; i < CONSENT_SAVE_PER_HOUR; i++)
      expect((await req(app, i % 2 ? s2 : s, "PUT", "/settings/consent-text", { body: BODY(`rl-${i}`) })).statusCode, `#${i}`).toBe(200);
    const over = await req(app, s, "PUT", "/settings/consent-text", { body: BODY("rl-over") });
    expect(over.statusCode).toBe(429);
    expect(over.headers["retry-after"]).toBeDefined();
    expect(await testDb().consentText.count({ where: { tenantId: t.id } })).toBe(CONSENT_SAVE_PER_HOUR + 1);
    const so = await loginAs(app, await createUser({ tenantId: other.id, role: "ADMIN" }));
    expect((await req(app, so, "PUT", "/settings/consent-text", { body: BODY("other") })).statusCode).toBe(200);
  });

  it("AC-29/AC-127: eşzamanlı iki kayıt — tek güncel sürüm, sürüm numaraları tekil (kaybeden 409 veya sıralı)", async () => {
    const t = await createTenant();
    const s = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    const res = await Promise.all([
      req(app, s, "PUT", "/settings/consent-text", { body: BODY("a") }),
      req(app, s, "PUT", "/settings/consent-text", { body: BODY("b") }),
    ]);
    for (const r of res) expect([200, 409]).toContain(r.statusCode);
    expect(res.some((r) => r.statusCode === 200)).toBe(true);
    expect(await testDb().consentText.count({ where: { tenantId: t.id, isCurrent: true } })).toBe(1);
    const versions = await testDb().consentText.findMany({ where: { tenantId: t.id }, select: { version: true } });
    expect(new Set(versions.map((v) => v.version)).size).toBe(versions.length);
  });
});
