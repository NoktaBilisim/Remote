import { expect, test, type Page } from "@playwright/test";
import { agentLog, agentSend, startFakeAgent } from "./fake-agent";
import { axeScan, guardConsole, newSession, noHorizontalOverflow, signIn } from "./helpers";

// P28g · AC-397 (kopyalanabilir komut, S-P28g-6), AC-403 (Linux algılama + AC-396 düzeni, availability linux), AC-27 (ARM / ChromeOS /
// Android yalnız tarayıcı), AC-399 (konsolda "Müşterinin masaüstü uzaktan kontrole izin vermiyor (Wayland)").
// Playwright'ın UA ezmesi `navigator.userAgentData`'yı (ana makine: macOS/arm) değiştirmez → UA-CH addInitScript ile sabitlenir.
guardConsole(/^Failed to load resource: (the server responded with a status of (404|410|429|500|503)|net::ERR_FAILED)/);
const tok = (ch: string) => `/session/${ch.repeat(43)}`;
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const AVAIL = "**/api/v1/public/agent/availability";
const COMMAND = String.raw` d="$(xdg-user-dir DOWNLOAD)" && [ -d "$d" ] && cd "$d" && f="$(find . -maxdepth 1 -type f -mmin -10 -regextype posix-extended -regex './Destek-[0-9]{8}( ?\([0-9]{1,3}\))?' -printf '%f\n')" && [ -n "$f" ] && { [ "$(printf '%s\n' "$f" | wc -l)" -eq 1 ] || { echo "İndirilenler'deki eski Destek-* dosyalarını silip yeniden indirin"; false; }; } && chmod u+x -- "$f" && ./"$f"`;
const NEVER =
  "Nokta Destek size bundan başka komut vermez; bu komutu yalnız bu sayfadan kopyalayın — sohbet, e-posta ya da telefonla verilen komutu çalıştırmayın.";

/** UA-CH: platform Linux + mimari (`null` = getHighEntropyValues reddeder, `"none"` = UA-CH yok, Firefox gibi). */
async function uaCh(page: Page, arch: { architecture: string; bitness: string } | null | "none") {
  await page.addInitScript((a) => {
    const data =
      a === "none"
        ? undefined
        : {
            mobile: false,
            platform: "Linux",
            brands: [],
            getHighEntropyValues: () => (a === null ? Promise.reject(new Error("x")) : Promise.resolve(a)),
          };
    Object.defineProperty(navigator, "userAgentData", { get: () => data });
  }, arch);
}
const avail = (page: Page, body: unknown, status = 200) => page.route(AVAIL, (r) => r.fulfill({ status, json: body }));

test.describe("karşılama (Linux masaüstü)", () => {
  test.use({ userAgent: LINUX });
  test.beforeEach(({}, info) => test.skip(info.project.name === "mobile", "Linux masaüstü senaryosu"));

  test("AC-403: Linux x86_64'te birincil 'uygulamayı indir' + ikincil tarayıcı; indirme os=linux → uzantısız Destek-<8 hane>", async ({
    page,
  }) => {
    await uaCh(page, { architecture: "x86", bitness: "64" });
    await page.goto(tok("A"));
    const dl = page.getByTestId("agent-download");
    await expect(dl).toBeVisible();
    await expect(dl).toHaveAttribute("data-os", "linux");
    await expect(dl).toHaveAttribute("href", /^\/api\/v1\/public\/agent\/download\?ref=[^&]+&os=linux$/);
    await expect(dl).toContainText("Ubuntu 22.04 / 24.04");
    await expect(page.getByTestId("join-browser")).toContainText("Tarayıcıdan yalnızca görüntü paylaş");
    const [dlBox, brBox] = [await dl.boundingBox(), await page.getByTestId("join-browser").boundingBox()];
    expect(dlBox!.y).toBeLessThan(brBox!.y);
    await expect(page.getByTestId("linux-guide")).toBeVisible();
    await expect(page.getByTestId("smartscreen-guide")).toHaveCount(0);
    await expect(page.getByTestId("mac-guide")).toHaveCount(0);
    await expect(page.getByTestId("linux-path-files")).toContainText("Program olarak çalıştır");
    await expect(page.getByTestId("linux-never-command")).toHaveText(NEVER);
    await expect(page.getByTestId("linux-guide")).toContainText(/doğrulama kodu \d{4}, sunucu adresi localhost:\d+/);
    expect(await axeScan(page)).toEqual([]);
    await noHorizontalOverflow(page);

    const download = page.waitForEvent("download");
    await dl.click();
    expect((await download).suggestedFilename()).toMatch(/^Destek-\d{8}$/);
    await expect(page.getByTestId("agent-started")).toContainText("İndirme başladı");
    await expect(page.getByTestId("linux-guide")).toHaveClass(/border-primary/);
  });

  test("AC-397 / S-P28g-6: görünen komut = panoya kopyalanan = sabit (satır sonu yok, sudo yok)", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await uaCh(page, { architecture: "x86", bitness: "64" });
    await page.goto(tok("A"));
    const code = page.getByTestId("linux-command");
    expect(await code.textContent()).toBe(COMMAND);
    await page.getByTestId("linux-copy").getByRole("button", { name: "Başlatma komutunu kopyala" }).click();
    await expect(page.getByTestId("linux-copy")).toHaveAttribute("data-state", "copied");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(COMMAND);
    expect(clip).not.toMatch(/[\r\n]|sudo/);
  });

  test("pano reddi: komut salt okunur alanda seçili gösterilir (aynı metin)", async ({ page }) => {
    await uaCh(page, { architecture: "x86", bitness: "64" });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { get: () => ({ writeText: () => Promise.reject(new Error("deny")) }) });
    });
    await page.goto(tok("A"));
    await page.getByTestId("linux-copy").getByRole("button").click();
    const manual = page.getByTestId("copy-link-manual");
    await expect(manual).toBeFocused();
    await expect(manual).toHaveValue(COMMAND);
    await expect(page.getByText("Panoya erişilemedi; komut seçildi")).toBeVisible();
  });

  test("Firefox gibi UA-CH yok → UA'ya göre Linux x86_64, indirme gösterilir", async ({ page }) => {
    await uaCh(page, "none");
    await page.goto(tok("A"));
    await expect(page.getByTestId("agent-download")).toHaveAttribute("data-os", "linux");
  });

  for (const [name, arch] of [
    ["ARM (indirgenmiş UA x86_64 yazsa da)", { architecture: "arm", bitness: "64" }],
    ["UA-CH okunamadı", null],
  ] as const) {
    test(`AC-27: ${name} → indirme yok, yalnız tarayıcı (birincil)`, async ({ page }) => {
      await uaCh(page, arch);
      await page.goto(tok("A"));
      await expect(page.getByTestId("join-browser")).toContainText("Yalnız ekranımı tarayıcıdan paylaş");
      await expect(page.getByTestId("agent-download")).toHaveCount(0);
      await expect(page.getByTestId("agent-download-loading")).toHaveCount(0);
    });
  }

  for (const [name, status, body] of [
    ["linux:false", 200, { windows: true, macos: true, linux: false }],
    ["linux alanı yok (eski sunucu)", 200, { windows: true, macos: true }],
    ["500", 500, { error: { code: "INTERNAL", message: "x", requestId: "r" } }],
    ["429", 429, { error: { code: "RATE_LIMITED", message: "x", requestId: "r" } }],
  ] as const) {
    test(`S-P28g-12: availability ${name} → fail-closed, yalnız tarayıcı`, async ({ page }) => {
      await uaCh(page, { architecture: "x86", bitness: "64" });
      await avail(page, body, status);
      await page.goto(tok("A"));
      await expect(page.getByTestId("join-browser")).toContainText("Yalnız ekranımı tarayıcıdan paylaş");
      await expect(page.getByTestId("agent-download")).toHaveCount(0);
      await expect(page.getByTestId("linux-guide")).toHaveCount(0);
    });
  }

  test("yükleniyor: availability beklenirken iskelet, tarayıcı yolu kullanılabilir", async ({ page }) => {
    await uaCh(page, { architecture: "x86", bitness: "64" });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(AVAIL, async (r) => {
      await gate;
      await r.fulfill({ json: { windows: true, macos: true, linux: true, macosTestBuild: false } });
    });
    await page.goto(tok("A"));
    await expect(page.getByTestId("agent-download-loading")).toBeVisible();
    await page.getByTestId("guest-name").fill("Ayşe Yılmaz");
    await page.getByTestId("guest-consent").check();
    await expect(page.getByTestId("join-browser")).toBeEnabled();
    release();
    await expect(page.getByTestId("agent-download")).toBeVisible();
    await expect(page.getByTestId("agent-download-loading")).toHaveCount(0);
  });

  test("Linux istemci yayında değil (503 NOT_READY) → tarayıcı modu önerilir", async ({ page }) => {
    await uaCh(page, { architecture: "x86", bitness: "64" });
    await page.goto(tok("D"));
    await page.getByTestId("agent-download").click();
    await expect(page.getByTestId("agent-not-ready")).toContainText("Hızlı Destek şu anda indirilemiyor");
    await page.getByTestId("agent-to-browser").click();
    await expect(page.getByTestId("guest-name")).toBeFocused();
  });

  test("390 px koyu tema: yatay taşma yok (uzun komut CSS ile sarılır), axe 0", async ({ page }) => {
    await uaCh(page, { architecture: "x86", bitness: "64" });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(tok("A"));
    await expect(page.getByTestId("linux-guide")).toBeVisible();
    await noHorizontalOverflow(page);
    const btn = await page.getByTestId("linux-copy").getByRole("button").boundingBox();
    expect(btn!.height).toBeGreaterThanOrEqual(44);
    expect(await axeScan(page)).toEqual([]);
  });

  test("1280 px açık tema axe 0", async ({ page }) => {
    await uaCh(page, { architecture: "x86", bitness: "64" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(tok("A"));
    await expect(page.getByTestId("linux-guide")).toBeVisible();
    expect(await axeScan(page)).toEqual([]);
    await noHorizontalOverflow(page);
  });
});

for (const [name, ua] of [
  ["ChromeOS", "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"],
  ["Linux aarch64 (Firefox)", "Mozilla/5.0 (X11; Linux aarch64; rv:140.0) Gecko/20100101 Firefox/140.0"],
] as const) {
  test.describe(`AC-27: ${name}`, () => {
    test.use({ userAgent: ua });
    test("indirme yok, yalnız tarayıcı", async ({ page }, info) => {
      test.skip(info.project.name === "mobile", "masaüstü UA");
      await uaCh(page, "none");
      await page.goto(tok("A"));
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByTestId("join-browser")).toContainText("Yalnız ekranımı tarayıcıdan paylaş");
      await expect(page.getByTestId("agent-download")).toHaveCount(0);
    });
  });
}

test.describe("konsol (AC-399)", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "konsol masaüstü akışı"));
  test("WAYLAND_NO_CONTROL → 'Müşterinin masaüstü uzaktan kontrole izin vermiyor (Wayland)', ret değil, bekleme yok", async ({
    page,
    context,
    browser,
  }) => {
    await signIn(context, "p7");
    const { id } = await newSession(page);
    await page.goto(`/sessions/${id}/console`);
    await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
    const a = await startFakeAgent(browser, id);
    await expect(page.getByTestId("console-status")).toHaveText("Aktif");
    const req = page.getByTestId("control-request");
    await req.click();
    await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(1);
    await agentSend(a, { t: "control.state", state: "VIEW", source: "WAYLAND_NO_CONTROL" });
    const note = page.getByTestId("control-note");
    await expect(note).toContainText("Müşterinin masaüstü uzaktan kontrole izin vermiyor (Wayland)");
    await expect(page.getByTestId("control-bar")).toHaveAttribute("data-phase", "ended");
    await expect(page.getByText("Kontrol reddedildi")).toHaveCount(0);
    await expect(req).toBeEnabled();
    expect(await note.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    expect(await axeScan(page)).toEqual([]);
    await a.context().close();
  });
});
