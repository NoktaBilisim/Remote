// Hesabım: TOTP kur → çıkış → kodlu giriş → TOTP kapat; tema; koyu/mobil taramalar; çerez ayrımı; çıkış sonrası koruma.
import fs from "node:fs";
import { chromium, BASE, watch, scan, rec, totp, freshTotp } from "./k9lib.mjs";
const DIR = process.env.K9_DIR; const acc = JSON.parse(fs.readFileSync(DIR + "/accounts.json"));
const rq = fs.readFileSync(DIR + "/ali-req.txt", "utf8"); const ownSess = process.argv[2]; const A1 = process.argv[3];
const log = (step, ok, note = "") => { rec({ kind: "flow", step, ok, note }); console.log(ok ? "OK  " : "FAIL", step, note); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: DIR + "/portal-ali.json" });
const p = await ctx.newPage(); const w = watch(p, "portal-ali-2");
await p.goto(BASE + "/portal/account");
await p.getByTestId("portal-mfa-on").click(); await p.getByTestId("portal-mfa-qr").waitFor();
await p.waitForTimeout(400); await scan(p, "portal-hesabim-totp-kurulum-1280-light");
const secret = (await p.locator('[aria-labelledby="portal-mfa-key"]').innerText()).replace(/\s+/g, "");
await p.getByTestId("portal-mfa-code").fill("000000"); await p.getByTestId("portal-mfa-enable").click(); await p.waitForTimeout(800);
log("TOTP yanlış kod → hata", (await p.getByTestId("portal-mfa")).count && (await p.getByTestId("portal-mfa").getAttribute("data-enabled").catch(() => null)) !== "true", (await p.locator("main").innerText()).match(/Kod[^\n]*/)?.[0]);
await p.getByTestId("portal-mfa-code").fill(await freshTotp(secret)); await p.getByTestId("portal-mfa-enable").click();
await p.waitForTimeout(1200);
log("TOTP aç", (await p.getByTestId("portal-mfa").getAttribute("data-enabled")) === "true");
// çıkış
await p.getByTestId("portal-user-menu").locator("summary").click(); await p.getByTestId("portal-logout").click();
await p.waitForURL(/portal\/login/, { timeout: 10000 }).catch(() => {});
log("çıkış → login?reason=logout", p.url().includes("/portal/login"), p.url());
await scan(p, "portal-login-cikis-sonrasi-1280-light");
const r = await p.goto(BASE + "/portal/account"); 
log("çıkış sonrası korumalı URL → login (slug çerezden)", p.url().includes("/portal/login?tenant=demo"), p.url());
await p.goBack(); await p.waitForLoadState("networkidle");
log("geri tuşu sonrası korumalı içerik yok", !p.url().endsWith("/portal/account") || (await p.getByTestId("portal-acc-facts").count()) === 0, p.url());
await p.goto(BASE + "/portal/login?tenant=demo");
await p.getByTestId("portal-email").fill(acc.ali.email); await p.getByTestId("portal-password").fill(acc.ali.pw);
await p.getByTestId("portal-login-submit").click(); await p.getByTestId("portal-code").waitFor({ timeout: 8000 }).catch(() => {});
log("TOTP açıkken kodsuz giriş → kod alanı", (await p.getByTestId("portal-code").count()) === 1);
await scan(p, "portal-login-kod-1280-light");
await p.getByTestId("portal-code").fill(await freshTotp(secret)); await p.getByTestId("portal-login-submit").click();
await p.waitForURL((u) => u.pathname === "/portal", { timeout: 10000 }).catch(() => {});
log("kodla giriş → /portal", new URL(p.url()).pathname === "/portal", p.url());
await p.goto(BASE + "/portal/account");
await p.getByTestId("portal-mfa-off").click();
await p.getByTestId("portal-mfa-disable-form").getByLabel(/şifre/i).first().fill(acc.ali.pw);
await p.getByTestId("portal-mfa-code").fill(await freshTotp(secret)); await p.getByTestId("portal-mfa-disable-confirm").click();
await p.waitForTimeout(1200);
log("TOTP kapat (şifre + kod)", (await p.getByTestId("portal-mfa").getAttribute("data-enabled")) === "false");
// tema koyu + kalıcılık
await p.getByTestId("portal-theme").locator('[data-theme-option="DARK"]').click(); await p.waitForTimeout(800);
await p.reload(); const dark = await p.evaluate(() => document.documentElement.classList.contains("dark"));
log("tema koyu kalıcı (yenileme)", dark);
const pages = [["home", "/portal"], ["oturumlar", "/portal?tab=sessions"], ["oturum-detay", "/portal/sessions/" + ownSess], ["talep-detay", rq], ["hesabim", "/portal/account"], ["yeni-talep", "/portal/new-request"], ["kayit-bulunamadi", "/portal/requests/01M7SH0RS3VNEH0B2GNJQ8B8ZZ"]];
for (const [n, u] of pages) { await p.goto(BASE + u); await p.waitForTimeout(500); await scan(p, `portal-${n}-1280-dark`); }
const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
const mp = await m.newPage(); const wm = watch(mp, "portal-mobile");
for (const [n, u] of pages) { await mp.goto(BASE + u); await mp.waitForTimeout(500); await scan(mp, `portal-${n}-390-dark`); }
await mp.getByTestId("portal-theme").count();
await mp.goto(BASE + "/portal/account"); await mp.getByTestId("portal-theme").locator('[data-theme-option="LIGHT"]').click(); await mp.waitForTimeout(800);
for (const [n, u] of pages) { await mp.goto(BASE + u); await mp.waitForTimeout(500); await scan(mp, `portal-${n}-390-light`); }
await mp.goto(BASE + "/portal"); await mp.getByTestId("portal-user-menu").locator("summary").click(); await mp.waitForTimeout(300); await scan(mp, "portal-menu-acik-390-light", { full: false });
// login ekranları mobil + koyu (oturumsuz)
const anon = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" }); const ap = await anon.newPage();
for (const u of ["/portal/login?tenant=demo", "/portal/login"]) { await ap.goto(BASE + u); await scan(ap, "portal-login" + (u.includes("demo") ? "" : "-slugsuz") + "-390-dark-sistem"); }
rec({ kind: "watch", ...wm }); rec({ kind: "watch", ...w });
console.log(JSON.stringify(w)); console.log(JSON.stringify(wm));
// çerez ayrımı: aynı tarayıcıya panel çerezleri de eklenir
const adminSt = JSON.parse(fs.readFileSync(DIR + "/admin-a.json"));
await ctx.addCookies(adminSt.cookies.filter((c) => c.name !== "rs_theme"));
await p.goto(BASE + "/customers/" + A1); log("aynı tarayıcı: panel açık", (await p.getByTestId("portal-accounts").count()) === 1, p.url());
await p.goto(BASE + "/portal"); log("aynı tarayıcı: portal açık", new URL(p.url()).pathname === "/portal");
const names = (await ctx.cookies()).map((c) => c.name); log("çerez adları", true, names.join(","));
// yalnız portal çerezleri → panel kapalı
const only = await b.newContext({ storageState: { cookies: (await ctx.cookies()).filter((c) => !c.name.startsWith("__Host-rs_session") && c.name !== "__Host-rs_csrf"), origins: [] } });
const op = await only.newPage(); await op.goto(BASE + "/customers/" + A1);
log("portal çereziyle panel → /login", new URL(op.url()).pathname === "/login", op.url());
const meP = await op.evaluate(async () => (await fetch("/api/v1/auth/me")).status); log("portal çereziyle /auth/me → 401", meP === 401, String(meP));
const onlyP = await b.newContext({ storageState: { cookies: adminSt.cookies, origins: [] } });
const pp = await onlyP.newPage(); await pp.goto(BASE + "/portal");
log("panel çereziyle /portal → portal login", pp.url().includes("/portal/login"), pp.url());
const meQ = await pp.evaluate(async () => (await fetch("/api/v1/portal/me")).status); log("panel çereziyle /portal/me → 401", meQ === 401, String(meQ));
// panel token'ını portal adıyla
const sess = adminSt.cookies.find((c) => c.name === "__Host-rs_session").value;
const x = await fetch(BASE + "/api/v1/portal/me", { headers: { cookie: "__Host-rs_portal=" + sess } }); log("panel token'ı __Host-rs_portal adıyla → 401", x.status === 401, String(x.status));
const portalTok = (await ctx.cookies()).find((c) => c.name === "__Host-rs_portal")?.value;
const y = await fetch(BASE + "/api/v1/auth/me", { headers: { cookie: "__Host-rs_session=" + portalTok } }); log("portal token'ı __Host-rs_session adıyla → 401", y.status === 401, String(y.status));
// portal çıkışı paneli kapatmaz
await p.goto(BASE + "/portal"); await p.getByTestId("portal-user-menu").locator("summary").click(); await p.getByTestId("portal-logout").click(); await p.waitForURL(/portal\/login/).catch(() => {});
await p.goto(BASE + "/customers/" + A1); log("portal çıkışından sonra panel hâlâ açık", (await p.getByTestId("portal-accounts").count()) === 1);
await b.close();
