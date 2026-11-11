import { expect, test, type Browser, type Page } from "@playwright/test";
import { CSRF_HEADER } from "@remote/contracts/api/auth";
import { axeScan, guardConsole, noHorizontalOverflow, signIn } from "./helpers";

// P4 tarayıcı modu medya hattı (AC-26..33, 59, 112–114, 125, 127). Sahte API + sahte WS (e2e/mock-ws.mjs).
guardConsole();

async function newSession(page: Page) {
  const r = await page.request.post("/api/v1/sessions", {
    headers: { [CSRF_HEADER]: "csrf-test-token", Origin: "http://localhost:3217" },
    data: {},
  });
  expect(r.status()).toBe(201);
  return (await r.json()) as { id: string; link: string };
}

async function openGuest(browser: Browser, link: string, scheme: "light" | "dark" = "light") {
  const ctx = await browser.newContext({ colorScheme: scheme });
  const g = await ctx.newPage();
  await g.goto(new URL(link).pathname);
  return g;
}

async function joinLobby(g: Page, name = "Ayşe Yılmaz") {
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await expect(g.getByTestId("join-browser")).toBeDisabled();
  await g.getByTestId("guest-name").fill(name);
  await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  await expect(g.getByTestId("guest-lobby")).toBeVisible();
  const label = await g.getByTestId("admit-code").getAttribute("aria-label");
  return (label ?? "").replace(/\s/g, "");
}

test("AC-28..33, 59, 112: karşılama → KVKK → lobi → kabul → paylaşım → teknisyen video → durdur → bitir", async ({ page, context, browser }, info) => {
  test.skip(info.project.name !== "desktop", "konsol masaüstü akışı");
  await signIn(context, "p4");
  const s = await newSession(page);
  await page.goto(`/sessions/${s.id}/console`);
  await expect(page.getByTestId("stage")).toContainText("Müşteri bekleniyor");

  const g = await openGuest(browser, s.link);
  await expect(g.getByTestId("fraud-warning")).toBeVisible();
  await expect(g.getByTestId("consent-text")).toContainText("Ekran görüntünüz kaydedilmez");
  const code = await joinLobby(g);
  expect(code).toMatch(/^\d{4}$/);

  await expect(page.getByTestId("lobby-guest")).toContainText("Ayşe Yılmaz");
  await page.getByTestId("admit-input").fill(code === "0000" ? "1111" : "0000");
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("lobby-panel")).toContainText("4 hatalı girişte");
  await page.getByTestId("admit-input").fill(code);
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect(page.getByTestId("console-guest")).toHaveText("Ayşe Yılmaz");

  await expect(g.getByTestId("share-strip")).toHaveAttribute("data-state", "idle");
  await g.getByTestId("share-start").click();
  await expect(g.getByTestId("share-strip")).toHaveAttribute("data-state", "sharing");
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  await expect
    .poll(() => page.getByTestId("console-video").evaluate((v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth > 0), { timeout: 15_000 })
    .toBe(true);

  await g.getByTestId("share-stop").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "stopped");
  await expect(page.getByTestId("stage")).toContainText("Müşteri paylaşımı durdurdu");
  await g.getByTestId("share-start").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");

  await g.getByTestId("guest-end").click();
  await expect(g.getByTestId("guest-end-dialog")).toBeVisible();
  await g.getByTestId("guest-end-confirm").click();
  await expect(g.getByTestId("guest-finished")).toBeVisible();
  await expect(page.getByTestId("console-ended")).toContainText("Müşteri oturumu bitirdi");
  await g.context().close();
});

test("AC-113: teknisyen bekleyeni reddeder → müşteri ret ekranı", async ({ page, context, browser }, info) => {
  test.skip(info.project.name !== "desktop", "konsol masaüstü akışı");
  await signIn(context, "p4r");
  const s = await newSession(page);
  await page.goto(`/sessions/${s.id}/console`);
  const g = await openGuest(browser, s.link);
  await joinLobby(g, "Beklenmeyen Kişi");
  await page.getByRole("button", { name: "Reddet: Beklenmeyen Kişi" }).click();
  await expect(g.getByTestId("guest-rejected")).toBeVisible();
  await expect(page.getByTestId("stage")).toContainText("Müşteri bekleniyor");
  await g.context().close();
});

test("AC-114: Admin aktif oturumu zorla sonlandırır (onaylı)", async ({ page, context }) => {
  await signIn(context, "admin");
  await page.goto("/sessions");
  await page.getByTestId("terminate").filter({ visible: true }).first().click();
  await expect(page.getByTestId("terminate-dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await page.getByTestId("terminate-confirm").click();
  await expect(page.getByText("Oturum sonlandırıldı")).toBeVisible();
  await expect(page.getByTestId("terminate").filter({ visible: true })).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`AC-39: müşteri ekranları axe + 375 px (${scheme})`, async ({ page, context, browser }, info) => {
    await signIn(context, `p4a${scheme}`);
    const s = await newSession(page);
    const g = await openGuest(browser, s.link, scheme);
    await g.setViewportSize({ width: 375, height: 780 });
    expect(await axeScan(g)).toEqual([]);
    await noHorizontalOverflow(g);
    if (info.project.name === "mobile") {
      // AC-33: mobil cihaz lobiye giremez; desteklenmiyor ekranı erişilebilir olmalı
      await expect(g.getByTestId("guest-unsupported")).toBeVisible();
      await expect(g.getByTestId("join-browser")).toHaveCount(0);
      return g.context().close();
    }
    await joinLobby(g);
    expect(await axeScan(g)).toEqual([]);
    await noHorizontalOverflow(g);
    await g.getByTestId("lobby-leave").click();
    await expect(g.getByTestId("guest-left")).toBeVisible();
    await g.context().close();
  });
}

test("AC-39: konsol (koyu) axe + klavye ile kabul kodu", async ({ page, context, browser }, info) => {
  test.skip(info.project.name !== "desktop", "konsol masaüstü");
  await signIn(context, "p4k");
  const s = await newSession(page);
  await page.goto(`/sessions/${s.id}/console`);
  await expect(page.getByTestId("stage")).toContainText("Müşteri bekleniyor");
  expect(await axeScan(page)).toEqual([]);
  const g = await openGuest(browser, s.link);
  const code = await joinLobby(g);
  await page.getByTestId("admit-input").focus();
  await page.keyboard.type(code);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  expect(await axeScan(page)).toEqual([]);
  expect(await axeScan(g)).toEqual([]);
  await page.getByTestId("console-end").click();
  await page.getByTestId("console-confirm-ok").click();
  await expect(g.getByTestId("guest-finished")).toBeVisible();
  await g.context().close();
});

/** Konsolu açar, müşteriyi lobiden kabul eder; konsol + müşteri sayfasını döner. */
async function liveSession(page: Page, browser: Browser, init?: () => void) {
  const s = await newSession(page);
  await page.goto(`/sessions/${s.id}/console`);
  await expect(page.getByTestId("stage")).toContainText("Müşteri bekleniyor");
  const ctx = await browser.newContext();
  if (init) await ctx.addInitScript(init);
  const g = await ctx.newPage();
  await g.goto(new URL(s.link).pathname);
  const code = await joinLobby(g);
  await page.getByTestId("admit-input").fill(code);
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  return g;
}

test("AC-26/125: karşılamadaki doğrulama kodu = konsoldaki kod; bildir bağlantısı mailto", async ({ page, context, browser }, info) => {
  test.skip(info.project.name !== "desktop", "konsol masaüstü");
  await signIn(context, "p4v");
  const s = await newSession(page);
  await page.goto(`/sessions/${s.id}/console`);
  const g = await openGuest(browser, s.link);
  const digits = async (p: Page, id: string) => ((await p.getByTestId(id).getAttribute("aria-label")) ?? "").replace(/\s/g, "");
  const guestCode = await digits(g, "guest-verify-code");
  expect(guestCode).toMatch(/^\d{4}$/);
  expect(await digits(page, "console-verify-code")).toBe(guestCode);
  await expect(g.getByRole("link", { name: "Kötüye kullanımı bildir" })).toHaveAttribute("href", "mailto:kotuye-kullanim@ornek.com");
  await g.context().close();
});

test("AC-30: paylaşım reddedilirse 'Paylaşım başlatılmadı' + 'Tekrar dene' → ikinci denemede paylaşım", async ({ page, context, browser }, info) => {
  test.skip(info.project.name !== "desktop", "konsol masaüstü akışı");
  await signIn(context, "p4d");
  const g = await liveSession(page, browser, () => {
    // İlk çağrı kullanıcı iptali gibi NotAllowedError; sonrakiler gerçek (sahte kaynak)
    const real = MediaDevices.prototype.getDisplayMedia;
    let first = true;
    MediaDevices.prototype.getDisplayMedia = function (this: MediaDevices, ...a: Parameters<typeof real>) {
      if (first) {
        first = false;
        return Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
      }
      return real.apply(this, a);
    };
  });
  await g.getByTestId("share-start").click();
  const denied = g.getByTestId("share-denied");
  await expect(denied).toContainText("Paylaşım başlatılmadı");
  await expect(g.getByTestId("share-strip")).toHaveAttribute("data-state", "idle");
  await g.getByTestId("share-retry").click();
  await expect(g.getByTestId("share-strip")).toHaveAttribute("data-state", "sharing");
  await expect(denied).toHaveCount(0);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  await g.context().close();
});

test("AC-34: tarayıcı modunda 'Uzaktan kontrol' pasif ve nedeni açıklanır", async ({ page, context, browser }, info) => {
  test.skip(info.project.name !== "desktop", "konsol masaüstü akışı");
  await signIn(context, "p4c");
  const g = await liveSession(page, browser);
  const btn = page.getByTestId("console-control");
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveText("Uzaktan kontrol");
  await expect(btn).toHaveAccessibleDescription("Müşteri tarayıcı modunda: yalnız görüntüleme");
  await expect(page.getByTestId("console-control-hint")).toBeVisible();
  // TEST-P4-2: canlı kabulde kalan süre geri sayımı (peer.joined.maxEndsAt) — "—" değil
  await expect(page.getByTestId("console-left")).toHaveText(/\d/);
  // TEST-P4-4: 1280 px'te "Oturumu bitir" üst barda aynı satırda
  const top = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
  expect(Math.abs((await top("console-end")) - (await top("console-control")))).toBeLessThan(8);
  await g.context().close();
});

test("TEST-P4-1: müşteri aktif oturumda sayfayı yeniler → 'kullanıldı' değil, aynı oturuma döner; bitince link kullanılmış", async ({ page, context, browser }, info) => {
  test.skip(info.project.name !== "desktop", "konsol masaüstü akışı");
  await signIn(context, "p4r");
  const g = await liveSession(page, browser);
  await g.getByTestId("share-start").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  // Dönüş kaydı yalnız sekme deposunda, rs.* önekli; link token'ı anahtarda açık yok
  const stored = await g.evaluate(() => Object.entries(sessionStorage));
  const token = new URL(g.url()).pathname.split("/").pop()!;
  expect(stored).toHaveLength(1);
  expect(stored[0]![0]).toMatch(/^rs\.resume\.[0-9a-f]{32}$/);
  expect(stored[0]![0]).not.toContain(token); // (sahte API'nin sessionRef'i token içerir; gerçek sunucuda opak)

  await g.reload();
  await expect(g.getByTestId("guest-consumed")).toHaveCount(0);
  await expect(g.getByTestId("share-strip")).toHaveAttribute("data-state", "idle"); // paylaşım yalnız tıklamayla yeniden başlar
  await expect(g.getByTestId("guest-lobby")).toHaveCount(0);
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await g.getByTestId("share-start").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");

  // Müşteri bitirir → kayıt silinir; yenilemede "zaten kullanıldı"
  await g.getByTestId("guest-end").click();
  await g.getByTestId("guest-end-confirm").click();
  await expect(g.getByTestId("guest-finished")).toBeVisible();
  expect(await g.evaluate(() => sessionStorage.length)).toBe(0);
  await expect(g.locator("footer")).toBeHidden(); // TEST-P4-5
  await g.reload();
  await expect(g.getByTestId("guest-consumed")).toBeVisible();
  await expect(g.locator("footer")).toBeHidden();
  await g.context().close();
});

test("TEST-P4-1: oturum bittikten sonra kalan dönüş kaydı → kayıt silinir, 'kullanıldı' ekranı", async ({ page, context, browser }, info) => {
  test.skip(info.project.name !== "desktop", "konsol masaüstü akışı");
  await signIn(context, "p4x");
  const g = await liveSession(page, browser);
  const saved = await g.evaluate(() => Object.entries(sessionStorage));
  expect(saved).toHaveLength(1);
  // Teknisyen bitirir; sekme o sırada kapalıymış gibi kaydı geri koy → dönüş reddedilir, durum ENDED → dur
  await page.getByTestId("console-end").click();
  await page.getByTestId("console-confirm-ok").click();
  await expect(g.getByTestId("guest-finished")).toBeVisible();
  await g.evaluate(([k, v]) => sessionStorage.setItem(k, v), saved[0]!);
  await g.reload();
  await expect(g.getByTestId("guest-consumed")).toBeVisible({ timeout: 5000 });
  expect(await g.evaluate(() => sessionStorage.length)).toBe(0);
  await g.context().close();
});

test("AC-43: konsol sahnesi Sığdır / %100 (kaydırmalı) / Tam ekran — klavyeyle", async ({ page, context, browser }, info) => {
  test.skip(info.project.name !== "desktop", "konsol masaüstü akışı");
  await signIn(context, "p4m");
  const g = await liveSession(page, browser);
  await g.getByTestId("share-start").click();
  const stage = page.getByTestId("stage");
  await expect(stage).toHaveAttribute("data-share", "sharing");
  await expect(stage).toHaveAttribute("data-mode", "fit");
  const fit = page.getByRole("button", { name: "Sığdır" });
  const actual = page.getByRole("button", { name: "%100" });
  await expect(fit).toHaveAttribute("aria-pressed", "true");
  await actual.focus();
  await page.keyboard.press("Enter");
  await expect(stage).toHaveAttribute("data-mode", "actual");
  await expect(actual).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: /kaydırılabilir/ })).toHaveAttribute("tabindex", "0");
  await expect(page.getByTestId("console-video")).toHaveClass(/max-w-none/);
  await fit.focus();
  await page.keyboard.press("Space");
  await expect(stage).toHaveAttribute("data-mode", "fit");
  await expect(page.getByTestId("console-video")).toHaveClass(/object-contain/);
  const full = page.getByTestId("stage-fullscreen");
  await full.focus();
  await page.keyboard.press("Enter");
  await expect(stage).toHaveAttribute("data-fullscreen", "true");
  await expect(full).toHaveAttribute("aria-pressed", "true");
  await expect(full).toHaveText("Tam ekrandan çık");
  await page.keyboard.press("Enter");
  await expect(stage).toHaveAttribute("data-fullscreen", "false");
  expect(await axeScan(page)).toEqual([]);
  await g.context().close();
});
