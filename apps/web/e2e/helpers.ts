import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";

/** Her testte konsol hatası/uyarısı 0 (beklenen API hata yanıtlarının ağ kaydı hariç). */
export function guardConsole() {
  const errors: string[] = [];
  test.beforeEach(({ page }) => {
    errors.length = 0;
    const expectedNet = /^Failed to load resource: the server responded with a status of (400|401|403|404|409|410|423|429|500|502|503)/;
    page.on("console", (m) => {
      if ((m.type() === "error" || m.type() === "warning") && !expectedNet.test(m.text())) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
  });
  test.afterEach(() => expect(errors, "konsolda hata/uyarı olmamalı").toEqual([]));
}

/** Sahte API'de test başına yalıtılmış kullanıcı (e2e/mock-sessions.mjs): u-<senaryo>-<rastgele>. */
export async function signIn(context: BrowserContext, scenario = "plain") {
  const value = `u-${scenario}-${Math.random().toString(36).slice(2)}`;
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
  await context.addCookies([
    { ...base, name: SESSION_COOKIE, value, httpOnly: true },
    { ...base, name: CSRF_COOKIE, value: "csrf-test-token" },
  ]);
}

/**
 * WCAG 2.1 AA taraması. `include`: yalnız değişen bölge (aynı sayfanın geri kalanı önceki taramada temiz).
 * Legacy mod (AC-39 kararsızlığı, P8): varsayılan mod her taramada axe'ı iki kez enjekte edip aynı context'te
 * boş bir SEKME açar (finishRun). Yeni sekme taranan sayfayı arka plana atar (rAF/zamanlayıcı kısılır) ve yük
 * altında tarama başına 4–9 sn sürer. Uygulamada iframe yok → legacy mod (tek enjeksiyon, aynı sayfada axe.run)
 * aynı kuralları aynı DOM'da çalıştırır.
 */
export async function axeScan(page: Page, include?: string) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  let b = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).setLegacyMode(true);
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "yatay taşma olmamalı").toBeLessThanOrEqual(0);
}

/** Masaüstünde tablo satırı, mobilde kart — görünür olan. */
export const rows = (page: Page) => page.locator('[data-testid="session-row"], [data-testid="session-card"]').filter({ visible: true });
