// Favicon üretimi (ortak standart §1.5, AC-86): kaynak NOKTA_LOGO/nokta-kucuk.png.
// Logo çizilmez; kaynak şeffaf kenarla kareye tamamlanır (oran korunur) ve ölçeklenir.
// Kullanım: pnpm --filter @remote/web icons [kaynak-klasör]
import { chmod, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const src = process.argv[2] ?? "/Users/mennan/Projeler/NOKTA_LOGO";
const pub = new URL("../public/", import.meta.url).pathname;
const small = path.join(src, "nokta-kucuk.png");

await copyFile(path.join(src, "logo.png"), path.join(pub, "img/logo.png"));
await copyFile(small, path.join(pub, "img/nokta-kucuk.png"));
await Promise.all(["img/logo.png", "img/nokta-kucuk.png"].map((f) => chmod(path.join(pub, f), 0o644)));

const meta = await sharp(small).metadata();
const side = Math.max(meta.width, meta.height);
const square = await sharp(small)
  .extend({
    top: Math.floor((side - meta.height) / 2),
    bottom: Math.ceil((side - meta.height) / 2),
    left: Math.floor((side - meta.width) / 2),
    right: Math.ceil((side - meta.width) / 2),
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();

const png = (size) => sharp(square).resize(size, size).png().toBuffer();

await writeFile(path.join(pub, "favicon-32x32.png"), await png(32));
await writeFile(path.join(pub, "apple-touch-icon.png"), await png(180));

// ICO: PNG gömülü girdiler (Vista+ ve tüm güncel tarayıcılar destekler)
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s, 0);
  e.writeUInt8(s, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
await writeFile(path.join(pub, "favicon.ico"), Buffer.concat([header, ...dir, ...images]));
console.log("favicon.ico, favicon-32x32.png, apple-touch-icon.png, img/* hazır");
