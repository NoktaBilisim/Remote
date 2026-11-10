# Remote Support — Nokta Bilişim uzaktan destek platformu

Self-hosted, çok kiracılı (multi-tenant) uzaktan destek platformu. Teknisyen web konsolundan bir destek
oturumu açar; müşteri taşınabilir Windows istemcisi (tam erişim) veya tarayıcı (yalnız görüntü) ile katılır.
Görüntü eşler arası WebRTC ile akar; sunucu yalnız sinyalizasyon ve meta veri tutar.

## Şu anki durum: P2 (destek oturumları)
İş P1..P13 dikey paketlerle yürür (`docs/mimari.md` §10). P1 ve P2 tamamlandı (qa GEÇTİ, güvenlik Kritik/Yüksek 0).

**P1 — ince iskelet**
- E-posta veya kullanıcı adı + şifre ile giriş, çıkış, ilk girişte zorunlu şifre değişimi.
- Hatalı giriş kilidi: aynı hesap+IP 5 hata → 15 dk kilit; hesap geneli 1 saatte 20 hata → 15 dk kilit;
  IP başına dakikada 20 deneme sınırı.
- Opak sunucu oturumu (mutlak 8 sa, boşta 30 dk) ve CSRF koruması (double-submit + Origin kontrolü).
- Tenant yapısı (tek DB, `tenant_id`), rol/yetki altyapısı (`packages/contracts/src/permissions.ts`), audit log
  yazımı (gizli değerler `***` maskeli). Yönetim ekranları henüz yok.
- Web: login sayfası (sistem logosu), şifre değiştirme, panel kabuğu, favicon; sistem temasına uyan açık/koyu görünüm.
- Docker Compose yığını (Caddy, web, server, MySQL), CI (lint, tip, test, e2e, build, tedarik zinciri).

**P2 — destek oturumları**
- Teknisyen "Oturumlar" ekranından yeni destek oturumu açar: tek kullanımlık link (yalnız oluşturma anında
  gösterilir), 8 haneli oturum kodu (`4829 1376` biçiminde), teknisyen doğrulama kodu ve geçerlilik süresi
  (tenant ayarı, varsayılan 15 dk).
- Oturum listesi: durum rozetleri, kalan süre, Tümü/Açık/Bitmiş filtresi, 10 sn'de bir yenileme, kodu kopyalama,
  onaylı iptal. USER yalnız kendi oturumlarını, ADMIN tenant'ın tüm oturumlarını (Teknisyen sütunuyla) görür.
- Sınırlar: teknisyen başına açık oturum sınırı (varsayılan 3) ve saatte 20 oturum.
- Müşteri karşılama sayfası `/session/<token>`: firma adı, teknisyen kartı ve doğrulama kodu, dolandırıcılık
  uyarısı; 2 sn'de bir durum yoklaması ile iptal/süre dolması/sona erme ekranları; geçersiz link için 404.
  Bağlantı adımları (form, KVKK onayı, ekran paylaşımı) P3/P4'te gelir.
- Süresi dolan oturumlar 30 sn'de bir otomatik EXPIRED yapılır; oluşturma/iptal/süre dolması audit'e yazılır
  (link token'ı ve kod loga/audit'e yazılmaz).

API ayrıntısı: [`docs/api.md`](docs/api.md). Sürüm geçmişi: [`CHANGELOG.md`](CHANGELOG.md).

**Staging'de teknisyen hesabı:** Seed yalnız Super Admin oluşturur. Super Admin tenant seçmeden destek oturumu
açamaz (403; tenant geçişi P9). Kullanıcı yönetimi ekranı P9'da gelene kadar staging'de oturum açacak ADMIN/USER hesabı
veritabanına SQL ile eklenir; adım adım prosedür P3 öncesi `docs/runbook.md` §6'ya eklenecek (bkz. `docs/gereksinimler.md` §9).

## Yol haritası
| Paket | Kapsam |
|---|---|
| P2 ✓ | Destek oturumu oluşturma (8 haneli kod), liste, iptal, karşılama sayfası iskeleti |
| P3 | Sinyalizasyon sunucusu (WebSocket), lobi + teknisyen kabulü, TURN (coturn), `/metrics` |
| P4 | Tarayıcı modu ekran paylaşımı, KVKK onayı, teknisyen konsolu video |
| P5 | Sohbet, dosya transferi, ekran üzerine işaretleme, kalite paneli |
| P6 | Windows istemci (Go, imzasız; SHA-256 + build attestation) |
| P7 | Uzaktan kontrol (izin diyaloğu, klavye/fare) |
| P8 | Oturum geçmişi, not/ticket, CSV dışa aktarma |
| P9 | Kullanıcı/yetki toggle'ları, tenant yönetimi, Super Admin tenant geçişi |
| P10 | 2FA (TOTP), şifre sıfırlama e-postası, SMTP ayarı + test, tüm cihazlardan çıkış |
| P11 | MySQL/TURN ayarları + test, audit log ekranı, audit tetikleyicileri |
| P12 | Logo/avatar yükleme, kullanıcı tema tercihi |
| P13 | Prod deploy, yedek/geri yükleme, retention, kullanım kılavuzu, datasheet, PDF'ler |

Prod açılışı P10 (2FA) sonrasıdır; o zamana kadar yalnız staging kullanılır.

## Teknoloji yığını
| Katman | Teknoloji |
|---|---|
| Server | Node.js ≥ 22.18 (yerleşik TypeScript type stripping, derleme adımı yok), Fastify 5, Prisma 7, zod, pino, argon2id |
| Web | Next.js 16 (App Router), React 19, Tailwind 4, lucide-react |
| Ortak | `packages/contracts` (zod şemaları, yetki listesi, hata kodları) |
| DB | MySQL 8.4 |
| Giriş | Caddy 2.11 (TLS, ters vekil, log filtresi) |
| Test | Vitest, Playwright + axe |
| Paket yöneticisi | pnpm 9 (corepack), monorepo |

## Gereksinimler
- Node.js **≥ 22.18** (CI ve imajlar 22.23.4 kullanır), pnpm 9 (`corepack enable` ile `packageManager` sürümü gelir).
- Docker Engine 27+ ve Docker Compose v2 (yığın ve entegrasyon testi için).
- MySQL 8.4 (compose içinde gelir; ayrı kurulum gerekmez).

## Kurulum (geliştirme)
```bash
corepack enable
pnpm install --frozen-lockfile
pnpm db:generate              # Prisma istemcisini üretir
```

## Yığını çalıştırma (Docker Compose)
`deploy/.env` dosyasını `.env.example`'dan oluşturun ve değerleri doldurun (dosya git'e girmez):
```bash
cd deploy
cp ../.env.example .env && chmod 600 .env
docker compose build
docker compose up -d                          # mysql -> migrate -> server -> web -> caddy
docker compose --profile setup run --rm seed  # ilk Super Admin (bir kez; tekrar çalıştırmak zararsız)
docker compose ps
```
Tarayıcı: `https://<SITE_HOST>:4450`. Caddy `tls internal` kullanır; kök sertifikanın test makinesine
kurulması `docs/runbook.md` §2'de anlatılır.

**İlk Super Admin:** seed `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD` (12–200 karakter) ve
isteğe bağlı `SEED_SUPERADMIN_NAME` ile hesabı oluşturur. İlk girişte şifre değişimi zorunludur. Var olan
hesabın şifresi ezilmez. `NODE_ENV` production değilse `demo` adlı bir örnek tenant da oluşturulur.

### Ortam değişkenleri (`deploy/.env`)
| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `MYSQL_ROOT_PASSWORD`, `MYSQL_APP_PASSWORD`, `MYSQL_MIGRATOR_PASSWORD` | Evet | `openssl rand -hex 24`; yalnız harf/rakam |
| `MYSQL_DATABASE` | Evet | Veritabanı adı (ör. `remote`) |
| `PUBLIC_BASE_URL` | Evet | Dış adres, port dahil (ör. `https://localhost:4450`) |
| `SITE_HOST` | Hayır | Caddy site adı/sertifika adı (varsayılan `localhost`) |
| `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD`, `SEED_SUPERADMIN_NAME` | Seed için | Boşluklu değer tırnaklanır; seed sonrası silinebilir |
| `NODE_ENV`, `LOG_LEVEL` | Hayır | Varsayılan `production`, `info` |
| `ALLOWED_ORIGINS` | Hayır | CSRF/Origin listesi (virgülle); boşsa `PUBLIC_BASE_URL` |
| `SESSION_REF_KEY` | Evet | Müşteri durum yoklamasındaki `sessionRef`'in HMAC anahtarı, ≥ 32 karakter (`openssl rand -base64 48`). Production'da zorunlu; değişirse açık oturumların yoklaması 404 olur |
| `EDGE_PROXY_SECRET` | Evet | Caddy → web paylaşılan sırrı (`X-Edge-Auth`), ≥ 32 karakter (`openssl rand -base64 32`). Caddy ve web'e aynı değer gider; web production'da sır yoksa açılmaz |
| `CADDY_BIND`, `IMAGE_TAG` | Hayır | 4450'nin dinlendiği arayüz (varsayılan `0.0.0.0`), imaj etiketi (varsayılan `local`) |
| `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `TRUSTED_PROXY_CIDR`, `API_INTERNAL_URL` | Compose dışı | Compose bunları kendisi üretir; yalnız yerel `pnpm` çalıştırmada gerekir |

Ayrıntı ve üretim yöntemi: `docs/runbook.md` §3.

## Test
```bash
pnpm -r run lint
pnpm -r run typecheck
pnpm -r run test                                   # birim testleri (server, web, contracts)

# Server entegrasyon testleri: geçici MySQL 8.4 konteyneri (Docker gerekir)
eval "$(apps/server/scripts/test-db.sh up)"         # konteyner + migrate + grants, TEST_DATABASE_URL verir
pnpm --filter @remote/server test:int
apps/server/scripts/test-db.sh down

# Web e2e (üretim derlemesi + sahte API; ilk kez tarayıcı kurulumu gerekir)
pnpm --filter @remote/web exec playwright install chromium
pnpm --filter @remote/web e2e
```
P2 son sonuç: birim 51 (server 26, web 23, contracts 2), server entegrasyon 62, web e2e 97 geçti + 1 atlandı
(AC-61 sütun testi yalnız masaüstünde koşar).

## Deploy
- Tek sunucu, Docker Compose. Dışarıya yalnız Caddy **4450/tcp** açılır; MySQL portu yayımlanmaz.
- Staging: `185.126.217.99:4450` (`PUBLIC_BASE_URL=https://185.126.217.99:4450`, `SITE_HOST=185.126.217.99`).
- Yeni sürüm: `git pull && IMAGE_TAG=<sürüm> docker compose build && IMAGE_TAG=<sürüm> docker compose up -d`.
- Sağlık: `/health` ve `/ready` yalnız konteyner içinden erişilir (Caddy dışarıya 404 döner).
- Migration her `up -d`'de `migrate` servisiyle otomatik uygulanır. Yedekleme P13'te eklenecek.
- Günlük işlemler, loglar, sorun giderme: [`docs/runbook.md`](docs/runbook.md).

## Klasör yapısı
```
apps/server/        Fastify API (src/), Prisma şeması ve migration'lar (prisma/), testler (test/)
apps/web/           Next.js arayüzü (app/, components/, lib/), e2e testleri (e2e/)
packages/contracts/ Ortak zod şemaları, yetki listesi, hata kodları
deploy/             docker-compose.yml, Caddyfile, mysql/ (kullanıcı init + yetki kontrol betiği)
scripts/            Lisans denetimi
.github/            CI iş akışı, Dependabot
docs/               Gereksinim, mimari, ADR, runbook, DB notları, API, denetim raporları
```

## Güvenlik özeti
- Şifreler argon2id ile hash'lenir; oturum token'ı DB'de yalnız SHA-256 olarak tutulur.
- Çerezler `__Host-` önekli, Secure, SameSite=Strict; oturum çerezi HttpOnly.
- DB'de iki kullanıcı: `migrator` (yalnız migrate servisi) ve `app` (server; `audit_logs` üzerinde yalnız SELECT/INSERT).
- Caddy logu sorgu dizesi, çerez, CSRF başlığı ve oturum token'ı yazmaz; uygulama logları da maskelidir.
- Destek oturumu linkinin token'ı DB'de yalnız özet olarak tutulur; token ve 8 haneli kod loga/audit'e yazılmaz.
  Müşteri uçları IP ve /24 önek bazında hız sınırlıdır; müşteri IP'si yalnız Caddy → web paylaşılan sırrı
  (`EDGE_PROXY_SECRET`) doğrulanınca iletilir.
- Konteynerler salt okunur kök dosya sistemi, `cap_drop: ALL`, root olmayan kullanıcıyla çalışır; imajlar digest ile sabitlenir.
- CI: `pnpm audit`, lisans denetimi (GPL/AGPL yasak), gitleaks. Repoya gizli bilgi girmez.
- Ayrıntı: `docs/guvenlik-raporu.md`, ADR'ler `docs/adr/`.

## Katkı
- Kurallar: [`CLAUDE.md`](CLAUDE.md) (paket kuralları, değişmez kurallar), UI: [`DESIGN.md`](DESIGN.md).
- Yeni ortam değişkeni → `.env.example` (boş) + `apps/server/src/env.ts` + `deploy/docker-compose.yml` + runbook.
- Yeni tablo → `apps/server/prisma/sql/grants.sql`'e yetki satırı.
- PR öncesi lint, typecheck, test ve e2e yeşil olmalı.

## Lisans
Apache License 2.0 — bkz. [`LICENSE`](LICENSE).
