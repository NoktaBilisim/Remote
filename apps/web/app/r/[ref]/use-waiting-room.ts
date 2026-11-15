"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { api } from "@/lib/api";
import type { StoredRequest } from "@/lib/web-request/flow";
import type { ChatItem } from "./request-chat";
import { startRequestSocket, type Phase } from "./request-socket";

/**
 * Talep kanalı: aşama, bağlantı koptu, sohbet, sayaç saati. Efekt sırası: `phaseRef` → `onFinishedRef` → soket + 1 sn sayaç.
 */
function useRequestChannel(secret: string, ws: RefObject<WebSocket | null>, onFinished: () => void) {
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [lost, setLost] = useState(false);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [chatOn, setChatOn] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  /** Son durum (kapanış/bulunamadı) senkron işareti: `phaseRef` efektle güncellendiği için kapanış olayı ondan önce gelebilir. */
  const ended = useRef(false);
  // Üst bileşen her çizimde yeni `onFinished` verir; bağımlılık olursa soket her çizimde yeniden açılırdı → ref
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);
  const finish = useCallback((p: Phase) => {
    if (p.kind === "closed" || p.kind === "gone") ended.current = true;
    setPhase(p);
    if (p.kind === "closed" || p.kind === "gone") onFinishedRef.current();
  }, []);

  useEffect(() => {
    const done = () => {
      const k = phaseRef.current.kind;
      return ended.current || k === "closed" || k === "sharing" || k === "gone";
    };
    const sock = startRequestSocket(secret, { ws, done, sink: { setChatOn, setChat, setPhase, finish }, setLost });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      sock.halt();
      clearInterval(tick);
      sock.close();
    };
  }, [secret, ws, finish]);
  return { phase, setPhase, lost, chat, setChat, chatOn, now, finish };
}

type Channel = ReturnType<typeof useRequestChannel>;

/** Müşteri eylemleri: sohbet gönderimi (iyimser), iptal (REST, ağ hatasında WS), kabulde "Vazgeç". */
function useWaitingActions(secret: string, ws: RefObject<WebSocket | null>, { setChat, finish }: Pick<Channel, "setChat" | "finish">) {
  const [cancelling, setCancelling] = useState(false);
  const sendWs = (msg: object): boolean => {
    const s = ws.current;
    if (!s || s.readyState !== WebSocket.OPEN) return false;
    s.send(JSON.stringify(msg));
    return true;
  };

  const sendChat = (body: string): boolean => {
    const clientMsgId = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
    if (!sendWs({ t: "request.message", body, clientMsgId })) return false;
    setChat((xs) => [...xs, { key: `c.${clientMsgId}`, sender: "CUSTOMER", body, createdAt: null, pending: true }]);
    return true;
  };

  const cancel = async () => {
    setCancelling(true);
    try {
      await api("POST", "/public/requests/cancel", { requestSecret: secret });
    } catch {
      /* 204 her durumda; ağ hatasında WS üzerinden de denenir */
      sendWs({ t: "request.cancel" });
    } finally {
      setCancelling(false);
      finish({ kind: "closed", status: "CANCELLED", byCustomer: true });
      ws.current?.close(1000);
    }
  };

  const decline = () => {
    sendWs({ t: "request.decline" });
    finish({ kind: "closed", status: "CANCELLED", byCustomer: true });
  };
  return { cancelling, sendChat, cancel, decline };
}

/** Bekleme sayfası durumu + eylemleri (`WaitingRoom`). Soket ref'i burada; dönüş nesnesinde ref yok (React Compiler). */
export function useWaitingRoom(request: StoredRequest, onFinished: () => void) {
  const ws = useRef<WebSocket | null>(null);
  const channel = useRequestChannel(request.requestSecret, ws, onFinished);
  const actions = useWaitingActions(request.requestSecret, ws, channel);
  return { ...channel, ...actions };
}
