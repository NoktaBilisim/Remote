/*
 * P12 logo/avatar yükleme yardımcıları (AC-81, 83, 84). Sözleşme tek kaynak `@remote/contracts/api/branding`.
 * İstemci denetimi yalnız ön kontroldür (hızlı geri bildirim); asıl denetim sunucuda (magic bytes, 2 MB, yeniden boyut).
 */
import {
  AVATAR_MAX_ASPECT,
  AVATAR_PX,
  DEFAULT_LOGO_URL,
  IMAGE_DIMENSIONS_MESSAGE,
  IMAGE_MIN_EDGE_PX,
  INVALID_IMAGE_MESSAGE,
  LOGO_MAX_ASPECT,
  PAYLOAD_TOO_LARGE_MESSAGE,
  UPLOAD_ACCEPT,
  UPLOAD_FIELD,
  UPLOAD_MAX_BYTES,
} from "@remote/contracts/api/branding";
import { ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

export { AVATAR_PX, DEFAULT_LOGO_URL, IMAGE_DIMENSIONS_MESSAGE, INVALID_IMAGE_MESSAGE, PAYLOAD_TOO_LARGE_MESSAGE, UPLOAD_ACCEPT, UPLOAD_MAX_BYTES };
export type { AvatarResponse, LogoResponse, PublicBrandingResponse, SystemLogoResponse } from "@remote/contracts/api/branding";

/** `<input accept>` değeri. */
export const ACCEPT_ATTR = UPLOAD_ACCEPT.join(",");

export type PrecheckResult = { ok: true } | { ok: false; message: string };

/** Tür (tarayıcının bildirdiği MIME; SVG asla) ve boyut ön kontrolü. */
export function precheckFile(file: { type: string; size: number }): PrecheckResult {
  if (!(UPLOAD_ACCEPT as readonly string[]).includes(file.type)) return { ok: false, message: INVALID_IMAGE_MESSAGE };
  if (file.size > UPLOAD_MAX_BYTES) return { ok: false, message: PAYLOAD_TOO_LARGE_MESSAGE };
  if (file.size === 0) return { ok: false, message: INVALID_IMAGE_MESSAGE };
  return { ok: true };
}

/**
 * Boyut/oran ön kontrolü (sunucuyla aynı sınırlar, contracts): her kenar ≥ IMAGE_MIN_EDGE_PX, uzun/kısa kenar oranı
 * logoda ≤ LOGO_MAX_ASPECT, profil resminde ≤ AVATAR_MAX_ASPECT. Avatarda seçilen kaynak resme uygulanır.
 */
export function precheckDimensions(width: number, height: number, kind: "logo" | "avatar"): PrecheckResult {
  const min = Math.min(width, height);
  const max = Math.max(width, height);
  const limit = kind === "logo" ? LOGO_MAX_ASPECT : AVATAR_MAX_ASPECT;
  if (!(min >= IMAGE_MIN_EDGE_PX) || max / min > limit) return { ok: false, message: IMAGE_DIMENSIONS_MESSAGE };
  return { ok: true };
}

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Kırpıcının verdiği piksel alanını (ondalıklı, kenardan taşabilir) resmin içinde kalan tam sayılı **kare**ye çevirir.
 * Kenar = min(genişlik, yükseklik), resmin kısa kenarını aşmaz; konum resmin içine kıstırılır.
 */
export function squareCrop(area: Area, imgW: number, imgH: number): Area {
  const side = Math.max(1, Math.floor(Math.min(area.width, area.height, imgW, imgH)));
  const clamp = (v: number, max: number) => Math.min(Math.max(0, Math.round(v)), Math.max(0, max));
  return { x: clamp(area.x, imgW - side), y: clamp(area.y, imgH - side), width: side, height: side };
}

/** Yükleme hatası → kullanıcı mesajı (413, 400 INVALID_IMAGE → sunucunun mesajı, 429 + genel). */
export function uploadError(e: unknown): UiError {
  if (e instanceof ApiError) {
    if (e.status === 413 || e.code === "PAYLOAD_TOO_LARGE") return { message: PAYLOAD_TOO_LARGE_MESSAGE, tone: "danger" };
    // Sunucu tür reddinde de boyut/oran reddinde de 400 INVALID_IMAGE döner; ayrıntı mesajdadır (test raporu: oran
    // reddi "yalnız PNG…" diye gösteriliyordu). Mesaj yoksa tür mesajına düşülür.
    if (e.code === "INVALID_IMAGE") return { message: e.message.trim() || INVALID_IMAGE_MESSAGE, tone: "danger" };
    if (e.status === 429) return { message: t("br.rateLimited"), tone: "locked" };
  }
  return toUiError(e);
}

/** Tek dosyalı multipart gövdesi (`file` alanı). */
export function uploadBody(blob: Blob, name: string): FormData {
  const fd = new FormData();
  fd.append(UPLOAD_FIELD, blob, name);
  return fd;
}

/** Varsayılan sistem logosu (yüklenmiş logo yok) mu. */
export const isDefaultLogo = (url: string | null | undefined): boolean => !url || url === DEFAULT_LOGO_URL;

/**
 * Dosyayı `data:` URL'sine okur (önizleme/kırpma kaynağı). `blob:` yerine: CSP `connect-src` blob'u kapsamaz ve
 * bazı araçlar (ör. Playwright izi) blob kaynağını fetch ile okur → CSP ihlali konsola düşer. Dosya ≤ 2 MB (ön kontrol).
 */
export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => (typeof r.result === "string" ? resolve(r.result) : reject(new Error("read")));
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(file);
  });
}

/** Dosyayı tarayıcıda çözer; bozuk/sahte uzantılı dosyada reddedilir (sunucu da reddeder). Yalnız istemci. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth > 0 ? resolve(img) : reject(new Error("decode")));
    img.onerror = () => reject(new Error("decode"));
    img.src = src;
  });
}

/** Kare alanı `px`×`px` WEBP'e (desteklenmiyorsa PNG) çizer. Yalnız istemci. */
export async function cropToBlob(img: HTMLImageElement, area: Area, px = AVATAR_PX): Promise<Blob> {
  const sq = squareCrop(area, img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sq.x, sq.y, sq.width, sq.height, 0, 0, px, px);
  const toBlob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
  const webp = await toBlob("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const png = await toBlob("image/png");
  if (!png) throw new Error("canvas");
  return png;
}
