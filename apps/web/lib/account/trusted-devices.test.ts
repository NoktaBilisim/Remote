import { mfaVerifyInputSchema } from "@remote/contracts/api/auth";
import { describe, expect, it } from "vitest";
import { deviceMeta, mfaVerifyBody } from "./trusted-devices";

// P27a (AC-325, AC-329): 2FA gövdesi ve hatırlanan cihaz satırı özeti.
describe("mfaVerifyBody", () => {
  it("kod modu + izin + işaretli → rememberDevice: true; sözleşmeden geçer", () => {
    const b = mfaVerifyBody("code", "123456", true, true);
    expect(b).toEqual({ code: "123456", rememberDevice: true });
    expect(mfaVerifyInputSchema.safeParse(b).success).toBe(true);
  });

  it("işaretsiz veya politika kapalı (Super Admin / firma anahtarı) → alan hiç gönderilmez", () => {
    expect(mfaVerifyBody("code", "123456", false, true)).toEqual({ code: "123456" });
    expect(mfaVerifyBody("code", "123456", true, false)).toEqual({ code: "123456" });
  });

  it("kurtarma kodu modunda kutu işaretli kalsa bile rememberDevice yok (sunucu 400 verirdi)", () => {
    const b = mfaVerifyBody("recovery", "ABCDE23456", true, true);
    expect(b).toEqual({ recoveryCode: "ABCDE23456" });
    expect(mfaVerifyInputSchema.safeParse(b).success).toBe(true);
    // Sözleşme kurtarma koduyla rememberDevice'ı reddeder: istemcinin bunu hiç göndermemesi gerekir
    expect(mfaVerifyInputSchema.safeParse({ recoveryCode: "ABCDE23456", rememberDevice: true }).success).toBe(false);
  });
});

describe("deviceMeta", () => {
  const base = { createdAt: "2026-11-01T09:30:00.000Z", expiresAt: "2026-12-01T09:30:00.000Z" };

  it("hiç kullanılmamış cihaz → 'henüz yok'; tarihler tr-TR yerel saat", () => {
    const m = deviceMeta({ ...base, lastUsedAt: null });
    expect(m).toHaveLength(3);
    expect(m[0]).toMatch(/^Hatırlandı: 01\.11\.2026 12:30$/);
    expect(m[1]).toBe("Son kullanım: henüz yok");
    expect(m[2]).toMatch(/^Bitiş: 01\.12\.2026 12:30$/);
  });

  it("son kullanım varsa tarihle", () => {
    expect(deviceMeta({ ...base, lastUsedAt: "2026-11-10T07:05:00.000Z" })[1]).toMatch(/^Son kullanım: 10\.11\.2026 10:05$/);
  });
});
