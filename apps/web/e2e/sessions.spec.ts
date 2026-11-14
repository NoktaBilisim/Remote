import { expect, test } from "@playwright/test";
import { axeScan, guardConsole, noHorizontalOverflow, rows, signIn } from "./helpers";

guardConsole();

test("AC-1/3/9: boş liste → yeni oturum diyaloğu link, kod, doğrulama kodu ve kopyalama", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(context);
  await page.goto("/sessions");
  await expect(page).toHaveTitle(/Oturumlar · Nokta Uzaktan Destek/);
  await expect(page.getByRole("navigation", { name: "Konum" })).toContainText("Oturumlar");
  await expect(page.getByTestId("empty-state")).toContainText("Henüz destek oturumu yok");

  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const dlg = page.getByTestId("new-session-dialog");
  await expect(dlg.getByTestId("session-link")).toHaveValue(/^http:\/\/localhost:3217\/session\/[A-Za-z0-9_-]{43}$/);
  await expect(dlg.getByTestId("session-code")).toHaveText(/^\d{4} \d{4}$/);
  await expect(dlg.getByTestId("verify-code")).toHaveText(/^\d{4}$/);
  await expect(dlg).toContainText("sonradan tekrar görüntülenemez");
  await expect(dlg.getByTestId("validity")).toContainText(/1[45]:\d{2} kaldı/);
  await expect(dlg.getByRole("button", { name: /E-posta|Konsolu aç/ })).toHaveCount(0);

  // TO-P2-2: iki "Kopyala" düğmesi aynı varyantta (kenarlıklı secondary)
  const copyBorder = (name: string) => dlg.getByRole("button", { name }).evaluate((b) => getComputedStyle(b).borderTopWidth);
  expect(await copyBorder("Kodu kopyala")).toBe(await copyBorder("Linki kopyala"));
  expect(await copyBorder("Kodu kopyala")).not.toBe("0px");

  const link = await dlg.getByTestId("session-link").inputValue();
  await dlg.getByRole("button", { name: "Linki kopyala" }).click();
  await expect(dlg.getByTestId("toast")).toContainText("Kopyalandı");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  await dlg.getByRole("button", { name: "Kapat", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Bekliyor");
});

test("AC-8: diyalogdan iptal onay ister (odak Vazgeç'te), sonra listede İptal", async ({ page, context }) => {
  await signIn(context);
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const dlg = page.getByTestId("new-session-dialog");
  await expect(dlg.getByTestId("session-code")).toBeVisible();
  await dlg.getByRole("button", { name: "Oturumu iptal et" }).click();
  const confirm = page.getByTestId("cancel-dialog");
  await expect(confirm.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await confirm.getByRole("button", { name: "Evet, iptal et" }).click();
  await expect(dlg.getByTestId("dialog-cancelled")).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Linki kopyala" })).toBeDisabled();
  await dlg.getByRole("button", { name: "Kapat", exact: true }).click();
  await expect(rows(page).first()).toContainText("İptal");
});

test("AC-8: satırdan iptal — Vazgeç değiştirmez, onay iptal eder + toast", async ({ page, context }) => {
  await signIn(context, "seed");
  await page.goto("/sessions");
  await expect(rows(page)).toHaveCount(4);
  const pending = rows(page).filter({ hasText: "Bekliyor" });
  await pending.getByRole("button", { name: /Oturumu iptal et/ }).click();
  await page.getByTestId("cancel-dialog").getByRole("button", { name: "Vazgeç" }).click();
  await expect(rows(page).filter({ hasText: "Bekliyor" })).toHaveCount(1);
  await pending.getByRole("button", { name: /Oturumu iptal et/ }).click();
  await page.getByTestId("cancel-dialog").getByRole("button", { name: "Evet, iptal et" }).click();
  await expect(page.getByTestId("toast")).toContainText("Oturum iptal edildi");
  await expect(rows(page).filter({ hasText: "Bekliyor" })).toHaveCount(0);
});

test("durum filtresi sayıları ve süzme (Tümü / Açık / Bitmiş)", async ({ page, context }) => {
  await signIn(context, "seed");
  await page.goto("/sessions");
  const f = page.getByRole("group", { name: "Durum filtresi" });
  await expect(f.getByRole("button", { name: "Tümü 4" })).toHaveAttribute("aria-pressed", "true");
  await f.getByRole("button", { name: "Bitmiş 2" }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).filter({ hasText: /Bekliyor|Aktif/ })).toHaveCount(0);
  await f.getByRole("button", { name: "Açık 2" }).click();
  await expect(rows(page).filter({ hasText: /Bekliyor|Aktif/ })).toHaveCount(2);
});

test("AC-11: açık oturum sınırı (409) diyalogda açıklanır", async ({ page, context }) => {
  await signIn(context, "limit");
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const e = page.getByTestId("limit-error");
  await expect(e).toContainText("Açık oturum sınırına ulaştınız");
  await expect(e).toContainText("Yeni oturum için bekleyen bir oturumu iptal edin.");
  // TO-P2-1: başlık cümlesi tek kez geçer
  expect((await e.innerText()).split("Açık oturum sınırına ulaştınız").length - 1).toBe(1);
});

test("AC-12: saatlik sınır (429) Retry-After dakikasıyla gösterilir", async ({ page, context }) => {
  await signIn(context, "rate");
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  await expect(page.getByTestId("rate-error")).toContainText("10 dakika sonra tekrar deneyin");
});

test("yetkisiz kullanıcı: menüde Oturumlar yok, sayfa uyarı gösterir", async ({ page, context }) => {
  await signIn(context, "noperm");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Oturumlar" })).toHaveCount(0);
  await page.goto("/sessions");
  await expect(page.getByRole("status").filter({ hasText: "yetkiniz yok" })).toBeVisible();
});

test("liste alınamazsa hata durumu + Tekrar dene", async ({ page, context }) => {
  await signIn(context, "broken");
  await page.goto("/sessions");
  await expect(page.getByTestId("load-error")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
});

test("AC-61: yönetici görünümünde teknisyen sütunu, teknisyende yok", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "sütun başlıkları masaüstü tablosunda");
  await signIn(context, "admin");
  await page.goto("/sessions");
  await expect(page.getByRole("columnheader", { name: "Teknisyen" })).toBeVisible();
  await context.clearCookies();
  await signIn(context, "seed");
  await page.goto("/sessions");
  await expect(page.getByRole("columnheader", { name: "Durum" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Teknisyen" })).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`erişilebilirlik (${scheme}): liste + yeni oturum diyaloğu`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await signIn(context, "seed");
    await page.goto("/sessions");
    await expect(rows(page)).toHaveCount(4);
    expect(await axeScan(page)).toEqual([]);
    await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
    await expect(page.getByTestId("session-code")).toBeVisible();
    expect(await axeScan(page)).toEqual([]);
  });
}

test("mobil 375 px: liste ve diyalogda yatay taşma yok", async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await signIn(context, "seed");
  await page.goto("/sessions");
  await expect(page.getByTestId("session-card").first()).toBeVisible();
  await noHorizontalOverflow(page);
  // TO-P2-3: mobilde baş harf rozeti görünür; ad/rol/firma ekran okuyucuya açık (sr-only)
  await expect(page.getByTestId("current-user-avatar")).toBeVisible();
  await expect(page.getByTestId("current-user")).toHaveClass(/sr-only/);
  await expect(page.getByTestId("current-user")).not.toBeEmpty();
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  await expect(page.getByTestId("session-code")).toBeVisible();
  await noHorizontalOverflow(page);
});

// --- QA-P2-5: loading ve partial durumları ---

test("loading: liste gecikirken sayfa iskeleti, sonra içerik", async ({ page, context }) => {
  await signIn(context, "slow");
  await page.goto("/sessions", { waitUntil: "commit" });
  const sk = page.getByTestId("sessions-loading");
  await expect(sk).toBeVisible();
  await expect(sk).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(sk).toHaveCount(0);
});

test("loading: oturum oluşturulurken diyalogda iskelet (aria-busy), sonra kod", async ({ page, context }) => {
  await signIn(context, "slow");
  await page.goto("/sessions");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const dlg = page.getByTestId("new-session-dialog");
  const creating = dlg.getByTestId("creating");
  await expect(creating).toBeVisible();
  await expect(creating).toHaveAttribute("aria-busy", "true");
  // P13b-L: diyaloğun toast bölgesi de role=status → oluşturma durumu metniyle seçilir
  await expect(dlg.getByRole("status").filter({ hasText: "Oturum oluşturuluyor…" })).toHaveText("Oturum oluşturuluyor…");
  await expect(dlg.getByTestId("session-code")).toBeVisible();
  await expect(creating).toHaveCount(0);
});

test("partial: yenileme başarısız olunca son liste korunur ve uyarı çıkar", async ({ page, context }) => {
  await page.clock.install();
  await signIn(context, "flaky");
  await page.goto("/sessions");
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByTestId("refresh-error")).toHaveCount(0);
  const updated = await page.getByTestId("last-updated").textContent();
  await page.clock.runFor(10_000);
  await expect(page.getByTestId("refresh-error")).toContainText("son bilinen durum gösteriliyor");
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByTestId("last-updated")).toHaveText(updated ?? "");
});

// --- QA-P2-6: diyaloglarda 401 → giriş ---

test("401: yeni oturum oluştururken oturum düşmüşse /login?reason=expired", async ({ page, context }) => {
  await signIn(context, "expire");
  await page.goto("/sessions");
  await expect(rows(page)).toHaveCount(4);
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  await expect(page).toHaveURL(/\/login\?reason=expired$/);
  await expect(page.getByText("Oturumunuz sona erdi")).toBeVisible();
});

test("401: iptal onayında oturum düşmüşse /login?reason=expired", async ({ page, context }) => {
  await signIn(context, "expire");
  await page.goto("/sessions");
  await rows(page).filter({ hasText: "Bekliyor" }).getByRole("button", { name: /Oturumu iptal et/ }).click();
  await page.getByTestId("cancel-dialog").getByRole("button", { name: "Evet, iptal et" }).click();
  await expect(page).toHaveURL(/\/login\?reason=expired$/);
  await expect(page.getByText("Oturumunuz sona erdi")).toBeVisible();
});
