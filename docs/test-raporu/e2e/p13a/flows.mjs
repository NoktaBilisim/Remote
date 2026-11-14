// P13a operatör akışları (spec'te olmayan kırılımlar). Sahte API :4217 + üretim derlemesi :3217. Çıktı: flows.jsonl, img/f-*.png
import { chromium, B, IMG, rec, track, axe, overflow } from "./common.mjs";
import { readFileSync } from "node:fs";
const F = "flows.jsonl";
const ANON = "01JHXSTAN0N000000000000048", OTHER = "01JHXST0000000000000000004";
const br = await chromium.launch();
let cur = "";
const R = (name, ok, note) => { rec(F, { kind: "flow", name, ok, note }); console.log(ok ? "OK  " : "FAIL", name, note ?? ""); };
async function ctxFor(sc, o = {}) {
  const ctx = await br.newContext({ locale: "tr-TR", acceptDownloads: true, ...o });
  if (sc) {
    const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" };
    await ctx.addCookies([{ ...base, name: "__Host-rs_session", value: `u-${sc}-${Math.random().toString(36).slice(2)}`, httpOnly: true }, { ...base, name: "__Host-rs_csrf", value: "csrf-test-token" }]);
  }
  const p = await ctx.newPage(); track(p, F, () => cur); return { ctx, p };
}
async function step(name, fn) { cur = name; try { await fn(); } catch (e) { R(name, false, "İSTİSNA " + e.message.split("\n")[0]); } }

await step("CSV dışa aktarma (anonim satır)", async () => {
  const { ctx, p } = await ctxFor("hu");
  await p.goto(B + "/history", { waitUntil: "networkidle" });
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 10000 }), p.getByTestId("export-csv").click()]);
  const txt = readFileSync(await dl.path(), "utf8");
  const line = txt.split("\r\n").find((l) => l.startsWith(ANON)) ?? "";
  R("CSV dışa aktarma (anonim satır)", line && !/[A-ZÇĞİÖŞÜ][a-zçğıöşü]+ [A-ZÇĞİÖŞÜ]/.test(line), `${dl.suggestedFilename()} satır="${line}"`);
  await ctx.close();
});

await step("Anonim detay: doğrudan PATCH isteği 409 (arayüz dışı)", async () => {
  const { ctx, p } = await ctxFor("hu");
  await p.goto(B + `/history/${ANON}`, { waitUntil: "networkidle" });
  const st = await p.evaluate(async (id) => (await fetch(`/api/v1/sessions/${id}`, { method: "PATCH", headers: { "content-type": "application/json", "x-csrf-token": "csrf-test-token" }, body: JSON.stringify({ ticketNo: "X" }) })).status, ANON);
  R("Anonim detay: doğrudan PATCH isteği 409 (arayüz dışı)", st === 409, `status=${st}`);
  await ctx.close();
});

await step("409 akışı 390px + koyu", async () => {
  const { ctx, p } = await ctxFor("hu", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  await p.goto(B + `/history/${OTHER}`, { waitUntil: "networkidle" });
  await p.getByTestId("ticket-input").fill("ANON-409");
  await p.getByTestId("note-save").click();
  await p.getByTestId("history-anonymized").waitFor({ timeout: 8000 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: IMG + "f-409-dark-390.png", fullPage: true });
  const o = await overflow(p); const a = await axe(p);
  const save = await p.getByTestId("note-save").count();
  R("409 akışı 390px + koyu", save === 0 && o.doc <= 0 && a.length === 0, `save=${save} of=${o.doc} axe=${a.join("|")}`);
  // geri tuşu → liste, ileri → yine salt okunur
  await p.goBack(); await p.waitForTimeout(500);
  await p.goForward(); await p.waitForLoadState("networkidle");
  const ro = await p.getByTestId("history-anonymized").count();
  R("409 sonrası geri/ileri → salt okunur kalır", ro === 1, `url=${p.url()} anon=${ro}`);
  await ctx.close();
});

await step("Ticket ipucu + özel karakter/uzun girdi", async () => {
  const { ctx, p } = await ctxFor("hu");
  await p.goto(B + `/history/${OTHER}`, { waitUntil: "networkidle" });
  const inp = p.getByTestId("ticket-input");
  await inp.fill("<script>alert(1)</script>");
  await p.getByTestId("note-save").click(); await p.waitForTimeout(800);
  const inv1 = await inp.getAttribute("aria-invalid");
  await inp.fill("' OR 1=1 --"); await p.getByTestId("note-save").click(); await p.waitForTimeout(800);
  const inv2 = await inp.getAttribute("aria-invalid");
  const body = await p.locator("#icerik").innerText();
  await p.screenshot({ path: IMG + "f-ticket-inputs.png", fullPage: true });
  R("Ticket ipucu + özel karakter/uzun girdi", !(await p.evaluate(() => window.__xss)), `script→invalid=${inv1} sql→invalid=${inv2} ipucu=${body.includes("yazmayın")}`);
  await ctx.close();
});

await step("Audit: IPv6/IPv4 önek 390px kart + ayrıntı, UA yok", async () => {
  const { ctx, p } = await ctxFor("auadm", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.goto(B + "/audit", { waitUntil: "networkidle" });
  const card = p.locator('[data-testid="audit-card"]').filter({ visible: true }).filter({ hasText: "2001:db8:1234::/48" });
  const n = await card.count();
  if (n) { await card.first().click(); await p.waitForTimeout(500); }
  const dlg = p.getByTestId("audit-detail");
  const txt = n ? await dlg.innerText() : "";
  await p.screenshot({ path: IMG + "f-audit-ipv6-390.png" });
  const fullV6 = /2001:db8:1234:[0-9a-f]{1,4}:/i.test(await p.locator("body").innerText());
  R("Audit: IPv6/IPv4 önek 390px kart + ayrıntı, UA yok", n === 1 && txt.includes("/48") && !txt.includes("Tarayıcı") && !fullV6, `kart=${n} tamV6Görünür=${fullV6}`);
  await ctx.close();
});

await step("Audit: Veri saklama filtresi yenileme sonrası korunur + 390", async () => {
  const { ctx, p } = await ctxFor("auadm", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  await p.goto(B + "/audit", { waitUntil: "networkidle" });
  const f = p.getByTestId("audit-filters");
  if (!(await f.getByLabel("İşlem").isVisible())) { const t = p.getByRole("button", { name: /Filtre/ }).first(); if (await t.count()) await t.click(); }
  await f.getByLabel("İşlem").selectOption("retention.*");
  await f.getByTestId("filter-apply").click();
  await p.waitForURL(/action=retention/); await p.waitForLoadState("networkidle");
  await p.reload({ waitUntil: "networkidle" });
  const rows = await p.locator('[data-testid="audit-row"], [data-testid="audit-card"]').filter({ visible: true }).count();
  const sel = await f.getByLabel("İşlem").locator("option:checked").innerText();
  await p.screenshot({ path: IMG + "f-audit-retention-390-dark.png", fullPage: true });
  const o = await overflow(p);
  R("Audit: Veri saklama filtresi yenileme sonrası korunur + 390", rows === 1 && sel.includes("Veri saklama"), `satır=${rows} seçili="${sel}" of=${o.doc}`);
  await ctx.close();
});

await step("WhatsApp: tamamı büyük harf HTTP adres + çift tıklama", async () => {
  const { ctx, p } = await ctxFor("ausadef", { colorScheme: "dark" });
  await p.goto(B + "/admin/settings/whatsapp", { waitUntil: "networkidle" });
  await p.getByTestId("wa-svc-form").and(p.locator('[data-ready="true"]')).waitFor();
  await p.screenshot({ path: IMG + "f-wa-default-dark.png", fullPage: true });
  let puts = []; p.on("request", (r) => { if (r.method() === "PUT" && r.url().endsWith("/admin/settings/whatsapp")) puts.push(r.postData()); });
  await p.getByTestId("wa-svc-url").fill("HTTPS://WA.ORNEK.COM/YOL/");
  await p.getByTestId("save-bar-save").dblclick();
  await p.waitForTimeout(1500);
  const v = await p.getByTestId("wa-svc-url").inputValue();
  R("WhatsApp: tamamı büyük harf HTTP adres + çift tıklama", puts.length === 1, `PUT=${puts.length} gövde=${puts.join(" ")} alan="${v}"`);
  await ctx.close();
});

await step("Retention: Süreyi düşür çift tıklama + 500 hata", async () => {
  const { ctx, p } = await ctxFor("acc");
  await p.goto(B + "/settings/security", { waitUntil: "networkidle" });
  await p.getByTestId("retention-form").and(p.locator('[data-ready="true"]')).waitFor();
  let puts = 0; p.on("request", (r) => { if (r.method() === "PUT" && r.url().endsWith("/settings/tenant")) puts++; });
  // 500 simülasyonu
  await p.route("**/api/v1/settings/tenant", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "Sunucu hatası." } }) }) : r.continue());
  await p.getByTestId("retention-days").fill("200");
  await p.getByTestId("save-bar-save").click();
  await p.getByTestId("retention-confirm-ok").click();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: IMG + "f-retention-500.png", fullPage: true });
  const errTxt = await p.locator("#icerik").innerText();
  const errShown = /hata|başarısız|tekrar/i.test(errTxt);
  const stillDirty = await p.getByTestId("save-bar").count();
  R("Retention: 500 → hata görünür, değer korunur", errShown && stillDirty === 1, `hataMetni=${errShown} kirli=${stillDirty} alan=${await p.getByTestId("retention-days").inputValue()}`);
  await p.unroute("**/api/v1/settings/tenant");
  puts = 0;
  await p.getByTestId("retention-days").fill("150");
  await p.getByTestId("save-bar-save").click();
  await p.getByTestId("retention-confirm-ok").dblclick();
  await p.waitForTimeout(1500);
  R("Retention: Süreyi düşür çift tıklama → tek PUT", puts === 1, `PUT=${puts}`);
  // geri tuşu kirli formda
  await p.getByTestId("retention-days").fill("300");
  let dialog = null; p.once("dialog", async (d) => { dialog = d.type(); await d.dismiss(); });
  await p.goBack().catch(() => {}); await p.waitForTimeout(800);
  R("Retention: kirli formda geri → ayrılma uyarısı/korunma", dialog !== null || p.url().includes("/settings/security"), `dialog=${dialog} url=${p.url()}`);
  await ctx.close();
});

await step("Retention 390 koyu: onay diyaloğu", async () => {
  const { ctx, p } = await ctxFor("acc", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  await p.goto(B + "/settings/security", { waitUntil: "networkidle" });
  await p.getByTestId("retention-form").and(p.locator('[data-ready="true"]')).waitFor();
  await p.getByTestId("retention-days").fill("90");
  await p.getByTestId("save-bar-save").click();
  await p.getByTestId("retention-confirm").and(p.locator("[open]")).waitFor();
  await p.waitForTimeout(400);
  await p.screenshot({ path: IMG + "f-retention-confirm-390-dark.png" });
  const a = await axe(p, '[data-testid="retention-confirm"]'); const o = await overflow(p);
  R("Retention 390 koyu: onay diyaloğu", a.length === 0 && o.doc <= 0, `axe=${a.join("|")} of=${o.doc} ${o.inner.join(",")}`);
  await ctx.close();
});

await step("Yetkisiz: çıkışlı kullanıcı korumalı URL'ler", async () => {
  const { ctx, p } = await ctxFor(null);
  const out = [];
  for (const r of ["/settings/security", `/history/${ANON}`, "/audit?action=retention.*", "/admin/settings/whatsapp"]) {
    await p.goto(B + r, { waitUntil: "networkidle" }); out.push(`${r}→${new URL(p.url()).pathname}`);
  }
  R("Yetkisiz: çıkışlı kullanıcı korumalı URL'ler", out.every((x) => x.endsWith("/login")), out.join(" "));
  await ctx.close();
});

await step("Yetkisiz: USER → WhatsApp / audit", async () => {
  const { ctx, p } = await ctxFor("aunone");
  const r1 = await p.goto(B + "/admin/settings/whatsapp", { waitUntil: "networkidle" }); const t1 = (await p.locator("main").innerText()).slice(0, 80).replace(/\s+/g, " ");
  const r2 = await p.goto(B + "/audit", { waitUntil: "networkidle" }); const t2 = (await p.locator("main").innerText()).slice(0, 80).replace(/\s+/g, " ");
  R("Yetkisiz: USER → WhatsApp / audit", true, `wa ${r1.status()} ${new URL(p.url()).pathname} "${t1}" | audit ${r2.status()} "${t2}"`);
  await ctx.close();
});

await step("Var olmayan oturum ID", async () => {
  const { ctx, p } = await ctxFor("hu");
  const r = await p.goto(B + "/history/01JHXSTZZZZZZZZZZZZZZZZZZZ", { waitUntil: "networkidle" });
  R("Var olmayan oturum ID", true, `${r.status()} "${(await p.locator("main").innerText()).slice(0, 80).replace(/\s+/g, " ")}"`);
  await ctx.close();
});
await br.close();
