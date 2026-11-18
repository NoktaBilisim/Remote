import { LEGACY_CHAT_NOTICE } from "@remote/contracts/chat";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { agentCtl, agentCtlSend, startFakeAgent } from "./fake-agent";
import { axeScan, desktopOnly, guardConsole, newSession, noHorizontalOverflow, scanThemes, signIn } from "./helpers";

// P22 oturum sohbeti (mimari-p22 §8; AC-264, AC-291, AC-292). Sahte API + sahte WS (e2e/mock-p22.mjs, mock-ws.mjs).
guardConsole();

const MOCK = "http://127.0.0.1:4217";
const tok = (ch: string) => `/session/${ch.repeat(43)}`;
const RICH = "01JHXST0000000000000000000";
const LEGACY_ID = "01JHXST0000000000000000004";
const ERROR_ID = "01JHXST0000000000000000006";
const ANON = "01JHXSTAN0N000000000000048";

async function fillJoin(g: Page) {
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill("Ayşe Yılmaz");
  await g.getByTestId("guest-consent").check();
}

for (const scheme of ["light", "dark"] as const) {
  test(`AC-292 (web): saklama satırı onay düğmesinin hemen önceki kardeşi; satırsız düğme pasif (${scheme})`, async ({ page }, info) => {
    // Karşılama formu masaüstü tarayıcıda çizilir (mobil cihaz algısı ayrı ekran); 390 px dar pencere ile denenir
    desktopOnly(info.project.name);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(tok("A"));
    await fillJoin(page);
    const line = page.getByTestId("chat-retention-notice");
    await expect(line).toHaveText("Sohbet mesajları kayıt altına alınır ve 90 gün saklanır");
    const prevIsLine = await page
      .getByTestId("join-browser")
      .evaluate((b) => b.previousElementSibling?.getAttribute("data-testid") === "chat-retention-notice");
    expect(prevIsLine).toBe(true);
    await expect(page.getByTestId("join-browser")).toBeEnabled();
    const lineId = await line.getAttribute("id");
    expect(await page.getByTestId("join-browser").getAttribute("aria-describedby")).toContain(lineId);
    await noHorizontalOverflow(page);
    expect(await axeScan(page)).toEqual([]);

    // chatRetentionDays yok → satır çizilmez, ad + onay olsa da tarayıcı yolu pasif
    await page.goto(tok("Q"));
    await fillJoin(page);
    await expect(page.getByTestId("chat-retention-notice")).toHaveCount(0);
    await expect(page.getByTestId("join-browser")).toBeDisabled();
  });
}

/** Konsol + tarayıcı misafir: katıl → kabul (sohbet WS'ten; paylaşım gerekmez). */
async function liveBrowser(page: Page, browser: Browser) {
  const s = await newSession(page);
  await page.goto(`/sessions/${s.id}/console`);
  const ctx = await browser.newContext();
  const g = await ctx.newPage();
  await g.goto(new URL(s.link).pathname);
  await fillJoin(g);
  await g.getByTestId("join-browser").click();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
  await page.getByTestId("admit-input").fill(code);
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  return { g, ctx, id: s.id };
}

test("AC-264: tarayıcı misafir ↔ konsol sohbeti sunucudan (WS); ret → Tekrar dene; saklama notu iki tarafta", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p5");
  const { g, ctx, id } = await liveBrowser(page, browser);
  await expect(page.getByTestId("chat-input")).toBeEnabled();
  await expect(g.getByTestId("chat-input")).toBeEnabled();
  await expect(page.getByTestId("chat-stored-note")).toHaveText("Sohbet kayıt altına alınır ve oturum saklama süresi boyunca saklanır.");
  await expect(g.getByTestId("chat-stored-note")).toContainText("90 gün saklanır");

  await page.getByTestId("chat-input").fill("Merhaba, ekranınızı görüyorum.");
  await page.keyboard.press("Enter");
  await expect(g.getByTestId("chat-msg")).toHaveText(["Merhaba, ekranınızı görüyorum."]);
  await expect(page.locator('li[data-status="sent"]')).toHaveCount(1);

  const xss = `<img src=x onerror="window.__rsXss=1">`;
  await g.getByTestId("chat-input").fill(xss);
  await g.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-msg").last()).toHaveText(xss);
  await expect(page.getByTestId("chat-log").locator("img")).toHaveCount(0);

  // Sunucu reddi (sahte: "#reddet" ilk gönderim internal) → gönderilemedi + Tekrar dene (aynı clientMsgId) → onay
  await page.getByTestId("chat-input").fill("Bu #reddet mesajı");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("chat-failed")).toBeVisible();
  await scanThemes(page, '[data-testid="chat-panel"]', "konsol sohbet gönderilemedi");
  await page.getByTestId("chat-retry").click();
  await expect(page.getByTestId("chat-failed")).toHaveCount(0);
  await expect(g.getByTestId("chat-msg")).toHaveCount(3);
  const log = (await (await page.request.get(`${MOCK}/__e2e/chat-log/${id}`)).json()) as { sender: string }[];
  expect(log.map((x) => x.sender)).toEqual(["TECH", "CUSTOMER", "TECH"]);

  await scanThemes(page, '[data-testid="chat-panel"]', "konsol sohbet dolu");
  await page.setViewportSize({ width: 390, height: 860 });
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await noHorizontalOverflow(page);
  await g.setViewportSize({ width: 390, height: 860 });
  await noHorizontalOverflow(g);
  await scanThemes(g, '[data-testid="guest-collab"]', "misafir sohbet");
  await ctx.close();
});

test("AC-264 eski istemci: konsolda 'istemci eski' + giriş pasif; DC chat gösterilmez; sabit bildirim 1 kez", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p7");
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  const a = await startFakeAgent(browser, id); // belirteçsiz (≤ 0.20.x gibi)
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect(page.getByTestId("chat-outdated")).toHaveText("Müşterinin istemcisi eski; sohbet için güncellemesi gerekir.");
  await expect(page.getByTestId("chat-input")).toBeDisabled();
  // Kabulden sonra DC açılınca tek sabit bildirim (yalnız sahip)
  await expect.poll(async () => (await agentCtl(a)).filter((m) => m.t === "chat").length, { timeout: 15_000 }).toBe(1);
  const [notice] = (await agentCtl(a)).filter((m) => m.t === "chat");
  expect(notice?.text).toBe(LEGACY_CHAT_NOTICE);
  // Eski istemcinin DC sohbeti panelde görünmez; 60 sn dolmadan yeni bildirim yok
  await agentCtlSend(a, { t: "chat", id: "x1", text: "müşteri yazdı", ts: Date.now() });
  await page.waitForTimeout(800);
  await expect(page.getByTestId("chat-msg")).toHaveCount(0);
  expect((await agentCtl(a)).filter((m) => m.t === "chat")).toHaveLength(1);
  await scanThemes(page, '[data-testid="collab-side"]', "konsol eski istemci");
  await page.setViewportSize({ width: 390, height: 860 });
  await noHorizontalOverflow(page);
  await a.context().close();
});

test("K-P22-8 gözetimsiz oda: sohbet sekmesi pasif bilgi", async ({ page, context, browser }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p7");
  await page.routeWebSocket(/\/ws\/tech/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const o = JSON.parse(String(m)) as { t: string; unattended?: unknown };
      if (o.t === "hello") o.unattended = { deviceId: "01JDEV0000000000000000000A", deviceName: "AKTIF-PC", consentMode: "silent", intervene: true };
      ws.send(JSON.stringify(o));
    });
    ws.onMessage((m) => server.send(m));
  });
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  const a = await startFakeAgent(browser, id, ["rs.cap.schat1"]);
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect(page.getByTestId("chat-unattended")).toHaveText("Gözetimsiz bağlantıda sohbet yoktur.");
  await expect(page.getByTestId("chat-input")).toHaveCount(0);
  await scanThemes(page, '[data-testid="collab-side"]', "konsol gözetimsiz");
  await a.context().close();
});

async function historyAs(context: BrowserContext, page: Page, scenario: string, id: string) {
  await signIn(context, scenario);
  await page.goto(`/history/${id}`);
  await expect(page.getByTestId("detail-title")).toBeVisible();
}

test("AC-264 oturum detayı: yetkili sohbeti açar (audit tıklamayla), okunamayan mesaj, daha fazla; 5 durum", async ({ page, context }) => {
  await historyAs(context, page, "hc", RICH);
  const sec = page.getByTestId("section-chat");
  await expect(sec.getByRole("heading", { name: "Sohbet" })).toBeVisible();
  const views = async (c: string) => ((await (await page.request.get(`${MOCK}/__e2e/chat-views/${c}/${RICH}`)).json()) as { views: number }).views;
  const cookie = (await context.cookies()).find((c) => c.value.startsWith("u-hc-"))!.value;
  expect(await views(cookie)).toBe(0); // sayfa açılışı audit üretmez
  await sec.getByTestId("hchat-show").click();
  await expect(sec.getByTestId("hchat-msg")).toHaveCount(3);
  await expect(sec.getByTestId("hchat-unreadable")).toHaveText("Mesaj okunamadı");
  await expect(sec.locator("img")).toHaveCount(0);
  expect(await views(cookie)).toBe(1);
  await sec.getByTestId("hchat-more").click();
  await expect(sec.getByTestId("hchat-msg")).toHaveCount(4);
  await expect(sec.getByTestId("hchat-more")).toHaveCount(0);
  expect(await views(cookie)).toBe(1); // `after` çağrısı audit yok
  await scanThemes(page, '[data-testid="section-chat"]', "oturum detayı sohbet");

  // Hata → Tekrar dene
  await page.goto(`/history/${ERROR_ID}`);
  await page.getByTestId("hchat-show").click();
  await expect(page.getByTestId("hchat-error")).toBeVisible();
  await page.getByTestId("hchat-retry").click();
  await expect(page.getByTestId("hchat-msg")).toHaveCount(2);
  // Eski istemci / anonim / boş
  await page.goto(`/history/${LEGACY_ID}`);
  await expect(page.getByTestId("hchat-legacy")).toHaveText("Müşteri eski istemci kullandığı için bu oturumda sohbet kapalıydı");
  await page.goto(`/history/${ANON}`);
  await expect(page.getByTestId("hchat-anon")).toHaveText("Sohbet saklama süresi dolduğu için silindi");
  await page.goto("/history/01JHXST0000000000000000008");
  await expect(page.getByTestId("hchat-empty")).toHaveText("Bu oturumda sohbet yok");
  await page.setViewportSize({ width: 390, height: 860 });
  await noHorizontalOverflow(page);
});

test("AC-264 oturum detayı: sessions.view_chat yoksa sohbet bölümü yok", async ({ page, context }) => {
  await historyAs(context, page, "hu", RICH);
  await expect(page.getByTestId("section-timeline")).toBeVisible();
  await expect(page.getByTestId("section-chat")).toHaveCount(0);
});

test("AC-291: aydınlatma bandı → standart paragrafı ekle → kaydet → bant yok (genel ayarlar bandı da kalkar)", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p22ct");
  await page.goto("/settings/general");
  await expect(page.getByTestId("general-chat-missing")).toBeVisible();
  await scanThemes(page, '[data-testid="general-chat-missing"]', "genel ayarlar bandı");
  await page.goto("/settings/consent-text");
  await expect(page.getByTestId("consent-form")).toHaveAttribute("data-ready", "true");
  const band = page.getByTestId("consent-chat-missing");
  await expect(band).toContainText("uçtan uca şifreli olmadığını belirtmiyor");
  await scanThemes(page, '[data-testid="consent-chat-missing"]', "aydınlatma bandı");
  await page.setViewportSize({ width: 390, height: 860 });
  await noHorizontalOverflow(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await band.getByTestId("consent-add-chat").click();
  await expect(page.getByTestId("consent-body")).toHaveValue(/Sohbet uçtan uca şifreli değildir/);
  await expect(band.getByTestId("consent-add-chat")).toHaveCount(0);
  await page.getByTestId("save-bar-save").click();
  await page.getByTestId("consent-confirm").getByTestId("consent-confirm-save").click();
  await expect(page.getByTestId("consent-version")).toHaveText("Sürüm 6");
  await expect(page.getByTestId("consent-chat-missing")).toHaveCount(0);
  await page.goto("/settings/general");
  await expect(page.getByTestId("limits-section")).toBeVisible();
  await expect(page.getByTestId("general-chat-missing")).toHaveCount(0);
});
