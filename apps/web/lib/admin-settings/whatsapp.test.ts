import { describe, expect, it } from "vitest";
import { canonicalWaUrl, checkTestPhone, checkWaApiKey, waKeyNeedsReenter, checkWaUrl, normalizeWaUrl, normalizeWaView, WA_URL_MESSAGES, waDirty, waFieldValue, waServerFields, type WhatsappServiceView } from "./whatsapp";

const panel: WhatsappServiceView = { url: "https://wa.ornek.com:3000", source: "panel", insecure: false, updatedAt: "2026-11-13T09:00:00.000Z", apiKeySet: true, apiKeySource: "panel" };
const env: WhatsappServiceView = { url: "http://10.0.0.5:3000", source: "env", insecure: false, updatedAt: null, apiKeySet: false, apiKeySource: null };

describe("AC-196 WhatsApp servis adresi ön kontrolü", () => {
  it("http/https kabul; sondaki / kırpılır", () => {
    expect(checkWaUrl(" https://wa.ornek.com:3000/ ")).toEqual({ url: "https://wa.ornek.com:3000" });
    expect(checkWaUrl("http://10.0.0.5:3000").url).toBe("http://10.0.0.5:3000");
    expect(checkWaUrl("https://wa.ornek.com/api").url).toBe("https://wa.ornek.com/api");
    expect(normalizeWaUrl("http://a.example//")).toBe("http://a.example");
  });
  it("boş, şema dışı, kullanıcı:şifre, sorgu, parça, boşluk ve 200+ reddedilir", () => {
    expect(checkWaUrl("  ").error).toBe(WA_URL_MESSAGES.required);
    expect(checkWaUrl("ftp://wa.ornek.com").error).toBe(WA_URL_MESSAGES.scheme);
    expect(checkWaUrl("wa.ornek.com:3000").error).toBe(WA_URL_MESSAGES.scheme);
    expect(checkWaUrl("https://kul:sifre@wa.ornek.com").error).toBe(WA_URL_MESSAGES.chars);
    expect(checkWaUrl("https://wa.ornek.com/?a=1").error).toBe(WA_URL_MESSAGES.chars);
    expect(checkWaUrl("https://wa.ornek.com/#x").error).toBe(WA_URL_MESSAGES.chars);
    expect(checkWaUrl("https://wa ornek.com").error).toBe(WA_URL_MESSAGES.chars);
    expect(checkWaUrl(`https://${"a".repeat(200)}.com`).error).toBe(WA_URL_MESSAGES.max);
    expect(checkWaUrl("https://:3000").error).toBe(WA_URL_MESSAGES.invalid);
    // kontrol / görünmez biçim / satır ayırıcı karakterleri (sunucu + DB CHECK de reddeder)
    expect(checkWaUrl("https://wa.ornek.com\u0085").error).toBe(WA_URL_MESSAGES.chars);
    expect(checkWaUrl("https://wa\u200b.ornek.com").error).toBe(WA_URL_MESSAGES.chars);
    expect(checkWaUrl("https://wa.ornek\u2028.com").error).toBe(WA_URL_MESSAGES.chars);
  });
  it("P13a: büyük harfli şema/host reddedilmez, WHATWG kanonik biçime çevrilir (sunucuyla aynı)", () => {
    expect(checkWaUrl("HTTPS://WA.Ornek.com:3000/")).toEqual({ url: "https://wa.ornek.com:3000" });
    expect(checkWaUrl("HTTP://wa.ornek.com").url).toBe("http://wa.ornek.com");
    expect(checkWaUrl("http://2130706433:3000").url).toBe("http://127.0.0.1:3000");
    expect(checkWaUrl("https://wa.ornek.com:443").url).toBe("https://wa.ornek.com");
    expect(checkWaUrl("https://bücher.example").url).toBe("https://xn--bcher-kva.example");
    expect(canonicalWaUrl("bozuk adres/")).toBe("bozuk adres");
  });
});

describe("AC-196 form durumu", () => {
  it("env adresi alana yazılmaz; panel kaydı yazılır; kirli karşılaştırması normalize", () => {
    expect(waFieldValue(env)).toBe("");
    expect(waFieldValue(panel)).toBe("https://wa.ornek.com:3000");
    expect(waDirty("https://wa.ornek.com:3000/", panel)).toBe(false);
    expect(waDirty("https://wa2.ornek.com", panel)).toBe(true);
    expect(waDirty("", env)).toBe(false);
    expect(waDirty("http://x.example", env)).toBe(true);
    expect(waDirty("HTTPS://WA.ornek.com:3000/", panel)).toBe(false);
  });
  it("kaynak: büyük harfli yanıt küçültülür, bilinmeyen (eski default dahil) → env", () => {
    expect(normalizeWaView({ ...env, source: "default" }).source).toBe("env");
    expect(normalizeWaView({ ...panel, source: "PANEL" }).source).toBe("panel");
    expect(normalizeWaView({ ...env, source: "x" }).source).toBe("env");
  });
  it("sunucu alan hatası alana, kalanı form üstüne", () => {
    expect(waServerFields({ url: "Geçersiz", _: "Diğer" }, "url")).toEqual({ error: "Geçersiz", rest: ["Diğer"] });
    expect(waServerFields({ phoneNumber: "Numara geçersiz" }, "phoneNumber").error).toBe("Numara geçersiz");
  });
  it("test numarası TR / E.164 normalize, boş ve hatalı reddedilir", () => {
    expect(checkTestPhone("0532 000 00 00").phoneNumber).toBe("+905320000000");
    expect(checkTestPhone("905320000000").phoneNumber).toBe("+905320000000");
    expect(checkTestPhone("+4915112345678").phoneNumber).toBe("+4915112345678");
    expect(checkTestPhone("").error).toBeTruthy();
    expect(checkTestPhone("12ab").error).toBeTruthy();
  });
});

describe("S-P13b-3 WhatsApp servis anahtarı ön kontrolü", () => {
  it("boş alan gönderilmez; 16–256 karakter, boşluksuz kabul", () => {
    expect(checkWaApiKey("")).toEqual({});
    expect(checkWaApiKey("a".repeat(16))).toEqual({ apiKey: "a".repeat(16) });
    expect(checkWaApiKey("a".repeat(256)).apiKey).toHaveLength(256);
  });
  it("kısa, uzun, boşluklu ve kontrol karakterli reddedilir", () => {
    for (const bad of ["a".repeat(15), "a".repeat(257), `${"a".repeat(16)} x`, `${"a".repeat(16)}\n`, ` ${"a".repeat(16)}`]) expect(checkWaApiKey(bad).error).toContain("16");
  });
  it("görünüm: eksik anahtar alanları güvenli varsayılana iner", () => {
    expect(normalizeWaView({ url: null, source: "env", insecure: false, updatedAt: null }).apiKeySource).toBeNull();
    expect(normalizeWaView({ ...panel, apiKeySource: "x" }).apiKeySource).toBeNull();
    expect(normalizeWaView({ ...panel }).apiKeySource).toBe("panel");
  });
  it("adres kökeni değişirse (şema/host/port) kayıtlı panel anahtarı için yeniden giriş gerekir; yol değişimi gerekmez", () => {
    expect(waKeyNeedsReenter(panel, "https://wa2.ornek.com:3000")).toBe(true);
    expect(waKeyNeedsReenter(panel, "http://wa.ornek.com:3000")).toBe(true);
    expect(waKeyNeedsReenter(panel, "https://wa.ornek.com:3001")).toBe(true);
    expect(waKeyNeedsReenter(panel, "https://wa.ornek.com:3000/yol")).toBe(false);
    expect(waKeyNeedsReenter(env, "https://x.example")).toBe(false);
    expect(waKeyNeedsReenter({ ...panel, apiKeySet: false, apiKeySource: null }, "https://x.example")).toBe(false);
  });
});
