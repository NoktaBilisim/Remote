// P21 K4 — portal verisi (kendi müşterisinin talep/oturum meta'sı, IDOR → 404), panel hesap yönetimi, silme yolları ve audit
// kimlik maskesi (mimari-p21 §4.2–4.5, §5.3, §3.4, §10; AC-262, K-P21-7/9/11/14; r2 S-P21-2/5/8). İki firma × iki müşteri.
import type {
  PortalAccountCreateResponse,
  PortalAccountItem,
  PortalAccountListResponse,
  PortalMe,
  PortalPage,
  PortalPasswordResetResponse,
  PortalRequestItem,
  PortalSessionItem,
} from "@remote/contracts/api/portal";
import type { CustomerDetail } from "@remote/contracts/api/customers";
import type { AuditListResponse } from "@remote/contracts/api/audit";
import { PORTAL_AUDIT } from "@remote/contracts/audit";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonymizeCustomersOf } from "../../src/customers/service.ts";
import { newId } from "../../src/lib/ids.ts";
import { purgePassivePortalAccounts, deleteOldPortalSessions } from "../../src/portal/retention.ts";
import { createSupportSessionRow, createTenant, createUser, loginAs, makeApp, testDb, type Session } from "../helpers/app.ts";
import {
  createPortalUser,
  enableTotpRow,
  PORTAL_ENV,
  portalLoginAs,
  portalLoginReq,
  type PortalSession,
  type TestPortalUser,
} from "../helpers/portal.ts";
import { createCustomerRow, createRequestRow, createRequestSettings } from "../helpers/requests.ts";

let app: FastifyInstance;
const db = testDb;
const errOf = (r: { json: <T>() => T }) => r.json<{ error: { code: string; message: string; fields?: Record<string, string> } }>().error;

interface Side {
  tenantId: string;
  slug: string;
  admin: Session;
  techId: string;
  c1: string;
  c2: string;
  u1: TestPortalUser;
  u2: TestPortalUser;
  req1: string[];
  ses1: string[];
  req2: string;
  ses2: string;
  generalReq: string;
}

async function side(): Promise<Side> {
  const t = await createTenant();
  await createRequestSettings(t.id);
  const adminUser = await createUser({ tenantId: t.id, role: "ADMIN" });
  const tech = await createUser({ tenantId: t.id, role: "USER" });
  const c1 = (await createCustomerRow(t.id)).id;
  const c2 = (await createCustomerRow(t.id)).id;
  const mkReq = async (customerId: string | null, createdAt?: Date) => {
    const r = await createRequestRow(t.id, createdAt ? { createdAt } : {});
    if (customerId) await db().supportRequest.update({ where: { id: r.id }, data: { customerId } });
    return r.id;
  };
  const mkSes = async (customerId: string, createdAt?: Date) => {
    const s = await createSupportSessionRow({
      tenantId: t.id,
      technicianId: tech.id,
      status: "ENDED",
      ...(createdAt ? { createdAt } : {}),
    });
    await db().supportSession.update({
      where: { id: s.id },
      data: { customerId, ticketNo: "ITSM-1", note: "gizli not", customerName: "Mehmet K." },
    });
    return s.id;
  };
  const base = Date.now() - 3_600_000;
  const req1 = [await mkReq(c1, new Date(base)), await mkReq(c1, new Date(base + 1000)), await mkReq(c1, new Date(base + 2000))];
  const ses1 = [await mkSes(c1, new Date(base)), await mkSes(c1, new Date(base + 1000))];
  return {
    tenantId: t.id,
    slug: t.slug,
    admin: await loginAs(app, adminUser),
    techId: tech.id,
    c1,
    c2,
    u1: await createPortalUser({ tenantId: t.id, slug: t.slug, customerId: c1 }),
    u2: await createPortalUser({ tenantId: t.id, slug: t.slug, customerId: c2 }),
    req1,
    ses1,
    req2: await mkReq(c2),
    ses2: await mkSes(c2),
    generalReq: await mkReq(null),
  };
}

let A: Side;
let B: Side;
let sA1: PortalSession;

beforeAll(async () => {
  app = makeApp({ env: PORTAL_ENV });
  await app.ready();
  A = await side();
  B = await side();
  sA1 = await portalLoginAs(app, A.u1);
});
afterAll(() => app.close());

const get = (url: string, s: { headers: object }) => app.inject({ method: "GET", url, headers: s.headers as Record<string, string> });

describe("AC-262 kendi müşterisinin geçmişi (meta)", () => {
  it("AC-262: A1 talep listesi yalnız A1 satırları, total doğru, created_at DESC, sayfalama", async () => {
    const r = await get("/api/v1/portal/requests?page=1&pageSize=2", sA1);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const p = r.json<PortalPage<PortalRequestItem>>();
    expect(p).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(p.items.map((i) => i.id)).toEqual([A.req1[2], A.req1[1]]);
    const p2 = (await get("/api/v1/portal/requests?page=2&pageSize=2", sA1)).json<PortalPage<PortalRequestItem>>();
    expect(p2.items.map((i) => i.id)).toEqual([A.req1[0]]);
    const all = (await get("/api/v1/portal/requests", sA1)).body;
    for (const id of [A.req2, A.generalReq, B.req1[0], B.req2]) expect(all).not.toContain(id);
  });

  it("AC-262: A1 oturum listesi yalnız A1; boş sayfa; büyük pageSize/page sınırı 400", async () => {
    const p = (await get("/api/v1/portal/sessions", sA1)).json<PortalPage<PortalSessionItem>>();
    expect(p.total).toBe(2);
    expect(p.items.map((i) => i.id).sort()).toEqual([...A.ses1].sort());
    const empty = (await get("/api/v1/portal/sessions?page=50", sA1)).json<PortalPage<PortalSessionItem>>();
    expect(empty.items).toEqual([]);
    expect((await get("/api/v1/portal/sessions?pageSize=101", sA1)).statusCode).toBe(400);
    expect((await get("/api/v1/portal/sessions?page=10001", sA1)).statusCode).toBe(400);
  });

  it("AC-262 K-P21-7: yanıt anahtar kümesi sözleşmeye EŞİT (not, açıklama, IP, cihaz yok); anonim satırda kişi adı null", async () => {
    const reqItem = (await get(`/api/v1/portal/requests/${A.req1[0]}`, sA1)).json<PortalRequestItem>();
    expect(Object.keys(reqItem).sort()).toEqual(
      ["id", "requestCode", "status", "source", "priority", "requesterName", "createdAt", "closedAt", "sessionId"].sort(),
    );
    expect(reqItem.requesterName).toBe("Ayşe Müşteri");
    const sesItem = (await get(`/api/v1/portal/sessions/${A.ses1[0]}`, sA1)).json<PortalSessionItem>();
    expect(Object.keys(sesItem).sort()).toEqual(
      ["id", "status", "mode", "technicianName", "customerName", "ticketNo", "createdAt", "startedAt", "endedAt", "durationSec"].sort(),
    );
    expect(sesItem).toMatchObject({ technicianName: "Test Kullanıcı", customerName: "Mehmet K.", ticketNo: "ITSM-1", mode: "BROWSER" });
    expect(JSON.stringify(sesItem)).not.toContain("gizli not");
    await db().supportSession.update({ where: { id: A.ses1[1] }, data: { customerName: null, note: null, anonymizedAt: new Date() } });
    expect((await get(`/api/v1/portal/sessions/${A.ses1[1]}`, sA1)).json<PortalSessionItem>().customerName).toBeNull();
  });

  it("AC-262 §5.3 IDOR: A1 oturumuyla A2/B1/B2 talep ve oturum id'leri → 404, gövde olmayan id ile AYNI; ?customerId/?tenantId → 400", async () => {
    const missing = await get(`/api/v1/portal/requests/${newId()}`, sA1);
    expect(missing.statusCode).toBe(404);
    const shape = (b: string) => {
      const e = JSON.parse(b) as { error: { code: string; message: string } };
      return { code: e.error.code, message: e.error.message };
    };
    const others = { requests: [A.req2, A.generalReq, ...B.req1, B.req2], sessions: [A.ses2, ...B.ses1, B.ses2] };
    for (const [kind, ids] of Object.entries(others))
      for (const id of ids) {
        const r = await get(`/api/v1/portal/${kind}/${id}`, sA1);
        expect(r.statusCode, `${kind}/${id}`).toBe(404);
        expect(shape(r.body)).toEqual(shape(missing.body));
      }
    expect((await get(`/api/v1/portal/requests/bozuk-id`, sA1)).statusCode).toBe(404);
    for (const q of [`customerId=${A.c2}`, `tenantId=${B.tenantId}`]) {
      expect((await get(`/api/v1/portal/requests?${q}`, sA1)).statusCode).toBe(400);
      expect((await get(`/api/v1/portal/sessions?${q}`, sA1)).statusCode).toBe(400);
    }
  });

  it("AC-262 ADR-0039: panel oturumu portal veri uçlarında 401; oturumsuz 401", async () => {
    expect((await get("/api/v1/portal/requests", A.admin)).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/portal/sessions" })).statusCode).toBe(401);
  });

  it("AC-262 K-P21-3: PortalMe.links panel müşteri detayındaki downloadUrl/fileName ile aynı", async () => {
    const me = (await get("/api/v1/portal/me", sA1)).json<PortalMe>();
    const detail = (await get(`/api/v1/customers/${A.c1}`, A.admin)).json<CustomerDetail>();
    expect(me.links).toEqual({ downloadUrl: detail.downloadUrl, fileName: detail.fileName });
    expect(me.links.fileName).toMatch(/^NoktaDestek-.+-[a-z2-7]{16}\.exe$/);
  });
});

const accounts = (s: Side, customerId = s.c1) => `/api/v1/customers/${customerId}/portal-accounts`;
const post = (url: string, s: { headers: object }, payload: object = {}) =>
  app.inject({ method: "POST", url, headers: s.headers as Record<string, string>, payload });

describe("AC-262 Admin portal hesapları", () => {
  it("AC-262: oluşturma 201 + geçici şifre bir kez (listede yok, audit'te yok) → geçici şifreyle giriş, zorunlu değişim; loginUrl firmaya bağlı", async () => {
    const email = `yeni-${newId().toLowerCase()}@example.test`;
    const r = await post(accounts(A), A.admin, { email: email.toUpperCase(), fullName: "Yeni Kişi" });
    expect(r.statusCode, r.body).toBe(201);
    const out = r.json<PortalAccountCreateResponse>();
    expect(out.account).toMatchObject({
      email,
      status: "ACTIVE",
      mustChangePassword: true,
      tempPasswordExpired: false,
      totpEnabled: false,
    });
    expect(out.temporaryPassword).toHaveLength(16);
    const list = await get(accounts(A), A.admin);
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(out.temporaryPassword);
    const l = list.json<PortalAccountListResponse>();
    expect(l.loginUrl).toBe(`https://rs.test:4450/portal/login?tenant=${A.slug}`);
    expect(l.items.map((i) => i.id)).toContain(out.account.id);
    const audit = await db().auditLog.findFirstOrThrow({ where: { entityId: out.account.id, action: PORTAL_AUDIT.ACCOUNT_CREATED } });
    expect(JSON.stringify([audit.oldValue, audit.newValue])).not.toContain(out.temporaryPassword);
    expect(audit.newValue).toEqual({ customerId: A.c1, email, fullName: "Yeni Kişi" });
    const row = await db().portalUser.findUniqueOrThrow({ where: { id: out.account.id } });
    expect((row.tempPasswordExpiresAt?.getTime() ?? 0) - Date.now()).toBeGreaterThan(71 * 3_600_000);
    const login = await portalLoginReq(app, { email, tenantSlug: A.slug, password: out.temporaryPassword });
    expect(login.statusCode).toBe(200);
    expect(login.json<PortalMe>().user.mustChangePassword).toBe(true);
    // Aynı e-posta aynı firmada → 409 fields.email; başka firmada serbest (r2 S-P21-3).
    const dup = await post(accounts(A, A.c2), A.admin, { email, fullName: "Kopya Kişi" });
    expect(dup.statusCode).toBe(409);
    expect(errOf(dup).fields?.email).toBe("Bu e-posta adresiyle portal hesabı açılamaz.");
    expect((await post(accounts(B), B.admin, { email, fullName: "Başka Firma" })).statusCode).toBe(201);
  });

  it("AC-262 K-P21-8: customers.portal yoksa 403 (customers.view olsa da)", async () => {
    const user = await createUser({ tenantId: A.tenantId, role: "USER", perms: { "customers.view": true } });
    const s = await loginAs(app, user);
    expect((await get(accounts(A), s)).statusCode).toBe(403);
    expect((await post(accounts(A), s, { email: "x@example.test", fullName: "X Kişi" })).statusCode).toBe(403);
  });

  it("AC-262 K-P21-11: 21. hesap → 409; müşteri pasif → oluşturma 409", async () => {
    const t = await createTenant();
    await createRequestSettings(t.id);
    const admin = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    const c = (await createCustomerRow(t.id)).id;
    for (let i = 0; i < 20; i++) await createPortalUser({ tenantId: t.id, slug: t.slug, customerId: c });
    const r = await post(`/api/v1/customers/${c}/portal-accounts`, admin, {
      email: `k21-${newId().toLowerCase()}@example.test`,
      fullName: "Yirmibir",
    });
    expect(r.statusCode).toBe(409);
    const passive = (await createCustomerRow(t.id)).id;
    await db().customer.update({ where: { id: passive }, data: { status: "PASSIVE", passiveAt: new Date() } });
    const p = await post(`/api/v1/customers/${passive}/portal-accounts`, admin, {
      email: `pas-${newId().toLowerCase()}@example.test`,
      fullName: "Pasif Müşteri",
    });
    expect(p.statusCode).toBe(409);
  });

  it("AC-262 K-P21-9/12: pasife alma → açık portal isteği 401 + audit; idempotent; etkinleştirme; müşteri pasifken etkinleştirme 409", async () => {
    const u = await createPortalUser({ tenantId: A.tenantId, slug: A.slug, customerId: A.c1 });
    const s = await portalLoginAs(app, u);
    const d1 = await post(`${accounts(A)}/${u.id}/deactivate`, A.admin);
    expect(d1.statusCode, d1.body).toBe(200);
    expect(d1.json<PortalAccountItem>()).toMatchObject({ status: "PASSIVE" });
    expect(d1.json<PortalAccountItem>().passiveAt).not.toBeNull();
    expect((await get("/api/v1/portal/me", s)).statusCode).toBe(401);
    const d2 = await post(`${accounts(A)}/${u.id}/deactivate`, A.admin);
    expect(d2.statusCode).toBe(200);
    expect(await db().auditLog.count({ where: { entityId: u.id, action: PORTAL_AUDIT.ACCOUNT_DEACTIVATED } })).toBe(1);
    const a = await db().auditLog.findFirstOrThrow({ where: { entityId: u.id, action: PORTAL_AUDIT.ACCOUNT_DEACTIVATED } });
    expect(a.oldValue).toEqual({ status: "ACTIVE" });
    expect(a.newValue).toEqual({ status: "PASSIVE", revokedSessions: 1 });
    expect((await post(`${accounts(A)}/${u.id}/reset-password`, A.admin)).statusCode).toBe(409);
    const re = await post(`${accounts(A)}/${u.id}/reactivate`, A.admin);
    expect(re.statusCode).toBe(200);
    expect(re.json<PortalAccountItem>()).toMatchObject({ status: "ACTIVE", passiveAt: null });
    expect((await portalLoginReq(app, { email: u.email, tenantSlug: u.slug, password: u.password })).statusCode).toBe(200);

    const t = await createTenant();
    await createRequestSettings(t.id);
    const admin = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    const c = (await createCustomerRow(t.id)).id;
    const v = await createPortalUser({ tenantId: t.id, slug: t.slug, customerId: c, status: "PASSIVE" });
    await db().customer.update({ where: { id: c }, data: { status: "PASSIVE", passiveAt: new Date() } });
    expect((await post(`/api/v1/customers/${c}/portal-accounts/${v.id}/reactivate`, admin)).statusCode).toBe(409);
  });

  it("AC-262 K-P21-5 / r2 S-P21-8: şifre sıfırlama → yeni geçici şifre, TOTP kapalı, oturumlar iptal, audit secondFactorCleared", async () => {
    const u = await createPortalUser({ tenantId: A.tenantId, slug: A.slug, customerId: A.c1 });
    const secret = await enableTotpRow(app.secrets, u.id);
    expect(secret).toBeTruthy();
    await db().portalUser.update({ where: { id: u.id }, data: { failedLoginCount: 7, failedWindowAt: new Date() } });
    const before = await db().portalSession.count({ where: { portalUserId: u.id } });
    const r = await post(`${accounts(A)}/${u.id}/reset-password`, A.admin);
    expect(r.statusCode, r.body).toBe(200);
    const { temporaryPassword } = r.json<PortalPasswordResetResponse>();
    const row = await db().portalUser.findUniqueOrThrow({ where: { id: u.id } });
    expect(row).toMatchObject({
      totpEnabled: false,
      totpSecretEnc: null,
      totpLastStep: null,
      mustChangePassword: true,
      failedLoginCount: 0,
    });
    const a = await db().auditLog.findFirstOrThrow({ where: { entityId: u.id, action: PORTAL_AUDIT.ACCOUNT_PASSWORD_RESET } });
    expect(a.newValue).toEqual({ revokedSessions: before, secondFactorCleared: true });
    expect(JSON.stringify([a.oldValue, a.newValue])).not.toContain(temporaryPassword);
    const login = await portalLoginReq(app, { email: u.email, tenantSlug: u.slug, password: temporaryPassword });
    expect(login.statusCode).toBe(200);
  });

  it("AC-262 §5.3 IDOR (Admin): A Admin'i A2'nin hesabını A1 yolunda ve B hesabını → 404; B Admin'i A müşterisi → 404", async () => {
    for (const action of ["deactivate", "reactivate", "reset-password"]) {
      expect((await post(`${accounts(A)}/${A.u2.id}/${action}`, A.admin)).statusCode, action).toBe(404);
      expect((await post(`${accounts(A)}/${B.u1.id}/${action}`, A.admin)).statusCode, action).toBe(404);
      expect((await post(`${accounts(A, A.c2)}/${A.u1.id}/${action}`, A.admin)).statusCode, action).toBe(404);
    }
    expect((await get(accounts(A), B.admin)).statusCode).toBe(404);
    expect((await post(`${accounts(A)}/${A.u1.id}/deactivate`, B.admin)).statusCode).toBe(404);
    expect((await db().portalUser.findUniqueOrThrow({ where: { id: A.u1.id } })).status).toBe("ACTIVE");
  });

  it("AC-262 r2 S-P21-5: listede süresi dolan geçici şifre rozeti (tempPasswordExpired)", async () => {
    const u = await createPortalUser({
      tenantId: A.tenantId,
      slug: A.slug,
      customerId: A.c2,
      mustChangePassword: true,
      tempPasswordExpiresAt: new Date(Date.now() - 60_000),
    });
    const l = (await get(accounts(A, A.c2), A.admin)).json<PortalAccountListResponse>();
    expect(l.items.find((i) => i.id === u.id)?.tempPasswordExpired).toBe(true);
  });
});

describe("AC-262 K-P21-9 silme yolları + K-P21-14 audit kimlik maskesi", () => {
  it("AC-262: pasif hesap retention_days sonra silinir (oturumları dahil) + portal.account_deleted (SYSTEM, e-posta yok)", async () => {
    const t = await createTenant();
    const c = (await createCustomerRow(t.id)).id;
    const old = await createPortalUser({
      tenantId: t.id,
      slug: t.slug,
      customerId: c,
      status: "PASSIVE",
      passiveAt: new Date(Date.now() - 400 * 86_400_000),
    });
    const recent = await createPortalUser({ tenantId: t.id, slug: t.slug, customerId: c, status: "PASSIVE", passiveAt: new Date() });
    await db().portalSession.create({
      data: {
        id: newId(),
        portalUserId: old.id,
        tenantId: t.id,
        tokenHash: "a".repeat(64),
        ip: "10.0.0.1",
        userAgent: "x",
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date(),
      },
    });
    const n = await purgePassivePortalAccounts(
      db(),
      { ip: "", userAgent: "retention", requestId: newId() },
      { tenantId: t.id, retentionDays: 365 },
      new Date(),
    );
    expect(n).toBe(1);
    expect(await db().portalUser.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db().portalUser.findUnique({ where: { id: recent.id } })).not.toBeNull();
    const a = await db().auditLog.findFirstOrThrow({ where: { entityId: old.id, action: PORTAL_AUDIT.ACCOUNT_DELETED } });
    expect(a).toMatchObject({ username: "system", entity: "portal_users", tenantId: t.id });
    expect(JSON.stringify(a.newValue)).not.toContain(old.email);
  });

  it("AC-262: süresi/iptali 7 g önce biten portal oturumları silinir", async () => {
    const t = await createTenant();
    const c = (await createCustomerRow(t.id)).id;
    const u = await createPortalUser({ tenantId: t.id, slug: t.slug, customerId: c });
    const created = new Date(Date.now() - 9 * 86_400_000);
    const id = newId();
    await db().portalSession.create({
      data: {
        id,
        portalUserId: u.id,
        tenantId: t.id,
        tokenHash: newId()
          .toLowerCase()
          .padEnd(64, "0")
          .replace(/[^0-9a-f]/g, "0"),
        ip: "10.0.0.1",
        userAgent: "x",
        lastSeenAt: created,
        expiresAt: new Date(created.getTime() + 3_600_000),
        createdAt: created,
      },
    });
    expect(await deleteOldPortalSessions(db(), new Date(), 5000)).toBeGreaterThanOrEqual(1);
    expect(await db().portalSession.findUnique({ where: { id } })).toBeNull();
  });

  it("AC-262 K-P21-9: müşteri anonimleştirme TX'inde portal hesapları + oturumları 0; audit portalAccounts", async () => {
    const t = await createTenant();
    await createRequestSettings(t.id);
    const c = await createCustomerRow(t.id);
    await db().customer.update({ where: { id: c.id }, data: { status: "PASSIVE", passiveAt: new Date(Date.now() - 400 * 86_400_000) } });
    const u = await createPortalUser({ tenantId: t.id, slug: t.slug, customerId: c.id });
    await createPortalUser({ tenantId: t.id, slug: t.slug, customerId: c.id, status: "PASSIVE" });
    expect(await db().portalUser.count({ where: { customerId: c.id } })).toBe(2);
    const n = await anonymizeCustomersOf(app.requests, { tenantId: t.id, retentionDays: 365 }, new Date());
    expect(n).toBe(1);
    expect(await db().portalUser.count({ where: { customerId: c.id } })).toBe(0);
    expect(await db().portalSession.count({ where: { portalUserId: u.id } })).toBe(0);
    const a = await db().auditLog.findFirstOrThrow({ where: { entityId: c.id, action: "customer.anonymized" } });
    expect((a.newValue as { portalAccounts: number }).portalAccounts).toBe(2);
  });

  it("AC-262 r2 S-P21-2: hesap silinince login/logout/password_change satırları audit ekranında maskeli; olmayan e-posta denemesi maskesiz", async () => {
    const t = await createTenant();
    await createRequestSettings(t.id);
    const admin = await loginAs(app, await createUser({ tenantId: t.id, role: "ADMIN" }));
    const c = (await createCustomerRow(t.id)).id;
    const u = await createPortalUser({ tenantId: t.id, slug: t.slug, customerId: c });
    const s = await portalLoginAs(app, u);
    await post("/api/v1/portal/auth/logout", s);
    const ghost = `hayalet-${newId().toLowerCase()}@example.test`;
    await portalLoginReq(app, { email: ghost, tenantSlug: t.slug, password: "Yanlis-Sifre-123" });
    const before = (await get("/api/v1/audit?action=portal.*", admin)).json<AuditListResponse>();
    const liveRows = before.items.filter((i) => i.entityId === u.id);
    expect(liveRows.length).toBeGreaterThanOrEqual(2);
    expect(liveRows.every((i) => !i.identityMasked && i.username === u.email)).toBe(true);
    await db().portalSession.deleteMany({ where: { portalUserId: u.id } });
    await db().portalUser.delete({ where: { id: u.id } });
    const after = (await get("/api/v1/audit?action=portal.*", admin)).json<AuditListResponse>();
    const gone = after.items.filter((i) => i.entityId === u.id);
    expect(gone.length).toBe(liveRows.length);
    expect(gone.every((i) => i.identityMasked && i.username !== u.email)).toBe(true);
    const g = after.items.find((i) => i.username === ghost);
    expect(g).toMatchObject({ identityMasked: false, entityId: null });
    const csv = await app.inject({ method: "GET", url: "/api/v1/audit/export.csv?action=portal.*", headers: admin.headers });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).not.toContain(u.email);
    expect(csv.body).toContain(ghost);
  });
});
