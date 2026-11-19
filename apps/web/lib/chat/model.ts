/*
 * P22 oturum sohbeti modeli (mimari-p22 §4.2, §8.1; AC-264): saf reducer. Kaynak yalnız sunucu WS mesajlarıdır
 * (`chat.message/history/state/rejected`); DataChannel `chat` bu modele hiç girmez. Tekilleştirme sunucu `id`'si (ULID)
 * ile; kendi iyimser öğem `clientMsgId` ile eşleşir (yankı = onay). Metin yalnız düz metin tutulur, React metin
 * düğümüyle basılır (HTML yorumlanmaz).
 */
import type { MessageSender } from "@remote/contracts/chat";
import type { ChatHistoryItem, ChatRejectReason, ChatStateReason } from "@remote/contracts/ws-chat";
import type { ServerOutbound } from "@remote/contracts/ws";

export type ChatServerMsg = Extract<ServerOutbound, { t: "chat.message" | "chat.history" | "chat.state" | "chat.rejected" }>;
export const CHAT_TYPES: ReadonlySet<string> = new Set(["chat.message", "chat.history", "chat.state", "chat.rejected"]);
export const isChatMsg = (m: ServerOutbound): m is ChatServerMsg => CHAT_TYPES.has(m.t);

export interface ChatEntry {
  /** React anahtarı: sunucu id'si, onaylanmamışsa `c.<clientMsgId>`. */
  key: string;
  id: string | null;
  clientMsgId: string | null;
  mine: boolean;
  sender: MessageSender;
  tid?: string;
  senderName?: string;
  body: string;
  at: string;
  status: "sending" | "sent" | "failed";
  /** `failed` nedeni (sunucu `chat.rejected` ya da yerel zaman aşımı → `internal`). */
  reason?: ChatRejectReason;
}

export interface ChatModel {
  items: ChatEntry[];
  unread: number;
  /** `chat.state`: null = henüz gelmedi (bağlanıyor / eski sunucu). */
  enabled: boolean | null;
  reason: ChatStateReason | null;
  /** `chat.history.more`: daha eski mesajlar yalnız oturum geçmişinde. */
  more: boolean;
  /** Son ret nedeni (ör. `rate` → "Çok hızlı" canlı bölgesi). */
  lastReject: ChatRejectReason | null;
}

export const initialChatModel: ChatModel = { items: [], unread: 0, enabled: null, reason: null, more: false, lastReject: null };

/** Kim olduğum: misafir → CUSTOMER benim; teknisyen → TECH + (tid yoksa ya da eşitse) benim. */
export interface ChatMe {
  side: "tech" | "guest";
  tid: string | null;
}

/** Bellekte tutulan en çok mesaj (eskiler düşer; tamamı oturum geçmişinde). */
const KEEP = 500;

export type ChatEvent =
  | { type: "server"; m: ChatServerMsg; me: ChatMe; visible: boolean }
  | { type: "sent"; clientMsgId: string; body: string; at: string; sender: MessageSender }
  | { type: "retry"; clientMsgId: string }
  | { type: "timeout"; clientMsgId: string }
  | { type: "read" };

export function isMine(m: { sender: MessageSender; tid?: string }, me: ChatMe): boolean {
  if (me.side === "guest") return m.sender === "CUSTOMER";
  return m.sender === "TECH" && (me.tid === null || m.tid === undefined || m.tid === me.tid);
}

const entryOf = (m: ChatHistoryItem, me: ChatMe, clientMsgId: string | null = null): ChatEntry => ({
  key: m.id,
  id: m.id,
  clientMsgId,
  mine: isMine(m, me),
  sender: m.sender,
  ...(m.tid ? { tid: m.tid } : {}),
  ...(m.senderName ? { senderName: m.senderName } : {}),
  body: m.body,
  at: m.createdAt,
  status: "sent",
});

/** Onaylılar ULID (= saklama sırası) ile artan; onay bekleyenler sonda, ekleme sırasıyla. */
function arrange(items: ChatEntry[]): ChatEntry[] {
  const done = items.filter((i) => i.id !== null).sort((a, b) => (a.id! < b.id! ? -1 : a.id! > b.id! ? 1 : 0));
  return [...done, ...items.filter((i) => i.id === null)].slice(-KEEP);
}

function onServer(s: ChatModel, m: ChatServerMsg, me: ChatMe, visible: boolean): ChatModel {
  switch (m.t) {
    case "chat.state":
      return { ...s, enabled: m.enabled, reason: m.reason ?? null };
    case "chat.history": {
      const known = new Set(s.items.map((i) => i.id));
      const add = m.items.filter((i) => !known.has(i.id)).map((i) => entryOf(i, me));
      return { ...s, items: arrange([...s.items, ...add]), more: s.more || m.more };
    }
    case "chat.message": {
      if (m.clientMsgId) {
        const own = s.items.find((i) => i.id === null && i.clientMsgId === m.clientMsgId);
        if (own) {
          const rest = s.items.filter((i) => i !== own && i.id !== m.id);
          return { ...s, items: arrange([...rest, { ...entryOf(m, me, m.clientMsgId), mine: true }]) };
        }
      }
      if (s.items.some((i) => i.id === m.id)) return s; // yinelenen (geçmiş + canlı)
      const e = entryOf(m, me, m.clientMsgId ?? null);
      return { ...s, items: arrange([...s.items, e]), unread: e.mine || visible ? s.unread : s.unread + 1 };
    }
    case "chat.rejected":
      return {
        ...s,
        lastReject: m.reason,
        items: s.items.map((i) => (i.id === null && i.clientMsgId === m.clientMsgId ? { ...i, status: "failed", reason: m.reason } : i)),
      };
  }
}

export function chatModelReducer(s: ChatModel, e: ChatEvent): ChatModel {
  switch (e.type) {
    case "server":
      return onServer(s, e.m, e.me, e.visible);
    case "sent": {
      const item: ChatEntry = {
        key: `c.${e.clientMsgId}`,
        id: null,
        clientMsgId: e.clientMsgId,
        mine: true,
        sender: e.sender,
        body: e.body,
        at: e.at,
        status: "sending",
      };
      return { ...s, lastReject: null, items: arrange([...s.items, item]) };
    }
    case "retry":
      return {
        ...s,
        lastReject: null,
        items: s.items.map((i) => (i.id === null && i.clientMsgId === e.clientMsgId ? { ...i, status: "sending", reason: undefined } : i)),
      };
    case "timeout":
      return {
        ...s,
        items: s.items.map((i) =>
          i.id === null && i.clientMsgId === e.clientMsgId && i.status === "sending" ? { ...i, status: "failed", reason: "internal" } : i,
        ),
      };
    case "read":
      return s.unread ? { ...s, unread: 0 } : s;
  }
}

/** `clientMsgId`: 16 rastgele bayt base64url (22 karakter; `CHAT_CLIENT_MSG_ID_PATTERN`). */
export function newClientMsgId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Kod noktası sayısı (sayaç ve 1.000 sınırı; UTF-16 değil). */
export const codePoints = (v: string): number => [...v].length;
/** Girişi `max` kod noktasında keser (sayaç 1.000'de durur). */
export const clipCodePoints = (v: string, max: number): string => (codePoints(v) <= max ? v : [...v].slice(0, max).join(""));
