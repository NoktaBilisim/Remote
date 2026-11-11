/**
 * AC-33: tarayıcı modu yalnız masaüstü tarayıcıda desteklenir. Ekran paylaşımı API'si yoksa veya cihaz
 * mobilse (UA-CH `mobile`, ince işaretçisi olmayan dokunmatik cihaz veya mobil UA) "desteklenmiyor" ekranı gösterilir.
 */
export interface SupportEnv {
  hasDisplayMedia: boolean;
  uaMobile: boolean | undefined;
  coarseOnly: boolean;
  userAgent: string;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;

export function isScreenShareSupported(env: SupportEnv): boolean {
  if (!env.hasDisplayMedia) return false;
  if (env.uaMobile === true || env.coarseOnly) return false;
  return !MOBILE_UA.test(env.userAgent);
}

/**
 * AC-27: "Hızlı Destek" indirme seçeneği yalnız Windows masaüstünde sunulur (macOS/Linux/mobilde yalnız tarayıcı modu).
 * Windows'ta Chrome/Edge/Firefox UA'sı (UA indirgemesinde de) "Windows NT" taşır; mobil UA ve UA-CH mobile=true hariç.
 */
export function isWindowsDesktop(env: Pick<SupportEnv, "uaMobile" | "userAgent">): boolean {
  if (env.uaMobile === true) return false;
  return /Windows NT/i.test(env.userAgent) && !MOBILE_UA.test(env.userAgent);
}

/** Tarayıcıdan ortam bilgisini okur (yalnız istemcide çağrılır). */
export function readSupportEnv(): SupportEnv {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  const mq = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
  return {
    hasDisplayMedia: typeof nav.mediaDevices?.getDisplayMedia === "function",
    uaMobile: nav.userAgentData?.mobile,
    coarseOnly: mq("(pointer: coarse)") && !mq("(any-pointer: fine)"),
    userAgent: nav.userAgent,
  };
}
