// Testlerin kullandığı `node:crypto` alt kümesi (paket `types: []` — çalışma zamanı kodu Node API'si kullanmaz; web paketler).
declare module "node:crypto" {
  interface Hash {
    update(data: string, encoding: "utf8"): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: "sha256"): Hash;
}
