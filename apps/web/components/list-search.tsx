"use client";

import { LoaderCircle, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { searchTerm } from "@/lib/customers/query";

const SEARCH_DELAY_MS = 300;

/**
 * Liste araması (kullanıcı / müşteri / firma): en az 2 karakterde 300 ms sonra `go(q)`; 1 karakterde arama yapılmaz
 * (önceki sonuç kalır), boşaltınca arama kalkar, değer URL'dekiyle aynıysa gidilmez. `submit` (Enter) beklemeden gider.
 */
export function useListSearch(
  current: string | undefined,
  go: (q: string | undefined) => void,
  /** Liste sözleşmesine özgü doğrulama (ör. cihaz araması ≤ 64); varsayılan 2..100 karakter. */
  term: (raw: string) => string | undefined = searchTerm,
) {
  const [text, setText] = useState(current ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const onText = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    const q = term(v);
    if ((q === undefined && v.trim() !== "") || q === current) return;
    timer.current = setTimeout(() => go(q), SEARCH_DELAY_MS);
  };
  const submit = () => {
    if (timer.current) clearTimeout(timer.current);
    const q = term(text);
    if (q !== undefined || text.trim() === "") go(q);
  };
  const short = text.trim() !== "" && term(text) === undefined;
  return { text, onText, submit, short };
}

/**
 * Arama alanı (büyüteç + bekleme çarkı). `hint` verilirse alt satırda ipucu / "en az 2 karakter" uyarısı
 * (`aria-describedby`) gösterilir ve Enter aramayı hemen yapar.
 */
export function ListSearch({
  label,
  placeholder,
  testId,
  search,
  pending,
  hint,
  maxLength = 100,
}: {
  label: string;
  placeholder: string;
  testId: string;
  search: ReturnType<typeof useListSearch>;
  pending: boolean;
  hint?: { normal: string; short: string };
  /** Sözleşmedeki arama üst sınırı (kod birimi); girdi bunu aşamaz → filtre sessizce düşmez. */
  maxLength?: number;
}) {
  const id = useId();
  const { short } = search;
  return (
    <div className="flex w-full max-w-md flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
        <input
          id={id}
          type="search"
          value={search.text}
          maxLength={maxLength}
          autoComplete="off"
          placeholder={placeholder}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => search.onText(e.target.value)}
          onKeyDown={
            hint &&
            ((e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search.submit();
              }
            })
          }
          data-testid={testId}
          className="min-h-11 w-full rounded-md border border-border bg-surface pr-10 pl-9 text-base text-fg shadow-sm placeholder:text-fg-muted focus-visible:border-ring sm:text-sm"
        />
        {pending && <LoaderCircle aria-hidden className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-fg-muted" />}
      </div>
      {hint && (
        <p id={`${id}-hint`} className={`text-xs ${short ? "text-warning" : "text-fg-muted"}`} role={short ? "status" : undefined}>
          {short ? hint.short : hint.normal}
        </p>
      )}
    </div>
  );
}
