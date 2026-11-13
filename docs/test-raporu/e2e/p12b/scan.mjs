// P12b tarama — sahte API (e2e/mock-api.mjs :4217) + üretim derlemesi (:3217). Senaryo çerezleri mock-audit.mjs.
// Senaryo × rota × tema × genişlik: HTTP, konsol/JS hatası, 4xx/5xx, axe, taşma, iç link, ekran görüntüsü. Çıktı: scan.jsonl, img/s-*.png
import { chromium, B, IMG, rec, track, axe, overflow, links, slug } from "./common.mjs";
const F = "scan.jsonl";
const WA = "/admin/settings/whatsapp";
const plan = {
  ausa: ["/admin/settings", "/admin/settings/mysql", "/admin/settings/turn", "/admin/settings/system-logo", WA],
  ausawa0: [WA], ausains: [WA], ausabrk: [WA], auadm: [WA, "/admin/settings"], auview: [WA], aunone: [WA],
};
const br = await chromium.launch();
const linkSet = new Map();
let cur = "";
for (const scheme of ["light", "dark"]) for (const width of [1280, 390]) for (const [sc, routes] of Object.entries(plan)) {
  const ctx = await br.newContext({ viewport: { width, height: width > 600 ? 800 : 844 }, colorScheme: scheme, locale: "tr-TR", ...(width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const v = `u-${sc}-${Math.random().toString(36).slice(2)}`;
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" };
  await ctx.addCookies([{ ...base, name: "__Host-rs_session", value: v, httpOnly: true }, { ...base, name: "__Host-rs_csrf", value: "csrf-test-token" }]);
  const p = await ctx.newPage();
  track(p, F, () => cur);
  for (const r of routes) {
    cur = `${sc} ${scheme} ${width} ${r}`;
    const t0 = Date.now();
    const resp = await p.goto(B + r, { waitUntil: "networkidle" }).catch((e) => ({ status: () => "ERR " + e.message }));
    const ms = Date.now() - t0;
    await p.waitForTimeout(300);
    const finalUrl = new URL(p.url()).pathname;
    const a = await axe(p).catch((e) => ["axe-err " + e.message]);
    const o = await overflow(p);
    for (const l of await links(p)) if (!linkSet.has(l)) linkSet.set(l, cur);
    const title = await p.title();
    await p.screenshot({ path: `${IMG}s-${scheme}-${width}-${sc}-${slug(r)}.png`, fullPage: true });
    rec(F, { kind: "page", tag: cur, status: resp?.status?.(), finalUrl, ms, title, axe: a, overflow: o });
    console.log(cur, resp?.status?.(), finalUrl, ms + "ms", title, "axe", a.length, a.join("|"), "of", o.doc, o.inner.join(","));
  }
  await ctx.close();
}
const ctx = await br.newContext();
for (const sc of ["ausa", "auadm"]) {
  const v = `u-${sc}-${Math.random().toString(36).slice(2)}`;
  for (const [l, from] of linkSet) {
    const r = await ctx.request.get(B + l, { headers: { cookie: `__Host-rs_session=${v}; __Host-rs_csrf=csrf-test-token` }, maxRedirects: 0 }).catch(() => null);
    const st = r?.status();
    if (!st || st >= 400) { rec(F, { kind: "brokenlink", sc, link: l, from, status: st }); console.log("KIRIK", sc, l, st, from); }
  }
}
rec(F, { kind: "links", count: linkSet.size });
console.log("link sayısı", linkSet.size);
await br.close();
