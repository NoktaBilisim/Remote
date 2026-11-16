// P28u-K3 politika ucu, dört göz e-postası, müşteri şablonu (mimari-p28u §5.2, §9.2, §9.3; AC-436, 438, 440, 441, 445).
import { newId } from "../../src/lib/ids.ts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectTestSeams } from "../../src/unattended/connect.ts";
import { createUser, loginAs, loginStepUp, markStepUp, testDb } from "../helpers/app.ts";
import { helperGuest, sessionStatus, waitUntil } from "../helpers/unattended-device.ts";
import { code, connectReq, decodeSubject, policyReq, REASON, setup, startSilentLive, type ErrBody } from "../helpers/unattended-silent.ts";
import { SILENT_CONNECT_SUBJECT, SILENT_POLICY_SUBJECT, sendSilentNotice } from "../../src/unattended/mail.ts";
import { outboxContent } from "../../src/notify/outbox-content.ts";
import type { Live } from "../helpers/signal-flow.ts";

let live: Live;
let env: Awaited<ReturnType<typeof startSilentLive>>;
let inbox: { to: string; body: string }[];
beforeAll(async () => {
  env = await startSilentLive();
  ({ live, inbox } = env);
});
afterAll(async () => env.close());
afterEach(() => {
  delete connectTestSeams.afterTx;
});

describe("P28u-K3 politika ucu", () => {
  it("AC-436: aç → ack yoksa 400 fields.ack, step-up yoksa 401; ack+step-up → 200, ack_at/by, audit eski→yeni; aynı değer audit yok", async () => {
    const r = await setup(live);
    const admin = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const s = await loginStepUp(live.app, admin);
    const noAck = await live.app.inject(policyReq(s, { silentEnabled: true }));
    expect(noAck.statusCode).toBe(400);
    expect(Object.keys(noAck.json<ErrBody>().error.fields ?? {})).toEqual(["ack"]);
    await testDb().authSession.updateMany({ where: { userId: admin.id }, data: { stepUpAt: null } });
    expect(code(await live.app.inject(policyReq(s, { silentEnabled: true, ack: true })))).toBe("401 MFA_STEP_UP_REQUIRED");
    await markStepUp(s);
    const on = await live.app.inject(policyReq(s, { silentEnabled: true, ack: true }));
    expect(on.statusCode).toBe(200);
    expect(on.json<{ silentEnabled: boolean; ackByName: string | null }>()).toMatchObject({ silentEnabled: true });
    expect(on.json<{ ackByName: string | null }>().ackByName).toBeTruthy();
    const st = await testDb().tenantSettings.findUniqueOrThrow({ where: { tenantId: r.tenantId } });
    expect(st).toMatchObject({ unattendedSilentEnabled: true, unattendedSilentAckBy: admin.id });
    const auth = await testDb().authSession.findFirstOrThrow({ where: { userId: admin.id }, select: { stepUpAt: true } });
    expect(auth.stepUpAt).not.toBeNull(); // tüketilmedi
    expect((await live.app.inject(policyReq(s, { silentEnabled: true, ack: true }))).statusCode).toBe(200);
    const audits = await testDb().auditLog.findMany({ where: { tenantId: r.tenantId, action: "settings.unattended_silent" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entity: "tenant_settings", entityId: r.tenantId, oldValue: { silentEnabled: false } });
    expect(audits[0]?.newValue).toMatchObject({ silentEnabled: true, ack: true, stepUp: true });
  });

  it("AC-436 AC-440: kapat step-up'sız → 200, ack izi korunur; açık silent oda ≤ 5 sn permission ile biter, PENDING silent iptal", async () => {
    const r = await setup(live, { silentPerm: true, policy: true });
    const admin = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const s = await loginAs(live.app, admin);
    const res = await live.app.inject(connectReq(r, { silent: true, reason: REASON }));
    const msg = (await r.device.waitFor("connect" as never)) as unknown as { sessionId: string; ticket: string };
    expect(res.statusCode).toBe(200);
    const helper = await helperGuest(live, msg.ticket);
    await helper.waitFor("hello");
    const t0 = Date.now();
    const off = await live.app.inject(policyReq(s, { silentEnabled: false }));
    expect(off.statusCode).toBe(200);
    expect(off.json<{ ackAt: string | null }>().ackAt).not.toBeNull();
    expect((await helper.waitFor("session.ended")).reason).toBe("permission");
    expect(Date.now() - t0).toBeLessThan(5_000);
    await waitUntil(async () => (await sessionStatus(msg.sessionId)).status === "ENDED");
  });

  it("AC-436: yetki — settings.edit yok 403; GET manage∧settings.view", async () => {
    const r = await setup(live);
    const u = await createUser({ tenantId: r.tenantId, role: "USER", perms: { "unattended.manage": true, "settings.view": true } });
    const s = await loginStepUp(live.app, u);
    expect((await live.app.inject({ method: "GET", url: "/api/v1/unattended/policy", headers: s.headers })).statusCode).toBe(200);
    expect((await live.app.inject(policyReq(s, { silentEnabled: true, ack: true }))).statusCode).toBe(403);
    expect((await live.app.inject({ method: "GET", url: "/api/v1/unattended/policy", headers: r.s.headers })).statusCode).toBe(403);
  });
});

describe("P28u-K3 dört göz e-postası", () => {
  const bodiesTo = (addr: string) => inbox.filter((m) => m.to.includes(addr)).map((m) => m.body);

  it("AC-441 AC-445: silent bağlantı → diğer manage sahiplerine; konu sabit, gerekçe gövdede kaçışlı; notify audit maskeli", async () => {
    const r = await setup(live, { silentPerm: true, policy: true });
    const mgr = await createUser({ tenantId: r.tenantId, role: "USER", perms: { "unattended.manage": true } });
    const reason = '<b>acil</b> & sunucu "kapalı" — müdahale';
    const res = await live.app.inject(connectReq(r, { silent: true, reason }));
    expect(res.statusCode).toBe(200);
    await waitUntil(async () => bodiesTo(mgr.email).length > 0);
    const body = bodiesTo(mgr.email)[0] ?? "";
    expect(body).toContain(`Subject: =?UTF-8?`); // RFC 2047 — sabit konu aşağıda çözülerek denetlenir
    expect(decodeSubject(body)).toBe(SILENT_CONNECT_SUBJECT);
    const html = body.replace(/=\r?\n/g, "").split("text/html")[1] ?? "";
    expect(html).toContain("&#60;b&#62;acil&#60;/b&#62;"); // HTML sürümünde kaçışlı; düz metin sürümü olduğu gibi
    expect(html).not.toContain("<b>acil</b>");
    expect(bodiesTo(r.tech.email)).toHaveLength(0);
    const { sessionId } = res.json<{ sessionId: string }>();
    await waitUntil(
      async () => (await testDb().auditLog.count({ where: { entityId: sessionId, action: "unattended.silent.notify" } })) > 0,
    );
    const n = await testDb().auditLog.findFirstOrThrow({ where: { entityId: sessionId, action: "unattended.silent.notify" } });
    expect(n.newValue).toMatchObject({ event: "connect", result: "success", attempt: 1 });
    expect(JSON.stringify(n.newValue)).not.toContain(mgr.email);
  });

  it("AC-436 AC-441: başka manage sahibi yoksa → değiştiren + Admin'ler; politika e-postası konusu sabit", async () => {
    const r = await setup(live);
    const admin = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const admin2 = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    await testDb().userPermission.create({ data: { userId: admin2.id, permKey: "unattended.manage", granted: false } });
    const s = await loginStepUp(live.app, admin);
    expect((await live.app.inject(policyReq(s, { silentEnabled: true, ack: true }))).statusCode).toBe(200);
    await waitUntil(async () => bodiesTo(admin.email).length > 0 && bodiesTo(admin2.email).length > 0);
    expect(decodeSubject(bodiesTo(admin2.email)[0] ?? "")).toBe(SILENT_POLICY_SUBJECT);
    expect(bodiesTo(r.tech.email)).toHaveLength(0);
  });

  it("AC-441: 3 deneme (0/10/30 sn), hepsi başarısız → her deneme audit + fail metrik; hata fırlatmaz", async () => {
    const r = await setup(live);
    const mgr = await createUser({ tenantId: r.tenantId, role: "USER", perms: { "unattended.manage": true } });
    const eid = newId();
    const sleeps: number[] = [];
    const inc: Record<string, string>[] = [];
    let calls = 0;
    const out = await sendSilentNotice(
      {
        db: testDb(),
        mail: { sendForTenant: async () => ((calls += 1), { ok: false, reason: "connect" }) } as never,
        metrics: { inc: (_n, l) => inc.push(l ?? {}) },
        log: { error: () => undefined },
        sleep: async (ms) => void sleeps.push(ms),
      },
      {
        ctx: { ip: "127.0.0.1", userAgent: "t", requestId: "r" },
        tenantId: r.tenantId,
        actor: { userId: r.tech.id, email: r.tech.email },
        event: "connect",
        entity: "support_sessions",
        entityId: eid,
        content: { subject: SILENT_CONNECT_SUBJECT, text: "x", bodyHtml: "<p>x</p>" },
      },
    );
    const n = out.failed; // diğer manage sahipleri (mgr + firmanın kurucu Admin'i)
    expect(n).toBeGreaterThanOrEqual(1);
    expect(out.sent).toBe(0);
    expect(calls).toBe(3 * n);
    expect([...new Set(sleeps)].sort((x, y) => x - y)).toEqual([10_000, 30_000]);
    expect(inc).toEqual(Array.from({ length: n }, () => ({ result: "fail" })));
    const rows = await testDb().auditLog.findMany({
      where: { entityId: eid, action: "unattended.silent.notify" },
      orderBy: { id: "asc" },
    });
    expect(rows.map((a) => (a.newValue as { attempt: number; result: string }).attempt).sort()).toEqual(
      Array.from({ length: n }, () => [1, 2, 3])
        .flat()
        .sort(),
    );
    expect(rows.every((a) => a.result === "fail")).toBe(true);
    expect(mgr.email).toBeTruthy();
  });
});

describe("P28u-K3 müşteri şablonu", () => {
  it("AC-438: UNATTENDED_STARTED silent oturumda 'İzin istenmeden bağlanıldı.' satırı; gerekçe yok; ask'ta yok", async () => {
    const r = await setup(live, { silentPerm: true, policy: true });
    const res = await live.app.inject(connectReq(r, { silent: true, reason: REASON }));
    const { sessionId } = res.json<{ sessionId: string }>();
    const ref = {
      tenantId: r.tenantId,
      requestId: null,
      eventId: null,
      kind: "UNATTENDED_STARTED",
      createdAt: new Date(),
      firm: "Firma",
      requestCode: null,
    };
    const silent = await outboxContent(testDb(), { ...ref, sessionId });
    expect(silent?.text).toContain("İzin istenmeden bağlanıldı.");
    expect(silent?.mail.text).toContain("İzin istenmeden bağlanıldı.");
    expect(`${silent?.text}${silent?.mail.text}${silent?.mail.bodyHtml}`).not.toContain("Müşteri sunucusu");
    const r2 = await setup(live);
    const res2 = await live.app.inject(connectReq(r2));
    const ask = await outboxContent(testDb(), { ...ref, tenantId: r2.tenantId, sessionId: res2.json<{ sessionId: string }>().sessionId });
    expect(ask?.text).not.toContain("İzin istenmeden");
  });
});
