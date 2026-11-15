import { expect, test, type Browser, type Page } from "@playwright/test";
import { axeScan, desktopOnly, guardConsole, newSession, noHorizontalOverflow, signIn } from "./helpers";

// P13b-L bekleme odası (lobi) göstergesi (AC-304..315; mimari-lobi §9.3). Sahte API: e2e/mock-sessions.mjs (lobi kancası).
// Bekleme için page.clock (gerçek 10 sn beklenmez). Konsol bekçisi dosyaya özgü desenle: kesilen istek (route.abort) tarayıcıda
// "net::ERR_FAILED" kaynak satırı üretir; uygulama kaynaklı console.error/warn ve pageerror yine 0 olmalı (AC-315).
const MOCK = "http://127.0.0.1:4217";
const WAITING = "/api/v1/sessions/waiting";
const OWNER = "01JUSER0000000000000000009";
const GUEST = "Ayşe Yılmaz";

guardConsole(/^Failed to load resource: (the server responded with a status of (400|401|403|404|409|410|429|500|503)|net::ERR_FAILED)/);

const setLobby = async (page: Page, id: string, waiting: number, arrivals = waiting) =>
  expect((await page.request.get(`${MOCK}/__e2e/lobby/${id}?waiting=${waiting}&arrivals=${arrivals}`)).ok()).toBe(true);
/** Sorgusuz kanca: oda kaydı silinir (sunucu yeniden başladı → 0). */
const resetLobby = async (page: Page, id: string) => expect((await page.request.get(`${MOCK}/__e2e/lobby/${id}`)).ok()).toBe(true);
const calls = async (page: Page, cookie: string) =>
  ((await (await page.request.get(`${MOCK}/__e2e/lobby-calls/${cookie}`)).json()) as { calls: number }).calls;

interface Item {
  id: string;
  status: string;
  technician: { id: string; name: string };
  waitingGuests: number;
}
async function ownPending(page: Page): Promise<string[]> {
  const r = await page.request.get("/api/v1/sessions?pageSize=100");
  const items = ((await r.json()) as { items: Item[] }).items;
  return items.filter((s) => s.status === "PENDING" && s.technician.id === OWNER).map((s) => s.id);
}

/** Sayfayı açar ve ilk (temel çizgi) yoklamanın işlenmesini bekler. */
async function openAt(page: Page, path: string) {
  const first = page.waitForResponse((r) => r.url().endsWith(WAITING));
  await page.goto(path);
  await first;
  await page.waitForTimeout(150);
}
/** Bir yoklama turu: saat 10 sn ilerler, waiting yanıtı gelir ve işlenir. */
async function tick(page: Page, ms = 10_000) {
  const r = page.waitForResponse((x) => x.url().endsWith(WAITING));
  await page.clock.runFor(ms);
  await r;
  await page.waitForTimeout(150);
}
async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

const navSessions = (page: Page) => page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: /Oturumlar/ });
const toasts = (page: Page) => page.getByTestId("toast");
async function guestJoins(browser: Browser, link: string) {
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await g.goto(new URL(link).pathname);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill(GUEST);
  await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  await expect(g.getByTestId("guest-lobby")).toBeVisible();
  return ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
}

test("AC-304/305/307/311: liste açıkken misafir gelir → ≤ 10 sn rozet + toast → rozetle konsol, lobi ilk ekranda → kabul → rozet yok", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.install();
  await signIn(context, "lob");
  const s = await newSession(page);
  await openAt(page, "/sessions");
  await expect(page.getByTestId("waiting-badge")).toHaveCount(0);
  // PENDING satırlarda görünmez yuva (yer kaymaz)
  await expect(page.getByTestId("waiting-slot").filter({ visible: false }).first()).toBeAttached();

  const code = await guestJoins(browser, s.link);
  await setLobby(page, s.id, 1);
  await tick(page);
  const badge = page.getByRole("link", { name: "Müşteri bekliyor (1) — konsolu aç" });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText("Müşteri bekliyor (1)");
  await expect(navSessions(page).getByTestId("lobby-badge")).toHaveText(/1/);
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page)).toContainText("Bekleme odasında müşteri var");
  await expect(toasts(page).getByRole("link", { name: "Konsolu aç" })).toHaveAttribute("href", `/sessions/${s.id}/console`);
  // AC-311: misafir adı göstergelerde yok
  for (const loc of [badge, toasts(page), navSessions(page), page.locator("main")]) await expect(loc).not.toContainText(GUEST);
  expect(await page.title()).not.toContain(GUEST);

  await badge.click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${s.id}/console$`));
  await expect(page.getByTestId("lobby-panel")).toBeInViewport();
  await expect(page.getByTestId("lobby-guest")).toContainText(GUEST);
  await page.getByTestId("admit-input").fill(code);
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");

  // Kabul: oturum ACTIVE → sayı 0 (mock ACTIVE satırda 0 döner), satırda rozet/yuva yok
  await page.goto("/sessions");
  await expect(page.getByTestId("waiting-badge")).toHaveCount(0);
  await expect(page.getByTestId("session-row").filter({ hasText: "Aktif" }).getByTestId("waiting-slot")).toHaveCount(0);
  await tick(page);
  await expect(page.getByTestId("lobby-badge")).toHaveCount(0);
});

test("AC-305: waiting 3 → (3); 0 → rozet kaybolur (yuva kalır); ACTIVE/EXPIRED satırda yuva yok", async ({ page, context }) => {
  await page.clock.install();
  await signIn(context, "lob");
  await page.goto("/");
  const [a] = await ownPending(page);
  await openAt(page, "/sessions");
  await setLobby(page, a!, 3);
  await tick(page);
  await expect(page.getByTestId("waiting-badge").filter({ visible: true })).toHaveText("Müşteri bekliyor (3)");
  await setLobby(page, a!, 0, 3);
  await tick(page);
  await expect(page.getByTestId("waiting-badge")).toHaveCount(0);
  await expect(page.getByTestId("waiting-slot").filter({ visible: false }).first()).toBeAttached();

  const ctx2 = context;
  await signIn(ctx2, "admin");
  await page.goto("/sessions");
  for (const label of ["Aktif", "Süresi doldu"]) {
    await expect(
      page
        .locator('[data-testid="session-row"], [data-testid="session-card"]')
        .filter({ visible: true })
        .filter({ hasText: label })
        .getByTestId("waiting-slot"),
    ).toHaveCount(0);
  }
});

test("AC-306/312: support_requests.view olmayan kullanıcı başka sayfadayken sayaç ≤ 10 sn; 0'da gizli; 360 px'te görünür; Enter /sessions", async ({
  page,
  context,
}) => {
  await page.clock.install();
  await signIn(context, "noreq");
  await page.goto("/");
  const [a] = await ownPending(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await openAt(page, "/");
  await expect(page.getByRole("link", { name: /Talepler/ })).toHaveCount(0);
  await expect(page.getByTestId("lobby-badge")).toHaveCount(0);
  await setLobby(page, a!, 1);
  await tick(page);
  const counter = navSessions(page).getByTestId("lobby-badge");
  await expect(counter).toHaveText(/^1/);
  await expect(counter).toBeInViewport();
  await expect(navSessions(page)).toHaveAccessibleName(/1 müşteri bekleme odasında/);
  await noHorizontalOverflow(page);
  // Sayaç bağlantının içinde: Tab ile odaklanır, Enter listeyi açar
  await navSessions(page).focus();
  await expect(navSessions(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sessions$/);
  await setLobby(page, a!, 0, 1);
  await tick(page);
  await expect(page.getByTestId("lobby-badge")).toHaveCount(0);
});

test("AC-307: tek toast; ikinci yoklamada yeni toast yok (≥ 10 sn kalır); reload → toast yok, sayaç var; iki oturum → '2 müşteri' + liste", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await page.clock.install();
  await signIn(context, "lob");
  await page.goto("/");
  const [a, b] = await ownPending(page);
  await openAt(page, "/");
  await setLobby(page, a!, 1);
  await tick(page);
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page)).toHaveText(/Bekleme odasında müşteri var/);
  await expect(page.getByRole("status", { name: "Bildirimler" })).toBeAttached();
  await tick(page);
  // aynı misafir: yeni toast yok; ilki 10 sn sonra hâlâ ekranda
  await expect(toasts(page)).toHaveCount(1);

  await openAt(page, "/");
  await expect(page.getByTestId("lobby-badge")).toHaveText(/^1/);
  await tick(page);
  await expect(toasts(page)).toHaveCount(0);

  await setLobby(page, a!, 2, 2);
  await setLobby(page, b!, 1);
  await tick(page);
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page)).toContainText("Bekleme odasında 2 müşteri var");
  await expect(toasts(page).getByRole("link", { name: "Oturumlara git" })).toHaveAttribute("href", "/sessions");
  await expect(page.getByTestId("lobby-badge")).toHaveText(/^3/);
});

test("AC-306/307: o oturumun konsolundayken toast yok, menü sayacı var", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await page.clock.install();
  await signIn(context, "lob");
  await page.goto("/");
  const [a] = await ownPending(page);
  await openAt(page, `/sessions/${a}/console`);
  await setLobby(page, a!, 1);
  await tick(page);
  await expect(page.getByTestId("lobby-badge")).toHaveText(/^1/);
  await expect(toasts(page)).toHaveCount(0);
});

test("AC-308: gizli sekmede başlık öneki; görünürde yok; talep + lobi sırası", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await page.clock.install();
  const cookie = await signIn(context, "rqadm");
  await openAt(page, "/requests");
  await expect(page).toHaveTitle(/^\(3\) Talepler · /);
  expect((await page.request.get(`${MOCK}/__e2e/lobby-extra/${cookie}?id=01JXBEXTRA0000000000000001&waiting=1&arrivals=1`)).ok()).toBe(
    true,
  );
  await setHidden(page, true);
  await tick(page);
  await expect(page).toHaveTitle(/^\(1\) Müşteri bekliyor — \(3\) Talepler · /);
  await setHidden(page, false);
  await expect(page).toHaveTitle(/^\(3\) Talepler · /);
});

test("AC-308: yalnız lobi — gizli sekmede önek, görünür olunca kalkar", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await page.clock.install();
  await signIn(context, "lob");
  await page.goto("/");
  const [a] = await ownPending(page);
  await openAt(page, "/sessions");
  await setLobby(page, a!, 2);
  await setHidden(page, true);
  await tick(page);
  await expect(page).toHaveTitle(/^\(2\) Müşteri bekliyor — Oturumlar/);
  expect(await page.title()).not.toContain(GUEST);
  await setHidden(page, false);
  await expect(page).toHaveTitle(/^Oturumlar/);
});

test("AC-309: ADMIN — başkasının satırında bağlantısız rozet; sayaç yalnız kendi", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await page.clock.install();
  await signIn(context, "lobadm");
  const r = await page.request.get("/api/v1/sessions?pageSize=100");
  const items = ((await r.json()) as { items: Item[] }).items;
  const other = items.find((s) => s.technician.id !== OWNER)!;
  const mine = items.find((s) => s.technician.id === OWNER)!;
  await setLobby(page, other.id, 2);
  await setLobby(page, mine.id, 1);
  await openAt(page, "/sessions");
  const otherRow = page.getByTestId("session-row").filter({ hasText: "Zeynep Ak" });
  await expect(otherRow.getByTestId("waiting-badge")).toHaveText("Müşteri bekliyor (2)");
  await expect(otherRow.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Müşteri bekliyor/ })).toHaveCount(1);
  await expect(page.getByTestId("lobby-badge")).toHaveText(/^1/);
});

test("AC-310: firma seçmemiş Super Admin — rozet var, bağlantı yok, sayaç yok, waiting ucu çağrılmaz; firma seçmiş SA sayaç + toast", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  const waitingReqs: string[] = [];
  page.on("request", (q) => q.url().endsWith(WAITING) && waitingReqs.push(q.url()));
  await signIn(context, "sa");
  const items = ((await (await page.request.get("/api/v1/sessions?pageSize=100")).json()) as { items: Item[] }).items;
  await setLobby(page, items.find((s) => s.technician.id === OWNER)!.id, 1);
  await page.goto("/sessions");
  await expect(page.getByTestId("sessions-pick-tenant")).toBeVisible();
  await expect(page.getByTestId("waiting-badge").filter({ visible: true })).toHaveText("Müşteri bekliyor (1)");
  await expect(page.getByRole("link", { name: /Müşteri bekliyor|Konsolu aç/ })).toHaveCount(0);
  await expect(page.getByTestId("lobby-live")).toHaveCount(0);
  await expect(page.getByTestId("lobby-badge")).toHaveCount(0);
  expect(waitingReqs).toEqual([]);

  const ctx = await browser.newContext({ baseURL: info.project.use.baseURL });
  await signIn(ctx, "sat");
  const p = await ctx.newPage();
  await p.clock.install();
  await p.goto("/");
  const [a] = await ownPending(p);
  await openAt(p, "/");
  await setLobby(p, a!, 1);
  await tick(p);
  await expect(p.getByTestId("lobby-badge")).toHaveText(/^1/);
  await expect(p.getByTestId("toast")).toContainText("Bekleme odasında müşteri var");
  await ctx.close();
});

test("AC-312: /sessions 360 + 1280 px, iki tema axe 0 + taşma yok; rozete Tab ile ulaşılır + Enter konsolu açar; aria-live aynı değerde değişmez", async ({
  page,
  context,
}, info) => {
  await page.clock.install();
  await signIn(context, "lob");
  await page.goto("/");
  const [a] = await ownPending(page);
  await openAt(page, "/sessions");
  await setLobby(page, a!, 1);
  await tick(page);
  const live = page.getByTestId("lobby-live");
  await expect(live).toHaveText("1 müşteri bekleme odasında");
  await live.evaluate((el) => {
    (window as unknown as { __m: number }).__m = 0;
    new MutationObserver(() => (window as unknown as { __m: number }).__m++).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  await tick(page);
  expect(await page.evaluate(() => (window as unknown as { __m: number }).__m)).toBe(0);
  await expect(page.getByTestId("toast")).toHaveCount(1);

  // QA P13b-L Tur 1 #1: rozet görünürken /sessions — 360 px (kart görünümü) ve 1280 px (tablo), iki tema: taşma yok + axe 0
  const widths = info.project.name === "desktop" ? [1280, 360] : [360];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    const badge = page.getByTestId("waiting-badge").filter({ visible: true });
    await expect(badge).toHaveText("Müşteri bekliyor (1)");
    // Kararsız test (P16 düzeltme turu 1): genişlik değişince kart görünümündeki rozet yeniden bağlanır ve 200 ms'lik
    // `@starting-style` giriş geçişiyle (opacity 0 → 1) belirir. axe geçiş bitmeden koşarsa yarı saydam metnin kontrastını
    // düşük ölçer. CSS geçişi gerçek saatle ilerler (page.clock etkilemez) → geçişin bitmesi beklenir.
    await expect
      .poll(() => badge.evaluate((el) => el.getAnimations({ subtree: true }).length + Number(getComputedStyle(el).opacity !== "1")))
      .toBe(0);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await axeScan(page), `axe ${scheme} ${width}px ${info.project.name}`).toEqual([]);
      await noHorizontalOverflow(page);
    }
  }
  // Klavye: sayfa başından Tab ile rozete ulaşılır (focus() değil), Enter konsolu açar
  const badge = page.getByRole("link", { name: "Müşteri bekliyor (1) — konsolu aç" }).filter({ visible: true });
  await page.getByRole("heading", { level: 1, name: "Oturumlar" }).click();
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await badge.evaluate((el) => el === document.activeElement);
  }
  expect(reached, "rozet Tab sırasında olmalı").toBe(true);
  await expect(badge).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/sessions/${a}/console$`));
});

test("AC-313: belirme yalnız opacity/transform ≤ 200 ms; sonsuz animasyon yok; reduced-motion'da yalnız opacity", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "lob");
  await page.goto("/");
  const [a] = await ownPending(page);
  await setLobby(page, a!, 1);
  await page.goto("/sessions");
  const read = (sel: string) =>
    page
      .locator(sel)
      .filter({ visible: true })
      .first()
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          prop: cs.transitionProperty,
          dur: cs.transitionDuration,
          ease: cs.transitionTimingFunction,
          iter: cs.animationIterationCount,
          anim: cs.animationName,
        };
      });
  for (const sel of ['[data-testid="lobby-badge"]', '[data-testid="waiting-badge"]']) {
    const s = await read(sel);
    expect(s.prop).toBe("opacity, transform");
    expect(s.dur).toBe("0.2s");
    expect(s.ease).not.toMatch(/linear|ease-in\b/);
    expect(s.anim).toBe("none");
    expect(s.iter).not.toBe("infinite");
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const sel of ['[data-testid="lobby-badge"]', '[data-testid="waiting-badge"]']) expect((await read(sel)).prop).toBe("opacity");
});

test("AC-315: 500 → son değer korunur, toast/console hatası yok", async ({ page, context }) => {
  await page.clock.install();
  await signIn(context, "lobbyfail");
  const [a] = await ownPending(page);
  await setLobby(page, a!, 1);
  await openAt(page, "/");
  await expect(page.getByTestId("lobby-badge")).toHaveText(/^1/);
  await tick(page);
  await tick(page);
  await expect(page.getByTestId("lobby-badge")).toHaveText(/^1/);
  await expect(toasts(page)).toHaveCount(0);
});

test("AC-315: ağ kesilir → son değer; sunucu yeniden başlar (oda yok) → ≤ 10 sn sayaç 0", async ({ page, context }) => {
  await page.clock.install();
  await signIn(context, "lob");
  await page.goto("/");
  const [a] = await ownPending(page);
  await setLobby(page, a!, 1);
  await openAt(page, "/");
  await expect(page.getByTestId("lobby-badge")).toHaveText(/^1/);
  let aborted = 0;
  await page.route(`**${WAITING}`, (r) => {
    aborted++;
    return r.abort();
  });
  await page.clock.runFor(10_000);
  await expect.poll(() => aborted).toBeGreaterThan(0);
  await page.waitForTimeout(150);
  await expect(page.getByTestId("lobby-badge")).toHaveText(/^1/);
  await expect(toasts(page)).toHaveCount(0);
  await page.unroute(`**${WAITING}`);
  await resetLobby(page, a!);
  await tick(page);
  await expect(page.getByTestId("lobby-badge")).toHaveCount(0);
});

test("AC-314/315: 429 → Retry-After (30 sn) beklenir, araya yoklama girmez", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await page.clock.install();
  const cookie = await signIn(context, "lobbyrate");
  await openAt(page, "/");
  await tick(page); // 2. çağrı → 429
  expect(await calls(page, cookie)).toBe(2);
  await page.clock.runFor(10_000);
  await page.waitForTimeout(300);
  expect(await calls(page, cookie)).toBe(2);
  await tick(page, 20_000);
  expect(await calls(page, cookie)).toBe(3);
});
