"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type RefObject } from "react";
import { useToast } from "@/components/ui/toast";
import {
  CONSENT_BODY_MAX,
  CONSENT_BODY_MIN,
  consentTextInputSchema,
  type ConsentTextSaveResponse,
  type ConsentTextSettings,
} from "@/lib/admin-settings/contract";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

/** Sunucuyla aynı sayım: CRLF → LF, uçlar kırpılmış, kod noktası. */
const consentLength = (v: string): number => [...v.replace(/\r\n?/g, "\n").trim()].length;

type AreaRef = RefObject<HTMLTextAreaElement | null>;

/** Kayıt hatası → form üstü hata (409 çakışma, 429 sınır) veya alan hatası (400 `body`). Metin her durumda korunur. */
function saveFailure(err: unknown, setError: (m?: string) => void, areaRef: AreaRef): UiError | null {
  if (err instanceof ApiError && err.status === 409) {
    // Eşzamanlı kayıt (409): yazılan metin kaybolmasın diye form korunur; kullanıcı yenileyip güncel sürümü görür
    return { message: t("ct.conflict"), tone: "danger", requestId: err.requestId };
  }
  if (err instanceof ApiError && err.status === 429) {
    // Tenant başına 10 yeni sürüm/saat (B-P11-6): metin korunur, süre Retry-After'dan dakikaya yuvarlanır
    const minutes = err.retryAfter ? Math.max(1, Math.ceil(err.retryAfter / 60)) : null;
    return { message: minutes ? t("ct.rateLimited", { minutes }) : t("ct.rateLimitedNoTime"), tone: "locked" };
  }
  if (err instanceof ApiError && err.status === 400 && err.fields?.body) {
    setError(err.fields.body);
    areaRef.current?.focus();
    return null;
  }
  return toUiError(err);
}

/** Gövde, kayıtlı veri, hatalar, onay ve meşgul durumu. */
function useConsentDraft(initial: ConsentTextSettings) {
  const [data, setData] = useState(initial);
  const base = data.current?.body ?? "";
  const [body, setBody] = useState(base);
  const [error, setError] = useState<string>();
  const [formError, setFormError] = useState<UiError | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const changeBody = (v: string) => {
    setBody(v);
    setError(undefined);
  };
  const reset = () => {
    setBody(base);
    setError(undefined);
  };
  return {
    ...{ data, setData, base, body, setBody, error, setError, formError, setFormError },
    ...{ confirm, setConfirm, busy, setBusy, changeBody, reset },
  };
}
type Draft = ReturnType<typeof useConsentDraft>;

/** Onaydan sonra PUT; değişmeyen gövde sürüm üretmez (`changed:false` → bilgi bildirimi). */
function useConsentSave(d: Draft, areaRef: AreaRef) {
  const router = useRouter();
  const toast = useToast();
  return async () => {
    d.setBusy(true);
    d.setFormError(null);
    try {
      const r = await api<ConsentTextSaveResponse>("PUT", "/settings/consent-text", { body: d.body });
      d.setData({ current: r.current, versions: r.versions });
      d.setBody(r.current?.body ?? d.body);
      d.setConfirm(false);
      if (r.changed && r.current) toast(t("ct.saved", { n: r.current.version }));
      else toast(t("ct.unchanged"), "info");
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      d.setConfirm(false);
      const fe = saveFailure(err, d.setError, areaRef);
      if (fe) d.setFormError(fe);
    } finally {
      d.setBusy(false);
    }
  };
}

/**
 * Aydınlatma metni formunun durumu: gövde, sayaç, onay diyaloğu, PUT kaydı. `areaRef` bileşenden gelir
 * (React Compiler `refs`); odak eskisi gibi olay işleyicisinde, senkron.
 */
export function useConsentForm(initial: ConsentTextSettings, canEdit: boolean, areaRef: AreaRef) {
  const d = useConsentDraft(initial);
  const save = useConsentSave(d, areaRef);
  const len = consentLength(d.body);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit || d.busy) return;
    const p = consentTextInputSchema.safeParse({ body: d.body });
    if (!p.success) {
      d.setError(p.error.issues[0]?.message);
      areaRef.current?.focus();
      return;
    }
    d.setError(undefined);
    d.setConfirm(true);
  };
  return {
    ...d,
    ...{ submit, save, len },
    dirty: canEdit && d.body !== d.base,
    outOfRange: len < CONSENT_BODY_MIN || len > CONSENT_BODY_MAX,
  };
}
export type ConsentFormState = ReturnType<typeof useConsentForm>;
