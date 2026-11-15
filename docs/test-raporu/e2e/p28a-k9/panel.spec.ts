// P28a K9 — konsol "Pano ve yazdırma" paneli durumları + admin yetki toggle'ları (test-operatoru, geçici; kod değil).
// Her durum: açık/koyu × proje (desktop 1440 / mobile 390). Toplanan: konsol hata/uyarı, pageerror, 5xx, axe (panel), taşma,
// aria-describedby hedefi, ekran görüntüsü. Sonuç: ./panel.jsonl, görüntü: ./shots/
import { appendFileSync, mkdirSync } from "node:fs";
import { devices, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { agentLog, agentSend, startFakeAgent } from "/Users/mennan/Projeler/Remote/apps/web/e2e/fake-agent.ts";
import { axeScan, newSession, signIn } from "/Users/mennan/Projeler/Remote/apps/web/e2e/helpers.ts";

const OUT = new URL("./shots/", import.meta.url).pathname;
const LOG = new URL("./panel.jsonl", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const UNSUP = "Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin";
const NOCTL = "Önce uzaktan kontrol izni alın";
const NOGUEST = "Müşteri bağlı değil";
const BROWSER = "Pano yalnız müşteri uygulamasında ve kontrol izniyle kullanılır";
const NOCONSENT = "Müşteri pano paylaşımına izin vermedi";
const CAN = "01JKS00000000000000000000B";

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

async function open(browser: Browser, use: unknown, scheme: "light" | "dark", scen: string) {
  const ctx: BrowserContext = await browser.newContext({ ...ctxOpts(use), colorScheme: scheme, reducedMotion: "reduce" });
  await ctx.addCookies([{ name: "rs_theme", value: scheme, domain: "localhost", path: "/" }]);
  await signIn(ctx, scen);
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
  return { ctx, p, msgs, bad };
}

async function waitingConsole(p: Page) {
  const { id, link } = await newSession(p);
  await p.goto(`/sessions/${id}/console`);
  await expect(p.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  return { id, link };
}
async function grant(p: Page, a: Page) {
  await p.getByTestId("control-request").click();
  await expect.poll(async () => (await agentLog(a)).asked).toBe(true);
  await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
  await expect(p.getByTestId("control-release")).toBeVisible();
}

async function describedOk(p: Page, testId: string) {
  const el = p.getByTestId(testId);
  if ((await el.count()) === 0) return "yok";
  const ref = await el.getAttribute("aria-describedby");
  if (!ref) return "aria-describedby yok";
  const n = await p.evaluate((id) => (document.getElementById(id)?.textContent ?? null), ref);
  return n === null ? `hedef yok (${ref})` : `ok: ${n}`;
}

async function record(p: Page, id: string, scheme: string, proj: string, msgs: string[], bad: string[], extra: object) {
  const panel = p.getByTestId("clip-print");
  const hasPanel = (await panel.count()) > 0;
  if (hasPanel) await panel.scrollIntoViewIfNeeded();
  const axe = hasPanel ? await axeScan(p, '[data-testid="clip-print"]') : await axeScan(p);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const box = hasPanel ? await panel.boundingBox() : null;
  const vw = p.viewportSize()?.width ?? 0;
  const name = `${id}-${proj}-${scheme}`;
  await p.screenshot({ path: `${OUT}${name}.png`, fullPage: false });
  if (hasPanel) await panel.screenshot({ path: `${OUT}${name}-panel.png` });
  const row = {
    id,
    scheme,
    proj,
    axe,
    overflow,
    panelRight: box ? Math.round(box.x + box.width) : null,
    vw,
    console: msgs,
    bad: bad.filter((b) => /^5/.test(b)),
    descClipPush: await describedOk(p, "clip-push"),
    descPrint: await describedOk(p, "print-pick"),
    ...extra,
  };
  appendFileSync(LOG, JSON.stringify(row) + "\n");
  expect(axe, "axe").toEqual([]);
  expect(overflow, "taşma").toBeLessThanOrEqual(0);
  if (box) expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
  expect(msgs, "konsol").toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test(`D1 müşteri yok (bekleme) ${scheme}`, async ({ browser }, info) => {
    // Yan panel yalnız canlı oturumda çizilir; "müşteri bağlı değil" müşteri ayrılınca görünür (bekleme ekranında panel yok)
    const { ctx, p, msgs, bad } = await open(browser, info.project.use, scheme, "p28");
    const { id } = await waitingConsole(p);
    await expect(p.getByTestId("clip-print")).toHaveCount(0);
    const a = await startFakeAgent(browser, id, ["rs.cap.clip1", "rs.cap.print1"]);
    await expect(p.getByTestId("console-status")).toHaveText("Aktif");
    await a.context().close();
    await expect(p.getByTestId("clip-reason")).toHaveText(NOGUEST, { timeout: 15_000 });
    await expect(p.getByTestId("print-reason")).toHaveText(NOGUEST);
    await expect(p.getByTestId("clip-push")).toBeDisabled();
    await expect(p.getByTestId("clip-pull")).toBeDisabled();
    await expect(p.getByTestId("print-pick")).toBeDisabled();
    await record(p, "d1-musteri-yok", scheme, info.project.name, msgs, bad, {});
    await ctx.close();
  });

  test(`D2 0.12 istemci (özellik yok) izin öncesi + sonrası ${scheme}`, async ({ browser }, info) => {
    const { ctx, p, msgs, bad } = await open(browser, info.project.use, scheme, "p28");
    const { id } = await waitingConsole(p);
    const a = await startFakeAgent(browser, id, []);
    await expect(p.getByTestId("console-status")).toHaveText("Aktif");
    await expect(p.getByTestId("clip-reason")).toHaveText(UNSUP);
    await expect(p.getByTestId("print-reason")).toHaveText(UNSUP);
    await expect(p.getByTestId("clip-push")).toBeDisabled();
    await expect(p.getByTestId("print-pick")).toBeDisabled();
    await record(p, "d2a-eski-istemci-izinsiz", scheme, info.project.name, msgs, bad, {});
    await grant(p, a);
    await expect(p.getByTestId("clip-reason")).toHaveText(UNSUP);
    await expect(p.getByTestId("print-reason")).toHaveText(UNSUP);
    await expect(p.getByTestId("print-pick")).toBeDisabled();
    await record(p, "d2b-eski-istemci-izinli", scheme, info.project.name, msgs, bad, {});
    await a.context().close();
    await ctx.close();
  });

  test(`D3 kontrol izni yok → kısmi (yazdırma açık, pano anahtarı kapalı) → tam ${scheme}`, async ({ browser }, info) => {
    const { ctx, p, msgs, bad } = await open(browser, info.project.use, scheme, "p28");
    const { id } = await waitingConsole(p);
    const a = await startFakeAgent(browser, id, ["rs.cap.clip1", "rs.cap.print1"]);
    await expect(p.getByTestId("console-status")).toHaveText("Aktif");
    await expect(p.getByTestId("clip-reason")).toHaveText(NOCTL);
    await expect(p.getByTestId("print-reason")).toHaveText(NOCTL);
    await expect(p.getByTestId("clip-push")).toBeDisabled();
    await expect(p.getByTestId("print-pick")).toBeDisabled();
    await record(p, "d3a-kontrol-yok", scheme, info.project.name, msgs, bad, {});
    await grant(p, a);
    await expect(p.getByTestId("clip-reason")).toHaveText(NOCONSENT);
    await expect(p.getByTestId("print-pick")).toBeEnabled();
    await expect(p.getByTestId("print-reason")).toHaveCount(0);
    await record(p, "d3b-kismi", scheme, info.project.name, msgs, bad, {});
    await agentSend(a, { t: "clip.consent", on: true });
    await expect(p.getByTestId("clip-pull")).toBeEnabled();
    await expect(p.getByTestId("clip-reason")).toHaveCount(0);
    await record(p, "d3c-tam", scheme, info.project.name, msgs, bad, {});
    await a.context().close();
    await ctx.close();
  });

  test(`D4 yetki yok (u-p7: kontrol var, pano/yazdırma yok) ${scheme}`, async ({ browser }, info) => {
    const { ctx, p, msgs, bad } = await open(browser, info.project.use, scheme, "p7");
    const { id } = await waitingConsole(p);
    const a = await startFakeAgent(browser, id, ["rs.cap.clip1", "rs.cap.print1"]);
    await expect(p.getByTestId("console-status")).toHaveText("Aktif");
    await expect(p.getByTestId("control-request")).toBeVisible();
    await expect(p.getByTestId("clip-print")).toHaveCount(0);
    await expect(p.getByText("Pano ve yazdırma")).toHaveCount(0);
    await record(p, "d4-yetki-yok", scheme, info.project.name, msgs, bad, {});
    await a.context().close();
    await ctx.close();
  });

  test(`D5 tarayıcı misafir ${scheme}`, async ({ browser }, info) => {
    const { ctx, p, msgs, bad } = await open(browser, info.project.use, scheme, "p28");
    const { link } = await waitingConsole(p);
    const gctx = await browser.newContext({ ...devices["Desktop Chrome"], colorScheme: scheme });
    const g = await gctx.newPage();
    await g.goto(`http://localhost:3217${new URL(link).pathname}`);
    await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
    await g.getByTestId("guest-name").fill("Ayşe Yılmaz");
    await g.getByTestId("guest-consent").check();
    await g.getByTestId("join-browser").click();
    const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
    await p.getByTestId("admit-input").fill(code);
    await p.getByTestId("admit-submit").click();
    await expect(p.getByTestId("console-status")).toHaveText("Aktif");
    await g.getByTestId("share-start").click();
    await expect(p.getByTestId("stage")).toHaveAttribute("data-share", "sharing", { timeout: 20_000 });
    await expect(p.getByTestId("clip-reason")).toHaveText(BROWSER, { timeout: 20_000 });
    await expect(p.getByTestId("clip-push")).toBeDisabled();
    await expect(p.getByTestId("clip-pull")).toBeDisabled();
    await expect(p.getByTestId("print-block")).toHaveCount(0);
    await expect(p.getByTestId("print-pick")).toHaveCount(0);
    await record(p, "d5-tarayici-misafir", scheme, info.project.name, msgs, bad, {});
    await gctx.close();
    await ctx.close();
  });

  test(`U1 admin kullanıcı düzenleme — Pano paylaşımı / Uzaktan yazdır toggle ${scheme}`, async ({ browser }, info) => {
    const { ctx, p, msgs, bad } = await open(browser, info.project.use, scheme, "usadm");
    const r = await p.goto(`/users/${CAN}`);
    expect(r?.status()).toBe(200);
    const clip = p.getByTestId("perm-remote_control.clipboard").filter({ visible: true });
    const prn = p.getByTestId("perm-file_transfer.print").filter({ visible: true });
    await expect(clip).toBeVisible();
    await expect(prn).toBeVisible();
    const info2 = await p.evaluate(() => {
      const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
      const pick = (tid: string) => [...document.querySelectorAll(`[data-testid="${tid}"]`)].find(vis) as HTMLElement | undefined;
      const describe = (tid: string) => {
        const el = pick(tid);
        if (!el) return null;
        // modül kapsayıcısı: tablo satırı (lg) veya kart
        let holder: Element | null = el.closest("tr");
        if (!holder) {
          holder = el.parentElement;
          while (holder && !holder.querySelector("svg.lucide")) holder = holder.parentElement;
        }
        const icons = holder ? [...holder.querySelectorAll("svg")].map((s) => s.getAttribute("class") ?? "").filter((c) => c.includes("lucide")) : [];
        return {
          label: el.getAttribute("aria-label") ?? el.textContent,
          text: (el.closest("label")?.textContent ?? el.parentElement?.textContent ?? "").trim().slice(0, 80),
          checked: el.getAttribute("aria-checked"),
          disabled: el.getAttribute("aria-disabled") ?? (el as HTMLButtonElement).disabled,
          icons,
          holderText: holder?.textContent?.trim().slice(0, 120),
        };
      };
      return { clip: describe("perm-remote_control.clipboard"), print: describe("perm-file_transfer.print") };
    });
    const body = await p.locator("body").innerText();
    const notes = {
      clipNote: body.includes("Kontrol izni verilmiş oturumda, müşteri ayrıca izin verirse düz metin panosunu gönderir ve alır."),
      printNote: body.includes("Müşterinin onayıyla PDF belgeyi müşterinin varsayılan yazıcısına gönderir (yalnız Windows uygulaması)."),
    };
    await clip.scrollIntoViewIfNeeded();
    const name = `u1-user-edit-${info.project.name}-${scheme}`;
    await p.screenshot({ path: `${OUT}${name}-toggle.png` });
    await p.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
    const axe = await axeScan(p);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    // toggle çalışıyor mu (kaydetmeden): tıkla → aria-checked değişir
    const before = await clip.getAttribute("aria-checked");
    await clip.click();
    const after = await clip.getAttribute("aria-checked");
    appendFileSync(
      LOG,
      JSON.stringify({ id: "u1-user-edit", scheme, proj: info.project.name, axe, overflow, console: msgs, bad, info: info2, notes, toggle: [before, after] }) + "\n",
    );
    expect(axe).toEqual([]);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(msgs.filter((m) => !/status of 404/.test(m))).toEqual([]);
    expect(notes.clipNote && notes.printNote).toBe(true);
    expect(before).not.toBe(after);
    await ctx.close();
  });
}
