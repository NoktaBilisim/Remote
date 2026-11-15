"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import {
  checkMessageBody,
  lastConfirmedId,
  mergeMessages,
  newClientMsgId,
  type CustomerChat,
  type PostMessageResponse,
  type RequestMessagesResponse,
  type ThreadEntry,
} from "@/lib/requests/thread";

/* RequestThread kancaları: yazışma yükleme/artımlı çekme/yoklama ve iyimser gönderim (mimari-e11 §8b.8). */

const POLL_MS = 15_000;

export type Load = "loading" | "error" | "ready";

const isGone = (e: unknown) => e instanceof ApiError && (e.code === "REQUEST_CLOSED" || e.status === 404);

type SetLoad = Dispatch<SetStateAction<Load>>;

/** Çekme hatası (401 hariç): kapandı/404 → salt okunur; diğerleri yalnız ilk yüklemede hata ekranı. */
function fetchFailed(e: unknown, incremental: boolean, setClosedHere: (v: boolean) => void, setLoad: SetLoad) {
  if (isGone(e)) {
    setClosedHere(true);
    setLoad("ready");
    return;
  }
  // Kısmi durum: önceden yüklenmiş yazışma korunur, yalnız ilk yüklemede hata ekranı
  setLoad((l) => (l === "ready" && incremental ? l : "error"));
}

/** Son öğe listesi (artımlı çekmede `?after=` için); efektle eşitlenir. */
function useItemsRef(items: ThreadEntry[]) {
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  return itemsRef;
}

/** Yazışma durumu + çekme (yarış korumalı `seq`) + ilk yükleme. */
function useMessageFetch(requestId: string) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>("loading");
  const [items, setItems] = useState<ThreadEntry[]>([]);
  const [chat, setChat] = useState<CustomerChat>("SUPPORTED");
  const [closedHere, setClosedHere] = useState(false);
  const itemsRef = useItemsRef(items);
  const seq = useRef(0);

  const fetchMessages = useCallback(
    async (incremental: boolean) => {
      const my = ++seq.current;
      const after = incremental ? lastConfirmedId(itemsRef.current) : undefined;
      try {
        const r = await api<RequestMessagesResponse>(
          "GET",
          `/support-requests/${requestId}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        );
        if (my !== seq.current) return;
        setItems((cur) => mergeMessages(incremental ? cur : cur.filter((m) => m.pending), r.items));
        setChat(r.customerChat);
        setLoad("ready");
      } catch (e) {
        if (my !== seq.current) return;
        if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
        fetchFailed(e, incremental, setClosedHere, setLoad);
      }
    },
    [requestId, router, itemsRef],
  );

  useEffect(() => {
    void fetchMessages(false);
  }, [fetchMessages]);

  return { load, items, setItems, chat, setChat, closedHere, setClosedHere, fetchMessages };
}

/**
 * Yazışma durumu ve efektleri (sıra: öğe ref'i → ilk yükleme → `activity` → yoklama; kaydırma `useScrollToEnd`
 * bileşende bundan sonra çağrılır).
 */
export function useThreadMessages({ requestId, closedProp, activity, connected }: ThreadOptions) {
  const m = useMessageFetch(requestId);
  const { fetchMessages } = m;
  const closed = closedProp || m.closedHere;

  useEffect(() => {
    if (activity > 0 && !closed) void fetchMessages(true);
  }, [activity, closed, fetchMessages]);

  useEffect(() => {
    if (connected || closed) return;
    const id = setInterval(() => void fetchMessages(true), POLL_MS);
    return () => clearInterval(id);
  }, [connected, closed, fetchMessages]);

  return { ...m, closed };
}

interface ThreadOptions {
  requestId: string;
  closedProp: boolean;
  activity: number;
  /** /ws/panel bağlı değilse panel açıkken yoklanır. */
  connected: boolean;
}

/** Yeni mesajda günlüğü en alta kaydırır; ref günlük kutusuna verilir. */
export function useScrollToEnd(count: number) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);
  return list;
}

type Thread = ReturnType<typeof useThreadMessages>;

/** İyimser satır: sunucu onayına kadar `pending: "sending"`. */
const optimistic = (body: string, clientMsgId: string): ThreadEntry => ({
  id: `tmp-${clientMsgId}`,
  sender: "TECH",
  senderName: null,
  body,
  createdAt: new Date().toISOString(),
  pending: "sending",
  clientMsgId,
});

/** Gönderim hatası → 429 "Çok hızlı" · desteklenmiyor · kapandı · alan hatası · genel hata (sıra korunur). */
function applySendError(
  err: unknown,
  th: Pick<Thread, "setChat" | "setClosedHere">,
  setTooFast: Dispatch<SetStateAction<boolean>>,
  setSendError: Dispatch<SetStateAction<string | null>>,
) {
  if (err instanceof ApiError && err.status === 429) setTooFast(true);
  else if (err instanceof ApiError && err.code === "CHAT_UNSUPPORTED") th.setChat("UNSUPPORTED");
  else if (isGone(err)) th.setClosedHere(true);
  else if (err instanceof ApiError && err.status === 400 && err.fields?.body) setSendError(err.fields.body);
  else setSendError(toUiError(err).message);
}

/** Yazma alanı durumu ve gönderim (iyimser; yankı eşleme `clientMsgId` ile). */
export function useThreadSend(requestId: string, sendDisabled: boolean, th: Thread) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [tooFast, setTooFast] = useState(false);
  const [sending, setSending] = useState(false);
  const { setItems } = th;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (sending || sendDisabled) return;
    const c = checkMessageBody(text);
    if (!c.ok) {
      setSendError(c.empty ? null : c.message);
      return;
    }
    const clientMsgId = newClientMsgId();
    setItems((cur) => [...cur, optimistic(c.body, clientMsgId)]);
    setText("");
    setSendError(null);
    setTooFast(false);
    setSending(true);
    try {
      const r = await api<PostMessageResponse>("POST", `/support-requests/${requestId}/messages`, { body: c.body, clientMsgId });
      // Yankı eşleme: iyimser satır sunucu kimliğiyle onaylanır (aynı id GET'te gelirse tekilleşir)
      setItems((cur) =>
        mergeMessages(
          cur.filter((m) => m.clientMsgId !== clientMsgId),
          [{ id: r.id, sender: "TECH", senderName: null, body: c.body, createdAt: r.createdAt }],
        ),
      );
    } catch (err) {
      setItems((cur) => cur.filter((m) => m.clientMsgId !== clientMsgId));
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      setText(c.body);
      applySendError(err, th, setTooFast, setSendError);
    } finally {
      setSending(false);
    }
  };

  return { text, setText, sendError, setSendError, tooFast, sending, submit };
}
