// /ws/request (müşteri istemcisi, talep beklerken) ve /ws/panel (teknisyen paneli, tek yönlü) sözleşmesi —
// mimari-protokol §5 (r2), mimari-e9 §2.1–2.3, §13. Zarf/ping/maxPayload/1008 kuralları ws.ts ile aynı.
// Go eşi `internal/request/ws.go`; ortak örnekler `fixtures/ws-request.json` (valid.* geçer, invalid.* reddedilir).
// G-E9-15 (koordinatör kararı a): `request.new` `knownNetwork` yerine `networkMatch` + `knownDevice` taşır.
import { z } from "zod";
import { CANCEL_REASONS, NETWORK_MATCHES, REQUEST_STATUSES } from "./api/requests.ts";

/** `Sec-WebSocket-Protocol: rs.v1, rs.req.<requestSecret>` (yanıt yalnız `rs.v1`). */
export const WS_REQUEST_PREFIX = "rs.req.";

/** /ws/request ve /ws/panel'e özgü kapanış kodları (ws.ts `WS_CLOSE` ile birlikte kullanılır). */
export const WS_REQUEST_CLOSE = {
  /** Aynı talep sırrıyla yeni bağlantı geldi; eski soket kapanır (tek sahip). */
  REPLACED: 4409,
  /** Panel: kullanıcı başına 6. soket. */
  TOO_MANY: 4429,
  /** Panel: oturum/yetki/tenant geçersizleşti (logout, şifre değişimi, 60 sn yeniden doğrulama). */
  AUTH_REVOKED: 4401,
} as const;

/** Gelen mesaj sınırı (§5.1): 5 msg/sn. */
export const WS_REQUEST_RATE_PER_SEC = 5;

const iso = z.iso.datetime();
const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

// --- /ws/request: istemci → sunucu ---
export const requestCancelSchema = z.strictObject({ t: z.literal("request.cancel") });
export const requestDeclineSchema = z.strictObject({ t: z.literal("request.decline") });
export const requestInboundSchema = z.discriminatedUnion("t", [requestCancelSchema, requestDeclineSchema]);
export type RequestInbound = z.infer<typeof requestInboundSchema>;

/** `request.closed` durumları (PENDING/ACCEPTED dışındaki son durumlar). */
export const REQUEST_CLOSED_STATUSES = ["CANCELLED", "EXPIRED", "REJECTED", "CONNECT_FAILED"] as const;
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
  }),
  z.strictObject({ t: z.literal("request.removed"), id: ulid, status: z.enum(REQUEST_STATUSES) }),
  /** Yalnız kabul eden kullanıcının soketlerine (AC-155). */
  z.strictObject({ t: z.literal("request.connect_failed"), id: ulid, sessionId: ulid }),
  /** Yalnız kabul edene: müşteri "Vazgeç" dedi / pencereyi kapattı (r2, §13.3). */
  z.strictObject({ t: z.literal("request.declined"), id: ulid, sessionId: ulid }),
  /** Tenant kovası aşıldı (r2, §13.6): panelde kalıcı uyarı bandı `until`'e kadar. */
  z.strictObject({ t: z.literal("queue.alert"), kind: z.literal("rate_limited"), until: iso }),
]);
export type PanelOutbound = z.infer<typeof panelOutboundSchema>;
