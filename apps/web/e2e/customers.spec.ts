import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import { axeScan, guardConsole, noHorizontalOverflow } from "./helpers";

// P8c-1 müşteri firmalar — panel (AC-165..171, 174..176, 178, 180, 194; r2 §15.2). Sahte API: e2e/mock-customers.mjs
// (u-rqcu-* ADMIN + customers.*, u-rqcuro-* USER yalnız customers.view + talepler).
guardConsole();
const desktopOnly = (name: string) => test.skip(name !== "desktop", "masaüstü akışı");

async function signInCu(context: BrowserContext, scenario = "rqcu"): Promise<string> {
  const value = `u-${scenario}-${Math.random().toString(36).slice(2)}`;
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
  await context.addCookies([
    { ...base, name: SESSION_COOKIE, value, httpOnly: true },
    { ...base, name: CSRF_COOKIE, value: "csrf-test-token" },
  ]);
  return value;
}
const cards = (p: Page) => p.getByTestId("request-card");

test("AC-166/169/176 kritik akış: müşteri oluştur → bağlantıyı kopyala → talep listesinde müşteri filtresi", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signInCu(context);
  await page.goto("/customers");
  const nav = page.getByRole("navigation", { name: "Ana menü" });
  await expect(nav.getByRole("link", { name: "Müşteriler" })).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle(/Müşteriler/);
  await expect(page.getByTestId("general-link")).toContainText("Genel bağlantı");
  await expect(page.getByTestId("customer-row")).toHaveCount(1); // yalnız aktif (vars.)
  await expect(page.getByTestId("customer-row").first()).toContainText("Şişli Bilişim Ltd.");
  await expect(page.getByTestId("customer-row").first().getByTestId("customer-status")).toHaveText("Aktif");

  await page.getByTestId("customer-new").click();
  const form = page.getByTestId("customer-form");
  await expect(form.getByLabel("Firma adı")).toBeFocused();
  await form.getByLabel("Firma adı").fill("Kadıköy Eczanesi");
  await expect(form.getByLabel("Dosya etiketi")).toHaveValue("KadikoyEczanesi");
  await form.getByLabel("Yetkili kişi").fill("Mehmet Öz");
  await form.getByTestId("cf-submit").click();

  await expect(page).toHaveURL(/\/customers\/01JC5ST/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kadıköy Eczanesi");
  await expect(page.getByTestId("customer-file-name")).toContainText("NoktaDestek-KadikoyEczanesi-");
  const url = (await page.getByTestId("customer-download-url").textContent()) ?? "";
  await page.getByTestId("customer-copy").getByRole("button", { name: "Bağlantıyı kopyala: Kadıköy Eczanesi" }).click();
  await expect(page.getByTestId("customer-copy").getByRole("status")).toHaveText("Kopyalandı");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await expect(page.getByTestId("customer-copy").getByRole("status")).toHaveText("", { timeout: 4000 });

  // Talepler: müşteri filtresi (kuyruk)
  await page.goto("/requests");
  await expect(cards(page)).toHaveCount(3);
  const ali = cards(page).filter({ hasText: "Ali Demir" });
  await expect(ali.getByTestId("request-firm")).toHaveText("Şişli Bilişim Ltd.");
  await expect(ali.getByTestId("request-via-binding")).toHaveText("Kayıtlı bilgisayar — Şişli Bilişim Ltd.");
  await expect(cards(page).filter({ hasText: "Ayşe Yılmaz" }).getByTestId("request-firm")).toHaveText("Genel");

  await page.getByTestId("request-customer-mode").selectOption("customer");
  const combo = page.getByRole("combobox", { name: "Müşteri ara" });
  await combo.fill("sisli");
  await expect(page.getByRole("option", { name: "Şişli Bilişim Ltd." })).toBeVisible();
  await combo.press("ArrowDown");
  await combo.press("Enter");
  await expect(page).toHaveURL(/customer=01JC5ST0000000000000000001/);
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText("Ali Demir");

  await page.getByTestId("request-customer-mode").selectOption("general");
  await expect(page).toHaveURL(/customer=general/);
  await expect(cards(page)).toHaveCount(2);
  // Geçmiş sekmesine geçişte filtre korunur
  await page.getByRole("link", { name: "Geçmiş", exact: true }).click();
  await expect(page).toHaveURL(/tab=history.*customer=general/);
});

test("AC-167 form: alan bazlı hata, 409 ad çakışması, not alanında sekme yasak, kaydedilmemiş değişiklik uyarısı", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signInCu(context);
  await page.goto("/customers");
  await page.getByTestId("customer-new").click();
  const form = page.getByTestId("customer-form");
  await form.getByLabel("Firma adı").fill("A");
  await form.getByLabel("E-posta").fill("x@");
  await form.getByLabel("Not").fill("satır\tsekme");
  await form.getByTestId("cf-submit").click();
  await expect(form.getByLabel("Firma adı")).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByLabel("Firma adı")).toBeFocused();
  await expect(form).toContainText("Not sekme");
  await expect(form.getByLabel("E-posta")).toHaveAttribute("aria-invalid", "true");

  await form.getByLabel("Firma adı").fill("SISLI BILISIM LTD.");
  await form.getByLabel("E-posta").fill("");
  await form.getByLabel("Not").fill("");
  await form.getByTestId("cf-submit").click();
  await expect(form).toContainText("Bu adla bir müşteri zaten var");

  // Esc → kaydedilmemiş değişiklik onayı, odak "Düzenlemeye dön"
  await page.keyboard.press("Escape");
  const leave = page.getByTestId("customer-form-leave");
  await expect(leave).toBeVisible();
  await expect(leave.getByRole("button", { name: "Düzenlemeye dön" })).toBeFocused();
  await leave.getByRole("button", { name: "Düzenlemeye dön" }).click();
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Vazgeç" }).click();
  await page.getByTestId("customer-form-leave").getByRole("button", { name: "Kaydetmeden ayrıl" }).click();
  await expect(form).toBeHidden();
});

test("AC-170/171: bağlantıyı yenile ve pasife al onayları (odak Vazgeç), pasifte bağlantı yok, yeniden aktif et", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signInCu(context);
  await page.goto("/customers/01JC5ST0000000000000000001");
  const before = await page.getByTestId("customer-download-url").textContent();
  await page.getByTestId("customer-rotate").click();
  const rot = page.getByTestId("customer-rotate-dialog");
  await expect(rot).toContainText(
    "Bu müşteriye daha önce gönderilen tüm dosyalar ve bu müşteri için hatırlanan bilgisayarlar çalışmayı durduracak",
  );
  await expect(rot.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await rot.getByTestId("customer-action-confirm").click();
  await expect(page.getByTestId("toast").filter({ hasText: "Bağlantı yenilendi" })).toBeVisible();
  await expect(page.getByTestId("customer-download-url")).not.toHaveText(before ?? "");

  await page.getByTestId("customer-deactivate").click();
  const de = page.getByTestId("customer-deactivate-dialog");
  await expect(de.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await de.getByTestId("customer-action-confirm").click();
  await expect(page.getByTestId("customer-link-passive")).toContainText("Pasif — bağlantı geçersiz");
  await expect(page.getByRole("heading", { level: 1 }).locator("..").getByTestId("customer-status")).toHaveText("Pasif");

  await page.getByTestId("customer-reactivate").click();
  const re = page.getByTestId("customer-reactivate-dialog");
  await expect(re).toContainText("Yeni bağlantı üretilir; eski dosyalar ve kayıtlar geçersiz kalır");
  await re.getByTestId("customer-action-confirm").click();
  await expect(page.getByTestId("customer-download-url")).toBeVisible();

  // Liste: Pasif filtresi
  await page.goto("/customers?status=passive");
  await expect(page.getByTestId("customer-row")).toHaveCount(1);
  await expect(page.getByTestId("customer-row").first().getByTestId("customer-link-passive")).toHaveText("Pasif — bağlantı geçersiz");
});

test("AC-169: pano API'si reddederse bağlantı seçili metin olarak gösterilir", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInCu(context);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true });
  });
  await page.goto("/customers");
  await page.getByTestId("general-copy").getByRole("button").click();
  const manual = page.getByTestId("general-copy").getByTestId("copy-link-manual");
  await expect(manual).toBeFocused();
  await expect(manual).toHaveValue(/request-download\?ref=/);
  expect(await manual.evaluate((el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0))).toBeGreaterThan(10);
});

test("AC-166 arama: 2 karakter, Türkçe karakter duyarsız; sonuç yok durumu", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInCu(context);
  await page.goto("/customers?status=all");
  await expect(page.getByTestId("customer-row")).toHaveCount(2);
  await page.getByTestId("customer-search").fill("ş");
  await expect(page.getByText("Aramak için en az 2 karakter yazın.")).toBeVisible();
  await page.getByTestId("customer-search").fill("SISLI");
  await expect(page).toHaveURL(/q=SISLI/);
  await expect(page.getByTestId("customer-row")).toHaveCount(1);
  await page.getByTestId("customer-search").fill("yokboylebirfirma");
  await expect(page.getByTestId("customers-no-match")).toBeVisible();
});

test("AC-174/194: yardım klavyeyle açılır, Esc kapatır ve odak döner; axe açık/koyu tema 0 ihlal", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInCu(context);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/customers");
    expect(await axeScan(page, "main"), `liste ${scheme}`).toEqual([]);
    const trigger = page.getByTestId("customers-help-open");
    const help = page.getByTestId("customers-help");
    // Kök neden (QA Tur 2 #1): React 19 Suspense açılışı kısılır (~300 ms) — `load` olayında sayfa içeriği hâlâ
    // <div hidden id="S:0"> içinde, iskelet görünür. Gizli düğmeye focus() etkisiz, Enter body'ye gider. Önce görünürlük;
    // toPass yalnız hidrasyondan önce basılmış Enter'ı (yük altında) tekrarlar — açık diyalogda yeniden basılmaz.
    await expect(trigger).toBeVisible();
    await expect(async () => {
      if (!(await help.evaluate((d: HTMLDialogElement) => d.open))) {
        await trigger.focus();
        await expect(trigger).toBeFocused();
        await page.keyboard.press("Enter");
      }
      await expect(help.locator("ol li")).toHaveCount(5, { timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await expect(help).toContainText("Yine de çalıştır");
    await expect(help).toContainText("Oturumlar > Yeni Destek Oturumu");
    expect(await axeScan(page, '[data-testid="customers-help"]'), `yardım ${scheme}`).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.getByTestId("customer-new").click();
    expect(await axeScan(page, '[data-testid="customer-form"]'), `form ${scheme}`).toEqual([]);
    await page.keyboard.press("Escape");

    await page.goto("/customers/01JC5ST0000000000000000001");
    await expect(page.getByTestId("customer-requests")).toBeVisible();
    expect(await axeScan(page, "main"), `detay ${scheme}`).toEqual([]);
  }
});

test("AC-178/K23: detay sekmeleri — Talepler listesi tutarlı, Oturumlar yetkisizse kilitli durum", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInCu(context, "rqcuro");
  await page.goto("/customers/01JC5ST0000000000000000001");
  await expect(page.getByTestId("customer-edit")).toHaveCount(0);
  await expect(page.getByTestId("customer-rotate")).toHaveCount(0);
  await expect(page.getByTestId("customer-request-row")).toHaveCount(Number(await page.getByTestId("customer-detail-count").textContent()));
  await page.getByRole("button", { name: "Oturumlar" }).click();
  await expect(page.getByTestId("customer-tab-forbidden")).toContainText("Bu sekmeyi görme yetkiniz yok");
  await page.goto("/customers");
  await expect(page.getByTestId("customer-new")).toHaveCount(0);
});

test("r2 §15.2: talep kartı menüsünden bilgisayar kaydını iptal et (onay, odak Vazgeç)", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInCu(context);
  await page.goto("/requests");
  const ali = cards(page).filter({ hasText: "Ali Demir" });
  await expect(cards(page).filter({ hasText: "Ayşe Yılmaz" }).getByTestId("request-menu")).toHaveCount(0);
  await ali.getByTestId("request-menu").locator("summary").click();
  await ali.getByTestId("request-revoke-binding").click();
  const dlg = page.getByTestId("revoke-binding-dialog");
  await expect(dlg).toContainText("Müşterinin diğer bilgisayarları ve dosyaları etkilenmez");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await dlg.getByTestId("revoke-binding-confirm").click();
  await expect(page.getByTestId("toast").filter({ hasText: "Bilgisayar kaydı iptal edildi" })).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await page.goto("/requests?tab=history");
  const h = cards(page).filter({ hasText: "Ali Demir" });
  await expect(h.getByTestId("request-binding-revoked")).toHaveText("Kaydı iptal edilmiş bilgisayar");
  await expect(h).toContainText("Bilgisayar kaydı iptal edildi");
});

test("AC-180: Yeni Destek Oturumu — isteğe bağlı müşteri seçimi, oluşturulan kartta firma", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInCu(context);
  await page.goto("/customers"); // müşteri deposunu tohumla
  await page.goto("/sessions");
  await page
    .getByRole("button", { name: /Yeni destek oturumu/i })
    .first()
    .click();
  const dlg = page.getByTestId("new-session-dialog");
  const combo = dlg.getByRole("combobox", { name: "Müşteri firma (isteğe bağlı)" });
  await combo.press("ArrowDown");
  await expect(dlg.getByRole("option")).toHaveCount(1); // pasif müşteri listelenmez
  await combo.press("ArrowDown");
  await combo.press("Enter");
  await expect(combo).toHaveValue("Şişli Bilişim Ltd.");
  await dlg.getByTestId("new-session-create").click();
  await expect(dlg.getByTestId("session-link")).toBeVisible();
  await expect(dlg.getByTestId("session-customer-firm")).toContainText("Şişli Bilişim Ltd.");
});

test("AC-194: 390 px — liste ve detayda yatay taşma yok, kart görünümü", async ({ page, context }, info) => {
  test.skip(info.project.name !== "mobile", "mobil");
  await signInCu(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/customers?status=all");
  await expect(page.getByTestId("customer-card")).toHaveCount(2);
  await noHorizontalOverflow(page);
  await page.goto("/customers/01JC5ST0000000000000000001");
  await expect(page.getByTestId("customer-requests")).toBeVisible();
  await noHorizontalOverflow(page);
});

/** QA-P8b-12 kalıbı: olay yalnız açık /ws/panel soketlerine itilir — önce bağlantı beklenir. */
const openSockets = async (page: Page, cookie: string) =>
  ((await (await page.request.get(`http://127.0.0.1:4217/__e2e/rq/sockets/${cookie}`)).json()) as { open: number }).open;

test("AC-176: müşteri ref'iyle gelen yeni talep toast'ında firma adı (tam metin)", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  const cookie = await signInCu(context);
  await page.goto("/customers");
  await expect(page.getByTestId("customer-row")).toHaveCount(1);
  await expect.poll(() => openSockets(page, cookie)).toBeGreaterThanOrEqual(1);
  expect((await page.request.get(`http://127.0.0.1:4217/__e2e/rq/newfirm/${cookie}`)).ok()).toBe(true);
  const toast = page.getByTestId("toast").filter({ hasText: "Firma Müşterisi" });
  await expect(toast.locator("p")).toHaveText("Yeni destek talebi: Firma Müşterisi — Şişli Bilişim Ltd.", { timeout: 3000 });
  await toast.getByRole("link", { name: "Görüntüle" }).click();
  await expect(page).toHaveURL(/\/requests#talep-/);
  await expect(cards(page).filter({ hasText: "Firma Müşterisi" }).getByTestId("request-firm")).toHaveText("Şişli Bilişim Ltd.");
});

test("AC-166: müşterisiz firma — boş durum yönlendirir (Yeni müşteri + yardım)", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInCu(context, "rqcuempty");
  await page.goto("/customers");
  const empty = page.getByTestId("customers-empty");
  await expect(empty).toContainText("Henüz müşteri yok");
  await expect(page.getByTestId("customers-count")).toHaveCount(0);
  await expect(page.getByTestId("general-link")).toContainText("Genel bağlantı"); // boşken de Genel bağlantı kullanılabilir
  const helpBtn = empty.getByTestId("customers-help-open-empty");
  await helpBtn.click();
  const help = page.getByTestId("customers-help"); // AC-223: sayfada tek diyalog örneği (boş durumun dışında)
  await expect(help.locator("ol li")).toHaveCount(5);
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(helpBtn).toBeFocused();
  await empty.getByTestId("customer-new-empty").click();
  await expect(page.getByTestId("customer-form").getByLabel("Firma adı")).toBeFocused();
});

test("AC-166/178: hata durumları — liste 500 ve detay Talepler sekmesi 500 → Tekrar dene ile toparlanır", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signInCu(context, "rqcubroken");
  await page.goto("/customers");
  const err = page.getByTestId("load-error");
  await expect(err).toContainText("Bir şeyler ters gitti");
  await expect(page.getByTestId("customer-row")).toHaveCount(0);
  await expect(page.getByTestId("general-link")).toContainText("Genel bağlantı"); // kısmi: şerit ayrı uçtan gelir
  await err.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByTestId("customer-row")).toHaveCount(1);
  await expect(page.getByTestId("load-error")).toHaveCount(0);

  await page.goto("/customers/01JC5ST0000000000000000001");
  const tabErr = page.getByTestId("customer-tab-error");
  await expect(tabErr).toContainText("Kayıtlar alınamadı.");
  await tabErr.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByTestId("customer-request-row")).toHaveCount(Number(await page.getByTestId("customer-detail-count").textContent()));
});

test("AC-178: detay sekmeleri boş durumu — talebi/oturumu olmayan müşteri", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInCu(context);
  await page.goto("/customers/01JC5ST0000000000000000002"); // Eski Firma A.Ş. (talep yok)
  await expect(page.getByTestId("customer-requests-empty")).toContainText("Bu müşteriden talep yok");
  await page.getByRole("button", { name: "Oturumlar" }).click();
  await expect(page.getByTestId("customer-sessions-empty")).toContainText("Bu müşteriyle oturum yok");
});

test("AC-166/178: yükleniyor — liste ve Talepler sekmesi iskeleti, sonra içerik", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInCu(context, "rqcuslow"); // mock: liste ve sekme uçları 1,5 sn gecikir
  await page.goto("/customers", { waitUntil: "commit" });
  await expect(page.getByTestId("customers-loading")).toBeVisible();
  await expect(page.getByTestId("customers-loading")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("customer-row")).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId("customers-loading")).toHaveCount(0);

  await page.goto("/customers/01JC5ST0000000000000000001");
  await expect(page.getByTestId("customer-tab-loading")).toBeVisible();
  await expect(page.getByTestId("customer-request-row").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("customer-tab-loading")).toHaveCount(0);
});
