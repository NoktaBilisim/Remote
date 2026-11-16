import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "./api";
import { toUiError, withoutLeadingTitle } from "./error-message";

const title = "Açık oturum sınırına ulaştınız";

describe("withoutLeadingTitle (TO-P2-1)", () => {
  it("başlıkla aynı ilk cümleyi atar", () => {
    expect(withoutLeadingTitle("Açık oturum sınırına ulaştınız. Yeni oturum için bekleyen bir oturumu iptal edin.", title)).toBe(
      "Yeni oturum için bekleyen bir oturumu iptal edin.",
    );
  });
  it("yalnız başlıktan oluşan mesajda boş döner", () => {
    expect(withoutLeadingTitle("AÇIK OTURUM SINIRINA ULAŞTINIZ.", title)).toBe("");
  });
  it("farklı mesajı olduğu gibi bırakır", () => {
    expect(withoutLeadingTitle("Aynı anda en fazla 3 açık oturumunuz olabilir.", title)).toBe(
      "Aynı anda en fazla 3 açık oturumunuz olabilir.",
    );
  });
});

describe("toUiError (P28e-K10 D-3)", () => {
  it("500'de sunucu metni yerine genel metin; istek kimliği korunur", () => {
    expect(toUiError(new ApiError(500, "INTERNAL", "x", undefined, "req-1"))).toEqual({
      message: "Beklenmeyen bir hata oluştu.",
      requestId: "req-1",
      tone: "danger",
    });
  });
  it("4xx sunucu metni ve durum eşlemesi korunur; ağ hatası genel ağ metni", () => {
    expect(toUiError(new ApiError(409, "CONFLICT", "Kayıt sürüyor")).message).toBe("Kayıt sürüyor");
    expect(toUiError(new ApiError(500, "INTERNAL", "x"), { 500: "Özel" }).message).toBe("Özel");
    expect(toUiError(new NetworkError()).message).toMatch(/^Sunucuya ulaşılamadı/);
  });
});
