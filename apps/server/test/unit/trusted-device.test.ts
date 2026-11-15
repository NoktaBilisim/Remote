// P27a-K3: politika, UA özeti, çerez biçimi ve e-posta şablonları (mimari-p27a §5; AC-325, 331, 333, 335a, 335b).
import { describe, expect, it } from "vitest";
import {
  formatTrustedDeviceCookie,
  newTrustedDeviceSecret,
  parseTrustedDeviceCookie,
  readTrustedDeviceCookies,
  rememberAllowed,
  UNKNOWN_BROWSER,
  uaSummary,
} from "../../src/auth/trusted-device.ts";
import { newId } from "../../src/lib/ids.ts";
import { trustedDeviceCreatedMail, trustedDeviceReuseMail } from "../../src/mail/templates.ts";

const firm = (on: boolean | null) => ({ tenant: { settings: on === null ? null : { mfaRememberDevice: on } } });

describe("P27a-K3 rememberAllowed", () => {
  it("AC-331 Super Admin hiçbir durumda hatırlayamaz (K-P27a-2)", () => {
    expect(rememberAllowed({ role: "SUPER_ADMIN", tenantId: null, tenant: null })).toBe(false);
    expect(rememberAllowed({ role: "SUPER_ADMIN", tenantId: newId(), ...firm(true) })).toBe(false);
  });
  it("AC-331 firma kullanıcısında firma anahtarı; ayar satırı yoksa varsayılan açık", () => {
    const tenantId = newId();
    expect(rememberAllowed({ role: "ADMIN", tenantId, ...firm(true) })).toBe(true);
    expect(rememberAllowed({ role: "USER", tenantId, ...firm(false) })).toBe(false);
    expect(rememberAllowed({ role: "USER", tenantId, ...firm(null) })).toBe(true);
  });
});

describe("P27a-K3 uaSummary (AC-333: tam UA saklanmaz)", () => {
  const cases: [string, string][] = [
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Chrome · Windows"],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0",
      "Edge · Windows",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "Safari · macOS",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Safari · iOS",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox · Linux"],
    [
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 OPR/85.0",
      "Opera · Android",
    ],
    ["curl/8.4.0", UNKNOWN_BROWSER],
    ["", UNKNOWN_BROWSER],
  ];
  it.each(cases)("AC-333 %s → %s", (ua, out) => expect(uaSummary(ua)).toBe(out));
  it("AC-333 çıktı ≤ 80 karakter, kontrol karakteri yok, girdiyi yansıtmaz", () => {
    const evil = `Chrome/1 Windows\r\n<script>${"x".repeat(5000)}`;
    const s = uaSummary(evil);
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s).not.toMatch(/[\p{Cc}\p{Cf}<]/u);
  });
});

describe("P27a-K3 çerez biçimi (AC-335b)", () => {
  it("AC-335b biçim <ULID>.<43>; biçimsiz ve fazla değer bilinmeyen; en çok 2 değer okunur", () => {
    const v = { id: newId(), secret: newTrustedDeviceSecret() };
    expect(parseTrustedDeviceCookie(formatTrustedDeviceCookie(v))).toEqual(v);
    for (const bad of [
      "",
      "x",
      `${v.id}.${v.secret}x`,
      `${v.id.toLowerCase()}.${v.secret}`,
      `${v.id}.${v.secret.slice(1)}`,
      `${v.id}${v.secret}`,
    ])
      expect(parseTrustedDeviceCookie(bad)).toBeNull();
    expect(readTrustedDeviceCookies("__Secure-rs_td=a; other=1; __Secure-rs_td=b; __Secure-rs_td=c")).toEqual(["a", "b"]);
  });
});

describe("P27a-K3 e-posta şablonları (AC-335a, AC-335b)", () => {
  it("AC-335a yeni cihaz e-postası cihaz/IP/saat içerir, bağlantı içermez, kaçışlı", () => {
    const m = trustedDeviceCreatedMail({ uaSummary: "Chrome · Windows", ip: "203.0.113.9<b>", at: new Date("2026-11-15T10:00:00Z") });
    expect(m.text).toContain("Chrome · Windows");
    expect(m.text).toContain("15.11.2026 13:00");
    expect(m.text).toContain("Tümünü kaldır");
    expect(m.bodyHtml).not.toMatch(/<a\s|https?:/i);
    expect(m.bodyHtml).toContain("203.0.113.9&#60;b&#62;");
  });
  it("AC-335b yeniden kullanım e-postası bağlantısız", () => {
    const m = trustedDeviceReuseMail({ at: new Date() });
    expect(m.subject).toContain("yeniden kullanıldı");
    expect(`${m.text}${m.bodyHtml}`).not.toMatch(/https?:|<a\s/i);
  });
});
