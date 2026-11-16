import { expect, test, type Browser, type Page } from "@playwright/test";
import { DEFAULT_LOGO_URL } from "@remote/contracts/api/branding";
import sharp from "sharp";
import { axeScan, desktopOnly, guardConsole, noHorizontalOverflow, sessionCookies, signIn } from "./helpers";

// P12 marka ve kişiselleştirme (AC-81, 82, 83, 85, 87). Sahte API: e2e/mock-branding.mjs
// (u-br-* ADMIN "Demo Firma", u-brfail-* tema kaydı 500, u-brsa-* SUPER_ADMIN).
guardConsole();

const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
const menu = (p: Page) => p.getByTestId("user-menu");
async function openMenu(p: Page) {
  await menu(p).locator("summary").click();
  await expect(menu(p).getByTestId("user-menu-theme")).toBeVisible();
}
/** İlk HTML'deki <html> sınıfı (hidrasyondan önce; flaş yok kanıtı). */
async function firstPaintClass(p: Page, path = "/") {
  const html = await (await p.request.get(path)).text();
  return /<html[^>]*>/.exec(html)?.[0] ?? "";
}
const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 108, b: 176 } } })
    .png()
    .toBuffer();

test("AC-85 kritik akış: tema menüden seçilir → anında uygulanır → yenilemede ilk boyamada doğru; başka cihaz aynı tema", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  const sid = await signIn(context, "br");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveClass(/\b(light|dark)\b/); // varsayılan Sistem: sınıf yok
  await openMenu(page);
  const picker = menu(page).getByTestId("user-menu-theme");
  await expect(picker.getByRole("button", { name: "Sistem" })).toHaveAttribute("aria-pressed", "true");
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/auth/me/preferences") && r.request().method() === "PATCH");
  await picker.getByRole("button", { name: "Koyu" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/); // anında
  expect((await saved).status()).toBe(200);
  await expect(picker.getByRole("button", { name: "Koyu" })).toHaveAttribute("aria-pressed", "true");
  // Koyu token'lar etkin (işletim sistemi açıkken bile)
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(11, 14, 20)");
  expect(await firstPaintClass(page)).toMatch(/class="dark"/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  // Başka cihaz: yalnız aynı oturum çerezi (rs_theme yok) → DB tercihi ilk HTML'de
  const other = await browser.newContext();
  await sessionCookies(other, sid);
  const p2 = await other.newPage();
  expect(await firstPaintClass(p2)).toMatch(/class="dark"/);
  await p2.goto("/account");
  await expect(p2.locator("html")).toHaveClass(/\bdark\b/);
  await expect(p2.getByTestId("acc-theme").getByRole("button", { name: "Koyu" })).toHaveAttribute("aria-pressed", "true");
  // Profilde Açık seçimi → anında; çerez eşitlendi
  await p2.getByTestId("acc-theme").getByRole("button", { name: "Açık" }).click();
  await expect(p2.locator("html")).toHaveClass(/\blight\b/);
  await expect.poll(async () => (await other.cookies()).find((c) => c.name === "rs_theme")?.value).toBe("light");
  await other.close();
});

test("AC-85: kayıt başarısızsa tema geri alınır ve kullanıcıya söylenir", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "brfail");
  await page.goto("/");
  await openMenu(page);
  await menu(page).getByTestId("user-menu-theme").getByRole("button", { name: "Koyu" }).click();
  await expect(page.getByTestId("toast").last()).toContainText("Tema kaydedilemedi");
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await expect(menu(page).getByTestId("user-menu-theme").getByRole("button", { name: "Sistem" })).toHaveAttribute("aria-pressed", "true");
});

test("AC-85: oturumsuz giriş ekranı tarayıcıdaki son tercihe uyar (çerez), yoksa sistem", async ({ page, context }) => {
  expect(await firstPaintClass(page, "/login")).not.toMatch(/class="(light|dark)"/);
  await context.addCookies([{ ...base, name: "rs_theme", value: "dark", sameSite: "Lax" }]);
  expect(await firstPaintClass(page, "/login")).toMatch(/class="dark"/);
});

test("AC-83 kritik akış: avatar yükle (kare kırp) → üst menüde görünür → kaldır (onaylı); hatalı dosyalar reddedilir", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "br");
  await page.goto("/account");
  const up = page.getByTestId("avatar-uploader");
  await expect(up).toHaveAttribute("data-ready", "true");
  await expect(up).toHaveAttribute("data-has-avatar", "false");
  await expect(page.getByTestId("current-user-avatar")).toHaveText("MM"); // baş harf rozeti

  // SVG → tür reddi; 2 MB+ → boyut reddi; sahte uzantı (metin .png) → çözülemez
  const input = page.getByTestId("avatar-uploader-input");
  await input.setInputFiles({ name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await expect(page.getByTestId("avatar-uploader-error")).toContainText("Yalnız PNG, JPG veya WEBP");
  await input.setInputFiles({ name: "buyuk.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 1) });
  await expect(page.getByTestId("avatar-uploader-error")).toContainText("en çok 2 MB");
  await input.setInputFiles({ name: "sahte.png", mimeType: "image/png", buffer: Buffer.from("bu bir resim degil") });
  await expect(page.getByTestId("avatar-uploader-error")).toContainText("Yalnız PNG, JPG veya WEBP");
  await expect(page.getByTestId("avatar-crop-dialog")).toHaveJSProperty("open", false);

  // Geçerli resim → kırpma diyaloğu (yuvarlak önizleme, yakınlaştırma) → kaydet
  await input.setInputFiles({ name: "ben.png", mimeType: "image/png", buffer: await png(400, 240) });
  const dlg = page.getByTestId("avatar-crop-dialog");
  await expect(dlg).toHaveJSProperty("open", true);
  await expect(dlg.getByRole("group", { name: "Kırpma alanı" })).toBeVisible();
  await dlg.getByTestId("avatar-zoom").fill("1.5");
  expect(await axeScan(page, '[data-testid="avatar-crop-dialog"]')).toEqual([]);
  const req = page.waitForRequest((r) => r.url().endsWith("/api/v1/users/me/avatar") && r.method() === "POST");
  await dlg.getByTestId("avatar-crop-save").click();
  expect((await req).headers()["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
  await expect(page.getByTestId("toast").last()).toContainText("Profil resmi güncellendi");
  await expect(up).toHaveAttribute("data-has-avatar", "true");
  await expect(page.locator("img[data-testid=current-user-avatar]")).toBeVisible(); // üst menü
  const dims = await page
    .locator("img[data-testid=avatar-uploader-image]")
    .evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight]);
  expect(dims).toEqual([256, 256]);

  // Kaldır: onay diyaloğu, odak Vazgeç'te
  await page.getByTestId("avatar-uploader-remove").click();
  const rm = page.getByTestId("avatar-remove-dialog");
  await expect(rm.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await rm.getByTestId("avatar-remove-confirm").click();
  await expect(page.getByTestId("toast").last()).toContainText("Profil resmi kaldırıldı");
  await expect(up).toHaveAttribute("data-has-avatar", "false");
  await expect(page.getByTestId("current-user-avatar")).toHaveText("MM");
});

test("AC-81 kritik akış: firma logosu önizleme → kaydet → üst menüde; sunucu reddi; kaldır → sistem logosu", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "br");
  await page.goto("/settings/logo");
  await expect(page).toHaveTitle(/Logo/);
  await expect(page.getByTestId("settings-tabs").getByRole("link", { name: "Logo" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("header-logo")).toHaveAttribute("data-logo", "system");
  await expect(page.getByTestId("logo-uploader-none")).toBeVisible();
  await expect(page.getByTestId("logo-uploader")).toHaveAttribute("data-ready", "true");

  const input = page.getByTestId("logo-uploader-input");
  await input.setInputFiles({ name: "reject.png", mimeType: "image/png", buffer: await png(300, 100) });
  await expect(page.getByTestId("logo-uploader-preview")).toBeVisible();
  await page.getByTestId("logo-uploader-save").click();
  await expect(page.getByTestId("logo-uploader-error")).toContainText("Yalnız PNG, JPG veya WEBP"); // sunucu 400 INVALID_IMAGE

  await page.getByRole("button", { name: "Vazgeç" }).click();
  await input.setInputFiles({ name: "firma.png", mimeType: "image/png", buffer: await png(300, 100) });
  await expect(page.getByTestId("logo-uploader-preview").getByRole("img", { name: "Yüklenecek logonun önizlemesi" })).toBeVisible();
  expect(await axeScan(page, "#icerik")).toEqual([]);
  await page.getByTestId("logo-uploader-save").click();
  await expect(page.getByTestId("toast").last()).toContainText("Logo kaydedildi");
  await expect(page.getByTestId("header-logo")).toHaveAttribute("data-logo", "custom");
  await expect(page.getByTestId("header-logo").getByRole("img", { name: "Demo Firma logosu" })).toBeVisible();

  await page.getByTestId("logo-uploader-remove").click();
  const dlg = page.getByTestId("logo-remove-dialog");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await dlg.getByTestId("logo-remove-confirm").click();
  await expect(page.getByTestId("toast").last()).toContainText("sistem logosu");
  await expect(page.getByTestId("header-logo")).toHaveAttribute("data-logo", "system");
});

test("AC-82: login her zaman logo gösterir — ?tenant=<slug> firmanın logosu, yoksa / bilinmiyorsa sistem logosu", async ({ page }) => {
  await page.goto("/login?tenant=demo");
  await expect(page.getByTestId("login-logo")).toHaveAttribute("data-logo", "custom");
  await expect(page.getByRole("img", { name: "Demo Firma logosu" })).toBeVisible();
  await page.goto("/login?tenant=yok-boyle-firma");
  await expect(page.getByTestId("login-logo")).toHaveAttribute("data-logo", "system");
  await page.goto("/login?tenant=%3Cscript%3E"); // biçim dışı slug iletilmez
  await expect(page.getByRole("img", { name: "Nokta Bilişim" })).toBeVisible();
});

const DIMS = "Resim boyutları uygun değil";
test("Sayfa testi bulgusu: boyut/oran reddi doğru mesajla — logo ve avatar 3000×40 / 8×8 (ön kontrol) + sunucu mesajı", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "br");
  await page.goto("/settings/logo");
  await expect(page.getByTestId("logo-uploader")).toHaveAttribute("data-ready", "true");
  const logoIn = page.getByTestId("logo-uploader-input");
  const logoErr = page.getByTestId("logo-uploader-error");
  for (const [w, h] of [
    [3000, 40],
    [8, 8],
  ] as const) {
    await logoIn.setInputFiles({ name: `l-${w}x${h}.png`, mimeType: "image/png", buffer: await png(w, h) });
    await expect(logoErr).toContainText(DIMS);
    await expect(logoErr).not.toContainText("Yalnız PNG");
    await expect(page.getByTestId("logo-uploader-preview")).toHaveCount(0); // önizlemeye geçilmez
  }
  // Ön kontrolü geçen resmin sunucu reddi: sunucunun mesajı gösterilir (sabit tür metni değil)
  await logoIn.setInputFiles({ name: "srvdims.png", mimeType: "image/png", buffer: await png(300, 100) });
  await expect(logoErr).toHaveCount(0);
  const put = page.waitForResponse((r) => r.url().endsWith("/api/v1/settings/logo") && r.request().method() === "POST");
  await page.getByTestId("logo-uploader-save").click();
  expect((await put).status()).toBe(400);
  await expect(logoErr).toContainText(DIMS);

  await page.goto("/account");
  await expect(page.getByTestId("avatar-uploader")).toHaveAttribute("data-ready", "true");
  const avIn = page.getByTestId("avatar-uploader-input");
  for (const [w, h] of [
    [3000, 40],
    [8, 8],
    [500, 100],
  ] as const) {
    await avIn.setInputFiles({ name: `a-${w}x${h}.png`, mimeType: "image/png", buffer: await png(w, h) });
    await expect(page.getByTestId("avatar-uploader-error")).toContainText(DIMS);
    await expect(page.getByTestId("avatar-crop-dialog")).toHaveJSProperty("open", false);
  }
});

// playwright.config.ts webServer EDGE_PROXY_SECRET ile aynı (yalnız e2e; Caddy'nin her isteğe yazdığı X-Edge-Auth taklidi)
const EDGE = "e2e-only-edge-secret-not-for-production-000";
const rndIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join(".")}`;
async function loginLogo(p: Page, headers: Record<string, string>) {
  const html = await (await p.request.get("/login?tenant=demo", { headers })).text();
  return /data-testid="login-logo" data-logo="(\w+)"/.exec(html)?.[1];
}

test("B-P12-1: login marka çağrısı istemci IP'sini iletir — bir ziyaretçinin limiti aşması başkasının logosunu bozmaz", async ({
  page,
}, info) => {
  desktopOnly(info.project.name);
  const attacker = rndIp();
  const other = rndIp();
  const viaEdge = (ip: string) => ({ "x-edge-auth": EDGE, "x-forwarded-for": ip });
  expect(await loginLogo(page, viaEdge(attacker))).toBe("custom");
  // Sahte API sunucu gibi IP başına 60/dk sayar (anahtar = web'in ilettiği XFF) → 61. istek 429 → yedek logo
  for (let i = 0; i < 59; i++) await page.request.get("/login?tenant=demo", { headers: viaEdge(attacker) });
  expect(await loginLogo(page, viaEdge(attacker))).toBe("system");
  // Başka ziyaretçinin kovası ayrı: firma logosu görünmeye devam eder
  expect(await loginLogo(page, viaEdge(other))).toBe("custom");
  // X-Edge-Auth yoksa/yanlışsa gelen XFF iletilmez (taklit edilen IP limite yazılmaz, S-P2-1)
  expect(await loginLogo(page, { "x-forwarded-for": attacker })).toBe("custom");
  expect(await loginLogo(page, { "x-edge-auth": "yanlis", "x-forwarded-for": attacker })).toBe("custom");
});

test("AC-81 (QA-2): müşteri karşılama ekranı firmanın logosunu gösterir; logo yoksa sistem logosu", async ({ page }) => {
  await page.goto(`/session/${"L".repeat(43)}`);
  const logo = page.getByTestId("guest-logo");
  await expect(logo).toHaveAttribute("data-logo", "custom");
  const img = logo.getByRole("img", { name: "Demo Firma logosu" });
  await expect(img).toHaveAttribute("src", "/api/v1/files/logo/demo/public-demo-logo-0001.png");
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true); // dosya gerçekten yüklendi
  await page.goto(`/session/${"A".repeat(43)}`);
  await expect(page.getByTestId("guest-logo")).toHaveAttribute("data-logo", "system");
  await expect(page.getByTestId("guest-logo").getByRole("img", { name: "Nokta Bilişim" })).toBeVisible();
});

test("AC-82: Super Admin sistem logosunu değiştirir (Sistem ayarları sekmesi)", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "brsa");
  await page.goto("/admin/settings/system-logo");
  await expect(page.getByTestId("system-tabs").getByRole("link", { name: "Sistem logosu" })).toHaveAttribute("aria-current", "page");
  const up = page.getByTestId("system-logo-uploader");
  await expect(up).toHaveAttribute("data-custom", "false");
  await expect(up).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("system-logo-uploader-remove")).toHaveCount(0); // varsayılan logoda kaldırma yok (P15 AC-233)
  await page
    .getByTestId("system-logo-uploader-input")
    .setInputFiles({ name: "sistem.png", mimeType: "image/png", buffer: await png(300, 100) });
  await page.getByTestId("system-logo-uploader-save").click();
  await expect(page.getByTestId("toast").last()).toContainText("Sistem logosu kaydedildi");
  await expect(up).toHaveAttribute("data-custom", "true");
});

test("AC-233: Super Admin sistem logosunu kaldırır (onay → varsayılan Nokta logosu, login de döner)", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "brsa");
  await page.goto("/admin/settings/system-logo");
  const up = page.getByTestId("system-logo-uploader");
  await expect(up).toHaveAttribute("data-ready", "true");
  await page
    .getByTestId("system-logo-uploader-input")
    .setInputFiles({ name: "sistem.png", mimeType: "image/png", buffer: await png(300, 100) });
  await page.getByTestId("system-logo-uploader-save").click();
  await expect(up).toHaveAttribute("data-custom", "true");
  // Kaldır → onay (alertdialog, ilk odak Vazgeç); Vazgeç değişiklik yapmaz
  await page.getByTestId("system-logo-uploader-remove").click();
  const dlg = page.getByTestId("logo-remove-dialog");
  await expect(dlg).toHaveAttribute("role", "alertdialog");
  await expect(dlg).toContainText("Sistem logosu kaldırılsın mı?");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(up).toHaveAttribute("data-custom", "true");
  await page.getByTestId("system-logo-uploader-remove").click();
  await page.getByTestId("logo-remove-confirm").click();
  await expect(page.getByTestId("toast").last()).toContainText("varsayılan Nokta logosu");
  await expect(up).toHaveAttribute("data-custom", "false");
  await expect(page.getByTestId("system-logo-uploader-none")).toBeVisible();
  await expect(page.getByTestId("system-logo-uploader-remove")).toHaveCount(0);
  // Herkese açık marka ucu da varsayılana döndü (login aynı uçtan okur)
  const pub = (await (await page.request.get("/api/v1/public/branding")).json()) as { logoUrl: string };
  expect(pub.logoUrl).toBe(DEFAULT_LOGO_URL);
});

async function scanBothThemes(browser: Browser, scenario: string, path: string, width: number) {
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
    await signIn(ctx, scenario);
    const p = await ctx.newPage();
    await p.goto(path);
    await expect(p.locator("h1")).toBeVisible();
    await noHorizontalOverflow(p);
    expect(await axeScan(p), `${path} ${scheme} ${width}`).toEqual([]);
    if (path === "/account") {
      await openMenu(p);
      await noHorizontalOverflow(p);
      expect(await axeScan(p, '[data-testid="user-menu"]'), `menü ${scheme} ${width}`).toEqual([]);
    }
    await ctx.close();
  }
}

for (const width of [1280, 390]) {
  test(`erişilebilirlik (axe) iki temada + taşma yok @ ${width}px: hesabım, logo, sistem logosu`, async ({ browser }, info) => {
    desktopOnly(info.project.name);
    await scanBothThemes(browser, "br", "/account", width);
    await scanBothThemes(browser, "br", "/settings/logo", width);
    await scanBothThemes(browser, "brsa", "/admin/settings/system-logo", width);
  });
}

test("AC-87: menü, sekme ve hesap menüsü bağlantılarının hepsinde ikon var", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "br");
  await page.goto("/settings/logo");
  await openMenu(page);
  const items = page.locator(
    'nav[aria-label="Ana menü"] a, [data-testid="settings-tabs"] a, [data-testid="user-menu"] [role="group"] a, [data-testid="user-menu"] [role="group"] button',
  );
  const n = await items.count();
  expect(n).toBeGreaterThan(8);
  for (let i = 0; i < n; i++) await expect(items.nth(i).locator("svg"), await items.nth(i).innerText()).toHaveCount(1);
});

test("AC-87: prefers-reduced-motion açıkken hareket animasyonu yok, yalnız opaklık", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(context, "br");
  await page.goto("/account");
  const btn = page.getByTestId("acc-logout-all");
  expect(await btn.evaluate((e) => getComputedStyle(e).transitionProperty)).toBe("opacity");
  const spin = await page.evaluate(() => {
    const el = document.createElement("span");
    el.className = "animate-spin";
    document.body.append(el);
    const name = getComputedStyle(el).animationName;
    el.remove();
    return name;
  });
  expect(spin).toBe("none");
  // Hareket azaltma kapalıyken aynı düğme transform geçişi taşır (kural yalnız medya sorgusunda)
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await btn.evaluate((e) => getComputedStyle(e).transitionProperty)).toContain("transform");
});

test("AC-229: file.type boş gelen .webp istemcide reddedilmez; sunucu magic bytes ile kabul eder", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "br");
  await page.goto("/settings/logo");
  await expect(page.getByTestId("logo-uploader")).toHaveAttribute("data-ready", "true");
  const input = page.getByTestId("logo-uploader-input");
  expect(await input.getAttribute("accept")).toContain(".webp"); // MIME eşlemesi olmayan sistemde seçicide görünür
  const webp = await sharp({ create: { width: 300, height: 100, channels: 3, background: { r: 10, g: 108, b: 176 } } })
    .webp()
    .toBuffer();
  // Playwright `setInputFiles` boş `mimeType`'ı dosya adından doldurur → MIME eşlemesi olmayan sistemi taklit için dosya
  // tarayıcıda `type: ""` ile oluşturulur. Yükleyici okuduktan sonra input'u boşalttığından tür, `change` anında yakalanır.
  const picked = await input.evaluate((el: HTMLInputElement, b64: string) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "firma.webp", { type: "" }));
    let type: string | undefined;
    el.addEventListener("change", () => (type = el.files?.[0]?.type), { once: true });
    el.files = dt.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return type;
  }, webp.toString("base64"));
  expect(picked).toBe("");
  await expect(page.getByTestId("logo-uploader-error")).toHaveCount(0);
  await expect(page.getByTestId("logo-uploader-preview")).toBeVisible();
  await page.getByTestId("logo-uploader-save").click();
  await expect(page.getByTestId("toast").last()).toContainText("Logo kaydedildi");
});
