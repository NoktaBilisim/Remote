# Remote Support — Nokta Bilişim uzaktan destek platformu

Self-hosted, çok kiracılı (multi-tenant) uzaktan destek platformu. Teknisyen web konsolundan bir destek
oturumu açar; müşteri taşınabilir Windows istemcisi (tam erişim) veya tarayıcı (yalnız görüntü) ile katılır.
Görüntü eşler arası WebRTC ile akar; sunucu yalnız sinyalizasyon ve meta veri tutar.

## Şu anki durum: P1–P6 tamamlandı
İş P1..P13 dikey paketlerle yürür (`docs/mimari.md` §10). P1–P6 tamamlandı (qa GEÇTİ, güvenlik Kritik/Yüksek 0).
Sıradaki paket P7 (uzaktan kontrol).

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

**P5 — konsol işbirliği** (yeni rota yok; konsol ve müşteri sayfasına eklendi)
- Teknisyen konsolunda yan panel: **Sohbet / Dosyalar / Kalite**. Müşteri sayfasında "Teknisyenle iletişim" bölümü
  (Sohbet; teknisyenin dosya yetkisi varsa Dosyalar).
- **Sohbet:** iki yönlü, mesaj başına en çok 2000 karakter, zaman damgası, okunmamış sayacı. Mesaj düz metin
  basılır; HTML yorumlanmaz.
- **Dosya transferi (iki yön):** dosya eşler arası DataChannel'dan geçer, sunucuya içerik gitmez. Alıcı her teklifi
  onaylar (varsayılan odak "Reddet", "Kabul et" 1,5 sn sonra etkinleşir); tehlikeli ve çift uzantı (`.pdf.exe`)
  uyarısı; dosya adı iki tarafta temizlenir. Boyut sınırı tenant ayarıdır (varsayılan 100 MB). SHA-256 tutmazsa
  dosya atılır, "Dosya bozuk" gösterilir. İki taraf da aktarımı iptal edebilir; yanıtsız teklif 30 sn sonra
  "Yanıt yok" ile kapanır. 256 MB üstü dosya, tarayıcı destekliyorsa doğrudan diske yazılır.
- **Kayıt:** her transferin meta verisi (yön, temizlenmiş ad, boyut, SHA-256, sonuç) `session_files` tablosuna ve
  audit'e yazılır. İçerik saklanmaz. Dosya gönderme yetkisi: `file_transfer.use`.
- **İşaretleme:** teknisyen sahnede kalem, ok, dikdörtgen, lazer, 4 renk, geri al ve temizle kullanır ("Sığdır"
  görünümünde). Çizimler ve lazer müşterinin önizlemesinde görünür; lazer 1 sn'de söner. İşaretleme uzaktan kontrol
  izni gerektirmez ve girdi üretmez.
- **Yüzen pencere (PiP):** müşteri önizlemeyi Document Picture-in-Picture penceresine alabilir; düğme yalnız
  destekleyen tarayıcıda görünür.
- **Kalite paneli:** saniyede bir FPS, kbps, RTT, kayıp, çözünürlük ve bağlantı tipi (doğrudan / STUN / TURN).
  3 sn süren eşik aşımında sarı "zayıf" veya kırmızı "kötü" uyarısı, nedeni metinle. Oturum özeti (`quality.summary`)
  60 sn'de bir ve bitişte sunucuya gider, `support_sessions.quality_summary`'de tutulur.
- Migration `20261111040000_p5_session_files`; yeni ortam değişkeni yok.

**P6 — Windows istemci ("Hızlı Destek", `apps/agent-win`)**
- Tek dosyalık, kurulumsuz Windows 10/11 programı (Go, CGO'suz, `asInvoker`: yönetici yetkisi istemez). Sunucu adresi
  ve sürüm derlemede ikiliye gömülür; başka bir sunucuya bağlanamaz. İmzasızdır (ADR-0010): bütünlük SHA-256,
  tekrarlanabilir derleme ve GitHub build attestation ile kanıtlanır.
- Müşteri web karşılama sayfasından (`/session/<token>`, yalnız Windows masaüstünde) "Hızlı Destek uygulamasını indir"
  ile `Destek-<8 hane>.exe` dosyasını indirir; program kodu dosya adından okur. Ad değişmişse 8 haneli kodu sorar.
  Sayfada SmartScreen ("Ek bilgi → Yine de çalıştır") rehberi bulunur.
- Akış: karşılama (firma, teknisyen adı, teknisyen doğrulama kodu, bağlanılan sunucu, dolandırıcılık uyarısı,
  "Kötüye kullanımı bildir", KVKK metni + ad + onay) → bekleme odası (4 haneli kabul kodu) → ekran seçimi (birden çok
  monitörde) → oturum penceresi (sohbet, dosya alma, "Oturumu bitir"). Pencerelerin alt satırında sunucu, sürüm ve
  parmak izi (SHA-256'nın ilk 8 hanesi) görünür.
- Ekran: DXGI Desktop Duplication + Media Foundation H.264 (donanım, olmazsa yazılım kodlayıcı), en çok 1920×1080,
  hedef 30 fps, alt sınır 15 fps. Paylaşılan her monitörde kırmızı kenarlık ve "Ekranınız izleniyor — <teknisyen>"
  etiketi; teknisyenin işaretlemeleri ekranda çizilir. Gösterge ve işaretleme görüntüye girmez (Win10 2004+).
- Dosya alma: her teklif onaylanır ("Reddet" varsayılan, "Kabul et" 1,5 sn kilitli), tehlikeli/çift uzantı uyarısı;
  dosya `İndirilenler`'e yazılır, SHA-256 doğrulanır, üzerine yazılmaz, "internetten geldi" işareti (MOTW) eklenir.
  İstemci müşteriden teknisyene dosya **göndermez**.
- Kopuşta 120 sn içinde kendiliğinden yeniden bağlanır. Oturum bitince birkaç saniye içinde kapanır, %TEMP%, kayıt
  defteri veya AppData'da iz bırakmaz (`apps/agent-win/test/trace-check.ps1`, runbook §11.8).
- Sunucu: `GET /api/v1/public/agent/download?ref=` (302 → `/downloads/Destek-<kod>.exe`); Caddy dosyayı sunmadan önce
  server'ın bütünlük kapısına sorar (`forward_auth`), hash `AGENT_SHA256` ile uyuşmazsa 503 (fail-closed).
  Ayrıntı: [`docs/api.md`](docs/api.md).
- Bilinen sınırlamalar: karşılamada firma logosu yerine Nokta amblemi görünür (sunucu firma logosunu P9'a kadar `null`
  döner); fare imleci görüntüye çizilmez (teknisyen imleci görmez); uzaktan kontrol P7'dedir; istemci arayüzü yalnız
  açık temadadır.

API ayrıntısı: [`docs/api.md`](docs/api.md). Sürüm geçmişi: [`CHANGELOG.md`](CHANGELOG.md).
Müşteri için Hızlı Destek kullanımı: [`docs/KULLANIM_KILAVUZU.md`](docs/KULLANIM_KILAVUZU.md).

**Staging'de teknisyen hesabı:** Seed yalnız Super Admin oluşturur. Super Admin tenant seçmeden destek oturumu
açamaz (403; tenant geçişi P9). Kullanıcı yönetimi ekranı P9'da gelene kadar ADMIN/USER hesabı
`deploy/staging-users.sh` ile eklenir (`docs/runbook.md` §6).

## Yol haritası
| Paket | Kapsam |
|---|---|
| P2 ✓ | Destek oturumu oluşturma (8 haneli kod), liste, iptal, karşılama sayfası iskeleti |
| P3 ✓ | Sinyalizasyon sunucusu (WebSocket), lobi + teknisyen kabulü, TURN (coturn), `/metrics` |
| P4 ✓ | Tarayıcı modu ekran paylaşımı, KVKK onayı, teknisyen konsolu video |
| P5 ✓ | Sohbet, dosya transferi, ekran üzerine işaretleme + lazer + yüzen pencere, kalite paneli |
| P6 ✓ | Windows istemci (Go, imzasız; SHA-256 + build attestation) |
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
| Windows istemci | Go 1.26 (CGO'suz), Pion WebRTC v4, `coder/websocket`, `golang.org/x/sys`; Win32 arayüz |
| Test | Vitest, Playwright + axe, `go test -race` |
| Paket yöneticisi | pnpm 9 (corepack), monorepo |

## Gereksinimler
- Node.js **≥ 22.18** (CI ve imajlar 22.23.4 kullanır), pnpm 9 (`corepack enable` ile `packageManager` sürümü gelir).
- Docker Engine 27+ ve Docker Compose v2 (yığın ve entegrasyon testi için).
- MySQL 8.4 (compose içinde gelir; ayrı kurulum gerekmez).
- Windows istemciyi derlemek için Go kurulumu gerekmez; derleme Docker'daki `golang` imajında yapılır.
- Müşteri tarafı: Windows 10 / 11 (64 bit). Windows N sürümlerinde Media Feature Pack gerekir; yoksa görüntü gönderilemez.

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
| `AGENT_SHA256` | İndirme için | Yayındaki `NoktaDestek.exe`'nin SHA-256'sı (64 hex). Elle yazılmaz; `deploy/agent/verify-and-publish.sh` doğrulamadan sonra yazar. Boşsa istemci indirmesi 503 döner, server yine açılır |
| `AGENT_BINARY_PATH` | Compose dışı | İkilinin mutlak yolu. Compose `/data/downloads/NoktaDestek.exe` verir; yalnız yerel `pnpm` çalıştırmada gerekir |
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

Windows istemci testleri (Go kurulu olması gerekmez; CI ile aynı imaj, repo kökünden):
```bash
IMG=golang:1.26.11-bookworm@sha256:dc40a13b61304647ed7e5d581d246b86413dfc29d63c6d018310feb93cd98fc0
docker run --rm -v "$PWD":/src -v remote-gomod:/go/pkg/mod -w /src/apps/agent-win -e GOFLAGS=-mod=readonly $IMG sh -c '
  test -z "$(gofmt -l .)" && go vet ./... && go test -race -count=1 ./... &&
  GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go vet ./...'
```
Win32/DXGI/MOTW'a dokunan testler yalnız Windows'ta koşar (CI `agent-win.yml` → `test-windows`).

### Gerçek sunucu e2e (P4 regresyonu)
Varsayılan e2e sahte API/WS'ye karşı koşar. `e2e/p4-real.spec.ts` ise gerçek server + MySQL ile uçtan uca akışı
(KVKK → lobi → kabul → ekran paylaşımı → bitiş, ret, zorla sonlandırma, konsol yenileme) dener. CI'da koşmaz.
Tek komut (Docker gerekir; yalnız yerel, canlı DB'ye asla bağlanmaz):
```bash
scripts/e2e-real.sh
```
Betik sırasıyla: kodun anlık görüntüsünü geçici dizine alır → geçici MySQL (`rs-mysql-e2e-real`, 127.0.0.1:33317)
+ migrate + grants → seed (`SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` betikte rastgele üretilir) →
`e2e:real:users` (demo tenant'ta iki ADMIN; parolalar rastgele) → server :3302 → `e2e:real` (web standalone
derlemesi, :3218) → temizlik. Parolalar ekrana veya dosyaya yazılmaz; Playwright izi varsayılan kapalıdır
(`E2E_REAL_TRACE=1` ile açılır, iz o koşunun parolasını içerir).

Çıkış kodu: 0 geçti, 1 test kırmızı, 2 ön koşul eksik, 3 kurulum (DB/seed/server) hatası. Ayarlar: `E2E_DB_CONTAINER`,
`E2E_DB_PORT`, `E2E_SERVER_PORT`, `E2E_KEEP_LOGS=1`, `E2E_REAL_REF=<git ref>` (çalışma ağacı yerine commit'lenmiş sürümü
koşturur; kırmızıda "kurulum mu ürün mü" ayrımı için). Sorun giderme: `docs/runbook.md` §10.

Müşteri tarafındaki ekran kaynağı sentetiktir (`getDisplayMedia` → canvas `captureStream`, 1280x720 @30 fps);
fiziksel ekran yakalanmaz. WebRTC hattı, sinyalizasyon, server ve DB gerçektir.

`e2e:real:users` (`apps/server/scripts/e2e-real-users.ts`) `NODE_ENV=production` iken veya `E2E_REAL_ALLOW=1` olmadan
çalışmaz (pnpm komutu bayrağı kendisi verir). Betik prod imajına girmez.

### Son test sonuçları (P6, 2026-11-11)
| Takım | Sonuç |
|---|---|
| Windows istemci (`go test -race`, linux) | 12/12 paket ok; `GOOS=windows go vet` temiz; govulncheck 0 erişilebilir zafiyet; iki derleme aynı SHA-256 |
| Birim (`pnpm -r run test`) | 309: server 178, web 99, contracts 32 |
| Server entegrasyon (`test:int`) | 142 (21 dosya) |
| Web e2e (sahte API/WS) | 142 geçti + 34 atlandı (masaüstü akışlarının mobil kopyaları); P6 spec'i `e2e/p6-agent-download.spec.ts` dahil |
| Gerçek sunucu e2e (`scripts/e2e-real.sh`) | 5/5 (P5'ten değişmedi) |
| TURN (`deploy/turn/test-local.sh`) | 62 kontrol (P4'ten değişmedi) |

P6 e2e'si: indirme bağlantısı ve `Destek-<8 hane>.exe` dosya adı, SmartScreen rehberi, 503 → "Tarayıcıdan devam et",
410 → iptal ekranı, macOS ve mobilde indirme seçeneğinin olmaması, 375 px taşma, açık/koyu axe 0.
Gerçek Windows'ta SmartScreen, ekran yakalama, DPI ve iz testi elle yapılır (runbook §11.8).

P5 e2e'si (`e2e/p5-collab.spec.ts`, yalnız masaüstü): sohbet + XSS, iki yön dosya, tenant sınırı, bozuk SHA, iptal,
teklif sınırı ve zaman aşımı, yetkisiz kullanıcı, işaretleme ve lazer, PiP, kalite paneli, axe (açık/koyu) ve
375 px taşma. AC-41 (1080p ≥ 15 FPS) ve AC-57 (işaretleme p95 < 200 ms) burada yerel ön kanıtla ölçülür; gerçek ağ
ölçümü staging'de yapılacak.

## Deploy
- Tek sunucu, Docker Compose. Dışarıya yalnız Caddy **4450/tcp** açılır; MySQL portu yayımlanmaz.
- Staging: `185.126.217.99:4450` (`PUBLIC_BASE_URL=https://185.126.217.99:4450`, `SITE_HOST=185.126.217.99`).
- Yeni sürüm: `git pull && IMAGE_TAG=<sürüm> docker compose build && IMAGE_TAG=<sürüm> docker compose up -d`.
- Sağlık: `/health` ve `/ready` yalnız konteyner içinden erişilir (Caddy dışarıya 404 döner).
- TURN: `deploy/turn` ayrı compose projesidir (host ağı); kurulum, güvenlik duvarı ve doğrulama `docs/runbook.md` §9.
  Staging'de TURN'ün dışarıdan çalışması için üst NAT'ta (pfSense) 3478/udp+tcp, 5349/tcp ve 49160–49199/udp
  yönlendirmesi gerekir (runbook §9.3, ağ yöneticisi talebi).
- Migration her `up -d`'de `migrate` servisiyle otomatik uygulanır. Yedekleme P13'te eklenecek.

### Windows istemciyi derleme ve yayınlama (runbook §11)
**Derleme** — `apps/agent-win/build/build.sh <https://alan-adı[:port]> <sürüm x.y.z> [çıktı]`. Betik go-winres ile
manifest ve sürüm bilgisini ekler, sunucu adresini ve sürümü `-ldflags` ile gömer. Makinede Go yoksa Docker'daki
`golang` imajıyla, temiz bir checkout'ta (repo kökünden):
```bash
IMG=golang:1.26.11-bookworm@sha256:dc40a13b61304647ed7e5d581d246b86413dfc29d63c6d018310feb93cd98fc0
mkdir -p /tmp/b1
docker run --rm -v "$PWD":/src -v /tmp/b1:/out -w /src -e GOFLAGS=-mod=readonly -e GOTOOLCHAIN=local $IMG \
  sh -c 'git config --global --add safe.directory /src; apps/agent-win/build/build.sh https://<adres>:4450 <x.y.z> /out/NoktaDestek.exe'
shasum -a 256 /tmp/b1/NoktaDestek.exe
```
Derleme tekrarlanabilirdir: aynı commit, adres ve sürümle iki derlemenin SHA-256'sı aynıdır. Exe'ye gömülü adres
alan adı olmalı ve sertifikası Windows'un güvendiği köklerden gelmelidir (istemci sertifika sabitleme yapmaz,
geçersiz sertifikayı reddeder).

**Yayın** — CI (`.github/workflows/agent-win.yml`) iki ayrı runner'da derler, hash eşitliğini doğrular, `SHA256SUMS` ve
build attestation üretir; `v*` etiketinde onaylı Release açar. Sunucuya yayın operatör makinesinden yapılır:
```bash
deploy/agent/verify-and-publish.sh --tag vX.Y.Z --ssh root@185.126.217.99      # önce --dry-run ile yalnız doğrulama
```
Betik `SHA256SUMS` + `gh attestation verify` doğrular, exe'yi `agent_downloads` volume'una koyar, `deploy/.env`
içindeki `AGENT_SHA256`'yı yazar, server'ı yeniden başlatır ve Caddy üzerinden hash'i kontrol eder. Rollback, staging
(Release'siz) yayını, private repo yolu ve bütünlük alarmı: runbook §11.3–§11.7. Günlük dış gözcü: `agent-watch.yml`.
- Günlük işlemler, loglar, sorun giderme: [`docs/runbook.md`](docs/runbook.md).

## Klasör yapısı
```
apps/server/        Fastify API (src/), Prisma şeması ve migration'lar (prisma/), testler (test/)
apps/web/           Next.js arayüzü (app/, components/, lib/), e2e testleri (e2e/)
packages/contracts/ Ortak zod şemaları, yetki listesi, hata kodları
apps/agent-win/     Windows istemci (Go): cmd/noktadestek, internal/ (api, flow, rtc, capture, ui, transfer…),
                    build/ (build.sh, winres.json), test/trace-check.ps1
deploy/             docker-compose.yml, Caddyfile, mysql/ (kullanıcı init + yetki kontrol betiği),
                    turn/ (coturn compose, başlatıcı, güvenlik duvarı ve test betikleri),
                    agent/ (verify-and-publish.sh: istemci yayını)
scripts/            Lisans denetimi, gerçek sunucu e2e betiği (e2e-real.sh)
.github/            CI iş akışları (ci, agent-win, agent-watch), Dependabot
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
- Dosya transferinde içerik sunucudan geçmez ve saklanmaz; yalnız meta veri (temizlenmiş ad, boyut, SHA-256, sonuç)
  kaydedilir. Alıcı her teklifi onaylar; sınır beyan edilen değil alınan bayta göre uygulanır, SHA-256 tutmazsa dosya
  atılır. İndirme `application/octet-stream` olarak sunulur. `file.meta` kayıtları taraf ve sınıf başına kotalıdır;
  sohbet ve işaretleme mesajları alıcıda hız sınırlıdır.
- Windows istemci: imzasız ama tekrarlanabilir derleme + `SHA256SUMS` + build attestation; sunucu hash'i `AGENT_SHA256`
  ile tutmayan dosyayı sunmaz (503). İstemci yalnız gömülü adrese TLS ≥ 1.2 ile bağlanır, yönlendirme izlemez,
  DLL'leri yalnız System32'den yükler, kabul edilen dosyaya MOTW yazar ve iz bırakmaz.
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
