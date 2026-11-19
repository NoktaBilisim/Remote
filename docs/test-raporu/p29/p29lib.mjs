// P29 sayfa testi yardımcıları (p21-k9/k9lib.mjs kalıbı; yerel gerçek yığın). Gizli değerler ortamdan/scratch'ten okunur:
// P29_PW (kullanıcı parolası), P29_STATE (setup.json + totp sırları; repoya yazılmaz).
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const WEB = "/Users/mennan/Projeler/Remote/.claude/worktrees/p21-c5b21a/apps/web/";
const req = createRequire(WEB + "package.json");
export const { chromium } = req("@playwright/test");
const AxeBuilder = req("@axe-core/playwright").default;
export const BASE = process.env.P29_BASE ?? "http://localhost:3493";
export const API = process.env.P29_API ?? "http://127.0.0.1:3492";
const HERE = path.dirname(new URL(import.meta.url).pathname);
export const SHOTS = path.join(HERE, "ekran");
fs.mkdirSync(SHOTS, { recursive: true });
export const OUT = path.join(HERE, "tarama.jsonl");
export const rec = (o) => fs.appendFileSync(OUT, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");
export const state = () => JSON.parse(fs.readFileSync(process.env.P29_STATE));

export function totp(b32, offset = 0) {
  const al = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const ch of b32.replace(/=+$/, "").toUpperCase()) bits += al.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const step = Math.floor(Date.now() / 30000) + offset; const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", key).update(msg).digest(); const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
export const freshTotp = async (secret) => {
  const left = 30000 - (Date.now() % 30000); if (left < 29000) await new Promise((r) => setTimeout(r, left + 300));
  return totp(secret);
};

/** Basit çerez kavanozlu API istemcisi (web üzerinden, Origin = BASE). */
export function client() {
  const jar = {};
  const take = (r) => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); } };
  const hdr = () => ({ origin: BASE, "content-type": "application/json", cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), ...(jar["__Host-rs_csrf"] ? { "x-csrf-token": jar["__Host-rs_csrf"] } : {}) });
  const call = async (method, url, body) => {
    const r = await fetch(BASE + "/api/v1" + url, { method, headers: hdr(), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    take(r); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  };
  const cookies = () => Object.entries(jar).map(([name, value]) => ({ name, value, domain: "localhost", path: "/", secure: name.startsWith("__Host-"), httpOnly: name === "__Host-rs_session", sameSite: "Strict" }));
  return { call, cookies, jar };
}

/** Giriş + TOTP doğrulama (sır P29_STATE'te). */
export async function login(email, secret) {
  const c = client();
  const r = await c.call("POST", "/auth/login", { login: email, password: process.env.P29_PW });
  if (r.status !== 200) throw new Error("login " + r.status + " " + r.text);
  const v = await c.call("POST", "/auth/mfa/verify", { code: await freshTotp(secret) });
  if (v.status !== 200) throw new Error("mfa verify " + v.status + " " + v.text);
  return c;
}

export function watch(page, tag) {
  const st = { tag, console: [], pageerror: [], http: [] };
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") st.console.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => st.pageerror.push(String(e).slice(0, 300)));
  page.on("response", (r) => { if (r.status() >= 400) st.http.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  page.on("dialog", (d) => { if (d.type() === "beforeunload") { st.beforeunload = (st.beforeunload ?? 0) + 1; d.accept().catch(() => {}); } else { st.pageerror.push("DIALOG " + d.message()); d.dismiss().catch(() => {}); } });
  return st;
}
export async function scan(page, name, { shot = true, full = true } = {}) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const links = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  const theme = await page.evaluate(() => document.documentElement.className);
  if (shot) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
  const o = { kind: "scan", name, url: page.url().replace(BASE, ""), axe: axe.violations.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), overflow, links: [...new Set(links)], theme };
  rec(o); return o;
}
export async function checkLinks(links, cookieHeader) {
  const bad = [];
  for (const l of [...new Set(links)]) {
    if (!l || l.startsWith("#") || l.startsWith("mailto:") || l.startsWith("http")) continue;
    const r = await fetch(new URL(l, BASE), { redirect: "manual", headers: { cookie: cookieHeader } }).catch((e) => ({ status: "ERR " + e }));
    if (typeof r.status !== "number" || r.status >= 400) bad.push(`${l} → ${r.status}`);
  }
  return bad;
}
