import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * AC-221 (WCAG 1.4.11): kapalı ve kilitli anahtar rayı iki temada zemine karşı ≥ 3:1.
 * Değerler tek kaynaktan (`app/globals.css`) okunur; koyu tema üç seçicide aynı tutulduğu için üçü de denetlenir.
 */
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const switchSrc = readFileSync(new URL("../components/ui/switch.tsx", import.meta.url), "utf8");

/** Seçiciden sonraki ilk `{ … }` bloğundaki `--rs-*` değişkenleri. */
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
const tracks = ["switch-track-off", "switch-track-locked"] as const;
const grounds = ["surface", "surface-muted", "canvas"] as const;

describe("AC-221: anahtar rayı kontrastı", () => {
  for (const [name, tokens] of Object.entries(themes)) {
    for (const track of tracks) {
      for (const ground of grounds) {
        it(`AC-221 ${name}: ${track} / ${ground} ≥ 3:1`, () => {
          const fg = tokens[track] ?? "";
          const bg = tokens[ground] ?? "";
          expect(fg, `--rs-${track} tanımlı değil`).toMatch(/^#/);
          expect(bg, `--rs-${ground} tanımlı değil`).toMatch(/^#/);
          expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }

  it("AC-221: koyu tema değerleri sınıf ve sistem seçicisinde aynı", () => {
    for (const track of tracks) expect(darkClass[track]).toBe(darkMedia[track]);
  });

  it("AC-221: kapalı/kilitli ray yeni token'ları kullanır, kilitli anahtar opaklıkla soldurulmaz", () => {
    expect(switchSrc).toContain("bg-switch-track-off");
    expect(switchSrc).toContain("bg-switch-track-locked");
    expect(switchSrc).not.toMatch(/locked \? "cursor-not-allowed opacity-60"/);
  });
});
