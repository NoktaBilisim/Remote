// P27-K4 (mimari-p27 §3.6, §7.1 r2; AC-296, 336, 337, 275 temizlik): outbox işçisinin gözetimsiz türleri teslimi, "Son
// bildirim gönderilemedi" rozeti, müşteri anonimleştirmesinde adres silme ve gece temizliği. Sahte SMTP süreç içi
// (smtp.test:2525 → yerel inbox; 25 → kapalı port = geçici hata). Saat sahte (0/10/30 sn yeniden deneme).
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SMTPServer } from "smtp-server";
import { anonymizeCustomersOf } from "../../src/customers/service.ts";
import { deleteOldRegistrationCodes, deleteRevokedDevices } from "../../src/jobs/unattended-cleanup.ts";
import { outboxContent } from "../../src/notify/outbox-content.ts";
import { enqueueStarted } from "../../src/unattended/notify.ts";
import { createTenant, createUser, loginAs, loginStepUp, makeApp, testDb } from "../helpers/app.ts";
import { closeSmtp, inboxTransport, loopbackNetguard, startInboxSmtp } from "../helpers/mail-tls.ts";
import { createCustomerRow } from "../helpers/requests.ts";
import { codeRow, contactRow, createDeviceRow, deviceSessionRow, setSmtp } from "../helpers/unattended.ts";
import { FakeClock } from "../helpers/ws.ts";

const inbox: { to: string; body: string }[] = [];
let smtp: SMTPServer;
let smtpPort = 0;
let clock: FakeClock;
let app: FastifyInstance;

beforeAll(async () => {
  ({ smtp, port: smtpPort } = await startInboxSmtp(inbox));
  clock = new FakeClock();
  app = makeApp({
    signaling: { clock },
    p10: { netguard: loopbackNetguard(), mailTransport: inboxTransport(() => smtpPort), mfaSetupEnforcement: false },
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await closeSmtp(smtp);
});

async function firm() {
  const t = await createTenant();
  await setSmtp(t.id);
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  const customer = await createCustomerRow(t.id);
  const email = await contactRow(t.id, customer.id);
  const deviceId = await createDeviceRow({ tenantId: t.id, customerId: customer.id, name: "MUHASEBE-PC" });
  return { tenantId: t.id, admin, customerId: customer.id, email, deviceId };
}

type Firm = Awaited<ReturnType<typeof firm>>;

/** Gözetimsiz oturum + admit TX'indeki gibi `UNATTENDED_STARTED` satırları. */
async function started(f: Firm): Promise<string> {
  const sessionId = await deviceSessionRow(f.tenantId, f.admin.id, f.deviceId);
  const now = new Date(clock.now());
  await testDb().$transaction((tx) => enqueueStarted(tx, app.secrets, { tenantId: f.tenantId, sessionId, customerId: f.customerId, now }));
  return sessionId;
}

const rowsOf = (where: { sessionId?: string; eventId?: string }) => testDb().notificationOutbox.findMany({ where });
const failedAt = async (id: string) => (await testDb().unattendedDevice.findUniqueOrThrow({ where: { id } })).notifyFailedAt;

/** Kendi satırları son duruma gelene kadar (başka dosyaların satırları aynı kuyruktadır) tur + sahte saat. */
async function drain(where: { sessionId?: string; eventId?: string }): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await app.outbox.tick();
    if ((await rowsOf(where)).every((r) => r.state === "SENT" || r.state === "FAILED")) return;
    clock.advance(30_000);
  }
}

describe("P27-K4 outbox — gözetimsiz türlerin teslimi", () => {
  it("AC-296: UNATTENDED_STARTED → müşteri adresine e-posta (SENT, alıcı NULL) + audit request.customer_notify (oturum çapası)", async () => {
    const f = await firm();
    const sessionId = await started(f);
    await drain({ sessionId });
    const [row] = await rowsOf({ sessionId });
    expect(row).toMatchObject({ kind: "UNATTENDED_STARTED", channel: "EMAIL", state: "SENT", recipientEnc: null });
    expect(inbox.some((m) => m.to === f.email)).toBe(true);
    const a = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: f.tenantId, action: "request.customer_notify" } });
    expect(a).toMatchObject({ entity: "support_sessions", entityId: sessionId, result: "success" });
    expect(await failedAt(f.deviceId)).toBeNull();
  });

  it("AC-296: içerik cihaz adı + teknisyen + destek firması; bağlantı/URL yok", async () => {
    const f = await firm();
    const sessionId = await started(f);
    const [row] = await rowsOf({ sessionId });
    if (!row) throw new Error("satır yok");
    const c = await outboxContent(app.db, { ...row, firm: "Nokta Destek", requestCode: null });
    expect(c?.text).toContain("MUHASEBE-PC");
    expect(c?.text).toContain("Test K.");
    expect(c?.mail.subject).toContain("Nokta Destek");
    expect(`${c?.text} ${c?.mail.text}`).not.toMatch(/https?:|www\./);
    expect(c?.deviceId).toBe(f.deviceId);
  });

  it("AC-336: 3 denemede FAILED → rozet + audit unattended.notify.failed; sonraki başarılı bildirim rozeti kaldırır", async () => {
    const f = await firm();
    await testDb().tenantSettings.update({ where: { tenantId: f.tenantId }, data: { smtpPort: 25 } }); // kapalı port
    const s1 = await started(f);
    await drain({ sessionId: s1 });
    expect((await rowsOf({ sessionId: s1 }))[0]).toMatchObject({ state: "FAILED", attempts: 3, lastReason: "unreachable" });
    expect(await failedAt(f.deviceId)).not.toBeNull();
    const audit = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: f.tenantId, action: "unattended.notify.failed" } });
    expect(audit).toMatchObject({ entity: "support_sessions", entityId: s1, result: "fail" });
    expect(audit.newValue).toMatchObject({ sessionId: s1, deviceId: f.deviceId, channel: "EMAIL", reason: "unreachable" });
    expect(JSON.stringify(audit.newValue)).not.toContain(f.email);
    const s = await loginAs(app, f.admin);
    const list = async () =>
      (await app.inject({ method: "GET", url: "/api/v1/unattended/devices", headers: s.headers })).json<{
        items: { id: string; notifyFailed: boolean }[];
      }>().items;
    expect((await list()).find((d) => d.id === f.deviceId)?.notifyFailed).toBe(true);

    await setSmtp(f.tenantId);
    clock.advance(1_000);
    const s2 = await started(f);
    await drain({ sessionId: s2 });
    expect((await rowsOf({ sessionId: s2 }))[0]?.state).toBe("SENT");
    expect(await failedAt(f.deviceId)).toBeNull();
    expect((await list()).find((d) => d.id === f.deviceId)?.notifyFailed).toBe(false);
  });

  it("AC-337: adres değişikliği → eski ∪ yeni her adrese e-posta (SENT); içerik maskeli fark + değiştiren kullanıcı", async () => {
    const f = await firm();
    const s = await loginStepUp(app, f.admin);
    const next = `yeni-${f.tenantId.toLowerCase()}@musteri.test`;
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/unattended/customers/${f.customerId}/contacts`,
      headers: s.headers,
      payload: { items: [{ email: next }] },
    });
    expect(res.statusCode).toBe(200);
    const rows = await testDb().notificationOutbox.findMany({ where: { tenantId: f.tenantId, kind: "UN_CONTACTS_CHANGED" } });
    expect(rows).toHaveLength(2);
    const first = rows[0];
    if (!first?.eventId) throw new Error("olay satırı yok");
    const eventId = first.eventId;
    const c = await outboxContent(app.db, { ...first, firm: "Nokta", requestCode: null });
    expect(c?.mail.text).toMatch(/Eklenen: y\*+/);
    expect(c?.mail.text).toMatch(/Kaldırılan: m\*+/);
    expect(c?.mail.text).not.toContain(next);
    expect(c?.mail.text).toContain("Test K.");
    expect(c).toMatchObject({ entity: "customers", entityId: f.customerId, text: null });
    await drain({ eventId });
    expect((await rowsOf({ eventId })).map((r) => r.state)).toEqual(["SENT", "SENT"]);
    expect(inbox.filter((m) => m.to === f.email || m.to === next).length).toBeGreaterThanOrEqual(2);
  });
});

describe("P27-K4 saklama / temizlik (mimari-p27 §3.6)", () => {
  it("AC-296 KVKK: müşteri anonimleştirmesi bildirim adreslerini aynı TX'te siler (audit notifyContacts)", async () => {
    const f = await firm();
    await testDb().customer.update({
      where: { id: f.customerId },
      data: { status: "PASSIVE", passiveAt: new Date(Date.now() - 10 * 86_400_000) },
    });
    const n = await anonymizeCustomersOf(app.requests, { tenantId: f.tenantId, retentionDays: 1 }, new Date());
    expect(n).toBe(1);
    expect(await testDb().customerNotifyContact.count({ where: { customerId: f.customerId } })).toBe(0);
    const a = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: f.tenantId, action: "customer.anonymized" } });
    expect(a.newValue).toMatchObject({ notifyContacts: 1 });
  });

  it("AC-275 temizlik: süresi dolmuş kod +7 g silinir (daha yenisi kalır); 30 g önce iptal edilmiş oturumsuz cihaz silinir, oturumlu kalır", async () => {
    const f = await firm();
    const day = 86_400_000;
    const oldCode = await codeRow(f.tenantId, f.customerId, { createdAt: new Date(Date.now() - 9 * day) });
    const freshCode = await codeRow(f.tenantId, f.customerId, { createdAt: new Date(Date.now() - 3 * day) });
    const gone = await createDeviceRow({ tenantId: f.tenantId, customerId: f.customerId });
    const revoked = { revokedAt: new Date(Date.now() - 31 * day), revokeReason: "UNINSTALLED", lastIp: null };
    await testDb().unattendedDevice.updateMany({ where: { id: { in: [gone, f.deviceId] } }, data: revoked });
    await deviceSessionRow(f.tenantId, f.admin.id, f.deviceId); // bağlı oturum → kalır (anonimleştirme device_id'yi NULL'lar)
    expect(await deleteOldRegistrationCodes(app.db, new Date(), 500)).toBeGreaterThanOrEqual(1);
    expect(await deleteRevokedDevices(app.db, new Date(), 500)).toBeGreaterThanOrEqual(1);
    const codes = await testDb().unattendedRegistrationCode.findMany({ where: { id: { in: [oldCode, freshCode] } } });
    expect(codes.map((c) => c.id)).toEqual([freshCode]);
    const devs = await testDb().unattendedDevice.findMany({ where: { id: { in: [gone, f.deviceId] } } });
    expect(devs.map((d) => d.id)).toEqual([f.deviceId]);
  });
});
