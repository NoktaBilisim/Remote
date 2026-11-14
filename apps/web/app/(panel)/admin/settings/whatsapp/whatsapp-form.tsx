"use client";

import { LoaderCircle, MessageCircle, RotateCcw, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SaveBar } from "@/components/ui/save-bar";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import {
  checkTestPhone,
  checkWaUrl,
  normalizeWaView,
  WA_SERVICE_URL_MAX,
  waDirty,
  waFieldValue,
  WA_INSECURE_WARNING,
  waServerFields,
  type WhatsappServiceTestResponse,
  type WhatsappServiceView,
} from "@/lib/admin-settings/whatsapp";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useHydrated } from "@/lib/use-hydrated";
import { Section, SourceBadge } from "../section";

const FORM_ID = "wa-service-form";
const PATH = "/admin/settings/whatsapp";
type TestResult = { tone: "success" | "danger" | "locked"; title: string; message: string };

/**
 * WhatsApp servisi (AC-196, ortak standart §2.2). Durumlar: boş (env de yok → `url: null`, bilgi kutusu + test pasif),
 * kısmi (env kaynağı bilgi notu; `insecure` uyarısı — kanal canlıda kapalı), başarı (panel kaydı). Alan yalnız panel
 * kaydını gösterir; etkin adres (env dahil) üstteki özette. "Ortam değişkenine dön" (DELETE) yalnız panel kaydı varken,
 * `alertdialog` (odak Vazgeç). Test kayıtlı etkin adresle yapılır (formdaki kaydedilmemiş değer değil); sonuç ekranda kalır.
 */
export function WhatsappForm({ initial: raw }: { initial: WhatsappServiceView }) {
  const initial = normalizeWaView(raw);
  const router = useRouter();
  const ready = useHydrated(); // data-ready: e2e hidrasyondan önce yazmasın (QA P12 Tur 2)
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [url, setUrl] = useState(() => waFieldValue(initial));
  const [urlError, setUrlError] = useState<string>();
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [focusErr, setFocusErr] = useState(0);
  const urlRef = useRef<HTMLInputElement>(null);
  const dirty = waDirty(url, saved);

  useEffect(() => {
    if (focusErr) urlRef.current?.focus();
  }, [focusErr]);

  const apply = (v: WhatsappServiceView) => {
    setSaved(v);
    setUrl(waFieldValue(v));
    setUrlError(undefined);
  };
  const reset = () => {
    setUrl(waFieldValue(saved));
    setUrlError(undefined);
    setFormError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const c = checkWaUrl(url);
    if (!c.url) {
      setUrlError(c.error);
      setFocusErr((n) => n + 1);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      apply(normalizeWaView(await api<WhatsappServiceView>("PUT", PATH, { url: c.url })));
      toast(t("wa.svc.saved"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.status === 400 && err.fields) {
        const { error, rest } = waServerFields(err.fields, "url");
        setUrlError(error);
        if (rest.length) setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
        if (error) setFocusErr((n) => n + 1);
      } else setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const r = await api<WhatsappServiceView | undefined>("DELETE", PATH);
      // DELETE yanıtı gövdesiz olabilir → güncel (env) görünümü yeniden al
      apply(normalizeWaView(r && typeof r === "object" && "source" in r ? r : await api<WhatsappServiceView>("GET", PATH)));
      setConfirmReset(false);
      toast(t("wa.svc.resetDone"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      setConfirmReset(false);
      setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  const test = async (e: FormEvent) => {
    e.preventDefault();
    if (testing) return;
    setResult(null);
    const c = checkTestPhone(phone);
    if (!c.phoneNumber) {
      setPhoneError(c.error);
      return;
    }
    setPhoneError(undefined);
    setTesting(true);
    try {
      const r = await api<WhatsappServiceTestResponse>("POST", `${PATH}/test`, { phoneNumber: c.phoneNumber });
      setResult(r.ok ? { tone: "success", title: t("wa.svc.testOk"), message: r.message } : { tone: "danger", title: t("wa.svc.testFail"), message: r.message });
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.status === 400 && err.fields?.phoneNumber) setPhoneError(err.fields.phoneNumber);
      else if (err instanceof ApiError && err.status === 429) setResult({ tone: "locked", title: t("wa.svc.testFail"), message: err.message || t("wa.svc.testRate") });
      else setResult({ tone: "danger", title: t("wa.svc.testFail"), message: toUiError(err).message });
    } finally {
      setTesting(false);
    }
  };

  const configured = saved.url !== null;
  const canTest = configured && !busy;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {!configured ? (
        <Alert tone="info" testId="wa-svc-empty">{t("wa.svc.empty")}</Alert>
      ) : (
        <>
          {saved.source === "env" && <Alert tone="info" testId="wa-svc-env-source">{t("wa.svc.envSource")}</Alert>}
          {saved.source === "default" && <Alert tone="info" testId="wa-svc-default-source">{t("wa.svc.defaultSource")}</Alert>}
        </>
      )}
      {saved.insecure && <Alert tone="warning" testId="wa-svc-insecure">{t("wa.svc.insecure", { warning: WA_INSECURE_WARNING })}</Alert>}
      {formError && <FormError error={formError} />}

      <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-6" data-testid="wa-svc-form" data-ready={ready ? "true" : "false"}>
        <fieldset disabled={busy} className="flex flex-col gap-6">
          <Section
            id="wa-svc"
            title={t("wa.svc.title")}
            Icon={MessageCircle}
            aside={<SourceBadge source={saved.source} panel={t("wa.svc.panelBadge")} env={t("wa.svc.envBadge")} fallback={t("wa.svc.defaultBadge")} />}
          >
            <p className="text-sm text-fg-muted">{t("wa.svc.intro")}</p>
            <dl className="grid gap-x-4 gap-y-2 rounded-md border border-border bg-canvas px-3 py-2.5 text-sm sm:grid-cols-[9rem_1fr]" data-testid="wa-svc-summary">
              <dt className="text-fg-muted">{t("wa.svc.effective")}</dt>
              <dd className="min-w-0 font-mono break-all text-fg" data-testid="wa-svc-effective">{saved.url ?? t("wa.svc.none")}</dd>
              <dt className="text-fg-muted">{t("wa.svc.updated")}</dt>
              <dd className="text-fg tabular-nums" data-testid="wa-svc-updated">{saved.updatedAt ? formatDateTime(saved.updatedAt) : t("wa.svc.never")}</dd>
            </dl>
            <TextField
              ref={urlRef}
              label={t("wa.svc.url")}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setUrlError(undefined);
              }}
              error={urlError}
              hint={saved.source === "env" ? `${t("wa.svc.urlHint")} ${t("wa.svc.urlHintEnv")}` : saved.source === "default" ? `${t("wa.svc.urlHint")} ${t("wa.svc.urlHintDefault")}` : t("wa.svc.urlHint")}
              placeholder="https://wa.ornek.com"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              maxLength={WA_SERVICE_URL_MAX + 20}
              data-testid="wa-svc-url"
            />
          </Section>
        </fieldset>
      </form>

      {saved.source === "panel" && (
        <div>
          <Button type="button" variant="danger-ghost" disabled={busy} onClick={() => setConfirmReset(true)} data-testid="wa-svc-reset">
            <RotateCcw aria-hidden className="size-4" />
            {t("wa.svc.reset")}
          </Button>
        </div>
      )}

      <Section id="wa-test" title={t("wa.svc.testTitle")} Icon={Send}>
        <p className="text-sm text-fg-muted" id="wa-test-note">{t("wa.svc.testBody")}</p>
        {!configured && <p className="text-sm font-medium text-fg" data-testid="wa-test-disabled">{t("wa.svc.testDisabled")}</p>}
        {configured && dirty && <p className="text-sm text-fg" data-testid="wa-test-dirty">{t("wa.svc.testDirty")}</p>}
        <form noValidate onSubmit={test} className="flex flex-col gap-3 sm:flex-row sm:items-start" data-testid="wa-test-form" data-ready={ready ? "true" : "false"}>
          <TextField
            className="min-w-0 flex-1"
            label={t("wa.svc.testPhone")}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setPhoneError(undefined);
            }}
            error={phoneError}
            hint={t("wa.svc.testPhoneHint")}
            disabled={!canTest || testing}
            maxLength={40}
            data-testid="wa-test-phone"
          />
          <Button type="submit" variant="secondary" className="shrink-0 sm:mt-7" loading={testing} disabled={!canTest} aria-describedby="wa-test-note" data-testid="wa-test-send">
            {!testing && <Send aria-hidden className="size-4" />}
            {t("wa.svc.test")}
          </Button>
        </form>
        {testing && (
          <p role="status" className="flex items-center gap-2 text-sm text-fg-muted" data-testid="wa-test-wait">
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            {t("wa.svc.testWait")}
          </p>
        )}
        {result && (
          <Alert tone={result.tone} testId="wa-test-result">
            <p className="font-medium">{result.title}</p>
            {result.message && result.message !== result.title && <p className="mt-1">{result.message}</p>}
          </Alert>
        )}
      </Section>

      <SaveBar dirty={dirty && !confirmReset} busy={busy} formId={FORM_ID} onReset={reset} message={t("wa.svc.unsaved")} leaveBody={t("wa.svc.leaveBody")} />

      <Dialog
        open={confirmReset}
        onClose={() => {
          if (!busy) setConfirmReset(false);
        }}
        role="alertdialog"
        size="sm"
        testId="wa-svc-reset-dialog"
        title={t("wa.svc.resetTitle")}
        description={t("wa.svc.resetBody")}
        footer={
          <>
            <Button variant="secondary" data-autofocus disabled={busy} className="sm:ml-auto" onClick={() => setConfirmReset(false)}>
              {t("rq.rj.cancel")}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void doReset()} data-testid="wa-svc-reset-confirm">
              {!busy && <RotateCcw aria-hidden className="size-4" />}
              {t("wa.svc.reset")}
            </Button>
          </>
        }
      />
    </div>
  );
}
