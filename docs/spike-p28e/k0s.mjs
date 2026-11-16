// P28e K0s spike sürücüsü (docs/mimari-p28e.md §7, §14 K0s). Üretim/e2e takımına girmez.
// Kullanım: node docs/spike-p28e/k0s.mjs [--smoke] [--browser=chromium|chrome|firefox|msedge] [--out=dosya.json]
// Playwright apps/web/node_modules'tan çözülür; sayfa 127.0.0.1 üzerindeki geçici HTTP sunucusundan yüklenir.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../apps/web/package.json"));
const pw = require("@playwright/test");

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const SMOKE = process.argv.includes("--smoke");
const HEADED = process.argv.includes("--headed"); // (5) için: headless'ta visibilityState değişmez
const ONLY = arg("only", ""); // ör. --only=background
const BROWSER = arg("browser", "chromium");
const OUT = arg("out", join(here, `sonuc-${BROWSER}${HEADED ? "-headed" : ""}${SMOKE ? "-smoke" : ""}.json`));
const run = (name) => !ONLY || ONLY === name;
const SEG = SMOKE ? 5000 : 60000;
const SHORT = SMOKE ? 3000 : 10000;

// --- tarayıcı süreç ağacı CPU süresi (sn), node'un torunları ---
function treeCpu() {
  const rows = execSync("ps -A -o pid=,ppid=,time=")
    .toString()
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/));
  const kids = new Map();
  for (const [pid, ppid, time] of rows) {
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push([pid, time]);
  }
  const parse = (t) => {
    let days = 0;
    if (t.includes("-")) [days, t] = [Number(t.split("-")[0]), t.split("-")[1]];
    const p = t.split(":").map(Number);
    while (p.length < 3) p.unshift(0);
    return days * 86400 + p[0] * 3600 + p[1] * 60 + p[2];
  };
  let sum = 0;
  const walk = (pid) => {
    for (const [c, t] of kids.get(String(pid)) || []) {
      sum += parse(t);
      walk(c);
    }
  };
  walk(process.pid);
  return sum;
}

const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(readFileSync(join(here, "spike.html")));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;

// Playwright'ın arka plan kısıtlamasını kapatan varsayılan bayrakları çıkarılır ki (5) gerçek davranışı ölçsün.
const launchOpts = {
  headless: !HEADED,
  args: ["--autoplay-policy=no-user-gesture-required"],
  ignoreDefaultArgs: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
};
let browser;
const R = { browser: BROWSER, smoke: SMOKE, startedAt: new Date().toISOString() };
try {
  if (BROWSER === "firefox") browser = await pw.firefox.launch({ headless: !HEADED });
  else if (BROWSER === "chrome" || BROWSER === "msedge") browser = await pw.chromium.launch({ ...launchOpts, channel: BROWSER });
  else browser = await pw.chromium.launch(launchOpts);
} catch (e) {
  R.unavailable = String(e.message).split("\n")[0];
  writeFileSync(OUT, JSON.stringify(R, null, 2));
  console.log("ölçülemedi:", R.unavailable);
  server.close();
  process.exit(0);
}
R.version = browser.version();
const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
const page = await ctx.newPage();
const consoleErr = [];
page.on("console", (m) => m.type() === "error" && consoleErr.push(m.text()));
page.on("pageerror", (e) => consoleErr.push(String(e)));
await page.goto(url);
const ev = (fn, a) => page.evaluate(fn, a).catch((e) => ({ evalErr: String(e.message).split("\n")[0] }));
const step = (n) => console.log(new Date().toISOString().slice(11, 19), BROWSER, n) || (R.lastStep = n);

// (6) CPU: taban (yalnız çizim) ↔ çizim + kayıt, 1080p kaydırma
if (run("main")) {
  step("cpu");
  await ev(() => K0s.setup(1920, 1080, "scroll"));
  const cpuMs = SMOKE ? 5000 : 20000;
  let c0 = treeCpu();
  await page.waitForTimeout(cpuMs);
  const base = treeCpu() - c0;
  c0 = treeCpu();
  await ev((ms) => K0s.record({ segMs: ms, segCount: 1 }), cpuMs);
  const recCpu = treeCpu() - c0;
  R.cpu = { windowSec: cpuMs / 1000, baseCpuSec: base, recCpuSec: recCpu, deltaPctOneCore: ((recCpu - base) / (cpuMs / 1000)) * 100 };

  // (1)(2)(3)(7) ana koşu: 1080p kaydırma, 3 × SEG bölüm, §7 biçimi (sync)
  step("main 1080p");
  await ev(() => K0s.setup(1920, 1080, "scroll"));
  R.main = await ev((o) => K0s.record(o), { segMs: SEG, segCount: 3 });
  R.main.analysis = await ev(() => K0s.analyzeSegments());
  const segSec = SEG / 1000;
  R.main.timeline = await ev((o) => K0s.timeline(o), {
    seekPoints: [segSec * 0.5, segSec * 1.5, segSec * 2.5, segSec * 2 + 0.2],
    playAcross: [segSec, segSec * 2],
  });
  R.main.targetOnly = await ev(([i, s]) => K0s.targetOnly(i, s), [2, segSec / 3]);
}
if (run("short")) {
  // (1) ek geçiş örnekleri: kısa bölümler, sync ve onstop
  await ev(() => K0s.setup(1920, 1080, "scroll"));
  step("short sync");
  R.shortSync = await ev((o) => K0s.record(o), { segMs: SHORT, segCount: 6 });
  R.shortSync.analysis = await ev(() => K0s.analyzeSegments());
  step("short onstop");
  R.shortOnstop = await ev((o) => K0s.record(o), { segMs: SHORT, segCount: 4, variant: "onstop" });
  R.shortOnstop.analysis = await ev(() => K0s.analyzeSegments());
}
if (run("rate")) {
  // (2) durağan içerik 1080p ve kaydırmalı 720p bit hızı
  step("static 1080p");
  await ev(() => K0s.setup(1920, 1080, "static"));
  R.static1080 = await ev((o) => K0s.record(o), { segMs: SMOKE ? 5000 : 30000, segCount: 1 });
  step("scroll 720p");
  await ev(() => K0s.setup(1280, 720, "scroll"));
  R.scroll720 = await ev((o) => K0s.record(o), { segMs: SMOKE ? 5000 : 30000, segCount: 1 });
  R.scroll720.analysis = await ev(() => K0s.analyzeSegments());
}
if (run("resize")) {
  // (4) çözünürlük değişimi bölüm içinde: 1920×1080 → 1280×720 (8 sn) → 2560×1440 (16 sn)
  step("resize");
  await ev(() => K0s.setup(1920, 1080, "scroll"));
  const rs = SMOKE ? 0.5 : 1;
  R.resize = await ev((o) => K0s.record(o), {
    segMs: 24000 * rs,
    segCount: 1,
    events: [
      { atMs: 8000 * rs, name: "720p", fn: "resize", args: [1280, 720] },
      { atMs: 16000 * rs, name: "1440p", fn: "resize", args: [2560, 1440] },
    ],
  });
  R.resize.probe = await ev((t) => K0s.probe(0, t), [4 * rs, 12 * rs, 20 * rs, 23 * rs]);
}
if (run("background")) {
  // (5) arka plan: kayıt sürerken başka sekme öne alınır (headless'ta visibilityState değişmeyebilir)
  step("background");
  await ev(() => K0s.setup(1920, 1080, "scroll"));
  const bgSeg = SMOKE ? 4000 : 10000;
  const bgP = ev((o) => K0s.record(o), { segMs: bgSeg, segCount: 3 });
  await page.waitForTimeout(bgSeg * 0.8);
  const other = await ctx.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  const t1 = await ev(() => K0s.state());
  await page.waitForTimeout(bgSeg * 1.2);
  const t2 = await ev(() => K0s.state());
  await page.bringToFront();
  R.background = await bgP;
  R.background.hiddenWindow = { from: t1, to: t2 };
  R.background.drawLog = await ev((s) => K0s.drawLog(s), R.background.recStart);
  R.background.analysis = await ev(() => K0s.analyzeSegments());
  await other.close();
}

R.consoleErr = consoleErr;
R.finishedAt = new Date().toISOString();
writeFileSync(OUT, JSON.stringify(R, null, 2));
step("bitti → " + OUT);
await browser.close();
server.close();
