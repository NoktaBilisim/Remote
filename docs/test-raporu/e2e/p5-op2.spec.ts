import AxeBuilder from "@axe-core/playwright";
import { appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_COOKIE, CSRF_HEADER } from "@remote/contracts/api/auth";
import { rows } from "./helpers";

// test-operatoru P5 tur 2 (dar kapsam; build NEXT_PUBLIC_RS_E2E=1 — yalnız __rsNoSelfThrottle/__rsSlowFileMs kancaları için) — GERÇEK server + MySQL; ölçüm odaklı (expect.soft), bulgular JSONL'e yazılır.
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


const W = (g: Page, k: string, v: unknown) => g.evaluate(([k, v]) => { (globalThis as Record<string, unknown>)[k as string] = v; }, [k, v] as const);
async function sendG(g: Page, name: string, buf = Buffer.from("x")) {
  await g.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: buf });
}
async function acceptAt(page: Page, g: Page, name: string) {
  await expect(page.getByTestId("file-offer")).toBeVisible({ timeout: 6_000 });
  const d = (await page.getByTestId("file-danger").count()) ? await page.getByTestId("file-danger").innerText() : null;
  rec({ kind: "danger-ext", name, warned: !!d, text: d?.replace(/\s+/g, " ") ?? null });
  await expect(page.getByTestId("file-accept")).toBeEnabled();
  await page.getByTestId("file-accept").click();
  await expect(page.getByTestId("file-offer")).toBeHidden();
  await expect(g.getByTestId("file-row").filter({ hasText: name }).first()).toHaveAttribute("data-status", "ok", { timeout: 15_000 });
}

test("T2-1 TEST-P5-1 gönderen öz-sınırı + .scr/.lnk/.docm/.reg + 1 MB bayt bayt", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const { g, gctx } = await live(page, browser);
  await gside(g).getByRole("button", { name: "Dosyalar" }).click();
  const t0 = Date.now();
  for (const n of ["kur.ps1", "a.js", "x.msi"]) { await sendG(g, n); await acceptAt(page, g, n); }
  await sendG(g, "y.scr");
  await g.waitForTimeout(500);
  const err = await g.getByTestId("file-error").innerText({ timeout: 1000 }).catch(() => null);
  const offerAtTech = await page.getByTestId("file-offer").isVisible();
  const rowY = await g.getByTestId("file-row").filter({ hasText: "y.scr" }).count();
  rec({ kind: "rate-4th", ms: Date.now() - t0, err, offerAtTech, rowY });
  await shot(g, "t2-01-musteri-sinir-uyarisi");
  expect.soft(err ?? "").toContain("en çok 3");
  expect.soft(offerAtTech).toBe(false);
  await g.waitForTimeout(Math.max(0, 11_500 - (Date.now() - t0)));
  for (const n of ["y.scr", "z.lnk", "makro.docm"]) { await sendG(g, n); await acceptAt(page, g, n); }
  await g.waitForTimeout(11_500);
  await sendG(g, "r.reg"); await acceptAt(page, g, "r.reg");
  await sendG(g, "normal.txt"); await acceptAt(page, g, "normal.txt");
  await shot(page, "t2-02-konsol-uyarilar-sonrasi");
  await g.waitForTimeout(11_500);
  const body = Buffer.from(Array.from({ length: 1024 * 1024 + 5 }, (_, i) => (i * 7 + (i >> 9)) & 255));
  await sendG(g, "log-kaydi.zip", body);
  await acceptAt(page, g, "log-kaydi.zip");
  const row = page.getByTestId("file-row").filter({ hasText: "log-kaydi.zip" });
  await expect(row).toHaveAttribute("data-status", "ok", { timeout: 30_000 });
  const [dl] = await Promise.all([page.waitForEvent("download"), row.getByTestId("file-download").click()]);
  const got = readFileSync((await dl.path())!);
  rec({ kind: "download", dir: "guest→tech", name: dl.suggestedFilename(), size: got.length, expected: body.length, same: got.equals(body), sha: sha(got) === sha(body) });
  expect.soft(got.equals(body)).toBe(true);
  await endSession(page, g);
  await gctx.close();
});

test("T2-2 TEST-P5-1 alıcıda düşen teklif → 30 sn 'Yanıt yok' → yeni gönderim; offered iptali", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { g, gctx } = await live(page, browser);
  await gside(g).getByRole("button", { name: "Dosyalar" }).click();
  await W(g, "__rsNoSelfThrottle", true);
  for (const n of ["d1.txt", "d2.txt", "d3.txt"]) { await sendG(g, n); await acceptAt(page, g, n); }
  const t4 = Date.now();
  await sendG(g, "d4.txt");
  const r4 = g.getByTestId("file-row").filter({ hasText: "d4.txt" }).first();
  await expect(r4).toHaveAttribute("data-status", "offered");
  const offerVisible = await page.getByTestId("file-offer").isVisible({ timeout: 3_000 }).catch(() => false);
  await sendG(g, "d5.txt");
  await g.waitForTimeout(300);
  const busyErr = await g.getByTestId("file-error").innerText({ timeout: 500 }).catch(() => null);
  await expect(r4).toHaveAttribute("data-status", "timeout", { timeout: 40_000 });
  const tMs = Date.now() - t4;
  const txt = (await r4.innerText()).replace(/\s+/g, " ");
  const techRows = (await page.getByTestId("file-row").allInnerTexts()).map((x) => x.replace(/\s+/g, " "));
  rec({ kind: "timeout", offerVisible, busyErr, tMs, txt, techRows });
  await shot(g, "t2-03-musteri-yanit-yok");
  await sendG(g, "sonra.txt");
  await acceptAt(page, g, "sonra.txt");
  rec({ kind: "after-timeout-send", ok: true, err: await g.getByTestId("file-error").innerText({ timeout: 300 }).catch(() => null) });
  // offered satırında gönderen iptali kilidi açıyor mu
  await g.waitForTimeout(11_000);
  for (const n of ["e1.txt", "e2.txt", "e3.txt"]) { await sendG(g, n); await acceptAt(page, g, n); }
  await sendG(g, "e4.txt");
  const r5 = g.getByTestId("file-row").filter({ hasText: "e4.txt" }).first();
  await expect(r5).toHaveAttribute("data-status", "offered");
  await page.waitForTimeout(1500);
  await r5.getByTestId("file-cancel").click();
  await expect.soft(r5).toHaveAttribute("data-status", "cancelled", { timeout: 5_000 });
  await g.waitForTimeout(10_000);
  await sendG(g, "iptal-sonrasi.txt");
  const okAfterCancel = await page.getByTestId("file-offer").waitFor({ state: "visible", timeout: 6_000 }).then(() => true).catch(() => false);
  rec({ kind: "offered-cancel", st: await r5.getAttribute("data-status"), okAfterCancel, techRows: (await page.getByTestId("file-row").allInnerTexts()).map((x) => x.replace(/\s+/g, " ")).slice(0, 3) });
  if (okAfterCancel) { await page.getByTestId("file-accept").click({ timeout: 5_000 }).catch(() => {}); }
  await endSession(page, g);
  await gctx.close();
});

test("T2-3 gönderen iptali (aktarım sırasında, iki yön)", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const { g, gctx } = await live(page, browser);
  await gside(g).getByRole("button", { name: "Dosyalar" }).click();
  await side(page).getByRole("button", { name: "Dosyalar" }).click();
  for (const [who, from, to] of [["guest", g, page], ["tech", page, g]] as const) {
    await W(from, "__rsSlowFileMs", 40);
    const body = Buffer.alloc(2 * 1024 * 1024, 3);
    await from.getByTestId("file-input").setInputFiles({ name: `iptal-${who}.bin`, mimeType: "application/octet-stream", buffer: body });
    await expect(to.getByTestId("file-accept")).toBeEnabled({ timeout: 8_000 });
    await to.getByTestId("file-accept").click();
    const out = from.getByTestId("file-row").filter({ hasText: `iptal-${who}.bin` }).first();
    await expect(out).toHaveAttribute("data-status", "sending", { timeout: 10_000 });
    await from.waitForTimeout(800);
    await out.getByTestId("file-cancel").click();
    await from.waitForTimeout(1500);
    const inn = to.getByTestId("file-row").filter({ hasText: `iptal-${who}.bin` }).first();
    rec({ kind: "sender-cancel", who, out: await out.getAttribute("data-status"), in: await inn.getAttribute("data-status"), inText: (await inn.innerText()).replace(/\s+/g, " "), dl: await inn.getByTestId("file-download").count() });
    expect.soft(await out.getAttribute("data-status")).toBe("cancelled");
    expect.soft(await inn.getAttribute("data-status")).toBe("cancelled");
    await W(from, "__rsSlowFileMs", 0);
    await from.waitForTimeout(31_000); // karşı tarafın iptal sonrası otomatik ret penceresi olabilir
    await from.getByTestId("file-input").setInputFiles({ name: `sonra-${who}.txt`, mimeType: "text/plain", buffer: Buffer.from("ok") });
    const offered = await to.getByTestId("file-offer").waitFor({ state: "visible", timeout: 6_000 }).then(() => true).catch(() => false);
    rec({ kind: "after-sender-cancel", who, offered, err: await from.getByTestId("file-error").innerText({ timeout: 300 }).catch(() => null) });
    if (offered) { await expect(to.getByTestId("file-accept")).toBeEnabled(); await to.getByTestId("file-accept").click(); }
    await from.waitForTimeout(1000);
  }
  await shot(g, "t2-04-musteri-gonderen-iptal");
  await endSession(page, g);
  await gctx.close();
});

test("T2-4 TEST-P5-2/3 sohbet günlüğü odak + axe açık + uzun kelime", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const { g, gctx } = await live(page, browser);
  for (let i = 0; i < 8; i++) { await page.getByTestId("chat-input").fill(`Mesaj ${i + 1} — kontrol`); await page.keyboard.press("Enter"); await page.waitForTimeout(250); }
  // not: alıcı chat sınırı 5/sn (rate.ts IN_LIMITS) — aşan mesaj gönderende görünür, alıcıda sessizce düşer
  await page.getByTestId("chat-input").fill("Ç".repeat(2000));
  await page.keyboard.press("Enter");
  await expect(g.getByTestId("chat-msg")).toHaveCount(9);
  await g.getByTestId("chat-input").fill("Ş".repeat(2000));
  await g.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-msg")).toHaveCount(10);
  const measure = async (p: Page, label: string) => {
    const r = await p.evaluate(() => {
      const log = document.querySelector<HTMLElement>('[data-testid="chat-log"]')!;
      const msgs = [...document.querySelectorAll<HTMLElement>('[data-testid="chat-msg"]')];
      return { tabIndex: log.tabIndex, scrollable: log.scrollHeight > log.clientHeight, clipped: msgs.filter((m) => m.scrollWidth > m.clientWidth + 1).length, logOverflowX: log.scrollWidth - log.clientWidth, maxMsgW: Math.max(...msgs.map((m) => m.getBoundingClientRect().width)), logW: log.getBoundingClientRect().width };
    });
    rec({ kind: "chat-measure", label, ...r });
    return r;
  };
  const tabTo = async (p: Page, label: string) => {
    await p.locator("body").click({ position: { x: 2, y: 2 } }).catch(() => {});
    let hit = -1;
    for (let i = 0; i < 40; i++) { await p.keyboard.press("Tab"); if (await p.evaluate(() => document.activeElement?.getAttribute("data-testid") === "chat-log")) { hit = i + 1; break; } }
    const outline = hit > 0 ? await p.evaluate(() => { const s = getComputedStyle(document.activeElement!); return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`; }) : null;
    let scrolled = null;
    if (hit > 0) { const b = await p.evaluate(() => document.activeElement!.scrollTop); await p.keyboard.press("Home"); await p.waitForTimeout(200); scrolled = { before: b, afterHome: await p.evaluate(() => document.activeElement!.scrollTop) }; }
    rec({ kind: "tab-focus", label, tabs: hit, outline, scrolled });
    return hit;
  };
  const g1 = await measure(g, "musteri-1280");
  expect.soft(g1.clipped).toBe(0);
  expect.soft(await tabTo(g, "musteri-1280")).toBeGreaterThan(0);
  await shot(g, "t2-05-musteri-gunluk-odak-1280");
  const v1 = await axe(g, "t2-musteri-1280-light");
  await g.setViewportSize({ width: 375, height: 780 });
  const g2 = await measure(g, "musteri-375");
  const v2 = await axe(g, "t2-musteri-375-light");
  await overflow(g, "t2-musteri-375-light");
  await shot(g, "t2-06-musteri-375-uzun-kelime");
  const c1 = await measure(page, "konsol-1280");
  expect.soft(await tabTo(page, "konsol-1280")).toBeGreaterThan(0);
  const v3 = await axe(page, "t2-konsol-sohbet-light");
  await shot(page, "t2-07-konsol-uzun-kelime-1280");
  expect.soft(v1).toEqual([]); expect.soft(v2).toEqual([]); expect.soft(v3).toEqual([]);
  expect.soft(g2.clipped + c1.clipped).toBe(0);
  await endSession(page, g);
  await gctx.close();
});
