import { describe, expect, it } from "vitest";
import { UNSAFE_NAME_CHARS, joinSessionInputSchema } from "../src/api/sessions.ts";

const base = {
  joinNonce: "a".repeat(43),
  consentTextId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
  consentAccepted: true as const,
};

describe("joinSessionInputSchema.customerName (S-P4-3, S-P4-T2-1)", () => {
  const unsafe: Array<[string, string]> = [
    ["NUL", "Ay\u0000şe"],
    ["BEL", "Ayşe\u0007"],
    ["C1 NEL", "Ay\u0085şe"],
    ["LF (trim öncesi)", "Ayşe\n"],
    ["soft hyphen U+00AD", "Ah­met"],
    ["CGJ U+034F", "Ah͏met"],
    ["ALM U+061C", "؜Ahmet"],
    ["MVS U+180E", "Ahmet᠎"],
    ["ZWSP U+200B", "Ay​şe"],
    ["RLM U+200F", "Ay‏şe"],
    ["LINE SEP U+2028", "Ahmet "],
    ["PARA SEP U+2029", "Ah met"],
    ["RLO U+202E", "‮esyA"],
    ["word joiner U+2060", "Ahmet⁠⁠"],
    ["invisible plus U+2064", "Ah⁤met"],
    ["isolate U+2066/2069", "Ayşe⁦x⁩"],
    ["BOM U+FEFF", "﻿Ayşe"],
    ["annotation U+FFF9", "Ah￹met"],
    ["tag U+E0041", "Ahmet\u{E0041}"],
    ["cancel tag U+E007F", "Ahmet\u{E007F}"],
  ];

  it.each(unsafe)("%s reddedilir", (_label, customerName) => {
    expect(UNSAFE_NAME_CHARS.test(customerName)).toBe(true);
    const r = joinSessionInputSchema.safeParse({ ...base, customerName });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === "customerName")).toBe(true);
  });

  it("Türkçe/aksanlı ad ve kenar boşlukları kabul edilir, trim uygulanır", () => {
    for (const name of ["Çağrı Öztürk", "İsmail Şenol", "José García-Núñez", "O'Brien", "李小龙"]) {
      expect(UNSAFE_NAME_CHARS.test(name)).toBe(false);
    }
    const r = joinSessionInputSchema.safeParse({ ...base, customerName: "  Çağrı Öztürk  " });
    expect(r.success).toBe(true);
    expect(r.data?.customerName).toBe("Çağrı Öztürk");
  });

  it("trim sonrası boş/kısa ad reddedilir", () => {
    for (const customerName of ["   ", " a "]) {
      expect(joinSessionInputSchema.safeParse({ ...base, customerName }).success).toBe(false);
    }
  });
});
