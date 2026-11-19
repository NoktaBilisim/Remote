/*
 * K-P22-3 (mimari-p22 §4.4, r2 S-P22-6): eski (≤ 0.20.x, `rs.cap.schat1` bildirmeyen) müşteri istemcisine konsolun DC `ctl`
 * kanalından gönderebildiği TEK çerçeve — sabit `LEGACY_CHAT_NOTICE`. Metin parametresi YOK (kullanıcı içeriği bu yoldan
 * gidemez). Kabulden sonra bir kez ve her gelen DC `chat`'te en çok 60 sn'de bir; yalnız oturum sahibinin konsolu çağırır.
 */
import { LEGACY_CHAT_NOTICE } from "@remote/contracts/chat";
import { newId } from "../dc/ctl";

export const LEGACY_NOTICE_INTERVAL_MS = 60_000;

/** DC `chat` çerçevesi (yalnız sabit metin). */
export const legacyNoticeFrame = (now: number) => JSON.stringify({ t: "chat", id: newId(), text: LEGACY_CHAT_NOTICE, ts: now });

/** 60 sn'de en çok bir bildirim; `send` false dönerse (kanal kapalı) sayılmaz. */
export function legacyNotifier(now: () => number = Date.now) {
  let last = -Infinity;
  return (send: (raw: string) => boolean): boolean => {
    const t = now();
    if (t - last < LEGACY_NOTICE_INTERVAL_MS) return false;
    if (!send(legacyNoticeFrame(t))) return false;
    last = t;
    return true;
  };
}
