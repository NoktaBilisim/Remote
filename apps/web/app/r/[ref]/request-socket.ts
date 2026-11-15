import { requestChatOutboundSchema, requestOutboundSchema, type RequestChatMessage } from "@remote/contracts/ws-request";
import type { CancelReason } from "@remote/contracts/api/requests";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { wsUrl } from "@/lib/webrtc/signal";
import { reconnectDelay, requestProtocols, shouldReconnect } from "@/lib/web-request/flow";
import type { ChatItem } from "./request-chat";

export type Phase =
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

export type ClosedPhase = Extract<Phase, { kind: "closed" }>;
export type AcceptedPhase = Extract<Phase, { kind: "accepted" }>;

const toItem = (m: Omit<RequestChatMessage, "t">): ChatItem => ({
  key: m.clientMsgId ? `c.${m.clientMsgId}` : m.id,
  sender: m.sender,
  senderName: m.senderName,
  body: m.body,
  createdAt: m.createdAt,
});

/** Soket olaylarının yazdığı durum (bekleme kancasının setter'ları). */
interface FrameSink {
  setChatOn: Dispatch<SetStateAction<boolean>>;
  setChat: Dispatch<SetStateAction<ChatItem[]>>;
  setPhase: Dispatch<SetStateAction<Phase>>;
  finish: (p: Phase) => void;
}

/** Sohbet çerçevesi mi? Öyleyse uygulanır (`true`). */
function applyChatFrame(raw: unknown, sink: FrameSink): boolean {
  const chatMsg = requestChatOutboundSchema.safeParse(raw);
  if (!chatMsg.success) return false;
  const m = chatMsg.data;
  if (m.t === "request.chat") sink.setChatOn(m.enabled);
  else if (m.t === "request.messages") sink.setChat(m.items.map(toItem));
  else {
    const it = toItem(m);
    sink.setChat((xs) => (xs.some((x) => x.key === it.key) ? xs.map((x) => (x.key === it.key ? it : x)) : [...xs, it]));
  }
  return true;
}

/** `/ws/request` çerçevesi → durum. Önce sohbet şeması, sonra talep şeması; tanınmayan çerçeve yok sayılır. */
function applyFrame(raw: unknown, sink: FrameSink, stop: () => void): void {
  if (applyChatFrame(raw, sink)) return;
  const r = requestOutboundSchema.safeParse(raw);
  if (!r.success) return;
  const m = r.data;
  if (m.t === "request.state")
    sink.setPhase({
      kind: "pending",
      position: m.position,
      expiresAt: Date.parse(m.expiresAt),
      offset: Date.parse(m.serverTime) - Date.now(),
    });
  else if (m.t === "request.accepted") {
    sink.setChatOn(false);
    sink.setPhase({
      kind: "accepted",
      wsTicket: m.wsTicket,
      technicianName: m.technicianName,
      techVerifyCode: m.techVerifyCode,
      admitCode: m.admitCode ?? null,
    });
  } else if (m.t === "request.closed") {
    stop();
    sink.finish({ kind: "closed", status: m.status, message: m.message, reason: m.reason });
  }
}

/** JSON çerçeve; bozuksa `null` (yok sayılır). */
function parseFrame(data: unknown): { raw: unknown } | null {
  try {
    return { raw: JSON.parse(String(data)) };
  } catch {
    return null;
  }
}

function closeSocket(ws: RefObject<WebSocket | null>): void {
  const s = ws.current;
  ws.current = null;
  // Bağlanırken kapatmak tarayıcı konsoluna uyarı yazar → açılınca kapat
  if (s?.readyState === WebSocket.CONNECTING) s.onopen = () => s.close(1000);
  else s?.close(1000);
}

interface SocketHooks {
  ws: RefObject<WebSocket | null>;
  /** Son durum (kapanış/paylaşım/bulunamadı): kopuşta yeniden bağlanılmaz. */
  done: () => boolean;
  sink: FrameSink;
  setLost: (v: boolean) => void;
}

/**
 * `/ws/request` bağlantısı: çerçeveler `applyFrame`'e; kopuşta üstel 1→30 sn yeniden bağlanma (4xxx/1008'de durur →
 * "bulunamadı"). `halt` yeniden bağlanmayı keser, `close` soketi kapatır (efekt temizliğinde bu sırayla).
 */
export function startRequestSocket(secret: string, h: SocketHooks): { halt: () => void; close: () => void } {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  const connect = () => {
    const s = new WebSocket(wsUrl("/ws/request"), requestProtocols(secret));
    h.ws.current = s;
    s.onopen = () => {
      attempt = 0;
      h.setLost(false);
    };
    s.onmessage = (ev) => {
      const f = parseFrame(ev.data);
      if (f) applyFrame(f.raw, h.sink, stop);
    };
    s.onclose = (ev) => {
      if (h.ws.current === s) h.ws.current = null;
      if (stopped || h.done()) return;
      if (!shouldReconnect(ev.code)) {
        stopped = true;
        h.sink.finish({ kind: "gone" });
        return;
      }
      h.setLost(true);
      timer = setTimeout(connect, reconnectDelay(attempt++));
    };
  };
  connect();
  return {
    halt: () => {
      stopped = true;
      clearTimeout(timer);
    },
    close: () => closeSocket(h.ws),
  };
}
