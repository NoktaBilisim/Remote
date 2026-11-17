"use client";

import type { SessionChatItem, SessionChatResponse, SessionChatSummary } from "@remote/contracts/api/sessions";
import { ChevronDown, MessagesSquare, RotateCw } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Muted } from "./sections";

type Load = { kind: "closed" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; data: SessionChatResponse };

/**
 * P22 (mimari-p22 §8.3; AC-264, AC-255): oturum geçmişinde sohbet. Yalnız `detail.chat` varsa (`sessions.view_chat`) sayfaya
 * girer. Kapalı başlar — "Sohbeti göster" tıklaması `GET /sessions/:id/chat` çağırır (görüntüleme audit'i bu tıklamayla; sayfa
 * açılışı audit üretmez). Durumlar: kapalı, yükleniyor (iskelet), hata (Tekrar dene), boş, dolu, eski istemci, anonim.
 */
export function ChatSection({
  sessionId,
  summary,
  anonymized,
  fromRequest,
}: {
  sessionId: string;
  summary: SessionChatSummary;
  anonymized: boolean;
  /** Talepten doğan oturum: oturum sohbeti boş olsa da kabul öncesi yazışma olabilir. */
  fromRequest: boolean;
}) {
  const [load, setLoad] = useState<Load>({ kind: "closed" });
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreErr, setMoreErr] = useState<string | null>(null);

  if (anonymized) return <Muted testId="hchat-anon">{t("p22.h.anon")}</Muted>;
  if (summary.count === 0 && !fromRequest)
    return <Muted testId={summary.legacy ? "hchat-legacy" : "hchat-empty"}>{t(summary.legacy ? "p22.h.legacy" : "p22.h.empty")}</Muted>;

  const open = async () => {
    setLoad({ kind: "loading" });
    try {
      setLoad({ kind: "ok", data: await api<SessionChatResponse>("GET", `/sessions/${sessionId}/chat`) });
    } catch (e) {
      setLoad({ kind: "error", message: toUiError(e).message });
    }
  };

  const more = async (cur: SessionChatResponse) => {
    const last = cur.session.items.at(-1)?.id;
    if (!last || moreBusy) return;
    setMoreBusy(true);
    setMoreErr(null);
    try {
      const r = await api<SessionChatResponse>("GET", `/sessions/${sessionId}/chat?after=${encodeURIComponent(last)}`);
      const seen = new Set(cur.session.items.map((i) => i.id));
      setLoad({
        kind: "ok",
        data: { ...cur, session: { items: [...cur.session.items, ...r.session.items.filter((i) => !seen.has(i.id))], more: r.session.more } },
      });
    } catch (e) {
      setMoreErr(toUiError(e).message);
    } finally {
      setMoreBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="hchat">
      {summary.legacy && (
        <Alert tone="info" testId="hchat-legacy">
          {t("p22.h.legacy")}
        </Alert>
      )}
      {load.kind === "closed" && (
        <div className="flex flex-col items-start gap-1">
          <Button variant="secondary" onClick={() => void open()} data-testid="hchat-show">
            <MessagesSquare aria-hidden className="size-4" />
            {t("p22.h.show", { n: formatNumber(summary.count) })}
          </Button>
          <p className="text-xs text-fg-muted">{t("p22.h.auditNote")}</p>
        </div>
      )}
      {load.kind === "loading" && (
        <div aria-busy="true" className="flex flex-col gap-2" data-testid="hchat-loading">
          <span className="sr-only">{t("p22.h.loading")}</span>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="ml-auto h-10 w-1/2" />
          <Skeleton className="h-10 w-3/5" />
        </div>
      )}
      {load.kind === "error" && (
        <div className="flex flex-col items-start gap-2" data-testid="hchat-error">
          <Alert tone="danger">{load.message}</Alert>
          <Button variant="secondary" onClick={() => void open()} data-testid="hchat-retry">
            <RotateCw aria-hidden className="size-4" />
            {t("err.retry")}
          </Button>
        </div>
      )}
      {load.kind === "ok" && (
        <>
          {load.data.request && (
            <Thread title={t("p22.h.request")} items={load.data.request.items} empty={t("p22.h.requestEmpty")} testId="hchat-request" />
          )}
          <Thread title={t("p22.h.session")} items={load.data.session.items} empty={t("p22.h.empty")} testId="hchat-session" />
          {load.data.session.more && (
            <Button
              variant="secondary"
              loading={moreBusy}
              onClick={() => void more(load.data)}
              className="self-start"
              data-testid="hchat-more"
            >
              {!moreBusy && <ChevronDown aria-hidden className="size-4" />}
              {t("p22.h.more")}
            </Button>
          )}
          {moreErr && <Alert tone="danger">{moreErr}</Alert>}
        </>
      )}
    </div>
  );
}

function Thread({ title, items, empty, testId }: { title: string; items: SessionChatItem[]; empty: string; testId: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2" data-testid={testId}>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {items.length === 0 ? (
        <Muted>{empty}</Muted>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((m) => {
            const tech = m.sender === "TECH";
            return (
              <li
                key={m.id}
                data-testid="hchat-msg"
                className={`flex min-w-0 max-w-[85%] flex-col gap-0.5 ${tech ? "self-end items-end" : "self-start items-start"}`}
              >
                <span className="text-xs text-fg-muted">
                  {tech ? (m.senderName ?? t("p22.h.tech")) : t("p22.h.customer")} ·{" "}
                  <time dateTime={m.createdAt}>{formatDateTime(m.createdAt)}</time>
                </span>
                {m.body === null ? (
                  <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm italic text-fg-muted" data-testid="hchat-unreadable">
                    {t("p22.h.unreadable")}
                  </p>
                ) : (
                  <p
                    className={`max-w-full rounded-lg px-3 py-2 text-sm whitespace-pre-wrap wrap-anywhere text-fg ${tech ? "bg-primary-surface" : "bg-surface-muted"}`}
                  >
                    {m.body}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
