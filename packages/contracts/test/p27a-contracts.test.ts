// P27a-K2 sözleşmeleri (mimari-p27a §4; AC-325, 329, 330, 331, 333, 335b).
import { describe, expect, it } from "vitest";
import {
  mfaVerifyInputSchema,
  TRUSTED_DEVICE_COOKIE,
  TRUSTED_DEVICE_COOKIE_PATH,
  TRUSTED_DEVICE_COOKIE_VALUE_RE,
  TRUSTED_DEVICE_DAYS,
  TRUSTED_DEVICE_MAX_PER_USER,
  trustedDeviceParamsSchema,
} from "../src/api/auth.ts";
import { updateTenantSettingsInputSchema } from "../src/api/tenants.ts";
import { forgetDevicesInputSchema } from "../src/api/users.ts";
import { AUTH_AUDIT } from "../src/audit.ts";

const ID = "01JD0000000000000000000000";
const SECRET = "A".repeat(43);

describe("P27a contracts", () => {
  it("AC-325 rememberDevice yalnız TOTP koluyla kabul edilir; kurtarma koduyla 400", () => {
    expect(mfaVerifyInputSchema.safeParse({ code: "123456", rememberDevice: true }).success).toBe(true);
    expect(mfaVerifyInputSchema.safeParse({ code: "123456", rememberDevice: false }).success).toBe(true);
    expect(mfaVerifyInputSchema.safeParse({ code: "123456" }).success).toBe(true);
    expect(mfaVerifyInputSchema.safeParse({ code: "123456", rememberDevice: "true" }).success).toBe(false);
    expect(mfaVerifyInputSchema.safeParse({ recoveryCode: "ABCDE-23456" }).success).toBe(true);
    expect(mfaVerifyInputSchema.safeParse({ recoveryCode: "ABCDE-23456", rememberDevice: true }).success).toBe(false);
    expect(mfaVerifyInputSchema.safeParse({ recoveryCode: "ABCDE-23456", rememberDevice: false }).success).toBe(false);
  });

  it("AC-325 çerez sabitleri: __Secure- öneki, auth yolu, 30 gün, 10 cihaz", () => {
    expect(TRUSTED_DEVICE_COOKIE).toBe("__Secure-rs_td");
    expect(TRUSTED_DEVICE_COOKIE_PATH).toBe("/api/v1/auth");
    expect(TRUSTED_DEVICE_DAYS * 86_400).toBe(2_592_000);
    expect(TRUSTED_DEVICE_MAX_PER_USER).toBe(10);
  });

  it("AC-335b çerez değeri biçimi <ULID>.<43 base64url>", () => {
    expect(TRUSTED_DEVICE_COOKIE_VALUE_RE.test(`${ID}.${SECRET}`)).toBe(true);
    expect(TRUSTED_DEVICE_COOKIE_VALUE_RE.test(`${ID}.${SECRET}A`)).toBe(false);
    expect(TRUSTED_DEVICE_COOKIE_VALUE_RE.test(`${ID.slice(1)}.${SECRET}`)).toBe(false);
    expect(TRUSTED_DEVICE_COOKIE_VALUE_RE.test(`${ID}.${SECRET.slice(1)}+`)).toBe(false);
    expect(TRUSTED_DEVICE_COOKIE_VALUE_RE.test(SECRET)).toBe(false);
  });

  it("AC-329 tekil silme parametresi ULID ister", () => {
    expect(trustedDeviceParamsSchema.safeParse({ id: ID }).success).toBe(true);
    expect(trustedDeviceParamsSchema.safeParse({ id: "1" }).success).toBe(false);
    expect(trustedDeviceParamsSchema.safeParse({ id: ID.toLowerCase() }).success).toBe(false);
    expect(trustedDeviceParamsSchema.safeParse({ id: ID, x: 1 }).success).toBe(false);
  });

  it("AC-330 forget-devices gövdesi boş nesne", () => {
    expect(forgetDevicesInputSchema.safeParse({}).success).toBe(true);
    expect(forgetDevicesInputSchema.safeParse({ all: true }).success).toBe(false);
  });

  it("AC-331 firma ayarı mfaRememberDevice boolean, tek başına geçerli değişiklik", () => {
    expect(updateTenantSettingsInputSchema.safeParse({ mfaRememberDevice: false }).success).toBe(true);
    expect(updateTenantSettingsInputSchema.safeParse({ mfaRememberDevice: "0" }).success).toBe(false);
  });

  it("AC-333 audit eylem adları", () => {
    expect(AUTH_AUDIT.TRUSTED_DEVICE_CREATED).toBe("auth.trusted_device_created");
    expect(AUTH_AUDIT.TRUSTED_DEVICE_USED).toBe("auth.trusted_device_used");
    expect(AUTH_AUDIT.TRUSTED_DEVICE_REVOKED).toBe("auth.trusted_device_revoked");
    expect(AUTH_AUDIT.TRUSTED_DEVICE_REUSE).toBe("auth.trusted_device_reuse");
  });
});
