// P13a operatör betikleri ortak yardımcı (P10 common.mjs'ten). Gizli değer içermez.
import { createRequire } from "node:module";
import { appendFileSync, mkdirSync } from "node:fs";
const req = createRequire("/Users/mennan/Projeler/Remote/apps/web/package.json");
export const { chromium, devices } = req("@playwright/test");
export const AxeBuilder = req("@axe-core/playwright").default;
export const B = process.env.P11_BASE ?? "http://localhost:3217";
export const WORK = process.env.WORK;
export const DIR = new URL(".", import.meta.url).pathname;
export const IMG = DIR + "img/";
mkdirSync(IMG, { recursive: true });
export const rec = (file, o) => appendFileSync(DIR + file, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");
export function track(p, file, tag) {
  p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") rec(file, { tag: tag(), kind: "console", type: m.type(), text: m.text().slice(0, 300), url: p.url() }); });
  p.on("pageerror", (e) => rec(file, { tag: tag(), kind: "pageerror", text: e.message.slice(0, 300), url: p.url() }));
  p.on("response", (r) => { if (r.status() >= 400) rec(file, { tag: tag(), kind: "http", status: r.status(), method: r.request().method(), url: r.url().replace(/[?#].*/, "") }); });
}
export async function settle(p) {
  await p.mouse.move(0, 0).catch(() => {});
  await p.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
}
export async function axe(p, include) {
  await settle(p);
  let b = new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).setLegacyMode(true);
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations.map((x) => `${x.id}(${x.impact}): ${x.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
}
export async function overflow(p) {
  return p.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const doc = document.documentElement.scrollWidth - W;
    const inner = Array.from(document.querySelectorAll("body *")).filter((el) => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return r.width > 0 && r.right > W + 1 && cs.position !== "fixed" && cs.visibility !== "hidden" && !el.closest('[class*="overflow-x-auto"],[class*="overflow-auto"],dialog:not([open])');
    }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}[${el.dataset.testid ?? el.className.toString().slice(0, 50)}] right=${Math.round(el.getBoundingClientRect().right)}`);
    return { doc, inner };
  });
}
export async function links(p) {
  return p.evaluate(() => [...new Set([...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => h.startsWith("/") && !h.startsWith("//")))]);
}
export const slug = (s) => s.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
