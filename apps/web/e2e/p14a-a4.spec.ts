import { expect, test, type Page } from "@playwright/test";
import { SESSION_COOKIE } from "@remote/contracts/api/auth";
import { axeScan, desktopOnly, guardConsole, noHorizontalOverflow, signIn } from "./helpers";

// P14a A4 + P14b B3 bölüm 2 (AC-206, 211, 215, 216, 225, 226). Sahte API: mock-audit (u-ausasu-*: step-up),
// mock-users (u-usadm-*: If-Match/sürüm, u-ussa-*), mock-requests (u-rqadm-*: /ws/panel 4429 kancası),
// mock-history (u-hadm-*: 150 teknisyen, u-hsa-*: 250 firma).
guardConsole();
const MOCK = "http://127.0.0.1:4217";
const CAN = "01JKS00000000000000000000B";

const isMysqlPut = (r: { method(): string; url(): string }) => r.method() === "PUT" && r.url().endsWith("/api/v1/admin/settings/mysql");

async function openMysql(page: Page) {
  await page.goto("/admin/settings/mysql");
  await expect(page.getByTestId("mysql-form")).toHaveAttribute("data-ready", "true");
}

test.describe("AC-215 step-up", () => {
  test("AC-215: 401 → diyalog (odak tuzağı, hatalı kod aria-live, kurtarma kodu, kalan ≤ 3 uyarısı) → istek bir kez tekrarlanır", async ({
    page,
    context,
  }, info) => {
    desktopOnly(info.project.name);
    await signIn(context, "ausasu");
    await openMysql(page);
    const puts: unknown[] = [];
    page.on("request", (r) => {
      if (isMysqlPut(r)) puts.push(r.postDataJSON());
    });
    await page.getByTestId("mysql-database").fill("remote2");
    await page.getByTestId("save-bar-save").click();

    const dlg = page.getByTestId("step-up-dialog");
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole("heading", { name: "Kimliğinizi doğrulayın" })).toBeVisible();
    await expect(dlg.getByTestId("step-up-code")).toBeFocused();
    // Odak tuzağı: Tab ve Shift+Tab diyalogdan çıkmaz
    for (const key of ["Tab", "Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="step-up-dialog"]')))).toBe(true);
    }
    // Boş gönderim: istek yok, alan hatası
    await dlg.getByTestId("step-up-submit").click();
    await expect(dlg.getByTestId("step-up-live")).toHaveText("Bu alan zorunludur.");
    // Hatalı kod (sunucu 400 fields.code): alan temizlenir, hata aria-live bölgesinde duyurulur
    await dlg.getByTestId("step-up-code").fill("111111");
    await dlg.getByTestId("step-up-submit").click();
    await expect(dlg.getByTestId("step-up-live")).toHaveText(/Kod hatalı/);
    await expect(dlg.getByTestId("step-up-live")).toHaveAttribute("aria-live", "assertive");
    await expect(dlg.getByTestId("step-up-code")).toHaveValue("");
    await expect(dlg.getByTestId("step-up-code")).toHaveAttribute("aria-invalid", "true");
    expect(await axeScan(page, '[data-testid="step-up-dialog"]')).toEqual([]);

    // "Kurtarma kodu kullan" geçişi → alan değişir ve odaklanır
    await dlg.getByTestId("step-up-mode").click();
    await expect(dlg.getByTestId("step-up-recovery")).toBeFocused();
    await expect(dlg.getByTestId("step-up-mode")).toHaveText("Uygulama kodunu kullan");
    await dlg.getByTestId("step-up-recovery").fill("abcde-fghij");
    await dlg.getByTestId("step-up-submit").click();
    // Kalan 2 kod (≤ 3) → yenileme uyarısı + hesap sayfası bağlantısı; istek henüz tekrarlanmadı
    await expect(dlg.getByTestId("step-up-low")).toContainText("Yalnız 2 kurtarma kodunuz kaldı");
    await expect(dlg.getByRole("link", { name: /Hesabım/ })).toHaveAttribute("href", "/account#mfa-h");
    expect(puts).toHaveLength(1);
    await dlg.getByTestId("step-up-continue").click();
    await expect(page.getByText("MySQL ayarı kaydedildi")).toBeVisible();
    await expect(dlg).toBeHidden();
    expect(puts).toHaveLength(2);
    expect(puts[1]).toEqual(puts[0]);

    // 5 dk içinde ikinci yazım step-up istemez
    await page.getByTestId("mysql-database").fill("remote3");
    await page.getByTestId("save-bar-save").click();
    await expect(page.getByTestId("mysql-restart")).toBeVisible();
    await expect(dlg).toBeHidden();
    await expect.poll(() => puts.length).toBe(3);
  });

  test("AC-215: vazgeçilirse istek tekrarlanmaz, oturum düşmez, form üstünde açıklama; 429 süreli kilit metni", async ({
    page,
    context,
  }, info) => {
    desktopOnly(info.project.name);
    await signIn(context, "ausasu");
    await openMysql(page);
    await page.getByTestId("mysql-database").fill("remote2");
    await page.getByTestId("save-bar-save").click();
    const dlg = page.getByTestId("step-up-dialog");
    await dlg.getByTestId("step-up-code").fill("000000");
    await dlg.getByTestId("step-up-submit").click();
    await expect(dlg.getByTestId("step-up-live")).toHaveText(/5 dakika sonra/);
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
    await expect(page).toHaveURL(/\/admin\/settings\/mysql$/);
    await expect(page.getByText("kimliğinizi doğrulamadınız")).toBeVisible();
    // Kaydedilmemiş değişiklik korunur; tekrar denemede diyalog yeniden açılır ve TOTP ile geçer
    await expect(page.getByTestId("mysql-database")).toHaveValue("remote2");
    await page.getByTestId("save-bar-save").click();
    await expect(dlg.getByTestId("step-up-code")).toBeFocused();
    await dlg.getByTestId("step-up-code").fill("123456");
    await page.keyboard.press("Enter");
    await expect(page.getByText("MySQL ayarı kaydedildi")).toBeVisible();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`AC-215: step-up diyaloğu 390 px taşma yok + axe 0 (${scheme})`, async ({ page, context }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(context, "ausasu");
      await openMysql(page);
      await noHorizontalOverflow(page);
      expect(await axeScan(page)).toEqual([]);
      await page.getByTestId("mysql-database").fill("remote2");
      await page.getByTestId("save-bar-save").click();
      await expect(page.getByTestId("step-up-dialog")).toBeVisible();
      await page.getByTestId("step-up-submit").click();
      await expect(page.getByTestId("step-up-live")).not.toBeEmpty();
      await noHorizontalOverflow(page);
      expect(await axeScan(page, '[data-testid="step-up-dialog"]')).toEqual([]);
    });
  }
});

test("AC-211: kayıtlı 'TLS gerekli' forma yüklenir ve kayıtta korunur (false'a düşmez); kapatınca false gider", async ({
  page,
  context,
}, info) => {
  desktopOnly(info.project.name);
  await signIn(context, "ausasu");
  await openMysql(page);
  const sw = page.getByTestId("mysql-require-tls");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(sw).toHaveAccessibleName("TLS gerekli");
  await expect(page.getByTestId("mysql-tls-note")).toContainText("TLS ile yapılır");
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (isMysqlPut(r)) bodies.push(r.postDataJSON() as Record<string, unknown>);
  });
  await page.getByTestId("mysql-database").fill("remote2");
  await page.getByTestId("save-bar-save").click();
  await page.getByTestId("step-up-code").fill("123456");
  await page.getByTestId("step-up-submit").click();
  await expect(page.getByText("MySQL ayarı kaydedildi")).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ database: "remote2", requireTls: true });
  await expect(sw).toHaveAttribute("aria-checked", "true");

  // Yalnız kutuyu kapatmak formu kirletir ve false gönderir
  await sw.click();
  await expect(page.getByTestId("mysql-tls-note")).toContainText("TLS kullanmaz");
  await expect(page.getByTestId("save-bar")).toBeVisible();
  await page.getByTestId("save-bar-save").click();
  await expect.poll(() => bodies.at(-1)?.requireTls).toBe(false);
});

test.describe("AC-206 kullanıcı düzenleyici", () => {
  const sw = (p: Page, key: string) => p.getByTestId(`perm-${key}`).filter({ visible: true });

  test("AC-206: rol değiştirilip kaydetmeden geri alınınca kayıtlı ezmeler geri gelir", async ({ page, context }, info) => {
    desktopOnly(info.project.name);
    await signIn(context, "usadm");
    await page.goto(`/users/${CAN}`);
    await expect(sw(page, "remote_control.use")).toHaveAttribute("aria-checked", "true");
    await expect(sw(page, "users.view")).toHaveAttribute("aria-checked", "false");
    await page.getByTestId("ue-role").selectOption("ADMIN");
    await expect(sw(page, "users.view")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("ue-role").selectOption("USER");
    // Rol varsayılanı (tümü kapalı) değil, kayıtlı kullanıcıya özel ezmeler
    await expect(sw(page, "remote_control.use")).toHaveAttribute("aria-checked", "true");
    await expect(sw(page, "session_history.view")).toHaveAttribute("aria-checked", "true");
    await expect(sw(page, "users.view")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("save-bar")).toHaveCount(0);
  });

  test("AC-206: PATCH If-Match taşır; araya giren değişiklikte 409 mesajı + 'Yeniden yükle'", async ({ page, context }, info) => {
    desktopOnly(info.project.name);
    const cookie = await signIn(context, "usadm");
    await page.goto(`/users/${CAN}`);
    await page.getByTestId("ue-name").fill("Can Aydın Yeni");
    const patch = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/api/v1/users/${CAN}`));
    await page.getByTestId("save-bar-save").click();
    expect((await patch).headers()["if-match"]).toBe('"v1"');
    await expect(page.getByText("Can Aydın Yeni kaydedildi")).toBeVisible();

    // Başka bir yönetici kaydı değiştirdi (sürüm 2 → 3)
    await page.request.get(`${MOCK}/api/v1/users/${CAN}/__bump`, { headers: { Cookie: `${SESSION_COOKIE}=${cookie}` } });
    await page.getByTestId("ue-email").fill("can.yeni@ornek.com");
    await page.getByTestId("save-bar-save").click();
    const stale = page.getByTestId("user-stale");
    await expect(stale).toContainText("Kayıt başkası tarafından değiştirildi, yeniden yükleyin");
    expect(await axeScan(page)).toEqual([]);
    await stale.getByTestId("user-reload").click();
    await expect(stale).toHaveCount(0);
    await expect(page.getByTestId("ue-name")).toHaveValue("Can Aydın Yeni (güncel)");
    await expect(page.getByTestId("ue-email")).toHaveValue("can.aydin@ornek.com");
    // Güncel sürümle yeniden kaydetme geçer
    await page.getByTestId("ue-email").fill("can.yeni@ornek.com");
    const again = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/api/v1/users/${CAN}`));
    await page.getByTestId("save-bar-save").click();
    expect((await again).headers()["if-match"]).toBe('"v3"');
    await expect(page.getByText(/kaydedildi/).first()).toBeVisible();
    await expect(stale).toHaveCount(0);
  });
});

test.describe("AC-216 panel WS", () => {
  const upgrades = async (page: Page, cookie: string) =>
    ((await (await page.request.get(`${MOCK}/__e2e/rq/upgrades/${cookie}`)).json()) as { upgrades: number }).upgrades;
  const openSockets = async (page: Page, cookie: string) =>
    ((await (await page.request.get(`${MOCK}/__e2e/rq/sockets/${cookie}`)).json()) as { open: number }).open;

  test("AC-216: 4429 retry=<sn> → bekleyip sessizce yeniden bağlanır (konsol hatası 0)", async ({ page, context }, info) => {
    desktopOnly(info.project.name);
    const cookie = await signIn(context, "rqadm");
    await page.request.get(`${MOCK}/__e2e/rq/limit4429/${cookie}?n=1`);
    const t0 = Date.now();
    await page.goto("/requests");
    await expect.poll(() => upgrades(page, cookie), { timeout: 5000 }).toBe(2);
    await expect.poll(() => openSockets(page, cookie), { timeout: 5000 }).toBe(1);
    // retry=1 ± %20 → ikinci bağlantı en erken ~0,8 sn sonra
    expect(Date.now() - t0).toBeGreaterThanOrEqual(800);
  });

  test("AC-216: 12 sayfa/dk istemci içi gezintide tek bağlantı, yeniden açılmaz; konsol hatası 0", async ({ page, context }, info) => {
    desktopOnly(info.project.name);
    const cookie = await signIn(context, "rqadm");
    await page.goto("/requests");
    await expect.poll(() => openSockets(page, cookie)).toBe(1);
    const nav = page.getByRole("navigation", { name: "Ana menü" });
    const names = [/Oturumlar/, /geçmiş/i, /Talepler/, /Ayarlar/];
    const t0 = Date.now();
    for (let i = 0; i < 12; i++) {
      const name = names[i % names.length]!;
      await nav.getByRole("link", { name }).click();
      await expect(nav.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    }
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(await upgrades(page, cookie)).toBe(1);
    expect(await openSockets(page, cookie)).toBe(1);
  });
});

test.describe("AC-225/226 seçenek uçları", () => {
  test("AC-225: teknisyen seçenekleri /users/options'tan tam liste (150 teknisyen → 150 seçenek)", async ({ page, context }, info) => {
    desktopOnly(info.project.name);
    await signIn(context, "hadm");
    await page.goto("/history");
    const sel = page.getByTestId("history-tech");
    // "Tümü" + 150
    await expect(sel.locator("option")).toHaveCount(151);
    await expect(sel.locator("option", { hasText: "Teknisyen 150" })).toHaveCount(1);
    await expect(sel.locator("option", { hasText: "(pasif)" }).first()).toBeAttached();
    await expect(page.getByTestId("history-filters")).not.toContainText("bu sayfadaki kayıtlardan");
  });

  test("AC-225: Super Admin — firma seçilmeden teknisyen seçici pasif + ipucu; firma seçilince liste /users/options?tenantId= ucundan (kayıtlarda olmayan teknisyen dahil)", async ({
    page,
    context,
  }) => {
    await signIn(context, "hsa");
    const optionCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/users/options")) optionCalls.push(r.url());
    });
    await page.goto("/history");
    const filters = page.getByTestId("history-filters");
    const sel = page.getByTestId("history-tech");
    await expect(sel).toBeDisabled();
    await expect(sel.locator("option")).toHaveCount(1); // yalnız "Tümü" — sayfa kayıtlarından seçenek üretilmez
    await expect(filters).toContainText("Önce firma seçin");
    await expect(filters).not.toContainText("bu sayfadaki kayıtlardan");
    expect(optionCalls).toEqual([]);

    // Firma seçilir (istemci) → o firmanın tam listesi uçtan
    const box = filters.getByRole("combobox", { name: "Firma", exact: true });
    await box.click();
    await box.pressSequentially("Örnek", { delay: 30 });
    const list = page.getByTestId("history-tenant-combobox").getByRole("listbox");
    await expect(list.getByRole("option").first()).toContainText("Örnek Lojistik");
    await list.getByRole("option").first().click();
    await expect(sel).toBeEnabled();
    await expect(sel.locator("option")).toHaveCount(3);
    await expect(sel.locator("option", { hasText: "Lojistik Teknisyeni" })).toHaveCount(1);
    await expect(filters).not.toContainText("Önce firma seçin");
    expect(optionCalls.some((u) => new URL(u).searchParams.get("tenantId") === "01JTENA0000000000000000002")).toBe(true);
    // Uygula → URL'de firma; sunucu tarafı da aynı uçtan (sayfa yenilense de liste korunur)
    await sel.selectOption({ label: "Lojistik Teknisyeni" });
    await page.getByTestId("filter-apply").click();
    await expect(page).toHaveURL(/tenantId=01JTENA0000000000000000002/);
    await expect(page).toHaveURL(/technicianId=01JTECHR00000000000000000Z/);
    await page.reload();
    await expect(page.getByTestId("history-tech")).toBeEnabled();
    await expect(page.getByTestId("history-tech")).toHaveValue("01JTECHR00000000000000000Z");
    await expect(page.getByTestId("history-tech").locator("option")).toHaveCount(3);

    // URL'de firma yokken seçili teknisyen "Seçili (…)" olarak korunur, seçici pasif
    await page.goto("/history?technicianId=01JTECHR00000000000000000Z");
    await expect(page.getByTestId("history-tech")).toBeDisabled();
    await expect(page.getByTestId("history-tech").locator("option", { hasText: "Seçili" })).toHaveCount(1);
  });

  test("AC-226: firma seçici — 250 firmada q ile sunucu süzer (≤ 20, 250 ms gecikme), klavyeyle seçilir", async ({
    page,
    context,
  }, info) => {
    desktopOnly(info.project.name);
    await signIn(context, "hsa");
    await page.goto("/history");
    const calls: { url: string; ms: number }[] = [];
    const started = new Map<string, number>();
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/admin/tenants/options")) started.set(r.url(), Date.now());
    });
    page.on("response", (r) => {
      const u = r.url();
      if (u.includes("/api/v1/admin/tenants/options")) calls.push({ url: u, ms: Date.now() - (started.get(u) ?? Date.now()) });
    });
    const box = page.getByTestId("history-filters").getByRole("combobox", { name: "Firma", exact: true });
    await box.click();
    const list = page.getByTestId("history-tenant-combobox").getByRole("listbox");
    await expect(list.getByRole("option")).toHaveCount(20);
    await box.pressSequentially("ege", { delay: 40 });
    await expect(list.getByRole("option").first()).toContainText("Ege");
    await expect(list.getByRole("option")).toHaveCount(20);
    for (const o of await list.getByRole("option").all()) await expect(o).toContainText(/ege/i);
    // Gecikme: yazım sırasında ara istek yok — yalnız ilk açılış + son metin
    const searches = calls.filter((c) => new URL(c.url).searchParams.has("q"));
    expect(searches.map((c) => new URL(c.url).searchParams.get("q"))).toEqual(["ege"]);
    expect(new URL(searches[0]!.url).searchParams.get("limit")).toBe("20");
    for (const c of calls) expect(c.ms).toBeLessThanOrEqual(500);
    // Klavye: ↓ ↓ Enter → ikinci seçenek
    const second = (await list.getByRole("option").nth(1).locator("span").first().textContent())!;
    await box.press("ArrowDown");
    await box.press("ArrowDown");
    await expect(box).toHaveAttribute("aria-activedescendant", /.+/);
    await box.press("Enter");
    await expect(box).toHaveValue(second);
    await expect(list).toHaveCount(0);
    await page.getByTestId("filter-apply").click();
    await expect(page).toHaveURL(/tenantId=01JTENAX/);
    await expect(page.getByTestId("history-filters").getByRole("combobox", { name: "Firma", exact: true })).toHaveValue(second);
  });

  test("AC-226: üst menü firma seçici klavyeyle — yaz, ↓, Enter; Esc listeyi kapatır, menü açık kalır", async ({ page, context }, info) => {
    desktopOnly(info.project.name);
    await signIn(context, "ussa");
    await page.goto("/admin/tenants");
    const switcher = page.getByTestId("tenant-switcher");
    await switcher.locator("summary").click();
    const box = switcher.getByRole("combobox", { name: "Etkin firma" });
    await expect(box).toBeFocused();
    const list = switcher.getByRole("listbox");
    await expect(list.getByRole("option")).toHaveCount(2);
    await box.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(switcher.locator("details")).toHaveAttribute("open", "");
    await box.pressSequentially("acm");
    await expect(list.getByRole("option")).toHaveCount(1);
    await box.press("ArrowDown");
    await box.press("Enter");
    await expect(page.getByText("Acme Bilişim firmasına geçildi")).toBeVisible();
    await expect(switcher).toHaveAttribute("data-acting", "01JTN00000000000000000000B");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`AC-225/226: geçmiş filtreleri 390 px taşma yok + axe 0, açık firma listesiyle (${scheme})`, async ({ page, context }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(context, "hsa");
      await page.goto("/history");
      await page.getByTestId("history-filters").getByRole("combobox", { name: "Firma", exact: true }).click();
      await expect(page.getByTestId("history-tenant-combobox").getByRole("option").first()).toBeVisible();
      await noHorizontalOverflow(page);
      expect(await axeScan(page)).toEqual([]);
    });
  }
});
