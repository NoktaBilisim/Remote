import { expect, test, type Page } from "@playwright/test";
import { axeScan, desktopOnly, guardConsole, newSession, noHorizontalOverflow, scanBoth, signIn } from "./helpers";

// P28c-K2 (mimari-p28c r2 §10) — AC-364, 366, 367, 368, 369, 372 (arayüz). Sahte API: e2e/mock-p28c.mjs (u-p28c*),
// konsol WS'i e2e/mock-ws.mjs (`multiHello` → hello tid/techRole/roster).
guardConsole();

const REASON = "Gece bakım penceresinde sunucu güncellemesini izliyorum";

async function ownConsole(page: Page) {
  const r = await page.request.get("/api/v1/__e2e/p28c-own");
  const { id } = (await r.json()) as { id: string };
  await page.goto(`/sessions/${id}/console`);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "live");
  await page.getByTestId("techs-toggle").click();
}

test("AC-364 davet bildirimi: kart, silent notu, Reddet; Katıl → katılımcı konsolu, Oturumu bitir yok, Ayrıl", async ({
  page,
  context,
}) => {
  await signIn(context, "p28cinv");
  await page.goto("/sessions");
  const cards = page.getByTestId("invite-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: "SUNUCU-01" })).toContainText("gerekçe");
  await page.getByRole("button", { name: "Reddet: SUNUCU-01" }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "Katıl: Ali Müşteri" }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9A-Z]{26}\/console$/);
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "live");
  await expect(page.getByTestId("console-end")).toHaveCount(0);
  await expect(page.getByTestId("console-verify-code")).toHaveCount(0);
  await page.getByTestId("techs-toggle").click();
  const rows = page.getByTestId("techs-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Ayşe Sahip" }).getByTestId("techs-owner")).toHaveText("Oturum sahibi");
  await expect(rows.filter({ hasText: "Elif Teknisyen" }).getByTestId("techs-role")).toHaveText("Katılımcı");
  await expect(page.getByTestId("techs-invite")).toHaveCount(0);
  await page.getByTestId("techs-leave").click();
  await expect(page.getByTestId("techs-confirm")).toBeVisible();
  await page.getByTestId("techs-confirm-ok").click();
  await expect(page.getByTestId("console-ended")).toContainText("Oturumdan ayrıldınız");
});

test("AC-368/372 etkin oturumlar: pasif nedenler; silent İzle gerekçe ister → izleyici konsolu, sohbete yazamaz", async ({
  page,
  context,
}) => {
  await signIn(context, "p28csup");
  await page.goto("/sessions");
  const sec = page.getByTestId("active-sessions");
  await expect(sec.getByTestId("active-row")).toHaveCount(4);
  const old = sec.getByTestId("active-row").filter({ hasText: "Eski İstemci" });
  await expect(old.getByTestId("active-watch")).toBeDisabled();
  await expect(old.getByTestId("active-block")).toContainText("güncel sürümü indirmesini isteyin");
  const asked = sec.getByTestId("active-row").filter({ hasText: "IZINLI-PC" });
  await expect(asked.getByTestId("active-watch")).toBeDisabled();
  await expect(asked.getByTestId("active-block")).toHaveText("İzinli gözetimsiz bağlantıya ek teknisyen katılamaz");
  await page.getByRole("button", { name: "İzle: SUNUCU-01" }).click();
  const dlg = page.getByTestId("mt-reason-dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId("mt-reason-notify")).toHaveText("Firma yöneticilerine bildirim gider.");
  await dlg.getByTestId("un-silent-reason").fill("kısa");
  await dlg.getByTestId("mt-reason-submit").click();
  await expect(dlg.getByTestId("un-silent-reason-error")).toBeVisible();
  await dlg.getByTestId("un-silent-reason").fill(REASON);
  await dlg.getByTestId("mt-reason-submit").click();
  await expect(page).toHaveURL(/\/sessions\/[0-9A-Z]{26}\/console$/);
  await expect(page.getByTestId("chat-readonly")).toHaveText("İzleyici olarak sohbete yazamazsınız");
  await expect(page.getByTestId("chat-input")).toHaveCount(0);
});

test("AC-364/367/369 sahip: Kontrolü ver, Oturumu devret onayı, Davet et (arama) → bekleyen davet → Geri çek", async ({
  page,
  context,
}) => {
  await signIn(context, "p28cown");
  await ownConsole(page);
  await expect(page.getByTestId("techs-count")).toHaveText("2/3");
  await expect(page.getByRole("button", { name: "Kontrolü ver: Burak Katılımcı" })).toBeVisible();
  await page.getByRole("button", { name: "Oturumu devret: Burak Katılımcı" }).click();
  const confirm = page.getByTestId("techs-confirm");
  await expect(confirm).toContainText("Burak Katılımcı");
  await confirm.getByRole("button", { name: "Vazgeç" }).click();
  await page.getByTestId("techs-invite").click();
  const dlg = page.getByTestId("invite-dialog");
  await expect(dlg.getByTestId("invite-send")).toHaveCount(2);
  await dlg.getByTestId("invite-search").fill("selin");
  await expect(dlg.getByTestId("invite-send")).toHaveCount(1);
  await dlg.getByRole("button", { name: "Davet et: Selin Destek" }).click();
  await expect(dlg).toBeHidden();
  const pending = page.getByTestId("techs-pending");
  await expect(pending).toContainText("Selin Destek");
  // Koltuklar dolu (2 + 1 bekleyen) → Davet et pasif + neden (AC-365)
  await expect(page.getByTestId("techs-invite")).toBeDisabled();
  await expect(page.getByTestId("techs-invite-block")).toContainText("en çok 3");
  await page.getByRole("button", { name: "Daveti geri çek: Selin Destek" }).click();
  await expect(pending).toHaveCount(0);
  await expect(page.getByTestId("techs-invite")).toBeEnabled();
});

test("AC-372 misafir multi1 yok (hello.guestMulti=false): Davet et baştan pasif + AC-352 metni", async ({ page, context }) => {
  await signIn(context, "p28cunsup");
  await ownConsole(page);
  await expect(page.getByTestId("techs-invite")).toBeDisabled();
  await expect(page.getByTestId("techs-invite-block")).toContainText("güncel sürümü indirmesini isteyin");
  await expect(page.getByTestId("techs-invite")).toHaveAttribute("aria-describedby", /.+/);
});

test("AC-364 bekleyen giden davet sunucudan (GET …/invites): sayfa yenilenince de görünür, Geri çek", async ({ page, context }) => {
  await signIn(context, "p28cown");
  await ownConsole(page);
  await expect(page.getByTestId("techs-pending")).toHaveCount(0);
  await page.getByTestId("techs-invite").click();
  await page.getByTestId("invite-dialog").getByRole("button", { name: "Davet et: Kerem Yardımcı" }).click();
  await expect(page.getByTestId("techs-pending")).toContainText("Kerem Yardımcı");
  await page.reload();
  await expect(page.getByTestId("console")).toHaveAttribute("data-phase", "live");
  await page.getByTestId("techs-toggle").click();
  await expect(page.getByTestId("techs-pending")).toContainText("Kerem Yardımcı");
  await page.getByRole("button", { name: "Daveti geri çek: Kerem Yardımcı" }).click();
  await expect(page.getByTestId("techs-pending")).toHaveCount(0);
  await page.reload();
  await page.getByTestId("techs-toggle").click();
  await expect(page.getByTestId("techs-row")).toHaveCount(2);
  await expect(page.getByTestId("techs-pending")).toHaveCount(0);
});

test("AC-287 etkin oturumlar + davet kartı 375 px, açık/koyu: taşma yok, axe 0; konsol paneli axe", async ({
  browser,
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await scanBoth(browser, "p28csup", "/sessions", 375, async (p) => {
    await expect(p.getByTestId("active-row").first()).toBeVisible();
  });
  await scanBoth(browser, "p28cinv", "/sessions", 375, async (p) => {
    await expect(p.getByTestId("invite-card").first()).toBeVisible();
  });
  await signIn(context, "p28cown");
  await ownConsole(page);
  await expect(page.getByTestId("techs-row")).toHaveCount(2);
  await noHorizontalOverflow(page);
  expect(await axeScan(page, '[data-testid="techs-panel"]')).toEqual([]);
});

test("AC-370 audit: 'Çoklu teknisyen' seçenek grubu → P28c eylemi süzülür, Türkçe etiket", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "auadm");
  await page.goto("/audit");
  const sel = page.getByTestId("audit-filters").getByLabel("İşlem");
  await expect(sel.locator('optgroup[label="Çoklu teknisyen"] option')).not.toHaveCount(0);
  await sel.selectOption("session.participant_remove");
  await page.getByTestId("audit-filters").getByTestId("filter-apply").click();
  await expect(page).toHaveURL(/action=session\.participant_remove/);
  const row = page.locator('[data-testid="audit-row"], [data-testid="audit-card"]').filter({ visible: true });
  await expect(row).toHaveCount(1);
  await expect(row.first()).toContainText("Müşteri teknisyeni çıkardı");
});

test("AC-366 müşteri 'Bağlı teknisyenler': roster çizilir, sahipte Çıkar yok; Çıkar onaylı → tech.remove → listeden düşer", async ({
  page,
  browser,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "p5");
  const s = await newSession(page);
  await page.goto(`/sessions/${s.id}/console`);
  const g = await (await browser.newContext()).newPage();
  await g.goto(new URL(s.link).pathname);
  await expect(g.getByTestId("join-form")).toHaveAttribute("data-ready", "true");
  await g.getByTestId("guest-name").fill("Ali Müşteri");
  await g.getByTestId("guest-consent").check();
  await g.getByTestId("join-browser").click();
  const code = ((await g.getByTestId("admit-code").getAttribute("aria-label")) ?? "").replace(/\s/g, "");
  await page.getByTestId("admit-input").fill(code);
  await page.getByTestId("admit-submit").click();
  await expect(page.getByTestId("console-status")).toHaveText("Aktif");
  expect((await page.request.get(`http://127.0.0.1:4217/__e2e/guest-roster/${s.id}`)).status()).toBe(200);
  const list = g.getByTestId("guest-techs");
  await expect(list.getByTestId("guest-tech")).toHaveCount(2);
  await expect(list).toContainText("Oturum sahibi");
  await expect(list.getByTestId("guest-tech-remove")).toHaveCount(1); // sahip çıkarılamaz
  await list.getByRole("button", { name: "Çıkar: Burak Katılımcı" }).click();
  const dlg = g.getByTestId("guest-remove-confirm");
  await expect(dlg).toContainText("Burak Katılımcı oturumdan çıkarılsın mı?");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  await dlg.getByRole("button", { name: "Vazgeç" }).click();
  await expect(list.getByTestId("guest-tech")).toHaveCount(2);
  await list.getByRole("button", { name: "Çıkar: Burak Katılımcı" }).click();
  await dlg.getByTestId("guest-remove-ok").click();
  await expect(list.getByTestId("guest-tech")).toHaveCount(1);
  await expect(list).not.toContainText("Burak Katılımcı");
  expect(await axeScan(g, '[data-testid="guest-techs"]')).toEqual([]);
  await g.context().close();
});
