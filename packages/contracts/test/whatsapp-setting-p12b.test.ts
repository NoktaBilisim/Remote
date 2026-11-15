// P12b (AC-196): WhatsApp servis adresi şeması — DB CHECK `system_settings_whatsapp_chk` ile birebir (+ `new URL`).
import { describe, expect, it } from "vitest";
import { WA_TEST_MESSAGES, WA_URL_MESSAGE, whatsappAdminTestInputSchema, whatsappSettingsInputSchema } from "../src/api/system-settings.ts";

const parse = (url: unknown) => whatsappSettingsInputSchema.safeParse({ url });

describe("P12b WhatsApp servis adresi sözleşmesi", () => {
  it("AC-196: http/https, port, yol, IPv6, tam 200 karakter kabul; sondaki / kırpılır", () => {
    for (const url of [
      "http://203.0.113.10:3000",
      "http://localhost:3000",
      "https://wa.example.com",
      "https://wa.example.com:8443/api/v1",
      "http://[2001:db8::5]:3000",
      "http://x",
      `https://${"a".repeat(192)}`,
    ]) {
      const r = parse(url);
      expect(r.success, url).toBe(true);
      expect(r.data?.url).toBe(url);
    }
    expect(parse("https://wa.example.com/").data?.url).toBe("https://wa.example.com");
    expect(parse("https://wa.example.com/api//").data?.url).toBe("https://wa.example.com/api");
  });

  it("AC-196: şema, kullanıcı:şifre, sorgu, parça, boşluk/kontrol, 201 karakter ve ayrıştırılamayan adres reddi (alan hatası)", () => {
    const bad: unknown[] = [
      "",
      "ftp://x",
      "//x",
      "http://",
      "http:///",
      "http://u:p@x",
      "http://u@x",
      "http://x?a=1",
      "http://x#f",
      "http://x y",
      "http://x\t",
      "http://x\n",
      "http://x\r",
      "http://x\u0000",
      "http://x\u007f",
      "http://x\u0085",
      "http://x ",
      "http://x ",
      "http://x　",
      " http://x",
      "http://[::1",
      `https://${"a".repeat(193)}`,
      123,
      null,
    ];
    for (const url of bad) {
      const r = parse(url);
      expect(r.success, JSON.stringify(url)).toBe(false);
      expect(r.error?.issues[0]?.path).toEqual(["url"]);
      expect(r.error?.issues[0]?.message).toBe(WA_URL_MESSAGE);
    }
    expect(whatsappSettingsInputSchema.safeParse({ url: "http://x", extra: 1 }).success).toBe(false);
    expect(whatsappSettingsInputSchema.safeParse({}).success).toBe(false);
  });

  it("AC-196: test girdisi E.164 / 90… (servise + olmadan gider; normalize +90…); geçersiz numara reddi", () => {
    expect(whatsappAdminTestInputSchema.parse({ phoneNumber: "0532 111 22 33" }).phoneNumber).toBe("+905321112233");
    expect(whatsappAdminTestInputSchema.parse({ phoneNumber: "905321112233" }).phoneNumber).toBe("+905321112233");
    for (const p of ["", "abc", "+0123", "1".repeat(41)])
      expect(whatsappAdminTestInputSchema.safeParse({ phoneNumber: p }).success, p).toBe(false);
    expect(whatsappAdminTestInputSchema.safeParse({ phone: "+905321112233" }).success).toBe(false);
  });

  it("AC-196: test mesajları sabit ve adres/ayrıntı içermez", () => {
    for (const m of Object.values(WA_TEST_MESSAGES)) expect(m).not.toMatch(/https?:|\d+\.\d+\.\d+\.\d+/);
  });
});

describe("P13a WhatsApp adresi — WHATWG kanonik + Cf/Zl/Zp reddi (B-P12b-4, mimari-p13 §3)", () => {
  it("B-P12b-4: büyük harfli şema/host reddedilmez, küçük harfe kanonikleşir; ondalık/onaltılı IPv4 noktalı; IDN punycode; varsayılan port atılır", () => {
    const cases: [string, string][] = [
      ["HTTPS://X", "https://x"],
      ["HTTP://WA.Example.COM:3000/Api/", "http://wa.example.com:3000/Api"],
      ["http://3232235777:3000", "http://192.168.1.1:3000"],
      ["http://0xC0A80101", "http://192.168.1.1"],
      ["https://örnek.com.tr", "https://xn--rnek-4qa.com.tr"],
      ["http://wa.example.com:80", "http://wa.example.com"],
      ["http://[::1]:3000", "http://[::1]:3000"],
    ];
    for (const [input, out] of cases) expect(whatsappSettingsInputSchema.safeParse({ url: input }).data?.url, input).toBe(out);
  });

  it("B-P12b-4: biçim (Cf), satır/paragraf ayırıcı (Zl/Zp) karakterleri yolda ve host'ta reddedilir", () => {
    for (const ch of ["\u200b", "\u200c", "\u200d", "\u202e", "\u2066", "\ufeff", "\u00ad", "\u2028", "\u2029"]) {
      for (const url of [`http://wa${ch}.example.com`, `http://wa.example.com/a${ch}b`]) {
        const r = whatsappSettingsInputSchema.safeParse({ url });
        expect(r.success, JSON.stringify(url)).toBe(false);
        expect(r.error?.issues[0]?.message).toBe(WA_URL_MESSAGE);
      }
    }
  });

  it("B-P12b-4: uzunluk kod noktasıyla (DB maxLength); kanonik biçim 200'ü aşarsa red", () => {
    expect(whatsappSettingsInputSchema.safeParse({ url: `https://${"a".repeat(190)}/${"ğ".repeat(1)}` }).success).toBe(false); // %C4%9F → 202
    expect(whatsappSettingsInputSchema.safeParse({ url: `https://${"a".repeat(192)}` }).success).toBe(true);
  });
});
