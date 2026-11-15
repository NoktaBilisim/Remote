"use client";

import { Lock, MessageSquare, PhoneCall, RotateCw, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { formatNumber, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  bodyLength,
  checkMessageBody,
  lastConfirmedId,
  MESSAGE_BODY_MAX,
  MESSAGE_UNREADABLE_LABEL,
  mergeMessages,
  newClientMsgId,
  type CustomerChat,
  type PostMessageResponse,
  type RequestMessagesResponse,
  type ThreadEntry,
} from "@/lib/requests/thread";

const POLL_MS = 15_000;

type Load = "loading" | "error" | "ready";

/**
 * Kabul öncesi yazışma paneli (mimari-e11 §8b.8; AC-255). Uçlar §8b.5: GET/POST `/support-requests/:id/messages`.
 * Gövde React metin düğümü (HTML yorumlanmaz, bağlantıya çevrilmez). Gönderim iyimser; 429 → "Çok hızlı" (aria-live).
 * `support_requests.message` yoksa yazma alanı yerine not. Talep kapanınca (409 REQUEST_CLOSED / `closed`) salt okunur bant.
 * `activity` her `request.activity` olayında artar → `?after=` ile yeni mesajlar çekilir.
 */
export function RequestThread({
  requestId,
  customerName,
  canSend,
  closed: closedProp,
  activity,
  connected,
  onClose,
  headingLevel = 2,
}: {
  requestId: string;
  customerName: string;
  canSend: boolean;
  /** Talep kuyruktan düştü (kabul/ret/iptal/süre). */
  closed: boolean;
  activity: number;
  /** /ws/panel bağlı değilse panel açıkken yoklanır. */
  connected: boolean;
  onClose?: () => void;
  headingLevel?: 2 | 3;
}) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>("loading");
  const [items, setItems] = useState<ThreadEntry[]>([]);
  const [chat, setChat] = useState<CustomerChat>("SUPPORTED");
  const [closedHere, setClosedHere] = useState(false);
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [tooFast, setTooFast] = useState(false);
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  const seq = useRef(0);
  const inputId = useId();
  const titleId = useId();
  const closed = closedProp || closedHere;

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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
        if (e instanceof ApiError && (e.code === "REQUEST_CLOSED" || e.status === 404)) {
          setClosedHere(true);
          setLoad("ready");
          return;
        }
        // Kısmi durum: önceden yüklenmiş yazışma korunur, yalnız ilk yüklemede hata ekranı
        setLoad((l) => (l === "ready" && incremental ? l : "error"));
      }
    },
    [requestId, router],
  );

  useEffect(() => {
    void fetchMessages(false);
  }, [fetchMessages]);

  useEffect(() => {
    if (activity > 0 && !closed) void fetchMessages(true);
  }, [activity, closed, fetchMessages]);

  useEffect(() => {
    if (connected || closed) return;
    const id = setInterval(() => void fetchMessages(true), POLL_MS);
    return () => clearInterval(id);
  }, [connected, closed, fetchMessages]);

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  const len = bodyLength(text);
  const over = len > MESSAGE_BODY_MAX;
  const unsupported = chat === "UNSUPPORTED";
  const sendDisabled = !canSend || closed || unsupported || load !== "ready";

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (sending || sendDisabled) return;
    const c = checkMessageBody(text);
    if (!c.ok) {
      setSendError(c.empty ? null : c.message);
      return;
    }
    const clientMsgId = newClientMsgId();
    const tmp: ThreadEntry = {
      id: `tmp-${clientMsgId}`,
      sender: "TECH",
      senderName: null,
      body: c.body,
      createdAt: new Date().toISOString(),
      pending: "sending",
      clientMsgId,
    };
    setItems((cur) => [...cur, tmp]);
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
      if (err instanceof ApiError && err.status === 429) setTooFast(true);
      else if (err instanceof ApiError && err.code === "CHAT_UNSUPPORTED") setChat("UNSUPPORTED");
      else if (err instanceof ApiError && (err.code === "REQUEST_CLOSED" || err.status === 404)) setClosedHere(true);
      else if (err instanceof ApiError && err.status === 400 && err.fields?.body) setSendError(err.fields.body);
      else setSendError(toUiError(err).message);
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={titleId} className="flex min-h-0 flex-col gap-3" data-testid="thread" data-state={load}>
      <div className="flex items-start gap-2">
        <H id={titleId} className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold text-fg">
          <MessageSquare aria-hidden className="size-5 shrink-0 text-fg-muted" />
          <span className="min-w-0 wrap-anywhere">{t("th.title", { name: customerName })}</span>
        </H>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("th.close")}
            data-testid="thread-close"
            className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
          >
            <X aria-hidden className="size-5" />
          </button>
        )}
      </div>

      {closed && (
        <div
          role="status"
          data-testid="thread-closed"
          className="flex items-start gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-fg"
        >
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          {t("th.closed")}
        </div>
      )}
      {!closed && unsupported && (
        <Alert tone="warning" testId="thread-unsupported">
          <span className="inline-flex items-start gap-1.5">
            {t("th.unsupported")}
            <PhoneCall aria-hidden className="mt-0.5 size-4 shrink-0" />
          </span>
        </Alert>
      )}
      {!closed && chat === "OFFLINE" && (
        <Alert tone="info" testId="thread-offline">
          {t("th.offline")}
        </Alert>
      )}

      {load === "loading" ? (
        <div className="flex flex-col gap-2" data-testid="thread-loading" aria-busy="true">
          <span className="sr-only" role="status">
            {t("th.loading")}
          </span>
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="ml-auto h-10 w-2/3" />
          <Skeleton className="h-10 w-1/2" />
        </div>
      ) : load === "error" ? (
        <div className="flex flex-col items-start gap-2" data-testid="thread-error">
          <Alert tone="danger">{t("th.loadError")}</Alert>
          <Button variant="secondary" onClick={() => void fetchMessages(false)}>
            <RotateCw aria-hidden className="size-4" />
            {t("err.retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-md bg-canvas px-4 py-8 text-center text-sm text-fg-muted"
          data-testid="thread-empty"
        >
          <MessageSquare aria-hidden className="size-6" />
          <p className="font-medium text-fg">{t("th.emptyTitle")}</p>
          <p>{canSend && !closed && !unsupported ? t("th.emptyBody") : t("th.emptyBodyRo")}</p>
        </div>
      ) : (
        <div
          ref={list}
          role="log"
          aria-live="polite"
          aria-label={t("th.log")}
          tabIndex={0}
          className="flex max-h-96 min-h-40 flex-col overflow-y-auto rounded-md pr-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          data-testid="thread-log"
        >
          <ol className="flex flex-col gap-2">
            {items.map((m) => {
              const tech = m.sender === "TECH";
              return (
                <li
                  key={m.id}
                  data-testid="thread-msg"
                  data-sender={m.sender}
                  data-pending={m.pending ?? undefined}
                  className={`flex max-w-[85%] min-w-0 flex-col gap-0.5 ${tech ? "items-end self-end" : "items-start self-start"}`}
                >
                  <span className="text-xs text-fg-muted">
                    {tech ? (m.senderName ?? t("th.tech")) : customerName} ·{" "}
                    {m.pending === "sending" ? t("th.sending") : <time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>}
                  </span>
                  <p
                    data-testid="thread-body"
                    className={`max-w-full rounded-lg px-3 py-2 text-sm whitespace-pre-wrap wrap-anywhere ${tech ? "bg-primary-surface" : "bg-surface-muted"} ${m.body === null ? "text-fg-muted italic" : "text-fg"} ${m.pending ? "opacity-70" : ""}`}
                  >
                    {m.body ?? MESSAGE_UNREADABLE_LABEL}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {!closed &&
        (canSend ? (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-1.5" data-testid="thread-form">
            <label htmlFor={inputId} className="text-sm font-medium text-fg">
              {t("th.input")}
            </label>
            <div className="flex items-end gap-2">
              <textarea
                id={inputId}
                data-testid="thread-input"
                rows={2}
                value={text}
                disabled={sendDisabled}
                aria-invalid={over || sendError ? true : undefined}
                aria-describedby={`${inputId}-h ${inputId}-c${sendError ? ` ${inputId}-e` : ""}`}
                onChange={(e) => {
                  // Sayaç 1.000'de durur (§8b.8): fazlası alınmaz
                  const cps = [...e.target.value];
                  setText(cps.length > MESSAGE_BODY_MAX ? cps.slice(0, MESSAGE_BODY_MAX).join("") : e.target.value);
                  setSendError(null);
                }}
                onKeyDown={onKey}
                placeholder={t("th.placeholder")}
                className={`min-h-11 flex-1 resize-y rounded-md border bg-surface px-3 py-2 text-base text-fg shadow-sm placeholder:text-fg-muted disabled:opacity-60 sm:text-sm ${over ? "border-danger" : "border-border"}`}
              />
              <Button
                type="submit"
                aria-label={t("th.send")}
                loading={sending}
                disabled={sendDisabled || over || !text.trim()}
                data-testid="thread-send"
              >
                {!sending && <Send aria-hidden className="size-4" />}
              </Button>
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <p id={`${inputId}-h`} className="text-fg-muted">
                {t("th.hint")}
              </p>
              <p
                id={`${inputId}-c`}
                data-testid="thread-count"
                className={`tabular-nums ${over ? "font-medium text-danger" : "text-fg-muted"}`}
                aria-live={len > MESSAGE_BODY_MAX - 100 ? "polite" : "off"}
              >
                {t("h.n.count", { n: formatNumber(len), max: formatNumber(MESSAGE_BODY_MAX) })}
              </p>
            </div>
            {sendError && (
              <p id={`${inputId}-e`} role="alert" className="text-sm font-medium text-danger" data-testid="thread-send-error">
                {sendError}
              </p>
            )}
            {/* Canlı bölge hep DOM'da; metin yalnız 429'da */}
            <p role="status" className="text-sm text-warning empty:hidden" data-testid="thread-rate">
              {tooFast ? t("th.tooFast") : ""}
            </p>
          </form>
        ) : (
          <p className="text-sm text-fg-muted" data-testid="thread-no-perm">
            {t("th.noPerm")}
          </p>
        ))}
    </section>
  );
}
