// P28u-K4 cihaz mesajları, kip, kesme ve görünümler — r3 tek kip (mimari-p28u §r3, §5.4, §6, §8.1, §8.2; AC-429, 433, 435, 440,
// 445, 446; S-P28u-r3-5). Gerçek dinleyen sunucu + Ed25519 sahte servis + sahte yardımcı.
import { WS_DEVICE_SUBPROTOCOL } from "@remote/contracts/ws-device";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createUser, loginAs, testDb } from "../helpers/app.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { UNSIGNED_ENV } from "../helpers/unattended.ts";
import { helperGuest, sessionStatus, waitUntil } from "../helpers/unattended-device.ts";
import { askConnect, auditsOf, directSession, grantControl, readyK4, techConsole } from "../helpers/unattended-k4.ts";
import { FakeClock } from "../helpers/ws.ts";

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
  it("AC-435 S-P28u-r3-5: r3 soketine device.features{consent1} — direct1 yankılanmaz; liste bağlanabilir", async () => {
    const r = await readyK4(live);
    expect(await r.device.waitFor("device.features" as never)).toEqual({ t: "device.features", caps: ["consent1"] });
    expect((await listItem(r))?.connectBlockedReason).toBeNull();
  });

  it("AC-435: 0.15–0.19 (consent1, direct1 yok) → features{consent1} ama liste outdated; P27 soketine features gitmez, P28u mesajı 1008", async () => {
    const mid = await readyK4(live, { legacy: "consent1" });
    expect(await mid.device.waitFor("device.features" as never)).toEqual({ t: "device.features", caps: ["consent1"] });
    expect((await listItem(mid))?.connectBlockedReason).toBe("outdated");
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

describe("P28u r3 onaysız bağlantı — consent.result{no_user}", () => {
  it("AC-433 AC-445: no_user → ACTIVE, consent_mode=no_user, unattended.consent yazılmaz, started.consentMode + hello kip; ikinci sonuç yok sayılır", async () => {
    const r = await readyK4(live);
    const { sessionId } = await directSession(live, r);
    const row = await testDb().supportSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row).toMatchObject({ status: "ACTIVE", consentMode: "no_user", silentReason: null });
    expect(await auditsOf(sessionId, "unattended.consent")).toEqual([]);
    expect((await auditsOf(sessionId, "unattended.session.started"))[0]?.newValue).toMatchObject({ consentMode: "no_user" });
    expect((await auditsOf(sessionId, "unattended.connect"))[0]?.newValue).toMatchObject({ consentRequested: "ask" });
    const { hello } = await techConsole(live, r, sessionId);
    expect(hello.unattended).toMatchObject({ consentMode: "no_user", intervene: true });
    const before = metric(live, 'rs_unattended_device_msg_rejected_total{t="consent.result"}');
    r.device.send({ t: "consent.result", sessionId, mode: "no_user" });
    await waitUntil(async () => metric(live, 'rs_unattended_device_msg_rejected_total{t="consent.result"}') === before + 1);
  });

  it("K-P28u-r3-4: eski cihazın consent.result{asked} şema dışı → soket 1008, yardımcı consent_missing ile biter (fail-closed)", async () => {
    const r = await readyK4(live);
    const msg = await askConnect(live, r);
    r.device.send({ t: "consent.result", sessionId: msg.sessionId, mode: "asked", decision: "granted", ms: 4200 });
    expect((await r.device.closed).code).toBe(1008);
    const helper = await helperGuest(live, msg.ticket);
    expect((await helper.waitFor("session.ended", 8000)).reason).toBe("consent_missing");
    await waitUntil(async () => (await sessionStatus(msg.sessionId)).status !== "PENDING");
    expect(await sessionStatus(msg.sessionId)).toMatchObject({ status: "CANCELLED", endReason: "consent_missing" });
  });

  it("r3: connect.result{consent_denied} artık şema dışı (1008); protocol (D-P28u-5) → CANCELLED(protocol), konsola device_timeout", async () => {
    const r = await readyK4(live);
    const msg = await askConnect(live, r);
    r.device.send({ t: "connect.result", sessionId: msg.sessionId, ok: false, reason: "consent_denied" });
    expect((await r.device.closed).code).toBe(1008);
    const p = await readyK4(live);
    const m2 = await askConnect(live, p);
    const t2 = await techConsole(live, p, m2.sessionId);
    p.device.send({ t: "connect.result", sessionId: m2.sessionId, ok: false, reason: "protocol" });
    expect((await t2.ws.waitFor("session.ended")).reason).toBe("device_timeout");
    expect(await sessionStatus(m2.sessionId)).toMatchObject({ status: "CANCELLED", endReason: "protocol" });
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

describe("P28u r3 kontrol ve kesme", () => {
  it("AC-445 K-P28u-r3-6: kontrol açılıp kapanınca control_toggle on/off audit (consentMode=no_user); dosya teklifi kip kapısına takılmaz", async () => {
    const r = await readyK4(live);
    const { sessionId, helper } = await directSession(live, r);
    const { ws } = await techConsole(live, r, sessionId);
    await grantControl(ws, helper);
    await waitUntil(async () => (await auditsOf(sessionId, "unattended.control_toggle")).length === 1);
    ws.send({ t: "control.release" });
    await waitUntil(async () => (await auditsOf(sessionId, "unattended.control_toggle")).length === 2);
    const rows = await auditsOf(sessionId, "unattended.control_toggle");
    expect(rows.map((a) => a.newValue)).toEqual([
      { from: "view", to: "control", consentMode: "no_user" },
      { from: "control", to: "view", consentMode: "no_user" },
    ]);
  });

  it("K-P28u-16: gözetimsiz odada kontrol isteği AC-116 sayacına takılmaz (6. istek de iletilir)", async () => {
    const r = await readyK4(live);
    const { sessionId, helper } = await directSession(live, r);
    const { ws } = await techConsole(live, r, sessionId);
    for (let i = 0; i < 6; i++) {
      await grantControl(ws, helper);
      ws.send({ t: "control.release" });
      await helper.waitFor("control.release");
    }
    expect(ws.msgs.some((m) => m.t === "error")).toBe(false);
  });

  it("AC-440: unattended.connect geri alınınca (applyPermChange) oda permission ile biter", async () => {
    const r = await readyK4(live);
    const { sessionId, helper } = await directSession(live, r);
    await live.app.rooms.applyPermChange(r.tech.id, ["remote_control.use"]);
    expect((await helper.waitFor("session.ended")).reason).toBe("permission");
    expect(await sessionStatus(sessionId)).toMatchObject({ status: "ENDED", endReason: "permission" });
  });

  it("AC-440 yedek yol (sahte saat): anlık kesme atlansa da grant silinince ≤ 60 sn'de permission", async () => {
    const r = await readyK4(faked);
    const { sessionId, helper } = await directSession(faked, r);
    await testDb().unattendedDeviceGrant.deleteMany({ where: { deviceId: r.dev.id, userId: r.tech.id } });
    clock.advance(60_000);
    expect((await helper.waitFor("session.ended")).reason).toBe("permission");
    await waitUntil(async () => (await sessionStatus(sessionId)).status === "ENDED");
  });
});

describe("P28u-K4 geçmiş ve audit görünümleri (r3)", () => {
  it("AC-445 AC-446: geçmiş liste consentMode=no_user + filtre; detay unattended{consentMode, timeline} (gerekçe yok); başka tenant 404", async () => {
    const r = await readyK4(live);
    const { sessionId } = await directSession(live, r);
    const list = await live.app.inject({ method: "GET", url: "/api/v1/sessions?consentMode=no_user", headers: r.s.headers });
    expect(list.statusCode).toBe(200);
    const items = list.json<{ items: { id: string; consentMode: string | null }[] }>().items;
    expect(items.find((i) => i.id === sessionId)?.consentMode).toBe("no_user");
    const none = await live.app.inject({ method: "GET", url: "/api/v1/sessions?consentMode=silent", headers: r.s.headers });
    expect(none.json<{ items: { id: string }[] }>().items.some((i) => i.id === sessionId)).toBe(false);
    const det = await live.app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/history`, headers: r.s.headers });
    expect(det.json<{ unattended: unknown }>().unattended).toEqual({ consentMode: "no_user", timeline: [] });
    const other = await createTenant();
    const stranger = await createUser({ tenantId: other.id, role: "ADMIN" });
    const so = await loginAs(live.app, stranger);
    expect((await live.app.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/history`, headers: so.headers })).statusCode).toBe(
      404,
    );
  });

  it("AC-445: audit consentMode filtresi kipe göre süzer; oturum audit satırlarında çıplak reason yok, ended'de consentMode", async () => {
    const r = await readyK4(live);
    const { sessionId } = await directSession(live, r);
    const admin = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const as = await loginAs(live.app, admin);
    await live.app.rooms.applyPermChange(r.tech.id, []);
    await waitUntil(async () => (await auditsOf(sessionId, "unattended.session.ended")).length === 1);
    const res = await live.app.inject({ method: "GET", url: "/api/v1/audit?consentMode=no_user", headers: as.headers });
    expect(res.statusCode).toBe(200);
    const actions = res.json<{ items: { action: string; entityId: string | null }[] }>().items.filter((i) => i.entityId === sessionId);
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["unattended.session.ended", "unattended.session.started"]));
    const silent = await live.app.inject({ method: "GET", url: "/api/v1/audit?consentMode=silent", headers: as.headers });
    expect(silent.json<{ items: { entityId: string | null }[] }>().items.some((i) => i.entityId === sessionId)).toBe(false);
    const rows = await testDb().auditLog.findMany({ where: { entityId: sessionId, action: { startsWith: "unattended." } } });
    for (const a of rows) expect(Object.keys((a.newValue ?? {}) as object)).not.toContain("reason");
    expect((await auditsOf(sessionId, "unattended.session.ended"))[0]?.newValue).toMatchObject({
      consentMode: "no_user",
      endReason: "permission",
    });
  });
});
