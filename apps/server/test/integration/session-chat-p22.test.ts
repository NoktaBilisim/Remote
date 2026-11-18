// P22-B1 sunucu WS oturum sohbeti (mimari-p22 r2 §4, §7, §11, §15.1/15.2/15.4/15.5/15.6; AC-264; T-P22-2..6). Gerçek sunucu +
// MySQL; oda saati sahte (kayan 1 sn kovası saatle ilerletilir). Her alınan `chat.*` sözleşme şemasından geçirilir.
import { randomBytes } from "node:crypto";
import { CHAT_AUDIT } from "@remote/contracts/audit";
import { WS_CLOSE } from "@remote/contracts/ws";
import {
  CHAT_HISTORY_MAX_BYTES,
  chatHistorySchema,
  chatMessageSchema,
  WS_CAP_SCHAT,
  WS_CLOSE_CONSOLE_OUTDATED,
} from "@remote/contracts/ws-chat";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant, ORIGIN, testDb } from "../helpers/app.ts";
import {
  audits,
  inject,
  inviteAndJoin,
  newUser,
  nextIp,
  OWNER_PERMS,
  ownerWithGuest,
  startMultiLive,
  SUPERVISOR_PERMS,
  tick,
  until,
  waitMsg,
  type MultiLive,
} from "../helpers/multi.ts";
import { connectRaw, techHeaders, type WsClient } from "../helpers/ws.ts";
import { chatBindingOf } from "../../src/signaling/chat.ts";
import { insertIfActive, storeChat, writeChatSummary } from "../../src/sessions/chat.ts";
import { aadFor } from "../../src/lib/crypto.ts";
import { FixedWindowCounter } from "../../src/lib/rate.ts";

let live: MultiLive;
beforeAll(async () => {
  live = await startMultiLive();
});
afterAll(async () => {
  await live.close();
});

const cid = (): string => randomBytes(16).toString("base64url");
const schatGuest = (o: Parameters<typeof ownerWithGuest>[1] = {}) =>
  ownerWithGuest(live, { ...o, caps: [WS_CAP_SCHAT, ...(o.caps ?? [])] });
const rows = (sessionId: string) =>
  testDb().sessionMessage.findMany({ where: { sessionId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const chatMsgs = (c: WsClient) => c.msgs.filter((m) => m.t.startsWith("chat."));
const drain = (c: WsClient): void => void c.msgs.splice(0);
const message = async (c: WsClient, pred: (m: ReturnType<typeof chatMessageSchema.parse>) => boolean = () => true) =>
  chatMessageSchema.parse(await waitMsg(c, "chat.message", (m) => pred(chatMessageSchema.parse(m))));
const rejected = (c: WsClient) => waitMsg(c, "chat.rejected");

describe("P22 önce kaydet, sonra ilet (AC-264, T-P22-2/3)", () => {
  it("AC-264: teknisyen ↔ schat1 misafir çift yön; clientMsgId yalnız gönderende; satır şifreli, request_id NULL", async () => {
    const o = await schatGuest();
    expect(o.joined).toMatchObject({ guestChat: "on" });
    expect(await waitMsg(o.guest, "chat.state")).toEqual({ t: "chat.state", enabled: true });
    expect(chatHistorySchema.parse(await waitMsg(o.guest, "chat.history"))).toEqual({ t: "chat.history", items: [], more: false });
    expect(await waitMsg(o.ws, "chat.state")).toEqual({ t: "chat.state", enabled: false, reason: "not_active" }); // hello (PENDING)
    expect(await waitMsg(o.ws, "chat.state")).toEqual({ t: "chat.state", enabled: true }); // kabul
    const a = cid();
    o.ws.send({ t: "chat.send", clientMsgId: a, body: "Merhaba  \r\nnasılsınız?" });
    const echo = await message(o.ws);
    expect(echo).toMatchObject({ sender: "TECH", clientMsgId: a, body: "Merhaba  \nnasılsınız?" });
    expect(echo.senderName).toBe((await testDb().user.findUniqueOrThrow({ where: { id: o.user.id } })).fullName);
    expect(echo.tid).toBe(live.app.rooms.get(o.sessionId)?.multi.tids.get(o.user.id));
    const atGuest = await message(o.guest);
    expect(atGuest).toEqual({ ...echo, clientMsgId: undefined, t: "chat.message" });
    expect("clientMsgId" in atGuest).toBe(false);
    const b = cid();
    o.guest.send({ t: "chat.send", clientMsgId: b, body: "İyiyim <img src=x onerror=alert(1)>" });
    expect(await message(o.guest)).toMatchObject({ sender: "CUSTOMER", clientMsgId: b });
    const toTech = await message(o.ws);
    expect(toTech).toMatchObject({ sender: "CUSTOMER", body: "İyiyim <img src=x onerror=alert(1)>" });
    expect(toTech.tid === undefined && toTech.senderName === undefined && toTech.clientMsgId === undefined).toBe(true);
    const r = await rows(o.sessionId);
    expect(r.map((x) => [x.sender, x.requestId, x.senderUserId, x.bodyChars])).toEqual([
      ["TECH", null, o.user.id, 21],
      ["CUSTOMER", null, null, 35],
    ]);
    for (const x of r) expect(Buffer.from(x.bodyEnc).includes(Buffer.from("Merhaba"))).toBe(false);
    // AAD başka oturum id'siyle çözülmez (T-P22-1).
    const row = r[0];
    if (!row) throw new Error("satır yok");
    expect(() =>
      live.app.secrets.decrypt(row.bodyEnc, aadFor.sessionMessage(row.tenantId, "01ARZ3NDEKTSV4RRFFQ69G5FAV", row.id)),
    ).toThrow();
    // K-P22-6: mesaj başına audit yok.
    expect(await testDb().auditLog.count({ where: { entityId: o.sessionId, action: { startsWith: "session.chat" } } })).toBe(0);
  });

  it("AC-264 S-P22-10: yinelenen clientMsgId → 1 satır, yalnız gönderene yankı, yayın/sayaç yok", async () => {
    const o = await schatGuest();
    await waitMsg(o.guest, "chat.history");
    drain(o.guest);
    const a = cid();
    o.ws.send({ t: "chat.send", clientMsgId: a, body: "bir" });
    const first = await message(o.ws);
    await message(o.guest);
    drain(o.guest);
    const before = live.app.metrics.render().match(/rs_session_chat_messages_total\{sender="TECH"\} (\d+)/)?.[1];
    live.clock.advance(1000);
    o.ws.send({ t: "chat.send", clientMsgId: a, body: "bir" });
    expect(await message(o.ws)).toMatchObject({ id: first.id, clientMsgId: a });
    await tick(150);
    expect(chatMsgs(o.guest)).toEqual([]);
    expect(await rows(o.sessionId)).toHaveLength(1);
    expect(live.app.metrics.render().match(/rs_session_chat_messages_total\{sender="TECH"\} (\d+)/)?.[1]).toBe(before);
  });

  it("AC-264 T-P22-3: INSERT hatası enjekte → gönderene internal, alıcıda 0 çerçeve, satır 0; audit chat_rejected{internal}", async () => {
    const o = await schatGuest();
    const b = chatBindingOf(live.app.rooms);
    if (!b) throw new Error("bağ yok");
    await waitMsg(o.guest, "chat.history");
    drain(o.guest);
    b.insert = () => Promise.reject(Object.assign(new Error("boom"), { code: "P9999" }));
    try {
      const a = cid();
      o.ws.send({ t: "chat.send", clientMsgId: a, body: "saklanamaz" });
      expect(await rejected(o.ws)).toEqual({ t: "chat.rejected", clientMsgId: a, reason: "internal" });
      await tick(150);
      expect(chatMsgs(o.guest)).toEqual([]);
      expect(await rows(o.sessionId)).toHaveLength(0);
    } finally {
      b.insert = insertIfActive;
    }
    await until(async () => (await audits(o.sessionId, CHAT_AUDIT.REJECTED)).length === 1);
    expect((await audits(o.sessionId, CHAT_AUDIT.REJECTED))[0]).toMatchObject({
      result: "fail",
      newValue: { reason: "internal", sender: "TECH" },
    });
    expect(live.app.metrics.render()).toMatch(/rs_session_chat_rejected_total\{reason="internal"\} [1-9]/);
  });

  it("AC-264: lobi/PENDING → not_active; 6. mesaj/sn → rate; 1.001 kod noktası → invalid, soket açık", async () => {
    const o = await schatGuest();
    // gövde geçersiz: invalid, soket açık
    const bad = cid();
    o.ws.send({ t: "chat.send", clientMsgId: bad, body: "ö".repeat(1001) });
    expect(await rejected(o.ws)).toEqual({ t: "chat.rejected", clientMsgId: bad, reason: "invalid" });
    const bidi = cid();
    o.guest.send({ t: "chat.send", clientMsgId: bidi, body: "a‮b" });
    expect(await rejected(o.guest)).toMatchObject({ clientMsgId: bidi, reason: "invalid" });
    // kova: 5 geçer, 6. rate
    live.clock.advance(1000);
    for (let i = 0; i < 5; i++) o.ws.send({ t: "chat.send", clientMsgId: cid(), body: `m${i}` });
    const sixth = cid();
    o.ws.send({ t: "chat.send", clientMsgId: sixth, body: "m5" });
    expect(await rejected(o.ws)).toEqual({ t: "chat.rejected", clientMsgId: sixth, reason: "rate" });
    await until(async () => (await rows(o.sessionId)).length === 5);
    live.clock.advance(1000);
    o.ws.send({ t: "chat.send", clientMsgId: cid(), body: "tekrar" });
    await until(async () => (await rows(o.sessionId)).length === 6);
    expect(o.ws.ws.readyState).toBe(o.ws.ws.OPEN);
    // rate/invalid audit'e yazılmaz
    expect(await audits(o.sessionId, CHAT_AUDIT.REJECTED)).toHaveLength(0);
  });

  it("AC-264: kabul öncesi (PENDING) teknisyen yazamaz → not_active; hello'da chat.state{false, not_active}", async () => {
    const { s } = await newUser(live, (await createTenant()).id, OWNER_PERMS);
    const res = await inject(live, "POST", "/api/v1/sessions", s, {});
    const created = res.json<{ id: string }>();
    const ws = await connectRaw(`${live.base}/ws/tech?sessionId=${created.id}`, ["rs.v1", WS_CAP_SCHAT], {
      ...techHeaders(s.token, ORIGIN),
      "x-forwarded-for": nextIp(),
    });
    const hello = await ws.waitFor("hello");
    expect("guestChat" in hello).toBe(false);
    expect(await waitMsg(ws, "chat.state")).toEqual({ t: "chat.state", enabled: false, reason: "not_active" });
    const a = cid();
    ws.send({ t: "chat.send", clientMsgId: a, body: "erken" });
    expect(await rejected(ws)).toEqual({ t: "chat.rejected", clientMsgId: a, reason: "not_active" });
    ws.ws.close();
  });
});

describe("P22 firma müşteri kovası (§4.3 adım 2)", () => {
  it("AC-264 T-P22-6: firma müşteri kovası aşımı → rate + queue.alert (pencere başına 1); teknisyen etkilenmez", async () => {
    const b = chatBindingOf(live.app.rooms);
    if (!b) throw new Error("bağ yok");
    const orig = b.tenantCustomer;
    const alerts: string[] = [];
    const origAlert = b.deps.alert;
    b.tenantCustomer = new FixedWindowCounter(3, 60_000, 60_000, { now: () => live.clock.now(), sweepIntervalMs: 0 });
    b.deps.alert = (tenantId) => void alerts.push(tenantId);
    try {
      const o = await schatGuest();
      live.clock.advance(1000);
      o.guest.send({ t: "chat.send", clientMsgId: cid(), body: "1" });
      o.guest.send({ t: "chat.send", clientMsgId: cid(), body: "2" });
      const third = cid();
      o.guest.send({ t: "chat.send", clientMsgId: third, body: "3" });
      expect(await rejected(o.guest)).toEqual({ t: "chat.rejected", clientMsgId: third, reason: "rate" });
      o.guest.send({ t: "chat.send", clientMsgId: cid(), body: "4" });
      await rejected(o.guest);
      expect(alerts).toEqual([o.tenantId]);
      o.ws.send({ t: "chat.send", clientMsgId: cid(), body: "tech" });
      await until(async () => (await rows(o.sessionId)).length === 3);
    } finally {
      b.tenantCustomer.close();
      b.tenantCustomer = orig;
      b.deps.alert = origAlert;
    }
  });
});

describe("P22 tavan ve lobi (§4.3 adım 1–2)", () => {
  it("AC-264 T-P22-6: gönderen tavanı 2.000 → cap, satır yok, chat_rejected{cap} 1; tavanda yinelenen yine yankı", async () => {
    const o = await schatGuest();
    const a = cid();
    o.ws.send({ t: "chat.send", clientMsgId: a, body: "ilk" });
    await message(o.ws);
    const counts = live.app.rooms.get(o.sessionId)?.chat?.counts;
    if (!counts) throw new Error("sayaç yok");
    counts.set(`tech:${o.user.id}`, 2000);
    live.clock.advance(1000);
    const b = cid();
    o.ws.send({ t: "chat.send", clientMsgId: b, body: "fazla" });
    expect(await rejected(o.ws)).toEqual({ t: "chat.rejected", clientMsgId: b, reason: "cap" });
    o.ws.send({ t: "chat.send", clientMsgId: cid(), body: "fazla2" });
    await rejected(o.ws);
    o.ws.send({ t: "chat.send", clientMsgId: a, body: "ilk" });
    expect(await message(o.ws)).toMatchObject({ clientMsgId: a, body: "ilk" });
    expect(await rows(o.sessionId)).toHaveLength(1);
    await until(async () => (await audits(o.sessionId, CHAT_AUDIT.REJECTED)).length === 1);
    await tick(100);
    expect((await audits(o.sessionId, CHAT_AUDIT.REJECTED)).map((x) => x.newValue)).toEqual([{ reason: "cap", sender: "TECH" }]);
  });

  it("AC-264: lobideki schat1 misafir chat.send → chat.rejected{forbidden}, soket açık, satır 0", async () => {
    const { s } = await newUser(live, (await createTenant()).id, OWNER_PERMS);
    const created = (await inject(live, "POST", "/api/v1/sessions", s, {})).json<{ id: string; link: string }>();
    const headers = { origin: ORIGIN, "x-forwarded-for": nextIp() };
    const token = created.link.split("/").pop() ?? "";
    const r = await live.app.inject({
      method: "POST",
      url: "/api/v1/public/sessions/resolve",
      headers,
      payload: { token, clientKind: "BROWSER" },
    });
    const { joinNonce, consentText } = r.json<{ joinNonce: string; consentText: { id: string } }>();
    const j = await live.app.inject({
      method: "POST",
      url: "/api/v1/public/sessions/join",
      headers,
      payload: { joinNonce, customerName: "Ayşe", consentAccepted: true, consentTextId: consentText.id },
    });
    const { wsTicket } = j.json<{ wsTicket: string }>();
    const g = await connectRaw(`${live.base}/ws/guest`, ["rs.v1", `rs.ticket.${wsTicket}`, WS_CAP_SCHAT], headers);
    await g.waitFor("lobby.wait");
    const a = cid();
    g.send({ t: "chat.send", clientMsgId: a, body: "merhaba" });
    expect(await rejected(g)).toEqual({ t: "chat.rejected", clientMsgId: a, reason: "forbidden" });
    await tick(100);
    expect(g.ws.readyState).toBe(g.ws.OPEN);
    expect(await rows(created.id)).toHaveLength(0);
    g.ws.close();
  });
});

describe("P22 rol kapısı ve çoklu teknisyen (T-P22-4, P28c)", () => {
  it("AC-264 S-P22-8: izleyici chat.send → chat.rejected{forbidden}, soket açık, satır 0; izleyici yayını alır", async () => {
    const o = await schatGuest();
    const sup = await newUser(live, o.tenantId, SUPERVISOR_PERMS);
    const r = await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/supervise`, sup.s, {});
    expect(r.statusCode).toBe(200);
    const ws = await connectRaw(`${live.base}/ws/tech?sessionId=${o.sessionId}`, ["rs.v1", WS_CAP_SCHAT], {
      ...techHeaders(sup.s.token, ORIGIN),
      "x-forwarded-for": nextIp(),
    });
    await ws.waitFor("hello");
    const a = cid();
    ws.send({ t: "chat.send", clientMsgId: a, body: "izleyici" });
    expect(await rejected(ws)).toEqual({ t: "chat.rejected", clientMsgId: a, reason: "forbidden" });
    expect(ws.msgs.some((m) => m.t === "error")).toBe(false);
    o.ws.send({ t: "chat.send", clientMsgId: cid(), body: "sahip" });
    expect(await message(ws)).toMatchObject({ sender: "TECH", body: "sahip" });
    expect(await rows(o.sessionId)).toHaveLength(1);
    await until(async () => (await audits(o.sessionId, CHAT_AUDIT.REJECTED)).length === 1);
    expect((await audits(o.sessionId, CHAT_AUDIT.REJECTED))[0]?.newValue).toEqual({ reason: "forbidden", sender: "TECH" });
    ws.ws.close();
  });

  it("AC-264 P28c: sahip + 2 katılımcı + misafir hepsi alır, clientMsgId yalnız gönderende; sonradan katılan geçmiş alır + chat_history_sent audit (S-P22-Q-1)", async () => {
    const o = await schatGuest();
    const m1 = await inviteAndJoin(live, o);
    o.ws.send({ t: "chat.send", clientMsgId: cid(), body: "önce" });
    await message(o.guest);
    const m2 = await inviteAndJoin(live, o);
    const h = chatHistorySchema.parse(await waitMsg(m2.ws, "chat.history"));
    expect(h.items.map((i) => i.body)).toEqual(["önce"]);
    await until(async () => (await audits(o.sessionId, "session.participant_join")).length === 2);
    const joins = await audits(o.sessionId, "session.participant_join");
    expect(joins.every((j) => !("chatHistory" in (j.newValue as object)))).toBe(true);
    await until(async () => (await audits(o.sessionId, CHAT_AUDIT.HISTORY_SENT)).length === 1);
    const sent = await audits(o.sessionId, CHAT_AUDIT.HISTORY_SENT);
    expect(sent.map((x) => [x.userId, x.newValue])).toEqual([[m2.user.id, { userId: m2.user.id, n: 1 }]]);
    const a = cid();
    m1.ws.send({ t: "chat.send", clientMsgId: a, body: "katılımcıdan" });
    const own = await message(m1.ws, (x) => x.body === "katılımcıdan");
    expect(own.clientMsgId).toBe(a);
    for (const c of [o.ws, m2.ws, o.guest]) {
      const x = await message(c, (y) => y.body === "katılımcıdan");
      expect(x.clientMsgId).toBeUndefined();
      expect(x.tid).toBe(own.tid);
    }
  });

  it("AC-264 S-P22-5: misafirin çıkardığı teknisyen yeniden bağlanamaz → chat.history 0", async () => {
    const o = await schatGuest();
    const m = await inviteAndJoin(live, o);
    o.ws.send({ t: "chat.send", clientMsgId: cid(), body: "gizli" });
    await message(o.guest);
    const tid = live.app.rooms.get(o.sessionId)?.multi.tids.get(m.user.id) ?? "";
    o.guest.send({ t: "tech.remove", tid });
    await until(() => !live.app.rooms.get(o.sessionId)?.multi.members.has(m.user.id));
    await expect(
      connectRaw(`${live.base}/ws/tech?sessionId=${o.sessionId}`, ["rs.v1", WS_CAP_SCHAT], {
        ...techHeaders(m.s.token, ORIGIN),
        "x-forwarded-for": nextIp(),
      }),
    ).rejects.toThrow(/HTTP 403/);
  });
});

describe("P22 eski istemci ve eski konsol (T-P22-4a, T-P22-5, S-P22-2)", () => {
  it("AC-264 T-P22-5: belirteçsiz AGENT → misafire chat.* 0, kopma yok; teknisyene guestChat outdated; teknisyen yazamaz (satır 0); chat_legacy 1", async () => {
    const o = await ownerWithGuest(live, { kind: "AGENT" });
    expect(o.joined).toMatchObject({ guestChat: "outdated" });
    const m = await inviteAndJoin(live, o);
    expect(m.hello).toMatchObject({ guestChat: "outdated" });
    const a = cid();
    o.ws.send({ t: "chat.send", clientMsgId: a, body: "yan sohbet" });
    expect(await rejected(o.ws)).toEqual({ t: "chat.rejected", clientMsgId: a, reason: "outdated" });
    await tick(150);
    expect(chatMsgs(m.ws).filter((x) => x.t === "chat.message")).toEqual([]);
    expect(chatMsgs(o.guest)).toEqual([]);
    expect(await rows(o.sessionId)).toHaveLength(0);
    expect(o.guest.ws.readyState).toBe(o.guest.ws.OPEN);
    await until(async () => (await audits(o.sessionId, CHAT_AUDIT.LEGACY)).length === 1);
    await until(async () => (await audits(o.sessionId, CHAT_AUDIT.REJECTED)).length === 1);
    expect((await audits(o.sessionId, CHAT_AUDIT.REJECTED))[0]?.newValue).toEqual({ reason: "outdated", sender: "TECH" });
    // bitiş: özet legacy:true, sayılar 0
    o.ws.send({ t: "session.end" });
    await waitMsg(o.ws, "session.ended");
    await until(async () => (await audits(o.sessionId, CHAT_AUDIT.SUMMARY)).length === 1);
    expect((await audits(o.sessionId, CHAT_AUDIT.SUMMARY))[0]?.newValue).toEqual({ tech: 0, customer: 0, senderUserIds: [], legacy: true });
  });

  it("AC-264 T-P22-2: belirteçsiz misafir chat.send gönderirse şema dışı → 1008, satır 0", async () => {
    const o = await ownerWithGuest(live, { kind: "AGENT" });
    o.guest.send({ t: "chat.send", clientMsgId: cid(), body: "eski" });
    expect((await o.guest.closed).code).toBe(WS_CLOSE.POLICY);
    expect(await rows(o.sessionId)).toHaveLength(0);
  });

  it("AC-264 S-P22-2: rs.cap.schat1 bildirmeyen konsol soketi 4426 ile kapanır, canlı sekme düşmez", async () => {
    const o = await schatGuest();
    drain(o.ws);
    const old = await connectRaw(`${live.base}/ws/tech?sessionId=${o.sessionId}`, ["rs.v1"], {
      ...techHeaders(o.s.token, ORIGIN),
      "x-forwarded-for": nextIp(),
    });
    expect(await old.closed).toEqual({ code: WS_CLOSE_CONSOLE_OUTDATED, reason: "console_outdated" });
    expect(WS_CLOSE.CONSOLE_OUTDATED).toBe(4426);
    await tick(100);
    expect(o.ws.ws.readyState).toBe(o.ws.ws.OPEN);
    expect(o.ws.msgs.some((m) => m.t === "control.revoke")).toBe(false);
    expect(live.app.metrics.render()).toMatch(/rs_ws_tech_outdated_total [1-9]/);
  });
});

describe("P22 geçmiş bütçesi ve özet (S-P22-1, S-P22-4)", () => {
  it("S-P22-1: 101 × 1.000 emoji mesaj → yeniden bağlanan misafire chat.history < 48 KiB, more:true, artan", async () => {
    const o = await schatGuest();
    const room = live.app.rooms.get(o.sessionId);
    if (!room) throw new Error("oda yok");
    const body = "😀".repeat(1000);
    const t0 = Date.now() - 200_000;
    for (let i = 0; i < 101; i++)
      await storeChat(
        { db: testDb(), secrets: live.app.secrets },
        {
          tenantId: o.tenantId,
          sessionId: o.sessionId,
          sender: "CUSTOMER",
          senderUserId: null,
          clientMsgId: cid(),
          body,
          now: new Date(t0 + i * 1000),
        },
      );
    o.guest.ws.close();
    await o.guest.closed;
    await until(() => !room.admitted?.peer);
    const hello = o.guestHello as { reconnectToken: string };
    const g2 = await connectRaw(`${live.base}/ws/guest`, ["rs.v1", `rs.reconnect.${hello.reconnectToken}`, WS_CAP_SCHAT], {
      origin: ORIGIN,
      "x-forwarded-for": nextIp(),
    });
    const raw = await waitMsg(g2, "chat.history");
    const bytes = Buffer.byteLength(JSON.stringify(raw), "utf8");
    expect(bytes).toBeLessThanOrEqual(CHAT_HISTORY_MAX_BYTES);
    const h = chatHistorySchema.parse(raw);
    expect(h.more).toBe(true);
    expect(h.items.length).toBeGreaterThanOrEqual(10);
    const ids = h.items.map((i) => i.id);
    expect([...ids].sort()).toEqual(ids);
    const all = await rows(o.sessionId);
    expect(ids.at(-1)).toBe(all.at(-1)?.id); // en yeniler
    g2.ws.close();
  });

  it("S-P22-4: oturum bitişinde chat_summary = DB COUNT (gönderen başına); zorla sonlandırma yolu da yazar", async () => {
    const o = await schatGuest();
    const m = await inviteAndJoin(live, o);
    o.ws.send({ t: "chat.send", clientMsgId: cid(), body: "1" });
    m.ws.send({ t: "chat.send", clientMsgId: cid(), body: "2" });
    o.guest.send({ t: "chat.send", clientMsgId: cid(), body: "3" });
    await until(async () => (await rows(o.sessionId)).length === 3);
    o.guest.send({ t: "session.end" });
    await until(async () => (await audits(o.sessionId, CHAT_AUDIT.SUMMARY)).length === 1);
    const sum = (await audits(o.sessionId, CHAT_AUDIT.SUMMARY))[0]?.newValue as {
      tech: number;
      customer: number;
      senderUserIds: string[];
      legacy: boolean;
    };
    const r = await rows(o.sessionId);
    expect(sum.tech).toBe(r.filter((x) => x.sender === "TECH").length);
    expect(sum.customer).toBe(r.filter((x) => x.sender === "CUSTOMER").length);
    expect([...sum.senderUserIds].sort()).toEqual([o.user.id, m.user.id].sort());
    expect(sum.legacy).toBe(false);
    // ikinci çağrı yazmaz (idempotent)
    await writeChatSummary(testDb(), o.tenantId, o.sessionId);
    expect(await audits(o.sessionId, CHAT_AUDIT.SUMMARY)).toHaveLength(1);

    // Zorla sonlandırma (ADMIN, sessions.terminate)
    const t = await schatGuest({ tenantId: o.tenantId });
    t.guest.send({ t: "chat.send", clientMsgId: cid(), body: "x" });
    await until(async () => (await rows(t.sessionId)).length === 1);
    const admin = await newUser(live, o.tenantId, { "sessions.terminate": true, "sessions.view": true }, "ADMIN");
    drain(t.ws);
    const res = await inject(live, "POST", `/api/v1/sessions/${t.sessionId}/terminate`, admin.s, {});
    expect(res.statusCode).toBe(200);
    expect(await waitMsg(t.ws, "chat.state", (x) => !x.enabled)).toEqual({ t: "chat.state", enabled: false, reason: "ended" });
    expect((await audits(t.sessionId, CHAT_AUDIT.SUMMARY))[0]?.newValue).toEqual({
      tech: 0,
      customer: 1,
      senderUserIds: [],
      legacy: false,
    });
  });

  it("S-P22-4: mesaj yok ve eski istemci değil → özet yazılmaz", async () => {
    const o = await schatGuest();
    o.ws.send({ t: "session.end" });
    await waitMsg(o.ws, "session.ended");
    await tick(200);
    expect(await audits(o.sessionId, CHAT_AUDIT.SUMMARY)).toHaveLength(0);
  });
});

describe("P22 güvenlik P22-Q Tur 1 düzeltmesi", () => {
  it("S-P22-Q-1: sohbet zinciri asılıyken katılan üyenin participant_join audit'i yine hemen yazılır", async () => {
    const o = await schatGuest();
    const room = live.app.rooms.get(o.sessionId);
    const chat = room?.chat;
    if (!chat) throw new Error("sohbet durumu yok");
    let release = (): void => undefined;
    const gate = new Promise<void>((r) => (release = r));
    chat.chain = chat.chain.then(() => gate);
    try {
      const m = await inviteAndJoin(live, o);
      await until(async () => (await audits(o.sessionId, "session.participant_join")).length === 1, 3000);
      expect((await audits(o.sessionId, "session.participant_join"))[0]?.newValue).toEqual({ userId: m.user.id, role: "participant" });
      expect(m.ws.msgs.some((x) => x.t === "chat.history")).toBe(false);
    } finally {
      release();
    }
  });

  it("S-P22-Q-2: yönetici sonlandırması özetten önce sohbet zincirini bekler (uçuştaki satır özete girer)", async () => {
    const o = await schatGuest();
    const chat = live.app.rooms.get(o.sessionId)?.chat;
    if (!chat) throw new Error("sohbet durumu yok");
    chat.chain = chat.chain.then(async () => {
      await tick(300);
      await storeChat(
        { db: testDb(), secrets: live.app.secrets },
        {
          tenantId: o.tenantId,
          sessionId: o.sessionId,
          sender: "CUSTOMER",
          senderUserId: null,
          clientMsgId: cid(),
          body: "geç",
          now: new Date(),
        },
      );
    });
    const admin = await newUser(live, o.tenantId, { "sessions.terminate": true, "sessions.view": true }, "ADMIN");
    const res = await inject(live, "POST", `/api/v1/sessions/${o.sessionId}/terminate`, admin.s, {});
    expect(res.statusCode).toBe(200);
    expect((await audits(o.sessionId, CHAT_AUDIT.SUMMARY))[0]?.newValue).toEqual({
      tech: 0,
      customer: 1,
      senderUserIds: [],
      legacy: false,
    });
  });

  it("S-P22-Q-3: oturum toplam tavanı 10.000 (tüm gönderenler) → cap, satır yok", async () => {
    const o = await schatGuest();
    o.ws.send({ t: "chat.send", clientMsgId: cid(), body: "ilk" });
    await message(o.ws);
    const counts = live.app.rooms.get(o.sessionId)?.chat?.counts;
    if (!counts) throw new Error("sayaç yok");
    counts.set("customer", 1999);
    for (let i = 0; i < 5; i++) counts.set(`tech:eski-${i}`, 1600);
    live.clock.advance(1000);
    const b = cid();
    o.ws.send({ t: "chat.send", clientMsgId: b, body: "fazla" });
    expect(await rejected(o.ws)).toEqual({ t: "chat.rejected", clientMsgId: b, reason: "cap" });
    expect(await rows(o.sessionId)).toHaveLength(1);
  });
});
