import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentDownload } from "./agent-download";
import { MacGuide } from "./mac-guide";

const noop = () => undefined;
const guide = (testBuild: boolean) =>
  renderToStaticMarkup(<MacGuide id="g" highlight={false} testBuild={testBuild} verifyCode="4821" host="destek.ornek.com" />);

describe("P28f MacGuide (AC-391, AC-396, S-P28f-8)", () => {
  it("imzalı (prod): 'asla Yine de Aç istemez' uyarısı var, 'Gizlilik ve Güvenlik → Yine de Aç' adımı yok", () => {
    const html = guide(false);
    expect(html).toContain('data-testid="mac-never-open-anyway"');
    expect(html).toContain("Nokta Destek hiçbir zaman “Yine de Aç” istemez");
    expect(html).not.toContain("Gizlilik ve Güvenlik → Yine de Aç");
    expect(html).not.toContain("imzasız");
    expect(html).toContain('data-build="signed"');
  });
  it("TEST (staging): 'Yine de Aç' adımı var, 'asla' uyarısı yok (çelişki yok)", () => {
    const html = guide(true);
    expect(html).toContain("Gizlilik ve Güvenlik → Yine de Aç");
    expect(html).not.toContain('data-testid="mac-never-open-anyway"');
    expect(html).toContain('data-build="test"');
  });
  it("üç izin (Ekran Kaydı / Erişilebilirlik / Mikrofon) ve doğrulama kodu + sunucu", () => {
    const html = guide(false);
    expect(html).toContain("Ekran Kaydı (gerekli)");
    expect(html).toContain("Erişilebilirlik (yalnız kontrol için)");
    expect(html).toContain("Mikrofon (yalnız sesli görüşme için)");
    expect(html).toContain("İzni verdim, yeniden başlat");
    expect(html).toContain("doğrulama kodu 4821, sunucu adresi destek.ornek.com");
    expect(html).toContain("klasör adındaki 8 haneli kodu yazın");
  });
});

describe("P28f AgentDownload (macOS)", () => {
  const render = (testBuild: boolean) =>
    renderToStaticMarkup(<AgentDownload sessionRef="r1" verifyCode="4821" os="macos" testBuild={testBuild} onEnd={noop} />);
  it("indirme os=macos adresine, macOS rehberi; SmartScreen rehberi yok", () => {
    const html = render(false);
    expect(html).toContain('href="/api/v1/public/agent/download?ref=r1&amp;os=macos"');
    expect(html).toContain('data-os="macos"');
    expect(html).toContain("Hızlı Destek uygulamasını indir");
    expect(html).toContain("macOS 13 veya üstü");
    expect(html).toContain('data-testid="mac-guide"');
    expect(html).not.toContain('data-testid="smartscreen-guide"');
    expect(html).not.toContain('data-testid="mac-test-build"');
  });
  it("TEST sürümünde düğmenin yanında 'TEST SÜRÜMÜ — imzasız' uyarısı", () => {
    const html = render(true);
    expect(html).toContain('data-testid="mac-test-build"');
    expect(html.indexOf("mac-test-build")).toBeLessThan(html.indexOf("mac-guide"));
  });
  it("Windows değişmedi: os parametresi yok, SmartScreen rehberi", () => {
    const html = renderToStaticMarkup(<AgentDownload sessionRef="r1" verifyCode="4821" onEnd={noop} />);
    expect(html).toContain('href="/api/v1/public/agent/download?ref=r1"');
    expect(html).toContain('data-testid="smartscreen-guide"');
    expect(html).not.toContain('data-testid="mac-guide"');
  });
});
