"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { t, type MessageKey } from "@/lib/i18n";
import { MAX_RECIPIENTS, MAX_TRUSTED_CIDRS } from "@/lib/requests/contract";
import type { SettingsErrorKey, SettingsState } from "@/lib/requests/settings-form";
import type { SettingsCtx } from "./use-settings-form";

export const errText = (e: SettingsErrorKey | string | undefined): string | undefined =>
  e === undefined ? undefined : e.startsWith("msg:") ? e.slice(4) : t(`srs.err.${e}` as MessageKey);

type ListProps = {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  max: number;
  errors: Record<string, string>;
  errorKey: string;
  placeholder: string;
  addLabel: string;
  removeLabel: (v: string, i: number) => string;
  disabled: boolean;
  testId: string;
  inputMode?: "tel" | "text";
};

/** Tek satır: alan + kaldır düğmesi. */
function ListRow({ p, v, i }: { p: ListProps; v: string; i: number }) {
  return (
    <div className="flex items-start gap-2">
      <TextField
        label={`${p.label} ${i + 1}`}
        className="min-w-0 flex-1 [&>label]:sr-only"
        value={v}
        inputMode={p.inputMode}
        placeholder={p.placeholder}
        disabled={p.disabled}
        error={errText(p.errors[`${p.errorKey}.${i}`])}
        onChange={(e) => p.onChange(p.values.map((x, j) => (j === i ? e.target.value : x)))}
      />
      <button
        type="button"
        disabled={p.disabled}
        onClick={() => p.onChange(p.values.filter((_, j) => j !== i))}
        aria-label={p.removeLabel(v, i)}
        className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-danger-surface hover:text-danger disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Trash2 aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/** Satır listesi düzenleyici (alıcılar / CIDR): satır başına alan + kaldır, en çok `max` satır. */
function ListEditor(p: ListProps) {
  const listErr = errText(p.errors[p.errorKey]);
  const listId = useId();
  return (
    <fieldset className="flex flex-col gap-2" data-testid={p.testId} aria-describedby={listErr ? `${listId}-e` : undefined}>
      <legend className="mb-1 text-sm font-medium text-fg">
        {p.label}{" "}
        <span className="font-normal text-fg-muted tabular-nums">
          ({p.values.length}/{p.max})
        </span>
      </legend>
      {p.values.map((v, i) => (
        <ListRow key={i} p={p} v={v} i={i} />
      ))}
      {listErr && (
        <p id={`${listId}-e`} className="text-xs font-medium text-danger">
          {listErr}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        className="self-start"
        disabled={p.disabled || p.values.length >= p.max}
        onClick={() => p.onChange([...p.values, ""])}
      >
        <Plus aria-hidden className="size-4" />
        {p.addLabel}
      </Button>
    </fieldset>
  );
}

type ListField = "waRecipients" | "mailRecipients" | "trustedCidrs";
const LISTS: Record<
  "wa" | "mail" | "cidr",
  { field: ListField; errorKey: string; max: number; placeholder: string; testId: string; label: MessageKey; inputMode?: "tel" }
> = {
  wa: {
    field: "waRecipients",
    errorKey: "whatsapp.recipients",
    max: MAX_RECIPIENTS,
    placeholder: "0532 000 00 00",
    testId: "wa-recipients",
    label: "srs.wa.recipients",
    inputMode: "tel",
  },
  mail: {
    field: "mailRecipients",
    errorKey: "email.recipients",
    max: MAX_RECIPIENTS,
    placeholder: "destek@ornek.com",
    testId: "mail-recipients",
    label: "srs.mail.recipients",
  },
  cidr: {
    field: "trustedCidrs",
    errorKey: "trustedCidrs",
    max: MAX_TRUSTED_CIDRS,
    placeholder: "203.0.113.0/24",
    testId: "cidr-list",
    label: "srs.cidr.label",
  },
};

/** Ayar formundaki liste alanı (WhatsApp alıcıları, e-posta alıcıları, güvenilen ağlar); metinler `srs.<kind>.*`. */
export function SettingsList({ ctx: { st, set, errors, saving }, kind }: { ctx: SettingsCtx; kind: keyof typeof LISTS }) {
  const c = LISTS[kind];
  return (
    <ListEditor
      label={t(c.label)}
      values={st[c.field]}
      onChange={(v) => set({ [c.field]: v } as Partial<SettingsState>)}
      max={c.max}
      errors={errors}
      errorKey={c.errorKey}
      placeholder={c.placeholder}
      addLabel={t(`srs.${kind}.add`)}
      removeLabel={(v, i) => t(`srs.${kind}.remove`, { v: v || String(i + 1) })}
      disabled={saving}
      testId={c.testId}
      inputMode={c.inputMode}
    />
  );
}
