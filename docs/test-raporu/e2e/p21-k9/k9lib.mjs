// P21 K9 test operatörü yardımcıları (yerel yığın; gizli değerler ortamdan, repoya yazılmaz).
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const WEB = "/Users/mennan/Projeler/Remote/.claude/worktrees/p21-c5b21a/apps/web/";
const req = createRequire(WEB + "package.json");
export const { chromium, devices } = req("@playwright/test");
const AxeBuilder = req("@axe-core/playwright").default;
export const BASE = process.env.K9_BASE ?? "http://localhost:3413";
export const SHOTS = "/Users/mennan/Projeler/Remote/.claude/worktrees/p21-c5b21a/docs/test-raporu/p21";
export const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "tarama.jsonl");
export const rec = (o) => fs.appendFileSync(OUT, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");

export function totp(b32, offset = 0) {
  const al = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const ch of b32.replace(/=+$/, "").toUpperCase()) bits += al.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const step = Math.floor(Date.now() / 30000) + offset; const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", key).update(msg).digest(); const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
export const freshTotp = async (secret) => { // yeni adım bekle (son adım tekrar kabul edilmez)
  const left = 30000 - (Date.now() % 30000); if (left < 29000) await new Promise((r) => setTimeout(r, left + 300));
  return totp(secret);
};

// Panel API girişi (MFA'lı) → Playwright çerezleri
export async function panelCookies(email, password, secret) {
  const jar = {};
  const take = (r) => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); } };
  const hdr = () => ({ origin: BASE, "content-type": "application/json", cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), ...(jar["__Host-rs_csrf"] ? { "x-csrf-token": jar["__Host-rs_csrf"] } : {}) });
  let r = await fetch(BASE + "/api/v1/auth/login", { method: "POST", headers: hdr(), body: JSON.stringify({ login: email, password }) }); take(r);
  const code = await freshTotp(secret);
  r = await fetch(BASE + "/api/v1/auth/mfa/verify", { method: "POST", headers: hdr(), body: JSON.stringify({ code }) }); take(r);
  if (r.status !== 200) throw new Error("mfa verify " + r.status + " " + (await r.text()));
  return Object.entries(jar).map(([name, value]) => ({ name, value, domain: "localhost", path: "/", secure: name.startsWith("__Host-"), httpOnly: name === "__Host-rs_session", sameSite: "Strict" }));
}

// Sayfa gözlemcisi: konsol hatası, pageerror, 4xx/5xx
export function watch(page, tag) {
  const st = { tag, console: [], pageerror: [], http: [] };
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") st.console.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => st.pageerror.push(String(e).slice(0, 300)));
  page.on("response", (r) => { if (r.status() >= 400) st.http.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  return st;
}
export async function scan(page, name, { shot = true, full = true } = {}) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const links = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  const theme = await page.evaluate(() => document.documentElement.className + " " + (document.documentElement.dataset.theme ?? ""));
  if (shot) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
  const o = { kind: "scan", name, url: page.url().replace(BASE, ""), axe: axe.violations.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), overflow, links, theme: theme.trim() };
  rec(o); return o;
}
export async function checkLinks(links) {
  const bad = [];
  for (const l of [...new Set(links)]) {
    if (!l || l.startsWith("#") || l.startsWith("mailto:")) continue;
    const r = await fetch(new URL(l, BASE), { redirect: "manual" }).catch((e) => ({ status: "ERR " + e }));
    if (typeof r.status !== "number" || r.status >= 400) bad.push(`${l} → ${r.status}`);
  }
  return bad;
}
