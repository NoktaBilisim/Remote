/*
 * P28u (mimari-p28u §5.1, §10; AC-430, 437, 439, 442): izinli / izinsiz bağlantı ve konsol müdahale düğmelerinin saf
 * kararları. Şema tek kaynak `@remote/contracts/api/unattended` (gerekçe `silentReasonSchema`); burada yalnız görünüm kararı.
 */
import { silentReasonSchema, SILENT_REASON_MAX, type UnattendedConnectInput } from "@remote/contracts/api/unattended";
import type { ConsentMode } from "@remote/contracts/unattended-consent";
import type { ControlPhase } from "@/lib/control/machine";

/** Sayaç: kırpılmış metnin kod noktası sayısı (sunucu kuralıyla aynı; emoji/birleşik karakter 1'den fazla sayılabilir). */
export const reasonLength = (v: string): number => [...v.trim()].length;

/** Sayaç üst sınırı aşıldı mı (alan uyarı tonuna geçer). */
export const reasonOver = (v: string): boolean => reasonLength(v) > SILENT_REASON_MAX;

/**
 * Bağlan gövdesi: kutu işaretsiz → `{}` (izinli istek); işaretli → `{silent: true, reason}` (gerekçe şemayla doğrulanır,
 * kırpılmış hâli gider). Hata → alan metni (`fields.reason` ile aynı yer).
 */
export function buildConnectBody(silent: boolean, reason: string): { body: UnattendedConnectInput } | { error: string } {
  if (!silent) return { body: {} };
  const r = silentReasonSchema.safeParse(reason);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Gerekçe geçersiz" };
  return { body: { silent: true, reason: r.data } };
}

/** `hello.unattended` (P27 + P28u §6.4). `consentMode` yoksa kip henüz belli değil (`ask` odası karara kadar). */
export interface UnattendedInfo {
  deviceId: string;
  deviceName: string;
  consentMode?: ConsentMode;
  intervene?: boolean;
}

export interface InterveneView {
  /** Rozet kipi (yoksa rozet yok). */
  mode: ConsentMode | null;
  /** silent + kontrol yok: "İzleniyor" + "Müdahale et". */
  monitoring: boolean;
  /** silent + kontrol açık: "İzlemeye dön". */
  canReturn: boolean;
  /** Kontrol açıkken (her kip): "Oturumu kilitle" / "Kullanıcı oturumunu kapat". */
  showCommands: boolean;
  /** `intervene:false` (eski servis): komut düğmeleri pasif + neden. */
  commandsDisabled: boolean;
}

/**
 * Konsol üst çubuğu müdahale görünümü (§10, AC-439, 442). Katılımlı oturumda null (bileşen çizilmez). Kilit / oturum kapatma
 * yalnız kontrol `granted` iken; izleme kipinde ve kontrol isteği beklerken görünmez.
 */
export function interveneView(u: UnattendedInfo | null, phase: ControlPhase, live: boolean): InterveneView | null {
  if (!u) return null;
  const silent = u.consentMode === "silent";
  const granted = live && phase === "granted";
  return {
    mode: u.consentMode ?? null,
    monitoring: live && silent && phase !== "granted",
    canReturn: silent && granted,
    showCommands: granted,
    commandsDisabled: u.intervene !== true,
  };
}

/**
 * İzinsiz kipte mevcut "Kontrol iste" düğmesi yalnız kontrol isteği sürerken / kontrol açıkken görünür (Vazgeç, özel tuşlar,
 * bırak); boşta tek yol onaylı "Müdahale et"tir (AC-439). Diğer kiplerde P27 gibi her zaman.
 */
export const showControlButton = (u: UnattendedInfo | null, phase: ControlPhase): boolean =>
  u?.consentMode !== "silent" || phase === "requested" || phase === "granted";

/** Konsol bekleme: izinli istek (kip henüz belli değil) → "Kullanıcının onayı bekleniyor…"; silent → P27 "Cihaz bağlanıyor…". */
export const awaitingConsent = (u: UnattendedInfo | null): boolean => u !== null && u.consentMode === undefined;

/** Bitişte "Yeniden dene" bağlantısı gösterilen nedenler (yeni step-up ister — AC-432). */
export const CONSENT_END_REASONS: readonly string[] = ["consent_denied", "consent_timeout"];
