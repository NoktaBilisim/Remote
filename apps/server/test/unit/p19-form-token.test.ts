// P19 J2 — web formu bot kapısı token'ı (mimari-e11 §8c.2 m.3; AC-259, S-P19-1, S-P19-T4). Birim: saat elle sürülür.
import { notifyEmailKey } from "@remote/contracts/api/requests";
import { describe, expect, it } from "vitest";
import { SecretBox } from "../../src/lib/crypto.ts";
import { compareVersions, isOutdated } from "../../src/lib/version.ts";
import { FormNonceStore, FormTokens } from "../../src/requests/form-token.ts";

const REF = "abcdefghijklmnop";
const OTHER = "bcdefghijklmnopq";

function tokens(max?: number) {
  const clock = { t: 1_700_000_000_000 };
  const box = new SecretBox(null);
  return { clock, box, ft: new FormTokens(box, () => clock.t, max) };
}

describe("S-P19-1 form token'ı", () => {
  it("AC-259 / S-P19-1: 1,9 sn → fast (tüketilmez); aynı token 2 sn'de geçer; 30 dk sonra geçersiz", () => {
    const { clock, ft } = tokens();
    const tok = ft.issue(REF);
    clock.t += 1900;
    const fast = ft.verify(tok, REF);
    expect(fast).toEqual({ ok: false, reason: "fast", retryAfterMs: 100 });
    clock.t += 100;
    const ok = ft.verify(tok, REF);
    expect(ok.ok).toBe(true);
    clock.t += 30 * 60_000;
    expect(ft.verify(tok, REF)).toEqual({ ok: false, reason: "token" });
  });

  it("S-P19-1: başka ref'in token'ı, bozulmuş HMAC ve kısa/uzun token → token", () => {
    const { clock, ft } = tokens();
    const tok = ft.issue(REF);
    clock.t += 2500;
    expect(ft.verify(tok, OTHER)).toEqual({ ok: false, reason: "token" });
    const raw = Buffer.from(tok, "base64url");
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(ft.verify(raw.toString("base64url"), REF)).toEqual({ ok: false, reason: "token" });
    expect(ft.verify(tok.slice(0, -4), REF)).toEqual({ ok: false, reason: "token" });
    expect(ft.verify(`${tok}AAAA`, REF)).toEqual({ ok: false, reason: "token" });
  });

  it("S-P19-T4: yeniden başlatma (yeni bootId, aynı anahtar halkası) → önceki sürecin token'ı geçersiz", () => {
    const { clock, box, ft } = tokens();
    const tok = ft.issue(REF);
    clock.t += 2500;
    expect(ft.verify(tok, REF).ok).toBe(true);
    const restarted = new FormTokens(box, () => clock.t);
    expect(restarted.verify(tok, REF)).toEqual({ ok: false, reason: "token" });
  });

  it("S-P19-T4: nonce tüketimi tek kullanımlık; küme dolu (sınır 3) → full (eski girdi atılmaz), süresi geçenler temizlenir", () => {
    let now = 0;
    const store = new FormNonceStore(() => now, 3);
    expect(store.consume("a", 100)).toBe("ok");
    expect(store.consume("a", 100)).toBe("used");
    expect(store.consume("b", 100)).toBe("ok");
    expect(store.consume("c", 200)).toBe("ok");
    expect(store.consume("d", 200)).toBe("full");
    expect(store.consume("a", 100)).toBe("used"); // dolulukta bile kullanılmış token geçmez
    now = 150; // a, b süresi geçti
    expect(store.consume("d", 300)).toBe("ok");
    expect(store.size).toBe(2);
  });
});

describe("S-P19-13 / T11 yardımcıları", () => {
  it("S-P19-13: isOutdated yalnız string sürüm alır (NULL derlemede yakalanır); karşılaştırma değişmedi", () => {
    expect(isOutdated("0.9.0", "0.10.0")).toBe(true);
    expect(isOutdated("0.10.0", undefined)).toBe(false);
    expect(compareVersions("0.12.0", "0.11.9")).toBe(1);
  });

  it("S-P19-T11: e-posta karşılaştırma anahtarı — NFC + trim + küçük harf + yerel `+` eki atılır", () => {
    expect(notifyEmailKey("  Ad+1@Ornek.COM ")).toBe("ad@ornek.com");
    expect(notifyEmailKey("ad@ornek.com")).toBe("ad@ornek.com");
    expect(notifyEmailKey("+x@ornek.com")).toBe("+x@ornek.com");
    expect(notifyEmailKey("ad@ornek+x.com")).toBe("ad@ornek+x.com");
  });
});
