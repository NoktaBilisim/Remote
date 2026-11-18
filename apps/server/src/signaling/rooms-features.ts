// P28a misafir özellik bildirimi ve oturum caps'i (mimari-p28 §4.1–4.2; AC-352, O-P28a-4, T7). Özellik sürüme değil
// `rs.cap.*` alt protokol belirtecine dayanır; misafire giden caps yeni değerleri yalnız misafir bildirdiyse içerir.
// P28b (mimari-p28b §5.1, §5.4; D-P28b-5): tek yardımcı `hasFsrv`; SERVER odasında misafir caps'inden dosya + yazdırma çıkar.
import type { PermissionKey } from "@remote/contracts/permissions";
import type { Cap } from "@remote/contracts/ws";
import { GUEST_FEATURE_BY_SUBPROTOCOL, GUEST_FEATURES, type GuestFeature } from "@remote/contracts/ws-clip-print";
import { FSRV_FEATURE, WS_GUEST_CAP_FSRV, type FileMode, type PeerFeature } from "@remote/contracts/ws-fsrv";
import { WS_CAP_VOICE } from "@remote/contracts/ws-voice";
import { WS_CAP_SCHAT } from "@remote/contracts/ws-chat";
import type { Guest, Peer, Room } from "./types.ts";

const NONE: ReadonlySet<GuestFeature> = new Set();

/** Teknisyen etkin yetkilerinden oturum caps'i (bağlanma anı; sonra yalnız daralır, G-09). */
export function capsOf(perms: ReadonlySet<string>): Cap[] {
  const pairs: [PermissionKey, Cap][] = [
    ["remote_control.use", "remote_control"],
    ["file_transfer.use", "file_transfer"],
    ["remote_control.clipboard", "clipboard"],
    ["file_transfer.print", "print"],
  ];
  return pairs.filter(([p]) => perms.has(p)).map(([, c]) => c);
}

/**
 * Misafire giden caps (`hello.caps`, `caps.update`): eski istemciye yeni değer gitmez (katı ayrıştırma — T7). SERVER odasında
 * `file_transfer` ve `print` çıkarılır (§5.4 a): DC dosya/yazdırma kanalı kapalı; sunucu yolu `fsrv.*` ile. `room.caps` daralmaz.
 */
export function capsFor(caps: readonly Cap[], features: ReadonlySet<GuestFeature>, fileMode: FileMode = "P2P"): Cap[] {
  return caps.filter((c) => {
    if (fileMode === "SERVER" && (c === "file_transfer" || c === "print")) return false;
    return c === "clipboard" || c === "print" ? features.has(c) : true;
  });
}

/**
 * Soketin sunucu dosya yeteneği (ws-auth, soket başına): gözetimsiz odada belirteçler okunmaz (O-P28a-4); tarayıcı misafiri
 * (nonce türü BROWSER) belirteçsiz yetenekli (K-P28b-20); AGENT `rs.cap.fsrv1` bildirirse.
 */
export function fsrvOf(protocols: readonly string[], room: Room, guest: Guest): boolean {
  if (room.unattended) return false;
  return guest.kind === "BROWSER" || protocols.includes(WS_GUEST_CAP_FSRV);
}

/** TEK yardımcı (D-P28b-5): `hello.fileMode`, misafir şeması ve `guestFeatures` yalnız bunu çağırır. İlk koşul gözetimsiz oda. */
export function hasFsrv(room: Room, peer: Peer | undefined): boolean {
  return !room.unattended && peer?.fsrv === true;
}

/**
 * P28d (§4.1): soketin ses yeteneği (ws-auth, soket başına). Gözetimsiz odada belirteç okunmaz (O-PD-3); tarayıcı misafiri
 * sunucuyla aynı sürüm olduğundan destekli; AGENT yalnız `rs.cap.voice1` bildirirse.
 */
export function voiceOf(protocols: readonly string[], room: Room, guest: Guest): boolean {
  if (room.unattended) return false;
  return guest.kind === "BROWSER" || protocols.includes(WS_CAP_VOICE);
}

/** TEK yardımcı (§4.1): misafir şeması, `voice.*` yayını ve `guestVoice` yalnız bunu çağırır. İlk koşul gözetimsiz oda. */
export function hasVoice(room: Room, peer: Peer | undefined): boolean {
  return !room.unattended && peer?.voice === true;
}

/**
 * P22 (mimari-p22 r2 §4.1, S-P22-7, K-P22-10): soketin oturum sohbeti yeteneği (ws-auth, soket başına). Gözetimsiz odada
 * belirteç okunmaz; tarayıcı istisnası YOK (yayından önce açık eski sekme DC'ye düşmesin) — yalnız `rs.cap.schat1`.
 */
export function schatOf(protocols: readonly string[], room: Room): boolean {
  return !room.unattended && protocols.includes(WS_CAP_SCHAT);
}

/** TEK karar noktası (§4.1): misafir şeması (bit 64), `chat.*` gönderimi ve `guestChat` yalnız bunu çağırır. */
export function hasSessionChat(room: Room, peer: Peer | undefined): boolean {
  return !room.unattended && peer?.schat === true;
}

/** Odanın dosya modu (admit öncesi / atanmamışsa P2P). */
export const fileModeOf = (room: Room): FileMode => room.fileMode ?? "P2P";

/**
 * Soketin bildirdiği özellikler. Gözetimsiz odada belirteçler hiç okunmaz (O-P28a-4, tek sunucu koşulu); tarayıcı misafiri
 * de özellik taşımaz (pano/yazdırma yalnız Windows istemci, AC-348). Bilinmeyen `rs.cap.*` yok sayılır.
 */
export function featuresOf(protocols: readonly string[], room: Room, guest: Guest): ReadonlySet<GuestFeature> {
  if (room.unattended || guest.kind !== "AGENT") return NONE;
  const out = new Set<GuestFeature>();
  for (const p of protocols) {
    const f = GUEST_FEATURE_BY_SUBPROTOCOL[p];
    if (f) out.add(f);
  }
  return out;
}

/** Bağlı ADMITTED misafirin özellikleri (yoksa boş). */
export const guestFeatures = (room: Room): ReadonlySet<GuestFeature> => room.admitted?.peer?.features ?? NONE;

/** Teknisyene giden `guestFeatures` dizisi (sabit sıra); `fsrv` yalnız bağlı misafir `hasFsrv` ise (§5.4 c). */
export function featureList(f: ReadonlySet<GuestFeature>, fsrv = false): PeerFeature[] {
  const out: PeerFeature[] = GUEST_FEATURES.filter((x) => f.has(x));
  if (fsrv) out.push(FSRV_FEATURE);
  return out;
}
