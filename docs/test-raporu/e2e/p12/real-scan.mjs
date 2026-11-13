// P12 gerçek server regresyon taraması: Super Admin + Admin (Demo) ile tüm panel rotaları, açık/koyu × 1280/390.
// Önce tek giriş (şifre değişimi + 2FA) → storageState ($WORK, repo dışı) → her görünüm yeni bağlam. Çıktı real-scan.jsonl, img/s-*.png
import { chromium, B, IMG, rec, track, axe, overflow, links, slug } from "./common.mjs";
import { freshTotp } from "./totp.mjs";
const F = "real-scan.jsonl", E = process.env, used = new Set();
let cur = "";
const br = await chromium.launch();
async function loginState(id, pw, file) {
  const c = await br.newContext(); const p = await c.newPage();
  await p.goto(B + "/login"); await p.locator('[name="login"]').fill(id); await p.locator('[name="password"]').fill(pw);
  await p.locator('button[type="submit"]').click();
  for (let i = 0; i < 4; i++) {
    await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(1000);
    const path = new URL(p.url()).pathname;
    if (path === "/change-password") { const np = "Yeni-" + Math.random().toString(36).slice(2) + "-P12x!"; await p.locator('[name="current"]').fill(pw); await p.locator('[name="next"]').fill(np); await p.locator('[name="confirm"]').fill(np); await p.locator('button[type="submit"]').click(); }
    else if (path === "/2fa/setup") { const s = (await p.getByTestId("mfa-secret").innerText()).replace(/\s/g, ""); await p.getByTestId("mfa-setup-code").fill(await freshTotp(s, used)); await p.getByTestId("mfa-enable").click(); await p.getByTestId("rc-saved").check(); await p.getByTestId("rc-done").click(); }
    else break;
  }
  await c.storageState({ path: file }); await c.close();
}
const SAF = E.WORK + "/sa.json", ADF = E.WORK + "/ad.json";
await loginState(E.P12_SA_LOGIN, E.P12_SA_PW, SAF);
await loginState(E.P12_ADMIN_LOGIN, E.P12_ADMIN_PW, ADF);
const routes = {
  sa: ["/", "/sessions", "/requests", "/customers", "/history", "/users", "/admin/tenants", "/audit", "/admin/settings/mysql", "/admin/settings/turn", "/admin/settings/system-logo", "/account", "/settings/logo", "/yok-boyle-sayfa"],
  ad: ["/", "/sessions", "/requests", "/customers", "/history", "/users", "/settings/support-requests", "/settings/smtp", "/settings/security", "/settings/consent-text", "/settings/logo", "/audit", "/account", "/admin/settings/system-logo"],
  anon: ["/login", "/login?tenant=demo", "/login?tenant=yok-firma", "/forgot-password", "/audit", "/settings/logo"],
};
const linkSet = new Map();
for (const scheme of ["light", "dark"]) for (const width of [1280, 390]) for (const [who, list] of Object.entries(routes)) {
  const ctx = await br.newContext({ viewport: { width, height: width > 600 ? 860 : 844 }, colorScheme: scheme, locale: "tr-TR", storageState: who === "sa" ? SAF : who === "ad" ? ADF : undefined, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const p = await ctx.newPage(); track(p, F, () => cur);
  for (const r of list) {
    cur = `${who} ${scheme} ${width} ${r}`;
    const t0 = Date.now();
    const resp = await p.goto(B + r, { waitUntil: "networkidle" }).catch((e) => null);
    const ms = Date.now() - t0; await p.waitForTimeout(250);
    const a = await axe(p).catch((e) => ["axe-err " + e.message.slice(0, 80)]);
    const o = await overflow(p);
    for (const l of await links(p)) if (!linkSet.has(l)) linkSet.set(l, cur);
    const htmlCls = await p.evaluate(() => document.documentElement.className);
    await p.screenshot({ path: `${IMG}s-${scheme}-${width}-${who}-${slug(r)}.png`, fullPage: true });
    rec(F, { kind: "page", tag: cur, status: resp?.status(), finalUrl: new URL(p.url()).pathname + new URL(p.url()).search, ms, axe: a, overflow: o, htmlCls });
    console.log(cur, resp?.status(), new URL(p.url()).pathname, ms + "ms", "axe", a.length, "of", o.doc, o.inner.length);
  }
  if (who !== "anon") { // hesap menüsü açık
    cur = `${who} ${scheme} ${width} menu`;
    await p.goto(B + "/", { waitUntil: "networkidle" });
    await p.getByTestId("user-menu").locator("summary").click(); await p.waitForTimeout(300);
    const a = await axe(p, '[data-testid="user-menu"]'); const o = await overflow(p);
    await p.screenshot({ path: `${IMG}s-${scheme}-${width}-${who}-menu.png` });
    rec(F, { kind: "page", tag: cur, axe: a, overflow: o });
    console.log(cur, "axe", a.length, "of", o.doc);
    // klavye: Esc kapatır, odak tetikleyiciye döner
    await p.keyboard.press("Escape"); await p.waitForTimeout(150);
    const k = await p.evaluate(() => ({ open: document.querySelector('[data-testid="user-menu"]')?.open, focus: document.activeElement?.tagName + "." + (document.activeElement?.closest('[data-testid="user-menu"]') ? "menu" : "") }));
    rec(F, { kind: "kbd", tag: cur, ...k }); console.log("  kbd", JSON.stringify(k));
  }
  await ctx.close();
}
const ctx = await br.newContext({ storageState: SAF });
for (const [l, from] of linkSet) { const r = await ctx.request.get(B + l, { maxRedirects: 0 }).catch(() => null); const st = r?.status(); if (!st || st >= 400) { rec(F, { kind: "brokenlink", link: l, from, status: st }); console.log("KIRIK", l, st, from); } }
rec(F, { kind: "links", count: linkSet.size, list: [...linkSet.keys()] }); console.log("link", linkSet.size);
await br.close();
