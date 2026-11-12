"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import type { TenantSettingsView } from "@/lib/account/contract";
import { api, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

/**
 * Tek ayar → anında kayıt (kaydet çubuğu yok): anahtar değişince PUT /settings/tenant `{ requireTech2fa }`; istek sürerken
 * anahtar pasif, hata olursa eski değere döner ve hata gösterilir. Admin/Super Admin için 2FA her zaman zorunludur.
 */
export function SecurityForm({ initial, canEdit }: { initial: boolean; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const change = async (next: boolean) => {
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      const r = await api<TenantSettingsView>("PUT", "/settings/tenant", { requireTech2fa: next });
      setValue(r.requireTech2fa);
      toast(t(r.requireTech2fa ? "sec.savedOn" : "sec.savedOff"));
    } catch (e) {
      if (isUnauthenticated(e)) return router.replace(EXPIRED_LOGIN_PATH);
      setValue(!next);
      setError(toUiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="sec-h" className="flex max-w-3xl flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
      <h2 id="sec-h" className="text-base font-semibold text-fg">{t("sec.mfaTitle")}</h2>
      {!canEdit && <Alert tone="warning" testId="settings-readonly">{t("set.readonly")}</Alert>}
      <FormError error={error} />
      <Switch
        label={t("sec.mfaLabel")}
        checked={value}
        onChange={(v) => void change(v)}
        disabled={!canEdit || busy}
        description={t("sec.mfaDesc")}
        onText={t("rq.on")}
        offText={t("rq.off")}
        testId="require-2fa-switch"
      />
      <p className="text-sm text-fg-muted">{t("sec.adminNote")}</p>
    </section>
  );
}
