// P12 gerçek server akışları (setup.sh up sonrası; `source $WORK/creds.env`). Sonuç: real-flow.jsonl, ekranlar img/r-*.png
// Sırlar (parolalar, TOTP sırları, geçici şifre) yalnız süreç belleğinde; dosyaya/ekrana yazılmaz.
import { chromium, B, IMG, rec, track, axe, overflow } from "./common.mjs";
import { freshTotp } from "./totp.mjs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const sharp = createRequire("/Users/mennan/Projeler/Remote/apps/web/package.json")("sharp");
const F = "real-flow.jsonl";
const E = { ...process.env };
if (E.RERUN) E.P12_ADMIN_LOGIN = E.P12_ADMIN2_LOGIN;
const used = new Set();
let cur = "";
async function step(name, fn) {
  cur = name;
  try { const note = await fn(); rec(F, { step: name, ok: true, note }); console.log("GEÇTİ", name, "|", JSON.stringify(note ?? "")); }
  catch (e) { rec(F, { step: name, ok: false, err: e.message.slice(0, 500) }); console.log("KALDI", name, "|", e.message.split("\n")[0].slice(0, 300)); }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const sql = (q) => execFileSync("docker", ["exec", E.P12_DB_CONTAINER, "sh", "-c", `MYSQL_PWD="$MYSQL_APP_PASSWORD" mysql -uapp -NB remote -e "$0"`, q], { encoding: "utf8" }).trim();

const br = await chromium.launch();
async function newCtx(o = {}) { const c = await br.newContext({ viewport: { width: 1280, height: 860 }, locale: "tr-TR", ...o }); return c; }
async function login(ctx, id, pw, secretBox) {
  const p = await ctx.newPage();
  track(p, F, () => cur);
  await p.goto(B + "/login");
  await p.locator('[name="login"]').fill(id);
  await p.locator('[name="password"]').fill(pw);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login") || u.pathname === "/login/2fa", { timeout: 20000 }), p.locator('button[type="submit"]').click()]);
  for (let i = 0; i < 4; i++) {
    await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(800);
    const path = new URL(p.url()).pathname;
    if (path === "/change-password") {
      const np = "Yeni-" + Math.random().toString(36).slice(2) + "-P12x!"; secretBox.pw = np;
      await p.locator('[name="current"]').fill(pw); await p.locator('[name="next"]').fill(np); await p.locator('[name="confirm"]').fill(np);
      await p.locator('button[type="submit"]').click(); await p.waitForURL((u) => u.pathname !== "/change-password", { timeout: 15000 });
    } else if (path === "/2fa/setup") {
      const s = (await p.getByTestId("mfa-secret").innerText()).replace(/\s/g, ""); secretBox.secret = s;
      await p.getByTestId("mfa-setup-code").fill(await freshTotp(s, used));
      await p.getByTestId("mfa-enable").click(); await p.getByTestId("rc-saved").check(); await p.getByTestId("rc-done").click();
      await p.waitForURL((u) => u.pathname !== "/2fa/setup", { timeout: 15000 });
    } else if (path === "/login/2fa") {
      await p.getByLabel("6 haneli kod").fill(await freshTotp(secretBox.secret, used));
      await p.getByTestId("mfa-submit").click(); await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
    } else break;
  }
  await p.waitForLoadState("networkidle").catch(() => {});
  return p;
}
async function api(p, method, path, body, raw) {
  return p.evaluate(async ([method, path, body, raw]) => {
    const csrf = document.cookie.match(/(?:^|; )__Host-rs_csrf=([^;]*)/)?.[1] ?? "";
    const r = await fetch(path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), "x-csrf-token": decodeURIComponent(csrf) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const ct = r.headers.get("content-type") ?? "";
    let j = null; if (raw) j = await r.text(); else { try { j = await r.json(); } catch {} }
    return { status: r.status, ct, cd: r.headers.get("content-disposition"), body: j };
  }, [method, path, body, raw]);
}
async function upload(p, path, name, mime, buf) {
  return p.evaluate(async ([path, name, mime, b64]) => {
    const csrf = document.cookie.match(/(?:^|; )__Host-rs_csrf=([^;]*)/)?.[1] ?? "";
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const fd = new FormData(); fd.append("file", new File([bin], name, { type: mime }));
    const r = await fetch(path, { method: "POST", headers: { "x-csrf-token": decodeURIComponent(csrf) }, body: fd });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  }, [path, name, mime, buf.toString("base64")]);
}
const img = (w, h, fmt, opts = {}) => { let s = sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 108, b: 176 } } }); if (opts.exif) s = s.withExif({ IFD0: { Artist: "GIZLI-EXIF-SAHIBI", Copyright: "p12" } }); return s[fmt]().toBuffer(); };
async function fetchImg(p, url) {
  return p.evaluate(async (u) => { const r = await fetch(u); const b = new Uint8Array(await r.arrayBuffer()); let s = ""; for (const x of b) s += String.fromCharCode(x); return { status: r.status, ct: r.headers.get("content-type"), cc: r.headers.get("cache-control"), b64: btoa(s) }; }, url);
}

const SA = {}, AD = {}, AD2 = {};
let sa, ad, adCtx, avatarUrl, otherUser;

await step("R1 Super Admin giriş + 2FA kurulumu → panel", async () => {
  sa = await login(await newCtx(), E.P12_SA_LOGIN, E.P12_SA_PW, SA);
  must(new URL(sa.url()).pathname === "/", "url " + sa.url());
  await sa.screenshot({ path: IMG + "r-sa-home.png" });
  return "panel açıldı";
});
await step("R2 audit PUT/DELETE/PATCH → 405 (gerçek server)", async () => {
  const out = {};
  for (const [m, path] of [["PUT", "/api/v1/audit"], ["DELETE", "/api/v1/audit"], ["DELETE", "/api/v1/audit/1"], ["PATCH", "/api/v1/audit/1"], ["POST", "/api/v1/audit"]]) out[`${m} ${path}`] = (await api(sa, m, path, m === "DELETE" ? undefined : {})).status;
  must(Object.values(out).every((s) => s === 405), JSON.stringify(out));
  return out;
});
await step("R3 audit CSV: formül kaçışı + başlıklar", async () => {
  // Formül ile başlayan kullanıcı adıyla başarısız giriş → audit username alanı "=..."
  const c = await newCtx(); const q = await c.newPage();
  await q.goto(B + "/login");
  await q.locator('[name="login"]').fill("=HYPERLINK(\"http://x\")");
  await q.locator('[name="password"]').fill("yanlis-parola-123");
  await q.locator('button[type="submit"]').click(); await q.waitForTimeout(1500); await c.close();
  const r = await api(sa, "GET", "/api/v1/audit/export.csv", undefined, true);
  must(r.status === 200, "status " + r.status);
  const lines = r.body.split(/\r?\n/);
  const bad = lines.filter((l) => /(^|[;,])"?[=+\-@]/.test(l) && !/(^|[;,])"?'[=+\-@]/.test(l));
  const hit = lines.find((l) => /hyperlink/i.test(l));
  must(hit, "HYPERLINK satırı yok");
  must(/'=hyperlink/i.test(hit), "kaçışsız: " + hit.slice(0, 200));
  return { ct: r.ct, cd: r.cd, satir: lines.length, bom: r.body.charCodeAt(0) === 0xfeff, ornek: hit.slice(0, 160), supheli: bad.length };
});
await step("R4 /audit Super Admin 1280 + 390: liste, taşma (P11 Bulgu 1 tekrar)", async () => {
  await sa.goto(B + "/audit"); await sa.waitForLoadState("networkidle");
  const rows = await sa.locator('[data-testid="audit-row"]').count();
  const o = await overflow(sa); const a = await axe(sa);
  await sa.screenshot({ path: IMG + "r-sa-audit-1280.png" });
  await sa.setViewportSize({ width: 390, height: 844 }); await sa.reload(); await sa.waitForLoadState("networkidle");
  const o2 = await overflow(sa);
  await sa.setViewportSize({ width: 1280, height: 860 });
  return { rows, of1280: o.doc, of390: o2.doc, axe: a };
});
let tenantB;
if (E.SA_ONLY) { await br.close(); process.exit(0); }
await step("R5 ikinci firma + USER (başka tenant) oluştur", async () => {
  const t = await api(sa, "POST", "/api/v1/admin/tenants", { name: "Diğer Firma P12", slug: "diger-p12" });
  must(t.status === 201 || t.status === 200, "tenant " + t.status + JSON.stringify(t.body));
  tenantB = t.body.id;
  const sw = await api(sa, "POST", "/api/v1/admin/switch-tenant", { tenantId: tenantB });
  must(sw.status === 200, "switch " + sw.status + JSON.stringify(sw.body));
  const u = await api(sa, "POST", "/api/v1/users", { email: "diger-user@p12op.invalid", fullName: "Diğer Kullanıcı", role: "USER" });
  must(u.status === 201 || u.status === 200, "user " + u.status + JSON.stringify(u.body));
  otherUser = { email: "diger-user@p12op.invalid", temp: u.body.temporaryPassword };
  await api(sa, "POST", "/api/v1/admin/switch-tenant", { tenantId: null });
  return { tenant: t.status, user: u.status };
});
await step("R6 Admin (Demo) giriş + 2FA; /account Görünüm + avatar bölümü", async () => {
  adCtx = await newCtx();
  ad = await login(adCtx, E.P12_ADMIN_LOGIN, E.P12_ADMIN_PW, AD);
  await ad.goto(B + "/account"); await ad.waitForLoadState("networkidle");
  must(await ad.getByTestId("avatar-uploader").getAttribute("data-has-avatar") === "false", "başta avatar var");
  await ad.screenshot({ path: IMG + "r-admin-account.png", fullPage: true });
  return { initials: (await ad.getByTestId("current-user-avatar").innerText()).trim() };
});
await step("R7 avatar hatalı dosyalar (sunucu): SVG, sahte uzantı, 2 MB+, GIF → reddedilir", async () => {
  const out = {};
  out.svg = await upload(ad, "/api/v1/users/me/avatar", "x.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'));
  out.svgAsPng = await upload(ad, "/api/v1/users/me/avatar", "x.png", "image/png", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  out.text = await upload(ad, "/api/v1/users/me/avatar", "sahte.png", "image/png", Buffer.from("bu bir resim degil"));
  out.big = await upload(ad, "/api/v1/users/me/avatar", "buyuk.png", "image/png", Buffer.concat([await img(10, 10, "png"), Buffer.alloc(2 * 1024 * 1024 + 10)]));
  out.gif = await upload(ad, "/api/v1/users/me/avatar", "a.gif", "image/gif", await img(20, 20, "gif"));
  const s = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, `${v.status} ${v.body?.error?.code ?? ""} ${(v.body?.error?.fields && JSON.stringify(v.body.error.fields)) || v.body?.error?.message || ""}`.slice(0, 120)]));
  must(Object.values(out).every((v) => v.status >= 400 && v.status < 500), JSON.stringify(s));
  return s;
});
await step("R8 avatar UI: JPEG (EXIF'li) → kırp → kaydet → üst menüde; dosya 256 px webp, EXIF yok", async () => {
  await ad.goto(B + "/account"); await ad.waitForLoadState("networkidle");
  await ad.getByTestId("avatar-uploader-input").setInputFiles({ name: "ben.jpg", mimeType: "image/jpeg", buffer: await img(800, 500, "jpeg", { exif: true }) });
  const dlg = ad.getByTestId("avatar-crop-dialog");
  await dlg.waitFor({ state: "visible" });
  await ad.screenshot({ path: IMG + "r-avatar-crop.png" });
  const a = await axe(ad, '[data-testid="avatar-crop-dialog"]');
  await dlg.getByTestId("avatar-crop-save").click();
  await ad.locator("img[data-testid=current-user-avatar]").waitFor({ timeout: 10000 });
  avatarUrl = await ad.locator("img[data-testid=current-user-avatar]").getAttribute("src");
  const f = await fetchImg(ad, avatarUrl);
  const buf = Buffer.from(f.b64, "base64"); const meta = await sharp(buf).metadata();
  must(f.status === 200 && f.ct === "image/webp" && meta.width === 256 && meta.height === 256, JSON.stringify({ s: f.status, ct: f.ct, w: meta.width, h: meta.height }));
  must(!meta.exif && !buf.includes(Buffer.from("GIZLI-EXIF")), "EXIF kalmış");
  const disk = execFileSync("sh", ["-c", `ls "$WORK/uploads"/*/ 2>/dev/null | head -5`], { encoding: "utf8" }).trim().split("\n");
  await ad.screenshot({ path: IMG + "r-avatar-saved.png" });
  return { url: avatarUrl.replace(/[A-Za-z0-9_-]{20,}/, "<rastgele>"), ct: f.ct, cc: f.cc, size: `${meta.width}x${meta.height}`, exif: !!meta.exif, axeCrop: a, diskOrnek: disk.slice(0, 2).map((x) => x.replace(/[A-Za-z0-9_-]{20,}/, "<rastgele>")) };
});
await step("R9 avatar başka tenant kullanıcısına 404, Super Admin'e 200, oturumsuz 401", async () => {
  // diğer firma kullanıcısı: ilk giriş → şifre değiştir
  const c = await newCtx(); const q = await c.newPage();
  await q.goto(B + "/login");
  await q.locator('[name="login"]').fill(otherUser.email); await q.locator('[name="password"]').fill(otherUser.temp);
  await q.locator('button[type="submit"]').click();
  await q.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
  const newPw = "Yeni-" + Math.random().toString(36).slice(2) + "-P12x!";
  if (q.url().includes("/change-password")) {
    await q.locator('[name="current"]').fill(otherUser.temp); await q.locator('[name="next"]').fill(newPw); await q.locator('[name="confirm"]').fill(newPw);
    await q.locator('button[type="submit"]').click(); await q.waitForURL((u) => !u.pathname.startsWith("/change-password"), { timeout: 15000 });
  }
  const other = await fetchImg(q, avatarUrl);
  const saR = await fetchImg(sa, avatarUrl);
  const anon = (await (await br.newContext()).request.get(B + avatarUrl)).status();
  const guess = (await fetchImg(q, avatarUrl.replace(/\/avatar\/[^/]+\//, `/avatar/${tenantB}/`))).status;
  await c.close();
  must(other.status === 404 && saR.status === 200 && anon === 401, JSON.stringify({ other: other.status, sa: saR.status, anon }));
  return { baskaTenant: other.status, superAdmin: saR.status, oturumsuz: anon, kendiTenantYoluylaTahmin: guess };
});
await step("R10 avatar WEBP ve uç oran (3000x40 PNG) yükleme; kaldır", async () => {
  const w = await upload(ad, "/api/v1/users/me/avatar", "a.webp", "image/webp", await img(300, 300, "webp"));
  const ext = await upload(ad, "/api/v1/users/me/avatar", "uzun.png", "image/png", await img(3000, 40, "png"));
  const rm = await api(ad, "DELETE", "/api/v1/users/me/avatar");
  const old = await fetchImg(ad, avatarUrl);
  must(w.status === 200, "webp " + w.status + JSON.stringify(w.body));
  return { webp: w.status, ucOran: `${ext.status} ${ext.body?.error?.code ?? ""} ${JSON.stringify(ext.body?.error?.fields ?? "")}`, kaldir: rm.status, eskiDosya: old.status };
});
await step("R11 uç oranlı resim UI'da (kırpma diyaloğu) — 3000x40", async () => {
  await ad.goto(B + "/account"); await ad.waitForLoadState("networkidle");
  await ad.getByTestId("avatar-uploader-input").setInputFiles({ name: "uzun.png", mimeType: "image/png", buffer: await img(3000, 40, "png") });
  await ad.waitForTimeout(800);
  const open = await ad.getByTestId("avatar-crop-dialog").evaluate((d) => d.open);
  const err = await ad.getByTestId("avatar-uploader-error").textContent().catch(() => null);
  await ad.screenshot({ path: IMG + "r-avatar-extreme.png" });
  if (open) { await ad.getByTestId("avatar-crop-save").click(); await ad.waitForTimeout(1500); }
  const toast = await ad.getByTestId("toast").last().textContent().catch(() => null);
  const err2 = await ad.getByTestId("avatar-uploader-error").textContent().catch(() => null);
  await ad.screenshot({ path: IMG + "r-avatar-extreme-after.png" });
  return { diyalogAcik: open, hata: err, toast, hataSonra: err2 };
});
let logoUrl;
await step("R12 firma logosu UI: PNG önizle → kaydet → üst menü; dosya ≤512 px png; login ?tenant=demo", async () => {
  await ad.goto(B + "/settings/logo"); await ad.waitForLoadState("networkidle");
  await ad.getByTestId("logo-uploader-input").setInputFiles({ name: "firma.jpg", mimeType: "image/jpeg", buffer: await img(1600, 400, "jpeg", { exif: true }) });
  await ad.getByTestId("logo-uploader-preview").waitFor();
  await ad.screenshot({ path: IMG + "r-logo-preview.png" });
  await ad.getByTestId("logo-uploader-save").click();
  await ad.locator('[data-testid="header-logo"][data-logo="custom"]').waitFor({ timeout: 10000 });
  logoUrl = await ad.getByTestId("header-logo").locator("img").first().getAttribute("src");
  const f = await fetchImg(ad, logoUrl); const meta = await sharp(Buffer.from(f.b64, "base64")).metadata();
  const anonCtx = await newCtx(); const lp = await anonCtx.newPage(); track(lp, F, () => cur);
  await lp.goto(B + "/login?tenant=demo"); const lg = await lp.getByTestId("login-logo").getAttribute("data-logo");
  await lp.screenshot({ path: IMG + "r-login-tenant.png" });
  await lp.goto(B + "/login"); const lg2 = await lp.getByTestId("login-logo").getAttribute("data-logo");
  const pub = (await anonCtx.request.get(B + logoUrl)).status();
  const brand = await (await anonCtx.request.get(B + "/api/v1/public/branding?tenant=demo")).json().catch(() => null);
  await anonCtx.close();
  await ad.screenshot({ path: IMG + "r-logo-saved.png" });
  must(f.status === 200 && f.ct === "image/png" && meta.width <= 512 && !meta.exif && lg === "custom" && lg2 === "system", JSON.stringify({ s: f.status, ct: f.ct, w: meta.width, lg, lg2 }));
  return { boyut: `${meta.width}x${meta.height}`, ct: f.ct, cc: f.cc, loginTenant: lg, loginBos: lg2, oturumsuzDosya: pub, branding: brand && { name: brand.name, logo: !!brand.logoUrl } };
});
await step("R12b firma logosu uç oran (3000x40 PNG) UI → sonuç ve mesaj", async () => {
  await ad.goto(B + "/settings/logo"); await ad.waitForLoadState("networkidle");
  await ad.getByTestId("logo-uploader-input").setInputFiles({ name: "uzun-logo.png", mimeType: "image/png", buffer: await img(3000, 40, "png") });
  await ad.getByTestId("logo-uploader-preview").waitFor();
  await ad.getByTestId("logo-uploader-save").click(); await ad.waitForTimeout(2000);
  const err = await ad.getByTestId("logo-uploader-error").textContent().catch(() => null);
  const toast = await ad.getByTestId("toast").last().textContent().catch(() => null);
  await ad.screenshot({ path: IMG + "r-logo-extreme.png" });
  const api2 = await upload(ad, "/api/v1/settings/logo", "uzun.png", "image/png", await img(3000, 40, "png"));
  const sq = await upload(ad, "/api/v1/settings/logo", "kucuk.png", "image/png", await img(8, 8, "png"));
  return { uiHata: err, toast, api: `${api2.status} ${api2.body?.error?.code} ${api2.body?.error?.message}`, kucuk8px: `${sq.status} ${sq.body?.error?.code ?? ""}` };
});
await step("R13 firma logosu: SVG ve sahte uzantı sunucuda reddi", async () => {
  const svg = await upload(ad, "/api/v1/settings/logo", "l.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  const fake = await upload(ad, "/api/v1/settings/logo", "l.png", "image/png", Buffer.from("%PDF-1.4 sahte"));
  must(svg.status === 400 && fake.status === 400, `${svg.status} ${fake.status}`);
  return { svg: `${svg.status} ${svg.body?.error?.code}`, sahte: `${fake.status} ${fake.body?.error?.code}` };
});
await step("R14 müşteri sayfası /session/[token] firma logosu", async () => {
  const s = await api(ad, "POST", "/api/v1/sessions", {});
  must(s.status === 201 || s.status === 200, "session " + s.status);
  const path = new URL(s.body.link).pathname + new URL(s.body.link).hash;
  const c = await newCtx(); const g = await c.newPage(); track(g, F, () => cur);
  await g.goto(B + path); await g.getByTestId("guest-logo").waitFor();
  const kind = await g.getByTestId("guest-logo").getAttribute("data-logo");
  const ok = await g.getByTestId("guest-logo").locator("img").evaluate((i) => i.complete && i.naturalWidth > 0);
  await g.screenshot({ path: IMG + "r-guest-logo.png" });
  await c.close();
  must(kind === "custom" && ok, kind + " " + ok);
  return { logo: kind, yuklendi: ok };
});
await step("R15 firma logosu kaldır → sistem logosu; eski dosya 404", async () => {
  await ad.goto(B + "/settings/logo"); await ad.waitForLoadState("networkidle");
  await ad.getByTestId("logo-uploader-remove").click();
  await ad.getByTestId("logo-remove-confirm").click();
  await ad.locator('[data-testid="header-logo"][data-logo="system"]').waitFor({ timeout: 10000 });
  const old = (await (await br.newContext()).request.get(B + logoUrl)).status();
  must(old === 404, "eski logo " + old);
  return { eskiDosya: old };
});
await step("R16 tema: menüden Koyu → PATCH 200 + rs_theme çerezi; yenilemede ilk HTML class=dark; başka cihaz DB'den", async () => {
  await ad.goto(B + "/"); await ad.waitForLoadState("networkidle");
  await ad.getByTestId("user-menu").locator("summary").click();
  const resp = ad.waitForResponse((r) => r.url().endsWith("/api/v1/auth/me/preferences") && r.request().method() === "PATCH");
  await ad.getByTestId("user-menu-theme").getByRole("button", { name: "Koyu" }).click();
  const r = await resp;
  const ck = (await adCtx.cookies()).find((c) => c.name === "rs_theme");
  const html = await (await ad.request.get(B + "/")).text();
  const first = /<html[^>]*>/.exec(html)?.[0];
  await ad.screenshot({ path: IMG + "r-theme-dark-menu.png" });
  const db = sql(`SELECT theme FROM users WHERE email='${E.P12_ADMIN_LOGIN}'`);
  // başka cihaz: yeni bağlam, çerez yok → giriş → ilk HTML koyu
  const c2 = await newCtx({ colorScheme: "light" });
  const p2 = await login(c2, E.P12_ADMIN_LOGIN, AD.pw ?? E.P12_ADMIN_PW, AD);
  const cls = await p2.evaluate(() => document.documentElement.className);
  const html2 = /<html[^>]*>/.exec(await (await p2.request.get(B + "/sessions")).text())?.[0];
  await p2.screenshot({ path: IMG + "r-theme-other-device.png" });
  await c2.close();
  must(r.status() === 200 && ck && /dark/.test(first) && db === "DARK" && /dark/.test(cls), JSON.stringify({ st: r.status(), ck: ck?.value, first, db, cls }));
  return { patch: r.status(), cerez: { value: ck.value, httpOnly: ck.httpOnly, sameSite: ck.sameSite, secure: ck.secure }, ilkHtml: first, db, baskaCihaz: cls, baskaCihazIlkHtml: html2 };
});
await step("R17 tema: Sistem'e dön → html sınıfsız, DB SYSTEM", async () => {
  await ad.goto(B + "/account"); await ad.waitForLoadState("networkidle");
  await ad.getByTestId("acc-theme").getByRole("button", { name: "Sistem" }).click();
  await ad.waitForTimeout(800);
  const cls = await ad.evaluate(() => document.documentElement.className);
  return { cls, db: sql(`SELECT theme FROM users WHERE email='${E.P12_ADMIN_LOGIN}'`) };
});
await step("R18 Super Admin sistem logosu yükle → /login'de", async () => {
  await sa.goto(B + "/admin/settings/system-logo"); await sa.waitForLoadState("networkidle");
  await sa.getByTestId("system-logo-uploader-input").setInputFiles({ name: "sys.webp", mimeType: "image/webp", buffer: await img(900, 300, "webp") });
  await sa.getByTestId("system-logo-uploader-save").click();
  await sa.locator('[data-testid="system-logo-uploader"][data-custom="true"]').waitFor({ timeout: 10000 });
  await sa.screenshot({ path: IMG + "r-system-logo.png", fullPage: true });
  const c = await newCtx(); const lp = await c.newPage();
  await lp.goto(B + "/login");
  const src = await lp.getByTestId("login-logo").locator("img").first().getAttribute("src");
  await lp.screenshot({ path: IMG + "r-login-system-custom.png" });
  await c.close();
  return { loginLogoSrc: src?.replace(/[A-Za-z0-9_-]{20,}/, "<rastgele>") };
});
await step("R19 audit kayıtları: marka olayları yazıldı", async () => {
  const rows = sql("SELECT action, result, COUNT(*) FROM audit_logs WHERE action LIKE '%logo%' OR action LIKE '%avatar%' OR action LIKE '%theme%' OR action LIKE '%preference%' GROUP BY action, result");
  must(rows.length > 0, "marka audit kaydı yok");
  return rows.split("\n");
});
await br.close();
