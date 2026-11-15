// P28a K9 ek — konsolun AÇIK teması + iskelet durumu (test-operatoru, geçici; kod değil).
// Sahte kullanıcıların DB tercihi "Sistem" → konsol tasarım gereği koyu (DESIGN §8). "Açık" tercihini, uygulamanın kendi
// uyguladığı biçimde (`applyThemeToDocument`: <html class="light"> + data-theme) sayfada kurup panel durumlarını tarar.
import { appendFileSync, mkdirSync } from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { agentLog, agentSend, startFakeAgent } from "/Users/mennan/Projeler/Remote/apps/web/e2e/fake-agent.ts";
import { axeScan, newSession, signIn } from "/Users/mennan/Projeler/Remote/apps/web/e2e/helpers.ts";

const OUT = new URL("./shots/", import.meta.url).pathname;
const LOG = new URL("./panel-acik.jsonl", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

async function light(p: Page) {
  await p.evaluate(() => {
    const r = document.documentElement;
    r.classList.remove("dark");
    r.classList.add("light");
    r.dataset.theme = "light";
  });
  await p.waitForTimeout(150);
}
async function shot(p: Page, id: string, proj: string, msgs: string[]) {
  await light(p);
  const panel = p.getByTestId("clip-print");
  await panel.scrollIntoViewIfNeeded();
  const bg = await p.evaluate(() => getComputedStyle(document.querySelector('[data-testid="collab-side"]')!).backgroundColor);
  const axe = await axeScan(p, '[data-testid="clip-print"]');
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await p.screenshot({ path: `${OUT}${id}-${proj}-ACIK.png` });
  await panel.screenshot({ path: `${OUT}${id}-${proj}-ACIK-panel.png` });
  appendFileSync(LOG, JSON.stringify({ id, proj, bg, axe, overflow, console: msgs }) + "\n");
  expect(axe).toEqual([]);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("açık konsol: eski istemci, kontrol yok, kısmi, tam", async ({ browser }, info) => {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: "http://localhost:3217", reducedMotion: "reduce" });
  await signIn(ctx, "p28");
  const p = await ctx.newPage();
  const msgs: string[] = [];
  p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && msgs.push(m.text()));
  p.on("pageerror", (e) => msgs.push(e.message));
  // eski istemci
  let s = await newSession(p);
  await p.goto(`/sessions/${s.id}/console`);
  await expect(p.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  let a = await startFakeAgent(browser, s.id, []);
  await expect(p.getByTestId("clip-reason")).toContainText("desteklemiyor");
  await shot(p, "L-d2-eski", info.project.name, msgs);
  await a.context().close();
  // kontrol yok → kısmi → tam
  s = await newSession(p);
  await p.goto(`/sessions/${s.id}/console`);
  await expect(p.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  a = await startFakeAgent(browser, s.id, ["rs.cap.clip1", "rs.cap.print1"]);
  await expect(p.getByTestId("clip-reason")).toHaveText("Önce uzaktan kontrol izni alın");
  await shot(p, "L-d3a-kontrol-yok", info.project.name, msgs);
  await p.getByTestId("control-request").click();
  await expect.poll(async () => (await agentLog(a)).asked).toBe(true);
  await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
  await expect(p.getByTestId("clip-reason")).toHaveText("Müşteri pano paylaşımına izin vermedi");
  await shot(p, "L-d3b-kismi", info.project.name, msgs);
  await agentSend(a, { t: "clip.consent", on: true });
  await expect(p.getByTestId("clip-pull")).toBeEnabled();
  await shot(p, "L-d3c-tam", info.project.name, msgs);
  await a.context().close();
  expect(msgs).toEqual([]);
  await ctx.close();
});

test("tarayıcı misafir: kabul sonrası paylaşım öncesi (iskelet?) + paylaşım sonrası, açık", async ({ browser }, info) => {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: "http://localhost:3217", reducedMotion: "reduce" });
  await signIn(ctx, "p28");
  const p = await ctx.newPage();
  const msgs: string[] = [];
  p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && msgs.push(m.text()));
  const s = await newSession(p);
  await p.goto(`/sessions/${s.id}/console`);
  const g = await (await browser.newContext({ ...devices["Desktop Chrome"] })).newPage();
  await g.goto(`http://localhost:3217${new URL(s.link).pathname}`);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill("Ayşe Yılmaz");
  await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
  await p.getByTestId("admit-input").fill(code);
  await p.getByTestId("admit-submit").click();
  await expect(p.getByTestId("console-status")).toHaveText("Aktif");
  await p.waitForTimeout(3000);
  const pre = {
    panel: await p.getByTestId("clip-print").count(),
    loading: await p.getByTestId("clip-print-loading").count(),
    reason: await p.getByTestId("clip-reason").allInnerTexts(),
    busy: await p.getByTestId("clip-print").getAttribute("aria-busy").catch(() => null),
  };
  if (pre.panel) {
    await light(p);
    await p.getByTestId("clip-print").scrollIntoViewIfNeeded();
    await p.getByTestId("clip-print").screenshot({ path: `${OUT}L-d5-paylasim-oncesi-${info.project.name}-ACIK-panel.png` });
  }
  const preAxe = pre.panel ? await axeScan(p, '[data-testid="clip-print"]') : [];
  await g.getByTestId("share-start").click();
  await expect(p.getByTestId("clip-reason")).toHaveText("Pano yalnız müşteri uygulamasında ve kontrol izniyle kullanılır", { timeout: 20_000 });
  await shot(p, "L-d5-tarayici", info.project.name, msgs);
  appendFileSync(LOG, JSON.stringify({ id: "d5-pre-share", proj: info.project.name, pre, preAxe }) + "\n");
  expect(preAxe).toEqual([]);
  await ctx.close();
});
