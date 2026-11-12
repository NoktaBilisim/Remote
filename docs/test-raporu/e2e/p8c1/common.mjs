import { createRequire } from "node:module";
import { appendFileSync, mkdirSync } from "node:fs";
const req = createRequire("/Users/mennan/Projeler/Remote/apps/web/package.json");
export const { chromium } = req("@playwright/test");
export const AxeBuilder = req("@axe-core/playwright").default;
export const B = "https://remote.noktabilisim.net";
export const DIR = new URL(".", import.meta.url).pathname;
export const IMG = DIR + "img/";
mkdirSync(IMG, { recursive: true });
export const rec = (file, o) => appendFileSync(DIR + file, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");
export function track(p, file, tag) {
  p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") rec(file, { tag, kind: "console", type: m.type(), text: m.text().slice(0, 300), url: p.url() }); });
  p.on("pageerror", (e) => rec(file, { tag, kind: "pageerror", text: e.message.slice(0, 300), url: p.url() }));
  p.on("response", (r) => { if (r.status() >= 400) rec(file, { tag, kind: "http", status: r.status(), method: r.request().method(), url: r.url().replace(/[?#].*/, "") }); });
}
export async function settle(p) {
  await p.mouse.move(0, 0).catch(() => {});
  await p.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
}
export async function axe(p, file, label, include) {
  await settle(p);
  let b = new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]);
  if (include) b = b.include(include);
  const r = await b.analyze();
  const v = r.violations.map((x) => `${x.id}(${x.impact}): ${x.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  rec(file, { kind: "axe", label, violations: v });
  return v;
}
export async function overflow(p, file, label) {
  const o = await p.evaluate(() => {
    const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const inner = Array.from(document.querySelectorAll("main *")).filter((el) => {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      return r.right > document.documentElement.clientWidth + 1 && r.width > 0 && cs.position !== "fixed" && !el.closest('[class*="overflow-x-auto"],[class*="overflow-auto"]');
    }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}[${el.dataset.testid ?? el.className.toString().slice(0, 50)}] right=${Math.round(el.getBoundingClientRect().right)}`);
    return { doc, inner };
  });
  rec(file, { kind: "overflow", label, ...o });
  return o;
}
