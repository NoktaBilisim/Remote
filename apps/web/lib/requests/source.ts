import { networkBadge, type NetworkMatch } from "@remote/contracts/api/requests";

/*
 * Bilinen kaynak göstergesi (mimari-e9 §13.1 + koordinatör kararı): bilgi amaçlıdır, kararı teknisyen verir.
 * - IP / TRUSTED ağ eşleşmesi veya knownDevice → "Bilinen kaynak" (nedenleriyle)
 * - PREFIX → nötr not "Aynı ağ bloğu"; uyarıyı KALDIRMAZ
 * - bilinen sinyal yoksa → "İlk kez görülen kaynak" uyarısı
 */
export type SourceReason = "ip" | "trusted" | "device";
export interface SourceView {
  known: boolean;
  reasons: SourceReason[];
  sameBlock: boolean;
}

export function sourceView(networkMatch: NetworkMatch, knownDevice: boolean): SourceView {
  const reasons: SourceReason[] = [];
  if (networkBadge(networkMatch)) reasons.push(networkMatch === "TRUSTED" ? "trusted" : "ip");
  if (knownDevice) reasons.push("device");
  return { known: reasons.length > 0, reasons, sameBlock: networkMatch === "PREFIX" };
}

/** "123456" → "123 456" (gösterim; ekran okuyucu için ayrıca hane hane etiket verilir). */
export const formatRequestCode = (code: string): string => (/^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code);
