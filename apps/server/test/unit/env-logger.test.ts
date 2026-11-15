import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/env.ts";
import { maskUrl } from "../../src/lib/logger.ts";
import { abuseEmail } from "../../src/public/consent.ts";
import { FAKE_APP_ENCRYPTION_KEYS } from "../helpers/secrets.ts";

const refKey = "k".repeat(32);
const base = {
  PUBLIC_BASE_URL: "https://rs.test:4450",
  DATABASE_URL: "mysql://app:gizli@db/remote",
  APP_ENCRYPTION_KEYS: FAKE_APP_ENCRYPTION_KEYS,
};

describe("env", () => {
  it("AC-78: production'da APP_ENCRYPTION_KEYS zorunlu; hatalı biçim reddedilir, değer mesajda yok", () => {
    const prod = { ...base, NODE_ENV: "production", TRUSTED_PROXY_CIDR: "172.30.0.2/32", SESSION_REF_KEY: refKey };
    expect(() => loadEnv({ ...prod, APP_ENCRYPTION_KEYS: undefined })).toThrow(/APP_ENCRYPTION_KEYS/);
    expect(() => loadEnv({ ...prod, APP_ENCRYPTION_KEYS: "v1:gizlideger" })).toThrow(/^(?!.*gizlideger).*APP_ENCRYPTION_KEYS/);
    expect(loadEnv(prod).encryptionKeys?.get(1)).toHaveLength(32);
  });

  it("S14-7: production'da tüm baytları aynı anahtar (CI'daki sıfır anahtar dahil) reddedilir; geliştirmede kabul", () => {
    const prod = { ...base, NODE_ENV: "production", TRUSTED_PROXY_CIDR: "172.30.0.2/32", SESSION_REF_KEY: refKey };
    const zero = `v1:${Buffer.alloc(32, 0).toString("base64")}`;
    expect(zero).toBe("v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="); // .github/workflows/ci.yml compose adımındaki değer
    const same = `v1:${Buffer.alloc(32, 0x41).toString("base64")}`;
    expect(() => loadEnv({ ...prod, APP_ENCRYPTION_KEYS: zero })).toThrow(/APP_ENCRYPTION_KEYS.*zayıf/s);
    expect(() => loadEnv({ ...prod, APP_ENCRYPTION_KEYS: same })).toThrow(/APP_ENCRYPTION_KEYS/);
    // rotasyon listesinde tek zayıf sürüm de yeter
    expect(() => loadEnv({ ...prod, APP_ENCRYPTION_KEYS: `${FAKE_APP_ENCRYPTION_KEYS},${zero.replace("v1:", "v2:")}` })).toThrow(
      /APP_ENCRYPTION_KEYS/,
    );
    expect(loadEnv(prod).encryptionKeys?.size).toBe(1);
    expect(loadEnv({ ...base, NODE_ENV: "test", APP_ENCRYPTION_KEYS: zero }).encryptionKeys?.get(1)).toHaveLength(32);
  });

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

describe("boş env değeri = tanımsız (compose `${X:-}`)", () => {
  it("B-P12b-3: WHATSAPP_SERVICE_URL panel kuralıyla (waServiceUrlSchema) doğrulanır; uymazsa açılış durur, değer mesajda yok", () => {
    for (const v of [
      "http://kullanici:sifre@wa.test",
      "http://wa.test/?k=v",
      "http://wa.test#f",
      "ftp://wa.test",
      "http://wa\u200b.test",
      `https://${"a".repeat(193)}`,
      "wa.test:3000",
    ]) {
      let msg = "";
      try {
        loadEnv({ ...base, WHATSAPP_SERVICE_URL: v });
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg, v).toMatch(/WHATSAPP_SERVICE_URL/);
      expect(msg).not.toContain("sifre");
      expect(msg).not.toContain("wa.test");
    }
    expect(loadEnv({ ...base, WHATSAPP_SERVICE_URL: "https://wa.test:8443/api/" }).WHATSAPP_SERVICE_URL).toBe("https://wa.test:8443/api");
  });

  it("S-P13b-9: WHATSAPP_SERVICE_API_KEY yalnız yazdırılabilir ASCII 16–256; hata mesajında değer yok", () => {
    expect(loadEnv({ ...base, WHATSAPP_SERVICE_API_KEY: "A".repeat(16) }).WHATSAPP_SERVICE_API_KEY).toBe("A".repeat(16));
    expect(loadEnv(base).WHATSAPP_SERVICE_API_KEY).toBeUndefined();
    for (const v of ["kisa", "ç".repeat(20), `${"a".repeat(20)}\u200B`, `${"a".repeat(10)} ${"b".repeat(10)}`, "x".repeat(257)]) {
      let msg = "";
      try {
        loadEnv({ ...base, WHATSAPP_SERVICE_API_KEY: v });
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg, v).toMatch(/WHATSAPP_SERVICE_API_KEY/);
      expect(msg).not.toContain(v);
    }
  });

  it("G-P13b-2: yerleşik varsayılan adres yok — verilmezse/boşsa kanal yapılandırılmamış (boş dize); verilirse kanonikleşir", () => {
    expect(loadEnv({ ...base, WHATSAPP_SERVICE_URL: " " }).WHATSAPP_SERVICE_URL).toBe("");
    expect(loadEnv(base).WHATSAPP_SERVICE_URL).toBe("");
    expect(loadEnv({ ...base, WHATSAPP_SERVICE_URL: "HTTP://WA.Test:3000/" }).WHATSAPP_SERVICE_URL).toBe("http://wa.test:3000");
  });

  it("opsiyonel alanlar boş/boşluk dizeyle hata vermez ve varsayılana düşer", () => {
    const env = loadEnv({
      ...base,
      METRICS_TOKEN: "",
      ABUSE_EMAIL: "  ",
      TURN_URLS: "",
      TURN_SECRET: "",
      TURN_CRED_TTL_MIN: "",
      ALLOWED_ORIGINS: " ",
      TRUSTED_PROXY_CIDR: "",
      SESSION_REF_KEY: "",
      LOG_LEVEL: "",
    });
    expect(env).toMatchObject({ TURN_CRED_TTL_MIN: 20, LOG_LEVEL: "info", turnUrls: [], allowedOrigins: ["https://rs.test:4450"] });
    for (const k of ["METRICS_TOKEN", "ABUSE_EMAIL", "TURN_SECRET", "SESSION_REF_KEY", "TRUSTED_PROXY_CIDR"] as const)
      expect(env[k]).toBeUndefined();
  });

  it("production'da zorunlu alanlar boşken yine hata; dolu ama geçersiz değer yine hata", () => {
    const prod = { ...base, NODE_ENV: "production", TRUSTED_PROXY_CIDR: "172.30.0.2/32", SESSION_REF_KEY: refKey };
    expect(() => loadEnv({ ...prod, SESSION_REF_KEY: "" })).toThrow(/SESSION_REF_KEY/);
    expect(() => loadEnv({ ...prod, TRUSTED_PROXY_CIDR: " " })).toThrow(/TRUSTED_PROXY_CIDR/);
    expect(() => loadEnv({ ...base, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...base, METRICS_TOKEN: "kisa" })).toThrow(/METRICS_TOKEN/);
  });
});

describe("ABUSE_EMAIL (S-P4-1)", () => {
  const dbWith = (email: string | null) => {
    const calls: unknown[] = [];
    const db = { user: { findFirst: async (q: unknown) => (calls.push(q), email ? { email } : null) } } as unknown as Parameters<
      typeof abuseEmail
    >[0];
    return { db, calls };
  };

  it("AC-125: ABUSE_EMAIL e-posta formatında olmalı; geçerli değer kabul edilir", () => {
    expect(() => loadEnv({ ...base, ABUSE_EMAIL: "gecersiz" })).toThrow(/ABUSE_EMAIL/);
    expect(() => loadEnv({ ...base, ABUSE_EMAIL: "a@b" })).toThrow(/ABUSE_EMAIL/);
    expect(loadEnv({ ...base, ABUSE_EMAIL: "abuse@example.test" }).ABUSE_EMAIL).toBe("abuse@example.test");
  });

  it("S-P4-1: production'da ABUSE_EMAIL yoksa null — Super Admin sorgulanmaz", async () => {
    const { db, calls } = dbWith("sa@example.test");
    expect(await abuseEmail(db, { fromEnv: undefined, superAdminFallback: false })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("S-P4-1: ABUSE_EMAIL verilmişse her ortamda o; dev/test'te yoksa Super Admin e-postası, o da yoksa null", async () => {
    const { db, calls } = dbWith("sa@example.test");
    expect(await abuseEmail(db, { fromEnv: "abuse@example.test", superAdminFallback: false })).toBe("abuse@example.test");
    expect(await abuseEmail(db, { fromEnv: "abuse@example.test", superAdminFallback: true })).toBe("abuse@example.test");
    expect(calls).toHaveLength(0);
    expect(await abuseEmail(db, { fromEnv: undefined, superAdminFallback: true })).toBe("sa@example.test");
    expect(await abuseEmail(dbWith(null).db, { fromEnv: undefined, superAdminFallback: true })).toBeNull();
  });
});

describe("maskUrl", () => {
  it("AC-90: sorgu dizesi atılır, /session/<token> maskelenir", () => {
    expect(maskUrl("/session/abcDEF123_-/x?ref=1")).toBe("/session/***/x");
    expect(maskUrl("/api/v1/auth/me?token=x")).toBe("/api/v1/auth/me");
  });
});
