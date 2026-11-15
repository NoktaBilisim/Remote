"use client";

import { useState, type FormEvent } from "react";
import { useUnauthRedirect } from "@/components/settings/use-unauth";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import type { SupportRequestSettings } from "@/lib/requests/contract";
import { copyText } from "@/lib/use-now";
import { buildInput, isDirty, toState, type SettingsState } from "@/lib/requests/settings-form";

/** Sunucu 400 `fields` → aynı yollarla alan hataları (`msg:` öneki: metin olduğu gibi gösterilir). */
const serverErrors = (fields: Record<string, string>) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, `msg:${v}`]));

/** Ayar formu durumu + kaydet / geri al. */
export function useSettingsForm(initial: SupportRequestSettings) {
  const unauth = useUnauthRedirect();
  const toast = useToast();
  const s = useSettingsState(initial);
  const { st, saved, setSaved, setSt, setErrors, setFormError, setSaving } = s;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const { input, errors: errs } = buildInput(st, saved.email);
    setErrors(errs);
    setFormError(null);
    if (!input) {
      setFormError({ message: t("srs.fixErrors"), tone: "danger" });
      return;
    }
    setSaving(true);
    try {
      const next = await api<SupportRequestSettings>("PUT", "/settings/support-requests", input);
      setSaved(next);
      setSt(toState(next));
      toast(t("srs.saved"));
    } catch (err) {
      if (unauth(err)) return;
      if (err instanceof ApiError && err.status === 400 && err.fields) {
        setErrors(serverErrors(err.fields));
        setFormError({ message: t("srs.fixErrors"), tone: "danger" });
      } else setFormError(toUiError(err));
    } finally {
      setSaving(false);
    }
  };
  return { ...s, unauth, save };
}

function useSettingsState(initial: SupportRequestSettings) {
  const [saved, setSaved] = useState(initial);
  const [st, setSt] = useState<SettingsState>(() => toState(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = isDirty(st, toState(saved));
  const set = (patch: Partial<SettingsState>) => setSt((s) => ({ ...s, ...patch }));

  const revert = () => {
    setSt(toState(saved));
    setErrors({});
    setFormError(null);
  };
  return { saved, setSaved, st, setSt, set, errors, setErrors, formError, setFormError, saving, setSaving, dirty, revert };
}

export type SettingsCtx = Pick<ReturnType<typeof useSettingsForm>, "st" | "set" | "errors" | "saving" | "saved">;

/** İndirme bağlantısını yenile (eski ref geçersiz): onay diyaloğu durumu + POST rotate-ref. */
export function useRotateRef(setSaved: ReturnType<typeof useSettingsForm>["setSaved"], unauth: (e: unknown) => boolean) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const rotate = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api<SupportRequestSettings>("POST", "/settings/support-requests/rotate-ref", {});
      setSaved((s) => ({
        ...s,
        downloadUrl: next.downloadUrl,
        fileName: next.fileName,
        refPrefix: next.refPrefix,
        refRotatedAt: next.refRotatedAt,
        webFormUrl: next.webFormUrl,
      }));
      setOpen(false);
      toast(t("srs.dl.rotated"));
    } catch (err) {
      if (!unauth(err)) setError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };
  return { open, setOpen, busy, error, rotate };
}

/** Adresi panoya kopyala + sonuç bildirimi (varsayılan: indirme bağlantısı). */
export function useCopyUrl(downloadUrl: string) {
  const toast = useToast();
  return async (url = downloadUrl) => {
    const ok = await copyText(url);
    toast(ok ? t("srs.dl.copied") : t("srs.dl.copyFailed"), ok ? "success" : "danger");
  };
}
