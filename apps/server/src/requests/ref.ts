// Firma dosyası adı ve indirme bağlantısı (AC-129..131, mimari-e9 §3.1, ADR-0006 r4; P8c müşteri dosyası aynı biçim).
import { suggestFileLabel } from "@remote/contracts/api/customers";
/** Firma kısa adı (AC-130): P8c'de contracts `suggestFileLabel`'a taşındı (davranış aynı; web form önerisi de onu kullanır). */
export const fileLabelOf = suggestFileLabel;

export const requestFileName = (label: string, ref: string): string => `NoktaDestek-${label}-${ref}.exe`;

/** Caddy'nin jenerik ikiliyi sunduğu konum (P6 `@agentExe` genişler; aynı ikili, AC-130). */
export const requestDownloadLocation = (label: string, ref: string): string => `/downloads/${requestFileName(label, ref)}`;

export const requestDownloadUrl = (publicBaseUrl: string, ref: string): string =>
  `${publicBaseUrl.replace(/\/+$/, "")}/api/v1/public/agent/request-download?ref=${ref}`;

/** forward_auth `X-Forwarded-Uri` (G-E9-11): `/downloads/NoktaDestek-<label>-<ref>.exe` → parçalar; değilse null. */
export function parseFirmDownloadUri(uri: string): { label: string; ref: string } | null {
  const path = uri.split("?")[0] ?? "";
  const m = /^\/downloads\/NoktaDestek-([A-Za-z0-9]{1,20})-([a-z2-7]{16})\.exe$/.exec(path);
  return m?.[1] && m[2] ? { label: m[1], ref: m[2] } : null;
}
