import { expect, test, type Browser, type Page } from "@playwright/test";
import { agentLog, agentP28, agentSend, startFakeAgent } from "./fake-agent";
import { axeScan, guardConsole, newSession, signIn } from "./helpers";

// P28a K6 konsol pano + uzaktan yazdırma (AC-343, 348, 349, 352, 404). Sahte API + sahte WS (K2 asgari taklidi, e2e/mock-ws.mjs)
// + sahte Windows istemci (özellik belirteçleri `rs.cap.clip1`, `rs.cap.print1`). u-p28-* kontrol + pano + yazdırma yetkili.
guardConsole();
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "konsol masaüstü akışı"));

const MOCK = "http://127.0.0.1:4217";
const PDF = { name: "gizli-ad-1.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n1 0 obj\n%%EOF\n") };

async function live(page: Page, browser: Browser, features: string[]) {
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  const a = await startFakeAgent(browser, id, features);
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  return { a, id };
}
async function grant(page: Page, a: Page) {
  await page.getByTestId("control-request").click();
  await expect.poll(async () => (await agentLog(a)).asked).toBe(true);
  await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
  await expect(page.getByTestId("control-release")).toBeVisible();
}
const techSent = async (p: Page, id: string) =>
  ((await (await p.request.get(`${MOCK}/__e2e/ws-log/${id}`)).json()) as { from: string; m: { t: string; pid?: string } }[])
    .filter((x) => x.from === "tech" && (x.m.t.startsWith("print.") || x.m.t.startsWith("clip.")))
    .map((x) => x.m);

test("AC-343/348/349: neden metinleri → kontrol izni → pano anahtarı → yazdır → yanıtsız → 30 sn bekleme; axe 0", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, "p28");
  const { a, id } = await live(page, browser, ["rs.cap.clip1", "rs.cap.print1"]);
  const panel = page.getByTestId("clip-print");
  await expect(panel.getByRole("heading", { name: "Pano ve yazdırma" })).toBeVisible();
  // Kontrol izni yok: pano VE yazdırma pasif (r2 Y-P28a-1)
  await expect(page.getByTestId("clip-push")).toBeDisabled();
  await expect(page.getByTestId("clip-reason")).toHaveText("Önce uzaktan kontrol izni alın");
  await expect(page.getByTestId("print-pick")).toBeDisabled();
  await expect(page.getByTestId("print-reason")).toHaveText("Önce uzaktan kontrol izni alın");
  await expect(page.getByTestId("clip-push")).toHaveAttribute("aria-describedby", /.+/);

  await grant(page, a);
  // Kısmi: yazdırma hazır, pano müşteri anahtarını bekliyor
  await expect(page.getByTestId("clip-reason")).toHaveText("Müşteri pano paylaşımına izin vermedi");
  await expect(page.getByTestId("print-pick")).toBeEnabled();
  await agentSend(a, { t: "clip.consent", on: true });
  await expect(page.getByTestId("clip-pull")).toBeEnabled();
  await expect(page.getByTestId("clip-reason")).toHaveCount(0);
  expect(await axeScan(page, '[data-testid="clip-print"]')).toEqual([]);

  // Yazdır → misafire print.request (ad WS'de yok) → müşteri yanıt vermedi
  await page.getByTestId("print-input").setInputFiles(PDF);
  await expect.poll(() => agentP28(a)).toContain("print.request");
  const req = (await techSent(page, id)).find((m) => m.t === "print.request")!;
  expect(JSON.stringify(req)).not.toContain("gizli-ad");
  await expect(page.getByTestId("print-row")).toHaveAttribute("data-phase", "requested");
  await agentSend(a, { t: "print.report", pid: req.pid, decision: "TIMEOUT", result: "TIMEOUT", sizeBytes: PDF.buffer.length });
  await expect(page.getByTestId("print-status")).toHaveText("Müşteri yanıt vermedi");
  await expect(page.getByTestId("print-pick")).toBeDisabled();
  await expect(page.getByTestId("print-reason")).toContainText("sn sonra tekrar deneyin");
});

test("AC-348: PDF olmayan dosya reddedilir; Vazgeç print.cancel gönderir; kontrol kapanınca iptal metni", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, "p28");
  const { a, id } = await live(page, browser, ["rs.cap.clip1", "rs.cap.print1"]);
  await grant(page, a);
  await page.getByTestId("print-input").setInputFiles({ name: "not.pdf", mimeType: "application/pdf", buffer: Buffer.from("merhaba") });
  await expect(page.getByTestId("print-error")).toHaveText("Yalnız PDF dosyası yazdırılabilir");
  expect(await techSent(page, id)).toEqual([]);

  await page.getByTestId("print-input").setInputFiles(PDF);
  await expect(page.getByTestId("print-error")).toHaveCount(0);
  await expect(page.getByTestId("print-row")).toHaveAttribute("data-phase", "requested");
  await page.getByTestId("print-cancel").click();
  await expect(page.getByTestId("print-status")).toHaveText("Yazdırma iptal edildi");
  await expect.poll(async () => (await techSent(page, id)).map((m) => m.t)).toContain("print.cancel");

  // İkinci iş; müşteri kontrolü kapatır → "Kontrol izni kapandı, yazdırma iptal edildi"
  await page.getByTestId("print-input").setInputFiles(PDF);
  await expect(page.getByTestId("print-row")).toHaveAttribute("data-phase", "requested");
  await agentSend(a, { t: "control.state", state: "VIEW", source: "UI" });
  await expect(page.getByTestId("print-status")).toHaveText("Kontrol izni kapandı, yazdırma iptal edildi");
  await expect(page.getByTestId("print-reason")).toHaveText("Önce uzaktan kontrol izni alın");
});

test("AC-352: eski istemci (özellik bildirmez) → destek yok metni; 390 px açık temada axe 0", async ({ page, context, browser }) => {
  await signIn(context, "p28");
  await context.addCookies([{ name: "rs_theme", value: "light", domain: "localhost", path: "/" }]);
  await page.setViewportSize({ width: 390, height: 900 });
  const { a } = await live(page, browser, []);
  await grant(page, a);
  const msg = "Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin";
  await expect(page.getByTestId("clip-reason")).toHaveText(msg);
  await expect(page.getByTestId("print-reason")).toHaveText(msg);
  const box = (await page.getByTestId("clip-print").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await axeScan(page, '[data-testid="clip-print"]')).toEqual([]);
});
