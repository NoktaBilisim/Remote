import { expect, test } from "@playwright/test";
import { axeScan, guardConsole, noHorizontalOverflow } from "./helpers";

// P6 · AC-27: Windows masaüstünde "Hızlı Destek uygulamasını indir" (birincil) + SmartScreen rehberi; tarayıcı ikincil.
// Linux/mobilde yalnız tarayıcı modu; macOS P28f (p28f-macos.spec.ts). 503 NOT_READY → tarayıcı modu önerilir. Sahte API: e2e/mock-sessions.mjs (A/D/G).
guardConsole();
const tok = (ch: string) => `/session/${ch.repeat(43)}`;
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

test.describe("Windows masaüstü", () => {
  test.use({ userAgent: WIN });
  test.beforeEach(({}, info) => test.skip(info.project.name === "mobile", "Windows masaüstü senaryosu"));

  test("AC-27: birincil indirme + SmartScreen rehberi aynı adımda; indirme Destek-<8 hane>.exe", async ({ page }) => {
    await page.goto(tok("A"));
    const dl = page.getByTestId("agent-download");
    await expect(dl).toBeVisible();
    await expect(dl).toContainText("Hızlı Destek uygulamasını indir");
    await expect(dl).toHaveAttribute("href", /^\/api\/v1\/public\/agent\/download\?ref=[^&]+$/);
    // İndirme ad/onaya bağlı değil (istemci kendi onayını ister); tarayıcı yolu ikincil ve AC metniyle
    await expect(page.getByTestId("join-browser")).toContainText("Uygulama çalışmıyor mu? Tarayıcıdan yalnızca görüntü paylaş");
    const guide = page.getByTestId("smartscreen-guide");
    await expect(guide).toContainText("Ek bilgi");
    await expect(guide).toContainText("Yine de çalıştır");
    await expect(guide).toContainText("imzasız");
    await expect(guide).toContainText(/doğrulama kodu \d{4}, sunucu adresi localhost:\d+/);
    // Birincil yol tarayıcı yolundan önce
    const [dlBox, brBox] = [await dl.boundingBox(), await page.getByTestId("join-browser").boundingBox()];
    expect(dlBox!.y).toBeLessThan(brBox!.y);
    expect(dlBox!.height).toBeGreaterThanOrEqual(44);
    expect(await axeScan(page)).toEqual([]);
    await noHorizontalOverflow(page);

    const download = page.waitForEvent("download");
    await dl.click();
    expect((await download).suggestedFilename()).toMatch(/^Destek-\d{8}\.exe$/);
    await expect(page.getByTestId("agent-started")).toContainText("İndirme başladı");
    await expect(page).toHaveURL(tok("A")); // sayfa yerinde kalır
    await expect(dl).toHaveAttribute("data-state", "started");
  });

  test("AC-27: 503 NOT_READY → indirme yok, tarayıcı modu önerilir ve odak ad alanına gider", async ({ page }) => {
    let downloaded = false;
    page.on("download", () => (downloaded = true));
    await page.goto(tok("D"));
    await page.getByTestId("agent-download").click();
    const warn = page.getByTestId("agent-not-ready");
    await expect(warn).toContainText("Hızlı Destek şu anda indirilemiyor");
    await page.getByTestId("agent-to-browser").click();
    await expect(page.getByTestId("guest-name")).toBeFocused();
    await expect(page).toHaveURL(tok("D"));
    expect(downloaded).toBe(false);
    expect(await axeScan(page)).toEqual([]);
  });

  test("AC-27: indirme anında oturum iptal (410) → 'Oturum iptal edildi' ekranı", async ({ page }) => {
    await page.goto(tok("G"));
    await page.getByTestId("agent-download").click();
    await expect(page.getByTestId("guest-cancelled")).toBeVisible();
  });

  test("AC-27: dar pencerede (375 px) yatay taşma yok", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(tok("A"));
    await expect(page.getByTestId("smartscreen-guide")).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test("AC-27: koyu temada okunaklı (axe)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(tok("A"));
    await expect(page.getByTestId("agent-download")).toBeVisible();
    expect(await axeScan(page)).toEqual([]);
  });
});

test.describe("macOS", () => {
  test.use({ userAgent: MAC });
  test.beforeEach(({}, info) => test.skip(info.project.name === "mobile", "masaüstü senaryosu"));

  // P28f AC-396 ile güncellendi: macOS'ta indirme availability'ye bağlı (ayrıntı e2e/p28f-macos.spec.ts)
  test("AC-27 / AC-390: macOS indirmesi yayında değilse yalnız tarayıcı modu", async ({ page }) => {
    await page.route("**/api/v1/public/agent/availability", (r) => r.fulfill({ json: { windows: true, macos: false } }));
    await page.goto(tok("A"));
    await expect(page.getByTestId("join-browser")).toContainText("Yalnız ekranımı tarayıcıdan paylaş");
    await expect(page.getByTestId("agent-download")).toHaveCount(0);
    await expect(page.getByTestId("smartscreen-guide")).toHaveCount(0);
  });
});

test("AC-27: mobilde indirme seçeneği yok", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "mobil senaryosu");
  await page.goto(tok("A"));
  await expect(page.getByTestId("guest-unsupported")).toBeVisible();
  await expect(page.getByTestId("agent-download")).toHaveCount(0);
});
