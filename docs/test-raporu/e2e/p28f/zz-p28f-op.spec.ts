// P28f test-operatoru turu (macOS karşılama + rehber + indirme os=macos + OS_PERMISSION + audit "İşletim sistemi (beyan)").
// Geçici keşif betiği — ürün kodu değil. Koşu: bu dosya apps/web/e2e/, p28f-op.config.ts apps/web/ altına geçici kopyalanır →
// `./node_modules/.bin/playwright test -c p28f-op.config.ts` → kopyalar silinir. Ön koşullar config başlığında.
// Ölçüm: konsol hata/uyarı, pageerror, HTTP ≥ 400, axe (WCAG 2.1 AA), yatay taşma, kırık link, ekran görüntüsü.
// Sonuçlar tarama.jsonl; bulgular expect.soft (bir sapma diğer adımları durdurmaz).
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { agentSend, startFakeAgent, agentLog } from "./fake-agent";
import { axeScan, newSession, signIn } from "./helpers";

const DIR = "/Users/mennan/Projeler/Remote/docs/test-raporu/e2e/p28f/";
const IMG = "/Users/mennan/Projeler/Remote/docs/img/p28f/";
mkdirSync(IMG, { recursive: true });
const log = (o: unknown) => appendFileSync(`${DIR}tarama.jsonl`, JSON.stringify(o) + "\n");
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const AVAIL = "**/api/v1/public/agent/availability";
const tok = (ch: string) => `/session/${ch.repeat(43)}`;

type Issues = string[];
function watch(p: Page, arr: Issues) {
  p.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") arr.push(`${m.type()}: ${m.text()}`);
  });
  p.on("pageerror", (e) => arr.push(`pageerror: ${e.message}`));
  p.on("response", (r) => {
    if (r.status() >= 400) arr.push(`http ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  p.on("requestfailed", (r) => arr.push(`requestfailed ${new URL(r.url()).pathname} ${r.failure()?.errorText}`));
}
const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

type Scen = { name: string; token: string; ua?: string; setup?: (p: Page) => Promise<void>; act?: (p: Page) => Promise<void>; ready: (p: Page) => Promise<void> };
const fulfil = (body: unknown, status = 200) => async (p: Page) => {
  await p.route(AVAIL, (r) => r.fulfill({ status, json: body }));
};
const SCEN: Scen[] = [
  { name: "prod", token: "A", ready: (p) => expect(p.getByTestId("mac-guide")).toBeVisible() },
  { name: "testbuild", token: "A", setup: fulfil({ windows: true, macos: true, macosTestBuild: true }), ready: (p) => expect(p.getByTestId("mac-test-build")).toBeVisible() },
  { name: "macos-false", token: "A", setup: fulfil({ windows: true, macos: false }), ready: (p) => expect(p.getByTestId("join-browser")).toBeVisible() },
  { name: "avail-500", token: "A", setup: fulfil({ error: { code: "INTERNAL", message: "x", requestId: "r" } }, 500), ready: (p) => expect(p.getByTestId("join-browser")).toBeVisible() },
  {
    name: "avail-abort",
    token: "A",
    setup: (p) => p.route(AVAIL, (r) => r.abort("failed")),
    ready: (p) => expect(p.getByTestId("join-browser")).toBeVisible(),
  },
  {
    name: "loading",
    token: "A",
    setup: (p) => p.route(AVAIL, () => new Promise(() => undefined)),
    ready: (p) => expect(p.getByTestId("agent-download-loading")).toBeVisible(),
  },
  {
    name: "not-ready-503",
    token: "D",
    act: async (p) => {
      await p.getByTestId("agent-download").click();
    },
    ready: (p) => expect(p.getByTestId("agent-not-ready")).toBeVisible(),
  },
  {
    name: "indirildi",
    token: "A",
    act: async (p) => {
      const d = p.waitForEvent("download");
      await p.getByTestId("agent-download").click();
      await d;
    },
    ready: (p) => expect(p.getByTestId("agent-started")).toBeVisible(),
  },
  { name: "windows-regresyon", token: "A", ua: WIN, ready: (p) => expect(p.getByTestId("agent-download")).toBeVisible() },
];

for (const s of SCEN)
  for (const w of [1280, 375])
    for (const theme of ["light", "dark"] as const) {
      test(`karşılama ${s.name} ${w} ${theme}`, async ({ browser }) => {
        const ctx = await browser.newContext({ userAgent: s.ua ?? MAC, viewport: { width: w, height: w === 375 ? 812 : 900 }, colorScheme: theme, acceptDownloads: true });
        const p = await ctx.newPage();
        const iss: Issues = [];
        watch(p, iss);
        if (s.setup) await s.setup(p);
        await p.goto(tok(s.token));
        await expect(p.locator("h1")).toBeVisible();
        if (s.act) await s.act(p);
        await s.ready(p);
        await p.waitForTimeout(300);
        const axe = await axeScan(p);
        const ov = await overflow(p);
        const os = (await p.getByTestId("agent-download").count()) ? await p.getByTestId("agent-download").getAttribute("data-os") : null;
        const href = (await p.getByTestId("agent-download").count()) ? await p.getByTestId("agent-download").getAttribute("href") : null;
        const guide = (await p.getByTestId("mac-guide").count()) ? (await p.getByTestId("mac-guide").innerText()).replace(/\s+/g, " ").slice(0, 900) : null;
        const build = (await p.getByTestId("mac-guide").count()) ? await p.getByTestId("mac-guide").getAttribute("data-build") : null;
        const primary = (await p.getByTestId("join-browser").count()) ? (await p.getByTestId("join-browser").innerText()).trim() : null;
        await p.screenshot({ path: `${IMG}karsilama-${s.name}-${w}-${theme}.png`, fullPage: true });
        log({ t: "karsilama", s: s.name, w, theme, axe, overflow: ov, os, href, build, primary, guide: theme === "light" && w === 1280 ? guide : undefined, issues: [...new Set(iss)] });
        expect.soft(axe, "axe").toEqual([]);
        expect.soft(ov, "taşma").toBeLessThanOrEqual(0);
        await ctx.close();
      });
    }

test("kırık link + indirme yönlendirmesi + klavye erişimi (prod, Mac)", async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: MAC, viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(tok("A"));
  await expect(p.getByTestId("mac-guide")).toBeVisible();
  const links = await p.$$eval("a[href]", (as) => as.map((a) => ({ href: (a as HTMLAnchorElement).href, text: a.textContent?.trim().slice(0, 60), target: a.getAttribute("target"), rel: a.getAttribute("rel") })));
  const res: unknown[] = [];
  for (const l of links) {
    const u = new URL(l.href);
    if (u.origin !== "http://localhost:3217") {
      res.push({ ...l, status: "harici (istek atılmadı)" });
      continue;
    }
    const r = await p.request.get(l.href, { maxRedirects: 0 });
    res.push({ ...l, status: r.status(), location: r.headers()["location"] ?? null, disposition: r.headers()["content-disposition"] ?? null });
  }
  // Ön ek olmadan os=windows/os=linux/os boş — sahte API sözleşmesi
  const bad = [];
  for (const q of ["os=linux", "os=", "os=MACOS", "os=macos&os=windows"]) {
    const r = await p.request.get(`/api/v1/public/agent/download?ref=${"A".repeat(43)}&${q}`, { maxRedirects: 0 });
    bad.push({ q, status: r.status() });
  }
  // Klavye: Tab ile indirme düğmesine ulaşılır mı, odak görünür mü
  let reached = -1;
  for (let i = 0; i < 25; i++) {
    await p.keyboard.press("Tab");
    if (await p.getByTestId("agent-download").evaluate((e) => e === document.activeElement)) {
      reached = i + 1;
      break;
    }
  }
  const ring = reached > 0 ? await p.getByTestId("agent-download").evaluate((e) => getComputedStyle(e).outlineStyle + "|" + getComputedStyle(e).boxShadow.slice(0, 60)) : null;
  if (reached > 0) await p.screenshot({ path: `${IMG}karsilama-prod-1280-light-odak.png` });
  log({ t: "linkler", links: res, bad, tabToDownload: reached, ring });
  expect.soft(reached).toBeGreaterThan(0);
  await ctx.close();
});

async function liveAgent(page: Page, browser: Browser) {
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  const a = await startFakeAgent(browser, id);
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect.poll(() => page.getByTestId("console-video").evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 15_000 }).toBeGreaterThan(0);
  return { a, id };
}

for (const [w, theme] of [
  [1280, "light"],
  [1280, "dark"],
  [375, "light"],
  [375, "dark"],
] as const) {
  test(`konsol OS_PERMISSION ${w} ${theme}`, async ({ page, context, browser }) => {
    const iss: Issues = [];
    watch(page, iss);
    await page.setViewportSize({ width: w, height: w === 375 ? 812 : 900 });
    await page.emulateMedia({ colorScheme: theme });
    await signIn(context, "p7");
    const { a } = await liveAgent(page, browser);
    await page.getByTestId("control-request").click();
    await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(1);
    await agentSend(a, { t: "control.state", state: "VIEW", source: "OS_PERMISSION" });
    const note = page.getByTestId("control-note");
    await expect(note).toContainText("Müşteri erişilebilirlik izni vermedi");
    await page.waitForTimeout(400);
    const noteText = (await note.innerText()).trim();
    const clipped = await note.evaluate((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    const toasts = await page.getByText("Müşteri izni verdikten sonra yeniden isteyin.").count();
    const rejected = await page.getByText("Kontrol reddedildi").count();
    const enabled = await page.getByTestId("control-request").isEnabled();
    const axe = await axeScan(page);
    const ov = await overflow(page);
    await page.screenshot({ path: `${IMG}konsol-os-permission-${w}-${theme}.png`, fullPage: false });
    log({ t: "konsol", w, theme, noteText, clipped, toasts, rejected, requestEnabled: enabled, axe, overflow: ov, issues: [...new Set(iss)] });
    expect.soft(axe).toEqual([]);
    expect.soft(rejected).toBe(0);
    expect.soft(enabled).toBe(true);
    await a.context().close();
  });
}

for (const [w, theme] of [
  [1280, "light"],
  [1280, "dark"],
  [375, "light"],
  [375, "dark"],
] as const) {
  test(`audit detay işletim sistemi ${w} ${theme}`, async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: "http://localhost:3218", viewport: { width: w, height: w === 375 ? 812 : 900 }, colorScheme: theme });
    await signIn(ctx, "auadm");
    const p = await ctx.newPage();
    const iss: Issues = [];
    watch(p, iss);
    await p.goto("/audit");
    const rows = p.locator('[data-testid="audit-row"], [data-testid="audit-card"]').filter({ visible: true });
    await expect(rows.first()).toBeVisible();
    const out: Record<string, unknown> = {};
    // ilk 4 satır vekilin eklediği: macos, windows, "<b>x</b>" (gösterilmemeli), browser; ayrıca os'suz eski satır 1055d
    for (const [i, id] of [
      [0, "9001"],
      [1, "9002"],
      [2, "9003"],
      [3, "9004"],
    ] as const) {
      await (w === 375 ? rows.nth(i).locator("button, a").first() : rows.nth(i).getByTestId("audit-detail-open")).click();
      const dlg = p.getByTestId("audit-detail");
      await expect(dlg).toHaveJSProperty("open", true);
      await expect(dlg).toContainText(id);
      const osCount = await dlg.getByTestId("audit-client-os").count();
      out[id] = osCount ? { label: await dlg.getByText("İşletim sistemi (beyan)").count(), value: await dlg.getByTestId("audit-client-os").innerText() } : null;
      if (id === "9001") {
        out.axe = await axeScan(p, '[data-testid="audit-detail"]');
        out.overflow = await overflow(p);
        await p.screenshot({ path: `${IMG}audit-os-macos-${w}-${theme}.png` });
      }
      await p.keyboard.press("Escape");
      await expect(dlg).toHaveJSProperty("open", false);
    }
    log({ t: "audit", w, theme, out, issues: [...new Set(iss)] });
    expect.soft(out["9001"]).toEqual({ label: 1, value: "macOS" });
    expect.soft(out["9002"]).toEqual({ label: 1, value: "Windows" });
    expect.soft(out["9003"]).toBeNull();
    expect.soft(out["9004"]).toEqual({ label: 1, value: "Tarayıcı" });
    expect.soft(out.axe).toEqual([]);
    await ctx.close();
  });
}
