// P27-K2 (mimari-p27 §4.5 r2, K-P27-3/22; AC-297, AC-342): DEPLOY_ENV zorunluluğu ve imza kapısı modu kuralları.
import { describe, expect, it } from "vitest";
import { listFingerprint, loadEnv, macSigningUnsetInProduction, normalizeShaList } from "../../src/env.ts";
import { createGate, riskAcceptedAlarm } from "../../src/unattended/gate.ts";
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

// P32 (mimari-p32 §4.1–4.2, ADR-0042): `unsigned-accepted` modu.
const SHA2 = "cd".repeat(32);
const accepted = (o: Record<string, string> = {}) => ({
  ...prod,
  DEPLOY_ENV: "production",
  UNATTENDED_MODE: "unsigned-accepted",
  UNATTENDED_SIGNED_SHA256: `${SHA},${SHA2}`,
  UNATTENDED_AGENT_SHA256: SHA,
  UNATTENDED_AGENT_VERSION: "0.23.0",
  ...o,
});
const errorOf = (src: Record<string, string>): string => {
  try {
    loadEnv(src);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};

describe("P32 env — UNATTENDED_MODE=unsigned-accepted (AC-523, AC-524, AC-533)", () => {
  it("AC-523: production + unsigned-accepted açılır; staging de açılır; production + unsigned yine hata", () => {
    expect(loadEnv(accepted()).UNATTENDED_MODE).toBe("unsigned-accepted");
    expect(loadEnv(accepted({ DEPLOY_ENV: "staging" })).DEPLOY_ENV).toBe("staging");
    expect(() => loadEnv({ ...prod, DEPLOY_ENV: "production", UNATTENDED_MODE: "unsigned" })).toThrow(/unsigned yalnız/);
  });

  it("AC-523: development + unsigned-accepted → hata; DEPLOY_ENV yok + unsigned-accepted → hata; mesajda değer yok", () => {
    const dev = errorOf(accepted({ ...base, DEPLOY_ENV: "development" }));
    expect(dev).toMatch(/unsigned-accepted yalnız DEPLOY_ENV=production\|staging/);
    const noEnv: Record<string, string> = accepted({ NODE_ENV: "test" });
    delete noEnv.DEPLOY_ENV;
    expect(errorOf(noEnv)).toMatch(/DEPLOY_ENV gerekli/);
    for (const m of [dev, errorOf(noEnv)]) {
      expect(m).not.toContain(SHA);
      expect(m).not.toContain("gizli");
    }
  });

  it("AC-524: liste boş → hata; AGENT_SHA256 listede değil → hata (değer mesajda yok); büyük harf/boşluklu liste normalize edilir", () => {
    expect(errorOf(accepted({ UNATTENDED_SIGNED_SHA256: "" }))).toMatch(
      /UNATTENDED_SIGNED_SHA256: signed\/unsigned-accepted modda zorunlu/,
    );
    const notListed = errorOf(accepted({ UNATTENDED_AGENT_SHA256: "ef".repeat(32) }));
    expect(notListed).toMatch(/UNATTENDED_AGENT_SHA256: izinli listede değil/);
    expect(notListed).not.toContain("ef".repeat(32));
    expect(notListed).not.toContain(SHA);
    expect(loadEnv(accepted({ UNATTENDED_SIGNED_SHA256: `${SHA.toUpperCase()} , ${SHA2}` })).unattendedSignedSha256.has(SHA)).toBe(true);
    expect(loadEnv(accepted({ UNATTENDED_AGENT_SHA256: SHA.toUpperCase() })).UNATTENDED_AGENT_SHA256).toBe(SHA);
  });

  it("AC-524 AC-533: unsigned-accepted'te AGENT_SHA256 ya da AGENT_VERSION boşsa hata; sürüm X.Y.Z değilse hata", () => {
    for (const o of [{ UNATTENDED_AGENT_SHA256: "" }, { UNATTENDED_AGENT_VERSION: "" }] as Record<string, string>[])
      expect(errorOf(accepted(o))).toMatch(/UNATTENDED_AGENT_SHA256 ve UNATTENDED_AGENT_VERSION zorunlu/);
    for (const v of ["v0.23.0", "0.23", "0.23.0-rc1", "x.y.z"])
      expect(errorOf(accepted({ UNATTENDED_AGENT_VERSION: v }))).toMatch(/UNATTENDED_AGENT_VERSION/);
    // Diğer modlarda sürüm isteğe bağlı; signed için "listede olmalı" kuralı eklenmez (mimari-p32 §4.1).
    expect(loadEnv(base).UNATTENDED_AGENT_VERSION).toBeUndefined();
    expect(
      loadEnv({
        ...prod,
        DEPLOY_ENV: "production",
        UNATTENDED_MODE: "signed",
        UNATTENDED_SIGNED_SHA256: SHA2,
        UNATTENDED_AGENT_SHA256: SHA,
      }).UNATTENDED_MODE,
    ).toBe("signed");
  });

  it("AC-524: liste en çok 20 öğe — her modda (off dahil); 20 kabul", () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => i.toString(16).padStart(2, "0").repeat(32)).join(",");
    expect(loadEnv(accepted({ UNATTENDED_SIGNED_SHA256: `${SHA},${list(19)}` })).unattendedSignedSha256.size).toBe(20);
    expect(errorOf(accepted({ UNATTENDED_SIGNED_SHA256: `${SHA},${list(20)}` }))).toMatch(/UNATTENDED_SIGNED_SHA256: en çok 20/);
    expect(errorOf({ ...base, UNATTENDED_SIGNED_SHA256: list(21) })).toMatch(/en çok 20/);
  });
});

describe("P32 kapı — 4 mod × imza × liste (AC-525)", () => {
  it("AC-525: unsigned-accepted imzadan bağımsız yalnız listedeki SHA; off/unsigned/signed değişmez; status available", () => {
    const gates = {
      off: createGate(loadEnv(base)),
      unsigned: createGate(loadEnv({ ...base, DEPLOY_ENV: "staging", UNATTENDED_MODE: "unsigned" })),
      "unsigned-accepted": createGate(loadEnv(accepted())),
      signed: createGate(
        loadEnv({ ...prod, DEPLOY_ENV: "production", UNATTENDED_MODE: "signed", UNATTENDED_SIGNED_SHA256: `${SHA},${SHA2}` }),
      ),
    };
    const OTHER = "ef".repeat(32);
    // [imzalı+listede, imzasız+listede, imzalı+listede değil, imzasız+listede değil]
    const expected = {
      off: [false, false, false, false],
      unsigned: [true, true, true, true],
      "unsigned-accepted": [true, true, false, false],
      signed: [true, false, false, false],
    };
    for (const [mode, g] of Object.entries(gates)) {
      const got = [
        g.allows({ signed: true, sha256: SHA }),
        g.allows({ signed: false, sha256: SHA }),
        g.allows({ signed: true, sha256: OTHER }),
        g.allows({ signed: false, sha256: OTHER }),
      ];
      expect(got, mode).toEqual(expected[mode as keyof typeof expected]);
    }
    expect(gates["unsigned-accepted"].status()).toEqual({ mode: "unsigned-accepted", available: true });
    expect(gates["unsigned-accepted"].allows({ signed: false, sha256: SHA2.toUpperCase() })).toBe(true);
  });
});

describe("P32 açılış alarmı ve listFingerprint (AC-527a, S-P32-r2-2)", () => {
  it("AC-527: listFingerprint tek tanım — sabit vektör (remote-watch betik testiyle aynı) ve normalizasyon", () => {
    const raw = ` ${"cd".repeat(32)} , ,${"AB".repeat(32)} `;
    expect(normalizeShaList(raw)).toEqual(["cd".repeat(32), "ab".repeat(32)]);
    expect(listFingerprint(raw)).toBe("585d6c7c7e65");
    expect(listFingerprint(`${"ab".repeat(32)},${"cd".repeat(32)}`)).toBe("585d6c7c7e65"); // sıra bağımsız
    // devops K3 betik testinin (deploy/ops/test-watch.sh) vektörü — iki uygulama aynı değeri vermeli.
    expect(listFingerprint(` ${"B".repeat(64)} , ${"a".repeat(64)} ,`)).toBe("b1da1a175574");
    expect(listFingerprint("")).toBe("e3b0c44298fc");
    expect(listFingerprint(undefined)).toBe("e3b0c44298fc");
  });

  it("AC-527: unsigned-accepted → alarm {allowedCount, listFingerprint}, SHA yok; diğer modlarda alarm yok", () => {
    const a = riskAcceptedAlarm(loadEnv(accepted()));
    expect(a).toEqual({ alarm: "unattended_unsigned_risk_accepted", allowedCount: 2, listFingerprint: listFingerprint(`${SHA},${SHA2}`) });
    expect(JSON.stringify(a)).not.toContain(SHA);
    expect(riskAcceptedAlarm(loadEnv(base))).toBeNull();
    expect(riskAcceptedAlarm(loadEnv({ ...base, DEPLOY_ENV: "staging", UNATTENDED_MODE: "unsigned" }))).toBeNull();
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
