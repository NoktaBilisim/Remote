// P29-K2 sözleşme testleri (mimari-p29 r2 §4, §14; AC-470, 472, 474, 475, 479, 485, 487..491, 493).
// Ortak manifest fikstürü `test/fixtures/update-manifest/` (Go `internal/update` aynı baytları okur): her koşuda `build.ts`
// ile yeniden üretilir ve diskteki baytlarla birebir karşılaştırılır; imzalar YALNIZ TEST anahtarıyla doğrulanır.
import { createPublicKey, verify } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import fx from "../fixtures/ws-device.json" with { type: "json" };
import {
  canonicalManifestJson,
  CLIENT_UPDATE_SETTINGS_PATH,
  clientUpdateSettingsSchema,
  isCanonicalManifest,
  isUpdateSecurityReason,
  isUpdateTime,
  parseCanonicalManifest,
  UPDATE_ARCH_BY_PLATFORM,
  UPDATE_B64URL_32_PATTERN,
  UPDATE_BINDING_KEY_PATTERN,
  UPDATE_EVENT_TYPES,
  UPDATE_FAIL_REASONS,
  UPDATE_LIMITS,
  UPDATE_MANIFEST_CONTEXT,
  UPDATE_MANIFEST_FIELDS,
  UPDATE_MANIFEST_MAX_BYTES,
  UPDATE_REASON_LABELS,
  UPDATE_REASONS,
  UPDATE_SECURITY_REASONS,
  UPDATE_SHA256_PATTERN,
  UPDATE_SIGNATURE_PATTERN,
  UPDATE_SKIP_REASONS,
  UPDATE_VERSION_PATTERN,
  updateCheckQuerySchema,
  updateEventSchema,
  updateEventsInputSchema,
  type UpdateManifest,
  updateManifestFileName,
  updateManifestSchema,
  updateOfferSchema,
  updateSigningInput,
} from "../src/api/update.ts";
import { bindingKeySchema } from "../src/api/bindings.ts";
import {
  DEVICE_UPDATE_BADGE_LABELS,
  DEVICE_UPDATE_BADGES,
  deviceVersionsQuerySchema,
  listDevicesQuerySchema,
  UNATTENDED_ERROR_MESSAGES,
} from "../src/api/unattended.ts";
import {
  CLIENT_UPDATE_AUDIT,
  CLIENT_UPDATE_AUDIT_BY_EVENT,
  CLIENT_UPDATE_AUDIT_GROUP,
  CLIENT_UPDATE_AUDIT_LABELS,
  CLIENT_UPDATE_SETTINGS_AUDIT,
} from "../src/audit.ts";
import { ERROR_STATUS } from "../src/errors.ts";
import {
  B64URL_32_PATTERN,
  B64URL_64_PATTERN,
  DEVICE_ANNOUNCED_FEATURES,
  DEVICE_FEATURE_BY_SUBPROTOCOL,
  DEVICE_FEATURES,
  DEVICE_SHA256_PATTERN,
  DEVICE_VERSION_PATTERN,
  deviceConsentInboundSchema,
  deviceConsentOutboundSchema,
  deviceInboundSchema,
  deviceOutboundSchema,
  deviceUpdateInboundSchema,
  deviceUpdateOutboundSchema,
  WS_DEVICE_CAP_UPDATE,
  WS_DEVICE_MAX_PAYLOAD,
} from "../src/ws-device.ts";
import { buildFixtures, type FixtureCase, type SignatureCase, testPublicKey } from "./fixtures/update-manifest/build.ts";

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => s.safeParse(v).success;
const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

const FIXTURE_DIR = `${ts.sys.getCurrentDirectory()}/test/fixtures/update-manifest`;
/** Diskteki HAM bayt (Go testleri de aynı dosyayı okur). */
const readFixture = (name: string): Uint8Array => Uint8Array.from(readFileSync(`${FIXTURE_DIR}/${name}`));

function index(): { context: string; keys: Record<string, { publicKey: string }>; cases: FixtureCase[]; signatures: SignatureCase[] } {
  const text = ts.sys.readFile(`${FIXTURE_DIR}/cases.json`);
  if (text === undefined) throw new Error("cases.json okunamadı");
  return JSON.parse(text) as ReturnType<typeof index>;
}

function publicKeyObject(b64: string) {
  const raw = Uint8Array.from(atobUrl(b64));
  const SPKI_PREFIX = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
  const der = new Uint8Array(SPKI_PREFIX.length + raw.length);
  der.set(SPKI_PREFIX, 0);
  der.set(raw, SPKI_PREFIX.length);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function atobUrl(s: string): number[] {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const c of s) {
    buf = (buf << 6) | B64URL.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}

const base: UpdateManifest = {
  schema: 1,
  env: "prod",
  platform: "windows",
  arch: "amd64",
  component: "client",
  version: "0.22.1",
  sha256: "a".repeat(64),
  size: 1000,
  issuedAt: "2026-11-19T00:00:00Z",
  expiresAt: "2026-12-19T00:00:00Z",
  minUpdaterVersion: "0.22.0",
};

describe("P29 manifest şeması ve kanonik bayt (§4.1, §14.6)", () => {
  it("AC-470: manifest alanları sabit sırada; kanonik serileştirme boşluksuz ve şemadan geçer", () => {
    expect(UPDATE_MANIFEST_FIELDS).toEqual([
      "schema",
      "env",
      "platform",
      "arch",
      "component",
      "version",
      "sha256",
      "size",
      "issuedAt",
      "expiresAt",
      "minUpdaterVersion",
    ]);
    const json = canonicalManifestJson(base);
    expect(Object.keys(JSON.parse(json) as object)).toEqual([...UPDATE_MANIFEST_FIELDS]);
    expect(json).not.toMatch(/\s/);
    expect(isCanonicalManifest(ascii(json))).toBe(true);
    expect(parseCanonicalManifest(ascii(json))).toEqual(base);
  });

  it("AC-470/S-P29-T-7: süre üst sınırı component'e göre — istemci ≤ 30 g, servis ≤ 90 g; issuedAt < expiresAt", () => {
    expect(ok(updateManifestSchema, base)).toBe(true);
    expect(ok(updateManifestSchema, { ...base, expiresAt: "2026-12-19T00:00:01Z" })).toBe(false);
    const svc = { ...base, component: "service" as const };
    expect(ok(updateManifestSchema, { ...svc, expiresAt: "2027-02-17T00:00:00Z" })).toBe(true);
    expect(ok(updateManifestSchema, { ...svc, expiresAt: "2027-02-17T00:00:01Z" })).toBe(false);
    expect(ok(updateManifestSchema, { ...base, expiresAt: base.issuedAt })).toBe(false);
    expect(ok(updateManifestSchema, { ...base, expiresAt: "2026-11-18T00:00:00Z" })).toBe(false);
  });

  it("AC-470: platform↔arch eşlemesi ve servis yalnız windows/amd64", () => {
    expect(UPDATE_ARCH_BY_PLATFORM).toEqual({ windows: "amd64", macos: "universal", linux: "amd64" });
    expect(ok(updateManifestSchema, { ...base, platform: "macos", arch: "universal" })).toBe(true);
    expect(ok(updateManifestSchema, { ...base, platform: "macos" })).toBe(false);
    expect(ok(updateManifestSchema, { ...base, arch: "universal" })).toBe(false);
    expect(ok(updateManifestSchema, { ...base, platform: "linux", component: "service" })).toBe(false);
  });

  it("AC-474: katı alanlar — fazladan/eksik alan, schema≠1, desen dışı sürüm/sha/size reddedilir", () => {
    expect(ok(updateManifestSchema, { ...base, url: "https://x" })).toBe(false);
    const missing: Partial<UpdateManifest> = { ...base };
    delete missing.minUpdaterVersion;
    expect(ok(updateManifestSchema, missing)).toBe(false);
    expect(ok(updateManifestSchema, { ...base, schema: 2 })).toBe(false);
    expect(ok(updateManifestSchema, { ...base, version: "0.22.1-rc1" })).toBe(false);
    expect(ok(updateManifestSchema, { ...base, sha256: "A".repeat(64) })).toBe(false);
    expect(ok(updateManifestSchema, { ...base, size: 0 })).toBe(false);
    expect(ok(updateManifestSchema, { ...base, size: 104_857_601 })).toBe(false);
    expect(ok(updateManifestSchema, { ...base, size: 1.5 })).toBe(false);
    expect(ok(updateManifestSchema, { ...base, env: "dev" })).toBe(false);
  });

  it("AC-474: zaman yalnız YYYY-MM-DDTHH:MM:SSZ ve takvimde geçerli (02-30 yok, Go time.Parse ile aynı)", () => {
    expect(isUpdateTime("2026-11-19T00:00:00Z")).toBe(true);
    expect(isUpdateTime("2028-02-29T23:59:59Z")).toBe(true);
    for (const bad of [
      "2026-02-30T00:00:00Z",
      "2026-02-29T00:00:00Z",
      "2026-11-19T24:00:00Z",
      "2026-11-19T00:00:60Z",
      "2026-11-19T00:00:00.000Z",
      "2026-11-19T00:00:00+00:00",
      "2026-11-19 00:00:00Z",
      "1999-12-31T00:00:00Z",
    ]) {
      expect(isUpdateTime(bad), bad).toBe(false);
    }
  });

  it("AC-474: bayt kuralı — > 2 KiB, boş dizi ve ASCII dışı bayt reddedilir; imzalanan bayt = bağlam ‖ ham bayt", () => {
    const json = canonicalManifestJson(base);
    expect(isCanonicalManifest(new Uint8Array(0))).toBe(false);
    expect(isCanonicalManifest(ascii(json + " ".repeat(UPDATE_MANIFEST_MAX_BYTES)))).toBe(false);
    expect(isCanonicalManifest(Uint8Array.from([...ascii(json.slice(0, -1)), 0x09, 0x7d]))).toBe(false);
    expect(UPDATE_MANIFEST_CONTEXT).toBe("rs-update-manifest-v1\n");
    const input = updateSigningInput(ascii(json));
    expect(String.fromCharCode(...input)).toBe(`rs-update-manifest-v1\n${json}`);
    expect(updateManifestFileName(base)).toBe("update-client-windows-amd64.json");
  });
});

describe("P29 ortak fikstür (test/fixtures/update-manifest, TS + Go)", () => {
  const idx = index();
  const generated = buildFixtures();

  it("AC-470: diskteki fikstür baytları üreticiyle birebir (deterministik Ed25519; elle düzenleme yok)", () => {
    const onDisk = readdirSync(FIXTURE_DIR)
      .filter((n) => n !== "build.ts" && n !== "generate.mjs")
      .sort();
    expect(onDisk).toEqual([...generated.keys()].sort());
    for (const [name, bytes] of generated) expect(readFixture(name), name).toEqual(bytes);
  });

  it("AC-472: test anahtarları adı ve etiketiyle YALNIZ TEST; açık anahtarlar üreticiyle aynı", () => {
    expect(Object.keys(idx.keys)).toEqual(["test1", "test2"]);
    expect(idx.keys.test1?.publicKey).toBe(testPublicKey("test1"));
    expect(idx.keys.test2?.publicKey).toBe(testPublicKey("test2"));
    expect(idx.keys.test1?.publicKey).toMatch(UPDATE_B64URL_32_PATTERN);
    expect(JSON.stringify(idx.keys)).toMatch(/TEST key 1 - public test-only seed, never a real key/);
    expect(idx.context).toBe(UPDATE_MANIFEST_CONTEXT);
  });

  it("AC-474 (S-P29-T-11): her vaka parseCanonicalManifest ile beklenen sonucu verir (geçerli + yinelenen anahtar, Sha256, BOM, sonda veri, boşluk, sıra)", () => {
    expect(idx.cases.filter((c) => c.ts === "ok").length).toBeGreaterThanOrEqual(4);
    expect(idx.cases.filter((c) => c.ts === "reject").length).toBeGreaterThanOrEqual(15);
    for (const c of idx.cases) {
      expect(isCanonicalManifest(readFixture(c.file)), c.file).toBe(c.ts === "ok");
      expect(c.file.startsWith("valid-"), c.file).toBe(c.ts === "ok");
    }
    for (const name of [
      "invalid-duplicate-key.json",
      "invalid-key-case.json",
      "invalid-bom.json",
      "invalid-trailing-data.json",
      "invalid-whitespace.json",
      "invalid-field-order.json",
    ]) {
      expect(
        idx.cases.some((c) => c.file === name),
        name,
      ).toBe(true);
    }
  });

  it("AC-470/474: imzalar TEST anahtarı (test1) ile bağlam öneki üzerinden doğrulanır; yanlış anahtar/öneksiz/kurcalanmış bayt reddedilir", () => {
    const key = publicKeyObject(idx.keys.test1?.publicKey ?? "");
    for (const s of idx.signatures) {
      const sig = String.fromCharCode(...readFixture(s.sig));
      expect(sig, s.sig).toMatch(UPDATE_SIGNATURE_PATTERN);
      expect(
        verify(null, updateSigningInput(readFixture(s.manifest)), key, Uint8Array.from(atobUrl(sig))),
        `${s.manifest} + ${s.sig}`,
      ).toBe(s.valid);
    }
    expect(idx.signatures.filter((s) => !s.valid).length).toBe(3);
  });

  it("AC-475: fikstürdeki geçerli manifestler WS update.offer'a sığar (≤ 4 KiB) ve offer şemasından geçer", () => {
    for (const c of idx.cases.filter((x) => x.ts === "ok")) {
      const bytes = readFixture(c.file);
      const manifest = b64(bytes);
      const sig = String.fromCharCode(...readFixture(c.file.replace(/\.json$/, ".sig")));
      const offer = { manifest, signature: sig, policy: "auto" as const };
      expect(ok(updateOfferSchema, offer), c.file).toBe(true);
      expect(ok(deviceUpdateOutboundSchema, { t: "update.offer", ...offer })).toBe(true);
      expect(JSON.stringify({ t: "update.offer", ...offer }).length).toBeLessThan(WS_DEVICE_MAX_PAYLOAD);
    }
  });
});

/** Standart base64 (dolgulu). */
function b64(bytes: Uint8Array): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += A[(n >> 18) & 63] ?? "";
    out += A[(n >> 12) & 63] ?? "";
    out += i + 1 < bytes.length ? (A[(n >> 6) & 63] ?? "") : "=";
    out += i + 2 < bytes.length ? (A[n & 63] ?? "") : "=";
  }
  return out;
}

describe("P29 olaylar (§4.1, §4.6, §14.4)", () => {
  const ev = { type: "available", version: "0.22.1", fromVersion: "0.22.0", at: "2026-11-19T10:00:00Z" };

  it("AC-487: olay türleri ve neden kümeleri (installing olay değil; HEALTH/MANUAL_ONLY ek — D-5)", () => {
    expect(UPDATE_EVENT_TYPES).toEqual(["available", "installed", "failed", "rolled_back", "skipped"]);
    expect(UPDATE_FAIL_REASONS).toEqual([
      "DOWNLOAD",
      "HASH_MISMATCH",
      "MANIFEST_SIGNATURE",
      "PLATFORM_SIGNATURE",
      "DOWNGRADE",
      "EXPIRED",
      "ENV_MISMATCH",
      "INSTALL",
      "HEALTH",
    ]);
    expect(UPDATE_SKIP_REASONS).toEqual(["POLICY_OFF", "NOT_WRITABLE", "MANUAL_ONLY"]);
    expect(UPDATE_REASONS).toEqual([...UPDATE_FAIL_REASONS, ...UPDATE_SKIP_REASONS]);
  });

  it("AC-487: type ↔ reason kuralı — available/installed nedensiz, failed/rolled_back başarısızlık, skipped atlama nedeni", () => {
    expect(ok(updateEventSchema, ev)).toBe(true);
    expect(ok(updateEventSchema, { ...ev, type: "installed" })).toBe(true);
    expect(ok(updateEventSchema, { ...ev, reason: "POLICY_OFF" })).toBe(false);
    for (const r of UPDATE_FAIL_REASONS) {
      expect(ok(updateEventSchema, { ...ev, type: "failed", reason: r })).toBe(true);
      expect(ok(updateEventSchema, { ...ev, type: "rolled_back", reason: r })).toBe(true);
      expect(ok(updateEventSchema, { ...ev, type: "skipped", reason: r })).toBe(false);
    }
    for (const r of UPDATE_SKIP_REASONS) {
      expect(ok(updateEventSchema, { ...ev, type: "skipped", reason: r })).toBe(true);
      expect(ok(updateEventSchema, { ...ev, type: "failed", reason: r })).toBe(false);
    }
    expect(ok(updateEventSchema, { ...ev, type: "failed" })).toBe(false);
    expect(ok(updateEventSchema, { ...ev, type: "rolled_back" })).toBe(false);
    expect(ok(updateEventSchema, { ...ev, type: "skipped" })).toBe(false);
    expect(ok(updateEventSchema, { ...ev, type: "installing" })).toBe(false);
  });

  it("AC-488 (S-P29-T-5): istemci source beyan edemez; sürüm desen dışı ve tarih biçimsiz olay reddedilir", () => {
    expect(ok(updateEventSchema, { ...ev, source: "device" })).toBe(false);
    expect(ok(updateEventSchema, { ...ev, version: "v0.22.1" })).toBe(false);
    expect(ok(updateEventSchema, { ...ev, fromVersion: "0.22" })).toBe(false);
    expect(ok(updateEventSchema, { ...ev, at: "19.11.2026" })).toBe(false);
  });

  it("AC-489: güvenlik nedenleri — EXPIRED güvenlik nedeni değil", () => {
    expect(UPDATE_SECURITY_REASONS).toEqual(["MANIFEST_SIGNATURE", "PLATFORM_SIGNATURE", "DOWNGRADE", "HASH_MISMATCH", "ENV_MISMATCH"]);
    expect(isUpdateSecurityReason("EXPIRED")).toBe(false);
    expect(isUpdateSecurityReason("HASH_MISMATCH")).toBe(true);
    expect(isUpdateSecurityReason(null)).toBe(false);
  });

  it("AC-488: update-events gövdesi — ≤ 5 bindingKey, 1..20 olay, component yalnız client; geçersiz anahtar biçimi 400", () => {
    const key = `rsb_${"A".repeat(43)}`;
    const body = { platform: "windows", arch: "amd64", component: "client", events: [ev] };
    expect(ok(updateEventsInputSchema, body)).toBe(true);
    expect(ok(updateEventsInputSchema, { ...body, bindingKeys: Array(5).fill(key) })).toBe(true);
    expect(ok(updateEventsInputSchema, { ...body, bindingKeys: Array(6).fill(key) })).toBe(false);
    expect(ok(updateEventsInputSchema, { ...body, bindingKeys: [] })).toBe(false);
    expect(ok(updateEventsInputSchema, { ...body, bindingKeys: ["rsb_kisa"] })).toBe(false);
    expect(ok(updateEventsInputSchema, { ...body, events: [] })).toBe(false);
    expect(ok(updateEventsInputSchema, { ...body, events: Array(UPDATE_LIMITS.queueMax).fill(ev) })).toBe(true);
    expect(ok(updateEventsInputSchema, { ...body, events: Array(UPDATE_LIMITS.queueMax + 1).fill(ev) })).toBe(false);
    expect(ok(updateEventsInputSchema, { ...body, component: "service" })).toBe(false);
    expect(ok(updateEventsInputSchema, { ...body, arch: "universal" })).toBe(false);
    expect(ok(updateEventsInputSchema, { ...body, source: "device" })).toBe(false);
  });

  it("AC-488 (S-P29-T-12): 400 doğrulama ayrıntısı gönderilen anahtar değerini yansıtmaz", () => {
    const secret = `rsb_${"Z".repeat(42)}!`;
    const r = updateEventsInputSchema.safeParse({
      platform: "windows",
      arch: "amd64",
      component: "client",
      bindingKeys: [secret],
      events: [ev],
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).not.toContain("ZZZZ");
  });
});

describe("P29 public uç ve ayar şemaları (§4.2, §4.8)", () => {
  it("AC-473 (S-P29-T-9): component=service 400; desen dışı ref 400 DEĞİL (sunucu auto sayar); platform↔arch", () => {
    const q = { platform: "linux", arch: "amd64", component: "client" };
    expect(ok(updateCheckQuerySchema, q)).toBe(true);
    expect(ok(updateCheckQuerySchema, { ...q, ref: "abcdefghijklmnop" })).toBe(true);
    expect(ok(updateCheckQuerySchema, { ...q, ref: "DESEN DIŞI!!" })).toBe(true);
    expect(ok(updateCheckQuerySchema, { ...q, ref: "" })).toBe(true);
    expect(ok(updateCheckQuerySchema, { ...q, component: "service" })).toBe(false);
    expect(ok(updateCheckQuerySchema, { ...q, arch: "universal" })).toBe(false);
    expect(ok(updateCheckQuerySchema, { ...q, platform: "freebsd" })).toBe(false);
    expect(ok(updateCheckQuerySchema, { ...q, extra: "1" })).toBe(false);
  });

  it("AC-473: offer yanıtı — policy auto|notify, imza 86 karakter, manifest standart base64 ≤ 2732", () => {
    const offer = { manifest: "e30=", signature: `${"A".repeat(85)}A`, policy: "notify" };
    expect(ok(updateOfferSchema, offer)).toBe(true);
    expect(ok(updateOfferSchema, { ...offer, policy: "off" })).toBe(false);
    expect(ok(updateOfferSchema, { ...offer, manifest: "e30" })).toBe(false);
    expect(ok(updateOfferSchema, { ...offer, manifest: "A".repeat(2736) })).toBe(false);
    expect(ok(updateOfferSchema, { ...offer, signature: "A".repeat(85) })).toBe(false);
  });

  it("AC-485: Ayarlar → İstemciler gövdesi { autoUpdate: boolean } (katı)", () => {
    expect(CLIENT_UPDATE_SETTINGS_PATH).toBe("/api/v1/settings/client-update");
    expect(ok(clientUpdateSettingsSchema, { autoUpdate: false })).toBe(true);
    expect(ok(clientUpdateSettingsSchema, { autoUpdate: "false" })).toBe(false);
    expect(ok(clientUpdateSettingsSchema, {})).toBe(false);
    expect(ok(clientUpdateSettingsSchema, { autoUpdate: true, tenantId: "x" })).toBe(false);
  });

  it("AC-490: cihaz listesi sürüm süzgeci deseni; versions scope yalnız 'all'; rozet etiketleri", () => {
    expect(ok(listDevicesQuerySchema, { version: "0.22.1" })).toBe(true);
    expect(ok(listDevicesQuerySchema, { version: "" })).toBe(true);
    expect(ok(listDevicesQuerySchema, { version: "0.22" })).toBe(false);
    expect(ok(deviceVersionsQuerySchema, {})).toBe(true);
    expect(ok(deviceVersionsQuerySchema, { scope: "all" })).toBe(true);
    expect(ok(deviceVersionsQuerySchema, { scope: "tenant" })).toBe(false);
    expect(ok(deviceVersionsQuerySchema, { tenantId: "x" })).toBe(false);
    expect(DEVICE_UPDATE_BADGES).toEqual(["CURRENT", "PENDING", "UPDATING", "FAILED", "BELOW_MIN"]);
    expect(Object.values(DEVICE_UPDATE_BADGE_LABELS)).toEqual([
      "Güncel",
      "Güncelleme bekliyor",
      "Güncelleniyor",
      "Güncelleme başarısız",
      "Asgari sürümün altında",
    ]);
  });

  it("AC-479: DEVICE_UPDATING 409 ve Türkçe metni; hub bayrağı 3 dk", () => {
    expect(ERROR_STATUS.DEVICE_UPDATING).toBe(409);
    expect(UNATTENDED_ERROR_MESSAGES.DEVICE_UPDATING).toBe("Cihaz güncelleniyor, birazdan tekrar deneyin.");
    expect(UPDATE_LIMITS.deviceUpdatingTtlSec).toBe(180);
  });
});

describe("P29 audit (§4.7, AC-491)", () => {
  it("AC-491: client.update.* eylemleri, olay eşlemesi, Türkçe etiketler ve süzgeç grubu", () => {
    expect(Object.values(CLIENT_UPDATE_AUDIT)).toEqual([
      "client.update.available",
      "client.update.installed",
      "client.update.failed",
      "client.update.rolled_back",
      "client.update.skipped",
    ]);
    for (const t of UPDATE_EVENT_TYPES) expect(CLIENT_UPDATE_AUDIT_BY_EVENT[t]).toBe(`client.update.${t}`);
    expect(CLIENT_UPDATE_AUDIT_LABELS["client.update.installed"]).toBe("İstemci güncellendi");
    expect(CLIENT_UPDATE_AUDIT_LABELS["client.update.failed"]).toBe("İstemci güncellemesi başarısız");
    expect(CLIENT_UPDATE_AUDIT_LABELS[CLIENT_UPDATE_SETTINGS_AUDIT]).toBeTruthy();
    expect(CLIENT_UPDATE_SETTINGS_AUDIT).toBe("settings.client_update");
    expect(CLIENT_UPDATE_AUDIT_GROUP.label).toBe("İstemci güncelleme");
    expect(CLIENT_UPDATE_AUDIT_GROUP.actions).toHaveLength(5);
    for (const label of Object.values(CLIENT_UPDATE_AUDIT_LABELS)) expect(label).not.toMatch(/client\.update|_/);
  });

  it("AC-491: güvenlik nedeni etiketleri (imza|platform imzası|eski sürüm|bütünlük|ortam); her nedenin etiketi var", () => {
    expect(UPDATE_SECURITY_REASONS.map((r) => UPDATE_REASON_LABELS[r])).toEqual([
      "imza",
      "platform imzası",
      "eski sürüm",
      "bütünlük",
      "ortam",
    ]);
    for (const r of UPDATE_REASONS) expect(UPDATE_REASON_LABELS[r]).toMatch(/^\p{Ll}/u);
  });
});

describe("P29 /ws/device update1 eki (§4.3)", () => {
  it("AC-493: rs.cap.update1 → update1 hub özelliği; device.features yankısına girmez", () => {
    expect(WS_DEVICE_CAP_UPDATE).toBe("rs.cap.update1");
    expect(fx.constants.wsDeviceCapUpdate).toBe(WS_DEVICE_CAP_UPDATE);
    expect(DEVICE_FEATURE_BY_SUBPROTOCOL[WS_DEVICE_CAP_UPDATE]).toBe("update1");
    expect(DEVICE_FEATURES).toEqual(["consent1", "record1", "direct1", "update1"]);
    // Sapma: update1 device.features yankısına girmez (eski Go validFeatures katı; P29 desteğini update.offer duyurur).
    expect(DEVICE_ANNOUNCED_FEATURES).toEqual(["consent1", "record1"]);
  });

  it("AC-493: update.* mesajları taban birliklerde YOK (eski servis/sunucu görmez), yalnız update1 birliklerinde", () => {
    for (const m of fx.valid.update1Outbound) {
      expect(ok(deviceUpdateOutboundSchema, m), JSON.stringify(m)).toBe(true);
      expect(ok(deviceOutboundSchema, m) || ok(deviceConsentOutboundSchema, m)).toBe(false);
    }
    for (const m of fx.valid.update1Inbound) {
      expect(ok(deviceUpdateInboundSchema, m), JSON.stringify(m)).toBe(true);
      expect(ok(deviceInboundSchema, m) || ok(deviceConsentInboundSchema, m)).toBe(false);
    }
    expect(fx.valid.update1Outbound.map((m) => m.t).sort()).toEqual(["update.none", "update.offer", "update.offer", "update.token"]);
    expect([...new Set(fx.valid.update1Inbound.map((m) => m.t))].sort()).toEqual([
      "update.check",
      "update.event",
      "update.state",
      "update.token.request",
    ]);
  });

  it("AC-487/488: fikstürdeki geçersiz update1 mesajları reddedilir (installing olay değil, source yok, neden kuralı)", () => {
    for (const m of fx.invalid.update1Outbound) expect(ok(deviceUpdateOutboundSchema, m), JSON.stringify(m)).toBe(false);
    for (const m of fx.invalid.update1Inbound) expect(ok(deviceUpdateInboundSchema, m), JSON.stringify(m)).toBe(false);
  });

  it("AC-475: update.offer fikstürü ortak manifest fikstürünün baytlarını ve TEST imzasını taşır", () => {
    const offer = fx.valid.update1Outbound[0] as { manifest: string; signature: string };
    expect(offer.manifest).toBe(b64(readFixture("valid-service-windows.json")));
    expect(offer.signature).toBe(String.fromCharCode(...readFixture("valid-service-windows.sig")));
  });
});

describe("P29 desen eşleri (yaprak modül; PT-K1 döngü yok)", () => {
  it("AC-474: api/update.ts desenleri ws-device/requests desenleriyle birebir", () => {
    expect(UPDATE_VERSION_PATTERN.source).toBe(DEVICE_VERSION_PATTERN.source);
    expect(UPDATE_SHA256_PATTERN.source).toBe(DEVICE_SHA256_PATTERN.source);
    expect(UPDATE_SIGNATURE_PATTERN.source).toBe(B64URL_64_PATTERN.source);
    expect(UPDATE_B64URL_32_PATTERN.source).toBe(B64URL_32_PATTERN.source);
    const key = `rsb_${"A".repeat(43)}`;
    expect(UPDATE_BINDING_KEY_PATTERN.test(key)).toBe(bindingKeySchema.safeParse(key).success);
    expect(bindingKeySchema.safeParse(`rsb_${"A".repeat(42)}`).success).toBe(UPDATE_BINDING_KEY_PATTERN.test(`rsb_${"A".repeat(42)}`));
  });
});
