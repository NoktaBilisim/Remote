import { describe, expect, it } from "vitest";
import { cidrMatcher, ipKey, prefixKey } from "../../src/lib/ip.ts";

describe("ipKey", () => {
  it("AC-121: IPv4 /32, IPv4-mapped IPv6 IPv4'e indirgenir", () => {
    expect(ipKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("AC-121: aynı /64 içindeki IPv6 adresleri tek anahtar, farklı /64 ayrı", () => {
    const a = ipKey("2001:db8:1:2:aaaa::1");
    expect(ipKey("2001:DB8:1:2:ffff:ffff:ffff:ffff")).toBe(a);
    expect(ipKey("2001:db8:1:2::%eth0")).toBe(a);
    expect(a).toBe("2001:0db8:0001:0002::/64");
    expect(ipKey("2001:db8:1:3::1")).not.toBe(a);
    expect(ipKey("::1")).toBe("0000:0000:0000:0000::/64");
  });
});

describe("prefixKey", () => {
  it("AC-3: IPv4 /24 ve IPv4-mapped aynı önek; farklı /24 ayrı", () => {
    expect(prefixKey("203.0.113.7")).toBe("203.0.113.0/24");
    expect(prefixKey("::ffff:203.0.113.200")).toBe("203.0.113.0/24");
    expect(prefixKey("203.0.114.7")).not.toBe(prefixKey("203.0.113.7"));
  });

  it("AC-3: aynı /56 içindeki IPv6 adresleri tek anahtar, farklı /56 ayrı", () => {
    const a = prefixKey("2001:db8:1:2a00::1");
    expect(a).toBe("2001:0db8:0001:2a00::/56");
    expect(prefixKey("2001:db8:1:2aff:ffff::9")).toBe(a);
    expect(prefixKey("2001:db8:1:2b00::1")).not.toBe(a);
  });
});

describe("cidrMatcher (S-P2-T2-1)", () => {
  it("S-P2-T2-1: IPv4 /31 üyeliği; mapped IPv6 IPv4 sayılır; CIDR yoksa hep false", () => {
    const m = cidrMatcher("172.30.0.2/31");
    expect(m("172.30.0.2")).toBe(true);
    expect(m("172.30.0.3")).toBe(true);
    expect(m("::ffff:172.30.0.3")).toBe(true);
    expect(m("172.30.0.4")).toBe(false);
    expect(m("2001:db8::1")).toBe(false);
    expect(m("geçersiz")).toBe(false);
    expect(cidrMatcher(undefined)("172.30.0.3")).toBe(false);
  });

  it("S-P2-T2-1: IPv6 alt ağ üyeliği, zone id atılır", () => {
    const m = cidrMatcher("fd00:30::/64");
    expect(m("fd00:30::3")).toBe(true);
    expect(m("fd00:30::3%eth0")).toBe(true);
    expect(m("fd00:31::3")).toBe(false);
    expect(m("172.30.0.3")).toBe(false);
  });
});
