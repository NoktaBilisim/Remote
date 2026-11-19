/*
 * P28u r3 (mimari-p28u §r3 r3.6, K-P28u-r3-6; AC-433, 442): gözetimsiz bağlantı tek yol — cihaz kullanıcısına sorulmadan açılır.
 * Konsoldaki müdahale düğmelerinin ve otomatik kontrol isteğinin saf kararları (bileşen/kanca yalnız uygular).
 */
import type { ConsentMode } from "@remote/contracts/unattended-consent";
import type { ControlPhase } from "@/lib/control/machine";

/** `hello.unattended` (P27 + P28u §6.4). `consentMode` r3'te yalnız `no_user` gelir; konsol kipe göre davranmaz. */
export interface UnattendedInfo {
  deviceId: string;
  deviceName: string;
  consentMode?: ConsentMode;
  intervene?: boolean;
}

export interface InterveneView {
  /** Kontrol açıkken: "Oturumu kilitle" / "Kullanıcı oturumunu kapat". */
  showCommands: boolean;
  /** `intervene:false` (eski servis): komut düğmeleri pasif + neden. */
  commandsDisabled: boolean;
}

/**
 * Konsol müdahale görünümü (AC-442 r3). Katılımlı oturumda null (bileşen çizilmez). Kilit / oturum kapatma yalnız canlı oturumda
 * kontrol `granted` iken; kontrol kapalıyken ve istek sürerken görünmez.
 */
export function interveneView(u: UnattendedInfo | null, phase: ControlPhase, live: boolean, controller = true): InterveneView | null {
  if (!u) return null;
  // S-P28u-r3-8: çok teknisyenli odada yalnız kontrol sahibi (sunucu zaten 403 döner; gereksiz istek/audit gürültüsü yok).
  return { showCommands: live && controller && phase === "granted", commandsDisabled: u.intervene !== true };
}

/** Otomatik kontrol kararının girdisi (konsol durumundan). */
export interface AutoControlInput {
  /** Misafir (cihaz) katılım sayacı — `TechState.guestJoins`; her katılım / yeniden katılımda artar. */
  joins: number;
  /** Gözetimsiz oda mı (`hello.unattended`). */
  unattended: boolean;
  /** Bu konsol kontrol sahibi mi (P28c roster; tek teknisyenli odada sahip). */
  controller: boolean;
  /** `remote_control.use` yetkisi. */
  canControl: boolean;
  phase: ControlPhase;
}

/**
 * K-P28u-r3-6 + S-P28u-r3-2: gözetimsiz odada misafir katılınca (ve yeniden katılımda) konsol **bir kez** `control.request`
 * gönderir. Karar yalnız katılım anında (sayaç değiştiğinde) verilir: o an kontrol sahibi değilsem (katılımcı / izleyici) o
 * katılım için istek yoktur; sonradan devirle (handover) kontrol sahibi olunca da otomatik istek yoktur (bilinçli tıklama).
 * Kontrol zaten istenmiş / açıksa istek yok. `seen` = son karar verilen sayaç (çağıran saklar; dönen `seen` ile günceller).
 */
export function autoControlDecision(seen: number, i: AutoControlInput): { seen: number; fire: boolean } {
  if (i.joins === seen) return { seen, fire: false };
  const fire = i.joins > seen && i.unattended && i.controller && i.canControl && i.phase !== "requested" && i.phase !== "granted";
  return { seen: i.joins, fire };
}
