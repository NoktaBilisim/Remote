/*
 * Sohbet modeli (AC-35, AC-52): iki yön, zaman damgalı, okunmamış sayaç. Metin YALNIZ düz metin olarak tutulur
 * ve React metin düğümüyle (textContent eşdeğeri) basılır — HTML yorumlanmaz.
 */
import { CHAT_MAX, newId } from "./ctl";

export interface ChatItem {
  id: string;
  from: "me" | "peer";
  text: string;
  ts: number;
}
export interface ChatState {
  items: ChatItem[];
  unread: number;
}
export const initialChat: ChatState = { items: [], unread: 0 };

/** Tutulan en çok mesaj (bellek sınırı); eskiler düşer. */
export const CHAT_KEEP = 500;

export type ChatAction =
  | { type: "in"; id: string; text: string; ts: number; visible: boolean }
  | { type: "out"; item: ChatItem }
  | { type: "read" }
  | { type: "reset" };

export function chatReducer(s: ChatState, a: ChatAction): ChatState {
  switch (a.type) {
    case "in": {
      if (s.items.some((i) => i.id === a.id && i.from === "peer")) return s; // yinelenen
      const items = [...s.items, { id: a.id, from: "peer" as const, text: a.text, ts: a.ts }].slice(-CHAT_KEEP);
      return { items, unread: a.visible ? 0 : s.unread + 1 };
    }
    case "out":
      return { ...s, items: [...s.items, a.item].slice(-CHAT_KEEP) };
    case "read":
      return s.unread ? { ...s, unread: 0 } : s;
    case "reset":
      return initialChat;
  }
}

/** Gönderilecek metni hazırlar: kenar boşlukları kırpılır; boş/aşırı uzun → null. */
export function prepareChat(text: string, now = Date.now()): ChatItem | null {
  const v = text.trim();
  if (!v || v.length > CHAT_MAX) return null; // zod .max ile aynı ölçü (UTF-16)
  return { id: newId(), from: "me", text: v, ts: now };
}
