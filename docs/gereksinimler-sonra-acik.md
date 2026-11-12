# Gereksinimler — "Sonra / açık" takip tabloları
Ana doküman: `/Users/mennan/Projeler/Remote/docs/gereksinimler.md` (bölüm 9'un devamıdır, ayrılmaz parçasıdır). Boyut nedeniyle 2026-11-12'de ana dosyadan taşındı; P2..P8 tabloları içerik değiştirilmeden taşındı, yeni paketlerin tabloları en üste eklenir.

### Sonra / açık — P8c'den (2026-11-12)
Kaynak: `docs/guvenlik-raporu.md` (E10/P8c-2 Kod turu 1–2), `docs/qa-raporu.md` (P8c-2 Tur 1–2; P8c-1 raporu
`docs/arsiv/p8c1-qa-raporu.md`), `docs/arsiv/p8c1-test-raporu.md`, `docs/implementation.md` (P8c-1 düzeltme turu 2, P8c-2).

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| B-P8c2-4 (Bilgi) `bindingPending` kopuşta sıfırlanmıyor | Kayıt isteği gönderilip yanıt gelmeden soket koparsa `bindingPending` true kalıyor; yeniden bağlanınca yeni teklif yok sayılıyor ve o oturumda kayıt alınamıyor (güvenli taraf: kayıt yazılmaz, anahtar sızmaz). Kopuşta (`flow.go` `phReconnecting`) `bindingPending = false` + "istek → kopuş → yeni teklif → tek istek" testi | backend-dev (Go) | Sonra (bir sonraki istemci sürümü) |
| Olmayan müşteri detayı HTTP 200 (test-operatoru, Düşük) | `/customers/<olmayan id>` ekranda "Müşteri bulunamadı" gösteriyor ama belge yanıtı 200 (Suspense akışı `notFound()` kodunu değiştiremiyor; P2 `/session/[token]` ile aynı neden). Düzeltilecek veya implementation.md'ye sapma olarak yazılacak | frontend-dev | Sonra |
| "Tümü" filtresinde boş durum (test-operatoru, Düşük) | Müşterisi olmayan firmada `/customers?status=all` gövde metni "Durum filtresini değiştirerek…" diyor (filtre zaten Tümü); boş durumda "Yeni müşteri" ve yardım düğmesi yok. Varsayılan boş durumla aynı olmalı (AC-166) | frontend-dev | Sonra |
| `/ws/panel` 429 (test-operatoru, Düşük, gözlem) | Hızlı sayfa geçişinde (~12 sayfa/dk) `/ws/panel` el sıkışması 429 alıyor, konsola hata düşüyor. 429 sonrası `Retry-After`'a göre sessiz yeniden bağlanma doğrulanmalı; gerekirse kova eşiği gözden geçirilmeli | backend-dev + frontend-dev | Sonra |
| Çift `customers-help` diyaloğu (QA önerisi) | Boş durumda `CustomersActions` iki kez çiziliyor; sayfada iki "Müşteriye nasıl gönderilir?" diyaloğu var. Tek diyaloğa indirilebilir | frontend-dev | Sonra |
| AC-187 aynı adlı tenant geçişi (QA önerisi) | `keeper.Issued` değişikliği görünen adlarla karşılaştırıyor; aynı adlı iki farklı tenant arasında geçişte "Bu bilgisayar artık … için kayıtlı" gösterilmiyor. Önceki kaydın kökeni/kimliği farklıysa da bilgi gösterilmeli | backend-dev (Go) | Sonra |
| Ortak kod biçimlendirici kararı (QA önerisi) | Projede biçimlendirici yapılandırması yok; ortak bir yapılandırma (ör. `.prettierrc` printWidth 200 + `format:check`) ya da "biçimlendirici yok, elle biçim" kararı yazılmalı ki ajanlar aynı dosyayı farklı biçimle yeniden yazmasın (`docs/arsiv/p8c1-qa-raporu.md` Öneri 2) | devops | Sonra |
| implementation.md sayı düzeltmesi (QA önerisi) | "P8c-1 — düzeltme turu 2 (frontend)" doğrulama satırındaki "85 → 67" skip açıklamasında önceki sayı 81 olmalı | frontend-dev | Bir sonraki implementation.md güncellemesinde |
| K18 / AC-192 staging ölçümü | Müşteri dosyasından ve kayıttan açılan taleplerde farklı NAT'larda 10/10 görüntü, kabulden ilk kareye p95 ≤ 8 sn (implementation.md "P8c-2" Windows adım 16) | test-operatoru / kullanıcı | 0.10.0 staging yayınından sonra, P9'dan önce |
| Windows elle testleri P8c-2 | implementation.md "P8c-2" adım 1–16 + düzeltme turu 1 ekleri (kodsuz 404 → kayıt korunur; IDN adreste form satırı yok); QA önerisi: adım 5'e kayıtlı ana ekranda dört düğmeli Tab sırası + Enter kontrolü | test-operatoru (Windows test makinesi) | 0.10.0 staging yayınından sonra |
| Ayarlar "Genel bağlantı" başlığı (AC-175) | P8c-1 sayfa testinde staging Admin hesabıyla giriş yapılamadığı için (ACCESS.txt parolası uyuşmadı) Ayarlar > Destek talepleri ekranındaki "Genel bağlantı" başlığı doğrulanamadı. ACCESS.txt düzeltilip yeniden bakılacak | devops (parola) → test-operatoru | Sonraki sayfa testinde |
| Pencere bazlı paylaşım | Windows istemcide yalnız seçili pencereyi paylaşma (E10 kapsam dışı 1) | proje-yoneticisi → mimar | Sonra |

### Sonra / açık — P8b-2'den (2026-11-12)
Kaynak: `docs/qa-raporu.md` (P8b-2 Tur 1–2), `docs/guvenlik-raporu.md` (P8b-2 Tur 1–2, S8b2-x),
`docs/implementation.md` (Backend (Go) P8b-2 + düzeltme turu 1).

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| Windows elle testleri P8b-2 | `docs/implementation.md` "Backend (Go) P8b-2" adım 1–20 ve düzeltme turu 1 adımları a–c, Win10 ve Win11 standart kullanıcıyla; sonuç `docs/test-raporu.md`'ye | kullanıcı / test-operatoru (Windows test makinesi) | 0.9.0 staging yayınından sonra, P9'dan önce |
| S8b2-2 sunucu tarafı | Güvenilen CIDR'dan gelen `/ws/request` upgrade'lerini `wsUpgrade` hız kovasından muaf tutmak (istemci geri çekilmesi tamam) | backend-dev | Sonra |
| S8b2-4 (Düşük) | Onay diyaloğu anahtarı `teknisyen adı + doğrulama kodu` olmalı; aynı adlı ikinci teknisyenin yeniden kabulünde diyalog kapatılıp yeniden açılmalı (1,5 sn kilit) | backend-dev (Go) | **Durum: tamam (2026-11-12, düzeltme turu 2)** |
| ~~İlk teklifte TURN yok (gözlem, 2026-11-12)~~ **kapandı 2026-11-12** | Teknisyen önce bağlanınca ilk `hello{tech}` boş ICE listesiyle geliyor (`apps/server/src/signaling/active.ts:24`); konsol ilk offer'ı TURN'süz üretiyor, yeniden ICE yalnız `failed`'da. Farklı NAT'larda görüntü uzun süre siyah kalabilir. 0.9.0 talep testindeki tek seferlik siyah ekran bununla ilişkilendirilemedi (0.9.1 ile tekrarlanmadı); tekrar görülürse teknisyen tarayıcısında `iceConnectionState` bakılır. Öneri: ilk hello'da ICE sunucularını göndermek veya `ice.servers` gelince offer'ı yenilemek | backend-dev ‖ frontend-dev | **Durum: tamam (2026-11-12)** — sunucu teknisyene `ice.servers`'ı `peer.joined`'dan önce gönderir; konsol ICE listesi gelmeden teklif üretmez (implementation.md "Düzeltme — TURN'süz ilk teklif (siyah ekran)") |
| `MIN_AGENT_VERSION=0.9.0` | Tüm müşteriler 0.9.0 firma dosyasına geçince açılacak; öncesinde eski istemciler (0.8.x) 426 alır. Açınca 0.8.x kod dosyaları da durur | devops + kullanıcı | Tüm müşteriler 0.9.0'a geçince (runbook §12.4) |

### Sonra / açık — P8b-1'den (2026-11-12)
Kaynak: `docs/qa-raporu.md` (P8b-1 Tur 1–3), `docs/guvenlik-raporu.md` (P8b-1, S8b-x), `docs/test-raporu.md` (P8b-1),
`docs/implementation.md` (Backend/Frontend/Devops P8b-1).

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| S8b-8 (Düşük) — 503'te IP kovası | **İstemci yarısı tamam (0.9.0):** yalnız 503 `NOT_READY` en çok bir kez yeniden denenir (kotanın en çok 2/5'i). **Sunucu yarısı açık:** kapı 503'ünde IP/önek kovası iadesi veya tüketimin kapı sonrasına alınması, tenant kovası `add`'inin commit sonrasına alınması | backend-dev | Sonra |
| G-E9-17 — kara liste | Belirli IP/cihazdan talepleri engelleme listesi; koordinatör kararı c ile kodlanmadı | mimar → backend-dev + frontend-dev | Sonra |
| AC-149 — uçtan uca ölçüm | Yalnız panel tarafı (WS → toast, yerel p95 5 ms) ölçüldü. İstemci `POST /public/requests` → sunucu → `/ws/panel` → toast süresi (≤ 3 sn) staging'de gerçek sunucuda ölçülüp `docs/test-raporu.md`'ye eklenecek | test-operatoru | P8b-1 staging yayınından sonra |
| CSV yeni sütunlar — uçtan uca indirme | `Kaynak` ve `Bekleme` sütunları entegrasyon testinde doğrulandı; gerçek sunucudan indirip Excel'de (tr-TR) açma kontrolü yapılmadı | test-operatoru / kullanıcı | Staging yayınından sonra |
| AC-151 — e-posta bildirimi | Ayar alanları var, UI pasif ("P10'da gelecek"); SMTP ayarı ve e-posta test ucu ile tamamlanacak | backend-dev + frontend-dev | P10 |
| Windows elle testi (P6/P7 + fare imleci) | `docs/implementation.md` Agent P7 adım 25–42 ve "fare imleci" adım 43–47 gerçek Windows'ta **hâlâ açık** (P8 tablosundaki madde) | kullanıcı (Windows test makinesi) | P8b-2 Windows elle testiyle aynı oturumda |
| GitHub `AGENT_SERVER_URL` | Repo değişkeni `https://remote.noktabilisim.net` yapılmalı (runbook §8.3, §11.1); aksi halde CI'nin derlediği istemci IP:4450 gömülü kalır ve kök sertifika ister | kullanıcı (repo sahibi) | P8b-2 istemci yayınından önce |
| `MIN_AGENT_VERSION` | Boş kalmalı; açılış zamanı P8b-2 tablosunda (`MIN_AGENT_VERSION=0.9.0`) | devops | P8b-2 tablosuna taşındı |

### Sonra / açık — P8'den (2026-11-11)
Kaynak: `docs/qa-raporu.md` (P8 Tur 1), `docs/guvenlik-raporu.md` (P8, S8-x), `docs/test-raporu.md` (P8), `docs/implementation.md` (Backend/Frontend P8, Agent fare imleci).

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| S8-1, S8-2, S8-3 | **Kapandı** (backend düşük bulgular turu): CSV formül kaçışı genişletildi, `code` yalnız kendi teknisyenine, müşteri araması 60/dk | — | Kapandı |
| S8-4 — ADR-0014 precheck runbook'ta | **Kapandı:** `docs/runbook.md` §6.1 (migrate'ten önce salt okunur `precheck.sql`, 3819'da ne yapılacağı, `down.sql` geri dönüşü) | — | Kapandı |
| QA-P8-1 — CSV Excel tr-TR | Dosya yapısıyla doğrulandı (BOM, `;`, CRLF, RFC 4180, strict ayrıştırmada sabit sütun sayısı, formül kaçışı). Excel'de çift tıklayıp açma ve formüllü hücrenin metin kaldığını görme elle yapılacak (`docs/img/p8/p8-superadmin.csv`) | kullanıcı | Staging yayınından sonra |
| TEST-P8-1 (Düşük) | Detay "Dosyalar" tablosu dar: dosya adı harf harf kırılıyor, SHA-256 kesik; 390 px'te Onay kayıtları kaydırma ipucusuz. Öneri: ad `truncate` + `title`, hash kısaltma + kopyala, bölümü tam genişliğe almak | frontend-dev | P9 ilk turu |
| TEST-P8-2 (Düşük) | Super Admin listesi 1280 px'te tablo kabını 17 px aşıyor (Ticket kesik). Öneri: Firma/Teknisyen `whitespace-nowrap` + `truncate` | frontend-dev | P9 ilk turu |
| Gözlem — geri tuşu | Kaydedilmemiş not varken uygulama içi geri tuşu uyarı vermiyor (menü bağlantısı ve yenileme uyarıyor) | frontend-dev | P9+ (AC istemiyor; değerlendirilecek) |
| Filtre seçenekleri | Teknisyen/firma filtre seçenekleri sayfadaki kayıtlardan geliyor; `GET /users?fields=id,fullName` ve tenant listesi gelince oradan alınacak | backend-dev + frontend-dev | P9 |
| QA-P8-2 | **Kapandı:** müşteri adı uzunluğu kod noktasıyla sayılıyor | — | Kapandı |
| Windows elle testi (P6/P7 + fare imleci) | `docs/implementation.md` Agent P7 adım 25–42 ve "fare imleci" adım 43–47 gerçek Windows'ta **hâlâ açık**. P6 tablosundaki Windows elle testi ve AC-41 ölçümü de aynı oturumda | kullanıcı (Windows test makinesi) (+ backend-dev/Go düzeltme) | P9 kod turundan önce |
| Hızlı Destek staging'de kod soruyor / hiçbir kodu kabul etmiyor | Windows'ta Caddy `tls internal` kök sertifikası kurulu değil (runbook §2/§8, `certutil -addstore -f Root`); ajan 0.8.0'da TLS hatası ayrı mesajla gösterilecek | backend-dev (Go) + kullanıcı (sertifika kurulumu) | Ajan 0.8.0 |

### Sonra / açık — P7'den (2026-11-11)
Kaynak: `docs/qa-raporu.md` (P7, Tur 2 — QA-P7-T2-1), `docs/implementation.md` Agent P7 bölümleri, `docs/guvenlik-raporu.md` (P7, S7-x), `docs/db-notlari.md` (P7).

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| Windows elle testi (P7) | `docs/implementation.md` Agent P7 bölümlerindeki adım 25–42 gerçek Windows makinesinde koşulur; her adımın sonucu (geçti/kaldı + kanıt) implementation.md'ye yazılır. Kapsar: AC-48, AC-49, AC-100, AC-102, AC-103, AC-104, AC-105 ve AC-116 Win32 bağlaması; S7-3, S7-5, S7-6, S7-7, S7-12 bulgularının gerçek ortam doğrulaması | kullanıcı (Windows test makinesi) (+ backend-dev/Go düzeltme) | **P8 kod turundan önce** (S7-12 düzeltildi — P7 Tur 3; P6 Windows elle testiyle aynı oturumda) |
| S7-11 — commit sonrası oda çağrıları | P9/P10 servisleri oturum sonlandırma ve yetki değişikliğinde `app.rooms.endByTechnician` / `app.rooms.applyPermChange`'i DB commit'inden **sonra** çağırmalı; qa bunu kontrol eder | backend-dev (P9/P10) + qa-denetci | P9/P10 giriş şartı |
| govulncheck — çağrılmayan kayıtlar | Bildirilen ama çağrılmayan `golang.org/x/net` v0.60.0 ve `golang.org/x/crypto` v0.57.0 kayıtları Dependabot ile yükseltilir; govulncheck yeşil kalır | backend-dev (Go) / devops (Dependabot) | Sonraki bağımlılık turu (en geç P13) |
| Kararsız test — AC-39 axe e2e | P5 AC-39 axe e2e testi ara sıra 30 sn zaman aşımına düşüyor; kök neden giderilir (yalnız süreyi artırmak çözüm sayılmaz); CI'da 20 ardışık koşuda 0 hata | frontend-dev | P8 ilk turu |
| DB enum CHECK harf duyarsızlığı | **Karara bağlandı: ADR-0014** — 14 enum CHECK `CAST(col AS BINARY) IN (…)` (harf/aksan/sondaki boşluk duyarlı); migration `20261111070000_enum_check_binary` | dba | P8 içinde |

Not: S7-9 (yönetici olarak çalışan istemci, `selfElevated`) mimar kararıyla P7 Tur 2 içinde uygulanıyor (`docs/mimari-protokol.md` K8); ertelenmedi.

### Sonra / açık — P6'dan (2026-11-11)
Kaynak: `docs/implementation.md` "Agent (P6)" Aşama 1–3, "Backend P6", "DevOps (P6)"; `docs/guvenlik-raporu.md` "P6 kod turu 1"; `docs/qa-raporu.md` (P6); mimar kararı (ADR-0004 r2, ADR-0006 r3, ADR-0010 r3). TEST-P5-4 P5 tablosunda, burada tekrarlanmaz.

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| TEST-NAT-3 (Yüksek, ortam şüphesi) / AC-41 | NAT sonrası 1080p ölçümünde UDP relay yolunda ~42. sn'den sonra kayıp patlaması (%12,7, BWE 2500→71 kbps); TCP/TLS relay'de kayıp 0; sunucuda kayıp izi yok (NIC/UDP buffer/conntrack temiz). İki tarayıcı aynı Mac'te (tek upload hattı) → ölçüm iki ayrı ağdan tekrarlanır; eşzamanlı sunucu `tcpdump`/`nstat` + pfSense `pfctl -si` ile kaybın yeri ayrılır. AC-41 (1080p ≥15 FPS) bu tekrar ve gerçek Windows/Chrome testiyle kapanır | test-operatoru + devops (+ kullanıcı: ikinci ağ) | ~~P7 başlamadan~~ → **P8 kod turundan önce** (2026-11-11: yapılmadı, ortam/Windows makinesi gerekiyor; yeniden tarihlendi) |
| TEST-NAT-2 (Orta) | Uygulama akışında yalnız `turn:…:3478?transport=tcp` verilince ICE `checking→disconnected`; minimal Chrome ve `turnutils_uclient` ile aynı yol çalışıyor (altyapı temiz, devops tanısı implementation.md). `chrome://webrtc-internals` dökümüyle `ice.servers`/`setConfiguration` zamanlaması incelenecek | frontend-dev + test-operatoru | P7 ilk turu |
| TEST-NAT-1 (Orta, kurulum) | Staging TURN-TLS sertifikası özel CA ile; test makinesine `deploy/turn/certs/ca.crt` kök depoya kurulmadan yalnız-TLS (AC-23) yolu çalışmaz. Prod'da genel CA'lı sertifika (P13) | kullanıcı (staging testi) / devops (P13) | Staging testinde |
| TEST-NAT-4 (Düşük) | İlk ölçüm koşusunda 1 işaretleme çizgisi müşteriye ulaşmadı; sonraki 440 örnekte tekrarlanmadı, spec kayıpları ayrıca sayıyor | test-operatoru | İzlenecek |
| Windows elle testi | Temiz Win10 22H2 / Win11 VM'de: AC-95 (tek dosya ≤ 40 MB, açılış ≤ 5 sn), AC-96 (SHA-256/SmartScreen "Yine de çalıştır" yolu), AC-103, AC-106 (monitör seçimi, gösterge), AC-110 (DPI/manifest), AC-118 (Procmon DLL araması 0), gerçek NTFS'te `Zone.Identifier`, AC-108 iz testi (`apps/agent-win/test/trace-check.ps1` yazılacak), gerçek yakalama FPS — AC-41 (1080p ≥ 15 fps; DXGI/MF kodu bu ortamda hiç çalıştırılamadı) | test-operatoru (+ backend-dev/Go düzeltme) | ~~P7 başlamadan~~ → **P8 kod turundan önce** (2026-11-11: yapılmadı, ortam/Windows makinesi gerekiyor; yeniden tarihlendi) |
| Fare imleci | İmleç görüntüye çizilmiyor (DXGI kare imleci içermez): `DXGI_OUTDUPL_FRAME_INFO.PointerPosition` + `GetFramePointerShape` ile NV12 karesine bindirme | backend-dev (Go) | **Kodlandı 2026-11-11** (`internal/capture/cursor.go`, NV12'ye bindirme, birim testli); Windows elle doğrulaması (implementation.md adım 43–47) P7 Windows testiyle aynı oturumda |
| Donanım MFT yedeği | Donanım H.264 MFT oturum sırasında hata verirse/takılırsa yazılım MFT'ye otomatik geçiş (bugün yalnız açılışta seçim yapılıyor) | backend-dev (Go) | Windows elle testi sonucuna göre; en geç P13 |
| Dirty-rect | `GetFrameDirtyRects`/`MoveRects` ile yalnız değişen bölgenin dönüştürülmesi (CPU BGRA→NV12 maliyeti); AC-41 ölçümü 15 fps altında kalırsa öne çekilir | backend-dev (Go) | Sonra (ölçüme bağlı) |
| Koyu tema (istemci) | Windows istemci pencerelerinde sistem koyu temasına uyum (ortak standart 1.6; bugün yalnız açık) | backend-dev (Go) | P13 |
| Repo görünürlüğü + attestation | Repo private iken GitHub build provenance attestation üretilemiyor/doğrulanamıyor (T13, G-07); repo public yapılacak (veya Enterprise), environment onayı + `v*` tag ruleset etkinleştirilecek, `verify-and-publish.sh` `--no-attestation` olmadan çalıştırılacak | kullanıcı + devops | Prod açılışı öncesi (P10) |
| Staging istemci testi | Staging (185.126.217.99:4450) Caddy iç CA kullanıyor; istemci sistem kökleriyle doğruladığı için (AC-109) test makinesine Caddy kök CA'sı kurulmalı **veya** staging'e gerçek alan adı + genel sertifika verilmeli. Karar ve adımlar runbook'a | devops (+ kullanıcı: alan adı) | Windows elle testinden önce |
| SignPath | SignPath Foundation başvurusu (ADR-0010; kod yok, süreç). Kabul edilirse `agent-win.yml`'e imza adımı | kullanıcı (+ devops) | P6 ile paralel başladı; sonuç gelince |
| x/net v0.62 | `golang.org/x/net` v0.60.0 → v0.62.0: GO-2026-6866 / GO-2026-6860 (`x/net/html`) ve GO-2026-5932 (`x/crypto/openpgp`) istemciden erişilemiyor, yalnız modül düzeyinde (govulncheck 0 erişilebilir); bir sonraki Dependabot/sürüm yükseltmesinde güncellenecek, govulncheck yeşil kalmalı | backend-dev (Go) | Sonraki bağımlılık turu (en geç P13) |

### Sonra / açık — P5'ten (2026-11-11)
Kaynak: `docs/guvenlik-raporu.md` (P5 turları), `docs/qa-raporu.md` (P5); mimar kararı (`docs/mimari.md` §3.1 `session_files` risk kabulü, §10.3 P5).

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| S-P5-T2-4 (risk kabulü) | `session_files` satırı raporlayan tarafı taşımıyor; gönderen/alıcı raporları `fid` ile eşleşmiyor → değiştirilmiş müşteri istemcisi sahte `TO_CUSTOMER` satırı yazabilir (bugün yalnız audit actor ile ayrılır). Çözüm: `reporter` kolonu (`TECH\|CUSTOMER`) **veya** iki taraf raporunun `fid` ile eşleştirilmesi; geçmiş/CSV yalnız eşleşen ya da teknisyen raporlu satırı "doğrulanmış" gösterir | dba + backend-dev | P12/P13 |
| S-P5-T2-1 kalanı | Chromium `showSaveFilePicker` seçim anında hedef dosyayı oluşturuyor/boşaltıyor: özet bozuk (CORRUPT) çıkarsa 0 baytlık dosya kalır veya üzerine yazılan mevcut dosya kaybolur. Gerçek tarayıcıda doğrulanacak; kayıt diyaloğu öncesine "Var olan bir dosyanın üzerine yazmayın; aktarım bozulursa dosya boş kalabilir" uyarı metni eklenecek | frontend-dev | P13 öncesi |
| QA-P5-4 / AC-41 | 1080p ≥15 FPS ölçümü: frontend headless Chromium'da deniyor; headless'ta anlamlı ölçülemezse staging gerçek tarayıcı ölçümüne ertelenir (NAT ölçümleriyle birlikte, bkz. QA-P4-10), sonuç `docs/test-raporu.md` | test-operatoru (+ frontend-dev) | NAT açılınca staging ölçümü; en geç P6 başlamadan |
| TEST-P5-4 (Düşük) | Sohbet: alıcı tarafı saniyede 5 mesaj sınırı (`apps/web/lib/dc/rate.ts` `IN_LIMITS.chat`) aşılınca fazla mesajlar sessizce düşüyor; gönderen tarafa aynı sınır + "çok hızlı yazıyorsunuz" uyarısı eklenecek (dosya teklif öz-sınırı gibi) | frontend-dev | P7 ilk turu |
| AC-57 p95 | İşaretlemenin müşteri tarafında görünme gecikmesi (RTT < 100 ms ağda p95 < 200 ms) staging'de gerçek ağ/TURN yolu üzerinden tekrar ölçülür; yerel/headless sonuç ön kanıttır | test-operatoru | NAT açılınca staging ölçümü |

### Sonra / açık — P4 düzeltme turundan (2026-11-11)
Kaynak: `docs/qa-raporu.md` QA-P4-10; mimar kararı (`docs/mimari.md` §10.3 P4).

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| QA-P4-10 — AC-23, AC-40, AC-42 staging ölçümleri | P4 kapanışından ayrıldı. pfSense'te TURN NAT kuralları (3478/udp+tcp, 5349/tcp, 49160–49199/udp; mimari §8.3.1) açılınca: UDP kapalı/5349 açık ağda TURN-TLS bağlantısı (AC-23; 443 doğrulaması P13), medya gecikme/akıcılık (AC-40) ve encoder/çözünürlük ayarları (AC-42) staging'de ölçülüp `docs/test-raporu.md`'ye yazılır. coturn kurulu, sunucu içi testler geçti | kullanıcı (NAT) → test-operatoru (+ devops) | NAT açılınca; en geç P6 başlamadan (P6 istemci ölçümleri aynı yolu kullanır) |
| S-P4-T3-1 (Düşük) | Misafir `rs.resume.*` kaydına zaman damgası; 120 sn'den eski kayıt okunmaz (kapatılan sekmeyi yeniden açma/çoğaltma ile paylaşılan bilgisayarda dönüş riski) | frontend-dev | P5 ilk düzeltme turu |
| S-P4-T3-2 (Düşük) | Misafir reconnect yeniden deneme süresi ≥100 sn (sunucu ölü soketi ~90 sn'de düşürür); `reconnect.conflict` audit'i oda başına dakikada 1 | frontend-dev + backend-dev | P5 ilk düzeltme turu |
| ~~S-P4-T2-2 kalan~~ **kapandı 2026-11-11** | `apps/server/scripts/` prod imajına giriyor (koruma: `NODE_ENV` + `E2E_REAL_ALLOW=1`); imajdan çıkarılması | devops | Kapandı (P5): `apps/server/Dockerfile` `prod-deps` aşamasında `rm -rf apps/server/scripts`; yerel `docker build --target runtime` imajında `/app/apps/server/scripts` yok, `migrate` hedefinde `prisma/seed.ts` + `tsx` mevcut (implementation.md DevOps P5) |
| TEST-P4-3 (Düşük) | "Permissions policy violation: camera" konsol uyarısı — kod kamera istemiyor; gerçek Chrome'da doğrulanacak (Chromium fake-media yan etkisi şüphesi) | kullanıcı / test-operatoru | Staging testinde |

### Sonra / açık — P3 kod turundan (2026-11-11)
Kaynak: `docs/guvenlik-raporu.md` "P3 kod turu", `docs/qa-raporu.md` P3. S-P3-1/2/4/5/6/7/9 P3 düzeltme turunda kapatılır (buraya yazılmaz).

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| S-P3-8 (Düşük, **P7 giriş şartı**) | WS 60 sn yeniden doğrulaması yetki daraltmasını yansıtmıyor; `rooms.endByTechnician` çağıransız (AC-115). P7'de: yeniden doğrulamada `user_permissions` tazelenir, caps daralırsa `caps.update`/`control.revoke`; pasifleştirme/rol değişimi/logout-all servisleri `endByTechnician`'ı çağırır; entegrasyon testi (mimari §10.2/§10.3 P7) | backend-dev | P7 (P7 başlamadan şart) |
| ~~S-P3-T2-1 (Düşük)~~ **kapandı 2026-11-11** | `deploy/turn/host-firewall.sh`: kurallar geçici zincirde kurulup atomik değiştirilecek (yarım uygulamada fail-open olmasın); IP doğrulaması oktet ≤ 255 + çok satırlı değer reddi (entrypoint dahil); `reserved_ok` kapsama kontrolü; `check` hatası journald'a `err` | devops | Kapandı: staging `install` geçici zincir + atomik değiştirme ile uygulandı, `check` OK, `journalctl -u remote-turn-fw -p err` boş (test-raporu "P3 staging altyapı kanıtı") |
| ~~S-P3-T2-2 (Düşük)~~ **kapandı 2026-11-11** | systemd timer repo klonundaki betiği root olarak çalıştırıyor: `install` betiği `/usr/local/sbin/remote-turn-fw` (root 0755) olarak kopyalasın, değerler `/etc/default/remote-turn-fw` (0600); runbook §9.2.1'e "betik güncellenince `install` yeniden çalıştırılır" notu | devops | Kapandı: staging'de `ExecStart=/usr/local/sbin/remote-turn-fw ensure`, `cmp` kurulu kopya = repo, `/etc/default/remote-turn-fw` root 0644 (secret içermez; runbook §9.2.1 gerekçesi), runbook notu var |
| S-P3-2 staging kanıtı — **güvenlik kısmı kapandı 2026-11-11, pozitif relay↔relay açık** | Staging yayınında `systemctl is-active remote-turn-fw.timer`, `ss -tlnp` (5766 yok, 9641 yalnız 127.0.0.1) ve `ss -ulnp` çıktısı test raporuna eklenecek (runbook §9.2.3) | devops + test-operatoru | Kapandı (güvenlik): §9.2.3 çıktıları + `test-denied.sh` bölüm 4 DROP satırları (3480/3478/53) PASS, test-raporu "P3 staging altyapı kanıtı". **Açık:** aralık içi relay↔relay echo (49199) staging'de hairpin gerektirir — pfSense NAT + NAT reflection açılınca `sudo -E ./test-denied.sh` yeniden koşulur (runbook §8.2) |
| S-P3-3 (Düşük) — prod IPv6 | TURN host'unda global IPv6 varsa relay'in IPv6 peer'lara açılmadığı (relay-ip/listening-ip yalnız IPv4 ya da host /64 + sağlayıcı IPv6 bloğu denied listede) prod ağında doğrulanacak; `test-denied.sh` IPv6 allocation denemesi PASS, sonuç runbook'a (ADR-0007 r5 madde 5). Staging'de global IPv6 yok | devops | P13 / prod açılışı öncesi |

### Sonra / açık — P2 kapanışından (2026-11-11)
Kaynak: `docs/guvenlik-raporu.md` (P2 turları), `docs/qa-raporu.md` (P2 tur 3). Kritik/Yüksek açık yok.

| Madde | Ne yapılacak | Sahip | Ne zaman |
|---|---|---|---|
| S-P2-4 (Düşük, kabul edilen kalan risk) | CGNAT arkasında aynı /24'ü paylaşan müşteriler, birinin hatalı kod denemeleriyle birlikte 15 dk kilitlenebilir (link yolu etkilenmez). 429 ekranı linke yönlendiriyor (metin düzeltildi); önek bazında 429 sayısı alarm sayacına eklenecek | backend-dev | P3 |
| S-P2-5 (Düşük) | Staging'de Caddy'nin gerçek istemci IP'sini gördüğü IPv4 ve IPv6 ile ayrı ayrı doğrulanacak (`request.remote_ip`); `172.30.0.1` görünürse userland-proxy kapatılıp IPv6 açılacak ya da yayın yalnız IPv4'e bağlanacak; sonuç runbook'a | devops | P3 öncesi **Durum (2026-11-11): IPv4 GEÇTİ.** NAT 4450 açıldı (kaynak adres korunuyor); dış makineden audit IP ve Caddy `remote_ip` istemcinin genel IPv4'üyle eşleşti. IPv6: staging VM'de global IPv6 yok, yayın yalnız IPv4 → prod ağında ayrıca doğrulanacak (açık) |
| P3 giriş şartı 1 | `GET /public/agent/download?ref=` kod yolu gibi hız sınırlı olacak ve yalnız PENDING oturumda yanıt verecek (`sessionRef` süresiz geçerli, dosya adı kodu taşır) | backend-dev | **P6'ya bağlandı (2026-11-11):** bağlayıcı gereksinim mimari-api public tablosu (download satırı) + mimari §10.2/§10.3 P6 satırı (test: 302/410/404/429) |
| P3 giriş şartı 2 | join/admit tüketimi tek atomik `UPDATE … WHERE status='PENDING' AND expires_at > now` ile; iptal/süre dolumu ile yarışta tek kazanan (P2 iptal kalıbı örnek) | backend-dev | P3 — **Karara bağlandı (2026-11-11):** mimari-protokol §3.2 (SQL, count=0 eşlemesi, yarış testi), mimari-akislar A1/A2 |
| P3 giriş şartı 3 | Public resolve `Origin` zorunlu tutuyor (routes.ts), Agent (P6) tarayıcı değil: ayrı, belgelenmiş bir Origin değeri ya da `clientKind=AGENT` için Origin muafiyeti kararı (mimari/ADR) | mimar | **Kapandı (2026-11-11): ADR-0012** — Origin varsa allowlist + BROWSER, yoksa yalnız AGENT (+`Sec-Fetch-*` yok); join'de kind nonce'tan; mimari-api "Public istemci türü", T27. Guard P3'te (backend-dev) |
| P3 coturn staging NAT | Üst NAT'ta 185.126.217.99 → 192.168.25.10: 3478/udp, 3478/tcp, 5349/tcp, 49160–49199/udp (1:1, kaynak adres korunarak; tercihen hairpin) — mimari §8.3.1 | Kullanıcı (ağ yöneticisi) + devops (runbook) | P3 coturn testinden önce |
| QA önerisi | `apps/web/lib/startup-check.ts` için birim testi: `process.exit` taklit edilerek sır yokken `exit(1)`, sır varken çağrılmadığı doğrulanacak | frontend-dev | Sonra |
| Staging teknisyen hesabı | Seed teknisyen oluşturmuyor; P9 kullanıcı yönetimine kadar ADMIN/USER hesabı SQL ile eklenir. Prosedür runbook §6'ya yazılacak | devops | P3 öncesi **Durum: tamam (2026-11-11)** — `deploy/staging-users.sh`, runbook §6; staging'de demo tenant + ADMIN + USER oluşturuldu, parolalar `/opt/remote/deploy/ACCESS.txt` |
