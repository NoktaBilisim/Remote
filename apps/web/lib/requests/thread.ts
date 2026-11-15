/*
 * P18 kabul öncesi mesajlaşma (mimari-e11 §8b.4, §8b.5, §8b.8; AC-255) — web yüzü. Şema/tip tek kaynak
 * `@remote/contracts/api/requests` (H3); burada yalnız kısa adlar, gövde ön kontrolü ve iyimser liste birleştirme var.
 */
import {
  clientMsgIdSchema,
  MESSAGE_BODY_MAX,
  MESSAGE_UNREADABLE_LABEL,
  requestMessageBodySchema,
  type CustomerChatState,
  type RequestMessageItem,
  type RequestMessageListResponse,
  type SendRequestMessageResponse,
} from "@remote/contracts/api/requests";

export { MESSAGE_BODY_MAX, MESSAGE_UNREADABLE_LABEL };
export type CustomerChat = CustomerChatState;
type RequestMessage = RequestMessageItem;
export type RequestMessagesResponse = RequestMessageListResponse;
export type PostMessageResponse = SendRequestMessageResponse;

type BodyCheck = { ok: true; body: string } | { ok: false; empty: boolean; message: string };

/** Sunucuyla aynı kural (`requestMessageBodySchema`): NFC + trim, 1..1000 kod noktası, ≤ 20 satır, yasak karakter yok. */
export function checkMessageBody(raw: string): BodyCheck {
  const r = requestMessageBodySchema.safeParse(raw);
  if (r.success) return { ok: true, body: r.data };
  return { ok: false, empty: raw.trim() === "", message: r.error.issues[0]?.message ?? "" };
}

/** Sayaç (kod noktası; sunucuyla aynı birim). */
export const bodyLength = (s: string) => [...s.normalize("NFC")].length;

let seq = 0;
/** İyimser gönderimde yankı eşlemesi için istemci kimliği (`clientMsgIdSchema`). */
export function newClientMsgId(rand: () => number = Math.random): string {
  seq = (seq + 1) % 1_000_000;
  const id = `w${Date.now().toString(36)}${seq.toString(36)}${Math.floor(rand() * 1e9).toString(36)}`.slice(0, 36);
  return clientMsgIdSchema.parse(id);
}

export interface ThreadEntry extends RequestMessage {
  /** İyimser satır: sunucu onayı bekleniyor. */
  pending?: "sending";
  clientMsgId?: string;
}

/** Sunucudan gelen öğeleri birleştirir: id ile tekil, `createdAt` + id artan; iyimser satırlar sonda kalır. */
export function mergeMessages(current: readonly ThreadEntry[], incoming: readonly RequestMessage[]): ThreadEntry[] {
  const byId = new Map<string, ThreadEntry>();
  for (const m of current) if (!m.pending) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  const confirmed = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const pending = current.filter((m) => m.pending && !byId.has(m.id));
  return [...confirmed, ...pending];
}

/** Son onaylı mesaj id'si (`?after=` için). */
export const lastConfirmedId = (items: readonly ThreadEntry[]): string | undefined => items.filter((m) => !m.pending).at(-1)?.id;
