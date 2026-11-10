import { expect, test } from "@playwright/test";
import { axeScan, guardConsole, noHorizontalOverflow, rows, signIn } from "./helpers";

guardConsole();
const tok = (ch: string) => `/session/${ch.repeat(43)}`;

test("karşılama: teknisyen, doğrulama kodu, dolandırıcılık uyarısı; referrer/noindex", async ({ page }) => {
  await page.goto(tok("A"));
  await expect(page).toHaveTitle(/Uzaktan destek bağlantısı/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Uzaktan destek bağlantısı");
  await expect(page.getByTestId("guest-tech")).toHaveText("Mehmet Kaya");
  await expect(page.getByTestId("guest-verify-code")).toHaveText(/^\d{4}$/);
  await expect(page.getByTestId("fraud-warning")).toContainText("Sizi biz aramadıysak devam etmeyin");
  await expect(page.getByTestId("guest-next")).toContainText(/daha geçerli/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  // Oturumsuz açılır (login'e gitmez); P2'de form/indirme yok
  await expect(page).toHaveURL(tok("A"));
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

const ends = [
  ["E", "guest-expired", "Bu destek bağlantısının süresi doldu"],
  ["C", "guest-cancelled", "Oturum iptal edildi"],
  ["U", "guest-consumed", "Bu bağlantı zaten kullanıldı"],
  ["N", "guest-notFound", "Bağlantı geçersiz"],
  ["R", "guest-rate", "Çok fazla deneme"],
] as const;
for (const [ch, id, title] of ends) {
  test(`AC-5/7/8: ${id} ekranı`, async ({ page }) => {
    const res = await page.goto(tok(ch));
    if (ch === "N") expect(res?.status()).toBe(404);
    await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  });
}

test("S-P2-4: 429 ekranı bağlantıyı kullanmaya / beklemeye yönlendirir", async ({ page }) => {
  await page.goto(tok("R"));
  const s = page.getByTestId("guest-rate");
  await expect(s).toContainText("Kod girişi geçici olarak engellendi");
  await expect(s).toContainText("gönderdiği bağlantıyı kullanın");
});

test("biçimsiz token: sunucuya sorulmadan geçersiz bağlantı ekranı", async ({ page }) => {
  const res = await page.goto("/session/kisa-token");
  expect(res?.status()).toBe(404);
  await expect(page.getByTestId("guest-notFound")).toBeVisible();
});

test("AC-8: teknisyen iptal edince açık müşteri sayfası yoklamayla 'Oturum iptal edildi' gösterir", async ({ page, context }) => {
  await signIn(context);
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const link = await page.getByTestId("session-link").inputValue();
  await page.getByRole("button", { name: "Kapat", exact: true }).click();

  const guest = await context.newPage();
  await guest.goto(new URL(link).pathname);
  await expect(guest.getByTestId("guest-tech")).toBeVisible();

  await rows(page).first().getByRole("button", { name: /Oturumu iptal et/ }).click();
  await page.getByTestId("cancel-dialog").getByRole("button", { name: "Evet, iptal et" }).click();
  await expect(page.getByTestId("toast")).toContainText("Oturum iptal edildi");
  // 2 sn yoklama → en geç ~4 sn
  await expect(guest.getByTestId("guest-cancelled")).toBeVisible({ timeout: 5000 });
  await guest.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`erişilebilirlik (${scheme}): karşılama ve süresi doldu`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto(tok("A"));
    await expect(page.getByTestId("guest-tech")).toBeVisible();
    expect(await axeScan(page)).toEqual([]);
    await page.goto(tok("E"));
    await expect(page.getByTestId("guest-expired")).toBeVisible();
    expect(await axeScan(page)).toEqual([]);
  });
}

test("mobil 375 px: karşılamada yatay taşma yok", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto(tok("A"));
  await expect(page.getByTestId("guest-tech")).toBeVisible();
  await noHorizontalOverflow(page);
});
