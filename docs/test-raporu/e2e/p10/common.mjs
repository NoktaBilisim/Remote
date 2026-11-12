// P10 operatör betikleri ortak yardımcı. Ortam: setup.sh up → $WORK/creds.env (source edilir). Gizli değer içermez.
import { createRequire } from "node:module";
import { appendFileSync, mkdirSync } from "node:fs";
const req = createRequire("/Users/mennan/Projeler/Remote/apps/web/package.json");
export const { chromium, devices } = req("@playwright/test");
export const AxeBuilder = req("@axe-core/playwright").default;
export const B = process.env.P10_BASE ?? "http://localhost:3238";
export const WORK = process.env.WORK;
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
  let b = new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).setLegacyMode(true);
  if (include) b = b.include(include);
  const r = await b.analyze();
  const v = r.violations.map((x) => `${x.id}(${x.impact}): ${x.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  rec(file, { kind: "axe", label, violations: v });
  return v;
}
export async function overflow(p, file, label) {
  const o = await p.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const doc = document.documentElement.scrollWidth - W;
    const inner = Array.from(document.querySelectorAll("body *")).filter((el) => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return r.width > 0 && r.right > W + 1 && cs.position !== "fixed" && cs.visibility !== "hidden" && !el.closest('[class*="overflow-x-auto"],[class*="overflow-auto"],dialog:not([open])');
    }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}[${el.dataset.testid ?? el.className.toString().slice(0, 50)}] right=${Math.round(el.getBoundingClientRect().right)}`);
    return { doc, inner };
  });
  rec(file, { kind: "overflow", label, ...o });
  return o;
}
export async function login(ctx, loginId, pw) {
  const p = await ctx.newPage();
  await p.goto(B + "/login");
  await p.locator('[name="login"]').fill(loginId);
  await p.locator('[name="password"]').fill(pw);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), p.locator('button[type="submit"]').click()]);
  await p.waitForLoadState("networkidle").catch(() => {});
  return p;
}
export async function csrfFetch(p, method, path, body) {
  return p.evaluate(async ([method, path, body]) => {
    const csrf = document.cookie.match(/(?:^|; )__Host-rs_csrf=([^;]*)/)?.[1] ?? "";
    const r = await fetch(path, { method, headers: { "content-type": "application/json", "x-csrf-token": decodeURIComponent(csrf) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  }, [method, path, body]);
}
