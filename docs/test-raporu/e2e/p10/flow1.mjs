// P10 akış 1: Admin ilk giriş → zorunlu 2FA kurulumu; çıkış → giriş + TOTP; kurtarma kodu (tekrar kullanım reddi).
// Sırlar (TOTP anahtarı, kurtarma kodları) yalnız $WORK/sec.json (repo dışı, 600). Sonuç flow.jsonl, ekranlar img/.
import { chromium, B, WORK, IMG, rec, track, axe, overflow, csrfFetch } from "./common.mjs";
import { freshTotp } from "./totp.mjs";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
const F = "flow.jsonl";
const SEC = WORK + "/sec.json";
const sec = existsSync(SEC) ? JSON.parse(readFileSync(SEC, "utf8")) : {};
const save = () => writeFileSync(SEC, JSON.stringify(sec), { mode: 0o600 });
const used = new Set();
const br = await chromium.launch();
export async function step(name, fn) {
  try { const note = await fn(); rec(F, { step: name, ok: true, note }); console.log("GEÇTİ", name, note ?? ""); }
  catch (e) { rec(F, { step: name, ok: false, err: e.message.slice(0, 400) }); console.log("KALDI", name, e.message.split("\n")[0].slice(0, 300)); }
}
async function pwLogin(p, id, pw) {
  await p.goto(B + "/login");
  await p.getByLabel("E-posta veya kullanıcı adı").fill(id);
  await p.getByLabel("Şifre", { exact: true }).fill(pw);
  await p.getByRole("button", { name: "Giriş yap" }).click();
  await p.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 });
}
const A = process.env.P10_ADMIN_LOGIN, PW = process.env.P10_ADMIN_PW;
const ctx = await br.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage(); track(p, F, "admin1");

await step("1 Admin ilk giriş → /2fa/setup kapısı; panele kaçış yok", async () => {
  const t0 = Date.now();
  await pwLogin(p, A, PW);
  if (!p.url().endsWith("/2fa/setup")) throw new Error("url " + p.url());
  await p.getByTestId("mfa-qr").waitFor();
  await p.screenshot({ path: IMG + "setup-desktop.png", mask: [p.getByTestId("mfa-qr"), p.getByTestId("mfa-secret")] });
  for (const u of ["/users", "/account", "/settings/smtp", "/"]) { await p.goto(B + u); if (!p.url().endsWith("/2fa/setup")) throw new Error(u + " → " + p.url()); }
  const api = await csrfFetch(p, "GET", "/api/v1/users");
  const ax = await axe(p, F, "2fa-setup light 1366");
  const ov = await overflow(p, F, "2fa-setup 1366");
  return `süre ${Date.now() - t0} ms, /api/v1/users=${api.status} ${api.body?.code ?? ""}, axe=${ax.length}, taşma=${ov.doc}`;
});

await step("2 Kurulum: QR + elle anahtar, hatalı kod, doğru kod → 10 kurtarma kodu, 'Kaydettim' kapısı, .txt", async () => {
  const secret = (await p.getByTestId("mfa-secret").innerText()).replace(/\s/g, "");
  const qrAlt = await p.getByTestId("mfa-qr").getAttribute("alt");
  await p.getByTestId("mfa-setup-code").fill("000000");
  await p.getByTestId("mfa-enable").click();
  await p.waitForTimeout(800);
  const inv = await p.getByTestId("mfa-setup-code").getAttribute("aria-invalid");
  await p.screenshot({ path: IMG + "setup-wrong-code.png", mask: [p.getByTestId("mfa-qr"), p.getByTestId("mfa-secret")] });
  await p.getByTestId("mfa-setup-code").fill(await freshTotp(secret, used));
  await p.getByTestId("mfa-enable").click();
  await p.getByTestId("recovery-code").first().waitFor();
  const codes = await p.getByTestId("recovery-code").allInnerTexts();
  const doneDis = await p.getByTestId("rc-done").isDisabled();
  const dl = p.waitForEvent("download"); await p.getByTestId("rc-download").click();
  const d = await dl; const fn = d.suggestedFilename(); const txt = readFileSync(await d.path(), "utf8");
  await p.screenshot({ path: IMG + "recovery-codes-desktop.png", mask: [p.getByTestId("recovery-code")] });
  const ax = await axe(p, F, "recovery codes light 1366");
  sec.adminTotp = secret; sec.adminRc = codes.map((c) => c.trim()); save();
  await p.getByTestId("rc-saved").check();
  await p.getByTestId("rc-done").click();
  await p.waitForURL((u) => u.pathname === "/", { timeout: 10000 });
  // Geri tuşu: kodlar tekrar görünmemeli
  await p.goBack(); await p.waitForTimeout(1000);
  const again = await p.getByTestId("recovery-code").count();
  const backUrl = new URL(p.url()).pathname;
  await ctx.storageState({ path: WORK + "/state-admin.json" });
  return `alt="${qrAlt}", anahtar uzunluğu=${secret.length}, hatalı kod aria-invalid=${inv}, kod sayısı=${codes.length}, tekil=${new Set(codes).size}, 'Devam' başta pasif=${doneDis}, dosya=${fn}, dosyada kod=${sec.adminRc.filter((c) => txt.includes(c)).length}, axe=${ax.length}; geri tuşu → ${backUrl}, kodlar tekrar görünen=${again}`;
});

await step("3 Çıkış → giriş: /login/2fa, yarı oturumda panel kapalı, hatalı kod, doğru TOTP → panel", async () => {
  await p.goto(B + "/");
  await p.getByRole("button", { name: /Çıkış/ }).first().click();
  await p.waitForURL(/\/login/);
  await pwLogin(p, A, PW);
  if (!p.url().endsWith("/login/2fa")) throw new Error("url " + p.url());
  await p.goto(B + "/sessions"); const gate = new URL(p.url()).pathname;
  const api = await csrfFetch(p, "GET", "/api/v1/sessions");
  const code = p.getByLabel("6 haneli kod");
  await code.fill("123456"); await p.getByTestId("mfa-submit").click();
  await p.waitForTimeout(800);
  const inv = await code.getAttribute("aria-invalid"); const val = await code.inputValue();
  await p.screenshot({ path: IMG + "login-2fa-wrong.png" });
  const ax = await axe(p, F, "login/2fa light 1366");
  await code.fill(await freshTotp(sec.adminTotp, used)); await p.getByTestId("mfa-submit").click();
  await p.waitForURL((u) => u.pathname === "/", { timeout: 10000 });
  await ctx.storageState({ path: WORK + "/state-admin.json" });
  return `yarı oturumda /sessions → ${gate}, API=${api.status} ${api.body?.code ?? ""}; hatalı kod aria-invalid=${inv}, alan temizlendi=${val === ""}, axe=${ax.length}`;
});

await step("4 Kurtarma koduyla giriş; aynı kod ikinci kez reddedilir; /account kalan kod", async () => {
  const c2 = await br.newContext({ viewport: { width: 1366, height: 900 } }); const q = await c2.newPage(); track(q, F, "admin1-rc");
  const rc = sec.adminRc[0];
  await pwLogin(q, A, PW);
  await q.getByTestId("mfa-mode").click();
  await q.getByLabel("Kurtarma kodu").fill(rc); await q.getByTestId("mfa-submit").click();
  await q.waitForURL((u) => u.pathname === "/", { timeout: 10000 });
  await q.goto(B + "/account"); const left = await q.getByTestId("acc-rc-left").innerText();
  await q.screenshot({ path: IMG + "account-desktop.png" });
  await q.getByRole("button", { name: /Çıkış/ }).first().click(); await q.waitForURL(/\/login/);
  await pwLogin(q, A, PW);
  await q.getByTestId("mfa-mode").click();
  await q.getByLabel("Kurtarma kodu").fill(rc); await q.getByTestId("mfa-submit").click();
  await q.waitForTimeout(1000);
  const url2 = new URL(q.url()).pathname; const err = (await q.getByTestId("mfa-verify-form").innerText()).replace(/\s+/g, " ").slice(0, 200);
  await q.screenshot({ path: IMG + "login-rc-reused.png" });
  // büyük harf / boşluklu yazım kabul ediliyor mu (ikinci kod)
  const rc2 = sec.adminRc[1].toUpperCase().replace("-", " - ");
  await q.getByLabel("Kurtarma kodu").fill(rc2); await q.getByTestId("mfa-submit").click();
  await q.waitForTimeout(1500); const url3 = new URL(q.url()).pathname;
  await c2.close();
  if (url2 !== "/login/2fa") throw new Error("tekrar kullanılan kod kabul edildi");
  return `ilk giriş OK, ${left}; ikinci kullanım → ${url2}, mesaj: "${err}"; büyük harf+boşluklu 2. kod → ${url3}`;
});
await br.close();
