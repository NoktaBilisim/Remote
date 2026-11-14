"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { applyTitle, getTitleParts, isConsolePath, NO_PARTS, stripPrefixes, subscribeTitleParts } from "@/lib/tab-title";

/*
 * Sekme başlığının TEK yazıcısı (P13b-L, mimari-lobi §6.6, AC-308). Lobi (LobbyNotifier) ve talep (RequestNotifier)
 * sayıları `lib/tab-title` deposuna yazılır; burada "(l) Müşteri bekliyor — (r) <başlık>" olarak birleşir. Next başlığı
 * değiştirdiğinde (sayfa geçişi) MutationObserver önekleri yeniden uygular. Konsolda dokunulmaz (DESIGN §8).
 */
export function TabTitle() {
  const pathname = usePathname();
  const parts = useSyncExternalStore(subscribeTitleParts, getTitleParts, () => NO_PARTS);

  useEffect(() => {
    if (isConsolePath(pathname)) return;
    const apply = () => {
      const next = applyTitle(document.title, parts, pathname);
      if (document.title !== next) document.title = next;
    };
    apply();
    if (parts.lobby === 0 && parts.requests === 0) return;
    const obs = new MutationObserver(apply);
    obs.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      obs.disconnect();
      const base = stripPrefixes(document.title);
      if (document.title !== base) document.title = base;
    };
  }, [parts, pathname]);

  return null;
}
