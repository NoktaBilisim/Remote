import { expect, test, type Page } from "@playwright/test";
import { axeScan, desktopOnly, guardConsole, noHorizontalOverflow, signIn } from "./helpers";

// P27-K8 gözetimsiz erişim arayüzü — AC-275, 285–287, 293, 296, 297, 336, 337, 339, 342 (UI). Sahte API: e2e/mock-p27.mjs.
guardConsole();
const D1 = "01JDVP2700000000000000000A";
const D3 = "01JDVP2700000000000000000C";
const BETA = "01JCSP2700000000000000000B";
const visible = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true });

async function stepUp(page: Page) {
  const dlg = page.getByTestId("step-up-dialog");
  await expect(dlg).toBeVisible();
  await dlg.getByTestId("step-up-code").fill("123456");
  await dlg.getByTestId("step-up-submit").click();
}

test("AC-275/287/339/342 liste: menü ikonu, TEST bandı, rozetler, Bağlan neden ipucu; iki tema axe 0, taşma yok", async ({
  page,
  context,
}) => {
  await signIn(context, "unm");
  await page.goto("/unattended");
  await expect(page).toHaveTitle(/Gözetimsiz cihazlar/);
  await expect(page.getByTestId("side-nav").getByRole("link", { name: "Gözetimsiz cihazlar" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("un-test-banner")).toHaveText(/TEST ortamı — imzasız servis/);
  const rows = page.locator('[data-testid="un-row"], [data-testid="un-card"]').filter({ visible: true });
  await expect(rows).toHaveCount(4);
  const depo = rows.filter({ hasText: "DEPO-PC" });
  await expect(depo.getByTestId("un-badge-offline")).toHaveText("Çevrimdışı");
  await expect(depo.getByTestId("un-badge-notify")).toHaveText("Son bildirim gönderilemedi");
  await expect(depo.getByRole("button", { name: "Bağlan: DEPO-PC" })).toBeDisabled();
  await expect(depo.getByRole("button", { name: "Bağlan: DEPO-PC" })).toHaveAccessibleDescription("Cihaz çevrimdışı");
  const yeni = rows.filter({ hasText: "YENI-PC" });
  await expect(yeni.getByTestId("un-badge-unverified")).toHaveText("Yeni — doğrulanmadı");
  await expect(yeni.getByTestId("un-badge-replaced")).toHaveText("Anahtar başka yerden kullanılıyor olabilir");
  await expect(rows.filter({ hasText: "KASA-PC" }).getByTestId("un-badge-local")).toHaveText("Yerel olarak kapalı");
  await expect(rows.filter({ hasText: "MUHASEBE-PC" }).getByRole("button", { name: "Bağlan: MUHASEBE-PC" })).toBeEnabled();
  await noHorizontalOverflow(page);
  expect(await axeScan(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await axeScan(page)).toEqual([]);
});

test("AC-336 SMTP kaydı yok: Bağlan ve Kayıt kodu oluştur pasif + neden (status.notifyChannel)", async ({ page, context }) => {
  await signIn(context, "unsmtp");
  await page.goto("/unattended");
  const reason = "Bildirim e-postası yapılandırılmamış — Ayarlar → SMTP";
  const row = page.locator('[data-testid="un-row"], [data-testid="un-card"]').filter({ visible: true }).filter({ hasText: "MUHASEBE-PC" });
  await expect(row.getByRole("button", { name: "Bağlan: MUHASEBE-PC" })).toBeDisabled();
  await expect(row.getByTestId("un-connect-reason")).toHaveText(reason);
  await expect(page.getByTestId("un-create-code")).toBeDisabled();
  await expect(page.getByTestId("un-create-code-reason")).toHaveText(reason);
  await expect(page.getByTestId("un-test-banner")).toHaveCount(0);
  // Cihaz listesinden bağımsız: kodlar sekmesi yalnız status.notifyChannel=false ile baştan pasif.
  await page.goto("/unattended/codes");
  await expect(page.getByTestId("un-create-code")).toBeDisabled();
  await expect(page.getByTestId("un-create-code-reason")).toHaveText(reason);
});

test("AC-297 mod off: kırmızı bant, Bağlan ve Kayıt kodu pasif", async ({ page, context }) => {
  await signIn(context, "unoff");
  await page.goto("/unattended");
  await expect(page.getByTestId("un-off-banner")).toHaveText("Gözetimsiz erişim kod imzası olmadan kullanılamaz");
  await expect(page.getByTestId("un-create-code")).toBeDisabled();
  for (const b of await visible(page, "un-connect").all()) await expect(b).toBeDisabled();
});

test("AC-273 Bağlan: step-up sonra teknisyen konsoluna yönlenir", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "unm");
  await page.goto("/unattended");
  await visible(page, "un-connect").first().click();
  // P28u r3 (AC-430): Bağlan tek diyaloğu açar; kutu/gerekçe yok, "sorulmadan açılır" bilgi satırı
  await expect(page.getByTestId("un-connect-dialog")).toBeVisible();
  await expect(page.getByTestId("un-connect-info")).toHaveText(
    "Bağlantı cihaz kullanıcısına sorulmadan açılır. Cihazda bağlantı göstergesi görünür.",
  );
  await expect(page.getByTestId("un-connect-dialog").getByRole("checkbox")).toHaveCount(0);
  await page.getByTestId("un-connect-submit").click();
  await stepUp(page);
  await expect(page).toHaveURL(/\/sessions\/01JSSP2700000000000000000B\/console$/);
});

test("AC-293/285 teknisyen: sekme yok, yalnız grant'lı cihaz; grant yoksa boş durum; yetkisiz kullanıcıda menü yok", async ({
  browser,
}) => {
  for (const [kind, check] of [
    [
      "untech",
      async (p: Page) => {
        await expect(p.locator('[data-testid="un-row"], [data-testid="un-card"]').filter({ visible: true })).toHaveCount(1);
        await expect(p.getByTestId("un-tabs")).toHaveCount(0);
        await expect(p.getByTestId("un-create-code")).toHaveCount(0);
      },
    ],
    ["untech0", async (p: Page) => expect(p.getByTestId("un-empty-tech")).toContainText("Size yetki verilmiş cihaz yok")],
    [
      "unnone",
      async (p: Page) => {
        await expect(p.getByTestId("un-forbidden")).toBeVisible();
        await expect(p.getByTestId("side-nav").getByRole("link", { name: "Gözetimsiz cihazlar" })).toHaveCount(0);
      },
    ],
  ] as const) {
    const ctx = await browser.newContext();
    await signIn(ctx, kind);
    const p = await ctx.newPage();
    await p.goto("/unattended");
    await check(p);
    await ctx.close();
  }
});

test("AC-273/342 kayıt kodu: boş durum, oluştur (step-up) → kod bir kez + indirme + UAC satırı; adres yoksa yönlendirme", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "unempty");
  await page.goto("/unattended");
  await expect(page.getByTestId("un-empty")).toContainText("Henüz kayıtlı cihaz yok");
  await page.goto("/unattended/codes");
  await expect(page.getByTestId("un-codes-empty")).toBeVisible();
  await page.getByTestId("un-create-code").click();
  const dlg = page.getByTestId("un-code-dialog");
  await dlg.getByTestId("un-code-submit").click();
  await expect(dlg.getByText("Müşteri seçin.")).toBeVisible();
  await dlg.getByRole("combobox", { name: "Müşteri" }).fill("Beta");
  await page.getByRole("option", { name: "Beta A.Ş." }).click();
  await dlg.getByTestId("un-code-submit").click();
  await stepUp(page);
  await expect(dlg.getByTestId("form-error")).toContainText("bildirim adresi yok");
  await expect(dlg.getByRole("link", { name: "Müşteriye bildirim adresi ekle" })).toHaveAttribute(
    "href",
    `/customers/${BETA}#bildirim-adresleri`,
  );
  await dlg.getByRole("combobox", { name: "Müşteri" }).fill("Acme");
  await page.getByRole("option", { name: "Acme Ltd." }).click();
  await dlg.getByTestId("un-code-submit").click();
  await expect(dlg.getByTestId("un-code-value")).toHaveText("ABCD-1234-EFGH-5678");
  await expect(dlg.getByTestId("un-code-download")).toHaveAttribute("href", "/api/v1/unattended/download");
  await expect(dlg.getByTestId("un-code-uac")).toContainText("standart kullanıcı hesabı önerilir");
  expect(await axeScan(page, "[data-testid=un-code-dialog]")).toEqual([]);
  await dlg.getByTestId("un-code-close").click();
});

test("AC-273 bekleyen kodu iptal: onay diyaloğu", async ({ page, context }) => {
  await signIn(context, "unm");
  await page.goto("/unattended/codes");
  await expect(page.getByTestId("un-code-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Kayıt kodunu iptal et: Acme Ltd." }).click();
  const dlg = page.getByTestId("un-cancel-dialog");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await dlg.getByTestId("un-cancel-confirm").click();
  await expect(page.getByText("Kayıt kodu iptal edildi")).toBeVisible();
  await expect(page.getByTestId("un-codes-empty")).toBeVisible();
});

test("AC-337/293/275 ayrıntı: kayıt IP'si/zamanı, yetki ekle (step-up) → rozet kalkar; oturumlar; iptal ad yazarak", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "unm");
  await page.goto(`/unattended/${D3}`);
  await expect(page.getByRole("heading", { level: 1, name: "YENI-PC" })).toBeVisible();
  await expect(page.getByTestId("un-registered")).toContainText("198.51.100.9 adresinden kaydedildi — müşteriyle doğruladınız mı?");
  await expect(page.getByTestId("un-badge-unverified")).toBeVisible();
  await expect(page.getByTestId("un-sessions-empty")).toBeVisible();
  expect(await axeScan(page)).toEqual([]);
  await page.getByRole("switch", { name: "Tuna Teknisyen — YENI-PC cihazına bağlanabilir" }).click();
  await page.getByTestId("un-grants-bar-save").click();
  await stepUp(page);
  await expect(page.getByText("Teknisyen yetkileri kaydedildi")).toBeVisible();
  await expect(page.getByTestId("un-badge-unverified")).toHaveCount(0);
  await page.getByTestId("un-revoke").click();
  const dlg = page.getByTestId("un-revoke-dialog");
  await dlg.getByRole("textbox").fill("YENI-PC");
  await dlg.getByRole("button", { name: "Cihazı iptal et" }).click();
  await expect(page).toHaveURL(/\/unattended$/);
  await page.goto(`/unattended/${D1}`);
  await expect(page.getByTestId("un-session-row")).toHaveCount(1);
});

test("AC-296/337 müşteri bildirim adresleri: boş uyarısı, ekle, kaydet step-up ile", async ({ page, context }) => {
  await signIn(context, "unm");
  await page.goto(`/customers/${BETA}`);
  const sec = page.getByTestId("un-contacts");
  await expect(sec.getByTestId("un-contacts-empty")).toHaveText("Adres yokken bu müşterinin cihazlarına bağlanılamaz.");
  await expect(sec.getByTestId("un-contacts-notice")).toContainText("Eski ve yeni adreslerin hepsine değişiklik e-postası gider");
  await sec.getByTestId("un-contacts-add").click();
  await sec.getByLabel("E-posta 1").fill("bozuk");
  await page.getByTestId("un-contacts-bar-save").click();
  await expect(sec.getByText("E-posta adresi geçersiz")).toBeVisible();
  await sec.getByLabel("E-posta 1").fill("bt@beta.example");
  await page.getByTestId("un-contacts-bar-save").click();
  await stepUp(page);
  await expect(page.getByText("Bildirim adresleri kaydedildi")).toBeVisible();
  await expect(sec.getByTestId("un-contacts-empty")).toHaveCount(0);
  await noHorizontalOverflow(page);
  expect(await axeScan(page, "[data-testid=un-contacts]")).toEqual([]);
});

test("kısmi durum: yoklama hatasında son veri + 'güncellenemedi' bandı", async ({ page, context }) => {
  await page.clock.install();
  await signIn(context, "unpoll");
  await page.goto("/unattended");
  await expect(page.locator('[data-testid="un-row"], [data-testid="un-card"]').filter({ visible: true })).toHaveCount(4);
  // CI mobil kararsızlığı: satırlar SSR'dan hidrasyondan önce görünür; ilk fastForward yoklama zamanlayıcısı kurulmadan
  // gelirse boşa gider. Saat her denemede bir yoklama aralığı ilerletilir, bant görünene dek (deterministik üst sınır).
  await expect(async () => {
    await page.clock.fastForward(16_000);
    await expect(page.getByTestId("un-stale")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.locator('[data-testid="un-row"], [data-testid="un-card"]').filter({ visible: true })).toHaveCount(4);
});

test("K12: olmayan / bozuk / yetkisiz cihaz id'si gerçek HTTP 404 + tek h1 'Cihaz bulunamadı'", async ({ browser }) => {
  for (const [kind, path] of [
    ["unm", "/unattended/01JDVP27000000000000000ZZZ"],
    ["unm", "/unattended/abc"],
    ["untech", `/unattended/${D3}`],
  ] as const) {
    const ctx = await browser.newContext();
    await signIn(ctx, kind);
    const p = await ctx.newPage();
    const res = await p.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(p.getByRole("heading", { level: 1, name: "Cihaz bulunamadı" })).toBeVisible();
    await expect(p.getByTestId("un-not-found").getByRole("link", { name: "Gözetimsiz cihazlara dön" })).toHaveAttribute(
      "href",
      "/unattended",
    );
    await ctx.close();
  }
});

test("K12: arama kutusu sözleşme sınırında (64) — fazlası girilemez, filtre düşmez", async ({ page, context }) => {
  await signIn(context, "unm");
  await page.goto("/unattended");
  const box = page.getByTestId("un-search");
  await expect(box).toHaveAttribute("maxlength", "64");
  await box.fill("x".repeat(70));
  await expect(box).toHaveValue("x".repeat(64));
  await box.press("Enter");
  await expect(page).toHaveURL(new RegExp(`q=${"x".repeat(64)}$`));
  await expect(page.getByTestId("un-no-match")).toBeVisible();
});
