// P10 akış 5 (SMTP düzeltildikten sonra 14 ve 20 tekrar; akış 3'ün düzeltilmiş tekrarı: 11b, 14, 19, 20; 19 için yeni USER kurulumu 18'den): SMTP hata süresi + sınır, şifremi unuttum/sıfırlama, şifre değiştir, tüm cihazlardan çıkış,
// 2FA zorunluluk anahtarı → USER kapısı, Admin 2FA sıfırlama, oturum linki e-postası, talep e-posta kanalı, boşta kalma.
import { chromium, B, WORK, IMG, rec, track, axe, overflow, csrfFetch } from "./common.mjs";
import { F, step, sleep, sec, save, pwLogin, fullLogin, used, sql } from "./lib.mjs";
import { freshTotp } from "./totp.mjs";
import { mails } from "./mail.mjs";
const A = process.env.P10_ADMIN_LOGIN;
const br = await chromium.launch();
const ctx = await br.newContext({ storageState: WORK + "/state-admin.json", viewport: { width: 1366, height: 900 } });
let p = await ctx.newPage(); track(p, F, "admin1-f3");
const saveBtn = () => p.getByTestId("save-bar").getByRole("button", { name: "Kaydet" });
const grp = () => p.getByRole("group", { name: "Güvenlik" });
const newMail = async (before, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const m = mails(WORK).slice(before); if (m.length) return m; await sleep(300); } return []; };
sec.adminPw ??= process.env.P10_ADMIN_PW;

await step("R SMTP'yi çalışan ayara döndür (Yok, 2525)", async () => {
  await p.goto(B + "/settings/smtp"); await p.getByTestId("smtp-form").waitFor();
  await grp().getByRole("button", { name: "Yok", exact: true }).click(); await p.getByTestId("smtp-port").selectOption("2525");
  await saveBtn().click(); await p.getByTestId("toast").last().waitFor();
});
await step("14 Şifremi unuttum: kayıtlı/kayıtsız aynı yanıt; mail yalnız kayıtlıya; link → sıfırlama; tekrar kullanım geçersiz", async () => {
  const c = await br.newContext({ viewport: { width: 1366, height: 900 } }); const q = await c.newPage(); track(q, F, "forgot");
  const res = [];
  for (const em of ["kimse-yok@p10op.invalid", A]) {
    const before = mails(WORK).length;
    await q.goto(B + "/login"); await q.getByTestId("forgot-link").click(); await q.waitForURL(/forgot-password/);
    await q.getByLabel("E-posta").fill(em);
    const rp = q.waitForResponse((x) => x.url().includes("/password/forgot"));
    const t0 = Date.now(); await q.getByRole("button", { name: "Bağlantı gönder" }).click();
    const resp = await rp; const ms = Date.now() - t0;
    const txt = await q.getByTestId("forgot-sent").innerText();
    const m = await newMail(before, em === A ? 8000 : 3000);
    res.push({ em: em === A ? "kayıtlı" : "kayıtsız", status: resp.status(), ms, txt, mails: m.length, m: m[0] });
  }
  await q.screenshot({ path: IMG + "forgot-sent.png" });
  const ax = await axe(q, F, "forgot-password sent");
  const m = res[1].m; const link = [...(m?.body ?? "").matchAll(/https?:\/\/[^\s"<>]*\/reset-password#token=[A-Za-z0-9_-]+/g)].map((x) => x[0]).sort((a, b) => b.length - a.length)[0];
  if (!link) throw new Error("mailde link yok: " + JSON.stringify(res.map(({ m, ...r }) => r)));
  await q.goto(link.replace(/^https?:\/\/[^/]+/, B));
  await q.getByTestId("reset-form").waitFor(); await sleep(500);
  const stripped = !q.url().includes("token");
  await q.getByLabel("Yeni şifre", { exact: true }).fill("kisa");
  await q.getByLabel("Yeni şifre (tekrar)").fill("kisa"); await q.getByTestId("reset-submit").click(); await sleep(500);
  const weak = (await q.getByTestId("reset-form").innerText()).replace(/\s+/g, " ").slice(0, 160);
  await q.screenshot({ path: IMG + "reset-weak.png" });
  const NEW = "Op-" + Math.random().toString(36).slice(2) + "-Yeni-2026";
  await q.getByLabel("Yeni şifre", { exact: true }).fill(NEW); await q.getByLabel("Yeni şifre (tekrar)").fill(NEW);
  await q.getByTestId("reset-submit").click(); await q.waitForURL(/reason=reset/, { timeout: 10000 });
  sec.adminPw = NEW; save();
  // eski oturum (ctx) düştü mü?
  const old = await csrfFetch(p, "GET", "/api/v1/auth/me");
  // aynı link ikinci kez
  await q.goto(B + "/login"); await q.goto(link.replace(/^https?:\/\/[^/]+/, B));
  await q.getByLabel("Yeni şifre", { exact: true }).fill(NEW + "x"); await q.getByLabel("Yeni şifre (tekrar)").fill(NEW + "x");
  await q.getByTestId("reset-submit").click(); await q.getByTestId("reset-invalid").waitFor({ timeout: 8000 });
  await q.screenshot({ path: IMG + "reset-invalid.png" });
  await fullLogin(q, A, NEW, sec.adminTotp); const ok = new URL(q.url()).pathname;
  await c.storageState({ path: WORK + "/state-admin.json" }); await c.close();
  const sum = res.map((r) => `${r.em}: ${r.status} ${r.ms}ms "${r.txt.slice(0, 70)}" mail=${r.mails}`).join("; ");
  return `${sum}; konu "${m.subject}"; token adres çubuğundan silindi=${stripped}; zayıf şifre: "${weak}"; sıfırlama sonrası eski oturum /auth/me=${old.status}; link 2. kez → geçersiz ekranı; yeni şifre+TOTP → ${ok}; axe=${ax.length}`;
});

await ctx.close();
const c1 = await br.newContext({ storageState: WORK + "/state-admin.json", viewport: { width: 1366, height: 900 } });
p = await c1.newPage(); track(p, F, "admin1-f3b");

let uEmail = `tek-${Date.now().toString(36)}@p10op.invalid`, uId, uPw;


await step("20 Oturum linkini e-postayla gönder (AC-10): mail içerik + sonuç satırı", async () => {
  await p.goto(B + "/sessions");
  await p.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const dlg = p.getByTestId("new-session-dialog");
  await dlg.getByTestId("new-session-create").click();
  await dlg.getByTestId("session-email-open").click();
  const to = dlg.getByTestId("session-email-to");
  await dlg.getByTestId("session-email-send").click(); await sleep(400);
  const emptyInv = await to.getAttribute("aria-invalid");
  await to.fill("<script>alert(1)</script>@x"); await dlg.getByTestId("session-email-send").click(); await sleep(400);
  const badInv = await to.getAttribute("aria-invalid");
  const before = mails(WORK).length;
  await to.fill("musteri@p10op.invalid"); await dlg.getByTestId("session-email-send").click();
  await dlg.getByTestId("session-email-result").waitFor({ timeout: 20000 });
  const r = await dlg.getByTestId("session-email-result").innerText();
  await p.screenshot({ path: IMG + "session-email.png" });
  const m = (await newMail(before))[0];
  const hasLink = /\/s\/|\/j\/|https?:\/\//.test(m?.body ?? ""); const hasCode = /\b\d{3}[ -]?\d{3}\b/.test(m?.body ?? "");
  const hasTime = /\d{1,2}:\d{2}/.test(m?.body ?? ""); const hasTech = (m?.body ?? "").includes("E2E Teknisyen 1");
  const ax = await axe(p, F, "new-session dialog email", '[data-testid="new-session-dialog"]');
  await p.keyboard.press("Escape");
  return `boş aria-invalid=${emptyInv}, <script> aria-invalid=${badInv}; sonuç "${r}"; mail konu "${m?.subject}", link=${hasLink}, kod=${hasCode}, saat=${hasTime}, teknisyen adı=${hasTech}; axe=${ax.length}`;
});

await c1.storageState({ path: WORK + "/state-admin.json" });
await br.close();
