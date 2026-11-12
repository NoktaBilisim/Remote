import { writeFileSync } from "node:fs";
import { chromium, B, DIR, IMG, rec, track, axe, overflow, settle } from "./common.mjs";
const F = "flow1.jsonl"; const log = (k, v) => { console.log(k, JSON.stringify(v)); rec(F, { kind: "step", k, v }); };
const br = await chromium.launch();
const ctx = await br.newContext({ storageState: DIR + "user.json", viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const p = await ctx.newPage(); track(p, F, "flow1");
let dialogs = 0; p.on("dialog", (d) => { dialogs++; d.dismiss(); });
// 1) Yardım klavye + Esc
await p.goto(B + "/customers", { waitUntil: "networkidle" });
const trig = p.getByTestId("customers-help-open");
await trig.focus(); await p.keyboard.press("Enter");
const help = p.getByTestId("customers-help").first();
await help.waitFor({ state: "visible" });
const ht = (await help.innerText()).replace(/\s+/g, " ");
log("help", { smartscreen: ht.includes("Yine de çalıştır"), oneOff: ht.includes("Yeni Destek Oturumu"), steps: ["Kopyala", "e-posta", "masaüstüne", "Destek iste", "Talepler"].map((s) => ht.includes(s)) });
await axe(p, F, "help light"); await p.screenshot({ path: IMG + "f_help_light.png" });
await p.emulateMedia({ colorScheme: "dark" }); await axe(p, F, "help dark"); await p.screenshot({ path: IMG + "f_help_dark.png" }); await p.emulateMedia({ colorScheme: "light" });
await p.keyboard.press("Escape"); await p.waitForTimeout(300);
log("help-esc", { closed: !(await help.isVisible()), focusBack: await trig.evaluate((e) => e === document.activeElement) });
// 2) Form geçersiz girdiler
await p.getByTestId("customer-new").click();
const form = p.getByTestId("customer-form"); await form.waitFor();
log("form-focus-name", await form.getByLabel("Firma adı").evaluate((e) => e === document.activeElement));
const errs = async () => p.evaluate(() => Array.from(document.querySelectorAll('[aria-invalid="true"]')).map((el) => { const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean); return (el.name || el.id) + ": " + ids.map((i) => document.getElementById(i)?.textContent?.trim()).filter(Boolean).join(" | "); }));
const cases = [
  ["bos", { "Firma adı": "" }],
  ["tekharf", { "Firma adı": "A" }],
  ["eposta-tel", { "Firma adı": "Geçerli Ad", "E-posta": "x@", "Telefon": "abc-123" }],
  ["etiket", { "Firma adı": "Geçerli Ad", "Dosya etiketi": "Kötü Etiket!" }],
  ["not-sekme", { "Firma adı": "Geçerli Ad", "Not": "a\tb" }],
];
for (const [n, vals] of cases) {
  for (const l of ["Firma adı", "E-posta", "Telefon", "Not", "Yetkili kişi"]) await form.getByLabel(l, { exact: true }).fill("");
  for (const [l, v] of Object.entries(vals)) await form.getByLabel(l, { exact: true }).fill(v);
  const label = await form.getByLabel("Dosya etiketi").inputValue();
  await form.getByTestId("cf-submit").click(); await p.waitForTimeout(700);
  const stillOpen = await form.isVisible();
  log("invalid-" + n, { stillOpen, label, errs: await errs() });
  if (n === "eposta-tel") { await p.screenshot({ path: IMG + "f_form_errors.png" }); await axe(p, F, "form errors light"); }
  if (!stillOpen) { log("UNEXPECTED-CREATED", n); break; }
}
// 3) Geçerli oluşturma + çift tıklama
const stamp = new Date().toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul" }).replace(/:/g, "");
const NAME = `Test Müşteri P8c ${stamp}`;
await form.getByLabel("Firma adı").fill(NAME);
await form.getByLabel("Dosya etiketi").fill("");
await form.getByLabel("Firma adı").fill(NAME + " ");
await form.getByLabel("Firma adı").fill(NAME);
log("suggested-label", await form.getByLabel("Dosya etiketi").inputValue());
await form.getByLabel("Yetkili kişi").fill("Çağrı Öztürk");
await form.getByLabel("Telefon").fill("0532 111 22 33");
await form.getByLabel("E-posta").fill("test-p8c@example.com");
await form.getByLabel("Not").fill("<script>alert('xss')</script> ' OR 1=1 -- test notu");
const posts = []; p.on("response", (r) => { if (r.request().method() === "POST" && /\/api\/v1\/customers$/.test(r.url().replace(/\?.*/, ""))) posts.push(r.status()); });
await form.getByTestId("cf-submit").dblclick();
await p.waitForURL(/\/customers\/[0-9A-Z]{26}/, { timeout: 15000 });
await p.waitForLoadState("networkidle"); await p.waitForTimeout(800);
const id = p.url().match(/customers\/([0-9A-Z]{26})/)[1];
log("created", { id, posts, h1: await p.locator("h1").innerText(), dialogs });
const url = (await p.getByTestId("customer-download-url").textContent()).trim();
const fileName = (await p.getByTestId("customer-file-name").innerText()).trim();
const note = await p.getByTestId("customer-note").innerText();
log("detail", { urlShape: url.replace(/ref=[a-z2-7]{16}$/, "ref=<16>"), refOk: /ref=[a-z2-7]{16}$/.test(url), fileName: fileName.replace(/-[a-z2-7]{16}\.exe/, "-<ref>.exe"), noteEscaped: note.includes("<script>"), dialogs });
writeFileSync(DIR + "state.json", JSON.stringify({ id, NAME, url0: url }));
// toast
log("toasts", await p.getByTestId("toast").allInnerTexts().catch(() => []));
await p.screenshot({ path: IMG + "f_detail_light.png", fullPage: true });
await axe(p, F, "detail light");
await p.emulateMedia({ colorScheme: "dark" }); await axe(p, F, "detail dark"); await p.screenshot({ path: IMG + "f_detail_dark.png", fullPage: true }); await p.emulateMedia({ colorScheme: "light" });
// 4) Kopyala
await p.getByTestId("customer-copy").getByRole("button").first().click();
await p.waitForTimeout(200);
const st = await p.getByTestId("customer-copy").getByRole("status").innerText().catch(() => "?");
const clip = await p.evaluate(() => navigator.clipboard.readText());
await p.waitForTimeout(2600);
const st2 = await p.getByTestId("customer-copy").getByRole("status").innerText().catch(() => "?");
log("copy", { status: st, clipEqualsUrl: clip === url, after26s: st2 });
// 5) Liste: çift kayıt ve arama
for (const q of [NAME.toLowerCase(), "TEST MÜŞTERİ P8C " + stamp, "test musteri p8c " + stamp, "çağrı öztürk", "05321112233"]) {
  await p.goto(B + "/customers?status=all&q=" + encodeURIComponent(q), { waitUntil: "networkidle" });
  log("search", { q: q.replace(stamp, "<stamp>"), rows: await p.getByTestId("customer-row").count() });
}
await p.goto(B + "/customers", { waitUntil: "networkidle" });
await p.getByTestId("customer-search").fill("Te"); await p.waitForTimeout(900);
log("debounced-search-url", new URL(p.url()).search);
await p.getByTestId("customer-search").fill(stamp); await p.waitForTimeout(900);
log("search-typed", { url: new URL(p.url()).search.replace(stamp, "<stamp>"), rows: await p.getByTestId("customer-row").count() });
await p.reload({ waitUntil: "networkidle" });
log("after-reload", { val: (await p.getByTestId("customer-search").inputValue()) === stamp, rows: await p.getByTestId("customer-row").count() });
const row = p.getByTestId("customer-row").first();
log("row", (await row.innerText()).replace(/\s+/g, " ").replace(/[a-z2-7]{16}/g, "<ref>"));
await p.screenshot({ path: IMG + "f_list_row_light.png", fullPage: true });
await row.getByRole("link").first().click(); await p.waitForURL(/customers\/[0-9A-Z]{26}/);
await p.goBack({ waitUntil: "networkidle" });
log("back", { url: new URL(p.url()).search.replace(stamp, "<stamp>"), rows: await p.getByTestId("customer-row").count() });
// 6) 409 çakışma (büyük harf)
await p.goto(B + "/customers", { waitUntil: "networkidle" });
await p.getByTestId("customer-new").click();
await form.getByLabel("Firma adı").fill(NAME.toLocaleUpperCase("tr-TR"));
await form.getByTestId("cf-submit").click(); await p.waitForTimeout(1500);
log("conflict", { stillOpen: await form.isVisible(), errs: await errs() });
await br.close();
