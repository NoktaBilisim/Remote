// P28u-K4 yeniden katılım (mimari-p28u §8.3, §12 T13/T15; AC-433, AC-440, AC-443; K-P28u-17, O-P28u-2, D-P28u-K1-2).
// Logoff kabulü → `rejoin` bileti → yeni yardımcı; bilet gelmeden önce politika/yetki DB'de geri alınırsa rejoin TX'i
// `permission` ile bitirir. `asked` odada yeni kullanıcı oturumu (`session.closed{session_changed}`) pencere içinde ve
// yeniden katılımdan sonra odayı bitirir; pencerede başka nedenli bildirim de süzülmeden hemen bitirir.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDb } from "../helpers/app.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { UNSIGNED_ENV } from "../helpers/unattended.ts";
import { helperGuest, sessionStatus, waitUntil, type Ready } from "../helpers/unattended-device.ts";
import { askConnect, auditsOf, grantControl, helperIn, readyK4, setPolicy, silentPending, techConsole } from "../helpers/unattended-k4.ts";
import type { WsClient } from "../helpers/ws.ts";

let live: Live;
beforeAll(async () => {
  live = await startLive({ env: { ...UNSIGNED_ENV } });
});
afterAll(async () => live.close());

type Intervene = { t: "intervene"; sessionId: string; id: string; cmd: string };
type Rejoin = { t: "rejoin"; sessionId: string; ticket: string; mode: string };
interface Controlled {
  r: Ready;
  sessionId: string;
  helper: WsClient;
  tech: WsClient;
}

/** Kontrolü açık oda; `mode` → silent (K3'ten bağımsız fikstür) ya da gerçek ask zinciri (`asked`/`no_user`). */
async function controlled(mode: "silent" | "asked" | "no_user"): Promise<Controlled> {
  const r = await readyK4(live);
  let sessionId: string;
  let ticket: string;
  if (mode === "silent") ({ sessionId, ticket } = await silentPending(live, r));
  else {
    const msg = await askConnect(live, r);
    r.device.send(
      mode === "asked"
        ? { t: "consent.result", sessionId: msg.sessionId, mode: "asked", decision: "granted", ms: 1500 }
        : { t: "consent.result", sessionId: msg.sessionId, mode: "no_user" },
    );
    ({ sessionId, ticket } = msg);
  }
  const helper = await helperIn(live, ticket);
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

describe("P28u-K4 yeniden katılım — politika/yetki geri alma (AC-440, T15, O-P28u-2)", () => {
  it("AC-440 T15: logoff sonrası politika kapatılır → rejoin bileti → permission; audit unattended.rejoin{fail, permission}", async () => {
    const c = await controlled("silent");
    const rj = await logoffOk(c);
    await oldHelperGone(c);
    await setPolicy(c.r.tenantId, false, c.r.tech.id);
    const h = await helperGuest(live, rj.ticket);
    expect((await h.waitFor("session.ended")).reason).toBe("permission");
    await endedWith(c, "permission", "permission");
    expect(await auditsOf(c.sessionId, "unattended.rejoin")).toEqual([
      expect.objectContaining({ result: "fail", newValue: expect.objectContaining({ failReason: "permission" }) }),
    ]);
  });

  it("AC-440 T15: logoff sonrası unattended.silent geri alınır (DB) → rejoin bileti → permission; audit failReason", async () => {
    const c = await controlled("silent");
    const rj = await logoffOk(c);
    await oldHelperGone(c);
    const off = await testDb().userPermission.updateMany({
      where: { userId: c.r.tech.id, permKey: "unattended.silent" },
      data: { granted: false },
    });
    expect(off.count).toBe(1);
    const h = await helperGuest(live, rj.ticket);
    expect((await h.waitFor("session.ended")).reason).toBe("permission");
    await endedWith(c, "permission", "permission");
    expect((await auditsOf(c.sessionId, "unattended.rejoin"))[0]).toMatchObject({
      result: "fail",
      newValue: expect.objectContaining({ failReason: "permission" }),
    });
  });
});

describe("P28u-K4 yeniden katılım — asked odada yeni kullanıcı oturumu (AC-433, T13, K-P28u-17)", () => {
  it("AC-433 T13: asked + logoff kabulü → rejoin.mode asked; pencere içinde session.closed{session_changed} → oda hemen biter", async () => {
    const c = await controlled("asked");
    const rj = await logoffOk(c);
    expect(rj.mode).toBe("asked");
    await oldHelperGone(c);
    c.r.device.send({ t: "session.closed", sessionId: c.sessionId, reason: "session_changed" });
    await endedWith(c, "session_changed", "session_changed");
    expect(await auditsOf(c.sessionId, "unattended.rejoin")).toEqual([]);
  });

  it("AC-433 T13: asked rejoin sonrası kip korunur (DB, yeni onay satırı yok); yeni oturum → session_changed bitişi", async () => {
    const c = await controlled("asked");
    const rj = await logoffOk(c);
    await oldHelperGone(c);
    await helperIn(live, rj.ticket);
    await c.tech.waitFor("peer.joined");
    expect((await auditsOf(c.sessionId, "unattended.rejoin"))[0]).toMatchObject({ result: "success" });
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: c.sessionId } })).consentMode).toBe("asked");
    expect(await auditsOf(c.sessionId, "unattended.consent")).toHaveLength(1);
    c.r.device.send({ t: "session.closed", sessionId: c.sessionId, reason: "session_changed" });
    await endedWith(c, "session_changed", "session_changed");
  });

  it("AC-433: no_user + logoff kabulü → rejoin.mode no_user; rejoin sonrası kip korunur, onay satırı yazılmaz", async () => {
    const c = await controlled("no_user");
    const rj = await logoffOk(c);
    expect(rj.mode).toBe("no_user");
    await oldHelperGone(c);
    await helperIn(live, rj.ticket);
    await c.tech.waitFor("peer.joined");
    expect((await testDb().supportSession.findUniqueOrThrow({ where: { id: c.sessionId } })).consentMode).toBe("no_user");
    expect(await auditsOf(c.sessionId, "unattended.consent")).toEqual([]);
    expect((await sessionStatus(c.sessionId)).status).toBe("ACTIVE");
  });
});

describe("P28u-K4 yeniden katılım penceresinde cihaz bitiş bildirimi (D-P28u-K1-2)", () => {
  it("D-P28u-K1-2 AC-443: pencere içinde session.closed{helper_failed} → 45 sn beklemeden biter; neden pencere dışıyla aynı (session_changed değil)", async () => {
    const c = await controlled("silent");
    await logoffOk(c);
    await oldHelperGone(c);
    const t0 = Date.now();
    c.r.device.send({ t: "session.closed", sessionId: c.sessionId, reason: "helper_failed" });
    await endedWith(c, "customer", "customer"); // kabul edilmiş odada P27 yolu: DB nedeni `customer` (pencere dışıyla aynı)
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});
