# API Dokümanı — Remote Support (P1 + P2)

Bu belge P1 ve P2'de **kodda var olan** uçları anlatır. Sonraki paketlerin bağlayıcı sözleşmesi
`docs/mimari-api.md`'dedir. Kaynak: `apps/server/src/auth/routes.ts`, `auth/guards.ts`, `lib/errors.ts`,
`ops/health.ts`, `sessions/{routes,service,public}.ts`, `packages/contracts/src/{errors.ts,api/auth.ts,api/sessions.ts}`.

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
  (boşsa `PUBLIC_BASE_URL` origin'i). Yoksa veya listede değilse → 403 `CSRF_INVALID`. Login ve public
  `POST /public/sessions/resolve` dahil.
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
| `VALIDATION` | 400 | Şema hatası (`fields` ile), bozuk/büyük gövde, yanlış mevcut şifre (`fields.current`) |
| `UNAUTHENTICATED` | 401 | Oturum yok/düşmüş; hatalı kimlik bilgisi (genel mesaj) |
| `FORBIDDEN` | 403 | Yetki anahtarı yok |
| `CSRF_INVALID` | 403 | Origin eksik/izinsiz veya `X-CSRF-Token` eşleşmiyor |
| `PASSWORD_CHANGE_REQUIRED` | 403 | İlk giriş şifre değişimi yapılmadan başka uç çağrıldı |
| `NOT_FOUND` | 404 | Yol veya kayıt yok (başka tenant'ın / başka teknisyenin kaydı da 404) |
| `CONFLICT` | 409 | Kayıt işleme uygun durumda değil (ör. PENDING olmayan oturumu iptal) |
| `OPEN_SESSION_LIMIT` | 409 | Teknisyenin açık oturum sınırı dolu |
| `SESSION_EXPIRED` | 410 | Oturum linkinin/kodunun süresi dolmuş |
| `SESSION_CONSUMED` | 410 | Link/kod kullanılmış (müşteri kabul edilmiş) |
| `SESSION_CANCELLED` | 410 | Oturum iptal edilmiş |
| `ACCOUNT_LOCKED` | 423 | Giriş kilidi; `Retry-After` (saniye) başlığı ile |
| `RATE_LIMITED` | 429 | Hız sınırı aşıldı (giriş, oturum oluşturma, public uçlar); `Retry-After` ile |
| `INTERNAL` | 500 | Beklenmeyen hata |
| `NOT_READY` | 503 | `/ready`: DB'ye ulaşılamıyor veya migration yok |

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
| POST | `/api/v1/public/sessions/resolve` | Public (Origin) | 200 |
| GET | `/api/v1/public/sessions/status` | Public | 200 |
| GET | `/health`, `/ready` | Yalnız iç ağ | 200 |

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

## Public müşteri uçları (P2 kısmı)
Çerez ve kimlik istemez. Müşteri sayfası (`/session/<token>`) resolve'u **sunucu tarafında** (web konteyneri)
yapar; müşterinin IP'si server'a yalnız Caddy → web paylaşılan sırrı (`EDGE_PROXY_SECRET`) doğrulanınca iletilir.

### POST /api/v1/public/sessions/resolve
Girdi (biri): `{ "token": "<43-karakter-token>", "clientKind": "BROWSER" }` veya
`{ "code": "<8-hane>", "clientKind": "BROWSER" }`. `clientKind`: `BROWSER` | `AGENT`. `Origin` zorunlu,
`X-CSRF-Token` gerekmez. Resolve oturumu **tüketmez**.
```bash
curl -sk -X POST https://localhost:4450/api/v1/public/sessions/resolve \
  -H 'Content-Type: application/json' -H 'Origin: https://localhost:4450' \
  -d '{"code":"<8-hane>","clientKind":"BROWSER"}'
```
Yanıt 200 (`Cache-Control: no-store`):
```json
{ "sessionRef": "<69-karakter-opak-ref>", "tenant": { "name": "Demo Firma", "logoUrl": null },
  "technician": { "name": "Ayşe Teknisyen", "avatarUrl": null }, "techVerifyCode": "<doğrulama-kodu>",
  "expiresAt": "2026-11-11T10:15:00.000Z" }
```
- `sessionRef`: HMAC (`SESSION_REF_KEY`) + oturum id; tahmin edilemez, token değildir, yalnız durum yoklamasında
  kullanılır. `logoUrl`/`avatarUrl` P9/P12'ye kadar `null`. KVKK metni ve `joinNonce` P3'te eklenir.
- `techVerifyCode` müşterinin teknisyeni teyit etmesi içindir; müşteriyi doğrulamaz.

Hatalar: 400 `VALIDATION`; 403 `CSRF_INVALID` (Origin yok/izinsiz); 404 `NOT_FOUND` (link/kod yok);
410 `SESSION_EXPIRED` / `SESSION_CONSUMED` / `SESSION_CANCELLED`; 429 `RATE_LIMITED` (`Retry-After`).

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

### GET /health ve GET /ready
`/api` dışındadır; Caddy dışarıya **404** döner. Konteyner içinden veya Docker healthcheck ile çağrılır.
- `/health` → 200 `{ "status": "ok" }` (süreç canlı).
- `/ready` → 200 `{ "status": "ready", "migration": "20261111010000_p2_support_sessions" }`; DB yoksa veya migration
  uygulanmamışsa 503 `NOT_READY`.
```bash
cd deploy && docker compose exec server node -e "fetch('http://127.0.0.1:3001/ready').then(async r=>console.log(r.status, await r.text()))"
```

## Audit
Giriş (başarılı/başarısız), kilit (`auth.locked`, kapsam `account_ip` veya `account`), çıkış ve şifre değişimi
`audit_logs` tablosuna yazılır. P2: `session.created`, `session.cancelled`, `session.expired` (SYSTEM) ve
`session.resolve` başarısız (410 nedeni); oturum token'ı ve kodu audit'e yazılmaz. Şifre, token ve çerez değerleri `***` olarak maskelenir. Audit ekranı P11'de gelir.
