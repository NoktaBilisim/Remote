// P28d test-operatoru turu (sesli görüşme; web arayüzü). Geçici keşif betiği — ürün kodu değil.
// Koşu: bu dosya apps/web/e2e/, p28d-op.config.ts apps/web/ altına geçici kopyalanır →
// `./node_modules/.bin/playwright test -c p28d-op.config.ts` → kopyalar silinir.
// Ön koşul (elle): sahte API :4217 (e2e/mock-api.mjs) + standalone web :3217 (üretim derlemesi, NEXT_PUBLIC_RS_E2E=1).
// Ölçüm: konsol + misafir sayfasında konsol hata/uyarı/pageerror, HTTP ≥ 400, axe (bölge, açık/koyu), taşma, başlık satır
// yüksekliği, ekran görüntüsü. Sonuçlar tarama.jsonl; bulgular `expect.soft` ile (bir sapma diğer adımları durdurmaz).
import { appendFileSync, mkdirSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { axeScan, newSession, signIn } from "./helpers";

const DIR = "/Users/mennan/Projeler/Remote/docs/test-raporu/e2e/p28d/";
const KEEP = "/Users/mennan/Projeler/Remote/docs/img/p28d/";
const OUT = "/private/tmp/claude-501/-Users-mennan-Projeler-Remote/fa15848a-dcdd-4f1b-abf9-1c72703d5eac/scratchpad/p28d/img/";
mkdirSync(OUT, { recursive: true });
mkdirSync(KEEP, { recursive: true });
const MOCK = "http://127.0.0.1:4217";
const NET_OK = /^Failed to load resource: the server responded with a status of (400|401|403|404|409|410|423|429)/;
const log = (o: unknown) => appendFileSync(`${DIR}tarama.jsonl`, JSON.stringify(o) + "\n");

type W = Window & { __gum: number; __mics: MediaStreamTrack[]; __denyMic: boolean; __dropAnswer: boolean; __answers: number };

/** Mikrofon: WebAudio osilatörü (p28d-voice.spec.ts ile aynı yöntem); `__dropAnswer` = giden voice.answer çerçevesi yutulur. */
function instrument() {
  const w = window as unknown as W;
  w.__gum = 0;
  w.__mics = [];
  w.__denyMic = false;
  w.__dropAnswer = false;
  w.__answers = 0;
  const md = navigator.mediaDevices;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (c?: MediaStreamConstraints) => {
    if (!c?.audio) return orig(c);
    w.__gum++;
    if (w.__denyMic) throw new DOMException("Permission denied", "NotAllowedError");
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const dst = ctx.createMediaStreamDestination();
    osc.connect(dst);
    osc.start();
    w.__mics.push(...dst.stream.getAudioTracks());
    return dst.stream;
  };
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    if (typeof d === "string" && d.includes('"voice.answer"')) {
      w.__answers++;
      if (w.__dropAnswer) return;
    }
    return send.call(this, d);
  };
}

const issues: Record<string, string[]> = {};
function watch(p: Page, label: string) {
  const arr = (issues[label] ??= []);
  p.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !NET_OK.test(m.text())) arr.push(`${m.type()}: ${m.text()}`);
  });
  p.on("pageerror", (e) => arr.push(`pageerror: ${e.message}`));
  p.on("response", (r) => {
    if (r.status() >= 400) arr.push(`http ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
}
const flush = (t: string) => {
  for (const [k, v] of Object.entries(issues)) if (v.length) log({ t, kind: "issues", page: k, v: [...new Set(v)] });
  for (const k of Object.keys(issues)) delete issues[k];
};

const gum = (p: Page) => p.evaluate(() => (window as unknown as W).__gum);
const micsEnded = (p: Page) =>
  p.evaluate(() => {
    const ms = (window as unknown as W).__mics;
    return ms.length > 0 && ms.every((t) => t.readyState === "ended");
  });
const wsLog = async (p: Page, id: string) =>
  (await (await p.request.get(`${MOCK}/__e2e/ws-log/${id}`)).json()) as { from: string; m: Record<string, unknown> }[];
const hook = (p: Page, id: string, q: string) => p.request.get(`${MOCK}/__e2e/voice/${id}?${q}`);

async function setTheme(p: Page, c: "light" | "dark") {
  await p.evaluate((x) => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(x);
  }, c);
}

/** Açık + koyu: bölge axe, belge taşması, ekran (tam görünüm). `keep` = docs/img/p28d/ altına da kopya. */
async function themes(p: Page, sel: string, name: string, w: number, keep: ("light" | "dark")[] = []) {
  for (const c of ["light", "dark"] as const) {
    await setTheme(p, c);
    await p.mouse.move(0, 0);
    const ax = await axeScan(p, sel);
    const of = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const file = `${name}-${w}-${c}.png`;
    await p.screenshot({ path: OUT + file });
    if (keep.includes(c)) await p.screenshot({ path: KEEP + file });
    log({ kind: "view", name, w, theme: c, axe: ax, overflow: of, file });
    expect.soft(ax, `${name} ${w} ${c} axe`).toEqual([]);
    expect.soft(of, `${name} ${w} ${c} taşma`).toBeLessThanOrEqual(0);
  }
}

async function headerH(p: Page) {
  return p.locator("header").filter({ has: p.getByTestId("console-status") }).evaluate((e) => Math.round(e.getBoundingClientRect().height));
}

async function setup(browser: Browser, w: number, scenario = "p28d", rec = false) {
  const opts = { viewport: { width: w, height: 900 }, reducedMotion: "reduce" as const };
  const tctx = await browser.newContext(opts);
  await signIn(tctx, scenario);
  await tctx.addInitScript(instrument);
  const p = await tctx.newPage();
  watch(p, "konsol");
  const s = await newSession(p);
  await p.goto(`/sessions/${s.id}/console`);
  const gctx = await browser.newContext(opts);
  await gctx.addInitScript(instrument);
  const g = await gctx.newPage();
  watch(g, "misafir");
  await g.goto(new URL(s.link).pathname);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill("Ayşe Yılmaz");
  await g.getByTestId("guest-consent").check();
  if (rec) await g.getByTestId("rec-consent").check();
  await g.getByTestId("join-browser").click();
  await expect(g.getByTestId("guest-lobby")).toBeVisible();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
  await p.getByTestId("admit-input").fill(code);
  await p.getByTestId("admit-submit").click();
  await expect(p.getByTestId("console-status")).toHaveText("Aktif");
  await expect(p.getByTestId("voice-controls")).toHaveAttribute("data-view", "idle");
  return { s, p, g, tctx, gctx };
}

async function ask(p: Page, g: Page) {
  await p.getByTestId("voice-call").click();
  await expect(p.getByTestId("voice-waiting")).toBeVisible();
  await expect(g.getByTestId("voice-request")).toBeVisible();
}

for (const w of [1280, 375]) {
  test(`akış + ekranlar ${w}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const T = `akis-${w}`;
    const { s, p, g, tctx, gctx } = await setup(browser, w);
    const h0 = await headerH(p);
    await themes(p, '[data-testid="voice-controls"]', "konsol-bosta", w, w === 1280 ? ["dark"] : []);

    // İzin reddi bildirimi (en uzun metin) — 1280'de başlık tek satır kalmalı
    await p.evaluate(() => ((window as unknown as W).__denyMic = true));
    await p.getByTestId("voice-call").click();
    await expect(p.getByTestId("voice-notice")).toHaveAttribute("data-kind", "micDenied");
    const hDen = await headerH(p);
    log({ t: T, kind: "header", idle: h0, micDenied: hDen });
    if (w === 1280) expect.soft(hDen, "micDenied başlık yüksekliği").toBe(h0);
    await themes(p, '[data-testid="voice-controls"]', "konsol-mikrofon-izni-yok", w, w === 1280 ? ["light"] : []);
    await p.evaluate(() => ((window as unknown as W).__denyMic = false));

    // Çift tıklama "Sesli görüşme" → tek voice.request
    await p.getByTestId("voice-call").dblclick();
    await expect(p.getByTestId("voice-waiting")).toBeVisible();
    await expect(g.getByTestId("voice-request")).toBeVisible();
    const reqs = (await wsLog(p, s.id)).filter((x) => x.m.t === "voice.request").length;
    log({ t: T, kind: "dblclick-request", requests: reqs });
    expect.soft(reqs, "çift tıklama tek istek").toBe(1);
    log({ t: T, kind: "header", waiting: await headerH(p) });
    await themes(p, '[data-testid="voice-controls"]', "konsol-bekleniyor", w);

    // Diyalog: kilitliyken Enter/Tab ile kabul olmamalı
    const acc = g.getByTestId("voice-accept");
    const lockedAtOpen = await acc.isDisabled();
    await g.keyboard.press("Tab");
    const focusedTid = await g.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName);
    log({ t: T, kind: "dialog-lock", lockedAtOpen, focusAfterTab: focusedTid });
    expect.soft(lockedAtOpen).toBe(true);
    await themes(g, '[data-testid="voice-request"]', "misafir-diyalog", w, ["light", "dark"].filter(() => true) as ("light" | "dark")[]);
    await expect(acc).toBeEnabled({ timeout: 4000 });

    // Çift tıklama "Kabul et" → tek voice.answer, tek getUserMedia
    await acc.dblclick();
    await expect(g.getByTestId("voice-bar")).toHaveAttribute("data-mic", "on");
    await expect(p.getByTestId("voice-mic-state")).toHaveText("Mikrofon açık");
    const answers = await g.evaluate(() => (window as unknown as W).__answers);
    const ggum = await gum(g);
    log({ t: T, kind: "dblclick-accept", answers, gum: ggum });
    expect.soft(answers, "çift tıklama tek voice.answer").toBe(1);
    expect.soft(ggum, "tek getUserMedia").toBe(1);
    const hTalk = await headerH(p);
    log({ t: T, kind: "header", talking: hTalk });
    if (w === 1280) expect.soft(hTalk, "görüşmede başlık yüksekliği").toBe(h0);
    await themes(p, '[data-testid="voice-controls"]', "konsol-gorusmede", w, w === 1280 ? ["light"] : []);
    await themes(g, '[data-testid="voice-bar"]', "misafir-cubuk", w, ["light", "dark"]);

    // Sessize al (iki taraf)
    await p.getByTestId("voice-mute").click();
    await expect(p.getByTestId("voice-mic-state")).toHaveText("Sessizde");
    await g.getByTestId("voice-bar-mute").click();
    await expect(g.getByTestId("voice-bar")).toHaveAttribute("data-muted", "true");
    await themes(p, '[data-testid="voice-controls"]', "konsol-sessizde", w);
    await themes(g, '[data-testid="voice-bar"]', "misafir-cubuk-sessizde", w, w === 375 ? ["dark"] : []);
    await p.getByTestId("voice-mute").click();
    await g.getByTestId("voice-bar-mute").click();

    // Kalite paneli "Ses kaybı" (yalnız masaüstü yan panel)
    if (w === 1280) {
      await p.getByTestId("collab-side").getByRole("button", { name: "Kalite" }).click();
      await expect.soft(p.getByTestId("quality-panel")).toContainText(/Ses kaybı\s*%\d/, { timeout: 10_000 });
      await themes(p, '[data-testid="quality-panel"]', "konsol-kalite", w, ["dark"]);
    }

    // Konsol bitirir
    await p.getByTestId("voice-end").click();
    await expect(g.getByTestId("voice-bar")).toHaveCount(0);
    await expect.poll(() => micsEnded(g)).toBe(true);
    await expect.poll(() => micsEnded(p)).toBe(true);
    log({ t: T, kind: "after-end", guestText: (await g.getByTestId("voice-ended").count()) || null });

    // İkinci istek: kilit yeniden kurulmalı; Esc = Reddet
    await ask(p, g);
    expect.soft(await g.getByTestId("voice-accept").isDisabled(), "ikinci istekte kilit").toBe(true);
    await g.keyboard.press("Escape");
    await expect(g.getByTestId("voice-request")).toBeHidden();
    await expect(p.getByTestId("voice-notice")).toHaveAttribute("data-kind", "rejected");
    const hRej = await headerH(p);
    log({ t: T, kind: "header", rejected: hRej });
    await themes(p, '[data-testid="voice-controls"]', "konsol-reddedildi", w);
    expect.soft(await gum(g), "ret mikrofon açmaz").toBe(1);

    // Bekleme sürerken yenileme → sunucu RATE_LIMITED bildirimi
    await p.reload();
    await expect(p.getByTestId("voice-controls")).toHaveAttribute("data-view", "idle");
    const callDisabled = await p.getByTestId("voice-call").isDisabled();
    if (!callDisabled) {
      await p.getByTestId("voice-call").click();
      await expect.soft(p.getByTestId("voice-notice")).toHaveAttribute("data-kind", "rateLimited");
    }
    log({ t: T, kind: "reload-cooldown", callDisabled, notice: await p.getByTestId("voice-notice").getAttribute("data-kind").catch(() => null) });
    await themes(p, '[data-testid="voice-controls"]', "konsol-cok-istek", w);

    // X düğmesi = Reddet
    await hook(p, s.id, "cool");
    await p.reload();
    await expect(p.getByTestId("voice-controls")).toHaveAttribute("data-view", "idle");
    await ask(p, g);
    await g.getByTestId("voice-request").getByRole("button", { name: "Diyaloğu kapat" }).click();
    await expect.soft(p.getByTestId("voice-notice")).toHaveAttribute("data-kind", "rejected");

    // Zaman aşımı
    await hook(p, s.id, "cool");
    await p.reload();
    await expect(p.getByTestId("voice-controls")).toHaveAttribute("data-view", "idle");
    await ask(p, g);
    await hook(p, s.id, "timeout");
    await expect(g.getByTestId("voice-request")).toBeHidden();
    await expect.soft(p.getByTestId("voice-notice")).toHaveAttribute("data-kind", "timeout");
    await themes(p, '[data-testid="voice-controls"]', "konsol-yanit-yok", w);
    log({ t: T, kind: "timeout-guest", alerts: await g.getByRole("alert").allInnerTexts(), status: await g.getByRole("status").allInnerTexts() });
    await g.screenshot({ path: `${OUT}misafir-zaman-asimi-${w}.png` });
    flush(T);
    await tctx.close();
    await gctx.close();
  });
}

for (const w of [1280, 375]) {
  test(`unconfirmed + aygıt hatası ${w}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const T = `unconf-${w}`;
    const { s, p, g, tctx, gctx } = await setup(browser, w);
    await g.evaluate(() => ((window as unknown as W).__dropAnswer = true));
    await ask(p, g);
    await expect(g.getByTestId("voice-accept")).toBeEnabled({ timeout: 4000 });
    const t0 = Date.now();
    await g.getByTestId("voice-accept").click();
    const barSeen = await g.getByTestId("voice-bar").isVisible();
    const micText = barSeen ? await g.getByTestId("voice-bar-mic").innerText() : null;
    if (barSeen) await g.screenshot({ path: `${OUT}misafir-acilirken-onaysiz-${w}.png` });
    await expect(g.getByTestId("voice-unconfirmed")).toBeVisible({ timeout: 8000 });
    const dt = Date.now() - t0;
    const ended = await micsEnded(g);
    log({ t: T, kind: "unconfirmed", barSeen, micText, ms: dt, micsEnded: ended, bar: await g.getByTestId("voice-bar").count() });
    expect.soft(ended, "onaysızda mikrofon bırakılır").toBe(true);
    expect.soft(await g.getByTestId("voice-bar").count()).toBe(0);
    await themes(g, '[data-testid="voice-unconfirmed"]', "misafir-onaysiz", w, ["light"]);
    // Konsol hâlâ "Yanıt bekleniyor"; zaman aşımında misafir uyarısı kalıyor mu?
    log({ t: T, kind: "console-while-unconfirmed", view: await p.getByTestId("voice-controls").getAttribute("data-view") });
    await hook(p, s.id, "timeout");
    await expect.soft(p.getByTestId("voice-notice")).toHaveAttribute("data-kind", "timeout");
    log({ t: T, kind: "after-timeout", unconfirmedVisible: await g.getByTestId("voice-unconfirmed").isVisible() });
    // Yeni istek: uyarı + diyalog birlikte mi?
    await hook(p, s.id, "cool");
    await p.reload();
    await expect(p.getByTestId("voice-controls")).toHaveAttribute("data-view", "idle");
    await ask(p, g);
    log({ t: T, kind: "new-request", unconfirmedVisible: await g.getByTestId("voice-unconfirmed").isVisible() });
    await g.evaluate(() => ((window as unknown as W).__dropAnswer = false));
    await expect(g.getByTestId("voice-accept")).toBeEnabled({ timeout: 4000 });
    // Aygıt hatası: Kabul sonrası getUserMedia reddi
    await g.evaluate(() => ((window as unknown as W).__denyMic = true));
    await g.getByTestId("voice-accept").click();
    await expect.soft(g.getByTestId("voice-device")).toBeVisible();
    await expect.soft(p.getByTestId("voice-notice")).toHaveAttribute("data-kind", "deviceEnded");
    log({ t: T, kind: "device", unconfirmedStill: await g.getByTestId("voice-unconfirmed").isVisible(), bar: await g.getByTestId("voice-bar").count() });
    await themes(g, '[data-testid="voice-device"]', "misafir-aygit-hatasi", w);
    await themes(p, '[data-testid="voice-controls"]', "konsol-aygit-hatasi", w);
    flush(T);
    await tctx.close();
    await gctx.close();
  });
}

test("kopma: konsol kapanır / misafir yeniler (görüşmede)", async ({ browser }) => {
  test.setTimeout(120_000);
  const T = "kopma";
  // a) Misafir görüşmedeyken sayfayı yeniler
  {
    const { s, p, g, tctx, gctx } = await setup(browser, 1280);
    await ask(p, g);
    await expect(g.getByTestId("voice-accept")).toBeEnabled({ timeout: 4000 });
    await g.getByTestId("voice-accept").click();
    await expect(p.getByTestId("voice-mic-state")).toHaveText("Mikrofon açık");
    await g.reload();
    await g.waitForTimeout(3000);
    const gumAfter = await gum(g);
    const view = await p.getByTestId("voice-controls").getAttribute("data-view").catch(() => null);
    const ends = (await wsLog(p, s.id)).filter((x) => x.m.t === "voice.end").map((x) => [x.from, x.m.reason ?? null]);
    log({ t: T, kind: "guest-reload", gumAfterReload: gumAfter, consoleView: view, ends, guestBar: await g.getByTestId("voice-bar").count(), consoleMicEnded: await micsEnded(p) });
    expect.soft(gumAfter, "yenileme sonrası mikrofon açılmaz").toBe(0);
    await g.screenshot({ path: `${OUT}misafir-yenileme-sonrasi.png` });
    await p.screenshot({ path: `${OUT}konsol-misafir-yeniledi.png` });
    flush(`${T}-a`);
    await tctx.close();
    await gctx.close();
  }
  // b) Konsol görüşmedeyken sekmeyi kapatır
  {
    const { p, g, tctx, gctx } = await setup(browser, 1280);
    await ask(p, g);
    await expect(g.getByTestId("voice-accept")).toBeEnabled({ timeout: 4000 });
    await g.getByTestId("voice-accept").click();
    await expect(g.getByTestId("voice-bar")).toHaveAttribute("data-mic", "on");
    const at = Date.now();
    await p.close();
    await expect.poll(() => micsEnded(g), { timeout: 10_000 }).toBe(true);
    const ms = Date.now() - at;
    log({ t: T, kind: "console-close", guestMicEndedMs: ms, bar: await g.getByTestId("voice-bar").count(), alerts: await g.getByRole("alert").allInnerTexts() });
    await g.screenshot({ path: `${OUT}misafir-konsol-kapandi.png` });
    flush(`${T}-b`);
    await tctx.close();
    await gctx.close();
  }
});

test("Permissions-Policy başlık + featurePolicy", async ({ browser }) => {
  const ctx = await browser.newContext();
  await signIn(ctx, "p28d");
  const p = await ctx.newPage();
  watch(p, "pp");
  const s = await newSession(p);
  const paths = ["/login", "/sessions", `/sessions/${s.id}/console`, new URL(s.link).pathname, "/r", "/r/ornek-firma", "/account", "/admin/users"];
  for (const path of paths) {
    const r = await p.request.get(path, { maxRedirects: 0 });
    log({ kind: "pp-header", path, status: r.status(), pp: r.headers()["permissions-policy"] ?? null });
  }
  for (const path of [`/sessions/${s.id}/console`, "/r/ornek-firma", "/sessions"]) {
    await p.goto(path);
    const mic = await p.evaluate(() => {
      const fp = (document as unknown as { featurePolicy?: { allowsFeature: (f: string) => boolean } }).featurePolicy;
      return fp ? fp.allowsFeature("microphone") : null;
    });
    log({ kind: "pp-feature", path, url: p.url(), microphone: mic });
  }
  const gctx = await browser.newContext();
  const g = await gctx.newPage();
  await g.goto(new URL(s.link).pathname);
  const gmic = await g.evaluate(() => (document as unknown as { featurePolicy?: { allowsFeature: (f: string) => boolean } }).featurePolicy?.allowsFeature("microphone") ?? null);
  log({ kind: "pp-feature", path: "misafir", microphone: gmic });
  flush("pp");
  await ctx.close();
  await gctx.close();
});
