// P28u-K3 bağlantı zinciri (mimari-p28u §5.1; AC-430, 431, 434, 435, 437, 445): 2a/2b/2c/8a/10, gerekçe, silentAllowed.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectTestSeams } from "../../src/unattended/connect.ts";
import { createUser, loginAs, loginStepUp, markStepUp, testDb, type Session } from "../helpers/app.ts";
import { authMsg, ready, UN_TECH_PERMS } from "../helpers/unattended-device.ts";
import { code, connectReq, failAudits, REASON, setPolicy, setup, startSilentLive, type ErrBody } from "../helpers/unattended-silent.ts";
import type { Live } from "../helpers/signal-flow.ts";
import { connect } from "../helpers/ws.ts";
import { WS_DEVICE_SUBPROTOCOL } from "@remote/contracts/ws-device";

let live: Live;
let env: Awaited<ReturnType<typeof startSilentLive>>;
beforeAll(async () => {
  env = await startSilentLive();
  ({ live } = env);
});
afterAll(async () => env.close());
afterEach(() => {
  delete connectTestSeams.afterTx;
});

describe("P28u-K3 bağlantı zinciri", () => {
  it("AC-431 AC-445: izinli (ask) → PENDING 150 sn, consent_mode NULL, cihaza connect{consent:ask}, audit consentRequested", async () => {
    const r = await setup(live);
    const res = await live.app.inject(connectReq(r));
    expect(res.statusCode).toBe(200);
    const { sessionId } = res.json<{ sessionId: string }>();
    const msg = (await r.device.waitFor("connect" as never)) as unknown as Record<string, unknown>;
    expect(msg).toMatchObject({ sessionId, consent: "ask" });
    expect(msg.indicatorControl).toBeUndefined();
    const row = await testDb().supportSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.consentMode).toBeNull();
    expect((row.expiresAt.getTime() - row.createdAt.getTime()) / 1000).toBe(150);
    const a = await testDb().auditLog.findFirstOrThrow({ where: { entityId: sessionId, action: "unattended.connect" } });
    expect(a.newValue).toMatchObject({ consentRequested: "ask", mode: "ask" });
    expect(a.newValue).not.toHaveProperty("reason");
    expect(a.newValue).not.toHaveProperty("silentReason");
  });

  it("AC-435: consent1 bildirmeyen (eski) servis → 409 DEVICE_OUTDATED, cihaza connect gitmez, audit failReason=outdated", async () => {
    const base = await ready(live, { online: false });
    const c = await connect(`${live.base}/ws/device`, [WS_DEVICE_SUBPROTOCOL]); // eski servis: belirteç yok
    const { nonce } = (await c.waitFor("device.hello" as never)) as unknown as { nonce: string };
    c.send(authMsg(base.dev, nonce));
    await c.waitFor("device.ready" as never);
    const r = { ...base, device: c };
    const res = await live.app.inject(connectReq(r));
    expect(code(res)).toBe("409 DEVICE_OUTDATED");
    expect(r.device.msgs.some((m) => (m as { t: string }).t === "connect")).toBe(false);
    expect(await failAudits(r.dev.id)).toEqual([expect.objectContaining({ failReason: "outdated", mode: "ask" })]);
  });

  it("AC-434: aynı teknisyen×cihaz 60 sn'de ikinci ask → 429 (retryAfterSec), cihaza ikinci connect gitmez; step-up'sız 401 sayılmaz", async () => {
    const r = await setup(live);
    await testDb().authSession.updateMany({ where: { userId: r.tech.id }, data: { stepUpAt: null } });
    expect(code(await live.app.inject(connectReq(r)))).toBe("401 MFA_STEP_UP_REQUIRED");
    await markStepUp(r.s);
    expect((await live.app.inject(connectReq(r))).statusCode).toBe(200);
    await r.device.waitFor("connect" as never);
    await markStepUp(r.s);
    const second = await live.app.inject(connectReq(r));
    expect(code(second)).toBe("429 RATE_LIMITED");
    expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
    await new Promise((res) => setTimeout(res, 200));
    expect(r.device.msgs.filter((m) => (m as { t: string }).t === "connect")).toHaveLength(0); // ilki waitFor ile alındı
    expect(await failAudits(r.dev.id)).toContainEqual(expect.objectContaining({ failReason: "pair_limit", mode: "ask" }));
  });

  it("AC-434: bekleyen PENDING varken başka teknisyen → 409 DEVICE_BUSY", async () => {
    const r = await setup(live);
    const other = await createUser({ tenantId: r.tenantId, role: "USER", perms: UN_TECH_PERMS });
    await testDb().unattendedDeviceGrant.create({
      data: { id: `${r.dev.id.slice(0, 20)}OTHER1`, tenantId: r.tenantId, deviceId: r.dev.id, userId: other.id },
    });
    const s2 = await loginStepUp(live.app, other);
    expect((await live.app.inject(connectReq(r))).statusCode).toBe(200);
    expect(code(await live.app.inject(connectReq({ s: s2, dev: r.dev })))).toBe("409 DEVICE_BUSY");
  });

  it("AC-437: silent başarı → PENDING 60 sn, consent_mode/silent_reason, connect{consent:silent, indicatorControl}, audit silentReason", async () => {
    const r = await setup(live, { silentPerm: true, policy: true });
    const res = await live.app.inject(connectReq(r, { silent: true, reason: `  ${REASON}  ` }));
    expect(res.statusCode).toBe(200);
    const { sessionId } = res.json<{ sessionId: string }>();
    const msg = (await r.device.waitFor("connect" as never)) as unknown as Record<string, string>;
    expect(msg.consent).toBe("silent");
    expect(msg.indicatorText).toContain("Uzaktan izleniyor");
    expect(typeof msg.indicatorControl).toBe("string");
    const row = await testDb().supportSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row).toMatchObject({ consentMode: "silent", silentReason: REASON });
    expect((row.expiresAt.getTime() - row.createdAt.getTime()) / 1000).toBe(60);
    const audits = await testDb().auditLog.findMany({ where: { tenantId: r.tenantId, action: { startsWith: "unattended." } } });
    const withReason = audits.filter((a) => JSON.stringify(a.newValue).includes("silentReason"));
    expect(withReason.map((a) => a.action)).toEqual(["unattended.connect"]);
    expect(withReason[0]?.newValue).toMatchObject({ consentMode: "silent", silentReason: REASON, mode: "silent" });
    expect(audits.every((a) => !Object.hasOwn((a.newValue ?? {}) as object, "reason"))).toBe(true);
  });

  it("AC-437: yetki matrisi — yetki yok 403, politika kapalı 409, grant yok 404, step-up yok 401; her ret failReason+mode", async () => {
    const noPerm = await setup(live, { policy: true });
    expect(code(await live.app.inject(connectReq(noPerm, { silent: true, reason: REASON })))).toBe("403 FORBIDDEN");
    const off = await setup(live, { silentPerm: true });
    expect(code(await live.app.inject(connectReq(off, { silent: true, reason: REASON })))).toBe("409 SILENT_DISABLED");
    const noGrant = await setup(live, { silentPerm: true, policy: true });
    await testDb().unattendedDeviceGrant.deleteMany({ where: { deviceId: noGrant.dev.id } });
    expect(code(await live.app.inject(connectReq(noGrant, { silent: true, reason: REASON })))).toBe("404 NOT_FOUND");
    const noStep = await setup(live, { silentPerm: true, policy: true });
    await testDb().authSession.updateMany({ where: { userId: noStep.tech.id }, data: { stepUpAt: null } });
    expect(code(await live.app.inject(connectReq(noStep, { silent: true, reason: REASON })))).toBe("401 MFA_STEP_UP_REQUIRED");
    const noConnect = await setup(live, { silentPerm: true, policy: true });
    await testDb()
      .userPermission.create({ data: { userId: noConnect.tech.id, permKey: "unattended.connect", granted: false } })
      .catch(() =>
        testDb().userPermission.updateMany({
          where: { userId: noConnect.tech.id, permKey: "unattended.connect" },
          data: { granted: false },
        }),
      );
    expect((await live.app.inject(connectReq(noConnect, { silent: true, reason: REASON }))).statusCode).toBe(403);
    expect(await failAudits(noPerm.dev.id)).toEqual([expect.objectContaining({ failReason: "forbidden", mode: "silent" })]);
    expect(await failAudits(off.dev.id)).toEqual([expect.objectContaining({ failReason: "silent_disabled", mode: "silent" })]);
    for (const a of [...(await failAudits(noPerm.dev.id)), ...(await failAudits(off.dev.id))]) {
      expect(a).not.toHaveProperty("reason");
      expect(a).not.toHaveProperty("silentReason");
    }
  });

  it("AC-437: gerekçe sınırları 19/20/500/501 + silent⇔reason → 400 VALIDATION fields.reason", async () => {
    const r = await setup(live, { silentPerm: true, policy: true });
    const field = async (payload: object) => {
      const res = await live.app.inject(connectReq(r, payload));
      return res.statusCode === 400 ? Object.keys(res.json<ErrBody>().error.fields ?? {}) : res.statusCode;
    };
    expect(await field({ silent: true, reason: "a".repeat(19) })).toEqual(["reason"]);
    expect(await field({ silent: true, reason: "a".repeat(501) })).toEqual(["reason"]);
    expect(await field({ silent: true })).toEqual(["reason"]);
    expect(await field({ reason: REASON })).toEqual(["reason"]);
    expect(await field({ silent: true, reason: `${"a".repeat(19)}‮` })).toEqual(["reason"]);
    expect(await field({ silent: true, reason: "ğ".repeat(500) })).toBe(200);
    const r2 = await setup(live, { silentPerm: true, policy: true });
    expect((await live.app.inject(connectReq(r2, { silent: true, reason: "b".repeat(20) }))).statusCode).toBe(200);
  });

  it("AC-430: GET /status.silentAllowed — politika × yetki; yalnız ikisi birlikteyken true", async () => {
    const r = await setup(live, { silentPerm: true });
    const allowed = async (s: Session) =>
      (await live.app.inject({ method: "GET", url: "/api/v1/unattended/status", headers: s.headers })).json<{ silentAllowed: boolean }>()
        .silentAllowed;
    expect(await allowed(r.s)).toBe(false);
    await setPolicy(r.tenantId, true);
    expect(await allowed(r.s)).toBe(true);
    const plain = await createUser({ tenantId: r.tenantId, role: "USER", perms: UN_TECH_PERMS });
    expect(await allowed(await loginAs(live.app, plain))).toBe(false);
  });
});
