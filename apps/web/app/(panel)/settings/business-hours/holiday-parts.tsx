"use client";

import { CalendarOff, CalendarPlus, Plus, RotateCw, Trash2 } from "lucide-react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { formatDayLong } from "@/lib/format";
import { t } from "@/lib/i18n";
import { TR_HOLIDAY_YEARS, type HolidayDraft, type HolidayItem } from "@/lib/requests/business-hours";
import type { useHolidayAdd, useHolidayImport, useHolidayList, useHolidayRemove } from "./use-holidays";

type List = ReturnType<typeof useHolidayList>;
type Add = ReturnType<typeof useHolidayAdd>;
type Remove = ReturnType<typeof useHolidayRemove>;

type Import = ReturnType<typeof useHolidayImport>;

function HolidayButtons({ year, trAvailable, onAdd, imp }: { year: number; trAvailable: boolean; onAdd: () => void; imp: Import }) {
  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
      <Button variant="secondary" onClick={onAdd} data-testid="hd-add-open">
        <Plus aria-hidden className="size-4" />
        {t("hd.add")}
      </Button>
      <Button
        variant="secondary"
        onClick={() => void imp.importTr()}
        loading={imp.importing}
        disabled={!trAvailable}
        aria-describedby={!trAvailable ? "hd-tr-na" : undefined}
        data-testid="hd-import"
      >
        {!imp.importing && <CalendarPlus aria-hidden className="size-4" />}
        {t("hd.import", { year })}
      </Button>
    </div>
  );
}

/** "Tatil ekle" + "Resmî tatilleri ekle (yıl)" (yalnız tanımlı yıllarda; değilse açıklama) + içe aktarma hatası. */
export function HolidayActions({ year, canEdit, onAdd, imp }: { year: number; canEdit: boolean; onAdd: () => void; imp: Import }) {
  const trAvailable = TR_HOLIDAY_YEARS.includes(year);
  return (
    <>
      {canEdit && <HolidayButtons year={year} trAvailable={trAvailable} onAdd={onAdd} imp={imp} />}
      {canEdit && !trAvailable && (
        <p id="hd-tr-na" className="mt-2 text-xs text-fg-muted">
          {t("hd.importNa", { years: TR_HOLIDAY_YEARS.join(", ") })}
        </p>
      )}
      {imp.importError && (
        <div className="mt-3">
          <FormError error={imp.importError} />
        </div>
      )}
    </>
  );
}

function HolidayRow({ h, canEdit, onRemove }: { h: HolidayItem; canEdit: boolean; onRemove: (h: HolidayItem) => void }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2" data-testid="hd-row">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg wrap-anywhere">{h.name}</p>
        <p className="text-xs text-fg-muted">
          <time dateTime={h.day}>{formatDayLong(h.day)}</time> · {h.openUntil ? t("hd.openUntil", { at: h.openUntil }) : t("hd.fullDay")}
        </p>
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={() => onRemove(h)}
          aria-label={t("hd.removeFor", { name: h.name })}
          data-testid="hd-remove"
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-danger-surface hover:text-danger"
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      )}
    </li>
  );
}

function ListLoading() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <span className="sr-only" role="status">
        {t("hd.loading")}
      </span>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function ListError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2" data-testid="hd-error">
      <Alert tone="danger">{t("hd.loadError")}</Alert>
      <Button variant="secondary" onClick={onRetry}>
        <RotateCw aria-hidden className="size-4" />
        {t("err.retry")}
      </Button>
    </div>
  );
}

function ListBody({ list, canEdit, onRemove }: { list: List; canEdit: boolean; onRemove: (h: HolidayItem) => void }) {
  const { load, items, year } = list;
  if (load === "loading") return <ListLoading />;
  if (load === "error") return <ListError onRetry={list.retry} />;
  if (items.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 rounded-md bg-canvas px-4 py-8 text-center text-sm" data-testid="hd-empty">
        <CalendarOff aria-hidden className="size-6 text-fg-muted" />
        <p className="font-medium text-fg">{t("hd.emptyTitle", { year })}</p>
        <p className="text-fg-muted">{canEdit ? t("hd.emptyBody") : t("hd.emptyBodyRo")}</p>
      </div>
    );
  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label={t("hd.listLabel", { year })}>
      {items.map((h) => (
        <HolidayRow key={h.id} h={h} canEdit={canEdit} onRemove={onRemove} />
      ))}
    </ul>
  );
}

/** Liste durumları: yükleniyor (iskelet), hata (tekrar dene), boş, liste. */
export function HolidayList(p: { list: List; canEdit: boolean; onRemove: (h: HolidayItem) => void }) {
  return (
    <div className="mt-4" data-testid="hd-list" data-state={p.list.load}>
      <ListBody {...p} />
    </div>
  );
}

function DraftFields({ a: { draft, setDraft, draftErrors } }: { a: Add }) {
  const edit = (k: keyof HolidayDraft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  return (
    <>
      <TextField
        label={t("hd.day")}
        type="date"
        min="2000-01-01"
        max="2100-12-31"
        value={draft.day}
        onChange={edit("day")}
        error={draftErrors.day}
        data-autofocus
        data-testid="hd-day"
      />
      <TextField
        label={t("hd.name")}
        value={draft.name}
        maxLength={100}
        onChange={edit("name")}
        error={draftErrors.name}
        data-testid="hd-name"
      />
      <TextField
        label={t("hd.openUntilLabel")}
        value={draft.openUntil}
        inputMode="numeric"
        maxLength={5}
        placeholder="13:00"
        onChange={edit("openUntil")}
        error={draftErrors.openUntil}
        hint={t("hd.openUntilHint")}
        data-testid="hd-open-until"
      />
    </>
  );
}

export function AddHolidayDialog({ a }: { a: Add }) {
  return (
    <Dialog
      open={a.adding}
      onClose={() => !a.addBusy && a.setAdding(false)}
      size="sm"
      testId="hd-add-dialog"
      title={t("hd.addTitle")}
      description={t("hd.addDesc")}
    >
      <form onSubmit={(e) => void a.add(e)} noValidate className="flex flex-col gap-4">
        {a.addError && <FormError error={a.addError} />}
        <fieldset disabled={a.addBusy} className="flex flex-col gap-4">
          <DraftFields a={a} />
        </fieldset>
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => a.setAdding(false)} disabled={a.addBusy}>
            {t("rq.rj.cancel")}
          </Button>
          <Button type="submit" loading={a.addBusy} data-testid="hd-add-submit">
            {!a.addBusy && <Plus aria-hidden className="size-4" />}
            {t("hd.addSubmit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function RemoveHolidayDialog({ r }: { r: Remove }) {
  return (
    <Dialog
      open={r.removing !== null}
      onClose={() => !r.removeBusy && r.setRemoving(null)}
      size="sm"
      role="alertdialog"
      testId="hd-remove-dialog"
      title={t("hd.removeTitle")}
      description={r.removing ? t("hd.removeBody", { name: r.removing.name, day: formatDayLong(r.removing.day) }) : undefined}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={() => r.setRemoving(null)} disabled={r.removeBusy} className="sm:ml-auto">
            {t("rq.rj.cancel")}
          </Button>
          <Button variant="danger" loading={r.removeBusy} onClick={() => void r.remove()} data-testid="hd-remove-confirm">
            {!r.removeBusy && <Trash2 aria-hidden className="size-4" />}
            {t("hd.removeConfirm")}
          </Button>
        </>
      }
    >
      {r.removeError && <FormError error={r.removeError} />}
    </Dialog>
  );
}
