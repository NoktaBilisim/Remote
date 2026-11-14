"use client";

import { MessageCircle, RotateCcw } from "lucide-react";
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
  checkWaApiKey,
  checkWaUrl,
  normalizeWaView,
  WA_SERVICE_URL_MAX,
  waDirty,
  waFieldValue,
  WA_INSECURE_WARNING,
  waKeyNeedsReenter,
  waServerFields,
  WA_API_KEY_REENTER,
  type WhatsappServiceView,
} from "@/lib/admin-settings/whatsapp";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useHydrated } from "@/lib/use-hydrated";
import { Section, SourceBadge } from "../section";
import { WhatsappTestSection } from "./whatsapp-test-section";
import { WhatsappApiKeyField, WhatsappApiKeyRemoveDialog } from "./whatsapp-api-key-field";

const FORM_ID = "wa-service-form";
const PATH = "/admin/settings/whatsapp";

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
  const [apiKey, setApiKey] = useState("");
  const [keyError, setKeyError] = useState<string>();
  const [confirmKeyRemove, setConfirmKeyRemove] = useState(false);
  const [focusErr, setFocusErr] = useState(0);
  const urlRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const [focusKey, setFocusKey] = useState(0);
  const dirty = waDirty(url, saved) || apiKey !== "";

  useEffect(() => {
    if (focusErr) urlRef.current?.focus();
  }, [focusErr]);
  useEffect(() => {
    if (focusKey) keyRef.current?.focus();
  }, [focusKey]);

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const c = checkWaUrl(url);
    if (!c.url) {
      setUrlError(c.error);
      setFocusErr((n) => n + 1);
      return;
    }
    const k = checkWaApiKey(apiKey);
    // Kayıtlı panel anahtarı eski adrese bağlı: kökeni (şema+host+port) değişirken yeni anahtar şart (istek gitmeden)
    if (!k.error && !k.apiKey && waKeyNeedsReenter(saved, c.url)) k.error = t("wa.svc.keyReenter");
    if (k.error) {
      setKeyError(k.error);
      setFocusKey((n) => n + 1);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      apply(normalizeWaView(await api<WhatsappServiceView>("PUT", PATH, k.apiKey ? { url: c.url, apiKey: k.apiKey } : { url: c.url })));
      toast(t("wa.svc.saved"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.status === 400 && err.fields) {
        const { apiKey: keyMsg, ...others } = err.fields;
        const { error, rest } = waServerFields(others, "url");
        setUrlError(error);
        setKeyError(keyMsg === WA_API_KEY_REENTER ? t("wa.svc.keyReenter") : keyMsg);
        if (rest.length) setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
        if (error) setFocusErr((n) => n + 1);
        else if (keyMsg) setFocusKey((n) => n + 1);
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

  const configured = saved.url !== null;
  const canTest = configured && !busy;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {!configured ? (
        <Alert tone="info" testId="wa-svc-empty">{t("wa.svc.empty")}</Alert>
      ) : (
        <>
          {saved.source === "env" && <Alert tone="info" testId="wa-svc-env-source">{t("wa.svc.envSource")}</Alert>}
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
            aside={<SourceBadge source={saved.source} panel={t("wa.svc.panelBadge")} env={t("wa.svc.envBadge")} />}
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
              hint={saved.source === "env" ? `${t("wa.svc.urlHint")} ${t("wa.svc.urlHintEnv")}` : t("wa.svc.urlHint")}
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

          <WhatsappApiKeyField
            saved={saved}
            value={apiKey}
            onChange={(v) => {
              setApiKey(v);
              setKeyError(undefined);
            }}
            error={keyError}
            inputRef={keyRef}
            busy={busy}
            onRemoveClick={() => setConfirmKeyRemove(true)}
          />
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

      <WhatsappTestSection configured={configured} canTest={canTest} dirty={dirty} ready={ready} />

      <SaveBar dirty={dirty && !confirmReset && !confirmKeyRemove} busy={busy} formId={FORM_ID} onReset={reset} message={t("wa.svc.unsaved")} leaveBody={t("wa.svc.leaveBody")} />

      <WhatsappApiKeyRemoveDialog
        open={confirmKeyRemove}
        saved={saved}
        busy={busy}
        setBusy={setBusy}
        onClose={() => setConfirmKeyRemove(false)}
        onRemoved={(v) => {
          setSaved(v);
          setApiKey("");
          setKeyError(undefined);
          setConfirmKeyRemove(false);
          toast(t("wa.svc.keyRemoved"));
        }}
        onFail={(err) => {
          setConfirmKeyRemove(false);
          if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
          setFormError(toUiError(err));
        }}
      />

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
