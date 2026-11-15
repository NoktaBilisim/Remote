import { expect, test, type Page } from "@playwright/test";
import { axeScan, guardConsole, noHorizontalOverflow, signIn } from "./helpers";

// P27a "Bu cihazı 30 gün hatırla" — AC-325, AC-329, AC-330, AC-331 (UI). Sahte API: e2e/mock-p27a.mjs
// (hatirla@ / sa2fa@ girişleri; u-td / u-tdempty / u-tdbad / u-tdsa çerezleri).
guardConsole();
const PASSWORD = "DogruSifre123!";
const TARGET = "01JTDTARGET000000000000001";

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel("E-posta veya kullanıcı adı").fill(user);
  await page.getByLabel("Şifre", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/login\/2fa$/);
}

test("AC-325 kutu kod modunda görünür, varsayılan işaretsiz; kurtarma modunda gizli; işaretliyse rememberDevice gider", async ({
  page,
}) => {
  await login(page, "hatirla@ornek.com");
  const box = page.getByLabel("Bu cihazı 30 gün hatırla");
  await expect(box).toBeVisible();
  await expect(box).not.toBeChecked();
  await expect(box).toHaveAccessibleDescription(/Yalnız kişisel cihazınızda/);
  await page.getByTestId("mfa-mode").click();
  await expect(page.getByTestId("mfa-remember")).toHaveCount(0);
  await page.getByTestId("mfa-mode").click();
  // Klavye: etikete odaklan + Space
  await page.getByTestId("mfa-remember").focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("mfa-remember")).toBeChecked();
  expect(await axeScan(page)).toEqual([]);
  await page.getByLabel("6 haneli kod").fill("123456");
  const req = page.waitForRequest((r) => r.url().endsWith("/api/v1/auth/mfa/verify"));
  await page.getByTestId("mfa-submit").click();
  expect((await req).postDataJSON()).toEqual({ code: "123456", rememberDevice: true });
  await expect(page).toHaveURL(/\/$/);
});

test("AC-325 / K-P27a-2 Super Admin'de kutu yok; gövdede rememberDevice yok", async ({ page }) => {
  await login(page, "sa2fa@ornek.com");
  await expect(page.getByLabel("6 haneli kod")).toBeVisible();
  await expect(page.getByTestId("mfa-remember")).toHaveCount(0);
  await page.getByLabel("6 haneli kod").fill("123456");
  const req = page.waitForRequest((r) => r.url().endsWith("/api/v1/auth/mfa/verify"));
  await page.getByTestId("mfa-submit").click();
  expect((await req).postDataJSON()).toEqual({ code: "123456" });
});

test("AC-329 Hesabım → Hatırlanan cihazlar: liste, Bu cihaz rozeti, kısmi hata, tek kaldır, tümünü kaldır", async ({ page, context }) => {
  await signIn(context, "td");
  await page.goto("/account");
  const sec = page.getByTestId("acc-td");
  await expect(sec.getByRole("heading", { name: "Hatırlanan cihazlar" })).toBeVisible();
  await expect(sec.getByTestId("td-row")).toHaveCount(3);
  await expect(sec.getByTestId("td-current")).toHaveText("Bu cihaz");
  await expect(sec.getByText("Son kullanım: henüz yok")).toBeVisible();
  await noHorizontalOverflow(page);
  expect(await axeScan(page, "[data-testid=acc-td]")).toEqual([]);
  // Koyu tema (kullanıcı teması "Sistem" → işletim sistemi tercihi)
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await axeScan(page, "[data-testid=acc-td]")).toEqual([]);
  await page.emulateMedia({ colorScheme: "light" });
  // Kısmi: silme başarısız → satır kalır + hata toast'ı
  await sec.getByRole("button", { name: "Kaldır: Safari · iOS" }).click();
  await expect(page.getByText(/Cihaz kaldırılamadı/)).toBeVisible();
  await expect(sec.getByTestId("td-row")).toHaveCount(3);
  // Tek kaldır
  await sec.getByRole("button", { name: "Kaldır: Firefox · macOS" }).click();
  await expect(page.getByText(/Cihaz kaldırıldı/)).toBeVisible();
  await expect(sec.getByTestId("td-row")).toHaveCount(2);
  // Tümünü kaldır: onay diyaloğu, odak Vazgeç
  await sec.getByTestId("td-remove-all").click();
  const dlg = page.getByTestId("td-remove-all-dialog");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await dlg.getByTestId("td-remove-all-confirm").click();
  await expect(page.getByText("2 hatırlanan cihaz kaldırıldı")).toBeVisible();
  await expect(sec.getByTestId("td-empty")).toBeVisible();
});

test("AC-329 boş durum ve hata + Tekrar dene", async ({ page, context }) => {
  await signIn(context, "tdempty");
  await page.goto("/account");
  await expect(page.getByTestId("td-empty")).toBeVisible();
  await expect(page.getByTestId("td-remove-all")).toHaveCount(0);
  await signIn(context, "tdbad");
  await page.goto("/account");
  await expect(page.getByTestId("td-error")).toBeVisible();
  // Hata durumu (FormError + istek kimliği satırı) açık ve koyu temada 0 axe ihlali
  await expect(page.getByTestId("form-error")).toContainText("Hata kodu");
  expect(await axeScan(page, "[data-testid=acc-td]")).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await axeScan(page, "[data-testid=acc-td]")).toEqual([]);
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByTestId("td-error").getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByTestId("td-row")).toHaveCount(3);
});

test("AC-329 Super Admin'in Hesabım sayfasında bölüm yok", async ({ page, context }) => {
  await signIn(context, "tdsa");
  await page.goto("/account");
  await expect(page.getByTestId("acc-mfa")).toBeVisible();
  await expect(page.getByTestId("acc-td")).toHaveCount(0);
});

test("AC-330 Admin kullanıcı düzenlemede cihaz sayısı + onaylı Hatırlanan cihazları kaldır", async ({ page, context }) => {
  await signIn(context, "td");
  await page.goto(`/users/${TARGET}`);
  await expect(page.getByTestId("user-td-count")).toHaveText("2 hatırlanan cihaz");
  await page.getByTestId("user-forget-devices").click();
  const dlg = page.getByTestId("user-forget-devices-dialog");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  expect(await axeScan(page, "[data-testid=user-forget-devices-dialog]")).toEqual([]);
  await dlg.getByTestId("user-action-confirm").click();
  await expect(page.getByText("Tolga Teknisyen için 2 hatırlanan cihaz kaldırıldı")).toBeVisible();
  await expect(page.getByTestId("user-td-count")).toHaveText("0 hatırlanan cihaz");
  await expect(page.getByTestId("user-forget-devices")).toBeDisabled();
});

test("AC-331 Ayarlar → Güvenlik: cihaz hatırlama kapatma onayı, Vazgeç değeri korur, onay kapatır", async ({ page, context }) => {
  await signIn(context, "td");
  await page.goto("/settings/security");
  const sw = page.getByTestId("remember-device-switch");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/Super Admin hesapları hariçtir/)).toBeVisible();
  await sw.click();
  const dlg = page.getByTestId("remember-off-dialog");
  await expect(dlg).toContainText("hatırlanan cihazları hemen silinir");
  await dlg.getByRole("button", { name: "Vazgeç" }).click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await page.getByTestId("remember-off-confirm").click();
  await expect(page.getByText("2FA cihaz hatırlama kapatıldı; hatırlanan cihazlar silindi")).toBeVisible();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  // Açmak onaysız
  await sw.click();
  await expect(page.getByText("2FA cihaz hatırlama açıldı")).toBeVisible();
  await expect(sw).toHaveAttribute("aria-checked", "true");
});
