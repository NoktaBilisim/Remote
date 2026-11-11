# Remote Support — Nokta Bilişim uzaktan destek platformu

Self-hosted, çok kiracılı (multi-tenant) uzaktan destek platformu. Teknisyen web konsolundan bir destek
oturumu açar; müşteri taşınabilir Windows istemcisi (tam erişim) veya tarayıcı (yalnız görüntü) ile katılır.
Görüntü eşler arası WebRTC ile akar; sunucu yalnız sinyalizasyon ve meta veri tutar.

## Şu anki durum: P4 (KVKK onayı + tarayıcıdan ekran paylaşımı)
İş P1..P13 dikey paketlerle yürür (`docs/mimari.md` §10). P1–P4 tamamlandı (qa GEÇTİ, güvenlik Kritik/Yüksek 0).

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
- Süresi dolan oturumlar 30 sn'de bir otomatik EXPIRED yapılır; oluşturma/iptal/süre dolması audit'e yazılır
  (link token'ı ve kod loga/audit'e yazılmaz).

**P3 — sinyalizasyon + TURN** (sunucu tarafı)
- Müşteri katılımı: resolve yanıtındaki tek kullanımlık `joinNonce` ile `join` → müşteri bekleme odasına (lobi) girer
  ve 4 haneli bir kabul kodu görür. Teknisyen kodu girince oturum ACTIVE olur (tek atomik UPDATE; iptal ve süre
  dolumuyla yarışta tek kazanan). Lobi en çok 3 misafir, 5 dk; teknisyen bir misafiri reddedebilir.
- WebSocket sinyalizasyonu `/ws/tech` (çerez + Origin) ve `/ws/guest` (subprotocol `rs.v1` + tek kullanımlık ticket;
  token URL'de taşınmaz). Mesajlar `packages/contracts/src/ws.ts` şemalarıyla doğrulanır; SDP/ICE yalnız aynı odaya gider.
- Yeniden bağlanma (120 sn, yenilenen `reconnectToken`), en uzun oturum süresi + 5 dk kala uyarı, TURN
  bilgilerinin bitmeden yenilenmesi, ping/pong, teknisyen oturumunun 60 sn'de bir yeniden doğrulanması.
- Yönetici zorla sonlandırma: `POST /api/v1/sessions/:id/terminate` (`sessions.terminate`).
- TURN: ayrı compose projesi `deploy/turn` (coturn 4.18, HMAC süreli credential, iç/özel adreslere relay yasağı,
  host güvenlik duvarı betiği). İç metrik ucu `/metrics` (`METRICS_TOKEN` ile).

**P4 — KVKK onayı + tarayıcıdan ekran paylaşımı**
- Müşteri karşılama sayfası tam akış: teknisyen kartı ve doğrulama kodu, dolandırıcılık uyarısı ve
  "Kötüye kullanımı bildir" bağlantısı (`ABUSE_EMAIL`), ad + KVKK aydınlatma metni onayı → bekleme odası (4 haneli
  kabul kodu, kalan süre, "Vazgeç ve çık") → ekranı paylaş / durdur / yeniden paylaş, önizleme, onaylı bitirme →
  bitiş, ret, bekleme doldu ve bağlantı kesildi ekranları. Paylaşım izni reddedilirse "Tekrar dene" çıkar.
- Mobil veya ekran paylaşımı desteklemeyen tarayıcıda form yerine "Bu cihaz desteklenmiyor" ekranı gösterilir.
- Teknisyen konsolu `/sessions/<id>/console` (koyu tema): müşteri adı, durum, kalan süre, doğrulama kodu, lobi
  paneli (kabul kodu girişi, kalan hak, misafiri reddet), canlı ekran görüntüsü (Sığdır / %100 / Tam ekran),
  paylaşım durdu ve müşteri koptu (120 sn) durumları, onaylı bitir/iptal. "Uzaktan kontrol" düğmesi tarayıcı
  modunda pasiftir (P7). Konsol yenilense de müşteri adı ve paylaşım durumu sunucudan geri gelir.
- Oturumlar listesinde "Konsolu aç" ve yöneticiye "Zorla sonlandır" (`sessions.terminate`, onay diyaloğu).
- KVKK metni tenant bazında, sürümlü ve değişmez (`consent_texts`); seed her tenant'a Türkçe v1 ekler. Müşterinin
  onayı, kabul anında gösterilen sürümün kimliği ve SHA-256 özetiyle `session_consents` tablosuna yazılır.
- Görüntü tek yönlüdür: teknisyen yalnız alır, müşteri yalnız ekran gönderir; ses, kamera ve mikrofon kullanılmaz.

API ayrıntısı: [`docs/api.md`](docs/api.md). Sürüm geçmişi: [`CHANGELOG.md`](CHANGELOG.md).

**Staging'de teknisyen hesabı:** Seed yalnız Super Admin oluşturur. Super Admin tenant seçmeden destek oturumu
açamaz (403; tenant geçişi P9). Kullanıcı yönetimi ekranı P9'da gelene kadar ADMIN/USER hesabı
`deploy/staging-users.sh` ile eklenir (`docs/runbook.md` §6).

## Yol haritası
| Paket | Kapsam |
|---|---|
| P2 ✓ | Destek oturumu oluşturma (8 haneli kod), liste, iptal, karşılama sayfası iskeleti |
| P3 ✓ | Sinyalizasyon sunucusu (WebSocket), lobi + teknisyen kabulü, TURN (coturn), `/metrics` |
| P4 ✓ | Tarayıcı modu ekran paylaşımı, KVKK onayı, teknisyen konsolu video |
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
| Sinyalizasyon / TURN | `ws` 8.21 (Fastify sunucusunda), coturn 4.18 (ayrı compose) |
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
| `TURN_URLS` | Evet | Virgüllü `stun:`/`turn:`/`turns:` adres listesi (staging değeri `.env.example`'da) |
| `TURN_SECRET` | Evet | TURN credential HMAC sırrı, ≥ 32 karakter (`openssl rand -hex 32`); coturn ile **aynı** değer |
| `TURN_CRED_TTL_MIN` | Hayır | TURN credential ömrü, dk (5–60, varsayılan 20) |
| `METRICS_TOKEN` | Hayır | `/metrics` Bearer token'ı, ≥ 16 karakter; boşsa `/metrics` 404 |
| `ABUSE_EMAIL` | Önerilir | Müşteri ekranındaki "Kötüye kullanımı bildir" adresi (ör. `abuse@<alan-adı>`). Production'da boşsa bağlantı gizlenir; Super Admin e-postası kullanılmaz. Boş bırakmak güvenlidir; dolu ama geçersiz adres server'ı açtırmaz |
| `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `TRUSTED_PROXY_CIDR`, `API_INTERNAL_URL` | Compose dışı | Compose bunları kendisi üretir; yalnız yerel `pnpm` çalıştırmada gerekir |

TURN sunucusu (`deploy/turn`, ayrı compose projesi) şu değişkenleri okur:
| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `TURN_SECRET` | Evet | Server ile aynı sır |
| `TURN_SECRET_PREVIOUS` | Hayır | Kesintisiz sır değişimi sırasında eski sır (runbook §9.6) |
| `TURN_REALM` | Evet | coturn realm (staging: sunucu IP'si) |
| `TURN_EXTERNAL_IP` | Evet | `<public IP>/<iç IP>` (NAT arkasında) veya yalnız public IP |
| `TURN_MAX_BPS`, `TURN_BPS_CAPACITY` | Hayır | Bayt/sn: allocation başına tavan (vars. 8000000), sunucu toplam relay kapasitesi (vars. 0 = sınırsız) |
| `TURN_PROMETHEUS_ADDRESS` | Hayır | coturn metrik dinleme adresi (varsayılan `127.0.0.1`) |
| `TURN_LISTEN_IPS` | Önerilir | 3478/5349 dinleme adresleri. Staging/prod: `auto` (özel relay IPv4 + `127.0.0.1`); virgüllü IPv4 listesi de olur. Boşsa tüm arayüzlerde dinler ve uyarı yazar |

Boş bırakılan değerler (`ANAHTAR=`) tanımsız sayılır; varsayılanı olan alan varsayılana düşer, zorunlu alan yine hata verir.
Ayrıntı ve üretim yöntemi: `docs/runbook.md` §3 (uygulama) ve §9 (TURN).

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
TURN (coturn) testleri Docker ile yerelde koşar: `cd deploy/turn && ./test-local.sh` (runbook §9.7).

### Gerçek sunucu e2e (P4)
Varsayılan e2e sahte API/WS'ye karşı koşar. `e2e/p4-real.spec.ts` ise gerçek server + MySQL ile uçtan uca akışı
(KVKK → lobi → kabul → ekran paylaşımı → bitiş, ret, zorla sonlandırma, konsol yenileme) dener. CI'da koşmaz.
```bash
# 1) Geçici test DB'si + seed (Super Admin, demo tenant, KVKK v1)
eval "$(apps/server/scripts/test-db.sh up)"
export DATABASE_URL="$TEST_DATABASE_URL"
SEED_SUPERADMIN_EMAIL=<e-posta> SEED_SUPERADMIN_PASSWORD=<en-az-12-karakter> pnpm db:seed

# 2) demo tenant'ta iki ADMIN teknisyen (yalnız test/staging DB'si; parolaları sıfırlar)
export E2E_REAL_LOGIN=<admin1-e-posta> E2E_REAL_LOGIN2=<admin2-e-posta> E2E_REAL_PASSWORD=<en-az-12-karakter>
pnpm --filter @remote/web e2e:real:users

# 3) Server (ayrı terminalde, aynı DATABASE_URL ile; TURN olmadan yerel P2P)
cd apps/server && PUBLIC_BASE_URL=http://localhost:3218 PORT=3302 node src/server.ts

# 4) Testler (web standalone derlemesini kendisi başlatır, :3218)
pnpm --filter @remote/web e2e:real
apps/server/scripts/test-db.sh down
```
`e2e:real:users` betiği (`apps/server/scripts/e2e-real-users.ts`) `NODE_ENV=production` iken veya `E2E_REAL_ALLOW=1`
olmadan çalışmaz; `e2e:real:users` komutu bu bayrağı kendisi verir. Betiği doğrudan çalıştırırsanız bayrağı açıkça
vermeniz gerekir. `DATABASE_URL` asla canlı veritabanını göstermemelidir. Teknisyen başına saatte 20 oturum sınırı
nedeniyle aynı saatte yaklaşık 4 tam koşudan sonra 409 alınır; yeni DB ile veya bir saat sonra tekrarlayın.

P4 son sonuç: birim 146 (server 78, web 44, contracts 24), server entegrasyon 103, TURN 62 kontrol, web e2e 116
geçti + 8 atlandı (masaüstüne özel akışların mobil kopyaları), gerçek sunucu e2e 5/5.

## Deploy
- Tek sunucu, Docker Compose. Dışarıya yalnız Caddy **4450/tcp** açılır; MySQL portu yayımlanmaz.
- Staging: `185.126.217.99:4450` (`PUBLIC_BASE_URL=https://185.126.217.99:4450`, `SITE_HOST=185.126.217.99`).
- Yeni sürüm: `git pull && IMAGE_TAG=<sürüm> docker compose build && IMAGE_TAG=<sürüm> docker compose up -d`.
- Sağlık: `/health` ve `/ready` yalnız konteyner içinden erişilir (Caddy dışarıya 404 döner).
- TURN: `deploy/turn` ayrı compose projesidir (host ağı); kurulum, güvenlik duvarı ve doğrulama `docs/runbook.md` §9.
  Staging'de TURN'ün dışarıdan çalışması için üst NAT'ta (pfSense) 3478/udp+tcp, 5349/tcp ve 49160–49199/udp
  yönlendirmesi gerekir (runbook §9.3, ağ yöneticisi talebi).
- Migration her `up -d`'de `migrate` servisiyle otomatik uygulanır. Yedekleme P13'te eklenecek.
- Günlük işlemler, loglar, sorun giderme: [`docs/runbook.md`](docs/runbook.md).

## Klasör yapısı
```
apps/server/        Fastify API (src/), Prisma şeması ve migration'lar (prisma/), testler (test/)
apps/web/           Next.js arayüzü (app/, components/, lib/), e2e testleri (e2e/)
packages/contracts/ Ortak zod şemaları, yetki listesi, hata kodları
deploy/             docker-compose.yml, Caddyfile, mysql/ (kullanıcı init + yetki kontrol betiği),
                    turn/ (coturn compose, başlatıcı, güvenlik duvarı ve test betikleri)
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
- KVKK onayı yalnız oturumun tenant'ının güncel metniyle kabul edilir; eski sürüm veya başka tenant'ın metni 400 alır.
  Müşteri adında kontrol, yön (bidi) ve görünmez biçim karakterleri reddedilir.
- Ekran paylaşımı yalnız müşterinin tıklamasıyla başlar, yeniden bağlanmada kendiliğinden başlamaz. Müşteri sayfası
  başka bir sayfaya çerçevelenemez (`frame-ancestors 'none'`). Çıkışta sekme belleğindeki müşteri adı silinir.
- WS'de token URL'ye girmez (subprotocol); ticket ve nonce tek kullanımlık, 60 sn. TURN bilgisi müşteriye yalnız
  teknisyen kabulünden sonra verilir; credential süreli (HMAC). coturn iç/özel adreslere relay yapmaz.
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
