import { expect, test } from "@playwright/test";
import { agentSend, startFakeAgent } from "./fake-agent";
import { axeScan, desktopOnly, guardConsole, newSession, signIn } from "./helpers";

// P33 K0 (mimari-p33 §4.2, §6 dosya planı, §11): sahte Mac misafiri — `rs.cap.voice1` bildiren AGENT; web işletim sistemini
// bilmez, ses yalnız yetenekle açılır (AC-541). Pencere modu Windows'la aynı `WGC` belirteci; etiket platform-nötr (AC-552).
// Windows'un AC-248 / AC-379 e2e'leri ayrı dosyalarda değişmeden kalır (D-P33-2: yalnız etiket metni).
guardConsole();

test("AC-541 + AC-552: sahte Mac misafiri (voice1) → 'Sesli görüşme' etkin; pencere modunda nötr rozet, monitör seçici yok, 'WGC' metni yok", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p33mac");
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  const a = await startFakeAgent(browser, id, ["rs.cap.voice1"]);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");

  // AC-541: yetenek var → ses düğmesi etkin (eski istemcinin 'unsupported' görünümü değil)
  await expect(page.getByTestId("voice-controls")).toHaveAttribute("data-view", "idle");
  await expect(page.getByTestId("voice-call")).toBeEnabled();

  // AC-552: pencere modu (Mac SCK da `WGC` belirtecini kullanır)
  await agentSend(a, { t: "share.state", state: "sharing", method: "WGC" });
  const mode = page.getByTestId("stage-share-mode");
  await expect(mode).toBeVisible({ timeout: 2_000 });
  await expect(mode).toContainText("Pencere paylaşımı");
  await expect(mode).toHaveAttribute("title", "Müşteri yalnız bir pencereyi paylaşıyor (Pencere yakalama)");
  await expect(mode).not.toContainText("WGC");
  const menu = page.getByTestId("stage-view-menu");
  if (!(await menu.evaluate((d: HTMLDetailsElement) => d.open))) await menu.locator("summary").click();
  await expect(page.getByTestId("monitor-picker")).toHaveCount(0);
  await page.keyboard.press("Escape");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    expect(await axeScan(page, '[data-testid="stage-tools"]'), `stage-tools ${scheme}`).toEqual([]);
  }

  await agentSend(a, { t: "share.state", state: "stopped", reason: "WINDOW_CLOSED", method: "WGC" });
  const reason = page.getByTestId("stage-share-reason");
  await expect(reason).toHaveText("Neden: Paylaşılan pencere kapatıldı — Pencere yakalama", { timeout: 2_000 });
  await expect(reason).not.toContainText("WGC");
  await expect(reason).not.toContainText("Windows");
  await expect(mode).toHaveCount(0);
  await a.close();
});
