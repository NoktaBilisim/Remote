/*
 * `components/ui/combobox.tsx` için saf mantık (WAI-ARIA 1.2 combobox + listbox, DESIGN §6):
 * klavye ile etkin seçenek hareketi ve tuş → eylem eşlemesi. Bileşen testi Playwright'ta; bu kısım Vitest'te.
 */

export type ComboAction =
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "clear" }
  | { kind: "move"; to: number }
  | { kind: "select"; index: number }
  | { kind: "none" };

/** `active` = -1 hiçbiri. Liste kapalıyken ↓/↑ açar; açıkken dolaşır (uçlarda döner). */
export function comboKey(key: string, s: { open: boolean; active: number; count: number; hasText: boolean }): ComboAction {
  switch (key) {
    case "ArrowDown":
      if (!s.open) return { kind: "open" };
      return s.count === 0 ? { kind: "none" } : { kind: "move", to: s.active + 1 >= s.count ? 0 : s.active + 1 };
    case "ArrowUp":
      if (!s.open) return { kind: "open" };
      return s.count === 0 ? { kind: "none" } : { kind: "move", to: s.active <= 0 ? s.count - 1 : s.active - 1 };
    case "Home":
      return s.open && s.count > 0 ? { kind: "move", to: 0 } : { kind: "none" };
    case "End":
      return s.open && s.count > 0 ? { kind: "move", to: s.count - 1 } : { kind: "none" };
    case "Enter":
      return s.open && s.active >= 0 && s.active < s.count ? { kind: "select", index: s.active } : { kind: "none" };
    case "Escape":
      if (s.open) return { kind: "close" };
      return s.hasText ? { kind: "clear" } : { kind: "none" };
    case "Tab":
      return s.open ? { kind: "close" } : { kind: "none" };
    default:
      return { kind: "none" };
  }
}

/** Yazım gecikmesi (mimari-e10 §7 `options`: 300 ms). */
export const COMBO_DEBOUNCE_MS = 300;
