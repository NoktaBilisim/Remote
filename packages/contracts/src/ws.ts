// WS sinyalizasyon sözleşmesi (docs/mimari-protokol.md §1–3, P3 kapsamı). Tek kaynak: sunucu gelen her
// mesajı bu şemalarla doğrular (strict — ekstra alan reddedilir); Go istemci aynı sözleşmeyi
// `packages/contracts/fixtures/ws-messages.json` örnekleriyle doğrular (ADR-0004).
// P7+ tipleri (control.*, monitor.request, env.state, quality.summary, file.meta) kendi paketinde eklenir.
import { z } from "zod";

export const WS_SUBPROTOCOL = "rs.v1";
export const WS_TICKET_PREFIX = "rs.ticket.";
export const WS_RECONNECT_PREFIX = "rs.reconnect.";
/** Tek mesaj üst sınırı (AC-17); aşım → 1009 (ws maxPayload, S-P3-1). */
export const WS_MAX_PAYLOAD = 64 * 1024;

/** Kapanış kodları (RFC 6455 + uygulama). */
export const WS_CLOSE = { NORMAL: 1000, POLICY: 1008, TOO_BIG: 1009, AUTH_REVOKED: 4401, REPLACED: 4409 } as const;

export const GUEST_KINDS = ["BROWSER", "AGENT"] as const;
export type GuestKind = (typeof GUEST_KINDS)[number];

export const SESSION_ENDED_REASONS = [
  "tech", "customer", "timeout", "max_duration", "cancelled", "tenant_passive",
  "server", "admin", "auth_revoked", "rejected", "lobby_timeout",
] as const;
export type SessionEndedReason = (typeof SESSION_ENDED_REASONS)[number];

export const WS_ERROR_CODES = ["ADMIT_CODE_INVALID", "CONFLICT", "FORBIDDEN", "RATE_LIMITED", "NOT_FOUND"] as const;
export type WsErrorCode = (typeof WS_ERROR_CODES)[number];

export const CAPS = ["remote_control", "file_transfer"] as const;
export type Cap = (typeof CAPS)[number];

const id = z.string().max(26).optional();
const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const iso = z.iso.datetime();

// --- İstemci → sunucu ---
const sdp = z.string().min(1).max(60_000);
export const sdpOfferSchema = z.strictObject({ t: z.literal("sdp.offer"), id, sdp });
export const sdpAnswerSchema = z.strictObject({ t: z.literal("sdp.answer"), id, sdp });
export const iceSchema = z.strictObject({
  t: z.literal("ice"),
  id,
  candidate: z.string().max(2000),
  sdpMid: z.string().max(32).optional(),
  sdpMLineIndex: z.number().int().min(0).max(16).optional(),
});
export const iceRestartSchema = z.strictObject({ t: z.literal("ice.restart"), id });
export const sessionEndSchema = z.strictObject({ t: z.literal("session.end"), id });
export const guestAdmitSchema = z.strictObject({ t: z.literal("guest.admit"), id, admitCode: z.string().regex(/^\d{4}$/) });
export const guestRejectSchema = z.strictObject({ t: z.literal("guest.reject"), id, guestId: ulid });
export const shareStateSchema = z.strictObject({
  t: z.literal("share.state"),
  id,
  state: z.enum(["sharing", "stopped"]),
  monitors: z
    .array(z.strictObject({ id: z.number().int().min(0).max(64), name: z.string().max(64), w: z.number().int().min(1).max(16384), h: z.number().int().min(1).max(16384), primary: z.boolean() }))
    .max(16)
    .optional(),
  activeMonitor: z.number().int().min(0).max(64).optional(),
});

/** Teknisyenden kabul edilen mesajlar. */
export const techInboundSchema = z.discriminatedUnion("t", [guestAdmitSchema, guestRejectSchema, sdpOfferSchema, iceSchema, iceRestartSchema, sessionEndSchema]);
export type TechInbound = z.infer<typeof techInboundSchema>;

/** Misafirden kabul edilen mesajlar (lobideyken yalnız `session.end`, mimari-protokol §3.1). */
export const guestInboundSchema = z.discriminatedUnion("t", [sdpAnswerSchema, iceSchema, shareStateSchema, sessionEndSchema]);
export type GuestInbound = z.infer<typeof guestInboundSchema>;

// --- Sunucu → istemci ---
export const iceServerSchema = z.strictObject({
  urls: z.array(z.string().max(300)).min(1),
  username: z.string().max(200).optional(),
  credential: z.string().max(200).optional(),
});
export type IceServer = z.infer<typeof iceServerSchema>;

export const serverOutboundSchema = z.discriminatedUnion("t", [
  z.strictObject({
    t: z.literal("hello"),
    role: z.enum(["tech", "guest"]),
    sessionId: ulid,
    peerPresent: z.boolean(),
    guestKind: z.enum(GUEST_KINDS).optional(),
    iceServers: z.array(iceServerSchema),
    /** PENDING oturumda (teknisyen hello'su) null; ACTIVE'de consumedAt + max_active_hours. */
    maxEndsAt: iso.nullable(),
    caps: z.array(z.enum(CAPS)).optional(),
    reconnectToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
    /** Yalnız role=tech hello'sunda, ACTIVE oturumda kabul edilmiş misafirin adı (QA-P4-12, yeniden bağlanma). */
    guestName: z.string().max(100).optional(),
    /** Yalnız role=tech hello'sunda: misafirden gelen son paylaşım durumu (misafir ayrıldıysa "stopped"). */
    share: shareStateSchema.omit({ t: true, id: true }).optional(),
  }),
  z.strictObject({ t: z.literal("lobby.wait"), expiresAt: iso }),
  z.strictObject({ t: z.literal("peer.pending"), guestId: ulid, name: z.string().max(100), guestKind: z.enum(GUEST_KINDS), since: iso }),
  z.strictObject({ t: z.literal("peer.pending.left"), guestId: ulid, reason: z.enum(["left", "timeout", "rejected"]) }),
  z.strictObject({ t: z.literal("ice.servers"), iceServers: z.array(iceServerSchema) }),
  z.strictObject({
    t: z.literal("peer.joined"),
    role: z.enum(["tech", "guest"]),
    guestKind: z.enum(GUEST_KINDS).optional(),
    /** role=guest (teknisyene giden) mesajda kabul edilmiş misafirin adı (QA-P4-12). */
    guestName: z.string().max(100).optional(),
    /** role=guest (teknisyene giden) mesajda ACTIVE oturumun bitişi: consumedAt + max_active_hours (TEST-P4-2). */
    maxEndsAt: iso.optional(),
  }),
  z.strictObject({ t: z.literal("peer.left"), role: z.enum(["tech", "guest"]), reason: z.enum(["disconnect", "ended"]).optional() }),
  z.strictObject({ t: z.literal("sdp.offer"), sdp }),
  z.strictObject({ t: z.literal("sdp.answer"), sdp }),
  iceSchema.omit({ id: true }),
  z.strictObject({ t: z.literal("ice.restart") }),
  shareStateSchema.omit({ id: true }),
  z.strictObject({ t: z.literal("session.ended"), reason: z.enum(SESSION_ENDED_REASONS) }),
  z.strictObject({ t: z.literal("session.warning"), kind: z.literal("max_duration_5min"), endsAt: iso }),
  z.strictObject({ t: z.literal("error"), code: z.enum(WS_ERROR_CODES), message: z.string().max(300) }),
]);
export type ServerOutbound = z.infer<typeof serverOutboundSchema>;
/** Odada saklanan son paylaşım durumu (teknisyen hello `share` alanı). */
export type ShareSnapshot = NonNullable<Extract<ServerOutbound, { t: "hello" }>["share"]>;
