// P12b kenar durum akışları (sahte API). Her kontrol flows.jsonl'a {flow, ok, note} olarak yazılır; ekranlar img/f-*.png
import { chromium, B, IMG, rec, track } from "./common.mjs";
const F = "flows.jsonl";
const WA = "/admin/settings/whatsapp";
const br = await chromium.launch();
let cur = "";
const check = (flow, ok, note = "") => { rec(F, { kind: "check", flow, ok: !!ok, note }); console.log(ok ? "OK  " : "FAIL", flow, note); };
async function ctxFor(sc, opts = {}) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, locale: "tr-TR", ...opts });
  if (sc) {
    const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" };
    await ctx.addCookies([{ ...base, name: "__Host-rs_session", value: `u-${sc}-${Math.random().toString(36).slice(2)}`, httpOnly: true }, { ...base, name: "__Host-rs_csrf", value: "csrf-test-token" }]);
  }
  const p = await ctx.newPage(); track(p, F, () => cur); return { ctx, p };
}
const ready = (p) => p.waitForSelector('[data-testid="wa-svc-form"][data-ready="true"]');
const T = (p, id) => p.getByTestId(id);

// 1) Sekme gezinmesi + geri tuşu + klavye
{ cur = "tabs"; const { ctx, p } = await ctxFor("ausa");
  await p.goto(B + "/admin/settings");
  check("/admin/settings → mysql yönlendirme", p.url().endsWith("/admin/settings/mysql"), p.url());
  for (const [name, path] of [["TURN", "turn"], ["Sistem logosu", "system-logo"], ["WhatsApp servisi", "whatsapp"], ["MySQL", "mysql"]]) {
    await T(p, "system-tabs").getByRole("link", { name }).click();
    await p.waitForURL("**/admin/settings/" + path);
    const cur = await T(p, "system-tabs").getByRole("link", { name }).getAttribute("aria-current");
    check(`sekme ${name} → /${path}, aria-current`, cur === "page", cur);
  }
  await p.goBack(); await p.waitForURL("**/whatsapp"); await ready(p);
  check("geri tuşu → whatsapp formu", await T(p, "wa-svc-form").isVisible());
  // klavye: whatsapp sekmesine Tab ile ulaşma
  await T(p, "system-tabs").getByRole("link", { name: "Sistem logosu" }).focus(); await p.keyboard.press("Tab");
  const f = await p.evaluate(() => document.activeElement?.textContent?.trim());
  check("klavye Tab: Sistem logosu → WhatsApp servisi", f === "WhatsApp servisi", f);
  await ctx.close(); }

// 2) Geçersiz girdiler, sınırlar, XSS/SQL metni, çift tıklama
{ cur = "save"; const { ctx, p } = await ctxFor("ausa"); await p.goto(B + WA); await ready(p);
  const puts = []; p.on("request", (r) => { if (r.method() === "PUT" && r.url().endsWith("/admin/settings/whatsapp")) puts.push(r.postData()); });
  const url = T(p, "wa-svc-url");
  // boş kaydet: dirty değilse kayıt çubuğu yok
  check("boş alan + env: kayıt çubuğu yok", (await T(p, "save-bar").count()) === 0);
  for (const bad of ["<script>alert(1)</script>", "' OR 1=1 --", "javascript:alert(1)", "https://", "http://exa mple.com", "  ", "wa.ornek.com", "https://wa.ornek.com#x", "HTTPS://WA.ORNEK.COM", "https://" + "a".repeat(188) + ".com"]) {
    puts.length = 0; await url.fill(bad);
    const hasBar = await T(p, "save-bar").count();
    if (hasBar) await T(p, "save-bar-save").click(); else await p.keyboard.press("Enter");
    await p.waitForTimeout(400);
    const inv = await url.getAttribute("aria-invalid");
    const msg = (await p.locator("#wa-svc-url-error, [id$='-error']").allTextContents()).join(" | ").slice(0, 120);
    const eff = await T(p, "wa-svc-effective").textContent();
    rec(F, { kind: "input", value: bad.slice(0, 40), len: bad.length, bar: hasBar, invalid: inv, puts: puts.length, putBody: puts[0]?.slice(0, 80), effective: eff, msg });
    console.log("girdi", JSON.stringify(bad.slice(0, 30)), "len", bad.length, "bar", hasBar, "invalid", inv, "PUT", puts.length, puts[0]?.slice(0, 60), "etkin", eff, msg);
  }
  const sc = await p.evaluate(() => document.querySelectorAll("script").length);
  check("XSS metni DOM'a script eklemedi", (await p.evaluate(() => typeof window.__xss)) === "undefined", "script sayısı " + sc);
  // ekran: hata durumu
  await url.fill("ftp://x"); await T(p, "save-bar-save").click(); await p.screenshot({ path: IMG + "f-gecersiz-url.png" });
  // çift tıklama
  await url.fill("https://cift.ornek.com"); puts.length = 0;
  await T(p, "save-bar-save").dblclick(); await p.waitForTimeout(800);
  check("çift tıklama → tek PUT", puts.length === 1, "PUT sayısı " + puts.length);
  // yenileme sonrası
  await url.fill("https://kirli.ornek.com"); await p.reload(); await ready(p);
  check("yenileme: kaydedilmemiş değer atılır, kayıtlı panel değeri görünür", (await url.inputValue()) === "https://cift.ornek.com", await url.inputValue());
  // kaydedilmemişken başka sekmeye geçiş uyarısı?
  await url.fill("https://kirli2.ornek.com");
  let dlg = null; p.once("dialog", async (d) => { dlg = d.type(); await d.dismiss(); });
  await T(p, "system-tabs").getByRole("link", { name: "TURN" }).click(); await p.waitForTimeout(800);
  rec(F, { kind: "dirtynav", dialog: dlg, url: p.url() }); console.log("kirli formdan sekme geçişi: dialog", dlg, "url", p.url());
  await ctx.close(); }

// 3) Ortam değişkenine dön diyaloğu: Esc / Vazgeç / onay
{ cur = "reset"; const { ctx, p } = await ctxFor("ausains"); await p.goto(B + WA); await ready(p);
  let dels = 0; p.on("request", (r) => { if (r.method() === "DELETE") dels++; });
  await T(p, "wa-svc-reset").click(); await p.waitForTimeout(200);
  await p.screenshot({ path: IMG + "f-reset-dialog.png" });
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  const open1 = await T(p, "wa-svc-reset-dialog").evaluate((d) => d.open);
  check("Esc diyaloğu kapatır, DELETE yok", !open1 && dels === 0, `open=${open1} DELETE=${dels}`);
  const focusBack = await p.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  check("Esc sonrası odak tetikleyiciye döner", focusBack === "wa-svc-reset", focusBack);
  await T(p, "wa-svc-reset").click(); await T(p, "wa-svc-reset-dialog").getByRole("button", { name: "Vazgeç" }).click(); await p.waitForTimeout(200);
  check("Vazgeç → DELETE yok", dels === 0);
  // DELETE ağ hatası
  await p.route("**/api/v1/admin/settings/whatsapp", (r) => r.request().method() === "DELETE" ? r.abort() : r.continue());
  await T(p, "wa-svc-reset").click(); await T(p, "wa-svc-reset-confirm").click(); await p.waitForTimeout(800);
  const err = await p.locator('[role="alert"]').allTextContents();
  check("DELETE ağ hatası → ekranda hata, kaynak Panel kalır", err.join(" ").length > 0 && (await T(p, "setting-source").textContent()) === "Panel", err.join(" | ").slice(0, 150));
  await p.screenshot({ path: IMG + "f-reset-neterr.png" });
  await p.unroute("**/api/v1/admin/settings/whatsapp");
  await T(p, "wa-svc-reset").click(); await T(p, "wa-svc-reset-confirm").click(); await p.waitForTimeout(800);
  check("onay → kaynak Ortam değişkeni, uyarı kalkar", (await T(p, "setting-source").textContent()) === "Ortam değişkeni" && (await T(p, "wa-svc-insecure").count()) === 0);
  await ctx.close(); }

// 4) PUT 500 / ağ hatası, test ağ hatası / 500, test numara kenarları, çift tıklama
{ cur = "errors"; const { ctx, p } = await ctxFor("ausa"); await p.goto(B + WA); await ready(p);
  await p.route("**/api/v1/admin/settings/whatsapp", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "Sunucu hatası.", requestId: "req-op-1" } }) }) : r.continue());
  await T(p, "wa-svc-url").fill("https://wa.ornek.com"); await T(p, "save-bar-save").click(); await p.waitForTimeout(700);
  const e1 = (await p.locator('[role="alert"]').allTextContents()).join(" | ");
  check("PUT 500 → form hatası görünür, değer korunur", e1.length > 0 && (await T(p, "wa-svc-url").inputValue()) === "https://wa.ornek.com", e1.slice(0, 160));
  await p.screenshot({ path: IMG + "f-put-500.png" });
  await p.unroute("**/api/v1/admin/settings/whatsapp");
  await p.route("**/api/v1/admin/settings/whatsapp", (r) => r.request().method() === "PUT" ? r.abort() : r.continue());
  await T(p, "save-bar-save").click(); await p.waitForTimeout(700);
  const e2 = (await p.locator('[role="alert"]').allTextContents()).join(" | ");
  check("PUT ağ hatası → hata görünür", e2.length > 0, e2.slice(0, 160));
  await p.unroute("**/api/v1/admin/settings/whatsapp");
  await T(p, "save-bar-reset").click();
  const phone = T(p, "wa-test-phone"), res = T(p, "wa-test-result");
  let posts = 0; p.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/test")) posts++; });
  for (const v of ["", "<script>", "' OR 1=1", "+90 532 000 00 00 00 00", "905320000000", "+491511234567", "5320000000"]) {
    posts = 0; await phone.fill(v); await T(p, "wa-test-send").click(); await p.waitForTimeout(400);
    const inv = await phone.getAttribute("aria-invalid"); const r = (await res.count()) ? (await res.textContent()).slice(0, 80) : "-";
    rec(F, { kind: "phone", value: v, invalid: inv, posts, result: r }); console.log("telefon", JSON.stringify(v), "invalid", inv, "POST", posts, r);
  }
  await p.route("**/whatsapp/test", (r) => r.abort());
  await phone.fill("05320000000"); await T(p, "wa-test-send").click(); await p.waitForTimeout(600);
  check("test ağ hatası → sonuç kutusu hata", (await res.count()) && /gönderilemedi/.test(await res.textContent()), (await res.count()) ? (await res.textContent()).slice(0, 140) : "yok");
  await p.screenshot({ path: IMG + "f-test-neterr.png" });
  await p.unroute("**/whatsapp/test");
  await p.route("**/whatsapp/test", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "Sunucu hatası.", requestId: "req-op-2" } }) }));
  await T(p, "wa-test-send").click(); await p.waitForTimeout(600);
  check("test 500 → sonuç kutusu hata", (await res.count()) && /gönderilemedi/.test(await res.textContent()), (await res.textContent()).slice(0, 140));
  await p.unroute("**/whatsapp/test");
  posts = 0; await T(p, "wa-test-send").dblclick(); await p.waitForTimeout(800);
  check("Test butonu çift tıklama → tek POST", posts === 1, "POST " + posts);
  await ctx.close(); }

// 5) 429 mobil görünüm + ekran
{ cur = "429m"; const { ctx, p } = await ctxFor("ausa", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: "dark" });
  await p.goto(B + WA); await ready(p); await T(p, "wa-test-phone").fill("05320000000");
  for (let i = 0; i < 6; i++) { await T(p, "wa-test-send").click(); await p.waitForTimeout(350); }
  const t = await T(p, "wa-test-result").textContent();
  check("6. test 429 → kilit mesajı (mobil, koyu)", /Çok fazla test/.test(t), t.slice(0, 120));
  await T(p, "wa-test-result").scrollIntoViewIfNeeded(); await p.screenshot({ path: IMG + "f-429-mobil-dark.png" });
  await ctx.close(); }

// 6) Yetkisiz erişim: çerezsiz → login; USER senaryoları; API doğrudan
{ cur = "authz"; const { ctx, p } = await ctxFor(null); const r = await p.goto(B + WA);
  check("çerezsiz → /login yönlendirme", /\/login/.test(p.url()), p.url() + " " + r.status());
  await ctx.close();
  for (const sc of ["auadm", "auview", "aunone"]) {
    const { ctx, p } = await ctxFor(sc); await p.goto(B + WA);
    const forb = await T(p, "system-forbidden").count(), form = await T(p, "wa-svc-form").count();
    const menu = await p.getByRole("link", { name: "Sistem ayarları" }).count();
    const api = await p.evaluate(async () => (await fetch("/api/v1/admin/settings/whatsapp")).status);
    const apiPut = await p.evaluate(async () => (await fetch("/api/v1/admin/settings/whatsapp", { method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": "csrf-test-token" }, body: JSON.stringify({ url: "https://x.com" }) })).status);
    const apiTest = await p.evaluate(async () => (await fetch("/api/v1/admin/settings/whatsapp/test", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": "csrf-test-token" }, body: JSON.stringify({ phoneNumber: "+905320000000" }) })).status);
    check(`${sc}: yetkisiz durumu, form yok, menüde Sistem ayarları yok, API 403`, forb === 1 && form === 0 && menu === 0 && api === 403 && apiPut === 403 && apiTest === 403, `forbidden=${forb} form=${form} menu=${menu} GET=${api} PUT=${apiPut} TEST=${apiTest}`);
    await ctx.close();
  }
  // CSRF'siz PUT (SA)
  const { ctx: c2, p: p2 } = await ctxFor("ausa"); await p2.goto(B + WA);
  const s = await p2.evaluate(async () => (await fetch("/api/v1/admin/settings/whatsapp", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://x.com" }) })).status);
  check("CSRF başlığı yok → 403", s === 403, String(s)); await c2.close(); }

// 7) Audit ekranında yeni eylem etiketleri (liste yanıtı tarayıcıda taklit edilir)
{ cur = "audit"; const { ctx, p } = await ctxFor("ausa");
  const mk = (id, action, nv, ov = null, result = "success") => ({ id, createdAt: new Date().toISOString(), tenantId: null, tenantName: null, userId: "01JAV00000000000000000000A", username: "derya@ornek.com", userFullName: "Derya Kaya", avatarUrl: null, action, entity: "system_settings", entityId: "whatsapp", oldValue: ov, newValue: nv, ipAddress: "203.0.113.7", userAgent: "Chrome", result });
  const items = [mk("9003", "settings.whatsapp.test", { phone: "+90 532 *** ** 00", result: "fail", reason: "unreachable" }, null, "fail"), mk("9002", "settings.whatsapp.deleted", null, { url: "https://wa.ornek.com" }), mk("9001", "settings.whatsapp.updated", { url: "https://wa.ornek.com" }, { url: "http://10.20.0.5:3000" })];
  await p.route(/\/api\/v1\/audit(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, nextCursor: null }) }));
  await p.goto(B + "/audit"); await p.waitForTimeout(1000);
  const body = await p.locator("main, #icerik").first().innerText();
  for (const l of ["WhatsApp servis adresi güncellendi", "WhatsApp servisi ortam değerine döndü", "WhatsApp test mesajı"]) check(`audit etiketi: ${l}`, body.includes(l));
  check("ham eylem adı görünmüyor", !/settings\.whatsapp\./.test(body));
  await p.screenshot({ path: IMG + "f-audit-labels.png", fullPage: true });
  // filtre listesinde
  const opts = await p.locator("select option").allTextContents();
  check("filtre seçeneklerinde 3 WhatsApp eylemi", ["WhatsApp servis adresi güncellendi", "WhatsApp servisi ortam değerine döndü", "WhatsApp test mesajı"].every((x) => opts.includes(x)), opts.filter((o) => /WhatsApp/.test(o)).join(", "));
  // detaylar
  for (const [lab, file] of [["WhatsApp test mesajı", "test"], ["WhatsApp servis adresi güncellendi", "upd"]]) {
    await p.getByText(lab, { exact: true }).first().click(); await p.waitForTimeout(500);
    const dlg = p.locator("dialog[open], [role=dialog]").first();
    const txt = (await dlg.count()) ? await dlg.innerText() : "(detay yok)";
    rec(F, { kind: "auditdetail", lab, txt: txt.slice(0, 600) }); console.log("DETAY", lab, "::", txt.replace(/\s+/g, " ").slice(0, 400));
    await p.screenshot({ path: IMG + `f-audit-detail-${file}.png` });
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  }
  await ctx.close(); }
await br.close();
