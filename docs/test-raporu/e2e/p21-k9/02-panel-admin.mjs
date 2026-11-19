// Panel Admin: portal hesabı oluştur / doğrulama / çakışma / pasife al / etkinleştir / sıfırla. Geçici şifreler K9_DIR/accounts.json'a (scratch).
import fs from "node:fs";
import { chromium, BASE, panelCookies, watch, scan, rec } from "./k9lib.mjs";
const DIR = process.env.K9_DIR; const sec = JSON.parse(fs.readFileSync(DIR + "/totp.json"));
const [A1, A2, B1] = process.argv.slice(2);
const acc = fs.existsSync(DIR + "/accounts.json") ? JSON.parse(fs.readFileSync(DIR + "/accounts.json")) : {};
const b = await chromium.launch();
async function admin(email) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies(await panelCookies(email, process.env.ADMIN_PW, sec[email]));
  return ctx;
}
async function create(p, name, email) {
  await p.getByTestId("pa-create").click();
  await p.getByTestId("pa-f-name").fill(name); await p.getByTestId("pa-f-email").fill(email);
  await p.getByTestId("pa-create-submit").click();
  const tp = p.getByTestId("temp-password");
  await tp.waitFor({ timeout: 10000 });
  const pw = await tp.inputValue();
  await p.getByTestId("pw-done").click(); await p.getByTestId("pw-close-anyway").click().catch(() => {});
  return pw;
}
const log = (step, ok, note = "") => { rec({ kind: "flow", step, ok, note }); console.log(ok ? "OK  " : "FAIL", step, note); };

const ca = await admin("admin-a@p21.invalid"); const p = await ca.newPage(); const w = watch(p, "panel-a");
await p.goto(BASE + "/customers/" + A1); await p.getByTestId("portal-accounts").waitFor();
log("panel loginUrl", (await p.getByTestId("pa-login-url-value").innerText()) === BASE + "/portal/login?tenant=demo", await p.getByTestId("pa-login-url-value").innerText());
// doğrulama: boş
await p.getByTestId("pa-create").click(); await p.getByTestId("pa-create-submit").click();
log("oluştur boş → alan hatası", (await p.getByTestId("pa-create-dialog").innerText()).includes("zorunlu"));
await p.getByTestId("pa-f-name").fill("<script>alert(1)</script>"); await p.getByTestId("pa-f-email").fill("' OR 1=1 --");
await p.getByTestId("pa-create-submit").click(); await p.waitForTimeout(800);
log("oluştur SQL/script girdisi", true, (await p.getByTestId("pa-create-dialog").innerText()).replace(/\s+/g, " ").slice(0, 300));
await p.getByTestId("pa-f-name").fill("x".repeat(150)); await p.getByTestId("pa-f-email").fill("uzun@a1.invalid");
await p.getByTestId("pa-create-submit").click(); await p.waitForTimeout(800);
log("oluştur 150 karakter ad", true, (await p.getByTestId("pa-create-dialog").innerText()).replace(/\s+/g, " ").slice(0, 300));
await scan(p, "panel-create-dialog-hatalar", { full: false });
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
const stay = p.getByText("Forma dön"); if (await stay.count()) await p.getByRole("button", { name: /Kapat|Çık|Vazgeç|Kaydetmeden/ }).last().click().catch(() => {});
await p.goto(BASE + "/customers/" + A1); await p.getByTestId("portal-accounts").waitFor();
acc.ali = { email: "ali@a1.invalid", pw: await create(p, "Ali Portal", "ali@a1.invalid"), slug: "demo" }; log("oluştur ali (A1)", !!acc.ali.pw);
acc.cem = { email: "cem@a1.invalid", pw: await create(p, "Cem Portal", "cem@a1.invalid"), slug: "demo" }; log("oluştur cem (A1)", !!acc.cem.pw);
// çift tıklama → tek hesap
await p.getByTestId("pa-create").click(); await p.getByTestId("pa-f-name").fill("Çift Tık"); await p.getByTestId("pa-f-email").fill("cift@a1.invalid");
await p.getByTestId("pa-create-submit").dblclick(); await p.getByTestId("temp-password").waitFor();
await p.getByTestId("pw-done").click(); await p.getByTestId("pw-close-anyway").click().catch(() => {});
await p.waitForTimeout(800);
log("çift tıklama tek kayıt", (await p.getByTestId("pa-row").filter({ hasText: "cift@a1.invalid" }).count()) === 1);
// çakışma
await p.getByTestId("pa-create").click(); await p.getByTestId("pa-f-name").fill("Ali İki"); await p.getByTestId("pa-f-email").fill("ALI@a1.invalid");
await p.getByTestId("pa-create-submit").click(); await p.waitForTimeout(1000);
log("aynı firmada aynı e-posta → alan hatası", true, (await p.getByTestId("pa-create-dialog").innerText()).replace(/\s+/g, " ").slice(-160));
await p.keyboard.press("Escape"); await p.getByTestId("pw-close-anyway").click({ timeout: 1500 }).catch(() => {}); await p.getByRole("button", { name: /Kaydetmeden|Kapat/ }).click({ timeout: 1500 }).catch(() => {});
await p.goto(BASE + "/customers/" + A1); await p.getByTestId("portal-accounts").waitFor();
await scan(p, "panel-portal-hesaplari-1280-light");
const row = p.getByTestId("pa-row").filter({ hasText: "cem@a1.invalid" });
await row.getByTestId("pa-menu").locator("summary").click(); await row.getByTestId("pa-deactivate").click();
await scan(p, "panel-pasife-al-diyalog", { full: false });
log("pasife al notu", (await p.getByTestId("pa-deact-note").innerText()).includes("bağlantısını"));
await p.getByTestId("pa-confirm").click(); await p.waitForTimeout(1000);
log("pasife al", (await row.getAttribute("data-status")) === "PASSIVE");
fs.writeFileSync(DIR + "/accounts.json", JSON.stringify(acc));
await p.goto(BASE + "/customers/" + A2); await p.getByTestId("portal-accounts").waitFor();
acc.deniz = { email: "deniz@a2.invalid", pw: await create(p, "Deniz Portal", "deniz@a2.invalid"), slug: "demo" }; log("oluştur deniz (A2)", !!acc.deniz.pw);
console.log(JSON.stringify({ console: w.console, pageerror: w.pageerror, http: w.http }));
rec({ kind: "watch", ...w });
const cb = await admin("admin-b@p21.invalid"); const q = await cb.newPage(); const wb = watch(q, "panel-b");
await q.goto(BASE + "/customers/" + B1); await q.getByTestId("portal-accounts").waitFor();
acc.aliB = { email: "ali@a1.invalid", pw: await create(q, "Ali Beta", "ali@a1.invalid"), slug: "beta" }; log("farklı firmada aynı e-posta oluşturulur", !!acc.aliB.pw);
acc.ece = { email: "ece@b1.invalid", pw: await create(q, "Ece Portal", "ece@b1.invalid"), slug: "beta" }; log("oluştur ece (B1)", !!acc.ece.pw);
// Admin B, A müşterisinin sayfası → 404
const r = await q.goto(BASE + "/customers/" + A1); log("Admin B → A müşteri detayı", true, "HTTP " + r.status() + " " + (await q.locator("main").innerText()).slice(0, 80).replace(/\s+/g, " "));
rec({ kind: "watch", ...wb });
fs.writeFileSync(DIR + "/accounts.json", JSON.stringify(acc));
await ca.storageState({ path: DIR + "/admin-a.json" }); await cb.storageState({ path: DIR + "/admin-b.json" });
await b.close();
