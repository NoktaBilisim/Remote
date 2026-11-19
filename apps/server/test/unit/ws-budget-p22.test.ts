// P22-B1 S-P22-1: `fitNewest` — çerçeve (zarf dahil) bütçesi, en yeniden geriye, artan dönüş.
import { describe, expect, it } from "vitest";
import { fitNewest } from "../../src/lib/ws-budget.ts";

const frame = (items: unknown[], more: boolean) => ({ t: "chat.history", items, more });
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

describe("S-P22-1 fitNewest", () => {
  it("S-P22-1: boş liste → boş, more:false", () => {
    expect(fitNewest([], frame, 100)).toEqual({ items: [], more: false });
  });
  it("S-P22-1: hepsi sığarsa aynı sıra, more:false", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(fitNewest(items, frame, 10_000)).toEqual({ items, more: false });
  });
  it("S-P22-1: bütçe dolunca en yeniler kalır, çerçeve tam olarak sınırın altında, more:true", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, body: "😀".repeat(1000) }));
    const out = fitNewest(items, frame, 49_152);
    expect(out.more).toBe(true);
    expect(out.items.at(-1)).toBe(items.at(-1));
    expect(out.items.map((x) => x.id)).toEqual(items.slice(-out.items.length).map((x) => x.id));
    expect(bytes(frame(out.items, true))).toBeLessThanOrEqual(49_152);
    // bir öğe daha eklenseydi aşardı
    expect(bytes(frame(items.slice(-(out.items.length + 1)), true))).toBeGreaterThan(49_152);
  });
  it("S-P22-1: tek öğe bile sığmazsa boş dizi, more:true", () => {
    expect(fitNewest([{ body: "x".repeat(500) }], frame, 100)).toEqual({ items: [], more: true });
  });
});
