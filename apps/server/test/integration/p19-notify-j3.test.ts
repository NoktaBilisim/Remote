// P19 J3 (AC-260, AC-261; S-P19-5/6/7/10/12, T5/T6/T7/T11/T13): bağlantı gönderimi, SMS ayarı, durum bildirimi kuyruğu.
// Sahte smsportal ve WhatsApp servisleri yerel (127.0.0.1); gerçek servise istek gitmez. Saat sahte (outbox gecikmeleri).
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOTIFY_LIMITS } from "@remote/contracts/api/notify";
import { writeAudit } from "../../src/audit/service.ts";
import { countAllByVersion } from "../../src/cli/crypto.ts";
import { recipientHash } from "../../src/notify/outbox.ts";
import { sweepRequests } from "../../src/requests/jobs.ts";
import {
  createSupportSessionRow,
  createTenant,
  createUser,
  loginAs,
  makeApp,
  ORIGIN,
  testDb,
  type Session,
  type TestUser,
} from "../helpers/app.ts";
import { createRequestRow, createRequestSettings, startFakeWhatsapp, type FakeWhatsapp } from "../helpers/requests.ts";
import { FakeClock } from "../helpers/ws.ts";

const API_KEY = `test-sms-${"k".repeat(24)}`; // sahte smsportal anahtarı (gerçek değil)
let sms: FakeWhatsapp;
let wa: FakeWhatsapp;
let clock: FakeClock;
let app: FastifyInstance;

const build = (env: Record<string, string> = {}): FastifyInstance =>
  makeApp({
    env: { SMSPORTAL_URL: sms.url, WHATSAPP_SERVICE_URL: wa.url, ...env },
    signaling: { clock },
  });

async function firm(): Promise<{ tenantId: string; admin: TestUser; s: Session }> {
  const t = await createTenant();
  await createRequestSettings(t.id);
  const admin = await createUser({ tenantId: t.id, role: "ADMIN" });
  return { tenantId: t.id, admin, s: await loginAs(app, admin) };
}

async function setKey(s: Session, body: Record<string, unknown> = { url: null, header: "NOKTA", apiKey: API_KEY }) {
  return app.inject({ method: "PUT", url: "/api/v1/settings/sms", headers: s.headers, payload: body });
}

beforeAll(async () => {
  sms = await startFakeWhatsapp();
  wa = await startFakeWhatsapp();
  clock = new FakeClock();
  app = build();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await sms.close();
  await wa.close();
});

describe("AC-260 bağlantı gönderimi (SMS / WhatsApp)", () => {
  it("AC-260: smsportal gövdesi {phone:'5…', message, header} + x-api-key; E.164 tablo; yurt dışı 400; audit maskeli, anahtar yok", async () => {
    const f = await firm();
    expect((await setKey(f.s)).statusCode).toBe(200);
    for (const phone of ["05321234567", "+90 532 123 45 67", "905321234567"]) {
      const sess = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.admin.id });
      const before = sms.hits.length;
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${sess.id}/send-link`,
        headers: f.s.headers,
        payload: { channel: "SMS", phone, link: `${ORIGIN}/session/${sess.token}` },
      });
      expect(res.statusCode, res.body).toBe(200);
      const hit = sms.hits[before];
      expect(hit?.path).toBe("/api/external/send-sms");
      expect(hit?.apiKey).toBe(API_KEY);
      expect(hit?.body.phone).toBe("5321234567");
      expect(hit?.body.header).toBe("NOKTA");
      expect(String(hit?.body.message)).toContain(`${ORIGIN}/session/${sess.token}`);
    }
    const sess = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.admin.id });
    const intl = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sess.id}/send-link`,
      headers: f.s.headers,
      payload: { channel: "SMS", phone: "+4915112345678", link: `${ORIGIN}/session/${sess.token}` },
    });
    expect(intl.statusCode).toBe(400);
    const other = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sess.id}/send-link`,
      headers: f.s.headers,
      payload: { channel: "SMS", phone: "05321234567", link: `${ORIGIN}/session/baskabirtoken0000000000000000000` },
    });
    expect(other.statusCode).toBe(400); // S-P19-7: başka bağlantı gönderilemez
    const audits = await testDb().auditLog.findMany({
      where: { tenantId: f.tenantId, action: { in: ["session.link_sent", "settings.sms_updated"] } },
    });
    const text = JSON.stringify(audits.map((a) => [a.oldValue, a.newValue]));
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain("5321234567");
    expect(text).toContain("+90******4567");
  });

  it("AC-260: WhatsApp kanalı + servis 500 → 502 UPSTREAM fields.reason; kanal yok → 409 CHANNEL_UNAVAILABLE; options", async () => {
    const f = await firm();
    const sess = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.admin.id });
    const link = `${ORIGIN}/session/${sess.token}`;
    const opts = await app.inject({ method: "GET", url: `/api/v1/sessions/${sess.id}/send-link/options`, headers: f.s.headers });
    expect(opts.json()).toEqual({ sms: false, whatsapp: true, suggestedPhone: null });
    const noSms = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sess.id}/send-link`,
      headers: f.s.headers,
      payload: { channel: "SMS", phone: "05321234568", link },
    });
    expect(noSms.statusCode).toBe(409);
    expect(noSms.json().error.code).toBe("CHANNEL_UNAVAILABLE");
    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sess.id}/send-link`,
      headers: f.s.headers,
      payload: { channel: "WHATSAPP", phone: "+4915112345678", link },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(wa.hits.at(-1)?.body.phoneNumber).toBe("4915112345678");
    wa.plan = () => 500;
    try {
      const bad = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${sess.id}/send-link`,
        headers: f.s.headers,
        payload: { channel: "WHATSAPP", phone: "+4915112345679", link },
      });
      expect(bad.statusCode).toBe(502);
      expect(bad.json().error.fields.reason).toBe("http_error");
    } finally {
      wa.plan = () => 200;
    }
  });

  it("AC-260: 21. gönderim 429 (audit sayımı; yeniden başlatma sonrası da); alıcı 6. → 429", async () => {
    const f = await firm();
    expect((await setKey(f.s)).statusCode).toBe(200);
    for (let i = 0; i < 20; i++)
      await writeAudit(
        testDb(),
        { ip: "", userAgent: "test", requestId: "" },
        {
          tenantId: f.tenantId,
          userId: f.admin.id,
          username: f.admin.email,
          action: "session.link_sent",
          entity: "support_sessions",
          result: "success",
          newValue: { phase: "reserved", channel: "SMS", recipient: "+90*****0000" },
        },
      );
    const sess = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: f.admin.id });
    const payload = { channel: "SMS", phone: "05330000001", link: `${ORIGIN}/session/${sess.token}` };
    const r1 = await app.inject({ method: "POST", url: `/api/v1/sessions/${sess.id}/send-link`, headers: f.s.headers, payload });
    expect(r1.statusCode).toBe(429);
    const app2 = build();
    await app2.ready();
    try {
      const s2 = await loginAs(app2, f.admin);
      const r2 = await app2.inject({ method: "POST", url: `/api/v1/sessions/${sess.id}/send-link`, headers: s2.headers, payload });
      expect(r2.statusCode).toBe(429);
    } finally {
      await app2.close();
    }
    // Alıcı kovası 5/sa (başka teknisyen, aynı numara).
    const tech = await createUser({ tenantId: f.tenantId, role: "ADMIN" });
    const ts = await loginAs(app, tech);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const s = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: tech.id });
      const r = await app.inject({
        method: "POST",
        url: `/api/v1/sessions/${s.id}/send-link`,
        headers: ts.headers,
        payload: { channel: "SMS", phone: "05330000002", link: `${ORIGIN}/session/${s.token}` },
      });
      codes.push(r.statusCode);
    }
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("AC-260: send_link yetkisi olmayan USER → 403", async () => {
    const f = await firm();
    const user = await createUser({ tenantId: f.tenantId, role: "USER", perms: { "sessions.create": true } });
    const us = await loginAs(app, user);
    const sess = await createSupportSessionRow({ tenantId: f.tenantId, technicianId: user.id });
    const r = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sess.id}/send-link`,
      headers: us.headers,
      payload: { channel: "SMS", phone: "05321234567", link: `${ORIGIN}/session/${sess.token}` },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("AC-260 SMS ayarı ve test (S-P19-5/6, T5/T6/T7)", () => {
  it("AC-260: GET alanları; userinfo/sorgu/parça 400; iç adres 400 HOST_NOT_ALLOWED; köken değişince anahtar zorunlu", async () => {
    const f = await firm();
    const g0 = await app.inject({ method: "GET", url: "/api/v1/settings/sms", headers: f.s.headers });
    expect(g0.json()).toMatchObject({ url: null, defaultUrl: true, header: null, apiKeySet: false, keyUnreadable: false, usable: false });
    for (const url of ["https://u:p@sms.example.com", "https://sms.example.com/x?apikey=1", "https://sms.example.com/#k"]) {
      const r = await setKey(f.s, { url, header: null, apiKey: API_KEY });
      expect(r.statusCode, url).toBe(400);
      expect(r.json().error.fields.url).toBeTruthy();
    }
    for (const url of ["http://127.0.0.1:8080", "http://169.254.169.254", "http://10.1.2.3", "http://[::ffff:127.0.0.1]"]) {
      const r = await setKey(f.s, { url, header: null, apiKey: API_KEY });
      expect(r.statusCode, url).toBe(400);
      expect(r.json().error.code).toBe("HOST_NOT_ALLOWED");
    }
    expect((await setKey(f.s)).statusCode).toBe(200);
    const g1 = (await app.inject({ method: "GET", url: "/api/v1/settings/sms", headers: f.s.headers })).json();
    expect(g1).toMatchObject({ url: null, apiKeySet: true, usable: true, header: "NOKTA" });
    expect(JSON.stringify(g1)).not.toContain(API_KEY);
    // Değişmeyen kayıt → audit yok.
    const n0 = await testDb().auditLog.count({ where: { tenantId: f.tenantId, action: "settings.sms_updated" } });
    expect((await setKey(f.s, { url: null, header: "NOKTA" })).statusCode).toBe(200);
    expect(await testDb().auditLog.count({ where: { tenantId: f.tenantId, action: "settings.sms_updated" } })).toBe(n0);
  });

  it("S-P19-T6: SMSPORTAL_URL değişince GET keyUnreadable:true, gönderim yok, outbox FAILED unconfigured (500 yok); köken değişince anahtar boş → 400", async () => {
    const f = await firm();
    expect((await setKey(f.s)).statusCode).toBe(200);
    const other = await startFakeWhatsapp();
    const app2 = build({ SMSPORTAL_URL: other.url });
    await app2.ready();
    try {
      const s2 = await loginAs(app2, f.admin);
      const g = (await app2.inject({ method: "GET", url: "/api/v1/settings/sms", headers: s2.headers })).json();
      expect(g).toMatchObject({ apiKeySet: true, keyUnreadable: true, usable: false });
      const t = await app2.inject({
        method: "POST",
        url: "/api/v1/settings/sms/test",
        headers: s2.headers,
        payload: { phone: "05321234567" },
      });
      expect(t.statusCode).toBe(200);
      expect(t.json()).toMatchObject({ ok: false, reason: "unconfigured" });
      expect(other.hits).toHaveLength(0);
      const metrics = app2.metrics.render();
      expect(metrics).toMatch(/rs_sms_key_unreadable_total [1-9]/);
      const r = await app2.inject({
        method: "PUT",
        url: "/api/v1/settings/sms",
        headers: s2.headers,
        payload: { url: "https://sms.example.com", header: null },
      });
      expect(r.statusCode).toBe(400);
    } finally {
      await app2.close();
      await other.close();
    }
  });

  it("S-P19-T7: aynı numaraya 4. test SMS → 429; audit settings.sms_test maskeli", async () => {
    const f = await firm();
    expect((await setKey(f.s)).statusCode).toBe(200);
    const codes: number[] = [];
    for (let i = 0; i < 4; i++)
      codes.push(
        (await app.inject({ method: "POST", url: "/api/v1/settings/sms/test", headers: f.s.headers, payload: { phone: "05329990001" } }))
          .statusCode,
      );
    expect(codes).toEqual([200, 200, 200, 429]);
    expect(sms.hits.at(-1)?.body.message).toBe("Nokta Destek test SMS'i");
    const a = await testDb().auditLog.findFirstOrThrow({ where: { tenantId: f.tenantId, action: "settings.sms_test" } });
    expect(a.newValue).toMatchObject({ recipient: "+90******0001", result: "success" });
  });

  it("S-P19-6: check-retire kapsamı SMS anahtarı ve outbox alıcısını sayar", async () => {
    const f = await firm();
    expect((await setKey(f.s)).statusCode).toBe(200);
    const c = await countAllByVersion(testDb(), 1);
    expect(c["tenant_settings.sms_api_key_enc"]).toBeGreaterThan(0);
    expect(Object.keys(c)).toEqual(["session_messages", "tenant_settings.sms_api_key_enc", "notification_outbox.recipient_enc"]);
  });
});

/** Talep + firma kanalları açık; talep kanal bayrakları verilen. */
async function notifyFirm(o: { sms?: boolean; whatsapp?: boolean; email?: boolean } = {}) {
  const f = await firm();
  expect((await setKey(f.s)).statusCode).toBe(200);
  await testDb().tenantRequestSettings.update({
    where: { tenantId: f.tenantId },
    data: { notifySmsEnabled: true, notifyWhatsappEnabled: true, notifyEmailEnabled: true },
  });
  const req = async (flags = o, phone = "+905321234567", createdAt?: Date) => {
    const r = await createRequestRow(f.tenantId, {
      source: "WEB",
      customerEmail: "ad+1@example.test",
      ...(createdAt ? { createdAt, waitMinutes: 10 } : {}),
    });
    clock.t = Math.max(clock.t, Date.now() + 1000); // DB CHECK: kapanış zamanı oluşturmadan önce olamaz
    await testDb().supportRequest.update({
      where: { id: r.id },
      data: {
        notifySms: flags.sms ?? false,
        notifyWhatsapp: flags.whatsapp ?? false,
        notifyEmail: flags.email ?? false,
        customerPhone: phone,
      },
    });
    return r.id;
  };
  return { ...f, req };
}

const reject = (s: Session, id: string) =>
  app.inject({
    method: "POST",
    url: `/api/v1/support-requests/${id}/reject`,
    headers: s.headers,
    payload: { message: "Şu an müsait değiliz" },
  });

const rows = (requestId: string) => testDb().notificationOutbox.findMany({ where: { requestId }, orderBy: { channel: "asc" } });

describe("AC-261 durum bildirimi kuyruğu", () => {
  it("AC-261: ret → seçili kanallar (SMS + WA) gönderilir, seçilmeyen e-posta 0; SENT'te alıcı NULL; audit başarı", async () => {
    const f = await notifyFirm({ sms: true, whatsapp: true });
    const id = await f.req();
    const smsBefore = sms.hits.length;
    expect((await reject(f.s, id)).statusCode).toBe(204);
    expect((await rows(id)).map((r) => [r.channel, r.state])).toEqual([
      ["SMS", "PENDING"],
      ["WHATSAPP", "PENDING"],
    ]);
    await app.outbox.tick();
    const done = await rows(id);
    expect(done.map((r) => [r.channel, r.state, r.recipientEnc])).toEqual([
      ["SMS", "SENT", null],
      ["WHATSAPP", "SENT", null],
    ]);
    expect(sms.hits.slice(smsBefore).some((h) => String(h.body.message).includes("karşılanamadı"))).toBe(true);
    // Şablon ret metnini taşımaz (S-P19-11).
    expect(JSON.stringify(sms.hits.slice(smsBefore))).not.toContain("müsait");
    const audits = await testDb().auditLog.findMany({ where: { tenantId: f.tenantId, action: "request.customer_notify", entityId: id } });
    expect(audits.map((a) => a.result).sort()).toEqual(["success", "success"]);
    expect(app.metrics.render()).toMatch(/rs_notify_outbox_total\{channel="SMS",result="sent"\} \d+/);
  });

  it("AC-261: süre dolumu → bildirim; servis 500 → 3 deneme (0/10/30 sn sahte saat) → FAILED + audit fail ≤ 60 sn", async () => {
    const f = await notifyFirm({ sms: true });
    const id = await f.req({ sms: true }, "+905321234567", new Date(Date.now() - 11 * 60_000));
    await sweepRequests(app.requests, new Date(clock.now()));
    expect((await rows(id))[0]?.kind).toBe("REQ_EXPIRED");
    const t0 = clock.now();
    sms.plan = () => 500;
    try {
      await app.outbox.tick();
      expect((await rows(id))[0]).toMatchObject({ state: "PENDING", attempts: 1, lastReason: "http_error" });
      clock.advance(10_000);
      await app.outbox.tick();
      expect((await rows(id))[0]).toMatchObject({ state: "PENDING", attempts: 2 });
      clock.advance(30_000);
      await app.outbox.tick();
    } finally {
      sms.plan = () => 200;
    }
    expect((await rows(id))[0]).toMatchObject({ state: "FAILED", attempts: 3, lastReason: "http_error", recipientEnc: null });
    expect(clock.now() - t0).toBeLessThanOrEqual(60_000);
    const a = await testDb().auditLog.findFirstOrThrow({
      where: { tenantId: f.tenantId, action: "request.customer_notify", entityId: id },
    });
    expect(a.result).toBe("fail");
    expect(a.newValue).toMatchObject({
      kind: "REQ_EXPIRED",
      channel: "SMS",
      attempts: 3,
      reason: "http_error",
      recipient: "+90******4567",
    });
  });

  it("AC-261: unconfigured (SMTP yok) → hemen FAILED; çökme kurtarma SENDING → PENDING", async () => {
    const f = await notifyFirm({ email: true });
    const id = await f.req();
    expect((await reject(f.s, id)).statusCode).toBe(204);
    await app.outbox.tick();
    expect((await rows(id))[0]).toMatchObject({ channel: "EMAIL", state: "FAILED", attempts: 1, lastReason: "unconfigured" });

    const id2 = await f.req({ sms: true }, "+905321230000");
    expect((await reject(f.s, id2)).statusCode).toBe(204);
    await testDb()
      .$executeRaw`UPDATE notification_outbox SET state = 'SENDING', updated_at = ${new Date(clock.now() - 120_000)} WHERE request_id = ${id2}`;
    expect(await app.outbox.recover(clock.now())).toBeGreaterThanOrEqual(1);
    await app.outbox.tick();
    expect((await rows(id2))[0]).toMatchObject({ state: "SENT" });
  });

  it("S-P19-12: aynı alıcıya firma içi 4. bildirim → FAILED rate_limited (gönderilmez) + audit scope + metrik; outbox failed sayacına girmez", async () => {
    const f = await notifyFirm({ sms: true });
    const phone = "+905327770001";
    const ids: string[] = [];
    for (let i = 0; i < NOTIFY_LIMITS.recipientTenantPerDay + 1; i++) {
      const id = await f.req({ sms: true }, phone);
      expect((await reject(f.s, id)).statusCode).toBe(204);
      ids.push(id);
    }
    const last = (await rows(ids.at(-1) as string))[0];
    expect(last).toMatchObject({ state: "FAILED", lastReason: "rate_limited", attempts: 0, recipientEnc: null });
    const a = await testDb().auditLog.findFirstOrThrow({
      where: { tenantId: f.tenantId, action: "request.customer_notify", entityId: ids.at(-1) },
    });
    expect(a.newValue).toMatchObject({ reason: "rate_limited", scope: "recipient_tenant" });
    expect(app.metrics.render()).toMatch(/rs_notify_rate_limited_total\{scope="recipient_tenant",channel="SMS"\} \d+/);
    // S-P19-T11: e-posta `+` eki aynı alıcı sayılır (hash normalize).
    expect(recipientHash(app.secrets, "EMAIL", "ad+1@example.test")).toBe(recipientHash(app.secrets, "EMAIL", "AD@example.test"));
  });

  it("S-P19-10: 7 gün temizliği SENT/FAILED satırını siler; göstergeler boş kuyrukta da yazılır", async () => {
    const f = await notifyFirm({ sms: true });
    const id = await f.req();
    expect((await reject(f.s, id)).statusCode).toBe(204);
    await app.outbox.tick();
    await testDb()
      .$executeRaw`UPDATE notification_outbox SET updated_at = ${new Date(clock.now() - 8 * 86_400_000)} WHERE request_id = ${id}`;
    expect(await app.outbox.cleanup(clock.now())).toBeGreaterThanOrEqual(1);
    expect(await rows(id)).toHaveLength(0);
    const m = app.metrics.render();
    expect(m).toMatch(/rs_notify_outbox_oldest_pending_seconds \d+/);
    expect(m).toMatch(/rs_notify_tenant_max_hourly\{role="SMS"\} \d+/);
    expect(m).toMatch(/rs_sms_key_unreadable_total \d+/);
  });
});
