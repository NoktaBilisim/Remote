import { readFileSync } from "node:fs";
import { chromium, B, DIR, IMG, rec, track, axe, overflow } from "./common.mjs";
const F = "flow2.jsonl"; const log = (k, v) => { console.log(k, JSON.stringify(v)); rec(F, { kind: "step", k, v }); };
const S = JSON.parse(readFileSync(DIR + "state.json", "utf8"));
const br = await chromium.launch();
const ctx = await br.newContext({ storageState: DIR + "user.json", viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage(); track(p, F, "flow2");
const dl = async (u) => { const r = await ctx.request.get(u, { maxRedirects: 0 }); const loc = r.headers()["location"] ?? ""; let fin = null;
  if (loc) { const r2 = await ctx.request.fetch(new URL(loc, B).toString(), { method: "GET", headers: { Range: "bytes=0-1" }, maxRedirects: 0 }); const b = await r2.body(); fin = { st: r2.status(), cd: (r2.headers()["content-disposition"] ?? "").replace(/[a-z2-7]{16}/g, "<ref>"), ct: r2.headers()["content-type"], len: r2.headers()["content-length"], mz: b.subarray(0, 2).toString() === "MZ" }; }
  return { st: r.status(), loc: loc.replace(/[a-z2-7]{16}/g, "<ref>"), fin }; };
const urlNow = async () => (await p.getByTestId("customer-download-url").textContent()).trim();
const det = B + "/customers/" + S.id;
log("dl-initial", await dl(S.url0));
// yanlış etiket
const ref0 = S.url0.match(/ref=(.*)$/)[1];
log("dl-wrong-label", (await ctx.request.get(`${B}/downloads/NoktaDestek-Baska-${ref0}.exe`, { headers: { Range: "bytes=0-1" }, maxRedirects: 0 })).status());
// Yenile: önce Vazgeç
await p.goto(det, { waitUntil: "networkidle" });
await p.getByTestId("customer-rotate").click();
const rot = p.getByTestId("customer-rotate-dialog"); await rot.waitFor();
log("rotate-dialog", { warn: (await rot.innerText()).includes("hatırlanan bilgisayarlar çalışmayı durduracak"), focusCancel: await rot.getByRole("button", { name: "Vazgeç" }).evaluate((e) => e === document.activeElement) });
await p.screenshot({ path: IMG + "f_rotate_dialog.png" }); await axe(p, F, "rotate dialog");
await rot.getByRole("button", { name: "Vazgeç" }).click(); await p.waitForTimeout(300);
log("rotate-cancel-nochange", (await urlNow()) === S.url0);
await p.getByTestId("customer-rotate").click(); await rot.getByTestId("customer-action-confirm").click();
await p.waitForTimeout(1500);
const url1 = await urlNow();
log("rotated", { changed: url1 !== S.url0, toast: await p.getByTestId("toast").allInnerTexts() });
log("dl-old-after-rotate", await dl(S.url0)); log("dl-new-after-rotate", await dl(url1));
// Pasife al
await p.getByTestId("customer-deactivate").click();
const de = p.getByTestId("customer-deactivate-dialog"); await de.waitFor();
log("deact-dialog", { focusCancel: await de.getByRole("button", { name: "Vazgeç" }).evaluate((e) => e === document.activeElement), text: (await de.innerText()).replace(/\s+/g, " ").slice(0, 200) });
await de.getByTestId("customer-action-confirm").click(); await p.waitForTimeout(1500);
log("passive", { label: await p.getByTestId("customer-link-passive").innerText().catch(() => "YOK") });
await p.screenshot({ path: IMG + "f_detail_passive.png", fullPage: true });
log("dl-after-passive", await dl(url1));
log("dl-invalid-ref", await dl(B + "/api/v1/public/agent/request-download?ref=aaaaaaaaaaaaaaaa"));
// pasifken yeni oturumda görünmemeli
await p.goto(B + "/sessions", { waitUntil: "networkidle" });
await p.getByRole("button", { name: /Yeni destek oturumu/i }).first().click();
const nd = p.getByTestId("new-session-dialog"); await nd.waitFor();
const combo = nd.getByRole("combobox", { name: /Müşteri firma/ });
await combo.fill(S.NAME.slice(-6)); await p.waitForTimeout(1200);
log("passive-in-new-session", await nd.getByRole("option").allInnerTexts());
await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
// Aktif et
await p.goto(det, { waitUntil: "networkidle" });
await p.getByTestId("customer-reactivate").click();
const re = p.getByTestId("customer-reactivate-dialog"); await re.waitFor();
log("react-dialog", { newRefText: (await re.innerText()).includes("eski dosyalar ve kayıtlar geçersiz") });
await re.getByTestId("customer-action-confirm").click(); await p.waitForTimeout(1500);
const url2 = await urlNow();
log("reactivated", { newRef: url2 !== url1 && url2 !== S.url0 });
log("dl-url1-after-react", (await dl(url1)).st); log("dl-url2", await dl(url2));
// Sekmeler + hata simülasyonu
await p.route(/\/api\/v1\/customers\/[0-9A-Z]{26}\/requests/, (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL","message":"x","requestId":"t"}}' }));
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(800);
log("tab-error", { err: await p.getByTestId("customer-tab-error").isVisible().catch(() => false) });
await p.screenshot({ path: IMG + "f_tab_error.png", fullPage: true });
await p.unroute(/\/api\/v1\/customers\/[0-9A-Z]{26}\/requests/);
await p.getByTestId("customer-tab-error").getByRole("button", { name: "Tekrar dene" }).click().catch(() => {}); await p.waitForTimeout(1000);
log("tab-retry", { empty: await p.getByText("Bu müşteriden talep yok").isVisible().catch(() => false) });
await p.getByRole("button", { name: "Oturumlar" }).click(); await p.waitForTimeout(1000);
log("tab-sessions", (await p.getByTestId("customer-tab-sessions").innerText().catch(() => "?")).replace(/\s+/g, " ").slice(0, 120));
// Talepler müşteri filtresi
await p.goto(B + "/requests", { waitUntil: "networkidle" });
await p.getByTestId("request-customer-mode").selectOption("customer");
const rc = p.getByRole("combobox", { name: "Müşteri ara" }); await rc.fill(S.NAME.slice(-6)); await p.waitForTimeout(1200);
const opt = p.getByRole("option").first(); log("req-opt", await opt.innerText().catch(() => "YOK"));
await opt.click().catch(() => {}); await p.waitForTimeout(1500);
log("req-filter-url", new URL(p.url()).search.replace(S.id, "<id>"));
await p.screenshot({ path: IMG + "f_requests_customer_filter.png", fullPage: true });
await p.goto(B + "/requests?tab=history&customer=" + S.id, { waitUntil: "networkidle" });
log("req-history-filter", (await p.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 160));
// Yeni oturum müşteriyle + iptal
await p.goto(B + "/sessions", { waitUntil: "networkidle" });
await p.getByRole("button", { name: /Yeni destek oturumu/i }).first().click(); await nd.waitFor();
await combo.fill(S.NAME.slice(-6)); await p.waitForTimeout(1200);
log("active-in-new-session", await nd.getByRole("option").allInnerTexts());
await nd.getByRole("option").first().click();
await p.screenshot({ path: IMG + "f_new_session_pick.png" }); await axe(p, F, "new session pick");
await nd.getByTestId("new-session-create").click(); await nd.getByTestId("session-link").waitFor({ timeout: 15000 });
log("session-firm", await nd.getByTestId("session-customer-firm").innerText());
await nd.getByRole("button", { name: "Oturumu iptal et" }).click(); await p.waitForTimeout(500);
const confirm = p.getByRole("alertdialog"); if (await confirm.count()) await confirm.getByRole("button", { name: /iptal et/i }).last().click();
await p.waitForTimeout(1500);
log("session-cancelled", await nd.getByTestId("dialog-cancelled").isVisible().catch(() => false));
await p.keyboard.press("Escape");
// Geçmiş filtresi
await p.goto(B + "/history?customerFirm=" + S.id, { waitUntil: "networkidle" });
log("history-filter", { rows: await p.getByTestId("history-row").count(), firm: await p.getByTestId("history-firm").allInnerTexts(), cols: await p.getByRole("columnheader").allInnerTexts() });
await p.screenshot({ path: IMG + "f_history_firm.png", fullPage: true }); await axe(p, F, "history firm");
const csv = await ctx.request.get(B + "/api/v1/sessions/export.csv?customerFirm=" + S.id);
log("csv", { st: csv.status(), head: csv.status() === 200 ? (await csv.text()).split("\n")[0].slice(0, 200) : "" });
await p.setViewportSize({ width: 390, height: 844 });
for (const u of [det, B + "/history?customerFirm=" + S.id]) { await p.goto(u, { waitUntil: "networkidle" }); const o = await overflow(p, F, u); log("m-overflow", { u: u.replace(S.id, "<id>"), doc: o.doc, inner: o.inner.length }); await p.screenshot({ path: IMG + "f_m_" + (u.includes("history") ? "history" : "detail") + ".png", fullPage: true }); }
// 404 / yetkisiz
await p.setViewportSize({ width: 1280, height: 900 });
const r404 = await p.goto(B + "/customers/01ZZZZZZZZZZZZZZZZZZZZZZZZ"); log("detail-404", { st: r404.status(), h1: await p.locator("h1").first().innerText() });
log("api-404", (await ctx.request.get(B + "/api/v1/customers/01ZZZZZZZZZZZZZZZZZZZZZZZZ")).status());
const anon = await br.newContext(); const ap = await anon.newPage(); await ap.goto(B + "/customers/" + S.id);
log("anon-redirect", new URL(ap.url()).pathname + new URL(ap.url()).search.replace(S.id, "<id>"));
log("anon-api", (await anon.request.get(B + "/api/v1/customers")).status());
await br.close();
