import { chromium, B } from "./common.mjs";
const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1280, height: 800 }, locale: "tr-TR" });
const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" };
await ctx.addCookies([{ ...base, name: "__Host-rs_session", value: "u-ausa-x" + Math.random().toString(36).slice(2), httpOnly: true }, { ...base, name: "__Host-rs_csrf", value: "csrf-test-token" }]);
const p = await ctx.newPage();
await p.goto(B + "/audit", { waitUntil: "networkidle" });
console.log(await p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.right > 1281 && getComputedStyle(el).position !== "static") out.push(`${el.tagName}.${String(el.className).slice(0,80)} right=${Math.round(r.right)} pos=${getComputedStyle(el).position} txt=${el.textContent.slice(0,30)} sw=${el.scrollWidth} cw=${el.clientWidth}`);
  }
  const chain = []; let e = document.querySelector('[data-testid="audit-table"]');
  while (e) { const cs = getComputedStyle(e); chain.push(`${e.tagName}.${String(e.className).slice(0,60)} ox=${cs.overflowX} w=${Math.round(e.getBoundingClientRect().width)} sw=${e.scrollWidth}`); e = e.parentElement; }
  return out.slice(0, 15).join("\n") + "\n--chain--\n" + chain.join("\n");
}));
await br.close();
