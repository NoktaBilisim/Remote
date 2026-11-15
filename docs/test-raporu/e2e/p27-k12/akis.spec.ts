// K12 akış denemeleri (sahte API): filtre + yenileme, çift tıklama, ağ hatası, geri tuşu, çıkış sonrası korumalı URL, XSS/uzun girdi.
import { appendFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "/Users/mennan/Projeler/Remote/apps/web/e2e/helpers.ts";

const LOG = new URL("./akis.jsonl", import.meta.url).pathname;
const note = (id: string, o: unknown) => appendFileSync(LOG, JSON.stringify({ id, proj: test.info().project.name, ...(o as object) }) + "\n");
const rows = (p: Page) => p.locator('[data-testid="un-row"], [data-testid="un-card"]').filter({ visible: true });
const B = "http://localhost:3217";

test("filtre → yenileme → URL'de kalır mı", async ({ page, context }) => {
  await context.addCookies([]);
  await signIn(context, "unm");
  await page.goto(B + "/unattended");
  await page.getByRole("searchbox", { name: "Cihaz ara" }).fill("depo");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  const afterFilter = { url: page.url(), n: await rows(page).count() };
  await page.getByRole("radio", { name: "Çevrimdışı" }).or(page.getByRole("button", { name: "Çevrimdışı" })).first().click().catch(() => null);
  await page.waitForTimeout(800);
  const afterState = { url: page.url(), n: await rows(page).count() };
  await page.reload();
  await page.waitForTimeout(800);
  const afterReload = { url: page.url(), n: await rows(page).count(), q: await page.getByRole("searchbox", { name: "Cihaz ara" }).inputValue() };
  await page.goBack();
  await page.waitForTimeout(500);
  note("filtre-yenileme", { afterFilter, afterState, afterReload, back: page.url() });
});

test("filtre sonuç yok durumu + XSS/SQL arama", async ({ page, context }) => {
  await signIn(context, "unm");
  const dialogs: string[] = [];
  page.on("dialog", (d) => (dialogs.push(d.message()), d.dismiss()));
  await page.goto(B + "/unattended");
  for (const q of ["<script>alert(1)</script>", "' OR 1=1 --", "x".repeat(300)]) {
    await page.getByRole("searchbox", { name: "Cihaz ara" }).fill(q);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    const body = (await page.locator("main").innerText()).slice(0, 400);
    const val = await page.getByRole("searchbox", { name: "Cihaz ara" }).inputValue();
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    note("arama-girdi", { q: q.slice(0, 40), valLen: val.length, n: await rows(page).count(), ov, body: body.replace(/\s+/g, " ").slice(0, 200) });
  }
  note("arama-dialog", { dialogs });
});

test("çift tıklama: Kayıt kodu oluştur → tek POST", async ({ page, context }) => {
  test.skip(test.info().project.name !== "desktop");
  await signIn(context, "unm");
  // step-up önceden
  await page.goto(B + "/unattended/codes");
  let posts = 0;
  page.on("request", (r) => r.method() === "POST" && r.url().endsWith("/unattended/registration-codes") && posts++);
  await page.getByTestId("un-create-code").click();
  const dlg = page.getByTestId("un-code-dialog");
  await dlg.getByRole("combobox", { name: "Müşteri" }).fill("Acme");
  await page.getByRole("option", { name: "Acme Ltd." }).click();
  await dlg.getByTestId("un-code-submit").dblclick();
  const su = page.getByTestId("step-up-dialog");
  await expect(su).toBeVisible();
  await su.getByTestId("step-up-code").fill("123456");
  await su.getByTestId("step-up-submit").dblclick();
  await expect(dlg.getByTestId("un-code-value")).toBeVisible();
  await page.waitForTimeout(800);
  const code = await dlg.getByTestId("un-code-value").textContent();
  // tek gösterim: kapat → yeniden aç → kod görünmez
  await dlg.getByTestId("un-code-close").click();
  await page.waitForTimeout(300);
  const reopenedShowsCode = await page.getByTestId("un-code-value").count();
  await page.reload();
  const afterReloadCode = await page.getByText("ABCD-1234-EFGH-5678").count();
  note("cift-tik-kod", { posts, code, reopenedShowsCode, afterReloadCode });
});

test("çift tıklama: Bağlan → tek connect; konsola yönlenir; geri tuşu", async ({ page, context }) => {
  test.skip(test.info().project.name !== "desktop");
  await signIn(context, "unm");
  await page.goto(B + "/unattended");
  let posts = 0;
  page.on("request", (r) => r.method() === "POST" && /\/connect$/.test(r.url()) && posts++);
  await page.getByRole("button", { name: "Bağlan: MUHASEBE-PC" }).filter({ visible: true }).dblclick();
  const su = page.getByTestId("step-up-dialog");
  await expect(su).toBeVisible();
  await su.getByTestId("step-up-code").fill("000000");
  await su.getByTestId("step-up-submit").click();
  await page.waitForTimeout(500);
  const wrongMsg = (await su.innerText()).replace(/\s+/g, " ").slice(0, 200);
  await su.getByTestId("step-up-code").fill("123456");
  await su.getByTestId("step-up-submit").dblclick();
  await page.waitForURL(/console$/, { timeout: 8000 }).catch(() => null);
  const url = page.url();
  await page.goBack();
  await page.waitForTimeout(800);
  note("cift-tik-baglan", { posts, wrongMsg, url, back: page.url() });
});

test("ağ hatası: cihaz listesi ve ayrıntı abort/500", async ({ page, context }) => {
  await signIn(context, "unm");
  await page.goto(B + "/unattended");
  await expect(rows(page).first()).toBeVisible();
  await page.route("**/api/v1/unattended/devices**", (r) => r.abort());
  await page.getByRole("searchbox", { name: "Cihaz ara" }).fill("muha");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const listErr = (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 600);
  await page.screenshot({ path: new URL(`./shots/ag-hatasi-liste-${test.info().project.name}.png`, import.meta.url).pathname, fullPage: true });
  await page.unroute("**/api/v1/unattended/devices**");
  // kodlar sekmesi: oluşturma isteği 500
  await page.route("**/api/v1/unattended/registration-codes", (r) =>
    r.request().method() === "POST" ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "Beklenmeyen hata.", requestId: "01JREQ00000000000000000000" } }) }) : r.continue(),
  );
  await page.goto(B + "/unattended/codes");
  await page.getByTestId("un-create-code").click();
  const dlg = page.getByTestId("un-code-dialog");
  await dlg.getByRole("combobox", { name: "Müşteri" }).fill("Acme");
  await page.getByRole("option", { name: "Acme Ltd." }).click();
  await dlg.getByTestId("un-code-submit").click();
  await page.waitForTimeout(1200);
  const codeErr = (await dlg.innerText()).replace(/\s+/g, " ").slice(0, 300);
  await page.screenshot({ path: new URL(`./shots/ag-hatasi-kod-${test.info().project.name}.png`, import.meta.url).pathname, fullPage: true });
  note("ag-hatasi", { listErr: listErr.slice(0, 400), codeErr });
});

test("çıkış sonrası korumalı URL → login", async ({ page, context }) => {
  await signIn(context, "unm");
  await page.goto(B + "/unattended");
  await context.clearCookies();
  for (const u of ["/unattended", "/unattended/codes", "/unattended/01JDVP2700000000000000000A", "/account", "/settings/security"]) {
    await page.goto(B + u);
    note("cikis-korumali", { u, url: page.url() });
  }
});

test("uzun/özel karakterli bildirim adresi", async ({ page, context }) => {
  await signIn(context, "unm");
  await page.goto(B + "/customers/01JCSP2700000000000000000B");
  const sec = page.getByTestId("un-contacts");
  for (let i = 0; i < 6; i++) await sec.getByTestId("un-contacts-add").click({ timeout: 1000 }).catch(() => null);
  const n = await sec.getByLabel(/E-posta \d/).count();
  const addDisabled = await sec.getByTestId("un-contacts-add").isDisabled().catch(() => "yok");
  await sec.getByLabel("E-posta 1").fill(`<script>alert(1)</script>@x.com`);
  await sec.getByLabel("E-posta 2").fill(`${"a".repeat(250)}@ornek.com`);
  await page.getByTestId("un-contacts-bar-save").click();
  await page.waitForTimeout(800);
  const txt = (await sec.innerText()).replace(/\s+/g, " ").slice(0, 600);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: new URL(`./shots/adres-gecersiz-${test.info().project.name}.png`, import.meta.url).pathname, fullPage: true });
  note("adres-gecersiz", { n, addDisabled, txt, ov });
});
