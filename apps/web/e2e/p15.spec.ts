import { expect, test, type Browser, type Page } from "@playwright/test";
import { CSRF_HEADER } from "@remote/contracts/api/auth";
import { agentSend, startFakeAgent } from "./fake-agent";
import { axeScan, guardConsole, noHorizontalOverflow, signIn } from "./helpers";

// P15 arayüz (AC-231..239). Sahte API: e2e/mock-p15.mjs (Super Admin'ler, Engellenenler), mock-account (kurtarma kodları),
// mock-branding (sistem logosu, AC-233 → p12-branding.spec.ts), mock-requests (rqblk kısayolu, kabul kodu ayarı),
// mock-history (AC-238 → p8-history.spec.ts), mock-sessions ("V" teknisyen avatarı), mock-ws (share.state reason/method).
guardConsole();
const desktopOnly = (name: string) => test.skip(name !== "desktop", "masaüstü akışı");

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
test("AC-231: Hesabım — kurtarma kodlarını yenile: TOTP ister, hatalı kod alan hatası, 10 kod bir kez, Kaydettim'siz kapanmaz", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "acc");
  await page.goto("/account");
  await expect(page.getByTestId("acc-rc-left")).toContainText("2");
  await page.getByTestId("acc-rc-regenerate").click();
  const dlg = page.getByTestId("recovery-regenerate-dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Eski kurtarma kodlarınızın hepsi hemen geçersiz olur");
  const code = page.getByTestId("rg-code");
  await expect(code).toBeFocused();
  // Boş → istek yok, alan hatası
  await page.getByTestId("rg-submit").click();
  await expect(code).toHaveAttribute("aria-invalid", "true");
  // Hatalı kod → 400 fields.code → alan temizlenir, aria-live duyurur
  await code.fill("111111");
  await page.getByTestId("rg-submit").click();
  await expect(page.getByTestId("rg-live")).toHaveText(/Kod hatalı/);
  await expect(code).toHaveValue("");
  // 5 hatalı deneme kilidi (429) → "N dakika sonra"
  await code.fill("000000");
  await page.getByTestId("rg-submit").click();
  await expect(page.getByTestId("rg-live")).toHaveText(/5 dakika sonra/);
  // Doğru kod → 10 kod
  await code.fill("123456");
  await page.getByTestId("rg-submit").click();
  const list = page.getByTestId("rg-codes");
  await expect(list.getByTestId("recovery-code")).toHaveCount(10);
  await expect(list).toContainText("yalnız şimdi gösterilir");
  // Esc kodları kaybettirmez
  await page.keyboard.press("Escape");
  await expect(list).toBeVisible();
  await expect(page.getByTestId("rc-done")).toBeDisabled();
  // İndir (.txt)
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("rc-download").click()]);
  expect(dl.suggestedFilename()).toMatch(/^kurtarma-kodlari-\d{4}-\d{2}-\d{2}\.txt$/);
  await page.getByTestId("rc-saved").check();
  await page.getByTestId("rc-done").click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("toast").last()).toContainText("Kurtarma kodları yenilendi");
  await expect(page.getByTestId("acc-rc-left")).toContainText("10");
  await expect(page.getByTestId("acc-rc-low")).toHaveCount(0);
});

for (const width of [1280, 390]) {
  test(`AC-231: kurtarma kodu diyaloğu axe iki temada + taşma yok @ ${width}px`, async ({ browser }, info) => {
    desktopOnly(info.project.name);
    for (const scheme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
      await signIn(ctx, "acc");
      const p = await ctx.newPage();
      await p.goto("/account");
      await p.getByTestId("acc-rc-regenerate").click();
      await p.getByTestId("rg-code").fill("123456");
      await p.getByTestId("rg-submit").click();
      await expect(p.getByTestId("recovery-code")).toHaveCount(10);
      await noHorizontalOverflow(p);
      expect(await axeScan(p, '[data-testid="recovery-regenerate-dialog"]'), `${scheme} ${width}`).toEqual([]);
      await ctx.close();
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
test("AC-232: Super Admin listesi — başka Super Admin için şifre sıfırla (step-up → geçici şifre bir kez); kendi satırında düğme yok", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p15sa");
  await page.goto("/admin/settings/superadmins");
  await expect(page).toHaveTitle(/Super Admin'ler/);
  await expect(page.getByTestId("system-tabs").getByRole("link", { name: "Super Admin'ler" })).toHaveAttribute("aria-current", "page");
  const rowsSa = page.getByTestId("superadmin-row");
  await expect(rowsSa).toHaveCount(3);
  // Kendi satırı: "(siz)", düğme yok; pasif hesapta da yok
  await expect(rowsSa.filter({ hasText: "Kurucu Yönetici" })).toContainText("(siz)");
  await expect(rowsSa.filter({ hasText: "Kurucu Yönetici" }).getByTestId("superadmin-reset")).toHaveCount(0);
  await expect(rowsSa.filter({ hasText: "Cem Eski" }).getByTestId("superadmin-reset")).toHaveCount(0);
  await expect(page.getByTestId("superadmin-reset")).toHaveCount(1);

  await page.getByRole("button", { name: "Şifre sıfırla: Burak Sistem" }).click();
  const confirm = page.getByTestId("superadmin-reset-dialog");
  await expect(confirm).toHaveAttribute("role", "alertdialog");
  await expect(confirm.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await page.getByTestId("superadmin-reset-confirm").click();
  // Step-up diyaloğu (AC-215) → istek bir kez tekrarlanır
  await expect(page.getByTestId("step-up-dialog")).toBeVisible();
  await page.getByTestId("step-up-code").fill("123456");
  await page.getByTestId("step-up-submit").click();
  const pw = page.getByTestId("superadmin-temp-password");
  await expect(pw).toBeVisible();
  await expect(pw).toContainText("Burak Sistem için geçici şifre");
  await expect(page.getByTestId("temp-password")).toHaveValue("Gecici-Sifre-9Xk2");
  await expect(pw).toContainText("yalnız şimdi gösterilir");
  // Kopyalamadan kapatma → uyarı; yine de kapat → bir daha gösterilmez
  await page.getByTestId("pw-done").click();
  await expect(page.getByTestId("pw-not-copied")).toBeVisible();
  await page.getByTestId("pw-close-anyway").click();
  await expect(pw).toBeHidden();
  await expect(page.getByTestId("temp-password")).toHaveCount(0);
});

test("AC-232: tek Super Admin → boş durum (CLI yolu); liste hatası → Tekrar dene", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p15sa1");
  await page.goto("/admin/settings/superadmins");
  await expect(page.getByTestId("superadmins-empty")).toContainText("Başka Super Admin yok");
  await expect(page.getByTestId("superadmin-reset")).toHaveCount(0);
  await context.clearCookies();
  await signIn(context, "p15sabrk");
  await page.goto("/admin/settings/superadmins");
  await expect(page.getByTestId("load-error")).toBeVisible();
  await page.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByTestId("superadmin-row")).toHaveCount(3);
});

for (const width of [1280, 390]) {
  test(`AC-232: Super Admin'ler axe iki temada + taşma yok @ ${width}px`, async ({ browser }, info) => {
    desktopOnly(info.project.name);
    await scanBoth(browser, "p15sa", "/admin/settings/superadmins", width, (p) => expect(p.getByTestId("superadmin-row")).toHaveCount(3));
  });
}

// ---------------------------------------------------------------------------------------------------------------
async function liveAgent(page: Page, browser: Browser) {
  const r = await page.request.post("/api/v1/sessions", {
    headers: { [CSRF_HEADER]: "csrf-test-token", Origin: "http://localhost:3217" },
    data: {},
  });
  expect(r.status()).toBe(201);
  const { id } = (await r.json()) as { id: string };
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  const a = await startFakeAgent(browser, id);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  return a;
}

test("AC-234: konsol — share.state reason/method Türkçe etiketle ≤ 2 sn; bilinmeyen kod ham; 0.10.x (nedensiz) eski metin", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p7");
  const a = await liveAgent(page, browser);
  await agentSend(a, { t: "share.state", state: "stopped", reason: "DXGI_UNSUPPORTED", method: "DXGI" });
  const reason = page.getByTestId("stage-share-reason");
  await expect(reason).toContainText("Ekran yakalama bu ekran kartında/ayarda desteklenmiyor", { timeout: 2_000 });
  await expect(reason).toContainText("Masaüstü çoğaltma (DXGI)");
  await expect(page.getByTestId("stage-share-failed")).toHaveAttribute("role", "alert");
  await agentSend(a, { t: "share.state", state: "stopped", reason: "NEW_CODE_X" });
  await expect(reason).toHaveText("Neden: Bilinmeyen neden (NEW_CODE_X)", { timeout: 2_000 });
  await agentSend(a, { t: "share.state", state: "sharing" });
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  await agentSend(a, { t: "share.state", state: "stopped" });
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "stopped");
  await expect(page.getByTestId("stage-share-failed")).toHaveCount(0);
  await expect(page.getByText("Müşteri paylaşımı durdurdu")).toBeVisible();
  await a.close();
});

// ---------------------------------------------------------------------------------------------------------------
test("AC-235: Engellenenler — liste (etkin / süresi dolanlar), ekle (alan hataları, 409), kaldır (onay)", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p15bl");
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Ana menü" });
  const link = nav.getByRole("link", { name: "Engellenenler" });
  await expect(link.locator("svg")).toHaveCount(1); // menü ikonu (lucide ShieldBan)
  await link.click();
  await expect(page).toHaveURL(/\/request-blocks$/);
  await expect(page).toHaveTitle(/Engellenenler/);
  await expect(page.getByRole("navigation", { name: "Konum" })).toContainText("Engellenenler");
  const rowsB = page.getByTestId("block-row");
  await expect(rowsB).toHaveCount(2);
  await expect(page.getByTestId("blocks-usage")).toHaveText("3 / 1.000 engel");
  await expect(rowsB.first().getByTestId("block-target")).toHaveText("203.0.113.7"); // /32 tek adres
  await expect(rowsB.nth(1).getByTestId("block-target")).toHaveText("Bilgisayar a1b2c3d4");
  await expect(rowsB.nth(1).getByTestId("block-expiry")).toHaveText("Süresiz");
  await page.getByRole("link", { name: "Süresi dolanlar dahil" }).click();
  await expect(rowsB).toHaveCount(3);
  await expect(page.locator('[data-testid="block-row"][data-expired="true"]')).toContainText("Süresi doldu");
  await page.getByRole("link", { name: "Etkin", exact: true }).click();
  await expect(rowsB).toHaveCount(2);

  // Ekle: boş → zorunlu; geniş önek → contracts mesajı; aynısı → 409 alanda; geçerli → listede
  await page.getByTestId("block-add").click();
  const dlg = page.getByTestId("block-add-dialog");
  const cidr = page.getByTestId("block-cidr");
  await expect(cidr).toBeFocused();
  await page.getByTestId("block-add-submit").click();
  await expect(cidr).toHaveAttribute("aria-invalid", "true");
  await cidr.fill("10.0.0.0/16");
  await page.getByTestId("block-add-submit").click();
  await expect(dlg).toContainText("IPv4 aralığı en geniş /24 olabilir");
  await cidr.fill("203.0.113.7");
  await page.getByTestId("block-add-submit").click();
  await expect(dlg).toContainText("Bu kaynak zaten engelli.");
  await expect(cidr).toBeFocused();
  await cidr.fill("198.51.100.9/24");
  await page.getByTestId("block-duration").selectOption({ label: "Süresiz" });
  await page.getByTestId("block-note").fill("Sahte talepler");
  await page.getByTestId("block-add-submit").click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("toast").last()).toContainText("Engel eklendi");
  await expect(rowsB).toHaveCount(3);
  await expect(rowsB.first().getByTestId("block-target")).toHaveText("198.51.100.0/24"); // hizasız önek ağ adresine indirgenir
  await expect(rowsB.first()).toContainText("Sahte talepler");

  // Kaldır → onay (odak Vazgeç) → liste
  await page.getByRole("button", { name: "Kaldır: 198.51.100.0/24" }).click();
  const rm = page.getByTestId("block-remove-dialog");
  await expect(rm).toHaveAttribute("role", "alertdialog");
  await expect(rm.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await page.getByTestId("block-remove-confirm").click();
  await expect(page.getByTestId("toast").last()).toContainText("Engel kaldırıldı");
  await expect(rowsB).toHaveCount(2);
});

test("AC-235: Engellenenler 5 durum — boş (eylemli), hata → Tekrar dene, sınır dolu (kısmi), yetkisiz", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p15blempty");
  await page.goto("/request-blocks");
  await expect(page.getByTestId("blocks-empty")).toContainText("Etkin engel yok");
  await expect(page.getByTestId("block-add-empty")).toBeVisible();
  await context.clearCookies();
  await signIn(context, "p15blbrk");
  await page.goto("/request-blocks");
  await expect(page.getByTestId("load-error")).toBeVisible();
  await page.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByTestId("blocks-empty")).toBeVisible();
  await context.clearCookies();
  await signIn(context, "p15blfull");
  await page.goto("/request-blocks");
  await expect(page.getByTestId("blocks-full")).toBeVisible();
  await expect(page.getByTestId("block-add")).toBeDisabled();
  await context.clearCookies();
  await signIn(context, "p15blno");
  await page.goto("/request-blocks");
  await expect(page.getByTestId("blocks-forbidden")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Engellenenler" })).toHaveCount(0);
});

test("AC-235: Talepler kartında 'Bu kaynağı engelle' kısayolu (IP / bilgisayar; kaynak yoksa sunucu mesajı)", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "rqblk");
  await page.goto("/requests");
  const card = page.getByTestId("request-card").filter({ hasText: "Ayşe Yılmaz" });
  await card.getByTestId("request-menu").locator("summary").click();
  await card.getByTestId("request-block").click();
  const dlg = page.getByTestId("request-block-dialog");
  await expect(dlg).toContainText("Ayşe Yılmaz talebinin kaynağı engellensin mi?");
  await expect(page.getByTestId("block-target-IP")).toBeChecked();
  await page.getByTestId("request-block-submit").click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("toast").last()).toContainText("Kaynak engellendi");
  // Kaynağı (cihaz anahtarı) olmayan talep → sunucunun mesajı form üstünde, diyalog açık kalır
  const b = page.getByTestId("request-card").filter({ hasText: "Ali Demir" });
  await b.getByTestId("request-menu").locator("summary").click();
  await b.getByTestId("request-block").click();
  await page.getByTestId("block-target-DEVICE").check();
  await page.getByTestId("request-block-submit").click();
  await expect(dlg).toContainText("Bu talebin kaynak bilgisi yok");
  await dlg.getByRole("button", { name: "Vazgeç" }).click();
  await expect(dlg).toBeHidden();
});

for (const width of [1280, 390]) {
  test(`AC-235: Engellenenler + ekle diyaloğu axe iki temada + taşma yok @ ${width}px`, async ({ browser }, info) => {
    desktopOnly(info.project.name);
    await scanBoth(browser, "p15bl", "/request-blocks", width, (p) => expect(p.getByTestId("block-row")).toHaveCount(2));
    await scanBoth(browser, "p15blempty", "/request-blocks", width, (p) => expect(p.getByTestId("blocks-empty")).toBeVisible());
    await scanBoth(browser, "p15bl", "/request-blocks", width, async (p) => {
      await p.getByTestId("block-add").click();
      await expect(p.getByTestId("block-cidr")).toBeFocused();
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------
test("AC-236: müşteri sayfasında teknisyen avatarı imzalı URL'den; avatarsız teknisyende baş harf rozeti", async ({ page }) => {
  await page.goto(`/session/${"V".repeat(43)}`);
  const img = page.locator('img[data-testid="guest-tech-avatar"]');
  await expect(img).toHaveAttribute("src", /^\/api\/v1\/public\/sessions\/[0-9A-Z]{26}\/tech-avatar\?exp=\d+&sig=[a-f0-9]{64}$/);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await page.goto(`/session/${"A".repeat(43)}`);
  await expect(page.locator('span[data-testid="guest-tech-avatar"]')).toHaveText("MK");
  await expect(page.locator('img[data-testid="guest-tech-avatar"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------------------------
test("AC-237: yetki matrisinde yeni anahtarlar tanımdan otomatik çıkar (Destek talepleri — Engelle, Kullanıcılar — Sil)", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "usadm");
  await page.goto("/users/01JKS00000000000000000000B");
  await expect(page.getByTestId("perm-support_requests.block").filter({ visible: true })).toHaveAccessibleName(
    "Destek talepleri — Engelle",
  );
  await expect(page.getByTestId("perm-users.delete").filter({ visible: true })).toHaveAccessibleName("Kullanıcılar — Sil");
  await expect(page.getByTestId("permission-notes")).toContainText("Pasif kullanıcıyı kalıcı siler");
});

// ---------------------------------------------------------------------------------------------------------------
test("AC-239: Ayarlar > Destek talepleri — 'Talep kabulünde kabul kodu iste' anahtarı kaydedilir ve kalıcıdır", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "rqadm");
  await page.goto("/settings/support-requests");
  const sw = page.getByTestId("accept-code-switch");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("switch", { name: "Talep kabulünde kabul kodu iste" })).toBeVisible();
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/settings/support-requests"));
  await page.getByRole("button", { name: "Kaydet" }).click();
  expect((await put).postDataJSON()).toMatchObject({ requireAcceptCode: true });
  await expect(page.getByTestId("toast").last()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("accept-code-switch")).toHaveAttribute("aria-checked", "true");
});

for (const width of [1280, 390]) {
  test(`AC-239: destek talebi ayarları axe iki temada + taşma yok @ ${width}px`, async ({ browser }, info) => {
    desktopOnly(info.project.name);
    await scanBoth(browser, "rqadm", "/settings/support-requests", width, (p) => expect(p.getByTestId("accept-code-switch")).toBeVisible());
  });
}
