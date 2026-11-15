"use client";

import { Lock, MessageSquare, PhoneCall, RotateCw, Send, X } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { bodyLength, MESSAGE_BODY_MAX, MESSAGE_UNREADABLE_LABEL, type CustomerChat, type ThreadEntry } from "@/lib/requests/thread";
import type { Load, useThreadSend } from "./use-thread";

/* RequestThread çizim parçaları: başlık, durum bantları, yazışma gövdesi (5 durum), yazma formu. */

interface ThreadHeadingProps {
  H: "h2" | "h3";
  titleId: string;
  customerName: string;
  onClose?: () => void;
}

export function ThreadHeading({ H, titleId, customerName, onClose }: ThreadHeadingProps) {
  return (
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
  );
}

/** Kapandı (salt okunur) · müşteri sohbeti desteklemiyor · müşteri çevrim dışı. */
export function ThreadBanners({ closed, chat }: { closed: boolean; chat: CustomerChat }) {
  return (
    <>
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
      {!closed && chat === "UNSUPPORTED" && (
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
    </>
  );
}

function ThreadMessage({ m, customerName }: { m: ThreadEntry; customerName: string }) {
  const tech = m.sender === "TECH";
  return (
    <li
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
}

function ThreadLoading() {
  return (
    <div className="flex flex-col gap-2" data-testid="thread-loading" aria-busy="true">
      <span className="sr-only" role="status">
        {t("th.loading")}
      </span>
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="ml-auto h-10 w-2/3" />
      <Skeleton className="h-10 w-1/2" />
    </div>
  );
}

function ThreadEmpty({ writable }: { writable: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-md bg-canvas px-4 py-8 text-center text-sm text-fg-muted"
      data-testid="thread-empty"
    >
      <MessageSquare aria-hidden className="size-6" />
      <p className="font-medium text-fg">{t("th.emptyTitle")}</p>
      <p>{writable ? t("th.emptyBody") : t("th.emptyBodyRo")}</p>
    </div>
  );
}

interface ThreadBodyProps {
  load: Load;
  items: ThreadEntry[];
  customerName: string;
  writable: boolean;
  list: RefObject<HTMLDivElement | null>;
  onRetry: () => void;
}

/** Yazışma gövdesi: yükleniyor · hata (tekrar dene) · boş · günlük (`role="log"`). */
export function ThreadBody({ load, items, customerName, writable, list, onRetry }: ThreadBodyProps) {
  if (load === "loading") return <ThreadLoading />;
  if (load === "error") {
    return (
      <div className="flex flex-col items-start gap-2" data-testid="thread-error">
        <Alert tone="danger">{t("th.loadError")}</Alert>
        <Button variant="secondary" onClick={onRetry}>
          <RotateCw aria-hidden className="size-4" />
          {t("err.retry")}
        </Button>
      </div>
    );
  }
  if (items.length === 0) return <ThreadEmpty writable={writable} />;
  return (
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
        {items.map((m) => (
          <ThreadMessage key={m.id} m={m} customerName={customerName} />
        ))}
      </ol>
    </div>
  );
}

type Send = ReturnType<typeof useThreadSend>;

function ThreadInput({ inputId, send, disabled, over }: { inputId: string; send: Send; disabled: boolean; over: boolean }) {
  const { text, setText, sendError, setSendError, submit } = send;
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };
  return (
    <textarea
      id={inputId}
      data-testid="thread-input"
      rows={2}
      value={text}
      disabled={disabled}
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
  );
}

function ThreadMeta({ inputId, len, over }: { inputId: string; len: number; over: boolean }) {
  return (
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
  );
}

/** Yazma formu: Enter gönderir (Shift+Enter satır), sayaç, alan hatası, 429 canlı bölgesi. */
export function ThreadForm({ inputId, send, disabled }: { inputId: string; send: Send; disabled: boolean }) {
  const { text, sendError, tooFast, sending, submit } = send;
  const len = bodyLength(text);
  const over = len > MESSAGE_BODY_MAX;
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-1.5" data-testid="thread-form">
      <label htmlFor={inputId} className="text-sm font-medium text-fg">
        {t("th.input")}
      </label>
      <div className="flex items-end gap-2">
        <ThreadInput inputId={inputId} send={send} disabled={disabled} over={over} />
        <Button
          type="submit"
          aria-label={t("th.send")}
          loading={sending}
          disabled={disabled || over || !text.trim()}
          data-testid="thread-send"
        >
          {!sending && <Send aria-hidden className="size-4" />}
        </Button>
      </div>
      <ThreadMeta inputId={inputId} len={len} over={over} />
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
  );
}
