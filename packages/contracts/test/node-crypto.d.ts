// Testlerin kullandığı `node:crypto` alt kümesi (paket `types: []` — çalışma zamanı kodu Node API'si kullanmaz; web paketler).
declare module "node:crypto" {
  interface Hash {
    update(data: string, encoding: "utf8"): Hash;
    digest(encoding: "hex"): string;
    // P29: ham özet (Ed25519 TEST tohumu türetme).
    digest(): Uint8Array;
  }
  export function createHash(algorithm: "sha256"): Hash;
  // P29 (test/fixtures/update-manifest/build.ts, update-p29.test.ts): Ed25519 TEST anahtarıyla imza/doğrulama.
  interface KeyObject {
    export(options: { format: "der"; type: "spki" }): Uint8Array;
  }
  export function createPrivateKey(options: { key: Uint8Array; format: "der"; type: "pkcs8" }): KeyObject;
  export function createPublicKey(key: KeyObject | { key: Uint8Array; format: "der"; type: "spki" }): KeyObject;
  export function sign(algorithm: null, data: Uint8Array, key: KeyObject): Uint8Array;
  export function verify(algorithm: null, data: Uint8Array, key: KeyObject, signature: Uint8Array): boolean;
}
