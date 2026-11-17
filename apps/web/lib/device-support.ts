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

export function isScreenShareSupported(env: SupportEnv): boolean {
  if (!env.hasDisplayMedia) return false;
  if (env.uaMobile === true || env.coarseOnly) return false;
  return !MOBILE_UA.test(env.userAgent);
}

/**
 * AC-27: Windows masaüstü. macOS için `isMacDesktop` (P28f AC-396); Linux/mobilde yalnız tarayıcı modu.
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
  if ((env.maxTouchPoints ?? 0) > 1) return false;
  return /Macintosh|Mac OS X/i.test(env.userAgent) || env.platform === "macOS";
}

/** İndirilebilir Hızlı Destek istemcisinin işletim sistemi (contracts `AGENT_DOWNLOAD_OS`, mimari-p28f §4.1). */
export type AgentOs = AgentDownloadOs;

/** Bu cihaz için istemci işletim sistemi; masaüstü Windows/macOS değilse `null` (yalnız tarayıcı modu). */
export function agentOsOf(env: Pick<SupportEnv, "uaMobile" | "userAgent" | "platform" | "maxTouchPoints">): AgentOs | null {
  if (isWindowsDesktop(env)) return "windows";
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
