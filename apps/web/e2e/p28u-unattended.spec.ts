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

// AC-445 (QA P28u tur 1, madde 7): her kip ayrı seçilir; yalnız o kipin satırları gelir, diğer kiplerin ve kipsiz satırların
// işaretleri görünmez (fikstür e2e/mock-p28u.mjs: geçmişte ticket no, audit'te teknisyen / cihaz adı).
const HISTORY_MODES = {
  asked: ["UN-IZINLI-06", "UN-IZINLI-18"],
  no_user: ["UN-KULLANICISIZ-08"],
  silent: ["UN-SESSIZ-00", "UN-SESSIZ-12"],
} as const;
const AUDIT_MODES = {
  asked: ["Murat Çelik", "device:01JDVP28V0000000000000000A"],
  no_user: ["Kemal Öztürk"],
  silent: ["Selin Arslan"],
} as const;
const MODE_LABEL = { asked: "İzinli", no_user: "Kullanıcı yok", silent: "İzinsiz" } as const;
type Mode = keyof typeof MODE_LABEL;
const MODES = Object.keys(MODE_LABEL) as Mode[];

async function expectOnly(rows: ReturnType<Page["locator"]>, count: number, own: readonly string[], others: readonly string[]) {
  await expect(rows).toHaveCount(count);
  const texts = await rows.allInnerTexts();
  for (const text of texts)
    expect(
      own.some((m) => text.includes(m)),
      text,
    ).toBe(true);
  for (const m of own)
    expect(
      texts.some((x) => x.includes(m)),
      m,
    ).toBe(true);
  for (const m of others) expect(texts.join("\n")).not.toContain(m);
}

test("AC-445 geçmiş: 'Bağlantı kipi' filtresi üç kipte yalnız o kipin oturumlarını gösterir", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "hun");
  await page.goto("/history");
  const rows = page.locator('[data-testid="history-row"], [data-testid="history-card"]').filter({ visible: true });
  await expect(page.getByTestId("history-count")).toHaveText("30 oturumdan 1–25 arası");
  const f = page.getByTestId("history-filters");
  for (const mode of MODES) {
    await expect(f.getByTestId("history-consent-mode").locator("option", { hasText: MODE_LABEL[mode] })).toHaveCount(1);
    await f.getByTestId("history-consent-mode").selectOption(mode);
    await f.getByTestId("filter-apply").click();
    await expect(page).toHaveURL(new RegExp(`consentMode=${mode}`));
    const own = HISTORY_MODES[mode];
    await expect(page.getByTestId("history-count")).toHaveText(`${own.length} oturumdan 1–${own.length} arası`);
    const others = MODES.filter((m) => m !== mode).flatMap((m) => HISTORY_MODES[m]);
    await expectOnly(rows, own.length, own, others);
  }
});

test("AC-445 audit: 'Bağlantı kipi' filtresi üç kipte yalnız o kipin kayıtlarını gösterir; kipsiz kayıtlar elenir", async ({
  page,
  context,
}) => {
  await signIn(context, "auun");
  await page.goto("/audit");
  const rows = page.locator('[data-testid="audit-row"], [data-testid="audit-card"]').filter({ visible: true });
  await expect(rows).toHaveCount(9); // filtresiz: 8 gözetimsiz + 1 giriş
  for (const mode of MODES) {
    await page.getByTestId("audit-consent-mode").selectOption(mode);
    await page.getByTestId("filter-apply").click();
    await expect(page).toHaveURL(new RegExp(`consentMode=${mode}`));
    await expect(page.getByTestId("audit-consent-mode")).toHaveValue(mode);
    const others = MODES.filter((m) => m !== mode).flatMap((m) => AUDIT_MODES[m]);
    // her kipte iki kayıt: silent → connect + başladı; asked → cihaz onayı + başladı; no_user → başladı + bitti
    await expectOnly(rows, 2, AUDIT_MODES[mode], others);
  }
  await page.getByTestId("audit-consent-mode").selectOption("silent");
  await page.getByTestId("filter-apply").click();
  await expect(rows.filter({ hasText: "Gözetimsiz bağlantı başladı" })).toHaveCount(1);
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

/** Teknisyen WS'sinde `hello`'ya `unattended` ekler; ilk `hello` (sunucunun gönderdiği) saklanır — testler güncel `hello`'yu yeniden gönderir. */
async function unattendedWs(page: Page, unattended: Record<string, unknown>) {
  const h: { first: Record<string, unknown> | null; send: (o: unknown) => void } = { first: null, send: () => {} };
  await page.routeWebSocket(/\/ws\/tech/, (ws) => {
    const server = ws.connectToServer();
    h.send = (o) => ws.send(JSON.stringify(o));
    server.onMessage((m) => {
      const o = JSON.parse(String(m)) as Record<string, unknown>;
      if (o.t === "hello") {
        o.unattended = unattended;
        h.first ??= o;
      }
      ws.send(JSON.stringify(o));
    });
    ws.onMessage((m) => server.send(m));
  });
  return h;
}

test("AC-444/352 eski servis (hello.unattended.intervene:false): kilitle / oturumu kapat pasif + 'güncelleyin' nedeni, istek yok", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p7");
  await unattendedWs(page, { deviceId: D1, deviceName: "ESKI-PC", consentMode: "asked", intervene: false });
  const calls: string[] = [];
  await page.route(/\/api\/v1\/sessions\/[0-9A-Z]{26}\/unattended\/(lock|logoff)$/, async (r) => {
    calls.push(r.request().url());
    await r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("un-mode-badge")).toHaveText("Bağlantı kipi: İzinli");
  const a = await startFakeAgent(browser, id);
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect(page.getByTestId("un-monitoring")).toHaveCount(0); // izinli kip: izleme göstergesi yok, kontrol iste var
  await page.getByTestId("control-request").click();
  await expect.poll(async () => (await agentLog(a)).asked).toBe(true);
  await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });

  const lock = page.getByTestId("un-lock");
  const logoff = page.getByTestId("un-logoff");
  await expect(lock).toBeDisabled();
  await expect(logoff).toBeDisabled();
  const why = "Cihazdaki servis bu özelliği desteklemiyor — güncelleyin";
  await expect(page.getByTestId("un-intervene-unsupported")).toHaveText(why);
  await expect(lock).toHaveAccessibleDescription(why);
  await expect(logoff).toHaveAccessibleDescription(why);
  await lock.click({ force: true });
  await logoff.click({ force: true });
  await expect(page.getByTestId("un-logoff-dialog")).toBeHidden();
  expect(calls).toEqual([]);
  expect(await axeScan(page, '[data-testid="un-actions"]')).toEqual([]);
  await a.close();
});

test("K4 izinli istek: cihaz onayından sonra gelen güncel hello kip rozetini günceller (bekleme → 'İzinli')", async ({ page, context }) => {
  await signIn(context, "p7");
  const h = await unattendedWs(page, { deviceId: D1, deviceName: "AKTIF-PC", intervene: true });
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("stage-consent-wait")).toContainText("Kullanıcının onayı bekleniyor");
  await expect(page.getByTestId("un-mode-badge")).toHaveCount(0); // kip henüz belli değil
  expect(h.first).not.toBeNull();
  // Sunucu (device-msg.ts onConsent → sendHelloTech): aynı PENDING hello + `unattended.consentMode`
  h.send({ ...h.first, unattended: { deviceId: D1, deviceName: "AKTIF-PC", consentMode: "asked", intervene: true } });
  await expect(page.getByTestId("un-mode-badge")).toHaveText("Bağlantı kipi: İzinli");
  await expect(page.getByTestId("un-mode-badge")).toHaveAttribute("data-mode", "asked");
  await expect(page.getByTestId("stage-consent-wait")).toHaveCount(0);
  await expect(page.getByTestId("stage-unattended-wait")).toContainText("Cihaz bağlanıyor…");
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
  // `unattended` taşımayan sonraki hello önceki kipi korur
  const rest = { ...h.first };
  delete rest.unattended;
  h.send(rest);
  await expect(page.getByTestId("un-mode-badge")).toHaveText("Bağlantı kipi: İzinli");
});
