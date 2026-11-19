// API sunucusu kapalıyken portal sayfaları ne gösteriyor (SSR veri çekme hatası).
import { chromium, BASE, rec, watch } from "./k9lib.mjs";
const DIR = process.env.K9_DIR;
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: DIR + "/portal-ali.json" })).newPage();
const w = watch(p, "api-kapali");
for (const u of ["/portal", "/portal/account", "/portal/login?tenant=demo"]) {
  const r = await p.goto(BASE + u).catch(() => null);
  await p.waitForTimeout(1000);
  const t = (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
  rec({ kind: "flow", step: "API kapalı " + u, ok: true, note: `HTTP ${r?.status()} url=${p.url().replace(BASE, "")} ${t}` });
  console.log(u, r?.status(), p.url().replace(BASE, ""), t);
  await p.screenshot({ path: `/Users/mennan/Projeler/Remote/.claude/worktrees/p21-c5b21a/docs/test-raporu/p21/api-kapali-${u.split("?")[0].replaceAll("/", "_")}.png` });
}
rec({ kind: "watch", ...w });
console.log(JSON.stringify(w));
await b.close();
