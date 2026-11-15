// K12 TUR 2 sayfa taraması (tarama.spec.ts kopyası, ayrı çıktı) (test-operatoru, geçici; kod değil). Her ekran: açık/koyu, masaüstü 1440 + mobil 390.
// Toplanan: konsol hata/uyarı, pageerror, 4xx/5xx yanıtlar, axe (wcag2a/aa/21aa), yatay taşma, ekran görüntüsü.
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { axeScan, signIn, sessionCookies } from "/Users/mennan/Projeler/Remote/apps/web/e2e/helpers.ts";

const OUT = new URL("./shots-tur2/", import.meta.url).pathname;
const LOG = new URL("./sonuc-tur2.jsonl", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const D1 = "01JDVP2700000000000000000A";
const D3 = "01JDVP2700000000000000000C";
const ACME = "01JCSP2700000000000000000A";
const BETA = "01JCSP2700000000000000000B";
const TARGET = "01JTDTARGET000000000000001";

type Case = { id: string; scen?: string; path: string; ready?: (p: Page) => Promise<void>; login?: string };
const anyRow = (p: Page) => p.locator('[data-testid="un-row"], [data-testid="un-card"]').filter({ visible: true }).first();
const cases: Case[] = [
  { id: "login-2fa-hatirla", path: "/login/2fa", login: "hatirla@ornek.com", ready: (p) => expect(p.getByTestId("mfa-remember")).toBeVisible() },
  { id: "login-2fa-sa", path: "/login/2fa", login: "sa2fa@ornek.com", ready: (p) => expect(p.getByLabel("6 haneli kod")).toBeVisible() },
  { id: "account-td", scen: "td", path: "/account", ready: (p) => expect(p.getByTestId("td-row").first()).toBeVisible() },
  { id: "account-td-bos", scen: "tdempty", path: "/account", ready: (p) => expect(p.getByTestId("acc-td")).toBeVisible() },
  { id: "account-td-hata", scen: "tdbad", path: "/account", ready: (p) => expect(p.getByTestId("acc-td").getByRole("alert").first()).toBeVisible() },
  { id: "account-sa", scen: "tdsa", path: "/account", ready: (p) => expect(p.getByRole("heading", { level: 1 })).toBeVisible() },
  { id: "settings-security", scen: "td", path: "/settings/security", ready: (p) => expect(p.getByRole("switch").first()).toBeVisible() },
  { id: "user-edit-td", scen: "td", path: `/users/${TARGET}`, ready: (p) => expect(p.getByText("Hatırlanan cihaz", { exact: false }).first()).toBeVisible() },
  { id: "un-list-admin", scen: "unm", path: "/unattended", ready: (p) => expect(anyRow(p)).toBeVisible() },
  { id: "un-list-smtp", scen: "unsmtp", path: "/unattended", ready: (p) => expect(anyRow(p)).toBeVisible() },
  { id: "un-list-off", scen: "unoff", path: "/unattended", ready: (p) => expect(p.getByTestId("un-off-banner")).toBeVisible() },
  { id: "un-list-tech", scen: "untech", path: "/unattended", ready: (p) => expect(anyRow(p)).toBeVisible() },
  { id: "un-list-tech-bos", scen: "untech0", path: "/unattended", ready: (p) => expect(p.getByTestId("un-empty-tech")).toBeVisible() },
  { id: "un-list-bos", scen: "unempty", path: "/unattended", ready: (p) => expect(p.getByTestId("un-empty")).toBeVisible() },
  { id: "un-list-yetkisiz", scen: "unnone", path: "/unattended", ready: (p) => expect(p.getByTestId("un-forbidden")).toBeVisible() },
  { id: "un-codes", scen: "unm", path: "/unattended/codes", ready: (p) => expect(p.getByTestId("un-code-row").first()).toBeVisible() },
  { id: "un-codes-bos", scen: "unempty", path: "/unattended/codes", ready: (p) => expect(p.getByTestId("un-codes-empty")).toBeVisible() },
  { id: "un-codes-smtp", scen: "unsmtp", path: "/unattended/codes", ready: (p) => expect(p.getByTestId("un-create-code-reason")).toBeVisible() },
  { id: "un-codes-tech", scen: "untech", path: "/unattended/codes", ready: (p) => p.waitForLoadState("networkidle") },
  { id: "un-detail-d1", scen: "unm", path: `/unattended/${D1}`, ready: (p) => expect(p.getByRole("heading", { level: 1, name: "MUHASEBE-PC" })).toBeVisible() },
  { id: "un-detail-d3", scen: "unm", path: `/unattended/${D3}`, ready: (p) => expect(p.getByRole("heading", { level: 1, name: "YENI-PC" })).toBeVisible() },
  { id: "un-detail-tech-d1", scen: "untech", path: `/unattended/${D1}`, ready: (p) => expect(p.getByRole("heading", { level: 1, name: "MUHASEBE-PC" })).toBeVisible() },
  { id: "un-detail-tech-d3-404", scen: "untech", path: `/unattended/${D3}`, ready: (p) => p.waitForLoadState("networkidle") },
  { id: "un-detail-yok-404", scen: "unm", path: `/unattended/01JDVP27000000000000000ZZZ`, ready: (p) => p.waitForLoadState("networkidle") },
  { id: "un-detail-bozuk-id", scen: "unm", path: `/unattended/abc`, ready: (p) => p.waitForLoadState("networkidle") },
  { id: "customer-acme", scen: "unm", path: `/customers/${ACME}`, ready: (p) => expect(p.getByTestId("un-contacts")).toBeVisible() },
  { id: "customer-beta", scen: "unm", path: `/customers/${BETA}`, ready: (p) => expect(p.getByTestId("un-contacts-empty")).toBeVisible() },
  { id: "customer-beta-tech", scen: "untech", path: `/customers/${BETA}`, ready: (p) => p.waitForLoadState("networkidle") },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctxOpts = (u: any) => ({ baseURL: "http://localhost:3217", viewport: u.viewport, isMobile: u.isMobile, hasTouch: u.hasTouch, deviceScaleFactor: u.deviceScaleFactor, userAgent: u.userAgent, locale: "tr-TR" });
const EXPECTED_NET = /status of (400|401|403|404|409)/;

for (const c of cases) {
  for (const scheme of ["light", "dark"] as const) {
    test(`${c.id} ${scheme}`, async ({ browser }, info) => {
      const ctx: BrowserContext = await browser.newContext({ ...ctxOpts(info.project.use), colorScheme: scheme, reducedMotion: "reduce" });
      const p = await ctx.newPage();
      const consoleMsgs: string[] = [];
      const bad: string[] = [];
      p.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") consoleMsgs.push(`${m.type()}: ${m.text()}`);
      });
      p.on("pageerror", (e) => consoleMsgs.push(`pageerror: ${e.message}`));
      p.on("response", (r) => {
        if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
      });
      let mainStatus: number | null = null;
      if (c.login) {
        await p.goto("/login");
        await p.getByLabel("E-posta veya kullanıcı adı").fill(c.login);
        await p.getByLabel("Şifre", { exact: true }).fill("DogruSifre123!");
        await p.getByRole("button", { name: "Giriş yap" }).click();
        await expect(p).toHaveURL(/\/login\/2fa$/);
      } else {
        if (c.scen) await signIn(ctx, c.scen);
        const r = await p.goto(c.path);
        mainStatus = r?.status() ?? null;
      }
      let readyErr: string | null = null;
      try {
        await c.ready?.(p);
      } catch (e) {
        readyErr = String(e).slice(0, 300);
      }
      await p.waitForTimeout(300);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const wide = await p.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll("body *")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== "fixed";
          })
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
      });
      const axe = await axeScan(p);
      const title = await p.title();
      const h1 = await p.locator("h1").first().textContent({ timeout: 1000 }).catch(() => null);
      const file = `${c.id}-${info.project.name}-${scheme}.png`;
      await p.screenshot({ path: OUT + file, fullPage: true });
      appendFileSync(
        LOG,
        JSON.stringify({
          id: c.id,
          proj: info.project.name,
          scheme,
          path: c.path,
          url: p.url(),
          mainStatus,
          title,
          h1,
          readyErr,
          overflow,
          wide,
          axe,
          console: consoleMsgs.filter((m) => !EXPECTED_NET.test(m)),
          expectedNetConsole: consoleMsgs.filter((m) => EXPECTED_NET.test(m)).length,
          bad,
          file,
        }) + "\n",
      );
      await ctx.close();
    });
  }
}

// Konsol "Gözetimsiz" rozeti: /ws/tech hello'suna unattended eklenir (sahte WS sunucusu bu alanı üretmez).
for (const scheme of ["light", "dark"] as const) {
  test(`console-unattended ${scheme}`, async ({ browser }, info) => {
    const ctx = await browser.newContext({ ...ctxOpts(info.project.use), colorScheme: scheme, reducedMotion: "reduce" });
    await signIn(ctx, "p7");
    const p = await ctx.newPage();
    const msgs: string[] = [];
    p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && msgs.push(m.text()));
    p.on("pageerror", (e) => msgs.push(`pageerror: ${e.message}`));
    await p.routeWebSocket(/\/ws\/tech/, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((m) => {
        try {
          const o = JSON.parse(String(m));
          if (o.t === "hello") o.unattended = { deviceId: D1, deviceName: "MUHASEBE-PC" };
          ws.send(JSON.stringify(o));
        } catch {
          ws.send(m);
        }
      });
      ws.onMessage((m) => server.send(m));
    });
    await p.goto("/sessions");
    const r = await p.request.post("/api/v1/sessions", {
      headers: { "x-csrf-token": "csrf-test-token", Origin: "http://localhost:3217" },
      data: {},
    });
    const { id } = await r.json();
    await p.goto(`/sessions/${id}/console`);
    let readyErr: string | null = null;
    try {
      await expect(p.getByTestId("console-unattended")).toBeVisible({ timeout: 8000 });
      await expect(p.getByTestId("console-guest")).toHaveText("MUHASEBE-PC");
    } catch (e) {
      readyErr = String(e).slice(0, 300);
    }
    const status = await p.getByTestId("console-status").textContent().catch(() => null);
    const axe = await axeScan(p, "header");
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const file = `console-unattended-${info.project.name}-${scheme}.png`;
    await p.screenshot({ path: OUT + file });
    appendFileSync(LOG, JSON.stringify({ id: "console-unattended", proj: info.project.name, scheme, readyErr, status, axe, overflow, console: msgs, file }) + "\n");
    await ctx.close();
  });
}
void sessionCookies;
