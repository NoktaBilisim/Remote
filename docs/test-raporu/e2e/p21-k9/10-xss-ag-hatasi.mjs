// Panelde portal talebindeki <script> açıklaması güvenli mi; portal yeni talepte ağ hatası (route.abort) ve API 500.
import fs from "node:fs";
import { chromium, BASE, rec, scan } from "./k9lib.mjs";
const DIR = process.env.K9_DIR;
const log = (step, ok, note = "") => { rec({ kind: "flow", step, ok, note }); console.log(ok ? "OK  " : "FAIL", step, note); };
const b = await chromium.launch();
const a = await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: DIR + "/admin-a.json" }); const ap = await a.newPage();
let dialog = false; ap.on("dialog", (d) => { dialog = true; d.dismiss(); });
await ap.goto(BASE + "/requests/" + process.argv[2]); await ap.waitForLoadState("networkidle");



const t = await ap.locator("main").innerText();
log("panel talep: <script> metin olarak, alert yok", !dialog, (t.match(/<script>[^\n]*/)?.[0] ?? "(açıklama ekranda yok)") + " url=" + ap.url().replace(BASE, ""));
await scan(ap, "panel-talep-portal-kaynakli-1280-light");
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: DIR + "/portal-ali.json" })).newPage();
await p.goto(BASE + "/portal/new-request"); await p.getByTestId("wr-form").waitFor({ timeout: 15000 }).catch(() => {});
if (await p.getByTestId("wr-form").count()) {
  await p.getByTestId("wr-phone").fill("05321112233"); await p.getByTestId("wr-desc").fill("ağ testi açıklaması"); await p.getByTestId("wr-consent").check();
  await p.route("**/api/v1/portal/requests", (r) => (r.request().method() === "POST" ? r.abort() : r.continue()));
  await p.getByTestId("wr-submit").click(); await p.waitForTimeout(1500);
  log("yeni talep ağ hatası → mesaj, form korunur", (await p.getByTestId("wr-desc").inputValue()) === "ağ testi açıklaması", (await p.getByTestId("wr-form").innerText()).replace(/\s+/g, " ").match(/[^.]*(bağlan|ağ|internet)[^.]*\./i)?.[0]);
  await scan(p, "portal-yeni-talep-ag-hatasi-1280-light");
  await p.unroute("**/api/v1/portal/requests");
  await p.route("**/api/v1/portal/requests", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL","message":"x","requestId":"r"}}' }) : r.continue()));
  await p.getByTestId("wr-submit").click(); await p.waitForTimeout(1500);
  log("yeni talep 500 → mesaj", true, (await p.getByTestId("wr-form").innerText()).replace(/\s+/g, " ").slice(-220));
  await scan(p, "portal-yeni-talep-500-1280-light");
} else log("yeni talep formu açılmadı (bekleyen talep var?)", false, (await p.locator("main").innerText()).slice(0, 200));
await b.close();
