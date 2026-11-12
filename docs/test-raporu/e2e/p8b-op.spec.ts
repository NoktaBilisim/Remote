import AxeBuilder from "@axe-core/playwright";
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";

// test-operatoru P8b-1 sayfa testi (geçici; koşarken apps/web/e2e/ altına kopyalanır, kaynak docs/test-raporu/e2e/).
// Yığın: sahte API (e2e/mock-api.mjs, :4217) + standalone web (:3217, NEXT_PUBLIC_RS_E2E=1) önceden ayakta.
// Ölçüm odaklı: expect.soft + JSONL (P8BOP_OUT), ekranlar P8BOP_IMG.
const OUT = process.env.P8BOP_OUT ?? "p8bop.jsonl";
const IMG = process.env.P8BOP_IMG ?? "p8bimg";
mkdirSync(IMG, { recursive: true });
const MOCK = "http://127.0.0.1:4217";
const rec = (o: Record<string, unknown>) => appendFileSync(OUT, JSON.stringify({ test: test.info().title, ...o }) + "\n");
const cards = (p: Page) => p.getByTestId("request-card");
const card = (p: Page, name: string) => cards(p).filter({ has: p.getByRole("heading", { name }) });

async function login(context: BrowserContext, scenario: string): Promise<string> {
  const value = `u-${scenario}-${Math.random().toString(36).slice(2)}`;
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
  await context.addCookies([
    { ...base, name: SESSION_COOKIE, value, httpOnly: true },
    { ...base, name: CSRF_COOKIE, value: "csrf-test-token" },
  ]);
  return value;
}
const openSockets = async (p: Page, c: string) => ((await (await p.request.get(`${MOCK}/__e2e/rq/sockets/${c}`)).json()) as { open: number }).open;
const hook = (p: Page, ev: string, c: string, id?: string) => p.request.get(`${MOCK}/__e2e/rq/${ev}/${c}${id ? `?id=${id}` : ""}`);

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
async function axe(p: Page, label: string, include?: string) {
  await settle(p);
  let b = new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).setLegacyMode(true);
  if (include) b = b.include(include);
  const r = await b.analyze();
  const v = r.violations.map((x) => `${x.id}(${x.impact}): ${x.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(", ")}`);
  rec({ kind: "axe", label, violations: v });
  return v;
}
async function overflow(p: Page, label: string) {
  const o = await p.evaluate(() => {
    const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    // kart/kap içi taşmalar (scrollWidth > clientWidth, overflow görünür olanlar)
    const inner = Array.from(document.querySelectorAll("main *"))
      .filter((el) => {
        const cs = getComputedStyle(el);
        return el.scrollWidth - el.clientWidth > 1 && cs.overflowX === "visible" && el.clientWidth > 0;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}[${(el as HTMLElement).dataset.testid ?? el.className.toString().slice(0, 40)}] +${el.scrollWidth - el.clientWidth}`);
    return { doc, inner };
  });
  rec({ kind: "overflow", label, ...o });
  return o.doc;
}
const shot = (p: Page, name: string, full = true) => p.screenshot({ path: `${IMG}/${name}.png`, fullPage: full });
const errorsOf = (p: Page) =>
  p.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-invalid="true"]')).map((el) => {
      const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
      const msg = ids.map((i) => document.getElementById(i)?.textContent?.trim()).filter(Boolean).join(" | ");
      return `${el.getAttribute("aria-label") ?? (el as HTMLInputElement).name ?? el.id}: ${msg}`;
    }),
  );
const lastToast = async (p: Page) => (await p.getByTestId("toast").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());

const VIEWS = [
  { w: 1280, h: 800, s: "light" },
  { w: 1280, h: 800, s: "dark" },
  { w: 1440, h: 900, s: "light" },
  { w: 1440, h: 900, s: "dark" },
  { w: 390, h: 844, s: "light" },
  { w: 390, h: 844, s: "dark" },
] as const;

const PAGES: Array<{ name: string; who: string | null; url: string; ready: string }> = [
  { name: "talepler", who: "rqadm", url: "/requests", ready: "request-card" },
  { name: "talepler-gecmis", who: "rqadm", url: "/requests?tab=history", ready: "request-card" },
  { name: "talepler-gecmis-reddedildi", who: "rqadm", url: "/requests?tab=history&status=REJECTED", ready: "request-reject-message" },
  { name: "talepler-bos", who: "rqempty", url: "/requests", ready: "requests-empty" },
  { name: "talepler-gecmis-bos", who: "rqempty", url: "/requests?tab=history", ready: "" },
  { name: "talepler-hata", who: "rqbroken", url: "/requests", ready: "load-error" },
  { name: "talepler-superadmin", who: "rqsa", url: "/requests", ready: "requests-pick-tenant" },
  { name: "talepler-salt-okunur", who: "rqro", url: "/requests", ready: "request-card" },
  { name: "talepler-yetkisiz", who: "seed", url: "/requests", ready: "" },
  { name: "ayarlar", who: "rqadm", url: "/settings/support-requests", ready: "settings-form" },
  { name: "ayarlar-yetkisiz", who: "rqro", url: "/settings/support-requests", ready: "" },
  { name: "ayarlar-superadmin", who: "rqsa", url: "/settings/support-requests", ready: "" },
  { name: "gecmis-kaynak-talep", who: "hu", url: "/history?source=REQUEST", ready: "history-count" },
  { name: "gecmis-talep-detay", who: "hu", url: "/history/01JHXST0000000000000000020", ready: "section-request" },
  { name: "gecmis-liste", who: "hadm", url: "/history", ready: "history-count" },
  { name: "panel", who: "seed", url: "/", ready: "" },
  { name: "oturumlar", who: "seed", url: "/sessions", ready: "" },
  { name: "misafir", who: null, url: `/session/${"A".repeat(43)}`, ready: "" },
];

for (const pg of PAGES) {
  test(`tarama: ${pg.name}`, async ({ page, context }) => {
    track(page);
    if (pg.who) await login(context, pg.who);
    for (const v of VIEWS) {
      await page.setViewportSize({ width: v.w, height: v.h });
      await page.emulateMedia({ colorScheme: v.s });
      const t0 = Date.now();
      const res = await page.goto(pg.url);
      if (pg.ready) await expect.soft(page.getByTestId(pg.ready).filter({ visible: true }).first()).toBeVisible();
      else await page.waitForLoadState("networkidle");
      const ms = Date.now() - t0;
      const label = `${pg.name}-${v.w}-${v.s}`;
      rec({ kind: "load", label, status: res?.status(), ms, title: await page.title(), url: page.url().replace(/^https?:\/\/[^/]+/, "") });
      expect.soft(await overflow(page, label), label).toBeLessThanOrEqual(0);
      expect.soft(await axe(page, label), label).toEqual([]);
      await shot(page, label);
    }
    const hrefs = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href).filter((h) => h.startsWith(location.origin)))]);
    for (const h of hrefs) {
      const r = await page.request.get(h, { maxRedirects: 0 });
      rec({ kind: "link", from: pg.name, href: h.replace(/^https?:\/\/[^/]+/, ""), status: r.status() });
      expect.soft(r.status(), h).toBeLessThan(400);
    }
  });
}

test("kabul: hata durumları (QUEUE_FULL, CLIENT_OUTDATED, 503, OPEN_SESSION_LIMIT, REQUEST_CLOSED, ağ) + çift tıklama", async ({ page, context }) => {
  track(page);
  await login(context, "rqadm");
  await page.setViewportSize({ width: 1280, height: 800 });
  const cases: Array<[string, number, string | null]> = [
    ["QUEUE_FULL", 409, "Kuyruk dolu."],
    ["CLIENT_OUTDATED", 426, "İstemci eski."],
    ["UNAVAILABLE", 503, "Hizmet geçici olarak kullanılamıyor."],
    ["OPEN_SESSION_LIMIT", 409, "Açık oturum sınırına ulaştınız (3)."],
    ["REQUEST_CLOSED", 409, "Talep kapandı."],
    ["ABORT", 0, null],
  ];
  for (const [code, status, msg] of cases) {
    await page.unrouteAll();
    await page.route("**/api/v1/support-requests/*/accept", (r) =>
      status === 0 ? r.abort("failed") : r.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code, message: msg, requestId: "01JREQ00000000000000000000" } }) }),
    );
    await page.goto("/requests");
    await card(page, "Ayşe Yılmaz").getByRole("button", { name: "Kabul et: Ayşe Yılmaz" }).click();
    await page.getByTestId("toast").first().waitFor({ timeout: 5000 }).catch(() => {});
    const btn = card(page, "Ayşe Yılmaz").getByRole("button", { name: "Kabul et: Ayşe Yılmaz" });
    rec({ kind: "accept-error", code, status, toasts: await lastToast(page), cardStays: (await card(page, "Ayşe Yılmaz").count()) === 1, btnEnabled: (await btn.count()) ? await btn.isEnabled() : null, url: page.url() });
    await shot(page, `kabul-hata-${code}`, false);
  }
  await page.unrouteAll();
  // çift tıklama: yanıt geciktirilir
  let n = 0;
  await page.route("**/api/v1/support-requests/*/accept", async (r) => {
    n++;
    await new Promise((res) => setTimeout(res, 800));
    await r.continue();
  });
  await page.goto("/requests");
  const b = card(page, "Can Öz").getByRole("button", { name: "Kabul et: Can Öz" });
  await b.dblclick();
  await b.click({ timeout: 500 }).catch(() => {});
  await page.waitForURL(/console/, { timeout: 8000 }).catch(() => {});
  rec({ kind: "accept-dblclick", requests: n, url: page.url() });
  expect.soft(n).toBe(1);
  // geri tuşu → kuyruk, kabul edilen kart yok
  await page.goBack();
  await page.waitForLoadState("networkidle");
  rec({ kind: "accept-back", url: page.url(), cards: await cards(page).allInnerTexts().then((a) => a.map((x) => x.split("\n")[0])), canStillSee: await card(page, "Can Öz").count() });
});

test("ret diyaloğu: 'Diğer' doğrulama girdileri, Escape/odak dönüşü, 503, çift tıklama", async ({ page, context }) => {
  track(page);
  await login(context, "rqadm");
  await page.setViewportSize({ width: 1280, height: 800 });
  let n = 0;
  await page.route("**/api/v1/support-requests/*/reject", async (r) => {
    n++;
    await r.continue();
  });
  await page.goto("/requests");
  const open = card(page, "Can Öz").getByRole("button", { name: "Reddet: Can Öz" });
  await open.click();
  const dlg = page.getByTestId("reject-dialog");
  const radios = await dlg.getByRole("radio").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).labels?.[0]?.textContent?.trim()));
  rec({ kind: "reject-presets", radios });
  await shot(page, "ret-diyalog-1280", false);
  await page.keyboard.press("Escape");
  await expect.soft(dlg).toBeHidden();
  rec({ kind: "reject-esc-focus", focused: await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent) });
  await open.click();
  await dlg.getByRole("radio", { name: "Diğer (kendi mesajım)" }).check();
  const msg = dlg.getByLabel("Mesaj", { exact: true });
  const inputs = ["", "abcd", "x".repeat(201), "Lütfen www.ornek.com adresine bakın", "Bize yaz: destek@ornek.com", "Bizi +90 532 111 22 33 arayın", "http://kotu.example/x tıklayın", "<script>alert(1)</script> şimdi değil", "' OR 1=1 -- yarın arayacağız", "İki\nsatır mesaj burada", "   kısa   "];
  for (const v of inputs) {
    const before = n;
    await msg.fill(v);
    await dlg.getByRole("button", { name: "Reddet" }).click();
    await page.waitForTimeout(400);
    const vis = await dlg.isVisible();
    rec({ kind: "reject-input", input: v.slice(0, 60), len: v.length, value: vis ? (await msg.inputValue()).slice(0, 60) : "KAPANDI", sent: n - before, invalid: vis ? await msg.getAttribute("aria-invalid") : null, dialogText: vis ? (await dlg.innerText()).split("\n").filter((l) => /içer|karakter|en az|en çok|tek satır|gerekli|boş/i.test(l)).join(" | ") : "KAPANDI" });
    if (!(await dlg.isVisible())) {
      await page.goto("/requests");
      await card(page, "Ayşe Yılmaz").getByRole("button", { name: "Reddet: Ayşe Yılmaz" }).click();
      await dlg.getByRole("radio", { name: "Diğer (kendi mesajım)" }).check();
    }
  }
  await shot(page, "ret-diyalog-hata-1280", false);
  // 503: mesaj diyalogda, diyalog açık kalır
  await page.unrouteAll();
  await page.route("**/api/v1/support-requests/*/reject", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Hizmet geçici olarak kullanılamıyor.", requestId: "01JREQ00000000000000000000" } }) }));
  await msg.fill("Yarın sabah dönüş yapacağız");
  await dlg.getByRole("button", { name: "Reddet" }).click();
  await page.waitForTimeout(500);
  rec({ kind: "reject-503", open: await dlg.isVisible(), text: (await dlg.innerText()).replace(/\s+/g, " ").slice(0, 400) });
  await shot(page, "ret-diyalog-503", false);
  // çift tıklama
  await page.unrouteAll();
  let m = 0;
  await page.route("**/api/v1/support-requests/*/reject", async (r) => {
    m++;
    await new Promise((res) => setTimeout(res, 700));
    await r.continue();
  });
  await dlg.getByRole("button", { name: "Reddet" }).dblclick();
  await page.waitForTimeout(1200);
  rec({ kind: "reject-dblclick", requests: m });
  expect.soft(m).toBe(1);
});

test("AC-149: request.new → toast gecikmesi (25 örnek), sekme başlığı, Görüntüle, ses, 4401 yeniden bağlanma", async ({ page, context }) => {
  track(page);
  const c = await login(context, "rqadm");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    (window as unknown as { __tt: number[] }).__tt = [];
    const obs = new MutationObserver((ms) => {
      for (const m of ms)
        for (const nd of m.addedNodes) {
          if (!(nd instanceof HTMLElement)) continue;
          const els = nd.matches('[data-testid="toast"]') ? [nd] : Array.from(nd.querySelectorAll('[data-testid="toast"]'));
          for (const el of els) if (/Yeni destek talebi/.test(el.textContent ?? "")) (window as unknown as { __tt: number[] }).__tt.push(Date.now());
        }
    });
    document.addEventListener("DOMContentLoaded", () => obs.observe(document.body, { childList: true, subtree: true }));
    // ses: AudioContext çağrısını say
    const AC = window.AudioContext;
    (window as unknown as { __audio: number }).__audio = 0;
    if (AC)
      window.AudioContext = class extends AC {
        constructor(...a: ConstructorParameters<typeof AudioContext>) {
          super(...a);
          (window as unknown as { __audio: number }).__audio++;
        }
      } as typeof AudioContext;
  });
  await page.goto("/sessions");
  await expect(page.getByTestId("requests-badge")).toContainText("3");
  await expect.poll(() => openSockets(page, c)).toBeGreaterThanOrEqual(1);
  const samples: number[] = [];
  for (let i = 0; i < 25; i++) {
    const before = await page.evaluate(() => (window as unknown as { __tt: number[] }).__tt.length);
    const t0 = Date.now();
    await hook(page, "new", c);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __tt: number[] }).__tt.length), { timeout: 10_000, intervals: [20] }).toBeGreaterThan(before);
    const t1 = await page.evaluate((b) => (window as unknown as { __tt: number[] }).__tt[b], before);
    samples.push(t1 - t0);
    await page.waitForTimeout(150);
  }
  const s = [...samples].sort((a, b) => a - b);
  const p95 = s[Math.ceil(0.95 * s.length) - 1];
  rec({ kind: "latency", samples, min: s[0], median: s[Math.floor(s.length / 2)], p95, max: s[s.length - 1] });
  expect.soft(p95).toBeLessThanOrEqual(3000);
  rec({ kind: "after-new", title: await page.title(), badge: await page.getByTestId("requests-badge").innerText(), audioCtx: await page.evaluate(() => (window as unknown as { __audio: number }).__audio), toastsVisible: await page.getByTestId("toast").count() });
  await shot(page, "bildirim-toast-1280", false);
  // ses kapalı → yeni AudioContext yok
  await page.goto("/requests");
  await page.getByTestId("sound-toggle").click();
  const a0 = await page.evaluate(() => (window as unknown as { __audio: number }).__audio);
  await expect.poll(() => openSockets(page, c)).toBeGreaterThanOrEqual(1);
  await hook(page, "new", c);
  await page.waitForTimeout(800);
  rec({ kind: "sound-off", audioDelta: (await page.evaluate(() => (window as unknown as { __audio: number }).__audio)) - a0, toast: await lastToast(page) });
  // Görüntüle → kart + odak/kaydırma
  const view = page.getByTestId("toast").getByRole("link", { name: "Görüntüle" }).last();
  await view.click();
  await page.waitForTimeout(400);
  rec({ kind: "view-link", url: page.url().replace(/^https?:\/\/[^/]+/, ""), focused: await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName), targetInView: await page.evaluate(() => { const id = decodeURIComponent(location.hash.slice(1)); const el = id ? document.getElementById(id) : null; if (!el) return "hedef-yok"; const b = el.getBoundingClientRect(); return b.top >= 0 && b.top < innerHeight; }) });
  // arka plan sekme: visibilityState taklidi yok; başlık her zaman (n)
  rec({ kind: "title", title: await page.title() });
  // 4401 → yeniden bağlanma süresi
  const t0 = Date.now();
  await hook(page, "close4401", c);
  await expect.poll(() => openSockets(page, c), { timeout: 40_000, intervals: [50] }).toBe(0).catch(() => {});
  await expect.poll(() => openSockets(page, c), { timeout: 40_000, intervals: [50] }).toBeGreaterThanOrEqual(1);
  rec({ kind: "reconnect", ms: Date.now() - t0 });
  // queue.alert bandı
  await hook(page, "alert", c);
  await expect.soft(page.getByTestId("queue-alert")).toBeVisible();
  await shot(page, "queue-alert-1280", false);
  rec({ kind: "alert", text: await page.getByTestId("queue-alert").innerText().catch(() => "") });
  expect.soft(await axe(page, "queue-alert+toast")).toEqual([]);
});

test("kaldırma gecikmesi (request.removed → kart düşer) 10 örnek; ikinci sekme", async ({ page, context }) => {
  track(page);
  const c = await login(context, "rqadm");
  await page.goto("/requests");
  await expect.poll(() => openSockets(page, c)).toBeGreaterThanOrEqual(1);
  const out: number[] = [];
  for (let i = 0; i < 10; i++) {
    await hook(page, "new", c);
    await expect(cards(page).filter({ hasText: "Yeni Müşteri" }).first()).toBeVisible({ timeout: 15_000 });
    const t0 = Date.now();
    await hook(page, "removed", c, "01JRQ0000000000000000000NW");
    await expect(cards(page).filter({ hasText: "Yeni Müşteri" })).toHaveCount(0, { timeout: 5000 });
    out.push(Date.now() - t0);
  }
  rec({ kind: "removed-latency", samples: out, max: Math.max(...out) });
});

test("ayarlar: sınırlar, alıcı ≤5, CIDR ≤10 + doğrulama, kaydedilmemiş değişiklik, çift tıklama, 500", async ({ page, context }) => {
  track(page);
  await login(context, "rqadm");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings/support-requests");
  // yenile → Vazgeç
  await page.getByRole("button", { name: "Bağlantıyı yenile" }).click();
  await shot(page, "ayarlar-yenile-onay", false);
  await page.keyboard.press("Escape");
  rec({ kind: "rotate-cancel", url: await page.getByTestId("download-url").innerText() });
  const wait = page.getByLabel("Talep bekleme süresi (dakika)");
  for (const v of ["9", "121", "-5", "10.5", "10", "120"]) {
    await wait.fill(v);
    await page.getByRole("button", { name: "Kaydet" }).click();
    await page.waitForTimeout(400);
    rec({ kind: "wait", input: v, value: await wait.inputValue(), errors: await errorsOf(page), toasts: await lastToast(page) });
  }
  // alıcılar
  await page.getByTestId("wa-switch").click();
  const nums = ["0532 111 22 31", "0532 111 22 32", "0532 111 22 33", "0532 111 22 34", "0532 111 22 35"];
  for (let i = 0; i < 5; i++) {
    await page.getByRole("button", { name: "Alıcı ekle" }).click();
    await page.getByLabel(`WhatsApp alıcıları ${i + 1}`).fill(nums[i]);
  }
  rec({ kind: "wa-max", addDisabled: await page.getByRole("button", { name: "Alıcı ekle" }).isDisabled() });
  await page.getByLabel("WhatsApp alıcıları 5").fill("0532 111 22 31");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForTimeout(400);
  rec({ kind: "wa-dup", errors: await errorsOf(page) });
  for (const v of ["<script>alert(1)</script>", "' OR 1=1", "12345", "+1 202 555 0143"]) {
    await page.getByLabel("WhatsApp alıcıları 5").fill(v);
    await page.getByRole("button", { name: "Kaydet" }).click();
    await page.waitForTimeout(400);
    rec({ kind: "wa-input", input: v, errors: await errorsOf(page) });
  }
  await page.getByLabel("WhatsApp alıcıları 5").fill("0532 111 22 35");
  // CIDR
  const cidrs = ["198.51.100.0/24", "1.2.0.0/8", "2001:db8::/31", "300.1.1.1/24", "abc", "<script>", "192.168.1.0/24", "8.8.8.8", "2a00:1450::/32", "203.0.113.0/24"];
  for (let i = 0; i < 9; i++) {
    await page.getByRole("button", { name: "Ağ ekle" }).click();
    await page.getByLabel(`Güvenilen ağlar ${i + 2}`).fill(cidrs[i]);
  }
  rec({ kind: "cidr-max", addDisabled: await page.getByRole("button", { name: "Ağ ekle" }).isDisabled(), count: await page.getByLabel(/^Güvenilen ağlar \d+$/).count() });
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForTimeout(500);
  rec({ kind: "cidr-errors", errors: await errorsOf(page), formError: await page.getByTestId("form-error").innerText().catch(() => "") });
  await shot(page, "ayarlar-hatalar-1280");
  expect.soft(await axe(page, "ayarlar-hatalar")).toEqual([]);
  // dirty: menü bağlantısı
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: /Talepler/ }).click();
  await page.waitForTimeout(800);
  rec({ kind: "dirty-nav", url: page.url().replace(/^https?:\/\/[^/]+/, ""), dialog: await page.getByRole("dialog").count() });
  await shot(page, "ayarlar-dirty-menu", false);
  // yenileme → beforeunload
  await page.goto("/settings/support-requests");
  await wait.fill("45");
  let dlgType = "";
  page.once("dialog", async (d) => {
    dlgType = d.type();
    await d.dismiss();
  });
  await page.reload({ timeout: 3000 }).catch(() => {});
  rec({ kind: "dirty-reload", dialog: dlgType, value: await wait.inputValue().catch(() => "?") });
  // çift tıklama Kaydet
  let n = 0;
  await page.route("**/api/v1/settings/support-requests", async (r) => {
    if (r.request().method() === "PUT") {
      n++;
      await new Promise((res) => setTimeout(res, 700));
    }
    await r.continue();
  });
  await page.goto("/settings/support-requests");
  await wait.fill("50");
  await page.getByRole("button", { name: "Kaydet" }).dblclick();
  await page.waitForTimeout(1500);
  rec({ kind: "save-dblclick", requests: n, toasts: await lastToast(page) });
  expect.soft(n).toBe(1);
  // 500
  await page.unrouteAll();
  await page.route("**/api/v1/settings/support-requests", (r) => (r.request().method() === "PUT" ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "Sunucu hatası.", requestId: "01JREQ00000000000000000000" } }) }) : r.continue()));
  await wait.fill("60");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForTimeout(600);
  rec({ kind: "save-500", value: await wait.inputValue(), formError: await page.getByTestId("form-error").innerText().catch(() => ""), toasts: await lastToast(page), dirtyText: await page.getByTestId("save-bar").innerText() });
  await shot(page, "ayarlar-500", false);
  // WA test çift tıklama
  await page.unrouteAll();
  let w = 0;
  await page.route("**/whatsapp/test", async (r) => {
    w++;
    await new Promise((res) => setTimeout(res, 700));
    await r.continue();
  });
  await page.getByLabel("Test numarası").fill("0532 111 22 33");
  await page.getByRole("button", { name: "Test mesajı gönder" }).dblclick();
  await page.waitForTimeout(1500);
  rec({ kind: "wa-test-dblclick", requests: w, result: await page.getByTestId("wa-test-result").innerText().catch(() => "") });
  // e-posta pasif metni
  rec({ kind: "mail", disabled: await page.getByTestId("mail-switch").isDisabled(), text: (await page.locator("main").innerText()).match(/SMTP[^\n]*/g) });
});

test("klavye: kuyruk Tab sırası, Enter ile Reddet diyaloğu, ayarlar Tab sırası", async ({ page, context }) => {
  track(page);
  await login(context, "rqadm");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/requests");
  await page.waitForLoadState("networkidle");
  const desc = () =>
    page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a) return "-";
      const o = getComputedStyle(a).outlineStyle;
      return `${a.tagName.toLowerCase()}:${(a.getAttribute("aria-label") ?? a.textContent ?? "").trim().slice(0, 40)}${o === "none" ? " [halka yok]" : ""}`;
    });
  await page.keyboard.press("Tab");
  const order: string[] = [];
  for (let i = 0; i < 18; i++) {
    order.push(await desc());
    await page.keyboard.press("Tab");
  }
  rec({ kind: "tab-requests", order });
  await card(page, "Ayşe Yılmaz").getByRole("button", { name: "Reddet: Ayşe Yılmaz" }).focus();
  await page.keyboard.press("Enter");
  await expect.soft(page.getByTestId("reject-dialog")).toBeVisible();
  const dlgOrder: string[] = [];
  for (let i = 0; i < 8; i++) {
    dlgOrder.push(await desc());
    await page.keyboard.press("Tab");
  }
  rec({ kind: "tab-reject-dialog", order: dlgOrder });
  await page.keyboard.press("Escape");
  rec({ kind: "esc-return", focused: await desc() });
  await page.goto("/settings/support-requests");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Kopyala" }).focus();
  const sOrder: string[] = [];
  for (let i = 0; i < 14; i++) {
    sOrder.push(await desc());
    await page.keyboard.press("Tab");
  }
  rec({ kind: "tab-settings", order: sOrder });
});

test("yetkisiz/oturumsuz, menü ikonları, 390 menü, başlık", async ({ page, context, browser }) => {
  track(page);
  for (const u of ["/requests", "/settings/support-requests", "/requests?tab=history"]) {
    const r = await page.goto(u);
    rec({ kind: "anon", from: u, to: page.url().replace(/^https?:\/\/[^/]+/, ""), status: r?.status() });
  }
  await login(context, "rqadm");
  await page.goto("/requests");
  const nav = page.getByRole("navigation", { name: "Ana menü" });
  const items = await nav.getByRole("link").evaluateAll((els) => els.map((e) => ({ text: e.textContent?.trim(), svg: e.querySelectorAll("svg").length, cls: e.querySelector("svg")?.getAttribute("class") })));
  rec({ kind: "nav-icons", items });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/requests");
  const ul = nav.locator("ul").first();
  rec({ kind: "nav390", ...(await ul.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }))) });
  for (const name of [/Talepler/, /Ayarlar/]) {
    const l = nav.getByRole("link", { name });
    const b = await l.evaluate((el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right) }; });
    rec({ kind: "nav390-link", name: String(name), ...b });
  }
  await shot(page, "nav-390-talepler", false);
  await page.goto("/settings/support-requests");
  await shot(page, "nav-390-ayarlar", false);
  // rqempty başlık (0 → önek yok)
  const ctx = await browser.newContext({ baseURL: "http://localhost:3217" });
  await login(ctx, "rqempty");
  const p2 = await ctx.newPage();
  track(p2);
  await p2.goto("/requests");
  await p2.waitForLoadState("networkidle");
  rec({ kind: "title-empty", title: await p2.title(), badge: await p2.getByTestId("requests-badge").count() });
  await ctx.close();
  // rqro: settings uç 403, kabul uç 403
  const ctx3 = await browser.newContext({ baseURL: "http://localhost:3217" });
  await login(ctx3, "rqro");
  const p3 = await ctx3.newPage();
  await p3.goto("/requests");
  const st = await p3.evaluate(async () => {
    const h = { "Content-Type": "application/json", "X-CSRF-Token": "csrf-test-token" };
    const a = await fetch("/api/v1/support-requests/01JRQ00000000000000000000A/accept", { method: "POST", headers: h, body: "{}" });
    const s = await fetch("/api/v1/settings/support-requests");
    return { accept: a.status, settings: s.status };
  });
  rec({ kind: "rqro-api", ...st });
  await ctx3.close();
});

test("geçmiş sekmesi: filtre URL'de, yenileme ve geri tuşu sonrası korunur", async ({ page, context }) => {
  track(page);
  await login(context, "rqadm");
  await page.goto("/requests?tab=history");
  await page.getByTestId("history-status-filter").getByRole("link", { name: "Reddedildi" }).click();
  await page.waitForURL(/status=REJECTED/);
  await page.reload();
  const a = await cards(page).count();
  await page.getByRole("link", { name: "Bekleyenler" }).click().catch(async () => await page.getByRole("link", { name: /Bekleyen/ }).first().click());
  await page.waitForLoadState("networkidle");
  await page.goBack();
  await page.waitForLoadState("networkidle");
  rec({ kind: "history-filter", afterReload: a, backUrl: page.url().replace(/^https?:\/\/[^/]+/, ""), afterBack: await cards(page).count(), current: await page.getByTestId("history-status-filter").locator('[aria-current="page"]').innerText().catch(() => "") });
  // ağ hatası: geçmiş sekmesinde liste 500
  await page.route("**/api/v1/support-requests?*", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "x", requestId: "01JREQ00000000000000000000" } }) }));
  // SSR yükler; istemci tarafı yenileme 500 → stale uyarısı
  await page.goto("/requests");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(500);
  rec({ kind: "client-500", stale: await page.getByTestId("queue-stale").count() });
});
