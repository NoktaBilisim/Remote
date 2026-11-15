"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type RefObject } from "react";
import { useToast } from "@/components/ui/toast";
import { TURN_SECRET_REQUIRED_MESSAGE, type TurnSettingsView } from "@/lib/admin-settings/contract";
import { buildTurnInput, needsTurnSecret, toTurnState, turnDirty, type TurnErrors, type TurnState } from "@/lib/admin-settings/forms";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

/** Sunucu `fields` (`urls.2`, `urls`, `secret`) → form hataları; satır indeksi gönderilen (boşsuz) listeye göredir. */
function serverErrors(fields: Record<string, string>, sentRows: number[]): { errors: TurnErrors; rest: string[] } {
  const errors: TurnErrors = {};
  const rest: string[] = [];
  for (const [k, msg] of Object.entries(fields)) {
    const m = /^urls\.(\d+)$/.exec(k);
    if (m) errors.url = { ...errors.url, [sentRows[Number(m[1])] ?? 0]: msg };
    else if (k === "urls") errors.urls = msg;
    else if (k === "secret") errors.secret = msg;
    else rest.push(msg);
  }
  return { errors, rest };
}

/** Kayıtlı görünüm + form durumu + hatalar; `adopt` sunucudan gelen görünümü forma yazar. */
function useTurnDraft(initial: TurnSettingsView) {
  const [saved, setSaved] = useState(initial);
  const base = useMemo(() => toTurnState(saved), [saved]);
  const [st, setSt] = useState<TurnState>(base);
  const [errors, setErrors] = useState<TurnErrors>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const reset = () => {
    setSt(base);
    setErrors({});
    setFormError(null);
  };
  const adopt = (v: TurnSettingsView) => {
    setSaved(v);
    setSt(toTurnState(v));
    setErrors({});
  };
  const setSecret = (v: string) => {
    setSt((s) => ({ ...s, secret: v }));
    setErrors((x) => ({ ...x, secret: undefined }));
  };
  const dirty = turnDirty(st, base);
  return { saved, st, setSt, errors, setErrors, formError, setFormError, reset, adopt, setSecret, dirty };
}
type Draft = ReturnType<typeof useTurnDraft>;

/** Adres satırları: düzenle / ekle / kaldır; ekleme-kaldırmadan sonra odak ilgili satıra (yoksa "Ekle"ye). */
function useTurnRows(d: Draft, formRef: RefObject<HTMLFormElement | null>, addRef: RefObject<HTMLButtonElement | null>) {
  const [focusRow, setFocusRow] = useState<{ row: number; n: number } | null>(null);
  useEffect(() => {
    if (focusRow === null) return;
    const inputs = formRef.current?.querySelectorAll<HTMLInputElement>('[data-testid="turn-url"]');
    if (inputs?.length) inputs[Math.min(focusRow.row, inputs.length - 1)]?.focus();
    else addRef.current?.focus();
  }, [focusRow, formRef, addRef]);

  const setUrl = (i: number, v: string) => {
    d.setSt((s) => ({ ...s, urls: s.urls.map((u, j) => (j === i ? v : u)) }));
    d.setErrors((x) => ({ ...x, urls: undefined, url: x.url ? { ...x.url, [i]: "" } : undefined }));
  };
  const addRow = () => {
    d.setSt((s) => ({ ...s, urls: [...s.urls, ""] }));
    setFocusRow((f) => ({ row: d.st.urls.length, n: (f?.n ?? 0) + 1 }));
  };
  const removeRow = (i: number) => {
    d.setSt((s) => ({ ...s, urls: s.urls.filter((_, j) => j !== i) }));
    d.setErrors({});
    setFocusRow((f) => ({ row: Math.max(0, i - 1), n: (f?.n ?? 0) + 1 }));
  };
  return { setUrl, addRow, removeRow };
}

/** İstemci doğrulaması: şema + "TURN adresi varken secret zorunlu" (kayıtlı secret yoksa). */
function validateTurn(d: Draft) {
  const r = buildTurnInput(d.st);
  const errs = { ...r.errors };
  if (r.input && needsTurnSecret(r.input.urls) && !r.input.secret && !d.saved.hasSecret) errs.secret = TURN_SECRET_REQUIRED_MESSAGE;
  return { input: r.input, errs };
}

/** PUT kaydı; 400 `fields` → satır/alan hataları (indeks gönderilen boşsuz listeye göre). */
function useTurnSave(d: Draft, busy: boolean, setBusy: (v: boolean) => void, focusError: () => void) {
  const router = useRouter();
  const toast = useToast();
  return async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const { input, errs } = validateTurn(d);
    if (!input || errs.secret) {
      d.setErrors(errs);
      focusError();
      return;
    }
    const sentRows = d.st.urls
      .map((u, i) => ({ u: u.trim(), i }))
      .filter((x) => x.u !== "")
      .map((x) => x.i);
    setBusy(true);
    d.setFormError(null);
    try {
      d.adopt(await api<TurnSettingsView>("PUT", "/admin/settings/turn", input));
      toast(t("tu.saved"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.status === 400 && err.fields) {
        const { errors: fe, rest } = serverErrors(err.fields, sentRows);
        d.setErrors(fe);
        if (rest.length) d.setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
        focusError();
      } else d.setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };
}

/** "Ortam değerlerine dön": DELETE + güncel (env) görünümü yeniden al; onay diyaloğu durumu. */
function useTurnReset(d: Draft, setBusy: (v: boolean) => void) {
  const router = useRouter();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const doReset = async () => {
    setBusy(true);
    d.setFormError(null);
    try {
      await api<unknown>("DELETE", "/admin/settings/turn");
      // DELETE yanıtı gövdesiz olabilir → güncel (env) görünümü yeniden al
      d.adopt(await api<TurnSettingsView>("GET", "/admin/settings/turn"));
      setConfirmReset(false);
      toast(t("tu.resetDone"));
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

/** TURN ayar formunun durumu ve eylemleri; `focusError` ve ref'ler bileşenden gelir (React Compiler `refs`). */
export function useTurnForm(
  initial: TurnSettingsView,
  focusError: () => void,
  formRef: RefObject<HTMLFormElement | null>,
  addRef: RefObject<HTMLButtonElement | null>,
) {
  const d = useTurnDraft(initial);
  const [busy, setBusy] = useState(false);
  const rows = useTurnRows(d, formRef, addRef);
  const submit = useTurnSave(d, busy, setBusy, focusError);
  const rst = useTurnReset(d, setBusy);
  return { ...d, ...rows, ...rst, busy, submit };
}
export type TurnFormState = ReturnType<typeof useTurnForm>;
