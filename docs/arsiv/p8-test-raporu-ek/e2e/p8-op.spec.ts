import AxeBuilder from "@axe-core/playwright";
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// test-operatoru P8 sayfa testi (geçici; koşarken apps/web/e2e/ altına kopyalanır, kaynak docs/test-raporu/e2e/).
// Yığın: sahte API (e2e/mock-api.mjs, :4217) + standalone web (:3217, NEXT_PUBLIC_RS_E2E=1) önceden ayakta.
// Ölçüm odaklı: expect.soft + JSONL (P8OP_OUT), ekranlar P8OP_IMG.
const OUT = process.env.P8OP_OUT ?? "p8op.jsonl";
const IMG = process.env.P8OP_IMG ?? "p8img";
mkdirSync(IMG, { recursive: true });
const RICH = "01JHXST0000000000000000000";
const BROWSER = "01JHXSTBRWSR00000000000002";
const rec = (o: Record<string, unknown>) => appendFileSync(OUT, JSON.stringify({ test: test.info().title, ...o }) + "\n");
const rows = (p: Page) => p.locator('[data-testid="history-row"], [data-testid="history-card"]').filter({ visible: true });

function track(p: Page) {
  p.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") rec({ kind: "console", type: m.type(), text: m.text().slice(0, 300), url: p.url() });
  });
  p.on("pageerror", (e) => rec({ kind: "pageerror", text: e.message.slice(0, 300), url: p.url() }));
  p.on("response", (r) => {
    if (r.status() >= 400) rec({ kind: "http", status: r.status(), url: r.url().replace(/[?#].*/, "") });
  });
}
async function settle(p: Page) {
  await p.mouse.move(0, 0);
  await p.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
async function axe(p: Page, label: string) {
  await settle(p);
  const r = await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).setLegacyMode(true).analyze();
  const v = r.violations.map((x) => `${x.id}(${x.impact}): ${x.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  rec({ kind: "axe", label, violations: v });
  return v;
}
async function overflow(p: Page, label: string) {
  const o = await p.evaluate(() => {
    const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    // geniş tablo kabı (kendi kaydırması) ve kesilen öğeler
    const tbl = document.querySelector('[data-testid="history-table"]');
    const wrap = tbl?.parentElement;
    return { doc, tableScroll: wrap ? wrap.scrollWidth - wrap.clientWidth : null, tableW: tbl ? Math.round(tbl.getBoundingClientRect().width) : null };
  });
  rec({ kind: "overflow", label, ...o });
  return o.doc;
}
const shot = (p: Page, name: string, full = true) => p.screenshot({ path: `${IMG}/${name}.png`, fullPage: full });

const VIEWS = [
  { w: 1280, h: 800, s: "light" },
  { w: 1280, h: 800, s: "dark" },
  { w: 1440, h: 900, s: "light" },
  { w: 1440, h: 900, s: "dark" },
  { w: 390, h: 844, s: "light" },
  { w: 390, h: 844, s: "dark" },
] as const;

const PAGES: Array<{ name: string; who: string; url: string; ready: string }> = [
  { name: "liste-user", who: "hu", url: "/history", ready: "history-count" },
  { name: "liste-admin", who: "hadm", url: "/history", ready: "history-count" },
  { name: "liste-superadmin-100", who: "hsa", url: "/history?pageSize=100", ready: "history-count" },
  { name: "detay-zengin", who: "hadm", url: `/history/${RICH}`, ready: "timeline" },
  { name: "detay-tarayici", who: "hu", url: `/history/${BROWSER}`, ready: "control-browser" },
  { name: "detay-salt-okunur", who: "hro", url: `/history/${RICH}`, ready: "note-readonly" },
  { name: "bos", who: "hempty", url: "/history", ready: "history-empty" },
  { name: "filtre-bos", who: "hu", url: "/history?customer=yokboyle", ready: "history-empty-filter" },
  { name: "sayfa-disi", who: "hu", url: "/history?page=9", ready: "history-beyond" },
  { name: "hata", who: "hbroken", url: "/history", ready: "load-error" },
  { name: "gecersiz-url", who: "hu", url: "/history?status=BOGUS&from=2026-02-30&pageSize=500&mode=X", ready: "filters-ignored" },
  { name: "yetkisiz", who: "seed", url: "/history", ready: "history-forbidden" },
  { name: "bulunamadi", who: "hu", url: "/history/01JHXST0000000000000000001", ready: "history-not-found" },
  { name: "bulunamadi-bicim", who: "hu", url: "/history/abc", ready: "" },
  { name: "panel", who: "seed", url: "/", ready: "" },
  { name: "oturumlar", who: "seed", url: "/sessions", ready: "" },
];

for (const pg of PAGES) {
  test(`tarama: ${pg.name}`, async ({ page, context }) => {
    track(page);
    await signIn(context, pg.who);
    for (const v of VIEWS) {
      await page.setViewportSize({ width: v.w, height: v.h });
      await page.emulateMedia({ colorScheme: v.s });
      const t0 = Date.now();
      const res = await page.goto(pg.url);
      if (pg.ready) await expect.soft(page.getByTestId(pg.ready).filter({ visible: true }).first()).toBeVisible();
      else await page.waitForLoadState("networkidle");
      const ms = Date.now() - t0;
      rec({ kind: "load", label: `${pg.name}-${v.w}-${v.s}`, status: res?.status(), ms, title: await page.title() });
      const label = `${pg.name}-${v.w}-${v.s}`;
      expect.soft(await overflow(page, label), label).toBeLessThanOrEqual(0);
      expect.soft(await axe(page, label), label).toEqual([]);
      await shot(page, label);
    }
    // kırık link: sayfadaki aynı köken bağlantılar
    const hrefs = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href).filter((h) => h.startsWith(location.origin)))]);
    for (const h of hrefs) {
      const r = await page.request.get(h, { maxRedirects: 0 });
      rec({ kind: "link", from: pg.name, href: h.replace(/^https?:\/\/[^/]+/, ""), status: r.status() });
      expect.soft(r.status(), h).toBeLessThan(400);
    }
  });
}

test("390 px kenar menüsü: yatay kaydırma, 'Oturum geçmişi' erişilebilir, aktif", async ({ page, context }) => {
  track(page);
  await signIn(context, "hadm");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/history");
  const nav = page.getByRole("navigation", { name: "Ana menü" });
  const ul = nav.locator("ul").first();
  const m = await ul.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }));
  rec({ kind: "nav390", ...m });
  const link = nav.getByRole("link", { name: "Oturum geçmişi" });
  await link.scrollIntoViewIfNeeded();
  await expect.soft(link).toBeInViewport();
  await expect.soft(link).toHaveAttribute("aria-current", "page");
  await shot(page, "nav-390-history", false);
  await page.goto("/sessions");
  await shot(page, "nav-390-sessions", false);
  const vis = await nav.getByRole("link", { name: "Oturum geçmişi" }).evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), vw: innerWidth };
  });
  rec({ kind: "nav390-sessions-link", ...vis });
});

test("klavye: filtre formu Tab sırası + Enter ile uygula; sayfalama; detayda form Tab + kaydet", async ({ page, context }) => {
  track(page);
  await signIn(context, "hadm");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/history");
  await page.getByTestId("history-filters").getByLabel("Başlangıç tarihi").focus();
  const order: string[] = [];
  for (let i = 0; i < 12; i++) {
    order.push(await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e) return "-";
      const lbl = e.id ? document.querySelector(`label[for="${e.id}"]`)?.textContent : null;
      return `${e.tagName.toLowerCase()}:${(lbl ?? e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)}`;
    }));
    await page.keyboard.press("Tab");
  }
  rec({ kind: "taborder-filters", order });
  // odak görünür mü (outline/ring)
  const ring = await page.evaluate(() => {
    const e = document.activeElement as HTMLElement;
    const cs = getComputedStyle(e);
    return { tag: e.tagName, outline: cs.outlineStyle + " " + cs.outlineWidth, shadow: cs.boxShadow.slice(0, 60) };
  });
  rec({ kind: "focus-visible", ...ring });
  await page.getByTestId("history-filters").getByLabel("Müşteri adı").focus();
  await page.keyboard.type("ayşe");
  await page.keyboard.press("Enter");
  await expect.soft(page).toHaveURL(/customer=ay%C5%9Fe/);
  await shot(page, "klavye-filtre-enter", false);

  await page.goto(`/history/${RICH}`);
  await page.getByTestId("ticket-input").focus();
  await page.keyboard.type("KLV-1");
  await page.keyboard.press("Tab");
  const afterTicket = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  await page.keyboard.type("klavye notu");
  const fo: string[] = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    fo.push(await page.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.textContent?.trim().slice(0, 20)}`));
  }
  rec({ kind: "taborder-note", afterTicket, fo });
  const save = page.getByTestId("note-save");
  await save.focus();
  await page.keyboard.press("Enter");
  await expect.soft(page.getByTestId("toast")).toContainText("kaydedildi");
  await shot(page, "klavye-not-kaydet-toast", false);
});

test("not formu: çift tıklama → tek PATCH; özel karakter/XSS metin olarak; 4000 sınır; ağ hatası", async ({ page, context }) => {
  track(page);
  await signIn(context, "hu");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/history/${RICH}`);
  let patches = 0;
  page.on("request", (r) => {
    if (r.method() === "PATCH") patches++;
  });
  await page.getByTestId("ticket-input").fill("<script>alert(1)</script>");
  await page.getByTestId("note-input").fill("' OR 1=1 -- <img src=x onerror=alert(2)> çğıöşü İ");
  await page.getByTestId("note-save").dblclick();
  await expect.soft(page.getByTestId("toast")).toContainText("kaydedildi");
  await page.waitForTimeout(500);
  rec({ kind: "dblclick-patch", count: patches });
  expect.soft(patches).toBe(1);
  let dialogs = 0;
  page.on("dialog", (d) => {
    dialogs++;
    void d.dismiss();
  });
  await page.reload();
  await expect.soft(page.getByTestId("ticket-input")).toHaveValue("<script>alert(1)</script>");
  await page.goto("/history");
  await expect.soft(rows(page).filter({ hasText: "<script>alert(1)</script>" })).toHaveCount(1);
  rec({ kind: "xss-dialogs", count: dialogs });
  await shot(page, "xss-liste", false);

  // 4000 tam sınır kabul
  await page.goto(`/history/${RICH}`);
  await page.getByTestId("note-input").fill("ş".repeat(4000));
  await expect.soft(page.getByTestId("note-count")).toHaveText("4.000 / 4.000");
  await page.getByTestId("note-save").click();
  await expect.soft(page.getByTestId("toast")).toContainText("kaydedildi");
  // yalnız boşluk → null'a mı iner?
  await page.getByTestId("ticket-input").fill("   ");
  await page.getByTestId("note-save").click();
  await page.waitForTimeout(800);
  rec({ kind: "whitespace-ticket", text: (await page.getByTestId("note-form").innerText()).slice(0, 300) });
  await shot(page, "bosluk-ticket", false);

  // ağ hatası
  await page.goto(`/history/${RICH}`);
  await page.route("**/api/v1/sessions/*", (r) => (r.request().method() === "PATCH" ? r.abort() : r.continue()));
  await page.getByTestId("ticket-input").fill("NET-ERR");
  await page.getByTestId("note-save").click();
  await page.waitForTimeout(1000);
  const ftxt = await page.getByTestId("note-form").innerText();
  rec({ kind: "patch-abort", text: ftxt.slice(0, 400), saveDisabled: await page.getByTestId("note-save").isDisabled() });
  await shot(page, "not-ag-hatasi", false);
  await page.unroute("**/api/v1/sessions/*");
  await page.route("**/api/v1/sessions/*", (r) =>
    r.request().method() === "PATCH" ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "x", requestId: "01JREQ00000000000000000000" } }) }) : r.continue(),
  );
  await page.getByTestId("note-save").click();
  await page.waitForTimeout(800);
  rec({ kind: "patch-500", text: (await page.getByTestId("note-form").innerText()).slice(0, 400) });
  await shot(page, "not-500", false);
});

test("ayrılma uyarısı: yenileme (beforeunload), geri tuşu, menü bağlantısı", async ({ page, context }) => {
  track(page);
  await signIn(context, "hu");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/history");
  await page.goto(`/history/${RICH}`);
  await page.getByTestId("note-input").fill("kaydedilmemiş");
  const seen: string[] = [];
  page.on("dialog", (d) => {
    seen.push(d.type());
    void d.dismiss();
  });
  await page.reload({ timeout: 3000 }).catch(() => {});
  rec({ kind: "beforeunload-reload", dialogs: seen.slice(), value: await page.getByTestId("note-input").inputValue().catch(() => "?") });
  // menü bağlantısı
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Oturumlar" }).click();
  const dlg = await page.getByTestId("leave-dialog").isVisible();
  rec({ kind: "leave-menu", dialog: dlg });
  if (dlg) {
    await shot(page, "ayrilma-diyalog-1280", false);
    await page.getByTestId("leave-dialog").getByRole("button", { name: "Sayfada kal" }).click();
  }
  // geri tuşu (popstate) — uygulama içi gezinme
  await page.goBack({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);
  rec({ kind: "leave-back", url: page.url(), dialogs: seen.slice(), leaveDialog: await page.getByTestId("leave-dialog").isVisible().catch(() => false) });
  await shot(page, "geri-tusu-sonrasi", false);
});

test("liste: geri tuşu filtre durumu; sayfa boyutu 50/100; dışa aktar ağ hatası; çift tıklama", async ({ page, context }) => {
  track(page);
  await signIn(context, "hsa");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/history");
  const f = page.getByTestId("history-filters");
  await f.getByLabel("Durum").selectOption("ENDED");
  await f.getByTestId("filter-apply").click();
  await expect.soft(page).toHaveURL(/status=ENDED/);
  await page.getByRole("link", { name: /^Ayrıntı:/ }).first().click();
  await expect.soft(page).toHaveURL(/\/history\/[0-9A-Z]{26}/);
  await page.goBack();
  await expect.soft(page).toHaveURL(/status=ENDED/);
  await expect.soft(f.getByLabel("Durum")).toHaveValue("ENDED");
  rec({ kind: "back-filter", url: page.url(), value: await f.getByLabel("Durum").inputValue() });
  for (const n of ["50", "100"]) {
    await page.goto("/history");
    await page.getByTestId("page-size").selectOption(n);
    await expect.soft(page).toHaveURL(new RegExp(`pageSize=${n}`));
    rec({ kind: "pagesize", n, rows: await rows(page).count(), count: await page.getByTestId("history-count").innerText() });
  }
  await overflow(page, "sa-100-1280");
  await shot(page, "liste-superadmin-100-1280-tam");
  // dışa aktar ağ hatası + çift tıklama
  await page.goto("/history");
  let exports = 0;
  page.on("request", (r) => {
    if (r.url().includes("export.csv")) exports++;
  });
  await page.route("**/export.csv*", (r) => r.abort());
  await page.getByTestId("export-csv").click();
  await page.waitForTimeout(800);
  rec({ kind: "export-abort", text: await page.getByTestId("export-error").innerText().catch(() => "(export-error yok)") });
  await shot(page, "disa-aktar-ag-hatasi", false);
  await page.unroute("**/export.csv*");
  exports = 0;
  const dls: string[] = [];
  page.on("download", (d) => dls.push(d.suggestedFilename()));
  await page.getByTestId("export-csv").dblclick();
  await page.waitForTimeout(1500);
  rec({ kind: "export-dblclick", requests: exports, downloads: dls });
  // dar ekranda dışa aktar + sayfalama
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/history");
  await page.getByTestId("history-cards").scrollIntoViewIfNeeded();
  await shot(page, "liste-390-kartlar-viewport", false);
});

test("filtre doğrulama hataları ve yalnız-görüntüleme ekranları (görsel)", async ({ page, context }) => {
  track(page);
  await signIn(context, "hu");
  for (const v of [{ w: 1280, h: 800 }, { w: 390, h: 844 }]) {
    await page.setViewportSize({ width: v.w, height: v.h });
    await page.goto("/history");
    const f = page.getByTestId("history-filters");
    if (v.w === 390) {
      // dar ekranda filtreler bir açılır alanda olabilir
      const t = page.getByRole("button", { name: /Filtre/ });
      if (await t.count()) await t.first().click().catch(() => {});
    }
    await f.getByLabel("Başlangıç tarihi").fill("2026-11-10");
    await f.getByLabel("Bitiş tarihi").fill("2026-11-01");
    await f.getByLabel("Müşteri adı").fill("a");
    await f.getByTestId("filter-apply").click();
    await expect.soft(f).toContainText("Bitiş tarihi başlangıçtan önce olamaz");
    expect.soft(await axe(page, `filtre-hata-${v.w}`)).toEqual([]);
    await shot(page, `filtre-hata-${v.w}`, false);
    await page.goto(`/history/${RICH}`);
    await page.getByTestId("note-input").fill("x".repeat(4001));
    await page.getByTestId("ticket-input").fill("T".repeat(51));
    await page.getByTestId("note-save").click();
    expect.soft(await axe(page, `not-hata-${v.w}`)).toEqual([]);
    await shot(page, `not-hata-${v.w}`, true);
    await page.getByTestId("ticket-input").fill("");
    await page.getByTestId("note-input").fill("");
  }
});
