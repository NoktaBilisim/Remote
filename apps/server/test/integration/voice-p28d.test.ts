// P28d K1 sunucu entegrasyon testleri (mimari-p28d r2 §4, §6, §9; AC-373..379). Gerçek sunucu + MySQL; oda saati sahte
// (60 sn istek, 30 sn bekleme, süre). Varsayılan misafir tarayıcı (`hasVoice` destekli); eski / voice1 AGENT ayrı. Her alınan
// `voice.state` sözleşme şemasından geçirilir (`talkers ⊆ listeners` refine'ı dahil).
import type { PermissionKey } from "@remote/contracts/permissions";
import { WS_CLOSE } from "@remote/contracts/ws";
import { WS_CAP_VOICE, CALL_ID_PATTERN, voiceStateSchema, type VoiceStateMessage } from "@remote/contracts/ws-voice";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ORIGIN } from "../helpers/app.ts";
import {
  audits,
  inject,
  inviteAndJoin,
  MEMBER_PERMS,
  memberWs,
  newUser,
  OWNER_PERMS,
  ownerWithGuest,
  startMultiLive,
  SUPERVISOR_PERMS,
  tick,
  until,
  waitMsg,
  type MultiLive,
  type Owner,
} from "../helpers/multi.ts";
import { connect, type WsClient } from "../helpers/ws.ts";
import { guestVoiceOf } from "../../src/signaling/voice.ts";

let live: MultiLive;
beforeAll(async () => {
  live = await startMultiLive();
});
afterAll(async () => {
  await live.close();
});

const V = { "sessions.voice": true };
const OWNER_V = { ...OWNER_PERMS, ...V };
const MEMBER_V = { ...MEMBER_PERMS, ...V };
const room = (id: string) => {
  const r = live.app.rooms.get(id);
  if (!r) throw new Error("oda yok");
  return r;
};

/** Koşula uyan sonraki `voice.state` (şema denetimli). */
async function state(c: WsClient, pred: (m: VoiceStateMessage) => boolean = () => true): Promise<VoiceStateMessage> {
  const m = await waitMsg(c, "voice.state", (x) => pred(voiceStateSchema.parse(x)));
  return voiceStateSchema.parse(m);
}
const errorOf = (c: WsClient) => waitMsg(c, "error");
/** Kuyruğu boşaltır (sonraki "yayın yok" denetimi için). */
const drain = (c: WsClient): void => void c.msgs.splice(0);
const voiceMsgs = (c: WsClient) => c.msgs.filter((m) => m.t.startsWith("voice."));
const tidOf = (o: Owner, userId: string) => live.app.rooms.get(o.sessionId)?.multi.tids.get(userId) ?? "";

/** İstek → misafir kabul → active (konuşan sahip). */
async function call(o: Owner): Promise<string> {
  o.ws.send({ t: "voice.request" });
  const req = await waitMsg(o.guest, "voice.request");
  o.guest.send({ t: "voice.answer", callId: req.callId, accept: true });
  await state(o.ws, (s) => s.phase === "active");
  return req.callId;
}

describe("P28d istek, zaman aşımı, bekleme (AC-373)", () => {
  it("AC-373: sessions.voice yok → FORBIDDEN; istek → misafire voice.request{callId 22, by} + pending; ikinci → CONFLICT", async () => {
    const no = await ownerWithGuest(live);
    no.ws.send({ t: "voice.request" });
    expect(await errorOf(no.ws)).toMatchObject({ code: "FORBIDDEN" });
    const o = await ownerWithGuest(live, { perms: OWNER_V });
    expect(o.joined).toMatchObject({ guestVoice: true });
    expect(await state(o.guest)).toEqual({ t: "voice.state", phase: "idle", talkers: [], listeners: [] }); // hello + roster sonrası
    o.ws.send({ t: "voice.request" });
    const req = await waitMsg(o.guest, "voice.request");
    expect(req.callId).toMatch(CALL_ID_PATTERN);
    expect(req.by).toBe(tidOf(o, o.user.id));
    const pending = await state(o.ws, (s) => s.phase === "pending");
    expect(pending).toMatchObject({ callId: req.callId, by: req.by, talkers: [] });
    // misafir de pending alır (web: "dinleyecek" listesi + duyuru tabanı)
    expect(await state(o.guest, (s) => s.phase === "pending")).toEqual({
      t: "voice.state",
      phase: "pending",
      callId: req.callId,
      by: req.by,
      talkers: [],
      listeners: [req.by],
    });
    o.ws.send({ t: "voice.request" });
    expect(await errorOf(o.ws)).toMatchObject({ code: "CONFLICT" });
    await until(async () => (await audits(o.sessionId, "voice.request")).length === 1);
    expect((await audits(o.sessionId, "voice.request"))[0]).toMatchObject({ userId: o.user.id, result: "success", newValue: {} });
  });

  it("AC-373: 60 sn yanıtsız → reject{timeout} + idle{timeout}; 30 sn bekleme RATE_LIMITED; ret ve müşteri bitişi de bekletir", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V });
    o.ws.send({ t: "voice.request" });
    const { callId } = await waitMsg(o.guest, "voice.request");
    live.clock.advance(60_000);
    // hello sonrası ilk idle (callId'siz) kuyrukta: bitişi callId ile seç
    expect(await state(o.guest, (s) => s.phase === "idle" && s.callId === callId)).toMatchObject({ endReason: "timeout" });
    await until(async () => (await audits(o.sessionId, "voice.reject")).length === 1);
    expect((await audits(o.sessionId, "voice.reject"))[0]).toMatchObject({ result: "fail", newValue: { reason: "timeout" } });
    o.ws.send({ t: "voice.request" });
    expect(await errorOf(o.ws)).toMatchObject({ code: "RATE_LIMITED" });
    live.clock.advance(30_000);
    o.ws.send({ t: "voice.request" });
    const r2 = await waitMsg(o.guest, "voice.request");
    o.guest.send({ t: "voice.answer", callId: r2.callId, accept: false });
    expect(await state(o.ws, (s) => s.phase === "idle" && s.callId === r2.callId)).toMatchObject({ endReason: "customer" });
    o.ws.send({ t: "voice.request" });
    expect(await errorOf(o.ws)).toMatchObject({ code: "RATE_LIMITED" });
    live.clock.advance(30_000);
    const c3 = await call(o);
    o.guest.send({ t: "voice.end", callId: c3, reason: "customer" });
    expect(await state(o.ws, (s) => s.phase === "idle" && s.callId === c3)).toMatchObject({ endReason: "customer" });
    o.ws.send({ t: "voice.request" });
    expect(await errorOf(o.ws)).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("AC-373: oturumda en çok 10 istek → 11. RATE_LIMITED (teknisyen bitişi beklemesiz)", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V });
    for (let i = 0; i < 10; i++) {
      const callId = await call(o);
      o.ws.send({ t: "voice.end", callId });
      await state(o.ws, (s) => s.phase === "idle" && s.endReason === "tech");
    }
    o.ws.send({ t: "voice.request" });
    expect(await errorOf(o.ws)).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("AC-373 D-PD-2: sahte/bayat callId sessiz düşer; idle'da voice.end ve tekrar voice.join yayın üretmez; WS oran sınırı voice.*'ı kapsar", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V });
    const m = await inviteAndJoin(live, o, MEMBER_V);
    await state(m.ws); // üyeye bağlanınca güncel (idle) durum
    o.ws.send({ t: "voice.end", callId: "A".repeat(22) }); // idle: no-op
    o.ws.send({ t: "voice.request" });
    const { callId } = await waitMsg(o.guest, "voice.request");
    o.guest.send({ t: "voice.answer", callId: "B".repeat(22), accept: true }); // sahte callId → düşer
    await tick(150);
    expect(room(o.sessionId).voice.phase).toBe("pending");
    o.guest.send({ t: "voice.answer", callId, accept: true });
    await state(m.ws, (s) => s.phase === "active");
    m.ws.send({ t: "voice.join", callId });
    await state(m.ws, (s) => s.talkers.length === 2);
    await state(o.guest, (s) => s.talkers.length === 2); // misafirin kopyası da gelsin (drain yarışı)
    drain(m.ws);
    drain(o.guest);
    m.ws.send({ t: "voice.join", callId }); // zaten konuşan
    o.guest.send({ t: "voice.end", callId: "C".repeat(22), reason: "customer" }); // sahte
    await tick(200);
    expect(voiceMsgs(m.ws)).toHaveLength(0);
    expect(voiceMsgs(o.guest)).toHaveLength(0);
    expect(room(o.sessionId).voice.phase).toBe("active");
    expect(live.app.metrics.render()).toMatch(/rs_voice_denied_total\{code="stale_call"\} [1-9]/);
    // D-PD-2: soket başına 50 mesaj/sn kovası voice.*'ı da sayar → 1008
    for (let i = 0; i < 60; i++) m.ws.send({ t: "voice.join", callId });
    expect((await m.ws.closed).code).toBe(WS_CLOSE.POLICY);
  });
});

describe("P28d görüşme, kopma, bitiş (AC-374, V-PD-5, V-PD-7)", () => {
  it("AC-374 + AC-379: kabul → active{talkers:[sahip], listeners}; teknisyen bitirir → idle{tech}; audit end alanları + durationSec", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V });
    o.ws.send({ t: "voice.request" });
    const { callId } = await waitMsg(o.guest, "voice.request");
    o.guest.send({ t: "voice.answer", callId, accept: true });
    const own = tidOf(o, o.user.id);
    expect(await state(o.guest, (s) => s.phase === "active")).toEqual({
      t: "voice.state",
      phase: "active",
      callId,
      by: own,
      talkers: [own],
      listeners: [own],
    });
    expect(live.app.metrics.render()).toMatch(/^rs_voice_active [1-9]/m);
    live.clock.advance(192_000);
    o.ws.send({ t: "voice.end", callId });
    expect(await state(o.guest, (s) => s.phase === "idle")).toEqual({
      t: "voice.state",
      phase: "idle",
      callId,
      endReason: "tech",
      talkers: [],
      listeners: [],
    });
    await until(async () => (await audits(o.sessionId, "voice.end")).length === 1);
    expect((await audits(o.sessionId, "voice.accept"))[0]).toMatchObject({ username: "customer", newValue: {} });
    expect((await audits(o.sessionId, "voice.end"))[0]).toMatchObject({
      userId: o.user.id,
      result: "success",
      newValue: { durationSec: 192, reason: "tech", talkerIds: [o.user.id], listenerIds: [o.user.id] },
    });
    expect(live.app.metrics.render()).toMatch(/rs_voice_calls_total\{result="accepted"\} [1-9]/);
  });

  it("V-PD-7: misafir WS kopar → anında end{disconnect}; pending'de kopar → reject{disconnect}; yeniden bağlanan misafir idle alır, yeni istek gerekir", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V });
    const token = o.guestHello.reconnectToken ?? "";
    await call(o);
    o.guest.ws.close();
    expect(await state(o.ws, (s) => s.phase === "idle")).toMatchObject({ endReason: "disconnect" });
    await until(async () => (await audits(o.sessionId, "voice.end")).length === 1);
    expect((await audits(o.sessionId, "voice.end"))[0]?.newValue).toMatchObject({ reason: "disconnect" });
    const g2 = await connect(`${live.base}/ws/guest`, ["rs.v1", `rs.reconnect.${token}`, "rs.cap.multi1"], { origin: ORIGIN });
    await g2.waitFor("hello");
    expect(await state(g2)).toEqual({ t: "voice.state", phase: "idle", talkers: [], listeners: [] });
    o.ws.send({ t: "voice.request" }); // bekleme yok (disconnect)
    await waitMsg(g2, "voice.request");
    g2.ws.close();
    expect(await state(o.ws, (s) => s.phase === "idle")).toMatchObject({ endReason: "disconnect" });
    await until(async () => (await audits(o.sessionId, "voice.reject")).length === 1);
    expect((await audits(o.sessionId, "voice.reject"))[0]?.newValue).toEqual({ reason: "disconnect" });
  });

  it("V-PD-5: konuşan katılımcının soketi düşer → konuşanlardan hemen çıkar (pay sesi korumaz); son konuşan gidince left", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V });
    const m = await inviteAndJoin(live, o, MEMBER_V);
    const callId = await call(o);
    m.ws.send({ t: "voice.join", callId });
    const a = tidOf(o, m.user.id);
    await state(o.guest, (s) => s.talkers.includes(a));
    m.ws.ws.close();
    expect(await state(o.guest, (s) => !s.listeners.includes(a))).toMatchObject({ phase: "active", talkers: [tidOf(o, o.user.id)] });
    expect(room(o.sessionId).multi.members.has(m.user.id)).toBe(true); // 120 sn üyelik payı sürer
    const back = await memberWs(live, o.sessionId, m.s);
    expect(await state(back.ws)).toMatchObject({ phase: "active", talkers: [tidOf(o, o.user.id)] }); // yeniden katılmalı
    o.ws.send({ t: "voice.end", callId });
    await state(o.guest, (s) => s.phase === "idle");
    // sahip tek konuşan + koparsa left
    const c2 = await call(o);
    o.ws.ws.close();
    // önceki görüşmenin idle{tech}'i de kuyrukta: c2 bitişini seç
    expect(await state(back.ws, (s) => s.phase === "idle" && s.callId === c2)).toMatchObject({ endReason: "left" });
  });

  it("oturum biter → voice.state idle{session_ended} session.ended'dan önce; audit end{session_ended}", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V });
    const callId = await call(o);
    o.ws.send({ t: "session.end" });
    expect(await state(o.guest, (s) => s.phase === "idle" && s.callId === callId)).toMatchObject({ endReason: "session_ended" });
    await o.guest.waitFor("session.ended");
    await until(async () => (await audits(o.sessionId, "voice.end")).length === 1);
    expect((await audits(o.sessionId, "voice.end"))[0]?.newValue).toMatchObject({ reason: "session_ended" });
  });
});

describe("P28d çoklu teknisyen, yetki, dinleyenler (AC-378, Y-PD-3, O-PD-2)", () => {
  it("AC-378: izleyici voice.request/join → FORBIDDEN; katılımcı join → talkers; yetkili izleyici listeners'ta, yetkisiz değil", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V });
    const p = await inviteAndJoin(live, o, MEMBER_V);
    const obs = await newUser(live, o.tenantId, { ...SUPERVISOR_PERMS, ...V });
    expect((await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, obs.s, {})).statusCode).toBe(200);
    const ow = await memberWs(live, o.sessionId, obs.s);
    expect(ow.hello).toMatchObject({ techRole: "observer", guestVoice: true });
    ow.ws.send({ t: "voice.request" });
    expect(await errorOf(ow.ws)).toMatchObject({ code: "FORBIDDEN" });
    const callId = await call(o);
    ow.ws.send({ t: "voice.join", callId });
    expect(await errorOf(ow.ws)).toMatchObject({ code: "FORBIDDEN" });
    p.ws.send({ t: "voice.join", callId });
    const own = tidOf(o, o.user.id);
    const pt = tidOf(o, p.user.id);
    const ob = tidOf(o, obs.user.id);
    expect(await state(o.guest, (s) => s.talkers.length === 2)).toMatchObject({ talkers: [own, pt], listeners: [own, pt, ob] });
    await until(async () => (await audits(o.sessionId, "voice.join")).length === 1);
    expect((await audits(o.sessionId, "voice.join"))[0]).toMatchObject({ userId: p.user.id, newValue: {} });
  });

  it("V-PD-6: sessions.voice'u olmayan izleyici listeners dışında; voice.state alır ama dinleyen sayılmaz", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V });
    const obs = await newUser(live, o.tenantId, SUPERVISOR_PERMS);
    await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, obs.s, {});
    const ow = await memberWs(live, o.sessionId, obs.s);
    await call(o);
    expect(await state(ow.ws, (s) => s.phase === "active")).toMatchObject({ listeners: [tidOf(o, o.user.id)] });
  });

  it("Y-PD-3: applyPermChange üye yolu ve sahip yolu ayrı ayrı tid'i talkers+listeners'tan çıkarır; son konuşan → left; end talkerIds/listenerIds birleşim", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V });
    const p = await inviteAndJoin(live, o, MEMBER_V);
    const callId = await call(o);
    p.ws.send({ t: "voice.join", callId });
    const own = tidOf(o, o.user.id);
    const pt = tidOf(o, p.user.id);
    await state(o.guest, (s) => s.talkers.length === 2);
    await live.app.rooms.applyPermChange(p.user.id, ["sessions.view", "remote_control.use"]); // üye yolu
    expect(await state(o.guest, (s) => !s.listeners.includes(pt))).toMatchObject({ talkers: [own], listeners: [own] });
    expect(room(o.sessionId).multi.members.has(p.user.id)).toBe(true); // üyelik sürer, ses düşer
    await live.app.rooms.applyPermChange(o.user.id, Object.keys(OWNER_PERMS) as PermissionKey[]); // sahip yolu
    expect(await state(o.guest, (s) => s.phase === "idle")).toMatchObject({ endReason: "left" });
    await until(async () => (await audits(o.sessionId, "voice.end")).length === 1);
    const end = (await audits(o.sessionId, "voice.end"))[0]?.newValue as { talkerIds: string[]; listenerIds: string[] };
    expect(end.talkerIds.sort()).toEqual([o.user.id, p.user.id].sort());
    expect(end.listenerIds.sort()).toEqual([o.user.id, p.user.id].sort());
  });

  it("revokeMember (müşteri tech.remove / member.leave): konuşan üye çıkınca talkers'tan düşer; görüşme sahip konuşurken sürer", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V });
    const p = await inviteAndJoin(live, o, MEMBER_V);
    const callId = await call(o);
    p.ws.send({ t: "voice.join", callId });
    const pt = tidOf(o, p.user.id);
    await state(o.guest, (s) => s.talkers.includes(pt));
    o.guest.send({ t: "tech.remove", tid: pt });
    expect(await state(o.ws, (s) => !s.listeners.includes(pt))).toMatchObject({ phase: "active", talkers: [tidOf(o, o.user.id)] });
  });

  it("devir (session.transfer): konuşanlar değişmez, görüşme sürer", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V });
    const p = await inviteAndJoin(live, o, { ...MEMBER_V, "sessions.create": true, "sessions.invite": true });
    const callId = await call(o);
    p.ws.send({ t: "voice.join", callId });
    await state(o.guest, (s) => s.talkers.length === 2);
    o.ws.send({ t: "session.transfer", to: tidOf(o, p.user.id) });
    await until(() => room(o.sessionId).technicianId === p.user.id);
    expect(room(o.sessionId).voice.phase).toBe("active");
    expect([...room(o.sessionId).voice.talkers].sort()).toEqual([tidOf(o, o.user.id), tidOf(o, p.user.id)].sort());
  });
});

describe("P28d eski istemci ve gözetimsiz (AC-377, AC-379)", () => {
  it("AC-379: eski Go misafir (voice1 yok) → guestVoice:false, CLIENT_UNSUPPORTED (AC-352 metni); misafire voice.* gitmez; voice.answer → 1008", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V, kind: "AGENT" });
    expect(o.joined).toMatchObject({ guestVoice: false });
    o.ws.send({ t: "voice.request" });
    expect(await errorOf(o.ws)).toMatchObject({
      code: "CLIENT_UNSUPPORTED",
      message: "Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin",
    });
    await tick(150);
    expect(voiceMsgs(o.guest)).toHaveLength(0);
    o.guest.send({ t: "voice.answer", callId: "A".repeat(22), accept: true });
    expect((await o.guest.closed).code).toBe(WS_CLOSE.POLICY);
  });

  it("AC-377: Go misafir rs.cap.voice1 → aynı mesaj kümesi (istek, kabul, bitiş)", async () => {
    const o = await ownerWithGuest(live, { perms: OWNER_V, kind: "AGENT", caps: [WS_CAP_VOICE] });
    expect(o.joined).toMatchObject({ guestVoice: true });
    const callId = await call(o);
    o.guest.send({ t: "voice.end", callId, reason: "device" });
    expect(await state(o.ws, (s) => s.phase === "idle")).toMatchObject({ endReason: "device" });
  });

  it("AC-379: gözetimsiz oda + voice1 → CLIENT_UNSUPPORTED; misafir şemasında voice.* yok (1008); hello.guestVoice false", async () => {
    const o = await ownerWithGuest(live, {
      perms: { ...OWNER_V, "unattended.connect": true },
      kind: "AGENT",
      caps: [WS_CAP_VOICE],
    });
    const r = room(o.sessionId);
    r.unattended = { deviceId: "d", deviceName: "PC-1", customerId: "c", consentRequest: "ask", consentMode: "asked" };
    try {
      o.ws.send({ t: "voice.request" });
      expect(await errorOf(o.ws)).toMatchObject({ code: "CLIENT_UNSUPPORTED" });
      o.guest.send({ t: "voice.answer", callId: "A".repeat(22), accept: true });
      expect((await o.guest.closed).code).toBe(WS_CLOSE.POLICY);
      expect(guestVoiceOf(r)).toBe(false); // teknisyen hello'su (misafir koptu, son değer true olsa da)
    } finally {
      r.unattended = undefined; // sahte gözetimsiz kurgu: teardown cihaz kancasına gitmesin
    }
  });
});
