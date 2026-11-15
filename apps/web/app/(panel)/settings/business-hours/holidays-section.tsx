"use client";

import { CalendarOff, CalendarPlus, Plus, RotateCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select-field";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDayLong } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  buildHoliday,
  HOLIDAYS_MAX,
  holidayYears,
  sortHolidays,
  TR_HOLIDAY_YEARS,
  type HolidayDraft,
  type HolidayImportResponse,
  type HolidayItem,
  type HolidayListResponse,
} from "@/lib/requests/business-hours";

type Load = "loading" | "error" | "ready";
const emptyDraft = (year: number): HolidayDraft => ({ day: `${year}-01-01`, name: "", openUntil: "" });

/**
 * Tatiller (AC-258; §8b.8): yıl seçimi, liste, ekle, sil (onaylı), "Resmî tatilleri ekle (yıl)". Firma başına en çok
 * `HOLIDAYS_MAX` gün (sunucu 409). `canEdit` yoksa yalnız liste.
 */
export function HolidaysSection({ initialYear, canEdit }: { initialYear: number; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [year, setYear] = useState(initialYear);
  const [load, setLoad] = useState<Load>("loading");
  const [items, setItems] = useState<HolidayItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<HolidayDraft>(() => emptyDraft(initialYear));
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState<UiError | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [removing, setRemoving] = useState<HolidayItem | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<UiError | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<UiError | null>(null);
  const seq = useRef(0);

  const unauth = useCallback(
    (e: unknown) => {
      if (!isUnauthenticated(e)) return false;
      router.replace(EXPIRED_LOGIN_PATH);
      return true;
    },
    [router],
  );

  const fetchYear = useCallback(
    async (y: number) => {
      const my = ++seq.current;
      try {
        const r = await api<HolidayListResponse>("GET", `/settings/holidays?year=${y}`);
        if (my !== seq.current) return;
        setItems(sortHolidays(r.items));
        setLoad("ready");
      } catch (e) {
        if (my !== seq.current || unauth(e)) return;
        setLoad("error");
      }
    },
    [unauth],
  );

  useEffect(() => {
    const id = setTimeout(() => void fetchYear(year), 0);
    return () => clearTimeout(id);
  }, [year, fetchYear]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const { input, errors } = buildHoliday(draft);
    setDraftErrors(errors);
    setAddError(null);
    if (!input) return;
    setAddBusy(true);
    try {
      const it = await api<HolidayItem>("POST", "/settings/holidays", input);
      if (it.day.startsWith(String(year))) setItems((xs) => sortHolidays([...xs, it]));
      setAdding(false);
      setDraft(emptyDraft(year));
      toast(t("hd.added", { name: it.name }));
    } catch (err) {
      if (unauth(err)) return;
      if (err instanceof ApiError && err.status === 400 && err.fields) setDraftErrors(err.fields);
      else if (err instanceof ApiError && err.status === 409)
        setAddError({ message: err.message, tone: "danger", requestId: err.requestId });
      else setAddError(toUiError(err));
    } finally {
      setAddBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await api("DELETE", `/settings/holidays/${removing.id}`);
      setItems((xs) => xs.filter((x) => x.id !== removing.id));
      toast(t("hd.removed", { name: removing.name }));
      setRemoving(null);
    } catch (err) {
      if (unauth(err)) return;
      if (err instanceof ApiError && err.status === 404) {
        setItems((xs) => xs.filter((x) => x.id !== removing.id));
        setRemoving(null);
        toast(t("hd.gone"), "danger");
      } else setRemoveError(toUiError(err));
    } finally {
      setRemoveBusy(false);
    }
  };

  const importTr = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const r = await api<HolidayImportResponse>("POST", "/settings/holidays/import-tr", { year });
      toast(t("hd.imported", { added: r.added, skipped: r.skipped }));
      await fetchYear(year);
    } catch (err) {
      if (unauth(err)) return;
      setImportError(err instanceof ApiError && err.status === 409 ? { message: err.message, tone: "danger" } : toUiError(err));
    } finally {
      setImporting(false);
    }
  };

  const trAvailable = TR_HOLIDAY_YEARS.includes(year);
  const openAdd = () => {
    setDraft(emptyDraft(year));
    setDraftErrors({});
    setAddError(null);
    setAdding(true);
  };

  return (
    <section aria-labelledby="hd-h" className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6" data-testid="hd-section">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="hd-h" className="flex items-center gap-2 text-base font-semibold text-fg">
          <CalendarOff aria-hidden className="size-5 text-fg-muted" />
          {t("hd.title")}
        </h2>
        <SelectField
          label={t("hd.year")}
          className="sm:w-40"
          value={String(year)}
          onChange={(e) => {
            const y = Number(e.target.value);
            if (y === year) return;
            setLoad("loading");
            setYear(y);
          }}
          options={holidayYears(initialYear).map((y) => ({ value: String(y), label: String(y) }))}
          data-testid="hd-year"
        />
      </div>
      <p className="mt-2 text-sm text-fg-muted">{t("hd.body", { max: HOLIDAYS_MAX })}</p>

      {canEdit && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" onClick={openAdd} data-testid="hd-add-open">
            <Plus aria-hidden className="size-4" />
            {t("hd.add")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void importTr()}
            loading={importing}
            disabled={!trAvailable}
            aria-describedby={!trAvailable ? "hd-tr-na" : undefined}
            data-testid="hd-import"
          >
            {!importing && <CalendarPlus aria-hidden className="size-4" />}
            {t("hd.import", { year })}
          </Button>
        </div>
      )}
      {canEdit && !trAvailable && (
        <p id="hd-tr-na" className="mt-2 text-xs text-fg-muted">
          {t("hd.importNa", { years: TR_HOLIDAY_YEARS.join(", ") })}
        </p>
      )}
      {importError && (
        <div className="mt-3">
          <FormError error={importError} />
        </div>
      )}

      <div className="mt-4" data-testid="hd-list" data-state={load}>
        {load === "loading" ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <span className="sr-only" role="status">
              {t("hd.loading")}
            </span>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : load === "error" ? (
          <div className="flex flex-col items-start gap-2" data-testid="hd-error">
            <Alert tone="danger">{t("hd.loadError")}</Alert>
            <Button
              variant="secondary"
              onClick={() => {
                setLoad("loading");
                void fetchYear(year);
              }}
            >
              <RotateCw aria-hidden className="size-4" />
              {t("err.retry")}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-md bg-canvas px-4 py-8 text-center text-sm" data-testid="hd-empty">
            <CalendarOff aria-hidden className="size-6 text-fg-muted" />
            <p className="font-medium text-fg">{t("hd.emptyTitle", { year })}</p>
            <p className="text-fg-muted">{canEdit ? t("hd.emptyBody") : t("hd.emptyBodyRo")}</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label={t("hd.listLabel", { year })}>
            {items.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2" data-testid="hd-row">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg wrap-anywhere">{h.name}</p>
                  <p className="text-xs text-fg-muted">
                    <time dateTime={h.day}>{formatDayLong(h.day)}</time> ·{" "}
                    {h.openUntil ? t("hd.openUntil", { at: h.openUntil }) : t("hd.fullDay")}
                  </p>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setRemoveError(null);
                      setRemoving(h);
                    }}
                    aria-label={t("hd.removeFor", { name: h.name })}
                    data-testid="hd-remove"
                    className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-danger-surface hover:text-danger"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={adding}
        onClose={() => !addBusy && setAdding(false)}
        size="sm"
        testId="hd-add-dialog"
        title={t("hd.addTitle")}
        description={t("hd.addDesc")}
      >
        <form onSubmit={(e) => void add(e)} noValidate className="flex flex-col gap-4">
          {addError && <FormError error={addError} />}
          <fieldset disabled={addBusy} className="flex flex-col gap-4">
            <TextField
              label={t("hd.day")}
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              value={draft.day}
              onChange={(e) => setDraft((d) => ({ ...d, day: e.target.value }))}
              error={draftErrors.day}
              data-autofocus
              data-testid="hd-day"
            />
            <TextField
              label={t("hd.name")}
              value={draft.name}
              maxLength={100}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              error={draftErrors.name}
              data-testid="hd-name"
            />
            <TextField
              label={t("hd.openUntilLabel")}
              value={draft.openUntil}
              inputMode="numeric"
              maxLength={5}
              placeholder="13:00"
              onChange={(e) => setDraft((d) => ({ ...d, openUntil: e.target.value }))}
              error={draftErrors.openUntil}
              hint={t("hd.openUntilHint")}
              data-testid="hd-open-until"
            />
          </fieldset>
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setAdding(false)} disabled={addBusy}>
              {t("rq.rj.cancel")}
            </Button>
            <Button type="submit" loading={addBusy} data-testid="hd-add-submit">
              {!addBusy && <Plus aria-hidden className="size-4" />}
              {t("hd.addSubmit")}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={removing !== null}
        onClose={() => !removeBusy && setRemoving(null)}
        size="sm"
        role="alertdialog"
        testId="hd-remove-dialog"
        title={t("hd.removeTitle")}
        description={removing ? t("hd.removeBody", { name: removing.name, day: formatDayLong(removing.day) }) : undefined}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setRemoving(null)} disabled={removeBusy} className="sm:ml-auto">
              {t("rq.rj.cancel")}
            </Button>
            <Button variant="danger" loading={removeBusy} onClick={() => void remove()} data-testid="hd-remove-confirm">
              {!removeBusy && <Trash2 aria-hidden className="size-4" />}
              {t("hd.removeConfirm")}
            </Button>
          </>
        }
      >
        {removeError && <FormError error={removeError} />}
      </Dialog>
    </section>
  );
}
