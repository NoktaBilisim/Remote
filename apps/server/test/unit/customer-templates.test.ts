// P32 (mimari-p32 §4.8, AC-533, S-P32-1): gözetimsiz kayıt kodu mesajındaki doğrulama bloğu — alan adı, dosya adı, sürüm,
// SHA kısaltması (ilk8…son8) ve "başka yoldan geleni çalıştırmayın" uyarısı; mod bağımsız tek şablon.
import { describe, expect, it } from "vitest";
import { renderFor, UNATTENDED_DOWNLOAD_WARNING, type TemplateInput } from "../../src/notify/customer-templates.ts";

const SHA = `0123abcd${"e".repeat(48)}9876fedc`;
const input = (o: { version?: string; sha256?: string; host?: string } = {}): TemplateInput => ({
  kind: "UNATTENDED_CODE",
  firm: "Nokta Bilişim",
  downloadUrl: `https://destek.example.com:4450/api/v1/public/unattended/download?t=${"T".repeat(43)}`,
  code: "ABCD-1234-EFGH-5678",
  expiresAt: new Date("2026-11-20T10:00:00Z"),
  sha256: o.sha256 ?? SHA,
  host: o.host ?? "destek.example.com:4450",
  ...(o.version === undefined ? { version: "0.23.0" } : o.version ? { version: o.version } : {}),
});
const BLOCK =
  "Yalnız destek.example.com:4450 adresinden indirin. Dosya: NoktaDestekServis.exe · Sürüm: 0.23.0 · SHA-256: 0123abcd…9876fedc";

describe("AC-533 kayıt kodu doğrulama bloğu", () => {
  it("AC-533: e-posta ve kısa mesajda alan adı (port dahil), dosya adı, sürüm, SHA kısaltması ve uyarı cümlesi", () => {
    for (const ch of ["EMAIL", "WHATSAPP", "SMS"] as const) {
      const t = renderFor(ch, input()).text;
      expect(t, ch).toContain(BLOCK);
      expect(t, ch).toContain(UNATTENDED_DOWNLOAD_WARNING);
      expect(UNATTENDED_DOWNLOAD_WARNING).toBe("Size başka yoldan gönderilen dosyayı çalıştırmayın.");
    }
  });

  it("AC-533: e-posta tam 64 haneli SHA'yı da korur; HTML gövdesi bloğu kaçışlı taşır; kısa mesajda tam SHA yok", () => {
    const m = renderFor("EMAIL", input());
    expect(m.text).toContain(SHA);
    expect(m.bodyHtml).toContain("Yalnız destek.example.com:4450 adresinden indirin.");
    expect(m.bodyHtml).toContain("0123abcd…9876fedc");
    expect(m.bodyHtml).toContain(UNATTENDED_DOWNLOAD_WARNING);
    expect(renderFor("WHATSAPP", input()).text).not.toContain(SHA);
  });

  it("AC-533: sürüm boşken yalnız 'Sürüm' parçası yazılmaz; SHA yapılandırılmamışsa SHA parçası yazılmaz (yarım '…' yok)", () => {
    const noVer = renderFor("EMAIL", input({ version: "" })).text;
    expect(noVer).toContain("Yalnız destek.example.com:4450 adresinden indirin. Dosya: NoktaDestekServis.exe · SHA-256: 0123abcd…9876fedc");
    expect(noVer).not.toContain("Sürüm");
    const noSha = renderFor("SMS", input({ sha256: "" })).text;
    expect(noSha).toContain("Dosya: NoktaDestekServis.exe · Sürüm: 0.23.0\n");
    expect(noSha).not.toContain("…");
  });

  it("AC-533: blok mod bağımsız — girdi aynıysa çıktı aynı (önizleme = gönderim)", () => {
    expect(renderFor("EMAIL", input())).toEqual(renderFor("EMAIL", input()));
  });
});
