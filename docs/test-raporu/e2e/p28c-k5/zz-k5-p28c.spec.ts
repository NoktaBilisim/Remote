// P28c K5 sayfa taraması + keşif turu (test-operatoru, geçici; kod değil). Koşu: bu dosya apps/web/e2e/ altına, k5.config.ts
// apps/web/ altına geçici kopyalanır → `./node_modules/.bin/playwright test -c k5.config.ts` → kopyalar silinir.
// Ön koşul (elle): sahte API :4217 (e2e/mock-api.mjs), history-proxy.mjs :4219, standalone web :3217 (API_INTERNAL_URL=:4219).
// Tarama: her görünüm açık/koyu × 1280/375; HTTP 4xx/5xx, konsol hata/uyarı, pageerror, axe (bölge), belge + bölge içi taşma, ekran.
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { axeScan, newSession, signIn } from "./helpers";

const DIR = "/Users/mennan/Projeler/Remote/docs/test-raporu/e2e/p28c-k5/";
const OUT = "/private/tmp/claude-501/-Users-mennan-Projeler-Remote/fa15848a-dcdd-4f1b-abf9-1c72703d5eac/scratchpad/k5/img/";
mkdirSync(OUT, { recursive: true });
const RICH = "01JHXST0000000000000000000";
const REASON = "Gece bakım penceresinde sunucu güncellemesini izliyorum";
const LONG = "Çok Uzun Müşteri Bilgisayar Adı ŞİRKET-MUHASEBE-DEPARTMANI-İKİNCİ-KAT-MASAÜSTÜ-0001 <script>alert(1)</script>";
const ERR500 = { status: 500, contentType: "application/json", body: '{"error":{"code":"INTERNAL","message":"x"}}' };
const log = (o: unknown) => appendFileSync(`${DIR}tarama.jsonl`, JSON.stringify(o) + "\n");
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

type Ctx = { p: Page; browser: Browser; ctx: BrowserContext; w: number; scheme: "light" | "dark" };
type View = { id: string; scen: string; root: string; act: (c: Ctx) => Promise<Page | void> };

async function ownConsole(p: Page) {
  const r = await p.request.get("/api/v1/__e2e/p28c-own");
  const { id } = (await r.json()) as { id: string };
  await p.goto(`/sessions/${id}/console`);
  await expect(p.getByTestId("console")).toHaveAttribute("data-phase", "live");
  await p.getByTestId("techs-toggle").click();
  await expect(p.getByTestId("techs-row").first()).toBeVisible();
}
async function watchSilent(p: Page) {
  await p.goto("/sessions");
  await p.getByRole("button", { name: "İzle: SUNUCU-01" }).click();
  const dlg = p.getByTestId("mt-reason-dialog");
  await dlg.getByTestId("un-silent-reason").fill(REASON);
  await dlg.getByTestId("mt-reason-submit").click();
  await expect(p.getByTestId("console")).toHaveAttribute("data-phase", "live");
}
async function guestWithRoster(c: Ctx) {
  const s = await newSession(c.p);
  await c.p.goto(`/sessions/${s.id}/console`);
  const gctx = await c.browser.newContext({ viewport: { width: c.w, height: 900 }, colorScheme: c.scheme, reducedMotion: "reduce" });
  const g = await gctx.newPage();
  watch(g, `guest`);
  await g.goto(new URL(s.link).pathname);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill("Ali Müşteri");
  await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
  await c.p.getByTestId("admit-input").fill(code);
  await c.p.getByTestId("admit-submit").click();
  await expect(c.p.getByTestId("console-status")).toHaveText("Aktif");
  expect((await c.p.request.get(`http://127.0.0.1:4217/__e2e/guest-roster/${s.id}`)).status()).toBe(200);
  await expect(g.getByTestId("guest-techs").getByTestId("guest-tech")).toHaveCount(2);
  return g;
}

const VIEWS: View[] = [
  { id: "aktif-liste", scen: "p28csup", root: '[data-testid="active-sessions"]', act: async ({ p }) => {
    await p.goto("/sessions");
    await expect(p.getByTestId("active-row")).toHaveCount(4);
  } },
  { id: "aktif-uzun-ad", scen: "p28csup", root: '[data-testid="active-sessions"]', act: async ({ p }) => {
    await p.route("**/api/v1/sessions/active", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [
        { id: "01JSSP28CK5000000000000001", technicianName: "Ayşe Çok Uzun Soyadlı Teknisyen Kullanıcısı Örneği", customerName: LONG, mode: "UNATTENDED", startedAt: iso(-60_000), techCount: 3, full: true, supported: true, unattended: true, silent: true, consentMode: "silent" },
        { id: "01JSSP28CK5000000000000002", technicianName: "Can", customerName: "Kısa", mode: "ATTENDED", startedAt: iso(-30_000), techCount: 1, full: false, supported: true, unattended: false, silent: false },
      ] }) }));
    await p.goto("/sessions");
    await expect(p.getByTestId("active-row")).toHaveCount(2);
  } },
  { id: "davet-kartlari", scen: "p28cinv", root: '[data-testid="invite-notifier"]', act: async ({ p }) => {
    await p.goto("/sessions");
    await expect(p.getByTestId("invite-card")).toHaveCount(2);
  } },
  { id: "davet-uzun-ad", scen: "p28cinv", root: '[data-testid="invite-notifier"]', act: async ({ p }) => {
    await p.route("**/api/v1/sessions/invites", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [
        { inviteId: "inv0000000000000000K5A", sessionId: "01JSSP28CK5000000000000001", fromName: "Ayşe Çok Uzun Soyadlı Teknisyen Kullanıcısı Örneği", customerName: LONG, unattended: true, silent: true, expiresAt: iso(110_000) },
      ] }) }));
    await p.goto("/sessions");
    await expect(p.getByTestId("invite-card")).toHaveCount(1);
  } },
  { id: "gerekce-diyalogu", scen: "p28csup", root: '[data-testid="mt-reason-dialog"]', act: async ({ p }) => {
    await p.goto("/sessions");
    await p.getByRole("button", { name: "İzle: SUNUCU-01" }).click();
    await expect(p.getByTestId("mt-reason-dialog")).toBeVisible();
    await p.getByTestId("mt-reason-submit").click();
    await expect(p.getByTestId("un-silent-reason-error")).toBeVisible();
  } },
  { id: "konsol-sahip", scen: "p28cown", root: '[data-testid="techs-panel"]', act: async ({ p }) => {
    await ownConsole(p);
    await p.getByTestId("techs-invite").click();
    await p.getByTestId("invite-dialog").getByRole("button", { name: "Davet et: Kerem Yardımcı" }).click();
    await expect(p.getByTestId("techs-pending")).toBeVisible();
  } },
  { id: "davet-diyalogu", scen: "p28cown", root: '[data-testid="invite-dialog"]', act: async ({ p }) => {
    await ownConsole(p);
    await p.getByTestId("techs-invite").click();
    await expect(p.getByTestId("invite-send")).toHaveCount(2);
  } },
  { id: "devret-onay", scen: "p28cown", root: '[data-testid="techs-confirm"]', act: async ({ p }) => {
    await ownConsole(p);
    await p.getByRole("button", { name: "Oturumu devret: Burak Katılımcı" }).click();
    await expect(p.getByTestId("techs-confirm")).toBeVisible();
  } },
  { id: "konsol-katilimci", scen: "p28cinv", root: '[data-testid="techs-panel"]', act: async ({ p }) => {
    await p.goto("/sessions");
    await p.getByRole("button", { name: "Katıl: Ali Müşteri" }).click();
    await expect(p.getByTestId("console")).toHaveAttribute("data-phase", "live");
    await p.getByTestId("techs-toggle").click();
    await expect(p.getByTestId("techs-row")).toHaveCount(2);
  } },
  { id: "konsol-izleyici", scen: "p28csup", root: '[data-testid="console"]', act: async ({ p }) => {
    await watchSilent(p);
    await p.getByTestId("techs-toggle").click();
    await expect(p.getByTestId("techs-row")).toHaveCount(2);
  } },
  { id: "konsol-desteksiz", scen: "p28cunsup", root: '[data-testid="techs-panel"]', act: async ({ p }) => {
    await ownConsole(p);
    await expect(p.getByTestId("techs-invite-block")).toBeVisible();
  } },
  { id: "gecmis-katilimcilar", scen: "hu", root: '[data-testid="participants"]', act: async ({ p }) => {
    await p.goto(`/history/${RICH}`);
    await expect(p.getByTestId("participant")).toHaveCount(4);
    await p.getByTestId("participants").scrollIntoViewIfNeeded();
  } },
  { id: "misafir-teknisyenler", scen: "p5", root: '[data-testid="guest-techs"]', act: async (c) => {
    const g = await guestWithRoster(c);
    await g.getByTestId("guest-techs").scrollIntoViewIfNeeded();
    return g;
  } },
  { id: "misafir-cikar-onay", scen: "p5", root: '[data-testid="guest-remove-confirm"]', act: async (c) => {
    const g = await guestWithRoster(c);
    await g.getByRole("button", { name: "Çıkar: Burak Katılımcı" }).click();
    await expect(g.getByTestId("guest-remove-confirm")).toBeVisible();
    return g;
  } },
];

// Sayfa başına gözlem: konsol hata/uyarı, pageerror, ≥400 yanıtlar
const seen = new Map<Page, { cons: string[]; errs: string[]; http: string[] }>();
function watch(p: Page, _tag: string) {
  const o = { cons: [] as string[], errs: [] as string[], http: [] as string[] };
  seen.set(p, o);
  p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && o.cons.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
  p.on("pageerror", (e) => o.errs.push(e.message.slice(0, 300)));
  p.on("response", (r) => r.status() >= 400 && o.http.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`));
  return o;
}

/** Bölge içinde, kök kutusunun sağına taşan / kendi içinde kırpılmadan taşan öğeler. */
async function innerOverflow(p: Page, root: string) {
  return p.evaluate((sel) => {
    const out: string[] = [];
    for (const r of document.querySelectorAll<HTMLElement>(sel)) {
      const rb = r.getBoundingClientRect();
      for (const el of r.querySelectorAll<HTMLElement>("*")) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (b.right > rb.right + 1 || b.left < rb.left - 1) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} (+${Math.round(b.right - rb.right)}px) "${(el.textContent ?? "").slice(0, 40)}"`);
      }
    }
    return out.slice(0, 8);
  }, root);
}

test.describe.configure({ mode: "parallel" });
for (const v of VIEWS)
  for (const scheme of ["light", "dark"] as const)
    for (const w of [1280, 375]) {
      test(`${v.id} ${scheme} ${w}`, async ({ browser }) => {
        const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
        await signIn(ctx, v.scen);
        const p = await ctx.newPage();
        watch(p, "main");
        const rec: Record<string, unknown> = { id: v.id, scheme, w };
        try {
          const target = (await v.act({ p, browser, ctx, w, scheme })) ?? p;
          await target.waitForTimeout(400);
          rec.docOverflow = await target.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          rec.inner = await innerOverflow(target, v.root);
          rec.axe = await axeScan(target, v.root);
          rec.axePage = v.root.includes("dialog") || v.root.includes("confirm") ? "-" : await axeScan(target);
          await target.screenshot({ path: `${OUT}${v.id}-${w}-${scheme}.png`, fullPage: w === 375 || v.id.startsWith("gecmis") });
          const all = [...seen.entries()].filter(([pg]) => pg.context() === ctx || pg === target).map(([, o]) => o);
          rec.cons = all.flatMap((o) => o.cons);
          rec.errs = all.flatMap((o) => o.errs);
          rec.http = all.flatMap((o) => o.http);
          rec.ok = true;
        } catch (e) {
          rec.ok = false;
          rec.fail = String(e).slice(0, 400);
          await p.screenshot({ path: `${OUT}FAIL-${v.id}-${w}-${scheme}.png` }).catch(() => {});
        } finally {
          const all = [...seen.values()];
          rec.consAll = rec.cons ?? all.flatMap((o) => o.cons).slice(0, 5);
          log(rec);
          await ctx.close();
        }
        expect(rec.ok, String(rec.fail)).toBe(true);
      });
    }

// ---- Durum ve klavye keşifleri (1280, açık) ----
async function open(browser: Browser, scen: string, w = 1280, scheme: "light" | "dark" = "light") {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
  await signIn(ctx, scen);
  const p = await ctx.newPage();
  const o = watch(p, scen);
  return { ctx, p, o };
}
const shot = (p: Page, n: string) => p.screenshot({ path: `${OUT}durum-${n}.png` });
const ent = async (p: Page, id: string) => ((await p.locator(`[data-testid="${id}"]`).count()) > 0);

test("S aktif: yükleniyor → hata → Tekrar dene → liste; boş; 403 gizli", async ({ browser }) => {
  const { ctx, p, o } = await open(browser, "p28csup");
  let mode: "slow" | "err" | "pass" = "slow";
  await p.route("**/api/v1/sessions/active", async (r) => {
    if (mode === "slow") {
      await new Promise((res) => setTimeout(res, 2500));
      return r.fulfill(ERR500);
    }
    if (mode === "err") return r.fulfill(ERR500);
    return r.fallback();
  });
  await p.goto("/sessions");
  await expect(p.getByTestId("active-loading")).toBeVisible();
  const loadingAxe = await axeScan(p, '[data-testid="active-sessions"]');
  await shot(p, "aktif-yukleniyor");
  await expect(p.getByTestId("active-loading")).toHaveCount(0, { timeout: 6000 });
  const errText = await p.getByTestId("active-sessions").innerText();
  await shot(p, "aktif-hata");
  mode = "pass";
  await p.getByTestId("active-sessions").getByRole("button", { name: /Tekrar dene/ }).click();
  await expect(p.getByTestId("active-row")).toHaveCount(4);
  await p.unroute("**/api/v1/sessions/active");
  await p.route("**/api/v1/sessions/active", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"items":[]}' }));
  await p.reload();
  await expect(p.getByTestId("active-empty")).toBeVisible();
  await shot(p, "aktif-bos");
  const emptyAxe = await axeScan(p, '[data-testid="active-sessions"]');
  log({ id: "S-aktif", loadingAxe, errText, emptyAxe, http: o.http, cons: o.cons, errs: o.errs });
  await ctx.close();
  const b = await open(browser, "p28cinv");
  await b.p.goto("/sessions");
  await expect(b.p.getByTestId("invite-card").first()).toBeVisible();
  log({ id: "S-aktif-403", sectionCount: await b.p.getByTestId("active-sessions").count(), http: b.o.http, cons: b.o.cons });
  await b.ctx.close();
});

test("S aday listesi: hata → Tekrar dene; boş; 409 pasif; eşleşme yok; POST 500 → FormError", async ({ browser }) => {
  const { ctx, p, o } = await open(browser, "p28cown");
  await ownConsole(p);
  const res: Record<string, unknown> = { id: "S-aday" };
  let mode = "err";
  await p.route("**/invite-candidates", (r) => {
    if (mode === "err") return r.fulfill(ERR500);
    if (mode === "empty") return r.fulfill({ status: 200, contentType: "application/json", body: '{"items":[]}' });
    if (mode === "409")
      return r.fulfill({ status: 409, contentType: "application/json", body: '{"error":{"code":"CLIENT_UNSUPPORTED","message":"x"}}' });
    if (mode === "slow") return new Promise((s) => setTimeout(s, 2500)).then(() => r.fallback());
    return r.fallback();
  });
  const dlg = p.getByTestId("invite-dialog");
  await p.getByTestId("techs-invite").click();
  await expect(dlg.getByRole("button", { name: /Tekrar dene/ })).toBeVisible();
  res.errText = await dlg.innerText();
  res.errAxe = await axeScan(p, '[data-testid="invite-dialog"]');
  await shot(p, "aday-hata");
  mode = "pass";
  await dlg.getByRole("button", { name: /Tekrar dene/ }).click();
  await expect(dlg.getByTestId("invite-send")).toHaveCount(2);
  await dlg.getByTestId("invite-search").fill("zzz");
  await expect(dlg.getByTestId("invite-nomatch")).toBeVisible();
  res.nomatch = await dlg.getByTestId("invite-nomatch").innerText();
  await shot(p, "aday-eslesme-yok");
  await dlg.getByRole("button", { name: "Vazgeç" }).click();
  mode = "empty";
  await p.getByTestId("techs-invite").click();
  await expect(dlg.getByTestId("invite-empty")).toBeVisible();
  res.empty = await dlg.getByTestId("invite-empty").innerText();
  res.searchAfterReopen = await dlg.getByTestId("invite-search").count();
  await shot(p, "aday-bos");
  await dlg.getByRole("button", { name: "Vazgeç" }).click();
  mode = "409";
  await p.getByTestId("techs-invite").click();
  await expect(dlg.getByTestId("invite-blocked")).toBeVisible();
  res.blocked = await dlg.getByTestId("invite-blocked").innerText();
  res.blockedAxe = await axeScan(p, '[data-testid="invite-dialog"]');
  await shot(p, "aday-409");
  await dlg.getByRole("button", { name: "Vazgeç" }).click();
  mode = "slow";
  await p.getByTestId("techs-invite").click();
  await expect(dlg.getByTestId("invite-loading")).toBeVisible();
  await shot(p, "aday-yukleniyor");
  await expect(dlg.getByTestId("invite-send")).toHaveCount(2, { timeout: 6000 });
  await p.route("**/api/v1/sessions/*/invites", (r) => (r.request().method() === "POST" ? r.fulfill(ERR500) : r.fallback()));
  await dlg.getByRole("button", { name: "Davet et: Selin Destek" }).click();
  await p.waitForTimeout(600);
  res.postErrVisible = await dlg.isVisible();
  res.postErrText = (await dlg.innerText()).slice(0, 300);
  await shot(p, "davet-post-500");
  res.http = o.http;
  res.cons = o.cons;
  res.errs = o.errs;
  log(res);
  await ctx.close();
});

test("S davet kartı: Reddet 500 / süresi dolan kart düşer", async ({ browser }) => {
  const { ctx, p, o } = await open(browser, "p28cinv");
  await p.route("**/api/v1/sessions/invites/*/reject", (r) => r.fulfill(ERR500));
  await p.goto("/sessions");
  await expect(p.getByTestId("invite-card")).toHaveCount(2);
  await p.getByRole("button", { name: "Reddet: SUNUCU-01" }).click();
  await p.waitForTimeout(700);
  const afterReject = await p.getByTestId("invite-card").count();
  const toastTxt = await p.locator("[data-sonner-toast], [role=status], [role=alert]").allInnerTexts();
  await shot(p, "davet-reddet-500");
  await p.waitForTimeout(5600);
  const afterPoll = await p.getByTestId("invite-card").count();
  await p.unroute("**/api/v1/sessions/invites/*/reject");
  log({ id: "S-reddet-500", afterReject, afterPoll, toastTxt, http: o.http, cons: o.cons });
  await ctx.close();
  const b = await open(browser, "p28cinv");
  await b.p.route("**/api/v1/sessions/invites", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [
      { inviteId: "inv0000000000000000K5B", sessionId: "01JSSP28CK5000000000000001", fromName: "Ayşe", customerName: "Kısa Süreli", unattended: false, silent: false, expiresAt: iso(3000) },
    ] }) }));
  await b.p.goto("/sessions");
  await expect(b.p.getByTestId("invite-card")).toHaveCount(1);
  const leftText = await b.p.getByTestId("invite-card").innerText();
  await b.p.waitForTimeout(4500);
  log({ id: "S-davet-suresi", leftText, after: await b.p.getByTestId("invite-card").count(), notifier: await ent(b.p, "invite-notifier") });
  await b.ctx.close();
});

test("K klavye: panel aç/kapa, davet diyaloğu odak tuzağı + Esc + odak dönüşü, onay diyaloğu Vazgeç odağı", async ({ browser }) => {
  const { ctx, p } = await open(browser, "p28cown");
  await ownConsole(p); // panel açık
  const tg = p.getByTestId("techs-toggle");
  await tg.focus();
  await p.keyboard.press("Enter");
  const afterEnter = await tg.getAttribute("aria-expanded");
  await p.keyboard.press("Space");
  const afterSpace = await tg.getAttribute("aria-expanded");
  const focusVisible = await tg.evaluate((el) => getComputedStyle(el).outlineStyle + " " + getComputedStyle(el).boxShadow.slice(0, 40));
  await p.screenshot({ path: `${OUT}klavye-toggle-odak.png` });
  // davet et'e Tab ile ulaşılıyor mu
  let reached = false;
  for (let i = 0; i < 12; i++) {
    await p.keyboard.press("Tab");
    if ((await p.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "techs-invite") { reached = true; break; }
  }
  await p.keyboard.press("Enter");
  const dlg = p.getByTestId("invite-dialog");
  await expect(dlg.getByTestId("invite-send")).toHaveCount(2);
  const firstFocus = await p.evaluate(() => (document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName) + "|" + (document.activeElement?.getAttribute("aria-label") ?? ""));
  const inside: boolean[] = [];
  for (let i = 0; i < 8; i++) {
    await p.keyboard.press("Tab");
    inside.push(await p.evaluate(() => !!document.activeElement?.closest('[data-testid="invite-dialog"]')));
  }
  await p.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  const back = await p.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName);
  await p.getByRole("button", { name: "Oturumu devret: Burak Katılımcı" }).click();
  const confirmFocus = await p.evaluate(() => document.activeElement?.textContent);
  await p.keyboard.press("Escape");
  const backConfirm = await p.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName);
  log({ id: "K-panel", afterEnter, afterSpace, focusVisible, reachedInviteByTab: reached, firstFocus, inside, back, confirmFocus, backConfirm });
  await ctx.close();

  const b = await open(browser, "p28csup");
  await b.p.goto("/sessions");
  await expect(b.p.getByTestId("active-row")).toHaveCount(4);
  const watchBtn = b.p.getByRole("button", { name: "İzle: SUNUCU-01" });
  await watchBtn.focus();
  await b.p.keyboard.press("Enter");
  const rd = b.p.getByTestId("mt-reason-dialog");
  await expect(rd).toBeVisible();
  const rFocus = await b.p.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName);
  await b.p.keyboard.press("Escape");
  await expect(rd).toBeHidden();
  const rBack = await b.p.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  const disabledDesc = await b.p.getByTestId("active-row").filter({ hasText: "Eski İstemci" }).getByTestId("active-watch").getAttribute("aria-describedby");
  // Davet kartında Tab sırası
  const c = await open(browser, "p28cinv");
  await c.p.goto("/sessions");
  await expect(c.p.getByTestId("invite-card")).toHaveCount(2);
  const order: string[] = [];
  for (let i = 0; i < 40 && order.length < 4; i++) {
    await c.p.keyboard.press("Tab");
    const l = await c.p.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    if (/^(Katıl|Reddet):/.test(l)) order.push(l);
  }
  log({ id: "K-izle-davet", rFocus, rBack, disabledDesc, inviteTabOrder: order });
  await b.ctx.close();
  await c.ctx.close();
});

test("S geçmiş: tek teknisyenli oturumda Katılımcılar bölümü çizilmez", async ({ browser }) => {
  const { ctx, p, o } = await open(browser, "hu");
  await p.goto("/history/01JHXST0000000000000000001");
  await expect(p.locator("h1")).toBeVisible();
  log({ id: "S-gecmis-tek", participants: await p.getByTestId("participants").count(), http: o.http, cons: o.cons });
  await ctx.close();
});
