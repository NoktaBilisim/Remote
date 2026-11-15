// P27-K3 bağlantı ucu + otomatik kabul (mimari-p27 §2, §4.3 r2, §7.1; AC-273, 275, 293, 295, 296, 336, 338, 339).
// Gerçek dinleyen sunucu + sahte servis (`/ws/device`, Ed25519) + sahte yardımcı (`/ws/guest` bileti).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, loginAs, loginStepUp, markStepUp, testDb } from "../helpers/app.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { UNSIGNED_ENV } from "../helpers/unattended.ts";
import {
  activeSession,
  connectReq,
  helperGuest,
  keyedDevice,
  onlineDevice,
  ready,
  sessionStatus,
  waitUntil,
  type ConnectMsg,
} from "../helpers/unattended-device.ts";
import { grantRow, setSmtp } from "../helpers/unattended.ts";

let live: Live;
beforeAll(async () => {
  live = await startLive({ env: { ...UNSIGNED_ENV }, signaling: { timing: { requestConnectMs: 1500 } } });
});
afterAll(async () => live.close());

const audits = (entityId: string, action: string) => testDb().auditLog.findMany({ where: { entityId, action } });

describe("P27-K3 POST /unattended/devices/:id/connect", () => {
  it("AC-273 AC-296: bağlan → cihaza connect (TEST göstergesi) → yardımcı kabul → ACTIVE UNATTENDED + onay + audit + outbox", async () => {
    const r = await ready(live);
    const { sessionId, msg } = await activeSession(live, r);
    expect(msg.indicatorText).toContain("TEST");
    expect(msg.expiresInSec).toBeGreaterThan(0);
    expect(await sessionStatus(sessionId)).toMatchObject({ status: "ACTIVE", mode: "UNATTENDED" });
    const consent = await testDb().sessionConsent.findFirst({ where: { sessionId, level: "VIEW" } });
    expect(consent).toMatchObject({ source: "UNATTENDED", decision: "GRANTED", consentTextId: null });
    const ok = await audits(sessionId, "unattended.connect");
    expect(ok[0]?.result).toBe("success");
    expect(ok[0]?.newValue).toMatchObject({ deviceId: r.dev.id, stepUpMethod: "totp" });
    expect(await audits(sessionId, "unattended.session.started")).toHaveLength(1);
    const outbox = await testDb().notificationOutbox.findMany({ where: { sessionId } });
    expect(outbox.map((o) => [o.kind, o.channel, o.state])).toEqual([["UNATTENDED_STARTED", "EMAIL", "PENDING"]]);
    const auth = await testDb().authSession.findFirstOrThrow({ where: { userId: r.tech.id }, select: { stepUpAt: true } });
    expect(auth.stepUpAt).toBeNull(); // step-up tüketildi
  });

  it("AC-273: aynı step-up ile ikinci bağlantı (başka cihaz) → 401 MFA_STEP_UP_REQUIRED", async () => {
    const r = await ready(live);
    const dev2 = await keyedDevice(r.tenantId, r.customerId);
    await grantRow(r.tenantId, dev2.id, r.tech.id);
    await onlineDevice(live, dev2);
    expect((await live.app.inject(connectReq(r))).statusCode).toBe(200);
    const second = await live.app.inject(connectReq({ s: r.s, dev: dev2 }));
    expect(second.statusCode).toBe(401);
    expect(second.json<{ error: { code: string } }>().error.code).toBe("MFA_STEP_UP_REQUIRED");
  });

  it("AC-293 AC-336 AC-296: zincir sırası — grant yok 404, yerel kapalı, adres yok, SMTP yok, çevrimdışı; her ret audit'lenir", async () => {
    const r = await ready(live);
    const code = async () => {
      const res = await live.app.inject(connectReq(r));
      return `${res.statusCode} ${res.json<{ error: { code: string } }>().error.code}`;
    };
    await testDb().unattendedDeviceGrant.deleteMany({ where: { deviceId: r.dev.id } });
    expect(await code()).toBe("404 NOT_FOUND");
    await grantRow(r.tenantId, r.dev.id, r.tech.id);
    await testDb().unattendedDevice.update({ where: { id: r.dev.id }, data: { localEnabled: false } });
    expect(await code()).toBe("409 DEVICE_LOCAL_DISABLED");
    await testDb().unattendedDevice.update({ where: { id: r.dev.id }, data: { localEnabled: true } });
    const contacts = await testDb().customerNotifyContact.findMany({ where: { customerId: r.customerId } });
    await testDb().customerNotifyContact.deleteMany({ where: { customerId: r.customerId } });
    expect(await code()).toBe("409 NOTIFY_CONTACT_REQUIRED");
    await testDb().customerNotifyContact.createMany({ data: contacts });
    await testDb().tenantSettings.update({
      where: { tenantId: r.tenantId },
      data: { smtpHost: null, smtpPort: null, smtpSecurity: null, smtpFromEmail: null },
    });
    expect(await code()).toBe("409 NOTIFY_CHANNEL_UNAVAILABLE");
    await setSmtp(r.tenantId);
    r.device.ws.close();
    await waitUntil(async () => !live.app.unattendedHub.isOnline(r.dev.id));
    expect(await code()).toBe("409 DEVICE_OFFLINE");
    const fails = await audits(r.dev.id, "unattended.connect");
    expect(fails.map((a) => (a.newValue as { reason: string }).reason).sort()).toEqual(
      ["local_disabled", "no_channel", "no_contact", "not_found", "offline"].sort(),
    );
  });

  it("AC-338: eşzamanlı iki bağlantı → biri {sessionId}, diğeri 409 DEVICE_BUSY", async () => {
    const r = await ready(live);
    const [a, b] = await Promise.all([live.app.inject(connectReq(r)), live.app.inject(connectReq(r))]);
    const codes = [a, b].map((x) => x.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    const busy = [a, b].find((x) => x.statusCode === 409);
    expect(busy?.json<{ error: { code: string } }>().error.code).toBe("DEVICE_BUSY");
  });

  it("AC-338: iptal ‖ yardımcı kabulü → yetkisiz ACTIVE oturum kalmaz", async () => {
    const r = await ready(live);
    const admin = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const as = await loginAs(live.app, admin);
    expect((await live.app.inject(connectReq(r))).statusCode).toBe(200);
    const msg = (await r.device.waitFor("connect" as never)) as unknown as ConnectMsg;
    await Promise.all([
      helperGuest(live, msg.ticket).catch(() => undefined),
      live.app.inject({ method: "POST", url: `/api/v1/unattended/devices/${r.dev.id}/revoke`, headers: as.headers, payload: {} }),
    ]);
    await waitUntil(async () => (await sessionStatus(msg.sessionId)).status !== "PENDING");
    await new Promise((res) => setTimeout(res, 300));
    expect((await sessionStatus(msg.sessionId)).status).not.toBe("ACTIVE");
  });

  it("AC-275: iptal → cihaza revoked + 4401, oda device_revoked ile biter (≤ 10 sn), sonra bağlantı 404", async () => {
    const r = await ready(live);
    const { sessionId, helper } = await activeSession(live, r);
    const admin = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const as = await loginAs(live.app, admin);
    const t0 = Date.now();
    const rev = await live.app.inject({
      method: "POST",
      url: `/api/v1/unattended/devices/${r.dev.id}/revoke`,
      headers: as.headers,
      payload: {},
    });
    expect(rev.statusCode).toBe(204);
    expect((await helper.waitFor("session.ended")).reason).toBe("device_revoked");
    expect((await r.device.closed).code).toBe(4401);
    expect(Date.now() - t0).toBeLessThan(10_000);
    await waitUntil(async () => (await sessionStatus(sessionId)).status === "ENDED");
    await markStepUp(r.s);
    expect((await live.app.inject(connectReq(r))).statusCode).toBe(404);
  });

  it("AC-293: yetki geri alma → açık oda permission ile biter (≤ 5 sn)", async () => {
    const r = await ready(live);
    const { helper } = await activeSession(live, r);
    const admin = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const as = await loginStepUp(live.app, admin);
    const t0 = Date.now();
    const put = await live.app.inject({
      method: "PUT",
      url: `/api/v1/unattended/devices/${r.dev.id}/grants`,
      headers: as.headers,
      payload: { userIds: [] },
    });
    expect(put.statusCode).toBe(200);
    expect((await helper.waitFor("session.ended")).reason).toBe("permission");
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("AC-295: device.state{false} → oda local_disabled ile biter, DB + audit", async () => {
    const r = await ready(live);
    const { helper } = await activeSession(live, r);
    r.device.send({ t: "device.state", localEnabled: false });
    expect((await helper.waitFor("session.ended")).reason).toBe("local_disabled");
    const dev = await testDb().unattendedDevice.findUniqueOrThrow({ where: { id: r.dev.id } });
    expect(dev.localEnabled).toBe(false);
    expect(await audits(r.dev.id, "unattended.local_state")).toHaveLength(1);
  });

  it("AC-294: connect.result{ok:false, indicator_failed} → CANCELLED(indicator_failed); helper_failed DB'de kalır", async () => {
    const r = await ready(live);
    expect((await live.app.inject(connectReq(r))).statusCode).toBe(200);
    const msg = (await r.device.waitFor("connect" as never)) as unknown as ConnectMsg;
    r.device.send({ t: "connect.result", sessionId: msg.sessionId, ok: false, reason: "indicator_failed" });
    await waitUntil(async () => (await sessionStatus(msg.sessionId)).status === "CANCELLED");
    expect((await sessionStatus(msg.sessionId)).endReason).toBe("indicator_failed");
    await markStepUp(r.s);
    expect((await live.app.inject(connectReq(r))).statusCode).toBe(200);
    const m2 = (await r.device.waitFor("connect" as never)) as unknown as ConnectMsg;
    r.device.send({ t: "connect.result", sessionId: m2.sessionId, ok: false, reason: "helper_failed" });
    await waitUntil(async () => (await sessionStatus(m2.sessionId)).endReason === "helper_failed");
  });

  it("§2 adım 8: cihaz pencere içinde katılmazsa CANCELLED(device_timeout)", async () => {
    const r = await ready(live);
    expect((await live.app.inject(connectReq(r))).statusCode).toBe(200);
    const msg = (await r.device.waitFor("connect" as never)) as unknown as ConnectMsg;
    await waitUntil(async () => (await sessionStatus(msg.sessionId)).status === "CANCELLED");
    expect((await sessionStatus(msg.sessionId)).endReason).toBe("device_timeout");
    expect((await r.device.waitFor("disconnect" as never)) as unknown).toMatchObject({
      sessionId: msg.sessionId,
      reason: "device_timeout",
    });
  });

  it("AC-339: kurtarma koduyla step-up → audit stepUpMethod=recovery_code", async () => {
    const r = await ready(live);
    const s = await testDb().authSession.findFirstOrThrow({ where: { userId: r.tech.id }, select: { id: true } });
    await testDb().auditLog.create({
      data: {
        tenantId: r.tenantId,
        userId: r.tech.id,
        action: "auth.step_up",
        entity: "auth_sessions",
        entityId: s.id,
        result: "success",
        newValue: { method: "RECOVERY", remaining: 5 },
      },
    });
    const res = await live.app.inject(connectReq(r));
    const sessionId = res.json<{ sessionId: string }>().sessionId;
    expect((await audits(sessionId, "unattended.connect"))[0]?.newValue).toMatchObject({ stepUpMethod: "recovery_code" });
  });

  it("AC-275 §3.6: müşteri pasife alınınca cihaz CUSTOMER_PASSIVE ile iptal, soket 4401", async () => {
    const r = await ready(live);
    const admin = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const as = await loginAs(live.app, admin);
    const res = await live.app.inject({
      method: "POST",
      url: `/api/v1/customers/${r.customerId}/deactivate`,
      headers: as.headers,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect((await r.device.closed).code).toBe(4401);
    const dev = await testDb().unattendedDevice.findUniqueOrThrow({ where: { id: r.dev.id } });
    expect(dev.revokeReason).toBe("CUSTOMER_PASSIVE");
  });
});
