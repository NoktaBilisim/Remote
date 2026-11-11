// /api/v1/sessions ve /api/v1/public/sessions sözleşmesi (mimari-api.md, P2 kısmı).
// P3: resolve joinNonce/nonceExpiresAt, join, terminate. P4: resolve consentText + abuseEmail, join consentTextId zorunlu (G-24, AC-127).
import { z } from "zod";

export const SESSION_STATUSES = ["PENDING", "ACTIVE", "ENDED", "EXPIRED", "CANCELLED"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_ENDED_BY = ["TECH", "CUSTOMER", "ADMIN", "SYSTEM"] as const;
export type SessionEndedBy = (typeof SESSION_ENDED_BY)[number];

/** Liste üst sınırı (mimari-api.md "Sayfalama"). */
export const SESSION_PAGE_SIZE_MAX = 100;

/** Token: 32 bayt base64url = 43 karakter (AC-1). Kod: 8 hane (AC-3). */
export const sessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Geçersiz bağlantı");
export const sessionCodeSchema = z.string().regex(/^\d{8}$/, "Kod 8 haneli olmalı");

export const createSessionInputSchema = z.object({});
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;

export const listSessionsQuerySchema = z.object({
  status: z.enum(SESSION_STATUSES).optional(),
  /** USER rolünde yok sayılır (yalnız kendi oturumları, AC-61). */
  technicianId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Geçersiz kimlik").optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(SESSION_PAGE_SIZE_MAX).default(25),
});
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;

export const resolveSessionInputSchema = z.union([
  z.object({ token: sessionTokenSchema, clientKind: z.enum(["BROWSER", "AGENT"]) }),
  z.object({ code: sessionCodeSchema, clientKind: z.enum(["BROWSER", "AGENT"]) }),
]);
export type ResolveSessionInput = z.infer<typeof resolveSessionInputSchema>;

export const sessionStatusQuerySchema = z.object({ ref: z.string().regex(/^[A-Za-z0-9_-]{43}[0-9A-HJKMNP-TV-Z]{26}$/) });

/** POST /sessions yanıtı. `link` yalnız burada döner (düz token DB'de yok, G-22). */
export interface CreateSessionResponse {
  id: string;
  /** `${PUBLIC_BASE_URL}/session/<token>` */
  link: string;
  /** 8 hane, boşluksuz; ekranda "4829 1376" biçiminde gösterilir. */
  code: string;
  techVerifyCode: string;
  expiresAt: string;
  status: "PENDING";
}

/** GET /sessions öğesi ve GET /sessions/:id gövdesi. `code` yalnız PENDING iken dolu; link hiç yok. */
export interface SessionView {
  id: string;
  status: SessionStatus;
  code: string | null;
  techVerifyCode: string;
  technician: { id: string; name: string };
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
  endedBy: SessionEndedBy | null;
  endReason: string | null;
}

export interface SessionListResponse {
  items: SessionView[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CancelSessionResponse {
  status: "CANCELLED";
}

/** Tenant'ın güncel KVKK aydınlatma metni (P4, AC-29/127). `sha256` = SHA-256(UTF-8 body) hex. */
export interface ConsentTextView {
  id: string;
  version: number;
  /** Düz metin; istemci `textContent` ile basar (HTML değildir). */
  body: string;
  sha256: string;
}

/** POST /public/sessions/resolve yanıtı. */
export interface ResolveSessionResponse {
  /** Opak; GET /public/sessions/status?ref= yoklaması için. Token değildir. */
  sessionRef: string;
  tenant: { name: string; logoUrl: string | null };
  technician: { name: string; avatarUrl: string | null };
  techVerifyCode: string;
  expiresAt: string;
  /** Tek kullanımlık, 60 sn; istemci türüne (clientKind) bağlıdır (ADR-0012). */
  joinNonce: string;
  nonceExpiresAt: string;
  /** Karşılamada gösterilip onaylanan metin; join'de `consentTextId` olarak geri gönderilir (P4). */
  consentText: ConsentTextView;
  /** "Kötüye kullanımı bildir" `mailto:` adresi (AC-125): ABUSE_EMAIL; production'da yoksa null (bağlantı gizlenir). Super Admin e-postasına düşme yalnız production dışında (S-P4-1). */
  abuseEmail: string | null;
}

/**
 * Misafir adında yasak karakterler (S-P4-3, S-P4-T2-1): Unicode kategori tabanlı — Cc (C0/C1 kontrol), Cf (biçim:
 * U+00AD, U+061C, U+200B–200F, bidi U+202A–202E/2066–2069, U+2060–2064, U+FEFF, U+FFF9–FFFB, etiketler U+E0000–E007F),
 * Zl/Zp (U+2028/2029) + U+034F (CGJ, Mn) ve U+180E. Ad teknisyen ekranında ve audit'te görünür; yön/görünmez
 * karakterle sahte ad üretimi engellenir. ZWJ'li emoji desteklenmez (bilinçli).
 */
export const UNSAFE_NAME_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034F\u180E]/u;

/** POST /public/sessions/join (mimari-api.md). `consentTextId` oturumun tenant'ının güncel sürümü değilse 400 VALIDATION, fields.consentTextId (G-24, AC-127). */
export const joinSessionInputSchema = z.strictObject({
  joinNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Geçersiz istek"),
  customerName: z
    .string()
    .refine((v) => !UNSAFE_NAME_CHARS.test(v), "Ad görünmez veya kontrol karakteri içeremez")
    .trim()
    .min(2, "Ad en az 2 karakter olmalı")
    .max(100),
  customerEmail: z.email().max(190).optional(),
  consentTextId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Aydınlatma metni geçersiz"),
  consentAccepted: z.literal(true, "Aydınlatma metni onaylanmalı"),
});
export type JoinSessionInput = z.infer<typeof joinSessionInputSchema>;

/** iceServers ve reconnectToken YOK — admit sonrası `hello`'da (G-01, G-13). */
export interface JoinSessionResponse {
  /** WS `Sec-WebSocket-Protocol: rs.v1, rs.ticket.<wsTicket>`; 60 sn, tek kullanımlık. */
  wsTicket: string;
  /** 4 hane; yalnız bu misafire gösterilir, müşteri teknisyene okur. */
  admitCode: string;
  technicianName: string;
}

export const terminateSessionInputSchema = z.strictObject({ reason: z.string().trim().max(200).optional() });
export type TerminateSessionInput = z.infer<typeof terminateSessionInputSchema>;
export interface TerminateSessionResponse {
  status: "ENDED";
  endedBy: "ADMIN";
}

export interface PublicSessionStatusResponse {
  status: SessionStatus;
}
