# Remote Support — Nokta Bilişim uzaktan destek platformu

Self-hosted, çok kiracılı (multi-tenant) uzaktan destek platformu. Teknisyen web konsolundan bir destek
oturumu açar; müşteri taşınabilir Windows istemcisi (tam erişim) veya tarayıcı (yalnız görüntü) ile katılır.
Görüntü eşler arası WebRTC ile akar; sunucu yalnız sinyalizasyon ve meta veri tutar.

## Şu anki durum: P1–P13a tamamlandı, P13b (prod açılışı) kodu hazır, P14a/P14b, P15, P16, P17 (istemci 0.11.0), P18 (talep iletişimi), P19 (web talep formu, SMS, müşteri bildirimi, müşteri CSV) P20 (istemci 0.12.0), P27a (2FA'da cihaz hatırlama), P27 (gözetimsiz erişim; prod'da kapalı) ve P28a (pano paylaşımı + uzaktan yazdırma, istemci 0.13.0) kodlandı (QA sürüyor)

İş P1..P13 dikey paketlerle yürür (`docs/mimari.md` §10). P1–P11 ve **P12** (firma ve sistem logosu, kullanıcı profil
resmi, kullanıcı başına tema, hesap menüsü, tasarım token lint kuralı) tamamlandı: P12 güvenlik Kritik/Yüksek 0 (doğrulama
turu GEÇTİ), sayfa testi gerçek server ile GEÇTİ, QA Tur 2'nin tek maddesi (P11'e ait kararsız e2e testi) düzeltildi
(`docs/arsiv/p12-qa-raporu.md`, `docs/arsiv/p12-test-raporu.md`, `docs/guvenlik-raporu.md`). **P12b** (Super Admin
"WhatsApp servisi" sistem ayarı, AC-196) tamamlandı: QA Tur 3 GEÇTİ, güvenlik Kritik/Yüksek/Orta 0 (`docs/qa-raporu.md`,
`docs/guvenlik-raporu.md`). P11, P12 ve P12b staging'e yayınlandı (yayın kayıtları runbook §15, §16, §17). Windows istemci **0.10.2** qa ve güvenlik denetiminden geçti. Gerçek
Windows'ta elle testler (P7, P8b-2, P8c-2, 0.10.2) ve AC-192 staging ölçümü bekliyor. **P13a** (saklama işi, şifreli
yedek/geri yükleme, runbook senaryo dizini, dokümantasyon PDF'leri) staging'e yayınlandı (runbook §18.7). **P13b**
(prod açılışı: imzalı yedek, site dışı kanca, `reset-superadmin`, `remote-watch`, `proxy-guard`, TURN 5349 ve sertifika
kancası, HSTS `includeSubDomains`, WhatsApp servis anahtarı) kodlandı; prod terfisi imzalı açılış kontrol listesiyle yapılır
(runbook §20, ADR-0019). Açık maddeler `docs/gereksinimler-sonra-acik.md`.

Prod: **https://remote.noktabilisim.net** (Let's Encrypt; host nginx → Caddy `127.0.0.1:4451`). Staging yığını `/opt/remote`
içinde yerinde prod'a terfi eder; IP girişi `https://185.126.217.99:4450` açılış imzasından sonra kapanır (`CADDY_BIND=127.0.0.1`).
P13c'ye kadar ayrı staging yoktur; yeni kod yerelde (`scripts/e2e-real.sh`) denenir.

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
  döner); istemci arayüzü yalnız açık temadadır. (Fare imleci P8'de görüntüye eklendi.)

**P7 — uzaktan kontrol** (yalnız Hızlı Destek istemcisi; tarayıcı misafiri yalnız görüntüler)

- Konsolda **Kontrol iste** → müşteride izin diyaloğu. "Reddet" varsayılan ve odakta; "İzin ver" 1,5 sn sonra
  etkinleşir; Enter/Space izin vermez; teknisyenin uzaktan (enjekte) tıklaması izin sayılmaz; diyalog fare imlecinin
  altında açılmaz. Ret sonrası 30 sn yeni istek iletilmez; oturum başına en çok 5 istek.
- İstek bekliyorken **Vazgeç** (`control.cancel`); izin gelince **Kontrol sizde** + kırmızı çerçeve. **Kontrolü bırak**
  müşteri tarafında da kapıyı kapatır (`control.release`); **Kontrole devam** yeni istektir, müşteri yeniden onaylar.
- Fare (sol/sağ/orta, tekerlek, sürükleme) ve klavye (Türkçe karakterler düzenden bağımsız). **Özel tuşlar** menüsü:
  Alt+Tab, Win, Win+D/R/E, Alt+F4, Ctrl+Shift+Esc, Print Screen. Ctrl+Alt+Del ve Win+L gönderilmez. Klavye
  odağından çıkış: Ctrl+Alt+Shift. Tam ekranda (Chromium) sistem tuşları doğrudan yakalanır.
- "%100" görünümü müşterinin monitörünü piksel piksel (1:1) gösterir. Sahne 960 px'ten darsa monitör, Sığdır/%100 ve
  Tam ekran **Görünüm** menüsünde toplanır.
- Monitör değiştirme müşteri onayı ister (aynı diyalog kuralları; ret anında konsola bildirilir).
- Müşteri kontrolü **Kontrolü kapat** düğmesiyle veya **Ctrl+Shift+F12** (kayıt edilemezse Ctrl+Shift+F11) ile
  anında kapatır. İkisi de kaydedilemezse izin verilemez. Müşteri kendi faresini/klavyesini kullanınca uzaktan girdi
  ~1 sn durur. Gösterge "Uzaktan kontrol aktif — <teknisyen>" olur.
- Konsol uyarıları: yükseltilmiş (yönetici) pencere, güvenli masaüstü (UAC/kilit ekranı), istemcinin yönetici olarak
  çalışması.
- Kopma, teknisyen sekmesi değişimi/yenilemesi, oturum sonu ve yetki kaldırılması kontrolü kapatır; yeniden bağlanınca
  yalnız görüntüleme ile başlanır. Yetki: `remote_control.use`.
- Her istek, izin, ret, bırakma, iptal ve kapanış `session_consents` + audit'e yazılır. İzin kaydı yazılamazsa
  (hata veya 800 ms) kontrol açılmaz (fail-closed).
- Migration `20261111050000_p7_consent_source_tech` (`session_consents.source` += `TECH`); yeni ortam değişkeni yok.
  Yayında migrate server'dan önce çalışmalıdır (compose bunu kendisi yapar, bkz. "Deploy").
- Bilinen sınırlar: Windows elle testi bekliyor; UIAccess yetkili yerel bir programın
  ürettiği girdi gerçek kullanıcı girdisinden ayırt edilemez (kapsam dışı, `docs/implementation.md` Agent P7 tur 2).

**P8 — oturum geçmişi** (sürüm 0.8.0)

- Kenar menüsünde **Oturum geçmişi** (`/history`): tarih aralığı (Türkiye saatiyle gün), durum, bağlantı
  (İstemci/Tarayıcı), teknisyen, müşteri adı ve (Super Admin) firma filtreleri; 10/25/50/100 kayıtlık sayfalar.
  Filtreler adres çubuğunda kalır. USER yalnız kendi oturumlarını, ADMIN firmasının tümünü, Super Admin tüm firmaları
  ("Firma" sütunuyla) görür. Kapsam dışı oturum her uçta 404'tür.
- **Oturum ayrıntısı** (`/history/<id>`): özet, müşteri adı ve e-postası, onay kayıtları (KVKK metin sürümüyle),
  uzaktan kontrol dönemleri (verilme/kapanma zamanı, kapatan, neden; müşteri istemcisi yönetici olarak çalışıyorsa
  uyarı), zaman çizelgesi (en çok 500 olay), kalite özeti, dosya aktarım kayıtları.
- **Ticket no** (≤ 50) ve **not** (≤ 4.000 karakter) ayrıntı ekranından eklenir (`session_history.edit`). Not metni
  audit'e yazılmaz; yalnız uzunluğu yazılır.
- **CSV dışa aktarma** (`session_history.export`): filtrelenmiş liste; UTF-8 BOM, `;` ayraç, Türkiye saati, Türkçe
  etiketler; Excel (tr-TR) dosyayı doğrudan sütunlara açar. Formülle başlayan hücreler `'` ile metne çevrilir. En çok
  50.000 satır, kullanıcı başına dakikada 5. Her dışa aktarma `session.exported` olarak audit'e yazılır.
- Yetkiler: `session_history.view / edit / export` (ADMIN varsayılan açık, USER kapalı).
- **Hızlı Destek istemcisi:** müşterinin fare imleci (şekliyle) görüntüye çizilir; ekran durgunken de imleç akıcı
  hareket eder. Windows'ta elle doğrulama bekliyor.
- **Veritabanı:** migration `20261111060000_p8_session_history` (müşteri adı/e-postası, ticket, not, 3 indeks) ve
  `20261111070000_enum_check_binary` (ADR-0014: enum CHECK'leri harf/aksan/boşluk duyarlı). Yayından önce salt okunur
  ön kontrol gerekir (`docs/runbook.md` §6.1). Yeni ortam değişkeni yok.
- Bilinen sınırlar: teknisyen/firma filtre seçenekleri o sayfadaki kayıtlardan gelir (tam liste P9); detayda Dosyalar
  tablosu dar ekranda sıkışık (TEST-P8-1).

**P8b-1 — müşteri destek talebi (sunucu + panel; ADR-0016)**

- Her firmaya özel indirme bağlantısı ve dosya (`NoktaDestek-<firma>-<ref>.exe`, aynı imzasız ikili). Müşteri bu
  dosyadan ad, telefon, açıklama ve KVKK onayıyla talep gönderir (müşteri ekranı istemci 0.9.0'da, aşağıda P8b-2).
- Kenar menüsünde **Talepler** (`/requests`, `support_requests.view`): canlı kuyruk, bekleyen sayısı rozeti, yeni
  talepte bildirim ve ses, 6 haneli talep kodu, kaynak işaretleri ("Güvenilen ağ", "Bu bilgisayar daha önce destek
  aldı", "İlk kez görülen kaynak"), **Kabul et** (doğrudan konsol) ve **Reddet** (müşteriye mesaj). "Geçmiş" sekmesi
  son 30 gün. Kabul/ret için `support_requests.accept`.
- **Ayarlar > Destek talepleri** (`/settings/support-requests`, `settings.edit`): indirme bağlantısı + kopyala +
  yenile, bekleme süresi 10–120 dk, WhatsApp alıcıları (≤ 5) + test mesajı, güvenilen IP/ağlar (≤ 10). E-posta kanalı P10'da eklendi.
- Oturum geçmişinde "Kaynak" filtresi, talep bölümü ve CSV'de `Kaynak`/`Bekleme` sütunları.
- Hız sınırları, bekleyen talep tavanları (IP 3, ağ 10, firma 50), aşırı yükte 503 + `Retry-After`.
- **Veritabanı:** migration `20261112000000_p8b_support_requests`; seed yeni aydınlatma sürümü ekler. Yeni ortam
  değişkenleri `WHATSAPP_SERVICE_URL`, `MIN_AGENT_VERSION`. Yayın ve geri alma: `docs/runbook.md` §12.

**P8b-2 — Windows istemci 0.9.0: "Destek iste" (ADR-0016, mimari-e9 §13)**

- Firma dosyası (`NoktaDestek-<firma>-<ref>.exe`) açılınca firma penceresi gelir: firma adı yalnız sunucudan, alt
  satırda sunucu · sürüm · parmak izi, dolandırıcılık uyarısı, (tanımlıysa) "Kötüye kullanımı bildir". Form: ad soyad,
  telefon, e-posta (isteğe bağlı), sorun, aydınlatma metni + onay kutusu; Enter = **Destek iste**, hatada ilk hatalı
  alana odak.
- **Hatırla:** "Bilgilerimi bu bilgisayarda hatırla" ilk açılışta işaretsiz; işaretlenirse ad/telefon/e-posta
  yalnız talep oluşunca `%LOCALAPPDATA%\NoktaDestek\hatirla.bin`'e DPAPI (CurrentUser) ile şifreli yazılır.
  Hatırlanan ad veya telefon değişirse kutu kendiliğinden kalkar. **Bilgilerimi unut** dosyayı ve boşsa klasörü siler.
- Bekleme ekranı: 6 haneli talep kodu, "Sırada n. talepsiniz", geçen süre; **Talebi iptal et** veya pencereyi
  kapatma talebi iptal eder. Kopmada 110 sn içinde artan aralıklarla yeniden bağlanır.
- Kapanış ekranları: iptal, zaman aşımı ("Yeniden talep oluştur" form dolu açılır), ret ("Firmanızın mesajı:"),
  bağlantı kurulamadı.
- Teknisyen kabul edince onay diyaloğu (P7 izin kuralları: odak "Vazgeç", 1,5 sn kilit, uzaktan tıklama sayılmaz):
  **Ekranımı paylaş** → lobi ve kabul kodu olmadan doğrudan oturum; **Vazgeç** → paylaşım yok. Onay 60 sn içinde
  verilmezse "Bağlantı süresi doldu".
- **Teknisyenden kod aldım** eski 8 haneli kod akışına geçer; `Destek-<8 hane>.exe` ve `NoktaDestek.exe` eskisi gibi
  çalışır.
- `MIN_AGENT_VERSION` altındaki firma dosyası form göstermez, "Yeni sürümü indir" sunar. Talep oluşturmada yalnız
  503 `NOT_READY` bir kez otomatik denenir (`Retry-After`, 1–15 sn + rastgele); diğer hatalarda müşteri yeniden basar.
- Sunucu ve panelde değişiklik yok; yeni bağımlılık yok. Yayın: runbook §11 (`build.sh … 0.9.0`).

**P8c-1 — müşteri firmalar ve bilgisayar kaydı (sunucu + panel; ADR-0017, `docs/mimari-e10.md`)**

- **Müşteriler** ekranı (`/customers`, menüde Talepler'den sonra): müşteri firma ekle/düzenle, arama (ad, yetkili kişi,
  telefon), Aktif/Pasif/Tümü filtresi. Silme yok; **Pasife al** ve **Yeniden aktif et** var. Ad firma içinde tekildir.
- Her müşteriye kalıcı indirme bağlantısı ve `NoktaDestek-<etiket>-<ref>.exe` dosyası ("Kopyala"). Bu dosyadan gelen
  talepler kuyruğa müşteri firmanın adıyla düşer. **Bağlantıyı yenile** eski dosyaları ve o müşterinin kayıtlı
  bilgisayarlarını geçersiz kılar. "Müşteriye nasıl gönderilir?" yardımı.
- Müşteri detayı: bilgiler, bağlantı, durum işlemleri, **Talepler** ve **Oturumlar** sekmeleri.
- Firma bağlantısı artık **Genel bağlantı**; müşterisiz talepler "Genel" görünür.
- Talepler: "Müşteri firma" satırı, Tümü/Genel/müşteri filtresi, toast'ta firma adı; kayıtlı bilgisayardan gelen talepte
  "Kayıtlı bilgisayar — <firma>" rozeti ve **Bu bilgisayarın kaydını iptal et**. Oturum geçmişinde "Müşteri firma"
  sütunu, filtresi ve CSV sütunu. Yeni Destek Oturumu'nda isteğe bağlı müşteri seçimi.
- **Bilgisayar kaydı:** başarılı oturumdan sonra 0.10.0+ istemciye `/ws/guest` üzerinden kayıt anahtarı verilir
  (sunucuda yalnız SHA-256). Anahtar yalnız talep açar; oturum veya uzaktan erişim yetkisi vermez.
- Yetkiler: `customers.view`, `customers.create`, `customers.edit` (düzenle, bağlantıyı yenile, yeniden aktif et, tek
  kayıt iptali), `customers.delete` (pasife alma). Admin'de varsayılan açık, User'da kapalı.
- Migration `20261112120000_p8c_customers`, yeni aydınlatma metni sürümü (seed). Yeni env yok. Yayın: runbook §13.

**P8c-2 — Windows istemci 0.10.0: kalıcı "Destek iste" (bilgisayar kaydı)**

- Bir kez başarılı oturum yapılan bilgisayar firmayı hatırlar: kayıt `%LOCALAPPDATA%\NoktaDestek\hatirla.bin`'e (DPAPI,
  format v2) yazılır. Sonraki açılışta hangi NoktaDestek dosyası olursa olsun ana ekran açılır.
- Ana ekran: **Destek iste** (birincil) · **Bağlantı kodum var** (8 haneli kod) · **Bu bilgisayarı unut** · **Kötüye
  kullanımı bildir**. Kayıtlıysa "Bu bilgisayar <firma>[ – <müşteri>] için kayıtlı" yazar.
- Süresi dolmuş `Destek-<kod>.exe` veya geçersiz firma dosyası, kayıt varsa ana ekrana düşer. Kayıt geçersizse silinir
  ve "Bu bilgisayarın destek kaydı artık geçerli değil…" gösterilir (kişisel bilgiler kalır).
- Karşılama ve talep formunda bilgi satırı: "Oturumdan sonra bu bilgisayar <firma> için hatırlanır…".
- 0.9.x istemciler müşteri dosyasıyla talep açmaya devam eder; `MIN_AGENT_VERSION` değişmedi.
- Tekrarlanabilir derleme SHA-256 `5255edc87840f18b28eb608c705bf2c16230a3a7cb0da49145a46e5ecbf721f3`. Yayın: runbook
  §11 (`build.sh … 0.10.0`), §13.7.

**İstemci 0.10.1 / 0.10.2 (düzeltmeler)**

- 0.10.1: teknisyenin gönderdiği dosyalar geç gelen son parçalar yüzünden "Dosya bozuk" olabiliyordu; istemci son
  parçaları en çok 10 sn bekler.
- 0.10.2: ekran yakalama sırayla DXGI → DXGI `DuplicateOutput1` (HDR) → GDI (10 fps) dener. Hepsi başarısız olursa
  müşterinin durum satırında neden kodu görünür (ör. "Ekran görüntüsü alınamadı (DXGI_UNSUPPORTED). Ekran kartı ayarını
  kontrol edin."). Kalıcı modda ve yalnız sorun olduğunda `%LOCALAPPDATA%\NoktaDestek\tanilama.log` yazılır (≤ 256 KB,
  kişisel veri yok; kod modunda ve yönetici olarak çalışırken yazılmaz). SHA-256
  `85142c14bf6941c2d5c3803b2818f0b1645c95b77704e640c8ff49d4059687bc`.

**P27a — 2FA'da "Bu cihazı 30 gün hatırla"** (AC-325..335b; kod tamam, QA ve güvenlik kod turu düzeltmeleri yapıldı)

- Girişteki kod adımında isteğe bağlı kutu (varsayılan işaretsiz). İşaretlenirse o tarayıcıda 30 gün yalnız şifre sorulur;
  hassas işlemlerde (step-up) kod yine istenir. **Super Admin hesaplarında yoktur.**
- Hesabım → "Hatırlanan cihazlar" (tek tek / tümünü kaldır), kullanıcı düzenlemede Admin için sayı + "Hatırlanan cihazları
  kaldır", Ayarlar → Güvenlik'te firma anahtarı "2FA cihaz hatırlama" (**mevcut firmalarda da varsayılan açık**).
- Yeni cihaz hatırlanınca ve çalınmış çerez şüphesinde kullanıcıya e-posta; şifre değişimi, 2FA sıfırlama, tüm cihazlardan
  çıkış gibi olaylar hatırlamayı siler. Çerez `__Secure-rs_td` (`Path=/api/v1/auth`). Migration `20261121000000_p27a_trusted_devices`; yeni env yok.

**P28a — pano paylaşımı ve uzaktan yazdırma, istemci 0.13.0** (AC-343..352, AC-404; kod tamam, qa GEÇTİ, güvenlik kod turu 1
GEÇTİ; Windows elle turu bekliyor; staging'e çıkar, prod P28 sonunda)

- Konsolda "Pano ve yazdırma" bölümü: **Panoyu gönder** / **Müşteri panosunu al** (düz metin ≤ 64 KB; kontrol izni + müşterinin
  "Pano paylaşımına izin ver" kutusu) ve **Uzaktan yazdır** (PDF ≤ 20 MB, müşterinin varsayılan yazıcısına, her belgede müşteri onayı).
- Windows istemci 0.13.0: oturum penceresinde pano kutusu, yazdırma onay penceresi, 3 sn bildirim; PDF Windows.Data.Pdf ile
  yalıtılmış alt süreçte çizilir, GDI ile basılır (ADR-0031). İçerik sunucudan geçmez (DataChannel).
- Yeni yetkiler `remote_control.clipboard`, `file_transfer.print`; audit `clipboard.consent`, `clipboard.transfer`, `print.job`.
  Yeni env, tablo, migration yok. Gözetimsiz oturumda ve tarayıcı müşterisinde kullanılamaz. Protokol: `docs/api.md`
  "Pano ve uzaktan yazdırma (P28a)"; metrik ve sorun giderme: [`docs/runbook.md`](docs/runbook.md) §28a.

**P27 — gözetimsiz erişim** (AC-273..275, 293..297, 336..342; kod tamam, QA/güvenlik ve Windows elle turu sürüyor;
**prod'da kapalı** — SignPath imzası gelene kadar `UNATTENDED_MODE=off`)

- İkinci Windows ikilisi **`NoktaDestekServis.exe`** (`apps/agent-win/cmd/noktadestek-servis`): yönetici yetkisiyle kurulan
  SYSTEM hizmeti + tepsi + tek ayar penceresi; tek kullanımlık kayıt koduyla firmaya bağlanır, kilit ekranı ve UAC dahil
  görüntü/girdi, her monitörde kapatılamayan gösterge, cihazda yerel kapatma anahtarı, "Uygulamalar"dan iz bırakmadan kaldırma.
- Panel: "Gözetimsiz cihazlar" (`/unattended`, `/unattended/codes`, `/unattended/[id]`), müşteri ayrıntısında bildirim
  adresleri; yetkiler `unattended.connect`, `unattended.manage`; cihaz başına teknisyen yetkisi (varsayılan kapalı); her
  bağlantıda kimlik doğrulaması (step-up tüketilir) ve müşteriye e-posta. Firmanın kendi SMTP kaydı zorunlu.
- Sunucu: `/api/v1/unattended/*`, `/ws/device` (Ed25519 meydan okuma). Yeni env `DEPLOY_ENV` (artık server da okur),
  `UNATTENDED_MODE`, `UNATTENDED_SIGNED_SHA256`, `UNATTENDED_AGENT_SHA256`. Yayın, imza kapısı ve sorun giderme:
  [`docs/runbook.md`](docs/runbook.md) §27; uçlar `docs/api.md` "Gözetimsiz erişim (P27)".

**P20 — Windows istemci 0.12.0** (AC-253..255; kod tamam, QA tur 1 ve güvenlik kod turu 1 bulguları düzeltildi; Windows CI,
Windows elle turu ve AV kapısı bekliyor)

- İsteğe bağlı **Tepside çalıştır** ve **Windows açılışında başlat** (`HKCU\…\Run` → `"<exe>" --tray`; açılışta pencere, ağ,
  kısayol yok; klasör ACL / yükseltilmiş süreç / geçici ya da ağ konumu denetimi, program yoksa değer silinir).
- Bir bilgisayarda aynı sunucuda **en çok 5 firma** kaydı: firma listeli ana ekran, firma seçerek "Destek iste", "Bu firmayı
  unut", "Bu bilgisayarı unut (tüm firmalar)". Kayıt dosyası `kayitlar.bin` v3 (0.10/0.11 `hatirla.bin` kayıpsız göç) +
  süreçler arası `kayitlar.lock`. Sunucu eki `binding.offer.multi` / `previousKeys` / `previousIndex` / `BINDING_LIMIT`
  (başka firmanın kaydı asla iptal edilmez; `docs/api.md` "Çoklu firma kaydı (P20)").
- Bekleme ekranında **talep öncesi sohbet** (`/ws/request`, `rs.cap.chat1`; P18 sunucusu). Şema, migration, yeni env yok.
  Yayın: etiket `v0.12.0` (imzasız; prod öncesi runbook §24.10 AV kapısı). Ayrıntı [`CHANGELOG.md`](CHANGELOG.md), runbook §24.8–24.11.

**LG — müşteriye bağlantı gönderme** (AC-405..428): tek "Müşteriye gönder" penceresi (oturum kartı, kayıt kodu, müşteri
ayrıntısı) ile oturum bağlantısı + Windows programı, kayıt kodu + servis kurulum bağlantısı (yalnız e-posta, kod başına 3)
ve müşteri bağlantıları e-posta / WhatsApp / SMS ile gönderilir. Uçlar `docs/api.md` "Müşteriye bağlantı gönderme".

**P19 — web talep formu, SMS ve müşteri bildirimi, müşteri CSV** (AC-259..261, 263; kod tamam, QA/güvenlik ve staging testi sürüyor)

- Web talep formu `/r/<ref>`: müşteri program indirmeden tarayıcıdan talep açar, beklerken teknisyenle yazışır, kabulde
  ekranını paylaşır (yalnız görüntü). Ayarlar → Destek talepleri'nde aç/kapa (kapatınca form bağlantıları hemen geçersiz).
- Ayarlar → SMS (smsportal adresi, şifreli API anahtarı, başlık, test SMS); oturum bağlantısını SMS / WhatsApp ile gönderme
  (yetki `sessions.send_link`); web talebinin kabul/ret/süre dolumunda müşteriye SMS / WhatsApp / e-posta durum bildirimi
  (kalıcı kuyruk, alıcı ve firma tavanları).
- Müşteri CSV dışa / içe aktarma (önizleme, hata raporu, Atla / Güncelle; yetkiler `customers.export`, `customers.import`).
  Yeni env `SMSPORTAL_URL`; tetikleyici sayısı 23; ayrıntı `CHANGELOG.md`, runbook §26.

**P18 — talep iletişimi** (AC-255..258; kod tamam, düzeltme turu 1 bitti, QA/güvenlik yeniden denetimi ve staging testi bekliyor)

- Kabul öncesi mesajlaşma (teknisyen paneli; şifreli saklama, mesaj başına 1.000 karakter, talep başına 200 mesaj). Müşteri
  tarafı P19 (tarayıcı) ve P20 (Windows istemci 0.12.0) ile gelir.
- Talep atama ("Bana atanan / Atanmamış" filtresi, atanana bildirim), Düşük/Normal/Yüksek öncelik, SLA (ilk yanıt, yalnız
  mesai içinde işler; geçmiş ayrıntısında ve CSV'de "SLA aşıldı").
- Ayarlar → Mesai saatleri ve Tatiller (TR resmî tatilleri tek tuşla); mesai dışı talebi al ya da reddet. Yeni yetkiler
  `support_requests.assign`, `support_requests.message`. Tetikleyici sayısı 23; ayrıntı `CHANGELOG.md`, runbook §25.

**P17 — Windows istemci 0.11.0** (kod tamam, güvenlik tur 2 Kritik/Yüksek 0; Windows elle turu ve Release bekliyor)

- "Yalnız bir pencere" paylaşımı (Windows.Graphics.Capture); kontrol pencereyle sınırlı, kabuk kısayolları ve
  erişilebilirlik kısayolları pencere modunda iletilmez. Konsolda "Pencere paylaşımı" rozeti.
- Paylaşım hata nedeni ve yöntemi konsola (`share.state.reason/method`; yeni kodlar `WGC_UNSUPPORTED`, `WINDOW_CLOSED`,
  `WINDOW_UNAVAILABLE`), kabul kodu gösterimi (`admitCode`), koyu tema, donanım kodlayıcıdan yazılıma kesintisiz geçiş,
  kirli bölge dönüşümü, `%LOCALAPPDATA%\NoktaDestek` için junction/sembolik bağ koruması.
- Yayın: etiket `v0.11.0`; onay (`agent-release`) → isteğe bağlı SignPath imzası → attestation → Release. P15 sunucusu
  prod'da olmadan yayımlanmaz. Adımlar runbook §24; ayrıntı [`CHANGELOG.md`](CHANGELOG.md).

**P9 — kullanıcı, yetki ve firma yönetimi**

- **Kullanıcılar** (`/users`): arama, rol/durum filtresi; **Yeni kullanıcı** geçici şifreyi yalnız bir kez gösterir,
  kullanıcı ilk girişte şifresini değiştirir. Detayda profil, rol, hesap durumu ve modül bazlı **yetki toggle'ları**
  ("Tümünü aç/kapat"). Yetki listesi tek tanımdan gelir (`packages/contracts/src/permissions.ts`); yeni modül eklenince
  ekrana kendiliğinden düşer.
- İşlemi yapanda olmayan yetki **kilitli** görünür ve verilemez (sunucu da 403). Admin kendinden geniş yetkili hesabı
  yönetemez; kimse kendi rolünü/yetkisini değiştiremez. **Pasife al / Yeniden etkinleştir**; kalıcı silme yok.
- Pasife alma ve rol değişimi kullanıcının açık destek oturumlarını hemen sonlandırır; yalnız yetki değişimi açık
  oturumlara anında uygulanır.
- **Firmalar** (`/admin/tenants`, Super Admin): oluştur, düzenle, pasife al (kısa adı yazarak onay), yeniden etkinleştir.
  Üst menüdeki **firma seçici** ile firmaya geçilir veya bağlamdan çıkılır.
- `GET/PUT /settings/tenant` (oturum süresi, sınırlar, saklama süresi) yalnız API'de.
- Şema, migration, yeni env yok. Firma oluşturma öncesi doğrulama: runbook §14.1.

**P10 — hesap güvenliği ve e-posta (SMTP)**

- **İki adımlı doğrulama (2FA, TOTP):** Google Authenticator, Microsoft Authenticator gibi uygulamalarla. Kurulum
  (`/2fa/setup`): QR veya elle anahtar → 6 haneli kod → 10 tek kullanımlık kurtarma kodu (yalnız bir kez gösterilir;
  kopyala / `.txt` indir; "Kaydettim" işaretlenmeden devam yok). Super Admin ve Admin için **zorunlu**; teknisyenler
  (User) için firma ayarı "Teknisyenler için zorunlu" (varsayılan açık). Kurulmamışsa panel kurulum ekranına yönlendirir.
- Girişte 2FA etkinse `/login/2fa`: uygulamadaki kod veya kurtarma kodu. Kod girilmeden panel, API ve WebSocket kapalı.
  Deneme sınırı: hesap+IP 5 / 5 dk, hesap geneli 15 / 15 dk.
- **Şifremi unuttum** (`/forgot-password`): firma SMTP'si üzerinden 30 dk geçerli, tek kullanımlık bağlantı
  (`/reset-password#token=…`). Yanıt hesabın var olup olmadığını söylemez. Sıfırlama tüm oturumları kapatır.
- **Hesap güvenliği** (`/account`, P12'den beri adı "Hesabım"; üst menüde avatar): şifre değiştir, 2FA durumu ve kalan kurtarma kodu, **Tüm
  cihazlardan çıkış** (diğer oturumlar ve açık destek oturumları 5 sn içinde kapanır). Oturum boşta 30 dk, mutlak 8 sa.
- **Ayarlar > E-posta (SMTP)** (`/settings/smtp`): sunucu, port (25/465/587/2525), güvenlik Yok/SSL/TLS, kullanıcı,
  şifre (maskeli, şifreli saklanır, forma geri yazılmaz), gönderen adı/adresi, **Test Maili Gönder**, ayarı kaldırma.
  İç ağ / özel IP adresleri ve sunucunun kendi adresi reddedilir. **Ayarlar > Güvenlik** (`/settings/security`):
  teknisyen 2FA zorunluluğu.
- E-posta kullanan özellikler: şifre sıfırlama, hesap kilidi bildirimi (saatte en çok 1), 2FA etkinleştirildi bildirimi,
  yeni destek talebi bildirimi (Ayarlar > Destek talepleri, ≤ 5 alıcı + test), oturum bağlantısını müşteriye
  e-postayla gönderme (teknisyen başına saatte 20).
- Admin kullanıcı detayında **2FA'yı sıfırla** (kullanıcının oturumları ve açık destek oturumları kapanır).
- Super Admin'in firması olmadığından SMTP'si yoktur: şifre/2FA kurtarma sunucuda yapılır (runbook §14 P10).
- Migration `20261112180000_p10_account_security`; yeni ortam değişkeni **`APP_ENCRYPTION_KEYS`** (zorunlu); yeni
  bağımlılıklar `nodemailer` 10.5.0 (MIT-0), `qrcode` 1.5.4 (MIT); geliştirme: `smtp-server` (MIT-0, testte sahte SMTP).

**P11 — audit log ekranı, sistem ayarları, aydınlatma metni**

- **Audit log** (`/audit`, menüde kaydırma kâğıdı simgesi; `audit.view`): salt okunur liste, filtreler (tarih aralığı —
  varsayılan son 30 gün, en çok 731 gün —, kullanıcı, işlem/işlem grubu, sonuç; firma seçmemiş Super Admin için firma),
  "Daha fazla yükle" ile 50'şer kayıt, ayrıntı penceresi (eski → yeni değer; gizli değerler maskeli, e-posta/test
  kayıtlarında yalnız neden sınıfı), **CSV indir** (`audit.export`; ≤ 50.000 satır, formül kaçışlı). Düzenleme/silme yok:
  API yazma metotlarına 405, veritabanında UPDATE ve 730 günden yeni kaydı silme tetikleyiciyle reddedilir.
- **Sistem ayarları** (`/admin/settings`, yalnız Super Admin): **MySQL** (host, port 3306, veritabanı, kullanıcı, maskeli
  şifre; **Bağlantıyı Test Et** ≤ 10 sn; kayıtlı şifre yalnız aynı hedefe kullanılır; kayıt çalışan bağlantıyı
  değiştirmez — `.env` + yeniden başlatma, ADR-0003) ve **TURN** (adres listesi, coturn `static-auth-secret` ile aynı
  gizli anahtar, "Ortam değerlerine dön").
- **Ayarlar > Aydınlatma metni** (`/settings/consent-text`): firma KVKK metnini düzenleme; her kayıt yeni sürüm, verilmiş
  onaylar kendi sürümüne bağlı kalır; sürüm geçmişi (SHA-256).
- Migration `20261113090000_p11_system_settings_audit` (`system_settings`, audit tetikleyicileri). MySQL'de
  `--log-bin-trust-function-creators=1` bayrağı gerekir (compose'da var; runbook §15). Yeni ortam değişkeni ve yeni
  bağımlılık yok.

**P12 — marka ve kişiselleştirme**

- **Hesap menüsü** (üst menüde avatar): Hesabım, Şifre değiştir, Tema (Açık / Koyu / Sistem), Çıkış. `/account` sayfasının
  adı **Hesabım**; Profil (profil resmi) ve Görünüm (tema) bölümleri eklendi.
- **Profil resmi (avatar):** kullanıcı kendi resmini yükler (tarayıcıda kare kırpma + önizleme), değiştirir, kaldırır (onaylı).
  Admin aynı işlemi kendi firmasındaki yönetebildiği aktif kullanıcılar için kullanıcı detayında yapar. Resim yoksa baş harf
  rozeti. Avatar üst menüde, kullanıcı listesinde ve audit log'da görünür; müşteriye gösterilmez.
- **Firma logosu** (Ayarlar > Logo, `/settings/logo`): önizlemeli yükle / değiştir / kaldır; üst menüde, müşteri karşılama
  sayfasında ve e-postalarda. **Sistem logosu** (Sistem ayarları > Sistem logosu, yalnız Super Admin): yükle / değiştir
  (kaldırma yok). Zincir: firma logosu → sistem logosu → Nokta Bilişim logosu.
- **Giriş ekranında logo:** `/login?tenant=<firma kısa adı>` firmanın logosunu, kısa adsız bağlantı sistem logosunu gösterir.
- **Tema:** kullanıcı başına, DB'de saklanır; başka cihazda da aynı gelir. İlk HTML doğru temayla çizilir (yanıp sönme yok,
  satır içi betik yok).
- Dosya güvenliği: yalnız PNG/JPEG/WEBP (içerikten), 2 MB, kenar ≥ 16 px, oran logo ≤ 20:1 / avatar ≤ 4:1; sunucuda yeniden
  kodlama (logo PNG ≤ 512 px, avatar WEBP 256×256), EXIF silme, rastgele ad, firma klasörü; avatar yalnız aynı firmaya.
- Tasarım: ESLint `remote/design-tokens` kuralı (sabit renk/px yasak, `error`), tüm menü/sekme öğelerinde ikon,
  `prefers-reduced-motion` desteği.
- Migration `20261113120000_p12_branding` (yalnız CHECK). Yeni ortam değişkeni **`UPLOADS_DIR`**, yeni volume `uploads`;
  Caddy ve host nginx'te yükleme uçlarına 3 MiB gövde sınırı (runbook §16). Yeni bağımlılıklar `sharp` 0.35.5
  (Apache-2.0; libvips LGPL, dinamik), `file-type` 22.3.0 (MIT), `@fastify/multipart` 10.1.8 (MIT), `react-easy-crop` 6.2.5 (MIT).
  Sunucu CPU'su x86-64-v2 olmalı (runbook §16.1/0).

**P12b — WhatsApp servisi sistem ayarı (AC-196)**

- **Sistem ayarları > WhatsApp servisi** (`/admin/settings/whatsapp`, yalnız Super Admin): etkin servis adresi, kaynak
  rozeti (**Panel** / **Ortam değişkeni**), servis URL'sini kaydetme (yeniden başlatma yok), **Ortam değişkenine dön**,
  **Test Mesajı Gönder** (sonuç ekranda; kişi başı 5/dk, tüm Super Admin'ler 20/dk). Güvensiz adreste kalıcı uyarı.
- Etkin adres önceliği: panel kaydı > `WHATSAPP_SERVICE_URL` > varsayılan. Panel kaydı varken `.env` değişikliği etkisizdir.
- `WHATSAPP_SERVICE_URL` açılışta panel kuralıyla doğrulanır; uymayan değerde server açılmaz (runbook §17.1).
- Migration `20261114090000_whatsapp_service_setting` (yalnız CHECK). Yeni ortam değişkeni, volume ve bağımlılık yok.

**P13a — saklama, yedek ve geri yükleme (AC-88, 91, 92, 93, 197–200)**

- **Saklama süresi işi** (her gün 03:30): bitmiş oturumlarda firma saklama süresinden (`retentionDays`, varsayılan 365 gün)
  sonra müşteri adı, e-posta, not, onay IP/tarayıcı bilgisi ve dosya kayıtları silinir, oturum "Anonimleştirildi" olur.
  Süre **Ayarlar › Güvenlik › Veri saklama** ekranından değişir (90–730 gün, `settings.edit`). Audit 730 gün, giriş
  oturumları ve sıfırlama bağlantıları süre bitiminden 7 gün sonra silinir. Audit `retention.run`,
  metrikler `rs_retention_*`.
- Oturum geçmişinde "Anonimleştirildi" rozeti, salt okunur ayrıntı, PATCH → 409 `SESSION_ANONYMIZED`, CSV'de `Anonimleştirildi`.
- Müşteri kaynaklı audit kayıtlarında ad yok, IP yerine ağ öneki (/24, /48), tarayıcı bilgisi yok; dosya aktarım
  kayıtlarında dosya adı ve SHA-256 yok (yalnız yön, uzantı, boyut, sonuç).
- WhatsApp adresi kanonik biçimde saklanır, yeni **Varsayılan** kaynak rozeti (P13b'de kaldırıldı); sistem ayarı yazımları 10/dk/kullanıcı.
- **Şifreli günlük yedek** (`deploy/backup/`, systemd 02:00, `age`, 14 gün) ve doğrulamalı geri yükleme (bkz. "Yedek, geri
  yükleme ve saklama").
- Migration `20261114120000_p13a_retention`. Yeni ortam değişkeni **`MYSQL_BACKUP_PASSWORD`**. Yeni bağımlılık yok (host'ta
  `age`, `jq`).

**P13b — prod açılışı (AC-23, 91, 126, 200 revize; AC-298–302)**

- Prod adresi `https://remote.noktabilisim.net`; HSTS `max-age=31536000; includeSubDomains`; 4450 yalnız `127.0.0.1`.
- TURN-TLS 5349/TCP (Let's Encrypt, yenileme kancası), relay aralığı 49160–49479/udp, allocation başına 8 Mbit/s,
  host toplam tavanı (`TURN_FW_RELAY_MAX_BPS`).
- İmzalı yedek manifesti, imza önce geri yükleme, ortam kilidi (`DEPLOY_ENV`), audit süreklilik denetimi, site dışı kanca,
  `status.prom` (bkz. "Yedek, geri yükleme ve saklama").
- `reset-superadmin` CLI, `remote-watch`, `proxy-guard` (bkz. "Prod işletim araçları").
- WhatsApp servis anahtarı (`x-api-key`): panelde "Servis anahtarı" alanı veya `WHATSAPP_SERVICE_API_KEY`; yerleşik
  varsayılan servis adresi ve "Varsayılan" rozeti kaldırıldı.
- Migration `20261115090000_whatsapp_api_key` (yalnız CHECK). Yeni ortam değişkenleri: `DEPLOY_ENV`,
  `WHATSAPP_SERVICE_API_KEY`, `TURN_FW_RELAY_MAX_BPS`, `TURN_CERT_DIR`. Yeni bağımlılık yok (host'ta `nftables`, `openssh-client`).

**Düzeltme — talepten doğan oturumda siyah ekran:** sunucu teknisyene ICE (TURN) listesini `peer.joined`'dan önce
gönderir, konsol liste gelmeden teklif üretmez (`6701567`).

**P13b-L — bekleme odası göstergesi (AC-304–315, ADR-0029)**

- Oturumlar listesinde bekleyen oturumun satırında **"Müşteri bekliyor (n)"** rozeti; kendi oturumunuzda tıklanınca konsol açılır.
- Kenar menüde "Oturumlar" öğesinde bekleyen müşteri sayacı (panelin her sayfasında), yeni gelişte "Bekleme odasında
  müşteri var" bildirimi ve "Konsolu aç" eylemi, sekme arka plandayken başlıkta "({n}) Müşteri bekliyor — " ön eki.
- Kaynak `GET /api/v1/sessions/waiting` (10 sn yoklama, bellekten, audit yok, 60/dk/kullanıcı) ve liste öğelerinde
  `waitingGuests`. Yalnız `sessions.view` gerekir. Göstergeler yalnız sayı taşır, müşteri adı göstermez.
- Migration, yeni yetki, yeni ortam değişkeni ve yeni bağımlılık yok. Lobi tek sunucu örneğinin belleğindedir; yeniden
  başlatmada sayaç 0'a iner.

**Düzeltme — firma seçmemiş Super Admin, Oturumlar:** oluştur/iptal/sonlandır/konsol eylemleri gizlenir, yerine üst
menüden firma seçme notu çıkar; önceden "Yeni destek oturumu" 403 ile dönüyordu (`a71d80e`).

**P14a / P14b — güvenlik, kalite ve UI (AC-201..230; kodlandı, QA denetimi sürüyor)**

- **Step-up doğrulama:** MySQL, TURN ve WhatsApp sistem ayarlarını kaydetmek son 5 dk içinde 2FA ister ("Kimliğinizi
  doğrulayın" penceresi; TOTP veya kurtarma kodu; kalan kod ≤ 3 uyarısı). `POST /api/v1/auth/step-up`.
- **İyimser kilit:** kullanıcı düzenlemede `ETag` / `If-Match`; araya giren değişiklikte 409 ve "Yeniden yükle".
- **MySQL "TLS gerekli"**, **Ayarlar > Genel** (oturum süresi, açık oturum ve dosya boyutu sınırları), aranabilir firma
  seçici ve tam teknisyen listesi (`GET /users/options`, `GET /admin/tenants/options`), sohbet hız sınırı (5/sn).
- Kullanıcı/firma yazma uçlarında hız sınırı, aktör kilidi, başarısız yetki denemelerinin audit'i, firma pasife almada
  talep/kayıt iptalinin aynı işlemde yapılması, `/ws/panel` 4429 `retry=<sn>`, yeni metrikler ve alarmlar (runbook §22).
- Prettier (`pnpm format`), CI'da shellcheck/actionlint ve kararlılık koşusu (`stability` iş akışı). Ayrıntı `CHANGELOG.md`.

**P15 — G3 küçük özellikler (AC-231..239; kodlandı, QA denetimi sürüyor)**

- **Kurtarma kodlarını yenile:** Hesabım'da güncel TOTP koduyla 10 yeni kod (`POST /api/v1/auth/mfa/recovery-codes`).
- **Super Admin şifre sıfırlama:** Sistem ayarları > Super Admin'ler; step-up sonrası tek seferlik geçici şifre
  (`GET /api/v1/admin/superadmins`, `POST /api/v1/admin/superadmins/:id/reset-password`).
- **Sistem logosunu kaldır:** varsayılan Nokta logosuna dönüş (`DELETE /api/v1/admin/settings/system-logo`).
- **Talep engelleri:** Engellenenler ekranı ve Talepler kartında "Bu kaynağı engelle" (IP/ağ veya bilgisayar, süreli ya da
  süresiz, firma başına 1.000); yeni yetki `support_requests.block`; `GET/POST/DELETE /api/v1/request-blocks`.
- **Paylaşım hata nedeni** konsolda (`share.state.reason/method`; istemci 0.11), **müşteri ekranında teknisyen fotoğrafı**
  (10 dk imzalı adres), **dosya doğrulama** ("Doğrulanmış / Müşteri bildirimi", CSV "Dosyalar" sütunu).
- **Talep kabulünde kabul kodu** (varsayılan kapalı). Hızlı Destek 0.10.x bu ayarla bağlanamaz; 0.11.x yaygınlaşana kadar
  kapalı tutun.
- Migration `20261117000000_p15_g3`; yeni ortam değişkeni ve bağımlılık yok.

**P16 — G4 kalıcı silme (AC-240..244; kodlandı, QA denetimi sürüyor)**

- **Kullanıcıyı kalıcı silme:** pasif kullanıcı, ad yazarak onay, step-up; geçmişte "Silinmiş kullanıcı #…", audit'te
  kimlik maskeli (`DELETE /api/v1/users/:id`).
- **Firmayı kalıcı silme:** en az 30 gün pasif firma; önizleme → ad onayı → step-up → **24 saat bekleme (iptal
  edilebilir)** → adım adım silme, kesilirse sürer; Super Admin uyarı bandı (`/api/v1/admin/tenants/:id/purge`,
  `/api/v1/admin/purge-jobs`).
- **Gece kalıcı silme** (anonimleşmeden 30 gün sonra; `RETENTION_PURGE_MODE`, varsayılan `dry`) ve haftalık **yetim dosya
  taraması**.
- **İmha defteri** (`remote_ledger` volume) ve geri yükleme sonrası zorunlu `cli erasure:replay` + `erasure:verify`.
  Kalıcı silinen veri yedeklerden en geç 14 günde düşer. Operasyon: [`docs/runbook.md`](docs/runbook.md) §23.
- Migration `20261118000000_p16_hard_delete` (tetikleyici 3 → 22; `users.delete` ezmeleri sıfırlanır); yeni bağımlılık yok.

API ayrıntısı: [`docs/api.md`](docs/api.md). Sürüm geçmişi: [`CHANGELOG.md`](CHANGELOG.md).
Kullanım (müşteri, teknisyen, yönetici): [`docs/KULLANIM_KILAVUZU.md`](docs/KULLANIM_KILAVUZU.md).
Ürün föyü: [`docs/DATASHEET.md`](docs/DATASHEET.md).

**İlk hesaplar:** Seed yalnız Super Admin oluşturur (ilk girişte şifre değişimi zorunlu). Super Admin "Firmalar"
ekranından firma oluşturur, üst menüden o firmaya geçer ve **Kullanıcılar > Yeni kullanıcı** ile firmanın ilk Admin'ini
ekler (runbook §14.1). P10'dan itibaren Super Admin ve Admin ilk girişte (şifre değişiminden sonra) **2FA kurar**:
telefonda bir doğrulama uygulaması hazır olmalı, 10 kurtarma kodu parola kasasına kaydedilmeli. Super Admin firma seçmeden destek oturumu açamaz; oturum geçmişini firma seçmeden tüm firmalar için
görür. `deploy/staging-users.sh` staging test hesapları için hâlâ kullanılabilir (`docs/runbook.md` §6).

## Yol haritası

| Paket                                                                             | Kapsam                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2 ✓                                                                              | Destek oturumu oluşturma (8 haneli kod), liste, iptal, karşılama sayfası iskeleti                                                                                                                                          |
| P3 ✓                                                                              | Sinyalizasyon sunucusu (WebSocket), lobi + teknisyen kabulü, TURN (coturn), `/metrics`                                                                                                                                     |
| P4 ✓                                                                              | Tarayıcı modu ekran paylaşımı, KVKK onayı, teknisyen konsolu video                                                                                                                                                         |
| P5 ✓                                                                              | Sohbet, dosya transferi, ekran üzerine işaretleme + lazer + yüzen pencere, kalite paneli                                                                                                                                   |
| P6 ✓                                                                              | Windows istemci (Go, imzasız; SHA-256 + build attestation)                                                                                                                                                                 |
| P7 ✓                                                                              | Uzaktan kontrol (izin diyaloğu, klavye/fare, monitör değiştirme)                                                                                                                                                           |
| P8 ✓                                                                              | Oturum geçmişi, not/ticket, CSV dışa aktarma, istemcide fare imleci                                                                                                                                                        |
| P8b-1 ✓                                                                           | Müşteri destek talebi: sunucu uçları, panel kuyruğu, ayarlar, WhatsApp bildirimi                                                                                                                                           |
| P8b-2 (kod ✓, Windows elle test bekliyor)                                         | Windows istemci 0.9.0: "Destek iste" formu, bekleme ekranı, 503 yeniden deneme                                                                                                                                             |
| P8c-1 ✓                                                                           | Müşteri firmalar (Müşteriler modülü), müşteri başına kalıcı bağlantı, bilgisayar kaydı (sunucu + panel)                                                                                                                    |
| P8c-2 (kod ✓, Windows elle test bekliyor)                                         | Windows istemci 0.10.0: kalıcı "Destek iste", "Bağlantı kodum var", "Bu bilgisayarı unut"                                                                                                                                  |
| P9 ✓                                                                              | Kullanıcı/yetki toggle'ları, tenant yönetimi, Super Admin tenant geçişi                                                                                                                                                    |
| P10 ✓                                                                             | 2FA (TOTP), şifre sıfırlama e-postası, SMTP ayarı + test, tüm cihazlardan çıkış, e-posta bildirimleri                                                                                                                      |
| P11 ✓                                                                             | MySQL/TURN ayarları + test, audit log ekranı, audit tetikleyicileri, aydınlatma metni düzenleme                                                                                                                            |
| P12 ✓                                                                             | Firma/sistem logosu, avatar yükleme, kullanıcı tema tercihi, hesap menüsü, token lint kuralı                                                                                                                               |
| P12b ✓                                                                            | Super Admin "WhatsApp servisi" sistem ayarı: servis adresi, kaynak rozeti, test mesajı                                                                                                                                     |
| P13a ✓                                                                            | Saklama işi (anonimleştirme, audit 730 g), şifreli yedek/geri yükleme, runbook senaryo dizini, kılavuz, datasheet, PDF'ler                                                                                                 |
| P13b (kod ✓, prod terfisi runbook §20)                                            | Prod açılışı: `remote.noktabilisim.net`, TURN-TLS 5349 + LE sertifika kancası, imzalı yedek + site dışı kanca + audit süreklilik denetimi, `reset-superadmin` CLI, `remote-watch`, `proxy-guard`, WhatsApp servis anahtarı |
| P13b-L (kod ✓, qa GEÇTİ, güvenlik Kritik/Yüksek 0; staging testi AC-316 bekliyor) | Bekleme odası göstergesi: liste rozeti, "Oturumlar" menü sayacı, bildirim, sekme başlığı, `GET /sessions/waiting`                                                                                                          |
| P14a (kod ✓, QA sürüyor)                                                          | G1 güvenlik/kalite: step-up 2FA, iyimser kilit, hız sınırları, MySQL TLS, metrikler, Prettier, CI kararlılık koşusu                                                                                                        |
| P14b (kod ✓, QA sürüyor)                                                          | G2 UI/a11y: 404 sayfaları, anahtar kontrastı, mobil menü, Ayarlar > Genel, aranabilir firma seçici, sohbet hız sınırı                                                                                                      |
| P15 (kod ✓, QA sürüyor)                                                           | G3: kurtarma kodu yenileme, Super Admin şifre sıfırlama, sistem logosu kaldırma, talep engelleri, paylaşım hata nedeni, teknisyen fotoğrafı, dosya doğrulama, talep kabul kodu                                             |
| P16 (kod ✓, QA sürüyor)                                                           | G4: kullanıcı ve firma kalıcı silme (24 sa iptal penceresi), gece kalıcı silme, yetim dosya taraması, imha defteri ve geri yükleme sonrası yeniden silme                                                                   |
| P18 (kod ✓, QA sürüyor)                                                           | G6-a talep iletişimi: kabul öncesi mesajlaşma (panel), atama, öncelik, SLA, mesai saatleri ve tatiller                                                                                                                     |
| P19 (kod ✓, QA sürüyor)                                                           | G6-b web talep formu, SMS ayarı + test, oturum bağlantısını SMS/WhatsApp ile gönderme, müşteriye durum bildirimi, müşteri CSV dışa/içe aktarma                                                                             |
| P20 (kod ✓, QA sürüyor)                                                           | G5-b Windows istemci 0.12.0: tepsi + Windows açılışında başlatma, 5 firmaya kadar kayıt, talep öncesi sohbet                                                                                                               |
| P27a (kod ✓, QA sürüyor)                                                          | 2FA'da "Bu cihazı 30 gün hatırla" (Super Admin hariç), hatırlanan cihazlar, firma anahtarı                                                                                                                                 |
| P27 (kod ✓, QA sürüyor; prod `off`)                                               | G7 gözetimsiz erişim: `NoktaDestekServis.exe`, kayıt kodu, cihaz başına yetki, bağlantı başına step-up, müşteri bildirimi, gösterge, yerel kapatma; runbook §27                                                            |
| P28a (kod ✓, qa GEÇTİ; Windows elle turu bekliyor)                                | G8-a pano paylaşımı (düz metin ≤ 64 KB) ve uzaktan yazdırma (PDF, müşteri onayı), Windows istemci 0.13.0; runbook §28a                                                                                                     |
| P13c                                                                              | Ayrı staging (`stg.remote.noktabilisim.net`, ayrı DB/sır/yedek); E11 özelliklerinden önce                                                                                                                                  |

Prod açılışının ön koşulları ve imzalı kontrol listesi: runbook §20.1–§20.3. TURN için yalnız 443/TCP'nin açık olduğu
müşteri ağları desteklenmez (ADR-0018 risk kabulü); gereken portlar kullanım kılavuzunda "Ağ gereksinimleri" bölümündedir.

## Teknoloji yığını

| Katman               | Teknoloji                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server               | Node.js ≥ 22.18 (yerleşik TypeScript type stripping, derleme adımı yok), Fastify 5, Prisma 7, zod, pino, argon2id, nodemailer (SMTP), qrcode (2FA QR) |
| Web                  | Next.js 16 (App Router), React 19, Tailwind 4, lucide-react                                                                                           |
| Ortak                | `packages/contracts` (zod şemaları, yetki listesi, hata kodları)                                                                                      |
| DB                   | MySQL 8.4                                                                                                                                             |
| Giriş                | Caddy 2.11 (TLS, ters vekil, log filtresi)                                                                                                            |
| Sinyalizasyon / TURN | `ws` 8.21 (Fastify sunucusunda), coturn 4.18 (ayrı compose)                                                                                           |
| Windows istemci      | Go 1.26 (CGO'suz), Pion WebRTC v4, `coder/websocket`, `golang.org/x/sys`; Win32 arayüz                                                                |
| Test                 | Vitest, Playwright + axe, `go test -race`                                                                                                             |
| Paket yöneticisi     | pnpm 9 (corepack), monorepo                                                                                                                           |

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

| Değişken                                                                         | Zorunlu       | Açıklama                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MYSQL_ROOT_PASSWORD`, `MYSQL_APP_PASSWORD`, `MYSQL_MIGRATOR_PASSWORD`           | Evet          | `openssl rand -hex 24`; yalnız harf/rakam                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `MYSQL_DATABASE`                                                                 | Evet          | Veritabanı adı (ör. `remote`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `MYSQL_BACKUP_PASSWORD`                                                          | Yedek için    | P13a: `backup` MySQL kullanıcısının parolası, ≥ 16 karakter (`openssl rand -hex 24`). Yalnız `mysql` servisine verilir; server okumaz. Boşsa kullanıcı oluşturulmaz ve yedek hata verir (runbook §3, §18)                                                                                                                                                                                                                                                                                                                                                                                                     |
| `PUBLIC_BASE_URL`                                                                | Evet          | Dış adres, port dahil (ör. `https://localhost:4450`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `SITE_HOST`                                                                      | Hayır         | Caddy site adı/sertifika adı (varsayılan `localhost`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD`, `SEED_SUPERADMIN_NAME`      | Seed için     | Boşluklu değer tırnaklanır; seed sonrası silinebilir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `NODE_ENV`, `LOG_LEVEL`                                                          | Hayır         | Varsayılan `production`, `info`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ALLOWED_ORIGINS`                                                                | Hayır         | CSRF/Origin listesi (virgülle); boşsa `PUBLIC_BASE_URL`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SESSION_REF_KEY`                                                                | Evet          | Müşteri durum yoklamasındaki `sessionRef`'in HMAC anahtarı, ≥ 32 karakter (`openssl rand -base64 48`). Production'da zorunlu; değişirse açık oturumların yoklaması 404 olur                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `EDGE_PROXY_SECRET`                                                              | Evet          | Caddy → web paylaşılan sırrı (`X-Edge-Auth`), ≥ 32 karakter (`openssl rand -base64 32`). Caddy ve web'e aynı değer gider; web production'da sır yoksa açılmaz                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `CADDY_BIND`, `IMAGE_TAG`                                                        | Hayır         | 4450'nin dinlendiği arayüz (varsayılan `0.0.0.0`; **prod `127.0.0.1`**, 4450 dışarı kapalı), imaj etiketi (varsayılan `local`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `DEPLOY_ENV`                                                                     | Evet          | P13b: `development`, `staging` veya `production`. `backup.sh` (manifest `env`) ve `restore.sh` (ortam kilidi) okur. **P27'den beri `server` konteynerine de verilir:** boşsa `docker compose` durur ("DEPLOY_ENV gerekli"); `NODE_ENV=production` iken ya da `UNATTENDED_MODE` `off` dışındayken tanımsızsa server açılmaz. Prod `.env`'i staging'den kopyalanmaz (runbook §27.1)                                                                                                                                                                                                                             |
| `TURN_URLS`                                                                      | Evet          | Virgüllü `stun:`/`turn:`/`turns:` adres listesi (staging değeri `.env.example`'da)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `TURN_SECRET`                                                                    | Evet          | TURN credential HMAC sırrı, ≥ 32 karakter (`openssl rand -hex 32`); coturn ile **aynı** değer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `TURN_CRED_TTL_MIN`                                                              | Hayır         | TURN credential ömrü, dk (5–60, varsayılan 20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `METRICS_TOKEN`                                                                  | Hayır         | `/metrics` Bearer token'ı, ≥ 16 karakter; boşsa `/metrics` 404                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `AGENT_SHA256`                                                                   | İndirme için  | Yayındaki `NoktaDestek.exe`'nin SHA-256'sı (64 hex). Elle yazılmaz; `deploy/agent/verify-and-publish.sh` doğrulamadan sonra yazar. Boşsa istemci indirmesi 503 döner, server yine açılır                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `AGENT_BINARY_PATH`                                                              | Compose dışı  | İkilinin mutlak yolu. Compose `/data/downloads/NoktaDestek.exe` verir; yalnız yerel `pnpm` çalıştırmada gerekir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `UNATTENDED_MODE`                                                                | Hayır         | P27 imza kapısı: boş = `off` (kayıt kodu, kayıt ve bağlantı 409 `UNATTENDED_DISABLED`), `unsigned` (**yalnız** `DEPLOY_ENV=staging`; aksi halde server açılmaz; panelde "TEST ortamı — imzasız servis" bandı), `signed` (servis imzalı ve SHA'sı listede). Prod: `off` (runbook §27.1, §27.5)                                                                                                                                                                                                                                                                                                                 |
| `UNATTENDED_SIGNED_SHA256`                                                       | `signed` iken | P27: izin verilen `NoktaDestekServis.exe` SHA-256 değerleri, virgülle ayrılmış 64 hex. `signed` modda boşsa server açılmaz (runbook §27.5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `UNATTENDED_AGENT_SHA256`                                                        | İndirme için  | P27: yayındaki `NoktaDestekServis.exe`'nin SHA-256'sı. Elle yazılmaz; `deploy/agent/publish-servis.sh` yazar. Boş ya da dosya farklıysa panel "Servis programını indir" 503 döner. Yol compose'da sabit (`/data/unattended/NoktaDestekServis.exe`) (runbook §27.3)                                                                                                                                                                                                                                                                                                                                            |
| `ABUSE_EMAIL`                                                                    | Önerilir      | Müşteri ekranındaki "Kötüye kullanımı bildir" adresi (ör. `abuse@<alan-adı>`). Production'da boşsa bağlantı gizlenir; Super Admin e-postası kullanılmaz. Boş bırakmak güvenlidir; dolu ama geçersiz adres server'ı açtırmaz                                                                                                                                                                                                                                                                                                                                                                                   |
| `WHATSAPP_SERVICE_URL`                                                           | Hayır         | P8b: whatsapp-bildirim servis adresi (sistem düzeyi; ör. `http://<whatsapp-servis>:3000`). **P12b'den beri yalnız yedek:** Sistem ayarları > WhatsApp servisi'nde panel kaydı varsa o geçerlidir. **P13b'den beri yerleşik varsayılan yok:** env ve panel kaydı boşsa kanal kapalıdır (gönderim yok, test "Servis yapılandırılmamış."). Değer kanonik biçime çevrilir (P13a). Kural: `http://`/`https://`, kullanıcı:şifre, `?`, `#`, boşluk ve görünmez karakter yok, ≤ 200 karakter; **uymazsa server açılmaz** (runbook §17.1). Production'da şifresiz + genel adres → kanal kapalı başlar (runbook §12.3) |
| `WHATSAPP_SERVICE_API_KEY`                                                       | Hayır         | P13b: servis anahtarı (`x-api-key` başlığı), 16–256 karakter, boşluksuz; uymazsa server açılmaz. Yalnız `WHATSAPP_SERVICE_URL` adresine gönderilir; panelde adres kayıtlıysa yalnız panel anahtarı kullanılır. Boş = başlık gönderilmez. Loglanmaz                                                                                                                                                                                                                                                                                                                                                            |
| `SMSPORTAL_URL`                                                                  | Hayır         | P19: smsportal sistem varsayılan adresi (yalnız köken + yol, ör. `https://<smsportal>`); yalnız `server`'a verilir. Firma Ayarlar > SMS'te kendi adresini girmemişse bu kullanılır; boş = varsayılan yok. Kural WhatsApp adresiyle aynı (kullanıcı:şifre, `?`, `#` yok); uymazsa server açılmaz. API anahtarı env'de değil, firma başına panelde (şifreli). Production'da `http://` + genel host → SMS kapalı. **Değiştirmek** varsayılanı kullanan firmaların anahtarını okunamaz yapar → önce runbook §26.3                                                                                                 |
| `APP_ENCRYPTION_KEYS`                                                            | Evet          | P10: SMTP şifresi ve 2FA sırlarının AES-256-GCM anahtarı, `v1:<base64 32 bayt>`. Üretim: `echo "v1:$(openssl rand -base64 32)"`. Production'da yoksa server açılmaz. **Parola kasasında yedeklenmeli**: kaybolursa SMTP şifreleri yeniden girilir, tüm kullanıcıların 2FA'sı sıfırlanır. Rotasyonda eski sürüm silinmez (`v1:…,v2:…`); runbook §3 ve §14 P10                                                                                                                                                                                                                                                  |
| `MIN_AGENT_VERSION`                                                              | Hayır         | P8b: asgari Windows istemci sürümü `x.y.z`; boş = kontrol yok. Müşterilerin tamamı 0.9.0 firma dosyasına geçene kadar boş bırakın (runbook §12.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `UPLOADS_DIR`                                                                    | Compose dışı  | P12: logo/avatar dosyalarının kökü, **mutlak yol**. Compose sabit `/data/uploads` verir (volume `remote_uploads`); boşsa `/data/uploads`. Yedeği DB ile aynı pencerede alınır (runbook §16.3)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `RETENTION_PURGE_MODE`                                                           | Hayır         | P16: gece kalıcı silme adımı. `dry` (varsayılan, boş = `dry`): hiçbir satır silinmez, aday sayıları `retention.run` audit'ine (`purgeCandidates`) yazılır. `on`: anonimleşmeden 30 gün sonra siler. Prod'da ilk hafta `dry`, sayılar incelenince `on` + `docker compose up -d server` (runbook §23.1)                                                                                                                                                                                                                                                                                                         |
| `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `TRUSTED_PROXY_CIDR`, `API_INTERNAL_URL` | Compose dışı  | Compose bunları kendisi üretir; yalnız yerel `pnpm` çalıştırmada gerekir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

TURN sunucusu (`deploy/turn`, ayrı compose projesi) şu değişkenleri okur:

| Değişken                            | Zorunlu      | Açıklama                                                                                                                                                                                                                              |
| ----------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TURN_SECRET`                       | Evet         | Server ile aynı sır                                                                                                                                                                                                                   |
| `TURN_SECRET_PREVIOUS`              | Hayır        | Kesintisiz sır değişimi sırasında eski sır (runbook §9.6)                                                                                                                                                                             |
| `TURN_REALM`                        | Evet         | coturn realm (prod: `remote.noktabilisim.net`)                                                                                                                                                                                        |
| `TURN_EXTERNAL_IP`                  | Evet         | `<public IP>/<iç IP>` (NAT arkasında) veya yalnız public IP                                                                                                                                                                           |
| `TURN_MAX_BPS`, `TURN_BPS_CAPACITY` | Hayır        | Bayt/sn. `TURN_MAX_BPS`: allocation başına, yön başına tavan (vars. **1000000** = 8 Mbit/s, AC-21; P13b ölçümü). `TURN_BPS_CAPACITY`: **0 bırakın** (vars. 0); ayarlanırsa her allocation rezerve edilir ve 63. allocation reddedilir |
| `TURN_FW_RELAY_MAX_BPS`             | Hayır        | P13b: host toplam relay tavanı, bayt/sn (`host-firewall.sh` hashlimit; prod `62500000` = 500 Mbit/s). Boş/0 = kapalı. Değişince `sudo ./host-firewall.sh install`                                                                     |
| `TURN_CERT_DIR`                     | Prod'da evet | P13b: TURN-TLS sertifika dizini; compose bağlar, sertifika kancası yazar. Prod `/etc/remote/turn-certs` (git dışı); boşsa `./certs` (yerel)                                                                                           |
| `TURN_PROMETHEUS_ADDRESS`           | Hayır        | coturn metrik dinleme adresi (varsayılan `127.0.0.1`)                                                                                                                                                                                 |
| `TURN_LISTEN_IPS`                   | Önerilir     | 3478/5349 dinleme adresleri. Staging/prod: `auto` (özel relay IPv4 + `127.0.0.1`); virgüllü IPv4 listesi de olur. Boşsa tüm arayüzlerde dinler ve uyarı yazar                                                                         |

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

Biçim denetimi (Prettier 3.10.1, ADR-0024; CI `quality` işi `format:check` ile başlar):

```bash
pnpm format:check                                  # fark varsa 1 döner
pnpm format                                        # tüm repoyu biçimler; tek dosya: pnpm exec prettier --write <dosya>
git config blame.ignoreRevsFile .git-blame-ignore-revs   # blame'de tek seferlik biçim commit'ini atla
```

Kararlılık koşusu (AC-219; kararsız test retry ile gizlenmez, kök nedeni düzeltilir):

```bash
eval "$(apps/server/scripts/test-db.sh up)"        # int modu TEST_DATABASE_URL ister
scripts/repeat-tests.sh 20 int                     # entegrasyon 20 ayrı süreçte, --retry 0
scripts/repeat-tests.sh 20 e2e                     # Playwright --repeat-each 20 --retries 0
apps/server/scripts/test-db.sh down
```

Sonda `SONUÇ: <geçen>/<toplam>` yazar; çıkış 0 = tüm koşular yeşil, 2 = kullanım/ön koşul hatası. GitHub'da aynı iş
`stability` iş akışıdır: Actions → stability → Run workflow (`runs`, varsayılan 20) ve her pazartesi 02:17 UTC. Sonuç
QA raporuna, bulunan kararsız test `docs/implementation.md` "Kararsız testler" listesine yazılır (runbook §22).

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

- migrate + grants → seed (`SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` betikte rastgele üretilir) →
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

### Son test sonuçları (P15, 2026-11-15)

Kaynak: `docs/implementation.md` "P15 — frontend" ve "P15 — backend".

| Takım                                     | Sonuç                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| Birim (`pnpm -r run test`)                | 804: server 377, web 333, contracts 94                                   |
| Server entegrasyon (`test:int`, temiz DB) | 632 (65 dosya); P15: `p15-backend`, `system-logo-p15`, `security-p15-db` |
| Web e2e (sahte API/WS, tüm projeler)      | 379 geçti, 0 hata (169 mobil atlama); P15 spec'i `e2e/p15.spec.ts`       |

20 koşuluk `stability` çalıştırması (AC-219) GitHub'da push sonrası yapılır.

#### Önceki paket (P14a/P14b, 2026-11-15)

| Takım                                         | Sonuç                                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Birim (`pnpm -r run test`)                    | 782: server 377, web 321, contracts 84                                                                            |
| Server entegrasyon (`test:int`, temiz DB)     | 604 (62 dosya); P14: `security-p14a-{db,users,auth,tenants}`, `p14a-a3`, `p14a-a3-settings`, `mail-starttls-p14a` |
| Web e2e (sahte API/WS, tüm projeler)          | 356 geçti, 0 hata; P14 spec'leri `e2e/p14a-a4.spec.ts`, `e2e/p14b-ui.spec.ts`                                     |
| `pnpm format:check` · shellcheck · actionlint | 0 fark · `-S warning` 0 · 0                                                                                       |
| `deploy/ops/test-watch.sh`                    | GEÇTİ (AC-208/212 alarmları dahil)                                                                                |

#### Önceki paket (P13b, 2026-11-15)

| Takım                                              | Sonuç                                                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Birim (`pnpm -r run test`)                         | 681: server 351, web 252, contracts 78                                                                                                    |
| Server entegrasyon (`test:int`, temiz DB)          | 541 (54 dosya); P13b: `superadmin-reset-p13b`, `whatsapp-admin-p12b` (servis anahtarı), `signaling-lifecycle` (TURN credential önbelleği) |
| `deploy/backup/test-backup.sh`                     | 55/55 PASS (imza, ortam kilidi, kurcalanmış döküm, audit süreklilik, kanca)                                                               |
| `deploy/ops/test-watch.sh` · `test-proxy-guard.sh` | 49/49 · 34/34 PASS                                                                                                                        |
| `deploy/turn/test-cert-hook.sh` · `test-local.sh`  | 14 + 25 PASS · test-denied 65 PASS + aralık/kapasite bölümleri                                                                            |

Prod ölçümleri (AC-23 TURN-TLS 5349, AC-91/200 geri yükleme provası) açılış kontrol listesindedir (runbook §20.3).

#### Önceki paket (P13a, 2026-11-14)

| Takım                                     | Sonuç                                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Birim (`pnpm -r run test`)                | 676: server 349, web 249, contracts 78                                                                                      |
| Server entegrasyon (`test:int`, temiz DB) | 529 (53 dosya); P13a: `retention-p13a-job`, `retention-p13a-db`, `audit-customer-p13a`, `whatsapp-admin-p12b` (P13a ekleri) |
| Web e2e (sahte API/WS, tüm projeler)      | 305 geçti, 0 hata; P13a spec'i `e2e/p13a.spec.ts`                                                                           |
| `deploy/mysql/check-app-grants.sh`        | 373/373 PASS (tetikleyici 3, backup hesabı dahil)                                                                           |

Staging ölçümleri (AC-88 temiz kurulum, AC-91/200 yedek ve geri yükleme provası) runbook §18.7'de bekliyor.

#### Önceki paket (P12b, 2026-11-13)

| Takım                           | Sonuç                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Birim (`pnpm -r run test`)      | 665: server 347, web 243, contracts 75                                                                                                         |
| Server entegrasyon (`test:int`) | 491 (50 dosya); P12b: `whatsapp-admin-p12b` (paylaşılan ayar satırı nedeniyle ayrı vitest projesinde, en sonda), `whatsapp-setting` (DB CHECK) |
| Web e2e (sahte API/WS)          | P12b spec'i `e2e/p12b-whatsapp.spec.ts` + `p11-admin`, `p8b-requests` regresyonu: 42 geçti, 0 hata, 30 atlandı (masaüstü-yalnız)               |

QA Tur 3 GEÇTİ (`docs/qa-raporu.md`); güvenlik Kritik/Yüksek/Orta 0, Düşük 1 açık (B-P12b-4, Sonra).

#### Önceki paket (P12, 2026-11-13)

| Takım                           | Sonuç                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Birim (`pnpm -r run test`)      | 648: server 339, web 238, contracts 71                                                                                     |
| Server entegrasyon (`test:int`) | 471 (48 dosya); P12: `branding-api-p12`, `branding-p12` (DB CHECK), tenant matrisi +10 uç                                  |
| Web e2e (sahte API/WS)          | 281 geçti + 106 atlandı (masaüstü/mobil proje filtreleri), art arda 3 koşuda 0 hata; P12 spec'i `e2e/p12-branding.spec.ts` |

Sayfa testi (`docs/arsiv/p12-test-raporu.md`): gerçek server + MySQL ile 20 akış adımının 20'si geçti; 136 görünüm (açık/koyu,
1280/390 px), axe 0 ihlal, JS hatası 0, kırık iç bağlantı 0. P11'den kalan gerçek-server akışları (Super Admin girişi + 2FA,
audit 405, CSV formül kaçışı) da doğrulandı.

#### Önceki paket (P11, 2026-11-13)

| Takım                           | Sonuç                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Birim (`pnpm -r run test`)      | 613: server 324, web 218, contracts 71                                                                                   |
| Server entegrasyon (`test:int`) | 445 (46 dosya); P11: `audit-p11`, `settings-p11`, `audit-immutability-p11`, `db-grants`. MySQL'de binlog bayrağı gerekir |
| Web e2e (sahte API/WS)          | 264 geçti + 95 atlandı (masaüstü/mobil proje filtreleri); P11 spec'i `e2e/p11-admin.spec.ts` (iki tema, 1280/390 px)     |

Sayfa testi (`docs/arsiv/p11-test-raporu.md`): 6 senaryo × 22 rota × açık/koyu × 1280/390 = 88 görünüm, axe 0 ihlal, JS
hatası 0; gerçek server ile akışlar staging'de elle doğrulanacak.

#### Önceki paket (P10, 2026-11-12)

| Takım                           | Sonuç                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Birim (`pnpm -r run test`)      | 586: server 310, web 205, contracts 71                                                                    |
| Server entegrasyon (`test:int`) | 409 (43 dosya); P10: `account-p10`, `mail-tls-p10` (openssl ister), `mail-cap-p10`, süreç içi sahte SMTP  |
| Web e2e (sahte API/WS)          | 243 geçti + 84 atlandı (masaüstü/mobil proje filtreleri, `p4-real`); P10 spec'i `e2e/p10-account.spec.ts` |
| gitleaks                        | `apps/server/src`, `apps/server/test`, `apps/web`, `packages`, `docs`: çıkış 0                            |

Sayfa testi (`docs/arsiv/p10-test-raporu.md`): gerçek sunucu + MySQL + sahte SMTP ile 13 rota × açık/koyu × 1366/375,
26 akış adımı, axe 0 ihlal, JS hatası 0.

#### Önceki paket (P9, 2026-11-12)

| Takım                           | Sonuç                                  |
| ------------------------------- | -------------------------------------- |
| Birim (`pnpm -r run test`)      | 546: server 285, web 193, contracts 68 |
| Server entegrasyon (`test:int`) | 384 (40 dosya)                         |
| Web e2e (sahte API/WS)          | 221 geçti + 78 atlandı                 |

#### Önceki paket (P8, 2026-11-11)

| Takım                                       | Sonuç                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| Birim (`pnpm -r run test`)                  | 442: server 256, web 136, contracts 50                                      |
| Server entegrasyon (`test:int`)             | 216 (25 dosya)                                                              |
| Web e2e (sahte API/WS)                      | 174 geçti + 54 atlandı                                                      |
| AC-60 performans (10.000 oturum, ilk sayfa) | ADMIN 2,4 ms · USER 2,2 ms · Super Admin 2,0 ms · API 6,7 ms (sınır 500 ms) |

#### Önceki paketler (P7, 2026-11-11)

| Takım                                     | Sonuç                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Windows istemci (`go test -race`, linux)  | 15/15 paket ok (yeni: control, env, input); `GOOS=windows go vet` temiz; govulncheck 0 erişilebilir zafiyet; iki derleme aynı SHA-256 |
| Birim (`pnpm -r run test`)                | 415: server 244, web 128, contracts 43                                                                                                |
| Server entegrasyon (`test:int`)           | 186 (23 dosya)                                                                                                                        |
| Web e2e (sahte API/WS)                    | 153 geçti + 45 atlandı (masaüstü akışlarının mobil kopyaları); P7 spec'i `e2e/p7-control.spec.ts` (11 test) dahil                     |
| Gerçek sunucu e2e (`scripts/e2e-real.sh`) | 5/5 (P5'ten değişmedi)                                                                                                                |
| TURN (`deploy/turn/test-local.sh`)        | 62 kontrol (P4'ten değişmedi)                                                                                                         |

P7 e2e'si sahte bir Hızlı Destek istemcisiyle (`e2e/fake-agent.ts`, gerçek WebRTC + `input` kanalı) koşar: istek →
bekleme/Vazgeç → izin → tık/klavye/Alt+Tab → bırak/devam → müşteri kısayolu; ret + 30 sn; 5 hak (sekme yenilense de);
canlı yetki kaldırma; yetkisiz kullanıcıda düğme yok; monitör isteği/ret/yanıtsızlık; yükseltilmiş pencere, güvenli
masaüstü ve yönetici rozeti; "%100" ve "Sığdır" kiplerinde ±1 px koordinat. Gerçek Windows'ta Türkçe karakter, UAC,
kısayol ve enjekte tıklama kontrolü elle yapılır (`docs/implementation.md` Agent P7, adım 25–42).

P6 e2e'si: indirme bağlantısı ve `Destek-<8 hane>.exe` dosya adı, SmartScreen rehberi, 503 → "Tarayıcıdan devam et",
410 → iptal ekranı, macOS ve mobilde indirme seçeneğinin olmaması, 375 px taşma, açık/koyu axe 0.
Gerçek Windows'ta SmartScreen, ekran yakalama, DPI ve iz testi elle yapılır (runbook §11.8).

P5 e2e'si (`e2e/p5-collab.spec.ts`, yalnız masaüstü): sohbet + XSS, iki yön dosya, tenant sınırı, bozuk SHA, iptal,
teklif sınırı ve zaman aşımı, yetkisiz kullanıcı, işaretleme ve lazer, PiP, kalite paneli, axe (açık/koyu) ve
375 px taşma. AC-41 (1080p ≥ 15 FPS) ve AC-57 (işaretleme p95 < 200 ms) burada yerel ön kanıtla ölçülür; gerçek ağ
ölçümü staging'de yapılacak.

## Deploy

- Tek sunucu, Docker Compose. MySQL portu yayımlanmaz; server portu host'a açılmaz.
- Prod: **`https://remote.noktabilisim.net`** — host nginx (Let's Encrypt) → Caddy `127.0.0.1:4451` (ADR-0015, ADR-0019,
  runbook §20). Prod'da `CADDY_BIND=127.0.0.1` olur; `https://185.126.217.99:4450` açılış imzasından sonra dışarıdan kapanır.
  Yanıtlarda `Strict-Transport-Security: max-age=31536000; includeSubDomains` bulunur (preload yok).
- **P13b prod terfisi** (yerinde terfi, yeni volume ve sırlar, `DEPLOY_ENV=production`): sıra, beklenen çıktılar, imzalı
  kontrol listesi ve geri dönüş runbook §20.2–§20.8'dedir.
- **P8b-1 yayını:** yedek → `.env`'e `WHATSAPP_SERVICE_URL=`, `MIN_AGENT_VERSION=` (boş) → `up -d` → seed → nginx vhost
  güncellemesi → doğrulama; adımlar ve geri alma `docs/runbook.md` §12.
- Yeni sürüm: `git pull && IMAGE_TAG=<sürüm> docker compose build && IMAGE_TAG=<sürüm> docker compose up -d`.
- Sağlık: `/health` ve `/ready` yalnız konteyner içinden erişilir (Caddy dışarıya 404 döner).
- TURN: `deploy/turn` ayrı compose projesidir (host ağı); kurulum, güvenlik duvarı ve doğrulama `docs/runbook.md` §9.
  TURN'ün dışarıdan çalışması için üst NAT'ta (pfSense) ve UFW'de 3478/udp+tcp, 5349/tcp ve **49160–49479/udp** (P13b'de
  genişledi) açılır (runbook §9.3, §20.1; ağ yöneticisi talebi). TURN-TLS 5349'dadır; 443 kullanılmaz (ADR-0018).
- Migration her `up -d`'de `migrate` servisiyle otomatik uygulanır; server `migrate` başarıyla bitmeden başlamaz.
  Yedekleme ve geri yükleme: aşağıdaki "Yedek, geri yükleme ve saklama" bölümü.
- **P13a yayını:** migrate → `backup` kullanıcısı (`deploy/mysql/backup-user.sql`) → grants → server; ardından yedek
  zamanlayıcısı kurulumu ve prova. Sıra, doğrulama ve geri alma: `docs/runbook.md` §18.7–§18.8.
- **P7 yayını:** `20261111050000_p7_consent_source_tech` migration'ı P7 server'ından **önce** uygulanmalıdır (P7 server
  `source='TECH'` satırı yazar; eski CHECK bunu reddeder). Compose sırası bunu sağlar; elle yayında önce
  `docker compose run --rm migrate`, sonra `docker compose up -d server`. Geri alma: önce P7 kodu, sonra `down.sql`
  (`docs/db-notlari.md` P7; `TECH` satırı varsa `down.sql` atomik olarak başarısız olur).

- **P8 yayını:** iki migration (`20261111060000_p8_session_history`, `20261111070000_enum_check_binary`). `up -d`'den
  **önce** ADR-0014 ön kontrolü (`precheck.sql`, salt okunur) çalıştırılır; her satır 0 olmalıdır. Sıfır olmayan
  satır elle düzeltilmez (KVKK kanıtı), mimara bildirilir. Komutlar ve geri dönüş: `docs/runbook.md` §6.1.

### Yedek, geri yükleme ve saklama (P13a; runbook §18)

- **Ne yedeklenir:** MySQL dökümü (`backup` kullanıcısı, yalnız okuma) ve `uploads` volume'u (logo/avatar), aynı
  çalıştırmada. Her çalıştırma bir `manifest.json` üretir (son migration, tablo satır sayıları, SHA-256'lar).
- **Ne zaman / ne kadar:** her gün 02:00 (systemd `remote-backup.timer`), 14 gün saklanır (RPO ≤ 24 sa).
- **Şifreleme:** `age` açık anahtarıyla; çözme anahtarı sunucuda tutulmaz (yönetici parola kasasında, runbook §18.1).
  Düz döküm diske yazılmaz.
- **Yapılandırma:** `deploy/backup/backup.env` (git dışı, sahibi root, izin 600; şablon `backup.env.example`):
  `BACKUP_DIR`, `BACKUP_AGE_RECIPIENT`, `BACKUP_KEEP_DAYS`, `BACKUP_MIN_FREE_MB`, `BACKUP_ALERT_CMD`,
  `BACKUP_EXPECTED_TRIGGERS`. MySQL parolası burada değil, `deploy/.env` `MYSQL_BACKUP_PASSWORD`'dadır.
- **Kurulum:** host'ta `apt-get install -y age jq`, ardından birimleri kurma ve ilk elle çalıştırma (runbook §18.2):
  ```bash
  systemctl start remote-backup.service && journalctl -u remote-backup.service -n 20 --no-pager   # "remote-backup: OK run=…"
  ```
- **Doğrulama provası** (canlıya dokunmaz; ayda bir):
  `deploy/backup/restore.sh --identity <age-anahtarı> <çalıştırma-dizini> --target scratch` → `restore-verify: OK`.
  Gerçek geri yükleme `--target staging --confirm <db>@<host>` ile yapılır (runbook §18.4–§18.5).
- **Hata:** yedek başarısız olursa birim `failed` olur, journal'a `remote-backup: FAILED` yazılır ve tanımlıysa
  `BACKUP_ALERT_CMD` çalışır (runbook §18.3, §19.10).
- **Saklama işi:** server içinde her gün 03:30 çalışır; ayrı kurulum gerekmez. Süreler ve alarm (`rs_retention_*`, 26 sa):
  runbook §18.6. Anonimleştirilen veri yedeklerde en çok 14 gün daha kalır.

**P16 eklemeleri (kalıcı silme; runbook §23):**

- **İmha defteri:** her kalıcı silme (kullanıcı, firma) kişisel veri içermeyen bir satır olarak
  `/var/lib/remote/erasure-ledger.jsonl`'a yazılır (volume `remote_ledger`, server rw, migrate salt okunur). Defter DB
  dökümüne girmez; `backup.sh` onu ayrı şifreli dosya (`erasure-ledger.jsonl.age`) olarak yedek setine ve site dışına
  ekler, kısalma/değişme varsa `FAILED adım=imha-defteri`. **`remote_ledger` volume'u silinmez; `docker compose down -v`
  yasaktır.**
- **Geri yükleme sonrası zorunlu:** `restore.sh --target staging|production` server'ı başlatmadan önce `erasure:replay`,
  sonra `erasure:verify` çalıştırır. Elle DB yüklemesinde aynı iki komut zorunludur:
  ```bash
  cd /opt/remote/deploy && docker compose run --rm --no-deps -T migrate pnpm --filter @remote/server cli erasure:replay
  docker compose up -d
  docker compose run --rm --no-deps -T migrate pnpm --filter @remote/server cli erasure:verify   # rc 0 olana kadar
  ```
  Çıkış kodları: 0 tamam · 1 verify'da bekleyen var · 2 kullanım/env · 3 replay geri yüklenen DB ile tutarsız defter
  satırını reddetti (kurcalama şüphesi; meşru satırlar uygulandı, `restore.sh` server'ı başlatmaz, elle karar) · 5 DB/defter
  hatası (runbook §23.5). Replay yalnız geri yüklenen DB'de pasif (≥ 16 g ya da silme işi kaydı olan) firmaları ve Super
  Admin olmayan, firmaya bağlı kullanıcıları işler.
- **Yedekten düşme:** kalıcı silinen veri yedeklerden en geç 14 günde düşer (`BACKUP_KEEP_DAYS` ≤ 14 ve site dışı
  saklama ≤ 14 gün; aylık kontrol runbook §23.7). Beklenen tetikleyici sayısı 22 (`BACKUP_EXPECTED_TRIGGERS` boş = 22).

**P13b eklemeleri (runbook §18.9, ADR-0020):**

- **İmzalı manifest:** her yedeğin `manifest.json`'u sunucudaki ed25519 anahtarıyla imzalanır (`manifest.json.sig`;
  anahtar `/etc/remote-backup/manifest_ed25519`, root 600). Manifest ortamı (`env`), sunucuyu (`host`), sırayı (`seq`) ve
  audit süreklilik ölçümünü taşır. Önkoşul: `apt-get install -y age jq openssh-client util-linux` (OpenSSH ≥ 8.9).
- **`allowed_signers`:** imzanın açık anahtar satırı (`/etc/remote-backup/allowed_signers`, 644). Sır değildir; parola
  kasasına da konur. `restore.sh` her şeyden önce imzayı doğrular; imzasız, bozuk imzalı ya da değiştirilmiş yedek çözülmeden
  reddedilir (`restore-verify: FAIL (imza)`). Atlama seçeneği yoktur. P13a'nın imzasız yedekleri yeni betikle açılmaz.
  ```bash
  deploy/backup/restore.sh --identity <age-anahtarı> --allowed-signers <kasadaki allowed_signers> --target scratch <çalıştırma-dizini>
  ```
- **Ortam kilidi:** `--target staging|production` için `deploy/.env` `DEPLOY_ENV` = hedef = manifest `env` olmalı ve
  `--confirm <db>@<hostname -s>` verilmeli; production ayrıca TTY onayı ister. Döküm migrator ile, istemci komutları kapalı
  (`--system-command=OFF`) yüklenir; `CHECKSUM TABLE` değerleri scratch ve canlıda eşit olmalıdır.
- **Audit süreklilik:** geçmiş günlerin audit sayısı/özeti değişirse ya da en büyük id azalırsa yedek
  `FAILED adım=audit-sureklilik` ile biter ve alarm çalışır (yedek yine imzalanıp saklanır). Meşru sıfırlama yalnız
  `sudo deploy/backup/backup.sh --reset-audit-baseline "<gerekçe>"` ile yapılır (runbook §19.12).
- **Site dışı kanca:** `backup.env` içindeki `BACKUP_OFFSITE_CMD` tanımlıysa her başarılı ve imzalı çalıştırma dizini
  ayrı ve yetkisiz `remote-offsite` kullanıcısıyla bu komuta verilir. Kanca hatası yerel yedeği bozmaz,
  `OFFSITE-FAILED rc=<n>` yazar ve alarm çalıştırır. Tanımsızsa her çalıştırmada `OFFSITE-UNCONFIGURED` uyarısı çıkar.
  Komut metni loglanmaz; metinde sır (bot token'ı, `x-api-key:`, `Authorization: Bearer`) varsa çalıştırılmaz.
  Site dışı hedefin kendisi henüz seçilmedi (K-P13b-4).
- **Durum dosyası:** `/var/lib/remote-backup/status.prom` (son başarı, site dışı durumu, audit süreklilik); `remote-watch` okur.

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
build attestation üretir; `v*` etiketinde onaylı Release açar (0.11.0 ve sonrası: onay → koşullu SignPath imzası →
attestation → Release; runbook §24). Sunucuya yayın operatör makinesinden yapılır:

```bash
deploy/agent/verify-and-publish.sh --tag vX.Y.Z --ssh root@185.126.217.99      # önce --dry-run ile yalnız doğrulama
```

Betik `SHA256SUMS` + `gh attestation verify` doğrular, exe'yi `agent_downloads` volume'una koyar, `deploy/.env`
içindeki `AGENT_SHA256`'yı yazar, server'ı yeniden başlatır ve Caddy üzerinden hash'i kontrol eder. Rollback, staging
(Release'siz) yayını, private repo yolu ve bütünlük alarmı: runbook §11.3–§11.7. Günlük dış gözcü: `agent-watch.yml`.

- Günlük işlemler, loglar, sorun giderme: [`docs/runbook.md`](docs/runbook.md).

### Prod işletim araçları (P13b; runbook §20)

Hepsi host'ta root ile kurulur; kurulu kopya git ağacından değil kendi yerinden çalışır. Betik değişince `install` yeniden
çalıştırılır.

| Araç                   | Ne yapar                                                                                                                                                                                                                                                                                                                        | Kurulum / kullanım                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reset-superadmin` CLI | Super Admin şifresini (isteğe bağlı 2FA'sını) sunucudan sıfırlar. Geçici şifre yalnız terminale bir kez yazılır, **24 saat** geçerlidir, ilk girişte değişim zorunludur; açık oturumlar kapanır. Audit: "Super Admin şifresi sunucudan sıfırlandı" (`auth.superadmin_reset`, şifre yok). Terminal yoksa çalışmaz (çıkış kodu 4) | `cd /opt/remote/deploy && docker compose exec server node src/cli/reset-superadmin.ts --email <e-posta> [--reset-mfa] [--dry-run]` (`-T` verilmez; runbook §20.6)                                                     |
| `remote-watch`         | 10 dakikada bir servisleri, `/ready`'yi, nginx, coturn (STUN + 5349), zamanlayıcıları, yedek yaşını ve audit sürekliliğini, sertifika sürelerini, disk ve dosya izinlerini denetler. Bozulunca alarm komutunu çağırır; aynı alarmı en çok 6 saatte bir tekrarlar, düzelince bir kez "DUZELDI" bildirir                          | `sudo deploy/ops/remote-watch.sh install` → `/etc/remote-watch/watch.env` (600) içinde `WATCH_ALERT_CMD` (örnek `deploy/ops/watch.env.example`; mesaj stdin'den gelir, token komut metnine yazılmaz) (runbook §20.4)  |
| `proxy-guard`          | nftables kuralıyla host'tan Caddy'nin yerel 4451 girişine yalnız `root` ve nginx kullanıcısının (`www-data`) bağlanmasına izin verir; başka yerel süreçler sahte istemci IP'si gönderemez                                                                                                                                       | `sudo apt install nftables` → `sudo deploy/ops/proxy-guard.sh install` → `sudo remote-proxy-guard check` ve `verify` (5 dk'da bir `ensure`; geri alma `uninstall`)                                                    |
| TURN sertifika kancası | Let's Encrypt `remote-turn` sertifikası yenilenince coturn'e kopyalar, SIGUSR2 ile yükletir, 5349'da sunulan parmak izini doğrular; olmazsa konteyneri yeniden başlatır, yine olmazsa hata döner                                                                                                                                | `sudo deploy/turn/cert-deploy-hook.sh install` → `certbot certonly … --cert-name remote-turn --deploy-hook /usr/local/sbin/remote-turn-cert-deploy` → `/usr/local/sbin/remote-turn-cert-deploy check` (runbook §20.5) |

Yerel testler (Docker gerekir, sunucuya bağlanmaz): `deploy/backup/test-backup.sh`, `deploy/ops/test-watch.sh`,
`deploy/ops/test-proxy-guard.sh`, `deploy/turn/test-cert-hook.sh`.

## Kullanılan ortak servisler

| Servis                                                              | Ne için                                                                                                                                                                               | Bağlantı                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| whatsapp-bildirim (Nokta Bilişim, `Projeler/whatsapp-bildirim`)     | Destek talebi WhatsApp bildirimi ve test mesajları (`POST {url}/send-message`, `POST {url}/test-send`)                                                                                | Adres ve servis anahtarı Super Admin → Sistem ayarları → **WhatsApp servisi**'nden yönetilir; panel kaydı yoksa `WHATSAPP_SERVICE_URL` + `WHATSAPP_SERVICE_API_KEY`. Yerleşik varsayılan adres yoktur; ikisi de boşsa kanal kapalıdır. Anahtar `x-api-key` başlığıyla gider. Production'da `https://` veya özel ağ adresi gerekir (runbook §12.3, §17) |
| SMTP (firmanın kendi sunucusu)                                      | Şifre sıfırlama, kilit, oturum bağlantısı ve talep e-postaları; P27a yeni cihaz uyarısı; P27 gözetimsiz bağlantı bildirimi (firmanın SMTP kaydı yoksa gözetimsiz erişim kullanılamaz) | Firma başına Ayarlar > E-posta (SMTP); şifre AES-256-GCM ile saklanır                                                                                                                                                                                                                                                                                  |
| smsportal (Nokta Bilişim, `Projeler/smsportal`; arka planda NetGSM) | P19: oturum bağlantısı SMS'i, web talebi durum SMS'i, test SMS (`POST {url}/api/external/send-sms`, başlık `x-api-key`)                                                               | Firma başına Ayarlar > **SMS** (adres, API anahtarı şifreli, başlık); adres boşsa `SMSPORTAL_URL`. Anahtar smsportal yönetim panelinden oluşturulur. Arıza yolu runbook §26.6                                                                                                                                                                          |

WhatsApp müşteri mesajları (P19) aynı whatsapp-bildirim servisini kullanır. Paraşüt entegrasyonu yoktur.

## Klasör yapısı

```
apps/server/        Fastify API (src/), Prisma şeması ve migration'lar (prisma/), testler (test/)
apps/web/           Next.js arayüzü (app/, components/, lib/), e2e testleri (e2e/)
packages/contracts/ Ortak zod şemaları, yetki listesi, hata kodları
apps/agent-win/     Windows istemci (Go): cmd/noktadestek (NoktaDestek.exe), cmd/noktadestek-servis (P27 gözetimsiz
                    erişim servisi NoktaDestekServis.exe), internal/ (api, flow, rtc, capture, ui, transfer, control,
                    input, env, servis, servisui, unattended, desktop…),
                    build/ (build.sh, winres.json, winres-servis.json), test/trace-check.ps1 (-Servis profili)
deploy/             docker-compose.yml, Caddyfile, mysql/ (kullanıcı init + yetki kontrol betiği),
                    turn/ (coturn compose, başlatıcı, güvenlik duvarı ve test betikleri),
                    agent/ (verify-and-publish.sh: istemci yayını),
                    backup/ (backup.sh, restore.sh, lib*.sh, systemd birimleri, backup.env.example, test-backup.sh),
                    ops/ (remote-watch, proxy-guard, systemd birimleri, watch.env.example, testler),
                    turn/cert-deploy-hook.sh (TURN sertifika kancası)
scripts/            Lisans denetimi, gerçek sunucu e2e betiği (e2e-real.sh), doküman PDF betiği (build-docs.sh)
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
- Uzaktan kontrol (P7): tek izin kaynağı istemcideki kapıdır; sunucu ve konsol kapıyı açamaz, yalnız kapatabilir.
  Kapı her `SendInput`'tan hemen önce denetlenir; kapanınca takılı tuşlar bırakılır. İzin diyaloğu (kontrol, monitör,
  dosya kabulü) yalnız müşterinin gerçek fare/klavye girdisini kabul eder. İstemcide girdi hız sınırı (250 olay/sn).
  Yetki daralması 60 sn'lik teknisyen yeniden doğrulamasında `caps.update` + `control.revoke{permission}` ile kontrolü
  keser. İzin kaydı yazılamazsa kontrol açılmaz.
- Oturum geçmişi (P8): beş uç tek kapsam fonksiyonunu kullanır, kapsam dışı kayıt 404. CSV hücreleri formül
  enjeksiyonuna karşı kaçışlanır (AC-124). Detay API'si onay kayıtlarının IP/tarayıcı bilgisini döndürmez; not metni
  ve müşteri arama metni audit'e yazılmaz. Bekleyen oturum kodu yalnız kendi teknisyenine döner. Enum CHECK'leri
  ikili karşılaştırmalı (ADR-0014).
- Müşteriler ve bilgisayar kaydı (P8c): kayıt anahtarı 256 bit, sunucuda yalnız SHA-256, log/audit'te yok; yalnız talep
  açar (resolve/join/WS/TURN uçlarında kabul edilmez). Geçersiz ref ve kayıt tek tip 404 döner. Kayıt başına 1 bekleyen
  ve saatte 6 talep. İstemci anahtarı yalnız kaydı veren sunucuya gönderir. Audit'te müşteri yetkili kişi verisi maskeli.
- Kullanıcı ve yetki yönetimi (P9): yetki kontrolü her uçta sunucuda; sahip olunmayan yetki verilemez, kendinden geniş
  yetkili hesap yönetilemez, Super Admin hesapları firma uçlarında görünmez. Geçici şifre yalnız oluşturma yanıtında döner
  ve loga yazılmaz. Her yetki değişikliği anahtar başına audit'e yazılır.
- Hesap güvenliği (P10): 2FA (TOTP, tekrar oynatma korumalı); kurtarma kodları HMAC-SHA-256, sıfırlama token'ı
  SHA-256 olarak saklanır. SMTP şifresi ve TOTP sırrı AES-256-GCM (`APP_ENCRYPTION_KEYS`, kayda bağlı AAD). SMTP hedefi
  yalnız 4 portta ve genel internet adresinde olabilir (iç ağ, loopback, sunucunun kendi adresi reddedilir); TLS'te
  sertifika adı doğrulanır. Gönderim hatasında kullanıcıya tek genel mesaj; ayrıntı yalnız log/audit'te.
- Audit ve sistem ayarları (P11): audit kayıtları API'de salt okunur (405), DB'de `app` kullanıcısının UPDATE/DELETE/
  TRIGGER/DDL yetkisi yok, tetikleyiciler UPDATE'i ve 730 günden yeni kaydın silinmesini reddeder. Okumada maske yeniden
  uygulanır. MySQL şifresi ve TURN secret'ı AES-256-GCM ile saklanır, forma geri yazılmaz; MySQL şifresi hedefe bağlı
  AAD ile saklanır ve başka sunucuya gönderilmez. MySQL testi yalnız Super Admin'e açık, 5/dk/kişi + 20/dk toplam.
- Logo ve avatar (P12): tür yalnız içerikten (PNG/JPEG/WEBP; SVG asla), 2 MB, 24 MP, kenar/oran sınırı, sunucuda yeniden
  kodlama ve metadata silme, rastgele ad, firma klasörü. Dosya yalnız DB'de kayıtlı yolsa sunulur; avatar oturumlu ve
  yalnız aynı firmaya (başka firma 404), logolar herkese açık. Yükleme kişi başı 20/sa, işleme 2 eşzamanlı.
- Güvenlik/kalite (P14a): kritik sistem ayarı yazımı son 5 dk içinde step-up 2FA ister (TOTP veya tek kullanımlık kurtarma
  kodu; kod audit'e yazılmaz). Kullanıcı düzenleme iyimser kilitli (`If-Match`, 428/409); kullanıcı yönetimi işlemleri aktörün
  yetkisini işlem içinde yeniden okur. Kullanıcı ve firma yazma uçları hız sınırlı; yetki kaynaklı 403'ler audit'e yazılır.
  MySQL testi isteğe bağlı TLS + sertifika doğrulaması. Prod'da zayıf şifreleme anahtarı başlangıçta reddedilir.
- P15: kurtarma kodu yenileme yalnız TOTP ile ve 2FA deneme sayacına bağlı; Super Admin panel sıfırlaması step-up ister,
  kendi hesabına kapalıdır. Talep engelleri firma bazlı ve yetkiye bağlı; engelli kaynak diğer reddedilenlerle aynı yanıtı
  alır. Müşteriye gösterilen teknisyen fotoğrafı oturuma bağlı, 10 dk geçerli HMAC imzalı adresten ve yalnız oturum
  sürerken sunulur; adreste oturum token'ı yoktur.
- Prod (P13b): yedek manifesti imzalı, geri yükleme imza ve ortam kilidiyle; `reset-superadmin` şifreyi yalnız terminale
  yazar; yerel 4451'e yalnız root/nginx bağlanır (`proxy-guard`); HSTS `includeSubDomains`; WhatsApp servis anahtarı şifreli
  saklanır, yalnız kaydedildiği adrese gider.
- Saklama ve yedek (P13a): süresi dolan müşteri kişisel verisi her gece anonimleştirilir; müşteri kaynaklı audit kayıtlarında
  ad yok, IP yalnız ağ öneki. `app` kullanıcısı 730 günden yeni audit'i silemez, geri tarihli kayıt yazamaz. Yedekler `age`
  ile şifreli, çözme anahtarı sunucuda yok; geri yükleme istemci komutlarını kapatır ve hesap/yetki değişikliği görürse durur.
- Konteynerler salt okunur kök dosya sistemi, `cap_drop: ALL`, root olmayan kullanıcıyla çalışır; imajlar digest ile sabitlenir.
- CI: `pnpm audit`, lisans denetimi (GPL/AGPL yasak), gitleaks. Repoya gizli bilgi girmez.
- Ayrıntı: `docs/guvenlik-raporu.md`, ADR'ler `docs/adr/`.

## Katkı

- Kurallar: [`CLAUDE.md`](CLAUDE.md) (paket kuralları, değişmez kurallar), UI: [`DESIGN.md`](DESIGN.md).
- Yeni ortam değişkeni → `.env.example` (boş) + `apps/server/src/env.ts` + `deploy/docker-compose.yml` + runbook.
- Yeni tablo → `apps/server/prisma/sql/grants.sql`'e yetki satırı.
- PR öncesi `pnpm format:check`, lint, typecheck, test ve e2e yeşil olmalı. Değiştirdiğiniz dosyaları
  `pnpm exec prettier --write <dosya>` ile biçimleyin.
- Doküman PDF'leri (`docs/pdf/` README, KULLANIM_KILAVUZU, DATASHEET): `pnpm docs:pdf` (`scripts/build-docs.sh`; ortak araç yolu `DOCS_PDF_TOOL` ile değiştirilebilir).

## Lisans

Apache License 2.0 — bkz. [`LICENSE`](LICENSE).
