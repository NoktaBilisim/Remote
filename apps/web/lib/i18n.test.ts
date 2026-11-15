import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * JSON.parse yinelenen anahtarı sessizce yutar (son değer kazanır) → aynı önekli iki ekran birbirinin metnini ezer
 * (P19: send-link "sl.none" ↔ sistem logosu "sl.none"). Ham metinden sayılır.
 */
describe("messages/tr.json", () => {
  it("yinelenen anahtar yok", () => {
    const raw = readFileSync(fileURLToPath(new URL("../messages/tr.json", import.meta.url)), "utf8");
    const keys = [...raw.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)].map((m) => m[1] ?? "");
    const seen = new Set<string>();
    const dups = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    expect(keys.length).toBeGreaterThan(100);
    expect(dups).toEqual([]);
  });
});
