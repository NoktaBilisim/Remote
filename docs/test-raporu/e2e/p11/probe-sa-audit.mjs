// Super Admin /audit 1280 px: yatay taşmanın kaynağı (Firma sütunu ile tablo genişliği)
import { chromium, B, IMG } from "./common.mjs";
const br = await chromium.launch();
for (const w of [1280, 1366, 1440, 1536]) {
  const ctx = await br.newContext({ viewport: { width: w, height: 800 }, locale: "tr-TR" });
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" };
  await ctx.addCookies([{ ...base, name: "__Host-rs_session", value: "u-ausa-" + Math.random().toString(36).slice(2), httpOnly: true }, { ...base, name: "__Host-rs_csrf", value: "csrf-test-token" }]);
  const p = await ctx.newPage();
  await p.goto(B + "/audit", { waitUntil: "networkidle" });
  const info = await p.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const t = document.querySelector('[data-testid="audit-table"]');
    const wrap = t?.parentElement;
    const cs = wrap ? getComputedStyle(wrap) : null;
    const btn = document.querySelector('[data-testid="audit-detail-open"]')?.getBoundingClientRect();
    const main = document.querySelector("main")?.getBoundingClientRect();
    return { W, docScroll: document.documentElement.scrollWidth, table: t?.getBoundingClientRect().width, tableRight: t?.getBoundingClientRect().right, wrapOverflowX: cs?.overflowX, wrapRight: wrap?.getBoundingClientRect().right, wrapClass: wrap?.className, detailBtnRight: btn?.right, mainRight: main?.right, mainScroll: document.querySelector("main")?.scrollWidth };
  });
  console.log(w, JSON.stringify(info));
  if (w === 1280) { await p.locator('[data-testid="audit-table"]').screenshot({ path: IMG + "sa-audit-1280-table.png" }); }
  await ctx.close();
}
await br.close();
