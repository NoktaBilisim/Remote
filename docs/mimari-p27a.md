# Mimari — P27a: 2FA'da "Bu cihazı 30 gün hatırla"

Tarih: 2026-11-15 · Durum: Taslak (güvenlik tasarım turu bekliyor) · Gereksinim: `docs/gereksinimler.md` §11
(AC-325..AC-335) · İlgili: ADR-0008 (opak oturum + CSRF), ADR-0022 (step-up), AC-65/66/67/68 (P10), AC-215 (step-up),
P16 (kalıcı silme, ADR-0030). Yeni ADR yok: karar mevcut ADR-0008 çerez/özet kalıbını tekrarlar; aşağıdaki K-P27a
kararları bu dosyada kayıtlıdır.

## 1. Özet ve kısıtlar

Girişte TOTP adımında işaretlenebilen "Bu cihazı 30 gün hatırla" kutusu. İşaretlenirse tarayıcıya ayrı, yalnız auth
yoluna giden bir **güvenilir cihaz belirteci** çerezi yazılır; sonraki girişlerde **doğru şifreden sonra** bu belirteç
geçerliyse oturum doğrudan `mfa_passed = true` açılır. Başka hiçbir şey değişmez.

Değişmezler:

1. Şifre her girişte sorulur; kilit kuralları (AC-65) belirteçten önce ve aynen uygulanır.
2. **Step-up asla atlanmaz** (ADR-0022): belirteç `step_up_at` yazmaz; `requireStepUp` ve P27'deki "her gözetimsiz
   bağlantıda step-up tüketimi" değişmez.
3. Belirteç yalnız TOTP etkin kullanıcıda anlam taşır; 2FA kurulum aşaması (`setup`) atlanmaz.
4. Mevcut stack ve kalıplar: Fastify + Prisma + MySQL, opak token = 32 bayt rastgele, DB'de SHA-256 (ADR-0008),
   `writeAudit`, `AppError` zarfı, `@remote/contracts` zod, `t()` i18n, lucide ikonları. Yeni bağımlılık yok.

Kararlar (sadelik ilkesi: tek ekran / tek yol):

| No        | Karar                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K-P27a-1  | **Firma ayarı: tek anahtar** `tenant_settings.mfa_remember_device` ("2FA cihaz hatırlama"), **varsayılan açık**, mevcut Ayarlar → Güvenlik ekranında `requireTech2fa` anahtarının altında, aynı uç ve yetki (`PUT /settings/tenant`, `settings.edit`). Gerekçe: KVKK/denetim gereği bazı müşteriler "her girişte kod" isteyebilir; ayrı ekran/süre/rol seçeneği yok. Kapatma = o firmanın tüm cihazları aynı TX'te silinir (yarı durum yok). |
| K-P27a-2  | **Super Admin dahil**, firma anahtarından etkilenmez, ayrı sistem anahtarı yok. Gerekçe: isteği yapan kullanıcı Super Admin olarak günlük giriş yapıyor; Super Admin'in gerçekten hassas işlemleri (sistem ayarları, Super Admin kurtarma, firma kalıcı silme, API anahtarı) zaten step-up ister ve atlanmaz; şifre her girişte sorulur; ikinci bir ayar ekranı sadelik ilkesine aykırı. Risk kabulü güvenlik turuna açık (§5.4 T6).         |
| K-P27a-3  | Süre **sabit 30 gün**, kullanımda uzamaz (kayan değil). Sabit üst sınır, saldırı penceresini sınırlar ve denetimi basitleştirir.                                                                                                                                                                                                                                                                                                             |
| K-P27a-4  | Yalnız **TOTP** ile doğrulamada sunulur; kurtarma koduyla hatırlama yok (kurtarma kodu = acil durum; tek kullanımlık koda 30 günlük güven bağlanmaz).                                                                                                                                                                                                                                                                                        |
| K-P27a-5  | Kaldırma = **satır silme** (hard delete); geçmiş audit'te. `revoked_at` sütunu yok, sorgular sade.                                                                                                                                                                                                                                                                                                                                           |
| K-P27a-6  | Kullanıcı başına **≤ 10** cihaz; 11.'de en eski düşer.                                                                                                                                                                                                                                                                                                                                                                                       |
| K-P27a-7  | Çerez `__Secure-rs_td`, `Path=/api/v1/auth` (yalnız auth uçlarına gider: giriş, `me`, cihaz listesi), HttpOnly, Secure, SameSite=Strict, Max-Age 30 gün. `__Host-` öneki `Path=/` ister; yol kısıtı daha değerli olduğu için `__Secure-` seçildi.                                                                                                                                                                                            |
| K-P27a-8  | Tarayıcıda **tek** hatırlama çerezi: aynı tarayıcıda ikinci hesap hatırlanırsa çerez onunkiyle değişir; ilk hesabın satırı süresi dolana veya kaldırılana kadar listede kalır (zararsız; çerezi artık yok).                                                                                                                                                                                                                                  |
| K-P27a-9  | Admin tarafı tek yol: kullanıcı düzenleme ekranında **sayı + "Tümünü kaldır"**; tek tek liste yalnız kullanıcının kendi profilinde. Yeni yetki anahtarı **yok** (`users.view` / `users.edit`, `settings.edit` yeterli; permissions tek tanım değişmez).                                                                                                                                                                                      |
| K-P27a-10 | Yeni cihaz hatırlandığında e-posta bildirimi **Sonra** (S-P27a-1): audit + profil listesi + Admin sayısı ilk sürüm için yeterli.                                                                                                                                                                                                                                                                                                             |

## 2. Bileşenler ve akış

```mermaid
sequenceDiagram
  participant B as Tarayıcı
  participant W as apps/web (/login, /login/2fa)
  participant S as apps/server /api/v1/auth
  participant D as MySQL
  B->>S: POST /login {login, password} (+ çerez __Secure-rs_td?)
  S->>S: IP/çift/hesap kilidi, argon2 (DEĞİŞMEZ)
  alt şifre doğru, totp etkin, çerez geçerli (kullanıcı eşleşir, süresi dolmamış, politika açık)
    S->>D: TX: oturum (mfa_passed=1) + trusted_devices.last_used_at/ip + audit used
    S-->>B: {mfaRequired:false}
  else çerez yok/geçersiz
    S->>D: TX: oturum (mfa_passed=0) (+ bilinmeyen/süresi dolmuşsa çerez silinir)
    S-->>B: {mfaRequired:true} → /login/2fa
    B->>S: POST /mfa/verify {code, rememberDevice:true}
    S->>D: TX: TOTP tüket + oturum yenile + kullanıcı kilidi + trusted_devices INSERT (+ en eskiyi düşür) + audit created
    S-->>B: Set-Cookie __Secure-rs_td; {deviceRemembered:true}
  end
```

| Bileşen                                                            | Sorumluluk                                                                                                                                                                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/trusted-device-repo.ts` (yeni)                               | Tek veri erişim noktası: `insertTrustedDevice`, `findByHash`, `touch`, `listForUser`, `countForUser`, `deleteForUser(id?)`, `deleteForTenant`, `deleteOverLimit`, `deleteExpired`. Tüm geçersiz kılma çağrıları buradan; kopya yok. |
| `auth/trusted-device.ts` (yeni)                                    | Politika (`rememberAllowed(user)`), belirteç üretimi, `issue` (verify TX içinde), `consumeAtLogin` (login TX içinde), UA özeti (`uaSummary`, bağımlılıksız regex), çerez ayarları.                                                  |
| `auth/trusted-device-routes.ts` (yeni)                             | Profil uçları (`GET/DELETE /auth/trusted-devices[/:id]`).                                                                                                                                                                           |
| `auth/service.ts` `login`                                          | Şifre/kilit başarılı dalından sonra `consumeAtLogin`; `openSession(..., mfaPassed)`.                                                                                                                                                |
| `auth/account.ts` `mfaVerify`                                      | `rememberDevice` → `issue`.                                                                                                                                                                                                         |
| Geçersiz kılma noktaları                                           | §3.4 tablosu.                                                                                                                                                                                                                       |
| `apps/web` 2FA formu, Hesabım, kullanıcı düzenleme, Güvenlik ayarı | §6.                                                                                                                                                                                                                                 |

## 3. Veri modeli

### 3.1 Yeni tablo `trusted_devices`

| Alan           | Tip              | Not                                                                                                     |
| -------------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| `id`           | CHAR(26) PK      | ULID (`newId`)                                                                                          |
| `tenant_id`    | CHAR(26) NULL    | Kullanıcının firması (oluşturma anında `users.tenant_id`); Super Admin'de NULL. FK → `tenants` RESTRICT |
| `user_id`      | CHAR(26)         | FK → `users` RESTRICT (silme önce çocuk; P16 kalıbı)                                                    |
| `token_hash`   | CHAR(64) UNIQUE  | SHA-256 hex; düz belirteç DB'de yok                                                                     |
| `ua_summary`   | VARCHAR(80)      | "Chrome · Windows" gibi; tam UA saklanmaz (veri azaltma)                                                |
| `ip`           | VARCHAR(45)      | Son kullanım IP'si (oluşturmada oluşturan IP)                                                           |
| `created_at`   | DATETIME(3)      | UTC                                                                                                     |
| `last_used_at` | DATETIME(3) NULL | Son atlama anı; NULL = henüz kullanılmadı                                                               |
| `expires_at`   | DATETIME(3)      | `created_at + 30 gün`; **güncellenmez**                                                                 |
| `updated_at`   | DATETIME(3)      | Proje kuralı                                                                                            |

İndeksler: `UNIQUE(token_hash)`; `(user_id, created_at)` (liste, sınır, en eski); `(tenant_id)` (firma geneli silme,
P16); `(expires_at)` (saklama). Beklenen hacim: kullanıcı × ≤ 10 satır; büyüme yok.

Değişmezlik/doğruluk: `tenant_id` uygulama tarafından kullanıcı satırından kopyalanır (aynı TX). Kullanırken ek
koruma: `row.user_id === user.id` **ve** `row.tenant_id <=> user.tenant_id` (eşleşmezse yok sayılır).

### 3.2 `tenant_settings` yeni sütun

`mfa_remember_device BOOLEAN NOT NULL DEFAULT TRUE`. Mevcut satırlar migration'da TRUE alır.

### 3.3 Grants / migration / silme

- `apps/server/prisma/sql/grants.sql`: `GRANT SELECT, INSERT, UPDATE, DELETE ON trusted_devices TO app`.
- Migration `p27a_trusted_devices` (migrator): CREATE TABLE + ALTER `tenant_settings` ADD COLUMN. Geri alma:
  DROP TABLE + DROP COLUMN (veri kaybı yalnız hatırlama; kullanıcılar bir kez TOTP girer). Seed değişmez.
- Saklama işi (`jobs/retention*`): `expires_at < now` satırları toplu silinir (sayaç `trustedDevices`).
- Firma kalıcı silme: `jobs/tenant-purge-repo.ts` `USER_CHILDREN`'a `byTenantUser("trusted_devices")`; meta-test
  (tenants'a FK veren tablolar) yeni tabloyu ister.
- KVKK silme: `cli/erasure.ts` `DELETE FROM trusted_devices WHERE user_id = ?` (`auth_sessions` satırının yanına).

### 3.4 Geçersiz kılma noktaları (AC-328) — hepsi aynı TX'te, `trusted-device-repo` ile

| Olay                                   | Dosya / işlev                                                     | Kapsam                    | Audit                                                                        |
| -------------------------------------- | ----------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| Şifre değişimi                         | `auth/service.ts` `changePassword`                                | kullanıcının tümü         | mevcut `auth.password_change` `newValue.revokedTrustedDevices`               |
| E-postayla şifre sıfırlama             | `auth/password-reset.ts` `resetPassword`                          | tümü                      | `auth.password_reset` + sayı                                                 |
| Super Admin sıfırlama (CLI/panel)      | `auth/superadmin-reset.ts`                                        | tümü                      | `auth.superadmin_reset` + sayı                                               |
| Admin 2FA sıfırlama                    | `users/writes.ts` `resetMfaTx`                                    | tümü                      | `USER_AUDIT.MFA_RESET` + sayı                                                |
| 2FA (yeniden) etkinleştirme            | `auth/account.ts` `mfaEnable`                                     | tümü                      | `auth.mfa_enabled` + sayı                                                    |
| Tüm cihazlardan çıkış                  | `auth/account.ts` `logoutAll`                                     | tümü (**bu cihaz dahil**) | `auth.logout_all` + sayı; yanıt çerezi siler                                 |
| Kullanıcı pasif (silme pasiften geçer) | `users/writes.ts` `writeStatus(PASSIVE)`                          | tümü                      | `USER_AUDIT.DEACTIVATED` + sayı                                              |
| Firma pasif                            | `tenants/service.ts` (pasif dalı, `revokeTenantSessions` yanında) | firmanın tümü             | mevcut firma pasif audit'i + sayı                                            |
| Firma ayarı kapatıldı                  | `tenants/settings.ts` (ayar yazımı)                               | firmanın tümü             | mevcut ayar audit'i `{mfaRememberDevice: true→false, revokedTrustedDevices}` |
| Profil: tek/tümü                       | `auth/trusted-device-routes.ts`                                   | seçilen / tümü            | `auth.trusted_device_revoked {reason:"user", count}`                         |
| Admin: tümü                            | `users/routes.ts` + `users/writes.ts` `forgetDevicesTx`           | tümü                      | `auth.trusted_device_revoked {reason:"admin", count}`                        |
| Sınır (11.)                            | `auth/trusted-device.ts` `issue`                                  | en eski                   | `auth.trusted_device_revoked {reason:"limit", count:1}`                      |

Süresi dolan satır audit'lenmez (saklama işi sayaç metriği yeter).

## 4. API sözleşmesi

Tüm uçlar `/api/v1` altında; hata zarfı ve kodlar mevcut (`packages/contracts/src/errors.ts`), yeni hata kodu yok.
Değiştiren uçlarda mevcut CSRF (ADR-0008 çift gönderim) ve Origin denetimi aynen.

### 4.1 Değişen uçlar

| Uç                      | Değişiklik                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/login`      | Girdi değişmez. Çerez `__Secure-rs_td` okunur. Yanıt şekli değişmez; atlamada `mfaRequired: false`. Bilinmeyen/süresi dolmuş belirteçte `Set-Cookie` ile çerez silinir; başka kullanıcının geçerli belirtecine dokunulmaz.                                                                                       |
| `POST /auth/mfa/verify` | Girdi: `z.union([z.strictObject({ code: totpCodeSchema, rememberDevice: z.boolean().optional() }), z.strictObject({ recoveryCode: recoveryCodeSchema })])` → kurtarma koduyla `rememberDevice` 400 `VALIDATION`. Yanıt `MfaVerifyResponse` + `deviceRemembered: boolean`. Politika kapalıysa `true` yok sayılır. |
| `GET /auth/me`          | `mfa` (MfaStatus) nesnesine `rememberDeviceAvailable: boolean` (aşama `verify` ve politika açıksa true; 2FA sayfası kutuyu buna göre gösterir).                                                                                                                                                                  |
| `POST /auth/logout-all` | Yanıt `LogoutAllResponse` + `revokedTrustedDevices: number`; çerezi siler.                                                                                                                                                                                                                                       |
| `PUT /settings/tenant`  | `updateTenantSettingsInputSchema` + `mfaRememberDevice: z.boolean().optional()`; `TenantSettingsView` + `mfaRememberDevice: boolean`. Yetki `settings.edit` (mevcut).                                                                                                                                            |
| `GET /users/:id`        | `UserDetail` + `trustedDeviceCount: number` (yetki `users.view`, mevcut tenant kapsamı).                                                                                                                                                                                                                         |

### 4.2 Yeni uçlar

| Uç                                 | Yetki                                       | Girdi                         | Çıktı                                                                                          | Hatalar                         |
| ---------------------------------- | ------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------- |
| `GET /auth/trusted-devices`        | tam oturum (`requireAuth`), yalnız kendi    | —                             | `TrustedDeviceListResponse { items: TrustedDeviceView[] }` (en yeni önce, ≤ 10, sayfalama yok) | 401                             |
| `DELETE /auth/trusted-devices/:id` | tam oturum, yalnız kendi                    | `params: { id: ulidSchema }`  | `{ revoked: 1, currentCleared: boolean }`                                                      | 400, 401, 404 (başkasının/yok)  |
| `DELETE /auth/trusted-devices`     | tam oturum, yalnız kendi                    | —                             | `{ revoked: number, currentCleared: boolean }`                                                 | 401                             |
| `POST /users/:id/forget-devices`   | `users.edit` + `assertManage`; kendi id 403 | `params: { id }` , gövde `{}` | `{ revoked: number }`                                                                          | 403, 404 (başka firma), 409 yok |

```ts
// packages/contracts/src/api/auth.ts (ekler)
export const TRUSTED_DEVICE_COOKIE = "__Secure-rs_td";
export const TRUSTED_DEVICE_COOKIE_PATH = "/api/v1/auth";
export const TRUSTED_DEVICE_DAYS = 30;
export const TRUSTED_DEVICE_MAX_PER_USER = 10;
export interface TrustedDeviceView {
  id: string;
  uaSummary: string; // "Chrome · Windows"; çözülemezse "Bilinmeyen tarayıcı"
  ip: string; // son kullanım IP'si (kullanıcının kendi verisi, maskesiz)
  createdAt: string; // ISO UTC
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean; // istek çerezinin özeti bu satırla eşleşiyor
}
```

Uç sırası (mevcut kalıp): `requireAuth` → (yetki) → zod → servis → audit → yanıt. Yanıtlar `Cache-Control: no-store`.
Silmede `current` eşleşirse aynı yanıtta `clearCookie(TRUSTED_DEVICE_COOKIE, { path })`.

### 4.3 Audit (`packages/contracts/src/audit.ts` `AUTH_AUDIT` ekleri)

| Sabit                    | Eylem                         | entity / entityId            | newValue                                                     |
| ------------------------ | ----------------------------- | ---------------------------- | ------------------------------------------------------------ |
| `TRUSTED_DEVICE_CREATED` | `auth.trusted_device_created` | `trusted_devices` / satır id | `{ uaSummary, expiresAt }`                                   |
| `TRUSTED_DEVICE_USED`    | `auth.trusted_device_used`    | `trusted_devices` / satır id | `{ uaSummary }` (+ mevcut `auth.login` success satırı aynen) |
| `TRUSTED_DEVICE_REVOKED` | `auth.trusted_device_revoked` | `users` / hedef kullanıcı id | `{ reason: "user" \| "admin" \| "limit", count }`            |

Belirteç, özeti, tam UA yazılmaz (IP ve UA mevcut audit bağlamından gelir). Toplu geçersiz kılmalar §3.4'teki mevcut
olay satırına `revokedTrustedDevices` alanı olarak eklenir (ayrı satır yok). Audit ekranı filtre listesi
`AUTH_AUDIT`'ten üretildiği için ek iş yok.

## 5. Güvenlik tasarımı

### 5.1 Doğrulama kuralı (`consumeAtLogin`, login TX'i içinde, şifre + kilit başarılı daldan sonra)

Atlama ancak hepsi doğruysa: `user.totpEnabled` · çerez var ve `^[A-Za-z0-9_-]{43}$` · `findByHash(sha256)` satırı
var · `row.user_id = user.id` ve `row.tenant_id <=> user.tenant_id` · `row.expires_at > now` · `rememberAllowed(user)`
(Super Admin → true; diğer → `tenant.settings.mfaRememberDevice`). Değilse normal `verify` aşaması. Kilitli hesapta /
hatalı şifrede bu kod **çalışmaz** (çerez denenmez, sayaçlar aynen). Belirteç sorgusu yalnız şifre doğrulandıktan sonra
yapılır → belirteç tahmini şifre gerektirir; ek hız sınırı gerekmez (IP 20/dk ve hesap kilidi geçerli). 256 bit
belirteç kaba kuvvetle tahmin edilemez.

### 5.2 Oluşturma (`issue`, `mfaVerify` TX'i içinde)

`rememberDevice === true` · TOTP ile doğrulandı · `rememberAllowed` → `SELECT … FROM users WHERE id=? FOR UPDATE`
(sınır yarışı için) → `INSERT` → `deleteOverLimit(userId, 10)` (en eski) → audit. Commit sonrası çerez yazılır. Aynı
tarayıcıda eski bir belirteç varsa önce o satır silinir (kullanıcıya aitse) — bir tarayıcı = bir satır.

### 5.3 Çerez

`__Secure-rs_td=<43 karakter>; Path=/api/v1/auth; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`. Caddy logu çerez
yazmaz (G-10, mevcut). Next.js `proxy.ts` çerezi yalnız iletir; web kodu okumaz.

### 5.4 Tehdit notları (güvenlik tasarım turu için)

| No  | Tehdit                                           | Önlem / kabul                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Çerez çalınması (zararlı yazılım, cihaz erişimi) | Tek başına işe yaramaz: şifre ayrıca gerekir; step-up atlanmaz; 30 gün sabit üst sınır; kullanıcı/Admin kaldırabilir; şifre değişimi hepsini düşürür. Belirteç cihaza/IP'ye bağlanmaz (kabul: mobil IP değişir; IP bağlama yanlış alarm üretir) — `last_used_at`/`ip` profilde görünür. |
| T2  | Paylaşılan / ortak bilgisayar                    | Kutu **varsayılan işaretsiz**, altında yardım metni "Yalnız kişisel cihazınızda işaretleyin"; "Tüm cihazlardan çıkış" bu cihazı da düşürür; Admin uzaktan kaldırır; firma anahtarı kapatılabilir.                                                                                       |
| T3  | XSS                                              | HttpOnly → JS okuyamaz. XSS ile oturum içi işlem zaten oturum tehdidi; mevcut CSP (uygulama üretir) aynen. Cihaz listesi uçları belirteci asla döndürmez.                                                                                                                               |
| T4  | CSRF                                             | SameSite=Strict + mevcut CSRF başlığı + login'de Origin denetimi. Login CSRF ile kurbana saldırganın hesabını açtırmak mevcut korumalarla engelli; hatırlama çerezi yalnız eşleşen kullanıcıda etkili.                                                                                  |
| T5  | Belirteç sızıntısı (log/DB)                      | DB'de yalnız SHA-256; log/audit/yanıtta yok (AC-333 testi); DB dökümü belirteç vermez.                                                                                                                                                                                                  |
| T6  | Super Admin hesabı (K-P27a-2)                    | Kabul edilen risk: çalınan Super Admin cihazı + şifre → 30 gün TOTP'siz panel girişi; hassas sistem işlemleri step-up ister. Güvenlik turu Yüksek bulursa geri dönüş: `rememberAllowed` içinde `role === "SUPER_ADMIN" → false` (tek satır, şema değişmez).                             |
| T7  | Oturum sabitleme / yükseltme                     | Atlamada yeni oturum `openSession` ile açılır (mevcut); `step_up_at` NULL.                                                                                                                                                                                                              |
| T8  | Firma izolasyonu / IDOR                          | Profil uçları `user_id = auth.user.id` sorgusu; Admin ucu mevcut `tenantScope` + `assertManage`; başka firma 404.                                                                                                                                                                       |
| T9  | Geçersiz kılmanın unutulması                     | Tüm noktalar tek repo işlevini çağırır; §3.4 tablosu birebir entegrasyon testi (AC-328).                                                                                                                                                                                                |

## 6. Arayüz (apps/web) — DESIGN.md token'ları, lucide ikonları, açık/koyu tema, masaüstü/mobil

| Ekran                                                                                                                                        | Değişiklik                                                                                                                                                                                                                                                       | Durumlar                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login/2fa` (`mfa-verify-form.tsx`)                                                                                                         | Kod alanı ile gönder düğmesi arasında mevcut `Checkbox` bileşeni (yoksa DESIGN.md'deki form denetimi): `mfa.v.remember` + yardım `mfa.v.rememberHint`. Yalnız `code` modunda ve `me.mfa.rememberDeviceAvailable` true ise. Klavye ile erişilir, etiket tıklanır. | Mevcut form durumları; kutu gönderim sırasında `disabled`.                                                                                                                                  |
| Hesabım → "Hatırlanan cihazlar" (yeni `components/account/trusted-devices.tsx`, `account-security.tsx` içinde "Oturumlar" bölümünün üstünde) | Bölüm ikonu `MonitorCheck`; satır: `Laptop` ikonu + UA özeti, "Bu cihaz" rozeti, tarih/IP satırı, `Trash2` "Kaldır" (danger-ghost). Altta "Tümünü kaldır" (`Trash2`) → onay diyaloğu. Tarihler mevcut tarih biçimleyiciyle (tr-TR, yerel saat).                  | Yükleniyor: 2 satır skeleton · Boş: `acc.td.empty` · Hata: `FormError` + "Yeniden dene" (`RotateCw`) · Kısmi: silme başarısızsa satır kalır, toast hata · Başarılı: toast `acc.td.removed`. |
| Kullanıcı düzenleme (`users/[id]`)                                                                                                           | Güvenlik grubunda "2FA'yı sıfırla"nın yanında: `acc.td.adminCount` metni + `users.edit` varsa "Hatırlanan cihazları kaldır" (`MonitorX`), sayı 0 iken düğme pasif. Mevcut `user-dialogs` onay kalıbı.                                                            | Mevcut editör durumları + hata toast'ı.                                                                                                                                                     |
| Ayarlar → Güvenlik (`security-form.tsx`)                                                                                                     | `requireTech2fa` anahtarının altında ikinci `Switch`: `sec.rememberLabel`, açıklama `sec.rememberDesc`; kapatmada onay diyaloğu (`sec.rememberOffConfirm`, silinecek cihazlar uyarısı). Anında kayıt (mevcut kalıp), salt okunurda pasif.                        | Mevcut.                                                                                                                                                                                     |

i18n anahtarları (`apps/web/messages/tr.json`): `mfa.v.remember` "Bu cihazı 30 gün hatırla", `mfa.v.rememberHint`
"Yalnız kişisel cihazınızda işaretleyin. Hassas işlemlerde kod yine sorulur.", `acc.td` "Hatırlanan cihazlar",
`acc.td.body`, `acc.td.empty`, `acc.td.current` "Bu cihaz", `acc.td.created`, `acc.td.lastUsed`, `acc.td.never`,
`acc.td.expires`, `acc.td.remove`, `acc.td.removeAll`, `acc.td.confirmTitle`, `acc.td.confirmBody`, `acc.td.removed`,
`acc.td.removedAll`, `acc.td.adminCount` "{n} hatırlanan cihaz", `acc.td.adminRemove`, `acc.td.adminConfirm`,
`sec.rememberLabel` "2FA cihaz hatırlama", `sec.rememberDesc`, `sec.rememberOffConfirm`, `sec.rememberSavedOn`,
`sec.rememberSavedOff`. Animasyon: yalnız mevcut diyalog/toast; yeni animasyon yok.

## 7. Dosya planı (görev başına; iki görev aynı dosyaya dokunmaz)

| Görev   | Dosyalar                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P27a-K1 | `apps/server/prisma/schema.prisma`, `apps/server/prisma/migrations/<ts>_p27a_trusted_devices/migration.sql`, `apps/server/prisma/sql/grants.sql`, `docs/db-notlari.md`                                                                                                                                                                                                                                           |
| P27a-K2 | `packages/contracts/src/api/auth.ts`, `api/tenants.ts`, `api/users.ts`, `audit.ts` (+ contracts testleri); `apps/server/src/auth/trusted-device-repo.ts` (yeni) + `test/unit/trusted-device-repo.test.ts`                                                                                                                                                                                                        |
| P27a-K3 | `apps/server/src/auth/trusted-device.ts` (yeni), `auth/trusted-device-routes.ts` (yeni), `auth/routes.ts`, `auth/service.ts`, `auth/account.ts`, `auth/repo.ts` (LoginUser select'ine `mfaRememberDevice`), `auth/password-reset.ts`, `auth/superadmin-reset.ts`, `app-routes.ts` (gerekirse kayıt) + `test/integration/p27a-auth.test.ts`, `test/unit/trusted-device.test.ts`                                   |
| P27a-K4 | `apps/server/src/users/routes.ts`, `users/writes.ts`, `users/view.ts`, `users/service.ts`, `tenants/service.ts`, `tenants/settings.ts`, `tenants/repo.ts`, `jobs/retention-repo.ts`, `jobs/retention.ts`, `jobs/retention-counts.ts`, `jobs/tenant-purge-repo.ts`, `cli/erasure.ts` + `test/integration/p27a-revoke.test.ts`                                                                                     |
| P27a-K5 | `apps/web/app/(auth)/login/2fa/mfa-verify-form.tsx`, `apps/web/components/account/trusted-devices.tsx` (yeni), `app/(panel)/account/account-security.tsx`, `app/(panel)/users/[id]/user-editor-parts.tsx`, `user-dialogs.tsx`, `use-user-editor.ts`, `app/(panel)/settings/security/security-form.tsx`, `lib/account/contract.ts`, `messages/tr.json`, `e2e/p27a-trusted-device.spec.ts`, `e2e/mock-account.mjs` |
| P27a-K6 | `docs/runbook.md` (§ "Hatırlanan cihazlar": toplu iptal SQL'i olay anında, saklama sayaç alanı), `docs/implementation.md` yalnız ilgili geliştirici satırları kendi görevinde                                                                                                                                                                                                                                    |
| P27a-K9 | `README.md`, `docs/api.md`, `CHANGELOG.md`, `docs/KULLANIM_KILAVUZU.md`, `docs/DATASHEET.md`, `docs/pdf/*`                                                                                                                                                                                                                                                                                                       |

`docs/implementation.md`: K3/K4/K5 her biri yalnız kendi alt başlığını ekler (sıralı birleştirme; çakışmada son yazan
diğerini korur). Env değişkeni **yok** (`.env.example`, `env.ts`, compose değişmez).

## 8. Performans, operasyon

- Girişte +1 indeksli sorgu (`token_hash` UNIQUE) yalnız şifre doğruysa; ihmal edilebilir. Önbellek yok.
- Metrik: mevcut saklama sayaçlarına `trustedDevices`; login loguna `trustedDevice: true|false` alanı (belirteçsiz).
- Migration sıfır kesintili (yeni tablo + varsayılanlı sütun). Rollback: önceki imaja dönüş; tablo kalır, kullanılmaz;
  gerekirse ters migration. Yedek: mevcut MySQL yedeği kapsar (özetler; gizli değer yok).
- Olay anı (runbook): tüm hatırlamaları düşürmek için `DELETE FROM trusted_devices;` (migrator değil, `app` yetkisi
  yeter) — sonuç: herkes bir kez TOTP girer.

## 9. Test stratejisi

| AC      | Seviye                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------- |
| 325     | integration (verify + çerez öznitelikleri + DB özet) · e2e (kutu görünür/gizli, kurtarma modunda yok)                      |
| 326     | integration (atlama, sabit `expires_at`, hatalı şifre sayacı, kilitli 423, süresi dolmuş → çerez silinir, başka kullanıcı) |
| 327     | integration (atlamayla açılan oturumda step-up korumalı uç 401 `MFA_STEP_UP_REQUIRED`)                                     |
| 328     | integration, §3.4 tablosundaki her satır ayrı `it`                                                                         |
| 329–330 | integration (404/403, `current`) · e2e (liste, kaldır, tümünü kaldır, Admin düğmesi; 5 durum; mobil)                       |
| 331     | integration (kapalıyken yok sayma + toplu silme + Super Admin istisnası) · e2e (anahtar + onay)                            |
| 332     | unit + integration (11. cihaz, paralel iki verify)                                                                         |
| 333     | unit (belirteç uzunluğu/alfabe) · integration (log yakalama: belirteç/özet geçmez)                                         |
| 334     | integration (saklama, firma purge meta-testi, erasure)                                                                     |
| 335     | tüm suite: `pnpm -r run lint && pnpm -r run typecheck && pnpm -r run test && pnpm --filter @remote/web e2e`                |

## 10. Görev paketleri ve atama

| Paket   | Ajan                          | Bağımlı olduğu                                  | Paralel mi                 | AC                                  |
| ------- | ----------------------------- | ----------------------------------------------- | -------------------------- | ----------------------------------- |
| P27a-K1 | dba                           | —                                               | K2 ile paralel             | 334 (şema/grants)                   |
| P27a-K2 | backend-dev                   | —                                               | K1 ile paralel             | 333 (sabitler), sözleşme            |
| P27a-K3 | backend-dev                   | K1, K2                                          | K4 ‖ K5 ‖ K6 ile paralel   | 325–328 (auth dalı), 332, 333       |
| P27a-K4 | backend-dev                   | K1, K2                                          | K3 ‖ K5 ‖ K6 ile paralel   | 328 (diğer noktalar), 330, 331, 334 |
| P27a-K5 | frontend-dev                  | K2 (sözleşme)                                   | K3 ‖ K4 ‖ K6; e2e mock ile | 325, 329, 330, 331 (UI)             |
| P27a-K6 | devops                        | K1                                              | K3 ‖ K4 ‖ K5               | 334 (runbook)                       |
| P27a-K7 | qa-denetci                    | K3, K4, K5, K6                                  | K8 ile paralel             | hepsi, 335                          |
| P27a-K8 | guvenlik                      | K3, K4, K5 (tasarım turu K1'den önce, bu belge) | K7 ile paralel             | §5.4                                |
| P27a-K9 | test-operatoru → teknik-yazar | K7 GEÇTİ + K8 Kritik/Yüksek 0                   | sıralı                     | 329–331 elle tur, dokümantasyon     |

## 11. Kabul kriterleri eşlemesi

| AC     | Bileşen / uç                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------- |
| AC-325 | `POST /auth/mfa/verify` + `trusted-device.ts issue` + `mfa-verify-form.tsx` + `GET /auth/me`              |
| AC-326 | `POST /auth/login` → `consumeAtLogin` (`auth/service.ts`)                                                 |
| AC-327 | `requireStepUp` (değişmez) + `openSession` `step_up_at` NULL; P27 tüketim kuralı                          |
| AC-328 | §3.4 noktaları (K3 + K4) → `trusted-device-repo.ts`                                                       |
| AC-329 | `GET/DELETE /auth/trusted-devices[/:id]` + `components/account/trusted-devices.tsx`                       |
| AC-330 | `POST /users/:id/forget-devices`, `GET /users/:id trustedDeviceCount` + kullanıcı editörü                 |
| AC-331 | `PUT /settings/tenant mfaRememberDevice` + `tenants/settings.ts` + `security-form.tsx`; `rememberAllowed` |
| AC-332 | `issue` + `deleteOverLimit` + kullanıcı satırı kilidi                                                     |
| AC-333 | `trusted-device.ts` belirteç/UA özeti; log/audit kuralları                                                |
| AC-334 | `grants.sql`, saklama işi, `tenant-purge-repo.ts`, `cli/erasure.ts`                                       |
| AC-335 | CI suite                                                                                                  |

## 12. Açık kararlar

| No       | Konu                                                                                                        | Mimar kararı (kullanıcı değiştirebilir)                                |
| -------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| K-P27a-2 | Super Admin hatırlayabilsin mi?                                                                             | Evet (T6 risk kabulü; geri dönüş tek satır).                           |
| K-P27a-3 | 30 gün sabit mi, kayan mı?                                                                                  | Sabit.                                                                 |
| S-P27a-1 | Yeni cihaz hatırlandığında e-posta                                                                          | Sonra (SMTP varsa "Yeni cihaz hatırlandı" e-postası; telafi kontrolü). |
| AC no.   | `docs/mimari-p27.md` paralel yazılıyor; yeni AC eklerse AC-336'dan başlamalı (AC-325..335 P27a'ya ayrıldı). | —                                                                      |
