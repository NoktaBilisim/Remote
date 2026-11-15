"use client";

import { LoaderCircle, X } from "lucide-react";
import { useRef } from "react";
import { t } from "@/lib/i18n";
import { useCombobox, type ComboState } from "./use-combobox";

export interface ComboOption {
  id: string;
  label: string;
  /** Satırda ikincil metin (ör. "Pasif"). */
  hint?: string;
}

export type ComboStatus = "idle" | "loading" | "ready" | "error";

export interface ComboboxProps {
  label: string;
  value: ComboOption | null;
  onChange: (v: ComboOption | null) => void;
  load: (q: string, signal: AbortSignal) => Promise<ComboOption[]>;
  placeholder?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  testId?: string;
  debounceMs?: number;
  openOnFocus?: boolean;
  /** Dışarıdan odak taşımak için (ör. menü açılınca arama alanına). */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** Liste akışta (üstte yüzmez) — menü/panel içinde altındaki öğelerin üstünü örtmesin. */
  inline?: boolean;
}

/** Seçenek listesi + canlı durum satırı (yükleniyor / boş / sayı / hata). */
function ComboList({ c, label, value, inline }: { c: ComboState; label: string; value: ComboOption | null; inline: boolean }) {
  const { items, status, active } = c;
  return (
    <div
      className={
        inline
          ? "mt-1 rounded-md border border-border bg-surface p-1"
          : "absolute top-full right-0 left-0 z-30 mt-1 rounded-md border border-border bg-surface p-1 shadow-lg"
      }
    >
      <ul id={`${c.id}-list`} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
        {status !== "loading" &&
          items.map((o, i) => (
            <li
              key={o.id}
              id={c.optId(i)}
              role="option"
              aria-selected={i === active || value?.id === o.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => c.select(o)}
              onMouseMove={() => c.setActive(i)}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 text-sm ${
                i === active ? "bg-surface-muted text-fg" : "text-fg"
              } ${value?.id === o.id ? "font-semibold" : ""}`}
            >
              <span className="min-w-0 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-xs text-fg-muted">{o.hint}</span>}
            </li>
          ))}
      </ul>
      <ComboStatusLine status={status} count={items.length} />
    </div>
  );
}

function ComboStatusLine({ status, count }: { status: ComboStatus; count: number }) {
  return (
    <p
      role="status"
      className={
        status === "idle" || (status === "ready" && count > 0) ? "sr-only" : "flex min-h-11 items-center gap-2 px-3 text-sm text-fg-muted"
      }
    >
      {status === "loading" && (
        <>
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {t("combo.loading")}
        </>
      )}
      {status === "ready" && (count === 0 ? t("combo.empty") : t("combo.count", { n: count }))}
      {status === "error" && t("combo.error")}
    </p>
  );
}

/** Alanın altındaki ipucu (hata yokken) ve hata satırı. */
function ComboMessages({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  return (
    <>
      {Boolean(hint) && !error && (
        <p id={`${id}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </>
  );
}

/** `role=combobox` metin alanı: `aria-activedescendant` etkin seçenek, `aria-describedby` ipucu/hata. */
function ComboInput({ p, c, inputRef }: { p: ComboboxProps; c: ComboState; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const { error } = p;
  const { id, open, active } = c;
  const describedBy = [Boolean(p.hint) && !error && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <input
      ref={inputRef}
      id={`${id}-in`}
      type="text"
      role="combobox"
      autoComplete="off"
      spellCheck={false}
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={`${id}-list`}
      aria-activedescendant={open && active >= 0 ? c.optId(active) : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      placeholder={p.placeholder}
      disabled={p.disabled ?? false}
      value={c.text}
      onChange={(e) => c.type(e.target.value)}
      onClick={c.openList}
      onFocus={p.openOnFocus ? c.openList : undefined}
      onKeyDown={c.onKey}
      onBlur={c.blur}
      className={`min-h-11 w-full rounded-md border bg-surface pr-12 pl-3 text-base text-fg shadow-sm placeholder:text-fg-muted focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm ${
        error ? "border-danger" : "border-border"
      }`}
    />
  );
}

/** Metni ve seçimi temizler (fare basışı odağı alandan almaz). */
function ClearButton({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClear}
      aria-label={t("combo.clear")}
      className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-md text-fg-muted hover:text-fg"
    >
      <X aria-hidden className="size-4" />
    </button>
  );
}

/**
 * Aranabilir seçim kutusu (DESIGN §6 `ui/combobox.tsx`, P8c): WAI-ARIA 1.2 combobox + listbox.
 * `input role=combobox` + `aria-expanded/aria-controls/aria-activedescendant`; ↑/↓/Home/End dolaşır, Enter seçer,
 * Esc kapatır (kapalıyken metni temizler), Tab kapatır. Yazım `debounceMs` (varsayılan 300 ms; P14b AC-226 firma
 * seçicide 250 ms) gecikmeyle `load`'u çağırır (önceki istek iptal). Esc'yi bileşen işlediyse olay üst öğeye (ör. menü)
 * yayılmaz — açık liste kapanır, menü açık kalır. `openOnFocus`: odaklanınca liste açılır (menü içi seçici).
 * Liste anında açılır (sık kullanılan kontrol, animasyonsuz). Seçim yoksa odak kaybında metin seçili değere döner.
 */
export function Combobox(p: ComboboxProps) {
  const { label, value, disabled = false, inline = false } = p;
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = p.inputRef ?? ownRef;
  const c = useCombobox(p, inputRef);
  const { id, open } = c;

  return (
    <div className="flex flex-col gap-1.5" data-testid={p.testId}>
      <label htmlFor={`${id}-in`} className={p.hideLabel ? "sr-only" : "text-sm font-medium text-fg"}>
        {label}
      </label>
      <div className="relative">
        <ComboInput p={p} c={c} inputRef={inputRef} />
        {(c.text !== "" || value) && !disabled && <ClearButton onClear={c.clear} />}
        {open && <ComboList c={c} label={label} value={value} inline={inline} />}
      </div>
      <ComboMessages id={id} hint={p.hint} error={p.error} />
    </div>
  );
}
