// /ws/request (müşteri istemcisi, talep beklerken) ve /ws/panel (teknisyen paneli, tek yönlü) sözleşmesi —
// mimari-protokol §5 (r2), mimari-e9 §2.1–2.3, §13. Zarf/ping/maxPayload/1008 kuralları ws.ts ile aynı.
// Go eşi `internal/request/ws.go`; ortak örnekler `fixtures/ws-request.json` (valid.* geçer, invalid.* reddedilir).
// P8c (mimari-e10 §5.4): 0.9.x istemci `request.closed.reason`'ı sıkı doğrular → sunucu yeni nedenleri `TENANT_PASSIVE`'e eşler
// (`LEGACY_CANCEL_REASONS`). `request.new` += `customerFirm`, `viaBinding`, `bindingRevoked`, `staleSource`.
// G-E9-15 (koordinatör kararı a): `request.new` `knownNetwork` yerine `networkMatch` + `knownDevice` taşır.
import { z } from "zod";
import {
  CANCEL_REASONS,
  clientMsgIdSchema,
  MESSAGE_BODY_MAX,
  MESSAGE_HISTORY_WS,
  MESSAGE_SENDERS,
  NETWORK_MATCHES,
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  requestMessageBodySchema,
} from "./api/requests.ts";

/** `Sec-WebSocket-Protocol: rs.v1, rs.req.<requestSecret>` (yanıt yalnız `rs.v1`). */
export const WS_REQUEST_PREFIX = "rs.req.";

/** /ws/request ve /ws/panel'e özgü kapanış kodları (ws.ts `WS_CLOSE` ile birlikte kullanılır). */
export const WS_REQUEST_CLOSE = {
  /** Aynı talep sırrıyla yeni bağlantı geldi; eski soket kapanır (tek sahip). */
  REPLACED: 4409,
  /**
   * Panel: kullanıcı başına 6. soket (gerekçe `too_many`) ya da P14a (AC-216) kimlik oturumu başına 30/dk upgrade sınırı
   * aşıldı (gerekçe `retry=<sn>`; WS'de `Retry-After` yok — `panelRetryReason` / `parsePanelRetry`).
   */
  TOO_MANY: 4429,
  /** Panel: oturum/yetki/tenant geçersizleşti (logout, şifre değişimi, 60 sn yeniden doğrulama). */
  AUTH_REVOKED: 4401,
} as const;

/** P14a (AC-216): `/ws/panel` upgrade'i kimlik oturumu başına dakikada en çok bu kadar (IP kovası ayrıca geçerli). */
export const WS_PANEL_UPGRADES_PER_MIN = 30;
const PANEL_RETRY_RE = /^retry=([1-9][0-9]{0,4})$/;
/** 4429 kapanış gerekçesi: `retry=<sn>` (tam sayı saniye, ≥ 1). */
export const panelRetryReason = (sec: number): string => `retry=${Math.min(99_999, Math.max(1, Math.ceil(sec)))}`;
/** 4429 gerekçesinden bekleme saniyesi; `retry=` biçiminde değilse (ör. `too_many`) null. */
export function parsePanelRetry(reason: string): number | null {
  const m = PANEL_RETRY_RE.exec(reason);
  return m ? Number(m[1]) : null;
}

/** Gelen mesaj sınırı (§5.1): 5 msg/sn. */
export const WS_REQUEST_RATE_PER_SEC = 5;

const iso = z.iso.datetime();
const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

// --- /ws/request: istemci → sunucu ---
export const requestCancelSchema = z.strictObject({ t: z.literal("request.cancel") });
export const requestDeclineSchema = z.strictObject({ t: z.literal("request.decline") });
export const requestInboundSchema = z.discriminatedUnion("t", [requestCancelSchema, requestDeclineSchema]);
export type RequestInbound = z.infer<typeof requestInboundSchema>;

/**
 * P18 (mimari-e11 §8b.4; AC-255): yetenek bildirimi `Sec-WebSocket-Protocol: rs.v1, rs.req.<sır>, rs.cap.chat1` (yanıt yine
 * yalnız `rs.v1`). Bildirmeyen soket (≤ 0.11.0 istemci) yeni tipte HİÇBİR mesaj almaz; `request.message` gönderirse 1008.
 */
export const WS_REQUEST_CAP_CHAT = "rs.cap.chat1";
export const requestMessageInboundSchema = z.strictObject({
  t: z.literal("request.message"),
  body: requestMessageBodySchema,
  clientMsgId: clientMsgIdSchema,
});
/**
 * S-P18-K1: `request.message` zarfı (tip + geçerli `clientMsgId` + metin gövde; gövde içeriği denetlenmez). Yetenekli
 * sokette tam şema başarısız ama zarf geçerliyse gövde hatasıdır → `error VALIDATION`, soket açık kalır; zarf/JSON da
 * geçersizse 1008.
 */
export const requestMessageEnvelopeSchema = z.strictObject({
  t: z.literal("request.message"),
  body: z.string(),
  clientMsgId: clientMsgIdSchema,
});
/** S-P18-T1: yalnız `caps.chat` soketinde kullanılır; yeteneksiz sokette `requestInboundSchema` (mesaj şema dışı → 1008). */
export const requestInboundChatSchema = z.discriminatedUnion("t", [requestCancelSchema, requestDeclineSchema, requestMessageInboundSchema]);
export type RequestInboundChat = z.output<typeof requestInboundChatSchema>;

/** `request.closed` durumları (PENDING/ACCEPTED dışındaki son durumlar). */
export const REQUEST_CLOSED_STATUSES = ["CANCELLED", "EXPIRED", "REJECTED", "CONNECT_FAILED"] as const;
/** 0.9.x istemcinin bildiği nedenler; diğerleri ona `TENANT_PASSIVE` olarak gider (aynı genel mesaj). */
export const LEGACY_CANCEL_REASONS = ["CUSTOMER", "DISCONNECTED", "TENANT_PASSIVE"] as const;
export const REQUEST_WS_ERROR_CODES = ["RATE_LIMITED", "VALIDATION", "INTERNAL"] as const;

// --- /ws/request: sunucu → istemci ---
export const requestOutboundSchema = z.discriminatedUnion("t", [
  z.strictObject({
    t: z.literal("request.state"),
    status: z.literal("PENDING"),
    requestCode: z.string().regex(/^\d{6}$/),
    position: z.number().int().min(1),
    createdAt: iso,
    expiresAt: iso,
    serverTime: iso,
  }),
  z.strictObject({
    t: z.literal("request.accepted"),
    wsTicket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    technicianName: z.string().min(1).max(100),
    techVerifyCode: z.string().regex(/^\d{4}$/),
    ticketExpiresAt: iso,
    /**
     * P15 (AC-239): yalnız tenant ayarı `requireAcceptCode` açıkken. Müşteri ekranında gösterilen 4 haneli kabul kodu;
     * `/ws/guest` bağlantısı lobiye düşer (`lobby.wait`), teknisyen kodu konsola girer (AC-112 kuralları). Ayar kapalıyken
     * alan yoktur (0.10.x istemci sıkı ayrıştırır).
     */
    admitCode: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
  }),
  z
    .strictObject({
      t: z.literal("request.closed"),
      status: z.enum(REQUEST_CLOSED_STATUSES),
      reason: z.enum(CANCEL_REASONS).optional(),
      message: z.string().max(200).optional(),
    })
    .refine((m) => (m.message === undefined || m.status === "REJECTED") && (m.reason === undefined || m.status === "CANCELLED"), {
      message: "message yalnız REJECTED'te, reason yalnız CANCELLED'da",
    }),
  z.strictObject({ t: z.literal("error"), code: z.enum(REQUEST_WS_ERROR_CODES), message: z.string().max(300) }),
]);
export type RequestOutbound = z.infer<typeof requestOutboundSchema>;

/**
 * P18: yalnız `rs.cap.chat1` soketlerine giden mesajlar. `requestOutboundSchema`'dan AYRI birlik (tip düzeyinde ayrım):
 * hub `sendToRequest` bunları taşıyamaz, yalnız `sendChat` (yetenek kontrollü) taşır. Eski istemci (`ParseServer`
 * DecodeStrict) bu tiplerde 1008 ile kapatır → talep iptal olur; bu yüzden fikstürde ayrı anahtarlar (`requestChat*`).
 */
const chatMessageFields = {
  id: ulid,
  sender: z.enum(MESSAGE_SENDERS),
  /** Yalnız TECH'te (teknisyen adı, ≤ 100). */
  senderName: z.string().min(1).max(100).optional(),
  body: z
    .string()
    .min(1)
    .max(MESSAGE_BODY_MAX * 2),
  createdAt: iso,
  /** Kendi mesajının yankısında (onay). */
  clientMsgId: clientMsgIdSchema.optional(),
};
export const requestChatMessageSchema = z.strictObject({ t: z.literal("request.message"), ...chatMessageFields });
export const requestChatOutboundSchema = z.discriminatedUnion("t", [
  requestChatMessageSchema,
  /** Bağlantı (ve yeniden bağlantı) sonrası son 50 mesaj, artan sıra. */
  z.strictObject({ t: z.literal("request.messages"), items: z.array(z.strictObject(chatMessageFields)).max(MESSAGE_HISTORY_WS) }),
  /** Talep PENDING dışına çıkınca `false` (sonra mevcut `request.accepted`/`request.closed`). */
  z.strictObject({ t: z.literal("request.chat"), enabled: z.boolean() }),
]);
export type RequestChatOutbound = z.infer<typeof requestChatOutboundSchema>;
export type RequestChatMessage = z.infer<typeof requestChatMessageSchema>;

// --- /ws/panel: sunucu → panel (istemciden mesaj YOK; her mesaj 1008) ---
export const panelOutboundSchema = z.discriminatedUnion("t", [
  z.strictObject({ t: z.literal("queue.count"), pending: z.number().int().min(0) }),
  z.strictObject({
    t: z.literal("request.new"),
    id: ulid,
    requestCode: z.string().regex(/^\d{6}$/),
    customerName: z.string().max(80),
    /** Açıklamanın ilk 100 kod noktası, düz metin. */
    preview: z.string().max(400),
    networkMatch: z.enum(NETWORK_MATCHES),
    knownDevice: z.boolean(),
    createdAt: iso,
    /** P8c (AC-176): toast "Yeni destek talebi — <müşteri firma | Genel>". */
    customerFirm: z.strictObject({ id: ulid, name: z.string().max(100) }).nullable(),
    /** r2 (§15.1, §15.7): kayıtla açıldı ve kayıt etkin (oluşturma anında). */
    viaBinding: z.boolean(),
    bindingRevoked: z.boolean(),
    staleSource: z.boolean(),
    /**
     * P18 (mimari-e11 §8b.4; AC-257, 258): sunucu her zaman gönderir. Şemada opsiyonel: P18 öncesi kayıtlı fikstürler ve
     * yayın sırasında açık kalan sekme (alan yoksa kuyruk 60 sn yoklamada düzelir).
     */
    priority: z.enum(REQUEST_PRIORITIES).optional(),
    slaDueAt: iso.nullable().optional(),
    afterHours: z.boolean().optional(),
    /**
     * P18 H3 (AC-255): müşteri istemcisinin sohbet desteği (oluşturma anında `clientVersion >= CHAT_MIN_CLIENT_VERSION`
     * tahmini; kesin durum `GET …/messages` `customerChat`'tedir — soket yeteneği). Şemada opsiyonel (eski fikstür/sekme).
     */
    customerChat: z.enum(["SUPPORTED", "UNSUPPORTED"]).optional(),
  }),
  z.strictObject({ t: z.literal("request.removed"), id: ulid, status: z.enum(REQUEST_STATUSES) }),
  /** Yalnız kabul eden kullanıcının soketlerine (AC-155). */
  z.strictObject({ t: z.literal("request.connect_failed"), id: ulid, sessionId: ulid }),
  /** Yalnız kabul edene: müşteri "Vazgeç" dedi / pencereyi kapattı (r2, §13.3). */
  z.strictObject({ t: z.literal("request.declined"), id: ulid, sessionId: ulid }),
  /**
   * P18 (AC-256, 257): atama/öncelik değişimi — tenant geneli. Web `assignedTo.id === me` ise toast + ses (K-P18-9).
   * Kullanıcı pasife alma / yetki kaybı ile kalkan atamada da gider (S-P18-T5; mezar taşı adı yayılmaz).
   */
  z.strictObject({
    t: z.literal("request.updated"),
    id: ulid,
    priority: z.enum(REQUEST_PRIORITIES),
    assignedTo: z.strictObject({ id: ulid, name: z.string().max(100) }).nullable(),
    slaDueAt: iso.nullable(),
  }),
  /**
   * P18 H3 (AC-255, S-P18-T4): talepte yeni mesaj — GÖVDE TAŞIMAZ (panel REST'ten `after=` ile çeker). Talep başına ≤ 1/sn
   * birleştirilir (son sender/at). Tenant'ın bütün panel soketlerine.
   */
  z.strictObject({ t: z.literal("request.activity"), id: ulid, kind: z.literal("message"), sender: z.enum(MESSAGE_SENDERS), at: iso }),
  /** Tenant kovası aşıldı (r2, §13.6): panelde kalıcı uyarı bandı `until`'e kadar. */
  z.strictObject({ t: z.literal("queue.alert"), kind: z.literal("rate_limited"), until: iso }),
]);
export type PanelOutbound = z.infer<typeof panelOutboundSchema>;
