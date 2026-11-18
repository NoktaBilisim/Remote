// P21 K4 — portaldan destek talebi (mimari-p21 §4.2 POST /portal/requests, GET /portal/request-form; K-P21-2; r2 S-P21-1/S-P21-4).
// Gövde yalnız sunucuda kurulur (ref = oturumdaki müşterinin ref'i); firma web formu tercihi portal yolunu etkilemez.
import type { PortalPage, PortalRequestFormInfo, PortalRequestItem } from "@remote/contracts/api/portal";
import type { CreateRequestResponse } from "@remote/contracts/api/requests";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, newSecretToken } from "../../src/lib/ids.ts";
import { createConsentText, createTenant, createUser, currentConsentId, makeApp, ORIGIN, testDb } from "../helpers/app.ts";
import { createPortalUser, PORTAL_ENV, portalLoginAs, type PortalSession, type TestPortalUser } from "../helpers/portal.ts";
import { createCustomerRow, createRequestSettings } from "../helpers/requests.ts";

let app: FastifyInstance;
const db = testDb;
const errOf = (r: { json: <T>() => T }) => r.json<{ error: { code: string; message: string; fields?: Record<string, string> } }>().error;

beforeAll(async () => {
  app = makeApp({ env: PORTAL_ENV });
  await app.ready();
});
afterAll(() => app.close());

let netSeq = 0;
/** Her talep ayrı /24 (çekirdeğin IP/önek kovaları bu testin konusu değil). */
const freshIp = (): string => `10.22.${(++netSeq % 250) + 1}.${Math.floor(netSeq / 250) + 7}`;

interface Fixture {
  tenantId: string;
  slug: string;
  customerId: string;
  ref: string;
  user: TestPortalUser;
  s: PortalSession;
}

async function fixture(o: { formEnabled: boolean }): Promise<Fixture> {
  const t = await createTenant();
  await createRequestSettings(t.id);
  await db().tenantRequestSettings.update({ where: { tenantId: t.id }, data: { webFormEnabled: o.formEnabled } });
  const c = await createCustomerRow(t.id);
  const user = await createPortalUser({ tenantId: t.id, slug: t.slug, customerId: c.id });
  return { tenantId: t.id, slug: t.slug, customerId: c.id, ref: c.requestRef, user, s: await portalLoginAs(app, user) };
}

async function body(tenantId: string, extra: Record<string, unknown> = {}) {
  return {
    clientInstanceId: newSecretToken().slice(0, 22),
    customerName: "Ayşe Portal",
    phone: "0532 111 22 33",
    description: "Portaldan destek istiyorum lütfen",
    consentTextId: await currentConsentId(tenantId),
    consentAccepted: true,
    notify: { sms: false, whatsapp: false, email: false },
    ...extra,
  };
}

const postReq = (s: PortalSession | null, payload: object, o: { ip?: string; headers?: Record<string, string> } = {}) =>
  app.inject({
    method: "POST",
    url: "/api/v1/portal/requests",
    headers: { ...(s ? s.headers : { origin: ORIGIN }), "x-forwarded-for": o.ip ?? freshIp(), ...o.headers },
    payload,
  });
const count = (customerId: string) => db().supportRequest.count({ where: { customerId } });
const expireAll = (customerId: string) =>
  db().supportRequest.updateMany({ where: { customerId, status: "PENDING" }, data: { status: "EXPIRED", closedAt: new Date() } });

describe("AC-262 K-P21-2 portaldan talep", () => {
  it("AC-262: web formu açık ve KAPALI firmada 201; source WEB, customer_id oturumdaki müşteri; audit via portal + portalUserId; Talepler listesinde", async () => {
    for (const formEnabled of [true, false]) {
      const f = await fixture({ formEnabled });
      const r = await postReq(f.s, await body(f.tenantId));
      expect(r.statusCode, r.body).toBe(201);
      expect(r.headers["cache-control"]).toBe("no-store");
      const out = r.json<CreateRequestResponse>();
      const row = await db().supportRequest.findUniqueOrThrow({ where: { id: out.requestId } });
      expect(row).toMatchObject({ tenantId: f.tenantId, customerId: f.customerId, source: "WEB", clientVersion: null, status: "PENDING" });
      const a = await db().auditLog.findFirstOrThrow({ where: { entityId: out.requestId, action: "request.created" } });
      expect(a.newValue).toMatchObject({ via: "portal", portalUserId: f.user.id, customerId: f.customerId, source: "WEB" });
      expect(JSON.stringify(a.newValue)).not.toContain(f.ref);
      const list = (await app.inject({ method: "GET", url: "/api/v1/portal/requests", headers: f.s.headers })).json<PortalPage<PortalRequestItem>>();
      expect(list.items.map((i) => i.id)).toContain(out.requestId);
      if (!formEnabled) {
        // Firma web formu kapalı: /r/<ref> (genel form) 404 kalır, portal yolu çalışır.
        const form = await app.inject({ method: "GET", url: `/api/v1/public/web-requests/form?ref=${f.ref}`, headers: { "x-forwarded-for": freshIp() } });
        expect(form.statusCode).toBe(404);
      }
    }
  });

  it("AC-262: GET /portal/request-form — firma, aydınlatma metni, kanallar; formToken/minDelayMs yok; müşteri ref'i yok", async () => {
    const f = await fixture({ formEnabled: false });
    const r = await app.inject({ method: "GET", url: "/api/v1/portal/request-form", headers: f.s.headers });
    expect(r.statusCode, r.body).toBe(200);
    const info = r.json<PortalRequestFormInfo>();
    expect(info.consentText.id).toBe(await currentConsentId(f.tenantId));
    expect(info.channels).toEqual({ sms: false, whatsapp: false, email: false });
    expect(info).not.toHaveProperty("formToken");
    expect(info).not.toHaveProperty("minDelayMs");
    expect(r.body).not.toContain(f.ref);
    expect((await app.inject({ method: "GET", url: "/api/v1/portal/request-form" })).statusCode).toBe(401);
  });

  it("AC-262 r2 S-P21-1: oturumsuz 401; yabancı Origin / CSRF yok 403; talep yazılmaz", async () => {
    const f = await fixture({ formEnabled: true });
    const b = await body(f.tenantId);
    expect((await postReq(null, b)).statusCode).toBe(401);
    expect((await postReq(f.s, b, { headers: { origin: "https://evil.example" } })).statusCode).toBe(403);
    const noCsrf = await app.inject({
      method: "POST",
      url: "/api/v1/portal/requests",
      headers: { cookie: f.s.headers.cookie, origin: ORIGIN, "x-forwarded-for": freshIp() },
      payload: b,
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(await count(f.customerId)).toBe(0);
  });

  it("AC-262 r2 S-P21-1: gövdede ref / customerId / tenantId / bindingKey / formToken → 400, talep yazılmaz (başka müşteriye yazdırma yok)", async () => {
    const f = await fixture({ formEnabled: true });
    const other = await createCustomerRow(f.tenantId);
    for (const extra of [
      { ref: other.requestRef },
      { customerId: other.id },
      { tenantId: f.tenantId },
      { bindingKey: newSecretToken() },
      { formToken: "x" },
    ]) {
      const r = await postReq(f.s, await body(f.tenantId, extra));
      expect(r.statusCode, JSON.stringify(extra)).toBe(400);
    }
    expect(await count(f.customerId)).toBe(0);
    expect(await count(other.id)).toBe(0);
  });

  it("AC-262: KVKK onayı yok / eski sürüm → 400; notify.email + e-posta yok → 400 fields.email", async () => {
    const f = await fixture({ formEnabled: true });
    const old = await currentConsentId(f.tenantId);
    expect((await postReq(f.s, await body(f.tenantId, { consentAccepted: false }))).statusCode).toBe(400);
    await db().consentText.update({ where: { id: old }, data: { isCurrent: false } });
    await createConsentText(f.tenantId, { version: 2, isCurrent: true });
    const stale = await postReq(f.s, await body(f.tenantId, { consentTextId: old }));
    expect(stale.statusCode).toBe(400);
    expect(errOf(stale).fields?.consentTextId).toBeDefined();
    const mail = await postReq(f.s, await body(f.tenantId, { notify: { sms: false, whatsapp: false, email: true } }));
    expect(mail.statusCode).toBe(400);
    expect(errOf(mail).fields?.email).toBeDefined();
    expect(await count(f.customerId)).toBe(0);
  });

  it("AC-262 (P18): mesai dışı REJECT → 409 OUTSIDE_HOURS, talep yazılmaz", async () => {
    const f = await fixture({ formEnabled: true });
    const admin = await createUser({ tenantId: f.tenantId, role: "ADMIN" });
    const localDay = (d: number) => new Date(Date.now() + 3 * 3_600_000 + d * 86_400_000).toISOString().slice(0, 10);
    await db().tenantRequestSettings.update({
      where: { tenantId: f.tenantId },
      data: { hoursEnabled: true, afterHoursMode: "REJECT", businessHours: [0, 1, 2, 3, 4, 5, 6].map(() => [{ from: "00:00", to: "24:00" }]) },
    });
    for (const d of [0, 1])
      await db().businessHoliday.create({
        data: { id: newId(), tenantId: f.tenantId, day: new Date(`${localDay(d)}T00:00:00.000Z`), name: "Tatil", createdBy: admin.id },
      });
    const r = await postReq(f.s, await body(f.tenantId));
    expect(r.statusCode, r.body).toBe(409);
    expect(errOf(r).code).toBe("OUTSIDE_HOURS");
    expect(await count(f.customerId)).toBe(0);
  });

  it("AC-262 r2 S-P21-4: müşteri başına 3 bekleyen; 4. → 429 QUEUE_FULL (bekleyen sınırı), talep yazılmaz", async () => {
    const f = await fixture({ formEnabled: true });
    for (let i = 0; i < 3; i++) expect((await postReq(f.s, await body(f.tenantId))).statusCode).toBe(201);
    const r = await postReq(f.s, await body(f.tenantId));
    expect(r.statusCode, r.body).toBe(429);
    expect(errOf(r).code).toBe("QUEUE_FULL");
    expect(await count(f.customerId)).toBe(3);
    expect(app.metrics.render()).toMatch(/^rs_portal_requests_total\{result="queue_full"\} [1-9]/m);
  });

  it("AC-262 r2 S-P21-4: müşteri kovası tüm hesaplar toplamı 10/sa → 11. 429 + audit; başka müşteri etkilenmez", async () => {
    const f = await fixture({ formEnabled: true });
    const u2 = await createPortalUser({ tenantId: f.tenantId, slug: f.slug, customerId: f.customerId });
    const s2 = await portalLoginAs(app, u2);
    for (let i = 0; i < 10; i++) {
      const r = await postReq(i % 2 === 0 ? f.s : s2, await body(f.tenantId));
      expect(r.statusCode, `${i}: ${r.body}`).toBe(201);
      await expireAll(f.customerId);
    }
    const r = await postReq(s2, await body(f.tenantId));
    expect(r.statusCode).toBe(429);
    expect(errOf(r).code).toBe("RATE_LIMITED");
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect(await count(f.customerId)).toBe(10);
    const rl = await db().auditLog.findMany({ where: { tenantId: f.tenantId, action: "request.rate_limited" } });
    expect(rl.map((a) => a.newValue)).toContainEqual({ bucket: "portal.customer", keyType: "customer" });
    const c2 = await createCustomerRow(f.tenantId);
    const u3 = await createPortalUser({ tenantId: f.tenantId, slug: f.slug, customerId: c2.id });
    expect((await postReq(await portalLoginAs(app, u3), await body(f.tenantId))).statusCode).toBe(201);
  });

  it("AC-262 r2 S-P21-1: createPortal beklenen müşteri/firma uyuşmazlığında talep YAZMAZ (savunma derinliği)", async () => {
    const f = await fixture({ formEnabled: true });
    const other = await createCustomerRow(f.tenantId);
    const core = {
      ref: f.ref,
      ...(await body(f.tenantId)),
      consentAccepted: true as const,
      source: "WEB" as const,
      clientVersion: null,
    };
    const ctx = { ip: freshIp(), userAgent: "test", requestId: newId() };
    for (const expected of [
      { expectedTenantId: f.tenantId, expectedCustomerId: other.id },
      { expectedTenantId: newId(), expectedCustomerId: f.customerId },
    ])
      await expect(app.requests.createPortal(ctx, core, { via: "portal", portalUserId: f.user.id, ...expected })).rejects.toThrow();
    expect(await count(f.customerId)).toBe(0);
  });
});
