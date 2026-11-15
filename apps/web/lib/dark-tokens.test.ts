import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * AC-217 (mimari-e11 §4.3): koyu tema token'ları `globals.css`'te iki yerde yazılır — sınıf seçicisi
 * (`:root.dark, :root:not(.light):has(.theme-dark)`) ve `prefers-color-scheme: dark` içindeki `:root:not(.light)`.
 * CSS'te iki bloğu tek tanımdan üretmenin yolu yok; bu test kopyaların ayrışmasını yakalar (anahtar kümesi + değer).
 */
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** Seçiciden sonraki ilk `{ … }` bloğundaki bildirimler (`--rs-*` ve `color-scheme`), sırasız. */
function decls(selector: string, from = 0): Record<string, string> {
  const start = css.indexOf(selector, from);
  expect(start, `${selector} globals.css'te yok`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start + selector.length - 1);
  const body = css.slice(open + 1, css.indexOf("}", open));
  return Object.fromEntries(
    [...body.matchAll(/(--rs-[\w-]+|color-scheme)\s*:\s*([^;]+);/g)].map((m) => [m[1], (m[2] ?? "").trim().replace(/\s+/g, " ")]),
  );
}

describe("AC-217: koyu tema token kopyaları eşit", () => {
  const cls = decls(":root.dark,");
  const media = decls(":root:not(.light) {", css.indexOf("@media (prefers-color-scheme: dark)"));

  it("AC-217: iki koyu blok aynı anahtar kümesini ve aynı değerleri taşır", () => {
    expect(Object.keys(cls).length).toBeGreaterThan(10);
    expect(Object.keys(media).sort()).toEqual(Object.keys(cls).sort());
    for (const [k, v] of Object.entries(cls)) expect(media[k], k).toBe(v);
  });
});
