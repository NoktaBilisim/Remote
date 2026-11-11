import { describe, expect, it } from "vitest";
import { clearSessionData } from "./session-storage";

function fake(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

describe("clearSessionData (S-P4-4)", () => {
  it("yalnız rs.* anahtarlarını siler", () => {
    const s = fake({ "rs.guestName.01J": "Ayşe", "rs.other": "x", theme: "dark" });
    clearSessionData(s);
    expect([...s.m.keys()]).toEqual(["theme"]);
  });
  it("depolama yoksa/hata verirse sessiz", () => {
    expect(() => clearSessionData(undefined)).not.toThrow();
    expect(() => clearSessionData({ length: 1, key: () => { throw new Error("x"); }, removeItem: () => undefined })).not.toThrow();
  });
});
