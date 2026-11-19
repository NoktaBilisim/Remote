import { expect, test, type Page } from "@playwright/test";
import { desktopOnly, guardConsole, scanBoth, signIn } from "./helpers";

// P29-K5 (mimari-p29 §6) — AC-485, 486, 490, 491 (UI). Sahte API: e2e/mock-p29.mjs (u-p29*), audit e2e/mock-audit.mjs (u-auupd-*).
guardConsole();
const row = (page: Page, name: string) =>
  page.locator('[data-testid="un-row"], [data-testid="un-card"]').filter({ visible: true }).filter({ hasText: name });

test("AC-490/486 Sürüm sütunu: beş rozet metinle, hedef sürüm, başarısız nedeni", async ({ page, context }) => {
  await signIn(context, "p29adm");
  await page.goto("/unattended");
  const badge = (name: string) => row(page, name).getByTestId("upd-badge");
  await expect(badge("GUNCEL-PC")).toHaveText("Güncel");
  await expect(badge("BEKLEYEN-PC")).toHaveText("Güncelleme bekliyor→ 0.22.1");
  await expect(badge("KURULAN-PC")).toHaveText("Güncelleniyor→ 0.22.1");
  await expect(badge("HATALI-PC")).toHaveText("Güncelleme başarısız (bütünlük)");
  await expect(badge("ESKI-PC")).toHaveText("Asgari sürümün altında");
  await expect(badge("ESKI-PC")).toHaveAttribute("data-badge", "BELOW_MIN");
  await expect(row(page, "ESKI-PC").getByTestId("upd-version")).toContainText("0.21.0");
});

test("AC-490 dağılım şeridi: yayındaki sürüm, sayılar; tıklayınca ?version= süzgeci, yoklamada korunur, Süzgeci kaldır", async ({
  page,
  context,
}) => {
  await signIn(context, "p29adm");
  await page.goto("/unattended");
  const strip = page.getByTestId("upd-strip");
  await expect(strip.getByTestId("upd-published")).toContainText("Servis 0.22.1");
  await expect(strip.getByTestId("upd-published")).toContainText("macOS —");
  await expect(strip.getByTestId("upd-row")).toHaveCount(3);
  await expect(strip.locator('[data-version="0.22.0"]')).toContainText("Windows servisi 0.22.0");
  await expect(strip.locator('[data-version="0.22.0"]')).toContainText("3 cihaz");
  await expect(strip.locator('[data-version="0.22.1"]')).toContainText("yayındaki");
  await expect(strip.getByTestId("upd-below-min")).toHaveText("Asgari sürümün altında: 1 cihaz");

  const listed = page.waitForRequest((r) => r.url().includes("/unattended/devices") && r.url().includes("version=0.22.0"));
  await strip.locator('[data-version="0.22.0"]').getByRole("link").click();
  await expect(page).toHaveURL(/\/unattended\?version=0\.22\.0$/);
  await expect(strip.locator('[data-version="0.22.0"]').getByRole("link")).toHaveAttribute("aria-current", "true");
  await expect(row(page, "BEKLEYEN-PC")).toBeVisible();
  await expect(row(page, "GUNCEL-PC")).toHaveCount(0);
  // 8 sn yoklaması süzgeci düşürmez (istemci isteği version= taşır)
  await listed;
  await page.getByTestId("upd-clear").click();
  await expect(page).toHaveURL(/\/unattended$/);
  await expect(row(page, "GUNCEL-PC")).toBeVisible();
});

test("AC-490 kısmi (yayın bilgisi yok) ve hata → Tekrar dene; liste her durumda görünür", async ({ page, context }) => {
  await signIn(context, "p29nopub");
  await page.goto("/unattended");
  await expect(page.getByTestId("upd-published-none")).toHaveText("Yayın bilgisi alınamadı; yalnız cihazlardaki sürümler gösteriliyor.");
  await expect(page.getByTestId("upd-row")).toHaveCount(3);

  await signIn(context, "p29brk");
  await page.goto("/unattended");
  await expect(page.getByTestId("upd-strip-error")).toContainText("Sürüm dağılımı alınamadı");
  await expect(row(page, "GUNCEL-PC")).toBeVisible();
  await page.getByTestId("upd-strip-retry").click();
  await expect(page.getByTestId("upd-strip")).toBeVisible();
  await expect(page.getByTestId("upd-strip-error")).toHaveCount(0);
});

test("AC-490 boş: cihaz yoksa şerit çizilmez, liste boş durumu", async ({ page, context }) => {
  await signIn(context, "p29empty");
  await page.goto("/unattended");
  await expect(page.getByTestId("un-empty")).toBeVisible();
  await expect(page.getByTestId("upd-strip")).toHaveCount(0);
});

test("AC-490 Super Admin 'Tüm firmalar': scope=all, yalnız sayı (bağlantı yok); firma kullanıcısı scope istemez", async ({
  page,
  context,
}) => {
  await signIn(context, "p29sa");
  await page.goto("/unattended");
  const strip = page.getByTestId("upd-strip");
  await expect(strip).toHaveAttribute("data-scope", "tenant");
  await strip.getByRole("button", { name: "Tüm firmalar" }).click();
  await expect(page).toHaveURL(/scope=all/);
  await expect(page.getByTestId("upd-strip")).toHaveAttribute("data-scope", "all");
  await expect(page.getByTestId("upd-strip").locator('[data-version="0.20.0"]')).toContainText("7 cihaz");
  await expect(page.getByTestId("upd-strip").getByRole("link", { name: /servisi/ })).toHaveCount(0);

  // ADMIN URL'de scope=all yazsa da şerit firma kapsamında kalır (sunucuya scope gitmez → 403 yok)
  await signIn(context, "p29adm");
  await page.goto("/unattended?scope=all");
  await expect(page.getByTestId("upd-strip")).toHaveAttribute("data-scope", "tenant");
  await expect(page.getByRole("button", { name: "Tüm firmalar" })).toHaveCount(0);
});

test("AC-490/287 liste + şerit 390 px, açık/koyu tema: taşma yok, axe 0", async ({ browser }, info) => {
  desktopOnly(info.project.name);
  await scanBoth(browser, "p29adm", "/unattended", 390, async (p) => {
    await expect(p.getByTestId("upd-strip")).toBeVisible();
    await expect(p.getByTestId("un-card").first()).toBeVisible();
  });
  await scanBoth(browser, "p29adm", "/unattended", 1280, async (p) => {
    await expect(p.getByTestId("un-table")).toBeVisible();
  });
});

test("AC-485 /settings/clients: varsayılan Açık, kapat → Kaydet → PUT {autoUpdate:false} + toast; sekme ikonlu", async ({
  page,
  context,
}) => {
  const cookie = await signIn(context, "p29adm");
  await page.goto("/settings/clients");
  await expect(page).toHaveTitle(/İstemciler/);
  await expect(page.getByTestId("settings-tabs").getByRole("link", { name: "İstemciler" })).toHaveAttribute("aria-current", "page");
  const sw = page.getByTestId("upd-auto");
  await expect(page.getByTestId("client-update-form")).toHaveAttribute("data-ready", "true");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("client-update-settings")).toContainText(
    "Kapalıyken programlar yeni sürümü kurmaz, yalnız haber verir. Asgari sürüm kuralı yine uygulanır.",
  );
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("save-bar")).toBeVisible();
  await page.getByTestId("save-bar-save").click();
  await expect(page.getByTestId("toast")).toContainText("İstemci güncelleme ayarı kaydedildi.");
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  const puts = await (await page.request.get(`http://localhost:4217/__e2e/p29/puts/${cookie}`)).json();
  expect(puts).toEqual([{ autoUpdate: false }]);
  await page.reload();
  await expect(page.getByTestId("upd-auto")).toHaveAttribute("aria-checked", "false");
});

test("AC-485 salt okunur (settings.view) ve hata → Tekrar dene", async ({ page, context }) => {
  await signIn(context, "p29ro");
  await page.goto("/settings/clients");
  await expect(page.getByTestId("settings-readonly")).toBeVisible();
  await expect(page.getByTestId("upd-auto")).toBeDisabled();

  await signIn(context, "p29brk");
  await page.goto("/settings/clients");
  await expect(page.getByTestId("load-error")).toBeVisible();
  await page.getByTestId("load-error").getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByTestId("upd-auto")).toBeVisible();
});

test("AC-485 ayar sayfası 390 px, açık/koyu tema: axe 0", async ({ browser }, info) => {
  desktopOnly(info.project.name);
  await scanBoth(browser, "p29adm", "/settings/clients", 390, async (p) => {
    await expect(p.getByTestId("upd-auto")).toBeVisible();
  });
});

test("AC-491 Audit: Türkçe etiketler, reddedildi/İstemci bildirdi, 'İstemci güncelleme' süzgeç grubu, ayrıntıda neden", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "auupd");
  await page.goto("/audit");
  const table = page.getByTestId("audit-table");
  await expect(table).toContainText("Güncelleme reddedildi (imza)");
  await expect(table).toContainText("İstemci bildirdi: Güncelleme reddedildi (eski sürüm)");
  await expect(table).toContainText("İstemci güncellendi");
  await expect(table).toContainText("İstemci güncellemesi geri alındı");
  await expect(table).toContainText("İstemci otomatik güncelleme ayarı değişti");
  // AC-491 (QA tur 1): ham eylem anahtarı tabloda, aria etiketlerinde ve ayrıntıda görünmez
  await expect(table).not.toContainText("client.update");
  await expect(table).not.toContainText("settings.client_update");
  for (const l of await table.locator("[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? "")))
    expect(l).not.toMatch(/client\.update|settings\.client_update/);

  const sel = page.getByTestId("audit-filters").getByLabel("İşlem");
  const group = sel.locator('optgroup[label="İstemci güncelleme"]');
  await expect(group.locator("option")).toHaveCount(6);
  await expect(group.locator('option[value="client.update.failed"]')).toHaveText("İstemci güncellemesi başarısız");
  await sel.selectOption("client.*");
  await page.getByTestId("audit-filters").getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/action=client\.\*/);
  await expect(table).not.toContainText("İstemci otomatik güncelleme ayarı değişti");

  await page
    .getByRole("button", { name: /Güncelleme reddedildi \(imza\)/ })
    .first()
    .click();
  const dlg = page.getByTestId("audit-detail");
  await expect(dlg.getByTestId("audit-update-reason")).toHaveText("imza");
  await expect(dlg).not.toContainText("client.update");
});

test("AC-491 Audit mobil kart: Türkçe etiket, ham anahtar yok (metin ve aria)", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(context, "auupd");
  await page.goto("/audit");
  const main = page.locator("main");
  await expect(main.getByRole("button", { name: /Güncelleme reddedildi \(imza\)/ }).first()).toBeVisible();
  await expect(main).not.toContainText("client.update");
  await expect(main).not.toContainText("settings.client_update");
  const labels = await main.locator("[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  for (const l of labels) expect(l).not.toMatch(/client\.update|settings\.client_update/);
});
