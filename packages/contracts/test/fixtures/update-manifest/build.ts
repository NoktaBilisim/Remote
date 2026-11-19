// P29 ortak manifest fikstürlerinin TEK üreticisi (mimari-p29 §14.6; TS `api/update.ts` + Go `internal/update` aynı baytları okur).
// Saf işlev: dosya sistemi yok. Yazma `generate.mjs` (elle), eşitlik denetimi `test/update-p29.test.ts` (her koşuda yeniden
// üretir ve diskteki baytlarla birebir karşılaştırır; Ed25519 deterministiktir → aynı tohum = aynı imza).
//
// ANAHTARLAR YALNIZ TEST İÇİNDİR: tohum = SHA-256(<aşağıdaki açık etiket>). Etiket repoda açık olduğundan tohum gizli DEĞİLDİR
// ve hiçbir gerçek ortamın anahtarı olamaz; gerçek anahtarlar yalnız GitHub ortam secret'ındadır (§9.3). Repoya tohum baytı
// yazılmaz, yalnız türetme etiketi ve açık anahtar.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";

export const TEST_KEY_LABELS = {
  /** Fikstür imzalarının anahtarı (Go testleri gömülü anahtar yuvasına bunu koyar). */
  test1: "rs-update-manifest TEST key 1 - public test-only seed, never a real key",
  /** "Yanlış anahtar" vakası için ikinci anahtar. */
  test2: "rs-update-manifest TEST key 2 - public test-only seed, never a real key",
} as const;
export type TestKeyName = keyof typeof TEST_KEY_LABELS;

const CONTEXT = "rs-update-manifest-v1\n";
/** PKCS#8 DER öneki (RFC 8410, Ed25519) + 32 bayt tohum. */
const PKCS8_ED25519_PREFIX = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
/** UTF-8 (paket `types: []` → TextEncoder/Buffer tipi yok; encodeURIComponent yüzde kodlamasından). */
const utf8 = (s: string): Uint8Array => {
  const e = encodeURIComponent(s);
  const out: number[] = [];
  for (let i = 0; i < e.length; i++) {
    if (e[i] === "%") {
      out.push(parseInt(e.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(e.charCodeAt(i));
  }
  return Uint8Array.from(out);
};
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** base64url, dolgusuz (RFC 4648 §5). */
function b64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2;
    for (let j = 0; j < chars; j++) out += B64URL[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

function privateKey(name: TestKeyName) {
  const seed = createHash("sha256").update(TEST_KEY_LABELS[name], "utf8").digest();
  return createPrivateKey({ key: concat(Uint8Array.from(PKCS8_ED25519_PREFIX), seed), format: "der", type: "pkcs8" });
}

/** Açık anahtar, base64url dolgusuz 32 bayt (`config.updateKeys` / `UPDATE_MANIFEST_PUBKEYS` biçimi). */
export function testPublicKey(name: TestKeyName): string {
  const spki = createPublicKey(privateKey(name)).export({ format: "der", type: "spki" });
  return b64url(spki.subarray(spki.length - 32));
}

/** `.sig` içeriği: Ed25519(`[CONTEXT ‖] bytes`), base64url 86 karakter, sonda yeni satır yok. */
export function testSign(name: TestKeyName, bytes: Uint8Array, withContext = true): string {
  return b64url(sign(null, withContext ? concat(ascii(CONTEXT), bytes) : bytes, privateKey(name)));
}

// ------------------------------------------------------------------------------------------- manifestler

const ISSUED = "2026-11-19T00:00:00Z";
const SHA_A = "3f1c8a0e5b7d9c2f4a6e8b0d1c3f5a7e9b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a";

interface Fields {
  schema: number;
  env: string;
  platform: string;
  arch: string;
  component: string;
  version: string;
  sha256: string;
  size: number;
  issuedAt: string;
  expiresAt: string;
  minUpdaterVersion: string;
}

const canonical = (f: Fields): string =>
  `{"schema":${f.schema},"env":"${f.env}","platform":"${f.platform}","arch":"${f.arch}","component":"${f.component}",` +
  `"version":"${f.version}","sha256":"${f.sha256}","size":${f.size},"issuedAt":"${f.issuedAt}","expiresAt":"${f.expiresAt}",` +
  `"minUpdaterVersion":"${f.minUpdaterVersion}"}`;

const clientWin: Fields = {
  schema: 1,
  env: "prod",
  platform: "windows",
  arch: "amd64",
  component: "client",
  version: "0.22.1",
  sha256: SHA_A,
  size: 15728640,
  issuedAt: ISSUED,
  expiresAt: "2026-12-19T00:00:00Z", // +30 g (istemci üst sınırı)
  minUpdaterVersion: "0.22.0",
};
const W = canonical(clientWin);

/** Beklenti (iki dil): `ts` = `parseCanonicalManifest`, `go` = `ParseManifest`, `reason` = Verify sonucu (null = geçer). */
export interface FixtureCase {
  file: string;
  doc: string;
  ts: "ok" | "reject";
  go: "ok" | "reject";
  reason: "MANIFEST_SIGNATURE" | "EXPIRED" | null;
}

const manifests: { file: string; bytes: Uint8Array; doc: string; ts: FixtureCase["ts"]; go: FixtureCase["go"]; reason: FixtureCase["reason"] }[] =
  [];
const ok = (file: string, doc: string, f: Fields) => manifests.push({ file, doc, bytes: ascii(canonical(f)), ts: "ok", go: "ok", reason: null });
const bad = (file: string, doc: string, bytes: Uint8Array | string) =>
  manifests.push({ file, doc, bytes: typeof bytes === "string" ? ascii(bytes) : bytes, ts: "reject", go: "reject", reason: "MANIFEST_SIGNATURE" });

ok("valid-client-windows.json", "Windows istemci, prod, 30 g (istemci üst sınırı tam)", clientWin);
ok("valid-client-macos.json", "macOS istemci, prod, universal", { ...clientWin, platform: "macos", arch: "universal", size: 31457280 });
ok("valid-client-linux-staging.json", "Linux istemci, staging ortamı (prod güveniyle ENV_MISMATCH)", {
  ...clientWin,
  env: "staging",
  platform: "linux",
  expiresAt: "2026-11-20T00:00:00Z",
});
ok("valid-service-windows.json", "Windows servis, prod, 90 g (servis üst sınırı tam)", {
  ...clientWin,
  component: "service",
  size: 16777216,
  expiresAt: "2027-02-17T00:00:00Z",
});

bad("invalid-duplicate-key.json", "Yinelenen anahtar (sonda ikinci minUpdaterVersion)", W.replace(/}$/, ',"minUpdaterVersion":"0.22.0"}'));
bad("invalid-key-case.json", "Anahtar harf farkı: Sha256", W.replace('"sha256"', '"Sha256"'));
bad("invalid-bom.json", "UTF-8 BOM önekli", concat(Uint8Array.from([0xef, 0xbb, 0xbf]), ascii(W)));
bad("invalid-trailing-newline.json", "Sonda yeni satır", `${W}\n`);
bad("invalid-trailing-data.json", "Nesneden sonra ikinci nesne", `${W}{}`);
bad("invalid-whitespace.json", "Ayırıcılardan sonra boşluk", W.replaceAll('":', '": ').replaceAll(',"', ', "'));
bad("invalid-field-order.json", "env ile platform yer değiştirmiş", W.replace('"env":"prod","platform":"windows"', '"platform":"windows","env":"prod"'));
bad("invalid-unknown-field.json", "Fazladan alan (url)", W.replace(/}$/, ',"url":"https://example.invalid/x.exe"}'));
bad("invalid-missing-field.json", "Eksik alan (minUpdaterVersion)", W.replace(',"minUpdaterVersion":"0.22.0"', ""));
bad("invalid-schema-2.json", "schema 2", W.replace('"schema":1', '"schema":2'));
bad("invalid-escaped-string.json", "Kaçışlı dizgi (\\u0030 = '0')", W.replace('"version":"0.22.1"', '"version":"\\u0030.22.1"'));
bad("invalid-size-float.json", "size ondalıklı (15728640.0)", W.replace('"size":15728640', '"size":15728640.0'));
bad("invalid-size-exponent.json", "size üslü (1.572864e7)", W.replace('"size":15728640', '"size":1.572864e7'));
bad("invalid-time-millis.json", "Kesirli saniye", W.replace(`"issuedAt":"${ISSUED}"`, '"issuedAt":"2026-11-19T00:00:00.000Z"'));
bad("invalid-time-offset.json", "Saat dilimi ofseti", W.replace(`"issuedAt":"${ISSUED}"`, '"issuedAt":"2026-11-19T03:00:00+03:00"'));
bad("invalid-time-nov31.json", "Takvimde olmayan gün (11-31; JS Date 12-01'e kaydırır, Go reddeder)", W.replace('"expiresAt":"2026-12-19T00:00:00Z"', '"expiresAt":"2026-11-31T00:00:00Z"'));
bad("invalid-sha-uppercase.json", "sha256 büyük harf", W.replace(SHA_A, SHA_A.toUpperCase()));
bad("invalid-non-ascii.json", "ASCII dışı bayt (UTF-8 'ı' sürümde)", concat(ascii(W.slice(0, 2)), Uint8Array.from([0xc4, 0xb1]), ascii(W.slice(2))));
bad("invalid-expires-before-issued.json", "expiresAt ≤ issuedAt", canonical({ ...clientWin, expiresAt: ISSUED }));
bad("invalid-service-91d.json", "Servis 91 g (90 g üst sınır aşıldı)", canonical({ ...clientWin, component: "service", expiresAt: "2027-02-18T00:00:00Z" }));
manifests.push({
  file: "span-client-31d.json",
  doc: "İstemci 31 g: biçim kanonik; TS şeması component sınırıyla reddeder (sunucu sunmaz), Go ParseManifest kabul eder ve Verify EXPIRED verir",
  bytes: ascii(canonical({ ...clientWin, expiresAt: "2026-12-20T00:00:00Z" })),
  ts: "reject",
  go: "ok",
  reason: "EXPIRED",
});

/** İmza vakaları: `manifest` dosyasının baytları + `sig` dosyası, `test1` gömülü anahtarla doğrulanır. */
export interface SignatureCase {
  manifest: string;
  sig: string;
  valid: boolean;
  doc: string;
}

/** Tüm fikstür dosyaları (ad → bayt) ve dizin (`cases.json`). */
export function buildFixtures(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const cases: FixtureCase[] = [];
  const sigCases: SignatureCase[] = [];
  for (const m of manifests) {
    files.set(m.file, m.bytes);
    // Her manifestin (geçersizler dahil) test1 ile geçerli imzası var: Go Verify imza adımını geçip ayrıştırmada düşmeli
    // ("imzalı ama okunamayan" = MANIFEST_SIGNATURE, §5.1 adım 3).
    const sigFile = m.file.replace(/\.json$/, ".sig");
    files.set(sigFile, ascii(testSign("test1", m.bytes)));
    cases.push({ file: m.file, doc: m.doc, ts: m.ts, go: m.go, reason: m.reason });
    sigCases.push({ manifest: m.file, sig: sigFile, valid: true, doc: "test1, bağlam önekli" });
  }
  const win = ascii(W);
  files.set("sig-wrong-key.sig", ascii(testSign("test2", win)));
  files.set("sig-no-context.sig", ascii(testSign("test1", win, false)));
  sigCases.push(
    { manifest: "valid-client-windows.json", sig: "sig-wrong-key.sig", valid: false, doc: "Gömülü olmayan anahtar (test2)" },
    { manifest: "valid-client-windows.json", sig: "sig-no-context.sig", valid: false, doc: "Bağlam öneki olmadan imzalanmış" },
    { manifest: "valid-client-macos.json", sig: "valid-client-windows.sig", valid: false, doc: "Başka manifestin imzası (kurcalanmış bayt)" },
  );
  const index = {
    _doc:
      "P29 ortak manifest fikstürleri (mimari-p29 §14.6). Dosyalar HAM BAYTTIR — biçimlendirilmez (.prettierignore). " +
      "Üretici build.ts, yazıcı generate.mjs; contracts testi her koşuda yeniden üretip baytları karşılaştırır. " +
      "cases: ts = parseCanonicalManifest, go = update.ParseManifest, reason = Verify nedeni (null = geçer; " +
      "trust {env: prod|staging = manifest env, keys: [test1]}, çalışan sürüm 0.22.0 + manifestin platform/arch/component'i, " +
      "now = issuedAt + 1 sa). signatures: Ed25519(context ‖ manifest baytları), anahtar test1. " +
      "keys: YALNIZ TEST — tohum = SHA-256(label, UTF-8); etiket açık olduğundan gizli değildir, gerçek ortamda kullanılamaz.",
    context: CONTEXT,
    keys: {
      test1: { label: TEST_KEY_LABELS.test1, seed: "sha256(label)", publicKey: testPublicKey("test1") },
      test2: { label: TEST_KEY_LABELS.test2, seed: "sha256(label)", publicKey: testPublicKey("test2") },
    },
    cases,
    signatures: sigCases,
  };
  files.set("cases.json", utf8(`${JSON.stringify(index, null, 2)}\n`));
  return files;
}
