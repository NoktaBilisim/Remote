import { describe, expect, it } from "vitest";
import { canonicalWaUrl, checkTestPhone, checkWaUrl, normalizeWaUrl, normalizeWaView, WA_URL_MESSAGES, waDirty, waFieldValue, waServerFields, type WhatsappServiceView } from "./whatsapp";

const panel: WhatsappServiceView = { url: "https://wa.ornek.com:3000", source: "panel", insecure: false, updatedAt: "2026-11-13T09:00:00.000Z" };
const env: WhatsappServiceView = { url: "http://10.0.0.5:3000", source: "env", insecure: false, updatedAt: null };

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
  it("P13a kaynak: default (varsayılan) korunur, büyük harfli yanıt küçültülür, bilinmeyen → env", () => {
    expect(normalizeWaView({ ...env, source: "default" }).source).toBe("default");
    expect(normalizeWaView({ ...env, source: "DEFAULT" }).source).toBe("default");
    expect(normalizeWaView({ ...panel, source: "PANEL" }).source).toBe("panel");
    expect(normalizeWaView({ ...env, source: "x" }).source).toBe("env");
    expect(waFieldValue({ ...env, source: "default" })).toBe("");
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
