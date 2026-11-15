// P27-K3 kalanları (mimari-p27 §4.3, §4.4 r2 O-P27-3 / K-P27-18, §4.6, §7.1; AC-338, 339; D-P27-6): yedek yeniden doğrulama
// (anlık kesme çalışmasa da ≤ 60 sn, sahte saat), `control.state{source:UNATTENDED}` sınırı, connect 20/sa, kurtarma koduyla
// bağlantı e-postası, firma pasifinde cihaz soketleri.
import { CONTROL_AUDIT } from "@remote/contracts/audit";
import type { SMTPServer } from "smtp-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { admitGuest } from "../../src/signaling/admit.ts";
import { handleControlRequest, handleControlState } from "../../src/signaling/control.ts";
import { createUser, loginAs, loginStepUp, testDb } from "../helpers/app.ts";
import { closeSmtp, inboxTransport, loopbackNetguard, startInboxSmtp } from "../helpers/mail-tls.ts";
import { startLive, type Live } from "../helpers/signal-flow.ts";
import { UNSIGNED_ENV } from "../helpers/unattended.ts";
import { activeSession, connectReq, ready, sessionStatus, UN_TECH_PERMS, waitUntil } from "../helpers/unattended-device.ts";
import { FakeClock, makeRooms, roomFixture } from "../helpers/ws.ts";

let clock = new FakeClock();
const inbox: { to: string; body: string }[] = [];
let faked: Live;
let mailed: Live;
let smtp: SMTPServer;
beforeAll(async () => {
  const s = await startInboxSmtp(inbox);
  smtp = s.smtp;
  mailed = await startLive({
    env: { ...UNSIGNED_ENV },
    p10: { netguard: loopbackNetguard(), mailTransport: inboxTransport(() => s.port) },
  });
});
afterAll(async () => {
  await mailed.close();
  await closeSmtp(smtp);
});

const audits = (entityId: string, action: string) => testDb().auditLog.findMany({ where: { entityId, action } });

/** Anlık yol devre dışıyken oda açık kalır; 60 sn yedek tur (sahte saat) odayı `reason` ile bitirir. */
async function fallbackEnds(sessionId: string, helper: Awaited<ReturnType<typeof activeSession>>["helper"], reason: string) {
  await new Promise((r) => setTimeout(r, 300));
  expect((await sessionStatus(sessionId)).status).toBe("ACTIVE");
  expect(helper.msgs.some((m) => m.t === "session.ended")).toBe(false);
  clock.advance(60_000);
  expect((await helper.waitFor("session.ended")).reason).toBe(reason);
  await waitUntil(async () => (await sessionStatus(sessionId)).status === "ENDED");
}

describe("P27-K3 AC-338 yedek yeniden doğrulama (O-P27-3, sahte saat)", () => {
  // Her test kendi sahte saatli sunucusunda: connect ucu PENDING süresini gerçek saatle yazar, ilerletilen sahte saat
  // sonraki testin kabulünü (consumeForAdmit `now`) bozmasın.
  beforeEach(async () => {
    clock = new FakeClock();
    faked = await startLive({ env: { ...UNSIGNED_ENV }, signaling: { clock } });
  });
  afterEach(async () => faked.close());

  it("AC-338 AC-275: iptalde anlık kesme çalışmasa da oda ≤ 60 sn içinde device_revoked ile biter", async () => {
    const r = await ready(faked);
    const { sessionId, helper } = await activeSession(faked, r);
    const spy = vi.spyOn(faked.app.unattendedHub, "revoked").mockImplementation(() => undefined);
    const admin = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const as = await loginAs(faked.app, admin);
    const url = `/api/v1/unattended/devices/${r.dev.id}/revoke`;
    expect((await faked.app.inject({ method: "POST", url, headers: as.headers, payload: {} })).statusCode).toBe(204);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
    await fallbackEnds(sessionId, helper, "device_revoked");
  });

  it("AC-338 AC-293: yetki geri almada anlık kesme çalışmasa da oda ≤ 60 sn içinde permission ile biter", async () => {
    const r = await ready(faked);
    const { sessionId, helper } = await activeSession(faked, r);
    const spy = vi.spyOn(faked.app.unattendedHub, "grantsRemoved").mockImplementation(() => undefined);
    const admin = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const as = await loginStepUp(faked.app, admin);
    const url = `/api/v1/unattended/devices/${r.dev.id}/grants`;
    expect((await faked.app.inject({ method: "PUT", url, headers: as.headers, payload: { userIds: [] } })).statusCode).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
    await fallbackEnds(sessionId, helper, "permission");
  });

  it("AC-338 AC-295: yerel kapatma beyanı sunucuya ulaşmasa da (DB'de kapalı) oda ≤ 60 sn içinde local_disabled ile biter", async () => {
    const r = await ready(faked);
    const { sessionId, helper } = await activeSession(faked, r);
    await testDb().unattendedDevice.update({ where: { id: r.dev.id }, data: { localEnabled: false } });
    await fallbackEnds(sessionId, helper, "local_disabled");
  });
});

describe("P27-K3 control.state source:UNATTENDED (§4.6)", () => {
  const CTRL = ["sessions.create", "remote_control.use"] as const;

  async function agentRoom(unattended: boolean) {
    const rooms = makeRooms();
    const fx = await roomFixture(rooms, [...CTRL]);
    const g = fx.guest("203.0.113.7", "AGENT");
    expect(await admitGuest(rooms, fx.room, fx.tech, g.admitCode)).toBe("admitted");
    if (unattended) fx.room.unattended = { deviceId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", deviceName: "PC-1", customerId: "c" };
    return { rooms, fx, g };
  }

  it("AC-338: gözetimsiz oda dışında GRANTED/UNATTENDED → misafir soketi 1008 + audit control.granted{fail}; kayıt/iletim yok", async () => {
    const { rooms, fx, g } = await agentRoom(false);
    await handleControlRequest(rooms, fx.room, fx.tech);
    await handleControlState(rooms, fx.room, g.entry, { state: "GRANTED", source: "UNATTENDED" });
    expect(g.peer.closed).toEqual({ code: 1008, reason: "unattended_source" });
    expect(fx.techPeer.of("control.state")).toHaveLength(0);
    expect(await testDb().sessionConsent.count({ where: { sessionId: fx.session.id, level: "CONTROL" } })).toBe(0);
    const rows = await audits(fx.session.id, CONTROL_AUDIT.GRANTED);
    expect(rows.map((a) => [a.result, a.newValue])).toEqual([["fail", { reason: "unattended_source_outside_room" }]]);
  });

  it("AC-338: gözetimsiz odada GRANTED/UNATTENDED kaydedilir (source UNATTENDED); VIEW/UNATTENDED protokol hatası", async () => {
    const { rooms, fx, g } = await agentRoom(true);
    await handleControlRequest(rooms, fx.room, fx.tech);
    await handleControlState(rooms, fx.room, g.entry, { state: "GRANTED", source: "UNATTENDED" });
    expect(fx.techPeer.of("control.state").at(-1)).toEqual({ t: "control.state", state: "GRANTED", source: "UNATTENDED" });
    const row = await testDb().sessionConsent.findFirst({ where: { sessionId: fx.session.id, level: "CONTROL" } });
    expect(row).toMatchObject({ decision: "GRANTED", source: "UNATTENDED" });
    await handleControlState(rooms, fx.room, g.entry, { state: "VIEW", source: "UNATTENDED" });
    expect(g.peer.closed?.code).toBe(1008);
  });
});

describe("P27-K3 connect sınırı, kurtarma e-postası, firma pasifi", () => {
  it("AC-339: kullanıcı başına 20 bağlantı denemesi/sa; 21. → 429 RATE_LIMITED + audit reason=limit", async () => {
    const r = await ready(mailed, { online: false });
    const ghost = { s: r.s, dev: { ...r.dev, id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" } };
    for (let i = 0; i < 20; i++) expect((await mailed.app.inject(connectReq(ghost))).statusCode).toBe(404);
    const res = await mailed.app.inject(connectReq(r));
    expect(res.statusCode).toBe(429);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("RATE_LIMITED");
    expect((await audits(r.dev.id, "unattended.connect"))[0]?.newValue).toMatchObject({ reason: "limit" });
  });

  it("AC-339 D-P27-6: kurtarma koduyla step-up bağlantısı → firmadaki diğer unattended.manage sahiplerine e-posta (bağlanan ve yetkisiz hariç)", async () => {
    const r = await ready(mailed);
    const admin = await createUser({ tenantId: r.tenantId, role: "ADMIN" });
    const plain = await createUser({ tenantId: r.tenantId, role: "USER", perms: UN_TECH_PERMS });
    const s = await testDb().authSession.findFirstOrThrow({ where: { userId: r.tech.id }, select: { id: true } });
    await testDb().auditLog.create({
      data: {
        tenantId: r.tenantId,
        userId: r.tech.id,
        action: "auth.step_up",
        entity: "auth_sessions",
        entityId: s.id,
        result: "success",
        newValue: { method: "RECOVERY", remaining: 5 },
      },
    });
    expect((await mailed.app.inject(connectReq(r))).statusCode).toBe(200);
    await waitUntil(async () => inbox.some((m) => m.to === admin.email.toLowerCase()));
    const mine = inbox.filter((m) => [admin.email, plain.email, r.tech.email].map((e) => e.toLowerCase()).includes(m.to));
    expect(mine.map((m) => m.to)).toEqual([admin.email.toLowerCase()]);
  });

  it("AC-275 AC-70: firma pasife alınınca bağlı cihaz soketleri 4401 tenant_passive ile kapanır, hub çevrimdışı", async () => {
    const r = await ready(mailed);
    const sa = await loginAs(mailed.app, await createUser({ tenantId: null, role: "SUPER_ADMIN" }));
    const res = await mailed.app.inject({
      method: "POST",
      url: `/api/v1/admin/tenants/${r.tenantId}/deactivate`,
      headers: sa.headers,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(await r.device.closed).toEqual({ code: 4401, reason: "tenant_passive" });
    expect(mailed.app.unattendedHub.isOnline(r.dev.id)).toBe(false);
  });
});
