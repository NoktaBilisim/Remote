import { describe, expect, it } from "vitest";
import { updateTenantSettingsInputSchema, tenantSlugSchema, switchTenantInputSchema } from "../src/api/tenants.ts";
import { createUserInputSchema, permissionMapSchema } from "../src/api/users.ts";
import { PERMISSION_DESCRIPTIONS, PERMISSION_KEYS, roleDefaultGranted } from "../src/permissions.ts";

describe("P9 sözleşme", () => {
  it("AC-4: sessionTtlMin yalnız 15..30 tam sayı", () => {
    for (const v of [15, 30]) expect(updateTenantSettingsInputSchema.safeParse({ sessionTtlMin: v }).success).toBe(true);
    for (const v of [14, 31, 20.5, "20", null]) expect(updateTenantSettingsInputSchema.safeParse({ sessionTtlMin: v }).success).toBe(false);
    expect(updateTenantSettingsInputSchema.safeParse({}).success).toBe(false);
  });

  it("AC-72: yetki haritası yalnız tanımdaki anahtarları kabul eder; açıklamalar tanımdaki anahtarlara ait", () => {
    expect(permissionMapSchema.safeParse(Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true]))).success).toBe(true);
    expect(permissionMapSchema.safeParse({ "yok.anahtar": true }).success).toBe(false);
    for (const k of Object.keys(PERMISSION_DESCRIPTIONS)) expect(PERMISSION_KEYS).toContain(k);
    expect(PERMISSION_DESCRIPTIONS["support_requests.accept"]).toContain("Oturum oluşturma yetkisi gerekmez");
  });

  it("AC-73: rol varsayılanı ve yönetilebilir roller", () => {
    expect([roleDefaultGranted("ADMIN"), roleDefaultGranted("USER")]).toEqual([true, false]);
    expect(createUserInputSchema.safeParse({ email: "A@B.CO", fullName: "Ad Soyad", role: "SUPER_ADMIN" }).success).toBe(false);
    expect(createUserInputSchema.parse({ email: " A@B.CO ", fullName: " Ad Soyad ", role: "USER" })).toEqual({
      email: "a@b.co",
      fullName: "Ad Soyad",
      role: "USER",
    });
  });

  it("AC-70: kısa ad biçimi ve geçiş girdisi", () => {
    for (const ok of ["ab", "nokta-bilisim", "a1-b2"]) expect(tenantSlugSchema.safeParse(ok).success).toBe(true);
    for (const bad of ["a", "-ab", "ab-", "a--b", "Ab", "ğüş"]) expect(tenantSlugSchema.safeParse(bad).success).toBe(false);
    expect(switchTenantInputSchema.safeParse({ tenantId: null }).success).toBe(true);
    expect(switchTenantInputSchema.safeParse({}).success).toBe(false);
  });
});
