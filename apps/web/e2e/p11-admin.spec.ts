import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import { axeScan, guardConsole, noHorizontalOverflow } from "./helpers";

// P11 audit log, sistem ayarları (MySQL/TURN) ve aydınlatma metni — panel (AC-76, 77, 78, 124). Sahte API: e2e/mock-audit.mjs
// (u-auadm-* ADMIN tüm yetkiler, u-auview-* USER audit.view + settings.view, u-aunone-* yetkisiz, u-auempty/aubroken durumlar,
// u-ausa-* SUPER_ADMIN).
guardConsole();
const desktopOnly = (name: string) => test.skip(name !== "desktop", "masaüstü akışı");

async function signInAu(context: BrowserContext, scenario: string) {
  const value = `u-${scenario}-${Math.random().toString(36).slice(2)}`;
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
  await context.addCookies([
    { ...base, name: SESSION_COOKIE, value, httpOnly: true },
    { ...base, name: CSRF_COOKIE, value: "csrf-test-token" },
  ]);
}
const rows = (p: Page) => p.locator('[data-testid="audit-row"], [data-testid="audit-card"]').filter({ visible: true });
const nav = (p: Page) => p.getByRole("navigation", { name: "Ana menü" });

test("AC-76 kritik akış: audit listesi → daha fazla yükle → detay (JSON metin olarak) → CSV; düzenle/sil yok", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInAu(context, "auadm");
  await page.goto("/audit");
  await expect(page).toHaveTitle(/Audit log/);
  await expect(nav(page).getByRole("link", { name: "Audit log" })).toHaveAttribute("aria-current", "page");
  await expect(nav(page).getByRole("link", { name: "Sistem ayarları" })).toHaveCount(0); // yalnız Super Admin
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("audit-count")).toHaveText("50 kayıt gösteriliyor");
  // Salt okunur: satırlarda düzenle/sil eylemi yok
  await expect(page.getByRole("button", { name: /Düzenle|Sil\b/ })).toHaveCount(0);
  // İşlem Türkçe etiket + ham ad; bilinmeyen ad ham
  const login = rows(page).filter({ hasText: "auth.login" }).first();
  await expect(login).toContainText("Giriş");
  await expect(rows(page).filter({ hasText: "yeni.bilinmeyen_olay" })).toHaveCount(1);
  // Avatar: resmi olan kullanıcıda <img>, olmayanda baş harf
  const elif = rows(page).filter({ hasText: "Elif Yönetici" });
  await expect(elif.locator("img[data-testid=audit-avatar]")).toHaveCount(1);
  await expect(login.locator("span[data-testid=audit-avatar]")).toHaveText("CA");
  // Sonuç rozeti metinle
  await expect(rows(page).filter({ hasText: "kotu@ornek.com" }).getByTestId("audit-result-badge")).toHaveText("Başarısız");
  expect(await axeScan(page, "#icerik")).toEqual([]);

  // Keyset sayfalama
  await page.getByTestId("audit-more").click();
  await expect(rows(page)).toHaveCount(60);
  await expect(page.getByTestId("audit-count")).toContainText("Tüm kayıtlar gösterildi");
  await expect(page.getByTestId("audit-more")).toHaveCount(0);

  // Detay: eski/yeni değer JSON'u <pre> içinde düz metin (HTML yorumlanmaz)
  await elif.getByTestId("audit-detail-open").click();
  const dlg = page.getByTestId("audit-detail");
  await expect(dlg).toHaveJSProperty("open", true);
  await expect(dlg.getByRole("button", { name: "Kapat", exact: true })).toBeFocused();
  await expect(dlg.getByTestId("audit-new")).toContainText('"fullName": "<img src=x onerror=alert(1)>Can"');
  await expect(dlg.locator("pre img")).toHaveCount(0);
  await expect(dlg.getByTestId("audit-old")).toContainText("Can Aydin");
  await expect(dlg).toContainText("salt okunurdur");
  await expect(dlg.getByRole("button", { name: /Düzenle|Sil\b/ })).toHaveCount(0);
  expect(await axeScan(page, '[data-testid="audit-detail"]')).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveJSProperty("open", false);

  // E-posta kaydı: yalnız neden; ek alan (kind vb.) basılmaz
  await rows(page).filter({ hasText: "mail.sent" }).getByTestId("audit-detail-open").click();
  await expect(dlg.getByTestId("audit-detail-reason")).toContainText("auth");
  await expect(dlg).not.toContainText("session_link");
  await expect(dlg.locator("pre")).toHaveCount(0);
  await dlg.getByRole("button", { name: "Kapat", exact: true }).click();

  // CSV indir (audit.export)
  const download = page.waitForEvent("download");
  const req = page.waitForRequest((r) => r.url().includes("/api/v1/audit/export.csv"));
  await page.getByTestId("audit-export").click();
  expect((await download).suggestedFilename()).toBe("audit-2026-11-12.csv");
  expect((await req).url()).not.toContain("cursor");
});

test("AC-76 filtreler URL'de: işlem grubu + sonuç + kullanıcı; temizle; geçersiz URL değeri ve 731 gün sınırı", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInAu(context, "auadm");
  await page.goto("/audit?result=hepsi");
  await expect(page.getByTestId("filters-ignored")).toContainText("Sonuç");
  const f = page.getByTestId("audit-filters");
  // Kullanıcı seçenekleri /users'tan
  await expect(f.getByLabel("Kullanıcı").locator("option")).toHaveCount(4);
  await f.getByLabel("İşlem").selectOption("auth.*");
  await f.getByLabel("Sonuç").selectOption("fail");
  await f.getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/\/audit\?action=auth\.\*&result=fail$/);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("kotu@ornek.com");
  await expect(page.getByTestId("audit-more")).toHaveCount(0);
  // Kullanıcı filtresi
  await page.getByTestId("audit-filters").getByLabel("İşlem").selectOption("");
  await page.getByTestId("audit-filters").getByLabel("Sonuç").selectOption("");
  await page.getByTestId("audit-filters").getByLabel("Kullanıcı").selectOption({ label: "Elif Yönetici" });
  await page.getByTestId("audit-filters").getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/userId=01JAV00000000000000000000C/);
  await expect(rows(page)).toHaveCount(1);
  // Hiç eşleşme yok → boş durum + temizle
  await page.goto("/audit?action=binding.revoked");
  await expect(page.getByTestId("audit-empty-filter")).toBeVisible();
  await page.getByTestId("audit-empty-filter").getByRole("link", { name: "Filtreleri temizle" }).click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(rows(page)).toHaveCount(50);
  // 731 günü aşan aralık istemcide reddedilir (istek atılmaz)
  await page.getByTestId("audit-from").fill("2020-01-01");
  await page.getByTestId("audit-filters").getByTestId("filter-apply").click();
  await expect(page.getByTestId("audit-from")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("audit-filters")).toContainText("en çok 731 gün");
  await expect(page).toHaveURL(/\/audit$/);
});

test("audit: yalnız görüntüleme → CSV yok; yetkisiz → menüde yok, sayfa 403 durumu", async ({ page, context }) => {
  await signInAu(context, "auview");
  await page.goto("/audit");
  await expect(rows(page)).toHaveCount(50);
  await expect(page.getByTestId("audit-export")).toHaveCount(0);
  await context.clearCookies();
  await signInAu(context, "aunone");
  await page.goto("/");
  await expect(nav(page).getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await page.goto("/audit");
  await expect(page.getByTestId("audit-forbidden")).toContainText("yetkiniz yok");
  await expect(page.getByTestId("audit-filters")).toHaveCount(0);
});

test("audit: boş durum; liste hatası → Tekrar dene; 'Daha fazla yükle' hatası yeniden denenir", async ({ page, context }) => {
  await signInAu(context, "auempty");
  await page.goto("/audit");
  await expect(page.getByTestId("audit-empty")).toContainText("Bu aralıkta kayıt yok");
  await expect(page.getByTestId("audit-export")).toHaveCount(0);
  await context.clearCookies();
  await signInAu(context, "aubroken");
  await page.goto("/audit");
  await expect(page.getByTestId("load-error")).toBeVisible();
  await page.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(rows(page)).toHaveCount(50);
  await page.getByTestId("audit-more").click();
  await expect(page.getByTestId("audit-more-error")).toContainText("Sonraki kayıtlar alınamadı");
  await page.getByTestId("audit-more").click();
  await expect(rows(page)).toHaveCount(60);
  await expect(page.getByTestId("audit-more-error")).toHaveCount(0);
});

test("audit mobil: kart görünümü, taşma yok, kart detayı açar", async ({ page, context }, info) => {
  test.skip(info.project.name !== "mobile", "mobil düzen");
  await signInAu(context, "auadm");
  await page.goto("/audit");
  await expect(page.getByTestId("audit-table")).toBeHidden();
  await expect(rows(page)).toHaveCount(50);
  await noHorizontalOverflow(page);
  await rows(page).first().click();
  await expect(page.getByTestId("audit-detail")).toHaveJSProperty("open", true);
  await noHorizontalOverflow(page);
});

test("AC-77/78 Super Admin MySQL: test başarı/hata/429, şifre forma yazılmaz, kayıtta yeniden başlatma uyarısı", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInAu(context, "ausa");
  await page.goto("/");
  await nav(page).getByRole("link", { name: "Sistem ayarları" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/mysql$/);
  await expect(page).toHaveTitle(/MySQL/);
  await expect(page.getByTestId("system-tabs").getByRole("link", { name: "MySQL" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("mysql-env-source")).toContainText(".env");
  await expect(page.getByTestId("mysql-port")).toHaveValue("3306");
  const pw = page.getByTestId("mysql-password");
  await expect(pw).toHaveValue("");
  await expect(pw).toHaveAttribute("placeholder", "Kayıtlı — değiştirmek için yazın");
  await expect(pw).toHaveAttribute("type", "password");
  expect(await axeScan(page, "#icerik")).toEqual([]);

  // B-P11-3: kalıcı TLS uyarısı (test sonucundan bağımsız)
  await expect(page.getByTestId("mysql-tls-note")).toContainText("TLS kullanmaz");
  await expect(page.getByTestId("mysql-tls-note")).toContainText("güvenilir iç ağ");
  // Test: hata — süre gösterilmez (B-P11-4: başarısız denemede sunucu süre dönmez)
  await page.getByTestId("mysql-host").fill("bad.example");
  await page.getByTestId("mysql-test").click();
  const result = page.getByTestId("mysql-test-result");
  await expect(result).toContainText("Bağlantı kurulamadı");
  await expect(result).toContainText("Sunucuya bağlanılamadı");
  await expect(result).not.toContainText("ms");
  await expect(page.getByTestId("mysql-test-latency")).toHaveCount(0);
  await expect(result).toHaveAttribute("role", "alert");
  // Test: bekleme göstergesi + başarı
  await page.getByTestId("mysql-host").fill("slow.example");
  await page.getByTestId("mysql-test").click();
  await expect(page.getByTestId("mysql-test-wait")).toContainText("10 saniyeye kadar");
  await expect(result).toContainText("Bağlantı başarılı");
  await expect(page.getByTestId("mysql-test-latency")).toHaveText("Süre: 12 ms");
  // 429
  await page.getByTestId("mysql-host").fill("rate.example");
  await page.getByTestId("mysql-test").click();
  await expect(result).toContainText("Çok fazla test");

  // Kayıt: aynı sunucu/kullanıcıda boş şifre gönderilmez (korunur)
  await page.getByTestId("mysql-host").fill("mysql");
  await page.getByTestId("mysql-database").fill("remote2");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/v1/admin/settings/mysql"));
  await page.getByTestId("save-bar-save").click();
  expect((await put).postDataJSON()).toEqual({ host: "mysql", port: 3306, database: "remote2", user: "app" });
  await expect(page.getByTestId("mysql-restart")).toContainText("yeniden başlatılmalı");
  await expect(page.getByTestId("setting-source").first()).toHaveText("Panelde kayıtlı");
  await expect(pw).toHaveValue("");
  // QA-1: port veya kullanıcı değişip şifre boşsa → 400 fields.password şifre alanının altında (kayıtlı şifre yeni hedefe taşınmaz)
  for (const [id, changed, original] of [["mysql-port", "3307", "3306"], ["mysql-user", "app2", "app"]] as const) {
    await page.getByTestId(id).fill(changed);
    const bad = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/api/v1/admin/settings/mysql"));
    await page.getByTestId("save-bar-save").click();
    expect((await bad).status(), `${id} değişince şifresiz PUT`).toBe(400);
    await expect(pw).toHaveAttribute("aria-invalid", "true");
    await expect(pw).toBeFocused();
    await expect(page.getByTestId("mysql-form")).toContainText("şifreyi girin");
    await page.getByTestId(id).fill(original);
  }
  // Farklı sunucuda şifresiz kayıt → 400 fields.password şifre alanının altında
  await page.getByTestId("mysql-host").fill("db2.ornek.local");
  await page.getByTestId("save-bar-save").click();
  await expect(pw).toHaveAttribute("aria-invalid", "true");
  await expect(pw).toBeFocused();
  await expect(page.getByTestId("mysql-form")).toContainText("şifreyi girin");
  // Yeni şifre gönderilir, ardından alan yine boş
  await pw.fill("YeniSifre-123");
  const put2 = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/v1/admin/settings/mysql"));
  await page.getByTestId("save-bar-save").click();
  expect((await put2).postDataJSON().password).toBe("YeniSifre-123");
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("mysql-password")).toHaveValue("");
  await expect(page.getByTestId("mysql-host")).toHaveValue("db2.ornek.local");
  await expect(page.getByTestId("mysql-mismatch")).toBeVisible();
});

test("AC-78 TURN: satır ekle/kaldır, satır hatası, secret maskeli, ortam değerlerine dön (onaylı)", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInAu(context, "ausa");
  await page.goto("/admin/settings/turn");
  await expect(page.getByTestId("turn-secret-warning")).toContainText("static-auth-secret ile aynı olmalı");
  const urls = page.getByTestId("turn-url");
  await expect(urls).toHaveCount(2);
  await expect(page.getByTestId("turn-secret")).toHaveValue("");
  await expect(page.getByTestId("turn-secret")).toHaveAttribute("placeholder", "Kayıtlı — değiştirmek için yazın");
  await page.getByTestId("turn-url-add").click();
  await expect(urls).toHaveCount(3);
  await expect(urls.nth(2)).toBeFocused();
  await urls.nth(2).fill("http://yanlis");
  await page.getByTestId("save-bar-save").click();
  await expect(urls.nth(2)).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("turn-form")).toContainText("stun:, turn: veya turns:");
  await page.getByRole("button", { name: "3. adresi kaldır" }).click();
  await expect(urls).toHaveCount(2);
  await page.getByTestId("turn-secret").fill("kisa");
  await page.getByTestId("save-bar-save").click();
  await expect(page.getByTestId("turn-secret")).toHaveAttribute("aria-invalid", "true");
  await page.getByTestId("save-bar-reset").click();
  expect(await axeScan(page, "#icerik")).toEqual([]);

  // Ortam değerlerine dön → onay (odak Vazgeç) → env
  await page.getByTestId("turn-reset").click();
  const dlg = page.getByTestId("turn-reset-dialog");
  await expect(dlg).toHaveJSProperty("open", true);
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  const del = page.waitForRequest((r) => r.method() === "DELETE" && r.url().endsWith("/api/v1/admin/settings/turn"));
  await dlg.getByTestId("turn-reset-confirm").click();
  await del;
  await expect(page.getByTestId("turn-env-source")).toBeVisible();
  await expect(urls).toHaveCount(1);
  await expect(urls.first()).toHaveValue("stun:stun.ornek.com:3478");
  await expect(page.getByTestId("turn-reset")).toHaveCount(0);
});

test("sistem ayarları yalnız Super Admin: Admin'de menüde yok, sayfa yetkisiz durumu", async ({ page, context }) => {
  await signInAu(context, "auadm");
  for (const path of ["/admin/settings", "/admin/settings/mysql", "/admin/settings/turn"]) {
    await page.goto(path);
    await expect(page.getByTestId("system-forbidden")).toBeVisible();
    await expect(page.getByTestId("system-tabs")).toHaveCount(0);
  }
  await expect(page.getByTestId("mysql-form")).toHaveCount(0);
  await expect(nav(page).getByRole("link", { name: "Sistem ayarları" })).toHaveCount(0);
});

test("Super Admin audit: firma filtresi /admin/tenants'tan", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInAu(context, "ausa");
  await page.goto("/audit");
  const tenant = page.getByTestId("audit-filters").getByLabel("Firma");
  await expect(tenant.locator("option")).toHaveText(["Tümü", "Acme Bilişim", "Demo Firma"]);
  await tenant.selectOption({ label: "Acme Bilişim" });
  await page.getByTestId("audit-filters").getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/tenantId=01JAT00000000000000000000B/);
  await expect(page.getByTestId("audit-table").locator("thead")).toContainText("Firma");
  for (const r of await rows(page).all()) await expect(r).toContainText("Acme Bilişim");
});

test("aydınlatma metni: sayaç, doğrulama, onaylı yeni sürüm, sürüm geçmişi", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInAu(context, "auadm");
  await page.goto("/settings/consent-text");
  await expect(page).toHaveTitle(/Aydınlatma metni/);
  await expect(page.getByTestId("settings-tabs").getByRole("link", { name: "Aydınlatma metni" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("consent-version")).toHaveText("Sürüm 2");
  await expect(page.getByTestId("consent-by")).toHaveText("Derya Kaya");
  await expect(page.getByTestId("consent-version-row")).toHaveCount(2);
  const area = page.getByTestId("consent-body");
  await area.fill("Kısa metin");
  await expect(page.getByTestId("consent-count")).toHaveText("10 / 20.000 karakter");
  await page.getByTestId("save-bar-save").click();
  await expect(page.getByTestId("consent-error")).toContainText("en az 50");
  await expect(area).toBeFocused();
  const text = "Yeni aydınlatma metni: teknisyen yalnız onayınızla ekranınızı görür; <b>kalın</b> yazı yorumlanmaz.";
  await area.fill(text);
  await expect(page.getByTestId("save-bar-save")).toHaveText("Yeni sürüm olarak kaydet");
  await page.getByTestId("save-bar-save").click();
  const dlg = page.getByTestId("consent-confirm");
  await expect(dlg).toContainText("Yeni oturumlar bu metni gösterecek; eski onaylar eski sürüme bağlı kalır");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  expect(await axeScan(page, '[data-testid="consent-confirm"]')).toEqual([]);
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/v1/settings/consent-text"));
  await dlg.getByTestId("consent-confirm-save").click();
  expect((await put).postDataJSON()).toEqual({ body: text });
  await expect(page.getByText("Sürüm 3 kaydedildi")).toBeVisible();
  await expect(page.getByTestId("consent-version")).toHaveText("Sürüm 3");
  await expect(page.getByTestId("consent-version-row")).toHaveCount(3);
  await expect(page.getByTestId("consent-version-row").first()).toContainText("Güncel");
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  expect(await axeScan(page, "#icerik")).toEqual([]);
});

test("aydınlatma metni: PUT 429 (10 sürüm/saat) → kilit uyarısı süreyle, metin korunur, yeniden denenebilir", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInAu(context, "auadm");
  await page.goto("/settings/consent-text");
  const area = page.getByTestId("consent-body");
  const text = "Hız sınırı denemesi [hiz-siniri]: teknisyen yalnız onayınızla ekranınızı görür ve kontrol eder.";
  await area.fill(text);
  await page.getByTestId("save-bar-save").click();
  const put = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/api/v1/settings/consent-text"));
  await page.getByTestId("consent-confirm").getByTestId("consent-confirm-save").click();
  expect((await put).status()).toBe(429);
  const alert = page.getByTestId("form-error");
  await expect(alert).toContainText("Saatte en çok 10 yeni sürüm");
  await expect(alert).toContainText("25 dakika sonra");
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("consent-confirm")).toHaveJSProperty("open", false);
  await expect(area).toHaveValue(text);
  await expect(page.getByTestId("consent-version")).toHaveText("Sürüm 2");
  await expect(page.getByTestId("save-bar")).toBeVisible();
  // Metin düzeltilip yeniden kaydedilebilir; hata kalkar
  await area.fill(text.replace(" [hiz-siniri]", ""));
  await page.getByTestId("save-bar-save").click();
  await page.getByTestId("consent-confirm").getByTestId("consent-confirm-save").click();
  await expect(page.getByTestId("consent-version")).toHaveText("Sürüm 3");
  await expect(alert).toHaveCount(0);
});

test("aydınlatma metni: settings.edit yoksa salt okunur", async ({ page, context }) => {
  await signInAu(context, "auview");
  await page.goto("/settings/consent-text");
  await expect(page.getByTestId("settings-readonly")).toBeVisible();
  await expect(page.getByTestId("consent-body")).toHaveAttribute("readonly", "");
  await page.getByTestId("consent-body").press("End");
  await page.keyboard.type("x");
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  await noHorizontalOverflow(page);
});

const tableBoxOverflow = (p: Page) => p.getByTestId("audit-table-box").evaluate((el) => el.scrollWidth - el.clientWidth);

// QA-2: P11 ekranları iki temada axe 0 ihlal; 1280 px ve 390 px'te yatay taşma yok (P8 deseni).
for (const scheme of ["light", "dark"] as const) {
  test(`P11 axe (${scheme}) + 1280/390 px taşma: audit (+ayrıntı), MySQL, TURN, aydınlatma metni`, async ({ page, context }, info) => {
    desktopOnly(info.project.name);
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 600 ? 800 : 844 });
      await context.clearCookies();
      await signInAu(context, "auadm");
      await page.goto("/audit");
      await expect(rows(page).first()).toBeVisible();
      // Tema gerçekten uygulandı mı (kullanıcı tercihi "Sistem" → prefers-color-scheme)
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain(scheme);
      await noHorizontalOverflow(page);
      if (width > 600) expect(await tableBoxOverflow(page), "audit tablo kabı taşmamalı").toBeLessThanOrEqual(0);
      expect(await axeScan(page), `audit ${width}`).toEqual([]);
      const row = rows(page).filter({ hasText: "Elif Yönetici" });
      if (width > 600) await row.getByTestId("audit-detail-open").click();
      else await row.click();
      const dlg = page.getByTestId("audit-detail");
      await expect(dlg).toHaveJSProperty("open", true);
      await noHorizontalOverflow(page);
      expect(await axeScan(page, '[data-testid="audit-detail"]'), `audit ayrıntı ${width}`).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dlg).toHaveJSProperty("open", false);

      await page.goto("/settings/consent-text");
      await expect(page.getByTestId("consent-body")).toBeVisible();
      await noHorizontalOverflow(page);
      expect(await axeScan(page), `aydınlatma ${width}`).toEqual([]);

      await context.clearCookies();
      await signInAu(context, "ausa");
      // Sayfa testi bulgusu: Super Admin görünümü (Firma sütunu) 1280 px'te taşıyordu
      await page.goto("/audit");
      await expect(rows(page).first()).toBeVisible();
      await noHorizontalOverflow(page);
      if (width > 600) {
        await expect(page.getByTestId("audit-table").locator("thead")).toContainText("Firma");
        expect(await tableBoxOverflow(page), "Super Admin audit tablo kabı taşmamalı").toBeLessThanOrEqual(0);
      }
      expect(await axeScan(page), `audit Super Admin ${width}`).toEqual([]);

      await page.goto("/admin/settings/mysql");
      await expect(page.getByTestId("mysql-form")).toBeVisible();
      await page.getByTestId("mysql-host").fill("bad.example");
      await page.getByTestId("mysql-test").click();
      await expect(page.getByTestId("mysql-test-result")).toBeVisible();
      await noHorizontalOverflow(page);
      expect(await axeScan(page), `mysql ${width}`).toEqual([]);

      await page.goto("/admin/settings/turn");
      await expect(page.getByTestId("turn-form")).toBeVisible();
      await noHorizontalOverflow(page);
      expect(await axeScan(page), `turn ${width}`).toEqual([]);
    }
  });
}
