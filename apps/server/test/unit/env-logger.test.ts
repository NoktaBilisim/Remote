import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/env.ts";
import { maskUrl } from "../../src/lib/logger.ts";

const refKey = "k".repeat(32);
const base = { PUBLIC_BASE_URL: "https://rs.test:4450", DATABASE_URL: "mysql://app:gizli@db/remote" };

describe("env", () => {
  it("AC-121: production'da TRUSTED_PROXY_CIDR zorunlu; hata mesajı değer sızdırmaz", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production" })).toThrow(/TRUSTED_PROXY_CIDR/);
    expect(() => loadEnv({ ...base, NODE_ENV: "production", TRUSTED_PROXY_CIDR: "172.30.0.2/33" })).toThrow(/CIDR/);
    expect(() => loadEnv({ ...base, DATABASE_URL: "postgres://app:gizli@db" })).not.toThrow(/gizli/);
    const env = loadEnv({ ...base, NODE_ENV: "production", TRUSTED_PROXY_CIDR: "172.30.0.2/32", SESSION_REF_KEY: refKey });
    expect(env.allowedOrigins).toEqual(["https://rs.test:4450"]);
  });

  it("S-P2-7: production'da SESSION_REF_KEY zorunlu (≥32); geliştirmede opsiyonel", () => {
    const prod = { ...base, NODE_ENV: "production", TRUSTED_PROXY_CIDR: "172.30.0.2/32" };
    expect(() => loadEnv(prod)).toThrow(/SESSION_REF_KEY/);
    expect(() => loadEnv({ ...prod, SESSION_REF_KEY: "kisa" })).toThrow(/SESSION_REF_KEY/);
    expect(loadEnv({ ...prod, SESSION_REF_KEY: refKey }).SESSION_REF_KEY).toBe(refKey);
    expect(loadEnv({ ...base, NODE_ENV: "development" }).SESSION_REF_KEY).toBeUndefined();
  });
});

describe("maskUrl", () => {
  it("AC-90: sorgu dizesi atılır, /session/<token> maskelenir", () => {
    expect(maskUrl("/session/abcDEF123_-/x?ref=1")).toBe("/session/***/x");
    expect(maskUrl("/api/v1/auth/me?token=x")).toBe("/api/v1/auth/me");
  });
});
