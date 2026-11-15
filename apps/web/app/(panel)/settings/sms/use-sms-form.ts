"use client";

import { SMS_API_KEY_REENTER, type SmsSettingsView } from "@remote/contracts/api/notify";
import { useState, type FormEvent } from "react";
import { useUnauthRedirect } from "@/components/settings/use-unauth";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import { buildSmsInput, smsDirty, smsToState, type SmsFormState } from "@/lib/notify/sms-form";

/** Kayıt hatası → alan hataları (400 `fields`; "anahtarı yeniden girin" yerel metne) / adres alanı / genel hata. */
function applyError(err: unknown, setErrors: (e: Record<string, string>) => void, setFormError: (e: UiError) => void) {
  if (err instanceof ApiError && err.status === 400 && err.fields && Object.keys(err.fields).length) {
    const f = { ...err.fields };
    if (f.apiKey === SMS_API_KEY_REENTER) f.apiKey = t("sms.keyReenter");
    setErrors(f);
    setFormError({ message: t("srs.fixErrors"), tone: "danger" });
  } else if (err instanceof ApiError && err.code === "HOST_NOT_ALLOWED") setErrors({ url: err.message || t("sms.hostNotAllowed") });
  else setFormError(toUiError(err));
}

/** SMS ayar formu durumu + kaydet / geri al. 400 `fields` alanlara, `HOST_NOT_ALLOWED` adres alanına düşer. */
export function useSmsForm(initial: SmsSettingsView) {
  const unauth = useUnauthRedirect();
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [st, setSt] = useState<SmsFormState>(() => smsToState(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const dirty = smsDirty(st, smsToState(saved));
  const set = (p: Partial<SmsFormState>) => setSt((s) => ({ ...s, ...p }));

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    const { input, errors: errs } = buildSmsInput(st);
    setErrors(errs);
    setFormError(null);
    if (!input) return setFormError({ message: t("srs.fixErrors"), tone: "danger" });
    setSaving(true);
    try {
      const next = await api<SmsSettingsView>("PUT", "/settings/sms", input);
      setSaved(next);
      setSt(smsToState(next));
      toast(t("sms.saved"));
    } catch (err) {
      if (unauth(err)) return;
      applyError(err, setErrors, setFormError);
    } finally {
      setSaving(false);
      setConfirmRemove(false);
    }
  };

  const revert = () => {
    setSt(smsToState(saved));
    setErrors({});
    setFormError(null);
  };
  return { unauth, saved, st, set, errors, formError, saving, confirmRemove, setConfirmRemove, dirty, save, revert };
}
