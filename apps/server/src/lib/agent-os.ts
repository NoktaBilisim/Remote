// P31 (mimari-p31 K-P31-2, §3.1; AC-509, AC-521): firma bağlantısında `os` verilmediğinde User-Agent'tan platform seçimi.
// UA güvenlik kararı değildir — yalnız aynı ref için hangi jenerik ikilinin adlandırılacağını seçer (T-P31-4). UA loglanmaz.
import type { RequestClientOs } from "@remote/contracts/api/requests";

const MAC = /Macintosh|Mac OS X/;
/** iOS/iPadOS Safari UA'sı da "like Mac OS X" içerir; masaüstü kipindeki iPad "Macintosh" der (kabul, R-P31-2). */
const IOS = /iPhone|iPad|iPod/;

/** UA macOS masaüstü ise `macos`, diğer her durumda (Windows, Linux, iOS, UA yok) `windows` (bugünkü davranış). */
export function osFromUserAgent(ua: string | undefined): RequestClientOs {
  if (!ua) return "windows";
  return MAC.test(ua) && !IOS.test(ua) ? "macos" : "windows";
}
