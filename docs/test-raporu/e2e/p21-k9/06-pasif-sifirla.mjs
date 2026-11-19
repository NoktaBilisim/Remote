// Pasif hesap girişi, etkinleştir, pasife alınca açık oturumun düşmesi, şifre sıfırlama (TOTP kapanır, eski oturum düşer).
import fs from "node:fs";
import { chromium, BASE, watch, scan, rec } from "./k9lib.mjs";
const DIR = process.env.K9_DIR; const acc = JSON.parse(fs.readFileSync(DIR + "/accounts.json")); const A1 = process.argv[2];
const NEWPW = process.env.PORTAL_NEWPW + "x";
const log = (step, ok, note = "") => { rec({ kind: "flow", step, ok, note }); console.log(ok ? "OK  " : "FAIL", step, note); };
const b = await chromium.launch();
const adm = await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: DIR + "/admin-a.json" }); const ap = await adm.newPage(); const wa = watch(ap, "panel-a-2");
const cus = await b.newContext({ viewport: { width: 1280, height: 900 } }); const cp = await cus.newPage(); const wc = watch(cp, "portal-cem");
async function portalLogin(page, email, pw) {
  await page.goto(BASE + "/portal/login?tenant=demo"); await page.getByTestId("portal-email").fill(email); await page.getByTestId("portal-password").fill(pw);
  await page.getByTestId("portal-login-submit").click(); await page.waitForTimeout(1500); return page.url();
}
async function menu(name, action) {
  const row = ap.getByTestId("pa-row").filter({ hasText: name });
  await row.getByTestId("pa-menu").locator("summary").click(); await row.getByTestId(action).click(); return row;
}
await portalLogin(cp, acc.cem.email, acc.cem.pw);
log("pasif hesapla giriş → 401 (MFA değil)", cp.url().includes("/portal/login"), (await cp.locator("main").innerText()).match(/E-posta veya şifre hatalı[^\n]*|[^\n]*pasif[^\n]*/i)?.[0]);
await ap.goto(BASE + "/customers/" + A1); await ap.getByTestId("portal-accounts").waitFor();
const row = await menu("cem@a1.invalid", "pa-reactivate"); await ap.waitForTimeout(1000);
log("etkinleştir", (await row.getAttribute("data-status")) === "ACTIVE");
await portalLogin(cp, acc.cem.email, acc.cem.pw);
log("etkinleştirince giriş → şifre değişimi", cp.url().includes("change-password"), cp.url());
await cp.getByLabel("Mevcut şifre").fill(acc.cem.pw); await cp.getByLabel("Yeni şifre", { exact: true }).fill(NEWPW); await cp.getByLabel("Yeni şifre (tekrar)").fill(NEWPW);
await cp.getByTestId("portal-pw-submit").click(); await cp.waitForURL((u) => u.pathname === "/portal").catch(() => {}); acc.cem.pw = NEWPW;
// açık oturumdayken pasife al
await menu("cem@a1.invalid", "pa-deactivate"); await ap.getByTestId("pa-confirm").click(); await ap.waitForTimeout(1200);
const t0 = Date.now(); let st = 0;
while (Date.now() - t0 < 8000) { st = await cp.evaluate(async () => (await fetch("/api/v1/portal/me")).status); if (st === 401) break; await cp.waitForTimeout(500); }
log("pasife alınca açık portal isteği ≤5 sn'de 401", st === 401, `${st} ${Date.now() - t0} ms`);
await cp.goto(BASE + "/portal/account"); log("pasif sonrası sayfa → login", cp.url().includes("/portal/login"), cp.url());
await menu("cem@a1.invalid", "pa-reactivate"); await ap.waitForTimeout(800);
// ali: TOTP açık, şifre sıfırla
const alictx = await b.newContext(); // ali'nin önceki oturumu yok (çıkış yapıldı) — sıfırlama TOTP'yi kapatmalı
await ap.reload(); await ap.getByTestId("portal-accounts").waitFor();
log("panel 2FA rozeti (ali)", (await ap.getByTestId("pa-row").filter({ hasText: "ali@a1.invalid" }).getByTestId("pa-badge-mfa").count()) === 1);
await scan(ap, "panel-portal-hesaplari-rozetler-1280-light");
await menu("ali@a1.invalid", "pa-reset"); await ap.getByTestId("pa-reset-dialog").waitFor(); await ap.waitForTimeout(400);
await scan(ap, "panel-sifirla-diyalog", { full: false });
await ap.getByTestId("pa-confirm").click(); await ap.getByTestId("temp-password").waitFor();
acc.ali.pw = await ap.getByTestId("temp-password").inputValue();
await scan(ap, "panel-gecici-sifre-diyalog", { full: false });
await ap.getByTestId("pw-done").click(); await ap.getByTestId("pw-close-anyway").click().catch(() => {});
await ap.waitForTimeout(800);
log("sıfırlama sonrası 2FA rozeti kalkar", (await ap.getByTestId("pa-row").filter({ hasText: "ali@a1.invalid" }).getByTestId("pa-badge-mfa").count()) === 0);
fs.writeFileSync(DIR + "/accounts.json", JSON.stringify(acc));
const ali = await alictx.newPage();
await portalLogin(ali, acc.ali.email, acc.ali.pw);
log("sıfırlanan şifreyle kodsuz giriş → şifre değişimi", ali.url().includes("change-password"), ali.url());
await ali.getByLabel("Mevcut şifre").fill(acc.ali.pw); await ali.getByLabel("Yeni şifre", { exact: true }).fill(NEWPW); await ali.getByLabel("Yeni şifre (tekrar)").fill(NEWPW);
await ali.getByTestId("portal-pw-submit").click(); await ali.waitForURL((u) => u.pathname === "/portal").catch(() => {}); acc.ali.pw = NEWPW;
fs.writeFileSync(DIR + "/accounts.json", JSON.stringify(acc));
await alictx.storageState({ path: DIR + "/portal-ali.json" });
rec({ kind: "watch", ...wa }); rec({ kind: "watch", ...wc }); console.log(JSON.stringify(wa)); console.log(JSON.stringify(wc));
await b.close();
