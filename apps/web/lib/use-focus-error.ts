"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Doğrulama hatasından sonra ilk hatalı alana (`aria-invalid="true"`) odak: `focusError()` her çağrıda sayaç artırır,
 * çizimden sonra efekt formdaki ilk hatalı alanı odaklar. `formRef` form öğesine verilir.
 */
export function useFocusFirstError() {
  const formRef = useRef<HTMLFormElement>(null);
  const [focusErr, setFocusErr] = useState(0);
  useEffect(() => {
    if (focusErr) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusErr]);
  return { formRef, focusError: () => setFocusErr((n) => n + 1) };
}

/**
 * Tek alana odak: `focus()` her çağrıda sayaç artırır, çizimden sonra efekt `ref` öğesini odaklar (ör. doğrulama
 * hatası olan belirli bir alan). Birden çok alan için ayrı ayrı çağrılır; efektler çağrı sırasıyla çalışır.
 */
export function useFocusOn<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n) ref.current?.focus();
  }, [n]);
  return { ref, focus: () => setN((x) => x + 1) };
}
