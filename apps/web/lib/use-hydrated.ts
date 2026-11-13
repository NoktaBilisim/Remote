import { useSyncExternalStore } from "react";

const noop = () => () => undefined;

/**
 * İstemcide hidrasyon tamamlandı mı (sunucu ön-çiziminde `false`). Formlar `data-ready` ile işaretler; e2e testleri
 * yazmadan önce bunu bekler (P12 yükleyicileri ve join-form ile aynı desen; QA P12 Tur 2).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
