import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import { axeScan, guardConsole, noHorizontalOverflow, signIn } from "./helpers";

// P13a — frontend (AC-197, AC-199; T-P12b reason etiketleri; P12b sayfa testi: kaynak rozeti + büyük harfli şema).
// Sahte API: e2e/mock-history.mjs (u-hu-*; ANON_ID anonim oturum, ticket "ANON-409" → 409 yarışı) ve e2e/mock-audit.mjs
// (u-auadm-* retention.run + settings.whatsapp.test kaydı; u-ausadef-* WhatsApp yerleşik varsayılan kaynak).
guardConsole();
const desktopOnly = (name: string) => test.skip(name !== "desktop", "masaüstü akışı");
const ANON = "01JHXSTAN0N000000000000048";
const OTHER = "01JHXST0000000000000000004"; // USER'ın kendi, anonim olmayan bitmiş oturumu (i=4)

async function signInAu(context: BrowserContext, scenario: string) {
  const value = `u-${scenario}-${Math.random().toString(36).slice(2)}`;
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
  await context.addCookies([
    { ...base, name: SESSION_COOKIE, value, httpOnly: true },
    { ...base, name: CSRF_COOKIE, value: "csrf-test-token" },
  ]);
}
const historyRows = (p: Page) => p.locator('[data-testid="history-row"], [data-testid="history-card"]').filter({ visible: true });
const auditRows = (p: Page) => p.locator('[data-testid="audit-row"], [data-testid="audit-card"]').filter({ visible: true });

test("AC-197: listede 'Anonimleştirildi' rozeti; detayda bilgi notu, ad yok, düzenleme formu yok, dosya kaydı silindi", async ({ page, context }) => {
  await signIn(context, "hu");
  await page.goto("/history");
  const anonRow = historyRows(page).filter({ has: page.getByTestId("anonymized-badge") });
  await expect(anonRow).toHaveCount(1);
  await expect(anonRow.getByTestId("anonymized-badge")).toHaveText("Anonimleştirildi");
  await noHorizontalOverflow(page);

  await page.goto(`/history/${ANON}`);
  await expect(page.getByTestId("detail-title")).toHaveText("Oturum ayrıntısı");
  await expect(page.getByTestId("anonymized-badge")).toBeVisible();
  await expect(page.getByTestId("history-anonymized")).toContainText("Saklama süresi dolduğu için");
  await expect(page.getByTestId("note-form")).toHaveCount(0);
  await expect(page.getByTestId("note-save")).toHaveCount(0);
  await expect(page.getByTestId("note-readonly")).toContainText("INC-0048");
  await expect(page.getByTestId("note-readonly")).toContainText("Anonimleştirilmiş oturum düzenlenemez.");
  await expect(page.getByTestId("section-summary")).toContainText("Anonimleştirildi");
  await expect(page.getByTestId("files-empty")).toHaveText("Dosya kayıtları saklama süresi dolduğu için silindi.");
  // Zaman çizelgesinde müşteri adı yok (sunucu null döner; arayüz yalnız rol etiketini basar)
  await expect(page.getByTestId("timeline")).toBeVisible();
  await noHorizontalOverflow(page);
  expect(await axeScan(page, "#icerik")).toEqual([]);
});

test("AC-197: sayfa açıkken anonimleştirilen oturumda kaydet → 409 SESSION_ANONYMIZED mesajı, form kilitlenir/salt okunura geçer", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "hu");
  await page.goto(`/history/${OTHER}`);
  await page.getByTestId("ticket-input").fill("ANON-409");
  const patch = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/sessions/${OTHER}`));
  await page.getByTestId("note-save").click();
  expect((await patch).status()).toBe(409);
  await expect(page.getByText("Bu oturum saklama süresi dolduğu için anonimleştirildi; düzenlenemez.").first()).toBeVisible();
  // Yenilenen sayfa: düzenleme yok, anonim görünüm; ayrılma uyarısı tetiklenmez
  await expect(page.getByTestId("history-anonymized")).toBeVisible();
  await expect(page.getByTestId("note-save")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Oturum geçmişi" }).click();
  await expect(page).toHaveURL(/\/history$/);
});

test("AC-199 + T-P12b: audit'te retention.run Türkçe etiket ve grup filtresi; dış gönderim reason Türkçe etiket + kod", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInAu(context, "auadm");
  await page.goto("/audit");
  const ret = auditRows(page).filter({ hasText: "Saklama süresi işi" });
  await expect(ret).toHaveCount(1);
  await expect(ret).toContainText("retention.run");
  await ret.getByTestId("audit-detail-open").click();
  const dlg = page.getByTestId("audit-detail");
  await expect(dlg.getByTestId("audit-new")).toContainText('"sessions": 3');
  await dlg.getByRole("button", { name: "Kapat", exact: true }).click();

  const wa = auditRows(page).filter({ hasText: "settings.whatsapp.test" });
  await wa.getByTestId("audit-detail-open").click();
  await expect(dlg.getByTestId("audit-reason")).toContainText("Servise ulaşılamadı");
  await expect(dlg.getByTestId("audit-reason")).toContainText("unreachable");
  expect(await axeScan(page, '[data-testid="audit-detail"]')).toEqual([]);
  await dlg.getByRole("button", { name: "Kapat", exact: true }).click();

  const f = page.getByTestId("audit-filters");
  await f.getByLabel("İşlem").selectOption("retention.*");
  await f.getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/action=retention\.\*/);
  await expect(auditRows(page)).toHaveCount(1);
  await expect(f.getByLabel("İşlem").locator("option:checked")).toHaveText("Veri saklama — tümü");
});

test("P13a WhatsApp: 'Varsayılan' kaynak rozeti + bilgi notu; büyük harfli şema kanonik biçimde kaydedilir", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInAu(context, "ausadef");
  await page.goto("/admin/settings/whatsapp");
  await expect(page.getByTestId("wa-svc-form")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("setting-source")).toHaveText("Varsayılan");
  await expect(page.getByTestId("setting-source")).toHaveAttribute("data-source", "default");
  await expect(page.getByTestId("wa-svc-default-source")).toContainText("varsayılan");
  await expect(page.getByTestId("wa-svc-env-source")).toHaveCount(0);
  await expect(page.getByTestId("wa-svc-url")).toHaveValue("");
  await expect(page.getByTestId("wa-test-send")).toBeEnabled();
  expect(await axeScan(page, "#icerik")).toEqual([]);

  const url = page.getByTestId("wa-svc-url");
  await url.fill("HTTPS://WA.Ornek.com:3000/");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/v1/admin/settings/whatsapp"));
  await page.getByTestId("save-bar-save").click();
  expect((await put).postDataJSON()).toEqual({ url: "https://wa.ornek.com:3000" });
  await expect(page.getByTestId("setting-source")).toHaveText("Panel");
  await expect(url).toHaveValue("https://wa.ornek.com:3000");
  await expect(page.getByTestId("save-bar")).toHaveCount(0);

  // Ortam değişkenine dön → env verilmemiş: yine yerleşik varsayılan
  await page.getByTestId("wa-svc-reset").click();
  await page.getByTestId("wa-svc-reset-dialog").getByTestId("wa-svc-reset-confirm").click();
  await expect(page.getByTestId("setting-source")).toHaveText("Varsayılan");
});

for (const scheme of ["light", "dark"] as const) {
  test(`AC-197 axe (${scheme}) + 390 px: anonim oturum detayı`, async ({ page, context }, info) => {
    desktopOnly(info.project.name);
    await page.emulateMedia({ colorScheme: scheme });
    await signIn(context, "hu");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width > 600 ? 800 : 844 });
      await page.goto(`/history/${ANON}`);
      await expect(page.getByTestId("history-anonymized")).toBeVisible();
      await noHorizontalOverflow(page);
      expect(await axeScan(page), `anon ${width}`).toEqual([]);
    }
  });
}

test("S-P13a: müşteri kaynaklı audit kaydı — IP ağ öneki (/24, /48) ve boş UA görünümü bozmaz", async ({ page, context }) => {
  await signInAu(context, "auadm");
  await page.goto("/audit");
  const v4 = auditRows(page).filter({ hasText: "203.0.113.0/24" });
  await expect(v4).toHaveCount(1);
  await expect(auditRows(page).filter({ hasText: "2001:db8:1234::/48" })).toHaveCount(1);
  await noHorizontalOverflow(page);
  // Ayrıntı: IP öneki tam görünür, UA satırı yok (boş değer basılmaz)
  const open = v4.getByTestId("audit-detail-open");
  if (await open.count()) await open.click();
  else await v4.click(); // dar ekran: kartın tamamı düğme
  const dlg = page.getByTestId("audit-detail");
  await expect(dlg).toHaveJSProperty("open", true);
  await expect(dlg).toContainText("203.0.113.0/24");
  await expect(dlg.getByText("Tarayıcı", { exact: true })).toHaveCount(0);
  expect(await axeScan(page, '[data-testid="audit-detail"]')).toEqual([]);
});

test("S-P13a-5: ticket no alanında 'kişisel veri yazmayın' ipucu", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "hu");
  await page.goto(`/history/${OTHER}`);
  await expect(page.getByTestId("note-form")).toContainText("Kişisel veri (ad, telefon, e-posta) yazmayın");
  // ipucu alanla ilişkili (aria-describedby)
  const described = await page.getByTestId("ticket-input").getAttribute("aria-describedby");
  expect(described).toBeTruthy();
  await expect(page.locator(`[id="${described!.split(" ")[0]}"]`)).toContainText("yazmayın");
});

test("AC-197 firma saklama süresi: Güvenlik sekmesinde alan, ipucu, aralık kontrolü (istek yok), sunucu alan hatası, kayıt", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "acc");
  await page.goto("/settings/security");
  await expect(page.getByTestId("retention-form")).toHaveAttribute("data-ready", "true");
  const sec = page.getByTestId("retention-section");
  await expect(sec.getByRole("heading", { name: "Veri saklama" })).toBeVisible();
  const field = page.getByLabel("Veri saklama süresi (gün)");
  await expect(field).toHaveValue("365");
  await expect(sec).toContainText("Süresi dolan oturum, onay ve talep kayıtları her gece anonimleştirilir; audit 730 gün tutulur.");
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  expect(await axeScan(page, "#icerik")).toEqual([]);

  let puts = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/api/v1/settings/tenant")) puts++;
  });
  for (const bad of ["89", "731", "12.5", "abc", ""]) {
    await field.fill(bad);
    await page.getByTestId("save-bar-save").click();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toBeFocused();
  }
  await expect(sec).toContainText(/Saklama süresi gerekli/);
  await field.fill("731");
  await page.getByTestId("save-bar-save").click();
  await expect(sec).toContainText("90–730 gün arasında bir tam sayı girin");
  expect(puts, "aralık dışında PUT gitmemeli").toBe(0);

  await field.fill("729");
  await page.getByTestId("save-bar-save").click();
  await expect(sec).toContainText("Sunucu bu süreyi reddetti");

  // Düşürme (365 → 180): kayıttan önce onay; odak Vazgeç; Vazgeç → istek yok, değer formda kalır
  const putsBefore = puts;
  await field.fill("180");
  await page.getByTestId("save-bar-save").click();
  const dlg = page.getByTestId("retention-confirm");
  await expect(dlg).toHaveJSProperty("open", true);
  await expect(dlg).toContainText("Saklama süresini 365 günden 180 güne düşürüyorsunuz. Bu gece 180 günden eski oturum, onay ve talep kayıtları geri alınamaz biçimde anonimleştirilir.");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  expect(await axeScan(page, '[data-testid="retention-confirm"]')).toEqual([]);
  await dlg.getByRole("button", { name: "Vazgeç" }).click();
  await expect(dlg).toHaveJSProperty("open", false);
  expect(puts, "vazgeçince PUT gitmemeli").toBe(putsBefore);
  await expect(field).toHaveValue("180");
  await expect(page.getByTestId("save-bar")).toBeVisible();
  // Escape de vazgeçer
  await page.getByTestId("save-bar-save").click();
  await expect(dlg).toHaveJSProperty("open", true);
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveJSProperty("open", false);
  expect(puts).toBe(putsBefore);
  // Onay → kayıt
  await page.getByTestId("save-bar-save").click();
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/v1/settings/tenant"));
  await dlg.getByTestId("retention-confirm-ok").click();
  expect((await put).postDataJSON()).toEqual({ retentionDays: 180 });
  await expect(page.getByTestId("toast")).toContainText("180 gün");
  await expect(dlg).toHaveJSProperty("open", false);
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Veri saklama süresi (gün)")).toHaveValue("180");

  // Artırma (180 → 400): onay yok, doğrudan kayıt
  await expect(page.getByTestId("retention-form")).toHaveAttribute("data-ready", "true");
  await page.getByLabel("Veri saklama süresi (gün)").fill("400");
  const put2 = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/api/v1/settings/tenant"));
  await page.getByTestId("save-bar-save").click();
  expect((await put2).postDataJSON()).toEqual({ retentionDays: 400 });
  await expect(page.getByTestId("retention-confirm")).toHaveJSProperty("open", false);
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
});

test("AC-197 firma saklama süresi: yalnız görüntüleme yetkisinde alan pasif", async ({ page, context }) => {
  await signIn(context, "accro");
  await page.goto("/settings/security");
  await expect(page.getByTestId("settings-readonly")).toBeVisible();
  await expect(page.getByTestId("retention-days")).toBeDisabled();
  await expect(page.getByTestId("retention-days")).toHaveValue("365");
  await noHorizontalOverflow(page);
});
