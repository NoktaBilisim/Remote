// P28a misafir özellik bildirimi ve oturum caps'i (mimari-p28 §4.1–4.2; AC-352, O-P28a-4, T7). Özellik sürüme değil
// `rs.cap.*` alt protokol belirtecine dayanır; misafire giden caps yeni değerleri yalnız misafir bildirdiyse içerir.
import type { PermissionKey } from "@remote/contracts/permissions";
import type { Cap } from "@remote/contracts/ws";
import { GUEST_FEATURE_BY_SUBPROTOCOL, GUEST_FEATURES, type GuestFeature } from "@remote/contracts/ws-clip-print";
import type { Guest, Room } from "./types.ts";

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

/** Misafire giden caps (`hello.caps`, `caps.update`): eski istemciye yeni değer gitmez (katı ayrıştırma — T7). */
export function capsFor(caps: readonly Cap[], features: ReadonlySet<GuestFeature>): Cap[] {
  return caps.filter((c) => (c === "clipboard" || c === "print" ? features.has(c) : true));
}

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

/** Teknisyene giden `guestFeatures` dizisi (sabit sıra). */
export const featureList = (f: ReadonlySet<GuestFeature>): GuestFeature[] => GUEST_FEATURES.filter((x) => f.has(x));
