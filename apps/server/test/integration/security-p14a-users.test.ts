// P14a A2 + P14b B2 — kullanıcı yönetimi güvenliği (mimari-e11 §4.2, §5.1; ADR-0023): satır kilidi + aktörün TX içinde
// yeniden okunması (AC-202), hız sınırı (AC-203), 403 audit'i (AC-204), If-Match/ETag (AC-206), diff tabanlı audit
// (AC-207), teknisyen seçenekleri (AC-225). Gecikme kancalı testler deterministik: kanca kilidi tutan TX'i bekletir, diğer
// istek kilitte sıraya girer; zamanlama varsayımı yok (her biri 20 ardışık tur).
import type { CreateUserResponse, UserDetail, UserOptionsResponse } from "@remote/contracts/api/users";
import { PERMISSION_KEYS } from "@remote/contracts/permissions";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditContext } from "../../src/audit/service.ts";
import { resolveSession, type AuthContext } from "../../src/auth/session.ts";
import { newId } from "../../src/lib/ids.ts";
import { lockUsers, replacePermissions } from "../../src/users/repo.ts";
import { updateUser, type UserLiveEffects } from "../../src/users/service.ts";
import { createTenant, createUser, loginRequest, makeApp, ORIGIN, testDb, type Session, type TestUser } from "../helpers/app.ts";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";

let app: FastifyInstance;
beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(() => app.close());

const db = () => testDb();
const CTX: AuditContext = { ip: "10.14.0.1", userAgent: "vitest", requestId: "p14a-test" };
const fx = (): UserLiveEffects => ({ rooms: app.rooms, hub: app.requestHub, log: app.log });

let ipSeq = 0;
async function signIn(user: TestUser): Promise<Session> {
  const res = await app.inject(
    loginRequest(user.email, user.password, { remoteAddress: `10.14.${Math.floor(++ipSeq / 250) + 1}.${(ipSeq % 250) + 1}` }),
  );
  if (res.statusCode !== 200) throw new Error(`login ${res.statusCode}`);
  const jar = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
  const token = jar[SESSION_COOKIE] ?? "";
  const csrf = jar[CSRF_COOKIE] ?? "";
  return { token, headers: { cookie: `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}`, "x-csrf-token": csrf, origin: ORIGIN } };
}

/** Doğrudan servis çağrısı için oturumun (o anki, bayatlayabilecek) bağlamı. */
async function authOfSession(s: Session): Promise<AuthContext> {
  const a = await resolveSession(db(), s.token, new Date(), { setupEnforced: false });
  if (!a) throw new Error("oturum çözülemedi");
  return a;
}

const call = (s: Session, method: "GET" | "POST" | "PATCH", url: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { ...s.headers, ...headers }, ...(payload === undefined ? {} : { payload }) });

const etagOf = async (s: Session, id: string): Promise<string> => String((await call(s, "GET", `/users/${id}`)).headers.etag);

/** Kilit içinde bekleyen kanca: `entered` kancaya girildiğinde, `release()` TX'i sürdürür. */
function gate() {
  let release!: () => void;
  let enter!: () => void;
  const released = new Promise<void>((r) => (release = r));
  const entered = new Promise<void>((r) => (enter = r));
  return {
    entered,
    release,
    afterLock: async () => {
      enter();
      await released;
    },
  };
}

async function tenantAdmins() {
  const t = await createTenant();
  const strong = await createUser({ tenantId: t.id, role: "ADMIN" });
  const actor = await createUser({ tenantId: t.id, role: "ADMIN" });
  const target = await createUser({ tenantId: t.id, role: "USER" });
  return { tenantId: t.id, strong, actor, target };
}

const failAudits = (entityId: string | null, userId: string) =>
  db().auditLog.findMany({ where: { userId, result: "fail", ...(entityId ? { entityId } : {}) }, orderBy: { id: "asc" } });

describe("AC-202 satır kilidi + aktörün TX içinde yeniden okunması", () => {
  it("AC-202: paralel istekte yetkisi düşürülen aktörün işlemi 403 döner — gecikme kancalı, 20/20", async () => {
    for (let round = 0; round < 20; round++) {
      const { tenantId, strong, actor, target } = await tenantAdmins();
      const sStrong = await signIn(strong);
      const sActor = await signIn(actor);
      const strongAuth = await authOfSession(sStrong);
      const staleActor = await authOfSession(sActor); // users.edit VAR (oturumdaki kopya)
      expect(staleActor.permissions.has("users.edit")).toBe(true);
      const g = gate();
      // B: güçlü admin aktörün users.edit'ini kaldırır; aktör satırının kilidini tutarken bekler.
      const demote = updateUser(db(), fx(), CTX, strongAuth, tenantId, actor.id, { permissions: { "users.edit": false } }, 0, {
        afterLock: g.afterLock,
      });
      await g.entered;
      // A: aktör, bayat bağlamıyla hedefi düzenler → kilitte sıraya girer.
      const edit = updateUser(db(), fx(), CTX, staleActor, tenantId, target.id, { fullName: `Tur ${round}` }, 0).then(
        () => "ok",
        (e: { code?: string }) => e.code ?? "error",
      );
      g.release();
      await demote;
      expect(await edit, `tur ${round}`).toBe("FORBIDDEN");
      expect((await db().user.findUniqueOrThrow({ where: { id: target.id } })).fullName).toBe("Test Kullanıcı");
      const fails = await failAudits(target.id, actor.id);
      expect(fails.map((f) => f.newValue)).toEqual([{ op: "update", denied: ["users.edit"] }]);
    }
  });

  it("AC-202: iki yönetici aynı anda birbirini düzenler — id sıralı kilit, kilitlenme (deadlock) yok, ikisi de tamamlanır", async () => {
    for (let round = 0; round < 20; round++) {
      const t = await createTenant();
      const a = await createUser({ tenantId: t.id, role: "ADMIN" });
      const b = await createUser({ tenantId: t.id, role: "ADMIN" });
      const [authA, authB] = [await authOfSession(await signIn(a)), await authOfSession(await signIn(b))];
      const g = gate();
      const first = updateUser(db(), fx(), CTX, authA, t.id, b.id, { fullName: "B Yeni" }, 0, { afterLock: g.afterLock });
      await g.entered;
      const second = updateUser(db(), fx(), CTX, authB, t.id, a.id, { fullName: "A Yeni" }, 0);
      g.release();
      await expect(first).resolves.toMatchObject({ fullName: "B Yeni", version: 1 });
      await expect(second).resolves.toMatchObject({ fullName: "A Yeni", version: 1 });
    }
  });

  it("AC-202: pasife alınan aktörün bayat oturumdan gelen yazması 403 (oturum kopyasına değil DB'ye bakılır)", async () => {
    const { tenantId, actor, target } = await tenantAdmins();
    const stale = await authOfSession(await signIn(actor));
    await db().user.update({ where: { id: actor.id }, data: { status: "PASSIVE" } });
    await expect(updateUser(db(), fx(), CTX, stale, tenantId, target.id, { fullName: "X Y" }, 0)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await failAudits(target.id, actor.id)).map((f) => f.newValue)).toEqual([{ op: "update", denied: ["actor"] }]);
  });
});

describe("AC-203 hız sınırı", () => {
  it("AC-203: POST /users 10/dk (11. → 429 + Retry-After); /users yazma uçları toplam 30/dk (31. → 429); başka kullanıcı etkilenmez; okuma sınırsız", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const other = await createUser({ tenantId: t.id, role: "ADMIN" });
    const s = await signIn(admin);
    const mk = () => call(s, "POST", "/users", { email: `rl-${newId().toLowerCase()}@example.test`, fullName: "Hız Testi", role: "USER" });
    for (let i = 0; i < 10; i++) expect((await mk()).statusCode).toBe(201);
    const over = await mk();
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(Number(over.headers["retry-after"])).toBeGreaterThan(0);
    // yazma kovası: 11 olay sayıldı; 19 yazma daha geçer (404), 31. → 429
    for (let i = 0; i < 19; i++) expect((await call(s, "POST", `/users/${newId()}/deactivate`, {})).statusCode).toBe(404);
    const w = await call(s, "POST", `/users/${newId()}/deactivate`, {});
    expect(w.statusCode).toBe(429);
    expect(Number(w.headers["retry-after"])).toBeGreaterThan(0);
    expect((await call(s, "GET", "/users")).statusCode).toBe(200);
    expect((await call(await signIn(other), "POST", `/users/${newId()}/deactivate`, {})).statusCode).toBe(404);
  });

  it("AC-203: /admin/* yazma uçları Super Admin başına 30/dk (31. → 429 + Retry-After); okuma sınırsız", async () => {
    const sa = await signIn(await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    for (let i = 0; i < 30; i++) expect((await call(sa, "PATCH", `/admin/tenants/${newId()}`, { name: "Yok Firma" })).statusCode).toBe(404);
    const r = await call(sa, "POST", "/admin/switch-tenant", { tenantId: null });
    expect(r.statusCode).toBe(429);
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect((await call(sa, "GET", "/admin/tenants")).statusCode).toBe(200);
  });

  it("AC-203: e-posta çakışması (409) audit'e result=fail yazılır — e-posta değeri yazılmaz", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const s = await signIn(admin);
    const taken = await createUser({ tenantId: t.id, role: "USER" });
    const dup = await call(s, "POST", "/users", { email: taken.email, fullName: "Çakışan", role: "USER" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.fields).toHaveProperty("email");
    const u = (
      await call(s, "POST", "/users", { email: `x-${newId().toLowerCase()}@example.test`, fullName: "Diğer", role: "USER" })
    ).json<CreateUserResponse>().user;
    expect((await call(s, "PATCH", `/users/${u.id}`, { email: taken.email }, { "if-match": await etagOf(s, u.id) })).statusCode).toBe(409);
    const rows = await failAudits(null, admin.id);
    expect(rows.map((r) => [r.action, r.entityId, r.newValue])).toEqual([
      ["user.created", null, { op: "create", reason: "email_taken" }],
      ["user.updated", u.id, { op: "update", reason: "email_taken" }],
    ]);
    expect(JSON.stringify(rows.map((r) => [r.oldValue, r.newValue]))).not.toContain(taken.email);
  });
});

describe("AC-204 403 kararlarının audit'i", () => {
  it("AC-204: assertGrantable / üstünlük (canManage) / kendi hesabı reddi → result=fail, newValue {op, denied}; PII yok; DB değişmez", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN", perms: { "audit.export": false } });
    const strong = await createUser({ tenantId: t.id, role: "ADMIN" });
    const s = await signIn(admin);
    const u = (
      await call(s, "POST", "/users", { email: `d-${newId().toLowerCase()}@example.test`, fullName: "Hedef", role: "USER" })
    ).json<CreateUserResponse>().user;

    const grant = await call(s, "PATCH", `/users/${u.id}`, { permissions: { "audit.export": true } }, { "if-match": '"v0"' });
    expect(grant.statusCode).toBe(403);
    expect(grant.json().error.fields).toHaveProperty(["permissions.audit.export"]);
    expect((await call(s, "PATCH", `/users/${strong.id}`, { fullName: "Değişmez" }, { "if-match": '"v0"' })).statusCode).toBe(403);
    expect((await call(s, "POST", `/users/${strong.id}/deactivate`, {})).statusCode).toBe(403);
    expect((await call(s, "POST", `/users/${strong.id}/reset-mfa`, {})).statusCode).toBe(403);
    expect((await call(s, "PATCH", `/users/${admin.id}`, { role: "USER" }, { "if-match": '"v0"' })).statusCode).toBe(403);
    expect((await call(s, "POST", `/users/${admin.id}/deactivate`, {})).statusCode).toBe(403);
    expect(
      (await call(s, "POST", "/users", { email: `e-${newId().toLowerCase()}@example.test`, fullName: "Yeni", role: "ADMIN" })).statusCode,
    ).toBe(403);

    const rows = await failAudits(null, admin.id);
    expect(rows.map((r) => [r.action, r.entityId, r.newValue])).toEqual([
      ["user.updated", u.id, { op: "update", denied: ["audit.export"] }],
      ["user.updated", strong.id, { op: "update", denied: ["audit.export"] }],
      ["user.updated", strong.id, { op: "deactivate", denied: ["audit.export"] }],
      ["user.updated", strong.id, { op: "reset_mfa", denied: ["audit.export"] }],
      ["user.updated", admin.id, { op: "update", denied: expect.arrayContaining(["role"]) }],
      ["user.updated", admin.id, { op: "deactivate", denied: ["status"] }],
      ["user.created", null, { op: "create", denied: ["audit.export"] }],
    ]);
    for (const r of rows) {
      expect(r).toMatchObject({ tenantId: t.id, entity: "users", result: "fail", oldValue: null });
      expect(JSON.stringify(r.newValue)).not.toMatch(/@|Hedef|Değişmez|Yeni/);
    }
    expect(await db().user.findUniqueOrThrow({ where: { id: strong.id } })).toMatchObject({ status: "ACTIVE", version: 0 });
    expect((await db().user.findUniqueOrThrow({ where: { id: u.id } })).version).toBe(0);
  });
});

describe("S14-5 yetki kararı sürüm kontrolünden önce", () => {
  it("AC-204/S14-5: üstün hesaba ESKİ/yanlış sürümle gelen PATCH 409 değil 403 + denied audit; kendi rolü de eski sürümle 403", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN", perms: { "audit.export": false } });
    const strong = await createUser({ tenantId: t.id, role: "ADMIN" });
    const s = await signIn(admin);
    const wrong = { "if-match": '"v7"' };
    const r = await call(s, "PATCH", `/users/${strong.id}`, { fullName: "Değişmez" }, wrong);
    expect(r.statusCode).toBe(403);
    expect((await call(s, "PATCH", `/users/${admin.id}`, { role: "USER" }, wrong)).statusCode).toBe(403);
    expect((await failAudits(null, admin.id)).map((f) => [f.entityId, f.newValue])).toEqual([
      [strong.id, { op: "update", denied: ["audit.export"] }],
      [admin.id, { op: "update", denied: expect.arrayContaining(["role"]) }],
    ]);
    // Yetkili düzenleme eski sürümle hâlâ 409 (sıra değişti, kural aynı).
    const u = await createUser({ tenantId: t.id, role: "USER" });
    expect((await call(s, "PATCH", `/users/${u.id}`, { fullName: "Yeni" }, wrong)).statusCode).toBe(409);
    expect(await db().user.findUniqueOrThrow({ where: { id: strong.id } })).toMatchObject({ version: 0 });
  });
});

describe("AC-206 If-Match / ETag (iyimser kilit)", () => {
  it('AC-206: GET → version + ETag "v<n>"; If-Match yok/bozuk → 428; güncel → 200 + yeni ETag; eski sürüm → 409 STALE_WRITE ve mesaj', async () => {
    const { actor, target } = await tenantAdmins();
    const s = await signIn(actor);
    const g = await call(s, "GET", `/users/${target.id}`);
    expect(g.headers.etag).toBe('"v0"');
    expect(g.json<UserDetail>().version).toBe(0);
    for (const h of [{}, { "if-match": "*" }, { "if-match": "v0" }, { "if-match": 'W/"v0"' }, { "if-match": '"v0", "v1"' }] as Record<
      string,
      string
    >[]) {
      const r = await call(s, "PATCH", `/users/${target.id}`, { fullName: "Yeni Ad" }, h);
      expect(r.statusCode, JSON.stringify(h)).toBe(428);
      expect(r.json().error.code).toBe("PRECONDITION_REQUIRED");
    }
    const ok = await call(s, "PATCH", `/users/${target.id}`, { fullName: "Yeni Ad" }, { "if-match": '"v0"' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).toBe('"v1"');
    expect(ok.json<UserDetail>()).toMatchObject({ fullName: "Yeni Ad", version: 1 });
    const stale = await call(s, "PATCH", `/users/${target.id}`, { fullName: "Ezen Ad" }, { "if-match": '"v0"' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: "STALE_WRITE", message: "Kayıt başkası tarafından değiştirildi, yeniden yükleyin" });
    expect((await db().user.findUniqueOrThrow({ where: { id: target.id } })).fullName).toBe("Yeni Ad");
  });

  it("AC-206: yetki değişimi, pasif/aktif ve 2FA sıfırlama sürümü artırır; değişmeyen PATCH artırmaz", async () => {
    const { actor, target } = await tenantAdmins();
    const s = await signIn(actor);
    const v = async () => (await db().user.findUniqueOrThrow({ where: { id: target.id } })).version;
    expect(
      (await call(s, "PATCH", `/users/${target.id}`, { permissions: { "sessions.view": true } }, { "if-match": '"v0"' })).statusCode,
    ).toBe(200);
    expect(await v()).toBe(1);
    expect(
      (await call(s, "PATCH", `/users/${target.id}`, { permissions: { "sessions.view": true } }, { "if-match": '"v1"' })).statusCode,
    ).toBe(200);
    expect(await v()).toBe(1);
    expect((await call(s, "POST", `/users/${target.id}/deactivate`, {})).statusCode).toBe(204);
    expect(await v()).toBe(2);
    expect((await call(s, "POST", `/users/${target.id}/reactivate`, {})).statusCode).toBe(204);
    expect(await v()).toBe(3);
    await db().user.update({ where: { id: target.id }, data: { totpEnabled: true, totpSecretEnc: new Uint8Array(40) } });
    expect((await call(s, "POST", `/users/${target.id}/reset-mfa`, {})).statusCode).toBe(204);
    expect(await v()).toBe(4);
    expect((await call(s, "GET", `/users/${target.id}`)).headers.etag).toBe('"v4"');
  });

  it("AC-206: araya giren değişiklik — kilidi tutan kaydetme sürerken aynı sürümle gelen ikinci PATCH 409 (gecikme kancalı, 20/20)", async () => {
    for (let round = 0; round < 20; round++) {
      const { tenantId, strong, actor, target } = await tenantAdmins();
      const authStrong = await authOfSession(await signIn(strong));
      const s = await signIn(actor);
      const g = gate();
      const first = updateUser(db(), fx(), CTX, authStrong, tenantId, target.id, { fullName: "İlk Kaydeden" }, 0, {
        afterLock: g.afterLock,
      });
      await g.entered;
      const second = call(s, "PATCH", `/users/${target.id}`, { fullName: "İkinci Kaydeden" }, { "if-match": '"v0"' });
      g.release();
      await expect(first).resolves.toMatchObject({ version: 1 });
      const r = await second;
      expect(r.statusCode, `tur ${round}`).toBe(409);
      expect(r.json().error.code).toBe("STALE_WRITE");
      expect((await db().user.findUniqueOrThrow({ where: { id: target.id } })).fullName).toBe("İlk Kaydeden");
    }
  });

  it("AC-206 kilitlenme: iki firmada eşzamanlı yetki yazımı (en yeni kullanıcılar) 1213 deadlock / 503 vermez — replacePermissions aralık kilidi almaz (bariyerli, 10/10)", async () => {
    // QA P16 Tur 2: `DELETE … WHERE user_id = ?` boş aralıkta dizin sonundaki boşluğu kilitliyordu; iki TX'in ikisi de
    // silip sonra eklediğinde 1213. Bariyer iki TX'i ekleme öncesinde buluşturur (eski kodda deadlock kesindi).
    type Rows = { permKey: string; granted: boolean }[];
    for (let round = 0; round < 10; round++) {
      const [t1, t2] = [await createTenant(), await createTenant()];
      const seed = { "sessions.view": true, "users.view": false, "audit.view": true };
      const users =
        round % 2 === 0
          ? [await createUser({ tenantId: t1.id }), await createUser({ tenantId: t2.id })]
          : [await createUser({ tenantId: t1.id, perms: seed }), await createUser({ tenantId: t2.id, perms: seed })];
      // Tek satırlı turlarda yalnız ekleme; dolu turlarda silme (audit.view) + çevirme (users.view) + ekleme (sessions.terminate).
      const want: Rows =
        round % 2 === 0
          ? [{ permKey: "sessions.view", granted: true }]
          : [
              { permKey: "sessions.view", granted: true },
              { permKey: "users.view", granted: true },
              { permKey: "sessions.terminate", granted: false },
            ];
      let arrived = 0;
      let open!: () => void;
      const gateOpen = new Promise<void>((r) => (open = r));
      const atBarrier = async () => {
        if (++arrived === 2) open();
        await gateOpen;
      };
      const write = (userId: string) =>
        db().$transaction(async (tx) => {
          await lockUsers(tx, [userId]);
          const perm = tx.userPermission;
          const paused = new Proxy(perm, {
            get: (target, key, receiver) =>
              key === "createMany"
                ? async (args: Parameters<typeof perm.createMany>[0]) => {
                    await atBarrier();
                    return target.createMany(args);
                  }
                : Reflect.get(target, key, receiver),
          });
          await replacePermissions(
            new Proxy(tx, { get: (t, k, r) => (k === "userPermission" ? paused : Reflect.get(t, k, r)) }),
            userId,
            want,
          );
        });
      const results = await Promise.allSettled(users.map((u) => write(u.id)));
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      for (const u of users) {
        const rows = await db().userPermission.findMany({
          where: { userId: u.id },
          select: { permKey: true, granted: true },
          orderBy: { permKey: "asc" },
        });
        expect(rows).toEqual([...want].sort((a, b) => a.permKey.localeCompare(b.permKey)));
      }
    }
  });
});

describe("AC-207 diff tabanlı audit (users-p9 kalıbı)", () => {
  it("AC-207: ADMIN aktör + kilitli anahtar + rol değişimi + tam yetki haritası → 200; aynı gövde tekrar → 200, fazladan audit satırı ve sürüm artışı yok", async () => {
    const t = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN", perms: { "audit.export": false } });
    const s = await signIn(admin);
    const u = (
      await call(s, "POST", "/users", { email: `f-${newId().toLowerCase()}@example.test`, fullName: "Terfi", role: "USER" })
    ).json<CreateUserResponse>().user;
    const full = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, k !== "audit.export"]));
    const body = { role: "ADMIN", permissions: full };
    const r1 = await call(s, "PATCH", `/users/${u.id}`, body, { "if-match": '"v0"' });
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r1.json<UserDetail>()).toMatchObject({ role: "ADMIN", version: 1 });
    expect(r1.json<UserDetail>().permissions["audit.export"]).toBe(false);
    const count = () => db().auditLog.count({ where: { entityId: u.id } });
    const before = await count();
    // oluşturma satırı yok (USER varsayılanı); terfi: audit.export dışındaki her anahtar bir satır
    expect(await db().auditLog.count({ where: { entityId: u.id, action: "user.permission_changed" } })).toBe(PERMISSION_KEYS.length - 1);
    const r2 = await call(s, "PATCH", `/users/${u.id}`, body, { "if-match": '"v1"' });
    expect(r2.statusCode).toBe(200);
    expect(r2.json<UserDetail>().version).toBe(1);
    expect(await count()).toBe(before);
    expect(await db().auditLog.count({ where: { entityId: u.id, result: "fail" } })).toBe(0);
  });
});

describe("AC-225 GET /users/options (teknisyen seçenekleri)", () => {
  it("AC-225: 150 teknisyenli fixture'da 150 (+ yönetici) seçenek, ad sırası, pasifler dahil; yalnız kendi tenant'ı (izolasyon); Super Admin firma seçmeden 403", async () => {
    const t = await createTenant();
    const other = await createTenant();
    const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
    const ids = Array.from({ length: 150 }, () => newId());
    await db().user.createMany({
      data: ids.map((id, i) => ({
        id,
        tenantId: t.id,
        email: `opt-${id.toLowerCase()}@example.test`,
        fullName: `Teknisyen ${String(149 - i).padStart(3, "0")}`,
        role: "USER",
        passwordHash: "x",
        status: i % 10 === 0 ? "PASSIVE" : "ACTIVE",
      })),
    });
    const foreign = await createUser({ tenantId: other.id, role: "USER" });
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const res = await call(await signIn(admin), "GET", "/users/options");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const items = res.json<UserOptionsResponse>().items;
    expect(items).toHaveLength(151);
    expect(items.filter((i) => i.fullName.startsWith("Teknisyen"))).toHaveLength(150);
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(["fullName", "id", "status"]);
    const names = items.map((i) => i.fullName);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(items.filter((i) => i.status === "PASSIVE")).toHaveLength(15);
    expect(res.body).not.toContain(foreign.id);
    expect(res.body).not.toContain(sa.id);
    expect(res.body).not.toContain("@");
    expect((await call(await signIn(sa), "GET", "/users/options")).statusCode).toBe(403);
  });

  it("AC-225: rol kapsamı — USER yalnız kendisi; yetki session_history.view | support_requests.view | users.view (biri yeter), hiçbiri yoksa 403; boş liste değil kendisi", async () => {
    const t = await createTenant();
    await createUser({ tenantId: t.id, role: "ADMIN" });
    for (const perm of ["session_history.view", "support_requests.view", "users.view"]) {
      const u = await createUser({ tenantId: t.id, role: "USER", perms: { [perm]: true } });
      const r = await call(await signIn(u), "GET", "/users/options");
      expect(r.statusCode, perm).toBe(200);
      expect(r.json<UserOptionsResponse>().items).toEqual([{ id: u.id, fullName: "Test Kullanıcı", status: "ACTIVE" }]);
    }
    const none = await createUser({ tenantId: t.id, role: "USER", perms: { "sessions.view": true } });
    expect((await call(await signIn(none), "GET", "/users/options")).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/users/options" })).statusCode).toBe(401);
  });

  it("AC-225: ?tenantId= izolasyonu — firma seçmemiş Super Admin o firmanın listesini görür; USER/ADMIN parametreyle başka firmayı göremez (yok sayılır); geçersiz/bilinmeyen 400/404", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const adminA = await createUser({ tenantId: a.id, role: "ADMIN" });
    const userA = await createUser({ tenantId: a.id, role: "USER", perms: { "session_history.view": true } });
    const adminB = await createUser({ tenantId: b.id, role: "ADMIN" });
    const userB = await createUser({ tenantId: b.id, role: "USER" });
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const ids = (r: { json: <T>() => T }) => r.json<UserOptionsResponse>().items.map((i) => i.id);

    const saS = await signIn(sa);
    const saB = await call(saS, "GET", `/users/options?tenantId=${b.id}`);
    expect(saB.statusCode).toBe(200);
    expect(saB.headers["cache-control"]).toBe("no-store");
    expect(ids(saB).sort()).toEqual([adminB.id, userB.id].sort());
    expect(ids(await call(saS, "GET", `/users/options?tenantId=${a.id}`)).sort()).toEqual([adminA.id, userA.id].sort());
    // parametresiz → mevcut 403; bozuk kimlik 400; olmayan firma 404; bilinmeyen parametre 400 (strict)
    expect((await call(saS, "GET", "/users/options")).statusCode).toBe(403);
    expect((await call(saS, "GET", "/users/options?tenantId=bozuk")).statusCode).toBe(400);
    expect((await call(saS, "GET", `/users/options?tenantId=${newId()}`)).statusCode).toBe(404);
    expect((await call(saS, "GET", `/users/options?tenantId=${b.id}&x=1`)).statusCode).toBe(400);

    // ADMIN A, B'yi isterse yine yalnız kendi firması (parametre yok sayılır); B'den hiçbir kimlik sızmaz
    const admR = await call(await signIn(adminA), "GET", `/users/options?tenantId=${b.id}`);
    expect(admR.statusCode).toBe(200);
    expect(ids(admR).sort()).toEqual([adminA.id, userA.id].sort());
    expect(admR.body).not.toContain(adminB.id);
    expect(admR.body).not.toContain(userB.id);
    // USER A, B'yi isterse yalnız kendisi
    const usrR = await call(await signIn(userA), "GET", `/users/options?tenantId=${b.id}`);
    expect(usrR.statusCode).toBe(200);
    expect(ids(usrR)).toEqual([userA.id]);
  });
});
