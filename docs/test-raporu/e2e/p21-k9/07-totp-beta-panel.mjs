// TOTP aç/kapat (ayrı adımlarla), Beta (web formu kapalı) yeni talep, Admin B çapraz firma API, panel bölümü koyu/mobil.
import fs from "node:fs";
import { chromium, BASE, watch, scan, rec, totp } from "./k9lib.mjs";
const DIR = process.env.K9_DIR; const acc = JSON.parse(fs.readFileSync(DIR + "/accounts.json")); const [A1, B1] = process.argv.slice(2);
const NEWPW = process.env.PORTAL_NEWPW + "b";
const log = (step, ok, note = "") => { rec({ kind: "flow", step, ok, note }); console.log(ok ? "OK  " : "FAIL", step, note); };
const nextStep = async () => { await new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 400)); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: DIR + "/portal-ali.json" }); const p = await ctx.newPage(); const w = watch(p, "portal-ali-3");
await p.goto(BASE + "/portal/account");
await p.getByTestId("portal-mfa-on").click(); await p.getByTestId("portal-mfa-qr").waitFor();
const secret = (await p.locator('[aria-labelledby="portal-mfa-key"]').innerText()).replace(/\s+/g, "");
await nextStep(); await p.getByTestId("portal-mfa-code").fill(totp(secret)); await p.getByTestId("portal-mfa-enable").click(); await p.waitForTimeout(1200);
log("TOTP aç", (await p.getByTestId("portal-mfa").getAttribute("data-enabled")) === "true");
await p.getByTestId("portal-mfa-off").click(); await p.waitForTimeout(300);
await scan(p, "portal-totp-kapat-form-1280-light", { full: false });
const f = p.getByTestId("portal-mfa-disable-form");
await f.locator("input[type=password]").first().fill(acc.ali.pw);
await p.getByTestId("portal-mfa-code").fill(totp(secret)); await p.getByTestId("portal-mfa-disable-confirm").click(); await p.waitForTimeout(1000);
log("TOTP kapat aynı 30 sn adımındaki kodla → reddedilir (tekrar oynatma koruması)", (await p.getByTestId("portal-mfa").getAttribute("data-enabled")) === "true", (await f.innerText().catch(() => "")).match(/Kod[^\n]*/)?.[0]);
await nextStep(); await p.getByTestId("portal-mfa-code").fill(totp(secret)); await p.getByTestId("portal-mfa-disable-confirm").click(); await p.waitForTimeout(1200);
log("TOTP kapat (şifre + yeni kod)", (await p.getByTestId("portal-mfa").getAttribute("data-enabled")) === "false");
rec({ kind: "watch", ...w });
// Beta: ece, web formu KAPALI firma
const e = await b.newContext({ viewport: { width: 1280, height: 900 } }); const ep = await e.newPage(); const we = watch(ep, "portal-ece");
await ep.goto(BASE + "/portal/login?tenant=beta"); await ep.getByTestId("portal-email").fill(acc.ece.email); await ep.getByTestId("portal-password").fill(acc.ece.pw);
await ep.getByTestId("portal-login-submit").click(); await ep.waitForURL(/change-password/).catch(() => {});
await ep.getByLabel("Mevcut şifre").fill(acc.ece.pw); await ep.getByLabel("Yeni şifre", { exact: true }).fill(NEWPW); await ep.getByLabel("Yeni şifre (tekrar)").fill(NEWPW);
await ep.getByTestId("portal-pw-submit").click(); await ep.waitForURL((u) => u.pathname === "/portal").catch(() => {}); acc.ece.pw = NEWPW;
log("ece (beta) giriş", new URL(ep.url()).pathname === "/portal");
// ali@a1.invalid demo şifresiyle beta'ya giremez
const x = await b.newContext(); const xp = await x.newPage();
await xp.goto(BASE + "/portal/login?tenant=beta"); await xp.getByTestId("portal-email").fill(acc.ali.email); await xp.getByTestId("portal-password").fill(acc.ali.pw);
await xp.getByTestId("portal-login-submit").click(); await xp.waitForTimeout(1500);
log("demo hesabının şifresi beta slug'ıyla → 401", xp.url().includes("/portal/login"), (await xp.locator("main").innerText()).match(/E-posta veya şifre hatalı/)?.[0]);
const rr = await fetch(BASE + "/r/" + "cgkmmbx564yafykf"); log("beta /r/<ref> form kapalı → 404 (değişmedi)", rr.status === 404, String(rr.status));
await ep.goto(BASE + "/portal/new-request"); await ep.getByTestId("wr-form").waitFor({ timeout: 15000 }).catch(() => {});
log("form kapalı firmada /portal/new-request formu açılır", (await ep.getByTestId("wr-form").count()) === 1);
await ep.getByTestId("wr-phone").fill("05321112233"); await ep.getByTestId("wr-desc").fill("Beta talep"); await ep.getByTestId("wr-consent").check();
await ep.getByTestId("wr-submit").click(); await ep.getByTestId("wr-waiting").waitFor({ timeout: 15000 }).catch(() => {});
log("form kapalı firmada talep → bekleme odası", (await ep.getByTestId("wr-waiting").count()) === 1);
// iptal
const cancel = ep.getByRole("button", { name: /İptal|Vazgeç/ }).first();
if (await cancel.count()) { await cancel.click(); await ep.waitForTimeout(500); const c2 = ep.getByRole("button", { name: /İptal et|Evet/ }); if (await c2.count()) await c2.first().click(); await ep.waitForTimeout(1200); }
await scan(ep, "portal-beta-talep-iptal-1280-light");
await ep.goto(BASE + "/portal"); log("beta talep listede", (await ep.locator("main").innerText()).includes("Talepler (1)"), (await ep.locator("main").innerText()).match(/Talepler \(\d+\)/)?.[0]);
await scan(ep, "portal-beta-home-1280-light");
rec({ kind: "watch", ...we }); console.log(JSON.stringify(we));
fs.writeFileSync(DIR + "/accounts.json", JSON.stringify(acc));
// Admin B: A1 müşterisinin portal hesap uçları
const adb = JSON.parse(fs.readFileSync(DIR + "/admin-b.json")); const ck = adb.cookies.map((c) => `${c.name}=${c.value}`).join("; "); const csrf = adb.cookies.find((c) => c.name === "__Host-rs_csrf").value;
const la = await fetch(`${BASE}/api/v1/customers/${A1}/portal-accounts`, { headers: { cookie: ck } }); log("Admin B → A1 portal hesap listesi 404", la.status === 404, String(la.status));
const ada = JSON.parse(fs.readFileSync(DIR + "/admin-a.json")); const cka = ada.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
const list = await (await fetch(`${BASE}/api/v1/customers/${A1}/portal-accounts`, { headers: { cookie: cka } })).json();
const accId = (list.items ?? list.data ?? list)[0]?.id;
const dz = await fetch(`${BASE}/api/v1/customers/${B1}/portal-accounts/${accId}/deactivate`, { method: "POST", headers: { cookie: ck, origin: BASE, "x-csrf-token": csrf, "content-type": "application/json" }, body: "{}" });
log("Admin B kendi müşteri yolunda A hesabı id'si → 404", dz.status === 404, String(dz.status));
log("Admin geçici şifre ikinci GET'te yok", !JSON.stringify(list).match(/temporaryPassword|password/i), Object.keys((list.items ?? [])[0] ?? {}).join(","));
// panel bölümü koyu + mobil
for (const [vw, scheme] of [[1280, "dark"], [390, "light"], [390, "dark"]]) {
  const c = await b.newContext({ viewport: { width: vw, height: 900 }, colorScheme: scheme, storageState: DIR + "/admin-a.json" });
  await c.addCookies([{ name: "rs_theme", value: scheme === "dark" ? "DARK" : "LIGHT", domain: "localhost", path: "/" }]);
  const cp = await c.newPage(); const wc = watch(cp, "panel-" + vw + scheme);
  await cp.goto(BASE + "/customers/" + A1); await cp.getByTestId("portal-accounts").waitFor();
  await cp.getByTestId("portal-accounts").scrollIntoViewIfNeeded();
  await scan(cp, `panel-musteri-detay-${vw}-${scheme}`);
  await cp.getByTestId("portal-accounts").screenshot({ path: `/Users/mennan/Projeler/Remote/.claude/worktrees/p21-c5b21a/docs/test-raporu/p21/panel-portal-bolumu-${vw}-${scheme}.png` });
  rec({ kind: "watch", ...wc }); await c.close();
}
await b.close();
