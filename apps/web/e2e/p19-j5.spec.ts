import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import { axeScan, guardConsole, noHorizontalOverflow } from "./helpers";

// P19 J5 (AC-259, 261, 263, AC-292 form satırı, S-P19-14, S-P19-T4, B1). Sahte API + sahte /ws/request: e2e/mock-p19.mjs.
guardConsole();
const REF = "webformaaaaaaaaa";
const MOCK = "http://127.0.0.1:4217";
const desktopOnly = (name: string) => test.skip(name !== "desktop", "paylaşılan sahte durum: tek proje");
const newRoom = () => Math.random().toString(36).slice(2, 10);
const stats = async (page: Page, ref: string) =>
  (await (await page.request.get(`${MOCK}/__e2e/p19/gets/${ref}`)).json()) as {
    gets: number;
    posts: number;
    last: Record<string, unknown>;
  };

async function signInP19(context: BrowserContext, role: "p19adm" | "p19noimp") {
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
  await context.addCookies([
    { ...base, name: SESSION_COOKIE, value: `u-${role}-${newRoom()}`, httpOnly: true },
    { ...base, name: CSRF_COOKIE, value: "csrf-test-token" },
  ]);
}

async function fillForm(page: Page) {
  await page.getByTestId("wr-name").fill("Ayşe Yılmaz");
  await page.getByTestId("wr-phone").fill("0532 111 22 33");
  await page.getByTestId("wr-desc").fill("Yazıcı çalışmıyor");
  await page.getByTestId("wr-consent").check();
}

async function scanBoth(browser: Browser, path: string, ready: (p: Page) => Promise<void>, signIn = false) {
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
    if (signIn) await signInP19(ctx, "p19adm");
    const p = await ctx.newPage();
    await p.goto(path);
    await ready(p);
    await noHorizontalOverflow(p);
    expect(await axeScan(p), `${path} ${scheme} 390`).toEqual([]);
    await ctx.close();
  }
}

test("B1: /r/<ref> herkese açık; CSP frame-ancestors 'none', connect-src wss://<host> (çıplak wss: yok)", async ({ page }) => {
  const res = await page.request.get(`/r/${REF}`, { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  const csp = res.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  const connect = csp.split(";").find((d) => d.trim().startsWith("connect-src")) ?? "";
  expect(connect).toMatch(/wss:\/\/localhost:\d+/);
  expect(connect.split(/\s+/)).not.toContain("wss:");
  expect(res.headers()["referrer-policy"]).toBe("no-referrer");
});

test("AC-259: geçersiz ref → tek tip bulunamadı ekranı", async ({ page }) => {
  await page.goto("/r/abcdefghijklmnop");
  await expect(page.getByTestId("guest-notFound")).toBeVisible();
  await page.goto("/r/BOZUK");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("AC-259: kutucuklar işaretsiz, 2 sn sayacı, gönderim → bekleme → sohbet → kabul (doğrulama + kabul kodu)", async ({ page }, info) => {
  desktopOnly(info.project.name);
  await page.goto(`/r/${REF}`);
  await expect(page.getByTestId("wr-form")).toBeVisible();
  await expect(page.getByTestId("wr-notify-sms")).not.toBeChecked();
  await expect(page.getByTestId("wr-notify-email")).not.toBeChecked();
  await expect(page.getByTestId("wr-notify-whatsapp")).toHaveCount(0); // firma kapalı kanal gösterilmez
  await expect(page.getByTestId("wr-consent")).not.toBeChecked();
  await expect(page.getByTestId("wr-website")).toHaveAttribute("tabindex", "-1");
  await expect(page.getByTestId("chat-retention-notice")).toContainText("30 gün");
  await fillForm(page);
  // e-posta bildirimi seçilince e-posta zorunlu
  await page.getByTestId("wr-notify-email").check();
  await expect(page.getByTestId("wr-submit")).toBeEnabled({ timeout: 5000 });
  await page.getByTestId("wr-submit").click();
  await expect(page.getByText("E-posta ile bildirim için e-posta adresi girin")).toBeVisible();
  await page.getByTestId("wr-email").fill("ayse@ornek.com");
  await page.getByTestId("wr-submit").click();
  await expect(page.getByTestId("wr-waiting")).toBeVisible();
  const s = await stats(page, REF);
  expect(s.last.notify).toEqual({ sms: false, whatsapp: false, email: true });
  expect(s.last.website).toBe("");
  await expect(page.getByTestId("wr-position")).toHaveText("2");
  await expect(page.getByTestId("wr-chat-empty")).toBeVisible();
  await expect(page.getByTestId("wr-chat").getByTestId("chat-retention-notice")).toBeVisible();
  await page.getByTestId("wr-chat-input").fill("<b>merhaba</b>");
  await page.getByTestId("wr-chat-send").click();
  await expect(page.getByTestId("wr-chat-list")).toContainText("<b>merhaba</b>");
  await page.request.get(`${MOCK}/__e2e/p19/techmsg/${REF}?body=${encodeURIComponent("Bakıyorum")}`);
  await expect(page.getByTestId("wr-chat-list")).toContainText("Bakıyorum");
  // F5: sır sessionStorage'da → bekleme sayfasına dönülür
  await page.reload();
  await expect(page.getByTestId("wr-waiting")).toBeVisible();
  await expect(page.getByTestId("wr-position")).toHaveText("2");
  await page.request.get(`${MOCK}/__e2e/p19/accept/${REF}?admit=1`);
  await expect(page.getByTestId("wr-accepted")).toContainText("Selin Teknik");
  await expect(page.getByTestId("wr-verify-code")).toHaveText("4821");
  await expect(page.getByTestId("wr-admit-code")).toContainText("7351");
  await expect(page.getByTestId("wr-share")).toBeVisible();
  await expect(page.getByTestId("wr-download")).toHaveAttribute("href", `/api/v1/public/agent/request-download?ref=${REF}`);
  await page.getByTestId("wr-decline").click();
  await expect(page.getByTestId("wr-closed-cancelled")).toBeVisible();
  await page.getByTestId("wr-new").click();
  await expect(page.getByTestId("wr-form")).toBeVisible();
});

test("AC-259: talebi iptal et → kapanış + yeni talep", async ({ page }, info) => {
  desktopOnly(info.project.name);
  await page.goto(`/r/${REF}`);
  await fillForm(page);
  await expect(page.getByTestId("wr-submit")).toBeEnabled({ timeout: 5000 });
  await page.getByTestId("wr-submit").click();
  await page.getByTestId("wr-cancel").click();
  await expect(page.getByTestId("wr-closed-cancelled")).toBeVisible();
  await expect(page.getByTestId("wr-new")).toBeVisible();
});

test("AC-292: saklama satırı yoksa gönder düğmesi pasif", async ({ page }) => {
  await page.goto("/r/webformnoretenti");
  await expect(page.getByTestId("wr-form")).toBeVisible();
  await fillForm(page);
  await page.waitForTimeout(2300);
  await expect(page.getByTestId("chat-retention-notice")).toHaveCount(0);
  await expect(page.getByTestId("wr-submit")).toBeDisabled();
});

for (const [ref, text] of [
  ["webformratelimit", "Lütfen birkaç saniye sonra tekrar deneyin."],
  ["webformtokenbadx", "Formun süresi doldu, sayfayı yenileyin."],
] as const)
  test(`S-P19-T4: ${ref} → mesaj, yeni token + 2 sn sayacı yeniden, ikinci deneme kabul`, async ({ page }, info) => {
    desktopOnly(info.project.name);
    await page.goto(`/r/${ref}`);
    await fillForm(page);
    await expect(page.getByTestId("wr-submit")).toBeEnabled({ timeout: 5000 });
    const before = (await stats(page, ref)).gets;
    await page.getByTestId("wr-submit").click();
    await expect(page.getByRole("alert").filter({ hasText: text })).toBeVisible();
    await expect.poll(async () => (await stats(page, ref)).gets).toBe(before + 1);
    await expect(page.getByTestId("wr-submit")).toContainText("sn"); // sayaç yeniden kuruldu
    await expect(page.getByTestId("wr-submit")).toBeEnabled({ timeout: 5000 });
    await page.getByTestId("wr-submit").click();
    await expect(page.getByTestId("wr-waiting")).toBeVisible();
  });

test("web formu iki tema axe 0, 390 px taşma yok", async ({ browser }) => {
  await scanBoth(browser, `/r/${REF}`, (p) => expect(p.getByTestId("wr-form")).toBeVisible());
});

test("AC-259/261: talep ayarları — web formu anahtarı, form bağlantısı, kanal uyarı bandı; kaydet", async ({ page, context }) => {
  await signInP19(context, "p19adm");
  await page.goto("/settings/support-requests");
  await expect(page.getByTestId("web-form-url")).toHaveText("http://localhost:3217/r/webformaaaaaaaaa");
  await expect(page.getByTestId("web-form-off-hint")).toBeVisible();
  await expect(page.getByTestId("channel-warning-sms")).toBeVisible();
  await expect(page.getByTestId("channel-warning-sms").getByRole("link")).toHaveAttribute("href", "/settings/sms");
  await page.getByTestId("web-form-switch").click();
  await page.getByTestId("notify-sms-switch").click();
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByTestId("web-form-off-hint")).toHaveCount(0);
  await expect(page.getByTestId("channel-warning-sms")).toHaveCount(0);
});

test("AC-263: müşteriler — dışa aktar indirir; içe aktar 3 adım + hata raporu; Güncelle düzenle yetkisiz pasif", async ({
  page,
  context,
}) => {
  await signInP19(context, "p19adm");
  await page.goto("/customers");
  const dl = page.waitForEvent("download");
  await page.getByTestId("customers-export").click();
  expect((await dl).suggestedFilename()).toBe("musteriler-20261115.csv");
  await page.getByTestId("customers-import-open").click();
  await expect(page).toHaveURL(/\/customers\/import$/);
  await expect(page.getByTestId("import-preview-btn")).toBeDisabled();
  await page.getByTestId("import-file").setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("a") });
  await expect(page.getByTestId("import-file-error")).toContainText(".csv");
  await page.getByTestId("import-file").setInputFiles({ name: "bozuk.csv", mimeType: "text/csv", buffer: Buffer.from("BOZUK\n") });
  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("import-file-error")).toContainText("“Ad” sütunu bulunamadı");
  await page
    .getByTestId("import-file")
    .setInputFiles({ name: "m.csv", mimeType: "text/csv", buffer: Buffer.from("Ad;Telefon\nYeni A;0532\n") });
  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("import-step-preview")).toBeVisible();
  await expect(page.getByTestId("import-count-create")).toContainText("2");
  await expect(page.getByTestId("import-count-error")).toContainText("1");
  await expect(page.getByTestId("import-rows")).toContainText("=KÖTÜ");
  await expect(page.getByTestId("import-mode-skip")).toBeChecked();
  await expect(page.getByTestId("import-mode-update")).toBeDisabled();
  const rep = page.waitForEvent("download");
  await page.getByTestId("import-error-report").click();
  const report = await rep;
  expect(report.suggestedFilename()).toBe("ice-aktarma-hatalari.csv");
  const text = await (await import("node:fs/promises")).readFile((await report.path())!, "utf8");
  expect(text).toBe("﻿Satır;Sütun;Hata\r\n5;Telefon;Telefon numarası geçersiz\r\n");
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("import-step-done")).toBeVisible();
  await expect(page.getByTestId("import-result-created")).toContainText("2");
  await expect(page.getByTestId("import-result-skipped")).toContainText("1");
});

test("S-P19-14: içe aktarma yetkisi yoksa düğme gizli ve sayfa uyarı verir", async ({ page, context }) => {
  await signInP19(context, "p19noimp");
  await page.goto("/customers");
  await expect(page.getByTestId("customer-new")).toBeVisible();
  await expect(page.getByTestId("customers-import-open")).toHaveCount(0);
  await expect(page.getByTestId("customers-export")).toHaveCount(0);
  await page.goto("/customers/import");
  await expect(page.getByTestId("import-forbidden")).toBeVisible();
});

test("AC-259: geçmişte kaynak filtresi ve 'Web' rozeti", async ({ page, context }) => {
  await signInP19(context, "p19adm");
  await page.goto("/requests?tab=history&source=WEB");
  await expect(page.getByTestId("source-filter").getByRole("link", { name: "Web" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("request-source-web")).toHaveText(/Web/);
  await page.getByTestId("source-filter").getByRole("link", { name: "İstemci" }).click();
  await expect(page).toHaveURL(/source=AGENT/);
  await expect(page.getByTestId("requests-history-empty")).toBeVisible();
});

test("panel P19 ekranları iki tema axe 0, 390 px", async ({ browser }) => {
  await scanBoth(browser, "/customers/import", (p) => expect(p.getByTestId("import-step-file")).toBeVisible(), true);
  await scanBoth(browser, "/settings/support-requests", (p) => expect(p.getByTestId("web-form-url")).toBeVisible(), true);
});
