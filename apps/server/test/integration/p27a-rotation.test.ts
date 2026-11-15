// P27a-K3 döndürme ve yeniden kullanım tespiti (mimari-p27a §5.1, K-P27a-11, O-P27a-r2-1; AC-335b). Gerçek MySQL +
// gerçek TOTP; SMTP yok (e-posta → mail.sent not_configured audit'i).
import { AUTH_AUDIT } from "@remote/contracts/audit";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consumeAtLogin, currentTrustedDeviceId } from "../../src/auth/trusted-device.ts";
import { newId, sha256Hex } from "../../src/lib/ids.ts";
import { createTenant, makeApp, testDb } from "../helpers/app.ts";
import { enroll, ipFactory, passwordLogin, rememberDevice, tdCookie, tdOf, type Enrolled } from "../helpers/trusted-device.ts";

let app: FastifyInstance;
const ip = ipFactory(82);
const db = () => testDb();

beforeAll(async () => {
  app = makeApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const rowsOf = (userId: string) => db().trustedDevice.findMany({ where: { userId } });
const openSessions = (userId: string) => db().authSession.findMany({ where: { userId, revokedAt: null }, select: { tokenHash: true } });
const reuseAudits = (userId: string) =>
  db().auditLog.findMany({ where: { userId, action: AUTH_AUDIT.TRUSTED_DEVICE_REUSE }, select: { result: true, newValue: true } });

async function admin(): Promise<Enrolled & { tenantId: string }> {
  const t = await createTenant();
  return { ...(await enroll(app, ip, { tenantId: t.id })), tenantId: t.id };
}

describe("AC-335b döndürme", () => {
  it("AC-335b: her atlamada çerez değişir (aynı id), expires_at sabit, Max-Age = kalan süre", async () => {
    const a = await admin();
    const t0 = (await rememberDevice(app, ip, a)).cookie ?? "";
    const [row] = await rowsOf(a.user.id);
    const l1 = await passwordLogin(app, ip(), a.user, tdCookie(t0));
    const c1 = tdOf(l1.res);
    const l2 = await passwordLogin(app, ip(), a.user, tdCookie(c1?.value ?? ""));
    const c2 = tdOf(l2.res);
    expect([l1.body?.mfaRequired, l2.body?.mfaRequired]).toEqual([false, false]);
    expect(new Set([t0, c1?.value, c2?.value]).size).toBe(3);
    for (const c of [c1, c2]) expect(c?.value.split(".")[0]).toBe(row?.id);
    const [after] = await rowsOf(a.user.id);
    expect(after?.expiresAt.getTime()).toBe(row?.expiresAt.getTime());
    expect(after?.tokenHash).toBe(sha256Hex(c2?.value.split(".")[1] ?? ""));
    const remaining = Math.floor(((row?.expiresAt.getTime() ?? 0) - Date.now()) / 1000);
    expect(c2?.maxAge).toBeLessThanOrEqual(remaining + 1);
    expect(c2?.maxAge).toBeGreaterThan(remaining - 10);
  });
});

describe("AC-335b yeniden kullanım", () => {
  it("AC-335b: T0→T1→T2, sonra T0 → TOTP; tüm cihazlar + T2 ile açılan dahil tüm oturumlar iptal; bu girişin oturumu açık (mfa_passed=0); audit fail; e-posta", async () => {
    const a = await admin();
    const t0 = (await rememberDevice(app, ip, a)).cookie ?? "";
    await rememberDevice(app, ip, a); // ikinci cihaz da silinmeli
    const t1 = tdOf((await passwordLogin(app, ip(), a.user, tdCookie(t0))).res)?.value ?? "";
    const l2 = await passwordLogin(app, ip(), a.user, tdCookie(t1));
    const t2 = tdOf(l2.res)?.value ?? "";
    expect(l2.body?.mfaRequired).toBe(false);
    const openBefore = (await openSessions(a.user.id)).length;
    expect(openBefore).toBeGreaterThanOrEqual(2);

    const replay = await passwordLogin(app, ip(), a.user, tdCookie(t0));
    expect(replay.body?.mfaRequired).toBe(true);
    expect(tdOf(replay.res)?.value).toBe("");
    expect(await rowsOf(a.user.id)).toHaveLength(0);
    const open = await openSessions(a.user.id);
    expect(open.map((s) => s.tokenHash)).toEqual([sha256Hex(replay.s.token)]);
    const fresh = await db().authSession.findUniqueOrThrow({ where: { tokenHash: sha256Hex(replay.s.token) } });
    expect(fresh.mfaPassed).toBe(false);
    expect(await reuseAudits(a.user.id)).toEqual([{ result: "fail", newValue: { count: 2, revokedSessions: openBefore } }]);
    // T2 (en yeni) artık hiçbir şey atlatmaz; satır yok → bilinmeyen (yeni reuse yok).
    expect((await passwordLogin(app, ip(), a.user, tdCookie(t2))).body?.mfaRequired).toBe(true);
    expect(await reuseAudits(a.user.id)).toHaveLength(1);
    await expect
      .poll(async () =>
        (await db().auditLog.findMany({ where: { userId: a.user.id, action: "mail.sent" }, select: { newValue: true } })).some(
          (x) => (x.newValue as { kind?: string }).kind === "trusted_device_reuse",
        ),
      )
      .toBe(true);
  });

  it("AC-335b: başka kullanıcının satır id'si / var olmayan id / biçimsiz değer → yalnız TOTP; hiçbir satır/oturum silinmez, audit yok", async () => {
    const a = await admin();
    const b = await enroll(app, ip, { tenantId: a.tenantId });
    const bCookie = (await rememberDevice(app, ip, b)).cookie ?? "";
    const aCookie = (await rememberDevice(app, ip, a)).cookie ?? "";
    const [bId] = bCookie.split(".");
    const forged = `${bId}.${"A".repeat(43)}`;
    const missing = `01ARZ3NDEKTSV4RRFFQ69G5FAV.${"B".repeat(43)}`;
    for (const value of [forged, missing, "bozuk.deger", bCookie]) {
      const before = { a: await openSessions(a.user.id), rowsA: await rowsOf(a.user.id), rowsB: await rowsOf(b.user.id) };
      const l = await passwordLogin(app, ip(), a.user, tdCookie(value));
      expect(l.body?.mfaRequired).toBe(true);
      expect(tdOf(l.res)?.value).toBe("");
      expect(await rowsOf(a.user.id)).toEqual(before.rowsA);
      expect(await rowsOf(b.user.id)).toEqual(before.rowsB);
      expect((await openSessions(a.user.id)).length).toBe(before.a.length + 1);
    }
    expect(await reuseAudits(a.user.id)).toHaveLength(0);
    expect(await reuseAudits(b.user.id)).toHaveLength(0);
    expect((await passwordLogin(app, ip(), a.user, tdCookie(aCookie))).body?.mfaRequired).toBe(false);
  });

  it("AC-335b: aynı nesille paralel iki atlama → biri atlar, diğeri yeniden kullanım (R-P27a-2)", async () => {
    const a = await admin();
    const t0 = (await rememberDevice(app, ip, a)).cookie ?? "";
    const results = await Promise.all([0, 1].map(() => passwordLogin(app, ip(), a.user, tdCookie(t0))));
    const required = results.map((r) => r.body?.mfaRequired).sort();
    expect(required).toEqual([false, true]);
    expect(await reuseAudits(a.user.id)).toHaveLength(1);
    expect(await rowsOf(a.user.id)).toHaveLength(0);
  });
});

describe("D-P27a-K1 / D-P27a-K2 (güvenlik P27a kod turu 1)", () => {
  const ctx = { ip: "203.0.113.50", userAgent: "vitest", requestId: "t" };
  const subject = (a: Enrolled & { tenantId: string }) => ({
    id: a.user.id,
    tenantId: a.tenantId,
    email: a.user.email,
    role: "ADMIN",
    tenant: null,
    totpEnabled: true,
  });

  it("AC-335b D-P27a-K1: satır okuma ile döndürme arasında silinirse bilinmeyen → yalnız TOTP; reuse audit/e-posta yok, oturumlar açık", async () => {
    const a = await admin();
    const t0 = (await rememberDevice(app, ip, a)).cookie ?? "";
    const [row] = await rowsOf(a.user.id);
    const openBefore = await openSessions(a.user.id);
    expect(openBefore.length).toBeGreaterThanOrEqual(1);
    const out = await db().$transaction((tx) =>
      consumeAtLogin(tx, ctx, subject(a), [t0], new Date(), {
        // eşzamanlı meşru silme (profil "Kaldır", Admin, firma anahtarı) ayrı bağlantıda commit edilir
        beforeRotate: async () => void (await testDb().trustedDevice.delete({ where: { id: row?.id ?? "" } })),
      }),
    );
    expect(out).toEqual({ kind: "none", clearCookie: true });
    expect(await reuseAudits(a.user.id)).toHaveLength(0);
    expect(await openSessions(a.user.id)).toEqual(openBefore);
    const mails = await db().auditLog.findMany({ where: { userId: a.user.id, action: "mail.sent" }, select: { newValue: true } });
    expect(mails.some((x) => (x.newValue as { kind?: string }).kind === "trusted_device_reuse")).toBe(false);
  });

  it("AC-335b D-P27a-K1: arada özet değişmişse (aynı nesil yarışı) yine yeniden kullanım", async () => {
    const a = await admin();
    const t0 = (await rememberDevice(app, ip, a)).cookie ?? "";
    const [row] = await rowsOf(a.user.id);
    const out = await db().$transaction((tx) =>
      consumeAtLogin(tx, ctx, subject(a), [t0], new Date(), {
        beforeRotate: async () =>
          void (await testDb().trustedDevice.update({ where: { id: row?.id ?? "" }, data: { tokenHash: sha256Hex(newId()) } })),
      }),
    );
    expect(out.kind).toBe("reuse");
    expect(await reuseAudits(a.user.id)).toHaveLength(1);
  });

  it("AC-329 D-P27a-K2: profil 'Bu cihaz' login ile aynı sahiplik (kullanıcı + firma) ve süre denetimi", async () => {
    const a = await admin();
    const t0 = (await rememberDevice(app, ip, a)).cookie ?? "";
    const [row] = await rowsOf(a.user.id);
    const owner = { id: a.user.id, tenantId: a.tenantId };
    expect(await currentTrustedDeviceId(db(), owner, [t0])).toBe(row?.id);
    expect(await currentTrustedDeviceId(db(), { id: a.user.id, tenantId: newId() }, [t0])).toBeNull();
    expect(await currentTrustedDeviceId(db(), { id: newId(), tenantId: a.tenantId }, [t0])).toBeNull();
    const later = new Date((row?.expiresAt.getTime() ?? 0) + 1_000);
    expect(await currentTrustedDeviceId(db(), owner, [t0], later)).toBeNull();
    expect(await currentTrustedDeviceId(db(), owner, [`${row?.id ?? ""}.${"A".repeat(43)}`])).toBeNull();
  });
});
