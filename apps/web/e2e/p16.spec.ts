import { expect, test, type Browser, type Page } from "@playwright/test";
import { axeScan, guardConsole, noHorizontalOverflow, signIn } from "./helpers";

// Kimlikler e2e/mock-p16.mjs `P16` ile aynı (.mjs tür bildirimi yok → burada tekrar)
const P16 = {
  PELIN: "01JMSP1600000000000000000B",
  AHMET: "01JMSP1600000000000000000C",
  OYA: "01JMSP1600000000000000000D",
  T_OLD: "01JTNP1600000000000000000B",
  T_NEW: "01JTNP1600000000000000000C",
  T_ACT: "01JTNP1600000000000000000D",
  T_RUN: "01JTNP1600000000000000000E",
  T_FAIL: "01JTNP1600000000000000000F",
};

// P16 arayüz (AC-241 kullanıcı kalıcı silme, AC-242 firma silme işi, S16-1 maskeli audit). Sahte API: e2e/mock-p16.mjs.
guardConsole();
const desktopOnly = (name: string) => test.skip(name !== "desktop", "masaüstü akışı");

async function stepUp(page: Page) {
  await expect(page.getByTestId("step-up-dialog")).toBeVisible();
  await page.getByTestId("step-up-code").fill("123456");
  await page.getByTestId("step-up-submit").click();
}

async function scanBoth(browser: Browser, scenario: string, path: string, width: number, ready: (p: Page) => Promise<void>) {
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

// ---------------------------------------------------------------------------------------------------------------
test("AC-241: pasif kullanıcı kalıcı silinir — ad onayı, eşleşmeyen ad isteksiz hata, step-up, 204 → liste + toast", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p16adm");
  await page.goto(`/users/${P16.PELIN}`);
  await page.getByTestId("user-delete").click();
  const dlg = page.getByTestId("user-delete-dialog");
  await expect(dlg).toHaveAttribute("role", "alertdialog");
  await expect(page.getByTestId("user-delete-dialog-cancel")).toBeFocused();
  await expect(dlg).toContainText("geri alınamaz");
  // Eşleşmeyen ad → istek gitmez, alan hatası
  const input = page.getByTestId("user-delete-dialog-input");
  await input.fill("pelin pasif");
  await page.getByTestId("user-delete-dialog-confirm").click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(dlg).toContainText("Yazdığınız ad eşleşmiyor");
  await input.fill("  Pelin Pasif ");
  await input.press("Enter");
  await stepUp(page);
  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByTestId("toast").last()).toContainText("Kullanıcı kalıcı silindi");
  await expect(page.getByText("Pelin Pasif")).toHaveCount(0);
});

test("AC-241: aktif kullanıcıda Kalıcı sil pasif + neden; açık oturumlu pasif kullanıcıda 409 diyalogda", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p16adm");
  await page.goto(`/users/${P16.AHMET}`);
  await expect(page.getByTestId("user-delete")).toBeDisabled();
  await expect(page.getByTestId("user-delete")).toHaveAccessibleDescription("Kalıcı silmek için önce kullanıcıyı pasife alın.");
  // Kendi hesabında düğme yok
  await page.goto(`/users/01JMSP1600000000000000000A`);
  await expect(page.getByTestId("user-delete")).toHaveCount(0);

  await page.goto(`/users/${P16.OYA}`);
  await page.getByTestId("user-delete").click();
  await page.getByTestId("user-delete-dialog-input").fill("Oya Oturumlu");
  await page.getByTestId("user-delete-dialog-confirm").click();
  await stepUp(page);
  const e = page.getByTestId("user-delete-dialog-error");
  await expect(e.getByRole("alert")).toContainText("açık destek oturumu var");
  await expect(page.getByTestId("user-delete-dialog")).toBeVisible();
});

test("AC-237: users.delete anahtarı olmayan Admin'e Kalıcı sil düğmesi görünmez (pasif kullanıcıda da)", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p16admnd");
  for (const id of [P16.PELIN, P16.AHMET]) {
    await page.goto(`/users/${id}`);
    // Düzenleme yetkisi var → form yüklenir; yalnız silme düğmesi yok
    await expect(page.getByTestId("user-deactivate").or(page.getByTestId("user-reactivate"))).toBeVisible();
    await expect(page.getByTestId("user-delete")).toHaveCount(0);
  }
});

// ---------------------------------------------------------------------------------------------------------------
test("AC-242: firma önizleme (sayılar, 730 gün, 24 saat) → ad → step-up → SCHEDULED geri sayım + bant → iptal", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p16sa0");
  await page.goto("/admin/tenants");
  await expect(page.getByTestId("purge-banner")).toHaveCount(0);
  await page.getByTestId("tenant-row").filter({ hasText: "Eski Ticaret" }).getByTestId("tenant-link").click();
  await expect(page).toHaveURL(new RegExp(`/admin/tenants/${P16.T_OLD}$`));
  await expect(page).toHaveTitle(/Eski Ticaret A\.Ş\./);
  await expect(page.getByTestId("purge-panel")).toHaveAttribute("data-state", "none");
  await page.getByTestId("purge-open").click();
  const dlg = page.getByTestId("purge-dialog");
  await expect(page.getByTestId("purge-dialog-cancel")).toBeFocused();
  await expect(page.getByTestId("purge-count-row")).toHaveCount(5);
  await expect(page.getByTestId("purge-count-row").filter({ hasText: "Destek oturumları" })).toContainText("340");
  await expect(page.getByTestId("purge-files-row")).toContainText("27 dosya");
  await expect(page.getByTestId("purge-audit-note")).toContainText("730 gün");
  await expect(page.getByTestId("purge-delay-note")).toContainText("24 saat");
  await page.getByTestId("purge-dialog-input").fill("Eski Ticaret A.Ş.");
  await page.getByTestId("purge-dialog-confirm").click();
  await stepUp(page);
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("toast").last()).toContainText("silme zamanlandı");
  await expect(page.getByTestId("purge-panel")).toHaveAttribute("data-state", "SCHEDULED");
  await expect(page.getByTestId("purge-countdown")).toHaveText(/^2[34]:\d{2}:\d{2}$/);
  const first = await page.getByTestId("purge-countdown").textContent();
  await expect(page.getByTestId("purge-countdown")).not.toHaveText(first ?? "");
  // Super Admin bandı (sayfa yenilemesiyle sunucudan) + iptal bağlantısı
  const band = page.getByTestId("purge-banner");
  await expect(band).toHaveAttribute("role", "alert");
  await expect(band).toContainText("Eski Ticaret A.Ş.");
  await expect(band.getByTestId("purge-banner-link")).toHaveAccessibleName("İptal et: Eski Ticaret A.Ş.");
  // Liste rozeti
  await page.goto("/admin/tenants");
  await expect(page.getByTestId("tenant-row").filter({ hasText: "Eski Ticaret" }).getByTestId("tenant-purge-badge")).toContainText(
    "Silinecek:",
  );
  // Zamanlanmış işte yeniden etkinleştirme 409 → diyalogda neden
  await page.getByRole("button", { name: "Yeniden etkinleştir: Eski Ticaret A.Ş." }).click();
  await page.getByTestId("tenant-action-confirm").click();
  await expect(page.getByTestId("tenant-reactivate-dialog").getByTestId("form-error")).toContainText("Önce silme işini iptal edin");
  await page.keyboard.press("Escape");
  // Banttan iptal
  await page.getByTestId("purge-banner").getByTestId("purge-banner-link").click();
  await expect(page).toHaveURL(new RegExp(`/admin/tenants/${P16.T_OLD}#purge$`));
  await page.getByTestId("purge-cancel").click();
  await expect(page.getByTestId("toast").last()).toContainText("silme iptal edildi");
  await expect(page.getByTestId("purge-panel")).toHaveAttribute("data-state", "CANCELLED");
  await expect(page.getByTestId("purge-banner")).toHaveCount(0);
});

test("AC-242: uygun olmayan firma — aktif: 'önce pasife alın'; 30 gün dolmadı: 'Silinebilir: <tarih>'", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p16sa");
  await page.goto(`/admin/tenants/${P16.T_ACT}`);
  await expect(page.getByTestId("purge-open")).toBeDisabled();
  await expect(page.getByTestId("purge-why")).toContainText("önce firmayı");
  await page.goto(`/admin/tenants/${P16.T_NEW}`);
  await expect(page.getByTestId("purge-open")).toBeDisabled();
  await expect(page.getByTestId("purge-why")).toContainText("Silinebilir:");
});

test("AC-242: RUNNING adım çubuğu → yoklamayla DONE (firma satırı silinir → 'Silinmiş firma')", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p16sa");
  await page.goto(`/admin/tenants/${P16.T_RUN}`);
  await expect(page.getByTestId("purge-panel")).toHaveAttribute("data-state", "RUNNING");
  await expect(page.getByTestId("purge-step")).toContainText(/Adım \d+\/17/);
  await expect(page.getByTestId("purge-banner").getByTestId("purge-banner-item").filter({ hasText: "Koşan Firma" })).toHaveAttribute(
    "data-state",
    "RUNNING",
  );
  await expect(page.getByTestId("purge-panel")).toHaveAttribute("data-state", "DONE", { timeout: 10_000 });
  await expect(page.getByTestId("purge-state")).toHaveText("Firma kalıcı silindi");
  await expect(page.getByTestId("tenant-name")).toHaveText(/^Silinmiş firma #/);
});

test("AC-242: FAILED → Sürdür yeni önizlemeyle → RUNNING; silme durumu alınamazsa kısmi durum", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p16sa");
  await page.goto(`/admin/tenants/${P16.T_FAIL}`);
  await expect(page.getByTestId("purge-failed-body")).toContainText("veritabanı bağımlılık hatası");
  await page.getByTestId("purge-resume").click();
  await expect(page.getByTestId("purge-delay-note")).toContainText("kaldığı adımdan");
  await page.getByTestId("purge-dialog-input").fill("Hatalı Firma");
  await page.getByTestId("purge-dialog-confirm").click();
  await stepUp(page);
  await expect(page.getByTestId("purge-panel")).toHaveAttribute("data-state", "RUNNING");

  const ctx = await browser.newContext();
  await signIn(ctx, "p16sabrk");
  const p = await ctx.newPage();
  await p.goto(`/admin/tenants/${P16.T_OLD}`);
  await expect(p.getByTestId("tenant-name")).toHaveText("Eski Ticaret A.Ş.");
  await expect(p.getByTestId("purge-status-error")).toBeVisible();
  await ctx.close();
});

test("AC-241 (S16-1): audit — maskeli satır rozeti, mezar taşı '#', silinmiş firma etiketi, ayrıntı notu", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p16sa");
  await page.goto("/audit");
  const masked = page.getByTestId("audit-row").filter({ hasText: "Silinmiş kullanıcı #DE1E7E" });
  await expect(masked.getByTestId("audit-masked")).toHaveText("Kimlik maskeli");
  await expect(masked.getByTestId("audit-avatar")).toHaveText("#");
  await expect(masked).toContainText("p***@***");
  await expect(page.getByTestId("audit-row").filter({ hasText: "Silinmiş firma #AB12CD" })).toContainText("Firma kalıcı silindi");
  await expect(page.getByTestId("audit-row").filter({ hasText: "Kurucu Yönetici" }).getByTestId("audit-masked")).toHaveCount(0);
  await masked.getByTestId("audit-detail-open").click();
  await expect(page.getByTestId("audit-masked-note")).toContainText("maskelendi");
  await expect(page.getByTestId("audit-new")).toContainText('"***"');
});

// ---------------------------------------------------------------------------------------------------------------
for (const width of [1280, 390]) {
  test(`P16: axe iki temada + taşma yok @ ${width}px (kullanıcı silme, firma silme, bant, audit)`, async ({ browser }, info) => {
    desktopOnly(info.project.name);
    test.setTimeout(120_000);
    await scanBoth(browser, "p16adm", `/users/${P16.PELIN}`, width, async (p) => {
      await p.getByTestId("user-delete").click();
      await expect(p.getByTestId("user-delete-dialog-input")).toBeVisible();
    });
    await scanBoth(browser, "p16sa", `/admin/tenants/${P16.T_OLD}`, width, async (p) => {
      await expect(p.getByTestId("purge-banner")).toBeVisible();
      await p.getByTestId("purge-open").click();
      await expect(p.getByTestId("purge-preview")).toBeVisible();
    });
    await scanBoth(browser, "p16sa", `/admin/tenants/${P16.T_FAIL}`, width, async (p) => {
      await expect(p.getByTestId("purge-failed-body")).toBeVisible();
    });
    await scanBoth(browser, "p16sa", "/admin/tenants", width, async (p) => {
      await expect(p.getByTestId("tenant-purge-badge").filter({ visible: true }).first()).toBeVisible();
    });
    await scanBoth(browser, "p16sa", "/audit", width, async (p) => {
      await expect(p.getByTestId("audit-masked").filter({ visible: true }).first()).toBeVisible();
    });
  });
}
