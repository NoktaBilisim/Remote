// Ayar test/kayıt uçlarıyla iç ağ taramasını önler (G-12, AC-122, T22). Ad çözülür; adreslerden BİRİ bile yasak
// aralıktaysa ret (rebinding/çoklu kayıt). Bağlantı çözümlenen ilk IP'ye yapılır (SNI = ad) → ikinci çözümleme yok.
// B-P10-4: IPv6 yalnız global unicast 2000::/3 (eksi özel amaçlı alt bloklar) kabul edilir; IPv4-mapped (::ffff:a.b.c.d)
// gömülü IPv4 kuralıyla denetlenir. IPv4-compatible (::/96), SIIT, NAT64 (64:ff9b::/96, 64:ff9b:1::/48), 6to4, Teredo,
// site-local, ULA, link-local, multicast, belirtilmemiş adres bu kuralla engellenir.
// B-P10-1: `denyHosts` (PUBLIC_BASE_URL hostu) her denetimde çözülür; sunucunun kendi genel IP'si de hedef olamaz.
// B-P10-10: kendi adımız çözülemezse son başarılı çözüm kullanılır; hiç yoksa ret (fail-closed). Karşılaştırma kanonik
// metinle (IPv6 RFC 5952 biçimi, IPv4-mapped → IPv4) — sıfır dolgulu/uzun yazım kuralı atlatamaz.
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { AppError } from "./errors.ts";

const V4: readonly [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
/** 2000::/3 içindeki özel amaçlı bloklar: IETF protokol (Teredo 2001::/32 dahil), belgeleme, 6to4, yeni belgeleme. */
const V6_DENY_IN_GLOBAL: readonly [string, number][] = [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
];
const BLOCKED_V4 = new BlockList();
for (const [n, b] of V4) BLOCKED_V4.addSubnet(n, b, "ipv4");
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet("2000::", 3, "ipv6");
const BLOCKED_V6 = new BlockList();
for (const [n, b] of V6_DENY_IN_GLOBAL) BLOCKED_V6.addSubnet(n, b, "ipv6");

/** IPv6 metni → 16 bayt (sonda noktalı IPv4 desteklenir); geçersiz ya da bölge kimlikli (%eth0) ise null. */
export function parseIpv6(ip: string): number[] | null {
  if (isIP(ip) !== 6 || ip.includes("%")) return null;
  let s = ip.toLowerCase();
  let tail: number[] = [];
  const m = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (m) {
    const [a, b, c, d] = [m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number];
    tail = [(a << 8) | b, (c << 8) | d];
    const head = m[1] ?? "";
    s = head.endsWith("::") ? head : head.slice(0, -1);
  }
  const words = (x: string): number[] => (x === "" ? [] : x.split(":").map((w) => parseInt(w, 16)));
  const dbl = s.indexOf("::");
  let all: number[];
  if (dbl >= 0) {
    const h = words(s.slice(0, dbl));
    const r = words(s.slice(dbl + 2));
    const fill = 8 - h.length - r.length - tail.length;
    if (fill < 0) return null;
    all = [...h, ...Array<number>(fill).fill(0), ...r, ...tail];
  } else all = [...words(s), ...tail];
  if (all.length !== 8 || all.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)) return null;
  return all.flatMap((w) => [w >> 8, w & 0xff]);
}

/** 16 bayt → RFC 5952 metni (küçük harf, baştaki sıfırlar atılır, en uzun ≥2 sıfır grubu `::`, eşitlikte ilki). */
function formatIpv6(b: number[]): string {
  const w = Array.from({ length: 8 }, (_, i) => ((b[2 * i] ?? 0) << 8) | (b[2 * i + 1] ?? 0));
  let best = -1;
  let bestLen = 1;
  for (let i = 0; i < 8;) {
    let j = i;
    while (j < 8 && w[j] === 0) j++;
    if (j - i > bestLen) [best, bestLen] = [i, j - i];
    i = j === i ? i + 1 : j;
  }
  const hex = w.map((x) => x.toString(16));
  if (best < 0) return hex.join(":");
  return `${hex.slice(0, best).join(":")}::${hex.slice(best + bestLen).join(":")}`;
}

/** Kanonik metin: IPv4-mapped (::ffff:a.b.c.d, her yazımıyla) → gömülü IPv4; diğer IPv6 → RFC 5952; aksi adresin kendisi. */
export function canonicalIp(ip: string): string {
  const b = parseIpv6(ip);
  if (!b) return ip;
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) return b.slice(12).join(".");
  return formatIpv6(b);
}

export function isBlockedIp(ip: string): boolean {
  if (ip.includes("%")) return true; // bölge kimlikli (link-local) adres
  const addr = canonicalIp(ip);
  const fam = isIP(addr);
  if (fam === 4) return BLOCKED_V4.check(addr, "ipv4");
  if (fam === 6) return !GLOBAL_V6.check(addr, "ipv6") || BLOCKED_V6.check(addr, "ipv6");
  return true;
}

/** Geri döngü (127/8, ::1) ve özel ağ (RFC 1918, ULA fc00::/7) — P14a AC-211 `classifyHost` için. */
const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");
const PRIVATE = new BlockList();
for (const [n, b] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const)
  PRIVATE.addSubnet(n, b, "ipv4");
PRIVATE.addSubnet("fc00::", 7, "ipv6");

export type HostClass = "loopback" | "private" | "public" | "unresolved";

const familyOf = (ip: string): "ipv4" | "ipv6" => (isIP(ip) === 6 ? "ipv6" : "ipv4");

/** Tek adres sınıfı (kanonik metinle; IPv4-mapped → IPv4). */
export function classifyIp(ip: string): Exclude<HostClass, "unresolved"> {
  const addr = canonicalIp(ip);
  if (ip.includes("%") || isIP(addr) === 0) return "public"; // bölge kimlikli / geçersiz: ayrıcalık yok
  if (LOOPBACK.check(addr, familyOf(addr))) return "loopback";
  return PRIVATE.check(addr, familyOf(addr)) ? "private" : "public";
}

const defaultLookupAll = async (h: string): Promise<string[]> => (await lookup(h, { all: true, verbatim: true })).map((a) => a.address);

/**
 * P14a (AC-211): hedef adın sınıfı ve bağlanılacak ilk adres. Ad bir kez çözülür; çağıran bu IP'ye bağlanır (ikinci
 * çözümleme / rebinding yok). Adreslerin HEPSİ geri döngüyse `loopback`, hepsi geri döngü ∪ özel ağdaysa `private`,
 * biri bile genelse `public`; çözülemezse `unresolved`.
 */
export async function classifyHost(
  host: string,
  lookupAll: (host: string) => Promise<string[]> = defaultLookupAll,
): Promise<{ cls: HostClass; ip: string | null }> {
  const h = bare(host);
  let ips: string[];
  try {
    ips = isIP(h) ? [h] : h === "localhost" ? ["127.0.0.1"] : await lookupAll(h);
  } catch {
    ips = [];
  }
  if (ips.length === 0) return { cls: "unresolved", ip: null };
  const classes = ips.map(classifyIp);
  const cls = classes.every((c) => c === "loopback") ? "loopback" : classes.every((c) => c !== "public") ? "private" : "public";
  return { cls, ip: ips[0] ?? null };
}

export interface NetGuard {
  /** İzinli ilk IP; yasak/çözülemeyen → 400 HOST_NOT_ALLOWED (genel mesaj). */
  resolve(host: string): Promise<string>;
}

export const HOST_NOT_ALLOWED_MESSAGE = "Bu sunucu adresi kullanılamaz.";

const bare = (h: string): string => h.replace(/^\[|\]$/g, "").toLowerCase();

export interface NetGuardOptions {
  lookupAll?: (host: string) => Promise<string[]>;
  isBlocked?: (ip: string) => boolean;
  /** Kendi adlarımız (PUBLIC_BASE_URL hostu); çözümlenen IP'ler hedef olamaz. */
  denyHosts?: readonly string[];
  /** Kendi adımız çözülemedi (alarm logu): `cached` = son başarılı çözüm kullanıldı; değilse istek reddedildi. */
  onSelfUnresolved?: (host: string, cached: boolean) => void;
}

export function createNetGuard(o: NetGuardOptions = {}): NetGuard {
  const lookupAll = o.lookupAll ?? defaultLookupAll;
  const blocked = o.isBlocked ?? isBlockedIp;
  const ipsOf = async (h: string): Promise<string[]> => {
    try {
      return isIP(h) ? [h] : h === "localhost" ? ["127.0.0.1"] : await lookupAll(h);
    } catch {
      return [];
    }
  };
  /** Son başarılı kendi-ad çözümü (kanonik). Geçici DNS hatasında kural devre dışı kalmaz (B-P10-10). */
  const lastGood = new Map<string, readonly string[]>();
  /** Kendi adreslerimiz (her çağrıda çözülür; DNS değişirse güncel). Çözüm yok + önbellek yok → null (fail-closed). */
  const selfIps = async (): Promise<Set<string> | null> => {
    const lists = await Promise.all(
      (o.denyHosts ?? []).map(async (h) => {
        const name = bare(h);
        const ips = (await ipsOf(name)).map(canonicalIp);
        if (ips.length > 0) {
          lastGood.set(name, ips);
          return ips;
        }
        const cached = lastGood.get(name) ?? null;
        o.onSelfUnresolved?.(name, cached !== null);
        return cached;
      }),
    );
    if (lists.some((l) => l === null)) return null;
    return new Set(lists.flatMap((l) => l ?? []));
  };
  return {
    async resolve(host: string): Promise<string> {
      const ips = await ipsOf(bare(host));
      const self = await selfIps();
      if (!self || ips.length === 0 || ips.some((ip) => blocked(ip) || self.has(canonicalIp(ip))))
        throw new AppError("HOST_NOT_ALLOWED", { message: HOST_NOT_ALLOWED_MESSAGE });
      return ips[0] as string;
    },
  };
}
