// P12 (AC-84, T16): resim doğrulama/yeniden kodlama, depo yolu kuralları, sözleşme ↔ DB CHECK deseni.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { avatarPathSchema, logoPathSchema, systemLogoValueSchema, themeCookieValue } from "@remote/contracts/api/branding";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors.ts";
import {
  IMAGE_BUSY_RETRY_SEC,
  IMAGE_CONCURRENCY,
  IMAGE_MAX_WAITING,
  dimensionsOk,
  imageGate,
  processImage,
  withImageSlot,
} from "../../src/uploads/image.ts";
import { UploadStore, isRelPath } from "../../src/uploads/store.ts";
import { avatarUrlFor, canViewAvatar } from "../../src/uploads/urls.ts";

const T = "01HZZZZZZZZZZZZZZZZZZZZZZZ";
const solid = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } });
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>',
);

async function rejected(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    return err instanceof AppError ? err.code : "other";
  }
}

describe("AC-84 resim işleme", () => {
  it("AC-84: PNG logo → PNG, en çok 512 px, oran korunur; küçük resim büyütülmez", async () => {
    const big = await processImage(await solid(2000, 1000).png().toBuffer(), "logo");
    expect(big.ext).toBe("png");
    expect([big.width, big.height]).toEqual([512, 256]);
    expect((await sharp(big.data).metadata()).format).toBe("png");
    const small = await processImage(await solid(100, 40).png().toBuffer(), "logo");
    expect([small.width, small.height]).toEqual([100, 40]);
  });

  it("AC-84: avatar → WEBP 256×256 kare (ortadan kırpma), JPEG ve WEBP girdileri kabul", async () => {
    for (const input of [await solid(800, 300).jpeg().toBuffer(), await solid(300, 900).webp().toBuffer()]) {
      const out = await processImage(input, "avatar");
      const meta = await sharp(out.data).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["webp", 256, 256]);
    }
  });

  it("AC-84: SVG, uzantısı .png yapılmış SVG/HTML, metin ve boş veri reddedilir (INVALID_IMAGE)", async () => {
    expect(await rejected(processImage(SVG, "logo"))).toBe("INVALID_IMAGE");
    expect(await rejected(processImage(Buffer.from("<!doctype html><html><script>alert(1)</script></html>"), "avatar"))).toBe(
      "INVALID_IMAGE",
    );
    expect(await rejected(processImage(Buffer.from("GIF89a..."), "logo"))).toBe("INVALID_IMAGE");
    expect(await rejected(processImage(Buffer.alloc(0), "logo"))).toBe("INVALID_IMAGE");
    // GIF / TIFF gerçek resim olsa da kabul listesinde değil
    expect(await rejected(processImage(await solid(10, 10).gif().toBuffer(), "logo"))).toBe("INVALID_IMAGE");
    expect(await rejected(processImage(await solid(10, 10).tiff().toBuffer(), "logo"))).toBe("INVALID_IMAGE");
  });

  it("AC-84: bozuk PNG (başlık doğru, veri kesik) reddedilir", async () => {
    const png = await solid(300, 300).png().toBuffer();
    expect(await rejected(processImage(png.subarray(0, 120), "logo"))).toBe("INVALID_IMAGE");
  });

  it("AC-84/T16: piksel bombası (küçük dosya, 36 MP tuval) limitInputPixels ile reddedilir", async () => {
    const bomb = await solid(6000, 6000).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    expect(await rejected(processImage(bomb, "logo"))).toBe("INVALID_IMAGE");
  });

  it("AC-84: EXIF'li JPEG'den çıkan dosyada EXIF/ICC/XMP yok", async () => {
    const withExif = await solid(400, 300)
      .jpeg()
      .withExif({ IFD0: { Copyright: "Gizli Konum", Artist: "Ayşe" }, IFD3: { GPSLatitudeRef: "N" } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    for (const kind of ["logo", "avatar"] as const) {
      const meta = await sharp((await processImage(withExif, kind)).data).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.icc).toBeUndefined();
    }
  });
});

describe("AC-84 / B-P12-2 boyut, oran ve eşzamanlılık sınırı", () => {
  it("AC-84/B-P12-2: 1×N ve N×1 PNG (logo ve avatar) kod çözülmeden INVALID_IMAGE + boyut mesajı", async () => {
    for (const [w, h] of [
      [1, 100_000],
      [100_000, 1],
      [2, 50_000],
      [15, 15],
    ] as const) {
      const input = await solid(w, h).png({ compressionLevel: 9 }).toBuffer();
      for (const kind of ["logo", "avatar"] as const) {
        const err = await processImage(input, kind).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err, `${w}×${h} ${kind}`).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("INVALID_IMAGE");
        expect((err as AppError).message).toContain("16 px");
      }
    }
  });

  it("AC-84/B-P12-2: oran sınırı logo 20:1, avatar 4:1 (sınır dahil kabul); kenar 16 px kabul", async () => {
    expect(dimensionsOk(16, 16, "avatar")).toBe(true);
    expect(dimensionsOk(320, 16, "logo")).toBe(true);
    expect(dimensionsOk(321, 16, "logo")).toBe(false);
    expect(dimensionsOk(16, 321, "logo")).toBe(false);
    expect(dimensionsOk(400, 100, "avatar")).toBe(true);
    expect(dimensionsOk(100, 401, "avatar")).toBe(false);
    expect(dimensionsOk(undefined, 100, "logo")).toBe(false);
    const wide = await processImage(await solid(1000, 50).png().toBuffer(), "logo");
    expect([wide.width, wide.height]).toEqual([512, 26]);
    expect(await rejected(processImage(await solid(1000, 49).png().toBuffer(), "logo"))).toBe("INVALID_IMAGE");
    expect(await rejected(processImage(await solid(800, 200).jpeg().toBuffer(), "avatar"))).toBe("ok");
    expect(await rejected(processImage(await solid(801, 200).jpeg().toBuffer(), "avatar"))).toBe("INVALID_IMAGE");
  });

  it("B-P12-2: süreç genelinde en çok 2 resim işi aynı anda çalışır; fazlası sırayla bekler", async () => {
    let now = 0;
    let peak = 0;
    const job = () =>
      withImageSlot(async () => {
        now += 1;
        peak = Math.max(peak, now);
        await new Promise((r) => setTimeout(r, 20));
        now -= 1;
        return true;
      });
    const all = await Promise.all(Array.from({ length: IMAGE_CONCURRENCY + IMAGE_MAX_WAITING }, job));
    expect(all.every(Boolean)).toBe(true);
    expect(peak).toBe(IMAGE_CONCURRENCY);
    expect([imageGate.running, imageGate.waiting]).toEqual([0, 0]);
  });

  it("B-P12-2: kuyruk doluyken geçerli resim 429 RATE_LIMITED (Retry-After); kapı boşalınca işlenir", async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const busy = Array.from({ length: IMAGE_CONCURRENCY + IMAGE_MAX_WAITING }, () => withImageSlot(() => hold));
    expect([imageGate.running, imageGate.waiting]).toEqual([IMAGE_CONCURRENCY, IMAGE_MAX_WAITING]);
    const input = await solid(64, 64).png().toBuffer();
    const err = await processImage(input, "avatar").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect([(err as AppError).code, (err as AppError).retryAfterSec]).toEqual(["RATE_LIMITED", IMAGE_BUSY_RETRY_SEC]);
    // geçersiz resim kapıya hiç girmez: kuyruk doluyken de 400
    expect(await rejected(processImage(await solid(1, 500).png().toBuffer(), "logo"))).toBe("INVALID_IMAGE");
    release();
    await Promise.all(busy);
    expect((await processImage(input, "avatar")).ext).toBe("webp");
  });
});

describe("AC-84 depo ve yol kuralları", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rs-p12-unit-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("AC-84: rastgele ad, tenant klasörü, atomik yazım (geçici dosya kalmaz), sil", async () => {
    const store = new UploadStore(dir);
    const a = await store.save(T, "png", Buffer.from("x"));
    const b = await store.save(T, "png", Buffer.from("y"));
    expect(a).toMatch(new RegExp(`^${T}/[A-Za-z0-9_-]{24}\\.png$`));
    expect(a).not.toBe(b);
    expect(await readdir(join(dir, T))).toHaveLength(2);
    expect((await store.read(a))?.toString()).toBe("x");
    await store.remove(a);
    expect(await store.read(a)).toBeNull();
    expect(await readdir(join(dir, T))).toEqual([b.split("/")[1]]);
  });

  it("AC-84: path traversal ve biçim dışı yollar okunmaz/silinmez", async () => {
    const store = new UploadStore(dir);
    for (const bad of [
      "../etc/passwd",
      `${T}/../x.png`,
      `${T}/..%2fx.png`,
      "/etc/passwd",
      `${T}/kisa.png`,
      `${T}/${"a".repeat(20)}.svg`,
      `${T}/${"a".repeat(20)}.PNG`,
      `uploads/${T}/${"a".repeat(20)}.png`,
      `${T}/sub/${"a".repeat(20)}.png`,
      `${T.toLowerCase()}/${"a".repeat(20)}.png`,
    ]) {
      expect(isRelPath(bad), bad).toBe(false);
      expect(await store.read(bad)).toBeNull();
    }
    await expect(store.save("../x", "png", Buffer.from("x"))).rejects.toThrow();
  });

  it("AC-84: sözleşme şemaları DB CHECK deseniyle aynı (öndek satırın tenant'ı; Super Admin → system)", () => {
    const name = "a".repeat(16);
    expect(logoPathSchema(T).safeParse(`${T}/${name}.png`).success).toBe(true);
    expect(logoPathSchema(T).safeParse(`01HAAAAAAAAAAAAAAAAAAAAAAA/${name}.png`).success).toBe(false);
    expect(logoPathSchema(T).safeParse(`${T}/${name}.png\n`).success).toBe(false);
    expect(avatarPathSchema(null).safeParse(`system/${name}.webp`).success).toBe(true);
    expect(avatarPathSchema(T).safeParse(`system/${name}.webp`).success).toBe(false);
    expect(systemLogoValueSchema.safeParse({ path: `system/${name}.png` }).success).toBe(true);
    expect(systemLogoValueSchema.safeParse({ path: `system/${name}.png`, x: 1 }).success).toBe(false);
  });

  it("AC-84: avatar görünürlüğü — aynı tenant veya Super Admin; başka tenant/sistem avatarı → null", () => {
    const own = `${T}/${"b".repeat(20)}.webp`;
    expect(avatarUrlFor(own, { role: "USER", tenantId: T })).toBe(`/api/v1/files/avatar/${own}`);
    expect(avatarUrlFor(own, { role: "ADMIN", tenantId: "01HAAAAAAAAAAAAAAAAAAAAAAA" })).toBeNull();
    expect(avatarUrlFor(`system/${"b".repeat(20)}.webp`, { role: "ADMIN", tenantId: T })).toBeNull();
    expect(canViewAvatar({ role: "SUPER_ADMIN", tenantId: null }, T)).toBe(true);
  });

  it("AC-85: tema çerez değeri küçük harf", () => {
    expect(themeCookieValue("DARK")).toBe("dark");
    expect(themeCookieValue("SYSTEM")).toBe("system");
  });
});
