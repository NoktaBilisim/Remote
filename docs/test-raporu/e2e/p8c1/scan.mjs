// node scan.mjs <storage> <out-prefix> path1 path2 ...
import { chromium, B, DIR, IMG, rec, track, axe, overflow } from "./common.mjs";
const [storage, pre, ...paths] = process.argv.slice(2);
const F = `scan-${pre}.jsonl`;
const views = [["d-light", 1280, "light"], ["d-dark", 1280, "dark"], ["m-light", 390, "light"], ["m-dark", 390, "dark"]];
const br = await chromium.launch();
const links = new Set();
for (const [vn, w, scheme] of views) {
  const ctx = await br.newContext({ storageState: storage === "none" ? undefined : DIR + storage, viewport: { width: w, height: w > 500 ? 900 : 844 }, colorScheme: scheme, isMobile: w < 500, hasTouch: w < 500 });
  const p = await ctx.newPage(); track(p, F, vn);
  for (const path of paths) {
    const t0 = Date.now();
    const resp = await p.goto(B + path, { waitUntil: "networkidle" }).catch((e) => ({ status: () => "ERR " + e.message }));
    const ms = Date.now() - t0;
    const name = `${pre}_${path.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root"}_${vn}`;
    await p.waitForTimeout(400);
    const v = await axe(p, F, `${path} ${vn}`);
    const o = await overflow(p, F, `${path} ${vn}`);
    await p.screenshot({ path: IMG + name + ".png", fullPage: true });
    const h1 = await p.locator("h1").first().innerText().catch(() => "");
    rec(F, { kind: "page", view: vn, path, final: new URL(p.url()).pathname + new URL(p.url()).search, status: resp.status(), ms, h1, axe: v.length, overflow: o.doc, img: name });
    console.log(vn, path, "->", resp.status(), ms + "ms", "axe", v.length, "of", o.doc, o.inner.length, h1);
    if (vn === "d-light") for (const h of await p.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")))) if (h && h.startsWith("/") && !h.startsWith("//")) links.add(h);
  }
  await ctx.close();
}
const ctx = await br.newContext({ storageState: storage === "none" ? undefined : DIR + storage });
for (const l of links) { const r = await ctx.request.get(B + l, { maxRedirects: 0 }).catch(() => null); rec(F, { kind: "link", href: l, status: r?.status() }); if (!r || r.status() >= 400) console.log("LINK", l, r?.status()); }
console.log("links checked", links.size);
await br.close();
