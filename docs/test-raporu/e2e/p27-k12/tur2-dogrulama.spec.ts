// K12 TUR 2 — düzeltme doğrulaması (test-operatoru, geçici; kod değil). Sahte API. Sonuçlar dogrulama-tur2.jsonl.
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { signIn } from "/Users/mennan/Projeler/Remote/apps/web/e2e/helpers.ts";

const LOG = new URL("./dogrulama-tur2.jsonl", import.meta.url).pathname;
const OUT = new URL("./shots-tur2/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const note = (id: string, o: unknown) => appendFileSync(LOG, JSON.stringify({ id, proj: test.info().project.name, ...(o as object) }) + "\n");
const B = "http://localhost:3217";
const D1 = "01JDVP2700000000000000000A";
const D3 = "01JDVP2700000000000000000C";
const ACME = "01JCSP2700000000000000000A";
const BETA = "01JCSP2700000000000000000B";
const TARGET = "01JTDTARGET000000000000001";
const rows = (p: Page) => p.locator('[data-testid="un-row"], [data-testid="un-card"]').filter({ visible: true });

async function openConsole(ctx: BrowserContext, p: Page, unattended: boolean) {
  await signIn(ctx, "p7");
  if (unattended)
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
  await p.goto(B + "/sessions");
  const r = await p.request.post(B + "/api/v1/sessions", { headers: { "x-csrf-token": "csrf-test-token", Origin: B }, data: {} });
  const { id } = await r.json();
  await p.goto(`${B}/sessions/${id}/console`);
}

for (const kind of ["gozetimsiz", "katilimli"] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`konsol ${kind} ${scheme}`, async ({ browser }, info) => {
      const u = info.project.use;
      const ctx = await browser.newContext({ viewport: u.viewport, isMobile: u.isMobile, hasTouch: u.hasTouch, deviceScaleFactor: u.deviceScaleFactor, colorScheme: scheme, locale: "tr-TR", reducedMotion: "reduce" });
      const p = await ctx.newPage();
      const errs: string[] = [];
      p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
      p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
      await openConsole(ctx, p, kind === "gozetimsiz");
      if (kind === "gozetimsiz") await expect(p.getByTestId("stage-unattended-wait")).toBeVisible({ timeout: 10000 });
      else await expect(p.getByText("Müşteri bekleniyor").first()).toBeVisible({ timeout: 10000 });
      await p.waitForTimeout(400);
      const main = (await p.locator("body").innerText()).replace(/\s+/g, " ");
      const r = {
        status: await p.getByTestId("console-status").textContent(),
        rozet: await p.getByTestId("console-unattended").count(),
        unWait: await p.getByTestId("stage-unattended-wait").count(),
        unWaitText: (await p.getByTestId("stage-unattended-wait").textContent({ timeout: 500 }).catch(() => null))?.replace(/\s+/g, " "),
        musteriBekleniyor: /Müşteri bekleniyor/.test(main),
        dogrulamaKoduMetni: /Doğrulama kodu|doğrulama kodunu/i.test(main),
        verifyCode: await p.getByTestId("console-verify-code").count(),
        left: await p.getByTestId("console-left").count(),
        leftLabel: /Kod geçerliliği/.test(main),
        overflow: await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        errs,
      };
      await p.screenshot({ path: `${OUT}konsol-${kind}-${info.project.name}-${scheme}.png` });
      note(`konsol-${kind}-${scheme}`, r);
      await ctx.close();
    });
  }
}

test("arama 64 sınırı", async ({ page, context }) => {
  await signIn(context, "unm");
  await page.goto(B + "/unattended");
  const box = page.getByRole("searchbox", { name: "Cihaz ara" });
  await expect(rows(page).first()).toBeVisible();
  const total = await rows(page).count();
  const maxAttr = await box.getAttribute("maxlength");
  await box.fill("x".repeat(300));
  const fillLen = (await box.inputValue()).length;
  await box.fill("");
  await box.pressSequentially("y".repeat(70));
  const typeLen = (await box.inputValue()).length;
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  const afterEnter = { url: page.url(), n: await rows(page).count(), empty: await page.getByText(/eşleşen|bulunamadı|sonuç yok/i).count() };
  const hint = await page.getByText(/64 karakter/).first().textContent().catch(() => null);
  // Tam 64 "depo…" — anlamlı arama
  await box.fill("depo");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  const depo = { url: page.url(), n: await rows(page).count() };
  // URL'den > 64
  const r = await page.goto(B + "/unattended?q=" + "x".repeat(70));
  await page.waitForTimeout(800);
  const urlLong = { status: r?.status(), boxVal: await box.inputValue(), n: await rows(page).count() };
  const r64 = await page.goto(B + "/unattended?q=" + "z".repeat(64));
  await page.waitForTimeout(800);
  const url64 = { status: r64?.status(), boxLen: (await box.inputValue()).length, n: await rows(page).count() };
  note("arama-64", { total, maxAttr, fillLen, typeLen, afterEnter, hint, depo, urlLong, url64 });
});

test("olmayan cihaz 404", async ({ page, context }) => {
  const out: Record<string, unknown> = {};
  await signIn(context, "unm");
  for (const [k, path] of [
    ["yok", "/unattended/01JDVP27000000000000000ZZZ"],
    ["bozuk", "/unattended/abc"],
    ["d1", `/unattended/${D1}`],
  ] as const) {
    const r = await page.goto(B + path);
    await page.waitForLoadState("networkidle");
    out[k] = { status: r?.status(), h1: await page.locator("h1").allTextContents(), title: await page.title(), back: await page.getByRole("link", { name: /Gözetimsiz|Geri|listeye/i }).count() };
  }
  await context.clearCookies();
  await signIn(context, "untech");
  const r = await page.goto(`${B}/unattended/${D3}`);
  await page.waitForLoadState("networkidle");
  out.techD3 = { status: r?.status(), h1: await page.locator("h1").allTextContents(), body: (await page.locator("main").innerText()).slice(0, 200) };
  const rl = await page.goto(`${B}/unattended`);
  out.liste = { status: rl?.status() };
  const rc = await page.goto(`${B}/unattended/codes`);
  out.codes = { status: rc?.status(), url: page.url() };
  note("404", out);
});

test("filtre satırı hizası", async ({ page, context }, info) => {
  await signIn(context, "unm");
  await page.goto(B + "/unattended");
  await expect(rows(page).first()).toBeVisible();
  const f = page.getByTestId("un-filters");
  const s = await f.getByRole("searchbox", { name: "Cihaz ara" }).boundingBox();
  const c = await f.getByRole("combobox").first().boundingBox();
  const seg = await f.getByRole("radiogroup").or(f.locator('[role="group"]')).first().boundingBox();
  note("hiza", { s, c, seg });
  await f.screenshot({ path: `${OUT}filtre-${info.project.name}.png` });
});

test("kullanıcı düzenleme: düğme tek satır + modül ikonları", async ({ page, context }, info) => {
  await signIn(context, "td");
  await page.goto(`${B}/users/${TARGET}`);
  const btn = page.getByTestId("user-forget-devices");
  await expect(btn).toBeVisible();
  const bb = await btn.boundingBox();
  const lh = await btn.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const tops = new Set([...r.getClientRects()].filter((x) => x.width > 2).map((x) => Math.round(x.top)));
    return { lines: tops.size, text: el.textContent?.trim(), sw: el.scrollWidth, cw: el.clientWidth };
  });
  const reset = await page.getByTestId("user-reset-mfa").boundingBox().catch(() => null);
  await btn.scrollIntoViewIfNeeded();
  await page.locator("dl").filter({ has: btn }).first().screenshot({ path: `${OUT}forget-btn-${info.project.name}.png` }).catch(() => null);
  // İkonlar: yetki tablosu/kartı satırları ve yan menü
  const permIcons = await page.evaluate(() => {
    const o: Record<string, string | null> = {};
    document.querySelectorAll('[data-testid^="perm-row-"], [data-testid^="perm-card-"]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const k = el.getAttribute("data-testid")!.replace(/^perm-(row|card)-/, "");
      const svg = el.querySelector("svg");
      o[k] = svg ? (svg.getAttribute("class") ?? "").split(" ").find((c) => c.startsWith("lucide-") && c !== "lucide-icon") ?? null : null;
    });
    return o;
  });
  const navIcons = await page.evaluate(() => {
    const o: Record<string, string | null> = {};
    document.querySelectorAll("nav a[href]").forEach((a) => {
      const svg = a.querySelector("svg");
      o[a.getAttribute("href")!] = svg ? (svg.getAttribute("class") ?? "").split(" ").find((c) => c.startsWith("lucide-") && c !== "lucide-icon") ?? null : null;
    });
    return o;
  });
  note("user-edit", { bb, lh, reset, permIcons, navIcons });
});

test("müşteri ayrıntısı Pasif uyarısı", async ({ page, context }, info) => {
  await signIn(context, "unm");
  const out: Record<string, unknown> = {};
  for (const [k, id] of [["acme", ACME], ["beta", BETA]] as const) {
    await page.goto(`${B}/customers/${id}`);
    await page.waitForLoadState("networkidle");
    const t = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    out[k] = { pasif: /Pasif — bağlantı geçersiz/.test(t), aktif: /Aktif/.test(t), link: /request-download/.test(t) || (await page.locator('[href*="request-download"], [value*="request-download"]').count()) };
    await page.screenshot({ path: `${OUT}musteri-${k}-${info.project.name}.png`, fullPage: true });
  }
  note("musteri", out);
});
