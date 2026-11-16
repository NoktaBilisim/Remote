// P28b K6 (mimari-p28b §11.3; güvenlik D-r2-5, O-P28b-1): ClamAV env doğrulaması.
import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/env.ts";

const base = { PUBLIC_BASE_URL: "https://rs.test:4450", DATABASE_URL: "mysql://app:gizli@db/remote", NODE_ENV: "test" };

describe("P28b env — CLAMAV_* / FILES_DIR (D-r2-5)", () => {
  it("varsayılanlar: FILES_DIR /data/files, CLAMAV_PORT 3310, CIDR yok", () => {
    const e = loadEnv(base);
    expect(e.FILES_DIR).toBe("/data/files");
    expect(e.CLAMAV_PORT).toBe(3310);
    expect(e.CLAMAV_ALLOWED_CIDR).toBeUndefined();
    expect(e.CLAMAV_HOST).toBeUndefined();
  });

  it.each(["172.30.2.0/28", "172.30.3.0/28", "10.1.2.0/24", "192.168.5.4/30"])("kabul: %s", (c) => {
    expect(loadEnv({ ...base, CLAMAV_ALLOWED_CIDR: c, CLAMAV_HOST: "clamav" }).CLAMAV_ALLOWED_CIDR).toBe(c);
  });

  it.each([
    ["geniş önek", "10.0.0.0/8"],
    ["önek < /24", "172.30.0.0/23"],
    ["önek > /30", "172.30.2.0/32"],
    ["ağ adresi değil", "172.30.2.5/28"],
    ["özel değil", "8.8.8.0/24"],
    ["loopback", "127.0.0.0/24"],
    ["IPv6", "fd00::/120"],
    ["IPv4 eşlenmiş IPv6", "::ffff:172.30.2.0/124"],
    ["önek yok", "172.30.2.0"],
    ["çöp", "abc/28"],
  ])("ret (%s): %s", (_, c) => {
    expect(() => loadEnv({ ...base, CLAMAV_ALLOWED_CIDR: c })).toThrow(/CLAMAV_ALLOWED_CIDR/);
  });

  it("TRUSTED_PROXY_CIDR ile çakışma → ret; çakışmayan kabul", () => {
    expect(() => loadEnv({ ...base, CLAMAV_ALLOWED_CIDR: "172.30.0.0/24", TRUSTED_PROXY_CIDR: "172.30.0.2/31" })).toThrow(/çakışmamalı/);
    expect(loadEnv({ ...base, CLAMAV_ALLOWED_CIDR: "172.30.2.0/28", TRUSTED_PROXY_CIDR: "172.30.0.2/31" }).CLAMAV_ALLOWED_CIDR).toBe(
      "172.30.2.0/28",
    );
  });

  it("FILES_DIR göreli / UPLOADS_DIR ile iç içe → ret; CLAMAV_HOST biçimi denetlenir", () => {
    expect(() => loadEnv({ ...base, FILES_DIR: "data/files" })).toThrow(/FILES_DIR/);
    expect(() => loadEnv({ ...base, FILES_DIR: "/data/uploads/files" })).toThrow(/FILES_DIR/);
    expect(() => loadEnv({ ...base, FILES_DIR: "/data/uploads/" })).toThrow(/FILES_DIR/);
    expect(() => loadEnv({ ...base, CLAMAV_HOST: "http://clamav" })).toThrow(/CLAMAV_HOST/);
    expect(() => loadEnv({ ...base, CLAMAV_PORT: "0" })).toThrow(/CLAMAV_PORT/);
  });
});
