import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { axeScan, desktopOnly, guardConsole, noHorizontalOverflow, sessionCookies, signIn } from "./helpers";

// P18 H4 panel ekranları (AC-255..258, S-P18-T3/T8). Sahte API + sahte /ws/panel: e2e/mock-p18.mjs (u-p18<rol>-<oda>).
guardConsole();
const P = {
  ME: "01JMSP1800000000000000000A",
  A: "01JRQP1800000000000000000A",
  B: "01JRQP1800000000000000000B",
  C: "01JRQP1800000000000000000C",
};
const newRoom = () => Math.random().toString(36).slice(2, 10);
const cards = (p: Page) => p.getByTestId("request-card");
const card = (p: Page, name: string) => cards(p).filter({ has: p.getByRole("heading", { name }) });
const names = (p: Page) => cards(p).getByRole("heading", { level: 3 }).allTextContents();

const signInP18 = (context: BrowserContext, role: "p18adm" | "p18usr", room: string) => sessionCookies(context, `u-${role}-${room}`);
const openSockets = async (page: Page, cookie: string) =>
  ((await (await page.request.get(`http://127.0.0.1:4217/__e2e/p18/sockets/${cookie}`)).json()) as { open: number }).open;
const hook = (page: Page, ev: string, room: string, q: string) => page.request.get(`http://127.0.0.1:4217/__e2e/p18/${ev}/${room}?${q}`);

async function scanBoth(browser: Browser, path: string, width: number, ready: (p: Page) => Promise<void>) {
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
    await signInP18(ctx, "p18adm", newRoom());
    const p = await ctx.newPage();
    await p.goto(path);
    await ready(p);
    await noHorizontalOverflow(p);
    expect(await axeScan(p), `${path} ${scheme} ${width}`).toEqual([]);
    await ctx.close();
  }
}

test("AC-257: kuyruk öncelik sırası, rozetler (öncelik, mesai dışı, atanan, SLA); öncelik değişince sıra değişir", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signInP18(context, "p18adm", newRoom());
  await page.goto("/requests");
  await expect(cards(page)).toHaveCount(4);
  await expect.poll(() => names(page)).toEqual(["Ayşe Yılmaz", "Ali Demir", "Deniz Kaya", "Hata Testi"]);
  const ali = card(page, "Ali Demir");
  await expect(ali.getByTestId("request-after-hours")).toHaveText("Mesai dışı");
  await expect(ali.getByTestId("request-priority")).toHaveAttribute("data-priority", "NORMAL");
  await expect(card(page, "Deniz Kaya").getByTestId("request-assigned")).toHaveText("Atandı: Can Usta");
  await expect(card(page, "Deniz Kaya").getByTestId("request-priority")).toContainText("Düşük");
  await expect(card(page, "Ayşe Yılmaz").getByTestId("request-sla")).toContainText("kaldı");

  await ali.getByTestId("request-menu").locator("summary").click();
  await ali.getByTestId("priority-HIGH").click();
  await expect(page.getByTestId("toast").filter({ hasText: "Öncelik değiştirildi" })).toBeVisible();
  await expect.poll(() => names(page)).toEqual(["Ali Demir", "Ayşe Yılmaz", "Deniz Kaya", "Hata Testi"]);
  await expect(ali.getByTestId("request-priority")).toContainText("Yüksek");
  // Menü ikonları §8b.8
  await ali.getByTestId("request-menu").locator("summary").click();
  await expect(ali.getByTestId("priority-HIGH")).toHaveAttribute("aria-pressed", "true");
  for (const id of ["assign-open", "assign-me"]) await expect(ali.getByTestId(id).locator("svg")).toHaveCount(1);
});

test("AC-257: SLA rozeti hedef anında kırmızı (sahte saat)", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await page.clock.install();
  const cookie = await signInP18(context, "p18adm", newRoom());
  await page.goto("/requests");
  // Soket açılınca kuyruk REST'ten tazelenir (sunucu saati ofseti o an ölçülür); sahte saat bundan sonra ilerletilir
  await expect.poll(() => openSockets(page, cookie)).toBeGreaterThanOrEqual(1);
  await page.waitForLoadState("networkidle");
  const sla = card(page, "Ayşe Yılmaz").getByTestId("request-sla");
  await expect(sla).toHaveAttribute("data-state", "ok");
  await expect(sla).toContainText(/1 dk|5\d sn|6\d sn/);
  await page.clock.fastForward("01:20");
  await expect(sla).toHaveAttribute("data-state", "breached");
  await expect(sla).toHaveText("SLA aşıldı");
});

test("AC-256: ata → çip + diğer kullanıcıda 'Atandı: <ad>'; Bana ata; atanana toast; filtreler", async ({ browser }, info) => {
  desktopOnly(info.project.name);
  const room = newRoom();
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const adm = await signInP18(ctxA, "p18adm", room);
  const usr = await signInP18(ctxB, "p18usr", room);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await a.goto("/requests");
  await b.goto("/requests");
  await expect.poll(() => openSockets(a, adm)).toBeGreaterThanOrEqual(1);
  await expect.poll(() => openSockets(b, usr)).toBeGreaterThanOrEqual(1);

  // Yetkisiz kullanıcıda atama/öncelik menüsü yok (S-P18-T3)
  await expect(card(b, "Ayşe Yılmaz").getByTestId("request-menu")).toHaveCount(0);

  const ayse = card(a, "Ayşe Yılmaz");
  await ayse.getByTestId("request-menu").locator("summary").click();
  await ayse.getByTestId("assign-open").click();
  const dlg = a.getByTestId("assign-dialog");
  await expect(dlg).toBeVisible();
  await dlg.getByTestId("assign-submit").click();
  await expect(dlg.getByText("Bir teknisyen seçin")).toBeVisible();
  await dlg.getByRole("combobox").fill("Ece");
  await a.getByRole("option", { name: "Ece Yıldız" }).click();
  await dlg.getByTestId("assign-submit").click();
  await expect(dlg).toBeHidden();
  await expect(ayse.getByTestId("request-assigned")).toHaveText("Atandı: Ece Yıldız");
  await expect(card(b, "Ayşe Yılmaz").getByTestId("request-assigned")).toHaveText("Atandı: Ece Yıldız");

  // Bana ata → kendi çipim, bildirim yok
  await ayse.getByTestId("request-menu").locator("summary").click();
  await ayse.getByTestId("assign-me").click();
  await expect(ayse.getByTestId("request-assigned")).toHaveText("Size atandı");
  await expect(a.getByTestId("toast").filter({ hasText: "Size bir talep atandı" })).toHaveCount(0);

  // Başka yöneticinin ataması → atanana toast (kod ile)
  await hook(a, "assign", room, `id=${P.B}&to=${P.ME}`);
  await expect(a.getByTestId("toast").filter({ hasText: "Size bir talep atandı — 654 321" })).toBeVisible();

  // Filtreler
  await a.getByTestId("assigned-filter").getByRole("link", { name: "Bana atanan" }).click();
  await expect(a).toHaveURL(/assigned=me/);
  await expect.poll(() => names(a)).toEqual(["Ayşe Yılmaz", "Ali Demir"]);
  await a.getByTestId("assigned-filter").getByRole("link", { name: "Atanmamış" }).click();
  await expect(a).toHaveURL(/assigned=none/);
  await expect.poll(() => names(a)).toEqual(["Hata Testi"]);
  await ctxA.close();
  await ctxB.close();
});

test("AC-256 (K-P18-3): başkasına atanmış talebi kabulde onay diyaloğu", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInP18(context, "p18adm", newRoom());
  await page.goto("/requests");
  await card(page, "Deniz Kaya").getByRole("button", { name: "Kabul et: Deniz Kaya" }).click();
  const dlg = page.getByTestId("accept-assigned-dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Bu talep Can Usta adlı teknisyene atandı. Yine de kabul etmek istiyor musunuz?");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await dlg.getByRole("button", { name: "Vazgeç" }).click();
  await expect(dlg).toBeHidden();
  await expect(card(page, "Deniz Kaya")).toBeVisible();
  await card(page, "Deniz Kaya").getByRole("button", { name: "Kabul et: Deniz Kaya" }).click();
  await page.getByTestId("accept-assigned-confirm").click();
  await expect(page).toHaveURL(/\/sessions\/.+\/console/);
});

test("AC-255: mesaj paneli — dolu (düz metin), iyimser gönderim, 429, canlı müşteri mesajı, boş, UNSUPPORTED, hata, kapanış", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  const room = newRoom();
  const cookie = await signInP18(context, "p18adm", room);
  await page.goto("/requests");
  await expect.poll(() => openSockets(page, cookie)).toBeGreaterThanOrEqual(1);
  await card(page, "Ayşe Yılmaz").getByTestId("thread-open").click();
  const panel = page.getByTestId("thread-panel");
  await expect(panel.getByTestId("thread")).toHaveAttribute("data-state", "ready");
  // S-P18-T8: gövde metin düğümü — HTML ve bağlantı yok
  const body = panel.getByTestId("thread-body").first();
  await expect(body).toHaveText("Merhaba <b>acil</b> https://kotu.example/x");
  await expect(body.locator("a, b")).toHaveCount(0);
  await expect(panel.getByTestId("thread-body").nth(1)).toHaveText("Mesaj okunamadı");

  const input = panel.getByTestId("thread-input");
  await input.fill("Birkaç dakika içinde bağlanacağım");
  await input.press("Enter");
  await expect(panel.getByTestId("thread-msg").filter({ hasText: "Birkaç dakika" })).not.toHaveAttribute("data-pending", /.+/);
  await expect(input).toHaveValue("");
  // Shift+Enter satır ekler, gönder­mez
  await input.fill("satır1");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("satır1\n");
  await input.fill("hızlı");
  await panel.getByTestId("thread-send").click();
  await expect(panel.getByTestId("thread-rate")).toHaveText(/Çok hızlı/);
  await expect(input).toHaveValue("hızlı");
  // Sayaç 1.000'de durur
  await input.fill("a".repeat(1005));
  await expect(panel.getByTestId("thread-count")).toHaveText("1.000 / 1.000");

  // Kapalı paneldeki karta müşteri mesajı → okunmamış sayısı; açık panel yeni mesajı çeker
  await hook(page, "custmsg", room, `id=${P.B}&body=Ben%20de%20bekliyorum`);
  await expect(card(page, "Ali Demir").getByTestId("thread-unread")).toHaveText("1");
  await hook(page, "custmsg", room, `id=${P.A}&body=Tamam`);
  await expect(panel.getByTestId("thread-msg").filter({ hasText: "Tamam" })).toBeVisible();

  // Boş
  await card(page, "Ali Demir").getByTestId("thread-open").click();
  await expect(panel.getByTestId("thread-msg")).toHaveCount(1);
  await expect(card(page, "Ali Demir").getByTestId("thread-unread")).toHaveCount(0);
  // UNSUPPORTED → gönder pasif
  await card(page, "Deniz Kaya").getByTestId("thread-open").click();
  await expect(panel.getByTestId("thread-unsupported")).toContainText("mesajlaşmayı desteklemiyor");
  await expect(panel.getByTestId("thread-empty")).toBeVisible();
  await expect(panel.getByTestId("thread-input")).toBeDisabled();
  // Hata → Tekrar dene
  await card(page, "Hata Testi").getByTestId("thread-open").click();
  await expect(panel.getByTestId("thread-error")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
  // Talep kapanınca salt okunur bant
  await card(page, "Ali Demir").getByTestId("thread-open").click();
  await expect(panel.getByTestId("thread-input")).toBeVisible();
  await hook(page, "remove", room, `id=${P.B}`);
  await expect(panel.getByTestId("thread-closed")).toBeVisible();
  await expect(panel.getByTestId("thread-input")).toHaveCount(0);
  await panel.getByTestId("thread-close").click();
  await expect(panel).toHaveCount(0);
});

test("AC-255 (S-P18-T3): mesaj yetkisi yoksa yazma alanı yok; mobilde diyalog", async ({ page, context }) => {
  await signInP18(context, "p18usr", newRoom());
  await page.goto("/requests");
  await card(page, "Ayşe Yılmaz").getByTestId("thread-open").click();
  const thread = page.getByTestId("thread");
  await expect(thread).toHaveAttribute("data-state", "ready");
  await expect(thread.getByTestId("thread-no-perm")).toBeVisible();
  await expect(thread.getByTestId("thread-input")).toHaveCount(0);
});

test("AC-258: mesai saatleri — önizleme, 24:00, alan hatası, kaydet; saat dilimi ve mod", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInP18(context, "p18adm", newRoom());
  await page.goto("/settings/business-hours");
  await expect(page).toHaveTitle(/Mesai saatleri/);
  await expect(page.getByTestId("settings-tabs").getByRole("link", { name: "Mesai saatleri" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("bh-preview")).toContainText("Şu an: Kapalı — sonraki açılış 16.11.2026 09:00");
  const days = page.getByTestId("bh-day");
  await expect(days).toHaveCount(7);
  await expect(days.nth(2).getByTestId("bh-day-closed")).toHaveText("Kapalı");
  // Cumartesi 10:00–24:00
  await days.nth(5).getByRole("button", { name: "Cumartesi için aralık ekle" }).click();
  await days.nth(5).getByLabel("Cumartesi 1. aralık başlangıç").fill("10:00");
  await days.nth(5).getByLabel("Cumartesi 1. aralık bitiş").fill("24:00");
  // Hatalı: Salı bitiş başlangıçtan önce
  await days.nth(1).getByLabel("Salı 1. aralık bitiş").fill("08:00");
  await page.getByTestId("bh-mode-REJECT").check();
  await expect(page.getByTestId("save-bar")).toBeVisible();
  await page.getByTestId("save-bar-save").click();
  await expect(days.nth(1).getByLabel("Salı 1. aralık bitiş")).toHaveAttribute("aria-invalid", "true");
  await days.nth(1).getByLabel("Salı 1. aralık bitiş").fill("18:00");
  await page.getByTestId("bh-form").getByRole("combobox").fill("New_York");
  await page.getByRole("option", { name: "America/New_York" }).click();
  await page.getByTestId("save-bar-save").click();
  await expect(page.getByTestId("toast").filter({ hasText: "Mesai saatleri kaydedildi" })).toBeVisible();
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("bh-day").nth(5).getByLabel("Cumartesi 1. aralık bitiş")).toHaveValue("24:00");
  await expect(page.getByTestId("bh-mode-REJECT")).toBeChecked();
  await expect(page.getByTestId("bh-preview")).toContainText("sonraki açılış 16.11.2026 01:00");
});

test("AC-258: tatiller — liste, ekle (çakışma 409), sil (onaylı), TR resmî tatillerini içe aktar", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInP18(context, "p18adm", newRoom());
  await page.goto("/settings/business-hours");
  const sec = page.getByTestId("hd-section");
  await sec.getByLabel("Yıl", { exact: true }).selectOption("2026");
  await expect(sec.getByTestId("hd-row")).toHaveCount(1);
  await expect(sec.getByTestId("hd-row")).toContainText("23 Nisan 2026 Perşembe · Tam gün kapalı");

  await sec.getByTestId("hd-add-open").click();
  const dlg = page.getByTestId("hd-add-dialog");
  await dlg.getByLabel("Tarih").fill("2026-12-31");
  await dlg.getByTestId("hd-add-submit").click();
  await expect(dlg.getByLabel("Ad")).toHaveAttribute("aria-invalid", "true");
  await dlg.getByLabel("Ad").fill("Yılsonu");
  await dlg.getByLabel("Kapanış saati (isteğe bağlı)").fill("13:00");
  await dlg.getByTestId("hd-add-submit").click();
  await expect(dlg).toBeHidden();
  await expect(sec.getByTestId("hd-row").filter({ hasText: "Yılsonu" })).toContainText("13:00'e kadar açık");
  // Aynı gün → 409 form üstü
  await sec.getByTestId("hd-add-open").click();
  await dlg.getByLabel("Tarih").fill("2026-12-31");
  await dlg.getByLabel("Ad").fill("Tekrar");
  await dlg.getByTestId("hd-add-submit").click();
  await expect(dlg).toContainText("Bu gün zaten tatil olarak ekli");
  await dlg.getByRole("button", { name: "Vazgeç" }).click();

  await sec.getByRole("button", { name: "Tatili sil: Yılsonu" }).click();
  const rm = page.getByTestId("hd-remove-dialog");
  await expect(rm.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await rm.getByTestId("hd-remove-confirm").click();
  await expect(sec.getByTestId("hd-row").filter({ hasText: "Yılsonu" })).toHaveCount(0);

  await sec.getByTestId("hd-import").click();
  await expect(page.getByTestId("toast").filter({ hasText: /tatil eklendi, 1 gün zaten vardı/ })).toBeVisible();
  await expect.poll(() => sec.getByTestId("hd-row").count()).toBeGreaterThan(10);
  // Liste olmayan yıl → düğme pasif + neden
  await sec.getByLabel("Yıl", { exact: true }).selectOption("2025");
  await expect(sec.getByTestId("hd-empty")).toBeVisible();
  await expect(sec.getByTestId("hd-import")).toBeDisabled();
});

test("AC-258: settings.view yetkili kullanıcıda mesai ekranı salt okunur", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInP18(context, "p18usr", newRoom());
  await page.goto("/settings/business-hours");
  await expect(page.getByTestId("bh-readonly")).toBeVisible();
  await expect(page.getByTestId("bh-day").first().getByRole("textbox").first()).toBeDisabled();
  await expect(page.getByTestId("hd-add-open")).toHaveCount(0);
});

test("AC-257: talep ayarlarında varsayılan öncelik ve SLA; geçersiz SLA alan hatası", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "rqadm");
  await page.goto("/settings/support-requests");
  await page.getByLabel("Varsayılan öncelik").selectOption("HIGH");
  await page.getByLabel("SLA hedefi (dakika)").fill("2");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByLabel("SLA hedefi (dakika)")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("SLA hedefi (dakika)").fill("45");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByTestId("toast").first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Varsayılan öncelik")).toHaveValue("HIGH");
  await expect(page.getByLabel("SLA hedefi (dakika)")).toHaveValue("45");
});

test("AC-257: müşteri formunda varsayılan öncelik ('Firma varsayılanı') ve SLA", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "rqcu");
  await page.goto("/customers");
  await page.getByTestId("customer-new").click();
  const form = page.getByTestId("customer-form");
  await expect(form.getByTestId("cf-priority")).toHaveValue("");
  await expect(form.getByTestId("cf-priority").locator("option").first()).toHaveText("Firma varsayılanı");
  await form.getByLabel("Firma adı").fill("Öncelikli Ltd.");
  await form.getByTestId("cf-priority").selectOption("HIGH");
  await form.getByTestId("cf-sla").fill("9999");
  await form.getByTestId("cf-submit").click();
  await expect(form.getByTestId("cf-sla")).toHaveAttribute("aria-invalid", "true");
  await form.getByTestId("cf-sla").fill("30");
  await form.getByTestId("cf-submit").click();
  await expect(page).toHaveURL(/\/customers\/01JC5ST/);
});

test("Erişilebilirlik: kuyruk, mesaj paneli ve mesai ekranı — iki tema, masaüstü + 390 px axe 0", async ({ browser }, info) => {
  desktopOnly(info.project.name);
  test.setTimeout(120_000);
  for (const width of [1280, 390]) {
    await scanBoth(browser, "/requests", width, async (p) => {
      await expect(cards(p)).toHaveCount(4);
      await card(p, "Ayşe Yılmaz").getByTestId("thread-open").click();
      await expect(p.getByTestId("thread").first()).toHaveAttribute("data-state", "ready");
    });
    await scanBoth(browser, "/settings/business-hours", width, async (p) => {
      await expect(p.getByTestId("hd-list")).toHaveAttribute("data-state", "ready");
    });
  }
});
