// P27a-K2: güvenilir cihaz çerez değeri (mimari-p27a §5.1, §5.3; AC-333, AC-335b).
import { TRUSTED_DEVICE_COOKIE, TRUSTED_DEVICE_DAYS } from "@remote/contracts/api/auth";
import { describe, expect, it } from "vitest";
import {
  formatTrustedDeviceCookie,
  hashTrustedDeviceSecret,
  newTrustedDeviceSecret,
  parseTrustedDeviceCookie,
  readTrustedDeviceCookies,
  trustedDeviceExpiresAt,
  trustedDeviceRemainingSec,
  trustedDeviceSecretMatches,
} from "../../src/auth/trusted-device.ts";
import { newId } from "../../src/lib/ids.ts";

describe("P27a-K2 trusted-device çerez değeri", () => {
  it("AC-333 gizli değer 32 bayt base64url (43 karakter), her çağrıda farklı", () => {
    const a = newTrustedDeviceSecret();
    const b = newTrustedDeviceSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it("AC-333 özet SHA-256 küçük harf hex (DB CHECK biçimi), gizliyi içermez", () => {
    const s = newTrustedDeviceSecret();
    const h = hashTrustedDeviceSecret(s);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(s);
  });

  it("AC-335b özet karşılaştırması: doğru gizli true, başka gizli/bozuk özet false", () => {
    const s = newTrustedDeviceSecret();
    const h = hashTrustedDeviceSecret(s);
    expect(trustedDeviceSecretMatches(s, h)).toBe(true);
    expect(trustedDeviceSecretMatches(newTrustedDeviceSecret(), h)).toBe(false);
    expect(trustedDeviceSecretMatches(s, "")).toBe(false);
    expect(trustedDeviceSecretMatches(s, "zz")).toBe(false);
  });

  it("AC-335b biçimle/ayrıştır: <ULID>.<43> gidiş-dönüş", () => {
    const v = { id: newId(), secret: newTrustedDeviceSecret() };
    const cookie = formatTrustedDeviceCookie(v);
    expect(cookie).toHaveLength(26 + 1 + 43);
    expect(parseTrustedDeviceCookie(cookie)).toEqual(v);
  });

  it("AC-335b biçimsiz değerler null (bilinmeyen)", () => {
    const id = newId();
    const s = newTrustedDeviceSecret();
    for (const bad of [
      "",
      s,
      id,
      `${id}.${s}x`,
      `${id}.${s.slice(1)}`,
      `${id.toLowerCase()}.${s}`,
      `${id.slice(0, 25)}U.${s}`, // ULID alfabesinde U yok
      `${id}:${s}`,
      `${id}.${s}\n`,
      ` ${id}.${s}`,
      `${id}.${s.slice(0, 42)}=`,
    ]) {
      expect(parseTrustedDeviceCookie(bad), bad).toBeNull();
    }
  });

  it("AC-326 ham Cookie başlığından aynı addaki en çok 2 değer, sırayla; başka adlar yok sayılır", () => {
    const n = TRUSTED_DEVICE_COOKIE;
    expect(readTrustedDeviceCookies(undefined)).toEqual([]);
    expect(readTrustedDeviceCookies("")).toEqual([]);
    expect(readTrustedDeviceCookies("__Host-rs_session=abc; x=1")).toEqual([]);
    expect(readTrustedDeviceCookies(`${n}=a`)).toEqual(["a"]);
    expect(readTrustedDeviceCookies(`x=1; ${n}=a;${n}=b ; ${n}=c`)).toEqual(["a", "b"]);
    expect(readTrustedDeviceCookies(`${n}x=a; x${n}=b; ${n}`)).toEqual([]);
  });

  it("AC-326 sabit bitiş: oluşturma + 30 gün; kalan saniye aşağı yuvarlanır, en az 0", () => {
    const now = new Date(Date.UTC(2026, 10, 15, 12));
    const exp = trustedDeviceExpiresAt(now);
    expect(exp.getTime() - now.getTime()).toBe(TRUSTED_DEVICE_DAYS * 86_400_000);
    expect(trustedDeviceRemainingSec(exp, now)).toBe(2_592_000);
    expect(trustedDeviceRemainingSec(exp, new Date(now.getTime() + 1_500))).toBe(2_591_998);
    expect(trustedDeviceRemainingSec(exp, new Date(exp.getTime() + 1))).toBe(0);
  });
});
