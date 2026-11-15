import { describe, expect, it } from "vitest";
import { ApiError, api } from "@/lib/api";
import {
  IMAGE_DIMENSIONS_MESSAGE,
  INVALID_IMAGE_MESSAGE,
  PAYLOAD_TOO_LARGE_MESSAGE,
  UPLOAD_MAX_BYTES,
  isDefaultLogo,
  precheckDimensions,
  precheckFile,
  squareCrop,
  uploadBody,
  uploadError,
} from "@/lib/branding/image";
import { cookieToTheme, htmlThemeClass, isTheme, resolveTheme, themeCookieString, themeToCookie } from "@/lib/theme";

describe("P12 tema çözümleme (AC-85)", () => {
  it("oturum varsa DB değeri çerezden önce gelir", () => {
    expect(resolveTheme({ user: "DARK", cookie: "light" })).toBe("DARK");
    expect(resolveTheme({ user: "SYSTEM", cookie: "dark" })).toBe("SYSTEM");
  });
  it("oturum yoksa tarayıcıdaki son tercih (çerez), o da yoksa sistem", () => {
    expect(resolveTheme({ cookie: "dark" })).toBe("DARK");
    expect(resolveTheme({ cookie: " Light " })).toBe("LIGHT");
    expect(resolveTheme({ cookie: undefined })).toBe("SYSTEM");
    expect(resolveTheme({ user: "mor", cookie: "x" })).toBe("SYSTEM");
  });
  it("html sınıfı: sistemde sınıf yok", () => {
    expect(htmlThemeClass("LIGHT")).toBe("light");
    expect(htmlThemeClass("DARK")).toBe("dark");
    expect(htmlThemeClass("SYSTEM")).toBeUndefined();
  });
  it("çerez değeri gidiş-dönüş ve çerez dizesi", () => {
    for (const th of ["LIGHT", "DARK", "SYSTEM"] as const) expect(cookieToTheme(themeToCookie(th))).toBe(th);
    expect(cookieToTheme("")).toBeNull();
    expect(isTheme("DARK")).toBe(true);
    expect(isTheme("dark")).toBe(false);
    expect(themeCookieString("DARK", false)).toBe("rs_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(themeCookieString("LIGHT", true)).toMatch(/; Secure$/);
  });
});

describe("P12 yükleme ön kontrolü ve kırpma (AC-83, 84)", () => {
  it("yalnız PNG/JPG/WEBP, en çok 2 MB; SVG ve boş dosya reddedilir", () => {
    expect(precheckFile({ type: "image/png", size: 10 })).toEqual({ ok: true });
    expect(precheckFile({ type: "image/webp", size: UPLOAD_MAX_BYTES })).toEqual({ ok: true });
    expect(precheckFile({ type: "image/svg+xml", size: 10 })).toEqual({ ok: false, message: INVALID_IMAGE_MESSAGE });
    expect(precheckFile({ type: "", size: 10 })).toEqual({ ok: false, message: INVALID_IMAGE_MESSAGE });
    expect(precheckFile({ type: "image/jpeg", size: UPLOAD_MAX_BYTES + 1 })).toEqual({ ok: false, message: PAYLOAD_TOO_LARGE_MESSAGE });
    expect(precheckFile({ type: "image/png", size: 0 }).ok).toBe(false);
  });
  it("boyut/oran ön kontrolü sunucuyla aynı sınırlar (kenar ≥ 16, logo ≤ 20:1, avatar ≤ 4:1)", () => {
    const bad = { ok: false, message: IMAGE_DIMENSIONS_MESSAGE };
    expect(precheckDimensions(3000, 40, "logo")).toEqual(bad); // 75:1
    expect(precheckDimensions(8, 8, "logo")).toEqual(bad);
    expect(precheckDimensions(8, 8, "avatar")).toEqual(bad);
    expect(precheckDimensions(16, 16, "avatar")).toEqual({ ok: true });
    expect(precheckDimensions(800, 40, "logo")).toEqual({ ok: true }); // tam 20:1
    expect(precheckDimensions(820, 40, "logo")).toEqual(bad);
    expect(precheckDimensions(40, 160, "avatar")).toEqual({ ok: true }); // tam 4:1
    expect(precheckDimensions(300, 100, "avatar")).toEqual({ ok: true });
    expect(precheckDimensions(500, 100, "avatar")).toEqual(bad);
    expect(precheckDimensions(0, 0, "logo")).toEqual(bad);
  });
  it("kırpma alanı resmin içinde tam sayılı kareye iner", () => {
    expect(squareCrop({ x: 10.4, y: 20.6, width: 100.7, height: 99.2 }, 400, 300)).toEqual({ x: 10, y: 21, width: 99, height: 99 });
    // taşan alan kıstırılır, kenar kısa kenarı aşmaz
    expect(squareCrop({ x: -5, y: 250, width: 500, height: 500 }, 400, 300)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    expect(squareCrop({ x: 390, y: 290, width: 50, height: 50 }, 400, 300)).toEqual({ x: 350, y: 250, width: 50, height: 50 });
  });
  it("sunucu hataları kullanıcı mesajına çevrilir", () => {
    expect(uploadError(new ApiError(413, "PAYLOAD_TOO_LARGE", "x")).message).toBe(PAYLOAD_TOO_LARGE_MESSAGE);
    expect(uploadError(new ApiError(400, "INVALID_IMAGE", IMAGE_DIMENSIONS_MESSAGE)).message).toBe(IMAGE_DIMENSIONS_MESSAGE); // sunucunun mesajı
    expect(uploadError(new ApiError(400, "INVALID_IMAGE", "")).message).toBe(INVALID_IMAGE_MESSAGE);
    expect(uploadError(new ApiError(429, "RATE_LIMITED", "")).tone).toBe("locked");
    expect(uploadError(new ApiError(500, "INTERNAL", "Sunucu hatası")).message).toBe("Sunucu hatası");
  });
  it("varsayılan logo tanınır", () => {
    expect(isDefaultLogo("/img/logo.png")).toBe(true);
    expect(isDefaultLogo(null)).toBe(true);
    expect(isDefaultLogo("/api/v1/files/logo/X/abc.png")).toBe(false);
  });
  it("multipart gövde: `file` alanı, Content-Type tarayıcıya bırakılır, CSRF başlığı eklenir", async () => {
    let init: RequestInit | undefined;
    const fd = uploadBody(new Blob(["x"], { type: "image/webp" }), "avatar.webp");
    await api("POST", "/users/me/avatar", fd, {
      fetch: async (_u, i) => {
        init = i;
        return new Response(JSON.stringify({ avatarUrl: "/a" }), { status: 200 });
      },
      cookie: () => "__Host-rs_csrf=tok",
    });
    const h = init?.headers as Record<string, string>;
    expect(init?.body).toBe(fd);
    expect(h["Content-Type"]).toBeUndefined();
    expect(h["x-csrf-token"]).toBe("tok");
    expect((fd.get("file") as File).name).toBe("avatar.webp");
  });
});
