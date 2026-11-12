import { readFileSync } from "node:fs";
import { chromium, B, DIR, IMG, rec, track } from "./common.mjs";
const F = "flow3.jsonl"; const log = (k, v) => { console.log(k, JSON.stringify(v)); rec(F, { kind: "step", k, v }); };
const S = JSON.parse(readFileSync(DIR + "state.json", "utf8"));
const br = await chromium.launch();
const ctx = await br.newContext({ storageState: DIR + "user.json", viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage(); track(p, F, "flow3");
await p.goto(B + "/requests", { waitUntil: "networkidle" });
await p.getByTestId("request-customer-mode").selectOption("customer");
await p.getByRole("combobox", { name: "Müşteri ara" }).fill(S.NAME.slice(-6)); await p.waitForTimeout(1200);
const opts = p.getByRole("listbox").getByRole("option");
log("req-opts", await opts.allInnerTexts());
await opts.first().click(); await p.waitForTimeout(1500);
log("req-filter-url", new URL(p.url()).search.replace(S.id, "<id>"));
log("req-cards", await p.getByTestId("request-card").count());
await p.screenshot({ path: IMG + "f_requests_customer_filter.png", fullPage: true });
await p.getByTestId("request-customer-mode").selectOption("general"); await p.waitForTimeout(1500);
log("req-general-url", new URL(p.url()).search);
// Temizlik: test müşterileri pasife al
const list = await (await ctx.request.get(B + "/api/v1/customers?status=active&pageSize=100")).json();
const mine = list.items.filter((c) => c.name === S.NAME || /^X{100}$/.test(c.name) || c.name.includes("<script>"));
log("to-deactivate", mine.map((c) => ({ id: c.id, name: c.name.slice(0, 30) })));
for (const c of mine) {
  await p.goto(B + "/customers/" + c.id, { waitUntil: "networkidle" });
  if (c.name.includes("<script>")) log("script-name-render", { h1: await p.locator("h1").innerText(), dialogs: 0 });
  await p.getByTestId("customer-deactivate").click();
  await p.getByTestId("customer-deactivate-dialog").getByTestId("customer-action-confirm").click(); await p.waitForTimeout(1500);
  log("deactivated", { id: c.id, passive: await p.getByTestId("customer-link-passive").isVisible() });
}
await p.goto(B + "/customers?status=passive", { waitUntil: "networkidle" });
await p.screenshot({ path: IMG + "f_list_passive.png", fullPage: true });
log("passive-rows", await p.getByTestId("customer-row").count());
await p.goto(B + "/customers?status=active", { waitUntil: "networkidle" });
log("active-rows", await p.getByTestId("customer-row").count());
await br.close();
