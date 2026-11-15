// P27-K2 panel uçları (mimari-p27 §4.2 r2, §7.1; AC-275, 293, 296, 297, 336, 337, 339). Çevrimiçi durum için uçlar ikinci
// bir önekte sahte canlı kanalla (`fakeLink`) da kaydedilir; asıl önek K3 hub'ını kullanır. Sahte SMTP süreç içi.
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SMTPServer } from "smtp-server";
import { sha256Hex } from "../../src/lib/ids.ts";
import { unattendedRoutes } from "../../src/unattended/routes.ts";
import { createTenant, createUser, loginAs, loginStepUp, makeApp, testDb, type Session, type TestUser } from "../helpers/app.ts";
import { closeSmtp, inboxTransport, loopbackNetguard, startInboxSmtp } from "../helpers/mail-tls.ts";
import { createCustomerRow } from "../helpers/requests.ts";
import { codeRow, contactRow, createDeviceRow, fakeLink, grantRow, setSmtp, UNSIGNED_ENV } from "../helpers/unattended.ts";

const P = "/api/v1/fake-unattended";
const inbox: { to: string; body: string }[] = [];
const link = fakeLink();
let smtp: SMTPServer;
let smtpPort = 0;
let app: FastifyInstance;
let offApp: FastifyInstance;

beforeAll(async () => {
  ({ smtp, port: smtpPort } = await startInboxSmtp(inbox));
  const p10 = { netguard: loopbackNetguard(), mailTransport: inboxTransport(() => smtpPort), mfaSetupEnforcement: false };
  app = makeApp({ env: { ...UNSIGNED_ENV }, p10 });
  void app.register(unattendedRoutes, { prefix: P, link });
  offApp = makeApp({ p10 });
  await Promise.all([app.ready(), offApp.ready()]);
});
afterAll(async () => {
  await Promise.all([app.close(), offApp.close()]);
  await closeSmtp(smtp);
});

interface Firm {
  tenantId: string;
  admin: TestUser;
  tech: TestUser;
  customerId: string;
  deviceId: string;
  email: string;
}

async function firm(o: { smtp?: boolean; contact?: boolean } = {}): Promise<Firm> {
  const t = await createTenant();
  if (o.smtp !== false) await setSmtp(t.id);
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const tech = await createUser({ tenantId: t.id, role: "USER", perms: { "unattended.connect": true } });
  const customer = await createCustomerRow(t.id);
  const email = o.contact === false ? "" : await contactRow(t.id, customer.id);
  const deviceId = await createDeviceRow({ tenantId: t.id, customerId: customer.id });
  return { tenantId: t.id, admin, tech, customerId: customer.id, email, deviceId };
}

/** 2FA kurulu, step-up'sız oturum (401 MFA_STEP_UP_REQUIRED yolu; kurulumsuz kullanıcı 403 MFA_SETUP_REQUIRED alır). */
async function noStepUp(u: TestUser): Promise<Session> {
  const s = await loginStepUp(app, u);
  await testDb().authSession.update({ where: { tokenHash: sha256Hex(s.token) }, data: { stepUpAt: null } });
  return s;
}

const call = (s: Session, o: InjectOptions, a: FastifyInstance = app) =>
  a.inject({ ...o, headers: { ...s.headers, ...(o.headers ?? {}) } });
const errCode = (r: { statusCode: number; json: () => unknown }) =>
  `${r.statusCode} ${(r.json() as { error?: { code: string } }).error?.code ?? ""}`.trim();
type Item = { id: string; canConnect: boolean; connectBlockedReason: string | null; verified: boolean; grantCount: number };
const listOf = async (s: Session, prefix = P): Promise<Item[]> =>
  (await call(s, { method: "GET", url: `${prefix}/devices?state=all` })).json<{ items: Item[] }>().items;
const statusOf = async (s: Session) =>
  (await call(s, { method: "GET", url: "/api/v1/unattended/status" })).json<{ mode: string; available: boolean; notifyChannel: boolean }>();
const newCode = (s: Session, customerId: string, a = app) =>
  call(s, { method: "POST", url: "/api/v1/unattended/registration-codes", payload: { customerId } }, a);

describe("P27-K2 kayıt kodu ve bağlantı ön koşulları", () => {
  it("AC-336: SMTP kaydı yoksa kod üretimi 409 NOTIFY_CHANNEL_UNAVAILABLE, liste nedeni 'smtp', status.notifyChannel=false; adres yoksa NOTIFY_CONTACT_REQUIRED", async () => {
    const f = await firm({ smtp: false });
    const su = await loginStepUp(app, f.admin);
    await grantRow(f.tenantId, f.deviceId, f.admin.id);
    link.online(f.deviceId);
    expect(errCode(await newCode(su, f.customerId))).toBe("409 NOTIFY_CHANNEL_UNAVAILABLE");
    expect((await listOf(su)).find((d) => d.id === f.deviceId)).toMatchObject({ canConnect: false, connectBlockedReason: "smtp" });
    expect((await statusOf(su)).notifyChannel).toBe(false);
    await setSmtp(f.tenantId);
    expect((await listOf(su)).find((d) => d.id === f.deviceId)).toMatchObject({ canConnect: true, connectBlockedReason: null });
    expect(await statusOf(await loginAs(app, f.tech))).toEqual({ mode: "unsigned", available: true, notifyChannel: true });
    const g = await firm({ contact: false });
    expect(errCode(await newCode(await loginStepUp(app, g.admin), g.customerId))).toBe("409 NOTIFY_CONTACT_REQUIRED");
  });

  it("AC-336 neden sırası: çevrimdışı → offline, yerel kapalı → local_disabled, adres yok → no_contacts, grant yok → no_grant", async () => {
    const f = await firm();
    const s = await loginAs(app, f.admin);
    const reason = async () => (await listOf(s)).find((d) => d.id === f.deviceId)?.connectBlockedReason;
    expect(await reason()).toBe("no_grant");
    await grantRow(f.tenantId, f.deviceId, f.admin.id);
    expect(await reason()).toBe("offline");
    link.online(f.deviceId);
    await testDb().unattendedDevice.update({ where: { id: f.deviceId }, data: { localEnabled: false } });
    expect(await reason()).toBe("local_disabled");
    await testDb().unattendedDevice.update({ where: { id: f.deviceId }, data: { localEnabled: true } });
    await testDb().customerNotifyContact.deleteMany({ where: { customerId: f.customerId } });
    expect(await reason()).toBe("no_contacts");
  });

  it("AC-297: mod off → kod üretimi 409 UNATTENDED_DISABLED, status {off, available:false}; unsigned → kod tek sefer döner", async () => {
    const f = await firm();
    const offSu = await loginStepUp(offApp, f.admin);
    expect(errCode(await newCode(offSu, f.customerId, offApp))).toBe("409 UNATTENDED_DISABLED");
    expect((await call(offSu, { method: "GET", url: "/api/v1/unattended/status" }, offApp)).json()).toEqual({
      mode: "off",
      available: false,
      notifyChannel: true,
    });
    const su = await loginStepUp(app, f.admin);
    const res = await newCode(su, f.customerId);
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; code: string }>();
    expect(body.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const list = (await call(su, { method: "GET", url: "/api/v1/unattended/registration-codes" })).body;
    expect(list).toContain(body.id);
    expect(list).not.toContain(body.code);
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { entityId: body.id, action: "unattended.code.created" } });
    expect(JSON.stringify(audit.newValue)).not.toContain(body.code.replace(/-/g, ""));
  });

  it("AC-273: kod üretimi step-up ister (401) ve tüketmez; DELETE bekleyen kodu iptal eder, ikinci DELETE 404", async () => {
    const f = await firm();
    expect(errCode(await newCode(await noStepUp(f.admin), f.customerId))).toBe("401 MFA_STEP_UP_REQUIRED");
    const su = await loginStepUp(app, f.admin);
    expect((await newCode(su, f.customerId)).statusCode).toBe(201);
    expect((await newCode(su, f.customerId)).statusCode).toBe(201); // tüketilmedi
    const id = await codeRow(f.tenantId, f.customerId);
    expect((await call(su, { method: "DELETE", url: `/api/v1/unattended/registration-codes/${id}` })).statusCode).toBe(204);
    expect(errCode(await call(su, { method: "DELETE", url: `/api/v1/unattended/registration-codes/${id}` }))).toBe("404 NOT_FOUND");
  });
});

describe("P27-K2 cihaz yetkisi, doğrulama ve iptal", () => {
  it("AC-293: yeni cihazda yetki yok; manage'siz teknisyen grant'sız cihazı listede görmez, ayrıntı 404", async () => {
    const f = await firm();
    const t = await loginAs(app, f.tech);
    expect((await listOf(t)).map((d) => d.id)).not.toContain(f.deviceId);
    expect(errCode(await call(t, { method: "GET", url: `${P}/devices/${f.deviceId}` }))).toBe("404 NOT_FOUND");
    await grantRow(f.tenantId, f.deviceId, f.tech.id);
    expect((await listOf(t)).map((d) => d.id)).toEqual([f.deviceId]);
    const detail = (await call(t, { method: "GET", url: `${P}/devices/${f.deviceId}` })).json<{ grants: unknown; registeredIp: unknown }>();
    expect(detail).toMatchObject({ grants: null, registeredIp: null });
  });

  it("AC-337: 'Yeni — doğrulanmadı' ilk grant'a kadar; ayrıntıda kayıt IP'si/zamanı; grant ekleme step-up ister, audit eski→yeni", async () => {
    const f = await firm();
    const s = await loginAs(app, f.admin);
    expect((await listOf(s)).find((d) => d.id === f.deviceId)?.verified).toBe(false);
    const detail = (await call(s, { method: "GET", url: `${P}/devices/${f.deviceId}` })).json<{
      registeredIp: string;
      registeredAt: string;
    }>();
    expect(detail.registeredIp).toBe("198.51.100.7");
    expect(detail.registeredAt).toMatch(/^\d{4}-/);
    const put = (x: Session, userIds: string[]) =>
      call(x, { method: "PUT", url: `${P}/devices/${f.deviceId}/grants`, payload: { userIds } });
    expect(errCode(await put(await noStepUp(f.admin), [f.tech.id]))).toBe("401 MFA_STEP_UP_REQUIRED");
    const su = await loginStepUp(app, f.admin);
    expect((await put(su, [f.tech.id])).statusCode).toBe(200);
    expect((await listOf(su)).find((d) => d.id === f.deviceId)).toMatchObject({ verified: true, grantCount: 1 });
    expect((await put(s, [])).statusCode).toBe(200); // kaldırma step-up istemez
    expect(link.calls).toContain(`grants:${f.deviceId}:${f.tech.id}`);
    const audits = await testDb().auditLog.findMany({
      where: { entityId: f.deviceId, action: "unattended.grant.changed" },
      orderBy: { id: "asc" },
    });
    expect(audits.map((a) => [a.oldValue, a.newValue])).toEqual([
      [{ userIds: [] }, expect.objectContaining({ userIds: [f.tech.id] })],
      [{ userIds: [f.tech.id] }, expect.objectContaining({ userIds: [] })],
    ]);
    expect((await listOf(s)).find((d) => d.id === f.deviceId)?.verified).toBe(true); // rozet geri gelmez
  });

  it("AC-293: grant adayı connect yetkisi olmayan / başka firmanın kullanıcısı → 400 fields.userIds", async () => {
    const f = await firm();
    const other = await firm();
    const plain = await createUser({ tenantId: f.tenantId, role: "USER" });
    const su = await loginStepUp(app, f.admin);
    for (const id of [plain.id, other.tech.id]) {
      const r = await call(su, { method: "PUT", url: `${P}/devices/${f.deviceId}/grants`, payload: { userIds: [id] } });
      expect(r.statusCode).toBe(400);
      expect(r.json<{ error: { fields: Record<string, string> } }>().error.fields.userIds).toBeTruthy();
    }
  });

  it("AC-339: kendine yetki → audit selfGrant:true + diğer manage sahiplerine e-posta (çağırana değil)", async () => {
    const f = await firm();
    const other = await createUser({ tenantId: f.tenantId, role: "ADMIN" });
    const su = await loginStepUp(app, f.admin);
    const before = inbox.length;
    expect(
      (await call(su, { method: "PUT", url: `${P}/devices/${f.deviceId}/grants`, payload: { userIds: [f.admin.id] } })).statusCode,
    ).toBe(200);
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: f.deviceId, action: "unattended.grant.changed" } });
    expect(a.newValue).toMatchObject({ selfGrant: true });
    await expect.poll(() => inbox.slice(before).some((m) => m.to === other.email)).toBe(true);
    expect(inbox.slice(before).some((m) => m.to === f.admin.email)).toBe(false);
  });

  it("AC-275: iptal 204 → hub'a revoked, grant'lar silinir, last_ip NULL, audit; ikinci iptal 409", async () => {
    const f = await firm();
    await grantRow(f.tenantId, f.deviceId, f.tech.id);
    const s = await loginAs(app, f.admin);
    expect((await call(s, { method: "POST", url: `${P}/devices/${f.deviceId}/revoke`, payload: {} })).statusCode).toBe(204);
    expect(link.calls).toContain(`revoked:${f.deviceId}`);
    const dev = await testDb().unattendedDevice.findUniqueOrThrow({ where: { id: f.deviceId } });
    expect(dev).toMatchObject({ revokeReason: "ADMIN", revokedBy: f.admin.id, lastIp: null });
    expect(await testDb().unattendedDeviceGrant.count({ where: { deviceId: f.deviceId } })).toBe(0);
    expect(await testDb().auditLog.count({ where: { entityId: f.deviceId, action: "unattended.device.revoked" } })).toBe(1);
    expect((await call(s, { method: "POST", url: `${P}/devices/${f.deviceId}/revoke`, payload: {} })).statusCode).toBe(409);
    expect((await listOf(s)).map((d) => d.id)).not.toContain(f.deviceId);
  });
});

describe("P27-K2 bildirim adresleri ve SMTP değişikliği", () => {
  const put = (s: Session, f: Firm, items: { email: string; phone?: string }[]) =>
    call(s, { method: "PUT", url: `/api/v1/unattended/customers/${f.customerId}/contacts`, payload: { items } });

  it("AC-337: adres kaydı step-up ister; fark varsa eski ∪ yeni adreslere UN_CONTACTS_CHANGED satırı, maskeli audit; fark yoksa yazma yok", async () => {
    const f = await firm();
    expect(errCode(await put(await noStepUp(f.admin), f, [{ email: "a@x.test" }]))).toBe("401 MFA_STEP_UP_REQUIRED");
    const su = await loginStepUp(app, f.admin);
    const next = [{ email: "yeni@musteri.test", phone: "+905321234567" }];
    expect((await put(su, f, next)).json()).toEqual({ items: [{ email: "yeni@musteri.test", phone: "+905321234567" }] });
    const rows = await testDb().notificationOutbox.findMany({ where: { tenantId: f.tenantId, kind: "UN_CONTACTS_CHANGED" } });
    expect(rows.map((r) => r.channel)).toEqual(["EMAIL", "EMAIL"]);
    expect(new Set(rows.map((r) => r.eventId)).size).toBe(1);
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: f.customerId, action: "unattended.contacts.changed" } });
    expect(a.newValue).toMatchObject({ stepUp: true, eventId: rows[0]?.eventId });
    expect(JSON.stringify([a.oldValue, a.newValue])).not.toContain("yeni@musteri.test");
    expect(JSON.stringify([a.oldValue, a.newValue])).not.toContain(f.email);
    expect((await put(su, f, next)).statusCode).toBe(200);
    expect(await testDb().notificationOutbox.count({ where: { tenantId: f.tenantId, kind: "UN_CONTACTS_CHANGED" } })).toBe(2);
    expect(await testDb().auditLog.count({ where: { entityId: f.customerId, action: "unattended.contacts.changed" } })).toBe(1);
  });

  it("AC-296: en çok 5 adres, tekil e-posta → 400; GET adresleri döner", async () => {
    const f = await firm();
    const su = await loginStepUp(app, f.admin);
    const six = Array.from({ length: 6 }, (_, i) => ({ email: `m${i}@x.test` }));
    expect((await put(su, f, six)).statusCode).toBe(400);
    expect((await put(su, f, [{ email: "a@x.test" }, { email: "A@x.test" }])).statusCode).toBe(400);
    const got = await call(su, { method: "GET", url: `/api/v1/unattended/customers/${f.customerId}/contacts` });
    expect(got.json()).toEqual({ items: [{ email: f.email, phone: null }] });
  });

  it("AC-336: etkin cihaz varken SMTP değişikliği step-up ister; kayıtta audit unattendedDevices + eski yapılandırmayla bildirim", async () => {
    const f = await firm();
    const other = await createUser({ tenantId: f.tenantId, role: "ADMIN" });
    const smtpBody = { smtp: { host: "smtp.test", port: 2525, security: "NONE", fromEmail: "yeni@firma.test" } };
    const req = { method: "PUT" as const, url: "/api/v1/settings/tenant", payload: smtpBody };
    expect(errCode(await call(await noStepUp(f.admin), req))).toBe("401 MFA_STEP_UP_REQUIRED");
    const before = inbox.length;
    expect((await call(await loginStepUp(app, f.admin), req)).statusCode).toBe(200);
    const a = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: f.tenantId, action: "tenant_settings.updated" } });
    expect(a.newValue).toMatchObject({ unattendedDevices: 1, smtpChangeNotice: "sent" });
    expect(inbox.slice(before).some((m) => m.to === other.email)).toBe(true);
    const g = await firm();
    await testDb().unattendedDevice.update({
      where: { id: g.deviceId },
      data: { revokedAt: new Date(), revokeReason: "UNINSTALLED", lastIp: null },
    });
    expect((await call(await loginAs(app, g.admin), req)).statusCode).toBe(200); // etkin cihaz yok → step-up yok
  });
});
