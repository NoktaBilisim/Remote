import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import { WA_INSECURE_WARNING } from "@remote/contracts/api/system-settings";
import { axeScan, guardConsole, noHorizontalOverflow } from "./helpers";

// P12b — Sistem ayarları > WhatsApp servisi (AC-196). Sahte API: e2e/mock-audit.mjs (u-ausa-* env kaynaklı,
// u-ausawa0-* hiç yapılandırılmamış, u-ausains-* panelde güvensiz http:// adres, u-ausabrk-* ilk GET 500, u-auadm-* Admin).
guardConsole();
const desktopOnly = (name: string) => test.skip(name !== "desktop", "masaüstü akışı");
const API = "/api/v1/admin/settings/whatsapp";

async function signInAu(context: BrowserContext, scenario: string) {
  const value = `u-${scenario}-${Math.random().toString(36).slice(2)}`;
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
  await context.addCookies([
    { ...base, name: SESSION_COOKIE, value, httpOnly: true },
    { ...base, name: CSRF_COOKIE, value: "csrf-test-token" },
  ]);
}
async function open(page: Page) {
  await page.goto("/admin/settings/whatsapp");
  await expect(page.getByTestId("wa-svc-form")).toHaveAttribute("data-ready", "true"); // hidrasyon bitmeden yazma
}

test("AC-196 kritik akış: env kaynağı → ön kontrol → kaydet (Panel) → test başarı/hata → ortam değişkenine dön (onaylı)", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInAu(context, "ausa");
  await page.goto("/admin/settings/mysql");
  await page.getByTestId("system-tabs").getByRole("link", { name: "WhatsApp servisi" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/whatsapp$/);
  await expect(page).toHaveTitle(/WhatsApp servisi · Sistem ayarları/);
  await expect(page.getByTestId("system-tabs").getByRole("link", { name: "WhatsApp servisi" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("wa-svc-form")).toHaveAttribute("data-ready", "true");

  // Kısmi durum: env kaynağı — etkin adres özette, alan boş (env adresi alana yazılmaz)
  await expect(page.getByTestId("setting-source")).toHaveText("Ortam değişkeni");
  await expect(page.getByTestId("wa-svc-env-source")).toContainText("WHATSAPP_SERVICE_URL");
  await expect(page.getByTestId("wa-svc-effective")).toHaveText("http://10.20.0.5:3000");
  await expect(page.getByTestId("wa-svc-updated")).toHaveText("—");
  const url = page.getByTestId("wa-svc-url");
  await expect(url).toHaveValue("");
  await expect(url).not.toHaveAttribute("placeholder", /89\.252/);
  await expect(page.getByTestId("wa-svc-reset")).toHaveCount(0);
  await expect(page.getByTestId("wa-svc-insecure")).toHaveCount(0);
  expect(await axeScan(page, "#icerik")).toEqual([]);

  // İstemci ön kontrolü: istek gitmez, alan hatası + odak
  let puts = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith(API)) puts++;
  });
  for (const [bad, msg] of [
    ["ftp://wa.ornek.com", "http:// veya https://"],
    ["https://kul:sifre@wa.ornek.com", "@, ? veya #"],
    ["https://wa.ornek.com/?x=1", "@, ? veya #"],
    [`https://${"a".repeat(200)}.com`, "en çok 200"],
  ] as const) {
    await url.fill(bad);
    await page.getByTestId("save-bar-save").click();
    await expect(url).toHaveAttribute("aria-invalid", "true");
    await expect(url).toBeFocused();
    await expect(page.getByTestId("wa-svc-form")).toContainText(msg);
  }
  expect(puts, "geçersiz adreste PUT gitmemeli").toBe(0);

  // Sunucu 400 fields.url → alanın altında
  await url.fill("https://red.example");
  await page.getByTestId("save-bar-save").click();
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("wa-svc-form")).toContainText("Bu adres kabul edilmiyor");

  // Kayıt: sondaki / kırpılır → kaynak Panel, son güncelleme dolu, kayıt çubuğu kapanır
  await url.fill("https://wa.ornek.com:3000/");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith(API));
  await page.getByTestId("save-bar-save").click();
  expect((await put).postDataJSON()).toEqual({ url: "https://wa.ornek.com:3000" });
  await expect(page.getByText("WhatsApp servis adresi kaydedildi")).toBeVisible();
  await expect(page.getByTestId("setting-source")).toHaveText("Panel");
  await expect(page.getByTestId("wa-svc-effective")).toHaveText("https://wa.ornek.com:3000");
  await expect(page.getByTestId("wa-svc-updated")).not.toHaveText("—");
  await expect(page.getByTestId("wa-svc-env-source")).toHaveCount(0);
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  await expect(url).toHaveValue("https://wa.ornek.com:3000");

  // Test: numara sorulur; geçersiz numara istemcide, başarı ve servis hatası ekranda
  const phone = page.getByTestId("wa-test-phone");
  const result = page.getByTestId("wa-test-result");
  await phone.fill("12ab");
  await page.getByTestId("wa-test-send").click();
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(result).toHaveCount(0);
  await phone.fill("0532 000 00 00");
  const test1 = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith(`${API}/test`));
  await phone.press("Enter");
  expect((await test1).postDataJSON()).toEqual({ phoneNumber: "+905320000000" });
  await expect(result).toContainText("Test mesajı gönderildi");
  await expect(result).toHaveAttribute("role", "status");
  await phone.fill("+90 532 999 99 99");
  await page.getByTestId("wa-test-send").click();
  await expect(result).toContainText("Test mesajı gönderilemedi");
  await expect(result).toContainText("Servise ulaşılamadı veya servis hata döndürdü.");
  await expect(result).toHaveAttribute("role", "alert");

  // Kaydedilmemiş adres varken test kayıtlı adresle yapılır (not)
  await url.fill("https://wa2.ornek.com");
  await expect(page.getByTestId("wa-test-dirty")).toBeVisible();
  await page.getByTestId("save-bar-reset").click();
  await expect(page.getByTestId("wa-test-dirty")).toHaveCount(0);

  // Ortam değişkenine dön → alertdialog (odak Vazgeç) → env
  await page.getByTestId("wa-svc-reset").click();
  const dlg = page.getByTestId("wa-svc-reset-dialog");
  await expect(dlg).toHaveJSProperty("open", true);
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  expect(await axeScan(page, '[data-testid="wa-svc-reset-dialog"]')).toEqual([]);
  const del = page.waitForRequest((r) => r.method() === "DELETE" && r.url().endsWith(API));
  await dlg.getByTestId("wa-svc-reset-confirm").click();
  await del;
  await expect(page.getByTestId("setting-source")).toHaveText("Ortam değişkeni");
  await expect(page.getByTestId("wa-svc-effective")).toHaveText("http://10.20.0.5:3000");
  await expect(url).toHaveValue("");
  await expect(page.getByTestId("wa-svc-reset")).toHaveCount(0);
});

test("AC-196 test 5/dk sınırı: 6. deneme 429 mesajı (kilit tonu)", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInAu(context, "ausa");
  await open(page);
  await page.getByTestId("wa-test-phone").fill("05320000000");
  const result = page.getByTestId("wa-test-result");
  for (let i = 0; i < 5; i++) {
    const r = page.waitForResponse((x) => x.url().endsWith(`${API}/test`));
    await page.getByTestId("wa-test-send").click();
    expect((await r).status()).toBe(200);
    await expect(result).toContainText("Test mesajı gönderildi");
  }
  await page.getByTestId("wa-test-send").click();
  await expect(result).toContainText("Çok fazla test denendi");
  await expect(result).toHaveAttribute("role", "alert");
});

test("AC-196 güvensiz adres: uyarı kutusu; test isteği gönderilmeden hata", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInAu(context, "ausains");
  await open(page);
  // AC-196 metni (sözleşme sabiti) ilk cümle, TLS/özel ağ ipucu ikinci cümle
  await expect(page.getByTestId("wa-svc-insecure")).toHaveText(`${WA_INSECURE_WARNING}. Kalıcı çözüm TLS veya özel ağ.`);
  await expect(page.getByTestId("setting-source")).toHaveText("Panel");
  await expect(page.getByTestId("wa-svc-url")).toHaveValue("http://203.0.113.50:3000");
  await page.getByTestId("wa-test-phone").fill("05320000000");
  await page.getByTestId("wa-test-send").click();
  await expect(page.getByTestId("wa-test-result")).toContainText("Servis güvenli yapılandırılmamış.");
  // Özel ağ adresine geçince uyarı kalkar
  await page.getByTestId("wa-svc-url").fill("http://10.0.0.5:3000");
  await page.getByTestId("save-bar-save").click();
  await expect(page.getByTestId("wa-svc-insecure")).toHaveCount(0);
  expect(await axeScan(page, "#icerik")).toEqual([]);
});

test("AC-196 boş durum: servis yapılandırılmamış → yönlendirici bilgi, test pasif; kayıtla etkinleşir", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInAu(context, "ausawa0");
  await open(page);
  await expect(page.getByTestId("wa-svc-empty")).toContainText("yapılandırılmamış");
  await expect(page.getByTestId("wa-svc-effective")).toHaveText("Yapılandırılmamış");
  await expect(page.getByTestId("wa-test-send")).toBeDisabled();
  await expect(page.getByTestId("wa-test-disabled")).toBeVisible();
  await page.getByTestId("wa-svc-url").fill("https://wa.ornek.com");
  await page.getByTestId("save-bar-save").click();
  await expect(page.getByTestId("wa-svc-empty")).toHaveCount(0);
  await expect(page.getByTestId("wa-test-send")).toBeEnabled();
  // Ortama dön → yine boş durum
  await page.getByTestId("wa-svc-reset").click();
  await page.getByTestId("wa-svc-reset-dialog").getByTestId("wa-svc-reset-confirm").click();
  await expect(page.getByTestId("wa-svc-empty")).toBeVisible();
});

test("AC-196 hata durumu: yükleme hatası → Tekrar dene", async ({ page, context }) => {
  await signInAu(context, "ausabrk");
  await page.goto("/admin/settings/whatsapp");
  await expect(page.getByTestId("load-error")).toBeVisible();
  await page.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(page.getByTestId("wa-svc-form")).toBeVisible();
  await expect(page.getByTestId("load-error")).toHaveCount(0);
});

test("AC-196 yalnız Super Admin: Admin'de sekme/form yok, yetkisiz durumu", async ({ page, context }) => {
  await signInAu(context, "auadm");
  await page.goto("/admin/settings/whatsapp");
  await expect(page.getByTestId("system-forbidden")).toBeVisible();
  await expect(page.getByTestId("system-tabs")).toHaveCount(0);
  await expect(page.getByTestId("wa-svc-form")).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`AC-196 axe (${scheme}) + 1280/390 px taşma: WhatsApp servisi (güvensiz + test sonucu)`, async ({ page, context }, info) => {
    desktopOnly(info.project.name);
    await page.emulateMedia({ colorScheme: scheme });
    await signInAu(context, "ausains");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 600 ? 800 : 844 });
      await open(page);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain(scheme);
      await page.getByTestId("wa-test-phone").fill("05320000000");
      await page.getByTestId("wa-test-send").click();
      await expect(page.getByTestId("wa-test-result")).toBeVisible();
      await page.getByTestId("wa-svc-url").fill("http://203.0.113.51:3000");
      await expect(page.getByTestId("save-bar")).toBeVisible();
      await noHorizontalOverflow(page);
      expect(await axeScan(page), `whatsapp ${width}`).toEqual([]);
      if (width < 600) {
        // Dokunma hedefi ≥ 44 px
        const box = await page.getByTestId("wa-test-send").boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await page.getByTestId("save-bar-reset").click();
    }
  });
}
