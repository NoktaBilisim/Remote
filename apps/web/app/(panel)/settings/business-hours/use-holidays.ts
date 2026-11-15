"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { t } from "@/lib/i18n";
import {
  buildHoliday,
  sortHolidays,
  type HolidayDraft,
  type HolidayImportResponse,
  type HolidayItem,
  type HolidayListResponse,
} from "@/lib/requests/business-hours";

type Load = "loading" | "error" | "ready";
type SetItems = (fn: (xs: HolidayItem[]) => HolidayItem[]) => void;
const emptyDraft = (year: number): HolidayDraft => ({ day: `${year}-01-01`, name: "", openUntil: "" });

/** Yıla göre liste: yıl değişince yeniden çekilir; eski yanıtlar (`seq`) yok sayılır. */
export function useHolidayList(initialYear: number, unauth: (e: unknown) => boolean) {
  const [year, setYear] = useState(initialYear);
  const [load, setLoad] = useState<Load>("loading");
  const [items, setItems] = useState<HolidayItem[]>([]);
  const seq = useRef(0);

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

  const changeYear = (y: number) => {
    if (y === year) return;
    setLoad("loading");
    setYear(y);
  };
  const retry = () => {
    setLoad("loading");
    void fetchYear(year);
  };
  return { year, load, items, setItems, fetchYear, changeYear, retry };
}

function useAddState(year: number) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<HolidayDraft>(() => emptyDraft(year));
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState<UiError | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const openAdd = () => {
    setDraft(emptyDraft(year));
    setDraftErrors({});
    setAddError(null);
    setAdding(true);
  };
  return { adding, setAdding, draft, setDraft, draftErrors, setDraftErrors, addError, setAddError, addBusy, setAddBusy, openAdd };
}

/** Tatil ekleme diyaloğu: taslak, doğrulama, POST (409 = sınır, metin sunucudan). */
export function useHolidayAdd(year: number, setItems: SetItems, unauth: (e: unknown) => boolean) {
  const toast = useToast();
  const s = useAddState(year);
  const { draft, setDraftErrors, setAddError, setAddBusy, setAdding, setDraft } = s;

  const add = async (e: FormEvent) => {
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
  return { ...s, add };
}

/** Tatil silme onayı: DELETE; 404 → listeden düşür + "zaten silinmiş" bildirimi. */
export function useHolidayRemove(setItems: SetItems, unauth: (e: unknown) => boolean) {
  const toast = useToast();
  const [removing, setRemoving] = useState<HolidayItem | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<UiError | null>(null);

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
  const ask = (h: HolidayItem) => {
    setRemoveError(null);
    setRemoving(h);
  };
  return { removing, setRemoving, removeBusy, removeError, remove, ask };
}

/** "Resmî tatilleri ekle (yıl)": POST import-tr, sonra listeyi yenile (409 metni sunucudan). */
export function useHolidayImport(year: number, fetchYear: (y: number) => Promise<void>, unauth: (e: unknown) => boolean) {
  const toast = useToast();
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<UiError | null>(null);

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
  return { importing, importError, importTr };
}
