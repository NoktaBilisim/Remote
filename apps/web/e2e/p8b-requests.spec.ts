import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { axeScan, guardConsole, noHorizontalOverflow } from "./helpers";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";

// P8b-1 müşteri destek talepleri — panel (AC-146..149, 152, 153, 157, 158, 164). Sahte API: e2e/mock-requests.mjs (u-rq<senaryo>-*).
guardConsole();
const A = "01JRQ00000000000000000000A";
const B = "01JRQ00000000000000000000B";
const desktopOnly = (name: string) => test.skip(name !== "desktop", "masaüstü akışı");
const cards = (p: Page) => p.getByTestId("request-card");
const card = (p: Page, name: string) => cards(p).filter({ has: p.getByRole("heading", { name }) });

async function signInRq(context: BrowserContext, scenario: string): Promise<string> {
  const value = `u-${scenario}-${Math.random().toString(36).slice(2)}`;
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
  await context.addCookies([
    { ...base, name: SESSION_COOKIE, value, httpOnly: true },
    { ...base, name: CSRF_COOKIE, value: "csrf-test-token" },
  ]);
  return value;
}
/** QA-P8b-12: mock olayı yalnız açık soketlere iter — olaydan önce /ws/panel bağlantısı beklenir (rozet REST'ten gelir, senkron noktası değil). */
const openSockets = async (page: Page, cookie: string) =>
  ((await (await page.request.get(`http://127.0.0.1:4217/__e2e/rq/sockets/${cookie}`)).json()) as { open: number }).open;
const hook = (page: Page, ev: string, cookie: string, id?: string) =>
  page.request.get(`http://127.0.0.1:4217/__e2e/rq/${ev}/${cookie}${id ? `?id=${id}` : ""}`);

test("AC-146: kuyruk eskiden yeniye; kart: kod, ipucu, bilinen kaynak, düz metin açıklama; menü rozeti ve sekme başlığı", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInRq(context, "rqadm");
  await page.goto("/requests");
  const nav = page.getByRole("navigation", { name: "Ana menü" });
  await expect(nav.getByRole("link", { name: /Talepler/ })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: /Ayarlar/ })).toBeVisible();
  await expect(page.getByTestId("requests-badge")).toContainText("3");
  await expect(page).toHaveTitle(/^\(3\) Talepler · Nokta Uzaktan Destek/);
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).first().getByRole("heading")).toHaveText("Ayşe Yılmaz");

  const a = card(page, "Ayşe Yılmaz");
  await expect(a.getByTestId("request-code")).toHaveText("123 456");
  await expect(a.getByTestId("request-hint")).toContainText("firmanın kayıtlı numarasından");
  await expect(a.getByTestId("request-first-seen")).toContainText("İlk kez görülen kaynak");
  // Açıklama düz metin: bağlantı/HTML yorumlanmaz
  await expect(a.getByTestId("request-description")).toHaveText("Yazıcı çalışmıyor, bkz. https://kotu.example/x <b>kalın</b>");
  await expect(a.getByTestId("request-description").locator("a, b")).toHaveCount(0);
  await expect(a).toContainText("+905321112233");
  await expect(a).toContainText("ayse@ornek.com");
  await expect(a.getByTestId("request-wait")).toContainText("bekliyor");

  const b = card(page, "Ali Demir");
  await expect(b.getByTestId("request-source")).toHaveAttribute("data-known", "true");
  // TEST-P8b-4: "Bilinen kaynak" rozeti tek satır
  const pill = b.getByTestId("request-source").getByText("Bilinen kaynak", { exact: true });
  const h = await pill.evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeLessThan(28);
  await expect(b.getByTestId("request-source")).toContainText("Güvenilen ağ");
  await expect(b.getByTestId("request-source")).toContainText("Bu bilgisayar daha önce destek aldı");
  // PREFIX: nötr not + uyarı kalır
  const c = card(page, "Can Öz");
  await expect(c.getByTestId("request-same-block")).toBeVisible();
  await expect(c.getByTestId("request-first-seen")).toBeVisible();
});

test("AC-149: /ws/panel — yeni talep toast + Görüntüle, rozet, liste; kaldırılan düşer; yoğunluk bandı; vazgeçti toast; yeniden bağlanma", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  const cookie = await signInRq(context, "rqadm");
  await page.goto("/sessions");
  await expect(page.getByTestId("requests-badge")).toContainText("3");
  await expect.poll(() => openSockets(page, cookie)).toBeGreaterThanOrEqual(1);
  await hook(page, "new", cookie);
  const toast = page.getByTestId("toast").filter({ hasText: "Yeni destek talebi: Yeni Müşteri" });
  await expect(toast).toBeVisible({ timeout: 3000 });
  // AC-176: Genel talepte firma yerine "Genel" (tam metin)
  await expect(toast.locator("p")).toHaveText("Yeni destek talebi: Yeni Müşteri — Genel");
  await expect(page.getByTestId("requests-badge")).toContainText("4");
  await toast.getByRole("link", { name: "Görüntüle" }).click();
  await expect(page).toHaveURL(/\/requests#talep-/);
  await expect(card(page, "Yeni Müşteri")).toBeVisible();

  await expect.poll(() => openSockets(page, cookie)).toBeGreaterThanOrEqual(1); // sayfa geçişinden sonra da bağlı
  await hook(page, "removed", cookie, A);
  await expect(card(page, "Ayşe Yılmaz")).toHaveCount(0, { timeout: 3000 });
  await expect(page.getByTestId("requests-badge")).toContainText("3");

  await hook(page, "alert", cookie);
  await expect(page.getByTestId("queue-alert")).toContainText("Olağan dışı talep yoğunluğu");
  await hook(page, "declined", cookie);
  await expect(page.getByTestId("toast").filter({ hasText: "Müşteri bağlantıyı kabul etmedi" })).toBeVisible();

  // 4401 → yeniden bağlanır, olaylar yine gelir
  await hook(page, "close4401", cookie);
  await expect.poll(() => openSockets(page, cookie), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await hook(page, "removed", cookie, B);
  await expect(card(page, "Ali Demir")).toHaveCount(0, { timeout: 5000 });
});

test("AC-149: ses tercihi kapatılabilir ve saklanır", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInRq(context, "rqadm");
  await page.goto("/requests");
  const sw = page.getByTestId("sound-toggle");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await expect(page.getByTestId("sound-toggle")).toHaveAttribute("aria-checked", "false");
});

test("AC-153: kabul konsola geçirir; başkası aldıysa 409 mesajı ve kart düşer", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInRq(context, "rqadm");
  await page.goto("/requests");
  await card(page, "Ali Demir").getByRole("button", { name: "Kabul et: Ali Demir" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: "Talep başka bir teknisyen tarafından alındı" })).toBeVisible();
  await expect(card(page, "Ali Demir")).toHaveCount(0);
  await card(page, "Ayşe Yılmaz").getByRole("button", { name: "Kabul et: Ayşe Yılmaz" }).click();
  await expect(page).toHaveURL(/\/sessions\/01JRQSES000000000000000001\/console$/);
});

test("TEST-P8b-2: kabul → konsol → geri: kabul edilen talep kuyrukta yeniden görünmez", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInRq(context, "rqadm");
  await page.goto("/requests");
  await expect(cards(page)).toHaveCount(3);
  await card(page, "Can Öz").getByRole("button", { name: "Kabul et: Can Öz" }).click();
  await expect(page).toHaveURL(/\/console$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/requests$/);
  await expect(card(page, "Ayşe Yılmaz")).toBeVisible();
  await expect(card(page, "Can Öz")).toHaveCount(0);
});

test("AC-157: ret — hazır mesaj varsayılan; 'Diğer'de bağlantı/telefon reddedilir; geçerli mesajla kart düşer", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInRq(context, "rqadm");
  await page.goto("/requests");
  await card(page, "Can Öz").getByRole("button", { name: "Reddet: Can Öz" }).click();
  const dlg = page.getByTestId("reject-dialog");
  await expect(dlg.getByRole("radio", { name: "Şu an müsait değiliz, sizi arayacağız" })).toBeChecked();
  await expect(dlg.getByRole("radio", { name: "Şu an müsait değiliz, sizi arayacağız" })).toBeFocused();
  expect(await axeScan(page, '[data-testid="reject-dialog"]')).toEqual([]);
  await dlg.getByRole("radio", { name: "Diğer (kendi mesajım)" }).check();
  await dlg.getByLabel("Mesaj", { exact: true }).fill("Bizi 0532 123 45 67 numarasından arayın");
  await dlg.getByRole("button", { name: "Reddet" }).click();
  await expect(dlg.getByText("Mesaj bağlantı, e-posta veya telefon içeremez")).toBeVisible();
  await expect(dlg.getByLabel("Mesaj", { exact: true })).toBeFocused();
  await dlg.getByLabel("Mesaj", { exact: true }).fill("Yarın sabah dönüş yapacağız");
  await dlg.getByRole("button", { name: "Reddet" }).click();
  await expect(dlg).toBeHidden();
  await expect(card(page, "Can Öz")).toHaveCount(0);
  await expect(page.getByTestId("toast").filter({ hasText: "Talep reddedildi." })).toBeVisible();
  // Geçmiş sekmesinde ret mesajı
  await page.getByRole("link", { name: "Geçmiş", exact: true }).click();
  await expect(page.getByTestId("request-reject-message").first()).toHaveText("Yarın sabah dönüş yapacağız");
});

test("AC-146: geçmiş sekmesi + durum filtresi; boş ve hata durumları; yetki (USER yalnız görüntüler, Super Admin firma seçmeli)", async ({ page, context, browser }, info) => {
  desktopOnly(info.project.name);
  await signInRq(context, "rqadm");
  await page.goto("/requests?tab=history");
  await expect(cards(page)).toHaveCount(3);
  await page.getByTestId("history-status-filter").getByRole("link", { name: "Reddedildi" }).click();
  await expect(page).toHaveURL(/status=REJECTED/);
  await expect(cards(page)).toHaveCount(1);
  await page.getByTestId("history-status-filter").getByRole("link", { name: "Bağlanamadı" }).click();
  await expect(page.getByTestId("requests-history-empty")).toContainText("Bu durumda talep yok");
  // Anonim kayıt
  await page.goto("/requests?tab=history&status=CANCELLED");
  await expect(cards(page).first()).toContainText("Adı silinmiş müşteri");
  await expect(cards(page).first()).toContainText("Müşteri iptal etti");

  for (const [scenario, check] of [
    ["rqempty", async (p: Page) => await expect(p.getByTestId("requests-empty")).toContainText("Bekleyen talep yok")],
    ["rqbroken", async (p: Page) => await expect(p.getByTestId("load-error")).toBeVisible()],
    ["rqsa", async (p: Page) => await expect(p.getByTestId("requests-pick-tenant")).toContainText("Önce firma seçin")],
    [
      "rqro",
      async (p: Page) => {
        await expect(cards(p)).toHaveCount(3);
        await expect(p.getByRole("button", { name: /Kabul et|Reddet/ })).toHaveCount(0);
        await expect(p.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: /Ayarlar/ })).toHaveCount(0);
      },
    ],
  ] as const) {
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL });
    await signInRq(ctx, scenario);
    const p = await ctx.newPage();
    await p.goto("/requests");
    await check(p);
    await ctx.close();
  }
});

test("AC-129/131/152: ayarlar — bağlantı kopyala, onaylı yenile, alan hataları, kaydet, WhatsApp testi", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signInRq(context, "rqadm");
  await page.goto("/settings/support-requests");
  await expect(page).toHaveTitle(/Destek talepleri ayarları/);
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  await expect(page.getByTestId("download-url")).toContainText("ref=abcdefghijklmnop");
  await page.getByRole("button", { name: "Kopyala" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: "Bağlantı kopyalandı." })).toBeVisible();

  await page.getByRole("button", { name: "Bağlantıyı yenile" }).click();
  const dlg = page.getByTestId("rotate-dialog");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await dlg.getByRole("button", { name: "Yenile" }).click();
  await expect(page.getByTestId("download-url")).toContainText("ref=zyxwvutsrqponmlk");

  // E-posta pasif (P10)
  await expect(page.getByTestId("mail-switch")).toBeDisabled();

  await page.getByLabel("Talep bekleme süresi (dakika)").fill("5");
  await page.getByTestId("wa-switch").click();
  await page.getByRole("button", { name: "Ağ ekle" }).click();
  await page.getByLabel("Güvenilen ağlar 2").fill("10.0.0.0/24");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByTestId("form-error")).toBeVisible();
  await expect(page.getByText("10 ile 120 arasında bir tam sayı girin.")).toBeVisible();
  await expect(page.getByText("Kanal açıkken en az bir alıcı girin.")).toBeVisible();
  await expect(page.getByText("Özel, yerel veya ayrılmış adres aralığı eklenemez")).toBeVisible();

  await page.getByLabel("Talep bekleme süresi (dakika)").fill("45");
  await page.getByRole("button", { name: "Alıcı ekle" }).click();
  await page.getByLabel("WhatsApp alıcıları 1").fill("0532 111 22 33");
  await page.getByRole("button", { name: "Ağı kaldır: 10.0.0.0/24" }).click();
  await expect(page.getByText("Kaydedilmemiş değişiklikler var.")).toBeVisible();
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: "Ayarlar kaydedildi." })).toBeVisible();
  await expect(page.getByLabel("WhatsApp alıcıları 1")).toHaveValue("+905321112233");
  await expect(page.getByTestId("save-bar")).toHaveCount(0); // TEST-P8b-3: değişiklik yokken çubuk yok

  await page.getByLabel("Test numarası").fill("12");
  await page.getByRole("button", { name: "Test mesajı gönder" }).click();
  await expect(page.getByText("Telefon numarası geçersiz.")).toBeVisible();
  await page.getByLabel("Test numarası").fill("0532 111 22 33");
  await page.getByRole("button", { name: "Test mesajı gönder" }).click();
  await expect(page.getByTestId("wa-test-result")).toContainText("Test mesajı gönderildi.");
  await page.getByLabel("Test numarası").fill("0500 999 99 99");
  await page.getByRole("button", { name: "Test mesajı gönder" }).click();
  await expect(page.getByTestId("wa-test-result")).toContainText("WhatsApp servisine ulaşılamadı.");
});

test("TEST-P8b-1: ayarlar — kaydedilmemiş değişiklikte menü bağlantısı ve geri tuşu onay ister", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInRq(context, "rqadm");
  await page.goto("/requests");
  await page.goto("/settings/support-requests");
  const wait = page.getByLabel("Talep bekleme süresi (dakika)");
  await wait.fill("45");
  await expect(page.getByTestId("save-bar")).toBeVisible();

  const leave = page.getByTestId("leave-dialog");
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: /Talepler/ }).click();
  await expect(leave.getByRole("button", { name: "Sayfada kal" })).toBeFocused();
  await leave.getByRole("button", { name: "Sayfada kal" }).click();
  await expect(page).toHaveURL(/\/settings\/support-requests$/);
  await expect(wait).toHaveValue("45");

  await page.goBack();
  await expect(leave.getByRole("button", { name: "Sayfada kal" })).toBeFocused();
  await expect(page).toHaveURL(/\/settings\/support-requests$/);
  await leave.getByRole("button", { name: "Sayfada kal" }).click();
  await expect(wait).toHaveValue("45");

  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: /Talepler/ }).click();
  await leave.getByRole("button", { name: "Kaydetmeden ayrıl" }).click();
  await expect(page).toHaveURL(/\/requests$/);
});

test("AC-158: oturum geçmişinde kaynak filtresi, bekleme süresi ve 'Destek talebi' bölümü", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  const value = `u-hu-${Math.random().toString(36).slice(2)}`;
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
  await context.addCookies([
    { ...base, name: SESSION_COOKIE, value, httpOnly: true },
    { ...base, name: CSRF_COOKIE, value: "csrf-test-token" },
  ]);
  await page.goto("/history");
  await page.getByTestId("history-filters").getByLabel("Kaynak").selectOption("REQUEST");
  await page.getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/source=REQUEST/);
  const rowsReq = page.getByTestId("history-row");
  await expect(rowsReq.first().getByTestId("history-source")).toContainText("Talep");
  await expect(rowsReq.first().getByTestId("history-source")).toHaveAttribute("title", /bekleme/);
  await page.goto("/history/01JHXST0000000000000000020");
  const sec = page.getByTestId("section-request");
  await expect(sec.getByRole("heading", { name: "Destek talebi" })).toBeVisible();
  await expect(sec).toContainText("+905321112233");
  await expect(sec.getByTestId("history-request-description").locator("a")).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`AC-164: Talepler ve Ayarlar — axe 0 ihlal (${scheme}), 1280/1440/390 taşma yok`, async ({ page, context }, info) => {
    desktopOnly(info.project.name);
    await signInRq(context, "rqadm");
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [1280, 1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const url of ["/requests", "/requests?tab=history", "/settings/support-requests"]) {
        await page.goto(url);
        await expect(page.locator("h1").filter({ visible: true })).toHaveCount(1);
        await noHorizontalOverflow(page);
        if (width !== 1440) expect(await axeScan(page), `${url} @${width}`).toEqual([]);
      }
    }
  });
}

test("mobil: kart düzeni ve dokunma hedefleri (390)", async ({ page, context }, info) => {
  test.skip(info.project.name !== "mobile", "mobil");
  await signInRq(context, "rqadm");
  await page.goto("/requests");
  await expect(cards(page)).toHaveCount(3);
  await noHorizontalOverflow(page);
  const btn = card(page, "Ayşe Yılmaz").getByRole("button", { name: "Kabul et: Ayşe Yılmaz" });
  const box = await btn.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("TEST-P8b-3: mobil ayarlar — kaydet çubuğu yalnız değişiklikte ve tek satır (390)", async ({ page, context }, info) => {
  test.skip(info.project.name !== "mobile", "mobil");
  await signInRq(context, "rqadm");
  await page.goto("/settings/support-requests");
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  await page.getByLabel("Talep bekleme süresi (dakika)").fill("45");
  const bar = page.getByTestId("save-bar");
  await expect(bar).toBeVisible();
  expect((await bar.boundingBox())?.height ?? 999).toBeLessThanOrEqual(72);
  await expect(bar.getByRole("button", { name: "Değişiklikleri geri al" })).toBeVisible();
  await noHorizontalOverflow(page);
  await bar.getByRole("button", { name: "Değişiklikleri geri al" }).click();
  await expect(bar).toHaveCount(0);
});
