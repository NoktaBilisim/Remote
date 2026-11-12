"use client";

import { LoaderCircle, Lock, PlugZap, Server } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SaveBar } from "@/components/ui/save-bar";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { MYSQL_APPLY_NOTE, type MysqlSettingsSaveResponse, type MysqlSettingsView, type MysqlTestResponse } from "@/lib/admin-settings/contract";
import { buildMysqlInput, mysqlDirty, mysqlServerFields, toMysqlState, type MysqlField, type MysqlState } from "@/lib/admin-settings/forms";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, withoutLeadingTitle, type UiError } from "@/lib/error-message";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Section, SourceBadge } from "../section";

const FORM_ID = "mysql-form";
type TestResult = { tone: "success" | "danger" | "locked"; title: string; message: string; latencyMs?: number };

/**
 * MySQL Ayarları (AC-77, 78; ortak standart §1.2; ADR-0003). Şifre forma geri yazılmaz: kayıtlıysa yer tutucu "Kayıtlı —
 * değiştirmek için yazın", boş bırakılırsa korunur. "Bağlantıyı Test Et" formdaki değerlerle (kaydetmeden) çalışır,
 * sonuç (başarı + ms / hata, süresiz) ekranda kalır; 10 sn sınırı sunucuda. Kayıt çalışan bağlantıyı değiştirmez → kalıcı uyarı.
 */
export function MysqlForm({ initial }: { initial: MysqlSettingsView }) {
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const base = useMemo(() => toMysqlState(saved), [saved]);
  const [st, setSt] = useState<MysqlState>(base);
  const [errors, setErrors] = useState<Partial<Record<MysqlField, string>>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [applyNote, setApplyNote] = useState<string | null>(null);
  const [focusErr, setFocusErr] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = mysqlDirty(st, base);

  useEffect(() => {
    if (focusErr) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusErr]);

  const set = (k: MysqlField) => (e: { target: { value: string } }) => {
    setSt((s) => ({ ...s, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const reset = () => {
    setSt(base);
    setErrors({});
    setFormError(null);
  };

  /** 400 → alan hataları (bağlanamayanlar form üstü); diğerleri form üstü. */
  const onApiError = (err: unknown): void => {
    if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
    if (err instanceof ApiError && err.status === 400 && err.fields) {
      const { errors: fe, rest } = mysqlServerFields(err.fields);
      setErrors(fe);
      if (rest.length) setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
      setFocusErr((n) => n + 1);
    } else setFormError(toUiError(err));
  };

  const validate = () => {
    const r = buildMysqlInput(st);
    if (!r.input) {
      setErrors(r.errors);
      setFocusErr((n) => n + 1);
    }
    return r.input;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const input = validate();
    if (!input) return;
    setBusy(true);
    setFormError(null);
    try {
      const r = await api<MysqlSettingsSaveResponse>("PUT", "/admin/settings/mysql", input);
      setSaved(r);
      setSt(toMysqlState(r));
      setErrors({});
      setApplyNote(r.message || MYSQL_APPLY_NOTE);
      toast(t("my.saved"));
    } catch (err) {
      onApiError(err);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (testing) return;
    setResult(null);
    const input = validate();
    if (!input) return;
    setTesting(true);
    setFormError(null);
    try {
      const r = await api<MysqlTestResponse>("POST", "/admin/settings/mysql/test", input);
      // Süre yalnız başarıda gösterilir: başarısız denemede sunucu süre dönmez (B-P11-4, port tarama oracle'ı)
      const latencyMs = r.ok && typeof r.latencyMs === "number" ? r.latencyMs : undefined;
      setResult(r.ok ? { tone: "success", title: t("my.testOk"), message: r.message, latencyMs } : { tone: "danger", title: t("my.testFail"), message: r.message });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields) onApiError(err);
      else if (isUnauthenticated(err)) onApiError(err);
      else {
        const ui = toUiError(err);
        setResult({ tone: ui.tone, title: t("my.testFail"), message: ui.message });
      }
    } finally {
      setTesting(false);
    }
  };

  const hasPw = saved.hasPassword;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {saved.source === "env" ? (
        <Alert tone="info" testId="mysql-env-source">{t("my.envSource")}</Alert>
      ) : (
        !saved.matchesRunning && !applyNote && <Alert tone="warning" testId="mysql-mismatch">{t("my.mismatch")}</Alert>
      )}
      {applyNote && <Alert tone="warning" testId="mysql-restart">{applyNote}</Alert>}
      {formError && <FormError error={formError} />}
      <form id={FORM_ID} ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-6" data-testid="mysql-form">
        <fieldset disabled={busy} className="flex flex-col gap-6">
          <Section
            id="my-srv"
            title={t("my.server")}
            Icon={Server}
            aside={<SourceBadge source={saved.source} panel={t("sys.sourcePanelBadge")} env={t("sys.sourceEnvBadge")} />}
          >
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <TextField label={t("my.host")} value={st.host} onChange={set("host")} error={errors.host} placeholder="db.ornek.local" autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={253} data-testid="mysql-host" />
              <TextField label={t("my.port")} value={st.port} onChange={set("port")} error={errors.port} hint={t("my.portHint")} inputMode="numeric" autoComplete="off" maxLength={5} data-testid="mysql-port" />
            </div>
            <TextField label={t("my.database")} value={st.database} onChange={set("database")} error={errors.database} autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={64} data-testid="mysql-database" />
            {saved.updatedAt && <p className="text-xs text-fg-muted">{t("sys.updatedAt", { at: formatDateTime(saved.updatedAt) })}</p>}
          </Section>
          <Section id="my-auth" title={t("my.auth")} Icon={Lock}>
            <TextField label={t("my.user")} value={st.user} onChange={set("user")} error={errors.user} autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={32} data-testid="mysql-user" />
            <TextField
              label={t("my.password")}
              type="password"
              revealable
              value={st.password}
              onChange={set("password")}
              error={errors.password}
              placeholder={hasPw ? t("sys.secretKept") : undefined}
              hint={hasPw ? t("my.passwordKept") : t("my.passwordHint")}
              autoComplete="new-password"
              maxLength={200}
              data-testid="mysql-password"
            />
          </Section>
        </fieldset>
      </form>

      <Section id="my-test" title={t("my.testTitle")} Icon={PlugZap}>
        <p className="text-sm text-fg-muted" id="mysql-test-note">{t("my.testBody")}</p>
        <Alert tone="warning" testId="mysql-tls-note">{t("my.tlsNote")}</Alert>
        <Button type="button" variant="secondary" className="self-start" loading={testing} disabled={busy} aria-describedby="mysql-test-note" onClick={test} data-testid="mysql-test">
          {!testing && <PlugZap aria-hidden className="size-4" />}
          {t("my.test")}
        </Button>
        {testing && (
          <p role="status" className="flex items-center gap-2 text-sm text-fg-muted" data-testid="mysql-test-wait">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            {t("my.testWait")}
          </p>
        )}
        {result && (
          <Alert tone={result.tone} testId="mysql-test-result">
            <p className="font-medium">{result.title}</p>
            {withoutLeadingTitle(result.message, result.title) && <p className="mt-1">{withoutLeadingTitle(result.message, result.title)}</p>}
            {result.latencyMs !== undefined && <p className="mt-1 tabular-nums" data-testid="mysql-test-latency">{t("my.latency", { ms: formatNumber(result.latencyMs) })}</p>}
          </Alert>
        )}
      </Section>

      <SaveBar dirty={dirty} busy={busy} formId={FORM_ID} onReset={reset} message={t("my.unsaved")} leaveBody={t("my.leaveBody")} />
    </div>
  );
}
