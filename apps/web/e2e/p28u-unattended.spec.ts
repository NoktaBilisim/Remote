import { expect, test, type Page } from "@playwright/test";
import { agentLog, agentSend, startFakeAgent } from "./fake-agent";
import { axeScan, desktopOnly, guardConsole, newSession, scanBoth, signIn } from "./helpers";

// P28u-K7 (mimari-p28u §10) — AC-429, 430, 432, 435, 436, 437, 439, 442, 443, 445, 446 (UI). Sahte API: e2e/mock-p28u.mjs
// (u-p28u*), geçmiş e2e/mock-history.mjs (u-hun-*), audit e2e/mock-audit.mjs (u-auadm-*), konsol p7 sahte WS + sahte ajan.
guardConsole();
const D1 = "01JDVP28V0000000000000000A";
const row = (page: Page, name: string) =>
  page.locator('[data-testid="un-row"], [data-testid="un-card"]').filter({ visible: true }).filter({ hasText: name });
const ACK =
  "Cihaz kullanıcılarını (çalışanları) izin istenmeden izlenebilecekleri ve müdahale edilebileceği konusunda yazılı olarak bilgilendirdik; aydınlatma metnimiz bunu kapsıyor";
const REASON = "Gece bakım penceresinde sunucu güncellemesi";

async function stepUp(page: Page) {
  const dlg = page.getByTestId("step-up-dialog");
  await expect(dlg).toBeVisible();
  await dlg.getByTestId("step-up-code").fill("123456");
  await dlg.getByTestId("step-up-submit").click();
}

async function openConnect(page: Page, name: string) {
  await row(page, name)
    .getByRole("button", { name: `Bağlan: ${name}` })
    .click();
  await expect(page.getByTestId("un-connect-dialog")).toBeVisible();
}

test("AC-429/435 liste: Kullanıcı sütunu (Aktif/Kilitli/—), 'Servis güncel değil' rozeti + Bağlan pasif", async ({ page, context }) => {
  await signIn(context, "p28ufull");
  await page.goto("/unattended");
  await expect(row(page, "AKTIF-PC").getByTestId("un-user-state")).toHaveText("Aktif");
  await expect(row(page, "KILIT-PC").getByTestId("un-user-state")).toHaveText("Kilitli");
  const eski = row(page, "ESKI-PC");
  await expect(eski.getByTestId("un-user-state")).toHaveAttribute("data-state", "unknown");
  await expect(eski.getByTestId("un-badge-outdated")).toHaveText("Servis güncel değil");
  await expect(eski.getByRole("button", { name: "Bağlan: ESKI-PC" })).toBeDisabled();
  await expect(eski.getByTestId("un-connect-reason")).toHaveText("Cihazdaki servis güncel değil — güncelleyin");
});

test("AC-429/287 liste + Bağlan diyaloğu 390 px, açık/koyu tema: taşma yok, axe 0", async ({ browser }, info) => {
  desktopOnly(info.project.name);
  await scanBoth(browser, "p28ufull", "/unattended", 390, async (p) => {
    await expect(p.getByTestId("un-card").first()).toBeVisible();
  });
  await scanBoth(browser, "p28ufull", "/settings/unattended", 390, async (p) => {
    await expect(p.getByTestId("un-policy-form")).toHaveAttribute("data-ready", "true");
  });
});

test("AC-430 kutu yalnız politika açık + unattended.silent varken; her açılışta işaretsiz", async ({ page, context }) => {
  for (const scenario of ["p28unopol", "p28unoperm"]) {
    await context.clearCookies();
    await signIn(context, scenario);
    await page.goto("/unattended");
    await openConnect(page, "AKTIF-PC");
    await expect(page.getByTestId("un-connect-ask-info")).toContainText("Kullanıcı varsa izin istenir");
    await expect(page.getByTestId("un-silent")).toHaveCount(0);
    await page.getByTestId("un-connect-cancel").click();
  }
  await context.clearCookies();
  await signIn(context, "p28ufull");
  await page.goto("/unattended");
  await openConnect(page, "AKTIF-PC");
  await expect(page.getByTestId("un-silent")).not.toBeChecked();
  await page.getByTestId("un-silent").check();
  await expect(page.getByTestId("un-silent-warn")).toHaveText(
    "Bu bağlantı diğer yöneticilere e-postayla bildirilir; cihazda gösterge görünür.",
  );
  expect(await axeScan(page, '[data-testid="un-connect-dialog"]')).toEqual([]);
  await page.getByTestId("un-connect-cancel").click();
  await openConnect(page, "AKTIF-PC");
  await expect(page.getByTestId("un-silent")).not.toBeChecked();
  await expect(page.getByTestId("un-silent-reason")).toHaveCount(0);
});

test("AC-437 izinsiz bağlan: gerekçe 20–500 alan hatası, sonra step-up → konsol; gövde {silent, reason}", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p28ufull");
  await page.goto("/unattended");
  await openConnect(page, "AKTIF-PC");
  await page.getByTestId("un-silent").check();
  await page.getByTestId("un-silent-reason").fill("kısa");
  await expect(page.getByTestId("un-silent-count")).toHaveText("4 / 500 karakter");
  await page.getByTestId("un-connect-submit").click();
  await expect(page.getByTestId("un-silent-reason-error")).toHaveText("Gerekçe 20–500 karakter olmalı");
  await expect(page.getByTestId("un-silent-reason")).toHaveAttribute("aria-invalid", "true");
  await page.getByTestId("un-silent-reason").fill(`  ${REASON}  `);
  const sent = page.waitForRequest((r) => r.url().endsWith(`/unattended/devices/${D1}/connect`) && r.method() === "POST");
  await page.getByTestId("un-connect-submit").click();
  expect((await sent).postDataJSON()).toEqual({ silent: true, reason: REASON });
  await stepUp(page);
  await expect(page).toHaveURL(/\/sessions\/01JSSP28V0000000000000000A\/console$/);
});

test("AC-436 politika: açarken aydınlatma kutusu zorunlu → step-up → kaydedildi; kapatma onaysız", async ({ page, context }) => {
  await signIn(context, "p28unopol");
  await page.goto("/settings/unattended");
  await expect(page).toHaveTitle(/Gözetimsiz erişim/);
  await expect(page.getByTestId("settings-tabs").getByRole("link", { name: "Gözetimsiz erişim" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("un-policy-form")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("un-policy-notes")).toContainText("Gizli izleme yoktur; cihazda gösterge her zaman görünür.");
  await expect(page.getByTestId("un-policy-notes")).toContainText("aktif / kilitli / oturum yok");
  await page.getByTestId("un-policy-switch").click();
  await expect(page.getByTestId("un-policy-ack-box")).toContainText(ACK);
  await page.getByTestId("save-bar-save").click();
  await expect(page.getByTestId("un-policy-ack-error")).toHaveText("Açmak için bilgilendirme kutusunu işaretleyin");
  await page.getByTestId("un-policy-ack").check();
  await page.getByTestId("save-bar-save").click();
  await stepUp(page);
  await expect(page.getByText("İzin istemeden bağlanma açıldı.")).toBeVisible();
  await expect(page.getByTestId("un-policy-last")).toContainText("Son açan: Pınar Yönetici");
  await page.getByTestId("un-policy-switch").click();
  await expect(page.getByTestId("un-policy-ack-box")).toHaveCount(0);
  await page.getByTestId("save-bar-save").click();
  await expect(page.getByText("İzin istemeden bağlanma kapatıldı.")).toBeVisible();
});

test("AC-436 politika salt okunur (settings.edit yok): uyarı, anahtar pasif", async ({ page, context }) => {
  await signIn(context, "p28uro");
  await page.goto("/settings/unattended");
  await expect(page.getByTestId("settings-readonly")).toBeVisible();
  await expect(page.getByTestId("un-policy-switch")).toBeDisabled();
});

test("AC-446 geçmiş detayı: bağlantı kipi, gerekçe (düz metin), müdahale zaman çizelgesi", async ({ page, context }) => {
  await signIn(context, "hun");
  await page.goto("/history/01JHXST0000000000000000000");
  const sec = page.getByTestId("un-history");
  await expect(sec.getByTestId("un-history-mode")).toHaveText("İzinsiz");
  await expect(sec.getByTestId("un-history-reason")).toHaveText("Gece bakım penceresinde sunucu güncellemesi <b>");
  await expect(sec.getByTestId("un-timeline-item")).toHaveCount(4);
  await expect(sec.locator('[data-kind="lock"]')).toContainText("Oturum kilitlendi");
  await expect(sec.locator('[data-kind="logoff"]')).toContainText("başarısız");
  expect(await axeScan(page, '[data-testid="section-unattended"]')).toEqual([]);
});

test("AC-445 audit: 'Bağlantı kipi' filtresi URL'ye yazılır", async ({ page, context }) => {
  await signIn(context, "auadm");
  await page.goto("/audit");
  await page.getByTestId("audit-consent-mode").selectOption("silent");
  await page.getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/consentMode=silent/);
  await expect(page.getByTestId("audit-consent-mode")).toHaveValue("silent");
});

test("AC-446 yetki matrisi: unattended.silent 'Hassas' rozeti", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "usadm");
  await page.goto("/users/01JKS00000000000000000000B");
  await expect(page.getByTestId("perm-sensitive-unattended.silent")).toHaveText("Hassas — yalnız gerekene verin");
});

test("AC-439/442/443 konsol izinsiz: İzleniyor → Müdahale et (onay) → kontrol; kilitle; oturumu kapat (odak Vazgeç) → yeniden bağlanıyor", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p7");
  await page.routeWebSocket(/\/ws\/tech/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const o = JSON.parse(String(m)) as { t: string; unattended?: unknown };
      if (o.t === "hello") o.unattended = { deviceId: D1, deviceName: "AKTIF-PC", consentMode: "silent", intervene: true };
      ws.send(JSON.stringify(o));
    });
    ws.onMessage((m) => server.send(m));
  });
  const calls: string[] = [];
  await page.route(/\/api\/v1\/sessions\/[0-9A-Z]{26}\/unattended\/(lock|logoff)$/, async (r) => {
    calls.push(r.request().url().split("/").at(-1)!);
    const logoff = r.request().url().endsWith("logoff");
    if (logoff) expect(r.request().postDataJSON()).toEqual({ confirm: true });
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(logoff ? { ok: true, rejoin: true } : { ok: true }),
    });
  });
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("un-mode-badge")).toHaveText("Bağlantı kipi: İzinsiz");
  const a = await startFakeAgent(browser, id);
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect(page.getByTestId("un-monitoring")).toHaveText("İzleniyor");
  await expect(page.getByTestId("control-request")).toHaveCount(0); // tek yol onaylı "Müdahale et"
  await expect(page.getByTestId("un-lock")).toHaveCount(0); // izleme kipinde komut yok (AC-442)

  await page.getByTestId("un-intervene").click();
  const dlg = page.getByTestId("un-intervene-dialog");
  await expect(dlg).toContainText("Kontrol açılacak ve cihaz göstergesi 'Uzaktan kontrol' olacak.");
  await dlg.getByTestId("un-intervene-dialog-confirm").click();
  await expect.poll(async () => (await agentLog(a)).asked).toBe(true);
  await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
  await expect(page.getByTestId("un-return")).toHaveText("İzlemeye dön");
  await expect(page.getByTestId("un-monitoring")).toHaveCount(0);

  await page.getByTestId("un-lock").click();
  await expect(page.getByText("Cihazda Windows oturumu kilitlendi.")).toBeVisible();
  await page.getByTestId("un-logoff").click();
  const lo = page.getByTestId("un-logoff-dialog");
  await expect(lo).toContainText("Kaydedilmemiş çalışmalar kaybolur. Oturumu kapatmak istiyor musunuz?");
  await expect(lo.getByTestId("un-logoff-dialog-cancel")).toBeFocused();
  await lo.getByTestId("un-logoff-dialog-confirm").click();
  await expect(page.getByTestId("un-rejoin")).toContainText("Cihaz yeniden bağlanıyor…");
  await expect(page.getByTestId("un-rejoin")).toContainText("45 sn");
  expect(calls).toEqual(["lock", "logoff"]);
  expect(await axeScan(page, '[data-testid="un-actions"]')).toEqual([]);

  await page.getByTestId("un-return").click();
  await expect(page.getByTestId("un-monitoring")).toBeVisible();
  await a.close();
});
