// P28u-K4 yeniden katılım — r3 tek kip (mimari-p28u §8.3, §r3.4; AC-433, AC-440, AC-443; D-P28u-K1-2; S-P28u-r3-1).
// Logoff kabulü → `rejoin{mode:"no_user"}` bileti → yeni yardımcı; bilet gelmeden önce yetki/grant DB'de geri alınırsa rejoin TX'i
// `permission` ile bitirir. Gönderim anında soket `direct1`'siz yenilendiyse rejoin gönderilmez, oda `protocol` ile biter.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDb } from "../helpers/app.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { UNSIGNED_ENV } from "../helpers/unattended.ts";
import { helperGuest, onlineDevice, sessionStatus, waitUntil, type Ready } from "../helpers/unattended-device.ts";
import { auditsOf, directSession, grantControl, helperIn, readyK4, techConsole } from "../helpers/unattended-k4.ts";
import type { WsClient } from "../helpers/ws.ts";

let live: Live;
beforeAll(async () => {
  live = await startLive({ env: { ...UNSIGNED_ENV } });
});
afterAll(async () => live.close());

type Intervene = { t: "intervene"; sessionId: string; id: string; cmd: string };
type Rejoin = { t: "rejoin"; sessionId: string; ticket: string; mode: string; indicatorText: string };
interface Controlled {
  r: Ready;
  sessionId: string;
  helper: WsClient;
  tech: WsClient;
}

/** Kontrolü açık onaysız oda (gerçek connect → consent.result{no_user} zinciri). */
async function controlled(): Promise<Controlled> {
  const r = await readyK4(live);
  const { sessionId, helper } = await directSession(live, r);
  const { ws } = await techConsole(live, r, sessionId);
  await grantControl(ws, helper);
  return { r, sessionId, helper, tech: ws };
}

/** Logoff → cihaz `ok` → 200 `{rejoin:true}` → cihaza `rejoin`. */
async function logoffOk(c: Controlled): Promise<Rejoin> {
  const p = live.app.inject({
    method: "POST",
    url: `/api/v1/sessions/${c.sessionId}/unattended/logoff`,
    headers: c.r.s.headers,
    payload: { confirm: true },
  });
  const m = (await c.r.device.waitFor("intervene" as never)) as unknown as Intervene;
  c.r.device.send({ t: "intervene.result", sessionId: c.sessionId, id: m.id, cmd: "logoff", ok: true });
  expect((await p).json()).toEqual({ ok: true, rejoin: true });
  return (await c.r.device.waitFor("rejoin" as never)) as unknown as Rejoin;
}

/** Eski yardımcı düşer (pencerede oda sürer). */
async function oldHelperGone(c: Controlled): Promise<void> {
  c.helper.ws.close();
  await c.tech.waitFor("peer.left");
  expect((await sessionStatus(c.sessionId)).status).toBe("ACTIVE");
}

async function endedWith(c: Controlled, consoleReason: string, dbReason: string): Promise<void> {
  expect((await c.tech.waitFor("session.ended")).reason).toBe(consoleReason);
  await waitUntil(async () => (await sessionStatus(c.sessionId)).status === "ENDED");
  expect(await sessionStatus(c.sessionId)).toMatchObject({ status: "ENDED", endReason: dbReason });
}

describe("P28u-K4 yeniden katılım — yetki geri alma (AC-440)", () => {
  it("AC-440: logoff sonrası unattended.connect geri alınır (DB) → rejoin bileti → permission; audit unattended.rejoin{fail, permission}", async () => {
    const c = await controlled();
    const rj = await logoffOk(c);
    await oldHelperGone(c);
    const off = await testDb().userPermission.updateMany({
      where: { userId: c.r.tech.id, permKey: "unattended.connect" },
      data: { granted: false },
    });
    expect(off.count).toBe(1);
    const h = await helperGuest(live, rj.ticket);
    expect((await h.waitFor("session.ended")).reason).toBe("permission");
    await endedWith(c, "permission", "permission");
    expect(await auditsOf(c.sessionId, "unattended.rejoin")).toEqual([
      expect.objectContaining({ result: "fail", newValue: expect.objectContaining({ failReason: "permission" }) }),
    ]);
  });

  it("AC-440: logoff sonrası cihaz grant'ı silinir → rejoin TX'i permission", async () => {
    const c = await controlled();
    const rj = await logoffOk(c);
    await oldHelperGone(c);
    await testDb().unattendedDeviceGrant.deleteMany({ where: { deviceId: c.r.dev.id, userId: c.r.tech.id } });
    const h = await helperGuest(live, rj.ticket);
    expect((await h.waitFor("session.ended")).reason).toBe("permission");
    expect((await auditsOf(c.sessionId, "unattended.rejoin"))[0]).toMatchObject({
      result: "fail",
      newValue: expect.objectContaining({ failReason: "permission" }),
    });
  });
});

describe("P28u r3 yeniden katılım — tek kip (AC-433, S-P28u-r3-1)", () => {
  it("AC-433: logoff kabulü → rejoin.mode no_user + P27 gösterge metni; rejoin sonrası kip korunur, onay satırı yazılmaz", async () => {
    const c = await controlled();
    const rj = await logoffOk(c);
    expect(rj.mode).toBe("no_user");
    expect(rj.indicatorText).toContain("Uzaktan bağlantı");
    expect(rj).not.toHaveProperty("indicatorControl");
    await oldHelperGone(c);
    await helperIn(live, rj.ticket);
    await c.tech.waitFor("peer.joined");
    expect((await auditsOf(c.sessionId, "unattended.rejoin"))[0]).toMatchObject({ result: "success" });
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: c.sessionId } })).consentMode).toBe("no_user");
    expect(await auditsOf(c.sessionId, "unattended.consent")).toEqual([]);
    expect((await sessionStatus(c.sessionId)).status).toBe("ACTIVE");
  });

  it("AC-443: pencere içinde session.closed{session_changed} → oda hemen biter", async () => {
    const c = await controlled();
    await logoffOk(c);
    await oldHelperGone(c);
    c.r.device.send({ t: "session.closed", sessionId: c.sessionId, reason: "session_changed" });
    await endedWith(c, "session_changed", "session_changed");
    expect(await auditsOf(c.sessionId, "unattended.rejoin")).toEqual([]);
  });

  it("S-P28u-r3-1: logoff sonucu gelmeden soket direct1'siz (0.15–0.19) yenilenir → rejoin gönderilmez, rejoin:false, oda protocol ile biter", async () => {
    const c = await controlled();
    const p = live.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${c.sessionId}/unattended/logoff`,
      headers: c.r.s.headers,
      payload: { confirm: true },
    });
    const m = (await c.r.device.waitFor("intervene" as never)) as unknown as Intervene;
    const stale = await onlineDevice(live, c.r.dev, {}, "consent1"); // eski soket 4409 ile düşer
    stale.send({ t: "intervene.result", sessionId: c.sessionId, id: m.id, cmd: "logoff", ok: true });
    expect((await p).json()).toEqual({ ok: true, rejoin: false });
    await endedWith(c, "device_timeout", "device_timeout"); // ACTIVE oda: DB `rooms.finish` nedeni; ayrıntı audit'te
    await waitUntil(async () => (await auditsOf(c.sessionId, "unattended.session.ended")).length === 1);
    expect((await auditsOf(c.sessionId, "unattended.session.ended"))[0]?.newValue).toMatchObject({ endReason: "protocol" });
    expect(stale.msgs.some((x) => x.t === ("rejoin" as never))).toBe(false);
  });
});

describe("P28u-K4 yeniden katılım penceresinde cihaz bitiş bildirimi (D-P28u-K1-2)", () => {
  it("D-P28u-K1-2 AC-443: pencere içinde session.closed{helper_failed} → 45 sn beklemeden biter; neden pencere dışıyla aynı (session_changed değil)", async () => {
    const c = await controlled();
    await logoffOk(c);
    await oldHelperGone(c);
    const t0 = Date.now();
    c.r.device.send({ t: "session.closed", sessionId: c.sessionId, reason: "helper_failed" });
    await endedWith(c, "customer", "customer"); // kabul edilmiş odada P27 yolu: DB nedeni `customer` (pencere dışıyla aynı)
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});
