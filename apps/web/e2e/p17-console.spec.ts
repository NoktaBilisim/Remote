import { expect, test, type Browser, type Page } from "@playwright/test";
import { agentSend, startFakeAgent } from "./fake-agent";
import { axeScan, desktopOnly, guardConsole, newSession, signIn } from "./helpers";

// P17 konsol (AC-248 "teknisyen konsolunda mod görünür", AC-234 pencere nedenleri). Sahte istemci: e2e/fake-agent.ts,
// mock-ws.mjs `share.state` reason/method'u sunucu gibi aynen iletir.
guardConsole();

async function liveAgent(page: Page, browser: Browser) {
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  const a = await startFakeAgent(browser, id);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  return a;
}

async function openViewMenu(p: Page) {
  const m = p.getByTestId("stage-view-menu");
  if (!(await m.evaluate((d: HTMLDetailsElement) => d.open))) await m.locator("summary").click();
}

test("AC-248: pencere modu (WGC) konsolda 'Pencere paylaşımı' olarak görünür; DXGI'da rozet yok; kapanınca Türkçe neden", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p7");
  const a = await liveAgent(page, browser);
  const mode = page.getByTestId("stage-share-mode");
  // Tüm ekran (fake-agent: iki monitör, yöntemsiz) → rozet yok, monitör seçici var
  await expect(mode).toHaveCount(0);
  await openViewMenu(page);
  await expect(page.getByTestId("monitor-picker")).toBeVisible();

  await agentSend(a, { t: "share.state", state: "sharing", method: "WGC" });
  await expect(mode).toBeVisible({ timeout: 2_000 });
  await expect(mode).toContainText("Pencere paylaşımı");
  await expect(mode).toHaveAttribute("data-method", "WGC");
  await expect(mode).toHaveAttribute("title", "Müşteri yalnız bir pencereyi paylaşıyor (Pencere yakalama (WGC))");
  // Pencere modunda monitör geçişi yok (istemci monitor.request'i yok sayar) → seçici gizlenir
  await openViewMenu(page);
  await expect(page.getByTestId("monitor-picker")).toHaveCount(0);
  await page.keyboard.press("Escape");

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    expect(await axeScan(page, '[data-testid="stage-tools"]'), `stage-tools ${scheme}`).toEqual([]);
  }

  // Diğer yöntemlerde mevcut davranış: rozet yok
  await agentSend(a, { t: "share.state", state: "sharing", method: "DXGI" });
  await expect(mode).toHaveCount(0);

  await agentSend(a, { t: "share.state", state: "sharing", method: "WGC" });
  await expect(mode).toBeVisible();
  await agentSend(a, { t: "share.state", state: "stopped", reason: "WINDOW_CLOSED", method: "WGC" });
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "stopped");
  await expect(page.getByTestId("stage-share-reason")).toHaveText("Neden: Paylaşılan pencere kapatıldı — Pencere yakalama (WGC)", {
    timeout: 2_000,
  });
  await expect(mode).toHaveCount(0);
  await a.close();
});

// K12 (mimari-p27 §4.6): gözetimsiz odada (hello.unattended; sahte WS bu alanı üretmez → routeWebSocket ile eklenir) sahne
// "Cihaz bağlanıyor…" der, müşteri/kod metni ve üst bardaki kod alanları yok. Katılımlı bekleme aynı kalır.
test("K12: gözetimsiz konsol bekleme — 'Cihaz bağlanıyor…', kod alanları yok; katılımlıda değişmedi", async ({ page, context }) => {
  await signIn(context, "p7");
  const { id: plain } = await newSession(page);
  await page.goto(`/sessions/${plain}/console`);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  await expect(page.getByTestId("stage")).toContainText("Müşteri bekleniyor");
  await expect(page.getByTestId("console-verify-code")).toBeVisible();
  await expect(page.getByTestId("console-left")).toBeVisible();

  await page.routeWebSocket(/\/ws\/tech/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const o = JSON.parse(String(m)) as { t: string; unattended?: unknown };
      if (o.t === "hello") o.unattended = { deviceId: "01JDVP2700000000000000000A", deviceName: "MUHASEBE-PC", consentMode: "no_user" };
      ws.send(JSON.stringify(o));
    });
    ws.onMessage((m) => server.send(m));
  });
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("console-unattended")).toBeVisible();
  await expect(page.getByTestId("console-guest")).toHaveText("MUHASEBE-PC");
  await expect(page.getByTestId("stage-unattended-wait")).toContainText("Cihaz bağlanıyor…");
  await expect(page.getByTestId("stage")).not.toContainText("Müşteri bekleniyor");
  await expect(page.getByTestId("stage")).not.toContainText("Doğrulama kodu");
  await expect(page.getByTestId("console-verify-code")).toHaveCount(0);
  await expect(page.getByTestId("console-left")).toHaveCount(0);
  expect(await axeScan(page)).toEqual([]);
});
