import AxeBuilder from "@axe-core/playwright";
import { appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_COOKIE, CSRF_HEADER } from "@remote/contracts/api/auth";
import { rows } from "./helpers";

// test-operatoru P5 turu — GERÇEK server + MySQL; ölçüm odaklı (expect.soft), bulgular JSONL'e yazılır.
const BASE = "http://localhost:3228";
const PASSWORD = process.env.E2E_REAL_PASSWORD ?? "";
const LOGIN = process.env.E2E_REAL_LOGIN ?? "";
const LOGIN2 = process.env.E2E_REAL_LOGIN2 ?? "";
const OUT = process.env.P5OP_OUT ?? "p5op.jsonl";
const IMG = process.env.P5OP_IMG ?? "p5img";
const rec = (o: Record<string, unknown>) => appendFileSync(OUT, JSON.stringify({ test: test.info().title, ...o }) + "\n");

function track(p: Page, who: string) {
  p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") rec({ kind: "console", who, type: m.type(), text: m.text().slice(0, 300) }); });
  p.on("pageerror", (e) => rec({ kind: "pageerror", who, text: e.message.slice(0, 300) }));
  p.on("response", (r) => { if (r.status() >= 400) rec({ kind: "http", who, status: r.status(), url: r.url().replace(/[?#].*/, "") }); });
}
async function axe(p: Page, label: string) {
  await p.mouse.move(0, 0);
  await p.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
  const r = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const v = r.violations.map((x) => `${x.id}(${x.impact}): ${x.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  rec({ kind: "axe", label, violations: v });
  return v;
}
async function overflow(p: Page, label: string) {
  const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const wide = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>("body *")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}[${e.dataset.testid ?? e.className.toString().slice(0, 40)}]`));
  rec({ kind: "overflow", label, px: o, wide });
  return o;
}
const shot = (p: Page, n: string, full = false) => p.screenshot({ path: `${IMG}/${n}.png`, fullPage: full });

async function login(page: Page, email = LOGIN) {
  await page.goto("/login");
  await page.locator('input[name="login"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
async function cancelLeftovers(page: Page) {
  const csrf = (await page.context().cookies()).find((c) => c.name === CSRF_COOKIE)?.value ?? "";
  const headers = { [CSRF_HEADER]: csrf, Origin: BASE };
  const list = (await (await page.request.get("/api/v1/sessions?pageSize=100")).json()) as { items: { id: string; status: string }[] };
  for (const s of list.items.filter((i) => i.status === "PENDING" || i.status === "ACTIVE"))
    await page.request.post(`/api/v1/sessions/${s.id}/${s.status === "PENDING" ? "cancel" : "terminate"}`, { headers, data: {} });
}
function fakeDisplayMedia() {
  const md = navigator.mediaDevices;
  if (!md) return;
  md.getDisplayMedia = async () => {
    const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
    const x = c.getContext("2d")!; let f = 0;
    const draw = () => { f++; x.fillStyle = `hsl(${(f * 7) % 360} 60% 50%)`; x.fillRect(0, 0, 1280, 720); x.fillStyle = "#fff"; x.font = "80px sans-serif"; x.fillText(`kare ${f}`, 100 + ((f * 13) % 600), 360); };
    draw(); const timer = setInterval(draw, 33);
    const s = c.captureStream(30);
    for (const t of s.getVideoTracks()) t.addEventListener("ended", () => clearInterval(timer));
    return s;
  };
}
/** login → yeni oturum → konsol; müşteri katılır, kabul, paylaşım, DC hazır. */
async function live(page: Page, browser: Browser, opts: { scheme?: "light" | "dark"; email?: string } = {}): Promise<{ g: Page; gctx: BrowserContext }> {
  const scheme = opts.scheme ?? "light";
  track(page, "tech");
  await page.emulateMedia({ colorScheme: scheme });
  await login(page, opts.email ?? LOGIN);
  await cancelLeftovers(page);
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const dlg = page.getByTestId("new-session-dialog");
  const link = await dlg.getByTestId("session-link").inputValue();
  await dlg.getByRole("button", { name: "Kapat", exact: true }).click();
  await rows(page).first().getByTestId("open-console").click();
  await page.waitForURL(/\/console$/);
  const gctx = await browser.newContext({ colorScheme: scheme, acceptDownloads: true });
  await gctx.addInitScript(fakeDisplayMedia);
  const g = await gctx.newPage();
  track(g, "guest");
  await g.goto(link);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill("Ayşe Yılmaz");
  await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\D/g, "");
  await page.getByTestId("admit-input").fill(code);
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await g.getByTestId("share-start").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  await expect(page.getByTestId("chat-input")).toBeEnabled({ timeout: 20_000 });
  await expect(g.getByTestId("chat-input")).toBeEnabled({ timeout: 20_000 });
  return { g, gctx };
}
const side = (p: Page) => p.getByTestId("collab-side");
const gside = (g: Page) => g.getByTestId("guest-collab");
async function endSession(page: Page, g: Page) {
  await page.getByTestId("console-end").click();
  await page.getByTestId("console-confirm-ok").click();
  await expect.soft(g.getByTestId("guest-finished")).toBeVisible();
}
/** Kabul diyaloğu: varsayılan odak Reddet, Kabul kilit süresi ölçülür. */
async function checkOffer(p: Page, label: string, accept = true) {
  const dlg = p.getByTestId("file-offer");
  await expect(dlg).toBeVisible();
  const t0 = Date.now();
  const focusReject = await p.getByTestId("file-reject").evaluate((e) => e === document.activeElement);
  const disabledAtStart = await p.getByTestId("file-accept").isDisabled();
  await expect(p.getByTestId("file-accept")).toBeEnabled({ timeout: 5_000 });
  const lockMs = Date.now() - t0;
  rec({ kind: "offer", label, focusReject, disabledAtStart, lockMs, danger: (await p.getByTestId("file-danger").count()) ? await p.getByTestId("file-danger").innerText() : null });
  expect.soft(focusReject, "Reddet varsayılan odak").toBe(true);
  expect.soft(disabledAtStart, "Kabul başta kilitli").toBe(true);
  if (accept) await p.getByTestId("file-accept").click();
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

test("P5-1 sohbet iki yön + XSS + axe/375/1280 (açık)", async ({ page, browser }) => {
  const { g, gctx } = await live(page, browser);
  await expect.soft(page.getByTestId("chat-empty")).toBeVisible();
  await page.getByTestId("chat-input").fill("Merhaba, ekranınızı görüyorum.");
  await page.keyboard.press("Enter");
  await expect.soft(g.getByTestId("chat-msg")).toHaveText(["Merhaba, ekranınızı görüyorum."]);
  const xss = `<img src=x onerror="window.__rsXss=1"><script>window.__rsXss=2</script>' OR 1=1 --`;
  await g.getByTestId("chat-input").fill(xss);
  await g.getByTestId("chat-send").click();
  await expect.soft(page.getByTestId("chat-msg").last()).toHaveText(xss);
  const tags = await page.getByTestId("chat-log").locator("img, script").count();
  const xssT = await page.evaluate(() => (window as { __rsXss?: number }).__rsXss);
  const xssG = await g.evaluate(() => (window as { __rsXss?: number }).__rsXss);
  rec({ kind: "xss", tags, xssT: xssT ?? null, xssG: xssG ?? null });
  const long = "Ç".repeat(3000);
  await page.getByTestId("chat-input").fill(long);
  const maxLen = await page.getByTestId("chat-input").evaluate((e: HTMLInputElement | HTMLTextAreaElement) => e.maxLength);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  rec({ kind: "chat-long", maxLen, guestLastLen: (await g.getByTestId("chat-msg").last().innerText()).length });
  await page.getByTestId("chat-input").fill("Boş mesaj kontrolü sonrası");
  await page.getByTestId("chat-input").fill("   ");
  rec({ kind: "chat-blank", sendDisabled: await page.getByTestId("chat-send").isDisabled().catch(() => null) });
  await shot(page, "01-konsol-sohbet-1280");
  await shot(g, "02-musteri-sohbet-1280");
  await axe(page, "konsol-sohbet-light");
  await side(page).getByRole("button", { name: "Dosyalar" }).click();
  await axe(page, "konsol-dosyalar-light");
  await side(page).getByRole("button", { name: "Kalite" }).click();
  await expect(page.getByTestId("quality-panel")).toBeVisible({ timeout: 10_000 });
  await axe(page, "konsol-kalite-light");
  await axe(g, "musteri-1280-light");
  await g.setViewportSize({ width: 375, height: 780 });
  await axe(g, "musteri-375-light");
  await overflow(g, "musteri-375-light");
  await shot(g, "03-musteri-375", true);
  await page.setViewportSize({ width: 375, height: 780 });
  await overflow(page, "konsol-375-light");
  await shot(page, "04-konsol-375", true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await endSession(page, g);
  await gctx.close();
});

test("P5-2 dosya teknisyen→müşteri: kabul diyaloğu, bayt bayt", async ({ page, browser }) => {
  const { g, gctx } = await live(page, browser);
  await side(page).getByRole("button", { name: "Dosyalar" }).click();
  const limitText = await side(page).getByText(/Dosya başına en çok/).innerText().catch(() => "");
  rec({ kind: "limit", limitText });
  const body = Buffer.from(Array.from({ length: 3 * 1024 * 1024 + 17 }, (_, i) => (i * 31 + (i >> 8)) & 255));
  await page.getByTestId("file-input").setInputFiles({ name: "rapor-ğüşiöç.bin", mimeType: "application/octet-stream", buffer: body });
  await checkOffer(g, "tech→guest", false);
  await shot(g, "05-musteri-kabul-diyalogu");
  await axe(g, "musteri-kabul-diyalogu-light");
  await g.getByTestId("file-accept").click();
  const inRow = g.getByTestId("file-row").first();
  await expect(inRow).toHaveAttribute("data-status", "ok", { timeout: 30_000 });
  await expect.soft(page.getByTestId("file-row").first()).toHaveAttribute("data-status", "ok");
  const [dl] = await Promise.all([g.waitForEvent("download"), g.getByTestId("file-download").click()]);
  const got = readFileSync((await dl.path())!);
  rec({ kind: "download", dir: "tech→guest", name: dl.suggestedFilename(), size: got.length, expected: body.length, same: got.equals(body), sha: sha(got) === sha(body) });
  expect.soft(got.equals(body)).toBe(true);
  await shot(page, "06-konsol-dosyalar-ok");
  await shot(g, "07-musteri-dosyalar-ok");
  await endSession(page, g);
  await gctx.close();
});

test("P5-3 dosya müşteri→teknisyen: tehlikeli uzantı uyarısı, red, kabul, bayt bayt", async ({ page, browser }) => {
  const { g, gctx } = await live(page, browser);
  await gside(g).getByRole("button", { name: "Dosyalar" }).click();
  for (const n of ["kur.ps1", "a.js", "x.msi", "y.scr", "z.lnk", "makro.docm", "r.reg", "normal.txt"]) {
    await g.getByTestId("file-input").setInputFiles({ name: n, mimeType: "application/octet-stream", buffer: Buffer.from("x") });
    if (!(await page.getByTestId("file-offer").isVisible({ timeout: 4_000 }).catch(() => false)) && !(await page.getByTestId("file-offer").waitFor({ state: "visible", timeout: 4_000 }).then(() => true).catch(() => false))) {
      rec({ kind: "offer-missing", name: n, guestErr: await g.getByTestId("file-error").innerText({ timeout: 500 }).catch(() => null), guestRows: (await g.getByTestId("file-row").allInnerTexts()).map((x) => x.replace(/\s+/g, " ")), guestInputDisabled: await g.getByTestId("file-input").isDisabled().catch(() => null) });
      await g.screenshot({ path: `${IMG}/20-musteri-teklif-gitmedi.png`, fullPage: true });
      continue;
    }
    const d = (await page.getByTestId("file-danger").count()) ? await page.getByTestId("file-danger").innerText() : null;
    rec({ kind: "danger-ext", name: n, warned: !!d, text: d });
    // Ret 30 sn otomatik-ret penceresi açar (tasarım) → uyarı okunduktan sonra kabul edilir
    await expect(page.getByTestId("file-accept")).toBeEnabled();
    await page.getByTestId("file-accept").click();
    await expect(page.getByTestId("file-offer")).toBeHidden();
    await expect(g.getByTestId("file-row").filter({ hasText: n }).first()).toHaveAttribute("data-status", "ok", { timeout: 10_000 });
  }
  // Aktarım sürerken ikinci gönderim (busy) — kullanıcıya ne gösteriliyor
  await g.getByTestId("file-input").setInputFiles({ name: "b1.txt", mimeType: "text/plain", buffer: Buffer.from("1") });
  await g.getByTestId("file-input").setInputFiles({ name: "b2.txt", mimeType: "text/plain", buffer: Buffer.from("2") });
  await g.waitForTimeout(300);
  rec({ kind: "busy", guestErr: await g.getByTestId("file-error").innerText({ timeout: 500 }).catch(() => null) });
  await checkOffer(page, "b1");
  await expect(g.getByTestId("file-row").filter({ hasText: "b1.txt" }).first()).toHaveAttribute("data-status", "ok", { timeout: 10_000 });
  await g.getByTestId("file-input").setInputFiles({ name: "fatura.pdf.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await checkOffer(page, "guest→tech çift uzantı", false);
  await shot(page, "08-konsol-tehlikeli-uzanti");
  await page.getByTestId("file-reject").click();
  await expect.soft(g.getByTestId("file-row").filter({ hasText: "fatura.pdf.exe" })).toHaveAttribute("data-status", "rejected");
  await g.getByTestId("file-input").setInputFiles({ name: "ret-sonrasi.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await page.waitForTimeout(1500);
  rec({ kind: "autoreject", offerVisible: await page.getByTestId("file-offer").isVisible(), guestRow: await g.getByTestId("file-row").filter({ hasText: "ret-sonrasi" }).innerText().catch(() => null) });
  await page.waitForTimeout(30_000);
  const body = Buffer.from(Array.from({ length: 1024 * 1024 + 5 }, (_, i) => (i * 7) & 255));
  await g.getByTestId("file-input").setInputFiles({ name: "log-kaydi.zip", mimeType: "application/zip", buffer: body });
  await checkOffer(page, "guest→tech");
  const row = page.getByTestId("file-row").filter({ hasText: "log-kaydi.zip" });
  await expect(row).toHaveAttribute("data-status", "ok", { timeout: 30_000 });
  const [dl] = await Promise.all([page.waitForEvent("download"), row.getByTestId("file-download").click()]);
  const got = readFileSync((await dl.path())!);
  rec({ kind: "download", dir: "guest→tech", name: dl.suggestedFilename(), size: got.length, expected: body.length, same: got.equals(body) });
  expect.soft(got.equals(body)).toBe(true);
  await endSession(page, g);
  await gctx.close();
});

test("P5-4 iptal: büyük dosyada alıcı iptali", async ({ page, browser }) => {
  const { g, gctx } = await live(page, browser);
  await side(page).getByRole("button", { name: "Dosyalar" }).click();
  const limitText = await side(page).getByText(/Dosya başına en çok/).innerText().catch(() => "");
  const mb = Math.min(Number(/(\d+)\s*MB/.exec(limitText)?.[1] ?? 10), 100);
  const { writeFileSync } = await import("node:fs");
  const big = `${process.env.P5OP_TMP}/buyuk.iso`;
  writeFileSync(big, Buffer.alloc(mb * 1024 * 1024 - 1024, 7));
  await page.getByTestId("file-input").setInputFiles(big);
  await checkOffer(g, "cancel");
  const gIn = g.getByTestId("file-row").first();
  const tOut = page.getByTestId("file-row").first();
  const st0 = await gIn.getAttribute("data-status");
  if (st0 === "receiving" || st0 === "pending") {
    await shot(g, "09-musteri-alim-ilerleme");
    await gIn.getByTestId("file-cancel").click().catch(() => {});
  }
  await page.waitForTimeout(1500);
  rec({ kind: "cancel", mb, st0, guest: await gIn.getAttribute("data-status"), tech: await tOut.getAttribute("data-status"), gText: await gIn.innerText(), dlCount: await g.getByTestId("file-download").count() });
  // aşırı büyük
  const over = `${process.env.P5OP_TMP}/asiri.bin`;
  writeFileSync(over, Buffer.alloc(mb * 1024 * 1024 + 1));
  await page.getByTestId("file-input").setInputFiles(over);
  rec({ kind: "oversize", err: await page.getByTestId("file-error").innerText().catch(() => null) });
  await endSession(page, g);
  await gctx.close();
});

test("P5-5 kalite paneli + işaretleme/lazer müşteri önizlemesi + PiP", async ({ page, browser }) => {
  const { g, gctx } = await live(page, browser);
  await side(page).getByRole("button", { name: "Kalite" }).click();
  const panel = page.getByTestId("quality-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect.soft(panel.locator("dd").first()).toHaveText(/^\d+ FPS$/, { timeout: 15_000 });
  await page.waitForTimeout(3000);
  rec({ kind: "quality", text: (await panel.innerText()).replace(/\s+/g, " ") });
  await shot(page, "10-konsol-kalite");
  const layer = page.getByTestId("annot-layer");
  const glayer = g.getByTestId("annot-layer");
  const box = (await layer.boundingBox())!;
  const drag = async (dx: number) => { await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3); await page.mouse.down(); await page.mouse.move(box.x + box.width * (0.4 + dx), box.y + box.height * 0.5, { steps: 6 }); await page.mouse.up(); };
  await page.getByTestId("annot-pen").click();
  await drag(0);
  await page.getByTestId("annot-rect").click();
  await page.getByRole("button", { name: "Mavi" }).click().catch(() => rec({ kind: "note", text: "Mavi renk butonu yok" }));
  await drag(0.2);
  await expect.soft(glayer).toHaveAttribute("data-strokes", "2");
  await shot(page, "11-konsol-isaretleme");
  await shot(g, "12-musteri-isaretleme-onizleme");
  await page.getByTestId("annot-undo").click();
  await expect.soft(glayer).toHaveAttribute("data-strokes", "1");
  await page.getByTestId("annot-clear").click();
  await expect.soft(glayer).toHaveAttribute("data-strokes", "0");
  await page.getByTestId("annot-laser").click();
  for (const f of [0.2, 0.4, 0.6]) { await page.mouse.move(box.x + box.width * f, box.y + box.height * f, { steps: 3 }); await page.waitForTimeout(80); }
  const laser = await glayer.getAttribute("data-laser");
  await shot(g, "13-musteri-lazer");
  await page.waitForTimeout(2500);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(2000);
  const laserOut = await glayer.getAttribute("data-laser");
  rec({ kind: "annot", laserOut, laserDuring: laser, laserAfter2_5s: await glayer.getAttribute("data-laser"), techStrokesAfterLaser: await layer.getAttribute("data-strokes") });
  const pip = await g.evaluate(() => typeof (window as { documentPictureInPicture?: unknown }).documentPictureInPicture);
  const btn = await g.getByTestId("pip-open").count();
  let opened = false;
  if (btn) {
    await g.getByTestId("pip-open").click();
    opened = await g.getByTestId("pip-close").isVisible({ timeout: 5_000 }).catch(() => false);
    if (opened) { await shot(g, "14-musteri-pip-acik"); await g.getByTestId("pip-close").click(); }
  }
  await g.waitForTimeout(1500);
  rec({ kind: "pip", api: pip, button: btn, opened, previewBack: await g.getByTestId("guest-preview").count(), pipOpenBack: await g.getByTestId("pip-open").count(), strokesAfter: await g.getByTestId("annot-layer").count() });
  await shot(g, "14b-musteri-pip-kapandi");
  await endSession(page, g);
  await gctx.close();
});

test("P5-6 yetkisiz (file_transfer kapalı): müşteride Dosyalar yok", async ({ page, browser }) => {
  const { g, gctx } = await live(page, browser, { email: LOGIN2 });
  const tab = await gside(g).getByRole("button", { name: "Dosyalar" }).count();
  const inp = await g.getByTestId("file-input").count();
  await side(page).getByRole("button", { name: "Dosyalar" }).click();
  const denied = await page.getByTestId("files-denied").innerText().catch(() => null);
  rec({ kind: "noperm", guestTab: tab, guestInput: inp, consoleDenied: denied, consoleSend: await page.getByTestId("file-send").count(), consoleInput: await page.getByTestId("file-input").count() });
  expect.soft(tab).toBe(0);
  await shot(page, "15-konsol-dosya-yetkisiz");
  await shot(g, "16-musteri-dosya-sekmesi-yok");
  await endSession(page, g);
  await gctx.close();
});

test("P5-7 koyu tema: axe konsol + müşteri, 375 taşma", async ({ page, browser }) => {
  const { g, gctx } = await live(page, browser, { scheme: "dark" });
  await page.getByTestId("chat-input").fill("Koyu tema kontrol");
  await page.keyboard.press("Enter");
  await expect(g.getByTestId("chat-msg")).toHaveCount(1);
  await axe(page, "konsol-sohbet-dark");
  await side(page).getByRole("button", { name: "Dosyalar" }).click();
  await axe(page, "konsol-dosyalar-dark");
  await side(page).getByRole("button", { name: "Kalite" }).click();
  await expect(page.getByTestId("quality-panel")).toBeVisible({ timeout: 10_000 });
  await axe(page, "konsol-kalite-dark");
  await shot(page, "17-konsol-koyu-1280");
  await axe(g, "musteri-1280-dark");
  await shot(g, "18-musteri-koyu-1280");
  await g.setViewportSize({ width: 375, height: 780 });
  await axe(g, "musteri-375-dark");
  await overflow(g, "musteri-375-dark");
  await side(page).getByRole("button", { name: "Dosyalar" }).click();
  await page.getByTestId("file-input").setInputFiles({ name: "arac.bat", mimeType: "application/octet-stream", buffer: Buffer.from("@echo off") });
  await expect(g.getByTestId("file-offer")).toBeVisible();
  await expect(g.getByTestId("file-reject")).toBeEnabled();
  await axe(g, "musteri-375-kabul-dark");
  await overflow(g, "musteri-375-kabul-dark");
  await shot(g, "19-musteri-375-koyu-kabul", true);
  await g.getByTestId("file-reject").click();
  await page.setViewportSize({ width: 375, height: 780 });
  await overflow(page, "konsol-375-dark");
  await axe(page, "konsol-375-dark");
  await endSession(page, g);
  await gctx.close();
});
