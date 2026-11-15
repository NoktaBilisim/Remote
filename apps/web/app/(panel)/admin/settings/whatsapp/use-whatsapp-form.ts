"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/toast";
import {
  checkWaApiKey,
  checkWaUrl,
  normalizeWaView,
  waDirty,
  waFieldValue,
  waKeyNeedsReenter,
  waServerFields,
  WA_API_KEY_REENTER,
  type WhatsappServiceView,
} from "@/lib/admin-settings/whatsapp";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

const PATH = "/admin/settings/whatsapp";

/** Kayıtlı görünüm + adres/anahtar alanları + hatalar; `apply` sunucudan gelen görünümü forma yazar. */
function useWaDraft(initial: WhatsappServiceView) {
  const [saved, setSaved] = useState(initial);
  const [url, setUrl] = useState(() => waFieldValue(initial));
  const [urlError, setUrlError] = useState<string>();
  const [formError, setFormError] = useState<UiError | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [keyError, setKeyError] = useState<string>();
  const apply = (v: WhatsappServiceView) => {
    setSaved(v);
    setUrl(waFieldValue(v));
    setUrlError(undefined);
    setApiKey("");
    setKeyError(undefined);
  };
  const reset = () => {
    setUrl(waFieldValue(saved));
    setUrlError(undefined);
    setApiKey("");
    setKeyError(undefined);
    setFormError(null);
  };
  const changeUrl = (v: string) => {
    setUrl(v);
    setUrlError(undefined);
  };
  const changeKey = (v: string) => {
    setApiKey(v);
    setKeyError(undefined);
  };
  const dirty = waDirty(url, saved) || apiKey !== "";
  return {
    ...{ saved, setSaved, url, urlError, setUrlError, formError, setFormError, apiKey, setApiKey, keyError, setKeyError },
    ...{ apply, reset, changeUrl, changeKey, dirty },
  };
}
type Draft = ReturnType<typeof useWaDraft>;
type Focus = { focusUrl: () => void; focusKey: () => void };

/** İstemci doğrulaması; hata varsa ilgili alana yazar ve odaklar, yoksa gönderilecek gövdeyi döner. */
function validateWa(d: Draft, f: Focus) {
  const c = checkWaUrl(d.url);
  if (!c.url) {
    d.setUrlError(c.error);
    f.focusUrl();
    return null;
  }
  const k = checkWaApiKey(d.apiKey);
  // Kayıtlı panel anahtarı eski adrese bağlı: kökeni (şema+host+port) değişirken yeni anahtar şart (istek gitmeden)
  if (!k.error && !k.apiKey && waKeyNeedsReenter(d.saved, c.url)) k.error = t("wa.svc.keyReenter");
  if (k.error) {
    d.setKeyError(k.error);
    f.focusKey();
    return null;
  }
  return k.apiKey ? { url: c.url, apiKey: k.apiKey } : { url: c.url };
}

/** 400 `fields` → adres / anahtar / form hataları; odak önce adrese, yoksa anahtara. */
function applyServerFields(d: Draft, f: Focus, fields: Record<string, string>, requestId: string | undefined) {
  const { apiKey: keyMsg, ...others } = fields;
  const { error, rest } = waServerFields(others, "url");
  d.setUrlError(error);
  d.setKeyError(keyMsg === WA_API_KEY_REENTER ? t("wa.svc.keyReenter") : keyMsg);
  if (rest.length) d.setFormError({ message: rest.join(" "), tone: "danger", requestId });
  if (error) f.focusUrl();
  else if (keyMsg) f.focusKey();
}

/** PUT kaydı (adres + varsa yeni anahtar). */
function useWaSave(d: Draft, f: Focus, busy: boolean, setBusy: (v: boolean) => void) {
  const router = useRouter();
  const toast = useToast();
  return async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const body = validateWa(d, f);
    if (!body) return;
    setBusy(true);
    d.setFormError(null);
    try {
      d.apply(normalizeWaView(await api<WhatsappServiceView>("PUT", PATH, body)));
      toast(t("wa.svc.saved"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.status === 400 && err.fields) applyServerFields(d, f, err.fields, err.requestId);
      else d.setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };
}

/** "Ortam değişkenine dön": DELETE (+ gövdesizse güncel env görünümü); onay diyaloğu durumu. */
function useWaReset(d: Draft, setBusy: (v: boolean) => void) {
  const router = useRouter();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const doReset = async () => {
    setBusy(true);
    d.setFormError(null);
    try {
      const r = await api<WhatsappServiceView | undefined>("DELETE", PATH);
      // DELETE yanıtı gövdesiz olabilir → güncel (env) görünümü yeniden al
      d.apply(normalizeWaView(r && typeof r === "object" && "source" in r ? r : await api<WhatsappServiceView>("GET", PATH)));
      setConfirmReset(false);
      toast(t("wa.svc.resetDone"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      setConfirmReset(false);
      d.setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };
  return { confirmReset, setConfirmReset, doReset };
}

/** Panel anahtarını kaldırma diyaloğu durumu ve sonuç geri çağrıları. */
function useWaKeyRemove(d: Draft) {
  const router = useRouter();
  const toast = useToast();
  const [confirmKeyRemove, setConfirmKeyRemove] = useState(false);
  const onKeyRemoved = (v: WhatsappServiceView) => {
    d.setSaved(v);
    d.setApiKey("");
    d.setKeyError(undefined);
    setConfirmKeyRemove(false);
    toast(t("wa.svc.keyRemoved"));
  };
  const onKeyRemoveFail = (err: unknown) => {
    setConfirmKeyRemove(false);
    if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
    d.setFormError(toUiError(err));
  };
  return { confirmKeyRemove, setConfirmKeyRemove, onKeyRemoved, onKeyRemoveFail };
}

/** WhatsApp servis formunun durumu ve eylemleri; odak işlevleri bileşenden gelir (React Compiler `refs`). */
export function useWhatsappForm(initial: WhatsappServiceView, focus: Focus) {
  const d = useWaDraft(initial);
  const [busy, setBusy] = useState(false);
  const submit = useWaSave(d, focus, busy, setBusy);
  const rst = useWaReset(d, setBusy);
  const keyRm = useWaKeyRemove(d);
  const configured = d.saved.url !== null;
  return { ...d, ...rst, ...keyRm, busy, setBusy, submit, configured, canTest: configured && !busy };
}
export type WhatsappFormState = ReturnType<typeof useWhatsappForm>;
