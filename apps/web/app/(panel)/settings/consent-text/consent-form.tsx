"use client";

import { FileText, History, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SaveBar } from "@/components/ui/save-bar";
import { useToast } from "@/components/ui/toast";
import { CONSENT_BODY_MAX, CONSENT_BODY_MIN, consentTextInputSchema, type ConsentTextSaveResponse, type ConsentTextSettings, type ConsentTextVersion } from "@/lib/admin-settings/contract";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";

const FORM_ID = "consent-form";
/** Sunucuyla aynı sayım: CRLF → LF, uçlar kırpılmış, kod noktası. */
export const consentLength = (v: string): number => [...v.replace(/\r\n?/g, "\n").trim()].length;
const shortSha = (s: string) => `${s.slice(0, 8)}…${s.slice(-8)}`;

function VersionMeta({ v }: { v: ConsentTextVersion }) {
  return (
    <>
      <time dateTime={v.createdAt} className="tabular-nums">{formatDateTime(v.createdAt)}</time>
      {" · "}
      {v.createdByName ?? t("ct.system")}
    </>
  );
}

/**
 * Aydınlatma metni (P11; AC-29, 127): textarea (50–20.000 karakter sayacı), "Yeni sürüm olarak kaydet" → onay diyaloğu
 * ("Yeni oturumlar bu metni gösterecek; eski onaylar eski sürüme bağlı kalır") → PUT. Metin düz metindir (React metin
 * düğümü; HTML yorumlanmaz). `settings.edit` yoksa salt okunur. Değişmeyen gövde sürüm üretmez (`changed:false`).
 */
export function ConsentForm({ initial, canEdit }: { initial: ConsentTextSettings; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [data, setData] = useState(initial);
  const base = data.current?.body ?? "";
  const [body, setBody] = useState(base);
  const [error, setError] = useState<string>();
  const [formError, setFormError] = useState<UiError | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const dirty = canEdit && body !== base;
  const len = consentLength(body);
  const outOfRange = len < CONSENT_BODY_MIN || len > CONSENT_BODY_MAX;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit || busy) return;
    const p = consentTextInputSchema.safeParse({ body });
    if (!p.success) {
      setError(p.error.issues[0]?.message);
      areaRef.current?.focus();
      return;
    }
    setError(undefined);
    setConfirm(true);
  };

  const save = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const r = await api<ConsentTextSaveResponse>("PUT", "/settings/consent-text", { body });
      setData({ current: r.current, versions: r.versions });
      setBody(r.current?.body ?? body);
      setConfirm(false);
      if (r.changed && r.current) toast(t("ct.saved", { n: r.current.version }));
      else toast(t("ct.unchanged"), "info");
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      setConfirm(false);
      if (err instanceof ApiError && err.status === 409) {
        // Eşzamanlı kayıt (409): yazılan metin kaybolmasın diye form korunur; kullanıcı yenileyip güncel sürümü görür
        setFormError({ message: t("ct.conflict"), tone: "danger", requestId: err.requestId });
      } else if (err instanceof ApiError && err.status === 429) {
        // Tenant başına 10 yeni sürüm/saat (B-P11-6): metin korunur, süre Retry-After'dan dakikaya yuvarlanır
        const minutes = err.retryAfter ? Math.max(1, Math.ceil(err.retryAfter / 60)) : null;
        setFormError({ message: minutes ? t("ct.rateLimited", { minutes }) : t("ct.rateLimitedNoTime"), tone: "locked" });
      } else if (err instanceof ApiError && err.status === 400 && err.fields?.body) {
        setError(err.fields.body);
        areaRef.current?.focus();
      } else setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  const cur = data.current;
  return (
    <div className="mt-6 flex max-w-3xl flex-col gap-6">
      {!canEdit && <Alert tone="warning" testId="settings-readonly">{t("set.readonly")}</Alert>}
      {!cur && <Alert tone="warning" testId="consent-none">{t("ct.none")}</Alert>}
      {formError && <FormError error={formError} />}

      <section aria-labelledby={`${id}-cur`} className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
        <h2 id={`${id}-cur`} className="flex items-center gap-2 text-base font-semibold text-fg">
          <FileText aria-hidden className="size-5 text-fg-muted" />
          {t("ct.current")}
        </h2>
        {cur && (
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3" data-testid="consent-current">
            <div>
              <dt className="text-xs text-fg-muted">{t("ct.version")}</dt>
              <dd className="font-medium text-fg tabular-nums" data-testid="consent-version">{t("ct.versionN", { n: formatNumber(cur.version) })}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">{t("ct.date")}</dt>
              <dd className="text-fg"><time dateTime={cur.createdAt} className="tabular-nums">{formatDateTime(cur.createdAt)}</time></dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">{t("ct.by")}</dt>
              <dd className="text-fg" data-testid="consent-by">{cur.createdByName ?? t("ct.system")}</dd>
            </div>
          </dl>
        )}
        <form id={FORM_ID} onSubmit={submit} noValidate className="mt-4 flex flex-col gap-1.5" data-testid="consent-form">
          <label htmlFor={`${id}-body`} className="text-sm font-medium text-fg">{t("ct.body")}</label>
          <textarea
            ref={areaRef}
            id={`${id}-body`}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setError(undefined);
            }}
            readOnly={!canEdit}
            disabled={busy}
            rows={14}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint ${id}-count${error ? ` ${id}-err` : ""}`}
            className={`w-full rounded-md border bg-surface px-3 py-2 text-base text-fg shadow-sm focus-visible:border-ring disabled:opacity-60 read-only:bg-surface-muted sm:text-sm ${error ? "border-danger" : "border-border"}`}
            data-testid="consent-body"
          />
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p id={`${id}-hint`} className="text-xs text-fg-muted">{t("ct.hint")}</p>
            <p id={`${id}-count`} className={`text-xs tabular-nums ${canEdit && outOfRange ? "font-medium text-danger" : "text-fg-muted"}`} data-testid="consent-count">
              {t("ct.counter", { n: formatNumber(len), max: formatNumber(CONSENT_BODY_MAX) })}
            </p>
          </div>
          {error && <p id={`${id}-err`} className="text-xs font-medium text-danger" data-testid="consent-error">{error}</p>}
        </form>
      </section>

      <section aria-labelledby={`${id}-hist`} className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
        <h2 id={`${id}-hist`} className="flex items-center gap-2 text-base font-semibold text-fg">
          <History aria-hidden className="size-5 text-fg-muted" />
          {t("ct.history")}
        </h2>
        {data.versions.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">{t("ct.historyEmpty")}</p>
        ) : (
          <ol className="mt-3 divide-y divide-border" data-testid="consent-versions">
            {data.versions.map((v) => (
              <li key={v.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:gap-4" data-testid="consent-version-row">
                <span className="flex items-center gap-2 font-medium text-fg sm:w-36">
                  {t("ct.versionN", { n: formatNumber(v.version) })}
                  {v.id === cur?.id && <span className="rounded-full bg-primary-surface px-2 py-0.5 text-xs font-medium text-primary">{t("ct.currentBadge")}</span>}
                </span>
                <span className="text-fg-muted"><VersionMeta v={v} /></span>
                <span className="font-mono text-xs text-fg-muted sm:ml-auto" title={v.sha256}>
                  <span className="sr-only">{t("ct.sha")}: </span>
                  {shortSha(v.sha256)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {canEdit && <SaveBar dirty={dirty && !confirm} busy={busy} formId={FORM_ID} onReset={() => { setBody(base); setError(undefined); }} message={t("ct.unsaved")} leaveBody={t("ct.leaveBody")} saveLabel={t("ct.save")} />}

      <Dialog
        open={confirm}
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
        role="alertdialog"
        size="sm"
        testId="consent-confirm"
        title={t("ct.confirmTitle")}
        description={t("ct.confirmBody")}
        footer={
          <>
            <Button variant="secondary" data-autofocus disabled={busy} className="sm:ml-auto" onClick={() => setConfirm(false)}>
              {t("rq.rj.cancel")}
            </Button>
            <Button loading={busy} onClick={() => void save()} data-testid="consent-confirm-save">
              {!busy && <Save aria-hidden className="size-4" />}
              {t("ct.save")}
            </Button>
          </>
        }
      />
    </div>
  );
}
