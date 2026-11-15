"use client";

import { Clock, Download, MonitorUp, RefreshCw, ShieldCheck, WifiOff, XCircle } from "lucide-react";
import { requestChatOutboundSchema, requestOutboundSchema, type RequestChatMessage } from "@remote/contracts/ws-request";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatRemaining } from "@/lib/format";
import { t } from "@/lib/i18n";
import { wsUrl } from "@/lib/webrtc/signal";
import { reconnectDelay, requestProtocols, shouldReconnect, type StoredRequest } from "@/lib/web-request/flow";
import type { CancelReason } from "@remote/contracts/api/requests";
import { RequestEndScreen, type RequestEnd } from "./request-end";
import { GuestSession } from "../../session/[token]/guest-session";
import { RequestChat, type ChatItem } from "./request-chat";

type Phase =
  | { kind: "connecting" }
  | { kind: "pending"; position: number; expiresAt: number; offset: number }
  | { kind: "accepted"; wsTicket: string; technicianName: string; techVerifyCode: string; admitCode: string | null }
  | { kind: "sharing"; wsTicket: string; technicianName: string; techVerifyCode: string; admitCode: string | null }
  | {
      kind: "closed";
      status: "CANCELLED" | "EXPIRED" | "REJECTED" | "CONNECT_FAILED";
      message?: string;
      reason?: CancelReason;
      /** Müşterinin kendi iptali / "Vazgeç" (sunucu yanıtını beklemeden). */
      byCustomer?: boolean;
    }
  | { kind: "gone" };

const toItem = (m: Omit<RequestChatMessage, "t">): ChatItem => ({
  key: m.clientMsgId ? `c.${m.clientMsgId}` : m.id,
  sender: m.sender,
  senderName: m.senderName,
  body: m.body,
  createdAt: m.createdAt,
});

/**
 * Bekleme sayfası (AC-259): sıra/kalan süre (sunucu saati ofsetiyle), sohbet, iptal; kabulde teknisyen adı + doğrulama
 * kodu (+ kabul kodu) → "Ekranımı paylaş" → `GuestSession` (tarayıcı modu); kapanış ekranları; bağlantı koptu bandı
 * (üstel 1→30 sn; 4xxx/1008'de durur).
 */
export function WaitingRoom({
  request,
  tenantRef,
  retentionDays,
  onFinished,
  onNewRequest,
}: {
  request: StoredRequest;
  tenantRef: string;
  retentionDays: number | null;
  onFinished: () => void;
  onNewRequest: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [lost, setLost] = useState(false);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [chatOn, setChatOn] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState(false);
  const ws = useRef<WebSocket | null>(null);
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
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = () => {
      const s = new WebSocket(wsUrl("/ws/request"), requestProtocols(request.requestSecret));
      ws.current = s;
      s.onopen = () => {
        attempt = 0;
        setLost(false);
      };
      s.onmessage = (ev) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        const chatMsg = requestChatOutboundSchema.safeParse(raw);
        if (chatMsg.success) {
          const m = chatMsg.data;
          if (m.t === "request.chat") setChatOn(m.enabled);
          else if (m.t === "request.messages") setChat(m.items.map(toItem));
          else {
            const it = toItem(m);
            setChat((xs) => (xs.some((x) => x.key === it.key) ? xs.map((x) => (x.key === it.key ? it : x)) : [...xs, it]));
          }
          return;
        }
        const r = requestOutboundSchema.safeParse(raw);
        if (!r.success) return;
        const m = r.data;
        if (m.t === "request.state")
          setPhase({
            kind: "pending",
            position: m.position,
            expiresAt: Date.parse(m.expiresAt),
            offset: Date.parse(m.serverTime) - Date.now(),
          });
        else if (m.t === "request.accepted") {
          setChatOn(false);
          setPhase({
            kind: "accepted",
            wsTicket: m.wsTicket,
            technicianName: m.technicianName,
            techVerifyCode: m.techVerifyCode,
            admitCode: m.admitCode ?? null,
          });
        } else if (m.t === "request.closed") {
          stopped = true;
          finish({ kind: "closed", status: m.status, message: m.message, reason: m.reason });
        }
      };
      s.onclose = (ev) => {
        if (ws.current === s) ws.current = null;
        if (stopped || ended.current) return;
        const k = phaseRef.current.kind;
        if (k === "closed" || k === "sharing" || k === "gone") return;
        if (!shouldReconnect(ev.code)) {
          stopped = true;
          finish({ kind: "gone" });
          return;
        }
        setLost(true);
        timer = setTimeout(connect, reconnectDelay(attempt++));
      };
    };
    connect();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(tick);
      const s = ws.current;
      ws.current = null;
      // Bağlanırken kapatmak tarayıcı konsoluna uyarı yazar → açılınca kapat
      if (s?.readyState === WebSocket.CONNECTING) s.onopen = () => s.close(1000);
      else s?.close(1000);
    };
  }, [request.requestSecret, finish]);

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
      await api("POST", "/public/requests/cancel", { requestSecret: request.requestSecret });
    } catch {
      /* 204 her durumda; ağ hatasında WS üzerinden de denenir */
      sendWs({ t: "request.cancel" });
    } finally {
      setCancelling(false);
      finish({ kind: "closed", status: "CANCELLED", byCustomer: true });
      ws.current?.close(1000);
    }
  };

  const newBtn = (
    <Button onClick={onNewRequest} data-testid="wr-new">
      <RefreshCw aria-hidden className="size-4" />
      {t("wr.new")}
    </Button>
  );

  if (phase.kind === "sharing")
    return (
      <GuestSession
        info={{ technicianName: phase.technicianName, customerName: request.customerName, admitCode: phase.admitCode }}
        verifyCode={phase.techVerifyCode}
        sessionRef=""
        cred={{ ticket: phase.wsTicket }}
        storeKey={null}
      />
    );
  if (phase.kind === "gone") return <RequestEndScreen end="gone" action={newBtn} />;
  if (phase.kind === "closed") {
    const end: RequestEnd =
      phase.status === "REJECTED"
        ? "rejected"
        : phase.status === "EXPIRED"
          ? "expired"
          : phase.status === "CONNECT_FAILED"
            ? "connectFailed"
            : phase.byCustomer || phase.reason === "CUSTOMER"
              ? "cancelledByYou"
              : "closed";
    return (
      <div className="flex flex-col gap-3" data-testid={`wr-closed-${phase.status.toLowerCase()}`}>
        <RequestEndScreen end={end} action={newBtn} />
        {phase.status === "REJECTED" && phase.message && (
          <Alert tone="warning" testId="wr-reject-message">
            <span className="whitespace-pre-wrap">{t("wr.rejectMsg", { msg: phase.message })}</span>
          </Alert>
        )}
      </div>
    );
  }

  if (phase.kind === "accepted")
    return (
      <section
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 text-center shadow-sm sm:p-6"
        data-testid="wr-accepted"
        role="alert"
      >
        <ShieldCheck aria-hidden className="mx-auto size-8 text-success" />
        <h1 className="text-xl font-semibold text-fg">{t("wr.acceptedTitle", { name: phase.technicianName })}</h1>
        <p className="text-sm text-fg-muted">{t("wr.verifyHint")}</p>
        <p className="font-mono text-3xl font-semibold tracking-widest text-fg tabular-nums" data-testid="wr-verify-code">
          {phase.techVerifyCode}
        </p>
        {phase.admitCode && (
          <p className="text-sm text-fg" data-testid="wr-admit-code">
            {t("wr.admitCode")} <span className="font-mono text-lg font-semibold tabular-nums">{phase.admitCode}</span>
          </p>
        )}
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button onClick={() => setPhase({ ...phase, kind: "sharing" })} data-testid="wr-share">
            <MonitorUp aria-hidden className="size-4" />
            {t("wr.share")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              sendWs({ t: "request.decline" });
              finish({ kind: "closed", status: "CANCELLED", byCustomer: true });
            }}
            data-testid="wr-decline"
          >
            <XCircle aria-hidden className="size-4" />
            {t("wr.decline")}
          </Button>
        </div>
        <a
          href={`/api/v1/public/agent/request-download?ref=${encodeURIComponent(tenantRef)}`}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline"
          data-testid="wr-download"
        >
          <Download aria-hidden className="size-4" />
          {t("wr.download")}
        </a>
      </section>
    );

  const remaining = phase.kind === "pending" ? phase.expiresAt - (now + phase.offset) : null;
  return (
    <div className="flex flex-col gap-4">
      {lost && (
        <Alert tone="warning" testId="wr-lost">
          <span className="inline-flex items-center gap-2">
            <WifiOff aria-hidden className="size-4" />
            {t("wr.lost")}
          </span>
        </Alert>
      )}
      <section
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6"
        data-testid="wr-waiting"
        aria-live="polite"
      >
        <h1 className="flex items-center gap-2 text-xl font-semibold text-fg">
          <Clock aria-hidden className="size-5 text-fg-muted" />
          {t("wr.waitTitle")}
        </h1>
        <p className="text-sm text-fg-muted">{t("wr.code", { code: request.requestCode })}</p>
        {phase.kind === "pending" ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-fg-muted">{t("wr.position")}</dt>
              <dd className="text-lg font-semibold text-fg tabular-nums" data-testid="wr-position">
                {phase.position}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t("wr.remaining")}</dt>
              <dd className="text-lg font-semibold text-fg tabular-nums" data-testid="wr-remaining">
                {formatRemaining(remaining ?? 0)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-fg-muted" data-testid="wr-connecting">
            {t("wr.connecting")}
          </p>
        )}
        <Button variant="danger-ghost" className="self-start" loading={cancelling} onClick={() => void cancel()} data-testid="wr-cancel">
          {!cancelling && <XCircle aria-hidden className="size-4" />}
          {t("wr.cancel")}
        </Button>
      </section>
      <RequestChat items={chat} enabled={chatOn && phase.kind === "pending" && !lost} retentionDays={retentionDays} onSend={sendChat} />
    </div>
  );
}
