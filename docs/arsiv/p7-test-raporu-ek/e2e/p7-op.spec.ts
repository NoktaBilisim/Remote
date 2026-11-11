import AxeBuilder from "@axe-core/playwright";
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_HEADER } from "@remote/contracts/api/auth";
import { agentLog, agentSend, startFakeAgent } from "./fake-agent";
import { signIn } from "./helpers";

// test-operatoru P7 sayfa testi (geçici; çalıştırırken apps/web/e2e/ altına kopyalanır, kaynak docs/test-raporu/e2e/).
// Yığın: sahte API + sahte WS (e2e/mock-*.mjs, :4217) + standalone web (:3217, NEXT_PUBLIC_RS_E2E=1), önceden ayakta.
// Ölçüm odaklı: expect.soft + JSONL (P7OP_OUT), ekranlar P7OP_IMG.
const MOCK = "http://127.0.0.1:4217";
const OUT = process.env.P7OP_OUT ?? "p7op.jsonl";
const IMG = process.env.P7OP_IMG ?? "p7img";
mkdirSync(IMG, { recursive: true });
const rec = (o: Record<string, unknown>) => appendFileSync(OUT, JSON.stringify({ test: test.info().title, ...o }) + "\n");

function track(p: Page, who: string) {
  p.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") rec({ kind: "console", who, type: m.type(), text: m.text().slice(0, 300) });
  });
  p.on("pageerror", (e) => rec({ kind: "pageerror", who, text: e.message.slice(0, 300) }));
  p.on("response", (r) => {
    if (r.status() >= 400) rec({ kind: "http", who, status: r.status(), url: r.url().replace(/[?#].*/, "") });
  });
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
async function overflow(p: Page, label: string) {
  const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  rec({ kind: "overflow", label, px: o });
  return o;
}
/** Şeritteki öğelerden şerit dışına taşanlar (sağ kenar) — dar ekranda kırpılma. */
async function stripClip(p: Page, label: string) {
  const r = await p.evaluate(() => {
    const s = document.querySelector('[data-testid="stage-tools"]');
    if (!s) return null;
    const sb = s.getBoundingClientRect();
    const bad: string[] = [];
    for (const el of Array.from(s.querySelectorAll("button, summary, p, span"))) {
      const b = el.getBoundingClientRect();
      if (b.width === 0) continue;
      if (b.right > sb.right + 1 || b.left < sb.left - 1) bad.push(`${(el.textContent ?? "").trim().slice(0, 30)} (${Math.round(b.left)}..${Math.round(b.right)} / ${Math.round(sb.right)})`);
    }
    return { stripH: Math.round(sb.height), bad };
  });
  rec({ kind: "strip", label, ...r });
  return r;
}
const shot = (p: Page, name: string, full = false) => p.screenshot({ path: `${IMG}/${name}.png`, fullPage: full });

async function liveAgent(page: Page, browser: Browser) {
  const r = await page.request.post("/api/v1/sessions", { headers: { [CSRF_HEADER]: "csrf-test-token", Origin: "http://localhost:3217" }, data: {} });
  expect(r.status()).toBe(201);
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
const inputs = async (a: Page) => (await agentLog(a)).inputs;
const techSent = async (p: Page, id: string) =>
  ((await (await p.request.get(`${MOCK}/__e2e/ws-log/${id}`)).json()) as { from: string; m: { t: string } }[]).filter((x) => x.from === "tech").map((x) => x.m.t);
async function clickVideo(p: Page, fx = 0.5, fy = 0.5) {
  const b = (await p.getByTestId("console-video").boundingBox())!;
  const s = Math.min(b.width / 1280, b.height / 720);
  const w = 1280 * s;
  const h = 720 * s;
  await p.mouse.click(b.x + (b.width - w) / 2 + w * fx, b.y + (b.height - h) / 2 + h * fy);
}
async function geom(p: Page, label: string) {
  const tools = await p.getByTestId("stage-tools").boundingBox();
  const view = await p.getByTestId("stage-view").boundingBox();
  const video = await p.getByTestId("console-video").boundingBox();
  const border = await p.getByTestId("stage-view").evaluate((e) => getComputedStyle(e).borderTopColor + " " + getComputedStyle(e).borderTopWidth);
  const g = { tools, view, video, border, overlap: tools && view ? Math.round(tools.y + tools.height - view.y) : null };
  rec({ kind: "geom", label, ...g });
  return g;
}

async function newTech(browser: Browser, scenario: string, viewport = { width: 1280, height: 800 }, colorScheme: "light" | "dark" = "light") {
  const ctx = await browser.newContext({ viewport, colorScheme });
  await signIn(ctx, scenario);
  const page = await ctx.newPage();
  track(page, "tech");
  return { ctx, page };
}


for (const [w, h] of [[1280, 800], [1440, 900]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`galeri ${w} ${scheme}: kontrol durumları + şerit geometrisi`, async ({ browser }) => {
      const { ctx, page } = await newTech(browser, "p7", { width: w, height: h }, scheme);
      const { a } = await liveAgent(page, browser);
      const tag = `${w}-${scheme}`;
      // idle
      expect.soft(await req(page).textContent()).toBe("Kontrol iste");
      const g0 = await geom(page, `idle ${tag}`);
      expect.soft(g0.overlap, "şerit görüntünün üstüne binmemeli").toBeLessThanOrEqual(1);
      expect.soft(await stripClip(page, `idle ${tag}`)).toMatchObject({ bad: [] });
      await shot(page, `01-idle-${tag}`);
      expect.soft(await axe(page, `idle ${tag}`)).toEqual([]);
      expect.soft(await overflow(page, `idle ${tag}`)).toBeLessThanOrEqual(0);
      // requested
      await req(page).click();
      await expect(page.getByTestId("control-cancel")).toBeVisible();
      await shot(page, `02-bekleniyor-${tag}`);
      expect.soft(await stripClip(page, `requested ${tag}`)).toMatchObject({ bad: [] });
      expect.soft(await axe(page, `requested ${tag}`)).toEqual([]);
      // granted
      await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(1);
      await grant(a);
      await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
      const g1 = await geom(page, `granted ${tag}`);
      expect.soft(g1.border).toMatch(/4px$/);
      expect.soft(g1.border, "kontrolde kırmızı çerçeve").not.toMatch(/rgba\(0, 0, 0, 0\)/);
      expect.soft(g1.overlap).toBeLessThanOrEqual(1);
      expect.soft(await stripClip(page, `granted ${tag}`)).toMatchObject({ bad: [] });
      await page.waitForTimeout(400);
      await shot(page, `03-kontrol-sizde-${tag}`);
      expect.soft(await axe(page, `granted ${tag}`)).toEqual([]);
      // özel tuşlar menüsü açık
      await page.getByTestId("special-keys").locator("summary").click();
      await expect(page.getByTestId("key-win")).toBeVisible();
      const menu = await page.getByTestId("special-keys").locator("ul").boundingBox();
      rec({ kind: "menu", label: tag, menu, vw: w });
      expect.soft(menu!.x + menu!.width).toBeLessThanOrEqual(w);
      await shot(page, `04-ozel-tuslar-${tag}`);
      expect.soft(await axe(page, `menu ${tag}`)).toEqual([]);
      await page.keyboard.press("Escape");
      // env: selfElevated + elevated (kontrol açıkken)
      await agentSend(a, { t: "env.state", elevatedForeground: true, secureDesktop: false, selfElevated: true });
      await expect(page.getByTestId("stage-elevated")).toBeVisible();
      await expect(page.getByTestId("stage-self-elevated")).toBeVisible();
      const g2 = await geom(page, `env ${tag}`);
      expect.soft(g2.overlap).toBeLessThanOrEqual(1);
      await shot(page, `05-yukseltilmis-${tag}`);
      expect.soft(await axe(page, `elevated ${tag}`)).toEqual([]);
      // güvenli masaüstü (kontrol izni sürerken) → yakalama durmalı
      await agentSend(a, { t: "env.state", elevatedForeground: false, secureDesktop: true, selfElevated: false });
      await expect(page.getByTestId("stage-secure")).toBeVisible();
      await expect.soft(page.getByTestId("stage")).toHaveAttribute("data-control", "off");
      const n = (await inputs(a)).length;
      await clickVideo(page);
      await page.keyboard.press("q");
      await page.waitForTimeout(300);
      expect.soft((await inputs(a)).length, "güvenli masaüstünde girdi gitmemeli").toBe(n);
      await shot(page, `06-guvenli-masaustu-${tag}`);
      expect.soft(await axe(page, `secure ${tag}`)).toEqual([]);
      await agentSend(a, { t: "env.state", elevatedForeground: false, secureDesktop: false, selfElevated: false });
      await expect(page.getByTestId("stage-secure")).toHaveCount(0);
      await expect.soft(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
      // ret + geri sayım
      await page.getByTestId("control-release").click();
      await req(page).click();
      await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(2);
      await agentSend(a, { t: "control.state", state: "VIEW", source: "DENIED" });
      await expect(req(page)).toHaveText(/Tekrar iste \(0:/);
      await shot(page, `07-ret-geri-sayim-${tag}`);
      expect.soft(await axe(page, `denied ${tag}`)).toEqual([]);
      // monitör reddi geri sayımı
      await page.getByTestId("monitor-picker").getByRole("button", { name: "Ekran 2" }).click();
      await expect.poll(async () => (await agentLog(a)).monitorRequests).toEqual([1]);
      await agentSend(a, { t: "monitor.denied", monitorId: 1 });
      await expect(page.getByTestId("monitor-note")).toContainText("yeni istek");
      expect.soft(await stripClip(page, `monitor-denied ${tag}`)).toMatchObject({ bad: [] });
      await shot(page, `08-monitor-ret-${tag}`);
      expect.soft(await axe(page, `monitor ${tag}`)).toEqual([]);
      expect.soft(await overflow(page, `end ${tag}`)).toBeLessThanOrEqual(0);
      await a.context().close();
      await ctx.close();
    });
  }
}

test("mobil 390 px: konsol kontrol durumlarında taşma", async ({ browser }) => {
  const { ctx, page } = await newTech(browser, "p7", { width: 390, height: 844 });
  const { a } = await liveAgent(page, browser);
  expect.soft(await overflow(page, "390 idle")).toBeLessThanOrEqual(0);
  await shot(page, "10-mobil-idle", true);
  await req(page).click();
  await expect(page.getByTestId("control-cancel")).toBeVisible();
  expect.soft(await overflow(page, "390 requested")).toBeLessThanOrEqual(0);
  await shot(page, "11-mobil-bekleniyor", true);
  await grant(a);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
  await agentSend(a, { t: "env.state", elevatedForeground: true, secureDesktop: false, selfElevated: true });
  await page.getByTestId("special-keys").locator("summary").click();
  expect.soft(await overflow(page, "390 granted+menu")).toBeLessThanOrEqual(0);
  const menu = await page.getByTestId("special-keys").locator("ul").boundingBox();
  rec({ kind: "menu", label: "390", menu });
  expect.soft(menu!.x + menu!.width, "özel tuşlar menüsü 390 px'te ekranda kalmalı").toBeLessThanOrEqual(390);
  expect.soft(await stripClip(page, "390 granted")).toMatchObject({ bad: [] });
  await shot(page, "12-mobil-kontrol-menu", true);
  expect.soft(await axe(page, "390 granted")).toEqual([]);
  await a.context().close();
  await ctx.close();
});

test("5 istek hakkı: Vazgeç ×5 → düğme pasif, 'hak doldu (5/5)'; çift tıklama tek istek", async ({ browser }) => {
  const { ctx, page } = await newTech(browser, "p7");
  const { a, id } = await liveAgent(page, browser);
  await req(page).dblclick();
  await expect(page.getByTestId("control-cancel")).toBeVisible();
  await page.waitForTimeout(500);
  expect.soft((await techSent(page, id)).filter((x) => x === "control.request").length, "çift tıklama tek istek").toBe(1);
  await page.getByTestId("control-cancel").click();
  for (let i = 2; i <= 5; i++) {
    await expect(req(page)).toBeEnabled();
    await req(page).click();
    await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(i);
    await page.getByTestId("control-cancel").click();
    await expect(page.getByTestId("control-bar")).toHaveAttribute("data-phase", "ended");
  }
  await expect.soft(req(page)).toBeDisabled();
  await expect.soft(note(page)).toContainText("Bu oturumda kontrol isteği hakkı doldu (5/5)");
  rec({ kind: "text", label: "exhausted", note: await note(page).textContent(), btn: await req(page).textContent() });
  await shot(page, "13-hak-doldu-1280");
  expect.soft(await axe(page, "exhausted")).toEqual([]);
  // Sayfa yenilenince hak sayacı korunuyor mu? (sunucu 5'te kalır)
  await page.reload();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect(req(page)).toBeVisible();
  await page.waitForTimeout(800);
  rec({ kind: "text", label: "exhausted after reload", note: await note(page).textContent(), btn: await req(page).textContent(), enabled: await req(page).isEnabled() });
  if (await req(page).isEnabled()) {
    await req(page).click();
    await page.waitForTimeout(800);
    rec({ kind: "text", label: "6th request after reload", note: await note(page).textContent(), btn: await req(page).textContent(), phase: await page.getByTestId("control-bar").getAttribute("data-phase") });
    await shot(page, "14-hak-doldu-yenileme-sonrasi");
  }
  await a.context().close();
  await ctx.close();
});

test("ret 30 sn geri sayım biter → 'Tekrar iste' etkin ve istek gider", async ({ browser }) => {
  test.setTimeout(90_000);
  const { ctx, page } = await newTech(browser, "p7");
  const { a } = await liveAgent(page, browser);
  await req(page).click();
  await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(1);
  await agentSend(a, { t: "control.state", state: "VIEW", source: "DENIED" });
  await expect(req(page)).toBeDisabled();
  await expect(req(page)).toHaveText("Tekrar iste", { timeout: 35_000 });
  await expect.soft(req(page)).toBeEnabled();
  await shot(page, "15-ret-sonrasi-tekrar");
  await req(page).click();
  await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(2);
  await expect.soft(req(page)).toHaveText("Kontrol bekleniyor");
  await a.context().close();
  await ctx.close();
});

test("monitör: 30 sn yanıtsızlık → 'onaylamadı' + geri sayım → tekrar seçilebilir", async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await newTech(browser, "p7");
  const { a } = await liveAgent(page, browser);
  const picker = page.getByTestId("monitor-picker");
  await picker.getByRole("button", { name: "Ekran 2" }).click();
  await expect(page.getByTestId("monitor-note")).toHaveText("Ekran 2 için müşteri onayı bekleniyor…");
  await expect.soft(picker.getByRole("button", { name: "Ekran 1" })).toBeDisabled();
  await shot(page, "16-monitor-bekleniyor");
  await expect(page.getByTestId("monitor-note")).toContainText("onaylamadı", { timeout: 35_000 });
  rec({ kind: "text", label: "monitor noAnswer", note: await page.getByTestId("monitor-note").textContent() });
  await shot(page, "17-monitor-yanitsiz");
  await expect(picker.getByRole("button", { name: "Ekran 2" })).toBeEnabled({ timeout: 35_000 });
  rec({ kind: "text", label: "monitor after block", note: await page.getByTestId("monitor-note").textContent() });
  await picker.getByRole("button", { name: "Ekran 2" }).click();
  await expect.poll(async () => (await agentLog(a)).monitorRequests).toEqual([1, 1]);
  await a.context().close();
  await ctx.close();
});

test("klavye: Ctrl+Alt+Shift sonrası tuşlar gitmez; özel tuşlar klavyeyle; Ctrl+Alt+Del yok", async ({ browser }) => {
  const { ctx, page } = await newTech(browser, "p7");
  const { a } = await liveAgent(page, browser);
  await req(page).click();
  await grant(a);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
  await clickVideo(page);
  await page.keyboard.press("ı"); // Türkçe karakter
  await page.keyboard.press("Tab"); // Tab uzak ekrana gitmeli, odak sahnede kalmalı
  await expect.soft(page.getByTestId("stage-scroll")).toBeFocused();
  await expect.poll(async () => (await inputs(a)).filter((m) => m.t === "k" && m.code === "Tab").length).toBeGreaterThanOrEqual(1);
  const ks = (await inputs(a)).filter((m) => m.t === "k");
  rec({ kind: "keys", label: "türkçe+tab", ks: ks.slice(0, 6) });
  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.keyboard.down("Shift");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");
  await expect(page.getByTestId("control-release")).toBeFocused();
  const n = (await inputs(a)).length;
  await page.keyboard.press("Tab"); // odak sayfada dolaşır
  await page.keyboard.press("x");
  await page.waitForTimeout(300);
  expect.soft((await inputs(a)).slice(n).filter((m) => m.t === "k" && m.code === "KeyX"), "çıkıştan sonra tuş uzağa gitmemeli").toEqual([]);
  // Özel tuşlar: klavyeyle aç (focus summary → Enter), Tab ile öğe, Enter gönder
  await page.getByTestId("special-keys").locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("key-win")).toBeVisible();
  const labels = await page.getByTestId("special-keys").locator("li button").allTextContents();
  rec({ kind: "keys", label: "menu", labels });
  expect.soft(labels.join("|")).not.toMatch(/Del/i);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab"); // ikinci öğe: Win
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await inputs(a)).filter((m) => m.t === "k" && m.code === "MetaLeft").length).toBe(2);
  await expect.soft(page.getByTestId("special-keys").locator("summary")).toBeFocused();
  const open = await page.getByTestId("special-keys").evaluate((d: HTMLDetailsElement) => d.open);
  expect.soft(open).toBe(false);
  // Esc menüyü kapatır, uzak ekrana Escape gitmemeli
  await page.keyboard.press("Enter");
  const m0 = (await inputs(a)).length;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  expect.soft(await page.getByTestId("special-keys").evaluate((d: HTMLDetailsElement) => d.open)).toBe(false);
  expect.soft((await inputs(a)).slice(m0).filter((m) => m.t === "k"), "menüdeki Esc uzağa gitmemeli").toEqual([]);
  // Ctrl+Shift+Esc sırası
  await page.getByTestId("special-keys").locator("summary").click();
  await page.getByTestId("key-ctrlShiftEsc").click();
  await page.waitForTimeout(300);
  rec({ kind: "keys", label: "ctrlShiftEsc", seq: (await inputs(a)).slice(-6) });
  await a.context().close();
  await ctx.close();
});

test("kontrol sürerken: %100 görünüm, işaretleme araçları, müşteri kopması, oturumu bitir", async ({ browser }) => {
  const { ctx, page } = await newTech(browser, "p7");
  const { a } = await liveAgent(page, browser);
  // işaretleme araç çubuğu şeritte mi (görüntü dışında)
  const pen = await page.getByTestId("annot-pen").boundingBox();
  const view = await page.getByTestId("stage-view").boundingBox();
  rec({ kind: "geom", label: "annot pen vs view", pen, view });
  expect.soft(pen!.y + pen!.height).toBeLessThanOrEqual(view!.y + 1);
  await req(page).click();
  await grant(a);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
  await expect.soft(page.getByTestId("annot-pen")).toBeDisabled();
  // %100 kipine geç
  await page.getByRole("button", { name: "%100" }).click().catch(async () => rec({ kind: "note", text: "%100 düğmesi bulunamadı" }));
  await page.waitForTimeout(300);
  await expect.soft(page.getByTestId("stage")).toHaveAttribute("data-mode", "actual");
  await expect.soft(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
  const before = (await inputs(a)).length;
  const sb = (await page.getByTestId("stage-scroll").boundingBox())!;
  await page.mouse.click(sb.x + 50, sb.y + 50);
  await page.waitForTimeout(300);
  const after = (await inputs(a)).slice(before).find((m) => m.t === "m.btn") as { x: number; y: number } | undefined;
  rec({ kind: "input", label: "actual mode click", after });
  expect.soft(after, "%100 kipinde tık gitmeli").toBeTruthy();
  if (after) {
    expect.soft(Math.abs(after.x - 50 / 1280)).toBeLessThan(0.01);
    expect.soft(Math.abs(after.y - 50 / 720)).toBeLessThan(0.01);
  }
  await shot(page, "18-kontrol-yuzde100");
  await page.getByRole("button", { name: "Sığdır" }).click().catch(() => undefined);
  // müşteri kopar
  await a.context().close();
  await expect.soft(page.getByTestId("stage")).toHaveAttribute("data-control", "off", { timeout: 3000 });
  await expect.soft(note(page)).toContainText("Müşteri bağlantısı koptu", { timeout: 3000 });
  await shot(page, "19-musteri-koptu");
  expect.soft(await axe(page, "peer lost")).toEqual([]);
  rec({ kind: "text", label: "peer lost", note: await note(page).textContent().catch(() => null) });
  await ctx.close();
});

test("kontrol açıkken oturumu bitir → ekran bitti, yakalama yok; geri tuşu", async ({ browser }) => {
  const { ctx, page } = await newTech(browser, "p7");
  const { a, id } = await liveAgent(page, browser);
  await req(page).click();
  await grant(a);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
  await page.getByTestId("console-end").click();
  await page.getByTestId("console-confirm-ok").click();
  await expect(page.getByTestId("console-ended")).toBeVisible();
  rec({ kind: "text", label: "ended", text: await page.getByTestId("console-ended").textContent(), closes: (await agentLog(a)).closes });
  await shot(page, "20-kontrol-acikken-bitti");
  await page.goto("/sessions");
  await page.goBack();
  await page.waitForTimeout(800);
  rec({ kind: "text", label: "back after end", ended: await page.getByTestId("console-ended").isVisible().catch(() => false), ctl: await page.getByTestId("control-request").count(), id });
  await a.context().close();
  await ctx.close();
});

test("ağ: teknisyen WS kopar (offline) iken kontrol kapanır", async ({ browser }) => {
  const { ctx, page } = await newTech(browser, "p7");
  const { a } = await liveAgent(page, browser);
  await req(page).click();
  await grant(a);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
  // WS'i sayfa içinden kapat (ağ kopması benzetimi): ws örneklerini yakalamak mümkün değil → offline
  await ctx.setOffline(true);
  await page.waitForTimeout(4000);
  rec({ kind: "text", label: "offline", ctl: await page.getByTestId("stage").getAttribute("data-control"), note: await note(page).textContent().catch(() => null) });
  await shot(page, "21-offline");
  await ctx.setOffline(false);
  await page.waitForTimeout(5000);
  rec({ kind: "text", label: "online again", ctl: await page.getByTestId("stage").getAttribute("data-control"), note: await note(page).textContent().catch(() => null), closes: (await agentLog(a)).closes });
  await a.context().close();
  await ctx.close();
});

// --- Regresyon taraması (P4/P5/P6): giriş, panel, oturumlar, misafir, /indir akışı ---
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const pages: { name: string; path: string; scenario?: string; ua?: string }[] = [
  { name: "login", path: "/login" },
  { name: "panel", path: "/", scenario: "seed" },
  { name: "oturumlar-dolu", path: "/sessions", scenario: "seed" },
  { name: "oturumlar-bos", path: "/sessions", scenario: "plain" },
  { name: "oturumlar-hata", path: "/sessions", scenario: "broken" },
  { name: "sifre-degistir", path: "/change-password", scenario: "seed" },
  { name: "misafir-win-indir", path: `/session/${"A".repeat(43)}`, ua: WIN },
  { name: "misafir-mac", path: `/session/${"B".repeat(43)}` },
  { name: "misafir-suresi-doldu", path: `/session/${"E".repeat(43)}` },
  { name: "misafir-kullanildi", path: `/session/${"U".repeat(43)}` },
  { name: "yok-404", path: "/yok-boyle-sayfa" },
];
for (const pg of pages) {
  test(`tarama: ${pg.name}`, async ({ browser }) => {
    for (const [w, h] of [[1280, 800], [1440, 900], [390, 844]] as const) {
      for (const scheme of ["light", "dark"] as const) {
        const ctx: BrowserContext = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, ...(pg.ua ? { userAgent: pg.ua } : {}) });
        if (pg.scenario) await signIn(ctx, pg.scenario);
        const p = await ctx.newPage();
        track(p, `${pg.name}-${w}-${scheme}`);
        const resp = await p.goto(pg.path);
        await p.waitForLoadState("networkidle");
        rec({ kind: "status", label: `${pg.name} ${w} ${scheme}`, status: resp?.status(), url: p.url() });
        const tag = `${pg.name}-${w}-${scheme}`;
        expect.soft(await overflow(p, tag)).toBeLessThanOrEqual(0);
        expect.soft(await axe(p, tag)).toEqual([]);
        await shot(p, `t-${tag}`, w === 390);
        if (w === 1280 && scheme === "light") {
          const hrefs = await p.$$eval("a[href]", (as) => as.map((x) => (x as HTMLAnchorElement).href).filter((h) => h.startsWith("http://localhost:3217")));
          for (const href of [...new Set(hrefs)]) {
            if (href.includes("/api/v1/public/agent/download")) continue; // indirme ucu (P6 e2e'de)
            const r = await p.request.get(href, { maxRedirects: 0 }).catch(() => null);
            rec({ kind: "link", from: pg.name, href: href.replace("http://localhost:3217", ""), status: r?.status() ?? "ERR" });
          }
        }
        await ctx.close();
      }
    }
  });
}
