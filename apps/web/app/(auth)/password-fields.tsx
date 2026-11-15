"use client";

import { KeyRound } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { t } from "@/lib/i18n";

/** İstemci doğrulamasından sonra sıradaki ilk hatalı alana (ada göre) odak. */
export function focusFirstField(formRef: RefObject<HTMLFormElement | null>, order: readonly string[], errors: Record<string, string>) {
  const first = order.find((k) => errors[k]);
  if (first) formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
}

/** Yeni şifre + tekrarı (şifre değiştirme ve sıfırlama formları). */
export function NewPasswordFields({ submitting, errors }: { submitting: boolean; errors: Record<string, string> }) {
  return (
    <>
      <TextField
        name="next"
        type="password"
        label={t("pw.next")}
        hint={t("pw.nextHint")}
        autoComplete="new-password"
        minLength={12}
        required
        revealable
        disabled={submitting}
        error={errors.next}
      />
      <TextField
        name="confirm"
        type="password"
        label={t("pw.confirm")}
        autoComplete="new-password"
        required
        revealable
        disabled={submitting}
        error={errors.confirm}
      />
    </>
  );
}

/** Şifre formu gönder düğmesi: gönderilirken "işleniyor" metni, değilse anahtar ikonu + `label`. */
export function PasswordSubmit({ submitting, label, testId }: { submitting: boolean; label: string; testId?: string }) {
  return (
    <Button type="submit" loading={submitting} className="mt-2 w-full" data-testid={testId}>
      {!submitting && <KeyRound aria-hidden className="size-4" />}
      {submitting ? t("pw.submitting") : label}
    </Button>
  );
}
