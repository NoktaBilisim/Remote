import { loginInputSchema, passwordChangeInputSchema, PASSWORD_MIN } from "@remote/contracts/api/auth";
import type { z } from "zod";
import { t } from "@/lib/i18n";

/*
 * Form doğrulaması @remote/contracts şemalarıyla (sunucuyla aynı kural).
 * Burada yalnız zod hatalarının Türkçe alan mesajlarına çevrilmesi ve
 * arayüze özgü "şifre tekrar" kontrolü var.
 */
export { loginInputSchema as loginInput };
export type { LoginResponse as LoginResult, MeResponse as MeResult } from "@remote/contracts/api/auth";

function message(field: string, issue: z.core.$ZodIssue): string {
  if (issue.code === "too_small") {
    if (issue.minimum === 1) return t("v.required");
    if (field === "login") return t("v.loginLength");
    if (issue.minimum === PASSWORD_MIN) return t("v.passwordMin");
  }
  if (issue.code === "too_big") return field === "login" ? t("v.loginLength") : t("v.passwordMax");
  if (issue.code === "custom") return field === "next" ? t("v.passwordSame") : issue.message;
  if (issue.code === "invalid_type") return t("v.required");
  return issue.message;
}

/** zod hatasını alan → ilk Türkçe mesaj sözlüğüne çevirir (alan bazlı gösterim için). */
export function fieldErrors(error: z.ZodError, data: Record<string, unknown> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    const empty = typeof data[key] !== "string" || String(data[key]).trim() === "";
    if (key && !out[key]) out[key] = empty ? t("v.required") : message(key, issue);
  }
  return out;
}

/** Şifre değiştirme formu: sözleşme şeması + yalnız arayüzdeki "tekrar" alanı. */
export function parsePasswordChange(
  data: Record<string, unknown>,
): { ok: true; value: { current: string; next: string } } | { ok: false; errors: Record<string, string> } {
  const parsed = passwordChangeInputSchema.safeParse({ current: data.current, next: data.next });
  const errors = parsed.success ? {} : fieldErrors(parsed.error, data);
  const confirm = typeof data.confirm === "string" ? data.confirm : "";
  if (!confirm) errors.confirm = t("v.required");
  else if (confirm !== data.next && !errors.next) errors.confirm = t("v.passwordMismatch");
  if (!parsed.success || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: parsed.data };
}

/** Şifre sıfırlama (P10, AC-66): yalnız yeni şifre + tekrar; kural sözleşmeyle aynı (12..200). */
export function parseNewPassword(
  data: Record<string, unknown>,
): { ok: true; value: string } | { ok: false; errors: Record<string, string> } {
  const next = typeof data.next === "string" ? data.next : "";
  const confirm = typeof data.confirm === "string" ? data.confirm : "";
  const errors: Record<string, string> = {};
  if (!next) errors.next = t("v.required");
  else if (next.length < PASSWORD_MIN) errors.next = t("v.passwordMin");
  else if (next.length > 200) errors.next = t("v.passwordMax");
  if (!confirm) errors.confirm = t("v.required");
  else if (confirm !== next && !errors.next) errors.confirm = t("v.passwordMismatch");
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: next };
}
