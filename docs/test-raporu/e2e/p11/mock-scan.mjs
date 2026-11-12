// P11 tarama — sahte API (e2e/mock-api.mjs :4217) + üretim derlemesi (:3217). Senaryo çerezleri mock-audit.mjs.
// Her senaryo × rota × tema (light/dark) × genişlik (1280/390): HTTP durumu, konsol/JS hatası, 4xx/5xx, axe, taşma, iç link, ekran.
// Çıktı: mock-scan.jsonl, img/m-*.png
import { chromium, B, IMG, rec, track, axe, overflow, links, slug } from "./common.mjs";
const F = "mock-scan.jsonl";
const plan = {
  auadm: ["/", "/audit", "/audit?action=auth.*&result=fail", "/audit?result=hepsi", "/settings/consent-text", "/admin/settings", "/admin/settings/mysql", "/admin/settings/turn"],
  ausa: ["/", "/audit", "/admin/settings", "/admin/settings/mysql", "/admin/settings/turn", "/settings/consent-text"],
  auview: ["/", "/audit", "/settings/consent-text"],
  aunone: ["/", "/audit", "/settings/consent-text"],
  auempty: ["/audit"],
  aubroken: ["/audit"],
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
    const finalUrl = new URL(p.url()).pathname + new URL(p.url()).search;
    const a = await axe(p).catch((e) => ["axe-err " + e.message]);
    const o = await overflow(p);
    for (const l of await links(p)) if (!linkSet.has(l)) linkSet.set(l, cur);
    const title = await p.title();
    await p.screenshot({ path: `${IMG}m-${scheme}-${width}-${sc}-${slug(r)}.png`, fullPage: true });
    rec(F, { kind: "page", tag: cur, status: resp?.status?.(), finalUrl, ms, title, axe: a, overflow: o });
    console.log(cur, resp?.status?.(), finalUrl, ms + "ms", "axe", a.length, "of", o.doc, o.inner.length);
  }
  await ctx.close();
}
// iç link kontrolü (auadm + ausa çerezli istekle)
const ctx = await br.newContext();
for (const sc of ["auadm", "ausa"]) {
  const v = `u-${sc}-${Math.random().toString(36).slice(2)}`;
  for (const [l, from] of linkSet) {
    const r = await ctx.request.get(B + l, { headers: { cookie: `__Host-rs_session=${v}; __Host-rs_csrf=csrf-test-token` }, maxRedirects: 0 }).catch(() => null);
    const st = r?.status();
    if (!st || st >= 400) { rec(F, { kind: "brokenlink", sc, link: l, from, status: st }); console.log("KIRIK", sc, l, st, from); }
  }
}
rec(F, { kind: "links", count: linkSet.size, list: [...linkSet.keys()] });
console.log("link sayısı", linkSet.size);
await br.close();
