import { PORTAL_CSRF_COOKIE, PORTAL_SESSION_COOKIE, PORTAL_TENANT_COOKIE } from "@remote/contracts/api/portal";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { axeScan, desktopOnly, guardConsole, noHorizontalOverflow, signIn } from "./helpers";

// P31 · AC-520 (web): /r/<ref> (ve portal) kabul kartında macOS'ta "Nokta Destek'i (macOS) indirin" + `&os=macos` + düğmenin
// yanında kaynağa çapalı "Yine de Aç" uyarısı (gm.adhocOnlyBody) ve firma adı cümlesi; macOS kapısı kapalı/hatalıysa bugünkü
// Windows bağlantısı (fail-closed); Linux değişmez (AC-521). Panel ayarı, müşteri kartı ve portalda "Bu bağlantı Mac'te …" notu.
// Sahte API: e2e/mock-p19.mjs (+ mock-sessions availability, mock-customers, mock-p21). Availability page.route ile ezilir.
guardConsole(/^Failed to load resource: (the server responded with a status of (400|404|429|500|503)|net::ERR_FAILED)/);

const MOCK = "http://127.0.0.1:4217";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const AVAIL = "**/api/v1/public/agent/availability";
const A32 = "abcdefghijklmnopqrstuvwxyz234567";
const sfx = () => Array.from({ length: 8 }, () => A32[Math.floor(Math.random() * 32)]).join("");
const uniqueRef = () => `webformz${sfx()}`;
const BASE = (ref: string) => `/api/v1/public/agent/request-download?ref=${ref}`;
const ONLY = "paylaşılan sahte durum + masaüstü UA: tek proje";

test.use({ userAgent: MAC });
test.beforeEach(({}, info) => desktopOnly(info.project.name, ONLY));

const avail = (page: Page, body: unknown, status = 200) => page.route(AVAIL, (r) => r.fulfill({ status, json: body }));

/** /r/<ref> formu doldur → gönder → bekleme → teknisyen kabulü (sahte /ws/request). */
async function toAccepted(page: Page, ref: string) {
  await page.goto(`/r/${ref}`);
  await page.getByTestId("wr-name").fill("Ayşe Yılmaz");
  await page.getByTestId("wr-phone").fill("0532 111 22 33");
  await page.getByTestId("wr-desc").fill("Yazıcı çalışmıyor");
  await page.getByTestId("wr-consent").check();
  await expect(page.getByTestId("wr-submit")).toBeEnabled({ timeout: 5000 });
  await page.getByTestId("wr-submit").click();
  await expect(page.getByTestId("wr-waiting")).toBeVisible();
  await page.request.get(`${MOCK}/__e2e/p19/accept/${ref}`);
  await expect(page.getByTestId("wr-accepted")).toContainText("Selin Teknik");
}

test("AC-520: macOS (ad-hoc) kabul kartı → Mac metni, &os=macos, düğme yanında kaynağa çapalı uyarı + firma adı cümlesi", async ({
  page,
}) => {
  const ref = uniqueRef();
  await toAccepted(page, ref);
  const dl = page.getByTestId("wr-download");
  await expect(dl).toHaveAttribute("href", `${BASE(ref)}&os=macos`);
  await expect(dl).toHaveAttribute("data-os", "macos");
  await expect(dl).toHaveText("Uzaktan kontrol gerekiyorsa Nokta Destek'i (macOS) indirin");
  const warn = page.getByTestId("wr-mac-adhoc-only");
  await expect(warn).toContainText(/yalnız tarayıcınızda localhost:\d+ adresinden indirdiğiniz Nokta Destek için kullanın/);
  await expect(warn).toContainText(/“Nereden” satırı https:\/\/localhost:\d+\/ ile başlamalı/);
  await expect(warn).toContainText("Firmanız size yalnız bağlantı gönderir, dosya göndermez. Dosya ek olarak geldiyse açmayın.");
  await expect(page.getByTestId("wr-mac-firm-note")).toHaveText(
    "Pencerede firmanızın adı ya da teknisyen doğrulama kodu görünür; bu yalnız doğru firmaya bağlandığınızı gösterir, dosyanın güvenli olduğunu göstermez.",
  );
  // uyarı indirme bağlantısının hemen altında, kartın içinde
  const [d, w] = [await dl.boundingBox(), await warn.boundingBox()];
  expect(w!.y).toBeGreaterThan(d!.y);
  expect(w!.y - (d!.y + d!.height)).toBeLessThan(24);
  expect(d!.height).toBeGreaterThanOrEqual(44);
});

test("AC-520: macOS kapısı kapalı → bugünkü Windows bağlantısı, uyarı yok (gerileme yok)", async ({ page }) => {
  await avail(page, { windows: true, macos: false, linux: true, macosTestBuild: false, macosSigning: null });
  const ref = uniqueRef();
  await toAccepted(page, ref);
  await expect(page.getByTestId("wr-download")).toHaveAttribute("href", BASE(ref));
  await expect(page.getByTestId("wr-download")).toHaveText("Uzaktan kontrol gerekiyorsa Windows programını indirin");
  await expect(page.getByTestId("wr-mac-adhoc-only")).toHaveCount(0);
});

for (const [name, status] of [
  ["429", 429],
  ["500", 500],
] as const)
  test(`AC-520 / S-P28f-15: availability ${name} → Windows bağlantısı (fail-closed)`, async ({ page }) => {
    await avail(page, { error: { code: "X", message: "x" } }, status);
    const ref = uniqueRef();
    await toAccepted(page, ref);
    await expect(page.getByTestId("wr-download")).toHaveAttribute("href", BASE(ref));
    await expect(page.getByTestId("wr-mac-adhoc-only")).toHaveCount(0);
  });

test("AC-520: notarize derleme → &os=macos, 'Yine de Aç' uyarısı yok", async ({ page }) => {
  await avail(page, { windows: true, macos: true, linux: true, macosTestBuild: false, macosSigning: "notarized" });
  const ref = uniqueRef();
  await toAccepted(page, ref);
  await expect(page.getByTestId("wr-download")).toHaveAttribute("href", `${BASE(ref)}&os=macos`);
  await expect(page.getByTestId("wr-mac-adhoc-only")).toHaveCount(0);
});

test("AC-520: availability yanıtı gecikirse kabul kartında iskelet, bağlantı yok; yanıtla Mac bağlantısı", async ({ page }) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(AVAIL, async (r) => {
    await gate;
    await r.fulfill({ status: 200, json: { windows: true, macos: true, linux: true, macosTestBuild: false, macosSigning: "adhoc" } });
  });
  const ref = uniqueRef();
  await toAccepted(page, ref);
  await expect(page.getByTestId("wr-download-loading")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("wr-download")).toHaveCount(0);
  release();
  await expect(page.getByTestId("wr-download")).toHaveAttribute("href", `${BASE(ref)}&os=macos`);
  await expect(page.getByTestId("wr-download-loading")).toHaveCount(0);
});

test.describe("AC-521: Linux", () => {
  test.use({ userAgent: LINUX });
  test("Linux UA → bugünkü Windows bağlantısı (os eki yok)", async ({ page }) => {
    const ref = uniqueRef();
    await toAccepted(page, ref);
    await expect(page.getByTestId("wr-download")).toHaveAttribute("href", BASE(ref));
    await expect(page.getByTestId("wr-mac-adhoc-only")).toHaveCount(0);
  });
});

/** Kabul kartı: iki tema × 390/1280 px, taşma yok, axe 0. */
async function scanAccepted(browser: Browser) {
  for (const width of [390, 1280])
    for (const scheme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: scheme,
        reducedMotion: "reduce",
        userAgent: MAC,
      });
      const p = await ctx.newPage();
      await toAccepted(p, uniqueRef());
      await expect(p.getByTestId("wr-mac-adhoc-only")).toBeVisible();
      await noHorizontalOverflow(p);
      expect(await axeScan(p), `/r/ kabul (macOS) ${scheme} ${width}`).toEqual([]);
      await ctx.close();
    }
}

test("AC-520: macOS kabul kartı iki temada, 390 ve 1280 px'te axe 0, taşma yok", async ({ browser }) => {
  test.setTimeout(120_000);
  await scanAccepted(browser);
});

async function portalIn(context: BrowserContext) {
  const token = `p-ok-${sfx()}`;
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
  await context.addCookies([
    { ...base, name: PORTAL_SESSION_COOKIE, value: token, httpOnly: true },
    { ...base, name: PORTAL_CSRF_COOKIE, value: "portal-csrf-test" },
    { domain: "localhost", path: "/", name: PORTAL_TENANT_COOKIE, value: "acme", sameSite: "Lax" },
  ]);
  return token;
}

test("AC-520: portal — ana sayfada Mac notu; yeni talep kabul kartında mutlak adrese &os=macos", async ({ page, context }) => {
  const token = await portalIn(context);
  await page.goto("/portal");
  await expect(page.getByTestId("portal-mac-note")).toHaveText("Bu bağlantı Mac'te macOS uygulamasını (.zip) indirir.");
  await expect(page.getByTestId("portal-download")).toHaveAttribute("aria-label", /\.zip\) indirir\.$/);
  const ref = `webformz${token.slice(-8)}`;
  await page.goto("/portal/new-request");
  await page.getByTestId("wr-phone").fill("0532 111 22 33");
  await page.getByTestId("wr-desc").fill("Yazıcı çalışmıyor");
  await page.getByTestId("wr-consent").check();
  await page.getByTestId("wr-submit").click();
  await expect(page.getByTestId("wr-waiting")).toBeVisible();
  await page.request.get(`${MOCK}/__e2e/p19/accept/${ref}`);
  await expect(page.getByTestId("wr-download")).toHaveAttribute("href", new RegExp(`request-download\\?ref=${ref}&os=macos$`));
  await expect(page.getByTestId("wr-mac-adhoc-only")).toBeVisible();
});

test("AC-520: panel — destek talebi ayarı, genel bağlantı ve müşteri kartında Mac notu", async ({ page, context }) => {
  const NOTE = "Bu bağlantı Mac'te macOS uygulamasını (.zip) indirir.";
  await signIn(context, "rqcu");
  await page.goto("/customers");
  await expect(page.getByTestId("general-mac-note")).toHaveText(NOTE);
  await page.goto("/customers/01JC5ST0000000000000000001");
  await expect(page.getByTestId("customer-mac-note")).toHaveText(NOTE);
  await page.goto("/settings/support-requests");
  await expect(page.getByTestId("download-mac-note")).toHaveText(NOTE);
  expect(await axeScan(page)).toEqual([]);
});
