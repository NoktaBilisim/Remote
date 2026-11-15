"use client";

import { LoaderCircle, MessageSquare, Send } from "lucide-react";
import { MESSAGE_BODY_MAX } from "@remote/contracts/api/requests";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { ChatRetentionNotice } from "./chat-retention-notice";

export interface ChatItem {
  key: string;
  sender: "TECH" | "CUSTOMER";
  senderName?: string;
  body: string;
  createdAt: string | null;
  /** İyimser gönderim: sunucu yankısı gelene dek true. */
  pending?: boolean;
}

interface RequestChatProps {
  items: ChatItem[];
  enabled: boolean;
  retentionDays: number | null;
  onSend: (body: string) => boolean;
}

/**
 * Bekleme sayfası sohbeti (P18 §8b.4 protokolü): metin düğümü + `pre-wrap` (HTML yok), 1.000 kod noktası, 1 msg/sn,
 * iyimser gönderim. Başlıkta AC-292 saklama satırı tekrar. Taslak bu bileşende: gönderim kapanıp açılınca korunur.
 */
export function RequestChat({ items, enabled, retentionDays, onSend }: RequestChatProps) {
  const [text, setText] = useState("");
  const [last, setLast] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);
  const len = [...text].length;
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [items.length]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    const now = Date.now();
    if (!body || len > MESSAGE_BODY_MAX || now - last < 1000) return;
    if (onSend(body)) {
      setText("");
      setLast(now);
    }
  };

  return (
    <section
      aria-labelledby="wr-chat-h"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm"
      data-testid="wr-chat"
    >
      <ChatHeader retentionDays={retentionDays} />
      <ChatList items={items} listRef={listRef} />
      {enabled && <ChatComposer text={text} len={len} onText={setText} onSubmit={send} />}
    </section>
  );
}

function ChatHeader({ retentionDays }: { retentionDays: number | null }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id="wr-chat-h" className="flex items-center gap-2 text-base font-semibold text-fg">
        <MessageSquare aria-hidden className="size-5 text-fg-muted" />
        {t("wr.chat")}
      </h2>
      {retentionDays !== null && <ChatRetentionNotice days={retentionDays} />}
      <p className="text-xs text-fg-muted">{t("wr.chatNoSecrets")}</p>
    </div>
  );
}

function ChatList({ items, listRef }: { items: ChatItem[]; listRef: RefObject<HTMLOListElement | null> }) {
  if (items.length === 0)
    return (
      <p className="py-4 text-center text-sm text-fg-muted" data-testid="wr-chat-empty">
        {t("wr.chatEmpty")}
      </p>
    );
  return (
    <ol ref={listRef} className="flex max-h-72 flex-col gap-2 overflow-y-auto" aria-live="polite" data-testid="wr-chat-list">
      {items.map((m) => (
        <li
          key={m.key}
          className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
            m.sender === "CUSTOMER" ? "self-end bg-primary-surface text-fg" : "self-start bg-surface-muted text-fg"
          }`}
          data-sender={m.sender}
        >
          <span className="mb-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
            {m.sender === "TECH" ? (m.senderName ?? t("wr.tech")) : t("wr.you")}
            {m.createdAt && <time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>}
            {m.pending && <LoaderCircle aria-label={t("wr.sending")} className="size-3 animate-spin motion-reduce:animate-none" />}
          </span>
          {/* Metin düğümü (HTML yorumlanmaz) */}
          <span className="break-words whitespace-pre-wrap">{m.body}</span>
        </li>
      ))}
    </ol>
  );
}

interface ComposerProps {
  text: string;
  len: number;
  onText: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

/** Gönderim: Enter gönderir, Shift+Enter satır; sınırın %90'ından sonra sayaç. */
function ChatComposer({ text, len, onText, onSubmit }: ComposerProps) {
  const inputId = useId();
  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={inputId} className="sr-only">
          {t("wr.chatInput")}
        </label>
        <textarea
          id={inputId}
          rows={2}
          value={text}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={t("wr.chatInput")}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg shadow-sm placeholder:text-fg-muted focus-visible:border-ring sm:text-sm"
          data-testid="wr-chat-input"
        />
        {len > MESSAGE_BODY_MAX * 0.9 && (
          <span className={`text-xs tabular-nums ${len > MESSAGE_BODY_MAX ? "text-danger" : "text-fg-muted"}`}>
            {len}/{MESSAGE_BODY_MAX}
          </span>
        )}
      </div>
      <Button type="submit" aria-label={t("wr.chatSend")} disabled={!text.trim() || len > MESSAGE_BODY_MAX} data-testid="wr-chat-send">
        <Send aria-hidden className="size-4" />
      </Button>
    </form>
  );
}
