import { t } from "@/lib/i18n";

/*
 * Sekme başlığı önekleri (P13b-L, mimari-lobi §6.6, AC-308). Lobi ("(n) Müşteri bekliyor — ") ve destek talebi ("(n) ")
 * önekleri TEK yazıcıdan (`components/tab-title.tsx`) geçer; iki ayrı yazıcı birbirinin önekini silerdi. Bu dosya saf
 * fonksiyonlar + küçük modül deposudur (bileşen ve bildiriciler arasında).
 */
export type TitlePart = "lobby" | "requests";
export interface TitleParts {
  lobby: number;
  requests: number;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** i18n kalıbından: "({n}) Müşteri bekliyor — " → /^\(\d+\) Müşteri bekliyor — / */
const LOBBY_PREFIX = new RegExp("^" + escapeRe(t("s.lobby.titlePrefix")).replace("\\{n\\}", "\\d+"));
const REQUESTS_PREFIX = /^\(\d+\) /;
/** Konsol kendi okunmamış sohbet önekini kullanır (DESIGN §8): orada önek yazılmaz, silinmez. */
export const isConsolePath = (pathname: string) => /\/console$/.test(pathname);

/** Önce lobi, sonra talep önekini siler (sıra önemli: lobi öneki de "(n) " ile başlar). */
export function stripPrefixes(title: string): string {
  return title.replace(LOBBY_PREFIX, "").replace(REQUESTS_PREFIX, "");
}

/** Sıra AC-308: lobi öneki önce, talep öneki ardından. */
export function composeTitle(base: string, parts: TitleParts): string {
  const lobby = parts.lobby > 0 ? t("s.lobby.titlePrefix", { n: parts.lobby }) : "";
  const requests = parts.requests > 0 ? `(${parts.requests}) ` : "";
  return lobby + requests + base;
}

/** Mevcut başlığa önekleri uygular (idempotent); konsolda başlığa dokunulmaz. */
export function applyTitle(title: string, parts: TitleParts, pathname: string): string {
  if (isConsolePath(pathname)) return title;
  return composeTitle(stripPrefixes(title), parts);
}

// --- Modül deposu: bildiriciler sayıyı yazar, <TabTitle /> okur ---
export const NO_PARTS: TitleParts = { lobby: 0, requests: 0 };
let parts: TitleParts = NO_PARTS;
const listeners = new Set<() => void>();

export function setTitlePart(part: TitlePart, n: number): void {
  const v = Math.max(0, Math.floor(n));
  if (parts[part] === v) return;
  parts = { ...parts, [part]: v };
  listeners.forEach((fn) => fn());
}
export const getTitleParts = (): TitleParts => parts;
export function subscribeTitleParts(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
