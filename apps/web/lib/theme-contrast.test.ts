import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * Akış görsel dili (2026-11-23, DESIGN.md §2): metin/zemin çiftleri ≥ 4.5:1, ikon/gösterge çiftleri ≥ 3:1 (WCAG AA).
 * Değerler tek kaynaktan (`app/globals.css`) okunur; koyu tema üç seçicide aynı tutulduğu için sınıf ve sistem bloğu denetlenir.
 */
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, `${selector} globals.css'te yok`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start + selector.length - 1);
  const body = css.slice(open + 1, css.indexOf("}", open));
  return Object.fromEntries([...body.matchAll(/--rs-([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const light = block(":root {");
const darkClass = { ...light, ...block(":root.dark,") };
const darkMedia = { ...light, ...block(":root:not(.light) {") };
const themes = { açık: light, "koyu (sınıf)": darkClass, "koyu (sistem)": darkMedia };

const grounds = ["canvas", "surface", "surface-muted"];
/** [metin, zemin] — ≥ 4.5:1 */
const text: [string, string][] = [
  ...["fg", "fg-muted", "primary", "accent-fg", "success", "warning", "danger"].flatMap((f) =>
    grounds.map((g): [string, string] => [f, g]),
  ),
  ["fg", "accent-surface"],
  ["fg-muted", "accent-surface"],
  ["primary", "accent-surface"],
  ["accent-fg", "accent-surface"],
  ["success", "success-surface"],
  ["warning", "warning-surface"],
  ["danger", "danger-surface"],
  ["on-primary", "primary"],
  ["on-primary", "primary-hover"],
  ["on-primary", "danger"],
  ["on-bubble-own", "bubble-own"],
];
/** [ikon/gösterge, zemin] — ≥ 3:1 (Nokta mavisi yalnız ikon/dekor) */
const ui: [string, string][] = [...grounds.map((g): [string, string] => ["accent", g]), ["accent", "accent-surface"]];

describe("Akış: tema kontrastı (WCAG AA)", () => {
  for (const [name, tokens] of Object.entries(themes)) {
    for (const [f, b] of text)
      it(`${name}: ${f} / ${b} ≥ 4.5:1`, () => {
        expect(tokens[f], `--rs-${f}`).toMatch(/^#/);
        expect(tokens[b], `--rs-${b}`).toMatch(/^#/);
        expect(contrast(tokens[f]!, tokens[b]!)).toBeGreaterThanOrEqual(4.5);
      });
    for (const [f, b] of ui)
      it(`${name}: ${f} / ${b} ≥ 3:1`, () => {
        expect(contrast(tokens[f]!, tokens[b]!)).toBeGreaterThanOrEqual(3);
      });
  }

  it("koyu tema değerleri sınıf ve sistem seçicisinde aynı", () => {
    expect(darkMedia).toEqual(darkClass);
  });
});
