// Diyalog kontrastı: animasyon bittikten (1,5 sn) sonra axe; açık ve koyu tema.
import { chromium, BASE, rec } from "./k9lib.mjs";
import { createRequire } from "node:module";
const AxeBuilder = createRequire("/Users/mennan/Projeler/Remote/.claude/worktrees/p21-c5b21a/apps/web/package.json")("@axe-core/playwright").default;
const DIR = process.env.K9_DIR; const A2 = process.argv[2];
const b = await chromium.launch();
for (const theme of ["LIGHT", "DARK"]) {
  const c = await b.newContext({ viewport: { width: 1280, height: 900 }, storageState: DIR + "/admin-a.json" });
  await c.addCookies([{ name: "rs_theme", value: theme, domain: "localhost", path: "/" }]);
  const p = await c.newPage(); await p.goto(BASE + "/customers/" + A2); await p.getByTestId("portal-accounts").waitFor();
  await p.getByTestId("pa-create").click(); await p.getByTestId("pa-f-name").fill("Kontrast " + theme); await p.getByTestId("pa-f-email").fill(`kontrast-${theme.toLowerCase()}@a2.invalid`);
  await p.getByTestId("pa-create-submit").click(); await p.getByTestId("temp-password").waitFor(); await p.waitForTimeout(1500);
  const a = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const v = a.violations.map((x) => `${x.id} x${x.nodes.length}: ${x.nodes.map((n) => n.target.join(" ") + " " + (n.any[0]?.message ?? "")).join(" | ").slice(0, 400)}`);
  await p.screenshot({ path: `/Users/mennan/Projeler/Remote/.claude/worktrees/p21-c5b21a/docs/test-raporu/p21/panel-gecici-sifre-diyalog-${theme.toLowerCase()}-bekle.png` });
  rec({ kind: "scan", name: "panel-gecici-sifre-diyalog-" + theme + "-bekle", axe: v, overflow: 0 }); console.log(theme, "gecici:", v);
  await p.getByTestId("pw-done").click(); await p.getByTestId("pw-close-anyway").click().catch(() => {}); await p.waitForTimeout(800);
  const row = p.getByTestId("pa-row").filter({ hasText: "Kontrast " + theme });
  await row.getByTestId("pa-menu").locator("summary").click(); await row.getByTestId("pa-deactivate").click(); await p.waitForTimeout(1500);
  const a2 = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const v2 = a2.violations.map((x) => `${x.id} x${x.nodes.length}: ${x.nodes.map((n) => n.target.join(" ") + " " + (n.any[0]?.message ?? "")).join(" | ").slice(0, 400)}`);
  rec({ kind: "scan", name: "panel-pasife-al-diyalog-" + theme + "-bekle", axe: v2, overflow: 0 }); console.log(theme, "pasif:", v2);
  await c.close();
}
await b.close();
