"use client";

import { useId } from "react";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { CUSTOMER_NOTE_MAX } from "@/lib/customers/contract";
import { codePointLength } from "@/lib/customers/form";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { REQUEST_PRIORITIES } from "@/lib/requests/p18";
import { labelOf, PRIORITY_LABELS } from "@remote/contracts/labels";
import { SLA_MINUTES_MAX, SLA_MINUTES_MIN } from "@remote/contracts/api/requests";
import type { CustomerFormState } from "./use-customer-form";

type F = { f: CustomerFormState };

/** Ad, dosya etiketi, yetkili, telefon, e-posta. */
export function ContactFields({ f }: F) {
  const { d, errors, set } = f;
  return (
    <>
      <TextField
        label={t("cu.f.name")}
        value={d.name}
        onChange={set("name")}
        error={errors.name}
        maxLength={100}
        autoComplete="organization"
        required
        data-autofocus
        data-testid="cf-name"
      />
      <TextField
        label={t("cu.f.fileLabel")}
        value={d.fileLabel}
        onChange={set("fileLabel")}
        error={errors.fileLabel}
        maxLength={20}
        autoComplete="off"
        spellCheck={false}
        hint={t("cu.f.fileLabelHint", { label: d.fileLabel || "…" })}
        data-testid="cf-label"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("cu.f.contact")}
          value={d.contactName}
          onChange={set("contactName")}
          error={errors.contactName}
          maxLength={80}
          autoComplete="name"
          data-testid="cf-contact"
        />
        <TextField
          label={t("cu.f.phone")}
          type="tel"
          value={d.phone}
          onChange={set("phone")}
          error={errors.phone}
          maxLength={40}
          autoComplete="tel"
          hint={t("cu.f.phoneHint")}
          data-testid="cf-phone"
        />
      </div>
      <TextField
        label={t("cu.f.email")}
        type="email"
        value={d.email}
        onChange={set("email")}
        error={errors.email}
        maxLength={254}
        autoComplete="email"
        data-testid="cf-email"
      />
    </>
  );
}

/** Not alanı: karakter sayacı (sınır yaklaşınca canlı bölge), sınır aşılınca alan hatalı görünür. */
export function NoteField({ f }: F) {
  const noteId = useId();
  const { d, errors, set } = f;
  const noteLen = codePointLength(d.note);
  const noteOver = noteLen > CUSTOMER_NOTE_MAX;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={noteId} className="text-sm font-medium text-fg">
        {t("cu.f.note")}
      </label>
      <textarea
        id={noteId}
        rows={4}
        value={d.note}
        onChange={set("note")}
        aria-invalid={errors.note || noteOver ? true : undefined}
        aria-describedby={`${noteId}-c${errors.note ? ` ${noteId}-e` : ""}`}
        data-testid="cf-note"
        className={`w-full resize-y rounded-md border bg-surface px-3 py-2 text-base text-fg shadow-sm focus-visible:border-ring disabled:opacity-60 sm:text-sm ${errors.note || noteOver ? "border-danger" : "border-border"}`}
      />
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        {errors.note ? (
          <p id={`${noteId}-e`} className="font-medium text-danger">
            {errors.note}
          </p>
        ) : (
          <span className="text-fg-muted">{t("cu.f.noteHint")}</span>
        )}
        <p
          id={`${noteId}-c`}
          className={`tabular-nums ${noteOver ? "font-medium text-danger" : "text-fg-muted"}`}
          aria-live={noteLen > CUSTOMER_NOTE_MAX - 100 ? "polite" : "off"}
        >
          {t("h.n.count", { n: formatNumber(noteLen), max: formatNumber(CUSTOMER_NOTE_MAX) })}
        </p>
      </div>
    </div>
  );
}

/** P18 (AC-257): müşteri varsayılan önceliği ve SLA hedefi — boş = firma varsayılanı. */
export function SlaFields({ f }: F) {
  const { d, errors, set } = f;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        label={t("cu.f.priority")}
        value={d.defaultPriority}
        onChange={set("defaultPriority")}
        error={errors.defaultPriority}
        options={[
          { value: "", label: t("cu.f.priorityDefault") },
          ...[...REQUEST_PRIORITIES].reverse().map((p) => ({ value: p, label: labelOf(PRIORITY_LABELS, p) })),
        ]}
        data-testid="cf-priority"
      />
      <TextField
        label={t("cu.f.sla")}
        type="number"
        inputMode="numeric"
        min={SLA_MINUTES_MIN}
        max={SLA_MINUTES_MAX}
        value={d.slaMinutes}
        onChange={set("slaMinutes")}
        error={errors.slaMinutes}
        hint={t("cu.f.slaHint", { min: SLA_MINUTES_MIN, max: SLA_MINUTES_MAX })}
        data-testid="cf-sla"
      />
    </div>
  );
}
