// Kaydetmede ağ kesintisi: kullanıcıya geri bildirim var mı?
import { chromium, B, WORK, IMG } from "./common.mjs";
const br = await chromium.launch(); const ctx = await br.newContext({ storageState: WORK + "/state-admin.json", viewport: { width: 1366, height: 900 } });
const p = await ctx.newPage();
for (const [path, sel, act] of [["/settings/smtp", "smtp-from-name", "fill"], ["/settings/security", "require-2fa-switch", "click"]]) {
  await p.goto(B + path); await p.getByTestId(sel).waitFor();
  await p.route("**/api/v1/settings/tenant", (r) => r.request().method() === "PUT" ? r.abort() : r.continue());
  const before = act === "click" ? await p.getByTestId(sel).getAttribute("aria-checked") : null;
  if (act === "fill") { await p.getByTestId(sel).fill("Ag kesik"); await p.getByTestId("save-bar").getByRole("button", { name: "Kaydet" }).click(); } else await p.getByTestId(sel).click();
  await p.waitForTimeout(2000);
  const alerts = await p.locator('[role="alert"], [role="status"], [data-testid="toast"]').allInnerTexts();
  const after = act === "click" ? await p.getByTestId(sel).getAttribute("aria-checked") : null;
  await p.screenshot({ path: IMG + `abort-${path.replace(/\W+/g, "_")}.png` });
  console.log(path, JSON.stringify(alerts.filter(Boolean)).slice(0, 300), before, after);
  await p.unrouteAll();
}
await br.close();
