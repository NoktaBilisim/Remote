/*
 * P28e (mimari-p28e §6.1, §9, K-P28e-9, V-PE-5): tarayıcı desteği. Konsol yalnız `MediaRecorder` VP8 kodlayabiliyorsa
 * `rs.cap.rec1` bildirir (Safari vb. bildirmez → kayıt başlamaz, neden görünür). Oynatıcı MSE + VP8 WebM ister.
 */
import { REC_MIME_TYPE, WS_CAP_REC } from "@remote/contracts/ws-rec";
import { WS_CAP_SCHAT } from "@remote/contracts/ws-chat";

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

/**
 * `/ws/tech` alt protokolleri: her zaman `rs.v1` + `rs.cap.schat1` (P22 r2 §15.2 — bildirmeyen konsol soketi 4426 ile kapanır);
 * kayıt destekliyse + `rs.cap.rec1`.
 */
export function techProtocols(subprotocol: string, recordable: boolean = canRecord()): string[] {
  return recordable ? [subprotocol, WS_CAP_SCHAT, WS_CAP_REC] : [subprotocol, WS_CAP_SCHAT];
}
