# API Dokümanı — Remote Support (P1–P8, P8b-1, P8c, P9, P10, P11, P12, P12b, P13a, P13b, P13b-L, P14a, P14b, P15, P16, P18, P19, P20, P27a, P27, P21)

Bu belge P1–P8, P8b-1, P8c-1, P9, P10, P11, P12, P12b, P13a, P13b ve P13b-L'de **kodda var olan** uçları anlatır. Sonraki paketlerin bağlayıcı sözleşmesi
`docs/mimari-api.md`'dedir. Kaynak: `apps/server/src/auth/routes.ts`, `auth/guards.ts`, `lib/errors.ts`,
`ops/{health,metrics}.ts`, `sessions/{routes,service,public}.ts`, `public/{service,consent,routes,agent,agent-binary}.ts`,
`signaling/*.ts`, `deploy/Caddyfile`,
`signaling/control.ts` (P7), `sessions/{history,history-repo}.ts` ve `lib/csv.ts` (P8),
`packages/contracts/src/{errors.ts,ws.ts,dc.ts,audit.ts,labels.ts,api/auth.ts,api/sessions.ts}`;
P8b-1: `requests/{public-routes,routes,service,panel,limits,ws}.ts`, `lib/{gate,db,errors}.ts`,
`packages/contracts/src/{api/requests.ts,ws-request.ts}`;
P8c-1: `customers/{routes,service}.ts`, `bindings/{public-routes,service}.ts`, `signaling/binding.ts`,
`packages/contracts/src/api/{customers,bindings}.ts`.
P9: `users/{routes,service}.ts`, `tenants/{routes,service}.ts`, `auth/guards.ts` (`requireSuperAdmin`),
`packages/contracts/src/api/{users,tenants}.ts`, `permissions.ts`.
P10: `auth/{routes,account,mfa,session,guards}.ts`, `tenants/smtp-routes.ts`, `sessions/email.ts`, `mail/{service,templates}.ts`,
`lib/{crypto,netguard}.ts`, `users/{routes,service}.ts` (`reset-mfa`), `packages/contracts/src/api/{auth,tenants,sessions,requests}.ts`.
P11: `audit/{routes,read,repo,view}.ts`, `settings/{routes,system,consent,mysql-probe}.ts`, `public/consent.ts`,
`packages/contracts/src/api/{audit,system-settings}.ts`.
P12: `uploads/{routes,files,service,image,multipart,store,urls}.ts`, `auth/routes.ts` (`/auth/me/preferences`, `rs_theme`),
`packages/contracts/src/api/branding.ts`, `errors.ts` (`INVALID_IMAGE`, `PAYLOAD_TOO_LARGE`), `audit.ts` (`BRANDING_AUDIT`).
P12b: `settings/{routes,system}.ts`, `notify/whatsapp.ts`, `env.ts`, `packages/contracts/src/api/system-settings.ts`
(`waServiceUrlSchema`, `WA_TEST_MESSAGES`), `audit.ts` (`SYSTEM_AUDIT.WHATSAPP_*`).
P13a: `jobs/{retention,retention-repo,scheduler}.ts`, `sessions/{history,history-repo}.ts`, `settings/{routes,system}.ts`,
`audit/service.ts` (müşteri IP öneki), `notify/whatsapp.ts`, `env.ts`, `packages/contracts/src/{errors.ts,audit.ts,labels.ts,
api/sessions.ts,api/system-settings.ts,api/audit.ts}`. Özet: "Saklama ve anonimleştirme (P13a)" bölümü.
P13b: `app.ts` (HSTS), `auth/{service,superadmin-reset}.ts`, `cli/reset-superadmin.ts`, `settings/{routes,system}.ts`,
`notify/whatsapp.ts`, `env.ts`, `packages/contracts/src/{audit.ts,api/system-settings.ts,api/audit.ts}`.
P13b-L: `sessions/{routes,lobby}.ts`, `signaling/{lobby-count,rooms,types}.ts`, `customers/service.ts`,
`packages/contracts/src/api/sessions.ts` (`waitingSessionsResponseSchema`, `waitingGuests`). Özet: "GET /api/v1/sessions/waiting".
P15: `auth/{routes,account,superadmin-routes,superadmin-reset}.ts`, `requests/{block-routes,blocks,service}.ts`,
`uploads/{routes,service,files,tech-avatar}.ts`, `sessions/{public,history}.ts`, `signaling/{handlers,rooms,collab}.ts`,
`packages/contracts/src/{ws.ts,ws-request.ts,labels.ts,audit.ts,permissions.ts,api/request-blocks.ts,api/users.ts,api/auth.ts}`.
Özet: "G3 küçük özellikler (P15)" bölümü.
P16: `users/{routes,service,repo}.ts` (`DELETE /users/:id`), `tenants/{routes,purge-service}.ts`, `jobs/{tenant-purge,
tenant-purge-repo,retention,orphan-scan}.ts`, `audit/{read,view,repo}.ts`, `ops/erasure-ledger.ts`, `cli/erasure.ts`,
`packages/contracts/src/{errors.ts,audit.ts,permissions.ts,api/users.ts,api/tenants.ts,api/audit.ts}`. Özet: "Kalıcı silme
(P16)" bölümü.
P18: `requests/{assign,calendar,hours,hours-routes,messages,routes,service,ws,hub,panel}.ts`, `sessions/{history,history-repo}.ts`,
`users/{routes,repo}.ts`, `cli/crypto.ts`, `packages/contracts/src/{errors.ts,permissions.ts,ws-request.ts,holidays-tr.ts,
api/requests.ts,api/sessions.ts,api/customers.ts}`. Özet: "Talep iletişimi (P18)" bölümü.
P20: `signaling/{binding,handlers,rooms,types}.ts`, `bindings/{service,repo}.ts`, `lib/{logger,db,errors}.ts`, `ops/metrics.ts`,
`packages/contracts/src/{ws.ts,errors.ts,api/bindings.ts}`, `fixtures/bindings.json` (`multi`). Özet: "Çoklu firma kaydı (P20)"
(bölüm "WebSocket `/ws/guest` — kayıt mesajları" altında). REST uç değişikliği yok.
P21: `portal/{routes,guard,auth,session,data,admin,admin-routes,limits,retention}.ts`, `requests/{service,create-tx,create-steps}.ts`,
`packages/contracts/src/{api/portal.ts,permissions.ts,audit.ts,labels.ts}`. Özet: "Müşteri portalı (P21)" bölümü.

## Genel kurallar

- Taban yol: `/api/v1`. İstek ve yanıt JSON, UTF-8. Dış adres `PUBLIC_BASE_URL` (prod `https://remote.noktabilisim.net`;
  IP girişi `https://185.126.217.99:4450` prod açılış imzasından sonra kapanır).
- **HSTS (P13b, AC-126):** her yanıtta `Strict-Transport-Security: max-age=31536000; includeSubDomains` (server helmet ve
  Caddy; `preload` yok). Kontrol: `curl -sI https://remote.noktabilisim.net/login | grep -i strict`.
- İstek gövdesi en çok 64 KB (Caddy sınırı 2 MB); aşım, bozuk JSON veya yanlış içerik türü → 400 `VALIDATION`.
  İstisna (P12): üç resim yükleme ucu `multipart/form-data` alır, dosya en çok 2 MB (Caddy bu uçlarda 3 MiB'a izin verir).
  Diğer uçlara multipart gövde gönderilirse 400.
- Her yanıtta `X-Request-Id` başlığı bulunur; hata gövdesindeki `requestId` ile aynıdır. Kullanıcı "Hata kodu"
  olarak bunu görür; log araması bu değerle yapılır (`docs/runbook.md` §5).
- Tanımsız yol → 404 `NOT_FOUND`.

### Çerezler

| Çerez                   | Öznitelikler                                                                                 | Amaç                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__Host-rs_session`     | HttpOnly, Secure, SameSite=Strict, Path=/, Domain yok                                        | Opak oturum token'ı (DB'de yalnız SHA-256)                                                                                                                                         |
| `__Host-rs_csrf`        | Secure, SameSite=Strict, Path=/, Domain yok, **HttpOnly değil**                              | CSRF double-submit değeri; JS okur                                                                                                                                                 |
| `rs_theme` (P12)        | SameSite=Lax, Path=/, Max-Age 1 yıl, **HttpOnly değil**, Secure yalnız `NODE_ENV=production` | Tema tercihi `light`/`dark`/`system`; web ilk HTML'i doğru temayla çizer. Login, `GET /auth/me` ve `PATCH /auth/me/preferences` yazar; çıkışta silinmez. Gizli değer değildir      |
| `__Secure-rs_td` (P27a) | HttpOnly, Secure, SameSite=Strict, `Path=/api/v1/auth`, Domain yok, Max-Age ≤ 30 gün         | "Bu cihazı 30 gün hatırla" belirteci, değer `<satır id>.<gizli>`; yalnız auth uçlarına gider, her kullanımda yenilenir. DB'de yalnız SHA-256. Ayrıntı "2FA cihaz hatırlama (P27a)" |

Oturum mutlak **8 saat**, boşta **30 dakika** sonra düşer; sonraki istek 401 alır. Çerez adları
`@remote/contracts/api/auth` sabitlerinden (`SESSION_COOKIE`, `CSRF_COOKIE`, `CSRF_HEADER`) gelir.

### CSRF ve Origin

- POST/PUT/PATCH/DELETE isteklerinde `Origin` başlığı **zorunludur** ve `ALLOWED_ORIGINS` listesinde olmalıdır
  (boşsa `PUBLIC_BASE_URL` origin'i). Yoksa veya listede değilse → 403 `CSRF_INVALID`. Login dahil.
- **Tek istisna** public `resolve` ve `join` (ADR-0012, "Public istemci türü"): `Origin` varsa listede olmalı ve
  istemci türü `BROWSER` olmalı; `Origin` yoksa yalnız `AGENT` (Windows istemcisi) kabul edilir ve `Sec-Fetch-*`
  başlığı bulunmamalı. Uymazsa → 403 `CSRF_INVALID`. Join'de tür gövdeden değil `joinNonce` kaydından gelir.
- Oturumlu durum değiştiren isteklerde ayrıca `X-CSRF-Token` başlığı `__Host-rs_csrf` çerezinin değerine eşit
  olmalıdır; değilse → 403 `CSRF_INVALID`. Login ve public müşteri uçları bu başlığı istemez (çerez yoktur).
- İstemci CSRF değerini her istekte çerezden okumalıdır: şifre değişimi çerezi yeniler.

### İlk giriş şifre değişimi kapısı

Kullanıcıda `mustChangePassword=true` iken yalnız `GET /auth/me`, `POST /auth/logout` ve
`POST /auth/password/change` çalışır; diğer oturumlu uçlar 403 `PASSWORD_CHANGE_REQUIRED` döner.

### 2FA aşaması (P10)

Oturumun `mfa.stage` değeri (`GET /auth/me`) üç durumdan biridir:

| Aşama    | Ne zaman                                                                                | İzinli uçlar                                                                        | Diğer uçlar                                    |
| -------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| `ok`     | Tam oturum                                                                              | Hepsi (yetkiye göre)                                                                | —                                              |
| `verify` | 2FA etkin, bu oturumda kod girilmedi                                                    | `GET /auth/me` (yetkiler boş), `POST /auth/logout`, `POST /auth/mfa/verify`         | 403 `MFA_REQUIRED`; WS bağlantıları reddedilir |
| `setup`  | 2FA zorunlu (Super Admin, Admin; User için firma ayarı `requireTech2fa`) ama kurulmamış | Yukarıdakiler + `POST /auth/mfa/setup`, `/auth/mfa/enable`, `/auth/password/change` | 403 `MFA_SETUP_REQUIRED`                       |

Sıra: önce zorunlu şifre değişimi (`mustChangePassword` iken setup/enable 403 `PASSWORD_CHANGE_REQUIRED`), sonra 2FA kurulumu.

### Hata zarfı

```json
{ "error": { "code": "VALIDATION", "message": "Gönderilen bilgiler geçersiz.",
             "fields": { "next": "Yeni şifre mevcut şifreden farklı olmalı" }, "requestId": "01K…" } }
```

`message` Türkçedir ve kullanıcıya gösterilebilir. `fields` yalnız alan hatalarında bulunur. 500 yanıtı
stack, SQL veya iç ayrıntı içermez.

| Kod                              | HTTP | Ne zaman                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VALIDATION`                     | 400  | Şema hatası (`fields` ile), bozuk/büyük gövde, yanlış mevcut şifre (`fields.current`), güncel olmayan KVKK metni (`fields.consentTextId`)                                                                                                                                                                                                                                |
| `UNAUTHENTICATED`                | 401  | Oturum yok/düşmüş; hatalı kimlik bilgisi (genel mesaj)                                                                                                                                                                                                                                                                                                                   |
| `FORBIDDEN`                      | 403  | Yetki anahtarı yok; join'de teknisyenin reddettiği IP; P9: Super Admin firma seçmedi, `/admin/*` SUPER_ADMIN değil, sahip olunmayan yetki (`fields["permissions.<anahtar>"]`), daha geniş yetkili hesap, kendi hesabı                                                                                                                                                    |
| `CSRF_INVALID`                   | 403  | Origin eksik/izinsiz veya `X-CSRF-Token` eşleşmiyor                                                                                                                                                                                                                                                                                                                      |
| `PASSWORD_CHANGE_REQUIRED`       | 403  | İlk giriş şifre değişimi yapılmadan başka uç çağrıldı                                                                                                                                                                                                                                                                                                                    |
| `MFA_REQUIRED`                   | 403  | P10: oturum 2FA kodu bekliyor ("Devam etmek için iki adımlı doğrulama kodunu girin.")                                                                                                                                                                                                                                                                                    |
| `MFA_STEP_UP_REQUIRED`           | 401  | P14a: hassas işlem (MySQL/TURN/WhatsApp sistem ayarı PUT/DELETE) son 5 dk içinde step-up ister; oturum geçerlidir → kod sor, `POST /auth/step-up`, isteği bir kez tekrarla                                                                                                                                                                                               |
| `MFA_SETUP_REQUIRED`             | 403  | P14a: step-up gereken uçta TOTP kurulu değil. P10: 2FA zorunlu ama kurulmamış ("Devam etmeden önce iki adımlı doğrulamayı kurmanız gerekiyor.")                                                                                                                                                                                                                          |
| `HOST_NOT_ALLOWED`               | 400  | P10: SMTP sunucusu özel/iç ağ/loopback/link-local/CGNAT adresine veya sunucunun kendi adresine çözülüyor ("Bu sunucu adresi kullanılamaz.")                                                                                                                                                                                                                              |
| `RESET_TOKEN_INVALID`            | 410  | P10: şifre sıfırlama bağlantısı geçersiz, kullanılmış veya süresi dolmuş                                                                                                                                                                                                                                                                                                 |
| `NOT_FOUND`                      | 404  | Yol veya kayıt yok (başka tenant'ın / başka teknisyenin kaydı da 404)                                                                                                                                                                                                                                                                                                    |
| `REQUEST_REF_INVALID`            | 404  | P8b: firma ref'i geçersiz, yenilenmiş, firma pasif veya ayarı yok (hepsi aynı yanıt)                                                                                                                                                                                                                                                                                     |
| `CONFLICT`                       | 409  | Kayıt işleme uygun durumda değil (ör. PENDING olmayan oturumu iptal, ACTIVE olmayanı sonlandırma); P9: e-posta/kısa ad çakışması (`fields.email` / `fields.slug`), zaten pasif/aktif                                                                                                                                                                                     |
| `STALE_WRITE`                    | 409  | P14a: `PATCH /users/:id` `If-Match` sürümü güncel değil ("Kayıt başkası tarafından değiştirildi, yeniden yükleyin")                                                                                                                                                                                                                                                      |
| `ACCEPT_CODE_CLIENT_UNSUPPORTED` | 409  | P15 (S15-6): firmada kabul kodu açık, talebin istemcisi 0.11.0'dan eski; talep PENDING kalır                                                                                                                                                                                                                                                                             |
| `PURGE_NOT_ELIGIBLE`             | 409  | P16: firma kalıcı silmeye uygun değil ("Firma henüz kalıcı silinemez (en az 30 gün pasif olmalı)."); `fields.eligibleAt` (ISO) ya da `fields.reason` (`not_passive`)                                                                                                                                                                                                     |
| `PRECONDITION_REQUIRED`          | 428  | P14a: `PATCH /users/:id` `If-Match: "v<n>"` başlığı yok veya bozuk; P16: `DELETE /users/:id` için de                                                                                                                                                                                                                                                                     |
| `PREVIEW_REQUIRED`               | 428  | P16: firma silme önizlemesi (`previewId`) yok, süresi geçmiş (15 dk), başka oturuma/duruma ait ya da kullanılmış ("Önizlemenin süresi doldu ya da geçersiz; önizlemeyi yeniden alın.")                                                                                                                                                                                   |
| `LOBBY_FULL`                     | 409  | Bekleme odasında 3 misafir var (join)                                                                                                                                                                                                                                                                                                                                    |
| `OPEN_SESSION_LIMIT`             | 409  | Teknisyenin açık oturum sınırı dolu (P8b: talep kabulünde talep beklemede kalır)                                                                                                                                                                                                                                                                                         |
| `REQUEST_PENDING`                | 409  | P8b: bu istemci örneğinin zaten bekleyen talebi var                                                                                                                                                                                                                                                                                                                      |
| `REQUEST_TAKEN`                  | 409  | P8b: talebi başka teknisyen kabul etti                                                                                                                                                                                                                                                                                                                                   |
| `REQUEST_CLOSED`                 | 409  | P8b: talep iptal, süre dolumu veya ret ile kapandı; P18: mesaj, atama ve öncelik uçlarında talep artık PENDING değil                                                                                                                                                                                                                                                     |
| `OUTSIDE_HOURS`                  | 409  | P18: firmada mesai takvimi açık, şu an mesai dışı ve mod "Reddet"; talep açılmaz. `fields.nextOpeningAt` (ISO; bir yıl içinde açık an yoksa yok). Yalnız 0.12.0 ve sonrası istemciye; eskisine `QUEUE_FULL`                                                                                                                                                              |
| `CHAT_UNSUPPORTED`               | 409  | P18: `POST /support-requests/:id/messages` — müşterinin bağlı programı mesajlaşmayı desteklemiyor (`rs.cap.chat1` bildirmedi). Müşteri bağlı değilse hata yok; mesaj saklanır                                                                                                                                                                                            |
| `SESSION_ANONYMIZED`             | 409  | P13a: oturum saklama süresi dolduğu için anonimleştirildi, ticket/not yazılamaz ("Bu oturum saklama süresi dolduğu için anonimleştirildi; düzenlenemez.")                                                                                                                                                                                                                |
| `SESSION_EXPIRED`                | 410  | Oturum linkinin/kodunun süresi dolmuş                                                                                                                                                                                                                                                                                                                                    |
| `SESSION_CONSUMED`               | 410  | Link/kod kullanılmış (müşteri kabul edilmiş)                                                                                                                                                                                                                                                                                                                             |
| `SESSION_CANCELLED`              | 410  | Oturum iptal edilmiş                                                                                                                                                                                                                                                                                                                                                     |
| `NONCE_INVALID`                  | 410  | `joinNonce` süresi dolmuş (60 sn), kullanılmış veya bilinmiyor                                                                                                                                                                                                                                                                                                           |
| `CLIENT_OUTDATED`                | 426  | P8b: Windows istemci sürümü `MIN_AGENT_VERSION`'dan düşük; `fields.minVersion`                                                                                                                                                                                                                                                                                           |
| `ACCOUNT_LOCKED`                 | 423  | Giriş kilidi; `Retry-After` (saniye) başlığı ile                                                                                                                                                                                                                                                                                                                         |
| `INVALID_IMAGE`                  | 400  | P12: yüklenen dosya PNG/JPEG/WEBP değil (tür içerikten okunur; SVG, GIF, sahte uzantı reddedilir), bozuk, 24 MP'den büyük ("Yalnız PNG, JPG veya WEBP resim yükleyebilirsiniz.") ya da boyut/oran dışı ("Resim boyutları uygun değil: her kenar en az 16 px, en-boy oranı logoda en çok 20:1, profil resminde en çok 4:1 olmalı.")                                       |
| `PAYLOAD_TOO_LARGE`              | 413  | P12: yüklenen dosya 2 MB'tan büyük ("Dosya en çok 2 MB olabilir.")                                                                                                                                                                                                                                                                                                       |
| `METHOD_NOT_ALLOWED`             | 405  | P11: audit uçlarına POST/PUT/PATCH/DELETE (`Allow` başlığıyla); audit kayıtları salt okunurdur                                                                                                                                                                                                                                                                           |
| `RATE_LIMITED`                   | 429  | Hız sınırı aşıldı (giriş, oturum oluşturma, public uçlar, P8 müşteri araması ve CSV dışa aktarma; P11 audit CSV, MySQL testi, aydınlatma metni kaydı; P12 resim yükleme 20/sa/kullanıcı, resim işleme kuyruğu dolu, `/public/branding` 60/dk/IP; P13a sistem ayarı PUT/DELETE 10/dk/kullanıcı; P13b-L `GET /sessions/waiting` 60/dk/kullanıcı); `Retry-After` ile        |
| `QUEUE_FULL`                     | 429  | P8b: firmada 50 bekleyen talep, ya da ≥ 40 iken bilinmeyen kaynak ("Şu an çok yoğunuz, lütfen firmanızı telefonla arayın."). P18: 0.12.0'dan eski istemciye mesai dışı reddi de bu kodla döner (mesaj "Mesai dışındayız…", `Retry-After` yok)                                                                                                                            |
| `INTERNAL`                       | 500  | Beklenmeyen hata                                                                                                                                                                                                                                                                                                                                                         |
| `UPSTREAM`                       | 502  | P8b: WhatsApp test ucu — servis yapılandırılmamış veya production'da güvensiz adres. P10: SMTP yok ("Önce SMTP ayarlarını yapın") veya gönderim başarısız (tek genel mesaj "E-posta gönderilemedi. Sunucu, port, güvenlik ve kimlik bilgilerini kontrol edin.")                                                                                                          |
| `NOT_READY`                      | 503  | `/ready`: DB'ye ulaşılamıyor veya migration yok; P6: Windows istemci ikilisi yok, yapılandırılmamış veya SHA-256'sı `AGENT_SHA256` ile uyuşmuyor. **P8b-1:** herhangi bir uçta geçici DB çekişmesi (Prisma P2028/P2034, MySQL 1205/1213/45028) veya talep kapısı dolu → `Retry-After: 5`, mesaj "Sunucu şu an yoğun…"; yazma geri alındığından yeniden deneme güvenlidir |

## Uçlar

| Metot                       | Yol                                                                                                     | Yetki                                                                     | Başarı                |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------- |
| POST                        | `/api/v1/auth/login`                                                                                    | Public (Origin)                                                           | 200 + iki çerez       |
| POST                        | `/api/v1/auth/logout`                                                                                   | Oturum + CSRF                                                             | 204, çerezler silinir |
| GET                         | `/api/v1/auth/me`                                                                                       | Oturum                                                                    | 200                   |
| POST                        | `/api/v1/auth/password/change`                                                                          | Oturum + CSRF                                                             | 204 + yeni çerezler   |
| POST                        | `/api/v1/auth/mfa/setup` (P10)                                                                          | Oturum + CSRF, aşama `setup` veya `ok`                                    | 200                   |
| POST                        | `/api/v1/auth/mfa/enable` (P10)                                                                         | Oturum + CSRF, aşama `setup` veya `ok`                                    | 200                   |
| POST                        | `/api/v1/auth/mfa/verify` (P10)                                                                         | Oturum (aşama `verify`) + CSRF                                            | 200 + yeni çerezler   |
| POST                        | `/api/v1/auth/step-up` (P14a)                                                                           | Oturum (aşama `ok`) + CSRF, TOTP kurulu                                   | 200                   |
| POST                        | `/api/v1/auth/mfa/recovery-codes` (P15)                                                                 | Oturum + CSRF, TOTP kurulu                                                | 200                   |
| POST                        | `/api/v1/auth/logout-all` (P10)                                                                         | Oturum + CSRF                                                             | 200                   |
| POST                        | `/api/v1/auth/password/forgot` (P10)                                                                    | Public (Origin)                                                           | 202                   |
| POST                        | `/api/v1/auth/password/reset` (P10)                                                                     | Public (Origin)                                                           | 204                   |
| POST                        | `/api/v1/settings/smtp/test` (P10)                                                                      | Oturum + CSRF, `settings.edit`, firma bağlamı                             | 200                   |
| POST                        | `/api/v1/settings/support-requests/email/test` (P10)                                                    | Oturum + CSRF, `settings.edit`                                            | 200                   |
| POST                        | `/api/v1/sessions/:id/email` (P10)                                                                      | Oturum + CSRF, `sessions.create`, oturumun teknisyeni                     | 200                   |
| POST                        | `/api/v1/users/:id/reset-mfa` (P10)                                                                     | Oturum + CSRF, `users.edit`                                               | 204                   |
| POST                        | `/api/v1/sessions`                                                                                      | Oturum + CSRF, `sessions.create`                                          | 201                   |
| GET                         | `/api/v1/sessions`                                                                                      | Oturum, `sessions.view` **veya** `session_history.view`                   | 200                   |
| GET                         | `/api/v1/sessions/waiting` (P13b-L)                                                                     | Oturum, `sessions.view`, firma bağlamı                                    | 200                   |
| GET                         | `/api/v1/sessions/export.csv` (P8)                                                                      | Oturum, `session_history.export`                                          | 200 (CSV akışı)       |
| GET                         | `/api/v1/sessions/:id`                                                                                  | Oturum, `sessions.view`                                                   | 200                   |
| GET                         | `/api/v1/sessions/:id/history` (P8)                                                                     | Oturum, `session_history.view`                                            | 200                   |
| PATCH                       | `/api/v1/sessions/:id` (P8)                                                                             | Oturum + CSRF, `session_history.edit`                                     | 200                   |
| POST                        | `/api/v1/sessions/:id/cancel`                                                                           | Oturum + CSRF, `sessions.delete`                                          | 200                   |
| POST                        | `/api/v1/sessions/:id/terminate`                                                                        | Oturum + CSRF, `sessions.terminate`                                       | 200                   |
| POST                        | `/api/v1/public/sessions/resolve`                                                                       | Public (Origin veya AGENT)                                                | 200                   |
| POST                        | `/api/v1/public/sessions/join`                                                                          | Public (Origin veya AGENT)                                                | 200                   |
| GET                         | `/api/v1/public/sessions/status`                                                                        | Public                                                                    | 200                   |
| GET                         | `/api/v1/public/agent/download` (P6; `?os=windows\|macos` P28f, `linux` P28g)                           | Public                                                                    | 302                   |
| GET                         | `/api/v1/public/agent/availability` (P28f; `linux` alanı P28g)                                          | Public                                                                    | 200                   |
| GET                         | `/downloads/NoktaDestek.exe`, `/downloads/Destek-<8 hane>.exe` (P6, Caddy statik)                       | Public, server bütünlük kapısı                                            | 200                   |
| GET                         | `/downloads/NoktaDestek-macOS.zip`, `/downloads/Destek-<8 hane>.zip` (P28f, Caddy)                      | Public, server macOS bütünlük kapısı                                      | 200                   |
| GET                         | `/downloads/NoktaDestek-linux`, `/downloads/Destek-<8 hane>` (uzantısız; P28g, Caddy)                   | Public, server Linux bütünlük kapısı                                      | 200                   |
| GET                         | `/health`, `/ready`                                                                                     | Yalnız iç ağ                                                              | 200                   |
| GET                         | `/metrics`                                                                                              | Yalnız iç ağ + `METRICS_TOKEN` (Bearer)                                   | 200                   |
| GET                         | `/internal/agent-ready`, `/internal/agent-ready/{windows,macos,macos-firm,linux}` (P6, P28f, P31, P28g) | Yalnız Caddy `forward_auth`; dışarıya kapalı                              | 204                   |
| WS                          | `/ws/tech?sessionId=<id>`                                                                               | Oturum çerezi + Origin, oturumun teknisyeni                               | 101                   |
| WS                          | `/ws/guest`                                                                                             | Subprotocol'de `wsTicket` veya `reconnectToken`                           | 101                   |
| GET                         | `/api/v1/public/requests/tenant?ref=` (P8b)                                                             | Public                                                                    | 200                   |
| POST                        | `/api/v1/public/requests` (P8b)                                                                         | Public (yalnız AGENT: Origin ve `Sec-Fetch-*` yok)                        | 201                   |
| POST                        | `/api/v1/public/requests/cancel` (P8b)                                                                  | Public (yalnız AGENT)                                                     | 204                   |
| GET                         | `/api/v1/public/agent/request-download?ref=[&os=windows\|macos]` (P8b; `os` P31)                        | Public                                                                    | 302                   |
| GET                         | `/downloads/NoktaDestek-<firma>-<ref>.exe` (P8b, Caddy statik)                                          | Public, server ref + bütünlük kapısı                                      | 200                   |
| GET                         | `/downloads/NoktaDestek-<firma>-<ref>.zip` (P31, Caddy statik)                                          | Public, server ref + macOS bütünlük kapısı (`macos-firm`)                 | 200                   |
| GET                         | `/api/v1/support-requests` (P8b)                                                                        | Oturum, `support_requests.view`                                           | 200                   |
| GET                         | `/api/v1/support-requests/count` (P8b)                                                                  | Oturum, `support_requests.view`                                           | 200                   |
| GET                         | `/api/v1/support-requests/:id` (P8b)                                                                    | Oturum, `support_requests.view`                                           | 200                   |
| POST                        | `/api/v1/support-requests/:id/accept` (P8b)                                                             | Oturum + CSRF, `support_requests.view` + `accept`                         | 200                   |
| POST                        | `/api/v1/support-requests/:id/reject` (P8b)                                                             | Oturum + CSRF, `support_requests.view` + `accept`                         | 204                   |
| GET                         | `/api/v1/settings/support-requests` (P8b)                                                               | Oturum, `settings.edit`                                                   | 200                   |
| PUT                         | `/api/v1/settings/support-requests` (P8b)                                                               | Oturum + CSRF, `settings.edit`                                            | 200                   |
| POST                        | `/api/v1/settings/support-requests/rotate-ref` (P8b)                                                    | Oturum + CSRF, `settings.edit`                                            | 200                   |
| POST                        | `/api/v1/settings/support-requests/whatsapp/test` (P8b)                                                 | Oturum + CSRF, `settings.edit`                                            | 200                   |
| WS                          | `/ws/request` (P8b)                                                                                     | Subprotocol `rs.v1, rs.req.<requestSecret>`; Origin yok                   | 101                   |
| WS                          | `/ws/panel` (P8b)                                                                                       | Oturum çerezi + Origin, `support_requests.view`, tenant bağlamı           | 101                   |
| GET                         | `/api/v1/users` (P9)                                                                                    | Oturum, `users.view`, firma bağlamı                                       | 200                   |
| POST                        | `/api/v1/users` (P9)                                                                                    | Oturum + CSRF, `users.create`, firma bağlamı                              | 201                   |
| GET                         | `/api/v1/users/options?tenantId=` (P14b)                                                                | Oturum, `session_history.view` \| `support_requests.view` \| `users.view` | 200                   |
| GET                         | `/api/v1/users/:id` (P9; P14a `ETag`)                                                                   | Oturum, `users.view`                                                      | 200 + `ETag`          |
| PATCH                       | `/api/v1/users/:id` (P9; P14a `If-Match` zorunlu)                                                       | Oturum + CSRF, `users.edit`                                               | 200 + `ETag`          |
| POST                        | `/api/v1/users/:id/deactivate` · `/reactivate` (P9)                                                     | Oturum + CSRF, `users.edit`                                               | 204                   |
| DELETE                      | `/api/v1/users/:id` (P16)                                                                               | Oturum + CSRF, `users.delete`, step-up, `If-Match`                        | 204                   |
| GET                         | `/api/v1/settings/tenant` (P9)                                                                          | Oturum, `settings.view`, firma bağlamı                                    | 200                   |
| PUT                         | `/api/v1/settings/tenant` (P9)                                                                          | Oturum + CSRF, `settings.edit`, firma bağlamı                             | 200                   |
| GET · POST                  | `/api/v1/admin/tenants` (P9)                                                                            | Oturum (+ CSRF), yalnız SUPER_ADMIN                                       | 200 · 201             |
| GET                         | `/api/v1/admin/tenants/options` (P14b)                                                                  | Oturum, yalnız SUPER_ADMIN                                                | 200                   |
| GET · PATCH                 | `/api/v1/admin/tenants/:id` (P9)                                                                        | Oturum (+ CSRF), yalnız SUPER_ADMIN                                       | 200                   |
| POST                        | `/api/v1/admin/tenants/:id/deactivate` · `/reactivate` (P9)                                             | Oturum + CSRF, yalnız SUPER_ADMIN                                         | 200                   |
| POST · DELETE · GET         | `/api/v1/admin/tenants/:id/purge` (P16)                                                                 | Oturum (+ CSRF), yalnız SUPER_ADMIN; step-up `dryRun:false` ve DELETE     | 200 · 202 · 200       |
| GET                         | `/api/v1/admin/purge-jobs?open=1` (P16)                                                                 | Oturum, yalnız SUPER_ADMIN                                                | 200                   |
| POST                        | `/api/v1/admin/switch-tenant` (P9)                                                                      | Oturum + CSRF, yalnız SUPER_ADMIN                                         | 200                   |
| GET                         | `/api/v1/audit` · `/api/v1/audit/export.csv` (P11)                                                      | Oturum, `audit.view` · `audit.export`                                     | 200                   |
| POST · PUT · PATCH · DELETE | `/api/v1/audit`, `/audit/export.csv`, `/audit/:id` (P11)                                                | —                                                                         | 405                   |
| GET · PUT                   | `/api/v1/admin/settings/mysql` (P11; P14a PUT step-up)                                                  | Oturum (+ CSRF), yalnız SUPER_ADMIN                                       | 200                   |
| POST                        | `/api/v1/admin/settings/mysql/test` (P11)                                                               | Oturum + CSRF, yalnız SUPER_ADMIN                                         | 200                   |
| GET · PUT · DELETE          | `/api/v1/admin/settings/turn` (P11; P14a PUT/DELETE step-up)                                            | Oturum (+ CSRF), yalnız SUPER_ADMIN                                       | 200                   |
| GET · PUT · DELETE          | `/api/v1/admin/settings/whatsapp` (P12b; P14a PUT/DELETE step-up)                                       | Oturum (+ CSRF), yalnız SUPER_ADMIN                                       | 200                   |
| POST                        | `/api/v1/admin/settings/whatsapp/test` (P12b)                                                           | Oturum + CSRF, yalnız SUPER_ADMIN                                         | 200                   |
| GET · PUT                   | `/api/v1/settings/consent-text` (P11)                                                                   | Oturum (+ CSRF), `settings.view` · `settings.edit`, firma bağlamı         | 200                   |
| PATCH                       | `/api/v1/auth/me/preferences` (P12)                                                                     | Oturum + CSRF (şifre değişimi / 2FA kurulumu aşamasında da)               | 200 + `rs_theme`      |
| POST · DELETE               | `/api/v1/settings/logo` (P12)                                                                           | Oturum + CSRF, `settings.edit`, firma bağlamı                             | 200                   |
| POST · DELETE               | `/api/v1/users/:id/avatar` (P12; `:id` = `me` olabilir)                                                 | Oturum + CSRF; kendi hesabı serbest, başkası `users.edit`                 | 200                   |
| POST · DELETE               | `/api/v1/admin/settings/system-logo` (P12; P15 DELETE)                                                  | Oturum + CSRF, yalnız SUPER_ADMIN                                         | 200                   |
| GET                         | `/api/v1/admin/superadmins` (P15)                                                                       | Oturum, yalnız SUPER_ADMIN                                                | 200                   |
| POST                        | `/api/v1/admin/superadmins/:id/reset-password` (P15)                                                    | Oturum + CSRF, yalnız SUPER_ADMIN, step-up                                | 200                   |
| GET · POST · DELETE         | `/api/v1/request-blocks` · `/api/v1/request-blocks/:id` (P15)                                           | Oturum (+ CSRF), `support_requests.block`, firma bağlamı                  | 200 · 201 · 204       |
| GET                         | `/api/v1/public/sessions/:sessionId/tech-avatar?exp=&sig=` (P15)                                        | Public, imzalı URL (≤ 10 dk)                                              | 200 (WEBP)            |
| GET                         | `/api/v1/files/logo/:tenantId/:file`, `/api/v1/files/system-logo/:file` (P12)                           | Public                                                                    | 200 (PNG)             |
| GET                         | `/api/v1/files/avatar/:tenantId/:file` (P12)                                                            | Oturum (aynı firma veya Super Admin)                                      | 200 (WEBP)            |
| GET                         | `/api/v1/public/branding?tenant=<slug>` (P12)                                                           | Public                                                                    | 200                   |
| POST                        | `/api/v1/customer-send/options` (LG)                                                                    | Oturum + CSRF, hedefe göre (aşağıda), firma bağlamı                       | 200                   |
| POST                        | `/api/v1/customer-send` (LG)                                                                            | Oturum + CSRF, hedefe ve kanala göre (aşağıda), firma bağlamı             | 200                   |
| GET                         | `/api/v1/public/unattended/download?t=` (LG)                                                            | Public, oturumsuz; süreli belirteç                                        | 200 (exe)             |

### POST /api/v1/auth/login

Girdi: `login` (e-posta veya kullanıcı adı, 3–190; `@` içeriyorsa e-posta olarak aranır), `password` (1–200),
`tenantSlug` (isteğe bağlı, 1–60; P1'de kabul edilir ama kullanılmaz).

```bash
curl -sk -i -X POST https://localhost:4450/api/v1/auth/login \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' \
  -d '{"login":"admin@example.com","password":"<şifre>"}'
```

```json
{ "user": { "id": "01K…", "email": "admin@example.com", "username": null, "fullName": "Super Admin",
            "role": "SUPER_ADMIN", "tenantId": null, "theme": "SYSTEM", "avatarUrl": null, "mustChangePassword": true },
  "mfaRequired": false, "mustChangePassword": true }
```

Yanıtta `Set-Cookie: __Host-rs_session=…` ve `Set-Cookie: __Host-rs_csrf=…` gelir. P10: yanıtta ayrıca
`mfaSetupRequired` vardır. `mfaRequired: true` → oturum `verify` aşamasında, `POST /auth/mfa/verify` gerekir;
`mfaSetupRequired: true` → kurulum gerekir (bkz. "2FA aşaması"). Aynı tarayıcının eski oturum çerezi varsa o oturum sunucuda iptal edilir.
P12: yanıt ayrıca kullanıcının tema tercihini `rs_theme` çerezine yazar.

Hatalar: 400 `VALIDATION`; 401 `UNAUTHENTICATED` ("E-posta/kullanıcı adı veya şifre hatalı." — hesap var/yok,
pasif kullanıcı veya pasif tenant için aynı mesaj); 403 `CSRF_INVALID`; 423 `ACCOUNT_LOCKED`; 429 `RATE_LIMITED`.

Kilit kuralları:

- Aynı hesap + IP: 15 dakikada 5. hatalı denemenin kendisi 423 döner; 15 dk kilit. Başka IP etkilenmez.
- Hesap geneli: IP'den bağımsız 1 saatte 20 hata → 15 dk kilit. Var olmayan hesapta da aynı davranış (varlık sızmaz).
- Kilitliyken doğru şifre de 423 alır. `Retry-After` kalan süreyi saniye olarak verir.
- IP başına dakikada 20 deneme; 21. deneme 429.
- P10: hesap geneli kilit konduğunda kullanıcıya "Hesabınız geçici olarak kilitlendi" e-postası gider (firma SMTP'si
  varsa; kullanıcı başına saatte en çok 1). Super Admin'e gönderilmez.

### POST /api/v1/auth/logout

Girdi yok (gövdesiz istek kabul edilir, `Content-Type: application/json` ile boş gövde de). Gerekli: oturum
çerezi, `X-CSRF-Token`, `Origin`.

```bash
curl -sk -i -X POST https://localhost:4450/api/v1/auth/logout \
  -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF"
```

Başarı: 204, oturum sunucuda iptal, iki çerez `Max-Age=0` ile silinir. 401/403 durumunda da yanıt çerezleri
temizler, ancak sunucu oturumu yalnız geçerli CSRF ile iptal edilir.

### GET /api/v1/auth/me

Gerekli: oturum çerezi. `mustChangePassword=true` iken de çalışır.

```json
{ "user": { "id": "01K…", "email": "admin@example.com", "username": null, "fullName": "Super Admin",
            "role": "SUPER_ADMIN", "tenantId": null, "theme": "SYSTEM", "avatarUrl": null, "mustChangePassword": false },
  "permissions": ["sessions.view", "sessions.create", "…"],
  "tenant": null, "actingTenant": null, "logoUrl": "/img/logo.png" }
```

`role`: `SUPER_ADMIN` | `ADMIN` | `USER`. `tenant`: `{ id, name, slug }` veya Super Admin için `null`.
`actingTenant` P1'de daima `null` (tenant geçişi P9). `permissions` etkin yetki anahtarlarıdır
(`packages/contracts/src/permissions.ts`). P10: `mfa: { enabled, required, stage: "ok"|"verify"|"setup",
recoveryCodesLeft }`; `verify` aşamasında `permissions` boş ve `actingTenant` `null`.
P12: `user.theme` (`LIGHT` | `DARK` | `SYSTEM`), `user.avatarUrl` (`/api/v1/files/avatar/…` veya `null` → baş harf rozeti),
`logoUrl` (üst menü logosu; her zaman dolu: etkin firmanın logosu → sistem logosu → `/img/logo.png`; 2FA bekleyen oturumda
seçili firma yerine kullanıcının kendi firması). Yanıt `rs_theme` çerezini yeniler. Hata: 401.

### POST /api/v1/auth/password/change

Girdi: `current` (1–200), `next` (12–200, `current`'tan farklı). Gerekli: oturum, `X-CSRF-Token`, `Origin`.

```bash
curl -sk -i -X POST https://localhost:4450/api/v1/auth/password/change \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF" \
  -d '{"current":"<eski>","next":"<en az 12 karakter yeni>"}'
```

Başarı: 204. `mustChangePassword` false olur; kullanıcının **tüm** oturumları (mevcut dahil) iptal edilir ve
yanıtta yeni `__Host-rs_session` + `__Host-rs_csrf` gelir (eski çerez artık 401). Yeni oturumun bitişi eskisini aşmaz.

Hatalar: 400 `VALIDATION` (`fields.current`: "Mevcut şifre hatalı."; `fields.next`: uzunluk veya aynı şifre);
401 (oturum yok; ya da aynı oturumda 5 hatalı mevcut şifre → oturum iptal, yeniden giriş gerekir); 403 `CSRF_INVALID`.
P10: şifre değişimi açık şifre sıfırlama bağlantılarını da geçersiz kılar.

### POST /api/v1/auth/mfa/setup (P10)

Gövde `{}` veya boş. Yeni TOTP sırrı üretir (henüz etkin değil; sır AES-256-GCM ile saklanır). `Cache-Control: no-store`.

```json
{ "otpauthUrl": "otpauth://totp/…", "qrDataUrl": "data:image/png;base64,…", "secret": "<base32>" }
```

TOTP: RFC 6238, SHA-1, 6 hane, 30 sn, ±1 adım. Hatalar: 403 `PASSWORD_CHANGE_REQUIRED`, 409 "İki adımlı doğrulama zaten
etkin." (önce Admin sıfırlaması gerekir).

### POST /api/v1/auth/mfa/enable (P10)

Gövde `{ "code": "123456" }`. Doğrulanınca 2FA etkinleşir, eski kurtarma kodları silinir ve 10 yeni kod **yalnız bu
yanıtta** döner; kullanıcının **diğer** oturumları iptal edilir; firma SMTP'si varsa "İki adımlı doğrulama
etkinleştirildi" e-postası gider.

```json
{ "recoveryCodes": ["ABCDE-FGHIJ", "…"] }
```

Hatalar: 400 `fields.code` "Kod hatalı veya süresi geçmiş.", 409 "Önce kurulumu başlatın." / "Kurulum değişti veya iki
adımlı doğrulama zaten etkin; sayfayı yenileyin." (paralel ikinci kurulum), 429 (deneme sınırı, aşağıda).

### POST /api/v1/auth/mfa/verify (P10)

Gövde `{ "code": "123456" }` **veya** `{ "recoveryCode": "ABCDE-FGHIJ" }` (ikisi birden değil; kurtarma kodunda boşluk,
tire ve büyük/küçük harf önemsiz). Başarıda oturum token'ı yenilenir (yeni çerezler):

```json
{ "user": { "id": "01K…", "…": "…" }, "recoveryCodesLeft": 9 }
```

Aynı TOTP kodu (aynı veya eski zaman adımı) ikinci kez kabul edilmez; kurtarma kodu tek kullanımlıktır.
Hatalar: 401 `UNAUTHENTICATED` "Doğrulama kodu hatalı.", 409 "Bu oturum için doğrulama gerekmiyor.", 429.

**2FA deneme sınırı** (verify ve enable ortak): aynı hesap + IP 5 deneme / 5 dk; hesap geneli (IP'den bağımsız) 15 deneme /
15 dk; aşımda 429 `RATE_LIMITED` + `Retry-After`. Başarılı doğrulama sayaçları sıfırlar.

### POST /api/v1/auth/step-up (P14a)

Hassas işlemlerden önce taze 2FA kanıtı (ADR-0022). Gövde `{ "method": "TOTP", "code": "123456" }` **veya**
`{ "method": "RECOVERY", "code": "ABCDE-FGHIJ" }`. Başarıda bu oturumun `step_up_at` alanı yazılır; hassas uçlar
`stepUpUntil` anına (5 dk) kadar açık kalır. `Cache-Control: no-store`.

```json
{ "stepUpUntil": "2026-11-15T10:05:00.000Z", "method": "RECOVERY", "recoveryCodesLeft": 9 }
```

- TOTP: aynı/eski zaman adımı ikinci kez kabul edilmez. Kurtarma kodu tüketilir (tek kullanımlık).
- Kurtarma koduyla: firma SMTP'si varsa "Kurtarma kodunuz kullanıldı" e-postası gider; `recoveryCodesLeft` ≤ 3 ise
  arayüz yenileme uyarısı gösterir. TOTP ile yanıtta `recoveryCodesLeft` yoktur.
- Audit `auth.step_up` `{ method, remaining }` (kod yazılmaz); hatada `{ method, reason }`.
- Hatalar: 400 `fields.code` "Kod hatalı veya süresi geçmiş." (401 değil), 403 `MFA_SETUP_REQUIRED` (TOTP kurulu değil),
  429 (deneme sınırı verify/enable ile ortak).
- Step-up isteyen uçlar: `PUT /admin/settings/mysql`, `PUT|DELETE /admin/settings/turn`, `PUT|DELETE /admin/settings/whatsapp`,
  `POST /admin/superadmins/:id/reset-password` (P15).
  Eksikse 401 `MFA_STEP_UP_REQUIRED`, TOTP yoksa 403 `MFA_SETUP_REQUIRED`.

### POST /api/v1/auth/mfa/recovery-codes (P15)

Kurtarma kodlarını yeniler (AC-231). Gövde `{ "code": "123456" }`: yalnız doğrulama uygulamasının 6 haneli TOTP kodu;
kurtarma koduyla yenileme yapılmaz. Başarıda eski kodların hepsi aynı işlemde silinir, 10 yeni kod **yalnız bu yanıtta**
döner. `Cache-Control: no-store`.

```json
{ "codes": ["ABCDE-FGHIJ", "…"] }
```

- Aynı TOTP zaman adımı ikinci kez kabul edilmez. Deneme sayacı `/auth/mfa/verify` ve step-up ile ortaktır (hesap + IP
  5 / 5 dk, hesap 15 / 15 dk).
- Audit `mfa.recovery_regenerated` `{ count }`; hatalı kodda `result: fail`, `{ reason: invalid_code | replayed_code }`.
  Kodlar hiçbir yere yazılmaz.
- Hatalar: 400 `VALIDATION` `fields.code` "Kod hatalı veya süresi geçmiş.", 401, 403 `MFA_SETUP_REQUIRED` (2FA kurulu
  değil), 403 `CSRF_INVALID`, 429 `RATE_LIMITED` + `Retry-After`.

### Kullanıcı düzenleme: ETag / If-Match (P14a)

`GET /users/:id` yanıtı `version` alanı ve `ETag: "v<version>"` başlığı taşır. `PATCH /users/:id` için
`If-Match: "v<n>"` zorunludur: yoksa ya da bozuksa (`*`, zayıf `W/`, liste) 428 `PRECONDITION_REQUIRED`; araya başka bir
değişiklik girdiyse 409 `STALE_WRITE`. Başarılı PATCH yeni `ETag` döner. Değişiklik içermeyen PATCH sürümü artırmaz.
Pasif/aktif, 2FA sıfırlama ve kullanıcının 2FA kurulumu da sürümü artırır. Yetki/üstünlük/kendi hesabı kaynaklı 403'ler
ve e-posta çakışması audit'e `result: "fail"` ile yazılır (`{ op, denied }` / `{ op, reason: "email_taken" }`).

**Hız sınırı (P14a):** `/users*` yazma uçları kullanıcı başına 30/dk, `POST /users` ayrıca 10/dk; `/admin/tenants*` ve
`/admin/switch-tenant` yazmaları 30/dk. Aşımda 429 `RATE_LIMITED` + `Retry-After`.

### GET /api/v1/users/options?tenantId= (P14b)

Filtre seçicisi için teknisyen listesi: `{ "items": [{ "id", "fullName", "status" }] }`. Sayfasız, en çok 1.000, ad
sırasıyla, pasif kullanıcılar dahil, Super Admin hesapları hariç. Etkin firma kapsamında çalışır. USER rolü yalnız
kendisini görür.

`tenantId` (isteğe bağlı, ULID) yalnız firma seçmemiş Super Admin içindir: o firmanın teknisyenlerini döndürür
(firma yoksa/silinmişse 404). Super Admin firma seçmemişse ve `tenantId` vermezse 403. Firma seçmiş Super Admin'de ve
diğer rollerde parametre **yok sayılır**; her zaman etkin firma döner, başka firmanın listesi alınamaz (`GET /sessions`
`tenantId` kuralıyla aynı). Bozuk kimlik veya bilinmeyen parametre 400 `VALIDATION`.

### GET /api/v1/admin/tenants/options?q=&limit= (P14b)

Aranabilir firma seçici (yalnız Super Admin): `{ "items": [{ "id", "name", "slug", "status" }] }`. `q` adda harf duyarsız
önek + içerir araması (≤ 120 karakter, `%`/`_` düz karakter sayılır); `limit` 1–20 (varsayılan 20). Sıra: önek eşleşmesi
önce, aktif firmalar önce, ada göre. Silinmiş firmalar dönmez.

### POST /api/v1/auth/logout-all (P10)

Gövde `{}` veya boş. Bu oturum açık kalır; kullanıcının diğer tüm oturumları iptal edilir, açık destek oturumları
5 sn içinde `session.ended{auth_revoked}` ile sonlanır.

```json
{ "revokedSessions": 2 }
```

### POST /api/v1/auth/password/forgot (P10)

Public; `Origin` zorunlu, CSRF çerezi gerekmez. Gövde `{ "email": "ayse@example.com" }`. **Her durumda 202** (hesap var/yok,
pasif, Super Admin); e-posta yanıt döndükten sonra gönderilir, süre de hesabın varlığını sızdırmaz. Firma SMTP'si varsa
kullanıcıya `${PUBLIC_BASE_URL}/reset-password#token=<43 karakter>` bağlantısı gider (30 dk, tek kullanım; token URL
parçasında olduğu için sunucu/proxy loguna girmez). Yeni istek önceki açık bağlantıları geçersiz kılar.
Sınırlar: IP başına saatte 10 (11. → 429); hesap başına saatte 3 (aşım sessiz, yine 202).

```bash
curl -sk -i -X POST https://localhost:4450/api/v1/auth/password/forgot \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' -d '{"email":"ayse@example.com"}'
```

### POST /api/v1/auth/password/reset (P10)

Public; `Origin` zorunlu. Gövde `{ "token": "<43 karakter>", "next": "<en az 12 karakter>" }` → 204. Şifre değişir,
`mustChangePassword` kalkar, giriş kilit sayaçları sıfırlanır ve kullanıcının **tüm** oturumları kapanır.
Hatalar: 400 `VALIDATION`, 410 `RESET_TOKEN_INVALID`, 429 (IP başına 15 dk'da 10).

## Destek oturumları (P2)

Teknisyen uçları oturum çerezi ister; `mustChangePassword` kapısı geçerlidir. Kapsam: USER yalnız kendi açtığı
oturumları görür ve iptal eder (`technicianId` filtresi bunu ezemez); ADMIN kendi tenant'ının tümünü görür.
Başka tenant'ın veya başka teknisyenin oturumu, biçimsiz `:id` dahil → 404. Super Admin tenant seçmeden oluşturma,
iptal ve sonlandırma uçlarını çağıramaz → 403 `FORBIDDEN` (tenant geçişi P9). P8'den beri liste, `:id`,
`:id/history`, PATCH ve `export.csv` tek kapsam fonksiyonunu (`historyScope`) kullanır; Super Admin bu beş uçta firma
seçmeden **tüm firmaları** görür (bkz. "Oturum geçmişi (P8)"). Tipler: `@remote/contracts/api/sessions`.

Oturum durumları: `PENDING` (müşteri bekleniyor) · `ACTIVE` · `ENDED` · `EXPIRED` · `CANCELLED`.
`endedBy`: `TECH` | `CUSTOMER` | `ADMIN` | `SYSTEM`.

### POST /api/v1/sessions

Girdi: boş nesne `{}` veya (P8c) `{ "customerId": "<aktif müşteri ULID>" }` — bkz. "Müşteriler ve bilgisayar kaydı". Gerekli: oturum, `X-CSRF-Token`, `Origin`.

```bash
curl -sk -i -X POST https://localhost:4450/api/v1/sessions \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF" -d '{}'
```

Yanıt 201 (`Cache-Control: no-store`):

```json
{ "id": "01K…", "link": "https://localhost:4450/session/<43-karakter-token>", "code": "<8-hane>",
  "techVerifyCode": "<doğrulama-kodu>", "expiresAt": "2026-11-11T10:15:00.000Z", "status": "PENDING" }
```

- `link` **yalnız bu yanıtta** döner; düz token DB'de tutulmaz (yalnız SHA-256). Kaybolursa oturum iptal edilip
  yenisi açılır.
- `code` boşluksuz 8 hanedir; arayüz `4829 1376` biçiminde gösterir.
- `expiresAt` = oluşturma + tenant ayarı `session_ttl_min` (15–30, varsayılan 15 dk).

Hatalar: 401; 403 `FORBIDDEN` (yetki yok / tenant seçilmemiş), `CSRF_INVALID`, `PASSWORD_CHANGE_REQUIRED`;
409 `OPEN_SESSION_LIMIT` (açık oturum = ACTIVE + süresi dolmamış PENDING; sınır tenant ayarı `max_open_sessions`,
varsayılan 3); 429 `RATE_LIMITED` (teknisyen başına saatte 20 oturum; `Retry-After`). İki sınır da DB'de tek
işlemde sayılır; yeniden başlatmada sıfırlanmaz.

### GET /api/v1/sessions

Konsoldaki Oturumlar listesi ve P8 Oturum geçmişi ekranı aynı ucu kullanır. Yetki: `sessions.view` **veya**
`session_history.view`. Yanıt `Cache-Control: no-store`.

Sorgu (`listSessionsQuerySchema`, strict: **bilinmeyen parametre 400**):

| Parametre      | Kural                                                      | Anlam                                                                                                                                   |
| -------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `status`       | `PENDING` · `ACTIVE` · `ENDED` · `EXPIRED` · `CANCELLED`   | Tek durum                                                                                                                               |
| `mode`         | `AGENT` · `BROWSER`                                        | İstemci / tarayıcı. Hiç bağlanılmamış oturum (`mode=null`) eşleşmez                                                                     |
| `from`, `to`   | `YYYY-AA-GG`, geçerli takvim günü                          | `createdAt` üzerinde **Europe/Istanbul günü**: `from` 00:00 dahil, `to` ertesi gün 00:00 hariç. `from > to` → 400 `fields.to`           |
| `technicianId` | ULID                                                       | ADMIN / Super Admin. USER'da yok sayılır                                                                                                |
| `tenantId`     | ULID                                                       | Yalnız firma seçmemiş Super Admin. Diğer rollerde yok sayılır                                                                           |
| `customer`     | 2–100 karakter, kırpılır; kontrol ve görünmez karakter yok | Müşteri adında geçen metin (büyük/küçük harf duyarsız). `%`, `_`, `\` harfiyen aranır. Adı kaydedilmemiş (P8 öncesi) oturumlar eşleşmez |
| `page`         | 1–10000, varsayılan 1                                      | Toplamı aşan sayfa boş `items` döner (hata değil)                                                                                       |
| `pageSize`     | 1–100, varsayılan 25                                       |                                                                                                                                         |
| `sort`         | `createdAt:desc` (varsayılan) · `createdAt:asc`            | İkincil sıra her zaman `id` (kararlı sayfalama)                                                                                         |

Kapsam (sunucuda uygulanır, filtre bunu genişletemez):

| Rol                             | Görür                                           |
| ------------------------------- | ----------------------------------------------- |
| USER                            | Kendi tenant'ında yalnız kendi oturumları       |
| ADMIN                           | Kendi tenant'ının tüm oturumları                |
| Super Admin, firma seçili       | Seçili firmanın oturumları                      |
| Super Admin, firma seçili değil | Tüm firmaların oturumları (`tenant` alanı dolu) |

**Hız sınırı:** `customer` doluyken kullanıcı başına dakikada 60 istek; aşılınca 429 `RATE_LIMITED` + `Retry-After`.
Filtresiz liste bu sınırdan etkilenmez.

```bash
curl -sk 'https://localhost:4450/api/v1/sessions?from=2026-11-01&to=2026-11-11&status=ENDED&mode=AGENT&customer=Y%C4%B1lmaz' \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF"
```

```json
{ "items": [ { "id": "01K…", "status": "ENDED", "code": null, "techVerifyCode": "<doğrulama-kodu>",
               "technician": { "id": "01K…", "name": "Ayşe Teknisyen" },
               "createdAt": "2026-11-10T07:00:00.000Z", "expiresAt": "2026-11-10T07:15:00.000Z",
               "endedAt": "2026-11-10T07:42:10.000Z", "endedBy": "TECH", "endReason": "tech",
               "mode": "AGENT", "startedAt": "2026-11-10T07:03:00.000Z", "durationSec": 2350,
               "customerName": "Ahmet Yılmaz", "ticketNo": "INC-1002", "tenant": null, "anonymized": false,
               "waitingGuests": 0 } ],
  "page": 1, "pageSize": 25, "total": 1 }
```

- `code` yalnız PENDING iken ve **yalnız oturumun kendi teknisyenine** döner; ADMIN ve Super Admin başka teknisyenin
  bekleyen oturumu için `null` görür (S8-2). `link` hiçbir listede/detayda dönmez.
- `startedAt` = müşterinin kabul edildiği an. `durationSec` yalnız `startedAt` ve `endedAt` doluysa hesaplanır;
  ACTIVE oturumda `null` (arayüz canlı süreyi kendisi hesaplar).
- `tenant` yalnız firma seçmemiş Super Admin'de dolu (`{ id, name }`), diğerlerinde `null`.
- Listede müşteri e-postası ve not **yoktur**; bunlar ayrıntı ucundadır.
- `anonymized` (P13a): oturum saklama süresi dolduğu için anonimleştirildiyse `true`; bu durumda `customerName` `null`
  döner (bkz. "Saklama ve anonimleştirme (P13a)").
- `waitingGuests` (P13b-L): satırın bekleme odasındaki müşteri sayısı, 0..3. Yalnız `PENDING` satırda dolu olabilir,
  diğer durumlarda 0. Değer sunucu belleğindeki lobiden gelir (DB'den ve audit'ten türetilmez); sunucu yeniden başlarsa 0'a
  iner. Kullanıcıda `sessions.view` yoksa (yalnız `session_history.view`) her satırda 0 döner. Alan yalnız sayıdır; misafir
  adı, e-postası veya IP'si yoktur. Aynı alan `GET /api/v1/customers/:id/sessions` öğelerinde de vardır.
  `GET /sessions/:id/history` ve PATCH yanıtı (`SessionHistoryDetail`) bu alanı taşımaz.

Hatalar: 400 `VALIDATION` (`fields` ile), 401, 403, 429 `RATE_LIMITED`.

### GET /api/v1/sessions/waiting

P13b-L (ADR-0029). Panel kabuğu bu ucu 10 sn'de bir yoklar; "Oturumlar" menü sayacı, toast ve sekme başlığı buradan
beslenir. Girdi yok; sorgu dizesi yok sayılır. Yetki: oturum çerezi + `sessions.view` (`support_requests.view` gerekmez).
Firma bağlamı zorunludur. Yanıt `Cache-Control: no-store`. Audit yazılmaz (salt okuma).

Kapsam: rol ne olursa olsun (USER, ADMIN, firma seçmiş Super Admin) **yalnız kendi oturumlarınız** sayılır
(`tenant_id` = seçili firma, `technician_id` = siz). Tenant ve teknisyen istemciden alınmaz, oturumdan türetilir.
Bekleyen misafir = bekleme odasında olan, henüz kabul edilmemiş, reddedilmemiş, ayrılmamış ve süresi dolmamış misafir.
Talepten doğan, ön-kabullü misafir sayılmaz.

```bash
curl -sk https://localhost:4450/api/v1/sessions/waiting \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF"
```

Yanıt 200 (`waitingSessionsResponseSchema`, strict):

```json
{ "count": 2, "sessions": [ { "id": "01K…", "waiting": 2, "arrivals": 3 } ] }
```

| Alan                  | Anlam                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `count`               | Bekleyen misafirlerin toplamı (Σ `waiting`)                                                                                              |
| `sessions[].id`       | Kendi oturumunuzun ULID'i ("Konsolu aç" hedefi)                                                                                          |
| `sessions[].waiting`  | O oturumda bekleyen misafir sayısı, 1..3. Bekleyeni olmayan oturum listede yer almaz                                                     |
| `sessions[].arrivals` | O odaya bugüne kadar kaç misafirin bekleme odasına girdiği (yalnız artar). İstemci yeni geleni bununla anlar ve toast'ı bir kez gösterir |

`sessions` `id`'ye göre sıralıdır. Kimse beklemiyorsa `{ "count": 0, "sessions": [] }` döner.

Hatalar: 401 `UNAUTHENTICATED`; 403 `FORBIDDEN` (`sessions.view` yok veya Super Admin firma seçmedi: "Önce bir firma
seçin."); 429 `RATE_LIMITED` + `Retry-After` (kullanıcı başına dakikada 60 istek serbest, 61. istekte 60 sn kilit).

### GET /api/v1/sessions/:id

Yanıt: konsol özeti (`SessionView`, P2 şekli; P8 alanları yok). Kapsam listeyle aynıdır; `code` kuralı aynıdır.
Hatalar: 401, 403, 404 (yok, kapsam dışı, biçimsiz id).

### POST /api/v1/sessions/:id/cancel

Girdi yok. Gerekli: oturum, `X-CSRF-Token`, `Origin`, `sessions.delete`.

```bash
curl -sk -X POST https://localhost:4450/api/v1/sessions/$ID/cancel \
  -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF"
```

Yanıt 200: `{ "status": "CANCELLED" }`. Müşteri sayfası en geç birkaç saniye içinde "Oturum iptal edildi" gösterir.
Hatalar: 401, 403, 404, 409 `CONFLICT` (oturum PENDING değil veya süresi dolmuş; o oturum 30 sn içinde otomatik EXPIRED yapılır).

### POST /api/v1/sessions/:id/terminate (P3)

Aktif (ACTIVE) bir oturumu yönetici olarak zorla bitirir. Gerekli: oturum, `X-CSRF-Token`, `Origin`,
`sessions.terminate` (ADMIN varsayılan açık, USER kapalı). ADMIN kendi tenant'ındaki her oturumu sonlandırabilir.
Girdi: `{ "reason"?: string(≤200) }` (gövdesiz de kabul edilir).

```bash
curl -sk -X POST https://localhost:4450/api/v1/sessions/$ID/terminate \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF" -d '{"reason":"<isteğe bağlı açıklama>"}'
```

Yanıt 200: `{ "status": "ENDED", "endedBy": "ADMIN" }`. Odadaki iki tarafa `session.ended{reason:"admin"}` gider;
DB'de `ended_by=ADMIN`, `terminated_by=<yönetici>`; audit `session.terminated`.
Hatalar: 401, 403 (`FORBIDDEN`, `CSRF_INVALID`), 404 (yok / başka tenant), 409 `CONFLICT` (oturum ACTIVE değil).

## Oturum geçmişi (P8)

Ekranlar `/history` ve `/history/<id>`. Kapsam ve 404 kuralı "GET /api/v1/sessions" ile aynıdır: kapsam dışı ya da
olmayan id her uçta **404** döner, kaydın varlığı sızdırılmaz. Sözleşme kaynağı: `docs/mimari-api.md`
"Oturum geçmişi (P8)" §1–6. Türkçe etiketler: `@remote/contracts/labels` (ekran ve CSV aynı eşlemeyi kullanır;
bilinmeyen `endReason` veya `action` ham gösterilir).

### GET /api/v1/sessions/:id/history

Yetki: `session_history.view`. Yanıt `SessionHistoryDetail`, `Cache-Control: no-store`.

```bash
curl -sk https://localhost:4450/api/v1/sessions/$ID/history -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF"
```

Yanıt = liste öğesinin tüm alanları + şunlar:

| Alan                | Açıklama                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customerEmail`     | Müşterinin katılırken yazdığı e-posta (yoksa `null`)                                                                                                                                                                                                                                                                                                           |
| `note`              | Teknisyen notu (`null` olabilir)                                                                                                                                                                                                                                                                                                                               |
| `terminatedBy`      | Yalnız `endedBy=ADMIN` ise `{ id, name }` (sonlandıran yönetici)                                                                                                                                                                                                                                                                                               |
| `quality`           | Kalite özeti `{ fps, kbps, rttMs, connType }`; kayıt yoksa veya okunamıyorsa `null`                                                                                                                                                                                                                                                                            |
| `files[]`           | `{ id, direction: TO_CUSTOMER\|TO_TECH, fileName, sizeBytes, sha256, result: OK\|REJECTED\|CANCELLED\|CORRUPT, createdAt, reportedBy: TECH\|CUSTOMER, verified }`, en çok 500. İçerik yoktur. P15: aynı aktarımın iki raporu tek satıra indirgenir; `verified` = teknisyen raporu var ("Doğrulanmış"), `false` = yalnız müşteri bildirdi ("Müşteri bildirimi") |
| `consents[]`        | `{ id, at, level: VIEW\|CONTROL, decision: GRANTED\|DENIED\|REVOKED, source: UI\|HOTKEY\|RECONNECT\|SYSTEM\|TECH, consentText: { id, version, sha256 } \| null }`, en çok 500. **IP ve tarayıcı bilgisi dönmez** (kanıt DB'de kalır)                                                                                                                           |
| `controlPeriods[]`  | `{ grantedAt, revokedAt, revokedSource, revokedReason, selfElevated }`. Sunucu her `GRANTED`'ı ardından gelen ilk `REVOKED` ile eşleştirir. Kapanış kaydı yoksa `revokedAt`/`revokedSource` `null`; bitiş tahmin edilmez. BROWSER oturumda boş dizi                                                                                                            |
| `timeline[]`        | `{ at, action, actor: TECH\|CUSTOMER\|ADMIN\|SYSTEM, actorName, result: success\|fail, details }`, en çok 500 olay                                                                                                                                                                                                                                             |
| `timelineTruncated` | 500 olay sınırı aşıldıysa `true`                                                                                                                                                                                                                                                                                                                               |

Zaman çizelgesine yalnız şu eylemler girer: `session.created`, `guest.pending`, `guest.rejected`, `guest.admitted`,
`guest.admit` (başarısız), `reconnect.conflict`, `control.requested/granted/denied/revoked/released/cancelled`,
`monitor.requested/granted/denied`, `session.caps_changed`, `session.cancelled/expired/terminated/ended`. `details`
ham audit değeri değildir; eylem başına izinli alanların izdüşümüdür (ör. `control.granted` → `selfElevated`,
`control.revoked` → `source`, `reason`, `side`). IP, tarayıcı ve maskeli değer hiç dönmez; metinler 200 karakterle
kesilir. Dosya olayları `files`'ta, diğer operasyon olayları P11 audit ekranında görünür.

```json
{ "id": "01K…", "status": "ENDED", "mode": "AGENT", "customerName": "Ahmet Yılmaz",
  "customerEmail": "ahmet@example.com", "ticketNo": "INC-1002", "note": "Yazıcı sürücüsü yeniden kuruldu.",
  "terminatedBy": null, "quality": { "fps": { "avg": 24, "min": 15, "max": 30 }, "kbps": { "avg": 2100, "min": 900, "max": 3500 },
  "rttMs": { "avg": 38, "min": 20, "max": 90 }, "connType": "relay" },
  "consents": [ { "id": "01K…", "at": "2026-11-10T07:03:00.000Z", "level": "VIEW", "decision": "GRANTED",
                  "source": "UI", "consentText": { "id": "01K…", "version": 1, "sha256": "<64 hex>" } } ],
  "controlPeriods": [ { "grantedAt": "2026-11-10T07:10:00.000Z", "revokedAt": "2026-11-10T07:25:00.000Z",
                        "revokedSource": "HOTKEY", "revokedReason": null, "selfElevated": false } ],
  "timeline": [ { "at": "2026-11-10T07:09:55.000Z", "action": "control.requested", "actor": "TECH",
                  "actorName": "Ayşe Teknisyen", "result": "success", "details": { "request": 1 } } ],
  "timelineTruncated": false, "files": [] }
```

(Örnek kısaltılmıştır; liste öğesinin diğer alanları da döner.)
**Anonim oturum (P13a, `anonymized: true`):** `customerName`, `customerEmail`, `note` ve talep bilgilerindeki kişisel alanlar
`null`, `files` boş dizidir. Zaman çizelgesinde müşteri adı yoktur (`details.name` silinir, CUSTOMER `actorName` `null`) ve
`session.terminated` olayının serbest metin `reason`'ı silinir. `ticketNo`, süreler, mod, kalite özeti ve onay kayıtlarının
karar/seviye/kaynak/metin sürümü korunur.
Hatalar: 401, 403, 404.

### PATCH /api/v1/sessions/:id

Ticket numarası ve not yazar. Yetki: `session_history.edit`; gerekli: `Origin` + `X-CSRF-Token`. Girdi
(`updateSessionInputSchema`, strict, **en az bir alan**):

| Alan       | Kural                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ticketNo` | `string \| null`; kırpılır; en çok 50 karakter; kontrol, satır sonu ve görünmez karakter yok                                            |
| `note`     | `string \| null`; en çok 4.000 karakter; `\n` ve `\t` serbest, CRLF → LF çevrilir; tek `\r` ve diğer kontrol/görünmez karakterler yasak |

`""` ve `null` alanı temizler (DB'de NULL). Gönderilmeyen alan değişmez. Oturum durumu fark etmez (bitmiş oturum da
düzenlenir); eşzamanlı yazımda son yazan kazanır.

```bash
curl -sk -X PATCH https://localhost:4450/api/v1/sessions/$ID \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF" \
  -d '{"ticketNo":"INC-1002","note":"Yazıcı sürücüsü yeniden kuruldu."}'
```

Yanıt 200: güncel `SessionHistoryDetail`. Audit `session.updated`: `oldValue/newValue = { ticketNo, noteLength }`;
**not metni audit'e yazılmaz** (audit 730 gün saklanır).
P13a: anonimleştirilmiş oturumda (eşzamanlı anonimleşme dahil) yazım yapılmaz, **409 `SESSION_ANONYMIZED`** döner:

```json
{ "error": { "code": "SESSION_ANONYMIZED", "message": "Bu oturum saklama süresi dolduğu için anonimleştirildi; düzenlenemez.", "requestId": "01K…" } }
```

Ticket no saklama süresinden sonra da korunduğu için içine kişisel veri (ad, telefon, e-posta) yazılmamalıdır.
Hatalar: 400 `VALIDATION` (`fields.ticketNo`, `fields.note`; alan yoksa `fields._`), 401, 403 (`FORBIDDEN`,
`CSRF_INVALID`), 404, 409 `SESSION_ANONYMIZED`.

### GET /api/v1/sessions/export.csv

Listenin filtrelerini alır (`status`, `mode`, `from`, `to`, `technicianId`, `tenantId`, `customer`, `sort`; `page` ve
`pageSize` yok sayılır). Yetki: `session_history.export`. Kapsam listeyle aynıdır; kapsam dışı satır dosyaya girmez.

```bash
curl -sk -OJ 'https://localhost:4450/api/v1/sessions/export.csv?from=2026-11-01&to=2026-11-30' \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF"
```

`-OJ` dosyayı sunucunun verdiği adla (`oturumlar-YYYYMMDD-HHmm.csv`) kaydeder.

Yanıt başlıkları: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="oturumlar-…csv"`,
`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.

Dosya biçimi:

- UTF-8 **BOM** (`EF BB BF`), ayraç **`;`** (tr-TR Excel liste ayracı), satır sonu CRLF. Excel çift tıklamayla sütunlara açar.
- Sütunlar (sabit sıra, `SESSION_CSV_COLUMNS`): `Oturum No; [Firma]; Oluşturma; Başlangıç; Bitiş; Süre; Durum; Mod;
Kaynak; Müşteri firma; Bekleme; Teknisyen; Müşteri; Ticket No; Sonlandıran; Bitiş nedeni; Not; Dosyalar`. `Firma` yalnız
  firma seçmemiş Super Admin'de 2. sütundur.
- **Dosyalar (P15, AC-238):** `"N doğrulanmış; M müşteri bildirimi"` (sıfır olan kısım yazılmaz, ör. `2 doğrulanmış`).
  Dosya yoksa ve anonimleştirilmiş oturumda boş.
- Zamanlar **Europe/Istanbul** `YYYY-AA-GG SS:dd:ss`; süre `SS:DD:ss` (yoksa boş). Durum, mod, sonlandıran ve bitiş
  nedeni Türkçe etiketle yazılır (ör. `Bitti`, `İstemci`, `Teknisyen`, `Müşteri bitirdi`).
- E-posta, onay kayıtları ve zaman çizelgesi CSV'ye girmez.
- P13a: sütun kümesi değişmez. Anonimleştirilmiş oturumun satırında **Müşteri** hücresi `Anonimleştirildi`, **Not** boştur.
- **Formül kaçışı (AC-124, S8-1):** `=`, `+`, `-`, `@`, TAB veya CR ile başlayan hücreye (başlık dahil) `'` eklenir.
  Baştaki boşluk/NBSP/ideografik boşluktan sonra gelen tetikleyiciler ve tam genişlikli `＝ ＋ － ＠` de yakalanır.
  Ardından RFC 4180 tırnaklama: `;`, `"`, CR veya LF içeren hücre `"…"` içine alınır, `"` iki kez yazılır.
  Örnek: `=HYPERLINK("x";"y")` → `"'=HYPERLINK(""x"";""y"")"`.

Sıra: hız sınırı → sayım → audit → akış.

- **Hız sınırı:** kullanıcı başına dakikada 5 dışa aktarma; 6. istek 429 `RATE_LIMITED` + `Retry-After`.
- **50.000 satır sınırı:** sonuç daha fazlaysa dosya üretilmez, 400 `VALIDATION`,
  `fields.to = "En çok 50.000 satır dışa aktarılabilir; tarih aralığını daraltın"`.
- **Audit `session.exported`** (entity `support_sessions`): `newValue = { status, mode, from, to, technicianId, tenantId,
customerFilter: true|false, rows }`. Müşteri arama metni yazılmaz.
- Satırlar 1000'lik partilerle akar. Akış başladıktan sonra hata olursa bağlantı kesilir, log'a `ref` yazılır; istemci
  indirme hatası görür.

Hatalar: 400 `VALIDATION`, 401, 403, 429 `RATE_LIMITED`.

## Public müşteri uçları

Çerez ve kimlik istemez. Müşteri sayfası (`/session/<token>`) resolve'u **sunucu tarafında** (web konteyneri)
yapar; müşterinin IP'si server'a yalnız Caddy → web paylaşılan sırrı (`EDGE_PROXY_SECRET`) doğrulanınca iletilir.

### POST /api/v1/public/sessions/resolve

Girdi (biri): `{ "token": "<43-karakter-token>", "clientKind": "BROWSER" }` veya
`{ "code": "<8-hane>", "clientKind": "BROWSER" }`. `clientKind`: `BROWSER` (Origin zorunlu) | `AGENT` (Origin'siz,
ADR-0012). `X-CSRF-Token` gerekmez. Resolve oturumu **tüketmez**.

P28f: iki biçime de isteğe bağlı `"clientOs": "windows"|"macos"|"linux"` eklenebilir. `AGENT`'ta alan yoksa sunucu
`windows` sayar (eski istemciler); `BROWSER`'da yok sayılır; başka değer 400 `VALIDATION`. Değer `joinNonce` kaydına yazılır,
join'de yeniden sorulmaz; yanıt şeması değişmez. Ayrıntı: "macOS istemci (P28f)".

```bash
curl -sk -X POST https://localhost:4450/api/v1/public/sessions/resolve \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' \
  -d '{"code":"<8-hane>","clientKind":"BROWSER"}'
```

Yanıt 200 (`Cache-Control: no-store`):

```json
{ "sessionRef": "<69-karakter-opak-ref>", "tenant": { "name": "Demo Firma", "logoUrl": null },
  "technician": { "name": "Ayşe Teknisyen", "avatarUrl": null }, "techVerifyCode": "<doğrulama-kodu>",
  "expiresAt": "2026-11-11T10:15:00.000Z", "joinNonce": "<43-karakter>", "nonceExpiresAt": "2026-11-11T10:01:00.000Z",
  "consentText": { "id": "01K…", "version": 1, "body": "<aydınlatma metni, düz metin>", "sha256": "<64-hane-hex>" },
  "abuseEmail": "abuse@example.com" }
```

- `sessionRef`: HMAC (`SESSION_REF_KEY`) + oturum id; tahmin edilemez, token değildir, yalnız durum yoklamasında
  kullanılır.
- `tenant.logoUrl` (P12): firma logosu → sistem logosu → `/img/logo.png`; kod artık her zaman dolu döner (tip `string | null`).
- `technician.avatarUrl` (P15, AC-236): teknisyenin profil resmi varsa oturuma bağlı, 10 dakika geçerli imzalı adres
  (`/api/v1/public/sessions/<sessionId>/tech-avatar?exp=&sig=`); yoksa `null` ve müşteri ekranı baş harf rozeti gösterir.
  Ayrıntı: "G3 küçük özellikler (P15)".
- `consentText` (P4): tenant'ın güncel (`is_current`) KVKK aydınlatma metni. `body` düz metindir (HTML değil);
  istemci metin olarak basar. `sha256` gövdenin UTF-8 SHA-256 özetidir. `id` join'de `consentTextId` olarak geri
  gönderilir.
- `abuseEmail` (P4): "Kötüye kullanımı bildir" `mailto:` adresi, `string | null`. Kaynak `ABUSE_EMAIL`. Production'da
  `ABUSE_EMAIL` yoksa `null` döner ve arayüz bağlantıyı gizler. Super Admin e-postasına düşme yalnız production dışı
  ortamdadır.
- `joinNonce` (P3): tek kullanımlık, 60 sn geçerli, istek türüne (`clientKind`) bağlı; `join`'e verilir.
- `techVerifyCode` müşterinin teknisyeni teyit etmesi içindir; müşteriyi doğrulamaz.

Hatalar: 400 `VALIDATION`; 403 `CSRF_INVALID` (Origin/istemci türü uyumsuz); 404 `NOT_FOUND` (link/kod yok);
410 `SESSION_EXPIRED` / `SESSION_CONSUMED` / `SESSION_CANCELLED`; 429 `RATE_LIMITED` (`Retry-After`);
500 `INTERNAL` (tenant'ın güncel KVKK metni yok — seed eksik; müşteriye ayrıntı verilmez, `pnpm db:seed` ekler).

Hız sınırları (bellekte, süreç başına):

| Yol                   | Sınır                                                       | Aşımda                       |
| --------------------- | ----------------------------------------------------------- | ---------------------------- |
| Kod, başarısız deneme | IP başına 10/dk ve /24 (IPv6: /56) önek başına 30/dk        | Yalnız o IP / önek 15 dk 429 |
| Token                 | IP başına 30/dk                                             | 429                          |
| Kod, toplam başarısız | 60 sn'de 100'ü aşınca `warn` log (`alarm:"resolve_failed"`) | Engellemez; yalnız alarm     |

Aynı oturum + neden için 410 audit kaydı 10 dakikada bir kez yazılır. Süresi dolmuş PENDING oturum aynı istekte
EXPIRED yapılır.

### GET /api/v1/public/sessions/status?ref=<sessionRef>

Karşılama sayfası 2 sn'de bir çağırır. Yanıt 200: `{ "status": "PENDING" }` (durumlardan biri). Biçimsiz veya
sahte `ref` → 404. Sınır: IP başına 60/dk → 429 (`Retry-After`). Caddy logu bu yolun sorgu dizesini yazmaz.

```bash
curl -sk "https://localhost:4450/api/v1/public/sessions/status?ref=$REF"
```

### POST /api/v1/public/sessions/join (P3)

Müşteriyi teknisyenin **bekleme odasına (lobi)** alır; oturumu tüketmez. Oturum, teknisyen müşterinin okuduğu
4 haneli kodu girince (`guest.admit`) ACTIVE olur. İstemci türü `joinNonce` kaydından gelir (gövdede `clientKind`
yok): `BROWSER` ise `Origin` zorunlu, `AGENT` ise `Origin` olmamalı.

Girdi (ekstra alan reddedilir):

| Alan              | Kural                                                                                                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `joinNonce`       | Resolve yanıtındaki değer (43 karakter, tek kullanımlık, 60 sn)                                                                                                                                                                                                                         |
| `customerName`    | 2–100 karakter (baş/son boşluk kırpılır). Kontrol (Unicode `Cc`), biçim/görünmez/yön (`Cf`: sıfır genişlik, bidi, BOM, soft hyphen, etiket karakterleri), satır/paragraf ayırıcı (`Zl`/`Zp`), U+034F ve U+180E içeremez; kontrol kırpmadan **önce** yapılır. ZWJ'li emoji kabul edilmez |
| `customerEmail`   | İsteğe bağlı e-posta, ≤ 190                                                                                                                                                                                                                                                             |
| `consentTextId`   | **Zorunlu** (P4). Resolve yanıtındaki `consentText.id` (ULID, 26 karakter). Oturumun tenant'ının güncel sürümü olmalı                                                                                                                                                                   |
| `consentAccepted` | `true` olmalı                                                                                                                                                                                                                                                                           |

```bash
curl -sk -X POST https://localhost:4450/api/v1/public/sessions/join \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' \
  -d '{"joinNonce":"<resolve-yanıtındaki-nonce>","customerName":"<ad soyad>","consentTextId":"<consentText.id>","consentAccepted":true}'
```

Yanıt 200 (`Cache-Control: no-store`):

```json
{ "wsTicket": "<43-karakter>", "admitCode": "<4-hane>", "technicianName": "Ayşe Teknisyen" }
```

- `wsTicket`: `/ws/guest` bağlantısı için, 60 sn, tek kullanımlık. `iceServers` ve `reconnectToken` burada **yoktur**;
  yalnız kabul (admit) sonrası `hello` mesajında gelir.
- `admitCode`: yalnız bu misafire gösterilir; müşteri telefonda teknisyene okur.
- Audit `guest.pending` (misafir kimliği, ad, istemci türü, KVKK metin kimliği ve sürümü, P28f'ten itibaren `os`; kod
  yazılmaz).
- Onay kaydı join'de değil, teknisyen kabul ettiğinde (`guest.admit`) oturum tüketimiyle aynı işlemde yazılır
  (`session_consents`: metin kimliği + SHA-256, join anındaki zaman, IP, User-Agent). İstemcinin ek çağrısı yoktur.

Hatalar: 400 `VALIDATION`; 403 `CSRF_INVALID` (Origin/istemci türü uyumsuz) veya `FORBIDDEN` (teknisyen bu IP'yi
reddetti); 409 `LOBBY_FULL` (lobide 3 misafir var); 410 `NONCE_INVALID` veya `SESSION_EXPIRED` / `SESSION_CONSUMED` /
`SESSION_CANCELLED` (410 oturum nedenleri audit'e `session.join` `result=fail` olarak yazılır); 429 `RATE_LIMITED`
(IP başına 20/dk, `Retry-After`).

400 alan hataları (P4):

| `fields` anahtarı | Mesaj                                                               | Ne zaman                                                                 |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `consentTextId`   | "Aydınlatma metni güncellendi; sayfayı yenileyip tekrar onaylayın." | Eski sürüm, başka tenant'ın metni veya bilinmeyen id (üçü ayırt edilmez) |
| `consentTextId`   | "Aydınlatma metni geçersiz" (alan hiç yoksa genel şema mesajı)      | ULID biçiminde değil veya alan yok                                       |
| `customerName`    | "Ad görünmez veya kontrol karakteri içeremez"                       | Yasak karakter                                                           |
| `customerName`    | "Ad en az 2 karakter olmalı"                                        | Kırpma sonrası 2 karakterden kısa                                        |
| `consentAccepted` | "Aydınlatma metni onaylanmalı"                                      | `true` değil                                                             |

```json
{ "error": { "code": "VALIDATION", "message": "Gönderilen bilgiler geçersiz.",
             "fields": { "consentTextId": "Aydınlatma metni güncellendi; sayfayı yenileyip tekrar onaylayın." },
             "requestId": "01K…" } }
```

`consentTextId` hatası `joinNonce`'u yakar (nonce tek kullanımlıktır). İstemci yeniden resolve edip güncel metni
göstermeli ve onayı yeniden almalıdır.

### GET /api/v1/public/agent/download?ref=<sessionRef>[&os=windows|macos|linux] (P6, P28f, P28g)

Müşteri karşılama sayfasındaki "Hızlı Destek uygulamasını indir" bağlantısıdır. Çerez, kimlik ve `Origin` istemez
(GET, durum değiştirmez). `ref` resolve yanıtındaki `sessionRef`'tir. Oturumu tüketmez. **Her yanıtta (hatalar dahil)
`Cache-Control: no-store`** bulunur.

```bash
curl -sk -i "https://localhost:4450/api/v1/public/agent/download?ref=$REF"
```

Yanıt **302** (gövdesiz):

```
HTTP/2 302
location: /downloads/Destek-48291376.exe
cache-control: no-store
```

- P28f: `os` yoksa `windows`. `os=macos` → `location: /downloads/Destek-<kod>.zip` ve yalnız macOS bütünlük kapısı
  uygulanır; P28g: `os=linux` → `location: /downloads/Destek-<kod>` (**uzantısız**), yalnız Linux kapısı. Geçersiz `os` →
  400 `VALIDATION` ("Geçersiz işletim sistemi."), ref kovası tüketilmez (yalnız IP başına 20/dk).
- Hedef yol 8 haneli oturum kodunu taşır; Windows istemcisi kodu dosya adından okur. Tarayıcılar 3xx yanıtındaki
  `Content-Disposition`'ı yok saydığı için dosya adı son yanıttan gelir; 302'de bu başlık yoktur.
- Yalnız oturum **PENDING ve süresi dolmamışsa** 302 döner. Süresi dolmuş PENDING aynı istekte EXPIRED yapılır
  (audit `session.expired`).
- Başarılı indirme audit'e yazılmaz. `ref` ve kod hiçbir log/audit satırına yazılmaz (logger `*.ref` redaksiyonu, Caddy
  log filtresi).

| HTTP | Kod                                                          | Ne zaman                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 302  | —                                                            | Oturum PENDING ve süresi dolmamış, ikili hazır                                                                                                                                                                              |
| 404  | `NOT_FOUND`                                                  | `ref` eksik, biçimsiz, HMAC'i tutmuyor veya oturum yok                                                                                                                                                                      |
| 410  | `SESSION_EXPIRED` / `SESSION_CONSUMED` / `SESSION_CANCELLED` | Oturum süresi dolmuş, kabul edilmiş (ACTIVE/ENDED) veya iptal                                                                                                                                                               |
| 429  | `RATE_LIMITED`                                               | Hız sınırı veya başarısız deneme kilidi; `Retry-After` (saniye)                                                                                                                                                             |
| 400  | `VALIDATION`                                                 | `os` `windows`, `macos` ya da `linux` değil (P28f, P28g)                                                                                                                                                                    |
| 503  | `NOT_READY`                                                  | İkili yapılandırılmamış (`AGENT_SHA256`/`AGENT_BINARY_PATH` boş), dosya yok veya SHA-256 uyuşmuyor (fail-closed). Mesaj: "İndirme şu anda kullanılamıyor. Biraz sonra tekrar deneyin ya da tarayıcıdan paylaşımı kullanın." |

Hız sınırları (resolve kod yoluyla **ortak** kovalar):

| Sınır                                                                                  | Aşımda                                                                      |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Tüm istekler: IP başına 20/dk                                                          | 429 (`Retry-After` ≤ 60 sn)                                                 |
| 404 ve 410 başarısız deneme sayılır: IP başına 10/dk, /24 (IPv6 /56) önek başına 30/dk | O IP / önek 15 dk 429; kilit geçerli `ref`'i ve resolve kod yolunu da keser |

Web arayüzü bağlantıya gitmeden önce aynı adresi `redirect: "manual"` ile yoklar; başarılı bir indirme IP kovasından
2 hak kullanır. 503'te "Tarayıcıdan devam et", 429'da bekleme süresi, 410'da bitiş ekranı gösterir.

### GET /downloads/NoktaDestek.exe ve /downloads/Destek-<8 hane>.exe (P6, Caddy)

Server'a değil Caddy'ye ait statik yoldur (`deploy/Caddyfile` `@agentExe`). İki ad da volume'daki **aynı jenerik
ikiliyi** sunar (`agent_downloads` → `/srv/downloads/NoktaDestek.exe`); yol kodu doğrulamaz, her 8 hane aynı dosyayı
verir. Başlıklar: `Content-Disposition: attachment; filename="<istenen ad>.exe"`, `Content-Type: application/octet-stream`,
`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Başka her `/downloads/*` yolu 404.

**Bütünlük kapısı (`forward_auth`, S6-2):** Caddy dosyayı sunmadan **önce** server'ın iç ucuna
(`GET /internal/agent-ready`) sorar. Server 204 dönerse dosya sunulur; 503 `NOT_READY` dönerse bu JSON hata zarfı
olduğu gibi istemciye gider (`.exe` adı ve `Content-Disposition` olmadan). Server erişilemezse Caddy 502 döner; her iki
durumda da dosya sunulmaz (fail-closed). Server'a giden `X-Forwarded-Uri` `/downloads/***` olarak maskelenir; erişim ve
hata loglarında yol `/downloads/Destek-***` yazılır. Günlük dış gözcü (`agent-watch.yml`) kodsuz
`/downloads/NoktaDestek.exe`'yi çekip hash'ini Release `SHA256SUMS` ile karşılaştırır.

```bash
curl -sk -o /dev/null -D - https://localhost:4450/downloads/NoktaDestek.exe
```

### GET /health ve GET /ready

`/api` dışındadır; Caddy dışarıya **404** döner. Konteyner içinden veya Docker healthcheck ile çağrılır.

- `/health` → 200 `{ "status": "ok" }` (süreç canlı).
- `/ready` → 200 `{ "status": "ready", "migration": "20261111040000_p5_session_files" }` (son uygulanan migration); DB yoksa veya migration
  uygulanmamışsa 503 `NOT_READY`.

```bash
cd deploy && docker compose exec server node -e "fetch('http://127.0.0.1:3001/ready').then(async r=>console.log(r.status, await r.text()))"
```

### GET /metrics (P3)

Prometheus metin biçimi. `/api` dışındadır; Caddy dışarıya **404** döner, yalnız iç ağdan çağrılır.
`METRICS_TOKEN` tanımlı değilse 404; `Authorization: Bearer <METRICS_TOKEN>` yoksa veya yanlışsa 401.

```bash
cd deploy && docker compose exec server node -e "fetch('http://127.0.0.1:3001/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(async r=>console.log(r.status, await r.text()))"
```

Seriler (etiketlerde IP, oturum kimliği veya kod yok): sayaçlar `rs_ws_connections_total{role}`,
`rs_ws_rejected_total{role,reason}`, `rs_ws_closed_policy_total{reason}`, `rs_admit_total{result}`,
`rs_sessions_ended_total{reason}`, P5: `rs_file_meta_total{result}` (`recorded`, `sender_reported`, `forbidden`,
`too_large`, `rate_limited`, `rejected_by_db`, `error`) ve `rs_file_meta_rate_limited_total{class}` (`accepted`,
`declined`, `sender`), P7: `rs_control_total{event}` (olay değerleri aşağıda "Uzaktan kontrol" bölümünde); göstergeler `rs_ws_connections`, `rs_active_sessions`, `rs_active_rooms`,
`rs_resolve_failed`. Alarm eşikleri: `docs/runbook.md` §9.8 (P5: `rate(rs_file_meta_rate_limited_total{class="sender"}[5m]) > 0`
uyarı — olası audit şişirme veya değiştirilmiş istemci).

### GET /internal/agent-ready[/windows|/macos|/macos-firm|/linux] (P6, P28f, P31, P28g; iç uç — dışarıya kapalı)

Yalnız Caddy `forward_auth` içindir; dışarıdan erişilemez. İki katmanda kapalıdır:

1. Caddy `/internal` ve `/internal/*` yollarını dışarıya **404** döner (`@ops`); yalnız `/api/*` ve `/ws/*` server'a gider.
2. Server isteği yalnız soket adresi `TRUSTED_PROXY_CIDR` içinde olan (tanımsızsa yalnız loopback) **ve**
   `X-Forwarded-Method` başlığı taşıyan GET için yanıtlar; aksi halde **404** (uç varlığı açığa çıkmaz).
   `X-Forwarded-For` değil soket adresi esas alınır; XFF ile taklit edilemez.

Yanıt: **204** ikili hazır; **503** `NOT_READY` (indirme ucuyla aynı kapı, `assertAgentReady`). `Cache-Control: no-store`.
Bu uç `/api` altında değildir: `/api/*` dışarıya açık olduğu için bilinçli olarak dışarıda tutuldu.

`/macos-firm` (P31) yalnız firma zip'i (`NoktaDestek-<firma>-<ref>.zip`) içindir ve `X-Forwarded-Uri`'deki tam yolu okur;
eksik, maskeli ya da desen dışı yol 404'tür (fail-closed). Ayrıntı: "macOS'ta Destek iste (P31)".

## WebSocket sinyalizasyonu (P3)

Sözleşme tek kaynaktan gelir: `packages/contracts/src/ws.ts` (zod, ekstra alan reddedilir); örnek mesajlar
`packages/contracts/fixtures/ws-messages.json`. Tasarım: `docs/mimari-protokol.md`. Görüntü WS'den geçmez;
WS yalnız SDP/ICE ve oturum olaylarını taşır.

### Bağlantı

|                               | Teknisyen                                                                                                                                 | Müşteri (tarayıcı veya Windows istemcisi)                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| URL                           | `wss://<host>:4450/ws/tech?sessionId=<id>`                                                                                                | `wss://<host>:4450/ws/guest` (**sorgu dizesi olmaz**)                                                                                                                          |
| Kimlik                        | `__Host-rs_session` çerezi + izinli `Origin`; yalnız oturumu açan teknisyen (ADMIN dahil başkası değil)                                   | `Sec-WebSocket-Protocol: rs.v1, rs.ticket.<wsTicket>`; yeniden bağlanmada `rs.v1, rs.reconnect.<reconnectToken>`                                                               |
| Sunucunun seçtiği subprotocol | —                                                                                                                                         | `rs.v1`                                                                                                                                                                        |
| Upgrade reddi                 | HTTP 403 (Origin, çerez, şifre değişimi bekleyen kullanıcı, sahip olmayan teknisyen, kapalı oturum); 429 (IP başına ~30/dk, aşımda 60 sn) | HTTP 403 (sorgu dizesi var, `rs.v1` yok, ticket kullanılmış/bilinmiyor, istemci türü uyumsuz, misafir bağlıyken reconnect → audit `reconnect.conflict`); 429 (IP başına 30/dk) |

Bilinmeyen `/ws/*` yolu 404. Token'lar URL'ye konmaz; URL'de görünen ticket sızmış sayılır ve reddedilir.

```js
// Tarayıcı misafiri (join yanıtından sonra 60 sn içinde)
const ws = new WebSocket("wss://<host>:4450/ws/guest", ["rs.v1", "rs.ticket." + wsTicket]);
```

### Akış

1. Teknisyen bağlanır → `hello{role:"tech", iceServers: [], maxEndsAt: null}` (PENDING oturum).
2. Misafir ticket ile bağlanır → yalnız `lobby.wait{expiresAt}` alır (lobi 5 dk); teknisyene `peer.pending`.
   Lobideki misafir yalnız `session.end` gönderebilir; başka her mesaj 1008.
3. Teknisyen `guest.admit{admitCode}` gönderir. Kod doğruysa oturum tek atomik UPDATE ile ACTIVE olur; misafire
   `hello{role:"guest", iceServers, maxEndsAt, reconnectToken, caps?}`, teknisyene `peer.joined{role:"guest", guestKind}`
   ve `ice.servers`. Diğer lobi misafirleri `session.ended{rejected}` alır. Yanlış kod → `error{ADMIT_CODE_INVALID}`; 5. yanlış denemede lobi boşaltılır.
4. Teknisyen `sdp.offer` gönderir, misafir `sdp.answer` verir; iki taraf `ice` aday mesajları değiş tokuş eder.
5. TURN bilgisi (`iceServers`) bitmeden 5 dk önce `ice.servers` ile yenilenir. Bitime 5 dk kala `session.warning`.
6. Her yeniden bağlanan misafir yeni `reconnectToken` alır; eskisi geçersizleşir. Kopan misafir 120 sn içinde dönmezse oturum biter.

### Mesaj türleri

| `t`                                  | Yön                 | Alanlar                                                                                                                                                                                                       |
| ------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello`                              | S→iki taraf         | `role`, `sessionId`, `peerPresent`, `guestKind?`, `iceServers[]`, `maxEndsAt` (iso veya `null`), `caps?`, `reconnectToken?` (yalnız misafir), `guestName?` ve `share?` (P4), `maxFileMb?` (P5); aşağıya bakın |
| `lobby.wait`                         | S→misafir           | `expiresAt`                                                                                                                                                                                                   |
| `peer.pending` / `peer.pending.left` | S→teknisyen         | `guestId`, `name`, `guestKind`, `since` / `guestId`, `reason: left\|timeout\|rejected`                                                                                                                        |
| `guest.admit`                        | teknisyen→S         | `admitCode` (4 rakam)                                                                                                                                                                                         |
| `guest.reject`                       | teknisyen→S         | `guestId` (ret edilen IP bu oturuma tekrar join olamaz)                                                                                                                                                       |
| `ice.servers`                        | S→iki taraf         | `iceServers[]` (`urls[]`, `username?`, `credential?`)                                                                                                                                                         |
| `peer.joined` / `peer.left`          | S→karşı taraf       | `role`, `guestKind?`, `guestName?` (P4) ve `maxFileMb?` (P5) — ikisi de yalnız teknisyene giden `role:"guest"` mesajında / `role`, `reason?: disconnect\|ended`                                               |
| `sdp.offer`                          | teknisyen→S→misafir | `sdp` (≤ 60 000)                                                                                                                                                                                              |
| `sdp.answer`                         | misafir→S→teknisyen | `sdp`                                                                                                                                                                                                         |
| `ice`                                | iki yön             | `candidate` (≤ 2000), `sdpMid?`, `sdpMLineIndex?`                                                                                                                                                             |
| `ice.restart`                        | teknisyen→S→misafir | —                                                                                                                                                                                                             |
| `share.state`                        | misafir→S→teknisyen | `state: sharing\|stopped`, `monitors?`, `activeMonitor?`; P15: `reason?` (`^[A-Z0-9_]{1,32}$`), `method?: DXGI\|GDI\|WGC`; teknisyene oda başına en çok 1 sn'de bir (birleştirilir)                           |
| `file.meta`                          | iki taraf→S         | P5: `direction`, `fileName`, `sizeBytes`, `sha256`, `result`; P15: `fid?` (aşağıya bakın)                                                                                                                     |
| `quality.summary`                    | teknisyen→S         | P5: `fps`, `kbps`, `rttMs` (`{avg,min,max}`), `connType` (aşağıya bakın)                                                                                                                                      |
| `session.end`                        | iki taraf→S         | — (PENDING'de teknisyenden gelirse `error{CONFLICT}`; iptal REST ile yapılır)                                                                                                                                 |
| `session.ended`                      | S→taraf             | `reason`: `tech`, `customer`, `timeout`, `max_duration`, `cancelled`, `tenant_passive`, `server`, `admin`, `auth_revoked`, `rejected`, `lobby_timeout`                                                        |
| `session.warning`                    | S→iki taraf         | `kind: "max_duration_5min"`, `endsAt`                                                                                                                                                                         |
| `error`                              | S→taraf             | `code: ADMIT_CODE_INVALID\|CONFLICT\|FORBIDDEN\|RATE_LIMITED\|NOT_FOUND\|VALIDATION\|INTERNAL` (`VALIDATION` P5, `INTERNAL` P7), `message` (≤ 300)                                                            |
| P7 kontrol mesajları                 | —                   | `control.*`, `monitor.*`, `env.state`, `caps.update`: aşağıda "Uzaktan kontrol (P7)"                                                                                                                          |

İstemci mesajlarına isteğe bağlı `id` (≤ 26) eklenebilir. Sunucu mesajı karşı tarafa yeniden kurarak iletir.

**P4 ekleri (teknisyen konsolu yeniden bağlanması):**

- `hello.guestName` (≤ 100): yalnız `role:"tech"` hello'sunda ve ACTIVE oturumda; kabul edilen misafirin lobide
  verdiği ad. PENDING oturumda yoktur.
- `hello.share`: yalnız `role:"tech"` hello'sunda; misafirin son `share.state`'i
  `{ state, monitors?, activeMonitor?, reason?, method? }` (P15'ten beri `reason`/`method` da saklanır).
  Misafir hiç `share.state` göndermediyse yoktur; misafir koparsa `{ "state": "stopped" }` olur.
- `peer.joined{role:"guest"}.guestName`: kabul anında ve misafir yeniden bağlandığında teknisyene gider.
- Bu alanlar yalnız aynı odanın teknisyenine gönderilir; misafire veya başka odaya gitmez.

```json
{ "t": "hello", "role": "tech", "sessionId": "01K…", "peerPresent": true, "guestKind": "BROWSER",
  "iceServers": [], "maxEndsAt": "2026-11-11T14:00:00.000Z", "guestName": "<müşteri adı>",
  "share": { "state": "sharing" } }
```

**Medya (P4, tarayıcı modu):** teknisyen `recvonly` video offer'ı üretir; misafir answer'da `sendonly` olur ve
ekranı `getDisplayMedia` ile (yalnız kullanıcı tıklamasıyla, ses yok) bağlar. Paylaş / durdur / yeniden paylaş
yeniden anlaşma gerektirmez; durum `share.state` ile bildirilir. Misafir `peer.joined{role:"tech"}` aldığında
paylaşım sürüyorsa `share.state: sharing`'i yeniden gönderir.

### Sınırlar ve kapanış kodları

| Kod  | Ne zaman                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 1000 | Normal kapanış (oturum bitti)                                                                                 |
| 1008 | Politika: geçersiz JSON / şema hatası / ekstra alan, saniyede 50 mesaj aşımı, lobideki misafirden izinsiz tür |
| 1009 | Mesaj 64 KB'ı aştı                                                                                            |
| 4401 | Teknisyenin oturumu geçersizleşti (60 sn'de bir yeniden doğrulanır); önce `session.ended{auth_revoked}`       |
| 4409 | Aynı teknisyen aynı oturuma başka sekmeden bağlandı; eski soket kapanır                                       |
| 4426 | (P22) `/ws/tech` `rs.cap.schat1` bildirmedi — eski konsol sekmesi (`console_outdated`); "Sayfayı yenileyin"   |

Sunucu 30 sn'de bir ping atar; iki pong kaçıran soket sonlandırılır. Bekleyen oturumun süresi dolunca teknisyen ve
lobi `session.ended{timeout}` alır (30 sn'lik süre dolumu turu gecikmesiyle).

## İşbirliği: dosya kaydı, kalite özeti ve DataChannel (P5)

Tasarım: `docs/mimari-protokol.md` §3 ve §4. Şemalar: `packages/contracts/src/ws.ts` (WS), `src/dc.ts` (DataChannel),
`src/files.ts` (dosya adı temizleme ve uzantı uyarısı); ad örnekleri `packages/contracts/fixtures/file-names.json`.
Sohbet, işaretleme ve dosya içeriği **WS'den ve sunucudan geçmez**; eşler arası DataChannel'dan akar. Sunucu yalnız
dosya meta verisini (`file.meta`) ve kalite özetini (`quality.summary`) alır.

### `hello.maxFileMb` ve `peer.joined.maxFileMb`

- Tenant'ın dosya sınırı (`tenant_settings.max_file_mb`, 1..2048, varsayılan 100) MB cinsinden. Bayt karşılığı
  `maxFileBytes(mb)` = `mb × 1024 × 1024` (üst sınır 2048 MiB).
- `hello.maxFileMb`: iki role, yalnız ACTIVE oturumda. `peer.joined{role:"guest"}.maxFileMb`: teknisyene, çünkü
  teknisyen PENDING `hello`'sunda sınırı almaz. Alan yoksa istemci `DEFAULT_MAX_FILE_MB = 100` kullanır.
- Aktarımı engelleyen alıcıdır (alınan bayt sayacıyla); sunucu sınırı yalnız `file.meta` kaydında uygular.

### `file.meta` (teknisyen veya kabul edilmiş misafir → S)

| Alan        | Tür                                                            |
| ----------- | -------------------------------------------------------------- |
| `direction` | `TO_CUSTOMER` \| `TO_TECH`                                     |
| `fileName`  | string 1..255 (sunucu `sanitizeFileName` ile yeniden temizler) |
| `sizeBytes` | tam sayı, 0..2048 MiB                                          |
| `sha256`    | `/^[a-f0-9]{64}$/`                                             |
| `result`    | `OK` \| `REJECTED` \| `CANCELLED` \| `CORRUPT`                 |
| `fid?`      | P15: DataChannel transfer kimliği, `^[A-Za-z0-9_-]{1,26}$`     |
| `id?`       | ≤ 26                                                           |

Her transferde iki taraf da birer rapor gönderir; sunucu raporu kimin gönderdiğini mesajdan değil soketten belirler.

- **Alıcının raporu** (`TO_CUSTOMER` → misafir, `TO_TECH` → teknisyen): `session_files` satırı + audit `file.transfer`
  (entity `session_files`; `OK` → success, diğerleri fail) **tek işlemde** yazılır. Geçmişin tek kaynağıdır.
- **Gönderenin raporu**: `fid` yoksa (0.10.x istemci) `session_files`'a yazılmaz; yalnız audit
  `file.transfer.sender_report`. Değiştirilmiş bir konsol `TO_TECH` raporunu bastırsa da müşteri tarafının izi kalır.
- **P15 (AC-238), `fid` varsa:** gönderenin raporu da ayrı `session_files` satırı olur (`reported_by` = raporlayan
  bağlantının rolü, `TECH` | `CUSTOMER`). İki rapor `match_key` (oturum + yön + `fid` + SHA-256 + boyut özeti) ile eşlenir;
  geçmiş ekranı ve CSV bunları tek dosya sayar. Aynı taraf aynı aktarımı ikinci kez raporlarsa yok sayılır (metrik
  `rs_file_meta_total{result="duplicate"}`). Gönderen raporunun audit `entity`'si artık `session_files`'tır.
- **Audit içeriği (P13a, S-P13a-8):** `file.transfer`, `file.transfer.sender_report` ve `file.meta.rejected_by_db`
  kayıtlarının `newValue`'su `{ sessionId, direction, ext, sizeBytes, result }`'tır. **Dosya adı ve SHA-256 audit'e
  yazılmaz** (audit 730 gün saklanır; ad kişisel veri içerebilir). `ext` yalnız uzantıdır (son noktadan sonrası, ASCII
  harf/rakam, 1–10 karakter, küçük harf; uymazsa `null`). Ad ve SHA-256 yalnız `session_files`'ta durur ve saklama işiyle
  silinir.

Sunucunun kontrol sırası ve yanıtları (başarılı kayıtta yanıt mesajı yoktur):

| Durum                                                                                  | Yanıt                                                                                                                                     |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Oturumun `caps`'inde `file_transfer` yok (teknisyende `file_transfer.use` yetkisi yok) | `error{FORBIDDEN}`, kayıt yok, kota tüketmez                                                                                              |
| PENDING oturumda teknisyenden                                                          | `error{CONFLICT}` (lobideki misafirden → 1008 kapanış)                                                                                    |
| `result=OK` ve `sizeBytes` tenant sınırını aşıyor                                      | `error{FORBIDDEN}`                                                                                                                        |
| Kota aşımı (aşağıdaki tablo)                                                           | `error{RATE_LIMITED}` + audit `file.meta.rate_limited` (oda + taraf + sınıf başına dakikada en çok 1 satır)                               |
| Temizlenmiş ad DB CHECK'ine takıldı (Node/MySQL Unicode sürüm farkı)                   | `error{VALIDATION}` + audit `file.meta.rejected_by_db` (ad yerine yer tutucu `FILE_NAME_DB_REJECTED`; boyut, yön, SHA-256, sonuç korunur) |
| Diğer DB hatası                                                                        | Yalnız log (ref ID); istemciye ayrıntı gitmez                                                                                             |

Kotalar (raporlayan taraf × sınıf başına; bir taraf diğerinin kotasını tüketemez):

| Sınıf      | Kapsam                               | Dakikada | Oturum boyunca |
| ---------- | ------------------------------------ | -------- | -------------- |
| `accepted` | Alıcı raporu, `OK`/`CORRUPT`         | 60       | 2000           |
| `declined` | Alıcı raporu, `REJECTED`/`CANCELLED` | 20       | 500            |
| `sender`   | Gönderen raporu, sonuçtan bağımsız   | 10       | 200            |

Meşru istemci transfer başına taraf başına bir rapor gönderir; kotalara takılmaz.

```json
{ "t": "file.meta", "direction": "TO_CUSTOMER", "fileName": "kurulum-notlari.pdf", "sizeBytes": 482113,
  "sha256": "<64 hex>", "result": "OK" }
```

### `quality.summary` (yalnız teknisyen → S)

`fps`, `kbps`, `rttMs` her biri `{ avg, min, max }` (üst sınırlar sırasıyla 240, 1 000 000, 60 000), `connType`:
`host` \| `srflx` \| `relay`. Konsol ACTIVE iken 60 sn'de bir ve "Oturumu bitir"de `session.end`'den önce gönderir.
Sunucu yalnız kabul edilmiş (ACTIVE) oturumda `support_sessions.quality_summary`'nin üzerine yazar; son yazımdan 5 sn
içinde gelen özet yazılmaz, 4096 baytı aşan JSON yazılmaz. Hata istemciye dönmez (log + ref). Misafir gönderemez
(şema dışı → 1008).

```json
{ "t": "quality.summary", "fps": { "avg": 28.4, "min": 12, "max": 30 }, "kbps": { "avg": 2100, "min": 400, "max": 3900 },
  "rttMs": { "avg": 38, "min": 21, "max": 95 }, "connType": "host" }
```

### DataChannel'lar (teknisyen offer'da açar)

| Etiket  | Ayar                                   | Taşıdığı                                                                                                                        |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ctl`   | sıralı, güvenilir; JSON, mesaj ≤ 16 KB | sohbet, işaretleme, dosya teklif/yanıt mesajları, `ping`                                                                        |
| `file`  | sıralı, güvenilir, ikili               | dosya parçaları: `fidIndex` (uint16, big-endian, = `file.offer.idx`) \| `seq` (uint32, 0'dan ardışık) \| veri (≤ 16 KB)         |
| `input` | sıralı, güvenilir; JSON                | Fare/klavye (P7). Yalnız Windows istemcisi kabul eder; tarayıcı misafiri bu kanalı kapatır. Şema aşağıda "Uzaktan kontrol (P7)" |

`ctl` mesajları (bilinmeyen tip ve ekstra alan reddedilir):

| `t`                                           | Alanlar                                                                                                 | Kural                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat`                                        | `id`, `text` (1..2000), `ts` (ms)                                                                       | Alıcı düz metin basar; alıcıda 5 mesaj/sn sınırı                                                                                                                                                                                   |
| `annot.stroke`                                | `id`, `tool: pen\|arrow\|rect`, `color: red\|yellow\|green\|blue`, `pts: [[x,y],…]` (0..1, ≤ 500 nokta) | Koordinatlar normalize; alıcıda 30/sn                                                                                                                                                                                              |
| `annot.laser`                                 | `x`, `y` (0..1)                                                                                         | Gönderen 30/sn'ye kısar; alıcıda 1 sn'de söner                                                                                                                                                                                     |
| `annot.undo` / `annot.clear`                  | `id?`                                                                                                   | Alıcıda 30/sn                                                                                                                                                                                                                      |
| `file.offer`                                  | `fid`, `idx` (uint16), `name` (1..255), `size` (≤ 2048 MiB), `sha256`                                   | Alıcı onay ister; ad gösterimden önce temizlenir; tehlikeli/çift uzantı uyarısı. Alıcı 10 sn'de en çok 3 teklif işler, fazlası sessizce düşer; ret sonrası 30 sn yeni teklifler otomatik reddedilir; aynı anda tek bekleyen teklif |
| `file.accept` / `file.reject` / `file.cancel` | `fid`                                                                                                   | Kabul gelmeden gönderen parça yollamaz. Yanıtsız teklif 30 sn sonra gönderende `file.cancel` ile kapanır                                                                                                                           |
| `file.done`                                   | `fid`                                                                                                   | Gönderen son parçadan sonra yollar; alıcı alınan bayt = `size` ve SHA-256'yı doğrular                                                                                                                                              |
| `file.result`                                 | `fid`, `ok`                                                                                             | Alıcı → gönderen. `ok=false` → alıcı tamponu siler, iki tarafta "Dosya bozuk"; ardından iki taraf `file.meta` gönderir                                                                                                             |
| `ping`                                        | `id?`                                                                                                   | —                                                                                                                                                                                                                                  |

Alıcı güvenliği: sınır beyan edilen `size`'a değil **alınan bayta** göre uygulanır (aşım veya sıra dışı parça →
iptal/bozuk); `caps`'te `file_transfer` yoksa gelen teklif otomatik reddedilir; indirme `application/octet-stream`
Blob'u olarak sunulur. Ad temizleme kuralı ve tehlikeli uzantı listesi tek kaynaktır: `packages/contracts/src/files.ts`
(`sanitizeFileName`, `DANGEROUS_EXT`, `fileNameWarning` → `none | dangerous | double_extension`).

## Uzaktan kontrol (P7)

Tasarım: `docs/mimari-protokol.md` §3, §3.3 (durum tablosu K1–K8) ve §4.3; karar kaydı `docs/adr/0013-kontrol-yasam-dongusu-teknisyen-mesajlari.md`.
Şemalar: `packages/contracts/src/ws.ts` (WS), `src/dc.ts` (`input`), audit adları `src/audit.ts`. Örnekler:
`packages/contracts/fixtures/ws-messages.json`, `fixtures/dc-input.json` (TS ve Go testleri aynı dosyayı okur).

**Temel kural:** izin yalnız müşterinin Windows istemcisinde verilir (istemcideki izin kapısı). Sunucunun ve konsolun
tuttuğu durum (`VIEW` / `REQUESTED` / `GRANTED`) kayıt ve bilgi içindir; hiçbir mesaj kapıyı uzaktan **açamaz**,
yalnız kapatabilir. Tarayıcı misafiri kontrol edilemez (`input` kanalı yok, istek `FORBIDDEN`).

**Yetki:** teknisyende `remote_control.use` ve oturumun `caps` listesinde `remote_control`. `caps` oturum içinde yalnız
daralır; yetki eklenirse yeni oturumda geçerli olur.

### WS mesajları

| `t`               | Yön                              | Alanlar                                                                                                          | Ne olur                                                                                                                                                                                                                                                                                                                        |
| ----------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `control.request` | teknisyen→S→misafir              | —                                                                                                                | Kontrol isteği. Süzgeç aşağıda. Geçerse oda `REQUESTED`, sayaç +1, audit `control.requested` (iletimden önce yazılır), misafire iletilir                                                                                                                                                                                       |
| `control.cancel`  | teknisyen→S→misafir              | —                                                                                                                | "Vazgeç". `REQUESTED` → `VIEW`, misafire `control.cancel`, teknisyene `control.state{VIEW, TECH}`, audit `control.cancelled`. `GRANTED` iken `control.release` ile aynı. `VIEW` iken yok sayılır. Sayaç geri verilmez; 30 sn bekleme başlamaz                                                                                  |
| `control.release` | teknisyen→S→misafir              | —                                                                                                                | "Kontrolü bırak". Yalnız `GRANTED` iken: misafire `control.release`, teknisyene `{VIEW, TECH}` (DB beklenmez), sonra consent `REVOKED/TECH` + audit `control.released`. `REQUESTED` iken = cancel; `VIEW` iken yok sayılır                                                                                                     |
| `control.state`   | misafir→S→teknisyen; S→teknisyen | `state: VIEW\|GRANTED`, `source: UI\|HOTKEY\|DENIED\|RECONNECT\|SYSTEM\|TECH\|OS_PERMISSION\|WAYLAND_NO_CONTROL` | Misafirden: `GRANTED` yalnız `UI`; `VIEW` yalnız `UI\|HOTKEY\|DENIED\|SYSTEM\|OS_PERMISSION\|WAYLAND_NO_CONTROL` (diğerleri şema hatası → 1008; `OS_PERMISSION` P28f, bkz. "macOS istemci (P28f)"; `WAYLAND_NO_CONTROL` P28g, bkz. "Linux istemci (P28g)"). `RECONNECT` ve `TECH` yalnız sunucu üretir. Ayrıntı: durum tablosu |
| `control.revoke`  | S→misafir                        | `reason: permission\|audit\|admin\|reconnect\|stale`                                                             | İstemci her nedende kapıyı ve açık izin diyaloglarını kapatır; kapı açıktıysa `control.state{VIEW, SYSTEM}` döner                                                                                                                                                                                                              |
| `caps.update`     | S→misafir                        | `caps: ("remote_control"\|"file_transfer")[]`                                                                    | Teknisyen yetkisi daraldı. `remote_control` düştüyse ardından `control.revoke{permission}` gelir                                                                                                                                                                                                                               |
| `monitor.request` | teknisyen→S→misafir              | `monitorId: 0..64`                                                                                               | Paylaşılan ekranı değiştirme isteği (yalnız Hızlı Destek). Süzgeç aşağıda. Audit `monitor.requested`                                                                                                                                                                                                                           |
| `monitor.denied`  | misafir→S→teknisyen              | `monitorId: 0..64`                                                                                               | Müşteri reddetti (Reddet, Esc, pencereyi kapatma). Yalnız bekleyen istekle aynı kimlik işlenir; 30 sn bekleme başlar; audit `monitor.denied`                                                                                                                                                                                   |
| `env.state`       | misafir→S→teknisyen              | `elevatedForeground`, `secureDesktop`, `selfElevated` (üçü de zorunlu boolean)                                   | İstemci her `hello`'dan hemen sonra bir kez, sonra yalnız değişimde gönderir. Sunucu son değeri saklar, alanları yeniden kurarak iletir; `selfElevated` GRANTED audit'ine yazılır                                                                                                                                              |

Monitör onayı ayrı mesajla gelmez: isteğin iletildiği **aynı misafir bağlantısından** gelen `share.state.activeMonitor ===
monitorId` onaydır (audit `monitor.granted`). Yanıtsız istek 30 sn sonra ret gibi düşer (mesaj ve audit yok).

### `control.request` süzgeci (ilk tutan döner; istek iletilmez, sayaç değişmez)

| Sıra | Koşul                                                        | Yanıt                                                                                  |
| ---- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1    | `remote_control.use` yok veya `caps`'te `remote_control` yok | `error{FORBIDDEN, "Uzaktan kontrol yetkiniz yok."}`                                    |
| 2    | Kabul edilmiş misafir bağlı değil                            | `error{CONFLICT, "Müşteri bağlı değil."}`                                              |
| 3    | Misafir tarayıcı modunda                                     | `error{FORBIDDEN, "Müşteri tarayıcı modunda: yalnız görüntüleme."}`                    |
| 4    | Önceki istek bekliyor (`REQUESTED`)                          | `error{CONFLICT, "Önceki kontrol isteği müşteride bekliyor."}` — önce `control.cancel` |
| 5    | Kontrol açık veya izin kaydı yazılıyor                       | `error{CONFLICT, "Kontrol zaten açık."}`                                               |
| 6    | Son retten bu yana 30 sn geçmedi                             | `error{RATE_LIMITED, "Müşteri reddetti; 30 sn sonra tekrar isteyebilirsiniz."}`        |
| 7    | Bu oturumda 5 istek iletildi                                 | `error{RATE_LIMITED, "Bu oturumda kontrol isteği sınırına ulaşıldı."}`                 |

### `monitor.request` süzgeci (sayaç kontrolden ayrı)

| Koşul                                         | Yanıt                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| Kabul edilmiş misafir bağlı değil             | `error{CONFLICT, "Müşteri bağlı değil."}`                                |
| Misafir tarayıcı modunda                      | `error{FORBIDDEN, "Monitör değiştirme yalnız istemci modunda."}`         |
| Bilinen monitörler arasında yok               | `error{VALIDATION, "Monitör bulunamadı."}`                               |
| Zaten paylaşılan monitör                      | `error{VALIDATION, "Bu monitör zaten paylaşılıyor."}` (sayaç düşmez)     |
| Bekleyen monitör isteği var                   | `error{CONFLICT, "Önceki monitör isteği müşteride bekliyor."}`           |
| Ret veya yanıtsızlıktan bu yana 30 sn geçmedi | `error{RATE_LIMITED, "Müşteri onaylamadı; 30 sn sonra tekrar deneyin."}` |
| Bu oturumda 5 istek iletildi                  | `error{RATE_LIMITED, "Bu oturumda monitör isteği sınırına ulaşıldı."}`   |

### Durum tablosu (özet; tam hali mimari-protokol §3.3)

| Olay                                                                                                              | Oda durumu                                  | Misafire                                                                | Teknisyene                   | Kayıt (consent / audit)                                                                             |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `control.state{GRANTED, UI}`                                                                                      | `REQUESTED` → `GRANTED` (TX commit sonrası) | —                                                                       | `{GRANTED, UI}`              | `GRANTED/UI` / `control.granted` (`selfElevated`)                                                   |
| Aynı, TX hata veya > 800 ms                                                                                       | `VIEW`                                      | `control.revoke{audit}`                                                 | `error{INTERNAL}`            | log + ref                                                                                           |
| `control.state{GRANTED}` beklenmedik (`VIEW`)                                                                     | değişmez                                    | `control.revoke{stale}`                                                 | —                            | yok (metrik)                                                                                        |
| `control.state{VIEW, DENIED}`                                                                                     | `REQUESTED` → `VIEW`, 30 sn bekleme         | —                                                                       | `{VIEW, DENIED}`             | `DENIED/UI` / `control.denied`                                                                      |
| `control.state{VIEW, UI\|HOTKEY\|SYSTEM}` (kontrol açıkken)                                                       | → `VIEW`                                    | —                                                                       | aynı kaynak                  | `REVOKED/<kaynak>` / `control.revoked`                                                              |
| Aynı, istek bekliyorken (istemci diyaloğu kendisi kapattı)                                                        | → `VIEW`, bekleme yok                       | —                                                                       | aynı kaynak                  | consent yok / `control.cancelled{by:"agent"}`                                                       |
| `control.state{VIEW, OS_PERMISSION}` (P28f; yalnız `REQUESTED`, AGENT, `clientOs=macos\|linux`; aksi yok sayılır) | → `VIEW`, bekleme yok, sayaç iade edilmez   | —                                                                       | `{VIEW, OS_PERMISSION}`      | consent yok / `control.cancelled{by:"agent", source:"os_permission"}` (Linux: `"linux_no_control"`) |
| `control.state{VIEW, WAYLAND_NO_CONTROL}` (P28g; yalnız `REQUESTED`, AGENT, `clientOs=linux`; aksi yok sayılır)   | → `VIEW`, bekleme yok, sayaç iade edilmez   | —                                                                       | `{VIEW, WAYLAND_NO_CONTROL}` | consent yok / `control.cancelled{by:"agent", source:"wayland_no_control"}`                          |
| Yetki daralması                                                                                                   | → `VIEW`                                    | `caps.update` + `control.revoke{permission}`                            | `{VIEW, SYSTEM}`             | `REVOKED/SYSTEM` / `control.revoked` + `session.caps_changed`                                       |
| Misafir kopması                                                                                                   | → `VIEW`                                    | —                                                                       | `{VIEW, RECONNECT}`          | `REVOKED/RECONNECT`                                                                                 |
| Teknisyen kopması / sekme değişimi                                                                                | → `VIEW`                                    | önce `control.revoke{reconnect}`, sonra `peer.left`/`peer.joined{tech}` | (yeni `hello` VIEW ile)      | `REVOKED/RECONNECT` (`side: "tech"`)                                                                |
| Oturum sonu (kontrol açık)                                                                                        | —                                           | `session.ended`                                                         | `session.ended`              | en iyi çabayla `REVOKED/SYSTEM` (`reason: "session_ended"`)                                         |

`error{INTERNAL}` yalnız sunucunun kendi hatasında gelir; mesaj genel metin + log referansıdır
(`"Kontrol kaydı yazılamadı; kontrol geri alındı (ref: <ref>)."`), ayrıntı içermez.

### Örnek akış

```json
// teknisyen → S
{ "t": "control.request" }
// S → misafir
{ "t": "control.request" }
// misafir → S (müşteri "İzin ver"e tıkladı)
{ "t": "control.state", "state": "GRANTED", "source": "UI" }
// S → teknisyen (kayıt commit edildikten sonra)
{ "t": "control.state", "state": "GRANTED", "source": "UI" }
// teknisyen → S ("Kontrolü bırak")
{ "t": "control.release" }
// S → teknisyen
{ "t": "control.state", "state": "VIEW", "source": "TECH" }
```

```json
{ "t": "env.state", "elevatedForeground": false, "secureDesktop": false, "selfElevated": false }
{ "t": "monitor.request", "monitorId": 1 }
{ "t": "error", "code": "RATE_LIMITED", "message": "Müşteri reddetti; 30 sn sonra tekrar isteyebilirsiniz." }
```

### `input` DataChannel

Teknisyen offer'da açar; JSON, bilinmeyen tip ve ekstra alan reddedilir. İstemci mesajı yalnız `caps`'te
`remote_control` varken ve izin kapısı açıkken uygular; aksi halde sessizce düşürür. İstemci tarafında mesaj ≤ 512
bayt ve saniyede 250 olay (ani 500) sınırı vardır; yalnız basılı tuş/düğmenin bırakılması sınırdan muaftır.

| `t`             | Alanlar                                                                                   | Not                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `m.move`        | `x`, `y`: 0..1                                                                            | Görüntülenen monitöre göre normalize                                                                                                                                  |
| `m.btn`         | `b: l\|r\|m`, `down: bool`, `x`, `y`                                                      | —                                                                                                                                                                     |
| `m.wheel`       | `dx`, `dy`: tam sayı −1200..1200                                                          | WHEEL_DELTA (120) birimi; `dy > 0` aşağı                                                                                                                              |
| `k`             | `code`: `^[A-Za-z0-9]{1,32}$` (`KeyboardEvent.code`), `down: bool`, `key?`: 1..4 karakter | `key` yalnız tek yazdırılabilir karakterde (Türkçe harfler düzenden bağımsız yazılır); Ctrl/Alt/Win basılıyken kısayol olarak gider. Ctrl+Alt+Del ve Win+L uygulanmaz |
| `k.release_all` | —                                                                                         | Basılı kalan tuş ve düğmeleri bırakır (konsol bırakmadan önce gönderir)                                                                                               |

```json
{ "t": "m.btn", "b": "l", "down": true, "x": 0.41250, "y": 0.73125 }
{ "t": "k", "code": "KeyS", "down": true, "key": "ş" }
{ "t": "k.release_all" }
```

### Metrik `rs_control_total{event}`

Olay değerleri `apps/server/src/ops/metrics.ts` yardım metninde listelidir. Sık bakılanlar:
`control_request_{forwarded,forbidden,browser,no_guest,conflict,cooldown,limit}`, `granted`, `denied`, `released`,
`cancelled`, `cancelled_by_agent`, `revoke_{permission,audit,reconnect,session_ended}`, `grant_audit_{error,timeout}`
(fail-closed tetiklendi), `control_request_audit_failed`, `control_state_unexpected`,
`monitor_request_{forwarded,conflict,cooldown,already_active}`, `monitor_{granted,denied}`, `caps_narrowed`.

## Destek talepleri (P8b-1)

Müşteri, firmaya özel Hızlı Destek dosyasından talep gönderir; talep firmanın kuyruğuna düşer, teknisyen panelden
kabul eder ve oturum doğrudan açılır. Bağlayıcı sözleşme: `docs/mimari-api.md` "Destek talepleri (P8b)",
`docs/mimari-protokol.md` §5, `docs/mimari-e9.md` §13; şemalar `packages/contracts/src/api/requests.ts`
(tümü `strictObject`, bilinmeyen alan → 400). Müşteri ekranı (istemci) P8b-2'de gelir; uçlar P8b-1'de hazırdır.

Talep durumları: `PENDING` (Bekliyor) → `ACCEPTED` (Kabul edildi) | `REJECTED` (Reddedildi) | `CANCELLED` (İptal;
neden `CUSTOMER`, `DISCONNECTED`, `TENANT_PASSIVE`) | `EXPIRED` (Süresi doldu); `ACCEPTED` → `CONNECT_FAILED`
(müşteri 60 sn içinde bağlanmadı). Müşteri WS bağlantısı koparsa 120 sn içinde dönmezse talep `CANCELLED(DISCONNECTED)`.

### Alan kuralları (özet)

| Alan               | Kural                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `ref`              | `^[a-z2-7]{16}$` (firma bağlantısındaki 80 bit değer)                                      |
| `customerName`     | 2–80 karakter, kontrol/biçim karakteri yok                                                 |
| `phone`            | `05xx…`, `5xx…`, `+905xx…` → `+90…`; uluslararası `+` 8–15 hane. Geçersiz → `fields.phone` |
| `email`            | İsteğe bağlı, ≤ 254                                                                        |
| `description`      | Tek satıra indirilir; 10–500 karakter                                                      |
| `clientInstanceId` | `^[A-Za-z0-9_-]{22}$`; `deviceKey` (isteğe bağlı) aynı biçim                               |
| `clientVersion`    | `x.y.z`                                                                                    |
| Ret mesajı         | Tek satır, 5–200; bağlantı, e-posta, 7+ haneli numara içeremez                             |

### GET /api/v1/public/requests/tenant?ref=

Firma bilgisi ve güncel KVKK metni. Yanıt `Cache-Control: no-store`.

```json
{ "tenant": { "name": "Örnek Ltd", "logoUrl": "/api/v1/files/logo/01K…/<24-karakter>.png" },
  "consentText": { "id": "01K…", "version": 3, "body": "…", "sha256": "…" },
  "waitMinutes": 30, "abuseEmail": null, "minAgentVersion": null }
```

`tenant.logoUrl` (P12): firma logosu → sistem logosu → `/img/logo.png` (istemci ekranındaki logo).
Hatalar: 404 `REQUEST_REF_INVALID` (biçim dışı, yok, yenilenmiş, pasif — hepsi aynı), 429 `RATE_LIMITED`.

### POST /api/v1/public/requests

Yalnız Hızlı Destek istemcisi (Windows; P31 ile macOS 0.24.0+): `Origin` ve `Sec-Fetch-*` başlıkları **olmamalı** (yoksa
403 `CSRF_INVALID`). Gövde ≤ 8 KB. P31: isteğe bağlı `"clientOs": "windows" | "macos"` (yalnız macOS istemcisi gönderir;
yoksa `windows` sayılır; `linux` ve diğer değerler 400 `VALIDATION` `fields.clientOs`). Ayrıntı: "macOS'ta Destek iste (P31)".

```json
{ "ref": "abcdefghijk2345m", "clientInstanceId": "AbCdEfGhIjKlMnOpQrStUv", "clientVersion": "0.9.0",
  "customerName": "Ayşe Yılmaz", "phone": "0532 000 00 00", "email": "ayse@example.com",
  "description": "Yazıcı çıktı vermiyor", "consentTextId": "01K…", "consentAccepted": true }
```

201:

```json
{ "requestId": "01K…", "requestSecret": "<43 karakter; yalnız bu yanıtta>", "requestCode": "482913",
  "expiresAt": "2026-11-12T10:30:00.000Z", "position": 2 }
```

Hatalar: 400 `VALIDATION` (`fields.*`; KVKK metni güncel değilse `fields.consentTextId`), 403 `CSRF_INVALID`,
404 `REQUEST_REF_INVALID`, 409 `REQUEST_PENDING`, 426 `CLIENT_OUTDATED`, 429 `RATE_LIMITED` (+`Retry-After`) veya
`QUEUE_FULL`, 503 `NOT_READY` (+`Retry-After: 5`; talep kapısı dolu veya DB yoğun — aynı gövdeyle yeniden denenebilir).

### POST /api/v1/public/requests/cancel

Gövde `{ "requestSecret": "<43>" }` → her durumda 204 (sır doğruluğu sızdırılmaz). Bekleyen talep `CANCELLED(CUSTOMER)`;
kabul edilmiş ama müşteri bağlanmamışsa oturum da iptal olur ve teknisyene "Müşteri bağlantıyı kabul etmedi" gider.
Hatalar: 403 `CSRF_INVALID`, 429.

### GET /api/v1/public/agent/request-download?ref=[&os=windows|macos]

302 → `/downloads/NoktaDestek-<firma kısa adı>-<ref>.exe` (`no-store`). P31: `os=macos` ya da (parametre yoksa) macOS
masaüstü `User-Agent`'ı + hazır macOS zip'i → `.zip`; ayrıntı ve ek hatalar "macOS'ta Destek iste (P31)". Dosyayı Caddy sunar; server
`/internal/agent-ready` ile ref'in geçerliliğini ve ikili bütünlüğünü onaylar (geçersiz → 404, ikili yok → 503).
Firma kısa adı değişmişse eski adlı dosya 404 olur. Ref log ve audit'e yazılmaz. Hatalar: 404 `REQUEST_REF_INVALID`,
429, 503 `NOT_READY`.

### GET /api/v1/support-requests?tab=pending|history&status=&page=&pageSize=

Tümü oturum + `tenantScope`: Super Admin firma seçmemişse 403 "Önce bir firma seçin.". `pending` en eski önce, en çok
50, sayfalama yok; `history` son 30 günde kapanan talepler, `status` filtresi, sayfalı.

```json
{ "items": [ { "id": "01K…", "requestCode": "482913", "networkMatch": "NONE", "knownDevice": false,
  "status": "PENDING", "cancelReason": null, "createdAt": "…", "closedAt": null, "waitSec": 75,
  "customerName": "Ayşe Yılmaz", "customerPhone": "+905320000000", "customerEmail": "ayse@example.com",
  "description": "Yazıcı çıktı vermiyor", "clientVersion": "0.9.0", "acceptedBy": null,
  "rejectMessage": null, "sessionId": null } ], "page": 1, "pageSize": 25, "total": 1 }
```

`networkMatch`: `NONE` | `PREFIX` (benzer ağdan önceki oturum) | `IP` (aynı ağdan önceki oturum) | `TRUSTED` (güvenilen
ağ). Anonimleştirilmiş kayıtta kişisel alanlar `null`. Hatalar: 400, 403.

### GET /api/v1/support-requests/count · GET /api/v1/support-requests/:id

`{ "pending": 3 }` · tek `SupportRequestItem`. Başka firmanın talebi 404.

### POST /api/v1/support-requests/:id/accept

Gövde `{}`. 200 `{ "sessionId": "01K…", "consoleUrl": "/sessions/01K…/console" }`; müşteriye teknisyen adı ve doğrulama
kodu gider. Hatalar: 403 (yetki yok; Super Admin kabul edemez — oturum teknisyenin kendi firmasında açılır), 404,
409 `REQUEST_TAKEN` / `REQUEST_CLOSED` / `OPEN_SESSION_LIMIT` (talep beklemede kalır), 429.

### POST /api/v1/support-requests/:id/reject

Gövde `{ "message": "Şu an müsait değiliz, sizi arayacağız" }` → 204; müşteri mesajı düz metin görür. Hazır metinler:
"Şu an müsait değiliz, sizi arayacağız", "Mesai saatleri dışındayız, sizi arayacağız", "Lütfen firmanızı telefonla
arayın". Hatalar: 400, 403 (Super Admin dahil), 404, 409 `REQUEST_TAKEN` / `REQUEST_CLOSED`, 429.

### GET / PUT /api/v1/settings/support-requests

Yetki `settings.edit`; yanıt `no-store`. Satır yoksa ilk okumada oluşturulur (ref o an üretilir).

```json
{ "downloadUrl": "https://remote.noktabilisim.net/api/v1/public/agent/request-download?ref=…",
  "fileName": "NoktaDestek-OrnekLtd-….exe", "refPrefix": "abcd", "refRotatedAt": null, "waitMinutes": 30,
  "trustedCidrs": ["203.0.113.0/24"],
  "whatsapp": { "enabled": true, "recipients": ["+905320000000"], "serviceConfigured": true, "insecure": false },
  "email": { "enabled": false, "recipients": [], "smtpConfigured": false }, "requireAcceptCode": false }
```

PUT gövdesi: `{ waitMinutes: 10..120, trustedCidrs: ≤ 10 tekil (IPv4 en geniş /16, IPv6 /32; özel/loopback yok),
whatsapp: { enabled, recipients: ≤ 5 tekil telefon }, email: { enabled, recipients: ≤ 5 } }`. WhatsApp açıkken en az
bir alıcı; SMTP yokken `email.enabled=true` → 400 "Önce SMTP ayarlarını yapın" (P10; `email.smtpConfigured` bunu gösterir). Bekleme süresi yalnız yeni taleplere
uygulanır. P15 (AC-239): `requireAcceptCode?: boolean` — verilmezse mevcut değer korunur. Hata alanları `fields["whatsapp.recipients.1"]`, `fields["trustedCidrs.0"]` biçimindedir.

### POST /api/v1/settings/support-requests/rotate-ref

Gövde `{}` → yeni ayarlar. Eski bağlantı ve indirilmiş eski dosyalar anında 404; bekleyen talepler etkilenmez.

### POST /api/v1/settings/support-requests/whatsapp/test

Gövde `{ "phone": "0532 000 00 00" }` → yalnız `{ "ok": true, "message": "Test mesajı gönderildi." }` (servis hata verirse
`ok:false` ve sabit metin; P12b'den beri Super Admin testiyle aynı mesajlar, bkz. "WhatsApp servisi (P12b)"). Servis
yapılandırılmamışsa veya güvensizse istek gönderilmez, 502 `UPSTREAM` "Servis yapılandırılmamış." / "Servis güvenli
yapılandırılmamış.". Servis adresi bu uçtan ve `GET /settings/support-requests`'ten dönmez; Super Admin
`/admin/settings/whatsapp` ile yönetir. Hatalar: 400, 429 (firma başına 5/dk), 502 `UPSTREAM`.

### POST /api/v1/settings/support-requests/email/test (P10, AC-151)

Gövde `{ "to": "destek@example.com" }`. Kayıtlı firma SMTP'siyle örnek "Yeni destek talebi" e-postası gönderir.
Başarı `{ "ok": true, "message": "Test e-postası gönderildi." }`; gönderim hatası **200** `{ "ok": false, "message":
"E-posta gönderilemedi. Sunucu, port, güvenlik ve kimlik bilgilerini kontrol edin." }`. Hatalar: 400 (`fields.to`,
`HOST_NOT_ALLOWED`), 429 (SMTP testiyle **ortak** firma başına 5/dk), 502 "Önce SMTP ayarlarını yapın".

**E-posta kanalı (P10).** `email.enabled=true` iken her yeni talepte ayarlı her alıcıya (≤ 5) e-posta gider: firma adı,
talep kodu, panel bağlantısı. Müşterinin adı, telefonu, e-postası ve açıklaması e-postaya yazılmaz. Firma başına saatte
en çok 30 ileti; aşım bastırılır (metrik `rs_request_notify_total{channel="email",result="suppressed"}`). Gönderim hatası
talebi engellemez.

### WebSocket `/ws/request` (müşteri istemcisi)

`wss://<host>/ws/request`, sorgu dizesi yok. `Sec-WebSocket-Protocol: rs.v1, rs.req.<requestSecret>`; `Origin` yok.
Talep başına tek soket (yenisi gelince eski 4409), IP başına ≤ 5 soket (güvenilen ağ muaf), sürüm düşükse 426.
Sunucu → istemci: `request.state` (sıra, talep kodu, süreler; 10 sn'de bir ve kuyruk değişince), `request.accepted`
(`wsTicket`, `technicianName`, `techVerifyCode`, P15: `admitCode?`; istemci müşteri onayından sonra `/ws/guest`'e bağlanır;
`admitCode` yalnız firma ayarı `requireAcceptCode` açıkken gelir, bkz. "G3 küçük özellikler (P15)"),
`request.closed` (`status`, `reason?`, ret mesajı). İstemci → sunucu: `request.cancel`, `request.decline`.

### WebSocket `/ws/panel` (teknisyen paneli, tek yönlü)

Oturum çerezi + izinli `Origin` + `support_requests.view` + firma bağlamı; kullanıcı başına ≤ 5 soket (6. → 4429,
gerekçe `too_many`; istemci yeniden denemez). **P14a (AC-216):** oturum başına upgrade sınırı 30/dk (oturum token'ının
SHA-256'sı anahtar). Aşımda upgrade kabul edilir ve hemen `close(4429, "retry=<sn>")` ile kapanır (WS'de `Retry-After`
yok); istemci `<sn>` ± %20 bekleyip sessizce yeniden bağlanır. Metrik `rs_ws_rejected_total{role="panel",reason="session_rate"}`.
IP kovası (HTTP 429) ayrı ve değişmedi.
İstemciden gelen her mesaj 1008. Çıkış, şifre değişimi veya yetki kaybında 4401. Mesajlar: `queue.count`,
`request.new` (ad + açıklamanın ilk 100 karakteri; telefon/e-posta yok), `request.removed`,
`request.connect_failed` ve `request.declined` (yalnız kabul edene), `queue.alert` (olağan dışı yoğunluk).
Kaçırılan olayın kaynağı REST'tir; panel yeniden bağlanınca listeyi yeniden çeker.

### Hız sınırları (bellek içi; aşımda o anahtar 15 dk 429 + `Retry-After`, aksi belirtilmedikçe)

| Kova                | Anahtar                             | Sınır                                          | Uç                                                                                                                |
| ------------------- | ----------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Geçersiz ref        | IP                                  | 10/dk                                          | tenant bilgisi, talep oluşturma, indirme, geçersiz `/ws/request` sırrı                                            |
| Talep oluşturma     | IP / ağ öneki (IPv4 /24) / IPv6 /48 | 5/sa / 20/sa / 40/sa                           | POST `/public/requests` (güvenilen ağ muaf)                                                                       |
| Talep oluşturma     | Firma                               | 60/sa bilinmeyen kaynak, 120/sa bilinen kaynak | Firma kilitlenmez; yalnız bilinmeyen kaynak reddedilir, panele `queue.alert`                                      |
| Bekleyen talep (DB) | İstemci örneği / IP / ağ / firma    | 1 / 3 / 10 / 50                                | 409 `REQUEST_PENDING` / 429 `RATE_LIMITED` / 429 / 429 `QUEUE_FULL` (≥ 40 iken bilinmeyen kaynak da `QUEUE_FULL`) |
| İndirme             | IP                                  | 30/sa                                          | `request-download`                                                                                                |
| Tenant bilgisi      | IP                                  | 60/dk                                          | GET `/public/requests/tenant`                                                                                     |
| İptal               | IP                                  | 30/dk                                          | POST `/public/requests/cancel`                                                                                    |
| WhatsApp testi      | Firma                               | 5/dk (1 dk blok)                               | `whatsapp/test`                                                                                                   |
| Kabul/ret           | Kullanıcı                           | 30/dk (1 dk blok)                              | accept, reject                                                                                                    |
| WS el sıkışma       | IP                                  | 30/dk (1 dk blok)                              | `/ws/request`, `/ws/panel`                                                                                        |
| Talep kapısı        | Firma / toplam                      | 2 / 4 eşzamanlı, kuyruk 16 / 64, bekleme 5 sn  | Dolunca 503 `NOT_READY` + `Retry-After: 5`                                                                        |

## Müşteriler ve bilgisayar kaydı (P8c)

Tenant kendi müşteri firmalarını kaydeder; her müşteri Genel bağlantıyla aynı biçimde (`[a-z2-7]{16}`) kalıcı bir ref ve
`NoktaDestek-<etiket>-<ref>.exe` dosyası alır. Başarılı bir istemci oturumundan sonra 0.10.0+ istemci bilgisayar kaydı
alır ve sonraki açılışta bu kayıtla talep açar. Bağlayıcı sözleşme: `docs/mimari-api.md` "Müşteriler ve bilgisayar kaydı
(P8c)", `docs/mimari-protokol.md` §6, `docs/mimari-e10.md` §15. Kaynak: `apps/server/src/customers/{routes,service}.ts`,
`bindings/{public-routes,service}.ts`, `requests/routes.ts`, `signaling/binding.ts`; şemalar
`packages/contracts/src/api/{customers,bindings,requests,sessions}.ts`, `ws.ts` (tümü `strictObject`).

Panel uçları oturum çerezi ister; durum değiştirenler `Origin` + `X-CSRF-Token` ister. Hepsi `tenantScope` kullanır:
Super Admin firma seçmeden 403; başka tenant'ın kaydı veya biçimsiz `:id` → 404. Müşteri yazma uçları (POST, PATCH,
rotate, deactivate, reactivate, revoke-binding) kullanıcı başına 30/dk (aşımda 429).

**Tipler.** `CustomerFirmRef = { id, name, status }`.
`CustomerListItem = { id, name, status: "ACTIVE"|"PASSIVE", downloadUrl|null, fileName|null, createdAt, lastRequestAt|null, requestCount }`
(pasif müşteride `downloadUrl`/`fileName` `null`). `CustomerDetail = CustomerListItem + { fileLabel, contactName|null,
phone|null, email|null, note|null, refRotatedAt|null, passiveAt|null, anonymizedAt|null, sessionCount }`.

**Alan kuralları.** `name` 2–100 karakter, kontrol/görünmez karakter yok, tenant içinde tekil (büyük/küçük harf ve Türkçe
karakter duyarsız). `fileLabel` `^[A-Za-z0-9]{1,20}$` (verilmezse addan önerilir). `contactName` ≤ 80. `phone` `05xx…` /
`+90…` / uluslararası `+`. `email` ≤ 254. `note` ≤ 1000, düz metin (sekme yok). Kişisel alanlarda `""` veya `null` alanı
boşaltır.

### GET /api/v1/customers?q=&status=active|passive|all&page=&pageSize=&sort=

Yetki `customers.view`. `q` 2–100 karakter (ad, yetkili kişi, telefon içinde arar), `status` varsayılan `active`,
`pageSize` varsayılan 50 (en çok 100), `sort` `name:asc` (varsayılan) | `createdAt:desc`. Yanıt `no-store`:

```json
{ "items": [ { "id": "01K…", "name": "Örnek Muhasebe Ltd.", "status": "ACTIVE",
  "downloadUrl": "https://remote.noktabilisim.net/api/v1/public/agent/request-download?ref=…",
  "fileName": "NoktaDestek-OrnekMuhasebe-….exe", "createdAt": "…", "lastRequestAt": null, "requestCount": 0 } ],
  "page": 1, "pageSize": 50, "total": 1 }
```

Hatalar: 400 `VALIDATION`, 403.

### GET /api/v1/customers/general-link · GET /api/v1/customers/options?q=&status=active|all

`general-link` (`customers.view`): `{ "downloadUrl": "…", "fileName": "NoktaDestek-<firma>-….exe" }` — Genel bağlantının
salt okunur kopyası (yenileme yalnız Ayarlar'dan). `options`: `{ "items": [CustomerFirmRef] }`, en çok 20, ada göre;
yetki `customers.view` **veya** `support_requests.view` **veya** `session_history.view` (filtre ve seçim kutuları).

### POST /api/v1/customers

Yetki `customers.create`. Gövde:

```json
{ "name": "Örnek Muhasebe Ltd.", "fileLabel": "OrnekMuhasebe", "contactName": "Ayşe Yılmaz",
  "phone": "0532 000 00 00", "email": "ayse@example.com", "note": "Muhasebe ofisi, 3 bilgisayar" }
```

201 `CustomerDetail`. Hatalar: 400 `VALIDATION` (`fields.*`), 403, 409 `CONFLICT` (`fields.name` "Bu adla bir müşteri
zaten var"), 429.

### GET /api/v1/customers/:id · PATCH /api/v1/customers/:id

GET (`customers.view`) → `CustomerDetail`; yok/başka tenant → 404. PATCH (`customers.edit`): POST alanlarının en az biri;
ad ve etiket boşaltılamaz. Pasif müşteride de çalışır (kişisel veriyi silmek için). Hatalar: 400, 404, 409, 429.

### POST /api/v1/customers/:id/rotate-ref · /deactivate · /reactivate

Gövde `{}` → güncel `CustomerDetail`.

| Uç           | Yetki              | Etkisi                                                                                                                                         | Hatalar                          |
| ------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `rotate-ref` | `customers.edit`   | Yeni ref; eski bağlantı ve dosyalar anında 404; müşterinin kayıtlı bilgisayarları geçersiz (`CUSTOMER_ROTATED`). Bekleyen talepler etkilenmez  | 404, 409 `CONFLICT` (pasif), 429 |
| `deactivate` | `customers.delete` | `ACTIVE → PASSIVE`; bağlantı 404, kayıtlar geçersiz (`CUSTOMER_PASSIVE`), bekleyen talepler `CANCELLED(CUSTOMER_PASSIVE)`. Kalıcı silme yoktur | 404, 409 (zaten pasif), 429      |
| `reactivate` | `customers.edit`   | **Yeni** ref üretilir; eski ref ve kayıtlar geçersiz kalır                                                                                     | 404, 409 (zaten aktif), 429      |

### GET /api/v1/customers/:id/requests · GET /api/v1/customers/:id/sessions

`?page=&pageSize=` (varsayılan 25, en çok 100), yeniden eskiye. `requests` → `{ items: SupportRequestItem[], page,
pageSize, total }`, yetki `customers.view` + `support_requests.view`. `sessions` → `{ items: SessionListItem[], … }`,
yetki `customers.view` + `session_history.view` (USER yalnız kendi oturumlarını görür). Hatalar: 403, 404.

### Mevcut uçlara eklenenler

- `GET /support-requests?customer=general|<müşteri id>` (kuyruk ve geçmiş). `SupportRequestItem` += `customerFirm:
CustomerFirmRef|null`, `viaBinding` (kayıtla açıldı ve kayıt hâlâ etkin → "Kayıtlı bilgisayar — <firma|Genel>"),
  `bindingRevoked` (kayıtla açıldı, kayıt artık geçersiz → "Kaydı iptal edilmiş bilgisayar"), `staleSource` ("Bu talep
  bağlantı yenilenmeden önce açıldı"; kabul edilse de kayıt verilmez).
- İptal nedenleri += `CUSTOMER_PASSIVE` ("Müşteri pasife alındı"), `BINDING_REVOKED` ("Bilgisayar kaydı iptal edildi").
  `/ws/request` bu iki nedeni 0.10.0 altındaki istemciye `TENANT_PASSIVE` olarak iletir.
- `/ws/panel` `request.new` += `customerFirm: {id, name}|null`, `viaBinding`, `bindingRevoked`; toast "Yeni destek
  talebi: <ad> — <firma | Genel>".
- `POST /sessions` gövdesi `{ "customerId": "01K…" }` (isteğe bağlı, ULID). Verilirse `customers.view` gerekir (yoksa 403) ve müşteri aynı tenant'ta **aktif** olmalı (yoksa 404). Oturum yanıtları ve geçmiş += `customerFirm`. Talep kabulü
  talebin müşterisini oturuma kopyalar.
- `GET /sessions` ve `export.csv` += `customer=none|<id>`; CSV'de `Kaynak`'tan sonra "Müşteri firma" sütunu.
- `GET/PUT /settings/support-requests`: bağlantı arayüzde "Genel bağlantı" adını aldı; `rotate-ref` artık Genel kayıtlı
  bilgisayarları da geçersiz kılar (`GENERAL_ROTATED`).

### POST /api/v1/support-requests/:id/revoke-binding

Talebi açan bilgisayarın kaydını iptal eder. Yetki `support_requests.view` **ve** `customers.edit`, `Origin` + CSRF.
Kayıt talebin kendisinden bulunur (istemciden kayıt kimliği alınmaz). Gövde `{}` → 204. Aynı kaydın bekleyen talepleri
`CANCELLED(BINDING_REVOKED)` olur; müşterinin diğer bilgisayarları ve dosyası etkilenmez. Hatalar: 403, 404 (talep yok,
başka tenant, kayıtla açılmamış), 409 `CONFLICT` (kayıt zaten geçersiz), 429.

### Public uçlarda değişenler (istemci; çerezsiz, `Origin`/`Sec-Fetch-*` olmamalı)

- `GET /public/requests/tenant?ref=` ve `GET /public/agent/request-download?ref=` müşteri ref'ini de kabul eder. Yanıt
  şekli aynıdır (müşteri bilgisi dönmez); indirme `NoktaDestek-<müşteri etiketi>-<ref>.exe`'ye yönlendirir. Yok,
  yenilenmiş, pasif müşteri, pasif tenant → aynı 404 `REQUEST_REF_INVALID`.
- `POST /public/requests`: `ref` artık isteğe bağlıdır; **`ref` veya `bindingKey`'den tam biri** dolu olmalı (ikisi
  birden ya da hiçbiri → 400). Kayıtla talep:

```json
{ "bindingKey": "rsb_<43 karakter>", "clientInstanceId": "AbCdEfGhIjKlMnOpQrStUv", "clientVersion": "0.10.0",
  "customerName": "Ayşe Yılmaz", "phone": "0532 000 00 00", "description": "Yazıcı çıktı vermiyor",
  "consentTextId": "01K…", "consentAccepted": true }
```

Ek hatalar: 404 `BINDING_INVALID` (biçim dışı, yok, unutulmuş, değiştirilmiş, müşteri yenilendi/pasif, Genel
yenilendi, tenant pasif, süresi doldu — tek gövde), 409 `REQUEST_PENDING` (kayıt başına 1 bekleyen), 429 (kayıt başına
saatte 6; E9 IP/ağ/firma sınırlarına ek).

### POST /api/v1/public/bindings/status

Gövde `{ "bindingKey": "rsb_…", "clientVersion": "0.10.0" }` (ikisi de zorunlu; `clientVersion` yoksa 400
`VALIDATION`). 200 (`no-store`): `TenantRequestInfo` + `customer`:

```json
{ "tenant": { "name": "Örnek Destek Ltd", "logoUrl": "/img/logo.png" },
  "consentText": { "id": "01K…", "version": 4, "body": "…", "sha256": "…" },
  "waitMinutes": 30, "abuseEmail": null, "minAgentVersion": null,
  "customer": { "name": "Örnek Muhasebe Ltd." } }
```

`customer` Genel kayıtta `null`. `tenant.logoUrl` P12 logo zincirini izler (yukarıdaki örnekte firma ve sistem logosu yok).
Kaydın son kullanım zamanını değiştirmez. Hatalar: 404 `BINDING_INVALID`, 426
`CLIENT_OUTDATED`, 429.

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"bindingKey":"rsb_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","clientVersion":"0.10.0"}' \
  https://remote.noktabilisim.net/api/v1/public/bindings/status      # 404 BINDING_INVALID
```

### POST /api/v1/public/bindings/revoke

Gövde `{ "bindingKey": "rsb_…" }` → **her durumda** 204 (anahtarın geçerli olup olmadığı sızdırılmaz). İstemcinin
"Bu bilgisayarı unut" düğmesi çağırır (`FORGOTTEN`). Hatalar: 403 `CSRF_INVALID`, 429.

`bindingKey` yalnız istek gövdesinde taşınır (URL'de asla) ve yalnız talep açar: resolve, join, `/ws/guest`,
`/ws/request` ve TURN uçlarında kimlik olarak kabul edilmez.

### WebSocket `/ws/guest` — kayıt mesajları

Yeni WS ucu yok; mevcut misafir soketi kullanılır, `hello` şeması değişmedi.

| `t`               | Yön         | Alanlar                                                                               | Davranış                                                                                                                                                                                                                                                        |
| ----------------- | ----------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `binding.offer`   | S → misafir | —                                                                                     | Misafir kabul edilip `hello` gönderildikten hemen sonra; yalnız Windows istemcisine ve ticket'taki `clientVersion ≥ 0.10.0` ise. Yeniden bağlanmada tekrar gönderilir. 0.9.x hiç almaz                                                                          |
| `binding.request` | misafir → S | `id?`, `previousKey?` (`rsb_…`, yalnız kayıt aynı sunucudansa)                        | Teklif alındıktan sonra bir kez. Ret: kabul edilmemiş misafir → kapanış 1008; tarayıcı → `error{FORBIDDEN}`; teklifsiz, oturum aktif değil, tenant/müşteri pasif veya bayat kaynak → `error{CONFLICT}`; oturum başına 3. istekten sonra → `error{RATE_LIMITED}` |
| `binding.issued`  | S → misafir | `bindingKey`, `tenantName` (≤ 120), `customerFirmName` (≤ 100 veya `null`), `renewed` | Yalnız isteyen sokete. `previousKey` geçerliyse eski anahtar ölür (rotasyon). Anahtar başka mesaj, log veya audit'te yer almaz                                                                                                                                  |

İstemci `error` yanıtında oturuma devam eder, kayıt yazmaz.

### Çoklu firma kaydı (P20)

Bir bilgisayar aynı sunucuda en çok **5** firmaya kayıtlı olabilir (`BINDING_MAX_PER_DEVICE = 5`). Ek alanlar yalnız
`clientVersion ≥ 0.12.0` (`BINDING_MULTI_MIN_VERSION`) Windows istemcisine açılır; 0.10/0.11 eski tek kayıt dalını (`previousKey`)
aynen kullanır. Bağlayıcı sözleşme `docs/mimari-protokol.md` §6.1, `docs/mimari-e11.md` §8d.2.

| `t` / alan                     | Yön         | Tip                                                     | Kural                                                                                                                                                     |
| ------------------------------ | ----------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `binding.offer.multi`          | S → misafir | `true` (isteğe bağlı)                                   | Yalnız ticket `clientVersion ≥ 0.12.0` ise eklenir (≤ 0.11.x sıkı ayrıştırıcısı bilinmeyen alanı reddeder). Bağlantı başına saklanır                      |
| `binding.request.previousKeys` | misafir → S | `bindingKey[]`, 1..5, benzersiz                         | Bilgisayardaki bu sunucuya ait bütün anahtarlar. Biçim dışı (boş, > 5, yinelenen) → kapanış 1008. `multi` teklifi almamış bağlantıdan → `error{CONFLICT}` |
| `binding.request.full`         | misafir → S | `true` (isteğe bağlı)                                   | Bu sunucuda 5 kayıt dolu. `false` değeri biçim dışıdır (1008)                                                                                             |
| `previousKey` + `previousKeys` | misafir → S | —                                                       | Birlikte gönderilemez → `error{VALIDATION}` ("previousKey ve previousKeys birlikte gönderilemez"); kabul edilmiş misafirde soket açık kalır               |
| `binding.issued.previousIndex` | S → misafir | `0..4` veya `null`                                      | Yalnız `previousKeys`'li isteğe eklenir: yenilenen anahtarın listedeki sırası; yeni kayıtta `null`. Eski isteğe alan hiç gelmez                           |
| `error{BINDING_LIMIT}`         | S → misafir | mesaj "Bu bilgisayar en çok 5 firmaya kayıtlı olabilir" | Yalnız `full: true` isteğe, oturumun firmasıyla eşleşen kayıt yoksa. Oturum sürer; istemci kendi bilgi cümlesini gösterir                                 |

**Sunucu kuralı (çoklu dal):** yalnız **oturumun firmasına** ait, iptal edilmemiş satırlar `previousKeys` özetleriyle aranır ve
kilitlenir; başka firmanın satırı sorguya girmez, hiçbir zaman yenilenmez ya da iptal edilmez. Eşleşen en son kullanılan satır
yenilenir (`renewed: true`), aynı firmanın fazla satırları `REPLACED` ile iptal edilir (audit `binding.revoked`). Eşleşme yoksa:
`full` → `BINDING_LIMIT` (audit `binding.denied {reason:"capacity"}`, metrik `rs_binding_denied_total{reason="capacity"}`);
değilse yeni satır. Audit `binding.issued.newValue.multi = true`; `replacedOtherTenant` çoklu dalda hep `false`. Oturum başına
3 istek sınırı değişmedi. `*.previousKeys` logda maskelenir.

Örnek (0.12.0 istemci, iki kayıtlı firma, ikincisi bu oturumun firması):

```json
{ "t": "binding.offer", "multi": true }
{ "t": "binding.request", "previousKeys": ["rsb_<43 karakter>", "rsb_<43 karakter>"] }
{ "t": "binding.issued", "bindingKey": "rsb_<43 karakter>", "tenantName": "Acme", "customerFirmName": null, "renewed": true, "previousIndex": 1 }
```

Sınır dolu ve oturumun firması kayıtlı değil:

```json
{ "t": "binding.request", "previousKeys": ["rsb_…", "rsb_…", "rsb_…", "rsb_…", "rsb_…"], "full": true }
{ "t": "error", "code": "BINDING_LIMIT", "message": "Bu bilgisayar en çok 5 firmaya kayıtlı olabilir" }
```

Kimliksiz uçlar (`POST /public/bindings/status`, `/revoke`) değişmedi: istemci her firmayı kendi anahtarıyla ayrı sorar ve
iptal eder. Metrikler: `rs_bindings_issued_total{renewed,multi}` (eski dalda `multi="false"`),
`rs_binding_denied_total{reason="capacity"|"no_multi"}`, `rs_request_messages_rejected_total{reason="validation"}` (`/ws/request`
sohbet gövdesi reddi).

### Hız sınırları (P8c ekleri)

| Kova                  | Anahtar   | Sınır             | Uç                                                                |
| --------------------- | --------- | ----------------- | ----------------------------------------------------------------- |
| Geçersiz ref (mevcut) | IP        | 10/dk             | + geçersiz kayıt (`bindings/status`, kayıtla talep)               |
| Kayıt durumu          | IP        | 60/dk             | `POST /public/bindings/status`                                    |
| Kayıt iptali          | IP        | 30/dk             | `POST /public/bindings/revoke`                                    |
| Kayıtla talep         | Kayıt     | 6/sa + 1 bekleyen | `POST /public/requests` (`bindingKey`)                            |
| Kayıt verme           | Oturum    | 3 istek           | WS `binding.request`                                              |
| Müşteri yazma         | Kullanıcı | 30/dk             | Müşteri POST/PATCH/rotate/deactivate/reactivate, `revoke-binding` |

## Kullanıcılar, firmalar ve tenant ayarları (P9)

Bağlayıcı sözleşme: `docs/mimari-api.md` "Yönetim" ve "backend-dev sapma notu (P9)". Kaynak: `apps/server/src/users/*`,
`tenants/*`; şemalar `packages/contracts/src/api/{users,tenants}.ts` (tümü `strictObject`, bilinmeyen alan → 400).
Tüm yanıtlar `Cache-Control: no-store`. Biçimsiz `:id` (ULID değil) → 404.

**Kapsam kuralları**

- `/users` ve `/settings/tenant` etkin firmada çalışır (`tenantScope`). Super Admin firma seçmeden çağırırsa 403 "Önce bir
  firma seçin." Başka firmanın kullanıcısı → 404.
- Super Admin hesapları `/users` listesinde hiç dönmez, `/users/:id` ile 404 alır; bu uçlarla oluşturulamaz, düzenlenemez.
- `/admin/*` rol kontrolüdür (toggle değil): SUPER_ADMIN dışı her rol → 403.
- Kalıcı silme yoktur. `users.delete` anahtarı tanımda var ama hiçbir ucu korumaz; pasife alma `users.edit` ile yapılır.

**Yetki kuralları (AC-73)**

- Etkin yetki = rol varsayılanı (ADMIN tümü açık, USER tümü kapalı; SUPER_ADMIN tümü, rolüyle) + kullanıcı bazlı ezmeler.
- Etkin kümede değişen her anahtar işlemi yapanda olmalıdır. Yoksa 403, `fields["permissions.<anahtar>"]` = "Bu yetkiye
  sahip değilsiniz". ADMIN rolü varsayılanı da "verme" sayılır: Admin'de olmayan anahtar oluşturmada açıkça `false` gönderilir.
- Admin, etkin yetkileri kendi kümesini aşan hesabı yönetemez (`canManage=false` → PATCH/deactivate/reactivate 403).
- Kimse kendi rolünü/yetkilerini değiştiremez ve kendini pasife alamaz (403).
- Rol değiştiren PATCH'te gövdede olmayan ve ezmesi olmayan anahtar **yeni rolün** varsayılanını alır. Kilitli anahtarın
  değeri korunsun diye istemci rol değişiminde tüm anahtarları gönderir.

**Canlı etkiler (AC-115, commit sonrası)**

- Pasife alma veya rol değişimi → kullanıcının tüm destek oturumları sonlanır, panel bildirim soketleri kapanır,
  pasif kullanıcının oturum çerezleri iptal edilir.
- Yalnız yetki değişimi → açık oturumlara `caps.update`; `support_requests.view` kalktıysa panel soketi 4401.
- Bu adım hata verirse log `user_live_effect`; 60 sn'lik yeniden doğrulama devralır (runbook §14.3).

**Tipler.** `UserListItem = { id, email, username|null, fullName, role: "ADMIN"|"USER", status: "ACTIVE"|"PASSIVE",
mustChangePassword, totpEnabled, lastLoginAt|null, createdAt, avatarUrl|null }` (`lastLoginAt: null` "hiç giriş yapmadı"
demek değildir; `avatarUrl` P12, yoksa baş harf rozeti).
`UserDetail = UserListItem + { permissions: { "<modül>.<eylem>": bool } (tanımdaki her anahtar), isSelf, canManage }`.
`TenantItem = { id, name, slug, status, activeUserCount, createdAt, updatedAt }`.

### GET /api/v1/users?q=&role=all|ADMIN|USER&status=active|passive|all&sort=&page=&pageSize=

Yetki `users.view`. `q` 2–100 karakter (ad soyad veya e-postada arar), `status` varsayılan `active`, `sort`
`fullName:asc` (varsayılan) | `createdAt:desc`, `pageSize` varsayılan 25 (en çok 100).

```json
{ "items": [ { "id": "01K…", "email": "ayse@example.com", "username": null, "fullName": "Ayşe Yılmaz", "role": "USER",
  "status": "ACTIVE", "mustChangePassword": true, "totpEnabled": false, "lastLoginAt": null, "createdAt": "…" } ],
  "page": 1, "pageSize": 25, "total": 1 }
```

Hatalar: 400 `VALIDATION`, 403.

### POST /api/v1/users

Yetki `users.create`. Kullanıcı etkin firmada oluşur.

```json
{ "email": "ayse@example.com", "fullName": "Ayşe Yılmaz", "role": "USER",
  "permissions": { "sessions.view": true, "sessions.create": true } }
```

`email` küçük harfe çevrilir, ≤ 190 ve tüm sistemde tekil. `fullName` 2–100 karakter, kontrol/görünmez karakter yok.
`permissions` verilmezse rol varsayılanı. 201:

```json
{ "user": { "id": "01K…", "role": "USER", "mustChangePassword": true, "permissions": { "sessions.view": true, "…": false },
  "isSelf": false, "canManage": true, "…": "…" }, "temporaryPassword": "<16 karakter>" }
```

Geçici şifre (16 karakter, argon2id ile saklanır) **yalnız bu yanıtta** döner; ilk girişte değiştirilmesi zorunludur.
Hatalar: 400 (`fields.*`, tanımsız anahtar `fields["permissions.<anahtar>"]`), 403 (yetki yok / AC-73), 409 `CONFLICT`
`fields.email` "Bu e-posta adresi başka bir hesapta kullanılıyor".

### GET /api/v1/users/:id · PATCH /api/v1/users/:id

GET (`users.view`) → `UserDetail`. PATCH (`users.edit`): `email`, `fullName`, `role`, `permissions` alanlarından en az biri;
`permissions` kısmi olabilir (verilmeyen anahtar değişmez). Yanıt güncel `UserDetail`.

```json
{ "role": "ADMIN", "permissions": { "audit.export": false } }
```

Hatalar: 400, 403 ("Sizden daha geniş yetkili bir hesabı düzenleyemezsiniz.", "Kendi rolünüzü veya yetkilerinizi
değiştiremezsiniz.", AC-73 `fields["permissions.<anahtar>"]`), 404, 409 `fields.email`.

### POST /api/v1/users/:id/deactivate · /reactivate

Yetki `users.edit`, gövde `{}` veya boş → 204. Pasif kullanıcı giriş yapamaz; yeniden etkinleştirmede rolü ve yetkileri
önceki gibi kalır. Hatalar: 403 (kendi hesabı, daha geniş yetkili hesap), 404, 409 ("Kullanıcı zaten pasif." / "…aktif.").

### GET / PUT /api/v1/settings/tenant

GET `settings.view`, PUT `settings.edit`. Etkin firmanın genel ayarları. Web ekranları: Ayarlar > E-posta (SMTP), Ayarlar > Güvenlik
(`requireTech2fa`; P13a'dan itibaren "Veri saklama" bölümünde `retentionDays`). Diğer alanların ekranı henüz yok:

```json
{ "sessionTtlMin": 15, "maxOpenSessions": 3, "maxActiveHours": 4, "maxFileMb": 100, "retentionDays": 365,
  "requireTech2fa": true,
  "smtp": { "host": "smtp.example.com", "port": 587, "security": "STARTTLS", "user": "bildirim@example.com",
            "fromName": "Örnek Destek", "fromEmail": "bildirim@example.com", "hasPassword": true },
  "logoUrl": null }
```

`logoUrl` (P12, salt okunur): yalnız firmanın **kendi** yüklediği logo; yoksa `null` (sistem logosuna düşüş burada yapılmaz).
Değiştirmek için `POST/DELETE /settings/logo`.

| Alan                   | Anlamı                                                              | Aralık                            |
| ---------------------- | ------------------------------------------------------------------- | --------------------------------- |
| `sessionTtlMin`        | Oturum linki/kodu geçerlilik süresi (dk)                            | 15–30                             |
| `maxOpenSessions`      | Teknisyen başına bekleyen oturum sınırı                             | 1–10                              |
| `maxActiveHours`       | Etkin oturumun en uzun süresi (saat)                                | 1–8                               |
| `maxFileMb`            | Dosya transferi üst sınırı (MB)                                     | 1–2048                            |
| `retentionDays`        | Oturum kayıtlarının saklama süresi (gün)                            | 90–730                            |
| `requireTech2fa` (P10) | User rolü için 2FA zorunlu mu (Admin/Super Admin her zaman zorunlu) | `true`/`false`, varsayılan `true` |
| `smtp` (P10)           | Firma SMTP ayarı; yoksa `null`                                      | aşağıda                           |

**`smtp` nesnesi (PUT).** `{ host, port, security, user?, password?, fromName?, fromEmail }`; `smtp: null` ayarı tamamen
kaldırır.

- `host`: ad, IPv4 veya köşeli parantezli IPv6 (IDN punycode'a çevrilir), ≤ 253. Kayıtta ve her gönderimde çözülür;
  özel/iç ağ/loopback/link-local/CGNAT/Docker, IPv6'da 2000::/3 dışı (ve Teredo, 6to4, belgeleme aralıkları) veya
  `PUBLIC_BASE_URL`'in kendi adresi → 400 `HOST_NOT_ALLOWED`.
- `port`: yalnız 25, 465, 587, 2525 (aksi 400 `fields["smtp.port"]` "Port 25, 465, 587 veya 2525 olmalı"). Önerilen:
  `NONE` 25, `SSL` 465, `STARTTLS` 587.
- `security`: `NONE` | `SSL` | `STARTTLS`. `NONE` iken `user`/`password` verilirse 400 `fields["smtp.security"]` "Kullanıcı
  adı/şifre için SSL veya STARTTLS seçin (şifresiz bağlantıda kimlik bilgisi açık gider)". TLS'te sertifika adı doğrulanır.
- `password` (≤ 200): boş veya verilmemiş → kayıtlı şifre korunur; `user` boşsa şifre de silinir; şifre `user` olmadan
  verilemez (`fields["smtp.user"]`). AES-256-GCM ile saklanır, GET'te asla dönmez (yalnız `hasPassword`); audit'te `***`.
- `fromEmail` zorunlu (≤ 190), `fromName` ≤ 100, kontrol karakteri yok.

PUT gövdesi kısmidir (en az bir alan; ör. `{ "requireTech2fa": false }`). Aralık dışı → 400 `fields.<alan>` "… arası olmalı" (AC-4). Yanıt güncel ayarlar;
yalnız değişen alanlar audit'e eski → yeni yazılır. Hatalar: 400, 403.

### GET /api/v1/admin/tenants?q=&status=active|passive|all&page=&pageSize= · POST /api/v1/admin/tenants

GET: `q` ad veya kısa adda arar, `status` varsayılan `all`, ada göre, `pageSize` varsayılan 25 (en çok 100) →
`{ items: TenantItem[], page, pageSize, total }`.
POST gövdesi `{ "name": "Örnek Bilişim Ltd.", "slug": "ornek-bilisim" }`. `name` 2–120 karakter; `slug` 2–60, yalnız küçük
harf, rakam ve tek tire. 201 `TenantItem`. Firma ayarları ve sistem aydınlatma metni v1 aynı işlemde oluşur; ilk Admin,
Super Admin firmaya geçip `POST /users` ile ekler. Oluşturmadan önce firma doğrulaması: runbook §14.1.
Hatalar: 400, 403, 409 `fields.slug` "Bu kısa ad başka bir firmada kullanılıyor".

### GET /api/v1/admin/tenants/:id · PATCH /api/v1/admin/tenants/:id

GET → `TenantItem`. PATCH `{ name?, slug? }` (en az biri) → `TenantItem`. Kısa ad değişirse eski giriş bağlantıları
çalışmaz. Hatalar: 400, 403, 404, 409 `fields.slug`.

### POST /api/v1/admin/tenants/:id/deactivate · /reactivate

Gövde `{}` → güncel `TenantItem`.

| Uç           | Etkisi                                                                                                                                                                                                                                                                         | Hatalar                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `deactivate` | Tek işlemde: durum PASSIVE, firmanın kullanıcı oturumları iptal, bekleyen kod oturumları `CANCELLED(tenant_passive)`, audit. Sonra etkin oturumlar `session.ended{tenant_passive}`, panel soketleri kapanır, bekleyen talepler `TENANT_PASSIVE`, bilgisayar kayıtları geçersiz | 404, 409 "Firma zaten pasif." |
| `reactivate` | Durum ACTIVE; kullanıcılar yeniden giriş yapabilir. İptal edilen talep ve kayıtlar geri gelmez                                                                                                                                                                                 | 404, 409 "Firma zaten aktif." |

### POST /api/v1/admin/switch-tenant

Gövde `{ "tenantId": "01K…" }` (firmaya geç) veya `{ "tenantId": null }` (bağlamdan çık). Yanıt:

```json
{ "actingTenant": { "id": "01K…", "name": "Örnek Bilişim Ltd.", "slug": "ornek-bilisim" } }
```

Bağlam mevcut oturuma yazılır; değişiklik varsa audit `tenant.switched` ve bu oturumun `/ws/panel` soketleri 4401 ile
kapanır (istemci yeni bağlamla yeniden bağlanır, `/auth/me` yeniden okunur). Aynı firmaya tekrar geçiş yazma yapmaz.
Hatalar: 400, 403 (SUPER_ADMIN değil), 404 (firma yok veya pasif).

## E-posta (SMTP) ve hesap yönetimi uçları (P10)

### POST /api/v1/settings/smtp/test

Yetki `settings.edit`, firma bağlamı (Super Admin firma seçmeli). Gövde `{ "to": "admin@example.com" }`. **Kayıtlı** ayarla
test e-postası gönderir (formdaki kaydedilmemiş değerle değil).

```bash
curl -sk -X POST https://localhost:4450/api/v1/settings/smtp/test \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF" -d '{"to":"admin@example.com"}'
```

```json
{ "ok": true, "message": "Test e-postası gönderildi." }
```

Hatalar: 400 (`fields.to`, `HOST_NOT_ALLOWED`), 403, 429 (firma başına 5/dk, e-posta kanal testiyle ortak), 502 `UPSTREAM`
("Önce SMTP ayarlarını yapın" veya tek genel gönderim mesajı).

**Gönderim kuralları (tüm e-postalar).** Bağlantı netguard'ın onayladığı IP'ye yapılır, TLS'te SNI ve sertifika adı
asıl sunucu adıyla doğrulanır; port gönderimde de denetlenir. Etkileşimli gönderimler (SMTP testi, e-posta kanal testi,
oturum linki) tek deneme yapar, deneme başına en çok 12 sn; başarısızlık yanıtı da **en az 12 sn** sonra döner (hata türü
süreden anlaşılmasın). Arka plan gönderimleri (bildirimler) 10 sn zaman aşımı + 1 yeniden deneme. Hata sınıfı (`connect`,
`tls`, `auth`, `rejected`, `port_not_allowed`, `insecure_auth`) yalnız server logu (`event:"smtp_send_failed"`) ve audit
`reason` alanındadır; metrik `rs_mail_total{kind,result}`.

### POST /api/v1/sessions/:id/email (AC-10)

Panel artık bu uç yerine `POST /api/v1/customer-send` (`SESSION`, `EMAIL`) kullanır; uç ve kuralları aynen geçerlidir.
Yetki `sessions.create`; yalnız oturumun kendi teknisyeni. Gövde `{ "to": "musteri@example.com", "link": "<oluşturma
yanıtındaki link>" }` → `{ "sent": true }`. Düz token sunucuda tutulmadığı için bağlantı istemciden gelir; sunucu
`${PUBLIC_BASE_URL}/session/<token>` biçimini ve token'ın bu oturuma ait olduğunu doğrular (başka adres gönderilemez).
E-posta: teknisyen adı, firma, bağlantı, 8 haneli kod, son geçerlilik (Türkiye saati), logo; ikili kapısı açıksa Windows
programı bağlantısı, "Destek-" dosya adı biçimi ve SHA-256 (LG AC-412).
Hatalar: 400 (`fields.to`; `fields.link` "Bağlantı bu oturuma ait değil."), 404 (başkasının oturumu), 409 "Yalnız bekleyen
oturumun bağlantısı gönderilebilir.", 429 (teknisyen başına saatte 20; `Retry-After`), 502 (SMTP yok / gönderim hatası).

### POST /api/v1/users/:id/reset-mfa

Yetki `users.edit`. Gövde `{}` → 204. Tek işlemde kullanıcının 2FA sırrı ve kurtarma kodları silinir, oturumları iptal
edilir; ardından açık destek oturumları 5 sn içinde sonlanır. Kullanıcı sonraki girişte (2FA zorunluysa) yeniden kurar.
Hatalar: 403 "Kendi iki adımlı doğrulamanızı sıfırlayamazsınız." / "Sizden daha geniş yetkili bir hesabı yönetemezsiniz.",
404, 409 "Bu kullanıcıda iki adımlı doğrulama kurulu değil.".

## Audit ekranı, sistem ayarları ve aydınlatma metni (P11)

Bağlayıcı sözleşme: `docs/mimari-api.md` "Yönetim" ve "backend-dev sapma notu (P11)". Kaynak: `apps/server/src/audit/{routes,read,repo,view}.ts`,
`settings/{routes,system,consent,mysql-probe}.ts`, `public/consent.ts`; şemalar `packages/contracts/src/api/{audit,system-settings}.ts`
(tümü `strictObject`, bilinmeyen alan → 400). Tüm yanıtlar `Cache-Control: no-store`. Yeni hata kodu `METHOD_NOT_ALLOWED` (405).

| Metot                       | Yol                                                              | Yetki                                         | Başarı           |
| --------------------------- | ---------------------------------------------------------------- | --------------------------------------------- | ---------------- |
| GET                         | `/api/v1/audit`                                                  | Oturum, `audit.view`                          | 200              |
| GET                         | `/api/v1/audit/export.csv`                                       | Oturum, `audit.export`                        | 200 (`text/csv`) |
| POST · PUT · PATCH · DELETE | `/api/v1/audit`, `/api/v1/audit/export.csv`, `/api/v1/audit/:id` | — (her zaman ret)                             | 405              |
| GET · PUT                   | `/api/v1/admin/settings/mysql`                                   | Oturum (+ CSRF), yalnız SUPER_ADMIN           | 200              |
| POST                        | `/api/v1/admin/settings/mysql/test`                              | Oturum + CSRF, yalnız SUPER_ADMIN             | 200              |
| GET · PUT · DELETE          | `/api/v1/admin/settings/turn`                                    | Oturum (+ CSRF), yalnız SUPER_ADMIN           | 200              |
| GET                         | `/api/v1/settings/consent-text`                                  | Oturum, `settings.view`, firma bağlamı        | 200              |
| PUT                         | `/api/v1/settings/consent-text`                                  | Oturum + CSRF, `settings.edit`, firma bağlamı | 200              |

### GET /api/v1/audit?from=&to=&tenantId=&userId=&action=&result=&cursor=

Yetki `audit.view` (Admin'de varsayılan açık, User'da kapalı). Salt okunur liste; sıralama `created_at desc, id desc`,
sayfa 50 kayıt, **keyset** imleçle (toplam sayı dönmez).

| Parametre    | Kural                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `from`, `to` | `YYYY-MM-DD`, Türkiye günü (`to` dahil). `from` yoksa `to`'dan (yoksa bugünden) geriye 30 gün. `from > to` → 400 `fields.to`; aralık > 731 gün → 400 `fields.from` |
| `userId`     | ULID                                                                                                                                                               |
| `action`     | Tam ad (`auth.login`) veya grup öneki (`auth.*`); küçük harf, rakam, `_`, nokta; ≤ 60                                                                              |
| `result`     | `success` \| `fail`                                                                                                                                                |
| `tenantId`   | Yalnız **firma seçmemiş Super Admin**'de uygulanır; diğerlerinde yok sayılır                                                                                       |
| `cursor`     | Önceki yanıtın `nextCursor`'ı (opak). Biçim dışı veya taşan değer → 400 `fields.cursor`                                                                            |

**Kapsam:** Admin/User ve firmaya geçmiş Super Admin yalnız etkin firmanın kayıtlarını görür. Firma seçmemiş Super Admin
tüm firmaları ve sistem kayıtlarını (`tenantId: null`; ör. sistem ayarı değişiklikleri) görür.

**Okuma maskesi:** `oldValue`/`newValue` okunurken yeniden maskelenir (şifre, token, anahtar → `***`). Dış gönderim ve test
kayıtlarında (`mail.*`, `session.email`, `settings.*.test`, adında `smtp` geçenler) yalnız izinli alanlar döner (`kind,
recipient, subject, result, reason, channel, latencyMs, host, port, database, user`); `reason` yalnız `[a-z_]{1,40}`
biçiminde bir sınıfsa gösterilir, değilse `"other"`. Ham hata metni, SMTP yanıt kodu ve sunucu banner'ı hiç dönmez.

```bash
curl -sk "https://localhost:4450/api/v1/audit?from=2026-11-01&to=2026-11-13&action=auth.*&result=fail" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF"
```

```json
{ "items": [ { "id": "1842", "createdAt": "2026-11-12T08:14:03.120Z", "tenantId": "01K…", "tenantName": "Örnek Bilişim Ltd.",
    "userId": "01K…", "username": "ayse@example.com", "userFullName": "Ayşe Yılmaz", "avatarUrl": null,
    "action": "auth.login", "entity": "users", "entityId": "01K…", "oldValue": null, "newValue": null,
    "ipAddress": "203.0.113.10", "userAgent": "Mozilla/5.0 …", "result": "fail" } ],
  "nextCursor": "MTg0Mi0xNzYy…" }
```

`id` BIGINT olduğu için dizedir. `avatarUrl` P12'ye kadar `null`. Son sayfada `nextCursor: null`.
P13a: müşteri kaynaklı kayıtlarda (`username: "customer"`) `ipAddress` tam IP değil ağ önekidir (`203.0.113.0/24`,
`2001:db8:1234::/48`), `userAgent` `null`'dır. Grup filtresi `action=retention.*` "Saklama süresi işi" kayıtlarını getirir.
Hatalar: 400 `VALIDATION`, 401, 403 (yetki yok).

### GET /api/v1/audit/export.csv

Yetki `audit.export`. Aynı filtreler (`cursor` yok sayılır). Kullanıcı başına dakikada 5 (6. istek 429 + `Retry-After`).
Filtreye uyan kayıt 50.000'i aşarsa 400 `fields.to` "En çok 50.000 satır dışa aktarılabilir; tarih aralığını daraltın"
(dosya hiç başlamaz, yarım dosya oluşmaz).

- Yanıt: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="audit-YYYYMMDD-HHMM.csv"`
  (Türkiye saati), UTF-8 BOM, ayraç `;`, Excel'de doğrudan açılır.
- Sütunlar: Tarih, (firma seçmemiş Super Admin'de) Firma, Kullanıcı, Ad Soyad, İşlem, Varlık, Kayıt, Sonuç, IP adresi,
  Tarayıcı, Eski değer, Yeni değer (JSON). `= + - @` TAB/CR ile başlayan hücrelerin önüne `'` eklenir (AC-124).
- Her dışa aktarma `audit.exported` olarak yazılır (filtre özeti ve satır sayısı).

```bash
curl -sk -OJ "https://localhost:4450/api/v1/audit/export.csv?from=2026-11-01&to=2026-11-13" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF"
```

Hatalar: 400, 401, 403, 429.

### POST / PUT / PATCH / DELETE /api/v1/audit… → 405

Audit kayıtları değiştirilemez ve silinemez (AC-76). `/audit` ve `/audit/export.csv` için yazma metotları
`405 METHOD_NOT_ALLOWED` + `Allow: GET, HEAD`; `/audit/:id` için `Allow` boştur (tekil okuma ucu yok). Bu yanıt kimlik
doğrulama ve CSRF denetiminden önce, her durumda aynı döner; veri içermez.

```bash
curl -sk -i -X DELETE https://localhost:4450/api/v1/audit/1842
```

```json
{ "error": { "code": "METHOD_NOT_ALLOWED", "message": "Audit kayıtları salt okunurdur; değiştirilemez veya silinemez.", "requestId": "01K…" } }
```

Veritabanı düzeyinde de koruma vardır: `app` kullanıcısının `audit_logs` üzerinde UPDATE/DELETE yetkisi yoktur; tetikleyiciler
UPDATE'i ve 730 günden yeni kaydın silinmesini reddeder (`docs/db-notlari.md` "P11"). P13a'dan itibaren `app` kullanıcısı
yalnız 730 günden eski kayıtları silebilir (saklama işi); eklenen kaydın `created_at`'i her zaman veritabanı saatidir
(geri tarihli kayıt yazılamaz).

### GET / PUT /api/v1/admin/settings/mysql

Yalnız SUPER_ADMIN (rol; diğer roller 403). Sistem seviyesindeki MySQL bağlantı bilgisi (tek veritabanı, tüm firmalar).
**Kayıt çalışan bağlantıyı değiştirmez** (ADR-0003): uygulamak için sunucudaki `.env` (`DATABASE_URL`) güncellenip servis
yeniden başlatılır (runbook §15).

GET yanıtı (`MysqlSettingsView`); şifre hiçbir zaman dönmez:

```json
{ "host": "mysql", "port": 3306, "database": "remote", "user": "app", "hasPassword": true, "requireTls": false,
  "updatedAt": "2026-11-13T09:00:00.000Z", "source": "panel", "matchesRunning": true }
```

`source: "env"` → panelde kayıt yok; değerler çalışan `DATABASE_URL`'den türetilir. `matchesRunning: false` → kayıtlı
değerler çalışan bağlantıdan farklı.

PUT gövdesi `{ host, port, database, user, password?, requireTls? }` (P14a: PUT step-up ister, bkz. `POST /auth/step-up`):

| Alan         | Kural                                                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host`       | Ad, IPv4 veya köşeli parantezli IPv6 (SMTP host kuralı; iç ağ adresi **serbest**, DB iç ağda olabilir)                                                                              |
| `port`       | 1–65535, varsayılan 3306                                                                                                                                                            |
| `database`   | `[A-Za-z0-9_$-]{1,64}`                                                                                                                                                              |
| `user`       | 1–32, kontrol karakteri yok                                                                                                                                                         |
| `password`   | ≤ 200. Boş/verilmemiş → kayıtlı şifre korunur. AES-256-GCM ile, hedefe (host + port + kullanıcı) bağlı AAD altında saklanır                                                         |
| `requireTls` | P14a (AC-211): boolean, verilmezse `false`. Saklanır ve değişmeyen kayıt karşılaştırmasına girer; formun her PUT'ta açıkça göndermesi gerekir (yoksa kayıtlı `true` → `false` olur) |

Kayıtlı şifre varken host, port veya kullanıcı değişip `password` boşsa → 400 `fields.password` "Farklı sunucu veya
kullanıcı için şifreyi girin" (kayıtlı şifre yeni hedefe taşınmaz). Yanıt: GET görünümü + `{ "restartRequired": true,
"message": "Ayar kaydedildi. Uygulamak için sunucudaki .env (DATABASE_URL) güncellenip servis yeniden başlatılmalıdır." }`.
Audit `settings.mysql.updated` (eski → yeni; şifre yalnız `"changed"` işareti; değişmeyen PUT audit yazmaz). Hatalar: 400,
401 (`MFA_STEP_UP_REQUIRED` dahil), 403 (`MFA_SETUP_REQUIRED` dahil), 429.

### POST /api/v1/admin/settings/mysql/test

Yalnız SUPER_ADMIN. Gövde PUT ile aynı; **formdaki değerlerle** bağlanmayı dener, kaydetmez. En çok 10 sn (kesin zaman
aşımı). Şifre boşsa kayıtlı (panel ya da env) şifre **yalnız hedef host + port + kullanıcı o kaynakla aynıysa** kullanılır;
değilse 400 `fields.password`.

```bash
curl -sk -X POST https://localhost:4450/api/v1/admin/settings/mysql/test \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF" \
  -d '{"host":"mysql","port":3306,"database":"remote","user":"app"}'
```

```json
{ "ok": true, "message": "Bağlantı başarılı.", "latencyMs": 42 }
```

Bağlantı denendi ama başarısızsa yine **200** döner, `ok: false` ve `latencyMs: null` (süre zamanlama sinyali vermesin diye
yalnız başarıda döner). Mesajlar sınıflıdır:

| Sınıf               | `message`                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `connect`           | Sunucuya bağlanılamadı.                                                                     |
| `auth`              | Kimlik reddedildi (kullanıcı adı veya şifre hatalı).                                        |
| `database`          | Veritabanı bulunamadı veya bu kullanıcının erişimi yok.                                     |
| `timeout`           | Bağlantı 10 saniye içinde kurulamadı (zaman aşımı).                                         |
| `tls`               | Güvenli (TLS) bağlantı kurulamadı: sunucu TLS desteklemiyor veya sertifikası doğrulanamadı. |
| `secret_unreadable` | Kayıtlı şifre okunamadı; şifreyi yeniden girin.                                             |

Ham sürücü hatası yalnız server logunda (`event:"mysql_test_failed"` + `ref`). Her deneme audit `settings.mysql.test`
(hedef + sonuç + sınıf). Hız: kullanıcı başına 5/dk **ve** tüm Super Admin'ler için ortak 20/dk; aşımda 429 + `Retry-After`.
**TLS (P14a, AC-211):** test bağlantısı adı bir kez çözülen IP'ye yapılır (DNS rebinding yok). `requireTls: true` →
TLS zorunlu, sertifika doğrulanır ve ayar adına göre kimlik denetlenir; TLS kurulamazsa sınıf `tls`. `requireTls: false` →
TLS'siz bağlantı; sunucu açık anahtarının istenmesi (`allowPublicKeyRetrieval`) yalnız çözülen adres loopback veya özel
ağdaysa açılır. Başarısız testler `rs_mysql_test_failed_total{class: connect|auth|tls|timeout|other}` metriğinde sayılır
(alarm eşiği runbook §22). Test ucu step-up istemez. Hatalar: 400, 401, 403, 429.

### GET / PUT / DELETE /api/v1/admin/settings/turn

Yalnız SUPER_ADMIN. Destek oturumlarında istemcilere verilen TURN/STUN sunucuları. GET:

```json
{ "urls": ["turns:turn.example.com:5349?transport=tcp", "stun:turn.example.com:3478"], "hasSecret": true,
  "source": "panel", "updatedAt": "2026-11-13T09:05:00.000Z" }
```

`source: "env"` → panel kaydı yok, ortamdaki `TURN_URLS` / `TURN_SECRET` kullanılıyor.

PUT gövdesi `{ urls: string[], secret? }`:

- `urls`: 1–10 adres, her biri `stun:` / `turn:` / `turns:` ile başlar, boşluksuz yazdırılabilir ASCII, 6–255; tekrar yok.
- `secret`: coturn `static-auth-secret` ile **aynı** olmalı; 32–256 karakter, boşluk ve `#` içermeyen ASCII. Boş → kayıtlı
  korunur. `turn:`/`turns:` adresi varken kayıtlı veya yeni secret yoksa 400 `fields.secret` "turn:/turns: adresi için
  gizli anahtar gerekli". AES-256-GCM ile saklanır, hiç dönmez.

DELETE ("Ortam değerlerine dön"): panel kaydı kaldırılır, `.env` değerleri geri gelir; yanıt GET görünümü (`source: "env"`).
İdempotent (zaten env ise değişiklik ve audit yok). Değişiklik açık odalara bir sonraki kimlik yenilemesinde yansır.
Panel secret'ı çözülemezse istemcilere yalnız STUN verilir ve `system_secret_unreadable` alarmı loglanır (çözüm: secret'ı
yeniden girin veya DELETE). Audit `settings.turn.updated` / `settings.turn.deleted` (secret yalnız `"changed"`). Hatalar: 400, 401, 403.

### WhatsApp servisi (P12b): GET / PUT / DELETE /api/v1/admin/settings/whatsapp

Yalnız SUPER_ADMIN (Admin/User 403, oturumsuz 401, CSRF'siz yazma 403). Destek talebi bildirimlerinin ve WhatsApp
testlerinin gittiği whatsapp-bildirim servis adresi; tüm firmalar için tek adres. Yanıtlar `Cache-Control: no-store`.

**Etkin adres:** panel kaydı > `WHATSAPP_SERVICE_URL`. P13b'den beri yerleşik varsayılan adres yoktur; ikisi de boşsa
`url: null`, kanal kapalı. PUT/DELETE çalışan sürece hemen uygulanır (yeniden
başlatma yok); kayıttan sonraki ilk bildirim ve hem Super Admin hem firma testi yeni adrese gider.

GET yanıtı (`WhatsappSettingsView`):

```json
{ "url": "https://wa.example.com", "source": "panel", "insecure": false, "updatedAt": "2026-11-13T09:10:00.000Z",
  "apiKeySet": true, "apiKeySource": "panel" }
```

| Alan                  | Anlam                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                 | Etkin adres. Panel kaydı da env de yoksa `null`                                                                                                                                                                                             |
| `source`              | `panel` = bu ekrandan kaydedilmiş; `env` = panel kaydı yok, `WHATSAPP_SERVICE_URL` kullanılıyor (boşsa `url: null`). P13a'daki `default` değeri P13b'de kaldırıldı                                                                          |
| `insecure`            | `true` → kanal kapalı, bildirim ve test gönderilmez: production'da `http://` + özel ağ dışı adres ya da (her ortamda) ayrıştırılamayan adres. Ekran `WA_INSECURE_WARNING` ("Güvensiz adres: canlı ortamda WhatsApp kanalı kapalı") gösterir |
| `updatedAt`           | Panel kaydının son değişimi; env kaynağında `null`                                                                                                                                                                                          |
| `apiKeySet` (P13b)    | Etkin adrese gönderilecek servis anahtarı var mı. Anahtarın değeri hiçbir yanıtta dönmez                                                                                                                                                    |
| `apiKeySource` (P13b) | `panel`, `env` (`WHATSAPP_SERVICE_API_KEY`) ya da `null`. Anahtar adresiyle birlikte gelir: panel adresine yalnız panel anahtarı, env adresine yalnız env anahtarı gider; panelde adres var ama panel anahtarı yoksa `null`                 |

PUT gövdesi `{ "url": "…", "apiKey"?: … }` (`strictObject`; başka alan → 400).
**`apiKey` (P13b, S-P13b-3):** alan yok veya `""` → kayıtlı panel anahtarı korunur; `null` → panel anahtarı silinir; dolu →
yeni anahtar (16–256 kod noktası, boşluk ve kontrol karakteri yok; uymazsa 400, `fields.apiKey` = "Servis anahtarı 16–256
karakter olmalı; boşluk ve kontrol karakteri içeremez."). Anahtar AES-256-GCM ile, adresin kökenine (şema+host+port) bağlı
AAD ile saklanır ve servise `x-api-key` başlığıyla gider. **Köken değişirken anahtar verilmezse** 400 `VALIDATION`,
`fields.apiKey` = `WA_API_KEY_REENTER` ("Servis adresi değişti; servis anahtarını yeniden girin (ya da anahtarı kaldırın).");
kayıtlı anahtar yeni adrese taşınmaz. Aynı kökende (yalnız yol değişikliği) anahtar korunur. Kural (`waServiceUrlSchema`; panel, env ve DB CHECK aynı):
`http://` veya `https://`, `kullanıcı:şifre@`, `?`, `#`, boşluk, kontrol ve görünmez biçim karakteri (`\p{Cc}\p{Cf}\p{Zl}\p{Zp}`)
yok, en çok 200 karakter. **P13a — kanonik biçim:** adres WHATWG URL kuralıyla saklanır ve yanıtta öyle döner: şema ve
sunucu adı küçük harfe çevrilir (`HTTPS://WA.Example.com/` → `https://wa.example.com`), ondalık/onaltılı IPv4 noktalı
biçime, IDN punycode'a çevrilir, kök yolda sondaki `/` atılır. Büyük harfli şema reddedilmez, küçültülür. Uymayan değer → 400 `VALIDATION`, `fields.url` = "Adres http:// veya https:// ile
başlamalı; kullanıcı adı/şifre, ? ve # içeremez (en çok 200 karakter)". Yanıt GET görünümü (`source: "panel"`).

```bash
curl -sk -X PUT https://localhost:4450/api/v1/admin/settings/whatsapp \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF" \
  -d '{"url":"https://wa.example.com/","apiKey":"<servis-anahtarı>"}'
```

```json
{ "url": "https://wa.example.com", "source": "panel", "insecure": false, "updatedAt": "2026-11-13T09:10:00.000Z",
  "apiKeySet": true, "apiKeySource": "panel" }
```

DELETE ("Ortam değişkenine dön"): panel kaydı ve panel anahtarı kaldırılır (satır `{"url": null}` olarak kalır), etkin
adres env'e döner. Yanıt **200** + GET görünümü (`source: "env"`; env de boşsa `url: null`). İdempotent: panel kaydı yoksa değişiklik ve audit yok.
Aynı kanonik adresle tekrarlanan PUT 200 döner, yazım ve audit yapılmaz (P13a).

Audit (sistem kaydı, `tenantId` boş, entity `system_settings`, kayıt `whatsapp`): `settings.whatsapp.updated` eski
`{ url, source }` → yeni `{ url, source: "panel" }`; `settings.whatsapp.deleted` eski `{ url, source: "panel" }` → yeni
`{ url, source: "env" }`. Adres gizli değer sayılmaz, açık yazılır. P13b: anahtar değeri yazılmaz; yalnız `apiKey: "***"`
(varsa), `apiKeySet` ve PUT'ta `apiKeyChanged`. Kayıt ve audit tek işlemde (transaction).
PUT/DELETE hız sınırı (P13a): MySQL, TURN ve WhatsApp ayarlarının PUT/DELETE'i kullanıcı başına **ortak 10/dk**; 11. istek
429 `RATE_LIMITED` + `Retry-After`. Sayım girdi doğrulamasından sonradır (400 kotayı tüketmez). Hatalar: 400, 401, 403, 429.

### POST /api/v1/admin/settings/whatsapp/test (P12b)

Yalnız SUPER_ADMIN. **Kayıtlı etkin adrese** test mesajı gönderir (formdaki kaydedilmemiş adres kullanılmaz). Gövde
`{ "phoneNumber": "+905320000000" }` (`phoneSchema`: E.164 veya `90…`; servise `90…` biçiminde gider). Servise
`POST {url}/test-send`, tek deneme, 8 sn zaman aşımı; yönlendirme (3xx) izlenmez, başarısız sayılır.

```bash
curl -sk -X POST https://localhost:4450/api/v1/admin/settings/whatsapp/test \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF" \
  -d '{"phoneNumber":"+905320000000"}'
```

```json
{ "ok": true, "message": "Test mesajı gönderildi." }
```

Başarısız denemede de **200** döner, `ok: false` ve sabit mesaj (servis yanıtı, adres ve iç hata dönmez):

| Neden (yalnız audit/log)                                             | `message`                                           |
| -------------------------------------------------------------------- | --------------------------------------------------- |
| `unconfigured` (adres yok; istek gönderilmez)                        | Servis yapılandırılmamış.                           |
| `insecure` (güvensiz veya ayrıştırılamayan adres; istek gönderilmez) | Servis güvenli yapılandırılmamış.                   |
| `timeout`                                                            | Servis 8 saniye içinde yanıt vermedi (zaman aşımı). |
| `http_error`, `redirect`, `unreachable`                              | Servise ulaşılamadı veya servis hata döndürdü.      |
| `unauthorized` (P13b; servis 401 döndü, anahtar yok/yanlış)          | Servis anahtarı reddetti.                           |

Hız: Super Admin başına 5/dk (6. → 429) **ve** tüm Super Admin'ler için ortak 20/dk (21. → 429); 429 `RATE_LIMITED` +
`Retry-After` (en çok 60 sn). Firma testi (`/settings/support-requests/whatsapp/test`) ayrı kovadır. Her deneme audit
`settings.whatsapp.test` `{ recipient: <maskeli numara>, result, reason? }`. Hatalar: 400 `fields.phoneNumber`, 401, 403, 429.

### GET / PUT /api/v1/settings/consent-text

Etkin firmanın müşteriye gösterilen aydınlatma (KVKK) metni. GET `settings.view`, PUT `settings.edit`; Super Admin firma
seçmeden çağırırsa 403 "Önce bir firma seçin.".

```json
{ "current": { "id": "01K…", "version": 3, "sha256": "9f2c…", "createdAt": "2026-11-13T10:00:00.000Z",
               "createdByName": "Ayşe Yılmaz", "body": "…" },
  "versions": [ { "id": "01K…", "version": 3, "sha256": "9f2c…", "createdAt": "…", "createdByName": "Ayşe Yılmaz" },
                { "id": "01K…", "version": 1, "sha256": "41ab…", "createdAt": "…", "createdByName": null } ] }
```

`versions` yeniden eskiye, en çok 100; `createdByName: null` = sistem metni (seed / firma oluşturma).

PUT `{ "body": "…" }`: CRLF → LF, uçlar kırpılır; 50–20.000 karakter (kod noktası); satır sonu/sekme dışı kontrol
karakteri, yön (bidi) ve sıfır genişlikli karakter → 400 `fields.body`. Her kayıt **yeni sürüm** oluşturur, eski sürüm
değişmez; verilmiş onaylar kendi sürümüne bağlı kalır, yeni oturumlar yeni sürümü gösterir. Yanıt GET + `changed`:

- `changed: false` → metin güncel sürümle aynı; sürüm ve audit oluşmaz (çift gönderim güvenli).
- 409 `CONFLICT` "Metin aynı anda başka biri tarafından değiştirildi. Sayfayı yenileyin." (eşzamanlı iki kayıt).
- 429: firma başına saatte 10 geçerli kayıt (`changed:false` dahil); `Retry-After`.

Audit `settings.consent_text.updated` (eski → yeni `{ version, sha256 }`; metin gövdesi yazılmaz). Hatalar: 400, 401, 403, 409, 429.

## Marka ve kişiselleştirme: logo, avatar, tema (P12)

Bağlayıcı sözleşme: `docs/mimari-api.md` "backend-dev sapma notu (P12)". Kaynak: `apps/server/src/uploads/*`,
`auth/routes.ts`; sabitler ve tipler `packages/contracts/src/api/branding.ts`.

| Metot         | Yol                                     | Yetki                                                                                                                    | Başarı                       |
| ------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| PATCH         | `/api/v1/auth/me/preferences`           | Oturum + CSRF; şifre değişimi ve 2FA kurulumu aşamasında da çalışır (`verify` aşamasında 403 `MFA_REQUIRED`)             | 200 `{ theme }` + `rs_theme` |
| POST · DELETE | `/api/v1/settings/logo`                 | Oturum + CSRF, `settings.edit`, firma bağlamı (Super Admin firma seçmeli)                                                | 200 `{ logoUrl }`            |
| POST · DELETE | `/api/v1/users/:id/avatar`              | Oturum + CSRF. `:id` = `me` veya kendi id'si → herkes; başka kullanıcı → `users.edit` + aynı firma + yönetilebilir hesap | 200 `{ avatarUrl }`          |
| POST          | `/api/v1/admin/settings/system-logo`    | Oturum + CSRF, yalnız SUPER_ADMIN                                                                                        | 200 `{ logoUrl }`            |
| GET           | `/api/v1/files/logo/:tenantId/:file`    | Public                                                                                                                   | 200 `image/png`              |
| GET           | `/api/v1/files/system-logo/:file`       | Public                                                                                                                   | 200 `image/png`              |
| GET           | `/api/v1/files/avatar/:tenantId/:file`  | Oturum; kendi firması (Super Admin tümü)                                                                                 | 200 `image/webp`             |
| GET           | `/api/v1/public/branding?tenant=<slug>` | Public                                                                                                                   | 200                          |

Sistem logosunu **kaldıran uç yoktur** (yalnız yükle/değiştir); karar ve takip `docs/gereksinimler-sonra-acik.md` "P12'den".

### Logo zinciri

Her yerde aynı kural uygulanır (`uploads/urls.ts`): **firma logosu → sistem logosu → `/img/logo.png`** (Nokta Bilişim).
Kullanıldığı yerler: `GET /auth/me` `logoUrl` (üst menü), `/public/branding` (giriş ekranı), müşteri uçlarındaki
`tenant.logoUrl` (`/public/sessions/resolve`, `/public/requests/tenant`, `/public/bindings/status`) ve e-posta şablonları
(mutlak adres `PUBLIC_BASE_URL` + dosya yolu; çözülemezse `/img/logo.png`, gönderim logoya takılmaz).
`GET /settings/tenant` `logoUrl` ise yalnız firmanın kendi logosudur (yoksa `null`).

### Yükleme kuralları (üç POST ucu için ortak)

- İstek `multipart/form-data`, **tek dosya alanı `file`**, başka alan yok. Alan yok/yanlış veya boş dosya → 400 `VALIDATION`
  `fields.file` "Bir resim dosyası seçin.".
- Dosya en çok **2 MB** (2.097.152 bayt). Aşan istek okunmadan 413 `PAYLOAD_TOO_LARGE`.
- Tür, dosya adına veya tarayıcının bildirdiği MIME'a değil **içeriğe** (magic bytes) bakılarak belirlenir; yalnız PNG, JPEG,
  WEBP. SVG, GIF, HTML, uzantısı değiştirilmiş dosya, bozuk dosya veya 24 megapikselden büyük resim → 400 `INVALID_IMAGE`.
  Animasyonlu resimde yalnız ilk kare kullanılır.
- Boyut/oran: her kenar en az **16 px**; uzun kenar / kısa kenar oranı **logoda ≤ 20:1, avatarda ≤ 4:1**. Aşım → 400
  `INVALID_IMAGE` (ayrıntılı mesaj; bkz. hata tablosu).
- Sunucu resmi yeniden kodlar ve EXIF/ICC/XMP bilgisini siler. **Logo** ve **sistem logosu** → PNG, oran korunarak en çok
  512 px (küçük resim büyütülmez). **Avatar** → WEBP 256×256, ortadan kare kırpılır.
- Dosya `UPLOADS_DIR/{tenantId|system}/` altına rastgele adla (24 karakter) yazılır. Değiştirme/kaldırmada eski dosya silinir.
- Hız: kullanıcı başına **saatte 20 yükleme** (üç uç ortak kova) → 429 `RATE_LIMITED` + `Retry-After`. Sunucu aynı anda en çok
  2 resim işler, 4 iş bekletir; kuyruk dolu veya 10 sn içinde sıra gelmezse 429 `RATE_LIMITED` + `Retry-After: 5`
  ("Sunucu şu an başka resimleri işliyor…"). Saatlik sayaç ve kuyruk birbirinden bağımsızdır.
- Sıra: oturum + CSRF → yetki/kapsam → hedef kullanıcı (404/403) → hız sınırı → gövde okuma. Gövde, yetki ve hedef
  doğrulanmadan okunmaz.
- Yanıtlar `Cache-Control: no-store`.

Örnek (kendi avatarı):

```bash
curl -sk -X POST https://localhost:4450/api/v1/users/me/avatar \
  -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF" \
  -F 'file=@profil.jpg'
```

```json
{ "avatarUrl": "/api/v1/files/avatar/01K…/<24-karakter>.webp" }
```

### PATCH /api/v1/auth/me/preferences

Gövde `{ "theme": "LIGHT" | "DARK" | "SYSTEM" }` (bilinmeyen alan veya başka değer → 400 `VALIDATION` "Tema Açık, Koyu veya
Sistem olmalı"). Yalnız kendi hesabını değiştirir. Yanıt:

```json
{ "theme": "DARK" }
```

ve `Set-Cookie: rs_theme=dark`. Değer gerçekten değiştiyse DB'ye yazılır ve audit `user.theme_changed` (eski → yeni) oluşur;
aynı değer tekrarında yazım ve audit yoktur. Hatalar: 400, 401, 403 (`CSRF_INVALID`, `MFA_REQUIRED`).

### POST · DELETE /api/v1/settings/logo

Etkin firmanın logosu. POST yükler veya değiştirir → `{ "logoUrl": "/api/v1/files/logo/<tenantId>/<ad>.png" }`.
DELETE kaldırır → `{ "logoUrl": null }` (ekranlar sistem logosuna düşer). Logo yoksa DELETE yine 200 `null` döner, audit yazmaz.
Super Admin seçili firma için çalışır; firma seçmemişse 403 "Önce bir firma seçin.". Hatalar: 400, 401, 403, 413, 429.

### POST · DELETE /api/v1/users/:id/avatar

`:id` `me`, kendi id'si veya aynı firmadaki bir kullanıcının id'si. POST → `{ "avatarUrl": "/api/v1/files/avatar/…webp" }`,
DELETE → `{ "avatarUrl": null }` (yoksa da 200 `null`, audit yok).

- Kendi avatarı: her rol (Super Admin dahil; Super Admin dosyası `system/` altında tutulur).
- Başka kullanıcı: `users.edit` yoksa 403; başka firmanın kullanıcısı veya Super Admin hesabı 404; kendinden geniş yetkili
  hesap 403 "Sizden daha geniş yetkili bir hesabı yönetemezsiniz."; biçimsiz id 404.
  Hatalar: 400, 401, 403, 404, 413, 429.

### POST /api/v1/admin/settings/system-logo

Yalnız SUPER_ADMIN. Firma belli olmadığında giriş ekranında ve logosu olmayan firmalarda görünen sistem logosunu yükler
veya değiştirir → `{ "logoUrl": "/api/v1/files/system-logo/<ad>.png" }`. Mevcut sistem logosu
`GET /public/branding` (slug'sız) ile okunur. Hatalar: 400, 401, 403, 413, 429.

**DELETE (P15, AC-233)** sistem logosunu kaldırır → `{ "logoUrl": "/img/logo.png" }` (varsayılan Nokta Bilişim logosu;
giriş ekranı, PDF ve logosu olmayan firmalar). Kayıt `{ path: null }` yapılır, dosya işlem sonrası silinir. Kayıtlı logo
yoksa yine 200 döner, audit yazmaz. Audit `settings.system_logo.removed` (eski `{ path }` → `{ path: null }`).
Hatalar: 401, 403.

### GET /api/v1/files/logo/:tenantId/:file · /files/system-logo/:file · /files/avatar/:tenantId/:file

Dosya **yalnız DB'de o anda kayıtlı yolsa** sunulur: eski (değiştirilmiş/kaldırılmış) dosya, elle konmuş dosya, yanlış
uzantı, biçim dışı ad veya `..` içeren yol → 404. Logo ucu avatarı, avatar ucu logoyu vermez.

| Uç                                | Kim                                                                                                       | Önbellek                                                             | Not                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `files/logo`, `files/system-logo` | Herkes (giriş ekranı, müşteri sayfası, e-posta)                                                           | `public, max-age=300` + ETag                                         | `Cross-Origin-Resource-Policy: cross-origin` (e-posta istemcileri yükler). Silinmiş firmanın logosu 404 |
| `files/avatar`                    | Oturum; görüntüleyenin kendi firması değilse 404 (Super Admin tümü); `system/` avatarı yalnız Super Admin | `private, no-cache` + ETag (her gösterimde yetki yeniden denetlenir) | Oturumsuz 401. Şifre değişimi / 2FA kurulumu bekleyen oturum da kendi menüsü için çağırabilir           |

Tüm dosya yanıtlarında `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`,
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox`; `Content-Type` sunucu belirler.
`If-None-Match` eşleşirse 304 (yetki ve DB denetiminden sonra).

### GET /api/v1/public/branding?tenant=<slug>

Giriş ekranı logosu. Çerez istemez. Yanıt `Cache-Control: no-store`:

```json
{ "name": "Örnek Bilişim Ltd.", "logoUrl": "/api/v1/files/logo/01K…/<24-karakter>.png" }
```

- `tenant` geçerli ve firma aktifse: firma adı + firma logosu (yoksa sistem logosu → `/img/logo.png`).
- `tenant` yok, biçim dışı, bilinmeyen veya pasif firma: **aynı biçimde** `{ "name": null, "logoUrl": <sistem logosu> }`
  (404 dönmez; firma varlığı bu yoldan ayırt edilemez).
- IP başına dakikada 60 istek; 61. → 429 `RATE_LIMITED` (`Retry-After`). Web giriş ekranı bu ucu sunucu tarafında çağırır ve
  ziyaretçinin IP'sini yalnız Caddy → web paylaşılan sırrı (`X-Edge-Auth`) doğrulanınca iletir; böylece sınır ziyaretçi
  başına işler.

```bash
curl -sk 'https://localhost:4450/api/v1/public/branding?tenant=demo'
```

## G3 küçük özellikler (P15)

Kaynak: `docs/mimari-e11.md` §6, AC-231..239. Kurtarma kodu yenileme yukarıda "POST /api/v1/auth/mfa/recovery-codes",
sistem logosu kaldırma "POST /api/v1/admin/settings/system-logo" bölümündedir.

### GET /api/v1/admin/superadmins

Yalnız SUPER_ADMIN. Etkin ve pasif Super Admin hesapları (silinmişler hariç), ad sırasıyla en çok 100. `no-store`.

```json
{ "items": [ { "id": "01K…", "fullName": "Ayşe Yönetici", "email": "ayse@example.com", "status": "ACTIVE",
  "totpEnabled": true, "self": false } ] }
```

`self: true` isteği yapan hesaptır; arayüz bu satırda sıfırlama düğmesini göstermez. Hatalar: 401, 403.

### POST /api/v1/admin/superadmins/:id/reset-password

Başka bir Super Admin'in şifresini panelden sıfırlar (AC-232). Gövde `{}`. Sıra: oturum + CSRF → SUPER_ADMIN → hız
sınırı (kullanıcı başına 5/dk) → **step-up** (son 5 dk içinde 2FA kanıtı) → id → kendi id'si 403 → sıfırlama.
Sunucudaki `reset-superadmin` CLI'siyle aynı servis kullanılır.

```bash
curl -sk -X POST https://localhost:4450/api/v1/admin/superadmins/$ID/reset-password \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF" -d '{}'
```

```json
{ "temporaryPassword": "<geçici şifre>", "revokedSessions": 2 }
```

- Geçici şifre **yalnız bu yanıtta** döner; 24 saat geçerlidir, hedef ilk girişte yeni şifre belirlemek zorundadır.
- Hedefin tüm giriş oturumları kapanır; yürüttüğü canlı destek oturumları ve panel soketleri sonlanır.
- 2FA'ya dokunmaz (gerekirse CLI `--reset-mfa`).
- Audit `auth.superadmin_reset` (aktör Super Admin, `newValue.via: "panel"`; şifre yazılmaz).
- Hatalar: 401 `MFA_STEP_UP_REQUIRED` (step-up gerekli), 403 `FORBIDDEN` ("Kendi şifrenizi bu yolla sıfırlayamazsınız;
  şifre değiştirme ekranını kullanın." veya rol), 403 `MFA_SETUP_REQUIRED`, 403 `CSRF_INVALID`, 404 `NOT_FOUND` (biçimsiz
  id veya etkin bir Super Admin değil), 429 `RATE_LIMITED` + `Retry-After`.

### GET · POST · DELETE /api/v1/request-blocks

Destek talebi engelleri (AC-235). Yetki `support_requests.block`; firma bağlamı (Super Admin firma seçmemişse 403
"Önce bir firma seçin."). Tüm yanıtlar `Cache-Control: no-store`. Yazma uçları kullanıcı başına dakikada 30.

Engellenen IP/ağdan ya da bilgisayardan gelen `POST /public/requests` diğer reddedilen taleplerle **aynı tek tip yanıtı**
alır: 429 `RATE_LIMITED` + "Şu an çok yoğunuz, lütfen firmanızı telefonla arayın." Talep yazılmaz, kuyruğa düşmez.
Güvenilen ağlar engelden muaf değildir. Engel kontrolü tenant başına bellek önbelleğinden yapılır; ekleme ve kaldırma
önbelleği hemen geçersiz kılar.

**GET** `?kind=IP|DEVICE&includeExpired=false|true&page=1&pageSize=25` (`pageSize` ≤ 100). Varsayılan yalnız etkin engeller.

```json
{ "items": [ { "id": "01K…", "kind": "IP", "cidr": "203.0.113.0/24", "deviceFingerprint": null,
  "expiresAt": "2026-11-22T10:00:00.000Z", "expired": false, "note": "Tekrarlayan sahte talep",
  "createdAt": "2026-11-15T10:00:00.000Z", "createdBy": { "id": "01K…", "fullName": "Ayşe Yönetici" } } ],
  "page": 1, "pageSize": 25, "total": 1, "used": 1, "max": 1000 }
```

`deviceFingerprint` cihaz anahtarı özetinin ilk 8 hanesidir (yalnız ayırt etmek için). `used` süresi dolmuşlar dahil
toplam satırdır; `max` firma başına üst sınırdır (1.000).

**POST** iki biçim alır:

| `source`  | Gövde                                                                             | Not                                                                                                                          |
| --------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `CIDR`    | `{ source, cidr, durationHours, note? }`                                          | Elle IP veya ağ. IPv4 /24–/32, IPv6 /48–/128; önek yoksa tek adres. Hizasız önek ağ adresine indirgenir                      |
| `REQUEST` | `{ source, requestId, target: "IP"\|"DEVICE", prefixLen?, durationHours, note? }` | Talepler ekranındaki "Bu kaynağı engelle". IP veya cihaz anahtarı sunucuda talep satırından alınır; `prefixLen` yalnız IP'de |

`durationHours`: 1 ile 8760 (1 yıl) arası tam sayı veya `null` (süresiz). `note`: en çok 200 karakter, kontrol/görünmez
karakter yok. Yanıt 201 `RequestBlockItem`. Süresi dolan engel 30 gün sonra gece saklama işiyle silinir.

```bash
curl -sk -X POST https://localhost:4450/api/v1/request-blocks \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF" \
  -d '{"source":"CIDR","cidr":"203.0.113.0/24","durationHours":168,"note":"Tekrarlayan sahte talep"}'
```

**DELETE** `/api/v1/request-blocks/:id` → 204.

Hatalar (kaynak `packages/contracts/src/api/request-blocks.ts`):

| Kod                | Durum                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 400 `VALIDATION`   | Gövde/şema; `fields.cidr`, `fields.prefixLen`, `fields.durationHours`, `fields.note`                                    |
| 403 `FORBIDDEN`    | `support_requests.block` yok veya firma seçilmemiş                                                                      |
| 404 `NOT_FOUND`    | POST `source: "REQUEST"`: talep bu firmada yok. DELETE: engel yok (biçimsiz id dahil)                                   |
| 409 `CONFLICT`     | "Bu kaynak zaten engelli." — aynı hedef etkin engelli; `fields.cidr` (IP) veya `fields.target` (cihaz) aynı metni taşır |
| 409 `CONFLICT`     | "Firma başına en çok 1000 engel eklenebilir. Önce eski engelleri kaldırın." (alan yok)                                  |
| 409 `CONFLICT`     | "Bu talebin kaynak bilgisi yok (anonimleştirilmiş veya cihaz anahtarı gönderilmemiş)." (alan yok)                       |
| 429 `RATE_LIMITED` | Yazma 30/dk/kullanıcı; `Retry-After`                                                                                    |

Audit `request_block.created` / `request_block.deleted` (entity `request_blocks`; `{ kind, cidr | deviceFingerprint,
expiresAt, source }`, not metni yazılmaz, yalnız `hasNote`). Engelli kaynağın talebi ayrı satır yazmaz:
`request.rate_limited { bucket: "blocked" }` (kaynak başına dakikada 1).

### GET /api/v1/public/sessions/:sessionId/tech-avatar?exp=&sig=

Müşteri ekranındaki teknisyen fotoğrafı (AC-236). Adres `POST /public/sessions/resolve` yanıtındaki
`technician.avatarUrl`'den gelir; elle kurulmaz.

- İmza HMAC-SHA-256; anahtar `APP_ENCRYPTION_KEYS`'ten `avatar-url` etiketiyle türetilir. Adres 600 sn geçerlidir.
  URL'de oturum token'ı değil oturum kimliği (ULID) bulunur; token loglara düşmez.
- Oturum `ACTIVE` ya da süresi dolmamış `PENDING` olmalıdır (karşılama ekranı).
- Yanıt WEBP; `Cache-Control: private, no-store`, `nosniff`, `default-src 'none'` CSP.
- IP başına dakikada 60 istek.
- Hatalar: 403 `FORBIDDEN` (imza/süre geçersiz, biçimsiz kimlik veya oturum bitmiş; tek gövde), 404 (teknisyenin resmi yok
  veya kaldırıldı), 429 `RATE_LIMITED`.

### Paylaşım hata nedeni ve kabul kodu (WS)

- **`share.state.reason` / `method` (AC-234):** 0.11+ istemci paylaşım başlatılamadığında neden kodunu (ör.
  `DXGI_UNSUPPORTED`, `NO_H264_ENCODER`) ve son denenen yöntemi (`DXGI` | `GDI` | `WGC`) gönderir. Sunucu alanları yeniden
  kurup teknisyene iletir. Türkçe etiketler `contracts/labels.ts` `SHARE_FAIL_REASON_LABELS`; bilinmeyen kod
  "Bilinmeyen neden (KOD)" olarak gösterilir. 0.10.x istemci bu alanları göndermez.
- **Neden kodları (istemci `capture.Reason`, `contracts/labels.ts` ile birebir; `test/p17-share-reasons.test.ts`):**
  `DXGI_UNSUPPORTED`, `DXGI_ACCESS_DENIED`, `DXGI_NOT_AVAILABLE`, `NO_OUTPUT`, `D3D_DEVICE`, `FIRST_FRAME_TIMEOUT`,
  `GDI_FAILED`, `MF_STARTUP`, `NO_H264_ENCODER`, `ENCODER_CONFIG`, `ENCODE_FAILED`, `OTHER`; P17 (0.11.0, pencere modu):
  `WGC_UNSUPPORTED` (pencere yakalama yok), `WINDOW_CLOSED` (paylaşılan pencere kapandı), `WINDOW_UNAVAILABLE` (pencere
  yakalamaya açılamadı). Şema enum değil, desen `^[A-Z0-9_]{1,32}$`; yeni kod sunucu değişikliği gerektirmez.
- **`method`:** `DXGI` (masaüstü çoğaltma), `GDI` (yedek), `WGC` (P17 pencere yakalama). Yöntem bilinmiyorsa alan yoktur
  (ör. Media Foundation/kodlayıcı nedenleri).
- **Pencere modu (P17, AC-248):** 0.11.0 istemci müşteri "Yalnız bir pencere" seçtiğinde `{ "t": "share.state", "state":
"sharing", "method": "WGC" }` gönderir; `monitors`/`activeMonitor` yoktur ve istemci `monitor.request`'i yok sayar. Konsol
  bu durumda "Pencere paylaşımı" rozetini gösterir, monitör seçiciyi gizler. Pencere kapanınca
  `{ "state": "stopped", "reason": "WINDOW_CLOSED", "method": "WGC" }` gelir; istemci tüm ekrana geçmez.
- **Birleştirme (S17-2):** sunucu `share.state`'i teknisyene oda başına en çok 1 sn'de bir iletir. Aradaki mesajlar
  düşürülmez; aralık sonunda en son durum tek mesajla gider.
- **`request.accepted.admitCode` (AC-239):** firma ayarı "Talep kabulünde kabul kodu iste" (`requireAcceptCode`) açıksa
  sunucu 4 haneli bir kod üretir ve yalnız müşteriye gönderir. Müşteri `/ws/guest`'e bağlanınca bekleme odasına düşer
  (`lobby.wait`); teknisyen kodu konsolda `guest.admit` ile girer (P3 bekleme odası kuralları). Pencere 60 sn'dir. İstemci
  yeniden bağlanırsa yeni kod üretilir. Ayar kapalıyken alan gönderilmez ve akış değişmez.
- **Eski istemci (S15-6):** ayar açıkken talebin `clientVersion`'ı 0.11.0'dan eskiyse `POST /requests/:id/accept`
  409 `ACCEPT_CODE_CLIENT_UNSUPPORTED` döner; talep PENDING kalır, audit `request.accepted` `result:"fail"`,
  `reason:"client_unsupported"`. Kod hiçbir koşulda sessizce atlanmaz. Ayar kapalıyken eski istemci normal kabul edilir.

## Kalıcı silme (P16)

Kaynak: `docs/mimari-e11.md` §7, ADR-0030 r2, `apps/server/src/{users,tenants}/routes.ts`, `tenants/purge-service.ts`,
`packages/contracts/src/api/{users,tenants,audit}.ts`. Hata ek bilgisi zarfın `fields` alanındadır (dize değerler).

### DELETE /api/v1/users/:id

Pasif kullanıcıyı kalıcı siler (mezar taşı; AC-237, AC-241). Yetki `users.delete` + yönetebilme (`canManage`) + firma
kapsamı; **step-up** (son 5 dk); `If-Match: "v<n>"` (`GET /users/:id` `ETag`'i); hız `/users` yazma 30/dk.

```bash
curl -sk -X DELETE "https://localhost:4450/api/v1/users/01K…" \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF" -H 'If-Match: "v7"' \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF" \
  -d '{"confirmName":"Ayşe Yılmaz"}'
```

`confirmName` (1..100) hedefin `fullName`'ine eşit olmalı (trim + NFC, harf duyarlı). Yanıt **204**. Sonuç: `email =
deleted+<id>@invalid`, `fullName = "Silinmiş kullanıcı #<id son 6>"`, `status = DELETED`; şifre, 2FA, avatar (dosyasıyla),
yetkiler, giriş oturumları, kurtarma kodları ve sıfırlama bağlantıları silinir. Kullanıcı `GET /users` listelerinde
görünmez, `GET /users/:id` 404 döner; `GET /users/options?includeDeleted=1` mezar taşını etiketiyle döner. Giriş ve
şifre sıfırlama silinmiş hesabı "olmayan hesap" gibi işler. Audit `user.deleted` (kişisel veri yok); imha defterine satır.

| HTTP | Kod                     | Ne zaman                                                                                                        |
| ---- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| 400  | `VALIDATION`            | `fields.confirmName` "Yazdığınız ad kullanıcının adıyla eşleşmiyor" ya da boş/uzun                              |
| 401  | `MFA_STEP_UP_REQUIRED`  | Son 5 dk içinde step-up yok                                                                                     |
| 403  | `FORBIDDEN`             | `users.delete` yok, kendi hesabı, daha geniş yetkili hedef (TX içi retler audit'e `fail`)                       |
| 403  | `MFA_SETUP_REQUIRED`    | Aktörde TOTP kurulu değil                                                                                       |
| 404  | `NOT_FOUND`             | Kullanıcı yok, başka firmada, Super Admin hedef (S16-17: kimlik sızmasın diye 404) ya da zaten silinmiş         |
| 409  | `CONFLICT`              | Aktif kullanıcı ("Önce kullanıcıyı pasife alın"); açık destek oturumu ("Kullanıcının açık destek oturumu var…") |
| 409  | `STALE_WRITE`           | `If-Match` sürümü güncel değil                                                                                  |
| 428  | `PRECONDITION_REQUIRED` | `If-Match` yok ya da bozuk                                                                                      |
| 429  | `RATE_LIMITED`          | Yazma hız sınırı                                                                                                |

### POST /api/v1/admin/tenants/:id/purge

Yalnız SUPER_ADMIN; hız `/admin` 30/dk. Gövde `dryRun` ile ayrılır (AC-242).

**Önizleme `{"dryRun": true}`** — step-up yok, salt okuma. 200:

```json
{ "previewId": "1763300000000.9f2c…", "expiresAt": "2026-11-15T10:15:00.000Z",
  "tenant": { "id": "01K…", "name": "Örnek Bilişim Ltd." },
  "passiveSince": "2026-10-01T08:00:00.000Z", "eligibleAt": "2026-10-31T08:00:00.000Z",
  "counts": { "SESSIONS": 412, "REQUESTS": 96, "CUSTOMERS": 23, "USERS": 6, "TENANT_ROW": 1 },
  "files": { "count": 7, "bytes": 512000 }, "auditRetained": 5120 }
```

`counts` adım adlarıyla (`TENANT_PURGE_STEPS`); önizleme sayıları silinen sayılarla aynı koşuldan gelir. `previewId`
15 dk geçerli, tek kullanımlık; firma, aktör, giriş oturumu, `passive_at` ve açık işin durumuna bağlıdır. Audit
`tenant.purge_previewed` (yalnız sayılar). FAILED iş varsa önizleme 200 döner (sürdürme için).

**Zamanlama `{"dryRun": false, "previewId": "…", "confirmName": "Örnek Bilişim Ltd."}`** — **step-up** (gövde
ayrıştırılmadan önce). `confirmName` firma adına eşit olmalı (satırı silinmiş firmada "Silinmiş firma #XXXXXX"). 202:

```json
{ "jobId": "01K…", "state": "SCHEDULED", "scheduledFor": "2026-11-16T10:00:00.000Z" }
```

İş DB saatiyle +24 saat sonra başlar; bu süre ve 30 gün pasiflik DB tetikleyicisiyle zorlanır. Audit
`tenant.purge_scheduled`. FAILED iş varsa 202 `{"state": "RUNNING"}` ile beklemeden sürdürülür (`scheduledFor` işin özgün
zamanı; audit `tenant.purge_started {resumed: true}`).

Hatalar: 400 (`fields.confirmName` "Firma adı eşleşmiyor", şema) · 401 `MFA_STEP_UP_REQUIRED` · 403 · 404 · 409
`PURGE_NOT_ELIGIBLE` (`fields.reason = not_passive` ya da `fields.eligibleAt`) · 409 `CONFLICT` açık iş ("Bu firma için açık
bir silme işi var."; `fields.jobId`, `fields.state`) · 428 `PREVIEW_REQUIRED`. Sıra: 404 → 428 → 400 (ad) → 409 uygunluk →
409 açık iş.

### DELETE /api/v1/admin/tenants/:id/purge (iptal)

SUPER_ADMIN + **step-up**. Yalnız `SCHEDULED` iş iptal edilir → 200 `{"jobId": "01K…", "state": "CANCELLED"}`; audit
`tenant.purge_cancelled`. Hatalar: 401 · 403 · 404 (açık iş yok) · 409 `CONFLICT` ("Yalnız başlamamış (zamanlanmış) silme
işi iptal edilebilir."; `fields.jobId|state`).

### GET /api/v1/admin/tenants/:id/purge

SUPER_ADMIN. Firmanın son işi (firma satırı silinmiş olsa da) → 200:

```json
{ "jobId": "01K…", "state": "RUNNING", "step": "SESSIONS", "stepIndex": 5, "stepCount": 17,
  "scheduledFor": "…", "counts": { "SESSION_FILES": 120 }, "attempts": 0, "lastError": null,
  "startedAt": "…", "heartbeatAt": "…", "finishedAt": null, "cancelledAt": null }
```

`state`: `SCHEDULED | RUNNING | DONE | FAILED | CANCELLED`. `lastError` yalnız hata sınıfıdır (`db_fk`, `db_signal`, `fs`,
`invalid_job`, `other`). İş yoksa 404.

### GET /api/v1/admin/purge-jobs?open=1

SUPER_ADMIN. Panel uyarı bandının kaynağı (60 sn yoklama). `open=1` (`true`) yalnız açık işler (`SCHEDULED|RUNNING|FAILED`);
yoksa son işler. En çok 100 → `{ "items": [ { "jobId", "tenantId", "tenantName", "state", "scheduledFor" } ] }`;
satırı silinmiş firmada `tenantName: null`.

### Mevcut uçlarda değişenler

- `GET /admin/tenants`: satıra `passiveSince` (ISO | null) ve `purge: { state, scheduledFor, step } | null` (açık iş).
- `POST /admin/tenants/:id/reactivate`: açık iş varsa 409 `CONFLICT` — SCHEDULED: "Önce silme işini iptal edin";
  RUNNING/FAILED: "Firma kısmen silindi; silmeyi tamamlayın".
- `GET /audit`, `GET /audit/export.csv`, oturum zaman çizelgesi: öğeye `actorLabel`, `tenantLabel`, `identityMasked`
  eklendi. Aktör ya da `entity = "users"` hedefi silinmiş/yoksa veya firma satırı yoksa satır **kimlik maskeli** döner:
  `username` `a***@***`, `oldValue`/`newValue` içindeki kimlik anahtarları (`email`, `fullName`, `username`, `name`,
  `contactName`, `phone`, `customerName`, `customerEmail`, `recipient`) `***`; etiketler "Silinmiş kullanıcı #XXXXXX",
  "Silinmiş firma #XXXXXX". CSV "Firma" sütunu `tenantLabel`. Açık değer hiçbir uçtan dönmez.
- `GET /users/options?includeDeleted=1`: mezar taşları "Silinmiş kullanıcı #XXXXXX" etiketiyle, `status: "DELETED"`.
- Yeni audit eylemleri: `user.deleted`, `tenant.purge_previewed|scheduled|cancelled|started|failed`, `tenant.purged`,
  `uploads.orphan_scan`, `erasure.replayed`, `migration.p16_users_delete_reset`; filtre grupları `uploads.*`, `erasure.*`,
  `migration.*`.

**Gece kalıcı silme ve yetim dosya taraması** (uç yok): saklama işi anonimleşmeden 30 gün sonra satırları siler
(`RETENTION_PURGE_MODE=on`; varsayılan `dry` yalnız sayar); `retention.run` audit'ine `purged*` ya da `purgeCandidates`
sayıları eklenir. Pazar 04:30 (TR) yetim dosya taraması `uploads.orphan_scan` yazar. Metrikler:
`rs_retention_failures_total{class}`, `rs_tenant_purge_jobs{role="<STATE>"}`, `rs_tenant_purge_rows_total{table}`,
`rs_tenant_purge_last_heartbeat_seconds`, `rs_orphan_files_total{action}`, `rs_orphan_scan_last_success_timestamp_seconds`,
`rs_erasure_ledger_write_failed_total`. Alarm ve operasyon: `docs/runbook.md` §23.

## Talep iletişimi (P18)

AC-255..258; tasarım `docs/mimari-e11.md` §8b. Bütün panel uçları oturum + CSRF (yazma) + yetki + `tenantScope` zincirini
kullanır; Super Admin önce firma seçer. Başka firmanın kaydı 404. Yanıtlar `Cache-Control: no-store`.

**Yeni yetkiler** (`packages/contracts/src/permissions.ts`; yetki tablosunda kendiliğinden çıkar, Admin açık / User kapalı):

| Anahtar                    | Ekranda       | Açar                                                      |
| -------------------------- | ------------- | --------------------------------------------------------- |
| `support_requests.assign`  | Ata / öncelik | Talebi teknisyene atama, atamayı kaldırma, öncelik        |
| `support_requests.message` | Mesaj yaz     | Bekleyen talepte müşteriye mesaj yazma (okuma `view` ile) |

### GET /api/v1/support-requests — eklenenler

Öğeye `priority` (`LOW`|`NORMAL`|`HIGH`), `assignedTo` (`{id, name}` | null), `slaDueAt` (ISO | null), `slaBreached`
(boolean), `afterHours` (boolean). Bekleyen sekmede yeni süzgeç `assigned=me|none` (yalnız `tab=pending`; aksi 400).
Bekleyen sıra: öncelik (Yüksek önce) → geliş zamanı → id (`compareQueue`).

```json
{ "id": "01K…", "requestCode": "482913", "status": "PENDING", "priority": "HIGH",
  "assignedTo": { "id": "01K…", "name": "Ayşe Teknisyen" }, "slaDueAt": "2026-11-16T07:30:00.000Z",
  "slaBreached": false, "afterHours": true, "…": "…" }
```

`slaBreached`: SLA ilk yanıt (kabul) süresidir; bitiş = bekliyorsa şimdi, değilse kabul ya da kapanış anı. Tam hedef anı
aşım sayılmaz. SLA'sız talepte `slaDueAt: null`, `slaBreached: false`.

### POST /api/v1/support-requests/:id/assign

Yetki `support_requests.view` + `support_requests.assign`; 30/dk/kullanıcı (öncelik ucuyla ortak).

```http
POST /api/v1/support-requests/01K…/assign
Content-Type: application/json
X-CSRF-Token: …

{ "userId": "01K…" }
```

200 → güncel `SupportRequestItem`. `"userId": null` atamayı kaldırır. Atanabilir kişi: aynı firmada, etkin, Admin ya da
User, etkin `support_requests.view` + `accept` yetkili. Super Admin atama yapabilir, atanamaz. Değişiklik yoksa audit
yazılmaz. Başarıda panellere `request.updated` gider.
Hatalar: 400 `VALIDATION` (`fields.userId`: "Bu kullanıcıya talep atanamaz (aynı firmada, etkin ve talep kabul yetkisi
olmalı)."), 403, 404, 409 `REQUEST_CLOSED`, 429.

Başkasına atanmış talep `POST /support-requests/:id/accept` ile yine kabul edilebilir; panel önce onay ister.

### POST /api/v1/support-requests/:id/priority

Yetki ve sayaç assign ile aynı. Gövde `{ "priority": "LOW" | "NORMAL" | "HIGH" }` → 200 `SupportRequestItem`. Öncelik
değişimi SLA'yı değiştirmez (talep açılırken dondurulur). Hatalar: 400, 403, 404, 409 `REQUEST_CLOSED`, 429.

### GET /api/v1/users/options?assignable=1

Mevcut uca (P14b) süzgeç: yalnız atanabilir kullanıcılar. `support_requests.assign` yetkisi olmayan User yalnız kendini
görür ("Bana ata" için).

### GET /api/v1/support-requests/:id/messages?after=<ulid>

Yetki `support_requests.view`; 120/dk/kullanıcı. Yalnız bekleyen (PENDING) talep. `after` verilirse o mesajdan sonrakiler.

```json
{ "items": [
    { "id": "01K…", "sender": "TECH", "senderName": "Ayşe Teknisyen", "body": "Birkaç dakika içinde bağlanacağım",
      "createdAt": "2026-11-15T09:01:02.000Z" },
    { "id": "01K…", "sender": "CUSTOMER", "senderName": null, "body": null, "createdAt": "…" } ],
  "customerChat": "SUPPORTED" }
```

En çok 100 öğe, eskiden yeniye. `body: null` = gövde çözülemedi (panel "Mesaj okunamadı" yazar). `customerChat`:
`SUPPORTED` (müşteri programı bağlı ve mesajlaşmayı destekliyor), `UNSUPPORTED` (bağlı ama desteklemiyor), `OFFLINE`
(bağlı değil; yazılan mesaj saklanır, bağlanınca gider). Okuma audit'e yazılmaz (metrik `rs_request_messages_read_total`).
Hatalar: 400, 403, 404, 409 `REQUEST_CLOSED` (kapalı talebin yazışması P22'de açılacak), 429.

### POST /api/v1/support-requests/:id/messages

Yetki `support_requests.view` + `support_requests.message`. Hız: 60/dk/kullanıcı, 600/dk/firma, talep ve gönderici
başına 1/sn; talep başına gönderici tavanı 200 mesaj.

```http
POST /api/v1/support-requests/01K…/messages
Content-Type: application/json
X-CSRF-Token: …

{ "body": "Birkaç dakika içinde bağlanacağım", "clientMsgId": "m-01K…" }
```

201 `{ "id": "01K…", "createdAt": "…" }`. Aynı `clientMsgId` yeniden gönderilirse aynı kayıt döner (çift yok).
Gövde kuralları (`requestMessageBodySchema`): satır sonu normalleştirme, NFC, baş/son boşluk kırpma; 1–1.000 kod noktası,
en çok 20 satır; `\n` dışındaki kontrol karakterleri, biçim (Cf; ZWJ ve VS16 hariç) ve yön karakterleri ret.
`clientMsgId` `^[A-Za-z0-9_-]{1,36}$`. Mesaj şifreli saklanır, sonra müşteriye iletilir; gövde loga/audit'e yazılmaz
(audit `request.message_sent {sender, chars}`).
Hatalar: 400 `VALIDATION`, 403, 404, 409 `REQUEST_CLOSED` / `CHAT_UNSUPPORTED`, 429 `RATE_LIMITED` ("Çok hızlı mesaj
gönderiyorsunuz. Lütfen biraz bekleyin." · tavan: "Bu talepte en çok 200 mesaj gönderilebilir.").

### GET / PUT /api/v1/settings/business-hours

GET `settings.view`, PUT `settings.edit` (30/dk/kullanıcı).

```json
{ "enabled": true, "timeZone": "Europe/Istanbul", "afterHoursMode": "ACCEPT",
  "week": [[{ "from": "09:00", "to": "12:30" }, { "from": "13:30", "to": "18:00" }],
           [{ "from": "09:00", "to": "18:00" }], [], [], [], [], []],
  "openNow": false, "nextOpeningAt": "2026-11-16T06:00:00.000Z" }
```

PUT gövdesi `openNow`/`nextOpeningAt` olmadan aynı şekil. `week` 7 gün, Pazartesi = 0; gün başına en çok 2 aralık,
`from` 00:00–23:59, `to` 00:01–24:00 (`24:00` gün sonu), `from < to`, aralıklar örtüşmez, gece yarısını aşan aralık yok.
`enabled: true` iken en az bir aralık zorunlu. `timeZone` geçerli IANA adı. `afterHoursMode`: `ACCEPT` (talep alınır,
`afterHours: true`, SLA ilk açılışta başlar) | `REJECT` (talep `OUTSIDE_HOURS` ile reddedilir). `nextOpeningAt` açıkken
şimdiki an, bir yıl içinde açık an yoksa null. Hatalar: 400 (`fields["week.0.1.to"]` gibi), 403, 429.

### GET · POST · DELETE /api/v1/settings/holidays

- `GET /settings/holidays?year=2026` (`settings.view`; `year` 2000–2100) → `{ "items": [{ "id", "day": "2026-10-28",
"name": "Cumhuriyet Bayramı arifesi", "openUntil": "13:00" }] }`.
- `POST /settings/holidays` (`settings.edit`; 60/dk) gövde `{ "day": "YYYY-MM-DD", "name": "…", "openUntil": "HH:MM" | null }`
  → 201 öğe. `day` firma saat diliminde yerel gün; `openUntil` doluysa o gün bu saate kadar açık (yarım gün), null tam gün
  kapalı. `name` 1–100 karakter.
- `DELETE /settings/holidays/:id` (`settings.edit`) → 204. Değiştirme = sil + ekle.

Hatalar: 400, 403, 404, 409 `CONFLICT` ("Bu gün zaten tatil olarak ekli" — `fields.day`; ya da "Firma başına en çok 200
tatil günü tanımlanabilir"), 429.

### POST /api/v1/settings/holidays/import-tr

`settings.edit`; 10/dk. Gövde `{ "year": 2027 }` → 200 `{ "added": 14, "skipped": 1 }`. Liste koddadır
(`packages/contracts/src/holidays-tr.ts`; bugün 2026 ve 2027; arifeler `openUntil: "13:00"`). Zaten olan günler atlanır;
200 tavanı aşılacaksa hiçbiri eklenmez (409 `CONFLICT`). Listede olmayan yıl 400. Dinî bayram tarihleri yıllık
doğrulanır (runbook §25.6).

### Mevcut uçlarda değişenler (P18)

| Uç                                                       | Değişiklik                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET / PUT /api/v1/settings/support-requests`            | += `defaultPriority` (varsayılan `NORMAL`), `defaultSlaMinutes` (5–1440 \| null = SLA yok); PUT'ta opsiyonel                                                                                                                                                                                                                             |
| `POST /api/v1/customers` · `PATCH /api/v1/customers/:id` | += `defaultPriority` (null = firma varsayılanı), `slaMinutes` (5–1440 \| null = firma varsayılanı)                                                                                                                                                                                                                                       |
| `POST /api/v1/public/requests`                           | Mesai dışı + `REJECT` → 409 `OUTSIDE_HOURS` + `fields.nextOpeningAt`, mesaj "Mesai dışındayız. Sonraki açılış: gg.aa.yyyy SS:dd (…)". İstemci < 0.12.0 → aynı mesaj **429 `QUEUE_FULL`** (eski istemci yalnız bu kodda sunucu mesajını gösterir), `Retry-After` yok, hız sınırı alarmını beslemez. Kontrol geçerli ref'ten sonra yapılır |
| `GET /api/v1/public/requests/tenant`                     | += `businessHours: { openNow, nextOpeningAt, afterHoursMode }` (takvim kapalıysa `openNow: true`)                                                                                                                                                                                                                                        |
| `GET /api/v1/sessions/:id/history` (ve `PATCH` yanıtı)   | `request` nesnesine `slaDueAt` (ISO \| null), `slaBreached` (boolean \| null; SLA yoksa null). Anonimleştirilmiş oturumda da dolu                                                                                                                                                                                                        |
| `GET /api/v1/sessions/export.csv`                        | Son sütun **"SLA aşıldı"**: `Evet` / `Hayır` / boş (talepsiz oturum ya da SLA'sız talep)                                                                                                                                                                                                                                                 |

Talep oluşturulurken öncelik = müşteri varsayılanı ?? firma varsayılanı; SLA dakikası aynı sırayla; değerler dondurulur.

### WebSocket ekleri

Ayrıntılı ve bağlayıcı sözleşme: `docs/mimari-protokol.md` §5.4. Özet:

- `/ws/request`: müşteri programı `Sec-WebSocket-Protocol`'e `rs.cap.chat1` eklerse mesajlaşma açılır (`request.message`
  her iki yönde, bağlantıda son 50 mesaj `request.messages`, kapanış/kabulde `request.chat {enabled:false}`). Yeteneksiz
  sokete (≤ 0.11.x) yeni tipte çerçeve gitmez. Yetenekli sokette gövde kuralı ihlali `error VALIDATION` döner, soket açık
  kalır; hız aşımı `error RATE_LIMITED`.
- `/ws/panel`: `request.updated {id, priority, assignedTo, slaDueAt}` (atama/öncelik), `request.activity {id, kind:"message",
sender, at}` (gövdesiz, talep başına ≤ 1/sn), `request.new` += `priority`, `slaDueAt`, `afterHours`, `customerChat`.

## Web talep formu, dış gönderim ve müşteri CSV (P19)

AC-259, 260, 261, 263; tasarım `docs/mimari-e11.md` §8c. Sözleşme kaynağı `packages/contracts/src/api/{requests,notify,customers}.ts`,
`errors.ts`, `permissions.ts`, `audit.ts`. Panel uçları oturum + CSRF (yazma) + yetki + `tenantScope` zincirini kullanır;
Super Admin önce firma seçer. Yanıtlar `Cache-Control: no-store`.

**Yeni yetkiler** (yetki tablosunda kendiliğinden çıkar; Admin açık, User kapalı):

| Anahtar              | Ekranda                        | Açar                                                                             |
| -------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `sessions.send_link` | Bağlantı gönder (SMS/WhatsApp) | Oturum bağlantısını SMS/WhatsApp ile gönderme (+ `sessions.create`)              |
| `customers.export`   | Dışa aktar                     | Müşteri CSV'si (+ `customers.view`)                                              |
| `customers.import`   | İçe aktar                      | CSV önizleme (+ `create` + `view`), uygulama (+ `create`; güncellemede + `edit`) |

**Yeni hata kodları:** `FORM_TOKEN_INVALID` 400 ("Formun süresi doldu, sayfayı yenileyin."), `CHANNEL_UNAVAILABLE` 409.

### GET /api/v1/public/web-requests/form?ref=<ref>

Kimlik yok, çerez yok. Form kapalı, ref geçersiz ya da pasif → aynı gövdeyle 404 `REQUEST_REF_INVALID` (hangisi olduğu
söylenmez); geçersiz ref denemesi IP başına 10/dk, aşımda 429. Geçerli ref'te IP başına 60/dk; ayrıca IPv6 /56 120/dk ve IPv6 /48 240/dk
(IPv4'te önek kovası yok — NAT arkasındaki meşru ziyaretçiler kesilmesin) (aşımda 15 dk 429). Yanıt `WebFormInfo` (müşteri adı **dönmez**):

```json
{ "tenant": { "name": "Acme BT", "logoUrl": "/api/v1/files/logo/01K…/…webp" },
  "consentText": { "id": "01K…", "version": 3, "body": "…", "sha256": "…" },
  "chatRetentionDays": 365,
  "channels": { "sms": true, "whatsapp": false, "email": true },
  "businessHours": { "openNow": true, "nextOpeningAt": null, "afterHoursMode": "ACCEPT" },
  "formToken": "…", "minDelayMs": 2000 }
```

`channels.<k>` yalnız firma kanalı açtıysa **ve** kanal kullanılabilirse `true`. `formToken` 30 dk geçerli, tek kullanımlık,
süreç yeniden başlayınca geçersizdir.

### POST /api/v1/public/web-requests

Kimlik yok; `Origin` `ALLOWED_ORIGINS`'te olmalı (tarayıcı kuralı; CORS başlığı verilmez). Gövde ≤ 8 KB.

```http
POST /api/v1/public/web-requests
Content-Type: application/json
Origin: https://remote.example.com

{ "ref": "…", "formToken": "…", "website": "", "clientInstanceId": "…",
  "customerName": "Ayşe Yılmaz", "phone": "0532 000 00 00", "email": "ayse@example.com",
  "description": "Yazıcı çıktı vermiyor", "consentTextId": "01K…", "consentAccepted": true,
  "notify": { "sms": true, "whatsapp": false, "email": false } }
```

201 → `CreateRequestResponse` `{ requestId, requestSecret, requestCode, expiresAt, position }`. `requestSecret` yalnız bu
yanıtta döner; `/ws/request` için kullanılır (`docs/mimari-protokol.md` §5.5).

Kurallar: alan sınırları programdaki taleple aynı (AC-134). `notify` varsayılanı hepsi `false`; `notify.email` ⇒ `email`
zorunlu. Kapalı/kullanılamaz kanal seçilirse 400 `fields.notify.<kanal>`. Gizli alan `website` doluysa genel 400 `VALIDATION`.
Aynı firmada aynı telefonla (e-postada `notifyEmailKey` eşitliği) bekleyen WEB talebi varsa talep açılır ama ilgili
bildirim bayrakları 0 yazılır; yanıt bunu belirtmez. Talep `source: "WEB"`, `clientVersion: null`; sürüm kapıları uygulanmaz.

| Durum | Kod                   | Ne zaman                                                                                        |
| ----- | --------------------- | ----------------------------------------------------------------------------------------------- |
| 400   | `VALIDATION`          | Alan hatası (`fields`), gizli alan dolu                                                         |
| 400   | `FORM_TOKEN_INVALID`  | Token bozuk, 30 dk'dan eski, kullanılmış, başka ref'e ait ya da sunucu yeniden başlamış         |
| 403   | `FORBIDDEN`           | `Origin` yok ya da izinli değil                                                                 |
| 404   | `REQUEST_REF_INVALID` | Ref geçersiz/pasif ya da form kapalı (tek tip gövde)                                            |
| 409   | `OUTSIDE_HOURS`       | Mesai dışı + "Reddet" modu; `fields.nextOpeningAt`                                              |
| 429   | `RATE_LIMITED`        | Token alındıktan sonra 2 sn dolmadan (`retryAfterSec: 2`, token harcanmaz) ya da IP/önek kovası |
| 429   | `QUEUE_FULL`          | Firma web kovası (60/sa), WEB bekleyen alt tavanı (30) ya da toplam bekleyen (50)               |

Token 2 sn kuralı dışındaki her red sonrasında harcanmıştır; istemci yeniden `GET …/form` çağırır. Talep iptali mevcut
`POST /api/v1/public/requests/cancel` (tarayıcıdan `Origin` ile; her durumda 204).

### GET / PUT /api/v1/settings/support-requests — eklenenler

Yanıta `webFormEnabled`, `webFormUrl` (`<PUBLIC_BASE_URL>/r/<Genel ref>`, form kapalıyken de döner), `notifySmsEnabled`,
`notifyWhatsappEnabled`, `notifyEmailEnabled`, `channelWarnings` (`["sms"|"whatsapp"|"email"]`: açık ama kullanılamayan
kanallar). PUT'ta dört bayrak opsiyoneldir; verilmezse korunur. Form kapatma (kill switch) ve Genel ref yenileme
(`settings.support_requests.ref_rotated`) form bağlantısını hemen 404 yapar.

`GET /api/v1/support-requests` öğelerine `source` (`AGENT`|`WEB`) ve süzgeç `?source=AGENT|WEB`; panel `request.new` += `source`.
`GET /api/v1/customers/:id` += `webFormUrl` (form açık, müşteri aktif ve anonim değilse; aksi `null`).

### GET / PUT /api/v1/settings/sms

GET yetki `settings.view`; PUT `settings.edit`, firma başına 30/dk. Firma (tenant) ayarıdır.

```http
PUT /api/v1/settings/sms
Content-Type: application/json
X-CSRF-Token: …

{ "url": "https://sms.example.com", "header": "ACME", "apiKey": "…" }
```

- `url`: `null` = sistem varsayılanı (`SMSPORTAL_URL`). Yalnız köken + yol; kullanıcı adı/şifre, `?`, `#`, boşluk yok,
  ≤ 255 karakter. Production'da `https` + 443. İç/özel adres → 400 `HOST_NOT_ALLOWED`.
- `header`: `null` ya da 1–11 karakter (`A-Za-z0-9 .-`).
- `apiKey`: yok ya da `""` → korunur; `null` → silinir; dolu → 8–256 yazdırılabilir ASCII, şifreli saklanır (bağlam etkin
  adresin kökeni). Etkin köken değişip anahtar verilmezse 400 `fields.apiKey` = "Adres değişti; API anahtarını yeniden girin."

Yanıt `SmsSettingsView` (anahtar ve sistem varsayılan adresi **asla** dönmez):

```json
{ "url": null, "defaultUrl": true, "header": "ACME", "apiKeySet": true,
  "keyUnreadable": false, "insecure": false, "usable": true, "updatedAt": "2026-11-15T10:00:00.000Z" }
```

`keyUnreadable: true` → kayıtlı anahtar etkin adresle çözülemiyor (ör. `SMSPORTAL_URL` değişti); kanal kullanılamaz, Admin
anahtarı yeniden girer. Değişmeyen PUT audit yazmaz. Hatalar: 400 `VALIDATION` / `HOST_NOT_ALLOWED`, 403, 429.

### POST /api/v1/settings/sms/test

Yetki `settings.edit`; 5/dk/kullanıcı, 20/dk/firma, 3/sa/alıcı. Gövde `{ "phone": "0532 000 00 00" }`. Kayıtlı ayarla sabit
"Nokta Destek test SMS'i" metnini gönderir. 200 → `{ ok, message, reason }`; `reason` ∈ `unconfigured`, `unreachable`
(zaman aşımı dahil), `unauthorized`, `http_error`, `redirect`, `host_not_allowed`. Hatalar: 400 (`fields.phone`: yalnız
TR cep), 403, 429.

smsportal'a giden istek: `POST {url}/api/external/send-sms`, başlık `x-api-key`, gövde `{ phone: "5xxxxxxxxx", message, header? }`;
8 sn zaman aşımı, yönlendirme izlenmez.

### POST /api/v1/sessions/:id/send-link · GET /api/v1/sessions/:id/send-link/options

`options`: yetki `sessions.send_link` → `{ "sms": true, "whatsapp": true, "suggestedPhone": "+905320000000" | null }`
(`suggestedPhone` yalnız talepten doğan oturumda, kendi teknisyenine).

`send-link`: yetki `sessions.create` + `sessions.send_link`; 20/sa/kullanıcı (SMS + WA toplam), 5/sa/alıcı, 200/sa/firma.

```json
{ "channel": "SMS", "phone": "0532 000 00 00", "link": "https://remote.example.com/j/…" }
```

`link` oturumun kendi bağlantısı olmalıdır. 200 → `{ "sent": true }`. Panel artık bu uç yerine `POST /api/v1/customer-send`
(`SESSION`) kullanır; kurallar aynıdır. Mesaj sabit şablondur (LG `renderFor`): firma adı (≤ 30), teknisyen "Ad S.",
bağlantı, 8 haneli kod ve son geçerlilik. WhatsApp'ta ayrıca Windows programı bağlantısı (ikili kapısı açıksa) ve
"Beklemiyorsanız bağlantıyı açmayın, kimseyle paylaşmayın." satırı bulunur; SMS bu iki satırı içermez (≤ 3 parça).

| Durum | Kod                   | Ne zaman                                                                                                     |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| 400   | `VALIDATION`          | `fields.phone` (SMS yalnız TR cep), `fields.link` (bu oturumun bağlantısı değil)                             |
| 404   | `NOT_FOUND`           | Oturum yok ya da başka firmanın                                                                              |
| 409   | `CONFLICT`            | Oturum bekleyen değil                                                                                        |
| 409   | `CHANNEL_UNAVAILABLE` | Kanal yapılandırılmamış ya da güvensiz                                                                       |
| 429   | `RATE_LIMITED`        | Kova aşımı (`retryAfterSec`)                                                                                 |
| 502   | `UPSTREAM`            | Servis hatası; `fields.reason` ∈ `unreachable`, `unauthorized`, `http_error`, `redirect`, `host_not_allowed` |

### Durum bildirimi kuyruğu (yeni uç yok)

WEB talebi kabul edildiğinde, reddedildiğinde ya da süresi dolduğunda, aynı işlemde müşterinin seçtiği **ve** firmanın
açtığı her kanal için `notification_outbox` satırı yazılır. İşçi 2 sn'de bir gönderir; başarısızlıkta 10 sn ve 30 sn sonra
yeniden dener, 3. denemeden sonra FAILED. Kalıcı nedenler (`unconfigured`, `unauthorized`, `host_not_allowed`,
`invalid_phone`, `rate_limited`, `recipient_unreadable`) yeniden denenmez. Tavanlar (`NOTIFY_LIMITS`, DB'de sayılır):
alıcı başına 24 saatte firma içi 3, sistem geneli 5; firma × kanal saatte SMS 100, WHATSAPP 60, EMAIL 100; WA müşteri kovası
sistem 600/sa, firma 60/sa, alıcı 3/sa. Aşımda satır `FAILED rate_limited` + audit `scope`. Alıcı şifreli tutulur, son durumda
silinir; satırlar 7 gün sonra temizlenir.

### GET /api/v1/customers/export.csv?status=active|passive|all

Yetki `customers.view` + `customers.export`; 10/dk/kullanıcı. `text/csv; charset=utf-8`, BOM, `;` ayraç, formül kaçışı,
`attachment; filename="musteriler-YYYYMMDD.csv"`. Sütunlar: Ad, Yetkili kişi, Telefon, E-posta, Not, Dosya etiketi,
Varsayılan öncelik, SLA (dk), Durum. > 50 000 satır → 400 `VALIDATION`.

### POST /api/v1/customers/import/preview

Yetki `customers.import` + `create` + `view`; 10/sa/kullanıcı. `multipart/form-data`, tek alan `file` (≤ 2 MB, UTF-8,
≤ 5 000 veri satırı, kayıt ≤ 8 KB; ayraç başlıktan `;` ya da `,`). 200 → `ImportPreview`:

```json
{ "previewId": "…", "total": 120, "counts": { "create": 100, "conflict": 15, "error": 5 },
  "rows": [ { "line": 2, "kind": "create", "name": "Acme", "…": "…" } ],
  "errors": [ { "line": 7, "column": "E-posta", "message": "…" } ], "errorsTruncated": false, "warnings": [] }
```

`rows` ilk 50 satır; `errors` ≤ 500; `line` dosyadaki fiziksel satır (1 = başlık). Önizleme 15 dk geçerli, kullanıcı başına
tek (yenisi eskisini geçersiz kılar). Hatalar: 400 `VALIDATION` `fields.file` (dosya yok / UTF-8 değil / Ad sütunu yok /
boş), 403, 413 `PAYLOAD_TOO_LARGE`, 429.

### POST /api/v1/customers/import/commit

Yetki `customers.import` + `create`; `onConflict: "update"` ise ayrıca `customers.edit`. Gövde
`{ "previewId": "…", "onConflict": "skip" | "update" }` → 200 `{ total, created, updated, skipped, failed }`. `previewId` tek
kullanımlık. Her yeni müşteriye yeni ref; `Durum` sütunu yok sayılır. Hatalar: 400, 403, 409 `CONFLICT` ("Başka bir içe
aktarma sürüyor"), 428 `PREVIEW_REQUIRED`.

### Audit (P19)

`request.created` += `source`, `notify`, `notifySuppressed?`; `request.web_form_rejected` (`reason` fast | token | honeypot |
token_store_full; IP anahtarı başına dakikada 1); `request.customer_notify` (kanal, tür, maskeli alıcı, sonuç; tavanda
`reason: "rate_limited"`, `scope`); `session.link_sent` (kanal, maskeli alıcı, sonuç); `settings.sms_updated` (eski → yeni
`{url, header, apiKeySet}`, anahtar `***`); `settings.sms_test`; `customer.exported` `{count, status}`; `customer.imported`
`{total, created, updated, skipped, failed, onConflict}` + satır başına `customer.created/updated` (`source: "import"`).
Ref, form token'ı, talep sırrı, gizli alan ve mesaj gövdesi hiçbir kayda yazılmaz.

## 2FA cihaz hatırlama (P27a)

Kaynak: `apps/server/src/auth/{trusted-device,trusted-device-repo,trusted-device-routes,service,account,routes}.ts`,
`users/{routes,writes,service}.ts`, `tenants/settings.ts`, `packages/contracts/src/api/{auth,users,tenants}.ts`. Tasarım
`docs/mimari-p27a.md`. Yeni hata kodu ve env yok.

### Mevcut uçlarda değişenler

| Uç                         | Değişiklik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/login`         | Girdi aynı; `__Secure-rs_td` çerezi (en çok 2 değer) **yalnız şifre doğrulandıktan sonra** okunur. Geçerli belirteçte `mfaRequired: false`, yeni belirteçle `Set-Cookie` (Max-Age = kalan süre), audit `auth.trusted_device_used` + `auth.login {mfa:"remembered"}`. Bilinmeyen/süresi dolmuş/izinsiz belirteçte TOTP adımı ve çerez silinir. Eski nesil belirteç (yeniden kullanım): TOTP adımı, kullanıcının tüm hatırlanan cihazları silinir ve diğer tüm oturumları kapanır, audit `auth.trusted_device_reuse` (`fail`), e-posta. Zorunlu şifre değişimi ve 2FA kurulumu atlanmaz. |
| `POST /auth/mfa/verify`    | `{ "code": "123456", "rememberDevice": true }`. Kurtarma koduyla `rememberDevice` → 400 `VALIDATION`. Yanıta `deviceRemembered: boolean`. Firma anahtarı kapalıysa veya kullanıcı Super Admin ise `true` hata vermeden yok sayılır (`deviceRemembered: false`). Başarıda audit `auth.trusted_device_created` ve "Yeni cihaz hatırlandı" e-postası (SMTP yoksa `mail.sent` `not_configured`).                                                                                                                                                                                           |
| `GET /auth/me`             | `mfa.rememberDeviceAvailable` — aşama `verify`, TOTP etkin ve izin varsa `true`; Super Admin'de her zaman `false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POST /auth/logout-all`    | Yanıt `{ "revokedSessions": 2, "revokedTrustedDevices": 1 }`; bu tarayıcının hatırlama çerezi de silinir.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET/PUT /settings/tenant` | `mfaRememberDevice: boolean` (varsayılan `true`; yetki `settings.edit`). `false` yazmak firmanın tüm hatırlanan cihazlarını aynı işlemde siler; audit'e `revokedTrustedDevices`.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET /users/:id`           | `trustedDeviceCount: number`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Hatırlamayı silen diğer olaylar (aynı işlemde; ilgili audit satırına `revokedTrustedDevices`): şifre değişimi ve sıfırlama,
Super Admin sıfırlaması, Admin 2FA sıfırlaması, 2FA'nın yeniden etkinleştirilmesi, kullanıcı veya firma pasifi.

### GET /api/v1/auth/trusted-devices

Tam oturum, yalnız kendi cihazları (en yeni önce, en çok 10). Yarım (2FA bekleyen) oturumda 403 `MFA_REQUIRED`, oturumsuz 401.

```json
{ "items": [ { "id": "01K…", "uaSummary": "Chrome · Windows", "ip": "203.0.113.7", "createdAt": "2026-11-15T08:00:00.000Z",
               "lastUsedAt": "2026-11-16T07:55:00.000Z", "expiresAt": "2026-12-15T08:00:00.000Z", "current": true } ] }
```

### DELETE /api/v1/auth/trusted-devices/:id · DELETE /api/v1/auth/trusted-devices

Tam oturum + CSRF. Yanıt `{ "revoked": 1, "currentCleared": true }` (`currentCleared` → bu tarayıcının çerezi de silindi).
Başkasına ait ya da olmayan id 404, biçimsiz id 400. Audit `auth.trusted_device_revoked {reason:"user", count}`.

### POST /api/v1/users/:id/forget-devices

Yetki `users.edit`; gövde `{}`. Yanıt `{ "revoked": 3 }`. Kendi hesabı 403 (profil yolu kullanılır), daha geniş yetkili hesap
403, başka firma 404. Audit `auth.trusted_device_revoked {reason:"admin", count}`.

## Gözetimsiz erişim (P27)

Kaynak: `apps/server/src/unattended/{routes,service,connect,registration,contacts,gate,download,hub,device-ws}.ts`,
`signaling/admit-device.ts`, `packages/contracts/src/{api/unattended.ts,ws-device.ts,errors.ts,permissions.ts,audit.ts}`.
Tasarım `docs/mimari-p27.md`; operasyon runbook §27. Yetkiler `unattended.connect`, `unattended.manage`. Tüm uçlar firma
kapsamlıdır (Super Admin bir firma seçmelidir); başka firmanın kaydı 404.

**İmza kapısı (`UNATTENDED_MODE`):** `off` (varsayılan) → kayıt kodu, kayıt ve bağlantı 409 `UNATTENDED_DISABLED`;
`unsigned` yalnız `DEPLOY_ENV=staging`; `signed` → cihaz imzalı ve SHA-256'sı `UNATTENDED_SIGNED_SHA256`'da olmalı.

### Uçlar (`/api/v1/unattended`)

| Uç                                             | Yetki                                               | Girdi                                                                                          | Çıktı                                                                                                | Hatalar                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /status`                                  | `connect` ∨ `manage`                                | —                                                                                              | `{ mode, available, notifyChannel }`                                                                 | —                                                                                                                      |
| `GET /devices`                                 | `connect` ∨ `manage`                                | `q?` (≤ 64), `customerId?`, `state` `online\|offline\|all`, `cursor?`, `limit` 1–100 (50)      | `{ items: DeviceListItem[], nextCursor }`; `manage` yoksa yalnız yetkili cihazlar                    | 400                                                                                                                    |
| `GET /devices/:id`                             | yetkili `connect` ∨ `manage`                        | —                                                                                              | `DeviceDetail` (`lastIp`, `registeredIp`, `registeredAt`, `grants` yalnız `manage`'de dolu)          | 404                                                                                                                    |
| `PUT /devices/:id/grants`                      | `manage` (+ ekleme varsa step-up)                   | `{ "userIds": ["01K…"] }` (tam küme, ≤ 200; boş = tümünü kapat)                                | `{ grants }`                                                                                         | 400 (`fields.userIds`: başka firma/pasif/`connect` yetkisiz), 401 `MFA_STEP_UP_REQUIRED`, 404                          |
| `POST /devices/:id/revoke`                     | `manage`                                            | `{}`                                                                                           | 204; açık bağlantı ≤ 10 sn'de kesilir                                                                | 404, 409 (zaten iptal)                                                                                                 |
| `POST /devices/:id/connect`                    | `connect` + cihaz yetkisi + step-up (**tüketilir**) | `{}`                                                                                           | `{ "sessionId": "01K…" }` → konsol `/sessions/:id/console`                                           | aşağıdaki zincir                                                                                                       |
| `GET /registration-codes`                      | `manage`                                            | —                                                                                              | bekleyen kodlar `{ id, customerId, customerName, createdBy, expiresAt }` (kod yok)                   | —                                                                                                                      |
| `POST /registration-codes`                     | `manage` + step-up                                  | `{ "customerId": "01K…" }`                                                                     | `{ id, code: "ABCD-1234-EFGH-5678", expiresAt, downloadUrl }` (kod **bir kez**; 24 sa, tek kullanım) | 404, 409 `UNATTENDED_DISABLED` / `NOTIFY_CONTACT_REQUIRED` / `NOTIFY_CHANNEL_UNAVAILABLE` / `CONFLICT` (müşteri pasif) |
| `DELETE /registration-codes/:id`               | `manage`                                            | —                                                                                              | 204                                                                                                  | 404                                                                                                                    |
| `GET /customers/:customerId/contacts`          | `manage`                                            | —                                                                                              | `{ items: [{ email, phone }] }`                                                                      | 404                                                                                                                    |
| `PUT /customers/:customerId/contacts`          | `manage` + step-up                                  | `{ "items": [{ "email": "bt@musteri.com.tr", "phone": "05321234567" }] }` (0–5, tekil e-posta) | `{ items }`; fark varsa eski ve yeni adreslerin hepsine değişiklik e-postası                         | 400, 401 `MFA_STEP_UP_REQUIRED`, 404                                                                                   |
| `GET /download`                                | `manage`                                            | —                                                                                              | `NoktaDestekServis.exe`                                                                              | 503 (SHA uyuşmazlığı / yayın yok)                                                                                      |
| `POST /register` (cihaz; çerezsiz, Origin'siz) | kayıt kodu                                          | `{ code, publicKey, name, osVersion, version, sha256, signed }`                                | `{ deviceId, tenantName, customerName }`                                                             | 404 `REGISTRATION_CODE_INVALID`, 409 `UNATTENDED_DISABLED`, 429                                                        |

`DeviceListItem`: `{ id, name, customerId, customerName, online, localEnabled, signatureOk, lastSeenAt, lastSessionAt,
grantCount, canConnect, connectBlockedReason, verified, notifyFailed, replacedAlert }`. `connectBlockedReason`:
`no_grant` | `unsigned` | `offline` | `outdated` (P28u) | `local_disabled` | `no_contacts` | `smtp` | `null`. P28u'dan
beri ek alan `userState` ve panel yoklaması 8 sn (bkz. "Gözetimsiz onaysız bağlantı ve müdahale (P28u)").
Ayrıca `GET /sessions?deviceId=` ve `GET /users/options?unattendedGrantable=1` (`manage`) eklendi. Etkin cihaz varken
SMTP alanını değiştiren `PUT /settings/tenant` step-up ister (401 `MFA_STEP_UP_REQUIRED`). Eski SMTP kaydı varsa kayıttan
önce firmadaki diğer `unattended.manage` / `settings.edit` sahiplerine eski ayarla bilgi e-postası gider; eski kayıt yoksa
gönderim denenmez. Gönderim başarısız olsa da ayar kaydedilir.

**Pasif müşteri (D-P27-K2):** pasif müşteriye `POST /registration-codes` → 409 `CONFLICT` ("Müşteri pasif; kayıt kodu
oluşturulamaz."). Müşteri pasife alınınca cihazları iptal edilir ve kullanılmamış kayıt kodları aynı işlemde silinir (müşteri
pasif audit'inde `cancelledRegistrations` sayısı). Kod hâlâ duruyorken müşteri pasif ya da anonimleştirilmişse
`POST /register` geçersiz kodla aynı 404 `REGISTRATION_CODE_INVALID` gövdesini döner ve kod **tüketilmez**.

**SMTP değişikliği audit'i:** yukarıdaki koşulda (etkin cihaz var + SMTP değişiyor) `tenant_settings.updated` kaydının
`newValue`'suna iki alan eklenir:

| Alan                | Değer                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unattendedDevices` | Firmadaki iptal edilmemiş gözetimsiz cihaz sayısı                                                                                                                                   |
| `smtpChangeNotice`  | `sent` (en az bir alıcıya gitti, hata yok) · `failed` (en az bir gönderim başarısız) · `no_recipients` (alıcı yok) · `no_previous_config` (eski SMTP kaydı yok, gönderim denenmedi) |

### Bağlantı ön koşul zinciri (ilk başarısız olan döner)

| #   | Denetim                                              | Hata                                                                                     |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Oturum + firma etkin                                 | 401 / 403                                                                                |
| 2   | `unattended.connect`                                 | 403 `FORBIDDEN`                                                                          |
| 3   | Cihaz bu firmada, iptal edilmemiş, cihaz yetkisi var | 404 `NOT_FOUND`                                                                          |
| 4   | Son 5 dk içinde step-up                              | 401 `MFA_STEP_UP_REQUIRED` / 403 `MFA_SETUP_REQUIRED`                                    |
| 5   | Cihazda yerel anahtar açık                           | 409 `DEVICE_LOCAL_DISABLED` "Yerel olarak kapalı"                                        |
| 6   | Müşteride ≥ 1 bildirim adresi                        | 409 `NOTIFY_CONTACT_REQUIRED`                                                            |
| 6b  | Firmanın SMTP kaydı var                              | 409 `NOTIFY_CHANNEL_UNAVAILABLE` "Bildirim e-postası yapılandırılmamış — Ayarlar → SMTP" |
| 7   | İmza kapısı                                          | 409 `UNATTENDED_DISABLED` "Gözetimsiz erişim kod imzası olmadan kullanılamaz"            |
| 8   | Cihaz çevrimiçi                                      | 409 `DEVICE_OFFLINE`                                                                     |
| 9   | Cihazda başka gözetimsiz bağlantı yok                | 409 `DEVICE_BUSY`                                                                        |
| 10  | Açık oturum sınırı; step-up tüketimi                 | 409 `OPEN_SESSION_LIMIT`, 401 `MFA_STEP_UP_REQUIRED`                                     |

Bir doğrulama tek bağlantı açar; aynı step-up ile ikinci bağlantı 401. Hız sınırı: bağlantı kullanıcı başına 20/sa; kayıt IP
başına 10/sa, yanlış kodda IP başına 5 hatada 15 dk kilit. Cihaz 60 sn'de katılmazsa oturum `CANCELLED(device_timeout)`.

```bash
curl -sk -X POST https://localhost:4450/api/v1/unattended/devices/01K…/connect \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' -H "X-CSRF-Token: $CSRF" \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF" -d '{}'
```

### WebSocket `/ws/device` (yalnız servis)

`wss://<host>/ws/device`, alt protokol `rs.device.v1`, sorgu dizesi yok, `Origin` başlığı **olmamalı** (tarayıcıdan açılamaz).
Kimliksiz soket tavanı süreç başına 1000, IP başına 5 (aşımda 503). Mesaj ≤ 4 KB.

| Yön   | Mesaj                                                                                      | Anlam                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| S → C | `device.hello{v, nonce}`                                                                   | Açılış; 10 sn içinde `device.auth` gelmezse 4401                                                      |
| C → S | `device.auth{deviceId, sig, version, sha256, signed, localEnabled, osVersion}`             | Ed25519 imza: `"rs-device-auth-v1\n" + nonce + "\n" + deviceId + "\n" + PUBLIC_BASE_URL kökeni`       |
| S → C | `device.ready{tenantName, customerName}`                                                   | Başarı. Kapanış 4401 (imza/iptal/firma pasif), 4403 (imza kapısı), 4409 (aynı cihaz yeniden bağlandı) |
| S → C | `connect{sessionId, ticket, techName, tenantName, techIp, expiresInSec}`                   | Bağlantı isteği; yardımcı süreç `/ws/guest`'e biletle katılır                                         |
| C → S | `connect.result{sessionId, ok, reason?}`                                                   | `local_disabled` \| `indicator_failed` \| `helper_failed` \| `no_console` \| `busy`                   |
| S → C | `disconnect{sessionId, reason}` · `revoked{}`                                              | Sunucu tarafı bitiş · Admin iptali (ardından 4401)                                                    |
| C → S | `device.state{localEnabled}` · `session.closed{sessionId, reason}` · `device.unregister{}` | Yerel anahtar değişti · yardımcı çıktı · kaldırma                                                     |

Sunucudan yerel anahtarı değiştiren mesaj yoktur. Konsol bitiş nedenlerine `device_revoked`, `local_disabled`,
`indicator_failed`, `device_timeout`, `session_changed` eklendi; kontrol kaynağı `UNATTENDED`.

### Audit ve metrik

Audit eylemleri `unattended.code.created/cancelled`, `unattended.device.registered/revoked/auth/replaced`,
`unattended.grant.changed` (`selfGrant`), `unattended.contacts.changed` (maskeli), `unattended.notify.failed`,
`unattended.connect` (`stepUpMethod`), `unattended.session.started/ended`, `unattended.local_state`. Kayıt kodu, bilet, nonce
ve anahtar yazılmaz. Metrikler `rs_unattended_*` (runbook §27.8).

## Müşteriye bağlantı gönderme (LG)

Kaynak: `apps/server/src/customer-send/{routes,service,targets}.ts`, `apps/server/src/notify/customer-templates.ts`,
`apps/server/src/unattended/public-download.ts`, `packages/contracts/src/api/customer-send.ts`. Tasarım
`docs/mimari-link-gonderme.md` (r2); gereksinim AC-405..428. Web: `components/send-to-customer/` (tek diyalog; oturum
kartı, kayıt kodu penceresi ve müşteri ayrıntısından açılır).

Mesaj metnini yalnız sunucu üretir. İstemci hedef kimliğini, kanalı ve alıcıyı gönderir. Önizleme (`options`) ve gönderim
aynı şablon fonksiyonundan (`renderFor`) geçer; müşteriye giden metin önizlemeyle karakter karakter aynıdır.

Üç hedef türü vardır:

| Tür (`kind`)           | İçerik                                                                                                                           | Kanallar                   | Yetki                                                                                          | Alıcı                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `SESSION` (K1)         | Oturum bağlantısı, 8 haneli kod, son geçerlilik, Windows istemci indirme bağlantısı (`/public/agent/download`)                   | `EMAIL`, `WHATSAPP`, `SMS` | `EMAIL`: `sessions.create`; `WHATSAPP`/`SMS`: `sessions.send_link`. Yalnız oturumun teknisyeni | Serbest; müşteri kaydı ve talepten öneri                        |
| `UNATTENDED_CODE` (K2) | Servis indirme bağlantısı (oturumsuz, aşağıda), kayıt kodu, son geçerlilik, 4 adım; e-postada `NoktaDestekServis.exe` ve SHA-256 | Yalnız `EMAIL` (r2 O-LG-3) | `unattended.manage` + kodu üreten kullanıcı                                                    | Kilitli: yalnız müşterinin `customer_notify_contacts` kayıtları |
| `CUSTOMER` (K3)        | Müşteriye özel Hızlı Destek bağlantısı ve (web formu açıksa) `/r/<ref>` talep bağlantısı                                         | `EMAIL`, `WHATSAPP`        | `customers.view` + `sessions.send_link`                                                        | Serbest; müşteri kaydı ve bildirim adreslerinden öneri          |

Uçlar `requireAuth` + CSRF + firma bağlamı ister (Super Admin bir firma seçmelidir). Tüm yanıtlarda
`Cache-Control: no-store`. Gizli değerler (bağlantı, kod) yalnız gövdede taşınır, sorgu dizesine konmaz.

**Hedef şeması (`target`)** — kimlikler 26 karakter ULID:

```json
{ "kind": "SESSION", "sessionId": "01K…", "link": "https://remote.example.com/session/<token>" }
{ "kind": "UNATTENDED_CODE", "codeId": "01K…", "code": "ABCD-1234-EFGH-5678" }
{ "kind": "CUSTOMER", "customerId": "01K…" }
```

- `SESSION.link` (≤ 500): oluşturma yanıtındaki bağlantı; `${PUBLIC_BASE_URL}/session/<token>` biçiminde olmalı ve
  token'ın SHA-256'sı oturumla eşleşmeli.
- `UNATTENDED_CODE.code` (16–19 karakter): biçimli ya da tiresiz; sunucu normalize eder ve HMAC'ini kod kaydıyla karşılaştırır.
- Nesneler katıdır; fazladan alan 400.

**Hedef çözümleme hata sırası** (iki uçta aynı): 404 → 403 → 400 → 409.

| HTTP | Kod                   | Ne zaman                                                                                                                                                                                                                                                 |
| ---- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 404  | `NOT_FOUND`           | Kayıt yok ya da başka firmanın; K1 oturum başka teknisyenin; K2 `unattended.manage` yok ya da kodu başkası üretti                                                                                                                                        |
| 403  | `FORBIDDEN`           | K1: hiçbir kanal yetkisi yok; K3: `customers.view` veya `sessions.send_link` yok                                                                                                                                                                         |
| 400  | `VALIDATION`          | Şema; `fields.link` "Bağlantı bu oturuma ait değil."; `fields.code` "Kayıt kodu bu kayıtla eşleşmiyor."                                                                                                                                                  |
| 409  | `UNATTENDED_DISABLED` | K2: gözetimsiz kapısı kapalı (`UNATTENDED_MODE`)                                                                                                                                                                                                         |
| 409  | `CONFLICT`            | K1 "Yalnız bekleyen oturumun bağlantısı gönderilebilir."; K2 "Kayıt kodu artık geçerli değil; yeni kod oluşturun." (kullanılmış, süresi dolmuş, iptal edilmiş); K2 "Müşteri pasif; kayıt kodu gönderilemez."; K3 "Müşteri pasif; bağlantı gönderilemez." |

### POST /api/v1/customer-send/options

Pencere açılınca çağrılır. Gönderim, sayaç ya da audit yazmaz.

İstek: `{ "target": <hedef> }`

Yanıt 200:

```json
{
  "kind": "UNATTENDED_CODE",
  "channels": [{ "channel": "EMAIL", "available": true, "block": null, "settingsHref": "/settings/smtp" }],
  "recipients": { "email": [{ "value": "it@musteri.com", "source": "contact" }], "phone": [] },
  "recipientsLocked": true,
  "previews": { "EMAIL": { "subject": "Firma – uzaktan destek servisi kurulumu", "text": "Merhaba,\n\n…" } },
  "remainingSends": 3
}
```

- `channels`: yalnız tür için tanımlı **ve** kullanıcının yetkili olduğu kanallar. Yetkisiz kanal listeye hiç girmez.
- `block` (`available: false` iken): `unconfigured` (e-posta: firma SMTP kaydı yok ya da K2'de servis ikili kapısı
  kapalı; WhatsApp: servis kullanılamaz; SMS: firma SMS ayarı yok), `insecure_transport` (K2 WhatsApp için ayrılmış;
  bugün K2'de WhatsApp tanımlı olmadığından dönmez), `no_recipient` (K2: kanal için kayıtlı adres yok).
- `settingsHref`: `settings.view` varsa `/settings/smtp` ya da `/settings/sms`; WhatsApp için yalnız Super Admin'e
  `/admin/settings/whatsapp`; aksi `null`.
- `recipients.*.source`: `contact` (bildirim adresi), `customer` (müşteri kaydı), `request` (talepteki telefon).
- `previews`: yalnız kullanılabilir kanallar için; `subject` yalnız `EMAIL`'de.
- `remainingSends`: K2'de `3 − sent_count`; diğerlerinde `null`.

Hatalar: yukarıdaki hedef çözümleme tablosu; 401/403 oturum ve CSRF hataları.

### POST /api/v1/customer-send

İstek:

```json
{ "target": { "kind": "CUSTOMER", "customerId": "01K…" }, "channel": "WHATSAPP", "to": "+905320000000" }
```

- `channel` ∈ `EMAIL`, `WHATSAPP`, `SMS`; tür için tanımlı olmalı.
- `to` (1–254, kırpılır): `EMAIL` için geçerli e-posta (≤ 254); `WHATSAPP`/`SMS` için E.164. SMS yalnız Türkiye cep (+90 5…).
- K2'de `to` müşterinin bildirim adreslerinden biri olmalı (e-posta büyük/küçük harf duyarsız karşılaştırılır).

Yanıt 200: `{ "sent": true }`

Akış: hedef çözümleme → kanal türde yoksa 400 → kanal yetkisi yoksa 403 → kanal kullanılamazsa 409 → alıcı denetimi 400
→ gönderim. K1 mevcut P10 (`POST /sessions/:id/email`) ve P19 (`POST /sessions/:id/send-link`) servis fonksiyonlarına
devredilir; tavanları, audit eylemleri (`session.email`, `session.link_sent`) ve hata eşlemeleri aynen geçerlidir.
K2/K3 tek işlemde sınırları ayırır (`phase:"reserved"` audit), işlem dışında gönderir ve sonucu ikinci audit
satırına (`phase:"result"`) yazar. Başarısız gönderim K2 hakkını geri vermez. Otomatik yeniden deneme yoktur.

| HTTP | Kod                                | Ne zaman                                                                                                                                                                                                                                                        |
| ---- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `VALIDATION`                       | `fields.to` ("Geçerli bir e-posta adresi girin.", "Telefonu +90… biçiminde girin.", SMS yalnız TR cep, K2 "Alıcı müşterinin kayıtlı bildirim adreslerinden seçilmelidir."); `fields.channel` "Bu gönderim için kanal desteklenmiyor."; hedef çözümleme 400'leri |
| 403  | `FORBIDDEN`                        | Seçilen kanal için yetki yok; hedef çözümleme 403'leri                                                                                                                                                                                                          |
| 404  | `NOT_FOUND`                        | Hedef çözümleme                                                                                                                                                                                                                                                 |
| 409  | `CHANNEL_UNAVAILABLE`              | Kanal yapılandırılmamış, alıcı yok ya da servis yapılandırılmamış                                                                                                                                                                                               |
| 409  | `CONFLICT` · `UNATTENDED_DISABLED` | Hedef çözümleme; K2 kod bu arada kullanıldı/süresi doldu                                                                                                                                                                                                        |
| 429  | `RATE_LIMITED`                     | Sınır aşıldı (aşağıda); `Retry-After`. K2'de 4. gönderim (`retryAfterSec` 3600)                                                                                                                                                                                 |
| 502  | `UPSTREAM`                         | E-posta: tek genel SMTP mesajı. WhatsApp/SMS: sabit mesaj + `fields.reason` ∈ `unreachable`, `unauthorized`, `http_error`, `redirect`, `host_not_allowed`. Sağlayıcının ham hatası dönmez                                                                       |

**Sınırlar**

| Sınır                                                               | Değer                                        |
| ------------------------------------------------------------------- | -------------------------------------------- |
| K1 e-posta, kullanıcı başına                                        | 20/sa (P10)                                  |
| K1 WhatsApp/SMS + K2 + K3 (her kanal), kullanıcı başına ortak havuz | 20/sa (`phase:"reserved"` satırları sayılır) |
| Aynı alıcı, firma kapsamlı (K1 e-posta hariç)                       | 5/sa                                         |
| Firma toplamı (K1 e-posta hariç)                                    | 200/sa                                       |
| K2 kayıt kodu başına (tüm kanallar)                                 | 3 (koşullu `sent_count` artışı)              |

**Audit:** `unattended.code.sent` (K2; `{phase, channel, recipient, customerId, result?, reason?}`) ve
`customer.link_sent` (K3; `{phase, channel, recipient, links: ["download","webform"], result?, reason?}`). Alıcı
`maskEmail`/`maskPhone` ile maskelenir. Kayıt kodu, indirme belirteci, bağlantı ve ref audit'e ve loga yazılmaz.
Metrik `rs_link_send_total{kind, channel, result}`.

### GET /api/v1/public/unattended/download?t=<belirteç>

K2 e-postasındaki servis kurulum bağlantısı. **Oturumsuz ve çerezsiz** ayrı eklentidir; panel kancaları uygulanmaz.

- `t`: 43 karakter base64url (`[A-Za-z0-9_-]{43}`). Sunucu anahtarlı HMAC ile normalize kayıt kodundan türetilir
  (amaç `unattended-download`, 256 bit). DB'de yalnız SHA-256'sı tutulur; bağlantı kodu içermez.
- Kod geçerli kaldıkça birden çok indirmeye izin verilir.

Denetim sırası: biçim → IP 20/dk → kod yüklemi (`usableCodeWhere`: kullanılmamış, süresi dolmamış, müşteri ACTIVE ve
anonim değil, firma ACTIVE) + gözetimsiz kapısı → servis ikili kapısı. 503 yalnız geçerli belirteçle tetiklenebilir.

Yanıt 200: `Content-Type: application/vnd.microsoft.portable-executable`,
`Content-Disposition: attachment; filename="NoktaDestekServis.exe"`, gövde dosya akışı.

Her yanıtta `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`,
`X-Content-Type-Options: nosniff`.

| HTTP | Kod            | Ne zaman                                                                                                                                                  |
| ---- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 404  | `NOT_FOUND`    | Tek tip: biçim bozuk, belirteç bilinmiyor, kod kullanılmış/iptal edilmiş/süresi dolmuş, müşteri pasif ya da anonim, firma pasif, gözetimsiz kapısı kapalı |
| 429  | `RATE_LIMITED` | IP (IPv6 /64) başına dakikada 20'yi aşan istek; `Retry-After`                                                                                             |
| 503  | `NOT_READY`    | "Servis programı şu an indirilemiyor." — ikili yok ya da SHA-256'sı `UNATTENDED_AGENT_SHA256` ile uyuşmuyor                                               |

`HEAD` her zaman gövdesiz 404 döner ve audit yazmaz.

**Audit (ipucu):** başarılı indirme `unattended.code.downloaded` (`username: "public"`, `{customerId, ua}`; `ua` yalnız
tarayıcı/işletim sistemi ailesi). Aynı kod + IP için saatte en çok 1, kod başına toplam en çok 10 satır; sonrakiler yalnız
metrikte. E-posta güvenlik tarayıcıları ve mesaj uygulaması önizlemeleri de bu satırı oluşturabilir; satır "müşteri
indirdi" kanıtı değildir. Metrik `rs_unattended_download_total{result}` (`ok`, `not_found`, `rate_limited`, `not_ready`).

## Pano ve uzaktan yazdırma (P28a)

Kaynak: `docs/mimari-p28.md` §4, ADR-0031, `packages/contracts/src/ws-clip-print.ts` ve `dc-clip-print.ts`
(fikstür `packages/contracts/fixtures/clip-print.json`; aynı dosya Go testinde kullanılır). **Yeni REST ucu, tablo, migration
ve env değişkeni yoktur.** İçerik (pano metni, PDF baytları, dosya adı, SHA-256) WebSocket'ten **geçmez**; WS yalnız
yetkilendirme, durum ve audit taşır, içerik DataChannel'dadır. Sunucu misafire ilettiği her mesajı alanlarını yeniden kurarak
gönderir; misafir yalnız sunucunun WS ile yetkilediği kimliğe (`cid`/`pid`) ait DC içeriğini uygular.

### Yetki ve yetenek bildirimi

| Yetki                      | `caps` değeri | Açıklama (toggle ekranı)                                                                               |
| -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| `remote_control.clipboard` | `clipboard`   | Kontrol izni verilmiş oturumda, müşteri ayrıca izin verirse düz metin panosunu gönderir ve alır.       |
| `file_transfer.print`      | `print`       | Müşterinin onayıyla PDF belgeyi müşterinin varsayılan yazıcısına gönderir (yalnız Windows uygulaması). |

Rol varsayılanı: Admin açık, User kapalı. `file_transfer.print`, `file_transfer.use`'dan bağımsızdır. Yetki daralırsa
`caps.update` gider ve bekleyen iş iptal olur; genişleme yeni oturumda geçerlidir.

- Windows istemci (0.13.0+) `/ws/guest`'e `Sec-WebSocket-Protocol: rs.v1, rs.ticket.<t>|rs.reconnect.<r>, rs.cap.clip1, rs.cap.print1`
  ile bağlanır. Sunucu yanıtı yalnız `rs.v1`'dir. Tarayıcı misafiri belirteç bildirmez (sunucu tarayıcı misafirinde de özellikleri boş sayar).
- **Gözetimsiz odada** (P27 servisi) sunucu belirteçleri okumaz: `guestFeatures = []`; `clip.push` / `clip.pull` /
  `print.request` → `error{FORBIDDEN}`.
- Misafire giden `hello.caps` ve `caps.update` yeni değerleri (`clipboard`, `print`) yalnız misafir ilgili belirteci
  bildirdiyse içerir; eski istemciye bugünkü iki değer (`remote_control`, `file_transfer`) gider.
- Teknisyene giden `hello` ve `peer.joined{role:"guest"}` yeni isteğe bağlı alan taşır: `guestFeatures?: ("clipboard"|"print")[]`
  (yoksa `[]`); `hello` ayrıca `clipConsent?: boolean`.
- Misafirden gelen `clip.*` / `print.*` mesajları yalnız ilgili özelliği bildiren sokette şemadadır; yeteneksiz sokette
  ya da şema dışı alanla gelirse bağlantı **1008** ile kapanır.

### WS mesajları

Kimlikler `cid`, `pid`: `^[A-Za-z0-9_-]{8,26}$` (konsol üretir, 16 bayt rastgele base64url). Teknisyen mesajları
isteğe bağlı `id` (istek kimliği, ≤ 26) taşıyabilir.

| `t`             | Yön                 | Alanlar                                                                                                  | Kural                                                                                                                                                                   |
| --------------- | ------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clip.consent`  | misafir→S→teknisyen | `on: boolean`                                                                                            | `on:true` yalnız kontrol `GRANTED` iken kabul; değilse misafire `clip.consent{on:false}`. Oda başına değişim ≤ 6/dk; aşan yok sayılır, misafire `{on:false}`, audit yok |
| `clip.consent`  | S→misafir           | `on: false`                                                                                              | Sunucu kapattı (kontrol `VIEW`'a döndü, yetki daraldı); istemci kutuyu kapatır, yanıt göndermez                                                                         |
| `clip.push`     | teknisyen→S→misafir | `cid`, `bytes: 1..65536`                                                                                 | Kapı sırası aşağıda. Geçerse oda başına tek bekleyen pano işi kurulur (10 sn)                                                                                           |
| `clip.pull`     | teknisyen→S→misafir | `cid`                                                                                                    | `clip.push` ile aynı kapı                                                                                                                                               |
| `clip.report`   | misafir→S           | `cid`, `dir: "TO_CUSTOMER"\|"TO_TECH"`, `bytes: 0..65536`, `result`                                      | Yalnız bekleyen `cid` eşleşirse; audit `clipboard.transfer`, teknisyene `clip.status`                                                                                   |
| `clip.status`   | S→teknisyen         | `cid`, `result`, `bytes`                                                                                 | 10 sn içinde rapor yoksa sunucu `TIMEOUT`, misafir koparsa `DISCONNECTED` üretir                                                                                        |
| `print.request` | teknisyen→S→misafir | `pid`, `sizeBytes: 5..20971520`                                                                          | Kapı sırası aşağıda. Geçerse oda başına tek bekleyen yazdırma işi (10 dk). Dosya adı ve hash WS'den geçmez                                                              |
| `print.cancel`  | teknisyen→S→misafir | `pid`                                                                                                    | Bekleyen eşleşirse iletilir; eşleşmezse yok sayılır. Teknisyen koparsa sunucu kendisi üretir                                                                            |
| `print.report`  | misafir→S           | `pid`, `decision: "APPROVED"\|"REJECTED"\|"TIMEOUT"\|"NONE"`, `result`, `pages?: 1..100000`, `sizeBytes` | Yalnız bekleyen `pid` eşleşirse; audit `print.job`; `REJECTED`/`TIMEOUT` → 30 sn bekleme; teknisyene `print.status`                                                     |
| `print.status`  | S→teknisyen         | `pid`, `result`, `pages?`                                                                                | 10 dk içinde rapor yoksa `ABANDONED`, misafir koparsa `DISCONNECTED`                                                                                                    |

Kontrol `VIEW`'a her dönüşte: pano izni kapanır (misafire `clip.consent{on:false}`, audit `clipboard.consent{by:"system", reason:"control_closed"}`);
bekleyen yazdırma iptal edilir (misafire `print.cancel`, teknisyene `print.status{CANCELLED}`, audit `print.job{result:"CANCELLED", reportedBy:"server"}`).

**Sonuç kümeleri**

- Pano: `OK`, `EMPTY`, `TOO_LARGE`, `SENSITIVE` (parola yöneticisi işaretli içerik okunmadı), `INVALID`, `DENIED`, `ERROR`,
  `TIMEOUT`, `DISCONNECTED` (son ikisini sunucu da üretir; `DISCONNECTED` yalnız sunucu).
- Yazdırma: `PRINTED`, `NO_PRINTER`, `REJECTED`, `TIMEOUT`, `INVALID_PDF`, `TOO_LARGE`, `BUSY`, `CANCELLED`, `ERROR`,
  `ABANDONED`, `DISCONNECTED` (son ikisi yalnız sunucu).

### Sunucu kapısı ve hata kodları

Kapı sırayla denenir; ilk tutan `error{code, message}` döner ve mesaj misafire iletilmez. Kapı retleri audit'e yazılmaz;
`rs_clip_print_denied_total{kind,reason}` artar ve server loguna oda başına dakikada en çok 1 satır `ws_clip_print_denied` düşer.

| Sıra | Koşul                                                    | Pano (`clip.push`/`clip.pull`)                                                                     | Yazdırma (`print.request`)                                                             | `reason`                    |
| ---- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------- |
| 1    | Yetki yok / oturum `caps`'inde yok                       | `FORBIDDEN` "Pano yetkiniz yok."                                                                   | `FORBIDDEN` "Uzaktan yazdırma yetkiniz yok."                                           | `permission`                |
| 2    | Kabul edilmiş müşteri yok                                | `CONFLICT` "Müşteri bağlı değil."                                                                  | aynı                                                                                   | `no_guest`                  |
| 3    | Misafir özelliği bildirmedi (eski, tarayıcı, gözetimsiz) | `FORBIDDEN` "Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin." | aynı                                                                                   | `feature`                   |
| 4    | Kontrol `GRANTED` değil                                  | `FORBIDDEN` "Önce uzaktan kontrol izni alın."                                                      | aynı                                                                                   | `control`                   |
| 5    | Müşteri pano kutusu kapalı (yalnız pano)                 | `FORBIDDEN` "Müşteri pano iznini açmadı."                                                          | —                                                                                      | `consent`                   |
| 6    | Bekleyen iş var                                          | `CONFLICT` "Önceki pano işlemi sürüyor."                                                           | `CONFLICT` "Önceki yazdırma işi sürüyor."                                              | `pending`                   |
| 7    | Hız / sınır                                              | `RATE_LIMITED` (son 60 sn'de ≥ 30 istek)                                                           | `RATE_LIMITED` ret/yanıtsızlık sonrası 30 sn (`cooldown`); oturumda 20 istek (`limit`) | `rate`, `cooldown`, `limit` |
| —    | Aynı `cid`/`pid` odada yeniden kullanıldı (son 64)       | `VALIDATION` "Bu işlem kimliği daha önce kullanıldı."                                              | aynı                                                                                   | `reuse`                     |

Eşleşmeyen `clip.report` / `print.report` / `print.cancel` yok sayılır (`unmatched_report`, `unmatched_cancel`).

### DataChannel mesajları (`ctl` kanalı, ≤ 16 KB)

| `t`           | Yön               | Alanlar                                                            | Kural                                                                                                                |
| ------------- | ----------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `clip.ready`  | misafir→teknisyen | `cid`                                                              | Misafir WS `clip.push`'u kabul etti; konsol veriyi ancak bundan sonra gönderir                                       |
| `clip.data`   | iki yön           | `cid`, `seq: 0..7`, `last: boolean`, `b64` (≤ 8192 ham bayt)       | UTF-8, 8 KB parçalar, standart base64; toplam ≤ 65 536 bayt; push'ta toplam = `clip.push.bytes`                      |
| `print.ready` | misafir→teknisyen | `pid`                                                              | Varsayılan yazıcı var, başka aktarım yok; misafir bayt almaya hazır                                                  |
| `print.offer` | teknisyen→misafir | `pid`, `idx: 0..65535`, `name` (1..255), `size`, `sha256` (64 hex) | `pid` başına tek teklif; `size` WS'de yetkilenen `sizeBytes` ile aynı olmalı; `idx` dosya aktarımıyla ortak sayaçtan |
| `print.done`  | teknisyen→misafir | `pid`                                                              | Son parçadan sonra; misafir bayt sayısı + SHA-256 + `%PDF-` öneki denetler                                           |

PDF baytları mevcut `file` kanalında, P5 çerçevesiyle (`print.offer.idx | seq | yük ≤ 16 KB`) gider. Yön başına tek aktif
aktarım kuralı yazdırmayı da kapsar (dosya gönderimi sürerken `print.report{NONE, BUSY}`).

**Misafir tarafı süreler:** pano kimliği 8 sn; yazdırma aktarım + sayfa sayımı 8 dk, onay diyaloğu 60 sn. Süre dolunca
`report{TIMEOUT}` (aktarım aşamasında `ERROR`). WS koptuğunda bekleyen tüm kimlikler silinir ve pano kutusu kapanır.

### Örnek akış (pano gönder)

```text
teknisyen → S     {"t":"clip.push","cid":"Q2xpcC0xMjM0NTY3OA","bytes":42}
S → misafir {"t":"clip.push","cid":"Q2xpcC0xMjM0NTY3OA","bytes":42}
misafir → teknisyen (DC) {"t":"clip.ready","cid":"Q2xpcC0xMjM0NTY3OA"}
teknisyen → misafir (DC) {"t":"clip.data","cid":"Q2xpcC0xMjM0NTY3OA","seq":0,"last":true,"b64":"…"}
misafir → S {"t":"clip.report","cid":"Q2xpcC0xMjM0NTY3OA","dir":"TO_CUSTOMER","bytes":42,"result":"OK"}
S → teknisyen     {"t":"clip.status","cid":"Q2xpcC0xMjM0NTY3OA","result":"OK","bytes":42}
```

Ret örneği (müşteri kutuyu açmamış): `{"t":"error","code":"FORBIDDEN","message":"Müşteri pano iznini açmadı."}`.

### Audit ve metrik

`entity = "support_sessions"`, `entity_id = sessionId`. İçerik, dosya adı ve hash hiçbir olayda yoktur.

| Eylem                | `new_value`                                                                                            | `result`                          |
| -------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `clipboard.consent`  | `{on, by:"customer"\|"system", reason?:"control_closed"\|"permission"\|"disconnect"\|"session_ended"}` | success                           |
| `clipboard.transfer` | `{direction, bytes, result, reportedBy:"customer"\|"server"}`                                          | `OK` → success, diğer → fail      |
| `print.job`          | `{decision, pages?, sizeBytes, result, reportedBy}`                                                    | `PRINTED` → success, diğer → fail |

Metrikler: `rs_clipboard_transfer_total{direction,result}`, `rs_print_job_total{result}`,
`rs_clip_print_denied_total{kind,reason}` (okuma ve sorun giderme: runbook §28a).

## Sunucuda dosya aktarımı ve ClamAV (P28b)

Kaynak: `docs/mimari-p28b.md` §4–§5 (r3), ADR-0032, `packages/contracts/src/api/fsrv.ts`, `api/clamav.ts`, `ws-fsrv.ts`
(fikstür `fixtures/fsrv.json`). Firma **Ayarlar > Dosyalar** anahtarı açıksa (SERVER modu) yeni oturumda tüm dosya ve
yazdırma aktarımları bu uçlardan geçer; kapalıysa (P2P) P5 DataChannel yolu aynen çalışır. Mod oturum açılışında
`support_sessions.file_mode`'a yazılır ve oturum boyunca değişmez.

Yeni hata kodları: **`STORAGE_QUOTA`** (409, "Firma depolama kotası doldu"), **`AV_NOT_READY`** (409, "Önce virüs tarama
bağlantısını başarıyla test edin"), `HOST_NOT_ALLOWED` (400, alan hatası). Yükleme/indirme belirteçleri yalnız
`Authorization: Bearer` başlığında gider, **URL'de asla**; bu iki uç çerez okumaz ve CSRF istemez.

### PUT /api/v1/fsrv/uploads/:fid/chunks/:n

- **Yetki:** WS `fsrv.upload` ile verilen yükleme belirteci (fid'e bağlı; son parçadan sonra ya da 10 dk hareketsizlikte düşer).
- **Girdi:** `Content-Type: application/octet-stream`, gövde = `n`. parça (0'dan). Son parça hariç tam 1 048 576 bayt.
- **Çıktı:** 200 `{next, received}`; son parçada 202 `{state:"SCANNING"}`. `n < next` → 200 (idempotent, yazmaz).
- **Hatalar:** `n > next` → 409 `{next}` (zarf değil; istemci `next`'ten devam eder); parça boyu yanlış → 400; belirteç
  yok/süresi dolmuş/fid uyuşmaz → 404 (IP başına dakikada 60 404'ten sonra 429); disk boş < %10 → 409 `STORAGE_QUOTA`.
  Belirteç gövde okunmadan denetlenir.

### GET /api/v1/fsrv/files/:fid/content

- **Yetki:** WS `fsrv.download` ya da geçmiş link ucundan alınan indirme belirteci (≤ 5 dk; fid + firma + oturum + aktöre
  bağlı; süre içinde tekrar kullanılabilir).
- **Çıktı:** 200 akış, `application/octet-stream`, `Content-Disposition: attachment; filename="…"; filename*=UTF-8''…`,
  `Content-Length`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: sandbox; default-src 'none'`, `Cross-Origin-Resource-Policy: same-origin`. Her istek
  `file.download` audit'i üretir.
- **Hatalar:** belirteç yok/süresi dolmuş/fid uyuşmaz/dosya temiz değil/(geçmiş belirtecinde) oturum ya da kullanıcı etkin
  değil → 404 (IP başına 60/dk → 429).

```bash
curl -sS -H "Authorization: Bearer <indirme-belirteci>" -o dosya.bin \
  "https://<SITE_HOST>:4450/api/v1/fsrv/files/<fid>/content"
```

### POST /api/v1/sessions/:id/stored-files/:fid/link

- **Yetki:** çerez + Origin + CSRF; `session_history.view` **ve** `file_transfer.use`; geçmiş kapsamı (teknisyen yalnız
  kendi oturumları, Admin firmanın tümü).
- **Girdi:** yok.
- **Çıktı:** 200 `{"fid":"01J…","token":"…","expiresAt":"2026-11-16T10:05:00.000Z"}` (5 dk; belirteç çağıranın oturumuna
  bağlıdır, çıkış yapınca düşer).
- **Hatalar:** başka firma/oturum, kapsam dışı ya da saklanan dosya değil (yalnız teslim edilmiş, temiz `FILE`) → 404;
  kullanıcı başına dakikada 20 → 429.

### GET /api/v1/admin/settings/clamav · PUT · POST /test (Super Admin)

| Uç                                        | Yetki                 | Girdi                                  | Çıktı / hata                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | --------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/settings/clamav`       | Super Admin           | —                                      | `{host, port, source:"panel"\|"env", lastTest, signatureAgeDays?, stale}`. Etkin hedef panel kaydı > env; env yalnız ilk değerdir, ilk testte panel satırı açılır (audit `settings.clamav {source:"env→panel"}`). Env'e dönüş ucu yok                                                                            |
| `PUT /api/v1/admin/settings/clamav`       | Super Admin + step-up | `{host: ad\|IP ≤ 253, port: 1..65535}` | 200 görünüm; değişince `lastTest = null`. Host'un çözülen tüm adresleri `CLAMAV_ALLOWED_CIDR` içinde değilse 400 `HOST_NOT_ALLOWED`. Audit `settings.clamav` eski→yeni                                                                                                                                           |
| `POST /api/v1/admin/settings/clamav/test` | Super Admin; 6/dk     | `{host?, port?}` (boşsa kayıtlı hedef) | 200 `{ok, eicarDetected, encryptedDetected, version, dbDate, signatureAgeDays, stale, message?}`. Başarı = PING `PONG` + EICAR yakalandı + şifreli zip `Heuristics.Encrypted.*`; aksi `ok:false`. Sonuç yalnız kayıtlı hedefle yapılan testte `lastTest`'e yazılır. Audit `settings.clamav.test`; 7. istek → 429 |

Örnek test yanıtı:

```json
{
  "ok": true,
  "eicarDetected": true,
  "encryptedDetected": true,
  "version": "ClamAV 1.5.4",
  "dbDate": "2026-11-16T04:12:00.000Z",
  "signatureAgeDays": 0,
  "stale": false
}
```

### Mevcut uçlarda değişenler (P28b)

| Uç                                 | Değişiklik                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/PUT /api/v1/settings/tenant`  | Ek alanlar `fileServerMode: boolean`, `fileRetentionDays: 1..7`, `consentUpdated?: true`; görünümde `storage: {usedBytes, quotaBytes}`. Kapalı→açık geçişinde son ClamAV testi başarılı değilse 409 `AV_NOT_READY` (`fields.fileServerMode`), `consentUpdated` yoksa 400 (`fields.consentUpdated`). Audit `tenant_settings.updated` + `consentAck` |
| `PATCH /api/v1/admin/tenants/:id`  | Super Admin; ek alan `storageQuotaGb: 1..2000` (varsayılan 20). Kullanımın altına düşürülebilir (yeni yüklemeler reddedilir). Audit `tenant.storage_quota` eski→yeni                                                                                                                                                                               |
| `GET /api/v1/sessions/:id/history` | Ek alan `storedFiles: {id, direction, purpose, name, sizeBytes, state, scanReason?, signature?, expiresAt?, canDownload}[]`; `PRINT` satırında `name` = `belge.pdf`                                                                                                                                                                                |
| `/health` (iç)                     | Gövdeye `clamav: {configured, reachable, signatureAgeDays, stale}`; HTTP durumu değişmez, `/ready` clamd'a bakmaz                                                                                                                                                                                                                                  |

### WebSocket `fsrv.*` mesajları

Misafir istemci yeteneği `Sec-WebSocket-Protocol` içinde `rs.cap.fsrv1` ile bildirir (Windows 0.14.0+); tarayıcı misafiri
yetenekli sayılır. Teknisyene `hello`/`peer.joined{guest}` yeni alan `fileMode?: "P2P"|"SERVER"` ve `guestFeatures`'ta
`"fsrv"` taşır; misafire `hello.fileMode` yalnız yetenekli sokete gider. Gözetimsiz odada `fsrv` yoktur. `xid` istemcinin
istek kimliği (`^[A-Za-z0-9_-]{8,26}$`), `fid` sunucunun ULID'idir.

| `t`             | Yön              | Alanlar                                                                                     | Kural                                                                                                                                                                                                                                                                          |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fsrv.init`     | gönderen→S       | `xid`, `name` (1..255), `size` (1..268435456), `sha256`, `purpose: "FILE"\|"PRINT"`, `pid?` | Kapı sırası (ilk tutan `fsrv.status{REJECTED, reason}`): `MODE`, `FORBIDDEN`, `UNSUPPORTED`, `BUSY`, `TOO_LARGE` (min(firma sınırı, 256 MiB)), `RATE_LIMITED` (20/dk/oda), `SESSION_LIMIT` (2 GiB), `QUOTA`. `PRINT`: `pid` ve `size` bekleyen P28a işiyle eşleşmeli, ≤ 20 MiB |
| `fsrv.upload`   | S→gönderen       | `xid`, `fid`, `token`, `chunkBytes: 1048576`, `chunks`                                      | Yükleme belirteci                                                                                                                                                                                                                                                              |
| `fsrv.status`   | S→iki taraf      | `fid?`, `xid?`, `state`, `reason?`, `signature?`, `progress?`                               | `state` ∈ `UPLOADING SCANNING CLEAN INFECTED SCAN_FAILED CORRUPT CANCELLED REJECTED DELIVERED`; `INFECTED`/`SCAN_FAILED` iki tarafa ≤ 5 sn. `SCAN_FAILED.reason` ∈ `UNAVAILABLE TIMEOUT ENCRYPTED LIMIT BUSY ERROR`                                                            |
| `fsrv.offer`    | S→alıcı          | `fid`, `name`, `size`, `sha256`, `purpose`, `pid?`                                          | Yalnız `CLEAN` sonrası; `FILE` mevcut kabul diyaloğunu açar, `PRINT` P28a onayına gider                                                                                                                                                                                        |
| `fsrv.accept`   | alıcı→S          | `fid`                                                                                       | Sunucu `fsrv.download` döner; fid başına en çok 3 belirteç                                                                                                                                                                                                                     |
| `fsrv.reject`   | alıcı→S          | `fid`                                                                                       | Göndericiye `REJECTED`; dosya diskten hemen silinir                                                                                                                                                                                                                            |
| `fsrv.download` | S→alıcı          | `fid`, `token`, `expiresAt`                                                                 | ≤ 5 dk                                                                                                                                                                                                                                                                         |
| `fsrv.result`   | alıcı→S          | `fid`, `ok`                                                                                 | SHA-256 doğrulamasından sonra. `ok:true` → `DELIVERED` (yazdırma belgesi silinir); `ok:false` → yeniden kabul edilebilir, 3. başarısızlıkta `CANCELLED`                                                                                                                        |
| `fsrv.cancel`   | gönderen/alıcı→S | `fid`                                                                                       | Yükleme/tarama ya da teslim edilmemiş teklif → `CANCELLED` + disk silinir                                                                                                                                                                                                      |

Misafir soketinde `fsrv.*` yalnız SERVER odasında ve yetenekli sokette şemadadır; aksi bağlantı **1008** ile kapanır. SERVER
odasında P5 `file.meta` yok sayılır, misafire giden `caps`'ten `file_transfer`/`print` çıkarılır; yeteneksiz misafire P28a
`print.request` → `FORBIDDEN`. Oda kapanınca ve sunucu açılışında yarım/teslim edilmemiş dosyalar `CANCELLED` olur ve silinir.

### Audit ve metrik (P28b)

| Eylem                  | Entity / `new_value`                                                       |
| ---------------------- | -------------------------------------------------------------------------- |
| `settings.clamav`      | `system_settings`; eski→yeni `{host, port}` (env→panel geçişinde `source`) |
| `settings.clamav.test` | `{ok, eicarDetected, encryptedDetected, signatureAgeDays}`                 |
| `tenant.storage_quota` | `tenants`; eski→yeni `{storageQuotaGb}`                                    |
| `file.upload`          | `support_sessions`; `{fid, direction, purpose, sizeBytes, ext, result}`    |
| `file.scan`            | `{fid, result: CLEAN\|INFECTED\|SCAN_FAILED, reason?, durationMs}`         |
| `file.infected`        | `{fid, signature, ext, sizeBytes}` (`result: fail`)                        |
| `file.download`        | `{fid, context: session\|history, by: tech\|customer}`                     |
| `file.expired`         | `retention`; firma başına `{count, bytes}`                                 |

Dosya adı, belirteç ve içerik hiçbir olayda yoktur. Metrikler `rs_av_scan_total{result}`, `rs_av_up`, `rs_av_selftest_ok`,
`rs_av_signature_age_seconds`, `rs_fsrv_denied_total{reason}` (alarm eşikleri: runbook §28b.4).

## Gözetimsiz onaysız bağlantı ve müdahale (P28u)

Kaynak: `apps/server/src/unattended/{routes,connect,connect-tx,intervene,mail}.ts`,
`signaling/{admit-device,rejoin-device}.ts`, `packages/contracts/src/{api/unattended.ts,api/sessions.ts,api/audit.ts,
unattended-consent.ts,ws-device.ts,errors.ts,permissions.ts,audit.ts}`. Tasarım `docs/mimari-p28u.md` §r3 (ADR-0033);
operasyon runbook §28u. Doğrulama hataları mevcut 400 `VALIDATION` zarfıyla (`fields`) döner.

**r3 (2026-11-18, onaysız tek yol):** gözetimsiz bağlantı her zaman cihaz kullanıcısına sorulmadan açılır; yeni oturumlarda
`consentMode` her zaman `no_user`'dır. Kaldırılanlar: `GET/PUT /api/v1/unattended/policy` (artık 404), connect gövdesindeki
`silent` / `reason`, `status.silentAllowed`, `SILENT_DISABLED` hata kodu, `unattended.silent` yetkisi, teknisyen × cihaz
"60 sn'de 1" sınırı, cihaz onay penceresi ve izleme kipi. Saklı kalmış `unattended.silent` yetki satırı okumada yok sayılır,
kullanıcı bir sonraki kaydedilişinde silinir.

**Kip (`consentMode`, yalnız okuma/süzgeç):** `no_user` · `asked` (r3 öncesi, cihaz kullanıcısı onayladı) · `silent` (r3
öncesi, izin istemeden). Etiketler (`CONSENT_MODE_LABELS`): "Onaysız", "Kullanıcı onayıyla (eski)", "İzinsiz (eski)".

**Servis yeteneği:** sunucu bağlanmayı yalnız alt protokol listesinde `rs.cap.direct1` bildiren servise açar. 0.15–0.19
servisler (`rs.cap.consent1`, `direct1` yok) ve daha eskiler "eski" sayılır: liste `outdated`, connect 409 `DEVICE_OUTDATED`.
Bir sonraki servis sürümü `direct1` bildirir.

### Hata kodları

| Kod                 | HTTP | Metin                                                |
| ------------------- | ---- | ---------------------------------------------------- |
| `DEVICE_OUTDATED`   | 409  | Cihazdaki servis güncel değil — güncelleyin          |
| `INTERVENE_PENDING` | 409  | Önceki komut henüz tamamlanmadı                      |
| `INTERVENE_FAILED`  | 502  | Cihaz komutu uygulayamadı (`fields.reason`, aşağıda) |

### Uçlar

| Uç                                                      | Yetki                                                 | Girdi                 | Çıktı                                | Hatalar                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------- | --------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| `GET /api/v1/unattended/status`                         | `connect` ∨ `manage`                                  | —                     | `{ mode, available, notifyChannel }` | —                                                                                  |
| `POST /api/v1/unattended/devices/:id/connect` (değişti) | `connect` + cihaz yetkisi + step-up (tüketilir)       | `{}` (ek alan → 400)  | `{ sessionId }`                      | zincir aşağıda                                                                     |
| `POST /api/v1/sessions/:id/unattended/lock`             | `unattended.connect` + kontrol sahibi + cihaz yetkisi | `{}`                  | `{ "ok": true }`                     | 403, 404, 409 `DEVICE_OUTDATED` / `INTERVENE_PENDING`, 429, 502 `INTERVENE_FAILED` |
| `POST /api/v1/sessions/:id/unattended/logoff`           | aynı                                                  | `{ "confirm": true }` | `{ "ok": true, "rejoin": true }`     | aynı; `confirm` yoksa 400 ("Onay gerekli")                                         |

### Bağlantı zincirine eklenen adım

P27 zincirine (bkz. "Bağlantı ön koşul zinciri") tek adım eklenir; her ret audit `unattended.connect{result:fail,
failReason, mode}` olarak yazılır:

| Yer              | Denetim                                | Hata                                                |
| ---------------- | -------------------------------------- | --------------------------------------------------- |
| 8a (8'den sonra) | cihaz `rs.cap.direct1` bildirmiş       | 409 `DEVICE_OUTDATED` (step-up **tüketilmez**)      |
| gönderim anı     | soket arada eski servisle yenilendiyse | oturum `CANCELLED(protocol)`, 409 `DEVICE_OUTDATED` |

Oturum `PENDING` süresi 60 sn. Cihaz bağlantıyı kullanıcıya sormadan kabul eder ve `consent.result{mode:"no_user"}` gönderir;
3 sn içinde gelmezse oturum `CANCELLED(consent_missing)` olur. Bağlantı açılınca konsol bir kez otomatik `control.request`
gönderir (yalnız kontrol sahibi ve `remote_control.use`), cihaz hemen verir. `consent_denied` / `consent_timeout` bitişleri
yalnız r3 öncesi kayıtlarda görünür.

Örnek istek / yanıt:

```http
POST /api/v1/unattended/devices/01KA0000000000000000000000/connect
Content-Type: application/json
X-CSRF-Token: <csrf>

{}
```

```json
{ "sessionId": "01KA0000000000000000000001" }
```

Eski servisli cihaz:

```json
{ "error": { "code": "DEVICE_OUTDATED", "message": "Cihazdaki servis güncel değil — güncelleyin" } }
```

Eski gövde (`{ "silent": true, "reason": "…" }`) → 400 `VALIDATION`.

### Müdahale ön koşulları

Sırayla: `unattended.connect` (403) → oturum bu firmada (404) → çağıran oturumun kontrol sahibi (403; çok teknisyenli odada
devirden sonra devralan) → oda canlı ve gözetimsiz (katılımlı oturum 403) → cihaz yetkisi sürüyor (404) → kontrol açık
(403 "Önce kontrolü alın (kontrol açık olmalı).") → cihaz `consent1`
(409 `DEVICE_OUTDATED`) → bekleyen komut yok (409 `INTERVENE_PENDING`) → oda başına dakikada 6 komut (429). Sunucu
cihaza komutu iletir ve sonucu bekler: kilit 5 sn, oturum kapatma 15 sn. Başarısız ya da yanıtsız komut 502
`INTERVENE_FAILED` döner; `fields.reason` ∈ `no_session` | `not_in_control` | `not_locked` | `no_user` | `api_error` |
`timeout`.

Oturum kapatmada `rejoin: true` → sunucu 45 sn'lik yeniden katılım penceresi açtı; servis yeni Windows oturumunda yardımcıyı
başlatıp aynı oturuma katılır (`rejoin.mode` her zaman `no_user`); konsol kontrolü yeniden kendiliğinden ister. Pencerede
katılamazsa oturum `session_changed` ile biter. Rejoin anında servis `direct1` bildirmiyorsa oturum `protocol` ile biter ve
yanıt `rejoin: false` olur.

### Mevcut uçlarda değişenler

| Uç                                       | Değişiklik                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/unattended/devices`, `/:id` | `userState`: `active` \| `locked` \| `none` \| `null` (çevrimdışı ya da eski servis); yalnız bilgi, bağlantıyı etkilemez. Yalnız çağıranın cihaz yetkisi olan cihazda dolu; audit ve dışa aktarımda yok. `connectBlockedReason` + `outdated` (`direct1` yok)                                                    |
| `GET /api/v1/sessions`                   | Satırda `consentMode` (`no_user` \| `asked` \| `silent` \| `null`); süzgeç `consentMode=no_user\|asked\|silent` (kipsiz satırlar elenir); dışa aktarım aynı süzgeci kullanır                                                                                                                                    |
| `GET /api/v1/sessions/:id/history`       | `unattended?: { consentMode, silentReason?, timeline: [{ at, kind, result?, decision?, ms? }] }`; `kind` ∈ `consent` (yalnız eski kayıt) \| `control_on` \| `control_off` \| `lock` \| `logoff` \| `rejoin` (≤ 200 satır). `silentReason` yalnız eski `silent` ve anonimleştirilmemiş oturumda. Başka firma 404 |
| `GET /api/v1/audit`                      | Süzgeç `consentMode=no_user\|asked\|silent` (`new_value.consentMode` eşitliği); geçersiz değer 400 "Bağlantı kipi geçersiz"                                                                                                                                                                                     |

### Audit ve bildirim

Yazılan eylemler: `unattended.connect` (`consentRequested:"ask"` — tarihsel ad), `unattended.session.started/ended`
(`consentMode:"no_user"`, bitişte süre), `unattended.control_toggle` (`from`, `to`, `consentMode`), `unattended.lock` /
`unattended.logoff` (`deviceId, consentMode, durationMs, failReason?`, logoff'ta `rejoin`), `unattended.rejoin`.
`unattended.silent.notify` artık yalnız P28e kayıt politikası e-postası için yazılır (`event:"recording_policy"`).

Yalnız r3 öncesi satırlarda görünen (okunur, etiketlenir, yeni yazılmaz): `unattended.consent` ("Gözetimsiz bağlantı onayı
(cihaz kullanıcısı)"), `settings.unattended_silent` ("Gözetimsiz erişim politikası değişti (eski)"), `unattended.silent.notify`
`event: connect | policy | join | transfer`, `unattended.connect.silentReason`. Eski gerekçe audit listesi ve CSV'de yalnız
çağıranda `session_history.view` varsa ve oturum aynı firmada, anonimleştirilmemiş duruyorsa açık gelir; aksi `"***"`.
Kullanıcı varlık durumu hiçbir audit satırına yazılmaz.

Müşteri bildirimi (P27 şablonu) her gözetimsiz bağlantıda aynen gider; ayrı "izin istenmeden" satırı yoktur.

### `/ws/device` (servis protokolü, `"v":1` aynı)

Yeni servisin alt protokol listesi: `rs.device.v1`, `rs.cap.consent1`, `rs.cap.record1`, `rs.cap.direct1`. Sunucu
`device.ready`'den sonra `rs.cap.consent1` bildiren sokete `device.features{caps:["consent1", …]}` gönderir (`direct1`
`device.features`'a girmez). S→C: `connect` (+ `consent: "ask"` — tek değer, tarihsel ad; anlamı "gözetimsiz bağlantı,
cihaz sormaz"), `intervene{sessionId, id, cmd: lock|logoff}`, `rejoin{sessionId, ticket, mode:"no_user", indicatorText,
expiresInSec ≤ 30}`. C→S (yalnız `device.features` alındıktan sonra): `device.user{state}`, `consent.result{sessionId,
mode:"no_user"}`, `intervene.result{sessionId, id, cmd, ok, reason?}`. Yeni servis r3 öncesi sunucudan `consent:"silent"`
alırsa bağlanmaz (`connect.result{protocol}`). Şemalar `packages/contracts/src/ws-device.ts`, fikstür
`fixtures/ws-device.json`.

## Oturum kaydı (P28e)

Kaynak: `apps/server/src/rec/{routes,service,view,delete,accept}.ts`, `apps/server/src/settings/recording.ts`,
`packages/contracts/src/{ws-rec.ts,api/recording.ts,api/sessions.ts,audit.ts,permissions.ts}`. Tasarım
`docs/mimari-p28e.md` (ADR-0034); operasyon runbook §28e. Yeni yetki `sessions.view_recording` ("Kayıtları izle", hassas;
Admin açık, User kapalı). **Yeni hata kodu yoktur**: `VALIDATION` (400), `MFA_STEP_UP_REQUIRED` (401),
`MFA_SETUP_REQUIRED` (403), `NOT_FOUND` (404), `CONFLICT` (409), `STORAGE_QUOTA` (409), `RATE_LIMITED` (429) yeniden
kullanılır. Başka tenant, kapsam dışı ya da belirteç uyuşmazlığı her yerde **404** döner. Ses kaydı yapısal olarak
yoktur: sunucu ses izi içeren WebM'i reddeder.

**Belirteçler:** parça uçları çerez okumaz; kimlik yalnız `Authorization: Bearer <43 karakter base64url>` başlığıdır, URL'de
asla taşınmaz. Yükleme belirteci kaydedici teknisyene WS `rec.state.upload` ile, izleme belirteci `POST …/recording/view`
yanıtıyla gelir. İkisi de bellektedir; sunucu yeniden başlarsa düşer. Çıkış, kullanıcı/tenant pasifleştirme ve yetki
kaybından sonraki ilk istek 404 alır.

### Uçlar

| Uç                                         | Kimlik / yetki                                                                               | Girdi                                                                                            | Çıktı                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------- |
| `PUT /api/v1/rec/:rid/series/:s/parts/:p`  | Bearer yükleme belirteci                                                                     | Gövde: WebM parçası (≤ 2 MiB); başlıklar aşağıda                                                 | 200 `{ next }`                   |
| `GET /api/v1/rec/:rid/series/:s/parts/:p`  | Bearer izleme belirteci                                                                      | —                                                                                                | 200 düz WebM baytları            |
| `GET /api/v1/sessions/:id/recording`       | Çerez; `session_history.view` + `sessions.view_recording` + geçmiş kapsamı                   | —                                                                                                | `RecordingView` (aşağıda)        |
| `POST /api/v1/sessions/:id/recording/view` | Çerez + CSRF; aynı yetki; kullanıcı başına 20/dk                                             | `{}`                                                                                             | `{ token, idleTtlMs, maxUntil }` |
| `DELETE /api/v1/sessions/:id/recording`    | Çerez + CSRF; `session_history.edit` + geçmiş kapsamı                                        | `{ "confirm": true }`                                                                            | 204                              |
| `GET /api/v1/settings/recording`           | `settings.view`                                                                              | —                                                                                                | `RecordingSettingsView`          |
| `PUT /api/v1/settings/recording`           | `settings.edit` + CSRF; `unattendedEnabled` false→true ise 2FA + son 5 dk step-up (tüketmez) | `{ enabled, retentionDays, unattendedEnabled, consentUpdated?: true, employeeNoticeAck?: true }` | `RecordingSettingsView`          |

Geçmiş kapsamı: teknisyen (User) yalnız kendi oturumları, Admin kendi tenant'ı, Super Admin seçili tenant.

### `PUT /api/v1/rec/:rid/series/:s/parts/:p` (parça yükleme)

- Yol: `rid` ULID; `s` bölüm 0..65535; `p` bölüm içi parça 0..59 (5 sn parça, 5 dk bölüm). Biçim dışı → 400 `VALIDATION`.
- Başlıklar: `Content-Type: video/webm` (zorunlu), `Content-Length` (zorunlu, 1..2097152; `Transfer-Encoding` gönderilirse 400 "Parça gövdesi Content-Length ile gönderilmeli"; eksik/aralık dışı da 400 `VALIDATION`),
  `X-Rec-Duration-Ms` 1..15000 (zorunlu), `X-Rec-Series-Start-Ms` (epoch ms; **yalnız `p = 0`'da ve orada zorunlu**, aksi
  400 `fields["x-rec-series-start-ms"]`).
- Belirteç, oran ve kota ön denetimi **gövde okunmadan** yapılır. Belirteç başına aynı anda tek PUT ve dakikada en çok 30
  PUT; süreç geneli 32 eşzamanlı PUT.
- Aynı `(s, p)` yeniden gönderilirse 200 döner, yazılmaz (idempotent). Parça şifrelenerek (AES-256-GCM) saklanır.

| Durum                                                                                         | Yanıt                                                                |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Yazıldı / zaten vardı                                                                         | 200 `{ "next": <beklenen sonraki p> }`                               |
| `p ≠ next`                                                                                    | 409 `{ "next": n }` (hata zarfı **değil**; istemci `next`'ten sürer) |
| Yeni bölüm kuralı ihlali (`s ≤ son s` ya da `p ≠ 0`), oran tavanı (≤ 1 GiB/saat) aşımı        | 409 `CONFLICT` (oran aşımı kaydı `STOPPED{error}` yapar)             |
| Kota dolu ya da disk boşluğu < %10                                                            | 409 `STORAGE_QUOTA`, kayıt `STOPPED{quota}`                          |
| `p = 0`'da ses izi/ikinci iz/VP8-VP9 dışı kodek; `p > 0`'da EBML başlığı; süre şişirme        | 400 `VALIDATION` "Kayıt parçası geçersiz.", kayıt `STOPPED{error}`   |
| Boş gövde                                                                                     | 400 `VALIDATION` "Gövde video/webm olmalı."                          |
| Belirteç yok/geçersiz, `rid` uyuşmazlığı, kayıt durmuş (durma payı dışı), kaynak eş odada yok | 404 (gövdesiz)                                                       |
| Aynı belirteçle ikinci eşzamanlı PUT, dakika sınırı, semafor dolu                             | 429 `RATE_LIMITED`, `Retry-After: 1`                                 |
| IP başına dakikada 60'tan fazla 404                                                           | 429 `RATE_LIMITED`                                                   |

Durma payı: kayıt durduktan sonra 15 sn içinde yalnız aynı bölümün en çok 4 parçası kabul edilir; yeni bölüm 404.

```bash
curl -X PUT "https://<alan>/api/v1/rec/01JD…/series/0/parts/0" \
  -H "Authorization: Bearer <yükleme belirteci>" -H "Content-Type: video/webm" \
  -H "X-Rec-Duration-Ms: 5000" -H "X-Rec-Series-Start-Ms: 1763300000000" \
  --data-binary @parca-0.webm
# 200 {"next":1}
```

### `GET /api/v1/rec/:rid/series/:s/parts/:p` (izleme)

200 yanıt başlıkları: `Content-Type: video/webm`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
`Cross-Origin-Resource-Policy: same-origin`, `Content-Security-Policy: sandbox; default-src 'none'`. `Content-Disposition`
ve `Range` desteği **yoktur**; `HEAD` açılmaz. Her GET'te kullanıcı, giriş oturumu ve izleme yetkisi yeniden denetlenir
(düşmüşse 404). İzleme belirteci kayan sürelidir: her GET boşta süresini 5 dk uzatır; üst sınır `maxUntil`.

Çekiş bütçesi (kullanıcı + kayıt başına, yeni `POST /view` sıfırlamaz): 126 parçalık kova, dakikada 24 parça dolum. Boşsa
429 `RATE_LIMITED` + `Retry-After`; oynatıcı bekleyip sürer.

### `GET /api/v1/sessions/:id/recording`

```json
{
  "id": "01JD…",
  "state": "stopped",
  "basis": "consent",
  "stopReason": "revoked",
  "startedAt": "2026-11-16T09:00:00.000Z",
  "stoppedAt": "2026-11-16T09:12:30.000Z",
  "durationMs": 750000,
  "sizeBytes": 120000000,
  "expiresAt": "2026-12-16T09:00:00.000Z",
  "series": [{ "s": 0, "offsetMs": 0, "parts": [{ "p": 0, "offsetMs": 0, "durationMs": 5000 }] }],
  "canDelete": true
}
```

- `state`: `active` | `stopped`. `basis`: `consent` | `tenant_policy`. `stopReason`: `revoked` | `quota` | `session_end` |
  `error` | `policy_off`.
- Gözetimsiz kayıtta `consentMode` (yeni kayıtta `no_user`; eski kayıtta `asked` | `silent`); yalnız eski `silent` ve anonimleştirilmemiş oturumda `silentReason`.
- `canDelete` yalnız `session_history.edit` varken ve kayıt `stopped` iken `true`.
- Kayıt yok ya da silinmiş → 404 (silinmişin izi geçmiş detayındaki `recording` alanındadır).

### `POST /api/v1/sessions/:id/recording/view`

200 `{ "token": "…", "idleTtlMs": 300000, "maxUntil": "<ISO>" }`. `maxUntil` = en çok `şimdi + kayıt süresi + 30 dk`, her
durumda ≤ 8 saat. Audit `recording.view` **burada**, izleme başına bir kez yazılır. Kullanıcı + kayıt başına tek etkin
belirteç: yeni istek eskisini düşürür. Belirteç düşünce `recording.view.end` özeti yazılır. Hatalar: 403, 404, 429.

### `DELETE /api/v1/sessions/:id/recording`

Gövde `{ "confirm": true }` (yoksa 400 "Onay gerekli"). 204. Kayıt `active` → 409 `CONFLICT` "Oturum sürerken kayıt
silinemez". Zaten silinmiş → 204 (idempotent). Step-up istemez. Audit `recording.delete`.

### `GET` / `PUT /api/v1/settings/recording`

`RecordingSettingsView`: `{ enabled, retentionDays, unattendedEnabled, unattendedAckAt?, storage: { usedBytes, quotaBytes },
maxRetentionDays, soleManager }`. `storage` dosya + kayıt toplamıdır (tek kota). `soleManager: true` → dört göz e-postasını
alacak başka yönetici yok.

PUT kuralları (ilk tutan döner):

| Koşul                                                       | Yanıt                                                                                    |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `retentionDays` 1..90 dışı, tam sayı değil                  | 400 `fields.retentionDays`                                                               |
| `unattendedEnabled: true` ∧ `enabled: false`                | 400 `fields.unattendedEnabled` "Önce oturum kaydını açın"                                |
| `enabled` false→true ∧ `consentUpdated ≠ true`              | 400 `fields.consentUpdated` "Açmadan önce aydınlatma metnini güncellediğinizi onaylayın" |
| `retentionDays` > firma oturum saklama süresi               | 400 `fields.retentionDays` "Kayıt saklama süresi firma oturum saklama süresini aşamaz"   |
| `unattendedEnabled` false→true ∧ `employeeNoticeAck ≠ true` | 400 `fields.employeeNoticeAck` "Açmak için bilgilendirme kutusunu işaretleyin"           |
| aynı geçişte kullanıcıda 2FA yok                            | 403 `MFA_SETUP_REQUIRED`                                                                 |
| aynı geçişte son 5 dk'da step-up yok                        | 401 `MFA_STEP_UP_REQUIRED` (panel kodu sorar, isteği bir kez tekrarlar)                  |

- `enabled: false` gözetimsiz anahtarı da kapatır. Kapatma ilgili `active` kayıtları `STOPPED{policy_off}` yapar.
- `retentionDays` yalnız **yeni** kayıtlara uygulanır; mevcut kayıtların `expiresAt`'i değişmez.
- Gözetimsiz kayıt durumu değişirse (iki yön) commit sonrası dört göz e-postası gider ("Gözetimsiz bağlantı kayıt
  politikası değişti"); alıcı diğer `unattended.manage` sahipleri, yoksa işlemi yapan + Admin'ler. Her deneme audit
  `unattended.silent.notify{event:"recording_policy"}`.
- Audit `settings.recording` eski → yeni `{enabled, retentionDays, unattendedEnabled}` + `consentAck` / `employeeNoticeAck`.

### Mevcut uçlarda değişenler

| Uç                                                                                          | Değişiklik                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/sessions` (geçmiş listesi)                                                     | Süzgeç `recorded=true` (yalnız silinmemiş kaydı olan oturumlar); satırda `hasRecording`                                                                              |
| `GET /api/v1/sessions/:id/history`                                                          | `recording: { state, basis, stopReason?, deleteReason?: "expired"\|"manual"\|"missing", durationMs, expiresAt, canView, canDelete } \| null`                         |
| Onay metni yanıtları (`ConsentTextView`: kod/bağlantı çözümü, talep formu, web talep formu) | `recording?: { offered, line, lineSha256 }` — yalnız firma ayarı açık, kota ve disk uygunken eklenir. `line` = "Oturumun görüntü kaydının alınmasına izin veriyorum" |

### WebSocket `rec.*` mesajları

Yetenek belirteçleri: `/ws/guest` ve `/ws/tech` için `rs.cap.rec1` (Go istemci 0.16.0, tarayıcı misafir; konsolda yalnız
`MediaRecorder` VP8 destekliyse), `/ws/device` için `rs.cap.record1` (servis 0.16.0). `rec.*` yalnız bu belirteci bildiren
sokete gider; bildirmeyen sokette gelen `rec.*` şema hatasıdır (1008). Şemalar `z.strictObject`, fikstür `fixtures/rec.json`.

| `t`            | Yön                  | Alanlar                                                                   | Not                                                                                                                                                                        |
| -------------- | -------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rec.consent`  | misafir → S          | `id`, `lineSha256` (64 hex)                                               | Kutu işaretliyse admit sonrası ilk `hello`'dan sonra bir kez, 30 sn içinde. SHA uyuşmazlığı veya geç gelme yok sayılır + audit `recording.start` fail `consent_rejected`   |
| `rec.revoke`   | misafir → S          | `id`                                                                      | "Kaydı durdur". Geri alınamaz. Yeniden bağlanan misafirin `hello` sonrası ilk mesajı olabilir. 2 sn'de `rec.state{on:false}` gelmezse istemci paylaşımı yerelde duraklatır |
| `rec.state`    | S → misafir          | `on`, `reason?`                                                           | Gösterge ve düğme yalnız buna göre çizilir. `reason`: `revoked`, `quota`, `session_end`, `error`, `policy_off`, `unavailable`                                              |
| `rec.state`    | S → tüm teknisyenler | `on`, `reason?`, `rid?`, `basis?`, `upload?: { token, series, nextPart }` | `on:true` iken `rid` + `basis` zorunlu. `upload` yalnız kaydedici teknisyene. Yeniden bağlanmada `hello.rec` aynı gövdeyle gelir (yeni belirteç, yeni bölüm)               |
| `rec.error`    | teknisyen → S        | `id`, `code`: `unsupported` \| `recorder_failed` \| `upload_failed`       | Yalnız kaydediciden; kayıt `STOPPED{error}`                                                                                                                                |
| `connect` (ek) | S → cihaz            | `recording?: true`                                                        | Yalnız `record1` cihaza. Göstergeye " — Kayıt yapılıyor" eki (r3: onay penceresi yok)                                                                                      |
| `rec.state`    | S → cihaz            | `on`                                                                      | Kayıt ortada durursa gösterge eki kalkar                                                                                                                                   |

Gözetimsiz konsolda cihaz `record1` bildirmediyse teknisyen `hello.unattended.recordOutdated: true` alır ("Cihaz istemcisi
eski; kayıt için 0.16.0 gerekli").

### Audit ve metrik

| Eylem                | Ne zaman / `new_value`                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recording.start`    | Kayıt açıldı (success) / açılamadı (fail): `{recordingId?, basis, consentMode?, reason?: quota\|device_outdated\|unsupported\|consent_rejected, cause?: sha\|window}`                                         |
| `recording.stop`     | `{recordingId, reason: revoked\|quota\|session_end\|error\|policy_off, cause?, durationMs, sizeBytes}`; `cause` ∈ `unsupported`, `recorder_failed`, `upload_failed`, `no_upload`, `rate`, `invalid`, `orphan` |
| `recording.view`     | `POST /view`: `{recordingId}`                                                                                                                                                                                 |
| `recording.view.end` | İzleme belirteci düştü: `{recordingId, partsServed, bytesServed, throttled, endReason: idle\|max\|replaced\|logout\|revoked}`                                                                                 |
| `recording.delete`   | `{recordingId, deleteReason: manual\|missing, durationMs, sizeBytes, missingParts?, remainingParts?}`                                                                                                         |
| `recording.expired`  | 03:30 turu, tenant başına `{count, bytes}` (`entity="retention"`)                                                                                                                                             |
| `settings.recording` | Ayar değişimi (yukarıda)                                                                                                                                                                                      |

`entity="support_sessions"`, `entity_id=sessionId`. Audit süzgecinde grup "Kayıt". Metrikler: `rs_rec_active`,
`rs_rec_part_total{result}`, `rs_rec_stop_total{reason}`, `rs_rec_bytes_total`, `rs_rec_part_bytes`,
`rs_rec_view_throttled_total`; `rs_storage_used_bytes` kayıtları da içerir. Alarmlar runbook §28e.

## Çoklu teknisyen (P28c)

Kaynak: `apps/server/src/sessions/{routes-multi,invites,eligibility}.ts`, `apps/server/src/signaling/members.ts`,
`packages/contracts/src/{api/multi.ts,ws-multi.ts,errors.ts,audit.ts,permissions.ts}`. Tasarım `docs/mimari-p28c.md` r2
(ADR-0035); operasyon runbook §28c. Migration ve yeni env yoktur: üyeler, davetler ve çıkarılanlar sunucu belleğinde tutulur,
katılımcı geçmişi audit'ten türetilir.

**Kurallar:**

- Oturumda sahip dahil en çok **3 teknisyen** bulunur (`MAX_TECHS`). Bekleyen davet de bir koltuk tutar.
- Roller: **Kontrol sahibi** (ana görüntü akışı; girdi, pano, yazdırma, dosya, işaretleme yalnız onda), **Katılımcı**
  (düşük akış; görüntü ve sohbet), **İzleyici** (düşük akış; görüntü ve sohbeti okuma, yazamaz). Davet, kontrol devri,
  oturum devri, oturumu bitirme ve misafir kabulü yalnız **oturum sahibindedir**.
- Davet 2 dk geçerlidir (`INVITE_TTL_MS = 120000`). Kabul/İzle sonrası koltuk 60 sn ayrılı kalır; teknisyen bu sürede konsola
  bağlanmazsa düşer. Kopan üyeye 120 sn dönüş payı verilir.
- Müşteri tarafı (Windows istemci, gözetimsiz yardımcı, tarayıcı misafir) `rs.cap.multi1` bildirmiyorsa (istemci/servis
  0.17.0 öncesi) davet ve İzle açılmaz: 409 `CLIENT_UNSUPPORTED`.
- Gözetimsiz odada katılan kişide `unattended.connect` ve cihaz yetkisi gerekir; kabul ve İzle 2FA kurulu olmasını ve son 5 dk
  içinde step-up yapılmasını ister. Kipi `no_user` olmayan odaya (henüz admit edilmemiş ya da r3 öncesi `asked`) katılım
  409 `JOIN_NOT_ALLOWED` alır. P28u r3'ten beri gerekçe ve dört göz e-postası yoktur; kabul/İzle gövdesi `{}`'dir.
- Müşterinin çıkardığı teknisyen aynı oturuma davet, İzle ya da WS ile yeniden giremez (403).

### Yetkiler

| Anahtar              | Etiket (yetki ekranı)       | Anlam                                                                                     | Varsayılan              |
| -------------------- | --------------------------- | ----------------------------------------------------------------------------------------- | ----------------------- |
| `sessions.invite`    | Teknisyen davet et / devret | Etkin oturuma aynı firmadan teknisyen davet eder, kontrolü ve oturumu devreder (sahipken) | Admin açık, User kapalı |
| `sessions.supervise` | Etkin oturumları izle       | Firmanın etkin oturumlarını izleyici olarak izler (hassas — yalnız gerekene verin)        | Admin açık, User kapalı |

Davet edilecek kişide en az `sessions.view` bulunmalıdır. Super Admin davet edilemez; yalnız seçili firmada İzle yapabilir.

### Hata kodları

| Kod                  | HTTP | Metin                                                                               |
| -------------------- | ---- | ----------------------------------------------------------------------------------- |
| `SESSION_FULL`       | 409  | Oturum dolu                                                                         |
| `CLIENT_UNSUPPORTED` | 409  | Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin |
| `INVITE_GONE`        | 410  | Davet artık geçerli değil                                                           |
| `JOIN_NOT_ALLOWED`   | 409  | Bu gözetimsiz bağlantıya ek teknisyen katılamaz (r3: kipi `no_user` olmayan oda)    |

Yeniden kullanılanlar: `VALIDATION` (400; kabul/İzle gövdesinde bilinmeyen alan, ör. eski `reason`), `MFA_STEP_UP_REQUIRED` (401), `MFA_SETUP_REQUIRED` (403; konsol "Önce 2FA kurun"), `FORBIDDEN` (403),
`NOT_FOUND` (404; başka firma ya da biçimsiz kimlik dahil), `CONFLICT` (409; oda etkin değil, kişi zaten odada ya da davetli,
devir sürüyor), `RATE_LIMITED` (429, `retryAfterSec`).

### Hız sınırları (429 `RATE_LIMITED`)

| Kapsam                                                                                                              | Sınır                                |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `GET /sessions/invites`, `GET /sessions/active`, `GET /sessions/:id/invite-candidates`, `GET /sessions/:id/invites` | Kullanıcı başına her biri 60/dk      |
| Kabul, İzle                                                                                                         | Kullanıcı başına 20/dk (ortak sayaç) |
| Ret, davet geri çekme                                                                                               | Kullanıcı başına her biri 20/dk      |
| Davet oluşturma + WS devir/çıkarma komutları                                                                        | Oda başına 10/dk                     |

Başarısız davet/kabul/İzle `fail` audit'i aynı (kullanıcı, oturum, neden) için dakikada en çok bir kez yazılır.

### Uçlar (`/api/v1/sessions`, çerez + Origin + CSRF)

| Uç                                        | Yetki / kural                                                 | Girdi                    | Çıktı                                                                               | Hatalar                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /sessions/:id/invite-candidates`     | `sessions.invite` + oturum sahibi                             | —                        | `{ items: {userId, fullName, avatarUrl}[] }` (≤ 200, ada göre)                      | 403, 404, 409 `CONFLICT` / `CLIENT_UNSUPPORTED` / `JOIN_NOT_ALLOWED`, 429                            |
| `POST /sessions/:id/invites`              | `sessions.invite` + oturum sahibi                             | `{ "userId": "<ULID>" }` | 201 `{ inviteId, expiresAt }`                                                       | 400, 403, 404, 409 `SESSION_FULL` / `CLIENT_UNSUPPORTED` / `JOIN_NOT_ALLOWED` / `CONFLICT`, 429      |
| `GET /sessions/:id/invites`               | Oturum sahibi                                                 | —                        | `{ items: {inviteId, userId, inviteeName, expiresAt}[] }` (bitişe göre)             | 403, 404, 429                                                                                        |
| `DELETE /sessions/:id/invites/:inviteId`  | Oturum sahibi                                                 | —                        | 204                                                                                 | 403, 404, 429                                                                                        |
| `GET /sessions/invites`                   | Oturum açmış her kullanıcı; yalnız kendine gelen davetler     | —                        | `{ items: {inviteId, sessionId, fromName, customerName, unattended, expiresAt}[] }` | 429                                                                                                  |
| `POST /sessions/invites/:inviteId/accept` | Davet bu kullanıcıya ait; uygunluk zinciri yeniden denetlenir | `{}` (ek alan → 400)     | `{ sessionId, consoleUrl }`                                                         | 400, 401, 403, 409 `SESSION_FULL` / `CONFLICT`, 410 `INVITE_GONE`, 429                               |
| `POST /sessions/invites/:inviteId/reject` | Davet bu kullanıcıya ait                                      | —                        | 204                                                                                 | 410 `INVITE_GONE`, 429                                                                               |
| `GET /sessions/active`                    | `sessions.supervise`; seçili firma                            | —                        | `{ items: ActiveSessionItem[] }`                                                    | 403, 429                                                                                             |
| `POST /sessions/:id/supervise`            | `sessions.supervise`; uygunluk zinciri                        | `{}` (ek alan → 400)     | `{ sessionId, consoleUrl }`                                                         | 400, 401, 403, 404, 409 `SESSION_FULL` / `CLIENT_UNSUPPORTED` / `JOIN_NOT_ALLOWED` / `CONFLICT`, 429 |

Tüm GET yanıtları `Cache-Control: no-store`. `inviteId` 22 karakter base64url'dir; biçimsiz yol parametresi 404 döner.
Başkasına ait ya da bilinmeyen davet kabul/ret isteği kimlik sızdırmamak için 410 döner. `consoleUrl` =
`/sessions/<id>/console`; teknisyenin rolü konsol WS `hello` mesajından gelir.

`ActiveSessionItem`: `{ id, technicianName, customerName, mode, startedAt, techCount, full, supported, unattended,
consentMode? }`. `supported: false` → İzle pasif (`CLIENT_UNSUPPORTED` metni). Gözetimsiz oda yalnız çağıran o cihaza
bağlanabiliyorsa ve kipi `no_user` ise listelenir.

Örnek — davet ve kabul:

```bash
# Oturum sahibi davet eder
curl -X POST "https://<alan>/api/v1/sessions/01JD…/invites" \
  -H "Content-Type: application/json" -H "Origin: https://<alan>" -H "X-CSRF-Token: <csrf>" \
  -b "<oturum çerezi>" -d '{"userId":"01JE…"}'
# 201 {"inviteId":"Qm9vb…22kr","expiresAt":"2026-11-17T09:02:00.000Z"}

# Davetli kabul eder (gözetimli oda)
curl -X POST "https://<alan>/api/v1/sessions/invites/Qm9vb…22kr/accept" \
  -H "Content-Type: application/json" -H "Origin: https://<alan>" -H "X-CSRF-Token: <csrf>" \
  -b "<oturum çerezi>" -d '{}'
# 200 {"sessionId":"01JD…","consoleUrl":"/sessions/01JD…/console"}
# Süre dolduysa: 410 {"error":{"code":"INVITE_GONE","message":"Davet artık geçerli değil"}}
```

### Mevcut uçlarda değişenler

| Uç                          | Değişiklik                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /sessions/:id`         | Odanın bağlı ya da koltuğu ayrılmış üyesi de görür; sahip olmayan üyeye `techVerifyCode` boş döner                                                                                                                                                                                                                 |
| `GET /sessions/:id/history` | `participants: { userId, name, role: "owner"\|"participant"\|"observer", joinedAt, leftAt, leaveReason, transferredAt }[]` (tek teknisyenli oturumda boş dizi); zaman çizelgesinde P28c olayları. `leaveReason`: `left`, `disconnect`, `no_show`, `session_end`, `auth_revoked` ya da müşteri çıkardıysa `removed` |

Oturum devrinde `support_sessions.technician_id` yeni sahibe geçer. Geçmiş kapsamı değişmez: User yalnız sahibi olduğu
oturumları görür, devrettiği oturumu artık "kendi oturumları"nda görmez.

### WebSocket mesajları

Yetenek belirteci `rs.cap.multi1` (`/ws/guest`; Windows istemci ve yardımcı 0.17.0, tarayıcı misafir). Çoklu teknisyene ait
hiçbir alan ya da mesaj bu belirteci bildirmeyen misafire gönderilmez. Şemalar `z.strictObject`, fikstür
`packages/contracts/fixtures/multi.json`. Müşteriye yalnız opak `tid` (11 karakter) ve ad gider; kullanıcı kimliği gitmez.

| `t`                                  | Yön                                   | Alanlar                                                                                         | Kural                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello` (ek)                         | S → teknisyen                         | `tid?`, `techRole?: owner\|participant\|observer`, `roster?`, `guestMulti?`                     | `guestMulti: false` → konsolda "Davet et"/"İzle" baştan pasif                                                                                                                     |
| `techs.roster`                       | S → tüm teknisyenler + multi1 misafir | `techs: {tid, name (≤ 100), role: controller\|participant\|observer, owner, connected}[]` (1–3) | Her üyelik/rol/bağlantı değişiminde anında; tam bir oturum sahibi ve bir kontrol sahibi                                                                                           |
| `control.handover`                   | teknisyen → S                         | `id?`, `to: tid`                                                                                | Oturum sahibi + `sessions.invite`; hedef bağlı katılımcı ya da kendisi (geri alma); izleyiciye verilemez. Kontrol izni VIEW'a döner, yeni kontrol sahibi müşteriden yeniden ister |
| `session.transfer`                   | teknisyen → S                         | `id?`, `to: tid`                                                                                | Oturum sahibi + `sessions.invite`; hedef bağlı katılımcı ve sahiplik koşullarını taşımalı; eski sahip katılımcı olur                                                              |
| `member.leave`                       | teknisyen → S                         | `id?`                                                                                           | Sahip olmayan üye; anında ayrılır, soket 1000                                                                                                                                     |
| `tech.remove`                        | misafir → S                           | `id?`, `tid`                                                                                    | Yalnız multi1 misafir; oturum sahibi çıkarılamaz (`error{FORBIDDEN}`). Hedefin soketi 4403 "removed" ile kapanır                                                                  |
| `sdp.offer` / `ice`                  | S → misafir                           | + `from: tid`                                                                                   | Bir teknisyenin ilk offer'ı, onu içeren `techs.roster`'dan sonra iletilir; misafir roster'da adı çizilmemiş `tid`'i kabul etmez                                                   |
| `sdp.answer` / `ice` / `ice.restart` | misafir → S                           | + `to: tid` (multi1'de zorunlu)                                                                 | Yalnız odadaki bağlı `tid`'e iletilir                                                                                                                                             |

Rol kapısı varsayılan-rettir (`ROLE_MAY`): katılımcı ve izleyici yalnız `sdp.offer`, `ice`, `ice.restart`, `member.leave`
gönderebilir; diğer teknisyen mesajları `error{FORBIDDEN}` alır ve `rs_multi_denied_total{type}` artar. Devir sürerken
`tech.remove`, `control.handover`, `member.leave` → `error{CONFLICT}`. Teknisyen soket kapanış kodu `4403 "removed"`:
müşteri çıkardı ya da yetki düştü (konsol "Oturumdan çıkarıldınız" gösterir, yeniden bağlanmaz).

DataChannel: `chat` mesajına isteğe bağlı `by: tid` eklenir (misafir teknisyen mesajını diğer eşlere yayar; konsol adı kendi
roster'ından çözer). İzleyicinin sohbet mesajı misafirde düşer; `input`, dosya, pano, yazdırma ve işaretleme yalnız kontrol
sahibinin eşinden kabul edilir.

### Audit ve metrik

`entity = "support_sessions"`, `entity_id = sessionId`; audit süzgecinde "Çoklu teknisyen" grubu. Sohbet içeriği yazılmaz.

| Eylem (etiket)                                            | `new_value`                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `session.invite` (Teknisyen davet edildi)                 | `{inviteeUserId, inviteeName}`; ret `fail` + `failReason`                      |
| `session.invite_accept` / `session.invite_reject`         | `{inviteId}`                                                                   |
| `session.invite_expire` (Davet düştü)                     | `{inviteeUserId, reason: timeout\|session_end\|revoked}`                       |
| `session.participant_join` (Teknisyen katıldı)            | `{userId, role, consentMode?}`                                                 |
| `session.supervise_join` (Süpervizör izlemeye başladı)    | `{userId, role:"observer", consentMode?}`; ret `fail`                          |
| `session.participant_leave` (Teknisyen ayrıldı)           | `{userId, role, reason: left\|disconnect\|no_show\|session_end\|auth_revoked}` |
| `session.participant_remove` (Müşteri teknisyeni çıkardı) | `{userId, role}`, aktör müşteri                                                |
| `session.control_handover` (Kontrol devredildi)           | `{fromUserId, toUserId, reason?: "controller_left"}`                           |
| `session.transfer` (Oturum devredildi)                    | `{fromUserId, toUserId}`; `fail` `conflict` \| `target_gone`                   |

P28u r3'ten beri katılım ve devir `unattended.silent.notify` yazmaz (eski satırlar `event: join | transfer` ile okunur). Metrikler
`rs_multi_invites_total{result}`, `rs_multi_members{role}`, `rs_multi_denied_total{type}`; alarm runbook §28c.6.

## Sesli görüşme (P28d)

Etkin oturumda teknisyen ile müşteri arasında iki yönlü ses (AC-373..379; mimari `docs/mimari-p28d.md` §4, §6, §7; ADR-0036).
**REST uç noktası eklenmedi**; yalnız WebSocket sinyal mesajları vardır. Ses (Opus) WebRTC üzerinden DTLS-SRTP ile eşler
arası akar; sunucu sesi taşımaz, çözmez, kaydetmez. Sözleşme `packages/contracts/src/ws-voice.ts` (Go eşi
`apps/agent-win/internal/signal/voice.go`), ortak örnekler `packages/contracts/fixtures/voice.json`. Şemalar katıdır
(`z.strictObject`): bilinmeyen alan reddedilir.

### Yetki ve yetenek

- Yetki `sessions.voice` (Oturumlar grubu, "Sesli görüşme"): başlatma, katılma ve dinleme. Admin açık, User kapalı başlar.
- Rol kapısı: `voice.request` ve `voice.join` yalnız oturum sahibi ve katılımcıda; izleyiciden gelirse `FORBIDDEN`.
- Go misafir `/ws/guest` alt protokolüne `rs.cap.voice1` ekler (istemci 0.18.0). Tarayıcı misafir her zaman destekli sayılır.
  `voice.*` mesajları yalnız destekli misafire gider; eski Go istemciye hiçbir `voice.*` gönderilmez.
- Gözetimsiz odada ses yoktur: servis/yardımcı `rs.cap.voice1` bildirmez, sunucu da `voice.request`'i reddeder.
- Teknisyene giden `hello` ve `peer.joined{role:"guest"}` iletilerine `guestVoice: boolean` eklenir (kabul edilmiş misafir
  sesi destekliyor mu). Alan yoksa kabul edilmiş misafir yoktur; `false` → konsolda düğme pasif. Misafire giden `hello`'da yoktur.

### Sabitler

| Ad                           | Değer                 | Anlamı                                                                        |
| ---------------------------- | --------------------- | ----------------------------------------------------------------------------- |
| `VOICE_REQUEST_TIMEOUT_MS`   | 60000                 | Müşterinin yanıt süresi; dolarsa ret (`timeout`)                              |
| `VOICE_DENY_COOLDOWN_MS`     | 30000                 | Ret, zaman aşımı ve `customer`/`device` bitişinden sonra yeni istek beklemesi |
| `VOICE_REQUESTS_PER_SESSION` | 10                    | Oturum başına en çok `voice.request`                                          |
| `VOICE_MAX_OPUS_BYTES`       | 1275                  | Tek Opus paketi üst sınırı (Go çözücü önünde boyut kapısı)                    |
| `VOICE_MAX_PKT_PER_SEC`      | 100                   | Teknisyen başına saniyede en çok Opus paketi (Go)                             |
| `CALL_ID_PATTERN`            | `^[A-Za-z0-9_-]{22}$` | Görüşme kimliği; sunucu üretir (16 rastgele bayt, base64url)                  |

### Teknisyen → sunucu (`/ws/tech`)

| Mesaj           | Alanlar         | Açıklama                                                                                            |
| --------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| `voice.request` | `id?`           | Görüşme ister. `callId` sunucu üretir. Konsol önce mikrofon izni alır; izin yoksa mesaj gönderilmez |
| `voice.join`    | `id?`, `callId` | Etkin görüşmeye konuşan olarak katılır; zaten konuşansa etkisiz                                     |
| `voice.end`     | `id?`, `callId` | Görüşmeyi herkes için bitirir; gönderen konuşanlar içinde olmalı. Neden sunucuda `tech`             |

`id` en çok 26 karakter, isteğe bağlıdır.

### Misafir → sunucu (yalnız destekli misafir soketi)

| Mesaj          | Alanlar                                           | Açıklama                                                                                                           |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `voice.answer` | `id?`, `callId`, `accept: boolean`                | Yerel Kabul/Reddet tıklaması. Yalnız `pending` ve eşleşen `callId` iken işlenir                                    |
| `voice.end`    | `id?`, `callId`, `reason: "customer" \| "device"` | Yalnız `active` iken. `customer` = müşteri bitirdi; `device` = mikrofon açılamadı. İkisi de 30 sn bekleme başlatır |

Eşleşmeyen `callId` ya da faza uymayan misafir mesajı yanıtsız düşer (metrik `code="stale_call"`).

### Sunucu → istemci

| Mesaj           | Alıcı                               | Alanlar                                                                                                        |
| --------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `voice.request` | destekli misafir                    | `callId`, `by` (isteyen teknisyenin tid'i). Diyalog açar, **mikrofon açmaz**                                   |
| `voice.state`   | tüm teknisyenler + destekli misafir | `phase: "idle" \| "pending" \| "active"`, `callId?`, `by?`, `talkers: tid[]`, `listeners: tid[]`, `endReason?` |

`voice.state` kuralları (TS şeması ve Go `validVoiceState` aynı):

- `pending` ve `active`'de `callId` zorunlu. `idle`'da `callId` yalnız `endReason` ile birlikte gelir (biten görüşmenin kimliği).
- `endReason` yalnız `idle`'da: `tech`, `customer`, `timeout`, `left`, `device`, `disconnect`, `session_ended`.
- `talkers ⊆ listeners`; iki liste de benzersiz tid, en çok `MAX_TECHS` öğe.
- Mikrofonu yalnız yerel "Kabul et" tıklaması açar; `voice.request` ve `voice.state` mikrofonu açamaz, yalnız kapatabilir.
  Kabulden sonra 5 sn içinde `active` gelmezse misafir mikrofonu yerelde bırakır.

### Kapılar ve hatalar (`{t:"error", code, message}`)

| Durum                                                             | `code`               | `message`                                                                             | Metrik `code`        |
| ----------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- | -------------------- |
| `sessions.voice` yok (`request` / `join`)                         | `FORBIDDEN`          | "Sesli görüşme yetkiniz yok."                                                         | `permission`         |
| `voice.end` gönderen konuşan değil                                | `FORBIDDEN`          | "Görüşmede konuşan değilsiniz."                                                       | `not_talker`         |
| Gözetimsiz oda                                                    | `CLIENT_UNSUPPORTED` | "Gözetimsiz oturumda sesli görüşme yapılamaz."                                        | `unattended`         |
| Kabul edilmiş misafir yok                                         | `CONFLICT`           | "Müşteri bağlı değil."                                                                | `no_guest`           |
| Misafir sesi desteklemiyor (eski Go istemci)                      | `CLIENT_UNSUPPORTED` | "Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin" | `client_unsupported` |
| Süren görüşme var (`request`) / görüşme başlamadı (`join`, `end`) | `CONFLICT`           | "Sürmekte olan bir sesli görüşme var." / "Görüşme henüz başlamadı."                   | `conflict`           |
| 30 sn bekleme sürüyor                                             | `RATE_LIMITED`       | "Sesli görüşme için 30 sn sonra tekrar deneyebilirsiniz."                             | `cooldown`           |
| Oturumda 10 istek doldu                                           | `RATE_LIMITED`       | "Bu oturumda sesli görüşme isteği sınırına ulaşıldı."                                 | `limit`              |

### Örnekler (`fixtures/voice.json`)

```json
{ "t": "voice.request" }
{ "t": "voice.request", "callId": "AbCdEfGhIjKlMnOpQrSt_-", "by": "AAAAAAAAAAA" }
{ "t": "voice.answer", "callId": "AbCdEfGhIjKlMnOpQrSt_-", "accept": true }
{ "t": "voice.state", "phase": "active", "callId": "AbCdEfGhIjKlMnOpQrSt_-", "by": "AAAAAAAAAAA",
  "talkers": ["AAAAAAAAAAA", "BBBBBBBBBBB"], "listeners": ["AAAAAAAAAAA", "BBBBBBBBBBB", "Ccccccccc-_"] }
{ "t": "voice.end", "callId": "AbCdEfGhIjKlMnOpQrSt_-", "reason": "device" }
{ "t": "voice.state", "phase": "idle", "callId": "AbCdEfGhIjKlMnOpQrSt_-", "by": "AAAAAAAAAAA",
  "talkers": [], "listeners": [], "endReason": "tech" }
{ "t": "peer.joined", "role": "guest", "guestKind": "BROWSER", "guestVoice": false }
```

### Permissions-Policy

- Web sayfalarının başlığını `apps/web/proxy.ts` (`permissionsPolicyFor`) üretir:
  `camera=(), microphone=(self), geolocation=(), display-capture=(self)`. Yalnız `/r` ve alt yolları (herkese açık talep
  formu) `microphone=()` alır. Politika belge yüklenirken sabitlendiği ve konsola yumuşak geçildiği için `(self)` tüm
  sayfalardadır.
- Fastify'ın `/api` ve `/ws` yanıtlarında `microphone=()` değişmedi.
- Girişsiz/herkese açık yeni bir sayfa eklenirse `permissionsPolicyFor` içindeki `()` listesine ve birim testine eklenir.

### Audit ve metrik

| Action          | Aktör                                | `new_value`                                                         | result  |
| --------------- | ------------------------------------ | ------------------------------------------------------------------- | ------- |
| `voice.request` | isteyen teknisyen                    | `{}`                                                                | success |
| `voice.accept`  | müşteri                              | `{}`                                                                | success |
| `voice.reject`  | müşteri / sistem                     | `{reason: "customer" \| "timeout" \| "disconnect"}`                 | fail    |
| `voice.join`    | katılan teknisyen                    | `{}`                                                                | success |
| `voice.end`     | bitiren teknisyen / müşteri / sistem | `{durationSec, reason, talkerIds: userId[], listenerIds: userId[]}` | success |

- `talkerIds` / `listenerIds` görüşme boyunca konuşan ve dinleyenlerin birleşimidir ("görüşmeyi kim dinledi"). Oturum geçmişi
  zaman çizelgesinde yalnız `reason` ve `durationSec` görünür; kullanıcı kimlikleri yalnız audit'te kalır.
- Kapıdan dönen ret audit'e yazılmaz, yalnız metrik tutulur. Ses içeriği ve aygıt adı hiçbir yere yazılmaz.
- Audit süzgecinde grup "Sesli görüşme".
- Metrikler: `rs_voice_calls_total{result="accepted|rejected|timeout"}`, `rs_voice_denied_total{code}` (kodlar yukarıdaki
  tablo + `stale_call`), gauge `rs_voice_active` (etkin görüşmesi olan oda sayısı). Operasyon: runbook §28d.

## macOS istemci (P28f)

Hızlı Destek'in macOS sürümü (istemci 0.19.0) Windows ile aynı REST/WS/DataChannel sözleşmesini kullanır. Yeni WS mesajı,
yeni tablo, migration ve yeni yetki yok. Eklenenler: resolve'da `clientOs`, indirme ucunda `os`, yeni
`/public/agent/availability`, `control.state` kaynağına `OS_PERMISSION`, katılım audit'inde `os`. Kaynak:
`docs/mimari-p28f.md` §4, `packages/contracts/src/api/sessions.ts`, `apps/server/src/public/{agent,routes}.ts`.

### `clientOs` (resolve)

| Alan       | Kural                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clientOs` | İsteğe bağlı, `windows` \| `macos` \| `linux`. `AGENT`'ta yoksa `windows` sayılır; `BROWSER`'da yok sayılır. Geçersiz değer → 400 `VALIDATION`. Değer `joinNonce` kaydına yazılır; join'de yeniden alınmaz |

```bash
curl -sk -X POST https://localhost:4450/api/v1/public/sessions/resolve \
  -H 'Content-Type: application/json' \
  -d '{"code":"<8-hane>","clientKind":"AGENT","clientOs":"macos"}'
```

Yanıt resolve ile aynıdır (şema değişmez). `clientOs` **müşteri beyanıdır**: yetki ya da özellik kararında kullanılmaz.
Tek istisna aşağıdaki `OS_PERMISSION` kabul koşuludur. Windows istemci 0.19.0'dan itibaren `"windows"` gönderir.

Join başarısında audit `guest.pending` `newValue.os` ∈ `windows` \| `macos` \| `linux` \| `browser` (arayüz etiketi
"İşletim sistemi (beyan)"; eski satırlarda alan yok).

### GET /api/v1/public/agent/availability

Karşılama sayfası indirme düğmesini göstermeden önce çağırır. Girdi, `ref` ve çerez yok.

```bash
curl -sk https://localhost:4450/api/v1/public/agent/availability
```

Yanıt 200 (`Cache-Control: public, max-age=60`):

```json
{ "windows": true, "macos": true, "macosTestBuild": false, "macosSigning": "adhoc", "linux": true }
```

| Alan             | Anlamı                                                                                                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `windows`        | Windows ikilisi bütünlük kapısından geçiyor (`AGENT_SHA256` dolu ve dosya eşleşiyor)                                                                                                                                             |
| `macos`          | macOS zip'i kapıdan geçiyor (`MAC_AGENT_SHA256` dolu ve `/data/downloads/NoktaDestek-macOS.zip` eşleşiyor)                                                                                                                       |
| `macosTestBuild` | `DEPLOY_ENV` `production` değil **ve** `macos` true → sayfa imzasız TEST rehberini ("Yine de Aç" adımı) gösterir. Production'da her zaman false                                                                                  |
| `macosSigning`   | P28f-r4 (AC-502): `macos` false → `null`; true → `MAC_AGENT_SIGNING` (`publish-mac.sh` yazar), boşsa `"adhoc"`. Sayfa `"notarized"` dışındaki her değerde (eksik/geçersiz dahil) ad-hoc "Yine de Aç" rehberini gösterir          |
| `linux`          | P28g: Linux ELF'i kapıdan geçiyor (`LINUX_AGENT_SHA256` dolu ve `/data/downloads/NoktaDestek-linux` eşleşiyor). `linuxTestBuild` alanı yoktur (Linux'ta imza ve TEST bandı yok). Eski sunucu alanı göndermezse web `false` sayar |

Hatalar: 429 `RATE_LIMITED` (IP başına 30/dk, `Retry-After`, `Cache-Control: no-store`). Web her hata, 429 ya da şema dışı
yanıtta indirme düğmesini göstermez, yalnız tarayıcı modunu sunar (fail-closed).

### İndirme (`os=macos`)

```bash
curl -sk -i "https://localhost:4450/api/v1/public/agent/download?ref=$REF&os=macos"
```

```
HTTP/2 302
location: /downloads/Destek-48291376.zip
cache-control: no-store
```

Kurallar Windows ile aynıdır (PENDING + süresi dolmamış, aynı hız kovaları). Yalnız istenen platformun kapısı uygulanır;
macOS zip'i hazır değilse 503 `NOT_READY`. Geçersiz `os` → 400 `VALIDATION`, ref kovası tüketilmez. Metrik
`rs_agent_download_total{os}`.

**Caddy (`deploy/Caddyfile` `@agentZip`):** `^/downloads/(NoktaDestek-macOS|Destek-[0-9]{8})\.zip$` aynı zip'i sunar
(`Content-Type: application/zip`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`,
`Cache-Control: no-store`). Sunmadan önce `forward_auth` ile `/internal/agent-ready/macos`'a sorar; `.exe` yolları
`/internal/agent-ready/windows`'a (çıplak `/internal/agent-ready` geçiş süresince Windows takma adıdır). Her iç uç yalnız
kendi kapısını uygular; bilinmeyen alt yol 404. Logda yol `Destek-***` olarak maskelenir.

### `control.state{VIEW, OS_PERMISSION}`

Mac müşterisinde macOS **Erişilebilirlik** izni yoksa (ya da olay musluğu kurulamazsa) istemci kontrol diyaloğunu açmaz,
izin rehberini gösterir ve şunu gönderir:

```json
{ "t": "control.state", "state": "VIEW", "source": "OS_PERMISSION" }
```

- Yalnız `VIEW` ile, yalnız `REQUESTED` fazında, yalnız AGENT misafirden ve nonce'taki `clientOs` `macos` ya da (P28g K10)
  `linux` iken geçerlidir; aksi halde yok sayılır (metrik `rs_control_total{event="os_permission_ignored"}`).
- **İptal** gibi işlenir, ret değil: `session_consents` satırı yazılmaz, 30 sn bekleme başlamaz, istek sayacı iade edilmez.
- Teknisyene `control.state{VIEW, OS_PERMISSION}` iletilir; konsol "Müşterinin bilgisayarı uzaktan kontrole izin vermiyor
  (Mac'te erişilebilirlik izni). Müşteri izni verdikten sonra yeniden isteyin." gösterir. _Değişiklik 2026-11-19 (P28g K10,
  AC-391 notu): konsol misafir işletim sistemini bilmez ve aynı kaynak Linux X11'den de gelir; eski metin "Müşteri
  erişilebilirlik izni vermedi…" idi._
- Audit `control.cancelled{by:"agent", source:"os_permission"}` (zaman çizelgesi etiketi "Müşteri erişilebilirlik izni
  vermedi"); metrik `rs_control_total{event="cancelled_os_permission"}`. Linux misafirde kaynak `linux_no_control` olur
  (bkz. "Linux istemci (P28g)").

### Yetenekler ve sınırlar

macOS istemci Windows ile aynı `rs.cap.*` listesini bildirir; **`rs.cap.voice1` bildirmez** (macOS'ta ses yok, ADR-0037
r3) ve pencere paylaşımı yoktur. Yazdırmada sayfa sayısı istemcide hesaplanmaz: `print.report` sayfa alanı taşımaz
(contracts değişmedi). macOS'ta parola alanı (güvenli metin girişi) `env.state` `elevatedForeground=true` olarak bildirilir.

## macOS'ta Destek iste (P31, istemci 0.24.0)

Firma bağlantısı (`request-download`) Mac'te macOS uygulamasını (`NoktaDestek-<firma>-<ref>.zip`) indirir; macOS istemcisi
Windows'la aynı talep uçlarını kullanır. Yeni WS mesajı, yeni genel uç ve yeni yetki yok. Eklenenler: indirme ucunda `os`,
talep gövdesinde `clientOs`, `support_requests.client_os` sütunu ve iç uç `/internal/agent-ready/macos-firm`. Kaynak:
`docs/mimari-p31.md` §4, §15; `packages/contracts/src/api/requests.ts`, `apps/server/src/requests/{public-routes,service,ref}.ts`,
`apps/server/src/public/routes.ts`, `apps/server/src/lib/agent-os.ts`.

### GET /api/v1/public/agent/request-download?ref=&os=

| Parametre | Kural                                                                                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref`     | Firma (Genel) ya da müşteri ref'i; değişmedi. Biçim denetimi serviste yapılır: biçimsiz ref de 404 `REQUEST_REF_INVALID`                                                                                                                                                                          |
| `os`      | İsteğe bağlı: `windows` \| `macos`. Verilmezse `User-Agent`'tan seçilir: `Macintosh` / `Mac OS X` içerir, `iPhone` / `iPad` / `iPod` içermez **ve** macOS zip'i hazırsa `macos`; diğer her durumda `windows` (eski bağlantılar ve Windows değişmez). UA bir güvenlik kararı değildir ve loglanmaz |

```bash
curl -sk -i "https://localhost:4450/api/v1/public/agent/request-download?ref=$REF&os=macos"
```

```
HTTP/2 302
location: /downloads/NoktaDestek-Acme-k3pqxr2mab4cde7f.zip
cache-control: no-store
```

Hatalar: 400 `VALIDATION` (geçersiz `os`, `linux` dahil; ref hız kovası tüketilmez), 404 `REQUEST_REF_INVALID` (biçim dışı,
yok, yenilenmiş, pasif — hepsi aynı), 429 `RATE_LIMITED`, 503 `NOT_READY` (açık `os=macos` iken macOS zip'i hazır değil;
örtük seçimde kapı kapalıysa `.exe` döner). Hız kovaları, `no-store` ve ref'in loglanmaması Windows ile aynıdır. Metrik:
`rs_agent_download_total{os, kind="firm"}` (P28f jenerik indirmesi aynı sayaçta yalnız `{os}` etiketiyle sayılır;
yalnız firma indirmesi için `kind="firm"` ile süzün).

macOS istemcisi `CLIENT_OUTDATED` ekranındaki **Yeni sürümü indir** ile `…/request-download?ref=<ref>&os=macos` açar.

### Firma zip'i (`/downloads/NoktaDestek-<firma>-<ref>.zip`)

Caddy (`@agentZipFirm`) jenerik macOS zip'ini (`NoktaDestek-macOS.zip`) istenen adla sunar (`Content-Type: application/zip`,
`Content-Disposition: attachment; filename="NoktaDestek-<firma>-<ref>.zip"`, `no-store`). Sunmadan önce `forward_auth` ile
`/internal/agent-ready/macos-firm`'e sorar ve `X-Forwarded-Uri` olarak tam yolu iletir. Logda yol `NoktaDestek-***` olarak
maskelenir. nginx (`deploy/nginx/remote.noktabilisim.net.conf`) `/downloads/NoktaDestek-*` yolunda istemci IP'si başına
10 istek/dk (burst 5) uygular; fazlası 429.

### GET /internal/agent-ready/macos-firm (iç uç)

Yalnız Caddy `forward_auth` içindir; kenar kuralları diğer `/internal/agent-ready/*` uçlarıyla aynıdır (soket adresi
`TRUSTED_PROXY_CIDR` + `X-Forwarded-Method`). Denetim sırası değişmez:

| Adım | Denetim                                                                                                                | Sonuç                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1    | `X-Forwarded-Uri` tam olarak `^/downloads/NoktaDestek-[A-Za-z0-9]{1,20}-[a-z2-7]{16}\.zip$` (büyük/küçük harf duyarlı) | Değilse 404               |
| 2    | Ref aktif ve firma kısa adı güncel `file_label`                                                                        | Değilse 404               |
| 3    | macOS ikili kapısı (`MAC_AGENT_SHA256`)                                                                                | Hazır değilse 503         |
| 4    | —                                                                                                                      | 204 (Caddy dosyayı sunar) |

Eksik, boş, `/downloads/***` ya da sorgu dizeli başlık 1. adımda 404'tür. 404 gövdesi her durumda aynıdır (ref hakkında bilgi
sızmaz). `.exe` yolu yalnız `/windows`, jenerik ve kod zip'i yalnız `/macos` kapısından geçer; uzantı ve kapı
çaprazlanamaz. Yayında önce sunucu, sonra Caddyfile güncellenir; geri alma ters sırayla (runbook §32).

### `clientOs` (talep)

`POST /api/v1/public/requests` gövdesine isteğe bağlı alan:

| Alan       | Kural                                                                                                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clientOs` | `windows` \| `macos`. Yalnız macOS istemcisi gönderir; Windows gövdesi değişmez. Yoksa `windows` sayılır. `linux`, büyük harf ya da başka değer → 400 `VALIDATION` (`fields.clientOs`), kayıt yazılmaz. Web talep formunda (WEB) alan gönderilirse 400. Değer `support_requests.client_os`'a yazılır (WEB'de her zaman NULL) |

```bash
curl -sk -X POST https://localhost:4450/api/v1/public/requests \
  -H 'Content-Type: application/json' \
  -d '{"ref":"<ref>","clientInstanceId":"<22>","clientVersion":"0.24.0","customerName":"Ayşe Yılmaz",
       "phone":"0532 000 00 00","description":"Yazıcı çıktı vermiyor","consentTextId":"01K…",
       "consentAccepted":true,"clientOs":"macos"}'
```

Yanıt ve diğer hatalar değişmez. `clientOs` müşteri beyanıdır, yetki vermez. Etkileri: audit `request.created`
`newValue.clientOs` (yalnız beyan varsa); talep kabul edilip istemci `/ws/guest`'e katılınca misafirin `clientOs`'u bu
değerdir, böylece macOS istemcisinin `control.state{VIEW, OS_PERMISSION}` iletisi kodla açılan Mac oturumundaki gibi kabul
edilir (bkz. "macOS istemci (P28f)").

K3 müşteri mesajı (müşteri bağlantıları, "Müşteriye gönder"): indirme satırının etiketi "Hızlı Destek programı (Windows /
macOS)"; sonuna "Bağlantı her zaman `<PUBLIC_BASE_URL>`/ ile başlar; dosya eki göndermeyiz." satırı eklenir (e-posta ve
WhatsApp; önizleme ve gönderim aynı şablondan).

## Linux istemci (P28g)

Hızlı Destek'in Linux sürümü (istemci 0.20.0; Ubuntu 22.04 / 24.04 LTS x86_64, GNOME, X11 ve Wayland) Windows ve macOS ile
aynı REST/WS/DataChannel sözleşmesini kullanır. Yeni tablo, migration, yetki ve WS mesajı yoktur. Eklenenler: indirme ucunda
`os=linux`, availability'de `linux`, iç uç `/internal/agent-ready/linux`, `control.state` kaynağına `WAYLAND_NO_CONTROL` ve
Linux X11 için `OS_PERMISSION` kabulü. Linux istemcisi resolve'da `clientOs: "linux"` gönderir; katılım audit'inde
`os: "linux"` ("Linux") yazılır. Kaynak: `docs/mimari-p28g.md` §4, `packages/contracts/src/{api/sessions,ws,labels}.ts`,
`apps/server/src/public/{agent,routes}.ts`, `apps/server/src/signaling/{control,control-grant}.ts`.

### İndirme (`os=linux`)

```bash
curl -sk -i "https://localhost:4450/api/v1/public/agent/download?ref=$REF&os=linux"
```

```
HTTP/2 302
location: /downloads/Destek-48291376
cache-control: no-store
```

- Dosya adı **uzantısızdır**; istemci kodu dosya adından okur (Firefox'un `Destek-48291376(1)` adı da kabul edilir).
- Kurallar Windows ile aynıdır (PENDING + süresi dolmamış, aynı hız kovaları, 404/410/429). Yalnız Linux kapısı uygulanır:
  `LINUX_AGENT_SHA256` boşsa, dosya yoksa ya da SHA uyuşmuyorsa 503 `NOT_READY`. Geçersiz `os` → 400 `VALIDATION`, ref
  kovası tüketilmez. Metrik `rs_agent_download_total{os="linux"}`.

**Caddy (`deploy/Caddyfile` `@agentLinux` + `agent_bin_file`):** `^/downloads/(NoktaDestek-linux|Destek-[0-9]{8})$` aynı
ELF'i sunar. Başlıklar: `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="<istenen ad>"`,
`X-Content-Type-Options: nosniff`, `Cache-Control: no-store`; **`Last-Modified` yoktur** (tarayıcı dosya zamanını indirme
anından alır, başlatma komutunun zaman penceresi buna dayanır). Biçim dışı adlar (`Destek-12345678.sh`, `(1)` ekli ad vb.)
server'a gitmeden 404. Sunmadan önce `forward_auth` ile `/internal/agent-ready/linux`'a sorar. Logda yol `Destek-***`.

```bash
curl -sk -o /dev/null -D - https://localhost:4450/downloads/NoktaDestek-linux
```

### `GET /internal/agent-ready/linux` (iç uç)

Yalnız Caddy `forward_auth` içindir; `/internal/agent-ready[/windows|/macos]` ile aynı iki katmanlı koruma (Caddy 404 +
`TRUSTED_PROXY_CIDR` soket adresi + `X-Forwarded-Method`). Yalnız Linux kapısını uygular: **204** ELF hazır, **503**
`NOT_READY`, koruma dışı istek **404**. Windows ve macOS kapıları bağımsızdır (biri kapalıyken diğerleri sunulur).

### `control.state{VIEW, WAYLAND_NO_CONTROL}`

Linux Wayland misafirde kontrol koşulu yoksa istemci kontrol diyaloğunu açmaz ve şunu gönderir:

```json
{ "t": "control.state", "state": "VIEW", "source": "WAYLAND_NO_CONTROL" }
```

Gönderildiği durumlar: portal oturumunda klavye/işaretçi izni yok (müşteri "Uzaktan etkileşime izin ver"i açmadı), ekran
kilidi kısayolu boş ya da kilit devre dışı, oturum D-Bus adresi doğrulanamadı, ya da istemci `WAYLAND_CONTROL=off` ile
derlendi (Wayland'de yalnız görüntü).

- Yalnız `VIEW` ile, yalnız `REQUESTED` fazında, yalnız AGENT misafirden ve nonce'taki `clientOs` `linux` iken geçerlidir;
  aksi halde yok sayılır (metrik `rs_control_total{event="wayland_no_control_ignored"}`).
- **İptal** gibi işlenir, ret değil: `session_consents` satırı yazılmaz, 30 sn bekleme başlamaz, istek sayacı iade edilmez.
- Teknisyene `control.state{VIEW, WAYLAND_NO_CONTROL}` iletilir; konsol AC-399 metnini gösterir: "Müşterinin masaüstü
  uzaktan kontrole izin vermiyor (Wayland)".
- Audit `control.cancelled{by:"agent", source:"wayland_no_control"}` (zaman çizelgesi etiketi aynı metin); metrik
  `rs_control_total{event="cancelled_wayland_no_control"}`.

### `control.state{VIEW, OS_PERMISSION}` Linux X11'de (K10)

Linux X11 misafirde kontrol koşulu yoksa (ör. ekran kilidi izleyicisi için oturum veri yolu doğrulanamadı) istemci
`WAYLAND_NO_CONTROL` değil `OS_PERMISSION` gönderir. Sunucu `OS_PERMISSION`'ı `clientOs` `macos` **ya da** `linux` olan AGENT'tan
kabul eder (Windows'tan hâlâ yok sayılır). İşleyiş macOS ile aynıdır (iptal, bekleme yok, sayaç iade yok); farklar:

- Audit `control.cancelled{by:"agent", source:"linux_no_control"}` (zaman çizelgesi etiketi `LINUX_NO_CONTROL_CANCELLED`:
  "Müşterinin masaüstü uzaktan kontrole izin vermiyor (Linux)"); metrik `rs_control_total{event="cancelled_linux_no_control"}`.
- Konsol misafirin işletim sistemini bilmez; nötr metni gösterir: "Müşterinin bilgisayarı uzaktan kontrole izin vermiyor
  (Mac'te erişilebilirlik izni). Müşteri izni verdikten sonra yeniden isteyin."
- macOS audit kaynağı (`os_permission`, "Müşteri erişilebilirlik izni vermedi") değişmez.

X11'de kontrolü kapatma kısayolu (Ctrl+Shift+F12 / F11) kaydedilemezse istemci `remote_control` yeteneğini hiç bildirmez.

### Yetenekler ve sınırlar

- Linux istemcisi sesli görüşme yeteneğini (`rs.cap.voice1`) bildirir; pencere paylaşımı yoktur, `rs.cap.schat1`
  bildirmez (0.20.0'da oturum sohbeti kapalı, bkz. "Oturum sohbeti (P22)").
- Görüntü **VP8** ile gelir (Windows/macOS H.264); ana ve düşük akış aynı codec'tir. Web ve sunucu codec varsaymaz.
- Wayland'de monitör listesi tek akıştır (ekranı sistem diyaloğu seçtirir); `monitor.request` başka monitör bulamaz.
- Yazdırmada sayfa sayısı istemcide hesaplanmaz (macOS ile aynı); `print.report` sayfa alanı taşımaz.
- Tehlikeli dosya türleri listesine (`DANGEROUS_EXT`) Linux türleri eklendi: `desktop run bin appimage deb rpm snap flatpak
flatpakref flatpakrepo so ko service`. Alıcı tarafta adı `destek-` ile başlayan dosya `Dosya-` önekiyle kaydedilir
  (contracts `receivedFileName`).

## Müşteri portalı (P21)

AC-262, ADR-0039; tasarım `docs/mimari-p21.md` r2 §4–§5, sözleşme özeti `docs/mimari-api.md` "Müşteri portalı (P21)". Kaynak:
`apps/server/src/portal/{routes,guard,auth,session,data,admin,admin-routes,limits,retention}.ts`,
`requests/{service,create-tx,create-steps}.ts` (`createPortal`), `packages/contracts/src/api/portal.ts`
(`@remote/contracts/api/portal`), `permissions.ts` (`customers.portal`), `audit.ts` (`PORTAL_AUDIT`), `labels.ts`.
Yeni hata kodu, env ve bağımlılık yok. Migration `20261127000000_p21_customer_portal` (`portal_users`, `portal_sessions`).

**Kimlik alanı ayrıdır.** Portal kullanıcısı (`portal_users`) panel kullanıcısı değildir; rolü ve yetki toggle'ı yoktur.
Kapsam (firma + müşteri) her istekte oturumun DB satırından türetilir; istekte `tenantId` / `customerId` / `ref` kabul edilmez
(strict şemalar → 400). Panel çerezi portal uçlarında, portal çerezi panel uçlarında geçmez (401).

| Çerez                   | Özellik                                         | İçerik                                                        |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| `__Host-rs_portal`      | httpOnly, Secure, SameSite=Strict, Path=/       | Opak portal oturumu (8 sa mutlak, 30 dk boşta)                |
| `__Host-rs_portal_csrf` | httpOnly değil, Secure, SameSite=Strict, Path=/ | Double-submit CSRF; yazma isteklerinde `x-csrf-token` başlığı |
| `rs_portal_tenant`      | Gizli değil, SameSite=Lax, 365 gün              | Yalnız firma kısa adı (oturum düşünce doğru giriş sayfası)    |

**Ortak kurallar:** `/api/v1/portal/*` yanıtları `Cache-Control: no-store`, gövde ≤ 8 KB. Giriş hariç her uç `requirePortal`
zincirinden geçer: çerez → oturum (hesap, müşteri ve firma aktif) → `Origin` + CSRF (yazma) → ilk giriş şifre kapısı.
Şifre değişimi bekleyen oturumda yalnız `GET /portal/me`, `POST /portal/account/password` ve `POST /portal/auth/logout` açıktır;
diğerleri 403 `PASSWORD_CHANGE_REQUIRED`.

### Sabitler (`packages/contracts/src/api/portal.ts`)

| Sabit                               | Değer    | Anlam                                                                |
| ----------------------------------- | -------- | -------------------------------------------------------------------- |
| `PORTAL_ACCOUNTS_PER_CUSTOMER_MAX`  | 20       | Müşteri başına portal hesabı (aktif + pasif)                         |
| `PORTAL_TEMP_PASSWORD_TTL_HOURS`    | 72       | Geçici şifre geçerliliği (oluşturma ve Admin sıfırlaması)            |
| `PORTAL_REQUESTS_PER_CUSTOMER_HOUR` | 10       | Müşterinin tüm portal hesaplarından saatlik talep                    |
| `PORTAL_PENDING_PER_CUSTOMER_MAX`   | 3        | Portal yolunda müşterinin en çok bekleyen talebi (kaynak fark etmez) |
| `PORTAL_PAGE_SIZE_DEFAULT` / `_MAX` | 25 / 100 | Liste sayfa boyutu; `page` ≤ 10 000                                  |

Giriş hız sınırları (`portal/limits.ts`, panel kovalarından ayrı): IP başına 20/dk (21. → 429); (firma kısa adı + e-posta) + IP
15 dk'da 5 deneme → 15 dk kilit (423); hesapta 1 sa'te 20 hatalı → 15 dk kilit (423, DB sayacı); 2FA kodu e-posta+IP 5/5 dk ve
hesap 15/15 dk; TOTP kur/aç/kapat kullanıcı başına 5/5 dk; mevcut şifre oturum başına 5 hatalı → oturum iptal.

### POST /api/v1/portal/auth/login

Kimlik yok; `Origin` `ALLOWED_ORIGINS`'te olmalı (yoksa 403 `CSRF_INVALID`). `tenantSlug` giriş adresindeki `?tenant=`'tan gelir.

```http
POST /api/v1/portal/auth/login
Content-Type: application/json
Origin: https://remote.example.com

{ "email": "ayse@musteri.com", "tenantSlug": "acme", "password": "…" }
```

200 → `PortalMe` + üç çerez (`__Host-rs_portal`, `__Host-rs_portal_csrf`, `rs_portal_tenant`):

```json
{ "user": { "id": "01K…", "email": "ayse@musteri.com", "fullName": "Ayşe Yılmaz", "theme": "SYSTEM",
            "mustChangePassword": true, "totpEnabled": false },
  "customer": { "name": "Müşteri A.Ş." },
  "provider": { "name": "Acme BT", "logoUrl": "/api/v1/files/logo/01K…/…webp" },
  "links": { "downloadUrl": "https://remote.example.com/api/v1/public/agent/request-download?ref=…", "fileName": "NoktaDestek-<etiket>-<ref>.exe" } }
```

Hatalar: 400 `VALIDATION`; 401 `UNAUTHENTICATED` "E-posta veya şifre hatalı." (olmayan hesap, yanlış şifre, pasif hesap /
müşteri / firma — tek metin); 401 "Geçici şifrenin süresi doldu (72 saat). Destek sağlayıcınızdan yeniden sıfırlama isteyin."
(yalnız şifre doğruysa); 401 "Kod hatalı." (yanlış ya da tekrar kullanılan TOTP); 403 `MFA_REQUIRED` (hesapta TOTP açık,
`totpCode` yok → aynı gövde + `"totpCode": "123456"` ile tekrar); 423 `ACCOUNT_LOCKED` (+ `Retry-After`); 429 `RATE_LIMITED`.

### POST /api/v1/portal/auth/logout · GET /api/v1/portal/me · PATCH /api/v1/portal/me

- `logout`: 204, çerezler silinir (`rs_portal_tenant` kalır). 401, 403 `CSRF_INVALID`.
- `GET /me`: `PortalMe`. 401. `rs_theme` çerezini de yazar.
- `PATCH /me`: gövde `{ "theme": "LIGHT" | "DARK" | "SYSTEM" }` → `PortalMe`. 400, 401, 403 `PASSWORD_CHANGE_REQUIRED`.

### POST /api/v1/portal/account/password

Gövde panelle aynı (`passwordChangeInputSchema`: `{ "current": "…", "next": "…" }`, yeni şifre ≥ 12). 204 + yeni çerezler;
hesabın diğer portal oturumları iptal. 400 `fields.current` "Mevcut şifre hatalı."; oturum başına 5. hatada 401 "Çok fazla
hatalı deneme. Lütfen yeniden giriş yapın." (oturum iptal).

### POST /api/v1/portal/account/totp/setup · /enable · /disable

| Uç        | Gövde                                   | Başarı                                                               | Hatalar                                                                                  |
| --------- | --------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `setup`   | —                                       | 200 `{ secret, otpauthUrl, qrDataUrl }` (QR sunucuda üretilir)       | 401, 403, 409 "İki adımlı doğrulama zaten etkin.", 429                                   |
| `enable`  | `{ "code": "123456" }`                  | 204; **hesabın diğer portal oturumları iptal** (mevcut oturum kalır) | 400 `fields.code` "Kod hatalı veya süresi geçmiş.", 409 (kurulum yok / zaten etkin), 429 |
| `disable` | `{ "password": "…", "code": "123456" }` | 204                                                                  | 400 `fields.password` / `fields.code`, 409 "İki adımlı doğrulama zaten kapalı.", 429     |

TOTP sırrı `APP_ENCRYPTION_KEYS` ile şifreli saklanır (AAD `portalTotpSecret`). Portalda kurtarma kodu ve "cihazı hatırla" yoktur;
kayıp cihazda Admin "Şifreyi sıfırla" TOTP'yi kapatır.

### GET /api/v1/portal/requests · /requests/:id · /sessions · /sessions/:id

Sorgu `?page=&pageSize=` (strict; başka parametre → 400). Yanıt `PortalPage<T>` `{ items, page, pageSize, total }`. Yalnız
oturumun müşterisine ait kayıtlar döner; başka müşteri/firma, olmayan ya da bozuk `:id` → aynı gövdeyle 404.

```json
{ "items": [ { "id": "01K…", "requestCode": "482913", "status": "ACCEPTED", "source": "WEB", "priority": "NORMAL",
               "requesterName": "Ayşe Yılmaz", "createdAt": "2026-11-18T09:12:00.000Z",
               "closedAt": "2026-11-18T09:40:00.000Z", "sessionId": "01K…" } ],
  "page": 1, "pageSize": 25, "total": 1 }
```

`PortalSessionItem`: `id, status, mode, technicianName, customerName, ticketNo, createdAt, startedAt, endedAt, durationSec`.
Sohbet, talep açıklaması, teknisyen notu, IP, cihaz, dosya listesi, kayıt ve kalite özeti **dönmez**.

### GET /api/v1/portal/request-form · POST /api/v1/portal/requests

`request-form` → `PortalRequestFormInfo` (P19 `WebFormInfo`'nun `formToken` ve `minDelayMs`'siz hâli: firma adı/logosu,
aydınlatma metni, sohbet saklama süresi, kanallar, mesai durumu). 401, 403 `PASSWORD_CHANGE_REQUIRED`.

`POST /requests` gövdesi P19 web formunun alanlarıdır; `ref`, `formToken`, `website` yoktur (gelirse 400). Firma web talep formu
kapalı olsa da çalışır; bot kapısı yerine portal oturumu + CSRF + hız sınırı uygulanır.

```http
POST /api/v1/portal/requests
Content-Type: application/json
Origin: https://remote.example.com
x-csrf-token: <__Host-rs_portal_csrf değeri>

{ "clientInstanceId": "…", "customerName": "Ayşe Yılmaz", "phone": "0532 000 00 00", "email": "ayse@musteri.com",
  "description": "Yazıcı çıktı vermiyor", "consentTextId": "01K…", "consentAccepted": true,
  "notify": { "sms": false, "whatsapp": false, "email": true } }
```

201 → `CreateRequestResponse` `{ requestId, requestSecret, requestCode, expiresAt, position }` (talep `source=WEB`; bekleme odası
ve `/ws/request` P19 ile aynı). Audit `request.created` `via: "portal"` + `portalUserId`.

Hatalar: 400 `VALIDATION` (kullanılamaz bildirim kanalı `fields["notify.<kanal>"]`); 401; 403 `CSRF_INVALID` /
`PASSWORD_CHANGE_REQUIRED`; 409 `OUTSIDE_HOURS` (mesai dışı, `fields.nextOpeningAt`); 409 `CONFLICT` "Talep bağlantınız
yenilendi, sayfayı yenileyin." (müşteri bağlantısı aynı anda yenilendi) ya da "Destek talebi şu an açılamıyor; destek
sağlayıcınıza başvurun."; 429 `RATE_LIMITED` (müşteri başına 10/sa, `Retry-After` var); 429 `QUEUE_FULL` "Şu an çok yoğunuz,
lütfen firmanızı telefonla arayın." (müşterinin 3 bekleyen talebi var ya da firma kuyruğu dolu; `Retry-After` yok).

### Panel: /api/v1/customers/:id/portal-accounts

Panel oturumu + CSRF (yazma) + `customers.view` + **`customers.portal`** + `tenantScope`. Super Admin önce firma seçer. Müşteri
`(tenantId, :id)`, hesap `(tenantId, :id, :accountId)` ile aranır; bulunamazsa 404. Yetkisizse 403 (web bölümü gizler).

| Uç                                                 | Gövde                     | Başarı                                            | Hatalar                                                                                                                                      |
| -------------------------------------------------- | ------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET …/portal-accounts`                            | —                         | `{ items: PortalAccountItem[], loginUrl }`        | 401, 403, 404                                                                                                                                |
| `POST …/portal-accounts`                           | `{ "email", "fullName" }` | 201 `{ account, temporaryPassword }`              | 400, 403, 404, 409 (müşteri pasif/anonim; 20 hesap sınırı; `fields.email` "Bu e-posta adresiyle portal hesabı açılamaz."), 429 (firma 30/sa) |
| `POST …/portal-accounts/:accountId/deactivate`     | `{}`                      | `PortalAccountItem` (idempotent; oturumlar iptal) | 403, 404                                                                                                                                     |
| `POST …/portal-accounts/:accountId/reactivate`     | `{}`                      | `PortalAccountItem`                               | 403, 404, 409 (müşteri pasif/anonim)                                                                                                         |
| `POST …/portal-accounts/:accountId/reset-password` | `{}`                      | `{ temporaryPassword }`                           | 403, 404, 409 "Pasif hesabın şifresi sıfırlanamaz; önce etkinleştirin."                                                                      |

`loginUrl = PUBLIC_BASE_URL + /portal/login?tenant=<firma kısa adı>`. `PortalAccountItem`: `id, email, fullName, status
(ACTIVE|PASSIVE), totpEnabled, mustChangePassword, tempPasswordExpired, lastLoginAt, createdAt, passiveAt`. Geçici şifre yalnız
oluşturma ve sıfırlama yanıtında bir kez döner; loga ve audit'e yazılmaz. Sıfırlama: yeni geçici şifre (72 sa), TOTP kapanır,
hesabın tüm portal oturumları iptal. E-posta güncellenemez (uç yok).

Örnek:

```http
POST /api/v1/customers/01K…/portal-accounts
Content-Type: application/json
x-csrf-token: <panel CSRF>

{ "email": "ayse@musteri.com", "fullName": "Ayşe Yılmaz" }
```

```json
{ "account": { "id": "01K…", "email": "ayse@musteri.com", "fullName": "Ayşe Yılmaz", "status": "ACTIVE",
               "totpEnabled": false, "mustChangePassword": true, "tempPasswordExpired": false,
               "lastLoginAt": null, "createdAt": "2026-11-18T09:00:00.000Z", "passiveAt": null },
  "temporaryPassword": "…" }
```

### Audit ve metrikler (P21)

Grup "Müşteri portalı": `portal.login` (başarısızda `reason`: `invalid_credentials`, `inactive`, `invalid_totp`, `replayed_totp`,
`temp_password_expired` …), `portal.locked`, `portal.logout`, `portal.password_change`, `portal.mfa_enabled`
(`revokedSessions`), `portal.mfa_disabled`, `portal.account_created`, `portal.account_deactivated`,
`portal.account_reactivated`, `portal.account_password_reset`, `portal.account_deleted` (saklama işi; kullanıcı `system`).
Entity `portal_users`. Silinmiş portal hesabının kimliği audit listesinde ve CSV'de maskelenir. Geçici şifre ve TOTP kodu yazılmaz.

Metrikler: `rs_portal_login_total{result,reason}`, `rs_portal_locked_total`, `rs_portal_requests_total{result}`
(`created` | `rate_limited` | `queue_full`), `rs_portal_sessions_active`. Alarmlar runbook §30.5.

Saklama: süresi dolmuş/iptal portal oturumları 7 gün sonra, pasif hesaplar firmanın `retention_days` süresi sonra silinir;
müşteri anonimleştirilince portal hesapları ve oturumları aynı işlemde silinir.

## Oturum sohbeti (P22)

Oturum sohbeti artık yalnız sinyalizasyon WebSocket'inden geçer: gönderen → sunucu (doğrula → şifrele → kaydet) → herkese
ilet (AC-264, 291, 292; mimari `docs/mimari-p22.md` §4, §5, §15; ADR-0025). DataChannel `chat` yeni kodda kullanılmaz.
Mesajlar `session_messages` tablosunda AES-256-GCM ile şifreli saklanır, oturum anonimleştirilirken silinir. Sohbet uçtan uca
şifreli değildir. Sözleşme `packages/contracts/src/{chat,ws-chat}.ts`, `src/api/sessions.ts`; ortak örnekler
`packages/contracts/fixtures/ws-session-chat.json`. Yeni env yok. Migration `20261126000000_p22_session_chat` (yalnız UQ
indeksi). Yeni yetki `sessions.view_chat`.

### Yetki

- `sessions.view_chat` ("Sohbet geçmişini görüntüle", hassas): oturum geçmişinde sohbet ve bağlı talebin kabul öncesi
  yazışmasını okur. Admin açık, User kapalı başlar. User'a verilirse `historyScope` onu kendi oturumlarıyla sınırlar.
- Canlı oturumda sohbet yetki istemez: oturuma katılma hakkı (sahip, davetli, `sessions.supervise` izleyici) yeterlidir.

### GET /api/v1/sessions/:id/chat?after=<ulid>

Yetki: `session_history.view` + `sessions.view_chat` + `historyScope` (User yalnız kendi oturumu). Hız: kullanıcı başına
60/dk. Yanıt `Cache-Control: no-store`.

| Girdi   | Kural                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------- |
| `:id`   | Oturum ULID'i. Biçim dışı, yok, kapsam dışı ya da başka firma → 404                                |
| `after` | İsteğe bağlı ULID. Yalnız aynı oturum + firmada aranır; bulunmazsa yok sayılır (baştan listelenir) |

200 yanıtı:

```json
{
  "request": {
    "items": [{ "id": "01JD…", "sender": "CUSTOMER", "senderName": null, "body": "Yazıcı çalışmıyor", "createdAt": "2026-11-18T09:00:00.000Z" }],
    "total": 1
  },
  "session": {
    "items": [{ "id": "01JE…", "sender": "TECH", "senderName": "Ayşe Yılmaz", "body": "Bağlandım", "createdAt": "2026-11-18T09:05:00.000Z" }],
    "more": false
  }
}
```

- `request`: bağlı talebin kabul öncesi yazışması (ilk 200 öğe, artan; `total` tam sayı). Talep yoksa, anonimse ya da
  `after` verildiyse `null`.
- `session.items`: en çok 200 öğe (`SESSION_CHAT_PAGE_MAX`), artan. `more: true` ise son öğenin `id`'siyle `after` verin.
- `senderName` yalnız TECH'te dolu. `body: null` = gövde çözülemedi (ekranda "Mesaj okunamadı";
  `rs_crypto_decrypt_failures_total{table="session_messages"}` artar).

| Hata | Kod            | Ne zaman                                              |
| ---- | -------------- | ----------------------------------------------------- |
| 400  | `VALIDATION`   | `after` ULID değil ya da bilinmeyen sorgu alanı       |
| 403  | `FORBIDDEN`    | `session_history.view` ya da `sessions.view_chat` yok |
| 404  | `NOT_FOUND`    | Oturum yok, kapsam dışı, başka firma                  |
| 429  | `RATE_LIMITED` | 60/dk aşıldı (`Retry-After`)                          |

Audit: `after`'sız çağrıda `session.chat_viewed` (`entity: support_sessions`, `new_value: {messages, requestMessages}` =
yanıtta gösterilen öğe sayıları; gövde yok). Aynı kullanıcı + oturum için 10 dk'da en çok 1 (bellek penceresi; yeniden
başlatmada sıfırlanır). 403 audit'e yazılmaz. Metrik `rs_session_chat_reads_total` her çağrıda artar.

### Mevcut uçlarda değişenler

| Uç                                          | Eklenen alan                                                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/sessions/:id/history`          | `chat: {count, legacy}` — yalnız `sessions.view_chat` sahibine; yetkisizde alan **yok**. `count` = oturum mesaj sayısı; `legacy` = oturumda `session.chat_legacy` audit satırı var |
| `POST /api/v1/public/sessions/resolve`      | `chatRetentionDays: number` (firmanın `retentionDays` değeri; onay düğmesi üstündeki satır)                                                                                        |
| `GET /api/v1/public/requests/tenant`        | `chatRetentionDays` (aynı); müşteri ref'i ve `POST /public/bindings/status` yanıtı da aynı şekilde                                                                                 |
| `GET` / `PUT /api/v1/settings/consent-text` | `chatParagraphMissing: boolean` (güncel metin "Sohbet uçtan uca şifreli değildir" cümlesini içermiyor), `chatParagraph: string` (standart sohbet paragrafı)                        |

Sistem aydınlatma metnine standart sohbet paragrafı eklendi (`CHAT_CONSENT_PARAGRAPH`). `pnpm db:seed` hazır metni kullanan
her firmaya yeni sürüm yayımlar; Admin'in yazdığı metne dokunmaz. Yeni sürüm yayımlanınca eski sürümle açık karşılama/talep
sayfaları join'de 400 alır (AC-127; sayfa yenilenince düzelir).

### WebSocket: yetenek ve kapanış kodu

- Belirteç `rs.cap.schat1` (talep sohbetinin `rs.cap.chat1`'inden ayrı). Sunucu yanıtı yine yalnız `rs.v1`.
- `/ws/guest`: yeni tarayıcı misafir her zaman bildirir. Hızlı Destek 0.20 ve öncesi bildirmez → oturum sohbeti iki tarafta
  kapalıdır; misafire hiçbir `chat.*` mesajı gitmez. Misafir `chat.send` yalnız belirteçli sokette şemadadır; aksi 1008.
- `/ws/tech`: konsol her zaman bildirir. Belirteç yoksa sunucu soketi odaya bağlamadan **4426** (`console_outdated`) ile
  kapatır; konsol "Konsol sürümü eski — sayfayı yenileyin" gösterir. Metrik `rs_ws_tech_outdated_total`.
- Teknisyene giden `hello` ve `peer.joined{role:"guest"}` += `guestChat: "on" | "outdated"`. Alan yoksa kabul edilmiş misafir
  yok ya da oda gözetimsiz. Misafire giden `hello`'da bu alan yoktur.
- Gözetimsiz odada hiçbir `chat.*` mesajı gitmez; teknisyen `chat.send` → `chat.rejected{forbidden}`.

### WebSocket mesajları

| Yön                                          | Mesaj           | Alanlar                                                                                                                                                           |
| -------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| teknisyen / `schat1` misafir → sunucu        | `chat.send`     | `clientMsgId` (`^[A-Za-z0-9_-]{16,36}$`), `body`                                                                                                                  |
| sunucu → tüm teknisyenler + `schat1` misafir | `chat.message`  | `id` (ULID), `sender: "TECH" \| "CUSTOMER"`, `tid?`, `senderName?` (yalnız TECH), `body`, `createdAt`, `clientMsgId?` (yalnız gönderenin kendi kopyasında = onay) |
| sunucu → aynı                                | `chat.history`  | `items` (≤ 100, artan, `clientMsgId`'siz), `more: boolean`. Çerçeve ≤ 48 KiB                                                                                      |
| sunucu → aynı                                | `chat.state`    | `enabled: boolean`, `reason?: "not_active" \| "ended"`                                                                                                            |
| sunucu → gönderen                            | `chat.rejected` | `clientMsgId`, `reason: "rate" \| "cap" \| "invalid" \| "forbidden" \| "not_active" \| "outdated" \| "internal"`                                                  |

Kurallar:

- `body`: NFC + trim, 1..1.000 kod noktası, en çok 20 satır, görünmez/kontrol karakteri yok (P18 talep sohbetiyle aynı
  `chatBodySchema`). Zarf geçerli, gövde geçersiz → `chat.rejected{invalid}`, soket açık kalır.
- Sıra: teknisyende `hello` → `chat.state` → (oda ACTIVE ise ve teknisyenin koltuğu varsa) `chat.history`; misafir kabulünde
  teknisyenlere `chat.state{enabled:true}`; bitişte `chat.state{false,"ended"}`. Misafirde (`schat1`) kabulden sonra
  `chat.state{true}` → `chat.history`.
- Sunucu önce kaydeder, sonra iletir. Kayıt başarısızsa iletim yok, `chat.rejected{internal}`.
- Yinelenen `clientMsgId` (aynı oturum + gönderen) yeniden kaydedilmez; yalnız gönderene yankı gider.
- İzleyici `chat.send` → `forbidden`. Kabul edilmiş misafir eski istemciyse teknisyen `chat.send` → `outdated`, satır 0.
- Sınırlar: gönderen başına 5 mesaj/sn (`rate`); oturumda gönderen başına 2.000 ve toplam 10.000 mesaj (`cap`); firma başına
  müşteri mesajı 600/dk (`rate`, panele `queue.alert`).
- Eski (≤ 0.20) misafire konsol yalnız sabit bildirimi DC `chat` ile gönderir: "Bu sürümde sohbet kapalıdır. Yazdıklarınız
  teknisyene gösterilmez ve kaydedilmez; lütfen sohbet için programı güncelleyin." Misafirden gelen DC `chat` gösterilmez.

Örnekler:

```json
{ "t": "chat.send", "clientMsgId": "AbCdEfGhIjKlMnOpQrSt_-", "body": "Merhaba" }
{ "t": "chat.message", "id": "01JE0000000000000000000000", "sender": "TECH", "tid": "AAAAAAAAAAA", "senderName": "Ayşe Yılmaz",
  "body": "Merhaba", "createdAt": "2026-11-18T09:05:00.000Z", "clientMsgId": "AbCdEfGhIjKlMnOpQrSt_-" }
{ "t": "chat.rejected", "clientMsgId": "AbCdEfGhIjKlMnOpQrSt_-", "reason": "rate" }
{ "t": "peer.joined", "role": "guest", "guestKind": "AGENT", "guestChat": "outdated" }
```

### P18 düzeltmesi: talep geçmişi boyutu

`/ws/request` `request.messages` çerçevesi artık ≤ 48 KiB (`REQUEST_HISTORY_MAX_BYTES`, en çok 50 öğe, en yeniden geriye).
Önceden uzun talep yazışmasında çerçeve Go istemcinin 64 KiB okuma sınırını aşıp yeniden bağlanmada bağlantıyı kopartabiliyordu.
Şema değişmedi (`more` alanı eklenmedi); sığmayan eski mesajlar istemcide görünmez, panel REST'ten tamamını görür.

### Audit ve metrik

| Action                      | `new_value`                                            | Ne zaman                                                                  |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `session.chat_viewed`       | `{messages, requestMessages}`                          | Geçmişte sohbet açıldı (yukarıda)                                         |
| `session.chat_summary`      | `{tech, customer, senderUserIds, legacy}`              | Oturum bitişinde bir kez (her bitiş yolunda, DB'den sayım)                |
| `session.chat_rejected`     | `{reason: cap\|forbidden\|internal\|outdated, sender}` | Neden + gönderen başına oturumda 1                                        |
| `session.chat_legacy`       | —                                                      | Belirteçsiz misafir kabul edildi (oturum başına 1)                        |
| `session.chat_history_sent` | `{userId, n}`                                          | Sonradan katılan üyeye önceki `n` mesaj gönderildi (ilk katılım, `n > 0`) |

Mesaj başına audit yazılmaz; her mesaj zaten append-only, gönderenli ve zaman damgalı bir `session_messages` satırıdır
(K-P22-6). Gövde hiçbir audit/log satırına yazılmaz. `retention.run` sayaçlarına `sessionMessages` eklendi.
Metrikler: `rs_session_chat_messages_total{sender}`, `rs_session_chat_rejected_total{reason}`,
`rs_session_chat_legacy_sessions_total`, `rs_session_chat_reads_total`, `rs_session_chat_store_seconds`,
`rs_ws_tech_outdated_total`, `rs_retention_rows_total{kind="session_messages"}`. Alarm `session-chat-internal` (runbook §29).

## İstemci otomatik güncelleme (P29, 0.22.0)

Kaynak: `apps/server/src/update/{routes,service,service-token,events,device-update,versions,settings-route,manifest-store}.ts`,
`apps/server/src/unattended/{routes,connect}.ts`, `packages/contracts/src/{api/update.ts,api/unattended.ts,ws-device.ts,
audit.ts,errors.ts}`. Tasarım `docs/mimari-p29.md` (r2), ADR-0040; WS ayrıntısı `docs/mimari-protokol.md` §7; operasyon
runbook §31.

**Güven modeli.** CI her ikili için kanonik JSON manifest (`update-<component>-<platform>-<arch>.json`) üretir ve ortamın
Ed25519 anahtarıyla imzalar (`.json.sig`, base64url 86 karakter; imzalanan bayt `"rs-update-manifest-v1\n" ‖ manifest`).
Sunucu manifesti üretmez ve değiştirmez; yalnız şu koşulların hepsi tutarsa sunar: imza `UPDATE_MANIFEST_PUBKEYS`
anahtarlarından biriyle geçerli, `env` = `DEPLOY_ENV` (`production→prod`, `staging→staging`; başka değerde hiçbir manifest
sunulmaz), süresi dolmamış, `sha256` = ilgili ikili kapısının beklenen SHA'sı (`AGENT_SHA256` / `MAC_AGENT_SHA256` /
`LINUX_AGENT_SHA256` / `UNATTENDED_AGENT_SHA256`), servis için `UNATTENDED_MODE=signed` iken SHA `UNATTENDED_SIGNED_SHA256`
listesinde. İstemci her şeyi yeniden doğrular (imza, ortam, platform, süre, sürüm > çalışan ve ≥ görülen en yüksek, boyut,
SHA-256). Güncelleme uçları `MIN_AGENT_VERSION` kapısından muaftır.

Manifest alanları (sabit sıra): `schema` (1), `env` (`prod`|`staging`), `platform` (`windows`|`macos`|`linux`), `arch`
(`amd64`; macOS `universal`), `component` (`client`|`service`; servis yalnız windows), `version` (`x.y.z`), `sha256`, `size`,
`issuedAt`, `expiresAt` (`YYYY-MM-DDTHH:MM:SSZ`; geçerlilik istemcide ≤ 30 g, serviste ≤ 90 g), `minUpdaterVersion`.

### Yeni hata kodu

| Kod               | HTTP | Metin                                         | Nerede                                                                                     |
| ----------------- | ---- | --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DEVICE_UPDATING` | 409  | Cihaz güncelleniyor, birazdan tekrar deneyin. | `POST /api/v1/unattended/devices/:id/connect`: servis kurulumda (3 dk); step-up tüketilmez |

Bağlantı zincirinde yeri: yerel anahtar / bildirim / imza denetimlerinden sonra, **çevrimiçi denetiminden önce**
(`DEVICE_OFFLINE`, `DEVICE_OUTDATED`, `DEVICE_BUSY` bundan sonra gelir). Audit `unattended.connect{result:fail,
failReason:"updating"}`.

### Uçlar

| Uç                                             | Kimlik / yetki                                                                     | Girdi                                                                           | Çıktı                                               | Hatalar                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| `GET /api/v1/public/agent/update`              | Kimliksiz (AGENT kuralı)                                                           | Sorgu `platform`, `arch`, `component=client`, isteğe bağlı `ref`                | 200 `{manifest, signature, policy}` · 204 yayın yok | 400 `VALIDATION`, 429 `RATE_LIMITED` (IP 60/sa) |
| `GET /api/v1/public/agent/update/service-file` | `Authorization: Bearer <belirteç>` (tek kullanımlık, 10 dk)                        | Sorgu dizesi **kabul edilmez**                                                  | 200 `application/octet-stream` (servis ikilisi)     | 404, 429 (IP 20/dk), 503 `NOT_READY`            |
| `POST /api/v1/public/agent/update-events`      | Kimliksiz ya da gövdede kayıt anahtarı                                             | `{platform, arch, component:"client", bindingKeys?[≤5], events[1..20]}` ≤ 8 KiB | 204 (her durumda)                                   | 400 `VALIDATION`, 429 `RATE_LIMITED`            |
| `GET /api/v1/unattended/versions[?scope=all]`  | Oturum; `unattended.connect` ∨ `unattended.manage`; `scope=all` yalnız Super Admin | —                                                                               | Sürüm dağılımı (aşağıda)                            | 400, 403 `FORBIDDEN`                            |
| `GET /api/v1/settings/client-update`           | Oturum; `settings.view`                                                            | —                                                                               | `{ "autoUpdate": boolean }`                         | 401, 403                                        |
| `PUT /api/v1/settings/client-update`           | Oturum + CSRF; `settings.edit` (step-up **yok**)                                   | `{ "autoUpdate": boolean }`                                                     | 200 aynı gövde                                      | 400 `VALIDATION`, 401, 403                      |

Tüm public uçlar `Cache-Control: no-store` ve `X-Content-Type-Options: nosniff` döner. Doğrulama hatalarında `fields`
yalnız alan yolunu ve sabit "Geçersiz değer" metnini taşır; gönderilen değer yansıtılmaz. `ref`, belirteç ve
`bindingKeys` loglanmaz.

### GET /api/v1/public/agent/update

- `platform` + `arch` eşleşmeli: `windows/amd64`, `linux/amd64`, `macos/universal`. `component=service` 400 (servis WS
  kullanır). Bilinmeyen parametre 400.
- `ref` (müşteri dosyası adındaki ref) isteğe bağlıdır ve **hiçbir zaman 400 üretmez**: aktif ref'in firmasında otomatik
  güncelleme kapalıysa `policy:"notify"`, aksi her durumda (ref yok, desen dışı, geçersiz, pasif) `"auto"`.
- 200 gövdesi: `manifest` = manifest ham baytlarının standart base64'ü (≤ 2.732 karakter), `signature` = `.sig` içeriği,
  `policy` = `auto` (indir ve kur) | `notify` (yalnız haber ver).
- Eski sunucuda uç yoktur (404); 0.22 istemci bunu "yayın yok" sayar.

```bash
curl -s -i 'https://remote.noktabilisim.net/api/v1/public/agent/update?platform=windows&arch=amd64&component=client'
# HTTP/2 204  -> sunulabilir manifest yok
```

```json
{
  "manifest": "eyJzY2hlbWEiOjEsImVudiI6InByb2QiLC4uLn0=",
  "signature": "<base64url 86 karakter>",
  "policy": "auto"
}
```

### GET /api/v1/public/agent/update/service-file

Yalnız gözetimsiz servis kullanır. Belirteç WS `update.token` ile verilir (32 bayt, base64url 43 karakter), 10 dakika
geçerlidir, ilk istekte tükenir; cihaz başına tek canlı belirteç vardır. Sıra: biçim (sorgu dizesi ya da biçimsiz
belirteç → 404) → IP 20/dk (429) → eşzamanlı akış sınırı 8 (503 `NOT_READY` + `Retry-After: 300`; belirteç **tüketilmez**)
→ belirteç (geçersiz, kullanılmış, süresi dolmuş → aynı 404) → ikili kapısı ve SHA eşleşmesi (503 `NOT_READY` "Servis
programı şu an indirilemiyor."; belirteç tükenmiştir). `HEAD` yoktur. Audit yazılmaz; metrik
`rs_agent_update_download_total{component,result}`.

### POST /api/v1/public/agent/update-events

Taşınabilir istemcinin (Windows, Linux, macOS) olay bildirimi. Olay: `{type, version, fromVersion, reason?, at}`.

| `type`        | `reason`                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `available`   | yok                                                                                                                                  |
| `installed`   | yok                                                                                                                                  |
| `failed`      | `DOWNLOAD`, `HASH_MISMATCH`, `MANIFEST_SIGNATURE`, `PLATFORM_SIGNATURE`, `DOWNGRADE`, `EXPIRED`, `ENV_MISMATCH`, `INSTALL`, `HEALTH` |
| `rolled_back` | `failed` ile aynı küme (servis: `HEALTH`, `INSTALL`)                                                                                 |
| `skipped`     | `POLICY_OFF`, `NOT_WRITABLE`, `MANUAL_ONLY`                                                                                          |

Güvenlik nedenleri (`MANIFEST_SIGNATURE`, `PLATFORM_SIGNATURE`, `DOWNGRADE`, `HASH_MISMATCH`, `ENV_MISMATCH`)
`rs_agent_update_rejected_total{reason,source}` sayacını artırır.

- Yanıt **her durumda 204**: geçersiz ya da iptal edilmiş kayıt anahtarı ayırt edilmez.
- Hız: IP başına 10 istek/sa (429) ve 30 olay/sa (bütçe kısmen doluysa fazlası düşer, sıfırsa 429); kayıt başına 10
  olay/sa (aşım sessiz düşer, 204).
- Çözülen her kayıt için ilgili firmanın audit'ine `client.update.*` yazılır (`source:"binding"`); kaydın son kullanım
  zamanı değişmez. Hiç kayıt çözülmezse yalnız metrik (`source:"anonymous"`).

```bash
curl -s -i -X POST -H 'Content-Type: application/json' \
  -d '{"platform":"linux","arch":"amd64","component":"client","events":[{"type":"available","version":"0.22.1","fromVersion":"0.22.0","at":"2026-11-19T10:00:00Z"}]}' \
  https://remote.noktabilisim.net/api/v1/public/agent/update-events      # 204
```

### GET /api/v1/unattended/versions

Firma kapsamında gözetimsiz cihazların sürüm dağılımı. `scope=all` yalnız Super Admin'de tüm firmaları sayar (60 sn
önbellek, cihaz adı yok); diğer rollerde 403. Firma seçmemiş Super Admin yalnız `scope=all` kullanabilir.

```json
{
  "published": {
    "service": { "version": "0.22.1", "expiresAt": "2027-02-17T10:00:00Z" },
    "client": { "windows": { "version": "0.22.1", "expiresAt": "2026-12-19T10:00:00Z" }, "macos": null, "linux": null }
  },
  "rows": [
    { "platform": "windows", "component": "service", "version": "0.22.1", "count": 12 },
    { "platform": "windows", "component": "service", "version": "0.22.0", "count": 3 }
  ],
  "belowMin": 0
}
```

`rows` sayısal sürüme göre azalan, en çok 200 satır. `belowMin` = `MIN_AGENT_VERSION` altındaki cihaz sayısı (env boşsa 0).

### Mevcut uçlarda değişenler

| Uç                                            | Değişiklik                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/unattended/devices`, `/:id`      | Satıra `agentVersion`, `updateBadge` (`CURRENT` \| `PENDING` \| `UPDATING` \| `FAILED` \| `BELOW_MIN`), `updateReason` (yalnız `FAILED`'de), `updateVersion` (son olayın hedef sürümü ya da null). Liste sorgusuna `version=x.y.z` süzgeci (birebir eşitlik). Rozet önceliği: asgari sürümün altında → güncelleniyor (son 3 dk) → başarısız/geri alındı (hedef > mevcut) → bekliyor (yayındaki servis sürümü > mevcut ya da `AVAILABLE`/`SKIPPED`) → güncel |
| `POST /api/v1/public/bindings/status`         | 200 yanıtına `autoUpdate: boolean` (firmanın Ayarlar > İstemciler değeri; eski istemci yok sayar)                                                                                                                                                                                                                                                                                                                                                           |
| `POST /api/v1/unattended/devices/:id/connect` | 409 `DEVICE_UPDATING` (yukarıda)                                                                                                                                                                                                                                                                                                                                                                                                                            |

`PUT /settings/client-update` değer değişince tek işlemde audit `settings.client_update {old:{autoUpdate}, new:{autoUpdate}}`
(`tenant_settings`/firma) yazar ve firmanın açık `update1` soketlerine yeni `update.offer` gönderir. Değer aynıysa audit
yazılmaz.

### `/ws/device` `update.*` mesajları (servis 0.22.0+, yetenek `rs.cap.update1`)

Sunucu `update.*` mesajlarını yalnız alt protokol listesinde `rs.cap.update1` bildiren servise gönderir ve ondan kabul
eder. Servis C→S `update.*` mesajlarını yalnız o bağlantıda `update.offer` ya da `update.none` aldıktan sonra yollar (eski
sunucu bilinmeyen mesajda soketi 1008 ile kapatır).

| Yön | Mesaj                  | Alanlar                                           | Kural                                                                                                                      |
| --- | ---------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| S→C | `update.offer`         | `manifest`, `signature`, `policy`                 | `device.ready`'den hemen sonra, `update.check` yanıtı olarak ve firma politikası değişince                                 |
| S→C | `update.none`          | —                                                 | Sunulabilir servis manifesti yok                                                                                           |
| S→C | `update.token`         | `version`, `token`                                | Yalnız `update.token.request` yanıtı; `policy=auto` ve `version` = yayındaki sürüm > cihaz sürümü iken, aksi `update.none` |
| C→S | `update.check`         | —                                                 | 24 sa ± 2 sa; cihaz başına 4/sa                                                                                            |
| C→S | `update.token.request` | `version`                                         | Teklif doğrulandıktan 0–120 dk sonra; 4/sa                                                                                 |
| C→S | `update.state`         | `phase:"installing"`, `version`                   | Sunucu 3 dk "güncelleniyor" bayrağı + DB `INSTALLING`; audit yok; 4/sa                                                     |
| C→S | `update.event`         | `type`, `version`, `fromVersion`, `reason?`, `at` | Audit `client.update.*` (`source:"device"`) + cihaz durum sütunları; 10/sa, fazlası yok sayılır                            |

`device.auth`'ta bildirilen sürüm hedef sürüme ulaştıysa cihazın güncelleme durumu temizlenir.

### Audit ve metrik

| Eylem                       | Etiket                                    | `result`  |
| --------------------------- | ----------------------------------------- | --------- |
| `client.update.available`   | İstemci güncellemesi bulundu              | `success` |
| `client.update.installed`   | İstemci güncellendi                       | `success` |
| `client.update.failed`      | İstemci güncellemesi başarısız            | `fail`    |
| `client.update.rolled_back` | İstemci güncellemesi geri alındı          | `fail`    |
| `client.update.skipped`     | İstemci güncellemesi atlandı              | `success` |
| `settings.client_update`    | İstemci otomatik güncelleme ayarı değişti | `success` |

`new_value`: `{fromVersion, version, reason?, platform, component, source:"device"|"binding"}`; anahtar, belirteç, yol
yazılmaz. `username` servis için `device`, kayıtlı bilgisayar için `client`; kayıtlı bilgisayar satırında IP ağ önekine
indirilir ve UA boştur. Panel `failed` + güvenlik nedenini "Güncelleme reddedildi (imza | platform imzası | eski sürüm |
bütünlük | ortam)", `binding` kaynaklı `failed`'i "İstemci bildirdi: …" diye gösterir; ham eylem anahtarı görünmez.
Audit süzgecinde grup "İstemci güncelleme".

Metrikler: `rs_agent_update_total{platform,component,result,source}`, `rs_agent_update_rejected_total{reason,source}`,
`rs_agent_update_check_total{platform,component,result}`, `rs_agent_update_download_total{component,result}`,
`rs_update_manifest_expiry_seconds{component,platform}`, `rs_unattended_agent_versions{version}` (en çok 50 + `other`).

## Saklama ve anonimleştirme (P13a)

Yeni uç yoktur. Kaynak: `docs/mimari-p13.md` §2–§3, `apps/server/src/jobs/retention.ts`.

**Saklama işi.** Her gün 03:30 (Europe/Istanbul) sunucu içinde çalışır; ikinci tur üst üste binmez, aynı gün ikinci
çalıştırma 0 satır değiştirir (idempotent). Bir firmadaki hata diğer firmaları durdurmaz.

| Veri                                           | Süre                                                                                                                             | İşlem                                                                                                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bitmiş oturum (ENDED/EXPIRED/CANCELLED)        | Firma ayarı `retentionDays` (90–730, varsayılan 365; Ayarlar › Güvenlik › Veri saklama, `PUT /settings/tenant`), `createdAt`'ten | Müşteri adı, e-posta, not ve ağ anahtarları silinir, `anonymized: true` olur; onay kayıtlarının IP/tarayıcı bilgisi silinir (karar, seviye, kaynak, metin sürümü kalır); dosya kayıtları silinir |
| Destek talebi, pasif müşteri, bilgisayar kaydı | Aynı `retentionDays`                                                                                                             | Anonimleştirme / süresi doldu (P8b, P8c davranışı, değişmedi)                                                                                                                                    |
| Audit kayıtları                                | 730 gün (sabit)                                                                                                                  | Silinir                                                                                                                                                                                          |
| Giriş oturumları, şifre sıfırlama bağlantıları | Süre bitiminden 7 gün sonra                                                                                                      | Silinir                                                                                                                                                                                          |

**Sözleşme etkileri:**

- `GET /sessions` ve `GET /sessions/:id/history`: `anonymized: boolean` alanı; anonimse kişisel alanlar `null`, `files: []`
  (ayrıntı yukarıda).
- `PATCH /sessions/:id`: anonim oturumda 409 `SESSION_ANONYMIZED`.
- `GET /sessions/export.csv`: anonim satırda Müşteri = `Anonimleştirildi`, Not boş.
- Audit: müşteri kaynaklı kayıtlarda tam IP yerine ağ öneki (IPv4 /24, IPv6 /48), tarayıcı bilgisi yok; yeni kayıtlarda
  müşteri adı yok (`guest.pending`, `guest.admitted`, `guest.rejected`); dosya aktarım kayıtlarında dosya adı ve SHA-256
  yok, yalnız yön, uzantı, boyut, sonuç.

**Sistem ayarları (`/admin/settings/{mysql,turn,whatsapp}`):**

- PUT/DELETE kullanıcı başına ortak 10/dk; 11. istek 429 `RATE_LIMITED` + `Retry-After`.
- Değeri değiştirmeyen PUT (MySQL: aynı hedef ve veritabanı, şifre yok; TURN: aynı liste, secret yok; WhatsApp: aynı
  kanonik adres) 200 döner, yazım ve audit yapılmaz.
- WhatsApp: kanonik adres, `source: "panel" | "env"` (P13a'da `"default"` da vardı; P13b'de kaldırıldı). Canlı ortamda `http://` + link-local adres
  (`169.254.0.0/16`, `fe80::/10`) artık özel ağ sayılmaz; kanal kapalı kalır (`insecure: true`).

**Metrikler (`/metrics`):** `rs_retention_last_success_timestamp_seconds` (gauge; yalnız hatasız turda ilerler),
`rs_retention_rows_total{kind}` (`sessions|consents|files|requests|customers|bindings|audit|auth_sessions|reset_tokens`),
`rs_retention_failures_total`. Alarm eşikleri: `docs/runbook.md` §18.6.

## Audit

Giriş (başarılı/başarısız), kilit (`auth.locked`, kapsam `account_ip` veya `account`), çıkış ve şifre değişimi
`audit_logs` tablosuna yazılır. P2: `session.created`, `session.cancelled`, `session.expired` (SYSTEM) ve
`session.resolve` başarısız (410 nedeni); oturum token'ı ve kodu audit'e yazılmaz.
P3: `guest.pending`, `guest.admitted`, `guest.admit` (başarısız), `guest.rejected`, `session.join` (başarısız, 410
nedeni), `session.ended`, `session.terminated`, `reconnect.conflict`. `joinNonce`, `wsTicket`, `reconnectToken`,
`admitCode` ve TURN credential'ı log/audit'e yazılmaz (AC-120 testiyle doğrulandı).
P4: `guest.pending` KVKK metin kimliği ve sürümünü, `guest.admitted` `newValue.consent = { textId, version, sha256 }`
özetini içerir.
P5: `file.transfer` (alıcı raporu; entity `session_files`), `file.transfer.sender_report`, `file.meta.rate_limited`
(`{sessionId, side, class}`), `file.meta.rejected_by_db`. Dosya içeriği hiçbir yere yazılmaz. P13a'dan itibaren aktarım
kayıtlarında dosya adı ve SHA-256 yoktur; yalnız yön, uzantı, boyut ve sonuç (`{ sessionId, direction, ext, sizeBytes, result }`).
P6: istemci indirme ucu yeni audit olayı üretmez; süresi dolmuş PENDING için `session.expired` yazılır, 404/410
denemeleri resolve ile aynı başarısız sayaçlara (`rs_resolve_failed`) girer. İkili uyuşmazlığı audit değil server
logunda `alarm: "agent_binary"` olarak (durum geçişinde bir kez; yol ve hash yazılmaz) görünür.
P7: `control.requested`, `control.granted` (`newValue.selfElevated: "true"|"false"|"unknown"`), `control.denied`,
`control.revoked`, `control.released`, `control.cancelled` (`{by:"agent", source}` ise istemci kapattı),
`monitor.requested`, `monitor.granted`, `monitor.denied`, `session.caps_changed`. İzin kararları ayrıca
`session_consents` tablosuna (`level=CONTROL`, `decision=GRANTED|DENIED|REVOKED`, `source=UI|HOTKEY|RECONNECT|SYSTEM|TECH`)
yazılır. Klavye/fare içeriği hiçbir yere yazılmaz.
P8: `session.updated` (`{ ticketNo, noteLength }`, not metni yok), `session.exported` (filtreler, `customerFilter`,
`rows`; müşteri arama metni yok). `ticketNo` maskelenmez (gizli değer değil); `wsTicket` ve diğer `ticket*` anahtarları
maskeli kalır.
P8b-1: `request.created` (yalnız `clientVersion`; IP `ip_address` sütununda), `request.accepted`
(`status`, `sessionId`, `waitSec`), `request.rejected` (ret mesajı), `request.cancelled`, `request.expired`,
`request.connect_failed`, `request.rate_limited` (kova + anahtar türü; kaynak başına dakikada en çok 1),
`request.notify` (alıcı başına; numara maskeli), `settings.support_requests.updated` (eski → yeni),
`settings.support_requests.ref_rotated`, `settings.whatsapp.test`. Ad, telefon, e-posta, açıklama, talep sırrı ve ref
audit'e yazılmaz.
P8c-1: `customer.created`, `customer.updated` (yalnız değişen alanlar; yetkili kişi/telefon/e-posta/not maskeli),
`customer.ref_rotated`, `customer.deactivated` (`revokedBindings`, `cancelledRequests`), `customer.reactivated`,
`customer.anonymized` (sistem), `binding.issued`, `binding.revoked` (`reason`), `binding.denied` (bayat kaynak / pasif; P20 `capacity`);
`request.created` += `{via: "ref"|"binding", customerId}`. Kayıt anahtarı ve ref'in tamamı hiçbir olayda yoktur (ref
yalnız ilk 4 karakter). Geçersiz kayıt denemesi audit'e değil metriğe yazılır.
P9: `user.created` (e-posta, ad, rol, durum; geçici şifre yok), `user.updated` (değişen alanlar eski → yeni),
`user.permission_changed` (anahtar başına bir satır; `user_id` = işlemi yapan, `entity_id` = hedef, `{permKey, granted}`
eski → yeni; aynı işlemde), `user.deactivated`, `user.reactivated`, `tenant.created`, `tenant.updated`,
`tenant.deactivated` (`revokedSessions`, `cancelledSessions`), `tenant.reactivated`, `tenant.switched`
(`actingTenantId` eski → yeni), `tenant_settings.updated` (değişen alanlar). Reddedilen (403) yetki işlemleri henüz audit'e
yazılmaz (B-P9-5, Sonra).
P10: `auth.mfa_setup`, `auth.mfa_enabled`, `auth.mfa_verify` (`method`: totp | recovery; başarısızda `reason`),
`auth.logout_all` (`revokedSessions`), `auth.password_reset_requested` (Super Admin veya SMTP'siz firmada
`fail{reason:no_smtp}`), `auth.password_reset`, `auth.locked` (+ kilit e-postası), `user.mfa_reset` (`deletedCodes`,
`revokedSessions`), `mail.sent` (her e-posta: `kind` = password_reset | account_locked | mfa_enabled | session_link |
request_notify | settings.smtp.test | settings.email.test; alıcı maskeli `a***@example.com`, konu, sonuç, hatada `reason`),
`session.email` (konu + maskeli alıcı; saatlik 20 sayımı bu satırlardan), `settings.smtp.test`, `settings.email.test`,
`request.notify{channel:"email"}`, `tenant_settings.updated` (SMTP şifresi `***`). TOTP kodu, sırrı, kurtarma kodu ve
sıfırlama token'ı hiçbir yere yazılmaz.
P11: `settings.mysql.updated`, `settings.mysql.test` (hedef + sonuç + sınıf; süre yalnız başarıda), `settings.turn.updated`,
`settings.turn.deleted`, `settings.consent_text.updated`, `audit.exported` (filtre özeti + satır sayısı). Sistem ayarı
kayıtlarında `tenantId` boştur. Şifre/secret yalnız `"changed"` işaretiyle görünür.
P12b: `settings.whatsapp.updated`, `settings.whatsapp.deleted` (eski → yeni `{ url, source }`), `settings.whatsapp.test`
(Super Admin testi; `{ recipient (maskeli), result, reason? }`, `tenantId` boş). Firma testiyle aynı eylem adı kullanılır.
P12: `tenant.logo_updated` / `tenant.logo_removed`, `user.avatar_updated` / `user.avatar_removed`, `settings.system_logo.updated`
(eski → yeni `{ path }`, yüklemede `width`/`height`), `upload.rejected` (`result: fail`, `{ kind: logo|avatar|system_logo,
reason: invalid_image|too_large }`), `user.theme_changed` (eski → yeni tema; yalnız değer değiştiğinde). Kuyruk dolu (429)
reddi audit'e yazılmaz. Dosya içeriği hiçbir yere yazılmaz. Audit ekranında satırın avatarı yalnız görüntüleyenin erişebildiği
dosyaysa döner, değilse baş harf.
P13a: `retention.run` (entity `retention`, kullanıcı `system`, `userId` boş). Değişiklik olan ya da hata alan her firma için
bir kayıt: `newValue = { sessions, consents, files, requests, customers, bindings }`; global adımlar için firma alanı boş bir kayıt:
`{ audit, authSessions, resetTokens }`. Yalnız sayılar yazılır; hata olursa `result: fail`. Ekranda "Saklama süresi işi",
grup "Veri saklama". Müşteri kaynaklı kayıtlarda IP ağ önekiyle, tarayıcı bilgisi olmadan yazılır; yeni misafir kayıtlarında ad yoktur.
P13b: `auth.superadmin_reset` (CLI; kullanıcı `cli`, `newValue.mustChangePassword`, `mfaReset`, `revokedSessions`; parola
yok; bulunamazsa `fail{reason:"not_found"}`), `auth.login` fail `{reason:"temp_password_expired"}` (CLI geçici şifresi 24 saati
geçti; yanıt 401 "Geçici şifrenin süresi doldu (24 saat). Sunucu yöneticisinden yeniden sıfırlama isteyin."),
`backup.audit_baseline_reset` (grup "Yedekleme", `backup.*` filtresi), `settings.whatsapp.test` `reason: "unauthorized"`.
P15: `mfa.recovery_regenerated` (`{ count }`; kod yazılmaz), `auth.superadmin_reset` panel yolu (`via: "panel"`),
`settings.system_logo.removed`, `request_block.created` / `request_block.deleted`, `request.rate_limited { bucket: "blocked" }`,
`request.accepted` += `acceptCode: true` (ayar açıkken), `retention.run` += `blocks`, `file.transfer.sender_report` entity
`session_files` (+ `reportedBy`).
P28a: `clipboard.consent`, `clipboard.transfer`, `print.job` (gruplar "Pano paylaşımı", "Uzaktan yazdırma"); pano metni,
belge içeriği, dosya adı ve SHA-256 yazılmaz (ayrıntı "Pano ve uzaktan yazdırma (P28a)").
P21: `portal.*` (grup "Müşteri portalı"; giriş/kilit/çıkış, şifre, 2FA, Admin hesap işlemleri, saklama silmesi),
`request.created` `via: "portal"`; geçici şifre ve TOTP kodu yazılmaz (ayrıntı "Müşteri portalı (P21)").
Şifre, token ve çerez değerleri `***` olarak maskelenir. Kayıtlar Audit log ekranında (`/audit`) ve
`GET /api/v1/audit` ile okunur; değiştirilemez.
