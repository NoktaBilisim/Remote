import { PORTAL_CSRF_COOKIE, PORTAL_SESSION_COOKIE, PORTAL_TENANT_COOKIE } from "@remote/contracts/api/portal";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { axeScan, desktopOnly, guardConsole, noHorizontalOverflow, sessionCookies } from "./helpers";

// P21 K5/K6 (AC-262, AC-287; mimari-p21 §6, §10). Sahte API: e2e/mock-p21.mjs (+ mock-p19 /ws/request).
guardConsole();
const MOCK = "http://127.0.0.1:4217";
const ONLY = "paylaşılan sahte durum: tek proje";
const A32 = "abcdefghijklmnopqrstuvwxyz234567";
const suffix = () => Array.from({ length: 8 }, () => A32[Math.floor(Math.random() * 32)]).join("");
const IDS = {
  CUSTOMER: "01JP21C0ST000000000000000A",
  OWN_RQ: "01JP21RQ000000000000000001",
  OWN_SS: "01JP21SS000000000000000001",
  OTHER_RQ: "01JP21RQ00000000000000000B",
  OTHER_SS: "01JP21SS00000000000000000B",
};

/** Portal oturumu (mock-p21 `p-<senaryo>-<son ek>`) + CSRF + firma kısa adı çerezi. Çerez değerini döner. */
async function portalIn(context: BrowserContext, scen = "ok") {
  const token = `p-${scen}-${suffix()}`;
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
  await context.addCookies([
    { ...base, name: PORTAL_SESSION_COOKIE, value: token, httpOnly: true },
    { ...base, name: PORTAL_CSRF_COOKIE, value: "portal-csrf-test" },
    { domain: "localhost", path: "/", name: PORTAL_TENANT_COOKIE, value: "acme", sameSite: "Lax" },
  ]);
  return token;
}

async function login(page: Page, email: string, password: string) {
  await page.getByTestId("portal-email").fill(email);
  await page.getByTestId("portal-password").fill(password);
  await page.getByTestId("portal-login-submit").click();
}

test.describe("AC-262 giriş", () => {
  test("slugsuz giriş adresi → 'bağlantıyı isteyin', form yok; şifremi unuttum bağlantısız metin", async ({ page }) => {
    await page.goto("/portal/login");
    await expect(page.getByTestId("portal-no-tenant")).toContainText("destek sağlayıcınızdan isteyin");
    await expect(page.getByTestId("portal-email")).toHaveCount(0);
    await page.goto("/portal/login?tenant=acme");
    await expect(page).toHaveTitle(/Müşteri portalı/);
    await expect(page.getByTestId("portal-forgot")).toContainText("Destek sağlayıcınıza başvurun");
    await expect(page.getByTestId("portal-forgot").locator("a")).toHaveCount(0);
  });

  test("hatalı şifre / kilit / geçici şifre süresi doldu → sunucu mesajı formda", async ({ page }) => {
    await page.goto("/portal/login?tenant=acme");
    await login(page, "ali@acme.com", "YanlisSifre1234");
    await expect(page.getByTestId("form-error")).toContainText("E-posta veya şifre hatalı.");
    await login(page, "suresi@acme.com", "GeciciSifre123!");
    await expect(page.getByTestId("form-error")).toContainText("Geçici şifrenin süresi doldu (72 saat)");
    await login(page, "kilitli@acme.com", "Herhangi12345");
    await expect(page.getByTestId("form-error")).toContainText("15 dakika");
  });

  test("TOTP: MFA_REQUIRED → aynı formda kod alanı; hatalı kod mesajı; doğru kod → portal", async ({ page }) => {
    await page.goto("/portal/login?tenant=acme");
    await login(page, "mfa@acme.com", "DogruSifre123!");
    await expect(page.getByTestId("portal-code-needed")).toBeVisible();
    await expect(page.getByTestId("portal-code")).toBeFocused();
    await page.getByTestId("portal-code").fill("000000");
    await page.getByTestId("portal-login-submit").click();
    await expect(page.getByTestId("form-error")).toContainText("Kod hatalı.");
    await page.getByTestId("portal-code").fill("123456");
    await page.getByTestId("portal-login-submit").click();
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByTestId("portal-customer")).toHaveText("Acme Lojistik A.Ş.");
  });

  test("ilk girişte zorunlu şifre değişimi; portal sayfaları değişimden önce açılmaz", async ({ page }) => {
    await page.goto("/portal/login?tenant=acme");
    await login(page, "yeni@acme.com", "GeciciSifre123!");
    await expect(page).toHaveURL(/\/portal\/change-password$/);
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/portal\/change-password$/);
    await page.getByLabel("Mevcut şifre").fill("GeciciSifre123!");
    await page.getByLabel("Yeni şifre", { exact: true }).fill("CokGizliYeniSifre42");
    await page.getByLabel("Yeni şifre (tekrar)").fill("CokGizliYeniSifre42");
    await page.getByTestId("portal-pw-submit").click();
    await expect(page).toHaveURL(/\/portal$/);
  });

  test("oturumsuz /portal → firmanın giriş adresi (rs_portal_tenant); panel çerezi portalı açmaz", async ({ page, context }) => {
    await sessionCookies(context, "s-ok");
    await context.addCookies([{ domain: "localhost", path: "/", name: PORTAL_TENANT_COOKIE, value: "acme" }]);
    await page.goto("/portal/requests/" + IDS.OWN_RQ);
    await expect(page).toHaveURL(/\/portal\/login\?tenant=acme$/);
  });

  test("çıkış → firmanın giriş adresi (reason=logout)", async ({ page, context }) => {
    await portalIn(context);
    await page.goto("/portal");
    await page.getByTestId("portal-user-menu").locator("summary").click();
    await page.getByTestId("portal-logout").click();
    await expect(page).toHaveURL(/\/portal\/login\?tenant=acme&reason=logout$/);
    await expect(page.getByText("Çıkış yaptınız.")).toBeVisible();
  });
});

test.describe("AC-262 geçmiş (meta) ve IDOR", () => {
  test("talepler sayfalı, oturumlar sekmesi, detay; firma dosyası bağlantısı", async ({ page, context }) => {
    const token = await portalIn(context);
    await page.goto("/portal");
    await expect(page).toHaveTitle(/Destek portalı/);
    const sfx = token.slice(-8);
    await expect(page.getByTestId("portal-download")).toHaveAttribute("href", new RegExp(`request-download\\?ref=webformz${sfx}$`));
    await expect(page.getByTestId("portal-file-name")).toHaveText(`NoktaDestek-Acme-webformz${sfx}.exe`);
    await expect(page.getByTestId("portal-tab-requests")).toHaveText(/Talepler \(30\)/);
    await expect(page.getByTestId("portal-requests-count")).toContainText("30");
    const rows = page.locator('[data-testid="portal-rq-row"], [data-testid="portal-rq-card"]').filter({ visible: true });
    await expect(rows).toHaveCount(25);
    await page.getByRole("link", { name: /Sonraki sayfa/ }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(rows).toHaveCount(5);
    await page.goto(`/portal/requests/${IDS.OWN_RQ}`);
    await expect(page.getByTestId("portal-rq-facts")).toContainText("Web");
    await page.getByTestId("portal-rq-session").click();
    await expect(page.getByTestId("portal-ss-facts")).toContainText("Selin Teknik");
    await expect(page.getByTestId("portal-ss-facts")).toContainText("ITSM-1042");
    await page.goto("/portal?tab=sessions");
    await expect(page.getByTestId("portal-tab-sessions")).toHaveAttribute("aria-current", "page");
    await expect(page.locator('[data-testid="portal-ss-row"], [data-testid="portal-ss-card"]').filter({ visible: true })).toHaveCount(2);
  });

  test("IDOR görünümü: başka müşterinin talep/oturum kimliği = yok (aynı 404 ekranı)", async ({ page, context }) => {
    await portalIn(context);
    for (const p of [`/portal/requests/${IDS.OTHER_RQ}`, `/portal/sessions/${IDS.OTHER_SS}`, "/portal/requests/bozuk-id"]) {
      await page.goto(p);
      await expect(page.getByTestId("portal-not-found")).toContainText("Kayıt bulunamadı");
      await expect(page.getByTestId("portal-back")).toHaveAttribute("href", "/portal");
    }
    // sunucu sözleşmesi: bilinmeyen sorgu parametresi (customerId) reddedilir
    const r = await page.request.get(`/api/v1/portal/requests?customerId=${IDS.CUSTOMER}`);
    expect([400, 404]).toContain(r.status());
  });

  test("boş durum (yeni talep eylemi) ve kısmi durum (oturumlar yüklenemedi, talepler dolu)", async ({ page, context }) => {
    await portalIn(context, "empty");
    await page.goto("/portal");
    await expect(page.getByTestId("portal-requests-empty")).toContainText("Henüz talep yok");
    await expect(page.getByTestId("portal-requests-empty").getByRole("link", { name: /Yeni destek talebi/ })).toHaveAttribute("href", "/portal/new-request");
    await context.clearCookies();
    await portalIn(context, "partial");
    await page.goto("/portal");
    await expect(page.getByTestId("portal-tab-sessions")).toContainText("yüklenemedi");
    await expect(page.getByTestId("portal-requests")).toBeVisible();
    await page.getByTestId("portal-tab-sessions").click();
    await expect(page.getByTestId("load-error")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
  });
});

test.describe("AC-262 hesap ve yeni talep", () => {
  test("hesabım: tema kalıcı (PATCH), 2FA aç → kapat, şifre değişimi toast", async ({ page, context }, info) => {
    desktopOnly(info.project.name, ONLY);
    await portalIn(context);
    await page.goto("/portal/account");
    await expect(page.getByTestId("portal-acc-facts")).toContainText("ali@acme.com");
    await page.getByTestId("portal-theme").locator('[data-theme-option="DARK"]').click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByTestId("portal-mfa-on").click();
    await expect(page.getByTestId("portal-mfa-qr")).toBeVisible();
    await page.getByTestId("portal-mfa-code").fill("111111");
    await page.getByTestId("portal-mfa-enable").click();
    await expect(page.getByText("Kod hatalı.")).toBeVisible();
    await page.getByTestId("portal-mfa-code").fill("123456");
    await page.getByTestId("portal-mfa-enable").click();
    await expect(page.getByTestId("portal-mfa")).toHaveAttribute("data-enabled", "true");
    await page.getByTestId("portal-mfa-off").click();
    await page.getByLabel("Mevcut şifre").last().fill("DogruSifre123!");
    await page.getByTestId("portal-mfa-code").fill("123456");
    await page.getByTestId("portal-mfa-disable-confirm").click();
    await expect(page.getByTestId("portal-mfa")).toHaveAttribute("data-enabled", "false");
    const pw = page.locator('form[aria-label="Şifrenizi değiştirin"]');
    await pw.getByLabel("Mevcut şifre").fill("DogruSifre123!");
    await pw.getByLabel("Yeni şifre", { exact: true }).fill("CokGizliYeniSifre42");
    await pw.getByLabel("Yeni şifre (tekrar)").fill("CokGizliYeniSifre42");
    await page.getByTestId("portal-pw-submit").click();
    await expect(page.getByTestId("toast").filter({ hasText: "Şifreniz değiştirildi." })).toBeVisible();
  });

  test("yeni talep: P19 formu portal kaynağıyla — ad/e-posta dolu, gövdede ref/token yok, bekleme odası, kabulde firma dosyası", async ({ page, context }, info) => {
    desktopOnly(info.project.name, ONLY);
    const token = await portalIn(context);
    const ref = `webformz${token.slice(-8)}`;
    const res = await page.goto("/portal/new-request");
    // S-P21-12 sapması: ekran paylaşımı bu sayfada başlar → display-capture=(self); portalın geri kalanı ()
    expect(res?.headers()["permissions-policy"]).toContain("display-capture=(self)");
    expect(res?.headers()["permissions-policy"]).toContain("microphone=()");
    await expect(page.getByTestId("wr-form")).toBeVisible();
    await expect(page.getByTestId("wr-name")).toHaveValue("Ali Müşteri");
    await expect(page.getByTestId("wr-email")).toHaveValue("ali@acme.com");
    await expect(page.getByTestId("wr-submit")).toBeEnabled();
    await page.getByTestId("wr-phone").fill("0532 111 22 33");
    await page.getByTestId("wr-desc").fill("Yazıcı çalışmıyor");
    await page.getByTestId("wr-consent").check();
    await page.getByTestId("wr-submit").click();
    await expect(page.getByTestId("wr-waiting")).toBeVisible();
    const last = ((await (await page.request.get(`${MOCK}/__e2e/p21/last/${token}`)).json()) as { last: Record<string, unknown> }).last;
    for (const k of ["ref", "formToken", "website", "customerId"]) expect(last).not.toHaveProperty(k);
    expect(last.customerName).toBe("Ali Müşteri");
    await page.request.get(`${MOCK}/__e2e/p19/accept/${ref}`);
    await expect(page.getByTestId("wr-accepted")).toContainText("Selin Teknik");
    await expect(page.getByTestId("wr-download")).toHaveAttribute("href", new RegExp(`request-download\\?ref=${ref}$`));
    const home = await page.request.get("/portal");
    expect(home.headers()["permissions-policy"]).toContain("display-capture=()");
    // Gerçek yol: /portal'dan tıklayarak gelinir → belge yeniden yüklenmeli, ekran yakalama izinli olmalı
    await page.goto("/portal");
    expect(await page.evaluate(() => (document as unknown as { featurePolicy: { allowsFeature: (f: string) => boolean } }).featurePolicy.allowsFeature("display-capture"))).toBe(false);
    await page.getByTestId("portal-new-request").click();
    await expect(page).toHaveURL(/\/portal\/new-request$/);
    await expect(page.getByTestId("wr-accepted").or(page.getByTestId("wr-waiting")).or(page.getByTestId("wr-form")).first()).toBeVisible();
    expect(await page.evaluate(() => (document as unknown as { featurePolicy: { allowsFeature: (f: string) => boolean } }).featurePolicy.allowsFeature("display-capture"))).toBe(true);
  });
});

async function scan(browser: Browser, path: string, ready: string, width: number, setup: (c: BrowserContext) => Promise<unknown>) {
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
    await setup(ctx);
    const p = await ctx.newPage();
    await p.goto(path);
    await expect(p.getByTestId(ready).first()).toBeVisible();
    await noHorizontalOverflow(p);
    expect(await axeScan(p), `${path} ${scheme} ${width}`).toEqual([]);
    await ctx.close();
  }
}

test("AC-287: portal ekranları iki temada axe 0, 390 px taşma yok", async ({ browser }, info) => {
  desktopOnly(info.project.name, ONLY);
  test.setTimeout(180_000);
  const none = async () => undefined;
  await scan(browser, "/portal/login?tenant=acme", "portal-login-submit", 390, none);
  await scan(browser, "/portal/login", "portal-no-tenant", 390, none);
  for (const w of [390, 1280]) {
    await scan(browser, "/portal", "portal-download", w, (c) => portalIn(c));
    await scan(browser, "/portal?tab=sessions", "portal-tabs", w, (c) => portalIn(c));
  }
  await scan(browser, "/portal", "portal-requests-empty", 390, (c) => portalIn(c, "empty"));
  await scan(browser, `/portal/requests/${IDS.OWN_RQ}`, "portal-rq-facts", 390, (c) => portalIn(c));
  await scan(browser, `/portal/sessions/${IDS.OWN_SS}`, "portal-ss-facts", 390, (c) => portalIn(c));
  await scan(browser, `/portal/sessions/${IDS.OTHER_SS}`, "portal-not-found", 390, (c) => portalIn(c));
  await scan(browser, "/portal/account", "portal-mfa", 390, (c) => portalIn(c));
  await scan(browser, "/portal/new-request", "wr-form", 390, (c) => portalIn(c));
  await scan(browser, "/portal/change-password", "portal-pw-submit", 390, (c) => portalIn(c, "must"));
});

// ------------------------------------------------------------------------------------------- K6 (panel)

const room = () => Math.random().toString(36).slice(2, 10);
const CUSTOMER_URL = `/customers/${IDS.CUSTOMER}`;

test.describe("AC-262 Admin: portal hesapları", () => {
  test("oluştur → geçici şifre bir kez; pasife al (onay + bağlantı notu); etkinleştir; şifre sıfırla; rozetler", async ({ page, context }, info) => {
    desktopOnly(info.project.name, ONLY);
    await sessionCookies(context, `u-p21adm-${room()}`);
    await page.goto(CUSTOMER_URL);
    const sec = page.getByTestId("portal-accounts");
    await expect(sec.getByRole("heading", { name: "Portal hesapları" })).toBeVisible();
    await expect(page.getByTestId("pa-login-url-value")).toHaveText("http://localhost:3217/portal/login?tenant=acme");
    await expect(page.getByTestId("pa-row")).toHaveCount(2);
    await expect(page.getByTestId("pa-badge-mfa")).toHaveCount(1);
    await expect(page.getByTestId("pa-badge-tempExpired")).toContainText("Geçici şifre süresi doldu");
    // oluştur: alan hataları → çakışma → başarı
    await page.getByTestId("pa-create").click();
    await page.getByTestId("pa-create-submit").click();
    await expect(page.getByTestId("pa-create-dialog")).toContainText("Bu alan zorunludur.");
    await page.getByTestId("pa-f-name").fill("Veli Yeni");
    await page.getByTestId("pa-f-email").fill("ali@acme.com");
    await page.getByTestId("pa-create-submit").click();
    await expect(page.getByTestId("pa-create-dialog")).toContainText("Bu e-posta adresiyle portal hesabı açılamaz.");
    await page.getByTestId("pa-f-email").fill("Veli@Acme.com");
    await page.getByTestId("pa-create-submit").click();
    await expect(page.getByTestId("pa-temp-password")).toBeVisible();
    await expect(page.getByTestId("temp-password")).toHaveValue("Gecici-Sifre-7Kq2xZ");
    await page.getByTestId("pw-done").click();
    await page.getByTestId("pw-close-anyway").click();
    await expect(page.getByTestId("pa-row")).toHaveCount(3);
    await expect(page.getByText("Gecici-Sifre-7Kq2xZ")).toHaveCount(0);
    // pasife al
    const row = page.getByTestId("pa-row").filter({ hasText: "Veli Yeni" });
    await row.getByTestId("pa-menu").locator("summary").click();
    await row.getByTestId("pa-deactivate").click();
    await expect(page.getByTestId("pa-deact-note")).toContainText("bağlantısını da yenileyin");
    await page.getByTestId("pa-confirm").click();
    await expect(row).toHaveAttribute("data-status", "PASSIVE");
    // etkinleştir
    await row.getByTestId("pa-menu").locator("summary").click();
    await row.getByTestId("pa-reactivate").click();
    await expect(row).toHaveAttribute("data-status", "ACTIVE");
    // şifre sıfırla → yeni geçici şifre
    await row.getByTestId("pa-menu").locator("summary").click();
    await row.getByTestId("pa-reset").click();
    await expect(page.getByTestId("pa-reset-dialog")).toContainText("iki adımlı doğrulama kapatılır");
    await page.getByTestId("pa-confirm").click();
    await expect(page.getByTestId("temp-password")).toHaveValue("Yeni-Gecici-9Lm4");
  });

  test("customers.portal yetkisi yoksa bölüm yok; müşteri pasifse oluşturma kapalı + neden", async ({ page, context }) => {
    await sessionCookies(context, `u-p21ro-${room()}`);
    await page.goto(CUSTOMER_URL);
    await expect(page.getByRole("heading", { name: "Acme Lojistik A.Ş." })).toBeVisible();
    await expect(page.getByTestId("portal-accounts")).toHaveCount(0);
    await context.clearCookies();
    await sessionCookies(context, `u-p21pas-${room()}`);
    await page.goto(CUSTOMER_URL);
    await expect(page.getByTestId("pa-create")).toBeDisabled();
    await expect(page.getByTestId("pa-create-reason")).toContainText("pasif");
  });

  test("AC-287: panel bölümü iki temada axe 0, 390 px taşma yok", async ({ browser }, info) => {
    desktopOnly(info.project.name, ONLY);
    for (const w of [390, 1280]) await scan(browser, CUSTOMER_URL, "pa-list", w, (c) => sessionCookies(c, `u-p21adm-${room()}`));
  });
});
