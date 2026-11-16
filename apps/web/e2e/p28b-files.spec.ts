import { expect, test, type Browser, type Page } from "@playwright/test";
import { agentFsrv, agentSend, startFakeAgent } from "./fake-agent";
import { axeScan, guardConsole, newSession, noHorizontalOverflow, signIn } from "./helpers";

// P28b K4 (mimari-p28b §9; AC-354, 355, 357..363): konsol SERVER modu dosya paneli (yükleme → tarama → teklif → teslim,
// virüslü, taranamadı, gelen dosya indirme), Dosyalar ayarı, ClamAV ayarı, geçmiş "Sunucudaki dosyalar". Sahte API/WS:
// e2e/mock-p28b.mjs + mock-ws.mjs (fsrv taklidi). u-p28b-* SERVER modu oturum; sahte istemci `rs.cap.fsrv1` bildirir.
guardConsole();

const MOCK = "http://127.0.0.1:4217";
const NOTICE = "Dosyalar sunucuda virüs taramasından geçer; bu modda uçtan uca şifreli değildir";

async function live(page: Page, browser: Browser, features = ["rs.cap.fsrv1"]) {
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  const a = await startFakeAgent(browser, id, features);
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await page.getByTestId("collab-side").getByRole("button", { name: "Dosyalar" }).click();
  return { a, id };
}
const upload = (page: Page, name: string, bytes: number) =>
  page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.alloc(bytes, 7) });
/** Koyu tema gerçekten etkin (QA: axe'nin koyu temada koştuğu kanıtlanmalı): tercih "system" + koyu medya veya `dark` sınıfı. */
const expectDark = async (p: Page) =>
  expect(
    await p.evaluate(
      () =>
        document.documentElement.classList.contains("dark") ||
        (!document.documentElement.classList.contains("light") && matchMedia("(prefers-color-scheme: dark)").matches),
    ),
    "koyu tema etkin olmalı",
  ).toBe(true);
const bytesLog = async (page: Page, id: string) =>
  (await (await page.request.get(`${MOCK}/__e2e/fsrv-log/${id}`)).json()) as { urls: string[]; tokens: string[] };

test.describe("konsol", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "konsol masaüstü akışı"));

  test("AC-355/357/363: yükleme (2 parça) → tarama → müşteri onayı → teslim; belirteç URL'de yok; axe 0", async ({
    page,
    context,
    browser,
  }) => {
    await signIn(context, "p28b");
    const { a, id } = await live(page, browser);
    await expect(page.getByTestId("files-panel")).toHaveAttribute("data-mode", "SERVER");
    await expect(page.getByTestId("fsrv-notice")).toHaveText(NOTICE);
    await expect(page.getByTestId("file-send")).toBeEnabled();
    await upload(page, "rapor.txt", 1_048_576 + 2048);
    const row = page.getByTestId("file-row").first();
    await expect(row.getByTestId("file-status")).toHaveText("Müşteri onayı bekleniyor");
    const offer = (await agentFsrv(a)).find((m) => m.t === "fsrv.offer")!;
    expect(offer).toMatchObject({ name: "rapor.txt", size: 1_048_576 + 2048, purpose: "FILE" });
    expect(await axeScan(page, '[data-testid="files-panel"]')).toEqual([]);
    await agentSend(a, { t: "fsrv.accept", fid: offer.fid });
    await expect.poll(async () => (await agentFsrv(a)).some((m) => m.t === "fsrv.download")).toBe(true);
    await agentSend(a, { t: "fsrv.result", fid: offer.fid, ok: true });
    await expect(row.getByTestId("file-status")).toHaveText("Teslim edildi");
    const log = await bytesLog(page, id);
    expect(log.urls.length).toBe(2);
    expect(log.urls.filter((u) => log.tokens.some((tk) => u.includes(tk)))).toEqual([]);
  });

  test("AC-358/359: virüslü ve taranamadı metinleri iki tarafa; teslim yok", async ({ page, context, browser }) => {
    await signIn(context, "p28b");
    const { a } = await live(page, browser);
    await upload(page, "eicar-test.zip", 300);
    await expect(page.getByTestId("file-status").first()).toHaveText("Dosya virüslü bulundu (Eicar-Test-Signature), teslim edilmedi");
    expect((await agentFsrv(a)).some((m) => m.t === "fsrv.status" && m.state === "INFECTED")).toBe(true);
    expect((await agentFsrv(a)).some((m) => m.t === "fsrv.offer")).toBe(false);
    await upload(page, "sifreli.zip", 300);
    await expect(page.getByTestId("file-status").first()).toHaveText("Dosya taranamadı, teslim edilmedi: şifreli arşiv");
    await upload(page, "kota.bin", 300);
    await expect(page.getByTestId("file-status").first()).toHaveText("Firma depolama kotası doldu");
  });

  test("AC-36/116: müşteriden gelen temiz dosya → mevcut kabul diyaloğu → indir + SHA-256 → fsrv.result{ok}", async ({
    page,
    context,
    browser,
  }) => {
    await signIn(context, "p28b");
    const { id } = await live(page, browser);
    expect((await page.request.get(`${MOCK}/__e2e/fsrv-offer/${id}`)).status()).toBe(200);
    const dialog = page.getByTestId("file-offer");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("file-reject")).toBeFocused();
    await expect(page.getByTestId("file-accept")).toBeEnabled({ timeout: 4000 });
    await page.getByTestId("file-accept").click();
    await expect(page.getByTestId("file-status").first()).toHaveText("Tamamlandı (SHA-256 doğrulandı)");
    await expect(page.getByTestId("file-download")).toBeVisible();
    const ws = (await (await page.request.get(`${MOCK}/__e2e/fsrv-ws/${id}`)).json()) as { side: string; m: { t: string; ok?: boolean } }[];
    expect(ws.find((x) => x.m.t === "fsrv.result")?.m.ok).toBe(true);
  });

  test("AC-287: koyu tema + 390 px — SERVER dosya paneli (bilgi satırı + durum satırları) taşmaz; axe 0", async ({
    page,
    context,
    browser,
  }) => {
    await signIn(context, "p28b");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 390, height: 900 });
    await live(page, browser);
    await expectDark(page);
    const panel = page.getByTestId("files-panel");
    await expect(page.getByTestId("fsrv-notice")).toHaveText(NOTICE);
    await upload(page, "eicar-test.zip", 300);
    await expect(page.getByTestId("file-status").first()).toHaveText("Dosya virüslü bulundu (Eicar-Test-Signature), teslim edilmedi");
    await upload(page, `cok-uzun-bir-dosya-adi-${"x".repeat(80)}.txt`, 300);
    await expect(page.getByTestId("file-status").first()).toHaveText("Müşteri onayı bekleniyor");
    // Yön başına tek aktarım: onay beklerken ikinci yükleme → "busy" uyarısı (danger uyarısı da taramaya girer)
    await upload(page, "ikinci.txt", 300);
    await expect(page.getByTestId("file-error")).toHaveText("Devam eden bir gönderim var; bitmesini bekleyin.");
    await noHorizontalOverflow(page);
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await panel.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    expect(await axeScan(page, '[data-testid="files-panel"]')).toEqual([]);
  });

  test("§5.4: SERVER odasında fsrv bildirmeyen istemci → dosya alanı kapalı + güncelleme metni", async ({ page, context, browser }) => {
    await signIn(context, "p28b");
    await live(page, browser, []);
    await expect(page.getByTestId("files-denied")).toHaveText(
      "Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin",
    );
    await expect(page.getByTestId("fsrv-notice")).toBeVisible();
  });
});

test.describe("ayar ekranları", () => {
  test("AC-354/362: Dosyalar — açarken onay zorunlu, kayıt; kullanım göstergesi; axe 0", async ({ page, context }) => {
    await signIn(context, "fad");
    await page.goto("/settings/files");
    await expect(page).toHaveTitle(/Dosyalar/);
    await expect(page.getByTestId("files-form")).toHaveAttribute("data-ready", "true");
    await expect(page.getByTestId("fset-usage")).toContainText("Kullanım:");
    await expect(page.getByTestId("fset-usage-high")).toBeVisible();
    await page.getByTestId("fset-mode").click();
    await expect(page.getByTestId("fset-consent-box")).toBeVisible();
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByTestId("fset-consent-error")).toHaveText("Açmadan önce aydınlatma metnini güncellediğinizi onaylayın");
    await page.getByTestId("fset-consent").check();
    await page.getByTestId("fset-days").fill("3");
    expect(await axeScan(page, '[data-testid="files-settings"]')).toEqual([]);
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByText("Dosya ayarları kaydedildi.")).toBeVisible();
    await expect(page.getByTestId("fset-consent-box")).toHaveCount(0);
    await expect(page.getByTestId("fset-mode")).toHaveAttribute("aria-checked", "true");
    await noHorizontalOverflow(page);
  });

  test("AC-354: ClamAV testi yoksa anahtar pasif + neden", async ({ page, context }) => {
    await signIn(context, "fadno");
    await page.goto("/settings/files");
    await expect(page.getByTestId("fset-mode")).toBeDisabled();
    await expect(page.getByTestId("files-settings")).toContainText("Sistem yöneticisi virüs tarama bağlantısını test etmedi");
  });

  test("AC-353/361: ClamAV — yapılandırılmadı → ağ dışı adres alan hatası → kaydet → test → imza eski uyarısı; axe 0", async ({
    page,
    context,
  }) => {
    await signIn(context, "fsa");
    await page.goto("/admin/settings/clamav");
    await expect(page.getByTestId("av-unconfigured")).toBeVisible();
    await expect(page.getByTestId("av-port")).toHaveValue("3310");
    await expect(page.getByTestId("clamav-form")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("av-host").fill("dis.ornek.com");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByText("Adres virüs tarama ağının dışında")).toBeVisible();
    await page.getByTestId("av-host").fill("clamav");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByTestId("av-untested")).toBeVisible();
    await page.getByTestId("av-test").click();
    await expect(page.getByTestId("av-result")).toHaveAttribute("data-ok", "true");
    await expect(page.getByTestId("av-eicar")).toHaveAttribute("data-ok", "true");
    await expect(page.getByTestId("av-encrypted")).toContainText("Şifreli arşiv algılandı: evet");
    await expect(page.getByTestId("av-stale")).toHaveCount(0);
    expect(await axeScan(page, '[data-testid="clamav-settings"]')).toEqual([]);
    await page.getByTestId("av-host").fill("eski");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByTestId("av-untested")).toBeVisible();
    await page.getByTestId("av-test").click();
    await expect(page.getByTestId("av-stale")).toHaveText(/Virüs imzaları 3 günden eski/);
    await noHorizontalOverflow(page);
  });

  test("AC-360: geçmiş — sunucudaki dosyalar listesi ve Bearer ile indirme", async ({ page, context }) => {
    await signIn(context, "hfs");
    await page.goto("/history/01JHXST0000000000000000000");
    await expect(page.getByRole("heading", { name: "Sunucudaki dosyalar" })).toBeVisible();
    const vis = page.locator('[data-testid="sf-state"]').filter({ visible: true });
    await expect(vis.filter({ hasText: "Yazdırma belgesi — saklanmaz" })).toHaveCount(1);
    await expect(vis.filter({ hasText: "Dosya virüslü bulundu (Eicar-Test-Signature), teslim edilmedi" })).toHaveCount(1);
    await expect(vis.filter({ hasText: "Teslim edilmedi — saklanmadı" })).toHaveCount(1);
    const btn = page.locator('[data-testid="sf-download"]').filter({ visible: true });
    await expect(btn).toHaveCount(1);
    const dl = page.waitForEvent("download");
    await btn.click();
    expect((await dl).suggestedFilename()).toBe("kurulum-notu.txt");
    await expect(page.getByTestId("sf-error")).toHaveCount(0);
    expect(await axeScan(page, '[data-testid="section-stored-files"]')).toEqual([]);
  });
});

// AC-363 (QA P28b madde 8): misafir web sayfası (/session/[token]) SERVER modunda — bilgi satırı, teknisyenden gelen
// taranmış dosya → kabul → Bearer ile indirme + SHA-256 → fsrv.result{ok} → teknisyende "Teslim edildi"; misafir yüklemesi
// teknisyene teklif olarak düşer. Paylaşım gerekmez (bayt yolu WS + HTTPS, DataChannel değil).
test.describe("misafir web", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "konsol + müşteri masaüstü akışı"));

  test("AC-363/287: misafir SERVER modu — bilgi satırı; teklif → kabul → indir; misafir yüklemesi teknisyene; koyu tema axe 0", async ({
    page,
    context,
    browser,
  }) => {
    await signIn(context, "p28b");
    const s = await newSession(page);
    await page.goto(`/sessions/${s.id}/console`);
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const g = await ctx.newPage();
    const guestErrors: string[] = [];
    g.on("console", (m) => {
      if (
        (m.type() === "error" || m.type() === "warning") &&
        !/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())
      )
        guestErrors.push(m.text());
    });
    g.on("pageerror", (e) => guestErrors.push(e.message));
    await g.goto(new URL(s.link).pathname);
    await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
    await g.getByTestId("guest-name").fill("Ayşe Yılmaz");
    await g.getByTestId("guest-consent").check();
    await g.getByTestId("join-browser").click();
    const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
    await page.getByTestId("admit-input").fill(code);
    await page.getByTestId("admit-submit").click();
    await expect(page.getByTestId("console-status")).toHaveText("Aktif");
    await page.getByTestId("collab-side").getByRole("button", { name: "Dosyalar" }).click();

    const gs = g.getByTestId("guest-collab");
    await gs.getByRole("button", { name: "Dosyalar" }).click();
    await expect(gs.getByTestId("files-panel")).toHaveAttribute("data-mode", "SERVER");
    await expect(gs.getByTestId("fsrv-notice")).toHaveText(NOTICE);
    await expect(gs.getByTestId("file-send")).toBeEnabled();

    // Teknisyen → misafir: tarama → teklif → kabul (1,5 sn kilit) → indir + SHA-256
    await expect(page.getByTestId("file-send")).toBeEnabled();
    await upload(page, "kurulum.txt", 2048);
    await expect(g.getByTestId("file-offer")).toBeVisible();
    await expect(g.getByTestId("file-reject")).toBeFocused();
    await expect(g.getByTestId("file-accept")).toBeEnabled({ timeout: 4000 });
    await g.getByTestId("file-accept").click();
    const inRow = gs.locator('[data-testid="file-row"][data-dir="in"]');
    await expect(inRow.getByTestId("file-status")).toHaveText("Tamamlandı (SHA-256 doğrulandı)");
    await expect(page.getByTestId("file-status").first()).toHaveText("Teslim edildi");
    const dl = g.waitForEvent("download");
    await inRow.getByTestId("file-download").click();
    expect((await dl).suggestedFilename()).toBe("kurulum.txt");
    const ws = (await (await page.request.get(`${MOCK}/__e2e/fsrv-ws/${s.id}`)).json()) as {
      side: string;
      m: { t: string; ok?: boolean };
    }[];
    expect(ws.find((x) => x.side === "guest" && x.m.t === "fsrv.result")?.m.ok).toBe(true);

    // Misafir → teknisyen: yükleme → tarama → konsolda teklif
    await gs.getByTestId("file-input").setInputFiles({ name: "ekran-notu.txt", mimeType: "text/plain", buffer: Buffer.alloc(512, 7) });
    await expect(page.getByTestId("file-offer")).toBeVisible();
    await expect(gs.locator('[data-testid="file-row"][data-dir="out"]').getByTestId("file-status")).toHaveText(
      "Teknisyenin onayı bekleniyor",
    );

    const log = await bytesLog(page, s.id);
    expect(log.urls.length).toBeGreaterThanOrEqual(2);
    expect(log.urls.filter((u) => log.tokens.some((tk) => u.includes(tk)))).toEqual([]);
    await expectDark(g);
    expect(await axeScan(g, '[data-testid="guest-collab"]')).toEqual([]);
    expect(guestErrors, "misafir konsolunda hata/uyarı olmamalı").toEqual([]);
    await ctx.close();
  });
});
