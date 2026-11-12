# API Dokümanı — Remote Support (P1–P8, P8b-1, P8c, P9, P10, P11)

Bu belge P1–P8, P8b-1, P8c-1, P9, P10 ve P11'de **kodda var olan** uçları anlatır. Sonraki paketlerin bağlayıcı sözleşmesi
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

## Genel kurallar
- Taban yol: `/api/v1`. İstek ve yanıt JSON, UTF-8. Dış adres `PUBLIC_BASE_URL` (staging `https://remote.noktabilisim.net`;
  geçiş süresince `https://185.126.217.99:4450`).
- İstek gövdesi en çok 64 KB (Caddy sınırı 2 MB); aşım, bozuk JSON veya yanlış içerik türü → 400 `VALIDATION`.
- Her yanıtta `X-Request-Id` başlığı bulunur; hata gövdesindeki `requestId` ile aynıdır. Kullanıcı "Hata kodu"
  olarak bunu görür; log araması bu değerle yapılır (`docs/runbook.md` §5).
- Tanımsız yol → 404 `NOT_FOUND`.

### Çerezler
| Çerez | Öznitelikler | Amaç |
|---|---|---|
| `__Host-rs_session` | HttpOnly, Secure, SameSite=Strict, Path=/, Domain yok | Opak oturum token'ı (DB'de yalnız SHA-256) |
| `__Host-rs_csrf` | Secure, SameSite=Strict, Path=/, Domain yok, **HttpOnly değil** | CSRF double-submit değeri; JS okur |

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
| Aşama | Ne zaman | İzinli uçlar | Diğer uçlar |
|---|---|---|---|
| `ok` | Tam oturum | Hepsi (yetkiye göre) | — |
| `verify` | 2FA etkin, bu oturumda kod girilmedi | `GET /auth/me` (yetkiler boş), `POST /auth/logout`, `POST /auth/mfa/verify` | 403 `MFA_REQUIRED`; WS bağlantıları reddedilir |
| `setup` | 2FA zorunlu (Super Admin, Admin; User için firma ayarı `requireTech2fa`) ama kurulmamış | Yukarıdakiler + `POST /auth/mfa/setup`, `/auth/mfa/enable`, `/auth/password/change` | 403 `MFA_SETUP_REQUIRED` |

Sıra: önce zorunlu şifre değişimi (`mustChangePassword` iken setup/enable 403 `PASSWORD_CHANGE_REQUIRED`), sonra 2FA kurulumu.

### Hata zarfı
```json
{ "error": { "code": "VALIDATION", "message": "Gönderilen bilgiler geçersiz.",
             "fields": { "next": "Yeni şifre mevcut şifreden farklı olmalı" }, "requestId": "01K…" } }
```
`message` Türkçedir ve kullanıcıya gösterilebilir. `fields` yalnız alan hatalarında bulunur. 500 yanıtı
stack, SQL veya iç ayrıntı içermez.

| Kod | HTTP | Ne zaman |
|---|---|---|
| `VALIDATION` | 400 | Şema hatası (`fields` ile), bozuk/büyük gövde, yanlış mevcut şifre (`fields.current`), güncel olmayan KVKK metni (`fields.consentTextId`) |
| `UNAUTHENTICATED` | 401 | Oturum yok/düşmüş; hatalı kimlik bilgisi (genel mesaj) |
| `FORBIDDEN` | 403 | Yetki anahtarı yok; join'de teknisyenin reddettiği IP; P9: Super Admin firma seçmedi, `/admin/*` SUPER_ADMIN değil, sahip olunmayan yetki (`fields["permissions.<anahtar>"]`), daha geniş yetkili hesap, kendi hesabı |
| `CSRF_INVALID` | 403 | Origin eksik/izinsiz veya `X-CSRF-Token` eşleşmiyor |
| `PASSWORD_CHANGE_REQUIRED` | 403 | İlk giriş şifre değişimi yapılmadan başka uç çağrıldı |
| `MFA_REQUIRED` | 403 | P10: oturum 2FA kodu bekliyor ("Devam etmek için iki adımlı doğrulama kodunu girin.") |
| `MFA_SETUP_REQUIRED` | 403 | P10: 2FA zorunlu ama kurulmamış ("Devam etmeden önce iki adımlı doğrulamayı kurmanız gerekiyor.") |
| `HOST_NOT_ALLOWED` | 400 | P10: SMTP sunucusu özel/iç ağ/loopback/link-local/CGNAT adresine veya sunucunun kendi adresine çözülüyor ("Bu sunucu adresi kullanılamaz.") |
| `RESET_TOKEN_INVALID` | 410 | P10: şifre sıfırlama bağlantısı geçersiz, kullanılmış veya süresi dolmuş |
| `NOT_FOUND` | 404 | Yol veya kayıt yok (başka tenant'ın / başka teknisyenin kaydı da 404) |
| `REQUEST_REF_INVALID` | 404 | P8b: firma ref'i geçersiz, yenilenmiş, firma pasif veya ayarı yok (hepsi aynı yanıt) |
| `CONFLICT` | 409 | Kayıt işleme uygun durumda değil (ör. PENDING olmayan oturumu iptal, ACTIVE olmayanı sonlandırma); P9: e-posta/kısa ad çakışması (`fields.email` / `fields.slug`), zaten pasif/aktif |
| `LOBBY_FULL` | 409 | Bekleme odasında 3 misafir var (join) |
| `OPEN_SESSION_LIMIT` | 409 | Teknisyenin açık oturum sınırı dolu (P8b: talep kabulünde talep beklemede kalır) |
| `REQUEST_PENDING` | 409 | P8b: bu istemci örneğinin zaten bekleyen talebi var |
| `REQUEST_TAKEN` | 409 | P8b: talebi başka teknisyen kabul etti |
| `REQUEST_CLOSED` | 409 | P8b: talep iptal, süre dolumu veya ret ile kapandı |
| `SESSION_EXPIRED` | 410 | Oturum linkinin/kodunun süresi dolmuş |
| `SESSION_CONSUMED` | 410 | Link/kod kullanılmış (müşteri kabul edilmiş) |
| `SESSION_CANCELLED` | 410 | Oturum iptal edilmiş |
| `NONCE_INVALID` | 410 | `joinNonce` süresi dolmuş (60 sn), kullanılmış veya bilinmiyor |
| `CLIENT_OUTDATED` | 426 | P8b: Windows istemci sürümü `MIN_AGENT_VERSION`'dan düşük; `fields.minVersion` |
| `ACCOUNT_LOCKED` | 423 | Giriş kilidi; `Retry-After` (saniye) başlığı ile |
| `METHOD_NOT_ALLOWED` | 405 | P11: audit uçlarına POST/PUT/PATCH/DELETE (`Allow` başlığıyla); audit kayıtları salt okunurdur |
| `RATE_LIMITED` | 429 | Hız sınırı aşıldı (giriş, oturum oluşturma, public uçlar, P8 müşteri araması ve CSV dışa aktarma; P11 audit CSV, MySQL testi, aydınlatma metni kaydı); `Retry-After` ile |
| `QUEUE_FULL` | 429 | P8b: firmada 50 bekleyen talep, ya da ≥ 40 iken bilinmeyen kaynak ("Şu an çok yoğunuz, lütfen firmanızı telefonla arayın.") |
| `INTERNAL` | 500 | Beklenmeyen hata |
| `UPSTREAM` | 502 | P8b: WhatsApp test ucu — servis yapılandırılmamış veya production'da güvensiz adres. P10: SMTP yok ("Önce SMTP ayarlarını yapın") veya gönderim başarısız (tek genel mesaj "E-posta gönderilemedi. Sunucu, port, güvenlik ve kimlik bilgilerini kontrol edin.") |
| `NOT_READY` | 503 | `/ready`: DB'ye ulaşılamıyor veya migration yok; P6: Windows istemci ikilisi yok, yapılandırılmamış veya SHA-256'sı `AGENT_SHA256` ile uyuşmuyor. **P8b-1:** herhangi bir uçta geçici DB çekişmesi (Prisma P2028/P2034, MySQL 1205/1213/45028) veya talep kapısı dolu → `Retry-After: 5`, mesaj "Sunucu şu an yoğun…"; yazma geri alındığından yeniden deneme güvenlidir |

## Uçlar
| Metot | Yol | Yetki | Başarı |
|---|---|---|---|
| POST | `/api/v1/auth/login` | Public (Origin) | 200 + iki çerez |
| POST | `/api/v1/auth/logout` | Oturum + CSRF | 204, çerezler silinir |
| GET | `/api/v1/auth/me` | Oturum | 200 |
| POST | `/api/v1/auth/password/change` | Oturum + CSRF | 204 + yeni çerezler |
| POST | `/api/v1/auth/mfa/setup` (P10) | Oturum + CSRF, aşama `setup` veya `ok` | 200 |
| POST | `/api/v1/auth/mfa/enable` (P10) | Oturum + CSRF, aşama `setup` veya `ok` | 200 |
| POST | `/api/v1/auth/mfa/verify` (P10) | Oturum (aşama `verify`) + CSRF | 200 + yeni çerezler |
| POST | `/api/v1/auth/logout-all` (P10) | Oturum + CSRF | 200 |
| POST | `/api/v1/auth/password/forgot` (P10) | Public (Origin) | 202 |
| POST | `/api/v1/auth/password/reset` (P10) | Public (Origin) | 204 |
| POST | `/api/v1/settings/smtp/test` (P10) | Oturum + CSRF, `settings.edit`, firma bağlamı | 200 |
| POST | `/api/v1/settings/support-requests/email/test` (P10) | Oturum + CSRF, `settings.edit` | 200 |
| POST | `/api/v1/sessions/:id/email` (P10) | Oturum + CSRF, `sessions.create`, oturumun teknisyeni | 200 |
| POST | `/api/v1/users/:id/reset-mfa` (P10) | Oturum + CSRF, `users.edit` | 204 |
| POST | `/api/v1/sessions` | Oturum + CSRF, `sessions.create` | 201 |
| GET | `/api/v1/sessions` | Oturum, `sessions.view` **veya** `session_history.view` | 200 |
| GET | `/api/v1/sessions/export.csv` (P8) | Oturum, `session_history.export` | 200 (CSV akışı) |
| GET | `/api/v1/sessions/:id` | Oturum, `sessions.view` | 200 |
| GET | `/api/v1/sessions/:id/history` (P8) | Oturum, `session_history.view` | 200 |
| PATCH | `/api/v1/sessions/:id` (P8) | Oturum + CSRF, `session_history.edit` | 200 |
| POST | `/api/v1/sessions/:id/cancel` | Oturum + CSRF, `sessions.delete` | 200 |
| POST | `/api/v1/sessions/:id/terminate` | Oturum + CSRF, `sessions.terminate` | 200 |
| POST | `/api/v1/public/sessions/resolve` | Public (Origin veya AGENT) | 200 |
| POST | `/api/v1/public/sessions/join` | Public (Origin veya AGENT) | 200 |
| GET | `/api/v1/public/sessions/status` | Public | 200 |
| GET | `/api/v1/public/agent/download` (P6) | Public | 302 |
| GET | `/downloads/NoktaDestek.exe`, `/downloads/Destek-<8 hane>.exe` (P6, Caddy statik) | Public, server bütünlük kapısı | 200 |
| GET | `/health`, `/ready` | Yalnız iç ağ | 200 |
| GET | `/metrics` | Yalnız iç ağ + `METRICS_TOKEN` (Bearer) | 200 |
| GET | `/internal/agent-ready` (P6) | Yalnız Caddy `forward_auth`; dışarıya kapalı | 204 |
| WS | `/ws/tech?sessionId=<id>` | Oturum çerezi + Origin, oturumun teknisyeni | 101 |
| WS | `/ws/guest` | Subprotocol'de `wsTicket` veya `reconnectToken` | 101 |
| GET | `/api/v1/public/requests/tenant?ref=` (P8b) | Public | 200 |
| POST | `/api/v1/public/requests` (P8b) | Public (yalnız AGENT: Origin ve `Sec-Fetch-*` yok) | 201 |
| POST | `/api/v1/public/requests/cancel` (P8b) | Public (yalnız AGENT) | 204 |
| GET | `/api/v1/public/agent/request-download?ref=` (P8b) | Public | 302 |
| GET | `/downloads/NoktaDestek-<firma>-<ref>.exe` (P8b, Caddy statik) | Public, server ref + bütünlük kapısı | 200 |
| GET | `/api/v1/support-requests` (P8b) | Oturum, `support_requests.view` | 200 |
| GET | `/api/v1/support-requests/count` (P8b) | Oturum, `support_requests.view` | 200 |
| GET | `/api/v1/support-requests/:id` (P8b) | Oturum, `support_requests.view` | 200 |
| POST | `/api/v1/support-requests/:id/accept` (P8b) | Oturum + CSRF, `support_requests.view` + `accept` | 200 |
| POST | `/api/v1/support-requests/:id/reject` (P8b) | Oturum + CSRF, `support_requests.view` + `accept` | 204 |
| GET | `/api/v1/settings/support-requests` (P8b) | Oturum, `settings.edit` | 200 |
| PUT | `/api/v1/settings/support-requests` (P8b) | Oturum + CSRF, `settings.edit` | 200 |
| POST | `/api/v1/settings/support-requests/rotate-ref` (P8b) | Oturum + CSRF, `settings.edit` | 200 |
| POST | `/api/v1/settings/support-requests/whatsapp/test` (P8b) | Oturum + CSRF, `settings.edit` | 200 |
| WS | `/ws/request` (P8b) | Subprotocol `rs.v1, rs.req.<requestSecret>`; Origin yok | 101 |
| WS | `/ws/panel` (P8b) | Oturum çerezi + Origin, `support_requests.view`, tenant bağlamı | 101 |
| GET | `/api/v1/users` (P9) | Oturum, `users.view`, firma bağlamı | 200 |
| POST | `/api/v1/users` (P9) | Oturum + CSRF, `users.create`, firma bağlamı | 201 |
| GET | `/api/v1/users/:id` (P9) | Oturum, `users.view` | 200 |
| PATCH | `/api/v1/users/:id` (P9) | Oturum + CSRF, `users.edit` | 200 |
| POST | `/api/v1/users/:id/deactivate` · `/reactivate` (P9) | Oturum + CSRF, `users.edit` | 204 |
| GET | `/api/v1/settings/tenant` (P9) | Oturum, `settings.view`, firma bağlamı | 200 |
| PUT | `/api/v1/settings/tenant` (P9) | Oturum + CSRF, `settings.edit`, firma bağlamı | 200 |
| GET · POST | `/api/v1/admin/tenants` (P9) | Oturum (+ CSRF), yalnız SUPER_ADMIN | 200 · 201 |
| GET · PATCH | `/api/v1/admin/tenants/:id` (P9) | Oturum (+ CSRF), yalnız SUPER_ADMIN | 200 |
| POST | `/api/v1/admin/tenants/:id/deactivate` · `/reactivate` (P9) | Oturum + CSRF, yalnız SUPER_ADMIN | 200 |
| POST | `/api/v1/admin/switch-tenant` (P9) | Oturum + CSRF, yalnız SUPER_ADMIN | 200 |
| GET | `/api/v1/audit` · `/api/v1/audit/export.csv` (P11) | Oturum, `audit.view` · `audit.export` | 200 |
| POST · PUT · PATCH · DELETE | `/api/v1/audit`, `/audit/export.csv`, `/audit/:id` (P11) | — | 405 |
| GET · PUT | `/api/v1/admin/settings/mysql` (P11) | Oturum (+ CSRF), yalnız SUPER_ADMIN | 200 |
| POST | `/api/v1/admin/settings/mysql/test` (P11) | Oturum + CSRF, yalnız SUPER_ADMIN | 200 |
| GET · PUT · DELETE | `/api/v1/admin/settings/turn` (P11) | Oturum (+ CSRF), yalnız SUPER_ADMIN | 200 |
| GET · PUT | `/api/v1/settings/consent-text` (P11) | Oturum (+ CSRF), `settings.view` · `settings.edit`, firma bağlamı | 200 |

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
            "role": "SUPER_ADMIN", "tenantId": null, "theme": "SYSTEM", "mustChangePassword": true },
  "mfaRequired": false, "mustChangePassword": true }
```
Yanıtta `Set-Cookie: __Host-rs_session=…` ve `Set-Cookie: __Host-rs_csrf=…` gelir. P10: yanıtta ayrıca
`mfaSetupRequired` vardır. `mfaRequired: true` → oturum `verify` aşamasında, `POST /auth/mfa/verify` gerekir;
`mfaSetupRequired: true` → kurulum gerekir (bkz. "2FA aşaması"). Aynı tarayıcının eski oturum çerezi varsa o oturum sunucuda iptal edilir.

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
            "role": "SUPER_ADMIN", "tenantId": null, "theme": "SYSTEM", "mustChangePassword": false },
  "permissions": ["sessions.view", "sessions.create", "…"],
  "tenant": null, "actingTenant": null }
```
`role`: `SUPER_ADMIN` | `ADMIN` | `USER`. `tenant`: `{ id, name, slug }` veya Super Admin için `null`.
`actingTenant` P1'de daima `null` (tenant geçişi P9). `permissions` etkin yetki anahtarlarıdır
(`packages/contracts/src/permissions.ts`). P10: `mfa: { enabled, required, stage: "ok"|"verify"|"setup",
recoveryCodesLeft }`; `verify` aşamasında `permissions` boş ve `actingTenant` `null`. Hata: 401.

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
| Parametre | Kural | Anlam |
|---|---|---|
| `status` | `PENDING` · `ACTIVE` · `ENDED` · `EXPIRED` · `CANCELLED` | Tek durum |
| `mode` | `AGENT` · `BROWSER` | İstemci / tarayıcı. Hiç bağlanılmamış oturum (`mode=null`) eşleşmez |
| `from`, `to` | `YYYY-AA-GG`, geçerli takvim günü | `createdAt` üzerinde **Europe/Istanbul günü**: `from` 00:00 dahil, `to` ertesi gün 00:00 hariç. `from > to` → 400 `fields.to` |
| `technicianId` | ULID | ADMIN / Super Admin. USER'da yok sayılır |
| `tenantId` | ULID | Yalnız firma seçmemiş Super Admin. Diğer rollerde yok sayılır |
| `customer` | 2–100 karakter, kırpılır; kontrol ve görünmez karakter yok | Müşteri adında geçen metin (büyük/küçük harf duyarsız). `%`, `_`, `\` harfiyen aranır. Adı kaydedilmemiş (P8 öncesi) oturumlar eşleşmez |
| `page` | 1–10000, varsayılan 1 | Toplamı aşan sayfa boş `items` döner (hata değil) |
| `pageSize` | 1–100, varsayılan 25 | |
| `sort` | `createdAt:desc` (varsayılan) · `createdAt:asc` | İkincil sıra her zaman `id` (kararlı sayfalama) |

Kapsam (sunucuda uygulanır, filtre bunu genişletemez):
| Rol | Görür |
|---|---|
| USER | Kendi tenant'ında yalnız kendi oturumları |
| ADMIN | Kendi tenant'ının tüm oturumları |
| Super Admin, firma seçili | Seçili firmanın oturumları |
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
               "customerName": "Ahmet Yılmaz", "ticketNo": "INC-1002", "tenant": null } ],
  "page": 1, "pageSize": 25, "total": 1 }
```
- `code` yalnız PENDING iken ve **yalnız oturumun kendi teknisyenine** döner; ADMIN ve Super Admin başka teknisyenin
  bekleyen oturumu için `null` görür (S8-2). `link` hiçbir listede/detayda dönmez.
- `startedAt` = müşterinin kabul edildiği an. `durationSec` yalnız `startedAt` ve `endedAt` doluysa hesaplanır;
  ACTIVE oturumda `null` (arayüz canlı süreyi kendisi hesaplar).
- `tenant` yalnız firma seçmemiş Super Admin'de dolu (`{ id, name }`), diğerlerinde `null`.
- Listede müşteri e-postası ve not **yoktur**; bunlar ayrıntı ucundadır.

Hatalar: 400 `VALIDATION` (`fields` ile), 401, 403, 429 `RATE_LIMITED`.

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
| Alan | Açıklama |
|---|---|
| `customerEmail` | Müşterinin katılırken yazdığı e-posta (yoksa `null`) |
| `note` | Teknisyen notu (`null` olabilir) |
| `terminatedBy` | Yalnız `endedBy=ADMIN` ise `{ id, name }` (sonlandıran yönetici) |
| `quality` | Kalite özeti `{ fps, kbps, rttMs, connType }`; kayıt yoksa veya okunamıyorsa `null` |
| `files[]` | `{ id, direction: TO_CUSTOMER\|TO_TECH, fileName, sizeBytes, sha256, result: OK\|REJECTED\|CANCELLED\|CORRUPT, createdAt }`, en çok 500. İçerik yoktur |
| `consents[]` | `{ id, at, level: VIEW\|CONTROL, decision: GRANTED\|DENIED\|REVOKED, source: UI\|HOTKEY\|RECONNECT\|SYSTEM\|TECH, consentText: { id, version, sha256 } \| null }`, en çok 500. **IP ve tarayıcı bilgisi dönmez** (kanıt DB'de kalır) |
| `controlPeriods[]` | `{ grantedAt, revokedAt, revokedSource, revokedReason, selfElevated }`. Sunucu her `GRANTED`'ı ardından gelen ilk `REVOKED` ile eşleştirir. Kapanış kaydı yoksa `revokedAt`/`revokedSource` `null`; bitiş tahmin edilmez. BROWSER oturumda boş dizi |
| `timeline[]` | `{ at, action, actor: TECH\|CUSTOMER\|ADMIN\|SYSTEM, actorName, result: success\|fail, details }`, en çok 500 olay |
| `timelineTruncated` | 500 olay sınırı aşıldıysa `true` |

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
Hatalar: 401, 403, 404.

### PATCH /api/v1/sessions/:id
Ticket numarası ve not yazar. Yetki: `session_history.edit`; gerekli: `Origin` + `X-CSRF-Token`. Girdi
(`updateSessionInputSchema`, strict, **en az bir alan**):
| Alan | Kural |
|---|---|
| `ticketNo` | `string \| null`; kırpılır; en çok 50 karakter; kontrol, satır sonu ve görünmez karakter yok |
| `note` | `string \| null`; en çok 4.000 karakter; `\n` ve `\t` serbest, CRLF → LF çevrilir; tek `\r` ve diğer kontrol/görünmez karakterler yasak |

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
Hatalar: 400 `VALIDATION` (`fields.ticketNo`, `fields.note`; alan yoksa `fields._`), 401, 403 (`FORBIDDEN`,
`CSRF_INVALID`), 404.

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
- Sütunlar (sabit sıra): `Oturum No; [Firma]; Oluşturma; Başlangıç; Bitiş; Süre; Durum; Mod; Teknisyen; Müşteri;
  Ticket No; Sonlandıran; Bitiş nedeni; Not`. `Firma` yalnız firma seçmemiş Super Admin'de 2. sütundur.
- Zamanlar **Europe/Istanbul** `YYYY-AA-GG SS:dd:ss`; süre `SS:DD:ss` (yoksa boş). Durum, mod, sonlandıran ve bitiş
  nedeni Türkçe etiketle yazılır (ör. `Bitti`, `İstemci`, `Teknisyen`, `Müşteri bitirdi`).
- E-posta, onay kayıtları ve zaman çizelgesi CSV'ye girmez.
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
  kullanılır. `logoUrl`/`avatarUrl` P9/P12'ye kadar `null`.
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
| Yol | Sınır | Aşımda |
|---|---|---|
| Kod, başarısız deneme | IP başına 10/dk ve /24 (IPv6: /56) önek başına 30/dk | Yalnız o IP / önek 15 dk 429 |
| Token | IP başına 30/dk | 429 |
| Kod, toplam başarısız | 60 sn'de 100'ü aşınca `warn` log (`alarm:"resolve_failed"`) | Engellemez; yalnız alarm |

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
| Alan | Kural |
|---|---|
| `joinNonce` | Resolve yanıtındaki değer (43 karakter, tek kullanımlık, 60 sn) |
| `customerName` | 2–100 karakter (baş/son boşluk kırpılır). Kontrol (Unicode `Cc`), biçim/görünmez/yön (`Cf`: sıfır genişlik, bidi, BOM, soft hyphen, etiket karakterleri), satır/paragraf ayırıcı (`Zl`/`Zp`), U+034F ve U+180E içeremez; kontrol kırpmadan **önce** yapılır. ZWJ'li emoji kabul edilmez |
| `customerEmail` | İsteğe bağlı e-posta, ≤ 190 |
| `consentTextId` | **Zorunlu** (P4). Resolve yanıtındaki `consentText.id` (ULID, 26 karakter). Oturumun tenant'ının güncel sürümü olmalı |
| `consentAccepted` | `true` olmalı |
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
- Audit `guest.pending` (misafir kimliği, ad, istemci türü, KVKK metin kimliği ve sürümü; kod yazılmaz).
- Onay kaydı join'de değil, teknisyen kabul ettiğinde (`guest.admit`) oturum tüketimiyle aynı işlemde yazılır
  (`session_consents`: metin kimliği + SHA-256, join anındaki zaman, IP, User-Agent). İstemcinin ek çağrısı yoktur.

Hatalar: 400 `VALIDATION`; 403 `CSRF_INVALID` (Origin/istemci türü uyumsuz) veya `FORBIDDEN` (teknisyen bu IP'yi
reddetti); 409 `LOBBY_FULL` (lobide 3 misafir var); 410 `NONCE_INVALID` veya `SESSION_EXPIRED` / `SESSION_CONSUMED` /
`SESSION_CANCELLED` (410 oturum nedenleri audit'e `session.join` `result=fail` olarak yazılır); 429 `RATE_LIMITED`
(IP başına 20/dk, `Retry-After`).

400 alan hataları (P4):
| `fields` anahtarı | Mesaj | Ne zaman |
|---|---|---|
| `consentTextId` | "Aydınlatma metni güncellendi; sayfayı yenileyip tekrar onaylayın." | Eski sürüm, başka tenant'ın metni veya bilinmeyen id (üçü ayırt edilmez) |
| `consentTextId` | "Aydınlatma metni geçersiz" (alan hiç yoksa genel şema mesajı) | ULID biçiminde değil veya alan yok |
| `customerName` | "Ad görünmez veya kontrol karakteri içeremez" | Yasak karakter |
| `customerName` | "Ad en az 2 karakter olmalı" | Kırpma sonrası 2 karakterden kısa |
| `consentAccepted` | "Aydınlatma metni onaylanmalı" | `true` değil |
```json
{ "error": { "code": "VALIDATION", "message": "Gönderilen bilgiler geçersiz.",
             "fields": { "consentTextId": "Aydınlatma metni güncellendi; sayfayı yenileyip tekrar onaylayın." },
             "requestId": "01K…" } }
```
`consentTextId` hatası `joinNonce`'u yakar (nonce tek kullanımlıktır). İstemci yeniden resolve edip güncel metni
göstermeli ve onayı yeniden almalıdır.

### GET /api/v1/public/agent/download?ref=<sessionRef> (P6)
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
- Hedef yol 8 haneli oturum kodunu taşır; Windows istemcisi kodu dosya adından okur. Tarayıcılar 3xx yanıtındaki
  `Content-Disposition`'ı yok saydığı için dosya adı son yanıttan gelir; 302'de bu başlık yoktur.
- Yalnız oturum **PENDING ve süresi dolmamışsa** 302 döner. Süresi dolmuş PENDING aynı istekte EXPIRED yapılır
  (audit `session.expired`).
- Başarılı indirme audit'e yazılmaz. `ref` ve kod hiçbir log/audit satırına yazılmaz (logger `*.ref` redaksiyonu, Caddy
  log filtresi).

| HTTP | Kod | Ne zaman |
|---|---|---|
| 302 | — | Oturum PENDING ve süresi dolmamış, ikili hazır |
| 404 | `NOT_FOUND` | `ref` eksik, biçimsiz, HMAC'i tutmuyor veya oturum yok |
| 410 | `SESSION_EXPIRED` / `SESSION_CONSUMED` / `SESSION_CANCELLED` | Oturum süresi dolmuş, kabul edilmiş (ACTIVE/ENDED) veya iptal |
| 429 | `RATE_LIMITED` | Hız sınırı veya başarısız deneme kilidi; `Retry-After` (saniye) |
| 503 | `NOT_READY` | İkili yapılandırılmamış (`AGENT_SHA256`/`AGENT_BINARY_PATH` boş), dosya yok veya SHA-256 uyuşmuyor (fail-closed). Mesaj: "İndirme şu anda kullanılamıyor. Biraz sonra tekrar deneyin ya da tarayıcıdan paylaşımı kullanın." |

Hız sınırları (resolve kod yoluyla **ortak** kovalar):
| Sınır | Aşımda |
|---|---|
| Tüm istekler: IP başına 20/dk | 429 (`Retry-After` ≤ 60 sn) |
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

### GET /internal/agent-ready (P6, iç uç — dışarıya kapalı)
Yalnız Caddy `forward_auth` içindir; dışarıdan erişilemez. İki katmanda kapalıdır:
1. Caddy `/internal` ve `/internal/*` yollarını dışarıya **404** döner (`@ops`); yalnız `/api/*` ve `/ws/*` server'a gider.
2. Server isteği yalnız soket adresi `TRUSTED_PROXY_CIDR` içinde olan (tanımsızsa yalnız loopback) **ve**
   `X-Forwarded-Method` başlığı taşıyan GET için yanıtlar; aksi halde **404** (uç varlığı açığa çıkmaz).
   `X-Forwarded-For` değil soket adresi esas alınır; XFF ile taklit edilemez.

Yanıt: **204** ikili hazır; **503** `NOT_READY` (indirme ucuyla aynı kapı, `assertAgentReady`). `Cache-Control: no-store`.
Bu uç `/api` altında değildir: `/api/*` dışarıya açık olduğu için bilinçli olarak dışarıda tutuldu.

## WebSocket sinyalizasyonu (P3)
Sözleşme tek kaynaktan gelir: `packages/contracts/src/ws.ts` (zod, ekstra alan reddedilir); örnek mesajlar
`packages/contracts/fixtures/ws-messages.json`. Tasarım: `docs/mimari-protokol.md`. Görüntü WS'den geçmez;
WS yalnız SDP/ICE ve oturum olaylarını taşır.

### Bağlantı
| | Teknisyen | Müşteri (tarayıcı veya Windows istemcisi) |
|---|---|---|
| URL | `wss://<host>:4450/ws/tech?sessionId=<id>` | `wss://<host>:4450/ws/guest` (**sorgu dizesi olmaz**) |
| Kimlik | `__Host-rs_session` çerezi + izinli `Origin`; yalnız oturumu açan teknisyen (ADMIN dahil başkası değil) | `Sec-WebSocket-Protocol: rs.v1, rs.ticket.<wsTicket>`; yeniden bağlanmada `rs.v1, rs.reconnect.<reconnectToken>` |
| Sunucunun seçtiği subprotocol | — | `rs.v1` |
| Upgrade reddi | HTTP 403 (Origin, çerez, şifre değişimi bekleyen kullanıcı, sahip olmayan teknisyen, kapalı oturum); 429 (IP başına ~30/dk, aşımda 60 sn) | HTTP 403 (sorgu dizesi var, `rs.v1` yok, ticket kullanılmış/bilinmiyor, istemci türü uyumsuz, misafir bağlıyken reconnect → audit `reconnect.conflict`); 429 (IP başına 30/dk) |

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
   ve `ice.servers`. Diğer lobi misafirleri `session.ended{rejected}` alır. Yanlış kod → `error{ADMIT_CODE_INVALID}`;
   5. yanlış denemede lobi boşaltılır.
4. Teknisyen `sdp.offer` gönderir, misafir `sdp.answer` verir; iki taraf `ice` aday mesajları değiş tokuş eder.
5. TURN bilgisi (`iceServers`) bitmeden 5 dk önce `ice.servers` ile yenilenir. Bitime 5 dk kala `session.warning`.
6. Her yeniden bağlanan misafir yeni `reconnectToken` alır; eskisi geçersizleşir. Kopan misafir 120 sn içinde dönmezse oturum biter.

### Mesaj türleri
| `t` | Yön | Alanlar |
|---|---|---|
| `hello` | S→iki taraf | `role`, `sessionId`, `peerPresent`, `guestKind?`, `iceServers[]`, `maxEndsAt` (iso veya `null`), `caps?`, `reconnectToken?` (yalnız misafir), `guestName?` ve `share?` (P4), `maxFileMb?` (P5); aşağıya bakın |
| `lobby.wait` | S→misafir | `expiresAt` |
| `peer.pending` / `peer.pending.left` | S→teknisyen | `guestId`, `name`, `guestKind`, `since` / `guestId`, `reason: left\|timeout\|rejected` |
| `guest.admit` | teknisyen→S | `admitCode` (4 rakam) |
| `guest.reject` | teknisyen→S | `guestId` (ret edilen IP bu oturuma tekrar join olamaz) |
| `ice.servers` | S→iki taraf | `iceServers[]` (`urls[]`, `username?`, `credential?`) |
| `peer.joined` / `peer.left` | S→karşı taraf | `role`, `guestKind?`, `guestName?` (P4) ve `maxFileMb?` (P5) — ikisi de yalnız teknisyene giden `role:"guest"` mesajında / `role`, `reason?: disconnect\|ended` |
| `sdp.offer` | teknisyen→S→misafir | `sdp` (≤ 60 000) |
| `sdp.answer` | misafir→S→teknisyen | `sdp` |
| `ice` | iki yön | `candidate` (≤ 2000), `sdpMid?`, `sdpMLineIndex?` |
| `ice.restart` | teknisyen→S→misafir | — |
| `share.state` | misafir→S→teknisyen | `state: sharing\|stopped`, `monitors?`, `activeMonitor?` |
| `file.meta` | iki taraf→S | P5: `direction`, `fileName`, `sizeBytes`, `sha256`, `result` (aşağıya bakın) |
| `quality.summary` | teknisyen→S | P5: `fps`, `kbps`, `rttMs` (`{avg,min,max}`), `connType` (aşağıya bakın) |
| `session.end` | iki taraf→S | — (PENDING'de teknisyenden gelirse `error{CONFLICT}`; iptal REST ile yapılır) |
| `session.ended` | S→taraf | `reason`: `tech`, `customer`, `timeout`, `max_duration`, `cancelled`, `tenant_passive`, `server`, `admin`, `auth_revoked`, `rejected`, `lobby_timeout` |
| `session.warning` | S→iki taraf | `kind: "max_duration_5min"`, `endsAt` |
| `error` | S→taraf | `code: ADMIT_CODE_INVALID\|CONFLICT\|FORBIDDEN\|RATE_LIMITED\|NOT_FOUND\|VALIDATION\|INTERNAL` (`VALIDATION` P5, `INTERNAL` P7), `message` (≤ 300) |
| P7 kontrol mesajları | — | `control.*`, `monitor.*`, `env.state`, `caps.update`: aşağıda "Uzaktan kontrol (P7)" |

İstemci mesajlarına isteğe bağlı `id` (≤ 26) eklenebilir. Sunucu mesajı karşı tarafa yeniden kurarak iletir.

**P4 ekleri (teknisyen konsolu yeniden bağlanması):**
- `hello.guestName` (≤ 100): yalnız `role:"tech"` hello'sunda ve ACTIVE oturumda; kabul edilen misafirin lobide
  verdiği ad. PENDING oturumda yoktur.
- `hello.share`: yalnız `role:"tech"` hello'sunda; misafirin son `share.state`'i `{ state, monitors?, activeMonitor? }`.
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
| Kod | Ne zaman |
|---|---|
| 1000 | Normal kapanış (oturum bitti) |
| 1008 | Politika: geçersiz JSON / şema hatası / ekstra alan, saniyede 50 mesaj aşımı, lobideki misafirden izinsiz tür |
| 1009 | Mesaj 64 KB'ı aştı |
| 4401 | Teknisyenin oturumu geçersizleşti (60 sn'de bir yeniden doğrulanır); önce `session.ended{auth_revoked}` |
| 4409 | Aynı teknisyen aynı oturuma başka sekmeden bağlandı; eski soket kapanır |

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
| Alan | Tür |
|---|---|
| `direction` | `TO_CUSTOMER` \| `TO_TECH` |
| `fileName` | string 1..255 (sunucu `sanitizeFileName` ile yeniden temizler) |
| `sizeBytes` | tam sayı, 0..2048 MiB |
| `sha256` | `/^[a-f0-9]{64}$/` |
| `result` | `OK` \| `REJECTED` \| `CANCELLED` \| `CORRUPT` |
| `id?` | ≤ 26 |

Her transferde iki taraf da birer rapor gönderir; sunucu raporu kimin gönderdiğini mesajdan değil soketten belirler.
- **Alıcının raporu** (`TO_CUSTOMER` → misafir, `TO_TECH` → teknisyen): `session_files` satırı + audit `file.transfer`
  (entity `session_files`; `OK` → success, diğerleri fail) **tek işlemde** yazılır. Geçmişin tek kaynağıdır.
- **Gönderenin raporu**: `session_files`'a yazılmaz; yalnız audit `file.transfer.sender_report` (entity
  `support_sessions`; yön, temizlenmiş ad, boyut, SHA-256, sonuç). Değiştirilmiş bir konsol `TO_TECH` raporunu
  bastırsa da müşteri tarafının izi kalır.

Sunucunun kontrol sırası ve yanıtları (başarılı kayıtta yanıt mesajı yoktur):
| Durum | Yanıt |
|---|---|
| Oturumun `caps`'inde `file_transfer` yok (teknisyende `file_transfer.use` yetkisi yok) | `error{FORBIDDEN}`, kayıt yok, kota tüketmez |
| PENDING oturumda teknisyenden | `error{CONFLICT}` (lobideki misafirden → 1008 kapanış) |
| `result=OK` ve `sizeBytes` tenant sınırını aşıyor | `error{FORBIDDEN}` |
| Kota aşımı (aşağıdaki tablo) | `error{RATE_LIMITED}` + audit `file.meta.rate_limited` (oda + taraf + sınıf başına dakikada en çok 1 satır) |
| Temizlenmiş ad DB CHECK'ine takıldı (Node/MySQL Unicode sürüm farkı) | `error{VALIDATION}` + audit `file.meta.rejected_by_db` (ad yerine yer tutucu `FILE_NAME_DB_REJECTED`; boyut, yön, SHA-256, sonuç korunur) |
| Diğer DB hatası | Yalnız log (ref ID); istemciye ayrıntı gitmez |

Kotalar (raporlayan taraf × sınıf başına; bir taraf diğerinin kotasını tüketemez):
| Sınıf | Kapsam | Dakikada | Oturum boyunca |
|---|---|---|---|
| `accepted` | Alıcı raporu, `OK`/`CORRUPT` | 60 | 2000 |
| `declined` | Alıcı raporu, `REJECTED`/`CANCELLED` | 20 | 500 |
| `sender` | Gönderen raporu, sonuçtan bağımsız | 10 | 200 |

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
| Etiket | Ayar | Taşıdığı |
|---|---|---|
| `ctl` | sıralı, güvenilir; JSON, mesaj ≤ 16 KB | sohbet, işaretleme, dosya teklif/yanıt mesajları, `ping` |
| `file` | sıralı, güvenilir, ikili | dosya parçaları: `fidIndex` (uint16, big-endian, = `file.offer.idx`) \| `seq` (uint32, 0'dan ardışık) \| veri (≤ 16 KB) |
| `input` | sıralı, güvenilir; JSON | Fare/klavye (P7). Yalnız Windows istemcisi kabul eder; tarayıcı misafiri bu kanalı kapatır. Şema aşağıda "Uzaktan kontrol (P7)" |

`ctl` mesajları (bilinmeyen tip ve ekstra alan reddedilir):
| `t` | Alanlar | Kural |
|---|---|---|
| `chat` | `id`, `text` (1..2000), `ts` (ms) | Alıcı düz metin basar; alıcıda 5 mesaj/sn sınırı |
| `annot.stroke` | `id`, `tool: pen\|arrow\|rect`, `color: red\|yellow\|green\|blue`, `pts: [[x,y],…]` (0..1, ≤ 500 nokta) | Koordinatlar normalize; alıcıda 30/sn |
| `annot.laser` | `x`, `y` (0..1) | Gönderen 30/sn'ye kısar; alıcıda 1 sn'de söner |
| `annot.undo` / `annot.clear` | `id?` | Alıcıda 30/sn |
| `file.offer` | `fid`, `idx` (uint16), `name` (1..255), `size` (≤ 2048 MiB), `sha256` | Alıcı onay ister; ad gösterimden önce temizlenir; tehlikeli/çift uzantı uyarısı. Alıcı 10 sn'de en çok 3 teklif işler, fazlası sessizce düşer; ret sonrası 30 sn yeni teklifler otomatik reddedilir; aynı anda tek bekleyen teklif |
| `file.accept` / `file.reject` / `file.cancel` | `fid` | Kabul gelmeden gönderen parça yollamaz. Yanıtsız teklif 30 sn sonra gönderende `file.cancel` ile kapanır |
| `file.done` | `fid` | Gönderen son parçadan sonra yollar; alıcı alınan bayt = `size` ve SHA-256'yı doğrular |
| `file.result` | `fid`, `ok` | Alıcı → gönderen. `ok=false` → alıcı tamponu siler, iki tarafta "Dosya bozuk"; ardından iki taraf `file.meta` gönderir |
| `ping` | `id?` | — |

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
| `t` | Yön | Alanlar | Ne olur |
|---|---|---|---|
| `control.request` | teknisyen→S→misafir | — | Kontrol isteği. Süzgeç aşağıda. Geçerse oda `REQUESTED`, sayaç +1, audit `control.requested` (iletimden önce yazılır), misafire iletilir |
| `control.cancel` | teknisyen→S→misafir | — | "Vazgeç". `REQUESTED` → `VIEW`, misafire `control.cancel`, teknisyene `control.state{VIEW, TECH}`, audit `control.cancelled`. `GRANTED` iken `control.release` ile aynı. `VIEW` iken yok sayılır. Sayaç geri verilmez; 30 sn bekleme başlamaz |
| `control.release` | teknisyen→S→misafir | — | "Kontrolü bırak". Yalnız `GRANTED` iken: misafire `control.release`, teknisyene `{VIEW, TECH}` (DB beklenmez), sonra consent `REVOKED/TECH` + audit `control.released`. `REQUESTED` iken = cancel; `VIEW` iken yok sayılır |
| `control.state` | misafir→S→teknisyen; S→teknisyen | `state: VIEW\|GRANTED`, `source: UI\|HOTKEY\|DENIED\|RECONNECT\|SYSTEM\|TECH` | Misafirden: `GRANTED` yalnız `UI`; `VIEW` yalnız `UI\|HOTKEY\|DENIED\|SYSTEM` (diğerleri şema hatası → 1008). `RECONNECT` ve `TECH` yalnız sunucu üretir. Ayrıntı: durum tablosu |
| `control.revoke` | S→misafir | `reason: permission\|audit\|admin\|reconnect\|stale` | İstemci her nedende kapıyı ve açık izin diyaloglarını kapatır; kapı açıktıysa `control.state{VIEW, SYSTEM}` döner |
| `caps.update` | S→misafir | `caps: ("remote_control"\|"file_transfer")[]` | Teknisyen yetkisi daraldı. `remote_control` düştüyse ardından `control.revoke{permission}` gelir |
| `monitor.request` | teknisyen→S→misafir | `monitorId: 0..64` | Paylaşılan ekranı değiştirme isteği (yalnız Hızlı Destek). Süzgeç aşağıda. Audit `monitor.requested` |
| `monitor.denied` | misafir→S→teknisyen | `monitorId: 0..64` | Müşteri reddetti (Reddet, Esc, pencereyi kapatma). Yalnız bekleyen istekle aynı kimlik işlenir; 30 sn bekleme başlar; audit `monitor.denied` |
| `env.state` | misafir→S→teknisyen | `elevatedForeground`, `secureDesktop`, `selfElevated` (üçü de zorunlu boolean) | İstemci her `hello`'dan hemen sonra bir kez, sonra yalnız değişimde gönderir. Sunucu son değeri saklar, alanları yeniden kurarak iletir; `selfElevated` GRANTED audit'ine yazılır |

Monitör onayı ayrı mesajla gelmez: isteğin iletildiği **aynı misafir bağlantısından** gelen `share.state.activeMonitor ===
monitorId` onaydır (audit `monitor.granted`). Yanıtsız istek 30 sn sonra ret gibi düşer (mesaj ve audit yok).

### `control.request` süzgeci (ilk tutan döner; istek iletilmez, sayaç değişmez)
| Sıra | Koşul | Yanıt |
|---|---|---|
| 1 | `remote_control.use` yok veya `caps`'te `remote_control` yok | `error{FORBIDDEN, "Uzaktan kontrol yetkiniz yok."}` |
| 2 | Kabul edilmiş misafir bağlı değil | `error{CONFLICT, "Müşteri bağlı değil."}` |
| 3 | Misafir tarayıcı modunda | `error{FORBIDDEN, "Müşteri tarayıcı modunda: yalnız görüntüleme."}` |
| 4 | Önceki istek bekliyor (`REQUESTED`) | `error{CONFLICT, "Önceki kontrol isteği müşteride bekliyor."}` — önce `control.cancel` |
| 5 | Kontrol açık veya izin kaydı yazılıyor | `error{CONFLICT, "Kontrol zaten açık."}` |
| 6 | Son retten bu yana 30 sn geçmedi | `error{RATE_LIMITED, "Müşteri reddetti; 30 sn sonra tekrar isteyebilirsiniz."}` |
| 7 | Bu oturumda 5 istek iletildi | `error{RATE_LIMITED, "Bu oturumda kontrol isteği sınırına ulaşıldı."}` |

### `monitor.request` süzgeci (sayaç kontrolden ayrı)
| Koşul | Yanıt |
|---|---|
| Kabul edilmiş misafir bağlı değil | `error{CONFLICT, "Müşteri bağlı değil."}` |
| Misafir tarayıcı modunda | `error{FORBIDDEN, "Monitör değiştirme yalnız istemci modunda."}` |
| Bilinen monitörler arasında yok | `error{VALIDATION, "Monitör bulunamadı."}` |
| Zaten paylaşılan monitör | `error{VALIDATION, "Bu monitör zaten paylaşılıyor."}` (sayaç düşmez) |
| Bekleyen monitör isteği var | `error{CONFLICT, "Önceki monitör isteği müşteride bekliyor."}` |
| Ret veya yanıtsızlıktan bu yana 30 sn geçmedi | `error{RATE_LIMITED, "Müşteri onaylamadı; 30 sn sonra tekrar deneyin."}` |
| Bu oturumda 5 istek iletildi | `error{RATE_LIMITED, "Bu oturumda monitör isteği sınırına ulaşıldı."}` |

### Durum tablosu (özet; tam hali mimari-protokol §3.3)
| Olay | Oda durumu | Misafire | Teknisyene | Kayıt (consent / audit) |
|---|---|---|---|---|
| `control.state{GRANTED, UI}` | `REQUESTED` → `GRANTED` (TX commit sonrası) | — | `{GRANTED, UI}` | `GRANTED/UI` / `control.granted` (`selfElevated`) |
| Aynı, TX hata veya > 800 ms | `VIEW` | `control.revoke{audit}` | `error{INTERNAL}` | log + ref |
| `control.state{GRANTED}` beklenmedik (`VIEW`) | değişmez | `control.revoke{stale}` | — | yok (metrik) |
| `control.state{VIEW, DENIED}` | `REQUESTED` → `VIEW`, 30 sn bekleme | — | `{VIEW, DENIED}` | `DENIED/UI` / `control.denied` |
| `control.state{VIEW, UI\|HOTKEY\|SYSTEM}` (kontrol açıkken) | → `VIEW` | — | aynı kaynak | `REVOKED/<kaynak>` / `control.revoked` |
| Aynı, istek bekliyorken (istemci diyaloğu kendisi kapattı) | → `VIEW`, bekleme yok | — | aynı kaynak | consent yok / `control.cancelled{by:"agent"}` |
| Yetki daralması | → `VIEW` | `caps.update` + `control.revoke{permission}` | `{VIEW, SYSTEM}` | `REVOKED/SYSTEM` / `control.revoked` + `session.caps_changed` |
| Misafir kopması | → `VIEW` | — | `{VIEW, RECONNECT}` | `REVOKED/RECONNECT` |
| Teknisyen kopması / sekme değişimi | → `VIEW` | önce `control.revoke{reconnect}`, sonra `peer.left`/`peer.joined{tech}` | (yeni `hello` VIEW ile) | `REVOKED/RECONNECT` (`side: "tech"`) |
| Oturum sonu (kontrol açık) | — | `session.ended` | `session.ended` | en iyi çabayla `REVOKED/SYSTEM` (`reason: "session_ended"`) |

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
| `t` | Alanlar | Not |
|---|---|---|
| `m.move` | `x`, `y`: 0..1 | Görüntülenen monitöre göre normalize |
| `m.btn` | `b: l\|r\|m`, `down: bool`, `x`, `y` | — |
| `m.wheel` | `dx`, `dy`: tam sayı −1200..1200 | WHEEL_DELTA (120) birimi; `dy > 0` aşağı |
| `k` | `code`: `^[A-Za-z0-9]{1,32}$` (`KeyboardEvent.code`), `down: bool`, `key?`: 1..4 karakter | `key` yalnız tek yazdırılabilir karakterde (Türkçe harfler düzenden bağımsız yazılır); Ctrl/Alt/Win basılıyken kısayol olarak gider. Ctrl+Alt+Del ve Win+L uygulanmaz |
| `k.release_all` | — | Basılı kalan tuş ve düğmeleri bırakır (konsol bırakmadan önce gönderir) |
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
| Alan | Kural |
|---|---|
| `ref` | `^[a-z2-7]{16}$` (firma bağlantısındaki 80 bit değer) |
| `customerName` | 2–80 karakter, kontrol/biçim karakteri yok |
| `phone` | `05xx…`, `5xx…`, `+905xx…` → `+90…`; uluslararası `+` 8–15 hane. Geçersiz → `fields.phone` |
| `email` | İsteğe bağlı, ≤ 254 |
| `description` | Tek satıra indirilir; 10–500 karakter |
| `clientInstanceId` | `^[A-Za-z0-9_-]{22}$`; `deviceKey` (isteğe bağlı) aynı biçim |
| `clientVersion` | `x.y.z` |
| Ret mesajı | Tek satır, 5–200; bağlantı, e-posta, 7+ haneli numara içeremez |

### GET /api/v1/public/requests/tenant?ref=
Firma bilgisi ve güncel KVKK metni. Yanıt `Cache-Control: no-store`.
```json
{ "tenant": { "name": "Örnek Ltd", "logoUrl": null },
  "consentText": { "id": "01K…", "version": 3, "body": "…", "sha256": "…" },
  "waitMinutes": 30, "abuseEmail": null, "minAgentVersion": null }
```
Hatalar: 404 `REQUEST_REF_INVALID` (biçim dışı, yok, yenilenmiş, pasif — hepsi aynı), 429 `RATE_LIMITED`.

### POST /api/v1/public/requests
Yalnız Windows istemcisi: `Origin` ve `Sec-Fetch-*` başlıkları **olmamalı** (yoksa 403 `CSRF_INVALID`). Gövde ≤ 8 KB.
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

### GET /api/v1/public/agent/request-download?ref=
302 → `/downloads/NoktaDestek-<firma kısa adı>-<ref>.exe` (`no-store`). Dosyayı Caddy sunar; server
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
  "email": { "enabled": false, "recipients": [], "smtpConfigured": false } }
```
PUT gövdesi: `{ waitMinutes: 10..120, trustedCidrs: ≤ 10 tekil (IPv4 en geniş /16, IPv6 /32; özel/loopback yok),
whatsapp: { enabled, recipients: ≤ 5 tekil telefon }, email: { enabled, recipients: ≤ 5 } }`. WhatsApp açıkken en az
bir alıcı; SMTP yokken `email.enabled=true` → 400 "Önce SMTP ayarlarını yapın" (P10; `email.smtpConfigured` bunu gösterir). Bekleme süresi yalnız yeni taleplere
uygulanır. Hata alanları `fields["whatsapp.recipients.1"]`, `fields["trustedCidrs.0"]` biçimindedir.

### POST /api/v1/settings/support-requests/rotate-ref
Gövde `{}` → yeni ayarlar. Eski bağlantı ve indirilmiş eski dosyalar anında 404; bekleyen talepler etkilenmez.

### POST /api/v1/settings/support-requests/whatsapp/test
Gövde `{ "phone": "0532 000 00 00" }` → `{ "ok": true, "message": "…" }` (servis hata verirse `ok:false`, genel metin).
Hatalar: 400, 429 (firma başına 5/dk), 502 `UPSTREAM`.

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
(`wsTicket`, `technicianName`, `techVerifyCode`; istemci müşteri onayından sonra `/ws/guest`'e bağlanır),
`request.closed` (`status`, `reason?`, ret mesajı). İstemci → sunucu: `request.cancel`, `request.decline`.

### WebSocket `/ws/panel` (teknisyen paneli, tek yönlü)
Oturum çerezi + izinli `Origin` + `support_requests.view` + firma bağlamı; kullanıcı başına ≤ 5 soket (6. → 4429).
İstemciden gelen her mesaj 1008. Çıkış, şifre değişimi veya yetki kaybında 4401. Mesajlar: `queue.count`,
`request.new` (ad + açıklamanın ilk 100 karakteri; telefon/e-posta yok), `request.removed`,
`request.connect_failed` ve `request.declined` (yalnız kabul edene), `queue.alert` (olağan dışı yoğunluk).
Kaçırılan olayın kaynağı REST'tir; panel yeniden bağlanınca listeyi yeniden çeker.

### Hız sınırları (bellek içi; aşımda o anahtar 15 dk 429 + `Retry-After`, aksi belirtilmedikçe)
| Kova | Anahtar | Sınır | Uç |
|---|---|---|---|
| Geçersiz ref | IP | 10/dk | tenant bilgisi, talep oluşturma, indirme, geçersiz `/ws/request` sırrı |
| Talep oluşturma | IP / ağ öneki (IPv4 /24) / IPv6 /48 | 5/sa / 20/sa / 40/sa | POST `/public/requests` (güvenilen ağ muaf) |
| Talep oluşturma | Firma | 60/sa bilinmeyen kaynak, 120/sa bilinen kaynak | Firma kilitlenmez; yalnız bilinmeyen kaynak reddedilir, panele `queue.alert` |
| Bekleyen talep (DB) | İstemci örneği / IP / ağ / firma | 1 / 3 / 10 / 50 | 409 `REQUEST_PENDING` / 429 `RATE_LIMITED` / 429 / 429 `QUEUE_FULL` (≥ 40 iken bilinmeyen kaynak da `QUEUE_FULL`) |
| İndirme | IP | 30/sa | `request-download` |
| Tenant bilgisi | IP | 60/dk | GET `/public/requests/tenant` |
| İptal | IP | 30/dk | POST `/public/requests/cancel` |
| WhatsApp testi | Firma | 5/dk (1 dk blok) | `whatsapp/test` |
| Kabul/ret | Kullanıcı | 30/dk (1 dk blok) | accept, reject |
| WS el sıkışma | IP | 30/dk (1 dk blok) | `/ws/request`, `/ws/panel` |
| Talep kapısı | Firma / toplam | 2 / 4 eşzamanlı, kuyruk 16 / 64, bekleme 5 sn | Dolunca 503 `NOT_READY` + `Retry-After: 5` |

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
| Uç | Yetki | Etkisi | Hatalar |
|---|---|---|---|
| `rotate-ref` | `customers.edit` | Yeni ref; eski bağlantı ve dosyalar anında 404; müşterinin kayıtlı bilgisayarları geçersiz (`CUSTOMER_ROTATED`). Bekleyen talepler etkilenmez | 404, 409 `CONFLICT` (pasif), 429 |
| `deactivate` | `customers.delete` | `ACTIVE → PASSIVE`; bağlantı 404, kayıtlar geçersiz (`CUSTOMER_PASSIVE`), bekleyen talepler `CANCELLED(CUSTOMER_PASSIVE)`. Kalıcı silme yoktur | 404, 409 (zaten pasif), 429 |
| `reactivate` | `customers.edit` | **Yeni** ref üretilir; eski ref ve kayıtlar geçersiz kalır | 404, 409 (zaten aktif), 429 |

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
- `POST /sessions` gövdesi `{ "customerId": "01K…" }` (isteğe bağlı, ULID). Verilirse `customers.view` gerekir (yoksa
  403) ve müşteri aynı tenant'ta **aktif** olmalı (yoksa 404). Oturum yanıtları ve geçmiş += `customerFirm`. Talep kabulü
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
{ "tenant": { "name": "Örnek Destek Ltd", "logoUrl": null },
  "consentText": { "id": "01K…", "version": 4, "body": "…", "sha256": "…" },
  "waitMinutes": 30, "abuseEmail": null, "minAgentVersion": null,
  "customer": { "name": "Örnek Muhasebe Ltd." } }
```
`customer` Genel kayıtta `null`. Kaydın son kullanım zamanını değiştirmez. Hatalar: 404 `BINDING_INVALID`, 426
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
| `t` | Yön | Alanlar | Davranış |
|---|---|---|---|
| `binding.offer` | S → misafir | — | Misafir kabul edilip `hello` gönderildikten hemen sonra; yalnız Windows istemcisine ve ticket'taki `clientVersion ≥ 0.10.0` ise. Yeniden bağlanmada tekrar gönderilir. 0.9.x hiç almaz |
| `binding.request` | misafir → S | `id?`, `previousKey?` (`rsb_…`, yalnız kayıt aynı sunucudansa) | Teklif alındıktan sonra bir kez. Ret: kabul edilmemiş misafir → kapanış 1008; tarayıcı → `error{FORBIDDEN}`; teklifsiz, oturum aktif değil, tenant/müşteri pasif veya bayat kaynak → `error{CONFLICT}`; oturum başına 3. istekten sonra → `error{RATE_LIMITED}` |
| `binding.issued` | S → misafir | `bindingKey`, `tenantName` (≤ 120), `customerFirmName` (≤ 100 veya `null`), `renewed` | Yalnız isteyen sokete. `previousKey` geçerliyse eski anahtar ölür (rotasyon). Anahtar başka mesaj, log veya audit'te yer almaz |
İstemci `error` yanıtında oturuma devam eder, kayıt yazmaz.

### Hız sınırları (P8c ekleri)
| Kova | Anahtar | Sınır | Uç |
|---|---|---|---|
| Geçersiz ref (mevcut) | IP | 10/dk | + geçersiz kayıt (`bindings/status`, kayıtla talep) |
| Kayıt durumu | IP | 60/dk | `POST /public/bindings/status` |
| Kayıt iptali | IP | 30/dk | `POST /public/bindings/revoke` |
| Kayıtla talep | Kayıt | 6/sa + 1 bekleyen | `POST /public/requests` (`bindingKey`) |
| Kayıt verme | Oturum | 3 istek | WS `binding.request` |
| Müşteri yazma | Kullanıcı | 30/dk | Müşteri POST/PATCH/rotate/deactivate/reactivate, `revoke-binding` |

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
mustChangePassword, totpEnabled, lastLoginAt|null, createdAt }` (`lastLoginAt: null` "hiç giriş yapmadı" demek değildir).
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
(diğer alanların ekranı henüz yok):
```json
{ "sessionTtlMin": 15, "maxOpenSessions": 3, "maxActiveHours": 4, "maxFileMb": 100, "retentionDays": 365,
  "requireTech2fa": true,
  "smtp": { "host": "smtp.example.com", "port": 587, "security": "STARTTLS", "user": "bildirim@example.com",
            "fromName": "Örnek Destek", "fromEmail": "bildirim@example.com", "hasPassword": true } }
```
| Alan | Anlamı | Aralık |
|---|---|---|
| `sessionTtlMin` | Oturum linki/kodu geçerlilik süresi (dk) | 15–30 |
| `maxOpenSessions` | Teknisyen başına bekleyen oturum sınırı | 1–10 |
| `maxActiveHours` | Etkin oturumun en uzun süresi (saat) | 1–8 |
| `maxFileMb` | Dosya transferi üst sınırı (MB) | 1–2048 |
| `retentionDays` | Oturum kayıtlarının saklama süresi (gün) | 90–730 |
| `requireTech2fa` (P10) | User rolü için 2FA zorunlu mu (Admin/Super Admin her zaman zorunlu) | `true`/`false`, varsayılan `true` |
| `smtp` (P10) | Firma SMTP ayarı; yoksa `null` | aşağıda |

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
| Uç | Etkisi | Hatalar |
|---|---|---|
| `deactivate` | Tek işlemde: durum PASSIVE, firmanın kullanıcı oturumları iptal, bekleyen kod oturumları `CANCELLED(tenant_passive)`, audit. Sonra etkin oturumlar `session.ended{tenant_passive}`, panel soketleri kapanır, bekleyen talepler `TENANT_PASSIVE`, bilgisayar kayıtları geçersiz | 404, 409 "Firma zaten pasif." |
| `reactivate` | Durum ACTIVE; kullanıcılar yeniden giriş yapabilir. İptal edilen talep ve kayıtlar geri gelmez | 404, 409 "Firma zaten aktif." |

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
Yetki `sessions.create`; yalnız oturumun kendi teknisyeni. Gövde `{ "to": "musteri@example.com", "link": "<oluşturma
yanıtındaki link>" }` → `{ "sent": true }`. Düz token sunucuda tutulmadığı için bağlantı istemciden gelir; sunucu
`${PUBLIC_BASE_URL}/session/<token>` biçimini ve token'ın bu oturuma ait olduğunu doğrular (başka adres gönderilemez).
E-posta: teknisyen adı, firma, bağlantı, 8 haneli kod, son geçerlilik (Türkiye saati), logo.
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

| Metot | Yol | Yetki | Başarı |
|---|---|---|---|
| GET | `/api/v1/audit` | Oturum, `audit.view` | 200 |
| GET | `/api/v1/audit/export.csv` | Oturum, `audit.export` | 200 (`text/csv`) |
| POST · PUT · PATCH · DELETE | `/api/v1/audit`, `/api/v1/audit/export.csv`, `/api/v1/audit/:id` | — (her zaman ret) | 405 |
| GET · PUT | `/api/v1/admin/settings/mysql` | Oturum (+ CSRF), yalnız SUPER_ADMIN | 200 |
| POST | `/api/v1/admin/settings/mysql/test` | Oturum + CSRF, yalnız SUPER_ADMIN | 200 |
| GET · PUT · DELETE | `/api/v1/admin/settings/turn` | Oturum (+ CSRF), yalnız SUPER_ADMIN | 200 |
| GET | `/api/v1/settings/consent-text` | Oturum, `settings.view`, firma bağlamı | 200 |
| PUT | `/api/v1/settings/consent-text` | Oturum + CSRF, `settings.edit`, firma bağlamı | 200 |

### GET /api/v1/audit?from=&to=&tenantId=&userId=&action=&result=&cursor=
Yetki `audit.view` (Admin'de varsayılan açık, User'da kapalı). Salt okunur liste; sıralama `created_at desc, id desc`,
sayfa 50 kayıt, **keyset** imleçle (toplam sayı dönmez).

| Parametre | Kural |
|---|---|
| `from`, `to` | `YYYY-MM-DD`, Türkiye günü (`to` dahil). `from` yoksa `to`'dan (yoksa bugünden) geriye 30 gün. `from > to` → 400 `fields.to`; aralık > 731 gün → 400 `fields.from` |
| `userId` | ULID |
| `action` | Tam ad (`auth.login`) veya grup öneki (`auth.*`); küçük harf, rakam, `_`, nokta; ≤ 60 |
| `result` | `success` \| `fail` |
| `tenantId` | Yalnız **firma seçmemiş Super Admin**'de uygulanır; diğerlerinde yok sayılır |
| `cursor` | Önceki yanıtın `nextCursor`'ı (opak). Biçim dışı veya taşan değer → 400 `fields.cursor` |

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
UPDATE'i ve 730 günden yeni kaydın silinmesini reddeder (`docs/db-notlari.md` "P11").

### GET / PUT /api/v1/admin/settings/mysql
Yalnız SUPER_ADMIN (rol; diğer roller 403). Sistem seviyesindeki MySQL bağlantı bilgisi (tek veritabanı, tüm firmalar).
**Kayıt çalışan bağlantıyı değiştirmez** (ADR-0003): uygulamak için sunucudaki `.env` (`DATABASE_URL`) güncellenip servis
yeniden başlatılır (runbook §15).

GET yanıtı (`MysqlSettingsView`); şifre hiçbir zaman dönmez:
```json
{ "host": "mysql", "port": 3306, "database": "remote", "user": "app", "hasPassword": true,
  "updatedAt": "2026-11-13T09:00:00.000Z", "source": "panel", "matchesRunning": true }
```
`source: "env"` → panelde kayıt yok; değerler çalışan `DATABASE_URL`'den türetilir. `matchesRunning: false` → kayıtlı
değerler çalışan bağlantıdan farklı.

PUT gövdesi `{ host, port, database, user, password? }`:
| Alan | Kural |
|---|---|
| `host` | Ad, IPv4 veya köşeli parantezli IPv6 (SMTP host kuralı; iç ağ adresi **serbest**, DB iç ağda olabilir) |
| `port` | 1–65535, varsayılan 3306 |
| `database` | `[A-Za-z0-9_$-]{1,64}` |
| `user` | 1–32, kontrol karakteri yok |
| `password` | ≤ 200. Boş/verilmemiş → kayıtlı şifre korunur. AES-256-GCM ile, hedefe (host + port + kullanıcı) bağlı AAD altında saklanır |

Kayıtlı şifre varken host, port veya kullanıcı değişip `password` boşsa → 400 `fields.password` "Farklı sunucu veya
kullanıcı için şifreyi girin" (kayıtlı şifre yeni hedefe taşınmaz). Yanıt: GET görünümü + `{ "restartRequired": true,
"message": "Ayar kaydedildi. Uygulamak için sunucudaki .env (DATABASE_URL) güncellenip servis yeniden başlatılmalıdır." }`.
Audit `settings.mysql.updated` (eski → yeni; şifre yalnız `"changed"` işareti). Hatalar: 400, 401, 403.

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
| Sınıf | `message` |
|---|---|
| `connect` | Sunucuya bağlanılamadı. |
| `auth` | Kimlik reddedildi (kullanıcı adı veya şifre hatalı). |
| `database` | Veritabanı bulunamadı veya bu kullanıcının erişimi yok. |
| `timeout` | Bağlantı 10 saniye içinde kurulamadı (zaman aşımı). |
| `secret_unreadable` | Kayıtlı şifre okunamadı; şifreyi yeniden girin. |

Ham sürücü hatası yalnız server logunda (`event:"mysql_test_failed"` + `ref`). Her deneme audit `settings.mysql.test`
(hedef + sonuç + sınıf). Hız: kullanıcı başına 5/dk **ve** tüm Super Admin'ler için ortak 20/dk; aşımda 429 + `Retry-After`.
Test bağlantısı TLS kullanmaz (bkz. `docs/gereksinimler-sonra-acik.md` "P11'den"). Hatalar: 400, 401, 403, 429.

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
(`{sessionId, side, class}`), `file.meta.rejected_by_db`. Dosya içeriği hiçbir yere yazılmaz.
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
`customer.anonymized` (sistem), `binding.issued`, `binding.revoked` (`reason`), `binding.denied` (bayat kaynak / pasif);
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
Şifre, token ve çerez değerleri `***` olarak maskelenir. Kayıtlar Audit log ekranında (`/audit`) ve
`GET /api/v1/audit` ile okunur; değiştirilemez.
