// P4 sayfa testi — tur 2 (dar kapsam): TEST-P4-1/2/3/4/5 yeniden doğrulama.
// Çalıştırma: p4-tarama.mjs ile aynı (apps/web dizininden; env E2E_REAL_LOGIN, E2E_REAL_PASSWORD, SHOTS).
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(process.cwd() + "/package.json");
const { chromium, devices } = require("@playwright/test");

const BASE = "http://localhost:3218";
const { E2E_REAL_LOGIN: L1, E2E_REAL_PASSWORD: PW, SHOTS } = process.env;
const R = { flows: [], console: [], net: [] };
const flow = (name, ok, note = "") => { R.flows.push({ name, ok, note }); console.log(ok ? "OK  " : "FAIL", name, "|", note); };
function watch(page, tag) {
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) R.console.push({ tag, type: m.type(), text: m.text().slice(0, 250) }); });
  page.on("pageerror", (e) => R.console.push({ tag, type: "pageerror", text: e.message.slice(0, 250) }));
  page.on("response", (r) => { if (r.status() >= 400) R.net.push({ tag, status: r.status(), url: r.url().replace(/session\/[^/?]+/, "session/<token>") }); });
}
async function step(name, fn) { try { await fn(); } catch (e) { flow(name, false, "İSTİSNA: " + e.message.split("\n")[0].slice(0, 200)); } }
const text = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");
async function waitVideo() { let w = 0; for (let i = 0; i < 50 && !w; i++) { w = await t.locator('[data-testid="stage"] video').first().evaluate((v) => v.videoWidth).catch(() => 0); if (!w) await t.waitForTimeout(200); } return w; }
const desk = { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } };
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--auto-select-desktop-capture-source=Entire screen", "--auto-accept-this-tab-capture"] });
const tctx = await browser.newContext(desk); const t = await tctx.newPage(); watch(t, "tech");
await t.goto(BASE + "/login");
await t.locator('input[name="login"]').fill(L1); await t.locator('input[name="password"]').fill(PW);
await t.locator('form button[type="submit"]').click();
await t.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });

await t.goto(BASE + "/sessions");
await t.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
const dlg = t.getByTestId("new-session-dialog");
const link = await dlg.getByTestId("session-link").inputValue();
await dlg.getByRole("button", { name: "Kapat", exact: true }).click();
await t.locator('[data-testid="session-row"], [data-testid="session-card"]').filter({ visible: true }).first().getByTestId("open-console").click();
await t.waitForURL(/\/console$/);
await t.getByTestId("stage").getByText("Müşteri bekleniyor").waitFor();

const gctx = await browser.newContext(desk); const g = await gctx.newPage(); watch(g, "guest");
await step("katılım + kabul", async () => {
  await g.goto(link);
  await g.locator('[data-testid="join-form"][data-ready="true"]').waitFor();
  await g.getByTestId("guest-name").fill("Ayşe Demir"); await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  await g.getByTestId("guest-lobby").waitFor({ timeout: 10000 });
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\D/g, "");
  await t.getByTestId("lobby-guest").getByText("Ayşe Demir").waitFor();
  await t.getByTestId("admit-input").fill(code); await t.getByTestId("admit-submit").click();
  await t.getByTestId("console-status").getByText("Aktif").waitFor({ timeout: 10000 });
});
// TEST-P4-2: kalan süre
await step("TEST-P4-2", async () => {
  await t.waitForTimeout(1500);
  const a = (await t.getByTestId("console-left").innerText()).trim();
  await t.waitForTimeout(3000);
  const b = (await t.getByTestId("console-left").innerText()).trim();
  const sec = (s) => { const m = s.match(/(\d+):(\d{2})(?::(\d{2}))?/); if (!m) return NaN; return m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2]; };
  flow("TEST-P4-2 kalan süre sayı ve azalıyor", /\d/.test(a) && sec(b) < sec(a), `ilk="${a}" 3 sn sonra="${b}"`);
});
// paylaşım + TEST-P4-4
await step("paylaşım + TEST-P4-4", async () => {
  await g.getByTestId("share-start").click();
  await t.locator('[data-testid="stage"][data-share="sharing"]').waitFor({ timeout: 10000 });
  flow("ilk paylaşım: video gelir", (await waitVideo()) > 0, "");
  const e = await t.getByTestId("console-end").boundingBox();
  const s = await t.getByTestId("console-status").boundingBox();
  const lines = await t.getByTestId("console-end").evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || "20")));
  flow("TEST-P4-4 1280px 'Oturumu bitir' tek satır + başlıkla aynı satır", Math.abs((e.y + e.height / 2) - (s.y + s.height / 2)) < 24 && e.height < 48, `bitir y=${Math.round(e.y)} h=${Math.round(e.height)} · durum y=${Math.round(s.y)} · satır≈${lines}`);
  await t.screenshot({ path: `${SHOTS}/t2-01-konsol-aktif-1280.png` });
});
// TEST-P4-1: müşteri F5 x2
for (const n of [1, 2]) {
  await step(`TEST-P4-1 F5 #${n}`, async () => {
    await g.reload();
    let sawResume = false;
    for (let i = 0; i < 40; i++) {
      const bt = await text(g);
      if (/yeniden bağlanılıyor/i.test(bt)) sawResume = true;
      if ((await g.getByTestId("share-strip").count()) > 0 || /kullanıldı/.test(bt)) break;
      await g.waitForTimeout(100);
    }
    await g.getByTestId("share-strip").waitFor({ timeout: 10000 }).catch(() => {});
    const gt = await text(g);
    await g.screenshot({ path: `${SHOTS}/t2-0${n + 1}-musteri-f5-${n}.png`, fullPage: true });
    await t.waitForTimeout(2500);
    const tt = (await t.getByTestId("console").innerText()).replace(/\s+/g, " ");
    const guestBack = /Ayşe Demir/.test(tt) && !/Bağlantı koptu/.test(tt) && /Aktif/.test(tt);
    flow(`TEST-P4-1 F5 #${n}: müşteri oturum ekranına döner`, !/kullanıldı/.test(gt) && (await g.getByTestId("share-strip").count()) > 0, `yeniden bağlanılıyor görüldü=${sawResume} · müşteri: ${gt.slice(0, 140)}`);
    flow(`TEST-P4-1 F5 #${n}: konsol misafiri tekrar görür`, guestBack, tt.slice(0, 160));
    await g.getByTestId("share-start").click();
    await t.locator('[data-testid="stage"][data-share="sharing"]').waitFor({ timeout: 10000 });
    const vw = await waitVideo();
    flow(`TEST-P4-1 F5 #${n}: 'Paylaş' ile paylaşım yeniden başlar (video gelir)`, vw > 0, `videoWidth=${vw} (10 sn bekleme)`);
    await t.screenshot({ path: `${SHOTS}/t2-0${n + 3}-konsol-f5-${n}.png` });
  });
}
// bitiş + TEST-P4-5 + bitiş sonrası F5
await step("bitiş + TEST-P4-5", async () => {
  await t.getByTestId("console-end").click(); await t.getByTestId("console-confirm-ok").click();
  await t.getByTestId("console-ended").waitFor({ timeout: 10000 });
  await g.waitForTimeout(2000);
  const gt = await text(g);
  await g.screenshot({ path: `${SHOTS}/t2-06-musteri-bitti.png`, fullPage: true });
  flow("TEST-P4-5 bitiş ekranında paylaşım alt bilgisi yok", !/Ekranınız kaydedilmez/.test(gt), gt.slice(0, 160));
  await g.reload(); await g.waitForTimeout(3000);
  const gt2 = await text(g);
  await g.screenshot({ path: `${SHOTS}/t2-07-musteri-bitti-f5.png`, fullPage: true });
  flow("bitiş sonrası F5 → 'kullanıldı'", /kullanıldı/.test(gt2) && !/Ekranınız kaydedilmez/.test(gt2), gt2.slice(0, 160));
});
// TEST-P4-5 ret ekranı
await step("TEST-P4-5 ret", async () => {
  await t.goto(BASE + "/sessions");
  await t.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const d = t.getByTestId("new-session-dialog");
  const l2 = await d.getByTestId("session-link").inputValue();
  await d.getByRole("button", { name: "Kapat", exact: true }).click();
  await t.locator('[data-testid="session-row"], [data-testid="session-card"]').filter({ visible: true }).first().getByTestId("open-console").click();
  await t.waitForURL(/\/console$/);
  const c3 = await browser.newContext(desk); const g3 = await c3.newPage(); watch(g3, "guest-ret");
  await g3.goto(l2);
  await g3.locator('[data-testid="join-form"][data-ready="true"]').waitFor();
  await g3.getByTestId("guest-name").fill("Ret Test"); await g3.getByTestId("guest-consent").check();
  await g3.getByTestId("join-browser").click(); await g3.getByTestId("guest-lobby").waitFor({ timeout: 10000 });
  await t.getByTestId("lobby-guest").getByText("Ret Test").waitFor();
  await t.getByTestId("lobby-guest").getByRole("button", { name: /Reddet/ }).click();
  await g3.getByText(/reddetti/).waitFor({ timeout: 10000 });
  const gt = await text(g3);
  await g3.screenshot({ path: `${SHOTS}/t2-08-musteri-ret.png`, fullPage: true });
  flow("TEST-P4-5 ret ekranında paylaşım alt bilgisi yok", !/Ekranınız kaydedilmez/.test(gt), gt.slice(0, 160));
  await c3.close();
});
writeFileSync(`${SHOTS}/t2-sonuc.json`, JSON.stringify(R, null, 2));
console.log("KONSOL:", JSON.stringify(R.console, null, 1));
console.log("AĞ>=400:", JSON.stringify(R.net));
await browser.close();
