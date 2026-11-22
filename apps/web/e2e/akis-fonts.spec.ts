import { expect, test } from "@playwright/test";
import { guardConsole } from "./helpers";

// Akış görsel dili (2026-11-23, DESIGN §3): Geologica + JetBrains Mono self-host (@fontsource-variable, OFL-1.1).
// (Vitrin 2026-11-17'de Plus Jakarta Sans idi; dosya vitrin-fonts.spec.ts'ten yeniden adlandırıldı.)
// Font dosyaları aynı kökenden gelir (CSP default-src 'self'; font-src yok) ve Türkçe latin-ext glifleri (ğ ı İ ş) yüklenir.
guardConsole();
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "masaüstü yeter"));

test("Akış: fontlar self-host yüklenir, Türkçe latin-ext dahil, CSP hatası yok", async ({ page }) => {
  const fonts: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "font") fonts.push(r.url());
  });
  await page.goto("/login");
  const ok = await page.evaluate(async () => {
    const p = document.createElement("p");
    p.textContent = "Ğğ ıİ Şş Çç Öö Üü 0123456789";
    const c = document.createElement("code");
    c.textContent = "ğışİ 0123";
    document.body.append(p, c);
    await Promise.all([
      document.fonts.load('16px "Geologica Variable"', "ğışİ"),
      document.fonts.load('16px "JetBrains Mono Variable"', "ğışİ"),
    ]);
    return {
      sans: document.fonts.check('16px "Geologica Variable"', "ğışİ"),
      mono: document.fonts.check('16px "JetBrains Mono Variable"', "ğışİ"),
      body: getComputedStyle(document.body).fontFamily,
      code: getComputedStyle(c).fontVariantNumeric,
    };
  });
  expect(ok.sans).toBe(true);
  expect(ok.mono).toBe(true);
  expect(ok.body).toMatch(/^"Geologica Variable"/);
  expect(ok.code).toBe("tabular-nums");
  expect(fonts.length).toBeGreaterThan(0);
  for (const u of fonts) expect(new URL(u).origin).toBe(new URL(page.url()).origin);
  expect(fonts.some((u) => u.includes("latin-ext"))).toBe(true);
});
