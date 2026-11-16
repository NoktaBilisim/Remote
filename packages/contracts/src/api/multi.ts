// P28c çoklu teknisyen REST sözleşmesi (mimari-p28c r2 §4.1, §4.3; AC-364, 365, 368, 372). Çerez + Origin + CSRF mevcut
// kalıp. Uygunluk koşullarının tek kaynağı sunucuda `eligibleToJoin` (§4.3); burada yalnız girdi/çıktı biçimi ve hata metinleri.
import { z } from "zod";
import type { ErrorCode } from "../errors.ts";
import type { ConsentMode } from "../unattended-consent.ts";
import type { SessionMode } from "./sessions.ts";
import { silentReasonSchema } from "./unattended.ts";

/** P28c hata kodlarının Türkçe metni (sunucu zarf `message`'ı ve web aynı metni kullanır). */
export const MULTI_ERROR_MESSAGES = {
  SESSION_FULL: "Oturum dolu",
  /** AC-372: AC-352 metni (labels `UNSUPPORTED` ile aynı cümle). */
  CLIENT_UNSUPPORTED: "Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin",
  INVITE_GONE: "Davet artık geçerli değil",
  JOIN_NOT_ALLOWED: "İzinli gözetimsiz bağlantıya ek teknisyen katılamaz",
} as const satisfies Partial<Record<ErrorCode, string>>;

/** `GET /sessions/:id/invite-candidates` en çok satır (ada göre sıralı). */
export const INVITE_CANDIDATES_MAX = 200;
/** Gerekçe sınırları `api/unattended.ts` `silentReasonSchema` ile aynı (AC-437 şeması). */
export { SILENT_REASON_MAX, SILENT_REASON_MIN } from "./unattended.ts";

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
/** Davet kimliği: 128 bit rastgele → base64url (dolgusuz) = 22 karakter (T4). */
export const INVITE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const inviteIdSchema = z.string().regex(INVITE_ID_PATTERN);

/** `:id` (oturum) yol parametresi. */
export const multiSessionParamsSchema = z.strictObject({ id: ulid });
/** `DELETE /sessions/:id/invites/:inviteId` yol parametreleri. */
export const sessionInviteParamsSchema = z.strictObject({ id: ulid, inviteId: inviteIdSchema });
/** `POST /sessions/invites/:inviteId/accept|reject` yol parametresi. */
export const inviteParamsSchema = z.strictObject({ inviteId: inviteIdSchema });

/** POST /sessions/:id/invites girdisi. */
export const createInviteInputSchema = z.strictObject({ userId: ulid });
export type CreateInviteInput = z.infer<typeof createInviteInputSchema>;
export interface CreateInviteResponse {
  inviteId: string;
  /** ISO; oluşturma + `INVITE_TTL_MS`. */
  expiresAt: string;
}

/**
 * POST /sessions/invites/:inviteId/accept ve POST /sessions/:id/supervise girdisi: silent odada `{reason}` (20–500) zorunlu,
 * diğerlerinde `{}`. Oda kipini yalnız sunucu bilir: eksik/fazla gerekçe sunucuda `VALIDATION` + `fields.reason`.
 */
export const joinWithReasonInputSchema = z.strictObject({ reason: silentReasonSchema.optional() });
export type JoinWithReasonInput = z.input<typeof joinWithReasonInputSchema>;
export interface JoinSessionAsMemberResponse {
  sessionId: string;
  /** `/sessions/<id>/console`. */
  consoleUrl: string;
}

/** GET /sessions/:id/invite-candidates. */
export interface InviteCandidate {
  userId: string;
  fullName: string;
  avatarUrl: string | null;
}
export interface InviteCandidatesResponse {
  items: InviteCandidate[];
}

/** GET /sessions/invites (yalnız kendine gelen, bellekten; `Cache-Control: no-store`). */
export interface IncomingInvite {
  inviteId: string;
  sessionId: string;
  fromName: string;
  customerName: string;
  unattended: boolean;
  /** Silent odada kabul gerekçe ister. */
  silent: boolean;
  expiresAt: string;
}
export interface IncomingInvitesResponse {
  items: IncomingInvite[];
}

/** GET /sessions/active (`sessions.supervise` + tenantScope; uygun olmayan gözetimsiz oda listelenmez — O-PC-1). */
export interface ActiveSessionItem {
  id: string;
  technicianName: string;
  customerName: string;
  mode: SessionMode;
  startedAt: string;
  techCount: number;
  full: boolean;
  /** Misafir `rs.cap.multi1` bildirdi (false → İzle pasif + AC-352 metni). */
  supported: boolean;
  unattended: boolean;
  silent: boolean;
  /** Gözetimsiz oda kipi (`asked` → İzle pasif, `JOIN_NOT_ALLOWED` metni). Gözetimsiz değilse yok. */
  consentMode?: ConsentMode;
}
export interface ActiveSessionsResponse {
  items: ActiveSessionItem[];
}
