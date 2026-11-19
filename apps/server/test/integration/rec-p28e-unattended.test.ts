// P28e düzeltme turu 1 (QA-P28e-2/3): gözetimsiz politika kaydı GERÇEK bağlantı zincirinden (`POST /unattended/devices/:id/connect`
// → cihaz `connect` → yardımcı admit → `admit-device` TX'i `startPolicy`) r3 tek kipte (no_user) × politika kapalı/açık
// (AC-387, AC-448), eski cihazda `recordOutdated` + `device_outdated`; ana anahtar kapanınca gözetimsiz anahtar kapanır, ACTIVE
// politika kaydı `POLICY_OFF` ile durur, audit eski→yeni ve `recording_policy` dört göz e-postası iki yön (AC-447, S-P28e-4).
import { RECORDING_AUDIT, RECORDING_SETTINGS_AUDIT, UNATTENDED_AUDIT } from "@remote/contracts/audit";
import { DEVICE_CAP_DIRECT, WS_DEVICE_CAP_CONSENT, WS_DEVICE_SUBPROTOCOL } from "@remote/contracts/ws-device";
import { REC_CONSENT_LINE_SHA256, WS_CAP_REC, WS_DEVICE_CAP_RECORD } from "@remote/contracts/ws-rec";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECORDING_POLICY_SUBJECT } from "../../src/unattended/mail.ts";
import { createUser, loginStepUp, ORIGIN, testDb, type Session } from "../helpers/app.ts";
import type { Live } from "../helpers/signal-flow.ts";
import { authMsg, connectReq, ready, waitUntil, type ConnectMsg, type Ready } from "../helpers/unattended-device.ts";
import { decodeSubject, startMailLive } from "../helpers/unattended-mail.ts";
import { connect, techHeaders, type WsClient } from "../helpers/ws.ts";

let live: Live;
let env: Awaited<ReturnType<typeof startMailLive>>;
let inbox: { to: string; body: string }[];
beforeAll(async () => {
  env = await startMailLive();
  ({ live, inbox } = env);
  live.app.rec.service.d.store.freeRatioOverride = 0.5; // disk %10 kuralı test makinesinin doluluğuna bağlı olmasın
});
afterAll(async () => env.close());

type Mode = "no_user";
type Msg = Record<string, unknown> & { t: string };

/** Servis soketi: `consent1` + `direct1` (r3) + (yeni sürümde) `record1`. */
async function device(r: Ready, record: boolean): Promise<WsClient> {
  const protos = [WS_DEVICE_SUBPROTOCOL, WS_DEVICE_CAP_CONSENT, DEVICE_CAP_DIRECT, ...(record ? [WS_DEVICE_CAP_RECORD] : [])];
  const c = await connect(`${live.base}/ws/device`, protos);
  const hello = (await c.waitFor("device.hello" as never)) as unknown as { nonce: string };
  c.send(authMsg(r.dev, hello.nonce));
  await c.waitFor("device.ready" as never);
  return c;
}

/** Firma + cihaz; `policy` → `recording_enabled ∧ unattended_recording_enabled`. */
async function fixture(_mode: Mode, o: { policy: boolean; record?: boolean }): Promise<Ready> {
  const r = await ready(live, { online: false });
  await testDb().tenantSettings.update({
    where: { tenantId: r.tenantId },
    data: {
      recordingEnabled: true,
      unattendedRecordingEnabled: o.policy,
      ...(o.policy ? { unattendedRecordingAckAt: new Date(), unattendedRecordingAckBy: r.tech.id } : {}),
    },
  });
  return { ...r, device: await device(r, o.record ?? true) };
}

/** Bağlan → cihaz `connect` → teknisyen konsolu → kip sonucu → yardımcı (rec1 bildirir) admit. */
async function open(r: Ready, mode: Mode) {
  const res = await live.app.inject(connectReq(r));
  expect(res.statusCode).toBe(200);
  const msg = (await r.device.waitFor("connect" as never)) as unknown as ConnectMsg & { recording?: boolean };
  const tech = await connect(`${live.base}/ws/tech?sessionId=${msg.sessionId}`, ["rs.v1"], techHeaders(r.s.token, ORIGIN));
  await tech.waitFor("hello");
  if (mode === "no_user") r.device.send({ t: "consent.result", sessionId: msg.sessionId, mode: "no_user" });
  const helper = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${msg.ticket}`, WS_CAP_REC]);
  await helper.waitFor("hello");
  await waitUntil(async () => (await testDb().supportSession.findUniqueOrThrow({ where: { id: msg.sessionId } })).status === "ACTIVE");
  return { sessionId: msg.sessionId, msg, tech, helper };
}

const recs = (sessionId: string) => testDb().sessionRecording.findMany({ where: { sessionId } });
const startAudits = (sessionId: string) => testDb().auditLog.findMany({ where: { entityId: sessionId, action: RECORDING_AUDIT.START } });
const has = (c: WsClient, t: string) => (c.msgs as unknown as Msg[]).some((m) => m.t === t);

describe("AC-387 / AC-448 gözetimsiz politika kaydı — gerçek connect → admit-device zinciri", () => {
  for (const mode of ["no_user"] as const) {
    it(`AC-387 politika kapalı (${mode}): kayıt satırı yok, connect.recording yok, rıza mesajı yok sayılır, cihaza rec.state yok`, async () => {
      const r = await fixture(mode, { policy: false });
      const { sessionId, msg, tech, helper } = await open(r, mode);
      expect(msg.recording).toBeUndefined();
      helper.send({ t: "rec.consent", lineSha256: REC_CONSENT_LINE_SHA256 });
      await new Promise((res) => setTimeout(res, 300));
      expect(await recs(sessionId)).toEqual([]);
      expect(await startAudits(sessionId)).toEqual([]);
      expect(has(r.device, "rec.state")).toBe(false);
      expect(has(tech, "rec.state")).toBe(false);
      expect(await testDb().sessionConsent.count({ where: { sessionId, level: "RECORDING" } })).toBe(0);
      for (const c of [tech, helper, r.device]) c.ws.close();
    });

    it(`AC-448 politika açık (${mode}): admit TX'inde ACTIVE TENANT_POLICY, audit basis=tenant_policy + consentMode, cihaza connect.recording + rec.state, teknisyene rec.state{on, tenant_policy}`, async () => {
      const r = await fixture(mode, { policy: true });
      const { sessionId, msg, tech, helper } = await open(r, mode);
      expect(msg.recording).toBe(true);
      const [row] = await recs(sessionId);
      expect(row).toMatchObject({ basis: "TENANT_POLICY", state: "ACTIVE", recorderUserId: r.tech.id });
      const [audit] = await startAudits(sessionId);
      expect(audit).toMatchObject({ result: "success" });
      expect(audit?.newValue).toMatchObject({ recordingId: row?.id, basis: "tenant_policy", consentMode: mode });
      expect(await r.device.waitFor("rec.state" as never)).toMatchObject({ on: true });
      expect(await tech.waitFor("rec.state")).toMatchObject({ on: true, rid: row?.id, basis: "tenant_policy" });
      expect(await testDb().sessionConsent.count({ where: { sessionId, level: "RECORDING" } })).toBe(0);
      for (const c of [tech, helper, r.device]) c.ws.close();
    });
  }

  it("AC-448 politika açık ama cihaz eski (record1 yok): kayıt yok, connect.recording yok, hello.unattended.recordOutdated, audit fail device_outdated", async () => {
    const r = await fixture("no_user", { policy: true, record: false });
    const { sessionId, msg, tech, helper } = await open(r, "no_user");
    expect(msg.recording).toBeUndefined();
    expect(await recs(sessionId)).toEqual([]);
    const [fail] = await startAudits(sessionId);
    expect(fail).toMatchObject({ result: "fail" });
    expect(fail?.newValue).toMatchObject({ basis: "tenant_policy", reason: "device_outdated" });
    const again = await connect(`${live.base}/ws/tech?sessionId=${sessionId}`, ["rs.v1"], techHeaders(r.s.token, ORIGIN));
    const hello = (await again.waitFor("hello")) as unknown as { unattended?: { recordOutdated?: boolean } };
    expect(hello.unattended?.recordOutdated).toBe(true);
    for (const c of [tech, helper, r.device, again]) c.ws.close();
  });
});

describe("AC-447 ana anahtar ↔ gözetimsiz anahtar, audit, recording_policy dört göz e-postası (S-P28e-4)", () => {
  const putRec = (s: Session, payload: object) =>
    live.app.inject({ method: "PUT", url: "/api/v1/settings/recording", headers: s.headers, payload });
  const getRec = async (s: Session) =>
    (await live.app.inject({ method: "GET", url: "/api/v1/settings/recording", headers: s.headers })).json<{
      enabled: boolean;
      unattendedEnabled: boolean;
      soleManager: boolean;
    }>();
  const to = (addr: string) => inbox.filter((m) => m.to.includes(addr)).map((m) => decodeSubject(m.body));
  const notifies = (tenantId: string) =>
    testDb().auditLog.findMany({ where: { tenantId, action: UNATTENDED_AUDIT.SILENT_NOTIFY }, orderBy: { id: "asc" } });

  it("AC-447 ana anahtar kapanınca gözetimsiz kapanır, ACTIVE TENANT_POLICY kayıt POLICY_OFF; audit eski→yeni; e-posta iki yön diğer yöneticiye", async () => {
    const r = await fixture("no_user", { policy: false });
    const a = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const b = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const s = await loginStepUp(live.app, a);
    expect((await getRec(s)).soleManager).toBe(false);
    const on = await putRec(s, { enabled: true, retentionDays: 30, unattendedEnabled: true, employeeNoticeAck: true });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toMatchObject({ enabled: true, unattendedEnabled: true });
    await waitUntil(async () => to(b.email).length >= 1);
    expect(to(b.email)).toEqual([RECORDING_POLICY_SUBJECT]);
    expect(to(r.tech.email)).toEqual([]);

    const { sessionId, tech, helper } = await open(r, "no_user");
    const [row] = await recs(sessionId);
    expect(row).toMatchObject({ basis: "TENANT_POLICY", state: "ACTIVE" });
    await r.device.waitFor("rec.state" as never);
    expect(await tech.waitFor("rec.state")).toMatchObject({ on: true, basis: "tenant_policy" });

    const off = await putRec(s, { enabled: false, retentionDays: 30, unattendedEnabled: false });
    expect(off.statusCode).toBe(200);
    expect(await getRec(s)).toMatchObject({ enabled: false, unattendedEnabled: false });
    expect(await testDb().sessionRecording.findUniqueOrThrow({ where: { id: row?.id ?? "" } })).toMatchObject({
      state: "STOPPED",
      stopReason: "POLICY_OFF",
    });
    expect(await r.device.waitFor("rec.state" as never)).toMatchObject({ on: false });
    expect(await tech.waitFor("rec.state")).toMatchObject({ on: false, reason: "policy_off" });
    const audits = await testDb().auditLog.findMany({
      where: { tenantId: r.tenantId, action: RECORDING_SETTINGS_AUDIT },
      orderBy: { id: "asc" },
    });
    expect(audits.map((x) => [x.oldValue, x.newValue])).toEqual([
      [
        { enabled: true, retentionDays: 30, unattendedEnabled: false },
        expect.objectContaining({ enabled: true, unattendedEnabled: true, employeeNoticeAck: true, stepUp: true }),
      ],
      [
        { enabled: true, retentionDays: 30, unattendedEnabled: true },
        { enabled: false, retentionDays: 30, unattendedEnabled: false },
      ],
    ]);
    await waitUntil(async () => to(b.email).length >= 2);
    expect(to(b.email)).toEqual([RECORDING_POLICY_SUBJECT, RECORDING_POLICY_SUBJECT]);
    expect(to(a.email)).toEqual([]);
    await waitUntil(async () => (await notifies(r.tenantId)).length >= 2); // audit gönderimden sonra yazılır
    const n = await notifies(r.tenantId);
    expect(n.map((x) => x.newValue)).toEqual([
      expect.objectContaining({ event: "recording_policy", result: "success", attempt: 1 }),
      expect.objectContaining({ event: "recording_policy", result: "success", attempt: 1 }),
    ]);
    expect(JSON.stringify(n.map((x) => x.newValue))).not.toContain(b.email);
    for (const c of [tech, helper, r.device]) c.ws.close();
  });

  it("AC-447 tek yönetici: soleManager=true, e-posta yalnız değiştirene (§9.2/§11.5 yedek alıcı); gözetimsiz değişmezse e-posta yok", async () => {
    const r = await fixture("no_user", { policy: false });
    const a = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const s = await loginStepUp(live.app, a);
    expect((await getRec(s)).soleManager).toBe(true);
    expect((await putRec(s, { enabled: true, retentionDays: 30, unattendedEnabled: true, employeeNoticeAck: true })).statusCode).toBe(200);
    await waitUntil(async () => to(a.email).length >= 1 && (await notifies(r.tenantId)).length >= 1);
    expect(to(a.email)).toEqual([RECORDING_POLICY_SUBJECT]);
    expect(to(r.tech.email)).toEqual([]);
    // gözetimsiz değişmeyen ayar değişikliği (saklama) e-posta üretmez
    expect((await putRec(s, { enabled: true, retentionDays: 20, unattendedEnabled: true })).statusCode).toBe(200);
    await new Promise((res) => setTimeout(res, 300));
    expect(to(a.email)).toHaveLength(1);
    expect(await notifies(r.tenantId)).toHaveLength(1);
    r.device.ws.close();
  });
});
