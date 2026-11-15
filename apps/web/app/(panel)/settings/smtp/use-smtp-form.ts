"use client";

import { useEffect, useMemo, useState, type FormEvent, type RefObject } from "react";
import { useUnauthRedirect } from "@/components/settings/use-unauth";
import { useToast } from "@/components/ui/toast";
import type { SmtpSecurity, SmtpSettingsView, TenantSettingsView } from "@/lib/account/contract";
import {
  buildSmtpInput,
  smtpCredsAllowed,
  smtpDirty,
  smtpServerFields,
  suggestPort,
  toSmtpState,
  type SmtpField,
  type SmtpState,
} from "@/lib/account/smtp-form";
import { api, ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

type Errors = Partial<Record<SmtpField, string>>;

/** 400 yanıtı → alan hataları / genel hata (HOST_NOT_ALLOWED sunucu alanına). Odak taşıması çağıranda. */
function apply400(err: ApiError, setErrors: (e: Errors) => void, setFormError: (e: UiError) => void) {
  if (err.code === "HOST_NOT_ALLOWED") setErrors({ host: err.message || t("smtp.hostNotAllowed") });
  else if (err.fields) {
    const { errors: fe, rest } = smtpServerFields(err.fields);
    setErrors(fe);
    if (rest.length) setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
  } else setFormError(toUiError(err));
}

/** Form alanları, hatalar, kirlilik ve hata alanına odak (`focusErr` sayacı artınca ilk geçersiz alan). */
function useSmtpState(initial: SmtpSettingsView | null, formRef: RefObject<HTMLFormElement | null>) {
  const [saved, setSaved] = useState(initial);
  const base = useMemo(() => toSmtpState(saved), [saved]);
  const [st, setSt] = useState<SmtpState>(base);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [focusErr, setFocusErr] = useState(0);
  const dirty = smtpDirty(st, base);

  useEffect(() => {
    if (focusErr) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusErr, formRef]);

  const reset = () => {
    setSt(base);
    setErrors({});
    setFormError(null);
  };
  const focusError = () => setFocusErr((n) => n + 1);
  const state = { saved, setSaved, st, setSt, errors, setErrors, formError, setFormError, busy, setBusy };
  return { ...state, confirmClear, setConfirmClear, testOpen, setTestOpen, dirty, reset, focusError };
}

/** Alan değişimi (alan hatası temizlenir) ve güvenlik seçimi (port önerisi; "Yok" → kimlik alanı hataları temizlenir). */
function useSmtpEdit({ setSt, setErrors }: Pick<ReturnType<typeof useSmtpState>, "setSt" | "setErrors">) {
  const set = (k: keyof SmtpState) => (e: { target: { value: string } }) => {
    setSt((s) => ({ ...s, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const setSecurity = (security: SmtpSecurity) => {
    setSt((s) => ({ ...s, security, port: suggestPort(s.port, security) }));
    setErrors((x) => ({
      ...x,
      security: undefined,
      port: undefined,
      ...(smtpCredsAllowed(security) ? {} : { user: undefined, password: undefined }),
    }));
  };
  return { set, setSecurity };
}

/** PUT /settings/tenant `{ smtp }` (`null` = temizle). */
function useSmtpPut(s: ReturnType<typeof useSmtpState>) {
  const unauth = useUnauthRedirect();
  const toast = useToast();
  return async (smtp: unknown) => {
    s.setBusy(true);
    s.setFormError(null);
    try {
      const r = await api<TenantSettingsView>("PUT", "/settings/tenant", { smtp });
      s.setSaved(r.smtp);
      s.setSt(toSmtpState(r.smtp));
      s.setErrors({});
      toast(t(r.smtp ? "smtp.saved" : "smtp.cleared"));
      s.setConfirmClear(false);
    } catch (err) {
      if (unauth(err)) return;
      s.setConfirmClear(false);
      if (err instanceof ApiError && err.status === 400) {
        apply400(err, s.setErrors, s.setFormError);
        s.focusError();
      } else s.setFormError(toUiError(err));
    } finally {
      s.setBusy(false);
    }
  };
}

/** SMTP formu: alanlar, kaydet (boşaltılmışsa temizleme onayı), "Ayarları temizle", hata alanına odak. */
export function useSmtpForm(initial: SmtpSettingsView | null, canEdit: boolean, formRef: RefObject<HTMLFormElement | null>) {
  const s = useSmtpState(initial, formRef);
  const edit = useSmtpEdit(s);
  const put = useSmtpPut(s);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit || s.busy) return;
    const r = buildSmtpInput(s.st);
    if (r.input === undefined) {
      s.setErrors(r.errors);
      s.focusError();
      return;
    }
    if (r.input === null) {
      if (!s.saved) return s.reset();
      s.setConfirmClear(true);
      return;
    }
    void put(r.input);
  };
  const askClear = () => {
    s.setSt({ ...toSmtpState(null), port: "" });
    s.setConfirmClear(true);
  };
  const cancelClear = () => {
    s.setConfirmClear(false);
    s.reset();
  };
  return { ...s, ...edit, put, submit, askClear, cancelClear };
}
