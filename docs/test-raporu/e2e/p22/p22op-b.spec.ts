// P22-T ek: yetki toggle'ı (sessions.view_chat) + yetkisiz erişim; aydınlatma metni bandı (salt gözlem).
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { api, axe, code, login, overflow, USERS } from "./lib";

const OUT = process.env.P22_OUT ?? "/tmp";
const IMG = `${OUT}/img`;
mkdirSync(IMG, { recursive: true });
const rec = (o: Record<string, unknown>) => appendFileSync(`${OUT}/akis.jsonl`, JSON.stringify({ ts: new Date().toISOString(), ...o }) + "\n");
function sql(q: string): string {
  const u = new URL(process.env.TEST_DATABASE_URL!);
  return execFileSync("docker", ["exec", "-e", `MYSQL_PWD=${decodeURIComponent(u.password)}`, "rs-p22-test", "mysql", "-N", "-uapp", "remote", "-e", q], { encoding: "utf8" }).trim();
}
async function themes(p: Page, name: string, include?: string) {
  for (const scheme of ["light", "dark"] as const) {
    await p.emulateMedia({ colorScheme: scheme });
    await p.waitForTimeout(200);
    rec({ t: "axe", name, scheme, w: p.viewportSize()?.width, violations: await axe(p, include), overflow: await overflow(p) });
    await p.screenshot({ path: `${IMG}/${name}-${p.viewportSize()?.width}-${scheme}.png` });
  }
  await p.emulateMedia({ colorScheme: "light" });
}
test.describe.configure({ mode: "serial" });
let tech: BrowserContext;
let page: Page;
test.beforeAll(async ({ browser }) => {
  tech = await browser.newContext();
  await login(tech, USERS.a1);
  page = await tech.newPage();
  page.on("pageerror", (e) => rec({ t: "pageerror-tech", e: String(e).slice(0, 200) }));
  page.on("console", (m) => m.type() === "error" && rec({ t: "console-tech", e: m.text().slice(0, 200) }));
});

test("5 yetki toggle sessions.view_chat + yetkisiz geçmiş", async ({ browser }) => {
  const sid = sql(`select s.id from support_sessions s join session_messages m on m.session_id=s.id where s.status='ENDED' group by s.id order by s.created_at desc limit 1`);
  const a2 = sql(`select id from users where email='${USERS.a2}'`);
  await page.goto(`/users/${a2}`);
  const sw = page.getByTestId("perm-sessions.view_chat").first();
  await expect(sw).toBeVisible();
  const label = await page.locator('[data-testid="perm-row-sessions"]').innerText();
  const sens = await page.getByTestId("perm-sensitive-sessions.view_chat").count();
  await themes(page, "yetki-ekrani", '[data-testid="permission-matrix"]');
  await sw.click();
  await page.getByTestId("save-bar-save").click();
  if (await page.getByTestId("step-up-dialog").isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByTestId("step-up-code").fill(await code(USERS.a1));
    await page.getByTestId("step-up-continue").click();
  }
  await page.waitForTimeout(1500);
  const permAudit = sql(`select new_value from audit_logs where entity_id='${a2}' and action like '%perm%' order by created_at desc limit 1`);
  rec({ t: "toggle", rowHasChat: /sohbet/i.test(label), sensitiveNote: sens, permAudit: permAudit.slice(0, 300) });

  const c2 = await browser.newContext();
  await login(c2, USERS.a2);
  const chat = await api(c2, "GET", `/sessions/${sid}/chat`);
  const hist = await api(c2, "GET", `/sessions/${sid}/history`);
  const p2 = await c2.newPage();
  await p2.goto(`/history/${sid}`);
  await expect(p2.getByTestId("section-timeline")).toBeVisible();
  const sec = await p2.getByTestId("section-chat").count();
  const forb = sql(`select count(*) from audit_logs where action='auth.forbidden' and user_id='${a2}'`);
  rec({ t: "unauthorized", chatStatus: chat.status, historyStatus: hist.status, historyHasChat: hist.json && "chat" in hist.json, sectionCount: sec, authForbiddenRows: forb });
  // Başka tenant oturumu → 404
  const other = sql(`select s.id from support_sessions s join tenants t on t.id=s.tenant_id where t.slug<>'demo' limit 1`);
  const o = other ? await api(tech, "GET", `/sessions/${other}/chat`) : { status: "yok" };
  rec({ t: "idor", otherTenantChat: o.status });
  await c2.close();
  // geri aç
  await page.reload();
  await page.getByTestId("perm-sessions.view_chat").first().click();
  await page.getByTestId("save-bar-save").click();
  if (await page.getByTestId("step-up-dialog").isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByTestId("step-up-code").fill(await code(USERS.a1));
    await page.getByTestId("step-up-continue").click();
  }
  expect(chat.status).toBe(403);
  expect(sec).toBe(0);
});

test("6 aydınlatma metni bandı (gözlem)", async () => {
  const r = await api(tech, "GET", "/settings/consent-text");
  rec({ t: "consent-api", status: r.status, chatParagraphMissing: r.json?.chatParagraphMissing, version: r.json?.version ?? r.json?.current?.version });
  await page.goto("/settings/consent-text");
  await page.waitForLoadState("networkidle");
  const band = await page.getByTestId("consent-chat-missing").count();
  await themes(page, "aydinlatma");
  await page.goto("/settings/general");
  await page.waitForLoadState("networkidle");
  const gband = await page.getByTestId("general-chat-missing").count();
  await themes(page, "genel-ayarlar");
  await page.setViewportSize({ width: 390, height: 844 });
  rec({ t: "consent-ui", band, gband, of390: await overflow(page) });
});
