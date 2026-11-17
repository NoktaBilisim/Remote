/*
 * P28d arayüz kararları (mimari-p28d r2 §8; Y-PD-3, D-PD-2): bitiş toast'ı, konsol bildirim metni ve misafir görüşme çubuğu
 * modeli. Saf → node'da birim testli; bileşenler yalnız çizer.
 */
import { formatDuration } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import type { TechRosterEntry } from "@remote/contracts/ws-multi";
import type { VoiceEnded, VoiceNoticeKind } from "./console";
import { namesOf } from "./console";
import type { GuestVoiceView } from "./guest";

/** Konsol bitiş toast'ı: yalnız kendi görüşmem (istekte bulunan ya da dinleyen); ret / yanıt yok / etkin bitiş (§8). */
export function voiceEndToast(e: VoiceEnded | null): string | null {
  if (!e?.mine) return null;
  if (e.wasPhase === "pending") {
    if (e.reason === "customer") return t("vc.t.rejected");
    if (e.reason === "timeout") return t("vc.t.timeout");
    return null;
  }
  return e.durationSec === null ? t("vc.t.endedNoDur") : t("vc.t.ended", { duration: formatDuration(e.durationSec) });
}

const NOTICE_KEY: Readonly<Record<Exclude<VoiceNoticeKind, "unsupported">, MessageKey>> = {
  rejected: "vc.n.rejected",
  timeout: "vc.n.timeout",
  customerEnded: "vc.n.customerEnded",
  deviceEnded: "vc.n.deviceEnded",
  micDenied: "vc.n.micDenied",
  conflict: "vc.n.conflict",
  rateLimited: "vc.n.rateLimited",
  forbidden: "vc.n.forbidden",
};

/** Bildirim metni; `unsupported` contracts AC-352 metnini kullanır (çağıran verir). */
export const noticeText = (kind: VoiceNoticeKind, unsupported: string): string =>
  kind === "unsupported" ? unsupported : t(NOTICE_KEY[kind]);

export interface GuestBarModel {
  /** Çubuk görünür: etkin rızalı görüşme VEYA mikrofon açılıyor/açık (kabul ile `voice.state{active}` arası dahil). */
  show: boolean;
  mic: GuestVoiceView["mic"];
  muted: boolean;
  talkers: string[];
  /** `listeners − talkers` adları (Y-PD-3). */
  listenersOnly: string[];
}

export function guestBarModel(v: GuestVoiceView, roster: readonly TechRosterEntry[]): GuestBarModel {
  const a = v.active;
  const talkers = a ? a.talkers : [];
  return {
    show: a !== null || v.mic !== "off",
    mic: v.mic,
    muted: v.muted,
    talkers: namesOf(talkers, roster),
    listenersOnly: a
      ? namesOf(
          a.listeners.filter((x) => !talkers.includes(x)),
          roster,
        )
      : [],
  };
}

/**
 * Yeni dinleyici duyurusu (`aria-live=assertive`): `announce.seq` görülen son değerden büyükse, hâlâ dinleyen tid'ler.
 * `seen` = bileşenin bağlandığı andaki seq (eski görüşmenin duyurusu yeniden okunmaz).
 */
export function freshListeners(v: GuestVoiceView, seen: number): string[] {
  const a = v.announce;
  if (!a || a.seq <= seen || !v.active) return [];
  return a.tids.filter((x) => v.active?.listeners.includes(x));
}
