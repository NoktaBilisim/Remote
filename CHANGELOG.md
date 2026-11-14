# Changelog

Bu projedeki önemli değişiklikler bu dosyada tutulur.
Biçim [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/), sürümleme [Semantic Versioning](https://semver.org/lang/tr/).

## [Unreleased]

### Eklendi — P13b-L (bekleme odası göstergesi; AC-304–315, ADR-0029)
- **"Müşteri bekliyor (n)" rozeti:** Oturumlar listesinde bekleyen (PENDING) oturumun "Durum" hücresinde, bekleme
  odasındaki müşteri sayısıyla birlikte (zil ikonu). Kendi oturumunuzda rozete tıklamak konsolu açar. Admin'in başka
  teknisyene ait satırında ve firma seçmemiş Super Admin'de rozet yalnız bilgi verir, tıklanmaz.
- **Menü sayacı:** Kenar menüdeki "Oturumlar" öğesinde, kendi oturumlarınızdaki bekleyen müşterilerin toplamı. Panelin
  her sayfasında görünür, 0 iken gizlidir. `support_requests.view` yetkisine bağlı değildir; `sessions.view` yeter.
- **Toast:** Yeni müşteri bekleme odasına girince "Bekleme odasında müşteri var" ve "Konsolu aç" eylemi (birden çok
  oturumda "Bekleme odasında {n} müşteri var" + "Oturumlara git"). En az 15 sn ekranda kalır. Sayfa açılırken zaten bekleyen
  müşteri ve o oturumun konsolundayken gelen müşteri için gösterilmez.
- **Sekme başlığı:** Sekme arka plandayken başlık "({n}) Müşteri bekliyor — " ile başlar; talep sayacıyla birlikte
  "(1) Müşteri bekliyor — (3) …" sırasıyla yazılır. Konsol sayfalarında uygulanmaz.
- **API:** `GET /api/v1/sessions/waiting` (yalnız kendi oturumlarınız, bellekten, `no-store`, audit yok, 60/dk/kullanıcı,
  firma seçmemiş Super Admin → 403). `GET /api/v1/sessions` ve `GET /api/v1/customers/:id/sessions` öğelerine
  `waitingGuests` (0..3) alanı. `sessions.view` yetkisi olmayan kullanıcıda değer her zaman 0'dır.
- Sözleşme: `LOBBY_GUEST_MAX`, `LOBBY_POLL_MS`, `SESSIONS_WAITING_PER_MIN`, `waitingSessionsResponseSchema`
  (`@remote/contracts/api/sessions`).
- Göstergeler 10 sn'de bir yenilenir. Yalnız sayı taşır, müşteri adı göstermez (KVKK veri en aza indirme). Hata olursa
  son değer korunur, hata mesajı çıkmaz.
- Migration, yeni yetki anahtarı, yeni ortam değişkeni ve yeni bağımlılık yok.

### Değişti — P13b-L
- `SessionHistoryDetail` artık `waitingGuests` taşımaz (geçmiş ayrıntısı canlı durum göstermez).
- Destek talebi sekme başlığı sayacı lobi ön ekiyle aynı yazıcıdan üretilir; iki sayaç birbirini silmez.
- Bildirim alanı (`ToastViewport`) `role="status"` taşır.

### Düzeltildi
- **Oturumlar, firma seçmemiş Super Admin** (`a71d80e`): "Yeni destek oturumu" düğmesi 403 "Önce bir firma seçin."
  ile dönüyordu. Artık liste tüm firmaları göstermeye devam eder; oluştur, iptal et, sonlandır ve konsol eylemleri
  gizlenir, yerine "üst menüden bir firma seçin" notu çıkar.

### Eklendi — P13b (prod açılışı; AC-23, 91, 126, 200 revize; AC-298–302)
- **Prod adresi** `https://remote.noktabilisim.net` (Let's Encrypt, host nginx → Caddy `127.0.0.1:4451`); staging yığını yerinde
  terfi eder (ADR-0019), prod'da `CADDY_BIND=127.0.0.1`. Açılış sırası ve imzalı kontrol listesi runbook §20.
- **Yedek imzası** (ADR-0020): manifest `format: 2` (`env`, `host`, `signer`, `seq`, `prevRun`, `audit`) ed25519 ile
  imzalanır (`manifest.json.sig`). `restore.sh --allowed-signers` imzayı her şeyden önce doğrular; imzasız/bozuk/değiştirilmiş
  yedek çözülmez. Ortam kilidi (`DEPLOY_ENV` = `--target` = manifest `env`, `--confirm`, production'da TTY), migrator ile
  `--system-command=OFF` yükleme, `CHECKSUM TABLE` eşitliği, tazelik/replay denetimi.
- **Audit süreklilik denetimi** (AC-301): geçmiş gün sayısı/özeti değişirse veya en büyük id azalırsa `FAILED adım=audit-sureklilik`
  + alarm; meşru sıfırlama `backup.sh --reset-audit-baseline "<gerekçe>"` ve host işareti. Audit etiketi "Yedek audit taban
  çizgisi sıfırlandı", audit filtresinde yeni **Yedekleme** grubu.
- **Site dışı kanca** (AC-300): `BACKUP_OFFSITE_CMD`, ayrı `remote-offsite` kullanıcısı, süre sınırı; `OFFSITE-FAILED` alarmı,
  tanımsızsa `OFFSITE-UNCONFIGURED`. `/var/lib/remote-backup/status.prom`.
- **`reset-superadmin` CLI** (AC-299): `node src/cli/reset-superadmin.ts --email … [--reset-mfa] [--dry-run]`; geçici şifre
  yalnız TTY'ye, 24 saat geçerli; oturumlar iptal; audit `auth.superadmin_reset`.
- **`remote-watch`** (AC-302): 10 dk'lık systemd zamanlayıcısı; servis, `/ready`, nginx, coturn, sertifika, yedek, disk ve izin
  kontrolleri; 6 saatte bir tekrar, "DUZELDI" bildirimi; komut metninde sır varsa çalışmaz.
- **`proxy-guard`** (G-P13b-3): nftables ile yerel 4451'e yalnız root/nginx kullanıcısı bağlanır.
- **TURN sertifika kancası** (`deploy/turn/cert-deploy-hook.sh`): LE `remote-turn` → `/etc/remote/turn-certs`, SIGUSR2, parmak izi
  doğrulaması.
- **WhatsApp servis anahtarı** (S-P13b-3): Sistem ayarları › WhatsApp servisi'nde "Servis anahtarı" alanı ve rozeti; `x-api-key`
  başlığı; AES-256-GCM ile adrese bağlı saklama; servis 401 → "Servis anahtarı reddetti.". API: `apiKey`, `apiKeySet`,
  `apiKeySource`, `WA_API_KEY_REENTER`. Migration `20261115090000_whatsapp_api_key` (CHECK).
- Yeni ortam değişkenleri: `DEPLOY_ENV`, `WHATSAPP_SERVICE_API_KEY`, `TURN_FW_RELAY_MAX_BPS`, `TURN_CERT_DIR`.
- Kılavuz: Admin için ağ gereksinimleri (443/TCP, 3478 UDP/TCP, 5349/TCP, 49160–49479/UDP), Super Admin kurtarma, servis anahtarı.

### Değişti — P13b
- HSTS `max-age=31536000; includeSubDomains` (helmet ve Caddy).
- TURN: relay aralığı 49160–49479/udp, `total-quota=300`, `TURN_MAX_BPS` varsayılanı 1000000 bayt/sn (8 Mbit/s, ölçüldü),
  `TURN_BPS_CAPACITY=0`; host toplam tavanı hashlimit ile. TURN-TLS 5349 (443 kullanılmaz, ADR-0018).
- TURN credential oda başına önbelleğe alınır; yeniden bağlanmada yeni coturn kullanıcısı üretilmez (G-P13b-1).
- Yedek betikleri bölündü (`lib-audit.sh`, `lib-offsite.sh`, `lib-restore.sh`); birim `TimeoutStartSec=2h`.

### Kaldırıldı — P13b
- WhatsApp için yerleşik varsayılan servis adresi ve "Varsayılan" rozeti (G-P13b-2). Env ve panel kaydı boşsa kanal kapalıdır.
  API `source` artık yalnız `panel` | `env`.

### Güvenlik — P13b
- Dokümanlardaki gerçek WhatsApp servis adresi yer tutucuyla değiştirildi (`http://<whatsapp-servis>:3000`).
- `file.transfer*` audit kayıtlarında dosya adı/sha256 yok (S-P13a-8, doğrulandı); `check-app-grants.sh` anonim hesap ve
  migrator fazlalığı kontrolleri (384 kontrol).

### Eklendi — P13a (saklama, yedek/geri yükleme, dokümantasyon; AC-88, 91, 92, 93, 197–200)
- **Saklama süresi işi** (`apps/server/src/jobs/retention.ts`, her gün 03:30 Europe/Istanbul; mevcut zamanlayıcı genişletildi):
  - Bitmiş oturumlar firma saklama süresinden (`retentionDays`, varsayılan 365) sonra anonimleştirilir: müşteri adı, e-posta,
    not, ağ anahtarları silinir; onay kayıtlarında IP/tarayıcı silinir (karar ve metin sürümü kalır); dosya kayıtları silinir.
  - Audit kayıtları 730 gün sonra, giriş oturumları ve şifre sıfırlama bağlantıları süre bitiminden 7 gün sonra silinir.
  - 1.000'lik partiler, firma başına hata yalıtımı, üst üste binmeyen ve idempotent tur.
  - Audit `retention.run` (yalnız sayılar; firma başına + firma alanı boş global kayıt), metrikler
    `rs_retention_last_success_timestamp_seconds`, `rs_retention_rows_total{kind}`, `rs_retention_failures_total`.
- **Ayarlar › Güvenlik › Veri saklama:** firmanın saklama süresi (90–730 gün, varsayılan 365) ekrandan değiştirilir;
  `settings.edit` ile düzenlenir, `settings.view` ile salt okunur görünür.
- **Oturum geçmişi:** "Anonimleştirildi" rozeti (liste ve ayrıntı), silinen/korunan veriler bilgi notu, salt okunur
  ticket/not; API `anonymized` alanı, PATCH → 409 `SESSION_ANONYMIZED`; CSV'de Müşteri hücresi `Anonimleştirildi`.
- **Audit ekranı:** "Saklama süresi işi" etiketi, "Veri saklama" grup filtresi; dış gönderim/test kayıtlarında hata nedeni
  Türkçe etiketle (tek kaynak `contracts/src/labels.ts`).
- **Yedek ve geri yükleme** (`deploy/backup/`): günlük 02:00 systemd zamanlayıcısı, MySQL dökümü + `uploads` aynı çalıştırmada,
  `age` ile şifreli (çözme anahtarı sunucuda yok), manifest (son migration, satır sayıları, SHA-256), 14 gün rotasyon,
  boş alan kontrolü, hata alarmı (`BACKUP_ALERT_CMD`). `restore.sh --target scratch` geçici MySQL'e yükleyip
  `restore-verify: OK|FAIL` yazar; `--target staging` onaylı gerçek geri yükleme. Yapılandırma `deploy/backup/backup.env`
  (git dışı, root 600). Ayrıntı runbook §18.
- `backup` MySQL kullanıcısı (yalnız `localhost`, `SELECT, SHOW VIEW, TRIGGER`): yeni kurulumda `deploy/mysql/init/01-users.sh`,
  mevcut kurulumda `deploy/mysql/backup-user.sql`.
- Yeni ortam değişkeni **`MYSQL_BACKUP_PASSWORD`** (`deploy/.env`, ≥ 16 karakter; yalnız `mysql` servisine verilir, server okumaz).
- Runbook §19 senaryo dizini (servis düştü, TURN, sertifika, istemci yayını/bütünlük, TURN IP değişimi, kötüye kullanım,
  veri bozuldu, saklama işi çalışmadı, disk doldu, yedek alınamadı); runbook §2 temiz kurulum kaydı (AC-88).
- `scripts/build-docs.sh` ve `pnpm docs:pdf`: README, kullanım kılavuzu ve datasheet PDF'leri tek komutla (`docs/pdf/`).
- Kılavuz: kişisel veri saklama/anonimleştirme, kurumsal AppLocker/antivirüs izin rehberi (hash kuralı, `SHA256SUMS`).
- Tarayıcıda 256 MB üstü dosya alırken kayıt penceresinden **önce** "Var olan bir dosyanın üzerine yazmayın" uyarısı.

### Değişti — P13a
- Migration `20261114120000_p13a_retention`: `support_sessions.anonymized_at` + CHECK + indeks; `audit_logs` için
  `created_at`'i veritabanı saatine zorlayan tetikleyici (yalnız `app`); P11 `audit_logs_no_update` tetikleyicisi bileşik
  gövdeyle yeniden kuruldu (döküm `mysql` ile yüklenebilsin); WhatsApp CHECK'i görünmez karakterleri reddeder.
  `app` yetkileri: `audit_logs`, `password_reset_tokens`, `session_files` DELETE; `session_consents` UPDATE(ip, user_agent).
- `requests/jobs.ts` `dailyRetention` kaldırıldı; talep, müşteri ve kayıt adımları `RetentionJob` içinde firma başına çalışır
  (davranış aynı).
- WhatsApp servis adresi WHATWG kanonik biçimde saklanır (`HTTPS://X/` → `https://x`; ondalık IPv4 noktalı, IDN punycode);
  büyük harfli şema reddedilmez. Kaynak `source: "panel" | "env" | "default"`; ekranda yeni **Varsayılan** rozeti.
  `WHATSAPP_SERVICE_URL` artık isteğe bağlı.
- Sistem ayarları (MySQL, TURN, WhatsApp) PUT/DELETE kullanıcı başına ortak 10/dk (429 + `Retry-After`); değeri
  değiştirmeyen PUT yazım ve audit yapmaz.
- Ticket no ipucu: "Kişisel veri (ad, telefon, e-posta) yazmayın; ticket no saklama süresinden sonra da korunur."
- Go: `golang.org/x/net` v0.62.0, `x/crypto` v0.59.0 doğrulandı (govulncheck temiz); istemci sürümü yayımlanmadı.

### Güvenlik — P13a
- Müşteri kaynaklı audit kayıtlarında müşteri adı yazılmaz; IP yerine ağ öneki (IPv4 /24, IPv6 /48), tarayıcı bilgisi yok
  (S-P13a-1). Anonim oturumun zaman çizelgesinde ad ve sonlandırma gerekçesi gösterilmez (S-P13a-5).
- Dosya aktarım audit kayıtlarına (`file.transfer`, `file.transfer.sender_report`, `file.meta.rejected_by_db`) dosya adı
  ve SHA-256 yazılmaz; yalnız yön, uzantı, boyut ve sonuç (S-P13a-8).
- `app` kullanıcısı 730 günden yeni audit kaydını silemez ve geri tarihli kayıt yazamaz.
- Canlı ortamda link-local adres (`169.254.0.0/16`, `fe80::/10`) WhatsApp için özel ağ sayılmaz; `http://` ile kanal kapalı.
- Yedek: düz döküm diske yazılmaz; geri yükleme `--system-command=OFF`, dökümde istemci komutu varsa ve yükleme öncesi/sonrası
  hesap/yetki/rutin farkı varsa FAIL; tetikleyici sayısı 3 değilse yedek FAILED; `backup.env` root/600 değilse okunmaz;
  `--target staging` açık onay (`--confirm`) ister, `production` hedefi reddedilir (S-P13a-2..7).

### Eklendi — P12b (WhatsApp servisi sistem ayarı, AC-196)
- **Sistem ayarları > WhatsApp servisi** (`/admin/settings/whatsapp`, yalnız Super Admin; 4. sekme): etkin servis adresi,
  kaynak rozeti (**Panel** / **Ortam değişkeni**), son güncelleme. **Servis URL'si** kaydedilir, yeniden başlatma gerekmez;
  kayıttan sonraki ilk bildirim ve test yeni adrese gider. **Ortam değişkenine dön** (onaylı) panel kaydını kaldırır.
  **Test Mesajı Gönder** girilen numaraya kayıtlı adresle test mesajı yollar, sonucu ekranda gösterir.
- Etkin adres önceliği: panel kaydı > `WHATSAPP_SERVICE_URL` > varsayılan. `WHATSAPP_SERVICE_URL` artık yalnız yedek değer.
- API: `GET/PUT/DELETE /admin/settings/whatsapp`, `POST /admin/settings/whatsapp/test`. Ayrıntı `docs/api.md`.
- Audit (sistem kaydı, firma boş): `settings.whatsapp.updated`, `settings.whatsapp.deleted` (eski → yeni adres ve kaynak);
  `settings.whatsapp.test` (numara maskeli, sonuç, hata nedeni sınıfı).
- Migration `20261114090000_whatsapp_service_setting` (yalnız CHECK: `system_settings` += `whatsapp`, `{"url": string|null}`).
  Yeni ortam değişkeni, volume ve bağımlılık yok. Yayın ve geri alma: runbook §17.

### Değişti — P12b
- `WHATSAPP_SERVICE_URL` açılışta panel kuralıyla doğrulanır (`http://`/`https://`, kullanıcı:şifre, `?`, `#`, boşluk yok,
  ≤ 200 karakter; sondaki `/` kırpılır). **Uymayan değerde server açılmaz**; yayından önce `.env` değerini kontrol edin
  (runbook §17.2/3). Boş değer varsayılana düşer.
- Servis yolu adresin sonuna eklenir (`{url}/send-message`, `{url}/test-send`); önceden adresteki yol düşüyordu.
- Firma (tenant) WhatsApp testi aynı sabit mesajları kullanır; zaman aşımı ayrı mesajla bildirilir ("Servis 8 saniye
  içinde yanıt vermedi (zaman aşımı).").

### Güvenlik — P12b
- Güvensiz adres (production'da `http://` + genel adres) veya ayrıştırılamayan adres → kanal kapalı, testler servise istek
  göndermez; ekranda kalıcı uyarı, logda `alarm: whatsapp_insecure` / `whatsapp_invalid_url` (adres loga yazılmaz).
- Test yanıtı sabit mesajdır; servis gövdesi, adres ve iç hata dönmez. Yönlendirme (3xx) izlenmez, başarısız sayılır.
  Her yanıt gövdesi iptal edilir.
- Test ucu: Super Admin başına 5/dk, tüm Super Admin'ler için ortak 20/dk; aşımda 429 + `Retry-After`.
- PUT/DELETE süreç içinde sıralı yürür; bellekteki adres son kayıtla aynı kalır. Firma uçları adresi döndürmez.
- Güvenlik denetimi: Kritik/Yüksek/Orta 0; QA Tur 3 GEÇTİ.

### Bilinen sınırlamalar — P12b
- Adres normalize edilmeden saklanır (görünmez karakter reddi dahil, B-P12b-4) ve PUT/DELETE'te hız sınırı yoktur; ikisi
  "Sonra" (`docs/guvenlik-raporu.md`). Adres değişikliği yalnız tek sunucu sürecine uygulanır (ADR-0005).

### Eklendi — P12 (marka ve kişiselleştirme)
- **Hesap menüsü** (üst menüde avatar): Hesabım, Şifre değiştir, Tema (Açık / Koyu / Sistem), Çıkış; klavyeyle kullanılabilir
  (Esc kapatır). `/account` sayfasına **Profil** (profil resmi) ve **Görünüm** (tema) bölümleri eklendi.
- **Profil resmi (avatar):** yükle (tarayıcıda kare kırpma + önizleme) / değiştir / kaldır (onaylı). Admin, kullanıcı
  detayında kendi firmasındaki yönetebildiği aktif kullanıcının resmini yönetir. Resim yoksa baş harf rozeti. Üst menü,
  kullanıcı listesi ve audit log'da görünür.
- **Ayarlar > Logo** (`/settings/logo`, `settings.view` / `settings.edit`): firma logosu önizlemeli yükle / değiştir / kaldır.
  Logo üst menüde, müşteri karşılama sayfasında ve e-postalarda; kaldırılınca sistem logosu.
- **Sistem ayarları > Sistem logosu** (`/admin/settings/system-logo`, yalnız Super Admin): yükle / değiştir.
- **Giriş ekranında logo:** `/login?tenant=<kısa ad>` firma logosu, aksi hâlde sistem logosu, o da yoksa Nokta Bilişim logosu
  (giriş, şifremi unuttum, şifre sıfırlama ekranları).
- **Tema tercihi kullanıcı başına:** DB'de saklanır, başka cihazda aynı gelir; `rs_theme` çereziyle ilk HTML doğru temayla
  çizilir (yanıp sönme yok). Kayıt hatasında önceki seçime dönülür.
- API: `PATCH /auth/me/preferences`, `POST/DELETE /settings/logo`, `POST/DELETE /users/:id/avatar` (`me` dahil),
  `POST /admin/settings/system-logo`, `GET /files/logo/*`, `/files/system-logo/*`, `/files/avatar/*`, `GET /public/branding`.
  Yeni alanlar `AuthUser.avatarUrl`, `MeResponse.logoUrl`, `UserListItem.avatarUrl`, `TenantSettingsView.logoUrl`; müşteri
  uçlarında `tenant.logoUrl` artık dolu. Yeni hata kodları `INVALID_IMAGE` (400), `PAYLOAD_TOO_LARGE` (413). Ayrıntı `docs/api.md`.
- Audit: `tenant.logo_updated`, `tenant.logo_removed`, `user.avatar_updated`, `user.avatar_removed`,
  `settings.system_logo.updated`, `upload.rejected`, `user.theme_changed`.
- Tasarım: ESLint `remote/design-tokens` kuralı (`error`; sabit renk/px yasak), tüm menü/sekme/hesap menüsü öğelerinde ikon
  (e2e denetimli), `prefers-reduced-motion` (yalnız opaklık) e2e ile doğrulandı.
- Migration `20261113120000_p12_branding` (yalnız CHECK: `logo_path`/`avatar_path` biçimi, `system_settings` += `system_logo`).
  Yeni ortam değişkeni `UPLOADS_DIR`, yeni volume `uploads` (`remote_uploads`), yükleme uçlarında Caddy 3 MiB ve host nginx
  `client_max_body_size 3m`. Yeni bağımlılıklar: `sharp` 0.35.5, `file-type` 22.3.0, `@fastify/multipart` 10.1.8,
  `react-easy-crop` 6.2.5. Sunucu CPU'su x86-64-v2 olmalı (runbook §16).

### Güvenlik — P12
- Resim türü yalnız içerikten (magic bytes + sharp çift kontrol; SVG/HTML/GIF ret), 2 MB, 24 MP, kenar ≥ 16 px, oran logo
  ≤ 20:1 / avatar ≤ 4:1 (kod çözmeden önce; B-P12-2). Yeniden kodlama, EXIF/ICC/XMP silme, rastgele ad, atomik yazım.
- Dosya yalnız DB'de o anda kayıtlı yolsa sunulur; avatar oturumlu, başka firma 404, `private, no-cache` (B-P12-4); logolar
  `public, max-age=300`. `nosniff` + `sandbox` CSP.
- Yükleme kişi başı 20/sa; resim işleme süreç genelinde 2 eşzamanlı + 4 bekleyen, dolunca 429. Gövde yetki ve hedef
  doğrulanmadan okunmaz.
- `/public/branding` 60/dk/IP; giriş ekranı ziyaretçi IP'sini yalnız doğrulanmış edge sırrıyla iletir (B-P12-1).
- Teknisyen avatarı müşteriye açılmaz (KVKK); müşteri ekranında baş harf. Güvenlik denetimi: Kritik/Yüksek 0.

### Düzeltildi — P12
- Super Admin `/audit` 1280 px'te yatay kayma (P11 sayfa testi bulgusu) giderildi.
- Logo/profil resmi yüklemede boyut/oran reddi artık sunucunun gerçek nedenini gösteriyor ("Resim boyutları uygun değil…");
  önceden geçerli PNG'ye "Yalnız PNG, JPG veya WEBP" deniyordu.
- `/account` başlığı hesap menüsüyle tutarlı olarak "Hesabım".
- P11 aydınlatma metni, MySQL ve TURN formlarına hidrasyon işareti (`data-ready`); yük altında kararsız e2e giderildi.

### Bilinen sınırlamalar — P12
- Sistem logosu kaldırılamaz, yalnız değiştirilir.
- Pasife alınan kullanıcı/firmanın resim dosyaları korunur; kalıcı silmede dosya temizliği P13 retention işinde (B-P12-3).
- Hızlı Destek (Windows) istemcisi P6'dan beri sunucunun verdiği firma logosunu gösterir; P12 ile bu alan dolu gelir.
  Gerçek Windows'ta görünüm henüz denenmedi (Windows elle testleriyle birlikte).
- Açık maddeler: `docs/gereksinimler-sonra-acik.md` "P12'den".

### Eklendi — P11 (audit log ekranı, sistem ayarları, aydınlatma metni)
- **Audit log** (`/audit`, menüde "Audit log"; `audit.view`): salt okunur liste, 50'şer kayıt + "Daha fazla yükle",
  filtreler URL'de (başlangıç/bitiş günü — boşsa son 30 gün, en çok 731 gün —, kullanıcı, işlem veya işlem grubu, sonuç;
  firma seçmemiş Super Admin için firma). Ayrıntı penceresi: eski/yeni değer düz metin, e-posta ve test kayıtlarında yalnız
  neden sınıfı. Dar ekranda kart görünümü. **CSV indir** (`audit.export`): ≤ 50.000 satır, BOM + `;`, formül kaçışı,
  dakikada 5.
- **Sistem ayarları** (`/admin/settings`, yalnız Super Admin; sekmeler MySQL / TURN):
  - **MySQL:** host, port (3306), veritabanı, kullanıcı, maskeli şifre (forma geri yazılmaz, boş = korunur);
    **Bağlantıyı Test Et** formdaki değerlerle, ≤ 10 sn, sınıflı sonuç. Kayıt çalışan bağlantıyı değiştirmez; `.env`
    (`DATABASE_URL`) + yeniden başlatma gerekir (ADR-0003, runbook §15). Çalışan bağlantıyla uyuşmazlık uyarısı.
  - **TURN:** 1–10 adres (`stun:`/`turn:`/`turns:`), coturn `static-auth-secret` ile aynı gizli anahtar (32–256, boşluk/`#`
    yok), **Ortam değerlerine dön**. Değişiklik yeniden başlatmadan uygulanır.
- **Ayarlar > Aydınlatma metni** (`/settings/consent-text`): firma KVKK metnini düzenleme (50–20.000 karakter, sayaç,
  onay); her kayıt yeni sürüm, sürüm geçmişi (SHA-256).
- API: `GET /audit`, `GET /audit/export.csv`, `/audit*` yazma metotlarına 405 `METHOD_NOT_ALLOWED`;
  `GET/PUT /admin/settings/mysql`, `POST /admin/settings/mysql/test`, `GET/PUT/DELETE /admin/settings/turn`,
  `GET/PUT /settings/consent-text`. Ayrıntı `docs/api.md`.
- Audit: `settings.mysql.updated`, `settings.mysql.test`, `settings.turn.updated`, `settings.turn.deleted`,
  `settings.consent_text.updated`, `audit.exported`.
- Migration `20261113090000_p11_system_settings_audit` (`system_settings` tablosu, audit tetikleyicileri, indeks
  düzenlemesi). MySQL `--log-bin-trust-function-creators=1` bayrağıyla çalışmalı (compose ve CI'da; yoksa migration
  1419 ile durur, kurtarma runbook §15). Yeni ortam değişkeni ve bağımlılık yok.

### Güvenlik — P11
- Audit değiştirilemezliği: API'de yazma 405 (kimlik doğrulamadan önce); `app` kullanıcısında `audit_logs` UPDATE/DELETE/
  TRIGGER/DDL yok; tetikleyiciler UPDATE'i ve 730 günden yeni satırın silinmesini reddeder (`SYSDATE` + UTC; `SET
  TIMESTAMP` ile atlatılamaz).
- Okumada maske yeniden uygulanır; dış gönderim kayıtlarında ham hata, SMTP yanıt kodu ve banner dönmez (P10 koşulu).
- MySQL şifresi ve TURN secret'ı AES-256-GCM; MySQL şifresi hedefe (host + port + kullanıcı) bağlı AAD ile saklanır ve
  başka sunucuya gönderilmez — hedef değişirse şifre zorunlu (B-P11-1). Çözülemeyen kayıt "şifre yok" sayılır.
- MySQL testi: kişi başı 5/dk + global 20/dk, başarısızlıkta süre dönmez, her deneme audit'te (B-P11-4, risk kabulü
  `docs/implementation.md` P11). Aydınlatma metni firma başına saatte 10 kayıt (B-P11-6). Audit imlecinde taşma 400
  (B-P11-5). Güvenlik denetimi: Kritik/Yüksek 0.

### Düzeltildi — P11
- 375–390 px'te Ayarlar alt menüsü "Güvenlik"i kırpıyordu (P10 sayfa testi); alt menü artık dört sekmeyi eşit
  sütunlarda tam gösteriyor.

### Bilinen sınırlamalar — P11
- MySQL bağlantı testi TLS kullanmaz (arayüzde kalıcı uyarı); sunucu tarafı TLS seçeneği "Sonra".
- Panel MySQL ayarı canlı geçiş yapmaz; `.env` güncellenip servis yeniden başlatılmalı.
- Avatar resmi P12'ye kadar yok (baş harf rozeti; P12'de eklendi). Firma seçmemiş Super Admin'de kullanıcı filtresi yalnız yüklü
  kayıtlardan dolar.
- Sayfa testi bulguları (frontend-dev): Super Admin `/audit` 1280 px'te sayfa 45 px yatay kayıyor (Ayrıntı sütunu kesik);
  ≥ 1366 px'te sorun yok. Açık maddeler: `docs/gereksinimler-sonra-acik.md` "P11'den".

### Eklendi — P10 (hesap güvenliği + SMTP)
- **İki adımlı doğrulama (2FA, TOTP):** Google Authenticator, Microsoft Authenticator vb. ile. Kurulum ekranı
  (`/2fa/setup`): QR + elle anahtar (kopyala) → 6 haneli kod → 10 tek kullanımlık kurtarma kodu (bir kez gösterilir;
  kopyala / `.txt` indir; "Kaydettim" işaretlenmeden devam yok). Super Admin ve Admin için zorunlu; teknisyenler (User)
  için firma ayarı **Ayarlar > Güvenlik > Teknisyenler için zorunlu** (varsayılan açık). Kurulmamış zorunlu hesap panele
  geçemez.
- **Girişte 2FA kodu** (`/login/2fa`): uygulama kodu veya kurtarma kodu; kod girilmeden panel, API (403 `MFA_REQUIRED`)
  ve WebSocket kapalı.
- **Şifremi unuttum** (`/forgot-password`, `/reset-password`): firma SMTP'siyle 30 dk geçerli, tek kullanımlık bağlantı;
  yanıt hesabın varlığını söylemez; sıfırlama tüm oturumları kapatır.
- **Hesap güvenliği** (`/account`, üst menüde avatar): şifre değiştir, 2FA durumu ve kalan kurtarma kodu (≤ 3'te uyarı),
  **Tüm cihazlardan çıkış**. Panel 30 dk boşta kalınca oturum düşer ve giriş ekranına döner.
- **Ayarlar > E-posta (SMTP)** (`/settings/smtp`): sunucu, port (25/465/587/2525), güvenlik Yok/SSL/TLS (port önerisi),
  kullanıcı, maskeli şifre (boş = korunur), gönderen adı/adresi, **Test Maili Gönder**, ayarı kaldırma. Ayarlar sayfasına
  alt menü: Destek talepleri · E-posta (SMTP) · Güvenlik.
- **E-posta bildirimleri:** şifre sıfırlama, hesap kilidi (saatte en çok 1), 2FA etkinleştirildi, yeni destek talebi
  (Ayarlar > Destek talepleri e-posta kanalı, ≤ 5 alıcı + test maili; kişisel veri içermez), oturum bağlantısını
  müşteriye e-postayla gönderme (Yeni oturum diyaloğu, teknisyen başına saatte 20).
- Admin için kullanıcı detayında **2FA'yı sıfırla**.
- API: `/auth/mfa/setup|enable|verify`, `/auth/logout-all`, `/auth/password/forgot|reset`, `/settings/smtp/test`,
  `/settings/support-requests/email/test`, `/sessions/:id/email`, `/users/:id/reset-mfa`; `/settings/tenant` += `smtp`,
  `requireTech2fa`; `/auth/me` += `mfa`; `/auth/login` += `mfaSetupRequired`. Yeni hata kodları `MFA_REQUIRED`,
  `MFA_SETUP_REQUIRED`, `HOST_NOT_ALLOWED`, `RESET_TOKEN_INVALID`. Ayrıntı `docs/api.md`.
- Audit: `auth.mfa_setup/mfa_enabled/mfa_verify/logout_all/password_reset_requested/password_reset`, `user.mfa_reset`,
  `mail.sent`, `session.email`, `settings.smtp.test`, `settings.email.test`. Metrik `rs_mail_total{kind,result}`.
- Migration `20261112180000_p10_account_security` (`recovery_codes`, `password_reset_tokens`, `users.totp_last_step`).
  Yeni ortam değişkeni **`APP_ENCRYPTION_KEYS`** (production'da zorunlu; runbook §3, §14 P10). Yeni bağımlılıklar
  `nodemailer` 10.5.0 (MIT-0), `qrcode` 1.5.4 (MIT); geliştirme `smtp-server` 3.21.4 (MIT-0).

### Güvenlik — P10
- SMTP şifresi ve TOTP sırrı AES-256-GCM, sürümlü anahtar (`APP_ENCRYPTION_KEYS`) ve kayda bağlı AAD ile saklanır.
  Kurtarma kodları HMAC-SHA-256 (HKDF ile türetilmiş anahtar), sıfırlama token'ı SHA-256; düz değerler loga/audit'e girmez.
- TOTP tekrar oynatma koruması (aynı/eski zaman adımı reddedilir), kurtarma kodu tek kullanım (koşullu UPDATE).
  2FA deneme sınırı hesap+IP 5/5 dk ve hesap geneli 15/15 dk. Etkinleştirmede ve doğrulamada oturum token'ı yenilenir /
  diğer oturumlar kapanır; paralel kurulum yarışı koşullu UPDATE ile engellenir (B-P10-6).
- SMTP hedef kısıtı (SSRF, G-12): yalnız 25/465/587/2525; iç ağ, loopback, link-local, CGNAT, Docker, IPv6'da 2000::/3 dışı
  ve geçiş aralıkları, sunucunun kendi adresi reddedilir; DNS hatasında son başarılı çözüm, hiç yoksa ret (fail-closed).
  Bağlantı doğrulanan IP'ye, TLS sertifika adı asıl ada göre. "Yok" güvenlikte kimlik bilgisi gönderilmez.
- Gönderim hatasında kullanıcıya tek genel mesaj; etkileşimli gönderimde yanıt en az 12 sn ve soket 12 sn'de kapatılır
  (port/TLS taraması için kâhin yok). Hata sınıfı yalnız log ve audit `reason`'da.
- Şifremi unuttum her durumda 202 ve e-posta yanıt sonrası gönderilir (hesap varlığı sızmaz); token URL parçasında.
- Production'da 2FA zorunluluğunu kapatan test anahtarı reddedilir (B-P10-3). Güvenlik denetimi 3 tur; B-P10-1..11
  kapandı, Kritik/Yüksek 0.

### Bilinen sınırlamalar — P10
- Kurtarma kodlarını kullanıcı kendisi yenileyemez, 2FA'sını kendisi kapatamaz; kodlar biterse Admin "2FA'yı sıfırla"
  yapar.
- Super Admin'in firması ve SMTP'si yoktur: şifre sıfırlama/kilit e-postası gönderilmez, kurtarma sunucuda yapılır
  (runbook §14 P10).
- İç ağdaki SMTP sunucuları desteklenmez (bilinçli). Başarısız test maili ~12 sn sürer.
- Firma logosu henüz yok (P12); e-postalarda sistem logosu kullanılır. Audit ekranı P11'de.
- Sayfa testi bulguları (frontend-dev düzeltiyor): test maili beklerken Esc diyaloğu kapatıp sonucu kaybettiriyor;
  375 px'te Ayarlar alt menüsünde "Güvenlik" kırpık; hiç giriş yapmamış ziyaretçi `/login/2fa`'da "Oturumunuz sona erdi"
  görüyor. Açık maddeler: `docs/gereksinimler-sonra-acik.md` "P10'dan".

### Düzeltildi — P10
- Kurtarma kodu tire çevresinde boşlukla yazıldığında istemcide reddediliyordu; artık boşluklar silinip doğrulanıyor.

### Eklendi — P9 (kullanıcı, yetki ve firma yönetimi)
- **Kullanıcılar** ekranı (`/users`, menüde kişi ikonu; `users.view`): arama (ad/e-posta), rol ve durum filtresi,
  sayfalama. **Yeni kullanıcı** (`users.create`): ad soyad, e-posta, rol (Teknisyen / Yönetici). 16 karakterlik geçici
  şifre yalnız bir kez gösterilir; kopyalanmadan kapatılırsa uyarı çıkar. Kullanıcı ilk girişte şifresini değiştirir.
- Kullanıcı detayı (`/users/<id>`): profil, rol, hesap durumu, 2FA durumu (salt okunur) ve **yetki toggle'ları**. Tüm
  modüller ve alt yetkiler (Görüntüle / Ekle / Düzenle / Sil / Dışa aktar, Kullan, Kabul / ret, Zorla sonlandır) tek
  tanımdan (`packages/contracts/src/permissions.ts`) üretilir; her modülde "Tümünü aç/kapat". Yalnız değişen alanlar
  kaydedilir.
- **Kilitli yetkiler:** işlemi yapanda olmayan yetki kilit simgesiyle gösterilir, verilemez ve değiştirilemez (sunucu
  da 403 verir). Admin kendisinden geniş yetkili hesabı yönetemez; kimse kendi rolünü/yetkisini değiştiremez ve
  kendini pasife alamaz. Super Admin hesapları listede görünmez.
- **Pasife al / Yeniden etkinleştir** (kalıcı silme yok). Pasife alınan kullanıcının oturumları hemen kapanır, açık
  destek oturumları sonlanır. Rol değişimi de açık oturumları sonlandırır; yalnız yetki değişimi açık oturumlara anında
  uygulanır.
- **Firmalar** ekranı (`/admin/tenants`, yalnız Super Admin): firma oluşturma (kısa ad önerisi), düzenleme, arama, durum
  filtresi, pasife alma (etkiler listelenir, kısa adı yazarak onay), yeniden etkinleştirme, satırdan firmaya geçiş.
- Üst menüde Super Admin için **firma seçici**: etkin firmayı gösterir, firmaya geçer veya bağlamdan çıkar.
- API: `/users`, `/users/:id`, `/users/:id/deactivate|reactivate`, `/admin/tenants[/:id[/deactivate|reactivate]]`,
  `/admin/switch-tenant`, `GET/PUT /settings/tenant` (oturum süresi, açık oturum sınırı, etkin oturum süresi, dosya
  sınırı, saklama süresi; bu ayarın web ekranı henüz yok). Ayrıntı `docs/api.md`.
- Audit: `user.created/updated/permission_changed/deactivated/reactivated`, `tenant.created/updated/deactivated/
  reactivated/switched`, `tenant_settings.updated`. Yetki değişikliği anahtar başına ayrı satırdır (kim, kime, eski → yeni).
- Firma pasife alınınca tek işlemde kullanıcı oturumları ve bekleyen kod oturumları iptal edilir; ardından açık destek
  oturumları sonlanır, bekleyen talepler iptal olur ve kayıtlı bilgisayarlar geçersizleşir. Firma oluşturma öncesi
  doğrulama adımları: runbook §14.1.
- Şema, migration, yeni ortam değişkeni ve yeni bağımlılık yok.

### Bilinen sınırlamalar — P9
- Olmayan veya başka firmaya ait kullanıcı sayfası "Kullanıcı bulunamadı" gösterir ama HTTP durumu 200'dür.
- Açık temada kapalı ve kilitli anahtarların kontrastı zayıf; mobilde etkin menü öğesi görünür alana kaydırılmıyor.
- Firma seçici ilk 100 aktif firmayı listeler, arama yok.
- 2FA sıfırlama (P10), avatar (P12) ve audit log ekranı (P11) bu pakette yok. Açık maddeler:
  `docs/gereksinimler-sonra-acik.md` "P9'dan".

### Düzeltildi — istemci 0.10.2 (Windows; ekran yakalama)
- Bazı bilgisayarlarda (özellikle hibrit ekran kartlı veya HDR/gelişmiş renk açık notebook'larda) istemci "Ekran
  görüntüsü alınamadı" diyordu ve hatanın nedeni hiçbir yerde görünmüyordu. İstemci artık sırayla üç yöntemi
  deniyor: DXGI masaüstü çoğaltma, açılamazsa HDR uyumlu DXGI `DuplicateOutput1` (BGRA), o da olmazsa GDI yedek
  yakalama (saniyede 10 kare, imleç dahil). Kodlayıcı ve görüntü işleme hattı aynı kalıyor.
- Hiçbir yöntem çalışmazsa müşterinin durum satırında neden kodu ve kısa bir yönlendirme gösteriliyor. Örnek:
  "Ekran görüntüsü alınamadı (DXGI_UNSUPPORTED). Ekran kartı ayarını kontrol edin." Kodlar: DXGI_UNSUPPORTED,
  DXGI_ACCESS_DENIED, DXGI_NOT_AVAILABLE, NO_OUTPUT, D3D_DEVICE, FIRST_FRAME_TIMEOUT, GDI_FAILED, MF_STARTUP,
  NO_H264_ENCODER, ENCODER_CONFIG, ENCODE_FAILED ve OTHER (HRESULT ile).
- Yakalamada sorun çıktığında (açılamama, yedek yönteme geçiş, yayın sırasında kodlayıcı hatası) yerel tanılama
  kaydı yazılıyor: `%LOCALAPPDATA%\NoktaDestek\tanilama.log`. Bu yalnız **kalıcı modda** oluyor, yani bilgisayar kaydı
  varsa ya da "Bilgilerimi hatırla" açıksa. Kod ile tek seferlik oturumda, süreç yönetici olarak çalışırken veya bir
  sorun yoksa dosya yazılmıyor; iz bırakmama kuralı (AC-108/AC-138) değişmedi. Neden kodu her durumda ekranda görünüyor.
- Kayıtta Windows sürümü, monitör, ekran kartı ve HDR bilgisi, denenen yöntemler, neden kodu ve HRESULT var. Kişisel
  veri, adres, kod ya da anahtar yazılmıyor. Dosya en çok 2 × 128 KB olabiliyor, dolunca dönüyor. Klasör ya da dosya
  bir bağlantı (symlink/junction) ise hiçbir şey yazılmıyor.
- Kayıtlı veri silindiğinde log da siliniyor: "Bu bilgisayarı unut", kayıt yokken "Bilgilerimi unut" ve geçersiz
  kayıt temizliği (kişisel bilgi yoksa).
- BGRA dışı (ör. HDR FP16) yüzeyde DXGI_UNSUPPORTED ile hemen HDR uyumlu yönteme geçiliyor.
- Bağımlılık güvenlik güncellemesi: `golang.org/x/net` v0.62.0 (GO-2026-6866, GO-2026-6860), `golang.org/x/crypto`
  v0.59.0 (GO-2026-5932). Buna bağlı olarak `golang.org/x/sys` v0.50.0 oldu. Yeni modül yok.
- Neden kodunun teknisyen paneline iletilmesi sonraki pakete kaldı (protokol değişikliği gerekiyor).
- Gerçek Windows'ta elle testler (implementation.md "Düzeltme — istemci 0.10.2" adım 1–7) bekliyor; prod öncesi zorunlu.
- Yükseltilmiş (yönetici olarak çalışan) istemcide ayar dosyasının bağlantı/junction denetimi henüz yok (güvenlik Düşük, Sonra).
- Tekrarlanabilir derleme SHA-256: `85142c14bf6941c2d5c3803b2818f0b1645c95b77704e640c8ff49d4059687bc`.

### Düzeltildi — istemci 0.10.1 (Windows; teknisyenden müşteriye dosya alımı)
- Teknisyenin müşteriye gönderdiği dosyalar Windows istemcisinde zaman zaman "Dosya bozuk" sonucuyla
  reddediliyordu (staging'de 270 KB ve 989 KB PNG). Nedeni şuydu: "gönderim bitti" bildirimi, özellikle TURN/relay
  gecikmesinde, son dosya parçalarından önce ulaşıyordu. İstemci artık web alıcısında olduğu gibi son parçaları en çok
  10 sn bekliyor ve parçalar tamamlanınca doğrulamayı yapıyor. Süre dolarsa sonuç yine "Dosya bozuk" olur. Beklerken
  yapılan iptal "İptal edildi" olarak sonuçlanır.
- Tekrarlanabilir derleme SHA-256: `81acc316c58c751eaca3e0bce4536a490aaee5d8ee4313dbcbb2226f573f0284`.

### Eklendi — P8c-2 (Windows istemci 0.10.0: kalıcı istemci / bilgisayar kaydı; ADR-0017, mimari-e10 §8)
- **Bilgisayar kaydı:** başarılı bir oturumda (müşteri ekran paylaşımına onay verdikten sonra) istemci sunucudan bu
  bilgisayar için bir kayıt alır ve mevcut DPAPI dosyasına (`hatirla.bin`, format v2; v1 dosyalar otomatik okunur)
  yazar. Kayıt yalnız talep açar; oturum veya uzaktan erişim yetkisi vermez. Anahtar yalnız kaydı veren sunucuya
  gönderilir.
- **Ana ekran:** "Destek iste" (birincil) + "Bağlantı kodum var" (8 haneli kod; eski "Teknisyenden kod aldım"ın
  yerine) + "Bu bilgisayarı unut" + "Kötüye kullanımı bildir". Kayıtlıysa "Bu bilgisayar <firma>[ – <müşteri>] için
  kayıtlı". Süresi dolmuş `Destek-<kod>.exe` ya da geçersiz firma dosyası kayıt varsa ana ekrana düşer; adında kaynak
  olmayan dosyada kayıt yoksa "Destek iste" pasiftir.
- **Geçersiz kayıt:** açılışta ya da talep gönderirken kayıt geçersizse kayıt silinir (kişisel bilgiler kalır) ve
  "Bu bilgisayarın destek kaydı artık geçerli değil…" gösterilir. "Bu bilgisayarı unut" dosyayı ve boşsa klasörü siler,
  sunucuda kaydı iptal eder. Karşılama ve talep formunda aydınlatma bilgi satırı; oturum sonunda kayıt başka firmaya
  geçtiyse bilgi verilir. Müşteri pasife alındı / kayıt iptal edildi kapanışları genel metinle gösterilir.

### Güvenlik — P8c-2
- Kayıt anahtarı yalnız kaydı veren sunucunun kanonik kökenine (`https://host:port`) gönderilir; farklı kökenli kayıt
  kullanılmaz ve silinmez. Unicode (IDN) sunucu adresiyle derlenen ikilide kayıt özelliği kapalıdır (fail-closed).
- Kayıt yalnız sunucu `BINDING_INVALID` döndüğünde silinir; kodsuz 404 (proxy, geri alınmış sunucu) kaydı korur ve
  "Sunucuya ulaşılamıyor" + "Tekrar dene" gösterir (B-P8c2-1).
- `binding.offer` yalnız oturum aktifken (hello sonrası) işlenir; lobide veya yeniden bağlanırken gelen teklif yok
  sayılır (B-P8c2-2). Kayıt isteği bekleniyorken yalnız kayıt yolunun hata kodları yutulur.
- Tekrarlanabilir derleme SHA-256: `5255edc87840f18b28eb608c705bf2c16230a3a7cb0da49145a46e5ecbf721f3`.

### Bilinen sınırlamalar — P8c-2
- Kayıt isteği gönderilip yanıt gelmeden bağlantı koparsa o oturumda kayıt alınamaz (B-P8c2-4, güvenli taraf; sonraki
  başarılı oturumda alınır).
- Gerçek Windows'ta elle testler (implementation.md "P8c-2" adım 1–16) ve AC-192 staging ölçümü bekliyor.

### Eklendi — P8c-1 (müşteri firmalar ve bilgisayar kaydı: sunucu + panel; ADR-0017, mimari-e10)
- **Müşteriler modülü** (`/customers`, menüde Talepler'den sonra): müşteri firma ekleme/düzenleme, arama (ad, yetkili
  kişi, telefon; büyük/küçük harf ve Türkçe karakter duyarsız), Aktif/Pasif/Tümü filtresi, 50'lik sayfalama. Silme yok;
  **pasife alma** ve **yeniden aktif etme** var. Ad tenant içinde tekildir (409 "Bu adla bir müşteri zaten var").
- Her müşteriye kalıcı indirme bağlantısı ve `NoktaDestek-<etiket>-<ref>.exe` dosyası; "Kopyala" düğmesi. Bu dosyadan
  gelen talepler kuyruğa müşteri firmanın adıyla düşer. **Bağlantıyı yenile** eski dosyaları ve o müşterinin kayıtlı
  bilgisayarlarını geçersiz kılar. "Müşteriye nasıl gönderilir?" yardım penceresi.
- Müşteri detayı: bilgiler, bağlantı, durum işlemleri ve **Talepler / Oturumlar** sekmeleri (25'lik sayfa).
- Firma bağlantısının adı **"Genel bağlantı"** oldu; müşteri atanmamış talepler "Genel" görünür. Müşteriler sayfasında
  Genel bağlantı salt okunur gösterilir.
- **Talepler:** kartta "Müşteri firma" satırı, Tümü / Genel / müşteri filtresi (kuyruk ve Geçmiş), toast metninde firma
  adı. Kayıtlı bilgisayardan gelen talepte "Kayıtlı bilgisayar — <firma | Genel>" rozeti; kart menüsünde
  **"Bu bilgisayarın kaydını iptal et"** (`POST /support-requests/:id/revoke-binding`).
- **Oturum geçmişi:** "Müşteri firma" sütunu, filtresi (müşteri / Müşterisiz) ve CSV sütunu.
- **Yeni Destek Oturumu:** isteğe bağlı "Müşteri firma" seçimi (yalnız aktif müşteriler); talepten doğan oturum talebin
  müşterisini taşır.
- **Bilgisayar kaydı (sunucu):** başarılı oturumda 0.10.0+ istemciye `/ws/guest` üzerinden kayıt verilir
  (`binding.offer` → `binding.request` → `binding.issued`). Public uçlar `POST /public/bindings/status` ve
  `/public/bindings/revoke`; `POST /public/requests` artık `ref` **veya** `bindingKey` kabul eder.
- Yetkiler `customers.view/create/edit/delete` (Admin varsayılan açık, User kapalı; `delete` = pasife alma).
- Audit: `customer.created/updated/ref_rotated/deactivated/reactivated/anonymized`, `binding.issued/revoked/denied`;
  `request.created` += `via`, `customerId`. Metrikler `rs_customers_active`, `rs_bindings_issued_total`,
  `rs_binding_invalid_total`, `rs_bindings_revoked_total`, `rs_binding_denied_total`, `rs_requests_created_total{via}`.
- Migration `20261112120000_p8c_customers` (`customers`, `request_refs`, `device_bindings`; talep ve oturumda
  `customer_id`), yeni aydınlatma metni sürümü (seed).

### Değişti — P8c-1
- İptal nedenlerine `CUSTOMER_PASSIVE` ("Müşteri pasife alındı") ve `BINDING_REVOKED` ("Bilgisayar kaydı iptal
  edildi") eklendi; 0.9.x istemciye `TENANT_PASSIVE` olarak iletilir.
- `POST /sessions` gövdesi isteğe bağlı `customerId` alır.
- Genel bağlantıyı yenilemek tenant'ın Genel kayıtlı bilgisayarlarını da geçersiz kılar.

### Güvenlik — P8c-1
- Kayıt anahtarı (`rsb_…`, 256 bit) sunucuda yalnız SHA-256 özetiyle tutulur; log ve audit'e yazılmaz; yalnız talep açar
  (oturum, TURN, ticket yetkisi vermez). Her başarılı oturumda döndürülür.
- Geçersiz ref ve geçersiz kayıt tek tip 404 döner (`REQUEST_REF_INVALID` / `BINDING_INVALID`), aynı hız kovasına sayılır.
- Kayıt başına 1 bekleyen talep ve saatte 6 talep; bayat kaynaktan (yenilemeden önce açılmış talep, iptal edilmiş kayıt)
  doğan oturuma kayıt verilmez.
- Audit'te yetkili kişi, telefon, e-posta ve not maskelenir. Pasif müşterinin kişisel alanları saklama süresi sonunda
  anonimleştirilir.

### Bilinen sınırlamalar — P8c-1
- Var olmayan müşteri detayı ekranda "Müşteri bulunamadı" gösterir ama HTTP durumu 200'dür.
- "Tümü" filtresinde müşteri yokken boş durum metni filtre değiştirmeyi önerir; boş durumda "Yeni müşteri" düğmesi yok.

### Düzeltildi — talepten doğan oturumda siyah ekran (TURN'süz ilk teklif)
- Sunucu, misafir kabul edildikten sonra teknisyene `ice.servers`'ı `peer.joined`'dan **önce** gönderir; konsol, ICE
  listesi gelmeden teklif üretmez. Farklı NAT'lardaki müşterilerde görüntünün uzun süre siyah kalması giderildi.
  Sözleşme değişmedi.

### Düzeltildi — istemci 0.9.1
- Windows istemcisi GUI alt sistemiyle derlenir (`-H=windowsgui`): açılışta çıkan boş siyah konsol penceresi kalktı
  (0.6.0'dan beri vardı).

### Eklendi — P8b-2 (Windows istemci 0.9.0: müşteri "Destek iste"; ADR-0016, mimari-e9 §13)
- **Firma dosyasıyla açılış:** `NoktaDestek-<firma>-<ref>.exe` açılınca istemci firma bilgisini sunucudan alır
  (`GET /public/requests/tenant`). Pencerede firma adı (yalnız sunucudan), bekleme süresi, dolandırıcılık uyarısı,
  (tanımlıysa) "Kötüye kullanımı bildir" ve alt satırda sunucu · sürüm · parmak izi görünür. Ağ ve sertifika hatası
  ayrı mesaj + "Tekrar dene"; yenilenmiş bağlantının eski dosyası "Bu dosya artık geçerli değil" gösterir.
- **"Destek iste" formu + KVKK:** ad soyad, telefon (TR veya uluslararası), e-posta (isteğe bağlı), sorun; aydınlatma
  metni ve onay kutusu aynı formda. Alan bazında hata, ilk hatalı alana odak, Enter = "Destek iste". Aydınlatma metni
  arada güncellenirse yeniden onay istenir.
- **Hatırla / Bilgilerimi unut:** "Bilgilerimi bu bilgisayarda hatırla" ilk açılışta işaretsiz. İşaretliyse ad,
  telefon ve e-posta yalnız talep oluşunca `%LOCALAPPDATA%\NoktaDestek\hatirla.bin`'e DPAPI ile şifreli yazılır;
  sonraki açılışta form dolu ve kutu işaretli gelir. Hatırlanan ad veya telefon değiştirilirse kutu kendiliğinden
  kalkar (yeni kişinin bilgisi onaysız yazılmaz). "Bilgilerimi unut" dosyayı ve boşsa klasörü siler; silinemezse
  uyarı formda ve bekleme ekranında kalır.
- **Bekleme ekranı:** 6 haneli talep kodu, "Sırada n. talepsiniz", geçen süre (1 sn'de bir). "Talebi iptal et" veya
  pencereyi kapatma talebi iptal eder. Kopmada 110 sn boyunca yeniden bağlanır.
- **Kapanış ekranları:** iptal, zaman aşımı ("Yeniden talep oluştur" formu dolu açar), ret ("Firmanızın mesajı:" +
  düz metin), bağlantı kurulamadı, talep geçersiz.
- **Kabulde "Ekranımı paylaş / Vazgeç":** teknisyen kabul edince onay diyaloğu öne gelir, görev çubuğu yanıp söner;
  teknisyen adı, doğrulama kodu, talep kodu, kalan süre (60 sn). P7 izin kuralları: odak "Vazgeç", 1,5 sn kilit,
  Enter/Space paylaşmaz, uzaktan tıklama sayılmaz.
- **Otomatik bağlanma:** "Ekranımı paylaş" sonrası lobi ve kabul kodu olmadan doğrudan oturuma girilir; sonrası P7
  akışıyla aynıdır (uzaktan kontrol için ayrıca izin).
- **"Teknisyenden kod aldım":** formdan ve engel ekranlarından 8 haneli kod akışına geçiş. `Destek-<8 hane>.exe` ve
  `NoktaDestek.exe` eskisi gibi çalışır.
- **Eski sürüm uyarısı:** `MIN_AGENT_VERSION` altındaki firma dosyası form göstermez; "Bu Hızlı Destek dosyası eski" +
  "Yeni sürümü indir" (`…/request-download?ref=…`, yalnız https). Kod modunda "Teknisyeninizden yeni bağlantı isteyin".
- **503/429 yeniden deneme:** talep oluşturmada yalnız 503 `NOT_READY` en çok bir kez otomatik denenir
  (`Retry-After`, 1–15 sn + 0–1 sn rastgele); ağ hatası ve 502/504 denenmez (talep oluşmuş olabilir). `/ws/request`
  yeniden bağlanması 2→4→8→15 sn artan aralıkla, `Retry-After`'a uyarak (≤ 60 sn) yapılır.

### Güvenlik — P8b-2
- Hatırlanan bilgi DPAPI (CurrentUser) ile şifreli; başka Windows kullanıcısına kopyalanan dosya okunmaz ve silinir.
  `deviceKey` yalnız hatırla açıkken üretilir ve gönderilir; kişi değişince yeni anahtar (S8b2-1).
- Sunucudan gelen metinler (firma adı, teknisyen adı, ret ve hata mesajları) tek süzgeçten geçer: satır sonu, sekme,
  görünmez ve yön değiştiren (bidi) karakterler temizlenir (S8b2-3). Ret mesajı bağlantı değil, düz metindir.
- Açık onay diyaloğuna farklı teknisyen adıyla yeni kabul gelirse diyalog kapatılıp yeniden açılır, 1,5 sn kilit
  yeniden başlar.
- "Yeni sürümü indir" yalnız `https://` adres açar. Onay süresi dolunca soket 1001 ile kapanır (sunucu "Müşteri
  bağlanamadı" yazar, "vazgeçti" değil).

### Güvenlik — P8b-2 (düzeltme turu 2)
- S8b2-4: onay diyaloğu teknisyen adı + doğrulama koduyla eşleşir; kod değişirse diyalog yeniden açılır ve 1,5 sn kilit
  yeniden başlar. Kopmadan sonraki ilk yeniden bağlanmaya 0–1 sn rastgele bekleme eklendi.

### Bilinen sınırlamalar — P8b-2
- Gerçek Windows'ta elle testler (Win10/Win11, implementation.md "Backend (Go) P8b-2" adım 1–20 + a–c) yapılmadı.
- Firma logosu henüz sunucudan gelmez; pencerelerde Nokta Bilişim logosu görünür.
- S8b-8'in sunucu yarısı (503'te IP kovası iadesi) ve S8b2-2'nin sunucu yarısı (güvenilen ağı `/ws/request` hız
  kovasından muaf tutma) açık.
- `MIN_AGENT_VERSION=0.9.0` müşterilerin tamamı 0.9.0 firma dosyasına geçene kadar açılmamalıdır.

### Eklendi — P8b-1 (müşteri destek talebi: sunucu + panel; ADR-0016)
- **Müşteri başlatmalı destek talebi (sunucu):** müşteri, firmaya özel Hızlı Destek dosyasından ad, telefon, isteğe
  bağlı e-posta ve açıklamayla talep gönderir; talep o firmanın kuyruğuna düşer. Public uçlar
  `GET /api/v1/public/requests/tenant`, `POST /api/v1/public/requests`, `POST /api/v1/public/requests/cancel`,
  `GET /api/v1/public/agent/request-download`; bekleme kanalı `/ws/request`. Talep durumları: Bekliyor, Kabul edildi,
  İptal, Süresi doldu, Reddedildi, Bağlanamadı. Her talep KVKK onayını (metin sürümü + SHA-256) ayrı kaydeder.
- **Talep kodu (6 hane) ve kaynak işaretleri:** kartta müşterinin ekranındakiyle aynı kod; "Güvenilen ağ",
  "Bu ağdan daha önce oturum yapıldı", "Bu bilgisayar daha önce destek aldı" rozetleri; hiçbiri yoksa "İlk kez görülen
  kaynak" uyarısı. Kartta kalıcı ipucu: müşteriyi firmanın kayıtlı numarasından arayıp talep kodunu sorun.
- **Panel — "Talepler" (`/requests`, yetki `support_requests.view`):** canlı kuyruk (`/ws/panel`), menüde bekleyen
  sayısı rozeti, yeni talepte bildirim ("Görüntüle") ve ses (aç/kapa, tarayıcıda saklanır), "Kabul et" → doğrudan
  konsola geçiş, "Reddet" → hazır veya kendi mesajı (bağlantı/e-posta/telefon içeremez). "Geçmiş" sekmesi son 30 günün
  kapanan taleplerini durum filtresiyle gösterir. Kabul/ret için `support_requests.accept` + `view` gerekir; Super Admin
  seçili firmada kuyruğu görür, kabul/ret yapamaz.
- **Panel — "Ayarlar > Destek talepleri" (`/settings/support-requests`, `settings.edit`):** firma indirme bağlantısı
  (kopyala, onaylı "Bağlantıyı yenile"), bekleme süresi 10–120 dk (varsayılan 30), WhatsApp bildirimi (≤ 5 alıcı,
  "Test mesajı gönder"), güvenilen IP/ağlar (≤ 10; IPv4 en geniş /16, IPv6 en geniş /32). E-posta bildirimi pasif (P10).
- **Firma dosyası:** `NoktaDestek-<firma kısa adı>-<ref>.exe` (Caddy `@agentExeFirm`, aynı imzasız ikili, aynı SHA-256);
  ref ve firma adı Caddy/nginx loglarında maskelenir.
- **WhatsApp bildirimi:** kişisel veri içermeyen şablon ("Yeni destek talebi – <firma> – panelde görüntüleyin. Talep
  kodu: …" + panel bağlantısı); 3 deneme, 8 sn zaman aşımı; tenant 30/sa, alıcı 10/sa, sistem 300/sa (aşımda özet).
  Production'da şifresiz ve genel adresli servis kanalı kapalı başlatılır (`alarm:"whatsapp_insecure"`).
- **Oturum geçmişi ekleri:** "Kaynak" filtresi (Talep/Teknisyen), listede "Talep" hapı ve bekleme süresi, ayrıntıda
  "Destek talebi" bölümü; CSV'ye `Kaynak` ve `Bekleme` sütunları (telefon ve açıklama CSV'ye girmez).
- **Hız sınırları ve kuyruk koruması:** IP, ağ öneki, IPv6 /48 ve firma kovaları; IP başına 3, ağ başına 10, firma
  başına 50 bekleyen talep; 40 bekleyenden sonra bilinmeyen kaynak reddi (`QUEUE_FULL`). Olağan dışı yoğunlukta panelde
  uyarı bandı (`queue.alert`).
- **Asgari istemci sürümü:** `MIN_AGENT_VERSION` doluysa eski istemci 426 `CLIENT_OUTDATED` alır (talep, resolve,
  join, `/ws/guest`, `/ws/request`).
- **Yeni ortam değişkenleri:** `WHATSAPP_SERVICE_URL`, `MIN_AGENT_VERSION` (ikisi de boş bırakılabilir).
- **Veritabanı:** migration `20261112000000_p8b_support_requests` (`tenant_request_settings`, `support_requests`,
  `support_sessions`/`session_consents` ekleri); seed yeni sistem aydınlatma sürümü ekler. Talep kişisel verisi
  saklama süresi sonunda anonimleştirilir (gece 00:30 UTC işi).
- **Metrik ve alarmlar:** `rs_request_ref_invalid_total`, `rs_request_notify_total`, `rs_request_rate_limited_total`,
  `rs_requests_pending`, `rs_ws_connections{role}`, `rs_request_gate_rejected_total{reason}`; log alarmları
  `db_busy`, `request_gate_busy`, `auth_fail_counter_fallback`, `auth_fail_unrecorded` (runbook §12.5).

### Değişti — P8b-1
- **Aşırı yükte 500 yerine 503:** geçici DB çekişmesi (TX başlatılamadı, deadlock, kilit bekleme, havuz zaman aşımı)
  artık her uçta 503 `NOT_READY` + `Retry-After: 5` döner; yazma geri alındığından yeniden deneme güvenlidir.
- **Talep oluşturma kapısı:** eşzamanlı talep işlemleri anahtar başına 2, toplam 4 ile sınırlı; DB havuzunun en az 6
  bağlantısı giriş, panel ve WS için kalır. Kapı dolunca 503 + `Retry-After`.
- **Hesap kilidi:** başarısız giriş sayacı DB'ye yazılamazsa bellek içi yedek kova kullanılır (kilit yine uygulanır);
  audit yazılamazsa yanıt 401/423 kalır, `auth_fail_unrecorded` alarmı düşer.
- CSV başlığı genişledi (`Mod`'dan sonra `Kaynak`, `Bekleme`).
- Çıkış ve şifre değişimi açık `/ws/panel` soketlerini anında kapatır (4401).

### Güvenlik — P8b-1
- WhatsApp istemcisi yönlendirme izlemez (`redirect: "error"`, S8b-1).
- Talepten doğan oturumda eşzamanlı iki misafir bağlantısı yarışı kapatıldı (S8b-2); `request.created` audit'inde
  yalnız istemci sürümü, `guest.admitted`'da ad yok (S8b-3, QA-P8b-11).
- Kabul/ret uçları `view` + `accept` ister (AC-147); Super Admin ret 403 (AC-148).
- Caddy logunda `Sec-WebSocket-Protocol` başlığının 101 yanıtındaki yazımı da siliniyor (önceden etkisizdi; sızıntı
  yoktu).

### Düzeltildi
- **P7 kontrol konsolu (QA-P8b-13):** "Vazgeç"ten hemen sonra yeniden "Kontrol iste" denince geç gelen eski onay yeni
  isteği yerelde bitiriyor, "Vazgeç" düğmesi kayboluyordu. İstek bekleme fazında eski onay artık yok sayılır.
- **Diyalog yarışı:** kapanan diyaloğun gecikmiş "close" olayı hemen yeniden açılan diyaloğu kapatıyordu (geçmiş
  ayrıntısında "Sayfada kal" + ikinci geri tuşu). `onClose` yalnız diyalog gerçekten kapalıyken çağrılır.

### Bilinen sınırlamalar — P8b-1
- Müşteri tarafı (Hızlı Destek'te "Destek iste" formu ve bekleme ekranı) istemci 0.9.0 (P8b-2) ile geldi;
  `MIN_AGENT_VERSION` müşterilerin tamamı 0.9.0'a geçene kadar boş kalmalıdır.
- AC-149 (talep → panel bildirimi ≤ 3 sn) yalnız yerelde ölçüldü; staging ölçümü yayın sonrası.
- E-posta bildirimi P10'da. Kara liste (G-E9-17) "Sonra".
- 503 sonrası yeniden deneyen müşteri IP kovasını tüketir (S8b-8); istemci yarısı 0.9.0'da sınırlandı, sunucu yarısı açık.

## [0.8.2] — 2026-11-12 — Staging alan adı + Windows istemci

### Eklendi
- **Staging alan adı `https://remote.noktabilisim.net`** (ADR-0015): host nginx (Let's Encrypt) TLS'i sonlandırır,
  Caddy yalnız `127.0.0.1:4451`'de dinler. `https://185.126.217.99:4450` geçiş süresince çalışmaya devam eder.

### Değişti
- **Windows istemci 0.8.2:** yeni adres gömülü; kök sertifika kurulumu gerekmez. IP:4450 gömülü eski istemciler
  (≤ 0.8.1) çalışmaya devam eder, onlar için kök sertifika gerekir.
- gitleaks: RFC 6455 örnek WebSocket anahtarı istisnası; runbook rastgele anahtar kullanır.

## [0.8.1] — 2026-11-12 — Windows istemci

### Değişti
- **Windows istemci — izin diyalogları (kontrol, ekran değiştirme, dosya kabulü):** uzak bağlantı veya yazılım
  üzerinden gelen (enjekte) tıklama artık sessizce yok sayılmıyor; diyalogda bir kez kırmızı uyarı satırı gösterilir
  ("Bu tıklama uzak bağlantı veya yazılım üzerinden geldiği için kabul edilmedi…"). Diyalog açık kalır, izin yine
  verilmez; düğmeler aşağı kaydığı için 1,5 sn kilit yeniden başlar. Güvenlik kuralı değişmedi.

## [0.8.0] — 2026-11-11 — P8 (oturum geçmişi)

### Eklendi — P8
- **Oturum geçmişi ekranı `/history`** (kenar menüsünde "Oturum geçmişi", yetki `session_history.view`): tarih aralığı
  (Türkiye saatiyle gün), durum, bağlantı (İstemci/Tarayıcı), teknisyen, müşteri adı ve (yalnız Super Admin) firma
  filtreleri; sayfa başına 10/25/50/100 kayıt; filtreler adres çubuğunda kalır, sayfa yenilense de korunur. Bağlantıdaki
  geçersiz filtre yok sayılır ve uyarı gösterilir. 390 px'te tablo yerine kart listesi.
- **Oturum ayrıntısı `/history/[id]`:** özet (oluşturma, başlangıç, bitiş, süre, bağlantı, teknisyen, müşteri adı ve
  e-postası, sonlandıran, bitiş nedeni), onay kayıtları (KVKK metin sürümüyle), uzaktan kontrol dönemleri (kim, ne zaman,
  hangi yolla kapattı; müşteri istemcisi yönetici olarak çalışıyorsa uyarı rozeti), zaman çizelgesi (en çok 500 olay),
  kalite özeti ve dosya aktarım kayıtları (içerik değil, meta veri).
- **Ticket no ve not** (yetki `session_history.edit`): ticket en çok 50, not en çok 4.000 karakter; sayaç, alan
  hataları, kaydedilmemiş değişiklik uyarısı. Her oturum durumunda düzenlenebilir.
- **CSV dışa aktarma** (yetki `session_history.export`): filtrelenmiş liste, UTF-8 BOM, `;` ayraç, Türkiye saati,
  Türkçe etiketler; Excel (tr-TR) dosyayı çift tıklayınca sütunlara ayırır. En çok 50.000 satır, kullanıcı başına
  dakikada 5 dışa aktarma.
- **API:** `GET /api/v1/sessions` yeni filtreler (`mode`, `from`, `to`, `tenantId`, `customer`, `sort`) ve yeni alanlar
  (`mode`, `startedAt`, `durationSec`, `customerName`, `ticketNo`, `tenant`); `GET /api/v1/sessions/:id/history`;
  `PATCH /api/v1/sessions/:id`; `GET /api/v1/sessions/export.csv`. Ayrıntı `docs/api.md` "Oturum geçmişi (P8)".
- Enum → Türkçe etiket eşlemesi tek yerde: `packages/contracts/src/labels.ts` (ekran ve CSV aynı etiketi kullanır;
  bilinmeyen değer ham gösterilir). CSV yazıcı `apps/server/src/lib/csv.ts` (P11 audit CSV'si de kullanacak).
- **Windows istemci — fare imleci:** müşterinin imleci (şekli dahil: ok, metin imleci, el, yeniden boyutlandırma,
  meşgul, ters renkli şemalar) görüntüye çizilir. Ekran durgunken de fare hareketi yeni kare üretir. İmleç başka
  monitöre geçince görüntüden kaybolur. Sunucu, konsol ve protokol değişmedi.
- **Migration `20261111060000_p8_session_history`:** `support_sessions` += `customer_name`, `customer_email`,
  `ticket_no`, `note` (CHECK'li) ve üç indeks (`support_sessions(tenant_id, status, created_at)`,
  `support_sessions(created_at)`, `audit_logs(tenant_id, entity, entity_id, created_at)`). Müşteri adı ve e-postası
  kabul anında aynı atomik UPDATE'te yazılır. P8 öncesi oturumlarda ad geri doldurulmadı ("Ad kaydı yok").
- **Migration `20261111070000_enum_check_binary` (ADR-0014):** 14 enum CHECK `CAST(col AS BINARY) IN (…)` biçimine
  çevrildi; harf, aksan ve sondaki boşluk farkı artık DB'de reddedilir (`'tech'`, `'TECH '`). Kanonik olmayan satır
  varsa migration hiçbir şey değiştirmeden 3819 ile durur. Yayından önce salt okunur ön kontrol: `docs/runbook.md` §6.1.
- Audit: `session.updated` (`{ ticketNo, noteLength }`; not metni yazılmaz), `session.exported` (filtreler, satır
  sayısı; müşteri arama metni yazılmaz, yalnız `customerFilter: true|false`).

### Değişti — P8
- `GET /api/v1/sessions` artık `sessions.view` **veya** `session_history.view` ile çağrılabilir; bilinmeyen sorgu
  parametresi 400 döner. Liste, `:id`, `:id/history`, PATCH ve CSV tek kapsam fonksiyonunu (`historyScope`) kullanır.
- Super Admin firma seçmeden bu beş uçta tüm firmaların oturumlarını görür (yanıtta ve CSV'de "Firma" sütunu). Diğer
  uçlarda firma seçimi zorunluluğu değişmedi.
- Müşteri adı uzunluğu karakter (kod noktası) olarak sayılır (2–100): tek emoji ad olarak reddedilir, 100 emoji
  kabul edilir (QA-P8-2).
- Notta CRLF satır sonu LF'e çevrilerek kaydedilir.
- Dar ekranda kenar menüsü yatay kaydırılabilir.
- P5 AC-39 axe e2e kararsızlığı giderildi: tarama aynı sekmede tek enjeksiyonla yapılıyor, test ikiye bölündü
  (yük altında 40/40 geçti).

### Güvenlik — P8
- **IDOR (AC-61, G-22):** kapsam dışı veya olmayan oturum her uçta 404; USER'ın gönderdiği `technicianId` ve Super Admin
  olmayanın gönderdiği `tenantId` kapsamı genişletemez. Tüm-tenant kapsamını yalnız `historyScope` üretebilir (markalı tip).
- **Veri en aza indirme:** liste e-posta ve not içermez; detay API'si onay kayıtlarının IP ve tarayıcı bilgisini
  döndürmez; zaman çizelgesi ham audit değeri değil, eylem başına izinli alanları döndürür.
- **S8-1 (CSV formül enjeksiyonu, AC-124):** `= + - @`, TAB ve CR ile başlayan hücreye `'` eklenir; baştaki boşluk,
  NBSP, ideografik boşluk ve tam genişlikli `＝ ＋ － ＠` de yakalanır. Ardından RFC 4180 tırnaklama.
- **S8-2:** bekleyen oturumun 8 haneli kodu (`code`) yalnız oturumun kendi teknisyenine döner; ADMIN ve Super Admin
  `null` görür.
- **S8-3:** `customer` filtresiyle liste isteği kullanıcı başına dakikada 60 (aşılınca 429 + `Retry-After`).
- **S8-4:** ADR-0014 ön kontrolü runbook'a yazıldı (§6.1).
- Müşteri arama metni log ve audit'e girmez; `ticketNo` audit maskesinden çıkarıldı (gizli değer değil; `wsTicket`
  maskeli kalır).

### Bilinen sınırlamalar — P8
- Teknisyen ve firma filtresinin seçenekleri o sayfadaki kayıtlardan gelir; tam kullanıcı/firma listesi P9'da.
- Detayda Dosyalar tablosu dar: uzun dosya adı satır satır kırılır, SHA-256 sütunu kesik görünür (TEST-P8-1). Super
  Admin listesi 1280 px'te tabloyu 17 px aşar (TEST-P8-2).
- Kaydedilmemiş not varken tarayıcının geri tuşu (uygulama içi gezinme) uyarı vermez; menü bağlantısı ve sayfa
  yenileme uyarır.
- CSV'nin Excel'de açılışı dosya yapısıyla doğrulandı (BOM, `;`, RFC 4180, strict ayrıştırmada sabit sütun sayısı);
  Excel'de elle açma kontrolü kullanıcıda.
- Fare imleci ve P6/P7 istemci özellikleri gerçek Windows'ta elle doğrulanmadı (implementation.md adım 25–47).

## P2–P7 (sürüm etiketi yok; P7 istemcisi 0.7.0)

### Eklendi — P7 (uzaktan kontrol)
- **WS sözleşmesi (`packages/contracts/src/ws.ts`, ADR-0013, mimari-protokol §3/§3.3):** teknisyen → `control.request`,
  `control.cancel`, `control.release`, `monitor.request`; misafir (yalnız Hızlı Destek) → `control.state`,
  `monitor.denied`, `env.state{elevatedForeground, secureDesktop, selfElevated}`; sunucu → misafire `control.revoke`
  (`permission|audit|admin|reconnect|stale`), `caps.update`; teknisyene sunucu kaynaklı `control.state`
  (`SYSTEM|RECONNECT|TECH`). `error.code` kümesine `INTERNAL` eklendi.
- **`input` DataChannel (`src/dc.ts`):** `m.move`, `m.btn`, `m.wheel` (±1200), `k` (`code` `^[A-Za-z0-9]{1,32}$`,
  `key` ≤ 4), `k.release_all`; örnekler `fixtures/dc-input.json` (TS ve Go aynı fixture'la test edilir).
- **Sunucu (`apps/server/src/signaling/control.ts`):** istek süzgeci (sıra: yetki → misafir bağlı → tarayıcı modu →
  bekleyen istek → açık kontrol → ret sonrası 30 sn → oturum başına 5 istek); monitör isteği için ayrı sayaç, tek
  bekleyen istek, etkin monitör `VALIDATION`; misafir/teknisyen kopması, sekme değişimi ve oturum sonunda kontrolün
  kapatılması; 60 sn teknisyen yeniden doğrulamasında yetki daralması → `caps.update` + `control.revoke{permission}`
  (S-P3-8 / AC-115 yedek yolu). Audit adları tek kaynak `packages/contracts/src/audit.ts` (`control.requested/granted/
  denied/revoked/released/cancelled`, `monitor.requested/granted/denied`, `session.caps_changed`). Metrik
  `rs_control_total{event}`.
- **Windows istemci (`apps/agent-win`):** izin kapısı (`internal/control`, varsayılan kapalı, her `SendInput`'tan önce
  atomik denetim); ortak izin diyaloğu (kontrol, monitör, dosya kabulü: "Reddet" odakta, "İzin ver" 1,5 sn kilitli,
  Enter/Space izin vermez, imleç altında açılmaz, enjekte girdi yok sayılır); "Kontrolü kapat" ve global kısayol
  Ctrl+Shift+F12 (yedek Ctrl+Shift+F11; ikisi de alınamazsa izin verilemez); girdi uygulayıcı (`internal/input`:
  Türkçe karakterler `KEYEVENTF_UNICODE`, kısayollar VK, Ctrl+Alt+Del ve Win+L engelli, çoklu monitör/sanal masaüstü
  koordinatı, kapanışta takılı tuş bırakma, 250 olay/sn sınırı); yerel öncelik (müşteri girdisi uzaktan girdiyi ~1 sn
  askıya alır); ortam izleyici (`internal/env`: yükseltilmiş ön plan penceresi, güvenli masaüstü, istemcinin yönetici
  olarak çalışması); gösterge "Uzaktan kontrol aktif — <ad>".
- **Konsol (`/sessions/[id]/console`):** Kontrol iste / Kontrol bekleniyor + Vazgeç / Kontrol sizde + Kontrolü bırak /
  Kontrole devam; ret geri sayımı ve kalan hak (sekme yenilense de korunur); Özel tuşlar menüsü; Ctrl+Alt+Shift ile
  klavye odağından çıkış; tam ekranda Keyboard Lock; monitör seçimi (onay bekleme, ret, yanıtsızlık geri sayımı);
  yükseltilmiş pencere / güvenli masaüstü / yönetici olarak çalışan istemci uyarıları; kırmızı kontrol çerçevesi.
  Kontrol sırasında işaretleme pasif. `remote_control.use` yoksa düğme görünmez.
- **Migration `20261111050000_p7_consent_source_tech`:** `session_consents_source_chk` += `TECH` (yeni tablo/sütun yok).
  P7 server'ından önce uygulanmalı; geri alma için önce P7 kodu, `TECH` satırı varsa `down.sql` atomik başarısız olur.

### Değişti — P7
- Konsol "%100" görünümü artık müşteri monitörünün piksel boyutunda (1:1) çizilir; önceden düşük çözünürlüklü akışta
  tıklamalar kayıyordu (TEST-P7-1).
- Sahne 960 px'ten darsa monitör seçimi, Sığdır/%100 ve Tam ekran **Görünüm** menüsünde toplanır; kontrol şeridi
  1280 px'te tek satır (TEST-P7-2). Yeni primitif `components/ui/menu.tsx`; `ui/segmented.tsx`'e `disabled`.
- İşaretleme araç çubuğu ve görüntü kontrolleri görüntünün üstünden sahnenin üst şeridine taşındı.
- P5 dosya kabul diyaloğu (istemci) ortak izin diyaloğuna taşındı: "Kabul et" enjekte tıklamayla verilemez.
- Müşteri kopunca bekleyen monitör isteği temizlenir; yeniden bağlanan istemcinin ilk `share.state`'i onay sayılmaz (S7-15).

### Güvenlik — P7
- **Fail-closed açma (G-15, AC-111):** `control.granted` kaydı (consent + audit tek TX) hata verir ya da 800 ms'de
  bitmezse misafire `control.revoke{audit}`, teknisyene `error{INTERNAL}` (ref ile); kontrol açılmaz.
- **S7-1/S7-2 (ADR-0013 K1/K2):** "Kontrolü bırak" müşteri kapısını kapatır; vazgeçilen isteğin geç onayı
  `control.revoke{stale}` ile düşer; konsol beklemediği izinde yakalama başlatmaz.
- **S7-4 (K3):** teknisyen koptuğunda veya sekme değiştiğinde misafire önce `control.revoke{reconnect}`; istemci
  `peer.left/joined{tech}` ile de kapatır (iki katman).
- **S7-3/S7-16:** kısayol kapatması kanca iş parçacığını bloklamaz; kapı nesil sayacıyla bayat kanca kaldırma isteği
  yeni açılışı etkilemez.
- **S7-5/S7-12:** izin diyaloğu girdinin kaynağını `GetCurrentInputMessageSource` ile denetler; yalnız
  `IMO_HARDWARE` kabul, diğer her durum enjekte sayılır.
- **S7-7:** düşük seviye kancalar yalnız kontrol açıkken kurulu. **S7-8/S7-13:** girdi hız sınırı; yalnız basılı
  tuş/düğmenin bırakılması sınırdan muaf.
- **S7-9 (K8):** istemci yönetici olarak çalışıyorsa müşteriye kırmızı uyarı, konsola rozet; GRANTED audit'inde
  `selfElevated`.
- **S7-10:** misafir `RECONNECT`/`TECH` kaynağı gönderemez (şema hatası → 1008).

### Bilinen sınırlamalar — P7
- Gerçek Windows'ta elle doğrulama (implementation.md "Agent P7" adım 25–42: Türkçe karakter, Alt+Tab, DPI, UAC,
  kısayol, enjekte tıklama) henüz yapılmadı; P8 kod turundan önce yapılacak.
- UIAccess yetkili yerel bir programın `SendInput`'u donanım girdisi gibi görünür; teknisyen bu yolu kullanamaz,
  kapsam dışı kabul edildi.
- Fare imleci görüntüye çizilmez; teknisyen yalnız kendi imlecini görür (P8 istemcisinde çizilir).
- Yetki kaldırma ekranı P9'da gelir; bugün yetki değişikliği en geç 60 sn'lik yeniden doğrulamada kontrolü keser
  (AC-115'in 5 sn hedefi P9/P10 servislerinin doğrudan çağrısıyla sağlanacak, S7-11).
- Monitör isteği için iptal mesajı yok; yanıtsız istek 30 sn sonra düşer.

### Eklendi — P6 (Windows istemci "Hızlı Destek")
- **Windows istemci (`apps/agent-win`, Go 1.26, CGO'suz, ADR-0010):** tek dosya, kurulumsuz, `asInvoker` (UAC yok),
  PerMonitorV2 DPI, Türkçe Win32 arayüz. Sunucu adresi ve sürüm yalnız `-ldflags` ile gömülür; `https://host[:port]`
  dışı adres reddedilir (AC-109). Pencere alt satırında sunucu, sürüm ve parmak izi (exe SHA-256'sının ilk 8 hanesi,
  `SHA256SUMS` ile aynı; AC-128).
- **Kod (AC-27, 97):** kod `Destek-<8 hane>.exe` dosya adından (tarayıcının ` (1)` eki dahil) okunur; okunamazsa
  elle giriş ("1234 5678", "1234-5678" kabul).
- **Karşılama (AC-98, 125):** firma ve teknisyen adı, teknisyen doğrulama kodu, bağlanılan sunucu, dolandırıcılık
  uyarısı, "Kötüye kullanımı bildir" (`mailto:`, yalnız geçerli `abuseEmail`), KVKK metni + ad + onay kutusu; ad ve onay
  olmadan "Bağlan" pasif. Logo yalnız gömülü sunucu kökeninden, PNG/JPEG, ≤ 2 MB, ≤ 2048 px kabul edilir; yoksa
  Nokta amblemi.
- **Akış (AC-24, 106, 107, 112):** resolve (`clientKind=AGENT`, Origin'siz) → join → `/ws/guest` (ticket subprotocol) →
  bekleme odası (4 haneli kabul kodu, "Vazgeç ve çık") → ekran seçimi (birden çok monitörde) → oturum. Kopuşta 120 sn
  `reconnectToken` ile yeniden bağlanma, her seferinde yeni PeerConnection. Bitişte son ekran ve ~2,5 sn sonra kapanış.
- **Görüntü (AC-41):** DXGI Desktop Duplication → BGRA→NV12 (CPU, BT.601) → Media Foundation H.264 (önce donanım,
  olmazsa yazılım MFT), Constrained Baseline, en çok 1920×1080, hedef 30 fps / alt sınır 15 fps, CBR, GOP 2 sn,
  PLI/FIR'de ≤ 500 ms içinde anahtar kare. Ekran döndürme desteklenir. Güvenli Masaüstü/kilit/çözünürlük değişiminde
  yakalama 250 ms → 2 sn geri çekilmeyle kendiliğinden yeniden açılır.
- **Gösterge ve işaretleme (AC-37, 56, 103):** paylaşılan her monitörde kırmızı kenarlık + "Ekranınız izleniyor —
  <teknisyen>", saniyede bir en üste alınır; teknisyenin kalem/ok/dikdörtgen/lazer çizimleri tıklama geçirgen katmanda.
  İkisi de `WDA_EXCLUDEFROMCAPTURE` ile görüntüye girmez.
- **Sohbet ve dosya alma (AC-35, 36, 53–55, 117, 119):** iki yönlü sohbet (okunmamış sayacı başlıkta); teknisyenden
  gelen dosya için kabul diyaloğu ("Reddet" odakta, "Kabul et" 1,5 sn kilitli, Enter/Space Kabul'e ulaşmaz),
  tehlikeli/çift uzantı uyarısı, ret sonrası 30 sn otomatik ret. Dosya `İndirilenler`'e `.part` olarak yazılır, alınan
  bayta göre sınır, SHA-256 doğrulaması, MOTW (`ZoneId=3`), üzerine yazmadan ` (n)` adlandırma.
- **İz bırakmama ve DLL güvenliği (AC-108, 118):** %TEMP%/AppData/kayıt defterine yazım yok; yarım `.part` oturum
  sonunda silinir. İlk iş `SetDefaultDllDirectories(System32)`. İz testi betiği `apps/agent-win/test/trace-check.ps1`
  (Snapshot / Compare / Check; çıkış 0/1/2).
- **İndirme ucu (sunucu, AC-27, 96):** `GET /api/v1/public/agent/download?ref=<sessionRef>` → 302
  `/downloads/Destek-<kod>.exe`; yalnız PENDING ve süresi dolmamış oturumda. 404/410/429/503, `Cache-Control: no-store`.
  Ref ve kod log/audit'e yazılmaz. `AgentBinary`: volume'daki ikilinin SHA-256'sı `AGENT_SHA256` ile eşleşmedikçe 503.
- **İç uç `GET /internal/agent-ready`** (204/503): Caddy `forward_auth` ile `/downloads/*.exe` sunulmadan önce çağırır.
- **Caddy:** `/downloads/{NoktaDestek,Destek-<8 hane>}.exe` aynı ikiliyi `Content-Disposition: attachment` ile sunar;
  diğer `/downloads/*` 404.
- **Web (AC-27):** Windows masaüstünde müşteri karşılama sayfasında birincil "Hızlı Destek uygulamasını indir" ve
  hemen altında SmartScreen rehberi (4 adım, "Ek bilgi → Yine de çalıştır", BT yöneticisi için SHA256SUMS notu).
  Tarayıcı yolu ikincil: "Uygulama çalışmıyor mu? Tarayıcıdan yalnızca görüntü paylaş". 503'te "Tarayıcıdan devam et",
  429'da bekleme süresi. macOS/Linux/mobilde indirme gösterilmez.
- **CI/yayın (AC-94, 96, 128, G-07):** `.github/workflows/agent-win.yml` (gofmt, `go mod verify`, vet, `go test -race`,
  govulncheck, go-licenses; Windows runner'da `go test` + iz testi; iki ayrı runner'da derleme ve hash eşitliği,
  `SHA256SUMS`, build attestation, `v*` etiketinde onaylı Release), `agent-watch.yml` (günlük dış hash gözcüsü +
  govulncheck), Dependabot `gomod`. `deploy/agent/verify-and-publish.sh` operatör makinesinde doğrular ve yayınlar.
- Yeni ortam değişkenleri: `AGENT_SHA256`, `AGENT_BINARY_PATH`. Compose: `agent_downloads` volume'u. Runbook §11.

### Değişti — P6
- `packages/contracts/src/files.ts` `DANGEROUS_EXT`: `one onepkg wsc sct diagcab website ade adp mde mshxml jnlp cab`
  eklendi (S6-8); Go listesi testle birebir eşlenir.
- Resolve kod yolundaki kilit kontrolü ve başarısız sayım ortak fonksiyonlara alındı (`assertLookupAllowed`,
  `countFailedLookup`); indirme ucu aynı kovaları kullanır. Davranış değişmedi.
- Logger redaksiyonuna `*.ref` eklendi.
- `docs/mimari-api.md`: 302 hedefi `/downloads/Destek-<8 hane>.exe` (tarayıcılar 3xx'teki `Content-Disposition`'ı yok
  sayar); iç uç satırı. ADR-0004 r2 (%TEMP% yazımı yok, İndirilenler + `.part`), ADR-0006 r3, ADR-0010 r3 (proxy).

### Güvenlik — P6
- **S6-1:** Win32/COM çağrılarında `uintptr(unsafe.Pointer)` dönüşümleri yalnız çağrı argümanında; `//go:uintptrescapes`
  zorunlu. AST testi tüm modülü tarar.
- **S6-2:** `/downloads/*` artık sunulmadan önce server bütünlük kapısından geçer (`forward_auth`); server erişilemezse
  502, uyuşmazlıkta 503 (fail-closed). `/internal/*` dışarıya 404; iç uç yalnız güvenilen proxy soketinden ve
  `X-Forwarded-Method` ile yanıt verir (XFF taklidi testle reddedilir).
- **S6-3:** MOTW yeniden adlandırmadan önce `.part`'a yazılır; `MoveFileEx` değiştirme bayrağı olmadan. MOTW yazılamazsa
  (ör. FAT32/exFAT) program çalıştırabilen dosya kaydedilmez.
- **S6-4/S6-5:** PR ve elle tetiklenen derlemelere yer tutucu adres gömülür; başarısız CI koşusunun artifact'i
  yayınlanmaz (yalnız staging'de açık `--allow-failed-run`), attestation'sız yayın yalnız `ALLOW_UNATTESTED=staging` ile.
- **S6-7:** uzak ICE kuyruğu 64 ile sınırlı; `abuseEmail` biçim ve uzunluk denetiminden geçmezse bağlantı gizlenir.
- **S6-9 (G-10):** Caddy hata logu da (default logger) sorgu dizesini, `/session/***` ve `/downloads/Destek-***`
  yollarını maskeler.
- **N6-1:** ikili bütünlük önbelleği anahtarına `ctime` eklendi (mtime geri alınsa da yeniden hesaplanır).
- Go 1.26.11 + `golang.org/x/net` v0.60.0: govulncheck 0 erişilebilir zafiyet.

### Düzeltildi — P6 (QA)
- **QA-P6-1:** karşılamada logo (firma logosu / Nokta amblemi) eklendi.
- **QA-P6-2:** iz testi betiği ve CI adımı eklendi.
- **QA-P6-3:** web karşılamada indirme seçeneği ve SmartScreen rehberi (AC-27).
- **QA-P6-4:** MOTW, DLL sertleştirme ve yeniden adlandırma için Windows'a özgü testler (CI `test-windows`).
- **QA-P6-5:** `mimari-api.md` ve ADR'ler kodla eşitlendi.

### Bilinen sınırlamalar — P6
- Firma logosu: sunucu resolve yanıtında `logoUrl` değerini P9'a kadar `null` döner; istemci sistem logosunu (Nokta
  amblemi) gösterir.
- Fare imleci görüntüye çizilmez; teknisyen müşterinin imlecini göremez.
- Uzaktan kontrol yok (P7'de eklendi). Web indirme kartındaki "siz izin verirseniz fare ve klavyeyi kullanabilir"
  metni P7 davranışını anlatır.
- İstemci müşteriden teknisyene dosya göndermez; dosya kaydetme yeri sorulmaz (her zaman İndirilenler).
- İstemci arayüzü yalnız açık temadadır (koyu tema yok).
- Win10 2004 öncesinde gösterge ve işaretleme görüntüde görünebilir.
- Donanım kodlayıcı çalışma sırasında hata verirse yazılım kodlayıcıya otomatik geçiş yok; COM/Media Foundation
  davranışı gerçek donanımda elle test edilir (runbook §11.8).
- İmzasız dağıtım: SmartScreen ilk açılışta uyarır. Repo private iken attestation üretilemez; prod (P10) öncesi repo
  public yapılmalı.
- Oturum ortasında gelen `peer.joined.maxFileMb` alım sınırını güncellemez; `caps.update`/`control.*` WS tipleri P7'de.

### Eklendi — P5 (konsol işbirliği)
- **Teknisyen konsolu yan paneli:** Sohbet / Dosyalar / Kalite (`collab-side`); sahnede işaretleme araç çubuğu.
  **Müşteri sayfası:** "Teknisyenle iletişim" (Sohbet; `caps.file_transfer` varsa Dosyalar). Yeni rota yok.
- **Sohbet (AC-35, 52):** iki yön, 2000 karakter, zaman damgası, okunmamış sayacı; düz metin (HTML yorumlanmaz).
- **Dosya transferi (AC-36, 53–55, 117, 119):** iki yön, `ctl` + `file` DataChannel'ları, içerik sunucudan geçmez.
  Kabul diyaloğu (varsayılan odak "Reddet", "Kabul et" 1,5 sn kilitli), tehlikeli/çift uzantı uyarısı, iki tarafta ad
  temizleme, tenant sınırı (`max_file_mb`, varsayılan 100), ilerleme, iki taraftan iptal, SHA-256 doğrulaması (tutmazsa
  "Dosya bozuk", indirme yok). Yetki `file_transfer.use`; yetkisizde gönderim pasif, gelen teklif otomatik ret.
  256 MB üstü dosya `showSaveFilePicker` varsa doğrudan diske yazılır.
- **İşaretleme (AC-56–58):** kalem, ok, dikdörtgen, lazer, 4 renk (`annot-*` token'ları), geri al, temizle; müşteri
  önizlemesinde görünür, lazer 1 sn'de söner. Girdi üretmez, kontrol izni gerektirmez.
- **Yüzen pencere (AC-37):** müşteri önizlemesi Document Picture-in-Picture'a alınabilir; destek yoksa düğme çizilmez.
- **Kalite paneli (AC-44–46):** 1 sn `getStats` (FPS, kbps, RTT, kayıp, çözünürlük, bağlantı tipi); 3 sn süren eşik
  aşımında "zayıf"/"kötü" uyarısı ve nedeni. `quality.summary` 60 sn'de bir ve bitişte sunucuya gider.
- **Migration `20261111040000_p5_session_files`:** `session_files` (yalnız ekleme; yön, temizlenmiş ad, boyut,
  SHA-256, sonuç; içerik yok; CHECK kısıtları; `app` kullanıcısında UPDATE/DELETE yok) ve
  `support_sessions.quality_summary` (JSON).
- **Sözleşme:** `@remote/contracts/files` (`sanitizeFileName`, `DANGEROUS_EXT`, `fileNameWarning`) + fixture
  `file-names.json`; `@remote/contracts/dc` (`ctl` mesajları, `file.offer.idx`, `file.result`, `encode/decodeFileChunk`,
  `FileReceiveGuard`, `maxFileBytes`); `@remote/contracts/ws` (`file.meta`, `quality.summary`, `hello.maxFileMb`,
  `peer.joined.maxFileMb`, hata kodu `VALIDATION`).
- **Audit:** `file.transfer`, `file.transfer.sender_report`, `file.meta.rate_limited`, `file.meta.rejected_by_db`.
- **Metrik:** `rs_file_meta_total{result}`, `rs_file_meta_rate_limited_total{class}`; runbook §9.8 alarmı
  (`class="sender"` oranı > 0).
- **Gerçek sunucu e2e tek komut:** `scripts/e2e-real.sh` (kod anlık görüntüsü, geçici MySQL, rastgele parolalar,
  temizlik; çıkış kodları 0/1/2/3). Müşteri ekran kaynağı sentetik (canvas), fiziksel ekrana bağlı değil. Runbook §10.
- **Testler:** birim 275 (server 160, web 83, contracts 32), server entegrasyon 128, web e2e 135 geçti + 27 atlandı
  (art arda 5 koşu yeşil), gerçek sunucu e2e 5/5.

### Değişti — P5
- `apps/server/Dockerfile`: `apps/server/scripts/` (`e2e-real-users.ts`, `test-db.sh`) prod imajına girmez (S-P4-T2-2 kalanı).
- `reconnect.conflict` audit'i oda başına 60 sn'de en çok 1 kayıt (S-P4-T3-2); misafir yeniden bağlanma denemesi
  35 × 3 sn = 105 sn. Misafirin `rs.resume.*` kaydı 120 sn'den eskiyse okunmaz (S-P4-T3-1).
- `docs/gereksinimler-kabul-kriterleri-e1-e4.md` AC-36: tehlikeli uzantı listesinin tek kaynağı `DANGEROUS_EXT`.
- DESIGN.md: `annot-*` renkleri, P5 ikonları (`Undo2`, `PictureInPicture2`), sohbet/dosya/kalite panelleri, kabul
  diyaloğu, işaretleme araç çubuğu, müşteri iletişim bölümü ve PiP.

### Güvenlik — P5
- **S-P5-1 (Yüksek):** Teklif seliyle `file.meta` kotası doldurulup gerçek transferin kaydı düşürülebiliyordu. Kota artık
  raporlayan taraf × sonuç sınıfı başına (`accepted` 60/dk, 2000/oturum; `declined` 20/dk, 500/oturum); aşımda
  `error{RATE_LIMITED}` + audit `file.meta.rate_limited`. Alıcı tarayıcı 10 sn'de en çok 3 teklif işler; karşı tarafın
  tetiklediği raporlar tekilleştirilir (dakikada en çok 5).
- **S-P5-2:** Aşan teklif ret, meta veya liste kaydı üretmez; transfer listesi 100, otomatik ret satırı 20 ile sınırlı.
- **S-P5-3:** Gönderenin raporu `file.transfer.sender_report` audit'ine yazılır; değiştirilmiş konsol `TO_TECH`
  kaydını bastırsa da müşteri tarafının izi kalır.
- **S-P5-4:** SHA-256 parçalar gelirken artımlı hesaplanır (ikinci tam kopya yok); 256 MB üstünde diske akış, özet
  tutmazsa dosya kaydedilmez (`abort`).
- **S-P5-5:** İndirme `application/octet-stream`; tamamlanan satırda tehlikeli/çift uzantı uyarısı yinelenir.
- **S-P5-6:** Alıcıda hız sınırı: sohbet 5/sn, işaretleme 30/sn, lazer 30/sn.
- **S-P5-7:** `DANGEROUS_EXT` genişletildi (`vbe`, `jse`, `ps1xml`, `settingcontent-ms`, `xlam`, `pptm`, `html`, `svg`
  vb.); ayrılmış adlara `CONIN$`, `CONOUT$`, `COM¹-³`, `LPT¹-³` eklendi.
- **S-P5-8:** Node ile MySQL Unicode sürüm farkından doğan CHECK reddi sessiz kayıp olmaz: audit
  `file.meta.rejected_by_db` (ad yerine yer tutucu) + `error{VALIDATION}`.
- **S-P5-T2-1 (kısmi):** Disk yolunda tamamlanan satırda uzantı uyarısı gösterilir; `diskSink` birim testli.
- **S-P5-T2-2:** `file.meta.rate_limited` seyreltmesi taraf + sınıf başına; bir tarafın aşımı diğerinin kaydını bastırmaz.
- **S-P5-T2-3:** Gönderen raporu ayrı `sender` sınıfında (10/dk, 200/oturum); `rs_file_meta_rate_limited_total` metriği.
- `pnpm audit` temiz; yeni bağımlılık yok (SHA-256 bağımlılıksız TS ile yazıldı).

### Düzeltildi — P5 (QA ve sayfa testi)
- **QA-P5-1:** AC-53 iptal e2e'si (alıcı ve gönderen iptali, iki tarafta "İptal edildi", meta CANCELLED).
- **QA-P5-2:** AC-37 PiP e2e'si (destek varsa açılır/kapanır, yoksa düğme yok).
- **QA-P5-3:** AC-57 işaretleme gecikmesi ölçümü (20 çizgi, p95 < 200 ms; yerel).
- **QA-P5-4:** AC-41 1080p FPS ölçümü (1920x1080 sentetik kaynak, ısınma sonrası medyan ≥ 15 FPS; yerel). E2E
  tarayıcısında mDNS host adayı kapatıldı (ICE kurulmuyordu; yalnız test).
- **QA-P5-5:** AC-36 metni revize edildi.
- **QA-P5-6:** Gerçek sunucu e2e tek komutla (`scripts/e2e-real.sh`) ve fiziksel ekrandan bağımsız 5/5.
- **QA-P5-7:** Kabul düğmesinin etkinleşmesini bekleyen e2e adımı yük altında kararsızdı; bekleme süresi uzatıldı
  (ürün kodu değişmedi).
- **TEST-P5-1 (Yüksek):** 10 sn içinde 4. teklif sessizce düşüyor ve gönderen "onay bekleniyor"da kilitleniyordu.
  Gönderen kendi teklifini sınırlar ("Kısa sürede en çok 3 dosya…" uyarısı); yanıtsız teklif 30 sn sonra "Yanıt yok"
  ile kapanır, karşıya `file.cancel` gider, yeniden gönderilebilir.
- **TEST-P5-2:** Müşteri sohbet günlüğü klavyeyle odaklanabilir (axe `scrollable-region-focusable`).
- **TEST-P5-3:** Boşluksuz uzun mesaj balonda kırpılmaz, satır kırılır.
- E2E'nin bulduğu hatalar: kalite paneli gerçek tarayıcıda hiç ölçüm göstermiyordu (`RTCStatsReport` okuma); `file.done`
  son parçalardan önce gelince ~1 MB dosyalar "bozuk" işaretleniyordu; Sohbet sekmesindeyken gelen teklifin diyaloğu
  görünmüyordu; sınır metni tenant ayarı yerine sabit "100 MB" idi.

### Bilinen sınırlamalar — P5
- AC-41 (1080p ≥ 15 FPS) ve AC-57 (işaretleme p95 < 200 ms) yalnız yerelde ölçüldü; gerçek ağ/TURN ölçümü staging'de,
  NAT yönlendirmesi açılınca (en geç P6 başlamadan).
- **S-P5-T2-4 (risk kabulü):** `session_files` satırı raporlayan tarafı taşımıyor, gönderen ve alıcı raporları
  eşleştirilmiyor; değiştirilmiş müşteri istemcisi sahte `TO_CUSTOMER` satırı yazabilir (audit'te `customer` olarak
  ayrılır). `reporter` kolonu veya `fid` eşleştirmesi P12/P13'te.
- **Disk yolu (S-P5-T2-1 kalanı):** Chromium `showSaveFilePicker` seçim anında hedef dosyayı oluşturur; özet tutmazsa
  0 baytlık dosya kalabilir, var olan bir dosya seçildiyse içeriği kaybolur. Kabul diyaloğuna uyarı metni P13 öncesi
  eklenecek; yol e2e ile sınanmadı (256 MB eşiği).
- 256 MB altı dosyalar alıcıda bellekte tutulur; büyük sınırlı tenant'larda bellek baskısı olabilir.
- `caps.update` (teknisyen yetkisi oturum sırasında değişirse) web'de henüz işlenmiyor.

### Eklendi — P4 (KVKK onayı + tarayıcıdan ekran paylaşımı)
- **Müşteri karşılama akışı (`/session/<token>`):** teknisyen kartı + doğrulama kodu, dolandırıcılık uyarısı,
  "Kötüye kullanımı bildir" (`mailto:`, adres yoksa gizli), ad + KVKK aydınlatma metni onayı, "Yalnız ekranımı
  tarayıcıdan paylaş" → lobi (4 haneli kabul kodu, kalan bekleme, "Vazgeç ve çık") → oturum (paylaş / durdur /
  yeniden paylaş, önizleme, onaylı bitirme) → bitiş, ret, bekleme doldu, bağlantı kesildi ekranları.
- **Paylaşım izni reddedilirse** "Paylaşım başlatılmadı" + "Tekrar dene" (AC-30). Mobil veya `getDisplayMedia`
  desteklemeyen tarayıcıda "Bu cihaz desteklenmiyor" ekranı; form gösterilmez (AC-33).
- **Teknisyen konsolu (`/sessions/<id>/console`, koyu):** üst bar (müşteri, durum, kalan süre, doğrulama kodu,
  onaylı bitir/iptal), lobi paneli (kabul kodu, kalan hak, satır başına Reddet), canlı video, görüntü modları
  Sığdır / %100 (kaydırmalı) / Tam ekran (AC-43), paylaşım durdu, müşteri koptu (120 sn) ve kendi bağlantısı koptu
  durumları. Tarayıcı modunda pasif "Uzaktan kontrol" düğmesi ve açıklaması (AC-34; kontrol P7).
- **Oturumlar listesi:** "Konsolu aç" (PENDING/ACTIVE, yalnız kendi oturumu) ve "Zorla sonlandır" (ACTIVE,
  `sessions.terminate`, onay diyaloğu).
- **WebRTC medya hattı:** teknisyen `recvonly`, misafir `sendonly` ekran izi; ses/kamera/mikrofon yok. Misafir
  kabulden sonra `reconnectToken` ile 120 sn yeniden bağlanır; teknisyen konsolu yenilense de paylaşım geri gelir.
- **KVKK onay kaydı:** migration `20261111030000_p4_consents` — `consent_texts` (tenant bazlı, sürümlü, değişmez,
  tenant başına tek güncel sürüm, `sha256 = SHA2(body,256)` CHECK) ve `session_consents` (yalnız ekleme; bileşik FK ile
  oturum, metin ve özet aynı tenant'ta). Onay, teknisyen kabulünde oturum tüketimiyle aynı işlemde yazılır (AC-29).
  Seed metni olmayan her tenant'a Türkçe KVKK metni v1 ekler.
- **API:** resolve yanıtına `consentText {id, version, body, sha256}` ve `abuseEmail` (`string | null`); join'de
  `consentTextId` zorunlu (AC-127). WS `hello` (teknisyen) `guestName` ve `share`, `peer.joined{guest}` `guestName`
  alanlarını taşır. `@remote/contracts/dc` (DataChannel etiketleri ve zarf şeması; ctl mesajları P5).
- **Audit:** `guest.pending` KVKK metin kimliği/sürümü, `guest.admitted` onay özeti (`textId`, `version`, `sha256`).
- **Yeni ortam değişkenleri:** server `ABUSE_EMAIL`; coturn `TURN_LISTEN_IPS` (`auto` = özel relay IPv4 + 127.0.0.1).
- **Gerçek sunucu e2e:** `e2e/p4-real.spec.ts` + `playwright.real.config.ts`; `pnpm --filter @remote/web e2e:real:users`
  (demo tenant'ta iki ADMIN) ve `pnpm --filter @remote/web e2e:real`. CI'da koşmaz (README "Gerçek sunucu e2e").
- **Testler:** birim 146 (server 78, web 44, contracts 24), server entegrasyon 103, TURN 62 kontrol, web e2e 116 geçti
  + 8 atlandı, gerçek sunucu e2e 5/5.

### Değişti — P4
- Boş ortam değişkeni (`ANAHTAR=`) tanımsız sayılır; varsayılanlı alan varsayılana düşer, zorunlu alan yine hata
  verir. Compose'da boş geçen `ABUSE_EMAIL`/`METRICS_TOKEN` server'ı durdurmaz.
- coturn yalnız `TURN_LISTEN_IPS` adreslerinde dinler; boşsa eski davranış (tüm arayüzler) + uyarı.
- `test-denied.sh` kota/allocation hatalarını yeniden dener; beklenen ret testleri beklemeden biter.
- DESIGN.md: Button `danger`/`danger-ghost`, CodeDisplay `xl`, Segmented `icon`, sahne, lobi paneli, konsol koyu
  teması, cihaz desteklenmiyor ve paylaşım reddedildi durumları.

### Güvenlik — P4
- **S-P4-1:** Production'da `ABUSE_EMAIL` yoksa resolve `abuseEmail: null` döner, Super Admin e-postası hiç
  sorgulanmaz (önceden platformun en yetkili hesabının e-postası her bağlantı sahibine gidiyordu). `ABUSE_EMAIL`
  `.env.example`, compose ve runbook'a eklendi.
- **S-P4-2:** `apps/web` devDependency `ws` 8.18.3 → 8.21.0 (GHSA-58qx-3vcg-4xpx); `pnpm audit` temiz.
- **S-P4-3 / S-P4-T2-1:** Müşteri adında Unicode `Cc`, `Cf`, `Zl`, `Zp`, U+034F ve U+180E reddedilir (bidi, sıfır
  genişlik, soft hyphen, etiket karakterleri dahil); kontrol kırpmadan önce yapılır. Teknisyen ekranında ve audit'te
  yanıltıcı ad gösterilemez.
- **S-P4-4:** Çıkışta sekme belleğindeki `rs.*` anahtarları (müşteri adı) silinir.
- **S-P4-T2-2:** `e2e-real-users.ts` `NODE_ENV=production` iken veya `E2E_REAL_ALLOW=1` olmadan çalışmaz.
- KVKK onayı yalnız oturumun tenant'ının güncel metniyle kabul edilir; eski sürüm, başka tenant ve bilinmeyen id aynı
  400 yanıtını alır (tenant varlığı sızmaz, G-24). Onay kaydı DB'de değiştirilemez (`app` kullanıcısında UPDATE/DELETE yok).
- `getDisplayMedia` yalnız kullanıcı tıklamasıyla çağrılır, yeniden bağlanmada otomatik paylaşım yok. Müşteri sayfası
  çerçevelenemez (`frame-ancestors 'none'`, AC-38). Ticket ve reconnect token yalnız bellekte ve subprotocol'de.
- coturn `TURN_LISTEN_IPS` değerleri IPv4 olarak tam doğrulanır, satır sonu reddedilir (yapılandırma enjeksiyonu yok).

### Düzeltildi — P4 (QA)
- QA-P4-2..5: pasif "Uzaktan kontrol" (AC-34), cihaz desteklenmiyor ekranı (AC-33), paylaşım reddinde tekrar dene
  (AC-30), konsol görüntü modları ve tam ekran (AC-43).
- QA-P4-6: `ABUSE_EMAIL` env zinciri (`.env.example`, compose, runbook).
- QA-P4-7: `docs/mimari-api.md` resolve/join satırları koda uyarlandı.
- QA-P4-8, QA-P4-9: `frame-ancestors 'none'`, doğrulama kodu eşliği ve `mailto:` bağlantısı (gizli hali dahil) e2e testli.
- QA-P4-11: gerçek sunucu e2e tekrarlanabilir kurulum betiği.
- QA-P4-12: konsol yenilenince müşteri adı ve paylaşım durumu sunucudan gelir (`hello.guestName`/`share`,
  `peer.joined.guestName`); lobide birden fazla misafir varken ad tahmin edilmez.
- QA-P4-13: DESIGN.md yeni bileşen ve durumlarla güncellendi.
- Gerçek sunucu e2e'sinin bulduğu: teknisyen yeniden bağlanınca misafir paylaşım durumunu yeniden bildirir.

### Bilinen sınırlamalar — P4
- Staging NAT/TURN-TLS ölçümleri (AC-23, 40, 42) üst NAT yönlendirmesi açılınca yapılacak, en geç P6 öncesi.
- Müşteri adı DB'ye yazılmaz (lobide bellekte ve audit'te); oturum listesinde müşteri adı yok (P8).
- Onay zaman çizelgesi (AC-62) P8'de. KVKK metninin yeni sürümünü yayımlama ekranı henüz yok; metin seed ile gelir.
- Kalite göstergesi, sohbet, dosya transferi, işaretleme P5'te; uzaktan kontrol P7'de.
- Oturum süresi dolup girişe yönlenmede sekme belleği temizlenmez (sekme kapanınca silinir, B-2).
- `e2e-real-users.ts` server imajında bulunuyor; imajdan çıkarılması devops işi olarak açık.

### Eklendi — P3 (sinyalizasyon + TURN)
- **Müşteri katılımı:** `POST /api/v1/public/sessions/join` (`joinNonce` + ad + onay → `wsTicket`, 4 haneli
  `admitCode`, teknisyen adı). Resolve yanıtına `joinNonce` ve `nonceExpiresAt` eklendi (tek kullanımlık, 60 sn).
- **WebSocket sinyalizasyonu:** `/ws/tech?sessionId=` (çerez + Origin, yalnız oturum sahibi) ve `/ws/guest`
  (subprotocol `rs.v1` + `rs.ticket.<wsTicket>` / `rs.reconnect.<token>`). Lobi (≤ 3 misafir, 5 dk), teknisyen
  kabulü (`guest.admit`) ve reddi (`guest.reject`), SDP/ICE/`share.state` aktarımı, 120 sn yeniden bağlanma,
  en uzun süre uyarısı ve bitişi, TURN bilgisi yenileme (`ice.servers`), ping/pong.
- **Sözleşme:** `@remote/contracts/ws` (zod şemaları, kapanış kodları, `session.ended` nedenleri, WS hata kodları)
  ve Go istemciyle paylaşılan `packages/contracts/fixtures/ws-messages.json`.
- **Zorla sonlandırma:** `POST /api/v1/sessions/:id/terminate` (`sessions.terminate`; odaya `session.ended{admin}`).
- **`/metrics`** (iç ağ, `METRICS_TOKEN` Bearer): WS bağlantı/ret/1008 sayaçları, admit sonuçları, biten oturumlar,
  `rs_ws_connections`, `rs_active_sessions`, `rs_active_rooms`, `rs_resolve_failed`.
- **TURN (coturn 4.18):** `deploy/turn/` ayrı compose projesi; HMAC süreli credential (`<unixExpiry>:<sessionId>`),
  TCP/UDP/TLS (5349), iç/özel adreslere relay yasağı (`denied-peer-ip`), `TURN_SECRET_PREVIOUS` ile kesintisiz
  sır değişimi, `host-firewall.sh` (relay portlarından host'un kendi servislerine UDP'yi keser; systemd timer ile
  onarılır), yerel test betikleri (`test-local.sh`, `test-denied.sh`). CI'da yeni `turn` işi.
- **Veritabanı:** migration `20261111020000_p3_session_admit`: `support_sessions.mode`, `consumed_at`,
  `terminated_by` + 5 CHECK kısıtı. Yeni tablo yok.
- **Hata kodları:** `LOBBY_FULL` (409), `NONCE_INVALID` (410).
- **Audit:** `guest.pending`, `guest.admitted`, `guest.admit` (başarısız), `guest.rejected`, `session.join`
  (başarısız), `session.ended`, `session.terminated`, `reconnect.conflict`.
- **Yeni ortam değişkenleri:** server `TURN_URLS`, `TURN_SECRET`, `TURN_CRED_TTL_MIN`, `METRICS_TOKEN`; coturn
  `TURN_SECRET_PREVIOUS`, `TURN_REALM`, `TURN_EXTERNAL_IP`, `TURN_MAX_BPS`, `TURN_BPS_CAPACITY`,
  `TURN_PROMETHEUS_ADDRESS` (`.env.example`, compose, runbook §9).
- **Bağımlılık:** `ws` 8.21.0, `@types/ws` (dev).
- **Testler:** birim 94 (server 69, web 23, contracts 2), server entegrasyon 93, TURN 62 kontrol, web e2e 97 geçti
  + 1 atlandı.

### Değişti — P3
- Public resolve ve join ADR-0012 kuralını uygular: `Origin` varsa izinli olmalı ve tür `BROWSER`; yoksa yalnız
  `AGENT` (Windows istemcisi). Join'de tür `joinNonce` kaydından gelir.
- `POST /sessions/:id/cancel` artık bağlı teknisyen ve lobi misafirlerine `session.ended{cancelled}` gönderir.
- Bekleyen oturumun süresi dolunca teknisyen ve lobi `session.ended{timeout}` alır, oda silinir.
- Sunucu açılışında yarım kalmış ACTIVE oturumlar `ENDED` (`server`) yapılır.
- Compose: server'a `TURN_URLS`/`TURN_SECRET` zorunlu, `TURN_CRED_TTL_MIN` (vars. 20), `METRICS_TOKEN` (isteğe bağlı).
- Staging ADMIN/USER hesabı `deploy/staging-users.sh` ile eklenir (runbook §6).

### Güvenlik — P3
- Token'lar URL'de taşınmaz: misafir kimliği WS subprotocol'ünde; URL'de ticket görülürse bağlantı 403.
  `joinNonce`, `wsTicket`, `reconnectToken`, `admitCode` ve TURN credential'ı log/audit'e yazılmaz (testle doğrulandı).
- Misafir, teknisyen kabul etmeden TURN bilgisi ve `reconnectToken` almaz; kabul kodu yalnız o misafire gösterilir,
  sunucu sabit zamanlı karşılaştırır, 5 hatada lobi boşaltılır.
- Oturum tüketimi tek atomik koşullu UPDATE (admit ‖ admit ve admit ‖ iptal 50'şer turda tek kazanan).
- Mesaj sınırları: şema hatası / ekstra alan / saniyede 50 mesaj aşımı → 1008, 64 KB üstü → 1009. Upgrade hız
  sınırı (`/ws/guest` ve `/ws/tech` IP başına), join IP başına 20/dk.
- Misafir yeniden bağlanması mevcut bağlantı varken reddedilir (403 + audit); teknisyenin oturumu 60 sn'de bir
  yeniden doğrulanır, geçersizse 4401.
- `ws` 8.18.3 → 8.21.0 (GHSA-96hv-2xvq-fx4p, GHSA-58qx-3vcg-4xpx); `pnpm audit` temiz.
- TURN: kısa süreli credential (vars. 20 dk), `TURN_SECRET` ≥ 32 karakter, coturn root dışı + salt okunur,
  secret komut satırında değil, CLI kapalı, Prometheus yalnız `127.0.0.1`, log 3×5 MB + haftalık temizlik.
- Test sırları tek dosyada (`apps/server/test/helpers/secrets.ts`), gitleaks allowlist'i yalnız o dosya.

### Bilinen sınırlamalar — P3
- Ekran paylaşımı ve teknisyen konsolu video arayüzü P4'te; KVKK metni doğrulaması (`consentTextId`) P4'te zorunlu olur (P4'te kapandı).
- Yetki daraltması/pasifleştirme aktif oturumu henüz sonlandırmaz (S-P3-8, P7 giriş şartı).
- Staging'de TURN'ün dışarıdan çalışması üst NAT yönlendirmesine bağlı (runbook §9.3). Prod IPv6 relay doğrulaması P13.
- `host-firewall.sh` sertleştirmeleri (S-P3-T2-1, S-P3-T2-2) prod açılışından önce kapanacak.

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
