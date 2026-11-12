/*
 * AC-68 istemci yüzü: oturum süresini sunucu yönetir (boşta 30 dk, mutlak 8 sa; her istek DB'den doğrulanır). Panel açık
 * kalmış bir sekme bunu ancak bir sonraki istekte öğrenir; kullanıcı formu doldurup kaydederken düşmesin diye sekme
 * kullanıcı etkinliği olmadan IDLE_PROBE_MS geçince ve sekmeye dönüldüğünde tek bir GET /auth/me ile denetlenir; 401 →
 * "oturumunuz sona erdi" ile girişe. Yoklama sunucunun boşta sayacını yalnız oturum zaten geçerliyse uzatır (WS/başka
 * sekme etkinliği) — istemci kendi başına oturum düşürmez, sunucuyla çelişmez.
 */
export const IDLE_MS = 30 * 60_000;
/** Sunucunun boşta sınırından biraz sonra (saat kayması/60 sn'lik `last_seen_at` yazımı payı). */
export const IDLE_PROBE_MS = IDLE_MS + 90_000;
/** Sekmeye dönüşte art arda yoklama yapılmaz. */
export const VISIBLE_PROBE_MIN_GAP_MS = 60_000;

export type ProbeReason = "idle" | "visible";

/** Yoklama gerekir mi? `lastActivity`: son kullanıcı etkinliği, `lastProbe`: son yoklama zamanı (ms). */
export function shouldProbe(reason: ProbeReason, now: number, lastActivity: number, lastProbe: number): boolean {
  if (reason === "idle") return now - lastActivity >= IDLE_PROBE_MS && lastProbe < lastActivity + IDLE_PROBE_MS;
  return now - lastProbe >= VISIBLE_PROBE_MIN_GAP_MS && now - lastActivity >= VISIBLE_PROBE_MIN_GAP_MS;
}
