// AC-129 (tenantRef ≥ 64 bit) ve AC-130 (file_label, firma dosya adı) birim testleri — mimari-e9 §3.1, §9.
import { describe, expect, it } from "vitest";
import { base32Lower, newTenantRef } from "../../src/lib/ids.ts";
import { fileLabelOf, parseFirmDownloadUri, requestDownloadLocation, requestFileName } from "../../src/requests/ref.ts";

describe("AC-129 tenantRef", () => {
  it("AC-129: 16 karakter [a-z2-7] (10 bayt CSPRNG = 80 bit ≥ 64); 5.000 üretimde tekrar yok, her konumda geniş alfabe", () => {
    const refs = Array.from({ length: 5000 }, newTenantRef);
    for (const r of refs) expect(r).toMatch(/^[a-z2-7]{16}$/);
    expect(new Set(refs).size).toBe(refs.length);
    expect(16 * Math.log2(32)).toBeGreaterThanOrEqual(64);
    for (let pos = 0; pos < 16; pos++) {
      // 80 bit = 16 × 5: dolgu yok, her konum tam 5 rastgele bit taşır → 32 değerin neredeyse hepsi görülmeli
      expect(new Set(refs.map((r) => r[pos])).size, `konum ${pos}`).toBeGreaterThanOrEqual(30);
    }
  });

  it("AC-129: base32Lower RFC 4648 test vektörleri (küçük harf, dolgusuz)", () => {
    const enc = (s: string) => base32Lower(new TextEncoder().encode(s));
    expect(enc("")).toBe("");
    expect(enc("f")).toBe("my");
    expect(enc("fo")).toBe("mzxq");
    expect(enc("foo")).toBe("mzxw6");
    expect(enc("foob")).toBe("mzxw6yq");
    expect(enc("fooba")).toBe("mzxw6ytb");
    expect(enc("foobar")).toBe("mzxw6ytboi");
    expect(base32Lower(new Uint8Array(10).fill(255))).toBe("7".repeat(16));
    expect(base32Lower(new Uint8Array(10))).toBe("a".repeat(16));
  });
});

describe("AC-130 file_label", () => {
  it("AC-130: Türkçe harfler ASCII'ye indirgenir, boşluk/noktalama silinir", () => {
    expect(fileLabelOf("Çağrı Özel Şirket")).toBe("CagriOzelSirket");
    expect(fileLabelOf("İĞÜŞÖÇ ığüşöç")).toBe("IGUSOCigusoc");
    expect(fileLabelOf("Nokta Bilişim A.Ş.")).toBe("NoktaBilisimAS");
    expect(fileLabelOf("Café Ñandú & Co.")).toBe("CafeNanduCo");
    expect(fileLabelOf("ABC-123_xyz")).toBe("ABC123xyz");
  });

  it("AC-130: en çok 20 karakter (indirgemeden sonra kesilir)", () => {
    expect(fileLabelOf("Çok Uzun Bir Firma Adı Ticaret Limited Şirketi")).toBe("CokUzunBirFirmaAdiTi");
    expect(fileLabelOf("a".repeat(50))).toHaveLength(20);
    expect(fileLabelOf("ş".repeat(25))).toBe("s".repeat(20));
  });

  it("AC-130: ASCII'ye indirgenemeyen / boş ad → \"Firma\"", () => {
    expect(fileLabelOf("")).toBe("Firma");
    expect(fileLabelOf("   ")).toBe("Firma");
    expect(fileLabelOf("—…!?")).toBe("Firma");
    expect(fileLabelOf("日本語")).toBe("Firma");
    expect(fileLabelOf("😀")).toBe("Firma");
  });

  it("AC-130: dosya adı NoktaDestek-<label>-<ref>.exe; konum forward_auth ayrıştırıcısıyla tutarlı, label her zaman ayrıştırılabilir", () => {
    const ref = newTenantRef();
    for (const name of ["Çağrı Özel Bilişim", "", "Çok Uzun Bir Firma Adı Ticaret Limited Şirketi", "日本語"]) {
      const label = fileLabelOf(name);
      expect(label).toMatch(/^[A-Za-z0-9]{1,20}$/);
      expect(requestFileName(label, ref)).toBe(`NoktaDestek-${label}-${ref}.exe`);
      expect(parseFirmDownloadUri(requestDownloadLocation(label, ref))).toEqual({ label, ref });
    }
  });
});
