"use client";

import { CalendarClock, CircleCheck, CopyCheck, Globe, MoonStar, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useId, useMemo, useState } from "react";
import { AFTER_HOURS_MODE_LABELS, labelOf } from "@remote/contracts/labels";
import { FormError } from "@/components/form-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { SaveBar } from "@/components/ui/save-bar";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, EXPIRED_LOGIN_PATH, isUnauthenticated } from "@/lib/api";
import { toUiError, type UiError } from "@/lib/error-message";
import { formatDateTimeInZone } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import {
  AFTER_HOURS_MODES,
  BUSINESS_DAY_INTERVALS_MAX,
  buildHours,
  copyMondayToWeekdays,
  filterTimeZones,
  hoursDirty,
  nextInterval,
  timeZoneList,
  toHoursState,
  type BusinessHoursView,
  type HoursState,
} from "@/lib/requests/business-hours";

const FORM_ID = "business-hours-form";
const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Önizleme: kaydedilmiş takvime göre şu an açık mı + sonraki açılış (sunucu hesaplar; firma saat diliminde). */
function Preview({ saved, dirty }: { saved: BusinessHoursView; dirty: boolean }) {
  const text = !saved.enabled
    ? t("bh.pv.disabled")
    : saved.openNow
      ? t("bh.pv.open")
      : saved.nextOpeningAt
        ? t("bh.pv.closedNext", { at: formatDateTimeInZone(saved.nextOpeningAt, saved.timeZone) })
        : t("bh.pv.closedNever");
  return (
    <div
      role="status"
      data-testid="bh-preview"
      data-open={saved.enabled ? saved.openNow : true}
      className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${
        !saved.enabled || saved.openNow ? "border-success/30 bg-success-surface text-success" : "border-border bg-surface-muted text-fg"
      }`}
    >
      {!saved.enabled || saved.openNow ? (
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      ) : (
        <MoonStar aria-hidden className="mt-0.5 size-4 shrink-0" />
      )}
      <p className="min-w-0">
        <strong className="font-semibold">{text}</strong>
        {dirty && <span className="block text-xs text-fg-muted">{t("bh.pv.savedNote")}</span>}
      </p>
    </div>
  );
}

/**
 * Ayarlar > Mesai saatleri (AC-258): aç/kapa, saat dilimi (combobox, vars. Europe/Istanbul), mesai dışı modu (radyo),
 * gün gün en çok 2 aralık ("24:00" gün sonu). Kirliyken kaydet çubuğu + ayrılma uyarısı; `canEdit` yoksa salt okunur.
 */
export function BusinessHoursForm({ initial, canEdit }: { initial: BusinessHoursView; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [saved, setSaved] = useState(initial);
  const [st, setSt] = useState<HoursState>(() => toHoursState(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const modeId = useId();
  const dirty = canEdit && hoursDirty(st, toHoursState(saved));
  const zones = useMemo(() => timeZoneList(), []);
  const tzValue: ComboOption | null = st.timeZone ? { id: st.timeZone, label: st.timeZone } : null;
  const loadZones = useCallback(async (q: string) => filterTimeZones(zones, q).map((z) => ({ id: z, label: z })), [zones]);

  const set = (p: Partial<HoursState>) => setSt((s) => ({ ...s, ...p }));
  const setDay = (i: number, fn: (d: HoursState["week"][number]) => HoursState["week"][number]) =>
    setSt((s) => ({ ...s, week: s.week.map((d, j) => (j === i ? fn(d) : d)) }));
  const clearErr = (k: string) => setErrors((e) => (e[k] || e.week ? { ...e, [k]: "", week: "" } : e));

  const reset = () => {
    setSt(toHoursState(saved));
    setErrors({});
    setFormError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    const { input, errors: errs } = buildHours(st);
    setErrors(errs);
    setFormError(null);
    if (!input) {
      setFormError({ message: t("srs.fixErrors"), tone: "danger" });
      return;
    }
    setBusy(true);
    try {
      const next = await api<BusinessHoursView>("PUT", "/settings/business-hours", input);
      setSaved(next);
      setSt(toHoursState(next));
      toast(t("bh.saved"));
    } catch (err) {
      if (isUnauthenticated(err)) return router.replace(EXPIRED_LOGIN_PATH);
      if (err instanceof ApiError && err.status === 400 && err.fields) {
        setErrors(err.fields);
        setFormError({ message: t("srs.fixErrors"), tone: "danger" });
      } else setFormError(toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  const err = (k: string) => errors[k] || undefined;

  return (
    <section aria-labelledby="bh-h" className="rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6" data-testid="bh-section">
      <h2 id="bh-h" className="flex items-center gap-2 text-base font-semibold text-fg">
        <CalendarClock aria-hidden className="size-5 text-fg-muted" />
        {t("bh.week.title")}
      </h2>
      <div className="mt-4 flex flex-col gap-4">
        <Preview saved={saved} dirty={dirty} />
        {!canEdit && (
          <Alert tone="info" testId="bh-readonly">
            {t("bh.readonly")}
          </Alert>
        )}
        <form id={FORM_ID} onSubmit={save} noValidate className="flex flex-col gap-5" data-testid="bh-form">
          {formError && <FormError error={formError} />}
          <fieldset disabled={busy || !canEdit} className="flex flex-col gap-5">
            <Switch
              label={t("bh.enabled")}
              checked={st.enabled}
              onChange={(v) => set({ enabled: v })}
              description={t("bh.enabledDesc")}
              onText={t("rq.on")}
              offText={t("rq.off")}
              testId="bh-enabled"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Combobox
                  label={t("bh.tz")}
                  value={tzValue}
                  onChange={(v) => {
                    set({ timeZone: v?.id ?? "" });
                    clearErr("timeZone");
                  }}
                  load={loadZones}
                  debounceMs={0}
                  placeholder="Europe/Istanbul"
                  hint={t("bh.tzHint")}
                  error={err("timeZone")}
                  disabled={busy || !canEdit}
                  testId="bh-tz"
                />
              </div>
              <fieldset className="flex flex-col gap-1.5" aria-describedby={`${modeId}-d`}>
                <legend className="mb-1 flex items-center gap-1.5 text-sm font-medium text-fg">
                  <Globe aria-hidden className="size-4 text-fg-muted" />
                  {t("bh.mode")}
                </legend>
                {AFTER_HOURS_MODES.map((m) => (
                  <label key={m} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fg">
                    <input
                      type="radio"
                      name="afterHoursMode"
                      value={m}
                      checked={st.afterHoursMode === m}
                      onChange={() => set({ afterHoursMode: m })}
                      className="size-4 accent-primary"
                      data-testid={`bh-mode-${m}`}
                    />
                    {labelOf(AFTER_HOURS_MODE_LABELS, m)}
                  </label>
                ))}
                <p id={`${modeId}-d`} className="text-xs text-fg-muted">
                  {st.afterHoursMode === "REJECT" ? t("bh.modeRejectDesc") : t("bh.modeAcceptDesc")}
                </p>
              </fieldset>
            </div>

            <fieldset className="flex flex-col gap-3" data-testid="bh-week">
              <legend className="mb-1 text-sm font-medium text-fg">{t("bh.days")}</legend>
              {err("week") && (
                <p className="text-sm font-medium text-danger" role="alert" data-testid="bh-week-error">
                  {err("week")}
                </p>
              )}
              <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
                {DAYS.map((i) => {
                  const day = st.week[i] ?? [];
                  const name = t(`bh.day.${i}` as MessageKey);
                  return (
                    <li key={i} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start" data-testid="bh-day" data-day={i}>
                      <p className="w-28 shrink-0 pt-2.5 text-sm font-medium text-fg">{name}</p>
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        {day.length === 0 && (
                          <p className="pt-2.5 text-sm text-fg-muted" data-testid="bh-day-closed">
                            {t("bh.closed")}
                          </p>
                        )}
                        {day.map((iv, j) => (
                          <div key={j} className="flex items-start gap-2">
                            <TextField
                              label={t("bh.from", { day: name, n: j + 1 })}
                              className="w-24 [&>label]:sr-only"
                              value={iv.from}
                              inputMode="numeric"
                              maxLength={5}
                              placeholder="09:00"
                              error={err(`week.${i}.${j}.from`)}
                              onChange={(e) => {
                                setDay(i, (d) => d.map((x, k) => (k === j ? { ...x, from: e.target.value } : x)));
                                clearErr(`week.${i}.${j}.from`);
                              }}
                            />
                            <span aria-hidden className="pt-2.5 text-fg-muted">
                              –
                            </span>
                            <TextField
                              label={t("bh.to", { day: name, n: j + 1 })}
                              className="w-24 [&>label]:sr-only"
                              value={iv.to}
                              inputMode="numeric"
                              maxLength={5}
                              placeholder="18:00"
                              error={err(`week.${i}.${j}.to`)}
                              onChange={(e) => {
                                setDay(i, (d) => d.map((x, k) => (k === j ? { ...x, to: e.target.value } : x)));
                                clearErr(`week.${i}.${j}.to`);
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => setDay(i, (d) => d.filter((_, k) => k !== j))}
                              aria-label={t("bh.removeInterval", { day: name, n: j + 1 })}
                              className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-danger-surface hover:text-danger disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Trash2 aria-hidden className="size-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                      {day.length < BUSINESS_DAY_INTERVALS_MAX && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="self-start"
                          aria-label={t("bh.addIntervalFor", { day: name })}
                          onClick={() => setDay(i, (d) => [...d, nextInterval(d)])}
                        >
                          <Plus aria-hidden className="size-4" />
                          {t("bh.addInterval")}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ol>
              <p className="text-xs text-fg-muted">{t("bh.dayHint")}</p>
              <Button type="button" variant="secondary" className="self-start" onClick={() => setSt((s) => copyMondayToWeekdays(s))}>
                <CopyCheck aria-hidden className="size-4" />
                {t("bh.copyMonday")}
              </Button>
            </fieldset>
          </fieldset>
        </form>
      </div>
      <SaveBar dirty={dirty} busy={busy} formId={FORM_ID} onReset={reset} message={t("bh.unsaved")} leaveBody={t("bh.leaveBody")} />
    </section>
  );
}
