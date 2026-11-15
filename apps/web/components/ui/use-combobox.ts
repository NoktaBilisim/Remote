"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { COMBO_DEBOUNCE_MS, comboKey, type ComboAction } from "@/lib/combobox";
import type { ComboboxProps, ComboOption, ComboStatus } from "./combobox";

/** Seçenek yükleme: önceki istek iptal, gecikmeli yazım araması; söküldüğünde zamanlayıcı + istek temizlenir. */
function useComboData(load: ComboboxProps["load"], debounceMs: number) {
  const [items, setItems] = useState<ComboOption[]>([]);
  const [status, setStatus] = useState<ComboStatus>("idle");
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrl = useRef<AbortController | null>(null);

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
    timer.current = setTimeout(() => fetchNow(q), debounceMs);
  };
  return { items, status, setStatus, active, setActive, fetchNow, schedule };
}

/** Metin alanı; dışarıdan değişen seçim (ör. filtre sıfırlandı) metne yansır (çizim sırasında, efektsiz). */
function useComboText(value: ComboOption | null) {
  const [text, setText] = useState(value?.label ?? "");
  const valueLabel = value?.label ?? "";
  const valueKey = `${value?.id ?? ""}|${valueLabel}`;
  const [seenKey, setSeenKey] = useState(valueKey);
  if (seenKey !== valueKey) {
    setSeenKey(valueKey);
    setText(valueLabel);
  }
  return { text, setText, valueLabel };
}
type ComboData = ReturnType<typeof useComboData>;
type ComboText = ReturnType<typeof useComboText>;
type InputRef = React.RefObject<HTMLInputElement | null>;

/** Aç / kapat / seç / temizle / yazım eylemleri. */
function comboActions(p: ComboboxProps, inputRef: InputRef, data: ComboData, txt: ComboText, setOpen: (v: boolean) => void) {
  const { value, onChange, disabled = false } = p;
  const openList = () => {
    if (disabled) return;
    setOpen(true);
    if (data.status === "idle" || data.status === "error") data.fetchNow(value ? "" : txt.text);
  };
  const close = () => {
    setOpen(false);
    data.setActive(-1);
  };
  const select = (o: ComboOption) => {
    onChange(o);
    txt.setText(o.label);
    close();
  };
  const clear = () => {
    onChange(null);
    txt.setText("");
    data.setStatus("idle");
    close();
    inputRef.current?.focus();
  };
  const type = (v: string) => {
    txt.setText(v);
    if (value) onChange(null);
    setOpen(true);
    data.schedule(v);
  };
  return { openList, close, select, clear, type };
}

/** Klavye eylemini (`comboKey`) uygular. */
function runAction(a: ComboAction, act: ReturnType<typeof comboActions>, data: ComboData) {
  if (a.kind === "open") act.openList();
  else if (a.kind === "close") act.close();
  else if (a.kind === "clear") act.clear();
  else if (a.kind === "move") data.setActive(a.to);
  else if (a.kind === "select") {
    const o = data.items[a.index];
    if (o) act.select(o);
  }
}

/** Klavyeyle etkinleşen seçeneği listede görünür kaydırır. */
function useScrollActive(optId: (i: number) => string, active: number) {
  useEffect(() => {
    if (active >= 0) document.getElementById(optId(active))?.scrollIntoView({ block: "nearest" });
    // optId kararlı (useId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

/** Durum + eylemler: aç/kapat, seç, temizle, klavye, yazım, odak kaybı; etkin seçenek görünür kaydırılır. */
export function useCombobox(p: ComboboxProps, inputRef: InputRef) {
  const id = useId();
  const txt = useComboText(p.value);
  const [open, setOpen] = useState(false);
  const data = useComboData(p.load, p.debounceMs ?? COMBO_DEBOUNCE_MS);
  const { items, active } = data;
  const act = comboActions(p, inputRef, data, txt, setOpen);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const a = comboKey(e.key, { open, active, count: items.length, hasText: txt.text !== "" });
    if (a.kind === "none") return;
    if (e.key !== "Tab") e.preventDefault();
    if (e.key === "Escape") e.stopPropagation();
    runAction(a, act, data);
  };
  const blur = () => {
    // inline: liste menünün parçası, odak kaybında kapanmaz (kapanırsa altındaki düğmeler tıklama anında kayar)
    if (!p.inline) act.close();
    txt.setText(txt.valueLabel);
  };

  const optId = (i: number) => `${id}-o${i}`;
  useScrollActive(optId, active);

  const { openList, select, clear, type } = act;
  return {
    id,
    optId,
    text: txt.text,
    open,
    items,
    status: data.status,
    active,
    setActive: data.setActive,
    openList,
    select,
    clear,
    onKey,
    type,
    blur,
  };
}
export type ComboState = ReturnType<typeof useCombobox>;
