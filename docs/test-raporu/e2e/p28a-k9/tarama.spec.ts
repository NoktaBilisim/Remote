// P28a K9 genel sayfa taraması (test-operatoru, geçici; kod değil). Sahte API senaryoları (e2e/mock-*.mjs).
// Her ekran: açık/koyu × desktop 1440 / mobile 390. Toplanan: HTTP durumu, konsol hata/uyarı, pageerror, 4xx/5xx yanıtlar,
// axe (wcag2a/aa/21aa), yatay taşma, sayfadaki iç linklerin durumu (yalnız desktop açık), ekran görüntüsü. Sonuç: ./tarama.jsonl
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type BrowserContext } from "@playwright/test";
import { axeScan, signIn } from "/Users/mennan/Projeler/Remote/apps/web/e2e/helpers.ts";

const OUT = new URL("./shots/", import.meta.url).pathname;
const LOG = new URL("./tarama.jsonl", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

type Case = { id: string; scen?: string; path: string; expect?: number };
const cases: Case[] = [
  { id: "login", path: "/login" },
  { id: "forgot", path: "/forgot-password" },
  { id: "pano", scen: "seed", path: "/" },
  { id: "sessions", scen: "seed", path: "/sessions" },
  { id: "sessions-bos", scen: "plain", path: "/sessions" },
  { id: "sessions-hata", scen: "broken", path: "/sessions" },
  { id: "requests", scen: "rqadm", path: "/requests" },
  { id: "customers", scen: "rqcu", path: "/customers" },
  { id: "customers-bos", scen: "rqcuempty", path: "/customers" },
  { id: "history", scen: "hadm", path: "/history" },
  { id: "users", scen: "usadm", path: "/users" },
  { id: "users-bos", scen: "usempty", path: "/users" },
  { id: "user-edit", scen: "usadm", path: "/users/01JKS00000000000000000000B" },
  { id: "audit", scen: "auadm", path: "/audit" },
  { id: "audit-bos", scen: "auempty", path: "/audit" },
  { id: "account", scen: "acc", path: "/account" },
  { id: "settings-general", scen: "acc", path: "/settings/general" },
  { id: "settings-security", scen: "acc", path: "/settings/security" },
  { id: "settings-smtp", scen: "acc", path: "/settings/smtp" },
  { id: "settings-support", scen: "rqadm", path: "/settings/support-requests" },
  { id: "admin-tenants", scen: "p16sa", path: "/admin/tenants" },
  { id: "admin-superadmins", scen: "p15sa1", path: "/admin/settings/superadmins" },
  { id: "unattended", scen: "unm", path: "/unattended" },
  { id: "unattended-codes", scen: "unm", path: "/unattended/codes" },
  { id: "yok-404", scen: "seed", path: "/yok-boyle-sayfa", expect: 404 },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctxOpts = (u: any) => ({
  baseURL: "http://localhost:3217",
  viewport: u.viewport,
  isMobile: u.isMobile,
  hasTouch: u.hasTouch,
  deviceScaleFactor: u.deviceScaleFactor,
  userAgent: u.userAgent,
  locale: "tr-TR",
});

for (const c of cases) {
  for (const scheme of ["light", "dark"] as const) {
    test(`${c.id} ${scheme}`, async ({ browser }, info) => {
      const ctx: BrowserContext = await browser.newContext({ ...ctxOpts(info.project.use), colorScheme: scheme, reducedMotion: "reduce" });
      await ctx.addCookies([{ name: "rs_theme", value: scheme, domain: "localhost", path: "/" }]);
      if (c.scen) await signIn(ctx, c.scen);
      const p = await ctx.newPage();
      const msgs: string[] = [];
      const bad: string[] = [];
      p.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") msgs.push(`${m.type()}: ${m.text()}`);
      });
      p.on("pageerror", (e) => msgs.push(`pageerror: ${e.message}`));
      p.on("response", (r) => {
        if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
      });
      const t0 = Date.now();
      const r = await p.goto(c.path);
      await p.waitForLoadState("networkidle").catch(() => {});
      await p.waitForTimeout(400);
      const ms = Date.now() - t0;
      const h1 = await p.locator("h1").allInnerTexts();
      const axe = await axeScan(p);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const name = `t-${c.id}-${info.project.name}-${scheme}`;
      await p.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
      let broken: string[] = [];
      if (info.project.name === "desktop" && scheme === "light") {
        const hrefs = await p.$$eval("a[href]", (as) =>
          [...new Set(as.map((a) => (a as HTMLAnchorElement).href).filter((h) => h.startsWith(location.origin)))],
        );
        for (const h of hrefs) {
          const rr = await p.request.get(h, { maxRedirects: 0 }).catch(() => null);
          if (!rr || rr.status() >= 400) broken.push(`${rr?.status() ?? "ERR"} ${new URL(h).pathname}${new URL(h).search}`);
        }
      }
      const row = { id: c.id, scheme, proj: info.project.name, path: c.path, status: r?.status(), url: p.url(), h1, ms, axe, overflow, console: msgs, bad, broken };
      appendFileSync(LOG, JSON.stringify(row) + "\n");
      expect(r?.status()).toBe(c.expect ?? 200);
      expect(msgs.filter((m) => !/status of 4\d\d|status of 500/.test(m))).toEqual([]);
      expect(axe).toEqual([]);
      expect(overflow).toBeLessThanOrEqual(0);
      await ctx.close();
    });
  }
}
