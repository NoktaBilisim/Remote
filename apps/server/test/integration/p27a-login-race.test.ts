// D-P27a-K3 (güvenlik P27a kod turu 2): login kararı TX içindeki kilitli kullanıcı satırıyla verilir. Şifre/2FA okuması
// argon2'den önce TX dışında yapıldığı için 2FA etkinleştirme / şifre değişimi bu pencerede commit ederse eski değerle
// tam oturum açılmamalı. Kanca `afterRead` ADR-0023 kalıbıdır (yalnız testte verilir). Gerçek MySQL + gerçek TOTP.
import type { MfaSetupResponse } from "@remote/contracts/api/auth";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32Decode, hotp, stepOf } from "../../src/auth/mfa.ts";
import { login } from "../../src/auth/service.ts";
import { sha256Hex } from "../../src/lib/ids.ts";
import { createTenant, createUser, loginAs, makeApp, testDb, type Session, type TestUser } from "../helpers/app.ts";
import { call, ipFactory, passwordLogin } from "../helpers/trusted-device.ts";

let app: FastifyInstance;
const ip = ipFactory(83);

beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const openSessions = (userId: string) =>
  testDb().authSession.findMany({ where: { userId, revokedAt: null }, select: { tokenHash: true, mfaPassed: true } });

/** Kullanıcı + oturum + TOTP kurulumu (henüz etkin değil); `enable` çağrısı bu oturumla yapılır. */
async function pendingEnroll(): Promise<{ user: TestUser; s: Session; enable: () => Promise<number> }> {
  const t = await createTenant();
  const user = await createUser({ tenantId: t.id, role: "USER" });
  const s = await loginAs(app, user);
  const setup = (await call(app, ip(), s, "POST", "/auth/mfa/setup", {})).json<MfaSetupResponse>();
  const enable = async () =>
    (await call(app, ip(), s, "POST", "/auth/mfa/enable", { code: hotp(base32Decode(setup.secret), stepOf(Date.now())) })).statusCode;
  return { user, s, enable };
}

const directLogin = (user: TestUser, password: string, afterRead: () => Promise<void>) =>
  login(
    app.db,
    app.authLimits,
    { ip: ip(), userAgent: "vitest", requestId: "race" },
    app.log,
    { login: user.email, password },
    app.mfaSetupEnforced,
    undefined,
    undefined,
    [],
    { afterRead },
  );

describe("D-P27a-K3 login yarışı", () => {
  it("AC-67 D-P27a-K3: okuma ile login TX'i arasında 2FA etkinleştirilirse oturum yarım açılır (mfa_passed=0)", async () => {
    const e = await pendingEnroll();
    let enabled = 0;
    const out = await directLogin(e.user, e.user.password, async () => {
      enabled = await e.enable();
    });
    expect(enabled).toBe(200);
    expect(out.mfaStage).toBe("verify");
    expect(out.mfaPassed).toBe(false);
    const row = await testDb().authSession.findUniqueOrThrow({ where: { tokenHash: sha256Hex(out.token) } });
    expect(row.mfaPassed).toBe(false);
    // Etkinleştiren oturum dışında tam (mfa_passed=1) açık oturum kalmaz.
    expect((await openSessions(e.user.id)).filter((x) => x.mfaPassed).map((x) => x.tokenHash)).toEqual([sha256Hex(e.s.token)]);
  });

  it("AC-66 D-P27a-K3: okuma ile login TX'i arasında şifre değişirse eski şifreyle oturum açılmaz (401, audit credentials_changed)", async () => {
    const t = await createTenant();
    const user = await createUser({ tenantId: t.id, role: "USER" });
    const s = await loginAs(app, user);
    let changed = 0;
    const err = await directLogin(user, user.password, async () => {
      changed = (await call(app, ip(), s, "POST", "/auth/password/change", { current: user.password, next: "Yepyeni-Sifre-2026!kx" }))
        .statusCode;
    }).catch((x: unknown) => x);
    expect(changed).toBe(204);
    expect(err).toMatchObject({ code: "UNAUTHENTICATED" });
    // Yalnız şifre değişiminin yenilediği oturum açık; eski şifreli giriş satır eklemedi.
    expect(await openSessions(user.id)).toHaveLength(1);
    const fails = await testDb().auditLog.findMany({
      where: { userId: user.id, action: "auth.login", result: "fail" },
      select: { newValue: true },
    });
    expect(fails).toEqual([{ newValue: { reason: "credentials_changed" } }]);
  });

  it("AC-67 D-P27a-K3: 2FA etkinleştirme ile eşzamanlı girişler → 5xx/kilitlenme yok; etkinleştiren dışında tam oturum kalmaz", async () => {
    for (let round = 0; round < 3; round++) {
      const e = await pendingEnroll();
      const [enabled, ...logins] = await Promise.all([e.enable(), ...[0, 1, 2, 3].map(() => passwordLogin(app, ip(), e.user))]);
      expect(enabled).toBe(200);
      expect(logins.map((l) => l.res.statusCode)).toEqual([200, 200, 200, 200]);
      expect((await openSessions(e.user.id)).filter((x) => x.mfaPassed).map((x) => x.tokenHash)).toEqual([sha256Hex(e.s.token)]);
    }
  });

  it("AC-65 D-P27a-K3: hatalı deneme sayacı dolu hesapta paralel başarılı girişler kilitlenmeden (1213) biter, sayaç sıfırlanır", async () => {
    const t = await createTenant();
    const user = await createUser({ tenantId: t.id, role: "USER" });
    await testDb().user.update({ where: { id: user.id }, data: { failedLoginCount: 3, failedWindowAt: new Date() } });
    const logins = await Promise.all([0, 1, 2, 3, 4].map(() => passwordLogin(app, ip(), user)));
    expect(logins.map((l) => l.res.statusCode)).toEqual([200, 200, 200, 200, 200]);
    const u = await testDb().user.findUniqueOrThrow({ where: { id: user.id }, select: { failedLoginCount: true } });
    expect(u.failedLoginCount).toBe(0);
  });
});
