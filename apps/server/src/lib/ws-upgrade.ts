// İki WS başının (signaling/ws.ts: /ws/tech, /ws/guest; requests/ws.ts: /ws/request, /ws/panel) ortak upgrade
// yardımcıları: ret tipi, JSON gönderen eş, çerez ve subprotocol okuma. Değerler (çerez, sır, ticket) loglanmaz.
import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";

/** Upgrade öncesi HTTP reddi (gövdesiz); `reason` yalnız metrik/log etiketi. */
export type UpgradeReject = { status: 403 | 404 | 426 | 429; reason: string };

/** Soket açıksa JSON gönderen eş (`Peer`/`JsonPeer` ile yapısal olarak aynı). */
export function jsonPeer<T>(ws: WebSocket): { send(m: T): void; close(code: number, reason: string): void; isOpen(): boolean } {
  return {
    send: (m) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    },
    close: (code, reason) => ws.close(code, reason),
    isOpen: () => ws.readyState === WebSocket.OPEN,
  };
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** `Sec-WebSocket-Protocol` başlığındaki değerler (virgülle ayrık, kırpılmış). */
export function offeredProtocols(req: IncomingMessage): string[] {
  return String(req.headers["sec-websocket-protocol"] ?? "")
    .split(",")
    .map((s) => s.trim());
}
