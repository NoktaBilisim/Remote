/*
 * Açılış doğrulaması (S-P2-T2-1): production'da EDGE_PROXY_SECRET eksik/kısaysa web süreci
 * ilk istekte değil açılışta dursun. register() yalnız sunucu başlarken çalışır (`next build`
 * sırasında çağrılmaz). Edge runtime'da node:crypto/process.exit yok → yalnız Node runtime'da, dinamik import.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { assertEdgeSecretOrExit } = await import("@/lib/startup-check");
  assertEdgeSecretOrExit();
}
