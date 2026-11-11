# API Dokümanı — Remote Support (P1–P6)

Bu belge P1–P6'da **kodda var olan** uçları anlatır. Sonraki paketlerin bağlayıcı sözleşmesi
`docs/mimari-api.md`'dedir. Kaynak: `apps/server/src/auth/routes.ts`, `auth/guards.ts`, `lib/errors.ts`,
`ops/{health,metrics}.ts`, `sessions/{routes,service,public}.ts`, `public/{service,consent,routes,agent,agent-binary}.ts`,
`signaling/*.ts`, `deploy/Caddyfile`,
`packages/contracts/src/{errors.ts,ws.ts,api/auth.ts,api/sessions.ts}`.

## Genel kurallar
- Taban yol: `/api/v1`. İstek ve yanıt JSON, UTF-8. Dış adres Caddy üzerinden `https://<SITE_HOST>:4450`.
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
| `FORBIDDEN` | 403 | Yetki anahtarı yok; join'de teknisyenin reddettiği IP |
| `CSRF_INVALID` | 403 | Origin eksik/izinsiz veya `X-CSRF-Token` eşleşmiyor |
| `PASSWORD_CHANGE_REQUIRED` | 403 | İlk giriş şifre değişimi yapılmadan başka uç çağrıldı |
| `NOT_FOUND` | 404 | Yol veya kayıt yok (başka tenant'ın / başka teknisyenin kaydı da 404) |
| `CONFLICT` | 409 | Kayıt işleme uygun durumda değil (ör. PENDING olmayan oturumu iptal, ACTIVE olmayanı sonlandırma) |
| `LOBBY_FULL` | 409 | Bekleme odasında 3 misafir var (join) |
| `OPEN_SESSION_LIMIT` | 409 | Teknisyenin açık oturum sınırı dolu |
| `SESSION_EXPIRED` | 410 | Oturum linkinin/kodunun süresi dolmuş |
| `SESSION_CONSUMED` | 410 | Link/kod kullanılmış (müşteri kabul edilmiş) |
| `SESSION_CANCELLED` | 410 | Oturum iptal edilmiş |
| `NONCE_INVALID` | 410 | `joinNonce` süresi dolmuş (60 sn), kullanılmış veya bilinmiyor |
| `ACCOUNT_LOCKED` | 423 | Giriş kilidi; `Retry-After` (saniye) başlığı ile |
| `RATE_LIMITED` | 429 | Hız sınırı aşıldı (giriş, oturum oluşturma, public uçlar); `Retry-After` ile |
| `INTERNAL` | 500 | Beklenmeyen hata |
| `NOT_READY` | 503 | `/ready`: DB'ye ulaşılamıyor veya migration yok; P6: Windows istemci ikilisi yok, yapılandırılmamış veya SHA-256'sı `AGENT_SHA256` ile uyuşmuyor |

## Uçlar
| Metot | Yol | Yetki | Başarı |
|---|---|---|---|
| POST | `/api/v1/auth/login` | Public (Origin) | 200 + iki çerez |
| POST | `/api/v1/auth/logout` | Oturum + CSRF | 204, çerezler silinir |
| GET | `/api/v1/auth/me` | Oturum | 200 |
| POST | `/api/v1/auth/password/change` | Oturum + CSRF | 204 + yeni çerezler |
| POST | `/api/v1/sessions` | Oturum + CSRF, `sessions.create` | 201 |
| GET | `/api/v1/sessions` | Oturum, `sessions.view` | 200 |
| GET | `/api/v1/sessions/:id` | Oturum, `sessions.view` | 200 |
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
Yanıtta `Set-Cookie: __Host-rs_session=…` ve `Set-Cookie: __Host-rs_csrf=…` gelir. `mfaRequired` P1'de daima
`false` (2FA P10). Aynı tarayıcının eski oturum çerezi varsa o oturum sunucuda iptal edilir.

Hatalar: 400 `VALIDATION`; 401 `UNAUTHENTICATED` ("E-posta/kullanıcı adı veya şifre hatalı." — hesap var/yok,
pasif kullanıcı veya pasif tenant için aynı mesaj); 403 `CSRF_INVALID`; 423 `ACCOUNT_LOCKED`; 429 `RATE_LIMITED`.

Kilit kuralları:
- Aynı hesap + IP: 15 dakikada 5. hatalı denemenin kendisi 423 döner; 15 dk kilit. Başka IP etkilenmez.
- Hesap geneli: IP'den bağımsız 1 saatte 20 hata → 15 dk kilit. Var olmayan hesapta da aynı davranış (varlık sızmaz).
- Kilitliyken doğru şifre de 423 alır. `Retry-After` kalan süreyi saniye olarak verir.
- IP başına dakikada 20 deneme; 21. deneme 429.

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
(`packages/contracts/src/permissions.ts`). Hata: 401.

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

## Destek oturumları (P2)
Teknisyen uçları oturum çerezi ister; `mustChangePassword` kapısı geçerlidir. Kapsam: USER yalnız kendi açtığı
oturumları görür ve iptal eder (`technicianId` filtresi bunu ezemez); ADMIN kendi tenant'ının tümünü görür.
Başka tenant'ın veya başka teknisyenin oturumu, biçimsiz `:id` dahil → 404. Super Admin tenant seçmeden bu uçları
çağıramaz → 403 `FORBIDDEN` (tenant geçişi P9). Tipler: `@remote/contracts/api/sessions`.

Oturum durumları: `PENDING` (müşteri bekleniyor) · `ACTIVE` · `ENDED` · `EXPIRED` · `CANCELLED`.
`endedBy`: `TECH` | `CUSTOMER` | `ADMIN` | `SYSTEM`.

### POST /api/v1/sessions
Girdi: boş nesne `{}`. Gerekli: oturum, `X-CSRF-Token`, `Origin`.
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
Sorgu: `status` (isteğe bağlı, durumlardan biri), `technicianId` (ULID; USER'da yok sayılır), `page` (1–10000,
varsayılan 1), `pageSize` (1–100, varsayılan 25). Sıra: `createdAt` azalan.
```bash
curl -sk 'https://localhost:4450/api/v1/sessions?status=PENDING&pageSize=25' \
  -b "__Host-rs_session=$SESSION; __Host-rs_csrf=$CSRF"
```
```json
{ "items": [ { "id": "01K…", "status": "PENDING", "code": "<8-hane>", "techVerifyCode": "<doğrulama-kodu>",
               "technician": { "id": "01K…", "name": "Ayşe Teknisyen" },
               "createdAt": "2026-11-11T10:00:00.000Z", "expiresAt": "2026-11-11T10:15:00.000Z",
               "endedAt": null, "endedBy": null, "endReason": null } ],
  "page": 1, "pageSize": 25, "total": 1 }
```
`code` yalnız PENDING iken doludur, diğer durumlarda `null`. `link` hiçbir listede/detayda dönmez.
Hatalar: 400 `VALIDATION` (`fields` ile), 401, 403.

### GET /api/v1/sessions/:id
Yanıt: listedeki öğe biçiminde tek oturum. Hatalar: 401, 403, 404 (yok, başka tenant, başka teknisyen, biçimsiz id).

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
`declined`, `sender`); göstergeler `rs_ws_connections`, `rs_active_sessions`, `rs_active_rooms`,
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
| `error` | S→taraf | `code: ADMIT_CODE_INVALID\|CONFLICT\|FORBIDDEN\|RATE_LIMITED\|NOT_FOUND\|VALIDATION` (P5), `message` (≤ 300) |

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
| `input` | — | Yalnız Windows istemcisi (P7); tarayıcı misafiri bu kanalı kapatır |

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
Şifre, token ve çerez değerleri `***` olarak maskelenir. Audit ekranı P11'de gelir.
