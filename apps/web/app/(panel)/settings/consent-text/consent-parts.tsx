"use client";

import { FileText, History, Save } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CONSENT_BODY_MAX, type ConsentTextVersion } from "@/lib/admin-settings/contract";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ConsentFormState } from "./use-consent-form";

type P = { f: ConsentFormState };
const shortSha = (s: string) => `${s.slice(0, 8)}…${s.slice(-8)}`;

/** Salt okunur ve "metin yok" uyarıları, form üstü hata. */
export function ConsentAlerts({ f, canEdit }: P & { canEdit: boolean }) {
  return (
    <>
      {!canEdit && (
        <Alert tone="warning" testId="settings-readonly">
          {t("set.readonly")}
        </Alert>
      )}
      {!f.data.current && (
        <Alert tone="warning" testId="consent-none">
          {t("ct.none")}
        </Alert>
      )}
      {f.formError && <FormError error={f.formError} />}
    </>
  );
}

/** "Geçerli metin" bölümü: başlık, (varsa) sürüm özeti ve form. */
export function CurrentSection({ id, cur, children }: { id: string; cur: ConsentTextVersion | null; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-cur`} className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
      <h2 id={`${id}-cur`} className="flex items-center gap-2 text-base font-semibold text-fg">
        <FileText aria-hidden className="size-5 text-fg-muted" />
        {t("ct.current")}
      </h2>
      {cur && <CurrentMeta cur={cur} />}
      {children}
    </section>
  );
}

/** Geçerli sürüm özeti: sürüm no, tarih, kaydeden. */
function CurrentMeta({ cur }: { cur: ConsentTextVersion }) {
  return (
    <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3" data-testid="consent-current">
      <div>
        <dt className="text-xs text-fg-muted">{t("ct.version")}</dt>
        <dd className="font-medium text-fg tabular-nums" data-testid="consent-version">
          {t("ct.versionN", { n: formatNumber(cur.version) })}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-fg-muted">{t("ct.date")}</dt>
        <dd className="text-fg">
          <time dateTime={cur.createdAt} className="tabular-nums">
            {formatDateTime(cur.createdAt)}
          </time>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-fg-muted">{t("ct.by")}</dt>
        <dd className="text-fg" data-testid="consent-by">
          {cur.createdByName ?? t("ct.system")}
        </dd>
      </div>
    </dl>
  );
}

/** İpucu ve karakter sayacı (aralık dışında kırmızı; salt okunurda nötr). */
function BodyCount({ f, id, canEdit }: P & { id: string; canEdit: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <p id={`${id}-hint`} className="text-xs text-fg-muted">
        {t("ct.hint")}
      </p>
      <p
        id={`${id}-count`}
        className={`text-xs tabular-nums ${canEdit && f.outOfRange ? "font-medium text-danger" : "text-fg-muted"}`}
        data-testid="consent-count"
      >
        {t("ct.counter", { n: formatNumber(f.len), max: formatNumber(CONSENT_BODY_MAX) })}
      </p>
    </div>
  );
}

/** Metin alanı + ipucu + sayaç (+ alan hatası); `aria-describedby` ipucu, sayaç ve varsa hata. */
export function BodyField({
  f,
  id,
  canEdit,
  areaRef,
}: P & { id: string; canEdit: boolean; areaRef: RefObject<HTMLTextAreaElement | null> }) {
  const { error } = f;
  return (
    <>
      <label htmlFor={`${id}-body`} className="text-sm font-medium text-fg">
        {t("ct.body")}
      </label>
      <textarea
        ref={areaRef}
        id={`${id}-body`}
        value={f.body}
        onChange={(e) => f.changeBody(e.target.value)}
        readOnly={!canEdit}
        disabled={f.busy}
        rows={14}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint ${id}-count${error ? ` ${id}-err` : ""}`}
        className={`w-full rounded-md border bg-surface px-3 py-2 text-base text-fg shadow-sm focus-visible:border-ring disabled:opacity-60 read-only:bg-surface-muted sm:text-sm ${error ? "border-danger" : "border-border"}`}
        data-testid="consent-body"
      />
      <BodyCount f={f} id={id} canEdit={canEdit} />
      {error && (
        <p id={`${id}-err`} className="text-xs font-medium text-danger" data-testid="consent-error">
          {error}
        </p>
      )}
    </>
  );
}

function VersionRow({ v, isCurrent }: { v: ConsentTextVersion; isCurrent: boolean }) {
  return (
    <li className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:gap-4" data-testid="consent-version-row">
      <span className="flex items-center gap-2 font-medium text-fg sm:w-36">
        {t("ct.versionN", { n: formatNumber(v.version) })}
        {isCurrent && (
          <span className="rounded-full bg-primary-surface px-2 py-0.5 text-xs font-medium text-primary">{t("ct.currentBadge")}</span>
        )}
      </span>
      <span className="text-fg-muted">
        <time dateTime={v.createdAt} className="tabular-nums">
          {formatDateTime(v.createdAt)}
        </time>
        {" · "}
        {v.createdByName ?? t("ct.system")}
      </span>
      <span className="font-mono text-xs text-fg-muted sm:ml-auto" title={v.sha256}>
        <span className="sr-only">{t("ct.sha")}: </span>
        {shortSha(v.sha256)}
      </span>
    </li>
  );
}

/** Sürüm geçmişi (en yeni üstte; geçerli sürüm rozetli). */
export function VersionHistory({ f, id }: P & { id: string }) {
  const { versions, current } = f.data;
  return (
    <section aria-labelledby={`${id}-hist`} className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
      <h2 id={`${id}-hist`} className="flex items-center gap-2 text-base font-semibold text-fg">
        <History aria-hidden className="size-5 text-fg-muted" />
        {t("ct.history")}
      </h2>
      {versions.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">{t("ct.historyEmpty")}</p>
      ) : (
        <ol className="mt-3 divide-y divide-border" data-testid="consent-versions">
          {versions.map((v) => (
            <VersionRow key={v.id} v={v} isCurrent={v.id === current?.id} />
          ))}
        </ol>
      )}
    </section>
  );
}

/** "Yeni sürüm olarak kaydet" onayı: `alertdialog`, odak Vazgeç'te; kayıt sürerken kapanmaz. */
export function ConfirmDialog({ f }: P) {
  return (
    <Dialog
      open={f.confirm}
      onClose={() => {
        if (!f.busy) f.setConfirm(false);
      }}
      role="alertdialog"
      size="sm"
      testId="consent-confirm"
      title={t("ct.confirmTitle")}
      description={t("ct.confirmBody")}
      footer={
        <>
          <Button variant="secondary" data-autofocus disabled={f.busy} className="sm:ml-auto" onClick={() => f.setConfirm(false)}>
            {t("rq.rj.cancel")}
          </Button>
          <Button loading={f.busy} onClick={() => void f.save()} data-testid="consent-confirm-save">
            {!f.busy && <Save aria-hidden className="size-4" />}
            {t("ct.save")}
          </Button>
        </>
      }
    />
  );
}
