// P10 sayfa taraması: açık/koyu × 1366/375; konsol, 4xx/5xx, axe, taşma, kırık iç link, süre; hata/yükleniyor durumları.
import { chromium, devices, B, WORK, IMG, rec, track, axe, overflow, settle } from "./common.mjs";
import { F, step } from "./lib.mjs";
const S = "scan.jsonl";
const br = await chromium.launch();
const authed = ["/", "/account", "/settings/smtp", "/settings/security", "/settings/support-requests", "/sessions", "/users", "/requests", "/history"];
const pub = ["/login", "/forgot-password", "/reset-password", "/reset-password#token=" + "x".repeat(43)];
const sum = [];
for (const scheme of ["light", "dark"]) for (const vp of ["d1366", "m375"]) {
  for (const [list, state] of [[authed, WORK + "/state-admin.json"], [pub, undefined]]) {
    const opt = vp === "m375" ? { ...devices["iPhone 13"], viewport: { width: 375, height: 800 } } : { viewport: { width: 1366, height: 900 } };
    const ctx = await br.newContext({ ...opt, colorScheme: scheme, ...(state ? { storageState: state } : {}) });
    for (const r of list) {
      const p = await ctx.newPage(); const tag = `${scheme}-${vp} ${r.slice(0, 30)}`; track(p, S, tag);
      const t0 = Date.now(); const resp = await p.goto(B + r, { waitUntil: "networkidle" }).catch((e) => null); const ms = Date.now() - t0;
      await settle(p);
      const ax = await axe(p, S, tag); const ov = await overflow(p, S, tag);
      const name = `scan-${scheme}-${vp}-${r.replace(/[^a-z0-9]+/gi, "_").slice(0, 25) || "root"}.png`;
      await p.screenshot({ path: IMG + name, fullPage: vp === "m375" });
      const links = await p.$$eval("a[href^='/']", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
      sum.push({ tag, status: resp?.status(), url: new URL(p.url()).pathname, ms, axe: ax, ov: ov.doc, inner: ov.inner, links });
      await p.close();
    }
    await ctx.close();
  }
}
// kırık link kontrolü (admin, tekil)
const ctx = await br.newContext({ storageState: WORK + "/state-admin.json" });
const all = [...new Set(sum.flatMap((s) => s.links))];
const broken = [];
for (const l of all) { const r = await ctx.request.get(B + l, { maxRedirects: 5 }); if (r.status() >= 400) broken.push(`${l}=${r.status()}`); }
// hata durumları: API 500 / abort
const p = await ctx.newPage(); track(p, S, "err");
const err = [];
for (const [path, api] of [["/settings/smtp", "**/api/v1/settings/tenant"], ["/settings/security", "**/api/v1/settings/tenant"], ["/account", "**/api/v1/auth/me"]]) {
  await p.route(api, (r) => r.request().method() === "GET" ? r.fulfill({ status: 500, body: '{"code":"INTERNAL"}', contentType: "application/json" }) : r.continue());
  await p.goto(B + path).catch(() => {}); await p.waitForTimeout(1500);
  const txt = (await p.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
  await p.screenshot({ path: IMG + `err500-${path.replace(/\W+/g, "_")}.png` });
  err.push(`${path} (GET 500) → ${new URL(p.url()).pathname}: "${txt}"`);
  await p.unrouteAll();
}
// kaydetmede ağ kesintisi
await p.goto(B + "/settings/smtp"); await p.getByTestId("smtp-form").waitFor();
await p.route("**/api/v1/settings/tenant", (r) => r.request().method() === "PUT" ? r.abort() : r.continue());
await p.getByTestId("smtp-from-name").fill("Ag kesik");
await p.getByTestId("save-bar").getByRole("button", { name: "Kaydet" }).click(); await p.waitForTimeout(1500);
const t = await p.getByTestId("toast").last().innerText().catch(() => "-");
await p.screenshot({ path: IMG + "smtp-save-abort.png" });
err.push(`SMTP kaydet (ağ kesik) → toast "${t}", kaydet çubuğu duruyor=${await p.getByTestId("save-bar").isVisible()}`);
await p.unrouteAll();
// yetkisiz: USER (settings izni yok) — USER hesabı 2FA sıfırlandığı için kapıda; çıkış yapmış ziyaretçi
const anon = await br.newContext(); const a = await anon.newPage();
const un = [];
for (const r of ["/account", "/settings/smtp", "/settings/security", "/2fa/setup", "/login/2fa"]) { await a.goto(B + r); un.push(`${r}→${new URL(a.url()).pathname}${new URL(a.url()).search}`); }
rec(S, { kind: "summary", sum, broken, err, un });
for (const s of sum) console.log(s.tag, s.status, s.url, s.ms + "ms", "axe=" + s.axe.length, s.axe.join(";").slice(0, 200), "taşma=" + s.ov, s.inner.join(",").slice(0, 150));
console.log("kırık:", broken.join(", ") || "yok"); console.log(err.join("\n")); console.log(un.join(", "));
await br.close();
