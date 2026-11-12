"use client";

import { LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { COMBO_DEBOUNCE_MS, comboKey } from "@/lib/combobox";
import { t } from "@/lib/i18n";

export interface ComboOption {
  id: string;
  label: string;
  /** Satırda ikincil metin (ör. "Pasif"). */
  hint?: string;
}

type Status = "idle" | "loading" | "ready" | "error";

/**
 * Aranabilir seçim kutusu (DESIGN §6 `ui/combobox.tsx`, P8c): WAI-ARIA 1.2 combobox + listbox.
 * `input role=combobox` + `aria-expanded/aria-controls/aria-activedescendant`; ↑/↓/Home/End dolaşır, Enter seçer,
 * Esc kapatır (kapalıyken metni temizler), Tab kapatır. Yazım 300 ms gecikmeyle `load`'u çağırır (önceki istek iptal).
 * Liste anında açılır (sık kullanılan kontrol, animasyonsuz). Seçim yoksa odak kaybında metin seçili değere döner.
 */
export function Combobox({
  label,
  value,
  onChange,
  load,
  placeholder,
  hint,
  error,
  disabled = false,
  hideLabel = false,
  testId,
}: {
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
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ComboOption[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Dışarıdan değişen seçim (ör. filtre sıfırlandı) metne yansır
  const valueId = value?.id ?? null;
  const valueLabel = value?.label ?? "";
  const valueKey = `${valueId ?? ""}|${valueLabel}`;
  const [seenKey, setSeenKey] = useState(valueKey);
  if (seenKey !== valueKey) {
    setSeenKey(valueKey);
    setText(valueLabel);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      ctrl.current?.abort();
    },
    [],
  );

  const fetchNow = useCallback(
    (q: string) => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setStatus("loading");
      load(q.trim(), c.signal).then(
        (r) => {
          if (c.signal.aborted) return;
          setItems(r);
          setActive(-1);
          setStatus("ready");
        },
        () => {
          if (!c.signal.aborted) setStatus("error");
        },
      );
    },
    [load],
  );

  const schedule = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchNow(q), COMBO_DEBOUNCE_MS);
  };

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    if (status === "idle" || status === "error") fetchNow(value ? "" : text);
  };
  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const select = (o: ComboOption) => {
    onChange(o);
    setText(o.label);
    close();
  };
  const clear = () => {
    onChange(null);
    setText("");
    setStatus("idle");
    close();
    inputRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const a = comboKey(e.key, { open, active, count: items.length, hasText: text !== "" });
    if (a.kind === "none") return;
    if (e.key !== "Tab") e.preventDefault();
    if (a.kind === "open") openList();
    else if (a.kind === "close") close();
    else if (a.kind === "clear") clear();
    else if (a.kind === "move") setActive(a.to);
    else if (a.kind === "select") {
      const o = items[a.index];
      if (o) select(o);
    }
  };

  const optId = (i: number) => `${id}-o${i}`;
  useEffect(() => {
    if (active >= 0) document.getElementById(optId(active))?.scrollIntoView({ block: "nearest" });
    // optId kararlı (useId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const showHint = Boolean(hint) && !error;
  const describedBy = [showHint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <label htmlFor={`${id}-in`} className={hideLabel ? "sr-only" : "text-sm font-medium text-fg"}>
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={`${id}-in`}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          placeholder={placeholder}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (value) onChange(null);
            setOpen(true);
            schedule(e.target.value);
          }}
          onClick={openList}
          onKeyDown={onKey}
          onBlur={() => {
            close();
            setText(valueLabel);
          }}
          className={`min-h-11 w-full rounded-md border bg-surface pr-12 pl-3 text-base text-fg shadow-sm placeholder:text-fg-muted focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm ${
            error ? "border-danger" : "border-border"
          }`}
        />
        {(text !== "" || value) && !disabled && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            aria-label={t("combo.clear")}
            className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-md text-fg-muted hover:text-fg"
          >
            <X aria-hidden className="size-4" />
          </button>
        )}
        {open && (
          <div className="absolute top-full right-0 left-0 z-30 mt-1 rounded-md border border-border bg-surface p-1 shadow-lg">
            <ul id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
              {status !== "loading" &&
                items.map((o, i) => (
                  <li
                    key={o.id}
                    id={optId(i)}
                    role="option"
                    aria-selected={i === active || value?.id === o.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(o)}
                    onMouseMove={() => setActive(i)}
                    className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 text-sm ${
                      i === active ? "bg-surface-muted text-fg" : "text-fg"
                    } ${value?.id === o.id ? "font-semibold" : ""}`}
                  >
                    <span className="min-w-0 truncate">{o.label}</span>
                    {o.hint && <span className="shrink-0 text-xs text-fg-muted">{o.hint}</span>}
                  </li>
                ))}
            </ul>
            <p role="status" className={status === "idle" || (status === "ready" && items.length > 0) ? "sr-only" : "flex min-h-11 items-center gap-2 px-3 text-sm text-fg-muted"}>
              {status === "loading" && (
                <>
                  <LoaderCircle aria-hidden className="size-4 animate-spin" />
                  {t("combo.loading")}
                </>
              )}
              {status === "ready" && (items.length === 0 ? t("combo.empty") : t("combo.count", { n: items.length }))}
              {status === "error" && t("combo.error")}
            </p>
          </div>
        )}
      </div>
      {showHint && (
        <p id={`${id}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
