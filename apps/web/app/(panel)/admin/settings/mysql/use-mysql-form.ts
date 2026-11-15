"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/toast";
import {
  MYSQL_APPLY_NOTE,
  type MysqlSettingsSaveResponse,
  type MysqlSettingsView,
  type MysqlTestResponse,
} from "@/lib/admin-settings/contract";
import { buildMysqlInput, mysqlDirty, mysqlServerFields, toMysqlState, type MysqlField, type MysqlState } from "@/lib/admin-settings/forms";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";

export type TestResult = { tone: "success" | "danger" | "locked"; title: string; message: string; latencyMs?: number };

/** Kayıtlı görünüm + form durumu + alan/form hataları. */
function useMysqlDraft(initial: MysqlSettingsView) {
  const [saved, setSaved] = useState(initial);
  const base = useMemo(() => toMysqlState(saved), [saved]);
  const [st, setSt] = useState<MysqlState>(base);
  const [errors, setErrors] = useState<Partial<Record<MysqlField, string>>>({});
  const [formError, setFormError] = useState<UiError | null>(null);

  const set = (k: MysqlField) => (e: { target: { value: string } }) => {
    setSt((s) => ({ ...s, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const reset = () => {
    setSt(base);
    setErrors({});
    setFormError(null);
  };
  const dirty = mysqlDirty(st, base);
  return { saved, setSaved, st, setSt, errors, setErrors, formError, setFormError, set, reset, dirty };
}
type Draft = ReturnType<typeof useMysqlDraft>;

/** 400 → alan hataları (bağlanamayanlar form üstü); diğerleri form üstü. Geçersizse alan hatası + odak. */
function useMysqlErrors(d: Draft, focusError: () => void) {
  const router = useRouter();
  const onApiError = (err: unknown): void => {
    if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
    if (err instanceof ApiError && err.status === 400 && err.fields) {
      const { errors: fe, rest } = mysqlServerFields(err.fields);
      d.setErrors(fe);
      if (rest.length) d.setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
      focusError();
    } else d.setFormError(toUiError(err));
  };
  const validate = () => {
    const r = buildMysqlInput(d.st);
    if (!r.input) {
      d.setErrors(r.errors);
      focusError();
    }
    return r.input;
  };
  return { onApiError, validate };
}
type Errs = ReturnType<typeof useMysqlErrors>;

/** PUT kaydı: başarıda kayıtlı görünüm yenilenir, "yeniden başlatın" notu kalıcı gösterilir. */
function useMysqlSave(d: Draft, e: Errs) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [applyNote, setApplyNote] = useState<string | null>(null);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const input = e.validate();
    if (!input) return;
    setBusy(true);
    d.setFormError(null);
    try {
      const r = await api<MysqlSettingsSaveResponse>("PUT", "/admin/settings/mysql", input);
      d.setSaved(r);
      d.setSt(toMysqlState(r));
      d.setErrors({});
      setApplyNote(r.message || MYSQL_APPLY_NOTE);
      toast(t("my.saved"));
    } catch (err) {
      e.onApiError(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, applyNote, submit };
}

/** "Bağlantıyı Test Et": formdaki değerlerle (kaydetmeden); sonuç ekranda kalır. */
function useMysqlTest(d: Draft, e: Errs) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const test = async () => {
    if (testing) return;
    setResult(null);
    const input = e.validate();
    if (!input) return;
    setTesting(true);
    d.setFormError(null);
    try {
      const r = await api<MysqlTestResponse>("POST", "/admin/settings/mysql/test", input);
      // Süre yalnız başarıda gösterilir: başarısız denemede sunucu süre dönmez (B-P11-4, port tarama oracle'ı)
      const latencyMs = r.ok && typeof r.latencyMs === "number" ? r.latencyMs : undefined;
      setResult(
        r.ok
          ? { tone: "success", title: t("my.testOk"), message: r.message, latencyMs }
          : { tone: "danger", title: t("my.testFail"), message: r.message },
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields) e.onApiError(err);
      else if (isUnauthenticated(err)) e.onApiError(err);
      else {
        const ui = toUiError(err);
        setResult({ tone: ui.tone, title: t("my.testFail"), message: ui.message });
      }
    } finally {
      setTesting(false);
    }
  };
  return { testing, result, test };
}

/** MySQL ayar formunun durumu ve eylemleri; `focusError` bileşendeki `useFocusFirstError`'dan gelir. */
export function useMysqlForm(initial: MysqlSettingsView, focusError: () => void) {
  const d = useMysqlDraft(initial);
  const e = useMysqlErrors(d, focusError);
  const save = useMysqlSave(d, e);
  const tst = useMysqlTest(d, e);
  return { ...d, ...save, ...tst };
}
export type MysqlFormState = ReturnType<typeof useMysqlForm>;
