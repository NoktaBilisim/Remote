"use client";

import { KeyRound, Plus, RotateCcw, Trash2, Waypoints } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SaveBar } from "@/components/ui/save-bar";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { TURN_SECRET_REQUIRED_MESSAGE, TURN_URLS_MAX, type TurnSettingsView } from "@/lib/admin-settings/contract";
import { buildTurnInput, needsTurnSecret, toTurnState, turnDirty, type TurnErrors, type TurnState } from "@/lib/admin-settings/forms";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { useHydrated } from "@/lib/use-hydrated";
import { Section, SourceBadge } from "../section";

const FORM_ID = "turn-form";

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

/**
 * TURN ayarı (AC-78, G-13): adres listesi (satır ekle/kaldır, en çok 10) + paylaşılan gizli anahtar. Secret forma geri
 * yazılmaz; boş = kayıtlı korunur. "Ortam değerlerine dön" (DELETE) yalnız panel kaydı varken, onay diyaloğuyla
 * (odak Vazgeç'te).
 */
export function TurnForm({ initial }: { initial: TurnSettingsView }) {
  const router = useRouter();
  const ready = useHydrated(); // data-ready: e2e hidrasyondan önce yazmasın (QA P12 Tur 2)
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const base = useMemo(() => toTurnState(saved), [saved]);
  const [st, setSt] = useState<TurnState>(base);
  const [errors, setErrors] = useState<TurnErrors>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [focusErr, setFocusErr] = useState(0);
  const [focusRow, setFocusRow] = useState<{ row: number; n: number } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const dirty = turnDirty(st, base);

  useEffect(() => {
    if (focusErr) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusErr]);
  useEffect(() => {
    if (focusRow === null) return;
    const inputs = formRef.current?.querySelectorAll<HTMLInputElement>('[data-testid="turn-url"]');
    if (inputs?.length) inputs[Math.min(focusRow.row, inputs.length - 1)]?.focus();
    else addRef.current?.focus();
  }, [focusRow]);

  const setUrl = (i: number, v: string) => {
    setSt((s) => ({ ...s, urls: s.urls.map((u, j) => (j === i ? v : u)) }));
    setErrors((x) => ({ ...x, urls: undefined, url: x.url ? { ...x.url, [i]: "" } : undefined }));
  };
  const addRow = () => {
    setSt((s) => ({ ...s, urls: [...s.urls, ""] }));
    setFocusRow((f) => ({ row: st.urls.length, n: (f?.n ?? 0) + 1 }));
  };
  const removeRow = (i: number) => {
    setSt((s) => ({ ...s, urls: s.urls.filter((_, j) => j !== i) }));
    setErrors({});
    setFocusRow((f) => ({ row: Math.max(0, i - 1), n: (f?.n ?? 0) + 1 }));
  };
  const reset = () => {
    setSt(base);
    setErrors({});
    setFormError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const r = buildTurnInput(st);
    const errs = { ...r.errors };
    if (r.input && needsTurnSecret(r.input.urls) && !r.input.secret && !saved.hasSecret) errs.secret = TURN_SECRET_REQUIRED_MESSAGE;
    if (!r.input || errs.secret) {
      setErrors(errs);
      setFocusErr((n) => n + 1);
      return;
    }
    const sentRows = st.urls
      .map((u, i) => ({ u: u.trim(), i }))
      .filter((x) => x.u !== "")
      .map((x) => x.i);
    setBusy(true);
    setFormError(null);
    try {
      const v = await api<TurnSettingsView>("PUT", "/admin/settings/turn", r.input);
      setSaved(v);
      setSt(toTurnState(v));
      setErrors({});
      toast(t("tu.saved"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.status === 400 && err.fields) {
        const { errors: fe, rest } = serverErrors(err.fields, sentRows);
        setErrors(fe);
        if (rest.length) setFormError({ message: rest.join(" "), tone: "danger", requestId: err.requestId });
        setFocusErr((n) => n + 1);
      } else setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await api<unknown>("DELETE", "/admin/settings/turn");
      // DELETE yanıtı gövdesiz olabilir → güncel (env) görünümü yeniden al
      const v = await api<TurnSettingsView>("GET", "/admin/settings/turn");
      setSaved(v);
      setSt(toTurnState(v));
      setErrors({});
      setConfirmReset(false);
      toast(t("tu.resetDone"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      setConfirmReset(false);
      setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  const filled = st.urls.filter((u) => u.trim() !== "").length;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {saved.source === "env" && (
        <Alert tone="info" testId="turn-env-source">
          {t("tu.envSource")}
        </Alert>
      )}
      <Alert tone="warning" testId="turn-secret-warning">
        {t("tu.secretWarn")}
      </Alert>
      {formError && <FormError error={formError} />}
      <form
        id={FORM_ID}
        ref={formRef}
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-6"
        data-testid="turn-form"
        data-ready={ready ? "true" : "false"}
      >
        <fieldset disabled={busy} className="flex flex-col gap-6">
          <Section
            id="tu-urls"
            title={t("tu.urls")}
            Icon={Waypoints}
            aside={<SourceBadge source={saved.source} panel={t("sys.sourcePanelBadge")} env={t("sys.sourceEnvBadge")} />}
          >
            <p className="text-sm text-fg-muted" id="turn-urls-hint">
              {t("tu.urlsHint")}
            </p>
            <ol className="flex flex-col gap-3" data-testid="turn-urls">
              {st.urls.map((u, i) => (
                <li key={i} className="flex items-start gap-2">
                  <TextField
                    className="min-w-0 flex-1"
                    label={t("tu.url", { n: i + 1 })}
                    value={u}
                    onChange={(e) => setUrl(i, e.target.value)}
                    error={errors.url?.[i] || undefined}
                    placeholder="turns:turn.ornek.com:443?transport=tcp"
                    autoComplete="off"
                    spellCheck={false}
                    autoCapitalize="none"
                    maxLength={255}
                    data-testid="turn-url"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-6 w-11 shrink-0 px-0 text-danger"
                    aria-label={t("tu.remove", { n: i + 1 })}
                    onClick={() => removeRow(i)}
                    data-testid="turn-url-remove"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </li>
              ))}
            </ol>
            {errors.urls && (
              <p className="text-xs font-medium text-danger" role="alert" data-testid="turn-urls-error">
                {errors.urls}
              </p>
            )}
            {filled === 0 && (
              <p className="text-sm text-fg-muted" data-testid="turn-no-urls">
                {t("tu.noUrls")}
              </p>
            )}
            <Button
              ref={addRef}
              type="button"
              variant="secondary"
              className="self-start"
              disabled={st.urls.length >= TURN_URLS_MAX}
              onClick={addRow}
              data-testid="turn-url-add"
            >
              <Plus aria-hidden className="size-4" />
              {t("tu.add")}
            </Button>
            {saved.updatedAt && <p className="text-xs text-fg-muted">{t("sys.updatedAt", { at: formatDateTime(saved.updatedAt) })}</p>}
          </Section>
          <Section id="tu-secret" title={t("tu.secretTitle")} Icon={KeyRound}>
            <TextField
              label={t("tu.secret")}
              type="password"
              revealable
              value={st.secret}
              onChange={(e) => {
                setSt((s) => ({ ...s, secret: e.target.value }));
                setErrors((x) => ({ ...x, secret: undefined }));
              }}
              error={errors.secret}
              placeholder={saved.hasSecret ? t("sys.secretKept") : undefined}
              hint={saved.hasSecret ? t("tu.secretKeptHint") : t("tu.secretHint")}
              autoComplete="new-password"
              maxLength={256}
              data-testid="turn-secret"
            />
          </Section>
        </fieldset>
      </form>

      {saved.source === "panel" && (
        <div>
          <Button type="button" variant="danger-ghost" disabled={busy} onClick={() => setConfirmReset(true)} data-testid="turn-reset">
            <RotateCcw aria-hidden className="size-4" />
            {t("tu.reset")}
          </Button>
        </div>
      )}

      <SaveBar
        dirty={dirty && !confirmReset}
        busy={busy}
        formId={FORM_ID}
        onReset={reset}
        message={t("tu.unsaved")}
        leaveBody={t("tu.leaveBody")}
      />

      <Dialog
        open={confirmReset}
        onClose={() => {
          if (!busy) setConfirmReset(false);
        }}
        role="alertdialog"
        size="sm"
        testId="turn-reset-dialog"
        title={t("tu.resetTitle")}
        description={t("tu.resetBody")}
        footer={
          <>
            <Button variant="secondary" data-autofocus disabled={busy} className="sm:ml-auto" onClick={() => setConfirmReset(false)}>
              {t("rq.rj.cancel")}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void doReset()} data-testid="turn-reset-confirm">
              {!busy && <RotateCcw aria-hidden className="size-4" />}
              {t("tu.reset")}
            </Button>
          </>
        }
      />
    </div>
  );
}
