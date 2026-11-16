"use client";

import { LoaderCircle, MessageSquare, Send } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { CHAT_MAX } from "@/lib/dc/ctl";
import type { Collab } from "@/lib/dc/use-collab";
import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Sohbet (AC-35, AC-52; AC-227 gönderen hız sınırı). Mesajlar React metin düğümü olarak basılır (HTML yorumlanmaz; `dangerouslySetInnerHTML`
 * yok). Durumlar: bağlanıyor (pasif), boş, gönderim hatası, liste.
 */
export function ChatPanel({
  collab,
  peerName,
  authorOf,
  readOnlyNote = null,
}: {
  collab: Collab;
  peerName: string;
  /** P28c (§4.5): gelen mesajın `by`'ı → ad (roster'dan; çözülemezse `peerName`). */
  authorOf?: (by: string | undefined) => string;
  /** P28c (§10): izleyici sohbete yazamaz — giriş yerine bu metin. */
  readOnlyNote?: string | null;
}) {
  const [text, setText] = useState("");
  const [err, setErr] = useState(false);
  /** AC-227: gönderen hız sınırı aşıldı — mesaj gönderilmedi, metin girişte kaldı. */
  const [tooFast, setTooFast] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const items = collab.chat.items;

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    const r = collab.sendChat(text);
    setErr(r === "error");
    setTooFast(r === "rate");
    if (r === "sent") setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e as unknown as FormEvent);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="chat-panel">
      {items.length === 0 ? (
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
                key={`${m.from}.${m.id}`}
                className={`flex min-w-0 max-w-[85%] flex-col gap-0.5 ${m.from === "me" ? "self-end items-end" : "self-start items-start"}`}
              >
                <span className="text-xs text-fg-muted">
                  {m.from === "me" ? t("p5.chat.me") : (authorOf?.(m.by) ?? peerName)} ·{" "}
                  <time dateTime={new Date(m.ts).toISOString()}>{formatTime(m.ts)}</time>
                </span>
                <p
                  data-testid="chat-msg"
                  className={`rounded-lg px-3 py-2 text-sm max-w-full whitespace-pre-wrap wrap-anywhere text-fg ${m.from === "me" ? "bg-primary-surface" : "bg-surface-muted"}`}
                >
                  {m.text}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
      {err && (
        <p role="alert" className="text-sm text-danger">
          {t("p5.chat.sendError")}
        </p>
      )}
      {readOnlyNote ? (
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
            maxLength={CHAT_MAX}
            value={text}
            disabled={!collab.chatReady}
            aria-describedby={tooFast ? `${inputId}-rate` : undefined}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={collab.chatReady ? t("p5.chat.placeholder") : t("p5.connecting")}
            className="min-h-11 flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-base text-fg shadow-sm placeholder:text-fg-muted disabled:opacity-60 sm:text-sm"
          />
          <Button type="submit" aria-label={t("p5.chat.send")} disabled={!collab.chatReady || !text.trim()} data-testid="chat-send">
            {collab.chatReady ? (
              <Send aria-hidden className="size-4" />
            ) : (
              <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            )}
          </Button>
        </form>
      )}
      {/* AC-227: canlı bölge hep DOM'da (ekran okuyucu metin değişimini okur); metin yalnız aşımda */}
      <p id={`${inputId}-rate`} role="status" className="text-sm text-warning empty:hidden" data-testid="chat-rate">
        {tooFast ? t("p5.chat.tooFast") : ""}
      </p>
      {text.length > CHAT_MAX - 200 && (
        <p className="text-right text-xs tabular-nums text-fg-muted">
          {text.length}/{CHAT_MAX}
        </p>
      )}
    </div>
  );
}
