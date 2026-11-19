// TOTP kapatma 400 incelemesi: aç → kapat, yanıt gövdesi + form ekranı.
import fs from "node:fs";
import { chromium, BASE, scan, rec, freshTotp } from "./k9lib.mjs";
const DIR = process.env.K9_DIR; const acc = JSON.parse(fs.readFileSync(DIR + "/accounts.json"));
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
p.on("response", async (r) => { if (r.url().includes("/portal/account/totp") || r.url().includes("auth/login")) console.log(r.status(), r.url().replace(BASE, ""), (await r.text().catch(() => "")).slice(0, 300)); });
p.on("request", (r) => { if (r.url().includes("totp/disable")) console.log("BODY", r.postData()?.replace(/"(password|current)":"[^"]+"/, '"$1":"***"')); });
await p.goto(BASE + "/portal/login?tenant=demo");
await p.getByTestId("portal-email").fill(acc.ali.email); await p.getByTestId("portal-password").fill(acc.ali.pw); await p.getByTestId("portal-login-submit").click();
await p.waitForTimeout(1500);
console.log("url", p.url(), "kod alanı", await p.getByTestId("portal-code").count());
await p.goto(BASE + "/portal/account"); console.log("mfa", await p.getByTestId("portal-mfa").getAttribute("data-enabled"));
if ((await p.getByTestId("portal-mfa").getAttribute("data-enabled")) === "false") {
  await p.getByTestId("portal-mfa-on").click(); await p.getByTestId("portal-mfa-qr").waitFor();
  const secret = (await p.locator('[aria-labelledby="portal-mfa-key"]').innerText()).replace(/\s+/g, "");
  fs.writeFileSync(DIR + "/ali-totp.txt", secret);
  await p.getByTestId("portal-mfa-code").fill(await freshTotp(secret)); await p.getByTestId("portal-mfa-enable").click(); await p.waitForTimeout(1000);
}
const secret = fs.readFileSync(DIR + "/ali-totp.txt", "utf8");
await p.getByTestId("portal-mfa-off").click(); await p.waitForTimeout(300);
const form = p.getByTestId("portal-mfa-disable-form");
console.log("form:", (await form.innerText()).replace(/\s+/g, " "));
console.log("inputs:", await form.locator("input").evaluateAll((is) => is.map((i) => i.id + ":" + i.type + ":" + (i.labels?.[0]?.textContent ?? ""))));
await form.locator("input[type=password]").first().fill(acc.ali.pw);
await p.getByTestId("portal-mfa-code").fill(await freshTotp(secret)); await p.getByTestId("portal-mfa-disable-confirm").click(); await p.waitForTimeout(1500);
console.log("sonuç", await p.getByTestId("portal-mfa").getAttribute("data-enabled"));
await scan(p, "portal-totp-kapat-sonuc-1280-light", { full: false });
await b.close();
