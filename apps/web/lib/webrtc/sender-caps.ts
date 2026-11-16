import { LOW_BPS, LOW_FPS } from "@remote/contracts/ws-multi";

/** P28c (§6.1, AC-371): ikincil gönderici kodlamaları tavanlı; kontrol sahibinde tavan kaldırılır. Saf (birim testli). */
export function senderEncodings(enc: readonly RTCRtpEncodingParameters[], low: boolean): RTCRtpEncodingParameters[] {
  return enc.map((e) => {
    const rest: RTCRtpEncodingParameters = { ...e };
    delete rest.maxFramerate;
    delete rest.maxBitrate;
    return low ? { ...rest, maxFramerate: LOW_FPS, maxBitrate: LOW_BPS } : rest;
  });
}
