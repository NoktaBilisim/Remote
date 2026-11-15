import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "@remote/contracts/api/auth";

const EXPECTED_NET = /^Failed to load resource: the server responded with a status of (400|401|403|404|409|410|423|429|500|502|503)/;

/**
 * Her testte konsol hatası/uyarısı 0 (beklenen API hata yanıtlarının ağ kaydı hariç).
 * `expectedNet`: dosyaya özgü beklenen ağ kaydı deseni (ör. kesilen istek "net::ERR_FAILED").
 */
export function guardConsole(expectedNet: RegExp = EXPECTED_NET) {
  const errors: string[] = [];
  test.beforeEach(({ page }) => {
    errors.length = 0;
    page.on("console", (m) => {
      if ((m.type() === "error" || m.type() === "warning") && !expectedNet.test(m.text())) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
  });
  test.afterEach(() => expect(errors, "konsolda hata/uyarı olmamalı").toEqual([]));
}

/** Yalnız "desktop" projesinde koşan test (diğer projelerde atlanır). */
export const desktopOnly = (name: string, reason = "masaüstü akışı") => test.skip(name !== "desktop", reason);

/** Sahte API oturum + CSRF çerezleri; `value` senaryoyu taşır (u-<senaryo>-…). Çerez değerini döner. */
export async function sessionCookies(context: BrowserContext, value: string) {
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
  await context.addCookies([
    { ...base, name: SESSION_COOKIE, value, httpOnly: true },
    { ...base, name: CSRF_COOKIE, value: "csrf-test-token" },
  ]);
  return value;
}

/** Sahte API'de test başına yalıtılmış kullanıcı (e2e/mock-sessions.mjs): u-<senaryo>-<rastgele>. Çerez değerini döner. */
export async function signIn(context: BrowserContext, scenario = "plain") {
  return sessionCookies(context, `u-${scenario}-${Math.random().toString(36).slice(2)}`);
}

/** Sahte API'de yeni destek oturumu (201 beklenir). */
export async function newSession(page: Page) {
  const r = await page.request.post("/api/v1/sessions", {
    headers: { [CSRF_HEADER]: "csrf-test-token", Origin: "http://localhost:3217" },
    data: {},
  });
  expect(r.status()).toBe(201);
  return (await r.json()) as { id: string; link: string };
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

/** Açık + koyu temada (`width` px, hareket kapalı) oturumlu sayfa: yatay taşma yok, axe 0. */
export async function scanBoth(browser: Browser, scenario: string, path: string, width: number, ready: (p: Page) => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
    await signIn(ctx, scenario);
    const p = await ctx.newPage();
    await p.goto(path);
    await ready(p);
    await noHorizontalOverflow(p);
    expect(await axeScan(p), `${path} ${scheme} ${width}`).toEqual([]);
    await ctx.close();
  }
}
