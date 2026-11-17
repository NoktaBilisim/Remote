// P22 oturum sohbeti WS sözleşmesi ve sabitleri (mimari-p22 r2 §4, §15.1, §15.2, §15.6; ADR-0025 r-P22; AC-264).
// Yaprak modül (zod + `chat.ts` + `ws-multi.ts`'ten `techIdSchema`): `ws.ts` buradan alır, buradan `ws.ts`'e bağ yok (PT-K1).
// Şemalar `z.strictObject`. Akış tek yol: gönderen → sunucu (doğrula → şifrele → kaydet) → herkese ilet; DataChannel `chat`
// yeni kodda yoktur. Misafirde `chat.*` YALNIZ `rs.cap.schat1` bildiren sokette (`guestInboundSchemaFor(…, schat=true)`,
// bit 64); eski Go istemciye hiçbir `chat.*` mesajı gitmez. Go eşi (P22-G) `internal/signal/chat.go`; ortak örnekler
// `fixtures/ws-session-chat.json`.
import { z } from "zod";
import { chatBodySchema, MESSAGE_BODY_MAX, MESSAGE_SENDERS } from "./chat.ts";
import { techIdSchema } from "./ws-multi.ts";

// --- Yetenek belirteci (§4.1, r2 §15.2; kimlik değildir, Caddy loglamaz — G-10) ---
/**
 * Oturum sohbeti belirteci (`/ws/request`'teki talep sohbeti `rs.cap.chat1`'den AYRI). `/ws/guest`'te Go 0.21.0 ve yeni
 * tarayıcı misafir bildirir (tarayıcı istisnası yok — K-P22-10); `/ws/tech`'te yeni konsol her zaman bildirir, bildirmeyen
 * konsol soketi `WS_CLOSE_CONSOLE_OUTDATED` ile kapatılır (S-P22-2). Sunucu yanıtı yine yalnız `rs.v1`.
 */
export const WS_CAP_SCHAT = "rs.cap.schat1";
/** S-P22-2: belirteçsiz `/ws/tech` soketi (yayından önce açık eski konsol sekmesi) bu kodla kapanır. */
export const WS_CLOSE_CONSOLE_OUTDATED = 4426;
/** 4426 kapanış gerekçesi (kişisel veri yok). */
export const WS_CLOSE_CONSOLE_OUTDATED_REASON = "console_outdated";

// --- Sabitler (§4.5, r2 §15.1/§15.2; Go eşi ve fikstür `constants` aynı değerler) ---
/** `chat.history` en çok öğe. */
export const CHAT_HISTORY_MAX = 100;
/**
 * S-P22-1: `chat.history` serileştirilmiş çerçeve üst sınırı (bayt; Go okuma sınırı 64 KiB). En yeniden geriye eklenir,
 * sığmayan için `more: true` (sunucu `lib/ws-budget.ts` `fitNewest`).
 */
export const CHAT_HISTORY_MAX_BYTES = 49_152;
/** Oturum başına gönderen tavanı: TECH kullanıcı başına ve CUSTOMER için ayrı ayrı (aşım → `cap`). */
export const SESSION_CHAT_CAP_PER_SENDER = 2000;
/** Firma başına müşteri oturum sohbeti kovası (dakikada; talep kovasından ayrı anahtar; aşım → `rate`). */
export const SESSION_CHAT_TENANT_CUSTOMER_PER_MIN = 600;
/** İstemci mesaj kimliği (yeniden gönderim tekilliği; UQ(session_id, sender, client_msg_id)). */
export const CHAT_CLIENT_MSG_ID_PATTERN = /^[A-Za-z0-9_-]{16,36}$/;
/**
 * K-P22-15 (Sonra, tarihli; ayrı AC ile uygulanır): asgari istemci politikası — P22-G prod + 60 gün sonra `schat1`
 * bildirmeyen AGENT misafir kabul edilmez. Yalnız sabit; bu pakette kullanan kod yok.
 */
export const SESSION_CHAT_MIN_CLIENT = "0.21.0";

// --- Sözlükler ---
/** `chat.rejected.reason` (§4.2, r2 `outdated`). */
export const CHAT_REJECT_REASONS = ["rate", "cap", "invalid", "forbidden", "not_active", "outdated", "internal"] as const;
export type ChatRejectReason = (typeof CHAT_REJECT_REASONS)[number];
/** Teknisyen `hello` / `peer.joined{guest}` `guestChat`: kabul edilmiş misafir `schat1` bildirdi (`on`) ya da eski (`outdated`). */
export const GUEST_CHAT_STATES = ["on", "outdated"] as const;
export type GuestChatState = (typeof GUEST_CHAT_STATES)[number];
/** `chat.state.reason` (yalnız `enabled: false` iken anlamlı). */
export const CHAT_STATE_REASONS = ["not_active", "ended"] as const;
export type ChatStateReason = (typeof CHAT_STATE_REASONS)[number];

export const chatClientMsgIdSchema = z.string().regex(CHAT_CLIENT_MSG_ID_PATTERN);

// --- Mesajlar ---
const iso = z.iso.datetime();
const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

// Teknisyen / misafir → sunucu (aynı biçim). Teknisyende her zaman şemada (rol kapısı `ROLE_MAY` "talker"); misafirde
// yalnız `hasSessionChat` soketinde.
export const chatSendSchema = z.strictObject({ t: z.literal("chat.send"), clientMsgId: chatClientMsgIdSchema, body: chatBodySchema });
export type ChatSend = z.output<typeof chatSendSchema>;
/**
 * S-P18-K1 kalıbı: `chat.send` zarfı (tip + geçerli `clientMsgId` + metin gövde; gövde içeriği denetlenmez). Tam şema
 * başarısız ama zarf geçerliyse gövde hatasıdır → `chat.rejected{invalid}`, soket açık; zarf da geçersizse 1008.
 */
export const chatSendEnvelopeSchema = z.strictObject({ t: z.literal("chat.send"), clientMsgId: chatClientMsgIdSchema, body: z.string() });
export const techChatInbound = [chatSendSchema] as const;
export const guestChatInbound = [chatSendSchema] as const;

// Sunucu → tüm teknisyenler + `schat1` misafir
/**
 * `chat.message` gövde alanları (yayında ve `chat.history` öğesinde aynı). `tid` + `senderName` yalnız TECH'te
 * (`senderName` = kullanıcı adı, ≤ 100); CUSTOMER'da ad yok (konsol `guestName`'den çözer). Gövde normalize edilmiş saklı
 * metindir (≤ 1.000 kod noktası → ≤ 2.000 UTF-16 birimi).
 */
const chatMessageFields = {
  id: ulid,
  sender: z.enum(MESSAGE_SENDERS),
  tid: techIdSchema.optional(),
  senderName: z.string().min(1).max(100).optional(),
  body: z
    .string()
    .min(1)
    .max(MESSAGE_BODY_MAX * 2),
  createdAt: iso,
};
const customerHasNoTech = (m: { sender: string; tid?: string; senderName?: string }): boolean =>
  m.sender === "TECH" || (m.tid === undefined && m.senderName === undefined);
const TECH_ONLY_MESSAGE = "tid ve senderName yalnız TECH'te";

/** Canlı mesaj. `clientMsgId` YALNIZ gönderenin kendi soketine giden kopyada (yankı = onay); diğerlerinde yok. */
export const chatMessageSchema = z
  .strictObject({ t: z.literal("chat.message"), ...chatMessageFields, clientMsgId: chatClientMsgIdSchema.optional() })
  .refine(customerHasNoTech, { message: TECH_ONLY_MESSAGE });
export type ChatMessage = z.infer<typeof chatMessageSchema>;
/** `chat.history` öğesi: `chat.message` gövdesi, `clientMsgId`'siz. */
export const chatHistoryItemSchema = z.strictObject(chatMessageFields).refine(customerHasNoTech, { message: TECH_ONLY_MESSAGE });
export type ChatHistoryItem = z.infer<typeof chatHistoryItemSchema>;
/**
 * Soket `hello` sonrası (ilk bağlanma, yeniden bağlanma, sonradan katılan teknisyen/izleyici) son ≤ 100 mesaj ve çerçeve
 * ≤ `CHAT_HISTORY_MAX_BYTES`, artan sıra. Yalnız oda ACTIVE iken ve koltuklu teknisyen soketine / kabul edilmiş `schat1`
 * misafire (S-P22-5). `more: true` → konsol "Daha eski mesajlar oturum geçmişinde".
 */
export const chatHistorySchema = z.strictObject({
  t: z.literal("chat.history"),
  items: z.array(chatHistoryItemSchema).max(CHAT_HISTORY_MAX),
  more: z.boolean(),
});
/** Misafire kabulde `true`, oturum bitince `false`; teknisyene `hello` ile birlikte de gider. */
export const chatStateSchema = z.strictObject({
  t: z.literal("chat.state"),
  enabled: z.boolean(),
  reason: z.enum(CHAT_STATE_REASONS).optional(),
});
/** Yalnız gönderene. Soket kapanmaz (şema dışı hariç). */
export const chatRejectedSchema = z.strictObject({
  t: z.literal("chat.rejected"),
  clientMsgId: chatClientMsgIdSchema,
  reason: z.enum(CHAT_REJECT_REASONS),
});
export const serverChatOutbound = [chatMessageSchema, chatHistorySchema, chatStateSchema, chatRejectedSchema] as const;

/**
 * Teknisyen `hello` ve `peer.joined{role:"guest"}` eki (§4.1, `guestVoice` kalıbı). Alan yok = kabul edilmiş misafir yok ya
 * da gözetimsiz oda. Misafire giden `hello`'da YOKTUR (Go ≤ 0.20 katı ayrıştırıcı reddeder).
 */
export const helloChatFields = { guestChat: z.enum(GUEST_CHAT_STATES).optional() };
