# Remote Support — Nokta Bilişim uzaktan destek platformu

Self-hosted, çok kiracılı (multi-tenant) uzaktan destek platformu. Teknisyen web konsolundan bir destek
oturumu açar; müşteri taşınabilir Windows istemcisi (tam erişim) veya tarayıcı (yalnız görüntü) ile katılır.
Görüntü eşler arası WebRTC ile akar; sunucu yalnız sinyalizasyon ve meta veri tutar.

## Şu anki durum: P1–P12b tamamlandı, P13a kodu hazır (staging doğrulaması ve Windows elle testleri bekliyor)
İş P1..P13 dikey paketlerle yürür (`docs/mimari.md` §10). P1–P11 ve **P12** (firma ve sistem logosu, kullanıcı profil
resmi, kullanıcı başına tema, hesap menüsü, tasarım token lint kuralı) tamamlandı: P12 güvenlik Kritik/Yüksek 0 (doğrulama
turu GEÇTİ), sayfa testi gerçek server ile GEÇTİ, QA Tur 2'nin tek maddesi (P11'e ait kararsız e2e testi) düzeltildi
(`docs/arsiv/p12-qa-raporu.md`, `docs/arsiv/p12-test-raporu.md`, `docs/guvenlik-raporu.md`). **P12b** (Super Admin
"WhatsApp servisi" sistem ayarı, AC-196) tamamlandı: QA Tur 3 GEÇTİ, güvenlik Kritik/Yüksek/Orta 0 (`docs/qa-raporu.md`,
`docs/guvenlik-raporu.md`). P11, P12 ve P12b henüz staging'e yayınlanmadı (yayın adımları runbook §15, §16, §17). Windows istemci **0.10.2** qa ve güvenlik denetiminden geçti. Gerçek
Windows'ta elle testler (P7, P8b-2, P8c-2, 0.10.2) ve AC-192 staging ölçümü bekliyor. **P13a** (saklama işi, şifreli
yedek/geri yükleme, runbook senaryo dizini, dokümantasyon PDF'leri) kodlandı; staging kurulumu ve yedek provası runbook §18.7'de
bekliyor. Sıradaki paket **P13b** (prod açılışı; alan adı ve TURN ayrı IP kararlarına bağlı). Açık maddeler
`docs/gereksinimler-sonra-acik.md`.

Staging: **https://remote.noktabilisim.net** (ADR-0015; IP girişi `https://185.126.217.99:4450` geçiş süresince açık).

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
- WhatsApp adresi kanonik biçimde saklanır, yeni **Varsayılan** kaynak rozeti; sistem ayarı yazımları 10/dk/kullanıcı.
- **Şifreli günlük yedek** (`deploy/backup/`, systemd 02:00, `age`, 14 gün) ve doğrulamalı geri yükleme (bkz. "Yedek, geri
  yükleme ve saklama").
- Migration `20261114120000_p13a_retention`. Yeni ortam değişkeni **`MYSQL_BACKUP_PASSWORD`**. Yeni bağımlılık yok (host'ta
  `age`, `jq`).

**Düzeltme — talepten doğan oturumda siyah ekran:** sunucu teknisyene ICE (TURN) listesini `peer.joined`'dan önce
gönderir, konsol liste gelmeden teklif üretmez (`6701567`).

API ayrıntısı: [`docs/api.md`](docs/api.md). Sürüm geçmişi: [`CHANGELOG.md`](CHANGELOG.md).
Kullanım (müşteri, teknisyen, yönetici): [`docs/KULLANIM_KILAVUZU.md`](docs/KULLANIM_KILAVUZU.md).
Ürün föyü: [`docs/DATASHEET.md`](docs/DATASHEET.md).

**İlk hesaplar:** Seed yalnız Super Admin oluşturur (ilk girişte şifre değişimi zorunlu). Super Admin "Firmalar"
ekranından firma oluşturur, üst menüden o firmaya geçer ve **Kullanıcılar > Yeni kullanıcı** ile firmanın ilk Admin'ini
ekler (runbook §14.1). P10'dan itibaren Super Admin ve Admin ilk girişte (şifre değişiminden sonra) **2FA kurar**:
telefonda bir doğrulama uygulaması hazır olmalı, 10 kurtarma kodu parola kasasına kaydedilmeli. Super Admin firma seçmeden destek oturumu açamaz; oturum geçmişini firma seçmeden tüm firmalar için
görür. `deploy/staging-users.sh` staging test hesapları için hâlâ kullanılabilir (`docs/runbook.md` §6).

## Yol haritası
| Paket | Kapsam |
|---|---|
| P2 ✓ | Destek oturumu oluşturma (8 haneli kod), liste, iptal, karşılama sayfası iskeleti |
| P3 ✓ | Sinyalizasyon sunucusu (WebSocket), lobi + teknisyen kabulü, TURN (coturn), `/metrics` |
| P4 ✓ | Tarayıcı modu ekran paylaşımı, KVKK onayı, teknisyen konsolu video |
| P5 ✓ | Sohbet, dosya transferi, ekran üzerine işaretleme + lazer + yüzen pencere, kalite paneli |
| P6 ✓ | Windows istemci (Go, imzasız; SHA-256 + build attestation) |
| P7 ✓ | Uzaktan kontrol (izin diyaloğu, klavye/fare, monitör değiştirme) |
| P8 ✓ | Oturum geçmişi, not/ticket, CSV dışa aktarma, istemcide fare imleci |
| P8b-1 ✓ | Müşteri destek talebi: sunucu uçları, panel kuyruğu, ayarlar, WhatsApp bildirimi |
| P8b-2 (kod ✓, Windows elle test bekliyor) | Windows istemci 0.9.0: "Destek iste" formu, bekleme ekranı, 503 yeniden deneme |
| P8c-1 ✓ | Müşteri firmalar (Müşteriler modülü), müşteri başına kalıcı bağlantı, bilgisayar kaydı (sunucu + panel) |
| P8c-2 (kod ✓, Windows elle test bekliyor) | Windows istemci 0.10.0: kalıcı "Destek iste", "Bağlantı kodum var", "Bu bilgisayarı unut" |
| P9 ✓ | Kullanıcı/yetki toggle'ları, tenant yönetimi, Super Admin tenant geçişi |
| P10 ✓ | 2FA (TOTP), şifre sıfırlama e-postası, SMTP ayarı + test, tüm cihazlardan çıkış, e-posta bildirimleri |
| P11 ✓ | MySQL/TURN ayarları + test, audit log ekranı, audit tetikleyicileri, aydınlatma metni düzenleme |
| P12 ✓ | Firma/sistem logosu, avatar yükleme, kullanıcı tema tercihi, hesap menüsü, token lint kuralı |
| P12b ✓ | Super Admin "WhatsApp servisi" sistem ayarı: servis adresi, kaynak rozeti, test mesajı |
| P13a (kod ✓, staging doğrulaması bekliyor) | Saklama işi (anonimleştirme, audit 730 g), şifreli yedek/geri yükleme, runbook senaryo dizini, kılavuz, datasheet, PDF'ler |
| P13b | Prod açılışı: alan adı, TURN ayrı IP/443, IPv6, site dışı yedek, Super Admin kurtarma CLI |

Prod açılışı P10 (2FA) sonrası mümkündür; ön koşullar runbook §14 P10 "Prod açılış kontrol listesi". O zamana kadar
yalnız staging kullanılır.

## Teknoloji yığını
| Katman | Teknoloji |
|---|---|
| Server | Node.js ≥ 22.18 (yerleşik TypeScript type stripping, derleme adımı yok), Fastify 5, Prisma 7, zod, pino, argon2id, nodemailer (SMTP), qrcode (2FA QR) |
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
| `MYSQL_BACKUP_PASSWORD` | Yedek için | P13a: `backup` MySQL kullanıcısının parolası, ≥ 16 karakter (`openssl rand -hex 24`). Yalnız `mysql` servisine verilir; server okumaz. Boşsa kullanıcı oluşturulmaz ve yedek hata verir (runbook §3, §18) |
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
| `WHATSAPP_SERVICE_URL` | Hayır | P8b: whatsapp-bildirim servis adresi (sistem düzeyi). **P12b'den beri yalnız yedek:** Sistem ayarları > WhatsApp servisi'nde panel kaydı varsa o geçerlidir. Boşsa varsayılan servis (ekranda "Varsayılan" rozeti). Değer kanonik biçime çevrilir (P13a). Kural: `http://`/`https://`, kullanıcı:şifre, `?`, `#`, boşluk ve görünmez karakter yok, ≤ 200 karakter; **uymazsa server açılmaz** (runbook §17.1). Production'da şifresiz + genel adres → kanal kapalı başlar (runbook §12.3) |
| `APP_ENCRYPTION_KEYS` | Evet | P10: SMTP şifresi ve 2FA sırlarının AES-256-GCM anahtarı, `v1:<base64 32 bayt>`. Üretim: `echo "v1:$(openssl rand -base64 32)"`. Production'da yoksa server açılmaz. **Parola kasasında yedeklenmeli**: kaybolursa SMTP şifreleri yeniden girilir, tüm kullanıcıların 2FA'sı sıfırlanır. Rotasyonda eski sürüm silinmez (`v1:…,v2:…`); runbook §3 ve §14 P10 |
| `MIN_AGENT_VERSION` | Hayır | P8b: asgari Windows istemci sürümü `x.y.z`; boş = kontrol yok. Müşterilerin tamamı 0.9.0 firma dosyasına geçene kadar boş bırakın (runbook §12.4) |
| `UPLOADS_DIR` | Compose dışı | P12: logo/avatar dosyalarının kökü, **mutlak yol**. Compose sabit `/data/uploads` verir (volume `remote_uploads`); boşsa `/data/uploads`. Yedeği DB ile aynı pencerede alınır (runbook §16.3) |
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

### Son test sonuçları (P13a, 2026-11-14)
| Takım | Sonuç |
|---|---|
| Birim (`pnpm -r run test`) | 676: server 349, web 249, contracts 78 |
| Server entegrasyon (`test:int`, temiz DB) | 529 (53 dosya); P13a: `retention-p13a-job`, `retention-p13a-db`, `audit-customer-p13a`, `whatsapp-admin-p12b` (P13a ekleri) |
| Web e2e (sahte API/WS, tüm projeler) | 305 geçti, 0 hata; P13a spec'i `e2e/p13a.spec.ts` |
| `deploy/mysql/check-app-grants.sh` | 373/373 PASS (tetikleyici 3, backup hesabı dahil) |

Staging ölçümleri (AC-88 temiz kurulum, AC-91/200 yedek ve geri yükleme provası) runbook §18.7'de bekliyor.

#### Önceki paket (P12b, 2026-11-13)
| Takım | Sonuç |
|---|---|
| Birim (`pnpm -r run test`) | 665: server 347, web 243, contracts 75 |
| Server entegrasyon (`test:int`) | 491 (50 dosya); P12b: `whatsapp-admin-p12b` (paylaşılan ayar satırı nedeniyle ayrı vitest projesinde, en sonda), `whatsapp-setting` (DB CHECK) |
| Web e2e (sahte API/WS) | P12b spec'i `e2e/p12b-whatsapp.spec.ts` + `p11-admin`, `p8b-requests` regresyonu: 42 geçti, 0 hata, 30 atlandı (masaüstü-yalnız) |

QA Tur 3 GEÇTİ (`docs/qa-raporu.md`); güvenlik Kritik/Yüksek/Orta 0, Düşük 1 açık (B-P12b-4, Sonra).

#### Önceki paket (P12, 2026-11-13)
| Takım | Sonuç |
|---|---|
| Birim (`pnpm -r run test`) | 648: server 339, web 238, contracts 71 |
| Server entegrasyon (`test:int`) | 471 (48 dosya); P12: `branding-api-p12`, `branding-p12` (DB CHECK), tenant matrisi +10 uç |
| Web e2e (sahte API/WS) | 281 geçti + 106 atlandı (masaüstü/mobil proje filtreleri), art arda 3 koşuda 0 hata; P12 spec'i `e2e/p12-branding.spec.ts` |

Sayfa testi (`docs/arsiv/p12-test-raporu.md`): gerçek server + MySQL ile 20 akış adımının 20'si geçti; 136 görünüm (açık/koyu,
1280/390 px), axe 0 ihlal, JS hatası 0, kırık iç bağlantı 0. P11'den kalan gerçek-server akışları (Super Admin girişi + 2FA,
audit 405, CSV formül kaçışı) da doğrulandı.

#### Önceki paket (P11, 2026-11-13)
| Takım | Sonuç |
|---|---|
| Birim (`pnpm -r run test`) | 613: server 324, web 218, contracts 71 |
| Server entegrasyon (`test:int`) | 445 (46 dosya); P11: `audit-p11`, `settings-p11`, `audit-immutability-p11`, `db-grants`. MySQL'de binlog bayrağı gerekir |
| Web e2e (sahte API/WS) | 264 geçti + 95 atlandı (masaüstü/mobil proje filtreleri); P11 spec'i `e2e/p11-admin.spec.ts` (iki tema, 1280/390 px) |

Sayfa testi (`docs/arsiv/p11-test-raporu.md`): 6 senaryo × 22 rota × açık/koyu × 1280/390 = 88 görünüm, axe 0 ihlal, JS
hatası 0; gerçek server ile akışlar staging'de elle doğrulanacak.

#### Önceki paket (P10, 2026-11-12)
| Takım | Sonuç |
|---|---|
| Birim (`pnpm -r run test`) | 586: server 310, web 205, contracts 71 |
| Server entegrasyon (`test:int`) | 409 (43 dosya); P10: `account-p10`, `mail-tls-p10` (openssl ister), `mail-cap-p10`, süreç içi sahte SMTP |
| Web e2e (sahte API/WS) | 243 geçti + 84 atlandı (masaüstü/mobil proje filtreleri, `p4-real`); P10 spec'i `e2e/p10-account.spec.ts` |
| gitleaks | `apps/server/src`, `apps/server/test`, `apps/web`, `packages`, `docs`: çıkış 0 |

Sayfa testi (`docs/arsiv/p10-test-raporu.md`): gerçek sunucu + MySQL + sahte SMTP ile 13 rota × açık/koyu × 1366/375,
26 akış adımı, axe 0 ihlal, JS hatası 0.

#### Önceki paket (P9, 2026-11-12)
| Takım | Sonuç |
|---|---|
| Birim (`pnpm -r run test`) | 546: server 285, web 193, contracts 68 |
| Server entegrasyon (`test:int`) | 384 (40 dosya) |
| Web e2e (sahte API/WS) | 221 geçti + 78 atlandı |

#### Önceki paket (P8, 2026-11-11)
| Takım | Sonuç |
|---|---|
| Birim (`pnpm -r run test`) | 442: server 256, web 136, contracts 50 |
| Server entegrasyon (`test:int`) | 216 (25 dosya) |
| Web e2e (sahte API/WS) | 174 geçti + 54 atlandı |
| AC-60 performans (10.000 oturum, ilk sayfa) | ADMIN 2,4 ms · USER 2,2 ms · Super Admin 2,0 ms · API 6,7 ms (sınır 500 ms) |

#### Önceki paketler (P7, 2026-11-11)
| Takım | Sonuç |
|---|---|
| Windows istemci (`go test -race`, linux) | 15/15 paket ok (yeni: control, env, input); `GOOS=windows go vet` temiz; govulncheck 0 erişilebilir zafiyet; iki derleme aynı SHA-256 |
| Birim (`pnpm -r run test`) | 415: server 244, web 128, contracts 43 |
| Server entegrasyon (`test:int`) | 186 (23 dosya) |
| Web e2e (sahte API/WS) | 153 geçti + 45 atlandı (masaüstü akışlarının mobil kopyaları); P7 spec'i `e2e/p7-control.spec.ts` (11 test) dahil |
| Gerçek sunucu e2e (`scripts/e2e-real.sh`) | 5/5 (P5'ten değişmedi) |
| TURN (`deploy/turn/test-local.sh`) | 62 kontrol (P4'ten değişmedi) |

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
- Tek sunucu, Docker Compose. Dışarıya yalnız Caddy **4450/tcp** açılır; MySQL portu yayımlanmaz.
- Staging: **`https://remote.noktabilisim.net`** — host nginx (Let's Encrypt) → Caddy `127.0.0.1:4451` (ADR-0015,
  runbook §8.3). Geçiş süresince `https://185.126.217.99:4450` de açık (`SITE_HOST=185.126.217.99`).
- **P8b-1 yayını:** yedek → `.env`'e `WHATSAPP_SERVICE_URL=`, `MIN_AGENT_VERSION=` (boş) → `up -d` → seed → nginx vhost
  güncellemesi → doğrulama; adımlar ve geri alma `docs/runbook.md` §12.
- Yeni sürüm: `git pull && IMAGE_TAG=<sürüm> docker compose build && IMAGE_TAG=<sürüm> docker compose up -d`.
- Sağlık: `/health` ve `/ready` yalnız konteyner içinden erişilir (Caddy dışarıya 404 döner).
- TURN: `deploy/turn` ayrı compose projesidir (host ağı); kurulum, güvenlik duvarı ve doğrulama `docs/runbook.md` §9.
  Staging'de TURN'ün dışarıdan çalışması için üst NAT'ta (pfSense) 3478/udp+tcp, 5349/tcp ve 49160–49199/udp
  yönlendirmesi gerekir (runbook §9.3, ağ yöneticisi talebi).
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
- Site dışı yedek ve audit'in harici kopyası P13b'dedir.

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

## Kullanılan ortak servisler
| Servis | Ne için | Bağlantı |
|---|---|---|
| whatsapp-bildirim (Nokta Bilişim, `Projeler/whatsapp-bildirim`) | Destek talebi WhatsApp bildirimi ve test mesajları (`POST {url}/send-message`, `POST {url}/test-send`) | Adres Super Admin → Sistem ayarları → **WhatsApp servisi**'nden yönetilir; panel kaydı yoksa `WHATSAPP_SERVICE_URL`, o da yoksa varsayılan `http://89.252.189.211:3000`. Kimlik bilgisi yok. Production'da `https://` veya özel ağ adresi gerekir (runbook §12.3, §17) |
| SMTP (firmanın kendi sunucusu) | Şifre sıfırlama, kilit, oturum bağlantısı ve talep e-postaları | Firma başına Ayarlar > E-posta (SMTP); şifre AES-256-GCM ile saklanır |

SMS (smsportal) ve Paraşüt entegrasyonu yoktur.

## Klasör yapısı
```
apps/server/        Fastify API (src/), Prisma şeması ve migration'lar (prisma/), testler (test/)
apps/web/           Next.js arayüzü (app/, components/, lib/), e2e testleri (e2e/)
packages/contracts/ Ortak zod şemaları, yetki listesi, hata kodları
apps/agent-win/     Windows istemci (Go): cmd/noktadestek, internal/ (api, flow, rtc, capture, ui, transfer, control,
                    input, env…),
                    build/ (build.sh, winres.json), test/trace-check.ps1
deploy/             docker-compose.yml, Caddyfile, mysql/ (kullanıcı init + yetki kontrol betiği),
                    turn/ (coturn compose, başlatıcı, güvenlik duvarı ve test betikleri),
                    agent/ (verify-and-publish.sh: istemci yayını),
                    backup/ (backup.sh, restore.sh, systemd birimleri, backup.env.example)
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
- PR öncesi lint, typecheck, test ve e2e yeşil olmalı.
- Doküman PDF'leri (`docs/pdf/` README, KULLANIM_KILAVUZU, DATASHEET): `pnpm docs:pdf` (`scripts/build-docs.sh`; ortak araç yolu `DOCS_PDF_TOOL` ile değiştirilebilir).

## Lisans
Apache License 2.0 — bkz. [`LICENSE`](LICENSE).
