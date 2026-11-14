// P13a ek akışlar: USER → WhatsApp içeriği, ticket özel karakter kaydı, kirli formda istemci içi gezinme/geri.
import { chromium, B, IMG, rec, track } from "./common.mjs";
const F = "flows.jsonl";
const OTHER = "01JHXST0000000000000000004";
const br = await chromium.launch();
async function ctxFor(sc) {
  const ctx = await br.newContext({ locale: "tr-TR" });
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" };
  await ctx.addCookies([{ ...base, name: "__Host-rs_session", value: `u-${sc}-${Math.random().toString(36).slice(2)}`, httpOnly: true }, { ...base, name: "__Host-rs_csrf", value: "csrf-test-token" }]);
  const p = await ctx.newPage(); track(p, F, () => "flows2"); return { ctx, p };
}
{ const { ctx, p } = await ctxFor("aunone");
  await p.goto(B + "/admin/settings/whatsapp", { waitUntil: "networkidle" });
  console.log("USER wa:", new URL(p.url()).pathname, (await p.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 300));
  await p.screenshot({ path: IMG + "f-user-wa.png" }); await ctx.close(); }
{ const { ctx, p } = await ctxFor("hu");
  await p.goto(B + `/history/${OTHER}`, { waitUntil: "networkidle" });
  const bodies = []; p.on("request", (r) => { if (r.method() === "PATCH") bodies.push(r.postData()); });
  p.on("response", async (r) => { if (r.request().method() === "PATCH") console.log("PATCH", r.status(), (await r.text()).slice(0, 200)); });
  await p.getByTestId("ticket-input").fill("<script>alert(1)</script>");
  await p.getByTestId("note-save").click(); await p.waitForTimeout(1000);
  console.log("ticket script:", bodies, (await p.locator("#icerik").innerText()).match(/.*ticket.*|.*geçersiz.*|.*Kaydedildi.*/gi));
  await p.screenshot({ path: IMG + "f-ticket-script.png", fullPage: true });
  await p.getByTestId("ticket-input").fill("A".repeat(300));
  console.log("ticket 300 uzunluk alanda:", (await p.getByTestId("ticket-input").inputValue()).length);
  await ctx.close(); }
{ const { ctx, p } = await ctxFor("acc");
  await p.goto(B + "/settings/security", { waitUntil: "networkidle" });
  await p.getByTestId("retention-form").and(p.locator('[data-ready="true"]')).waitFor();
  await p.getByTestId("retention-days").fill("300");
  let dlg = null; p.on("dialog", async (d) => { dlg = d.message() || d.type(); await d.dismiss(); });
  await p.getByRole("navigation", { name: "Ana menü" }).getByRole("link").first().click().catch((e) => console.log(e.message));
  await p.waitForTimeout(1000);
  console.log("kirli form + menü linki: dialog=", dlg, "url=", p.url(), "alan=", await p.getByTestId("retention-days").inputValue().catch(() => "yok"));
  await ctx.close(); }
await br.close();
