import { ApiError } from "@/lib/api";
import { toUiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import type { AcceptResult } from "./contract";

/** Kabul yanıtındaki konsol yolu yalnız uygulama içi `/sessions/<id>/console` olabilir. */
export const consolePath = (r: AcceptResult): string =>
  /^\/sessions\/[0-9A-Z]{26}\/console$/.test(r.consoleUrl) ? r.consoleUrl : `/sessions/${encodeURIComponent(r.sessionId)}/console`;

/** Hata kodu → kullanıcı mesajı (mimari-api hata kodları P8b-1). */
export function requestErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "REQUEST_TAKEN") return t("rq.err.taken");
    if (e.code === "REQUEST_CLOSED" || e.status === 404) return t("rq.err.closed");
    if (e.code === "OPEN_SESSION_LIMIT") return e.message || t("rq.err.limit");
    if (e.code === "QUEUE_FULL") return t("rq.err.queueFull");
    if (e.code === "CLIENT_OUTDATED") return t("rq.err.outdated");
    if (e.code === "ACCEPT_CODE_CLIENT_UNSUPPORTED") return t("rq.err.acceptCodeUnsupported");
  }
  return toUiError(e).message;
}
