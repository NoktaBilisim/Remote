// Resim doğrulama + yeniden kodlama (T16, AC-84). Tür YALNIZ içerikten (magic bytes, `file-type`): PNG/JPEG/WEBP;
// SVG/HTML/uzantısı değiştirilmiş dosya reddedilir (sharp librsvg ile SVG de açabildiği için ikinci kontrol: sharp'ın
// algıladığı biçim de aynı kümede olmalı). Piksel bombası `limitInputPixels` ile; bozuk veri `failOn: "error"` ile ret.
// Çıktı her zaman sunucunun ürettiği yeni dosyadır: EXIF/ICC/XMP dahil tüm metadata atılır (sharp varsayılanı),
// yönlendirme önce `rotate()` ile piksellere uygulanır.
// B-P12-2: boyut/oran sınırı (metadata, kod çözmeden önce) + süreç genelinde eşzamanlı kod çözme kapısı (2 iş; en çok
// 4 bekleyen, 10 sn; dolu/zaman aşımı → 429 RATE_LIMITED). Kapı yalnız doğrulamadan geçen resmin kod çözme/kodlama
// adımını sarar; reddedilen dosya yer tutmaz.
import {
  AVATAR_MAX_ASPECT,
  AVATAR_PX,
  IMAGE_BUSY_MESSAGE,
  IMAGE_DIMENSIONS_MESSAGE,
  IMAGE_MIN_EDGE_PX,
  LOGO_MAX_ASPECT,
  LOGO_MAX_PX,
} from "@remote/contracts/api/branding";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { AppError } from "../lib/errors.ts";
import { ConcurrencyGate, GateBusyError } from "../lib/gate.ts";

export type ImageKind = "logo" | "avatar";

/** ~24 MP (ör. 6000×4000). 2 MB'lık sıkıştırılmış dosya çok daha büyük tuvale açılabilir (decompression bomb). */
const MAX_INPUT_PIXELS = 24_000_000;

const ACCEPTED_MIME: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp"]);
const ACCEPTED_FORMAT: ReadonlySet<string> = new Set(["png", "jpeg", "webp"]);

/** Eşzamanlı resim kod çözme (libvips + libuv havuzu argon2 ile ortak; girişleri geciktirmesin). */
export const IMAGE_CONCURRENCY = 2;
export const IMAGE_MAX_WAITING = 4;
const IMAGE_WAIT_MS = 10_000;
export const IMAGE_BUSY_RETRY_SEC = 5;
const GATE_KEY = "image";

/** Süreç geneli tek kapı (tek instance, ADR-0005). Test erişimi için dışa açık. */
export const imageGate = new ConcurrencyGate({
  perKey: IMAGE_CONCURRENCY,
  global: IMAGE_CONCURRENCY,
  maxWaitingPerKey: IMAGE_MAX_WAITING,
  maxWaiting: IMAGE_MAX_WAITING,
  waitMs: IMAGE_WAIT_MS,
});

/** Kapı içinde çalıştırır; dolu/zaman aşımı → 429 `RATE_LIMITED`. */
export async function withImageSlot<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await imageGate.run(GATE_KEY, fn);
  } catch (err) {
    if (err instanceof GateBusyError)
      throw new AppError("RATE_LIMITED", { message: IMAGE_BUSY_MESSAGE, retryAfterSec: IMAGE_BUSY_RETRY_SEC });
    throw err;
  }
}

/** Her kenar ≥ 16 px ve uzun/kısa kenar ≤ 20 (logo) / 4 (avatar). */
export function dimensionsOk(width: number | undefined, height: number | undefined, kind: ImageKind): boolean {
  if (!width || !height) return false;
  const lo = Math.min(width, height);
  const hi = Math.max(width, height);
  return lo >= IMAGE_MIN_EDGE_PX && hi <= lo * (kind === "logo" ? LOGO_MAX_ASPECT : AVATAR_MAX_ASPECT);
}

interface ProcessedImage {
  data: Buffer;
  ext: "png" | "webp";
  width: number;
  height: number;
}

async function assertAccepted(input: Buffer): Promise<void> {
  const type = await fileTypeFromBuffer(input);
  if (!type || !ACCEPTED_MIME.has(type.mime)) throw new AppError("INVALID_IMAGE");
}

function pipeline(input: Buffer) {
  // pages:1 → animasyonlu WEBP'nin yalnız ilk karesi; sequentialRead bellek tepe değerini düşürür.
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", pages: 1, sequentialRead: true });
}

/** Doğrular ve yeniden kodlar. Geçersiz/bozuk/çok büyük/aşırı oran → `INVALID_IMAGE` (400); kapı dolu → 429. */
export async function processImage(input: Buffer, kind: ImageKind): Promise<ProcessedImage> {
  try {
    await assertAccepted(input);
    const meta = await pipeline(input).metadata();
    if (!meta.format || !ACCEPTED_FORMAT.has(meta.format)) throw new AppError("INVALID_IMAGE");
    if (!dimensionsOk(meta.width, meta.height, kind)) throw new AppError("INVALID_IMAGE", { message: IMAGE_DIMENSIONS_MESSAGE });
    const out = await withImageSlot(() => {
      const base = pipeline(input).rotate();
      return kind === "logo"
        ? base
            .resize(LOGO_MAX_PX, LOGO_MAX_PX, { fit: "inside", withoutEnlargement: true })
            .png({ compressionLevel: 9 })
            .toBuffer({ resolveWithObject: true })
        : base
            .resize(AVATAR_PX, AVATAR_PX, { fit: "cover", position: "centre" })
            .webp({ quality: 85 })
            .toBuffer({ resolveWithObject: true });
    });
    return { data: out.data, ext: kind === "logo" ? "png" : "webp", width: out.info.width, height: out.info.height };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("INVALID_IMAGE");
  }
}
