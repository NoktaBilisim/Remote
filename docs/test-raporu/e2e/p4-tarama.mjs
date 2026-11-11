// P4 sayfa testi (test-operatoru) — GERÇEK apps/server + MySQL + standalone web'e karşı keşif taraması.
// Çalıştırma (apps/web dizininden, server :3302 + web :3218 ayakta):
//   E2E_REAL_LOGIN=… E2E_REAL_LOGIN2=… E2E_REAL_PASSWORD=… OUT=<json> SHOTS=<dir> node ../../docs/test-raporu/e2e/p4-tarama.mjs
// Her sayfa: konsol hata/uyarı, pageerror, ≥400 yanıt, kırık iç link, axe (WCAG 2.1 AA) açık+koyu, 375 px taşma.
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
const require = createRequire(process.cwd() + "/package.json");
const { chromium, devices } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const BASE = "http://localhost:3218";
const { E2E_REAL_LOGIN: L1, E2E_REAL_LOGIN2: L2, E2E_REAL_PASSWORD: PW } = process.env;
const SHOTS = process.env.SHOTS; mkdirSync(SHOTS, { recursive: true });
const R = { pages: {}, flows: [], net: [], console: [] };
const flow = (name, ok, note = "") => { R.flows.push({ name, ok, note }); console.log(ok ? "OK  " : "FAIL", name, note); };

function watch(page, tag) {
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) R.console.push({ tag, type: m.type(), text: m.text().slice(0, 300), url: page.url() }); });
  page.on("pageerror", (e) => R.console.push({ tag, type: "pageerror", text: e.message.slice(0, 300), url: page.url() }));
  page.on("response", (r) => { if (r.status() >= 400) R.net.push({ tag, status: r.status(), url: r.url().replace(/session\/[^/?]+/, "session/<token>"), from: page.url().replace(/session\/[^/?]+/, "session/<token>") }); });
}

async function axe(page) {
  await page.mouse.move(0, 0).catch(() => {});
  await page.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  return r.violations.map((v) => `${v.id}(${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function links(page) {
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  const bad = [];
  for (const h of [...new Set(hrefs)]) {
    if (!h || !h.startsWith("/")) continue;
    const r = await page.request.get(BASE + h, { maxRedirects: 5 }).catch((e) => ({ status: () => "ERR " + e.message }));
    if (typeof r.status() !== "number" || r.status() >= 400) bad.push(`${h} → ${r.status()}`);
  }
  return { count: hrefs.length, bad };
}

/** Sayfayı açık + koyu + 375 px'te denetler; ekran görüntüsü opsiyonel. */
async function audit(page, key, shot) {
  const res = { url: page.url().replace(/session\/[^/?]+/, "session/<token>") };
  const vp = page.viewportSize();
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    res[`axe_${scheme}`] = await axe(page);
    if (shot) await page.screenshot({ path: `${SHOTS}/${shot}-${scheme}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 375, height: 780 });
  await page.waitForTimeout(200);
  res.overflow375 = await overflow(page);
  if (shot) await page.screenshot({ path: `${SHOTS}/${shot}-375.png`, fullPage: true });
  await page.setViewportSize(vp);
  await page.emulateMedia({ colorScheme: "light" });
  res.links = await links(page);
  R.pages[key] = res;
  console.log("PAGE", key, JSON.stringify({ a11yL: res.axe_light.length, a11yD: res.axe_dark.length, of: res.overflow375, bad: res.links.bad }));
}

async function login(page, email) {
  await page.goto(BASE + "/login");
  await page.locator('input[name="login"]').fill(email);
  await page.locator('input[name="password"]').fill(PW);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}
const rows = (p) => p.locator('[data-testid="session-row"], [data-testid="session-card"]').filter({ visible: true });

async function newSession(page) {
  await page.goto(BASE + "/sessions");
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const dlg = page.getByTestId("new-session-dialog");
  const link = await dlg.getByTestId("session-link").inputValue();
  return { dlg, link };
}
async function closeDlgOpenConsole(page, dlg) {
  await dlg.getByRole("button", { name: "Kapat", exact: true }).click();
  await rows(page).first().getByTestId("open-console").click();
  await page.waitForURL(/\/console$/);
  await page.getByTestId("stage").getByText("Müşteri bekleniyor").waitFor();
}
async function joinLobby(g, name) {
  await g.locator('[data-testid="join-form"][data-ready="true"]').waitFor();
  await g.getByTestId("guest-name").fill(name);
  await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  await g.getByTestId("guest-lobby").waitFor({ timeout: 10000 });
  return ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\D/g, "");
}
async function admit(page, code) {
  await page.getByTestId("admit-input").fill(code);
  await page.getByTestId("admit-submit").click();
  await page.getByTestId("console-status").getByText("Aktif").waitFor({ timeout: 10000 });
}
async function step(name, fn) { try { await fn(); } catch (e) { flow(name, false, "İSTİSNA: " + e.message.split("\n")[0].slice(0, 200)); } }

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--auto-accept-this-tab-capture"] });
const desk = { ...devices["Desktop Chrome"] };
const tctx = await browser.newContext(desk);
const t = await tctx.newPage(); watch(t, "tech");

// 1) Yetkisiz erişim + login
await step("yetkisiz /sessions → login", async () => {
  await t.goto(BASE + "/sessions");
  flow("yetkisiz /sessions → /login?next=", /\/login\?next=%2Fsessions/.test(t.url()), t.url().replace(BASE, ""));
});
await step("login sayfası", async () => { await t.goto(BASE + "/login"); await audit(t, "login", "01-login"); });
await step("hatalı giriş", async () => {
  await t.locator('input[name="login"]').fill(L1); await t.locator('input[name="password"]').fill("yanlis-parola-123");
  await t.locator('form button[type="submit"]').click();
  await t.getByRole("alert").first().waitFor({ timeout: 8000 });
  flow("hatalı parola → genel hata, login'de kalır", t.url().includes("/login"), (await t.getByRole("alert").first().innerText()).slice(0, 80));
});
await step("boş form", async () => {
  await t.goto(BASE + "/login"); await t.locator('form button[type="submit"]').click(); await t.waitForTimeout(500);
  flow("boş login formu → alan hatası", t.url().includes("/login") && (await t.locator("[aria-invalid=true]").count()) > 0);
});
await step("login ok", async () => { await login(t, L1); flow("giriş (tech1)", true, t.url().replace(BASE, "")); });
await step("ana sayfa", async () => { await t.goto(BASE + "/"); await audit(t, "panel-ana", "02-panel"); });
await step("oturumlar", async () => { await t.goto(BASE + "/sessions"); await t.waitForTimeout(500); await audit(t, "sessions", "03-sessions"); });
await step("change-password", async () => { await t.goto(BASE + "/change-password"); await audit(t, "change-password"); });
await step("404", async () => { const r = await t.goto(BASE + "/yok-boyle-bir-sayfa"); flow("bilinmeyen rota → 404", r.status() === 404, String(r.status())); await audit(t, "404"); });
await step("yabancı konsol id", async () => {
  const r = await t.goto(BASE + "/sessions/01ZZZZZZZZZZZZZZZZZZZZZZZZ/console");
  flow("olmayan oturum konsolu → 404/hata ekranı", [403, 404].includes(r.status()) || (await t.getByText(/bulunamadı|yetki/i).count()) > 0, String(r.status()));
});

// 2) Yeni oturum diyaloğu + konsol + müşteri akışı (paylaşım reddi → Tekrar dene)
let link, sid;
await step("yeni oturum", async () => {
  const { dlg, link: l } = await newSession(t); link = l;
  flow("yeni oturum diyaloğu link üretir", /^http:\/\/localhost:3218\/session\//.test(link));
  await audit(t, "sessions-yeni-dialog", "04-yeni-oturum");
  await closeDlgOpenConsole(t, dlg); sid = t.url().match(/sessions\/([0-9A-Z]{26})/)[1];
  await audit(t, "console-bekleniyor", "05-konsol-bekleniyor");
});

const gctx = await browser.newContext({ ...desk });
await gctx.addInitScript(() => {
  const orig = navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices);
  let n = 0;
  if (orig) navigator.mediaDevices.getDisplayMedia = (c) => (n++ === 0 ? Promise.reject(new DOMException("deny", "NotAllowedError")) : orig(c));
});
const g = await gctx.newPage(); watch(g, "guest");
await step("müşteri karşılama", async () => {
  await g.goto(link); await g.locator('[data-testid="join-form"][data-ready="true"]').waitFor();
  await audit(g, "guest-karsilama", "06-musteri-karsilama");
  // Geçersiz girdi: boş ad, onaysız
  await g.getByTestId("join-browser").click(); await g.waitForTimeout(400);
  flow("müşteri: boş ad + onaysız → doğrulama, lobiye geçmez", (await g.getByTestId("guest-lobby").count()) === 0 && (await g.locator("[aria-invalid=true]").count()) > 0);
  await g.getByTestId("guest-name").fill("<script>alert(1)</script>"); await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click(); await g.waitForTimeout(800);
  const inLobby = (await g.getByTestId("guest-lobby").count()) > 0;
  flow("müşteri: '<script>' ad → reddedilir ya da düz metin", !inLobby || !(await g.evaluate(() => !!window.__xss)), inLobby ? "kabul edildi (lobi)" : "reddedildi: " + (await g.locator("[aria-invalid=true], [role=alert]").first().innerText().catch(() => "")).slice(0, 90));
  if (inLobby) { await g.getByTestId("lobby-leave").click().catch(() => {}); await g.goto(link); }
  await g.getByTestId("guest-name").fill("x".repeat(200)); await g.waitForTimeout(100);
  const len = (await g.getByTestId("guest-name").inputValue()).length;
  flow("müşteri: 200 karakter ad → sınırlanır", len <= 80, `girilen uzunluk ${len}`);
});
await step("lobi + kabul + paylaşım reddi", async () => {
  const code = await joinLobby(g, "Ayşe Yılmaz");
  flow("müşteri lobi + 4 haneli kod", /^\d{4}$/.test(code));
  await audit(g, "guest-lobi", "07-musteri-lobi");
  await t.getByTestId("lobby-guest").getByText("Ayşe Yılmaz").waitFor();
  await audit(t, "console-lobi", "08-konsol-lobi");
  await admit(t, code); flow("teknisyen kabul → Aktif", true);
  await g.getByTestId("share-start").click();
  await g.getByTestId("share-denied").waitFor({ timeout: 8000 });
  flow("paylaşım reddi → uyarı + Tekrar dene", await g.getByTestId("share-retry").isVisible());
  await audit(g, "guest-paylasim-red", "09-musteri-paylasim-red");
  await g.getByTestId("share-retry").click();
  await g.locator('[data-testid="share-strip"][data-state="sharing"]').waitFor({ timeout: 8000 });
  flow("Tekrar dene → paylaşım başlar", true);
  await t.locator('[data-testid="stage"][data-share="sharing"]').waitFor({ timeout: 10000 });
  const live = await t.waitForFunction(() => { const v = document.querySelector('[data-testid="console-video"]'); return v && v.readyState >= 2 && v.videoWidth > 0; }, null, { timeout: 20000 }).then(() => true, () => false);
  flow("teknisyen videosu canlı (videoWidth>0)", live);
  await audit(g, "guest-paylasim", "10-musteri-paylasiyor");
  await audit(t, "console-aktif-video", "11-konsol-video");
});
await step("geri tuşu + yenileme (müşteri)", async () => {
  await g.reload(); await g.waitForTimeout(3000);
  const st = await g.locator("[data-testid=share-strip], [data-testid=guest-lobby], [data-testid=join-form], [data-testid=guest-finished]").first().getAttribute("data-testid").catch(() => "yok");
  flow("müşteri aktif oturumda sayfayı yeniler → durum", true, `yenileme sonrası görünen: ${st}`);
});
await step("teknisyen bitirir", async () => {
  await t.getByTestId("console-end").click(); await t.getByTestId("console-confirm-ok").click();
  await t.getByTestId("console-ended").waitFor({ timeout: 10000 });
  await audit(t, "console-bitti", "12-konsol-bitti");
  const fin = await g.getByTestId("guest-finished").waitFor({ timeout: 10000 }).then(() => true, () => false);
  flow("teknisyen bitirir → müşteri bitiş ekranı", fin);
  await audit(g, "guest-bitti", "13-musteri-bitti");
  await t.goBack(); await t.waitForTimeout(1500);
  flow("bitişten sonra geri tuşu → yeniden aktif görünmez", (await t.getByTestId("console-status").getByText("Aktif").count()) === 0, t.url().replace(BASE, "").replace(/[0-9A-Z]{26}/, "<id>"));
  await g.goto(link); await g.waitForTimeout(800);
  flow("bitmiş oturum linki tekrar açılır → kapanış ekranı", (await g.getByTestId("join-form").count()) === 0, (await g.locator("main").innerText()).slice(0, 80).replace(/\n/g, " "));
  await audit(g, "guest-kullanilmis-link");
});
await step("geçersiz token", async () => {
  const r = await g.goto(BASE + "/session/gecersiz-token");
  flow("biçimsiz token → HTTP 404", r.status() === 404, String(r.status())); await audit(g, "guest-404");
});
await step("cihaz desteklenmiyor (Pixel 7)", async () => {
  const { link: l2, dlg } = await newSession(t);
  await dlg.getByRole("button", { name: "Kapat", exact: true }).click();
  const mctx = await browser.newContext({ ...devices["Pixel 7"] });
  const m = await mctx.newPage(); watch(m, "guest-mobile");
  await m.goto(l2);
  const un = await m.getByTestId("guest-unsupported").waitFor({ timeout: 8000 }).then(() => true, () => false);
  flow("mobil cihaz → 'Bu cihaz desteklenmiyor'", un && (await m.getByTestId("join-browser").count()) === 0);
  await audit(m, "guest-desteklenmiyor-mobil", "14-musteri-desteklenmiyor-mobil");
  await mctx.close();
});

// 3) Ret akışı + başka teknisyenin konsolu + zorla sonlandırma
await step("ret + yetki + zorla sonlandır", async () => {
  const { link: l3, dlg } = await newSession(t); await closeDlgOpenConsole(t, dlg);
  const sid3 = t.url().match(/sessions\/([0-9A-Z]{26})/)[1];
  const c3 = await browser.newContext(desk); const g3 = await c3.newPage(); watch(g3, "guest3");
  await g3.goto(l3); await joinLobby(g3, "Mehmet Demir");
  await t.getByTestId("lobby-guest").getByText("Mehmet Demir").waitFor();
  await t.getByTestId("lobby-guest").getByRole("button", { name: /Reddet/ }).click();
  await t.waitForTimeout(1500);
  const rej = await g3.getByText(/reddedildi|kabul edilmedi/i).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
  flow("teknisyen reddeder → müşteri ret ekranı", rej);
  await audit(g3, "guest-reddedildi", "15-musteri-ret");
  // tekrar katıl ve kabul et
  await g3.goto(l3); const code3 = await joinLobby(g3, "Mehmet Demir"); await admit(t, code3);
  // tech2 başka teknisyenin konsoluna gider
  const c2 = await browser.newContext(desk); const t2 = await c2.newPage(); watch(t2, "tech2");
  await login(t2, L2);
  const r = await t2.goto(`${BASE}/sessions/${sid3}/console`);
  const body = (await t2.locator("main").innerText().catch(() => "")).slice(0, 100).replace(/\n/g, " ");
  flow("başka teknisyenin konsolu (tech2 → tech1 oturumu) → erişim yok", [403, 404].includes(r.status()) || /yetki|bulunamad|erişim/i.test(body), `HTTP ${r.status()} · ${body}`);
  await t2.goto(BASE + "/sessions"); await t2.waitForTimeout(800);
  const row = rows(t2).filter({ hasText: "Aktif" }).first();
  await row.getByTestId("terminate").click().catch(async () => { await row.getByRole("button", { name: /sonlandır/i }).click(); });
  await audit(t2, "sessions-zorla-sonlandir-dialog", "16-zorla-sonlandir");
  await t2.getByRole("dialog").getByRole("button", { name: /sonlandır/i }).click();
  const ended = await g3.getByTestId("guest-finished").waitFor({ timeout: 10000 }).then(() => true, () => false);
  const tEnded = await t.getByTestId("console-ended").waitFor({ timeout: 10000 }).then(() => true, () => false);
  flow("Admin zorla sonlandırır → müşteri + konsol bitiş", ended && tEnded);
  await c2.close(); await c3.close();
});
await step("çift tıklama", async () => {
  await t.goto(BASE + "/sessions"); await t.waitForTimeout(500);
  const before = (await (await t.request.get(BASE + "/api/v1/sessions?pageSize=100")).json()).items.length;
  await t.getByRole("button", { name: "Yeni destek oturumu" }).first().dblclick();
  await t.waitForTimeout(2000);
  const after = (await (await t.request.get(BASE + "/api/v1/sessions?pageSize=100")).json()).items.length;
  flow("Yeni oturum düğmesine çift tıklama → tek kayıt", after - before === 1, `+${after - before}`);
  await t.keyboard.press("Escape");
});
await step("ağ hatası (API 500)", async () => {
  await t.route("**/api/v1/sessions**", (r) => r.request().method() === "GET" ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL","message":"x","requestId":"r"}}' }) : r.continue());
  await t.goto(BASE + "/sessions"); await t.waitForTimeout(12000);
  flow("liste API 500 (istemci yenilemesi) → uyarı görünür", (await t.getByRole("alert").count()) + (await t.getByText(/güncellenemedi|hata|Tekrar dene/i).count()) > 0);
  await t.unroute("**/api/v1/sessions**");
});
await step("çıkış", async () => {
  await t.goto(BASE + "/"); await t.getByRole("button", { name: "Çıkış yap" }).click();
  await t.waitForURL(/\/login/); flow("çıkış → /login", true, t.url().replace(BASE, ""));
  await t.goBack(); await t.waitForTimeout(1000);
  flow("çıkıştan sonra geri tuşu → panel verisi görünmez", t.url().includes("/login") || (await t.getByText("Çıkış yap").count()) === 0, t.url().replace(BASE, ""));
  await t.goto(BASE + "/sessions/" + sid + "/console");
  flow("çıkış sonrası korumalı konsol URL → login", t.url().includes("/login"), t.url().replace(BASE, "").replace(/[0-9A-Z]{26}/, "<id>"));
});

await browser.close();
writeFileSync(process.env.OUT, JSON.stringify(R, null, 2));
console.log("BİTTİ", R.flows.filter((f) => !f.ok).length, "başarısız akış;", R.console.length, "konsol;", R.net.length, "≥400 yanıt");
