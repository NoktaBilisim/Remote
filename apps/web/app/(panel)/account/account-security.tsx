"use client";

import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ChangePasswordForm } from "@/app/(auth)/change-password/change-password-form";
import { RecoveryRegenerate } from "@/components/account/recovery-regenerate";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RECOVERY_LOW, type LogoutAllResponse, type MfaStatus } from "@/lib/account/contract";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

function Section({ id, title, Icon, children }: { id: string; title: string; Icon: typeof KeyRound; children: ReactNode }) {
  return (
    <section
      aria-labelledby={`${id}-h`}
      className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6"
      data-testid={`acc-${id}`}
    >
      <h2 id={`${id}-h`} className="flex items-center gap-2 text-base font-semibold text-fg">
        <Icon aria-hidden className="size-5 text-fg-muted" />
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * Hesap güvenliği bölümleri: şifre değiştir (AC-66), 2FA durumu (AC-67), tüm cihazlardan çıkış (AC-68/115 — onaylı,
 * yıkıcı; bu oturum açık kalır, diğerleri ve açık destek oturumları ≤ 5 sn'de kapanır), kurtarma kodlarını yenile (P15, AC-231).
 */
export function AccountSecurity({ mfa, account }: { mfa: MfaStatus | null; account: string }) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const logoutAll = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<LogoutAllResponse | undefined>("POST", "/auth/logout-all", {});
      setConfirm(false);
      toast(t("acc.la.done", { n: r?.revokedSessions ?? 0 }));
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setError(toUiError(e));
    } finally {
      setBusy(false);
    }
  };

  const left = mfa?.recoveryCodesLeft ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Section id="pw" title={t("acc.pw")} Icon={KeyRound}>
        <p className="text-sm text-fg-muted">{t("acc.pwBody")}</p>
        <div className="max-w-md">
          <ChangePasswordForm onDone={() => toast(t("acc.pwDone"))} />
        </div>
      </Section>

      <Section id="mfa" title={t("acc.mfa")} Icon={ShieldCheck}>
        {mfa?.enabled ? (
          <>
            <p className="flex items-center gap-2 text-sm font-medium text-success" data-testid="acc-mfa-on">
              <ShieldCheck aria-hidden className="size-4" />
              {t("acc.mfaOn")}
            </p>
            <p className="text-sm text-fg-muted" data-testid="acc-rc-left">
              {t("acc.rcLeft", { n: left })}
            </p>
            {left <= RECOVERY_LOW && (
              <Alert tone="warning" testId="acc-rc-low">
                {t("acc.rcLow")}
              </Alert>
            )}
            {/* P15 (AC-231): yeni 10 kod, eskiler geçersizleşir */}
            <RecoveryRegenerate account={account} />
            <p className="text-sm text-fg-muted">{t(mfa.required ? "acc.mfaRequiredNote" : "acc.mfaResetNote")}</p>
          </>
        ) : (
          <>
            <p className="text-sm text-fg-muted" data-testid="acc-mfa-off">
              {t("acc.mfaOff")}
            </p>
            <Link
              href="/2fa/setup"
              className="inline-flex min-h-11 items-center gap-2 self-start rounded-md bg-primary px-4 text-sm font-medium text-on-primary shadow-sm hover:bg-primary-hover active:scale-[0.97]"
              data-testid="acc-mfa-setup"
            >
              <ShieldCheck aria-hidden className="size-4" />
              {t("acc.mfaSetup")}
            </Link>
          </>
        )}
      </Section>

      <Section id="sessions" title={t("acc.la")} Icon={MonitorSmartphone}>
        <p className="text-sm text-fg-muted">{t("acc.laBody")}</p>
        <Button variant="danger-ghost" className="self-start" onClick={() => setConfirm(true)} data-testid="acc-logout-all">
          <LogOut aria-hidden className="size-4" />
          {t("acc.laButton")}
        </Button>
      </Section>

      <Dialog
        open={confirm}
        onClose={() => !busy && (setConfirm(false), setError(null))}
        role="alertdialog"
        size="sm"
        testId="logout-all-dialog"
        title={t("acc.la.title")}
        description={t("acc.la.body")}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirm(false)} disabled={busy} className="sm:ml-auto">
              {t("rq.rj.cancel")}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void logoutAll()} data-testid="logout-all-confirm">
              {!busy && <LogOut aria-hidden className="size-4" />}
              {t("acc.la.confirm")}
            </Button>
          </>
        }
      >
        {error && <FormError error={error} />}
      </Dialog>
    </div>
  );
}
