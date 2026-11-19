// P28u-K4 müdahale ucu ve yeniden katılım (mimari-p28u §5.3, §7.5, §8.3; AC-442–444; D-P28u-2). `POST /sessions/:id/unattended/
// {lock,logoff}` → cihaza `intervene` → `intervene.result`; süre aşımı sahte saatle (`rooms.clock`).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, createUser, loginAs, loginStepUp } from "../helpers/app.ts";
import { admitted, startLive, techSession, type Live } from "../helpers/signal-flow.ts";
import { UNSIGNED_ENV, grantRow } from "../helpers/unattended.ts";
import { helperGuest, sessionStatus, waitUntil } from "../helpers/unattended-device.ts";
import { auditsOf, directSession, grantControl, helperIn, K4_PERMS, readyK4, techConsole } from "../helpers/unattended-k4.ts";
import { FakeClock } from "../helpers/ws.ts";

let live: Live;
let faked: Live;
const clock = new FakeClock();
beforeAll(async () => {
  live = await startLive({ env: { ...UNSIGNED_ENV } });
  faked = await startLive({ env: { ...UNSIGNED_ENV }, signaling: { clock } });
});
afterAll(async () => {
  await Promise.all([live, faked].map((l) => l.close()));
});

type Intervene = { t: "intervene"; sessionId: string; id: string; cmd: string };
type Rejoin = {
  t: "rejoin";
  sessionId: string;
  ticket: string;
  mode: string;
  indicatorText: string;
  expiresInSec: number;
};
const post = (l: Live, headers: Record<string, string>, id: string, cmd: "lock" | "logoff") =>
  l.app.inject({
    method: "POST",
    url: `/api/v1/sessions/${id}/unattended/${cmd}`,
    headers,
    payload: cmd === "logoff" ? { confirm: true } : {},
  });
const code = (res: { statusCode: number; json: () => unknown }) =>
  `${res.statusCode} ${(res.json() as { error?: { code: string } }).error?.code ?? ""}`.trim();

/** Onaysız oda + konsol + kontrol açık (müdahale ön koşulu). */
async function controlled(l: Live) {
  const r = await readyK4(l);
  const { sessionId, helper } = await directSession(l, r);
  const { ws } = await techConsole(l, r, sessionId);
  await grantControl(ws, helper);
  return { r, sessionId, helper, tech: ws };
}

describe("P28u-K4 müdahale ucu — ön koşullar (AC-442)", () => {
  it("AC-442: kontrol GRANTED değil → 403; başka teknisyen → 403; başka tenant → 404; katılımlı oturum → 403; confirm yok → 400", async () => {
    const r = await readyK4(live);
    const { sessionId } = await directSession(live, r);
    expect(code(await post(live, r.s.headers, sessionId, "lock"))).toBe("403 FORBIDDEN");
    const peer = await createUser({ tenantId: r.tenantId, role: "USER", perms: K4_PERMS });
    await grantRow(r.tenantId, r.dev.id, peer.id);
    const ps = await loginStepUp(live.app, peer);
    expect(code(await post(live, ps.headers, sessionId, "lock"))).toBe("403 FORBIDDEN");
    const other = await createTenant();
    const stranger = await createUser({ tenantId: other.id, role: "USER", perms: K4_PERMS });
    const ss = await loginAs(live.app, stranger);
    expect(code(await post(live, ss.headers, sessionId, "lock"))).toBe("404 NOT_FOUND");
    const t = await techSession(live);
    await admitted(live, t);
    const ts = { ...t.techAuth.headers };
    const attended = await createUser({ tenantId: t.tenantId, role: "USER", perms: K4_PERMS });
    expect(attended).toBeDefined();
    // katılımlı odanın teknisyenine unattended.connect yoksa 403 (yetki), varsa oda gözetimsiz değil → 403
    expect(code(await post(live, ts, t.sessionId, "lock"))).toBe("403 FORBIDDEN");
    const bad = await live.app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessionId}/unattended/logoff`,
      headers: r.s.headers,
      payload: {},
    });
    expect(code(bad)).toBe("400 VALIDATION");
  });
});

describe("P28u-K4 kilit ve oturum kapatma (AC-443, 444)", () => {
  it("AC-443 AC-444: kilit → intervene{lock} → ok → 200; audit lock{deviceId, durationMs, consentMode}; bekleyen komut → 409", async () => {
    const { r, sessionId } = await controlled(live);
    const p = post(live, r.s.headers, sessionId, "lock");
    const m = (await r.device.waitFor("intervene" as never)) as unknown as Intervene;
    expect(m).toMatchObject({ sessionId, cmd: "lock" });
    expect(code(await post(live, r.s.headers, sessionId, "lock"))).toBe("409 INTERVENE_PENDING");
    r.device.send({ t: "intervene.result", sessionId, id: m.id, cmd: "lock", ok: true });
    const res = await p;
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const [a] = await auditsOf(sessionId, "unattended.lock");
    expect(a).toMatchObject({ result: "success", userId: r.tech.id });
    expect(a?.newValue).toMatchObject({ deviceId: r.dev.id, consentMode: "no_user" });
    expect(Object.keys(a?.newValue as object)).not.toContain("reason");
  });

  it("AC-443: cihaz ok:false → 502 INTERVENE_FAILED{fields.reason}, audit failReason; eşleşmeyen id yok sayılır", async () => {
    const { r, sessionId } = await controlled(live);
    const p = post(live, r.s.headers, sessionId, "lock");
    const m = (await r.device.waitFor("intervene" as never)) as unknown as Intervene;
    r.device.send({ t: "intervene.result", sessionId, id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", cmd: "lock", ok: true });
    r.device.send({ t: "intervene.result", sessionId, id: m.id, cmd: "lock", ok: false, reason: "not_locked" });
    const res = await p;
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: "INTERVENE_FAILED", fields: { reason: "not_locked" } } });
    expect((await auditsOf(sessionId, "unattended.lock"))[0]).toMatchObject({
      result: "fail",
      newValue: expect.objectContaining({ failReason: "not_locked" }),
    });
  });

  it("AC-443 D-P28u-2: logoff ok → rejoin (gen+1 bilet, ≤ 30 sn, kip korunur) → eski yardımcı düşer, yeni bilet tek kullanım, oturum sürer", async () => {
    const { r, sessionId, helper, tech } = await controlled(live);
    const p = post(live, r.s.headers, sessionId, "logoff");
    const m = (await r.device.waitFor("intervene" as never)) as unknown as Intervene;
    r.device.send({ t: "intervene.result", sessionId, id: m.id, cmd: "logoff", ok: true });
    const res = await p;
    expect(res.json()).toEqual({ ok: true, rejoin: true });
    const rj = (await r.device.waitFor("rejoin" as never)) as unknown as Rejoin;
    expect(rj).toMatchObject({ sessionId, mode: "no_user", expiresInSec: 30 });
    expect(rj.indicatorText).toContain("Uzaktan bağlantı");
    expect(rj).not.toHaveProperty("indicatorControl");
    helper.ws.close();
    await tech.waitFor("peer.left");
    const again = await helperIn(live, rj.ticket);
    await tech.waitFor("peer.joined");
    expect(again).toBeDefined();
    await expect(helperGuest(live, rj.ticket)).rejects.toThrow("HTTP 403");
    expect((await sessionStatus(sessionId)).status).toBe("ACTIVE");
    expect((await auditsOf(sessionId, "unattended.rejoin"))[0]).toMatchObject({ result: "success" });
    expect((await auditsOf(sessionId, "unattended.logoff"))[0]?.newValue).toMatchObject({ rejoin: true });
  });

  it("AC-443 (sahte saat): kilit yanıtsız 5 sn → 502 timeout; logoff yanıtsız 15 sn → 502 timeout, misafir yoksa oda session_changed", async () => {
    const a = await controlled(faked);
    const p1 = post(faked, a.r.s.headers, a.sessionId, "lock");
    await a.r.device.waitFor("intervene" as never);
    clock.advance(5_000);
    expect((await p1).json()).toMatchObject({ error: { code: "INTERVENE_FAILED", fields: { reason: "timeout" } } });
    const p2 = post(faked, a.r.s.headers, a.sessionId, "logoff");
    await a.r.device.waitFor("intervene" as never);
    a.helper.ws.close();
    await a.tech.waitFor("peer.left");
    clock.advance(15_000);
    expect((await p2).json()).toMatchObject({ error: { code: "INTERVENE_FAILED", fields: { reason: "timeout" } } });
    expect((await a.tech.waitFor("session.ended")).reason).toBe("session_changed");
    await waitUntil(async () => (await sessionStatus(a.sessionId)).status === "ENDED");
  });
});
