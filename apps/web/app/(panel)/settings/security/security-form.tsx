"use client";

import { MonitorX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { TenantSettingsView } from "@/lib/account/contract";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

type Key = "requireTech2fa" | "mfaRememberDevice";
const SAVED = {
  requireTech2fa: ["sec.savedOn", "sec.savedOff"],
  mfaRememberDevice: ["sec.rememberSavedOn", "sec.rememberSavedOff"],
} as const;

/**
 * Anahtar başına anında kayıt (kaydet çubuğu yok): PUT /settings/tenant `{ [key]: v }`; istek sürerken anahtarlar pasif,
 * hata olursa eski değere döner ve hata gösterilir.
 */
function useInstantSettings(initial: Record<Key, boolean>) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const change = async (key: Key, next: boolean) => {
    setValues((v) => ({ ...v, [key]: next }));
    setBusy(true);
    setError(null);
    try {
      const r = await api<TenantSettingsView>("PUT", "/settings/tenant", { [key]: next });
      const saved = r[key] ?? next;
      setValues((v) => ({ ...v, [key]: saved }));
      toast(t(SAVED[key][saved ? 0 : 1]));
      return true;
    } catch (e) {
      if (isUnauthenticated(e)) {
        router.replace(EXPIRED_LOGIN_PATH);
        return false;
      }
      setValues((v) => ({ ...v, [key]: !next }));
      setError(toUiError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { values, busy, error, change };
}

/** P27a (AC-331): kapatma yıkıcıdır (firmanın tüm hatırlanan cihazları silinir) → onay; odak "Vazgeç". */
function RememberOffDialog(p: { open: boolean; busy: boolean; error: UiError | null; onCancel: () => void; onConfirm: () => void }) {
  const { open, busy, onCancel, onConfirm } = p;
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onCancel()}
      role="alertdialog"
      size="sm"
      testId="remember-off-dialog"
      title={t("sec.rememberOffTitle")}
      description={t("sec.rememberOffConfirm")}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={onCancel} disabled={busy} className="sm:ml-auto">
            {t("rq.rj.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm} data-testid="remember-off-confirm">
            {!busy && <MonitorX aria-hidden className="size-4" />}
            {t("sec.rememberOffButton")}
          </Button>
        </>
      }
    >
      {p.error && <FormError error={p.error} />}
    </Dialog>
  );
}

/**
 * Ayarlar → Güvenlik → İki adımlı doğrulama: teknisyenler için zorunluluk (AC-67) ve P27a "2FA cihaz hatırlama"
 * (AC-331; varsayılan açık, Super Admin hesapları hariç). Admin/Super Admin için 2FA her zaman zorunludur.
 */
export function SecurityForm({ initial, canEdit }: { initial: Record<Key, boolean>; canEdit: boolean }) {
  const { values, busy, error, change } = useInstantSettings(initial);
  const [confirmOff, setConfirmOff] = useState(false);
  const onRemember = (v: boolean) => (v ? void change("mfaRememberDevice", true) : setConfirmOff(true));
  const turnOff = async () => {
    if (await change("mfaRememberDevice", false)) setConfirmOff(false);
  };
  return (
    <section
      aria-labelledby="sec-h"
      className="flex max-w-3xl flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6"
    >
      <h2 id="sec-h" className="text-base font-semibold text-fg">
        {t("sec.mfaTitle")}
      </h2>
      {!canEdit && (
        <Alert tone="warning" testId="settings-readonly">
          {t("set.readonly")}
        </Alert>
      )}
      {!confirmOff && <FormError error={error} />}
      <Switch
        label={t("sec.mfaLabel")}
        checked={values.requireTech2fa}
        onChange={(v) => void change("requireTech2fa", v)}
        disabled={!canEdit || busy}
        description={t("sec.mfaDesc")}
        onText={t("rq.on")}
        offText={t("rq.off")}
        testId="require-2fa-switch"
      />
      <Switch
        label={t("sec.rememberLabel")}
        checked={values.mfaRememberDevice}
        onChange={onRemember}
        disabled={!canEdit || busy}
        description={t("sec.rememberDesc")}
        onText={t("rq.on")}
        offText={t("rq.off")}
        testId="remember-device-switch"
      />
      <p className="text-sm text-fg-muted">{t("sec.adminNote")}</p>
      <RememberOffDialog
        open={confirmOff}
        busy={busy}
        error={error}
        onCancel={() => setConfirmOff(false)}
        onConfirm={() => void turnOff()}
      />
    </section>
  );
}
