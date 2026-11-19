#!/usr/bin/env node
// P29 K6 (mimari-p29 §9.2, K-P29-3, §14.6 T-11; ADR-0040): imzalı güncelleme manifestinin BAĞIMSIZ doğrulayıcısı (Node stdlib,
// bağımlılık yok). Go imzalayıcısından (apps/agent-win/cmd/update-sign) ayrı yazılmıştır: iki uygulama aynı baytı kabul etmelidir.
// publish-manifest.sh (operatör + sunucu tarafı) ve agent-win.yml update-resign işi kullanır.
//
// Kullanım:
//   node verify-manifest.mjs --pubkeys <b64url[,b64url]> | --pubkeys-file <build/update-keys/<env>.pub>
//        --env prod|staging [--now <ISO>] [--min-remaining-days <n>] [--expect-sha256 <hex>] [--expect-version <x.y.z>]
//        [--expect-name] [--same-as <eski-manifest.json>] <manifest.json> [<manifest.json> ...]
//   İmza dosyası: <manifest.json>.sig (base64url, dolgusuz, 86 karakter = 64 bayt).
//   --expect-name: dosya adı update-<component>-<platform>-<arch>.json olmalı (yayın kuralı).
//   --same-as: yeniden imzada (update-resign) issuedAt/expiresAt DIŞINDAKİ bütün alanlar eski manifestle birebir aynı olmalı.
// Çıktı: her manifest için tek satır JSON (alanlar + dosya + kalan gün) stdout'a. Çıkış: 0 tamam · 1 doğrulama hatası · 2 kullanım.
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const CONTEXT = "rs-update-manifest-v1\n";
const FIELDS = [
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
];
const INT_FIELDS = new Set(["schema", "size"]);
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PUBKEY = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const SIG = /^[A-Za-z0-9_-]{85}[AQgw]$/;
const DAY = 86400;
// İkili kimliği (mimari §4.1): istemci windows/amd64, macos/universal, linux/amd64; servis yalnız windows/amd64.
const TARGETS = new Set(["client/windows/amd64", "client/macos/universal", "client/linux/amd64", "service/windows/amd64"]);
const MAX_DAYS = { client: 30, service: 90 }; // r2 T-7

class Fail extends Error {}
const fail = (m) => {
  throw new Fail(m);
};
const usage = (m) => {
  process.stderr.write(`kullanım hatası: ${m}\n`);
  process.exit(2);
};

/** Kanonik serileştirme (§14.6): sabit sıra, boşluksuz, dizgiler kaçışsız ASCII, tamsayılar ondalık. */
function canonical(o) {
  const parts = FIELDS.map((k) => {
    const v = o[k];
    if (INT_FIELDS.has(k)) {
      if (!Number.isSafeInteger(v) || v < 0) fail(`${k} tamsayı değil`);
      return `"${k}":${String(v)}`;
    }
    if (typeof v !== "string" || !/^[\x20-\x21\x23-\x5b\x5d-\x7e]*$/.test(v)) fail(`${k} kaçışsız ASCII dizgi değil`);
    return `"${k}":"${v}"`;
  });
  return `{${parts.join(",")}}`;
}

function parseStrict(bytes) {
  if (bytes.length > 2048) fail("manifest 2 KiB'ı aşıyor");
  if (bytes.length === 0) fail("manifest boş");
  for (const b of bytes) if (b < 0x20 || b > 0x7e) fail("manifest yalnız yazdırılabilir ASCII olmalı (BOM/boşluk/yeni satır yok)");
  const text = bytes.toString("latin1");
  let o;
  try {
    o = JSON.parse(text);
  } catch {
    fail("manifest JSON değil");
  }
  if (o === null || typeof o !== "object" || Array.isArray(o)) fail("manifest nesne değil");
  const keys = Object.keys(o);
  if (keys.length !== FIELDS.length || FIELDS.some((k) => !Object.hasOwn(o, k))) fail("alan kümesi şemayla aynı değil");
  if (canonical(o) !== text) fail("kanonik değil (alan sırası, boşluk, yinelenen anahtar, kaçış ya da sayı biçimi)");
  return o;
}

function checkFields(o, env, nowSec) {
  if (o.schema !== 1) fail("schema 1 değil");
  if (o.env !== "prod" && o.env !== "staging") fail("env prod|staging değil");
  if (o.env !== env) fail(`ENV_MISMATCH: manifest env=${o.env}, beklenen ${env}`);
  if (!TARGETS.has(`${o.component}/${o.platform}/${o.arch}`)) fail(`bilinmeyen hedef ${o.component}/${o.platform}/${o.arch}`);
  if (!VERSION.test(o.version) || !VERSION.test(o.minUpdaterVersion)) fail("sürüm x.y.z değil");
  if (!/^[a-f0-9]{64}$/.test(o.sha256)) fail("sha256 64 küçük harf hex değil");
  if (o.size < 1 || o.size > 104857600) fail("size 1..100 MiB dışında");
  if (!TIME.test(o.issuedAt) || !TIME.test(o.expiresAt)) fail("zaman YYYY-MM-DDTHH:MM:SSZ değil");
  const iss = Date.parse(o.issuedAt) / 1000;
  const exp = Date.parse(o.expiresAt) / 1000;
  if (!Number.isFinite(iss) || !Number.isFinite(exp) || new Date(iss * 1000).toISOString().slice(0, 19) + "Z" !== o.issuedAt)
    fail("issuedAt geçersiz tarih");
  if (new Date(exp * 1000).toISOString().slice(0, 19) + "Z" !== o.expiresAt) fail("expiresAt geçersiz tarih");
  if (!(iss < exp)) fail("issuedAt < expiresAt değil");
  if (exp - iss > MAX_DAYS[o.component] * DAY) fail(`süre ${o.component} için ${MAX_DAYS[o.component]} günü aşıyor`);
  if (iss > nowSec + DAY) fail("issuedAt gelecekte (> 24 sa; saat?)");
  if (nowSec > exp) fail("EXPIRED: manifestin süresi dolmuş");
  return (exp - nowSec) / DAY;
}

function pubkeyObjects(list) {
  if (list.length < 1 || list.length > 2) usage("1 ya da 2 açık anahtar gerekli");
  return list.map((k) => {
    if (!PUBKEY.test(k)) usage("açık anahtar base64url 43 karakter değil");
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(k, "base64url")]);
    return createPublicKey({ key: der, format: "der", type: "spki" });
  });
}

/** build/update-keys/<env>.pub: satır başına (ya da virgülle ayrılmış) anahtar; '#' yorum ve boş satır yok sayılır (build betikleriyle aynı kural). */
function readPubFile(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .flatMap((l) => l.split(","))
    .map((l) => l.replace(/\r$/, "").trim())
    .filter((l) => l && !l.startsWith("#"));
}

function main(argv) {
  const opt = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i] ?? usage(`${a} değer ister`);
    if (a === "--pubkeys")
      opt.pubkeys = val()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (a === "--pubkeys-file") opt.pubkeys = readPubFile(val());
    else if (a === "--env") opt.env = val();
    else if (a === "--now") opt.now = val();
    else if (a === "--min-remaining-days") opt.minDays = Number(val());
    else if (a === "--expect-sha256") opt.sha = val();
    else if (a === "--expect-version") opt.version = val();
    else if (a === "--expect-name") opt.name = true;
    else if (a === "--same-as") opt.same = val();
    else if (a.startsWith("--")) usage(`bilinmeyen seçenek ${a}`);
    else opt.files.push(a);
  }
  if (!opt.pubkeys) usage("--pubkeys ya da --pubkeys-file gerekli");
  if (opt.env !== "prod" && opt.env !== "staging") usage("--env prod|staging gerekli");
  if (opt.files.length === 0) usage("manifest dosyası gerekli");
  if (opt.same && opt.files.length !== 1) usage("--same-as tek manifestle kullanılır");
  const keys = pubkeyObjects(opt.pubkeys);
  const nowSec = opt.now ? Date.parse(opt.now) / 1000 : Date.now() / 1000;
  if (!Number.isFinite(nowSec)) usage("--now ISO zaman olmalı");
  let bad = 0;
  for (const f of opt.files) {
    try {
      const bytes = readFileSync(f);
      const sigText = readFileSync(`${f}.sig`, "latin1").replace(/\n$/, "");
      if (!SIG.test(sigText)) fail("MANIFEST_SIGNATURE: .sig base64url 86 karakter değil");
      const msg = Buffer.concat([Buffer.from(CONTEXT, "latin1"), bytes]);
      const sig = Buffer.from(sigText, "base64url");
      if (!keys.some((k) => verify(null, msg, k, sig))) fail("MANIFEST_SIGNATURE: imza gömülü anahtarlardan hiçbiriyle geçerli değil");
      const o = parseStrict(bytes);
      const left = checkFields(o, opt.env, nowSec);
      if (opt.minDays !== undefined && left < opt.minDays) fail(`kalan süre ${left.toFixed(1)} g < ${opt.minDays} g`);
      if (opt.name && basename(f) !== `update-${o.component}-${o.platform}-${o.arch}.json`)
        fail(`dosya adı hedefle uyuşmuyor (${basename(f)})`);
      if (opt.sha && o.sha256 !== opt.sha) fail(`sha256 beklenen ikiliyle aynı değil (${o.sha256})`);
      if (opt.version && o.version !== opt.version) fail(`sürüm ${o.version}, beklenen ${opt.version}`);
      if (opt.same) {
        const old = JSON.parse(readFileSync(opt.same, "latin1"));
        for (const k of FIELDS) {
          if (k === "issuedAt" || k === "expiresAt") continue;
          if (old[k] !== o[k]) fail(`yeniden imza: ${k} eski manifestten farklı (${old[k]} → ${o[k]})`);
        }
      }
      process.stdout.write(`${JSON.stringify({ file: basename(f), ...o, daysLeft: Number(left.toFixed(2)) })}\n`);
    } catch (e) {
      if (!(e instanceof Fail) && e?.code !== "ENOENT") throw e;
      process.stderr.write(`HATA ${basename(f)}: ${e instanceof Fail ? e.message : "dosya ya da .sig yok"}\n`);
      bad++;
    }
  }
  process.exit(bad ? 1 : 0);
}

main(process.argv.slice(2));
