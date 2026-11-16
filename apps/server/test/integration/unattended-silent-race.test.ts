// P28u-K3 O-P28u-2 yarışı (mimari-p28u §8.1, §8.4; AC-440, K-P28u-21): commit ↔ oda kaydı arası iptal, admit TX yeniden okuma.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectTestSeams } from "../../src/unattended/connect.ts";
import { testDb } from "../helpers/app.ts";
import { helperGuest, sessionStatus, waitUntil } from "../helpers/unattended-device.ts";
import { connectReq, noLog, REASON, setPolicy, setup, startSilentLive } from "../helpers/unattended-silent.ts";
import { finishSilent } from "../../src/unattended/policy.ts";
import type { Live } from "../helpers/signal-flow.ts";

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

describe("P28u-K3 unattended-silent-race (O-P28u-2)", () => {
  it("AC-440: connect commit'i ile oda kaydı arasına finishSilent → PENDING CANCELLED(permission), oturum açılmaz", async () => {
    const r = await setup(live, { silentPerm: true, policy: true });
    connectTestSeams.afterTx = async (o) => {
      await setPolicy(r.tenantId, false);
      await finishSilent({ db: testDb(), rooms: live.app.rooms, now: Date.now, log: noLog }, r.tenantId);
      expect((await sessionStatus(o.sessionId)).status).toBe("CANCELLED");
    };
    const res = await live.app.inject(connectReq(r, { silent: true, reason: REASON }));
    expect(res.statusCode).toBe(200);
    const msg = (await r.device.waitFor("connect" as never)) as unknown as { sessionId: string; ticket: string };
    await helperGuest(live, msg.ticket).catch(() => undefined);
    await new Promise((res2) => setTimeout(res2, 300));
    expect(await sessionStatus(msg.sessionId)).toMatchObject({ status: "CANCELLED", endReason: "permission" });
  });

  it("AC-440: politika kapalıyken bekleyen silent misafirin admit'i → permission (admit TX FOR SHARE yeniden okuma)", async () => {
    const r = await setup(live, { silentPerm: true, policy: true });
    connectTestSeams.afterTx = async () => {
      await setPolicy(r.tenantId, false); // finishSilent çağrılmadı: yalnız admit TX'i yakalamalı
    };
    expect((await live.app.inject(connectReq(r, { silent: true, reason: REASON }))).statusCode).toBe(200);
    const msg = (await r.device.waitFor("connect" as never)) as unknown as { sessionId: string; ticket: string };
    const helper = await helperGuest(live, msg.ticket);
    expect((await helper.waitFor("session.ended")).reason).toBe("permission");
    await waitUntil(async () => (await sessionStatus(msg.sessionId)).status === "CANCELLED");
    expect((await sessionStatus(msg.sessionId)).endReason).toBe("permission");
  });

  it("AC-440: yetki geri alındıktan sonra admit → permission; finishSilent tenant koşullu (başka tenant'ın silent satırı etkilenmez)", async () => {
    const a = await setup(live, { silentPerm: true, policy: true });
    const b = await setup(live, { silentPerm: true, policy: true });
    connectTestSeams.afterTx = async (o) => {
      if (o.deviceId === a.dev.id)
        await testDb().userPermission.updateMany({ where: { userId: a.tech.id, permKey: "unattended.silent" }, data: { granted: false } });
    };
    expect((await live.app.inject(connectReq(a, { silent: true, reason: REASON }))).statusCode).toBe(200);
    const ma = (await a.device.waitFor("connect" as never)) as unknown as { sessionId: string; ticket: string };
    const ha = await helperGuest(live, ma.ticket);
    expect((await ha.waitFor("session.ended")).reason).toBe("permission");
    delete connectTestSeams.afterTx;
    expect((await live.app.inject(connectReq(b, { silent: true, reason: REASON }))).statusCode).toBe(200);
    const mb = (await b.device.waitFor("connect" as never)) as unknown as { sessionId: string };
    await finishSilent({ db: testDb(), rooms: live.app.rooms, now: Date.now, log: noLog }, a.tenantId);
    expect((await sessionStatus(mb.sessionId)).status).toBe("PENDING");
  });
});
