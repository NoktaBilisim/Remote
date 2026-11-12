import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { CSRF_HEADER } from "@remote/contracts/api/auth";
import { axeScan, guardConsole, noHorizontalOverflow, signIn } from "./helpers";

// P5 konsol işbirliği (AC-35..37, 44..46, 52..57, 117, 119). Sahte API + sahte WS; DC'ler gerçek P2P (localhost).
// Senaryo çerezleri (e2e/mock-sessions.mjs): u-p5-* file_transfer yetkili, u-p5nf-* yetkisiz; ikisinde maxFileMb = 1.
guardConsole();
test.beforeEach(({}, info) => test.skip(!info.project.name.startsWith("desktop"), "konsol + müşteri masaüstü akışı"));

const MOCK = "http://127.0.0.1:4217";
type LogEntry = { from: "tech" | "guest"; m: { t: string; result?: string; direction?: string; fileName?: string; sizeBytes?: number; sha256?: string; fps?: { avg: number } } };
const wsLog = async (page: Page, id: string) => (await (await page.request.get(`${MOCK}/__e2e/ws-log/${id}`)).json()) as LogEntry[];

/** Oturum aç → müşteri katılır → kabul → paylaşım → iki tarafta DC hazır. */
async function live(page: Page, browser: Browser, scheme: "light" | "dark" = "light", guestInit?: () => void) {
  const r = await page.request.post("/api/v1/sessions", { headers: { [CSRF_HEADER]: "csrf-test-token", Origin: "http://localhost:3217" }, data: {} });
  expect(r.status()).toBe(201);
  const s = (await r.json()) as { id: string; link: string };
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(`/sessions/${s.id}/console`);
  const ctx = await browser.newContext({ colorScheme: scheme });
  if (guestInit) await ctx.addInitScript(guestInit);
  const g = await ctx.newPage();
  await g.goto(new URL(s.link).pathname);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill("Ayşe Yılmaz");
  await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
  await page.getByTestId("admit-input").fill(code);
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await g.getByTestId("share-start").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  await expect(page.getByTestId("chat-input")).toBeEnabled({ timeout: 15_000 });
  await expect(g.getByTestId("chat-input")).toBeEnabled({ timeout: 15_000 });
  await watchArm(page);
  await watchArm(g);
  return { g, id: s.id };
}

/**
 * G-03 kilidini zamanlamadan bağımsız kaydeder (QA P8c-1 Tur 2 #3): her yeni "Kabul et" düğmesinin DOM'a girdiği an
 * devre dışı olup olmadığı ve etkinleşene kadar geçen süre (sayfa saatiyle). Yük altında test, 1,5 sn'lik pencereyi
 * kaçırsa da iddia aynı kalır: düğme kilitli doğar ve kilit en az ~1,5 sn sürer.
 */
async function watchArm(p: Page) {
  await p.evaluate(() => {
    const w = window as unknown as { __rsArm: { disabledAtStart: boolean; armMs: number | null }[] };
    w.__rsArm = [];
    const known = new WeakMap<Element, { t0: number; rec: { disabledAtStart: boolean; armMs: number | null } }>();
    const scan = () => {
      for (const el of document.querySelectorAll<HTMLButtonElement>('[data-testid="file-accept"]')) {
        let k = known.get(el);
        if (!k) {
          k = { t0: performance.now(), rec: { disabledAtStart: el.disabled, armMs: el.disabled ? null : 0 } };
          known.set(el, k);
          w.__rsArm.push(k.rec);
        }
        if (k.rec.armMs === null && !el.disabled) k.rec.armMs = performance.now() - k.t0;
      }
    };
    new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
  });
}
const lastArm = (p: Page) =>
  p.evaluate(() => (window as unknown as { __rsArm: { disabledAtStart: boolean; armMs: number | null }[] }).__rsArm.at(-1) ?? null);

/** Misafiri kapat: önce ekran paylaşımı durdurulur — yakalama açıkken context kapanışı yük altında 4–10 sn sürüyordu (AC-39). */
async function closeGuest(page: Page, g: Page) {
  await g.getByTestId("share-stop").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "stopped");
  await g.context().close();
}

const side = (p: Page) => p.getByTestId("collab-side");
const guestSide = (g: Page) => g.getByTestId("guest-collab");

/** Alıcı satırının gördüğü durumları ve ilerleme çubuğunu kaydeder (aktarım localhost'ta çok hızlı). */
async function watchRows(p: Page) {
  await p.evaluate(() => {
    const w = window as unknown as { __rsSeen: { st: string[]; progress: boolean } };
    w.__rsSeen = { st: [], progress: false };
    new MutationObserver(() => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-testid="file-row"]')) {
        const v = el.dataset.status ?? "";
        if (w.__rsSeen.st.at(-1) !== v) w.__rsSeen.st.push(v);
        if (el.querySelector("progress")) w.__rsSeen.progress = true;
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-status", "value"] });
  });
}
const seen = (p: Page) => p.evaluate(() => (window as unknown as { __rsSeen: { st: string[]; progress: boolean } }).__rsSeen);

async function acceptOffer(p: Page) {
  const dlg = p.getByTestId("file-offer");
  await expect(dlg).toBeVisible();
  await expect(p.getByTestId("file-reject")).toBeFocused(); // varsayılan odak "Reddet"
  // QA-P5-7: ARM_MS (1,5 sn) zamanlayıcısı tam paralel takımda arka plan sekmesi/yük nedeniyle gecikebilir
  await expect(p.getByTestId("file-accept")).toBeEnabled({ timeout: 10_000 });
  // G-03: 1,5 sn kilit — düğme kilitli doğdu ve kilit ≥ 1,4 sn sürdü (gözlemci kaydı; anlık toBeDisabled yük altında kararsızdı)
  const arm = await lastArm(p);
  expect(arm?.disabledAtStart, "Kabul et düğmesi kilitli açılmalı").toBe(true);
  expect(arm?.armMs ?? 0).toBeGreaterThanOrEqual(1400);
  await p.getByTestId("file-accept").click();
}

test("AC-35/52: sohbet iki yön; HTML/XSS denemesi düz metin kalır, betik çalışmaz", async ({ page, context, browser }) => {
  await signIn(context, "p5");
  const { g } = await live(page, browser);
  await expect(page.getByTestId("chat-empty")).toBeVisible();

  await page.getByTestId("chat-input").fill("Merhaba, ekranınızı görüyorum.");
  await page.keyboard.press("Enter");
  await expect(g.getByTestId("chat-msg")).toHaveText(["Merhaba, ekranınızı görüyorum."]);

  const xss = `<img src=x onerror="window.__rsXss=1"><script>window.__rsXss=2</script>`;
  await g.getByTestId("chat-input").fill(xss);
  await g.getByTestId("chat-send").click();
  const last = page.getByTestId("chat-msg").last();
  await expect(last).toHaveText(xss);
  await expect(page.getByTestId("chat-log").locator("img, script")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __rsXss?: number }).__rsXss)).toBeUndefined();
  expect(await g.evaluate(() => (window as unknown as { __rsXss?: number }).__rsXss)).toBeUndefined();

  // Okunmamış sayaç: konsol Kalite sekmesindeyken gelen mesaj → Sohbet sekmesinde rozet
  await side(page).getByRole("button", { name: "Kalite" }).click();
  await g.getByTestId("chat-input").fill("İkinci mesaj");
  await g.keyboard.press("Enter");
  await expect(side(page).getByRole("button", { name: /Sohbet\s*1/ })).toBeVisible();
  await side(page).getByRole("button", { name: /Sohbet/ }).click();
  await expect(side(page).getByRole("button", { name: "Sohbet" })).toHaveAttribute("aria-pressed", "true");
  await g.context().close();
});

test("AC-36/53/117: dosya iki yön — kabul diyaloğu, ilerleme, alıcıda indirme, file.meta OK; tehlikeli uzantı uyarısı", async ({ page, context, browser }) => {
  await signIn(context, "p5");
  const { g, id } = await live(page, browser);
  const body = Buffer.alloc(900 * 1024, "nokta-");

  // Teknisyen → müşteri (müşteri Sohbet sekmesindeyken teklif gelir → Dosyalar'a geçer)
  await watchRows(g);
  await side(page).getByRole("button", { name: "Dosyalar" }).click();
  await expect(side(page).getByText("Dosya başına en çok 1 MB")).toBeVisible();
  await page.getByTestId("file-input").setInputFiles({ name: "rapor.txt", mimeType: "text/plain", buffer: body });
  await acceptOffer(g);
  const inRow = g.getByTestId("file-row");
  await expect(inRow).toHaveAttribute("data-status", "ok", { timeout: 15_000 });
  await expect(page.getByTestId("file-row")).toHaveAttribute("data-status", "ok");
  const s = await seen(g);
  expect(s.st).toContain("receiving");
  expect(s.progress).toBe(true);
  const [dl] = await Promise.all([g.waitForEvent("download"), g.getByTestId("file-download").click()]);
  expect(dl.suggestedFilename()).toBe("rapor.txt");
  expect((await readFile((await dl.path())!)).equals(body)).toBe(true);
  // Alıcı (müşteri) + gönderen (teknisyen, S-P5-3) raporu; sıra iki ayrı WS'e bağlı
  await expect.poll(async () => (await wsLog(page, id)).filter((e) => e.m.t === "file.meta").sort((a, b) => a.from.localeCompare(b.from))).toEqual([
    { from: "guest", m: expect.objectContaining({ direction: "TO_CUSTOMER", fileName: "rapor.txt", sizeBytes: body.length, result: "OK" }) },
    { from: "tech", m: expect.objectContaining({ direction: "TO_CUSTOMER", fileName: "rapor.txt", sizeBytes: body.length, result: "OK" }) },
  ]);

  // Müşteri → teknisyen: çift uzantı uyarısı, reddet
  await g.getByTestId("file-input").setInputFiles({ name: "fatura.pdf.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(page.getByTestId("file-offer")).toBeVisible();
  await expect(page.getByTestId("file-danger")).toContainText("çift uzantı");
  await expect(page.getByTestId("file-reject")).toBeEnabled();
  await page.getByTestId("file-reject").click();
  await expect(g.getByTestId("file-row").filter({ hasText: "fatura.pdf.exe" })).toHaveAttribute("data-status", "rejected");
  await expect.poll(async () => (await wsLog(page, id)).filter((e) => e.m.t === "file.meta" && e.m.direction === "TO_TECH").map((e) => [e.from, e.m.result]).sort()).toEqual([["guest", "REJECTED"], ["tech", "REJECTED"]]);
  await g.context().close();
});

test("AC-36/117: müşteriden teknisyene dosya + tek uzantılı tehlikeli dosya uyarısı; teknisyende indirme", async ({ page, context, browser }) => {
  await signIn(context, "p5");
  const { g, id } = await live(page, browser);
  await guestSide(g).getByRole("button", { name: "Dosyalar" }).click();
  await g.getByTestId("file-input").setInputFiles({ name: "kurulum.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ-test") });
  // Konsol Sohbet sekmesindeyken teklif → Dosyalar'a geçer
  await expect(side(page).getByRole("button", { name: "Dosyalar" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("file-danger")).toContainText("program çalıştırabilir");
  await acceptOffer(page);
  await expect(page.getByTestId("file-row")).toHaveAttribute("data-status", "ok");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("file-download").click()]);
  expect(dl.suggestedFilename()).toBe("kurulum.exe");
  await expect.poll(async () => (await wsLog(page, id)).filter((e) => e.m.t === "file.meta").map((e) => [e.from, e.m.direction, e.m.result]).sort()).toEqual([["guest", "TO_TECH", "OK"], ["tech", "TO_TECH", "OK"]]);
  await g.context().close();
});

test("AC-53: tenant sınırı (1 MB) üstü dosya gönderilmez — teklif çıkmaz, hata gösterilir", async ({ page, context, browser }) => {
  await signIn(context, "p5");
  const { g, id } = await live(page, browser);
  await side(page).getByRole("button", { name: "Dosyalar" }).click();
  await page.getByTestId("file-input").setInputFiles({ name: "buyuk.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(1024 * 1024 + 1) });
  await expect(page.getByTestId("file-error")).toHaveText("Dosya 1 MB sınırını aşıyor.");
  await expect(page.getByTestId("file-row")).toHaveCount(0);
  await expect(g.getByTestId("file-offer")).toHaveCount(0);
  await expect(guestSide(g).getByRole("button", { name: "Dosyalar" })).toHaveAttribute("aria-pressed", "false");
  expect((await wsLog(page, id)).filter((e) => e.m.t === "file.meta")).toEqual([]);
  await g.context().close();
});

test("AC-54: SHA-256 uyuşmazlığı → 'Dosya bozuk', indirme sunulmaz, file.meta CORRUPT", async ({ page, context, browser }) => {
  await signIn(context, "p5");
  const { g, id } = await live(page, browser);
  await page.evaluate(() => ((globalThis as { __rsCorruptSha?: boolean }).__rsCorruptSha = true));
  await side(page).getByRole("button", { name: "Dosyalar" }).click();
  await page.getByTestId("file-input").setInputFiles({ name: "log.txt", mimeType: "text/plain", buffer: Buffer.from("bozulacak içerik") });
  await acceptOffer(g);
  const row = g.getByTestId("file-row");
  await expect(row).toHaveAttribute("data-status", "corrupt");
  await expect(row).toContainText("Dosya bozuk");
  await expect(g.getByTestId("file-download")).toHaveCount(0);
  await expect(page.getByTestId("file-row")).toHaveAttribute("data-status", "corrupt");
  await expect.poll(async () => (await wsLog(page, id)).filter((e) => e.m.t === "file.meta").map((e) => [e.from, e.m.result]).sort()).toEqual([["guest", "CORRUPT"], ["tech", "CORRUPT"]]);
  await g.context().close();
});

/** Müşteri dosya teklif eder ve onay beklerken kendisi iptal eder (alıcının teklif penceresinde 1 yer tüketir). */
async function offerAndCancel(g: Page, page: Page, name: string) {
  await g.getByTestId("file-input").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(name) });
  const row = g.getByTestId("file-row").filter({ hasText: name });
  await expect(row).toHaveAttribute("data-status", "offered");
  await expect(page.getByTestId("file-offer")).toBeVisible();
  await row.getByTestId("file-cancel").click();
  await expect(row).toHaveAttribute("data-status", "cancelled");
  await expect(page.getByTestId("file-offer")).toBeHidden();
}

test("TEST-P5-1: 10 sn'de 4. teklif — gönderen kendi sınırıyla hemen uyarılır, pencere dolunca yeni gönderim çalışır", async ({ page, context, browser }) => {
  test.setTimeout(60_000);
  await signIn(context, "p5");
  const { g } = await live(page, browser);
  await guestSide(g).getByRole("button", { name: "Dosyalar" }).click();
  const t0 = Date.now();
  for (const n of ["kur.ps1", "a.js", "x.msi"]) await offerAndCancel(g, page, n);
  await g.getByTestId("file-input").setInputFiles({ name: "y.scr", mimeType: "text/plain", buffer: Buffer.from("y") });
  await expect(g.getByTestId("file-error")).toHaveText(/en çok 3 dosya/);
  await expect(g.getByTestId("file-row").filter({ hasText: "y.scr" })).toHaveCount(0); // teklif hiç çıkmadı → kilit yok
  await page.waitForTimeout(Math.max(0, 11_500 - (Date.now() - t0)));
  await g.getByTestId("file-input").setInputFiles({ name: "y.scr", mimeType: "text/plain", buffer: Buffer.from("y") });
  await expect(g.getByTestId("file-error")).toHaveCount(0);
  await acceptOffer(page);
  await expect(page.getByTestId("file-row").filter({ hasText: "y.scr" })).toHaveAttribute("data-status", "ok");
  await g.context().close();
});

test("TEST-P5-1: alıcı 4. teklifi düşürürse gönderen 30 sn içinde 'Yanıt yok' ile çözülür, sonra yeni gönderim çalışır", async ({ page, context, browser }) => {
  test.setTimeout(60_000);
  await signIn(context, "p5");
  const { g, id } = await live(page, browser);
  // e2e kancaları: gönderenin kendi sınırı kapalı (eski/kötü niyetli istemci benzetimi), zaman aşımı 3 sn
  await g.evaluate(() => Object.assign(globalThis, { __rsNoSelfThrottle: true, __rsOfferTimeoutMs: 3_000 }));
  await guestSide(g).getByRole("button", { name: "Dosyalar" }).click();
  const t0 = Date.now();
  for (const n of ["kur.ps1", "a.js", "x.msi"]) await offerAndCancel(g, page, n);
  await g.getByTestId("file-input").setInputFiles({ name: "y.scr", mimeType: "text/plain", buffer: Buffer.from("y") });
  const row = g.getByTestId("file-row").filter({ hasText: "y.scr" });
  await expect(row).toHaveAttribute("data-status", "offered");
  await expect(row).toHaveAttribute("data-status", "timeout", { timeout: 30_000 });
  await expect(row.getByRole("status")).toHaveText(/^Yanıt yok/);
  await expect(row.getByTestId("file-cancel")).toHaveCount(0);
  await expect(page.getByTestId("file-offer")).toBeHidden(); // alıcıda diyalog hiç açılmadı
  await expect.poll(async () => (await wsLog(page, id)).some((e) => e.from === "guest" && e.m.t === "file.meta" && e.m.fileName === "y.scr" && e.m.result === "CANCELLED")).toBe(true);
  await page.waitForTimeout(Math.max(0, 10_500 - (Date.now() - t0)));
  await g.getByTestId("file-input").setInputFiles({ name: "z.txt", mimeType: "text/plain", buffer: Buffer.from("z") });
  await expect(g.getByTestId("file-error")).toHaveCount(0);
  await acceptOffer(page);
  await expect(page.getByTestId("file-row").filter({ hasText: "z.txt" })).toHaveAttribute("data-status", "ok");
  await g.context().close();
});

test("AC-44/46: kalite paneli değerleri görünür; oturum bitince quality.summary sunucuya gider", async ({ page, context, browser }) => {
  await signIn(context, "p5");
  const { g, id } = await live(page, browser);
  await side(page).getByRole("button", { name: "Kalite" }).click();
  const panel = page.getByTestId("quality-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole("status")).toHaveText(/^Bağlantı (iyi|zayıf|kötü)/);
  await expect(panel.locator("dd").first()).toHaveText(/^\d+ FPS$/, { timeout: 10_000 });
  await expect(panel).toContainText("kbps");
  await expect(panel).toContainText("Doğrudan"); // localhost: host adayı
  await page.getByTestId("console-end").click();
  await page.getByTestId("console-confirm-ok").click();
  await expect(g.getByTestId("guest-finished")).toBeVisible();
  await expect.poll(async () => (await wsLog(page, id)).filter((e) => e.m.t === "quality.summary" && e.from === "tech").length).toBeGreaterThan(0);
  await g.context().close();
});

test("AC-56/57: işaretleme ve lazer müşteri önizlemesinde görünür; geri al / temizle", async ({ page, context, browser }) => {
  await signIn(context, "p5");
  const { g } = await live(page, browser);
  const layer = page.getByTestId("annot-layer");
  const glayer = g.getByTestId("annot-layer");
  await expect(page.getByTestId("annot-toolbar")).toBeVisible();
  const box = (await layer.boundingBox())!;
  const drag = async (dx: number) => {
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * (0.4 + dx), box.y + box.height * 0.5, { steps: 5 });
    await page.mouse.up();
  };
  await page.getByTestId("annot-pen").click();
  await expect(page.getByTestId("annot-pen")).toHaveAttribute("aria-pressed", "true");
  await drag(0);
  await page.getByTestId("annot-rect").click();
  await page.getByRole("button", { name: "Mavi" }).click();
  await drag(0.2);
  await expect(glayer).toHaveAttribute("data-strokes", "2");
  await page.getByTestId("annot-undo").click();
  await expect(glayer).toHaveAttribute("data-strokes", "1");
  await page.getByTestId("annot-clear").click();
  await expect(glayer).toHaveAttribute("data-strokes", "0");

  await page.getByTestId("annot-laser").click();
  await expect(glayer).toHaveAttribute("data-laser", "off");
  for (const f of [0.2, 0.4, 0.6]) {
    await page.mouse.move(box.x + box.width * f, box.y + box.height * f, { steps: 3 });
    await page.waitForTimeout(80);
  }
  await expect(glayer).toHaveAttribute("data-laser", "on");
  await expect(layer).toHaveAttribute("data-strokes", "0"); // lazer kalıcı çizgi bırakmaz
  await g.context().close();
});

test("AC-119/G-09: file_transfer yetkisi yok → müşteride Dosyalar sekmesi yok, konsolda gönderim pasif", async ({ page, context, browser }) => {
  await signIn(context, "p5nf");
  const { g } = await live(page, browser);
  await expect(guestSide(g).getByRole("button", { name: "Dosyalar" })).toHaveCount(0);
  await expect(g.getByTestId("file-input")).toHaveCount(0);
  await expect(g.getByTestId("chat-panel")).toBeVisible();
  await side(page).getByRole("button", { name: "Dosyalar" }).click();
  await expect(page.getByTestId("files-denied")).toHaveText("Bu oturumda dosya transferi yetkisi yok.");
  await expect(page.getByTestId("file-send")).toHaveCount(0);
  await g.context().close();
});

for (const scheme of ["light", "dark"] as const) {
  // AC-39 kararsızlığı (P8, kök neden docs/implementation.md "Frontend P8"): eski tek test 8 tam axe taraması (her biri yeni
  // sekme açan finishRun) + canlı WebRTC ile 7 işçide ~48 sn sürüyordu (30 sn bütçe). Tarama legacy modda (helpers.axeScan),
  // test ikiye bölündü, sekme değişiminden sonra yalnız değişen bölge taranır, misafir context'i paylaşım durdurulup kapatılır.
  test(`AC-39: P5 konsol panelleri axe (${scheme})`, async ({ page, context, browser }) => {
    await signIn(context, `p5-ax${scheme}`);
    const { g } = await live(page, browser, scheme);
    await page.getByTestId("chat-input").fill("Kontrol mesajı");
    await page.keyboard.press("Enter");
    await expect(g.getByTestId("chat-msg")).toHaveCount(1);
    // TEST-P5-2/3: boşluksuz 2000 karakter → günlük kaydırılır (klavyeyle odaklanır), balon satır kaydırır (kesilmez)
    await page.getByTestId("chat-input").fill("Ç".repeat(2000));
    await page.keyboard.press("Enter");
    await expect(g.getByTestId("chat-msg")).toHaveCount(2);
    for (const p of [page, g]) {
      const log = p.getByTestId("chat-log");
      await expect(log).toHaveAttribute("tabindex", "0");
      const last = p.getByTestId("chat-msg").last();
      expect(await last.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await log.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    expect(await g.getByTestId("chat-log").evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await g.getByTestId("chat-log").focus();
    await expect(g.getByTestId("chat-log")).toBeFocused();
    expect(await axeScan(g)).toEqual([]);
    expect(await axeScan(page)).toEqual([]);
    await side(page).getByRole("button", { name: "Dosyalar" }).click();
    expect(await axeScan(page, '[data-testid="collab-side"]')).toEqual([]);
    await side(page).getByRole("button", { name: "Kalite" }).click();
    await expect(page.getByTestId("quality-panel")).toBeVisible({ timeout: 10_000 });
    expect(await axeScan(page, '[data-testid="collab-side"]')).toEqual([]);
    await closeGuest(page, g);
  });

  test(`AC-39: P5 müşteri 375 px + dosya kabul diyaloğu axe (${scheme})`, async ({ page, context, browser }) => {
    await signIn(context, `p5-ay${scheme}`);
    const { g } = await live(page, browser, scheme);
    await page.getByTestId("chat-input").fill("Ç".repeat(2000));
    await page.keyboard.press("Enter");
    await expect(g.getByTestId("chat-msg")).toHaveCount(1);
    await g.setViewportSize({ width: 375, height: 780 });
    expect(await axeScan(g)).toEqual([]);
    await noHorizontalOverflow(g);
    // Kabul diyaloğu (tehlikeli dosya uyarısıyla) da 375 px'te erişilebilir
    await side(page).getByRole("button", { name: "Dosyalar" }).click();
    await page.getByTestId("file-input").setInputFiles({ name: "arac.bat", mimeType: "application/octet-stream", buffer: Buffer.from("@echo off") });
    await expect(g.getByTestId("file-danger")).toBeVisible();
    await expect(g.getByTestId("file-reject")).toBeEnabled();
    // ARM_MS sonrası "Kabul et" opaklık geçişi (150 ms) tarama ortasına denk gelirse ara renk ölçülür → kararlı hâli tara
    await expect(g.getByTestId("file-accept")).toBeEnabled({ timeout: 10_000 });
    await expect(g.getByTestId("file-accept")).toHaveCSS("opacity", "1");
    expect(await axeScan(g, '[data-testid="file-offer"]')).toEqual([]);
    await noHorizontalOverflow(g);
    await g.getByTestId("file-reject").click();
    await expect(g.getByTestId("file-offer")).toBeHidden();
    expect(await axeScan(g, '[data-testid="guest-collab"]')).toEqual([]);
    await closeGuest(page, g);
  });
}

// ---------------------------------------------------------------- P5 QA düzeltmesi (QA-P5-1..4)

/** Göndereni parça başına yavaşlatır (yalnız NEXT_PUBLIC_RS_E2E derlemesi; lib/dc/use-collab.ts). */
const slowSend = (p: Page, ms = 60) => p.evaluate((v) => ((globalThis as { __rsSlowFileMs?: number }).__rsSlowFileMs = v), ms);

test("AC-53: aktarım sürerken alıcı ve gönderen iptal eder — iki tarafta 'İptal edildi', indirme yok, file.meta CANCELLED", async ({ page, context, browser }) => {
  await signIn(context, "p5");
  const { g, id } = await live(page, browser);
  const body = Buffer.alloc(900 * 1024, "iptal-");

  // 1) Teknisyen → müşteri; ALICI (müşteri) iptal eder
  await slowSend(page);
  await side(page).getByRole("button", { name: "Dosyalar" }).click();
  await page.getByTestId("file-input").setInputFiles({ name: "kurulum-notu.txt", mimeType: "text/plain", buffer: body });
  await acceptOffer(g);
  const gIn = g.getByTestId("file-row").filter({ hasText: "kurulum-notu.txt" });
  const tOut = page.getByTestId("file-row").filter({ hasText: "kurulum-notu.txt" });
  await expect(gIn).toHaveAttribute("data-status", "receiving");
  await expect(tOut).toHaveAttribute("data-status", "sending");
  await expect(gIn.locator("progress")).toBeVisible();
  await gIn.getByTestId("file-cancel").click();
  await expect(gIn).toHaveAttribute("data-status", "cancelled");
  await expect(tOut).toHaveAttribute("data-status", "cancelled");
  await expect(gIn.getByRole("status")).toHaveText("İptal edildi");
  await expect(tOut.getByRole("status")).toHaveText("İptal edildi");
  await expect(g.getByTestId("file-download")).toHaveCount(0);
  await expect.poll(async () => (await wsLog(page, id)).filter((e) => e.m.t === "file.meta").map((e) => [e.from, e.m.direction, e.m.result]).sort()).toEqual([
    ["guest", "TO_CUSTOMER", "CANCELLED"],
    ["tech", "TO_CUSTOMER", "CANCELLED"],
  ]);

  // 2) Müşteri → teknisyen; GÖNDEREN (müşteri) iptal eder
  await slowSend(g);
  await g.getByTestId("file-input").setInputFiles({ name: "ekran-kaydi.log", mimeType: "text/plain", buffer: body });
  await acceptOffer(page);
  const tIn = page.getByTestId("file-row").filter({ hasText: "ekran-kaydi.log" });
  const gOut = g.getByTestId("file-row").filter({ hasText: "ekran-kaydi.log" });
  await expect(gOut).toHaveAttribute("data-status", "sending");
  await expect(tIn).toHaveAttribute("data-status", "receiving");
  await gOut.getByTestId("file-cancel").click();
  await expect(gOut).toHaveAttribute("data-status", "cancelled");
  await expect(tIn).toHaveAttribute("data-status", "cancelled");
  await expect(page.getByTestId("file-download")).toHaveCount(0);
  await expect.poll(async () => (await wsLog(page, id)).filter((e) => e.m.t === "file.meta" && e.m.direction === "TO_TECH").map((e) => [e.from, e.m.result]).sort()).toEqual([
    ["guest", "CANCELLED"],
    ["tech", "CANCELLED"],
  ]);
  // Geç gelen parça/`file.done` durumu değiştirmez
  await page.waitForTimeout(1_000);
  await expect(tIn).toHaveAttribute("data-status", "cancelled");
  await expect(gIn).toHaveAttribute("data-status", "cancelled");
  await g.context().close();
});

test("AC-37: Document PiP destekleniyorsa 'Yüzen pencere' görünür ve açılır", async ({ page, context, browser }) => {
  await signIn(context, "p5");
  const { g } = await live(page, browser);
  // Gerçek API: Chromium (localhost güvenli bağlam). Başsız kabukta yoksa testin anlamı kalmaz → açıkça başarısız.
  expect(await g.evaluate(() => typeof (window as { documentPictureInPicture?: unknown }).documentPictureInPicture)).toBe("object");
  await g.getByTestId("pip-open").click();
  await expect(g.getByTestId("pip-close")).toBeVisible();
  await expect(g.getByText("Önizleme yüzen pencerede gösteriliyor.")).toBeVisible();
  await expect(g.getByTestId("guest-preview")).toHaveCount(0); // önizleme PiP penceresine taşındı (portal)
  await g.getByTestId("pip-close").click();
  await expect(g.getByTestId("pip-open")).toBeVisible();
  await g.context().close();
});

test("AC-37: Document PiP yoksa buton hiç çizilmez", async ({ page, context, browser }) => {
  await signIn(context, "p5");
  const { g } = await live(page, browser, "light", () => {
    delete (window as { documentPictureInPicture?: unknown }).documentPictureInPicture;
  });
  await expect(g.getByTestId("guest-collab")).toBeVisible();
  await expect(g.getByTestId("pip-open")).toHaveCount(0);
  await expect(g.getByTestId("pip-close")).toHaveCount(0);
  await g.context().close();
});

test("AC-57: teknisyen→müşteri çizim gecikmesi p95 < 200 ms (20 çizgi)", async ({ page, context, browser }) => {
  await signIn(context, "p5");
  const { g } = await live(page, browser);
  type W = { __rsT: number[] };
  // Zaman: performance.timeOrigin + performance.now() — iki sayfa aynı makine saatinde (ms altı çözünürlük)
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__rsT = [];
    window.addEventListener("pointerup", (e) => {
      if ((e.target as HTMLElement).dataset?.testid === "annot-layer") w.__rsT.push(performance.timeOrigin + performance.now());
    }, true);
  });
  await g.evaluate(() => {
    const w = window as unknown as W;
    w.__rsT = [];
    const el = document.querySelector<HTMLElement>('[data-testid="annot-layer"]')!;
    new MutationObserver(() => {
      if (Number(el.dataset.strokes) > w.__rsT.length) w.__rsT.push(performance.timeOrigin + performance.now());
    }).observe(el, { attributes: true, attributeFilter: ["data-strokes"] });
  });

  const layer = page.getByTestId("annot-layer");
  const box = (await layer.boundingBox())!;
  await page.getByTestId("annot-pen").click();
  const N = 20;
  for (let i = 0; i < N; i++) {
    const y = box.y + box.height * (0.3 + (0.4 * i) / N); // video içerik alanı (kenar araç çubuklarından uzak)
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, y + 10, { steps: 3 });
    await page.mouse.up();
    await expect(g.getByTestId("annot-layer")).toHaveAttribute("data-strokes", String(i + 1));
  }
  const sent = await page.evaluate(() => (window as unknown as W).__rsT);
  const shown = await g.evaluate(() => (window as unknown as W).__rsT);
  expect(sent).toHaveLength(N);
  expect(shown).toHaveLength(N);
  const lat = sent.map((s, i) => shown[i]! - s).sort((a, b) => a - b);
  const p95 = lat[Math.ceil(0.95 * N) - 1]!;
  test.info().annotations.push({ type: "AC-57", description: `p50=${lat[N / 2]!.toFixed(1)} ms p95=${p95.toFixed(1)} ms max=${lat.at(-1)!.toFixed(1)} ms` });
  console.log(`[AC-57] çizim gecikmesi ms: ${lat.map((x) => x.toFixed(1)).join(" ")} | p95=${p95.toFixed(1)}`);
  expect(lat[0]!).toBeGreaterThanOrEqual(0);
  expect(p95).toBeLessThan(200);
  await g.context().close();
});

test("AC-41: 1920x1080 kaynak → teknisyende 1920 genişlik ve FPS ≥ 15 (getStats/kalite paneli)", { tag: "@perf" }, async ({ page, context, browser }) => {
  test.setTimeout(90_000);
  await signIn(context, "p5");
  // getDisplayMedia stub: 1080p canvas, 30 fps captureStream; her karede içerik değişir (kodlayıcı kare atlamasın)
  const { g } = await live(page, browser, "light", () => {
    const md = navigator.mediaDevices;
    if (!md) return;
    md.getDisplayMedia = async () => {
      const c = document.createElement("canvas");
      c.width = 1920;
      c.height = 1080;
      const x = c.getContext("2d")!;
      let f = 0;
      setInterval(() => {
        f++;
        x.fillStyle = `hsl(${(f * 7) % 360} 60% 50%)`;
        x.fillRect(0, 0, 1920, 1080);
        x.fillStyle = "#fff";
        x.font = "120px sans-serif";
        x.fillText(`kare ${f}`, 200 + ((f * 13) % 800), 540);
      }, 33);
      return c.captureStream(30);
    };
  });
  await side(page).getByRole("button", { name: "Kalite" }).click();
  const panel = page.getByTestId("quality-panel");
  await expect(panel).toContainText("1920×1080", { timeout: 30_000 });
  const fpsCell = panel.locator("dd").first();
  const readFps = async () => Number(/^(\d+) FPS$/.exec((await fpsCell.textContent()) ?? "")?.[1] ?? 0);
  // Isınma: bant genişliği tahmini düşük başlar; contentHint "detail" çözünürlüğü korur, FPS'i düşürür.
  // Kararlı duruma (ilk ≥ 15 okuması) en çok 30 sn; ardından 6 sn'lik pencerenin medyanı ölçülür.
  const t0 = Date.now();
  await expect.poll(readFps, { timeout: 30_000, intervals: [500] }).toBeGreaterThanOrEqual(15);
  const warmupMs = Date.now() - t0;
  const fps: number[] = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1_000);
    fps.push(await readFps());
  }
  const sorted = [...fps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  console.log(`[AC-41] 1080p ısınma ${warmupMs} ms; FPS örnekleri: ${fps.join(" ")} | medyan=${median}`);
  test.info().annotations.push({ type: "AC-41", description: `ısınma ${warmupMs} ms; FPS ${fps.join(",")} medyan ${median}` });
  await expect(panel).toContainText("1920×1080");
  expect(median).toBeGreaterThanOrEqual(15);
  await g.context().close();
});
