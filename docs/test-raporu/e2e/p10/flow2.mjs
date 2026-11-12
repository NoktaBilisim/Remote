// P10 akış 2: SMTP ayarları (AC-79/80/122) — sahte SMTP smtp.op.test:2525 (op-server.ts netguard yalnız 127.0.0.1'e izin verir).
import { chromium, B, WORK, IMG, rec, track, axe, overflow, csrfFetch } from "./common.mjs";
import { F, step, sleep } from "./lib.mjs";
import { mails } from "./mail.mjs";
const br = await chromium.launch();
const ctx = await br.newContext({ storageState: WORK + "/state-admin.json", viewport: { width: 1366, height: 900 } });
const p = await ctx.newPage(); track(p, F, "admin1-smtp");
const sec = () => p.getByRole("group", { name: "Güvenlik" });
const saveBtn = () => p.getByTestId("save-bar").getByRole("button", { name: "Kaydet" });
const toast = () => p.getByTestId("toast").last();

await step("5 /settings/smtp ayarsız durum: uyarı, test pasif, alt menü aria-current", async () => {
  await p.goto(B + "/settings/smtp");
  await p.getByTestId("smtp-form").waitFor();
  const un = await p.getByTestId("smtp-unconfigured").count();
  const dis = await p.getByTestId("smtp-test-open").isDisabled();
  const cur = await p.getByRole("navigation", { name: "Ayarlar menüsü" }).getByRole("link", { name: "E-posta (SMTP)" }).getAttribute("aria-current");
  const port = await p.getByTestId("smtp-port").inputValue();
  const opts = await p.getByTestId("smtp-port").locator("option").allInnerTexts();
  await p.screenshot({ path: IMG + "smtp-unconfigured.png", fullPage: true });
  const ax = await axe(p, F, "smtp unconfigured light 1366");
  return `uyarı=${un}, test pasif=${dis}, aria-current=${cur}, port=${port}, seçenekler=${opts.join("/")}, axe=${ax.length}`;
});

await step("6 Güvenlik → port önerisi; Yok → kimlik alanları pasif+boş; SSL/TLS'e dönünce değer geri gelir", async () => {
  const out = [];
  await p.getByTestId("smtp-user").fill("kullanici@op.test");
  await p.getByTestId("smtp-password").fill("Gecici-Op-Deger-1");
  for (const s of ["SSL", "TLS", "Yok"]) { await sec().getByRole("button", { name: s, exact: true }).click(); out.push(`${s}→${await p.getByTestId("smtp-port").inputValue()}`); }
  const ud = await p.getByTestId("smtp-user").isDisabled(), uv = await p.getByTestId("smtp-user").inputValue();
  const pd = await p.getByTestId("smtp-password").isDisabled();
  const nc = await p.getByTestId("smtp-no-creds").innerText().catch(() => "-");
  const ins = await p.getByTestId("smtp-insecure").innerText().catch(() => "-");
  await p.screenshot({ path: IMG + "smtp-none-selected.png", fullPage: true });
  await sec().getByRole("button", { name: "TLS", exact: true }).click();
  const back = await p.getByTestId("smtp-user").inputValue();
  await p.getByTestId("smtp-port").selectOption("2525");
  await sec().getByRole("button", { name: "SSL", exact: true }).click();
  const keep = await p.getByTestId("smtp-port").inputValue();
  return `${out.join(", ")}; Yok: user pasif=${ud} boş=${uv === ""}, şifre pasif=${pd}; açıklama="${nc}"; uyarı="${ins.slice(0, 120)}"; TLS'e dönüş user geri=${back === "kullanici@op.test"}; 2525 SSL'de korunur=${keep === "2525"}`;
});

await step("7 Kayıt: iç ağ adresleri genel mesajla reddedilir (AC-122)", async () => {
  await sec().getByRole("button", { name: "Yok", exact: true }).click();
  await p.getByTestId("smtp-from-name").fill("Op Destek");
  await p.getByTestId("smtp-from-email").fill("destek@p10op.invalid");
  const res = [];
  for (const h of ["10.0.0.5", "192.168.1.10", "169.254.169.254", "100.64.0.1", "172.17.0.1", "[::1]", "yok-boyle-alan.invalid"]) {
    await p.getByTestId("smtp-host").fill(h);
    const r = p.waitForResponse((x) => x.url().endsWith("/api/v1/settings/tenant") && x.request().method() === "PUT", { timeout: 15000 }).catch(() => null);
    await saveBtn().click();
    const resp = await r;
    await p.waitForTimeout(400);
    const err = await p.locator('[id$="-error"], [role="alert"]').filter({ hasText: /./ }).allInnerTexts();
    res.push(`${h}→${resp?.status() ?? "istek yok"} "${err.join(" | ").slice(0, 80)}"`);
  }
  await p.screenshot({ path: IMG + "smtp-host-denied.png", fullPage: true });
  return res.join("; ");
});

await step("8 Geçerli kayıt (smtp.op.test, Yok, 2525) → toast; yenileme sonrası kalıcı", async () => {
  await p.getByTestId("smtp-host").fill("smtp.op.test");
  await sec().getByRole("button", { name: "Yok", exact: true }).click();
  await p.getByTestId("smtp-port").selectOption("2525");
  const put = p.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/v1/settings/tenant"));
  await saveBtn().click();
  const body = (await put).postDataJSON().smtp;
  await toast().waitFor({ timeout: 8000 }); const t = await toast().innerText();
  await p.reload(); await p.getByTestId("smtp-form").waitFor();
  const v = [await p.getByTestId("smtp-host").inputValue(), await p.getByTestId("smtp-port").inputValue(), await p.getByTestId("smtp-from-name").inputValue()];
  const un = await p.getByTestId("smtp-unconfigured").count();
  return `gövde security=${body.security} port=${body.port} user="${body.user}" password alanı var=${"password" in body}; toast="${t}"; yenileme sonrası ${v.join(" / ")}, ayarsız uyarısı=${un}`;
});

await step("9 Test Maili Gönder → alıcı sorulur, başarı, sahte SMTP'ye ulaşır (AC-80)", async () => {
  const before = mails(WORK).length;
  await p.getByTestId("smtp-test-open").click();
  const dlg = p.getByTestId("smtp-test-dialog");
  const focused = await dlg.getByLabel("Alıcı e-posta adresi").evaluate((e) => e === document.activeElement);
  await dlg.getByTestId("mail-test-send").click();
  await p.waitForTimeout(300);
  const emptyErr = await dlg.getByLabel("Alıcı e-posta adresi").getAttribute("aria-invalid");
  await dlg.getByLabel("Alıcı e-posta adresi").fill("bt@p10op.invalid");
  const t0 = Date.now();
  await dlg.getByTestId("mail-test-send").click();
  await dlg.getByTestId("mail-test-result").waitFor({ timeout: 20000 });
  const ms = Date.now() - t0; const r = await dlg.getByTestId("mail-test-result").innerText();
  await p.screenshot({ path: IMG + "smtp-test-ok.png" });
  const ax = await axe(p, F, "smtp test dialog", '[data-testid="smtp-test-dialog"]');
  await p.keyboard.press("Escape");
  await sleep(500);
  const m = mails(WORK).slice(before);
  return `odak alıcıda=${focused}, boş alıcı aria-invalid=${emptyErr}; sonuç "${r}" ${ms} ms; sahte SMTP'ye gelen=${m.length} (konu "${m[0]?.subject ?? "-"}", alıcı ${m[0]?.rcpt ?? "-"}); axe=${ax.length}`;
});

await step("10 TLS + kullanıcı/şifre kaydı; şifre forma geri yazılmaz; boş bırakınca korunur", async () => {
  await sec().getByRole("button", { name: "TLS", exact: true }).click();
  await p.getByTestId("smtp-port").selectOption("2525");
  await p.getByTestId("smtp-user").fill("kullanici@op.test");
  await p.getByTestId("smtp-password").fill("Gecici-Op-Deger-1");
  await saveBtn().click(); await toast().waitFor({ timeout: 8000 });
  await p.reload(); await p.getByTestId("smtp-form").waitFor();
  const pv = await p.getByTestId("smtp-password").inputValue();
  const ptype = await p.getByTestId("smtp-password").getAttribute("type");
  const hint = await p.getByText("Kayıtlı bir şifre var").count();
  const get = await csrfFetch(p, "GET", "/api/v1/settings/tenant");
  const leak = JSON.stringify(get.body).includes("Gecici-Op-Deger-1");
  // boş şifreyle başka alan değiştir → password gönderilmez
  await p.getByTestId("smtp-from-name").fill("Op Destek 2");
  const put = p.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/v1/settings/tenant"));
  await saveBtn().click(); const b = (await put).postDataJSON().smtp; await toast().waitFor();
  return `şifre alanı boş=${pv === ""} type=${ptype}, "kayıtlı şifre" ipucu=${hint}, GET yanıtında şifre=${leak} (smtp anahtarları: ${Object.keys(get.body?.smtp ?? {}).join(",")}); boşken PUT'ta password=${"password" in b}`;
});

await step("11 Hatalı yapılandırmada Test Maili: genel mesaj, süre, bekleme sırasında arayüz", async () => {
  // TLS(STARTTLS) istenir ama sahte sunucu desteklemiyor → başarısız
  await p.getByTestId("smtp-test-open").click();
  const dlg = p.getByTestId("smtp-test-dialog");
  await dlg.getByLabel("Alıcı e-posta adresi").fill("bt@p10op.invalid");
  const t0 = Date.now();
  await dlg.getByTestId("mail-test-send").click();
  await sleep(1500);
  const btn = dlg.getByTestId("mail-test-send");
  const w1 = { txt: (await btn.innerText()).trim(), dis: await btn.isDisabled(), busy: await btn.getAttribute("aria-busy"), dlgTxt: (await dlg.innerText()).replace(/\s+/g, " ").slice(0, 200) };
  await p.screenshot({ path: IMG + "smtp-test-waiting-1s.png" });
  await sleep(6000);
  await p.screenshot({ path: IMG + "smtp-test-waiting-7s.png" });
  const escClosed = await (async () => { await p.keyboard.press("Escape"); await sleep(300); return (await dlg.count()) === 0 || !(await dlg.isVisible()); })();
  let r = "-";
  if (!escClosed) { await dlg.getByTestId("mail-test-result").waitFor({ timeout: 30000 }); r = await dlg.getByTestId("mail-test-result").innerText(); }
  const ms = Date.now() - t0;
  await p.screenshot({ path: IMG + "smtp-test-fail.png" });
  if (!escClosed) await p.keyboard.press("Escape");
  return `1,5 sn'de düğme "${w1.txt}" pasif=${w1.dis} aria-busy=${w1.busy}; diyalog: "${w1.dlgTxt}"; Esc ile kapandı=${escClosed}; sonuç "${r}" toplam ${ms} ms`;
});

await step("12 Kirliyken test pasif; ayrılma uyarısı; 'SMTP ayarlarını kaldır' onaylı", async () => {
  await p.reload(); await p.getByTestId("smtp-form").waitFor();
  await p.getByTestId("smtp-from-name").fill("Kirli");
  const dis = await p.getByTestId("smtp-test-open").isDisabled();
  let dialog = null; p.once("dialog", async (d) => { dialog = d.type() + ":" + d.message(); await d.dismiss(); });
  await p.getByRole("navigation", { name: "Ayarlar menüsü" }).getByRole("link", { name: "Güvenlik" }).click();
  await sleep(1000);
  const url = new URL(p.url()).pathname;
  const ui = await p.getByRole("alertdialog").count();
  const uiTxt = ui ? (await p.getByRole("alertdialog").innerText()).replace(/\s+/g, " ").slice(0, 120) : "";
  await p.screenshot({ path: IMG + "smtp-leave-guard.png" });
  return `kirliyken test pasif=${dis}; menüden ayrılma → url=${url}, native dialog=${dialog}, uygulama diyaloğu=${ui} "${uiTxt}"`;
});

await step("13 Test sınırı 5/dk/tenant → 429 mesajı (AC-122)", async () => {
  await p.goto(B + "/settings/smtp"); await p.getByTestId("smtp-form").waitFor();
  await sec().getByRole("button", { name: "Yok", exact: true }).click();
  await p.getByTestId("smtp-port").selectOption("2525");
  await p.getByTestId("smtp-from-name").fill("Op Destek");
  await saveBtn().click(); await toast().waitFor();
  const st = [];
  for (let i = 0; i < 6; i++) {
    const r = await csrfFetch(p, "POST", "/api/v1/settings/smtp/test", { to: "bt@p10op.invalid" });
    st.push(r.status);
    if (r.status === 404) break;
  }
  await p.getByTestId("smtp-test-open").click();
  const dlg = p.getByTestId("smtp-test-dialog");
  await dlg.getByLabel("Alıcı e-posta adresi").fill("bt@p10op.invalid");
  await dlg.getByTestId("mail-test-send").click();
  await dlg.getByTestId("mail-test-result").waitFor({ timeout: 20000 });
  const r = await dlg.getByTestId("mail-test-result").innerText();
  await p.screenshot({ path: IMG + "smtp-test-429.png" });
  await p.keyboard.press("Escape");
  return `API ardışık durumlar=${st.join(",")}; arayüz: "${r}"`;
});
await ctx.storageState({ path: WORK + "/state-admin.json" });
await br.close();
