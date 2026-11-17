import { expect, test, type Browser, type Page } from "@playwright/test";
import { REC_PART_MS, REC_REVOKE_ACK_MS } from "@remote/contracts/ws-rec";
import { desktopOnly, guardConsole, newSession, scanBoth, scanThemes, signIn } from "./helpers";

// P28e-K7 (mimari-p28e r2 §7, §9) — AC-380, 381, 382, 383, 384, 385, 386, 447, 450 (UI). Sahte API e2e/mock-p28e.mjs
// (u-p28e*; ayar, geçmiş, oynatıcı), sahte WS e2e/mock-ws.mjs (u-p28ec*: rıza → rec.state + yükleme belirteci).
guardConsole();
const MOCK = "http://127.0.0.1:4217";
const REC = "01JSSP28E0000000000000000A";
const SIL = "01JSSP28E0000000000000000B";
const DEL = "01JSSP28E0000000000000000C";
const RID_REC = "01JRDP28E0000000000000000A";
const PREFIX = "● Kayıt — ";

async function stepUp(page: Page) {
  const dlg = page.getByTestId("step-up-dialog");
  await expect(dlg).toBeVisible();
  await dlg.getByTestId("step-up-code").fill("123456");
  await dlg.getByTestId("step-up-submit").click();
}

/** Gerçek MediaRecorder çıktısı (canvas → VP8 WebM): `n` bölüm × 2 parça (1 sn timeslice). */
async function recordWebm(page: Page, n: number) {
  return page.evaluate(async (n) => {
    const out: { s: number; p: number; durationMs: number; b64: string; gapMs?: number }[] = [];
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 180;
    const g = c.getContext("2d")!;
    let f = 0;
    const timer = setInterval(() => {
      g.fillStyle = `hsl(${(f += 7) % 360} 70% 50%)`;
      g.fillRect(0, 0, 320, 180);
    }, 33);
    const stream = c.captureStream(30);
    for (let s = 0; s < n; s++) {
      const blobs: Blob[] = [];
      const r = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      r.ondataavailable = (e) => e.data.size && blobs.push(e.data);
      const stopped = new Promise((res) => (r.onstop = res));
      r.start(1000);
      await new Promise((res) => setTimeout(res, 2100));
      r.stop();
      await stopped;
      // en çok 2 parça (son kuyruk 2. parçaya birleşir — recorder.ts kuralı)
      const parts = [blobs[0]!, new Blob(blobs.slice(1), { type: "video/webm" })];
      for (let p = 0; p < parts.length; p++) {
        const buf = new Uint8Array(await parts[p]!.arrayBuffer());
        let bin = "";
        for (const b of buf) bin += String.fromCharCode(b);
        out.push({ s, p, durationMs: p === 0 ? 1000 : 1100, b64: btoa(bin), ...(s > 0 && p === 0 ? { gapMs: 3000 } : {}) });
      }
    }
    clearInterval(timer);
    return out;
  }, n);
}

test.describe("Ayarlar → Oturum kaydı (AC-380, 447)", () => {
  test("açarken aydınlatma onayı zorunlu; gözetimsiz: ana anahtar kapalıyken pasif, kutu + step-up; Safari notu", async ({
    page,
    context,
  }) => {
    await signIn(context, "p28eadm");
    await page.goto("/settings/recording");
    const form = page.getByTestId("rec-settings-form");
    await expect(form).toHaveAttribute("data-ready", "true");
    await expect(page).toHaveTitle(/Oturum kaydı/);
    await expect(page.getByTestId("rset-safari")).toContainText("Safari kayıt alamaz");
    await expect(page.getByRole("switch", { name: "Gözetimsiz bağlantıları da kaydet" })).toBeDisabled();
    await page.getByRole("switch", { name: "Oturum kaydı" }).click();
    await expect(page.getByTestId("rset-consent")).not.toBeChecked();
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByTestId("rset-consent-error")).toHaveText("Açmadan önce aydınlatma metnini güncellediğinizi onaylayın");
    await page.getByTestId("rset-consent").check();
    await page.getByTestId("rset-days").fill("75");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByText("Kayıt saklama süresi firma oturum saklama süresini aşamaz")).toBeVisible();
    await expect(page.getByTestId("rset-days")).toBeFocused();
    await page.getByTestId("rset-days").fill("14");
    await expect(page.getByTestId("rset-days")).toHaveAccessibleDescription(/Yeni süre yalnız bundan sonraki kayıtlara uygulanır/);
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByText("Oturum kaydı ayarları kaydedildi")).toBeVisible();
    await expect(page.getByTestId("rset-consent-box")).toHaveCount(0);

    const un = page.getByRole("switch", { name: "Gözetimsiz bağlantıları da kaydet" });
    await expect(un).toBeEnabled();
    await un.click();
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByTestId("rset-notice-error")).toBeVisible();
    await page.getByTestId("rset-notice").check();
    await page.getByRole("button", { name: "Kaydet" }).click();
    await stepUp(page);
    await expect(page.getByTestId("rset-ack-at")).toBeVisible();
    // ana anahtar kapanınca gözetimsiz de kapanır (AC-447)
    await page.getByRole("switch", { name: "Oturum kaydı" }).click();
    await expect(un).toHaveAttribute("aria-checked", "false");
  });

  test("K10 D-1: saklama süresi boş/0/-5/91 → alan hatası (aria-invalid + aria-describedby), PUT gitmez", async ({ page, context }) => {
    await signIn(context, "p28esole");
    await page.goto("/settings/recording");
    await expect(page.getByTestId("rec-settings-form")).toHaveAttribute("data-ready", "true");
    let puts = 0;
    page.on("request", (r) => r.method() === "PUT" && r.url().includes("/settings/recording") && puts++);
    const days = page.getByTestId("rset-days");
    for (const [v, msg] of [
      ["", "Gün sayısı girin"],
      ["0", "En az 1 gün"],
      ["-5", "Gün sayısı girin"],
      ["91", /En çok 90 gün|aşamaz/],
    ] as const) {
      await days.fill(v);
      await page.getByRole("button", { name: "Kaydet" }).click();
      await expect(days, `"${v}"`).toHaveAttribute("aria-invalid", "true");
      await expect(days).toHaveAccessibleDescription(msg);
      await expect(days).toBeFocused();
    }
    expect(puts).toBe(0);
  });

  test("tek yönetici uyarısı (S-P28e-4); salt okunur kullanıcıda form pasif", async ({ page, context }) => {
    await signIn(context, "p28esole");
    await page.goto("/settings/recording");
    await expect(page.getByTestId("rset-sole-manager")).toHaveText(
      "Politika değişikliği e-postası yalnız size gider; en az iki yönetici tanımlayın",
    );
    await context.clearCookies();
    await signIn(context, "p28ero");
    await page.goto("/settings/recording");
    await expect(page.getByTestId("settings-readonly")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Oturum kaydı" })).toBeDisabled();
  });

  test("390 px, açık/koyu tema: taşma yok, axe 0 (ayar + geçmiş detayı)", async ({ browser }, info) => {
    desktopOnly(info.project.name);
    await scanBoth(browser, "p28esole", "/settings/recording", 390, async (p) => {
      await expect(p.getByTestId("rec-settings-form")).toHaveAttribute("data-ready", "true");
    });
    await scanBoth(browser, "p28eadm", `/history/${SIL}`, 390, async (p) => {
      await expect(p.getByTestId("rec-meta")).toBeVisible();
    });
  });
});

test.describe("Geçmiş: Kayıtlı süzgeci, meta, sil, izle (AC-385, 386, 450)", () => {
  test("liste 'Kayıt' işareti + 'Kayıtlı' süzgeci URL'ye yazılır", async ({ page, context }) => {
    await signIn(context, "p28eadm");
    await page.goto("/history");
    await expect(page.getByTestId("history-rec").filter({ visible: true })).toHaveCount(2);
    await page.getByTestId("history-recorded").getByRole("button", { name: "Kayıtlı" }).click();
    await page.getByTestId("filter-apply").click();
    await expect(page).toHaveURL(/recorded=true/);
    await expect(page.locator('[data-testid="history-row"], [data-testid="history-card"]').filter({ visible: true })).toHaveCount(2);
  });

  test("gözetimsiz kayıtta kip + gerekçe; silinmiş kayıtta neden; sil onayı (odak Vazgeç)", async ({ page, context }) => {
    await signIn(context, "p28eadm");
    await page.goto(`/history/${SIL}`);
    await expect(page.getByTestId("rec-basis")).toContainText("Firma politikası");
    await expect(page.getByTestId("rec-mode")).toContainText("İzinsiz");
    await expect(page.getByTestId("rec-reason")).toContainText("Gece bakım penceresi");
    await page.getByTestId("rec-delete").click();
    const dlg = page.getByTestId("rec-delete-dialog");
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
    await page.getByTestId("rec-delete-confirm").click();
    await expect(page.getByTestId("rec-deleted")).toHaveText("Kayıt silindi — elle silindi");
    await page.goto(`/history/${DEL}`);
    await expect(page.getByTestId("rec-deleted")).toHaveAttribute("data-reason", "manual");
    await expect(page.getByTestId("rec-watch")).toHaveCount(0);
  });

  test("K10 O-1: 'Kaydı izle' 401 → /login?reason=expired; D-3: 500'de sunucu metni değil genel metin", async ({ page, context }) => {
    await signIn(context, "p28eadm");
    let status = 500;
    await page.route(/\/api\/v1\/sessions\/[^/]+\/recording\/view$/, (r) =>
      r.fulfill({
        status,
        json: {
          error: status === 500 ? { code: "INTERNAL", message: "x", requestId: "req-k10" } : { code: "UNAUTHENTICATED", message: "x" },
        },
      }),
    );
    await page.goto(`/history/${REC}`);
    await page.getByTestId("rec-watch").click();
    await expect(page.getByText("Beklenmeyen bir hata oluştu.")).toBeVisible();
    await expect(page.getByText("x", { exact: true })).toHaveCount(0);
    status = 401;
    await context.clearCookies(); // oturum gerçekten düşmüş: giriş sayfası geçerli çerezle "/"a yönlendirmesin
    await page.getByTestId("rec-watch").click();
    await expect(page).toHaveURL(/\/login\?reason=expired$/);
  });

  test("K10 D-2: meta 404/403 → 'Kaydı izle' yerine kısa neden metni", async ({ page, context }) => {
    await signIn(context, "p28eadm");
    for (const [status, text] of [
      [404, "Kayıt bilgisi bulunamadı; kayıt silinmiş olabilir. Sayfayı yenileyin."],
      [403, "Bu kaydın bilgisini görme yetkiniz yok."],
    ] as const) {
      await page.unroute(/\/api\/v1\/sessions\/[^/]+\/recording$/);
      await page.route(/\/api\/v1\/sessions\/[^/]+\/recording$/, (r) =>
        r.request().method() === "GET"
          ? r.fulfill({ status, json: { error: { code: status === 404 ? "NOT_FOUND" : "FORBIDDEN", message: "x" } } })
          : r.fallback(),
      );
      await page.goto(`/history/${REC}`);
      await expect(page.getByTestId("rec-missing")).toHaveText(text);
      await expect(page.getByTestId("rec-missing")).toHaveAttribute("data-status", String(status));
      await expect(page.getByTestId("rec-watch")).toHaveCount(0);
    }
  });

  test("izleme yetkisi yoksa 'Kaydı izle' ve 'Kaydı sil' yok", async ({ page, context }) => {
    await signIn(context, "p28ero");
    await page.goto(`/history/${REC}`);
    await expect(page.getByTestId("rec-noperm")).toBeVisible();
    await expect(page.getByTestId("rec-watch")).toHaveCount(0);
    await expect(page.getByTestId("rec-delete")).toHaveCount(0);
  });

  test("Kaydı izle: gerçek WebM, 2 bölüm + boşluk, MSE oynatma, indirme yok, 429 bekleme, izleme tıklama başına", async ({
    page,
    context,
  }, info) => {
    desktopOnly(info.project.name);
    const cookie = await signIn(context, "p28ebusy");
    await page.goto("/login");
    const parts = await recordWebm(page, 2);
    expect((await page.request.post(`${MOCK}/__e2e/rec-seed/${RID_REC}`, { data: { parts } })).ok()).toBe(true);
    await page.goto(`/history/${REC}`);
    await expect(page.getByTestId("rec-basis")).toContainText("Müşteri rızası");
    expect((await (await page.request.get(`${MOCK}/__e2e/rec-views/${cookie}`)).json()).views).toBe(0); // mount'ta audit yok
    await page.getByTestId("rec-watch").click();
    const player = page.getByTestId("rec-player");
    await expect(player).toBeVisible();
    expect((await (await page.request.get(`${MOCK}/__e2e/rec-views/${cookie}`)).json()).views).toBe(1);
    const video = page.getByTestId("rec-video");
    await expect(video).not.toHaveAttribute("controls");
    await expect(video).toHaveAttribute("controlslist", /nodownload/);
    await expect(video).toHaveAttribute("src", /^blob:/);
    await expect(page.getByTestId("rec-timeline")).toHaveAttribute("data-gaps", "1");
    await expect(player).toHaveAttribute("data-status", "ready", { timeout: 10_000 }); // 429 sonrası sürer
    await page.getByTestId("rec-play").click();
    // bölüm 1 bitince boşluk atlanır ve bölüm 2 oynar (sourceBuffer.abort + timestampOffset)
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThan(5.3);
    const ranges = await video.evaluate((v: HTMLVideoElement) =>
      Array.from({ length: v.buffered.length }, (_, i) => [v.buffered.start(i), v.buffered.end(i)]),
    );
    expect(ranges.length).toBeGreaterThanOrEqual(2);
    expect(ranges[1]![0]).toBeGreaterThan(4.5);
    await expect(page.getByRole("link", { name: /indir/i })).toHaveCount(0);
    await page.getByTestId("rec-close").click();
    await expect(player).toHaveCount(0);
  });
});

async function joinWithRec(browser: Browser, link: string, consent: boolean) {
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await g.goto(new URL(link).pathname);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill("Ayşe Yılmaz");
  await g.getByTestId("guest-consent").check();
  await expect(g.getByTestId("rec-consent")).not.toBeChecked();
  if (consent) await g.getByTestId("rec-consent").check();
  await g.getByTestId("join-browser").click();
  await expect(g.getByTestId("guest-lobby")).toBeVisible();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
  return { g, code };
}

async function live(page: Page, browser: Browser) {
  const s = await newSession(page);
  await page.goto(`/sessions/${s.id}/console`);
  const { g, code } = await joinWithRec(browser, s.link, true);
  await page.getByTestId("admit-input").fill(code);
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  return { s, g };
}

/** AC-382/384: konsol sayfasında her `MediaRecorder.stop()` çağrısının duvar saati (Date.now) — kaydedicinin durma anı. */
function instrumentStops() {
  const w = window as unknown as { __recStops: number[] };
  w.__recStops = [];
  const stop = MediaRecorder.prototype.stop;
  MediaRecorder.prototype.stop = function (this: MediaRecorder) {
    w.__recStops.push(Date.now());
    return stop.call(this);
  };
}
const recStops = (page: Page) => page.evaluate(() => (window as unknown as { __recStops: number[] }).__recStops);

/**
 * AC-382: `click` düğmesine sayfa içinde tıklanır, `show` DOM'a girene kadar geçen süre `performance.now()` ile ölçülür
 * (Playwright bekleme/yoklama gecikmesi ölçüme girmez). `at` = tıklama anının duvar saati (konsol sayfasıyla karşılaştırma).
 */
function clickUntil(g: Page, click: string, show: string) {
  return g.evaluate(
    ([click, show]) =>
      new Promise<{ ms: number; at: number }>((resolve, reject) => {
        const sel = (id: string) => document.querySelector(`[data-testid="${id}"]`);
        const obs = new MutationObserver(() => {
          if (!sel(show)) return;
          obs.disconnect();
          resolve({ ms: performance.now() - t0, at });
        });
        obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-testid"] });
        setTimeout(() => (obs.disconnect(), reject(new Error(`${show} 5 sn içinde görünmedi`))), 5000);
        const at = Date.now();
        const t0 = performance.now();
        (sel(click) as HTMLElement).click();
      }),
    [click, show] as const,
  );
}

/** Kaydedici durduktan sonra yükleme sürmez: bir parça süresinden (5 sn) uzun pencerede yeni PUT ve yeni parça yok. */
async function expectUploadsStopped(page: Page, puts: number[], stored: () => Promise<unknown[]>) {
  await page.waitForTimeout(1500); // `now` kapanışının kuyruk parçası yerleşsin
  const n = (await stored()).length;
  const k = puts.length;
  await page.waitForTimeout(REC_PART_MS + 1500);
  expect((await stored()).length).toBe(n);
  expect(puts.length).toBe(k);
}

test.describe("Müşteri rızası, gösterge, Kaydı durdur, konsol kaydedici (AC-381..384)", () => {
  test("AC-382/383: rıza → kayıt: müşteri + konsol göstergesi, sekme başlığı, parçalar yüklenir (WebM), yeni bölüm, oynatıcıda oynar, Kaydı durdur ≤ 2 sn", async ({
    page,
    context,
    browser,
  }, info) => {
    desktopOnly(info.project.name);
    test.setTimeout(90_000);
    await signIn(context, "p28ec");
    await page.addInitScript(instrumentStops);
    const puts: number[] = [];
    page.on("request", (r) => r.method() === "PUT" && /\/api\/v1\/rec\//.test(r.url()) && puts.push(Date.now()));
    const { s, g } = await live(page, browser);
    await expect(g.getByTestId("rec-guest-on")).toHaveText("Kayıt yapılıyor");
    await expect(g).toHaveTitle(new RegExp(`^${PREFIX}`));
    await expect(page.getByTestId("rec-console-on")).toContainText("Kayıt yapılıyor");
    await scanThemes(g, '[data-testid="share-strip"]', "müşteri şeridi (paylaşım öncesi)");
    await scanThemes(page, '[data-testid="rec-console"]', "konsol kayıt rozeti");
    await g.getByTestId("share-start").click();
    await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
    await expect(g.getByTestId("share-strip")).toHaveAttribute("data-state", "sharing");
    await scanThemes(g, '[data-testid="share-strip"]', "müşteri şeridi (paylaşılıyor)");
    const rid = ((await (await page.request.get(`${MOCK}/__e2e/rec/${s.id}`)).json()) as { rid: string }).rid;
    const stored = async () =>
      (await (await page.request.get(`${MOCK}/__e2e/rec-parts/${rid}`)).json()) as {
        k: string;
        head: string;
        size: number;
        start: number | null;
      }[];
    await expect.poll(async () => (await stored()).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    await page.request.get(`${MOCK}/__e2e/rec/${s.id}?series=1`); // yeniden bağlanma gibi yeni belirteç + bölüm
    await expect.poll(async () => (await stored()).some((x) => x.k === "1:0"), { timeout: 20_000 }).toBe(true);
    const all = await stored();
    for (const x of all.filter((x) => x.k.endsWith(":0"))) {
      expect(x.head).toBe("1a45dfa3"); // bölüm başı EBML
      expect(x.start).not.toBeNull();
    }
    const tails = all.filter((x) => !x.k.endsWith(":0")).map((x) => x.head);
    test.info().annotations.push({ type: "cluster-heads", description: tails.join(",") });
    for (const h of tails) expect(h).not.toBe("1a45dfa3"); // S-P28e-7: p>0 EBML ile başlamaz

    // AC-382 ≤ 2 sn: tıklama → misafir göstergesi kalkar (sayfa içi ölçüm) ve konsol kaydedicisi durur (MediaRecorder.stop anı)
    const { ms, at } = await clickUntil(g, "rec-guest-stop", "rec-guest-off");
    expect(ms).toBeLessThanOrEqual(2000);
    await expect(g.getByTestId("rec-guest-on")).toHaveCount(0);
    await expect(g.getByTestId("rec-guest-off")).toHaveText("Kayıt durduruldu; o ana kadarki kısım saklanır");
    await expect(g).not.toHaveTitle(new RegExp(`^${PREFIX}`));
    await expect(page.getByTestId("rec-console-stopped")).toHaveText("Müşteri kayıt iznini geri aldı");
    await expect(page.getByTestId("rec-console-on")).toHaveCount(0);
    const stopAt = (await recStops(page)).find((x) => x >= at);
    expect(stopAt, "konsol kaydedicisi durmalı").toBeDefined();
    expect(stopAt! - at).toBeLessThanOrEqual(2000);
    test.info().annotations.push({ type: "AC-382", description: `misafir ${Math.round(ms)} ms, konsol kaydedici ${stopAt! - at} ms` });
    await expectUploadsStopped(page, puts, stored);
    const log = (await (await page.request.get(`${MOCK}/__e2e/ws-log/${s.id}`)).json()) as { m: { t: string } }[];
    expect(log.filter((x) => x.m.t === "rec.consent")).toHaveLength(1);

    // Konsolun yüklediği gerçek parçalar oynatıcıda oynar (kaydedici → MSE zinciri)
    const n = (await stored()).length;
    await page.request.post(`${MOCK}/__e2e/rec-seed/${RID_REC}`, { data: { from: rid } });
    await g.context().close();
    await context.clearCookies();
    await signIn(context, "p28eadm");
    await page.goto(`/history/${REC}`);
    await page.getByTestId("rec-watch").click();
    const video = page.getByTestId("rec-video");
    await expect(page.getByTestId("rec-player")).toHaveAttribute("data-status", "ready", { timeout: 15_000 });
    // Toplam tamponlanmış süre: bölümler ayrı aralık olabilir (yavaş CI'da ilk bölüm kısa kalır; oynatıcı boşluğu atlar)
    const bufferedTotal = (v: HTMLVideoElement) => {
      let sum = 0;
      for (let k = 0; k < v.buffered.length; k++) sum += v.buffered.end(k) - v.buffered.start(k);
      return sum;
    };
    await expect.poll(() => video.evaluate(bufferedTotal), { timeout: 15_000 }).toBeGreaterThan(3);
    await page.getByTestId("rec-play").click();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThan(1);
    expect(n).toBeGreaterThanOrEqual(3);
  });

  test("AC-382 / S-P28e-2: 2 sn'de onay gelmezse paylaşım yerelde 2000 ms'de duraklar", async ({ page, context, browser }, info) => {
    desktopOnly(info.project.name);
    await signIn(context, "p28ecnoack");
    const { g } = await live(page, browser);
    await g.getByTestId("share-start").click();
    await expect(g.getByTestId("rec-guest-on")).toBeVisible();
    // Onaysız yol yapısı gereği REC_REVOKE_ACK_MS (2000 ms) zamanlayıcısıdır: alt sınır zamanlayıcıyı, üst sınır
    // (+ 500 ms işleme payı, QA tur 1 madde 5) "2 sn'de durur"u sabitler. Ölçüm sayfa içinde performance.now ile.
    const { ms } = await clickUntil(g, "rec-guest-stop", "rec-guest-paused");
    expect(ms).toBeGreaterThanOrEqual(REC_REVOKE_ACK_MS - 50);
    expect(ms).toBeLessThanOrEqual(REC_REVOKE_ACK_MS + 500);
    await expect(g.getByTestId("rec-guest-paused")).toHaveText("Kayıt durdurulamadı, paylaşım duraklatıldı");
    await scanThemes(g, '[data-testid="share-strip"]', "müşteri şeridi (duraklatıldı)");
    expect(await g.evaluate(() => (document.querySelector("video") as HTMLVideoElement | null)?.srcObject instanceof MediaStream)).toBe(
      true,
    );
    const enabled = await g.evaluate(() =>
      ((document.querySelector("video") as HTMLVideoElement).srcObject as MediaStream).getVideoTracks().every((t) => t.enabled),
    );
    expect(enabled).toBe(false);
    await g.context().close();
  });

  test("AC-384: kayıt sürerken kota dolunca konsolda 'Depolama kotası doldu, kayıt durdu' (uyarı), gösterge kalkar, yükleme durur", async ({
    page,
    context,
    browser,
  }, info) => {
    desktopOnly(info.project.name);
    test.setTimeout(60_000);
    await signIn(context, "p28ec");
    await page.addInitScript(instrumentStops);
    const puts: number[] = [];
    page.on("request", (r) => r.method() === "PUT" && /\/api\/v1\/rec\//.test(r.url()) && puts.push(Date.now()));
    const { s, g } = await live(page, browser);
    await g.getByTestId("share-start").click();
    await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
    const first = await page.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/v1\/rec\//.test(r.url()), {
      timeout: 20_000,
    });
    expect(first.status()).toBe(200);
    const rid = /\/rec\/([^/]+)\/series\//.exec(first.url())![1]!;
    const stored = async () => (await (await page.request.get(`${MOCK}/__e2e/rec-parts/${rid}`)).json()) as unknown[];
    await expect(page.getByTestId("rec-console-on")).toBeVisible();

    // Sunucu kota dolunca kaydı STOPPED{QUOTA} yapar ve iki tarafa rec.state{off, reason: "quota"} gönderir
    const at = Date.now();
    expect((await page.request.get(`${MOCK}/__e2e/rec/${s.id}?off=quota`)).ok()).toBe(true);
    const warn = page.getByTestId("rec-console-stopped");
    await expect(warn).toHaveText("Depolama kotası doldu, kayıt durdu");
    await expect(warn).toHaveAttribute("role", "status");
    await expect(warn).toHaveClass(/bg-warning-surface/);
    await expect(page.getByTestId("rec-console-on")).toHaveCount(0);
    await expect(page.getByTestId("rec-console")).toHaveAttribute("data-on", "false");
    await expect(g.getByTestId("rec-guest-on")).toHaveCount(0);
    await expect(g.getByTestId("rec-guest-off")).toHaveAttribute("data-reason", "quota");
    await expect(g).not.toHaveTitle(new RegExp(`^${PREFIX}`));
    await expect.poll(async () => (await recStops(page)).some((x) => x >= at)).toBe(true);
    await expectUploadsStopped(page, puts, stored);
    await g.context().close();
  });

  test("AC-381/384: rıza işaretlenmezse kayıt yok; teklif yoksa (kayıt kapalı ya da oturum başında kota dolu — sunucu teklif etmez) kutu yok", async ({
    page,
    context,
    browser,
  }, info) => {
    desktopOnly(info.project.name);
    await signIn(context, "p28ec");
    const s = await newSession(page);
    await page.goto(`/sessions/${s.id}/console`);
    const { g, code } = await joinWithRec(browser, s.link, false);
    await page.getByTestId("admit-input").fill(code);
    await page.getByTestId("admit-submit").click();
    await expect(page.getByTestId("console-status")).toHaveText("Aktif");
    await expect(g.getByTestId("share-strip")).toBeVisible();
    await expect(g.getByTestId("rec-guest-on")).toHaveCount(0);
    await expect(page.getByTestId("rec-console")).toHaveCount(0);
    await g.context().close();
    await context.clearCookies();
    await signIn(context, "p4");
    const s2 = await newSession(page);
    const ctx = await browser.newContext();
    const g2 = await ctx.newPage();
    await g2.goto(new URL(s2.link).pathname);
    await expect(g2.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
    await expect(g2.getByTestId("rec-consent-box")).toHaveCount(0);
    await ctx.close();
  });
});
