// P29 manifest deposu (mimari-p29 §4.2, K-P29-5, r2 §14.6–14.8; AC-473, 492). `UPDATE_MANIFEST_DIR`'deki ikili başına manifest
// (`update-<component>-<platform>-<arch>.json` + `.sig`) dosyalarını okur; sunucu manifesti ÜRETMEZ/DEĞİŞTİRMEZ, yalnız kapılar.
// Sunulabilirlik = hepsi doğru: imza (UPDATE_MANIFEST_PUBKEYS'ten biri, bağlam önekli) · kanonik bayt + component'e göre süre
// (istemci ≤ 30 g, servis ≤ 90 g; zod şeması) · yuva eşleşmesi · `env` = DEPLOY_ENV eşlemesi · süresi dolmamış · `issuedAt ≤ now+24 sa`
// · `sha256` = ilgili ikili kapısının beklenen SHA'sı ve kapı `ok` · servis + `signed` kipte SHA `UNATTENDED_SIGNED_SHA256`'da.
// Dosya okuma + imza doğrulaması stat anahtarlı önbellekte (en çok 60 sn'de bir stat); saat ve kapı istek anında değerlendirilir.
// Her yuva için durum değişiminde bir kez `warn` (yol/hash/değer yok).
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  parseCanonicalManifest,
  UPDATE_MANIFEST_MAX_BYTES,
  UPDATE_SIGNATURE_PATTERN,
  updateManifestFileName,
  updateSigningInput,
  type UpdateComponent,
  type UpdateEnv,
  type UpdateManifest,
  type UpdatePlatform,
} from "@remote/contracts/api/update";
import type { AgentBinaryState } from "../public/agent-binary.ts";

export type UpdateSlot = "client-windows" | "client-macos" | "client-linux" | "service-windows";
export const UPDATE_SLOTS: readonly UpdateSlot[] = ["client-windows", "client-macos", "client-linux", "service-windows"];
const SLOT_OF: Readonly<Record<UpdateSlot, { component: UpdateComponent; platform: UpdatePlatform; arch: "amd64" | "universal" }>> = {
  "client-windows": { component: "client", platform: "windows", arch: "amd64" },
  "client-macos": { component: "client", platform: "macos", arch: "universal" },
  "client-linux": { component: "client", platform: "linux", arch: "amd64" },
  "service-windows": { component: "service", platform: "windows", arch: "amd64" },
};
export const slotOf = (component: UpdateComponent, platform: UpdatePlatform): UpdateSlot => `${component}-${platform}` as UpdateSlot;

const STAT_EVERY_MS = 60_000;
const FUTURE_SKEW_MS = 24 * 3_600_000;
const EXPIRY_WARN_MS = 14 * 86_400_000;

/** İkili kapısı: mevcut `AgentBinary` örneği + env'deki beklenen SHA (kapının kendisi SHA'yı açmaz). */
export interface SlotGate {
  check(): Promise<AgentBinaryState>;
  expectedSha256: string | undefined;
}

export interface ManifestStoreDeps {
  dir: string | undefined;
  pubkeys: readonly Buffer[];
  /** `DEPLOY_ENV` → manifest ortamı (production→prod, staging→staging; diğerleri → hiçbir manifest sunulmaz). */
  deployEnv: string | undefined;
  gates: Readonly<Record<UpdateSlot, SlotGate>>;
  /** Servis + `UNATTENDED_MODE=signed` → SHA bu listede olmalı (AC-492). */
  signedMode: { signed: boolean; list: ReadonlySet<string> };
  now: () => number;
  warn: (obj: object, msg: string) => void;
}

/** Sunulabilir manifest: ham bayt (değiştirilmeden), imza (`.sig` içeriği), ayrıştırılmış alanlar. */
export interface Offerable {
  bytes: Buffer;
  signature: string;
  manifest: UpdateManifest;
}

/** Yuva durumu (log/test; değer içermez). */
export type SlotState =
  | "ok"
  | "absent"
  | "unconfigured"
  | "bad_signature"
  | "bad_format"
  | "slot_mismatch"
  | "env_mismatch"
  | "expired"
  | "future"
  | "gate"
  | "sha_mismatch"
  | "not_in_signed_list";

interface Loaded {
  key: string;
  /** İmzası ve biçimi geçerli manifest; aksi null + durum. */
  verified: Offerable | null;
  state: SlotState;
}

export function manifestEnvOf(deployEnv: string | undefined): UpdateEnv | null {
  return deployEnv === "production" ? "prod" : deployEnv === "staging" ? "staging" : null;
}

function publicKeys(raw: readonly Buffer[]): KeyObject[] {
  return raw.map((x) => createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: x.toString("base64url") }, format: "jwk" }));
}

/** Ed25519(bağlam ‖ bayt) iki yuvadan biriyle (K-P29-1/3). */
export function verifyManifestSignature(keys: readonly KeyObject[], bytes: Uint8Array, sig: string): boolean {
  if (!UPDATE_SIGNATURE_PATTERN.test(sig)) return false;
  const raw = Buffer.from(sig, "base64url");
  const input = updateSigningInput(bytes);
  return keys.some((k) => {
    try {
      return verify(null, input, k, raw);
    } catch {
      return false;
    }
  });
}

export class ManifestStore {
  private readonly d: ManifestStoreDeps;
  private readonly keys: KeyObject[];
  private readonly cache = new Map<UpdateSlot, { at: number; loaded: Loaded }>();
  private readonly reported = new Map<UpdateSlot, string>();

  constructor(d: ManifestStoreDeps) {
    this.d = d;
    this.keys = publicKeys(d.pubkeys);
  }

  /** Sunulabilir manifest ya da null (204 / `update.none`). */
  async offer(slot: UpdateSlot): Promise<Offerable | null> {
    const loaded = await this.load(slot);
    const state = loaded.verified ? await this.gate(slot, loaded.verified.manifest) : loaded.state;
    this.report(slot, state, loaded.verified?.manifest);
    return state === "ok" ? loaded.verified : null;
  }

  /** Açılış ısıtması (AC-473: açılışta imza doğrulanır, geçersizse uyarı). */
  async warm(): Promise<void> {
    await Promise.all(UPDATE_SLOTS.map((s) => this.offer(s)));
  }

  /** Gauge: imzası geçerli yüklü manifestlerin kalan süresi (sn; sunulabilir olmasa da — donma tespiti, §14.7). */
  expirySeconds(): { labels: { component: string; platform: string }; value: number }[] {
    const out: { labels: { component: string; platform: string }; value: number }[] = [];
    for (const [slot, c] of this.cache) {
      const m = c.loaded.verified?.manifest;
      if (!m) continue;
      out.push({
        labels: { component: SLOT_OF[slot].component, platform: SLOT_OF[slot].platform },
        value: Math.round((Date.parse(m.expiresAt) - this.d.now()) / 1000),
      });
    }
    return out;
  }

  private async gate(slot: UpdateSlot, m: UpdateManifest): Promise<SlotState> {
    const env = manifestEnvOf(this.d.deployEnv);
    if (env === null || m.env !== env) return "env_mismatch";
    const now = this.d.now();
    if (now >= Date.parse(m.expiresAt)) return "expired";
    if (Date.parse(m.issuedAt) > now + FUTURE_SKEW_MS) return "future";
    const g = this.d.gates[slot];
    if ((await g.check()) !== "ok") return "gate";
    if (g.expectedSha256 !== m.sha256) return "sha_mismatch";
    if (slot === "service-windows" && this.d.signedMode.signed && !this.d.signedMode.list.has(m.sha256)) return "not_in_signed_list";
    return "ok";
  }

  private async load(slot: UpdateSlot): Promise<Loaded> {
    const now = this.d.now();
    const c = this.cache.get(slot);
    if (c && now - c.at < STAT_EVERY_MS) return c.loaded;
    const loaded = await this.read(slot, c?.loaded);
    this.cache.set(slot, { at: now, loaded });
    return loaded;
  }

  private async read(slot: UpdateSlot, prev: Loaded | undefined): Promise<Loaded> {
    const { dir } = this.d;
    if (!dir || this.keys.length === 0) return { key: "", verified: null, state: "unconfigured" };
    const file = join(dir, updateManifestFileName(SLOT_OF[slot]));
    try {
      const [a, b] = await Promise.all([stat(file), stat(`${file}.sig`)]);
      if (!a.isFile() || !b.isFile()) return { key: "", verified: null, state: "absent" };
      const key = [a, b].map((s) => `${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.ino}`).join("|");
      if (prev?.key === key) return prev;
      if (a.size > UPDATE_MANIFEST_MAX_BYTES || b.size > 256) return { key, verified: null, state: "bad_format" };
      const [bytes, sigRaw] = await Promise.all([readFile(file), readFile(`${file}.sig`, "latin1")]);
      return { key, ...this.verifyBytes(slot, bytes, sigRaw.trim()) };
    } catch {
      return { key: "", verified: null, state: "absent" };
    }
  }

  private verifyBytes(slot: UpdateSlot, bytes: Buffer, signature: string): Omit<Loaded, "key"> {
    if (!verifyManifestSignature(this.keys, bytes, signature)) return { verified: null, state: "bad_signature" };
    const manifest = parseCanonicalManifest(bytes);
    if (!manifest) return { verified: null, state: "bad_format" };
    const s = SLOT_OF[slot];
    if (manifest.component !== s.component || manifest.platform !== s.platform || manifest.arch !== s.arch)
      return { verified: null, state: "slot_mismatch" };
    return { verified: { bytes, signature, manifest }, state: "ok" };
  }

  /** Durum (ve 14 g'den az kalma) değiştiğinde bir kez warn. `absent`/`unconfigured` olağandır (yayın yok) → sessiz. */
  private report(slot: UpdateSlot, state: SlotState, m: UpdateManifest | undefined): void {
    const soon = state === "ok" && m !== undefined && Date.parse(m.expiresAt) - this.d.now() < EXPIRY_WARN_MS;
    const tag = soon ? "expiring" : state;
    if (this.reported.get(slot) === tag) return;
    this.reported.set(slot, tag);
    if (tag === "ok" || tag === "absent" || tag === "unconfigured") return;
    if (tag === "expiring")
      this.d.warn({ alarm: "update_manifest_expiring", slot }, "güncelleme manifestinin süresi 14 günden az (update-resign gerekli)");
    else
      this.d.warn(
        { alarm: "update_manifest", slot, state: tag },
        tag === "not_in_signed_list"
          ? "manifest sürümü SHA listesinde yok (UNATTENDED_SIGNED_SHA256); manifest sunulmuyor"
          : "güncelleme manifesti sunulmuyor",
      );
  }
}
