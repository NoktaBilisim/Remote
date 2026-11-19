import { expect, test, type Browser, type Page } from "@playwright/test";
import { agentCtl, agentLog, agentSend, startFakeAgent } from "./fake-agent";
import { axeScan, guardConsole, newSession, signIn } from "./helpers";

// P7 konsol uzaktan kontrol (AC-43, 47–51, 99, 105, 115, 116). Sahte API + sahte WS + sahte Hızlı Destek istemcisi
// (e2e/fake-agent.ts, gerçek WebRTC + input DC). Senaryo çerezleri: u-p7-* remote_control.use yetkili, u-p7np-* yetkisiz.
// P7 düzeltme 1 (§3.3 K1–K4, S7-1/S7-2, QA-P7-6): bırak = control.release, Vazgeç = control.cancel, istenmemiş izin, monitor.denied.
guardConsole();
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "konsol masaüstü akışı"));

const MOCK = "http://127.0.0.1:4217";

async function liveAgent(page: Page, browser: Browser) {
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting"); // teknisyen WS hello aldı
  const a = await startFakeAgent(browser, id);
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  await expect
    .poll(() => page.getByTestId("console-video").evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);
  return { a, id };
}

const req = (p: Page) => p.getByTestId("control-request");
/** 1280 px'te monitör / görünüm araçları "Görünüm" menüsünde (TEST-P7-2). */
async function openViewMenu(p: Page) {
  const m = p.getByTestId("stage-view-menu");
  if (!(await m.evaluate((d: HTMLDetailsElement) => d.open))) await m.locator("summary").click();
}
const note = (p: Page) => p.getByTestId("control-note");
/** Müşteri "İzin ver"e basar — ancak istek ona ulaştıktan sonra (gerçek kullanıcı gibi; QA-P8b-13 yarışı). */
const grant = async (a: Page) => {
  await expect.poll(async () => (await agentLog(a)).asked).toBe(true);
  await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
};
const inputs = async (a: Page) => (await agentLog(a)).inputs;
/** Teknisyenin sahte sunucuya gönderdiği kontrol mesajları (sırayla). */
const techSent = async (p: Page, id: string) =>
  ((await (await p.request.get(`${MOCK}/__e2e/ws-log/${id}`)).json()) as { from: string; m: { t: string } }[])
    .filter((x) => x.from === "tech" && x.m.t.startsWith("control."))
    .map((x) => x.m.t);

async function clickVideo(p: Page, fx = 0.5, fy = 0.5) {
  const b = (await p.getByTestId("console-video").boundingBox())!;
  // object-contain: 16:9 içerik kutuda ortalanır
  const s = Math.min(b.width / 1280, b.height / 720);
  const w = 1280 * s;
  const h = 720 * s;
  await p.mouse.click(b.x + (b.width - w) / 2 + w * fx, b.y + (b.height - h) / 2 + h * fy);
}

test("AC-47/48/49/99/50: kontrol iste → izin → fare/klavye input DC'ye → bırak/devam → müşteri kapatır", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, "p7");
  const { a, id } = await liveAgent(page, browser);
  await expect(req(page)).toBeEnabled();
  await expect(req(page)).toHaveText("Kontrol iste");
  await expect(note(page)).toHaveText("Şu an yalnız görüntüleme");
  await expect(page.getByTestId("console-control")).toHaveCount(0); // P4 pasif düğmesi yalnız tarayıcı modunda

  // Araç şeridi görüntünün üstünü kapatmaz (P5 görsel bulgu)
  const tools = (await page.getByTestId("stage-tools").boundingBox())!;
  const view = (await page.getByTestId("stage-view").boundingBox())!;
  expect(tools.y + tools.height).toBeLessThanOrEqual(view.y + 1);

  await req(page).click();
  // AC-47 metni birebir (QA-P7-6); açıklama alt satırda
  await expect(req(page)).toHaveText("Kontrol bekleniyor");
  await expect(req(page)).toBeDisabled();
  await expect(note(page)).toHaveText("Müşterinin onayı bekleniyor; şu an yalnız görüntüleme");
  await expect(page.getByTestId("control-cancel")).toHaveText("Vazgeç");
  await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(1);
  // AC-47: onay gelmeden girdi yok
  await clickVideo(page);
  await page.keyboard.press("a");
  expect(await inputs(a)).toEqual([]);

  await grant(a);
  await expect(page.getByTestId("control-on")).toHaveText("Kontrol sizde");
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
  await expect(page.getByText("Müşteri kontrol izni verdi")).toBeVisible();
  await expect(page.getByTestId("control-cancel")).toHaveCount(0);
  // AC-498 r2: işaretleme kontrolde de etkin (araç seçilmedikçe girdi yakalanır)
  await expect(page.getByTestId("annot-pen")).toBeEnabled();
  await expect(page.getByTestId("annot-pen")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("stage")).toHaveAttribute("data-capture", "on");
  // TEST-P7-2 (AC-498 r2 ile güncellendi): araç çubuğu şeritte kaldığı için 1280 px'te şerit en çok iki satır
  // (araç grubu 54 + aralık 8 + düğme satırı 44 + dolgu/çizgi 17 ≈ 123 px; üç satır ≥ 160) ve görüntünün üstünü kapatmaz
  const strip = (await page.getByTestId("stage-tools").boundingBox())!;
  expect(strip.height).toBeLessThanOrEqual(140);
  expect(strip.y + strip.height).toBeLessThanOrEqual((await page.getByTestId("stage-view").boundingBox())!.y + 1);
  await expect(page.getByTestId("stage-scroll")).toHaveAttribute("role", "application");

  await clickVideo(page, 0.25, 0.75);
  await expect(page.getByTestId("stage-scroll")).toBeFocused();
  await page.keyboard.press("a");
  await page.keyboard.press("F5");
  await expect.poll(async () => (await inputs(a)).filter((m) => m.t === "k").length).toBeGreaterThanOrEqual(4);
  const got = await inputs(a);
  const down = got.find((m) => m.t === "m.btn" && m.down === true) as unknown as { x: number; y: number; b: string };
  expect(down.b).toBe("l");
  expect(Math.abs(down.x - 0.25)).toBeLessThan(0.01);
  expect(Math.abs(down.y - 0.75)).toBeLessThan(0.01);
  expect(got).toContainEqual({ t: "m.btn", b: "l", down: false, x: down.x, y: down.y });
  expect(got).toContainEqual({ t: "k", code: "KeyA", down: true, key: "a" });
  expect(got).toContainEqual({ t: "k", code: "F5", down: true });

  // Özel tuşlar: Alt+Tab
  await page.getByTestId("special-keys").locator("summary").click();
  await page.getByTestId("key-altTab").click();
  await expect.poll(async () => (await inputs(a)).filter((m) => m.t === "k" && m.code === "Tab").length).toBe(2);

  expect(await axeScan(page)).toEqual([]);

  // Ctrl+Alt+Shift → klavye yakalaması bırakılır, odak "Kontrolü bırak"a
  await clickVideo(page);
  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.keyboard.down("Shift");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");
  await expect(page.getByTestId("control-release")).toBeFocused();
  await expect.poll(async () => (await inputs(a)).some((m) => m.t === "k.release_all")).toBe(true);

  // S7-1/K1: bırak → control.release, müşteri kapısı kapanır, k.release_all kapanıştan önce; girdi gitmez
  const before = (await inputs(a)).length;
  await page.getByTestId("control-release").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "off");
  await expect.poll(async () => (await agentLog(a)).closes).toEqual(["release"]);
  expect((await agentLog(a)).gate).toBe(false);
  expect((await inputs(a)).slice(before).some((m) => m.t === "k.release_all")).toBe(true);
  expect(await techSent(page, id)).toEqual(["control.request", "control.release"]);
  await expect(page.getByTestId("control-bar")).toHaveAttribute("data-phase", "ended");
  await expect(note(page)).toHaveText(
    /^Kontrolü bıraktınız; devam etmek için müşteri yeniden onaylamalı · \d{2}:\d{2} · bu oturumda 4 istek hakkı kaldı$/,
  );
  await expect(req(page)).toHaveText("Kontrole devam");
  await expect(req(page)).toBeFocused(); // bırak düğmesi kalktı, odak kaybolmaz
  await expect(page.getByText("Kontrolü bıraktınız", { exact: false })).toHaveCount(1); // kendi bırakması bildirim üretmez (yalnız not)
  let n = (await inputs(a)).length;
  await clickVideo(page);
  await page.keyboard.press("c");
  await page.waitForTimeout(300);
  expect((await inputs(a)).length).toBe(n);
  // "Kontrole devam" = yeni istek; müşteri yeniden onaylar
  await req(page).click();
  await expect(req(page)).toHaveText("Kontrol bekleniyor");
  await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(2);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "off");
  await grant(a);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");

  // AC-50: müşteri kapatır → ≤ 1 sn içinde bildirim, girdi durur
  const t0 = Date.now();
  await agentSend(a, { t: "control.state", state: "VIEW", source: "HOTKEY" });
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "off", { timeout: 1000 });
  expect(Date.now() - t0).toBeLessThan(1500);
  await expect(note(page)).toContainText("Kontrol müşteri tarafından kısayolla kapatıldı");
  await expect(note(page)).toContainText("bu oturumda 3 istek hakkı kaldı");
  await expect(req(page)).toHaveText("Kontrol iste");
  await expect(req(page)).toBeEnabled();
  n = (await inputs(a)).length;
  await clickVideo(page);
  await page.keyboard.press("b");
  await page.waitForTimeout(300);
  expect((await inputs(a)).length).toBe(n);
  await a.context().close();
});

test("K2/S7-2: Vazgeç → control.cancel; geç izin ve istenmemiş izin yakalama başlatmaz; teknisyen yenilenince kapı kapanır", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, "p7");
  const { a, id } = await liveAgent(page, browser);
  await req(page).click();
  await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(1);
  expect(await axeScan(page)).toEqual([]);
  await page.getByTestId("control-cancel").click();
  await expect.poll(async () => (await agentLog(a)).closes).toEqual(["cancel"]);
  await expect(note(page)).toHaveText(/^Kontrol isteğini geri çektiniz · \d{2}:\d{2} · bu oturumda 4 istek hakkı kaldı$/);
  await expect(req(page)).toHaveText("Kontrol iste");
  await expect(req(page)).toBeEnabled(); // iptal ret beklemesi başlatmaz
  await expect(req(page)).toBeFocused();

  // Müşteri vazgeçilmiş isteği geç onaylar → sunucu stale ile kapatır, konsola izin gelmez (bilerek bekleme yok)
  await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
  await expect.poll(async () => (await agentLog(a)).closes).toEqual(["cancel", "revoke:stale"]);
  expect((await agentLog(a)).gate).toBe(false);

  // Sunucu kuralını aşan istenmemiş izin: yakalama yok, konsol control.release yollar
  expect((await page.request.get(`${MOCK}/__e2e/stray-grant/${id}`)).status()).toBe(200);
  await expect.poll(() => techSent(page, id)).toEqual(["control.request", "control.cancel", "control.release"]);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "off");
  await expect(page.getByTestId("control-on")).toHaveCount(0);
  await expect(page.getByText("Müşteri kontrol izni verdi")).toHaveCount(0);
  const n = (await inputs(a)).length;
  await clickVideo(page);
  await page.keyboard.press("d");
  await page.waitForTimeout(300);
  expect((await inputs(a)).length).toBe(n);

  // K3: izin açıkken teknisyen sekmesi yenilenir → misafire control.revoke{reconnect}
  await req(page).click();
  await grant(a);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
  await page.reload();
  await expect.poll(async () => (await agentLog(a)).closes).toContain("revoke:reconnect");
  expect((await agentLog(a)).gate).toBe(false);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "off");
  await a.context().close();
});

test("K6: bekleyen istek müşteri tarafında kapanır → 'bağlantı kesildi; istek kapandı', hemen yeniden istenebilir", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, "p7");
  const { a } = await liveAgent(page, browser);
  await req(page).click();
  await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(1);
  await agentSend(a, { t: "control.state", state: "VIEW", source: "SYSTEM" });
  await expect(note(page)).toContainText("Müşteri tarafında bağlantı kesildi; istek kapandı");
  await expect(page.getByTestId("control-bar")).toHaveAttribute("data-phase", "ended");
  await expect(req(page)).toHaveText("Kontrol iste");
  await expect(req(page)).toBeEnabled(); // ret beklemesi yok
  await expect(page.getByText("Kontrol reddedildi")).toHaveCount(0);
  await req(page).click();
  await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(2);
  await a.context().close();
});

test("P28f AC-391: macOS müşteride Erişilebilirlik izni yok (OS_PERMISSION) → nötr 'uzaktan kontrole izin vermiyor (Mac'te erişilebilirlik izni)', ret değil", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, "p7");
  const { a } = await liveAgent(page, browser);
  await req(page).click();
  await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(1);
  await agentSend(a, { t: "control.state", state: "VIEW", source: "OS_PERMISSION" });
  // P28g K10 (D-P28g-K1-2): metin nötr (Linux X11 de OS_PERMISSION gönderir; konsol misafir OS'unu bilmez).
  await expect(note(page)).toContainText(
    "Müşterinin bilgisayarı uzaktan kontrole izin vermiyor (Mac'te erişilebilirlik izni). Müşteri izni verdikten sonra yeniden isteyin.",
  );
  await expect(page.getByTestId("control-bar")).toHaveAttribute("data-phase", "ended");
  await expect(page.getByText("Kontrol reddedildi")).toHaveCount(0);
  await expect(req(page)).toBeEnabled(); // 30 sn bekleme yok
  // 1280 px şeritte tam metin okunur (satır kırpması yok)
  expect(await note(page).evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await expect(page.getByText("Müşteri izni verdikten sonra yeniden isteyin.").first()).toBeVisible(); // bildirim
  expect(await axeScan(page)).toEqual([]);
  await a.context().close();
});

test("TEST-P7-1 / AC-49: %100 (kaydırılmış ve kaydırılmamış) ve Sığdır'da tık uzak piksele ±1 px", async ({ page, context, browser }) => {
  await signIn(context, "p7");
  const { a } = await liveAgent(page, browser);
  await req(page).click();
  await grant(a);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
  const lastDown = async () => {
    const d = (await inputs(a)).filter((m) => m.t === "m.btn" && m.down === true).at(-1) as unknown as { x: number; y: number };
    return [d.x * 1280, d.y * 720] as const; // sahte istemci monitörü 1280×720
  };
  const near = async (ex: number, ey: number) => {
    const n = (await inputs(a)).length;
    await expect.poll(async () => (await inputs(a)).length).toBeGreaterThan(n - 1);
    const [x, y] = await lastDown();
    expect(Math.abs(x - ex)).toBeLessThanOrEqual(1);
    expect(Math.abs(y - ey)).toBeLessThanOrEqual(1);
  };
  const clicks = async () => (await inputs(a)).filter((m) => m.t === "m.btn" && m.down === true).length;

  // Sığdır: monitör pikseli (123, 456) → ekrandaki karşılığına tık
  const b = (await page.getByTestId("console-video").boundingBox())!;
  const sc = Math.min(b.width / 1280, b.height / 720);
  let c = await clicks();
  await page.mouse.click(b.x + (b.width - 1280 * sc) / 2 + 123 * sc, b.y + (b.height - 720 * sc) / 2 + 456 * sc);
  await expect.poll(clicks).toBe(c + 1);
  await near(123, 456);

  // %100: akış küçültülmüş gelse de monitör çözünürlüğünde 1:1 çizilir
  await openViewMenu(page);
  await page.getByRole("button", { name: "%100" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("console-video")).toHaveCSS("width", "1280px");
  await expect(page.getByTestId("console-video")).toHaveCSS("height", "720px");
  const box = page.getByTestId("stage-scroll");
  const sb = (await box.boundingBox())!;
  c = await clicks();
  await page.mouse.click(sb.x + 50, sb.y + 50);
  await expect.poll(clicks).toBe(c + 1);
  await near(50, 50);
  await box.evaluate((el) => el.scrollTo(300, 200));
  await expect.poll(() => box.evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual([300, 200]);
  c = await clicks();
  await page.mouse.click(sb.x + 50, sb.y + 50);
  await expect.poll(clicks).toBe(c + 1);
  await near(350, 250);
  await a.context().close();
});

/** Sahnede (videonun içerik alanına göre oransal) sürükleme — çizim katmanı da video kutusunu kaplar. */
async function dragVideo(p: Page, from: [number, number], to: [number, number]) {
  const b = (await p.getByTestId("console-video").boundingBox())!;
  const s = Math.min(b.width / 1280, b.height / 720);
  const at = ([fx, fy]: [number, number]) =>
    [b.x + (b.width - 1280 * s) / 2 + 1280 * s * fx, b.y + (b.height - 720 * s) / 2 + 720 * s * fy] as const;
  const [x0, y0] = at(from);
  const [x1, y1] = at(to);
  await p.mouse.move(x0, y0);
  await p.mouse.down();
  await p.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await p.mouse.move(x1, y1, { steps: 4 });
  await p.mouse.up();
}
type StrokeMsg = { t: string; tool?: string; pts?: [number, number][] };
const strokes = async (a: Page) => ((await agentCtl(a)) as StrokeMsg[]).filter((m) => m.t === "annot.stroke");

test("AC-498 r2: kontrol açıkken kalemle çizim → annot.stroke; girdi kanalı susar; Esc → yakalama döner, yeni istek yok", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, "p7");
  const { a, id } = await liveAgent(page, browser);
  const stage = page.getByTestId("stage");
  await req(page).click();
  await grant(a);
  await expect(stage).toHaveAttribute("data-capture", "on");
  const pen = page.getByTestId("annot-pen");
  await pen.click();
  await expect(pen).toHaveAttribute("aria-pressed", "true");
  // Kontrol açık kalır (çerçeve + "Kontrol sizde"), yalnız girdi duraklar; özel tuşlar gizli, ipucu görünür
  await expect(stage).toHaveAttribute("data-control", "on");
  await expect(stage).toHaveAttribute("data-capture", "paused");
  await expect(page.getByTestId("control-on")).toHaveText("Kontrol sizde");
  await expect(page.getByTestId("control-release")).toBeVisible();
  await expect(note(page)).toHaveText("Çizim modu — fare ve klavye duraklatıldı");
  await expect(note(page)).toBeVisible();
  await expect(page.getByTestId("special-keys")).toHaveCount(0);
  await expect(page.getByTestId("stage-scroll")).not.toHaveAttribute("role", "application");
  // Askıya alırken takılı tuş güvencesi (k.release_all) gider; "girdi yok" sayımı ondan sonra başlar
  await expect.poll(async () => (await inputs(a)).some((m) => m.t === "k.release_all")).toBe(true);
  const before = (await inputs(a)).length;

  await dragVideo(page, [0.2, 0.2], [0.35, 0.3]);
  await page.keyboard.press("a");
  await expect.poll(async () => (await strokes(a)).length).toBe(1);
  const st = (await strokes(a))[0]!;
  expect(st.tool).toBe("pen");
  expect(Math.abs(st.pts![0]![0] - 0.2)).toBeLessThan(0.01);
  expect(Math.abs(st.pts![0]![1] - 0.2)).toBeLessThan(0.01);
  await expect(page.getByTestId("annot-layer")).toHaveAttribute("data-strokes", "1");
  expect(await axeScan(page)).toEqual([]);

  // Esc → araç kapanır, yakalama geri gelir; müşteriden yeniden onay yok, yeni control.request yok
  await page.keyboard.press("Escape");
  await expect(pen).toHaveAttribute("aria-pressed", "false");
  await expect(stage).toHaveAttribute("data-capture", "on");
  await expect(page.getByTestId("special-keys")).toBeVisible();
  // Pozitif sabit: aynı kanaldan bir tık gelir → kanal sıralı; çizim sırasındaki hiçbir şey arada değil
  await clickVideo(page, 0.6, 0.6);
  await expect.poll(async () => (await inputs(a)).slice(before).some((m) => m.t === "m.btn")).toBe(true);
  const after = (await inputs(a)).slice(before);
  expect(after.filter((m) => m.t === "k")).toEqual([]);
  const downs = after.filter((m) => m.t === "m.btn" && m.down === true) as unknown as { x: number; y: number }[];
  expect(downs).toHaveLength(1);
  expect(Math.abs(downs[0]!.x - 0.6)).toBeLessThan(0.01);
  expect(after.filter((m) => m.t === "m.move" && (m.x as number) < 0.5)).toEqual([]); // çizim yolu (0.2–0.35) gitmedi

  // Düğmeyle aç/kapa da aynı: yeni istek yok, kapı açık
  await pen.click();
  await expect(stage).toHaveAttribute("data-capture", "paused");
  await pen.click();
  await expect(stage).toHaveAttribute("data-capture", "on");
  expect(await techSent(page, id)).toEqual(["control.request"]);
  const log = await agentLog(a);
  expect(log.controlRequests).toBe(1);
  expect(log.gate).toBe(true);
  expect(log.closes).toEqual([]);
  await a.context().close();
});

test("AC-498 r2: %100 görünümde de araçlar görünür; kaydırılmış görüntüde çizim koordinatı uzak piksele denk", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, "p7");
  const { a } = await liveAgent(page, browser);
  await req(page).click();
  await grant(a);
  await openViewMenu(page);
  await page.getByRole("button", { name: "%100" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("stage")).toHaveAttribute("data-mode", "actual");
  await expect(page.getByTestId("console-video")).toHaveCSS("width", "1280px");
  const pen = page.getByTestId("annot-pen");
  await expect(pen).toBeVisible();
  await pen.click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-capture", "paused");
  // Çizim katmanı video kutusunu tam kaplar (kaydırılan kısım dahil)
  const vb = (await page.getByTestId("console-video").boundingBox())!;
  const lb = (await page.getByTestId("annot-layer").boundingBox())!;
  expect(Math.abs(lb.width - vb.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(lb.height - vb.height)).toBeLessThanOrEqual(1);
  const box = page.getByTestId("stage-scroll");
  await box.evaluate((el) => el.scrollTo(300, 200));
  await expect.poll(() => box.evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual([300, 200]);
  const sb = (await box.boundingBox())!;
  await page.mouse.move(sb.x + 50, sb.y + 50);
  await page.mouse.down();
  await page.mouse.move(sb.x + 90, sb.y + 70, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await strokes(a)).length).toBe(1);
  const [x, y] = (await strokes(a))[0]!.pts![0]!;
  // sahte istemci monitörü 1280×720: görünür (50, 50) + kaydırma (300, 200) = uzak (350, 250)
  expect(Math.abs(x * 1280 - 350)).toBeLessThanOrEqual(1);
  expect(Math.abs(y * 720 - 250)).toBeLessThanOrEqual(1);
  await a.context().close();
});

test("gözlem: kontrol açıkken müşteri koparsa neden 'Bağlantı koptu' katmanında da yazılır", async ({ page, context, browser }) => {
  await signIn(context, "p7");
  const { a } = await liveAgent(page, browser);
  await req(page).click();
  await grant(a);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
  await a.context().close();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "off");
  await expect(page.getByTestId("stage-control-ended")).toHaveText("Müşteri bağlantısı koptu; kontrol kapandı");
  expect(await axeScan(page)).toEqual([]);
});

test("TEST-P7-3: yenileme sonrası hak sayacı korunur (sunucuyla aynı 5 sınırı)", async ({ page, context, browser }) => {
  await signIn(context, "p7");
  const { a } = await liveAgent(page, browser);
  for (let i = 1; i <= 2; i++) {
    await req(page).click();
    // QA-P8b-13: önce "Kontrol bekleniyor" + Vazgeç görünür olsun, sonra istemciye ulaştığı doğrulanır
    await expect(page.getByTestId("control-cancel")).toBeVisible();
    await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(i);
    await page.getByTestId("control-cancel").click();
    await expect(page.getByTestId("control-bar")).toHaveAttribute("data-phase", "ended");
  }
  await page.reload();
  // Gerçek sunucu gibi hello guestKind taşır → Hızlı Destek misafiri, kontrol düğmesi kalır
  await expect(page.getByTestId("stage")).toHaveAttribute("data-share", "sharing");
  await expect
    .poll(() => page.getByTestId("console-video").evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(note(page)).toContainText("bu oturumda 3 istek hakkı kaldı");
  for (let i = 3; i <= 5; i++) {
    await req(page).click();
    // QA-P8b-13: önce "Kontrol bekleniyor" + Vazgeç görünür olsun, sonra istemciye ulaştığı doğrulanır
    await expect(page.getByTestId("control-cancel")).toBeVisible();
    await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(i);
    await page.getByTestId("control-cancel").click();
    await expect(page.getByTestId("control-bar")).toHaveAttribute("data-phase", "ended");
  }
  await expect(req(page)).toBeDisabled();
  await expect(note(page)).toContainText("Bu oturumda kontrol isteği hakkı doldu (5/5)");
  await a.context().close();
});

test("TEST-P7-3: yanıtsız monitör isteği 30 sn sonra düşer; bekleme bitince yeni istek iletilir", async ({ page, context, browser }) => {
  await page.clock.install();
  await signIn(context, "p7");
  const { a, id } = await liveAgent(page, browser);
  await openViewMenu(page);
  const picker = page.getByTestId("monitor-picker");
  await picker.getByRole("button", { name: "Ekran 2" }).click();
  await expect.poll(async () => (await agentLog(a)).monitorRequests).toEqual([1]);
  await expect(picker.getByRole("button", { name: "Ekran 1" })).toBeDisabled(); // bekleyen istek
  // 30 sn yanıtsız: konsol "onaylamadı" + 31 sn bekleme; sunucu bekleyeni düşürür
  await page.clock.fastForward(30_000);
  expect((await page.request.get(`${MOCK}/__e2e/age/${id}?ms=30000`)).status()).toBe(200);
  await expect(page.getByTestId("monitor-note")).toHaveText(/^Müşteri monitör değişikliğini onaylamadı · yeni istek 0:3[01] sonra$/);
  await expect(picker.getByRole("button", { name: "Ekran 2" })).toBeDisabled();
  await page.clock.fastForward(31_000);
  expect((await page.request.get(`${MOCK}/__e2e/age/${id}?ms=31000`)).status()).toBe(200);
  await expect(picker.getByRole("button", { name: "Ekran 2" })).toBeEnabled();
  await picker.getByRole("button", { name: "Ekran 2" }).click();
  await expect.poll(async () => (await agentLog(a)).monitorRequests).toEqual([1, 1]); // CONFLICT/RATE_LIMITED değil, iletildi
  await expect(page.getByTestId("monitor-note")).toHaveText("Ekran 2 için müşteri onayı bekleniyor…");
  await a.context().close();
});

test("AC-99/116: ret → 'Kontrol reddedildi', 30 sn geri sayım ve kalan istek hakkı", async ({ page, context, browser }) => {
  await signIn(context, "p7");
  const { a } = await liveAgent(page, browser);
  await req(page).click();
  await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(1);
  await agentSend(a, { t: "control.state", state: "VIEW", source: "DENIED" });
  await expect(page.getByText("Kontrol reddedildi")).toBeVisible();
  await expect(req(page)).toBeDisabled();
  await expect(req(page)).toHaveText(/^Tekrar iste \(0:(29|30)\)$/);
  await expect(note(page)).toContainText("Müşteri reddetti");
  await expect(note(page)).toContainText("bu oturumda 4 istek hakkı kaldı");
  await expect(req(page)).toHaveText(/^Tekrar iste \(0:2[0-8]\)$/, { timeout: 4000 }); // geri sayım ilerler
  await expect(page.getByTestId("control-bar")).toHaveAttribute("data-phase", "denied");
  expect(await axeScan(page)).toEqual([]);
  await a.context().close();
});

test("AC-115/G-04: yetki canlı kaldırılınca yakalama ≤ 1 sn içinde biter, girdi gitmez", async ({ page, context, browser }) => {
  await signIn(context, "p7");
  const { a, id } = await liveAgent(page, browser);
  await req(page).click();
  await grant(a);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "on");
  expect((await page.request.get(`${MOCK}/__e2e/revoke/${id}`)).status()).toBe(200);
  await expect(page.getByTestId("stage")).toHaveAttribute("data-control", "off", { timeout: 1000 });
  await expect(page.getByTestId("control-bar")).toHaveAttribute("data-phase", "ended");
  await expect(page.getByText("Kontrol sistem tarafından kapatıldı (yetki veya kayıt)").first()).toBeVisible();
  await expect.poll(async () => (await agentLog(a)).revokes).toEqual(["permission"]);
  const n = (await inputs(a)).length;
  await clickVideo(page);
  await page.waitForTimeout(300);
  expect((await inputs(a)).length).toBe(n);
  await a.context().close();
});

test("AC-51: remote_control.use yoksa 'Kontrol iste' görünmez", async ({ page, context, browser }) => {
  await signIn(context, "p7np");
  const { a } = await liveAgent(page, browser);
  await openViewMenu(page);
  await expect(page.getByTestId("monitor-picker")).toBeVisible();
  await expect(req(page)).toHaveCount(0);
  await expect(page.getByTestId("console-control")).toHaveCount(0);
  await a.context().close();
});

test("AC-43/105: monitör değişikliği müşteri onayıyla; yükseltilmiş pencere ve güvenli masaüstü uyarıları", async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, "p7");
  const { a } = await liveAgent(page, browser);
  await openViewMenu(page);
  const picker = page.getByTestId("monitor-picker");
  await expect(picker.getByRole("button", { name: "Ekran 1" })).toHaveAttribute("aria-pressed", "true");
  await picker.getByRole("button", { name: "Ekran 2" }).click();
  await expect(page.getByTestId("monitor-note")).toHaveText("Ekran 2 için müşteri onayı bekleniyor…");
  await expect.poll(async () => (await agentLog(a)).monitorRequests).toEqual([1]);
  await agentSend(a, { t: "share.state", state: "sharing", activeMonitor: 1 });
  await expect(picker.getByRole("button", { name: "Ekran 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Ekran 2 gösteriliyor")).toBeVisible();

  // K4: müşteri reddeder → 30 sn beklemeden hemen yazılır
  await picker.getByRole("button", { name: "Ekran 1" }).click();
  await expect(page.getByTestId("monitor-note")).toHaveText("Ekran 1 için müşteri onayı bekleniyor…");
  await expect.poll(async () => (await agentLog(a)).monitorRequests).toEqual([1, 0]);
  await agentSend(a, { t: "monitor.denied", monitorId: 0 });
  await expect(page.getByTestId("monitor-note")).toHaveText(/^Müşteri monitör değişikliğini reddetti · yeni istek 0:3[01] sonra$/, {
    timeout: 2000,
  });
  await expect(picker.getByRole("button", { name: "Ekran 2" })).toHaveAttribute("aria-pressed", "true");
  // K7: sunucu beklemesi (30 sn + 1 sn pay) sürerken seçim pasif, geri sayım ilerler
  await expect(picker.getByRole("button", { name: "Ekran 1" })).toBeDisabled();
  await expect(page.getByTestId("monitor-note")).toHaveText(/yeni istek 0:2\d sonra$/, { timeout: 4000 });

  // K8 / S7-9: istemci yönetici olarak çalışıyor → kalıcı uyarı rozeti (kontrolü engellemez)
  await agentSend(a, { t: "env.state", elevatedForeground: false, secureDesktop: false, selfElevated: true });
  await expect(page.getByTestId("stage-self-elevated")).toHaveText(
    "Müşteri istemcisi yönetici olarak çalışıyor — yükseltilmiş pencereler ve UAC ekranı denetlenebilir",
  );

  await agentSend(a, { t: "env.state", elevatedForeground: true, secureDesktop: false, selfElevated: true });
  await expect(page.getByTestId("stage-elevated")).toHaveText(
    "Yükseltilmiş pencere — kontrol edilemiyor. Müşteriden onaylamasını isteyin.",
  );
  await expect(page.getByTestId("stage-self-elevated")).toBeVisible();
  expect(await axeScan(page)).toEqual([]);
  await agentSend(a, { t: "env.state", elevatedForeground: false, secureDesktop: true, selfElevated: false });
  await expect(page.getByTestId("stage-elevated")).toHaveCount(0);
  await expect(page.getByTestId("stage-self-elevated")).toHaveCount(0);
  await expect(page.getByTestId("stage-secure")).toContainText("Müşteri güvenli masaüstünde");
  expect(await axeScan(page)).toEqual([]);
  await agentSend(a, { t: "env.state", elevatedForeground: false, secureDesktop: false, selfElevated: false });
  await expect(page.getByTestId("stage-secure")).toHaveCount(0);
  await a.context().close();
});
