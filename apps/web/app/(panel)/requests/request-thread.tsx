"use client";

import { useId } from "react";
import { t } from "@/lib/i18n";
import { ThreadBanners, ThreadBody, ThreadForm, ThreadHeading } from "./thread-parts";
import { useScrollToEnd, useThreadMessages, useThreadSend } from "./use-thread";

interface RequestThreadProps {
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
}

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
}: RequestThreadProps) {
  const th = useThreadMessages({ requestId, closedProp, activity, connected });
  const list = useScrollToEnd(th.items.length);
  const { load, closed, chat } = th;
  const sendDisabled = !canSend || closed || chat === "UNSUPPORTED" || load !== "ready";
  const send = useThreadSend(requestId, sendDisabled, th);
  const inputId = useId();
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="flex min-h-0 flex-col gap-3" data-testid="thread" data-state={load}>
      <ThreadHeading H={headingLevel === 2 ? "h2" : "h3"} titleId={titleId} customerName={customerName} onClose={onClose} />
      <ThreadBanners closed={closed} chat={chat} />
      <ThreadBody
        load={load}
        items={th.items}
        customerName={customerName}
        writable={canSend && !closed && chat !== "UNSUPPORTED"}
        list={list}
        onRetry={() => void th.fetchMessages(false)}
      />
      {!closed &&
        (canSend ? (
          <ThreadForm inputId={inputId} send={send} disabled={sendDisabled} />
        ) : (
          <p className="text-sm text-fg-muted" data-testid="thread-no-perm">
            {t("th.noPerm")}
          </p>
        ))}
    </section>
  );
}
