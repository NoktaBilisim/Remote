import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { axeScan, guardConsole, noHorizontalOverflow, signIn } from "./helpers";

// P8 oturum geçmişi (AC-60..63, 124). Sahte API: e2e/mock-history.mjs (u-h<senaryo>-*).
guardConsole();
const RICH = "01JHXST0000000000000000000";
const BROWSER = "01JHXSTBRWSR00000000000002";
const rows = (p: Page) => p.locator('[data-testid="history-row"], [data-testid="history-card"]').filter({ visible: true });
const desktopOnly = (name: string) => test.skip(name !== "desktop", "masaüstü akışı");

test("AC-60: liste, sayfalama (25 varsayılan) ve sayfa boyutu URL'de; kenar menüsü öğesi", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "hu");
  await page.goto("/history");
  await expect(page).toHaveTitle(/Oturum geçmişi · Nokta Uzaktan Destek/);
  await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Oturum geçmişi" })).toHaveAttribute("aria-current", "page");
  await expect(rows(page)).toHaveCount(25);
  await expect(page.getByTestId("history-count")).toHaveText("30 oturumdan 1–25 arası");
  await page.getByRole("navigation", { name: "Sayfalar" }).getByRole("link", { name: "Sonraki sayfa" }).click();
  await expect(page).toHaveURL(/\/history\?page=2$/);
  await expect(rows(page)).toHaveCount(5);
  await page.getByTestId("page-size").selectOption("10");
  await expect(page).toHaveURL(/\/history\?pageSize=10$/);
  await expect(rows(page)).toHaveCount(10);
  await expect(page.getByTestId("page-of")).toHaveText("Sayfa 1 / 3");
  // USER: teknisyen sütunu/filtresi yok (kapsam arka uçta)
  await expect(page.getByLabel("Teknisyen")).toHaveCount(0);
});

test("AC-60: filtreler (durum, mod, tarih, müşteri) URL'de kalır; yenilemede korunur; temizle", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "hu");
  await page.goto("/history");
  const f = page.getByTestId("history-filters");
  await f.getByLabel("Durum").selectOption("ENDED");
  await f.getByLabel("Bağlantı").selectOption("AGENT");
  await f.getByLabel("Başlangıç tarihi").fill("2026-11-01");
  await f.getByLabel("Müşteri adı").fill("ayşe");
  await f.getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/from=2026-11-01&status=ENDED&mode=AGENT&customer=ay%C5%9Fe/);
  await expect(rows(page).first()).toContainText("Ayşe Yılmaz");
  for (const r of await rows(page).all()) await expect(r).toContainText("Bitti");
  await page.reload();
  await expect(page.getByTestId("history-filters").getByLabel("Durum")).toHaveValue("ENDED");
  await expect(page.getByTestId("history-filters").getByLabel("Müşteri adı")).toHaveValue("ayşe");
  await page.getByTestId("filter-clear").click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(rows(page)).toHaveCount(25);
});

test("AC-60: istemci doğrulaması — bitiş < başlangıç ve 1 karakterlik müşteri istek atmaz; geçersiz URL filtresi yok sayılır", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "hu");
  await page.goto("/history?status=BOGUS&from=2026-02-30&pageSize=500");
  await expect(page.getByTestId("filters-ignored")).toContainText("Durum, Başlangıç tarihi, Sayfa başına");
  await expect(rows(page)).toHaveCount(25);
  const f = page.getByTestId("history-filters");
  await f.getByLabel("Başlangıç tarihi").fill("2026-11-10");
  await f.getByLabel("Bitiş tarihi").fill("2026-11-01");
  await f.getByLabel("Müşteri adı").fill("a");
  await f.getByTestId("filter-apply").click();
  await expect(f).toContainText("Bitiş tarihi başlangıçtan önce olamaz");
  await expect(f).toContainText("En az 2 karakter girin");
  await expect(f.getByLabel("Bitiş tarihi")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/status=BOGUS/); // gezinme olmadı
});

test("AC-61: ADMIN teknisyen filtresi + sütunu; SUPER_ADMIN firma filtresi + sütunu", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "hadm");
  await page.goto("/history");
  await expect(page.getByTestId("history-table").getByRole("columnheader", { name: "Teknisyen" })).toBeVisible();
  await expect(page.getByTestId("history-table").getByRole("columnheader", { name: "Firma" })).toHaveCount(0);
  await page.getByTestId("history-filters").getByLabel("Teknisyen").selectOption({ label: "Zeynep Ak" });
  await page.getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/technicianId=01JTECH0000000000000000002/);
  for (const r of await rows(page).all()) await expect(r).toContainText("Zeynep Ak");

  await context.clearCookies();
  await signIn(context, "hsa");
  await page.goto("/history");
  await expect(page.getByTestId("history-count")).toContainText("80 oturumdan");
  await expect(page.getByTestId("history-table").getByRole("columnheader", { name: "Firma" })).toBeVisible();
  // Firma seçenekleri bu sayfadaki kayıtlardan gelir (liste ucu P9); URL'den gelen filtre seçili görünür
  await page.goto("/history?tenantId=01JTENA0000000000000000002");
  await expect(page.getByTestId("history-count")).toContainText("20 oturumdan");
  await expect(page.getByTestId("history-filters").getByLabel("Firma")).toHaveValue("01JTENA0000000000000000002");
  for (const r of await rows(page).all()) await expect(r).toContainText("Örnek Lojistik");
});

test("AC-62: detay — özet, onay kayıtları, kontrol dönemleri, zaman çizelgesi, kalite, dosyalar", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "hu");
  await page.goto("/history");
  await page.getByRole("link", { name: "Ayrıntı: Ayşe Yılmaz" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/history/${RICH}$`));
  await expect(page.getByTestId("detail-title")).toHaveText("Ayşe Yılmaz");
  await expect(page.getByRole("navigation", { name: "Konum" }).getByRole("link", { name: "Oturum geçmişi" })).toBeVisible();
  const sum = page.getByTestId("section-summary");
  await expect(sum).toContainText("ayse@ornek.com");
  await expect(sum).toContainText("Yönetici — Yönetici Kişi");
  await expect(sum).toContainText("Yönetici sonlandırdı");
  await expect(page.getByTestId("consent-row")).toHaveCount(3);
  await expect(page.getByTestId("consents")).toContainText("Müşteri (kısayol)");
  await expect(page.getByTestId("consents")).toContainText("Sürüm 3");
  const periods = page.getByTestId("control-period");
  await expect(periods).toHaveCount(2);
  await expect(periods.first().getByTestId("self-elevated")).toHaveText("Müşteri istemcisi yönetici olarak çalışıyordu");
  await expect(periods.first()).toContainText("Müşteri (kısayol)");
  await expect(periods.nth(1).getByTestId("no-close")).toContainText("Kapanış kaydı yok");
  await expect(periods.nth(1)).toContainText("Yönetici durumu bilinmiyor");
  const tl = page.getByTestId("timeline");
  await expect(page.getByTestId("timeline-truncated")).toBeVisible();
  await expect(tl).toContainText("Kontrol istendi (1/5)");
  await expect(tl).toContainText("Müşteri kapattı (kısayol)");
  await expect(tl).toContainText("Oturum bitti (Yönetici sonlandırdı)");
  await expect(tl.locator('[data-action="gelecek.olay"]')).toContainText("gelecek.olay"); // bilinmeyen → ham
  await expect(tl.locator('[data-action="guest.admit"]')).toContainText("(başarısız)");
  await expect(page.getByTestId("quality")).toContainText("TURN");
  await expect(page.getByTestId("file-meta-row")).toContainText("kurulum.msi");
  await expect(page.getByTestId("file-meta-row")).toContainText("1,5 MB");

  await page.goto(`/history/${BROWSER}`);
  await expect(page.getByTestId("control-browser")).toHaveText("Tarayıcı modunda uzaktan kontrol yoktur.");
  await expect(page.getByTestId("quality-empty")).toBeVisible();
  await expect(page.getByTestId("files-empty")).toBeVisible();
});

test("AC-61: kapsam dışı / olmayan oturum → bulunamadı (404)", async ({ page, context }) => {
  await signIn(context, "hu");
  // başka teknisyenin oturumu (sunucu 404). Next akışlı yanıtta HTTP durumu 200 kalır; içerik "bulunamadı"
  await page.goto("/history/01JHXST0000000000000000001");
  await expect(page.getByTestId("history-not-found")).toContainText("Oturum bulunamadı");
});

test("AC-63: ticket + not — sayaç, doğrulama, sunucu alan hatası, kaydet + toast, kalıcılık, ayrılma uyarısı", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "hu");
  await page.goto(`/history/${RICH}`);
  const form = page.getByTestId("note-form");
  await expect(form.getByTestId("note-save")).toBeDisabled();
  await form.getByTestId("note-input").fill("x".repeat(4001));
  await expect(form.getByTestId("note-count")).toHaveText("4.001 / 4.000");
  await form.getByTestId("ticket-input").fill("T".repeat(51));
  await form.getByTestId("note-save").click();
  await expect(form).toContainText("Ticket no en çok 50 karakter olabilir");
  await expect(form).toContainText("Not en çok 4000 karakter olabilir");
  await form.getByTestId("ticket-input").fill("HATA-400");
  await form.getByTestId("note-input").fill("Yazıcı sürücüsü yeniden kuruldu.\nMüşteri memnun.");
  await form.getByTestId("note-save").click();
  await expect(form).toContainText("Sunucu bu ticket no'yu reddetti");
  await expect(form.getByTestId("ticket-input")).toHaveAttribute("aria-invalid", "true");

  // Kaydedilmemiş değişiklik → bağlantıya tıklayınca onay; "Sayfada kal" odakta
  await page.getByRole("navigation", { name: "Konum" }).getByRole("link", { name: "Oturum geçmişi" }).click();
  const leave = page.getByTestId("leave-dialog");
  await expect(leave.getByRole("button", { name: "Sayfada kal" })).toBeFocused();
  await leave.getByRole("button", { name: "Sayfada kal" }).click();
  await expect(page).toHaveURL(new RegExp(`/history/${RICH}$`));

  await form.getByTestId("ticket-input").fill("INC-2042");
  await form.getByTestId("note-save").click();
  await expect(page.getByTestId("toast")).toContainText("Ticket ve not kaydedildi");
  await expect(form.getByTestId("note-save")).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId("ticket-input")).toHaveValue("INC-2042");
  await expect(page.getByTestId("note-input")).toHaveValue("Yazıcı sürücüsü yeniden kuruldu.\nMüşteri memnun.");
  await page.goto("/history");
  await expect(rows(page).filter({ hasText: "INC-2042" })).toHaveCount(1);
});

test("AC-63: yalnız görüntüleme yetkisi — form ve Dışa aktar yok", async ({ page, context }) => {
  await signIn(context, "hro");
  await page.goto("/history");
  await expect(rows(page)).toHaveCount(25);
  await expect(page.getByTestId("export-csv")).toHaveCount(0);
  await page.goto(`/history/${RICH}`);
  await expect(page.getByTestId("note-form")).toHaveCount(0);
  await expect(page.getByTestId("note-readonly")).toContainText("düzenleme yetkiniz yok");
});

test("AC-63/124: Dışa aktar — filtreli CSV iner (BOM, ';', formül kaçışı); 400 ve 429 sayfada", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "hu");
  await page.goto("/history?status=ENDED");
  const [dl, resp] = await Promise.all([
    page.waitForEvent("download"),
    page.waitForResponse((r) => r.url().includes("/sessions/export.csv")),
    page.getByTestId("export-csv").click(),
  ]);
  expect(resp.headers()["x-echo-query"]).toBe("status=ENDED");
  expect(dl.suggestedFilename()).toBe("oturumlar-20261111-1200.csv");
  const csv = await readFile((await dl.path())!, "utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain("Oturum No;Oluşturma;Durum;Müşteri;Ticket No");
  expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  await expect(page.getByTestId("toast")).toContainText("CSV dosyası indirildi");

  for (const [scenario, text] of [["hbig", "En çok 50.000 satır"], ["hrate", "1 dakika sonra"]] as const) {
    await context.clearCookies();
    await signIn(context, scenario);
    await page.goto("/history");
    await page.getByTestId("export-csv").click();
    await expect(page.getByTestId("export-error")).toContainText(text);
  }
});

test("5 durum: boş (yönlendirici), filtrede boş, sayfa dışı, hata + tekrar dene", async ({ page, context }) => {
  await signIn(context, "hempty");
  await page.goto("/history");
  await expect(page.getByTestId("history-empty")).toContainText("Henüz oturum geçmişi yok");
  await expect(page.getByTestId("history-empty").getByRole("link", { name: "Oturumlara git" })).toHaveAttribute("href", "/sessions");
  await expect(page.getByTestId("export-csv")).toHaveCount(0);

  await context.clearCookies();
  await signIn(context, "hu");
  await page.goto("/history?customer=yokboyle");
  await expect(page.getByTestId("history-empty-filter")).toContainText("Bu filtrelerle oturum bulunamadı");
  await page.goto("/history?page=9");
  await expect(page.getByTestId("history-beyond")).toBeVisible();
  await page.getByRole("link", { name: "İlk sayfaya dön" }).click();
  await expect(rows(page)).toHaveCount(25);

  await context.clearCookies();
  await signIn(context, "hbroken");
  await page.goto("/history");
  await expect(page.getByTestId("load-error")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
});

test("yetkisiz kullanıcı: menüde öğe yok, sayfa uyarı gösterir", async ({ page, context }) => {
  await signIn(context, "seed"); // sessions.* var, session_history.* yok
  await page.goto("/history");
  await expect(page.getByTestId("history-forbidden")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Oturum geçmişi" })).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`AC-60/62: axe (${scheme}) liste + detay; 390 px kart görünümü, yatay taşma yok`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(context, "hadm");
    await page.goto("/history");
    await expect(rows(page).first()).toBeVisible();
    expect(await axeScan(page)).toEqual([]);
    await page.goto(`/history/${RICH}`);
    await expect(page.getByTestId("timeline")).toBeVisible();
    expect(await axeScan(page)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalOverflow(page);
    expect(await axeScan(page)).toEqual([]);
    await page.goto("/history");
    await expect(page.getByTestId("history-cards")).toBeVisible();
    await expect(page.getByTestId("history-table")).toBeHidden();
    await noHorizontalOverflow(page);
    expect(await axeScan(page)).toEqual([]);
  });
}

/** Bir kabın yatay taşması (scrollWidth - clientWidth). */
const hOverflow = (p: Page, testId: string) =>
  p.getByTestId(testId).evaluate((el) => el.scrollWidth - el.clientWidth);

test("TEST-P8-2: SUPER_ADMIN liste 1280 px — tablo kabı taşmaz, Firma/Teknisyen tek satır", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const who of ["hsa", "hadm", "hu"]) {
    await context.clearCookies();
    await signIn(context, who);
    await page.goto("/history?pageSize=100");
    await expect(rows(page).first()).toBeVisible();
    const box = page.getByTestId("history-table").locator("xpath=..");
    expect(await box.evaluate((el) => el.scrollWidth - el.clientWidth), `${who} tablo taşması`).toBeLessThanOrEqual(0);
    // Tüm satırlar aynı (tek satırlık) yükseklikte: iki satıra inen hücre yok
    const heights = await rows(page).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(heights).size, `${who} satır yükseklikleri ${[...new Set(heights)].join(",")}`).toBe(1);
    await noHorizontalOverflow(page);
  }
});

test("TEST-P8-1: detay dosya/onay tabloları — ≥ 1280 taşma yok, ad tek satır, SHA kısaltılmış + kopyala; 1024/390 px kart", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "hu");
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/history/${RICH}`);
    await expect(page.getByTestId("files")).toBeVisible();
    expect(await hOverflow(page, "files-scroll"), `${width} dosyalar`).toBeLessThanOrEqual(0);
    expect(await hOverflow(page, "consents-scroll"), `${width} onaylar`).toBeLessThanOrEqual(0);
    const name = page.getByTestId("file-meta-row").getByTestId("file-name");
    const lh = await name.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect((await name.boundingBox())!.height, `${width} dosya adı tek satır`).toBeLessThan(lh * 1.5);
  }
  const sha = page.getByTestId("file-sha").filter({ visible: true });
  await expect(sha.locator("code")).toHaveText("abababab…abababab");
  await expect(sha.locator("code")).toHaveAttribute("title", "ab".repeat(32));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await sha.getByRole("button", { name: "SHA-256 özetini kopyala" }).click();
  await expect(page.getByTestId("toast")).toContainText("Kopyalandı");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ab".repeat(32));

  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByTestId("files")).toBeHidden();
    await expect(page.getByTestId("consents")).toBeHidden();
    await expect(page.getByTestId("consent-row-card")).toHaveCount(3);
    await expect(page.getByTestId("file-meta-row-card")).toContainText("kurulum.msi");
    for (const card of await page.locator('[data-testid="consent-row-card"], [data-testid="file-meta-row-card"]').all())
      expect(await card.evaluate((el) => el.scrollWidth - el.clientWidth), `${width} kart`).toBeLessThanOrEqual(0);
    await noHorizontalOverflow(page);
  }
});

test("AC-63: kaydedilmemiş değişiklik — uygulama içinden gelip tarayıcı geri tuşu onay ister", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "hu");
  await page.goto("/history");
  await page.getByRole("link", { name: "Ayrıntı: Ayşe Yılmaz" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/history/${RICH}$`));
  const form = page.getByTestId("note-form");
  await form.getByTestId("ticket-input").fill("GERI-1");
  await expect(form.getByTestId("note-dirty")).toBeVisible();

  const leave = page.getByTestId("leave-dialog");
  await page.goBack();
  await expect(leave.getByRole("button", { name: "Sayfada kal" })).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/history/${RICH}$`));
  await leave.getByRole("button", { name: "Sayfada kal" }).click();
  await expect(leave).toBeHidden();
  await expect(form.getByTestId("ticket-input")).toHaveValue("GERI-1");

  await page.goBack(); // yeniden yakalanır
  await leave.getByRole("button", { name: "Kaydetmeden ayrıl" }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(rows(page).first()).toBeVisible();

  // Temiz formda (geri alındı) tek geri basışı listeye döner — fazladan geçmiş kaydı kalmaz
  await page.getByRole("link", { name: "Ayrıntı: Ayşe Yılmaz" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/history/${RICH}$`));
  await form.getByTestId("ticket-input").fill("GERI-2");
  await form.getByRole("button", { name: "Değişiklikleri geri al" }).click();
  await expect(form.getByTestId("note-dirty")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/history$/);
  await expect(leave).toBeHidden();
});
