// P10 akış 3: SMTP hata süresi + sınır, şifremi unuttum/sıfırlama, şifre değiştir, tüm cihazlardan çıkış,
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

await step("11b Hatalı SMTP (TLS istenir, sunucu STARTTLS sunmaz) → Test: bekleme süresi ve sonuç", async () => {
  await p.goto(B + "/settings/smtp"); await p.getByTestId("smtp-form").waitFor();
  await grp().getByRole("button", { name: "TLS", exact: true }).click();
  await p.getByTestId("smtp-port").selectOption("2525");
  await saveBtn().click(); await p.getByTestId("toast").last().waitFor();
  await sleep(61000); // önceki dakikadaki test kotası boşalsın
  await p.getByTestId("smtp-test-open").click();
  const dlg = p.getByTestId("smtp-test-dialog");
  await dlg.getByLabel("Alıcı e-posta adresi").fill("bt@p10op.invalid");
  const t0 = Date.now(); await dlg.getByTestId("mail-test-send").click();
  await dlg.getByTestId("mail-test-result").waitFor({ timeout: 30000 });
  const ms = Date.now() - t0; const r = await dlg.getByTestId("mail-test-result").innerText();
  await p.screenshot({ path: IMG + "smtp-test-fail.png" });
  await p.keyboard.press("Escape");
  return `sonuç "${r}" ${ms} ms`;
});

await step("13 Test sınırı 5/dk/tenant → 429 (AC-122)", async () => {
  await p.goto(B + "/settings/smtp"); await p.getByTestId("smtp-form").waitFor();
  await grp().getByRole("button", { name: "Yok", exact: true }).click();
  await p.getByTestId("smtp-port").selectOption("2525");
  await saveBtn().click(); await p.getByTestId("toast").last().waitFor();
  const st = [];
  for (let i = 0; i < 5; i++) st.push((await csrfFetch(p, "POST", "/api/v1/settings/smtp/test", { to: "bt@p10op.invalid" })).status);
  await p.getByTestId("smtp-test-open").click();
  const dlg = p.getByTestId("smtp-test-dialog");
  await dlg.getByLabel("Alıcı e-posta adresi").fill("bt@p10op.invalid");
  await dlg.getByTestId("mail-test-send").click();
  await dlg.getByTestId("mail-test-result").waitFor({ timeout: 20000 });
  const r = await dlg.getByTestId("mail-test-result").innerText();
  await p.screenshot({ path: IMG + "smtp-test-429.png" });
  await p.keyboard.press("Escape");
  return `API durumları (1 başarısız test bu dakikada önceden)=${st.join(",")}; arayüz 6.+: "${r}"`;
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
  const m = res[1].m; const link = m?.body.match(/https?:\/\/[^\s"<>]*\/reset-password#token=[A-Za-z0-9_-]+/)?.[0];
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

await step("15 /account şifre değiştir: hatalı mevcut, eşleşmeyen, başarı (sayfada kalır, toast)", async () => {
  await p.goto(B + "/account");
  const s = p.getByTestId("acc-pw");
  await s.getByLabel("Mevcut şifre").fill("yanlis-sifre-123");
  await s.getByLabel("Yeni şifre", { exact: true }).fill("Op-Degisim-2026-abc"); await s.getByLabel("Yeni şifre (tekrar)").fill("Op-Degisim-2026-abd");
  await s.getByRole("button", { name: "Şifreyi değiştir" }).click(); await sleep(500);
  const mm = (await s.innerText()).includes("eşleşmiyor");
  await s.getByLabel("Yeni şifre (tekrar)").fill("Op-Degisim-2026-abc");
  await s.getByRole("button", { name: "Şifreyi değiştir" }).click(); await sleep(800);
  const wrong = (await s.innerText()).includes("Mevcut şifre hatalı");
  await s.getByLabel("Mevcut şifre").fill(sec.adminPw);
  await s.getByRole("button", { name: "Şifreyi değiştir" }).click();
  await p.getByTestId("toast").filter({ hasText: "Şifreniz değiştirildi" }).waitFor({ timeout: 8000 });
  sec.adminPw = "Op-Degisim-2026-abc"; save();
  const url = new URL(p.url()).pathname; const cleared = (await s.getByLabel("Mevcut şifre").inputValue()) === "";
  return `eşleşmiyor mesajı=${mm}, hatalı mevcut mesajı=${wrong}, başarı → ${url}, alanlar temizlendi=${cleared}`;
});

await step("16 Tüm cihazlardan çıkış: ikinci tarayıcı oturumu ≤5 sn'de düşer, mevcut kalır (AC-68)", async () => {
  const c2 = await br.newContext({ viewport: { width: 1366, height: 900 } }); const q = await c2.newPage(); track(q, F, "admin1-2nd");
  await fullLogin(q, A, sec.adminPw, sec.adminTotp);
  await p.goto(B + "/account"); await p.getByTestId("acc-logout-all").click();
  const dlg = p.getByTestId("logout-all-dialog");
  const focus = await dlg.getByRole("button", { name: "Vazgeç" }).evaluate((e) => e === document.activeElement);
  await p.screenshot({ path: IMG + "logout-all-dialog.png" });
  await dlg.getByTestId("logout-all-confirm").click();
  const t0 = Date.now();
  const tt = await p.getByTestId("toast").last().innerText();
  let st = 200; while (Date.now() - t0 < 5000) { st = (await csrfFetch(q, "GET", "/api/v1/auth/me")).status; if (st === 401) break; await sleep(250); }
  const ms = Date.now() - t0;
  await q.goto(B + "/sessions"); const qurl = new URL(q.url()).pathname + new URL(q.url()).search;
  const me = (await csrfFetch(p, "GET", "/api/v1/auth/me")).status;
  await c2.close();
  return `odak Vazgeç=${focus}; toast "${tt}"; 2. oturum /auth/me=${st} (${ms} ms), panel → ${qurl}; mevcut oturum /auth/me=${me}`;
});

await step("17 /settings/security: teknisyen 2FA zorunlu anahtarı anında kayıt", async () => {
  await p.goto(B + "/settings/security");
  const sw = p.getByTestId("require-2fa-switch"); const before = await sw.getAttribute("aria-checked");
  if (before !== "true") { await sw.click(); await p.getByTestId("toast").last().waitFor(); }
  const t = await p.getByTestId("toast").last().innerText().catch(() => "-");
  await p.reload(); const after = await sw.getAttribute("aria-checked");
  await p.screenshot({ path: IMG + "settings-security.png" });
  const ax = await axe(p, F, "settings/security light 1366");
  return `önce=${before}, toast "${t}", yenileme sonrası=${after}, axe=${ax.length}`;
});

let uEmail = `tek-${Date.now().toString(36)}@p10op.invalid`, uId, uPw;
await step("18 USER oluştur → ilk giriş şifre değişimi → 2FA kurulum kapısı (zorunlu) → kurulum", async () => {
  await p.goto(B + "/users"); await p.getByTestId("user-new").click();
  const f = p.getByTestId("user-form");
  await f.getByLabel("Ad soyad").fill("Op Teknisyen"); await f.getByLabel("E-posta").fill(uEmail); await f.getByLabel("Rol").selectOption("USER");
  await f.getByTestId("uf-submit").click();
  const tp = p.getByTestId("user-temp-password"); await tp.waitFor();
  const temp = await tp.getByTestId("temp-password").inputValue();
  await tp.getByTestId("pw-done").click(); await tp.getByTestId("pw-close-anyway").click().catch(() => {});
  const l = await csrfFetch(p, "GET", `/api/v1/users?q=${encodeURIComponent(uEmail)}`); uId = l.body.items[0].id;
  const c = await br.newContext({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true }); const q = await c.newPage(); track(q, F, "user");
  await pwLogin(q, uEmail, temp); const u1 = new URL(q.url()).pathname;
  uPw = "Op-Tek-" + Math.random().toString(36).slice(2) + "-2026";
  await q.getByLabel("Mevcut şifre").fill(temp); await q.getByLabel("Yeni şifre", { exact: true }).fill(uPw); await q.getByLabel("Yeni şifre (tekrar)").fill(uPw);
  await q.getByRole("button", { name: /Şifreyi değiştir|Kaydet|Devam/ }).first().click();
  await q.waitForURL((u) => u.pathname !== "/change-password", { timeout: 10000 }); const u2 = new URL(q.url()).pathname;
  await q.getByTestId("mfa-secret").waitFor();
  const ov = await overflow(q, F, "2fa-setup m375"); const ax = await axe(q, F, "2fa-setup m375");
  await q.screenshot({ path: IMG + "setup-m375.png", fullPage: true, mask: [q.getByTestId("mfa-qr"), q.getByTestId("mfa-secret")] });
  await q.goto(B + "/sessions"); const u3 = new URL(q.url()).pathname;
  const s = (await q.getByTestId("mfa-secret").innerText()).replace(/\s/g, "");
  await q.getByTestId("mfa-setup-code").fill(await freshTotp(s, used)); await q.getByTestId("mfa-enable").click();
  await q.getByTestId("recovery-code").first().waitFor();
  const ov2 = await overflow(q, F, "recovery m375");
  await q.screenshot({ path: IMG + "recovery-m375.png", fullPage: true, mask: [q.getByTestId("recovery-code")] });
  await q.getByTestId("rc-saved").check(); await q.getByTestId("rc-done").click(); await q.waitForURL((u) => u.pathname === "/");
  sec.userTotp = s; save();
  await c.storageState({ path: WORK + "/state-user.json" }); await c.close();
  return `ilk giriş → ${u1}; şifre sonrası → ${u2}; kapıdan /sessions → ${u3}; 375 taşma kurulum=${ov.doc}/${ov.inner.length} kodlar=${ov2.doc}/${ov2.inner.length}; axe=${ax.length}`;
});

await step("19 Admin USER'ın 2FA'sını sıfırlar → USER oturumu düşer, sonraki girişte kurulum kapısı (AC-115)", async () => {
  const c = await br.newContext({ storageState: WORK + "/state-user.json" }); const q = await c.newPage();
  const me0 = (await csrfFetch(q.goto(B + "/").then(() => q), "GET", "/api/v1/auth/me")).status;
  await p.goto(B + "/users/" + uId);
  const s0 = await p.getByTestId("user-2fa").innerText();
  await p.getByTestId("user-reset-mfa").click();
  const dlg = p.getByTestId("user-reset-mfa-dialog");
  const focus = await dlg.getByRole("button", { name: "Vazgeç" }).evaluate((e) => e === document.activeElement);
  await p.screenshot({ path: IMG + "user-reset-mfa-dialog.png" });
  await dlg.getByTestId("user-action-confirm").click();
  const t = await p.getByTestId("toast").last().innerText();
  const s1 = await p.getByTestId("user-2fa").innerText(); const btn = await p.getByTestId("user-reset-mfa").count();
  await sleep(1500);
  const me1 = (await csrfFetch(q, "GET", "/api/v1/auth/me")).status;
  const own = await (async () => { const l = await csrfFetch(p, "GET", "/api/v1/auth/me"); await p.goto(B + "/users/" + l.body.user.id); return p.getByTestId("user-reset-mfa").count(); })();
  await c.close();
  const c3 = await br.newContext(); const r = await c3.newPage(); await pwLogin(r, uEmail, uPw); const u = new URL(r.url()).pathname; await c3.close();
  return `önce "${s0}" USER /auth/me=${me0}; odak Vazgeç=${focus}; toast "${t}"; sonra "${s1}", düğme=${btn}; USER oturumu /auth/me=${me1}; kendi kaydında düğme=${own}; USER yeniden giriş → ${u}`;
});

await step("20 Oturum linkini e-postayla gönder (AC-10): mail içerik + sonuç satırı", async () => {
  await p.goto(B + "/sessions");
  await p.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  const dlg = p.getByTestId("new-session-dialog");
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

await step("21 Talep ayarları e-posta kanalı (AC-151): alıcı + test maili", async () => {
  await p.goto(B + "/settings/support-requests");
  const ch = p.getByTestId("mail-channel"); const dis = await ch.getByTestId("mail-switch").isDisabled();
  if ((await ch.getByTestId("mail-switch").getAttribute("aria-checked")) !== "true") await ch.getByTestId("mail-switch").click();
  await ch.getByRole("button", { name: "E-posta alıcısı ekle" }).click();
  await ch.getByLabel("E-posta alıcıları 1").fill("Destek@P10op.invalid");
  await saveBtn().click(); await p.getByTestId("toast").last().waitFor();
  const before = mails(WORK).length;
  await ch.getByTestId("mail-test-open").click();
  const dlg = p.getByTestId("mail-test-dialog");
  await dlg.getByLabel("Alıcı e-posta adresi").fill("bt2@p10op.invalid"); await dlg.getByTestId("mail-test-send").click();
  await dlg.getByTestId("mail-test-result").waitFor({ timeout: 20000 }); const r = await dlg.getByTestId("mail-test-result").innerText();
  const m = await newMail(before);
  await p.keyboard.press("Escape"); await p.reload();
  const v = await p.getByTestId("mail-channel").getByLabel("E-posta alıcıları 1").inputValue();
  await p.screenshot({ path: IMG + "support-requests-mail.png", fullPage: true });
  return `anahtar pasif=${dis}; test "${r}", gelen mail=${m.length} (${m[0]?.subject ?? "-"}); kayıtlı alıcı "${v}"`;
});

await step("22 Boşta kalma: last_seen_at 31 dk geri + istemci saati ileri → /login?reason=expired (AC-68)", async () => {
  const c = await br.newContext({ viewport: { width: 1366, height: 900 } }); const q = await c.newPage(); track(q, F, "idle");
  await q.clock.install();
  await fullLogin(q, uEmail, uPw, sec.userTotp).catch(() => {});
  if (q.url().endsWith("/2fa/setup")) { const s = (await q.getByTestId("mfa-secret").innerText()).replace(/\s/g, ""); await q.getByTestId("mfa-setup-code").fill(await freshTotp(s, used)); await q.getByTestId("mfa-enable").click(); await q.getByTestId("rc-saved").check(); await q.getByTestId("rc-done").click(); await q.waitForURL((u) => u.pathname === "/"); }
  await q.goto(B + "/sessions"); await sleep(1000);
  await sql(`UPDATE auth_sessions SET last_seen_at = NOW(3) - INTERVAL 31 MINUTE WHERE user_id='${uId}' AND revoked_at IS NULL`);
  await q.clock.fastForward("32:00");
  let url = ""; for (let i = 0; i < 20; i++) { await sleep(500); url = new URL(q.url()).pathname + new URL(q.url()).search; if (url.startsWith("/login")) break; }
  await q.screenshot({ path: IMG + "idle-expired.png" });
  const msg = (await q.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
  await c.close();
  return `sekme kendiliğinden → ${url}; ekran: "${msg}"`;
});
await c1.storageState({ path: WORK + "/state-admin.json" });
await br.close();
