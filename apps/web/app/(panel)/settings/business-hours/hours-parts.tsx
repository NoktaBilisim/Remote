"use client";

import { CircleCheck, CopyCheck, Globe, MoonStar, Plus, Trash2 } from "lucide-react";
import { useCallback, useId, useMemo } from "react";
import { AFTER_HOURS_MODE_LABELS, labelOf } from "@remote/contracts/labels";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { TextField } from "@/components/ui/text-field";
import { formatDateTimeInZone } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import {
  AFTER_HOURS_MODES,
  BUSINESS_DAY_INTERVALS_MAX,
  copyMondayToWeekdays,
  filterTimeZones,
  nextInterval,
  timeZoneList,
  type BusinessHoursView,
} from "@/lib/requests/business-hours";
import type { HoursForm } from "./use-business-hours";

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Önizleme: kaydedilmiş takvime göre şu an açık mı + sonraki açılış (sunucu hesaplar; firma saat diliminde). */
export function Preview({ saved, dirty }: { saved: BusinessHoursView; dirty: boolean }) {
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

/** Saat dilimi (combobox, istemcide süzülür). */
export function TimeZoneField({ f: { st, set, clearErr, err, busy }, canEdit }: { f: HoursForm; canEdit: boolean }) {
  const zones = useMemo(() => timeZoneList(), []);
  const tzValue: ComboOption | null = st.timeZone ? { id: st.timeZone, label: st.timeZone } : null;
  const loadZones = useCallback(async (q: string) => filterTimeZones(zones, q).map((z) => ({ id: z, label: z })), [zones]);
  return (
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
  );
}

/** Mesai dışı modu (radyo grubu) + seçili modun açıklaması. */
export function ModeField({ f: { st, set } }: { f: HoursForm }) {
  const modeId = useId();
  return (
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
  );
}

type Slot = { f: HoursForm; i: number; j: number; name: string; iv: HoursForm["st"]["week"][number][number] };

/** Aralığın başlangıç / bitiş saati alanı. */
function TimeField({ f: { setDay, clearErr, err }, i, j, name, iv, edge }: Slot & { edge: "from" | "to" }) {
  const key = `week.${i}.${j}.${edge}`;
  return (
    <TextField
      label={t(`bh.${edge}`, { day: name, n: j + 1 })}
      className="w-24 [&>label]:sr-only"
      value={iv[edge]}
      inputMode="numeric"
      maxLength={5}
      placeholder={edge === "from" ? "09:00" : "18:00"}
      error={err(key)}
      onChange={(e) => {
        setDay(i, (d) => d.map((x, k) => (k === j ? { ...x, [edge]: e.target.value } : x)));
        clearErr(key);
      }}
    />
  );
}

function IntervalRow(p: Slot) {
  return (
    <div className="flex items-start gap-2">
      <TimeField {...p} edge="from" />
      <span aria-hidden className="pt-2.5 text-fg-muted">
        –
      </span>
      <TimeField {...p} edge="to" />
      <button
        type="button"
        onClick={() => p.f.setDay(p.i, (d) => d.filter((_, k) => k !== p.j))}
        aria-label={t("bh.removeInterval", { day: p.name, n: p.j + 1 })}
        className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-danger-surface hover:text-danger disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Trash2 aria-hidden className="size-4" />
      </button>
    </div>
  );
}

function DayRow({ f, i }: { f: HoursForm; i: number }) {
  const day = f.st.week[i] ?? [];
  const name = t(`bh.day.${i}` as MessageKey);
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start" data-testid="bh-day" data-day={i}>
      <p className="w-28 shrink-0 pt-2.5 text-sm font-medium text-fg">{name}</p>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {day.length === 0 && (
          <p className="pt-2.5 text-sm text-fg-muted" data-testid="bh-day-closed">
            {t("bh.closed")}
          </p>
        )}
        {day.map((iv, j) => (
          <IntervalRow key={j} f={f} i={i} j={j} name={name} iv={iv} />
        ))}
      </div>
      {day.length < BUSINESS_DAY_INTERVALS_MAX && (
        <Button
          type="button"
          variant="ghost"
          className="self-start"
          aria-label={t("bh.addIntervalFor", { day: name })}
          onClick={() => f.setDay(i, (d) => [...d, nextInterval(d)])}
        >
          <Plus aria-hidden className="size-4" />
          {t("bh.addInterval")}
        </Button>
      )}
    </li>
  );
}

/** Haftalık takvim: gün başına en çok 2 aralık + "Pazartesiyi hafta içine kopyala". */
export function WeekField({ f }: { f: HoursForm }) {
  return (
    <fieldset className="flex flex-col gap-3" data-testid="bh-week">
      <legend className="mb-1 text-sm font-medium text-fg">{t("bh.days")}</legend>
      {f.err("week") && (
        <p className="text-sm font-medium text-danger" role="alert" data-testid="bh-week-error">
          {f.err("week")}
        </p>
      )}
      <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
        {DAYS.map((i) => (
          <DayRow key={i} f={f} i={i} />
        ))}
      </ol>
      <p className="text-xs text-fg-muted">{t("bh.dayHint")}</p>
      <Button type="button" variant="secondary" className="self-start" onClick={() => f.setSt((s) => copyMondayToWeekdays(s))}>
        <CopyCheck aria-hidden className="size-4" />
        {t("bh.copyMonday")}
      </Button>
    </fieldset>
  );
}
