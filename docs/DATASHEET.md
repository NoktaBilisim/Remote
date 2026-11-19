# Remote Support — Nokta Bilişim Uzaktan Destek Platformu

> Kendi sunucunuzda çalışan, çok firmalı uzaktan destek: teknisyen müşterinin ekranını görür, izinle kontrol eder;
> onaylar ve işlemler kayıt altında kalır.

## Ne işe yarar

Uzaktan destek çoğu zaman dışarıdaki bir hizmete bağlıdır; veriler ve kayıtlar başka yerde tutulur. Remote Support
kurumun kendi sunucusunda çalışır. Teknisyen web konsolundan oturum açar; müşteri tek dosyalık Windows programıyla, Mac
uygulamasıyla, Ubuntu Linux programıyla veya tarayıcıyla katılır ya da programdan kendisi destek ister. Görüntü iki taraf arasında doğrudan akar; sunucuda
oturum bilgisi, KVKK onayları ve denetim kayıtları kalır. Firma isterse dosyaları sunucu üzerinden virüs taramasıyla
aktarır; bu durumda teslim edilen dosyalar da seçilen süre (1–7 gün) boyunca sunucuda şifreli saklanır.

## Öne çıkan özellikler

- **Kurulumsuz müşteri programı** — tek dosya, yönetici yetkisi istemez; kod ile bağlanan bilgisayarda iz bırakmaz.
- **Müşteri başlatmalı destek** — müşteri programdan "Destek iste" der; talep canlı kuyruğa düşer, teknisyen tek
  tıkla kabul eder; beklerken teknisyenle yazışır. Bir kez destek alan bilgisayar firmayı hatırlar (en çok 5 firma),
  yeni link gerekmez; isterse program tepside durur, Windows açılışında başlar. İstenmeyen talep gönderen IP, ağ veya
  bilgisayar süreli ya da süresiz engellenir.
- **Program indirmeden destek talebi** — müşteri firmanın web formu bağlantısından tarayıcıyla talep açar, beklerken
  teknisyenle yazışır, kabulde ekranını paylaşır. İsterse talebinin kabul/ret/süre dolumu bilgisini SMS, WhatsApp veya
  e-postayla alır (yalnız hizmet bildirimi; reklam yok). İstenmeyen talep yağarsa form tek tuşla kapanır.
- **Gözetimsiz erişim** — sunucu ve kiosk gibi başında kimse olmayan müşteri bilgisayarlarına, kayıtlı servis
  programı üzerinden bağlanma; giriş ekranı, kilit ekranı ve yönetici onayı (UAC) penceresi dahil. Her bağlantı ayrı
  2FA doğrulaması ister ve müşteriye e-postayla bildirilir; cihazda kapatılamayan "Uzaktan bağlantı" göstergesi çıkar,
  müşteri tek tıkla kapatabilir. Bağlantı cihaz kullanıcısına sorulmadan açılır ve teknisyen ekranı görüp kontrolü hemen
  alır; sunucu ve personel bilgisayarlarına destek ve müdahale için tek, basit yol. Gizli izleme yoktur: gösterge her
  bağlantıda görünür. Teknisyen gerekirse Windows oturumunu kilitler ya da kullanıcı oturumunu kapatır. Kod imzası alındıktan sonra canlı ortamda açılır.
- **Kendini güncelleyen programlar** — gözetimsiz erişim servisi ile Windows ve Linux destek programı yeni sürüme
  kendileri geçer; yalnız bizim imzaladığımız sürüm kurulur, destek oturumu sırasında hiçbir şey değişmez. Servis yeni
  sürümle açılamazsa eski sürüme kendiliğinden döner. Yönetici her cihazın sürümünü ve başarısız güncellemeleri panelde
  görür; isterse firması için otomatik kurulumu kapatıp yalnız bildirim alır. (Mac programı yeni sürümü yalnız haber verir.)
- **İzinli uzaktan kontrol (müşteri onaylı oturum)** — her kontrol isteğini müşteri onaylar, tek tuşla geri alır; uzaktan tıklama izin sayılmaz.
- **Mac desteği** — Mac kullanan müşteri de kurulumsuz Nokta Destek uygulamasıyla bağlanır: teknisyen ekranı görür, izinle
  kontrol eder, yazışır, dosya ve belge gönderir. Uygulama Apple Silicon ve Intel Mac'lerde (macOS 13 ve üstü) çalışır,
  gereken macOS izinlerini adım adım gösterir; onay düğmelerine yalnız Mac'in başındaki kişi basabilir. Apple imzalı ve
  onaylı (notarize) dağıtım, Apple geliştirici hesabı açıldığında canlı ortamda yayımlanır.
- **Linux desteği** — Ubuntu 22.04 / 24.04 (64 bit, standart masaüstü) kullanan müşteri de kurulum ve yönetici şifresi
  gerektirmeyen tek dosyalık programla bağlanır: teknisyen ekranı görür, izinle kontrol eder, dosya ve belge gönderir, sesli
  konuşur. Destek sayfası programı açan tek satırlık komutu kopyalanabilir verir. Ubuntu'nun yeni ekran sisteminde (Wayland)
  ekran paylaşımı Ubuntu'nun kendi izin penceresiyle yapılır ve uzaktan kontrol sınırlıdır: müşteri kontrolü ekranı
  kilitleyerek ya da üst çubuktan durdurarak keser; kurumun tercihine göre bu ortamda yalnız görüntü paylaşılır.
- **Pano paylaşımı ve uzaktan yazdırma** — teknisyen uzun bir komutu veya lisans anahtarını tek tıkla müşterinin panosuna
  koyar, müşterinin panosundaki metni alır; harf harf okutmaya gerek kalmaz. PDF belgeyi müşterinin yazıcısından bastırır.
  İkisi de müşterinin ayrı onayıyla, Windows programı, Mac uygulaması ve Linux programıyla çalışır. Pano metni sunucudan geçmez; yazdırılan belge
  varsayılan modda doğrudan gider, firma sunucu üzerinden dosya aktarımını açtıysa sunucuda virüs taramasından geçer ve
  yazdırıldıktan sonra silinir (saklanmaz).
- **Çoklu teknisyen** — teknisyen zor bir sorunda firmadan bir arkadaşını oturuma çağırır; yetkili yönetici süren bir
  oturumu izleyici olarak izler. Bir oturumda en çok 3 teknisyen bulunur. Müşterinin bilgisayarında iş yapma hakkı (kontrol,
  pano, yazdırma, dosya) tek kişidedir ve başka teknisyene devredilir; yeni kişi kontrol iznini müşteriden yeniden ister.
  Oturum da tümüyle başka teknisyene devredilebilir. Müşteri bağlı tüm teknisyenleri adı ve rolüyle görür, istemediğini
  tek tıkla çıkarır; adı müşteriye gösterilmeyen teknisyen ekranı göremez (gizli izleyici yoktur). Davet, katılım, devir ve
  çıkarma denetim kaydına yazılır.
- **Sesli görüşme** — teknisyen oturum içinden müşteriyle sesli konuşur; ayrı telefon gerekmez. Müşteri kabul etmeden
  mikrofonu açılmaz, görüşmeyi tek tıkla bitirir, kimin konuştuğunu ve dinlediğini adıyla görür. Birden çok teknisyen
  konuşabilir; yetkili yönetici dinler. Tarayıcıda, Windows programında (0.18) ve Linux programında (0.20) çalışır; ses kaydedilmez.
- **Zorlu donanımda da görüntü** — ekran üç farklı yöntemle okunur (HDR ve çift ekran kartlı dizüstüler dahil);
  okunamazsa müşteri ekranında kısa bir neden kodu ve ne yapacağı yazar; yeni sürüm programla neden teknisyen konsoluna
  da gelir.
- **Kayıtlı sohbet** — oturum sohbeti sunucu üzerinden iletilir ve şifreli saklanır; anlaşmazlıkta "ne yazıldı"
  sorusu yanıtlanır. Yetkili kişi oturum geçmişinde sohbeti açar, her açılış denetim kaydına yazılır. Mesajlar oturum
  saklama süresi dolunca silinir. Müşteri bağlanmadan önce sohbetin kaydedildiğini ve kaç gün saklanacağını görür.
- **Sohbet, dosya, ekran üzerine işaretleme** — her dosyayı alıcı onaylar. Geçmişte her dosya "Doğrulanmış" ya da
  "Müşteri bildirimi" olarak ayrılır. Dosyalar firmanın seçtiği iki yoldan biriyle gider:
  - **Doğrudan (varsayılan):** dosya iki taraf arasında uçtan uca şifreli akar; içerik sunucuya uğramaz, taranmaz.
  - **Sunucu üzerinden, virüs taramalı (firma ayarı):** dosya sunucuya şifreli yüklenir, ClamAV ile taranır, yalnız temiz
    çıkan dosya alıcıya teklif edilir. Virüslü ya da taranamayan dosya teslim edilmez. Bu modda aktarım uçtan uca şifreli
    değildir; dosya sunucuda şifreli saklanır. Teslim edilen dosya firmanın seçtiği 1–7 gün saklanır ve oturum
    geçmişinden yeniden indirilebilir; teslim edilmeyen dosya hemen silinir. Taranan, programın dosya gönderme ve uzaktan
    yazdırma özellikleriyle aktarılan dosyalardır; pano metni ve uzaktan kontrol sırasında müşterinin kendi indirdikleri
    kapsam dışıdır.
- **Oturum kaydı (isteğe bağlı)** — firma açarsa müşteri, onay ekranındaki ayrı ve varsayılan işaretsiz kutuyla oturumun
  görüntü kaydına izin verir; işaretlemezse kayıt alınmaz. Kayıt sürerken müşteri ve teknisyen "Kayıt yapılıyor"
  göstergesini görür; müşteri tek tıkla, geri alınamaz biçimde durdurur. Ses kaydedilmez. Kaydı teknisyen tarafındaki
  konsol alır; sunucuda şifreli saklanır, firmanın seçtiği 1–90 gün sonunda kendiliğinden silinir, yedeğe girmez ve
  dosyalarla aynı depolama kotasını kullanır. Yalnız yetkili kişiler panelde izler ve siler; indirme düğmesi ve indirme
  adresi yoktur, her izleme ve izlenen miktar denetim kaydına yazılır. İzlenen ekranın başka bir programla kaydedilmesi
  teknik olarak engellenemez. Gözetimsiz bağlantılar, firma politikası açılırsa (2FA doğrulaması ve diğer yöneticilere
  e-posta ile) kaydedilir; cihazdaki gösterge bunu açıkça yazar ("Kayıt yapılıyor").
- **Müşteri firma yönetimi** — her müşteriye ayrı kalıcı indirme ve web formu bağlantısı; talep ve oturumlar firmaya
  göre süzülür; müşteri listesi Excel uyumlu CSV olarak dışa aktarılır, CSV'den önizlemeli ve hata raporlu içe aktarılır.
- **Müşteri portalı** — müşteri firmanın çalışanları kendi portal hesabıyla girer; firmalarının destek talebi ve oturum
  geçmişini görür, program indirmeden yeni talep açar (firmanın web formu kapalıyken de), firmaya özel destek programını
  indirir. Hesabı yönetici açar; geçici şifre 72 saat geçerlidir, ilk girişte değiştirilir; kullanıcı isterse iki adımlı
  doğrulamayı açar. Portalda yalnız tarih, durum, kod, teknisyen ve süre gibi özet bilgiler görünür; sohbet, notlar ve
  dosyalar gösterilmez.
- **Kullanıcı ve yetki yönetimi** — teknisyen ekleme, modül bazlı aç/kapa yetkileri, pasife alma; değişiklik açık
  oturumlara anında yansır.
- **İki adımlı doğrulama ve e-posta** — yöneticilerde zorunlu, teknisyenlerde firma ayarıyla 2FA; şifremi unuttum,
  tüm cihazlardan çıkış; firmanın kendi SMTP'siyle bildirimler. Kullanıcı isterse kişisel tarayıcısını 30 gün
  hatırlatır; hassas işlemlerde kod yine sorulur.
- **Oturum geçmişi ve CSV** — filtreli liste, onay ve kontrol kayıtları, ticket/not, Excel uyumlu dışa aktarma.
- **Değiştirilemez denetim kaydı** — kim, ne zaman, ne yaptı: filtreli ekran ve CSV; kayıtlar uygulamadan da
  veritabanından da düzenlenemez, silinemez.
- **KVKK uyumlu saklama** — müşteri kişisel verileri firmanın belirlediği süre (90–730 gün) dolunca her gece
  kendiliğinden anonimleştirilir, 30 gün sonra tamamen silinir (sunucu ayarıyla açılır); denetim kaydı 730 gün saklanır.
- **Kalıcı silme (unutulma hakkı)** — ayrılan çalışanı ya da sözleşmesi biten firmayı tüm verisi ve dosyalarıyla
  kalıcı silme; ad yazarak onay, 2FA doğrulaması, firmada 24 saat iptal penceresi. Silinen veri yedeklerden en geç
  14 günde düşer, yedekten geri dönülse bile yeniden silinir.
- **Şifreli ve imzalı günlük yedek** — veritabanı ve yüklenen dosyalar her gece şifreli yedeklenir ve imzalanır, 14 gün
  saklanır; imzası tutmayan yedek geri yüklenmez, geri yükleme önce ayrı bir test veritabanında doğrulanır.
- **Sürekli izleme** — servisler, sertifikalar, yedek ve disk 10 dakikada bir denetlenir; sorun olunca yöneticiye alarm,
  düzelince bildirim gider.
- **Kendi markanızla** — firma logosu giriş ekranında, panelde, müşteri sayfasında ve e-postalarda; her kullanıcı kendi
  profil resmini ve açık/koyu temasını seçer.

## Kimler için

- Kurum içi BT destek ekipleri ve yardım masaları
- Birden çok müşteri firmaya hizmet veren BT hizmet sağlayıcıları
- Destek kayıtlarını KVKK kapsamında kendi sunucusunda tutmak isteyen kurumlar

## Modüller

| Modül                            | Ne yapar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Destek oturumları                | Tek kullanımlık link ve 8 haneli kod (panelden e-posta, WhatsApp veya SMS ile tek mesajda, Windows programı bağlantısıyla gönderilir), bekleme odası, teknisyen kabulü, iptal, zorla sonlandırma; müşteri beklerken panelin her sayfasında sayaç ve bildirim                                                                                                                                                                                                                                                                      |
| Teknisyen konsolu                | Canlı ekran, uzaktan kontrol, monitör değiştirme, sohbet, dosya (doğrudan ya da sunucu üzerinden virüs taramalı; tarama durumu: taranıyor, teslim edildi, virüslü, taranamadı), işaretleme, pano gönder/al, uzaktan yazdırma (PDF), kalite paneli, teknisyen davet etme, kontrolü ve oturumu devretme, etkin oturumları izleme                                                                                                                                                                                                    |
| Hızlı Destek (Windows)           | Müşteri programı: "Destek iste", "Bağlantı kodum var", 5 firmaya kadar kayıt ve firma seçimi, firma/bilgisayar unutma, beklerken sohbet, isteğe bağlı tepsi ve Windows açılışında başlatma, onay ve izin diyalogları, pano paylaşımı izni ve yazdırma onayı, bağlı teknisyenler listesi ve "Çıkar"; yalnız bir pencereyi paylaşma, açık/koyu tema                                                                                                                                                                                 |
| Hızlı Destek (macOS)             | Mac müşteri uygulaması (kod veya bağlantıyla): kurulumsuz, izin rehberi (Ekran Kaydı, Erişilebilirlik), onay diyalogları, uzaktan kontrol, sohbet, dosya, pano ve yazdırma onayı, bağlı teknisyenler listesi ve "Çıkar", gizlenemeyen gösterge, açık/koyu görünüm                                                                                                                                                                                                                                                                 |
| Hızlı Destek (Linux)             | Ubuntu 22.04 / 24.04 müşteri programı (kod veya bağlantıyla): kurulumsuz, kopyalanabilir başlatma komutu, onay diyalogları, uzaktan kontrol (Wayland'de sınırlı), kayıtlı sohbet (0.21), dosya, pano ve yazdırma onayı, sesli görüşme, bağlı teknisyenler listesi ve "Çıkar", gösterge, açık/koyu görünüm                                                                                                                                                                                                                         |
| Destek talepleri                 | Canlı kuyruk, bildirim ve ses, kabul/ret, firma filtresi, son 30 gün geçmişi, kaynak engelleme (Engellenenler ekranı), isteğe bağlı kabul kodu, atama, öncelik ve SLA, mesai saatleri ve tatiller, web talep formu ve "Web" kaynak süzgeci                                                                                                                                                                                                                                                                                        |
| Müşteriler                       | Müşteri firma kaydı, firma başına bağlantı ve web formu bağlantısı (kopyala, yenile, müşteriye gönder), pasife alma, talep ve oturum geçmişi, CSV dışa/içe aktarma                                                                                                                                                                                                                                                                                                                                                                |
| Gözetimsiz cihazlar              | Kayıt kodu ile cihaz ekleme, cihaz listesi (çevrimiçi, yerel olarak kapalı, doğrulanmadı, bildirim gönderilemedi, servis güncel değil rozetleri; cihaz kullanıcısı aktif / kilitli / oturum yok), cihaz başına teknisyen yetkisi, bağlan (cihaz kullanıcısına sorulmadan, kontrol hemen gelir), oturumu kilitle / kapat, cihazı iptal et; müşteri başına bildirim adresleri                                                                                                                                                       |
| Gözetimsiz servis (Windows)      | Müşteri bilgisayarına yöneticiyle kurulan servis: kayıt kodu, onay penceresi olmadan bağlantı, tepside durum, "Gözetimsiz erişimi kapat", her monitörde bağlantı göstergesi, teknisyenin ekrana çizimleri (tıklamayı engellemez), Windows "Uygulamalar"dan iz bırakmadan kaldırma                                                                                                                                                                                                                                                 |
| Oturum geçmişi                   | Filtreli liste ("Kayıtlı" süzgeci dahil), ayrıntı, ticket/not, dosya doğrulama etiketi, sunucuda saklanan dosyaları süre içinde yeniden indirme, oturum kaydını izleme ve silme, CSV                                                                                                                                                                                                                                                                                                                                              |
| Müşteri portalı                  | Müşteri çalışanı için ayrı giriş (firmaya özel adres): talep ve oturum geçmişi, ayrıntı, yeni destek talebi, firma dosyasını indirme, isteğe bağlı 2FA, tema; panelde müşteri başına portal hesapları (oluştur, pasife al, etkinleştir, şifre sıfırla)                                                                                                                                                                                                                                                                            |
| Kullanıcılar                     | Kullanıcı ekleme (tek seferlik geçici şifre), rol, yetki tablosu, pasife alma / yeniden etkinleştirme, kalıcı silme                                                                                                                                                                                                                                                                                                                                                                                                               |
| Firmalar (Süper Yönetici)        | Firma oluşturma, düzenleme (sunucu depolama kotası dahil), pasife alma, firmalar arası geçiş, kalıcı silme (önizleme, 24 saat iptal penceresi, ilerleme)                                                                                                                                                                                                                                                                                                                                                                          |
| Audit log                        | Salt okunur denetim kaydı: tarih, kullanıcı, işlem, sonuç ve firma filtreleri, ayrıntı, CSV                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Sistem ayarları (Süper Yönetici) | MySQL bağlantı bilgisi + bağlantı testi (isteğe bağlı zorunlu TLS ve sertifika doğrulaması), TURN sunucuları ve gizli anahtar, sistem logosu (yükleme/kaldırma), Süper Yönetici şifre sıfırlama, WhatsApp servis adresi + test mesajı, virüs tarama (ClamAV) sunucusu + bağlantı testi                                                                                                                                                                                                                                            |
| Hesabım                          | Profil resmi (kare kırpma), tema (Açık / Koyu / Sistem), 2FA kurulumu, kurtarma kodları ve yenilenmesi, hatırlanan cihazlar, şifre değiştirme/sıfırlama, tüm cihazlardan çıkış                                                                                                                                                                                                                                                                                                                                                    |
| İstemci güncellemeleri           | Ayarlar → İstemciler'de firma başına "İstemcileri otomatik güncelle" (Açık/Kapalı); gözetimsiz cihaz listesinde sürüm sütunu ve durum rozetleri (güncel, bekliyor, güncelleniyor, başarısız, asgari sürümün altında), sürüm dağılımı; denetim kaydında her güncelleme ve reddedilen sürüm                                                                                                                                                                                                                                         |
| Ayarlar                          | Oturum kaydı (aç/kapa, saklama süresi, gözetimsiz kayıt politikası), genel sınırlar (kod geçerliliği, en uzun oturum, teknisyen başına açık oturum, dosya boyutu), destek talebi bağlantısı, bekleme süresi, WhatsApp ve e-posta bildirimi + test, güvenilen ağlar, SMTP + test maili, SMS + test SMS, web talep formu aç/kapa ve müşteriye durum bildirimi kanalları, teknisyen 2FA zorunluluğu, sürümlü aydınlatma metni, firma logosu, Dosyalar (sunucu üzerinden aktarım ve virüs tarama, saklama süresi, depolama kullanımı) |

## Güvenlik ve yönetim

- Roller (Teknisyen / Yönetici / Süper Yönetici) ve modül bazlı yetki anahtarları; kimse sahip olmadığı yetkiyi veremez.
  Yetki her işlemde sunucuda, işlem anındaki güncel haliyle denetlenir; reddedilen yetki denemeleri de denetim kaydına
  yazılır. İki yönetici aynı kullanıcıyı aynı anda düzenlerse ikinci kayıt reddedilir ve güncel hâl yeniden yüklenir
  (birinin değişikliği fark edilmeden ezilmez). Kullanıcı ve firma işlemleri kişi başına hız sınırlıdır.
- Çoklu firma: bir firmanın kullanıcısı başka firmanın kaydını göremez; firma pasife alınınca oturumları, talepleri
  ve kayıtlı bilgisayarları hemen kapanır.
- Denetim kaydı: giriş/çıkış, oturum olayları, kontrol izinleri, dosya aktarımı, dışa aktarma, kullanıcı/yetki/firma
  ve ayar değişiklikleri (eski → yeni), e-posta/WhatsApp gönderimleri. Şifre ve anahtarlar maskelenir; müşteri kişisel
  verisi yazılmaz; müşteri IP adresi yalnız ağ kısmıyla kaydedilir. Kayıtlar ekranda salt okunurdur; veritabanı kuralları
  son 730 günün kaydının değiştirilmesini ve silinmesini, geri tarihli kayıt eklenmesini engeller. 730 günden eski kayıtlar
  kendiliğinden silinir.
- KVKK: aydınlatma metni firma bazında ve sürümlü, yönetici panelden düzenler; her onay, onaylanan sürümle saklanır.
- Sohbet uçtan uca şifreli değildir, sunucuda alan şifrelemesiyle saklanır; bunu söyleyen standart paragraf aydınlatma
  metnine hazır gelir, eksikse panel uyarır. Sohbet geçmişini görme ayrı, hassas bir yetkidir.
  Saklama süresi (varsayılan 365 gün) dolan oturum, talep ve pasif müşteri kayıtlarında kişisel veriler (ad, e-posta, not,
  IP, dosya kayıtları) her gece anonimleştirilir; onay kararı ve metin sürümü kanıt olarak kalır. Anonimleştirilen kayıtlar
  30 gün sonra tamamen silinir (sunucu ayarıyla açılır); oturum kayıtları anonimleştirmeyle birlikte silinir; hiçbir kayda bağlı olmayan yüklenmiş dosyalar haftalık taramayla temizlenir.
- Kalıcı silme: yönetici pasif kullanıcıyı, Süper Yönetici en az 30 gün pasif firmayı kalıcı siler. Firma silmede önce
  silinecekler gösterilir, firma adı yazılır, 2FA istenir; silme 24 saat sonra başlar, bu sürede bütün Süper
  Yöneticilere uyarı gösterilir ve iptal edilebilir. Silme kesilirse kaldığı yerden sürer. Denetim kayıtları silinmez,
  silinen kişinin kimliği bu kayıtlarda maskelenir. Silinen veri yedeklerden en geç 14 günde düşer; yedekten geri
  yüklemede ayrı bir imha defteri sayesinde yeniden silinir.
- Yedekleme: her gece veritabanı ve yüklenen dosyalar birlikte, açık anahtarla şifreli yedeklenir (çözme anahtarı sunucuda
  tutulmaz); 14 gün saklanır, hata olursa alarm verir. Her yedeğin bilgi dosyası imzalanır: imzasız, değiştirilmiş ya da
  başka ortama ait yedek geri yüklenmez. Geri yükleme önce geçici bir veritabanında satır sayıları ve özetlerle doğrulanır.
  Yedek alınırken denetim kayıtlarının geçmişe dönük silinip silinmediği de kontrol edilir. Yedeği sunucu dışına kopyalamak
  için bir kanca hazırdır; hedef kurum tarafından seçilir.
- İzleme: servisler, web ve TURN sertifikaları, yedek yaşı, denetim kaydı sürekliliği, disk ve dosya izinleri 10 dakikada bir
  denetlenir; bozulunca alarm (ör. Telegram), düzelince tek "düzeldi" bildirimi gider.
- Kurtarma: kullanıcı kurtarma kodlarını 2FA koduyla kendisi yeniler (eskiler hemen geçersiz olur). Süper Yönetici şifresini
  başka bir Süper Yönetici panelden, yeniden 2FA doğrulamasıyla sıfırlar; 2FA kaybında sunucu yöneticisi sunucudan sıfırlar.
  Geçici şifre 24 saat geçerlidir, ilk girişte değiştirilir ve işlem denetim kaydına yazılır.
- Kod kalitesi: her değişiklikte otomatik biçim, lint, tip ve test denetimi; entegrasyon ve uçtan uca testler kararsızlığa
  karşı her hafta 20 kez tekrar koşulur.
- Web talep formu otomatik gönderimlere karşı tek kullanımlık form anahtarı ve gönderim gecikmesiyle korunur; firmaya
  saatlik ve bekleyen talep sınırı uygulanır. Müşteriye giden bildirimlerde alıcı ve firma başına günlük/saatlik tavan vardır;
  SMS API anahtarı şifreli saklanır, servis adresine anahtar yazılamaz.
- Tarayıcı bağlantısı yalnız HTTPS (HSTS); WhatsApp servis anahtarı şifreli saklanır ve yalnız kayıtlı servis adresine gider.
- Şifreler argon2id ile saklanır; hatalı girişte kilit (ve kullanıcıya e-posta), ilk girişte şifre değişimi, CSRF
  koruması, süreli oturum (30 dk boşta / 8 sa).
- İki adımlı doğrulama (TOTP; Google/Microsoft Authenticator vb.) ve tek kullanımlık kurtarma kodları; yönetici
  hesaplarında zorunlu. Veritabanı, TURN ve WhatsApp gibi kritik sistem ayarları değiştirilirken açık oturum yetmez: son 5
  dakika içinde yeniden 2FA kodu (veya kurtarma kodu) istenir. Kurtarma kodu kullanılınca kullanıcıya e-posta gider, kod
  azaldığında uyarı çıkar. SMTP ve veritabanı şifreleri, TURN anahtarı ve 2FA sırları şifreli saklanır; e-posta yalnız internetteki SMTP sunucularına,
  sertifika doğrulamalı gönderilir.
- 2FA cihaz hatırlama (firma ayarıyla kapatılabilir): yalnız kodla doğrulamada, en çok 30 gün, kullanıcı başına 10
  tarayıcı; Süper Yönetici hesaplarında yoktur. Şifre her girişte, hassas işlemlerde kod yine sorulur. Yeni cihaz
  hatırlanınca e-posta gider; kopyalanmış hatırlama bilgisi kullanılırsa tüm hatırlanan cihazlar ve açık oturumlar
  kapanır. Şifre değişimi, 2FA sıfırlama ve tüm cihazlardan çıkış hatırlamayı siler.
- Gözetimsiz erişim: bağlantı cihaz kullanıcısına sorulmadan açılır; bu yüzden telafi kontrolleri zorunludur — her
  bağlantı ayrı 2FA doğrulaması ister; yeni cihazda hiçbir teknisyenin yetkisi yoktur, yönetici cihaz başına açar; her
  bağlantı müşterinin tanımlı adreslerine e-postayla bildirilir (firmanın SMTP ayarı yoksa özellik kullanılamaz); cihazda
  kapatılamayan gösterge vardır, çizilemezse bağlantı açılmaz; müşteri yerel anahtarla 2 saniyede keser; yönetici cihazı
  iptal edince bağlantı 10 saniyede kesilir. Koşullar sunucuda denetlenir; eski servis sürümlerine bağlantı açılmaz.
  Olaylar denetim kaydına ve cihazın Windows olay günlüğüne yazılır. **Not:** cihazda oturum açmış Windows kullanıcısı
  yöneticiyse teknisyen yönetici onayı (UAC) verebilir; standart kullanıcı hesabı önerilir.
- Otomatik güncelleme: programlar yeni sürümü yalnız Nokta Bilişim'in dijital imzasıyla doğrulayıp kurar; imzası tutmayan,
  bozuk, eski ya da başka ortama ait sürüm reddedilir ve güvenlik olayı olarak kaydedilir. Sunucu ele geçirilse bile
  istemci imzayı kendisi denetler. İmza anahtarı yalnız onaylı yayın ortamında durur; yedek anahtarla değiştirilebilir.
- **Gizli izleme yoktur:** bağlantı süresince cihazda "Uzaktan bağlantı" göstergesi her zaman görünür ve cihaz kullanıcısı
  bağlantıyı yerel kapatma anahtarıyla sonlandırabilir. **KVKK:** firma, çalışanlarını bu bilgisayarlara sorulmadan uzaktan
  bağlanılabileceği, ekranın görülebileceği, kontrol edilebileceği ve (açıksa) kaydedilebileceği konusunda yazılı olarak
  bilgilendirmekten sorumludur. Panelde cihaz kullanıcısının durumu (aktif / kilitli / oturum yok) yalnız cihaz yetkisi
  olan teknisyene görünür, kayıtlara ve dışa aktarıma yazılmaz. Bağlantı kipi ve kilit/oturum kapatma geçmişte ve denetim
  kaydında süzülebilir.
- Pano ve yazdırma: yalnız kontrol izni verilmiş oturumda ve müşterinin ayrı onayıyla çalışır; pano izni her oturumda kapalı
  başlar, kontrol kapanınca kendiliğinden kapanır, uzaktan tıklamayla açılamaz. Parola yöneticisinin gizli işaretlediği
  içerik okunmaz. Her belge için müşteri onayı istenir; belge yalnız bellekte tutulur, ayrı ve kısıtlı bir süreçte işlenir,
  gömülü komutlar çalışmaz. Pano metni, belge içeriği ve dosya adı hiçbir kayda yazılmaz; denetim kaydında yalnız yön, boyut,
  sayfa ve sonuç bulunur. Gözetimsiz oturumda bu özellikler kapalıdır.
- Sunucu üzerinden dosya aktarımı (firma ayarı, varsayılan kapalı): yalnız Süper Yönetici virüs tarama bağlantısını
  başarıyla test ettikten sonra açılabilir; açarken yönetici aydınlatma metnini güncellediğini onaylar. Dosyalar sunucuda
  dosya başına ayrı anahtarla AES-256-GCM şifreli, firma klasöründe rastgele adla saklanır; indirme bağlantısı en çok 5
  dakika geçerlidir ve başka firma ya da oturum için çalışmaz. Tarama servisine ulaşılamazsa, süre aşılırsa ya da arşiv
  şifreliyse dosya teslim edilmez (taranamadı). Virüs tarama servisi internete yalnız imza güncellemesi için çıkar, dışarıdan
  erişilemez; imzalar günde birkaç kez güncellenir, 3 günden eskiyse uyarı verir. Firma başına depolama kotası (varsayılan
  20 GB) ve disk boş alanı %10'un altına inince yeni yükleme reddedilir. Saklanan dosyalar yedeğe girmez; süre dolunca,
  oturum anonimleştirilince ya da kalıcı silinince diskten silinir. Gözetimsiz oturumda bu modda dosya aktarımı kapalıdır.
  Yükleme, tarama, virüs bulgusu ve her indirme denetim kaydına yazılır (dosya adı yazılmaz).
- Müşteri programı yalnız kendi sunucusuna bağlanır; bütünlüğü SHA-256 ve tekrarlanabilir derlemeyle doğrulanır.
  Hatırlanan bilgiler Windows hesabına bağlı şifreyle (DPAPI) saklanır, tek tıkla silinir. Tanılama dosyası kişisel
  veri içermez. Windows açılışında başlatma yalnız kullanıcı seçerse açılır; program başkalarının yazabildiği klasörden
  çalışıyorsa açılmaz. Bir firma, bilgisayarın başka firmalara kaydını göremez ve iptal edemez.
- Müşteri portalı: portal girişi panelden tamamen ayrıdır (ayrı hesaplar, ayrı oturum çerezi); portal kullanıcısı panele
  giremez ve yalnız kendi müşteri firmasının kayıtlarını görür, bu kural her istekte sunucuda uygulanır. Hatalı girişte
  15 dakikalık kilit, 30 dk boşta / 8 saatlik oturum, isteğe bağlı 2FA (açılınca diğer cihazlardaki oturumlar kapanır).
  Müşteri başına en çok 20 hesap, saatte 10 ve aynı anda 3 bekleyen talep sınırı. Giriş, şifre, 2FA ve hesap işlemleri
  denetim kaydına yazılır; pasif hesaplar saklama süresi sonunda kendiliğinden silinir.
- Logo ve profil resimleri: yalnız PNG/JPG/WEBP (dosya içeriğinden denetlenir, SVG kabul edilmez), en çok 2 MB; sunucuda
  yeniden boyutlandırılır, konum gibi gizli bilgiler (EXIF) silinir. Profil resimleri aynı firmanın kullanıcılarına görünür;
  müşteri, teknisyeninin resmini yalnız oturum sürerken, 10 dakika geçerli imzalı bir adresten görür.
- Sesli görüşmede mikrofon yalnız müşterinin kendi bilgisayarındaki "Kabul et" tıklamasıyla açılır; teknisyen uzaktan
  kontrolle kabul edemez. Görüşme sürerken Windows'ta her ekranda kapatılamaz bir "mikrofon açık" göstergesi durur. Ses uçtan
  uca şifreli akar, sunucuda tutulmaz. Windows programında ses kodlayıcı yalıtılmış bir sanal ortamda (WebAssembly) çalışır;
  bozuk ses verisi programı çökertemez. Gözetimsiz bağlantıda ses özelliği hiç yüklenmez. İstek, kabul, ret, katılım ve
  bitiş (süre, konuşan ve dinleyenler) audit log'a yazılır.

## Entegrasyonlar

- TURN sunucusu (coturn): güvenlik duvarı arkasındaki müşteriler için görüntü aktarımı; adres ve anahtar panelden
  yönetilebilir. Kısıtlı ağlarda şifreli TURN (5349/TCP) ile bağlanır.
- WhatsApp (Nokta Bilişim whatsapp-bildirim servisi): yeni talepte kişisel veri içermeyen bildirim; test butonu. Servis
  adresi ve servis anahtarı Süper Yönetici panelinden yeniden başlatmadan değiştirilir; güvensiz adreste kanal kendiliğinden
  kapanır.
- E-posta (firmanın kendi SMTP sunucusu): şifre sıfırlama, güvenlik bildirimleri, yeni talep bildirimi, oturum
  bağlantısını müşteriye gönderme, gözetimsiz bağlantı bildirimi; test butonu.
- MySQL: bağlantı bilgisi yönetim panelinde, "Bağlantıyı Test Et" ile; geçiş sunucu yapılandırmasıyla yapılır.
- SMS (Nokta Bilişim smsportal servisi, arka planda NetGSM): oturum bağlantısını ve talep durumunu müşteriye SMS ile
  gönderme; firma başına adres, şifreli API anahtarı, başlık ve test SMS butonu. Türkiye cep numaralarına gider.
- WhatsApp ile müşteriye oturum bağlantısı ve talep durumu gönderimi (aynı whatsapp-bildirim servisi).
- ClamAV (açık kaynak virüs tarayıcı): sunucu üzerinden aktarılan dosyaların taranması; aynı Docker Compose yığınında iki
  konteyner (tarayıcı ve imza güncelleyici) olarak gelir; adres ve "Bağlantıyı Test Et" Süper Yönetici panelinde.

## Teknik özellikler

| Başlık                  | Değer                                                                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Çalışma şekli           | Web tabanlı teknisyen konsolu; müşteri için Windows programı, Mac uygulaması, Linux programı veya tarayıcı                                                                                                                                                                    |
| Sunucu / veritabanı     | Node.js 22 (Fastify), Next.js arayüz / MySQL 8.4                                                                                                                                                                                                                              |
| Kurulum                 | Docker Compose, kurum sunucusunda; TURN ayrı compose                                                                                                                                                                                                                          |
| Görüntü                 | WebRTC, eşler arası; H.264 (Windows, Mac) / VP8 (Linux), en çok 1920×1080, hedef 30 fps                                                                                                                                                                                       |
| Müşteri işletim sistemi | Windows 10 / 11 (64 bit); macOS 13 ve üstü (Apple Silicon ve Intel; canlı dağıtım Apple imzasından sonra); Ubuntu 22.04 / 24.04 LTS x86_64, GNOME (Wayland'de uzaktan kontrol sınırlı ya da yalnız görüntü); tarayıcı modu için ekran paylaşımı destekleyen masaüstü tarayıcı |
| Gözetimsiz erişim       | Windows 10 / 11 (64 bit), fiziksel konsol oturumu (uzak masaüstü oturumu desteklenmez)                                                                                                                                                                                        |
| Teknisyen tarayıcısı    | Chrome, Edge (güncel)                                                                                                                                                                                                                                                         |
| Dil / tema              | Türkçe / kullanıcı başına Açık, Koyu veya Sistem                                                                                                                                                                                                                              |

## Sistem gereksinimleri (öneri)

|           | Minimum                                                  | Önerilen                                                                                                                       |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| CPU / RAM | 2 çekirdek / 4 GB                                        | 4 çekirdek / 8 GB (virüs tarama 4,5 GB'a kadar ek bellek ayırır)                                                               |
| Disk      | 20 GB                                                    | 50 GB (kayıt saklama süresine ve 14 günlük yedeğe göre); sunucu üzerinden dosya açıksa firma kotalarının toplamı kadar ek alan |
| Ağ        | Tek HTTPS portu; TURN için 3478/5349 ve UDP röle aralığı | Genel IP, alan adı ve genel sertifika                                                                                          |

**Müşteri ve teknisyen ağında izin verilmesi gereken çıkışlar** (hedef: destek sunucusu)

| Port        | Protokol  | Amaç                                                       |
| ----------- | --------- | ---------------------------------------------------------- |
| 443         | TCP       | Web konsolu, müşteri sayfası, müşteri programı (HTTPS)     |
| 3478        | UDP + TCP | Görüntü bağlantısı kurma (STUN/TURN)                       |
| 5349        | TCP       | Şifreli görüntü aktarımı (TURN-TLS), UDP kapalı ağlar için |
| 49160–49479 | UDP       | Görüntü aktarımı (TURN relay aralığı)                      |

Yalnız 443/TCP'nin açık olduğu ağlarda görüntü aktarımı desteklenmez.

## Destek ve iletişim

Nokta Bilişim Danışmanlık ve Elektronik San. Tic. Ltd. Şti.
