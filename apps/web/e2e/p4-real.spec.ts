import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_COOKIE, CSRF_HEADER } from "@remote/contracts/api/auth";
import { guardConsole, rows } from "./helpers";

// P4 tarayıcı medya hattı — GERÇEK apps/server + MySQL'e karşı (sahte API/WS yok). Yalnız E2E_REAL=1 ile koşar;
// config: playwright.real.config.ts. Kullanıcılar: aynı tenant'ta iki ADMIN (ilk giriş şifre değişimi kapalı).
test.skip(!process.env.E2E_REAL, "gerçek sunucu gerekir (E2E_REAL=1)");
guardConsole();

const PASSWORD = process.env.E2E_REAL_PASSWORD ?? "";
const LOGIN = process.env.E2E_REAL_LOGIN ?? "";
const LOGIN2 = process.env.E2E_REAL_LOGIN2 ?? "";

async function login(page: Page, email = LOGIN) {
  await page.goto("/login");
  await page.locator('input[name="login"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Önceki koşulardan kalan PENDING/ACTIVE oturumları kapatır (açık oturum sınırı, AC-12). */
async function cancelLeftovers(page: Page) {
  const csrf = (await page.context().cookies()).find((c) => c.name === CSRF_COOKIE)?.value ?? "";
  const headers = { [CSRF_HEADER]: csrf, Origin: "http://localhost:3218" };
  const list = (await (await page.request.get("/api/v1/sessions?pageSize=100")).json()) as { items: { id: string; status: string }[] };
  for (const s of list.items.filter((i) => i.status === "PENDING" || i.status === "ACTIVE")) {
    await page.request.post(`/api/v1/sessions/${s.id}/${s.status === "PENDING" ? "cancel" : "terminate"}`, { headers, data: {} });
  }
}

/** Arayüzden yeni oturum → müşteri linki; konsol listedeki en yeni satırdan açılır. */
async function createSession(page: Page) {
  await cancelLeftovers(page);
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const dlg = page.getByTestId("new-session-dialog");
  const link = await dlg.getByTestId("session-link").inputValue();
  expect(link).toMatch(/^http:\/\/localhost:3218\/session\//);
  await dlg.getByRole("button", { name: "Kapat", exact: true }).click();
  await rows(page).first().getByTestId("open-console").click();
  await page.waitForURL(/\/sessions\/[0-9A-Z]{26}\/console$/);
  await expect(page.getByTestId("stage")).toContainText("Müşteri bekleniyor");
  return link;
}

/**
 * Müşteri bağlamında getDisplayMedia taklidi (QA-P5-6): fiziksel ekran yerine 1280x720 canvas, 30 fps captureStream.
 * Her karede içerik değişir (kodlayıcı kare atlamasın). Ekran kilitli/CI'da da kare üretir; medya hattı (WebRTC,
 * sinyal, gerçek server) aynen gerçek kalır — yalnız kaynak sentetiktir.
 */
function fakeDisplayMedia() {
  const md = navigator.mediaDevices;
  if (!md) return;
  md.getDisplayMedia = async () => {
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 720;
    const x = c.getContext("2d")!;
    let f = 0;
    const draw = () => {
      f++;
      x.fillStyle = `hsl(${(f * 7) % 360} 60% 50%)`;
      x.fillRect(0, 0, 1280, 720);
      x.fillStyle = "#fff";
      x.font = "80px sans-serif";
      x.fillText(`kare ${f}`, 100 + ((f * 13) % 600), 360);
    };
    draw();
    const timer = setInterval(draw, 33);
    const stream = c.captureStream(30);
    for (const t of stream.getVideoTracks()) t.addEventListener("ended", () => clearInterval(timer));
    return stream;
  };
}

async function openGuest(browser: Browser, link: string): Promise<[BrowserContext, Page]> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(fakeDisplayMedia);
  const g = await ctx.newPage();
  await g.goto(link);
  return [ctx, g];
}

async function joinLobby(g: Page, name: string) {
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill(name);
  await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  await expect(g.getByTestId("guest-lobby")).toBeVisible();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\D/g, "");
  expect(code).toMatch(/^\d{4}$/);
  return code;
}

async function admit(page: Page, code: string, name: string) {
  await expect(page.getByTestId("lobby-guest")).toContainText(name);
  await page.getByTestId("admit-input").fill(code);
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect(page.getByTestId("console-guest")).toHaveText(name);
}

const videoLive = (page: Page) =>
  expect
    .poll(() => page.getByTestId("console-video").evaluate((v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth > 0), { timeout: 20_000 })
    .toBe(true);

test("REAL AC-28..33, 59, 112: login → oturum → lobi → kabul → paylaşım → video → durdur/yeniden → teknisyen bitirir", async ({ page, browser }) => {
  await login(page);
  const link = await createSession(page);
  const [gctx, g] = await openGuest(browser, link);
  await expect(g.getByTestId("consent-text")).toBeVisible();
  const code = await joinLobby(g, "Ayşe Yılmaz");

  // Yanlış kod → hata (gerçek server sayacı), sonra doğru kod
  await expect(page.getByTestId("lobby-guest")).toContainText("Ayşe Yılmaz");
  await page.getByTestId("admit-input").fill(code === "0000" ? "1111" : "0000");
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("lobby-panel")).toContainText("4 hatalı girişte");
  await admit(page, code, "Ayşe Yılmaz");

  await expect(g.getByTestId("share-strip")).toHaveAttribute("data-state", "idle");
  await g.getByTestId("share-start").click();
  await expect(g.getByTestId("share-strip")).toHaveAttribute("data-state", "sharing");
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  await videoLive(page);

  await g.getByTestId("share-stop").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "stopped");
  await g.getByTestId("share-start").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  await videoLive(page);

  await page.getByTestId("console-end").click();
  await page.getByTestId("console-confirm-ok").click();
  await expect(page.getByTestId("console-ended")).toBeVisible();
  await expect(g.getByTestId("guest-finished")).toBeVisible();
  await gctx.close();
});

test("REAL AC-59: müşteri bitirir → iki taraf bitiş", async ({ page, browser }) => {
  await login(page);
  const link = await createSession(page);
  const [gctx, g] = await openGuest(browser, link);
  await admit(page, await joinLobby(g, "Mehmet Demir"), "Mehmet Demir");
  await g.getByTestId("share-start").click();
  await videoLive(page);
  await g.getByTestId("guest-end").click();
  await g.getByTestId("guest-end-confirm").click();
  await expect(g.getByTestId("guest-finished")).toBeVisible();
  await expect(page.getByTestId("console-ended")).toContainText("Müşteri oturumu bitirdi");
  await gctx.close();
});

test("REAL AC-24: teknisyen konsolu yenilenir (paylaşım sürerken) → yeniden bağlanır, video ve paylaşım durumu geri gelir", async ({ page, browser }) => {
  await login(page);
  const link = await createSession(page);
  const [gctx, g] = await openGuest(browser, link);
  await admit(page, await joinLobby(g, "Ali Veli"), "Ali Veli");
  await g.getByTestId("share-start").click();
  await videoLive(page);
  await page.reload();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect(page.getByTestId("console-guest")).toHaveText("Ali Veli");
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  await videoLive(page);
  await expect(g.getByTestId("share-strip")).toHaveAttribute("data-state", "sharing");
  await page.getByTestId("console-end").click();
  await page.getByTestId("console-confirm-ok").click();
  await expect(g.getByTestId("guest-finished")).toBeVisible();
  await gctx.close();
});

test("REAL AC-113: teknisyen bekleyeni reddeder → müşteri ret ekranı", async ({ page, browser }) => {
  await login(page);
  const link = await createSession(page);
  const [gctx, g] = await openGuest(browser, link);
  await joinLobby(g, "Beklenmeyen Kişi");
  await page.getByRole("button", { name: "Reddet: Beklenmeyen Kişi" }).click();
  await expect(g.getByTestId("guest-rejected")).toBeVisible();
  await expect(page.getByTestId("stage")).toContainText("Müşteri bekleniyor");
  await gctx.close();
});

test("REAL AC-114: Admin aktif oturumu zorla sonlandırır → müşteri ve konsol bitiş", async ({ page, browser }) => {
  test.skip(!LOGIN2, "E2E_REAL_LOGIN2 (aynı tenant'ta ikinci Admin) gerekir");
  // Oturum sahibi LOGIN2, sonlandıran Admin LOGIN (saatlik oluşturma sınırı AC-12 kullanıcılar arasında paylaşılsın)
  await login(page, LOGIN2);
  const link = await createSession(page);
  const [gctx, g] = await openGuest(browser, link);
  await admit(page, await joinLobby(g, "Zeynep Kaya"), "Zeynep Kaya");

  const actx = await browser.newContext();
  const admin = await actx.newPage();
  await login(admin, LOGIN);
  await admin.goto("/sessions");
  // Liste müşteri adını taşımaz (SessionView); en yeni satır = az önce kabul edilen oturum (Aktif)
  const row = rows(admin).first();
  await expect(row).toContainText("Aktif");
  await row.getByTestId("terminate").click();
  await expect(admin.getByTestId("terminate-dialog")).toBeVisible();
  await admin.getByTestId("terminate-confirm").click();
  await expect(admin.getByText("Oturum sonlandırıldı")).toBeVisible();

  await expect(g.getByTestId("guest-finished")).toBeVisible();
  await expect(page.getByTestId("console-ended")).toBeVisible();
  await actx.close();
  await gctx.close();
});
