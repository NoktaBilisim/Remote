// P28b K9 sayfa taraması (test-operatoru, geçici; kod değil). Koşu: apps/web/e2e/ altına geçici kopyala →
// `pnpm --filter @remote/web exec playwright test zz-k9-p28b` → kopyayı sil. Sahte API senaryoları e2e/mock-p28b.mjs.
// Her ekran: açık/koyu × desktop/mobile; HTTP, konsol hata/uyarı, pageerror, 4xx/5xx, axe, yatay taşma, iç linkler, ekran.
// "-hata" varyantı: ilgili ayar/geçmiş API'si 500'e zorlanır → hata durumu görünmeli.
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { axeScan, signIn } from "./helpers";

const DIR = "/Users/mennan/Projeler/Remote/docs/test-raporu/e2e/p28b-k9/";
const OUT = `${DIR}shots/`;
mkdirSync(OUT, { recursive: true });
type Case = { id: string; scen: string; path: string; fail?: RegExp };
const HIST = "/history/01JHXST0000000000000000000";
const cases: Case[] = [
  { id: "dosyalar", scen: "fad", path: "/settings/files" },
  { id: "dosyalar-clamavyok", scen: "fadno", path: "/settings/files" },
  // SSR: route ile 500 zorlanamıyor, atlandı — { id: "dosyalar-hata", scen: "fad", path: "/settings/files", fail: /\/api\/v1\/(tenant|settings)/ },
  { id: "clamav", scen: "fsa", path: "/admin/settings/clamav" },
  // SSR: route ile 500 zorlanamıyor, atlandı — { id: "clamav-hata", scen: "fsa", path: "/admin/settings/clamav", fail: /clamav/ },
  { id: "gecmis-dosyalar", scen: "hfs", path: HIST },
  // SSR: route ile 500 zorlanamıyor, atlandı — { id: "gecmis-dosyalar-hata", scen: "hfs", path: HIST, fail: /stored-files/ },
];

for (const c of cases)
  for (const scheme of ["light", "dark"] as const)
    test(`${c.id} ${scheme}`, async ({ browser }, info) => {
      const u = info.project.use;
      const ctx = await browser.newContext({
        baseURL: "http://localhost:3217", viewport: u.viewport, isMobile: u.isMobile, hasTouch: u.hasTouch,
        deviceScaleFactor: u.deviceScaleFactor, userAgent: u.userAgent, locale: "tr-TR", colorScheme: scheme, reducedMotion: "reduce",
      });
      await ctx.addCookies([{ name: "rs_theme", value: scheme, domain: "localhost", path: "/" }]);
      await signIn(ctx, c.scen);
      const p = await ctx.newPage();
      const failed: string[] = [];
      if (c.fail) {
        const re = c.fail;
        await p.route("**/api/v1/**", (r) => {
          const path = new URL(r.request().url()).pathname;
          if (r.request().method() === "GET" && re.test(path) && !/auth\/me/.test(path)) {
            failed.push(path);
            return r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL","message":"x"}}' });
          }
          return r.continue();
        });
      }
      const msgs: string[] = [];
      const bad: string[] = [];
      p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") msgs.push(`${m.type()}: ${m.text()}`); });
      p.on("pageerror", (e) => msgs.push(`pageerror: ${e.message}`));
      p.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
      const t0 = Date.now();
      const r = await p.goto(c.path);
      await p.waitForLoadState("networkidle").catch(() => {});
      await p.waitForTimeout(500);
      const ms = Date.now() - t0;
      const h1 = await p.locator("h1").allInnerTexts();
      const alerts = await p.locator('[role="alert"]').allInnerTexts();
      const axe = await axeScan(p);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const dark = await p.evaluate(() => document.documentElement.classList.contains("dark"));
      await p.screenshot({ path: `${OUT}${c.id}-${info.project.name}-${scheme}.png`, fullPage: true });
      const broken: string[] = [];
      if (info.project.name === "desktop" && scheme === "light" && !c.fail) {
        const hrefs = await p.$$eval("a[href]", (as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href).filter((h) => h.startsWith(location.origin)))]);
        for (const h of hrefs) {
          const rr = await p.request.get(h, { maxRedirects: 0 }).catch(() => null);
          if (!rr || rr.status() >= 400) broken.push(`${rr?.status() ?? "ERR"} ${new URL(h).pathname}`);
        }
      }
      const row = { id: c.id, scheme, proj: info.project.name, status: r?.status(), url: p.url(), h1, alerts, ms, axe, overflow, dark, failed, console: msgs, bad, broken };
      appendFileSync(`${DIR}tarama.jsonl`, JSON.stringify(row) + "\n");
      expect(r?.status()).toBe(200);
      expect(msgs.filter((m) => !/status of (4\d\d|500)/.test(m))).toEqual([]);
      expect(axe).toEqual([]);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(broken).toEqual([]);
      if (c.fail) expect(failed.length, "API 500'e zorlandı").toBeGreaterThan(0);
      await ctx.close();
    });
