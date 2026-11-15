// LG-3 (AC-405..409, 415, 417, 421, 426, 427): tek "Müşteriye gönder" diyaloğu, üç giriş noktası. Sahte API e2e/mock-lg.mjs:
// önizleme ve "gönderilen" metin aynı render fonksiyonundan; sahte SMTP/WA yakalayıcısı /__e2e/lg-outbox/<çerez>.
import { expect, test, type Page } from "@playwright/test";
import { axeScan, desktopOnly, noHorizontalOverflow, signIn } from "./helpers";

const outbox = async (page: Page, cookie: string) =>
  (await (await page.request.get(`http://127.0.0.1:4217/__e2e/lg-outbox/${cookie}`)).json()) as {
    channel: string;
    to: string;
    subject: string | null;
    text: string;
  } | null;

/** AC-407/427: mock'a ulaşan metin = diyalogdaki önizleme (karakter karakter). */
async function expectSentEqualsPreview(page: Page, cookie: string) {
  const dlg = page.getByTestId("cs-dialog");
  const preview = await dlg.getByTestId("cs-preview-text").textContent();
  const subject = (await dlg.getByTestId("cs-preview-subject").count()) ? await dlg.getByTestId("cs-preview-subject").textContent() : null;
  const sent = await outbox(page, cookie);
  expect(sent?.text).toBe(preview);
  expect(sent?.subject).toBe(subject);
}

async function openCreatedSession(page: Page) {
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Yeni destek oturumu" }).first().click();
  await expect(page.getByTestId("new-session-dialog").getByTestId("session-link")).toBeVisible();
}

test("AC-405/407/408/409 K1 oturum kartı: tek düğme, kanal klavyeyle, hata durumları, önizleme = gönderilen", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  const cookie = await signIn(context);
  await openCreatedSession(page);
  const card = page.getByTestId("new-session-dialog");
  // AC-405: gönderimle ilgili düğme sayısı tam 1
  await expect(card.getByRole("button", { name: /gönder/i })).toHaveCount(1);
  await expect(card.getByTestId("session-email-open")).toHaveCount(0);
  await expect(card.getByTestId("send-link-open")).toHaveCount(0);
  await card.getByTestId("customer-send-open").click();
  const dlg = page.getByTestId("cs-dialog");
  await expect(dlg.getByTestId("cs-form")).toBeVisible();
  await expect(dlg.getByRole("group", { name: "Gönderim kanalı" })).toBeVisible();
  // e-posta: istemci doğrulaması, alan altında hata, istek gitmez
  await dlg.getByTestId("cs-to").fill("gecersiz@");
  await dlg.getByTestId("cs-send").click();
  await expect(dlg.getByText("Geçerli bir e-posta adresi girin.")).toBeVisible();
  // 502 → tek genel metin (ham sağlayıcı metni yok)
  await dlg.getByTestId("cs-to").fill("hata502@ornek.com");
  await dlg.getByTestId("cs-send").click();
  await expect(dlg.getByTestId("cs-result")).toHaveText("Mesaj gönderilemedi. Daha sonra yeniden deneyin.");
  await expect(dlg).not.toContainText("relay");
  // 409 → kanal kullanılamıyor
  await dlg.getByTestId("cs-to").fill("kanal409@ornek.com");
  await dlg.getByTestId("cs-send").click();
  await expect(dlg.getByTestId("cs-result")).toContainText("Kanal kullanılamıyor");
  // 429 → geri sayım, süre dolunca açılır
  await dlg.getByTestId("cs-to").fill("limit429@ornek.com");
  await dlg.getByTestId("cs-send").click();
  await expect(dlg.getByTestId("cs-send")).toContainText("Bekleyin");
  await expect(dlg.getByTestId("cs-send")).toBeDisabled();
  await expect(dlg.getByTestId("cs-send")).toHaveText(/Gönder$/, { timeout: 6000 });
  // başarı: e-posta
  await dlg.getByTestId("cs-to").fill("musteri@ornek.com");
  await dlg.getByTestId("cs-send").click();
  await expect(dlg.getByTestId("cs-result")).toHaveText("Gönderildi (E-posta, m***@ornek.com)");
  await expectSentEqualsPreview(page, cookie);
  // AC-408: diyalog açık kalır; kanal klavyeyle değişir (ok tuşu), SMS yalnız TR
  await dlg.getByTestId("cs-channel-EMAIL").focus();
  await page.keyboard.press("ArrowRight");
  await expect(dlg.getByTestId("cs-channel-WHATSAPP")).toBeChecked();
  await dlg.getByTestId("cs-to").fill("0532 111 22 33");
  await expect(dlg.getByText("Gönderilecek numara: +905321112233")).toBeVisible();
  await dlg.getByTestId("cs-send").click();
  await expect(dlg.getByTestId("cs-result")).toHaveText("Gönderildi (WhatsApp, +90532***33)");
  await expectSentEqualsPreview(page, cookie);
  await dlg.getByTestId("cs-channel-SMS").check();
  await dlg.getByTestId("cs-to").fill("+44 7700 900123");
  await dlg.getByTestId("cs-send").click();
  await expect(dlg.getByText("SMS yalnız Türkiye cep numaralarına gönderilir")).toBeVisible();
  // Esc ile kapanır, alttaki oturum kartı açık kalır
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(card).toBeVisible();
});

test("AC-408 seçenekler alınamazsa hata + tekrar dene; kanal yoksa boş durum ve kısmi not", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context);
  let fail = true;
  await page.route("**/api/v1/customer-send/options", async (r) => {
    if (fail) return r.fulfill({ status: 500, json: { error: { code: "INTERNAL", message: "Sunucu hatası." } } });
    return r.fulfill({
      json: {
        kind: "SESSION",
        channels: [{ channel: "EMAIL", available: false, block: "unconfigured", settingsHref: "/settings/smtp" }],
        recipients: { email: [], phone: [] },
        recipientsLocked: false,
        previews: {},
        remainingSends: null,
      },
    });
  });
  await openCreatedSession(page);
  await page.getByTestId("customer-send-open").click();
  const dlg = page.getByTestId("cs-dialog");
  await expect(dlg.getByTestId("cs-load-error")).toBeVisible();
  fail = false;
  await dlg.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(dlg.getByTestId("cs-empty")).toContainText("Gönderim kanalı yapılandırılmamış");
  await expect(dlg.getByTestId("cs-settings-EMAIL")).toHaveAttribute("href", "/settings/smtp");
  await expect(dlg.getByTestId("cs-send")).toHaveCount(0);
});

test("AC-415/417 K2 kayıt kodu: yalnız e-posta, alıcı yalnız listeden, 3 hak, önizleme = gönderilen", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  const cookie = await signIn(context, "unempty");
  await page.goto("/unattended/codes");
  await page.getByTestId("un-create-code").click();
  const codeDlg = page.getByTestId("un-code-dialog");
  await codeDlg.getByRole("combobox", { name: "Müşteri" }).fill("Acme");
  await page.getByRole("option", { name: "Acme Ltd." }).click();
  await codeDlg.getByTestId("un-code-submit").click();
  const stepUp = page.getByTestId("step-up-dialog");
  await stepUp.getByTestId("step-up-code").fill("123456");
  await stepUp.getByTestId("step-up-submit").click();
  await expect(codeDlg.getByTestId("un-code-value")).toBeVisible();
  await codeDlg.getByTestId("un-code-send").click();
  const dlg = page.getByTestId("cs-dialog");
  // O-LG-3: tek kanal → seçim yok
  await expect(dlg.getByTestId("cs-channel-single")).toHaveText("E-posta ile gönderilecek");
  await expect(dlg.getByRole("group", { name: "Gönderim kanalı" })).toHaveCount(0);
  await expect(dlg.getByRole("combobox", { name: /Alıcı/ })).toHaveValue("it@acme.com.tr");
  await expect(dlg.getByTestId("cs-remaining")).toHaveText("Kalan gönderim hakkı: 3 / 3");
  await expect(dlg.getByTestId("cs-preview-text")).toContainText("ABCD-1234-EFGH-5678");
  await dlg.getByTestId("cs-send").click();
  await expect(dlg.getByTestId("cs-result")).toHaveText("Gönderildi (E-posta, i***@acme.com.tr)");
  await expect(dlg.getByTestId("cs-remaining")).toHaveText("Kalan gönderim hakkı: 2 / 3");
  await expectSentEqualsPreview(page, cookie);
  expect(await axeScan(page, "[data-testid=cs-dialog]")).toEqual([]);
  // iç diyalog Esc → yalnız kendisi kapanır; kod diyaloğu açık kalır
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(codeDlg.getByTestId("un-code-value")).toBeVisible();
});

test("AC-421/423 K3 müşteri ayrıntısı: düğme yetkiyle, öneri ile dolu alıcı, WhatsApp gönderimi", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  const cookie = await signIn(context, "rqculg");
  await page.goto("/customers/01JC5ST0000000000000000001");
  await page.getByTestId("customer-send").click();
  const dlg = page.getByTestId("cs-dialog");
  await dlg.getByTestId("cs-channel-WHATSAPP").check();
  await expect(dlg.getByTestId("cs-to")).toHaveValue("+905321112233");
  await expect(dlg.getByTestId("cs-preview-subject")).toHaveCount(0);
  await dlg.getByTestId("cs-send").click();
  await expect(dlg.getByTestId("cs-result")).toContainText("Gönderildi (WhatsApp");
  await expectSentEqualsPreview(page, cookie);
});

test("AC-421 send_link yetkisi yoksa müşteri ayrıntısında düğme yok", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "rqcu");
  await page.goto("/customers/01JC5ST0000000000000000001");
  await expect(page.getByTestId("customer-download-url")).toBeVisible();
  await expect(page.getByTestId("customer-send")).toHaveCount(0);
});

test("AC-426 diyalog iki temada axe 0, 360 px yatay taşma yok", async ({ browser }) => {
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, colorScheme: scheme, reducedMotion: "reduce" });
    await signIn(ctx, "rqculg");
    const p = await ctx.newPage();
    await p.goto("/customers/01JC5ST0000000000000000001");
    await p.getByTestId("customer-send").click();
    await expect(p.getByTestId("cs-preview-text")).toBeVisible();
    await noHorizontalOverflow(p);
    expect(await axeScan(p, "[data-testid=cs-dialog]"), `cs-dialog ${scheme}`).toEqual([]);
    await ctx.close();
  }
});
