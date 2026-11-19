// P29 test yardımcıları: geçici Ed25519 imzalayıcı (yalnız test süreci; anahtar diske yazılmaz), kanonik manifest üretimi,
// manifest klasörü + gerçek ikili dosyaları (SHA'ları kapıya uyar), kayıtlı bilgisayar (binding) satırı.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalManifestJson, updateManifestFileName, updateSigningInput, type UpdateManifest } from "@remote/contracts/api/update";
import { newBindingKey, newId, sha256Hex } from "../../src/lib/ids.ts";
import { createSupportSessionRow, createUser, testDb } from "./app.ts";
import { createRequestSettings } from "./requests.ts";

export interface Signer {
  publicKey: string;
  sign(bytes: Uint8Array): string;
}

export function newSigner(): Signer {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ format: "jwk" }).x ?? "",
    sign: (bytes) => sign(null, updateSigningInput(bytes), privateKey).toString("base64url"),
  };
}

/** Saniyesiz ISO (`YYYY-MM-DDTHH:MM:SSZ`). */
export const isoSec = (ms: number): string => `${new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19)}Z`;

const DAY = 86_400_000;

export function manifest(o: Partial<UpdateManifest> & Pick<UpdateManifest, "sha256">): UpdateManifest {
  const now = Date.now();
  const component = o.component ?? "client";
  const platform = o.platform ?? "windows";
  return {
    schema: 1,
    env: "staging",
    platform,
    arch: platform === "macos" ? "universal" : "amd64",
    component,
    version: "0.22.1",
    size: 1024,
    issuedAt: isoSec(now - 3_600_000),
    expiresAt: isoSec(now + (component === "service" ? 60 : 20) * DAY),
    minUpdaterVersion: "0.22.0",
    ...o,
  };
}

/** Manifest + `.sig` dosyalarını klasöre yazar; ham baytları döner. */
export function writeManifest(dir: string, signer: Signer, m: UpdateManifest): Buffer {
  const bytes = Buffer.from(canonicalManifestJson(m), "latin1");
  const file = join(dir, updateManifestFileName(m));
  writeFileSync(file, bytes);
  writeFileSync(`${file}.sig`, signer.sign(bytes));
  return bytes;
}

/** Geçici kök: ikili dosyalar + `update/` klasörü. */
export function updateFixture(): {
  root: string;
  dir: string;
  binary(name: string, size?: number): { path: string; sha: string; bytes: Buffer };
} {
  const root = join(tmpdir(), `rs-update-test-${process.pid}-${newId()}`);
  const dir = join(root, "update");
  mkdirSync(dir, { recursive: true });
  return {
    root,
    dir,
    binary(name, size = 4096) {
      const bytes = randomBytes(size);
      const path = join(root, name);
      writeFileSync(path, bytes);
      return { path, sha: createHash("sha256").update(bytes).digest("hex"), bytes };
    },
  };
}

/** Kullanılabilir kayıtlı bilgisayar: talep ayarı (Genel ref) + oturum + binding; düz anahtarı döner. */
export async function bindingRow(tenantId: string): Promise<{ id: string; key: string }> {
  await createRequestSettings(tenantId).catch(() => undefined);
  const tech = await createUser({ tenantId, role: "USER" });
  const session = await createSupportSessionRow({ tenantId, technicianId: tech.id, status: "ACTIVE" });
  const key = newBindingKey();
  const id = newId();
  await testDb().deviceBinding.create({
    data: {
      id,
      tenantId,
      customerId: null,
      keyHash: sha256Hex(key),
      clientVersion: "0.22.0",
      firstSessionId: session.id,
      lastSessionId: session.id,
      lastUsedAt: new Date(),
    },
  });
  return { id, key };
}
