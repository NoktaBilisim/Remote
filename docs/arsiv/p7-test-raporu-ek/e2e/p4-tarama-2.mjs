// P4 sayfa testi — 2. tur: ilk taramada script kaynaklı yarıda kalan akışlar + kanıt toplama.
// Çalıştırma: p4-tarama.mjs ile aynı (apps/web dizininden, env aynı).
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(process.cwd() + "/package.json");
const { chromium, devices } = require("@playwright/test");

const BASE = "http://localhost:3218";
const { E2E_REAL_LOGIN: L1, E2E_REAL_LOGIN2: L2, E2E_REAL_PASSWORD: PW, SHOTS } = process.env;
const R = { flows: [], console: [], net: [] };
const flow = (name, ok, note = "") => { R.flows.push({ name, ok, note }); console.log(ok ? "OK  " : "FAIL", name, "|", note); };
function watch(page, tag) {
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) R.console.push({ tag, type: m.type(), text: m.text().slice(0, 250) }); });
  page.on("pageerror", (e) => R.console.push({ tag, type: "pageerror", text: e.message.slice(0, 250) }));
  page.on("response", (r) => { if (r.status() >= 400) R.net.push({ tag, status: r.status(), url: r.url().replace(/session\/[^/?]+/, "session/<token>") }); });
}
async function step(name, fn) { try { await fn(); } catch (e) { flow(name, false, "İSTİSNA: " + e.message.split("\n")[0].slice(0, 200)); } }
async function login(page, email) {
  await page.goto(BASE + "/login");
  await page.locator('input[name="login"]').fill(email); await page.locator('input[name="password"]').fill(PW);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}
const rows = (p) => p.locator('[data-testid="session-row"], [data-testid="session-card"]').filter({ visible: true });
async function newSessionConsole(page) {
  await page.goto(BASE + "/sessions");
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const dlg = page.getByTestId("new-session-dialog");
  const link = await dlg.getByTestId("session-link").inputValue();
  await dlg.getByRole("button", { name: "Kapat", exact: true }).click();
  await rows(page).first().getByTestId("open-console").click();
  await page.waitForURL(/\/console$/);
  await page.getByTestId("stage").getByText("Müşteri bekleniyor").waitFor();
  return { link, sid: page.url().match(/sessions\/([0-9A-Z]{26})/)[1] };
}
async function joinLobby(g, name) {
  await g.locator('[data-testid="join-form"][data-ready="true"]').waitFor();
  await g.getByTestId("guest-name").fill(name); await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  await g.getByTestId("guest-lobby").waitFor({ timeout: 10000 });
  return ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\D/g, "");
}
async function admit(page, code) {
  await page.getByTestId("admit-input").fill(code); await page.getByTestId("admit-submit").click();
  await page.getByTestId("console-status").getByText("Aktif").waitFor({ timeout: 10000 });
}
const text = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 220);

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--auto-accept-this-tab-capture"] });
const desk = devices["Desktop Chrome"];
const tctx = await browser.newContext(desk); const t = await tctx.newPage(); watch(t, "tech1");
await login(t, L1);
// önceki koşulardan kalan açık oturumları kapat
await step("temizlik", async () => {
  const csrf = (await tctx.cookies()).find((c) => /csrf/i.test(c.name))?.value ?? "";
  const list = await (await t.request.get(BASE + "/api/v1/sessions?pageSize=100")).json();
  for (const s of list.items.filter((i) => ["PENDING", "ACTIVE"].includes(i.status)))
    await t.request.post(`${BASE}/api/v1/sessions/${s.id}/${s.status === "PENDING" ? "cancel" : "terminate"}`, { headers: { "x-csrf-token": csrf, Origin: BASE }, data: {} });
});

// A) Girdi doğrulama (AC-28) + kamera konsol hatası tekrar üretimi (müdahalesiz bağlam)
const A = await newSessionConsole(t);
const gctx = await browser.newContext(desk); const g = await gctx.newPage(); watch(g, "guestA");
await step("AC-28 girdi", async () => {
  await g.goto(A.link); await g.locator('[data-testid="join-form"][data-ready="true"]').waitFor(); await g.waitForTimeout(1500);
  const camErr = R.console.filter((c) => c.tag === "guestA" && /camera/.test(c.text)).length;
  flow("müşteri karşılama (müdahalesiz bağlam) yüklenince 'camera' Permissions-Policy hatası", camErr === 0, `adet ${camErr}`);
  const btn = g.getByTestId("join-browser");
  const dis0 = await btn.isDisabled() || (await btn.getAttribute("aria-disabled")) === "true";
  await g.getByTestId("guest-name").fill("Ayşe Yılmaz");
  const dis1 = await btn.isDisabled() || (await btn.getAttribute("aria-disabled")) === "true";
  await g.getByTestId("guest-consent").check();
  const dis2 = await btn.isDisabled() || (await btn.getAttribute("aria-disabled")) === "true";
  flow("AC-28: ad+onay yokken pasif, yalnız ad varken pasif, ikisi varken aktif", dis0 && dis1 && !dis2, `boş=${dis0} adVar=${dis1} ikisi=${dis2}`);
  await g.getByTestId("guest-name").fill("A"); await btn.click({ timeout: 3000 }).catch(() => {}); await g.waitForTimeout(500);
  flow("AC-28: 1 karakter ad → lobiye geçmez", (await g.getByTestId("guest-lobby").count()) === 0, (await g.locator("[aria-invalid=true]").count()) ? "alan hatası" : "hata işareti yok/pasif");
  await g.getByTestId("guest-name").fill("x".repeat(150)); const len = (await g.getByTestId("guest-name").inputValue()).length;
  flow("AC-28: ad üst sınırı 100", len <= 100, `alana yazılabilen ${len}`);
  await g.getByTestId("guest-name").fill("Robert'); DROP TABLE x;-- ' OR 1=1");
  await btn.click({ timeout: 3000 }).catch(() => {}); await g.waitForTimeout(1200);
  flow("SQL benzeri ad → 5xx yok", !R.net.some((n) => n.tag === "guestA" && n.status >= 500), (await g.getByTestId("guest-lobby").count()) ? "lobiye alındı (düz metin)" : await text(g));
  if (await g.getByTestId("guest-lobby").count()) { await g.getByTestId("lobby-leave").click(); await g.waitForTimeout(800); }
});
await step("XSS ad", async () => {
  await g.goto(A.link); await g.locator('[data-testid="join-form"][data-ready="true"]').waitFor();
  await g.getByTestId("guest-name").fill("<img src=x onerror=window.__x=1>"); await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click(); await g.waitForTimeout(1500);
  const lobby = (await g.getByTestId("guest-lobby").count()) > 0;
  let shown = "";
  if (lobby) { await t.getByTestId("lobby-guest").first().waitFor({ timeout: 8000 }).catch(() => {}); shown = await t.getByTestId("lobby-guest").first().innerText().catch(() => ""); }
  const x = await t.evaluate(() => window.__x === 1);
  flow("HTML/script içeren ad konsolda çalışmaz", !x, lobby ? `lobide görünen: ${shown.replace(/\n/g, " ").slice(0, 80)}` : "reddedildi: " + (await text(g)).slice(0, 120));
  if (lobby) { await g.getByTestId("lobby-leave").click().catch(() => {}); await g.waitForTimeout(800); }
});

// B) Ret → aynı tarayıcıdan tekrar katılım (AC-113: aynı IP tekrar katılamaz) → UI ne gösteriyor
await step("AC-113 ret + tekrar", async () => {
  await g.goto(A.link); await joinLobby(g, "Sahte Kişi");
  await t.getByTestId("lobby-guest").getByText("Sahte Kişi").waitFor();
  await t.getByTestId("lobby-guest").getByRole("button", { name: /Reddet/ }).click();
  await g.getByText("Teknisyen bağlantıyı reddetti").waitFor({ timeout: 8000 });
  flow("AC-113: ret → 'Teknisyen bağlantıyı reddetti'", true);
  await g.goto(A.link); await g.locator('[data-testid="join-form"][data-ready="true"]').waitFor();
  await g.getByTestId("guest-name").fill("Sahte Kişi"); await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click(); await g.waitForTimeout(1500);
  flow("AC-113: reddedilen kaynak tekrar katılamaz (403) + anlaşılır mesaj", (await g.getByTestId("guest-lobby").count()) === 0, await text(g));
  await g.screenshot({ path: `${SHOTS}/17-musteri-ret-sonrasi-tekrar.png`, fullPage: true });
});

// C) Aktif oturum: kalan süre, müşteri sayfayı yeniler, tech2 erişimi, zorla sonlandır (AC-114)
const B = await newSessionConsole(t);
const g2ctx = await browser.newContext(desk); const g2 = await g2ctx.newPage(); watch(g2, "guestB");
await step("aktif", async () => {
  await g2.goto(B.link); const code = await joinLobby(g2, "Mehmet Demir");
  await t.getByTestId("lobby-guest").getByText("Mehmet Demir").waitFor(); await admit(t, code);
  await t.waitForTimeout(1500);
  const bar = (await t.getByTestId("stage").locator("xpath=..").innerText()).replace(/\s+/g, " ");
  const m = bar.match(/Kalan süre\s*(\S+)/);
  flow("aktif oturumda konsol 'Kalan süre' değeri", !!m && m[1] !== "—", `görünen: ${m ? m[1] : "?"}`);
});
await step("tech2 yabancı konsol", async () => {
  const c2 = await browser.newContext(desk); const t2 = await c2.newPage(); watch(t2, "tech2");
  await login(t2, L2);
  const r = await t2.goto(`${BASE}/sessions/${B.sid}/console`); await t2.waitForTimeout(1500);
  flow("tech2 → tech1'in konsol URL'si: erişim yok", [403, 404].includes(r.status()) || /bulunamad|yetki|erişim/i.test(await text(t2)), `HTTP ${r.status()} · ${(await text(t2)).slice(0, 140)}`);
  await t2.screenshot({ path: `${SHOTS}/18-yabanci-konsol.png` });
  // AC-114 zorla sonlandır
  await t2.goto(BASE + "/sessions"); await t2.waitForTimeout(1000);
  const btns = t2.getByRole("button", { name: /Zorla sonlandır/i }).filter({ visible: true });
  flow("AC-114: Admin listede 'Zorla sonlandır' görür", (await btns.count()) > 0, `düğme ${await btns.count()}`);
  await btns.first().click();
  const dlg = t2.getByRole("dialog");
  const focused = await t2.evaluate(() => document.activeElement?.textContent?.trim());
  flow("zorla sonlandır onayında odak 'Vazgeç'te", /Vazgeç/.test(focused ?? ""), focused ?? "");
  await t2.screenshot({ path: `${SHOTS}/16-zorla-sonlandir.png` });
  await dlg.getByRole("button", { name: /sonlandır/i }).last().click();
  const t0 = Date.now();
  await g2.getByTestId("guest-finished").waitFor({ timeout: 10000 });
  const gt = await text(g2);
  await t.getByTestId("console-ended").waitFor({ timeout: 10000 });
  const tt = await t.getByTestId("console-ended").innerText();
  flow("AC-114: iki taraf ≤5 sn 'yönetici tarafından sonlandırıldı'", Date.now() - t0 <= 5000 && /yönetici/i.test(gt) && /yönetici/i.test(tt), `${Date.now() - t0} ms · müşteri: ${gt.slice(0, 90)} · konsol: ${tt.replace(/\s+/g, " ").slice(0, 90)}`);
  await g2.screenshot({ path: `${SHOTS}/19-musteri-zorla-sonlandirildi.png` });
  await c2.close();
});

// D) Müşteri aktif oturumda sayfayı yeniler (F5)
const C = await newSessionConsole(t);
const g3ctx = await browser.newContext(desk); const g3 = await g3ctx.newPage(); watch(g3, "guestC");
await step("müşteri F5", async () => {
  await g3.goto(C.link); const code = await joinLobby(g3, "Zeynep Kaya");
  await t.getByTestId("lobby-guest").getByText("Zeynep Kaya").waitFor(); await admit(t, code);
  await g3.getByTestId("share-start").click();
  await t.locator('[data-testid="stage"][data-share="sharing"]').waitFor({ timeout: 10000 });
  await g3.reload(); await g3.waitForTimeout(3000);
  const gt = await text(g3);
  await g3.screenshot({ path: `${SHOTS}/20-musteri-f5-sonrasi.png`, fullPage: true });
  await t.waitForTimeout(2000);
  const tt = (await t.getByTestId("stage").innerText()).replace(/\s+/g, " ");
  await t.screenshot({ path: `${SHOTS}/21-konsol-musteri-f5-sonrasi.png` });
  flow("müşteri aktif paylaşımda F5 → oturuma geri döner", !/zaten kullanıldı/.test(gt) && (await g3.getByTestId("share-strip").count()) > 0, `müşteri: ${gt.slice(0, 120)} · konsol sahne: ${tt.slice(0, 120)}`);
  await t.getByTestId("console-end").click().catch(() => {}); await t.getByTestId("console-confirm-ok").click().catch(() => {});
});
// E) AC-38 frame-ancestors / X-Frame-Options
await step("AC-38", async () => {
  const r = await t.request.get(BASE + "/session/gecersiz-token");
  const csp = r.headers()["content-security-policy"] ?? ""; const xfo = r.headers()["x-frame-options"] ?? "";
  flow("AC-38: müşteri sayfası frame-ancestors 'none'", /frame-ancestors 'none'/.test(csp), `xfo=${xfo}`);
});
await browser.close();
writeFileSync(process.env.OUT, JSON.stringify(R, null, 2));
console.log("BİTTİ", R.flows.filter((f) => !f.ok).length, "başarısız;", JSON.stringify(R.console));
console.log("NET", JSON.stringify(R.net));
