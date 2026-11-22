# Gereksinimler — P33 (macOS istemcisine ses ve tek pencere paylaşımı)

Tarih: 2026-11-22 · Durum: TASLAK (kullanıcı kararı 2026-11-21: "gelecek versiyona ekleyelim"; ayrıntılar varsayımla dolduruldu, §7)
Paket sürümü: **istemci 0.26.0** (Windows, macOS, Linux aynı etiket; prod 0.25.1 sonrası). Sunucu/web aynı etiketle.
Yeni AC'ler: **AC-534..AC-558 (25 AC)** — AC-523..AC-533 P32'ye aittir. Hikâyeler US-P33-1..4, varsayımlar V-P33-1..12,
riskler R-P33-1..10, açık sorular S-P33-1..6.
Ön koşul: kod yazılmadan önce **mimari-p33 + ADR-0037 revizyonu (ses kodek yolu, entitlement listesi) + güvenlik tasarım turu** (S-P33-1).
Kaynak satır: `docs/gereksinimler.md` "Sonra — sonraki sürüm (kullanıcı kararı, 2026-11-21)".

## 1. Amaç ve iş değeri

Bugün Mac müşterisiyle teknisyen telefonla konuşmak zorunda; Mac müşterisi de bütün ekranını paylaşmak zorunda, yalnız sorunlu
programı gösteremiyor (kılavuz "Hangi programda ne var?" tablosunda iki "Yok"). P33, Windows'ta zaten olan **sesli görüşmeyi**
(P28d, AC-373..379) ve **yalnız bir pencereyi paylaşmayı** (P17, AC-248) Mac istemcisine **Windows ile aynı kullanıcı deneyimi ve aynı
web/sunucu tarafıyla** getirir. Böylece üç masaüstü platformda tek davranış olur (sadelik ilkesi: tek ekran/tek yol).

## 2. Roller (değişiklik)

| Rol                 | P33 ile gelen                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| User (Teknisyen)    | Mac müşterisinde "Sesli görüşme" düğmesi etkin; konsolda "Pencere paylaşımı" rozeti Mac'te de görünür    |
| Müşteri (Mac)       | Ses kabul diyaloğu, ses çubuğu, Mikrofon izni rehberi; paylaşım başında "Tüm ekran / Yalnız bir pencere" |
| Admin / Super Admin | Değişiklik yok (yeni yetki, ayar, audit eylemi yok)                                                      |

## 3. Kapsam

### 3.1 Kapsamda

1. macOS Hızlı Destek (katılımlı oturum, kod/bağlantı ve P31 "Destek iste" yolu) istemcisinde P28d sesli görüşme: yetenek bildirimi
   (`rs.cap.voice1`), kabul diyaloğu, mikrofon (macOS TCC Mikrofon izni), sessize al, bitir, çoklu teknisyen, dinleyen duyurusu.
2. macOS istemcisinde AC-248 pencere modu: seçim ekranı, pencere listesi, yalnız pencere içeriğinin yayını, girdi kapsamı,
   simge durumu/kapanma davranışı, sistem kısayollarının engellenmesi.
3. Teknisyen konsolunda pencere modunun Mac'te doğru etiketle görünmesi (bugün rozet ve monitör temizliği `"WGC"` değerine sabit).
4. Paketleme: `Info.plist` mikrofon açıklaması, entitlement listesi (ADR revizyonu), CI tam eşleşme denetimi.
5. Ad-hoc imzada her sürümde düşebilen TCC izinleri (Ekran Kaydı, Erişilebilirlik, **Mikrofon**) için rehber metni, elle test, kılavuz.
6. Dokümantasyon: kılavuz, README, DATASHEET, CHANGELOG 0.26.0, PDF; eski belgelere "P33 ile değişti" notları.

### 3.2 Kapsam DIŞI (açıkça)

| #   | Madde                                                                                                                     | Durum                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | **Sistem sesinin / bilgisayar sesinin** teknisyene aktarımı (müzik, uygulama sesi). "Ses" yalnız konuşmadır               | Kapsam dışı (hiçbir platformda yok)                     |
| 2   | macOS gözetimsiz erişim (servis), bilgisayar kaydı, tepside çalışma, otomatik başlatma                                    | Kapsam dışı (kullanıcı kararı; P28 kapsam dışı 8)       |
| 3   | Yankı giderme (macOS VoiceProcessingIO); mikrofon/hoparlör aygıt seçimi                                                   | Sonra (Windows'ta da yok, A-PD-2)                       |
| 4   | Apple'ın sistem pencere seçicisi `SCContentSharingPicker`                                                                 | Kapsam dışı (tek ekran: Windows'la aynı kendi listemiz) |
| 5   | Pencere modunda uygulamanın **menü çubuğunun** paylaşılması; birden fazla pencere ya da "bir uygulamanın tüm pencereleri" | Sonra (S-P33-4)                                         |
| 6   | Linux istemcisinde pencere paylaşımı                                                                                      | Kapsam dışı (ayrı karar)                                |
| 7   | Developer ID / notarization (TCC kimliğini sabitleyen çözüm)                                                              | Kapsam dışı (kullanıcı kararı 2026-11-20)               |
| 8   | macOS istemcisinde yerinde otomatik güncelleme (bugün "yalnız bildir", K-P29-10)                                          | Kapsam dışı, değişmez                                   |
| 9   | Teknisyen konsolunda Mac tuş eşlemesi anahtarı (A-PF-2)                                                                   | Sonra                                                   |

## 4. Kullanıcı hikâyeleri

- US-P33-1: Teknisyen olarak Mac kullanan müşteriyle de telefon açmadan, Windows'taki gibi konsoldan sesli konuşmak istiyorum ki
  destek tek kanaldan yürüsün.
- US-P33-2: Mac kullanan müşteri olarak sesli görüşmeyi kabul etmeden mikrofonumun açılmamasını, istediğim an sessize alıp
  bitirebilmeyi istiyorum ki ne zaman dinlendiğimi bileyim.
- US-P33-3: Mac kullanan müşteri olarak yalnız sorunlu programın penceresini paylaşmak istiyorum ki teknisyen e-postalarımı,
  bildirimlerimi ve diğer pencerelerimi görmesin, kontrol de yalnız o pencerede kalsın.
- US-P33-4: Mac kullanan müşteri olarak yeni sürümü indirdiğimde macOS izinleri yeniden isterse ne yapacağımı ekranda ve kılavuzda
  görmek istiyorum ki takılıp telefonla destek istemeyeyim.

## 5. Kabul kriterleri

Test seviyeleri parantez içinde. "Elle" testler test-operatoru tarafından gerçek Mac'te (Apple Silicon, macOS 14 veya 15 ve
geliştirme makinesi macOS 26) yapılır ve `docs/test-raporu.md`'ye yazılır. "Windows ile aynı" ifadesi, ilgili Windows AC'sinin metni
Mac karşılığıyla aynen geçer demektir; farklar AC'de açıkça yazılıdır.

### 5.1 Sesli görüşme (P28d'nin macOS karşılığı)

- **AC-534** — Yetenek ve düğme: 0.26.0 macOS istemcisi katılımlı oturumda `/ws/guest` alt protokolüne `rs.cap.voice1` ekler; konsolda
  "Sesli görüşme" düğmesi etkin olur ve AC-373 akışı (müşteriye "<ad> sesli görüşme istiyor — Kabul / Reddet", 60 sn yanıtsız = ret,
  "Yankı olmaması için kulaklık kullanmanız önerilir." satırı) Windows ile aynı metin ve sürelerle çalışır. (Go birim: alt protokol
  listesi; web e2e: sahte Mac misafiri ile düğme etkin; elle)
- **AC-535** — Kabul ve mikrofon: Müşteri "Kabul"e tıklayınca, Mikrofon izni hiç sorulmamışsa macOS izin istemi açılır; izin verilince
  mikrofon açılır. İki tarafta "Mikrofon açık" göstergesi, "Sessize al" ve "Görüşmeyi bitir" bulunur; "Sessize al"da gösterge
  "Sessizde" olur (V-PD-4). Bitirildiğinde veya oturum bittiğinde mikrofon ≤ 1 sn içinde kapanır: macOS menü çubuğundaki turuncu
  mikrofon göstergesi ≤ 1 sn içinde söner. (elle, kronometre/ekran kaydı ile 5 tekrar)
- **AC-536** — Mikrofon izni yok / aygıt yok: İzin reddedilmiş, Sistem Ayarları'ndan kapatılmış ya da giriş aygıtı yoksa davranış
  Windows ile aynıdır (V-PD-1): müşteri penceresinde yolu tarif eden metin ("Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon →
  Nokta Destek açık olmalı") ve "Sistem Ayarları'nı aç" düğmesi (`...?Privacy_Microphone`) gösterilir, görüşme
  `voice.end{reason:"device"}` ile biter, teknisyen konsolunda Windows'taki "device" bitiş metni görünür. Oturum (görüntü, kontrol,
  sohbet) etkilenmez. (Go birim: sahte aygıt hatası → `voice.end device`; elle: izin reddi; Sistem Ayarları'ndan kapatma ya da `tccutil reset Microphone`)
- **AC-537** — Yalnız gerçek tıklama mikrofonu açar: Ses "Kabul", "Sessize al"/"Sesi aç" ve izin rehberindeki düğmeler `localClick()`
  korumalıdır (mimari-p28f §5.2a). Teknisyenin uzaktan kontrolü açıkken teknisyenden gelen fare/klavye olayı, klavye ile etkinleştirme
  (Enter/Space), VoiceOver/AXPress ve HID kaynaklı sentetik tıklama bu düğmeleri tetiklemez: K4 sahte kaynak senaryolarında **%100 ret**,
  gerçek fare tıklaması kabul. `voice.state`, `voice.request`, DC mesajı ya da SDP mikrofonu hiçbir durumda açmaz, yalnız kapatabilir.
  (Go birim: karar mantığı; elle: K4 senaryoları ses düğmeleriyle)
- **AC-538** — Ses kalitesi ve bütçe: RTT < 150 ms ağda müşteri → konsol ve konsol → müşteri ağızdan kulağa gecikme p95 < 400 ms
  (AC-376 yöntemiyle). Opus kodlama + çözme Apple Silicon yerli dilimde ve x86_64 dilimde (Rosetta) 20 ms çerçeve başına p95 ≤ 10 ms.
  30 dk kesintisiz görüşmede çalma tamponu boşalması (duyulan kesinti) 0; ses açıkken görüntü AC-41 (≥ 15 FPS) korunur ve istemci süreç
  CPU'su sessiz duruma göre en çok 10 puan artar. Kalite panelinde ses paket kaybı Mac müşterisinde de görünür.
  (darwin bench iki dilim; elle ölçüm, sonuç test raporunda)
- **AC-539** — Çoklu teknisyen: AC-378 Mac'te aynen geçer: katılımcılar kendi "Görüşmeye katıl" düğmesiyle konuşur, müşteri kabulü görüşme
  başına bir kezdir, `sessions.voice` yetkili izleyici yalnız dinler (sunucu reddeder); Mac ses çubuğunda "Dinleyen: <adlar>" satırı
  vardır ve dinleyen eklenince belirgin bildirim çıkar (V-PD-3). (elle, 1 sahip + 1 katılımcı + 1 izleyici)
- **AC-540** — Ses saklanmaz: Ses hiçbir yerde kaydedilmez; P28e oturum kaydı açıkken Mac oturumunun kayıt dosyasında ses izi 0'dır
  (AC-375 testi Mac misafiriyle); istemci ses verisini diske yazmaz (AC-394 iz testi ses görüşmesi yapılmış oturumda geçer).
  (otomatik kayıt testi + iz testi)
- **AC-541** — Yetenek kapısı tek yerde: Sunucu ve web sesi işletim sistemine göre değil yalnız yetenekle açar (bugünkü `hasVoice` /
  `guestVoice`). 0.25.x ve öncesi Mac istemcide düğme pasif kalır ve mevcut AC-352 metnini gösterir; 0.26.0 Mac'te etkin olur. Bu iki
  durum ve Windows/tarayıcı/Linux davranışı değişmediği otomatik testle kanıtlanır; sunucuya ya da web'e işletim sistemi bazlı yeni
  ses kuralı eklenmez. (sunucu birim + web e2e)

### 5.2 Yalnız bir pencereyi paylaşma (AC-248'in macOS karşılığı)

- **AC-542** — Seçim ekranı: Paylaşım başlarken, tek monitörde de, "Teknisyenle neyi paylaşmak istiyorsunuz?" penceresi açılır;
  "Tüm ekran" seçili gelir (birden fazla monitörde monitör listesi bugünkü gibi bu ekrandadır), "Yalnız bir pencere" seçilince pencere
  listesi etkinleşir; "Listeyi yenile" ve "Paylaş" vardır. Listenin altında S-P17-8 uyarısının Mac metni kalın yazılır (paylaşılan
  pencereden açılan programların paylaşım dışında açılacağı). Seçim ekranının tüm denetimleri `localClick()` korumalıdır. Klavye ile
  gezinilebilir, VoiceOver etiketleri vardır, açık/koyu temada metin kontrastı ≥ 4.5:1. (elle + Go birim: seçim mantığı)
- **AC-543** — Liste içeriği: Listede geçerli masaüstündeki (Space) normal uygulama pencereleri başlık ve uygulama adıyla görünür; Dock'a
  küçültülmüş pencerelerin yanında "(simge durumunda)" yazar. Nokta Destek'in kendi pencereleri, masaüstü, Dock, menü çubuğu, sistem
  arayüzü (Bildirim Merkezi, Kontrol Merkezi) ve başlıksız/yardımcı pencereler listede yoktur. Pencere başlıkları ve liste
  sunucuya, audit'e ya da loga **gönderilmez/yazılmaz** (yalnız istemci ekranında). Liste boşsa "Paylaşılabilecek pencere yok —
  programı açıp Listeyi yenile'ye tıklayın" yazar ve "Paylaş" pasiftir. (Go birim: süzgeç; elle; ağ dökümünde başlık yok)
- **AC-544** — Yalnız pencere içeriği: Pencere modunda teknisyene yalnız seçilen pencerenin içeriği gider; üstüne gelen başka pencere,
  masaüstü, menü çubuğu, Dock ve bildirim afişleri karede görünmez (elle: üstüne Notlar penceresi ve bildirim getirilerek ekran
  görüntüsü karşılaştırması). Pencere taşınınca, boyutu değişince ya da başka monitöre sürüklenince görüntü ≤ 2 sn içinde yeni boyuta
  uyar ve kontrol doğru noktaya düşer (Retina 2x dahil, ±2 px). (elle)
- **AC-545** — Görünmez pencere: Paylaşılan pencere Dock'a küçültülünce, uygulaması gizlenince (⌘H) ya da pencere başka bir masaüstüne
  (Space) / tam ekrana taşınıp görünmez olunca teknisyen siyah kare ve "Pencere simge durumunda" yazısını görür ve bu sürede teknisyenin
  bütün fare/klavye olayları düşer; pencere geri gelince görüntü ve kontrol ≤ 2 sn içinde kendiliğinden döner. (Go birim: durum →
  girdi düşer; elle: dört durum)
- **AC-546** — Pencere kapanırsa: Paylaşılan pencere veya uygulaması kapanınca paylaşım durur, `share.state{stopped, reason:"WINDOW_CLOSED"}`
  ≤ 2 sn içinde gider, konsolda Türkçe neden görünür; istemci **tüm ekrana kendiliğinden geçmez**. Devam için oturum yeniden başlatılır
  (Windows ile aynı). (Go birim + elle)
- **AC-547** — Fare kapsamı: Pencere modunda teknisyenin fare olayı yalnız hedef noktadaki en üst pencere paylaşılan pencere ya da aynı
  süreçteki ona bağlı sayfa/panel/açılır menü ise iletilir; aksi halde (başka bir pencere üstteyse, nokta pencere dışındaysa) olay
  **düşer** ve koordinat pencere dikdörtgenine kırpılır. Basılı tuş/düğmenin bırakılması kapsam dışında da gönderilir (I4 m.1).
  (Go birim, sahte pencere sorgusu: örtüşen pencere → düşer; elle: üstüne Notlar getirilip tıklama)
- **AC-548** — Klavye kapsamı: Teknisyenin tuş olayı yalnız paylaşılan pencerenin uygulaması önde ve odak paylaşılan pencerede (ya da
  aynı süreçteki bağlı sayfa/panelde) iken gönderilir; müşteri başka uygulamaya geçtiyse olay düşer, kuyruklanmaz, sonradan yazılmaz.
  (Go birim: odak başka uygulamada → 0 olay; elle)
- **AC-549** — Sistem kısayolları: Pencere modunda (Ctrl→⌘ eşlemesinden **sonraki** Mac tuşlarıyla değerlendirilerek) şu kısayollar
  iletilmez: ⌘Tab ve ⌘\` (uygulama/pencere değiştirme), ⌘Space ve ⌥⌘Space (Spotlight/Finder arama), ⌥⌘Esc (Zorla Çık), ⌃⌘Q (ekranı kilitle),
  ⌘⇧3/4/5 (ekran görüntüsü), ⌃↑/⌃↓/⌃←/⌃→ (Görev Kontrolü/Space), Fn/Globe tuşu, ⌘H ve ⌥⌘H (gizle), ⌘M (küçült). ⌘C, ⌘V, normal yazı ve
  ⌘W/⌘Q (paylaşılan programı kapatır; Windows'ta Alt+F4 karşılığı) çalışır. Yapışkan Tuşlar veya Fare Tuşları açıksa kısayol
  üretebilecek tek başına değiştirici tuşlar ve sayısal tuş takımı pencere modunda düşer (S-P17-7 karşılığı). (Go birim: tablo
  testi, her kısayol için; elle örneklem)
- **AC-550** — Pencere modunda yok olanlar: Ekrana çizim (işaretleme) katmanı gösterilmez, monitör listesi gönderilmez, `monitor.request`
  yok sayılır (Windows I4 m.4). Oturum kaydı (P28e) rızalıysa kayıt da yalnız paylaşılan pencere görüntüsünü içerir. (Go birim +
  web birim: konsolda monitör seçici görünmez)
- **AC-551** — Gösterge: Pencere modunda gizlenemeyen gösterge "Paylaştığınız pencere izleniyor — <teknisyen adı>" yazar; mimari-p28f
  §5.2b kuralları (⌘H/⌘⌥H/⌘M, Görev Kontrolü, ekran değişimi, 3 sn görünür kılınamazsa kontrol kapısı kapanır) pencere modunda da
  aynen geçer. (elle, K4 gösterge senaryoları pencere modunda)

### 5.3 Teknisyen konsolu ve sözleşme

- **AC-552** — Konsol rozeti: Mac müşterisi pencere modunda paylaşırken konsolda Windows'takiyle aynı "Pencere paylaşımı" rozeti ve
  "Müşteri yalnız bir pencereyi paylaşıyor (…)" ipucu görünür, monitör seçici gizlenir; ipucu ve hata nedenlerinde Windows'a özgü metin
  ("WGC", "Bu Windows sürümü …") **çıkmaz**, Mac için anlamlı etiket görünür. Mac'e özgü yeni neden kodları (varsa) `SHARE_FAIL_REASON_LABELS`'ta
  Türkçe etiketlidir; etiketsiz kod konsolda görünmez kalmaz (mevcut "Bilinmeyen neden (KOD)" kuralı). Mekanizma (mevcut `WGC` değerinin
  yeniden kullanımı ya da yeni `SHARE_METHODS` değeri) mimarın kararıdır (S-P33-2). (web birim + e2e: sahte Mac misafiri)
- **AC-553** — Geriye uyum ve yayın sırası: 0.26.0 sunucu 0.25.x Mac/Windows/Linux istemcilerle aynen çalışır; 0.26.0 Mac istemcinin
  pencere modu mesajı 0.26.0 sunucuda reddedilmez (sözleşme değişirse sunucu `strictObject` doğrulaması güncellenir). Sözleşme değişirse
  runbook'ta sıra yazılıdır: önce sunucu/web prod'a, sonra istemci Release; eski sunucuya bağlanan 0.26.0 Mac istemcide paylaşım
  durmaz (eski sunucu `strictObject` yüzünden mesajı düşürür; konsol etkisi mimari-p33'te belirlenir, sıra bozulursa istemci Release'i bekletilir). (sunucu birim: eski/yeni mesaj; runbook maddesi)

### 5.4 Paketleme ve izinler (ad-hoc)

- **AC-554** — Paket: `Info.plist`'te `NSMicrophoneUsageDescription` Türkçe ("Teknisyenle sesli görüşme için. Mikrofon yalnız siz
  Kabul'e tıkladığınızda açılır.") bulunur. Entitlement listesi ADR-0037 revizyonunda onaylanan kümeyle **tam eşleşir** (beklenen en az
  `com.apple.security.device.audio-input`; başka entitlement yalnız S-P33-1 kararıyla); CI tam eşleşme denetimi ve `Info.plist` izin
  listesi denetimi (S-P28f-4, S-P28f-14) yeni kümeyle yeşildir; hardened runtime (`--options runtime`) korunur. Paket ≤ 60 MB (AC-389).
  (CI)
- **AC-555** — Güncellemede izinler: Ad-hoc imzada her yeni sürüm yeni kimliktir; 0.25.1 → 0.26.0 ve 0.26.0 → 0.26.x (staging) geçişinde
  Ekran Kaydı, Erişilebilirlik ve Mikrofon izinlerinin düşüp düşmediği, Sistem Ayarları listesinde eski "Nokta Destek" kaydının nasıl
  göründüğü ve "−" ile kaldırmanın her üç bölmede mümkün olup olmadığı gerçek Mac'te (macOS 14 veya 15 + 26) elle ölçülür ve test
  raporuna yazılır. Ölçülen davranışa göre: Ekran Kaydı/Erişilebilirlik rehberleri (K-P28f-r4-8) aynen; Mikrofon için AC-536 metnine
  yalnız **doğrulanmış** ek adım eklenir. Yeni sürümde ilk açılışta izin rehberi oturum kodunu koruyarak (AC-391) en çok bir yeniden
  başlatmayla oturuma girer. (elle)
- **AC-556** — İz: AC-394 iz testi ses ve pencere modu kullanılmış oturumda da geçer; `~/Library` altında istemciye ait dosya kalmaz,
  tek istisna sistemin tuttuğu TCC kayıtlarıdır (artık Mikrofon dahil). Kılavuzda kaldırma komutu
  `tccutil reset Microphone net.noktabilisim.destek` yazılıdır. (CI `trace-check-mac.sh` + elle)

### 5.5 Sürüm ve doküman

- **AC-557** — Dokümantasyon: Kılavuz "Hangi programda ne var?" tablosunda macOS "Sesli görüşme" ve "Yalnız bir pencereyi paylaşma"
  satırları "Var (0.26 ve sonrası)" olur; "yalnız Mac uygulamasında yoktur" cümlesi kaldırılır; Mac bölümüne ses (Mikrofon izni,
  kulaklık önerisi), pencere modu (Mac kısayol listesi, menü çubuğunun görünmediği — R-P33-3) ve "her yeni sürümde izinler yeniden
  istenebilir" anlatımı eklenir. README, DATASHEET (yalnız yayımlanan), CHANGELOG 0.26.0 güncellenir, PDF'ler yeniden üretilir.
  `gereksinimler-p28.md` AC-393 ses kısmına ve `mimari-p28f.md` §1 kapsam dışı "Pencere paylaşımı" ile A-PF-1 satırlarına
  "P33 ile değişti" notu düşülür; `gereksinimler.md` "Sonra — sonraki sürüm" satırı P33 kapanışında "P33'te yapıldı" olarak işaretlenir.
  (qa, AC-288)
- **AC-558** — Sürüm ve regresyon: Etiket `v0.26.0`; Windows ve Linux istemcide davranış değişmez (mevcut Go, sunucu, web birim ve e2e
  testleri yeşil; Windows AC-248/P28d e2e'leri değişmeden geçer). Prod'a çıkıştan önce staging'de Mac D-listesi (ses: 534–540,
  pencere: 542–551, izin: 555) test-operatoru tarafından tamamlanır; qa GEÇTİ + güvenlik Kritik/Yüksek 0 (CLAUDE.md paket kuralı).
  (CI + test raporu)

## 6. Fonksiyonel olmayan gereksinimler

- **Güvenlik:** Mikrofon yalnız müşterinin gerçek tıklamasıyla açılır (AC-537); entitlement eklemesi tehdit modelinde değerlendirilir
  (özellikle `allow-unsigned-executable-memory` seçilirse JIT yüzeyi — R-P33-1); pencere modu girdi kapsamı fail-closed (şüphede olay
  düşer). Yeni ağ ucu, yeni WS mesajı (sözleşme değeri hariç), yeni tablo yok.
- **Performans:** AC-538 bütçeleri; pencere modunda yakalama kare hızı tüm ekran moduna göre düşmez (≥ 25 fps teslim, K0s-1 ölçütü).
- **Erişilebilirlik:** Yeni Mac ekranları (seçim ekranı, ses çubuğu, Mikrofon rehberi) Tab ile gezilir, VoiceOver etiketli; `localClick`
  korumalı düğmelerin fareyle kullanılması kabul edilmiş ödündür (mimari-p28f §5.2a), kılavuzda yazılır.
- **Tema / yerelleştirme:** AppKit semantik renkleri (açık/koyu kendiliğinden); tüm metinler Türkçe, Go ileti tablosunda tek yerde.
- **Gizlilik / KVKK:** Ses kaydedilmez; pencere başlıkları cihazdan çıkmaz; aydınlatma metninde ses paragrafı (P28d) Mac için de geçerlidir.
- **Lisans:** Yeni bağımlılık (ör. libopus — BSD) gerekiyorsa mimari §10.4 dışında gerekçelenir; AGPL/GPL yasak; `third_party_notices.txt` güncellenir.

## 7. Varsayımlar

- **V-P33-1** "Ses" = P28d konuşma (mikrofon ↔ hoparlör). Bilgisayarın kendi sesinin aktarımı istenmedi (kapsam dışı 1).
- **V-P33-2** Web ve sunucu ses tarafında değişiklik gerekmez: kod incelemesi (2026-11-22) sesin yalnız yetenekle (`hasVoice`:
  BROWSER ya da `rs.cap.voice1`; web `guestVoice`) açıldığını, işletim sistemine göre gizleme olmadığını gösterdi. Mac'te düğme bugün
  istemci yeteneği bildirmediği için pasiftir; 0.26.0 bildirince kendiliğinden etkinleşir.
- **V-P33-3** Mikrofon yoksa/izin yoksa davranış **Windows ile aynıdır** (görüşme `device` nedeniyle biter, V-PD-1). mimari-p28f §5.3 m.4'teki
  "dinleme devam eder" taslağı P33 ile değişir (tek kural, sadelik). Kullanıcı itiraz ederse S-P33-5.
- **V-P33-4** Pencere seçimi Windows'taki gibi **kendi listemizle** yapılır (ScreenCaptureKit içerik listesi); Apple'ın sistem seçicisi kullanılmaz.
- **V-P33-5** Konsolda pencere modu için yeni bir yöntem değeri (ör. `"SCK"`) ve nötr etiket varsayılır; mimar `WGC`'yi yeniden kullanmayı
  seçerse yalnız etiketlerin platform-nötr yapılması yeterlidir (AC-552 gözlenen davranışı değişmez).
- **V-P33-6** Pencere modu yalnız tek pencereyi kapsar; aynı uygulamanın açtığı yeni pencere paylaşılmaz (Windows ile aynı).
- **V-P33-7** Sunucu, web ve istemciler aynı etiketle (0.26.0) çıkar; sunucu prod'a istemci Release'inden önce alınır.
- **V-P33-8** macOS güncellemesi "yalnız bildir" kalır; müşteri yeni zip'i indirir, Gatekeeper "Yine de Aç" ve TCC izinleri yeniden istenir.
- **V-P33-9** Yeni yetki, ayar, audit eylemi, tablo, migration yok. Ses audit'i mevcut `voice.*`; join audit'inde `os` zaten var.
- **V-P33-10** Mac'te gözetimsiz oturum olmadığından P28d'nin gözetimsiz ses kapısı konu dışıdır.
- **V-P33-11** macOS 13+ desteği değişmez (ScreenCaptureKit pencere yakalama 12.3+'ta mevcut); gerçek Intel Mac yok, x86_64 Rosetta ile ölçülür (A-PF-3).
- **V-P33-12** Yankı giderme yok; Windows'taki "kulaklık önerilir" satırı yeterli kabul edilir (Mac dahili hoparlör+mikrofonda yankı riski R-P33-9).

## 8. Riskler ve açık sorular

| #        | Risk                                                                                                                                                                                                                                                          | Etki        | Önlem                                                                                                           | Sahibi                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| R-P33-1  | Ses kodek yolu (A-PF-1): (a′) wazero derleyici için `allow-unsigned-executable-memory` saldırı yüzeyini büyütür ve kodlayıcı karmaşıklığı 0/1'de kalite Windows'tan düşük; (cgo) `CGO_ENABLED=0` ve Linux'ta tekrarlanabilir darwin derlemesini (K0s-7) bozar | Yüksek      | S-P33-1: mimar + güvenlik tasarım turu, ADR-0037 revizyonu; gerekiyorsa kullanıcı risk kabulü; AC-538 ölçütleri | mimar + guvenlik                |
| R-P33-2  | Ad-hoc imzada her sürümde TCC kimliği değişir; Ekran Kaydı, Erişilebilirlik ve **Mikrofon** izni güncellemede düşer, eski kayıt listede "açık" görünüp çalışmaz → müşteri kafa karışıklığı, destek süresi uzar                                                | Orta–Yüksek | AC-555 elle ölçüm, rehber metinleri, kılavuz (AC-556/557); kalıcı çözüm Developer ID (kapsam dışı 7)            | backend-dev (Go) + teknik-yazar |
| R-P33-3  | macOS'ta uygulama menüleri pencerede değil menü çubuğundadır; pencere modunda teknisyen menüleri göremez/kullanamaz (Windows'tan fark)                                                                                                                        | Orta        | Kılavuzda yazılır; teknisyen klavye kısayolu kullanır veya müşteri menüyü açar; S-P33-4                         | teknik-yazar                    |
| R-P33-4  | Kaydet/Aç sayfaları ve paneller macOS'ta ayrı pencere olabilir; görüntüye girmeyebilir ya da girdi düşebilir                                                                                                                                                  | Orta        | AC-547/548 "bağlı sayfa/panel" kuralı; elle test listesinde Kaydet sayfası                                      | backend-dev (Go)                |
| R-P33-5  | Pencere modunda sistem kısayolu listesi eksik kalır (yeni macOS sürümleri yeni kısayol ekler)                                                                                                                                                                 | Orta        | AC-549 tablo testi; fail-closed değiştirici kuralı; güvenlik turu listeyi gözden geçirir                        | guvenlik                        |
| R-P33-6  | macOS 15+ periyodik "ekranınızı kaydediyor" uyarısı ve bölme adı değişimi ("Ekran ve Sistem Sesi Kaydı") rehber metinlerini eskitir                                                                                                                           | Düşük       | Metinler gerçek cihazda karşılaştırılır (r4 kuralı)                                                             | teknik-yazar                    |
| R-P33-7  | Intel Mac'te ses bütçesi yalnız Rosetta ile ölçülür                                                                                                                                                                                                           | Düşük–Orta  | AC-538 x86_64 dilim ölçümü; ilk Intel geri bildirimi runbook'ta izlenir                                         | test-operatoru                  |
| R-P33-8  | `share.state` sözleşme değişikliğinde sunucu/istemci yayın sırası bozulursa konsol rozeti görünmez                                                                                                                                                            | Düşük       | AC-553, runbook sırası                                                                                          | devops                          |
| R-P33-9  | Mac dahili hoparlör + mikrofonda yankı                                                                                                                                                                                                                        | Orta        | Kulaklık önerisi (V-P33-12); şikâyet gelirse VoiceProcessingIO (Sonra)                                          | mimar                           |
| R-P33-10 | Mikrofon bölmesinde eski kaydı "−" ile kaldırma olmayabilir (doğrulanmadı)                                                                                                                                                                                    | Düşük       | AC-555 elle ölçüm; doğrulanmayan adım rehbere yazılmaz; `tccutil reset Microphone` kılavuzda                    | test-operatoru + teknik-yazar   |

### Açık sorular (şimdilik varsayımla ilerlenir)

| #       | Soru                                                                                                                                                                                                     | Varsayılan                                                                                        | Sahibi                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------ |
| S-P33-1 | macOS Opus kodek yolu hangisi: (a′) wazero derleyici + JIT entitlement, (cgo) libopus, ya da macOS AudioToolbox'ın yerleşik Opus kodlayıcısı (purego ile; varlığı ve macOS 13 desteği **doğrulanmadı**)? | Mimar spike ile ölçer, güvenlik onaylar; JIT entitlement gerekiyorsa kullanıcı risk kabulü alınır | mimar + guvenlik (+ kullanıcı) |
| S-P33-2 | Konsolda pencere modu: `WGC` değeri yeniden mi kullanılsın, yeni `SHARE_METHODS` değeri mi?                                                                                                              | Yeni değer + nötr etiket (V-P33-5)                                                                | mimar                          |
| S-P33-3 | Başka masaüstündeki (Space) ve tam ekran pencereler listede olsun mu?                                                                                                                                    | Hayır (Windows ile aynı); kılavuz "tam ekrandan çıkın" der                                        | mimar                          |
| S-P33-4 | Pencere modunda uygulamanın menü çubuğu da paylaşılsın mı?                                                                                                                                               | Hayır, Sonra (R-P33-3)                                                                            | kullanıcı                      |
| S-P33-5 | Mikrofon izni yokken görüşme bitsin mi (Windows) yoksa müşteri yalnız dinlesin mi (p28f taslağı)?                                                                                                        | Bitsin — Windows ile aynı (V-P33-3)                                                               | kullanıcı                      |
| S-P33-6 | Paylaşılan pencere kapanınca tüm ekrana geçme önerisi sunulsun mu?                                                                                                                                       | Hayır, Windows ile aynı (AC-546)                                                                  | kullanıcı                      |

## 9. Kontrol listesi kararları (`~/.claude/checklists/tasarim-kontrol-listesi.md` 1, 5, 8, 9)

| Bölüm / madde                      | Karar       | Gerekçe                                                                                                     |
| ---------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| 1 Kimlik doğrulama, şifre, oturum  | Kapsam dışı | Değişmez; misafir akışı ve teknisyen girişi aynı                                                            |
| 1 Yetkilendirme (rol/kaynak), IDOR | Kapsamda    | Mevcut `sessions.voice` ve P28c rol kuralları; sunucu kapısı değişmez (AC-539, AC-541)                      |
| 1 Servis hesabı / API anahtarı     | Kapsam dışı | Yeni anahtar yok                                                                                            |
| 1 Hesap silme / davet              | Kapsam dışı | Konu dışı                                                                                                   |
| 5 Beş durum                        | Kapsamda    | Pencere listesi boş (AC-543), mikrofon hatası (AC-536), pencere kapalı/simge (AC-545/546), başarı           |
| 5 Yıkıcı işlem onayı               | Kapsamda    | Ses kabulü onay diyaloğu (AC-534/537); "Görüşmeyi bitir" güvenli yönde, onaysız                             |
| 5 Erişilebilirlik                  | Kapsamda    | AC-542, §6; `localClick` ödünü kılavuzda                                                                    |
| 5 Yerelleştirme                    | Kapsamda    | Türkçe, tek ileti tablosu                                                                                   |
| 5 Bildirim stratejisi              | Kapsamda    | Dinleyen duyurusu (AC-539), konsol rozeti (AC-552); yeni e-posta/push yok                                   |
| 5 Tema / tasarım token'ları        | Kapsamda    | AppKit semantik renkler; web tarafında mevcut token'lar                                                     |
| 5 Responsive / mobil               | Kapsam dışı | Masaüstü istemci; mobil Sonra (AC-278)                                                                      |
| 8 KVKK: rıza, aydınlatma, saklama  | Kapsamda    | Ses kabulü = görüşme başına rıza; ses saklanmaz (AC-540); pencere başlıkları cihazdan çıkmaz (AC-543)       |
| 8 Lisans uyumu                     | Kapsamda    | Yeni bağımlılık varsa BSD/Apache; AGPL/GPL yasak (§6)                                                       |
| 8 Finansal veri                    | Kapsam dışı | Yok                                                                                                         |
| 9 Kapsam dışı listesi              | Kapsamda    | §3.2, 9 madde                                                                                               |
| 9 Ölçülebilir AC                   | Kapsamda    | AC-534..AC-558                                                                                              |
| 9 Risk, varsayım, açık soru        | Kapsamda    | §7, §8                                                                                                      |
| 9 DoD                              | Kapsamda    | AC-558 (qa GEÇTİ + güvenlik K/Y 0 + staging D-listesi)                                                      |
| 9 Doküman planı                    | Kapsamda    | AC-557                                                                                                      |
| Sonra (unutulmasın)                | Sonra       | Yankı giderme, aygıt seçimi, menü çubuğu paylaşımı, Mac tuş eşlemesi, Linux pencere paylaşımı, Developer ID |

## Ek — Orkestratör notları (2026-11-22)

- AC-554/AC-557: `OKUBENI*.txt` (ör. `OKUBENI-adhoc.txt`) izin adımlarına ve web `MacGuide` metinlerine (`tr.json` `gm.*`) **Mikrofon** eklenir.
- S-P33-4/5/6: gereksinimdeki varsayılanlar geçerli (menü çubuğu paylaşılmaz; mikrofon izni yoksa görüşme `device` ile biter — Windows gibi; pencere kapanınca tüm ekran önerisi yok) — kullanıcının "sormadan ilerle" talimatı, itiraz ederse değişir.
- Mevcut parçalar (çift iş yok): ortak `ui/voice.go`; `flow` içindeki `WindowCapture`/`CaptureWindow`/`SetInputWindow` bağımlılıkları; `ui/mac/prompt_darwin.go` ortak onay diyaloğu; `macperm` mikrofon yoklaması; K0s-6 AudioQueue ölçümü (GEÇTİ); web pencere rozeti ve `guestVoice` kapısı yeniden kullanılır.
- D-P33-1 (AC-543 sapması) kabul: K0s-W2 izinsiz bir "küçültülmüş" işareti bulamadı (KALDI). Küçültülmüş pencereler listede görünmez; kullanıcı pencereyi geri açıp listeyi yeniler. AC-543 bu sapmayla geçerli sayılır (orkestratör, "sormadan ilerle"; kılavuzda belirtilir).
