import { expect, test, type Page } from "@playwright/test";
import { agentLog, agentSend, startFakeAgent } from "./fake-agent";
import { axeScan, desktopOnly, guardConsole, newSession, scanBoth, signIn } from "./helpers";

// P28u r3 (mimari-p28u §r3 r3.6) — AC-429, 430, 433, 435, 442, 443, 445, 446, 451 (UI). Sahte API: e2e/mock-p28u.mjs
// (u-p28ufull-*), geçmiş e2e/mock-history.mjs (u-hun-*), audit e2e/mock-audit.mjs (u-auadm-*), konsol p7 sahte WS + sahte ajan.
guardConsole();
const D1 = "01JDVP28V0000000000000000A";
const INFO = "Bağlantı cihaz kullanıcısına sorulmadan açılır. Cihazda bağlantı göstergesi görünür.";
const row = (page: Page, name: string) =>
  page.locator('[data-testid="un-row"], [data-testid="un-card"]').filter({ visible: true }).filter({ hasText: name });

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
    await openConnect(p, "AKTIF-PC");
    await expect(p.getByTestId("un-connect-info")).toHaveText(INFO);
  });
});

test("AC-430 r3 tek Bağlan diyaloğu: kutu/gerekçe yok, bilgi satırı; gövde {} → step-up → konsol", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p28ufull");
  await page.goto("/unattended");
  await openConnect(page, "AKTIF-PC");
  const dlg = page.getByTestId("un-connect-dialog");
  await expect(dlg).toContainText("Cihaz kullanıcısı");
  await expect(dlg.getByTestId("un-user-state")).toHaveText("Aktif");
  await expect(page.getByTestId("un-connect-info")).toHaveText(INFO);
  await expect(dlg.getByRole("checkbox")).toHaveCount(0);
  await expect(dlg.getByRole("textbox")).toHaveCount(0);
  await expect(dlg).not.toContainText("izin");
  const sent = page.waitForRequest((r) => r.url().endsWith(`/unattended/devices/${D1}/connect`) && r.method() === "POST");
  await page.getByTestId("un-connect-submit").click();
  expect((await sent).postDataJSON()).toEqual({});
  // K10 (DÜŞÜK): step-up metni işleme göre nötr ("ayarı değiştirir" değil)
  await expect(page.getByTestId("step-up-dialog")).toContainText("Bu işlem ek doğrulama gerektirir.");
  await stepUp(page);
  await expect(page).toHaveURL(/\/sessions\/01JSSP28V0000000000000000A\/console$/);
});

test("r3 politika ekranı kaldırıldı: Ayarlar sekmelerinde 'Gözetimsiz erişim' yok, /settings/unattended 404", async ({ page, context }) => {
  await signIn(context, "p28ufull");
  await page.goto("/settings/general");
  await expect(page.getByTestId("settings-tabs")).toBeVisible();
  await expect(page.getByTestId("settings-tabs").getByRole("link", { name: "Gözetimsiz erişim" })).toHaveCount(0);
  const res = await page.goto("/settings/unattended");
  expect(res?.status()).toBe(404);
});

test("AC-446/451 geçmiş detayı (eski silent kayıt): kip etiketi, gerekçe (düz metin), müdahale zaman çizelgesi", async ({
  page,
  context,
}) => {
  await signIn(context, "hun");
  await page.goto("/history/01JHXST0000000000000000000");
  const sec = page.getByTestId("un-history");
  await expect(sec.getByTestId("un-history-mode")).toHaveText("İzinsiz (eski)");
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
// r3 (K-P28u-r3-12, AC-451): filtre eski kayıtlar için üç değerli kalır
const MODE_LABEL = { asked: "Kullanıcı onayıyla (eski)", no_user: "Onaysız", silent: "İzinsiz (eski)" } as const;
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
    await expect(f.getByTestId("history-consent-mode").locator(`option[value="${mode}"]`)).toHaveText(MODE_LABEL[mode]);
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
  // K10 (ORTA): P27/P28u eylemleri Türkçe etiketli (ham anahtar yalnız ikincil satırda, tasarım gereği)
  await expect(rows.filter({ hasText: "Gözetimsiz bağlantı isteği" })).toHaveCount(1);
  await page.getByTestId("audit-consent-mode").selectOption("asked");
  await page.getByTestId("filter-apply").click();
  await expect(rows.filter({ hasText: "Gözetimsiz bağlantı onayı (cihaz kullanıcısı)" })).toHaveCount(1);
  const action = page.getByTestId("audit-action");
  await expect(action.locator('option[value="unattended.*"]')).toHaveText("Gözetimsiz erişim — tümü");
  await expect(action.locator('option[value="unattended.consent"]')).toHaveText("Gözetimsiz bağlantı onayı (cihaz kullanıcısı)");
});

test("AC-451 saklı eski yetki satırı (unattended.silent): ekranda görünmez, kaydetme bozulmaz ve geri gönderilmez", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "usadm");
  await page.goto("/users/01JKS00000000000000000000B");
  await expect(page.getByTestId("permission-table")).toBeVisible();
  await expect(page.getByTestId("perm-unattended.silent")).toHaveCount(0);
  await expect(page.getByText("İzin istemeden bağlan")).toHaveCount(0);
  await expect(page.getByTestId("perm-sensitive-unattended.silent")).toHaveCount(0);
  await page.getByTestId("perm-group-users").filter({ visible: true }).click();
  const patch = page.waitForRequest((r) => r.method() === "PATCH");
  await page.getByTestId("save-bar-save").click();
  const body = (await patch).postDataJSON() as { permissions?: Record<string, boolean> };
  expect(Object.keys(body.permissions ?? {})).not.toContain("unattended.silent");
  await expect(page.getByText("Can Aydın kaydedildi · yetki değişiklikleri audit log'a yazıldı")).toBeVisible();
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

test("AC-433/442/443 konsol onaysız: cihaz katılınca tıklamasız TEK kontrol isteği → kilitle; oturumu kapat (odak Vazgeç) → yeniden bağlanıyor; bırak → yeniden iste", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p7");
  await unattendedWs(page, { deviceId: D1, deviceName: "AKTIF-PC", consentMode: "no_user", intervene: true });
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
  await expect(page.getByTestId("stage-unattended-wait")).toContainText("Cihaz bağlanıyor…");
  await expect(page.getByTestId("un-actions")).toHaveCount(0); // kontrol yokken müdahale çubuğu yok
  const a = await startFakeAgent(browser, id);
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  // K-P28u-r3-6: teknisyen hiçbir şeye tıklamadan istek cihaza ulaşır; yalnız bir kez
  await expect.poll(async () => (await agentLog(a)).asked).toBe(true);
  await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
  await expect(page.getByTestId("un-lock")).toBeVisible();
  expect((await agentLog(a)).controlRequests).toBe(1);
  for (const gone of ["un-mode-badge", "un-monitoring", "un-intervene", "un-return", "stage-consent-wait"])
    await expect(page.getByTestId(gone)).toHaveCount(0);

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

  // Kontrolü bırak → komutlar gizlenir; elle yeniden istenebilir (otomatik ikinci istek yok)
  await page.getByTestId("control-release").click();
  await expect(page.getByTestId("un-lock")).toHaveCount(0);
  expect((await agentLog(a)).controlRequests).toBe(1);
  await page.getByTestId("control-request").click();
  await expect.poll(async () => (await agentLog(a)).controlRequests).toBe(2);
  await a.close();
});

test("K10 konsol: 'Kullanıcı oturumu kapatılsın mı?' onayı Esc ile kapanır (vazgeç), istek ve uzak tuş gitmez", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p7");
  await unattendedWs(page, { deviceId: D1, deviceName: "AKTIF-PC", consentMode: "no_user", intervene: true });
  let calls = 0;
  await page.route(/\/api\/v1\/sessions\/[0-9A-Z]{26}\/unattended\/(lock|logoff)$/, async (r) => {
    calls++;
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, rejoin: true }) });
  });
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("stage-unattended-wait")).toBeVisible(); // konsol WS'i bağlandı (sahte ajan ondan sonra)
  const a = await startFakeAgent(browser, id);
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect.poll(async () => (await agentLog(a)).asked).toBe(true);
  await agentSend(a, { t: "control.state", state: "GRANTED", source: "UI" });
  await expect(page.getByTestId("un-logoff")).toBeVisible();
  const inputsBefore = (await agentLog(a)).inputs.length;

  const lo = page.getByTestId("un-logoff-dialog");
  // 1) Vazgeç odaklıyken Esc
  await page.getByTestId("un-logoff").click();
  await expect(lo.getByTestId("un-logoff-dialog-cancel")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(lo).toBeHidden();
  await expect(page.getByTestId("un-logoff")).toBeFocused(); // odak tetikleyiciye döner
  // 2) Test raporundaki sıra: tıklar tıklamaz (bekleme yok) Esc
  await page.getByTestId("un-logoff").click();
  await page.keyboard.press("Escape");
  await expect(lo).toBeHidden();
  // Esc ile kapandıktan sonra yeniden açılabiliyor (durum takılmadı)
  await page.getByTestId("un-logoff").click();
  await expect(lo).toBeVisible();
  await lo.getByTestId("un-logoff-dialog-cancel").click();
  await expect(lo).toBeHidden();
  expect(calls).toBe(0);
  expect((await agentLog(a)).inputs.length).toBe(inputsBefore); // Esc uzak ekrana tuş olarak gitmedi
  await a.close();
});

for (const height of [812, 667]) {
  test(`K10 Bağlan diyaloğu 375×${height}: ekran içinde, 'Vazgeç' görünür ve çalışır, istek yok; iki tema axe 0`, async ({
    browser,
  }, info) => {
    desktopOnly(info.project.name);
    for (const scheme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ viewport: { width: 375, height }, colorScheme: scheme, reducedMotion: "reduce" });
      await signIn(ctx, "p28ufull");
      const page = await ctx.newPage();
      let posts = 0;
      page.on("request", (r) => {
        if (r.method() === "POST" && /\/unattended\/devices\/[0-9A-Z]{26}\/connect$/.test(r.url())) posts++;
      });
      await page.goto("/unattended");
      await openConnect(page, "AKTIF-PC");
      const dlg = page.getByTestId("un-connect-dialog");
      expect(await axeScan(page, '[data-testid="un-connect-dialog"]'), scheme).toEqual([]);
      const box = await dlg.boundingBox();
      expect(box && box.y >= 0 && box.y + box.height <= height, `diyalog ekran içinde (${scheme})`).toBe(true);
      const cancel = page.getByTestId("un-connect-cancel");
      await cancel.scrollIntoViewIfNeeded();
      await expect(cancel).toBeInViewport({ ratio: 1 });
      const cb = await cancel.boundingBox();
      expect(cb && cb.height >= 44, "dokunma hedefi ≥ 44 px").toBe(true);
      await cancel.click();
      await expect(dlg).toBeHidden();
      expect(posts).toBe(0);
      await ctx.close();
    }
  });
}

test("AC-444/352 eski servis (hello.unattended.intervene:false): kilitle / oturumu kapat pasif + 'güncelleyin' nedeni, istek yok", async ({
  page,
  context,
  browser,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p7");
  await unattendedWs(page, { deviceId: D1, deviceName: "ESKI-PC", consentMode: "no_user", intervene: false });
  const calls: string[] = [];
  await page.route(/\/api\/v1\/sessions\/[0-9A-Z]{26}\/unattended\/(lock|logoff)$/, async (r) => {
    calls.push(r.request().url());
    await r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("stage-unattended-wait")).toBeVisible(); // konsol WS'i bağlandı (sahte ajan ondan sonra)
  const a = await startFakeAgent(browser, id);
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  await expect.poll(async () => (await agentLog(a)).asked).toBe(true); // otomatik kontrol isteği
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

test("r3 bekleme: kip henüz yokken onay beklemesi yok — 'Cihaz bağlanıyor…'; kipli hello rozet çizmez", async ({ page, context }) => {
  await signIn(context, "p7");
  const h = await unattendedWs(page, { deviceId: D1, deviceName: "AKTIF-PC", intervene: true });
  const { id } = await newSession(page);
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("stage-unattended-wait")).toContainText("Cihaz bağlanıyor…");
  await expect(page.getByTestId("stage-consent-wait")).toHaveCount(0);
  expect(h.first).not.toBeNull();
  h.send({ ...h.first, unattended: { deviceId: D1, deviceName: "AKTIF-PC", consentMode: "no_user", intervene: true } });
  await expect(page.getByTestId("stage-unattended-wait")).toContainText("Cihaz bağlanıyor…");
  await expect(page.getByTestId("un-mode-badge")).toHaveCount(0);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "waiting");
});
