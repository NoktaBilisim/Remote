"use client";

/*
 * P22 oturum sohbeti kancası (mimari-p22 §4, §8.1–8.2; AC-264): sinyalizasyon WS'inden `chat.*` okur, `chat.send` yazar.
 * Konsol ve tarayıcı misafir aynı kancayı kullanır (tek yol). Akış: doğrula (contracts `chatBodySchema`) → gönderen hız
 * sınırı (AC-227, 5/sn) → iyimser öğe "gönderiliyor" → sunucu yankısı (aynı `clientMsgId`) = onay. `chat.rejected` ya da
 * yanıtsızlık → "gönderilemedi" + "Tekrar dene" (aynı `clientMsgId`; sunucu idempotent).
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { chatBodySchema } from "@remote/contracts/chat";
import type { ChatSend, GuestChatState } from "@remote/contracts/ws-chat";
import type { ServerOutbound } from "@remote/contracts/ws";
import { chatSendLimiter } from "../dc/rate";
import { chatModelReducer, initialChatModel, isChatMsg, newClientMsgId, type ChatMe, type ChatModel } from "./model";

/** Yankı gelmezse öğe bu süre sonunda "gönderilemedi" olur (Tekrar dene idempotent). */
export const CHAT_ACK_TIMEOUT_MS = 10_000;
/** Misafir: canlı bağlantıda bu süre içinde `chat.state` gelmezse (eski sunucu) "Sohbet şu an kullanılamıyor". */
export const CHAT_STATE_WAIT_MS = 8_000;

export interface SessionChatOptions {
  side: "tech" | "guest";
  subscribe: (fn: (m: ServerOutbound) => void) => () => void;
  send: (m: ChatSend) => void;
  /** Kendi oda kimliğim (teknisyen `hello.tid`; misafirde null). */
  tid: string | null;
  /** Sohbet şu an görünür mü (okunmamış sayaç). */
  visible: boolean;
  /** WS bağlı ve oturum canlı. */
  connected: boolean;
  /** Teknisyen: `hello`/`peer.joined` `guestChat` (misafirde yok). */
  guestChat?: GuestChatState | null;
}

export type ChatSendResult = { r: "sent" } | { r: "rate" } | { r: "error" } | { r: "invalid"; message: string };

export interface SessionChat {
  model: ChatModel;
  /** Yazılabilir: bağlı + `chat.state{enabled}` + (teknisyende) misafir eski değil. */
  ready: boolean;
  /** Teknisyen: misafir istemcisi eski (`guestChat="outdated"`) — sohbet iki tarafta kapalı. */
  outdated: boolean;
  /** Misafir: sunucu sohbeti hiç açmadı (eski sunucu). */
  unavailable: boolean;
  send: (text: string) => ChatSendResult;
  retry: (clientMsgId: string) => void;
}

export function useSessionChat(o: SessionChatOptions): SessionChat {
  const [model, dispatch] = useReducer(chatModelReducer, initialChatModel);
  const opts = useRef(o);
  useEffect(() => {
    opts.current = o;
  });
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const { subscribe } = o;
  useEffect(
    () =>
      subscribe((m) => {
        if (!isChatMsg(m)) return;
        const me: ChatMe = { side: opts.current.side, tid: opts.current.tid };
        if ((m.t === "chat.message" || m.t === "chat.rejected") && m.clientMsgId) {
          clearTimeout(timers.current.get(m.clientMsgId));
          timers.current.delete(m.clientMsgId);
        }
        dispatch({ type: "server", m, me, visible: opts.current.visible });
      }),
    [subscribe],
  );

  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const x of t.values()) clearTimeout(x);
      t.clear();
    };
  }, []);

  useEffect(() => {
    if (o.visible) dispatch({ type: "read" });
  }, [o.visible]);

  // Misafir: canlıyken `chat.state` hiç gelmezse (eski sunucu) bölüm "kullanılamıyor" der
  const [waited, setWaited] = useState(false);
  const waiting = o.side === "guest" && o.connected && model.enabled === null;
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setWaited(true), CHAT_STATE_WAIT_MS);
    return () => clearTimeout(t);
  }, [waiting]);

  const outdated = o.side === "tech" && o.guestChat === "outdated";
  const ready = o.connected && model.enabled === true && !outdated;

  const arm = useCallback((clientMsgId: string) => {
    clearTimeout(timers.current.get(clientMsgId));
    timers.current.set(
      clientMsgId,
      setTimeout(() => {
        timers.current.delete(clientMsgId);
        dispatch({ type: "timeout", clientMsgId });
      }, CHAT_ACK_TIMEOUT_MS),
    );
  }, []);

  const limiter = useRef(chatSendLimiter());
  const send = useCallback(
    (text: string): ChatSendResult => {
      const p = chatBodySchema.safeParse(text);
      if (!p.success) return { r: "invalid", message: p.error.issues[0]?.message ?? "" };
      if (!ready) return { r: "error" };
      if (!limiter.current.take()) return { r: "rate" };
      const clientMsgId = newClientMsgId();
      dispatch({
        type: "sent",
        clientMsgId,
        body: p.data,
        at: new Date().toISOString(),
        sender: opts.current.side === "tech" ? "TECH" : "CUSTOMER",
      });
      opts.current.send({ t: "chat.send", clientMsgId, body: p.data });
      arm(clientMsgId);
      return { r: "sent" };
    },
    [ready, arm],
  );

  const retry = useCallback(
    (clientMsgId: string) => {
      const item = model.items.find((i) => i.id === null && i.clientMsgId === clientMsgId);
      if (!item || !ready) return;
      dispatch({ type: "retry", clientMsgId });
      opts.current.send({ t: "chat.send", clientMsgId, body: item.body });
      arm(clientMsgId);
    },
    [model.items, ready, arm],
  );

  return { model, ready, outdated, unavailable: waiting && waited, send, retry };
}
