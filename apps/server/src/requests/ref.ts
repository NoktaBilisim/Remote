// Firma dosyası adı ve indirme bağlantısı (AC-129..131, mimari-e9 §3.1, ADR-0006 r4; P8c müşteri dosyası aynı biçim).
// P31 (mimari-p31 K-P31-1/3, §15.1; AC-509, AC-510): macOS'ta aynı ad `.zip` uzantısıyla (jenerik macOS zip'i).
import type { RequestClientOs } from "@remote/contracts/api/requests";
import { suggestFileLabel } from "@remote/contracts/api/customers";
/** Firma kısa adı (AC-130): P8c'de contracts `suggestFileLabel`'a taşındı (davranış aynı; web form önerisi de onu kullanır). */
export const fileLabelOf = suggestFileLabel;

/** Firma dosyası uzantısı platforma göre; kapı başına sabit (K-P31-3: uzantı ↔ kapı çaprazlanamaz). */
export type FirmFileExt = ".exe" | ".zip";
const FIRM_EXT: Readonly<Record<RequestClientOs, FirmFileExt>> = { windows: ".exe", macos: ".zip" };

/** Panel/müşteri görünümündeki `fileName` alanı varsayılan (Windows) adı taşır (mimari-p31 §3.1). */
export const requestFileName = (label: string, ref: string, os: RequestClientOs = "windows"): string =>
  `NoktaDestek-${label}-${ref}${FIRM_EXT[os]}`;

/** Caddy'nin jenerik ikiliyi sunduğu konum (P6 `@agentExe` / P31 `@agentZipFirm`; aynı ikili, AC-130, AC-510). */
export const requestDownloadLocation = (label: string, ref: string, os: RequestClientOs = "windows"): string =>
  `/downloads/${requestFileName(label, ref, os)}`;

export const requestDownloadUrl = (publicBaseUrl: string, ref: string): string =>
  `${publicBaseUrl.replace(/\/+$/, "")}/api/v1/public/agent/request-download?ref=${ref}`;

/**
 * P31 §15.1 adım 1: `macos-firm` iç ucuna iletilen yolun TAM firma zip deseni (büyük/küçük harf duyarlı, sorgu dizesi
 * yok). Eksik, `/downloads/***` (maskeli) ya da büyük harfli ref içeren yol eşleşmez → 404 (fail-closed).
 */
export const FIRM_ZIP_URI = /^\/downloads\/NoktaDestek-[A-Za-z0-9]{1,20}-[a-z2-7]{16}\.zip$/;

const FIRM_URI: Readonly<Record<FirmFileExt, RegExp>> = {
  ".exe": /^\/downloads\/NoktaDestek-([A-Za-z0-9]{1,20})-([a-z2-7]{16})\.exe$/,
  ".zip": /^\/downloads\/NoktaDestek-([A-Za-z0-9]{1,20})-([a-z2-7]{16})\.zip$/,
};

/**
 * forward_auth `X-Forwarded-Uri` (G-E9-11): `/downloads/NoktaDestek-<label>-<ref><ext>` → parçalar; değilse null. Uzantı
 * parametredir (P31 K-P31-3): `.exe` kapısı `.zip` yolunu, `.zip` kapısı `.exe` yolunu asla kabul etmez.
 */
export function parseFirmDownloadUri(uri: string, ext: FirmFileExt): { label: string; ref: string } | null {
  const path = uri.split("?")[0] ?? "";
  const m = FIRM_URI[ext].exec(path);
  return m?.[1] && m[2] ? { label: m[1], ref: m[2] } : null;
}
