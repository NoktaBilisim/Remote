import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MacVariant } from "@/lib/agent-download";
import { AgentDownload } from "./agent-download";
import { MacGuide } from "./mac-guide";

const noop = () => undefined;
const guide = (variant: MacVariant) =>
  renderToStaticMarkup(<MacGuide id="g" highlight={false} variant={variant} verifyCode="4821" host="destek.ornek.com" />);
const page = (variant?: MacVariant) =>
  renderToStaticMarkup(<AgentDownload sessionRef="r1" verifyCode="4821" os="macos" variant={variant} onEnd={noop} />);

describe("P28f MacGuide (AC-391, AC-396, AC-503)", () => {
  it("notarized: bugünkü metin — 'asla Yine de Aç istemez', 'Gizlilik ve Güvenlik → Yine de Aç' adımı yok", () => {
    const html = guide("notarized");
    expect(html).toContain('data-build="notarized"');
    expect(html).toContain('data-testid="mac-never-open-anyway"');
    expect(html).toContain("Nokta Destek hiçbir zaman “Yine de Aç” istemez");
    expect(html).toContain("Apple tarafından onaylanmış (notarize edilmiş)");
    expect(html).toContain("Developer ID ile imzalı ve notarize edilmiştir");
    expect(html).toContain("macOS “İnternetten indirilmiş bir uygulama” diye sorarsa Aç&#x27;ı seçin.");
    expect(html).not.toContain("Gizlilik ve Güvenlik → Yine de Aç");
    expect(html).not.toContain('data-testid="mac-harmful"');
    expect(html).not.toContain("imzasız");
  });
  it("test (staging): ortak 2. adım (Yine de Aç + zararlı uyarısı), 'asla' uyarısı yok", () => {
    const html = guide("test");
    expect(html).toContain('data-build="test"');
    expect(html).toContain("Gizlilik ve Güvenlik → Yine de Aç");
    expect(html).toContain('data-testid="mac-harmful"');
    expect(html).toContain("Bu test sürümü imzasızdır");
    expect(html).not.toContain('data-testid="mac-never-open-anyway"');
  });
  it("adhoc (prod): TEST kelimesi yok; ad-hoc giriş, ortak 2. adım (13–14 / 15 farkı, yönetici parolası), ad-hoc doğrulama", () => {
    const html = guide("adhoc");
    expect(html).toContain('data-build="adhoc"');
    expect(html).not.toMatch(/TEST|test sürümü|test ortamı|Test/);
    expect(html).toContain("Apple Developer ID olmadan imzalanır");
    expect(html).toContain("Gizlilik ve Güvenlik → Yine de Aç");
    expect(html).toContain("macOS 13–14");
    expect(html).toContain("macOS 15 ve sonrasında yalnız Sistem Ayarları yolu");
    expect(html).toContain("Yönetici parolanız yoksa tarayıcıdan paylaşımı kullanın");
    expect(html).toContain("(ad-hoc) imzalıdır");
    expect(html).not.toContain('data-testid="mac-never-open-anyway"');
  });
  it("S-r4-2: zararlı uyarısı Çöp Sepeti'ne yönlendirir; Bitti yalnız 'açılmadı / doğrulayamadı' uyarısında", () => {
    const html = guide("adhoc");
    expect(html).toMatch(/data-testid="mac-harmful"[^]*zarar vereceğini[^]*Çöp Sepetine Taşı&#x27;yı seçin, Yine de Aç denemeyin/);
    expect(html).not.toContain("Çöp Sepetine Taşı&#x27;yı değil");
    expect(html).toContain("Yalnız macOS “Nokta Destek” açılmadı ya da Apple uygulamayı doğrulayamadı derse Bitti");
  });
  it("iki izin (Ekran Kaydı / Erişilebilirlik; ses yok r3) ve doğrulama kodu + sunucu", () => {
    for (const v of ["test", "adhoc", "notarized"] as const) {
      const html = guide(v);
      expect(html).toContain("Ekran Kaydı (gerekli)");
      expect(html).toContain("Erişilebilirlik (yalnız kontrol için)");
      expect(html).not.toContain("Mikrofon");
      expect(html).toContain("İzni verdim, yeniden başlat");
      expect(html).toContain("doğrulama kodu 4821, sunucu adresi destek.ornek.com");
    }
  });
});

describe("P28f AgentDownload (macOS) — AC-503 varyantları", () => {
  it("indirme os=macos adresine, macOS rehberi; SmartScreen rehberi yok", () => {
    const html = page("notarized");
    expect(html).toContain('href="/api/v1/public/agent/download?ref=r1&amp;os=macos"');
    expect(html).toContain('data-os="macos"');
    expect(html).toContain("Hızlı Destek uygulamasını indir");
    expect(html).toContain("macOS 13 veya üstü");
    expect(html).toContain('data-testid="mac-guide"');
    expect(html).not.toContain('data-testid="smartscreen-guide"');
    expect(html).not.toContain('data-testid="mac-test-build"');
    expect(html).not.toContain('data-testid="mac-adhoc-only-this"');
  });
  it("test: düğmenin yanında 'TEST SÜRÜMÜ — imzasız' uyarısı (rehberden önce); ad-hoc uyarısı yok", () => {
    const html = page("test");
    expect(html).toContain('data-testid="mac-test-build"');
    expect(html.indexOf("mac-test-build")).toBeLessThan(html.indexOf("mac-guide"));
    expect(html).not.toContain('data-testid="mac-adhoc-only-this"');
  });
  it("adhoc: sayfanın tamamında TEST yok; yalnız-bu-sayfa uyarısı düğmenin yanında, 2. adımdan önce; doğrulama kodu uyarıda yok (S-r4-1)", () => {
    const html = page("adhoc");
    expect(html).not.toContain('data-testid="mac-test-build"');
    expect(html).not.toMatch(/TEST/);
    expect(html).toContain('data-testid="mac-adhoc-only-this"');
    const warn = html.indexOf("mac-adhoc-only-this");
    expect(warn).toBeLessThan(html.indexOf("mac-guide"));
    expect(warn).toBeLessThan(html.indexOf("Gizlilik ve Güvenlik → Yine de Aç"));
    const block = html.slice(warn, html.indexOf("mac-guide"));
    // P31 (mimari-p31 §15.3, S-P31-2): metin kanaldan bağımsız, indirme kaynağına çapalı (OKUBENI son paragrafının web eşi)
    expect(block).toContain("adresinden indirdiğiniz Nokta Destek için kullanın");
    expect(block).toContain("Bilgi Al → “Nereden” satırı https://");
    expect(block).toContain("Firmanız size yalnız bağlantı gönderir, dosya göndermez. Dosya ek olarak geldiyse açmayın.");
    expect(block).not.toContain("4821");
  });
  it("varsayılan (varyant verilmezse) adhoc — asla notarized değil", () => {
    const html = page();
    expect(html).toContain('data-build="adhoc"');
    expect(html).toContain('data-testid="mac-adhoc-only-this"');
    expect(html).not.toContain('data-testid="mac-never-open-anyway"');
  });
  it("Windows değişmedi: os parametresi yok, SmartScreen rehberi", () => {
    const html = renderToStaticMarkup(<AgentDownload sessionRef="r1" verifyCode="4821" onEnd={noop} />);
    expect(html).toContain('href="/api/v1/public/agent/download?ref=r1"');
    expect(html).toContain('data-testid="smartscreen-guide"');
    expect(html).not.toContain('data-testid="mac-guide"');
    expect(html).not.toContain('data-testid="mac-adhoc-only-this"');
  });
});
