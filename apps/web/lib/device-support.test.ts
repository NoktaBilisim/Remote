import { describe, expect, it } from "vitest";
import { isScreenShareSupported, type SupportEnv } from "./device-support";

const desktop: SupportEnv = {
  hasDisplayMedia: true,
  uaMobile: false,
  coarseOnly: false,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
};

describe("isScreenShareSupported (AC-33)", () => {
  it("masaüstü Chrome desteklenir", () => expect(isScreenShareSupported(desktop)).toBe(true));
  it("getDisplayMedia yoksa desteklenmez", () => expect(isScreenShareSupported({ ...desktop, hasDisplayMedia: false })).toBe(false));
  it("UA-CH mobile=true desteklenmez", () => expect(isScreenShareSupported({ ...desktop, uaMobile: true })).toBe(false));
  it("yalnız dokunmatik (ince işaretçi yok) desteklenmez", () => expect(isScreenShareSupported({ ...desktop, coarseOnly: true })).toBe(false));
  it("mobil UA desteklenmez", () =>
    expect(isScreenShareSupported({ ...desktop, uaMobile: undefined, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Safari/537.36" })).toBe(false));
  it("UA-CH yoksa (Firefox) masaüstü UA desteklenir", () => expect(isScreenShareSupported({ ...desktop, uaMobile: undefined })).toBe(true));
});
