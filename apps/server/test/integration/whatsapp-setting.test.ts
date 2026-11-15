// WhatsApp servis adresi sistem ayarı (dba): system_settings anahtarı `whatsapp` ve system_settings_whatsapp_chk.
// Migration 20261114090000_whatsapp_service_setting. Denemeler uygulamanın `app` kullanıcısıyla (TEST_DATABASE_URL);
// paylaşılan anahtar satırı geri alınan TX içinde denenir (diğer testleri etkilemez).
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/lib/db.ts";
import { testDb } from "../helpers/app.ts";

const app = () => testDb();
const C = "system_settings_whatsapp_chk";

async function errorText(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "reddedilmeliydi").toBeInstanceOf(Error);
  return `${(err as Error).message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`;
}

const UPSERT =
  "INSERT INTO system_settings (`key`, value_json, secret_enc, updated_at) VALUES (?, ?, ?, NOW(3)) ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), secret_enc = VALUES(secret_enc), updated_at = NOW(3)";

/** `raw` verilirse value_json olarak doğrudan yazılır (JSON.stringify'ın üretemeyeceği biçimler için). */
async function upsert(key: string, value: unknown, secret: Buffer | null = null, raw?: string) {
  const ROLLBACK = new Error("rollback");
  let out: unknown = null;
  await app()
    .$transaction(async (tx: Pick<Db, "$executeRawUnsafe">) => {
      out = await tx.$executeRawUnsafe(UPSERT, key, raw ?? (value === undefined ? null : JSON.stringify(value)), secret);
      throw ROLLBACK;
    })
    .catch((e: unknown) => {
      if (e !== ROLLBACK) throw e;
    });
  return out;
}
const ok = async (value: unknown) => expect(await upsert("whatsapp", value)).toBeGreaterThanOrEqual(1);
const bad = async (value: unknown, chk = C, secret: Buffer | null = null, key = "whatsapp") =>
  expect(await errorText(upsert(key, value, secret))).toMatch(new RegExp(chk));

describe("system_settings `whatsapp` geçerli değerler", () => {
  it("{url: null} ve http(s) adresleri kabul", async () => {
    await ok({ url: null });
    for (const url of [
      "http://203.0.113.10:3000",
      "http://localhost:3000",
      "https://wa.example.com",
      "https://wa.example.com/",
      "https://wa.example.com:8443/api/v1",
      "http://[2001:db8::5]:3000",
      "http://x",
      `https://${"a".repeat(192)}`, // tam 200 karakter
    ])
      await ok({ url });
  });
});

describe("system_settings `whatsapp` CHECK reddi", () => {
  it("anahtar ikili (ADR-0014)", async () => {
    for (const k of ["WHATSAPP", "WhatsApp", "whatsapp ", " whatsapp", "whats_app"])
      await bad({ url: null }, "system_settings_key_chk", null, k);
  });

  it("yapı: value_json dolu nesne, yalnız ve zorunlu `url`, url string|null", async () => {
    await bad(undefined); // value_json NULL
    await bad({});
    await bad({ url: null, token: "x" });
    await bad({ url: "http://wa.example", apiKey: "x" });
    for (const url of [42, true, ["http://wa.example"], { href: "http://wa.example" }]) await bad({ url });
    await bad(["http://wa.example"], "system_settings_(value_json|whatsapp)_chk"); // dizi: genel CHECK de düşebilir
  });

  it("S-P13b-3: secret_enc (servis anahtarı) yalnız adres doluyken; adres null → NULL olmalı; kısa değer genel CHECK'e takılır", async () => {
    await bad({ url: null }, C, Buffer.alloc(45, 7));
    expect(await upsert("whatsapp", { url: "http://wa.example" }, Buffer.alloc(45, 7))).toBeGreaterThanOrEqual(1);
    await bad({ url: "http://wa.example" }, "system_settings_secret_enc_chk", Buffer.alloc(20, 7));
  });

  it("şema/öndek: yalnız http:// veya https://, harf duyarlı", async () => {
    for (const url of [
      "",
      "http://",
      "https://",
      "ftp://wa.example",
      "HTTP://wa.example",
      "Https://wa.example",
      "ws://wa.example",
      "//wa.example",
      "wa.example",
      "http:/wa.example",
      "javascript:alert(1)",
      " http://wa.example",
    ])
      await bad({ url });
  });

  it("P13a (B-P12b-4): biçim (Cf), satır/paragraf ayırıcı (Zl/Zp) reddi — yolda ve host'ta", async () => {
    for (const ch of [
      "\u200B",
      "\u200C",
      "\u200D",
      "\u202A",
      "\u202E",
      "\u2066",
      "\u2069",
      "\uFEFF",
      "\u00AD",
      "\u2060",
      "\u2028",
      "\u2029",
    ]) {
      await bad({ url: `http://wa.example/a${ch}b` });
      await bad({ url: `http://wa${ch}.example` });
    }
    await ok({ url: "http://wa.example/api/v1" }); // sıradan yol hâlâ geçerli
  });

  it("yasak karakterler: @ ? # boşluk kontrol", async () => {
    for (const url of [
      "http://u:p@wa.example",
      "http://wa.example/@x",
      "http://wa.example/?a=1",
      "http://wa.example?",
      "http://wa.example/#x",
      "http://wa.example/a b",
      "http://wa.example\t",
      "http://wa.example\n",
      "http://wa.example\r",
      "http://wa.example\u0000",
      "http://wa.example\u007f",
      "http://wa.example\u0085",
      "http://wa.example ",
      "http://wa.example ",
      "http://wa.example　",
    ])
      await bad({ url });
  });

  it("uzunluk ≤ 200", async () => {
    await bad({ url: `https://${"a".repeat(193)}` }); // 201
  });
});

describe("CHECK tanımları", () => {
  it("system_settings_whatsapp_chk var; key CHECK'i whatsapp'ı kapsıyor", async () => {
    const rows = await app().$queryRaw<{ name: string; clause: string }[]>`
      SELECT CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME IN ('system_settings_whatsapp_chk', 'system_settings_key_chk')`;
    expect(rows.map((r) => r.name).sort()).toEqual(["system_settings_key_chk", "system_settings_whatsapp_chk"]);
    expect(rows.find((r) => r.name === "system_settings_key_chk")?.clause).toContain("whatsapp");
  });
});
