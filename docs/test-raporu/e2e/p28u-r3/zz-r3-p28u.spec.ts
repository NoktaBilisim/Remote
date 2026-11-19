// P28u r3 (onaysız tek yol) R6 test-operatoru turu — geçici tarama + keşif betiği, ürün kodu değil.
// Koşu: bu dosya apps/web/e2e/, r3-op.config.ts apps/web/ altına geçici kopyalanır → sahte API (:4217) ve standalone web (:3217)
// önceden ayakta → `./node_modules/.bin/playwright test -c r3-op.config.ts` → kopyalar silinir.
// Sahte API: e2e/mock-p28u.mjs (u-p28ufull-*), mock-history (u-hun-*), mock-audit (u-auun-*), mock-users (u-usadm-*), konsol p7 WS + sahte ajan.
// Tarama: her görünüm açık/koyu × 1440/390; HTTP, konsol hata/uyarı, pageerror, ≥400, axe, yatay taşma, iç linkler, eski metin artığı, ekran.
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { agentLog, agentSend, startFakeAgent } from "./fake-agent";
import { axeScan, newSession, signIn } from "./helpers";

const ROOT = "/Users/mennan/Projeler/Remote/.claude/worktrees/p28u2-onaysiz-5cadd5/docs/test-raporu/";
const DIR = `${ROOT}e2e/p28u-r3/`;
const IMG = `${ROOT}p28u-r3/`;
mkdirSync(IMG, { recursive: true });
const D1 = "01JDVP28V0000000000000000A";
const D2 = "01JDVP28V0000000000000000B";
const USER_B = "01JKS00000000000000000000B";
const RICH = "01JHXST0000000000000000000";
const log = (o: unknown) => appendFileSync(`${DIR}tarama.jsonl`, JSON.stringify(o) + "\n");
const row = (p: Page, n: string) => p.locator('[data-testid="un-row"], [data-testid="un-card"]').filter({ visible: true }).filter({ hasText: n });
// r3'te kalkan metinler (İzinsiz yalnız "(eski)" ekiyle kalabilir)
const RESIDUE = [/İzin istemeden/i, /Müdahale et/, /İzleniyor/, /İzlemeye dön/, /onayı bekleniyor/i, /Gözetimsiz erişim politikası/i, /İzinsiz(?! \(eski\))/, /Hassas/];

type Ctx = { p: Page; browser: Browser };
type Case = { id: string; scen: string; path: string; status?: number; console?: boolean; act?: (c: Ctx) => Promise<unknown>; vp?: boolean };

async function openConnect(p: Page, n = "AKTIF-PC") {
  await row(p, n).getByRole("button", { name: `Bağlan: ${n}` }).click();
  await expect(p.getByTestId("un-connect-dialog")).toBeVisible();
}
const PARTICIPANT = {
  tid: "PPPPPPPPPPP",
  techRole: "participant",
  roster: [
    { tid: "OOOOOOOOOOO", name: "Ayşe Sahip", role: "controller", owner: true, connected: true },
    { tid: "PPPPPPPPPPP", name: "Burak Katılımcı", role: "participant", owner: false, connected: true },
  ],
};
async function hookWs(p: Page, unattended: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  await p.routeWebSocket(/\/ws\/tech/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const o = JSON.parse(String(m)) as Record<string, unknown>;
      if (o.t === "hello") Object.assign(o, { unattended }, extra);
      ws.send(JSON.stringify(o));
    });
    ws.onMessage((m) => server.send(m));
  });
  await p.route(/\/unattended\/(lock|logoff)$/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(r.request().url().endsWith("logoff") ? { ok: true, rejoin: true } : { ok: true }) }),
  );
}
const UN = (o: Record<string, unknown> = {}) => ({ deviceId: D1, deviceName: "AKTIF-PC", consentMode: "no_user", intervene: true, ...o });
async function consoleTo(c: Ctx, un: Record<string, unknown>, granted: boolean, extra: Record<string, unknown> = {}) {
  await hookWs(c.p, un, extra);
  const { id } = await newSession(c.p);
  await c.p.goto(`/sessions/${id}/console`);
  await expect(c.p.getByTestId("stage-unattended-wait")).toBeVisible();
  const a = await startFakeAgent(c.browser, id);
  await expect(c.p.getByTestId("console-status")).toHaveText("Aktif");
  if (granted) {
    await expect.poll(async () => (await agentLog(a)).asked).toBe(true); // otomatik kontrol isteği (K-P28u-r3-6)
    await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
    await expect(c.p.getByTestId("un-actions")).toBeVisible();
  }
  return a;
}

const cases: Case[] = [
  { id: "liste", scen: "p28ufull", path: "/unattended" },
  { id: "cihaz-detay", scen: "p28ufull", path: `/unattended/${D1}` },
  { id: "cihaz-detay-eski", scen: "p28ufull", path: `/unattended/${D2}` },
  { id: "baglan-diyalog", scen: "p28ufull", path: "/unattended", vp: true, act: ({ p }) => openConnect(p) },
  { id: "baglan-kilitli", scen: "p28ufull", path: "/unattended", vp: true, act: ({ p }) => openConnect(p, "KILIT-PC") },
  {
    id: "baglan-stepup",
    scen: "p28ufull",
    path: "/unattended",
    vp: true,
    act: async ({ p }) => {
      await openConnect(p);
      await p.getByTestId("un-connect-submit").click();
      await expect(p.getByTestId("step-up-dialog")).toBeVisible();
    },
  },
  {
    // Liste/diyalog arası yarış: liste güncelken sunucu 409 DEVICE_OUTDATED döner (servis o an eski sürüme döndü)
    id: "baglan-outdated-409",
    scen: "p28ufull",
    path: "/unattended",
    vp: true,
    act: async ({ p }) => {
      await p.route(/\/devices\/[0-9A-Z]{26}\/connect$/, (r) =>
        r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "DEVICE_OUTDATED", message: "Cihazdaki servis güncel değil — güncelleyin" } }) }),
      );
      await openConnect(p);
      await p.getByTestId("un-connect-submit").click();
      await p.waitForTimeout(700);
    },
  },
  { id: "ayarlar-sekmeler", scen: "p28ufull", path: "/settings/general" },
  { id: "ayarlar-unattended-404", scen: "p28ufull", path: "/settings/unattended", status: 404 },
  { id: "kullanici-yetki", scen: "usadm", path: `/users/${USER_B}` },
  { id: "audit", scen: "auun", path: "/audit" },
  { id: "audit-onaysiz", scen: "auun", path: "/audit?consentMode=no_user" },
  { id: "audit-eski-onayli", scen: "auun", path: "/audit?consentMode=asked" },
  { id: "audit-eski-izinsiz", scen: "auun", path: "/audit?consentMode=silent" },
  { id: "gecmis-onaysiz", scen: "hun", path: "/history?consentMode=no_user" },
  { id: "gecmis-eski-onayli", scen: "hun", path: "/history?consentMode=asked" },
  { id: "gecmis-detay-eski-izinsiz", scen: "hun", path: `/history/${RICH}` },
  { id: "konsol-bekleme", scen: "p7", path: "", console: true, act: async (c) => {
    await hookWs(c.p, UN());
    const { id } = await newSession(c.p);
    await c.p.goto(`/sessions/${id}/console`);
    await expect(c.p.getByTestId("stage-unattended-wait")).toContainText("Cihaz bağlanıyor…");
  } },
  { id: "konsol-kontrol", scen: "p7", path: "", console: true, act: (c) => consoleTo(c, UN(), true) },
  {
    id: "konsol-logoff-onay",
    scen: "p7",
    path: "",
    console: true,
    vp: true,
    act: async (c) => {
      const a = await consoleTo(c, UN(), true);
      await c.p.getByTestId("un-logoff").click();
      await expect(c.p.getByTestId("un-logoff-dialog")).toBeVisible();
      return a;
    },
  },
  { id: "konsol-eski-servis", scen: "p7", path: "", console: true, act: (c) => consoleTo(c, UN({ deviceName: "ESKI-PC", intervene: false }), true) },
];

const VIEWS = [
  { w: 1440, h: 900, mobile: false },
  { w: 390, h: 844, mobile: true },
];

for (const c of cases)
  for (const v of VIEWS)
    for (const scheme of ["light", "dark"] as const)
      test(`${c.id} ${v.w} ${scheme}`, async ({ browser }) => {
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
        if (c.path) {
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
        const dark = await p.evaluate(() => {
          const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255];
          return (m[0]! + m[1]! + m[2]!) / 3 < 128;
        });
        const text = await p.evaluate(() => document.body.innerText);
        const residue = RESIDUE.filter((r) => r.test(text)).map((r) => {
          const m = text.match(r);
          return `${r.source} → «${text.slice(Math.max(0, (m?.index ?? 0) - 30), (m?.index ?? 0) + 40).replace(/\s+/g, " ")}»`;
        });
        await p.screenshot({ path: `${IMG}${c.id}-${v.w}-${scheme}.png`, fullPage: true });
        if (c.vp) await p.screenshot({ path: `${IMG}${c.id}-${v.w}-${scheme}-ekran.png` });
        const broken: string[] = [];
        if (v.w === 1440 && scheme === "light") {
          const hrefs = await p.$$eval("a[href]", (as) => [
            ...new Set(as.map((a) => (a as HTMLAnchorElement).href).filter((h) => h.startsWith(location.origin))),
          ]);
          for (const h of hrefs) {
            const rr = await p.request.get(h, { maxRedirects: 0 }).catch(() => null);
            if (!rr || rr.status() >= 400) broken.push(`${rr?.status() ?? "ERR"} ${new URL(h).pathname}`);
          }
        }
        log({ id: c.id, w: v.w, scheme, status, url: new URL(p.url()).pathname + new URL(p.url()).search, h1, ms, axe, overflow, wideEls, dark, console: msgs, bad, broken, residue, actErr });
        if (agent) await (agent as Page).close().catch(() => {});
        expect.soft(actErr).toBe("");
        expect.soft(status).toBe(c.status ?? 200);
        expect.soft(msgs.filter((m) => !/status of (4\d\d)/.test(m))).toEqual([]);
        expect.soft(axe).toEqual([]);
        expect.soft(overflow).toBeLessThanOrEqual(0);
        expect.soft(broken).toEqual([]);
        expect.soft(residue).toEqual([]);
        if (!c.console) expect.soft(dark).toBe(scheme === "dark");
        await ctx.close();
      });

// ---------------- Keşif turu (masaüstü) ----------------
const note = (id: string, o: Record<string, unknown>) => log({ ex: id, ...o });

test("KEŞİF K1 çift tıklama Bağlan + Doğrula → çift kayıt yok; geri tuşu", async ({ page, context }) => {
  await signIn(context, "p28ufull");
  await page.goto("/unattended");
  const bodies: unknown[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith(`/devices/${D1}/connect`)) bodies.push(r.postDataJSON());
  });
  await openConnect(page);
  await page.getByTestId("un-connect-submit").dblclick();
  await expect(page.getByTestId("step-up-dialog")).toBeVisible();
  await page.waitForTimeout(500);
  const before = bodies.length;
  await page.getByTestId("step-up-code").fill("123456");
  await page.getByTestId("step-up-submit").dblclick();
  await expect(page).toHaveURL(/\/console$/);
  await page.waitForTimeout(500);
  const total = bodies.length;
  await page.goBack();
  await expect(page).toHaveURL(/\/unattended$/);
  await page.waitForLoadState("networkidle");
  const dlgVisible = await page.getByTestId("un-connect-dialog").isVisible().catch(() => false);
  await page.screenshot({ path: `${IMG}kesif-geri-tusu-liste.png` });
  note("K1", { postsBeforeStepUp: before, postsTotal: total, bodies, dlgVisibleAfterBack: dlgVisible });
  expect.soft(before).toBe(1);
  expect.soft(total).toBe(2);
  expect.soft(bodies.every((b) => JSON.stringify(b) === "{}")).toBe(true);
  expect.soft(dlgVisible).toBe(false);
});

test("KEŞİF K2 connect 500 ve ağ kopması → diyalogda hata, düğme yeniden etkin", async ({ page, context }) => {
  await signIn(context, "p28ufull");
  await page.goto("/unattended");
  let mode: "500" | "abort" = "500";
  await page.route(/\/devices\/[0-9A-Z]{26}\/connect$/, (r) =>
    mode === "500" ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL","message":"x"}}' }) : r.abort(),
  );
  await openConnect(page);
  await page.getByTestId("un-connect-submit").click();
  await page.waitForTimeout(800);
  const t500 = await page.getByTestId("un-connect-dialog").innerText();
  await page.screenshot({ path: `${IMG}kesif-baglan-500.png` });
  mode = "abort";
  await page.getByTestId("un-connect-submit").click();
  await page.waitForTimeout(800);
  const tAbort = await page.getByTestId("un-connect-dialog").innerText();
  await page.screenshot({ path: `${IMG}kesif-baglan-agkopuk.png` });
  note("K2", { t500, tAbort, url: page.url(), submitEnabled: await page.getByTestId("un-connect-submit").isEnabled() });
  await expect.soft(page.getByTestId("un-connect-submit")).toBeEnabled();
});

test("KEŞİF K3 409 DEVICE_OUTDATED step-up'tan sonra (gerçek sunucu sırası: step-up → 8a) metin", async ({ page, context }) => {
  await signIn(context, "p28ufull");
  await page.goto("/unattended");
  let n = 0;
  await page.route(/\/devices\/[0-9A-Z]{26}\/connect$/, (r) =>
    ++n === 1 ? r.continue() : r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "DEVICE_OUTDATED", message: "Cihazdaki servis güncel değil — güncelleyin" } }) }),
  );
  await openConnect(page);
  await page.getByTestId("un-connect-submit").click();
  await expect(page.getByTestId("step-up-dialog")).toBeVisible();
  await page.getByTestId("step-up-code").fill("123456");
  await page.getByTestId("step-up-submit").click();
  await page.waitForTimeout(1000);
  const dlg = await page.getByTestId("un-connect-dialog").innerText().catch(() => "(diyalog yok)");
  const alerts = await page.locator('[role="alert"], [data-sonner-toast]').allInnerTexts();
  await page.screenshot({ path: `${IMG}kesif-baglan-409-stepup-sonrasi.png` });
  note("K3", { n, url: page.url(), dlg, alerts });
  expect.soft(page.url()).toMatch(/\/unattended$/);
  expect.soft(dlg + alerts.join(" ")).toContain("güncel değil");
});

test("KEŞİF K4 liste yoklaması 500 → 'güncellenemedi' + son veri", async ({ page, context }) => {
  await signIn(context, "p28ufull");
  await page.goto("/unattended");
  await expect(row(page, "AKTIF-PC")).toBeVisible();
  await page.route(/\/api\/v1\/unattended\/devices(\?|$)/, (r) =>
    r.request().method() === "GET" ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL","message":"x"}}' }) : r.continue(),
  );
  await page.waitForTimeout(9500);
  const alerts = await page.locator('[role="alert"], [role="status"]').allInnerTexts();
  await page.screenshot({ path: `${IMG}kesif-liste-yoklama-500.png` });
  note("K4", { alerts, rowsStill: await row(page, "AKTIF-PC").count() });
  expect.soft(await row(page, "AKTIF-PC").count()).toBe(1);
});

test("KEŞİF K5 oturumsuz erişim → giriş", async ({ page }) => {
  const out: Record<string, string> = {};
  for (const u of ["/unattended", `/unattended/${D1}`, "/settings/general", "/settings/unattended", `/users/${USER_B}`, "/history?consentMode=no_user", "/audit?consentMode=asked"]) {
    const r = await page.goto(u);
    out[u] = `${r?.status()} ${new URL(page.url()).pathname}${new URL(page.url()).search}`;
  }
  note("K5", out);
  for (const [u, v] of Object.entries(out)) if (u !== "/settings/unattended") expect.soft(v, u).toMatch(/ \/login/);
});

test("KEŞİF K6 süzgeç: yenileme + geri + geçersiz/eski değer", async ({ page, context }) => {
  await signIn(context, "hun");
  await page.goto("/history");
  const sel = page.getByTestId("history-consent-mode");
  const opts = await sel.locator("option").allInnerTexts();
  await sel.selectOption("no_user");
  await page.getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/consentMode=no_user/);
  await page.reload();
  const afterReload = await sel.inputValue();
  await page.goBack();
  await page.waitForLoadState("networkidle");
  const afterBack = { url: page.url(), val: await sel.inputValue(), count: await page.getByTestId("history-count").innerText() };
  const r = await page.goto("/history?consentMode=xxx");
  const invalidHist = { status: r?.status(), val: await sel.inputValue().catch(() => "?"), count: await page.getByTestId("history-count").innerText().catch(() => "?") };
  await context.clearCookies();
  await signIn(context, "auun");
  const r2 = await page.goto("/audit?consentMode=%3Cscript%3E");
  const auditOpts = await page.getByTestId("audit-consent-mode").locator("option").allInnerTexts();
  const invalidAudit = { status: r2?.status(), val: await page.getByTestId("audit-consent-mode").inputValue().catch(() => "?"), rows: await page.locator('[data-testid="audit-row"]').filter({ visible: true }).count() };
  const actionOpts = (await page.getByTestId("audit-action").locator("option").allInnerTexts()).filter((o) => /Gözetimsiz|izin|İzin|politika|Politika/.test(o));
  note("K6", { opts, afterReload, afterBack, invalidHist, auditOpts, invalidAudit, actionOpts });
  expect.soft(afterReload).toBe("no_user");
});

test("KEŞİF K7 klavye: Esc Bağlan diyaloğunu kapatır, odak Bağlan düğmesine döner", async ({ page, context }) => {
  await signIn(context, "p28ufull");
  await page.goto("/unattended");
  await openConnect(page);
  const focusIn = await page.evaluate(() => document.activeElement?.textContent ?? "");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("un-connect-dialog")).toBeHidden();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent);
  note("K7", { focusIn, focused });
  expect.soft(focused).toContain("AKTIF-PC");
});

test("KEŞİF K8 çok teknisyenli oda: kontrol sahibi olmayan katılımcıda otomatik istek ve Kilitle/Oturumu kapat yok (S-P28u-r3-8)", async ({ page, context, browser }) => {
  await signIn(context, "p7");
  const a = await consoleTo({ p: page, browser }, UN(), false, PARTICIPANT);
  await page.waitForTimeout(1500);
  const askedAuto = (await agentLog(a)).asked;
  await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
  await page.waitForTimeout(800);
  const lock = await page.getByTestId("un-lock").count();
  const logoff = await page.getByTestId("un-logoff").count();
  const roster = await page.getByText("Burak Katılımcı").count();
  await page.screenshot({ path: `${IMG}kesif-konsol-katilimci.png` });
  note("K8", { askedAuto, lock, logoff, rosterSeen: roster, ctrlReq: (await agentLog(a)).controlRequests });
  expect.soft(askedAuto).toBe(false);
  expect.soft(lock + logoff).toBe(0);
  await a.close();
});

test("KEŞİF K9 kontrol sahibi: bırak sonrası otomatik istek yok; cihaz yeniden katılınca otomatik istek bir kez daha (K-P28u-r3-6)", async ({ page, context, browser }) => {
  await signIn(context, "p7");
  await hookWs(page, UN());
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("stage-unattended-wait")).toBeVisible();
  const a = await startFakeAgent(browser, id);
  await expect.poll(async () => (await agentLog(a)).asked).toBe(true);
  await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
  await expect(page.getByTestId("un-lock")).toBeVisible();
  const first = (await agentLog(a)).controlRequests;
  await page.getByTestId("control-release").click();
  await page.waitForTimeout(1500);
  const afterRelease = (await agentLog(a)).controlRequests;
  await a.close();
  await page.waitForTimeout(3000);
  const statusAfterClose = await page.getByTestId("console-status").innerText();
  const stageText = await page.locator('[data-testid^="stage-"]').allInnerTexts();
  await page.screenshot({ path: `${IMG}kesif-konsol-cihaz-koptu.png` });
  let b: Awaited<ReturnType<typeof startFakeAgent>> | null = null;
  let rejoinAsked: unknown = "denenemedi";
  try {
    b = await startFakeAgent(browser, id);
    await expect.poll(async () => (await agentLog(b!)).asked, { timeout: 10000 }).toBe(true);
    rejoinAsked = true;
  } catch (e) {
    rejoinAsked = `hayır: ${(e as Error).message.split("\n")[0]}`;
  }
  await page.screenshot({ path: `${IMG}kesif-konsol-yeniden-katilim.png` });
  note("K9", { first, afterRelease, statusAfterClose, stageText, rejoinAsked });
  expect.soft(first).toBe(1);
  expect.soft(afterRelease).toBe(1);
  if (b) await b.close();
});
