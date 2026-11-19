/*
 * P21 K6 panel "Portal hesapları" (mimari-p21 §4.3, §6) — saf yardımcılar (testli): oluşturma doğrulaması, oluşturma
 * düğmesinin durumu, satır rozetleri. Geçici şifre YALNIZ diyalog durumunda tutulur, burada değil.
 */
import {
  PORTAL_ACCOUNTS_PER_CUSTOMER_MAX,
  portalAccountCreateInputSchema,
  type PortalAccountCreateInput,
  type PortalAccountItem,
} from "@remote/contracts/api/portal";
import { t } from "@/lib/i18n";

export function validateAccount(raw: { email: string; fullName: string }): {
  body?: PortalAccountCreateInput;
  errors: Record<string, string>;
} {
  const r = portalAccountCreateInputSchema.safeParse(raw);
  if (r.success) return { body: r.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? "form");
    const empty = (raw as Record<string, string>)[k]?.trim() === "";
    errors[k] ??= empty ? t("v.required") : i.message;
  }
  return { errors };
}

/** "Hesap oluştur": müşteri aktif ve anonim değil + 20 sınırı (K-P21-11). `reason` null → açık. */
export function createState(customerActive: boolean, count: number): { enabled: boolean; reason: string | null } {
  if (!customerActive) return { enabled: false, reason: t("pa.passiveCustomer") };
  if (count >= PORTAL_ACCOUNTS_PER_CUSTOMER_MAX) return { enabled: false, reason: t("pa.limit", { n: PORTAL_ACCOUNTS_PER_CUSTOMER_MAX }) };
  return { enabled: true, reason: null };
}

export type AccountBadge = "mfa" | "mustChange" | "tempExpired";

/** Satır rozetleri: 2FA açık; geçici şifre süresi doldu (r2 S-P21-5) "değişim bekliyor"un yerine geçer; pasif hesapta yok. */
export function accountBadges(
  a: Pick<PortalAccountItem, "status" | "totpEnabled" | "mustChangePassword" | "tempPasswordExpired">,
): AccountBadge[] {
  const out: AccountBadge[] = [];
  if (a.totpEnabled) out.push("mfa");
  if (a.status === "ACTIVE" && a.tempPasswordExpired) out.push("tempExpired");
  else if (a.status === "ACTIVE" && a.mustChangePassword) out.push("mustChange");
  return out;
}
