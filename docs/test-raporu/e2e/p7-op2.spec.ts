import AxeBuilder from "@axe-core/playwright";
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { CSRF_HEADER } from "@remote/contracts/api/auth";
import { agentLog, agentSend, startFakeAgent } from "./fake-agent";
import { signIn } from "./helpers";

// test-operatoru P7 sayfa testi Tur 2 (dar kapsam: TEST-P7-1..3 + kopma notu + etkilenen şerit düzeni).
// Koşarken apps/web/e2e/ altına geçici kopyalanır. Yığın: sahte API/WS :4217 + standalone web :3217 (önceden ayakta).
const OUT = process.env.P7OP_OUT ?? "p7op2.jsonl";
const IMG = process.env.P7OP_IMG ?? "p7img2";
mkdirSync(IMG, { recursive: true });
const rec = (o: Record<string, unknown>) => appendFileSync(OUT, JSON.stringify({ test: test.info().title, ...o }) + "\n");
function track(p: Page, who: string) {
  p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && rec({ kind: "console", who, type: m.type(), text: m.text().slice(0, 300) }));
  p.on("pageerror", (e) => rec({ kind: "pageerror", who, text: e.message.slice(0, 300) }));
  p.on("response", (r) => r.status() >= 400 && rec({ kind: "http", who, status: r.status(), url: r.url().replace(/[?#].*/, "") }));
}
async function axe(p: Page, label: string) {
  await p.mouse.move(0, 0);
  await p.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const r = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const v = r.violations.map((x) => `${x.id}(${x.impact}): ${x.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  rec({ kind: "axe", label, violations: v });
  return v;
}
const overflow = async (p: Page, label: string) => {
  const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  rec({ kind: "overflow", label, px: o });
  return o;
};
const shot = (p: Page, name: string, full = false) => p.screenshot({ path: `${IMG}/${name}.png`, fullPage: full });
async function geom(p: Page, label: string) {
  const tools = (await p.getByTestId("stage-tools").boundingBox())!;
  const view = (await p.getByTestId("stage-view").boundingBox())!;
  const g = { stripH: Math.round(tools.height), viewH: Math.round(view.height), overlap: Math.round(tools.y + tools.height - view.y), compact: await p.getByTestId("stage-tools").getAttribute("data-compact") };
  rec({ kind: "geom", label, ...g });
  return g;
}
const inViewport = async (p: Page, sel: string, label: string, vw: number) => {
  const b = (await p.locator(sel).boundingBox())!;
  rec({ kind: "menu", label, b, vw });
  return b.x >= 0 && b.x + b.width <= vw;
};

async function tech(browser: Browser, viewport = { width: 1280, height: 800 }, colorScheme: "light" | "dark" = "light") {
  const ctx = await browser.newContext({ viewport, colorScheme });
  await signIn(ctx, "p7");
  const page = await ctx.newPage();
  track(page, "tech");
  return { ctx, page };
}
async function liveAgent(page: Page, browser: Browser) {
  const r = await page.request.post("/api/v1/sessions", { headers: { [CSRF_HEADER]: "csrf-test-token", Origin: "http://localhost:3217" }, data: {} });
  const { id } = (await r.json()) as { id: string };
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  const a = await startFakeAgent(browser, id);
  track(a, "agent");
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect.poll(() => page.getByTestId("console-video").evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 15_000 }).toBeGreaterThan(0);
  return { a, id };
}
const req = (p: Page) => p.getByTestId("control-request");
const note = (p: Page) => p.getByTestId("control-note");
const grant = (a: Page) => agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
const downs = async (a: Page) => (await agentLog(a)).inputs.filter((m) => m.t === "m.btn" && m.down === true) as unknown as { x: number; y: number }[];
async function openView(p: Page) {
  const m = p.getByTestId("stage-view-menu");
  if ((await m.count()) && !(await m.evaluate((d: HTMLDetailsElement) => d.open))) await m.locator("summary").click();
}

test("TEST-P7-1: %100 kaydırılmamış/kaydırılmış ve Sığdır tıklaması ±1 px (hemen ve 3 sn sonra)", async ({ browser }) => {
  const { ctx, page } = await tech(browser);
  const { a } = await liveAgent(page, browser);
  await req(page).click();
  await grant(a);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
  const res: Record<string, unknown>[] = [];
  const clickAt = async (label: string, fx: number, fy: number, ex: number, ey: number) => {
    const n = (await downs(a)).length;
    await page.mouse.click(fx, fy);
    await expect.poll(async () => (await downs(a)).length).toBe(n + 1);
    const d = (await downs(a)).at(-1)!;
    const dx = d.x * 1280 - ex;
    const dy = d.y * 720 - ey;
    res.push({ label, got: [d.x * 1280, d.y * 720], exp: [ex, ey], dx, dy });
    expect.soft(Math.abs(dx), `${label} x`).toBeLessThanOrEqual(1);
    expect.soft(Math.abs(dy), `${label} y`).toBeLessThanOrEqual(1);
  };
  // Sığdır
  const b = (await page.getByTestId("console-video").boundingBox())!;
  const sc = Math.min(b.width / 1280, b.height / 720);
  await clickAt("fit 123,456", b.x + (b.width - 1280 * sc) / 2 + 123 * sc, b.y + (b.height - 720 * sc) / 2 + 456 * sc, 123, 456);
  // %100 hemen
  await openView(page);
  await page.getByRole("button", { name: "%100" }).click();
  await page.keyboard.press("Escape");
  const box = page.getByTestId("stage-scroll");
  const vs = await page.getByTestId("console-video").evaluate((v: HTMLVideoElement) => ({ css: [v.clientWidth, v.clientHeight], native: [v.videoWidth, v.videoHeight] }));
  rec({ kind: "video", label: "actual immediately", ...vs });
  let sb = (await box.boundingBox())!;
  await clickAt("actual 50,50 (hemen)", sb.x + 50, sb.y + 50, 50, 50);
  await box.evaluate((el) => el.scrollTo(300, 200));
  await expect.poll(() => box.evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual([300, 200]);
  await clickAt("actual kaydırılmış 300/200 + 50,50", sb.x + 50, sb.y + 50, 350, 250);
  await shot(page, "t2-01-yuzde100-kaydirilmis-1280");
  // 3 sn sonra (akış tam çözünürlüğe çıkmış olabilir)
  await page.waitForTimeout(3000);
  const vs2 = await page.getByTestId("console-video").evaluate((v: HTMLVideoElement) => ({ css: [v.clientWidth, v.clientHeight], native: [v.videoWidth, v.videoHeight] }));
  rec({ kind: "video", label: "actual after 3s", ...vs2 });
  await box.evaluate((el) => el.scrollTo(600, 300));
  await expect.poll(() => box.evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual([600, 300]);
  sb = (await box.boundingBox())!;
  await clickAt("actual kaydırılmış 600/300 + 200,40 (3 sn)", sb.x + 200, sb.y + 40, 800, 340);
  // Kenar: sağ alt köşeye yakın
  await box.evaluate((el) => el.scrollTo(el.scrollWidth, el.scrollHeight));
  const sl = await box.evaluate((el) => [el.scrollLeft, el.scrollTop, el.clientWidth, el.clientHeight]);
  await clickAt("actual sağ alt", sb.x + sl[2]! - 10, sb.y + sl[3]! - 10, sl[0]! + sl[2]! - 10, sl[1]! + sl[3]! - 10);
  rec({ kind: "clicks", res });
  expect.soft(await axe(page, "actual granted")).toEqual([]);
  await a.context().close();
  await ctx.close();
});

for (const [w, h] of [[1280, 800], [1440, 900]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`TEST-P7-2 şerit ${w} ${scheme}`, async ({ browser }) => {
      const tag = `${w}-${scheme}`;
      const { ctx, page } = await tech(browser, { width: w, height: h }, scheme);
      const { a } = await liveAgent(page, browser);
      const g0 = await geom(page, `idle ${tag}`);
      expect.soft(g0.overlap).toBeLessThanOrEqual(1);
      await shot(page, `t2-02-idle-${tag}`);
      expect.soft(await axe(page, `idle ${tag}`)).toEqual([]);
      await req(page).click();
      await expect(page.getByTestId("control-cancel")).toBeVisible();
      const g1 = await geom(page, `requested ${tag}`);
      await shot(page, `t2-03-bekleniyor-${tag}`);
      expect.soft(await axe(page, `requested ${tag}`)).toEqual([]);
      await grant(a);
      await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
      await page.waitForTimeout(300);
      const g2 = await geom(page, `granted ${tag}`);
      expect.soft(g2.stripH, "kontrol modunda şerit tek satır (≤ 64 px)").toBeLessThanOrEqual(64);
      expect.soft(g2.overlap).toBeLessThanOrEqual(1);
      rec({ kind: "strip-summary", tag, idle: g0.stripH, requested: g1.stripH, granted: g2.stripH, viewH: g2.viewH });
      await shot(page, `t2-04-kontrol-${tag}`);
      expect.soft(await axe(page, `granted ${tag}`)).toEqual([]);
      // Özel tuşlar + Görünüm menüleri
      await page.getByTestId("special-keys").locator("summary").click();
      expect.soft(await inViewport(page, '[data-testid="special-keys"] ul', `keys ${tag}`, w)).toBe(true);
      await shot(page, `t2-05-ozel-tuslar-${tag}`);
      expect.soft(await axe(page, `keys ${tag}`)).toEqual([]);
      await page.keyboard.press("Escape");
      if (await page.getByTestId("stage-view-menu").count()) {
        await openView(page);
        await shot(page, `t2-06-gorunum-menu-${tag}`);
        expect.soft(await axe(page, `view menu ${tag}`)).toEqual([]);
        await page.keyboard.press("Escape");
      } else rec({ kind: "note", text: `görünüm menüsü yok ${tag}` });
      // env şeritleri
      await agentSend(a, { t: "env.state", elevatedForeground: true, secureDesktop: false, selfElevated: true });
      await expect(page.getByTestId("stage-elevated")).toBeVisible();
      const g3 = await geom(page, `env ${tag}`);
      await shot(page, `t2-07-yukseltilmis-${tag}`);
      expect.soft(await axe(page, `env ${tag}`)).toEqual([]);
      rec({ kind: "strip-summary", tag, envViewTop: g3 });
      // kopma notu
      await a.context().close();
      await expect.soft(page.getByTestId("stage")).toHaveAttribute("data-control", "off", { timeout: 3000 });
      await expect.soft(page.getByTestId("stage-control-ended")).toHaveText("Müşteri bağlantısı koptu; kontrol kapandı", { timeout: 3000 });
      await shot(page, `t2-08-kopma-notu-${tag}`);
      expect.soft(await axe(page, `peer lost ${tag}`)).toEqual([]);
      expect.soft(await overflow(page, tag)).toBeLessThanOrEqual(0);
      await ctx.close();
    });
  }
}

test("390 px: kontrol durumları, menüler, kopma notu", async ({ browser }) => {
  for (const scheme of ["light", "dark"] as const) {
    const { ctx, page } = await tech(browser, { width: 390, height: 844 }, scheme);
    const { a } = await liveAgent(page, browser);
    expect.soft(await overflow(page, `390 idle ${scheme}`)).toBeLessThanOrEqual(0);
    await req(page).click();
    await grant(a);
    await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
    await geom(page, `390 granted ${scheme}`);
    expect.soft(await overflow(page, `390 granted ${scheme}`)).toBeLessThanOrEqual(0);
    await shot(page, `t2-10-mobil-kontrol-${scheme}`, true);
    expect.soft(await axe(page, `390 granted ${scheme}`)).toEqual([]);
    await page.getByTestId("special-keys").locator("summary").click();
    expect.soft(await inViewport(page, '[data-testid="special-keys"] ul', `390 keys ${scheme}`, 390)).toBe(true);
    await shot(page, `t2-11-mobil-ozel-tuslar-${scheme}`, true);
    await page.keyboard.press("Escape");
    if (await page.getByTestId("stage-view-menu").count()) {
      await openView(page);
      const ul = page.getByTestId("stage-view-menu").locator("summary + *");
      const bb = await ul.boundingBox();
      rec({ kind: "menu", label: `390 view ${scheme}`, b: bb });
      expect.soft(bb && bb.x >= 0 && bb.x + bb.width <= 390, "Görünüm menüsü 390 px'te ekranda").toBe(true);
      expect.soft(await overflow(page, `390 view menu ${scheme}`)).toBeLessThanOrEqual(0);
      await shot(page, `t2-12-mobil-gorunum-${scheme}`, true);
      expect.soft(await axe(page, `390 view ${scheme}`)).toEqual([]);
      await page.keyboard.press("Escape");
    }
    await a.context().close();
    await expect.soft(page.getByTestId("stage-control-ended")).toBeVisible({ timeout: 3000 });
    await shot(page, `t2-13-mobil-kopma-${scheme}`, true);
    expect.soft(await axe(page, `390 peer lost ${scheme}`)).toEqual([]);
    await ctx.close();
  }
});

test("TEST-P7-3: yenileme sonrası misafir türü ve hak sayacı korunur", async ({ browser }) => {
  const { ctx, page } = await tech(browser);
  const { a } = await liveAgent(page, browser);
  for (let i = 1; i <= 2; i++) {
    await req(page).click();
    await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(i);
    await page.getByTestId("control-cancel").click();
  }
  await page.reload();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect.soft(page.getByText("Hızlı Destek (Windows)")).toBeVisible();
  await expect.soft(req(page)).toBeVisible();
  rec({ kind: "text", label: "after reload", note: await note(page).textContent().catch(() => null) });
  await expect.soft(note(page)).toContainText("3 istek hakkı kaldı");
  for (let i = 3; i <= 5; i++) {
    await req(page).click();
    await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(i);
    await page.getByTestId("control-cancel").click();
  }
  await expect.soft(req(page)).toBeDisabled();
  await expect.soft(note(page)).toContainText("hakkı doldu (5/5)");
  await page.reload();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect.soft(req(page)).toBeDisabled();
  rec({ kind: "text", label: "after 2nd reload", note: await note(page).textContent().catch(() => null), disabled: await req(page).isDisabled().catch(() => null) });
  await shot(page, "t2-14-yenileme-hak-doldu");
  await a.context().close();
  await ctx.close();
});
