import { expect, test, type Page } from "@playwright/test";
import { axeScan, desktopOnly, guardConsole, noHorizontalOverflow, signIn } from "./helpers";

// P14b G2 UI/a11y (AC-220, 222, 223, 224, 228; mimari-e11 §5.1). Sahte API çerez senaryoları: u-usadm-* (kullanıcılar),
// u-rqcu-* / u-rqcuempty-* (müşteriler), u-acc-* / u-accro-* / u-accbad-* (ayarlar, mock-account), u-hu-* (geçmiş notu).
guardConsole();
const SCHEMES = ["light", "dark"] as const;

test("AC-220: olmayan kullanıcı/müşteri id'si → belge yanıtı HTTP 404, sayfada tek h1 '… bulunamadı'", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  for (const [scenario, url, h1] of [
    ["usadm", "/users/01JKS0000000000000000000ZZ", "Kullanıcı bulunamadı"],
    ["usadm", "/users/gecersiz-id", "Kullanıcı bulunamadı"],
    ["rqcu", "/customers/01JKS0000000000000000000ZZ", "Müşteri bulunamadı"],
  ] as const) {
    await context.clearCookies();
    await signIn(context, scenario);
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(404);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText(h1);
    await expect(page).toHaveTitle(new RegExp(h1.split(" ")[0]!));
  }
  // var olan kayıt ve listeler 200 kalır (liste iskeletleri yerinde)
  await context.clearCookies();
  await signIn(context, "rqcu");
  expect((await page.goto("/customers/01JC5ST0000000000000000001"))?.status()).toBe(200);
  expect((await page.goto("/customers"))?.status()).toBe(200);
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/customers/01JKS0000000000000000000ZZ");
    await expect(page.getByTestId("customer-not-found")).toBeVisible();
    expect(await axeScan(page, "main"), `404 ${scheme}`).toEqual([]);
  }
});

async function activeInView(page: Page) {
  const nav = page.getByRole("navigation", { name: "Ana menü" });
  const active = nav.locator('[aria-current="page"]');
  await expect(active).toBeInViewport({ ratio: 1 });
  return nav;
}

test("AC-222: 375/390 px — menüdeki etkin öğe görünür alanda, kaydırılabilir menüde kaydırma ipucu var", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== "mobile", "mobil");
  await signIn(context, "acc");
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    // Ayarlar menünün sonlarında: açılışta etkin öğe yatay şeritte görünür alana alınır
    await page.goto("/settings/general");
    const nav = await activeInView(page);
    await expect(nav.locator('[aria-current="page"]')).toHaveAccessibleName("Ayarlar");
    const list = nav.locator("ul");
    expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth), "menü kaydırılabilir olmalı").toBe(true);
    // en az bir yönde ipucu (kenar maskesi + aria-hidden ok)
    const hints = nav.locator('[data-testid^="nav-scroll-hint-"]');
    await expect(hints.first()).toBeAttached();
    await expect(hints.first()).toHaveAttribute("aria-hidden", "true");
    expect(await list.evaluate((el) => getComputedStyle(el).maskImage)).not.toBe("none");
    // başa kaydırınca sondaki ipucu görünür, baştaki kaybolur
    await list.evaluate((el) => el.scrollTo({ left: 0 }));
    await expect(nav.getByTestId("nav-scroll-hint-end")).toBeAttached();
    await expect(nav.getByTestId("nav-scroll-hint-start")).toHaveCount(0);
    // menünün başındaki öğe etkinken de görünür
    await page.goto("/");
    await activeInView(page);
    await noHorizontalOverflow(page);
  }
});

test("AC-223: status=all boş durumu varsayılanla aynı; sayfada tek 'Müşteriye nasıl gönderilir?' diyaloğu", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "rqcuempty");
  for (const url of ["/customers", "/customers?status=all"]) {
    await page.goto(url);
    const empty = page.getByTestId("customers-empty");
    await expect(empty, url).toContainText("Henüz müşteri yok");
    await expect(empty.getByTestId("customer-new-empty")).toBeVisible();
    await expect(empty.getByTestId("customers-help-open-empty")).toBeVisible();
    await expect(page.getByTestId("customers-empty-filter")).toHaveCount(0);
    // üst eylemler + boş durum tetikleyicileri aynı tek diyaloğu açar
    await expect(page.locator('dialog[data-testid="customers-help"]')).toHaveCount(1);
  }
  const help = page.getByTestId("customers-help");
  for (const trigger of ["customers-help-open", "customers-help-open-empty"]) {
    const btn = page.getByTestId(trigger);
    await btn.click();
    await expect(help).toHaveJSProperty("open", true);
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
    await expect(btn).toBeFocused();
  }
  // pasif filtre boş durumu ayrı kalır (bu filtrede müşteri yok demek)
  await page.goto("/customers?status=passive");
  await expect(page.getByTestId("customers-empty-filter")).toContainText("Pasif müşteri yok");
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/customers?status=all");
    expect(await axeScan(page, "main"), `boş ${scheme}`).toEqual([]);
  }
});

test("AC-224: Ayarlar > Genel — sınır alanları, istemci + sunucu alan hataları, kayıt, salt okunur, hata durumu", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "acc");
  await page.goto("/settings/general");
  await expect(page).toHaveTitle(/Genel ayarlar/);
  await expect(page.getByTestId("settings-tabs").getByRole("link", { name: "Genel" })).toHaveAttribute("aria-current", "page");
  const form = page.getByTestId("limits-form");
  await expect(form).toHaveAttribute("data-ready", "true");
  const ttl = form.getByLabel("Kod ve bağlantı geçerliliği (dakika)");
  const hours = form.getByLabel("En uzun oturum süresi (saat)");
  const open = form.getByLabel("Teknisyen başına açık oturum sınırı");
  const mb = form.getByLabel("Dosya boyutu sınırı (MB)");
  await expect(ttl).toHaveValue("15");
  await expect(hours).toHaveValue("4");
  await expect(open).toHaveValue("3");
  await expect(mb).toHaveValue("100");

  // istemci doğrulaması: istek gitmez, alan bazlı hata, ilk hatalı alana odak
  let puts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/v1/settings/tenant") && r.method() === "PUT") puts++;
  });
  await ttl.fill("31");
  await hours.fill("0");
  await page.getByTestId("save-bar").getByRole("button", { name: "Kaydet" }).click();
  await expect(ttl).toBeFocused();
  await expect(ttl).toHaveAttribute("aria-invalid", "true");
  await expect(form).toContainText("15-30 arası olmalı");
  await expect(form).toContainText("1-8 arası olmalı");
  expect(puts).toBe(0);
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await axeScan(page, "main"), `hata ${scheme}`).toEqual([]);
  }

  // sunucu alan hatası forma yansır
  await ttl.fill("30");
  await hours.fill("8");
  await mb.fill("2047");
  await page.getByTestId("save-bar").getByRole("button", { name: "Kaydet" }).click();
  await expect(mb).toBeFocused();
  await expect(form).toContainText("Sunucu bu sınırı reddetti");

  // başarı: toast, değerler kalıcı
  await mb.fill("2048");
  await open.fill("10");
  await page.getByTestId("save-bar").getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByTestId("toast").last()).toContainText("Genel ayarlar kaydedildi");
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  await page.reload();
  await expect(form.getByLabel("Dosya boyutu sınırı (MB)")).toHaveValue("2048");
  await expect(form.getByLabel("Teknisyen başına açık oturum sınırı")).toHaveValue("10");
  await expect(form.getByLabel("Kod ve bağlantı geçerliliği (dakika)")).toHaveValue("30");

  // salt okunur (settings.view): alanlar pasif + uyarı
  await context.clearCookies();
  await signIn(context, "accro");
  await page.goto("/settings/general");
  await expect(page.getByTestId("settings-readonly")).toBeVisible();
  await expect(page.getByTestId("limit-maxFileMb")).toBeDisabled();

  // hata durumu → Tekrar dene ile toparlanır
  await context.clearCookies();
  await signIn(context, "accbad");
  await page.goto("/settings/general");
  await expect(page.getByTestId("load-error")).toBeVisible();
  await page
    .getByTestId("load-error")
    .getByRole("button", { name: /Tekrar dene/ })
    .click();
  await expect(page.getByTestId("limits-form")).toBeVisible();
});

test("AC-224: 390 px — Genel ayarlarda yatay taşma yok; iki temada axe 0", async ({ page, context }, info) => {
  test.skip(info.project.name !== "mobile", "mobil");
  await signIn(context, "acc");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/settings/general");
    await expect(page.getByTestId("limits-form")).toBeVisible();
    await noHorizontalOverflow(page);
    expect(await axeScan(page), `genel ${scheme}`).toEqual([]);
  }
});

test("AC-228: kaydedilmemiş oturum notu varken uygulama içi geri tuşu 'Kaydedilmemiş değişiklikler var' onayı gösterir", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "hu");
  await page.goto("/history");
  await page.getByRole("link", { name: "Ayrıntı: Ayşe Yılmaz" }).first().click(); // uygulama içi (istemci) gezinme
  await expect(page).toHaveURL(/\/history\/[0-9A-Z]{26}$/);
  const form = page.getByTestId("note-form");
  await form.getByTestId("note-input").fill("Kaydedilmemiş not");
  await expect(form.getByTestId("note-dirty")).toBeVisible();
  await page.goBack();
  const leave = page.getByTestId("leave-dialog");
  await expect(leave).toHaveJSProperty("open", true);
  await expect(leave.getByRole("heading", { name: "Kaydedilmemiş değişiklikler var" })).toBeVisible();
  await expect(leave.getByRole("button", { name: "Sayfada kal" })).toBeFocused();
  await expect(page).toHaveURL(/\/history\/[0-9A-Z]{26}$/);
  await page.keyboard.press("Escape"); // vazgeç = sayfada kal → nöbetçi yeniden itilir
  await expect(leave).toBeHidden();
  await expect(form.getByTestId("note-input")).toHaveValue("Kaydedilmemiş not");
  await page.goBack();
  await expect(leave).toHaveJSProperty("open", true);
  await leave.getByRole("button", { name: "Kaydetmeden ayrıl" }).click();
  await expect(page).toHaveURL(/\/history$/);
});

test.describe("CI 390 px taşması (Linux geniş font) — regresyon", () => {
  // CI Linux Chromium'da sistem fontu (DejaVu Sans) macOS'tan geniş; Verdana ile aynı metrik sınıfı zorlanır.
  // Stil enjeksiyonu için yalnız bu blokta CSP atlanır (uygulama CSP'si diğer testlerde doğrulanıyor).
  test.use({ bypassCSP: true });
  test("menü rozetlerinin sr-only metni kayan şeritten taşmaz (requests, customers @390)", async ({ page, context }, info) => {
    desktopOnly(info.project.name);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.addInitScript(() =>
      document.addEventListener("DOMContentLoaded", () => {
        const st = document.createElement("style");
        st.textContent = "*{font-family: Verdana, 'DejaVu Sans', sans-serif !important}";
        document.head.appendChild(st);
      }),
    );
    for (const [scenario, url] of [
      ["rqadm", "/requests"],
      ["rqadm", "/settings/support-requests"],
      ["rqcu", "/customers?status=all"],
    ] as const) {
      await context.clearCookies();
      await signIn(context, scenario);
      await page.goto(url);
      await expect(page.locator("h1").filter({ visible: true })).toHaveCount(1);
      await noHorizontalOverflow(page);
    }
  });
});
