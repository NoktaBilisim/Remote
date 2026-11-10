// /api/v1/sessions ve /api/v1/public/sessions sözleşmesi (mimari-api.md, P2 kısmı).
// P3 alanları (resolve: consentText, joinNonce, nonceExpiresAt; join) kendi paketinde eklenir.
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

/** POST /public/sessions/resolve yanıtı (P2 kısmı). */
export interface ResolveSessionResponse {
  /** Opak; GET /public/sessions/status?ref= yoklaması için. Token değildir. */
  sessionRef: string;
  tenant: { name: string; logoUrl: string | null };
  technician: { name: string; avatarUrl: string | null };
  techVerifyCode: string;
  expiresAt: string;
}

export interface PublicSessionStatusResponse {
  status: SessionStatus;
}
