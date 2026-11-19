// P27-K2 (mimari-p27 §4.5 r2, K-P27-3/22; AC-297, AC-342): DEPLOY_ENV zorunluluğu ve imza kapısı modu kuralları.
import { describe, expect, it } from "vitest";
import { loadEnv, macSigningUnsetInProduction } from "../../src/env.ts";
import { createGate } from "../../src/unattended/gate.ts";
import { FAKE_APP_ENCRYPTION_KEYS } from "../helpers/secrets.ts";

const SHA = "ab".repeat(32);
const base = { PUBLIC_BASE_URL: "https://rs.test:4450", DATABASE_URL: "mysql://app:gizli@db/remote", NODE_ENV: "test" };
const prod = {
  ...base,
  NODE_ENV: "production",
  APP_ENCRYPTION_KEYS: FAKE_APP_ENCRYPTION_KEYS,
  TRUSTED_PROXY_CIDR: "172.30.0.2/32",
  SESSION_REF_KEY: "k".repeat(32),
};

describe("P27 env — DEPLOY_ENV / UNATTENDED_MODE (AC-342)", () => {
  it("AC-342: NODE_ENV=production + DEPLOY_ENV yok → açılış hatası", () => {
    expect(() => loadEnv(prod)).toThrow(/DEPLOY_ENV gerekli/);
    expect(loadEnv({ ...prod, DEPLOY_ENV: "production" }).UNATTENDED_MODE).toBe("off");
  });

  it("AC-342 AC-297: production + unsigned → hata; development + unsigned → hata (unsigned yalnız staging)", () => {
    expect(() => loadEnv({ ...prod, DEPLOY_ENV: "production", UNATTENDED_MODE: "unsigned" })).toThrow(/unsigned yalnız/);
    expect(() => loadEnv({ ...base, DEPLOY_ENV: "development", UNATTENDED_MODE: "unsigned" })).toThrow(/unsigned yalnız/);
  });

  it("AC-342: DEPLOY_ENV yok + UNATTENDED_MODE=signed (test/dev dahil) → hata; signed SHA listesiz → hata", () => {
    expect(() => loadEnv({ ...base, UNATTENDED_MODE: "signed", UNATTENDED_SIGNED_SHA256: SHA })).toThrow(/DEPLOY_ENV gerekli/);
    expect(() => loadEnv({ ...prod, DEPLOY_ENV: "production", UNATTENDED_MODE: "signed" })).toThrow(/UNATTENDED_SIGNED_SHA256/);
  });

  it("AC-342: staging + unsigned açılır (NODE_ENV=production dahil); off modda DEPLOY_ENV test ortamında gerekmez", () => {
    expect(loadEnv({ ...prod, DEPLOY_ENV: "staging", UNATTENDED_MODE: "unsigned" }).UNATTENDED_MODE).toBe("unsigned");
    expect(loadEnv({ ...base, DEPLOY_ENV: "staging", UNATTENDED_MODE: "unsigned" }).DEPLOY_ENV).toBe("staging");
    expect(loadEnv(base).UNATTENDED_MODE).toBe("off");
  });

  it("AC-297: kapı — off hepsini, signed yalnız imzalı ∧ listedeki SHA'yı, unsigned hepsini kabul eder", () => {
    const off = createGate(loadEnv(base));
    const unsigned = createGate(loadEnv({ ...base, DEPLOY_ENV: "staging", UNATTENDED_MODE: "unsigned" }));
    const signed = createGate(
      loadEnv({ ...prod, DEPLOY_ENV: "production", UNATTENDED_MODE: "signed", UNATTENDED_SIGNED_SHA256: `${SHA},${"cd".repeat(32)}` }),
    );
    const dev = (s: boolean, sha = SHA) => ({ signed: s, sha256: sha });
    expect([off.allows(dev(true)), off.status()]).toEqual([false, { mode: "off", available: false }]);
    expect([unsigned.allows(dev(false)), unsigned.status().available]).toEqual([true, true]);
    expect([signed.allows(dev(true)), signed.allows(dev(false)), signed.allows(dev(true, "ef".repeat(32)))]).toEqual([true, false, false]);
  });
});

describe("P28f-r4 MAC_AGENT_SIGNING (K-P28f-r4-2, AC-502)", () => {
  it("AC-502: adhoc/notarized kabul; boş dize → tanımsız; geçersiz değer → açılış hatası (S-r4-8)", () => {
    expect(loadEnv({ ...base, MAC_AGENT_SIGNING: "adhoc" }).MAC_AGENT_SIGNING).toBe("adhoc");
    expect(loadEnv({ ...base, MAC_AGENT_SIGNING: "notarized" }).MAC_AGENT_SIGNING).toBe("notarized");
    expect(loadEnv({ ...base, MAC_AGENT_SIGNING: "" }).MAC_AGENT_SIGNING).toBeUndefined();
    expect(loadEnv(base).MAC_AGENT_SIGNING).toBeUndefined();
    for (const bad of ["Notarized", "signed", "developer-id", "true"])
      expect(() => loadEnv({ ...base, MAC_AGENT_SIGNING: bad })).toThrow(/MAC_AGENT_SIGNING/);
  });

  it("AC-502: açılış uyarısı yalnız production + MAC_AGENT_SHA256 dolu + MAC_AGENT_SIGNING boş", () => {
    const p = { ...prod, DEPLOY_ENV: "production" };
    expect(macSigningUnsetInProduction(loadEnv({ ...p, MAC_AGENT_SHA256: SHA }))).toBe(true);
    expect(macSigningUnsetInProduction(loadEnv({ ...p, MAC_AGENT_SHA256: SHA, MAC_AGENT_SIGNING: "" }))).toBe(true);
    expect(macSigningUnsetInProduction(loadEnv({ ...p, MAC_AGENT_SHA256: SHA, MAC_AGENT_SIGNING: "adhoc" }))).toBe(false);
    expect(macSigningUnsetInProduction(loadEnv(p))).toBe(false);
    expect(macSigningUnsetInProduction(loadEnv({ ...base, MAC_AGENT_SHA256: SHA }))).toBe(false);
  });
});
