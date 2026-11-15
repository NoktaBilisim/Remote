import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SESSION_COOKIE } from "@remote/contracts/api/auth";

const sessionCookie = (value: string) => ({ name: SESSION_COOKIE, value, domain: "localhost", path: "/", secure: true });

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  // Beklenen API hata yanıtları (401/423/500 …) tarayıcının ağ kaydıdır, uygulama hatası değil
  const expectedNet = /^Failed to load resource: the server responded with a status of (400|401|404|423|500)/;
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !expectedNet.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors, "konsolda hata/uyarı olmamalı").toEqual([]));

/**
 * Kararlı axe taraması: hareket kapalı (geçiş/pulse animasyonu ara renk üretmez), işaretçi
 * öğelerin üzerinden çekilir (tıklama sonrası kalan :hover yeni sayfadaki öğeyi boyamasın),
 * fontlar yüklenmiş ve iki karede düzen oturmuş olur.
 */
async function axeScan(page: Page) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

async function login(page: Page, user: string, pass: string) {
  await page.goto("/login");
  await page.getByLabel("E-posta veya kullanıcı adı").fill(user);
  await page.getByLabel("Şifre", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

test("AC-64: başarılı giriş panele götürür, kullanıcı adı görünür", async ({ page }) => {
  await login(page, "teknisyen@ornek.com", "DogruSifre123!");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Ana sayfa" })).toBeVisible();
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page).toHaveTitle(/Ana sayfa · Nokta Uzaktan Destek/);
  await expect(page.getByRole("button", { name: /Çıkış yap \(Ayşe Teknisyen\)/ })).toBeVisible();
});

test("AC-64: boş form alan bazlı hata gösterir", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByText("Bu alan zorunludur.")).toHaveCount(2);
  await expect(page.getByLabel("E-posta veya kullanıcı adı")).toBeFocused();
});

test("AC-64: hatalı şifre genel hata mesajı verir", async ({ page }) => {
  await login(page, "teknisyen@ornek.com", "YanlisSifre000");
  await expect(page.getByTestId("form-error")).toContainText("E-posta/kullanıcı adı veya şifre hatalı.");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Giriş yap" })).toBeEnabled();
});

test("AC-65: kilitli hesap (423) kilit mesajını gösterir", async ({ page }) => {
  await login(page, "kilitli@ornek.com", "herhangiSifre1");
  // T-1: Retry-After 878 sn → 15 dakika (yukarı yuvarlanır)
  await expect(page.getByTestId("form-error")).toContainText("15 dakika sonra tekrar deneyin");
});

test("sunucu hatası (500) hata kodu ile gösterilir", async ({ page }) => {
  await login(page, "hata500@ornek.com", "herhangiSifre1");
  await expect(page.getByTestId("form-error")).toContainText("Hata kodu");
});

test("AC-66: ilk girişte şifre değişimi zorunlu, sonra panel açılır", async ({ page }) => {
  await login(page, "yeni@ornek.com", "GeciciSifre123!");
  await expect(page).toHaveURL("/change-password");
  await page.goto("/");
  await expect(page).toHaveURL("/change-password");
  await page.getByLabel("Mevcut şifre").fill("GeciciSifre123!");
  await page.getByLabel("Yeni şifre", { exact: true }).fill("kisa");
  await page.getByRole("button", { name: "Şifreyi değiştir" }).click();
  await expect(page.getByText("Şifre en az 12 karakter olmalıdır.")).toBeVisible();
  await page.getByLabel("Yeni şifre", { exact: true }).fill("YeniUzunParola2026");
  await page.getByLabel("Yeni şifre (tekrar)").fill("YeniUzunParola2026");
  await page.getByRole("button", { name: "Şifreyi değiştir" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Ana sayfa" })).toBeVisible();
});

test("AC-66: yanlış mevcut şifre alan hatası verir", async ({ page }) => {
  await login(page, "yeni@ornek.com", "GeciciSifre123!");
  await expect(page).toHaveURL("/change-password");
  await page.getByLabel("Mevcut şifre").fill("YanlisMevcut999");
  await page.getByLabel("Yeni şifre", { exact: true }).fill("YeniUzunParola2026");
  await page.getByLabel("Yeni şifre (tekrar)").fill("YeniUzunParola2026");
  await page.getByRole("button", { name: "Şifreyi değiştir" }).click();
  await expect(page.getByText("Mevcut şifre hatalı.")).toBeVisible();
});

test("korumalı sayfa oturumsuz /login'e yönlendirir (next korunur)", async ({ page }) => {
  await page.goto("/sessions?x=1");
  await expect(page).toHaveURL("/login?next=%2Fsessions");
  await page.goto("/");
  await expect(page).toHaveURL("/login");
});

test("S1-4: /session/ önekli yol herkese açık, next'e yazılmaz (biçimsiz token → 404)", async ({ page }) => {
  const res = await page.goto("/session/gizli-token");
  expect(res?.status()).toBe(404);
  await expect(page).toHaveURL("/session/gizli-token");
  // P2: müşteri karşılama sayfası var; biçimsiz token müşteriye özel 404 ekranı gösterir
  await expect(page.getByRole("heading", { name: "Bağlantı geçersiz" })).toBeVisible();
});

test("S1-1: login next= dış adrese yönlendirmez", async ({ page }) => {
  await page.goto("/login?next=%2F%09%2Fevil.example");
  await page.getByLabel("E-posta veya kullanıcı adı").fill("teknisyen@ornek.com");
  await page.getByLabel("Şifre", { exact: true }).fill("DogruSifre123!");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL("http://localhost:3217/");
});

test("T-3: oturum açıkken /login panele yönlendirir", async ({ page }) => {
  await login(page, "teknisyen@ornek.com", "DogruSifre123!");
  await expect(page).toHaveURL("/");
  await page.goto("/login");
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("empty-state")).toBeVisible();
});

test("T-3: geçersiz çerezle /login formu gösterir (döngü yok)", async ({ page, context }) => {
  await context.addCookies([sessionCookie("s-gecersiz")]);
  await page.goto("/login");
  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("button", { name: "Giriş yap" })).toBeVisible();
});

test("geçersiz oturum çerezi login'e 'oturum sona erdi' ile döner", async ({ page, context }) => {
  await context.addCookies([sessionCookie("s-gecersiz")]);
  await page.goto("/");
  await expect(page).toHaveURL("/login?reason=expired");
  await expect(page.getByRole("status")).toContainText("Oturumunuz sona erdi");
});

test("API erişilemezse panel hata durumu + Tekrar dene gösterir", async ({ page, context }) => {
  await context.addCookies([sessionCookie("s-broken")]);
  await page.goto("/");
  await expect(page.getByTestId("load-error")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
});

test("AC-65: çıkış (CSRF başlıklı) login'e döner, panel kapanır", async ({ page }) => {
  await login(page, "teknisyen@ornek.com", "DogruSifre123!");
  await expect(page).toHaveURL("/");
  await page.getByRole("button", { name: /Çıkış yap/ }).click();
  await expect(page).toHaveURL("/login?reason=logout");
  await expect(page.getByText("Çıkış yaptınız.")).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL("/login");
});

test("AC-82, AC-86: login'de sistem logosu ve favicon linkleri", async ({ page, request }) => {
  await page.goto("/login");
  await expect(page.getByRole("img", { name: "Nokta Bilişim" })).toBeVisible();
  await expect(page.locator('link[rel="icon"][href^="/favicon.ico"]')).toHaveCount(1);
  await expect(page.locator('link[rel="icon"][href^="/favicon-32x32.png"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  for (const f of ["/favicon.ico", "/favicon-32x32.png", "/apple-touch-icon.png"]) expect((await request.get(f)).status()).toBe(200);
});

test("AC-126 (web): CSP nonce'lu, unsafe-inline yok, X-Powered-By yok", async ({ request }) => {
  const res = await request.get("/login", { headers: { "x-forwarded-proto": "https" } });
  const h = res.headers();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(h["content-security-policy"]).toContain("connect-src 'self' wss://localhost:3217");
  expect(h["content-security-policy"]).toContain("upgrade-insecure-requests");
  expect(h["content-security-policy"]).not.toContain("unsafe-inline");
  expect(h["cross-origin-resource-policy"]).toBe("same-origin");
  expect(h["x-powered-by"]).toBeUndefined();
});

for (const scheme of ["light", "dark"] as const) {
  test(`erişilebilirlik (axe): login ${scheme} tema`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto("/login");
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page.getByText("Bu alan zorunludur.")).toHaveCount(2);
    expect(await axeScan(page)).toEqual([]);
  });
}

test("erişilebilirlik (axe): panel koyu tema + yatay taşma yok", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await login(page, "teknisyen@ornek.com", "DogruSifre123!");
  await expect(page).toHaveURL("/");
  // URL değişimi yetmez: panel içeriği (iskelet değil) ve üst menü çizilmiş olmalı
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByRole("button", { name: /Çıkış yap/ })).toBeEnabled();
  // Kök neden (yakalanan hata "document-title: html"): istemci tarafı geçişte Next metadata'yı
  // içerikten sonra akıtır; <title> kısa süre yoktur. Başlık yerleşene kadar beklenir.
  await expect(page).toHaveTitle(/Ana sayfa/);
  expect(await axeScan(page)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
