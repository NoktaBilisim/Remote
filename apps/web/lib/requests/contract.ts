/*
 * P8b-1 destek talebi sözleşmesinin web yüzü: tek kaynak `@remote/contracts/api/requests` ve `ws-request`
 * (docs/mimari-api.md "Destek talepleri (P8b)", mimari-protokol §5.3, G-E9-15 `networkMatch` + `knownDevice`).
 * Burada yalnız web'e özgü kısa adlar ve panel mesajı ayrıştırıcısı var; alan/şema tanımı yok.
 */
import { panelOutboundSchema, WS_REQUEST_CLOSE, type PanelOutbound } from "@remote/contracts/ws-request";

export {
  CANCEL_REASONS,
  CLOSED_REQUEST_STATUSES as CLOSED_STATUSES,
  NETWORK_MATCHES,
  REQUEST_RECIPIENTS_MAX as MAX_RECIPIENTS,
  REQUEST_REJECT_PRESETS as REJECT_PRESETS,
  REQUEST_STATUSES,
  REQUEST_TRUSTED_CIDRS_MAX as MAX_TRUSTED_CIDRS,
  REQUEST_VERIFY_HINT,
  REQUEST_WAIT_MAX as WAIT_MAX,
  REQUEST_WAIT_MIN as WAIT_MIN,
} from "@remote/contracts/api/requests";
export type {
  AcceptRequestResponse as AcceptResult,
  CancelReason,
  NetworkMatch,
  RequestStatus,
  SupportRequestCountResponse,
  SupportRequestItem,
  SupportRequestListResponse as SupportRequestList,
  SupportRequestSettings,
  UpdateRequestSettingsInput as SupportRequestSettingsInput,
  WhatsappTestResponse,
} from "@remote/contracts/api/requests";

export type PanelMessage = PanelOutbound;

/** Ham WS verisi → doğrulanmış mesaj; geçersiz/bilinmeyen tip → null (sessizce yok sayılır). */
export function parsePanelMessage(data: unknown): PanelMessage | null {
  if (typeof data !== "string") return null;
  try {
    const r = panelOutboundSchema.safeParse(JSON.parse(data));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export const PANEL_CLOSE_UNAUTH = WS_REQUEST_CLOSE.AUTH_REVOKED;
export const PANEL_CLOSE_TOO_MANY = WS_REQUEST_CLOSE.TOO_MANY;
