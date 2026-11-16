/*
 * P28e (mimari-p28e §6.1, §9, K-P28e-9, V-PE-5): tarayıcı desteği. Konsol yalnız `MediaRecorder` VP8 kodlayabiliyorsa
 * `rs.cap.rec1` bildirir (Safari vb. bildirmez → kayıt başlamaz, neden görünür). Oynatıcı MSE + VP8 WebM ister.
 */
import { REC_MIME_TYPE, WS_CAP_REC } from "@remote/contracts/ws-rec";

/** WebM/VP8 MSE türü (oynatıcı; boşluklu yazım tarayıcıların beklediği biçim). */
export const REC_MSE_TYPE = 'video/webm; codecs="vp8"';

type RecorderCtor = { isTypeSupported?: (t: string) => boolean } | undefined;
type MseCtor = { isTypeSupported?: (t: string) => boolean } | undefined;

/** Konsol kaydedebilir mi (MediaRecorder + VP8). SSR'da false. */
export function canRecord(mr: RecorderCtor = typeof MediaRecorder === "undefined" ? undefined : MediaRecorder): boolean {
  try {
    return Boolean(mr?.isTypeSupported?.(REC_MIME_TYPE));
  } catch {
    return false;
  }
}

/** Oynatıcı çalışır mı (MediaSource + VP8 WebM). */
export function canPlay(ms: MseCtor = typeof MediaSource === "undefined" ? undefined : MediaSource): boolean {
  try {
    return Boolean(ms?.isTypeSupported?.(REC_MSE_TYPE));
  } catch {
    return false;
  }
}

/** `/ws/tech` alt protokolleri: kayıt destekliyse `rs.v1` + `rs.cap.rec1`, aksi alt protokolsüz (bugünkü davranış). */
export function techProtocols(subprotocol: string, recordable: boolean = canRecord()): string[] | undefined {
  return recordable ? [subprotocol, WS_CAP_REC] : undefined;
}
