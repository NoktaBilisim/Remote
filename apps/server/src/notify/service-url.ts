// Dış servis adresi kuralları (P8b §13.5, P13a T33, S-P13b-8; P19 J3 §8c.3: `notify/whatsapp.ts`'ten taşındı — WhatsApp ve
// SMS ortak). WA davranışı değişmedi; P19 S-P19-T5: ayrıştırılabilir sayılmak için userinfo (`@`), sorgu (`?`) ve parça (`#`)
// içermemeli (kayıtlı eski değer kurala uymuyorsa kanal kullanılamaz).
import { BlockList, isIP } from "node:net";

// P13a (T33, mimari-p13 §3): link-local `169.254.0.0/16` (bulut metadata) ve `fe80::/10` "özel ağ" SAYILMAZ → canlıda
// `http://` + link-local adres kanalı kapatır. Loopback (`127.0.0.0/8`, `::1`) özel kalır.
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["100.64.0.0", 10],
] as const)
  PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::1", 128],
  ["fc00::", 7],
] as const)
  PRIVATE.addSubnet(net, bits, "ipv6");

/** Host özel ağ/loopback mu (yalnız IP sabitleri ve `localhost`; DNS çözülmez — ad her zaman "genel" sayılır). */
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost") return true;
  const family = isIP(h);
  if (family === 4) return PRIVATE.check(h, "ipv4");
  if (family === 6) return PRIVATE.check(h, "ipv6");
  return false;
}

/** §13.5 fail-closed: production + `http://` + özel olmayan host → güvensiz. */
export function isInsecureServiceUrl(url: string, production: boolean): boolean {
  if (!isParsableServiceUrl(url)) return true; // B-P12b-1: ayrıştırılamayan adres her ortamda fail-closed
  if (!production) return false;
  const u = new URL(url);
  return u.protocol === "http:" && !isPrivateHost(u.hostname);
}

/** Loopback host mu (127.0.0.0/8, ::1, localhost). */
function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || (isIP(h) === 4 && h.startsWith("127."));
}

/**
 * S-P13b-8: anahtar tanımlıyken `http://` (loopback dışı) anahtarı şifresiz taşır. Production'da güvensiz sayılır (kanal
 * kapalı, ayar ekranında mevcut "güvensiz" uyarısı); geliştirme/testte izinli ama `keyOverHttp` ile uyarı logu düşer.
 */
export function keyOverPlainHttp(url: string, hasKey: boolean): boolean {
  if (!hasKey || !isParsableServiceUrl(url)) return false;
  const u = new URL(url);
  return u.protocol === "http:" && !isLoopbackHost(u.hostname);
}

/** Adres + anahtar birlikte: §13.5 kuralı ve production'da anahtar + düz http (S-P13b-8). */
export function isInsecureServiceTarget(url: string, hasKey: boolean, production: boolean): boolean {
  return isInsecureServiceUrl(url, production) || (production && keyOverPlainHttp(url, hasKey));
}

/** WHATWG ile ayrıştırılabilir http(s) adresi mi (DB CHECK yalnız regex; `http://a:99999` CHECK'ten geçer). */
export function isParsableServiceUrl(url: string): boolean {
  if (/[@?#]/.test(url)) return false; // S-P19-T5: URL'de sır taşınmaz
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "" && u.username === "" && u.password === "";
  } catch {
    return false;
  }
}
