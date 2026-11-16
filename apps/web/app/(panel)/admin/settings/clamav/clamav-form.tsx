"use client";

import {
  CLAMAV_DEFAULT_PORT,
  CLAMAV_STALE_WARNING,
  CLAMAV_TEST_MESSAGES,
  type ClamavSettingsView,
  type ClamavTestResponse,
} from "@remote/contracts/api/clamav";
import { CircleAlert, CircleCheck, PlugZap, Server, ShieldCheck, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SaveBar } from "@/components/ui/save-bar";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTime, formatNumber } from "@/lib/format";
import { buildClamav, type ClamavErrors } from "@/lib/fsrv/settings";
import { t } from "@/lib/i18n";
import { useFocusFirstError } from "@/lib/use-focus-error";
import { useHydrated } from "@/lib/use-hydrated";
import { Section, SourceBadge } from "../section";

const FORM_ID = "clamav-form";
const PATH = "/admin/settings/clamav";

function Check({ ok, label, testId }: { ok: boolean; label: string; testId: string }) {
  return (
    <li className={`flex items-center gap-2 ${ok ? "text-success" : "text-danger"}`} data-testid={testId} data-ok={ok ? "true" : "false"}>
      {ok ? <CircleCheck aria-hidden className="size-4" /> : <CircleAlert aria-hidden className="size-4" />}
      {label}: {ok ? t("clam.yes") : t("clam.no")}
    </li>
  );
}

/** Test sonucu kartı (AC-353): EICAR, şifreli arşiv, sürüm, imza tarihi ve yaşı; başarısızsa sabit sınıf metni. */
function TestResult({ r }: { r: ClamavTestResponse }) {
  return (
    <div
      role="status"
      className={`flex flex-col gap-2 rounded-md border p-3 text-sm ${r.ok ? "border-success bg-success-surface" : "border-danger bg-danger-surface"}`}
      data-testid="av-result"
      data-ok={r.ok ? "true" : "false"}
    >
      <p className={`font-semibold ${r.ok ? "text-success" : "text-danger"}`}>
        {r.ok ? CLAMAV_TEST_MESSAGES.ok : (r.message ?? CLAMAV_TEST_MESSAGES.error)}
      </p>
      <ul className="flex flex-col gap-1">
        <Check ok={r.eicarDetected} label={t("clam.eicar")} testId="av-eicar" />
        <Check ok={r.encryptedDetected} label={t("clam.encrypted")} testId="av-encrypted" />
      </ul>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-fg sm:grid-cols-[auto_1fr]">
        <dt className="text-fg-muted">{t("clam.version")}</dt>
        <dd className="wrap-anywhere" data-testid="av-version">
          {r.version ?? "—"}
        </dd>
        <dt className="text-fg-muted">{t("clam.dbDate")}</dt>
        <dd className="tabular-nums" data-testid="av-dbdate">
          {r.dbDate ? formatDateTime(r.dbDate) : "—"}
          {r.signatureAgeDays !== null && ` · ${t("clam.age", { days: formatNumber(r.signatureAgeDays) })}`}
        </dd>
      </dl>
    </div>
  );
}

/** Son kayıtlı test özeti (sayfa açılışında; test yapılmadıysa yönlendirici metin). */
function LastTest({ v }: { v: ClamavSettingsView }) {
  if (!v.host) return null;
  if (!v.lastTest)
    return (
      <Alert tone="warning" testId="av-untested">
        {t("clam.untested")}
      </Alert>
    );
  const lt = v.lastTest;
  return (
    <p className={`text-sm ${lt.ok ? "text-fg" : "text-danger"}`} data-testid="av-last" data-ok={lt.ok ? "true" : "false"}>
      {t(lt.ok ? "clam.lastOk" : "clam.lastFail", { at: formatDateTime(lt.at) })}
      {lt.dbDate && ` · ${t("clam.dbDate")}: ${formatDateTime(lt.dbDate)}`}
      {!lt.ok && lt.message && ` — ${lt.message}`}
    </p>
  );
}

/**
 * ClamAV sistem ayarı (Super Admin; AC-353, 361). Kayıt PUT (step-up `api()` içinde); host/port değişince sunucu `lastTest`'i
 * sıfırlar → "yeniden test edin". Test ucu kayıtlı hedefle (form kirliyse formdaki hedefle) çalışır. `HOST_NOT_ALLOWED` alan
 * hatası host altına. İmza 3 günden eskiyse uyarı bandı (sunucunun `stale` bayrağı; tarih hesabı istemcide yapılmaz).
 */
export function ClamavForm({ initial }: { initial: ClamavSettingsView }) {
  const router = useRouter();
  const toast = useToast();
  const ready = useHydrated();
  const { formRef, focusError } = useFocusFirstError();
  const [saved, setSaved] = useState(initial);
  const [host, setHost] = useState(initial.host ?? "");
  const [port, setPort] = useState(String(initial.port || CLAMAV_DEFAULT_PORT));
  const [errors, setErrors] = useState<ClamavErrors>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ClamavTestResponse | null>(null);
  const dirty = host.trim() !== (saved.host ?? "") || port.trim() !== String(saved.port || CLAMAV_DEFAULT_PORT);
  const stale = result ? result.stale : saved.stale;

  const fail = (err: unknown) => {
    if (isUnauthenticated(err)) return void router.replace(EXPIRED_LOGIN_PATH);
    if (err instanceof ApiError && err.status === 400 && (err.fields?.host || err.fields?.port)) {
      setErrors({ host: err.fields.host, port: err.fields.port });
      focusError();
    } else setFormError(toUiError(err));
  };

  const reset = () => {
    setHost(saved.host ?? "");
    setPort(String(saved.port || CLAMAV_DEFAULT_PORT));
    setErrors({});
    setFormError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !dirty) return;
    const r = buildClamav({ host, port });
    if (!r.body) {
      setErrors(r.errors);
      return focusError();
    }
    setBusy(true);
    setFormError(null);
    try {
      const v = await api<ClamavSettingsView>("PUT", PATH, r.body);
      setSaved(v);
      setHost(v.host ?? "");
      setPort(String(v.port));
      setErrors({});
      setResult(null);
      toast(t("clam.saved"));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (testing) return;
    let body = {};
    if (dirty) {
      const r = buildClamav({ host, port });
      if (!r.body) {
        setErrors(r.errors);
        return focusError();
      }
      body = r.body;
    }
    setTesting(true);
    setFormError(null);
    setResult(null);
    try {
      const r = await api<ClamavTestResponse>("POST", `${PATH}/test`, body);
      setResult(r);
      // Kayıtlı hedefle yapılan test sunucuda `lastTest`'e yazılır → özet güncellenir
      if (!dirty)
        setSaved((s) => ({
          ...s,
          stale: r.stale,
          lastTest: { ok: r.ok, at: new Date().toISOString(), dbDate: r.dbDate, version: r.version },
        }));
    } catch (err) {
      fail(err);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6" data-testid="clamav-settings">
      {!saved.host && (
        <Alert tone="info" testId="av-unconfigured">
          {t("clam.unconfigured")}
        </Alert>
      )}
      {stale && (
        <Alert tone="warning" testId="av-stale">
          <span className="inline-flex items-center gap-1.5">
            <TriangleAlert aria-hidden className="size-4" />
            {CLAMAV_STALE_WARNING}
          </span>
        </Alert>
      )}
      <FormError error={formError} />
      <form id={FORM_ID} ref={formRef} onSubmit={submit} noValidate data-testid="clamav-form" data-ready={ready ? "true" : "false"}>
        <Section
          id="av-server"
          title={t("clam.server")}
          Icon={Server}
          aside={
            <SourceBadge
              source={saved.host ? saved.source : null}
              panel={t("clam.src.panel")}
              env={t("clam.src.env")}
              none={t("clam.src.none")}
            />
          }
        >
          <fieldset disabled={busy} className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_8rem]">
            <TextField
              label={t("clam.host")}
              name="host"
              value={host}
              autoComplete="off"
              spellCheck={false}
              maxLength={253}
              hint={t("clam.hostHint")}
              error={errors.host}
              onChange={(e) => {
                setHost(e.target.value);
                setErrors((x) => ({ ...x, host: undefined }));
              }}
              data-testid="av-host"
            />
            <TextField
              label={t("clam.port")}
              name="port"
              value={port}
              inputMode="numeric"
              autoComplete="off"
              maxLength={5}
              error={errors.port}
              onChange={(e) => {
                setPort(e.target.value);
                setErrors((x) => ({ ...x, port: undefined }));
              }}
              data-testid="av-port"
            />
          </fieldset>
          <LastTest v={saved} />
        </Section>
      </form>
      <Section id="av-test" title={t("clam.testTitle")} Icon={ShieldCheck}>
        <p className="text-sm text-fg-muted">{t("clam.testHint")}</p>
        <Button
          variant="secondary"
          className="self-start"
          loading={testing}
          disabled={busy || (!saved.host && !host.trim())}
          onClick={() => void test()}
          data-testid="av-test"
        >
          {!testing && <PlugZap aria-hidden className="size-4" />}
          {t("clam.test")}
        </Button>
        {result && <TestResult r={result} />}
      </Section>
      <SaveBar dirty={dirty} busy={busy} formId={FORM_ID} onReset={reset} message={t("clam.unsaved")} leaveBody={t("clam.leaveBody")} />
    </div>
  );
}
