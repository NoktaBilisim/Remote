/*
 * WS sinyalizasyon istemcisi (docs/mimari-protokol.md §1–3). Gelen her mesaj contracts şemasıyla doğrulanır;
 * tanınmayan/sonraki paket tipi sessizce yok sayılır. Kimlik bilgisi URL'e YAZILMAZ: misafir ticket/reconnect
 * token'ı yalnız `Sec-WebSocket-Protocol` ile, teknisyen çerezle gider (G-10). Hiçbir değer loglanmaz.
 */
import {
  serverOutboundSchema,
  WS_RECONNECT_PREFIX,
  WS_SUBPROTOCOL,
  WS_TICKET_PREFIX,
  type GuestInboundFull,
  type ServerOutbound,
  type TechInbound,
} from "@remote/contracts/ws";
import type { P5Outbound } from "../dc/ctl";

/** Misafirin yeniden bağlanma penceresi (sunucu 120 sn sonra oturumu bitirir). */
export const RECONNECT_WINDOW_MS = 120_000;

export function wsUrl(path: string, loc: Pick<Location, "protocol" | "host"> = location): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}${path}`;
}

export const guestProtocols = (cred: { ticket: string } | { reconnect: string }): string[] => [
  WS_SUBPROTOCOL,
  "ticket" in cred ? WS_TICKET_PREFIX + cred.ticket : WS_RECONNECT_PREFIX + cred.reconnect,
];

/** Üstel geri çekilme: 1, 2, 4, 8 sn … en çok 10 sn. */
export const backoff = (attempt: number): number => Math.min(1000 * 2 ** attempt, 10_000);

/** Ham metni doğrular; geçersiz/bilinmeyen → null. */
export function parseServerMessage(data: unknown): ServerOutbound | null {
  if (typeof data !== "string") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  const r = serverOutboundSchema.safeParse(raw);
  return r.success ? r.data : null;
}

interface SignalHandlers {
  onMessage: (m: ServerOutbound) => void;
  onClose: (code: number) => void;
  onOpen?: () => void;
}

export class Signal {
  private ws: WebSocket;
  constructor(url: string, protocols: string[] | undefined, h: SignalHandlers) {
    this.ws = new WebSocket(url, protocols);
    this.ws.onopen = () => h.onOpen?.();
    this.ws.onmessage = (e: MessageEvent) => {
      const m = parseServerMessage(e.data);
      if (m) h.onMessage(m);
    };
    this.ws.onclose = (e: CloseEvent) => h.onClose(e.code);
  }
  send(m: TechInbound | GuestInboundFull | P5Outbound): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  /** Kendi isteğimizle kapatma: onClose tetiklenmez (yeniden bağlanma başlamaz). */
  close(): void {
    this.ws.onclose = null;
    this.ws.onmessage = null;
    if (this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000);
  }
}
