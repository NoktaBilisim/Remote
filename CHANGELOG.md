# Changelog

Bu projedeki önemli değişiklikler bu dosyada tutulur.
Biçim [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/), sürümleme [Semantic Versioning](https://semver.org/lang/tr/).

## [Unreleased]

### Eklendi — P2 (destek oturumları)
- **Oturum uçları:** `POST /api/v1/sessions` (link + 8 haneli kod + teknisyen doğrulama kodu; link yalnız bu
  yanıtta), `GET /api/v1/sessions` (sayfalı, `status`/`technicianId` filtresi, en çok 100),
  `GET /api/v1/sessions/:id`, `POST /api/v1/sessions/:id/cancel` (yalnız PENDING). Ayrıntı `docs/api.md`.
- **Public müşteri uçları:** `POST /api/v1/public/sessions/resolve` (token veya kod; oturumu tüketmez) ve
  `GET /api/v1/public/sessions/status?ref=` (opak `sessionRef` ile durum yoklaması).
- **Sınırlar:** teknisyen başına açık oturum sınırı (tenant ayarı `max_open_sessions`, varsayılan 3) ve saatte 20
  oturum; ikisi DB'de tek işlemde sayılır (eşzamanlı isteklerde aşılamaz).
- **Süre dolumu işi:** 30 sn'de bir süresi dolan PENDING oturumları EXPIRED yapar; resolve ve durum yoklaması da
  aynı istekte günceller. Geçerlilik tenant ayarı `session_ttl_min` (15–30, varsayılan 15 dk).
- **Audit:** `session.created`, `session.cancelled`, `session.expired`, `session.resolve` (başarısız, 410 nedeni).
- **Veritabanı:** `support_sessions` tablosu (migration `20261111010000_p2_support_sessions`); aktif kod tekilliği
  indeksi, kod çakışmasında en çok 5 yeniden deneme.
- **Contracts:** `@remote/contracts/api/sessions` (zod şemaları ve yanıt tipleri); yeni hata kodları `CONFLICT`,
  `OPEN_SESSION_LIMIT` (409), `SESSION_EXPIRED`, `SESSION_CONSUMED`, `SESSION_CANCELLED` (410).
- **Web — Oturumlar ekranı (`/sessions`):** liste (durum rozeti, kod, kalan süre, Tümü/Açık/Bitmiş filtresi,
  10 sn'de bir yenileme), "Yeni destek oturumu" diyaloğu (link, kod, doğrulama kodu, kopyalama, geri sayım),
  onaylı iptal; yöneticide Teknisyen sütunu; boş/yükleniyor/hata/kısmi/yetkisiz durumları. Kenar çubuğunda
  "Oturumlar" menüsü (yalnız `sessions.view`).
- **Web — müşteri karşılama (`/session/<token>`):** teknisyen kartı + doğrulama kodu, dolandırıcılık uyarısı,
  2 sn'de bir durum yoklaması; süresi doldu / iptal edildi / kullanıldı / çok fazla deneme / geçersiz (HTTP 404)
  ekranları; `noindex`, `no-referrer`.
- **Yeni ortam değişkenleri:** `SESSION_REF_KEY`, `EDGE_PROXY_SECRET` (`.env.example`, compose, runbook §3).
- **Testler:** birim 51 (server 26, web 23, contracts 2), server entegrasyon 62, web e2e 97 geçti + 1 atlandı.

### Değişti — P2
- Compose: web sabit adres `172.30.0.3`, server `TRUSTED_PROXY_CIDR=172.30.0.2/31` (Caddy → web → server zinciri);
  `SESSION_REF_KEY` (server) ve `EDGE_PROXY_SECRET` (caddy, web) zorunlu.
- Web 401 → giriş yönlendirmesi tek yardımcıda (`lib/api.ts` `isUnauthenticated`, `EXPIRED_LOGIN_PATH`).
- `/session/<biçimsiz>` artık panel 404'ü yerine müşteri "Bağlantı geçersiz" ekranını (HTTP 404) gösterir.
- Bellek içi hız sayacı (K11/S3-1): kapasite dolunca kilidi bitmiş en eski kaydı atar; hepsi kilitliyse
  yeni kayıt eklemez ve isteği engeller (fail-closed). P1'deki "etkin kilit atılabilir" sınırlaması kapandı.

### Güvenlik — P2
- Link token'ı 32 bayt rastgele, DB'de yalnız SHA-256; token ve kod log/audit'e yazılmaz (testle doğrulandı).
- Public kod denemesi IP başına 10/dk ve /24 (IPv6 /56) önek başına 30/dk; aşan anahtar 15 dk 429. Token 30/dk/IP,
  durum yoklaması 60/dk/IP. Başarısız kod toplamı 60 sn'de 100'ü aşınca `warn` alarmı (engellemez).
- Aynı oturum + neden için 410 audit kaydı 10 dakikada bire indirildi (audit şişirmeye karşı).
- Müşteri IP'si: Caddy web'e `X-Edge-Auth` sırrı yazar; web sırrı sabit zamanlı karşılaştırır ve yalnız eşleşince
  doğrulanmış `X-Forwarded-For`'u iletir. İstemcinin gönderdiği `X-Edge-Auth` ezilir ve Caddy logundan silinir.
- Web production'da `EDGE_PROXY_SECRET` yoksa veya 32 karakterden kısaysa açılışta durur (exit 1).
- XFF gelmeden proxy adresinden resolve gelirse dakikada bir `warn` alarmı (`client_ip_is_proxy`).
- `SESSION_REF_KEY` production'da zorunlu (`env.ts`); müşteriye iletilen User-Agent 512 karaktere kırpılır.
- `lib/server-api.ts` `server-only`; başka tenant'ın / başka teknisyenin oturumu 404 (tenant ayrımı testi "list"
  sınıfıyla genişletildi).

### Bilinen sınırlamalar — P2
- Tenant logosu ve teknisyen avatarı `null` (P9/P12); TTL ve açık oturum sınırı ayar ekranı P9/P10.
- Super Admin tenant seçmeden destek oturumu açamaz (P9). Seed teknisyen oluşturmaz; staging'de teknisyen
  hesabı P9'a kadar SQL ile eklenir.
- Açık kalan güvenlik maddeleri ve P3 giriş şartları: `docs/gereksinimler.md` §9 "Sonra / açık".

## P1 (ince iskelet, sürüm etiketi yok)

### Eklendi — P1 (ince iskelet)
- **Monorepo:** pnpm 9 workspace; `apps/server`, `apps/web`, `packages/contracts`.
- **Contracts:** tek yetki tanımı (`permissions.ts`, rol varsayılanları: Super Admin tümü, Admin varsayılan
  açık, User varsayılan kapalı), hata kodu → HTTP eşlemesi ve hata zarfı (`errors.ts`), auth girdi şemaları
  ve çerez/başlık adları (`api/auth.ts`).
- **Server (Fastify 5):** zod ile doğrulanan ortam değişkenleri, JSON log (pino, `X-Request-Id`), standart
  hata zarfı, `/health` ve `/ready` (DB + son migration).
- **Auth uçları:** `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`,
  `POST /api/v1/auth/password/change` (ayrıntı `docs/api.md`).
- **Oturum:** opak DB oturumu (mutlak 8 sa, boşta 30 dk); ilk girişte zorunlu şifre değişimi kapısı.
- **Yetki/tenant altyapısı:** `requireAuth`, `requirePerm`, `tenantScope` guard'ları; tüm uçları
  `public|self|tenant` olarak sınıflandırmayı zorunlu kılan tenant ayrımı test aracı.
- **Audit log yazımı:** giriş/çıkış/kilit/şifre değişimi ve seed kayıtları; izinli/kara liste maskeleme.
- **Veritabanı (MySQL 8.4, Prisma 7):** `tenants`, `tenant_settings`, `users`, `user_permissions`,
  `auth_sessions`, `audit_logs` tabloları; CHECK kısıtları; elle geri alma (`down.sql`).
- **DB kullanıcıları:** `migrator` (yalnız `migrate` servisi) ve `app` (tablo bazlı yetki; `audit_logs`
  yalnız SELECT/INSERT); yetki kontrol betiği `deploy/mysql/check-app-grants.sh`.
- **Seed:** ilk Super Admin (`SEED_SUPERADMIN_*`, idempotent); production dışı ortamda `demo` tenant.
- **Web (Next.js 16):** login sayfası (sistem logosu), şifre değiştirme, boş panel kabuğu (üst menü, kenar
  çubuğu, çıkış), 404/500 sayfaları, yükleniyor iskeleti, Nokta favicon seti; sistem temasına uyan açık/koyu
  görünüm; WCAG 2.1 AA (axe) kontrollü.
- **Deploy:** Docker Compose yığını (caddy, web, server, migrate, seed, mysql); Caddy tek TLS girişi
  (4450/tcp, `tls internal`); staging hedefi 185.126.217.99:4450.
- **CI:** lint, typecheck, birim + entegrasyon testi (MySQL servisi), Playwright e2e, Docker build,
  `pnpm audit`, lisans denetimi, gitleaks; Dependabot.
- **Belgeler:** `README.md`, `docs/api.md`, `docs/runbook.md`, `docs/db-notlari.md`, bu dosya, `LICENSE`.

### Güvenlik
- Şifreler argon2id (m=19456, t=2, p=1); oturum token'ı DB'de yalnız SHA-256.
- Çerezler `__Host-rs_session` (HttpOnly) ve `__Host-rs_csrf`; ikisi Secure, SameSite=Strict, Path=/, Domain yok.
- CSRF: durum değiştiren isteklerde `Origin` allowlist zorunlu (login dahil) + `X-CSRF-Token` double-submit.
- Giriş kilidi: hesap+IP 5 hata → 15 dk; hesap geneli 1 saatte 20 hata → 15 dk (atomik DB sayacı);
  IP başına 20 deneme/dk (429). Var olmayan hesapta aynı davranış; yanıtlar hesap varlığını sızdırmaz.
- Bellek içi sayaçlar kayıt sayısıyla sınırlı (50.000) ve arka planda temizlenir.
- Şifre değişiminde mevcut dahil tüm oturumlar iptal edilir, yeni oturum çerezi verilir; oturum başına
  5 hatalı mevcut şifre oturumu sonlandırır.
- Başarılı girişte aynı tarayıcının eski oturumu iptal edilir.
- Login sonrası yönlendirmede (`?next=`) açık yönlendirme engellenir; `next`'e sorgu dizesi ve
  `/session/` yolları yazılmaz.
- CSP (nonce'lu, uygulama üretir), HSTS, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`;
  `Server`/`X-Powered-By` başlıkları kaldırıldı.
- Caddy logu sorgu dizesi, çerez, `Authorization`, CSRF başlığı, `Referer`, `Location`, `Set-Cookie` ve
  WebSocket subprotocol yazmaz; `/session/<token>` maskelenir. Uygulama logları da gizli değer içermez.
- X-Forwarded-For yalnız Caddy'nin sabit adresinden kabul edilir.
- Konteynerler salt okunur, `cap_drop: ALL`, `no-new-privileges`, uid 1000; MySQL portu yayımlanmaz, DB ağı internetsiz.
- İmajlar `etiket@sha256` ile, GitHub Action'lar commit SHA ile sabitlendi; `permissions: contents: read`.
- `minimatch` GHSA-g3hv-75wg-m249 için `pnpm.overrides` (^11.0.1).

### Bilinen sınırlamalar
- Hesap kilidi bildirim e-postası, 2FA ve tüm cihazlardan çıkış P10'da.
- Kullanıcı tema tercihi P12'de; P1 yalnız işletim sistemi temasına uyar.
- Yönetim ekranları (kullanıcı, yetki, tenant, ayarlar, audit log) P9–P11'de.
- Bellek sayaç sınırı dolduğunda etkin bir kilit kaydı atılabilir (S3-1) — P2'de kapandı (bkz. Değişti — P2).
