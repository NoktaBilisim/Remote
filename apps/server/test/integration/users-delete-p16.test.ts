// P16 G4 — kalıcı kullanıcı silme (mezar taşı) ve fail-closed audit maskesi (AC-237, AC-241; ADR-0030 m.4, S16-1, S16-7).
// Gerçek MySQL + inject. Eski e-posta/ad yanıt gövdelerinde (liste, CSV, oturum zaman çizelgesi) aranır → 0.
import { readFile } from "node:fs/promises";
import { Writable } from "node:stream";
import type { AuditListResponse } from "@remote/contracts/api/audit";
import type { SessionHistoryDetail } from "@remote/contracts/api/sessions";
import { userEtag, type CreateUserResponse, type UserDetail, type UserOptionsResponse } from "@remote/contracts/api/users";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findUserByLogin } from "../../src/auth/repo.ts";
import { newId } from "../../src/lib/ids.ts";
import { createLogger } from "../../src/lib/logger.ts";
import {
  createSupportSessionRow,
  createTenant,
  createUser,
  loginAs,
  loginRequest,
  loginStepUp,
  makeApp,
  TEST_LEDGER_PATH,
  testDb,
  type Session,
} from "../helpers/app.ts";

const lines: string[] = [];
let app: FastifyInstance;
beforeAll(async () => {
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(...chunk.toString().split("\n").filter(Boolean));
      cb();
    },
  });
  app = makeApp({ logger: createLogger("info", sink) });
  await app.ready();
});
afterAll(() => app.close());

let ipSeq = 0;
const nextIp = () => `10.41.${Math.floor(++ipSeq / 250) + 1}.${(ipSeq % 250) + 1}`;
const errOf = (r: { json: <T>() => T }) => r.json<{ error: { code: string; fields?: Record<string, string> } }>().error;

const del = (s: Session, id: string, version: number | null, confirmName: string) =>
  app.inject({
    method: "DELETE",
    url: `/api/v1/users/${id}`,
    headers: { ...s.headers, ...(version === null ? {} : { "if-match": userEtag(version) }) },
    payload: { confirmName },
  });

const getUser = async (s: Session, id: string) =>
  (await app.inject({ method: "GET", url: `/api/v1/users/${id}`, headers: s.headers })).json<UserDetail>();

const deactivate = (s: Session, id: string) =>
  app.inject({ method: "POST", url: `/api/v1/users/${id}/deactivate`, headers: s.headers, payload: {} });

/** Admin (step-up'lı) + API ile oluşturulmuş benzersiz e-posta/adlı hedef (user.created audit'i e-posta + ad taşır). */
async function fixture() {
  const t = await createTenant();
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const s = await loginStepUp(app, admin);
  const tag = newId().toLowerCase().slice(-10);
  const email = `silinecek-${tag}@ornek.test`;
  const fullName = `Zeynep Silinecek ${tag}`;
  const res = await app.inject({ method: "POST", url: "/api/v1/users", headers: s.headers, payload: { email, fullName, role: "USER" } });
  expect(res.statusCode, res.body).toBe(201);
  const created = res.json<CreateUserResponse>();
  return { t, admin, s, email, fullName, id: created.user.id, temp: created.temporaryPassword };
}

describe("AC-237/AC-241 DELETE /users/:id", () => {
  it("AC-237: users.delete anahtarı olmayan Admin → 403 (step-up'lı olsa da); USER → 403", async () => {
    const f = await fixture();
    expect((await deactivate(f.s, f.id)).statusCode).toBe(204);
    const v = (await getUser(f.s, f.id)).version;
    const noKey = await createUser({ tenantId: f.t.id, role: "ADMIN", perms: { "users.delete": false } });
    const r = await del(await loginStepUp(app, noKey), f.id, v, f.fullName);
    expect(r.statusCode).toBe(403);
    expect(errOf(r).code).toBe("FORBIDDEN");
    const user = await createUser({ tenantId: f.t.id, role: "USER", perms: { "users.view": true } });
    expect((await del(await loginStepUp(app, user), f.id, v, f.fullName)).statusCode).toBe(403);
    expect((await testDb().user.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("PASSIVE");
  });

  it("AC-241: ACTIVE 409; ad eşleşmezse 400; If-Match yok 428; step-up yok 401; kendi 403; Super Admin / başka firma 404 (S16-17)", async () => {
    const f = await fixture();
    const v0 = (await getUser(f.s, f.id)).version;
    const active = await del(f.s, f.id, v0, f.fullName);
    expect(active.statusCode).toBe(409);
    expect(errOf(active).code).toBe("CONFLICT");
    expect((await deactivate(f.s, f.id)).statusCode).toBe(204);
    const v = (await getUser(f.s, f.id)).version;
    const wrong = await del(f.s, f.id, v, f.fullName.toUpperCase());
    expect(wrong.statusCode).toBe(400);
    expect(errOf(wrong).fields).toHaveProperty("confirmName");
    expect((await del(f.s, f.id, null, f.fullName)).statusCode).toBe(428);
    expect(errOf(await del(f.s, f.id, v - 1, f.fullName)).code).toBe("STALE_WRITE");
    const plain = await loginAs(app, await createUser({ tenantId: f.t.id, role: "ADMIN" }));
    expect(errOf(await del(plain, f.id, v, f.fullName)).code).toBe("MFA_SETUP_REQUIRED");
    const self = await del(f.s, f.admin.id, 0, "Test Kullanıcı");
    expect(self.statusCode).toBe(403);
    // S16-17: Super Admin kimliği kapsam dışı → başka firma / olmayan kimlikle aynı 404 (403 ile ayırt edilemez) ve
    // firmanın audit'ine Super Admin kimliğiyle satır yazılmaz.
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const saRes = await del(f.s, sa.id, 0, "Test Kullanıcı");
    const other = await fixture();
    const otherRes = await del(f.s, other.id, 0, other.fullName);
    const ghostRes = await del(f.s, newId(), 0, "Test Kullanıcı");
    for (const r of [saRes, otherRes, ghostRes]) expect(r.statusCode).toBe(404);
    const body = (r: typeof saRes) => ({ ...errOf(r), requestId: undefined });
    expect(body(saRes)).toEqual(body(ghostRes));
    expect(await testDb().auditLog.count({ where: { entityId: sa.id } })).toBe(0);
    expect((await testDb().user.findUniqueOrThrow({ where: { id: sa.id } })).status).toBe("ACTIVE");
    // Reddedilen 403 (kendi hesabı) PII'siz fail audit'i yazar.
    const fails = await testDb().auditLog.findMany({ where: { userId: f.admin.id, action: "user.deleted", result: "fail" } });
    expect(fails.length).toBe(1);
    for (const a of fails) expect(JSON.stringify(a.newValue)).not.toContain("@");
    expect((await testDb().user.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("PASSIVE");
    // S16-18: reddedilen istekler (409/400/428/403/404) deftere niyet satırı bırakmaz (geri yüklemede silinmez).
    const ledger = await readFile(TEST_LEDGER_PATH, "utf8").catch(() => "");
    for (const id of [f.id, sa.id, other.id]) expect(ledger).not.toContain(id);
  });

  it("AC-241: step-up yoksa 401 MFA_STEP_UP_REQUIRED", async () => {
    const f = await fixture();
    await deactivate(f.s, f.id);
    await testDb().authSession.updateMany({ where: { userId: f.admin.id }, data: { stepUpAt: null } });
    const r = await del(f.s, f.id, (await getUser(f.s, f.id)).version, f.fullName);
    expect(r.statusCode).toBe(401);
    expect(errOf(r).code).toBe("MFA_STEP_UP_REQUIRED");
  });

  it("AC-241: mezar taşı alanları ADR-0030 m.4; avatar dosyası yok; alt tablolar silinir; audit PII'siz; defter satırı; 404/liste/options", async () => {
    const f = await fixture();
    const rel = await app.uploads.save(f.t.id, "png", Buffer.from("not-really-png"));
    await testDb().user.update({ where: { id: f.id }, data: { avatarPath: rel } });
    await testDb().recoveryCode.create({ data: { id: newId(), userId: f.id, codeHash: "a".repeat(64) } });
    await testDb().userPermission.create({ data: { userId: f.id, permKey: "audit.view", granted: true } });
    expect((await deactivate(f.s, f.id)).statusCode).toBe(204);
    const v = (await getUser(f.s, f.id)).version;
    const nfd = `  ${f.fullName.normalize("NFD")} `;
    const r = await del(f.s, f.id, v, nfd);
    expect(r.statusCode, r.body).toBe(204);

    const u = await testDb().user.findUniqueOrThrow({ where: { id: f.id } });
    expect(u).toMatchObject({
      status: "DELETED",
      email: `deleted+${f.id}@invalid`,
      username: null,
      fullName: `Silinmiş kullanıcı #${f.id.slice(-6)}`,
      passwordHash: "!deleted",
      avatarPath: null,
      totpSecretEnc: null,
      totpEnabled: false,
      totpLastStep: null,
      failedLoginCount: 0,
      failedWindowAt: null,
      lockedUntil: null,
      version: v + 1,
    });
    expect(u.deletedAt).not.toBeNull();
    expect(await app.uploads.read(rel)).toBeNull();
    for (const n of [
      await testDb().userPermission.count({ where: { userId: f.id } }),
      await testDb().recoveryCode.count({ where: { userId: f.id } }),
      await testDb().passwordResetToken.count({ where: { userId: f.id } }),
      await testDb().authSession.count({ where: { userId: f.id } }),
    ])
      expect(n).toBe(0);
    const a = await testDb().auditLog.findFirstOrThrow({ where: { action: "user.deleted", entityId: f.id, result: "success" } });
    expect(a.userId).toBe(f.admin.id);
    const raw = JSON.stringify([a.oldValue, a.newValue]);
    expect(raw).not.toContain(f.email);
    expect(raw).not.toContain(f.fullName);
    expect(a.newValue).toMatchObject({ status: "DELETED", deletedPermissions: 1, deletedMfaBackups: 1 });
    // S16-18: TX içinde (denetimlerden sonra) niyet satırı, commit sonrası done satırı.
    const ledger = (await readFile(TEST_LEDGER_PATH, "utf8")).split("\n").filter(Boolean);
    const mine = ledger.map((l) => JSON.parse(l) as { type: string; id: string; phase?: string }).filter((l) => l.id === f.id);
    expect(mine.map((l) => [l.type, l.phase])).toEqual([
      ["user", "intent"],
      ["user", "done"],
    ]);
    expect(ledger.join("\n")).not.toContain(f.email);

    expect((await app.inject({ method: "GET", url: `/api/v1/users/${f.id}`, headers: f.s.headers })).statusCode).toBe(404);
    const list = await app.inject({ method: "GET", url: "/api/v1/users?status=all", headers: f.s.headers });
    expect(list.body).not.toContain(f.id);
    const opts = (await app.inject({ method: "GET", url: "/api/v1/users/options", headers: f.s.headers })).json<UserOptionsResponse>();
    expect(opts.items.some((i) => i.id === f.id)).toBe(false);
    const withDel = (
      await app.inject({ method: "GET", url: "/api/v1/users/options?includeDeleted=1", headers: f.s.headers })
    ).json<UserOptionsResponse>();
    expect(withDel.items).toContainEqual({ id: f.id, fullName: `Silinmiş kullanıcı #${f.id.slice(-6)}`, status: "DELETED" });
    // Çift gönderim: zaten silinmiş → 404; DB satırı tetikleyiciyle kilitli.
    expect((await del(f.s, f.id, v + 1, u.fullName)).statusCode).toBe(404);
    await expect(testDb().user.update({ where: { id: f.id }, data: { fullName: "geri" } })).rejects.toThrow();
  });

  it("AC-241: açık destek oturumu olan pasif kullanıcı → 409", async () => {
    const f = await fixture();
    await deactivate(f.s, f.id);
    await createSupportSessionRow({ tenantId: f.t.id, technicianId: f.id, status: "ACTIVE" });
    const r = await del(f.s, f.id, (await getUser(f.s, f.id)).version, f.fullName);
    expect(r.statusCode).toBe(409);
    expect(errOf(r).code).toBe("CONFLICT");
  });
});

describe("AC-241 audit maskesi (fail-closed, S16-1)", () => {
  it("AC-241: liste, CSV ve oturum zaman çizelgesi gövdelerinde silinen kullanıcının eski e-posta/adı 0 kez geçer", async () => {
    const f = await fixture();
    // Kullanıcının kendi audit satırları (giriş: username = e-posta) ve zaman çizelgesi olayı.
    await testDb().user.update({ where: { id: f.id }, data: { mustChangePassword: false } });
    const login = await app.inject(loginRequest(f.email, f.temp, { remoteAddress: nextIp() }));
    expect(login.statusCode).toBe(200);
    const sess = await createSupportSessionRow({ tenantId: f.t.id, technicianId: f.id, status: "ENDED" });
    await testDb().auditLog.create({
      data: {
        tenantId: f.t.id,
        userId: f.id,
        username: f.email,
        action: "control.requested",
        entity: "support_sessions",
        entityId: sess.id,
        result: "success",
        newValue: { level: "CONTROL" },
      },
    });
    // Admin e-postayı değiştirir → user.updated eski/yeni e-posta taşır.
    const v = (await getUser(f.s, f.id)).version;
    const newEmail = `ikinci-${f.email}`;
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${f.id}`,
      headers: { ...f.s.headers, "if-match": userEtag(v) },
      payload: { email: newEmail },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    await deactivate(f.s, f.id);
    expect((await del(f.s, f.id, (await getUser(f.s, f.id)).version, f.fullName)).statusCode).toBe(204);

    const secrets = [f.email, newEmail, f.fullName];
    const bodies: string[] = [];
    for (const userId of [f.id, f.admin.id]) {
      const res = await app.inject({ method: "GET", url: `/api/v1/audit?userId=${userId}`, headers: f.s.headers });
      expect(res.statusCode).toBe(200);
      bodies.push(res.body);
      const csv = await app.inject({ method: "GET", url: `/api/v1/audit/export.csv?userId=${userId}`, headers: f.s.headers });
      expect(csv.statusCode).toBe(200);
      bodies.push(csv.body);
    }
    const own = JSON.parse(bodies[0] ?? "{}") as AuditListResponse;
    expect(own.items.length).toBeGreaterThanOrEqual(2);
    const label = `Silinmiş kullanıcı #${f.id.slice(-6)}`;
    for (const i of own.items) expect(i).toMatchObject({ identityMasked: true, actorLabel: label, userFullName: label });
    expect(own.items.find((i) => i.action === "auth.login")?.username).toBe("s***@***");
    const adminRows = (JSON.parse(bodies[2] ?? "{}") as AuditListResponse).items.filter((i) => i.entityId === f.id);
    expect(adminRows.find((i) => i.action === "user.created")?.newValue).toMatchObject({ email: "***", fullName: "***" });
    const hist = await app.inject({ method: "GET", url: `/api/v1/sessions/${sess.id}/history`, headers: f.s.headers });
    expect(hist.statusCode, hist.body).toBe(200);
    bodies.push(hist.body);
    const tl = hist.json<SessionHistoryDetail>().timeline.find((e) => e.action === "control.requested");
    expect(tl?.actorName).toBe(label);
    for (const body of bodies) for (const s of secrets) expect(body.includes(s), `${s} gövdede`).toBe(false);
  });

  it("AC-241: kullanıcı satırı hiç olmayan ve firma satırı olmayan (fikstür) audit satırında da maske uygulanır", async () => {
    const sa = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    const s = await loginAs(app, sa);
    const ghostUser = newId();
    const ghostTenant = newId();
    const t = await createTenant();
    const ghostEmail = `hayalet-${ghostUser.toLowerCase()}@ornek.test`;
    await testDb().auditLog.createMany({
      data: [
        {
          tenantId: t.id,
          userId: ghostUser,
          username: ghostEmail,
          action: "auth.login",
          entity: "users",
          entityId: ghostUser,
          result: "success",
          newValue: { nested: { fullName: "Hayalet Ad", list: [{ email: ghostEmail }] }, ok: 1 },
        },
        {
          tenantId: ghostTenant,
          userId: null,
          username: ghostEmail,
          action: "customer.updated",
          entity: "customer",
          entityId: null,
          result: "success",
          newValue: { contactName: "Hayalet Kişi", phone: "+905321112233", status: "ACTIVE" },
        },
      ],
    });
    const a = await app.inject({ method: "GET", url: `/api/v1/audit?userId=${ghostUser}`, headers: s.headers });
    const b = await app.inject({ method: "GET", url: `/api/v1/audit?tenantId=${ghostTenant}`, headers: s.headers });
    const c = await app.inject({ method: "GET", url: `/api/v1/audit/export.csv?tenantId=${ghostTenant}`, headers: s.headers });
    for (const r of [a, b, c]) {
      expect(r.statusCode).toBe(200);
      for (const secret of [ghostEmail, "Hayalet Ad", "Hayalet Kişi", "1112233"]) expect(r.body).not.toContain(secret);
    }
    const ia = a.json<AuditListResponse>().items[0];
    expect(ia).toMatchObject({ identityMasked: true, username: "h***@***", actorLabel: `Silinmiş kullanıcı #${ghostUser.slice(-6)}` });
    expect(ia?.newValue).toEqual({ nested: { fullName: "***", list: [{ email: "***" }] }, ok: 1 });
    const ib = b.json<AuditListResponse>().items[0];
    expect(ib).toMatchObject({
      identityMasked: true,
      tenantName: null,
      tenantLabel: `Silinmiş firma #${ghostTenant.slice(-6)}`,
      actorLabel: null,
    });
    expect(ib?.newValue).toEqual({ contactName: "***", phone: "***", status: "ACTIVE" });
    expect(c.body).toContain(`Silinmiş firma #${ghostTenant.slice(-6)}`);
  });

  it("AC-241: canlı kullanıcı/firma satırı maskelenmez", async () => {
    const f = await fixture();
    const res = (
      await app.inject({ method: "GET", url: `/api/v1/audit?userId=${f.admin.id}`, headers: f.s.headers })
    ).json<AuditListResponse>();
    const created = res.items.find((i) => i.action === "user.created" && i.entityId === f.id);
    expect(created).toMatchObject({ identityMasked: false, actorLabel: "Test Kullanıcı" });
    expect(created?.newValue).toMatchObject({ email: f.email, fullName: f.fullName });
  });
});

describe("AC-241 S16-7 mezar taşıyla giriş", () => {
  it("AC-241: mezar taşı e-postasıyla 6 deneme → 401/423; auth_fail_counter_fallback logu yok; posta denenmez; sıfırlama isteği olmayan hesap", async () => {
    const f = await fixture();
    await deactivate(f.s, f.id);
    expect((await del(f.s, f.id, (await getUser(f.s, f.id)).version, f.fullName)).statusCode).toBe(204);
    const tomb = `deleted+${f.id}@invalid`;
    const before = lines.length;
    const ip = nextIp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await app.inject(loginRequest(tomb, "!deleted", { remoteAddress: ip }))).statusCode);
    expect(codes.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(codes.slice(4)).toEqual([423, 423]);
    // Eski e-postayla da hesap yok (adres serbest değil ama hesap bulunmaz).
    expect((await app.inject(loginRequest(f.email, f.temp, { remoteAddress: nextIp() }))).statusCode).toBe(401);
    // Parola sıfırlama isteği de `findUserByLogin`'i kullanır (mezar taşı adresi zaten e-posta şemasından geçmez → 400).
    expect(await findUserByLogin(testDb(), tomb)).toBeNull();
    expect(await findUserByLogin(testDb(), f.email)).toBeNull();
    const after = lines.slice(before).join("\n");
    expect(after).not.toContain("auth_fail_counter_fallback");
    expect(await testDb().auditLog.count({ where: { action: { startsWith: "mail." }, entityId: f.id } })).toBe(0);
    expect(
      await testDb().auditLog.count({ where: { action: "auth.login", userId: f.id, createdAt: { gt: new Date(Date.now() - 60_000) } } }),
    ).toBe(0);
    expect((await testDb().user.findUniqueOrThrow({ where: { id: f.id } })).failedLoginCount).toBe(0);
  });
});
