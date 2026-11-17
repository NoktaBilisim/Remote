import { describe, expect, it } from "vitest";
import { agentOsOf, isMacDesktop, isScreenShareSupported, isWindowsDesktop, type SupportEnv } from "./device-support";

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
  it("yalnız dokunmatik (ince işaretçi yok) desteklenmez", () =>
    expect(isScreenShareSupported({ ...desktop, coarseOnly: true })).toBe(false));
  it("mobil UA desteklenmez", () =>
    expect(
      isScreenShareSupported({
        ...desktop,
        uaMobile: undefined,
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Safari/537.36",
      }),
    ).toBe(false));
  it("UA-CH yoksa (Firefox) masaüstü UA desteklenir", () => expect(isScreenShareSupported({ ...desktop, uaMobile: undefined })).toBe(true));
});

describe("isWindowsDesktop (AC-27)", () => {
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
  const linux = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
  it("Windows masaüstü Chrome/Edge → evet", () => expect(isWindowsDesktop(desktop)).toBe(true));
  it("Windows Firefox (UA-CH yok) → evet", () =>
    expect(
      isWindowsDesktop({
        uaMobile: undefined,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
      }),
    ).toBe(true));
  it("macOS → hayır (yalnız tarayıcı modu)", () => expect(isWindowsDesktop({ ...desktop, userAgent: mac })).toBe(false));
  it("Linux → hayır", () => expect(isWindowsDesktop({ uaMobile: undefined, userAgent: linux })).toBe(false));
  it("Android → hayır", () =>
    expect(isWindowsDesktop({ uaMobile: undefined, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Safari/537.36" })).toBe(
      false,
    ));
  it("UA-CH mobile=true → hayır", () => expect(isWindowsDesktop({ ...desktop, uaMobile: true })).toBe(false));
});

describe("isMacDesktop / agentOsOf (P28f AC-396)", () => {
  const macChrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
  const macSafari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const macFirefox = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:140.0) Gecko/20100101 Firefox/140.0";
  const win = desktop.userAgent;
  const linux = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
  it.each([
    ["Chrome", macChrome],
    ["Safari", macSafari],
    ["Firefox", macFirefox],
  ])("macOS %s → evet", (_n, ua) => expect(isMacDesktop({ uaMobile: undefined, userAgent: ua, maxTouchPoints: 0 })).toBe(true));
  it("UA-CH platform macOS (UA ne olursa olsun Windows değilse) → evet", () =>
    expect(isMacDesktop({ uaMobile: false, userAgent: "Mozilla/5.0 (X11) Chrome/140.0", platform: "macOS" })).toBe(true));
  it("iPad masaüstü modu (Macintosh UA + maxTouchPoints 5) → hayır", () =>
    expect(isMacDesktop({ uaMobile: undefined, userAgent: macSafari, maxTouchPoints: 5 })).toBe(false));
  it("iPhone / mobil → hayır", () =>
    expect(isMacDesktop({ uaMobile: undefined, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148" })).toBe(
      false,
    ));
  it("UA-CH mobile=true → hayır", () => expect(isMacDesktop({ uaMobile: true, userAgent: macChrome })).toBe(false));
  it("Windows UA, ana makine UA-CH platform macOS olsa bile → Mac değil (yüklemler karşılıklı dışlar)", () => {
    const env = { uaMobile: false, userAgent: win, platform: "macOS", maxTouchPoints: 0 };
    expect(isMacDesktop(env)).toBe(false);
    expect(agentOsOf(env)).toBe("windows");
  });
  it("agentOsOf: macOS → macos, Linux → null, Android → null", () => {
    expect(agentOsOf({ uaMobile: undefined, userAgent: macChrome, platform: "Linux" })).toBe("macos");
    expect(agentOsOf({ uaMobile: undefined, userAgent: linux })).toBeNull();
    expect(agentOsOf({ uaMobile: undefined, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Safari/537.36" })).toBeNull();
  });
});
