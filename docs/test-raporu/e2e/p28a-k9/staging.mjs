import { chromium } from "@playwright/test";
const OUT = process.argv[2];
const B = "https://remote.noktabilisim.net";
const b = await chromium.launch();
const res = [];
for (const [w, mob] of [[1440, false], [390, true]]) for (const scheme of ["light", "dark"]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, isMobile: mob, hasTouch: mob, colorScheme: scheme, locale: "tr-TR" });
  const p = await ctx.newPage();
  const msgs = [], bad = [];
  p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && msgs.push(`${m.type()}: ${m.text()}`));
  p.on("pageerror", (e) => msgs.push("pageerror: " + e.message));
  p.on("response", (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url()}`));
  const r = await p.goto(B + "/login", { waitUntil: "networkidle" });
  const h = await r.allHeaders();
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const fav = await p.$$eval("link[rel~=icon],link[rel=apple-touch-icon]", (l) => l.map((x) => x.getAttribute("href")));
  const logo = await p.$$eval("img", (l) => l.map((x) => [x.alt, x.naturalWidth]));
  const htmlClass = await p.evaluate(() => document.documentElement.className);
  await p.screenshot({ path: `${OUT}/stg-login-${w}-${scheme}.png`, fullPage: true });
  res.push({ w, scheme, status: r.status(), csp: !!h["content-security-policy"], hsts: h["strict-transport-security"], ov, msgs, bad, fav, logo, htmlClass });
  await ctx.close();
}
const ctx = await b.newContext(); const p = await ctx.newPage();
const r2 = await p.goto(B + "/"); res.push({ root: r2.status(), url: p.url() });
for (const u of ["/sessions", "/users", "/favicon.ico", "/api/v1/health", "/health", "/ready", "/api/v1/version"]) {
  const rr = await ctx.request.get(B + u, { maxRedirects: 0 }); res.push({ u, s: rr.status(), loc: rr.headers()["location"], body: (await rr.text()).slice(0, 120) });
}
console.log(JSON.stringify(res, null, 1));
await b.close();
