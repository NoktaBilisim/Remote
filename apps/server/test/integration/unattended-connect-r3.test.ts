// P28u r3 bağlantı ucu — tek kip (mimari-p28u §r3.4; AC-430, AC-434, AC-435; S-P28u-r3-1). Ayrı dosya: kendi sunucusu
// (giriş hız kovası diğer K3 testleriyle paylaşılmaz).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markStepUp, testDb } from "../helpers/app.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { UNSIGNED_ENV } from "../helpers/unattended.ts";
import { activeSession, connectReq, onlineDevice, ready, sessionStatus, waitUntil } from "../helpers/unattended-device.ts";

let live: Live;
beforeAll(async () => {
  live = await startLive({ env: { ...UNSIGNED_ENV }, signaling: { timing: { requestConnectMs: 1500 } } });
});
afterAll(async () => live.close());

const audits = (entityId: string, action: string) => testDb().auditLog.findMany({ where: { entityId, action } });

describe("P28u r3 bağlantı ucu — tek kip (AC-430, AC-434, AC-435, S-P28u-r3-1)", () => {
  it("AC-430: gövde boş nesne; eski `silent` / `reason` alanı 400 VALIDATION (step-up tüketilmez)", async () => {
    const r = await ready(live);
    const bad = await live.app.inject({ ...connectReq(r), payload: { silent: true, reason: "Sunucu bakım penceresi, acil." } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: "VALIDATION" } });
    expect((await live.app.inject(connectReq(r))).statusCode).toBe(200);
  });

  it("AC-435: consent1 bildiren ama direct1 bildirmeyen servis (0.15–0.19) → 409 DEVICE_OUTDATED, step-up tüketilmez, fail audit", async () => {
    const r = await ready(live, { online: false });
    const dev = await onlineDevice(live, r.dev, {}, "consent1");
    const res = await live.app.inject(connectReq(r));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: "DEVICE_OUTDATED" } });
    expect(dev.msgs.some((m) => m.t === ("connect" as never))).toBe(false);
    const auth = await testDb().authSession.findMany({ where: { userId: r.tech.id }, select: { stepUpAt: true } });
    expect(auth.some((a) => a.stepUpAt !== null)).toBe(true);
    expect((await audits(r.dev.id, "unattended.connect"))[0]?.newValue).toMatchObject({ failReason: "outdated" });
  });

  it("AC-434 K-P28u-r3-11: teknisyen×cihaz 'dakikada 1' yok — bitmiş bağlantıdan hemen sonra yeni bağlantı 200", async () => {
    const r = await ready(live);
    const first = await activeSession(live, r);
    r.device.send({ t: "session.closed", sessionId: first.sessionId, reason: "helper_failed" });
    await waitUntil(async () => (await sessionStatus(first.sessionId)).status === "ENDED");
    await markStepUp(r.s);
    expect((await live.app.inject(connectReq(r))).statusCode).toBe(200);
  });

  it("S-P28u-r3-1: TX ile gönderim arasında soket direct1'siz yenilenir → connect gitmez, CANCELLED(protocol), 409 DEVICE_OUTDATED", async () => {
    const { connectTestSeams } = await import("../../src/unattended/connect.ts");
    const r = await ready(live);
    let stale: Awaited<ReturnType<typeof onlineDevice>> | undefined;
    let sessionId = "";
    connectTestSeams.afterTx = async (o) => {
      sessionId = o.sessionId;
      stale = await onlineDevice(live, r.dev, {}, "consent1");
    };
    try {
      const res = await live.app.inject(connectReq(r));
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: "DEVICE_OUTDATED" } });
    } finally {
      connectTestSeams.afterTx = undefined;
    }
    expect(stale?.msgs.some((m) => m.t === ("connect" as never))).toBe(false);
    expect(await sessionStatus(sessionId)).toMatchObject({ status: "CANCELLED", endReason: "protocol" });
  });
});
