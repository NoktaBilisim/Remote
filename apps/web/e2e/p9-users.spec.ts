import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { CSRF_COOKIE, SESSION_COOKIE } from "@remote/contracts/api/auth";
import { axeScan, guardConsole, noHorizontalOverflow } from "./helpers";

// P9 kullanıcı/yetki/firma yönetimi — panel (AC-70..74). Sahte API: e2e/mock-users.mjs (u-usadm-* ADMIN audit.export hariç,
// u-usro-* USER yalnız users.view, u-usempty/usbroken/usslow durumlar, u-ussa-* SUPER_ADMIN).
guardConsole();
const desktopOnly = (name: string) => test.skip(name !== "desktop", "masaüstü akışı");
const CAN = "01JKS00000000000000000000B";
const ELIF = "01JKS00000000000000000000C";
const SELF = "01JKS00000000000000000000A";

async function signInUs(context: BrowserContext, scenario = "usadm") {
  const value = `u-${scenario}-${Math.random().toString(36).slice(2)}`;
  const base = { domain: "localhost", path: "/", secure: true, sameSite: "Strict" as const };
  await context.addCookies([
    { ...base, name: SESSION_COOKIE, value, httpOnly: true },
    { ...base, name: CSRF_COOKIE, value: "csrf-test-token" },
  ]);
}
const rows = (p: Page) => p.locator('[data-testid="user-row"], [data-testid="user-card"]').filter({ visible: true });
const sw = (p: Page, key: string) => p.getByTestId(`perm-${key}`).filter({ visible: true });

test("AC-71/73 kritik akış: kullanıcı oluştur → geçici şifre bir kez → yetki ekranı", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signInUs(context);
  await page.goto("/users");
  await expect(page).toHaveTitle(/Kullanıcılar/);
  const nav = page.getByRole("navigation", { name: "Ana menü" });
  await expect(nav.getByRole("link", { name: "Kullanıcılar" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Firmalar" })).toHaveCount(0); // yalnız Super Admin
  await expect(rows(page)).toHaveCount(3); // aktifler (vars.)
  await expect(rows(page).filter({ hasText: "Zeynep Koç" })).toContainText("(siz)");

  await page.getByTestId("user-new").click();
  const form = page.getByTestId("user-form");
  await expect(form.getByLabel("Ad soyad")).toBeFocused();
  await form.getByTestId("uf-submit").click();
  await expect(form.getByLabel("Ad soyad")).toHaveAttribute("aria-invalid", "true");
  await expect(form.getByLabel("Ad soyad")).toBeFocused();
  await form.getByLabel("Ad soyad").fill("Mert Yılmaz");
  await form.getByLabel("E-posta").fill("CAN.AYDIN@ornek.com");
  await form.getByLabel("Rol").selectOption("ADMIN");
  await expect(form).toContainText("sizde olmayan yetkiler hariç");
  await form.getByTestId("uf-submit").click();
  // 409: e-posta alanının altında
  await expect(form.getByText("Bu e-posta adresi başka bir hesapta kullanılıyor")).toBeVisible();
  await form.getByLabel("E-posta").fill("mert@ornek.com");
  const post = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/v1/users"));
  await form.getByTestId("uf-submit").click();
  // Admin olmayan yetkiyi (audit.export) açıkça false gönderir (AC-73)
  expect((await post).postDataJSON()).toMatchObject({ role: "ADMIN", permissions: { "audit.export": false, "users.edit": true } });

  const pw = page.getByTestId("user-temp-password");
  await expect(pw.getByRole("heading")).toHaveText("Mert Yılmaz oluşturuldu");
  await expect(pw).toContainText("yalnız şimdi gösterilir");
  await expect(pw.getByTestId("temp-password")).toHaveValue("Gx7-kP2m-Qw9r-Lt4z");
  await expect(pw.getByTestId("pw-copy")).toBeFocused();
  await pw.getByTestId("pw-copy").click();
  await expect(pw.getByRole("status").filter({ hasText: "Kopyalandı" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Gx7-kP2m-Qw9r-Lt4z");
  expect(await axeScan(page, '[data-testid="user-temp-password"]')).toEqual([]);
  await pw.getByTestId("pw-edit-perms").click();

  await expect(page).toHaveURL(/\/users\/01JKS/);
  await expect(page.getByTestId("user-name")).toHaveText("Mert Yılmaz");
  await expect(page.getByText("Gx7-kP2m-Qw9r-Lt4z")).toHaveCount(0);
  // Kilitli yetki: Admin'de olmayan audit.export
  await expect(sw(page, "audit.export")).toHaveAttribute("aria-disabled", "true");
  await expect(sw(page, "audit.export")).toHaveAttribute("aria-checked", "false");
  // Tekrar gösterilmez: listeye dönüp yeniden açınca şifre yok
  await page.goto("/users");
  await expect(rows(page).filter({ hasText: "Mert Yılmaz" })).toHaveCount(1);
  await expect(page.getByTestId("temp-password")).toHaveCount(0);
});

test("geçici şifre kopyalanmadan kapatılırsa uyarı; 'Yine de kapat' sonrası liste yenilenir", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInUs(context);
  await page.goto("/users");
  await page.getByTestId("user-new").click();
  const form = page.getByTestId("user-form");
  await form.getByLabel("Ad soyad").fill("Ece Kaya");
  await form.getByLabel("E-posta").fill("ece@ornek.com");
  await form.getByTestId("uf-submit").click();
  const pw = page.getByTestId("user-temp-password");
  await pw.getByTestId("pw-done").click();
  await expect(pw.getByTestId("pw-not-copied")).toContainText("bir daha gösterilmez");
  await expect(pw.getByRole("button", { name: "Şifreye dön" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pw.getByTestId("pw-not-copied")).toHaveCount(0);
  await expect(pw.getByTestId("temp-password")).toBeVisible();
  await pw.getByTestId("pw-done").click();
  await pw.getByTestId("pw-close-anyway").click();
  await expect(pw).toBeHidden();
  await expect(rows(page).filter({ hasText: "Ece Kaya" })).toHaveCount(1);
});

test("AC-71 grup 'Tümünü aç/kapat' (mixed), kayıt, kaydedilmemiş değişiklik uyarısı", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInUs(context);
  await page.goto(`/users/${CAN}`);
  await expect(page).toHaveTitle(/Can Aydın/);
  await expect(page.getByRole("navigation", { name: "Konum" })).toContainText("Kullanıcılar");
  // Tüm modüller tanımdan (AC-71: en az 7 modül + talepler + müşteriler)
  for (const m of ["Oturumlar", "Uzaktan kontrol", "Dosya transferi", "Oturum geçmişi", "Destek talepleri", "Müşteriler", "Kullanıcılar", "Ayarlar", "Audit log"])
    await expect(page.getByTestId("permission-table").getByRole("rowheader", { name: m })).toBeVisible();
  await expect(sw(page, "sessions.terminate")).toHaveAccessibleName("Oturumlar — Zorla sonlandır");
  const group = page.getByTestId("perm-group-sessions").filter({ visible: true });
  await expect(group).toHaveAttribute("aria-checked", "mixed");
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  await group.click();
  await expect(group).toHaveAttribute("aria-checked", "true");
  for (const k of ["view", "create", "edit", "delete", "terminate"]) await expect(sw(page, `sessions.${k}`)).toHaveAttribute("aria-checked", "true");
  await group.click();
  await expect(group).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("save-bar")).toBeVisible();
  await page.getByTestId("save-bar-reset").click();
  await expect(group).toHaveAttribute("aria-checked", "mixed");
  await expect(page.getByTestId("save-bar")).toHaveCount(0);

  // Klavye: grup anahtarı Space ile
  await page.getByTestId("perm-group-users").filter({ visible: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("perm-group-users").filter({ visible: true })).toHaveAttribute("aria-checked", "true");

  // Ayrılma uyarısı (uygulama içi bağlantı)
  await page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Oturumlar" }).click();
  const leave = page.getByTestId("leave-dialog");
  await expect(leave).toBeVisible();
  await expect(leave.getByRole("button", { name: "Sayfada kal" })).toBeFocused();
  await leave.getByRole("button", { name: "Sayfada kal" }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${CAN}$`));

  const patch = page.waitForRequest((r) => r.method() === "PATCH");
  await page.getByTestId("save-bar-save").click();
  expect((await patch).postDataJSON()).toEqual({ permissions: { "users.view": true, "users.create": true, "users.edit": true, "users.delete": true } });
  await expect(page.getByText("Can Aydın kaydedildi · yetki değişiklikleri audit log'a yazıldı")).toBeVisible();
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  await page.reload();
  await expect(sw(page, "users.delete")).toHaveAttribute("aria-checked", "true");
  expect(await axeScan(page)).toEqual([]);
});

test("AC-73 Admin sahip olmadığı yetki kilitli; geniş yetkili hesap salt okunur; kendi hesabı", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInUs(context);
  await page.goto(`/users/${CAN}`);
  const lockedSw = sw(page, "audit.export");
  await expect(lockedSw).toHaveAttribute("aria-disabled", "true");
  await expect(lockedSw).toHaveAccessibleDescription(/sahip olmadığınız yetkiyi veremez/);
  await lockedSw.click({ force: true }); // aria-disabled: Playwright normalde tıklamaz
  await expect(lockedSw).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
  // Grup: kilitsiz olan açılır, kilitli kalır → karışık
  const g = page.getByTestId("perm-group-audit").filter({ visible: true });
  await g.click();
  await expect(sw(page, "audit.view")).toHaveAttribute("aria-checked", "true");
  await expect(lockedSw).toHaveAttribute("aria-checked", "false");
  await expect(g).toHaveAttribute("aria-checked", "mixed");
  // Rol ADMIN: kilitsizler açılır, kilitli kapalı kalır
  await page.getByTestId("ue-role").selectOption("ADMIN");
  await expect(sw(page, "settings.edit")).toHaveAttribute("aria-checked", "true");
  await expect(lockedSw).toHaveAttribute("aria-checked", "false");
  const patch = page.waitForRequest((r) => r.method() === "PATCH");
  await page.getByTestId("save-bar-save").click();
  const body = (await patch).postDataJSON() as { role: string; permissions: Record<string, boolean> };
  expect(body.role).toBe("ADMIN");
  expect(body.permissions["audit.export"]).toBe(false); // rol değişince kilitli anahtar açıkça false (QA P9 Tur1 #1)

  // Kendisinden geniş yetkili Admin (audit.export'u var) → salt okunur, pasife alma yok
  await page.goto(`/users/${ELIF}`);
  await expect(page.getByTestId("user-notice")).toContainText("düzenleme yetkiniz yok");
  await expect(page.getByTestId("ue-name")).toBeDisabled();
  await expect(sw(page, "users.view")).toBeDisabled();
  await expect(page.getByTestId("user-deactivate")).toHaveCount(0);

  // Kendi hesabı: rol/yetki değiştirilemez, pasife alınamaz; ad düzenlenebilir
  await page.goto(`/users/${SELF}`);
  await expect(page.getByTestId("user-notice")).toContainText("pasife alamazsınız");
  await expect(page.getByTestId("ue-role")).toBeDisabled();
  await expect(sw(page, "users.view")).toBeDisabled();
  await expect(page.getByTestId("ue-name")).toBeEnabled();
  await expect(page.getByTestId("user-deactivate")).toHaveCount(0);
});

test("AC-73 rol yükseltme: kilitli anahtarı olan Admin USER→ADMIN kaydeder (200), kilitli yetki kapalı kalır", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInUs(context); // usadm: audit.export yok → kilitli
  await page.goto(`/users/${CAN}`);
  await expect(sw(page, "audit.export")).toHaveAttribute("aria-disabled", "true");
  // Sahte API sunucu kuralıyla aynı: gövdede olmayan anahtar YENİ rol varsayılanını alır → yalnız rol gönderilirse
  // audit.export açılır ve 403 fields["permissions.audit.export"] döner (eski istemci davranışı).
  const bare = await page.evaluate(async (id) => {
    const csrf = document.cookie.match(/(?:^|; )__Host-rs_csrf=([^;]*)/)?.[1] ?? "";
    const r = await fetch(`/api/v1/users/${id}`, { method: "PATCH", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ role: "ADMIN" }) });
    return { status: r.status, body: (await r.json()) as { error?: { fields?: Record<string, string> } } };
  }, CAN);
  expect(bare.status).toBe(403);
  expect(Object.keys(bare.body.error?.fields ?? {})).toEqual(["permissions.audit.export"]);

  await page.getByTestId("ue-role").selectOption("ADMIN");
  await expect(sw(page, "users.delete")).toHaveAttribute("aria-checked", "true");
  await expect(sw(page, "audit.export")).toHaveAttribute("aria-checked", "false");
  const res = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/users/${CAN}`));
  await page.getByTestId("save-bar-save").click();
  const done = await res;
  expect(done.status()).toBe(200);
  expect(done.request().postDataJSON()).toMatchObject({ role: "ADMIN", permissions: { "audit.export": false, "users.delete": true } });
  await expect(page.getByText("Can Aydın kaydedildi")).toBeVisible();
  await expect(page.getByTestId("user-save-error")).toHaveCount(0);
  await expect(page.getByTestId("save-bar")).toHaveCount(0);

  // Kalıcı: yeniden yüklemede ADMIN, kilitli yetki kapalı, diğerleri açık
  await page.reload();
  await expect(page.getByTestId("ue-role")).toHaveValue("ADMIN");
  await expect(sw(page, "audit.export")).toHaveAttribute("aria-checked", "false");
  await expect(sw(page, "settings.edit")).toHaveAttribute("aria-checked", "true");
});

test("pasife alma: onay diyaloğu (odak Vazgeç, oturum uyarısı) → Pasif, yeniden etkinleştir", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInUs(context);
  await page.goto(`/users/${CAN}`);
  await page.getByTestId("user-deactivate").click();
  const dlg = page.getByTestId("user-deactivate-dialog");
  await expect(dlg.getByRole("heading")).toHaveText("Can Aydın pasife alınsın mı?");
  await expect(dlg).toContainText("Açık destek oturumları sonlanır");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  expect(await axeScan(page, '[data-testid="user-deactivate-dialog"]')).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("user-status")).toHaveText("Aktif");
  await page.getByTestId("user-deactivate").click();
  await dlg.getByTestId("user-action-confirm").click();
  await expect(page.getByText("Can Aydın pasife alındı")).toBeVisible();
  await expect(page.getByTestId("user-status")).toHaveText("Pasif");
  await expect(page.getByTestId("user-notice")).toContainText("pasif");
  await expect(page.getByTestId("ue-name")).toBeDisabled();
  await page.goto("/users");
  await expect(rows(page).filter({ hasText: "Can Aydın" })).toHaveCount(0);
  await page.getByRole("button", { name: "Pasif", exact: true }).click();
  await expect(page).toHaveURL(/status=passive/);
  await expect(rows(page).filter({ hasText: "Can Aydın" })).toHaveCount(1);
  await page.goto(`/users/${CAN}`);
  await page.getByTestId("user-reactivate").click();
  await page.getByTestId("user-reactivate-dialog").getByTestId("user-action-confirm").click();
  await expect(page.getByTestId("user-status")).toHaveText("Aktif");
});

test("liste: arama/rol filtresi, eşleşme yok, kapsam dışı id → bulunamadı", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInUs(context);
  await page.goto("/users");
  await page.getByTestId("user-search").fill("e");
  await expect(page.getByText("Aramak için en az 2 karakter yazın.")).toBeVisible();
  await page.getByTestId("user-search").fill("aydın");
  await expect(page).toHaveURL(/q=ayd/);
  await expect(rows(page)).toHaveCount(1);
  await page.getByTestId("user-search").fill("yokboyle");
  await expect(page.getByTestId("users-no-match")).toBeVisible();
  await page.getByTestId("users-no-match").getByRole("link", { name: "Filtreleri temizle" }).click();
  await expect(page).toHaveURL(/\/users$/);
  await page.getByTestId("user-role-filter").selectOption("ADMIN");
  await expect(page).toHaveURL(/role=ADMIN/);
  await expect(rows(page)).toHaveCount(2);
  await page.goto("/users/01JKS0000000000000000000ZZ");
  await expect(page.getByTestId("user-not-found")).toBeVisible();
});

test("5 durum: boş, hata + tekrar dene, yükleniyor, salt okunur yetki", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInUs(context, "usempty");
  await page.goto("/users");
  await expect(page.getByTestId("users-empty")).toContainText("Henüz kullanıcı yok");
  await expect(page.getByTestId("user-new-empty")).toBeVisible();

  await context.clearCookies();
  await signInUs(context, "usbroken");
  await page.goto("/users");
  await expect(page.getByTestId("load-error")).toBeVisible();
  await page.getByRole("button", { name: "Tekrar dene" }).click();
  await expect(rows(page)).toHaveCount(3);

  await context.clearCookies();
  await signInUs(context, "usslow");
  await page.goto("/users", { waitUntil: "commit" });
  await expect(page.getByTestId("users-loading")).toHaveAttribute("aria-busy", "true");
  await expect(rows(page)).toHaveCount(3, { timeout: 10_000 });
  await expect(page.getByTestId("users-loading")).toHaveCount(0);

  await context.clearCookies();
  await signInUs(context, "usro");
  await page.goto("/users");
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByTestId("user-new")).toHaveCount(0);
  await page.goto(`/users/${CAN}`);
  await expect(page.getByTestId("user-notice")).toContainText("düzenleme yetkiniz yok");
  await expect(page.getByTestId("user-deactivate")).toHaveCount(0);
  await expect(page.getByTestId("save-bar")).toHaveCount(0);
});

test("AC-70 Super Admin: firma seç → kullanıcılar; firma oluştur; pasife al (etkiler + kısa ad onayı)", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInUs(context, "ussa");
  await page.goto("/users");
  await expect(page.getByTestId("users-pick-tenant")).toBeVisible();
  const switcher = page.getByTestId("tenant-switcher");
  await expect(switcher.locator("summary")).toHaveAccessibleName("Firma seçilmedi. Firma seç");
  await switcher.locator("summary").click();
  await expect(switcher.getByTestId("tenant-switcher-list")).toBeVisible();
  // Yalnız aktif firmalar
  await expect(switcher.getByRole("button", { name: "Eski Müşteri A.Ş." })).toHaveCount(0);
  await switcher.getByRole("button", { name: "Demo Firma" }).click();
  await expect(page.getByText("Demo Firma firmasına geçildi")).toBeVisible();
  await expect(switcher).toHaveAttribute("data-acting", "01JTN00000000000000000000A");
  await expect(switcher.locator("summary")).toHaveAccessibleName("Etkin firma: Demo Firma. Firma değiştir");
  await expect(rows(page)).toHaveCount(3);

  const nav = page.getByRole("navigation", { name: "Ana menü" });
  await nav.getByRole("link", { name: "Firmalar" }).click();
  await expect(page).toHaveURL(/\/admin\/tenants$/);
  await expect(page).toHaveTitle(/Firmalar/);
  const demo = page.getByTestId("tenant-row").filter({ hasText: "Demo Firma" });
  await expect(demo.getByTestId("tenant-current")).toHaveText("Etkin firma");
  await expect(page.getByTestId("tenant-row")).toHaveCount(3);

  await page.getByTestId("tenant-new").click();
  const form = page.getByTestId("tenant-form");
  await form.getByLabel("Firma adı").fill("Şişli Bilişim A.Ş.");
  await expect(form.getByLabel("Kısa ad")).toHaveValue("sisli-bilisim-a-s");
  await form.getByLabel("Kısa ad").fill("acme");
  await form.getByTestId("tf-submit").click();
  await expect(form.getByText("Bu kısa ad başka bir firmada kullanılıyor")).toBeVisible();
  await form.getByLabel("Kısa ad").fill("sisli");
  await form.getByTestId("tf-submit").click();
  await expect(page.getByText("Şişli Bilişim A.Ş. oluşturuldu")).toBeVisible();
  const sisli = page.getByTestId("tenant-row").filter({ hasText: "Şişli Bilişim A.Ş." });
  await expect(sisli.getByTestId("tenant-status")).toHaveText("Aktif");

  await sisli.getByRole("button", { name: "Pasife al: Şişli Bilişim A.Ş." }).click();
  const dlg = page.getByTestId("tenant-deactivate-dialog");
  const effects = dlg.getByTestId("tenant-deactivate-effects");
  await expect(effects).toContainText("oturumu kapanır");
  await expect(effects).toContainText("Açık destek oturumları sonlanır");
  await expect(effects).toContainText("Bekleyen destek talepleri iptal edilir");
  await expect(effects).toContainText("Kayıtlı bilgisayarların");
  await expect(dlg.getByRole("button", { name: "Vazgeç" })).toBeFocused();
  expect(await axeScan(page, '[data-testid="tenant-deactivate-dialog"]')).toEqual([]);
  await dlg.getByTestId("tenant-action-confirm").click();
  await expect(dlg.getByText("Kısa ad eşleşmiyor")).toBeVisible();
  await dlg.getByTestId("tenant-deactivate-type").fill("sisli");
  await dlg.getByTestId("tenant-action-confirm").click();
  await expect(page.getByText("Şişli Bilişim A.Ş. pasife alındı")).toBeVisible();
  await expect(sisli.getByTestId("tenant-status")).toHaveText("Pasif");

  // Satırdan geçiş + bağlamdan çıkış
  await page.getByTestId("tenant-row").filter({ hasText: "Acme Bilişim" }).getByRole("button", { name: "Bu firmaya geç: Acme Bilişim" }).click();
  await expect(switcher).toHaveAttribute("data-acting", "01JTN00000000000000000000B");
  await switcher.locator("summary").click();
  await switcher.getByTestId("tenant-switcher-clear").click();
  await expect(switcher).toHaveAttribute("data-acting", "");
  expect(await axeScan(page)).toEqual([]);
});

test("firma düzenle: kısa ad değişince uyarı, kaydedilmemiş formda kapatma onayı", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInUs(context, "ussa");
  await page.goto("/admin/tenants");
  await page.getByRole("button", { name: "Düzenle: Acme Bilişim" }).click();
  const form = page.getByTestId("tenant-form");
  await expect(form.getByLabel("Kısa ad")).toHaveValue("acme");
  await form.getByLabel("Kısa ad").fill("acme-yeni");
  await expect(form.getByTestId("tf-slug-warning")).toContainText("eski giriş bağlantıları çalışmaz");
  await page.keyboard.press("Escape");
  const leave = page.getByTestId("tenant-form-leave");
  await expect(leave.getByRole("button", { name: "Düzenlemeye dön" })).toBeFocused();
  await leave.getByRole("button", { name: "Düzenlemeye dön" }).click();
  await form.getByLabel("Firma adı").fill("Acme Bilişim Ltd.");
  await form.getByTestId("tf-submit").click();
  await expect(page.getByText("Acme Bilişim Ltd. kaydedildi")).toBeVisible();
  await expect(page.getByTestId("tenant-row").filter({ hasText: "acme-yeni" })).toContainText("Acme Bilişim Ltd.");
});

test("Firmalar sayfası Admin'e kapalı", async ({ page, context }, info) => {
  desktopOnly(info.project.name);
  await signInUs(context);
  await page.goto("/admin/tenants");
  await expect(page.getByTestId("tenants-forbidden")).toBeVisible();
  await expect(page.getByTestId("tenant-switcher")).toHaveCount(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`mobil/masaüstü yerleşim + erişilebilirlik (${scheme})`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signInUs(context);
    await page.goto("/users");
    await expect(rows(page)).toHaveCount(3);
    await noHorizontalOverflow(page);
    expect(await axeScan(page)).toEqual([]);
    await page.goto(`/users/${CAN}`);
    await expect(page.getByTestId("permission-matrix")).toBeVisible();
    await noHorizontalOverflow(page);
    expect(await axeScan(page)).toEqual([]);
    // Dokunma hedefi ≥ 44 px
    const box = await sw(page, "sessions.view").boundingBox();
    expect(box && box.height >= 44 && box.width >= 44).toBe(true);
  });
}

test("TO-P9-1/6: Super Admin üst menüsü 375 px — taşma yok, çıkış tam görünür, etkin firma adı görünür", async ({ page, context }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signInUs(context, "ussa");
  await page.goto("/admin/tenants");
  await expect(page.getByTestId("tenant-card").first()).toBeVisible(); // 375 px → kart görünümü
  const switcher = page.getByTestId("tenant-switcher");
  const logout = page.getByRole("button", { name: /Çıkış yap/ });
  const fits = async () => {
    await noHorizontalOverflow(page);
    const b = await logout.boundingBox();
    expect(b && b.x >= 0 && b.x + b.width <= 375 && b.width >= 44 && b.height >= 44, "çıkış düğmesi kırpılmamalı").toBe(true);
    const s = await switcher.locator("summary").boundingBox();
    expect(s && s.x >= 0 && s.height >= 44, "seçici görünür alanda").toBe(true);
  };
  await expect(switcher.locator("summary")).toHaveText("Firma seçilmedi");
  await fits();

  await switcher.locator("summary").click();
  await switcher.getByRole("button", { name: "Demo Firma" }).click();
  await expect(switcher).toHaveAttribute("data-acting", "01JTN00000000000000000000A");
  await expect(switcher.locator("summary")).toHaveText("Demo Firma");
  await expect(switcher.locator("summary")).toHaveAccessibleName("Etkin firma: Demo Firma. Firma değiştir");
  await fits();
  // Menü paneli açıkken de sayfa yatay taşmaz (sağa hizalı)
  await switcher.locator("summary").click();
  await expect(switcher.getByTestId("tenant-switcher-list")).toBeVisible();
  await noHorizontalOverflow(page);
});
