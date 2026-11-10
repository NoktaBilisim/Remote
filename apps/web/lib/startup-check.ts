import { readEdgeSecret } from "@/lib/edge-forward";

/*
 * Production açılış kontrolü (S-P2-T2-1). Next, register() içindeki hatayı yakalayıp
 * "Failed to prepare server" yazar ama süreci AÇIK bırakır (her istek 500). Bu yüzden
 * yanlış yapılandırmada süreç açıkça sonlandırılır → konteyner yeniden başlatma döngüsünde
 * görünür. Sır değeri loglanmaz, yalnız readEdgeSecret()'in mesajı yazılır.
 */
export function assertEdgeSecretOrExit(): void {
  try {
    readEdgeSecret();
  } catch (e) {
    console.error(`[web] açılış durduruldu: ${e instanceof Error ? e.message : "EDGE_PROXY_SECRET geçersiz"}`);
    process.exit(1);
  }
}
