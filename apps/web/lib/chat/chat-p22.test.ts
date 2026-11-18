import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHAT_CLIENT_MSG_ID_PATTERN } from "@remote/contracts/ws-chat";
import { LEGACY_CHAT_NOTICE } from "@remote/contracts/chat";
import { chatModelReducer, clipCodePoints, initialChatModel, isMine, newClientMsgId, type ChatModel } from "./model";
import { legacyNotifier, LEGACY_NOTICE_INTERVAL_MS } from "./legacy-notice";
import { initialTech, techReducer } from "../webrtc/tech-machine";

// P22 (mimari-p22 §4.2, §8.1; AC-264) — oturum sohbeti modeli ve K-P22-3 sabit bildirimi.
const fx = JSON.parse(readFileSync(new URL("../../../../packages/contracts/fixtures/ws-session-chat.json", import.meta.url), "utf8")) as {
  constants: Record<string, unknown>;
};
const tech = { side: "tech" as const, tid: "AAAAAAAAAAA" };
const guest = { side: "guest" as const, tid: null };
const msg = (id: string, sender: "TECH" | "CUSTOMER", body: string, extra: Record<string, unknown> = {}) => ({
  t: "chat.message" as const,
  id,
  sender,
  body,
  createdAt: "2026-11-18T10:00:00.000Z",
  ...extra,
});
/** `chat.history` öğesi: `chat.message` gövdesi `t`siz. */
const item = (m: ReturnType<typeof msg>) => {
  const r: Partial<ReturnType<typeof msg>> = { ...m };
  delete r.t;
  return r as Omit<ReturnType<typeof msg>, "t">;
};
const ID1 = "01JCHAT0000000000000000001";
const ID2 = "01JCHAT0000000000000000002";
const ID3 = "01JCHAT0000000000000000003";

describe("AC-264 oturum sohbeti modeli", () => {
  it("clientMsgId 22 karakter base64url ve sözleşme desenine uyar", () => {
    const id = newClientMsgId();
    expect(id).toHaveLength(22);
    expect(CHAT_CLIENT_MSG_ID_PATTERN.test(id)).toBe(true);
    expect(fx.constants).toBeTruthy();
  });

  it("iyimser öğe → yankı (aynı clientMsgId) onaylar; yinelenen id tek öğe", () => {
    let s: ChatModel = chatModelReducer(initialChatModel, { type: "sent", clientMsgId: "c".repeat(22), body: "selam", at: "x", sender: "TECH" });
    expect(s.items[0]).toMatchObject({ status: "sending", id: null, mine: true });
    s = chatModelReducer(s, {
      type: "server",
      m: msg(ID1, "TECH", "selam", { tid: tech.tid, senderName: "Ayşe", clientMsgId: "c".repeat(22) }),
      me: tech,
      visible: true,
    });
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ status: "sent", id: ID1, mine: true });
    s = chatModelReducer(s, { type: "server", m: { t: "chat.history", items: [item(msg(ID1, "TECH", "selam"))], more: false }, me: tech, visible: true });
    expect(s.items).toHaveLength(1);
  });

  it("chat.rejected → gönderilemedi; Tekrar dene aynı clientMsgId ile yeniden gönderiliyor yapar", () => {
    const cid = "d".repeat(22);
    let s = chatModelReducer(initialChatModel, { type: "sent", clientMsgId: cid, body: "x", at: "x", sender: "CUSTOMER" });
    s = chatModelReducer(s, { type: "server", m: { t: "chat.rejected", clientMsgId: cid, reason: "internal" }, me: guest, visible: true });
    expect(s.items[0]).toMatchObject({ status: "failed", reason: "internal" });
    s = chatModelReducer(s, { type: "retry", clientMsgId: cid });
    expect(s.items[0]).toMatchObject({ status: "sending", clientMsgId: cid });
    s = chatModelReducer(s, { type: "timeout", clientMsgId: cid });
    expect(s.items[0]?.status).toBe("failed");
  });

  it("geçmiş ULID sırasıyla birleşir, more korunur; görünmezken gelen karşı mesaj okunmamış sayılır", () => {
    let s = chatModelReducer(initialChatModel, {
      type: "server",
      m: { t: "chat.history", items: [item(msg(ID3, "CUSTOMER", "c")), item(msg(ID1, "CUSTOMER", "a"))], more: true },
      me: tech,
      visible: false,
    });
    expect(s.items.map((i) => i.id)).toEqual([ID1, ID3]);
    expect(s.more).toBe(true);
    expect(s.unread).toBe(0);
    s = chatModelReducer(s, { type: "server", m: msg(ID2, "CUSTOMER", "<b>b</b>"), me: tech, visible: false });
    expect(s.items.map((i) => i.id)).toEqual([ID1, ID2, ID3]);
    expect(s.items[1]?.body).toBe("<b>b</b>");
    expect(s.unread).toBe(1);
    s = chatModelReducer(s, { type: "read" });
    expect(s.unread).toBe(0);
  });

  it("chat.state enabled/kapanış; kim benim (çoklu teknisyen tid)", () => {
    const s = chatModelReducer(initialChatModel, { type: "server", m: { t: "chat.state", enabled: false, reason: "ended" }, me: guest, visible: true });
    expect(s).toMatchObject({ enabled: false, reason: "ended" });
    expect(isMine({ sender: "TECH", tid: "BBBBBBBBBBB" }, tech)).toBe(false);
    expect(isMine({ sender: "TECH", tid: tech.tid }, tech)).toBe(true);
    expect(isMine({ sender: "CUSTOMER" }, guest)).toBe(true);
    expect(isMine({ sender: "TECH" }, guest)).toBe(false);
  });

  it("giriş 1.000 kod noktasında durur (emoji tek sayılır)", () => {
    expect([...clipCodePoints("😀".repeat(1200), 1000)]).toHaveLength(1000);
    expect(clipCodePoints("abc", 1000)).toBe("abc");
  });
});

describe("K-P22-3 eski istemci sabit bildirimi", () => {
  it("yalnız sabit metin; 60 sn'de en çok 1; kanal kapalıyken sayılmaz", () => {
    let now = 0;
    const n = legacyNotifier(() => now);
    const sent: string[] = [];
    const ok = (x: string) => (sent.push(x), true);
    expect(n(() => false)).toBe(false);
    expect(n(ok)).toBe(true);
    expect(n(ok)).toBe(false);
    now += LEGACY_NOTICE_INTERVAL_MS - 1;
    expect(n(ok)).toBe(false);
    now += 1;
    expect(n(ok)).toBe(true);
    expect(sent).toHaveLength(2);
    for (const raw of sent) {
      const m = JSON.parse(raw) as { t: string; text: string };
      expect(m.t).toBe("chat");
      expect(m.text).toBe(LEGACY_CHAT_NOTICE);
    }
    // gönderim fonksiyonu metin parametresi almaz
    expect(n.length).toBe(1);
  });
});

describe("S-P22-2 konsol kapısı (4426)", () => {
  it("4426 → console_outdated (oturum bitti sayılmaz, yeniden bağlanma denenmez)", () => {
    const live = { ...initialTech, phase: "live" as const };
    const s = techReducer(live, { type: "closed", code: 4426, now: 1 });
    expect(s.end).toBe("console_outdated");
    expect(s.reconnectSince).toBeNull();
    // diğer kapanış kodları etkilenmez
    expect(techReducer(live, { type: "closed", code: 1006, now: 1 }).reconnectSince).toBe(1);
  });
});
