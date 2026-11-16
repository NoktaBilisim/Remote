// P28e K10 sayfa taraması + keşif turu (test-operatoru, geçici; kod değil). Koşu: apps/web/e2e/ altına geçici kopyala →
// `./node_modules/.bin/playwright test zz-k10-p28e --project=desktop` → kopyayı sil.
// Sahte API: e2e/mock-p28e.mjs (u-p28e*), sahte WS e2e/mock-ws.mjs + mock-sessions (u-p28ec*: rıza → rec.state).
// Tarama: her görünüm açık/koyu × 1440/375; HTTP, konsol hata/uyarı, pageerror, 4xx/5xx, axe, yatay taşma, iç linkler, ikon, ekran.
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { axeScan, newSession, signIn } from "./helpers";

const DIR = "/Users/mennan/Projeler/Remote/docs/test-raporu/e2e/p28e-k10/";
const OUT = "/private/tmp/claude-501/-Users-mennan-Projeler-Remote/fa15848a-dcdd-4f1b-abf9-1c72703d5eac/scratchpad/k10/img/";
mkdirSync(OUT, { recursive: true });
const MOCK = "http://127.0.0.1:4217";
const REC = "01JSSP28E0000000000000000A";
const SIL = "01JSSP28E0000000000000000B";
const DEL = "01JSSP28E0000000000000000C";
const RID_REC = "01JRDP28E0000000000000000A";
const ERR500 = { status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL","message":"x"}}' };
const log = (o: unknown) => appendFileSync(`${DIR}tarama.jsonl`, JSON.stringify(o) + "\n");

type Ctx = { p: Page; browser: Browser; ctx: BrowserContext; w: number; scheme: "light" | "dark" };
/** act bir sayfa dönerse ekran/axe o sayfada alınır (ör. misafir). */
type Case = { id: string; scen: string; path: string; act?: (c: Ctx) => Promise<Page | void>; guest?: boolean };

async function recordWebm(page: Page) {
  return page.evaluate(async () => {
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
    for (let s = 0; s < 2; s++) {
      const blobs: Blob[] = [];
      const r = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      r.ondataavailable = (e) => e.data.size && blobs.push(e.data);
      const stopped = new Promise((res) => (r.onstop = res));
      r.start(1000);
      await new Promise((res) => setTimeout(res, 2100));
      r.stop();
      await stopped;
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
  });
}
let seeded = false;
async function seed(p: Page) {
  if (seeded) return;
  const cur = p.url();
  await p.goto("/login");
  const parts = await recordWebm(p);
  expect((await p.request.post(`${MOCK}/__e2e/rec-seed/${RID_REC}`, { data: { parts } })).ok()).toBe(true);
  seeded = true;
  await p.goto(cur);
}

async function joinGuest(c: Ctx, link: string, consent: boolean) {
  const gctx = await c.browser.newContext({
    baseURL: "http://localhost:3217",
    viewport: { width: c.w, height: 812 },
    locale: "tr-TR",
    colorScheme: c.scheme,
    reducedMotion: "reduce",
  });
  await gctx.addCookies([{ name: "rs_theme", value: c.scheme, domain: "localhost", path: "/" }]);
  const g = await gctx.newPage();
  await g.goto(new URL(link).pathname);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  if (consent === null) return { g, code: "" };
  await g.getByTestId("guest-name").fill("Ayşe Yılmaz");
  await g.getByTestId("guest-consent").check();
  if (consent) await g.getByTestId("rec-consent").check();
  await g.getByTestId("join-browser").click();
  await expect(g.getByTestId("guest-lobby")).toBeVisible();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
  return { g, code };
}
async function live(c: Ctx) {
  const s = await newSession(c.p);
  await c.p.goto(`/sessions/${s.id}/console`);
  const { g, code } = await joinGuest(c, s.link, true);
  await c.p.getByTestId("admit-input").fill(code);
  await c.p.getByTestId("admit-submit").click();
  await expect(c.p.getByTestId("console-status")).toHaveText("Aktif");
  await g.getByTestId("share-start").click();
  await expect(c.p.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  return { s, g };
}
async function openPlayer(c: Ctx, ready = true) {
  await seed(c.p);
  await c.p.getByTestId("rec-watch").click();
  if (ready) await expect(c.p.getByTestId("rec-player")).toHaveAttribute("data-status", "ready", { timeout: 15_000 });
}

const cases: Case[] = [
  { id: "ayar-kapali", scen: "p28eadm", path: "/settings/recording" },
  { id: "ayar-acik-tekyonetici", scen: "p28esole", path: "/settings/recording" },
  {
    id: "ayar-onay-hatasi",
    scen: "p28eadm",
    path: "/settings/recording",
    act: async ({ p }) => {
      await expect(p.getByTestId("rec-settings-form")).toHaveAttribute("data-ready", "true");
      await p.getByRole("switch", { name: "Oturum kaydı" }).click();
      await p.getByRole("button", { name: "Kaydet" }).click();
      await expect(p.getByTestId("rset-consent-error")).toBeVisible();
    },
  },
  {
    id: "ayar-gozetimsiz-stepup",
    scen: "p28esole",
    path: "/settings/recording",
    act: async ({ p }) => {
      await expect(p.getByTestId("rec-settings-form")).toHaveAttribute("data-ready", "true");
      await p.getByRole("switch", { name: "Gözetimsiz bağlantıları da kaydet" }).click();
      await p.getByTestId("rset-notice").check();
      await p.getByRole("button", { name: "Kaydet" }).click();
      await expect(p.getByTestId("step-up-dialog")).toBeVisible();
    },
  },
  { id: "ayar-salt-okunur", scen: "p28ero", path: "/settings/recording" },
  {
    id: "ayar-yukleniyor",
    scen: "p28eadm",
    path: "about:blank",
    act: async ({ p }) => {
      await p.route(/\/api\/v1\/settings\/recording$/, async (r) => {
        await new Promise((x) => setTimeout(x, 4000));
        await r.continue().catch(() => {});
      });
      await p.goto("/settings/recording");
      await p.waitForTimeout(700);
    },
  },
  {
    id: "ayar-hata",
    scen: "p28eadm",
    path: "about:blank",
    act: async ({ p }) => {
      await p.route(/\/api\/v1\/settings\/recording$/, (r) => r.fulfill(ERR500));
      await p.goto("/settings/recording");
      await p.waitForTimeout(800);
    },
  },
  { id: "gecmis-liste", scen: "p28eadm", path: "/history" },
  { id: "gecmis-kayitli", scen: "p28eadm", path: "/history?recorded=true" },
  {
    id: "gecmis-kayitli-bos",
    scen: "p28eadm",
    path: "about:blank",
    act: async ({ p }) => {
      await p.route(/\/api\/v1\/sessions\?/, (r) =>
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], page: 1, pageSize: 25, total: 0 }) }),
      );
      await p.goto("/history?recorded=true");
      await p.waitForTimeout(800);
    },
  },
  {
    id: "gecmis-hata",
    scen: "p28eadm",
    path: "about:blank",
    act: async ({ p }) => {
      await p.route(/\/api\/v1\/sessions\?/, (r) => r.fulfill(ERR500));
      await p.goto("/history?recorded=true");
      await p.waitForTimeout(800);
    },
  },
  { id: "detay-riza", scen: "p28eadm", path: `/history/${REC}` },
  { id: "detay-gozetimsiz", scen: "p28eadm", path: `/history/${SIL}` },
  { id: "detay-silinmis", scen: "p28eadm", path: `/history/${DEL}` },
  { id: "detay-yetkisiz", scen: "p28ero", path: `/history/${REC}` },
  {
    id: "detay-sil-onay",
    scen: "p28eadm",
    path: `/history/${REC}`,
    act: async ({ p }) => {
      await p.getByTestId("rec-delete").click();
      await expect(p.getByTestId("rec-delete-dialog")).toBeVisible();
    },
  },
  {
    id: "detay-meta-yukleniyor",
    scen: "p28eadm",
    path: "about:blank",
    act: async ({ p }) => {
      await p.route(/\/sessions\/[0-9A-Z]{26}\/recording$/, async (r) => {
        await new Promise((x) => setTimeout(x, 4000));
        await r.continue().catch(() => {});
      });
      await p.goto(`/history/${REC}`);
      await expect(p.getByTestId("rec-loading")).toBeVisible();
    },
  },
  {
    id: "detay-meta-hata",
    scen: "p28eadm",
    path: "about:blank",
    act: async ({ p }) => {
      await p.route(/\/sessions\/[0-9A-Z]{26}\/recording$/, (r) => (r.request().method() === "GET" ? r.fulfill(ERR500) : r.continue()));
      await p.goto(`/history/${REC}`);
      await p.waitForTimeout(800);
    },
  },
  {
    id: "oynatici-hazir",
    scen: "p28eadm",
    path: `/history/${REC}`,
    act: async (c) => openPlayer(c),
  },
  {
    id: "oynatici-yukleniyor",
    scen: "p28ebusy",
    path: `/history/${REC}`,
    act: async (c) => {
      await openPlayer(c, false);
      await expect(c.p.getByTestId("rec-player-note")).toBeVisible();
    },
  },
  {
    id: "oynatici-suresi-doldu",
    scen: "p28eadm",
    path: `/history/${REC}`,
    act: async (c) => {
      await seed(c.p);
      await c.p.route(/\/api\/v1\/rec\/.*\/parts\//, (r) =>
        r.fulfill({ status: 401, contentType: "application/json", body: '{"error":{"code":"UNAUTHENTICATED","message":"x"}}' }),
      );
      await openPlayer(c, false);
      await expect(c.p.getByTestId("rec-player-expired")).toBeVisible();
    },
  },
  {
    id: "oynatici-hata",
    scen: "p28eadm",
    path: `/history/${REC}`,
    act: async (c) => {
      await seed(c.p);
      await c.p.route(/\/api\/v1\/rec\/.*\/parts\//, (r) =>
        r.fulfill({ status: 200, contentType: "video/webm", body: Buffer.from("bozuk-icerik-bozuk-icerik") }),
      );
      await openPlayer(c, false);
      await expect(c.p.getByTestId("rec-player")).toHaveAttribute("data-status", "error", { timeout: 10_000 });
    },
  },
  {
    id: "musteri-onay-kutusu",
    scen: "p28ec",
    path: "about:blank",
    guest: true,
    act: async (c) => {
      const s = await newSession(c.p);
      const gctx = await c.browser.newContext({
        baseURL: "http://localhost:3217",
        viewport: { width: c.w, height: 812 },
        locale: "tr-TR",
        colorScheme: c.scheme,
        reducedMotion: "reduce",
      });
      await gctx.addCookies([{ name: "rs_theme", value: c.scheme, domain: "localhost", path: "/" }]);
      const g = await gctx.newPage();
      await g.goto(new URL(s.link).pathname);
      await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
      await expect(g.getByTestId("rec-consent-box")).toBeVisible();
      return g;
    },
  },
  {
    id: "musteri-mobil-cihaz",
    scen: "p28ec",
    path: "about:blank",
    guest: true,
    act: async (c) => {
      const s = await newSession(c.p);
      const gctx = await c.browser.newContext({
        baseURL: "http://localhost:3217",
        viewport: { width: c.w, height: 812 },
        isMobile: c.w < 500,
        hasTouch: c.w < 500,
        userAgent:
          c.w < 500
            ? "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
            : undefined,
        locale: "tr-TR",
        colorScheme: c.scheme,
        reducedMotion: "reduce",
      });
      const g = await gctx.newPage();
      await g.goto(new URL(s.link).pathname);
      await g.waitForLoadState("networkidle");
      return g;
    },
  },
  {
    id: "musteri-kayit-suruyor",
    scen: "p28ec",
    path: "about:blank",
    guest: true,
    act: async (c) => {
      const { g } = await live(c);
      await expect(g.getByTestId("rec-guest-on")).toBeVisible();
      return g;
    },
  },
  {
    id: "musteri-kayit-durdu",
    scen: "p28ec",
    path: "about:blank",
    guest: true,
    act: async (c) => {
      const { g } = await live(c);
      await g.getByTestId("rec-guest-stop").click();
      await expect(g.getByTestId("rec-guest-off")).toBeVisible();
      return g;
    },
  },
  {
    id: "musteri-paylasim-duraklatildi",
    scen: "p28ecnoack",
    path: "about:blank",
    guest: true,
    act: async (c) => {
      const { g } = await live(c);
      await g.getByTestId("rec-guest-stop").click();
      await expect(g.getByTestId("rec-guest-paused")).toBeVisible({ timeout: 5000 });
      return g;
    },
  },
  {
    id: "konsol-kayit-suruyor",
    scen: "p28ec",
    path: "about:blank",
    act: async (c) => {
      await live(c);
      await expect(c.p.getByTestId("rec-console-on")).toBeVisible();
    },
  },
  {
    id: "konsol-kota-doldu",
    scen: "p28ec",
    path: "about:blank",
    act: async (c) => {
      const { s } = await live(c);
      await c.p.waitForResponse((r) => r.request().method() === "PUT" && /\/api\/v1\/rec\//.test(r.url()), { timeout: 20_000 });
      await c.p.request.get(`${MOCK}/__e2e/rec/${s.id}?off=quota`);
      await expect(c.p.getByTestId("rec-console-stopped")).toBeVisible();
    },
  },
  {
    id: "konsol-riza-geri-alindi",
    scen: "p28ec",
    path: "about:blank",
    act: async (c) => {
      const { g } = await live(c);
      await g.getByTestId("rec-guest-stop").click();
      await expect(c.p.getByTestId("rec-console-stopped")).toBeVisible();
    },
  },
];

const VIEWS = [
  { w: 1440, h: 900, mobile: false },
  { w: 375, h: 812, mobile: true },
];

async function scanPage(p: Page) {
  const h1 = await p.locator("h1").allInnerTexts();
  const axe = await axeScan(p);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const wideEls = await p.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position !== "fixed";
      })
      .slice(0, 5)
      .map((e) => `${e.tagName.toLowerCase()}${e.getAttribute("data-testid") ? "#" + e.getAttribute("data-testid") : ""}`),
  );
  const dark = await p.evaluate(() => {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255];
    return (m[0]! + m[1]! + m[2]!) / 3 < 128;
  });
  // nav / sekme / breadcrumb linklerinde lucide ikonu (svg) var mı
  const navNoIcon = await p.evaluate(() =>
    [...document.querySelectorAll('nav a[href], [role="tablist"] a[href]')]
      .filter((a) => (a as HTMLElement).offsetParent !== null && !a.querySelector("svg") && (a.textContent ?? "").trim())
      .map((a) => `${(a.textContent ?? "").trim().slice(0, 30)} → ${a.getAttribute("href")}`)
      .slice(0, 10),
  );
  const buttonsNoName = await p.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((b) => (b as HTMLElement).offsetParent !== null && !(b.textContent ?? "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("aria-labelledby"))
      .length,
  );
  return { h1, axe, overflow, wideEls, dark, navNoIcon, buttonsNoName };
}

test.describe("TARAMA", () => {
  test.describe.configure({ mode: "default" }); // oynatıcı parçaları RID başına global → tek işçi, sıralı
  for (const c of cases)
    for (const v of VIEWS)
      for (const scheme of ["light", "dark"] as const)
        test(`${c.id} ${v.w} ${scheme}`, async ({ browser }, info) => {
          test.skip(info.project.name !== "desktop", "tarama tek projede; 375 px ayrı bağlamla");
          test.setTimeout(90_000);
          const ctx = await browser.newContext({
            baseURL: "http://localhost:3217",
            viewport: { width: v.w, height: v.h },
            isMobile: v.mobile && !c.guest,
            hasTouch: v.mobile && !c.guest,
            locale: "tr-TR",
            colorScheme: scheme,
            reducedMotion: "reduce",
          });
          await ctx.addCookies([{ name: "rs_theme", value: scheme, domain: "localhost", path: "/" }]);
          await signIn(ctx, c.scen);
          const p = await ctx.newPage();
          const msgs: string[] = [];
          const bad: string[] = [];
          const watch = (pg: Page, tag: string) => {
            pg.on("console", (m) => {
              if (m.type() === "error" || m.type() === "warning") msgs.push(`${tag}${m.type()}: ${m.text()}`);
            });
            pg.on("pageerror", (e) => msgs.push(`${tag}pageerror: ${e.message}`));
            pg.on("response", (r) => {
              if (r.status() >= 400) bad.push(`${tag}${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
            });
          };
          watch(p, "");
          ctx.on("page", (pg) => pg !== p && watch(pg, "[2] "));
          browser.contexts(); // misafir bağlamları ayrı; aşağıda act dönüşüyle izlenir
          const t0 = Date.now();
          let status: number | undefined = 200;
          if (c.path !== "about:blank") {
            const r = await p.goto(c.path);
            status = r?.status();
            await p.waitForLoadState("networkidle").catch(() => {});
          }
          let target: Page = p;
          let actErr = "";
          if (c.act) {
            const r = await c.act({ p, browser, ctx, w: v.w, scheme }).catch((e: Error) => ((actErr = e.message.split("\n")[0] ?? ""), undefined));
            if (r) {
              target = r;
              watch(r, "[misafir] ");
            }
          }
          await target.waitForTimeout(400);
          const ms = Date.now() - t0;
          const s = await scanPage(target);
          await target.screenshot({ path: `${OUT}${c.id}-${v.w}-${scheme}.png`, fullPage: true });
          if (target !== p) await p.screenshot({ path: `${OUT}${c.id}-${v.w}-${scheme}-teknisyen.png`, fullPage: true }).catch(() => {});
          const footer = c.guest ? await target.locator("footer, [data-testid='guest-footer']").allInnerTexts().catch(() => []) : undefined;
          const broken: string[] = [];
          if (v.w === 1440 && scheme === "light" && c.path !== "about:blank") {
            const hrefs = await p.$$eval("a[href]", (as) => [
              ...new Set(as.map((a) => (a as HTMLAnchorElement).href).filter((h) => h.startsWith(location.origin))),
            ]);
            for (const h of hrefs) {
              const rr = await p.request.get(h, { maxRedirects: 0 }).catch(() => null);
              if (!rr || rr.status() >= 400) broken.push(`${rr?.status() ?? "ERR"} ${new URL(h).pathname}`);
            }
          }
          const title = await target.title();
          log({ id: c.id, w: v.w, scheme, status, url: new URL(target.url()).pathname + new URL(target.url()).search, title, ms, ...s, footer, console: msgs, bad, broken, actErr });
          for (const x of browser.contexts()) if (x !== ctx) await x.close().catch(() => {});
          expect.soft(actErr).toBe("");
          expect.soft(status).toBe(200);
          expect.soft(msgs.filter((m) => !/status of (4\d\d|500)/.test(m))).toEqual([]);
          expect.soft(s.axe).toEqual([]);
          expect.soft(s.overflow).toBeLessThanOrEqual(0);
          expect.soft(broken).toEqual([]);
          expect.soft(s.dark).toBe(scheme === "dark");
          await ctx.close();
        });
});

// ---------------- Keşif turu (yalnız masaüstü) ----------------
const ex = (name: string, fn: (a: { page: Page; context: BrowserContext; browser: Browser }) => Promise<void>) =>
  test(`KEŞİF ${name}`, async ({ page, context, browser }, info) => {
    test.skip(info.project.name !== "desktop", "keşif tek projede");
    test.setTimeout(60_000);
    await fn({ page, context, browser });
  });
const note = (id: string, o: Record<string, unknown>) => log({ ex: id, ...o });

ex("E1 oturumsuz erişim → giriş", async ({ page }) => {
  const out: Record<string, string> = {};
  for (const u of ["/settings/recording", `/history/${REC}`, "/history?recorded=true"]) {
    await page.goto(u);
    out[u] = new URL(page.url()).pathname + new URL(page.url()).search;
    expect.soft(out[u], u).toMatch(/^\/login/);
  }
  note("E1", out);
});

ex("E2 saklama süresi geçersiz girdiler", async ({ page, context }) => {
  await signIn(context, "p28esole");
  await page.goto("/settings/recording");
  await expect(page.getByTestId("rec-settings-form")).toHaveAttribute("data-ready", "true");
  const f = page.getByTestId("rset-days");
  const res: Record<string, unknown> = {};
  let puts = 0;
  page.on("request", (r) => r.method() === "PUT" && r.url().endsWith("/settings/recording") && puts++);
  for (const val of ["", "0", "-5", "91", "2.5", "1e2", "<script>alert(1)</script>", "' OR 1=1 --"]) {
    await f.fill("").catch(() => {});
    await f.fill(val).catch(() => {});
    const shown = await f.inputValue();
    const before = puts;
    await page.getByRole("button", { name: "Kaydet" }).click().catch(() => {});
    await page.waitForTimeout(500);
    const errs = await page.locator('[role="alert"], [id$="-error"], [data-testid$="-error"]').allInnerTexts();
    const toast = await page.locator("[data-sonner-toast], [data-testid='toast']").allInnerTexts().catch(() => []);
    res[val || "(boş)"] = { shown, putSent: puts > before, errs: errs.filter(Boolean).slice(0, 3), toast };
  }
  note("E2", res);
});

ex("E3 ayar PUT 500 ve ağ kopması", async ({ page, context }) => {
  await signIn(context, "p28esole");
  await page.goto("/settings/recording");
  await expect(page.getByTestId("rec-settings-form")).toHaveAttribute("data-ready", "true");
  let mode: "500" | "abort" = "500";
  await page.route(/\/settings\/recording$/, (r) => (r.request().method() === "PUT" ? (mode === "500" ? r.fulfill(ERR500) : r.abort()) : r.continue()));
  await page.getByTestId("rset-days").fill("20");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForTimeout(800);
  const a500 = await page.locator('[role="alert"], [data-sonner-toast]').allInnerTexts();
  await page.screenshot({ path: `${OUT}kesif-ayar-500.png`, fullPage: true });
  mode = "abort";
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForTimeout(800);
  const aAbort = await page.locator('[role="alert"], [data-sonner-toast]').allInnerTexts();
  await page.screenshot({ path: `${OUT}kesif-ayar-agkopuk.png`, fullPage: true });
  note("E3", { a500, aAbort, days: await page.getByTestId("rset-days").inputValue() });
  expect.soft(a500.join(" ").length).toBeGreaterThan(0);
});

ex("E4 çift tıklama: Kaydı izle → tek POST /view; sil onayı → tek DELETE", async ({ page, context }) => {
  await signIn(context, "p28eadm");
  await page.goto(`/history/${REC}`);
  let views = 0;
  let dels = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/recording/view")) views++;
    if (r.method() === "DELETE" && r.url().endsWith("/recording")) dels++;
  });
  await page.getByTestId("rec-watch").dblclick();
  await page.waitForTimeout(800);
  const v1 = views;
  await page.getByTestId("rec-close").click().catch(() => {});
  await page.getByTestId("rec-delete").click();
  await page.getByTestId("rec-delete-confirm").dblclick();
  await page.waitForTimeout(800);
  note("E4", { viewPosts: v1, deletes: dels, deletedText: await page.getByTestId("rec-deleted").innerText().catch(() => "") });
  expect.soft(v1).toBe(1);
  expect.soft(dels).toBe(1);
});

ex("E5 POST /view 401 → giriş; 500 → hata", async ({ page, context }) => {
  await signIn(context, "p28eadm");
  await page.goto(`/history/${REC}`);
  let st = 500;
  await page.route(/\/recording\/view$/, (r) =>
    r.fulfill({ status: st, contentType: "application/json", body: JSON.stringify({ error: { code: st === 401 ? "UNAUTHENTICATED" : "INTERNAL", message: "x" } }) }),
  );
  await page.getByTestId("rec-watch").click();
  await page.waitForTimeout(700);
  const e500 = await page.locator('[role="alert"]').allInnerTexts();
  await page.screenshot({ path: `${OUT}kesif-izle-500.png`, fullPage: true });
  st = 401;
  await page.getByTestId("rec-watch").click();
  await page.waitForTimeout(1500);
  note("E5", { e500, urlAfter401: new URL(page.url()).pathname + new URL(page.url()).search, alerts401: await page.locator('[role="alert"]').allInnerTexts() });
  expect.soft(new URL(page.url()).pathname).toBe("/login");
});

ex("E6 meta 404/403 (canView varken) → açıklama var mı", async ({ page, context }) => {
  await signIn(context, "p28eadm");
  await page.route(/\/sessions\/[0-9A-Z]{26}\/recording$/, (r) =>
    r.request().method() === "GET" ? r.fulfill({ status: 404, contentType: "application/json", body: '{"error":{"code":"NOT_FOUND","message":"x"}}' }) : r.continue(),
  );
  await page.goto(`/history/${REC}`);
  await page.waitForTimeout(800);
  const sec = await page.getByTestId("rec-section").innerText().catch(() => "(yok)");
  await page.screenshot({ path: `${OUT}kesif-meta-404.png`, fullPage: true });
  note("E6", { section: sec, watch: await page.getByTestId("rec-watch").count(), del: await page.getByTestId("rec-delete").count() });
});

ex("E7 süzgeç Kayıtlı: yenileme + geri tuşu", async ({ page, context }) => {
  await signIn(context, "p28eadm");
  await page.goto("/history");
  await page.getByTestId("history-recorded").getByRole("button", { name: "Kayıtlı" }).click();
  await page.getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/recorded=true/);
  await page.reload();
  const pressed = async () =>
    page.getByTestId("history-recorded").getByRole("button", { name: "Kayıtlı" }).getAttribute("aria-pressed").catch(() => null);
  const afterReload = { pressed: await pressed(), checked: await page.getByTestId("history-recorded").getByRole("button", { name: "Kayıtlı" }).getAttribute("aria-checked").catch(() => null) };
  await page.goBack();
  await page.waitForLoadState("networkidle");
  const afterBack = { url: page.url(), pressed: await pressed() };
  const r = await page.goto("/history?recorded=xyz");
  const invalid = { status: r?.status(), rows: await page.locator('[data-testid="history-row"], [data-testid="history-card"]').filter({ visible: true }).count(), alerts: await page.locator('[role="alert"]').allInnerTexts() };
  const r2 = await page.goto("/history/01JSSZZZZZZZZZZZZZZZZZZZZZ");
  const other = { status: r2?.status(), h1: await page.locator("h1").allInnerTexts(), text: (await page.locator("main").innerText().catch(() => "")).slice(0, 200) };
  await page.screenshot({ path: `${OUT}kesif-baska-kayit.png`, fullPage: true });
  note("E7", { afterReload, afterBack, invalid, other });
});

ex("E8 klavye: sil diyaloğu Esc → kapanır, odak Kaydı sil; oynatıcıda Boşluk", async ({ page, context }) => {
  await signIn(context, "p28eadm");
  await page.goto(`/history/${REC}`);
  await page.getByTestId("rec-delete").click();
  await expect(page.getByTestId("rec-delete-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const dlg = await page.getByTestId("rec-delete-dialog").isVisible();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.textContent);
  // Tab sırası: Kaydı izle düğmesine klavyeyle ulaşılıyor mu
  note("E8", { dialogVisibleAfterEsc: dlg, focused });
  expect.soft(dlg).toBe(false);
  expect.soft(focused).toBe("rec-delete");
});

ex("E9 sayfa başlıkları ve ayar sekmesi ikonu", async ({ page, context }) => {
  await signIn(context, "p28eadm");
  await page.goto("/settings/recording");
  const tab = page.locator('a[href="/settings/recording"]').first();
  const tabIcon = await tab.locator("svg").count();
  const current = await tab.getAttribute("aria-current");
  const title = await page.title();
  await page.goto(`/history/${REC}`);
  const t2 = await page.title();
  const icons = await page.evaluate(() =>
    ["rec-watch", "rec-delete"].map((id) => [id, !!document.querySelector(`[data-testid="${id}"] svg`)]),
  );
  const listIcon = await (async () => {
    await page.goto("/history");
    return page.getByTestId("history-rec").filter({ visible: true }).first().evaluate((e) => ({ svg: !!e.querySelector("svg"), label: e.getAttribute("aria-label") }));
  })();
  note("E9", { tabIcon, current, title, t2, icons, listIcon });
});
