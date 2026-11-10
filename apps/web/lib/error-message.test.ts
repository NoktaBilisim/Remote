import { describe, expect, it } from "vitest";
import { withoutLeadingTitle } from "./error-message";

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
