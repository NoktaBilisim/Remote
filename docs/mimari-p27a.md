# Mimari — P27a: 2FA'da "Bu cihazı 30 gün hatırla"

Tarih: 2026-11-15 · Durum: **r2** (güvenlik tasarım turu işlendi, §13; Y-P27a-1 için kullanıcı kararı A) · Gereksinim:
`docs/gereksinimler.md` §11 (AC-325..AC-335, AC-335a, AC-335b) · İlgili: ADR-0008 (opak oturum + CSRF), ADR-0022 (step-up), AC-65/66/67/68 (P10), AC-215 (step-up),
P16 (kalıcı silme, ADR-0030). Yeni ADR yok: karar mevcut ADR-0008 çerez/özet kalıbını tekrarlar; aşağıdaki K-P27a
kararları bu dosyada kayıtlıdır.

## 1. Özet ve kısıtlar

Girişte TOTP adımında işaretlenebilen "Bu cihazı 30 gün hatırla" kutusu. İşaretlenirse tarayıcıya ayrı, yalnız auth
yoluna giden bir **güvenilir cihaz belirteci** çerezi yazılır; sonraki girişlerde **doğru şifreden sonra** bu belirteç
geçerliyse oturum doğrudan `mfa_passed = true` açılır ve belirteç **döndürülür** (her kullanımda yenisi). Özellik firma
kullanıcılarına (Admin, teknisyen) açıktır; **Super Admin cihaz hatırlayamaz** (K-P27a-2). Başka hiçbir şey değişmez.

Değişmezler:

1. Şifre her girişte sorulur; kilit kuralları (AC-65) belirteçten önce ve aynen uygulanır.
2. **Step-up asla atlanmaz** (ADR-0022): belirteç `step_up_at` yazmaz; `requireStepUp` ve P27'deki "her gözetimsiz
   bağlantıda step-up tüketimi" değişmez.
3. Belirteç yalnız TOTP etkin kullanıcıda anlam taşır; 2FA kurulum aşaması (`setup`) ve zorunlu şifre değişimi
   (`mustChangePassword`) atlanmaz.
4. Mevcut stack ve kalıplar: Fastify + Prisma + MySQL, opak token = 32 bayt rastgele, DB'de SHA-256 (ADR-0008),
   `writeAudit`, `AppError` zarfı, `@remote/contracts` zod, `t()` i18n, lucide ikonları. Yeni bağımlılık yok.

Kararlar (sadelik ilkesi: tek ekran / tek yol):

| No        | Karar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K-P27a-1  | **Firma ayarı: tek anahtar** `tenant_settings.mfa_remember_device` ("2FA cihaz hatırlama"), **varsayılan açık**, mevcut Ayarlar → Güvenlik ekranında `requireTech2fa` anahtarının altında, aynı uç ve yetki (`PUT /settings/tenant`, `settings.edit`). Gerekçe: KVKK/denetim gereği bazı müşteriler "her girişte kod" isteyebilir; ayrı ekran/süre/rol seçeneği yok. Kapatma = o firmanın tüm cihazları aynı TX'te silinir (yarı durum yok).                                                                                                                                                                                                                                                                                                                                                                                       |
| K-P27a-2  | **Super Admin cihaz hatırlayamaz** (r2; Y-P27a-1, kullanıcı kararı 2026-11-15 Seçenek A). `rememberAllowed(user)`: `role === "SUPER_ADMIN"` → `false`; diğerleri → firma anahtarı. Arayüz: `me.mfa.rememberDeviceAvailable=false` → kutu gösterilmez. Sunucu: Super Admin'den gelen `rememberDevice:true` **yok sayılır** (`deviceRemembered:false`, 400 değil) — politika kapalı firmadaki davranışla aynı tek kural ("izin yoksa yok say"); ayrı hata dalı/mesajı yok, kutuyu gösteren eski sekme kullanıcıyı kırmaz. Yapısal güvence: `trusted_devices.tenant_id` **NOT NULL** (Super Admin'in `tenant_id`'si NULL olduğundan satır DB düzeyinde oluşamaz). Gerekçe: Super Admin firma geçişinde step-up istemez; çalınan çerez + kayıtlı şifre çok firmalı ele geçirme demektir; firma anahtarı ve Admin kaldırma ona ulaşmaz. |
| K-P27a-3  | Süre **sabit 30 gün**, kullanımda uzamaz (kayan değil). Sabit üst sınır, saldırı penceresini sınırlar ve denetimi basitleştirir.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| K-P27a-4  | Yalnız **TOTP** ile doğrulamada sunulur; kurtarma koduyla hatırlama yok (kurtarma kodu = acil durum; tek kullanımlık koda 30 günlük güven bağlanmaz).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| K-P27a-5  | Kaldırma = **satır silme** (hard delete); geçmiş audit'te. `revoked_at` sütunu yok, sorgular sade.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| K-P27a-6  | Kullanıcı başına **≤ 10** cihaz; 11.'de en eski düşer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| K-P27a-7  | Çerez `__Secure-rs_td`, `Path=/api/v1/auth` (yalnız auth uçlarına gider: giriş, `me`, cihaz listesi), HttpOnly, Secure, SameSite=Strict, Max-Age 30 gün. `__Host-` öneki `Path=/` ister; yol kısıtı daha değerli olduğu için `__Secure-` seçildi.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| K-P27a-8  | Tarayıcıda **tek** hatırlama çerezi: aynı tarayıcıda ikinci hesap hatırlanırsa çerez onunkiyle değişir; ilk hesabın satırı süresi dolana veya kaldırılana kadar listede kalır (zararsız; çerezi artık yok).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| K-P27a-9  | Admin tarafı tek yol: kullanıcı düzenleme ekranında **sayı + "Tümünü kaldır"**; tek tek liste yalnız kullanıcının kendi profilinde. Yeni yetki anahtarı **yok** (`users.view` / `users.edit`, `settings.edit` yeterli; permissions tek tanım değişmez).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| K-P27a-10 | **E-posta bildirimi bu pakette** (r2; O-P27a-2, eski S-P27a-1): yeni cihaz hatırlandığında ve belirteç yeniden kullanımı tespit edildiğinde kullanıcıya e-posta (firma SMTP'si, mevcut `mail.sendForTenant`; SMTP yoksa mevcut `mail.sent{not_configured}` audit'i). Commit sonrası, akışı bekletmez (`mfaEnabledMail` kalıbı). İçerikte belirteç ve bağlantı yok. Ayar/abonelik yok.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| K-P27a-11 | **Her kullanımda döndürme** (r2; O-P27a-1): her başarılı atlamada aynı login TX'inde yeni 32 bayt belirteç; `token_hash` ← yeni, `prev_token_hash` ← eski; yeni `Set-Cookie` (Max-Age = kalan süre; `expires_at` değişmez, K-P27a-3). `prev_token_hash` ile gelen belirteç = **yeniden kullanım**: kullanıcının bütün satırları silinir, audit + e-posta, normal TOTP aşaması. Ödünleşim: yarışan iki sekme / kaybolan yanıt yanlış alarm üretebilir (R-P27a-2; bedeli bir TOTP + bir e-posta); tolerans penceresi **yok** (sadelik).                                                                                                                                                                                                                                                                                              |
| K-P27a-12 | **Mevcut firmalarda varsayılan da açık** (r2; D-P27a-1 ikinci yolu). Migration her satıra TRUE yazar; `NOT require_tech_2fa` **uygulanmaz**. Gerekçe: `require_tech_2fa` varsayılanı TRUE olduğundan bu kural mevcut firmaların neredeyse tamamında özelliği kapatır, aynı ayarlı yeni firmada ise açık bırakır — aynı yapılandırma oluşturulma zamanına göre farklı davranır (sadelik ilkesine aykırı). Telafi: CHANGELOG + sürüm notunda firma Admin'lerine açık satır ("Ayarlar → Güvenlik → 2FA cihaz hatırlama varsayılan açık; kapatabilirsiniz") ve kılavuz (K9).                                                                                                                                                                                                                                                           |

## 2. Bileşenler ve akış

```mermaid
sequenceDiagram
  participant B as Tarayıcı
  participant W as apps/web (/login, /login/2fa)
  participant S as apps/server /api/v1/auth
  participant D as MySQL
  B->>S: POST /login {login, password} (+ çerez __Secure-rs_td?)
  S->>S: IP/çift/hesap kilidi, argon2 (DEĞİŞMEZ)
  alt şifre doğru, totp etkin, çerez geçerli (kullanıcı eşleşir, süresi dolmamış, rememberAllowed)
    S->>D: TX: döndür (token_hash←yeni, prev←eski) + last_used_at/ip + oturum (mfa_passed=1) + audit used + auth.login{mfa:remembered}
    S-->>B: Set-Cookie __Secure-rs_td (yeni, Max-Age=kalan); {mfaRequired:false}
  else çerez = kullanıcının prev_token_hash'i (yeniden kullanım)
    S->>D: TX: kullanıcının tüm trusted_devices DELETE + audit trusted_device_reuse(fail) + oturum (mfa_passed=0)
    S-->>B: çerez silinir; {mfaRequired:true}; commit sonrası e-posta (reuse)
  else çerez yok/geçersiz
    S->>D: TX: oturum (mfa_passed=0) (+ bilinmeyen/süresi dolmuşsa çerez silinir)
    S-->>B: {mfaRequired:true} → /login/2fa
    B->>S: POST /mfa/verify {code, rememberDevice:true}
    S->>D: TX: TOTP tüket + oturum yenile + kullanıcı kilidi + trusted_devices INSERT (+ en eskiyi düşür) + audit created
    S-->>B: Set-Cookie __Secure-rs_td; {deviceRemembered:true}; commit sonrası e-posta (yeni cihaz)
  end
```

| Bileşen                                                            | Sorumluluk                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth/trusted-device-repo.ts` (yeni)                               | Tek veri erişim noktası: `insertTrustedDevice`, `findByHash`, `findByPrevHash`, `rotate` (koşullu UPDATE), `touch`, `listForUser`, `countForUser`, `deleteForUser(id?)`, `deleteForTenant`, `deleteOverLimit`, `deleteExpired`. Tüm geçersiz kılma çağrıları buradan; kopya yok.                       |
| `auth/trusted-device.ts` (yeni)                                    | Politika (`rememberAllowed(user)`: Super Admin → false), belirteç üretimi, `issue` (verify TX içinde), `consumeAtLogin` (login TX içinde; döndürme + yeniden kullanım), aynı adlı çerez değerlerini ham `Cookie` başlığından okuma (≤ 2), UA özeti (`uaSummary`, bağımlılıksız regex), çerez ayarları. |
| `auth/trusted-device-routes.ts` (yeni)                             | Profil uçları (`GET/DELETE /auth/trusted-devices[/:id]`).                                                                                                                                                                                                                                              |
| `auth/service.ts` `login`                                          | Şifre/kilit/geçici şifre dallarından sonra, login TX'inde `consumeAtLogin` (sıra §5.1); `openSession(..., mfaPassed)`; commit sonrası reuse e-postası.                                                                                                                                                 |
| `auth/account.ts` `mfaVerify`                                      | `rememberDevice` → `issue`; commit sonrası yeni cihaz e-postası.                                                                                                                                                                                                                                       |
| `mail/templates.ts`                                                | `trustedDeviceCreatedMail`, `trustedDeviceReuseMail` (yeni; bağlantısız).                                                                                                                                                                                                                              |
| Geçersiz kılma noktaları                                           | §3.4 tablosu.                                                                                                                                                                                                                                                                                          |
| `apps/web` 2FA formu, Hesabım, kullanıcı düzenleme, Güvenlik ayarı | §6.                                                                                                                                                                                                                                                                                                    |

## 3. Veri modeli

### 3.1 Yeni tablo `trusted_devices`

| Alan              | Tip                   | Not                                                                                                                                       |
| ----------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | CHAR(26) PK           | ULID (`newId`)                                                                                                                            |
| `tenant_id`       | CHAR(26) **NOT NULL** | Kullanıcının firması (oluşturma anında `users.tenant_id`). Super Admin satırı yapısal olarak oluşamaz (K-P27a-2). FK → `tenants` RESTRICT |
| `user_id`         | CHAR(26)              | FK → `users` RESTRICT (silme önce çocuk; P16 kalıbı)                                                                                      |
| `token_hash`      | CHAR(64) UNIQUE       | Geçerli belirtecin SHA-256 hex'i; düz belirteç DB'de yok; her kullanımda değişir (K-P27a-11)                                              |
| `prev_token_hash` | CHAR(64) NULL UNIQUE  | Bir önceki (döndürülmüş) belirtecin özeti; yalnız yeniden kullanım tespiti; oluşturmada NULL                                              |
| `ua_summary`      | VARCHAR(80)           | "Chrome · Windows" gibi; tam UA saklanmaz (veri azaltma)                                                                                  |
| `ip`              | VARCHAR(45)           | Son kullanım IP'si (oluşturmada oluşturan IP)                                                                                             |
| `created_at`      | DATETIME(3)           | UTC                                                                                                                                       |
| `last_used_at`    | DATETIME(3) NULL      | Son atlama anı; NULL = henüz kullanılmadı                                                                                                 |
| `expires_at`      | DATETIME(3)           | `created_at + 30 gün`; **güncellenmez**                                                                                                   |
| `updated_at`      | DATETIME(3)           | Proje kuralı                                                                                                                              |

İndeksler: `UNIQUE(token_hash)`; `UNIQUE(prev_token_hash)` (MySQL çoklu NULL'a izin verir); `(user_id, created_at)` (liste, sınır, en eski); `(tenant_id)` (firma geneli silme,
P16); `(expires_at)` (saklama). Beklenen hacim: kullanıcı × ≤ 10 satır; büyüme yok.

Değişmezlik/doğruluk: `tenant_id` uygulama tarafından kullanıcı satırından kopyalanır (aynı TX). Kullanırken ek
koruma: `row.user_id === user.id` **ve** `row.tenant_id = user.tenant_id` (eşleşmezse yok sayılır).

### 3.2 `tenant_settings` yeni sütun

`mfa_remember_device BOOLEAN NOT NULL DEFAULT TRUE`. Mevcut satırlar migration'da TRUE alır (K-P27a-12; D-P27a-1'deki
`NOT require_tech_2fa` yolu gerekçesiyle seçilmedi, telafisi CHANGELOG/sürüm notu).

### 3.3 Grants / migration / silme

- `apps/server/prisma/sql/grants.sql`: `GRANT SELECT, INSERT, UPDATE, DELETE ON trusted_devices TO app`.
- Migration `p27a_trusted_devices` (migrator): CREATE TABLE + ALTER `tenant_settings` ADD COLUMN. Geri alma:
  DROP TABLE + DROP COLUMN (veri kaybı yalnız hatırlama; kullanıcılar bir kez TOTP girer). Seed değişmez.
- Saklama işi (`jobs/retention*`): `expires_at < now` satırları toplu silinir (sayaç `trustedDevices`).
- Firma kalıcı silme: `jobs/tenant-purge-repo.ts` `USER_CHILDREN`'a `byTenantUser("trusted_devices")`; meta-test
  (tenants'a FK veren tablolar) yeni tabloyu ister.
- KVKK silme: `cli/erasure.ts` `DELETE FROM trusted_devices WHERE user_id = ?` (`auth_sessions` satırının yanına).
- Kullanıcı kalıcı silme (`users/purge.ts` `purgeTx`): aynı TX'te `DELETE FROM trusted_devices WHERE user_id = ?`
  (D-P27a-4; pasif geçişi zaten siler, bu FK RESTRICT takılmasına karşı savunma). Audit'e ayrı alan yazılmaz.

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
| Yeniden kullanım (K-P27a-11)           | `auth/trusted-device.ts` `consumeAtLogin`                         | tümü                      | `auth.trusted_device_reuse` `result:fail` `{count}` + e-posta                |
| Kullanıcı kalıcı silme (savunma)       | `users/purge.ts` `purgeTx`                                        | tümü                      | mevcut `USER_AUDIT.DELETED` (ek alan yok)                                    |

Süresi dolan satır audit'lenmez (saklama işi sayaç metriği yeter).

## 4. API sözleşmesi

Tüm uçlar `/api/v1` altında; hata zarfı ve kodlar mevcut (`packages/contracts/src/errors.ts`), yeni hata kodu yok.
Değiştiren uçlarda mevcut CSRF (ADR-0008 çift gönderim) ve Origin denetimi aynen.

### 4.1 Değişen uçlar

| Uç                      | Değişiklik                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /auth/login`      | Girdi değişmez. Çerez `__Secure-rs_td` okunur. Yanıt şekli değişmez; atlamada `mfaRequired: false`. Atlamada yeni belirteçle `Set-Cookie` (döndürme, Max-Age = kalan saniye). Bilinmeyen/süresi dolmuş/izin verilmeyen ya da yeniden kullanılan belirteçte `Set-Cookie` ile çerez silinir (yalnız host-only; `Domain` özniteliksiz); başka kullanıcının belirtecine dokunulmaz.                  |
| `POST /auth/mfa/verify` | Girdi: `z.union([z.strictObject({ code: totpCodeSchema, rememberDevice: z.boolean().optional() }), z.strictObject({ recoveryCode: recoveryCodeSchema })])` → kurtarma koduyla `rememberDevice` 400 `VALIDATION`. Yanıt `MfaVerifyResponse` + `deviceRemembered: boolean`. `rememberAllowed` false ise (firma anahtarı kapalı **veya Super Admin**) `true` yok sayılır, `deviceRemembered:false`. |
| `GET /auth/me`          | `mfa` (MfaStatus) nesnesine `rememberDeviceAvailable: boolean` (aşama `verify` ve `rememberAllowed` true ise true; Super Admin'de her zaman false; 2FA sayfası kutuyu buna göre gösterir).                                                                                                                                                                                                       |
| `POST /auth/logout-all` | Yanıt `LogoutAllResponse` + `revokedTrustedDevices: number`; çerezi siler.                                                                                                                                                                                                                                                                                                                       |
| `PUT /settings/tenant`  | `updateTenantSettingsInputSchema` + `mfaRememberDevice: z.boolean().optional()`; `TenantSettingsView` + `mfaRememberDevice: boolean`. Yetki `settings.edit` (mevcut).                                                                                                                                                                                                                            |
| `GET /users/:id`        | `UserDetail` + `trustedDeviceCount: number` (yetki `users.view`, mevcut tenant kapsamı).                                                                                                                                                                                                                                                                                                         |

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

| Sabit                    | Eylem                         | entity / entityId                        | newValue                                                               |
| ------------------------ | ----------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| `TRUSTED_DEVICE_CREATED` | `auth.trusted_device_created` | `trusted_devices` / satır id             | `{ uaSummary, expiresAt }`                                             |
| `TRUSTED_DEVICE_USED`    | `auth.trusted_device_used`    | `trusted_devices` / satır id             | `{ uaSummary }` (+ mevcut `auth.login` success satırı aynen)           |
| `TRUSTED_DEVICE_REVOKED` | `auth.trusted_device_revoked` | `users` / hedef kullanıcı id             | `{ reason: "user" \| "admin" \| "limit", count }`                      |
| `TRUSTED_DEVICE_REUSE`   | `auth.trusted_device_reuse`   | `users` / kullanıcı id, `result: "fail"` | `{ count }` (silinen satır sayısı)                                     |
| (mevcut) `auth.login`    | `auth.login` success          | `users` / kullanıcı id                   | atlamada `{ mfa: "remembered" }` (D-P27a-4; diğer girişlerde değişmez) |

Belirteç, özeti (`token_hash`/`prev_token_hash`), tam UA yazılmaz (IP ve UA mevcut audit bağlamından gelir). Audit
ekranında "TOTP'siz girişler" `auth.trusted_device_used` eylemi veya `auth.login` `newValue.mfa` ile ayrılır. Toplu geçersiz kılmalar §3.4'teki mevcut
olay satırına `revokedTrustedDevices` alanı olarak eklenir (ayrı satır yok). Audit ekranı filtre listesi
`AUTH_AUDIT`'ten üretildiği için ek iş yok.

## 5. Güvenlik tasarımı

### 5.1 Login sırası ve doğrulama kuralı (`consumeAtLogin`, login TX'i içinde)

Sıra (D-P27a-3; mevcut `auth/service.ts login` sırası korunur, yalnız 5. adım eklenir):

1. IP / çift / hesap kilidi (AC-65) — kilitliyse 423; çerez **okunmaz**.
2. argon2 şifre doğrulama + `canSignIn` — hatalıysa sayaç/kilit aynen; çerez **okunmaz**.
3. Super Admin geçici şifre süresi (`temp_password_expired` reddi) — aynen.
4. TX başlar: `clearFailures`, `previousToken` oturum iptali — aynen.
5. **`consumeAtLogin(tx, user, cookieValues)`** → `{ mfaPassed: boolean, setCookie?: string, clearCookie: boolean, reuse?: { count } }`.
6. `openSession(tx, ..., mfaPassed || !user.totpEnabled)`; `auth.login` success audit (atlamada `newValue {mfa:"remembered"}`).
7. TX commit → `mfaStageOf(user, mfaPassed, setupEnforced)`; `mustChangePassword` bayrağı ve guard'ı **aynen** (hatırlanan
   cihaz şifre değişim zorunluluğunu atlamaz; TOTP'siz kullanıcıda `setup` aşaması da atlanmaz, çünkü 5. adım
   `totpEnabled` ister). Reuse varsa commit sonrası e-posta (bekletmez).

`consumeAtLogin` kuralı:

- Çerez değerleri ham `Cookie` başlığından okunur: aynı addaki **en çok 2** değer, `^[A-Za-z0-9_-]{43}$` biçimi
  (D-P27a-2; cookie tossing / aynı host'taki başka port gölgelemesine karşı). Sırayla denenir; ilk başarılı atlama kazanır.
- Bir değer için **atlama** ancak hepsi doğruysa: `user.totpEnabled` · `findByHash(sha256)` satırı var ·
  `row.user_id = user.id` ve `row.tenant_id = user.tenant_id` · `row.expires_at > now` · `rememberAllowed(user)`
  (Super Admin → false; diğer → `tenant.settings.mfaRememberDevice`). Atlamada **döndürme**: yeni 32 bayt belirteç;
  `UPDATE trusted_devices SET prev_token_hash = token_hash, token_hash = :new, last_used_at = now, ip = :ip WHERE id = :id
AND token_hash = :old` — etkilenen satır 0 ise (yarış) atlama yok, bu değer yeniden kullanım sayılır. Audit
  `trusted_device_used`.
- **Yeniden kullanım**: `findByHash` boş, `findByPrevHash(sha256)` satırı var ve `row.user_id = user.id` →
  `deleteForUser(user.id)` (tümü), audit `auth.trusted_device_reuse {count}` `result:fail`, çerez silinir, TOTP aşaması.
  Satır başka kullanıcıya aitse yok sayılır (dokunulmaz).
- Diğer her durumda (yok, süresi dolmuş, izin yok, başka kullanıcı) normal `verify` aşaması; kullanıcının kendi
  süresi dolmuş/izinsiz satırı ya da bilinmeyen değer → yanıt çerezi siler.
- Çerez silme `Set-Cookie` yalnız host-only çereze yazılır (`Domain` özniteliği yok); `Domain=` ile yerleştirilmiş kardeş
  alan adı çerezi sunucunun sorumluluğunda değildir (prod ayrı alan adı; runbook notu, K6).

Belirteç sorgusu yalnız şifre doğrulandıktan sonra yapılır → belirteç tahmini şifre gerektirir; ek hız sınırı
gerekmez (IP 20/dk ve hesap kilidi geçerli). 256 bit belirteç kaba kuvvetle tahmin edilemez. Özet üzerinden UNIQUE
indeksle arama sabit zamanlı karşılaştırma gerektirmez (güvenlik turu kabulü).

### 5.2 Oluşturma (`issue`, `mfaVerify` TX'i içinde)

`rememberDevice === true` · TOTP ile doğrulandı · `rememberAllowed` → `SELECT … FROM users WHERE id=? FOR UPDATE`
(sınır yarışı için) → `INSERT` → `deleteOverLimit(userId, 10)` (en eski) → audit. Commit sonrası çerez yazılır ve
**yeni cihaz e-postası** gönderilir (`trustedDeviceCreatedMail`: "Yeni cihaz hatırlandı: <tarayıcı · işletim sistemi>,
IP, saat (tr-TR); siz değilseniz Hesabım → Hatırlanan cihazlar → Tümünü kaldır ve şifrenizi değiştirin"; bağlantı ve
belirteç yok; SMTP yoksa `not_configured` audit'i; hata loglanır, yanıtı etkilemez). Aynı tarayıcıda eski bir belirteç
varsa önce o satır silinir (kullanıcıya aitse) — bir tarayıcı = bir satır.

Yeniden kullanım e-postası (`trustedDeviceReuseMail`): "Hatırlanan bir cihazın belirteci başka bir yerde kullanıldı;
güvenliğiniz için tüm hatırlanan cihazlarınız kaldırıldı. Siz değilseniz şifrenizi değiştirin." Aynı gönderim kalıbı.

### 5.3 Çerez

`__Secure-rs_td=<43 karakter>; Path=/api/v1/auth; Max-Age=<oluşturmada 2592000, döndürmede kalan saniye>; HttpOnly;
Secure; SameSite=Strict` (`Domain` yok → host-only). Caddy logu çerez
yazmaz (G-10, mevcut). Next.js `proxy.ts` çerezi yalnız iletir; web kodu okumaz.

### 5.4 Tehdit notları (güvenlik tasarım turu için)

| No  | Tehdit                                             | Önlem / kabul                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | Çerez çalınması (zararlı yazılım, cihaz erişimi)   | r2: her kullanımda döndürme + `prev_token_hash` yeniden kullanım tespiti (kopya ile gerçek tarayıcıdan ikincisi girince tüm cihazlar silinir, e-posta; K-P27a-11); yeni cihaz e-postası (K-P27a-10). Şifre ayrıca gerekir (infostealer şifreyi de alabilir — bu yüzden Super Admin hariç); step-up atlanmaz; 30 gün sabit üst sınır; kullanıcı/Admin kaldırabilir; şifre değişimi hepsini düşürür. Belirteç cihaza/IP'ye bağlanmaz (kabul: mobil IP değişir; IP bağlama yanlış alarm üretir) — `last_used_at`/`ip` profilde görünür. |
| T2  | Paylaşılan / ortak bilgisayar                      | Kutu **varsayılan işaretsiz**, altında yardım metni "Yalnız kişisel cihazınızda işaretleyin"; "Tüm cihazlardan çıkış" bu cihazı da düşürür; Admin uzaktan kaldırır; firma anahtarı kapatılabilir.                                                                                                                                                                                                                                                                                                                                    |
| T3  | XSS                                                | HttpOnly → JS okuyamaz. XSS ile oturum içi işlem zaten oturum tehdidi; mevcut CSP (uygulama üretir) aynen. Cihaz listesi uçları belirteci asla döndürmez.                                                                                                                                                                                                                                                                                                                                                                            |
| T4  | CSRF                                               | SameSite=Strict + mevcut CSRF başlığı + login'de Origin denetimi. Login CSRF ile kurbana saldırganın hesabını açtırmak mevcut korumalarla engelli; hatırlama çerezi yalnız eşleşen kullanıcıda etkili.                                                                                                                                                                                                                                                                                                                               |
| T5  | Belirteç sızıntısı (log/DB)                        | DB'de yalnız SHA-256; log/audit/yanıtta yok (AC-333 testi); DB dökümü belirteç vermez.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| T6  | Super Admin hesabı (K-P27a-2)                      | r2: **kapsam dışı** — `rememberAllowed` false, `tenant_id NOT NULL` ile satır oluşamaz. Super Admin her girişte TOTP girer. (Y-P27a-1, kullanıcı kararı A.)                                                                                                                                                                                                                                                                                                                                                                          |
| T7  | Oturum sabitleme / yükseltme                       | Atlamada yeni oturum `openSession` ile açılır (mevcut); `step_up_at` NULL.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| T8  | Firma izolasyonu / IDOR                            | Profil uçları `user_id = auth.user.id` sorgusu; Admin ucu mevcut `tenantScope` + `assertManage`; başka firma 404.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| T10 | Aynı adlı çoklu çerez / paylaşılan host (D-P27a-2) | ≤ 2 değer denenir; silme yalnız host-only; başkasının çerezi kullanıcı eşleşmesi nedeniyle atlama vermez; prod ayrı alan adı. Etki en çok DoS (bir TOTP).                                                                                                                                                                                                                                                                                                                                                                            |
| T11 | Döndürme yanlış alarmı (R-P27a-2)                  | Yarışan iki sekme veya kaybolan yanıt → reuse → tüm cihazlar silinir + e-posta. Kabul: nadir, bedeli bir TOTP; tolerans penceresi eklenmez (sadelik).                                                                                                                                                                                                                                                                                                                                                                                |
| T9  | Geçersiz kılmanın unutulması                       | Tüm noktalar tek repo işlevini çağırır; §3.4 tablosu birebir entegrasyon testi (AC-328).                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 6. Arayüz (apps/web) — DESIGN.md token'ları, lucide ikonları, açık/koyu tema, masaüstü/mobil

| Ekran                                                                                                                                        | Değişiklik                                                                                                                                                                                                                                                                                     | Durumlar                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login/2fa` (`mfa-verify-form.tsx`)                                                                                                         | Kod alanı ile gönder düğmesi arasında mevcut `Checkbox` bileşeni (yoksa DESIGN.md'deki form denetimi): `mfa.v.remember` + yardım `mfa.v.rememberHint`. Yalnız `code` modunda ve `me.mfa.rememberDeviceAvailable` true ise (Super Admin'de hiç görünmez). Klavye ile erişilir, etiket tıklanır. | Mevcut form durumları; kutu gönderim sırasında `disabled`.                                                                                                                                  |
| Hesabım → "Hatırlanan cihazlar" (yeni `components/account/trusted-devices.tsx`, `account-security.tsx` içinde "Oturumlar" bölümünün üstünde) | Bölüm ikonu `MonitorCheck`; satır: `Laptop` ikonu + UA özeti, "Bu cihaz" rozeti, tarih/IP satırı, `Trash2` "Kaldır" (danger-ghost). Altta "Tümünü kaldır" (`Trash2`) → onay diyaloğu. Tarihler mevcut tarih biçimleyiciyle (tr-TR, yerel saat).                                                | Yükleniyor: 2 satır skeleton · Boş: `acc.td.empty` · Hata: `FormError` + "Yeniden dene" (`RotateCw`) · Kısmi: silme başarısızsa satır kalır, toast hata · Başarılı: toast `acc.td.removed`. |
| Kullanıcı düzenleme (`users/[id]`)                                                                                                           | Güvenlik grubunda "2FA'yı sıfırla"nın yanında: `acc.td.adminCount` metni + `users.edit` varsa "Hatırlanan cihazları kaldır" (`MonitorX`), sayı 0 iken düğme pasif. Mevcut `user-dialogs` onay kalıbı.                                                                                          | Mevcut editör durumları + hata toast'ı.                                                                                                                                                     |
| Ayarlar → Güvenlik (`security-form.tsx`)                                                                                                     | `requireTech2fa` anahtarının altında ikinci `Switch`: `sec.rememberLabel`, açıklama `sec.rememberDesc` ("Super Admin hesapları hariç" ifadesi dahil); kapatmada onay diyaloğu (`sec.rememberOffConfirm`, silinecek cihazlar uyarısı). Anında kayıt (mevcut kalıp), salt okunurda pasif.        | Mevcut.                                                                                                                                                                                     |

i18n anahtarları (`apps/web/messages/tr.json`): `mfa.v.remember` "Bu cihazı 30 gün hatırla", `mfa.v.rememberHint`
"Yalnız kişisel cihazınızda işaretleyin. Hassas işlemlerde kod yine sorulur.", `acc.td` "Hatırlanan cihazlar",
`acc.td.body`, `acc.td.empty`, `acc.td.current` "Bu cihaz", `acc.td.created`, `acc.td.lastUsed`, `acc.td.never`,
`acc.td.expires`, `acc.td.remove`, `acc.td.removeAll`, `acc.td.confirmTitle`, `acc.td.confirmBody`, `acc.td.removed`,
`acc.td.removedAll`, `acc.td.adminCount` "{n} hatırlanan cihaz", `acc.td.adminRemove`, `acc.td.adminConfirm`,
`sec.rememberLabel` "2FA cihaz hatırlama", `sec.rememberDesc`, `sec.rememberOffConfirm`, `sec.rememberSavedOn`,
`sec.rememberSavedOff`. Profil bölümü yalnız firma kullanıcılarında render edilir (Super Admin'de bölüm yok; uç boş liste
döner). E-posta metinleri sunucu tarafı `mail/templates.ts`'tedir (web i18n değil). Animasyon: yalnız mevcut diyalog/toast; yeni animasyon yok.

## 7. Dosya planı (görev başına; iki görev aynı dosyaya dokunmaz)

| Görev   | Dosyalar                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P27a-K1 | `apps/server/prisma/schema.prisma`, `apps/server/prisma/migrations/<ts>_p27a_trusted_devices/migration.sql`, `apps/server/prisma/sql/grants.sql`, `docs/db-notlari.md`                                                                                                                                                                                                                                                                                   |
| P27a-K2 | `packages/contracts/src/api/auth.ts`, `api/tenants.ts`, `api/users.ts`, `audit.ts` (+ contracts testleri); `apps/server/src/auth/trusted-device-repo.ts` (yeni) + `test/unit/trusted-device-repo.test.ts`                                                                                                                                                                                                                                                |
| P27a-K3 | `apps/server/src/auth/trusted-device.ts` (yeni), `auth/trusted-device-routes.ts` (yeni), `auth/routes.ts`, `auth/service.ts`, `auth/account.ts`, `mail/templates.ts` (2 şablon), `auth/repo.ts` (LoginUser select'ine `mfaRememberDevice`), `auth/password-reset.ts`, `auth/superadmin-reset.ts`, `app-routes.ts` (gerekirse kayıt) + `test/integration/p27a-auth.test.ts`, `test/integration/p27a-rotation.test.ts`, `test/unit/trusted-device.test.ts` |
| P27a-K4 | `apps/server/src/users/routes.ts`, `users/writes.ts`, `users/view.ts`, `users/service.ts`, `tenants/service.ts`, `tenants/settings.ts`, `tenants/repo.ts`, `jobs/retention-repo.ts`, `jobs/retention.ts`, `jobs/retention-counts.ts`, `jobs/tenant-purge-repo.ts`, `cli/erasure.ts`, `users/purge.ts` + `test/integration/p27a-revoke.test.ts`                                                                                                           |
| P27a-K5 | `apps/web/app/(auth)/login/2fa/mfa-verify-form.tsx`, `apps/web/components/account/trusted-devices.tsx` (yeni), `app/(panel)/account/account-security.tsx`, `app/(panel)/users/[id]/user-editor-parts.tsx`, `user-dialogs.tsx`, `use-user-editor.ts`, `app/(panel)/settings/security/security-form.tsx`, `lib/account/contract.ts`, `messages/tr.json`, `e2e/p27a-trusted-device.spec.ts`, `e2e/mock-account.mjs`                                         |
| P27a-K6 | `docs/runbook.md` (§ "Hatırlanan cihazlar": toplu iptal SQL'i olay anında, saklama sayaç alanı, `auth.trusted_device_reuse` artışında yapılacaklar, prod'un ayrı alan adında çalışması / staging IP:port çerez paylaşımı notu — D-P27a-2), `docs/implementation.md` yalnız ilgili geliştirici satırları kendi görevinde                                                                                                                                  |
| P27a-K9 | `README.md`, `docs/api.md`, `CHANGELOG.md` (K-P27a-12 firma Admin'lerine "varsayılan açık" satırı; Super Admin hariç notu), `docs/KULLANIM_KILAVUZU.md`, `docs/DATASHEET.md`, `docs/pdf/*`                                                                                                                                                                                                                                                               |

`docs/implementation.md`: K3/K4/K5 her biri yalnız kendi alt başlığını ekler (sıralı birleştirme; çakışmada son yazan
diğerini korur). Env değişkeni **yok** (`.env.example`, `env.ts`, compose değişmez).

## 8. Performans, operasyon

- Girişte +1 indeksli sorgu (`token_hash` UNIQUE; ıskalarsa +1 `prev_token_hash`) ve atlamada +1 koşullu UPDATE, yalnız
  şifre doğruysa; ihmal edilebilir. Önbellek yok. E-postalar commit sonrası, akışı bekletmez.
- Metrik: mevcut saklama sayaçlarına `trustedDevices`; login loguna `trustedDevice: "used"|"reuse"|"none"` alanı
  (belirteçsiz).
- Migration sıfır kesintili (yeni tablo + varsayılanlı sütun; mevcut firmalara TRUE, K-P27a-12). Rollback: önceki imaja dönüş; tablo kalır, kullanılmaz;
  gerekirse ters migration. Yedek: mevcut MySQL yedeği kapsar (özetler; gizli değer yok).
- Olay anı (runbook): tüm hatırlamaları düşürmek için `DELETE FROM trusted_devices;` (migrator değil, `app` yetkisi
  yeter) — sonuç: herkes bir kez TOTP girer.

## 9. Test stratejisi

| AC      | Seviye                                                                                                                                                                                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 325     | integration (verify + çerez öznitelikleri + DB özet; Super Admin `rememberDevice:true` → 200 `deviceRemembered:false`, satır yok) · e2e (kutu görünür/gizli, kurtarma modunda yok, Super Admin'de yok)                                                                                                                                                                |
| 326     | integration (atlama, sabit `expires_at`, hatalı şifre sayacı, kilitli 423, süresi dolmuş → çerez silinir, başka kullanıcı; `auth.login newValue.mfa="remembered"`; aynı adlı 2 çerez: biri geçersiz biri geçerli → atlama; `mustChangePassword` kullanıcı hatırlanan cihazla → yine şifre değişim zorunluluğu; geçici şifre süresi dolmuş Super Admin reddi değişmez) |
| 327     | integration (atlamayla açılan oturumda step-up korumalı uç 401 `MFA_STEP_UP_REQUIRED`)                                                                                                                                                                                                                                                                                |
| 328     | integration, §3.4 tablosundaki her satır ayrı `it`                                                                                                                                                                                                                                                                                                                    |
| 329–330 | integration (404/403, `current`) · e2e (liste, kaldır, tümünü kaldır, Admin düğmesi; 5 durum; mobil)                                                                                                                                                                                                                                                                  |
| 331     | integration (kapalıyken yok sayma + toplu silme + Super Admin istisnası) · e2e (anahtar + onay)                                                                                                                                                                                                                                                                       |
| 332     | unit + integration (11. cihaz, paralel iki verify)                                                                                                                                                                                                                                                                                                                    |
| 333     | unit (belirteç uzunluğu/alfabe) · integration (log yakalama: belirteç/özet geçmez)                                                                                                                                                                                                                                                                                    |
| 334     | integration (saklama, firma purge meta-testi, erasure, kullanıcı kalıcı silme `purgeTx` satırları siler)                                                                                                                                                                                                                                                              |
| 335a    | integration (mail sahte taşıyıcı: verify + remember → 1 e-posta, gövdede belirteç/bağlantı yok; SMTP yok → `not_configured` audit; e-posta hatası 200'ü bozmaz)                                                                                                                                                                                                       |
| 335b    | integration `p27a-rotation`: her atlamada çerez değişir, `expires_at` sabit, Max-Age = kalan; döndürülmüş eski çerezle giriş → TOTP sorulur, kullanıcının tüm satırları silinir, `auth.trusted_device_reuse` fail, e-posta; başka kullanıcının eski özeti → dokunulmaz; paralel iki atlama → biri reuse                                                               |
| 335     | tüm suite: `pnpm -r run lint && pnpm -r run typecheck && pnpm -r run test && pnpm --filter @remote/web e2e`                                                                                                                                                                                                                                                           |

## 10. Görev paketleri ve atama

| Paket   | Ajan                          | Bağımlı olduğu                                                   | Paralel mi                 | AC                                                                                                                |
| ------- | ----------------------------- | ---------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| P27a-K1 | dba                           | —                                                                | K2 ile paralel             | 334 (şema/grants), 335b (`prev_token_hash` + UNIQUE), `tenant_id NOT NULL` (K-P27a-2), migration TRUE (K-P27a-12) |
| P27a-K2 | backend-dev                   | —                                                                | K1 ile paralel             | 333 (sabitler), sözleşme, `AUTH_AUDIT.TRUSTED_DEVICE_REUSE`, repo `findByPrevHash`/`rotate`                       |
| P27a-K3 | backend-dev                   | K1, K2                                                           | K4 ‖ K5 ‖ K6 ile paralel   | 325–328 (auth dalı), 331 (Super Admin kuralı), 332, 333, 335a, 335b; §5.1 sırası                                  |
| P27a-K4 | backend-dev                   | K1, K2                                                           | K3 ‖ K5 ‖ K6 ile paralel   | 328 (diğer noktalar), 330, 331, 334 (+ `users/purge.ts`)                                                          |
| P27a-K5 | frontend-dev                  | K2 (sözleşme)                                                    | K3 ‖ K4 ‖ K6; e2e mock ile | 325, 329, 330, 331 (UI)                                                                                           |
| P27a-K6 | devops                        | K1                                                               | K3 ‖ K4 ‖ K5               | 334 (runbook), 335b (reuse olay adımı), D-P27a-2 notu                                                             |
| P27a-K7 | qa-denetci                    | K3, K4, K5, K6                                                   | K8 ile paralel             | hepsi, 335                                                                                                        |
| P27a-K8 | guvenlik                      | K3, K4, K5 (tasarım turu yapıldı; r2 kapanış teyidi K1'den önce) | K7 ile paralel             | §5.4, §13                                                                                                         |
| P27a-K9 | test-operatoru → teknik-yazar | K7 GEÇTİ + K8 Kritik/Yüksek 0                                    | sıralı                     | 329–331 elle tur, dokümantasyon (Super Admin hariç, e-postalar, K-P27a-12 CHANGELOG satırı)                       |

## 11. Kabul kriterleri eşlemesi

| AC      | Bileşen / uç                                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| AC-325  | `POST /auth/mfa/verify` + `trusted-device.ts issue` + `rememberAllowed` + `mfa-verify-form.tsx` + `GET /auth/me`             |
| AC-326  | `POST /auth/login` → §5.1 sırası → `consumeAtLogin` (`auth/service.ts`, `trusted-device.ts`); `auth.login {mfa}`             |
| AC-327  | `requireStepUp` (değişmez) + `openSession` `step_up_at` NULL; P27 tüketim kuralı                                             |
| AC-328  | §3.4 noktaları (K3 + K4) → `trusted-device-repo.ts`                                                                          |
| AC-329  | `GET/DELETE /auth/trusted-devices[/:id]` + `components/account/trusted-devices.tsx`                                          |
| AC-330  | `POST /users/:id/forget-devices`, `GET /users/:id trustedDeviceCount` + kullanıcı editörü                                    |
| AC-331  | `PUT /settings/tenant mfaRememberDevice` + `tenants/settings.ts` + `security-form.tsx`; `rememberAllowed`                    |
| AC-332  | `issue` + `deleteOverLimit` + kullanıcı satırı kilidi                                                                        |
| AC-333  | `trusted-device.ts` belirteç/UA özeti; log/audit kuralları                                                                   |
| AC-334  | `grants.sql`, saklama işi, `tenant-purge-repo.ts`, `cli/erasure.ts`, `users/purge.ts`                                        |
| AC-335  | CI suite                                                                                                                     |
| AC-335a | `issue` sonrası `mail.sendForTenant` + `mail/templates.ts trustedDeviceCreatedMail`                                          |
| AC-335b | `consumeAtLogin` döndürme/reuse + `trusted-device-repo rotate/findByPrevHash` + `prev_token_hash` + `trustedDeviceReuseMail` |

## 12. Açık kararlar

| No        | Konu                                                                                                       | Durum                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| K-P27a-2  | Super Admin hatırlayabilsin mi?                                                                            | **Kapandı**: Hayır (kullanıcı kararı 2026-11-15, Seçenek A).                                                             |
| K-P27a-3  | 30 gün sabit mi, kayan mı?                                                                                 | Sabit (mimar kararı; döndürme süreyi uzatmaz).                                                                           |
| S-P27a-1  | Yeni cihaz hatırlandığında e-posta                                                                         | **Kapandı**: bu pakette (K-P27a-10, AC-335a).                                                                            |
| K-P27a-12 | Mevcut firmalarda varsayılan                                                                               | Açık (mimar kararı, gerekçe §1); proje-yöneticisi/kullanıcı `NOT require_tech_2fa`'ya çevirebilir — tek satır migration. |
| AC no.    | `docs/mimari-p27.md` paralel yazılıyor; AC-336+ P27'ye ait. P27a ek AC'leri alt numara (AC-335a, AC-335b). | —                                                                                                                        |

## 13. r2 — güvenlik turu işlemesi (`docs/guvenlik-raporu.md` "P27a tasarım turu", 2026-11-15)

| Bulgu    | Önem   | İşleme                                                                                                                                                                                                                                               | Yer                            | AC        | Görev          |
| -------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------- | -------------- |
| Y-P27a-1 | Yüksek | Kullanıcı kararı A: Super Admin hatırlayamaz; `rememberAllowed` false; kutu gizli; `rememberDevice:true` **yok sayılır** (400 değil — politika kapalı firmayla aynı kural); `trusted_devices.tenant_id NOT NULL` yapısal güvence.                    | K-P27a-2, §3.1, §4.1, §5.1, T6 | 325, 331  | K1, K3, K5     |
| O-P27a-1 | Orta   | Uygulandı: her atlamada döndürme, `prev_token_hash` UNIQUE, koşullu UPDATE; yeniden kullanımda kullanıcının tüm satırları silinir + audit `auth.trusted_device_reuse` + e-posta + TOTP. Tolerans penceresi yok (R-P27a-2).                           | K-P27a-11, §3.1, §5.1, T1, T11 | 326, 335b | K1, K2, K3, K6 |
| O-P27a-2 | Orta   | Uygulandı: S-P27a-1 bu pakete alındı; `issue` commit sonrası "Yeni cihaz hatırlandı" e-postası (firma SMTP'si, yoksa `not_configured`), bağlantısız.                                                                                                 | K-P27a-10, §5.2                | 335a      | K3, K9         |
| D-P27a-1 | Düşük  | **Farklı çözüm** (raporun ikinci yolu): migration TRUE; `NOT require_tech_2fa` uygulanmadı — `require_tech_2fa` varsayılanı TRUE olduğundan aynı ayarlı eski/yeni firma farklı davranırdı (sadelik ilkesi). CHANGELOG + sürüm notu + kılavuz satırı. | K-P27a-12, §3.2                | 331       | K1, K9         |
| D-P27a-2 | Düşük  | Uygulandı: ham `Cookie` başlığından ≤ 2 değer denenir; silme yalnız host-only; prod ayrı alan adı runbook notu.                                                                                                                                      | §5.1, §5.3, T10                | 326       | K3, K6         |
| D-P27a-3 | Düşük  | Uygulandı: §5.1 sırası yazıldı; `mustChangePassword` ve `setup` atlanmaz; entegrasyon testi.                                                                                                                                                         | §5.1, §9                       | 326       | K3             |
| D-P27a-4 | Düşük  | Uygulandı: `auth.login` success `newValue {mfa:"remembered"}`; `users/purge.ts` savunmacı `DELETE`.                                                                                                                                                  | §3.3, §3.4, §4.3               | 326, 334  | K3, K4         |
