import { expect, test, type Page } from "@playwright/test";
import { axeScan, guardConsole, noHorizontalOverflow } from "./helpers";

// P28f · AC-396 (macOS'ta Windows ile aynı düzen), AC-390 (indirme yalnız availability macos:true iken; hata → yalnız tarayıcı,
// S-P28f-15), AC-391 (izin rehberi), S-P28f-8 (prod sayfası "asla Yine de Aç istemez"). Sahte API: e2e/mock-sessions.mjs.
// Beklenen ağ kayıtları: availability 429/500 ve kesilen istek (ağ hatası senaryosu)
guardConsole(/^Failed to load resource: (the server responded with a status of (404|410|429|500|503)|net::ERR_FAILED)/);
const tok = (ch: string) => `/session/${ch.repeat(43)}`;
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const AVAIL = "**/api/v1/public/agent/availability";
const avail = (page: Page, body: unknown, status = 200) =>
  page.route(AVAIL, (r) => r.fulfill({ status, json: body, headers: status === 429 ? { "Retry-After": "60" } : {} }));

test.use({ userAgent: MAC });
test.beforeEach(({}, info) => test.skip(info.project.name === "mobile", "macOS masaüstü senaryosu"));

test("AC-396: macOS'ta birincil 'uygulamayı indir' + ikincil tarayıcı; indirme os=macos → Destek-<8 hane>.zip", async ({ page }) => {
  await page.goto(tok("A"));
  const dl = page.getByTestId("agent-download");
  await expect(dl).toBeVisible();
  await expect(dl).toContainText("uygulamasını indir");
  await expect(dl).toContainText("macOS 13 veya üstü");
  await expect(dl).toHaveAttribute("data-os", "macos");
  await expect(dl).toHaveAttribute("href", /^\/api\/v1\/public\/agent\/download\?ref=[^&]+&os=macos$/);
  await expect(page.getByTestId("join-browser")).toContainText("Tarayıcıdan yalnızca görüntü paylaş");
  const [dlBox, brBox] = [await dl.boundingBox(), await page.getByTestId("join-browser").boundingBox()];
  expect(dlBox!.y).toBeLessThan(brBox!.y);
  expect(dlBox!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByTestId("smartscreen-guide")).toHaveCount(0);

  // AC-391 rehberi + S-P28f-8 (prod metni): "Yine de Aç" adımı yok, "asla istemez" uyarısı var
  const guide = page.getByTestId("mac-guide");
  await expect(guide).toHaveAttribute("data-build", "signed");
  await expect(page.getByTestId("mac-perm-screen")).toContainText("Ekran Kaydı");
  await expect(page.getByTestId("mac-perm-ax")).toContainText("Erişilebilirlik");
  await expect(page.getByTestId("mac-perm-mic")).toContainText("Mikrofon");
  await expect(page.getByTestId("mac-never-open-anyway")).toContainText("Nokta Destek hiçbir zaman “Yine de Aç” istemez");
  await expect(guide).not.toContainText("Gizlilik ve Güvenlik → Yine de Aç");
  await expect(page.getByTestId("mac-test-build")).toHaveCount(0);
  await expect(guide).toContainText(/doğrulama kodu \d{4}, sunucu adresi localhost:\d+/);
  expect(await axeScan(page)).toEqual([]);
  await noHorizontalOverflow(page);

  const download = page.waitForEvent("download");
  await dl.click();
  expect((await download).suggestedFilename()).toMatch(/^Destek-\d{8}\.zip$/);
  await expect(page.getByTestId("agent-started")).toContainText("İndirme başladı");
  await expect(page).toHaveURL(tok("A"));
  await expect(guide).toHaveClass(/border-primary/);
});

test("S-P28f-8: staging (availability macosTestBuild:true) → rehber TEST sürümü (Yine de Aç adımı + TEST uyarısı)", async ({ page }) => {
  await avail(page, { windows: true, macos: true, macosTestBuild: true });
  await page.goto(tok("A"));
  await expect(page.getByTestId("agent-download")).toBeVisible();
  await expect(page.getByTestId("mac-guide")).toHaveAttribute("data-build", "test");
  await expect(page.getByTestId("mac-test-build")).toBeVisible();
  await expect(page.getByTestId("mac-never-open-anyway")).toHaveCount(0);
});

test("AC-390: availability macos:false → indirme yok, yalnız tarayıcı (birincil)", async ({ page }) => {
  await avail(page, { windows: true, macos: false });
  await page.goto(tok("A"));
  await expect(page.getByTestId("join-browser")).toContainText("Yalnız ekranımı tarayıcıdan paylaş");
  await expect(page.getByTestId("agent-download")).toHaveCount(0);
  await expect(page.getByTestId("agent-download-loading")).toHaveCount(0);
  await expect(page.getByTestId("mac-guide")).toHaveCount(0);
});

for (const [name, status, body] of [
  ["500", 500, { error: { code: "INTERNAL", message: "x", requestId: "r" } }],
  ["429", 429, { error: { code: "RATE_LIMITED", message: "x", requestId: "r" } }],
  ["şema dışı yanıt", 200, { macos: "yes" }],
] as const) {
  test(`S-P28f-15: availability ${name} → fail-closed, yalnız tarayıcı`, async ({ page }) => {
    await avail(page, body, status);
    await page.goto(tok("A"));
    await expect(page.getByTestId("join-browser")).toContainText("Yalnız ekranımı tarayıcıdan paylaş");
    await expect(page.getByTestId("agent-download")).toHaveCount(0);
  });
}

test("S-P28f-15: availability ağ hatası → yalnız tarayıcı", async ({ page }) => {
  await page.route(AVAIL, (r) => r.abort("failed"));
  await page.goto(tok("A"));
  await expect(page.getByTestId("join-browser")).toContainText("Yalnız ekranımı tarayıcıdan paylaş");
  await expect(page.getByTestId("agent-download")).toHaveCount(0);
});

test("yükleniyor: availability beklenirken iskelet, tarayıcı yolu kullanılabilir", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(AVAIL, async (r) => {
    await gate;
    await r.fulfill({ json: { windows: true, macos: true } });
  });
  await page.goto(tok("A"));
  await expect(page.getByTestId("agent-download-loading")).toBeVisible();
  await page.getByTestId("guest-name").fill("Ayşe Yılmaz");
  await page.getByTestId("guest-consent").check();
  await expect(page.getByTestId("join-browser")).toBeEnabled();
  expect(await axeScan(page)).toEqual([]);
  release();
  await expect(page.getByTestId("agent-download")).toBeVisible();
  await expect(page.getByTestId("agent-download-loading")).toHaveCount(0);
});

test("AC-390: macOS istemci yayında değil (503 NOT_READY) → tarayıcı modu önerilir", async ({ page }) => {
  await page.goto(tok("D"));
  await page.getByTestId("agent-download").click();
  await expect(page.getByTestId("agent-not-ready")).toContainText("Hızlı Destek şu anda indirilemiyor");
  await page.getByTestId("agent-to-browser").click();
  await expect(page.getByTestId("guest-name")).toBeFocused();
});

test("AC-396: 375 px yatay taşma yok, koyu temada axe 0", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(tok("A"));
  await expect(page.getByTestId("mac-guide")).toBeVisible();
  await noHorizontalOverflow(page);
  expect(await axeScan(page)).toEqual([]);
});

test("AC-396: 1280 px açık temada axe 0", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(tok("A"));
  await expect(page.getByTestId("mac-guide")).toBeVisible();
  expect(await axeScan(page)).toEqual([]);
  await noHorizontalOverflow(page);
});

test.describe("iPad (masaüstü modu Macintosh UA)", () => {
  test.use({ hasTouch: true, isMobile: false });
  test("Mac sayılmaz: indirme yok", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 }));
    await page.goto(tok("A"));
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByTestId("agent-download")).toHaveCount(0);
    await expect(page.getByTestId("agent-download-loading")).toHaveCount(0);
  });
});
