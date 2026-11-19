"use client";

import { Lock, LoaderCircle, MessageSquare, RotateCw, Send, ShieldCheck } from "lucide-react";
import { MESSAGE_BODY_MAX } from "@remote/contracts/chat";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clipCodePoints, codePoints, type ChatEntry } from "@/lib/chat/model";
import type { SessionChat } from "@/lib/chat/use-session-chat";
import { formatNumber, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Oturum sohbeti (AC-35, 52, 227; P22 AC-264 — sunucu aktarımlı WS, `lib/chat/use-session-chat.ts`). Konsol ve müşteri aynı
 * bileşen. Mesajlar React metin düğümü (HTML yorumlanmaz). Durumlar: bağlanıyor (iskelet), boş, dolu, gönderiliyor / gönderilemedi
 * (+ Tekrar dene), eski istemci (giriş pasif), kapalı (salt okunur bant), kullanılamıyor (eski sunucu), izleyici notu, `more` notu.
 */
export function ChatPanel({
  chat,
  peerName,
  authorOf,
  readOnlyNote = null,
  retentionNote,
}: {
  chat: SessionChat;
  /** Karşı tarafın varsayılan adı (konsolda müşteri, müşteride teknisyen). */
  peerName: string;
  /** P28c: TECH mesajının `tid`'i → ad (roster'dan); çözülemezse `senderName`, o da yoksa `peerName`. */
  authorOf?: (tid: string | undefined) => string | null;
  /** P28c (§10): izleyici sohbete yazamaz — giriş yerine bu metin. */
  readOnlyNote?: string | null;
  /** Başlık altındaki kalıcı saklama notu (konsol: genel cümle; müşteri: gün sayılı AC-292 satırı). */
  retentionNote?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  /** AC-227: gönderen hız sınırı aşıldı (yerel ya da sunucu `rate`) — metin girişte kaldı. */
  const [tooFast, setTooFast] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const { model } = chat;
  const items = model.items;
  const closed = model.enabled === false;
  const connecting = model.enabled === null && !chat.outdated && !chat.unavailable;

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  const serverRate = model.lastReject === "rate";
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    const r = chat.send(text);
    setErr(r.r === "invalid" ? r.message : r.r === "error" ? t("p5.chat.sendError") : null);
    setTooFast(r.r === "rate");
    if (r.r === "sent") setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e as unknown as FormEvent);
  };
  const author = (m: ChatEntry) =>
    m.mine ? t("p5.chat.me") : m.sender === "TECH" ? (authorOf?.(m.tid) ?? m.senderName ?? peerName) : peerName;
  const n = codePoints(text);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="chat-panel" data-enabled={String(model.enabled)}>
      <p className="flex items-start gap-2 text-xs text-fg-muted" data-testid="chat-stored-note">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{retentionNote ?? t("p22.chat.stored")}</span>
      </p>
      {chat.outdated && (
        <Alert tone="warning" testId="chat-outdated">
          {t("p22.chat.outdated")}
        </Alert>
      )}
      {chat.unavailable && (
        <Alert tone="warning" testId="chat-unavailable">
          {t("p22.chat.unavailable")}
        </Alert>
      )}
      {model.more && (
        <p className="text-xs text-fg-muted" data-testid="chat-more">
          {t("p22.chat.more")}
        </p>
      )}
      {connecting && items.length === 0 ? (
        <div aria-busy="true" className="flex flex-col gap-2 py-2" data-testid="chat-loading">
          <span className="sr-only">{t("p5.connecting")}</span>
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="ml-auto h-10 w-2/3" />
        </div>
      ) : items.length === 0 ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-fg-muted"
          data-testid="chat-empty"
        >
          <MessageSquare aria-hidden className="size-6" />
          <p>{t("p5.chat.empty", { name: peerName })}</p>
        </div>
      ) : (
        // role=log liste semantiğini ezmesin diye kapsayıcıda (axe: listitem ebeveyni ol olmalı)
        // TEST-P5-2: kaydırılabilir bölge klavyeyle odaklanır (axe scrollable-region-focusable); halka içe, kesilmesin
        <div
          ref={list}
          role="log"
          aria-live="polite"
          aria-label={t("p5.chat.log")}
          tabIndex={0}
          className="flex max-h-80 min-h-40 flex-1 flex-col overflow-y-auto rounded-md pr-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          data-testid="chat-log"
        >
          <ol className="flex flex-col gap-2">
            {items.map((m) => (
              <li
                key={m.key}
                data-status={m.status}
                className={`flex min-w-0 max-w-[85%] flex-col gap-0.5 ${m.mine ? "self-end items-end" : "self-start items-start"}`}
              >
                <span className="text-xs text-fg-muted">
                  {author(m)} · <time dateTime={m.at}>{formatTime(m.at)}</time>
                </span>
                <p
                  data-testid="chat-msg"
                  className={`rounded-lg px-3 py-2 text-sm max-w-full whitespace-pre-wrap wrap-anywhere text-fg ${m.mine ? "bg-primary-surface" : "bg-surface-muted"} ${m.status === "sending" ? "opacity-70" : ""}`}
                >
                  {m.body}
                </p>
                {m.status === "sending" && (
                  <span className="inline-flex items-center gap-1 text-xs text-fg-muted" data-testid="chat-sending">
                    <LoaderCircle aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
                    {t("p22.chat.sending")}
                  </span>
                )}
                {m.status === "failed" && m.clientMsgId && (
                  <span className="inline-flex flex-wrap items-center gap-2 text-xs text-danger" data-testid="chat-failed">
                    {t("p22.chat.failed")}
                    <Button variant="secondary" disabled={!chat.ready} onClick={() => chat.retry(m.clientMsgId!)} data-testid="chat-retry">
                      <RotateCw aria-hidden className="size-4" />
                      {t("p22.chat.retry")}
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {err && (
        <p role="alert" className="text-sm text-danger" data-testid="chat-error">
          {err}
        </p>
      )}
      {closed ? (
        <p className="flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm text-fg-muted" data-testid="chat-closed">
          <Lock aria-hidden className="size-4 shrink-0" />
          {t("p22.chat.closed")}
        </p>
      ) : readOnlyNote ? (
        <p className="rounded-md bg-surface-muted px-3 py-2 text-sm text-fg-muted" data-testid="chat-readonly">
          {readOnlyNote}
        </p>
      ) : (
        <form onSubmit={submit} className="flex items-end gap-2">
          <label htmlFor={inputId} className="sr-only">
            {t("p5.chat.input")}
          </label>
          <textarea
            id={inputId}
            data-testid="chat-input"
            rows={2}
            value={text}
            disabled={!chat.ready}
            aria-describedby={tooFast || serverRate ? `${inputId}-rate` : undefined}
            onChange={(e) => setText(clipCodePoints(e.target.value, MESSAGE_BODY_MAX))}
            onKeyDown={onKey}
            placeholder={chat.ready ? t("p5.chat.placeholder") : chat.outdated ? t("p22.chat.outdatedShort") : t("p5.connecting")}
            className="min-h-11 flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-base text-fg shadow-sm placeholder:text-fg-muted disabled:opacity-60 sm:text-sm"
          />
          <Button type="submit" aria-label={t("p5.chat.send")} disabled={!chat.ready || !text.trim()} data-testid="chat-send">
            {chat.ready || chat.outdated || closed ? (
              <Send aria-hidden className="size-4" />
            ) : (
              <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            )}
          </Button>
        </form>
      )}
      {/* AC-227: canlı bölge hep DOM'da (ekran okuyucu metin değişimini okur); metin yalnız aşımda */}
      <p id={`${inputId}-rate`} role="status" className="text-sm text-warning empty:hidden" data-testid="chat-rate">
        {tooFast || serverRate ? t("p5.chat.tooFast") : ""}
      </p>
      {n > MESSAGE_BODY_MAX - 200 && (
        <p className="text-right text-xs tabular-nums text-fg-muted" data-testid="chat-counter">
          {formatNumber(n)} / {formatNumber(MESSAGE_BODY_MAX)}
        </p>
      )}
    </div>
  );
}
