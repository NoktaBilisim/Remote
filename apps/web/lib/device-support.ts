import type { AgentDownloadOs } from "@remote/contracts/api/sessions";

/**
 * AC-33: tarayıcı modu yalnız masaüstü tarayıcıda desteklenir. Ekran paylaşımı API'si yoksa veya cihaz
 * mobilse (UA-CH `mobile`, ince işaretçisi olmayan dokunmatik cihaz veya mobil UA) "desteklenmiyor" ekranı gösterilir.
 */
export interface SupportEnv {
  hasDisplayMedia: boolean;
  uaMobile: boolean | undefined;
  coarseOnly: boolean;
  userAgent: string;
  /** UA-CH `platform` ("macOS", "Windows" …); Firefox/Safari'de yok. */
  platform?: string | undefined;
  /** `navigator.maxTouchPoints`: iPad masaüstü modu "Macintosh" UA'sı taşır ama > 1 dokunma noktası bildirir. */
  maxTouchPoints?: number | undefined;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;
const LINUX_FAMILY_UA = /\bLinux\b|\bX11\b|\bCrOS\b/i;

export function isScreenShareSupported(env: SupportEnv): boolean {
  if (!env.hasDisplayMedia) return false;
  if (env.uaMobile === true || env.coarseOnly) return false;
  return !MOBILE_UA.test(env.userAgent);
}

/**
 * AC-27: Windows masaüstü. macOS için `isMacDesktop` (P28f AC-396), Linux x86_64 için `isLinuxDesktop` (P28g); diğerlerinde
 * (mobil, ChromeOS, ARM Linux) yalnız tarayıcı modu.
 * Windows'ta Chrome/Edge/Firefox UA'sı (UA indirgemesinde de) "Windows NT" taşır; mobil UA ve UA-CH mobile=true hariç.
 */
export function isWindowsDesktop(env: Pick<SupportEnv, "uaMobile" | "userAgent">): boolean {
  if (env.uaMobile === true) return false;
  return /Windows NT/i.test(env.userAgent) && !MOBILE_UA.test(env.userAgent);
}

/**
 * P28f AC-396: macOS masaüstü (Hızlı Destek macOS indirmesi sunulabilir). UA "Macintosh" taşır (Safari/Chrome/Firefox,
 * UA indirgemesinde de) ya da UA-CH `platform` "macOS"tur; "Windows NT" taşıyan UA hiçbir zaman Mac sayılmaz (iki yüklem
 * karşılıklı dışlar). iPad masaüstü modu (`maxTouchPoints > 1`), mobil UA ve UA-CH mobile=true Mac değildir.
 */
export function isMacDesktop(env: Pick<SupportEnv, "uaMobile" | "userAgent" | "platform" | "maxTouchPoints">): boolean {
  if (env.uaMobile === true || MOBILE_UA.test(env.userAgent) || /Windows NT/i.test(env.userAgent)) return false;
  // P28g: Linux/ChromeOS UA'sı hiçbir zaman Mac sayılmaz (yüklemler karşılıklı dışlar)
  if (LINUX_FAMILY_UA.test(env.userAgent)) return false;
  if ((env.maxTouchPoints ?? 0) > 1) return false;
  return /Macintosh|Mac OS X/i.test(env.userAgent) || env.platform === "macOS";
}

/**
 * UA-CH yüksek entropili mimari (`getHighEntropyValues(["architecture","bitness"])`). Chromium'un indirgenmiş UA'sı ARM
 * Linux'ta da "X11; Linux x86_64" yazar; gerçek mimari yalnız buradan gelir. `undefined` = tarayıcı UA-CH sunmuyor (Firefox).
 */
export interface UaArch {
  architecture?: string | undefined;
  bitness?: string | undefined;
}

/**
 * P28g (mimari-p28g §9, AC-403, AC-27): Linux x86_64 masaüstü (Ubuntu GNOME istemcisi sunulabilir). UA "Linux x86_64"
 * (ya da "amd64") taşımalı; Android, ChromeOS (CrOS), `aarch64`/`armv*`/`i686`, mobil UA, UA-CH mobile=true ve Linux dışı
 * UA-CH `platform` değil. `arch` verilmişse (Chromium UA-CH) `architecture=x86` + `bitness=64` olmalı; `null` = okuma
 * başarısız → fail-closed. Windows/Mac yüklemleriyle karşılıklı dışlar.
 */
export function isLinuxDesktop(env: Pick<SupportEnv, "uaMobile" | "userAgent" | "platform">, arch?: UaArch | null): boolean {
  const ua = env.userAgent;
  if (env.uaMobile === true || MOBILE_UA.test(ua) || /Android|CrOS|Windows NT|Macintosh/i.test(ua)) return false;
  if (env.platform !== undefined && env.platform !== "Linux") return false;
  if (!/\bLinux (x86_64|amd64)\b/i.test(ua) || /\b(aarch64|arm(v\d+l?|64)?|i[3-6]86)\b/i.test(ua)) return false;
  if (arch === null) return false;
  if (arch === undefined) return true;
  return arch.architecture === "x86" && arch.bitness === "64";
}

/**
 * UA-CH mimarisini okur (yalnız istemcide). UA-CH yoksa `undefined` (UA'ya güvenilir), okuma reddedilir/hata verirse `null`.
 */
export async function readUaArch(): Promise<UaArch | null | undefined> {
  const ua = (navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<UaArch> } }).userAgentData;
  if (typeof ua?.getHighEntropyValues !== "function") return undefined;
  try {
    const v = await ua.getHighEntropyValues(["architecture", "bitness"]);
    return { architecture: v.architecture, bitness: v.bitness };
  } catch {
    return null;
  }
}

/** İndirilebilir Hızlı Destek istemcisinin işletim sistemi (contracts `AGENT_DOWNLOAD_OS`, mimari-p28f §4.1). */
export type AgentOs = AgentDownloadOs;

/**
 * Bu cihaz için istemci işletim sistemi; masaüstü Windows/macOS/Linux x86_64 değilse `null` (yalnız tarayıcı modu).
 * Linux'ta UA-CH mimarisi eşzamansızdır; `useAgentOffer` onu availability ile birlikte denetler.
 */
export function agentOsOf(env: Pick<SupportEnv, "uaMobile" | "userAgent" | "platform" | "maxTouchPoints">): AgentOs | null {
  if (isWindowsDesktop(env)) return "windows";
  if (isLinuxDesktop(env)) return "linux";
  return isMacDesktop(env) ? "macos" : null;
}

/** Tarayıcıdan ortam bilgisini okur (yalnız istemcide çağrılır). */
export function readSupportEnv(): SupportEnv {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean; platform?: string } };
  const mq = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
  return {
    hasDisplayMedia: typeof nav.mediaDevices?.getDisplayMedia === "function",
    uaMobile: nav.userAgentData?.mobile,
    coarseOnly: mq("(pointer: coarse)") && !mq("(any-pointer: fine)"),
    userAgent: nav.userAgent,
    platform: nav.userAgentData?.platform,
    maxTouchPoints: nav.maxTouchPoints,
  };
}
