import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AcceptedCard, RequestDownload, requestDownloadOffer, type RequestDownloadOffer } from "./waiting-parts";
import type { AcceptedPhase } from "./request-socket";

// P31 (AC-520, AC-521): /r/<ref> kabul kartının indirme bağlantısı — macOS'ta os=macos + kaynağa çapalı uyarı.
const HREF = "/api/v1/public/agent/request-download?ref=abcdefghijklmnop";
const dl = (offer: RequestDownloadOffer, href = HREF) =>
  renderToStaticMarkup(<RequestDownload href={href} offer={offer} host="destek.ornek.com" />);

describe("P31 requestDownloadOffer (AC-520, AC-521)", () => {
  it("yalnız macOS + availability macos:true → macos (varyantıyla)", () => {
    expect(requestDownloadOffer("macos", { state: "ready", os: "macos", variant: "adhoc" })).toEqual({ kind: "macos", variant: "adhoc" });
    expect(requestDownloadOffer("macos", { state: "ready", os: "macos", variant: "notarized" })).toEqual({
      kind: "macos",
      variant: "notarized",
    });
  });
  it("macOS kapısı denetlenirken loading; kapı kapalı / hata (none) → Windows bağlantısı (fail-closed, gerileme yok)", () => {
    expect(requestDownloadOffer("macos", { state: "loading" })).toEqual({ kind: "loading" });
    expect(requestDownloadOffer("macos", { state: "none" })).toEqual({ kind: "windows" });
  });
  it("Windows, Linux (AC-521) ve bilinmeyen cihaz → bugünkü Windows bağlantısı", () => {
    for (const os of ["windows", "linux", null] as const)
      expect(requestDownloadOffer(os, { state: "ready", os: "macos", variant: "adhoc" })).toEqual({ kind: "windows" });
  });
});

describe("P31 RequestDownload (AC-520)", () => {
  it("Windows: metin ve adres değişmedi, uyarı yok", () => {
    const html = dl({ kind: "windows" });
    expect(html).toContain(`href="${HREF}"`);
    expect(html).toContain('data-os="windows"');
    expect(html).toContain("Uzaktan kontrol gerekiyorsa Windows programını indirin");
    expect(html).not.toContain("wr-mac-adhoc-only");
  });
  it("macOS ad-hoc: &os=macos, Mac metni, düğmenin hemen altında kaynağa çapalı uyarı + firma adı cümlesi", () => {
    const html = dl({ kind: "macos", variant: "adhoc" });
    expect(html).toContain(`href="${HREF}&amp;os=macos"`);
    expect(html).toContain('data-os="macos"');
    expect(html).toContain("Uzaktan kontrol gerekiyorsa Nokta Destek&#x27;i (macOS) indirin");
    expect(html).not.toContain("Windows programını");
    const warn = html.indexOf("wr-mac-adhoc-only");
    expect(warn).toBeGreaterThan(html.indexOf("wr-download"));
    const block = html.slice(warn);
    expect(block).toContain("yalnız tarayıcınızda destek.ornek.com adresinden indirdiğiniz Nokta Destek için kullanın");
    expect(block).toContain("“Nereden” satırı https://destek.ornek.com/ ile başlamalı");
    expect(block).toContain("Firmanız size yalnız bağlantı gönderir, dosya göndermez. Dosya ek olarak geldiyse açmayın.");
    expect(block).toContain("bu yalnız doğru firmaya bağlandığınızı gösterir, dosyanın güvenli olduğunu göstermez");
  });
  it("macOS test (staging) derlemesi de 'Yine de Aç' ister → uyarı var; notarized → uyarı yok, adres yine os=macos", () => {
    expect(dl({ kind: "macos", variant: "test" })).toContain('data-testid="wr-mac-adhoc-only"');
    const n = dl({ kind: "macos", variant: "notarized" });
    expect(n).not.toContain("wr-mac-adhoc-only");
    expect(n).toContain("&amp;os=macos");
  });
  it("mutlak taban (portal links.downloadUrl) korunur", () => {
    expect(dl({ kind: "macos", variant: "adhoc" }, "https://destek.ornek.com/api/v1/public/agent/request-download?ref=x")).toContain(
      'href="https://destek.ornek.com/api/v1/public/agent/request-download?ref=x&amp;os=macos"',
    );
  });
  it("loading: iskelet + ekran okuyucu metni, bağlantı yok (yanlış dosya indirilemez)", () => {
    const html = dl({ kind: "loading" });
    expect(html).toContain('data-testid="wr-download-loading"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("İndirme seçeneği denetleniyor");
    expect(html).not.toContain('wr-download"');
    expect(html).not.toContain("href=");
  });
});

describe("P31 AcceptedCard", () => {
  const phase = { kind: "accepted", technicianName: "Selin", techVerifyCode: "4821", admitCode: null } as unknown as AcceptedPhase;
  const noop = () => undefined;
  it("varsayılan Windows bağlantısı (download verilmezse bugünkü davranış)", () => {
    const html = renderToStaticMarkup(<AcceptedCard phase={phase} downloadHref={HREF} onShare={noop} onDecline={noop} />);
    expect(html).toContain(`href="${HREF}"`);
    expect(html).toContain('data-testid="wr-share"');
  });
  it("macOS: kart içinde Mac bağlantısı ve uyarı (sunucu çiziminde host '—')", () => {
    const html = renderToStaticMarkup(
      <AcceptedCard phase={phase} downloadHref={HREF} download={{ kind: "macos", variant: "adhoc" }} onShare={noop} onDecline={noop} />,
    );
    expect(html).toContain("&amp;os=macos");
    expect(html).toContain('data-testid="wr-mac-adhoc-only"');
    expect(html).toContain("yalnız tarayıcınızda — adresinden");
  });
});
