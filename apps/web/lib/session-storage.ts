/** Sekme belleğinde uygulamaya ait anahtarların öneki (konsol müşteri adı vb.). */
export const STORAGE_PREFIX = "rs.";

/** S-P4-4: çıkışta bu sekmedeki oturum/konsol verilerini (ör. `rs.guestName.*`) siler. Depolama kapalıysa sessizce geçer. */
export function clearSessionData(store: Pick<Storage, "length" | "key" | "removeItem"> | undefined = globalThis.sessionStorage) {
  try {
    if (!store) return;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    for (const k of keys) store.removeItem(k);
  } catch {
    /* depolama kapalı (gizli mod vb.) */
  }
}
