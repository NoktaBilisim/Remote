// P14a/P14b sözleşmesi: step-up gövdesi (AC-215), If-Match ayrıştırma (AC-206), firma seçenekleri sorgusu (AC-226).
import { describe, expect, it } from "vitest";
import { stepUpInputSchema } from "../src/api/auth.ts";
import { tenantOptionsQuerySchema } from "../src/api/tenants.ts";
import { parseUserIfMatch, userEtag } from "../src/api/users.ts";
import { ERROR_STATUS } from "../src/errors.ts";

describe("P14a sözleşme", () => {
  it("AC-215: step-up gövdesi TOTP 6 hane ya da normalize edilmiş kurtarma kodu; karışık/eksik ret", () => {
    expect(stepUpInputSchema.safeParse({ method: "TOTP", code: " 123456 " })).toMatchObject({ success: true, data: { code: "123456" } });
    expect(stepUpInputSchema.safeParse({ method: "RECOVERY", code: "abcde - 23456" })).toMatchObject({
      success: true,
      data: { code: "ABCDE-23456" },
    });
    for (const bad of [
      { method: "TOTP", code: "abcde-23456" },
      { method: "RECOVERY", code: "123456" },
      { method: "SMS", code: "123456" },
      { code: "123456" },
      { method: "TOTP", code: "123456", x: 1 },
    ])
      expect(stepUpInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(ERROR_STATUS.MFA_STEP_UP_REQUIRED).toBe(401);
  });

  it('AC-206: ETag/If-Match "v<n>" gidiş-dönüş; yok/yıldız/zayıf/liste/bozuk → null; 428 ve 409 kodları', () => {
    expect(parseUserIfMatch(userEtag(0))).toBe(0);
    expect(parseUserIfMatch(` ${userEtag(42)} `)).toBe(42);
    for (const bad of [undefined, "", "*", 'W/"v1"', '"v1", "v2"', "v1", '"1"', '"v-1"', '"v99999999999"', ['"v1"']])
      expect(parseUserIfMatch(bad), String(bad)).toBeNull();
    expect(ERROR_STATUS.PRECONDITION_REQUIRED).toBe(428);
    expect(ERROR_STATUS.STALE_WRITE).toBe(409);
  });

  it("AC-226: firma seçenekleri limit 1..20 (vars. 20), boş q yok sayılır, 120 üstü ret", () => {
    expect(tenantOptionsQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(tenantOptionsQuerySchema.parse({ q: "  ", limit: "5" })).toEqual({ limit: 5 });
    expect(tenantOptionsQuerySchema.safeParse({ limit: "21" }).success).toBe(false);
    expect(tenantOptionsQuerySchema.safeParse({ q: "a".repeat(121) }).success).toBe(false);
    expect(tenantOptionsQuerySchema.safeParse({ q: "x", extra: 1 }).success).toBe(false);
  });
});
