import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { nextTheme, ThemeToggleButton } from "./theme-provider";

const noop = () => {};

describe("üst çubuk tek tıklık tema düğmesi (std. §1.6)", () => {
  it("döngü: Açık → Koyu → Sistem → Açık", () => {
    expect(nextTheme("LIGHT")).toBe("DARK");
    expect(nextTheme("DARK")).toBe("SYSTEM");
    expect(nextTheme("SYSTEM")).toBe("LIGHT");
  });

  it("erişilebilir ad ve ipucu şimdikini ve sıradakini Türkçe söyler; ikon yalnız süs", () => {
    const html = renderToStaticMarkup(<ThemeToggleButton theme="DARK" onToggle={noop} testId="theme-toggle" />);
    expect(html).toContain('aria-label="Tema: Koyu (tıklayınca: Sistem)"');
    expect(html).toContain('title="Tema: Koyu (tıklayınca: Sistem)"');
    expect(html).toContain('data-value="DARK"');
    expect(html).toContain('type="button"');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("ikon o anki seçimi gösterir (Sun / Moon / Laptop)", () => {
    const icon = (theme: "LIGHT" | "DARK" | "SYSTEM") =>
      renderToStaticMarkup(<ThemeToggleButton theme={theme} onToggle={noop} testId="x" />).match(/lucide-([a-z-]+)/)?.[1];
    expect(icon("LIGHT")).toBe("sun");
    expect(icon("DARK")).toBe("moon");
    expect(icon("SYSTEM")).toBe("laptop");
  });

  it("dokunma hedefi 44 px ve geçiş animasyonu yok (anında)", () => {
    const html = renderToStaticMarkup(<ThemeToggleButton theme="LIGHT" onToggle={noop} testId="x" />);
    expect(html).toContain("size-11");
    expect(html).not.toMatch(/transition|duration-/);
  });
});
