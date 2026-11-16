// P28u-K4 cihaz mesajları, onay, kip, kesme ve görünümler (mimari-p28u §5.4, §6, §8.1, §8.2, §8.4, §9.1; AC-429, 431–433, 435,
// 439, 440, 445, 446). Gerçek dinleyen sunucu + Ed25519 sahte servis + sahte yardımcı; izinsiz oturum K3 ucundan bağımsız kurulur.
import { WS_DEVICE_SUBPROTOCOL } from "@remote/contracts/ws-device";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createUser, loginAs, testDb } from "../helpers/app.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { UNSIGNED_ENV } from "../helpers/unattended.ts";
import { helperGuest, sessionStatus, waitUntil } from "../helpers/unattended-device.ts";
import {
  askConnect,
  auditsOf,
  grantControl,
  helperIn,
  readyK4,
  REASON,
  setPolicy,
  silentPending,
  techConsole,
} from "../helpers/unattended-k4.ts";
import { FakeClock, type WsClient } from "../helpers/ws.ts";

let live: Live;
let faked: Live;
const clock = new FakeClock();
beforeAll(async () => {
  live = await startLive({ env: { ...UNSIGNED_ENV } });
  faked = await startLive({ env: { ...UNSIGNED_ENV }, signaling: { clock, revalidateMs: 60_000 } });
});
afterAll(async () => {
  await Promise.all([live, faked].map((l) => l.close()));
});

const metric = (l: Live, series: string): number => {
  const line = l.app.metrics
    .render()
    .split("\n")
    .find((x) => x.startsWith(`${series} `));
  return line ? Number(line.split(" ").pop()) : 0;
};
const listItem = async (r: Awaited<ReturnType<typeof readyK4>>, s = r.s) =>
  (await live.app.inject({ method: "GET", url: "/api/v1/unattended/devices?state=all", headers: s.headers }))
    .json<{ items: { id: string; userState?: string | null; connectBlockedReason: string | null }[] }>()
    .items.find((i) => i.id === r.dev.id);
const flush = () => new Promise((res) => setTimeout(res, 150));

describe("P28u-K4 yetenek ve kullanıcı durumu", () => {
  it("AC-435 §6.1: belirteçli sokete device.ready ardından device.features{consent1}; eski sokete gitmez ve P28u mesajı 1008", async () => {
    const r = await readyK4(live);
    expect(await r.device.waitFor("device.features" as never)).toEqual({ t: "device.features", caps: ["consent1"] });
    const old = await readyK4(live, { legacy: true });
    await flush();
    expect(old.device.msgs.some((m) => m.t === ("device.features" as never))).toBe(false);
    expect((await listItem(old))?.connectBlockedReason).toBe("outdated");
    old.device.send({ t: "device.user", state: "active" });
    expect((await old.device.closed).code).toBe(1008);
    expect(WS_DEVICE_SUBPROTOCOL).toBe("rs.device.v1");
  });

  it("AC-429 D-P28u-6: device.user → liste userState (≤ 10 sn); grant'sız manage görmez; audit ve CSV'de userState yok", async () => {
    const r = await readyK4(live);
    expect((await listItem(r))?.userState).toBeNull();
    r.device.send({ t: "device.user", state: "locked" });
    await waitUntil(async () => (await listItem(r))?.userState === "locked");
    r.device.send({ t: "device.user", state: "active" });
    await waitUntil(async () => (await listItem(r))?.userState === "active");
    const admin = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const as = await loginAs(live.app, admin);
    const adminView = await listItem(r, as);
    expect(adminView).toBeDefined();
    expect(adminView?.userState).toBeNull();
    const rows = await testDb().auditLog.findMany({ where: { tenantId: r.tenantId }, select: { action: true, newValue: true } });
    expect(JSON.stringify(rows)).not.toMatch(/userState|"locked"/);
    const csv = await live.app.inject({ method: "GET", url: "/api/v1/audit/export.csv", headers: as.headers });
    expect(csv.body).not.toMatch(/userState/);
  });
});

describe("P28u-K4 izinli bağlantı (ask) — onay sonucu", () => {
  it("AC-431 AC-445: asked+granted → ACTIVE, consent_mode=asked, audit unattended.consent (aktör cihaz) + started.consentMode, hello kip", async () => {
    const r = await readyK4(live);
    const msg = await askConnect(live, r);
    r.device.send({ t: "consent.result", sessionId: msg.sessionId, mode: "asked", decision: "granted", ms: 4200 });
    const helper = await helperIn(live, msg.ticket);
    expect(helper).toBeDefined();
    const row = await testDb().supportSession.findUniqueOrThrow({ where: { id: msg.sessionId } });
    expect(row).toMatchObject({ status: "ACTIVE", consentMode: "asked" });
    const [consent] = await auditsOf(msg.sessionId, "unattended.consent");
    expect(consent).toMatchObject({ userId: null, username: `device:${r.dev.id}`, result: "success" });
    expect(consent?.newValue).toMatchObject({ consentMode: "asked", decision: "granted", ms: 4200, deviceId: r.dev.id });
    expect((await auditsOf(msg.sessionId, "unattended.session.started"))[0]?.newValue).toMatchObject({ consentMode: "asked" });
    const { hello } = await techConsole(live, r, msg.sessionId);
    expect(hello.unattended).toMatchObject({ consentMode: "asked", intervene: true });
    // Oturum başına tek: ikinci sonuç yok sayılır + metrik
    const before = metric(live, 'rs_unattended_device_msg_rejected_total{t="consent.result"}');
    r.device.send({ t: "consent.result", sessionId: msg.sessionId, mode: "no_user" });
    await waitUntil(async () => metric(live, 'rs_unattended_device_msg_rejected_total{t="consent.result"}') === before + 1);
  });

  it("AC-432: denied → connect.result{consent_denied} → CANCELLED(consent_denied), konsol nedeni aynı; step-up tüketilmiş (yeni connect 401)", async () => {
    const r = await readyK4(live);
    const msg = await askConnect(live, r);
    const { ws, hello } = await techConsole(live, r, msg.sessionId);
    expect((hello.unattended as { consentMode?: string }).consentMode).toBeUndefined();
    r.device.send({ t: "consent.result", sessionId: msg.sessionId, mode: "asked", decision: "denied", ms: 1800 });
    // K7 devri: karar sonrası konsola güncel hello (kip)
    expect(((await ws.waitFor("hello")) as unknown as { unattended: { consentMode: string } }).unattended.consentMode).toBe("asked");
    r.device.send({ t: "connect.result", sessionId: msg.sessionId, ok: false, reason: "consent_denied" });
    expect((await ws.waitFor("session.ended")).reason).toBe("consent_denied");
    expect(await sessionStatus(msg.sessionId)).toMatchObject({ status: "CANCELLED", endReason: "consent_denied" });
    await waitUntil(async () => (await auditsOf(msg.sessionId, "unattended.consent")).length === 1);
    expect((await auditsOf(msg.sessionId, "unattended.consent"))[0]).toMatchObject({ result: "fail" });
    const auth = await testDb().authSession.findMany({ where: { userId: r.tech.id }, select: { stepUpAt: true } });
    expect(auth.every((a) => a.stepUpAt === null)).toBe(true);
  });

  it("AC-432: timeout → consent_timeout; protocol (D-P28u-5) → CANCELLED(protocol), konsola device_timeout", async () => {
    const r = await readyK4(live);
    const msg = await askConnect(live, r);
    const { ws } = await techConsole(live, r, msg.sessionId);
    r.device.send({ t: "connect.result", sessionId: msg.sessionId, ok: false, reason: "consent_timeout" });
    expect((await ws.waitFor("session.ended")).reason).toBe("consent_timeout");
    const p = await readyK4(live);
    const m2 = await askConnect(live, p);
    const t2 = await techConsole(live, p, m2.sessionId);
    p.device.send({ t: "connect.result", sessionId: m2.sessionId, ok: false, reason: "protocol" });
    expect((await t2.ws.waitFor("session.ended")).reason).toBe("device_timeout");
    expect(await sessionStatus(m2.sessionId)).toMatchObject({ status: "CANCELLED", endReason: "protocol" });
  });

  it("AC-433: no_user → admit, onay satırı yok, consent_mode=no_user", async () => {
    const r = await readyK4(live);
    const msg = await askConnect(live, r);
    r.device.send({ t: "consent.result", sessionId: msg.sessionId, mode: "no_user" });
    await helperIn(live, msg.ticket);
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: msg.sessionId } })).consentMode).toBe("no_user");
    expect(await auditsOf(msg.sessionId, "unattended.consent")).toEqual([]);
  });

  it("K-P28u-3: onay sonucu olmadan gelen yardımcı (3 sn) → CANCELLED(consent_missing); başka cihazın consent.result'u yok sayılır", async () => {
    const r = await readyK4(live);
    const other = await readyK4(live);
    const msg = await askConnect(live, r);
    other.device.send({ t: "consent.result", sessionId: msg.sessionId, mode: "no_user" });
    const helper = await helperGuest(live, msg.ticket);
    expect((await helper.waitFor("session.ended", 8000)).reason).toBe("consent_missing");
    await waitUntil(async () => (await sessionStatus(msg.sessionId)).status !== "PENDING");
    expect(await sessionStatus(msg.sessionId)).toMatchObject({ status: "CANCELLED", endReason: "consent_missing" });
  });
});

describe("P28u-K4 izinsiz oturum: kip, toggle, dosya kapısı, kesme", () => {
  it("AC-439 K-P28u-9: silent izleme kipinde file.meta → FORBIDDEN; Müdahale et → control_toggle on/off audit (consentMode)", async () => {
    const r = await readyK4(live);
    const { sessionId, ticket } = await silentPending(live, r);
    const helper = await helperIn(live, ticket);
    const { ws, hello } = await techConsole(live, r, sessionId);
    expect(hello.unattended).toMatchObject({ consentMode: "silent", intervene: true });
    ws.send({
      t: "file.meta",
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      direction: "TO_CUSTOMER",
      fileName: "a.txt",
      sizeBytes: 10,
      sha256: "ab".repeat(32),
      result: "OK",
    });
    expect((await ws.waitFor("error")).code).toBe("FORBIDDEN");
    await grantControl(ws, helper);
    // Audit yazımı GRANTED bildiriminden sonra tamamlanır; bırakmadan önce "on" satırını bekle (CI sıra yarışı).
    await waitUntil(async () => (await auditsOf(sessionId, "unattended.control_toggle")).length === 1);
    ws.send({ t: "control.release" });
    await waitUntil(async () => (await auditsOf(sessionId, "unattended.control_toggle")).length === 2);
    const rows = await auditsOf(sessionId, "unattended.control_toggle");
    expect(rows.map((a) => a.newValue)).toEqual([
      { from: "view", to: "control", consentMode: "silent" },
      { from: "control", to: "view", consentMode: "silent" },
    ]);
    expect((await auditsOf(sessionId, "unattended.session.started"))[0]?.newValue).toMatchObject({ consentMode: "silent" });
  });

  it("K-P28u-16: gözetimsiz odada kontrol isteği AC-116 sayacına takılmaz (6. istek de iletilir)", async () => {
    const r = await readyK4(live);
    const { sessionId, ticket } = await silentPending(live, r);
    const helper = await helperIn(live, ticket);
    const { ws } = await techConsole(live, r, sessionId);
    for (let i = 0; i < 6; i++) {
      await grantControl(ws, helper);
      ws.send({ t: "control.release" });
      await helper.waitFor("control.release");
    }
    expect(ws.msgs.some((m) => m.t === "error")).toBe(false);
  });

  it("AC-440 O-P28u-2: politika kapalıyken silent admit → permission (CANCELLED) + started{result:fail, failReason}", async () => {
    const r = await readyK4(live);
    const { sessionId, ticket } = await silentPending(live, r);
    await setPolicy(r.tenantId, false, r.tech.id);
    const helper = await helperGuest(live, ticket);
    expect((await helper.waitFor("session.ended")).reason).toBe("permission");
    await waitUntil(async () => (await sessionStatus(sessionId)).status !== "PENDING");
    expect(await sessionStatus(sessionId)).toMatchObject({ status: "CANCELLED", endReason: "permission" });
    expect((await auditsOf(sessionId, "unattended.session.started"))[0]).toMatchObject({
      result: "fail",
      newValue: expect.objectContaining({ failReason: "permission" }),
    });
  });

  it("AC-440 yarış: commit sonrası, admit öncesi PENDING satır iptal edilirse (finishSilent) oturum açılmaz", async () => {
    const r = await readyK4(live);
    const { sessionId, ticket } = await silentPending(live, r);
    await testDb().supportSession.update({
      where: { id: sessionId },
      data: { status: "CANCELLED", endedAt: new Date(), endReason: "permission" },
    });
    const helper = await helperGuest(live, ticket);
    await helper.closed;
    expect((await sessionStatus(sessionId)).status).toBe("CANCELLED");
  });

  it("AC-440: unattended.silent geri alınınca (applyPermChange) silent oda permission ile biter; ask odası sürer", async () => {
    const r = await readyK4(live);
    const { sessionId, ticket } = await silentPending(live, r);
    const helper = await helperIn(live, ticket);
    await live.app.rooms.applyPermChange(r.tech.id, ["unattended.connect", "remote_control.use"]);
    expect((await helper.waitFor("session.ended")).reason).toBe("permission");
    expect(await sessionStatus(sessionId)).toMatchObject({ status: "ENDED", endReason: "permission" });
  });

  it("AC-440 yedek yol (sahte saat): finishSilent atlansa da politika kapalı → ≤ 60 sn'de permission", async () => {
    const r = await readyK4(faked);
    const { sessionId, ticket } = await silentPending(faked, r);
    const helper = await helperIn(faked, ticket);
    await setPolicy(r.tenantId, false, r.tech.id);
    clock.advance(60_000);
    expect((await helper.waitFor("session.ended")).reason).toBe("permission");
    await waitUntil(async () => (await sessionStatus(sessionId)).status === "ENDED");
  });
});

describe("P28u-K4 geçmiş ve audit görünümleri", () => {
  async function silentEnded(): Promise<{ r: Awaited<ReturnType<typeof readyK4>>; sessionId: string; helper: WsClient }> {
    const r = await readyK4(live);
    const { sessionId, ticket } = await silentPending(live, r);
    const helper = await helperIn(live, ticket);
    return { r, sessionId, helper };
  }

  it("AC-445 AC-446: geçmiş liste consentMode + filtre; detay unattended{consentMode, silentReason, timeline}; başka tenant 404", async () => {
    const { r, sessionId } = await silentEnded();
    const list = await live.app.inject({ method: "GET", url: "/api/v1/sessions?consentMode=silent", headers: r.s.headers });
    expect(list.statusCode).toBe(200);
    const items = list.json<{ items: { id: string; consentMode: string | null }[] }>().items;
    expect(items.find((i) => i.id === sessionId)?.consentMode).toBe("silent");
    const none = await live.app.inject({ method: "GET", url: "/api/v1/sessions?consentMode=asked", headers: r.s.headers });
    expect(none.json<{ items: { id: string }[] }>().items.some((i) => i.id === sessionId)).toBe(false);
    const det = await live.app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/history`, headers: r.s.headers });
    expect(det.json<{ unattended: unknown }>().unattended).toEqual({ consentMode: "silent", silentReason: REASON, timeline: [] });
    const other = await createTenant();
    const stranger = await createUser({ tenantId: other.id, role: "ADMIN" });
    const so = await loginAs(live.app, stranger);
    expect((await live.app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/history`, headers: so.headers })).statusCode).toBe(
      404,
    );
  });

  it("AC-445: audit consentMode filtresi kipe göre süzer; oturum audit satırlarında çıplak reason yok, ended'de consentMode", async () => {
    const { r, sessionId } = await silentEnded();
    const admin = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const as = await loginAs(live.app, admin);
    await live.app.rooms.applyPermChange(r.tech.id, ["unattended.connect"]);
    await waitUntil(async () => (await auditsOf(sessionId, "unattended.session.ended")).length === 1);
    const res = await live.app.inject({ method: "GET", url: "/api/v1/audit?consentMode=silent", headers: as.headers });
    expect(res.statusCode).toBe(200);
    const actions = res.json<{ items: { action: string; entityId: string | null }[] }>().items.filter((i) => i.entityId === sessionId);
    expect(actions.map((a) => a.action).sort()).toEqual(["unattended.session.ended", "unattended.session.started"]);
    const asked = await live.app.inject({ method: "GET", url: "/api/v1/audit?consentMode=asked", headers: as.headers });
    expect(asked.json<{ items: { entityId: string | null }[] }>().items.some((i) => i.entityId === sessionId)).toBe(false);
    const rows = await testDb().auditLog.findMany({ where: { entityId: sessionId, action: { startsWith: "unattended." } } });
    for (const a of rows) expect(Object.keys((a.newValue ?? {}) as object)).not.toContain("reason");
    expect((await auditsOf(sessionId, "unattended.session.ended"))[0]?.newValue).toMatchObject({
      consentMode: "silent",
      endReason: "permission",
    });
  });
});
