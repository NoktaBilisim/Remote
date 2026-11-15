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

type ComboKeyState = { open: boolean; active: number; count: number; hasText: boolean };

const none = (): ComboAction => ({ kind: "none" });
/** Açık ve dolu listede `to`'ya git; kapalıyken aç; boş listede yok. */
const step = (s: ComboKeyState, to: number): ComboAction => {
  if (!s.open) return { kind: "open" };
  return s.count === 0 ? none() : { kind: "move", to };
};
/** Yalnız açık ve dolu listede `to`'ya git (Home/End). */
const jump = (s: ComboKeyState, to: number): ComboAction => (s.open && s.count > 0 ? { kind: "move", to } : none());

const KEYS = new Map<string, (s: ComboKeyState) => ComboAction>([
  ["ArrowDown", (s) => step(s, s.active + 1 >= s.count ? 0 : s.active + 1)],
  ["ArrowUp", (s) => step(s, s.active <= 0 ? s.count - 1 : s.active - 1)],
  ["Home", (s) => jump(s, 0)],
  ["End", (s) => jump(s, s.count - 1)],
  ["Enter", (s) => (s.open && s.active >= 0 && s.active < s.count ? { kind: "select", index: s.active } : none())],
  ["Escape", (s) => (s.open ? { kind: "close" } : s.hasText ? { kind: "clear" } : none())],
  ["Tab", (s) => (s.open ? { kind: "close" } : none())],
]);

/** `active` = -1 hiçbiri. Liste kapalıyken ↓/↑ açar; açıkken dolaşır (uçlarda döner). */
export function comboKey(key: string, s: ComboKeyState): ComboAction {
  return KEYS.get(key)?.(s) ?? none();
}

/** Yazım gecikmesi (mimari-e10 §7 `options`: 300 ms). */
export const COMBO_DEBOUNCE_MS = 300;
