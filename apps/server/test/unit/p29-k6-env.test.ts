// P29 K6 (mimari-p29 §9.1): UPDATE_MANIFEST_DIR / UPDATE_MANIFEST_PUBKEYS env doğrulaması. Anahtarlar koşu anında üretilir
// (repoda anahtar yok; gitleaks istisnası gerekmez).
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { UPDATE_MANIFEST_DIR_FIXED, loadEnv, parseUpdatePubkeys } from "../../src/env.ts";

const pub = (): string => {
  const der = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32).toString("base64url");
};
const base = { PUBLIC_BASE_URL: "https://rs.test:4450", DATABASE_URL: "mysql://app:gizli@db/remote" };
const prod = {
  ...base,
  NODE_ENV: "production",
  DEPLOY_ENV: "production",
  TRUSTED_PROXY_CIDR: "172.30.0.2/31",
  SESSION_REF_KEY: "k".repeat(40),
  APP_ENCRYPTION_KEYS: `v1:${Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64")}`,
};

describe("P29 UPDATE_MANIFEST_* env (§9.1)", () => {
  it("parseUpdatePubkeys: 1–2 adet 43 karakter base64url; fazlası, yinelenen, dolgulu, kısa → null", () => {
    const a = pub();
    const b = pub();
    expect(parseUpdatePubkeys(a)?.map((k) => k.length)).toEqual([32]);
    expect(parseUpdatePubkeys(` ${a} , ${b} `)).toHaveLength(2);
    expect(parseUpdatePubkeys(`${a},${b},${pub()}`)).toBeNull();
    expect(parseUpdatePubkeys(`${a},${a}`)).toBeNull();
    expect(parseUpdatePubkeys(`${a}=`)).toBeNull();
    expect(parseUpdatePubkeys(a.slice(1))).toBeNull();
    expect(parseUpdatePubkeys(Buffer.alloc(32, 7).toString("base64"))).toBeNull(); // standart base64 (+,/ ya da = olabilir)
    expect(parseUpdatePubkeys("")).toBeNull();
  });

  it("ikisi de boş = güncelleme kapalı (tanımsız, boş liste)", () => {
    const env = loadEnv({ ...base, UPDATE_MANIFEST_DIR: "", UPDATE_MANIFEST_PUBKEYS: "" });
    expect(env.UPDATE_MANIFEST_DIR).toBeUndefined();
    expect(env.updateManifestPubkeys).toEqual([]);
  });

  it("DIR dolu + PUBKEYS boş → açılış hatası; geçersiz anahtar → açılış hatası (değer mesaja yazılmaz)", () => {
    expect(() => loadEnv({ ...base, UPDATE_MANIFEST_DIR: "/tmp/u" })).toThrow(/UPDATE_MANIFEST_PUBKEYS/);
    expect(() => loadEnv({ ...base, UPDATE_MANIFEST_DIR: "/tmp/u", UPDATE_MANIFEST_PUBKEYS: "kisa-anahtar" })).toThrow(
      /UPDATE_MANIFEST_PUBKEYS/,
    );
    expect(() => loadEnv({ ...base, UPDATE_MANIFEST_DIR: "goreli/yol", UPDATE_MANIFEST_PUBKEYS: pub() })).toThrow(/UPDATE_MANIFEST_DIR/);
  });

  it("production'da yalnız sabit yol", () => {
    const k = pub();
    const env = loadEnv({ ...prod, UPDATE_MANIFEST_DIR: UPDATE_MANIFEST_DIR_FIXED, UPDATE_MANIFEST_PUBKEYS: k });
    expect(env.updateManifestPubkeys[0]?.toString("base64url")).toBe(k);
    expect(() => loadEnv({ ...prod, UPDATE_MANIFEST_DIR: "/data/baska", UPDATE_MANIFEST_PUBKEYS: k })).toThrow(/UPDATE_MANIFEST_DIR/);
  });
});
