// P9 kritik akışlar — gerçek apps/server + geçici MySQL (setup.sh). Sonuç: flow.jsonl, ekranlar img/. Gizli değer yazılmaz.
import { chromium, B, WORK, IMG, rec, track, axe, overflow, login, csrfFetch } from "./common.mjs";
const F = "flow.jsonl";
const br = await chromium.launch();
const results = [];
async function step(name, fn) {
  try { const note = await fn(); results.push([name, "GEÇTİ", note ?? ""]); rec(F, { step: name, ok: true, note }); }
  catch (e) { results.push([name, "KALDI", e.message.split("\n")[0].slice(0, 200)]); rec(F, { step: name, ok: false, err: e.message.slice(0, 400) }); }
}
const ctxA = await br.newContext({ storageState: `${WORK}/state-admin.json`, viewport: { width: 1366, height: 900 } });
const a = await ctxA.newPage(); track(a, F, "admin");
const sw = (p, k) => p.getByTestId(`perm-${k}`).filter({ visible: true });
const S = Date.now().toString(36);
const opEmail = `op-${S}@p9op.invalid`;
let tempPw = null, opId = null, admin2Id = null;

await step("Admin: kullanıcı formu boş/geçersiz/<script> doğrulaması", async () => {
  await a.goto(B + "/users");
  await a.getByTestId("user-new").click();
  const f = a.getByTestId("user-form");
  await f.getByTestId("uf-submit").click();
  if ((await f.getByLabel("Ad soyad").getAttribute("aria-invalid")) !== "true") throw new Error("boş ad hata vermedi");
  await f.getByLabel("Ad soyad").fill("x".repeat(150));
  await f.getByLabel("E-posta").fill("gecersiz");
  await f.getByTestId("uf-submit").click();
  await a.waitForTimeout(500);
  await a.screenshot({ path: IMG + "user-form-invalid.png" });
  const txt = await f.innerText();
  if (!/en çok 100/.test(txt)) throw new Error("uzun ad mesajı yok: " + txt.slice(0, 200));
  await a.keyboard.press("Escape");
});

await step("Admin: kullanıcı oluştur (USER) → geçici şifre bir kez, çift tıklamada tek kayıt", async () => {
  await a.goto(B + "/users");
  await a.getByTestId("user-new").click();
  const f = a.getByTestId("user-form");
  await f.getByLabel("Ad soyad").fill(`Op <script>alert(1)</script> ${S}`);
  await f.getByLabel("E-posta").fill(opEmail);
  await f.getByLabel("Rol").selectOption("USER");
  let posts = 0; a.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/v1/users")) posts++; });
  await f.getByTestId("uf-submit").dblclick();
  const pw = a.getByTestId("user-temp-password");
  await pw.waitFor();
  tempPw = await pw.getByTestId("temp-password").inputValue();
  await a.screenshot({ path: IMG + "temp-password-dialog.png", mask: [pw.getByTestId("temp-password")] });
  const ax = await axe(a, F, "temp-password dialog", '[data-testid="user-temp-password"]');
  await pw.getByTestId("pw-done").click();
  await pw.getByTestId("pw-close-anyway").click();
  await a.reload();
  const list = await csrfFetch(a, "GET", `/api/v1/users?q=${encodeURIComponent("op-" + S)}&pageSize=100`);
  const n = list.body.items.filter((u) => u.email === opEmail).length;
  opId = list.body.items[0]?.id;
  if (n !== 1) throw new Error("kayıt sayısı " + n);
  if (await a.locator(`text=${tempPw}`).count()) throw new Error("şifre tekrar göründü");
  if (await a.evaluate(() => !!window.__xss)) throw new Error("xss");
  return `POST isteği=${posts}, kayıt=1, şifre uzunluğu=${tempPw.length}, axe=${ax.length}`;
});

await step("Admin: aynı e-posta tekrar → 409 alan hatası", async () => {
  await a.getByTestId("user-new").click();
  const f = a.getByTestId("user-form");
  await f.getByLabel("Ad soyad").fill("Kopya Kişi");
  await f.getByLabel("E-posta").fill(opEmail.toUpperCase());
  await f.getByTestId("uf-submit").click();
  await f.getByText("Bu e-posta adresi başka bir hesapta kullanılıyor").waitFor({ timeout: 5000 });
  await a.keyboard.press("Escape");
});

await step("Arama: SQL/özel karakter, URL'de kalıcı, yenileme sonrası korunur", async () => {
  await a.goto(B + "/users");
  await a.getByTestId("user-search").fill("' OR 1=1 --");
  await a.waitForURL(/q=/, { timeout: 5000 });
  await a.reload();
  const v = await a.getByTestId("user-search").inputValue();
  const nm = await a.getByTestId("users-no-match").count();
  if (v !== "' OR 1=1 --" || nm !== 1) throw new Error(`değer=${v} eşleşmeyok=${nm}`);
});

await step("Yeni USER ilk girişte şifre değişimine yönlenir; yetkisiz menü/sayfa", async () => {
  const c = await br.newContext(); const p = await login(c, opEmail, tempPw); track(p, F, "op");
  const path1 = new URL(p.url()).pathname;
  const np = "Op-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  await p.locator('[name="current"]').fill(tempPw); await p.locator('[name="next"]').fill(np); await p.locator('[name="confirm"]').fill(np);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/change-password")), p.locator('button[type="submit"]').click()]);
  tempPw = np;
  await p.goto(B + "/users"); await p.screenshot({ path: IMG + "user-role-users-page.png" });
  const nav = await p.getByRole("navigation", { name: "Ana menü" }).innerText();
  const api = await csrfFetch(p, "GET", "/api/v1/users");
  await c.storageState({ path: `${WORK}/state-op.json` }); await c.close();
  if (path1 !== "/change-password") throw new Error("ilk giriş " + path1);
  if (/Kullanıcılar/.test(nav)) throw new Error("menüde Kullanıcılar var");
  if (api.status !== 403) throw new Error("API " + api.status);
  return "menü: " + nav.replace(/\n/g, ",");
});

await step("Admin: Admin2'den audit.export kaldır → kaydet → kalıcı", async () => {
  const l = await csrfFetch(a, "GET", "/api/v1/users?pageSize=100");
  admin2Id = l.body.items.find((u) => u.email === process.env.P9_ADMIN2_LOGIN).id;
  await a.goto(B + `/users/${admin2Id}`);
  await sw(a, "audit.export").click();
  const resp = a.waitForResponse((r) => r.request().method() === "PATCH");
  await a.getByTestId("save-bar-save").click();
  const r = await resp;
  await a.reload();
  const v = await sw(a, "audit.export").getAttribute("aria-checked");
  if (r.status() !== 200 || v !== "false") throw new Error(`PATCH ${r.status()} değer ${v}`);
  return "PATCH gövdesi " + r.request().postData();
});

const ctxB = await br.newContext({ storageState: `${WORK}/state-admin2.json`, viewport: { width: 1366, height: 900 } });
const b = await ctxB.newPage(); track(b, F, "admin2");
await step("Admin2: kendinde olmayan audit.export kilitli; API ile verme 403", async () => {
  await b.goto(B + `/users/${opId}`);
  const s = sw(b, "audit.export");
  const dis = await s.getAttribute("aria-disabled");
  await b.screenshot({ path: IMG + "locked-permission.png", fullPage: true });
  const api = await csrfFetch(b, "PATCH", `/api/v1/users/${opId}`, { permissions: { "audit.export": true } });
  if (dis !== "true" || api.status !== 403) throw new Error(`kilit=${dis} api=${api.status}`);
  return "403 fields=" + Object.keys(api.body?.error?.fields ?? {}).join(",");
});
await step("Admin2: daha geniş yetkili Admin1 salt okunur", async () => {
  const l = await csrfFetch(b, "GET", "/api/v1/users?pageSize=100");
  const id1 = l.body.items.find((u) => u.email === process.env.P9_ADMIN_LOGIN).id;
  await b.goto(B + `/users/${id1}`);
  const t = await b.getByTestId("user-notice").innerText();
  const d = await b.getByTestId("user-deactivate").count();
  if (d !== 0) throw new Error("pasife al görünüyor; notice=" + t);
  return t;
});
await step("Admin2: USER→ADMIN rol değişimi kaydedilir, kilitli yetki kapalı kalır", async () => {
  await b.goto(B + `/users/${opId}`);
  await b.getByTestId("ue-role").selectOption("ADMIN");
  const resp = b.waitForResponse((r) => r.request().method() === "PATCH");
  await b.getByTestId("save-bar-save").click();
  const r = await resp;
  await b.reload();
  const role = await b.getByTestId("ue-role").inputValue();
  const ae = await sw(b, "audit.export").getAttribute("aria-checked");
  const ue = await sw(b, "users.edit").getAttribute("aria-checked");
  if (r.status() !== 200 || role !== "ADMIN" || ae !== "false" || ue !== "true") throw new Error(`${r.status()} ${role} ae=${ae} ue=${ue}`);
});
await step("Ağ hatası: kaydet isteği abort → hata gösterilir, form korunur", async () => {
  await b.route("**/api/v1/users/*", (r) => r.request().method() === "PATCH" ? r.abort() : r.continue());
  await b.getByTestId("ue-name").fill("Ağ Testi " + S);
  await b.getByTestId("save-bar-save").click();
  await b.waitForTimeout(1500);
  await b.screenshot({ path: IMG + "save-network-error.png" });
  const err = await b.getByTestId("user-save-error").count();
  const v = await b.getByTestId("ue-name").inputValue();
  await b.unroute("**/api/v1/users/*");
  if (!err || !v.startsWith("Ağ Testi")) throw new Error(`hata=${err} değer=${v}`);
  return await b.getByTestId("user-save-error").innerText();
});

await step("Admin: kullanıcıyı pasife al → açık oturumu düşer, giriş yapamaz → yeniden etkinleştir", async () => {
  await a.goto(B + `/users/${opId}`);
  await a.getByTestId("user-deactivate").click();
  await a.getByTestId("user-deactivate-dialog").getByTestId("user-action-confirm").click();
  await a.getByTestId("user-status").filter({ hasText: "Pasif" }).waitFor();
  const c = await br.newContext({ storageState: `${WORK}/state-op.json` }); const p = await c.newPage();
  await p.goto(B + "/"); const after = new URL(p.url()).pathname;
  const c2 = await br.newContext(); const p2 = await login(c2, opEmail, tempPw);
  const blocked = new URL(p2.url()).pathname.startsWith("/login");
  await a.goto(B + "/users"); const hidden = await a.getByText(opEmail).count();
  await a.goto(B + "/users?status=passive"); const inPassive = await a.getByText(opEmail).filter({ visible: true }).count();
  await a.goto(B + `/users/${opId}`);
  await a.getByTestId("user-reactivate").click();
  await a.getByTestId("user-reactivate-dialog").getByTestId("user-action-confirm").click();
  await a.getByTestId("user-status").filter({ hasText: "Aktif" }).waitFor();
  const c3 = await br.newContext(); const p3 = await login(c3, opEmail, tempPw);
  const ok = !new URL(p3.url()).pathname.startsWith("/login");
  await c.close(); await c2.close(); await c3.close();
  if (after !== "/login" || !blocked || hidden !== 0 || inPassive < 1 || !ok) throw new Error(`eskiOturum=${after} girişEngel=${blocked} aktifListe=${hidden} pasifListe=${inPassive} tekrarGiriş=${ok}`);
});

await step("Admin: /admin/tenants uyarı + API 403", async () => {
  await a.goto(B + "/admin/tenants");
  const f = await a.getByTestId("tenants-forbidden").count();
  const api = await csrfFetch(a, "GET", "/api/v1/admin/tenants");
  if (!f || api.status !== 403) throw new Error(`uyarı=${f} api=${api.status}`);
});
await step("AC-4: PUT /settings/tenant aralık dışı 400, geçerli 200", async () => {
  const bad = await csrfFetch(a, "PUT", "/api/v1/settings/tenant", { sessionTtlMin: 10 });
  const good = await csrfFetch(a, "PUT", "/api/v1/settings/tenant", { sessionTtlMin: 20 });
  if (bad.status !== 400 || good.status !== 200) throw new Error(`${bad.status}/${good.status}`);
  return "400 fields=" + Object.keys(bad.body?.error?.fields ?? {}).join(",");
});

// Super Admin
const ctxS = await br.newContext({ storageState: `${WORK}/state-sa.json`, viewport: { width: 1366, height: 900 } });
const s = await ctxS.newPage(); track(s, F, "sa");
const slug = `op-${S}`; let newTenantId = null, otherUserId = null;
await step("SA: firma oluştur (boş, demo çakışması 409, <script> ad)", async () => {
  await s.goto(B + "/admin/tenants");
  await s.getByTestId("tenant-new").click();
  const f = s.getByTestId("tenant-form");
  await f.getByTestId("tf-submit").click();
  await f.getByLabel("Firma adı").fill(`Op Firma <b>x</b> ${S}`);
  await f.getByLabel("Kısa ad").fill("demo");
  await f.getByTestId("tf-submit").click();
  await f.getByText("Bu kısa ad başka bir firmada kullanılıyor").waitFor({ timeout: 5000 });
  await f.getByLabel("Kısa ad").fill(slug);
  await f.getByTestId("tf-submit").click();
  await s.getByTestId("tenant-row").filter({ hasText: slug }).first().waitFor();
  await s.screenshot({ path: IMG + "tenants-after-create.png" });
  const l = await csrfFetch(s, "GET", "/api/v1/admin/tenants?pageSize=100");
  newTenantId = l.body.items.find((t) => t.slug === slug).id;
});
await step("SA: yeni firmaya geç → boş kullanıcı listesi → kullanıcı ekle", async () => {
  const swc = s.getByTestId("tenant-switcher");
  await swc.locator("summary").click();
  await swc.getByRole("button", { name: new RegExp(S) }).click();
  await s.waitForFunction((id) => document.querySelector('[data-testid="tenant-switcher"]')?.getAttribute("data-acting") === id, newTenantId);
  await s.goto(B + "/users");
  await s.getByTestId("users-empty").waitFor();
  await s.screenshot({ path: IMG + "sa-new-tenant-empty.png" });
  await s.getByTestId("user-new-empty").click();
  const f = s.getByTestId("user-form");
  await f.getByLabel("Ad soyad").fill("Diğer Firma Kişi");
  await f.getByLabel("E-posta").fill(`other-${S}@p9op.invalid`);
  await f.getByTestId("uf-submit").click();
  const pw = s.getByTestId("user-temp-password"); await pw.waitFor();
  await pw.getByTestId("pw-done").click(); await pw.getByTestId("pw-close-anyway").click();
  const l = await csrfFetch(s, "GET", "/api/v1/users");
  otherUserId = l.body.items[0].id;
  if (l.body.items.length !== 1) throw new Error("liste " + l.body.items.length);
});
await step("Tenant izolasyonu: Demo Admin başka firmanın kullanıcısına → API 404 + bulunamadı ekranı", async () => {
  const api = await csrfFetch(a, "GET", `/api/v1/users/${otherUserId}`);
  const pat = await csrfFetch(a, "PATCH", `/api/v1/users/${otherUserId}`, { fullName: "Hack" });
  await a.goto(B + `/users/${otherUserId}`);
  const nf = await a.getByTestId("user-not-found").count();
  if (api.status !== 404 || pat.status !== 404 || !nf) throw new Error(`GET ${api.status} PATCH ${pat.status} ekran ${nf}`);
});
await step("SA: Demo'ya geç → yalnız Demo kullanıcıları; bağlamdan çık", async () => {
  await s.goto(B + "/admin/tenants");
  await s.getByRole("button", { name: "Bu firmaya geç: Demo Firma" }).click();
  await s.waitForTimeout(1000);
  await s.goto(B + "/users");
  const t = await s.locator("main").innerText();
  const swc = s.getByTestId("tenant-switcher");
  await swc.locator("summary").click(); await swc.getByTestId("tenant-switcher-clear").click();
  await s.waitForFunction(() => document.querySelector('[data-testid="tenant-switcher"]')?.getAttribute("data-acting") === "");
  if (t.includes("Diğer Firma Kişi") || !t.includes("E2E Teknisyen 1")) throw new Error("liste karışık");
});
await step("SA: firmayı pasife al (kısa ad onayı) → switcher'da yok → yeniden etkinleştir", async () => {
  await s.goto(B + "/admin/tenants");
  const row = s.getByTestId("tenant-row").filter({ hasText: slug });
  await row.getByRole("button", { name: /^Pasife al/ }).click();
  const d = s.getByTestId("tenant-deactivate-dialog");
  await d.getByTestId("tenant-deactivate-type").fill(slug);
  await s.screenshot({ path: IMG + "tenant-deactivate-dialog.png" });
  await d.getByTestId("tenant-action-confirm").click();
  await row.getByTestId("tenant-status").filter({ hasText: "Pasif" }).waitFor();
  const swc = s.getByTestId("tenant-switcher"); await swc.locator("summary").click();
  const inList = await swc.getByRole("button", { name: new RegExp(S) }).count();
  await s.keyboard.press("Escape");
  const sw2 = await csrfFetch(s, "POST", "/api/v1/admin/switch-tenant", { tenantId: newTenantId });
  await s.reload();
  await row.getByRole("button", { name: /Yeniden etkinleştir|etkinleştir/ }).click();
  await s.getByTestId("tenant-reactivate-dialog").getByTestId("tenant-action-confirm").click();
  await row.getByTestId("tenant-status").filter({ hasText: "Aktif" }).waitFor();
  if (inList !== 0 || sw2.status !== 404) throw new Error(`switcher=${inList} switchAPI=${sw2.status}`);
});

await step("Çıkış yapılmış: korumalı URL'ler login'e", async () => {
  const c = await br.newContext(); const p = await c.newPage(); const out = [];
  for (const u of ["/users", `/users/${opId}`, "/admin/tenants"]) { await p.goto(B + u); out.push(new URL(p.url()).pathname + new URL(p.url()).search); }
  await c.close();
  if (!out.every((x) => x.startsWith("/login"))) throw new Error(out.join(" "));
  return out.join(" | ");
});
await step("Geri tuşu: kayıt sonrası geri/ileri tutarlı", async () => {
  await a.goto(B + "/users"); await a.goto(B + `/users/${opId}`); await a.goBack();
  if (!/\/users$/.test(a.url())) throw new Error(a.url());
});

// Tema + mobil + axe
for (const scheme of ["light", "dark"]) for (const [vw, tag] of [[1366, "desk"], [375, "m375"]]) {
  await step(`Görsel/axe ${scheme} ${tag}`, async () => {
    const out = [];
    for (const [st, path, name] of [["admin", "/users", "users"], ["admin", `/users/${opId}`, "user-detail"], ["sa", "/admin/tenants", "tenants"]]) {
      const c = await br.newContext({ storageState: `${WORK}/state-${st}.json`, viewport: { width: vw, height: 900 }, colorScheme: scheme, isMobile: vw < 500, hasTouch: vw < 500 });
      const p = await c.newPage(); track(p, F, `${scheme}-${tag}`);
      await p.goto(B + path); await p.waitForLoadState("networkidle");
      await p.screenshot({ path: IMG + `${name}-${scheme}-${tag}.png`, fullPage: vw < 500 });
      const v = await axe(p, F, `${name} ${scheme} ${tag}`); const o = await overflow(p, F, `${name} ${scheme} ${tag}`);
      if (name === "tenants") { await p.getByTestId("tenant-new").click(); await p.waitForTimeout(300); await p.screenshot({ path: IMG + `tenant-form-${scheme}-${tag}.png` }); const dv = await axe(p, F, `tenant-form ${scheme} ${tag}`, '[data-testid="tenant-form"]'); v.push(...dv); }
      if (v.length || o.doc > 0) out.push(`${name}: axe=${v.join(";")} taşma=${o.doc} ${o.inner.join(",")}`);
      await c.close();
    }
    if (out.length) throw new Error(out.join(" || "));
  });
}

for (const r of results) console.log(r.join(" | "));
await br.close();
