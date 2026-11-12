import { expect, test, type Page } from "@playwright/test";
import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import { axeScan, guardConsole, noHorizontalOverflow, signIn } from "./helpers";

// P10 hesap güvenliği + SMTP — AC-10, 66, 67, 68, 79, 80, 115, 122, 151. Sahte API: e2e/mock-account.mjs
// (mfa@ / zorunlu@ girişleri; u-acc / u-nosmtp / u-accro çerezleri), mock-requests (u-rqmail), mock-users (reset-mfa).
guardConsole();
const desktopOnly = (name: string) => test.skip(name !== "desktop", "masaüstü akışı");
const PASSWORD = "DogruSifre123!";
const RESET_OK = "r".repeat(43);

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel("E-posta veya kullanıcı adı").fill(user);
  await page.getByLabel("Şifre", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

test("AC-67 giriş + 2FA kodu: hatalı kod alan hatası, doğru kod panele", async ({ page }) => {
  await login(page, "mfa@ornek.com");
  await expect(page).toHaveURL(/\/login\/2fa$/);
  await expect(page).toHaveTitle(/İki adımlı doğrulama/);
  const code = page.getByLabel("6 haneli kod");
  await expect(code).toBeFocused();
  await code.fill("000000");
  await page.getByTestId("mfa-submit").click();
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Kod hatalı ya da süresi geçti")).toBeVisible();
  await expect(code).toHaveValue("");
  expect(await axeScan(page)).toEqual([]);
  await code.fill("123456");
  await page.getByTestId("mfa-submit").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("current-user-avatar")).toBeVisible();
});

test("AC-67 kurtarma kodu ile giriş; yarı oturumda panel kapalı", async ({ page }) => {
  await login(page, "mfa@ornek.com");
  await expect(page).toHaveURL(/\/login\/2fa$/);
  // Yarı oturumla panele gidilemez → kod adımına döner
  await page.goto("/sessions");
  await expect(page).toHaveURL(/\/login\/2fa$/);
  await page.getByTestId("mfa-mode").click();
  const rc = page.getByLabel("Kurtarma kodu");
  await expect(rc).toBeFocused();
  // Tire çevresinde boşluk + büyük harf: istemci normalize eder (test raporu bulgu 4)
  await rc.fill(" ABCDE - 23456 ");
  await page.getByTestId("mfa-submit").click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/account");
  await expect(page.getByTestId("acc-rc-left")).toHaveText("Kullanılmamış kurtarma kodu: 9");
});

test("AC-67 zorunlu 2FA kurulum kapısı: QR + elle anahtar, kod, kurtarma kodları bir kez", async ({ page }, info) => {
  await login(page, "zorunlu@ornek.com");
  await expect(page).toHaveURL(/\/2fa\/setup$/);
  await expect(page.getByTestId("mfa-required")).toBeVisible();
  // Kapıdan panele kaçış yok
  await page.goto("/users");
  await expect(page).toHaveURL(/\/2fa\/setup$/);
  await expect(page.getByTestId("mfa-qr")).toHaveAttribute("alt", "İki adımlı doğrulama kurulum QR kodu");
  await expect(page.getByTestId("mfa-secret")).toHaveText("JBSW Y3DP EHPK 3PXP");
  await noHorizontalOverflow(page);
  expect(await axeScan(page)).toEqual([]);
  const code = page.getByTestId("mfa-setup-code");
  await code.fill("111111");
  await page.getByTestId("mfa-enable").click();
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await code.fill("123456");
  await page.getByTestId("mfa-enable").click();
  const rc = page.getByTestId("recovery-codes");
  await expect(rc.getByTestId("recovery-code")).toHaveCount(10);
  await expect(rc).toContainText("yalnız şimdi gösterilir");
  if (info.project.name === "desktop") {
    const dl = page.waitForEvent("download");
    await rc.getByTestId("rc-download").click();
    expect((await dl).suggestedFilename()).toMatch(/^kurtarma-kodlari-\d{4}-\d{2}-\d{2}\.txt$/);
  }
  await expect(rc.getByTestId("rc-done")).toBeDisabled();
  await rc.getByTestId("rc-saved").check();
  await rc.getByTestId("rc-done").click();
  await expect(page).toHaveURL(/\/$/);
});

test("AC-66 şifremi unuttum: hesap varlığını sızdırmayan mesaj; sıfırlama → giriş", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("forgot-link").click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page).toHaveTitle(/Şifremi unuttum/);
  await page.getByRole("button", { name: "Bağlantı gönder" }).click();
  await expect(page.getByLabel("E-posta")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("E-posta").fill("kimse@ornek.com");
  await page.getByRole("button", { name: "Bağlantı gönder" }).click();
  await expect(page.getByTestId("forgot-sent")).toContainText("kayıtlı bir hesap varsa");
  expect(await axeScan(page)).toEqual([]);

  await page.goto(`/reset-password#token=${RESET_OK}`);
  await expect(page.getByTestId("reset-form")).toBeVisible();
  // Token adres çubuğundan silinir
  await expect.poll(() => page.url()).toMatch(/\/reset-password$/);
  await page.getByLabel("Yeni şifre", { exact: true }).fill("YeniUzunSifre2026!");
  await page.getByLabel("Yeni şifre (tekrar)").fill("Farkli");
  await page.getByTestId("reset-submit").click();
  await expect(page.getByText("Şifreler eşleşmiyor.")).toBeVisible();
  await page.getByLabel("Yeni şifre (tekrar)").fill("YeniUzunSifre2026!");
  await page.getByTestId("reset-submit").click();
  await expect(page).toHaveURL(/\/login\?reason=reset$/);
  await expect(page.getByText("Şifreniz değiştirildi. Yeni şifrenizle giriş yapın.")).toBeVisible();
});

test("AC-66 geçersiz / süresi dolmuş sıfırlama bağlantısı", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByTestId("reset-invalid")).toContainText("Bağlantı geçersiz ya da süresi dolmuş");
  await page.goto("/login"); // yalnız # değişen gezinme sayfayı yeniden yüklemez
  await page.goto(`/reset-password#token=${"x".repeat(43)}`);
  await page.getByLabel("Yeni şifre", { exact: true }).fill("YeniUzunSifre2026!");
  await page.getByLabel("Yeni şifre (tekrar)").fill("YeniUzunSifre2026!");
  await page.getByTestId("reset-submit").click();
  await expect(page.getByTestId("reset-invalid")).toBeVisible();
  await expect(page.getByRole("link", { name: "Yeni bağlantı iste" })).toHaveAttribute("href", "/forgot-password");
});

test("AC-79/80/122 SMTP ayarları: port önerisi, maskeli şifre, iç ağ reddi, test maili", async ({ page, context }, info) => {
  await signIn(context, "acc");
  await page.goto("/settings/smtp");
  await expect(page).toHaveTitle(/E-posta \(SMTP\) ayarları/);
  await expect(page.getByRole("navigation", { name: "Ayarlar menüsü" }).getByRole("link", { name: "E-posta (SMTP)" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Ayarlar" })).toHaveAttribute("aria-current", "page");
  const pw = page.getByTestId("smtp-password");
  await expect(pw).toHaveValue("");
  await expect(page.getByText("Kayıtlı bir şifre var; değiştirmek için yazın.")).toBeVisible();
  await noHorizontalOverflow(page);
  expect(await axeScan(page)).toEqual([]);
  if (info.project.name !== "desktop") return;

  const sec = page.getByRole("group", { name: "Güvenlik" });
  await sec.getByRole("button", { name: "SSL" }).click();
  await expect(page.getByTestId("smtp-port")).toHaveValue("465");
  await sec.getByRole("button", { name: "Yok" }).click();
  await expect(page.getByTestId("smtp-port")).toHaveValue("25");
  await expect(page.getByTestId("smtp-insecure")).toBeVisible();
  // B-P10-5: "Yok" iken kullanıcı adı/şifre pasif ve boş; açıklama görünür
  await expect(page.getByTestId("smtp-user")).toBeDisabled();
  await expect(page.getByTestId("smtp-user")).toHaveValue("");
  await expect(page.getByTestId("smtp-password")).toBeDisabled();
  await expect(page.getByTestId("smtp-no-creds")).toContainText("Şifresiz bağlantıda kimlik bilgisi gönderilmez; SSL veya TLS seçin.");
  await sec.getByRole("button", { name: "TLS" }).click();
  await expect(page.getByTestId("smtp-port")).toHaveValue("587");
  await expect(page.getByTestId("smtp-user")).toBeEnabled();
  await expect(page.getByTestId("smtp-user")).toHaveValue("destek@ornek.com");
  await expect(page.getByTestId("smtp-no-creds")).toHaveCount(0);
  // B-P10-1: port yalnız izinli değerler (seçim kutusu); 2525 güvenlik değişince korunur
  await expect(page.getByTestId("smtp-port").locator("option")).toHaveText(["25", "465", "587", "2525"]);
  await page.getByTestId("smtp-port").selectOption("2525");
  await sec.getByRole("button", { name: "SSL" }).click();
  await expect(page.getByTestId("smtp-port")).toHaveValue("2525");
  await sec.getByRole("button", { name: "TLS" }).click();
  await page.getByTestId("smtp-port").selectOption("587");

  // Sunucu alan hatası (port / güvenlik) ilgili alanın altında
  await page.getByTestId("smtp-host").fill("red.ornek.com");
  await page.getByTestId("save-bar").getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Port 25, 465, 587 veya 2525 olmalı")).toBeVisible();
  await expect(page.getByTestId("smtp-port")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("smtp-security-error")).toContainText("SSL veya STARTTLS seçin");

  // "Yok" ile kayıt: kimlik bilgisi gövdede yok (sunucu reddeder)
  await sec.getByRole("button", { name: "Yok" }).click();
  await expect(page.getByTestId("smtp-security-error")).toHaveCount(0);
  await page.getByTestId("smtp-host").fill("mail.ornek.com");
  const putNone = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/v1/settings/tenant"));
  await page.getByTestId("save-bar").getByRole("button", { name: "Kaydet" }).click();
  const noneBody = (await putNone).postDataJSON().smtp;
  expect(noneBody).toMatchObject({ security: "NONE", port: 25, user: "" });
  expect(noneBody).not.toHaveProperty("password");
  await expect(page.getByTestId("toast")).toContainText("SMTP ayarları kaydedildi");
  await sec.getByRole("button", { name: "TLS" }).click();

  // Kirliyken test pasif; iç ağ adresi genel mesajla reddedilir
  await page.getByTestId("smtp-host").fill("10.0.0.5");
  await expect(page.getByTestId("smtp-test-open")).toBeDisabled();
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/v1/settings/tenant"));
  await page.getByTestId("save-bar").getByRole("button", { name: "Kaydet" }).click();
  // Boş şifre gönderilmez (kayıtlı şifre korunur)
  expect((await put).postDataJSON().smtp).not.toHaveProperty("password");
  await expect(page.getByText("Bu sunucu adresi kullanılamaz.")).toBeVisible();
  await expect(page.getByTestId("smtp-host")).toBeFocused();
  await page.getByTestId("smtp-host").fill("mail.ornek.com");
  await page.getByTestId("save-bar").getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: "SMTP ayarları kaydedildi" }).last()).toBeVisible(); // iki toast varken strict mode

  await page.getByTestId("smtp-test-open").click();
  const dlg = page.getByTestId("smtp-test-dialog");
  await expect(dlg.getByLabel("Alıcı e-posta adresi")).toBeFocused();
  await dlg.getByLabel("Alıcı e-posta adresi").fill("fail@ornek.com");
  await dlg.getByTestId("mail-test-send").click();
  // B-P10-1: tek genel mesaj (hata sınıfı yok)
  await expect(dlg.getByTestId("mail-test-result")).toContainText("E-posta gönderilemedi. Sunucu, port, güvenlik ve kimlik bilgilerini kontrol edin.");
  await dlg.getByLabel("Alıcı e-posta adresi").fill("bt@ornek.com");
  await dlg.getByTestId("mail-test-send").click();
  await expect(dlg.getByTestId("mail-test-result")).toContainText("bt@ornek.com adresine gönderildi");
});

test("SMTP ayarlanmamış: uyarı + test pasif; salt okunur kullanıcı düzenleyemez", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "nosmtp");
  await page.goto("/settings/smtp");
  await expect(page.getByTestId("smtp-unconfigured")).toBeVisible();
  await expect(page.getByTestId("smtp-test-open")).toBeDisabled();
  await expect(page.getByTestId("smtp-port")).toHaveValue("587");

  const ro = await context.browser()!.newContext();
  const p2 = await ro.newPage();
  await signIn(ro, "accro");
  await p2.goto("http://localhost:3217/settings/security");
  await expect(p2.getByTestId("settings-readonly")).toBeVisible();
  await expect(p2.getByTestId("require-2fa-switch")).toBeDisabled();
  await ro.close();
});

test("AC-67 teknisyen 2FA zorunluluğu anahtarı anında kaydedilir", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "acc");
  await page.goto("/settings/security");
  const sw = page.getByTestId("require-2fa-switch");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(page.getByTestId("toast")).toContainText("isteğe bağlı");
  await expect(sw).toHaveAttribute("aria-checked", "false");
});

test("AC-68/115 Hesap güvenliği: tüm cihazlardan çıkış onaylı; şifre değiştir", async ({ page, context }) => {
  await signIn(context, "acc");
  await page.goto("/");
  await page.getByTestId("account-link").click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page).toHaveTitle(/Hesap güvenliği/);
  await expect(page.getByTestId("acc-mfa-on")).toBeVisible();
  await expect(page.getByTestId("acc-rc-low")).toBeVisible();
  await noHorizontalOverflow(page);
  expect(await axeScan(page)).toEqual([]);

  await page.getByTestId("acc-logout-all").click();
  const dlg = page.getByTestId("logout-all-dialog");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await expect(dlg).toContainText("açık destek oturumları da sonlanır");
  await dlg.getByTestId("logout-all-confirm").click();
  await expect(page.getByTestId("toast")).toContainText("Diğer cihazlardaki 2 oturum kapatıldı");
  await expect(page).toHaveURL(/\/account$/);

  const pwSec = page.getByTestId("acc-pw");
  await pwSec.getByLabel("Mevcut şifre").fill("yanlis");
  await pwSec.getByLabel("Yeni şifre", { exact: true }).fill("YeniUzunSifre2026!");
  await pwSec.getByLabel("Yeni şifre (tekrar)").fill("YeniUzunSifre2026!");
  await pwSec.getByRole("button", { name: "Şifreyi değiştir" }).click();
  await expect(pwSec.getByText("Mevcut şifre hatalı.")).toBeVisible();
  await pwSec.getByLabel("Mevcut şifre").fill(PASSWORD);
  await pwSec.getByRole("button", { name: "Şifreyi değiştir" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: "Şifreniz değiştirildi" })).toBeVisible();
  await expect(pwSec.getByLabel("Mevcut şifre")).toHaveValue("");
});

test("AC-151 talep bildirimi e-posta kanalı: SMTP ayarlı firmada alıcı + test maili", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "rqmail");
  await page.goto("/settings/support-requests");
  const ch = page.getByTestId("mail-channel");
  await ch.getByTestId("mail-switch").click();
  await page.getByTestId("save-bar").getByRole("button", { name: "Kaydet" }).click();
  await expect(ch.getByText("Kanal açıkken en az bir alıcı girin.")).toBeVisible();
  await ch.getByRole("button", { name: "E-posta alıcısı ekle" }).click();
  await ch.getByLabel("E-posta alıcıları 1").fill("Destek@Ornek.com");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/settings/support-requests"));
  await page.getByTestId("save-bar").getByRole("button", { name: "Kaydet" }).click();
  expect((await put).postDataJSON().email).toEqual({ enabled: true, recipients: ["destek@ornek.com"] });
  await ch.getByTestId("mail-test-open").click();
  const dlg = page.getByTestId("mail-test-dialog");
  await dlg.getByLabel("Alıcı e-posta adresi").fill("bt@ornek.com");
  await dlg.getByTestId("mail-test-send").click();
  await expect(dlg.getByTestId("mail-test-result")).toContainText("Test maili gönderildi");
});

test("AC-151 SMTP yoksa e-posta kanalı pasif + SMTP ayarlarına bağlantı", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "rqadm");
  await page.goto("/settings/support-requests");
  await expect(page.getByTestId("mail-switch")).toBeDisabled();
  await expect(page.getByTestId("mail-channel")).toContainText("Önce SMTP ayarlarını yapın.");
  await expect(page.getByTestId("mail-smtp-link")).toHaveAttribute("href", "/settings/smtp");
});

test("AC-10 oturum linkini e-postayla gönder: başarı ve saatlik sınır", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context);
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const dlg = page.getByTestId("new-session-dialog");
  await dlg.getByTestId("session-email-open").click();
  const to = dlg.getByTestId("session-email-to");
  await expect(to).toBeFocused();
  await to.fill("musteri@ornek.com");
  await dlg.getByTestId("session-email-send").click();
  await expect(dlg.getByTestId("session-email-result")).toContainText("musteri@ornek.com adresine gönderildi");
  await to.fill("limit@ornek.com");
  await dlg.getByTestId("session-email-send").click();
  await expect(dlg.getByTestId("session-email-result")).toContainText("Saatte en çok 20");
});

test("AC-115 yönetici kullanıcının 2FA'sını sıfırlar (onaylı)", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "usadm");
  await page.goto("/users/01JKS00000000000000000000B");
  await expect(page.getByTestId("user-2fa")).toHaveText("Etkin");
  await page.getByTestId("user-reset-mfa").click();
  const dlg = page.getByTestId("user-reset-mfa-dialog");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await dlg.getByTestId("user-action-confirm").click();
  await expect(page.getByTestId("toast")).toContainText("iki adımlı doğrulama sıfırlandı");
  await expect(page.getByTestId("user-2fa")).toHaveText("Etkin değil");
  await expect(page.getByTestId("user-reset-mfa")).toHaveCount(0);
});

// --- P10 sayfa testi düzeltmeleri (docs/test-raporu.md bulgu 1-3) ---

test("AC-80/151 test maili sürerken Esc diyaloğu kapatmaz, bekleme metni görünür; kapat → yeniden aç", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "rqmail");
  await page.goto("/settings/support-requests");
  const ch = page.getByTestId("mail-channel");
  await ch.getByTestId("mail-switch").click();
  await ch.getByRole("button", { name: "E-posta alıcısı ekle" }).click();
  await ch.getByLabel("E-posta alıcıları 1").fill("destek@ornek.com");
  await page.getByTestId("save-bar").getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByTestId("save-bar")).toHaveCount(0);

  // Başarısız SMTP testi ~12 sn sürer: yanıtı test bitene dek beklet
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/v1/settings/support-requests/email/test", async (route) => {
    await held;
    await route.continue();
  });

  await ch.getByTestId("mail-test-open").click();
  const dlg = page.getByTestId("mail-test-dialog");
  await dlg.getByLabel("Alıcı e-posta adresi").fill("bt@ornek.com");
  await dlg.getByTestId("mail-test-send").click();
  const waiting = dlg.getByTestId("mail-test-waiting");
  await expect(waiting).toContainText("15 saniyeye kadar sürebilir");
  await expect(waiting).toHaveAttribute("role", "status");
  await expect(dlg.getByRole("button", { name: "Kapat", exact: true })).toBeDisabled();

  await page.keyboard.press("Escape");
  await expect(dlg).toHaveJSProperty("open", true);
  // Art arda Esc: tarayıcı iptal ettirmeden kapatsa bile diyalog geri gelir (durum ile DOM eşit kalır)
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveJSProperty("open", true);
  await expect(waiting).toBeVisible();
  await dlg.getByRole("button", { name: "Diyaloğu kapat" }).click();
  await expect(dlg).toHaveJSProperty("open", true);

  release();
  await expect(dlg.getByTestId("mail-test-result")).toContainText("Test maili gönderildi");
  await expect(waiting).toHaveCount(0);

  // Bittikten sonra Esc kapatır; düğmeyle yeniden açılır, eski sonuç temizlenmiş
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveJSProperty("open", false);
  await ch.getByTestId("mail-test-open").click();
  await expect(dlg).toHaveJSProperty("open", true);
  await expect(dlg.getByTestId("mail-test-result")).toHaveCount(0);
  await dlg.getByRole("button", { name: "Kapat", exact: true }).click();
  await expect(dlg).toHaveJSProperty("open", false);
  await ch.getByTestId("mail-test-open").click();
  await expect(dlg).toHaveJSProperty("open", true);
});

test("Ayarlar alt menüsü 375 px'te taşmaz; üç sekme ve etkin sekme tam görünür", async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(context, "acc");
  for (const [path, active] of [["/settings/smtp", "E-posta (SMTP)"], ["/settings/security", "Güvenlik"]] as const) {
    await page.goto(path);
    const nav = page.getByTestId("settings-tabs");
    await expect(nav.getByRole("link", { name: active })).toHaveAttribute("aria-current", "page");
    expect(await nav.locator("ul").evaluate((ul) => ul.scrollWidth - ul.clientWidth), "sekme listesi taşmamalı").toBeLessThanOrEqual(0);
    for (const link of await nav.getByRole("link").all()) {
      const box = (await link.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(await link.evaluate((a) => a.scrollWidth - a.clientWidth), "etiket kırpılmamalı").toBeLessThanOrEqual(0);
    }
    await noHorizontalOverflow(page);
  }
});

test("/login/2fa: hiç giriş yapmamış ziyaretçi nötr girişe, geçersiz yarı oturum 'süresi doldu'ya gider", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await page.goto("/login/2fa");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Giriş yap" })).toBeVisible();
  await expect(page.getByText("Oturumunuz sona erdi")).toHaveCount(0);

  await context.addCookies([{ domain: "localhost", path: "/", secure: true, sameSite: "Strict", name: SESSION_COOKIE, value: "s-gecersiz", httpOnly: true }]);
  await page.goto("/login/2fa");
  await expect(page).toHaveURL("/login?reason=expired");
  await expect(page.getByRole("status")).toContainText("Oturumunuz sona erdi");
});
