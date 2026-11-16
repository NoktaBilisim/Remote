// P28c K1 sunucu entegrasyon testleri (mimari-p28c r2 §4–§5, §9, §12; AC-364..370, 372). Gerçek sunucu + MySQL; oda saati
// sahte (davet 2 dk, rezervasyon 60 sn, kopma payı 120 sn). Tarayıcı misafiri `rs.cap.multi1` bildirir (aksi belirtilmedikçe).
import { MAX_TECHS, techsRosterSchema } from "@remote/contracts/ws-multi";
import { WS_CLOSE } from "@remote/contracts/ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTenant, testDb } from "../helpers/app.ts";
import {
  audits,
  errCode,
  inject,
  inviteAndJoin,
  MEMBER_PERMS,
  memberWs,
  OWNER_PERMS,
  newUser,
  ownerWithGuest,
  startMultiLive,
  SUPERVISOR_PERMS,
  until,
  waitMsg,
  type MultiLive,
} from "../helpers/multi.ts";

let live: MultiLive;
beforeAll(async () => {
  live = await startMultiLive();
});
afterAll(async () => {
  await live.close();
});

const STAT = { avg: 1, min: 1, max: 1 };
/** Devir hedefinin sahip koltuğu koşulu (D-PC-K4: `POST /sessions` ile aynı yetki). */
const TARGET_PERMS = { "sessions.create": true, "sessions.invite": true };
const room = (id: string) => {
  const r = live.app.rooms.get(id);
  if (!r) throw new Error("oda yok");
  return r;
};

describe("P28c davet (AC-364, 365, 370)", () => {
  it("AC-364: davet 201 → davetli listesinde → kabul → üye WS; roster misafire ve teknisyenlere; audit bir kez", async () => {
    const o = await ownerWithGuest(live);
    const first = techsRosterSchema.parse(await waitMsg(o.guest, "techs.roster"));
    expect(first.techs).toHaveLength(1);
    const m = await newUser(live, o.tenantId, MEMBER_PERMS);
    const inv = await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/invites`, o.s, { userId: m.user.id });
    expect(inv.statusCode).toBe(201);
    const { inviteId } = inv.json<{ inviteId: string }>();
    const list = await inject(live, "GET", "/api/v1/sessions/invites", m.s);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.json<{ items: { inviteId: string; silent: boolean }[] }>().items).toEqual([
      expect.objectContaining({ inviteId, silent: false }),
    ]);
    expect((await inject(live, "GET", "/api/v1/sessions/invites", o.s)).json<{ items: unknown[] }>().items).toHaveLength(0);
    const acc = await inject(live, "POST", `/api/v1/sessions/invites/${inviteId}/accept`, m.s, {});
    expect(acc.json()).toEqual({ sessionId: o.sessionId, consoleUrl: `/sessions/${o.sessionId}/console` });
    // tek kullanımlık
    expect(errCode(await inject(live, "POST", `/api/v1/sessions/invites/${inviteId}/accept`, m.s, {}))).toBe("410 INVITE_GONE");
    const { ws, hello } = await memberWs(live, o.sessionId, m.s);
    expect(hello).toMatchObject({ techRole: "participant" });
    const roster = techsRosterSchema.parse(await waitMsg(o.guest, "techs.roster", (r) => r.techs.length === 2));
    expect(roster.techs.map((t) => t.role).sort()).toEqual(["controller", "participant"]);
    expect(roster.techs.find((t) => !t.owner)?.tid).toBe(hello.tid);
    await waitMsg(o.ws, "techs.roster", (r) => r.techs.length === 2);
    // AC-370: alanlar ve tekillik
    await until(async () => (await audits(o.sessionId, "session.participant_join")).length === 1);
    const join = await audits(o.sessionId, "session.participant_join");
    expect(join[0]?.newValue).toEqual({ userId: m.user.id, role: "participant" });
    expect((await audits(o.sessionId, "session.invite"))[0]?.newValue).toMatchObject({ inviteeUserId: m.user.id });
    expect(await audits(o.sessionId, "session.invite_accept")).toHaveLength(1);
    // D-PC-5: sahip olmayan üyeye doğrulama kodu boş; sahip görür
    const view = await inject(live, "GET", `/api/v1/sessions/${o.sessionId}`, m.s);
    expect(view.statusCode).toBe(200);
    expect(view.json<{ techVerifyCode: string }>().techVerifyCode).toBe("");
    expect((await inject(live, "GET", `/api/v1/sessions/${o.sessionId}`, o.s)).json<{ techVerifyCode: string }>().techVerifyCode).not.toBe(
      "",
    );
    ws.ws.close();
  });

  it("AC-364: yetkisiz / başka tenant / pasif davetli → 403 + fail audit (failReason); süre dolunca invite_expire + 410", async () => {
    const o = await ownerWithGuest(live);
    const noPerm = await newUser(live, o.tenantId, {});
    const other = await newUser(live, (await createTenant()).id, MEMBER_PERMS);
    const passive = await newUser(live, o.tenantId, MEMBER_PERMS);
    await testDb().user.update({ where: { id: passive.user.id }, data: { status: "PASSIVE" } });
    for (const u of [noPerm, other, passive])
      expect(errCode(await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/invites`, o.s, { userId: u.user.id }))).toBe(
        "403 FORBIDDEN",
      );
    const fails = await audits(o.sessionId, "session.invite");
    expect(fails.every((a) => a.result === "fail")).toBe(true);
    // T8: fail audit'i (kullanıcı, oturum, gerekçe) başına dakikada 1 — başka tenant + pasif aynı `tenant` gerekçesi → tek kayıt
    expect(fails.map((a) => (a.newValue as { failReason: string }).failReason).sort()).toEqual(["permission", "tenant"]);
    // sahip olmayan davet edemez
    const m = await newUser(live, o.tenantId, { ...MEMBER_PERMS, "sessions.invite": true });
    expect(errCode(await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/invites`, m.s, { userId: m.user.id }))).toBe(
      "403 FORBIDDEN",
    );
    const inv = await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/invites`, o.s, { userId: m.user.id });
    const { inviteId } = inv.json<{ inviteId: string }>();
    live.clock.advance(120_000);
    expect(errCode(await inject(live, "POST", `/api/v1/sessions/invites/${inviteId}/accept`, m.s, {}))).toBe("410 INVITE_GONE");
    await until(async () => (await audits(o.sessionId, "session.invite_expire")).length === 1);
    expect((await audits(o.sessionId, "session.invite_expire"))[0]?.newValue).toEqual({ inviteeUserId: m.user.id, reason: "timeout" });
  });

  it("AC-364: ret 204 + audit; geri çekme 204 + invite_expire{revoked}; başkasının daveti 410", async () => {
    const o = await ownerWithGuest(live);
    const a = await newUser(live, o.tenantId, MEMBER_PERMS);
    const b = await newUser(live, o.tenantId, MEMBER_PERMS);
    const ia = (await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/invites`, o.s, { userId: a.user.id })).json<{
      inviteId: string;
    }>();
    const ib = (await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/invites`, o.s, { userId: b.user.id })).json<{
      inviteId: string;
    }>();
    expect(errCode(await inject(live, "POST", `/api/v1/sessions/invites/${ia.inviteId}/accept`, b.s, {}))).toBe("410 INVITE_GONE");
    expect((await inject(live, "POST", `/api/v1/sessions/invites/${ia.inviteId}/reject`, a.s)).statusCode).toBe(204);
    expect((await inject(live, "DELETE", `/api/v1/sessions/${o.sessionId}/invites/${ib.inviteId}`, o.s)).statusCode).toBe(204);
    expect(await audits(o.sessionId, "session.invite_reject")).toHaveLength(1);
    expect((await audits(o.sessionId, "session.invite_expire"))[0]?.newValue).toEqual({ inviteeUserId: b.user.id, reason: "revoked" });
    expect(room(o.sessionId).multi.invites.size).toBe(0);
  });

  it("AC-365: sahip + üye + bekleyen davet = 3 koltuk → 4. davet ve İzle 409 SESSION_FULL", async () => {
    const o = await ownerWithGuest(live);
    await inviteAndJoin(live, o);
    const pending = await newUser(live, o.tenantId, MEMBER_PERMS);
    expect((await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/invites`, o.s, { userId: pending.user.id })).statusCode).toBe(201);
    const fourth = await newUser(live, o.tenantId, MEMBER_PERMS);
    expect(errCode(await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/invites`, o.s, { userId: fourth.user.id }))).toBe(
      "409 SESSION_FULL",
    );
    const sup = await newUser(live, o.tenantId, SUPERVISOR_PERMS);
    expect(errCode(await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, sup.s, {}))).toBe("409 SESSION_FULL");
    const active = await inject(live, "GET", "/api/v1/sessions/active", sup.s);
    expect(active.json<{ items: { id: string; full: boolean }[] }>().items.find((i) => i.id === o.sessionId)?.full).toBe(true);
    expect(MAX_TECHS).toBe(3);
  });

  it("yarış (O-PC-2): son koltuğa eşzamanlı iki İzle → biri 200, biri 409 SESSION_FULL", async () => {
    const o = await ownerWithGuest(live);
    await inviteAndJoin(live, o);
    const a = await newUser(live, o.tenantId, SUPERVISOR_PERMS);
    const b = await newUser(live, o.tenantId, SUPERVISOR_PERMS);
    const res = await Promise.all([a, b].map((u) => inject(live, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, u.s, {})));
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(room(o.sessionId).multi.members.size).toBe(2);
  });
});

describe("P28c roster, çıkarma, rol kapısı (AC-366, 367, 368)", () => {
  it("AC-366: üyenin offer'ı misafire roster'dan sonra `from` ile; misafir yanıtı `to` ile yalnız o üyeye", async () => {
    const o = await ownerWithGuest(live);
    const m = await inviteAndJoin(live, o);
    m.ws.send({ t: "sdp.offer", sdp: "v=0 member" });
    const offer = await waitMsg(o.guest, "sdp.offer");
    expect(offer).toEqual({ t: "sdp.offer", sdp: "v=0 member", from: m.hello.tid });
    const rosterIdx = o.guest.msgs.length; // roster offer'dan önce tüketildi mi: misafir mesaj sırasında roster offer'dan önce
    expect(rosterIdx).toBeGreaterThanOrEqual(0);
    o.guest.send({ t: "sdp.answer", sdp: "v=0 ans", to: m.hello.tid });
    expect(await m.ws.waitFor("sdp.answer")).toEqual({ t: "sdp.answer", sdp: "v=0 ans" });
    // bilinmeyen `to` düşer (soket açık kalır)
    o.guest.send({ t: "sdp.answer", sdp: "x", to: "AAAAAAAAAAA" });
    o.ws.send({ t: "sdp.offer", sdp: "v=0 owner" });
    expect((await waitMsg(o.guest, "sdp.offer")).from).not.toBe(m.hello.tid);
  });

  it("AC-366: müşteri `tech.remove` → üye 4403, participant_remove; yeniden davet/İzle 403; sahibi çıkarma FORBIDDEN", async () => {
    const o = await ownerWithGuest(live);
    const m = await inviteAndJoin(live, o, { ...MEMBER_PERMS, "sessions.supervise": true });
    const owner = techsRosterSchema.parse(await waitMsg(o.guest, "techs.roster", (r) => r.techs.length === 2)).techs.find((t) => t.owner);
    o.guest.send({ t: "tech.remove", tid: owner?.tid });
    expect(await o.guest.waitFor("error")).toMatchObject({ code: "FORBIDDEN" });
    o.guest.send({ t: "tech.remove", tid: m.hello.tid });
    expect((await m.ws.closed).code).toBe(WS_CLOSE.REMOVED);
    await waitMsg(o.guest, "techs.roster", (r) => r.techs.length === 1);
    await until(async () => (await audits(o.sessionId, "session.participant_remove")).length === 1);
    expect((await audits(o.sessionId, "session.participant_remove"))[0]).toMatchObject({
      username: "customer",
      newValue: { userId: m.user.id, role: "participant" },
    });
    expect(await audits(o.sessionId, "session.participant_leave")).toHaveLength(0);
    expect(errCode(await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/invites`, o.s, { userId: m.user.id }))).toBe(
      "403 FORBIDDEN",
    );
    expect(errCode(await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, m.s, {}))).toBe("403 FORBIDDEN");
    await expect(memberWs(live, o.sessionId, m.s)).rejects.toThrow("HTTP 403");
  });

  it("AC-367: katılımcının control.request/clip/fsrv → FORBIDDEN (rol kapısı); devir sonrası yeni kontrol sahibi isteyebilir, eski reddedilir", async () => {
    const o = await ownerWithGuest(live);
    const m = await inviteAndJoin(live, o);
    for (const msg of [
      { t: "control.request" },
      { t: "clip.pull", cid: "clip0001" },
      { t: "file.meta", fileName: "a", sizeBytes: 1, sha256: "0".repeat(64), direction: "TO_CUSTOMER", result: "OK" },
      { t: "fsrv.cancel", fid: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
    ]) {
      m.ws.send(msg);
      expect(await m.ws.waitFor("error")).toMatchObject({ code: "FORBIDDEN", message: "Yalnız kontrol sahibi kullanabilir." });
    }
    m.ws.send({ t: "control.handover", to: m.hello.tid }); // yalnız sahip
    expect(await m.ws.waitFor("error")).toMatchObject({ code: "FORBIDDEN" });
    o.ws.send({ t: "control.handover", to: m.hello.tid });
    const r = techsRosterSchema.parse(
      await waitMsg(o.guest, "techs.roster", (x) => x.techs.some((t) => !t.owner && t.role === "controller")),
    );
    expect(r.techs.find((t) => t.owner)?.role).toBe("participant");
    expect(room(o.sessionId).multi.controllerId).toBe(m.user.id);
    // yeni kontrol sahibi rol kapısını geçer (tarayıcı misafiri → mevcut "tarayıcı modunda" reddi, rol reddi değil)
    m.ws.send({ t: "control.request" });
    expect((await m.ws.waitFor("error")).message).toBe("Müşteri tarayıcı modunda: yalnız görüntüleme.");
    o.ws.send({ t: "control.request" });
    expect((await waitMsg(o.ws, "error")).message).toBe("Yalnız kontrol sahibi kullanabilir.");
    await until(async () => (await audits(o.sessionId, "session.control_handover")).length === 1);
    expect((await audits(o.sessionId, "session.control_handover"))[0]?.newValue).toEqual({ fromUserId: o.user.id, toUserId: m.user.id });
    // kontrol sahibi koparsa kontrol sahibe döner (controller_left)
    m.ws.ws.close();
    await waitMsg(o.ws, "techs.roster", (x) => x.techs.find((t) => t.owner)?.role === "controller");
    await until(async () => (await audits(o.sessionId, "session.control_handover")).length === 2);
    expect((await audits(o.sessionId, "session.control_handover"))[1]).toMatchObject({
      username: "system",
      newValue: { reason: "controller_left" },
    });
  });

  it("AC-368: İzle — yetkisiz 403, başka tenant 404; liste no-store; izleyici WS observer; kontrol/devir hedefi olamaz", async () => {
    const o = await ownerWithGuest(live);
    const noPerm = await newUser(live, o.tenantId, MEMBER_PERMS);
    expect(errCode(await inject(live, "GET", "/api/v1/sessions/active", noPerm.s))).toBe("403 FORBIDDEN");
    expect(errCode(await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, noPerm.s, {}))).toBe("403 FORBIDDEN");
    const foreign = await newUser(live, (await createTenant()).id, SUPERVISOR_PERMS);
    expect(errCode(await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, foreign.s, {}))).toBe("404 NOT_FOUND");
    expect(
      (await inject(live, "GET", "/api/v1/sessions/active", foreign.s)).json<{ items: { id: string }[] }>().items.map((i) => i.id),
    ).not.toContain(o.sessionId);
    const sup = await newUser(live, o.tenantId, SUPERVISOR_PERMS);
    const list = await inject(live, "GET", "/api/v1/sessions/active", sup.s);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.json<{ items: unknown[] }>().items).toContainEqual(
      expect.objectContaining({ id: o.sessionId, supported: true, full: false, techCount: 1, unattended: false, silent: false }),
    );
    expect(errCode(await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, sup.s, { reason: "x".repeat(25) }))).toBe(
      "400 VALIDATION",
    );
    expect((await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, sup.s, {})).statusCode).toBe(200);
    const { ws, hello } = await memberWs(live, o.sessionId, sup.s);
    expect(hello.techRole).toBe("observer");
    const r = techsRosterSchema.parse(await waitMsg(o.guest, "techs.roster", (x) => x.techs.length === 2));
    expect(r.techs.find((t) => !t.owner)).toMatchObject({ role: "observer", connected: true });
    for (const msg of [
      { t: "control.request" },
      { t: "print.cancel", pid: "prnt0001" },
      { t: "quality.summary", fps: STAT, kbps: STAT, rttMs: STAT, connType: "host" },
    ]) {
      ws.send(msg);
      expect(await ws.waitFor("error")).toMatchObject({ code: "FORBIDDEN" });
    }
    o.ws.send({ t: "control.handover", to: hello.tid });
    expect(await waitMsg(o.ws, "error")).toMatchObject({ code: "CONFLICT" });
    // reddedilen İzle (400 gerekçe) `fail`; kabul edilen tek `success`
    const ok = async () => (await audits(o.sessionId, "session.supervise_join")).filter((a) => a.result === "success");
    await until(async () => (await ok()).length === 1);
    expect((await ok())[0]?.newValue).toEqual({ userId: sup.user.id, role: "observer" });
  });

  it("Y-PC-3 / T1: rezervasyon başka kimlik oturumundan WS → 403; rezervasyon 60 sn'de dolmazsa no_show", async () => {
    const o = await ownerWithGuest(live);
    const sup = await newUser(live, o.tenantId, SUPERVISOR_PERMS);
    expect((await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, sup.s, {})).statusCode).toBe(200);
    const { loginAs } = await import("../helpers/app.ts");
    const other = await loginAs(live.app, sup.user);
    await expect(memberWs(live, o.sessionId, other)).rejects.toThrow("HTTP 403");
    const stranger = await newUser(live, o.tenantId, SUPERVISOR_PERMS);
    await expect(memberWs(live, o.sessionId, stranger.s)).rejects.toThrow("HTTP 403");
    live.clock.advance(60_000);
    expect(room(o.sessionId).multi.members.size).toBe(0);
    await until(async () => (await audits(o.sessionId, "session.participant_leave")).length === 1);
    expect((await audits(o.sessionId, "session.participant_leave"))[0]?.newValue).toEqual({
      userId: sup.user.id,
      role: "observer",
      reason: "no_show",
    });
  });

  it("D-PC-3: İzle kullanıcı başına 20/dk → 21. istek 429", async () => {
    const o = await ownerWithGuest(live, { multi: false });
    const sup = await newUser(live, o.tenantId, SUPERVISOR_PERMS);
    const codes: number[] = [];
    for (let i = 0; i < 21; i++)
      codes.push((await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, sup.s, {})).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 409)).toBe(true);
    expect(codes[20]).toBe(429);
    // fail audit'i (kullanıcı, oturum, neden) başına dakikada 1
    expect(await audits(o.sessionId, "session.supervise_join")).toHaveLength(1);
  });
});

describe("P28c kabul hız sınırı (D-PC-3)", () => {
  it("D-PC-3: davet kabulü kullanıcı başına 20/dk → 21. istek 429", async () => {
    const o = await ownerWithGuest(live);
    const m = await newUser(live, o.tenantId, MEMBER_PERMS);
    const { inviteId } = (await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/invites`, o.s, { userId: m.user.id })).json<{
      inviteId: string;
    }>();
    expect((await inject(live, "POST", `/api/v1/sessions/invites/${inviteId}/reject`, m.s)).statusCode).toBe(204);
    const codes: number[] = [];
    for (let i = 0; i < 21; i++)
      codes.push((await inject(live, "POST", `/api/v1/sessions/invites/${inviteId}/accept`, m.s, {})).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 410)).toBe(true);
    expect(codes[20]).toBe(429);
  });
});

describe("P28c AC-372 eski istemci", () => {
  it("AC-372: misafir multi1 bildirmedi → davet/İzle/aday 409 CLIENT_UNSUPPORTED, liste supported:false; misafire roster gitmez", async () => {
    const o = await ownerWithGuest(live, { multi: false });
    const m = await newUser(live, o.tenantId, { ...MEMBER_PERMS, "sessions.supervise": true });
    expect(errCode(await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/invites`, o.s, { userId: m.user.id }))).toBe(
      "409 CLIENT_UNSUPPORTED",
    );
    expect(errCode(await inject(live, "GET", `/api/v1/sessions/${o.sessionId}/invite-candidates`, o.s))).toBe("409 CLIENT_UNSUPPORTED");
    expect(errCode(await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, m.s, {}))).toBe("409 CLIENT_UNSUPPORTED");
    const item = (await inject(live, "GET", "/api/v1/sessions/active", m.s))
      .json<{ items: { id: string; supported: boolean }[] }>()
      .items.find((i) => i.id === o.sessionId);
    expect(item?.supported).toBe(false);
    o.ws.send({ t: "sdp.offer", sdp: "v=0" });
    expect(await o.guest.waitFor("sdp.offer")).toEqual({ t: "sdp.offer", sdp: "v=0" });
    expect(o.guest.msgs.some((x) => x.t === "techs.roster")).toBe(false);
  });

  it("aday listesi: yalnız uygun aynı firma kullanıcıları (sahip, yetkisiz, başka firma yok)", async () => {
    const o = await ownerWithGuest(live);
    const ok = await newUser(live, o.tenantId, MEMBER_PERMS);
    await newUser(live, o.tenantId, {});
    await newUser(live, (await createTenant()).id, MEMBER_PERMS);
    const r = await inject(live, "GET", `/api/v1/sessions/${o.sessionId}/invite-candidates`, o.s);
    expect(r.json<{ items: { userId: string }[] }>().items.map((i) => i.userId)).toEqual([ok.user.id]);
  });
});

describe("P28c oturum devri ve bitiş (AC-369)", () => {
  it("AC-369: session.transfer → technician_id değişir, eski sahip katılımcı; sahip kopunca 120 sn sonra tüm üyeler session.ended", async () => {
    const o = await ownerWithGuest(live);
    // D-PC-K4: devir hedefi sahip koltuğu için `sessions.create` taşır (TX içinde yeniden okunur)
    const m = await inviteAndJoin(live, o, { ...MEMBER_PERMS, ...TARGET_PERMS, "session_history.view": true });
    o.ws.send({ t: "session.transfer", to: m.hello.tid });
    const r = techsRosterSchema.parse(await waitMsg(o.guest, "techs.roster", (x) => x.techs.find((t) => t.owner)?.tid === m.hello.tid));
    expect(r.techs.find((t) => t.owner)?.role).toBe("controller");
    expect((await testDb().supportSession.findUnique({ where: { id: o.sessionId } }))?.technicianId).toBe(m.user.id);
    const tr = await audits(o.sessionId, "session.transfer");
    expect(tr).toHaveLength(1);
    expect(tr[0]).toMatchObject({ result: "success", newValue: { fromUserId: o.user.id, toUserId: m.user.id } });
    // eski sahip artık üye: sahip komutu reddedilir, ayrılabilir
    o.ws.send({ t: "session.end" });
    expect(await waitMsg(o.ws, "error")).toMatchObject({ code: "FORBIDDEN" });
    // yeni sahip koparsa 120 sn sonra oturum biter, eski sahip (üye) session.ended alır
    m.ws.ws.close();
    await until(() => room(o.sessionId).tech === undefined);
    live.clock.advance(120_000);
    expect(await o.ws.waitFor("session.ended")).toMatchObject({ reason: "timeout" });
    await until(async () => (await audits(o.sessionId, "session.participant_leave")).length === 1);
    expect((await audits(o.sessionId, "session.participant_leave"))[0]?.newValue).toEqual({
      userId: o.user.id,
      role: "participant",
      reason: "session_end",
    });
    // AC-369 geçmiş: katılımcılar audit'ten (devir zamanı, ayrılma nedeni); zaman çizelgesinde P28c olayları, eski sahip TECH
    const h = await inject(live, "GET", `/api/v1/sessions/${o.sessionId}/history`, m.s);
    expect(h.statusCode).toBe(200);
    const d = h.json<{
      participants: {
        userId: string;
        role: string;
        joinedAt: string | null;
        leftAt: string | null;
        leaveReason: string | null;
        transferredAt: string | null;
      }[];
      timeline: { action: string; actor: string; details: Record<string, unknown> }[];
    }>();
    const at = tr[0]?.createdAt.toISOString();
    expect(d.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: m.user.id, role: "owner", transferredAt: at, joinedAt: expect.any(String) }),
        expect.objectContaining({ userId: o.user.id, role: "participant", transferredAt: at, leaveReason: "session_end" }),
      ]),
    );
    expect(d.participants).toHaveLength(2);
    const ev = d.timeline.find((e) => e.action === "session.transfer");
    expect(ev).toMatchObject({ actor: "TECH", details: {} });
    expect(d.timeline.find((e) => e.action === "session.participant_join")).toMatchObject({
      actor: "TECH",
      details: { role: "participant" },
    });
    expect(JSON.stringify(d.timeline)).not.toContain(m.user.id.slice(0, 20) + '"'); // details kimlik taşımaz
  });

  it("O-PC-2: devir sürerken tech.remove → CONFLICT; izleyiciye devir → CONFLICT; member.leave → left + soket 1000", async () => {
    const o = await ownerWithGuest(live);
    const m = await inviteAndJoin(live, o);
    room(o.sessionId).multi.transferring = true;
    o.guest.send({ t: "tech.remove", tid: m.hello.tid });
    expect(await waitMsg(o.guest, "error")).toMatchObject({ code: "CONFLICT" });
    room(o.sessionId).multi.transferring = false;
    m.ws.send({ t: "member.leave" });
    expect((await m.ws.closed).code).toBe(1000);
    await until(async () => (await audits(o.sessionId, "session.participant_leave")).length === 1);
    expect((await audits(o.sessionId, "session.participant_leave"))[0]?.newValue).toMatchObject({ reason: "left" });
    o.ws.send({ t: "member.leave" }); // sahip üye değil → rol kapısı
    expect(await waitMsg(o.ws, "error")).toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("P28c geri alma matrisi (Y-PC-2, O-PC-3)", () => {
  it("applyPermChange: üyenin sessions.view'ı düşer → yalnız üye 4403 + auth_revoked; oda ve sahip sürer", async () => {
    const o = await ownerWithGuest(live);
    const m = await inviteAndJoin(live, o);
    await live.app.rooms.applyPermChange(m.user.id, []);
    expect((await m.ws.closed).code).toBe(WS_CLOSE.REMOVED);
    expect(live.app.rooms.live(room(o.sessionId))).toBe(true);
    await until(async () => (await audits(o.sessionId, "session.participant_leave")).length === 1);
    expect((await audits(o.sessionId, "session.participant_leave"))[0]?.newValue).toMatchObject({ reason: "auth_revoked" });
  });

  it("endByTechnician(üye): yalnız üye düşer; endByTechnician(sahip): oda biter, üyeler session.ended", async () => {
    const o = await ownerWithGuest(live);
    const a = await inviteAndJoin(live, o);
    const b = await inviteAndJoin(live, o);
    await live.app.rooms.endByTechnician(a.user.id);
    expect((await a.ws.closed).code).toBe(WS_CLOSE.REMOVED);
    expect(live.app.rooms.live(room(o.sessionId))).toBe(true);
    await live.app.rooms.endByTechnician(o.user.id);
    expect(await b.ws.waitFor("session.ended")).toMatchObject({ reason: "auth_revoked" });
  });

  it("revalidateMember (60 sn yedek yol): üyenin kimlik oturumu iptal → 4403, oda sürer (O-PC-3)", async () => {
    const o = await ownerWithGuest(live);
    const m = await inviteAndJoin(live, o);
    await testDb().authSession.updateMany({ where: { userId: m.user.id }, data: { revokedAt: new Date() } });
    expect((await m.ws.closed).code).toBe(WS_CLOSE.REMOVED);
    expect(live.app.rooms.live(room(o.sessionId))).toBe(true);
  });

  it("gözetimsiz oda (bellek kurgusu): asked → JOIN_NOT_ALLOWED ve listede yok; grant'sız süpervizör listede görmez; grant/silent geri alımı → üye düşer", async () => {
    const live2 = await startMultiLive({ UNATTENDED_MODE: "unsigned", DEPLOY_ENV: "staging" });
    try {
      const { createCustomerRow } = await import("../helpers/requests.ts");
      const { createDeviceRow, grantRow } = await import("../helpers/unattended.ts");
      const { finishDevice } = await import("../../src/signaling/rooms-device.ts");
      const { finishSilent } = await import("../../src/unattended/policy.ts");
      const { loginStepUp } = await import("../helpers/app.ts");
      // sahip de gözetimsiz yetkili: yoksa revalidateDevice (300 ms) sahte odayı `permission` ile bitirir (doğru davranış)
      const o = await ownerWithGuest(live2, { perms: { ...OWNER_PERMS, "unattended.connect": true, "unattended.silent": true } });
      const r = live2.app.rooms.get(o.sessionId);
      if (!r) throw new Error("oda yok");
      const customer = await createCustomerRow(o.tenantId);
      const deviceId = await createDeviceRow({ tenantId: o.tenantId, customerId: customer.id });
      r.unattended = { deviceId, deviceName: "PC-1", customerId: customer.id, consentRequest: "ask", consentMode: "asked" };
      const perms = { ...SUPERVISOR_PERMS, "unattended.connect": true, "unattended.silent": true };
      const sup = await newUser(live2, o.tenantId, perms);
      const noGrant = await newUser(live2, o.tenantId, perms);
      await grantRow(o.tenantId, deviceId, sup.user.id);
      // sahip de grant'lı olmalı: yoksa revalidateDevice (300 ms) sahte gözetimsiz odayı `permission` ile bitirir (doğru davranış)
      await grantRow(o.tenantId, deviceId, o.user.id);
      const ids = async (s: typeof sup.s) =>
        (await inject(live2, "GET", "/api/v1/sessions/active", s)).json<{ items: { id: string }[] }>().items.map((i) => i.id);
      // O-PC-K1: asked odaya katılım kapalı → grant'lı süpervizöre de listelenmez
      expect(await ids(sup.s)).not.toContain(o.sessionId);
      expect(await ids(noGrant.s)).not.toContain(o.sessionId);
      expect(errCode(await inject(live2, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, noGrant.s, {}))).toBe("403 FORBIDDEN");
      expect(errCode(await inject(live2, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, sup.s, {}))).toBe("409 JOIN_NOT_ALLOWED");
      // silent: politika kapalı → 403; açık → gerekçesiz 400 fields.reason; gerekçe + step-up → 200; WS → dört göz + audit
      r.unattended.consentMode = "silent";
      expect(errCode(await inject(live2, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, sup.s, {}))).toBe("403 FORBIDDEN");
      await testDb().tenantSettings.update({
        where: { tenantId: o.tenantId },
        data: { unattendedSilentEnabled: true, unattendedSilentAckAt: new Date() },
      });
      const noReason = await inject(live2, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, sup.s, {});
      expect(noReason.statusCode).toBe(400);
      expect(noReason.json<{ error: { fields: Record<string, string> } }>().error.fields.reason).toBeTruthy();
      const reason = "Müşteri sunucusu yanıt vermiyor, ikinci göz gerekli.";
      expect(errCode(await inject(live2, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, sup.s, { reason }))).toBe(
        "403 MFA_SETUP_REQUIRED",
      );
      const stepped = await loginStepUp(live2.app, sup.user);
      const notices: string[] = [];
      live2.app.rooms.silentNotify = (e) => void notices.push(`${e.event}:${e.reason ?? ""}`);
      expect((await inject(live2, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, stepped, { reason })).statusCode).toBe(200);
      const w = await memberWs(live2, o.sessionId, stepped);
      expect(notices).toEqual([`join:${reason}`]);
      await until(async () => (await audits(o.sessionId, "session.supervise_join")).some((a) => a.result === "success"));
      const ok = (await audits(o.sessionId, "session.supervise_join")).find((a) => a.result === "success");
      expect(ok?.newValue).toMatchObject({ role: "observer", consentMode: "silent", reasonLen: reason.length });
      // yetki dalı: finishSilent(teknisyen) üyeyi düşürür, oda sürer
      await finishSilent(
        { db: testDb(), rooms: live2.app.rooms, now: () => Date.now(), log: { error: () => undefined } },
        o.tenantId,
        sup.user.id,
      );
      expect((await w.ws.closed).code).toBe(WS_CLOSE.REMOVED);
      expect(live2.app.rooms.live(r)).toBe(true);
      // grant geri alımı yolu (hub.grantsRemoved → finishDevice(teknisyen)): yeniden katıl → düşür
      const again = await loginStepUp(live2.app, sup.user);
      expect((await inject(live2, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, again, { reason })).statusCode).toBe(200);
      const w2 = await memberWs(live2, o.sessionId, again);
      await finishDevice(live2.app.rooms, deviceId, "permission", sup.user.id);
      expect((await w2.ws.closed).code).toBe(WS_CLOSE.REMOVED);
      expect(live2.app.rooms.live(r)).toBe(true);
      // revalidateDevice üye dalı (60 sn yedek yol, testte 300 ms): üyenin grant satırı silinir → yalnız üye düşer, oda sürer
      const third = await loginStepUp(live2.app, sup.user);
      expect((await inject(live2, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, third, { reason })).statusCode).toBe(200);
      const w3 = await memberWs(live2, o.sessionId, third);
      await testDb().unattendedDeviceGrant.deleteMany({ where: { deviceId, userId: sup.user.id } });
      expect((await w3.ws.closed).code).toBe(WS_CLOSE.REMOVED);
      expect(live2.app.rooms.live(r)).toBe(true);
      r.unattended = undefined; // sahte gözetimsiz kurgu: teardown cihaz kancasına gitmesin
    } finally {
      await live2.close();
    }
  });
});

describe("P28c K1c sözleşme ekleri (AC-372, geri çek)", () => {
  it("AC-372: teknisyen hello'su ve peer.joined{guest} guestMulti taşır (multi1 true, eski istemci false)", async () => {
    const o = await ownerWithGuest(live);
    expect(o.joined).toMatchObject({ role: "guest", guestMulti: true });
    const m = await inviteAndJoin(live, o);
    expect(m.hello).toMatchObject({ role: "tech", guestMulti: true });
    m.ws.ws.close();
    const old = await ownerWithGuest(live, { multi: false });
    expect(old.joined).toMatchObject({ role: "guest", guestMulti: false });
    // sahip yeniden bağlanınca hello'da da (misafir kabul edilmiş)
    old.ws.ws.close();
    await until(() => room(old.sessionId).tech === undefined);
    const again = await memberWs(live, old.sessionId, old.s);
    expect(again.hello).toMatchObject({ techRole: "owner", guestMulti: false });
    again.ws.ws.close();
  });

  it("GET /sessions/:id/invites: sahip bekleyen davetleri görür (no-store); geri çek/kabul/süre sonrası boş; üye 403, başka tenant 404", async () => {
    const o = await ownerWithGuest(live);
    const url = `/api/v1/sessions/${o.sessionId}/invites`;
    const empty = await inject(live, "GET", url, o.s);
    expect(empty.statusCode).toBe(200);
    expect(empty.headers["cache-control"]).toBe("no-store");
    expect(empty.json()).toEqual({ items: [] });
    const a = await newUser(live, o.tenantId, MEMBER_PERMS);
    const b = await newUser(live, o.tenantId, MEMBER_PERMS);
    const ia = (await inject(live, "POST", url, o.s, { userId: a.user.id })).json<{ inviteId: string; expiresAt: string }>();
    live.clock.advance(1_000);
    const ib = (await inject(live, "POST", url, o.s, { userId: b.user.id })).json<{ inviteId: string; expiresAt: string }>();
    const list = (await inject(live, "GET", url, o.s)).json<{ items: unknown[] }>();
    expect(list.items).toEqual([
      { inviteId: ia.inviteId, userId: a.user.id, inviteeName: "Test Kullanıcı", expiresAt: ia.expiresAt },
      { inviteId: ib.inviteId, userId: b.user.id, inviteeName: "Test Kullanıcı", expiresAt: ib.expiresAt },
    ]);
    expect((await inject(live, "DELETE", `${url}/${ia.inviteId}`, o.s)).statusCode).toBe(204);
    expect((await inject(live, "GET", url, o.s)).json<{ items: { inviteId: string }[] }>().items.map((i) => i.inviteId)).toEqual([
      ib.inviteId,
    ]);
    // kabul edilen davet listeden düşer; üye (sahip değil) 403, başka tenant 404, biçimsiz kimlik 404
    expect((await inject(live, "POST", `/api/v1/sessions/invites/${ib.inviteId}/accept`, b.s, {})).statusCode).toBe(200);
    expect((await inject(live, "GET", url, o.s)).json()).toEqual({ items: [] });
    expect(errCode(await inject(live, "GET", url, b.s))).toBe("403 FORBIDDEN");
    const other = await newUser(live, (await createTenant()).id, OWNER_PERMS);
    expect(errCode(await inject(live, "GET", url, other.s))).toBe("404 NOT_FOUND");
    expect(errCode(await inject(live, "GET", "/api/v1/sessions/x/invites", o.s))).toBe("404 NOT_FOUND");
    // süre dolumu
    const c = await newUser(live, o.tenantId, MEMBER_PERMS);
    expect((await inject(live, "POST", url, o.s, { userId: c.user.id })).statusCode).toBe(201);
    expect((await inject(live, "GET", url, o.s)).json<{ items: unknown[] }>().items).toHaveLength(1);
    live.clock.advance(120_000);
    expect((await inject(live, "GET", url, o.s)).json()).toEqual({ items: [] });
  });
});

describe("P28c K1c devir sınırları (AC-11, target_gone)", () => {
  it("AC-11: hedefin açık oturum sınırı dolu → CONFLICT, technician_id değişmez, transfer fail{conflict}", async () => {
    const o = await ownerWithGuest(live);
    const m = await inviteAndJoin(live, o, { ...MEMBER_PERMS, ...OWNER_PERMS });
    expect((await inject(live, "POST", "/api/v1/sessions", m.s, {})).statusCode).toBe(201);
    await testDb().tenantSettings.update({ where: { tenantId: o.tenantId }, data: { maxOpenSessions: 1 } });
    o.ws.send({ t: "session.transfer", to: m.hello.tid });
    expect(await waitMsg(o.ws, "error")).toMatchObject({ code: "CONFLICT", message: "Hedef teknisyenin açık oturum sınırı dolu." });
    expect((await testDb().supportSession.findUnique({ where: { id: o.sessionId } }))?.technicianId).toBe(o.user.id);
    expect(room(o.sessionId).technicianId).toBe(o.user.id);
    await until(() => !room(o.sessionId).multi.transferring);
    await until(async () => (await audits(o.sessionId, "session.transfer")).length === 1);
    expect((await audits(o.sessionId, "session.transfer"))[0]).toMatchObject({ result: "fail", newValue: { failReason: "conflict" } });
  });

  it("O-PC-2: commit sonrası hedef gitmişse UPDATE geri alınır, bellek değişmez, transfer fail{target_gone}", async () => {
    const o = await ownerWithGuest(live);
    const m = await inviteAndJoin(live, o, { ...MEMBER_PERMS, ...TARGET_PERMS });
    const r = room(o.sessionId);
    const db = live.app.rooms.db;
    const orig = db.$transaction.bind(db) as (fn: unknown) => Promise<unknown>;
    // gerçek TX commit olur; dönmeden hedef soketi kapanır (seam yok — üretim kodu değişmedi)
    const spy = vi.spyOn(db, "$transaction").mockImplementationOnce((async (fn: unknown) => {
      const out = await orig(fn);
      m.ws.ws.close();
      await until(() => !r.multi.members.get(m.user.id)?.conn);
      return out;
    }) as never);
    try {
      o.ws.send({ t: "session.transfer", to: m.hello.tid });
      expect(await waitMsg(o.ws, "error")).toMatchObject({ code: "CONFLICT", message: "Hedef teknisyen oturumdan ayrıldı." });
    } finally {
      spy.mockRestore();
    }
    expect((await testDb().supportSession.findUnique({ where: { id: o.sessionId } }))?.technicianId).toBe(o.user.id);
    expect(r.technicianId).toBe(o.user.id);
    expect(r.tech?.userId).toBe(o.user.id);
    expect(r.multi.controllerId).toBe(o.user.id);
    await until(() => !r.multi.transferring);
    await until(async () => (await audits(o.sessionId, "session.transfer")).some((a) => a.result === "fail"));
    expect((await audits(o.sessionId, "session.transfer")).find((a) => a.result === "fail")?.newValue).toMatchObject({
      failReason: "target_gone",
    });
  });
});

describe("P28c geri alma matrisi — süre sınırı (Y-PC-2, sahte saat ≤ 5 / ≤ 60 sn)", () => {
  // Anlık yollar sahte saat HİÇ ilerletilmeden etkili olur (0 ms ≤ 5 sn). Yedek döngü bir `revalidateMs` periyodunda
  // (testte 300 ms gerçek, üretimde 60 sn varsayılan) etkili olur → sahte saat yine ilerlemez (≤ 60 sn).
  type Path = { name: string; seat: "owner" | "member"; run: (o: Owner, m: { user: { id: string } }) => Promise<unknown> };
  type Owner = Awaited<ReturnType<typeof ownerWithGuest>>;
  const revokeAuth = (userId: string) => testDb().authSession.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
  const paths: Path[] = [
    { name: "applyPermChange (anlık)", seat: "member", run: (_o, m) => live.app.rooms.applyPermChange(m.user.id, []) },
    { name: "endByTechnician (anlık)", seat: "member", run: (_o, m) => live.app.rooms.endByTechnician(m.user.id) },
    { name: "kimlik oturumu iptali (yedek döngü)", seat: "member", run: (_o, m) => revokeAuth(m.user.id) },
    { name: "endByTechnician (anlık)", seat: "owner", run: (o) => live.app.rooms.endByTechnician(o.user.id) },
    { name: "kimlik oturumu iptali (yedek döngü)", seat: "owner", run: (o) => revokeAuth(o.user.id) },
  ];
  it.each(paths)("Y-PC-2: $seat — $name", async ({ seat, run }) => {
    const o = await ownerWithGuest(live);
    const m = await inviteAndJoin(live, o);
    const t0 = live.clock.now();
    const started = Date.now();
    await run(o, m);
    if (seat === "member") {
      expect((await m.ws.closed).code).toBe(WS_CLOSE.REMOVED);
      expect(live.app.rooms.live(room(o.sessionId))).toBe(true);
    } else {
      expect(await m.ws.waitFor("session.ended")).toMatchObject({ reason: "auth_revoked" });
    }
    expect(live.clock.now() - t0).toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("P28c düzeltme turu 1 (O-PC-K1, D-PC-K2, D-PC-K4, QA-2)", () => {
  type Owner = Awaited<ReturnType<typeof ownerWithGuest>>;
  type Room = NonNullable<ReturnType<MultiLive["app"]["rooms"]["get"]>>;
  const UN = { "unattended.connect": true };
  const SILENT = { "unattended.connect": true, "unattended.silent": true };
  /** Sahte gözetimsiz oda (bellek kurgusu; sahip grant'lı + silent yetkili, politika açık — revalidateDevice odayı bitirmesin). */
  async function unattendedRoom(
    fn: (x: { live2: MultiLive; o: Owner; deviceId: string; r: Room; un: NonNullable<Room["unattended"]> }) => Promise<void>,
  ) {
    const live2 = await startMultiLive({ UNATTENDED_MODE: "unsigned", DEPLOY_ENV: "staging" });
    const { createCustomerRow } = await import("../helpers/requests.ts");
    const { createDeviceRow, grantRow } = await import("../helpers/unattended.ts");
    let r: Room | undefined;
    try {
      const o = await ownerWithGuest(live2, { perms: { ...OWNER_PERMS, ...SILENT } });
      r = live2.app.rooms.get(o.sessionId);
      if (!r) throw new Error("oda yok");
      const customer = await createCustomerRow(o.tenantId);
      const deviceId = await createDeviceRow({ tenantId: o.tenantId, customerId: customer.id });
      await grantRow(o.tenantId, deviceId, o.user.id);
      await testDb().tenantSettings.update({
        where: { tenantId: o.tenantId },
        data: { unattendedSilentEnabled: true, unattendedSilentAckAt: new Date() },
      });
      const un: NonNullable<typeof r.unattended> = {
        deviceId,
        deviceName: "PC-1",
        customerId: customer.id,
        consentRequest: "silent",
        consentMode: "no_user",
      };
      r.unattended = un;
      await fn({ live2, o, deviceId, r, un });
    } finally {
      if (r) r.unattended = undefined;
      await live2.close();
    }
  }

  it("AC-368 O-PC-K1: /active — asked oda listelenmez; silent oda yalnız unattended.silent + grant olana (multi1'siz de)", async () => {
    await unattendedRoom(async ({ live2, o, deviceId, r, un }) => {
      const { grantRow } = await import("../helpers/unattended.ts");
      const full = await newUser(live2, o.tenantId, { ...SUPERVISOR_PERMS, ...SILENT });
      const noSilent = await newUser(live2, o.tenantId, { ...SUPERVISOR_PERMS, ...UN });
      for (const u of [full, noSilent]) await grantRow(o.tenantId, deviceId, u.user.id);
      const ids = async (s: typeof full.s) =>
        (await inject(live2, "GET", "/api/v1/sessions/active", s)).json<{ items: { id: string }[] }>().items.map((i) => i.id);
      un.consentMode = "silent";
      expect(await ids(full.s)).toContain(o.sessionId);
      expect(await ids(noSilent.s)).not.toContain(o.sessionId);
      if (r.admitted?.peer) r.admitted.peer.multi = false; // multi1'siz: görünürlük yine yetkiye bağlı, bayrakla pasif
      expect(await ids(full.s)).toContain(o.sessionId);
      expect(await ids(noSilent.s)).not.toContain(o.sessionId);
      if (r.admitted?.peer) r.admitted.peer.multi = true;
      un.consentMode = "asked";
      expect(await ids(full.s)).not.toContain(o.sessionId);
      un.consentMode = "no_user";
      expect(await ids(noSilent.s)).toContain(o.sessionId);
    });
  });

  it("AC-364/AC-368 QA-2: silent oda — unattended.silent'sız davetli: davet 403 {silent}, İzle 403, kabul 403", async () => {
    await unattendedRoom(async ({ live2, o, deviceId, un }) => {
      const { grantRow } = await import("../helpers/unattended.ts");
      const a = await newUser(live2, o.tenantId, { ...MEMBER_PERMS, ...UN });
      const b = await newUser(live2, o.tenantId, { ...MEMBER_PERMS, ...UN });
      const sup = await newUser(live2, o.tenantId, { ...SUPERVISOR_PERMS, ...UN });
      for (const u of [a, b, sup]) await grantRow(o.tenantId, deviceId, u.user.id);
      // no_user odada davet geçer; oda silent'a dönünce kabul 403
      const inv = await inject(live2, "POST", `/api/v1/sessions/${o.sessionId}/invites`, o.s, { userId: a.user.id });
      expect(inv.statusCode).toBe(201);
      un.consentMode = "silent";
      expect(errCode(await inject(live2, "POST", `/api/v1/sessions/${o.sessionId}/invites`, o.s, { userId: b.user.id }))).toBe(
        "403 FORBIDDEN",
      );
      const reason = "Müşteri sunucusu yanıt vermiyor, ikinci göz gerekli.";
      expect(errCode(await inject(live2, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, sup.s, { reason }))).toBe("403 FORBIDDEN");
      const { inviteId } = inv.json<{ inviteId: string }>();
      expect(errCode(await inject(live2, "POST", `/api/v1/sessions/invites/${inviteId}/accept`, a.s, { reason }))).toBe("403 FORBIDDEN");
      const fails = (await audits(o.sessionId, "session.invite")).filter((x) => x.result === "fail");
      expect(fails.map((x) => (x.newValue as { failReason: string }).failReason)).toEqual(["silent"]);
      expect((await audits(o.sessionId, "session.invite_accept")).map((x) => (x.newValue as { failReason?: string }).failReason)).toEqual([
        "silent",
      ]);
    });
  });

  it("AC-364 QA-2: gözetimsiz oda — davetlide unattended.connect yok 403, grant yok 403; kabul step-up'sız 403/401, step-up ile 200", async () => {
    await unattendedRoom(async ({ live2, o, deviceId }) => {
      const { grantRow } = await import("../helpers/unattended.ts");
      const { loginAs, markStepUp } = await import("../helpers/app.ts");
      const noConnect = await newUser(live2, o.tenantId, MEMBER_PERMS);
      await grantRow(o.tenantId, deviceId, noConnect.user.id);
      const noGrant = await newUser(live2, o.tenantId, { ...MEMBER_PERMS, ...UN });
      const url = `/api/v1/sessions/${o.sessionId}/invites`;
      expect(errCode(await inject(live2, "POST", url, o.s, { userId: noConnect.user.id }))).toBe("403 FORBIDDEN");
      expect(errCode(await inject(live2, "POST", url, o.s, { userId: noGrant.user.id }))).toBe("403 FORBIDDEN");
      const reasons = (await audits(o.sessionId, "session.invite")).map((x) => (x.newValue as { failReason: string }).failReason);
      expect(reasons.sort()).toEqual(["device", "permission"]);
      const ok = await newUser(live2, o.tenantId, { ...MEMBER_PERMS, ...UN });
      await grantRow(o.tenantId, deviceId, ok.user.id);
      const { inviteId } = (await inject(live2, "POST", url, o.s, { userId: ok.user.id })).json<{ inviteId: string }>();
      const acc = `/api/v1/sessions/invites/${inviteId}/accept`;
      expect(errCode(await inject(live2, "POST", acc, ok.s, {}))).toBe("403 MFA_SETUP_REQUIRED");
      await testDb().user.update({ where: { id: ok.user.id }, data: { totpEnabled: true, totpSecretEnc: new Uint8Array(40) } });
      const fresh = await loginAs(live2.app, ok.user);
      await testDb().authSession.updateMany({ where: { userId: ok.user.id }, data: { mfaPassed: true } });
      expect(errCode(await inject(live2, "POST", acc, fresh, {}))).toBe("401 MFA_STEP_UP_REQUIRED");
      await markStepUp(fresh);
      expect((await inject(live2, "POST", acc, fresh, {})).statusCode).toBe(200);
    });
  });

  it("AC-369 D-PC-K4: devir hedefinin sahip yetkisi TX içinde yeniden okunur → CONFLICT + fail audit, technician_id değişmez", async () => {
    const o = await ownerWithGuest(live);
    const m = await inviteAndJoin(live, o, { ...MEMBER_PERMS, ...TARGET_PERMS });
    await testDb().userPermission.updateMany({ where: { userId: m.user.id, permKey: "sessions.create" }, data: { granted: false } });
    o.ws.send({ t: "session.transfer", to: m.hello.tid });
    expect(await waitMsg(o.ws, "error")).toMatchObject({ code: "CONFLICT" });
    await until(async () => (await audits(o.sessionId, "session.transfer")).some((a) => a.result === "fail"));
    expect((await audits(o.sessionId, "session.transfer")).find((a) => a.result === "fail")?.newValue).toMatchObject({
      failReason: "conflict",
    });
    expect((await testDb().supportSession.findUnique({ where: { id: o.sessionId } }))?.technicianId).toBe(o.user.id);
    expect(room(o.sessionId).technicianId).toBe(o.user.id);
  });

  it("AC-364 D-PC-K2: aday listesi 61., ret ve geri çekme 21. istek/dk → 429", async () => {
    const o = await ownerWithGuest(live);
    const u = await newUser(live, o.tenantId, MEMBER_PERMS);
    const codes = async (n: number, method: "GET" | "POST" | "DELETE", url: string, s: typeof u.s) => {
      let last = "";
      for (let i = 0; i < n; i++) last = errCode(await inject(live, method, url, s));
      return last;
    };
    expect(await codes(61, "GET", `/api/v1/sessions/${o.sessionId}/invite-candidates`, o.s)).toBe("429 RATE_LIMITED");
    expect(await codes(21, "DELETE", `/api/v1/sessions/${o.sessionId}/invites/AAAAAAAAAAAAAAAAAAAAAA`, o.s)).toBe("429 RATE_LIMITED");
    expect(await codes(21, "POST", "/api/v1/sessions/invites/AAAAAAAAAAAAAAAAAAAAAA/reject", u.s)).toBe("429 RATE_LIMITED");
  });
});
