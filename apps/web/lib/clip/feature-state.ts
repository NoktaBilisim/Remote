/*
 * P28a (mimari-p28 §6, AC-343, 348, 352; r2 Y-P28a-1): pano / uzaktan yazdırma düğmelerinin görünürlük + pasiflik kararı.
 * Saf işlev; neden önceliği (ilk tutan döner): yetki yok (düğme GİZLİ, AC-72 kalıbı) → bağlantı kuruluyor (iskelet) → müşteri
 * bağlı değil → tarayıcı modu (yazdırma gizli; pano nedeni) → gözetimsiz oturum → özellik bildirilmemiş (eski istemci) →
 * kontrol izni yok (pano VE yazdırma) → (pano) müşteri anahtarı kapalı → (yazdırma) ret/yanıtsızlık beklemesi → iş sürüyor.
 * Sunucu otoritedir (§4.3 kapısı); bu karar yalnız düğmeyi önceden pasifler ve nedeni gösterir.
 */
import type { GuestKind } from "@remote/contracts/ws";
import type { GuestFeature } from "@remote/contracts/ws-clip-print";
import type { PeerFeature } from "@remote/contracts/ws-fsrv";

export type FeatureReason =
  "loading" | "noGuest" | "browser" | "unattended" | "unsupported" | "noControl" | "noConsent" | "cooldown" | "busy";

export interface FeatureInput {
  feature: GuestFeature;
  /** Kullanıcı yetkisi: `remote_control.clipboard` / `file_transfer.print`. */
  permitted: boolean;
  /** WS `hello` alındı ve DataChannel açık. */
  ready: boolean;
  guestPresent: boolean;
  guestKind: GuestKind | null;
  unattended: boolean;
  /** P28b: `fsrv` de gelebilir (pano/yazdırma kararını etkilemez). */
  guestFeatures: readonly PeerFeature[];
  /** Kontrol makinesi `granted` (sunucu `controlState=GRANTED`). */
  controlGranted: boolean;
  /** Müşteri pano anahtarı (yalnız pano için anlamlı). */
  clipConsent: boolean;
  /** Bu özellikte bekleyen iş var. */
  busy: boolean;
  /** Yazdırma: ret/yanıtsızlık sonrası 30 sn bekleme sürüyor. */
  cooldown?: boolean;
  /** P28b (§5.3–5.4): SERVER modunda yazdırma sunucu yolundan → misafirde `fsrv` de gerekir. */
  serverFiles?: boolean;
}

export interface FeatureState {
  /** false → düğme hiç çizilmez (yetki yok; tarayıcı modunda yazdırma). */
  visible: boolean;
  enabled: boolean;
  reason: FeatureReason | null;
}

const off = (reason: FeatureReason): FeatureState => ({ visible: true, enabled: false, reason });

export function featureState(i: FeatureInput): FeatureState {
  if (!i.permitted) return { visible: false, enabled: false, reason: null };
  if (!i.ready && i.guestPresent) return off("loading");
  if (!i.guestPresent) return off("noGuest");
  if (i.guestKind !== "AGENT") return i.feature === "print" ? { visible: false, enabled: false, reason: "browser" } : off("browser");
  if (i.unattended) return off("unattended");
  if (!i.guestFeatures.includes(i.feature)) return off("unsupported");
  if (i.feature === "print" && i.serverFiles && !i.guestFeatures.includes("fsrv")) return off("unsupported");
  if (!i.controlGranted) return off("noControl");
  if (i.feature === "clipboard" && !i.clipConsent) return off("noConsent");
  if (i.feature === "print" && i.cooldown) return off("cooldown");
  if (i.busy) return off("busy");
  return { visible: true, enabled: true, reason: null };
}
