// Arayüz: /unattended (sütun, rozet, şerit, ?version=, SA Tüm firmalar), /unattended/[id], /settings/clients (anahtar, salt okunur,
// kaydet/toast), /audit (etiket, ham anahtar yok, süzgeç). 1280/390 × açık/koyu; axe, taşma, konsol, 4xx/5xx, kırık link.
import { API, BASE, chromium, checkLinks, login, rec, scan, state, watch } from "./p29lib.mjs";
const st = state();
const b = await chromium.launch();
const res = [];
const ok = (name, cond, note = "") => { res.push(`${cond ? "OK  " : "FAIL"} ${name}${note ? " — " + String(note).slice(0, 300) : ""}`); rec({ kind: "ui", name, ok: !!cond, note: String(note).slice(0, 500) }); };
const RAW = /client\.update\.|settings\.client_update/;
const watches = [];

const sessions = {};
async function ctxFor(key, { width = 1280, scheme = "light" } = {}) {
  const c = (sessions[key] ??= await login(st[key].email, st.totp[key]));
  if (key === "sa" && !c.switched) { const r = await c.call("POST", "/admin/switch-tenant", { tenantId: st.A }); c.switched = r.status; rec({ kind: "flow", name: "sa switch", status: r.status }); }
  const ctx = await b.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
  await ctx.addCookies(c.cookies());
  return { ctx, cookie: Object.entries(c.jar).map(([k, v]) => `${k}=${v}`).join("; ") };
}
async function page(ctx, tag) { const p = await ctx.newPage(); const w = watch(p, tag); watches.push(w); return p; }
const allLinks = new Set();
const noteScan = (s) => { s.links.forEach((l) => allLinks.add(l)); ok(`scan ${s.name}: axe 0, taşma 0`, s.axe.length === 0 && s.overflow <= 0, s.axe.join("; ") + (s.overflow > 0 ? ` overflow=${s.overflow}` : "")); };

// --- Admin A, dört görünüm ---
for (const [width, scheme] of [[1280, "light"], [1280, "dark"], [390, "light"], [390, "dark"]]) {
  const { ctx, cookie } = await ctxFor("adminA", { width, scheme });
  const sfx = `${width}-${scheme}`;
  const p = await page(ctx, "adminA-" + sfx);
  await p.goto(BASE + "/unattended");
  await p.getByTestId("upd-strip").waitFor({ timeout: 15000 }).catch(() => {});
  noteScan(await scan(p, `unattended-${sfx}`));
  if (width === 1280 && scheme === "light") {
    const txt = await p.locator("main").innerText();
    rec({ kind: "text", name: "unattended main", txt: txt.slice(0, 3000) });
    const badge = async (n) => (await p.locator("tr", { hasText: n }).getByTestId("upd-badge").innerText().catch(() => "YOK")).replace(/\s+/g, " ");
    ok("rozet GUNCEL-PC Güncel", (await badge("GUNCEL-PC")) === "Güncel", await badge("GUNCEL-PC"));
    ok("rozet BEKLEYEN-PC Güncelleme bekliyor", (await badge("BEKLEYEN-PC")).startsWith("Güncelleme bekliyor"), await badge("BEKLEYEN-PC"));
    ok("rozet KURULAN-PC Güncelleniyor", (await badge("KURULAN-PC")).startsWith("Güncelleniyor"), await badge("KURULAN-PC"));
    ok("rozet HATALI-PC başarısız (neden)", (await badge("HATALI-PC")).startsWith("Güncelleme başarısız"), await badge("HATALI-PC"));
    ok("rozet ESKI-PC Asgari sürümün altında", (await badge("ESKI-PC")) === "Asgari sürümün altında", await badge("ESKI-PC"));
    ok("B cihazı listede/şeritte yok", !txt.includes("B-GIZLI") && !txt.includes("0.19.7"));
    ok("XSS adlı cihaz düz metin", (await p.locator("tr", { hasText: "<img src=x" }).count()) === 1);
    const strip = await p.getByTestId("upd-strip").innerText().catch(() => "YOK");
    ok("şerit: yayın + sayılar", /0\.22\.1/.test(strip), strip.replace(/\s+/g, " "));
    // süzgeç
    await p.getByTestId("upd-strip").locator('[data-version="0.22.0"]').getByRole("link").click();
    await p.waitForURL(/version=0\.22\.0/);
    await p.waitForTimeout(800);
    const rows = await p.locator("tbody tr").allInnerTexts();
    ok("?version=0.22.0 → 3 satır (BEKLEYEN/KURULAN/HATALI)", rows.length === 3 && !rows.join().includes("GUNCEL"), rows.map((r) => r.split("\t")[0]).join(","));
    noteScan(await scan(p, "unattended-version-suzgec-1280-light"));
    await p.reload(); await p.waitForTimeout(800);
    ok("yenilemede süzgeç korunuyor", /version=0\.22\.0/.test(p.url()) && (await p.locator("tbody tr").count()) === 3);
    await p.getByTestId("upd-clear").click(); await p.waitForURL((u) => !u.search.includes("version"));
    ok("Süzgeci kaldır", (await p.locator("tbody tr").count()) === 6);
    await p.goto(BASE + "/unattended?version=9.9.9"); await p.waitForTimeout(800);
    noteScan(await scan(p, "unattended-version-yok-1280-light"));
    await p.goto(BASE + "/unattended?version=%3Cscript%3E"); await p.waitForTimeout(800);
    noteScan(await scan(p, "unattended-version-gecersiz-1280-light"));
    // geri tuşu
    await p.goto(BASE + "/unattended"); await p.goto(BASE + "/unattended?version=0.22.1"); await p.goBack(); await p.waitForTimeout(600);
    ok("geri tuşu süzgeçsiz listeye döner", !p.url().includes("version"));
  }
  // detay
  await p.goto(BASE + `/unattended/${st.devA.hatali}`);
  await p.waitForTimeout(800);
  noteScan(await scan(p, `unattended-detay-hatali-${sfx}`));
  if (width === 1280 && scheme === "light") {
    const t = await p.locator("main").innerText();
    ok("detay rozeti HATALI-PC başarısız", /Güncelleme başarısız/.test(t), t.match(/Sürüm[^\n]*\n?[^\n]*/)?.[0]);
    await p.goto(BASE + `/unattended/${st.devA.eski}`); await p.waitForTimeout(600);
    ok("detay rozeti ESKI-PC asgari altı", /Asgari sürümün altında/.test(await p.locator("main").innerText()));
    noteScan(await scan(p, "unattended-detay-eski-1280-light"));
    await p.goto(BASE + `/unattended/${st.devB.gizli}`); await p.waitForTimeout(600);
    const tb = await p.locator("main").innerText();
    ok("A → B cihaz sayfası bulunamadı", !tb.includes("B-GIZLI"), tb.slice(0, 120));
    noteScan(await scan(p, "unattended-detay-idor-1280-light"));
  }
  // ayarlar
  await p.goto(BASE + "/settings/clients");
  await p.getByTestId("client-update-form").waitFor({ timeout: 10000 }).catch(() => {});
  noteScan(await scan(p, `settings-clients-${sfx}`));
  if (width === 1280 && scheme === "light") {
    const sw = p.getByTestId("upd-auto");
    ok("ayar: 01 koşusundan Kapalı görünüyor", (await sw.getAttribute("aria-checked")) === "false");
    await sw.click();
    ok("ayar: kaydet çubuğu çıktı", await p.getByTestId("save-bar").isVisible());
    noteScan(await scan(p, "settings-clients-degisti-1280-light", { full: false }));
    const save = p.getByTestId("save-bar-save");
    await save.dblclick();
    const toast = await p.getByTestId("toast").innerText({ timeout: 5000 }).catch(() => "YOK");
    ok("ayar: toast", /kaydedildi/.test(toast), toast);
    await p.screenshot({ path: `${(await import("./p29lib.mjs")).SHOTS}/settings-clients-toast-1280-light.png` });
    await p.reload(); await p.getByTestId("client-update-form").waitFor();
    ok("ayar: yenilemede Açık", (await p.getByTestId("upd-auto").getAttribute("aria-checked")) === "true");
    // ayrılma uyarısı: değiştirip başka sayfaya git
    await p.getByTestId("upd-auto").click();
    let dlg = null; p.once("dialog", (d) => { dlg = d.type(); });
    await p.getByTestId("settings-tabs").getByRole("link").first().click().catch(() => {});
    await p.waitForTimeout(800);
    ok("ayar: kaydedilmemiş değişiklikte ayrılma uyarısı/engeli", dlg !== null || /settings\/clients/.test(p.url()), `dialog=${dlg} url=${p.url().replace(BASE, "")}`);
    // ağ hatası
    await p.goto(BASE + "/settings/clients"); await p.getByTestId("client-update-form").waitFor();
    await p.route("**/api/v1/settings/client-update", (r) => (r.request().method() === "PUT" ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "Sunucu hatası (test)." } }) }) : r.continue()));
    await p.getByTestId("upd-auto").click(); await p.getByTestId("save-bar-save").click(); await p.waitForTimeout(1200);
    const err = await p.locator("main").innerText();
    ok("ayar: PUT 500 → hata görünür, değişiklik korunur", /hata|alınamadı|kaydedilemedi|Sunucu/i.test(err) && (await p.getByTestId("upd-auto").getAttribute("aria-checked")) === "false", err.slice(0, 200));
    await p.screenshot({ path: `${(await import("./p29lib.mjs")).SHOTS}/settings-clients-put500-1280-light.png` });
    await p.unroute("**/api/v1/settings/client-update");
    // şerit hata durumu (sunucu bileşeni → API'yi tarayıcıdan kesemeyiz; liste yoklaması abort)
    const p2 = await page(ctx, "adminA-abort");
    await p2.route("**/api/v1/unattended/devices**", (r) => r.abort());
    await p2.goto(BASE + "/unattended"); await p2.waitForTimeout(6000);
    await p2.screenshot({ path: `${(await import("./p29lib.mjs")).SHOTS}/unattended-yoklama-abort-1280-light.png`, fullPage: true });
    rec({ kind: "text", name: "abort", txt: (await p2.locator("main").innerText()).slice(0, 800) });
    await p2.close();
  }
  // audit
  await p.goto(BASE + "/audit");
  await p.waitForTimeout(1200);
  if (width === 1280 && scheme === "light") {
    const sel = p.getByTestId("audit-filters").getByLabel("İşlem");
    const opts = await sel.locator('optgroup[label="İstemci güncelleme"] option').allInnerTexts();
    ok("audit süzgeç grubu 'İstemci güncelleme'", opts.length >= 5, opts.join(" | "));
    ok("süzgeç seçeneklerinde ham anahtar yok", !opts.some((o) => RAW.test(o)));
    await sel.selectOption("client.*");
    await p.getByTestId("audit-filters").getByTestId("filter-apply").click();
    await p.waitForTimeout(1200);
  } else {
    await p.goto(BASE + "/audit?action=client.*"); await p.waitForTimeout(1200);
  }
  const at = await p.locator("main").innerText();
  ok(`audit ${sfx}: ham client.update.* metni yok`, !RAW.test(at), at.match(RAW)?.[0]);
  const aria = await p.$$eval("[aria-label]", (es) => es.map((e) => e.getAttribute("aria-label")).join("\n"));
  ok(`audit ${sfx}: aria-label'larda ham anahtar yok`, !RAW.test(aria));
  ok(`audit ${sfx}: anahtar/ref sızıntısı yok`, !at.includes(st.bindingKey) && !at.includes("rsb_"));
  noteScan(await scan(p, `audit-client-${sfx}`));
  if (width === 1280 && scheme === "light") {
    rec({ kind: "text", name: "audit main", txt: at.slice(0, 3000) });
    ok("audit Türkçe etiketler", /İstemci güncellendi/.test(at) && /reddedildi|başarısız/.test(at) && /geri alındı/.test(at), at.slice(0, 400).replace(/\s+/g, " "));
    await p.goto(BASE + "/audit?action=settings.client_update"); await p.waitForTimeout(1000);
    const at2 = await p.locator("main").innerText();
    ok("audit ayar satırı Türkçe, ham yok", !RAW.test(at2), at2.slice(0, 300).replace(/\s+/g, " "));
    await p.goto(BASE + "/audit?action=client.*"); await p.waitForTimeout(1000);
    const first = p.locator("tbody tr").filter({ hasText: /reddedildi|başarısız/ }).first();
    await first.click().catch(() => {});
    await first.getByRole("button").first().click().catch(() => {});
    await p.waitForTimeout(800);
    const dlgTxt = await p.getByRole("dialog").innerText().catch(() => "YOK");
    ok("audit ayrıntı diyaloğu: neden, ham anahtar yok", dlgTxt !== "YOK" && !RAW.test(dlgTxt) && !dlgTxt.includes("rsb_"), dlgTxt.slice(0, 400).replace(/\s+/g, " "));
    noteScan(await scan(p, "audit-ayrinti-1280-light", { full: false }));
  }
  if (width === 1280 && scheme === "light") ok("kırık link yok", (await checkLinks([...allLinks], cookie)).length === 0, (await checkLinks([...allLinks], cookie)).join(", "));
  await ctx.close();
}

// --- salt okunur, yetkisiz, SA, B ---
{
  const { ctx } = await ctxFor("viewA");
  const p = await page(ctx, "viewA");
  await p.goto(BASE + "/settings/clients"); await p.waitForTimeout(1500);
  ok("viewA salt okunur bandı", await p.getByTestId("settings-readonly").isVisible().catch(() => false));
  ok("viewA anahtar kapalı/disabled", (await p.getByTestId("upd-auto").isDisabled().catch(() => false)) || (await p.getByTestId("upd-auto").getAttribute("aria-disabled")) === "true");
  noteScan(await scan(p, "settings-clients-saltokunur-1280-light"));
  await ctx.close();
}
{
  const { ctx } = await ctxFor("noneA");
  const p = await page(ctx, "noneA");
  await p.goto(BASE + "/settings/clients"); await p.waitForTimeout(1200);
  const t1 = await p.locator("body").innerText();
  ok("noneA /settings/clients yetkisiz ekranı", !(await p.getByTestId("upd-auto").count()), t1.slice(0, 200).replace(/\s+/g, " "));
  noteScan(await scan(p, "settings-clients-yetkisiz-1280-light"));
  await p.goto(BASE + "/unattended"); await p.waitForTimeout(1200);
  ok("noneA /unattended şerit yok", !(await p.getByTestId("upd-strip").count()));
  noteScan(await scan(p, "unattended-yetkisiz-1280-light"));
  await ctx.close();
}
for (const scheme of ["light", "dark"]) {
  const { ctx } = await ctxFor("sa", { scheme });
  const p = await page(ctx, "sa-" + scheme);
  await p.goto(BASE + "/unattended"); await p.getByTestId("upd-strip").waitFor({ timeout: 15000 }).catch(() => {});
  if (scheme === "light") ok("SA şerit firma kapsamı", (await p.getByTestId("upd-strip").getAttribute("data-scope")) === "tenant");
  await p.getByTestId("upd-strip").getByRole("button", { name: "Tüm firmalar" }).click();
  await p.waitForURL(/scope=all/); await p.waitForTimeout(1500);
  const s = await p.getByTestId("upd-strip").innerText();
  ok(`SA Tüm firmalar (${scheme})`, (await p.getByTestId("upd-strip").getAttribute("data-scope")) === "all" && /0\.19\.7/.test(s), s.replace(/\s+/g, " ").slice(0, 300));
  ok(`SA scope=all sürümler bağlantı değil (${scheme})`, (await p.getByTestId("upd-strip").locator('[data-version="0.19.7"]').getByRole("link").count()) === 0);
  noteScan(await scan(p, `unattended-sa-tumfirmalar-1280-${scheme}`));
  await ctx.close();
}
{
  const { ctx } = await ctxFor("adminB");
  const p = await page(ctx, "adminB");
  await p.goto(BASE + "/unattended?scope=all"); await p.waitForTimeout(1500);
  ok("adminB ?scope=all yok sayılır, şerit firma", (await p.getByTestId("upd-strip").getAttribute("data-scope").catch(() => null)) === "tenant" && !(await p.locator("main").innerText()).includes("GUNCEL-PC"));
  noteScan(await scan(p, "unattended-adminB-1280-light"));
  await ctx.close();
}
// çıkış sonrası korumalı URL
{
  const ctx = await b.newContext(); const p = await page(ctx, "anon");
  for (const u of ["/settings/clients", "/unattended", "/audit"]) { await p.goto(BASE + u); await p.waitForTimeout(500); ok(`anonim ${u} → /login`, /\/login/.test(p.url()), p.url().replace(BASE, "")); }
  await ctx.close();
}
for (const w of watches) rec({ kind: "watch", ...w });
const errs = watches.flatMap((w) => [...w.pageerror.map((e) => `${w.tag} pageerror ${e}`), ...w.console.filter((c) => c.startsWith("error")).map((c) => `${w.tag} ${c}`), ...w.http.filter((h) => /^5/.test(h)).map((h) => `${w.tag} ${h}`)]);
console.log(res.join("\n"));
console.log("--- konsol/pageerror/5xx ---\n" + [...new Set(errs)].join("\n"));
console.log("--- 4xx ---\n" + [...new Set(watches.flatMap((w) => w.http.filter((h) => /^4/.test(h)).map((h) => `${w.tag} ${h}`)))].join("\n"));
await b.close();
