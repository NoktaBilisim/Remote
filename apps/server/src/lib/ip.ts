// İstemci IP'sinden limit anahtarı (G-11, AC-121). IP'nin kendisi Fastify `trustProxy` ile
// yalnız güvenilen proxy (Caddy) zincirinden okunur; burada yalnız normalizasyon yapılır.
import { BlockList, isIPv4, isIPv6 } from "node:net";

function expandIPv6(addr: string): string[] {
  const [head = "", tail] = addr.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...fill, ...right].map((h) => h.toLowerCase().padStart(4, "0"));
}

/** IPv4 → /32 (adresin kendisi); IPv4-mapped IPv6 → IPv4; IPv6 → /64 öneki. */
export function ipKey(ip: string): string {
  const addr = ip.split("%")[0] ?? ip; // zone id (fe80::1%eth0) atılır
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(addr);
  if (mapped?.[1]) return mapped[1];
  if (isIPv4(addr)) return addr;
  if (isIPv6(addr)) return `${expandIPv6(addr).slice(0, 4).join(":")}::/64`;
  return addr;
}

/** Ağ öneki anahtarı (G-02, AC-3): IPv4 → /24; IPv4-mapped IPv6 → IPv4 /24; IPv6 → /56. */
export function prefixKey(ip: string): string {
  const key = ipKey(ip);
  if (isIPv4(key)) return `${key.split(".").slice(0, 3).join(".")}.0/24`;
  const addr = ip.split("%")[0] ?? ip;
  if (!isIPv6(addr)) return key;
  const groups = expandIPv6(addr);
  return `${groups.slice(0, 3).join(":")}:${(groups[3] ?? "0000").slice(0, 2)}00::/56`;
}

/**
 * Ağ öneki (P8b §13.1/§13.6): IPv4 → /24, IPv6 → /48. Talep bekleyen sınırı (≤ 10), bilinen ağ (PREFIX) ve
 * `req.create.net48` kovası (yalnız IPv6) bunu kullanır.
 */
export function netKey(ip: string): string {
  const key = ipKey(ip);
  if (isIPv4(key)) return `${key.split(".").slice(0, 3).join(".")}.0/24`;
  const addr = ip.split("%")[0] ?? ip;
  if (!isIPv6(addr)) return key;
  return `${expandIPv6(addr).slice(0, 3).join(":")}::/48`;
}

export const isIPv6Key = (key: string): boolean => key.includes(":");

/** Birden çok CIDR (tenant güvenilen listesi, §13.6); boş liste → her zaman false. */
export function cidrListMatcher(cidrs: readonly string[]): (ip: string) => boolean {
  const matchers = cidrs.map((c) => cidrMatcher(c));
  return (ip) => matchers.some((m) => m(ip));
}

/**
 * CIDR üyelik denetleyicisi (S-P2-T2-1). `cidr` boşsa her zaman false. Zone id atılır, IPv4-mapped IPv6
 * IPv4 olarak denetlenir. CIDR biçimi env.ts'de doğrulanır.
 */
export function cidrMatcher(cidr: string | undefined): (ip: string) => boolean {
  if (!cidr) return () => false;
  const [net = "", bits = ""] = cidr.split("/");
  const list = new BlockList();
  list.addSubnet(net, Number(bits), isIPv4(net) ? "ipv4" : "ipv6");
  return (ip) => {
    const addr = ip.split("%")[0] ?? ip;
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(addr)?.[1];
    const v = mapped ?? addr;
    if (isIPv4(v)) return list.check(v, "ipv4");
    return isIPv6(v) && list.check(v, "ipv6");
  };
}
