import { mfaRecoveryCodesInputSchema, type MfaRecoveryCodesInput } from "@remote/contracts/api/auth";
import type { MessageKey } from "@/lib/i18n";

/** Kurtarma kodları indirme dosyası içeriği (düz metin, CRLF — Windows Not Defteri). Kodlar yalnız istemcide. */
export function recoveryFileText(
  codes: readonly string[],
  header: { title: string; account: string; note: string; createdAt: string },
): string {
  return [
    header.title,
    header.account,
    header.createdAt,
    "",
    ...codes.map((c, i) => `${String(i + 1).padStart(2, " ")}. ${c}`),
    "",
    header.note,
    "",
  ].join("\r\n");
}

/** Dosya adı: tarihli, kişisel veri yok. */
export const recoveryFileName = (day: string): string => `kurtarma-kodlari-${day}.txt`;

/**
 * P15 (AC-231): "Kurtarma kodlarını yenile" girdisi — yalnız TOTP (contracts `mfaRecoveryCodesInputSchema`). Boş/biçim
 * hatası istek atılmadan alan hatası olur.
 */
export function buildRecoveryRegenerate(raw: string): { body?: MfaRecoveryCodesInput; error?: MessageKey } {
  if (raw.trim() === "") return { error: "v.required" };
  const p = mfaRecoveryCodesInputSchema.safeParse({ code: raw.trim() });
  return p.success ? { body: p.data } : { error: "mfa.v.codeInvalid" };
}
