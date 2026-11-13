// P12b ek akışlar: /admin/settings yönlendirmesi, kirli formdan ayrılma diyaloğu, büyük harf şema, 201 karakter, audit detayları.
import { chromium, B, IMG, rec, track } from "./common.mjs";
const F = "flows.jsonl";
const WA = "/admin/settings/whatsapp";
const br = await chromium.launch();
let cur = "";
const check = (flow, ok, note = "") => { rec(F, { kind: "check", flow, ok: !!ok, note }); console.log(ok ? "OK  " : "FAIL", flow, note); };
async function ctxFor(sc, opts = {}) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, locale: "tr-TR", ...opts });
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" };
  await ctx.addCookies([{ ...base, name: "__Host-rs_session", value: `u-${sc}-${Math.random().toString(36).slice(2)}`, httpOnly: true }, { ...base, name: "__Host-rs_csrf", value: "csrf-test-token" }]);
  const p = await ctx.newPage(); track(p, F, () => cur); return { ctx, p };
}
const T = (p, id) => p.getByTestId(id);
{ cur = "f2"; const { ctx, p } = await ctxFor("ausa");
  await p.goto(B + "/admin/settings"); await p.waitForURL("**/admin/settings/mysql", { timeout: 5000 }).catch(() => {});
  check("/admin/settings → /admin/settings/mysql (istemci yönlendirmesi)", p.url().endsWith("/mysql"), p.url());
  await p.goto(B + WA); await p.waitForSelector('[data-testid="wa-svc-form"][data-ready="true"]');
  const url = T(p, "wa-svc-url");
  for (const v of ["HTTPS://WA.ORNEK.COM", "https://" + "a".repeat(189) + ".com", "http://[::1]:3000", "https://wa.örnek.com", "https://wa.ornek.com:99999"]) {
    await url.fill(v); await T(p, "save-bar-save").click(); await p.waitForTimeout(500);
    const inv = await url.getAttribute("aria-invalid");
    const desc = await url.evaluate((el) => (el.getAttribute("aria-describedby") || "").split(" ").map((id) => document.getElementById(id)?.textContent).join(" | "));
    const eff = await T(p, "wa-svc-effective").textContent();
    rec(F, { kind: "input2", value: v.slice(0, 40), len: v.length, invalid: inv, desc, eff }); console.log("girdi", v.slice(0, 30), v.length, "invalid", inv, "::", desc.slice(0, 160), "etkin", eff);
  }
  await url.fill("HTTPS://WA.ORNEK.COM"); await T(p, "save-bar-save").click(); await p.waitForTimeout(300);
  await p.screenshot({ path: IMG + "f-buyuk-harf-sema.png" });
  // kirli formdan ayrılma
  await url.fill("https://kirli.ornek.com");
  await T(p, "system-tabs").getByRole("link", { name: "TURN" }).click(); await p.waitForTimeout(500);
  const leave = p.locator("dialog[open]");
  const txt = (await leave.count()) ? await leave.innerText() : "";
  check("kirli formdan sekme geçişi → ayrılma diyaloğu", txt.length > 0, txt.replace(/\s+/g, " ").slice(0, 160));
  await p.screenshot({ path: IMG + "f-leave-dialog.png" });
  const stay = leave.getByRole("button", { name: /Sayfada kal/ });
  if (await stay.count()) { await stay.click(); await p.waitForTimeout(300); check("Sayfada kal → değer korunur", (await url.inputValue()) === "https://kirli.ornek.com"); }
  await ctx.close(); }
{ cur = "audit"; const { ctx, p } = await ctxFor("ausa");
  const mk = (id, action, nv, ov = null, result = "success") => ({ id, createdAt: new Date().toISOString(), tenantId: null, tenantName: null, userId: "01JAV00000000000000000000A", username: "derya@ornek.com", userFullName: "Derya Kaya", avatarUrl: null, action, entity: "system_settings", entityId: "whatsapp", oldValue: ov, newValue: nv, ipAddress: "203.0.113.7", userAgent: "Chrome", result });
  const items = [mk("9003", "settings.whatsapp.test", { phone: "+90532*****00", result: "fail", reason: "unreachable" }, null, "fail"), mk("9002", "settings.whatsapp.deleted", null, { url: "https://wa.ornek.com" }), mk("9001", "settings.whatsapp.updated", { url: "https://wa.ornek.com" }, { url: "http://10.20.0.5:3000" })];
  await p.route(/\/api\/v1\/audit(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, nextCursor: null }) }));
  await p.goto(B + "/audit"); await p.waitForTimeout(1000);
  await p.screenshot({ path: IMG + "f-audit-labels.png", fullPage: true });
  const opens = T(p, "audit-detail-open");
  for (let i = 0; i < 3; i++) {
    await opens.nth(i).click(); await p.waitForTimeout(400);
    const d = T(p, "audit-detail"); const txt = await d.innerText();
    rec(F, { kind: "auditdetail", i, txt: txt.slice(0, 700) }); console.log("DETAY", i, "::", txt.replace(/\s+/g, " ").slice(0, 450));
    await p.screenshot({ path: IMG + `f-audit-detail-${i}.png` });
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  }
  await ctx.close(); }
await br.close();
