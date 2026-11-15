// P13b `reset-superadmin` CLI (mimari-p13 §7.7; AC önerisi §7.15-b, AC-90): gerçek MySQL, `app` kullanıcısı.
import { AUTH_AUDIT } from "@remote/contracts/audit";
import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import { spawnSync } from "node:child_process";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT, runResetSuperadmin, type CliIo, type CliRuntime } from "../../src/cli/reset-superadmin.ts";
import { createDb } from "../../src/lib/db.ts";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import { createLogger } from "../../src/lib/logger.ts";
import { createTenant, createUser, loginAs, loginRequest, makeApp, testDb, testFixtureDb, type TestUser } from "../helpers/app.ts";

const SERVER_DIR = fileURLToPath(new URL("../..", import.meta.url));
const app = makeApp();
afterAll(() => app.close());

interface Run {
  code: number;
  out: string;
  err: string;
  logs: string;
}

/** CLI'yi süreç içinde çalıştırır: sahte TTY (isTTY) + test DB'si; logger çıktısı ayrıca yakalanır (AC-90 taraması). */
async function runCli(argv: string[], o: { isTTY?: boolean; runtime?: () => CliRuntime } = {}): Promise<Run> {
  const r: Run = { code: -1, out: "", err: "", logs: "" };
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      r.logs += chunk.toString("utf8");
      cb();
    },
  });
  const io: CliIo = { isTTY: o.isTTY ?? true, out: (t) => (r.out += t), err: (t) => (r.err += t) };
  const runtime = o.runtime ?? (() => ({ db: testDb(), logger: createLogger("debug", sink), close: async () => undefined }));
  r.code = await runResetSuperadmin(argv, io, runtime);
  return r;
}

const tempPasswordOf = (out: string): string => /Geçici şifre \(yalnız bir kez gösterilir\): (\S+)/.exec(out)?.[1] ?? "";

const userRow = (id: string) =>
  testDb().user.findUniqueOrThrow({
    where: { id },
    select: {
      passwordHash: true,
      mustChangePassword: true,
      failedLoginCount: true,
      failedWindowAt: true,
      lockedUntil: true,
      totpEnabled: true,
      totpSecretEnc: true,
      totpLastStep: true,
    },
  });

const resetAudits = (where: { entityId?: string | null; result?: string } = {}) =>
  testDb().auditLog.findMany({ where: { action: AUTH_AUDIT.SUPERADMIN_RESET, ...where }, orderBy: { id: "asc" } });

/** 2FA kurulu, kilitli, açık oturumlu ve açık sıfırlama bağlantılı Super Admin. */
async function preparedSuperAdmin(): Promise<{ user: TestUser; cookie: string }> {
  const user = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
  const session = await loginAs(app, user);
  const db = testDb();
  await db.user.update({
    where: { id: user.id },
    data: {
      totpEnabled: true,
      totpSecretEnc: Buffer.alloc(48, 7),
      totpLastStep: 123n,
      failedLoginCount: 4,
      failedWindowAt: new Date(),
      lockedUntil: new Date(Date.now() + 15 * 60_000),
    },
  });
  await db.recoveryCode.createMany({ data: [1, 2].map(() => ({ id: newId(), userId: user.id, codeHash: sha256Hex(newId()) })) });
  await db.passwordResetToken.create({
    data: { id: newId(), userId: user.id, tokenHash: sha256Hex(newId()), expiresAt: new Date(Date.now() + 30 * 60_000) },
  });
  return { user, cookie: `${SESSION_COOKIE}=${session.token}` };
}

describe("P13b reset-superadmin CLI (§7.7)", () => {
  let tenantId: string;
  beforeAll(async () => {
    tenantId = (await createTenant()).id;
  });

  it("AC-yeni(b)/AC-90: hash değişir, ilk girişte değişim zorunlu, kilit/sayaç sıfır, oturumlar ve sıfırlama bağlantıları iptal; parola yalnız TTY'de bir kez, audit ve logda yok", async () => {
    const { user, cookie } = await preparedSuperAdmin();
    const before = await userRow(user.id);

    // Login normalizasyonu: büyük harf + boşluk
    const r = await runCli(["--email", `  ${user.email.toUpperCase()} `]);
    expect(r.code).toBe(EXIT.OK);
    const temp = tempPasswordOf(r.out);
    expect(temp).toMatch(/^[A-HJ-NP-Za-km-z2-9]{20}$/);
    expect(r.out.split(temp).length - 1).toBe(1);
    expect(r.err).toBe("");

    const after = await userRow(user.id);
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after).toMatchObject({ mustChangePassword: true, failedLoginCount: 0, failedWindowAt: null, lockedUntil: null });
    // --reset-mfa yok → 2FA dokunulmadı
    expect(after).toMatchObject({ totpEnabled: true, totpLastStep: 123n });
    expect(await testDb().recoveryCode.count({ where: { userId: user.id } })).toBe(2);
    expect(await testDb().authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await testDb().passwordResetToken.count({ where: { userId: user.id, usedAt: null } })).toBe(0);
    // Eski çerez HTTP'de hemen reddedilir
    expect((await app.inject({ url: "/api/v1/auth/me", headers: { cookie } })).statusCode).toBe(401);
    // Geçici parola ile giriş olur (2FA hâlâ açık → MFA aşaması), değişim zorunlu
    const login = await app.inject(loginRequest(user.email, temp));
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ mustChangePassword: true });

    const audits = await resetAudits({ entityId: user.id });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      userId: null,
      username: "cli",
      tenantId: null,
      entity: "users",
      userAgent: "reset-superadmin-cli",
      result: "success",
    });
    expect(audits[0]?.ipAddress ?? "").toBe("");
    expect(audits[0]?.newValue).toEqual({ mustChangePassword: true, mfaReset: false, revokedSessions: 1 });
    const auditText = JSON.stringify(audits, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v));
    expect(auditText).not.toContain(temp);
    expect(auditText).not.toContain(after.passwordHash);
    expect(r.logs).toContain("superadmin_reset");
    expect(r.logs).not.toContain(temp);
    expect(r.logs).not.toContain(after.passwordHash);
  });

  it("AC-yeni(b): --reset-mfa TOTP sırrını, son adımı ve kurtarma kodlarını siler; audit mfaReset=true", async () => {
    const { user } = await preparedSuperAdmin();
    const r = await runCli(["--email", user.email, "--reset-mfa"]);
    expect(r.code).toBe(EXIT.OK);
    expect(r.out).toContain("İki adımlı doğrulama ve kurtarma kodları silindi");
    expect(await userRow(user.id)).toMatchObject({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null, mustChangePassword: true });
    expect(await testDb().recoveryCode.count({ where: { userId: user.id } })).toBe(0);
    const [audit] = await resetAudits({ entityId: user.id });
    expect(audit?.newValue).toEqual({ mustChangePassword: true, mfaReset: true, revokedSessions: 1 });
  });

  it("G-P13b-10: --reset-mfa sonrası ilk girişte 2FA kurulumu zorunlu (P10 kuralı); geçici parola 24 saat sonra reddedilir", async () => {
    const { user } = await preparedSuperAdmin();
    const r = await runCli(["--email", user.email, "--reset-mfa"]);
    const temp = tempPasswordOf(r.out);
    expect(r.out).toContain("24 saat");
    const enforced = makeApp({ p10: { mfaSetupEnforcement: true } });
    try {
      const login = await enforced.inject(loginRequest(user.email, temp));
      expect(login.statusCode).toBe(200);
      expect(login.json()).toMatchObject({ mustChangePassword: true, mfaSetupRequired: true, mfaRequired: false });
    } finally {
      await enforced.close();
    }
    // 25 saat önce verilmiş geçici parola: audit append-only (UPDATE tetikleyiciyle yasak) → geçmiş tarihli kayıt yalnız
    // migrator fikstürüyle eklenir (force_created_at muafiyeti). Parolası bilinen, değişim bekleyen ayrı bir Super Admin.
    const old = await createUser({ tenantId: null, role: "SUPER_ADMIN", mustChangePassword: true });
    await testFixtureDb().auditLog.create({
      data: {
        action: AUTH_AUDIT.SUPERADMIN_RESET,
        entity: "users",
        entityId: old.id,
        username: "cli",
        result: "success",
        createdAt: new Date(Date.now() - 25 * 3_600_000),
      },
    });
    const expired = await app.inject(loginRequest(old.email, old.password));
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.message).toContain("Geçici şifrenin süresi doldu");
    const fail = await testDb().auditLog.findFirst({
      where: { action: "auth.login", entityId: old.id, result: "fail" },
      orderBy: { id: "desc" },
    });
    expect(fail?.newValue).toEqual({ reason: "temp_password_expired" });
    // Yanlış parola yine genel mesaj (süre bilgisi parolayı bilmeyene sızmaz)
    const wrong = await app.inject(loginRequest(old.email, "Yanlis-Parola-123"));
    expect(wrong.json().error.message).not.toContain("Geçici");
    // 23 saatlik kayıt hâlâ geçerli; CLI ile verilmemiş (audit yok) değişim bekleyen parola etkilenmez
    const fresh = await createUser({ tenantId: null, role: "SUPER_ADMIN", mustChangePassword: true });
    await testFixtureDb().auditLog.create({
      data: {
        action: AUTH_AUDIT.SUPERADMIN_RESET,
        entity: "users",
        entityId: fresh.id,
        username: "cli",
        result: "success",
        createdAt: new Date(Date.now() - 23 * 3_600_000),
      },
    });
    expect((await app.inject(loginRequest(fresh.email, fresh.password))).statusCode).toBe(200);
    const seeded = await createUser({ tenantId: null, role: "SUPER_ADMIN", mustChangePassword: true });
    expect((await app.inject(loginRequest(seeded.email, seeded.password))).statusCode).toBe(200);
    // CLI yeniden çalışınca yeni geçici parola hemen geçerli
    const again = await runCli(["--email", old.email]);
    expect((await app.inject(loginRequest(old.email, tempPasswordOf(again.out)))).statusCode).toBe(200);
  });

  it("AC-yeni(b): ADMIN, pasif ya da silinmiş Super Admin ve olmayan e-posta → çıkış 3, değişiklik yok, audit fail not_found", async () => {
    const admin = await createUser({ tenantId, role: "ADMIN" });
    const passive = await createUser({ tenantId: null, role: "SUPER_ADMIN", status: "PASSIVE" });
    const deleted = await createUser({ tenantId: null, role: "SUPER_ADMIN" });
    // P16 (users_deleted_chk): deleted_at yalnız mezar taşında (DELETED + mezar taşı alanları); fikstür migrator ile değil,
    // app ile de yazılabilir (users_update_guard yalnız DELETED satırın kendisini kilitler).
    await testDb().user.update({
      where: { id: deleted.id },
      data: { status: "DELETED", deletedAt: new Date(), email: `deleted+${deleted.id}@invalid`, username: null, passwordHash: "!deleted" },
    });
    for (const target of [admin, passive, deleted]) {
      const before = await userRow(target.id);
      const failsBefore = (await resetAudits({ result: "fail" })).length;
      const r = await runCli(["--email", target.email, "--reset-mfa"]);
      expect(r.code).toBe(EXIT.NOT_FOUND);
      expect(r.err).toBe("Super Admin bulunamadı.\n");
      expect(r.out).toBe("");
      expect(await userRow(target.id)).toEqual(before);
      const fails = await resetAudits({ result: "fail" });
      expect(fails).toHaveLength(failsBefore + 1);
      expect(fails.at(-1)).toMatchObject({ entityId: null, username: "cli", newValue: { reason: "not_found" } });
      expect(r.logs).not.toContain(target.email);
    }
    expect((await runCli(["--email", `yok-${newId().toLowerCase()}@example.test`])).code).toBe(EXIT.NOT_FOUND);
  });

  it("AC-yeni(b): --dry-run yalnız varlığı denetler (0/3); değişiklik ve audit yok", async () => {
    const { user } = await preparedSuperAdmin();
    const before = await userRow(user.id);
    const auditsBefore = (await resetAudits()).length;
    const ok = await runCli(["--email", user.email, "--dry-run", "--reset-mfa"]);
    expect(ok.code).toBe(EXIT.OK);
    expect(ok.out).toContain("Dry-run");
    expect(tempPasswordOf(ok.out)).toBe("");
    const missing = await runCli(["--dry-run", "--email", `yok-${newId().toLowerCase()}@example.test`]);
    expect(missing.code).toBe(EXIT.NOT_FOUND);
    expect(await userRow(user.id)).toEqual(before);
    expect(await testDb().authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
    expect((await resetAudits()).length).toBe(auditsBefore);
  });

  it("AC-yeni(b): stdout TTY değilse çıkış 4 ve hiçbir işlem yapılmaz (süreç içi + gerçek süreç, pipe)", async () => {
    const { user } = await preparedSuperAdmin();
    const before = await userRow(user.id);
    const r = await runCli(["--email", user.email], { isTTY: false });
    expect(r.code).toBe(EXIT.NO_TTY);
    expect(r.out).toBe("");
    expect(await userRow(user.id)).toEqual(before);
    expect(await resetAudits({ entityId: user.id })).toHaveLength(0);

    // Gerçek giriş noktası: stdout pipe → 4; argüman hatası TTY'den önce → 2. DB'ye hiç bağlanılmaz (env bile yok).
    const env = { PATH: process.env.PATH ?? "" };
    const piped = spawnSync(process.execPath, ["src/cli/reset-superadmin.ts", "--email", user.email], {
      cwd: SERVER_DIR,
      env,
      encoding: "utf8",
    });
    expect(piped.status).toBe(EXIT.NO_TTY);
    expect(piped.stdout).toBe("");
    expect(piped.stderr).toContain("terminal değil");
    const usage = spawnSync(process.execPath, ["src/cli/reset-superadmin.ts", "--email", "e-posta-degil"], {
      cwd: SERVER_DIR,
      env,
      encoding: "utf8",
    });
    expect(usage.status).toBe(EXIT.USAGE);
    expect(await userRow(user.id)).toEqual(before);
  });

  it("AC-yeni(b): kullanım hataları → 2 (bilinmeyen bayrak, konumsal argüman, eksik/çift e-posta)", async () => {
    for (const argv of [
      [],
      ["--email"],
      ["--email", "a@b.c", "--force"],
      ["--email", "a@b.c", "fazla"],
      ["--email", "a@b.c", "--email", "d@e.f"],
    ]) {
      const r = await runCli(argv);
      expect(r.code, argv.join(" ")).toBe(EXIT.USAGE);
      expect(r.err).toContain("kullanım:");
    }
  });

  it("AC-90: DB'ye ulaşılamazsa çıkış 5, referans ID; SQL/bağlantı ayrıntısı ekrana sızmaz", async () => {
    const db = createDb("mysql://app:yanlis@127.0.0.1:1/remote?connectTimeout=300&acquireTimeout=800");
    const r = await runCli(["--email", "a@b.c"], {
      runtime: () => ({ db, logger: createLogger("silent"), close: () => db.$disconnect() }),
    });
    expect(r.code).toBe(EXIT.DB);
    expect(r.err).toMatch(/veritabanı hatası \(ref [0-9A-Z]{26}\)/);
    expect(r.err).not.toMatch(/127\.0\.0\.1|yanlis|ECONN|SELECT/);
    expect(r.out).toBe("");
  });
});
