import { expect, test } from "@playwright/test";
import { axeScan, guardConsole, noHorizontalOverflow, rows, signIn } from "./helpers";

guardConsole();
const tok = (ch: string) => `/session/${ch.repeat(43)}`;

test("karşılama: teknisyen, doğrulama kodu, dolandırıcılık uyarısı; referrer/noindex", async ({ page }, info) => {
  await page.goto(tok("A"));
  await expect(page).toHaveTitle(/Uzaktan destek bağlantısı/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Uzaktan destek bağlantısı");
  await expect(page.getByTestId("guest-tech")).toHaveText("Mehmet Kaya");
  await expect(page.getByTestId("guest-verify-code")).toHaveText(/^\d{4}$/);
  await expect(page.getByTestId("fraud-warning")).toContainText("Sizi biz aramadıysak devam etmeyin");
  await expect(page.getByTestId("guest-next")).toContainText(/daha geçerli/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  // Oturumsuz açılır (login'e gitmez); P4: ad alanı + aydınlatma onayı (indirme seçeneği P6)
  await expect(page).toHaveURL(tok("A"));
  if (info.project.name === "mobile") {
    // AC-33: mobilde form yerine "desteklenmiyor"
    await expect(page.getByTestId("guest-unsupported")).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    return;
  }
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).toHaveCount(1);
});

test("AC-33: mobil cihazda veya getDisplayMedia yoksa 'Bu cihaz desteklenmiyor'; lobiye girilemez", async ({ page }, info) => {
  if (info.project.name === "desktop") {
    // Masaüstünde API yoksa (eski tarayıcı) aynı ekran
    await page.addInitScript(() => {
      Object.defineProperty(MediaDevices.prototype, "getDisplayMedia", { value: undefined, configurable: true });
    });
  }
  await page.goto(tok("A"));
  const box = page.getByTestId("guest-unsupported");
  await expect(box).toBeVisible();
  await expect(box).toContainText("Bu cihaz desteklenmiyor; masaüstü Chrome, Edge veya Firefox kullanın");
  await expect(page.getByTestId("join-browser")).toHaveCount(0);
  await expect(page.getByTestId("join-form")).toHaveCount(0);
  // Doğrulama kodu ve uyarı hâlâ görünür (kullanıcı teknisyeni bilgilendirebilsin)
  await expect(page.getByTestId("guest-verify-code")).toBeVisible();
  expect(await axeScan(page)).toEqual([]);
});

test("AC-38: /session/<token> yanıtı çerçevelenemez (CSP frame-ancestors 'none')", async ({ page }) => {
  const res = await page.goto(tok("A"));
  const h = res!.headers();
  expect(h["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
  if (h["x-frame-options"]) expect(h["x-frame-options"].toUpperCase()).toBe("DENY");
});

test("AC-125: abuseEmail null gelirse 'Kötüye kullanımı bildir' gizlenir", async ({ page }) => {
  await page.goto(tok("B"));
  await expect(page.getByTestId("fraud-warning")).toBeVisible();
  await expect(page.getByRole("link", { name: "Kötüye kullanımı bildir" })).toHaveCount(0);
  await page.goto(tok("A"));
  await expect(page.getByRole("link", { name: "Kötüye kullanımı bildir" })).toHaveAttribute("href", "mailto:kotuye-kullanim@ornek.com");
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
