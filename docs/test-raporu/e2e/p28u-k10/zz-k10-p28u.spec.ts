// P28u K10 sayfa taraması + keşif turu (test-operatoru, geçici; kod değil). Koşu: apps/web/e2e/ altına geçici kopyala →
// `pnpm --filter @remote/web exec playwright test zz-k10-p28u --project=desktop` → kopyayı sil.
// Sahte API: e2e/mock-p28u.mjs (u-p28u*), mock-history (u-hun-*), mock-audit (u-auun-*), konsol p7 sahte WS + sahte ajan.
// Tarama: her görünüm açık/koyu × 1440/375; HTTP, konsol hata/uyarı, pageerror, 4xx/5xx, axe, yatay taşma, iç linkler, ekran.
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { agentLog, agentSend, startFakeAgent } from "./fake-agent";
import { axeScan, newSession, signIn } from "./helpers";

const DIR = "/Users/mennan/Projeler/Remote/docs/test-raporu/e2e/p28u-k10/";
const OUT = "/Users/mennan/Projeler/Remote/docs/img/p28u/";
mkdirSync(OUT, { recursive: true });
const D1 = "01JDVP28V0000000000000000A";
const D2 = "01JDVP28V0000000000000000B";
const REASON = "Gece bakım penceresinde sunucu güncellemesi";
const log = (o: unknown) => appendFileSync(`${DIR}tarama.jsonl`, JSON.stringify(o) + "\n");
const row = (p: Page, n: string) => p.locator('[data-testid="un-row"], [data-testid="un-card"]').filter({ visible: true }).filter({ hasText: n });

type Ctx = { p: Page; browser: Browser };
type Case = { id: string; scen: string; path: string | ((p: Page) => Promise<string>); act?: (c: Ctx) => Promise<unknown>; wide?: boolean };

async function openConnect(p: Page, n = "AKTIF-PC") {
  await row(p, n).getByRole("button", { name: `Bağlan: ${n}` }).click();
  await expect(p.getByTestId("un-connect-dialog")).toBeVisible();
}
async function hookWs(p: Page, unattended: Record<string, unknown>) {
  await p.routeWebSocket(/\/ws\/tech/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const o = JSON.parse(String(m)) as Record<string, unknown>;
      if (o.t === "hello") o.unattended = unattended;
      ws.send(JSON.stringify(o));
    });
    ws.onMessage((m) => server.send(m));
  });
  await p.route(/\/unattended\/(lock|logoff)$/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(r.request().url().endsWith("logoff") ? { ok: true, rejoin: true } : { ok: true }) }),
  );
}
async function consoleTo(c: Ctx, un: Record<string, unknown>, granted: boolean) {
  await hookWs(c.p, un);
  const { id } = await newSession(c.p);
  await c.p.goto(`/sessions/${id}/console`);
  await expect(c.p.getByTestId("un-mode-badge")).toBeVisible();
  const a = await startFakeAgent(c.browser, id);
  await expect(c.p.getByTestId("console-status")).toHaveText("Aktif");
  if (granted) {
    if (un.consentMode === "silent") {
      await c.p.getByTestId("un-intervene").click();
      await c.p.getByTestId("un-intervene-dialog-confirm").click();
    } else await c.p.getByTestId("control-request").click();
    await expect.poll(async () => (await agentLog(a)).asked).toBe(true);
    await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
    await expect(c.p.getByTestId("un-actions")).toBeVisible();
  }
  return a;
}
const SILENT = { deviceId: D1, deviceName: "AKTIF-PC", consentMode: "silent", intervene: true };

const cases: Case[] = [
  { id: "liste", scen: "p28ufull", path: "/unattended", wide: true },
  { id: "cihaz-detay", scen: "p28ufull", path: `/unattended/${D1}` },
  { id: "cihaz-detay-eski", scen: "p28ufull", path: `/unattended/${D2}` },
  { id: "baglan-sor", scen: "p28unopol", path: "/unattended", act: ({ p }) => openConnect(p) },
  {
    id: "baglan-izinsiz",
    scen: "p28ufull",
    path: "/unattended",
    act: async ({ p }) => {
      await openConnect(p);
      await p.getByTestId("un-silent").check();
      await p.getByTestId("un-silent-reason").fill("kısa");
      await p.getByTestId("un-connect-submit").click();
      await expect(p.getByTestId("un-silent-reason-error")).toBeVisible();
    },
  },
  {
    id: "baglan-stepup",
    scen: "p28ufull",
    path: "/unattended",
    act: async ({ p }) => {
      await openConnect(p);
      await p.getByTestId("un-silent").check();
      await p.getByTestId("un-silent-reason").fill(REASON);
      await p.getByTestId("un-connect-submit").click();
      await expect(p.getByTestId("step-up-dialog")).toBeVisible();
    },
  },
  { id: "politika-acik", scen: "p28ufull", path: "/settings/unattended" },
  {
    id: "politika-acma",
    scen: "p28unopol",
    path: "/settings/unattended",
    act: async ({ p }) => {
      await expect(p.getByTestId("un-policy-form")).toHaveAttribute("data-ready", "true");
      await p.getByTestId("un-policy-switch").click();
      await p.getByTestId("save-bar-save").click();
      await expect(p.getByTestId("un-policy-ack-error")).toBeVisible();
    },
  },
  { id: "politika-salt-okunur", scen: "p28uro", path: "/settings/unattended" },
  { id: "gecmis", scen: "hun", path: "/history", wide: true },
  { id: "gecmis-izinsiz", scen: "hun", path: "/history?consentMode=silent" },
  { id: "gecmis-detay", scen: "hun", path: "/history/01JHXST0000000000000000000", wide: true },
  { id: "audit-izinli", scen: "auun", path: "/audit?consentMode=asked", wide: true },
  {
    id: "konsol-izleme",
    scen: "p7",
    path: async () => "",
    act: async (c) => {
      const a = await consoleTo(c, SILENT, false);
      await expect(c.p.getByTestId("un-monitoring")).toBeVisible();
      return a;
    },
  },
  {
    id: "konsol-mudahale-onay",
    scen: "p7",
    path: async () => "",
    act: async (c) => {
      const a = await consoleTo(c, SILENT, false);
      await c.p.getByTestId("un-intervene").click();
      await expect(c.p.getByTestId("un-intervene-dialog")).toBeVisible();
      return a;
    },
  },
  {
    id: "konsol-kontrol",
    scen: "p7",
    path: async () => "",
    act: async (c) => consoleTo(c, SILENT, true),
  },
  {
    id: "konsol-logoff-onay",
    scen: "p7",
    path: async () => "",
    act: async (c) => {
      const a = await consoleTo(c, SILENT, true);
      await c.p.getByTestId("un-logoff").click();
      await expect(c.p.getByTestId("un-logoff-dialog")).toBeVisible();
      return a;
    },
  },
  {
    id: "konsol-eski-servis",
    scen: "p7",
    path: async () => "",
    act: async (c) => consoleTo(c, { deviceId: D1, deviceName: "ESKI-PC", consentMode: "asked", intervene: false }, true),
  },
];

const VIEWS = [
  { w: 1440, h: 900, mobile: false },
  { w: 375, h: 812, mobile: true },
];

for (const c of cases)
  for (const v of VIEWS)
    for (const scheme of ["light", "dark"] as const)
      test(`${c.id} ${v.w} ${scheme}`, async ({ browser }, info) => {
        test.skip(info.project.name !== "desktop", "tarama tek projede; 375 px ayrı bağlamla");
        const ctx = await browser.newContext({
          baseURL: "http://localhost:3217",
          viewport: { width: v.w, height: v.h },
          isMobile: v.mobile,
          hasTouch: v.mobile,
          locale: "tr-TR",
          colorScheme: scheme,
          reducedMotion: "reduce",
        });
        await ctx.addCookies([{ name: "rs_theme", value: scheme, domain: "localhost", path: "/" }]);
        await signIn(ctx, c.scen);
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
        let status: number | undefined = 200;
        if (typeof c.path === "string") {
          const r = await p.goto(c.path);
          status = r?.status();
          await p.waitForLoadState("networkidle").catch(() => {});
        }
        let agent: unknown;
        let actErr = "";
        if (c.act) agent = await c.act({ p, browser }).catch((e: Error) => ((actErr = e.message.split("\n")[0] ?? ""), null));
        await p.waitForTimeout(400);
        const ms = Date.now() - t0;
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
        const dark = await p.evaluate(() => { const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255]; return (m[0]! + m[1]! + m[2]!) / 3 < 128; });
        await p.screenshot({ path: `${OUT}${c.id}-${v.w}-${scheme}.png`, fullPage: true });
        const broken: string[] = [];
        if (v.w === 1440 && scheme === "light" && typeof c.path === "string") {
          const hrefs = await p.$$eval("a[href]", (as) => [
            ...new Set(as.map((a) => (a as HTMLAnchorElement).href).filter((h) => h.startsWith(location.origin))),
          ]);
          for (const h of hrefs) {
            const rr = await p.request.get(h, { maxRedirects: 0 }).catch(() => null);
            if (!rr || rr.status() >= 400) broken.push(`${rr?.status() ?? "ERR"} ${new URL(h).pathname}`);
          }
        }
        log({ id: c.id, w: v.w, scheme, status, url: new URL(p.url()).pathname + new URL(p.url()).search, h1, ms, axe, overflow, wideEls, dark, console: msgs, bad, broken, actErr });
        if (agent) await (agent as Page).close().catch(() => {});
        expect.soft(actErr).toBe("");
        expect.soft(status).toBe(200);
        expect.soft(msgs.filter((m) => !/status of (4\d\d)/.test(m))).toEqual([]);
        expect.soft(axe).toEqual([]);
        expect.soft(overflow).toBeLessThanOrEqual(0);
        expect.soft(broken).toEqual([]);
        expect.soft(dark).toBe(scheme === "dark");
        await ctx.close();
      });

// ---------------- Keşif turu (yalnız masaüstü) ----------------
const ex = (name: string, fn: Parameters<typeof test>[2]) =>
  test(`KEŞİF ${name}`, async ({ page, context, browser }, info) => {
    test.skip(info.project.name !== "desktop", "keşif tek projede");
    await (fn as (a: unknown, i: typeof info) => Promise<void>)({ page, context, browser }, info);
  });
const note = (id: string, o: Record<string, unknown>) => log({ ex: id, ...o });

ex("E1 çift tıklama Bağlan (izinsiz) → tek POST", async ({ page, context }) => {
  await signIn(context, "p28ufull");
  await page.goto("/unattended");
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith(`/devices/${D1}/connect`)) posts++;
  });
  await openConnect(page);
  await page.getByTestId("un-silent").check();
  await page.getByTestId("un-silent-reason").fill(REASON);
  await page.getByTestId("un-connect-submit").dblclick();
  await expect(page.getByTestId("step-up-dialog")).toBeVisible();
  await page.waitForTimeout(500);
  note("E1", { postsBeforeStepUp: posts });
  expect.soft(posts).toBe(1);
  await page.getByTestId("step-up-code").fill("123456");
  await page.getByTestId("step-up-submit").dblclick();
  await expect(page).toHaveURL(/\/console$/);
  note("E1b", { postsTotal: posts });
  expect.soft(posts).toBe(2);
  // geri tuşu: liste, diyalog kapalı
  await page.goBack();
  await expect(page).toHaveURL(/\/unattended$/);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}keşif-geri-tusu-liste.png`, fullPage: true });
  note("E1c", { dialogVisible: await page.getByTestId("un-connect-dialog").isVisible(), dialogText: await page.getByTestId("un-connect-dialog").innerText().catch(() => ""), silentChecked: await page.getByTestId("un-silent").isChecked().catch(() => null), dialogAfterBack: await page.getByTestId("un-connect-dialog").count(), url: page.url() });
  expect.soft(await page.getByTestId("un-connect-dialog").count()).toBe(0);
});

ex("E2 gerekçe <script> / SQL / 501 karakter / yalnız boşluk", async ({ page, context }) => {
  await signIn(context, "p28ufull");
  let dialogs = 0;
  page.on("dialog", (d) => {
    dialogs++;
    void d.dismiss();
  });
  await page.goto("/unattended");
  await openConnect(page);
  await page.getByTestId("un-silent").check();
  const f = page.getByTestId("un-silent-reason");
  await f.fill(" ".repeat(25));
  await page.getByTestId("un-connect-submit").click();
  const spaces = await page.getByTestId("un-silent-reason-error").innerText().catch(() => "(hata yok)");
  await f.fill("x".repeat(501));
  const v501 = (await f.inputValue()).length;
  const cnt501 = await page.getByTestId("un-silent-count").innerText();
  await page.getByTestId("un-connect-submit").click();
  const err501 = await page.getByTestId("un-silent-reason-error").innerText().catch(() => "(hata yok)");
  const xss = `<script>alert(1)</script> ' OR 1=1 -- gerekçe`;
  await f.fill(xss);
  const sent = page.waitForRequest((r) => r.url().endsWith(`/devices/${D1}/connect`) && r.method() === "POST");
  await page.getByTestId("un-connect-submit").click();
  const body = (await sent).postDataJSON();
  note("E2", { spaces, v501, cnt501, err501, body, dialogs });
  expect.soft(spaces).not.toBe("(hata yok)");
  expect.soft(body).toEqual({ silent: true, reason: xss });
  expect.soft(dialogs).toBe(0);
});

ex("E3 connect POST 500 ve ağ kopması → diyalogda hata", async ({ page, context }) => {
  await signIn(context, "p28unopol");
  await page.goto("/unattended");
  let mode: "500" | "abort" = "500";
  await page.route(/\/devices\/[0-9A-Z]{26}\/connect$/, (r) =>
    mode === "500" ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL","message":"x"}}' }) : r.abort(),
  );
  await openConnect(page);
  await page.getByTestId("un-connect-submit").click();
  await page.waitForTimeout(800);
  const t500 = await page.getByTestId("un-connect-dialog").innerText();
  await page.screenshot({ path: `${OUT}keşif-baglan-500.png` });
  mode = "abort";
  await page.getByTestId("un-connect-submit").click();
  await page.waitForTimeout(800);
  const tAbort = await page.getByTestId("un-connect-dialog").innerText();
  await page.screenshot({ path: `${OUT}keşif-baglan-agkopuk.png` });
  const alerts = await page.locator('[role="alert"]').allInnerTexts();
  note("E3", { t500, tAbort, alerts, url: page.url(), submitEnabled: await page.getByTestId("un-connect-submit").isEnabled() });
  await expect.soft(page.getByTestId("un-connect-submit")).toBeEnabled();
});

ex("E4 liste yoklaması 500 → 'güncellenemedi' + son veri", async ({ page, context }) => {
  await signIn(context, "p28ufull");
  await page.goto("/unattended");
  await expect(row(page, "AKTIF-PC")).toBeVisible();
  await page.route(/\/api\/v1\/unattended\/devices(\?|$)/, (r) =>
    r.request().method() === "GET" ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL","message":"x"}}' }) : r.continue(),
  );
  await page.waitForTimeout(9500);
  const alerts = await page.locator('[role="alert"], [role="status"]').allInnerTexts();
  await page.screenshot({ path: `${OUT}keşif-liste-yoklama-500.png`, fullPage: true });
  note("E4", { alerts, rowsStill: await row(page, "AKTIF-PC").count() });
  expect.soft(await row(page, "AKTIF-PC").count()).toBe(1);
});

ex("E5 politika PUT 500 → hata, anahtar geri", async ({ page, context }) => {
  await signIn(context, "p28ufull");
  await page.goto("/settings/unattended");
  await expect(page.getByTestId("un-policy-form")).toHaveAttribute("data-ready", "true");
  await page.route(/\/unattended\/policy$/, (r) =>
    r.request().method() === "PUT" ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL","message":"x"}}' }) : r.continue(),
  );
  await page.getByTestId("un-policy-switch").click();
  await page.getByTestId("save-bar-save").click();
  await page.waitForTimeout(800);
  const alerts = await page.locator('[role="alert"], [data-sonner-toast]').allInnerTexts();
  await page.screenshot({ path: `${OUT}keşif-politika-500.png`, fullPage: true });
  note("E5", { alerts, switch: await page.getByTestId("un-policy-switch").getAttribute("aria-checked") });
  expect.soft(alerts.join(" ").length).toBeGreaterThan(0);
});

ex("E6 oturumsuz erişim → giriş", async ({ page }) => {
  const out: Record<string, string> = {};
  for (const u of ["/unattended", `/unattended/${D1}`, "/settings/unattended", "/history?consentMode=silent", "/audit?consentMode=silent"]) {
    await page.goto(u);
    out[u] = new URL(page.url()).pathname + new URL(page.url()).search;
    expect.soft(out[u], u).toMatch(/^\/login/);
  }
  note("E6", out);
});

ex("E7 süzgeç: yenileme + geri tuşu + geçersiz değer", async ({ page, context }) => {
  await signIn(context, "hun");
  await page.goto("/history");
  const sel = page.getByTestId("history-consent-mode");
  await sel.selectOption("silent");
  await page.getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/consentMode=silent/);
  await page.reload();
  const afterReload = await sel.inputValue();
  await page.goBack();
  await page.waitForLoadState("networkidle");
  const afterBack = { url: page.url(), val: await sel.inputValue(), count: await page.getByTestId("history-count").innerText() };
  const r = await page.goto("/history?consentMode=xxx");
  const invalidHist = { status: r?.status(), val: await sel.inputValue().catch(() => "?"), count: await page.getByTestId("history-count").innerText().catch(() => "?"), alerts: await page.locator('[role="alert"]').allInnerTexts() };
  await context.clearCookies();
  await signIn(context, "auun");
  const r2 = await page.goto("/audit?consentMode=xxx");
  const invalidAudit = { status: r2?.status(), val: await page.getByTestId("audit-consent-mode").inputValue().catch(() => "?"), rows: await page.locator('[data-testid="audit-row"]').filter({ visible: true }).count(), alerts: await page.locator('[role="alert"]').allInnerTexts() };
  await page.screenshot({ path: `${OUT}keşif-audit-gecersiz-kip.png`, fullPage: true });
  note("E7", { afterReload, afterBack, invalidHist, invalidAudit });
  expect.soft(afterReload).toBe("silent");
});

ex("E8 klavye: Esc diyaloğu kapatır, odak Bağlan'a döner; izinsiz onay Esc", async ({ page, context }) => {
  await signIn(context, "p28ufull");
  await page.goto("/unattended");
  await openConnect(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("un-connect-dialog")).toBeHidden();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent);
  note("E8", { focused });
  expect.soft(focused).toContain("AKTIF-PC");
});

ex("E9 konsol: müdahale onayında Vazgeç → izlemede kalır, istek yok; Esc logoff diyaloğu", async ({ page, context, browser }) => {
  await signIn(context, "p7");
  const a = await consoleTo({ p: page, browser }, SILENT, false);
  await page.getByTestId("un-intervene").click();
  const cancel = page.getByTestId("un-intervene-dialog-cancel");
  const focusCancel = await cancel.evaluate((e) => e === document.activeElement).catch(() => null);
  await cancel.click().catch(() => page.keyboard.press("Escape"));
  await page.waitForTimeout(500);
  const asked = (await agentLog(a)).asked;
  const monitoring = await page.getByTestId("un-monitoring").count();
  // kontrole geç → logoff diyaloğunda Esc
  await page.getByTestId("un-intervene").click();
  await page.getByTestId("un-intervene-dialog-confirm").click();
  await expect.poll(async () => (await agentLog(a)).asked).toBe(true);
  await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
  let calls = 0;
  page.on("request", (r) => {
    if (/unattended\/logoff$/.test(r.url())) calls++;
  });
  await page.getByTestId("un-logoff").click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  note("E9", { focusCancelIntervene: focusCancel, askedAfterCancel: asked, monitoring, logoffDialog: await page.getByTestId("un-logoff-dialog").count(), logoffCalls: calls });
  expect.soft(asked).toBe(false);
  expect.soft(calls).toBe(0);
  await a.close();
});
