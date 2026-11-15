import { describe, expect, it } from "vitest";
import { mfaVerifyInputSchema, recoveryCodeSchema } from "../src/api/auth.ts";

/** Sunucudaki `normalizeRecoveryCode` (apps/server/src/auth/mfa.ts) ile aynı kural — çıktı oraya aynı değerle iner. */
const serverNormalize = (c: string): string => c.toLowerCase().replace(/[\s-]/g, "");

describe("P10 sözleşme — kurtarma kodu (AC-67)", () => {
  it("boşluk, tire çevresi boşluk ve küçük harf normalize edilir", () => {
    const cases: [string, string][] = [
      ["abcde-23456", "ABCDE-23456"],
      ["ABCDE - 23456", "ABCDE-23456"],
      ["  abcde -23456 ", "ABCDE-23456"],
      ["abcde23456", "ABCDE23456"],
      ["abc de 234 56", "ABCDE23456"],
      ["abcde\t-\n23456", "ABCDE-23456"],
    ];
    for (const [input, out] of cases) {
      const r = recoveryCodeSchema.safeParse(input);
      expect(r.success, input).toBe(true);
      expect(r.data).toBe(out);
      expect(serverNormalize(r.data ?? "")).toBe(serverNormalize("abcde-23456"));
    }
  });

  it("biçim/uzunluk normalize sonrası denetlenir", () => {
    for (const v of ["", "   ", "abcd-23456", "abcde-234567", "abcde--23456", "abcde-2345!", "abcde-12345", "-abcde23456", "abcde23456-"]) {
      expect(recoveryCodeSchema.safeParse(v).success, v).toBe(false);
    }
  });

  it("verify gövdesi: kod ya da kurtarma kodu, ikisi birden değil", () => {
    expect(mfaVerifyInputSchema.safeParse({ recoveryCode: "ABCDE - 23456" })).toMatchObject({
      success: true,
      data: { recoveryCode: "ABCDE-23456" },
    });
    expect(mfaVerifyInputSchema.safeParse({ code: " 123456 " })).toMatchObject({ success: true, data: { code: "123456" } });
    expect(mfaVerifyInputSchema.safeParse({ code: "123456", recoveryCode: "abcde-23456" }).success).toBe(false);
  });
});
