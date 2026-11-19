// P22-T gerçek sunucu + gerçek web (yalnız yerel). Gövde/parola yazdırılmaz; sonuçlar $OUT/akis.jsonl'a.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { api, axe, BASE, cancelLeftovers, fakeDisplayMedia, login, overflow, USERS } from "./lib";

const OUT = process.env.P22_OUT ?? "/tmp";
const IMG = `${OUT}/img`;
mkdirSync(IMG, { recursive: true });
const rec = (o: Record<string, unknown>) => appendFileSync(`${OUT}/akis.jsonl`, JSON.stringify({ ts: new Date().toISOString(), ...o }) + "\n");

function sql(q: string): string {
  const u = new URL(process.env.TEST_DATABASE_URL!);
  return execFileSync("docker", ["exec", "-e", `MYSQL_PWD=${decodeURIComponent(u.password)}`, "rs-p22-test", "mysql", "-N", "-uapp", "remote", "-e", q], {
    encoding: "utf8",
  }).trim();
}
const count = (q: string) => Number(sql(q));

/** WebSocket sarmalayıcı: kayıt + isteğe bağlı `rs.cap.schat1` çıkarma (eski istemci taklidi). */
function wsHook(opts: { strip: string | null }) {
  const W = window.WebSocket;
  (window as any).__ws = [];
  (window as any).__in = [];
  (window as any).__close = [];
  (window as any).__dc = [];
  class Hooked extends W {
    constructor(url: string | URL, protocols?: string | string[]) {
      let p = protocols;
      if (opts.strip && String(url).includes(opts.strip) && p) p = (Array.isArray(p) ? p : [p]).filter((x) => x !== "rs.cap.schat1");
      super(url, p);
      (window as any).__ws.push(this);
      this.addEventListener("message", (e) => {
        try {
          (window as any).__in.push(JSON.parse(String(e.data)).t);
        } catch {}
      });
      this.addEventListener("close", (e) => (window as any).__close.push(e.code));
    }
  }
  (window as any).WebSocket = Hooked;
  const P = window.RTCPeerConnection;
  const hookDc = (dc: RTCDataChannel) =>
    dc.addEventListener("message", (e) => {
      if (typeof e.data === "string" && e.data.includes('"chat"')) (window as any).__dc.push(e.data);
    });
  class HP extends P {
    constructor(c?: RTCConfiguration) {
      super(c);
      this.addEventListener("datachannel", (e) => hookDc(e.channel));
    }
    createDataChannel(l: string, i?: RTCDataChannelInit) {
      const dc = super.createDataChannel(l, i);
      hookDc(dc);
      return dc;
    }
  }
  (window as any).RTCPeerConnection = HP;
}

let tech: BrowserContext;
let page: Page;
let sid = "";

async function newSession() {
  await cancelLeftovers(tech);
  const r = await api(tech, "POST", "/sessions", {});
  expect([200, 201], JSON.stringify(r.json)).toContain(r.status);
  return r.json as { id: string; link: string };
}

async function guestJoin(browser: Browser, link: string, strip: boolean) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(fakeDisplayMedia);
  await ctx.addInitScript(wsHook, { strip: strip ? "/ws/guest" : null });
  const g = await ctx.newPage();
  g.on("pageerror", (e) => rec({ t: "pageerror-guest", e: String(e).slice(0, 200) }));
  await g.goto(new URL(link).pathname);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill("Ayşe Test");
  await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\D/g, "");
  await page.getByTestId("admit-input").fill(code);
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif", { timeout: 20_000 });
  return { ctx, g };
}

async function themes(p: Page, name: string, include?: string) {
  for (const scheme of ["light", "dark"] as const) {
    await p.emulateMedia({ colorScheme: scheme });
    await p.waitForTimeout(200);
    const v = await axe(p, include);
    rec({ t: "axe", name, scheme, w: p.viewportSize()?.width, violations: v, overflow: await overflow(p) });
    await p.screenshot({ path: `${IMG}/${name}-${p.viewportSize()?.width}-${scheme}.png`, fullPage: false });
  }
  await p.emulateMedia({ colorScheme: "light" });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  tech = await browser.newContext();
  const me = await login(tech, USERS.a1);
  rec({ t: "login", role: me?.user?.role ?? me?.role, perms: (me?.permissions ?? me?.user?.permissions ?? []).filter((x: string) => x.includes("chat")) });
  page = await tech.newPage();
  page.on("pageerror", (e) => rec({ t: "pageerror-tech", e: String(e).slice(0, 200) }));
  page.on("console", (m) => m.type() === "error" && rec({ t: "console-tech", e: m.text().slice(0, 200) }));
});

test("1 AC-292 karşılama satırı + düğme (gerçek resolve)", async ({ browser }) => {
  const s = await newSession();
  const days = sql(`select ts.retention_days from tenant_settings ts join tenants t on t.id=ts.tenant_id where t.slug='demo'`);
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await g.goto(new URL(s.link).pathname);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  const line = g.getByTestId("chat-retention-notice");
  await expect(line).toHaveText(`Sohbet mesajları kayıt altına alınır ve ${days} gün saklanır`);
  const prev = await g.getByTestId("join-browser").evaluate((b) => b.previousElementSibling?.getAttribute("data-testid"));
  const desc = await g.getByTestId("join-browser").getAttribute("aria-describedby");
  const lineId = await line.getAttribute("id");
  const disabledBefore = await g.getByTestId("join-browser").isDisabled();
  await g.getByTestId("guest-name").fill("Ayşe Test");
  await g.getByTestId("guest-consent").check();
  const enabledAfter = await g.getByTestId("join-browser").isEnabled();
  rec({ t: "ac292", days, prev, describedByLine: !!lineId && (desc ?? "").includes(lineId), disabledBefore, enabledAfter });
  expect(prev).toBe("chat-retention-notice");
  expect(enabledAfter).toBe(true);
  await themes(g, "karsilama");
  await g.setViewportSize({ width: 390, height: 900 });
  await themes(g, "karsilama");
  await ctx.close();
  await api(tech, "POST", `/sessions/${s.id}/cancel`, {});
});

test("2 AC-264 çift yönlü WS sohbeti + yeniden bağlanma geçmişi + konsol yenileme", async ({ browser }) => {
  const s = await newSession();
  sid = s.id;
  await page.goto(`/sessions/${s.id}/console`);
  const { ctx, g } = await guestJoin(browser, s.link, false);
  await expect(page.getByTestId("chat-input")).toBeEnabled();
  await expect(g.getByTestId("chat-input")).toBeEnabled();
  const techNote = await page.getByTestId("chat-stored-note").textContent();
  const guestNote = await g.getByTestId("chat-stored-note").textContent();
  rec({ t: "notes", techNote, guestNote });

  await page.getByTestId("chat-input").fill("T1 merhaba, ekranınızı görüyorum.");
  await page.keyboard.press("Enter");
  await expect(g.getByTestId("chat-msg")).toHaveText(["T1 merhaba, ekranınızı görüyorum."]);
  const xss = `<img src=x onerror="window.__rsXss=1">`;
  await g.getByTestId("chat-input").fill(xss);
  await g.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-msg").last()).toHaveText(xss);
  const imgs = await page.getByTestId("chat-log").locator("img").count();
  const xssFired = await page.evaluate(() => (window as any).__rsXss === 1);
  const rows1 = count(`select count(*) from session_messages where session_id='${s.id}'`);
  const plain = count(`select count(*) from session_messages where session_id='${s.id}' and instr(body_enc,'merhaba')>0`);
  rec({ t: "bidir", rows1, imgs, xssFired, plaintextInDb: plain });
  expect(rows1).toBe(2);
  await themes(page, "konsol-sohbet", '[data-testid="chat-panel"]');
  await themes(g, "misafir-sohbet");

  // Misafir kopar (çevrimdışı + soket kapat) → teknisyen yazar → dönüşte geçmiş
  await ctx.setOffline(true);
  await g.evaluate(() => (window as any).__ws.forEach((w: WebSocket) => w.close()));
  await page.waitForTimeout(1500);
  await page.getByTestId("chat-input").fill("T2 kopukken yazıldı");
  await page.keyboard.press("Enter");
  await expect(page.locator('li[data-status="sent"]')).toHaveCount(2, { timeout: 10_000 });
  await ctx.setOffline(false);
  let got = false;
  try {
    await expect(g.getByTestId("chat-msg")).toHaveCount(3, { timeout: 40_000 });
    got = true;
  } catch {}
  const gMsgs = await g.getByTestId("chat-msg").allTextContents();
  const histFrames = await g.evaluate(() => (window as any).__in.filter((x: string) => x === "chat.history").length);
  rec({ t: "reconnect-guest", got, count: gMsgs.length, lastIsT2: gMsgs.at(-1) === "T2 kopukken yazıldı", histFrames, wsOpened: await g.evaluate(() => (window as any).__ws.length) });
  await g.screenshot({ path: `${IMG}/misafir-yeniden-baglanma-1280.png` });

  // Konsol yenileme → geçmiş
  await page.reload();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif", { timeout: 20_000 });
  await expect(page.getByTestId("chat-msg")).toHaveCount(3, { timeout: 20_000 });
  const rows2 = count(`select count(*) from session_messages where session_id='${s.id}'`);
  rec({ t: "reconnect-tech", rows2, consoleMsgs: await page.getByTestId("chat-msg").count() });
  expect(rows2).toBe(3);

  // 4426: aynı kullanıcının belirteçsiz ikinci konsol sekmesi; canlı sekme düşmemeli
  const old = await tech.newPage();
  await old.addInitScript(wsHook, { strip: "/ws/tech" });
  await old.goto(`/sessions/${s.id}/console`);
  await expect(old.getByTestId("console-ended")).toBeVisible({ timeout: 20_000 });
  const endedText = await old.getByTestId("console-ended").textContent();
  const closes = await old.evaluate(() => (window as any).__close);
  const reloadBtn = await old.getByTestId("console-reload").isVisible();
  await old.screenshot({ path: `${IMG}/konsol-4426-1280.png` });
  await themes(old, "konsol-4426", '[data-testid="console-ended"]');
  await old.setViewportSize({ width: 390, height: 844 });
  rec({ t: "4426", closes, endedText, reloadBtn, overflow390: await overflow(old) });
  await old.close();
  await page.waitForTimeout(1500);
  const liveStill = await page.getByTestId("console-status").textContent();
  await page.getByTestId("chat-input").fill("T3 4426 sonrası canlı");
  await page.keyboard.press("Enter");
  await expect(g.getByTestId("chat-msg").last()).toHaveText("T3 4426 sonrası canlı", { timeout: 15_000 });
  rec({ t: "4426-live", liveStill });
  expect(closes).toContain(4426);
  await ctx.close();
});

test("3 oturum detayı sohbet + session.chat_viewed audit", async () => {
  await api(tech, "POST", `/sessions/${sid}/terminate`, {});
  const auditQ = `select count(*) from audit_logs where action='session.chat_viewed' and entity_id='${sid}'`;
  const before = count(auditQ);
  await page.goto(`/history/${sid}`);
  const sec = page.getByTestId("section-chat");
  await expect(sec).toBeVisible();
  const afterOpen = count(auditQ);
  const btnText = await sec.getByTestId("hchat-show").textContent();
  await sec.getByTestId("hchat-show").click();
  await expect(sec.getByTestId("hchat-msg").first()).toBeVisible();
  const msgs = await sec.getByTestId("hchat-msg").count();
  const afterShow = count(auditQ);
  await themes(page, "gecmis-sohbet", '[data-testid="section-chat"]');
  await page.reload();
  await page.getByTestId("section-chat").getByTestId("hchat-show").click();
  await expect(page.getByTestId("hchat-msg").first()).toBeVisible();
  const afterSecond = count(auditQ);
  const nv = sql(`select new_value from audit_logs where action='session.chat_viewed' and entity_id='${sid}' limit 1`);
  const summary = sql(`select new_value from audit_logs where action='session.chat_summary' and entity_id='${sid}' limit 1`);
  await page.setViewportSize({ width: 390, height: 844 });
  const of390 = await overflow(page);
  await page.screenshot({ path: `${IMG}/gecmis-sohbet-390-light.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  rec({ t: "history", before, afterOpen, btnText, msgs, afterShow, afterSecond, nv, summary, of390 });
  expect(afterOpen).toBe(before);
  expect(afterShow).toBe(before + 1);
  expect(afterSecond).toBe(afterShow);
  // Audit ekranı
  await page.goto(`/audit`);
  await page.waitForLoadState("networkidle");
  const body = await page.locator("main").innerText();
  rec({ t: "audit-screen", hasChatViewed: /sohbet/i.test(body), snippet: body.split("\n").filter((l) => /sohbet/i.test(l)).slice(0, 5) });
  await page.screenshot({ path: `${IMG}/audit-1280.png`, fullPage: false });
});

test("4 eski istemci: belirteçsiz misafir (iki taraf)", async ({ browser }) => {
  const s = await newSession();
  await page.goto(`/sessions/${s.id}/console`);
  const { ctx, g } = await guestJoin(browser, s.link, true);
  await expect(page.getByTestId("chat-outdated")).toHaveText("Müşterinin istemcisi eski; sohbet için güncellemesi gerekir.", { timeout: 15_000 });
  const techInputDisabled = await page.getByTestId("chat-input").isDisabled();
  let guestUnavailable = false;
  try {
    await expect(g.getByTestId("chat-unavailable")).toBeVisible({ timeout: 10_000 });
    guestUnavailable = true;
  } catch {}
  const guestInput = (await g.getByTestId("chat-input").count()) ? await g.getByTestId("chat-input").isDisabled() : "yok";
  // DC kurulması için paylaşım başlat (bildirim DC'den)
  if (await g.getByTestId("share-start").count()) await g.getByTestId("share-start").click();
  await page.waitForTimeout(6000);
  const dc = await g.evaluate(() => (window as any).__dc);
  const chatFrames = await g.evaluate(() => (window as any).__in.filter((x: string) => String(x).startsWith("chat.")));
  const rows = count(`select count(*) from session_messages where session_id='${s.id}'`);
  await themes(page, "konsol-eski-istemci", '[data-testid="chat-panel"]');
  await themes(g, "misafir-eski-istemci");
  rec({ t: "legacy-guest", techInputDisabled, guestUnavailable, guestInput, dcChatFrames: dc.length, dcNotice: dc.map((x: string) => x.slice(0, 160)), wsChatFramesToGuest: chatFrames, rows });
  await ctx.close();
  await api(tech, "POST", `/sessions/${s.id}/terminate`, {});
  const summary = sql(`select new_value from audit_logs where action='session.chat_summary' and entity_id='${s.id}' limit 1`);
  rec({ t: "legacy-summary", summary });
  await page.goto(`/history/${s.id}`);
  const legacyText = (await page.getByTestId("hchat-legacy").count()) ? await page.getByTestId("hchat-legacy").textContent() : null;
  rec({ t: "legacy-history", legacyText });
  expect(techInputDisabled).toBe(true);
  expect(chatFrames).toEqual([]);
  expect(rows).toBe(0);
});
