import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

/*
 * Web → server resolve isteğinde iletilecek istemci başlıkları (S-P2-1, S-P2-2; G-11).
 * Server web konteynerini (172.30.0.3) güvenilen proxy saydığı için web'in ilettiği XFF doğrudan
 * audit IP'si/limit anahtarı olur. Bu yüzden XFF yalnız istek Caddy'den geldiyse iletilir:
 * Caddy her web isteğine `X-Edge-Auth: <EDGE_PROXY_SECRET>` yazar (istemcinin gönderdiğini ezer).
 * Başlık yoksa/eşleşmezse (edge ağından web:3000'e doğrudan istek) XFF gönderilmez → server
 * soket adresini (web .3) görür; taklit edilen IP hiçbir yere yazılmaz.
 */
export const EDGE_AUTH_HEADER = "x-edge-auth";
export const UA_MAX = 512;
const SECRET_MIN = 32;

type HeaderSource = { get(name: string): string | null };

/** Sabit zamanlı karşılaştırma (uzunluk farkı da sızmasın diye özetler karşılaştırılır). */
export function edgeAuthOk(received: string | null, secret: string): boolean {
  if (!received || !secret) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * EDGE_PROXY_SECRET doğrulaması. Production'da zorunlu (>= 32 karakter) — yoksa hata fırlatır
 * (yanlış yapılandırma sessizce "tüm müşteriler web IP'sinden" durumuna düşmesin). Değer loglanmaz.
 */
export function readEdgeSecret(env: Record<string, string | undefined> = process.env): string {
  const s = env.EDGE_PROXY_SECRET ?? "";
  if (s.length >= SECRET_MIN) return s;
  if (env.NODE_ENV === "production") {
    throw new Error(`EDGE_PROXY_SECRET gerekli (>= ${SECRET_MIN} karakter; openssl rand -base64 32)`);
  }
  return ""; // geliştirme: Caddy yok → XFF hiç iletilmez
}

/** Server'a iletilecek `x-forwarded-for` ve `user-agent` başlıkları. */
export function forwardHeaders(incoming: HeaderSource, secret: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (edgeAuthOk(incoming.get(EDGE_AUTH_HEADER), secret)) {
    // Caddy (trusted_proxies yok) XFF'i tek değerle yeniden yazar: ilk öğe = Caddy'nin gördüğü istemci.
    const first = (incoming.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
    if (isIP(first)) out["x-forwarded-for"] = first;
  }
  // UA yalnız bilgi amaçlı (audit); güven kararında kullanılmaz. Server ayrıca 300'e keser.
  const ua = incoming.get("user-agent");
  if (ua) out["user-agent"] = ua.slice(0, UA_MAX);
  return out;
}
