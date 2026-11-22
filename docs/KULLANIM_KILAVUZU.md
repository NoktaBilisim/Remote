# Remote Support — Kullanım Kılavuzu

Bu kılavuz Nokta Bilişim uzaktan destek platformunun kullanıcıya dönük ekranlarını anlatır. Platform paketler hâlinde
geliştirilir (bkz. `README.md` "Yol haritası"); kılavuz da her paketle birlikte büyür. Bu sürümde yer alan bölümler:

- **Müşteri için:** Hızlı Destek uygulaması (Windows) ve **Hızlı Destek uygulaması (macOS, 0.19)** (indirme ve açma, Ekran
  Kaydı / Erişilebilirlik izinleri, ilk açılışta "Yine de Aç" onayı, her yeni sürümde onay ve izinler, korunan düğmeler, yazdırma, izinleri kaldırma; 0.24 ile Mac'te de "Destek iste"; 0.26 ile Mac'te sesli görüşme ve Mikrofon izni, yalnız bir pencereyi paylaşma, pencere modunda iletilmeyen kısayollar), **Hızlı Destek
  uygulaması (Linux, 0.20)** (Ubuntu 22.04 / 24.04, başlatma komutu, X11 ve Wayland farkları, Wayland izin penceresi ve
  kontrol sınırları, Super+L), pencere başlığında sürüm (0.20), yalnız bir pencereyi paylaşma (0.11), "Destek iste" ile talep gönderme,
  birden çok firmaya kayıt, tepside çalıştırma ve Windows açılışında başlatma, beklerken teknisyenle yazışma (0.12),
  program indirmeden tarayıcıdan talep gönderme (web talep formu, durum bildirimi, "sohbete şifre yazmayın"), bilgisayarın hatırlanması
  ("Bağlantı kodum var", "Bu bilgisayarı unut"), uzaktan kontrol izni, pano paylaşımı ve uzaktan yazdırma onayı (0.13), firma dosyaları sunucuda tarıyorsa (0.14), ekran görüntüsü alınamazsa ne yapılır,
  bilgisayarda ne kalır (iz ve gizlilik); **Müşteri portalı** (giriş bağlantısı, ilk girişte şifre değiştirme, talep ve
  oturum geçmişi, portaldan yeni talep, firma dosyası, isteğe bağlı 2FA)
- **Teknisyen için:** Oturumlar ve bekleme odası ("Müşteri bekliyor" rozeti, menü sayacı, bildirim), Uzaktan kontrol
  (konsol; "Pencere paylaşımı" rozeti, Mac ve Linux müşterisi dahil), Pano ve uzaktan yazdırma (konsol), Dosyalar sunucuda taranırken (tarama durumları), Oturum geçmişi (sunucudaki dosyaları indirme dahil) (dosyalarda "Doğrulanmış / Müşteri bildirimi", talepte SLA satırı), Destek talepleri ("Bu kaynağı engelle"; öncelik, atama,
  SLA rozetleri, kabul öncesi mesajlaşma),
  Engellenenler, web formundan gelen talepler ("Web" rozeti), müşterinin ekranı gelmiyorsa (paylaşım hata nedeni)
- **Admin ve teknisyen için:** Müşteriler (müşteri firmalar, bağlantı gönderme, web talep formu bağlantısı, kayıtlı
  bilgisayarlar, CSV dışa/içe aktarma); **Müşteriye gönder** (oturum bağlantısı, kayıt kodu ve müşteri bağlantılarını
  e-posta, WhatsApp ya da SMS ile gönderme)
- **Admin için (Müşteriler):** Müşteri portal hesapları (oluşturma, geçici şifreyi iletme, pasife alma ve bağlantı
  yenileme, şifre sıfırlama, `customers.portal` yetkisi, hesap ve talep sınırları)
- **Admin, teknisyen ve müşteri BT için:** Gözetimsiz erişim (SMTP ön koşulu, bildirim adresleri, kayıt kodu, teknisyen
  yetkisi, bağlanma, cihaz rozetleri, iptal; müşteri tarafında servisi kurma, gösterge, tepsi, yerel kapatma, kaldırma);
  cihaz kullanıcısına sorulmadan açılan tek bağlantı yolu, gösterge ve KVKK uyarısı, müdahale (oturumu kilitle / kapat),
  eski servis güncellemesi, eski kayıtlardaki bağlantı kipi etiketleri; imzasız servisi kurmadan önce `Get-FileHash` ile
  özet doğrulama, SmartScreen "Yine de çalıştır", antivirüs istisnasının özetle verilmesi, Admin kurulum notu ve Super
  Admin risk kabul bandı
- **Teknisyen, Admin, Super Admin ve müşteri için:** Oturum sohbeti ve kaydı (sohbet her zaman kaydedilir, uçtan uca
  şifreli değildir, saklama süresi, "sohbete şifre yazmayın", Hızlı Destek 0.21'de oturum sohbeti ve onay düğmesinin
  üstündeki saklama satırı, 0.20 ve öncesinde sohbet kapalı, oturum geçmişinde
  **Sohbeti göster** ve `sessions.view_chat` yetkisi, aydınlatma metninde standart sohbet paragrafı)
- **Teknisyen, Admin ve müşteri için:** Çoklu teknisyen (roller, davet etme ve kabul, "İzle", kontrol ve oturum devri,
  oturumdan ayrılma, müşterinin teknisyen listesi ve **Çıkar**, Admin için `sessions.invite` / `sessions.supervise` yetkileri)
- **Admin, teknisyen, müşteri ve müşteri BT için:** Oturum kaydı (Ayarlar > Oturum kaydı, saklama süresi, KVKK onayı,
  gözetimsiz bağlantıları kaydetme ve dört göz e-postası, müşterinin kayıt izni ve **Kaydı durdur**, konsolda kayıt
  göstergesi, oturum geçmişinde **Kaydı izle** / **Kaydı sil**, denetim kayıtları)
- **Herkes için (teknisyen, Admin, Super Admin):** Giriş ve hesap güvenliği — iki adımlı doğrulama (2FA), kurtarma
  kodları ve kurtarma kodlarını yenileme, "Bu cihazı 30 gün hatırla" ve hatırlanan cihazlar, şifremi unuttum, Hesabım sayfası, tüm cihazlardan çıkış, kritik ayarlarda kimliğinizi yeniden doğrulama;
  hesap menüsü, profil resmi ve tema; giriş ekranında firma logosu
- **Admin için:** Kullanıcılar ve yetkiler (2FA sıfırlama ve kullanıcıyı kalıcı silme dahil), Uzaktan kontrol yetkisi ve kayıtlar (pano paylaşımı ve uzaktan yazdırma yetkisi dahil), Oturum geçmişi
  yetkileri, Ayarlar > Genel (oturum ve dosya sınırları), Ayarlar > Dosyalar (sunucu üzerinden aktarım ve virüs tarama, saklama süresi, depolama kullanımı), Ayarlar > Destek talepleri (web talep formu, form spam'i altında ne yapılır, müşteriye durum bildirimi, e-posta bildirimi, kabul kodu, öncelik ve SLA dahil), Ayarlar > Mesai saatleri ve Tatiller, Ayarlar > E-posta (SMTP), Ayarlar > SMS, Audit log, Ayarlar >
  Aydınlatma metni, Ayarlar > Güvenlik (2FA cihaz hatırlama, kullanıcının hatırlanan cihazlarını kaldırma), Ayarlar > Logo, kullanıcının profil resmi, kişisel verilerin saklama süresi ve
  anonimleştirme, kurumsal bilgisayarlarda Hızlı Destek'e izin verme (AppLocker / antivirüs), ağ gereksinimleri
  (güvenlik duvarı izin listesi)
- **Admin, teknisyen, müşteri ve müşteri BT için:** İstemcilerin otomatik güncellenmesi (0.22.0; servis, Windows ve
  Linux programı kendini günceller, Mac yalnız haber verir; Ayarlar > İstemciler; asgari sürüm istisnası; cihaz listesinde
  sürüm rozetleri ve sürüm dağılımı; audit kayıtları; 0.21 ve öncesini bir kez elle güncelleme)
- **Herkes için:** Canlı ortam (adres, güncel sürüm 0.25.1, en düşük sürüm, otomatik güncelleme durumu, imzasız
  gözetimsiz servis, Mac ilk açılış) ve **Hangi programda ne var?** (Windows / macOS / Linux / tarayıcı karşılaştırması);
  kılavuzun sonunda **Sık sorulan sorular**
- **Super Admin için:** Firmalar ve aranabilir firma seçici, firmanın sunucu depolama kotası, firmayı kalıcı silme (24 saat iptal penceresi), tüm firmaların oturum geçmişi, destek talepleri, Sistem ayarları
  (MySQL, TURN, sistem logosunu değiştirme/kaldırma, WhatsApp servisi, virüs tarama (ClamAV)), başka bir Super Admin'in şifresini sıfırlama,
  şifre/2FA kaybı

---

## Canlı ortam: adres, sürüm ve platformlar (2026-11-21)

Platform **https://remote.noktabilisim.net** adresinde canlıdır (2026-11-21 açıldı). Teknisyen paneli, müşteri sayfaları
ve program indirmeleri yalnız bu adresten yapılır. Size başka bir adresten gelen bağlantıyı ya da e-posta ekiyle gelen
programı açmayın.

**Güncel program sürümü: 0.25.1** (Windows, macOS, Linux). Sunucu en az **0.25.1** ister. Daha eski bir Hızlı Destek
programıyla bağlanmaya çalışan müşteri bağlanamaz; program "güncel sürümü indirin" uyarısı verir. Müşteri destek
sayfasından ya da firma bağlantısından programı yeniden indirir.

**Otomatik güncelleme:** 0.25.1, canlı ortamda kendini güncelleyebilen ilk sürümdür. Daha önceki sürümler bir kez elle
değiştirilir. 0.25.1 ve sonrasında:

- Windows ve Linux programı yeni sürümü kendisi indirir, Nokta Bilişim'in imzasıyla doğrular ve oturum yokken kurar.
- Mac uygulaması kendini değiştirmez; oturum sonunda "Yeni sürüm var" der. Yeni sürümü destek sayfasından indirin.
- **Gözetimsiz erişim servisinin otomatik güncellemesi şimdilik kapalıdır.** Yeni servis sürümünü teknisyen elle kurar
  (bkz. "Eski servis: Servis güncel değil").

**Gözetimsiz erişim:** canlı ortamda servis programı **kod imzası olmadan, risk kabulüyle** çalışır. Kurulumda Windows
"Windows bilgisayarınızı korudu" uyarısı gösterir: **Ek bilgi** → **Yine de çalıştır** (önce özeti doğrulayın; bkz.
"Müşteri BT için: servisi kurma"). Sunucu yalnız yayımlanmış servis sürümlerini kabul eder; listede olmayan bir sürüm
bağlanamaz. Super Admin bu durumu gösteren risk kabul bandını görür (bkz. "Ortam bantları").

**Mac uygulaması** Apple Developer ID olmadan (ad-hoc) imzalıdır. İlk açılışta macOS uygulamayı durdurur: **Bitti** →
**Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç** (macOS 13–14'te Control-tık → **Aç** kısa yolu da çalışır). Ayrıntı:
"Mac'te nasıl indirir ve açarım?".

### Hangi programda ne var?

| Özellik                                     | Windows      | macOS                 | Linux (Ubuntu)           | Tarayıcı  |
| ------------------------------------------- | ------------ | --------------------- | ------------------------ | --------- |
| Ekranı görme                                | Var          | Var                   | Var                      | Var       |
| Uzaktan kontrol (fare, klavye)              | Var          | Var                   | Var (Wayland'de sınırlı) | Yok       |
| Sohbet                                      | Var          | Var                   | Var                      | Var       |
| Sesli görüşme                               | Var          | Var (0.26 ve sonrası) | Var                      | Var       |
| Dosya alma (sunucu üzerinden taranan dahil) | Var          | Var                   | Var                      | Var       |
| Pano paylaşımı ve uzaktan yazdırma          | Var          | Var                   | Var                      | Yok       |
| Çoklu teknisyen (davet, İzle, devir)        | Var          | Var                   | Var                      | Var       |
| Yalnız bir pencereyi paylaşma               | Var          | Var (0.26 ve sonrası) | Yok                      | —         |
| "Destek iste" (firma bağlantısıyla)         | Var          | Var                   | Yok                      | Web formu |
| Bilgisayar kaydı, tepside çalışma           | Var          | Yok                   | Yok                      | Yok       |
| Gözetimsiz erişim (başında kimse yokken)    | Var (servis) | Yok                   | Yok                      | Yok       |
| Kendini güncelleme                          | Var          | Yalnız haber verir    | Var                      | —         |

Mac uygulamasında sesli görüşme ve yalnız bir pencereyi paylaşma **0.26 ve sonrasında** vardır. Mac müşterisi daha eski bir
uygulama kullanıyorsa sesli görüşme düğmesi pasif kalır; müşteri güncel uygulamayı destek sayfasından yeniden indirir.
Gözetimsiz bağlantıda ses yoktur.

---

## Herkes için: Giriş ve hesap güvenliği

Bu bölüm panele giren herkes içindir: teknisyen (User), Admin ve Super Admin. Müşteriler panele girmez.

### İki adımlı doğrulama (2FA) nedir, kimde zorunlu?

Şifrenize ek olarak telefonunuzdaki bir doğrulama uygulamasının ürettiği 6 haneli kodla giriş yaparsınız. Şifreniz
çalınsa bile telefonunuz olmadan hesabınıza girilemez.

- **Super Admin ve Admin:** her zaman zorunlu.
- **Teknisyen:** firmanızın Admin'i "Teknisyenler için zorunlu" ayarını açtıysa zorunlu (varsayılan açık).
- Zorunluysa ve henüz kurmadıysanız panel sizi kurulum ekranına götürür; kurulumu bitirmeden başka sayfa açılmaz
  (yalnız "Çıkış yap" kullanılabilir).

Uygulama olarak Google Authenticator, Microsoft Authenticator veya standart TOTP kodu üreten herhangi bir uygulama
kullanılabilir.

### Nasıl 2FA kurarım?

1. Telefonunuza bir doğrulama uygulaması kurun.
2. İlk girişte (veya **Hesabım** sayfasındaki kurulum bağlantısından) "İki adımlı doğrulamayı kurun" ekranı açılır.
   İlk girişte şifre değiştirmeniz gerekiyorsa önce o ekran gelir.
3. Uygulamada "hesap ekle / QR tara" seçin ve ekrandaki QR kodu okutun. Okutamıyorsanız "QR okutamıyorsanız bu anahtarı
   elle girin" altındaki anahtarı uygulamaya yazın ("Anahtarı kopyala" ile kopyalayabilirsiniz).
4. Uygulamanın gösterdiği 6 haneli kodu yazın ve **Doğrula ve etkinleştir**'e basın.
5. Ekranda **10 kurtarma kodu** görünür. Bunları kopyalayın veya `.txt` olarak indirin ve güvenli bir yere (parola
   kasası, kilitli dolap) kaydedin. Kodlar **bir daha gösterilmez**.
6. "Kaydettim" kutusunu işaretleyip **Devam et**'e basın.

2FA'yı kurduğunuzda diğer cihazlarda açık oturumlarınız kapanır. Firmanızın e-posta ayarı varsa "İki adımlı doğrulama
etkinleştirildi" e-postası alırsınız; bu işlemi siz yapmadıysanız hemen Admin'inize haber verin.

### Girişte kod nasıl girilir?

1. E-posta ve şifrenizle giriş yapın.
2. Kod ekranı açılır: uygulamadaki **güncel** 6 haneli kodu yazın. Kod 30 saniyede bir değişir.
3. Telefonunuz yanınızda değilse **Kurtarma kodu kullan**'a basın ve kurtarma kodlarınızdan birini yazın (büyük/küçük
   harf, tire ve boşluk fark etmez). Her kurtarma kodu **yalnız bir kez** kullanılır.

Aynı kodu iki kez kullanamazsınız; yeni kodun gelmesini bekleyin. Çok sayıda hatalı denemede kısa süreli bekleme gelir
(aynı yerden 5 hata → 5 dk; toplam 15 hata → 15 dk).

### "Bu cihazı 30 gün hatırla" (Admin ve teknisyen için)

Her girişte kod yazmak istemiyorsanız, **kendi** bilgisayarınızdaki tarayıcıyı 30 gün hatırlatabilirsiniz.

1. E-posta ve şifrenizle giriş yapın.
2. Kod ekranında 6 haneli kodu yazın ve **Bu cihazı 30 gün hatırla** kutusunu işaretleyin.
3. **Doğrula**'ya basın.

Sonraki 30 gün bu tarayıcıda yalnız şifre sorulur. Bilmeniz gerekenler:

- Kutu varsayılan olarak **işaretsizdir**. Ortak kullanılan bilgisayarlarda işaretlemeyin.
- Şifre her girişte sorulur. Kritik ayarlarda ("Kimliğinizi doğrulayın" penceresi) ve her gözetimsiz bağlantıda kod
  **yine sorulur**.
- Süre 30 gündür, kullandıkça uzamaz. Süre dolunca bir kez kod girersiniz; isterseniz kutuyu yeniden işaretlersiniz.
- Kutu yalnız uygulamadaki kodla girişte vardır; **Kurtarma kodu kullan** ekranında görünmez.
- Bir hesapta en çok 10 tarayıcı hatırlanır; 11.'si eklenince en eskisi düşer.
- Aynı tarayıcıda yalnız bir hesap hatırlanır; ikinci hesabı hatırlatırsanız ilki o tarayıcıda unutulur.
- Kutu görünmüyorsa firmanızın yöneticisi bu özelliği kapatmıştır (Ayarlar → Güvenlik → **2FA cihaz hatırlama**).
- **Super Admin hesaplarında bu kutu yoktur**; Super Admin her girişte kod girer.

**Yeni cihaz e-postası.** Bir tarayıcı hatırlandığında size "Yeni cihaz hatırlandı" e-postası gelir (tarayıcı, işletim
sistemi, IP, saat). Bu işlemi siz yapmadıysanız Hesabım → **Hatırlanan cihazlar** → **Tümünü kaldır** yapın ve şifrenizi
değiştirin. E-posta yalnız firmanızın SMTP ayarı varsa gider.

**Kopyalanmış hatırlama bilgisi.** Hatırlanan bir tarayıcının bilgisi başka bir yerde kullanılırsa sistem bunu fark eder:
tüm hatırlanan cihazlarınız silinir, diğer tüm açık oturumlarınız kapanır, kod sorulur ve size e-posta gelir. Aynı
tarayıcıda iki sekmeden aynı anda giriş yapmak da nadiren bu uyarıyı tetikleyebilir; o durumda kodu girip devam edin.

**Hatırlamanın kendiliğinden silindiği durumlar** (sonraki girişte kod sorulur):

- Şifrenizi değiştirdiğinizde veya "Şifremi unuttum" ile sıfırladığınızda,
- Admin 2FA'nızı sıfırladığında ya da 2FA'yı yeniden kurduğunuzda,
- **Tüm cihazlardan çıkış** yaptığınızda (kullandığınız tarayıcı dahil),
- Hesabınız veya firmanız pasife alındığında,
- Firma yöneticisi **2FA cihaz hatırlama** ayarını kapattığında.

### Hatırlanan cihazlarımı nasıl görür ve kaldırırım?

1. Hesap menüsü → **Hesabım** → **Hatırlanan cihazlar** bölümü.
2. Her satırda tarayıcı · işletim sistemi, hatırlanma tarihi, son kullanım, son IP ve bitiş tarihi görünür. Şu an
   kullandığınız tarayıcıda **Bu cihaz** etiketi vardır.
3. Tek bir cihaz için **Kaldır**'a, hepsi için **Tümünü kaldır**'a basın (Tümünü kaldır onay ister).

Kaldırılan tarayıcıda bir sonraki girişte kod sorulur. Açık oturumlar kapanmaz; onları kapatmak için **Tüm cihazlardan
çıkış**'ı kullanın. Bölüm Super Admin hesabında görünmez.

### Kurtarma kodlarım biterse ya da telefonumu kaybedersem?

- **Hesabım** sayfası kalan kurtarma kodu sayısını gösterir; 3 veya daha azsa uyarı çıkar.
- Telefonunuz yanınızdaysa kodları **kendiniz yenileyebilirsiniz** (aşağıya bakın).
- Telefonunuzu kaybettiyseniz kodları yenileyemezsiniz. Admin'inizden **2FA sıfırlaması** isteyin; sonraki girişte
  2FA'yı yeniden kurar ve yeni kodlar alırsınız. Admin iseniz aynı firmadaki başka bir Admin sıfırlar. Super Admin için
  bkz. "Super Admin için: Şifre veya 2FA kaybı".

### Kurtarma kodlarımı nasıl yenilerim?

1. **Hesabım** sayfasında **Kurtarma kodlarını yenile**'ye basın.
2. Doğrulama uygulamanızdaki **güncel 6 haneli kodu** yazın. Kurtarma koduyla yenileme yapılmaz.
3. **Yeni kodları oluştur**'a basın. Ekranda 10 yeni kurtarma kodu çıkar.
4. Kodları parola kasanıza kaydedin. Kodlar **yalnız bir kez** gösterilir; pencere kodlar ekrandayken Esc ile kapanmaz,
   **Kapat**'a basarak çıkarsınız.

Yeniledikten sonra **eski kodlarınızın hepsi hemen geçersiz** olur. "Kod hatalı veya süresi geçmiş." yazarsa uygulamadaki
yeni kodu bekleyip tekrar deneyin. Çok sayıda hatalı denemede girişteki gibi kısa süreli bekleme gelir. Yenileme denetim
kaydına yazılır; kodların kendisi hiçbir yere yazılmaz.

### Şifremi unuttum

1. Giriş ekranında **Şifremi unuttum**'a basın.
2. E-posta adresinizi yazıp gönderin. Ekranda her zaman aynı mesaj çıkar ("kayıtlı bir hesap varsa…"); güvenlik
   gereği hesabın var olup olmadığı söylenmez.
3. Gelen e-postadaki bağlantıyı açın. Bağlantı **30 dakika** geçerlidir ve **bir kez** kullanılır.
4. Yeni şifrenizi (en az 12 karakter) iki kez yazın. Başarılı olunca giriş ekranına dönersiniz; tüm cihazlardaki
   oturumlarınız kapanır. 2FA etkinse girişte yine kod istenir.

E-posta gelmiyorsa: istenmeyen (spam) klasörüne bakın; firmanızın e-posta (SMTP) ayarı yapılmamış olabilir — Admin'inize
sorun. Bağlantı "geçersiz veya süresi dolmuş" diyorsa **Yeni bağlantı iste** ile tekrar isteyin.

### Hesabım sayfası

Üst menünün sağındaki yuvarlak resminize (avatar) basın, açılan **hesap menüsünden** **Hesabım**'ı seçin. Sayfada:

- **Profil:** ad soyad, e-posta, rol ve profil resmi (bkz. "Profil resmimi nasıl yüklerim?"),
- **Görünüm:** tema seçimi (Açık / Koyu / Sistem),
- **Şifre değiştir** (mevcut şifre + yeni şifre iki kez),
- 2FA durumu ("Etkin" / kurulum bağlantısı), kullanılmamış kurtarma kodu sayısı ve **Kurtarma kodlarını yenile**,
- **Hatırlanan cihazlar** (yalnız Admin ve teknisyen; bkz. "Bu cihazı 30 gün hatırla"),
- **Tüm cihazlardan çıkış**.

### Tüm cihazlardan çıkış

Başka bir bilgisayarda oturumunuzu açık unuttuysanız veya şüpheli bir durum varsa kullanın.

1. Hesabım → **Tüm cihazlardan çıkış** → onaylayın.
2. Kaç oturumun kapatıldığı gösterilir. Şu an kullandığınız oturum açık kalır; diğer cihazlar birkaç saniye içinde
   giriş ekranına düşer ve o cihazlardaki açık destek oturumları sonlanır.
3. Hatırlanan tüm cihazlarınız da silinir (bu tarayıcı dahil); sonraki girişlerde kod sorulur.

### Kritik bir ayarı değiştirirken "Kimliğinizi doğrulayın" penceresi

Bazı ayarlar tüm sistemi etkiler. Bunları kaydederken sistem, şifrenizle girmiş olsanız bile kimliğinizi bir kez daha
doğrulamanızı ister. Bugün bu pencere şu işlemlerde çıkar (yalnız Super Admin bu ekranları görür):

- **Sistem ayarları > MySQL**: **Kaydet**
- **Sistem ayarları > TURN**: **Kaydet** ve **Ortam değerlerine dön**
- **Sistem ayarları > WhatsApp servisi**: **Kaydet** ve **Ortam değişkenine dön**

**Bağlantıyı Test Et** ve **Test Mesajı Gönder** düğmeleri kod istemez.

Nasıl doğrularım?

1. Kaydet'e basınca **Kimliğinizi doğrulayın** penceresi açılır.
2. Telefonunuzdaki doğrulama uygulamasında görünen **6 haneli kodu** yazıp **Doğrula**'ya basın.
3. Telefonunuz yanınızda değilse **Kurtarma kodu kullan**'a basın ve kurtarma kodlarınızdan birini yazın (ör.
   `abcde-12345`). Kullanılan kurtarma kodu bir daha çalışmaz; hesabınıza "Kurtarma kodunuz kullanıldı" e-postası
   gider (firmanın e-posta ayarı varsa). **Uygulama kodunu kullan** ile 6 haneli koda geri dönersiniz.
4. Doğrulama başarılıysa işleminiz kendiliğinden tamamlanır; bir şeyi yeniden yazmanız gerekmez.
5. Doğrulama **5 dakika** geçerlidir. Bu süre içinde yaptığınız diğer kritik değişiklikler yeniden kod istemez.

**Kurtarma kodlarınız azaldı uyarısı:** Kurtarma koduyla doğruladıysanız ve **3 veya daha az** kodunuz kaldıysa pencere
"Kurtarma kodlarınız azaldı" der ve kaç kod kaldığını gösterir. **İşleme devam et** ile işleminizi tamamlayın, sonra
**Hesabım › İki adımlı doğrulama** bağlantısından yeni kodlar oluşturup parola kasanıza kaydedin.

**Vazgeç**'e basarsanız değişiklik **kaydedilmez** ve "İşlem yapılmadı: kimliğinizi doğrulamadınız. Tekrar denediğinizde
kod sorulur." yazar. Oturumunuz açık kalır. Hesabınızda 2FA kurulu değilse önce 2FA kurulum ekranına yönlendirilirsiniz.

Her doğrulama denetim kaydına yöntemiyle (uygulama kodu ya da kurtarma kodu) yazılır; kodun kendisi yazılmaz.

### Oturum süreleri

- 30 dakika hiçbir işlem yapmazsanız oturum kapanır; sayfa "Oturumunuz sona erdi" diyerek giriş ekranına döner.
- İşlem yapsanız bile girişten **8 saat** sonra yeniden giriş istenir.

### Sık karşılaşılan mesajlar (giriş ve hesap)

| Mesaj                                                            | Anlamı / ne yapmalı                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| "Doğrulama kodu hatalı."                                         | Telefonun saati doğru mu kontrol edin; yeni kodun gelmesini bekleyip tekrar deneyin        |
| "Çok fazla istek…"                                               | Kısa süreli bekleme; birkaç dakika sonra tekrar deneyin                                    |
| "Bu şifre sıfırlama bağlantısı geçersiz veya süresi dolmuş."     | Yeni bağlantı isteyin; yalnız son gelen e-postadaki bağlantı çalışır                       |
| "Oturumunuz sona erdi"                                           | 30 dk boşta kaldınız, 8 saat doldu veya başka bir cihazdan "Tüm cihazlardan çıkış" yapıldı |
| "Devam etmeden önce iki adımlı doğrulamayı kurmanız gerekiyor."  | Hesabınızda 2FA zorunlu; kurulum adımlarını izleyin                                        |
| "Kod hatalı ya da süresi geçti. Uygulamadaki güncel kodu girin." | Kimlik doğrulama penceresinde: telefon saatini kontrol edin, yeni kodu bekleyip yazın      |
| "Kurtarma kodu hatalı ya da daha önce kullanılmış."              | Kullanmadığınız başka bir kurtarma kodunu yazın                                            |
| "Çok fazla hatalı deneme. N dakika sonra tekrar deneyin."        | Hatalı kod sınırı doldu (girişteki 2FA ile ortak); belirtilen süre kadar bekleyin          |
| "İşlem yapılmadı: kimliğinizi doğrulamadınız…"                   | Pencereyi kapattınız; değişiklik kaydedilmedi. Kaydet'e yeniden basın ve kodu girin        |

## Herkes için: Hesap menüsü, profil resmi ve tema

### Hesap menüsü

Üst menünün sağındaki yuvarlak resim sizin **avatarınızdır**. Profil resminiz yoksa ad soyadınızın baş harfleri renkli bir
daire içinde görünür. Avatara basınca hesap menüsü açılır:

- Adınız ve e-posta adresiniz,
- **Hesabım** (kişi simgesi): Hesabım sayfasını açar,
- **Şifre değiştir** (anahtar simgesi): Hesabım sayfasının şifre bölümüne gider,
- **Tema**: Açık / Koyu / Sistem düğmeleri,
- **Çıkış** (kapı simgesi).

Menüyü klavyeyle de kullanabilirsiniz; **Esc** menüyü kapatır. Üst menüde ayrıca tek dokunuşla çalışan **Çıkış yap**
düğmesi de vardır; ikisi aynı işi yapar.

### Profil resmimi nasıl yüklerim?

1. Hesap menüsü → **Hesabım**.
2. **Profil** bölümünde **Resim yükle**'ye basın (resminiz varsa düğmenin adı **Resmi değiştir**'dir).
3. Bilgisayarınızdan bir PNG, JPG veya WEBP dosyası seçin (en çok 2 MB).
4. **Profil resmini kırp** penceresi açılır. Resmi sürükleyerek (klavyede ok tuşlarıyla) konumlandırın, yakınlaştırmayı
   kaydırıcıyla ayarlayın. Önizleme kare olarak gösterilir.
5. **Kaydet**'e basın. "Profil resmi güncellendi" mesajı çıkar; resim üst menüde hemen görünür. **Vazgeç** hiçbir şeyi
   değiştirmez.

Resim kare olarak kırpılır ve sunucuda 256×256 piksele küçültülür. Fotoğraftaki konum, cihaz gibi gizli bilgiler (EXIF)
silinir.

### Profil resmimi nasıl kaldırırım?

1. Hesabım → **Profil** → **Resmi kaldır**.
2. "Profil resmi kaldırılsın mı?" penceresinde onaylayın. Resim yerine baş harfleriniz görünür.

### Profil resmim kimlere görünür?

Profil resminiz üst menüde, kullanıcı listesinde ve audit log ekranında görünür. Yalnız **kendi firmanızdaki** oturum açmış
kullanıcılar (ve Süper Yönetici) görebilir.

Müşteri, bağlantıyı tarayıcıda açtığında karşılama ekranında adınızın yanında **profil resminizi** görür; böylece
kiminle konuştuğunu anlar. Resim yalnız o destek oturumu bekliyor veya sürüyorken, 10 dakika geçerli özel bir adresten
gösterilir; oturum bitince açılmaz. Resminiz yoksa baş harfleriniz gösterilir. Resminizi müşteriye göstermek
istemiyorsanız kaldırın (bkz. "Profil resmimi nasıl kaldırırım?").

### Temayı nasıl değiştiririm?

- **Hızlı yol:** hesap menüsü → **Tema** → **Açık**, **Koyu** veya **Sistem**. Seçim anında uygulanır, menü açık kalır.
- **Hesabım** → **Görünüm** bölümünden de aynı seçimi yapabilirsiniz.
- **Sistem** (varsayılan): bilgisayarınızın açık/koyu ayarını izler.

Tema yalnız **sizin** hesabınız için geçerlidir; başka kullanıcıları etkilemez. Tercihiniz hesabınıza kaydedilir, başka bir
bilgisayardan girdiğinizde de aynı tema gelir. Çıkış yaptıktan sonra giriş ekranı bu tarayıcıdaki son seçiminize uyar.
Kayıt başarısız olursa "Tema kaydedilemedi; önceki seçim geri yüklendi." yazar; biraz sonra tekrar deneyin.

### Giriş ekranında firmamın logosu nasıl görünür?

Giriş ekranında her zaman bir logo vardır:

- Giriş bağlantısı firmanızın kısa adını içeriyorsa (ör. `https://remote.noktabilisim.net/login?tenant=ornek-bilisim`)
  **firmanızın logosu** görünür. Kısa adı Süper Yönetici'den öğrenebilirsiniz.
- Bağlantıda kısa ad yoksa ya da kısa ad yanlış veya firma pasifse **sistem logosu** görünür.
- Sistem logosu yüklenmemişse Nokta Bilişim logosu görünür.

Yöneticiler ekip için bu bağlantıyı tarayıcıda yer imi olarak kaydedebilir. Şifremi unuttum ve şifre sıfırlama ekranları
da aynı kuralla logo gösterir.

### Resim dosyası kuralları (profil resmi ve logolar)

| Kural            | Değer                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Dosya türü       | PNG, JPG veya WEBP. SVG, GIF, PDF kabul edilmez; dosyanın içeriği kontrol edilir, uzantıyı değiştirmek işe yaramaz |
| En büyük dosya   | 2 MB                                                                                                               |
| En küçük boyut   | Her kenar en az 16 piksel                                                                                          |
| En-boy oranı     | Logoda en çok 20:1, profil resminde en çok 4:1                                                                     |
| Sunucudaki sonuç | Profil resmi 256×256 kare; logo en çok 512 piksel (oran korunur)                                                   |
| Saatlik sınır    | Bir kişi saatte en çok 20 resim yükleyebilir                                                                       |

### Sık karşılaşılan mesajlar (resim yükleme ve tema)

| Mesaj                                                                                                                     | Anlamı / ne yapmalı                                                                      |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| "Yalnız PNG, JPG veya WEBP resim yükleyebilirsiniz."                                                                      | Dosya bu türlerden değil veya bozuk. Resmi PNG ya da JPG olarak yeniden kaydedin         |
| "Resim boyutları uygun değil: her kenar en az 16 px, en-boy oranı logoda en çok 20:1, profil resminde en çok 4:1 olmalı." | Resim çok küçük ya da çok ince uzun. Daha büyük veya daha dengeli oranlı bir resim seçin |
| "Dosya en çok 2 MB olabilir."                                                                                             | Resmi küçültün veya JPG olarak sıkıştırıp tekrar deneyin                                 |
| "Çok fazla resim yüklendi. Biraz sonra tekrar deneyin."                                                                   | Saatlik sınır doldu ya da sunucu o anda başka resimleri işliyor; biraz bekleyin          |
| "Bu kullanıcının profil resmini değiştirme yetkiniz yok."                                                                 | Bkz. "Admin için: Kullanıcının profil resmi"                                             |
| "Tema kaydedilemedi; önceki seçim geri yüklendi."                                                                         | Bağlantı veya sunucu sorunu; sayfayı yenileyip tekrar deneyin                            |

---

## Müşteri için: Hızlı Destek uygulaması (Windows)

Hızlı Destek, teknisyenin ekranınızı görmesini sağlayan küçük bir Windows programıdır. Kurulum gerektirmez,
yönetici şifresi sormaz, bilgisayarınızda iz bırakmaz (istisnalar: bkz. "Bilgisayarımda ne kalır?"). Program
kapandığında hiçbir parçası çalışmaya devam etmez. Tek istisna, sizin açıkça açtığınız **Tepside çalıştır** seçeneğidir
(0.12 ve sonrası; bkz. "Program tepside çalışsın ve Windows açılınca başlasın mı?"); bu durumda saatin yanında Nokta
Destek simgesi her zaman görünür.

**Ne gerekir?**

- Windows 10 veya Windows 11 yüklü bir bilgisayar.
- İnternet bağlantısı.
- Teknisyeninizin size gönderdiği **destek bağlantısı** veya **8 haneli destek kodu**; ya da firmanızın verdiği
  **firma bağlantısı** (bkz. "Teknisyeni beklemeden destek isteyebilir miyim?").
- Telefonda teknisyeninizle görüşüyor olmanız (kodları birbirinize okuyacaksınız).

**Teknisyen neler yapabilir?**

- Ekranınızı **görebilir**.
- **Siz izin verirseniz** fare ve klavyenizi kullanabilir. İzni her istediğinizde tek tıkla veya bir tuş kombinasyonuyla
  geri alırsınız (bkz. "Teknisyen bilgisayarımı kullanmak isterse").
- Sizinle yazışabilir (sohbet). Sohbet kayıt altına alınır. Hızlı Destek 0.21 ve sonrasında sohbet açıktır; 0.20 ve
  öncesinde kapalıdır (bkz. "Oturum sohbeti ve kaydı").
- Ekranınızın üzerine geçici çizimler yapabilir (ok, kalem, dikdörtgen, kısa süreli lazer noktası). Bu çizimler
  tıklamanızı engellemez.
- Size dosya gönderebilir. Her dosyayı siz onaylarsınız.

**Bilmeniz gerekenler**

- Programın yeni sürümünde (0.8 ve sonrası) teknisyen **fare imlecinizi görür**; bir yeri imleçle gösterebilirsiniz.
  Eski sürümde imleç görünmez; o zaman yeri sohbette yazın veya telefonda tarif edin.
- Karşılama penceresinin sağ üstünde destek veren firmanın logosu görünür; firma logo yüklemediyse sistem logosu (Nokta
  Bilişim) görünür. Firma adı ve teknisyen adı yazı olarak da gösterilir.
- Program sizden teknisyene dosya göndermez; yalnız teknisyenden dosya alır.

### Nasıl indiririm?

1. Teknisyeninizin gönderdiği destek bağlantısını Windows bilgisayarınızda tarayıcıyla açın.
2. "Nasıl bağlanmak istersiniz?" bölümünde **Hızlı Destek uygulamasını indir** düğmesine tıklayın.
3. Sayfada "İndirme başladı" yazar. Dosya tarayıcınızın indirilenler bölümüne `Destek-` ile başlayan bir adla
   kaydedilir (ör. `Destek-48291376.exe`). Dosya adındaki 8 rakam sizin destek kodunuzdur.

Düğme görünmüyorsa:

- Bağlantıyı telefon, tablet ya da desteklenmeyen bir bilgisayarda açmış olabilirsiniz. Hızlı Destek Windows'ta, Mac'te
  ve Ubuntu Linux'ta (22.04 / 24.04, x86_64) çalışır (bkz. "Müşteri için: Hızlı Destek uygulaması (macOS)" ve "Müşteri
  için: Hızlı Destek uygulaması (Linux)").
- Sayfada "Hızlı Destek şu anda indirilemiyor" yazıyorsa **Tarayıcıdan devam et** düğmesiyle devam edin. Bu yolda
  teknisyen ekranınızı yine görür.
- "Çok fazla indirme denemesi yapıldı" yazıyorsa belirtilen süre kadar bekleyin.

Teknisyeniniz size dosyayı başka bir yolla verdiyse (ör. `NoktaDestek.exe`), program açılınca 8 haneli kodu sorar.
Kodu teknisyeninizden alıp yazın ve **Devam**'a tıklayın. Kodu boşluklu (`4829 1376`) veya tireli (`4829-1376`)
yazabilirsiniz.

### Windows uyarı verirse ne yapmalıyım? (SmartScreen)

Hızlı Destek imza sertifikası olmadan dağıtılır. Bu yüzden Windows ilk açılışta mavi bir uyarı gösterebilir.

1. İndirilen `Destek-….exe` dosyasını açın (tarayıcının altında veya sağ üstünde görünür).
2. "**Windows bilgisayarınızı korudu**" penceresinde **Ek bilgi** yazısına tıklayın.
3. "Yayımcı: Bilinmeyen yayımcı" satırını ve dosya adının `Destek-` ile başladığını kontrol edin.
4. **Yine de çalıştır** düğmesine tıklayın.

Program yönetici izni istemez. "Bu uygulamanın cihazınızda değişiklik yapmasına izin vermek istiyor musunuz?" gibi
bir soru çıkarsa **Hayır** deyin ve teknisyeninizi arayın; bu bizim programımız değildir.

Şirketinizin güvenlik yazılımı programı engelliyorsa destek sayfasına dönün ve **Uygulama çalışmıyor mu? Tarayıcıdan
yalnızca görüntü paylaş** seçeneğini kullanın.

### Doğru programla mı bağlanıyorum? (sunucu, sürüm, parmak izi)

Program açıldığında **Nokta Destek — Karşılama** penceresi gelir. Devam etmeden önce şunları kontrol edin:

| Ne görürsünüz                                 | Ne kontrol edersiniz                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Teknisyen:** ad                             | Telefondaki kişinin adıyla aynı mı?                                                      |
| **Teknisyen doğrulama kodu**                  | Teknisyen bu kodu telefonda size söylemeli. Söyleyemiyorsa veya farklıysa devam etmeyin. |
| **Bağlanılan sunucu:** adres                  | Destek sayfasındaki adresle aynı olmalı. Farklıysa pencereyi kapatın.                    |
| En alt satır: **Sunucu · Sürüm · Parmak izi** | Programın kimlik bilgisi. Şirketinizin BT sorumlusu isterse bu bilgiyi verin.            |

**Sürüm pencere başlığında da yazar** (Hızlı Destek 0.20 ve sonrası; Windows, Mac ve Linux): her pencerenin başlığı
programın sürümüyle başlar, ör. **"Nokta Destek 0.20.0 — Oturum"**. Windows'ta tepsi simgesinin ipucunda da sürüm
görünür. Teknisyen ya da BT sorumlusu sürümü sorarsa başlığa bakmanız yeter. Test sunucusundan indirilen Linux
programında başlığın sonunda " — TEST" yazar.

**Parmak izi nedir?** Program dosyasının 8 karakterlik özetidir (ör. `471023c7`). Dosyada tek bir bayt değişse bile
farklı çıkar. BT sorumlusu bunu GitHub sürüm sayfasındaki `SHA256SUMS` dosyasında aynı sürüme ait satırın ilk 8
karakteriyle karşılaştırabilir. Eşleşmiyorsa programı çalıştırmayın.

Pencerede kırmızı bir uyarı da vardır: **"Sizi biz aramadıysak devam etmeyin."** Sizi kendiliğinden arayıp bu programı
çalıştırmanızı isteyen biri varsa pencereyi kapatın. Teknisyenlerimiz şifrenizi hiçbir zaman sormaz; oturum sırasında
banka veya şifre işlemi yapmayın. Pencerede **Kötüye kullanımı bildir** düğmesi varsa şüpheli durumu e-postayla
bildirebilirsiniz.

### KVKK onayı ve bağlanma

1. **Aydınlatma metni** kutusundaki metni okuyun (kutu kaydırılabilir).
2. **Adınız ve soyadınız** alanına adınızı yazın. Teknisyen sizi bu adla görür.
3. "Aydınlatma metnini okudum; ekran görüntümün bu oturum boyunca teknisyenle paylaşılmasını kabul ediyorum." kutusunu
   işaretleyin.
4. **Bağlan** düğmesinin hemen üstündeki "Sohbet mesajları kayıt altına alınır ve N gün saklanır" satırını okuyun
   (Hızlı Destek 0.21 ve sonrası). N, firmanızın saklama süresidir.
5. **Bağlan** düğmesine tıklayın. Ad yazılmadan, kutu işaretlenmeden ve saklama satırı görünmeden bu düğme çalışmaz.

Saklama satırının yerinde kırmızı "Sunucu güncel değil; lütfen daha sonra deneyin" yazıyorsa **Bağlan** pasif kalır.
Firmanızın sunucusu bu sürümü henüz desteklemiyor. Teknisyeninizi arayıp durumu söyleyin.

Vazgeçmek isterseniz **Vazgeç**'e tıklayın; ekranınız paylaşılmaz.

### Teknisyen kabulü (bekleme odası)

**Teknisyen onayı bekleniyor** penceresinde büyük harflerle 4 haneli bir **kabul kodu** görürsünüz.

1. Bu kodu telefonda teknisyeninize okuyun. Kodu yalnız sizi aradığını bildiğiniz teknisyene söyleyin.
2. Teknisyen kodu girince pencere kendiliğinden kapanır ve bağlantı başlar.

- Vazgeçmek için **Vazgeç ve çık**'a tıklayın.
- 5 dakika içinde kabul edilmezseniz "Bekleme süresi doldu" yazar. Destek kodu hâlâ geçerliyse programı yeniden açın.
- Teknisyen bağlantıyı reddederse "Teknisyen bağlantıyı reddetti" yazar. Kodu doğru okuduğunuzdan emin olun ve
  teknisyeninizi arayın.

### Ekran seçimi ve oturum

Bilgisayarınıza birden fazla monitör bağlıysa **Teknisyenle paylaşılacak ekranı seçin** penceresi açılır. Birincil
ekran seçili gelir. İstediğiniz ekranı seçip **Paylaş**'a tıklayın. Tek monitörde bu soru sorulmaz (Hızlı Destek 0.11 ve
sonrasında Windows pencere paylaşımını destekliyorsa tek monitörde de sorulur; bkz. aşağıdaki bölüm).

Windows'unuz koyu modda ise (Ayarlar → Kişiselleştirme → Renkler → "Varsayılan uygulama modunuzu seçin": Koyu) Hızlı
Destek 0.11 ve sonrası pencerelerini koyu renkte gösterir. Yüksek karşıtlık açıksa sizin renkleriniz korunur.

Paylaşım başlayınca:

- Paylaşılan ekranın kenarında **kırmızı bir çerçeve** ve üstte **"Ekranınız izleniyor — <teknisyen adı>"** yazısı
  görünür. Bu çerçeve oturum boyunca hep en üstte kalır; teknisyenin görüntüsünde görünmez.
- **Nokta Destek — Oturum** penceresi açılır. Burada bağlantı durumu, sohbet ve **Oturumu bitir** düğmesi bulunur.
- **Sohbet (Hızlı Destek 0.21 ve sonrası):** pencerede **Sohbet** bölümü ve yanında "Sohbet kayıt altına alınır" notu
  bulunur. Mesajınızı yazıp **Gönder**'e ya da Enter'a basın (bkz. "Hızlı Destek'te oturum sohbeti").
- **Sohbet (Hızlı Destek 0.20 ve öncesi):** oturum sohbeti kapalıdır; sohbet kutusunda "Bu sürümde sohbet kapalıdır…"
  mesajı görünür ve yazdıklarınız teknisyene ulaşmaz. Programı destek sayfasından yeniden indirin, teknisyeninizle
  telefonda konuşun ya da tarayıcıdan bağlanın (bkz. "Oturum sohbeti ve kaydı").
- İnternet kısa süre koparsa "Bağlantı koptu, yeniden bağlanılıyor…" yazar. Program 2 dakika içinde kendiliğinden
  yeniden bağlanır; bir şey yapmanız gerekmez.
- Oturumun bitmesine 5 dakika kala durum satırında uyarı çıkar.

### Yalnız bir pencereyi paylaşma (Hızlı Destek 0.11 ve sonrası)

Teknisyenin bütün ekranınızı değil yalnız bir programı (ör. hata veren muhasebe programı) görmesini istiyorsanız bunu
kullanın. Seçenek, Windows'unuz pencere paylaşımını destekliyorsa görünür (Windows 10'un güncel sürümleri ve Windows 11).

**Nasıl yalnız bir pencere paylaşırım?**

1. Paylaşım başlarken **Teknisyenle neyi paylaşmak istiyorsunuz?** penceresi açılır. **Tüm ekran** seçili gelir.
2. **Yalnız bir pencere**'yi seçin. Altındaki listede açık pencereleriniz başlıklarıyla görünür. Küçültülmüş pencerelerin
   yanında "(simge durumunda)" yazar.
3. Paylaşmak istediğiniz pencereyi seçin. Yeni açtığınız bir program listede yoksa **Listeyi yenile**'ye tıklayın.
4. **Paylaş**'a tıklayın. Ekranın üstündeki yazı **"Paylaştığınız pencere izleniyor — <teknisyen adı>"** olur.

Listede Nokta Destek'in kendi pencereleri, masaüstü, görev çubuğu ve başka sanal masaüstündeki pencereler görünmez.

**Ne olur?**

- Teknisyen yalnız seçtiğiniz pencerenin içini görür. Başka pencereler, masaüstü ve bildirimler görüntüye girmez.
- Uzaktan kontrol izni verirseniz teknisyenin faresi ve klavyesi **yalnız bu pencerede** çalışır:
  - Pencerenin üstüne başka bir pencere gelmişse, teknisyenin o bölgedeki tıklaması hiçbir yere gitmez.
  - Teknisyen yazı yazdığında harfler yalnız bu pencere öndeyken gider. Siz başka bir programa geçerseniz teknisyenin
    yazdıkları o programa **gitmez** ve sonradan da yazılmaz.
  - Paylaşılan programın kendi menüleri ve "Farklı kaydet" gibi pencereleri fareyle kullanılabilir. Bu küçük pencereler
    öndeyken teknisyenin klavyesi çalışmaz; gerekirse yazıyı siz yazın.
- Pencere modunda teknisyenin **Windows kısayolları çalışmaz**: Windows tuşu (Başlat menüsü, Win+R "Çalıştır", Win+E,
  Win+D), Alt+Tab ile pencere değiştirme, Ctrl+Esc, Ctrl+Shift+Esc (Görev Yöneticisi) ve Print Screen etkisizdir. Ctrl+C,
  Ctrl+V ve normal yazı çalışır; Alt+F4 paylaşılan pencereyi kapatır.
- Bilgisayarınızda **Yapışkan Tuşlar** veya **Fare Tuşları** açıksa, bunlarla kısayol oluşturabilecek tuşlar da (ör. tek
  başına basılan Ctrl ardından Esc, sayısal tuş takımı) teknisyenden gelmez. Teknisyen rakam için klavyenin üst sırasını
  kullanır.
- Ekrana çizim (işaretleme) ve ekran değiştirme pencere modunda yoktur.

> **Dikkat:** Paylaştığınız pencerenin içinden başka programlar açılabilir (ör. Dosya Gezgini, tarayıcı). Teknisyen o
> pencerede bir programı başlatırsa, yeni program paylaşılan pencerenin dışında açılır; teknisyen onu görmez ama siz
> görürsünüz. Seçim penceresinde de bu uyarı yazılıdır. Yalnız ihtiyaç olan programı paylaşın; beklemediğiniz bir şey
> açılırsa **Kontrolü kapat**'a tıklayın veya Ctrl+Shift+F12'ye basın.

**Pencereyi küçültürsem veya kapatırsam?**

- **Küçültürseniz:** teknisyen siyah bir ekran ve "Pencere simge durumunda" yazısı görür; bu sırada fare ve klavyesi hiçbir
  şey yapamaz. Pencereyi geri açtığınızda görüntü ve kontrol kendiliğinden döner.
- **Kapatırsanız:** paylaşım durur. Durum satırında "Ekran görüntüsü alınamadı (WINDOW_CLOSED). Paylaşılan pencere kapandı;
  oturumu bitirip yeniden başlatın." yazar. Program kendiliğinden tüm ekranı paylaşmaya **geçmez**. Devam etmek için
  oturumu bitirip teknisyeninizin verdiği kodla yeniden bağlanın.
- **Taşır veya boyutunu değiştirirseniz:** görüntü yeni boyuta uyar, kontrol doğru yere düşmeye devam eder.

### Teknisyen dosya gönderirse

Teknisyen size dosya göndermek istediğinde **Dosya teklifi** penceresi açılır. Dosyanın adı ve boyutu yazar.

1. Dosyayı bekliyor musunuz? Beklemiyorsanız **Reddet**'e tıklayın. Enter'a basmak da reddeder.
2. Bekliyorsanız fareyle **Kabul et**'e tıklayın. Bu düğme yanlışlıkla basılmasın diye ilk 1,5 saniye çalışmaz.
3. Dosya **İndirilenler** klasörünüze kaydedilir. Aynı adda bir dosya varsa eskisi silinmez; yenisi `(1)` ekiyle kaydedilir.

**Uyarılara dikkat edin:**

- **"Dikkat: Bu dosya türü bilgisayarınızda program çalıştırabilir."** Dosya bir program veya betiktir (ör. `.exe`,
  `.bat`). Yalnız beklediğiniz bir dosyaysa kabul edin.
- **"Dikkat: Dosya adı çift uzantılı; gerçek türü gizleniyor olabilir."** Örnek: `fatura.pdf.exe`. Bu bir belge gibi
  görünen programdır. Beklemediğiniz bir dosyaysa reddedin.

Diğer durumlar:

- Bir dosyayı reddettikten sonraki 30 saniye içinde gelen yeni teklifler kendiliğinden reddedilir.
- Aktarım sürerken **Aktarımı iptal et** ile durdurabilirsiniz; yarım dosya silinir.
- "Dosya bozuk; silindi" yazarsa dosya yolda bozulmuştur; teknisyenden yeniden göndermesini isteyin.
- "Dosya kaydedilmedi … güvenlik işareti yazılamıyor" yazarsa İndirilenler klasörünüz bir USB bellekte veya benzeri
  bir sürücüdedir; program çalıştırabilen dosyalar bu durumda kaydedilmez. Teknisyeninize söyleyin.
- Kaydedilen dosyalar Windows'ta "internetten indirildi" olarak işaretlenir. Açarken Windows ek bir uyarı gösterebilir.

### Firmanız dosyaları sunucuda tarıyorsa (Hızlı Destek 0.14 ve sonrası)

Bazı firmalar dosyaları doğrudan değil, kendi sunucuları üzerinden ve virüs taramasıyla gönderir. Bu durumda dosya
alanının üstünde şu satır görünür:

> Dosyalar sunucuda virüs taramasından geçer; bu modda uçtan uca şifreli değildir

Ne değişir?

1. Teknisyen dosya gönderince önce "Virüs taraması yapılıyor" yazar. Bu birkaç saniye ile en çok bir dakika sürer.
2. Dosya temiz çıkarsa her zamanki **Dosya teklifi** penceresi açılır (yukarıdaki adımlar ve uyarılar aynen geçerlidir).
3. Dosya virüslü çıkarsa size hiç gelmez. Ekranda "Dosya virüslü bulundu (<virüs adı>), teslim edilmedi" yazar.
4. Dosya taranamazsa yine gelmez: "Dosya taranamadı, teslim edilmedi: <neden>". Örneğin parolalı bir zip dosyası
   taranamaz; teknisyenden dosyayı parolasız göndermesini isteyin.

Bilmeniz gerekenler:

- Teslim aldığınız dosya, firmanın belirlediği süre (1–7 gün) boyunca sunucuda şifreli saklanır, sonra silinir.
  Reddettiğiniz dosya hemen silinir.
- Windows programında bu modda **yalnız dosya alırsınız**; programdan teknisyene dosya gönderme düğmesi yoktur.
  Tarayıcıyla bağlandıysanız dosya gönderebilirsiniz; gönderdiğiniz dosya da önce taranır, durumu satırda görünür
  ("Yükleniyor %…", "Virüs taraması yapılıyor", "Teknisyenin onayı bekleniyor", "Teslim edildi").
- Uzaktan yazdırılan belge de taramadan geçer; yazdırıldıktan sonra sunucuda saklanmaz.
- Pano paylaşımındaki metin ve teknisyenin bilgisayarınızda kendisinin indirdiği dosyalar bu taramanın kapsamında değildir.
- Programınız 0.14'ten eskiyse bu firmada dosya ve yazdırma çalışmaz. Teknisyen size güncel sürümü indirmenizi söyler.

### Tarayıcıda büyük dosya alırken (müşteri sayfası ve teknisyen konsolu)

Hızlı Destek yerine tarayıcıyla bağlandıysanız dosya teklifi tarayıcı sayfasında görünür. Dosya **256 MB'tan büyükse**
ve tarayıcınız (Chrome, Edge) dosyayı doğrudan diske yazabiliyorsa, **Kabul et**'e basmadan önce şu uyarı çıkar:

> Büyük dosya: kabul edince kaydedileceği yer sorulur ve dosya doğrudan diske yazılır.
> **Var olan bir dosyanın üzerine yazmayın; aktarım bozulursa dosya boş kalabilir. Yeni bir dosya adı seçin.**

1. Uyarıyı okuyun ve **Kabul et**'e basın.
2. Açılan kaydetme penceresinde **yeni bir dosya adı** yazın. Var olan bir dosyayı seçmeyin: tarayıcı o dosyayı hemen
   boşaltır, aktarım yarıda kalırsa eski içerik de kaybolur.

Tarayıcınız diske doğrudan yazamıyorsa (ör. Firefox, Safari) dosya bellekte tutulur; çok büyük dosyada sekme
kapanabilir. Mümkünse Chrome veya Edge kullanın.

### Teknisyen bilgisayarımı kullanmak isterse (uzaktan kontrol)

Teknisyen fare ve klavyenizi kullanmak isterse ekranınızda **Uzaktan kontrol isteği** penceresi açılır. Pencerede
teknisyenin adı ve kontrolü nasıl kapatacağınız yazar. Siz izin vermeden teknisyen hiçbir şeye tıklayamaz, yazamaz.

**İzin vermek için**

1. Pencereyi okuyun. İsteği beklemiyorsanız **Reddet**'e tıklayın. Enter'a basmak da reddeder.
2. Bekliyorsanız **kendi farenizle** **İzin ver**'e tıklayın. Bu düğme yanlışlıkla basılmasın diye ilk **1,5 saniye**
   çalışmaz. Klavyeyle Alt+İ de kullanılabilir.
3. İzin verince ekranın üstündeki yazı **"Uzaktan kontrol aktif — <teknisyen adı>"** olur.

Güvenliğiniz için:

- Pencere fare imlecinizin hemen altında açılmaz; istemeden tıklamazsınız.
- Teknisyenin uzaktan yaptığı tıklama bu pencerede **sayılmaz**. İzni yalnız siz verebilirsiniz. Uzak bağlantı
  (TeamViewer, Uzak Masaüstü vb.) üzerinden de izin verilemez; böyle bir tıklamada pencerede kırmızı bir uyarı çıkar,
  pencere açık kalır ve izni bu bilgisayarın kendi faresi veya klavyesiyle vermeniz gerekir.
- Pencereyi kaçırdıysanız **Nokta Destek — Oturum** penceresindeki **Erişime izin ver** düğmesi isteği yeniden öne
  getirir. Bu düğme tek başına izin vermez.
- Reddettikten sonraki 30 saniye içinde yeni istek gelmez. Teknisyen bir oturumda en çok 5 kez istek gönderebilir.

**Kontrolü geri almak için** (istediğiniz an)

- Oturum penceresinde **Kontrolü kapat**'a tıklayın, **veya**
- Klavyede **Ctrl+Shift+F12**'ye basın. Hangi pencere önde olursa olsun çalışır. Bu kombinasyonu başka bir program
  kullanıyorsa yerine **Ctrl+Shift+F11** atanır. Hangisinin geçerli olduğu oturum penceresinde "Uzaktan kontrolü
  anında kapatmak için: …" satırında yazar.
- Kendi farenizi veya klavyenizi kullandığınızda teknisyenin hareketi yaklaşık 1 saniye durur. Bilgisayar her zaman
  önce sizi dinler.

Kontrol kapanınca üstteki yazı yeniden **"Ekranınız izleniyor — <teknisyen adı>"** olur.

**Teknisyen başka bir ekranı görmek isterse:** birden fazla monitörünüz varsa **Ekran değiştirme isteği** penceresi
açılır. Kurallar aynıdır: Reddet varsayılandır, İzin ver 1,5 saniye sonra çalışır. İzin verirseniz teknisyen o
ekrandaki her şeyi görür.

**Oturum penceresinde görebileceğiniz mesajlar**

| Mesaj                                                    | Anlamı                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| Teknisyen kontrolü bıraktı                               | Teknisyen işini bitirdi; fare ve klavye yeniden yalnız sizde.       |
| Teknisyen isteği geri çekti                              | Teknisyen isteğinden vazgeçti; açık olan izin penceresi kapandı.    |
| Uzaktan kontrol kapatıldı.                               | Kontrolü siz kapattınız.                                            |
| Uzaktan kontrol sunucu tarafından kapatıldı.             | Sistem kontrolü kapattı (ör. teknisyenin yetkisi kaldırıldı).       |
| Teknisyenin bağlantısı koptu — uzaktan kontrol kapatıldı | Teknisyenin bağlantısı gitti; kontrol güvenlik için kapandı.        |
| Seçilen ekran paylaşılamadı; önceki ekran paylaşılıyor.  | Yeni ekrana geçilemedi; teknisyen önceki ekranı görmeye devam eder. |

İnternet koparsa kontrol kendiliğinden kapanır. Bağlantı geri geldiğinde teknisyen yalnız ekranı görür; kontrol için
yeniden izin istemesi gerekir.

**Kırmızı uyarılar**

- **"Kontrolü kapatma kısayolu kaydedilemedi … uzaktan kontrol izni verilemez."** Başka programlar iki kısayolu da
  kullanıyor. Güvenliğiniz için bu durumda izin düğmesi hiç çalışmaz. Teknisyen ekranınızı görmeye devam edebilir.
- **"Dikkat: Bu program yönetici olarak çalışıyor …"** Programı "Yönetici olarak çalıştır" ile açtınız. Bu durumda
  teknisyen yönetici onayı isteyen pencereleri de kullanabilir. Gerekmiyorsa oturumu bitirip programı normal açın.

### Teknisyenle pano paylaşımı (Hızlı Destek 0.13 ve sonrası)

Teknisyen uzun bir komutu veya lisans anahtarını panonuza koyabilir ya da panonuzdaki bir metni (ör. hata mesajı) alabilir.
Böylece metni telefonda harf harf okumanız gerekmez. Yalnız **düz metin** aktarılır (en çok 64 KB); dosya, resim ve biçimli
metin aktarılmaz. Bu özellik yalnız Hızlı Destek programıyla çalışır; tarayıcıdan bağlandıysanız yoktur.

**Pano paylaşımını açmak için**

1. Önce teknisyene uzaktan kontrol izni verin (bkz. "Teknisyen bilgisayarımı kullanmak isterse"). Kontrol izni yokken
   pano kutusu pasiftir.
2. **Nokta Destek — Oturum** penceresinde **Pano paylaşımına izin ver** kutusunu **kendi farenizle** veya klavyeyle
   (Boşluk tuşu) işaretleyin. Teknisyenin uzaktan tıklaması bu kutuyu değiştirmez.
3. Teknisyen panonuza metin koyduğunda ekranın üstündeki yazının altında 3 saniye **"Teknisyen panonuza metin koydu"**,
   panonuzu okuduğunda **"Teknisyen panonuzu okudu"** yazar.

Kutu **her oturumda kapalı başlar**. Uzaktan kontrolü kapattığınızda (düğme veya Ctrl+Shift+F12), bağlantı koptuğunda veya
oturum bittiğinde kendiliğinden kapanır. İstediğiniz an işaretini kaldırarak da kapatabilirsiniz.

**Bilmeniz gerekenler**

- Pano düğmeleri yalnız izninizle çalışır. Ancak kontrol verdiğiniz teknisyen ekranınızda gördüğünüz her şeyi görebilir;
  panonuzda başkasının görmemesi gereken bir şey varsa kutuyu açmadan önce panonuza başka bir şey kopyalayın.
- Parola yöneticinizin "gizli" olarak işaretlediği içerik (ör. kopyalanan parola) okunmaz ve teknisyene gitmez; teknisyen
  "Pano içeriği gizli olarak işaretli, aktarılmadı" görür.
- Teknisyenin koyduğu metin oturum bittikten sonra da panonuzda kalır (yapıştırabilmeniz için). Windows pano geçmişine
  (Win+V) ve bulut panosuna düşmez. İsterseniz başka bir şey kopyalayarak silebilirsiniz.
- Teknisyenin panonuza koyduğu metni **komut satırına körlemesine yapıştırmayın**; ne yaptığını bilmiyorsanız önce
  okuyun veya teknisyene sorun.

### Teknisyen belge yazdırmak isterse (uzaktan yazdırma, Hızlı Destek 0.13 ve sonrası)

Teknisyen bir PDF belgeyi (ör. form, kurulum talimatı) sizin **varsayılan yazıcınızdan** bastırabilir. Her belge için ayrı
onayınız istenir. Bu özellik yalnız Hızlı Destek programıyla ve teknisyen uzaktan kontroldeyken çalışır.

1. Ekranda **Uzaktan yazdırma** penceresi açılır: "<teknisyen adı> bir belgeyi yazıcınıza göndermek istiyor". Altında
   **dosya adı**, **sayfa sayısı**, **yazıcınızın adı**, boyut ve kalan süre yazar.
2. Belgeyi bekliyor musunuz? Beklemiyorsanız **Reddet**'e tıklayın. Enter'a basmak da reddeder.
3. Bekliyorsanız **kendi farenizle** **Yazdır**'a tıklayın. Bu düğme yanlışlıkla basılmasın diye ilk 1,5 saniye çalışmaz.
   Teknisyenin uzaktan tıklaması sayılmaz.
4. Belge yazıcıya tek kopya gider; ekranın üstünde 3 saniye **"Belge yazıcıya gönderildi"** yazar.

Diğer durumlar:

- **60 saniye** yanıt vermezseniz istek reddedilmiş sayılır. Reddettiğiniz veya yanıtsız bıraktığınız istekten sonra
  30 saniye yeni istek gelmez. Bir oturumda en çok 20 yazdırma isteği gelebilir.
- Uzaktan kontrolü kapatırsanız bekleyen yazdırma iptal olur ve oturum penceresinde "Uzaktan kontrol kapandı; yazdırma
  iptal edildi." yazar.
- Bilgisayarınızda varsayılan yazıcı yoksa pencere hiç açılmaz; teknisyen "Müşterinin varsayılan yazıcısı yok" görür.
  Varsayılan yazıcı seçmek için: **Ayarlar → Bluetooth ve cihazlar → Yazıcılar ve tarayıcılar**.
- Varsayılan yazıcınız **Microsoft Print to PDF** ise Windows "Farklı kaydet" penceresi açar; belgeyi nereye
  kaydedeceğinizi siz seçersiniz.
- Belge yalnız bellekte tutulur, diskinize kaydedilmez ve iş bitince silinir. Belgede gömülü komut veya bağlantı varsa
  çalıştırılmaz. Windows'un yazdırma kuyruğunda iş bir süre **"NoktaDestek uzaktan yazdırma"** adıyla görünebilir; bu
  Windows'un kaydıdır, dosya adı yazmaz.

### Oturumu kapatma

- **Oturumu bitir** düğmesine tıklayın. Teknisyen ekranınızı artık göremez ve program birkaç saniye içinde kendiliğinden
  kapanır.
- Pencerenin sağ üstündeki **X** ile kapatırsanız program "Oturumu bitirmek istiyor musunuz?" diye sorar. **Evet**
  derseniz oturum biter.
- Teknisyen oturumu bitirdiğinde de "Destek oturumu sona erdi" yazar ve program birkaç saniye içinde kapanır.
- Program kapandıktan sonra bilgisayarınızda çalışmaya devam eden bir parçası kalmaz. İsterseniz `Destek-….exe`
  dosyasını İndirilenler klasöründen silebilirsiniz; bir sonraki destekte yeni bağlantıyla yeniden indirilir.

### Sık karşılaşılan mesajlar

| Mesaj                                                                | Ne yapmalı                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kod 8 rakamdan oluşmalıdır.                                          | Kodu eksiksiz yazın (yalnız rakam).                                                                                                                                                                                                           |
| Kod geçersiz                                                         | Kodu teknisyeninizden kontrol edip yeniden girin.                                                                                                                                                                                             |
| Bu destek bağlantısının süresi doldu                                 | Bağlantılar kısa süre geçerlidir. Teknisyeninizden yenisini isteyin.                                                                                                                                                                          |
| Bu bağlantı zaten kullanıldı                                         | Her bağlantı bir kez kullanılır. Teknisyeninizden yenisini isteyin.                                                                                                                                                                           |
| Oturum iptal edildi                                                  | Teknisyen oturumu iptal etti. Gerekirse yeni bağlantı isteyin.                                                                                                                                                                                |
| Çok fazla deneme                                                     | Birkaç dakika bekleyip tekrar deneyin.                                                                                                                                                                                                        |
| Sunucuya ulaşılamıyor                                                | İnternet bağlantınızı kontrol edip tekrar deneyin.                                                                                                                                                                                            |
| Bekleme odası dolu                                                   | Birkaç dakika sonra tekrar deneyin.                                                                                                                                                                                                           |
| Sayfanın süresi doldu; bilgiler yenilendi. Lütfen yeniden onaylayın. | Adınızı ve onay kutusunu yeniden kontrol edip **Bağlan**'a tıklayın.                                                                                                                                                                          |
| Sunucu güncel değil; lütfen daha sonra deneyin                       | Hızlı Destek 0.21 güncellenmemiş bir sunucuya bağlanıyor; **Bağlan** pasif kalır. Teknisyeninizi arayın.                                                                                                                                      |
| Ekran görüntüsü alınamadı (KOD). …                                   | Parantez içindeki kodu teknisyeninize okuyun; bkz. "Ekran görüntüsü alınamadı yazıyor". Sohbet ve dosya yine çalışır.                                                                                                                         |
| Ekran görüntüsü alınamadı; teknisyen ekranınızı göremiyor.           | Eski sürüm (0.10.1 ve öncesi) bu metni kodsuz gösterir. Teknisyeninize söyleyin; Windows "N" sürümlerinde Media Feature Pack gerekir.                                                                                                         |
| Bağlantı kesildi                                                     | İnternetinizi kontrol edin. Kod hâlâ geçerliyse programı yeniden açın.                                                                                                                                                                        |
| Bu program hatalı derlenmiş (sunucu adresi yok).                     | Dosya bozuk veya yanlış. Teknisyeninizden yeni bir indirme bağlantısı isteyin.                                                                                                                                                                |
| Program dosyası okunamadı.                                           | Dosyayı yeniden indirip tekrar deneyin.                                                                                                                                                                                                       |
| İzin ver düğmesi çalışmıyor                                          | İlk 1,5 saniye beklenir; sonra kendi farenizle tıklayın. Kırmızı "kısayol kaydedilemedi" uyarısı varsa izin verilemez. "Bu tıklama uzak bağlantı … kabul edilmedi" uyarısı çıktıysa bilgisayarın başındaki kişi kendi faresiyle tıklamalıdır. |
| Teknisyen tıklıyor ama bir pencerede hiçbir şey olmuyor              | O pencere yönetici yetkisiyle açılmış olabilir (ör. yönetici komut istemi). Teknisyen bunu konsolda görür; gerekirse işlemi siz yapın.                                                                                                        |
| Windows onay ekranı (UAC) açıkken teknisyen ekranı göremiyor         | Bu ekran güvenlik gereği paylaşılmaz. Onayı siz verin; görüntü kendiliğinden geri gelir.                                                                                                                                                      |
| Pano paylaşımına izin ver kutusu pasif                               | Önce teknisyene uzaktan kontrol izni verin; kutu yalnız kontrol açıkken işaretlenir.                                                                                                                                                          |
| Pano kutusu kendiliğinden kapandı                                    | Uzaktan kontrol kapandı, bağlantı koptu veya oturum bitti. Gerekirse kontrol iznini yeniden verip kutuyu yeniden işaretleyin.                                                                                                                 |
| Uzaktan kontrol kapandı; yazdırma iptal edildi.                      | Kontrolü kapattığınız için bekleyen yazdırma durdu. Teknisyen kontrolü yeniden alıp belgeyi yeniden gönderebilir.                                                                                                                             |

### Teknisyeni beklemeden destek isteyebilir miyim? ("Destek iste")

Evet. Firmanız size kendi **firma bağlantısını** verdiyse, teknisyenden kod beklemeden talep gönderebilirsiniz.
Bu bağlantıdan Windows'ta inen dosyanın adı `NoktaDestek-<firma adı>-…exe` biçimindedir (ör. `NoktaDestek-Acme-k3pqxr2mab4cde7f.exe`).
Bu özellik Windows'ta Hızlı Destek **0.9.0**, Mac'te **0.24.0** ve sonrasında vardır. Aynı bağlantıyı Mac'te açarsanız
`.zip` iner; Mac adımları bu bölümün sonundaki "Mac'te nasıl destek isterim?" alt başlığındadır. Aşağıdaki adımlar
Windows içindir.

**Nasıl destek isterim?**

1. Firma dosyasını çift tıklayarak açın. Windows uyarı verirse "Windows uyarı verirse ne yapmalıyım?" bölümündeki
   adımları izleyin. Birkaç saniye içinde **Nokta Destek — <firma adı>** penceresi açılır.
2. Pencerenin üstünde firmanızın adını kontrol edin. Ad, firmanızın sunucusundan gelir. Tanımadığınız bir ad
   görürseniz pencereyi kapatın. Kırmızı uyarıyı okuyun: sizi kendiliğinden arayan biri bu programı açmanızı
   istediyse kapatın; teknisyenlerimiz şifrenizi hiçbir zaman sormaz.
3. Formu doldurun:
   - **Ad soyad:** en az 2 karakter.
   - **Telefon:** sizi arayabilecekleri numara (ör. `0532 123 45 67` veya `+90 532 123 45 67`). Yurt dışı numarası da
     yazılabilir.
   - **E-posta (isteğe bağlı):** boş bırakabilirsiniz.
   - **Sorununuz:** en az 10, en çok 500 karakter. Ne olduğunu kısaca yazın.
4. **Aydınlatma metni** kutusunu okuyun (kaydırılabilir). Altındaki "Aydınlatma metnini okudum; bilgilerimin destek
   talebi için işlenmesini kabul ediyorum. Ekran paylaşımı için teknisyen bağlanırken ayrıca onay istenir." kutusunu
   işaretleyin. Hızlı Destek 0.21 ve sonrasında **Destek iste** düğmesinin hemen üstünde "Sohbet mesajları kayıt altına
   alınır ve N gün saklanır" satırı yazar. Bu satırın yerinde "Sunucu güncel değil; lütfen daha sonra deneyin" yazıyorsa
   **Destek iste** pasif kalır ve talep gönderilmez; firmanızı telefonla arayın.
5. **Destek iste**'ye tıklayın veya Enter'a basın. Eksik ya da hatalı bir alan varsa alanın altında kırmızı bir yazı
   çıkar ve imleç o alana gider; düzeltip yeniden gönderin.
6. **Talebiniz iletildi** ekranı açılır. Ekranda büyük harflerle 6 haneli bir **talep kodu** (ör. `123 456`),
   "Sırada 2. talepsiniz" gibi sıranız ve bekleme süreniz görünür.
7. Teknisyen sizi telefonla arar ve talep kodunu sorar. **Kodu yalnız sizi arayan teknisyene söyleyin.** Bu kod
   teknisyenin doğru talebi açtığını gösterir.
8. Teknisyen talebi kabul edince **Bağlantı isteği** penceresi öne gelir ve görev çubuğundaki simge yanıp söner.
   Pencerede teknisyenin adı, **teknisyen doğrulama kodu**, talep kodunuz ve kalan süre yazar.
   - Telefondaki teknisyen aynı doğrulama kodunu size söylemeli. Söyleyemiyorsa veya kod farklıysa **Vazgeç**'e
     tıklayın.
   - Her şey doğruysa **kendi farenizle** **Ekranımı paylaş**'a tıklayın. Bu düğme yanlışlıkla basılmasın diye ilk
     1,5 saniye çalışmaz. Enter veya boşluk tuşu paylaşmaz; uzak bağlantı (TeamViewer, Uzak Masaüstü vb.) üzerinden
     yapılan tıklama sayılmaz.
9. "Teknisyen bağlanıyor…" yazar ve bağlantı kendiliğinden kurulur. Varsayılan ayarda kabul kodu sorulmaz. Sonrası normal oturumla
   aynıdır: ekran seçimi, kırmızı çerçeve, sohbet ve dosya (bkz. "Ekran seçimi ve oturum"). Teknisyen fare ve
   klavyenizi kullanmak isterse ayrıca izin istenir.

Bağlantı isteği penceresinde **1 dakika** içinde karar vermezseniz "Bağlantı süresi doldu" yazar ve ekranınız
paylaşılmaz. **Vazgeç** derseniz "Ekranınız paylaşılmadı" yazar ve talep iptal olur.

**Beklerken neler yapabilirim?**

- **Talebi iptal et:** talep firmanızın listesinden kalkar ve forma dönersiniz ("Talebiniz iptal edildi").
- **Teknisyenle yazışın** (0.12 ve sonrası): bekleme penceresindeki **Teknisyenle yazışma** alanından teknisyene yazabilir,
  onun mesajlarını okuyabilirsiniz. Bkz. "Beklerken teknisyenle nasıl yazışırım?".
- Pencereyi sağ üstteki **X** ile kapatmak da talebi iptal eder ve programı kapatır (**Tepside çalıştır** açıksa program
  kapanmaz, tepsiye döner).
- İnternet kısa süre koparsa "Bağlantı koptu, yeniden bağlanılıyor…" yazar. Program yaklaşık 2 dakika boyunca
  kendiliğinden yeniden bağlanmayı dener; bir şey yapmanız gerekmez.
- Firmanız bekleme süresi içinde yanıt veremezse "Talebiniz zaman aşımına uğradı" yazar. Pencerenin üstündeki
  "yanıt bekleme süresi en çok … dk" satırı bu süreyi gösterir. **Yeniden talep oluştur** formu bilgileriniz dolu
  olarak açar.
- Firmanız talebi reddederse "Firmanızın mesajı:" başlığı altında firmanın kısa mesajını okursunuz. Gerekirse
  firmanızı telefonla arayın.

**Bilgilerimi hatırlasın mı?**

- Formdaki **Bilgilerimi bu bilgisayarda hatırla** kutusu ilk açılışta **işaretsizdir**. İşaretlerseniz ad, telefon ve
  e-postanız talep gönderilince bu bilgisayarda şifreli olarak saklanır. Sorun açıklaması saklanmaz.
- Bir sonraki açılışta form dolu, kutu işaretli gelir. Altında "Bu bilgiler size ait değilse: Bilgilerimi unut"
  yazar.
- Hatırlanan bilgilerden ad veya telefonu değiştirirseniz "Bilgilerimi bu bilgisayarda hatırla" kutusu kendiliğinden
  kaldırılır. Yeni bilgileri hatırlatmak için kutuyu yeniden işaretleyin.
- Kutu işaretsizken talep gönderirseniz daha önce hatırlanan bilgiler silinir.
- **Bilgilerimi unut:** saklanan bilgileri hemen siler ve formu boşaltır; "Bilgileriniz silindi." yazar.
  "Bilgileriniz silinemedi. Pencereyi kapatıp yeniden deneyin." yazarsa pencereyi kapatıp programı yeniden açın ve
  tekrar deneyin.
- Bilgiler yalnız sizin Windows hesabınızla okunabilir. Aynı bilgisayarda başka bir Windows kullanıcısı bunları
  göremez.

**Paylaşılan bir bilgisayardaysanız** (ortak ofis bilgisayarı, internet kafe, aile bilgisayarı ve aynı Windows
hesabını başkalarının da kullandığı her durum) kutuyu işaretlemeyin. Daha önce işaretlediyseniz işiniz bitince
**Bilgilerimi unut**'a tıklayın. Form başka birinin bilgileriyle dolu açılırsa da önce **Bilgilerimi unut**'a tıklayın.

**Teknisyen bana zaten kod verdiyse?** Formdaki **Bağlantı kodum var** düğmesine (0.9 sürümünde **Teknisyenden kod
aldım**) tıklayın. Program 8 haneli kodu
sorar ve olağan akışla devam eder (bkz. "KVKK onayı ve bağlanma").

**"Destek iste" ekranında sık karşılaşılan mesajlar**

| Mesaj                                                          | Ne yapmalı                                                                                                                                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bu Hızlı Destek dosyası eski                                   | **Yeni sürümü indir**'e tıklayın. Yeni dosya aynı firma bağlantısından iner; bu pencereyi kapatıp yeni dosyayı açın. (8 haneli kod dosyasında "Teknisyeninizden yeni bağlantı isteyin" yazar.)                           |
| Bu dosya artık geçerli değil                                   | Firmanız bağlantıyı yenilemiş. Firmanızdan yenisini isteyin. Teknisyen size kod verdiyse **Bağlantı kodum var** ile devam edin. Bilgisayarınız kayıtlıysa ana ekrandan **Destek iste** ile yine talep gönderebilirsiniz. |
| Talebiniz kapatıldı — Firmanız bu talebi şu an kabul edemiyor. | Firmanız müşteri kaydınızı pasife almış veya bu bilgisayarın kaydını iptal etmiş olabilir. Firmanızı telefonla arayın.                                                                                                   |
| Sunucuya ulaşılamıyor                                          | İnternet bağlantınızı kontrol edip **Tekrar dene**'ye tıklayın.                                                                                                                                                          |
| Sunucu sertifikası doğrulanamadı                               | Ağınızda araya giren bir cihaz olabilir. Devam etmeyin; firmanızı telefonla arayın.                                                                                                                                      |
| Sunucu şu an yoğun, birkaç saniye içinde yeniden deneniyor…    | Bekleyin; program bir kez kendiliğinden yeniden dener.                                                                                                                                                                   |
| Sunucu şu an yoğun. Lütfen biraz sonra tekrar deneyin.         | Biraz bekleyip **Destek iste**'ye yeniden basın.                                                                                                                                                                         |
| Çok fazla deneme                                               | Birkaç dakika sonra tekrar deneyin.                                                                                                                                                                                      |
| Talep gönderilemedi. Lütfen tekrar deneyin.                    | **Destek iste**'ye yeniden basın. Sürerse firmanızı telefonla arayın.                                                                                                                                                    |
| Bu pencereden gönderilmiş bekleyen bir talebiniz var.          | Programı kapatıp yeniden açın.                                                                                                                                                                                           |
| Aydınlatma metni güncellendi; lütfen yeniden okuyup onaylayın. | Metni okuyup kutuyu yeniden işaretleyin, sonra **Destek iste**'ye basın.                                                                                                                                                 |
| Sunucu güncel değil; lütfen daha sonra deneyin                 | Firmanızın sunucusu Hızlı Destek 0.21'i henüz desteklemiyor; **Destek iste** pasif kalır. Firmanızı telefonla arayın.                                                                                                    |
| Sunucuyla bağlantı kesildi                                     | İnternet uzun süre kopmuş. Bağlantınızı kontrol edip **Yeniden talep oluştur**'a tıklayın; bilgileriniz formda durur.                                                                                                    |
| Talebiniz zaman aşımına uğradı                                 | Firmanız bekleme süresinde yanıt veremedi. **Yeniden talep oluştur** veya firmanızı arayın.                                                                                                                              |
| Firmanız talebinizi yanıtladı / Firmanızın mesajı: …           | Talep reddedildi; ekranınız paylaşılmadı. Mesajdaki yönlendirmeyi izleyin.                                                                                                                                               |
| Talebiniz iptal edildi — Firmanız şu an talep kabul etmiyor.   | Firmanızı telefonla arayın.                                                                                                                                                                                              |
| Bağlantı süresi doldu                                          | Bağlantı isteğine 1 dakika içinde yanıt verilmedi. Gerekirse yeniden talep oluşturun.                                                                                                                                    |
| Bağlantı kurulamadı                                            | Teknisyen kabul etti ama bağlantı kurulamadı. Yeniden talep oluşturun veya firmanızı arayın.                                                                                                                             |
| Talep başka bir pencerede açıldı                               | Aynı talep başka bir pencerede izleniyor; bu pencereyi kapatabilirsiniz.                                                                                                                                                 |

#### Mac'te nasıl destek isterim? (Hızlı Destek macOS 0.24 ve sonrası)

Mac'te de teknisyenden kod beklemeden talep gönderebilirsiniz. Firmanızın verdiği **firma bağlantısı** Windows'takiyle
aynıdır; bağlantıyı Mac'te açtığınızda Windows programı yerine Mac uygulaması (`.zip`) iner. Ne gerektiği ve uygulamanın
nasıl imzalandığı "Müşteri için: Hızlı Destek uygulaması (macOS)" bölümündedir.

**Bağlantıyı kontrol edin.** Bağlantı her zaman `https://remote.noktabilisim.net/` ile başlar; dosya eki göndermeyiz.
Firmanız size yalnız bağlantı gönderir, dosya göndermez. E-posta ya da mesaj ekinde gelen bir dosyayı açmayın.

1. Firma bağlantısını Mac'inizde Safari ya da Chrome ile açın. Tarayıcı `NoktaDestek-<firma adı>-….zip` adlı bir dosya
   indirir (ör. `NoktaDestek-Acme-k3pqxr2mab4cde7f.zip`).
2. Safari zip'i kendiliğinden açar. Açmadıysa **Finder → İndirilenler** klasöründe zip'e çift tıklayın. Aynı adla bir
   klasör oluşur (ör. `NoktaDestek-Acme-k3pqxr2mab4cde7f`). Aynı dosyayı ikinci kez indirdiyseniz klasörün adının
   sonunda ` (1)` gibi bir ek olabilir; bu da çalışır.
3. **Klasörün adını değiştirmeyin ve uygulamayı klasörden çıkarmayın.** Uygulama firmanızı bu klasörün adından tanır.
4. Klasördeki **Nokta Destek** uygulamasına çift tıklayın. macOS ilk açılışta uygulamayı durdurur. "Mac'te nasıl indirir
   ve açarım?" bölümündeki 6–9. adımları izleyin: uyarıda **Bitti**'yi seçin, ardından **Sistem Ayarları → Gizlilik ve
   Güvenlik → Yine de Aç** ile onaylayın.
   - **"Yine de Aç"ı yalnız tarayıcınızda remote.noktabilisim.net adresinden indirdiğiniz Nokta Destek için kullanın.**
     Finder → **Bilgi Al** → **Nereden** satırı `https://remote.noktabilisim.net/` ile başlamalı. Başka bir adres
     yazıyorsa uygulamayı açmayın ve firmanızı telefonla arayın.
5. macOS **Ekran Kaydı** izni ister (bkz. "Ekran Kaydı izni"). İzni verip **İzni verdim, yeniden başlat**'a tıklayın.
   Uygulama aynı klasörden yeniden açılır ve firmanızı yeniden tanır.
6. **Nokta Destek — Uzaktan destek** penceresi açılır. Pencerede "Bu dosyanın firması: <firma adı>" satırı seçili,
   **Destek iste** düğmesi varsayılandır. Pencerede firmanızın adı görünür; bu yalnız doğru firmaya bağlandığınızı gösterir,
   dosyanın güvenli olduğunu göstermez. Tanımadığınız bir ad görürseniz pencereyi kapatın. Firmanız bir adres
   tanımladıysa **Kötüye kullanımı bildir** düğmesi de bulunur.
7. **Destek iste**'ye tıklayın. **Nokta Destek — <firma adı>** penceresi açılır. Form Windows'takiyle aynıdır (yukarıdaki 3–4. adımlar): ad soyad, telefon, e-posta
   (isteğe bağlı), sorununuz, aydınlatma metni ve onay kutusu, sohbet saklama satırı. Formu doldurup **Destek iste**'ye
   tıklayın. Hatalı alanın altında kırmızı yazı çıkar ve imleç o alana gider.
8. **Talebiniz iletildi** ekranında 6 haneli talep kodunu, sıranızı ve bekleme sürenizi görürsünüz. Beklerken teknisyenle
   yazışabilir ya da **Talebi iptal et** ile talebi geri çekebilirsiniz.
9. Teknisyen talebi kabul edince **Bağlantı isteği** penceresi öne gelir ve Dock'taki Nokta Destek simgesi zıplar.
   Teknisyen doğrulama kodunu telefondaki teknisyenle karşılaştırın. Her şey doğruysa **kendi farenizle** ya da izleme
   dörtgeninizle **Ekranımı paylaş**'a tıklayın. Düğme ilk 1,5 saniye çalışmaz; Return ya da boşluk tuşu paylaşmaz.
   Emin değilseniz **Vazgeç**'e tıklayın (varsayılan düğme budur). Sonrası kodla açılan Mac oturumuyla aynıdır.

**Mac'te farklı olanlar**

- **Dosyayı saklamayın.** Mac'te dosyayı saklamayın; her destek isteğinde firmanızın bağlantısından yeniden indirin, eski
  klasörü silin. Windows'taki gibi masaüstünde bekletilecek bir dosya yoktur.
- **Firmanız bağlantıyı yenilediyse** yeni bağlantıdan yeniden indirin. Eski klasördeki uygulama "Bu dosya artık geçerli
  değil" der.
- Bekleme penceresini kırmızı düğmeyle kapatmak ya da **⌘Q** ile çıkmak talebi iptal eder ve uygulamayı kapatır. Mac'te
  tepsi yoktur.
- Talebi gönderdikten sonra uygulama yeniden başlarsa talebiniz iptal olur. Uygulama açılınca yeniden **Destek iste**'ye
  basın.
- Formda **Bilgilerimi bu bilgisayarda hatırla** ve **Bilgilerimi unut** yoktur; bilgiler her seferinde yeniden yazılır.
  Bilgisayar kaydı alınmaz, ana ekranda firma listesi, "Bu firmayı unut" ve "Bu bilgisayarı unut" yoktur. Uygulama
  kapanınca bilgileriniz, talep kodunuz ve yazışmanız Mac'te kalmaz.
- Uygulama firmanızı tanıyamazsa (klasör yeniden adlandırıldı ya da uygulama taşındı) ana ekranda **Destek iste** pasif
  olur ve şu satır yazar: "Firmanızın bağlantısından indirdiyseniz zip'i açtığınız klasörü yeniden adlandırmadan ve
  uygulamayı klasörden çıkarmadan açın. Teknisyen size kod verdiyse Bağlantı kodum var ile devam edin." Zip'i yeniden
  açın ya da firmanızın bağlantısından yeniden indirin.
- "Bu Hızlı Destek dosyası eski" ekranındaki **Yeni sürümü indir** Mac'te firma bağlantınızdan yeni `.zip`'i indirir.
  Eski klasörü silin, yeni zip'i açıp uygulamayı yeniden onaylayın (her yeni sürümde "Yine de Aç" ve izinler yeniden
  istenir).

### Program indirmeden tarayıcıdan destek isteyebilir miyim? (web talep formu)

Evet, firmanız **web talep formunu** açtıysa. Firmanız size `https://<destek adresi>/r/…` biçiminde bir **form bağlantısı**
verir (e-posta imzası, web sitesi, sözleşme vb.). Bağlantıyı tarayıcıda açmanız yeterlidir; program indirmeniz gerekmez.

**Nasıl talep gönderirim?**

1. Form bağlantısını açın. Sayfanın üstünde firmanızın adı ve logosu görünür. Tanımadığınız bir ad görürseniz sayfayı
   kapatın.
2. Formu doldurun:
   - **Adınız soyadınız** (en az 2 karakter), **Telefon**, **E-posta** (isteğe bağlı), **Sorununuzu kısaca anlatın**
     (en az 10, en çok 500 karakter).
   - **Talebimin durumunu bana bildir** (isteğe bağlı): **SMS ile**, **WhatsApp ile**, **E-posta ile**. Kutucuklar
     işaretsiz gelir. Yalnız firmanızın açtığı kanallar görünür. E-posta ile bildirim seçerseniz e-posta adresi zorunlu
     olur. Bkz. "Durum bildirimi ne gönderir?".
3. Aydınlatma metnini okuyun ve "Aydınlatma metnini okudum; bilgilerimin destek talebi için işlenmesini kabul ediyorum."
   kutusunu işaretleyin. Düğmenin hemen üstünde "Sohbet mesajları kayıt altına alınır ve N gün saklanır." satırı yazar.
4. **Talep gönder**'e basın. Sayfa açıldıktan sonra düğme birkaç saniye "Talep gönder (N sn)" yazar ve pasiftir; bu,
   otomatik gönderimlere karşı bir önlemdir. Süre bitince düğme açılır.
5. **Talebiniz alındı** görünümü açılır: **Talep kodu**, **Sıranız** ve **Kalan süre**. Teknisyen sizi arayıp talep
   kodunu sorabilir; kodu yalnız sizi arayan teknisyene söyleyin.
6. Beklerken **Teknisyenle yazışma** bölümünden teknisyene yazabilir, onun mesajlarını okuyabilirsiniz.
   **Sohbete şifre veya kart bilgisi yazmayın.** Mesajlar kayıt altına alınır.
7. Teknisyen talebi kabul edince "Teknisyen <ad> bağlanmak istiyor" yazar ve bir **doğrulama kodu** görünür. Telefondaki
   teknisyen aynı kodu söylemeli. Firmanız kabul kodu kullanıyorsa ekranda ayrıca "Teknisyene söyleyeceğiniz kabul kodu"
   çıkar; bu kodu teknisyene okuyun.
8. Her şey doğruysa **Ekranımı paylaş**'a basın; tarayıcı hangi ekranı paylaşacağınızı sorar. Emin değilseniz
   **Vazgeç**'e basın.

**Bilmeniz gerekenler**

- Tarayıcıdan yapılan paylaşımda teknisyen ekranınızı **yalnız görür**; farenizi ve klavyenizi kullanamaz. Uzaktan kontrol
  gerekiyorsa aynı sayfadaki "Uzaktan kontrol gerekiyorsa Windows programını indirin" bağlantısını kullanın. Mac'te bu
  bağlantı "Uzaktan kontrol gerekiyorsa Nokta Destek'i (macOS) indirin" yazar ve Mac uygulamasını (`.zip`) indirir;
  yanında "“Yine de Aç” yalnız resmi adresten indirdiğiniz uygulama için" uyarısı bulunur (bkz. "Mac'te nasıl destek
  isterim?"). Mac uygulaması sunucuda yayımlanmamışsa Windows bağlantısı görünür.
- Sayfayı yenilerseniz (F5) bekleme ekranına geri dönersiniz. **Sekmeyi ya da tarayıcıyı kapatırsanız** talebiniz kısa
  süre sonra iptal olur; yeniden talep oluşturmanız gerekir.
- **Talebi iptal et** ile talebinizi geri çekebilirsiniz.
- Bağlantı koparsa "Bağlantı koptu, yeniden bağlanılıyor…" yazar; sayfa kendiliğinden yeniden bağlanır.

**Durum bildirimi ne gönderir?**

Kutucuğu işaretlediyseniz yalnız **bu talebin** durumu bildirilir: kabul edildi, karşılanamadı (ret) ya da bekleme süresi
doldu. Mesajda firma adı ve talep kodu bulunur; reklam gönderilmez. Bu bir **hizmet bildirimi tercihidir**; ticari ileti
izni değildir. İşaretlemezseniz hiçbir bildirim gönderilmez. Aynı numaraya ya da adrese günde gönderilebilecek bildirim
sayısı sınırlıdır; bu yüzden bazı bildirimler gitmeyebilir. Sayfa açıkken sonucu zaten ekranda görürsünüz.

**Sık karşılaşılan mesajlar (web talep formu)**

| Mesaj                                                                      | Ne yapmalı                                                                                                 |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Bağlantı geçersiz                                                          | Bağlantı yanlış, firmanız formu kapatmış ya da bağlantıyı yenilemiş. Firmanızdan güncel bağlantıyı isteyin |
| Lütfen birkaç saniye sonra tekrar deneyin.                                 | Çok hızlı gönderdiniz; düğme yeniden açılınca tekrar basın                                                 |
| Formun süresi doldu, sayfayı yenileyin.                                    | Sayfayı uzun süre açık bıraktınız; sayfa formu kendisi yeniler, tekrar gönderin                            |
| Şu an çok yoğunuz, lütfen birkaç dakika sonra tekrar deneyin.              | Kuyruk dolu ya da çok sayıda deneme yapıldı; birkaç dakika bekleyin                                        |
| Şu an mesai dışındayız ve talep alınmıyor. Sonraki açılış: …               | Belirtilen saatte tekrar deneyin ya da firmanızı arayın                                                    |
| Şu an mesai dışındayız; talebiniz alınır ve mesai başladığında yanıtlanır. | Bilgi notudur; talebiniz kuyruğa girer                                                                     |
| Teknisyenin notu: …                                                        | Talep reddedildi; nottaki yönlendirmeyi izleyin. **Yeni talep oluştur** ile yeniden başlayabilirsiniz      |

### Bilgisayarım hatırlanır mı? (Hızlı Destek 0.10.0 ve sonrası)

Evet. Teknisyenle **bir kez** başarılı bir oturum yaptığınızda (ekranınızı paylaşmayı kabul ettiğinizde) bu bilgisayar
destek aldığınız firmayı hatırlar. Bir dahaki sefere teknisyenden yeni bağlantı beklemeniz gerekmez: elinizdeki
NoktaDestek dosyasını (hangisi olursa olsun) açıp **Destek iste**'ye basmanız yeterlidir.

- Karşılama ekranında ve talep formunda bunu anlatan bir satır görürsünüz: "Oturumdan sonra bu bilgisayar <firma> için
  hatırlanır; istediğinizde 'Bu bilgisayarı unut' ile silebilirsiniz."
- Hatırlanan şey yalnız firmanın adı ve bilgisayara özel bir anahtardır. Adınız, telefonunuz veya ekranınız
  hatırlanmaz (ad/telefon için ayrıca "Bilgilerimi bu bilgisayarda hatırla" kutusu vardır).
- Bu kayıt **yalnız destek isteği göndermenizi** sağlar. Teknisyen bu kayıtla bilgisayarınıza kendiliğinden bağlanamaz;
  her seferinde talebinizi kabul etmesi ve sizin **Ekranımı paylaş**'a basmanız gerekir.
- Oturumu lobide **Vazgeç** ile bırakırsanız ya da ekranınızı paylaşmazsanız bilgisayar hatırlanmaz.

**Programı yeniden açtığımda ne görürüm?**
Hızlı Destek 0.12 ve sonrasında program hangi dosyayla açılırsa açılsın **aynı ana ekran** açılır (firma listesi; bkz.
"Birden çok firmadan destek alıyorum"). Aşağıdaki tablo 0.10–0.11 ana ekranını anlatır: üstte firma adı, kırmızı
dolandırıcılık uyarısı ve (kayıtlıysa) "Bu bilgisayar <firma>[ – <müşteri firma>] için kayıtlı" satırı bulunur. Altında
dört düğme vardır:

| Düğme                       | Ne yapar                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Destek iste**             | Talep formunu açar (bkz. "Teknisyeni beklemeden destek isteyebilir miyim?"). Talep doğrudan firmanıza düşer |
| **Bağlantı kodum var**      | Teknisyen size 8 haneli bir kod verdiyse kodu yazıp bağlanırsınız (eski "Teknisyenden kod aldım")           |
| **Bu bilgisayarı unut**     | Bu bilgisayarın kaydını ve hatırlanan bilgilerinizi siler                                                   |
| **Kötüye kullanımı bildir** | Firmanız bir adres tanımladıysa görünür                                                                     |

Tab tuşu düğmeler arasında bu sırayla gezer; Enter seçili düğmeyi çalıştırır.

**Hangi durumda hangi ekran açılır?**

- Teknisyenin gönderdiği geçerli `Destek-<kod>.exe` → her zamanki karşılama ekranı (kod akışı; oturum doğrudan başlar).
  Oturum bitince **Tepside çalıştır** açıksa program tepsiye iner, kapalıysa kapanır.
- Süresi dolmuş veya kullanılmış `Destek-<kod>.exe` → ana ekran, üstte "Bu destek bağlantısının süresi doldu."
  Bilgisayar kayıtlıysa listeden firmayı seçip **Destek iste** ile yine talep gönderebilirsiniz.
- Firmanızın verdiği `NoktaDestek-<ad>-….exe` geçerliyse → ana ekran; listenin en üstünde "Bu dosyanın firması: <firma>"
  satırı seçili gelir. **Destek iste**'ye basınca talep o dosyanın firmasına gider.
- O dosya artık geçerli değilse → ana ekran, üstte "Bu dosya artık geçerli değil…" yazar; kayıtlı firmalarınız varsa
  onlardan destek isteyebilir, yoksa **Bağlantı kodum var** ile devam edebilirsiniz.
- Bilgisayar hiçbir firmaya kayıtlı değilse ve dosya da firma dosyası değilse → **Destek iste** pasiftir; "Destek
  istemek için firmanızın gönderdiği dosyayı kullanın veya teknisyeninizin verdiği kodu girin" yazar. **Bağlantı kodum
  var** ile devam edin.

**"Bu bilgisayarı unut" ne yapar?**

1. Ana ekranda **Bu bilgisayarı unut**'a tıklayın.
2. "Bu bilgisayar unutuldu" yazar. Kayıt ve hatırlanan ad/telefon/e-posta bu bilgisayardan silinir; sunucudaki kayıt da
   iptal edilir. İnternet yoksa yerel silme yine yapılır.
3. Bundan sonra destek için firmanızın dosyasını veya teknisyenin kodunu kullanırsınız.

Formdaki **Bilgilerimi unut** ise yalnız ad/telefon/e-postayı siler; bilgisayar kaydı kalır.

**"Bu bilgisayarın destek kaydı artık geçerli değil" yazıyor**
Tam mesaj: "Bu bilgisayarın destek kaydı artık geçerli değil. Firmanızdan yeni dosya isteyin ya da teknisyeninizin
verdiği kodla bağlanın." Firmanız bağlantınızı yenilemiş, sizi pasife almış ya da bu bilgisayarın kaydını iptal etmiş
olabilir; uzun süre kullanılmayan kayıtlar da kendiliğinden düşer. Program kaydı siler (hatırlanan adınız ve telefonunuz
kalır). **Bağlantı kodum var** ile teknisyenin kodunu girin veya firmanızdan yeni dosya isteyin. Bir sonraki başarılı
oturumdan sonra bilgisayar yeniden hatırlanır.

**Başka bir firmadan destek alırsam?** Hızlı Destek 0.12 ve sonrasında bilgisayar aynı anda **en çok 5 firmaya** kayıtlı
olabilir; yeni firma eskisinin yerine geçmez. Ayrıntı bir sonraki bölümde. (0.10–0.11'de bilgisayar tek firmaya kayıtlıydı
ve oturum sonunda "Bu bilgisayar artık <yeni firma> için kayıtlı." yazardı.)

**Paylaşılan bilgisayardaysanız** işiniz bitince **Bu bilgisayarı unut**'a tıklayın.

### Birden çok firmadan destek alıyorum (Hızlı Destek 0.12 ve sonrası)

Bir bilgisayar aynı destek sunucusunda **en çok 5 firmaya** kayıtlı olabilir. Her firmayla ilk başarılı oturumdan sonra
o firma listeye eklenir ve oturum sonunda "Bu bilgisayar artık <firma> için de kayıtlı (2/5)." gibi bir satır görünür.
Eski sürümdeki (0.10–0.11) kaydınız ilk açılışta kendiliğinden taşınır; bir şey yapmanız gerekmez.

**Firma listesi ne zaman görünür?**

Her zaman: program adı ne olursa olsun, firma dosyasıyla, süresi dolmuş kodla ya da tepsiden açıldığında aynı ekran
gelir. Yalnız geçerli bir teknisyen kodu dosyası (`Destek-<kod>.exe`) oturumu doğrudan başlatır. Firma dosyasıyla
açtıysanız o dosyanın firması listenin en üstünde ve seçili gelir ("Bu dosyanın firması: <firma>"); bu satır bir kayıt
değildir, bu yüzden onda **Bu firmayı unut** pasiftir. Firma zaten kayıtlıysa aynı firma listede ayrıca kayıt tarihiyle
görünür; ikisinden de destek isteyebilirsiniz.

**Ekranda neler var?**

- **Destek istemek istediğiniz firmayı seçin:** listesi. Her satırda firma adı, varsa müşteri firma adı ve bu bilgisayarın
  o firmaya kaydolduğu tarih yazar (ör. `Acme – Merkez Ofis (kayıt: 12.11.2026)`). Tek firmaya kayıtlıysanız liste yerine
  "Kayıtlı firma: …" satırı görünür.
- Tanımadığınız ya da beklemediğiniz bir tarihte eklenmiş bir firma görürseniz o firmayı seçip **Bu firmayı unut**'a basın.
- **Başka sunucu (<adres>) — talep için seçilemez** bloğu: bilgisayarınız başka bir destek sunucusunun programıyla da
  kayıt aldıysa o kayıtlar burada yalnız bilgi olarak listelenir. Onlardan destek istemek için o sunucunun programını
  kullanın. 5 firma sınırı her sunucu için ayrı sayılır.
- Kırmızı dolandırıcılık uyarısı: sizi kendiliğinden arayan biri bu programı açmanızı istediyse pencereyi kapatın.

**Nasıl destek isterim?**

1. Listeden firmayı seçin.
2. **Destek iste**'ye basın. Talep formu açılır; pencere başlığında seçtiğiniz firma yazar.
3. Sonrası "Teknisyeni beklemeden destek isteyebilir miyim?" bölümündeki gibidir.

**Tek firmayı nasıl unuturum?**

1. Listeden firmayı seçin, **Bu firmayı unut**'a basın.
2. "<firma> bu bilgisayardan unutulsun mu? …" sorusuna **Evet** deyin.
3. "<firma> bu bilgisayardan unutuldu." yazar. Yalnız o firmanın kaydı bu bilgisayardan silinir ve sunucuda iptal edilir;
   diğer firmalar ve kayıtlı ad/telefonunuz kalır. O firmadan yeniden destek almak için firmanın dosyası ya da teknisyenin
   kodu gerekir.

**Hepsini nasıl unuturum?**

1. **Bu bilgisayarı unut (tüm firmalar)**'a basın.
2. "Bu bilgisayardaki tüm firma kayıtları ve kayıtlı bilgileriniz silinsin mi? …" sorusuna **Evet** deyin.
3. "Bu bilgisayar unutuldu" yazar. Tüm firma kayıtları, hatırlanan ad/telefon/e-posta, tanılama dosyası, Windows açılışı
   kaydı ve tepsi simgesi kaldırılır. Bu sunucudaki kayıtlar da iptal edilir. **Başka sunucunun kayıtları** yalnız bu
   bilgisayardan silinir; o sunucuda iptal edilemez.

**Ana ekranda görebileceğiniz bilgi satırları**

| Mesaj                                                                                                   | Anlamı / ne yapmalı                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <firma>: bu bilgisayarın kaydı artık geçerli değil, listeden çıkarıldı.                                 | Firma kaydı iptal etmiş ya da bağlantıyı yenilemiş. Firmanızdan yeni dosya isteyin                                                                                                  |
| Firma adı değişti: eski → yeni                                                                          | Firma sunucudaki adını değiştirdi; bilgi notudur                                                                                                                                    |
| Bu bilgisayar 5 firmaya kayıtlı; <firma> için kayıt alınmadı. Ana ekrandan bir firmayı unutabilirsiniz. | Sınır dolu. Kullanmadığınız bir firmayı unutun; bir sonraki oturumda yeni firma eklenir                                                                                             |
| Bu bilgisayarda başka iki sunucunun kayıtları var; bu firma için kayıt alınmadı.                        | Bilgisayar zaten iki farklı sunucuya kayıtlı. Gerekmeyenleri **Bu bilgisayarı unut** ile temizleyin                                                                                 |
| Eski sürümden kalan bir kayıt (<firma>) eklenemedi; 5 firma sınırı. …                                   | Eski sürümden kalan kayıt yer olmadığı için taşınmadı. Bir firmayı unutun. Eski sürüm dosyasını açmayın; tam temizlik için bu programda **Bu bilgisayarı unut**'u kullanın          |
| Kayıt dosyasında sınırı aşan eski kayıtlar vardı; en eski kullanılanlar listeden çıkarıldı.             | Bilgi notudur; kalan kayıtlar çalışır                                                                                                                                               |
| Bu bilgisayardaki kayıtlar şu an okunamıyor; kayıtlar silinmedi, program kayıtsız gibi çalışıyor. …     | Genellikle antivirüs taraması gibi geçici bir durumdur. Programı daha sonra yeniden açın. Sürerse **Bu bilgisayarı unut** ile silebilirsiniz (firmalardaki kayıtlar iptal edilemez) |
| Kayıtlar art arda okunamadı. Bu bilgisayarı unut ile silmeniz önerilir; …                               | Kayıtlar kalıcı olarak okunamıyor (ör. Windows şifreniz yönetici tarafından sıfırlandı). **Bu bilgisayarı unut**'a basın ve firmanızdan yeni dosya isteyin                          |
| Kayıt bu bilgisayara yazılamadı.                                                                        | Oturum sonunda görünür; kayıt alınamadı. Bir sonraki oturumda yeniden denenir                                                                                                       |

### Program tepside çalışsın ve Windows açılınca başlasın mı? (Hızlı Destek 0.12 ve sonrası)

Sık destek alıyorsanız programı her seferinde aramak zorunda kalmamak için iki seçenek vardır. İkisi de **kapalı** gelir;
siz açmadıkça program bilgisayarınızda çalışmaya devam etmez. Seçenekler ana ekranın altındadır ve program hangi dosyayla
açılırsa açılsın aynı çalışır. Bilgisayarınız henüz hiçbir firmaya kayıtlı değilse kutular pasiftir ve "Tepside
çalıştır, bu bilgisayar bir firmaya kaydolduktan sonra (ilk destek oturumunun ardından) açılabilir." yazar.

**Tepside çalıştır nasıl açılır?**

1. Ana ekranın altındaki **Tepside çalıştır** kutusunu işaretleyin.
2. Bundan sonra (oturum ya da talep yokken) pencereyi **X** ile kapattığınızda program kapanmaz; saatin yanındaki bildirim
   alanına (tepsi) iner. İlk seferde "Program tepside çalışmaya devam ediyor" balonu çıkar.
3. Oturum bitince de program kapanmaz: son ekran birkaç saniye görünür, sonra pencere kapanır ve program tepside kalır.

Firma dosyası ya da kod dosyasıyla açtığınız program da aynı kurala uyar: **Tepside çalıştır** açıksa pencere
kapanınca tepsiye iner. Tepside zaten bir Nokta Destek çalışıyorsa ikinci simge açılmaz; bu pencere kapanınca program
kapanır. Tepsi en kolay **Windows açılışında başlat** ile kullanılır.

**Tepsi simgesiyle neler yapılır?**

- Simgeye tıklayın (ya da klavyeyle seçip Enter'a basın): ana ekran açılır. Pencere zaten açıksa öne gelir.
- Sağ tıklayın: yalnız üç seçenek vardır: **Destek iste** (ana ekranı açar), **Aç**, **Çık**.
- **Çık:** pencere açık değilse program hemen kapanır. Oturum ya da talep sürüyorsa "Nokta Destek penceresi açık. Çıkarsanız
  süren oturum veya destek talebi sonlanır. Çıkılsın mı?" sorulur; **Evet** derseniz oturum teknisyende de biter.
- Oturum sürerken simgenin ipucunda "Nokta Destek — oturum sürüyor" yazar.
- Program ikinci kez açılırsa yeni bir simge çıkmaz; var olan pencere öne gelir.

**Windows açılışında başlat nasıl açılır?**

1. Önce **Tepside çalıştır**'ı işaretleyin. Bu kutu işaretli değilken **Windows açılışında başlat** pasiftir ve altında
   "Windows açılışında başlatmak için önce Tepside çalıştır'ı açın." yazar.
2. **Windows açılışında başlat** kutusunu işaretleyin.
3. Bundan sonra Windows'a girdiğinizde program **pencere açmadan ve sunucuya bağlanmadan** yalnız tepsi simgesiyle başlar.
   Siz simgeye tıklayana kadar internete çıkmaz.

**Kutu pasifse ya da kendiliğinden kapandıysa** altında nedeni yazar:

| Mesaj                                                                                                        | Ne yapmalı                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Program yönetici olarak çalışıyor; Windows açılışında başlatma bu durumda açılamaz                           | Programı "Yönetici olarak çalıştır" demeden, çift tıklayarak açın. Yönetici olarak açılan programda iki kutu da pasiftir             |
| Program ağ veya çıkarılabilir bir konumdan çalışıyor; programı İndirilenler'e veya kendi klasörünüze taşıyın | Programı USB bellekten ya da ağ klasöründen değil, bilgisayarınızdaki bir klasörden açın                                             |
| Program geçici bir klasörden (ör. zip içinden) çalışıyor; …                                                  | Zip dosyasını önce bir klasöre çıkarın, programı oradan açın                                                                         |
| Bu klasöre başka kullanıcılar yazabiliyor; …                                                                 | Programı İndirilenler'e ya da kendi klasörünüze taşıyın (ör. `C:\Users\Public` ya da herkesin yazabildiği bir klasör uygun değildir) |
| Program bağlantılı bir klasörden çalışıyor; …                                                                | Programı gerçek bir klasöre (İndirilenler) taşıyın                                                                                   |
| Klasör izinleri denetlenemedi; Windows açılışında başlatma kullanılamıyor                                    | Programı İndirilenler'e taşıyıp oradan açın                                                                                          |
| Windows ayarlarında devre dışı                                                                               | Görev Yöneticisi > Başlangıç uygulamaları'nda Nokta Destek kapatılmış. Oradan **Etkinleştir** deyin                                  |
| Windows açılışında başlatma kapatıldı: program bulunamadı; yeniden açmak için kutuyu işaretleyin.            | Programı taşıdınız ya da sildiniz; eski konumdaki başlatma kaydı silindi. Programı yeni yerinden açıp kutuyu yeniden işaretleyin     |
| Windows açılışında başlatma kapatıldı: Bu klasöre başka kullanıcılar yazabiliyor; …                          | Programın bulunduğu klasörün izinleri değişti. Programı İndirilenler'e taşıyıp kutuyu yeniden işaretleyin                            |
| Windows açılışında başlatma kaydı silinemedi; kullanım kılavuzundaki elle kaldırma adımını uygulayın.        | Aşağıdaki "Elle kaldırma" adımını uygulayın                                                                                          |

Program tepsideyken aynı denetimler her pencere açılışında yapılır. Başlatma kaydı silinirse tepside "Windows açılışında
başlatma kapatıldı (klasör izinleri)" ya da "Windows açılışında başlatma kapatıldı (program bulunamadı)" balonu çıkar.

**Nasıl kapatırım?**

- **Windows açılışında başlat** kutusunun işaretini kaldırın: Windows açılışı kaydı silinir, tepsi seçeneği kalır.
- **Tepside çalıştır** kutusunun işaretini kaldırın: Windows açılışı kaydı da silinir; pencere kapanınca program kapanır.
- Son firmayı unuttuğunuzda ya da **Bu bilgisayarı unut** dediğinizde ikisi de kendiliğinden kapanır.

**Elle kaldırma** (program silindiyse ya da kayıt silinemediyse). Yönetici şifresi gerekmez:

1. Windows tuşu + R'ye basın, `cmd` yazıp Enter'a basın.
2. Şu satırı yazıp Enter'a basın:

   ```bat
   reg delete HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v NoktaDestek /f
   ```

3. Program tepsideyse simgeye sağ tıklayıp **Çık** deyin. Kayıtlı firmaları da silmek için programı açıp **Bu bilgisayarı
   unut**'a basın; program artık yoksa `%LOCALAPPDATA%\NoktaDestek` klasörünü silin.

Görev Yöneticisi > Başlangıç uygulamaları > Nokta Destek > **Devre dışı bırak** da programın açılışta başlamasını durdurur,
ama kaydı silmez.

### Beklerken teknisyenle nasıl yazışırım? (Hızlı Destek 0.12 ve sonrası)

"Destek iste" ile talep gönderdikten sonra bekleme penceresinde **Teknisyenle yazışma** alanı görünür. Teknisyen talebi
kabul etmeden önce size "Birkaç dakika içinde bağlanacağım" gibi bir not yazabilir; siz de yanıt verebilirsiniz.

1. Alttaki kutuya mesajınızı yazın.
2. **Gönder**'e basın ya da Enter'a basın. Mesajınız önce "Siz (gönderiliyor…)" olarak görünür, sunucu kaydedince onaylanır.
3. Teknisyenin mesajları "[SS:DD] Teknisyen <ad>:" başlığıyla görünür.

**Sohbete şifre veya kart bilgisi yazmayın.** Mesajlar kayıt altına alınır ve firmanın saklama süresi boyunca durur.

- Mesaj en çok 1.000 karakter ve 20 satır olabilir. Saniyede bir mesaj gönderebilirsiniz; bir mesaj onaylanmadan ikincisi
  gönderilmez ("Önceki mesajınız gönderiliyor; lütfen bekleyin.").
- Teknisyen talebi kabul edince "Talep kabul edildi; sohbet kapandı." yazar. Oturum başlayınca yazışmaya oturum penceresindeki
  sohbetten devam edersiniz.
- Pencere arka plandayken teknisyen yazarsa görev çubuğundaki simge yanıp söner. Pencere görünmüyorsa tepside "Teknisyenden
  yeni mesaj" balonu çıkar; balonda mesajın içeriği yazmaz.

| Mesaj                                                          | Ne yapmalı                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Bağlantı bekleniyor; mesaj şu an gönderilemez.                 | Program sunucuya bağlanıyor; birkaç saniye bekleyin                         |
| Çok hızlı mesaj gönderildi; birazdan yeniden deneniyor…        | Bir şey yapmayın; program mesajı kendisi yeniden gönderir                   |
| Mesaj gönderilemedi. Tekrar deneyin.                           | Metniniz kutuya geri konur; **Gönder**'e yeniden basın                      |
| Mesaj en çok 1000 karakter olabilir / en çok 20 satır olabilir | Mesajı kısaltın                                                             |
| Mesaj görünmez veya kontrol karakteri içeremez                 | Başka bir yerden kopyaladığınız metni yeniden yazın                         |
| Talep kabul edildi ya da kapandı; mesaj gönderilemez.          | Talep artık beklemede değil; teknisyen bağlanınca oturum sohbetini kullanın |

### "Ekran görüntüsü alınamadı" yazıyor (Hızlı Destek 0.10.2 ve sonrası)

Program ekranınızı üç farklı yolla okumayı dener; biri çalışırsa teknisyen ekranınızı görür (eski bilgisayarlarda ve
bazı dizüstülerde görüntü biraz daha yavaş akabilir). Hiçbiri çalışmazsa pencerenin alt satırında şuna benzer bir mesaj
çıkar:

> Ekran görüntüsü alınamadı (DXGI_UNSUPPORTED). Ekran kartı ayarını kontrol edin.

Parantez içindeki **kodu teknisyeninize telefonda okuyun**. Mesajın devamı ilk yapmanız gerekeni söyler:

| Kod                                                  | Ne yapmalı                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| DXGI_UNSUPPORTED                                     | Ekran kartı ayarını kontrol edin (ör. HDR açıksa kapatıp yeniden deneyin). |
| DXGI_ACCESS_DENIED                                   | Kilit ekranı veya Windows onay penceresi açıksa kapatın.                   |
| DXGI_NOT_AVAILABLE                                   | Tam ekran çalışan uygulamayı (oyun, sunum) kapatıp tekrar deneyin.         |
| NO_OUTPUT                                            | Ekran kablosunu / monitör bağlantısını kontrol edin.                       |
| D3D_DEVICE                                           | Ekran kartı sürücüsünü kontrol edin (teknisyeniniz yardımcı olur).         |
| FIRST_FRAME_TIMEOUT                                  | Ekran yanıt vermedi; tekrar deneyin.                                       |
| MF_STARTUP, NO_H264_ENCODER                          | Windows'un "N" sürümünde Windows Medya Özellik Paketi gerekir.             |
| GDI_FAILED, ENCODER_CONFIG, ENCODE_FAILED, OTHER 0x… | Kodu teknisyeninize bildirin.                                              |
| WGC_UNSUPPORTED                                      | Bu Windows sürümünde pencere paylaşımı yok; tüm ekranı paylaşın.           |
| WINDOW_CLOSED                                        | Paylaşılan pencere kapandı; oturumu bitirip yeniden başlatın.              |
| WINDOW_UNAVAILABLE                                   | Bu pencere paylaşılamıyor; başka bir pencere ya da tüm ekranı seçin.       |

Teknisyeniniz isterse bilgisayarınızdaki tanılama dosyasını da gönderebilirsiniz (bkz. aşağıdaki bölüm). Sohbet, dosya
ve destek talebi bu sırada çalışmaya devam eder.

### Bilgisayarımda ne kalır? (iz ve gizlilik)

- **Kodla bir kez bağlandıysanız** (bilgisayar kaydı yok, "Bilgilerimi hatırla" işaretsiz): program kapandıktan sonra
  bilgisayarınızda hiçbir şey kalmaz. Ekran sorunu yaşansa bile dosya yazılmaz.
- **Bilgisayarınız hatırlanıyorsa** veya **"Bilgilerimi hatırla"** açıksa: `%LOCALAPPDATA%\NoktaDestek` klasöründe
  şifreli ayar dosyası bulunur: 0.12 ve sonrasında `kayitlar.bin` ve yanında kilit dosyası `kayitlar.lock` (içinde kişisel
  veri yoktur); 0.10–0.11'de `hatirla.bin`. 0.12 eski dosyayı ilk açılışta `kayitlar.bin`'e taşır ve siler.
- **Windows açılışında başlat** açıksa: Windows kayıt defterinde `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` altında
  `NoktaDestek` adlı tek bir değer bulunur. **Tepside çalıştır** açıksa Windows, bildirim alanı simgelerinin geçmişini
  kendisi tutar; bu Windows'un kaydıdır, program yazmaz ve silemez.
- Aynı klasörde, **yalnız ekran görüntüsü alınamadığında** ve program yönetici olarak çalıştırılmadıysa, bir de
  **tanılama dosyası** oluşur: `tanilama.log` (dolunca eskisi `tanilama.log.1` olur; ikisi birlikte en çok 256 KB).
  - İçinde yalnız teknik bilgi vardır: tarih, program sürümü, Windows sürümü, monitör sayısı ve çözünürlüğü, ekran
    kartının adı, HDR açık mı, hangi yöntemin denendiği ve neden kodu.
  - **Adınız, telefonunuz, e-postanız, kullanıcı veya bilgisayar adınız, dosya yollarınız, sunucu adresi, kodlar ve
    anahtarlar yazılmaz.** Ekran görüntüsü de yazılmaz.
  - Dosya otomatik olarak hiçbir yere gönderilmez. Teknisyeniniz isterse dosyayı kendiniz (ör. e-postayla) iletirsiniz.
    Klasörü açmak için Windows tuşu + R'ye basın, `%LOCALAPPDATA%\NoktaDestek` yazıp Enter'a basın.
- **Pano ve uzaktan yazdırma (0.13):** teknisyenin panonuza koyduğu metin panoda kalır (Win+V geçmişine ve bulut panosuna
  düşmez). Yazdırılan belge diske yazılmaz; yalnız Windows'un yazdırma kuyruğu işi "NoktaDestek uzaktan yazdırma" adıyla
  kısa süre tutabilir. Pano metni ve belge adı tanılama dosyasına yazılmaz.
- **Silmek için:** ana ekranda **Bu bilgisayarı unut**'a tıklayın; ayar ve kilit dosyaları, tanılama dosyası, boş kalan
  klasör ve Windows açılışı kaydı silinir. Kayıt yokken **Bilgilerimi unut** da aynı şekilde her şeyi siler.

## Müşteri için: Hızlı Destek uygulaması (macOS)

Hızlı Destek'in Mac sürümü (0.19 ve sonrası), Windows sürümüyle aynı işi yapar: teknisyen ekranınızı görür, izin
verirseniz farenizi ve klavyenizi kullanır, sizinle yazışır, size dosya gönderir. Kurulum gerektirmez. Yalnız ilk
açılıştaki "Yine de Aç" onayı bir kez Mac'in yönetici parolasını ya da Touch ID'yi ister. Oturum bitince uygulama kendiliğinden kapanır ve arkada çalışan bir parçası kalmaz.

**Ne gerekir?**

- macOS 13 (Ventura) veya daha yeni bir Mac. Apple işlemcili (M1, M2, M3, M4) ve Intel işlemcili Mac'lerde aynı dosya çalışır.
- İnternet bağlantısı.
- Teknisyeninizin gönderdiği **destek bağlantısı** ya da **8 haneli destek kodu**, ya da firmanızın verdiği **firma
  bağlantısı** (0.24 ve sonrası; bkz. "Mac'te nasıl destek isterim?").
- Kod ya da bağlantıyla bağlanırken telefonda teknisyeninizle görüşüyor olmanız (kodları birbirinize okuyacaksınız).
  Firma bağlantısıyla talep gönderdiyseniz teknisyen sizi arar.

**Nasıl imzalanır?** Nokta Destek açık kaynaklıdır ve Mac sürümü **Apple Developer ID olmadan (ad-hoc) imzalanır**.
Uygulama GitHub'da derlenir ve hangi kaynak koddan derlendiği kanıtlanır (attestation). Apple'ın onay (notarize) adımı
yoktur. Bu yüzden macOS uygulamayı ilk açılışta durdurur; siz bir kez onaylarsınız (bkz. "Mac'te nasıl indirir ve
açarım?"). Bu onay ve izinler **her yeni sürümde** yeniden istenir. İleride Apple geliştirici hesabı alınırsa Mac sürümü
Apple onaylı olarak dağıtılır ve bu onay adımı kalkar.

Mac sürümü sunucuda yayımlanmamışsa destek sayfasında Mac için indirme düğmesi **görünmez**; sayfa sizi tarayıcıdan ekran
paylaşımına yönlendirir. Bu durumda teknisyen ekranınızı görür ama farenizi kullanamaz.

> **"Yine de Aç" yalnız resmi adresten indirdiğiniz uygulama için.** "Yine de Aç"ı yalnız tarayıcınızda
> remote.noktabilisim.net adresinden indirdiğiniz Nokta Destek için kullanın (Finder → Bilgi Al → "Nereden" satırı
> `https://remote.noktabilisim.net/` ile başlamalı). Firmanız size yalnız bağlantı gönderir, dosya göndermez. Dosya ek
> olarak geldiyse açmayın. Pencerede firmanızın adı ya da teknisyen doğrulama kodu görünür; bu yalnız doğru firmaya
> bağlandığınızı gösterir, dosyanın güvenli olduğunu göstermez. Uygulama açılınca karşılama penceresindeki kontrolleri
> yapın (bkz. "Doğru programla mı bağlanıyorum?").

**Mac sürümünde olmayanlar** (Windows sürümünde var; tüm platformların karşılaştırması: "Hangi programda ne var?"):

- Bilgisayar (firma) kaydı, "Bilgilerimi hatırla", tepside çalışma ve açılışta başlatma. "Destek iste" ve firma
  bağlantısı 0.24 ile Mac'te de vardır (bkz. "Mac'te nasıl destek isterim?").
- Gözetimsiz erişim (başında kimse yokken bağlanma).

Sesli görüşme ve yalnız bir pencereyi paylaşma Mac'te **0.26 ve sonrasında** vardır (bkz. "Sesli görüşme (Mac)" ve "Yalnız
bir pencereyi paylaşma (Mac)").

### Mac'te nasıl indirir ve açarım?

1. Teknisyeninizin gönderdiği destek bağlantısını Mac'inizde Safari, Chrome ya da Firefox ile açın.
2. Sayfa Mac'inizi tanır. **Hızlı Destek uygulamasını indir** düğmesine tıklayın. Düğmenin altında "macOS 13 veya üstü ·
   Apple Silicon ve Intel" yazar.
3. Tarayıcı `Destek-` ile başlayan bir zip dosyası indirir (ör. `Destek-48291376.zip`). Dosya adındaki 8 rakam destek
   kodunuzdur.
4. Safari zip dosyasını kendiliğinden açar. Açmadıysa **Finder → İndirilenler** klasöründe zip dosyasına çift tıklayın.
   Aynı adla bir klasör oluşur (ör. `Destek-48291376`). Aynı dosyayı ikinci kez indirdiyseniz klasörün adı
   `Destek-48291376 (1)` olabilir; bu da çalışır.
5. Klasörün içinde iki şey vardır: **Nokta Destek** uygulaması ve kısa bir `OKUBENI.txt` (bu bölümdeki adımların kısa
   özeti). **Nokta Destek**'e çift tıklayın.
6. macOS uygulamayı durdurur. Uyarının metnine bakın:
   - **"Nokta Destek" açılmadı** ya da **Apple uygulamayı doğrulayamadı** diyorsa **Bitti**'yi seçin (Çöp Sepetine Taşı'yı
     değil) ve 7. adıma geçin. Bu, Apple Developer ID olmadan imzalanmış uygulamalarda beklenen uyarıdır.
   - **Bilgisayarınıza zarar verir** ya da **kötü amaçlı yazılım içeriyor** diyorsa **Çöp Sepetine Taşı**'yı seçin. "Yine
     de Aç" denemeyin ve teknisyeninize bildirin.
7. **Apple menüsü → Sistem Ayarları → Gizlilik ve Güvenlik** sayfasını açın ve aşağı kaydırın. "Nokta Destek" engellendi
   satırının yanındaki **Yine de Aç**'a tıklayın.
8. Açılan pencerede yeniden **Yine de Aç**'ı seçin ve Mac parolanızı ya da Touch ID'nizi girin. Mac parolanızı yalnız bu
   adımda, Sistem Ayarları penceresinde girin; hiçbir zaman sohbete ya da teknisyene söylemeyin.
9. Nokta Destek açılır. Bu onayı bu sürüm için bir kez yaparsınız; yeni bir sürüm indirdiğinizde yeniden istenir.

**Kısa yol (yalnız macOS 13 ve 14):** Nokta Destek'e **Control** tuşuna basılı tutarak tıklayın ve
menüden **Aç**'ı seçin. macOS 15 ve sonrasında bu kısa yol çalışmaz; yalnız
Sistem Ayarları yolu (7–8. adımlar) kullanılır.

**Mac'imde yönetici parolası yok (standart kullanıcı):** "Yine de Aç" adımı bir yönetici hesabının parolasını ister.
Yönetici parolanız yoksa ve yanınızda bunu bilen biri yoksa uygulamayı açamazsınız. Bu durumda destek sayfasına dönüp
**tarayıcıdan paylaşımı** kullanın: teknisyen ekranınızı görür ama farenizi kullanamaz.

**Destek kodu nereden gelir?** Uygulama kodu, içinde bulunduğu klasörün adından (`Destek-48291376`) okur; sizden
istemez. Firma bağlantısından indirdiyseniz aynı yolla firmanızı klasör adından (`NoktaDestek-<firma adı>-…`) tanır.
Klasörü yeniden adlandırdıysanız ya da uygulamayı başka bir yere taşıdıysanız kod okunamaz. 0.24 ve sonrasında uygulama
o zaman ana ekranla açılır: **Bağlantı kodum var**'a tıklayıp teknisyeninizden aldığınız 8 haneli kodu yazın.

### Ekran Kaydı izni (ilk açılışta)

macOS, bir uygulamanın ekranı görebilmesi için sizin **Ekran Kaydı** izninizi ister. İzin olmadan teknisyen ekranınızı
göremez. Uygulama ilk açılışta bunu kontrol eder ve **Ekran Kaydı izni gerekli** penceresini gösterir.

1. **Sistem Ayarları'nı aç** düğmesine tıklayın. Sistem Ayarları, **Gizlilik ve Güvenlik → Ekran Kaydı** bölümünde açılır
   (yeni macOS sürümlerinde bölümün adı "Ekran ve Sistem Sesi Kaydı" olabilir).
2. Listede **Nokta Destek**'in yanındaki anahtarı açın. macOS Mac parolanızı ya da Touch ID'nizi isteyebilir.
3. macOS uygulamayı yeniden açmayı önerirse onun yerine Nokta Destek penceresindeki düğmeyi kullanın: kod yalnız bu yolla
   korunur.
4. Nokta Destek penceresine dönün ve **İzni verdim, yeniden başlat**'a tıklayın. Uygulama kapanıp yeniden açılır;
   **destek kodunuz korunur**, yeniden yazmanız gerekmez. Firma bağlantısından açtıysanız uygulama aynı klasörden
   açılır ve firmanızı yeniden tanır; bu izin talep göndermeden önce sorulur. Talebi gönderdikten sonra uygulama
   yeniden başlarsa talebiniz iptal olur.
5. Listede **Nokta Destek** zaten açık görünüyorsa (önceki bir sürümden kalmış olabilir) ama uygulama yine izin istiyorsa:
   satırı seçin, alttaki **−** düğmesiyle kaldırın, Nokta Destek penceresini kapatıp uygulamayı yeniden açın ve izni
   yeniden verin. Eski kayıt yeni sürüme geçmez; anahtarı kapatıp açmak yetmez.
6. **"İzni verdim, yeniden başlat" döngüye giriyorsa** (izin listede açık görünüyor ama pencere her açılışta yeniden
   geliyorsa), eski kaydı Terminal ile silin. Bu durum özellikle Mac'e daha önce eski bir sürüm kurulduysa ya da yeni
   sürüme geçildiyse görülür: izin uygulamanın o sürümdeki imzasına bağlıdır, yeni sürüm eski izni devralmaz.
   1. Nokta Destek'i **⌘Q** ile kapatın.
   2. **Terminal**'i açın (Uygulamalar → İzlenceler → Terminal) ve şu iki komutu çalıştırın:

      ```bash
      tccutil reset ScreenCapture net.noktabilisim.destek
      tccutil reset Accessibility net.noktabilisim.destek
      ```

   3. **Sistem Ayarları → Gizlilik ve Güvenlik → Ekran Kaydı** (ve **Erişilebilirlik**) listesinde Nokta Destek hâlâ
      görünüyorsa satırı seçip **−** ile kaldırın.
   4. Nokta Destek'i indirdiğiniz klasörden yeniden açın ve izni yeniden verin.

   Test sunucusundan indirilen deneme paketinde kimlik farklıdır: komutlarda `net.noktabilisim.destek.stg` yazın.

Vazgeçmek isterseniz **Vazgeç**'e tıklayın; ekranınız paylaşılmaz.

Bilmeniz gerekenler:

- **Her yeni sürümde** macOS Ekran Kaydı ve Erişilebilirlik izinlerini (0.26 ve sonrasında sesli görüşmede Mikrofon iznini de)
  yeniden isteyebilir (uygulama Apple Developer ID olmadan imzalandığı için izin o sürüme bağlıdır).
- İzin yalnız bu Mac'te ve yalnız Nokta Destek için geçerlidir. Oturum bittikten sonra da Sistem Ayarları'nda kalır;
  istediğiniz an kaldırabilirsiniz (bkz. "Mac'te verdiğim izinleri nasıl kaldırırım?").
- macOS 15 ve sonrası, ekran kaydı izni olan uygulamalar için zaman zaman "… ekranınıza erişmeye devam etsin mi?"
  hatırlatması gösterebilir. Destek sürerken izne devam etmeyi seçin; izni kapatırsanız teknisyen ekranınızı göremez.

### Karşılama, KVKK onayı ve teknisyen kabulü

Bu adımlar Windows sürümüyle aynıdır:

- **Karşılama penceresi:** teknisyenin adı, **teknisyen doğrulama kodu**, bağlanılan sunucu adresi ve firma logosu görünür.
  Kontrolleri "Doğru programla mı bağlanıyorum?" bölümündeki gibi yapın. Sizi biz aramadıysak devam etmeyin.
- **KVKK onayı:** aydınlatma metnini okuyun, adınızı yazın, onay kutusunu işaretleyip **Bağlan**'a tıklayın. Firma
  oturum kaydı açtıysa kayıt için ayrı bir kutu çıkar; işaretlemezseniz kayıt alınmaz. Hızlı Destek 0.21 ve sonrasında
  **Bağlan**'ın hemen üstünde sohbet saklama satırı yazar; satır yoksa düğme pasiftir (bkz. "KVKK onayı ve bağlanma").
- **Bekleme odası:** ekrandaki 4 haneli kabul kodunu telefonda teknisyene okuyun.
- **Ekran seçimi:** birden fazla ekranınız varsa paylaşılacak ekranı seçersiniz. 0.26 ve sonrasında bu pencere tek ekranda
  da açılır ve **Tüm ekran** ile **Yalnız bir pencere** arasında seçim sunar (bkz. "Yalnız bir pencereyi paylaşma (Mac)").

Uygulama menüsünde (**Nokta Destek**) **Hakkında** ve **Lisanslar** bulunur. **Hakkında** penceresinde sürüm, sunucu
adresi, **parmak izi** (uygulama dosyasının özetinin ilk 8 karakteri) ve imza satırı yazar. Canlı sürümde imza satırı
**"İmza: ad-hoc (Apple Developer ID yok)"** olur; bu beklenen değerdir. İmza okunamazsa satırda "İmza: doğrulanamadı" yazar.
Şirketinizin BT sorumlusu parmak izini ve zip dosyasının SHA-256 özetini GitHub sürüm
sayfasındaki `SHA256SUMS` dosyasıyla karşılaştırabilir; kökeni GitHub attestation kaydıyla doğrulanır.

### Oturum sırasında ne görürüm?

- Her ekranınızın kenarında **kırmızı çerçeve** ve üstte **"Ekranınız izleniyor — <teknisyen adı>"** yazısı bulunur
  (kontrol izni verdiyseniz **"Uzaktan kontrol aktif — <teknisyen adı>"**). Bu gösterge gizlenemez: uygulamayı gizleseniz (⌘H), küçültmeye çalışsanız ya da başka bir masaüstüne
  geçseniz de görünür kalır. Yeni bir ekran takarsanız gösterge oraya da gelir.
- Gösterge herhangi bir nedenle ekranda gösterilemezse uzaktan kontrol güvenlik için kendiliğinden kapanır ve oturum
  penceresinde "Oturum göstergesi ekranda gösterilemediği için uzaktan kontrol kapatıldı." yazar.
- **Nokta Destek — Oturum** penceresinde bağlantı durumu, sohbet, dosya aktarımları, bağlı teknisyenler ve **Erişime izin
  ver**, **Kontrolü kapat**, **Oturumu bitir** düğmeleri bulunur. Bu pencere küçültülemez. Sohbet 0.21 ve sonrasında
  açıktır (bkz. "Hızlı Destek'te oturum sohbeti").
- Pencereler Mac'inizin açık/koyu görünümüne kendiliğinden uyar.

### Teknisyen Mac'imi kullanmak isterse (Erişilebilirlik izni)

macOS, bir uygulamanın fareyi ve klavyeyi yönetebilmesi için **Erişilebilirlik** izni ister. Bu izin yalnız teknisyen
kontrol istediğinde gerekir; yalnız ekran paylaşımı için gerekmez.

**İzin yoksa:** teknisyen kontrol istediğinde **Kontrol için Erişilebilirlik izni gerekli** penceresi açılır.

1. **Sistem Ayarları → Gizlilik ve Güvenlik → Erişilebilirlik** bölümünü açın.
2. Listede **Nokta Destek**'in anahtarını açın (Mac parolanız ya da Touch ID istenebilir).
3. Teknisyene "izni verdim" deyin; teknisyen kontrolü **yeniden** ister.

Listede **Nokta Destek** açık göründüğü hâlde kontrol çalışmıyorsa (önceki bir sürümden kalmış kayıt): satırı seçip **−**
ile kaldırın ve uygulamayı yeniden açın. Teknisyen kontrolü yeniden istediğinde açılan pencerede **Sistem Ayarları'nı aç**
düğmesine basın; **Nokta Destek** listede yeniden görünür, anahtarını açın. Listeye "+" ile kendiniz eklemeyin (yanlış ya
da eski bir kopyayı seçebilirsiniz).

Bu sırada ekran paylaşımı, sohbet ve dosya aktarımı çalışmaya devam eder. Teknisyen konsolunda "Müşterinin bilgisayarı
uzaktan kontrole izin vermiyor (Mac'te erişilebilirlik izni). Müşteri izni verdikten sonra yeniden isteyin." yazar; bu bir ret sayılmaz, teknisyen hemen yeniden
isteyebilir. Uygulamayı yeniden başlatmanız gerekmez. İzin verdiğiniz hâlde kontrol açılmıyorsa **Oturumu bitir** ile
çıkıp uygulamayı yeniden açın ve teknisyenden yeni bağlantı isteyin.

**İzin varsa:** ekranınızda **Uzaktan kontrol isteği** penceresi açılır. Kurallar Windows sürümüyle aynıdır, şu
farklarla:

- **İzin ver**'e yalnız **kendi farenizle ya da izleme dörtgeninizle (trackpad)** tıklayabilirsiniz. Klavyeyle izin
  verilemez: Enter ve Boşluk tuşu isteği **reddeder**.
- Düğme ilk **1,5 saniye** çalışmaz; pencere imlecinizin hemen altında açılmaz.
- Teknisyenin uzaktan yaptığı tıklama sayılmaz; böyle bir tıklamada pencere açık kalır.

**Kontrolü geri almak için** (istediğiniz an):

- Oturum penceresinde **Kontrolü kapat**'a tıklayın, **veya**
- Klavyede **Control+Shift+F12**'ye basın. Hangi uygulama önde olursa olsun çalışır. Bu kısayolu başka bir uygulama
  kullanıyorsa yerine **Control+Shift+F11** atanır; geçerli olanı oturum penceresinde yazar.
- **Dizüstü Mac'te** F tuşları genellikle parlaklık ve ses tuşu olarak çalışır. O zaman **fn** tuşunu da basılı tutun:
  **fn+Control+Shift+F12**.
- Kendi farenizi ya da klavyenizi kullandığınızda teknisyenin hareketi yaklaşık 1 saniye durur. Mac her zaman önce sizi
  dinler.

Kısayol hiç kaydedilemezse (iki kombinasyonu da başka uygulamalar kullanıyorsa) güvenliğiniz için kontrol izni verilemez;
teknisyen yalnız ekranı görür.

**Şunları bilin:**

- Mac'iniz kilitliyken ya da başka bir kullanıcıya geçildiğinde teknisyen konsolunda "Müşteri güvenli masaüstünde" yazar.
  Kilidi siz açarsınız.
- Bir **parola alanına** tıkladığınızda macOS klavye girişini korumaya alır. Bu sırada teknisyen o alana yazamaz;
  parolanızı siz yazın. Teknisyenlerimiz parolanızı hiçbir zaman sormaz.
- Teknisyen kısayolu ile Mac'inizin ekranını kilitleyemez (Control+⌘+Q iletilmez).

### Klavyesiz kullanım, VoiceOver ve Fare Tuşları

Güvenliğiniz için bazı düğmeler **yalnız gerçek bir fare ya da izleme dörtgeni tıklamasıyla** çalışır. Böylece ne
teknisyen ne de bilgisayardaki başka bir program bu düğmelere sizin yerinize basabilir. Korunan düğmeler:

- Uzaktan kontrol ve ekran değiştirme isteğinde **İzin ver**, oturum penceresindeki **Erişime izin ver**
- Dosya teklifinde **Kabul et**, yazdırma isteğinde **Yazdır**
- **Pano paylaşımına izin ver** kutusu
- Bağlı teknisyenler listesindeki **Çıkar** ve onayı
- Oturum kaydı izin kutusu
- Sesli görüşme isteğinde **Kabul et**, ses satırındaki **Mikrofonu aç** ve **Mikrofon izni gerekli** penceresindeki
  **Sistem Ayarları'nı aç** (0.26 ve sonrası)

Bu düğmeler **VoiceOver**, **Fare Tuşları**, Sesle Denetim, Anahtar Denetimi ya da klavye ile **çalışmaz**. Bu bir hata
değil, bilinçli bir güvenlik önlemidir. Bu araçlarla çalışıyorsanız bu onaylar için gerçek bir fare ya da izleme dörtgeni
kullanın veya yanınızdaki birinden yardım isteyin.

Güvenli yöne işleyen düğmeler klavyeyle de çalışır: **Kontrolü kapat**, **Oturumu bitir**, **Kaydı durdur**, **Sessize al**,
**Görüşmeyi bitir**. Paylaşım seçim penceresi (**Tüm ekran** / **Yalnız bir pencere**, pencere listesi, **Listeyi yenile**,
**Paylaş**) fareyle ya da klavyeyle (Tab ve Boşluk) kullanılır; VoiceOver öğelerin adını okur.

**Klavye ile gezinme:** macOS'ta Tab tuşu düğmeler arasında yalnız **Sistem Ayarları → Klavye → Klavye ile gezinme**
açıkken dolaşır. Kapalıysa Tab yalnız metin kutuları arasında geçer.

**Fare Tuşları açıksa:** Fare Tuşları (Sistem Ayarları → Erişilebilirlik → İşaretçi Denetimi) açıkken teknisyen sayısal tuş
takımını ve `7 8 9 U I O J K L M .` tuşlarını kullanamaz; bu tuşlar macOS'ta fareyi oynatır ve tıklar. Teknisyen ayrıca
Nokta Destek pencerelerinin üzerinde bu tuşlara hiç basamaz. Bu harfleri yazmak gerekiyorsa siz yazın.

### Yalnız bir pencereyi paylaşma (Mac, 0.26 ve sonrası)

Teknisyenin bütün ekranınızı değil yalnız bir programın penceresini görmesini istiyorsanız bunu kullanın.

**Nasıl yalnız bir pencere paylaşırım?**

1. Paylaşım başlarken **Teknisyenle neyi paylaşmak istiyorsunuz?** penceresi açılır (tek ekranda da). **Tüm ekran** seçili
   gelir.
2. **Yalnız bir pencere**'yi seçin. Altındaki listede açık pencereleriniz "Başlık — Program adı" biçiminde görünür.
3. Paylaşmak istediğiniz pencereyi seçin ve **Paylaş**'a tıklayın. Ekranın üstündeki yazı **"Paylaştığınız pencere izleniyor
   — <teknisyen adı>"** olur.

**Pencerem listede yok.** Listede yalnız bu masaüstünde ekranda görünen pencereler bulunur. Şunlar listede **görünmez**:

- **Küçültülmüş (Dock'a indirilmiş) pencereler** ve gizlenmiş (⌘H) programlar. Windows'taki gibi "(simge durumunda)" satırı
  Mac'te yoktur. Pencereyi Dock'tan geri açın, sonra **Listeyi yenile**'ye tıklayın.
- Başka bir masaüstündeki (Space) ve tam ekran çalışan pencereler. Pencereyi bu masaüstüne getirin ya da tam ekrandan
  çıkın, sonra **Listeyi yenile**'ye tıklayın.
- Nokta Destek'in kendi pencereleri, Dock, menü çubuğu, Denetim Merkezi ve başlığı olmayan küçük pencereler.

Liste boşsa "Paylaşılabilecek pencere yok — programı açıp Listeyi yenile'ye tıklayın" yazar ve **Paylaş** pasif kalır.
Pencere başlıkları yalnız sizin ekranınızda görünür; teknisyene ya da sunucuya gönderilmez.

**Ne olur?**

- Teknisyen yalnız seçtiğiniz pencerenin içini görür. **Menü çubuğu** (ekranın en üstündeki Dosya, Düzen… menüleri) ve bu
  pencereden açılan yeni pencereler teknisyene görünmez. Seçim ekranında da bu uyarı yazılıdır. Teknisyen bir menü komutuna
  ihtiyaç duyarsa menüyü siz açın ya da teknisyen klavye kısayolunu kullansın.
- Uzaktan kontrol izni verirseniz teknisyenin faresi ve klavyesi **yalnız bu pencerede** çalışır. Siz başka bir programa
  geçerseniz teknisyenin yazdıkları o programa gitmez ve sonradan da yazılmaz.
- Pencereye bağlı "Kaydedilsin mi?" gibi sayfalar teknisyen tarafından kullanılabilir. **Kaydet / Aç pencerelerini siz
  kullanın:** bu pencere macOS'ta çoğu zaman ayrı bir programdır; teknisyen onu göremeyebilir ve tıklayamaz.
- Ekrana çizim (işaretleme) ve ekran değiştirme pencere modunda yoktur.

**Pencereyi küçültürsem, gizlersem ya da kapatırsam?**

- **Küçültürseniz, gizlerseniz (⌘H), başka bir masaüstüne geçerseniz ya da pencereyi tam ekran yaparsanız:** teknisyen siyah
  bir ekran ve "Pencere simge durumunda" yazısı görür; bu sırada fare ve klavyesi hiçbir şey yapamaz. Pencere yeniden
  göründüğünde görüntü ve kontrol birkaç saniye içinde kendiliğinden döner.
- **Kapatırsanız** (ya da program ⌘Q ile kapanırsa): paylaşım durur ve program kendiliğinden tüm ekrana **geçmez**. Devam
  etmek için oturumu bitirip yeniden bağlanın.
- **Taşır veya boyutunu değiştirirseniz:** görüntü yeni boyuta uyar.

### Pencere modunda iletilmeyen kısayollar (Mac)

Teknisyen pencere modunda paylaşılan programın dışına çıkamasın diye bazı tuş birleşimleri Mac'inize **iletilmez**:

- **İki ya da daha fazla değiştiriciyle** (⌘, ⌥ Option, Control) basılan her kısayol. Örnekler: Control+⌘+Q (ekranı
  kilitle), ⌥⌘Esc (Çıkmaya Zorla), ⌥⇧⌘Q, Control+⌘+Space (karakter görüntüleyici), Control+⌘+F (tam ekran), ⌥⌘D (Dock'u
  gizle).
- ⌘Space (Spotlight), ⌘Tab ve ⌘\` (program / pencere değiştirme), ⌘ ile F tuşları (ör. ⌘F5 VoiceOver).
- Control ile ok tuşları (masaüstleri arası geçiş), Control+Space, Control+Tab, Control+Esc, Control ile F tuşları ve Control
  ile harfler.
- ⌥Space; ⌥ ile noktalama işaretleri.
- ⇧⌘Q (oturumu kapat), ⇧⌘3, ⇧⌘4, ⇧⌘5, ⇧⌘6 (ekran görüntüsü).
- Tek başına F3 (Görev Kontrolü), F4 (Launchpad), F11 (masaüstünü göster).
- Art arda beş kez ⇧ ya da ⌥ basma (Yapışkan Tuşlar / Fare Tuşları kısayolu).
- Mac'inizde **Yapışkan Tuşlar** açıksa Tab, Esc, Boşluk, ok ve F tuşları da gitmez; **Fare Tuşları** açıksa sayısal tuş
  takımı ve `7 8 9 U I O J K L M .` tuşları gitmez.

**Çalışanlar:** normal yazı ve ⇧ ile yazı; ⌘C, ⌘V, ⌘X, ⌘Z, ⇧⌘Z, ⌘A, ⌘S, ⇧⌘S gibi tek ⌘ kısayolları; ⌥ ile harf ve rakam
(özel karakterler). Windows kullanan teknisyen AltGr ile `@ # { } [ ] \ |` gibi karakterleri yazabilir. ⌘W ve ⌘Q da
çalışır; paylaşılan programı kapatırlarsa paylaşım durur.

### Sesli görüşme (Mac, 0.26 ve sonrası)

Teknisyen oturum sırasında sizinle sesli konuşmak isteyebilir. Akış tarayıcı ve Windows ile aynıdır (bkz. "Sesli görüşme").
Ses kaydedilmez.

1. "<Ad> sesli görüşme istiyor" penceresi açılır. Pencerede kimlerin dinleyeceği ve kulaklık önerisi yazar.
2. Düğmeler **1,5 saniye** sonra etkinleşir. **Kabul et**'e yalnız **kendi farenizle ya da izleme dörtgeninizle**
   tıklayabilirsiniz; Enter ve Boşluk isteği reddeder. Teknisyen uzaktan kontrolle sizin yerinize kabul edemez.
3. İlk görüşmede macOS **"Nokta Destek" mikrofona erişmek istiyor** diye sorar. **İzin Ver**'i seçin. Bu soru açıkken
   teknisyenin fare ve klavyesi durur. Yalnız Nokta Destek açıkken ve siz Kabul'e tıkladıktan sonra çıkan istemde izin
   verin.
4. Mikrofon açılır. Ekranın üstündeki gösterge yazısına **"● Mikrofon açık"** eklenir; macOS da menü çubuğunda turuncu bir
   mikrofon işareti gösterir. Oturum penceresinde ses satırı görünür: "● Mikrofon açık · Konuşan: … · Dinleyen: …",
   **Sessize al** ve **Görüşmeyi bitir**.
5. **Sessize al** ile sesinizi kesersiniz; **Mikrofonu aç** yalnız kendi farenizle çalışır. **Görüşmeyi bitir** ile
   görüşmeyi istediğiniz an kapatırsınız; mikrofon hemen kapanır.

Bilmeniz gerekenler:

- **Kulaklık kullanın.** Mac'in kendi hoparlörü ve mikrofonuyla yankı olabilir.
- Gösterge ekranda gösterilemezse güvenlik için görüşme kendiliğinden biter.
- Yeni biri dinlemeye başlarsa sohbette "<Ad> görüşmeyi dinlemeye başladı" yazar.
- Sesli görüşme macOS 14 ve 15'te denenmiştir; macOS 13'te doğrulanmadı. Mac'iniz sesi desteklemiyorsa teknisyenin düğmesi
  pasif kalır, oturumun geri kalanı etkilenmez.

**Mikrofon izni yoksa ya da mikrofon açılamazsa:** görüşme başlamaz, ekran paylaşımı ve sohbet sürer. Oturum penceresinde
"Mikrofonunuz açılamadı. Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon altında Nokta Destek açık olmalı; teknisyen
yeniden isteyebilir." yazar ve **Mikrofon izni gerekli** penceresi açılır. Yalnız dinleme kipi yoktur.

1. **Sistem Ayarları'nı aç**'a kendi farenizle tıklayın. Sistem Ayarları **Gizlilik ve Güvenlik → Mikrofon** bölümünde
   açılır.
2. Listede **Nokta Destek**'in anahtarını açın.
3. Teknisyene söyleyin; teknisyen görüşmeyi yeniden ister (30 saniye sonra).

**Listede açık görünüyor ama ses gitmiyorsa** (çoğunlukla yeni sürüme geçince; izin eski sürüme bağlı kalır):

1. Nokta Destek'i **⌘Q** ile kapatın.
2. **Terminal**'i açın ve yalnız şu komutu aynen çalıştırın:

   ```bash
   tccutil reset Microphone net.noktabilisim.destek
   ```

3. Nokta Destek'i indirdiğiniz klasörden yeniden açın. Teknisyen görüşmeyi yeniden istediğinde **Kabul et**'e, sonra
   macOS'un sorduğu istemde **İzin Ver**'e tıklayın.

Test sunucusundan indirilen deneme paketinde komut `tccutil reset Microphone net.noktabilisim.destek.stg` olur. Mikrofon
listesinde eski kaydı kaldıran **−** düğmesi her macOS sürümünde bulunmayabilir; Terminal komutu her zaman çalışır. Bu
komutlardan başka bir Terminal komutu (yönetici parolası isteyen ya da sistem korumasını kapatan komutlar dahil) önerilirse
uygulamayın ve teknisyeninize bildirin.

### Pano paylaşımı (Mac)

Windows sürümündeki gibi çalışır (bkz. "Teknisyenle pano paylaşımı"), şu farklarla:

- **Pano paylaşımına izin ver** kutusunu yalnız **kendi farenizle** işaretleyebilirsiniz; Boşluk tuşu çalışmaz.
- Teknisyenin panonuza koyduğu metin yalnız bu Mac'te kalır; iPhone'unuza ya da diğer Apple aygıtlarınıza (Evrensel Pano)
  geçmez.
- Parola yöneticinizin gizli ya da geçici olarak işaretlediği içerik okunmaz; ekranda "Pano gizli içerik taşıyor,
  gönderilmedi" yazar.

### Teknisyen belge yazdırmak isterse (Mac)

Teknisyen bir PDF belgeyi Mac'inizin **varsayılan yazıcısından** bastırabilir. Her belge için onayınız istenir.

1. **Uzaktan yazdırma** penceresinde teknisyenin adı, dosya adı, dosya boyutu, **"Sayfa sayısı: yazıcıda belirlenir"** ve
   **"Yazıcı: Varsayılan yazıcı"** yazar. Mac sürümü belgeyi açıp sayfalarını saymaz ve yazıcınızın adını göstermez; bu
   güvenlik gereğidir. Kaç sayfa olduğunu merak ediyorsanız teknisyene sorun.
2. Beklemiyorsanız **Reddet**'e tıklayın (Enter ve Boşluk da reddeder). Bekliyorsanız **kendi farenizle** **Yazdır**'a
   tıklayın (ilk 1,5 saniye çalışmaz).
3. Belge varsayılan yazıcınıza tek kopya gider. Varsayılan yazıcı **Sistem Ayarları → Yazıcılar ve Tarayıcılar →
   Varsayılan yazıcı** bölümünde seçilir.

Diğer durumlar:

- Mac'inizde varsayılan yazıcı yoksa pencere yine açılır; **Yazdır**'a bastıktan sonra belge gönderilemez ve teknisyen
  "Müşterinin varsayılan yazıcısı yok" görür.
- 60 saniye yanıt vermezseniz istek reddedilmiş sayılır. Uzaktan kontrolü kapatırsanız bekleyen yazdırma iptal olur.
- Belge diskinize kaydedilmez. Ancak macOS yazdırma sistemi (CUPS) işi **"Nokta Destek"** adıyla kendi yazdırma geçmişinde
  tutar (yazıcının kuyruk penceresinde ya da `lpstat -W completed` komutuyla görünür). Bu kaydı macOS tutar; uygulama
  silemez.

### Teknisyen dosya gönderirse (Mac)

- Kabul ettiğiniz dosya **İndirilenler** klasörünüze kaydedilir. macOS ilk seferde "Nokta Destek, İndirilenler
  klasörünüzdeki dosyalara erişmek istiyor" diye sorabilir; dosyayı almak için **İzin Ver**'i seçin.
- Gelen her dosya "internetten indirildi" olarak işaretlenir. Bir uygulama ya da betik dosyasını açtığınızda macOS sizi
  uyarır. Dosyayı beklemiyorsanız açmayın; teknisyene sorun.
- Uygulama paketleri, kurulum dosyaları (`.pkg`, `.dmg`), betikler (`.command`, `.sh` vb.) ve adı nokta ile başlayan
  gizli dosyalar ek uyarıyla gelir.

### Oturumu kapatma (Mac)

- **Oturumu bitir**'e tıklayın. Teknisyen ekranınızı artık göremez; uygulama birkaç saniye içinde kendiliğinden kapanır.
- Teknisyen oturumu bitirdiğinde de "Destek oturumu sona erdi" yazar ve uygulama kapanır.
- Bitiş ekranındaki **İzinleri kaldırma** düğmesi Sistem Ayarları'nın Ekran Kaydı bölümünü açar.
- Oturum bitince `Destek-…` klasörünü ve zip dosyasını İndirilenler'den **silin** (çöp sepetine atıp boşaltın). Eski
  sürümler verdiğiniz izinleri korur; bir sonraki destekte yeni bağlantıyla güncel sürüm yeniden indirilir.

### Mac'imde ne kalır ve verdiğim izinleri nasıl kaldırırım?

Uygulama kapanınca Mac'inizde şunlar **kalmaz**: ayar dosyası, tanılama dosyası, önbellek, pencere geri yükleme bilgisi,
yeniden başlatma için kullanılan geçici kod dosyası. Mac sürümü tanılama dosyası hiç yazmaz.

Kalanlar:

- İndirdiğiniz `Destek-….zip` ya da `NoktaDestek-<firma adı>-….zip` ve aynı adlı klasör (oturum bitince siz silin; firma
  zip'ini de saklamayın, her destek isteğinde yeniden indirin).
- Teknisyenden aldığınız dosyalar (İndirilenler'de).
- Verdiğiniz **Ekran Kaydı**, **Erişilebilirlik** ve (sesli görüşme yaptıysanız) **Mikrofon** izinleri (macOS tutar).
- Yazdırma yaptıysanız macOS'un yazdırma geçmişindeki iş kaydı.

**İzinleri kaldırmak için (önerilen yol):**

1. **Sistem Ayarları → Gizlilik ve Güvenlik → Ekran Kaydı** (yeni sürümlerde "Ekran ve Sistem Sesi Kaydı") bölümünü açın.
2. Listede **Nokta Destek**'i seçin ve alttaki **−** düğmesine basın (macOS sürümünüzde düğme yoksa anahtarı kapatın).
3. Aynısını **Gizlilik ve Güvenlik → Erişilebilirlik** bölümünde yapın. Mikrofon izni için **Mikrofon** bölümünde anahtarı
   kapatın ya da aşağıdaki Terminal komutunu kullanın.

**Terminal ile (BT sorumlusu için):**

```bash
tccutil reset ScreenCapture net.noktabilisim.destek
tccutil reset Accessibility net.noktabilisim.destek
tccutil reset Microphone net.noktabilisim.destek
```

Bu komutlardan başka bir Terminal komutu (yönetici parolası isteyen ya da sistem korumasını kapatan komutlar dahil)
önerilirse uygulamayın.

İzinleri kaldırdıktan sonra Nokta Destek'i yeniden kullanırsanız macOS izinleri yeniden sorar.

> **Yalnız test ortamı için (gerçek müşterilere verilmez).** Test sunucusundan indirilen Mac pakette tüm pencerelerde ve
> ekranın üstünde gizlenemeyen **"TEST SÜRÜMÜ — imzasız"** bandı görünür; destek sayfasında da "TEST SÜRÜMÜ" uyarısı çıkar.
> Açılış adımları ("Bitti", Gizlilik ve Güvenlik → Yine de Aç) canlı sürümle aynıdır. Test paketinin kimliği farklıdır;
> izinlerini kaldırmak için: `tccutil reset ScreenCapture net.noktabilisim.destek.stg`,
> `tccutil reset Accessibility net.noktabilisim.destek.stg` ve
> `tccutil reset Microphone net.noktabilisim.destek.stg`. Canlı sürümde bu bant görünmez.

### Sık karşılaşılan durumlar (Mac)

| Durum                                                                            | Ne yapmalı                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Destek sayfasında Mac için indirme düğmesi yok                                   | Mac sürümü bu sunucuda yayımlanmamış. **Tarayıcıdan** ekranınızı paylaşın.                                                                                                                                                                                                                                                                                                                               |
| macOS "açılmadı" / "doğrulanamadı" diyor                                         | Beklenen uyarı. **Bitti**'yi seçin, Sistem Ayarları → Gizlilik ve Güvenlik → **Yine de Aç** (bkz. "Mac'te nasıl indirir ve açarım?").                                                                                                                                                                                                                                                                    |
| macOS "zarar verir" / "kötü amaçlı yazılım içeriyor" diyor                       | **Çöp Sepetine Taşı**'yı seçin, "Yine de Aç" denemeyin, teknisyeninize bildirin.                                                                                                                                                                                                                                                                                                                         |
| "Yine de Aç" parola istiyor, yönetici parolam yok                                | Standart kullanıcı uygulamayı açamaz. Destek sayfasından **tarayıcıdan paylaşımı** kullanın.                                                                                                                                                                                                                                                                                                             |
| Yeni sürümde yine "Yine de Aç" ve izinler istendi                                | Normaldir; her yeni sürümde onay ve izinler bir kez yeniden verilir.                                                                                                                                                                                                                                                                                                                                     |
| İzin listede açık görünüyor ama uygulama yine izin istiyor                       | Eski sürümün kaydı. Satırı seçip **−** ile kaldırın, uygulamayı yeniden açın, izni yeniden verin.                                                                                                                                                                                                                                                                                                        |
| Uygulama kodu soruyor ya da ana ekranda **Destek iste** pasif                    | Klasör adı değişmiş ya da uygulama taşınmış. 0.24 ve sonrasında **Bağlantı kodum var**'a tıklayıp teknisyeninizden aldığınız 8 haneli kodu yazın.                                                                                                                                                                                                                                                        |
| Firma bağlantısından açtım ama **Destek iste** pasif                             | Zip'i yeniden açın ya da firma bağlantısından yeniden indirin; klasörü yeniden adlandırmayın, uygulamayı klasörden çıkarmayın.                                                                                                                                                                                                                                                                           |
| "Bu dosya artık geçerli değil" (Mac)                                             | Firmanız bağlantıyı yenilemiş. Firmanızdan yeni bağlantıyı isteyin ve oradan yeniden indirin; eski klasörü silin.                                                                                                                                                                                                                                                                                        |
| Bilgi Al'daki "Nereden" satırı `https://remote.noktabilisim.net/` ile başlamıyor | Uygulamayı açmayın, "Yine de Aç" demeyin. Firmanızı telefonla arayın.                                                                                                                                                                                                                                                                                                                                    |
| "Ekran Kaydı izni gerekli" ekranı tekrar tekrar geliyor                          | Anahtar kapalıysa açıp **İzni verdim, yeniden başlat**'a tıklayın. Anahtar açık olduğu hâlde döngü sürüyorsa: uygulamayı ⌘Q ile kapatın, Terminal'de `tccutil reset ScreenCapture net.noktabilisim.destek` ve `tccutil reset Accessibility net.noktabilisim.destek` çalıştırın, listede kalan kaydı **−** ile kaldırın, uygulamayı klasörden yeniden açıp izni verin (bkz. "Ekran Kaydı izni", 6. adım). |
| Güncellemeden ya da yeni sürümü indirdikten sonra izin çalışmıyor                | İzin eski sürüme bağlı kalmıştır. Yukarıdaki satırdaki Terminal adımlarını uygulayın.                                                                                                                                                                                                                                                                                                                    |
| "Kontrol için Erişilebilirlik izni gerekli"                                      | Erişilebilirlik listesinde Nokta Destek'i açın; teknisyenden kontrolü yeniden istemesini isteyin.                                                                                                                                                                                                                                                                                                        |
| "Uzaktan kontrol kapatıldı: macOS girdi iznini ya da izlemesini durdurdu."       | Erişilebilirlik izni kaldırılmış ya da macOS denetimi durdurmuş. İzni kontrol edin; teknisyen kontrolü yeniden ister.                                                                                                                                                                                                                                                                                    |
| **İzin ver** / **Yazdır** / pano kutusu tepki vermiyor                           | 1,5 saniye bekleyin, sonra gerçek fare ya da izleme dörtgeniyle tıklayın. VoiceOver, Fare Tuşları ve klavye bu düğmelerde çalışmaz.                                                                                                                                                                                                                                                                      |
| Control+Shift+F12 çalışmıyor                                                     | Dizüstünde **fn** ile birlikte basın. Oturum penceresinde F11 yazıyorsa Control+Shift+F11 kullanın. Her zaman **Kontrolü kapat** düğmesi de çalışır.                                                                                                                                                                                                                                                     |
| Teknisyen bazı harfleri yazamıyor                                                | Fare Tuşları açık olabilir. Kapatın ya da o harfleri siz yazın.                                                                                                                                                                                                                                                                                                                                          |
| Teknisyen sesli görüşme başlatamıyor                                             | Sesli görüşme Mac'te 0.26 ve sonrasında vardır. Eski uygulamada düğme pasiftir; güncel uygulamayı destek sayfasından yeniden indirin.                                                                                                                                                                                                                                                                    |
| "Mikrofon izni gerekli" / "Mikrofonunuz açılamadı"                               | Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon → Nokta Destek anahtarını açın; açık olduğu hâlde ses gitmiyorsa ⌘Q, Terminal'de `tccutil reset Microphone net.noktabilisim.destek`, uygulamayı yeniden açın (bkz. "Sesli görüşme (Mac)").                                                                                                                                                             |
| Paylaşmak istediğim pencere listede yok                                          | Pencere küçültülmüş, gizlenmiş, başka masaüstünde ya da tam ekranda olabilir. Pencereyi bu masaüstünde açın, sonra **Listeyi yenile**.                                                                                                                                                                                                                                                                   |
| Teknisyen siyah ekran ve "Pencere simge durumunda" görüyor                       | Paylaşılan pencere küçültülmüş, gizlenmiş, tam ekran ya da başka masaüstünde. Pencereyi geri açın.                                                                                                                                                                                                                                                                                                       |
| Teknisyen Kaydet / Aç penceresini göremiyor ya da tıklayamıyor                   | Pencere modunda bu pencereyi siz kullanın.                                                                                                                                                                                                                                                                                                                                                               |

### Super Admin için: Mac sürümünün yayını (not)

Mac sürümü panelden değil, sunucu operatörünün çalıştırdığı yayın betiğiyle (`deploy/agent/publish-mac.sh`) yayımlanır.
Betik GitHub sürümündeki zip'in kökenini (attestation) ve özetini doğrulamadan yayımlamaz; imza türünü (`adhoc`) sunucu
ayarına kendisi yazar. Bu ayar elle değiştirilmez. Yayından sonra destek sayfası Mac müşterisine yukarıdaki "Yine de Aç"
rehberini gösterir. Yayını geri çekmek de betikle yapılır; ayrıntı `docs/runbook.md` §28f.9.

---

## Müşteri için: Hızlı Destek uygulaması (Linux)

Hızlı Destek'in Linux sürümü (0.20 ve sonrası), Windows ve Mac sürümüyle aynı işi yapar: teknisyen ekranınızı görür,
izin verirseniz farenizi ve klavyenizi kullanır, size dosya gönderir, sizinle sesli konuşabilir. Program tek bir
dosyadır. Kurulum gerektirmez, yönetici (root) şifresi istemez. Oturum bitince program kapanır ve arkada çalışan bir
parçası kalmaz.

**Ne gerekir?**

- **Ubuntu 22.04 ya da 24.04 LTS**, 64 bit Intel/AMD işlemcili (x86_64) bir bilgisayar ve Ubuntu'nun standart masaüstü
  (GNOME). Diğer dağıtımlar, diğer masaüstleri ve ARM işlemcili bilgisayarlar desteklenmez.
- İnternet bağlantısı.
- Teknisyeninizin gönderdiği **destek bağlantısı** ya da **8 haneli destek kodu**.
- Telefonda teknisyeninizle görüşüyor olmanız (kodları birbirinize okuyacaksınız).

**Ne zaman kullanılabilir?** Linux sürümü sunucuda yayımlandığında destek sayfası Ubuntu bilgisayarınızı tanır ve indirme
düğmesini gösterir. Yayımlanmadıysa, ya da bilgisayarınız desteklenen türde değilse (ör. ARM işlemcili Linux, Chromebook)
sayfa yalnız **tarayıcıdan ekran paylaşımı** sunar. Bu yolda teknisyen ekranınızı görür ama farenizi kullanamaz.

**Linux sürümünde olmayanlar:**

- Yalnız bir pencereyi paylaşma (her zaman bir ekranın tamamı paylaşılır).
- Oturum sohbeti (yalnız 0.20'de yoktur; 0.21 ve sonrasında oturum penceresinde sohbet vardır). 0.20'de teknisyenle
  telefonda konuşun ya da sesli görüşmeyi kullanın.
- "Destek iste", firma kaydı, "Bilgilerimi hatırla", tepside çalışma ve açılışta başlatma. Linux'ta yalnız teknisyenin
  verdiği bağlantı ya da kodla bağlanılır.
- Gözetimsiz erişim (başında kimse yokken bağlanma).

### Ekranımın türü X11 mi, Wayland mı?

Ubuntu iki tür masaüstü oturumu açabilir. Program ikisinde de çalışır ama bazı adımlar farklıdır:

| Konu                       | X11 ("Ubuntu on Xorg")                               | Wayland (Ubuntu'nun varsayılanı)                                                         |
| -------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Ekran seçimi               | Nokta Destek kendi **Ekran seçimi** penceresini açar | Ubuntu'nun sistem izin penceresi açılır; ekranı orada seçersiniz                         |
| Uzaktan kontrol            | Windows sürümüyle aynı                               | Yalnız sistem izin penceresinde **Uzaktan etkileşime izin ver** açıksa; sınırlar aşağıda |
| Kontrolü kısayolla kapatma | **Ctrl+Shift+F12** (yedek Ctrl+Shift+F11)            | Kısayol yok: üst çubuktaki ekran paylaşımı simgesi → **Durdur**, ya da **Super+L**       |
| Kendi farenizi oynatmak    | Teknisyenin hareketi yaklaşık 1 saniye durur         | Teknisyenin hareketini **durdurmaz**                                                     |

Hangisinde olduğunuzu öğrenmek için: **Ayarlar → Sistem → Hakkında** (22.04'te **Ayarlar → Hakkında**) ekranında
"Pencereleme Sistemi" satırına bakın. Giriş ekranında, şifrenizi yazmadan önce sağ alttaki dişli simgesinden
"Ubuntu on Xorg" (X11) seçebilirsiniz.

### Linux'ta nasıl indirir ve açarım?

1. Teknisyeninizin gönderdiği destek bağlantısını Ubuntu bilgisayarınızda Firefox ya da Chrome ile açın.
2. Sayfa bilgisayarınızı tanır. **Hızlı Destek uygulamasını indir** düğmesine tıklayın. Düğmenin altında "Ubuntu 22.04 /
   24.04 · 64 bit (x86_64) · GNOME" yazar.
3. Tarayıcı `Destek-` ile başlayan, **uzantısız** bir dosya indirir (ör. `Destek-48291376`). Dosya adındaki 8 rakam destek
   kodunuzdur. Dosya **İndirilenler** klasörüne kaydedilir.
4. Sayfadaki **Linux'ta nasıl çalıştırılır?** rehberini izleyin. İndirilen dosyaya bir kez **çalıştırma izni** vermeniz
   gerekir. Bunun için iki yol vardır.

**Terminal ile (önerilen, tek adım):**

1. Terminal'i açın (**Ctrl+Alt+T**).
2. Destek sayfasındaki **Başlatma komutunu kopyala** düğmesine tıklayın. Tarayıcı panoya erişemezse komut seçili hâlde
   gösterilir; **Ctrl+C** ile kopyalayın.
3. Terminal'e yapıştırın (**Ctrl+Shift+V**) ve Enter'a basın. Program açılır.

Sayfadaki komut şudur (tek satır; baştaki boşluk bilerek vardır, komutun terminal geçmişine yazılmamasını sağlar):

```bash
 d="$(xdg-user-dir DOWNLOAD)" && [ -d "$d" ] && cd "$d" && f="$(find . -maxdepth 1 -type f -mmin -10 -regextype posix-extended -regex './Destek-[0-9]{8}( ?\([0-9]{1,3}\))?' -printf '%f\n')" && [ -n "$f" ] && { [ "$(printf '%s\n' "$f" | wc -l)" -eq 1 ] || { echo "İndirilenler'deki eski Destek-* dosyalarını silip yeniden indirin"; false; }; } && chmod u+x -- "$f" && ./"$f"
```

Komut şunları yapar, başka hiçbir şey yapmaz:

- İndirilenler klasörünüzde **son 10 dakikada** indirilmiş, adı `Destek-` + 8 rakam olan dosyayı arar. Firefox'un ikinci
  indirmede verdiği `Destek-48291376(1)` gibi adlar da kabul edilir.
- Böyle **tam bir dosya** bulursa yalnız ona çalıştırma izni verir ve onu açar. Yönetici şifresi istemez.
- Böyle birden fazla dosya varsa durur ve **"İndirilenler'deki eski Destek-\* dosyalarını silip yeniden indirin"** yazar.
  İndirilenler'deki `Destek-…` dosyalarını silin, destek sayfasından dosyayı bir kez daha indirin ve komutu yeniden
  çalıştırın. Aynı dosyayı 10 dakika içinde iki kez indirdiyseniz de bu mesajı görürsünüz.
- Böyle bir dosya yoksa (hiç indirilmemiş ya da 10 dakikadan önce indirilmiş) **hiçbir mesaj vermeden** durur, program
  açılmaz. Dosyayı destek sayfasından yeniden indirip komutu hemen çalıştırın.

> **Nokta Destek size bundan başka komut vermez.** Bu komutu yalnız destek sayfasından kopyalayın. Sohbette, e-postada ya
> da telefonda size okunan bir komutu çalıştırmayın; `sudo` ile başlayan ya da yönetici şifresi isteyen bir komut bizim
> değildir.

**Dosyalar uygulamasıyla:** İndirilenler klasöründe `Destek-…` dosyasına sağ tıklayın → **Özellikler** → **Program olarak
çalıştır** anahtarını açın. Pencereyi kapatıp dosyaya çift tıklayın. Bu yol Ubuntu sürümüne göre farklı davranabilir;
dosya açılmazsa Terminal yolunu kullanın.

**Destek kodu nereden gelir?** Program kodu dosya adından okur; sizden istemez. Dosyayı yeniden adlandırdıysanız kod
okunamaz. O zaman program 8 haneli kodu sorar: teknisyeninizden alıp yazın ve **Devam**'a tıklayın.

**Dosya doğru mu? (BT sorumlusu için)** Linux sürümü imzasız dağıtılır. Dosyanın SHA-256 özeti GitHub sürüm sayfasındaki
`SHA256SUMS` dosyasıyla eşleşmeli ve GitHub attestation ile doğrulanabilmelidir:

```bash
sha256sum ~/İndirilenler/Destek-48291376
gh attestation verify ~/İndirilenler/Destek-48291376 --repo NoktaBilisim/Remote
```

(Klasör adı sistem dilinize göre `~/Downloads` olabilir.) **Hakkında** penceresindeki parmak izi bu özetin ilk 8
karakteridir.

### Ekran paylaşımına izin verme

**X11'de:** birden fazla ekranınız varsa **Nokta Destek — Ekran seçimi** penceresi açılır. Paylaşılacak ekranı seçip
**Paylaş**'a tıklayın.

**Wayland'de:** program önce **"Sistem izin penceresi açılıyor…"** yazar, ardından Ubuntu'nun kendi ekran paylaşımı
penceresi açılır.

1. Paylaşılacak ekranı seçin.
2. Teknisyenin bilgisayarınızı kontrol etmesini de istiyorsanız aynı pencerede **Uzaktan etkileşime izin ver**
   anahtarını açın. Kapalı bırakırsanız teknisyen yalnız ekranınızı görür.
3. **Paylaş**'a tıklayın.

Bu izin yalnız bu oturum için geçerlidir; her destekte yeniden sorulur, Ubuntu bunu hatırlamaz.

Sistem penceresini iptal ederseniz Nokta Destek **"Paylaşım başlatılmadı"** yazar. **Tekrar dene** ile sistem penceresini
yeniden açabilir ya da **Oturumu bitir** ile çıkabilirsiniz.

Paylaşım sürerken Ubuntu'nun üst çubuğunda ekran paylaşımı simgesi görünür. Bu simgeden **Durdur**'a basmak paylaşımı
**ve oturumu** bitirir.

### Karşılama, KVKK onayı ve teknisyen kabulü

Bu adımlar Windows sürümüyle aynıdır (bkz. "Doğru programla mı bağlanıyorum?", "KVKK onayı ve bağlanma", "Teknisyen
kabulü"):

- **Karşılama penceresi:** teknisyenin adı, **teknisyen doğrulama kodu**, bağlanılan sunucu adresi ve firma logosu görünür.
  Sizi biz aramadıysak devam etmeyin. Pencerede **Kötüye kullanımı bildir** varsa şüpheli durumu e-postayla
  bildirebilirsiniz.
- **KVKK onayı:** aydınlatma metnini okuyun, adınızı yazın, onay kutusunu işaretleyip **Bağlan**'a tıklayın. Firma oturum
  kaydı açtıysa kayıt için ayrı bir kutu çıkar. Hızlı Destek 0.21 ve sonrasında **Bağlan**'ın hemen üstünde sohbet saklama
  satırı yazar; satır yoksa düğme pasiftir.
- **Bekleme odası:** ekrandaki 4 haneli kabul kodunu telefonda teknisyene okuyun.

Oturum penceresinin alt satırında **Lisanslar** ve **Hakkında** düğmeleri vardır. **Hakkında** penceresinde sürüm, sunucu
adresi ve parmak izi yazar.

Pencereler Ubuntu'nun Yaru görünümünde değil, GTK'nın standart **Adwaita** görünümündedir; açık ya da koyu oluşu
Ubuntu'nun görünüm tercihine uyar. Bu bilinçli bir seçimdir: kişisel tema ayarları güvenlik düğmelerini gizleyemez.

### Oturum sırasında ne görürüm?

- **X11'de:** her ekranınızın kenarında **kırmızı çerçeve** ve üstte **"Ekranınız izleniyor — <teknisyen adı>"** yazısı
  bulunur (kontrol izni verdiyseniz **"Uzaktan kontrol aktif — <teknisyen adı>"**). Gösterge diğer pencerelerin altında
  kalırsa ya da gösterilemezse uzaktan kontrol güvenlik için kendiliğinden kapanır.
- **Wayland'de:** Nokta Destek göstergesinin her zaman en üstte kalacağı garanti edilemez. Bu yüzden Ubuntu'nun üst
  çubuğundaki **ekran paylaşımı simgesi** de göstergedir: simge görünüyorsa ekranınız paylaşılıyordur.
- **Nokta Destek — Oturum** penceresinde bağlantı durumu, sohbet (0.21 ve sonrası), dosya aktarımları, bağlı teknisyenler ve **Erişime izin ver**,
  **Kontrolü kapat**, **Oturumu bitir** düğmeleri bulunur. Pencere diğer pencerelerin üstünde durur ve tüm çalışma
  alanlarında görünür. Pencereyi küçültürseniz program onu geri getirir.
- Teknisyenin ekranınıza çizdiği işaretler ve kırmızı çerçeve, teknisyenin gördüğü görüntüye de girer. Bu beklenen bir
  durumdur.

### Teknisyen bilgisayarımı kullanmak isterse (Linux)

Teknisyen kontrol istediğinde **Uzaktan kontrol isteği** penceresi açılır. Kurallar Windows ve Mac sürümüyle aynıdır:

- İsteği beklemiyorsanız **Reddet**'e tıklayın. Enter, Boşluk ve Esc de reddeder.
- Bekliyorsanız **kendi farenizle** **İzin ver**'e tıklayın. Düğme ilk **1,5 saniye** çalışmaz. Klavyeyle izin
  verilemez; teknisyenin uzaktan yaptığı tıklama ve başka programların ürettiği tıklama sayılmaz.
- X11'de pencere imlecinizin hemen altında açılmaz. Wayland'de oturum penceresinin bulunduğu ekranın ortasında açılır.

**X11'de kontrolü geri almak için:**

- Oturum penceresinde **Kontrolü kapat**'a tıklayın, **veya**
- Klavyede **Ctrl+Shift+F12**'ye basın (başka program kullanıyorsa **Ctrl+Shift+F11**; geçerli olanı oturum penceresinde
  yazar).
- Kendi farenizi ya da klavyenizi kullandığınızda teknisyenin hareketi yaklaşık 1 saniye durur.
- İki kısayol da kaydedilemezse güvenliğiniz için kontrol izni verilemez; teknisyen yalnız ekranı görür.

**Wayland'de kontrol ve sınırları:**

Wayland'de program bilgisayarınızın genel klavye kısayollarını dinleyemez ve sizin fare hareketinizi göremez. Bu yüzden
kontrol penceresinde ve oturum penceresinde şu uyarı yazar:

> Bu masaüstünde fareniz teknisyenin hareketini durdurmaz; kesmek için Super+L (ekranı kilitle) ya da üst çubukta
> Durdur. Super+L hemen çalışmazsa birkaç kez basın; yine olmazsa önce Super+Esc, sonra Super+L.

- **Kontrolü kapat** düğmesi her zaman çalışır.
- **Super+L** (Windows logolu tuş + L) ekranı kilitler; kilitlenince uzaktan kontrol hemen kapanır. Kilidi açtığınızda
  kontrol **kendiliğinden geri gelmez**; teknisyen yeniden ister, siz yeniden onaylarsınız.
- Üst çubuktaki ekran paylaşımı simgesinden **Durdur** paylaşımı ve oturumu bitirir.
- Ekran kilidi kısayolu kapatılmışsa ya da ekran kilitleme devre dışıysa güvenliğiniz için Wayland'de kontrol verilmez;
  teknisyen yalnız ekranı görür. Oturum sırasında bu ayarlar değişirse kontrol kapanır.
- Sistem izin penceresinde **Uzaktan etkileşime izin ver**'i açmadıysanız teknisyenin kontrol isteği size hiç gelmez;
  teknisyen ekranınızı görmeye devam eder.
- Bazı sürümlerde Hızlı Destek Wayland'de **yalnız görüntü** paylaşır; o zaman kontrol isteği gelmez ve bu uyarılar
  görünmez. X11'de kontrol her durumda çalışır.

Kontrol kapandığında oturum penceresinde **"Uzaktan kontrol kapatıldı: ekran kilitlendi ya da masaüstü kontrol iznini
kaldırdı."** yazabilir.

**Ekran kilitliyken:** teknisyen konsolunda "Müşteri güvenli masaüstünde" yazar. Kilidi siz açarsınız.

### Klavyesiz kullanım ve erişilebilirlik (Linux)

Korunan düğmeler (**İzin ver**, **Erişime izin ver**, dosya **Kabul et**, **Yazdır**, pano kutusu, **Çıkar**, kayıt izni,
**Mikrofonu aç**) yalnız gerçek bir fare ya da dokunmatik yüzey tıklamasıyla çalışır. Klavye, ekran okuyucu (Orca) ve
erişilebilirlik araçları bu düğmelere basamaz. Güvenli yöne işleyen düğmeler klavyeyle de çalışır: **Kontrolü kapat**,
**Oturumu bitir**, **Kaydı durdur**, **Görüşmeyi bitir**.

Ubuntu'nun **bekleyerek tıklama** ya da **fare tuşları** erişilebilirlik ayarı oturum başında açıksa sorun yoktur. Oturum
sırasında açılırsa korunan düğmeler çalışmaz ve **"Erişilebilirlik ayarı oturum sırasında değişti; onay için oturumu
yeniden başlatın"** yazar. Oturumu bitirip yeni bağlantıyla yeniden başlayın.

### Pano, yazdırma, dosya ve ses (Linux)

- **Pano paylaşımı:** Windows sürümündeki gibi çalışır (bkz. "Teknisyenle pano paylaşımı"); kutuyu yalnız kendi farenizle
  işaretleyebilirsiniz. Parola yöneticinizin gizli olarak işaretlediği içerik okunmaz. Teknisyenin panonuza koyduğu metin
  "gizli" işaretiyle yazılır; ancak bazı pano geçmişi eklentileri (ör. GPaste, Clipboard Indicator) bu işareti dikkate
  almayabilir ve metni geçmişte tutabilir. Böyle bir eklenti kullanıyorsanız oturumdan sonra geçmişi temizleyin.
- **Yazdırma:** Mac sürümüyle aynıdır (bkz. "Teknisyen belge yazdırmak isterse (Mac)"). Belge **varsayılan yazıcıya** tek
  kopya gider; onay penceresinde "Sayfa sayısı: yazıcıda belirlenir" ve "Varsayılan yazıcı" yazar. Yazdırma sistemi (CUPS)
  işi kendi geçmişinde tutar.
- **Dosya:** kabul ettiğiniz dosya **İndirilenler** klasörüne kaydedilir ve **çalıştırma izni olmadan** kaydedilir. Dosya
  bir program ya da betikse sonuç satırında "(Dikkat: bu dosya bir program ya da betik. Beklemediyseniz açmayın, silin.)"
  yazar. `.desktop`, `.run`, `.AppImage`, `.deb`, `.rpm`, `.snap` gibi türler ek uyarıyla gelir. Adı `Destek-` ile başlayan
  bir dosya, başlatma komutuyla karışmasın diye `Dosya-` önekiyle kaydedilir.
- **Sesli görüşme:** çalışır (bkz. "Sesli görüşme"). Mikrofon açılamazsa "Mikrofonunuz açılamadı. Mikrofonun bağlı
  olduğunu ve Ayarlar > Ses altında giriş aygıtı olarak seçildiğini kontrol edin; teknisyen yeniden isteyebilir." yazar.

### Oturumu kapatma (Linux)

- **Oturumu bitir**'e tıklayın. Program birkaç saniye içinde kendiliğinden kapanır.
- Oturum penceresini **✕** ile kapatırsanız program **"Oturumu bitir?"** diye sorar.
- Wayland'de üst çubuktaki **Durdur** da oturumu bitirir.
- Terminal'i kapatmak oturumu bitirmez; oturumu programın kendi düğmesiyle bitirin.

### Linux'ta ne kalır?

Program kapanınca ayar dosyası, önbellek, tanılama dosyası ya da otomatik başlatma kaydı **kalmaz**. Geçici dosyalar
kapanışta silinir.

Kalanlar:

- İndirdiğiniz `Destek-…` dosyası ve teknisyenden aldığınız dosyalar (İndirilenler'de; siz silersiniz).
- Başlatma komutu, baştaki boşluk ayarınızda işe yaramazsa terminal geçmişinde kalabilir. Kod tek kullanımlıktır.
- Ubuntu'nun ses sistemine ait küçük ayar dosyaları (22.04'te `~/.config/pulse/` altında, 24.04'te
  `~/.local/state/wireplumber/` altında). Bunları program değil Ubuntu yazar.
- Yazdırma yaptıysanız yazdırma sistemindeki iş kaydı.
- Program Wayland'de beklenmedik biçimde çökerse Ubuntu'nun hata raporlayıcısı `/var/crash` altında bir rapor
  bırakabilir.

### Sık karşılaşılan durumlar (Linux)

| Durum                                                                                     | Ne yapmalı                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Destek sayfasında Linux için indirme düğmesi yok                                          | Linux sürümü bu sunucuda yayımlanmamış ya da bilgisayarınız desteklenmiyor (ARM, Chromebook, Ubuntu dışı). **Tarayıcıdan** ekranınızı paylaşın.                                                                          |
| Komut "İndirilenler'deki eski Destek-\* dosyalarını silip yeniden indirin" diyor          | İndirilenler'deki tüm `Destek-…` dosyalarını silin, dosyayı yeniden indirin, komutu tekrar çalıştırın.                                                                                                                   |
| Komut hiçbir şey yazmadan bitti, program açılmadı                                         | Dosya 10 dakikadan önce indirilmiş ya da hiç inmemiş. Yeniden indirip komutu hemen çalıştırın.                                                                                                                           |
| Program kodu soruyor                                                                      | Dosya adı değişmiş. Teknisyeninizden 8 haneli kodu alıp yazın.                                                                                                                                                           |
| Terminal'de "Nokta Destek bir masaüstü oturumunda (X11 ya da Wayland) çalıştırılmalıdır." | Program uzak bağlantıdan (SSH) ya da masaüstü olmayan bir oturumdan çalıştırılmış. Bilgisayarın kendi masaüstünde Terminal açıp yeniden deneyin.                                                                         |
| "Bu masaüstünde ekran paylaşımı bileşeni eksik"                                           | Ubuntu'nun ekran paylaşımı bileşeni kurulu değil (genelde en küçük kurulumlarda). BT sorumlusu `sudo apt install xdg-desktop-portal-gnome gstreamer1.0-pipewire` ile kurar. O zamana kadar tarayıcıdan paylaşın.         |
| "Paylaşım başlatılmadı"                                                                   | Sistem izin penceresini iptal ettiniz. **Tekrar dene**'ye tıklayıp ekranı seçin ve **Paylaş**'a basın.                                                                                                                   |
| Teknisyen kontrol edemiyor (Wayland)                                                      | Sistem izin penceresinde **Uzaktan etkileşime izin ver** kapalıydı, ekran kilidi kısayolu kapalı ya da bu sürüm Wayland'de yalnız görüntü paylaşıyor. Oturumu yeniden başlatıp anahtarı açın ya da X11 oturumuyla girin. |
| "Vekil sunucuya bağlanılamadı"                                                            | Bilgisayarınızın vekil sunucu (proxy) ayarını kontrol edin ya da ağ yöneticinize danışın, sonra tekrar deneyin. Program yalnız `HTTPS_PROXY` / `NO_PROXY` ortam ayarını kullanır.                                        |
| "Sunucuya ulaşılamıyor"                                                                   | İnternet bağlantınızı kontrol edip tekrar deneyin.                                                                                                                                                                       |
| **İzin ver** / **Yazdır** / pano kutusu tepki vermiyor                                    | 1,5 saniye bekleyin, sonra gerçek fareyle tıklayın. Klavye ve ekran okuyucu bu düğmelerde çalışmaz.                                                                                                                      |
| Super+L ile kilitledikten sonra teknisyen kontrolü kaybetti                               | Beklenen davranış. Teknisyen kontrolü yeniden ister; siz yeniden onaylarsınız.                                                                                                                                           |
| "Sohbet kapalı" ya da sohbet alanı yok                                                    | Hızlı Destek 0.20'de oturum sohbeti kapalıdır. Destek sayfasından 0.21'i indirin; o arada telefonda ya da sesli görüşmeyle konuşun.                                                                                      |
| Pencereler Ubuntu'nun diğer pencerelerinden farklı görünüyor                              | Beklenen davranış (Adwaita görünümü).                                                                                                                                                                                    |

## Müşteri için: Müşteri portalı

**Müşteri portalı**, destek aldığınız firmanın size açtığı kişisel bir web sayfasıdır. Portalda şunları yaparsınız:

- Firmanız adına açılmış **destek taleplerini** ve teknisyenlerin size bağlandığı **destek oturumlarını** görürsünüz.
- Program indirmeden **yeni destek talebi** açarsınız.
- Firmanıza özel destek programını (**firma dosyası**) indirirsiniz. Kartta "Bu bağlantı Mac'te macOS uygulamasını (.zip)
  indirir." yazar; Mac'te adımlar "Mac'te nasıl destek isterim?" bölümündedir.

Portal hesabını destek sağlayıcınız açar; kendiniz kayıt olamazsınız. Aynı firmadaki her çalışanın ayrı hesabı olabilir;
hepsi firmanın tüm talep ve oturumlarını görür.

**Portalda neler görünmez?** Sohbet yazışmaları, talep açıklaması, teknisyen notu, IP adresi, bilgisayar bilgisi, dosya
listesi ve oturum kaydı portalda gösterilmez. Yalnız tarih, durum, talep kodu, kaynak, öncelik, teknisyen adı, süre ve
ticket numarası görünür.

### Portala nasıl girerim?

1. Destek sağlayıcınız size iki şey verir: **portal adresi** (`https://<destek adresi>/portal/login?tenant=<firma>`
   biçiminde) ve **geçici şifre**. Bu adresi tarayıcınızın yer imlerine ekleyin; adres firmanıza özeldir.
2. Adresi açın. Sayfada destek sağlayıcınızın logosu ve "Müşteri portalı" başlığı görünür.
3. **E-posta** ve **Şifre** alanlarını doldurup **Giriş yap**'a basın.
4. İlk girişte **Şifrenizi değiştirin** ekranı açılır (bkz. aşağıdaki bölüm).

Adresin sonundaki `?tenant=…` kısmı silinirse sayfa giriş formu yerine "Bu sayfaya firmanıza özel giriş bağlantısıyla
gelinmelidir. Giriş bağlantısını destek sağlayıcınızdan isteyin." yazar. Bir kez giriş yaptıktan sonra tarayıcı firmanızı
hatırlar; oturum düştüğünde sizi doğru giriş sayfasına götürür.

Şifrenizi unuttuysanız portalda kendiniz sıfırlayamazsınız. Destek sağlayıcınızı arayın; size yeni bir geçici şifre verir.

### İlk girişte şifre değiştirme

Geçici şifreyle ilk girişte (ve destek sağlayıcınız şifrenizi sıfırladığında) yeni şifre belirlemeden portalı
kullanamazsınız.

1. **Mevcut şifre** alanına size verilen geçici şifreyi yazın.
2. **Yeni şifre** ve **Yeni şifre (tekrar)** alanlarına yeni şifrenizi yazın. Şifre **en az 12 karakter** olmalıdır; uzun
   bir parola cümlesi tercih edin.
3. **Şifreyi değiştir**'e basın. "Şifreniz değiştirildi." yazar ve portal ana sayfası açılır.

**Geçici şifre 72 saat geçerlidir.** Bu süre içinde giriş yapıp şifrenizi değiştirmezseniz giriş ekranı "Geçici şifrenin
süresi doldu (72 saat). Destek sağlayıcınızdan yeniden sıfırlama isteyin." yazar. Destek sağlayıcınızdan yeni geçici şifre
isteyin.

Şifre değiştirince başka cihazlardaki portal oturumlarınız kapanır; bulunduğunuz cihazda oturumunuz devam eder.

### Ana sayfa: talepler ve oturumlar

Giriş yapınca **Destek portalı** sayfası açılır. Üstte "Merhaba <adınız>" ve firmanızın adı yazar.

- **Firma dosyasını indir:** destek almak için bilgisayarınıza kaydedeceğiniz, size özel programı indirir. Programın
  kullanımı "Hızlı Destek uygulaması (Windows)" bölümünde anlatılır.
- **Yeni destek talebi:** program indirmeden talep açar (bkz. "Portaldan nasıl yeni talep açarım?").
- **Geçmiş** iki sekmedir:
  - **Talepler (N):** talep kodu, tarih, durum, kaynak, öncelik, talep eden, kapanış.
  - **Oturumlar (N):** tarih, teknisyen, bağlantı türü, süre, ticket numarası, görüşülen kişi.

Liste sayfada 25 kayıt gösterir; altta "Toplam N kayıt" ve sayfa geçişi bulunur. Telefonda tablo yerine kartlar görünür.
Bir satıra tıklayınca ayrıntı açılır. Talep ayrıntısında talebe bağlı bir oturum varsa **Bağlı oturumu görüntüle**
düğmesi çıkar. **Portala dön** ile ana sayfaya dönersiniz.

Bir sekme yüklenemezse sekme adında "(yüklenemedi)" yazar; **Tekrar dene**'ye basın. Henüz kayıt yoksa "Henüz talep yok"
ya da "Henüz oturum yok" yazar.

### Portaldan nasıl yeni talep açarım?

1. Ana sayfada **Yeni destek talebi**'ne tıklayın.
2. Form açılır. Adınız ve e-posta adresiniz hesabınızdan dolu gelir. **Telefon** ve **Sorununuzu kısaca anlatın** (en az
   10, en çok 500 karakter) alanlarını doldurun.
3. İsterseniz **Talebimin durumunu bana bildir** altında SMS, WhatsApp veya e-posta kutusunu işaretleyin. Yalnız firmanızın
   açtığı kanallar görünür.
4. Aydınlatma metnini okuyup onay kutusunu işaretleyin ve **Talep gönder**'e basın.
5. **Talebiniz alındı** ekranı açılır: talep kodu, sıranız ve kalan süre. Beklerken teknisyenle yazışabilirsiniz;
   **sohbete şifre veya kart bilgisi yazmayın.**
6. Teknisyen talebi kabul edince doğrulama kodu görünür; telefondaki teknisyen aynı kodu söylemeli. Doğruysa **Ekranımı
   paylaş**'a basın. Kabul ekranında firma dosyasının indirme bağlantısı da bulunur; uzaktan kontrol gerekiyorsa bu programı
   kullanın.

Bu akış web talep formuyla aynıdır (bkz. "Program indirmeden tarayıcıdan destek isteyebilir miyim?"); fark şudur: portal
girişi yaptığınız için form bağlantısı gerekmez ve firmanız web talep formunu kapatmış olsa da portaldan talep
açabilirsiniz. Mesai saatleri ve tatiller portal talebi için de geçerlidir.

**Sınırlar:** Firmanızın tüm portal hesaplarından toplam **saatte en çok 10 talep** açılabilir. Firmanızın aynı anda en çok
**3 bekleyen talebi** olabilir (programdan ya da formdan açılanlar dahil); biri kabul edilince ya da kapanınca yenisi
açılır.

### İki adımlı doğrulama (2FA): nasıl açarım, nasıl kapatırım?

İki adımlı doğrulama portalda **isteğe bağlıdır**. Açarsanız girişte şifrenize ek olarak telefonunuzdaki doğrulama
uygulamasının 6 haneli kodu istenir.

**Açmak için:**

1. Sağ üstteki hesap menüsünden **Hesabım**'ı açın.
2. **İki adımlı doğrulama** bölümünde **İki adımlı doğrulamayı aç**'a basın.
3. Telefonunuza bir doğrulama uygulaması kurun (Google Authenticator, Microsoft Authenticator vb.).
4. Uygulamada yeni hesap ekleyip ekrandaki QR kodu okutun. Okutamıyorsanız anahtarı **Anahtarı kopyala** ile alıp elle
   girin.
5. Uygulamanın gösterdiği 6 haneli kodu yazıp **Doğrula ve aç**'a basın. "İki adımlı doğrulama açıldı." yazar.

**Önemli:** 2FA açıldığında **başka cihazlardaki portal oturumlarınız kapanır**; o cihazlarda bir sonraki tıklamada giriş
ekranı açılır ve yeniden giriş (bu kez kodla) gerekir. Bulunduğunuz cihazda oturumunuz devam eder.

**Girişte kod:** E-posta ve şifreyi yazıp **Giriş yap**'a basınca formda **Doğrulama kodu (6 haneli)** alanı açılır.
Uygulamadaki kodu yazıp yeniden **Giriş yap**'a basın.

**Kapatmak için:** **Hesabım** → **İki adımlı doğrulamayı kapat** → şifrenizi ve uygulamadaki güncel kodu girin. "İki
adımlı doğrulama kapatıldı." yazar.

**Telefonunuzu kaybettiyseniz:** portalda kurtarma kodu yoktur. Destek sağlayıcınızdan şifrenizi sıfırlamasını isteyin;
sıfırlama 2FA'yı da kapatır ve size yeni geçici şifre verilir.

### Hesabım sayfası

- **Hesap bilgileri:** ad soyad, e-posta ve firma salt okunurdur. Değiştirmek için destek sağlayıcınıza başvurun.
- **Şifre değiştir:** mevcut şifre, yeni şifre (en az 12 karakter) ve tekrarı. Mevcut şifreyi 5 kez yanlış girerseniz
  oturumunuz kapanır ve yeniden giriş yapmanız gerekir.
- **İki adımlı doğrulama:** Açık / Kapalı durumu ve aç/kapat düğmesi.
- **Görünüm:** Açık / Koyu / Sistem. Seçiminiz hesabınıza kaydedilir; başka cihazdan girişte de aynı tema gelir.

**Çıkış:** hesap menüsünden **Çıkış yap**. Giriş ekranında "Çıkış yaptınız." yazar.

**Oturum süresi:** 30 dakika işlem yapmazsanız ya da girişten 8 saat geçerse oturum kapanır; giriş ekranında "Oturumunuzun
süresi doldu. Lütfen yeniden giriş yapın." yazar.

### Sık karşılaşılan mesajlar (müşteri portalı)

| Mesaj                                                                                     | Ne yapmalı                                                                                                              |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Bu sayfaya firmanıza özel giriş bağlantısıyla gelinmelidir…                               | Adreste `?tenant=…` eksik. Destek sağlayıcınızdan portal adresini isteyin                                               |
| E-posta veya şifre hatalı.                                                                | Bilgileri kontrol edin. Hesabınız ya da firmanızın kaydı pasife alınmışsa da bu mesaj çıkar; destek sağlayıcınıza sorun |
| Kod hatalı.                                                                               | Girişte yazdığınız 2FA kodu yanlış. Uygulamadaki güncel kodu yazın                                                      |
| Geçici şifrenin süresi doldu (72 saat)…                                                   | Destek sağlayıcınızdan yeni geçici şifre isteyin                                                                        |
| Çok sayıda hatalı deneme yapıldı. Hesap geçici olarak kilitlendi; N dakika sonra…         | Belirtilen süre (en çok 15 dakika) kadar bekleyin ya da destek sağlayıcınızdan şifre sıfırlaması isteyin                |
| Çok fazla istek. Lütfen biraz sonra tekrar deneyin.                                       | Kısa sürede çok deneme yapıldı ya da firmanızın saatlik talep sınırı doldu; bir süre bekleyin                           |
| Hesabınızda iki adımlı doğrulama açık. Uygulamadaki 6 haneli kodu girip yeniden gönderin. | Açılan **Doğrulama kodu** alanına uygulamadaki kodu yazın                                                               |
| Kod hatalı veya süresi geçmiş.                                                            | Telefonunuzun saatinin doğru olduğunu kontrol edin, uygulamadaki yeni kodu yazın                                        |
| Şu an çok yoğunuz, lütfen firmanızı telefonla arayın.                                     | Firmanızın 3 bekleyen talebi var ya da kuyruk dolu. Bekleyen talep kabul edilene kadar bekleyin veya arayın             |
| Şu an mesai dışındayız ve talep alınmıyor. Sonraki açılış: …                              | Belirtilen saatte tekrar deneyin ya da firmanızı arayın                                                                 |
| Talep bağlantınız yenilendi, sayfayı yenileyin.                                           | Sayfayı yenileyip talebi yeniden gönderin                                                                               |
| Destek talebi şu an açılamıyor; destek sağlayıcınıza başvurun.                            | Destek sağlayıcınızı arayın                                                                                             |
| Kayıt bulunamadı                                                                          | Kayıt yok ya da size ait değil. **Portala dön**                                                                         |
| Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.                                    | Yeniden giriş yapın. 2FA'yı başka bir cihazda yeni açtıysanız da bu ekran çıkar                                         |

---

## Teknisyen için: Oturumlar ve bekleme odası

**Oturumlar** ekranı (menüde "Oturumlar") açtığınız destek oturumlarını listeler. Liste 10 saniyede bir kendiliğinden
yenilenir; üstte "Son güncelleme" saati yazar. Müşteri bağlantıyı açıp adını yazdığında doğrudan ekranınıza gelmez,
önce **bekleme odasına** düşer. Siz onu konsoldan kabul edene kadar bekler. Bu bölüm müşterinin beklediğini nasıl
fark edeceğinizi ve onu nasıl kabul edeceğinizi anlatır.

### Müşterinin beklediğini nereden anlarım?

Müşteri bekleme odasına girdikten sonra en geç 10 saniye içinde dört yerde işaret görürsünüz:

| Nerede                                         | Ne görürsünüz                                                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oturumlar listesi                              | Oturumun "Durum" hücresinde, "Bekliyor" yazısının yanında zil simgeli **Müşteri bekliyor (n)** rozeti. n, o oturumda bekleyen müşteri sayısıdır (en çok 3)                                                    |
| Kenar menü                                     | **Oturumlar** öğesinin yanında sarı bir sayı: kendi oturumlarınızda bekleyen toplam müşteri. Panelin her sayfasında (Talepler, Müşteriler, Ayarlar, Profil, konsol) görünür. Kimse beklemiyorsa sayı görünmez |
| Bildirim (ekranın altı; geniş ekranda sağ alt) | **Bekleme odasında müşteri var** ve **Konsolu aç** düğmesi. Birden çok oturumunuza aynı anda müşteri geldiyse "Bekleme odasında 2 müşteri var" ve **Oturumlara git** yazar                                    |
| Tarayıcı sekmesi                               | Başka bir sekmedeyseniz panel sekmesinin başlığı "(1) Müşteri bekliyor — " ile başlar. Sekmeye döndüğünüzde başlık eski haline gelir                                                                          |

- Bildirim yaklaşık 15 saniye ekranda kalır; çarpı (**Bildirimi kapat**) ile erken kapatabilirsiniz. Aynı müşteri için
  bildirim bir kez çıkar.
- Sayfayı yenilediğinizde zaten bekleyen müşteri için yeni bildirim çıkmaz; rozet ve menü sayısı yine görünür.
- O oturumun konsolu zaten açıksa bildirim çıkmaz; müşteri konsoldaki "Bekleme odası" listesine düşer.
- Destek taleplerinin sekme sayacı da açıksa ikisi birlikte yazar: önce "(1) Müşteri bekliyor — ", sonra talep sayısı.
- Bu işaretler müşterinin adını göstermez, yalnız sayı gösterir. Ad yalnız konsoldaki bekleme odası listesinde görünür.
  Ekranınızı paylaşırken ya da ortak bir ekranda çalışırken müşteri adı başkalarına görünmez.
- Ses ve masaüstü (işletim sistemi) bildirimi yoktur.

### Bekleyen müşteriyi nasıl kabul ederim?

1. Konsola geçin. Üç yoldan biri yeter:
   - bildirimdeki **Konsolu aç**,
   - Oturumlar listesinde **Müşteri bekliyor (n)** rozetine tıklama (klavyede Tab ile rozete gelip Enter),
   - satırdaki **Konsolu aç** düğmesi.
2. Konsolda **Bekleme odası (n)** bölümünde bekleyen müşterileri görürsünüz: adı, bağlanma şekli ("Hızlı Destek
   (Windows)" veya "Tarayıcı") ve ne kadar süredir beklediği.
3. Müşteriden ekranındaki **4 haneli kabul kodunu** telefonda okumasını isteyin.
4. Kodu **Kabul kodu** alanına yazın ve **Kabul et**'e tıklayın. Kod doğruysa müşteri bağlanır ve oturum "Aktif" olur.
   Rozet ve menü sayısı en geç 10 saniye içinde kaybolur.
5. Tanımadığınız ya da beklemediğiniz bir kişi varsa satırındaki **Reddet** ile onu çıkarın.

Kurallar (değişmedi):

- Bir oturumun bekleme odasında aynı anda en çok **3 müşteri** bekler.
- Müşteri **5 dakika** içinde kabul edilmezse bekleme odasından düşer ("Bekleme süresi doldu"); rozet de kaybolur.
- Kod yanlışsa "Kod eşleşmedi. n hatalı girişte daha bekleme odası boşaltılır." yazar. Kod 4 rakam olmalıdır.
- Birden çok kişiyi reddettiyseniz "kod başkasına sızmış olabilir" uyarısı çıkar: oturumu iptal edip yenisini açın.

### Rolünüze göre ne görürsünüz?

| Rol                             | Liste rozeti                                                                                          | Menü sayısı, bildirim, sekme başlığı |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Teknisyen (User)                | Yalnız kendi oturumlarında; tıklanınca konsol açılır                                                  | Kendi oturumları                     |
| Admin                           | Firmadaki bütün bekleyen oturumlarda. Başka teknisyenin satırında rozet yalnız bilgi verir, tıklanmaz | Yalnız kendi oturumları              |
| Super Admin, firma seçili       | Admin gibi                                                                                            | Yalnız o firmadaki kendi oturumları  |
| Super Admin, firma seçili değil | Tüm firmaların satırlarında yalnız bilgi amaçlı (tıklanmaz)                                           | Çalışmaz                             |

Başka bir teknisyenin müşterisini yalnız o oturumun teknisyeni kabul edebilir; Admin ve Super Admin başkasının
bekleme odasına giremez. Göstergeler için **Oturumlar** görüntüleme yetkisi yeter; "Talepler" yetkiniz olmasa da çalışır.

### Super Admin: Oturumlar ekranında "bir firma seçin" notu

Firma seçmeden **Oturumlar**'ı açarsanız liste tüm firmaların oturumlarını gösterir, ama işlem yapamazsınız:
**Yeni destek oturumu**, iptal, zorla sonlandırma ve **Konsolu aç** düğmeleri görünmez. Yerine şu not çıkar: "Liste tüm
firmaların oturumlarını gösterir. Yeni oturum açmak, iptal etmek veya sonlandırmak için üst menüden bir firma seçin."

1. Üst menüdeki firma seçiciye (bina simgesi) tıklayın.
2. Firmayı seçin. Düğmeler geri gelir; o firmadaki kendi oturumlarınız için menü sayısı ve bildirim de çalışmaya başlar.

### Sık karşılaşılan durumlar (Oturumlar ve bekleme odası)

| Durum                                                          | Ne yapmalı                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Müşteri "bağlandım, bekliyorum" diyor ama ekranını göremiyorum | Müşteri bekleme odasındadır; siz kabul edene kadar görüntü gelmez. **Talepler** ekranına bakmayın: kod veya bağlantıyla gelen müşteri orada görünmez. Menüdeki **Oturumlar** sayısına ya da bildirime bakın, **Konsolu aç** ile konsola geçin ve müşterinin okuduğu kabul kodunu girin |
| Menüde sayı var ama listede rozet göremiyorum                  | Liste filtresi "Bitmiş" olabilir; **Tümü** veya **Açık**'ı seçin. Rozet yalnız "Bekliyor" durumundaki satırlarda çıkar                                                                                                                                                                 |
| Rozet tıklanmıyor                                              | Oturum size ait değildir (Admin), ya da Super Admin olarak firma seçmediniz. Firma seçin veya oturumun teknisyenine haber verin                                                                                                                                                        |
| Rozet hâlâ görünüyor ama müşteri gitti                         | Göstergeler 10 saniyede bir yenilenir; biraz bekleyin. Müşteri vazgeçince ya da 5 dakika dolunca rozet kaybolur                                                                                                                                                                        |
| "Liste güncellenemedi; son bilinen durum gösteriliyor."        | Bağlantı geçici olarak koptu. Sayılar son bilinen değerde kalır ve bağlantı gelince kendiliğinden düzelir                                                                                                                                                                              |
| Sunucu yeniden başladıktan sonra sayı 0 oldu                   | Beklenir: bekleme odası sunucu belleğinde tutulur ve yeniden başlatmada boşalır. Müşteriyle telefonda durumu teyit edin                                                                                                                                                                |
| "Yeni destek oturumu" düğmesi yok (Super Admin)                | Firma seçmediniz; üst menüden firma seçin                                                                                                                                                                                                                                              |

---

## Teknisyen için: Müşterinin ekranı gelmiyorsa

Hızlı Destek ekranı okuyamazsa konsolunuzda ekran siyah kalır veya "paylaşılmıyor" görünür.

- **Hızlı Destek 0.11 ve sonrası:** konsolda kırmızı bir uyarı çıkar: **"Paylaşım başlatılamadı"** ve altında
  **"Neden: …"** (ör. "Ekran yakalama bu ekran kartında/ayarda desteklenmiyor (hibrit GPU, HDR veya eski sürücü)").
  Varsa denenen yöntem de yazılır (ör. "Masaüstü çoğaltma (DXGI)", "Yedek yakalama (GDI)"). Tanınmayan bir kod
  "Bilinmeyen neden (KOD)" olarak görünür.
- **Hızlı Destek 0.10.x:** neden konsola gelmez; yalnız müşterinin penceresinde görünür. Aşağıdaki adımlarla müşteriden
  öğrenin.

Sık görülen nedenler:

| Konsolda görünen neden                                                      | Ne yapmalı                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Ekran yakalama bu ekran kartında/ayarda desteklenmiyor                      | HDR'yi kapatın, ekran kartı sürücüsünü güncelleyin; yedek yöntem denenir       |
| Ekran yakalamaya izin verilmedi (kilit ekranı veya güvenli masaüstü)        | Müşteri kilit ekranını veya Windows onay penceresini kapatsın                  |
| Ekran yakalama şu an kullanılamıyor (tam ekran uygulama veya uzak masaüstü) | Tam ekran uygulamayı veya Uzak Masaüstü bağlantısını kapatın                   |
| Seçilen monitör bulunamadı                                                  | Başka bir monitör seçin veya müşteri ekranı yeniden bağlasın                   |
| Windows medya bileşenleri eksik / Görüntü kodlayıcı bulunamadı              | Windows "N" sürümü: Medya Özellik Paketi kurulmalı                             |
| Paylaşılan pencere kapatıldı                                                | Müşteri pencere modunda paylaştığı pencereyi kapattı; oturumu yeniden başlatın |
| Seçilen pencere paylaşılamadı (pencereye erişilemiyor)                      | Müşteri başka bir pencere ya da "Tüm ekran" seçsin                             |
| Bu Windows sürümü pencere paylaşımını desteklemiyor                         | Müşteri "Tüm ekran"ı paylaşsın                                                 |

Müşteriden bilgi alma adımları:

1. Müşteriden pencerenin alt satırındaki mesajı ve **parantez içindeki kodu** okumasını isteyin (ör. `DXGI_UNSUPPORTED`).
   Kod tablosu: müşteri bölümündeki "Ekran görüntüsü alınamadı yazıyor".
2. Mesajdaki yönlendirmeyi birlikte uygulayın (HDR'yi kapatma, kilit/onay penceresini kapatma, tam ekran uygulamayı
   kapatma vb.), sonra müşteri paylaşımı yeniden başlatır.
3. Sorun sürüyorsa ve müşterinin bilgisayarı kayıtlıysa veya "Bilgilerimi hatırla" açıksa, müşteriden
   `%LOCALAPPDATA%\NoktaDestek\tanilama.log` dosyasını göndermesini isteyin (Windows + R → yolu yazıp Enter).
   Dosyada kişisel veri yoktur; ekran kartı, Windows sürümü, HDR ve denenen yöntemler görünür. Kod ile tek seferlik
   bağlanan müşteride bu dosya oluşmaz; o durumda kod ve Windows sürümü yeterlidir.
4. `MF_STARTUP` veya `NO_H264_ENCODER` görürseniz müşterinin Windows'u "N" sürümüdür: Windows Medya Özellik Paketi
   kurulmalıdır.

---

## Teknisyen için: Uzaktan kontrol (konsol)

Uzaktan kontrol yalnız müşteri **Hızlı Destek** uygulamasıyla bağlandığında kullanılabilir. Müşteri tarayıcıdan
bağlandıysa konsolda "Uzaktan kontrol" düğmesi pasiftir; yalnız görüntü alırsınız. Hesabınızda **Uzaktan kontrol**
yetkisi (`remote_control.use`) yoksa kontrol düğmesi hiç görünmez.

### Nasıl kontrol isterim?

1. **Oturumlar** ekranından oturumun **Konsolu aç** bağlantısına tıklayın. Müşteriyi kabul edin ve görüntünün gelmesini
   bekleyin. Görüntü gelmeden düğme çalışmaz ("Görüntü geldiğinde kontrol istenebilir").
2. Sahnenin üst şeridinde **Kontrol iste**'ye tıklayın.
3. Düğme **Kontrol bekleniyor** olur; altında "Müşterinin onayı bekleniyor; şu an yalnız görüntüleme" yazar. Bu sırada
   gönderdiğiniz hiçbir tıklama müşteriye gitmez.
4. Müşteriye telefonda ekranındaki pencereden **İzin ver**'e tıklamasını söyleyin.
5. Müşteri izin verince "Müşteri kontrol izni verdi" bildirimi çıkar, şeritte **Kontrol sizde** yazar ve görüntünün
   çevresinde kırmızı çerçeve görünür. Artık fare ve klavyeniz müşterinin bilgisayarına gider.

İsteğinizden vazgeçerseniz **Vazgeç**'e tıklayın ("Kontrol isteğini geri çektiniz"). Müşteri pencereyi sonradan
onaylasa bile kontrol açılmaz.

### Hak ve bekleme kuralları

- Bir oturumda en çok **5 istek** gönderebilirsiniz. Kalan hak not satırında yazar ("bu oturumda 3 istek hakkı kaldı").
  Vazgeçtiğiniz istek de haktan düşer. Sayfayı yenilemek hakları sıfırlamaz.
- Müşteri reddederse "Kontrol reddedildi" bildirimi çıkar ve düğme **Tekrar iste (0:25)** gibi geri sayar. 30 saniye
  dolmadan yeni istek gönderilemez.
- Hak bitince "Bu oturumda kontrol isteği hakkı doldu (5/5)" yazar ve düğme pasif kalır.

### Kontrol sırasında

- **Fare:** sol, sağ ve orta tık, çift tık, sürükleme ve tekerlek çalışır. Tıklama görüntüde gördüğünüz noktaya düşer.
- **Klavye:** yazdığınız metin müşterinin klavye düzeninden bağımsız aynen çıkar (ç ğ ı ö ş ü İ dahil). Ctrl+C,
  Ctrl+V gibi kısayollar çalışır.
- **Özel tuşlar** menüsü (klavye ikonu): Alt+Tab, Windows tuşu, Win+D, Win+R, Win+E, Alt+F4, Ctrl+Shift+Esc,
  Print Screen. Seçince "Gönderildi: …" yazar. **Ctrl+Alt+Del ve Win+L gönderilemez.**
- **Tam ekran** kipinde (Chrome/Edge) Windows tuşu ve Alt+Tab gibi sistem tuşları doğrudan müşteriye gider.
- **Klavyeden çıkmak:** Tab tuşu da müşteriye gittiği için sayfada gezinemezsiniz. **Ctrl+Alt+Shift**'e birlikte basıp
  başka tuşa basmadan bırakın; odak **Kontrolü bırak** düğmesine geçer.
- Kontrol sırasında işaretleme araçları kapalıdır ("Kontrol sırasında işaretleme kapalı; önce kontrolü bırakın").
- Müşteri kendi faresini oynatırsa sizin hareketiniz yaklaşık 1 saniye durur. Bu beklenen davranıştır.
- Müşterinin fare imleci, Hızlı Destek'in yeni sürümünde (0.8+) görüntüde görünür; eski sürümde yalnız kendi
  imlecinizi görürsünüz. Müşteri imleci başka monitöre götürürse görüntüden kaybolur.

### Görünüm ve monitör

- **Sığdır:** müşteri ekranının tamamı sahneye sığar.
- **%100:** müşteri ekranı piksel piksel (1:1) gösterilir; sahneden büyükse kaydırma çubuklarıyla gezinirsiniz.
  Kaydırma çubuğuna tıklamanız müşteriye gitmez. Küçük yazıları okumak ve hassas tıklama için bu kipi kullanın.
- Sahne 960 pikselden darsa (küçük pencere, yan panel açık) monitör seçimi, Sığdır/%100 ve Tam ekran sağdaki
  **Görünüm** menüsünde toplanır. Genişte şeritte yan yana durur.
- **Monitör değiştirme:** müşterinin birden fazla ekranı varsa **Monitör** seçiminde ("Ekran 1", "Ekran 2") başka
  ekranı seçin. Müşteri onay verir; bu sırada "Ekran 2 için müşteri onayı bekleniyor…" yazar.
  - Onaylarsa "Ekran 2 gösteriliyor".
  - Reddederse "Müşteri monitör değişikliğini reddetti"; 30 saniye yanıt gelmezse "Müşteri monitör değişikliğini
    onaylamadı". İki durumda da seçim kısa süre pasif olur ve "yeni istek 0:30 sonra" gibi geri sayar.
  - Zaten gösterilen ekranı seçemezsiniz ("Bu monitör zaten paylaşılıyor"). Monitör isteği de oturumda en çok 5 kez.

### Kontrolü bırakma

- İşiniz bitince **Kontrolü bırak**'a tıklayın. Müşteri tarafında kontrol hemen kapanır, basılı kalan tuş olmaz.
- Düğme **Kontrole devam** olur. Tekrar kontrol için tıklayın; bu yeni bir istektir, müşteri yeniden onaylar ve
  haktan düşer.

### Müşteri yalnız bir pencere paylaşıyorsa ("Pencere paylaşımı" rozeti)

Hızlı Destek 0.11 ve sonrasında müşteri tüm ekran yerine tek bir pencere paylaşabilir. Bu durumda sahnenin üst şeridinde
**Pencere paylaşımı** rozeti görünür (üzerine gelince "Müşteri yalnız bir pencereyi paylaşıyor (Pencere yakalama)"). Mac
müşterisinde (0.26 ve sonrası) de aynı rozet çıkar; Mac'e özgü farklar "Müşteri Mac kullanıyorsa" bölümündedir.

- Yalnız o pencerenin içini görürsünüz. Monitör seçimi gizlenir; ekran değiştirme ve işaretleme yoktur.
- Kontrol izniyle tıklamanız yalnız o pencereye gider. Üstüne başka pencere gelmiş bir bölgeye tıklarsanız hiçbir şey olmaz.
- Klavyeniz yalnız müşteride o pencere öndeyken çalışır; müşteri başka programa geçerse yazdıklarınız gitmez ve sonradan
  da yazılmaz. Pencerenin "Farklı kaydet" gibi küçük pencereleri öndeyken yalnız fare çalışır.
- **Klavye kısayolları kısıtlıdır:** Windows tuşu ve Win+… kısayolları, Alt+Tab, Alt+Esc, Ctrl+Esc, Ctrl+Shift+Esc ve
  Print Screen müşteriye gitmez (**Özel tuşlar** menüsünden gönderseniz de). Müşteride Yapışkan Tuşlar veya Fare Tuşları
  açıksa tek başına Ctrl/Alt sonrası Tab/Esc ve sayısal tuş takımı da gitmez; rakam için üst sırayı kullanın. Ctrl+C,
  Ctrl+V ve Alt+F4 çalışır. Hızlı yazımda saniyede 40 tuştan fazlası düşer.
- Müşteri pencereyi küçültürse siyah ekran ve "Pencere simge durumunda" görürsünüz; girdiniz uygulanmaz. Pencere kapanırsa
  kırmızı uyarı çıkar: **"Neden: Paylaşılan pencere kapatıldı — Pencere yakalama"**. Müşteri oturumu yeniden başlatır.
- Tüm ekrana ihtiyacınız varsa müşteriden oturumu bitirip yeniden bağlanırken **Tüm ekran**'ı seçmesini isteyin.

### Kontrolün kendiliğinden kapandığı durumlar

| Konsolda gördüğünüz                                                                                                                | Ne oldu                                                                                                                                                                             | Ne yapmalı                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kontrol müşteri tarafından kapatıldı                                                                                               | Müşteri "Kontrolü kapat"a tıkladı                                                                                                                                                   | Müşteriyle konuşun; gerekirse yeniden isteyin                                                                                                                                                                               |
| Kontrol müşteri tarafından kısayolla kapatıldı                                                                                     | Müşteri Ctrl+Shift+F12 (veya F11) bastı                                                                                                                                             | Aynı                                                                                                                                                                                                                        |
| Kontrol sistem tarafından kapatıldı (yetki veya kayıt)                                                                             | Yetkiniz kaldırıldı veya izin kaydı yazılamadı                                                                                                                                      | Yetkiniz varsa yeniden deneyin; tekrarlıyorsa yöneticinize bildirin                                                                                                                                                         |
| Uzaktan kontrol yetkiniz yok; kontrol istenemez                                                                                    | Hesabınızda yetki yok veya oturum sırasında kaldırıldı                                                                                                                              | Yöneticinizden yetki isteyin; yeni oturumda geçerli olur                                                                                                                                                                    |
| Müşteri bağlantısı koptu; kontrol kapandı                                                                                          | Müşterinin interneti gitti                                                                                                                                                          | Yeniden bağlanınca yeniden isteyin                                                                                                                                                                                          |
| Bağlantı yenilendi; kontrol yeniden istenmeli                                                                                      | Sizin bağlantınız koptu veya sekmeyi yenilediniz                                                                                                                                    | Yeniden isteyin                                                                                                                                                                                                             |
| Müşteri tarafında bağlantı kesildi; istek kapandı                                                                                  | İstek beklerken müşterinin görüntü bağlantısı koptu                                                                                                                                 | Ret sayılmaz; hemen yeniden isteyebilirsiniz                                                                                                                                                                                |
| Müşterinin bilgisayarı uzaktan kontrole izin vermiyor (Mac'te erişilebilirlik izni). Müşteri izni verdikten sonra yeniden isteyin. | Mac müşterisinde macOS Erişilebilirlik izni yok; ya da Linux X11 müşterisinde kontrol koşulları sağlanamadı (ör. ekran kilidi izlenemiyor). Kontrol penceresi açılmadı              | Mac: müşteriden izni vermesini isteyin (Sistem Ayarları → Gizlilik ve Güvenlik → Erişilebilirlik → Nokta Destek). Linux: bkz. "Müşteri Linux kullanıyorsa". Ret sayılmaz, 30 sn bekleme yok, hemen yeniden isteyebilirsiniz |
| Müşterinin masaüstü uzaktan kontrole izin vermiyor (Wayland)                                                                       | Linux Wayland müşterisi sistem izin penceresinde "Uzaktan etkileşime izin ver"i açmadı, ekran kilidi kısayolu kapalı ya da istemci bu sunucuda Wayland'de yalnız görüntü paylaşıyor | Ret sayılmaz, bekleme yok. Müşteriden oturumu yeniden başlatıp anahtarı açmasını ya da X11 ("Ubuntu on Xorg") oturumuyla girmesini isteyin                                                                                  |

### Uyarılar

- **"Yükseltilmiş pencere — kontrol edilemiyor. Müşteriden onaylamasını isteyin."** Müşterinin önündeki pencere yönetici
  yetkisiyle açılmış. Windows bu pencereye uzaktan girdi kabul etmez. İşlemi müşteriye yaptırın.
- **"Müşteri güvenli masaüstünde"** Müşteride Windows onay ekranı (UAC) veya kilit ekranı açık. Bu sırada görüntü
  durur, kontrol uygulanamaz. Müşteri işlemi bitirince görüntü geri gelir.
- **"Müşteri istemcisi yönetici olarak çalışıyor — yükseltilmiş pencereler ve UAC ekranı denetlenebilir"** Müşteri
  Hızlı Destek'i yönetici olarak açmış. Kontrol engellenmez; müşteri de ekranında bir uyarı görür. Gerekmiyorsa
  müşteriden programı normal açmasını isteyin.

### Müşteri Mac kullanıyorsa (Hızlı Destek macOS)

- **Tuş eşlemesi:** konsoldaki klavyeniz Windows düzenine göre Mac'e çevrilir: **Ctrl → ⌘ (Command)**, **Windows tuşu →
  Control**, **Alt → Option**. Yani Mac'te kopyalamak için Ctrl+C'ye basarsınız (Mac'te ⌘C olur). AltGr ile yazılan
  karakterler (`@ # { [ ] } \ |`) olduğu gibi gider. Ekran kilidi kısayolu (Control+⌘+Q) iletilmez. Teknisyen Mac
  kullanıyorsa da eşleme aynıdır: ⌘ yerine Ctrl kullanın.
- **Erişilebilirlik izni:** müşteri izni vermediyse kontrol isteğiniz "Müşterinin bilgisayarı uzaktan kontrole izin
  vermiyor (Mac'te erişilebilirlik izni)…" ile kapanır. Bu ret değildir; müşteri izni verince hemen yeniden isteyin.
  Konsol müşterinin işletim sistemini bilmediği için bu metin Linux X11 müşterisinde de görünür. Denetim kaydında Mac için
  "Müşteri erişilebilirlik izni vermedi", Linux için "Müşterinin masaüstü uzaktan kontrole izin vermiyor (Linux)" yazar.
- **"Yükseltilmiş pencere — kontrol edilemiyor"** uyarısı Mac'te, müşterinin bir **parola alanında** olduğu anlamına
  gelir (macOS klavye girişini korumaya alır). Parolayı müşteri yazar. Kilit ekranında "Müşteri güvenli masaüstünde"
  görünür.
- **Fare Tuşları:** müşterinin Mac'inde Fare Tuşları açıksa sayısal tuş takımı ve `7 8 9 U I O J K L M .` tuşları
  iletilmez. Nokta Destek pencerelerinin üzerindeyken bu tuşlar her durumda iletilmez; bu pencerelere tıklamalarınız da
  düşer (onay düğmelerine yalnız müşteri basabilir).
- **İlk açılış:** Mac sürümü Apple Developer ID olmadan (ad-hoc) imzalıdır. Müşteri ilk açılışta macOS uyarısında
  **Bitti**'yi seçer, **Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç** ile onaylar (bkz. "Mac'te nasıl indirir ve
  açarım?"). Müşteriye uygulamayı e-posta ya da mesajla göndermeyin; her zaman destek bağlantısını verin, müşteri sayfadan
  kendisi indirsin. Uyarı "zarar verir / kötü amaçlı" diyorsa müşteriye açtırmayın. Müşterinin yönetici parolası yoksa
  tarayıcıdan paylaşıma geçin. Her yeni sürümde onay ve izinler yeniden istenir; izin listede açık görünüp çalışmıyorsa
  müşteriye eski kaydı **−** ile kaldırtıp uygulamayı yeniden açtırın.
- **Destek talebi (0.24 ve sonrası):** Mac müşterisi firma bağlantısından inen `.zip` ile **Destek iste** diyebilir. Talep
  panelde Windows talebiyle aynı görünür; kabul ettiğinizde Erişilebilirlik izni yoksa kontrol isteğiniz kodla açılan Mac
  oturumundaki gibi yukarıdaki "Müşterinin bilgisayarı uzaktan kontrole izin vermiyor…" metniyle kapanır. Mac'te bilgisayar kaydı olmadığı için talepte "Kayıtlı bilgisayar" rozeti
  çıkmaz. Müşteri talebi gönderdikten sonra uygulamayı yeniden başlatırsa talep iptal olur.
- **Sesli görüşme (0.26 ve sonrası):** Windows müşterisiyle aynı çalışır. Müşteri Mikrofon iznini vermezse görüşme "Müşterinin
  mikrofonu açılamadı" ile biter; müşteriden izni açmasını isteyip 30 sn sonra yeniden isteyin. Mac uygulaması 0.25 veya
  daha eskiyse ya da Mac sesi desteklemiyorsa düğme pasiftir.
- **Pencere paylaşımı (0.26 ve sonrası):** rozet ve ipucu Windows'takiyle aynıdır (bkz. "Müşteri yalnız bir pencere
  paylaşıyorsa"). Mac'te **menü çubuğunu görmezsiniz**: menü komutu için müşteriden menüyü açmasını isteyin ya da kısayol
  kullanın. Kaydet / Aç penceresini müşteri kullanır. Küçültülmüş, başka masaüstündeki ya da tam ekran pencere listede
  çıkmaz; görünmez olursa siyah ekran görürsünüz.
- **Pencere modunda gitmeyen tuşlar (Mac):** Ctrl, Alt ve Windows tuşundan ikisi birlikte basılan her kısayol; Ctrl+Space,
  Ctrl+Tab, Ctrl+\`, Ctrl ile F tuşları, Ctrl+Shift+Q, Ctrl+Shift+3–6; Windows tuşu (Mac'te Control) ile oklar, harfler, Tab,
  Esc, Boşluk ve F tuşları; Alt+Space ve Alt ile noktalama; tek başına F3, F4, F11; art arda beş Shift ya da Alt. Çalışanlar:
  normal yazı, Ctrl+C/V/X/Z/A/S, Ctrl+Shift+Z/S, Alt ile harf ve rakam, AltGr ile `@ # { } [ ] \ |`. Ctrl+W ve Ctrl+Q
  paylaşılan programı kapatabilir; o zaman paylaşım durur.
- **Yazdırma:** müşterinin onay penceresinde sayfa sayısı ve yazıcı adı yazmaz ("Sayfa sayısı: yazıcıda belirlenir",
  "Varsayılan yazıcı"). Müşterinin varsayılan yazıcısı yoksa bunu müşteri onayladıktan sonra görürsünüz.
- Audit log'da katılım satırının ayrıntısında **İşletim sistemi (beyan)**: Windows / macOS / Linux / Tarayıcı yazar. Bu
  bilgi müşteri programının kendi beyanıdır; yetki kararlarında kullanılmaz.

### Müşteri Linux kullanıyorsa (Hızlı Destek Linux)

Hızlı Destek Linux sürümü (0.20 ve sonrası) Ubuntu 22.04 / 24.04 x86_64 üzerinde çalışır. Müşterinin masaüstü oturum
türü (X11 ya da Wayland) kontrolü doğrudan etkiler.

- **X11:** kontrol Windows sürümündeki gibi çalışır. Müşteri kontrolü **Ctrl+Shift+F12** (yedek F11) ile kapatır; müşteri
  faresini oynatınca hareketiniz yaklaşık 1 saniye durur. Kısayol kaydedilemezse kontrol hiç sunulmaz. Ekran kilidi
  izlenemiyorsa kontrol isteğiniz "Müşterinin bilgisayarı uzaktan kontrole izin vermiyor (Mac'te erişilebilirlik izni)…"
  ile kapanır; metin Mac'i ansa da Linux X11'de de bu metin görünür. Ret sayılmaz.
- **Wayland:** müşteri ekranı Ubuntu'nun sistem izin penceresinde seçer; siz konsoldan başka ekrana geçemezsiniz. Kontrol
  yalnız müşteri o pencerede **Uzaktan etkileşime izin ver**'i açtıysa çalışır. Açmadıysa, ekran kilidi kısayolu
  kapalıysa ya da istemci bu sunucuda Wayland'de yalnız görüntü paylaşacak biçimde derlendiyse isteğiniz **"Müşterinin
  masaüstü uzaktan kontrole izin vermiyor (Wayland)"** ile kapanır. Bu ret değildir; 30 sn bekleme yoktur, istek hakkınız
  iade edilmez.
- **Wayland'de müşterinin fare hareketi sizi durdurmaz.** Müşteri kontrolü **Kontrolü kapat** düğmesiyle, **Super+L** ile
  ekranı kilitleyerek ya da üst çubukta **Durdur** ile keser. Ekran kilitlenince kontrol hemen kapanır ve konsolda
  "Müşteri güvenli masaüstünde" yazar; kilit açılınca kontrol kendiliğinden geri gelmez, yeniden istersiniz. **Durdur**
  oturumu da bitirir. Müşterinin Super+L'yi her zaman kullanabilmesi için değiştirici tuşları (Ctrl, Alt, Shift, Super) 3
  saniyelik bir pencerede en çok 2 saniye basılı tutabilirsiniz; uzun basılı tutulan değiştirici kendiliğinden bırakılır.
- **Tuşlar:** klavyeniz Windows düzeniyle aynı tuşlara gider; Windows tuşu müşteride **Super** tuşudur.
- **İşaretleme:** Linux'ta çizimleriniz ve müşteri ekranındaki kırmızı çerçeve görüntüye de girer; çiziminizi aynı yerde
  iki kat görürsünüz. Bu beklenen bir durumdur.
- **Görüntü:** Linux istemcisi görüntüyü VP8 ile gönderir (Windows ve Mac H.264). Konsolda fark görmezsiniz; büyük ekranlarda
  çözünürlük işlemci gücüne göre düşük başlayabilir.
- **Olmayanlar:** pencere paylaşımı, "Destek iste" ve gözetimsiz erişim. Oturum sohbeti 0.21 ve sonrasında çalışır; 0.20'de
  kapalıdır (konsolda "istemci eski" uyarısı çıkar). Sesli görüşme, pano, yazdırma, dosya, çoklu teknisyen ve kayıt rızası çalışır.
- **Yazdırma:** Mac'teki gibi müşterinin onay penceresinde sayfa sayısı ve yazıcı adı yazmaz.

### Sohbette "Çok hızlı yazıyorsunuz" uyarısı

Konsolda ve müşterinin tarayıcı sayfasında sohbetten saniyede en çok **5 mesaj** gönderilebilir. Daha hızlı gönderirseniz
mesaj **gönderilmez**, yazdığınız metin kutuda kalır ve altında "Çok hızlı yazıyorsunuz. Mesaj gönderilmedi; bir saniye
sonra yeniden gönderin." yazar. Bir saniye bekleyip **Gönder**'e yeniden basın. Sınırın içinde gönderilen mesajlar karşı
tarafa eksiksiz ulaşır. Müşterinin Hızlı Destek programında (0.21 ve sonrası) aynı sınır geçerlidir; orada kısaca "Çok
hızlı yazıyorsunuz" yazar.

---

## Teknisyen için: Pano ve uzaktan yazdırma (konsol)

Konsolun yan panelinde **Pano ve yazdırma** bölümü vardır. Buradan müşteriye düz metin gönderir, müşterinin panosundaki
metni alır ve bir PDF'i müşterinin yazıcısından bastırırsınız. Pano metni ve belge sunucudan geçmez; doğrudan müşteriye
gider.

**Ön koşullar**

| Gerekli                | Pano (gönder / al)                            | Uzaktan yazdır                               |
| ---------------------- | --------------------------------------------- | -------------------------------------------- |
| Yetki                  | **Uzaktan kontrol → Pano paylaşımı**          | **Dosya transferi → Uzaktan yazdır**         |
| Müşteri programı       | Hızlı Destek **0.13 veya sonrası** (Windows)  | Hızlı Destek **0.13 veya sonrası** (Windows) |
| Uzaktan kontrol izni   | Evet ("Kontrol sizde")                        | Evet ("Kontrol sizde")                       |
| Müşterinin ayrıca izni | **Pano paylaşımına izin ver** kutusu işaretli | Her belge için müşteri **Yazdır**'a basar    |

Yetkiniz yoksa ilgili düğme hiç görünmez. Diğer koşullardan biri eksikse düğme pasiftir ve altında nedeni yazar.

### Müşteriye metin nasıl gönderirim? ("Panoyu gönder")

1. Göndereceğiniz metni kendi bilgisayarınızda kopyalayın (Ctrl+C).
2. **Panoyu gönder**'e tıklayın. Düğme "Gönderiliyor…" olur.
3. "Müşterinin panosuna kopyalandı" bildirimi çıkar. Müşteriden metni yapıştırmasını (Ctrl+V) isteyin veya kontrolle
   kendiniz yapıştırın.

### Müşterinin panosundaki metni nasıl alırım? ("Müşteri panosunu al")

1. Müşteriden metni kopyalamasını isteyin (ya da kontrolle kendiniz kopyalayın).
2. **Müşteri panosunu al**'a tıklayın. Düğme "Alınıyor…" olur.
3. "Metin panonuza kopyalandı — kişisel veri içerebilir; işiniz bitince panoyu temizleyin" bildirimi çıkar. Metin ekranda
   gösterilmez; kendi bilgisayarınızda yapıştırın.

Notlar:

- Yalnız düz metin, en çok **64 KB**. Türkçe karakterler, emoji ve satır sonları aynen korunur.
- Tarayıcı ilk kullanımda pano izni isteyebilir. **Firefox ve Safari** okumada ayrıca "Yapıştır" onayı ister; **Chrome
  veya Edge** önerilir. Firefox/Safari'de "Al"dan sonra birkaç saniye beklerseniz tarayıcı panoya yazmayı reddedebilir
  ("Tarayıcı panoya yazmaya izin vermedi"); yeniden **Al**'a tıklayın.
- Müşteriden aldığınız metin parola veya kişisel veri içerebilir. Windows pano geçmişini (Win+V) ve bulut panosunu
  kapatın ya da metni kullandıktan sonra panonuzu temizleyin. Aldığınız metni **komut satırına körlemesine yapıştırmayın**.
- Müşterinin panosuna sizin koyduğunuz metni geri almaya çalışırsanız "Pano içeriği gizli olarak işaretli, aktarılmadı"
  döner. Bu beklenen bir güvenlik davranışıdır.
- Dakikada en çok 30 pano isteği gönderilebilir; bir istek bitmeden yenisi başlamaz ("Önceki işlem sürüyor").

### Belgeyi müşterinin yazıcısından nasıl bastırırım? ("Uzaktan yazdır")

1. Kontrol sizdeyken **Uzaktan yazdır**'a tıklayın ve bilgisayarınızdan bir PDF seçin. Yalnız **PDF**, en çok **20 MB**.
2. Durum satırı sırayla "Hazırlanıyor…", "Müşteri uygulaması hazırlanıyor…", "Gönderiliyor %…" ve "Müşteri onayı bekleniyor
   (… sn)" gösterir. Müşteriye telefonda ekranındaki pencereden **Yazdır**'a basmasını söyleyin.
3. Müşteri onaylayınca "Belge müşterinin yazıcısına gönderildi (… sayfa)" yazar. Belge müşterinin **varsayılan
   yazıcısına tek kopya** gider; yazıcı veya kopya sayısı seçilemez.
4. Vazgeçmek için iş sürerken **Vazgeç**'e tıklayın.

Kurallar:

- Aynı anda tek yazdırma işi olur. Müşteri reddederse veya 60 saniye yanıt vermezse düğme **30 saniye** pasif kalır
  ("Müşteri reddetti veya yanıt vermedi; … sn sonra tekrar deneyin").
- Bir oturumda en çok **20** yazdırma isteği gönderilebilir.
- Yazdırma sürerken başka dosya gönderilemez; dosya gönderimi sürerken de yazdırma başlamaz ("Başka bir aktarım sürüyor").
- Kontrol bırakılırsa veya müşteri kontrolü kapatırsa bekleyen yazdırma iptal olur: "Kontrol izni kapandı, yazdırma
  iptal edildi".

### Düğme neden pasif? (neden metinleri)

| Düğmenin altında yazan                                                              | Ne yapmalı                                                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Bağlantı kuruluyor…                                                                 | Birkaç saniye bekleyin.                                                                       |
| Müşteri bağlı değil                                                                 | Müşterinin bağlanmasını ve kabul etmenizi bekleyin.                                           |
| Pano yalnız müşteri uygulamasında ve kontrol izniyle kullanılır                     | Müşteri tarayıcıdan bağlı. Pano ve yazdırma için Hızlı Destek programıyla bağlanmalı.         |
| Gözetimsiz oturumda kullanılamaz — müşteri onayı gerekir                            | Gözetimsiz bağlantıda pano ve yazdırma bilerek kapalıdır (başında onay verecek kimse yok).    |
| Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin | Müşterinin programı 0.13'ten eski. Yeni bağlantı gönderin; müşteri güncel sürümü indirsin.    |
| Önce uzaktan kontrol izni alın                                                      | **Kontrol iste** ile izin alın.                                                               |
| Müşteri pano paylaşımına izin vermedi                                               | Müşteriden oturum penceresinde **Pano paylaşımına izin ver** kutusunu işaretlemesini isteyin. |
| Müşteri reddetti veya yanıt vermedi; … sn sonra tekrar deneyin                      | Süre dolunca yeniden deneyin.                                                                 |

Tarayıcıyla bağlanan müşteride **Uzaktan yazdır** düğmesi hiç görünmez.

### Sık karşılaşılan mesajlar (pano ve yazdırma)

| Mesaj                                                                           | Anlamı / ne yapmalı                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Panoda metin yok                                                                | Kopyalanan şey metin değil (dosya, resim) ya da pano boş. Metni yeniden kopyalayın.                                                         |
| Pano metni 64 KB sınırını aşıyor                                                | Metni bölün veya dosya olarak gönderin.                                                                                                     |
| Pano içeriği gizli olarak işaretli, aktarılmadı                                 | Müşterinin panosunda parola yöneticisinin gizli işaretlediği içerik var (ya da sizin koyduğunuz metin). Aktarılmaz.                         |
| Müşteri tarafında izin kapalı, aktarılmadı                                      | Müşterinin pano kutusu veya kontrol izni bu sırada kapandı.                                                                                 |
| Pano aktarımı başarısız / Pano aktarımı zaman aşımına uğradı                    | Müşteride başka bir program panoyu tutuyor olabilir. Biraz sonra yeniden deneyin.                                                           |
| Tarayıcı pano okumasına izin vermedi — adres çubuğundaki site izinlerinden açın | Adres çubuğundaki kilit/ayar simgesinden bu site için "Pano" iznini açın.                                                                   |
| Bu tarayıcı panoya erişimi desteklemiyor — Chrome veya Edge kullanın            | Tarayıcınızı değiştirin.                                                                                                                    |
| Yalnız PDF dosyası yazdırılabilir                                               | Seçtiğiniz dosya PDF değil. Belgeyi "PDF olarak kaydet" ile dönüştürün.                                                                     |
| Dosya 20 MB sınırını aşıyor                                                     | Belgeyi küçültün veya bölün; ya da dosya olarak gönderip müşteriye yazdırtın.                                                               |
| Müşterinin varsayılan yazıcısı yok                                              | Müşteri Windows ayarlarından bir yazıcıyı varsayılan yapmalı.                                                                               |
| Müşteri yazdırmayı reddetti / Müşteri yanıt vermedi                             | Müşteriyle konuşun; 30 saniye sonra yeniden deneyin.                                                                                        |
| Belge açılamadı (bozuk veya parola korumalı)                                    | PDF'i açıp parolasız olarak yeniden kaydedin, tekrar gönderin.                                                                              |
| Yazdırma başarısız oldu                                                         | Müşterinin yazıcısı çevrimdışı veya sürücü hatası olabilir. Müşteri aynı belgeyi kendisi yazdırabiliyor mu, deneyin; yöneticinize bildirin. |
| Yazdırma yanıtsız kaldı (süre doldu) / Müşteri bağlantısı koptu                 | 10 dakikada sonuç gelmedi veya müşteri koptu. Bağlantıyı kontrol edip yeniden deneyin.                                                      |
| Bu oturumda yazdırma sınırına ulaşıldı.                                         | 20 istek doldu. Gerekirse yeni oturum açın.                                                                                                 |

---

## Teknisyen için: Dosyalar sunucuda taranırken

Firmanızın Admin'i **Ayarlar > Dosyalar**'da "Dosyaları sunucu üzerinden aktar ve virüs tara"yı açtıysa, bundan sonra açılan
oturumlarda dosyalar sunucu üzerinden gider. Konsoldaki dosya panelinin üstünde "Dosyalar sunucuda virüs taramasından
geçer; bu modda uçtan uca şifreli değildir" satırını görürsünüz. Ayar açık bir oturumun ortasında değişirse o oturum eski
yoluyla sürer; yeni yol bir sonraki oturumda geçerli olur.

### Nasıl dosya gönderirim?

1. Dosya panelinde **Dosya gönder**'e basın ve dosyayı seçin. Panelde "Dosya başına en çok … MB. Dosyalar sunucu
   üzerinden aktarılır." yazar; bu modda sınır firma sınırı ile 256 MB'tan küçük olanıdır.
2. Satırda sırasıyla şu durumları izleyin:

| Durum                                           | Anlamı                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Yükleniyor %n                                   | Dosya sunucuya şifreli olarak yükleniyor                               |
| Virüs taraması yapılıyor                        | Dosya taranıyor (genelde saniyeler, en çok 1 dakika)                   |
| Müşteri onayı bekleniyor                        | Dosya temiz; müşteriye teklif edildi                                   |
| Teslim edildi                                   | Müşteri aldı ve dosyanın bozulmadığı doğrulandı                        |
| Dosya virüslü bulundu (<imza>), teslim edilmedi | Tarayıcı virüs buldu; dosya hemen silindi, müşteri de aynı metni görür |
| Dosya taranamadı, teslim edilmedi: <neden>      | Dosya taranamadığı için gönderilmedi (aşağıdaki nedenler)              |
| Alıcı reddetti                                  | Müşteri reddetti; dosya hemen silindi                                  |

**"Taranamadı" nedenleri:** "şifreli arşiv" (parolalı zip; parolasız gönderin), "tarama boyut sınırı" ya da "tarama zaman
aşımı" (çok büyük veya iç içe arşiv; bölerek gönderin), "tarama servisine ulaşılamadı" ve "tarama hatası" (sistem yöneticisine
bildirin). "Virüs tarama servisi yoğun, dosya teslim edilmedi" görürseniz biraz sonra yeniden gönderin. Taranamayan dosya
virüslü sayılmaz, yalnız teslim edilmez.

### Müşteriden dosya gelirse

Tarayıcıyla bağlanan müşteri dosya gönderirse dosya önce taranır, temizse size **Gelen dosya** teklifi gelir; kabul
ettiğinizde indirilir. Windows programındaki müşteri bu modda dosya gönderemez (yalnız alır).

### Gönderilemediğinde görülen mesajlar

| Mesaj                                                                               | Ne yapmalı                                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin | Müşterinin Hızlı Destek'i 0.14'ten eski; güncel sürümü indirmesini isteyin  |
| Başka bir dosya aktarımı sürüyor                                                    | Aynı yönde bir aktarım bitene kadar bekleyin                                |
| Dosya sunucu modunda 256 MB sınırını (ya da firma sınırını) aşıyor                  | Dosyayı küçültün veya bölün                                                 |
| Çok sık dosya gönderildi; biraz sonra yeniden deneyin                               | Bir dakika bekleyin                                                         |
| Bu oturumda sunucu üzerinden en çok 2 GB aktarılabilir                              | Yeni bir oturum açın                                                        |
| Firma depolama kotası doldu                                                         | Admin'e bildirin (kota Super Admin'de; Admin saklama süresini kısaltabilir) |
| Bu işlem için yetkiniz yok                                                          | "Dosya aktarımı" yetkiniz kapalı; Admin'e başvurun                          |

- **Gözetimsiz cihazlarda** bu firmada dosya aktarımı kapalıdır; panelde "Bu firmada dosyalar sunucuda taranır; gözetimsiz
  oturumda dosya aktarımı kapalı" yazar.
- **Uzaktan yazdırma** da aynı yoldan gider: "Gönderiliyor %n" → "Virüs taraması yapılıyor" → müşteri onayı. Virüs veya
  taranamama durumunda belge basılmaz ve aynı metin görünür.

## Teknisyen için: Oturum geçmişi

Kenar menüsündeki **Oturum geçmişi** biten ve süren destek oturumlarınızı listeler. Menüde göremiyorsanız hesabınızda
görüntüleme yetkisi yoktur; yöneticinize başvurun. Teknisyen (User) yalnız **kendi** oturumlarını görür.

### Nasıl bir oturumu bulurum?

1. **Oturum geçmişi**'ni açın. En yeni oturum en üsttedir; sayfa başına 25 kayıt gelir (alttan 10/50/100 seçilebilir).
2. Filtrelerden ihtiyacınız olanı doldurun:
   - **Başlangıç / Bitiş tarihi:** oturumun açıldığı gün (Türkiye saatiyle). Bitiş, başlangıçtan önce olamaz.
   - **Durum:** Bekliyor, Aktif, Bitti, Süresi doldu, İptal.
   - **Bağlantı:** İstemci (Hızlı Destek) veya Tarayıcı.
   - **Teknisyen** (Admin ve Super Admin'de görünür): firmanızdaki **tüm** teknisyenler listelenir; yalnız bu sayfada
     görünenler değil. Pasif hesaplar "(pasif)" ekiyle yer alır. Firma seçmemiş Super Admin'de liste yalnız ekrandaki
     kayıtlardan gelir; alanın altında "tam liste için önce firma seçin" yazar.
   - **Firma** (yalnız firma seçmemiş Super Admin'de): kutuya firma adının bir kısmını yazın; yazdığınıza uyan en çok
     20 firma listelenir. Ok tuşlarıyla seçip Enter'a basabilirsiniz. Pasif firmalar "Pasif" ekiyle görünür.
   - **Müşteri adı:** adın içinde geçen en az 2 harf.
3. **Filtrele**'ye basın. Filtreler adres çubuğuna yazılır; bağlantıyı kopyalayıp paylaşabilir, sayfayı yenileyebilirsiniz.
4. Sıfırlamak için **Filtreleri temizle**.

Listede "Ad kaydı yok" görürseniz müşteri adı kaydedilmemiştir (eski oturumlar). "Bağlanılmadı", müşterinin hiç
bağlanmadığını gösterir. Süren oturumda süre canlı sayar.

### Ayrıntı ekranında neler var?

Satıra tıklayınca oturum ayrıntısı açılır:

- **Özet:** oluşturma, başlangıç, bitiş, süre, bağlantı, müşteri adı ve e-postası, kim bitirdi ve neden.
- **Ticket ve not:** aşağıya bakın.
- **Onay kayıtları:** müşterinin ekran paylaşımı ve uzaktan kontrol için verdiği, reddettiği veya geri aldığı izinler;
  onaylanan aydınlatma metninin sürümü.
- **Kontrol dönemleri:** uzaktan kontrolün ne zaman verildiği ve kapandığı, kimin hangi yolla kapattığı.
  "Kapanış kaydı yok" yazarsa kapanış zamanı bilinmiyor demektir; tahmin edilmez. Sarı "Müşteri istemcisi yönetici
  olarak çalışıyordu" rozeti, programın yönetici olarak açıldığını gösterir. Tarayıcıyla bağlanan oturumda kontrol yoktur.
- **Zaman çizelgesi:** oturumdaki olaylar sırasıyla (kabul, kontrol istekleri, bitiş…). Başarısız olaylar kırmızı ve
  "(başarısız)" etiketlidir. En çok 500 olay gösterilir.
- **Kalite özeti** ve **Dosyalar:** ortalama görüntü kalitesi, aktarılan dosyaların adı, boyutu ve sonucu (içerik saklanmaz).
  Her dosyanın sonucunun yanında bir etiket bulunur:
  - **Doğrulanmış:** aktarımı teknisyen tarafı (konsol) bildirdi; kayıt güvenilirdir.
  - **Müşteri bildirimi:** aktarımı yalnız müşterinin programı bildirdi, teknisyen tarafından doğrulanmadı. Örneğin
    konsol aktarım sırasında kapandıysa böyle görünür.

- **Destek talebi:** oturum bir talepten doğduysa talep zamanı, kabul zamanı, bekleme süresi ve SLA tanımlıysa **SLA
  hedefi** satırı: hedef tarih/saat ve yanında "SLA aşıldı" (kırmızı) ya da "SLA içinde" (yeşil). SLA'sız talepte satır
  görünmez.

"Oturum bulunamadı" görürseniz oturum sizin değildir, silinmiştir ya da bağlantı hatalıdır.

### Sunucudaki dosyaları nasıl yeniden indiririm?

Oturum sunucu üzerinden dosya aktarımıyla yapıldıysa ayrıntı ekranında **Sunucudaki dosyalar** bölümü çıkar (yalnız
böyle bir dosya varsa). Sütunlar: dosya, yön, boyut, durum ve **Saklama sonu**.

1. Durumu "Teslim edildi — saklanıyor" olan satırda **İndir**'e basın.
2. Dosya tarayıcınıza indirilir. İndirme bağlantısı 5 dakika geçerlidir; her indirme denetim kaydına yazılır.

- **İndir** düğmesini görmek için hem "Oturum geçmişi" hem "Dosya aktarımı" yetkiniz olmalı. Teknisyen yalnız kendi
  oturumlarının, Admin firmanın tüm oturumlarının dosyalarını indirir.
- "Yazdırma belgesi — saklanmaz": uzaktan yazdırılan belgeler saklanmaz, indirilemez.
- "Teslim edilmedi — saklanmadı": reddedilen veya iptal edilen dosya hemen silinmiştir.
- Virüslü ve taranamayan dosyalar kırmızı yazılır; bunlar hiç saklanmaz.
- "Süresi doldu": saklama süresi bitmiş, dosya gece 03:30'da silinmiştir.
- "Dosya indirilemedi. Saklama süresi dolmuş olabilir; sayfayı yenileyip tekrar deneyin." görürseniz sayfayı yenileyin.

### "Anonimleştirildi" rozeti ne demek?

Firmanızın **saklama süresi** (varsayılan 365 gün) dolan bitmiş oturumlarda müşterinin kişisel bilgileri her gece
kendiliğinden silinir. Bu oturumlar listede ve ayrıntıda **Anonimleştirildi** rozetiyle görünür.

| Silinenler                                                               | Korunanlar                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Müşteri adı ve e-postası (yerinde "Anonimleştirildi" yazar)              | Oturum no, tarihler, süre, durum, bağlantı türü                                 |
| Not                                                                      | Ticket no                                                                       |
| Onay kayıtlarındaki IP ve tarayıcı bilgisi                               | Onay kararları (izin verildi/reddedildi/geri alındı) ve onaylanan metnin sürümü |
| Dosya kayıtları ("Dosya kayıtları saklama süresi dolduğu için silindi.") | Kalite özeti, kontrol dönemleri                                                 |
| Zaman çizelgesinde müşteri adı ve sonlandırma gerekçesi                  | Zaman çizelgesindeki olaylar                                                    |

- Anonimleştirilmiş oturum **düzenlenemez**: Ticket ve not bölümü salt okunur görünür ("Anonimleştirilmiş oturum
  düzenlenemez.").
- Sayfa açıkken oturum anonimleşir ve **Kaydet**'e basarsanız "Bu oturum saklama süresi dolduğu için anonimleştirildi;
  düzenlenemez." yazar, sayfa salt okunur görünüme geçer. Yaptığınız değişiklik kaydedilmez.
- CSV dosyasında bu oturumların **Müşteri** hücresinde `Anonimleştirildi` yazar, **Not** boştur.
- Anonimleştirilmiş oturum 30 gün sonra gece işinde kalıcı silinebilir ve listeden kalkar (bkz. "Kişisel verilerin
  saklama süresi ve anonimleştirme").

### Nasıl ticket numarası ve not eklerim?

1. Oturumun ayrıntısını açın, **Ticket ve not** bölümüne gelin.
2. **Ticket no** (yardım masası kayıt numarası, en çok 50 karakter) ve **Not** (en çok 4.000 karakter) alanlarını
   doldurun. Sayaç sınırı aşınca kırmızı olur.
3. **Kaydet**'e basın. "Ticket ve not kaydedildi" mesajı çıkar. Vazgeçmek için **Değişiklikleri geri al**.

- Alanı boşaltıp kaydederseniz ticket/not silinir. Bitmiş oturumlara da not eklenebilir.
- **Ticket no alanına kişisel veri (ad, telefon, e-posta) yazmayın.** Ticket no saklama süresi dolduktan sonra da korunur;
  yalnız yardım masası kayıt numarasını yazın. Müşteriyle ilgili bilgileri **Not** alanına yazın (not süre dolunca silinir).
- Kaydetmeden başka sayfaya geçmeye veya tarayıcının **geri** tuşuna basmaya çalışırsanız "Kaydedilmemiş değişiklikler
  var" penceresi çıkar. **Sayfada kal** (veya Esc) ile formunuza dönersiniz; **Kaydetmeden ayrıl** değişiklikleri atar.
  Sekmeyi kapatırken ya da sayfayı yenilerken tarayıcının kendi uyarısı çıkar.
- Alanlar görünüyor ama düzenlenemiyorsa ("Ticket ve notu düzenleme yetkiniz yok") yöneticinizden yetki isteyin.

### Nasıl CSV olarak dışa aktarırım ve Excel'de açarım?

1. Listede istediğiniz filtreleri uygulayın.
2. Sağ üstteki **Dışa aktar (CSV)**'ye basın. Dosya `oturumlar-YYYYAAGG-SSdd.csv` adıyla iner.
3. Dosyaya çift tıklayın. Türkçe Excel dosyayı doğrudan sütunlara ayırır; Türkçe harfler doğru görünür, saatler
   Türkiye saatidir.

- Dosyada: oturum no, oluşturma/başlangıç/bitiş, süre, durum, mod, kaynak, müşteri firma, bekleme, teknisyen, müşteri,
  ticket no, sonlandıran, bitiş nedeni, not, **Dosyalar** ve **SLA aşıldı**. "Dosyalar" sütununda aktarılan dosya sayısı yazar (ör.
  `2 doğrulanmış; 1 müşteri bildirimi`); dosya yoksa boştur. "SLA aşıldı" sütununda `Evet` / `Hayır` yazar; talepsiz oturumda ya da SLA'sız talepte boştur.
  E-posta ve onay kayıtları dosyaya girmez.
- `=`, `+`, `-`, `@` ile başlayan değerlerin başında `'` görebilirsiniz. Bu bilerek eklenir; hücre formül olarak
  çalışmaz, metin kalır.
- Sütunlar tek sütunda toplanırsa Excel'in liste ayracı `;` değildir: **Veri → Metni Sütunlara Dönüştür** ile ayraç
  olarak noktalı virgül seçin.
- Düğme görünmüyorsa dışa aktarma yetkiniz yoktur.

| Mesaj                                                                      | Ne yapmalı                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------------- |
| En çok 50.000 satır dışa aktarılabilir; tarih aralığını daraltın           | Tarih aralığını kısaltın veya filtre ekleyin         |
| Kısa sürede çok fazla dışa aktarma yapıldı. N dakika sonra tekrar deneyin. | Dakikada en çok 5 dışa aktarma yapılabilir; bekleyin |
| Dışa aktarılamadı · Sunucuya ulaşılamadı                                   | Bağlantınızı kontrol edip tekrar deneyin             |

---

## Teknisyen için: Destek talepleri

Müşteriler, firmalarına özel Hızlı Destek dosyasından **destek talebi** gönderebilir. Talep, firmanızın kuyruğuna düşer;
müsait olan teknisyen kabul eder ve oturum doğrudan açılır. Müşteriye link veya kod okumanız gerekmez.

Kenar menüsündeki **Talepler** bağlantısını görmüyorsanız "Destek talepleri → Görüntüle" yetkiniz yoktur; yöneticinizden
isteyin. Kabul ve ret için ayrıca "Destek talepleri → Kabul et" yetkisi gerekir.

> **Önemli — her talepte:** Müşteriyi **firmanın kayıtlı numarasından** arayın (talepte yazan numaradan değil) ve
> müşterinin ekranındaki **6 haneli talep kodunu** sorun. Kod, karttaki kodla aynı değilse talebi kabul etmeyin.
> Talep formunu herkes doldurabilir; ad ve telefon müşterinin beyanıdır, doğrulanmış bilgi değildir.

### Kuyruk nasıl çalışır?

1. Kenar menüsünden **Talepler**'i açın. **Bekleyenler** sekmesi önce önceliğe (Yüksek → Normal → Düşük), aynı
   öncelikte geliş sırasına göre dizilir: en eski talep en üsttedir, ama sonradan gelen Yüksek öncelikli talep öne geçer.
2. Menüdeki rozet bekleyen talep sayısını gösterir. Sekme arka plandaysa tarayıcı sekmesinin başlığında da sayı görünür.
3. Liste kendiliğinden güncellenir. Bağlantı koparsa sayfanın üstünde "Liste güncellenemedi; gösterilen bilgiler eski
   olabilir." yazar; liste 15 saniyede bir yeniden yoklanır.
4. Talep kartında şunlar bulunur: müşterinin adı, telefonu, e-postası (verdiyse), sorun açıklaması, ne kadar süredir
   beklediği, istemci sürümü ve **Talep kodu**.

### Kaynak işaretleri ne anlama gelir?

| Kartta görünen                                                                              | Anlamı                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Bilinen kaynak** · "Güvenilen ağ"                                                         | Talep, yöneticinizin güvenilen olarak eklediği bir ağdan (ör. müşterinin ofisi) geldi |
| **Bilinen kaynak** · "Bu ağdan daha önce oturum yapıldı"                                    | Aynı internet adresinden daha önce destek oturumu yapıldı                             |
| **Bilinen kaynak** · "Bu bilgisayar daha önce destek aldı"                                  | Aynı bilgisayar daha önce destek aldı                                                 |
| "Benzer ağdan önceki oturum var"                                                            | Yakın bir adresten önceki oturum var; tek başına güven vermez                         |
| **"İlk kez görülen kaynak — firmanın kayıtlı numarasından arayıp talep kodunu doğrulayın"** | Bu kaynak ilk kez görülüyor; aramayı mutlaka yapın                                    |

"Bilinen kaynak" bile olsa telefonla talep kodunu doğrulama adımı atlanmaz.

### Talebi nasıl kabul ederim?

1. Müşteriyi firmanın kayıtlı numarasından arayın, ekranındaki talep kodunu sorun.
2. Kod eşleşiyorsa kartta **Kabul et**'e basın. Teknisyen konsolu açılır.
3. Müşterinin ekranında adınız ve 4 haneli doğrulama kodunuz görünür; müşteri **Ekranımı paylaş**'a basınca bağlantı kurulur.
   Sonrası normal oturumdur (uzaktan kontrol, sohbet, dosya aynı kurallarla).

Olası mesajlar:

- "Talep başka bir teknisyen tarafından alındı." — Bir iş arkadaşınız sizden önce kabul etti.
- "Talep artık açık değil (iptal edildi, süresi doldu veya reddedildi)."
- "Açık oturum sınırına ulaştınız. Bir oturumu bitirip tekrar deneyin; talep beklemede kalır."
- "Müşteri bağlantıyı kabul etmedi." — Müşteri onay ekranında Vazgeç dedi veya programı kapattı.
- "Müşteri 60 sn içinde bağlanamadı; talep kapandı."

### Talebi nasıl reddederim?

1. Kartta **Reddet**'e basın.
2. Hazır mesajlardan birini seçin: "Şu an müsait değiliz, sizi arayacağız", "Mesai saatleri dışındayız, sizi
   arayacağız", "Lütfen firmanızı telefonla arayın" — veya **Diğer (kendi mesajım)** ile kendiniz yazın.
3. Kendi mesajınız 5–200 karakter, tek satır olmalı; bağlantı, e-posta veya telefon numarası yazılamaz.
4. **Reddet** ile onaylayın. Müşteri mesajı ekranında görür.

### Bildirimler ve ses

- Yeni talep geldiğinde, hangi sayfada olursanız olun "Yeni destek talebi: <ad>" bildirimi çıkar. **Görüntüle** sizi
  ilgili karta götürür.
- **Bildirim sesi** düğmesiyle sesi açıp kapatırsınız. Tercih bu tarayıcıda saklanır. Tarayıcı sesi engellerse
  (sayfaya hiç tıklanmadıysa) yalnız görsel bildirim gelir.
- "Olağan dışı talep yoğunluğu." bandı çıkarsa bilinmeyen kaynaklardan gelen talepler bir süre geri çevriliyordur.
  Yöneticinize haber verin; gerekirse indirme bağlantısını yeniler.
- Firmanız WhatsApp bildirimini açtıysa kayıtlı numaralara da kısa mesaj gider (müşteri bilgisi içermez; talep kodu
  ve panel bağlantısı).

### Kartta öncelik, atama ve SLA işaretleri

| Kartta görünen                     | Anlamı                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| **Yüksek** / Normal / **Düşük**    | Talebin önceliği. Yüksek öncelikli talep kuyrukta öne geçer                                 |
| **Atandı: <ad>** · **Size atandı** | Talep bir teknisyene atanmış. Atama yalnız işaret ve bildirimdir; kabulü engellemez         |
| **SLA: 25 dk kaldı**               | Talebin kabul edilmesi gereken süreden kalan zaman. Süre yalnız mesai saatleri içinde işler |
| **SLA aşıldı** (kırmızı)           | Kabul hedef saatinde yapılmadı                                                              |
| **Mesai dışı**                     | Talep firmanın mesai saatleri dışında geldi; SLA süresi ilk açılış saatinde başlar          |

Öncelik ve SLA talep açılırken müşterinin (yoksa firmanın) varsayılanından gelir ve o talep için **sabitlenir**; ayarı
sonradan değiştirmek bekleyen talepleri etkilemez. SLA ayarlanmamışsa SLA rozeti görünmez.

### Talebi nasıl atarım ya da önceliğini değiştiririm?

Bunun için "Destek talepleri → Ata / öncelik" yetkiniz olmalıdır (Admin'de açık, teknisyende kapalı başlar).

1. Talep kartındaki menüyü açın.
2. **Ata…** ile listeden bir teknisyen seçip **Ata**'ya basın; ya da **Bana ata** ile talebi kendinize alın.
   Listede yalnız talebi kabul edebilecek, etkin iş arkadaşlarınız görünür. Super Admin atama yapabilir, kendisine
   talep atanamaz.
3. Atamayı geri almak için **Atamayı kaldır**.
4. **Öncelik** ile Düşük / Normal / Yüksek seçin. Kuyruk hemen yeniden sıralanır; SLA hedefi değişmez.

- Atanan teknisyen panel açıksa "Size bir talep atandı — <talep kodu>" bildirimini ve sesi alır (**Bana ata** bildirim
  üretmez). Panel kapalıysa bildirim gitmez; e-posta/WhatsApp ile atama bildirimi yoktur.
- Diğer teknisyenler kartta "Atandı: <ad>" çipini anında görür.
- Bir kullanıcı pasife alınırsa ya da talep yetkileri kaldırılırsa üzerindeki atamalar kendiliğinden kalkar.
- Atama ve öncelik değişiklikleri denetim kaydına "eski → yeni" olarak yazılır.

### "Bana atanan" ve "Atanmamış" filtresi

**Bekleyenler** sekmesindeki **Atama filtresi** ile **Tümü**, **Bana atanan** veya **Atanmamış** talepleri görün.
Müşteri firma filtresiyle birlikte kullanılabilir. Filtreye uyan talep yoksa "Size atanmış bekleyen talep yok" ya da
"Atanmamış bekleyen talep yok" yazar; **Tüm bekleyen talepler** ile filtreyi kaldırın.

### Başkasına atanmış talebi kabul etmek

Atanmış bir talebi de kabul edebilirsiniz (ör. atanan kişi meşgulse). **Kabul et**'e basınca "Bu talep başkasına atandı"
onayı çıkar: "Bu talep <ad> adlı teknisyene atandı. Yine de kabul etmek istiyor musunuz?" **Yine de kabul et** ile devam
edin, **Vazgeç** ile geri dönün.

### Kabul etmeden önce müşteriye nasıl mesaj yazarım? ("Mesajlar" paneli)

Talebi kabul etmeden önce müşteriye kısa bir not yazabilirsiniz (ör. "Birkaç dakika içinde bağlanacağım").

> **Müşteri tarafı:** müşteri mesajları web talep formunun bekleme sayfasında ya da Hızlı Destek **0.12** ve sonrasının
> bekleme penceresinde görür ve yanıtlar. Hızlı Destek 0.11 ve öncesi mesajlaşmayı desteklemez; bu durumda panel bunu söyler
> ve gönderim kapalı olur. Müşteriye telefonla ulaşın.

**Kim okur, kim yazar?**

- "Destek talepleri → Görüntüle" yetkisi olan herkes yazışmayı okur.
- Yazmak için ayrıca "Destek talepleri → Mesaj yaz" yetkisi gerekir. Yetkiniz yoksa panelde "Müşteriye mesaj yazma
  yetkiniz yok; yazışmayı yalnız görüntüleyebilirsiniz." yazar.

**Adımlar**

1. Talep kartında **Mesajlar**'a basın. Masaüstünde sağda panel, dar ekranda pencere açılır. Müşteriden okunmamış mesaj
   varsa düğmede sayı görünür (sayı yalnız bu tarayıcıda tutulur, sayfa yenilenince sıfırlanır).
2. Mesajınızı yazın. **Enter** gönderir, **Shift+Enter** yeni satır ekler.
3. Gönderdiğiniz mesaj önce "gönderiliyor…" olarak görünür, sunucu kaydedince onaylanır.

**Sınırlar**

- Mesaj en çok 1.000 karakter ve 20 satır. Görünmez/yön değiştiren özel karakterler kabul edilmez.
- Aynı talepte saniyede en çok 1 mesaj: hızlı gönderirseniz "Çok hızlı: mesaj gönderilmedi. Bir saniye bekleyip yeniden
  deneyin." yazar, metniniz kutuda kalır.
- Bir talepte kişi başına en çok 200 mesaj.
- Mesajlar yalnız talep beklerken yazılır. Talep kabul edilir, reddedilir ya da kapanırsa panel "Talep kapandı. Yazışma salt
  okunur; yeni mesaj gönderilemez." bandını gösterir. Kapanmış talebin yazışması bu sürümde görüntülenmez.
- **Sohbete şifre yazmayın.** Mesajlar sunucuda şifreli saklanır, ama talep kaydıyla birlikte saklama süresi boyunca durur.

**Panelde görebileceğiniz durumlar**

| Ekranda                                                                                          | Anlamı / ne yapmalı                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Henüz mesaj yok                                                                                  | Yazışma boş; ilk mesajı siz yazabilirsiniz                    |
| Müşteri şu an bağlı değil. Yazdığınız mesaj saklanır ve müşteri yeniden bağlanınca iletilir.     | Müşterinin programı kapalı ya da bağlantısı koptu             |
| Müşterinin programı mesajlaşmayı desteklemiyor; güncellemesi gerekir. Telefonla ulaşabilirsiniz. | Müşterinin Hızlı Destek sürümü eski; **Gönder** pasiftir      |
| Mesaj okunamadı                                                                                  | Mesaj teknik nedenle çözülemedi; sistem yöneticinize bildirin |
| Yazışma yüklenemedi.                                                                             | Bağlantınızı kontrol edip **Tekrar dene**'ye basın            |

Mesaj içeriği bildirimlere, WhatsApp/e-posta uyarılarına ve denetim kaydına yazılmaz; denetim kaydında yalnız mesajın
gönderildiği ve uzunluğu görünür.

### Mesai dışında gelen talepler

Firmanız mesai saatlerini açtıysa (bkz. "Admin için: Ayarlar > Mesai saatleri ve Tatiller"):

- Mod **Talebi al** ise mesai dışında gelen talep kuyruğa düşer ve "Mesai dışı" rozetini taşır; SLA süresi ilk açılış
  saatinde başlar.
- Mod **Reddet ve sonraki açılışı göster** ise talep açılmaz; müşteri "Mesai dışındayız. Sonraki açılış: <tarih saat>"
  mesajını görür. Eski Hızlı Destek sürümleri de aynı mesajı gösterir.

### İstenmeyen talepleri nasıl engellerim? ("Bu kaynağı engelle")

Aynı yerden tekrar tekrar sahte veya rahatsız edici talep geliyorsa kaynağı engelleyebilirsiniz. Bunun için
"Destek talepleri → Engelle" yetkiniz olmalıdır.

1. Talep kartının sağ üstündeki menüyü (üç nokta) açın, **Bu kaynağı engelle**'yi seçin. Seçenek hem **Bekleyenler**
   hem **Geçmiş** sekmesindeki kartlarda vardır.
2. **Neyi engelleyelim?** sorusunu yanıtlayın:
   - **IP adresi:** talebin geldiği internet adresi. Aynı ağdaki (ör. aynı ofis) başka bilgisayarlar da engellenebilir.
   - **Bu bilgisayar:** yalnız talebi gönderen bilgisayar; adresi değişse de engelli kalır.
3. **Süre** seçin (1 saat, 1 gün, 7 gün, 30 gün veya Süresiz). Süre dolunca engel kendiliğinden kalkar.
4. İsterseniz **Not** yazın (neden engellediğinizi hatırlamak için, en çok 200 karakter).
5. **Engelle**'ye basın. "Kaynak engellendi" mesajı çıkar.

Bekleyen bu talep engelden etkilenmez; isterseniz ayrıca reddedin. Engellenen kaynaktan gelen yeni talepler kuyruğa
düşmez; gönderen "Şu an çok yoğunuz, lütfen firmanızı telefonla arayın." mesajını görür. Engelleri görmek ve kaldırmak
için bkz. "Engellenenler".

| Mesaj                                                    | Anlamı                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Bu kaynak zaten engelli.                                 | Bu IP veya bilgisayar için etkin bir engel zaten var                                              |
| Bu talebin kaynak bilgisi yok (anonimleştirilmiş veya …) | Talebin adresi saklama süresi dolduğu için silinmiş ya da programı bilgisayar bilgisi göndermemiş |
| Firma başına en çok 1000 engel eklenebilir…              | Engellenenler ekranından eski engelleri kaldırın                                                  |

### Engellenenler ekranı

Kenar menüsündeki **Engellenenler** (kalkan simgesi) firmanızın tüm talep engellerini gösterir. Menüde görünmüyorsa
"Destek talepleri → Engelle" yetkiniz yoktur. Super Admin önce üst menüden bir firma seçmelidir.

- **Etkin** sekmesi süresi dolmamış engelleri, **Süresi dolanlar dahil** sekmesi hepsini listeler. Süresi dolan engeller
  30 gün sonra kendiliğinden silinir.
- Her satırda engelin türü (**IP engeli** veya **Bilgisayar engeli**), adres ya da bilgisayarın kısa kimliği, bitiş
  zamanı, not, kimin ne zaman eklediği görünür.
- Sayfanın üstünde "x / 1000 engel" yazar. Sınır dolunca **Engel ekle** pasif olur; önce eski engelleri kaldırın.

**Elle IP veya ağ engeli eklemek:**

1. **Engel ekle**'ye basın.
2. **IP adresi veya ağ** alanına tek adres (`203.0.113.7`) ya da ağ (`203.0.113.0/24`) yazın. IPv4 için en geniş /24,
   IPv6 için en geniş /48 girilebilir.
3. Süre ve isteğe bağlı not seçip **Engelle**'ye basın.

Bilgisayar engeli elle eklenemez; Talepler ekranında ilgili talebin menüsünden **Bu kaynağı engelle → Bu bilgisayar**
seçilir.

**Engeli kaldırmak:** satırdaki **Kaldır**'a basın ve onaylayın. O kaynaktan gelen talepler yeniden kuyruğa düşer.
"Bu engel zaten kaldırılmış" yazarsa başka biri sizden önce kaldırmıştır; liste yenilenir.

Engel ekleme ve kaldırma denetim kaydına yazılır (not metni yazılmaz).

### Web formundan gelen talepler ("Web" rozeti)

Firmanız web talep formunu açtıysa müşteriler program indirmeden tarayıcıdan da talep gönderir. Bu talepler kartta
**Web** rozetiyle görünür. Kuyrukta ve Geçmiş sekmesinde **Talep kaynağı** süzgeciyle (Tüm kaynaklar / İstemci / Web)
ayırabilirsiniz.

- Kabul, ret, atama, öncelik, SLA ve **Mesajlar** paneli diğer taleplerle aynıdır. Web talebinde müşteri mesajlaşmayı her
  zaman destekler.
- Kabul kodu ayarı açıksa web talebinde de çalışır; müşteri kodu kendi sayfasında görür.
- Müşteri tarayıcıdan paylaştığı için **uzaktan kontrol yoktur**, yalnız görüntü gelir. Kontrol gerekiyorsa müşteriden
  sayfadaki bağlantıyla Windows programını indirip yeni talep açmasını isteyin.
- Müşteri sekmeyi kapatırsa talep kısa süre sonra kendiliğinden iptal olur.
- Telefon doğrulaması (kayıtlı numaradan arayıp talep kodunu sorma) web talebinde de atlanmaz: formu herkes doldurabilir.

### Geçmiş sekmesi

**Geçmiş** sekmesi son 30 günde kapanan talepleri gösterir: kabul edilen, reddedilen, iptal olan, süresi dolan,
bağlanamayan. Üstteki durum filtresiyle daraltın. Kabul edilmiş talepte **Oturum ayrıntısını aç** ile oturum
geçmişine geçersiniz. **Oturum geçmişi** ekranında **Kaynak** filtresiyle (Talep / Teknisyen) yalnız talepten doğan
oturumları listeleyebilir, ayrıntıda "Destek talebi" bölümünde talep zamanı, kabul zamanı ve bekleme süresini görürsünüz.

---

## Admin ve teknisyen için: Müşteriler

**Müşteriler** ekranı, destek verdiğiniz firmaları (müşteri firmaları) tutar. Her müşterinin kendine ait, kalıcı bir
indirme bağlantısı vardır. Müşteri bu bağlantıdan indirdiği dosyayı saklar ve her destek gerektiğinde açar; talep
**Talepler** ekranına o müşterinin adıyla düşer.

**Kim ne yapabilir?** Kenar menüsünde **Müşteriler** (bina simgesi) görünmüyorsa "Müşteriler → Görüntüle" yetkiniz
yoktur. Ekleme için "Ekle", düzenleme / bağlantı yenileme / yeniden aktif etme / kayıt iptali için "Düzenle", pasife alma
için "Sil" yetkisi gerekir. CSV indirmek için "Dışa aktar", CSV'den eklemek için "İçe aktar" + "Ekle" + "Görüntüle"
yetkisi gerekir. Admin'de hepsi varsayılan açık, teknisyende (User) kapalıdır; yöneticiniz açar.
Super Admin müşterileri bir firma seçtikten sonra görür.

### Nasıl müşteri eklerim?

1. Kenar menüsünden **Müşteriler**'i açın, **Yeni müşteri**'ye tıklayın.
2. Formu doldurun:
   - **Firma adı** (zorunlu): 2–100 karakter. Aynı adla ikinci müşteri eklenemez ("Bu adla bir müşteri zaten var";
     büyük/küçük harf ve Türkçe karakter farkı sayılmaz).
   - **Dosya etiketi:** dosya adında görünen kısa ad (`NoktaDestek-<etiket>-….exe`). Adı yazarken kendiliğinden
     önerilir; yalnız harf ve rakam, en çok 20 karakter.
   - **Yetkili kişi, Telefon, E-posta, Not** (isteğe bağlı): kişisel veridir. Not düz metindir.
   - **Varsayılan öncelik** (isteğe bağlı): bu müşteriden gelen taleplerin önceliği. **Firma varsayılanı** seçiliyse
     Ayarlar > Destek talepleri'ndeki değer uygulanır.
   - **SLA hedefi (dakika)** (isteğe bağlı): 5–1440 dakika. Boş bırakılırsa firma varsayılanı uygulanır. Örneğin
     sözleşmeli bir müşteri için 30 dakika girebilirsiniz. Değişiklik yalnız yeni taleplere uygulanır.
3. **Müşteriyi ekle**'ye tıklayın. Müşterinin detay sayfası açılır ve "<ad> eklendi" bildirimi çıkar.

### Bağlantıyı müşteriye nasıl gönderirim?

1. Müşterinin detay sayfasında **Müşteriye gönder**'e basın ve e-posta ya da WhatsApp ile gönderin. Ayrıntı:
   "Teknisyen ve Admin için: Müşteriye gönder" bölümü.
   Ya da listede müşterinin satırındaki (veya detay sayfasındaki) **Kopyala**'ya tıklayın. 2 saniye "Kopyalandı" yazar.
   Tarayıcı panoya izin vermezse bağlantı seçili hâlde gösterilir; Ctrl+C ile kopyalayıp kendiniz iletin.
2. Müşteri bağlantıyı açar.
3. Windows müşterisi dosyayı bir kez indirip masaüstüne kaydetsin. Destek gerektiğinde dosyayı açıp **Destek iste**'ye
   bassın. **Mac müşterisi** dosyayı saklamaz: her destek isteğinde bağlantıdan yeniden indirir, zip'i açar ve klasördeki
   uygulamayı açar (bkz. "Mac'te nasıl destek isterim?").
4. Windows "Bilgisayarınız korundu" uyarısı gösterirse müşteri **Ek bilgi** → **Yine de çalıştır**'a basmalıdır. Mac'te
   müşteri ilk açılışta **Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç** ile onaylar.

Bağlantı alanının altında "Bu bağlantı Mac'te macOS uygulamasını (.zip) indirir." notu bulunur. Aynı bağlantı Windows'ta
`.exe`, Mac'te `.zip` indirir; müşteriye ayrı bağlantı göndermeniz gerekmez.

Aynı adımlar ekrandaki **Müşteriye nasıl gönderilir?** düğmesinde de yazar. Tek seferlik destek için müşteri kaydı
gerekmez: **Oturumlar > Yeni Destek Oturumu** ile link veya kod gönderin.

Listenin üstündeki **Genel bağlantı** şeridi müşteri firmaya atanmamış talepler içindir; bu dosyadan gelen talepler
"Genel" görünür. Genel bağlantı burada yalnız kopyalanır; yenilemesi **Ayarlar > Destek talepleri**'ndedir.

### Listede arama ve filtre

- **Ara:** ad, yetkili kişi veya telefon içinde arar. En az 2 karakter yazın; büyük/küçük harf ve Türkçe karakter
  fark etmez.
- **Durum filtresi:** Aktif (varsayılan) / Pasif / Tümü.
- Sütunlar: Ad, İndirme bağlantısı, Oluşturulma, Son talep, Talep (toplam talep sayısı), Durum. Liste 50'şerli sayfalanır.
- Pasif müşteride bağlantı yerine "Pasif — bağlantı geçersiz" yazar.

### Müşteri detayında neler var?

Müşterinin adına tıklayın. Sayfada:

- **Bilgiler:** etiket, yetkili kişi, telefon, e-posta, not, oturum sayısı. Saklama süresi dolduğu için silinen bilgiler
  "Anonimleştirildi" olarak görünür.
- **İndirme bağlantısı:** Kopyala ve **Bağlantıyı yenile**.
- **Durum:** **Pasife al** veya **Yeniden aktif et**; **Düzenle**.
- **Talepler** sekmesi: bu müşteriden gelen talepler (durum, zaman, ad, bekleme). "Destek talepleri" yetkisi gerekir.
- **Oturumlar** sekmesi: bu müşteriyle yapılan oturumlar (teknisyen, başlangıç, süre, kaynak); satıra tıklayınca oturum
  ayrıntısı açılır. "Oturum geçmişi" yetkisi gerekir; teknisyen yalnız kendi oturumlarını görür.
  Yetkiniz olmayan sekmede "Bu sekmeyi görme yetkiniz yok" yazar. Kayıtlar alınamazsa **Tekrar dene** çıkar.

### Bağlantıyı ne zaman yenilerim?

Bağlantı istemediğiniz yerlere yayıldıysa veya bu müşteri adına tanımadığınız talepler geliyorsa:

1. Detay sayfasında **Bağlantıyı yenile**'ye tıklayın.
2. Uyarıyı okuyun: "Bu müşteriye daha önce gönderilen tüm dosyalar ve bu müşteri için hatırlanan bilgisayarlar
   çalışmayı durduracak…" Odak **Vazgeç**'tedir; emin olunca **Yenile**'ye basın.
3. Yeni bağlantıyı kopyalayıp müşteriye gönderin. Bekleyen talepler etkilenmez.

### Müşteriyi pasife alma ve yeniden aktif etme

- **Pasife al:** müşteri silinmez, geçmişi korunur. Bağlantısı, dosyaları ve hatırlanan bilgisayarları çalışmaz,
  bekleyen talepleri iptal edilir ve yeni oturumda seçilemez. Onay diyaloğunda **Pasife al**'a basın.
- **Yeniden aktif et:** yeni bir bağlantı üretilir; eski dosyalar ve kayıtlar geçersiz kalır. Yeni bağlantıyı müşteriye
  gönderin.
- Pasif müşterinin yetkili kişi, telefon, e-posta ve notu firmanızın saklama süresi sonunda kendiliğinden silinir.
  Hemen silmek için **Düzenle**'de alanları boşaltıp kaydedin.

### Talepte "Kayıtlı bilgisayar" rozeti ve kayıt iptali

Müşteri bir kez başarılı oturum yaptıktan sonra bilgisayarı hatırlanır (Hızlı Destek 0.10.0+); sonraki talepleri bu
kayıtla gelir. Talep kartında:

| Kartta görünen                                 | Anlamı                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Müşteri firma: <ad>** veya **Genel**         | Talebin geldiği müşteri; müşterisiz dosyadan geldiyse "Genel"                                                                                          |
| **Kayıtlı bilgisayar — <firma \| Genel>**      | Talep, daha önce destek almış ve kaydı geçerli bir bilgisayardan geldi. Bu bir kimlik doğrulaması **değildir**; talep kodunu yine telefonla doğrulayın |
| **Kaydı iptal edilmiş bilgisayar**             | Talep bir kayıtla açılmış ama kayıt artık geçersiz                                                                                                     |
| **Bu talep bağlantı yenilenmeden önce açıldı** | Talep eski bağlantı/kayıtla açıldı; kabul edebilirsiniz ama bilgisayar yeniden kaydedilmez                                                             |

**Birden çok firmaya kayıtlı bilgisayarlar (Hızlı Destek 0.12):** bir müşteri bilgisayarı aynı sunucuda en çok 5 firmaya
kayıtlı olabilir. Panelde yalnız **kendi firmanızın** kaydını görürsünüz; bilgisayarın başka firmalara da kayıtlı olduğu
size görünmez. Sizin firmanızdaki oturumlar ve iptaller yalnız sizin kaydınızı etkiler; başka firmanın kaydı yenilenmez ya da
iptal edilmez. Müşteri programdan "Bu firmayı unut" derse yalnız o firmanın kaydı iptal olur.

**Tek bir bilgisayarın kaydını iptal etmek** (ör. aynı bilgisayardan istenmeyen talepler geliyorsa):

1. Talep kartında **Diğer** (⋯) menüsünü açın, **Bu bilgisayarın kaydını iptal et**'e tıklayın. Menü öğesi
   "Destek talepleri → Görüntüle" ve "Müşteriler → Düzenle" yetkisi ister ve yalnız kaydı geçerli taleplerde görünür.
2. "Bilgisayar kaydı iptal edilsin mi?" diyaloğunda **Kaydı iptal et**'e basın.
3. "Bilgisayar kaydı iptal edildi." yazar. O bilgisayarın bekleyen talebi iptal edilir; müşterinin diğer bilgisayarları
   ve dosyası etkilenmez. "Bu bilgisayarın kaydı zaten geçersiz." mesajı zararsızdır.

### Talepleri ve oturumları müşteriye göre süzme

- **Talepler:** kuyrukta ve Geçmiş sekmesinde **Müşteri firma** filtresi: Tümü / Genel / **Müşteri seç…** (adını yazıp
  listeden seçin).
- **Oturum geçmişi:** "Müşteri firma" sütunu ve **Kayıtlı müşteri** filtresi (müşteri seçimi veya "Müşterisiz"). CSV
  dosyasında da "Müşteri firma" sütunu bulunur.
- Yeni talep bildirimi firmayı da yazar: "Yeni destek talebi: <ad> — <firma | Genel>".

### Oturum açarken müşteri seçme

**Oturumlar > Yeni Destek Oturumu** penceresinde **Müşteri firma (isteğe bağlı)** alanına adın birkaç harfini yazıp
listeden seçin (yalnız aktif müşteriler). Boş bırakabilirsiniz. Müşteri seçerek açılan oturum başarılı olursa müşterinin
bilgisayarı o müşteri için kaydedilir; müşteri bir sonraki seferde doğrudan size talep gönderebilir. Alan görünmüyorsa
"Müşteriler → Görüntüle" yetkiniz yoktur.

### Web talep formu bağlantısı

Müşteri detay sayfasında **Web talep formu bağlantısı** ve **Kopyala** düğmesi bulunur. Bu bağlantıyı açan kişi program
indirmeden tarayıcıdan talep gönderir; talep bu müşterinin adıyla düşer. Bölüm yalnız firmanızda web talep formu açıkken
görünür ve müşteri aktif olmalıdır (bkz. "Admin için: Ayarlar > Destek talepleri").

Form bağlantısı ile indirme bağlantısı aynı müşteri anahtarını kullanır: **Bağlantıyı yenile** ikisini birlikte değiştirir.
Yenilemeden sonra eski form bağlantısı "Bağlantı geçersiz" gösterir; yeni bağlantıyı müşteriye yeniden gönderin.

### Müşterileri CSV olarak nasıl dışa aktarırım?

1. **Müşteriler** listesinde durum filtresini seçin (Aktif / Pasif / Tümü).
2. Başlıktaki **Dışa aktar**'a basın. `musteriler-YYYYAAGG.csv` dosyası iner; Excel'de doğrudan açılır.

Sütunlar: Ad, Yetkili kişi, Telefon, E-posta, Not, Dosya etiketi, Varsayılan öncelik, SLA (dk), Durum. En çok 50.000
müşteri dışa aktarılır; dakikada en çok 10 dışa aktarma yapılır. Dışa aktarma denetim kaydına yazılır.

### Müşterileri CSV'den nasıl içe aktarırım?

**İçe aktar** düğmesi yalnız Müşteriler modülünde **İçe aktar, Ekle ve Görüntüle** yetkilerinin üçü birlikte varsa
görünür. Mevcut müşterileri güncellemek için ayrıca **Düzenle** yetkisi gerekir.

1. **Müşteriler** → **İçe aktar**.
2. **Dosya** adımı: CSV dosyasını sürükleyin ya da tıklayıp seçin, **Önizle**'ye basın.
   - İlk satır sütun başlıkları olmalı; en az **Ad** sütunu gerekir. Diğer sütunlar dışa aktarmadaki adlarla aynıdır.
   - Ayraç noktalı virgül ya da virgül olabilir. Excel'de **CSV UTF-8** olarak kaydedin.
   - En çok 5.000 satır ve 2 MB.
3. **Önizleme** adımı: toplam satır, **Yeni**, **Zaten var** ve **Hatalı** sayıları ile ilk 50 satır görünür.
   - Hatalı satırlar içe aktarılmaz. **Hata raporunu indir** ile satır numarası ve nedenini içeren CSV'yi alın.
   - Aynı adla kayıtlı müşteriler için **Atla** (mevcut müşteriye dokunulmaz) ya da **Güncelle** (dosyadaki sütunlar
     mevcut müşteriye yazılır; bağlantı ve durum değişmez) seçin.
   - **İçe aktar**'a basın. Önizleme 15 dakika geçerlidir.
4. **Sonuç** adımı: Eklendi / Güncellendi / Atlandı / Başarısız sayıları.

Her yeni müşteriye kendi bağlantısı verilir. **Durum** sütunu dikkate alınmaz; yeni kayıtlar aktif başlar. Kullanıcı başına
saatte en çok 10 önizleme yapılır. Her eklenen/güncellenen müşteri ve özet denetim kaydına yazılır.

### Sık karşılaşılan mesajlar (Müşteriler)

| Mesaj                                                              | Ne yapmalı                                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Bu adla bir müşteri zaten var                                      | Farklı bir ad yazın veya Pasif filtresinde aynı adlı müşteriyi bulup yeniden aktif edin |
| Müşteri pasif; bağlantı yenilenemez.                               | Önce **Yeniden aktif et** (zaten yeni bağlantı üretir)                                  |
| Seçilen müşteri artık aktif değil…                                 | Yeni oturumda başka müşteri seçin veya alanı boşaltın                                   |
| Müşteri bulunamadı                                                 | Müşteri yok ya da görme yetkiniz yok; **Müşterilere dön**                               |
| Müşterileri görme yetkiniz yok…                                    | Yöneticinizden "Müşteriler" yetkisini isteyin                                           |
| Kayıtlar alınamadı.                                                | **Tekrar dene**'ye basın                                                                |
| Dosya UTF-8 değil. Excel'de 'CSV UTF-8' olarak kaydedin.           | Dosyayı Excel'de "CSV UTF-8" türüyle yeniden kaydedin                                   |
| “Ad” sütunu bulunamadı…                                            | İlk satıra sütun başlıklarını yazın; en az "Ad" olmalı                                  |
| En çok 5.000 satır / Dosya en çok 2 MB olabilir.                   | Dosyayı bölün ve parça parça içe aktarın                                                |
| Önizlemenin süresi doldu ya da geçersiz; dosyayı yeniden yükleyin. | 15 dakika geçti ya da yeni önizleme yapıldı; dosyayı yeniden yükleyin                   |
| Başka bir içe aktarma sürüyor                                      | Firmanızda başka bir içe aktarma bitene kadar bekleyin                                  |
| En çok 50.000 müşteri dışa aktarılabilir.                          | Durum filtresiyle daraltın                                                              |

---

## Admin için: Müşteri portal hesapları

Müşteri firmasının çalışanlarına **portal hesabı** açarsınız. Hesap sahibi portalda o müşterinin talep ve oturum
geçmişini görür, yeni talep açar ve firma dosyasını indirir (bkz. "Müşteri için: Müşteri portalı"). Portal kullanıcısı
panel kullanıcısı değildir: panele giremez, yetki tablosu yoktur ve yalnız kendi müşterisinin kayıtlarını görür.

**Kim yönetir?** "Müşteriler → Görüntüle" ve **"Müşteriler → Portal hesapları"** (`customers.portal`) yetkisi gerekir.
Admin'de varsayılan açık, teknisyende (User) kapalıdır; kullanıcı düzenleme ekranındaki yetki tablosundan açılır. Yetki
yoksa müşteri detayında bölüm hiç görünmez. Super Admin önce firmayı seçer.

### Portal hesapları bölümü nerede?

**Müşteriler** → müşterinin adı → detay sayfasındaki **Portal hesapları** bölümü (anahtar simgesi). Bölümde:

- **Portal adresi:** `https://<destek adresi>/portal/login?tenant=<firma kısa adı>`. Adres firmanıza özeldir, tüm
  müşterileriniz için aynıdır. **Portal adresini kopyala** ile alın.
- **Hesap oluştur** düğmesi.
- Hesap listesi: ad soyad, e-posta, durum (**Aktif** / **Pasif**), son giriş ("Hiç giriş yapmadı") ve rozetler:
  - **2FA açık:** kullanıcı iki adımlı doğrulamayı açmış.
  - **Şifre değişimi bekliyor:** kullanıcı geçici şifreyle henüz giriş yapıp şifresini değiştirmemiş.
  - **Geçici şifre süresi doldu:** geçici şifre 72 saat içinde kullanılmamış; **Şifreyi sıfırla** ile yenisini verin.
- Her satırın sonundaki **İşlemler** menüsü (üç nokta).

### Nasıl portal hesabı oluştururum?

1. Müşteri detayında **Portal hesapları** → **Hesap oluştur**'a basın.
2. **Ad soyad** (2–100 karakter) ve **E-posta** yazın. Pencerenin altındaki **Hesap oluştur**'a basın.
3. **Geçici şifre** penceresi açılır. Şifre **yalnız bu pencerede, bir kez** görünür; pencereyi kapatınca bir daha
   gösterilmez. Şifreyi kopyalayın.
4. Geçici şifreyi ve portal adresini müşteriye **güvenli bir kanaldan** iletin: örneğin şifreyi telefonla söyleyin,
   adresi e-postayla gönderin. İkisini aynı e-postaya yazmayın. Geçici şifre **72 saat** geçerlidir.
5. Kullanıcı ilk girişte şifresini değiştirir; o zamana kadar listede "Şifre değişimi bekliyor" yazar.

Kurallar:

- Bir müşteri için **en çok 20 portal hesabı** (aktif + pasif) açılabilir. Sınıra ulaşınca düğme kapanır ve "Bu müşteri
  için en çok 20 portal hesabı açılabilir." yazar.
- Pasif ya da anonimleştirilmiş müşteriye hesap açılamaz ("Müşteri pasif ya da anonimleştirilmiş; yeni portal hesabı
  açılamaz.").
- Aynı e-posta firmanızda ikinci kez kullanılamaz. Pasif hesap da adresi tutar; aynı kişi için yeni hesap yerine eski
  hesabı **Etkinleştir**in.
- E-posta sonradan değiştirilemez. Kişinin adresi değiştiyse eski hesabı pasife alın, yeni adresle yeni hesap açın.
- Firmanızda saatte en çok 30 portal hesabı açılabilir.

### Hesabı pasife alma ve etkinleştirme

**Pasife al:** **İşlemler** → **Pasife al** → onay penceresinde **Pasife al**. Hesabın açık portal oturumları hemen
kapanır ve kullanıcı giriş yapamaz. Hesap silinmez; daha sonra etkinleştirilebilir.

**Kişi kötü niyetliyse ya da işten ayrıldıysa müşterinin bağlantısını da yenileyin.** Portal hesabını kapatmak, kişinin
daha önce indirdiği firma dosyasını ve web formu bağlantısını geçersiz kılmaz; bunlar müşterinin bağlantı anahtarını
kullanır. Müşteri detayında **Bağlantıyı yenile**'ye basın (bkz. "Bağlantıyı ne zaman yenilerim?") ve yeni bağlantıyı
diğer çalışanlara gönderin. Portal hesapları bağlantı yenilemesinden etkilenmez; portal yeni dosyayı kendiliğinden verir.

**Etkinleştir:** **İşlemler** → **Etkinleştir**. Onay istenmez; kullanıcı mevcut şifresiyle yeniden giriş yapabilir.
Müşteri pasifse hesap etkinleştirilemez.

Müşteriyi pasife alırsanız ya da müşteri anonimleştirilirse o müşterinin portal hesapları giriş yapamaz. Pasif portal
hesapları, firmanızın kişisel veri saklama süresi dolunca kendiliğinden silinir (denetim kaydında "Portal hesabı silindi
(saklama süresi)").

### Şifreyi sıfırlama (unutulan şifre, kaybolan telefon, kilitlenen hesap)

1. **İşlemler** → **Şifreyi sıfırla**.
2. Onay penceresini okuyun: yeni bir geçici şifre üretilir, **iki adımlı doğrulama kapatılır** ve hesabın **açık portal
   oturumları kapanır**. **Sıfırla**'ya basın.
3. Yeni geçici şifre bir kez gösterilir. Müşteriye güvenli bir kanaldan iletin; 72 saat geçerlidir ve ilk girişte
   değiştirilir.

Pasif hesabın şifresi sıfırlanamaz ("Pasif hesabın şifresi sıfırlanamaz; önce etkinleştirin.").

Sıfırlama şu durumlarda kullanılır: kullanıcı şifresini unuttu (portalda "Şifremi unuttum" yoktur), 2FA telefonunu
kaybetti (portalda kurtarma kodu yoktur), geçici şifrenin süresi doldu ya da çok sayıda hatalı denemeden sonra hesap
kilitlendi ve beklemek istemiyor.

### Portal talepleri ve sınırlar

- Portaldan açılan talep **Talepler** kuyruğuna o müşterinin adıyla, **Web** kaynağıyla düşer; kabul, ret, mesajlaşma ve
  bildirim web talep formuyla aynıdır. Talebin oluşturma denetim kaydı, talebin portaldan hangi hesapla açıldığını da tutar.
- Firmanızın web talep formu kapalı olsa da portal kullanıcıları talep açabilir. Mesai saatleri ve tatiller uygulanır.
- Bir müşterinin tüm portal hesaplarından toplam **saatte en çok 10 talep** açılabilir.
- Bir müşterinin aynı anda en çok **3 bekleyen talebi** olabilir (kaynak fark etmez); fazlası "Şu an çok yoğunuz…"
  mesajıyla reddedilir.
- Giriş koruması: aynı e-posta ve ağdan 15 dakikada 5 hatalı denemede, hesapta 1 saatte 20 hatalı denemede giriş 15 dakika
  kilitlenir. Portal denemeleri panel hesaplarını kilitlemez.

Bir portal hesabıyla kuyruğun sürekli doldurulduğunu görürseniz hesabı **pasife alın** (oturumlar hemen kapanır) ve
gerekirse müşterinin bağlantısını yenileyin.

### Denetim kayıtları (portal)

**Audit log** ekranında "Müşteri portalı" grubunda şu işlemler görünür: Portal girişi (başarılı / başarısız), Portal
hesabı kilitlendi, Portal çıkışı, Portal şifresi değiştirildi, Portal 2FA etkinleştirildi / kapatıldı, Portal hesabı
oluşturuldu / pasife alındı / yeniden etkinleştirildi, Portal hesabı şifresi sıfırlandı, Portal hesabı silindi (saklama
süresi). Geçici şifreler ve doğrulama kodları kayda yazılmaz.

### Sık karşılaşılan mesajlar (Portal hesapları)

| Mesaj                                                               | Ne yapmalı                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Bu e-posta adresiyle portal hesabı açılamaz.                        | Adres firmanızda başka bir portal hesabında (pasif olabilir) kayıtlı. Pasifse etkinleştirin       |
| Bu müşteri için en çok 20 portal hesabı açılabilir.                 | Kullanılmayan bir hesabı pasife almak sayıyı düşürmez; pasif hesap saklama süresi sonunda silinir |
| Müşteri pasif ya da anonimleştirilmiş; yeni portal hesabı açılamaz. | Önce müşteriyi **Yeniden aktif et**                                                               |
| Pasif hesabın şifresi sıfırlanamaz; önce etkinleştirin.             | **Etkinleştir**, sonra **Şifreyi sıfırla**                                                        |
| İşlem yapılamadı; liste yenilendi.                                  | Başka biri aynı anda değiştirmiş olabilir; listeye bakıp yeniden deneyin                          |
| Müşteri "Geçici şifrenin süresi doldu" diyor                        | Listede "Geçici şifre süresi doldu" rozeti vardır; **Şifreyi sıfırla**                            |
| Müşteri "bağlantıyı isteyin" yazısı görüyor                         | Adreste `?tenant=…` eksik; **Portal adresini kopyala** ile tam adresi gönderin                    |

---

## Admin için: Kullanıcılar ve yetkiler

Menüde **Kullanıcılar** (kişi simgesi) yalnız "Kullanıcılar → Görüntüle" yetkisi olanlara görünür. Burada firmanızdaki
teknisyenleri ve yöneticileri eklersiniz, rollerini ve yetkilerini düzenlersiniz.

**Roller**

| Rol                   | Başlangıç yetkileri                                                        |
| --------------------- | -------------------------------------------------------------------------- |
| Teknisyen (kullanıcı) | Tüm yetkiler **kapalı** başlar; ihtiyaç duyduklarını siz açarsınız         |
| Yönetici (admin)      | Tüm yetkiler **açık** başlar (sizde olmayanlar hariç)                      |
| Süper Yönetici        | Tüm yetkilere rolüyle sahiptir; bu listede görünmez, buradan değiştirilmez |

### Kullanıcı listesi

- Arama kutusuna ad soyadın veya e-postanın bir kısmını yazın (en az 2 karakter).
- **Rol** (Tüm roller / Yönetici / Teknisyen) ve **Durum** (Aktif / Pasif / Tümü) filtreleri adres satırında saklanır;
  sayfayı yenileseniz de kalır.
- Kendi satırınızda "(siz)" yazar. "Son giriş" boşsa "Henüz giriş yapmadı" görünür; eski oturum kayıtları zamanla silindiği
  için bu her zaman "hiç girmedi" anlamına gelmez.

### Nasıl kullanıcı eklerim?

1. **Yeni kullanıcı**'ya tıklayın.
2. **Ad soyad**, **E-posta** ve **Rol** girin. E-posta tüm sistemde tekildir; kullanılıyorsa "Bu e-posta ile bir kullanıcı
   zaten var" yazar.
3. **Kullanıcıyı oluştur**'a tıklayın. Ekranda 16 karakterlik **geçici şifre** görünür.
4. **Şifreyi kopyala** ile alın ve kullanıcıya yüz yüze veya telefonla iletin; e-postayla aynı mesajda göndermeyin.
   **Bu şifre yalnız şimdi gösterilir**; kapattıktan sonra kimse tekrar göremez. Kopyalamadan kapatmaya çalışırsanız
   uyarı çıkar (**Şifreye dön** / **Yine de kapat**).
5. Kullanıcı ilk girişte kendi şifresini belirler. Teknisyen eklediyseniz **Yetkileri düzenle** ile ihtiyaç duyduğu
   yetkileri açın; aksi hâlde menüde yalnız Ana sayfa görür.

Şifresini unutan kullanıcı giriş ekranındaki **Şifremi unuttum** ile kendisi sıfırlar (firmanın SMTP ayarı gerekir;
bkz. "Herkes için: Giriş ve hesap güvenliği"). 2FA sorunu için bkz. "Admin için: Kullanıcının 2FA'sını sıfırlama".

### Yetkileri nasıl açar/kapatırım?

1. Listeden kullanıcıya tıklayın. Sağda **Yetkiler** tablosu açılır: her satır bir modül (Oturumlar, Uzaktan kontrol,
   Dosya transferi, Oturum geçmişi, Destek talepleri, Müşteriler, Kullanıcılar, Ayarlar, Audit log), sütunlar alt
   yetkiler (Görüntüle, Ekle, Düzenle, Sil, Dışa aktar; "Diğer" sütununda Zorla sonlandır, Kullan, Kabul / ret,
   Pano paylaşımı, Uzaktan yazdır; Müşteriler satırında Portal hesapları).
2. Anahtarları açıp kapatın. **Tümü** sütunundaki anahtar o modülün tüm alt yetkilerini birlikte açar veya kapatır;
   bir kısmı açıksa yarım görünür. Anlamı adından anlaşılmayan yetkilerin açıklaması ekrandaki "Yetki
   açıklamaları" bölümündedir. "Uygulanmaz" yazan hücrede o modülün böyle bir yetkisi yoktur.
3. Altta "Kaydedilmemiş değişiklikler" çubuğu çıkar. **Kaydet** ile kaydedin, **Vazgeç** ile geri alın. Kaydetmeden
   sayfadan çıkmaya çalışırsanız uyarı alırsınız.
4. Kaydedince yeni yetkiler kullanıcının **açık destek oturumlarına hemen** uygulanır; kaldırılan yetkiye bağlı işlem
   (ör. uzaktan kontrol) kapanır. Her değişiklik denetim kaydına "kim, kime, hangi yetki, eski → yeni" olarak yazılır.

Not: "Kullanıcılar → Sil" anahtarı **pasif kullanıcıyı kalıcı silme** içindir ("Pasif kullanıcıyı kalıcı siler (geri
alınamaz)"); bkz. "Kullanıcıyı kalıcı silme". Yönetici rolünde varsayılan açık, teknisyende kapalıdır. Bu sürümle
birlikte bütün kullanıcılarda bu anahtar rol varsayılanına döndürüldü; daha önce bir teknisyene elle açılmışsa yeniden
açılması gerekir. Pasife alma "Düzenle" yetkisiyle yapılır. "Destek talepleri → Engelle" anahtarı talep engellerini
(Engellenenler ekranı ve "Bu kaynağı engelle") açar. **"Destek talepleri → Ata / öncelik"** talebi teknisyene atamayı,
atamayı kaldırmayı ve önceliği değiştirmeyi; **"Destek talepleri → Mesaj yaz"** bekleyen talepte müşteriye mesaj yazmayı
açar. İkisi de Admin'de açık, teknisyende kapalı başlar. Bir teknisyene talep atanabilmesi için onda "Görüntüle" ve "Kabul
et" açık olmalıdır; bunlardan biri kapatılırsa üzerindeki atamalar kalkar.

### Kilitli yetkiler

- Sizde olmayan bir yetki tabloda **kilit simgesiyle** ve soluk görünür. Bunu başkasına veremez, açık olanı da
  kapatamazsınız. "Tümü" anahtarı kilitli yetkilere dokunmaz.
- Denerseniz (ör. başka sekmede sizin yetkiniz azaldıysa) "… yetkisine sizin sahip olmadığınız için bu yetkiyi
  veremezsiniz" yazar; diğer değişiklikleriniz formda kalır.
- Sizden **daha geniş yetkili** bir hesabı (sizde olmayan bir yetkisi açık olanı) düzenleyemez ve pasife alamazsınız;
  ekran salt okunur açılır.
- **Kendi hesabınızda** rolünüzü ve yetkilerinizi değiştiremez, kendinizi pasife alamazsınız. Bunu başka bir yönetici
  veya Süper Yönetici yapar.

### Rolü değiştirmek

- Rol değişince kilitsiz yetkiler yeni rolün başlangıç değerine döner (Yönetici → hepsi açık, Teknisyen → hepsi kapalı);
  kilitli yetkiler olduğu gibi kalır. Kaydetmeden önce tabloyu kontrol edin.
- Rolü değiştirip kaydetmeden **eski role geri alırsanız** kullanıcının kayıtlı yetkileri tabloda olduğu gibi geri gelir;
  elle açıp kapattığınız ayarlar kaybolmaz.
- **Önemli:** Rol değişikliği kaydedilince kullanıcının **açık destek oturumları sonlanır**; müşteriyle bağlantısı kesilir.
  Teknisyeni Yönetici'ye yükseltmeden (veya geri almadan) önce açık oturumu olmadığından emin olun.

### Pasife alma ve yeniden etkinleştirme

1. Kullanıcı detayında **Kullanıcıyı pasife al**'a tıklayın. Onay penceresinde odak güvenli seçenek olan **Vazgeç**'tedir.
2. **Pasife al** ile onaylayın. Kullanıcı **hemen tüm cihazlarda** oturumdan çıkar, giriş yapamaz, açık destek oturumları
   sonlanır.
3. Pasif kullanıcıyı listede **Durum: Pasif** filtresiyle bulursunuz. **Yeniden etkinleştir** ile geri açarsınız; rolü ve
   yetkileri önceki gibi kalır.

### Kullanıcıyı kalıcı silme

Ayrılan bir çalışanın kişisel bilgilerini sistemden tamamen çıkarmak için kullanılır. **Bu işlem geri alınamaz.**
Yalnız bir hesabı kapatmak istiyorsanız pasife almanız yeterlidir.

**Kim yapabilir?** "Kullanıcılar → Sil" yetkisi olan yönetici, kendi firmasındaki ve yönetebildiği (kendisinden geniş
yetkili olmayan) kullanıcıyı siler. Kendi hesabınızı ve Super Admin hesaplarını bu yolla silemezsiniz. Yetkiniz yoksa
**Kalıcı sil** düğmesi hiç görünmez.

**Nasıl kalıcı silerim?**

1. Kullanıcıyı önce pasife alın (bkz. "Pasife alma ve yeniden etkinleştirme"). Aktif kullanıcıda **Kalıcı sil** düğmesi
   soluktur ve altında "Kalıcı silmek için önce kullanıcıyı pasife alın." yazar.
2. Kullanıcının açık bir destek oturumu varsa oturumun kapanmasını bekleyin.
3. Kullanıcı detayında **Kalıcı sil**'e (çöp kutusu simgesi) tıklayın.
4. Pencerede "Onaylamak için adı yazın: …" alanına kullanıcının **ad soyadını** birebir yazın (büyük/küçük harf dahil).
   Ad eşleşmezse istek gönderilmez, alanın altında hata yazar.
5. **Kalıcı sil**'e basın. "Kimliğinizi doğrulayın" penceresi açılırsa 2FA kodunuzu girin (bkz. "Kritik bir ayarı
   değiştirirken 'Kimliğinizi doğrulayın' penceresi").
6. "Kullanıcı kalıcı silindi" mesajını görür, kullanıcı listesine dönersiniz.

**Ne olur?**

- Kullanıcının adı, e-postası, kullanıcı adı, şifresi, 2FA bilgisi, profil resmi (dosyasıyla birlikte), yetkileri, açık
  giriş oturumları, kurtarma kodları ve şifre sıfırlama bağlantıları silinir. Hesapla bir daha giriş yapılamaz.
- Kullanıcı listesinde artık görünmez. Oturum geçmişinde ve audit log'da **"Silinmiş kullanıcı #XXXXXX"** olarak görünür
  (#'den sonra kaydın kısa kimliği); avatarın yerinde "#" vardır.
- Audit kayıtları **silinmez ve değiştirilmez**; 730 gün saklanır. Ancak bu kayıtlarda kişinin kimliği artık
  **maskelenmiş** gösterilir: e-posta `a***@***` gibi, kayıt içindeki ad/e-posta değerleri `***` olarak görünür. Açık hâli
  ne ekranda ne CSV'de döner. Kayıt 730 gün dolunca kendiliğinden silinir.
- İşlem audit log'a "Kullanıcı kalıcı silindi" (`user.deleted`) olarak yazılır; kayıtta kişisel bilgi bulunmaz.
- Silinen bilgiler sunucu yedeklerinden en geç 14 gün içinde düşer (bkz. "Kişisel verilerin saklama süresi ve
  anonimleştirme").

### "Kayıt başkası tarafından değiştirildi" uyarısı

Siz bir kullanıcıyı düzenlerken başka bir yönetici (veya kullanıcının kendisi, ör. 2FA kurarak) aynı kaydı değiştirmiş
olabilir. Bu durumda **Kaydet**'e bastığınızda değişiklikleriniz kaydedilmez; formun üstünde "Kayıt başkası tarafından
değiştirildi, yeniden yükleyin" uyarısı çıkar. Böylece diğer kişinin değişikliğini fark etmeden ezmezsiniz.

1. Uyarıdaki **Yeniden yükle**'ye basın. Kaydın güncel hâli gelir; formdaki kaydedilmemiş değişiklikleriniz atılır.
2. "Güncel kayıt yüklendi; değişikliklerinizi yeniden yapıp kaydedin" mesajını görünce yetkileri ve bilgileri kontrol
   edin, değişikliklerinizi yeniden yapın.
3. **Kaydet**'e basın.

### Kullanıcının profil resmi

Bir kullanıcının profil resmini onun yerine yükleyebilir, değiştirebilir veya kaldırabilirsiniz (ör. ekip fotoğrafları).

1. **Kullanıcılar** → kullanıcıya tıklayın.
2. Profil kartında **Resim yükle** / **Resmi değiştir** / **Resmi kaldır** düğmelerini kullanın. Kırpma ve onay adımları
   "Profil resmimi nasıl yüklerim?" bölümündekiyle aynıdır.

Düğmeler yalnız şu durumda görünür: "Kullanıcılar → Düzenle" yetkiniz var, kullanıcı sizinle aynı firmada ve sizden geniş
yetkili değil, hesap **aktif**. Aksi hâlde "Bu kullanıcının profil resmini değiştirme yetkiniz yok." yazar. Her değişiklik
audit log'a yazılır. Kullanıcı listesinde resmi olanların resmi, olmayanların baş harfleri görünür.

### Sık karşılaşılan mesajlar (Kullanıcılar)

| Mesaj                                                        | Ne yapmalı                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Kullanıcıları görüntüleme yetkiniz yok.                      | "Kullanıcılar → Görüntüle" yetkisini yöneticinizden isteyin.                                        |
| Bu e-posta ile bir kullanıcı zaten var                       | Başka bir e-posta girin (e-posta tüm firmalarda tekildir).                                          |
| Bu kullanıcıyı düzenleme yetkiniz yok; bilgiler salt okunur. | Kullanıcı sizden geniş yetkili veya sizde "Düzenle" yetkisi yok.                                    |
| Bu kullanıcı pasif; giriş yapamaz ve düzenlenemez.           | Önce **Yeniden etkinleştir**.                                                                       |
| Kullanıcı bulunamadı                                         | Kullanıcı başka firmaya ait veya adres yanlış; **Kullanıcılara dön**.                               |
| Değişiklikler kaydedilemedi                                  | İnternet bağlantınızı kontrol edip tekrar **Kaydet**'e basın; değerleriniz formda durur.            |
| Kayıt başkası tarafından değiştirildi, yeniden yükleyin      | **Yeniden yükle**'ye basın, değişikliklerinizi yeniden yapıp kaydedin.                              |
| Çok fazla istek…                                             | Dakikada en çok 30 kullanıcı değişikliği (yeni kullanıcı için 10) yapılabilir; bir dakika bekleyin. |
| Önce kullanıcıyı pasife alın                                 | Kalıcı silme yalnız pasif kullanıcıda yapılır; önce **Kullanıcıyı pasife al**.                      |
| Kullanıcının açık destek oturumu var; oturum kapanınca…      | Kullanıcının açık oturumu bitince yeniden deneyin.                                                  |
| Yazdığınız ad eşleşmiyor                                     | Ad soyadı ekrandaki gibi, büyük/küçük harf dahil birebir yazın.                                     |
| Kullanıcı bulunamadı ya da zaten silinmiş.                   | Kullanıcı başka bir yönetici tarafından silinmiş olabilir; listeye dönün.                           |

---

## Admin için: Uzaktan kontrol yetkisi ve kayıtlar

### Yetki

- Uzaktan kontrol **Uzaktan kontrol → Kullan** (`remote_control.use`) yetkisine bağlıdır. Yetkisi olmayan teknisyen
  konsolda kontrol düğmesini görmez; sunucu da isteği reddeder.
- Bu yetki **Kullanıcılar** ekranındaki yetki anahtarlarından açılıp kapatılır (bkz. "Admin için: Kullanıcılar ve
  yetkiler").
- **Yetki kaldırılınca:** teknisyenin bağlantısı her 60 saniyede bir yeniden denetlenir. Yetki kaldırıldıysa açık
  kontrol kapanır, müşteri tarafında "Uzaktan kontrol sunucu tarafından kapatıldı." yazar ve teknisyen yeni istek
  gönderemez. Hesap pasife alınır veya rolü değişirse teknisyenin tüm oturumları sonlanır. Oturum sırasında yetki
  **verilirse** bu yalnız yeni oturumlarda geçerli olur.

### Kayıtlar (audit)

Her uzaktan kontrol adımı denetim kaydına yazılır; klavye ve fare içeriği hiçbir yere yazılmaz. Kayıtları **Audit log**
ekranında "Uzaktan kontrol" ve "Monitör" işlem gruplarıyla süzebilirsiniz (bkz. "Admin için: Audit log").

| Kayıt                                                      | Ne zaman                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `control.requested`                                        | Teknisyen kontrol istedi ve istek müşteriye iletildi                                            |
| `control.granted`                                          | Müşteri izin verdi (istemcinin yönetici olarak çalışıp çalışmadığı da yazılır)                  |
| `control.denied`                                           | Müşteri reddetti                                                                                |
| `control.released`                                         | Teknisyen kontrolü bıraktı                                                                      |
| `control.cancelled`                                        | Teknisyen isteği geri çekti, ya da istek müşteri karar vermeden kapandı                         |
| `control.revoked`                                          | Kontrol kapandı: müşteri (düğme/kısayol), bağlantı kopması, yetki kaldırılması veya oturum sonu |
| `monitor.requested` / `monitor.granted` / `monitor.denied` | Monitör değiştirme isteği, onayı, reddi                                                         |
| `session.caps_changed`                                     | Teknisyenin oturumdaki yetkileri daraldı                                                        |

İzin, ret ve kapanışlar ayrıca KVKK onay kanıtı olarak saklanır. **İzin kaydı yazılamazsa kontrol hiç açılmaz**:
müşterinin onayı kaydedilmeden teknisyen bilgisayarı kullanamaz.

### Pano paylaşımı ve uzaktan yazdırma yetkisi

- **Uzaktan kontrol → Pano paylaşımı** (`remote_control.clipboard`): "Kontrol izni verilmiş oturumda, müşteri ayrıca izin
  verirse düz metin panosunu gönderir ve alır." Pratikte **Uzaktan kontrol → Kullan** yetkisi de gerekir, çünkü pano
  yalnız kontrol izniyle çalışır.
- **Dosya transferi → Uzaktan yazdır** (`file_transfer.print`): "Müşterinin onayıyla PDF belgeyi müşterinin varsayılan
  yazıcısına gönderir (yalnız Windows uygulaması)." **Dosya transferi → Kullan**'dan bağımsızdır; dosya gönderme yetkisi
  olmayan teknisyene yalnız yazdırma verilebilir.
- İkisi de Admin rolünde açık, teknisyende (User) kapalı başlar. Yetki kaldırılırsa açık oturumda hemen uygulanır;
  bekleyen pano/yazdırma işi iptal olur. Oturum sırasında **verilen** yetki yeni oturumda geçerli olur.
- İki özellik de yalnız Hızlı Destek 0.13 ve sonrasıyla bağlanan müşteride çalışır. Tarayıcı müşterisinde ve **gözetimsiz
  oturumlarda kullanılamaz** (müşteri onayı gerekir; yetki açık olsa da sunucu reddeder).

### Pano ve yazdırma kayıtları (audit)

Pano metni, belgenin içeriği ve dosya adı hiçbir kayda yazılmaz. Audit log ekranında "Pano paylaşımı" ve "Uzaktan
yazdırma" işlem gruplarıyla süzebilirsiniz; aynı olaylar oturum ayrıntısındaki zaman çizelgesinde de görünür.

| Kayıt                                   | Ne zaman                                                           | Yazılan bilgi                                     |
| --------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| `clipboard.consent` (Pano izni değişti) | Müşteri pano kutusunu açtı/kapattı veya kutu kendiliğinden kapandı | Açık/kapalı, kim (müşteri/sistem), kapanma nedeni |
| `clipboard.transfer` (Pano aktarımı)    | Her gönder/al işlemi                                               | Yön (müşteriye / müşteriden), bayt sayısı, sonuç  |
| `print.job` (Uzaktan yazdırma)          | Her yazdırma isteğinin sonucu                                      | Müşteri kararı, sayfa sayısı, boyut, sonuç        |

Yazdırma kaydı belgenin **hangi belge olduğunu kanıtlamaz**: dosya adı ve içerik özeti bilerek tutulmaz; yalnız karar,
sayfa, boyut ve sonuç vardır. Müşteri pano kutusunu çok sık açıp kapatırsa (dakikada 6'dan fazla) fazlası yok sayılır ve
kayda yazılmaz.

---

## Admin için: Oturum geçmişi

- Admin firmasındaki **tüm teknisyenlerin** oturumlarını görür; listede **Teknisyen** sütunu ve filtresi vardır.
  Teknisyen filtresinin seçenekleri şimdilik o sayfadaki kayıtlardan gelir.
- Yetkiler üç ayrı anahtardır: **Oturum geçmişi → Görüntüle** (`session_history.view`), **Düzenle** (ticket/not,
  `session_history.edit`), **Dışa aktar** (CSV, `session_history.export`). Admin'de varsayılan açık, User'da kapalıdır.
  Bu anahtarlar **Kullanıcılar** ekranındaki yetki tablosundan açılıp kapatılır.
- Güvenlik gereği bekleyen bir oturumun 8 haneli kodu yalnız oturumu açan teknisyene gösterilir.
- Kayıtlar: not/ticket değişikliği `session.updated` (not metni değil, yalnız uzunluğu), her dışa aktarma
  `session.exported` (filtreler ve satır sayısı; aranan müşteri adı değil) olarak denetim kaydına yazılır.
- Oturum kaydını izlemek için ayrıca **Oturumlar → Kayıtları izle**, silmek için **Oturum geçmişi → Düzenle** gerekir
  (bkz. "Oturum kaydı").

## Admin için: Ayarlar > Genel (oturum ve dosya sınırları)

**Ayarlar > Genel** sekmesi (kaydırıcı simgesi) firmanızdaki destek oturumlarının süre ve sayı sınırlarını ve dosya
aktarımı boyut sınırını belirler. Sekmeyi "Ayarlar → Görüntüle" yetkisi olan görür, "Ayarlar → Düzenle" yetkisi olan
değiştirir. Düzenleme yetkiniz yoksa alanlar soluk görünür ve değiştirilemez.

| Alan                                 | Aralık | Anlamı                                                                        |
| ------------------------------------ | ------ | ----------------------------------------------------------------------------- |
| Kod ve bağlantı geçerliliği (dakika) | 15–30  | Müşteri bu sürede bağlanmazsa 8 haneli kod ve oturum bağlantısı geçersiz olur |
| En uzun oturum süresi (saat)         | 1–8    | Bağlı bir oturum bu süreyi aşınca kendiliğinden biter                         |
| Teknisyen başına açık oturum sınırı  | 1–10   | Bir teknisyenin aynı anda bekleyen veya bağlı oturum sayısı                   |
| Dosya boyutu sınırı (MB)             | 1–2048 | Oturumda gönderilen ve alınan tek dosyanın en büyük boyutu                    |

Firmanızda sunucu üzerinden dosya aktarımı açıksa (bkz. "Ayarlar > Dosyalar") bu modda tek dosya en çok 256 MB olabilir;
girdiğiniz değer daha büyükse 256 MB uygulanır.

Nasıl değiştiririm?

1. **Ayarlar > Genel**'i açın.
2. Değeri değiştirin. Altta "Genel ayarlarda kaydedilmemiş değişiklik var" çubuğu çıkar.
3. **Kaydet**'e basın; "Genel ayarlar kaydedildi" yazar. Vazgeçmek için **Vazgeç**.

- Aralık dışındaki değerde kayıt yapılmaz; hatalı alanın altında neden yazar ve imleç o alana gider.
- Yeni değerler **yeni oturumlarda** geçerli olur; açık oturumlar eski sınırla sürer.
- Her değişiklik denetim kaydına eski → yeni değerle yazılır.
- Kaydetmeden sayfadan ayrılmaya çalışırsanız kaydedilmemiş değişiklik uyarısı çıkar.
- Ayarlar okunamazsa sayfada hata ve **Tekrar dene** düğmesi görünür.

## Admin için: Ayarlar > Dosyalar (sunucu üzerinden aktarım ve virüs tarama)

**Ayarlar > Dosyalar** sekmesi (kilitli klasör simgesi) dosyaların nasıl aktarılacağını belirler. Görmek için "Ayarlar →
Görüntüle", değiştirmek için "Ayarlar → Düzenle" yetkisi gerekir.

İki yol vardır:

| Yol                                   | Nasıl çalışır                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Doğrudan (anahtar kapalı, varsayılan) | Dosya teknisyen ile müşteri arasında uçtan uca şifreli gider; sunucuya uğramaz, taranmaz, saklanmaz                                     |
| Sunucu üzerinden (anahtar açık)       | Dosya ve yazdırma belgesi sunucuya şifreli yüklenir, virüs taramasından geçer, yalnız temizse teslim edilir; uçtan uca şifreli değildir |

### Nasıl açarım?

1. **Ayarlar > Dosyalar**'ı açın.
2. **Dosyaları sunucu üzerinden aktar ve virüs tara** anahtarını **Açık** yapın.
3. Altta çıkan **Aydınlatma metnimi bu değişikliği kapsayacak şekilde güncelledim** kutusunu işaretleyin. Bu modda müşteri
   dosyaları sunucuda geçici olarak saklandığı için önce **Ayarlar > Aydınlatma metni**'ni güncelleyin.
4. **Teslim edilen dosyaların saklanacağı gün** alanına 1–7 arası bir değer girin (varsayılan 1).
5. **Kaydet**'e basın; "Dosya ayarları kaydedildi" yazar.

- Anahtar soluksa ve altında "Sistem yöneticisi virüs tarama bağlantısını test etmedi" yazıyorsa Super Admin henüz virüs
  tarama bağlantısını başarıyla test etmemiştir. Super Admin'e başvurun.
- Ayar **yeni oturumlarda** geçerli olur; açık oturumlar başladıkları yolla sürer.
- Kapatırken onay kutusu istenmez. Kapattıktan sonra yeni oturumlar doğrudan yolu kullanır; saklanan dosyalar süreleri
  dolunca silinir.
- Her değişiklik denetim kaydına eski → yeni değerle yazılır.

### Saklama süresi neyi etkiler?

Yalnız müşteriye/teknisyene **teslim edilmiş** dosyalar saklanır. Reddedilen, iptal edilen, oturum sonunda teslim
edilmemiş dosyalar ve yazdırma belgeleri hemen silinir. Süre dolan dosyalar her gece 03:30'da silinir. Oturum
anonimleştirildiğinde ya da kalıcı silindiğinde de dosyaları silinir. Saklanan dosyalar yedeğe alınmaz.

### Depolama kullanımı

Sekmenin altında "Kullanım: x / y" çubuğu firmanızın kullandığı alanı ve kotasını gösterir. Kullanıma oturum kayıtları da
dahildir (bkz. "Oturum kaydı"). "Depolama kotası dolmak
üzere…" uyarısı çıkarsa kota dolduğunda yeni dosyalar kabul edilmez ("Firma depolama kotası doldu"). Kotayı yalnız Super
Admin artırır. Beklemeden yer açmak için saklama süresini 1 güne indirebilirsiniz; fazlası bir sonraki 03:30 turunda silinir.

### Sık karşılaşılan mesajlar (Dosyalar)

| Mesaj                                                      | Anlamı                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| Önce virüs tarama bağlantısını başarıyla test edin         | Super Admin'in son ClamAV testi başarılı değil; anahtar açılamaz |
| Açmadan önce aydınlatma metnini güncellediğinizi onaylayın | Onay kutusu işaretlenmeden açmaya çalıştınız                     |
| Kullanım bilgisi şu an alınamadı.                          | Kota bilgisi okunamadı; sayfayı yenileyin                        |

## Admin için: Ayarlar > Destek talepleri

Kenar menüsünde **Ayarlar** (yetki "Ayarlar → Düzenle") açılır. Bu ekran firmanızın destek talebi ayarlarını tutar.
Değişiklikler sayfanın altındaki **Kaydet** ile kaydedilir; kaydetmeden çıkmak isterseniz tarayıcı uyarır.

### Genel bağlantı nasıl paylaşılır?

Bu bağlantı müşteri firmaya atanmamış talepler içindir; bu dosyadan gelen talepler "Genel" görünür. Müşteriye özel
bağlantılar **Müşteriler** ekranındadır (bkz. "Admin ve teknisyen için: Müşteriler").

1. **Genel bağlantı** bölümünde bağlantı ve dosya adı (`NoktaDestek-<firma>-….exe`) görünür. Altında "Bu bağlantı Mac'te
   macOS uygulamasını (.zip) indirir." yazar: aynı bağlantı Mac'te `NoktaDestek-<firma>-….zip` indirir.
2. **Kopyala** ile bağlantıyı alın. Müşterilerinize e-posta imzası, web siteniz, sözleşme veya karşılama yazısıyla iletin.
3. Müşteri bağlantıdan dosyayı indirir ve ihtiyaç olduğunda talep gönderir. Dosya her müşteri için aynıdır; kurulum gerekmez.

### Bağlantıyı ne zaman yenilemeliyim?

**Bağlantıyı yenile** eski Genel bağlantıyı, daha önce indirilmiş Genel dosyaları ve Genel olarak kayıtlı bilgisayarları
**hemen geçersiz** kılar; müşteri firmalara ait bağlantılar ve bekleyen talepler etkilenmez. Şu durumlarda yenileyin:

- Bağlantı istemediğiniz yerlere yayıldıysa veya sahte talepler geliyorsa,
- Panelde "Olağan dışı talep yoğunluğu" bandı sık görünüyorsa,
- Firmanızın adı değiştiyse (eski adlı dosyalar zaten çalışmaz).

Yeniledikten sonra yeni bağlantıyı tüm müşterilerinize göndermeniz gerekir. "Son yenileme" alanı tarihi gösterir.
Mac müşterileri için de aynıdır: eski klasördeki uygulama "Bu dosya artık geçerli değil" der; müşteri yeni bağlantıdan
yeniden indirir.

### Bekleme süresi

Bir talebin kuyrukta en çok ne kadar bekleyeceğidir: **10–120 dakika** (varsayılan 30). Süre dolunca talep "Süresi
doldu" olur ve müşteri yeniden talep oluşturabilir. Değişiklik yalnız yeni talepler için geçerlidir.

### WhatsApp bildirimi

1. **WhatsApp bildirimi** anahtarını açın.
2. **Alıcı ekle** ile en çok 5 telefon numarası girin (ör. 0532 000 00 00). Kanal açıkken en az bir alıcı gerekir.
3. **Test numarası** girip **Test mesajı gönder**'e basın; sonuç ekranda görünür. Dakikada en çok 5 test yapılabilir.
4. **Kaydet**'e basın.

Mesaj müşteri adı, telefonu veya açıklaması **içermez**; yalnız firma adı, talep kodu ve panel bağlantısı gider.
Ekranda "WhatsApp servisi güvenli yapılandırılmamış…" uyarısı görünürse kanal canlı ortamda kapalı kalır; sistem
yöneticinize bildirin. Servis adresini yalnız Super Admin değiştirir (bkz. "Super Admin için: Sistem ayarları > WhatsApp
servisi"). **E-posta bildirimi** için bkz. "Admin için: Destek talebi e-posta bildirimi".

Super Admin ekranında sarı **"Şifresiz bağlantıya izin verildi"** uyarısı görünüyorsa sistem yöneticisi WhatsApp servisine
geçici olarak düz `http` ile bağlanmaya izin vermiştir (`WHATSAPP_ALLOW_INSECURE_HTTP`): servis anahtarı ve mesajlar ağda
açık metin gider. WhatsApp servisi HTTPS'e taşındığında bu izin kapatılmalıdır.

### Güvenilen IP / ağlar

Kurumsal ofis gibi bilinen ağlardan gelen talepler "Güvenilen ağ" işaretiyle gelir ve IP sınırlarından muaftır
(ör. aynı ofisten çok sayıda çalışan aynı anda talep gönderebilir).

1. **Ağ ekle** ile müşterinin sabit dış IP'sini (`203.0.113.10/32`) veya ağını (`203.0.113.0/24`) girin.
2. En çok 10 ağ; IPv4 en geniş /16, IPv6 en geniş /32. Özel (192.168.x.x gibi) adresler kabul edilmez.
3. **Kaydet**.

Firma başına toplam bekleyen talep sınırı (50) güvenilen ağlar için de geçerlidir.

### Talep kabulünde kabul kodu iste

Bu ayar açıkken bir talebi kabul ettiğinizde müşterinin ekranında 4 haneli bir **kabul kodu** çıkar. Müşteri kodu size
telefonda okur, siz kodu konsoldaki **Kabul kodu** alanına girersiniz (kod veya bağlantıyla gelen müşteriyle aynı yöntem,
bkz. "Bekleyen müşteriyi nasıl kabul ederim?"). Kapalıyken müşteri onay verince doğrudan bağlanır.

1. **Ayarlar > Destek talepleri** sayfasında **Talep kabulü** bölümünü bulun.
2. **Talep kabulünde kabul kodu iste** anahtarını açın veya kapatın, **Kaydet**'e basın.

- Kodun **60 saniye** içinde girilmesi gerekir; süre dolarsa talep "bağlanamadı" olarak kapanır.
- **Önemli uyumluluk uyarısı:** Hızlı Destek **0.10.x** sürümü kabul kodunu desteklemez. Ayar açıkken eski sürümle
  gelen talebi **kabul edemezsiniz**: Kabul'e basınca "Müşterinin istemcisi kabul kodunu desteklemiyor (0.11.0 gerekli)…"
  uyarısı çıkar, talep kuyrukta bekler. Müşteriden Hızlı Destek'i güncellemesini isteyin ya da ayarı kapatın.
  Müşterilerinizin hepsi **0.11** veya sonrasına geçene kadar bu ayarı **kapalı** tutmanız önerilir.

### Öncelik ve SLA

Müşteri kaydında ayrı bir değer yoksa yeni taleplere bu öncelik ve SLA hedefi uygulanır.

1. **Öncelik ve SLA** bölümünde **Varsayılan öncelik**'i seçin (Düşük / Normal / Yüksek; başlangıç Normal).
2. **SLA hedefi (dakika)** alanına talebin en geç kaç dakikada kabul edilmesi gerektiğini yazın (5–1440). Boş
   bırakırsanız SLA takibi yapılmaz.
3. **Kaydet**'e basın.

- SLA yalnız mesai saatleri içinde işler. Mesai takvimi kapalıysa süre kesintisiz sayılır. Mesai saatlerini
  **Mesai saatlerini düzenle** bağlantısından ayarlayın.
- Değer talep açılırken sabitlenir; değişiklik bekleyen talepleri etkilemez.
- Müşteriye özel değer için bkz. "Nasıl müşteri eklerim?" (Varsayılan öncelik, SLA hedefi).

### Web talep formu

Müşteriler program indirmeden tarayıcıdan talep gönderebilsin istiyorsanız formu açın.

1. **Web talep formu** bölümünde **Web talep formunu aç** anahtarını açın, **Kaydet**'e basın.
2. **Form bağlantısını kopyala** ile genel form bağlantısını alın. Form kapalıyken "Form şu an kapalı. Bağlantıyı
   paylaşmadan önce formu açıp kaydedin." yazar.

Genel form bağlantısından gelen talepler "Genel" görünür. Müşteriye özel form bağlantısı müşterinin detay sayfasındadır.
Formu kapattığınızda bütün form bağlantıları **hemen** "Bağlantı geçersiz" gösterir; bekleyen talepler etkilenmez.

**Form bağlantısını nasıl paylaşırım?** Web sitenizin "Destek" sayfasına, e-posta imzanıza veya karşılama yazınıza ekleyin.
Bağlantıyı yalnız müşterilerinize verin; herkese açık bir yerde yayınlarsanız istenmeyen talep riskine karşı aşağıdaki
adımları bilin.

**Sınırlar:** Web formundan firmanıza saatte en çok 60 talep gelir ve aynı anda en çok 30 web talebi bekleyebilir
(toplam bekleyen sınırı 50; böylece Windows programından gelen taleplere her zaman yer kalır). Aynı internet adresinden
gelen talepler programdaki gibi sınırlıdır.

### Form spam'i altında ne yapılır?

Kuyruğa tanımadığınız, anlamsız talepler yağıyorsa ya da müşteriler "çok yoğunuz" mesajı alıyorsa:

1. **Formu hemen kapatın:** **Web talep formunu aç** anahtarını kapatıp **Kaydet**'e basın. Bütün form bağlantıları anında
   geçersiz olur; yeni web talebi gelmez. Programdan gelen talepler etkilenmez.
2. **Sızan bağlantıyı yenileyin:**
   - Spam genel form bağlantısından geliyorsa bu sayfadaki **Bağlantıyı yenile** (bkz. "Bağlantıyı ne zaman
     yenilemeliyim?"). Dikkat: bu, Genel indirme bağlantısını, indirilmiş Genel dosyaları ve Genel olarak hatırlanan
     bilgisayarları da geçersiz kılar.
   - Spam bir müşterinin bağlantısından geliyorsa o müşterinin detay sayfasındaki **Bağlantıyı yenile**.
3. Bekleyen sahte talepleri **Reddet** ile kapatın; tekrar eden kaynakları **Bu kaynağı engelle** ile engelleyin.
4. Formu yeniden açın ve **yeni** bağlantıyı yalnız müşterilerinize gönderin.

Eski bağlantı yenilemeden sonra çalışmaz. Formu kapatmak ve bağlantı yenilemek denetim kaydına yazılır.

### Müşteriye durum bildirimi (SMS / WhatsApp / E-posta)

Web formundan talep gönderen müşteri, talebinin kabul edildiğini, karşılanamadığını ya da bekleme süresinin dolduğunu
SMS, WhatsApp veya e-postayla öğrenebilir. Hangi kanalları sunacağınızı burada seçersiniz.

1. **Müşteriye durum bildirimi** bölümünde **SMS ile bildir**, **WhatsApp ile bildir**, **E-posta ile bildir**
   anahtarlarından istediklerinizi açın.
2. **Kaydet**'e basın.

- Kanal açık ama kullanılamıyorsa altında uyarı çıkar ve kanal formda **gösterilmez**:
  - SMS: "SMS ayarı eksik ya da anahtar okunamıyor" → **SMS ayarlarına git** (bkz. "Admin için: Ayarlar > SMS").
  - WhatsApp: sistem WhatsApp servisi kullanılamıyor → Super Admin'e başvurun.
  - E-posta: SMTP ayarı yok → **SMTP ayarlarına git**.
- Müşteri formda kutucuğu işaretlemezse hiçbir bildirim gitmez. Kutucuklar varsayılan işaretsizdir.
- **KVKK notu:** Bu kutucuk açık rıza değil, **hizmet bildirimi tercihidir**. Mesaj yalnız müşterinin kendi talebinin
  durumunu bildirir; reklam veya kampanya içermez. Ticari elektronik ileti olmadığı için İYS kaydı gerekmez. Bildirim
  metinleri sabittir; teknisyenin ret notu bildirime yazılmaz.
- **Alıcı başına tavanlar:** aynı numaraya/adrese firmanızdan 24 saatte en çok 3, tüm sistemden yaklaşık 5 bildirim gider (birkaç firma aynı anda bildirim gönderirse bu sayı az miktarda aşılabilir).
  Firma başına saatte SMS 100, WhatsApp 60, e-posta 100 bildirimle sınırlıdır. Aynı numarayla bekleyen başka bir web
  talebi varsa yeni talep için bildirim gönderilmez. Tavana takılan bildirim gönderilmez ve denetim kaydına "sınıra
  takıldı" olarak yazılır.
- Gönderim başarısız olursa sistem 3 kez dener; yine olmazsa vazgeçer ve denetim kaydına başarısız olarak yazar. Başarısız
  bildirim sonradan yeniden gönderilmez.

### Yetkiler ve kayıtlar

- **Destek talepleri → Görüntüle** (`support_requests.view`) kuyruğu, **Kabul et** (`support_requests.accept`) kabul ve
  reddi, **Engelle** (`support_requests.block`) talep engellerini, **Ata / öncelik** (`support_requests.assign`) atama ve öncelik
  değişikliğini, **Mesaj yaz** (`support_requests.message`) kabul öncesi mesajlaşmayı açar. Admin'de varsayılan açık, User'da kapalıdır; **Kullanıcılar** ekranındaki yetki tablosundan açılır.
- Kabul, ret, iptal, süre dolumu, ayar değişikliği (eski → yeni; web formunu açma/kapama ve bildirim kanalları dahil),
  bağlantı yenileme, WhatsApp gönderimi ve testi, müşteriye durum bildirimi (alıcı maskeli), reddedilen web formu
  gönderimi, atama, öncelik değişikliği, gönderilen mesaj (içeriksiz, yalnız uzunluk) ve mesai dışı ret denetim kaydına yazılır. Müşteri adı, telefonu ve açıklaması denetim kaydına yazılmaz.

## Admin için: Ayarlar > Mesai saatleri ve Tatiller

**Ayarlar → Mesai saatleri** (takvim simgesi) firmanızın talep kabul saatlerini, mesai dışında ne olacağını ve tatil
günlerini tutar. SLA süreleri yalnız mesai içinde işler. Görmek için "Ayarlar → Görüntüle", değiştirmek için "Ayarlar →
Düzenle" yetkisi gerekir; yalnız görüntüleme yetkiniz varsa sayfa salt okunur açılır. Super Admin önce üst menüden firma
seçer.

### Mesai saatlerini nasıl ayarlarım?

1. **Mesai takvimini kullan** anahtarını açın. Kapalıyken talepler her zaman alınır ve SLA kesintisiz işler.
2. **Saat dilimi**'ni seçin (varsayılan Europe/Istanbul). Saatler bu dilimde, yaz saati uygulaması dahil yorumlanır.
3. **Günler** bölümünde her gün için çalışma aralığını girin:
   - Saatler SS:DD biçiminde yazılır (ör. `09:00`). Gün sonuna kadar açık için bitişe `24:00` yazın.
   - Öğle arası için **Aralık ekle** ile ikinci aralık girin (gün başına en çok 2 aralık; aralıklar örtüşemez).
   - Aralığı olmayan gün **Kapalı**'dır.
   - **Pazartesiyi hafta içine kopyala** Pazartesi saatlerini Salı–Cuma'ya aktarır.
4. **Mesai dışında gelen talep** için seçin:
   - **Talebi al:** talep kuyruğa düşer, "Mesai dışı" olarak işaretlenir; SLA ilk açılışta başlar.
   - **Reddet ve sonraki açılışı göster:** talep açılmaz; müşteri "Mesai dışındayız. Sonraki açılış: …" mesajını görür.
5. **Kaydet**'e basın. "Mesai saatleri kaydedildi." yazar.

Sayfadaki önizleme "Şu an: Açık" ya da "Şu an: Kapalı — sonraki açılış <tarih saat>" gösterir. Önizleme
kaydedilmiş ayara göredir; değişikliği kaydedince güncellenir.

### Tatil günü nasıl eklerim?

Tatil günlerinde mesai kapalı sayılır. Firma başına en çok 200 tatil günü tanımlanabilir.

1. Aynı sayfadaki **Tatiller** bölümünde **Yıl**'ı seçin.
2. **Tatil ekle**'ye basın; **Tarih** ve **Ad** girin.
3. Yarım gün çalışılacaksa (ör. arife) **Kapanış saati**'ne o güne kadar açık kalınacak saati yazın (ör. `13:00`). Boş
   bırakırsanız gün tam kapalıdır.
4. **Ekle**'ye basın.

Tatili değiştirmek için silip yeniden ekleyin. Silmek için satırdaki sil düğmesine basıp onaylayın; o gün normal mesai
saatleri uygulanır.

### Türkiye resmî tatillerini tek tuşla eklemek

1. **Tatiller** bölümünde **Yıl**'ı seçin.
2. **Resmî tatilleri ekle (<yıl>)**'a basın. Sonuç: "<n> tatil eklendi, <m> gün zaten vardı."

- Liste bu sürümde **2026 ve 2027** için hazırdır; arifeler 13:00'e kadar açık eklenir. Başka bir yıl seçiliyse düğme
  pasiftir ve "Resmî tatil listesi şu yıllar için hazır: 2026, 2027." notu görünür.
- Zaten ekli günler atlanır; firmaya özel tatilleriniz silinmez.
- **Her yıl güncelleyin:** dinî bayram tarihleri her yıl değişir. Aralık ayında ertesi yılın listesini ekleyin; yeni yıl
  listesi programın güncellenmesiyle gelir. Eski yılların tatilleri silinmez (geçmiş SLA hesapları için gereklidir).

### Sık karşılaşılan mesajlar (Mesai saatleri ve Tatiller)

| Mesaj                                                   | Ne yapmalı                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Mesai açıkken en az bir gün için saat aralığı girin     | Takvim açıkken en az bir gün için çalışma saati girin ya da takvimi kapatın      |
| Bitiş başlangıçtan sonra olmalı · Aralıklar örtüşemez   | Aralık saatlerini düzeltin; gece yarısını aşan aralık girilemez (iki güne bölün) |
| Bu gün zaten tatil olarak ekli                          | O gün için tatil var; değiştirmek için önce silin                                |
| Firma başına en çok 200 tatil günü tanımlanabilir       | Gereksiz tatil günlerini silin                                                   |
| Şu an: Kapalı — önümüzdeki bir yıl içinde açık saat yok | Haftada hiç açık aralık kalmamış ya da tüm günler tatil; saatleri kontrol edin   |

Mesai ayarı ve tatil değişiklikleri (ekleme, silme, içe aktarma) denetim kaydına yazılır.

## Admin için: Ayarlar > E-posta (SMTP)

Firmanızın e-posta gönderebilmesi için gerekir: şifre sıfırlama, hesap kilidi ve 2FA bildirimleri, yeni destek talebi
e-postası ve oturum bağlantısının müşteriye e-postayla gönderilmesi. Ayar yoksa bu özellikler e-posta göndermez.
Görmek için `settings.view`, değiştirmek için `settings.edit` yetkisi gerekir.

### Nasıl SMTP ayarı yaparım?

1. Kenar menüsünde **Ayarlar** → üstteki alt menüden **E-posta (SMTP)**.
2. Alanları doldurun:
   | Alan                            | Açıklama                                                                                                                          |
   | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
   | Sunucu                          | E-posta sağlayıcınızın SMTP adresi (ör. `smtp.sirketiniz.com`)                                                                    |
   | Güvenlik                        | **SSL** (port 465), **TLS** (STARTTLS, port 587) veya **Yok** (port 25). Seçince port önerilir                                    |
   | Port                            | Yalnız 25, 465, 587 veya 2525 seçilebilir                                                                                         |
   | Kullanıcı adı / Şifre           | Sağlayıcınızın verdiği bilgiler. Şifre maskelidir, kaydedildikten sonra forma geri gelmez; boş bırakırsanız kayıtlı şifre korunur |
   | Gönderen adı / Gönderen e-posta | Alıcının göreceği ad ve adres                                                                                                     |
3. **Kaydet**'e basın.

**Güvenlik "Yok" seçilirse** kullanıcı adı ve şifre yine girilebilir (TLS/SSL desteklemeyen, port 25'te kimlik doğrulaması
isteyen sunucular için). Bu durumda alanların altında sarı bir uyarı çıkar: kullanıcı adı ve şifre ağda açık metin gider;
yalnız güvendiğiniz ağdaki sunucular için kullanın. Sunucu TLS sunsa bile "Yok" seçiliyken bağlantı şifrelenmez. Test
sırasında "Sunucu kimlik bilgilerini reddetti (535)…" mesajı çıkarsa kullanıcı adı/şifreyi ve sunucunun bu güvenlik
seçeneğinde kimlik doğrulamaya (AUTH) izin verip vermediğini kontrol edin. Mümkünse SSL veya TLS tercih edin.

**İç ağ adresleri kabul edilmez:** sunucu adresi şirket içi/özel bir IP'ye (ör. 192.168.x.x, 10.x.x.x) çıkıyorsa
"Bu sunucu adresi kullanılamaz." uyarısı çıkar. İnternetten erişilen bir SMTP sunucusu kullanın.

### Test maili nasıl gönderilir?

1. Ayarı **kaydedin** (kaydedilmemiş değişiklik varken test düğmesi pasiftir; test kayıtlı ayarla yapılır).
2. **Test Maili Gönder** → alıcı adresini yazın → gönderin.
3. Sonuç pencerede görünür. Başarısız bir test **12 saniyeye kadar** sürebilir; bu sırada pencerede "Sunucuya bağlanılıyor…" yazar ve
   pencere sonuç gelene kadar kapanmaz.
4. Hata mesajı (kimlik reddi dışında) tek ve geneldir ("E-posta gönderilemedi. Sunucu, port, güvenlik ve kimlik bilgilerini kontrol edin.");
   sunucu adı, port–güvenlik eşleşmesi (465↔SSL, 587↔TLS) ve kullanıcı/şifreyi kontrol edin. Firma başına dakikada en çok
   5 test yapılabilir.

**SMTP ayarını kaldırmak:** sayfadaki "SMTP ayarlarını kaldır" düğmesi (onay ister). Kaldırınca e-posta bildirimleri durur.

## Admin için: Ayarlar > SMS

Müşteriye oturum bağlantısı ve talep durumu SMS'leri bu ayarla Nokta Bilişim **smsportal** servisi üzerinden gönderilir.
Görmek için `settings.view`, değiştirmek ve test için `settings.edit` yetkisi gerekir. Super Admin önce firma seçer.

### Nasıl SMS ayarı yaparım?

1. **Ayarlar** → üstteki alt menüden **SMS**.
2. Alanları doldurun:
   | Alan                            | Açıklama                                                                                                                                         |
   | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
   | smsportal adresi                | Boş bırakırsanız sistem varsayılan adresi kullanılır ("Sistem varsayılanı"). Varsayılan tanımlı değilse adres girmeniz gerekir                   |
   | API anahtarı                    | smsportal yönetim panelinden oluşturduğunuz anahtar (8–256 karakter, boşluksuz). Maskelidir; kayıtlıysa "Kayıtlı — değiştirmek için yazın" yazar |
   | Gönderen başlığı (isteğe bağlı) | NetGSM'de onaylı başlık; en çok 11 karakter (harf, rakam, boşluk, nokta, tire)                                                                   |
3. **Kaydet**'e basın.

**Adrese anahtar yazmayın.** Adres yalnız `https://sunucu/yol` biçiminde olur; kullanıcı adı, şifre, `?…` ya da `#…`
içeren adres reddedilir ("Adres kullanıcı adı, şifre veya sorgu içeremez; API anahtarını ayrı alana yazın."). Anahtar
yalnız **API anahtarı** alanına yazılır ve şifreli saklanır; kaydedildikten sonra forma geri gelmez.

- Anahtar alanını boş bırakırsanız kayıtlı anahtar korunur. **Anahtarı sil** onay ister; kaydedince SMS gönderimi durur.
- Adresi değiştirirseniz anahtarı yeniden girmeniz gerekir ("Adres değişti; API anahtarını yeniden girin.").
- Canlı ortamda adres `https` olmalı ve yalnız 443 portunu kullanmalıdır. İç ağ ve özel adresler kabul edilmez ("Bu sunucu
  adresi kullanılamaz.").

### Ekrandaki bantlar ne demek?

| Bant                                                                                       | Anlamı ve yapılacak                                                                                                               |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| SMS kanalı kullanılabilir.                                                                 | Her şey hazır                                                                                                                     |
| SMS kanalı kullanılamıyor: adres ya da API anahtarı eksik.                                 | Adres (veya sistem varsayılanı) ve anahtarı girip kaydedin                                                                        |
| Kayıtlı API anahtarı okunamıyor (servis adresi değişmiş olabilir). Anahtarı yeniden girin. | Sistem varsayılan adresi değişmiş olabilir. Güvenlik gereği eski anahtar yeni adrese gönderilmez; anahtarı yeniden yazıp kaydedin |
| Adres şifresiz (http) ve genel bir sunucuda…                                               | Anahtar açık metin gideceği için kanal kapalıdır; `https://` adres girin                                                          |

### Test SMS nasıl gönderilir?

1. Ayarı **kaydedin** (test kayıtlı ayarla yapılır; kaydedilmemiş değişiklik varsa uyarı çıkar).
2. **Test için cep telefonu** alanına numarayı yazın, **Test SMS Gönder**'e basın.
3. Sonuç ekranda görünür: "Test SMS'i gönderildi." ya da neden ("SMS servisine ulaşılamadı.", "SMS servisi API anahtarını
   reddetti.", "SMS servisi yapılandırılmamış ya da kullanılamıyor." vb.).

SMS yalnız Türkiye cep numaralarına gönderilir. Kişi başına dakikada 5, firma başına dakikada 20, aynı numaraya saatte 3
test yapılabilir. Ayar değişikliği (anahtar `***` olarak) ve her test denetim kaydına yazılır.

## Admin için: Audit log (denetim kaydı)

Kim, ne zaman, ne yaptı sorusunun cevabıdır: girişler, başarısız denemeler, kayıt ekleme/değiştirme, yetki ve ayar
değişiklikleri, e-posta/WhatsApp gönderimleri, oturum ve uzaktan kontrol olayları. Kayıtlar **salt okunurdur**: ekranda
düzenleme veya silme düğmesi yoktur, sunucu ve veritabanı da buna izin vermez. Son 730 güne ait kayıtlar hiçbir
şekilde silinemez.

**Ne kadar saklanır?** Audit kayıtları **730 gün** (yaklaşık 2 yıl) saklanır. Bu süre firmaya göre değişmez. Daha eski
kayıtları her gece çalışan **Saklama süresi işi** kendiliğinden siler. İş her çalıştığında, bir şey değiştirdiyse, kendisi de
"Saklama süresi işi" adıyla bir kayıt bırakır (kullanıcı: `system`). Kaydın ayrıntısında yalnız sayılar vardır: kaç oturum,
onay kaydı, dosya kaydı, talep, müşteri ve bilgisayar kaydı anonimleştirildi; sistem kaydında kaç audit kaydı, giriş
oturumu ve şifre sıfırlama bağlantısı silindi. Sonuç "Başarısız" ise sistem yöneticisine bildirin. Bu kayıtları **İşlem**
filtresinde **Veri saklama** grubuyla bulursunuz.

**Yedekleme kayıtları:** Sunucu yöneticisi yedeklerin audit denetimini bilerek sıfırladığında (ör. bir geri yüklemeden sonra)
"Yedek audit taban çizgisi sıfırlandı" kaydı düşer. Bu kayıtları **İşlem** filtresinde **Yedekleme** grubuyla bulursunuz.
Beklemediğiniz bir anda böyle bir kayıt görürseniz sunucu yöneticisine bildirin.

**Müşteri kayıtlarında ne görünür?** Müşteri kaynaklı kayıtlarda (bağlanma, destek talebi, bilgisayar kaydı vb.; kullanıcı
`customer`) müşterinin adı yazılmaz. IP adresinin tamamı değil yalnız ağ kısmı görünür (ör. `203.0.113.0/24`), tarayıcı
bilgisi boştur. Dosya aktarım kayıtlarında dosya adı ve dosya özeti (SHA-256) yazılmaz; yalnız yön (teknisyene/müşteriye),
uzantı (ör. `pdf`), boyut ve sonuç görünür. Dosyanın adı oturum ayrıntısındaki **Dosyalar** bölümündedir ve saklama süresi
dolunca silinir. Böylece saklama süresi dolup oturum anonimleştikten sonra müşteri audit üzerinden tanınamaz.

**Kim görür?**

| Rol              | Ne görür                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| User (teknisyen) | Varsayılan olarak hiç; Admin **Audit log → Görüntüle** yetkisini açarsa kendi firmasının kayıtlarını     |
| Admin            | Kendi firmasının tüm kayıtlarını (yetkiler varsayılan açık)                                              |
| Super Admin      | Firma seçmeden: tüm firmalar + sistem kayıtları (ör. MySQL/TURN ayarı). Firma seçiliyken: yalnız o firma |

CSV indirmek için ayrıca **Audit log → Dışa aktar** yetkisi gerekir. Yetkisi olmayan kullanıcı menüde "Audit log"u görmez;
adresi elle açarsa "Audit log'u görüntüleme yetkiniz yok." yazar.

### Nasıl bir kaydı bulurum?

1. Kenar menüsünde **Audit log** (kaydırma kâğıdı simgesi).
2. Liste en yeni kayıt üstte olacak şekilde gelir. Tarih seçmezseniz **son 30 gün** gösterilir.
3. Filtreleri doldurun ve **Filtrele**'ye basın:
   | Filtre                   | Anlamı                                                                                                                                           |
   | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
   | Başlangıç / Bitiş tarihi | Türkiye saatiyle gün; bitiş günü dahil. Aralık en çok 731 gün                                                                                    |
   | Kullanıcı                | İşlemi yapan kişi                                                                                                                                |
   | İşlem                    | Tek bir işlem veya bir grup (ör. "Giriş ve hesap güvenliği", "Kullanıcı ve yetki", "Ayarlar ve testler", "E-posta", "Veri saklama", "Yedekleme") |
   | Sonuç                    | Başarılı / Başarısız                                                                                                                             |
   | Firma                    | Yalnız firma seçmemiş Super Admin'de                                                                                                             |
4. İlk 50 kayıt görünür; devamı için listenin altındaki **Daha fazla yükle**. Hepsi geldiyse "Tüm kayıtlar gösterildi" yazar.
5. **Filtreleri temizle** ile başa dönün. Filtreler adres çubuğunda durur; bağlantıyı kopyalayıp aynı görünümü
   paylaşabilirsiniz (karşı tarafın da yetkisi olmalı).

Listede: zaman, kullanıcı (resmi veya baş harfleri), firma (Super Admin), işlem (Türkçe ad + teknik ad), varlık, sonuç
rozeti, IP adresi. Dar ekranda (telefon) tablo yerine kartlar gösterilir.

**"Kimlik maskeli" rozeti:** Kaydın ilgili olduğu kullanıcı ya da firma kalıcı silindiyse satırda bu rozet görünür.
Kullanıcı "Silinmiş kullanıcı #XXXXXX", firma "Silinmiş firma #XXXXXX" olarak yazılır; e-posta `a***@***` biçiminde,
kayıt içindeki ad/e-posta/telefon değerleri `***` olarak gösterilir. Ayrıntı penceresinde "Bu kayıttaki kişi bilgileri
maskelendi: ilgili kullanıcı ya da firma kalıcı silindi." notu çıkar. CSV'de de aynı maske uygulanır. Kalıcı silme
kayıtlarını **İşlem** filtresinde "Kullanıcı kalıcı silindi", "Firma silme zamanlandı", "Firma kalıcı silindi" gibi
adlarla; yetim dosya taramasını **Dosya deposu** grubunda bulursunuz.

### Kaydın ayrıntısını nasıl görürüm?

Satırdaki **Ayrıntı** (göz simgesi) düğmesine, telefonda karta dokunun. Pencerede kayıt no, tarih, kullanıcı, işlem,
varlık ve kayıt kimliği, IP, tarayıcı, **Eski değer** ve **Yeni değer** görünür. Şifre, token ve anahtarlar `***` ya da
yalnız "changed" (değişti) olarak görünür; asıl değer hiçbir yerde tutulmaz. E-posta gönderimi ve test kayıtlarında yalnız
sonuç **nedeni** Türkçe olarak, altında teknik kodla gösterilir (ör. "Servise ulaşılamadı" / `unreachable`); tanınmayan
kod olduğu gibi görünür. Alıcı içeriği ve sunucunun ham hata metni gösterilmez. Esc veya **Kapat** ile çıkın.

### Nasıl CSV indiririm?

1. Önce filtreleri ayarlayın; CSV yalnız filtreye uyan kayıtları içerir.
2. **CSV indir**'e basın. Dosya adı `audit-YYYYAAGG-SSDD.csv` biçimindedir; Excel'de çift tıklayınca Türkçe karakterler
   doğru açılır (ayraç noktalı virgül).
3. Eski/yeni değer sütunları JSON metnidir. `=`, `+`, `-`, `@` ile başlayan hücrelerin önüne `'` eklenir (Excel formül
   olarak çalıştırmasın diye).

- En çok **50.000 satır**: aşarsa "En çok 50.000 satır dışa aktarılabilir; tarih aralığını daraltın" yazar.
- Dakikada en çok 5 indirme. Her indirme de audit'e yazılır.

### Sık karşılaşılan mesajlar (Audit log)

| Mesaj                                                                    | Ne yapmalı                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Tarih aralığı en çok 731 gün olabilir                                    | Başlangıç tarihini ileri alın                                     |
| Bitiş tarihi başlangıçtan önce olamaz                                    | Tarihleri düzeltin                                                |
| Bu aralıkta kayıt yok / Filtreye uyan kayıt yok                          | Başlangıç tarihini geri alın veya filtreleri temizleyin           |
| Sonraki kayıtlar alınamadı                                               | **Daha fazla yükle**'ye yeniden basın; sürerse sayfayı yenileyin  |
| Kullanıcı listesi alınamadı; seçenekler bu sayfadaki kayıtlardan geliyor | Bilgi amaçlı; Super Admin firma seçmeden bakarken normaldir       |
| CSV düğmesi yok                                                          | **Audit log → Dışa aktar** yetkiniz kapalı; Admin'inizden isteyin |

## Admin için: Ayarlar > Aydınlatma metni

Müşterinin ekranını paylaşmadan (veya Hızlı Destek'ten destek istemeden) önce okuyup onayladığı KVKK aydınlatma metnidir.
Her firmanın kendi metni vardır; firma oluşturulurken sistem metniyle başlar. Görmek için **Ayarlar → Görüntüle**,
değiştirmek için **Ayarlar → Düzenle** yetkisi gerekir. Yalnız görüntüleme yetkisi olan kişi sayfayı salt okunur görür
(menüdeki **Ayarlar** öğesi Düzenle yetkisi ister; bu kişi sayfayı `/settings/consent-text` adresinden açar).
Super Admin önce üst menüden firma seçer.

### Nasıl metni değiştiririm?

1. **Ayarlar** → üstteki alt menüden **Aydınlatma metni**.
2. Üstte güncel sürüm numarası, tarihi ve hazırlayan kişi ("Sistem" = hazır metin) görünür.
3. Metni kutuda düzenleyin. Sayaç **en az 50, en çok 20.000** karakter ister. Metin düz yazıdır; kalın yazı, bağlantı gibi
   biçimler yorumlanmaz.
4. **Yeni sürüm olarak kaydet** → onay penceresinde "Yeni oturumlar bu metni gösterecek; eski onaylar eski sürüme bağlı
   kalır." yazar → onaylayın.
5. "Sürüm N kaydedildi" mesajı çıkar ve **Sürüm geçmişi** listesine eklenir.

**Sürümleme nasıl işler?** Eski sürümler silinmez ve değiştirilemez. Daha önce verilmiş her onay, onaylandığı sürüme (ve
metnin parmak izi olan SHA-256 özetine) bağlı kalır; böylece "müşteri hangi metni onayladı" sorusu her zaman
cevaplanabilir. Kaydettiğiniz andan sonra açılan oturumlar yeni metni gösterir. Bekleme ekranında eski metni görmüş müşteri
yeniden onay vermek zorunda kalır.

### Sık karşılaşılan mesajlar (Aydınlatma metni)

| Mesaj                                                | Anlamı / ne yapmalı                                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Metin güncel sürümle aynı; yeni sürüm oluşturulmadı. | Değişiklik yoktu; bir şey yapmanız gerekmez                                                                 |
| Metin bu sırada başka biri tarafından güncellendi…   | Yazdığınız metin kutuda korunur. Kopyalayın, sayfayı yenileyin, güncel sürümü kontrol edip yeniden kaydedin |
| Metin görünmez veya kontrol karakteri içeremez       | Word/PDF'ten yapıştırılan görünmez karakterler var; metni düz metin editörüne yapıştırıp oradan kopyalayın  |
| Çok fazla istek (hız sınırı)                         | Firma başına saatte en çok 10 kayıt yapılabilir; bir süre sonra deneyin                                     |

## Admin için: Ayarlar > Logo

Firmanızın logosu üst menüde, müşterinin karşılama sayfasında (`/session/...`) ve e-postalarda
görünür. Logo yoksa sistem logosu kullanılır. Ekran: **Ayarlar** → **Logo** sekmesi (resim
simgesi). Görmek için "Ayarlar → Görüntüle", değiştirmek için "Ayarlar → Düzenle" yetkisi gerekir; yalnız görüntüleme
yetkiniz varsa sayfa salt okunur uyarısıyla açılır. Süper Yönetici önce üst menüden firmayı seçer.

### Nasıl logo yüklerim veya değiştiririm?

1. **Ayarlar > Logo**'yu açın. **Geçerli logo** alanında şu anki logo görünür ("Firma logosu yüklenmedi; sistem logosu
   gösteriliyor" yazıyorsa henüz logonuz yoktur).
2. **Logo seç** (logonuz varsa **Logoyu değiştir**) ile dosyayı seçin.
3. **Önizleme (henüz kaydedilmedi)** alanında logoyu kontrol edin. Beğenmezseniz **Vazgeç**.
4. **Logoyu kaydet**'e basın. "Logo kaydedildi" mesajından sonra logo üst menüde görünür.

Yatay logolar uygundur. Sunucu logoyu en çok 512 piksele küçültür ve PNG olarak saklar. Koyu temada logo açık renkli bir
zemin üzerinde gösterilir, böylece siyah yazılar okunur. Dosya kuralları: "Resim dosyası kuralları".

### Logoyu nasıl kaldırırım?

1. **Logoyu kaldır**'a basın.
2. "Firma logosu kaldırılsın mı?" penceresinde onaylayın. Üst menüde ve müşteri sayfalarında sistem logosu görünür.

Yükleme, değiştirme ve kaldırma audit log'a yazılır. Reddedilen dosyalar da "başarısız" olarak kaydedilir.

### Giriş bağlantısını ekibe nasıl veririm?

Firmanızın giriş ekranında kendi logonuzun görünmesi için ekibe `…/login?tenant=<firmanızın kısa adı>` bağlantısını verin
(bkz. "Giriş ekranında firmamın logosu nasıl görünür?").

## Admin için: Ayarlar > Güvenlik (teknisyenler için 2FA ve veri saklama)

Bu sayfada ayrıca **Veri saklama** bölümü vardır (bkz. "Kişisel verilerin saklama süresi ve anonimleştirme").

1. **Ayarlar** → **Güvenlik**.
2. **Teknisyenler için zorunlu** anahtarını açın veya kapatın; değişiklik hemen kaydedilir.

- Açıkken 2FA kurmamış teknisyenler sonraki girişte kurulum ekranına yönlendirilir.
- Admin ve Super Admin için 2FA bu ayardan bağımsız olarak her zaman zorunludur.

### 2FA cihaz hatırlama

Aynı sayfadaki ikinci anahtar **2FA cihaz hatırlama**dır. Açıkken firmanızdaki Admin ve teknisyenler giriş kodunda
"Bu cihazı 30 gün hatırla"yı seçebilir (bkz. Herkes için bölümü). Super Admin hesapları her durumda hariçtir.

- **Varsayılan açıktır** — bu sürümden önce oluşturulmuş firmalarda da. Kurumunuz her girişte kod istiyorsa kapatın.
- Kapatmak onay ister: firmanızdaki **tüm** hatırlanan cihazlar hemen silinir, herkes bir sonraki girişte kod girer.
- Yeniden açmak silinen cihazları geri getirmez; kullanıcılar kutuyu yeniden işaretler.
- Değişiklik audit log'a eski → yeni değer ve silinen cihaz sayısıyla yazılır.

### Bir kullanıcının hatırlanan cihazlarını kaldırma

Kullanıcının bilgisayarı çalındıysa ya da kullanıcı ayrılıyorsa:

1. **Kullanıcılar** → kullanıcıya tıklayın.
2. Hesap bilgilerinde **Hatırlanan cihazlar** satırında kaç cihaz olduğu görünür.
3. **Hatırlanan cihazları kaldır** → onaylayın.

Kullanıcının bir sonraki girişinde kod sorulur; açık oturumları kapanmaz (gerekirse pasife alın). Düğme sayı 0 iken pasiftir,
kendi hesabınızda ve sizden geniş yetkili hesaplarda görünmez (kendi cihazlarınız için Hesabım'ı kullanın).

## Admin için: Kullanıcının 2FA'sını sıfırlama

Telefonunu kaybeden veya kurtarma kodları biten kullanıcı için:

1. **Kullanıcılar** → kullanıcıya tıklayın.
2. **2FA'yı sıfırla** → onaylayın (varsayılan seçim "Vazgeç"tir).
3. Kullanıcının tüm oturumları ve açık destek oturumları kapanır. Kullanıcı sonraki girişte 2FA'yı yeniden kurar.

Düğme yalnız 2FA'sı etkin, yönetebildiğiniz (sizden geniş yetkili olmayan) ve kendiniz olmayan kullanıcıda görünür.
Kendi 2FA'nızı başka bir Admin sıfırlar.

## Admin için: Destek talebi e-posta bildirimi

1. Önce SMTP ayarını yapın (yoksa anahtar pasiftir ve "Önce SMTP ayarlarını yapın" yazar).
2. **Ayarlar > Destek talepleri** → e-posta kanalını açın, en çok 5 alıcı ekleyin, **Kaydet**.
3. **Test maili gönder** ile deneyin.

Her yeni talepte alıcılara firma adı, talep kodu ve panel bağlantısı gider. Müşterinin adı, telefonu ve açıklaması
e-postaya yazılmaz; ayrıntı paneldedir. Firma başına saatte en çok 30 bildirim e-postası gönderilir.

## Teknisyen ve Admin için: Müşteriye gönder (e-posta, WhatsApp, SMS)

**Müşteriye gönder** penceresi, müşterinin ihtiyaç duyduğu bağlantıyı panelden tek mesajla iletir. Bağlantıyı kopyalayıp
başka bir uygulamadan göndermeniz gerekmez. Her gönderim denetim kaydına yazılır.

Pencere üç yerden açılır. Pencere her yerde aynıdır; yalnız mesajın içeriği değişir.

| Nereden açılır                                                              | Mesajda ne gider                                                                                                                                                                                                                                 | Kanallar               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| **Oturumlar** → yeni oturum oluşturunca çıkan kart                          | Oturum bağlantısı, 8 haneli kod, son geçerlilik saati ve Windows destek programının indirme bağlantısı                                                                                                                                           | E-posta, WhatsApp, SMS |
| **Gözetimsiz cihazlar** → **Kayıt kodları** → kod oluşturunca çıkan pencere | Servis kurulum dosyasının indirme bağlantısı, kayıt kodu, son geçerlilik ve 4 adımlık kurulum özeti                                                                                                                                              | Yalnız e-posta         |
| **Müşteriler** → müşteri ayrıntısı → **Bağlantı** bölümü                    | Müşteriye özel Hızlı Destek indirme bağlantısı ("Hızlı Destek programı (Windows / macOS)") ve (web formu açıksa) destek talebi formu bağlantısı; sonunda "Bağlantı her zaman https://<destek adresi>/ ile başlar; dosya eki göndermeyiz." satırı | E-posta, WhatsApp      |

Mesajlarda müşterinin adı, talep metni ya da sizin yazdığınız bir metin yer almaz. Metin sabittir; değiştirilemez.

### Nasıl gönderirim?

1. Yukarıdaki yerlerden birinde **Müşteriye gönder**'e basın.
2. **Gönderim kanalı** bölümünden kanalı seçin (ok tuşlarıyla da değiştirebilirsiniz).
3. Alıcıyı girin ya da seçin:
   - E-posta için adresi yazın (ör. `musteri@ornek.com`).
   - WhatsApp ve SMS için cep numarasını yazın (ör. `0532 000 00 00`). Altında "Gönderilecek numara: +90…" satırı çıkar.
   - Alan, müşteri kaydındaki ya da talepteki adresle dolu gelebilir. İsterseniz değiştirin.
4. **Gönderilecek mesaj** kutusunu okuyun. Müşteriye birebir bu metin gider (e-postada konu da gösterilir).
5. **Gönder**'e basın. "Gönderildi (kanal, maskeli alıcı)" mesajı çıkar.

Pencere gönderimden sonra açık kalır. Başka bir kanalı seçip ikinci kez gönderebilirsiniz. Her gönderim tek kanala gider.

### Hangi kanal ne zaman görünür?

Pencere yalnız sizin yetkinizin olduğu **ve** o an çalışan kanalları gösterir.

- **E-posta:** firmanızın SMTP ayarı kayıtlı olmalı (**Ayarlar > E-posta (SMTP)**).
- **WhatsApp:** sistem WhatsApp servisi çalışıyor olmalı (Super Admin ayarlar).
- **SMS:** yalnız oturum bağlantısında ve firmanızın SMS ayarı kayıtlıysa. SMS yalnız Türkiye cep numaralarına gider.
  SMS metni kısa tutulduğu için Windows programı satırı SMS'te yoktur.

Bir kanal ayarlı değilse pencerenin altındaki **Kullanılamayan kanallar** listesinde nedeniyle görünür:
"yapılandırılmamış", "kayıtlı alıcı yok" ya da "güvenli bağlantı (https) gerekli". Ayarları görme yetkiniz varsa
yanında ilgili ayar sayfasının bağlantısı çıkar. Hiç kanal yoksa "Gönderim kanalı yapılandırılmamış." yazar;
Admin'inizden SMTP ya da WhatsApp ayarını isteyin.

### Oturum bağlantısını gönderme

- Yalnız oturumu oluşturan teknisyen gönderebilir.
- Yalnız bekleyen (müşteri henüz katılmamış) ve süresi dolmamış oturum gönderilir.
- Bağlantı güvenlik gereği sonradan gösterilmez. Kartı kapattıysanız yeni oturum oluşturun.
- E-postada ayrıca Windows programının dosya adı biçimi ("Destek-" ile başlar), "Windows 10 / 11" bilgisi ve dosyanın
  SHA-256 parmak izi yazar. Sunucudaki program hazır değilse indirme satırı mesaja hiç girmez; önizleme de bunu gösterir.
- Windows programı bağlantısı oturumla birlikte geçersizleşir.

### Kayıt kodunu gönderme

- **Müşteriye gönder** düğmesi yalnız kod oluşturulduktan sonra açılan pencerede bulunur. Pencereyi kapatırsanız kodu
  yeniden gönderemezsiniz; kod sistemde düz metin olarak saklanmaz. Gerekirse yeni kod oluşturun.
- Yalnız kodu oluşturan kişi gönderebilir.
- Alıcı serbest yazılmaz. Yalnız müşterinin **Gözetimsiz bildirim adresleri** listesinden seçilir. Liste boşsa kanal
  "kayıtlı alıcı yok" diye görünür; önce müşteri ayrıntısında adres ekleyin.
- **Bir kayıt kodu en çok 3 kez gönderilebilir.** Pencerede "Kalan gönderim hakkı: n / 3" yazar. Başarısız bir gönderim
  de hakkı tüketir. Hak bitince "Bu kod için gönderim hakkı doldu." yazar; gerekirse yeni kod oluşturun.
- Sunucudaki servis kurulum dosyası hazır değilse e-posta kanalı görünmez.

**Kayıt kodu neden yalnız e-postayla gider?** Kayıt kodu, müşterinin bilgisayarına kalıcı erişim kurar. WhatsApp
mesajları bütün firmaların ortak kullandığı tek bir WhatsApp hesabından gider ve o hesabın geçmişinde düz metin olarak
kalır. WhatsApp servisi ile sunucumuz arasındaki bağlantı da henüz şifreli değildir. Kod yanlış ellere geçerse biri
kendi bilgisayarını müşteri adına kaydedebilir. Bu yüzden kayıt kodu şimdilik yalnız müşterinin kayıtlı e-posta
adreslerine gönderilir.

### Müşteri bağlantılarını gönderme

- Düğme müşteri aktifken, anonimleştirilmemişken ve müşterinin indirme bağlantısı varken görünür.
- Mesajda "Bu bağlantılar firmanıza özeldir, paylaşmayın." uyarısı bulunur.
- Bağlantı her gönderimde müşterinin güncel bağlantısından üretilir. Bağlantıyı yenilediyseniz eski mesajlardaki
  bağlantılar çalışmaz; yeni mesaj gönderin.
- Bu bağlantılar kalıcıdır. Yanlış kişiye gittiyse müşteri ayrıntısında **Bağlantıyı yenile** ile eskisini geçersiz kılın.

### Servis indirme bağlantısı (oturum açmadan) ne zaman çalışmaz?

Kayıt kodu e-postasındaki indirme bağlantısı müşterinin panele girmesini gerektirmez. Kod geçerli olduğu sürece
bağlantı birden çok kez açılabilir; yarıda kalan indirme yeniden başlatılabilir. Bağlantı şu durumlarda çalışmaz ve
"bulunamadı" sayfası gösterir:

- Kayıt kodu kullanıldı (servis kuruldu ve kod girildi).
- Kod iptal edildi.
- Kodun 24 saatlik süresi doldu.
- Müşteri pasife alındı ya da anonimleştirildi.
- Firmanız pasife alındı.
- Gözetimsiz erişim sunucuda kapatıldı.

Sunucudaki servis dosyası hazır değilse "Servis programı şu an indirilemiyor." yazar; daha sonra yeniden deneyin.
Aynı ağdan bir dakikada 20'den fazla deneme yapılırsa bir süre beklemek gerekir.

**"İndirildi" kaydı yalnız bir ipucudur.** Bağlantı açıldığında **Audit log**'a "kayıt kodu indirildi" satırı düşer.
Ancak bu satırı müşteri dışında başkaları da oluşturabilir: kurumsal e-posta güvenlik tarayıcıları (ör. Microsoft
Safe Links, Proofpoint) bağlantıyı müşteri açmadan önce kendileri açar; WhatsApp ve benzeri uygulamalar da bağlantı
önizlemesi için sayfayı çağırabilir. Bu satırı "müşteri dosyayı indirdi" diye kesin kabul etmeyin. Kurulumun asıl
kanıtı, cihazın **Gözetimsiz cihazlar** listesinde görünmesidir. Aynı kod ve aynı ağ için saatte en çok bir kayıt, bir
kod için toplamda en çok 10 kayıt yazılır.

### Gönderim sınırları

| Sınır                                                                                                    | Değer        |
| -------------------------------------------------------------------------------------------------------- | ------------ |
| Oturum bağlantısı, e-posta (kişi başına)                                                                 | Saatte 20    |
| Oturum bağlantısı WhatsApp/SMS + kayıt kodu + müşteri bağlantıları, her kanal (kişi başına, ortak sayaç) | Saatte 20    |
| Aynı alıcıya (firma içinde; oturum e-postası hariç)                                                      | Saatte 5     |
| Firma toplamı (oturum e-postası hariç)                                                                   | Saatte 200   |
| Bir kayıt kodu                                                                                           | En çok 3 kez |

Sınıra gelince **Gönder** düğmesi "Bekleyin (…)" geri sayımını gösterir; süre dolunca yeniden açılır.

### Rolünüze göre

- **Teknisyen (User):** Oturum bağlantısını e-postayla göndermek için "Oturumlar → Oluştur" yetkisi yeter. WhatsApp ve
  SMS için ayrıca "Oturumlar → Müşteriye bağlantı gönder" yetkisi gerekir. Müşteri bağlantılarını göndermek için
  "Müşteriler → Görüntüle" ve "Oturumlar → Müşteriye bağlantı gönder" birlikte gerekir. Teknisyende bu yetki kapalı başlar;
  Admin açar.
- **Admin:** Teknisyenin yapabildiklerine ek olarak, "Gözetimsiz erişim → Yönet" yetkisiyle kendi oluşturduğu kayıt
  kodunu gönderir. Admin'de yetkiler açık başlar. Kullanıcılara bu yetkileri **Kullanıcılar** ekranından verir.
- **Super Admin:** Önce üst menüden bir firma seçmelidir; firma seçmeden gönderim yapılamaz. Firma seçince Admin gibi
  davranır. WhatsApp servisinin ayarı yalnız Super Admin'dedir.

### Sık karşılaşılan mesajlar (Müşteriye gönder)

| Mesaj                                                                    | Ne yapmalı                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Gönderim kanalı yapılandırılmamış.                                       | Admin'den SMTP (e-posta) ya da Super Admin'den WhatsApp servisi ayarını isteyin                   |
| Kanal kullanılamıyor. Başka bir kanal seçin ya da ayarları kontrol edin. | Kanal az önce kapandı; başka kanal seçin                                                          |
| Mesaj gönderilemedi. Daha sonra yeniden deneyin.                         | Gönderim servisi hata verdi. Biraz sonra deneyin; sürerse Admin'e haber verin                     |
| Gönderim sınırına ulaşıldı; süre dolunca yeniden deneyebilirsiniz.       | Geri sayımın bitmesini bekleyin                                                                   |
| Bu kod için gönderim hakkı doldu.                                        | Kod 3 kez gönderildi; gerekirse yeni kod oluşturun                                                |
| Gönderim hedefi artık geçerli değil; diyaloğu kapatın.                   | Oturum başladı/bitti, kod kullanıldı ya da süresi doldu, müşteri pasif. Yeni oturum veya kod açın |
| Bu kanalla gönderme yetkiniz yok.                                        | Admin'den ilgili yetkiyi isteyin                                                                  |
| Alıcı müşterinin kayıtlı bildirim adreslerinden seçilmelidir.            | Kayıt kodunda alıcıyı listeden seçin                                                              |
| Telefonu +90… biçiminde girin. / Geçerli bir e-posta adresi girin.       | Alıcıyı düzeltin                                                                                  |

## Admin için: Kişisel verilerin saklama süresi ve anonimleştirme (KVKK)

Sistem müşterilerin kişisel verilerini süresiz tutmaz. Her gece 03:30'da (Türkiye saati) çalışan **Saklama süresi işi**
süresi dolan verileri kendiliğinden siler veya anonimleştirir. Sizin bir şey yapmanız gerekmez.

**Firmanın saklama süresi:** varsayılan **365 gün**, 90 ile 730 gün arasında olabilir.

**Saklama süresini nasıl değiştiririm?**

1. **Ayarlar** → **Güvenlik** sayfasını açın.
2. **Veri saklama** bölümünde **Veri saklama süresi (gün)** alanına 90 ile 730 arasında bir sayı yazın.
3. Alt çubuktaki **Kaydet**'e basın. "Veri saklama süresi … gün olarak kaydedildi" mesajı çıkar.

- Kaydetmeden sayfadan ayrılmaya çalışırsanız kaydedilmemiş değişiklik uyarısı çıkar.
- Alan pasif (gri) görünüyorsa yalnız görüntüleme yetkiniz vardır (**Ayarlar → Görüntüle**); değiştirmek için
  **Ayarlar → Düzenle** yetkisi gerekir.
- Aralık dışı değerde alanın altında hata yazar ve kayıt yapılmaz.
- Yeni süre bir sonraki gece turunda (03:30) uygulanır. Süreyi kısaltırsanız o gece daha fazla kayıt anonimleşir; geri
  uzatmak silinen bilgiyi geri getirmez.
- Değişiklik audit log'a eski → yeni değerle yazılır.

| Veri                                                    | Ne zaman                                                               | Ne olur                                                                                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bitmiş, süresi dolmuş veya iptal edilmiş destek oturumu | Oluşturulmasından saklama süresi kadar sonra                           | Müşteri adı, e-postası, not, onay kayıtlarındaki IP/tarayıcı ve dosya kayıtları silinir; oturum "Anonimleştirildi" olur (bkz. "Anonimleştirildi rozeti ne demek?") |
| Destek talebi                                           | Saklama süresi dolunca                                                 | Ad, telefon, e-posta ve açıklama silinir                                                                                                                           |
| Pasif müşteri                                           | Pasife alındıktan saklama süresi kadar sonra                           | Yetkili kişi, telefon, e-posta ve not silinir ("Anonimleştirildi")                                                                                                 |
| Kayıtlı bilgisayar                                      | Son kullanımdan saklama süresi kadar sonra                             | Kayıt geçersiz olur; müşteri yeni dosya veya kodla bağlanır                                                                                                        |
| Oturum sohbeti                                          | Oturum anonimleştirilirken                                             | Oturumun bütün sohbet mesajları silinir (bkz. "Oturum sohbeti ve kaydı")                                                                                           |
| Oturum kaydı (görüntü)                                  | Kayıt saklama süresi (1–90 gün) dolunca veya oturum anonimleştirilince | Kayıt dosyaları silinir (bkz. "Oturum kaydı")                                                                                                                      |
| Audit log                                               | 730 gün (firmaya göre değişmez)                                        | Silinir                                                                                                                                                            |
| Giriş oturumları ve şifre sıfırlama bağlantıları        | Süreleri bittikten 7 gün sonra                                         | Silinir                                                                                                                                                            |

- Onay kararları (izin verdi/reddetti) ve onaylanan aydınlatma metninin sürümü KVKK onay kanıtı olarak kalır; kişiyi
  tanıtan bilgi kalmaz.
- Anonimleştirilen oturum, talep ve onay kayıtları ile geçersiz olan bilgisayar kayıtları **30 gün** daha istatistik için
  (süre, sayı, kalite) listede kalır; kişisel veri içermez. Bu sürenin sonunda gece işi onları **kalıcı siler** (sunucu
  yöneticisi bu adımı açtıysa; aşağıdaki nota bakın). Hâlâ kullanılan bir bilgisayar kaydına bağlı oturum silinmez.
  Müşteri kayıtları ve aydınlatma metinleri gece işinde silinmez.
- Kullanıcıları ve firmaları kalıcı silmek için bkz. "Kullanıcıyı kalıcı silme" (Admin) ve "Firmayı kalıcı silme"
  (Super Admin).

**Yedekler ve kalıcı silme**

- **Kalıcı silinen veri sunucu yedeklerinden en geç 14 gün içinde düşer.** Yedekler 14 gün saklanır; sunucu dışındaki
  yedek kopyalarının da en geç 14 günde silinmesi sunucu yöneticisinin aylık kontrol listesindedir (`docs/runbook.md` §23.7).
- Her kalıcı silme (kullanıcı ve firma), kişisel veri içermeyen ayrı bir **imha defterine** de yazılır. Bu defter
  veritabanı yedeğinin dışında tutulur.
- Sunucu bir yedekten geri yüklenirse, sistem kullanıcılara açılmadan önce bu defter yeniden uygulanır: yedekte hâlâ
  duran, ama daha önce kalıcı silinmiş kullanıcılar ve firmalar **yeniden silinir**. Böylece silinen veri geri
  yüklemeyle geri gelmez. Yeniden silme yalnız geri yüklenen veride zaten pasif olan firmaları ve Super Admin olmayan
  kullanıcıları kapsar; defterle uyuşmayan bir kayıt (ör. aktif görünen bir firma) kendiliğinden silinmez, sunucu
  yöneticisi inceler.
- Saklama süresi dolup anonimleştirilen veri de yedekten geri gelirse ilk gece turu onu yeniden anonimleştirir.

**Sunucu yöneticisi için not**

- Gece kalıcı silme adımı sunucu ayarı `RETENTION_PURGE_MODE` ile yönetilir. Varsayılan `dry`'dır: hiçbir satır silinmez,
  yalnız silinecek kayıt sayıları "Saklama süresi işi" audit kaydına yazılır. `on` yapılınca silme başlar. Önerilen:
  ilk hafta `dry` ile sayıları inceleyin, sonra `on` (`docs/runbook.md` §23.1).
- **Yetim dosya taraması:** her pazar 04:30'da (Türkiye saati) yüklenen dosyalar taranır. Hiçbir kayda bağlı olmayan
  dosya (ör. silinmiş kullanıcının kalan resmi) 7 gün sonra silinir; 24 saatten eski yarım yükleme artıkları da temizlenir.
  Sonuç audit log'da "Yetim dosya taraması" olarak görünür. Bağsız dosya oranı çok yüksekse (%20'nin üstü) ya da
  veritabanında hiç dosya kaydı yokken diskte dosya varsa o tur **hiç silme yapılmaz**, kayıt "Başarısız" düşer ve
  alarm üretilir; sunucu yöneticisi inceler (`docs/runbook.md` §23.4).

## Admin için: Kurumsal bilgisayarlarda Hızlı Destek'e izin verme (AppLocker / antivirüs)

Müşterinizin şirketi programların çalışmasını AppLocker, Windows Defender Uygulama Denetimi veya bir antivirüs ile
kısıtlıyorsa Hızlı Destek engellenebilir. Bu bölüm o şirketin BT sorumlusuna iletebileceğiniz rehberdir.

**Bilmeniz gerekenler**

- Hızlı Destek **imzasızdır**. Bu yüzden "yayımcı" (publisher/sertifika) kuralı yazılamaz; **dosya özeti (hash) kuralı**
  kullanılır.
- `Destek-12345678.exe`, `NoktaDestek.exe` ve `NoktaDestek-<firma adı>-….exe` aynı programdır; yalnız adları farklıdır.
  Aynı sürümün hepsinin SHA-256 özeti aynıdır, tek bir hash kuralı hepsini kapsar.
- Program kurulum yapmaz, yönetici izni istemez, hizmet, zamanlanmış görev oluşturmaz, kendini kopyalamaz. Yalnız
  `%LOCALAPPDATA%\NoktaDestek\` klasörüne ayar (`kayitlar.bin`, kilit `kayitlar.lock`; 0.11 ve öncesinde `hatirla.bin`) ve
  tanılama (`tanilama.log`) dosyası yazar; buradan program çalıştırmaz.
- 0.12 ve sonrasında kullanıcı **Windows açılışında başlat** seçeneğini açıkça işaretlerse yalnız o kullanıcının
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` anahtarına `NoktaDestek` = `"<program yolu>" --tray` değeri yazılır;
  program açılışta yalnız tepsi simgesiyle başlar, kullanıcı tıklayana kadar ağa çıkmaz. Program yönetici olarak açıldıysa,
  başka kullanıcıların yazabildiği bir klasörde (ör. `C:\Users\Public`, `%ProgramData%`), ağ/çıkarılabilir sürücüde ya da
  geçici klasörde duruyorsa bu değer yazılmaz. Kurumda istenmiyorsa Grup İlkesi ile kullanıcı `Run` anahtarı kısıtlanabilir;
  program bu durumda tepsisiz, her zamanki gibi çalışır.
- Ağ: yalnız destek sunucusunun adresine HTTPS ile, görüntü aktarımı için de TURN sunucusuna bağlanır. Açılması gereken
  portlar bir sonraki bölümdedir ("Ağ gereksinimleri").

**1. Dosyanın doğru olduğunu doğrulayın (SHA256SUMS)**

1. GitHub sürüm sayfasından ilgili sürümün `SHA256SUMS` dosyasını indirin.
2. İndirilen programın özetini PowerShell ile hesaplayın:
   ```powershell
   Get-FileHash .\Destek-12345678.exe -Algorithm SHA256
   ```
3. Çıkan değer `SHA256SUMS` içindeki `NoktaDestek.exe` satırıyla aynı olmalı. Programın karşılama penceresinin en altındaki
   **Parmak izi**, bu değerin ilk 8 karakteridir. Eşleşmiyorsa dosyayı kullanmayın.

**2a. AppLocker hash kuralı (önerilen)**

1. Grup İlkesi Yönetimi'nde (veya tek bilgisayarda `secpol.msc`) **Uygulama Denetimi İlkeleri → AppLocker →
   Yürütülebilir Kurallar** bölümünü açın.
2. **Yeni Kural Oluştur** → Eylem: **İzin Ver** → Kullanıcı veya grup: destek alacak kullanıcılar (ör. `Everyone`).
3. Koşul: **Dosya karması** (File hash) → doğruladığınız program dosyasını seçin → kuralı kaydedin.
4. İlkeyi dağıtın (`gpupdate /force`) ve programı standart kullanıcıyla açarak deneyin.

**Not (0.22 ve sonrası):** program kendini güncelleyince dosyanın özeti değişir; hash kuralı yeni sürümü engeller ve
program açılmaz. Hash kuralı kullanıyorsanız her sürümde kuralı yeni özetle güncelleyin ya da firmanız için Ayarlar >
İstemciler'den otomatik güncellemeyi kapatıp yeni sürümü kendiniz dağıtın.

**2b. AppLocker yol kuralı (yalnız gerekirse)**

- **İndirilenler** klasörüne yol kuralı yazmayın: kullanıcı oraya her dosyayı koyabildiği için kural her programa izin verir.
- Yol kuralı gerekiyorsa programı yalnız yöneticilerin yazabildiği bir klasöre kopyalayın (ör.
  `C:\Program Files\NoktaDestek\`) ve yalnız o dosyanın tam yoluna izin verin. Firma dosyasını kopyalarken **adını
  değiştirmeyin**; ad, programın hangi firmaya bağlanacağını belirler.

**3. Antivirüs / EDR**

- İstisnayı klasör veya dosya adına göre değil, **SHA-256 özetine** göre tanımlayın (ör. Microsoft Defender for
  Endpoint'te **Göstergeler → Dosya karmaları → İzin ver**).
- `%LOCALAPPDATA%\NoktaDestek\` için istisna gerekmez.

**4. Yeni sürümde**
Program her yeni sürümde değişir ve özeti de değişir. Yeni sürüm yayımlandığında 1. adımı tekrarlayıp kurala yeni özeti
ekleyin; eski sürümün kuralını kaldırın. Eski sürümle bağlanan müşteriye "Bu Hızlı Destek dosyası eski" uyarısı çıkabilir.

Kural yazılamıyorsa müşteri destek sayfasında **Uygulama çalışmıyor mu? Tarayıcıdan yalnızca görüntü paylaş** seçeneğiyle
bağlanabilir (uzaktan kontrol olmadan).

## Admin için: Ağ gereksinimleri (güvenlik duvarı izin listesi)

Müşterinin veya kendi ekibinizin ağında güvenlik duvarı dışarı giden bağlantıları kısıtlıyorsa, ekran görüntüsünün
gelmesi için aşağıdaki çıkışlara izin verilmelidir. Hedef her satırda destek sunucusudur: `remote.noktabilisim.net`.

| Port        | Protokol   | Ne için                                                                   |
| ----------- | ---------- | ------------------------------------------------------------------------- |
| 443         | TCP        | Web konsolu, müşteri sayfası, Hızlı Destek'in sunucuyla konuşması (HTTPS) |
| 3478        | UDP ve TCP | Görüntü aktarımı için bağlantı kurma (STUN/TURN)                          |
| 5349        | TCP        | Görüntü aktarımı, şifreli (TURN-TLS); UDP'nin kapalı olduğu ağlar için    |
| 49160–49479 | UDP        | Görüntü aktarımının aktığı port aralığı (TURN relay)                      |

Bilmeniz gerekenler:

- **Yalnız 443'ün açık olduğu ağlar desteklenmez.** Böyle bir ağda giriş ve sohbet ekranı açılabilir ama görüntü gelmez.
  En azından 5349/TCP'ye izin verilmelidir.
- UDP kapalı, yalnız 443/TCP ve 5349/TCP açık bir ağda bağlantı 5349 üzerinden kurulur. Müşterinin bilgisayarına sertifika
  kurmak gerekmez.
- Tablo bu kılavuzu müşterinin BT sorumlusuna iletmeniz için hazırlanmıştır. Görüntü gelmiyorsa önce "Teknisyen için:
  Müşterinin ekranı gelmiyorsa" bölümüne bakın.

## Çoklu teknisyen (teknisyen, Admin ve müşteri için)

Bir oturuma birden çok teknisyen katılabilir: oturumu açan teknisyen bir arkadaşını yardıma çağırır ya da bir yönetici
süren oturumu izler. Bir oturumda oturumu açan dahil **en çok 3 teknisyen** bulunur.

Bu özellik müşteri tarafında **Hızlı Destek 0.17 ve sonrası**, gözetimsiz cihazlarda **servis 0.17 ve sonrası** ya da
tarayıcıdan katılan müşteri ister. Eski sürümde "Davet et" ve "İzle" pasiftir; tek teknisyenle oturum aynen sürer.

### Roller: kim ne yapabilir?

| Rol                | Görüntü                         | Sohbet        | Kontrol, pano, yazdırma, dosya, işaretleme |
| ------------------ | ------------------------------- | ------------- | ------------------------------------------ |
| **Kontrol sahibi** | Tam kalite                      | Okur ve yazar | Evet                                       |
| **Katılımcı**      | Düşük kalite (en çok 8 kare/sn) | Okur ve yazar | Hayır                                      |
| **İzleyici**       | Düşük kalite (en çok 8 kare/sn) | Yalnız okur   | Hayır                                      |

- **Oturum sahibi** oturumu açan (ya da devralan) teknisyendir; adının yanında "Oturum sahibi" rozeti görünür. Davet etme,
  kontrolü verme, oturumu devretme ve oturumu bitirme yalnız ondadır.
- Başlangıçta kontrol sahibi oturum sahibidir. Kontrolü başkasına verirse ona tam kalite görüntü ve kontrol hakkı geçer.
- Katılımcı ve izleyicinin konsolunda kontrol, pano, yazdırma, dosya ve işaretleme düğmeleri pasiftir: "Yalnız kontrol
  sahibi kullanabilir". İzleyicinin sohbet kutusu yerine "İzleyici olarak sohbete yazamazsınız" yazar.
- Davet edilen teknisyen ve süpervizör (İzle) katıldığı andan önceki sohbet mesajlarını görür (bkz. "Oturum sohbeti ve kaydı").

### Teknisyen için: Oturuma nasıl teknisyen davet ederim?

Bunun için hesabınızda **Teknisyen davet et / devret** yetkisi olmalı ve oturumun sahibi siz olmalısınız.

1. Konsolun üst çubuğunda **Teknisyenler** düğmesine basın (yanındaki sayı oturumdaki teknisyen sayısıdır).
2. Açılan "Oturumdaki teknisyenler" panelinde **Davet et**'e basın.
3. Listeden kişiyi seçin (ada göre arayabilirsiniz). Listede yalnız yetkisi olan, etkin ve bu oturumda olmayan firma
   kullanıcıları görünür.
4. Davet 2 dakika geçerlidir. Panelde kişinin satırında "Davet bekliyor" ve kalan süre görünür.
5. Vazgeçerseniz satırdaki **X** (Daveti geri çek) düğmesine basın.

Bekleyen davet de bir koltuk tutar. Oturumda 3 kişi (bekleyen davet dahil) varsa yeni davet "Oturum dolu" uyarısı verir.

### Teknisyen için: Bana gelen daveti nasıl kabul ederim?

1. Panelin hangi sayfasında olursanız olun, birkaç saniye içinde "<Ad> sizi <müşteri> oturumuna davet ediyor" bildirimi ve
   kalan süreyi gösteren bir kart çıkar.
2. **Katıl**'a basın; oturumun konsolu açılır. Katılmak istemiyorsanız **Reddet**'e basın.
3. Kartta "Gözetimsiz bağlantı" notu varsa katılırken doğrulama kodunuz (2FA) istenir.
4. Katıldıktan sonra 60 saniye içinde konsol açılmazsa yeriniz düşer; yeni davet gerekir.

### Teknisyen için: Süren bir oturumu nasıl izlerim? ("İzle")

Bunun için hesabınızda **Etkin oturumları izle** yetkisi olmalı.

1. **Oturumlar** sayfasını açın. "Firmadaki etkin oturumlar" bölümünde süren oturumlar teknisyen, müşteri, başlangıç saati ve
   teknisyen sayısıyla (ör. 2/3) listelenir. Liste 10 saniyede bir yenilenir.
2. İzlemek istediğiniz satırda **İzle**'ye basın. İzleyici olarak katılırsınız: görüntüyü ve sohbeti görürsünüz, kontrol ve
   dosya işlemi yapamazsınız.
3. Müşteri sizi listesinde "İzleyici" olarak görür. İzleme gizli değildir.
4. Gözetimsiz oturumu izlemek için o cihaza bağlanma yetkiniz olmalıdır; değilse oturum listede hiç görünmez. Gözetimsiz
   oturumda doğrulama kodunuz (2FA) istenir.

İzle düğmesi şu durumlarda pasiftir: oturum dolu ya da müşterinin uygulaması eski. Henüz açılmakta olan bir gözetimsiz
bağlantı listede görünmez.

### Teknisyen için: Kontrolü başka teknisyene nasıl veririm?

1. **Teknisyenler** panelinde katılımcının satırında **Kontrolü ver**'e basın.
2. Sizdeki uzaktan kontrol izni kapanır (görüntüleme kipine döner). Yeni kontrol sahibi müşteriden izni kendisi ister;
   müşterinin ekranındaki diyalog ve gösterge yeni teknisyenin adını gösterir.
3. Geri almak için kendi satırınızda **Kontrolü geri al**'a basın.

İzleyiciye kontrol verilemez. Kontrol sahibi oturumdan ayrılır ya da bağlantısı koparsa kontrol oturum sahibine döner.

### Teknisyen için: Oturumu başka teknisyene nasıl devrederim?

1. **Teknisyenler** panelinde katılımcının satırında **Oturumu devret**'e basın.
2. Onay penceresinde "Oturum <ad> adlı teknisyene devredilsin mi?" sorusunu onaylayın.
3. Oturumun sahibi o kişi olur; siz katılımcı olarak kalırsınız ve **Oturumdan ayrıl** ile çıkabilirsiniz.

Oturum geçmişinde tüm katılımcılar ve devir zamanı görünür. Devirden sonra oturum yeni sahibin oturumlarında listelenir;
yalnız kendi oturumlarını görebilen teknisyen devrettiği oturumu artık görmez.

Devretmeden ayrılan ya da bağlantısı 120 saniye dönmeyen oturum sahibinin oturumu biter; diğer teknisyenler de düşer.

### Teknisyen için: Oturumdan nasıl ayrılırım?

Oturum sahibi değilseniz **Teknisyenler** panelinde **Oturumdan ayrıl**'a basın ve onaylayın. Oturum diğer teknisyenlerle
sürer; yeniden katılmak için yeni davet gerekir. Bağlantınız koparsa 120 saniye içinde dönerseniz yerinizi korursunuz.

### Müşteri için: Oturumda kimler var? Bir teknisyeni nasıl çıkarırım?

1. Hızlı Destek penceresinde (ya da tarayıcıdaki destek sayfasında) **Bağlı teknisyenler** listesi her teknisyenin adını ve
   rolünü (Kontrol sahibi / Katılımcı / İzleyici) gösterir. Yeni biri katıldığında kısa bir bildirim çıkar.
2. Bir teknisyenin ekranınızı görmesini istemiyorsanız satırındaki **Çıkar** düğmesine basın.
3. Onay penceresinde çıkarmayı onaylayın (varsayılan seçim "Vazgeç"tir). Çıkarılan teknisyen ekranınızı artık göremez ve bu
   oturuma yeniden katılamaz.

Oturumu açan teknisyenin (oturum sahibi) yanında "Çıkar" yoktur; onunla görüşmeyi bitirmek için oturumu kapatın.

### Müşteri BT için: Gözetimsiz cihazda birden çok teknisyen

- Bağlantı göstergesi bağlı tüm teknisyenlerin adlarını yazar. Adı göstergeye yazılamayan teknisyenin görüntüsü başlamaz.
- Gözetimsiz cihazda "Çıkar" düğmesi yoktur; bağlantıyı yerel anahtarla ("Gözetimsiz erişimi kapat") kapatabilirsiniz.

### Admin için: Davet ve izleme yetkilerini nasıl veririm?

**Kullanıcılar** → kullanıcı → yetkiler ekranında **Oturumlar** grubunda iki yeni anahtar vardır:

| Anahtar (ekrandaki ad)                              | Ne sağlar                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| **Teknisyen davet et / devret** (`sessions.invite`) | Kendi oturumuna teknisyen davet eder, kontrolü ve oturumu devreder |
| **Etkin oturumları izle** (`sessions.supervise`)    | Firmadaki süren oturumları izleyici olarak izler                   |

- Admin rolünde ikisi de açık, User (teknisyen) rolünde kapalı başlar.
- **Etkin oturumları izle hassas bir yetkidir; yalnız gerçekten gerekene verin.** İzleyen kişi müşterinin ekranını görür.
- Davet edilecek kişide en az **Oturumlar → Görüntüle** yetkisi olmalıdır.
- Gözetimsiz oturuma katılmak için ayrıca **Gözetimsiz erişim → Bağlan** yetkisi ve o cihaz için teknisyen yetkisi gerekir.
- Bir yetkiyi kapattığınızda ya da kullanıcıyı pasife aldığınızda o kişi katıldığı oturumdan birkaç saniye içinde (en geç
  60 saniyede) çıkarılır; oturum diğerleriyle sürer.

### Geçmiş ve audit log'da çoklu teknisyen

- **Oturum geçmişi** ayrıntısında "Katılımcılar" bölümü: ad, rol (Oturum sahibi / Katılımcı / İzleyici), katılma ve ayrılma
  saati, devir zamanı; müşterinin çıkardığı kişide "Müşteri çıkardı".
- **Audit log**'da "Çoklu teknisyen" grubu: Teknisyen davet edildi, Davet kabul edildi, Davet reddedildi, Davet düştü,
  Teknisyen katıldı, Teknisyen ayrıldı, Müşteri teknisyeni çıkardı, Süpervizör izlemeye başladı, Kontrol devredildi,
  Oturum devredildi. Sohbet içeriği yazılmaz.

### Sık karşılaşılan mesajlar (Çoklu teknisyen)

| Mesaj                                                                                    | Anlamı / ne yapmalı                                                                          |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| "Oturum dolu"                                                                            | 3 koltuk dolu (bekleyen davet dahil). Bir davet geri çekilmeli ya da bir teknisyen ayrılmalı |
| "Davet artık geçerli değil"                                                              | 2 dakika doldu, davet geri çekildi ya da oturum bitti. Yeni davet isteyin                    |
| "Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin"    | Müşteri Hızlı Destek'i (ya da cihaz servisini) 0.17'ye güncellemeli                          |
| "Bu gözetimsiz bağlantıya ek teknisyen katılamaz"                                        | Gözetimsiz bağlantı henüz açılıyor ya da eski sürümde kullanıcı onayıyla açılmış; bekleyin   |
| "Önce 2FA kurun"                                                                         | Gözetimsiz oturuma katılmak için Hesabım > Güvenlik'ten iki adımlı doğrulamayı kurun         |
| "Oturumdan çıkarıldınız: müşteri sizi çıkardı ya da bu oturum için yetkiniz kaldırıldı." | Bu oturuma yeniden giremezsiniz; gerekiyorsa yöneticinize başvurun                           |
| "Davet edilebilecek kullanıcı yok"                                                       | Firmada yetkisi olan, etkin ve oturumda olmayan kullanıcı yok                                |

## Oturum sohbeti ve kaydı (teknisyen, Admin, Super Admin ve müşteri için)

Destek oturumundaki sohbet **her zaman kaydedilir**. Bu ayar kapatılamaz. Bilmeniz gerekenler:

- Mesajlar sunucu üzerinden iletilir ve sunucuda şifrelenerek saklanır. Sohbet **uçtan uca şifreli değildir**: hizmeti
  veren sunucu mesaj içeriğini okuyabilir. Canlı ekran görüntüsü, uzaktan kontrol ve doğrudan dosya aktarımı ise uçtan uca
  şifreli kalır.
- Mesajlar firmanın **oturum saklama süresi** kadar saklanır (bkz. "Kişisel verilerin saklama süresi ve anonimleştirme").
  Ayrı bir sohbet saklama süresi yoktur. Oturum anonimleştirilirken o oturumun sohbeti silinir.
- **Sohbete şifre veya kart bilgisi yazmayın.** Bu kural müşteri için de teknisyen için de geçerlidir. Şifre gerekiyorsa
  telefonda söyleyin ya da müşteriden kendisinin yazmasını isteyin.
- Mesaj en çok **1.000 karakter** ve 20 satır olabilir. Saniyede en çok 5 mesaj gönderilir (bkz. "Sohbette 'Çok hızlı
  yazıyorsunuz' uyarısı").
- **Gözetimsiz bağlantıda sohbet yoktur.** Konsolun sohbet sekmesinde "Gözetimsiz bağlantıda sohbet yoktur." yazar.

### Müşteri için: Sohbet kaydedilir mi?

Evet. Tarayıcıdan bağlanırken onay düğmesinin hemen üstünde "Sohbet mesajları kayıt altına alınır ve N gün saklanır"
satırı yazar (N, firmanın saklama süresidir). Bu satır görünmüyorsa bağlanma düğmesi pasif kalır; sayfayı yenileyin.
Aydınlatma metninde de sohbetin sunucuda saklandığı ve uçtan uca şifreli olmadığı yazar.

Oturum sırasında sohbet bölümünün başlığında aynı saklama satırı tekrar görünür. Sayfayı yenilediyseniz gün sayısı yerine
genel cümle görünebilir.

Hızlı Destek programında (Windows, macOS ve Linux, 0.21 ve sonrası) aynı satır karşılama penceresinde **Bağlan**'ın,
talep formunda (Windows; Mac 0.24 ve sonrası) **Destek iste**'nin hemen üstünde yazar. Satırın yerinde "Sunucu güncel değil; lütfen daha sonra
deneyin" yazıyorsa düğme pasif kalır: firmanın sunucusu henüz güncellenmemiştir. Teknisyeninizi ya da firmanızı arayın.

### Müşteri için: Hızlı Destek'te oturum sohbeti (0.21 ve sonrası)

Hızlı Destek 0.21 ve sonrasında oturum penceresinde **Sohbet** bölümü vardır. Başlığın yanında "Sohbet kayıt altına
alınır" yazar.

1. Alttaki kutuya mesajınızı yazın.
2. **Gönder**'e ya da Enter'a basın. Mesajınız önce "Siz (gönderiliyor…)" başlığıyla görünür; sunucu kaydedince "Siz"
   olur.
3. Teknisyenin mesajları "[SS:DD] Teknisyen <ad>:" başlığıyla görünür. Mesajlar düz metin gösterilir.

Dosya sonucu, virüs taraması ve sesli görüşme gibi program bildirimleri sohbetin altında ayrı satırlar olarak durur.

| Sohbetin altında gördüğünüz    | Anlamı / ne yapmalı                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Sohbet şu an kullanılamıyor    | Bağlantı yeniden kuruluyor, oturum bitti ya da sunucu sohbeti açmadı. Yazma kutusu pasiftir; bekleyin      |
| Siz (gönderiliyor…)            | Mesaj sunucuya gidiyor. Bağlantı koptuysa yeniden bağlanınca kendiliğinden gönderilir                      |
| Gönderilemedi — tekrar deneyin | Mesaj kaydedilmedi; metin yazma kutusuna geri konur. **Gönder**'e yeniden basın; mesaj iki kez kaydedilmez |
| Çok hızlı yazıyorsunuz         | Saniyede en çok 5 mesaj gönderilir. Bir saniye bekleyip yeniden gönderin                                   |

- Uzun oturumda yalnız son mesajlar gösterilir; eski mesajlar teknisyenin oturum geçmişinde durur.
- Gözetimsiz bağlantıda sohbet yoktur.

### Müşteri için: Hızlı Destek'te "Bu sürümde sohbet kapalıdır" yazıyor

Bilgisayarınızdaki Hızlı Destek programı (Windows, macOS ya da Linux, 0.20 ve öncesi) eski sohbet yolunu kullanır. Sohbet
kaydedilmeden yapılamayacağı için bu sürümlerde oturum sohbeti **kapalıdır**. Sohbet penceresinde teknisyenin konsolundan
şu sabit mesaj gelir:

> Bu sürümde sohbet kapalıdır. Yazdıklarınız teknisyene gösterilmez ve kaydedilmez; lütfen sohbet için programı güncelleyin.

Ne yapmalı:

- Yazdıklarınız teknisyene ulaşmaz. Teknisyeninizle **telefonda** konuşun.
- Kalıcı çözüm: programın yeni sürümünü (0.21 ve sonrası) firmanızın destek sayfasından indirin. Yeni sürümde sohbet
  açıktır ve bu mesaj çıkmaz.
- Görüntü, uzaktan kontrol, dosya, pano, yazdırma, sesli görüşme ve kayıt etkilenmez; oturuma devam edebilirsiniz.
- Sohbet gerekiyorsa ekranınızı **tarayıcıdan** paylaşın: tarayıcı modunda sohbet tam çalışır.
- 0.21 ve önceki programlar kendiliğinden güncellenmez (tepside çalışan ya da firmaya kayıtlı olsa da). Firmanızın destek
  sayfasından programı bir kez yeniden indirin; 0.22 ve sonrası kendini günceller.
- Beklerken yapılan talep sohbeti ("Beklerken teknisyenle nasıl yazışırım?") bundan etkilenmez.

### Teknisyen için: Konsolda sohbet

- Sohbet sekmesinin başlığı altında "Sohbet kayıt altına alınır ve oturum saklama süresi boyunca saklanır." notu durur.
- Mesajınızı yazıp **Enter**'a basın (yeni satır için **Shift+Enter**). Sayaç "n / 1.000" gösterir.
- Mesaj sunucuya ulaşana kadar "Gönderiliyor…" yazar. Ulaşmazsa "Gönderilemedi." ve **Tekrar dene** çıkar. Tekrar dene
  aynı mesajı bir kez daha gönderir; mesaj iki kez kaydedilmez.
- Oturum bitince "Sohbet kapandı; mesajlar salt okunur." yazar.
- Müşteri Hızlı Destek 0.21 ve sonrasını kullanıyorsa sohbet tarayıcı müşterisindeki gibi çalışır. 0.20 ve öncesinde konsol
  "Müşterinin istemcisi eski…" der; müşteriden programı destek sayfasından yeniden indirmesini isteyin.
- Uzun oturumda yalnız son mesajlar gelir ve "Daha eski mesajlar oturum geçmişinde." yazar. Tamamını oturum geçmişinde
  görürsünüz.
- İzleyici olarak katıldıysanız sohbeti okursunuz, yazamazsınız ("İzleyici olarak sohbete yazamazsınız").
- **Süpervizör ve davet edilen teknisyen katıldığı andan önceki sohbet mesajlarını görür.** Bu bilgi audit log'a
  "Katılan teknisyene önceki sohbet mesajları gösterildi" olarak yazılır (yalnız mesaj sayısı; içerik yazılmaz).

| Konsolda gördüğünüz                                            | Anlamı / ne yapmalı                                                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Müşterinin istemcisi eski; sohbet için güncellemesi gerekir." | Müşteri Hızlı Destek 0.20 veya öncesini kullanıyor. Sohbet iki tarafta kapalı, giriş pasif. Müşteriyle telefonda konuşun ya da müşteriyi tarayıcı moduna yönlendirin |
| "Sohbet şu an kullanılamıyor."                                 | Sunucu sohbeti başlatamadı. Sayfayı yenileyin; sürerse sistem yöneticisine bildirin                                                                                  |
| "Gözetimsiz bağlantıda sohbet yoktur."                         | Gözetimsiz bağlantılarda sohbet bulunmaz                                                                                                                             |
| Başlıkta ve rozette "Konsol sürümü eski"                       | Bu sekme sistem güncellenmeden önce açılmış. Oturum sürüyor; **Sayfayı yenile**'ye basın, konsol yeni sürümle yeniden bağlanır                                       |
| "Gönderilemedi." + Tekrar dene                                 | Ağ kesintisi, hız sınırı ya da oturum bitti. Bir saniye bekleyip **Tekrar dene**'ye basın                                                                            |
| Mesajlar gönderilmiyor, oturumda çok mesaj var                 | Bir oturumda kişi başına 2.000, toplam 10.000 mesaj sınırı vardır. Sınır dolduysa yeni mesaj kaydedilmez; telefonla devam edin                                       |

**Teknisyen davranış kuralı:** Müşterinin programı eskiyse sohbet kapalıdır. Bu durumda müşteriyle sohbeti başka bir yoldan
(tarayıcı araçları, eski sekme vb.) kaydı atlayarak sürdürmeye çalışmayın. Kayıtsız yazışma firma politikasına ve KVKK
bilgilendirmesine aykırıdır. Telefonu ya da tarayıcı modunu kullanın. Eski istemcili oturumlar audit log'da "Müşteri
istemcisi eski — sohbet kapalı" olarak işaretlenir.

### Teknisyen ve Admin için: Oturum geçmişinde sohbeti görme

Bunun için **Oturum geçmişi → Görüntüle** ve **Oturumlar → Sohbet geçmişini görüntüle** (`sessions.view_chat`) yetkileri
gerekir. Teknisyen (User) yalnız **kendi** oturumlarının sohbetini görür; Admin firmasındaki tüm oturumların, Super Admin
seçtiği firmanın.

1. **Oturum geçmişi**'nde oturumu açın.
2. Ayrıntıda **Sohbet** bölümünü bulun. Bölüm kapalı gelir; altında "Sohbeti açmanız denetim kaydına yazılır." yazar.
3. **Sohbeti göster (N mesaj)**'a basın.
4. İki başlık görünür:
   - **Talep yazışması (kabul öncesi):** oturum bir destek talebinden doğduysa, talep kabul edilmeden önceki yazışma.
   - **Oturum sohbeti:** oturum sırasındaki mesajlar. Fazlası varsa **Daha fazla**'ya basın.

Bölümde görebileceğiniz durumlar:

| Görünen                                                             | Anlamı                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------- |
| "Bu oturumda sohbet yok" / "Kabul öncesi yazışma yok"               | Hiç mesaj yazılmamış                                            |
| "Müşteri eski istemci kullandığı için bu oturumda sohbet kapalıydı" | Müşteri Hızlı Destek 0.20 veya öncesiyle bağlandı               |
| "Sohbet saklama süresi dolduğu için silindi"                        | Oturum anonimleştirildi; sohbet silindi                         |
| "Mesaj okunamadı"                                                   | Mesaj çözülemedi (anahtar sorunu). Sistem yöneticisine bildirin |
| Sohbet bölümü hiç yok                                               | Hesabınızda `sessions.view_chat` yetkisi yok                    |

- Sohbeti açmak audit log'a **"Oturum sohbeti görüntülendi"** olarak yazılır (kim, hangi oturum, kaç mesaj; içerik
  yazılmaz). Aynı kişi aynı oturumu 10 dakika içinde tekrar açarsa yeni kayıt yazılmaz.
- Süren oturumda konsoldaki sohbeti görmek ek yetki istemez; oturuma katılma hakkı yeterlidir.

### Admin için: Sohbet geçmişi yetkisini nasıl veririm?

**Kullanıcılar** → kullanıcı → yetkiler ekranında **Oturumlar** grubunda **Sohbet geçmişini görüntüle**
(`sessions.view_chat`) anahtarı vardır.

- Admin rolünde açık, User (teknisyen) rolünde kapalı başlar.
- **Hassas bir yetkidir; yalnız gerçekten gerekene verin.** Sohbette müşterinin kişisel bilgileri bulunabilir.
- Teknisyene verirseniz yalnız kendi oturumlarının sohbetini görür.
- Kendinizde olmayan bir yetkiyi başkasına veremezsiniz. Her değişiklik audit log'a yazılır.

### Admin için: Aydınlatma metninde sohbet paragrafı

Sistemin hazır aydınlatma metni, sohbetin sunucuda şifreli saklandığını, uçtan uca şifreli olmadığını ve ne kadar
saklandığını anlatan bir paragraf içerir. Hazır metni kullanan firmalarda bu paragraf güncellemeyle kendiliğinden yeni sürüm
olarak eklenir; bir şey yapmanız gerekmez.

Metni **siz yazdıysanız** sistem ona dokunmaz. Metninizde paragraf yoksa:

1. **Ayarlar → Aydınlatma metni** sayfasında sarı bant çıkar: "Metniniz sohbetin sunucuda saklandığını ve uçtan uca şifreli
   olmadığını belirtmiyor (KVKK). Standart paragrafı ekleyip kaydedin."
2. **Standart sohbet paragrafını ekle**'ye basın. Paragraf metin kutusunun sonuna eklenir; henüz kaydedilmez.
3. Gerekirse düzenleyin, sonra **Yeni sürüm olarak kaydet** ile kaydedin. Bant kalkar.

Aynı bant **Ayarlar → Genel** sayfasının üstünde de görünür (yalnız **Ayarlar → Düzenle** yetkisi olanlara);
**Aydınlatma metnine git** sizi doğrudan ayara götürür. Paragraf eklenince iki bant da kalkar.

### Super Admin için

- Super Admin sohbeti yalnız firma seçtikten sonra, o firmanın oturum geçmişinde görür. Kurallar Admin ile aynıdır;
  görüntüleme audit log'a yazılır.
- Aydınlatma metni güncellemesi sistem güncellemesiyle (seed) yayımlanır. Metni Admin tarafından değiştirilmiş firmalar bu
  güncellemeyi almaz; bu firmaların Admin'leri yukarıdaki bandı görür.

### Audit log'da sohbet

**Audit log**'da şu kayıtlar bulunur; hiçbirinde mesaj içeriği yoktur:

| Kayıt                                                 | Ne zaman                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| Oturum sohbeti görüntülendi                           | Biri oturum geçmişinde **Sohbeti göster**'e bastı (mesaj sayılarıyla) |
| Oturum sohbeti özeti                                  | Oturum bitti; teknisyen ve müşteri mesaj sayıları                     |
| Sohbet mesajı reddedildi                              | Mesaj sınırı doldu, yetkisiz gönderim ya da sunucu hatası             |
| Müşteri istemcisi eski — sohbet kapalı                | Müşteri 0.20 veya öncesi programla kabul edildi                       |
| Katılan teknisyene önceki sohbet mesajları gösterildi | Davetli teknisyen ya da süpervizör katıldı ve önceki mesajları gördü  |

## Sesli görüşme (teknisyen, Admin ve müşteri için)

Teknisyen süren bir destek oturumunda müşteriyle sesli konuşabilir; telefonla ayrıca aramaya gerek kalmaz. Özet:

- Görüşmeyi her zaman **teknisyen ister**, müşteri **Kabul et** ya da **Reddet** der. Müşterinin mikrofonu yalnız müşterinin
  kendi "Kabul et" tıklamasıyla açılır.
- Ses doğrudan bilgisayarlar arasında şifreli akar. **Ses hiçbir yerde kaydedilmez**; oturum kaydı açık olsa da kayda ses
  girmez.
- Müşteri tarafında **tarayıcı** ya da **Hızlı Destek 0.18 ve sonrası** gerekir. Eski sürümde düğme pasiftir: "Müşterinin
  uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin".
- **Hızlı Destek macOS'ta sesli görüşme 0.26 ve sonrasında vardır.** Daha eski Mac uygulamasında düğme aynı iletiyle
  pasiftir; müşteri güncel uygulamayı indirir. Mac müşterisinin adımları: "Sesli görüşme (Mac)".
- **Gözetimsiz oturumda sesli görüşme yoktur** (bilgisayar başında kimse yokken mikrofon açılmaz). Konsolda "Gözetimsiz
  oturumda sesli görüşme yapılamaz" yazar.
- Yankı olmaması için iki tarafa da kulaklık önerilir.

### Teknisyen için: Sesli görüşmeyi nasıl başlatırım?

1. Konsolun üst çubuğunda **Sesli görüşme** düğmesine basın.
2. Tarayıcı ilk kez mikrofon izni sorarsa **İzin ver** deyin. İzin vermezseniz istek gönderilmez.
3. Düğmenin yerinde "Yanıt bekleniyor" ve kalan süre görünür. Müşterinin yanıt için **60 saniyesi** vardır.
4. Müşteri kabul edince "Mikrofon açık" göstergesi çıkar; artık konuşabilirsiniz.

Görüşme sırasında:

- **Sessize al**: sesiniz gitmez, gösterge "Sessizde" olur. Yeniden konuşmak için **Mikrofonu aç**.
- **Görüşmeyi bitir**: görüşme herkes için biter, mikrofonlar kapanır. Bitince "Sesli görüşme bitti" ve süre görünür.
- Bağlantı kalite panelinde görüşme sürerken **ses kaybı** oranı da gösterilir.
- Tarayıcı sesi kendiliğinden başlatmazsa **Sesi aç** düğmesi çıkar; basınca karşı tarafı duyarsınız.

### Teknisyen için: Birden çok teknisyen varsa kim konuşur, kim dinler?

- Görüşmeyi isteyen teknisyen **konuşan** olarak başlar.
- Oturumdaki diğer teknisyen (sahip ya da katılımcı) **Görüşmeye katıl** ile konuşanlara eklenir.
- **İzleyici** konuşamaz. "Sesli görüşme" yetkisi varsa görüşmeyi otomatik dinler ("Dinleniyor"); yetkisi yoksa
  "Sesli görüşme sürüyor — dinleme yetkiniz yok" yazar.
- Müşteri ekranında konuşanların ve dinleyenlerin adı görünür; yeni bir dinleyici katılınca müşteriye duyurulur.
- Aynı anda tek görüşme olur. Başka bir teknisyenin isteği bekliyorsa "Başka bir teknisyen sesli görüşme istedi" yazar.

### Teknisyen için: Hak ve bekleme kuralları

- Müşteri reddederse, 60 saniye içinde yanıt vermezse, görüşmeyi kendisi bitirirse ya da mikrofonu açılamazsa **30 saniye**
  sonra yeniden isteyebilirsiniz.
- Bir oturumda en çok **10** görüşme isteği gönderilebilir.

### Müşteri için: Tarayıcıda sesli görüşme

1. Teknisyen istediğinde "<Ad> sesli görüşme istiyor" penceresi açılır. Pencerede kimlerin dinleyeceği de yazar.
2. Yanlışlıkla onay olmasın diye düğmeler **1,5 saniye** sonra etkinleşir; seçili düğme **Reddet**'tir.
3. **Kabul et**'e basın. Tarayıcı mikrofon izni sorarsa **İzin ver** deyin.
4. Sayfada görüşme çubuğu çıkar: "Mikrofon açık", "Konuşan: …", varsa "Dinleyen: …".
5. **Sessize al** ile sesinizi kesebilir, **Mikrofonu aç** ile açabilirsiniz.
6. **Görüşmeyi bitir** ile görüşmeyi istediğiniz an kapatırsınız; mikrofonunuz hemen kapanır.

Yeni biri dinlemeye başlarsa "<Ad> görüşmeyi dinlemeye başladı" uyarısı çıkar. İstemediğiniz teknisyeni **Bağlı
teknisyenler** listesinden **Çıkar** ile oturumdan çıkarabilirsiniz.

### Müşteri için: Hızlı Destek (Windows) ile sesli görüşme

Akış tarayıcıdakiyle aynıdır; ek olarak:

- İstek penceresinde düğmeler 1,5 saniye kilitlidir. **Kabul et** yalnız sizin farenizle ya da klavyenizle çalışır;
  teknisyen uzaktan kontrolle sizin yerinize kabul edemez.
- Oturum penceresinde ses satırı görünür: "● Mikrofon açık · Konuşan: … · Dinleyen: …", **Sessize al** / **Mikrofonu aç**
  ve **Görüşmeyi bitir**. **Mikrofonu aç** da yalnız sizin girdinizle çalışır.
- Mikrofon açık olduğu sürece her ekranın üstünde bir **gösterge şeridi** durur. Pencereyi küçültseniz de görünür.
  Şeride tıklanmaz; görüşmeyi düğmeyle ya da tepsiden bitirin.
- Tepsi simgesinin ipucu "Nokta Destek — Mikrofon açık" ya da "Sessizde" olur. Tepsi menüsünde **Görüşmeyi bitir** vardır.
- Yeni biri dinlemeye başlarsa tepside "Görüşmeye yeni bir dinleyici katıldı" balonu çıkar; adı sohbette yazar.
- Tepsi menüsündeki **Lisanslar**, programın kullandığı açık kaynak bileşenlerin lisans metinlerini gösterir.

### Admin için: Sesli görüşme yetkisini nasıl veririm?

**Kullanıcılar** → kullanıcı → yetkiler ekranında **Oturumlar** grubunda **Sesli görüşme** (`sessions.voice`) anahtarı
vardır: "Etkin oturumda müşteriyle sesli görüşme başlatır, katılır ve görüşmeyi dinler."

- Admin rolünde açık, User (teknisyen) rolünde kapalı başlar.
- Anahtar kapalıysa konsolda düğme görünmez; sunucu da isteği reddeder ("Sesli görüşme yetkiniz yok.").
- İzleyicinin görüşmeyi dinleyebilmesi de bu yetkiye bağlıdır.

### Super Admin için

Ayrı bir ses ayarı yoktur. Super Admin, seçtiği firmada Admin ile aynı yetki ve audit ekranlarını kullanır.

### Geçmiş ve audit log'da sesli görüşme

- **Audit log**'da "Sesli görüşme" grubu: Sesli görüşme istendi, Müşteri sesli görüşmeyi kabul etti, Sesli görüşme kurulmadı
  (nedeniyle: Müşteri reddetti / Müşteri yanıt vermedi / Müşterinin bağlantısı koptu), Teknisyen sesli görüşmeye katıldı,
  Sesli görüşme bitti (süre, bitiş nedeni, konuşan ve dinleyen kullanıcılar).
- **Oturum geçmişi** zaman çizelgesinde aynı olaylar neden ve süreyle görünür.
- Ses içeriği ve mikrofon aygıtının adı hiçbir yere yazılmaz.

### Sık karşılaşılan mesajlar (sesli görüşme)

| Mesaj                                                                                                                  | Anlamı / ne yapmalı                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Mikrofon izni verilmedi — adres çubuğundaki site ayarlarından mikrofona izin verip tekrar deneyin" (teknisyen)        | Tarayıcının site ayarlarından mikrofona izin verin, düğmeye yeniden basın                                                                             |
| "Mikrofonunuz açılamadı. Mikrofonun bağlı olduğunu ve tarayıcıya izin verdiğinizi kontrol edin; …" (müşteri, tarayıcı) | Mikrofonu takın, tarayıcıda izin verin; teknisyen yeniden ister                                                                                       |
| "Mikrofonunuz açılamadı. … Ayarlar > Gizlilik ve güvenlik > Mikrofon …" (müşteri, Windows)                             | Windows ayarında "Masaüstü uygulamalarının mikrofonunuza erişmesine izin verin" seçeneğini açın; teknisyen yeniden ister                              |
| "Mikrofonunuz açılamadı. Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon …" (müşteri, Mac 0.26+)                     | Mac'te Mikrofon listesinde Nokta Destek'i açın; teknisyen yeniden ister (bkz. "Sesli görüşme (Mac)")                                                  |
| "Sesli görüşme başlatılamadı; mikrofonunuz kapatıldı. Teknisyen yeniden isteyebilir." (müşteri)                        | Kabul ettiniz ama görüşme 5 saniye içinde başlamadı; güvenlik için mikrofon kapatıldı. Tarayıcıda ve Windows'ta aynı metin. Teknisyen yeniden istesin |
| "Müşterinin mikrofonu açılamadı — 30 sn sonra tekrar deneyebilirsiniz" (teknisyen)                                     | Müşteriden mikrofonunu ve iznini kontrol etmesini isteyin                                                                                             |
| "Müşteri reddetti / Müşteri yanıt vermedi — 30 sn sonra tekrar deneyebilirsiniz"                                       | 30 saniye bekleyin; müşteriyle sohbetten konuşun                                                                                                      |
| "Şu anda başka bir sesli görüşme isteği var"                                                                           | Bu oturumda bekleyen bir istek var; sonucu bekleyin                                                                                                   |
| "Bu oturumda sesli görüşme isteği sınırına ulaşıldı."                                                                  | Oturumdaki 10 istek hakkı doldu                                                                                                                       |
| "Gözetimsiz oturumda sesli görüşme yapılamaz"                                                                          | Bu tür oturumda ses yoktur                                                                                                                            |
| "Sesli görüşme yetkiniz yok."                                                                                          | Yöneticinizden **Sesli görüşme** yetkisini isteyin                                                                                                    |

## Oturum kaydı (Admin, teknisyen, müşteri ve müşteri BT için)

Oturum kaydı, destek oturumunda müşterinin ekranından gelen **görüntüyü** saklar. Sonradan "o gün ne yapıldı?" sorusunu
cevaplamak, şikâyeti incelemek veya eğitim için kullanılır. Özet:

- Varsayılan **kapalıdır**. Firmanın Admin'i **Ayarlar > Oturum kaydı**'ndan açar.
- Katılımlı oturumda (kod, bağlantı, destek talebi) kayıt yalnız **müşteri izin kutusunu işaretlerse** alınır. Kutu
  varsayılan olarak işaretsizdir.
- Gözetimsiz bağlantılarda kayıt müşteri izniyle değil **firma politikasıyla** alınır ("Gözetimsiz bağlantıları da kaydet").
- **Ses kaydedilmez.** Yalnız görüntü saklanır.
- Kayıt sürerken müşteri ekranında ve teknisyen konsolunda **"Kayıt yapılıyor"** göstergesi görünür.
- Kayıt sunucuda **şifreli** saklanır, seçilen süre (1–90 gün) dolunca kendiliğinden silinir.
- Kaydı yalnız yetkili kişiler panelde izler. İndirme düğmesi ve indirme adresi yoktur. Her izleme ve izlenen miktar
  denetim kaydına yazılır.

**Kaydı kim alır?** Kaydı teknisyenin tarayıcısındaki konsol alır ve sunucuya yükler. Yani kayıt, **teknisyen tarafına ulaşan
görüntüdür**. Teknisyenin bağlantısı koptuğu sürede kayıtta boşluk oluşur. Kayıt bu yüzden "müşterinin bilgisayarında olan
her şey"in değil, "teknisyenin gördüğü"nün kanıtıdır.

**Neler mümkün değil?** Kaydın izlenmesi engellenemeyen bir ekran görüntüsü/ekran kaydı programıyla veya ağ trafiğini
yakalayarak kopyalanması teknik olarak önlenemez. Bu yüzden izleme yetkisini yalnız gereken kişilere verin; her izleme kim
izledi, ne kadar izledi bilgisiyle kayıt altındadır.

### Admin için: Oturum kaydını nasıl açarım?

**Ayarlar > Oturum kaydı** sekmesi (kamera simgesi). Görmek için **Ayarlar → Görüntüle**, değiştirmek için **Ayarlar →
Düzenle** yetkisi gerekir.

1. **Ayarlar > Aydınlatma metni**'ni açın ve müşterilere gösterilen metne oturum kaydını ekleyin (kayıt kişisel veri
   işler; ne kaydedildiği, ne kadar saklandığı, kimin izlediği yazılmalı).
2. **Ayarlar > Oturum kaydı**'nı açın.
3. **Oturum kaydı** anahtarını **Açık** yapın. Altında "Açıkken müşteri onay ekranında ayrı, işaretsiz bir kayıt izni
   kutusu görür. Ses kaydedilmez." yazar.
4. Çıkan **Aydınlatma metnimi bu değişikliği kapsayacak şekilde güncelledim** kutusunu işaretleyin. İşaretlemeden
   kaydederseniz "Açmadan önce aydınlatma metnini güncellediğinizi onaylayın" hatası çıkar.
5. **Kayıt saklama süresi (gün)** alanına 1–90 arası bir sayı yazın (varsayılan 30).
6. Alt çubuktaki **Kaydet**'e basın. "Oturum kaydı ayarları kaydedildi" yazar.

- Ayar kaydedildiği andan sonra açılan onay ekranlarında geçerli olur.
- Sekmede "Kaydı teknisyenin tarayıcısı alır. Safari kayıt alamaz; teknisyenler Chrome, Edge veya Firefox kullanmalıdır."
  notu durur. Teknisyenlerinize bunu iletin.
- Kaydetmeden sayfadan ayrılmaya çalışırsanız "Kaydedilmemiş değişiklikler var" uyarısı çıkar.
- Her değişiklik denetim kaydına "Oturum kaydı ayarı değişti" olarak eski → yeni değerle yazılır; aydınlatma onayı da
  bu kayda eklenir.

**Kapatmak için** anahtarı **Kapalı** yapıp kaydedin. Onay kutusu istenmez. O an süren kayıtlar hemen durur (konsolda
"Firma kayıt ayarı kapatıldı, kayıt durdu"). Ana anahtar kapanınca **Gözetimsiz bağlantıları da kaydet** de kendiliğinden
kapanır. Daha önce alınmış kayıtlar silinmez; süreleri dolunca silinir.

### Admin için: Saklama süresi

- **Kayıt saklama süresi (gün)** 1–90 gündür. Alanın altında "firma oturum saklama süresini aşamaz" yazar; aşarsa "Kayıt
  saklama süresi firma oturum saklama süresini aşamaz" hatası çıkar.
- Her kaydın silinme tarihi kayıt **başladığı anda** belirlenir ve oturum geçmişinde "Silinme tarihi" olarak görünür.
- **Süreyi kısaltmak mevcut kayıtlara uygulanmaz.** Alanın altında da "Yeni süre yalnız bundan sonraki kayıtlara
  uygulanır." yazar. Örnek: süreyi 90'dan 7 güne indirirseniz önceki kayıtlar yine 90 gün sonra silinir. Bir kaydı daha
  erken silmek için oturum geçmişinden **Kaydı sil**'i kullanın (aşağıda).
- Süresi dolan kayıtlar her gece 03:30'da (Türkiye saati) silinir. Süren bir kayıt, süresi dolsa bile oturum bitene kadar
  silinmez.
- Oturum anonimleştirildiğinde (bkz. "Admin için: Kişisel verilerin saklama süresi ve anonimleştirme") ve firma kalıcı
  silindiğinde kayıtları da silinir.
- **Kayıtlar yedeğe alınmaz.** Sunucu diski kaybolursa kayıtlar geri getirilemez.

### Admin için: Depolama kotası

Kayıtlar, sunucu üzerinden aktarılan dosyalarla **aynı firma kotasını** kullanır (yeni firmada varsayılan 20 GB; kotayı
Super Admin değiştirir). Sekmenin **Depolama** bölümünde "Kullanım: x / y" çubuğu dosyalar ve kayıtların toplamını
gösterir.

- Kota doluysa müşterinin onay ekranında kayıt kutusu **hiç çıkmaz**; oturum kayıtsız sürer.
- Kayıt sürerken kota dolarsa kayıt durur, konsolda "Depolama kotası doldu, kayıt durdu" yazar. O ana kadarki kısım
  saklanır.
- Sunucu diskinde boş alan %10'un altına inerse kota dolmamış olsa da kayıt başlamaz, süren kayıt durur.
- Kabaca bir saatlik kayıt 0,6–0,7 GB yer tutar (ekran içeriğine göre değişir). Yer açmak için eski kayıtları silebilir veya
  Super Admin'den kota artışı isteyebilirsiniz.

### Admin için: Gözetimsiz bağlantıları da kaydet

Bu anahtar açıkken her gözetimsiz bağlantı müşteriye sorulmadan,
**firma politikası** dayanağıyla kaydedilir. Bu yüzden açmak ek adımlar ister.

1. Önce **Oturum kaydı** anahtarı açık ve kaydedilmiş olmalı. Değilse anahtarın altında "Önce oturum kaydını açın" yazar.
2. **Gözetimsiz bağlantıları da kaydet** anahtarını **Açık** yapın. Altında "Açıkken her gözetimsiz bağlantı firma
   politikasıyla kaydedilir; cihaz göstergesinde "Kayıt yapılıyor" yazar." açıklaması durur.
3. "Açmak için bilgilendirmeyi onaylayın; kaydederken kimliğiniz yeniden doğrulanır." notunun altındaki kutuyu işaretleyin:
   **Cihaz kullanıcılarını (çalışanları) bağlantıların kaydedilebileceği konusunda yazılı olarak bilgilendirdik; aydınlatma
   metnimiz bunu kapsıyor**. İşaretlemeden kaydederseniz "Açmak için bilgilendirme kutusunu işaretleyin" hatası çıkar.
4. **Kaydet**'e basın. Son 5 dakikada kimliğinizi doğrulamadıysanız 2FA kodu sorulur. Hesabınızda 2FA kurulu değilse
   anahtar açılamaz; önce Hesabım'dan 2FA'yı kurun.

- Kutunun son onaylandığı an "Çalışan bilgilendirmesi son onay: <tarih>" olarak görünür.
- **Dört göz e-postası:** anahtar açılınca da kapanınca da (ana anahtarı kapatmak dahil) "Gözetimsiz bağlantı kayıt
  politikası değişti" konulu bir e-posta gider. Alıcılar, firmanızda **Gözetimsiz erişim → Yönet** yetkisi olan **diğer**
  kişilerdir; böylece değişikliği başka biri de görür. Böyle biri yoksa e-posta işlemi yapan kişiye ve firmanın
  Admin'lerine gider. E-posta için firmanın SMTP ayarı çalışıyor olmalıdır.
- **Tek yönetici uyarısı:** e-postayı alacak başka yönetici yoksa sekmede "Politika değişikliği e-postası yalnız size
  gider; en az iki yönetici tanımlayın" uyarısı çıkar. Dört göz denetiminin işlemesi için ikinci bir yöneticiye
  **Gözetimsiz erişim → Yönet** yetkisi verin.
- Kapatmak step-up istemez. Kapatınca süren gözetimsiz kayıtlar hemen durur.
- Kayıt yalnız servisi **0.16.0 veya sonrası** olan cihazlarda alınır. Eski servisli cihaza bağlanınca konsolda "Cihaz
  istemcisi eski; kayıt için 0.16.0 gerekli" uyarısı çıkar ve o bağlantı kaydedilmez.

### Admin için: Kaydı izleme ve silme yetkileri

| İş            | Gereken yetki (Kullanıcılar ekranındaki anahtar)                                | Kapsam                                                 |
| ------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Kaydı izleme  | **Oturum geçmişi → Görüntüle** ve **Oturumlar → Kayıtları izle**                | Teknisyen yalnız kendi oturumlarını, Admin tüm firmayı |
| Kaydı silme   | **Oturum geçmişi → Düzenle**                                                    | Aynı                                                   |
| Ayarı görme   | **Ayarlar → Görüntüle**                                                         | Firma                                                  |
| Ayarı değişme | **Ayarlar → Düzenle** (gözetimsiz anahtarı açarken ayrıca 2FA ile kimlik onayı) | Firma                                                  |

**Oturumlar → Kayıtları izle** anahtarının açıklaması "Oturum kayıtlarını izler (hassas — yalnız gerekene verin)."
şeklindedir. Admin rolünde açık, teknisyende (User) kapalı başlar. İzleme yetkisi kaldırılırsa açık oynatıcı bir sonraki
parçada durur.

### Teknisyen için: Kayıt sırasında konsolda ne görürüm?

- Kayıt başlayınca konsolun üst şeridinde **"Kayıt yapılıyor"** rozeti çıkar. Oturumdaki tüm teknisyenler görür.
- **Kaydı teknisyen başlatmaz ve durduramaz.** Konsolda kayıt düğmesi yoktur. Müşteri izin verdiyse kayıt ilk görüntüyle
  kendiliğinden başlar; müşteri izin vermediyse kayıt alınmaz.
- Kayıt durunca rozet kalkar ve nedeni yazar:

| Konsolda görünen                         | Anlamı                                                               |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Müşteri kayıt iznini geri aldı           | Müşteri **Kaydı durdur**'a bastı; kayıt bu oturumda yeniden başlamaz |
| Depolama kotası doldu, kayıt durdu       | Firma kotası doldu; Admin'e bildirin                                 |
| Oturum bitti, kayıt durdu                | Oturum kapandı                                                       |
| Firma kayıt ayarı kapatıldı, kayıt durdu | Admin ayarı kapattı                                                  |
| Kayıt durdu (hata)                       | Tarayıcı kaydı sürdüremedi veya yükleme uzun süre başarısız oldu     |
| Bu firmada oturum kaydı kapalı           | Müşteri izin verdi ama firma ayarı o sırada kapalıydı                |

- **Tarayıcınız:** kaydı konsolun açık olduğu tarayıcı alır. Chrome, Edge veya Firefox kullanın. **Safari'de kayıt
  alınamaz**; konsolda "Bu tarayıcı oturum kaydını desteklemiyor; Chrome, Edge veya Firefox kullanın" yazar ve o oturum
  kaydedilmez.
- **Konsolu açık tutun.** Konsol sekmesi arka planda olabilir ama kapatılmamalıdır. Bağlantınız koparsa kayıt devam eder;
  geri dönünce kaldığı yerden sürer, aradaki süre kayıtta boşluk olarak görünür. Konsol 2 dakika içinde geri gelmezse veya
  görüntü aktığı hâlde 30 saniye boyunca kayıt parçası yüklenmezse kayıt "Kayıt durdu (hata)" ile kapanır ve bu denetim
  kaydına yazılır.
- Kota doluysa müşteriye kutu gösterilmez; kayıt sürerken dolarsa kayıt durur (yukarıdaki tablo).
- **Gözetimsiz bağlantıda** firma politikası açıksa bağlantı başından itibaren kaydedilir; aynı rozet görünür. Cihazın
  servisi eskiyse "Cihaz istemcisi eski; kayıt için 0.16.0 gerekli" uyarısı çıkar.

### Müşteri için: Kayıt izni nasıl verilir?

Destek firmanız oturum kaydını açtıysa onay ekranında, aydınlatma metninin altında **ayrı bir kutu** görürsünüz:

> ☐ Oturumun görüntü kaydının alınmasına izin veriyorum

- Kutu **işaretsiz** gelir. İşaretlemezseniz oturum **kaydedilmez**; destek normal şekilde sürer.
- Tarayıcıda kutunun altında "İsteğe bağlıdır. İşaretlemezseniz oturum kaydedilmez. Ses kaydedilmez; kaydı istediğiniz an
  durdurabilirsiniz." yazar.
- Aynı kutu bağlantı koduyla katılırken, bağlantıdan açılan onay ekranında, Hızlı Destek'teki **Destek iste** formunda ve
  tarayıcıdaki web talep formunda çıkar.
- Kutu çıkmıyorsa firmanız kaydı açmamıştır ya da firmanın kayıt alanı doludur; oturum kaydedilmez.
- Windows uygulamasında kutu **Hızlı Destek 0.16.0** ve sonrasında çıkar. Eski sürümde kutu yoktur ve kayıt yapılmaz.
- Kayıtta **ses yoktur**. Yalnız ekran görüntüsü kaydedilir.

### Müşteri için: Kayıt sürerken ne görürüm, nasıl durdururum?

**Tarayıcıda:**

- Paylaşım şeridinde **"Kayıt yapılıyor"** göstergesi ve **Kaydı durdur** düğmesi görünür. Altında "Durdurulan kayıt bu
  oturumda yeniden başlamaz." yazar. Gösterge kapatılamaz.
- Kayıt sürerken tarayıcı sekmesinin başlığı "● Kayıt — " ile başlar.

**Windows uygulamasında (Hızlı Destek):**

- Oturum penceresinde **"● Kayıt yapılıyor"** göstergesi ve **Kaydı durdur** düğmesi vardır. "Durdurulan kayıt bu oturumda
  yeniden başlatılamaz." notu yazar.
- Pencereyi küçültseniz de ekranın üstünde her zaman üstte duran küçük bir şerit kalır: **"● Kayıt yapılıyor — durdurmak
  için tıklayın"**. Şeride tıklamak da kaydı durdurur.

**Kaydı durdurmak:**

1. **Kaydı durdur**'a (veya Windows'ta şeride) basın. Onay sorulmaz.
2. Kayıt genellikle 2 saniye içinde durur. Tarayıcıda "Kayıt durduruldu; o ana kadarki kısım saklanır" yazar.
3. Durdurmak **geri alınamaz**: aynı oturumda kayıt yeniden başlamaz. Ekran paylaşımı ve destek sürer.

- O ana kadar kaydedilen kısım silinmez; firmanın saklama süresi dolunca silinir. Silinmesini istiyorsanız destek
  firmanıza başvurun.
- Bağlantınız o anda kopuksa ve durdurma 2 saniye içinde onaylanamazsa ekran paylaşımı kendiliğinden **duraklar** ve "Kayıt
  durdurulamadı, paylaşım duraklatıldı" yazar. Bağlantı dönünce durdurma isteği ilk iş olarak iletilir; kayıt durunca
  paylaşım kendiliğinden devam eder.

### Müşteri BT için: Gözetimsiz bağlantı kaydı

Destek firması "Gözetimsiz bağlantıları da kaydet" politikasını açtıysa (ve servis 0.16.0 veya sonrasıysa):

- **Gösterge:** kenardaki bağlantı yazısının sonuna **" — Kayıt yapılıyor"** eklenir (ör. "Uzaktan bağlantı: <teknisyen
  adı> — <destek firması> — Kayıt yapılıyor"). Ek çizilemezse bağlantı açılmaz. Kayıt ortada durursa ek kalkar.
- **Durdurma:** cihaz kullanıcısına **Kaydı durdur** düğmesi verilmez; kayıt firma politikasıyla alınır. Kaydı durdurmanın
  tek yolu tepsi menüsünden veya ayar penceresinden **Gözetimsiz erişimi kapat**'tır. Bu, bağlantıyı tamamen sonlandırır
  (bkz. "Müşteri BT için: bağlantıyı nasıl anlarım, nasıl kapatırım?").
- Ses kaydedilmez.

### Oturum geçmişinde kayıt

**Listede:** **Kayıt** sütununda kamera simgesi, kaydı olan oturumu gösterir. Yalnız kayıtlı oturumları görmek için
filtrelerdeki **Kayıt** seçicisinde **Kayıtlı**'yı seçin.

**Oturum ayrıntısında** **Oturum kaydı** bölümü çıkar (kaydı olmayan oturumda bu bölüm görünmez):

| Alan           | Anlamı                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Durum          | **Kayıt sürüyor** veya **Durdu**                                                                |
| Süre / Boyut   | Kaydedilen görüntünün toplam süresi ve kapladığı yer                                            |
| Dayanak        | **Müşteri rızası** (katılımlı oturum) veya **Firma politikası** (gözetimsiz bağlantı)           |
| Bağlantı kipi  | Yalnız gözetimsiz kayıtta: Onaysız (eski kayıtlarda Kullanıcı onayıyla (eski) / İzinsiz (eski)) |
| Gerekçe        | Yalnız eski "İzinsiz (eski)" kayıtlarda, teknisyenin o zaman yazdığı gerekçe                    |
| Silinme tarihi | Kaydın kendiliğinden silineceği tarih                                                           |

**Kaydı nasıl izlerim?**

1. **Oturum geçmişi**'nde oturumu açın.
2. **Oturum kaydı** bölümünde **Kaydı izle**'ye basın. Oynatıcı aynı sayfada açılır.
3. **Oynat** / **Duraklat**, **5 sn geri** / **5 sn ileri** düğmelerini ve konum çubuğunu kullanın. Klavye: Boşluk
   oynat/duraklat, ← / → 5 sn.
4. İşiniz bitince **Oynatıcıyı kapat**.

- **Kaydı izle** düğmesi yoksa "Kaydı izleme yetkiniz yok." yazar; yetki için yukarıdaki tabloya bakın.
- Zaman çizgisindeki **taralı alanlar** kaydın olmadığı aralıklardır (bağlantı kopması vb.); oynatma bunları atlar.
- "Yükleniyor… (izleme hızı sınırı, kısa süre bekleniyor)" yazarsa çok hızlı ileri sarılmıştır; oynatıcı kısa süre bekleyip
  kendiliğinden sürer.
- Uzun süre işlem yapmazsanız "İzleme süresi doldu." yazar; **Devam et**'e basın.
- "Bu tarayıcı kaydı oynatamıyor. Chrome, Edge veya Firefox kullanın." yazarsa başka tarayıcı kullanın.
- Oynatıcıda **indirme düğmesi yoktur**. Her izleme denetim kaydına "Oturum kaydı izlendi" olarak, izleme bitince de
  ne kadarının izlendiği "Kayıt izleme özeti" olarak yazılır.

**Kaydı nasıl silerim?** (**Oturum geçmişi → Düzenle** yetkisi gerekir)

1. Oturum ayrıntısındaki **Oturum kaydı** bölümünde **Kaydı sil**'e basın.
2. "Kayıt silinsin mi?" penceresinde "Kayıt kalıcı olarak silinir ve geri alınamaz. Oturum geçmişi kalır." yazar.
   **Kaydı kalıcı sil**'e basın (vazgeçmek için **Vazgeç**).
3. "Kayıt silindi" yazar.

- Süren oturumun kaydı silinemez: "Oturum sürerken kayıt silinemez". Oturum bitince tekrar deneyin.
- Silme 2FA istemez; denetim kaydına "Oturum kaydı silindi" olarak yazılır. Denetim kaydı silinmez.
- Silinmiş kaydın yerinde nedeni yazar: "Kayıt silindi — süresi doldu", "Kayıt silindi — elle silindi" veya "Kayıt silindi —
  kayıt dosyası bulunamadı" (sunucudaki dosyalar kaybolduysa; sistem yöneticisine bildirin).

### Denetim kaydı (Audit log)

Kayıt olaylarını **Audit log** ekranında **İşlem** filtresinin **Kayıt** grubuyla bulursunuz. Görüntünün içeriği hiçbir
denetim kaydına yazılmaz.

| Görünen ad                                   | Ne zaman                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Oturum kaydı başladı                         | Kayıt açıldı (dayanak: müşteri rızası / firma politikası). "Başarısız" ise kayıt açılamadı (ör. kota dolu) |
| Oturum kaydı durdu                           | Her durma; neden (müşteri durdurdu, kota, oturum bitti, hata, ayar kapatıldı), süre ve boyutla             |
| Oturum kaydı izlendi                         | Biri **Kaydı izle**'ye bastı                                                                               |
| Kayıt izleme özeti                           | İzleme bitti; kaç parça ve ne kadar veri izlendiği                                                         |
| Oturum kaydı silindi                         | Elle silindi veya sunucuda dosyası bulunamadı                                                              |
| Saklama süresi dolan kayıtlar silindi        | Gece 03:30 turu; firma başına kaç kayıt silindiği                                                          |
| Oturum kaydı ayarı değişti                   | **Ayarlar > Oturum kaydı** değişti (eski → yeni)                                                           |
| Gözetimsiz bağlantı kayıt politikası değişti | Kayıt politikası dört göz e-postası gönderim denemesi (Gözetimsiz erişim grubunda)                         |

### Sık karşılaşılan mesajlar (Oturum kaydı)

| Mesaj                                                                        | Anlamı / ne yapılır                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Açmadan önce aydınlatma metnini güncellediğinizi onaylayın                   | Oturum kaydını açarken aydınlatma kutusunu işaretleyin                    |
| Önce oturum kaydını açın                                                     | Gözetimsiz kayıt için önce ana anahtarı açıp kaydedin                     |
| Açmak için bilgilendirme kutusunu işaretleyin                                | Gözetimsiz kaydı açarken çalışan bilgilendirme kutusunu işaretleyin       |
| Kayıt saklama süresi firma oturum saklama süresini aşamaz                    | Daha kısa bir süre girin                                                  |
| Bu tarayıcı oturum kaydını desteklemiyor; Chrome, Edge veya Firefox kullanın | Teknisyen Safari'de; kayıt alınmaz                                        |
| Cihaz istemcisi eski; kayıt için 0.16.0 gerekli                              | Cihazdaki servisi güncelleyin                                             |
| Kayıt durdurulamadı, paylaşım duraklatıldı                                   | Müşterinin bağlantısı kopuk; bağlantı dönünce kayıt durur, paylaşım sürer |
| Oturum sürerken kayıt silinemez                                              | Oturum bitince silin                                                      |
| Kaydı izleme yetkiniz yok.                                                   | Admin'den **Oturumlar → Kayıtları izle** yetkisi isteyin                  |

## Gözetimsiz erişim (Admin, teknisyen ve müşteri BT için)

Gözetimsiz erişim, başında kimse olmayan müşteri bilgisayarlarına (sunucu, kiosk, kasa bilgisayarı vb.) bağlanmanızı
sağlar. Müşteri bilgisayarına bir kez **Nokta Destek — Gözetimsiz Erişim** servisi (`NoktaDestekServis.exe`) kurulur;
sonra yetkili teknisyen panelden **Bağlan** der. Bağlantı **cihaz kullanıcısına sorulmadan** açılır: bilgisayarda oturum
açık olsa da, kilitli olsa da, kimse giriş yapmamış olsa da onay penceresi çıkmaz. Amaç sunucu ve personel
bilgisayarlarına destek ve müdahaledir. Teknisyen ekranı görür, kontrolü hemen alır (fare ve klavye), cihaza dosya
gönderebilir. Bu güç nedeniyle her bağlantı ek kimlik doğrulaması ister, müşteriye e-postayla bildirilir ve cihazda
kapatılamayan bir gösterge çıkar.

**Gizli izleme yoktur.** Bağlantı süresince cihazda "Uzaktan bağlantı" göstergesi her zaman görünür; gösterge çizilemezse
bağlantı hiç açılmaz. Cihaz kullanıcısı bağlantıyı yerel kapatma anahtarıyla ("Gözetimsiz erişimi kapat") istediği an
sonlandırabilir. Firmanın çalışanlarını bilgilendirme sorumluluğu için bkz. "Admin için: KVKK — çalışanları bilgilendirme".

### Önce: firmanızın SMTP ayarı zorunlu

Gözetimsiz erişim, **firmanızın kendi SMTP (e-posta) ayarı kaydedilmeden kullanılamaz**: kayıt kodu üretilemez, kayıtlı
cihaza bağlanılamaz. Sistemin genel bir e-posta sunucusuna geri dönülmez. Bu durumda **Bağlan** ve **Kayıt kodu oluştur**
düğmeleri pasiftir, üzerlerine gelince şu neden görünür:

> Bildirim e-postası yapılandırılmamış — Ayarlar → SMTP

Ne yapmalı: **Ayarlar → E-posta (SMTP)**'de ayarı kaydedin ve **Test Maili Gönder** ile deneyin (bkz. "Admin için: Ayarlar >
E-posta (SMTP)").

- SMTP kaydı silinirse kayıtlı cihazlar silinmez; yalnız yeni bağlantı açılamaz, süren bağlantı devam eder. SMTP yeniden
  kaydedilince bağlantı hemen mümkün olur.
- E-posta sunucusu geçici olarak yanıt vermezse bağlantı yine açılır; cihazda **Son bildirim gönderilemedi** rozeti çıkar.
  SMTP test düğmesiyle sorunu kontrol edin.
- Firmanızda kayıtlı en az bir gözetimsiz cihaz varken SMTP ayarını değiştirmek "Kimliğinizi doğrulayın" penceresi açar.
  Eski bir SMTP ayarı kayıtlıysa, kayıttan önce firmanızdaki diğer yöneticilere eski ayarla bilgi e-postası gider. Eski ayar
  yoksa ya da bilgilendirilecek başka yönetici yoksa e-posta gitmez. E-posta gönderilemese de yeni ayar kaydedilir; sonuç audit
  log'daki ayar değişikliği kaydında görünür.
- Müşteri onaylı normal destek oturumları bu koşuldan etkilenmez.

### Kim ne yapar?

| Rol / yetki                                      | Yapabildikleri                                                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gözetimsiz erişim → Yönet** (Admin varsayılan) | Tüm cihazları görür, kayıt kodu üretir ve iptal eder, bildirim adreslerini düzenler, teknisyen yetkisi verir, cihazı iptal eder, servis programını indirir     |
| **Gözetimsiz erişim → Bağlan**                   | Yalnız kendisine **cihaz yetkisi** verilmiş cihazları görür ve bağlanır                                                                                        |
| Super Admin                                      | Üst menüden bir firma seçerek o firmanın cihazlarını yönetir. Kendisine cihaz yetkisi verilemez, bu yüzden bağlanamaz; bağlanacak kişi firmanın kullanıcısıdır |

Yetkiler Kullanıcılar → kullanıcı → yetki listesinde **Gözetimsiz erişim** grubundadır. Grupta yalnız **Yönet** ve
**Bağlan** vardır; eski "İzin istemeden bağlan" yetkisi kaldırıldı (kullanıcıda kalmışsa etkisizdir, kullanıcı bir sonraki
kaydedilişinde silinir). "Bağlan" yetkisi tek başına yetmez: Admin dahil herkes, bağlanmak için o cihazda ayrıca yetkili
olmalıdır. Yeni kayıtlı cihazda **kimsenin** yetkisi yoktur.

### Admin için: ilk kurulum sırası

1. **Ayarlar → E-posta (SMTP):** kaydedin ve test maili gönderin.
2. **Müşteriler → müşteri → Gözetimsiz bildirim adresleri:** en az bir e-posta adresi ekleyin.
3. **Gözetimsiz cihazlar → Kayıt kodları → Kayıt kodu oluştur:** müşteriyi seçin, kodu kopyalayın.
4. Müşteri bilgisayarına servisi kurun ve kodu girin (bkz. "Müşteri BT için: servisi kurma").
5. **Gözetimsiz cihazlar → cihaz → Teknisyen yetkileri:** müşteriyle kaydı doğrulayın, bağlanacak teknisyenleri açın, kaydedin.

### Admin için: müşteri bildirim adresleri

Her gözetimsiz bağlantı başladığında bu adreslere e-posta gider (cihaz adı, teknisyen, destek firması, başlangıç saati).

1. **Müşteriler** → müşteriye tıklayın → **Gözetimsiz bildirim adresleri** bölümü.
2. **Adres ekle** ile en çok 5 e-posta girin. Telefon isteğe bağlıdır; firmanızda SMS veya WhatsApp bildirimi açıksa
   bağlantı bildirimi o numaraya da gider.
3. **Kaydet** → "Kimliğinizi doğrulayın" penceresinde kodunuzu girin.

- Adres listesi değişince **eski ve yeni** adreslerin hepsine "bildirim adresleri değişti" e-postası gider (maskeli fark,
  değiştiren kişi, saat). Böylece müşteri haberi olmadan adresinin çıkarıldığını görür.
- Adres yokken bu müşterinin cihazlarına bağlanılamaz ve kayıt kodu üretilemez.

### Admin için: kayıt kodu oluşturma

1. Kenar çubuğu → **Gözetimsiz cihazlar** → **Kayıt kodları** sekmesi → **Kayıt kodu oluştur**.
2. Müşteriyi seçin → **Kodu oluştur**. "Kimliğinizi doğrulayın" penceresi açılabilir.
3. Kod `ABCD-1234-EFGH-5678` biçiminde **yalnız bir kez** gösterilir. Kopyalayın veya not edin. Kodu ve servis
   kurulum bağlantısını müşterinin bildirim adresine e-postayla iletmek için aynı penceredeki **Müşteriye gönder**'i
   kullanın (en çok 3 kez; ayrıntı "Teknisyen ve Admin için: Müşteriye gönder" bölümü). Pencere kapanınca kod yeniden
   gönderilemez.
4. Aynı pencerede **Servis programını indir** ile `NoktaDestekServis.exe`'yi indirin ve kısa yönergeyi uygulayın:
   1. Servis programını müşteri bilgisayarında yönetici hesabıyla çalıştırıp kurun.
   2. Kurulum penceresine bu kayıt kodunu girin.
   3. Cihaz listede "Yeni — doğrulanmadı" olarak görünür; müşteriyle doğrulayıp teknisyen yetkisi verin.
   4. Oturumdaki kullanıcı yöneticiyse teknisyen yönetici onayı (UAC) verebilir; standart kullanıcı hesabı önerilir.

   Sunucu kod imzası olmayan servisle çalışıyorsa (canlı ortamda risk kabulüyle) indirme düğmesinin altında şu not çıkar:
   **"Windows 'Bilinmeyen yayıncı' gösterebilir; SHA-256: 1a2b3c4d…5e6f7a8b"**. Notun üzerine gelince özetin 64
   karakterlik tamamı görünür. Servisi müşteri bilgisayarında kendiniz kuruyorsanız çalıştırmadan önce dosyanın özetini
   bu değerle karşılaştırın (adımlar: "Müşteri BT için: servisi kurma" → "Çalıştırmadan önce dosyayı doğrulayın").
   Windows "Bilinmeyen yayımcı" uyarısı bu durumda beklenen davranıştır. İndirdiğiniz dosyayı müşteriye e-posta eki ya da
   mesajla **göndermeyin**: müşteriye giden kayıt kodu e-postası "Size başka yoldan gönderilen dosyayı çalıştırmayın" der.
   Müşteri dosyayı kayıt kodu e-postasındaki bağlantıdan indirir.

Kod **24 saat** geçerlidir ve tek kullanımlıktır. Kullanılmamış kodlar listede görünür (kodun kendisi değil; müşteri,
oluşturan, geçerlilik sonu); gerekmiyorsa **İptal et** ile geçersiz kılın. Kullanılan veya süresi dolan kodlar listeden düşer.

Yeni cihaz kaydolunca müşterinin bildirim adreslerine ("yeni cihaz kaydedildi": cihaz adı, IP, saat) ve firmanızdaki
gözetimsiz erişim yöneticilerine e-posta gider. Siz başlatmadığınız bir kayıt görürseniz cihazı hemen iptal edin.

### Admin için: teknisyen yetkisi verme

1. **Gözetimsiz cihazlar** → cihaz adına tıklayın.
2. **Teknisyen yetkileri** bölümünün üstünde "Bu cihaz <tarih> tarihinde <IP> adresinden kaydedildi — müşteriyle
   doğruladınız mı?" satırı vardır. Kaydın gerçekten müşterinizce yapıldığını doğrulayın.
3. Bağlanacak teknisyenlerin anahtarını açın (**Tümünü kapat** hepsini kapatır) → **Kaydet**. Yeni yetki eklemek
   "Kimliğinizi doğrulayın" ister.

- Listede yalnız firmanızın etkin ve **Bağlan** yetkisi olan kullanıcıları görünür.
- İlk yetki kaydedilince **Yeni — doğrulanmadı** rozeti kalkar.
- Yetkisi kaldırılan teknisyenin açık bağlantısı en geç 5 saniyede kesilir.
- Kendinize yetki verirseniz firmanızdaki diğer yöneticilere bilgi e-postası gider.
- Her değişiklik audit log'a "kim, kime, eski → yeni" olarak yazılır.

### Cihaz listesi ve rozetler

**Gözetimsiz cihazlar → Cihazlar** sekmesinde arama (cihaz veya müşteri adı), müşteri ve durum (Tümü / Çevrimiçi /
Çevrimdışı) süzgeçleri vardır. Tabloda cihaz, müşteri, durum rozetleri, **Kullanıcı** sütunu, son görülme, son bağlantı
ve yetkili teknisyen sayısı görünür. Liste 8 saniyede bir kendiliğinden yenilenir.

**Kullanıcı sütunu** cihazda o an Windows oturumunun durumunu gösterir: **Aktif** (oturum açık, kilitsiz), **Kilitli**,
**Oturum yok** ya da **—** (cihaz çevrimdışı veya servisi güncel değil). Durum yalnız **cihaz yetkiniz olan** cihazlarda
görünür; hiçbir dışa aktarıma ve audit log'a yazılmaz. Bu bilgi bağlantı yokken de görünür; çalışanın bilgisayar başında
olup olmadığını gösterdiği için kişisel veridir. Durum yalnız bilgidir; bağlantı davranışını değiştirmez. Firmanızın
aydınlatma metni bunu da kapsamalıdır (bkz. "Admin için: KVKK — çalışanları bilgilendirme").

| Rozet                                      | Anlamı ve yapılacak                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Çevrimiçi / Çevrimdışı                     | Servis sunucuya bağlı mı. Yeniden başlatılan cihaz en geç 2 dakikada çevrimiçi olur                                                                          |
| Yerel olarak kapalı                        | Müşteri cihazda gözetimsiz erişimi kapattı. Panelden açılamaz; müşterinin bilgisayar yöneticisi açar                                                         |
| İzinli sürüm değil                         | Cihazdaki servis sürümü sunucunun izin verdiği sürümler arasında değil; bağlanılamaz. Servisi güncelleyin ya da sunucu yöneticinize başvurun                 |
| Yeni — doğrulanmadı                        | Henüz kimseye yetki verilmedi. Kaydı müşteriyle doğrulayıp yetki verin                                                                                       |
| Son bildirim gönderilemedi                 | Son bağlantı e-postası müşteriye ulaşmadı. SMTP ayarını test edin; sonraki başarılı bildirimde rozet kalkar                                                  |
| Anahtar başka yerden kullanılıyor olabilir | Cihaz 10 dakikada 3'ten fazla kez yeniden bağlandı; cihaz kimliği kopyalanmış olabilir. Müşteriyle kontrol edin, şüphe varsa cihazı iptal edip yeniden kurun |
| Servis güncel değil                        | Cihazdaki servis onaysız tek yolu bilmeyen eski bir sürüm (0.19 ve öncesi). **Bağlan** pasiftir; servisi güncelleyin (bkz. "Eski servis: güncel değil")      |

Teknisyende liste yalnız yetkili olduğu cihazları gösterir; hiç yoksa "Size yetki verilmiş cihaz yok" yazar.

### Teknisyen için: cihaza nasıl bağlanırım?

1. **Gözetimsiz cihazlar** → cihaz satırında **Bağlan**. **Bağlan: <cihaz adı>** penceresi açılır. Pencerede "Cihaz
   kullanıcısı" satırında güncel durum (Aktif / Kilitli / Oturum yok; yalnız bilgi) ve şu bilgi satırı vardır: "Bağlantı
   cihaz kullanıcısına sorulmadan açılır. Cihazda bağlantı göstergesi görünür." Seçilecek kutu veya yazılacak gerekçe yoktur.
2. **Bağlan**'a basın.
3. "Kimliğinizi doğrulayın" penceresinde uygulamadaki kodu (ya da bir kurtarma kodunu) girin.
4. Konsol açılır; kısa süre "Cihaz bağlanıyor…" yazar, ardından ekran gelir. Konsol kontrolü **kendiliğinden** ister ve
   cihaz hemen verir: ek tıklama olmadan ekranı görür, fare ve klavyeyi kullanırsınız. Başlıkta **Gözetimsiz** rozeti ve
   cihaz adı vardır. Müşteri onaylı oturumdaki doğrulama kodu ve oturum kodu burada yoktur; kimseye kod söylemeniz gerekmez.
5. Kontrolü **Kontrolü bırak** ile bırakıp **Kontrole devam** ile yeniden alabilirsiniz; cihazda onay sorulmaz (düğmenin
   altındaki "müşteri yeniden onaylamalı" notu gözetimsiz bağlantıda geçerli değildir). Dosya gönderebilirsiniz; dosya
   cihazda `C:\ProgramData\NoktaDestek Servis\Gelen\` klasörüne düşer. Cihazın ekranına çizim yapabilirsiniz (bkz.
   "Teknisyen için: gözetimsiz cihazın ekranına çizim"). Cihazdan dosya çekme ve sohbet yoktur. Pano paylaşımı ve uzaktan
   yazdırma da yoktur; konsolda "Gözetimsiz oturumda kullanılamaz — müşteri onayı gerekir" yazar.
6. Bitirmek için oturumu normal şekilde sonlandırın.

- Kontrolün kendiliğinden alınması için hesabınızda uzaktan kontrol yetkisi olmalı ve konsolun kontrol sahibi siz
  olmalısınız. Çok teknisyenli oturumda sonradan katılan ya da kontrolü devralan teknisyen kontrolü kendisi ister.
- **Kod her bağlantıda yeniden sorulur.** Bir doğrulama tek bağlantı açar; "Bu cihazı 30 gün hatırla" bunu atlatmaz.
  Bağlandıktan sonra aynı oturumda başka bir kritik ayar değiştirirseniz kod yeniden sorulur.
- Kurtarma koduyla bağlanırsanız size "Kurtarma kodunuz kullanıldı" e-postası, firmanızdaki diğer yöneticilere de bilgi
  e-postası gider.
- **Bağlan** pasifse üzerine gelin; neden yazar (yetkiniz yok, cihaz çevrimdışı, servis güncel değil, yerel olarak kapalı,
  müşterinin bildirim adresi yok, SMTP yapılandırılmamış, imza).
- Giriş ekranı, kilit ekranı ve yönetici onayı (UAC) penceresi de görünür ve fare/klavyeyle kullanılır. Ctrl+Alt+Del
  gönderilemez; etki alanı politikasıyla kilit ekranında Ctrl+Alt+Del zorunlu kılınmış bilgisayarlarda kilit açılamaz.
- Yalnız bilgisayarın kendi ekranındaki (fiziksel) Windows oturumu görünür; uzak masaüstü (RDP) oturumlarına bağlanılamaz.
- Bir cihazda aynı anda tek gözetimsiz bağlantı olur.
- Bağlantı sürerken cihazda biri kilidi açar ya da oturum açarsa bağlantı sürer; onay sorulmaz.
- Geçmişte bu bağlantılar **Gözetimsiz** mod süzgeciyle bulunur; cihaz ayrıntısında son 20 bağlantı listelenir.

**Bağlantının kendiliğinden kapandığı durumlar** (konsolda yazan metin):

| Konsol mesajı                                                      | Neden                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| Bu cihaza bağlanma yetkiniz kaldırıldı.                            | Admin cihaz yetkinizi veya Bağlan yetkinizi kaldırdı        |
| Cihaz iptal edildi.                                                | Admin cihazı iptal etti                                     |
| Gözetimsiz erişim cihazda yerel olarak kapatıldı.                  | Müşteri cihazdaki anahtarı kapattı (en geç 2 sn'de kesilir) |
| Cihazda bağlantı göstergesi gösterilemediği için bağlantı kapandı. | Gösterge çizilemedi; güvenlik gereği bağlantı açık kalmaz   |
| Cihaz yanıt vermedi.                                               | Cihaz zamanında katılmadı                                   |
| Cihazda Windows oturumu değişti; yeniden bağlanın.                 | Cihazda kullanıcı değiştirildi; yeniden **Bağlan** deyin    |

Cihaz yeniden başlatılırsa bağlantı biter; cihaz çevrimiçi olunca yeniden bağlanın.

### Teknisyen için: gözetimsiz cihazın ekranına çizim

Hızlı Destek'teki gibi cihazın ekranına kalem, ok, dikdörtgen ve lazer noktasıyla çizebilirsiniz. Çizim, cihazın başındaki
kişiye bir yeri göstermek içindir (ör. yönetici onayı penceresinde "buraya tıklayın"). Cihazda servis **0.23 veya sonrası**
olmalıdır; eski serviste çizim yalnız sizin konsolunuzda görünür, cihazda görünmez.

Gözetimsiz bağlantıda kontrol açılışta size gelir. Kontrol sizdeyken çizim araçları şeritte görünmez. Çizmek için:

1. Sahnenin üst şeridinde **Kontrolü bırak**'a basın. Şeritte **İşaretleme araçları** (Kalem, Ok, Dikdörtgen, Lazer, dört
   renk, **Geri al**, **İşaretleri temizle**) çıkar. Araçlar **Sığdır** görünümünde çıkar; **%100** görünümünde yoktur.
2. Bir araç ve renk seçip görüntünün üzerinde çizin. Çizim cihazda, paylaşılan monitörde aynı yerde ve aynı renkte en geç
   1 saniye içinde görünür. Lazer noktası bıraktıktan 1 saniye sonra söner.
3. **Geri al** son çizimi, **İşaretleri temizle** tüm çizimleri cihazdan da kaldırır.
4. Fare ve klavyeyi yeniden kullanmak için **Kontrole devam**'a basın; cihazda onay sorulmaz. Çizimler cihazda kalır.

Bilmeniz gerekenler:

- Yalnız kontrol sahibi teknisyen çizebilir. Katılımcı ve izleyicinin araçları pasiftir ("Yalnız kontrol sahibi kullanabilir").
- Çizimler tıklamayı engellemez: sizin ve cihaz kullanıcısının tıklaması çizimin altındaki pencereye gider.
- Bağlantı göstergesi (kırmızı çerçeve ve üstteki yazı) her zaman çizimlerin üstündedir; çizim göstergeyi örtemez.
- Çizimler sizin görüntünüze ve oturum kaydına girmez; cihazdan gelen görüntüde çift çizim görmezsiniz.
- Cihaz kilit ekranına, oturum açma ekranına ya da yönetici onayı (UAC) penceresine geçerse çizimler orada yeniden
  görünür. Lazer noktası geçişte söner. Bazı bilgisayarlarda bu güvenli ekranlarda çizim gösterilemeyebilir; bu durumda
  yalnız çizim görünmez, bağlantı ve gösterge etkilenmez.
- Monitör değiştirdiğinizde ya da cihazda çözünürlük değiştiğinde çizimler yeni ekrana taşınır, silinmez.
- Bir oturumda en çok 500 çizim tutulur; fazlasında en eski çizim silinir.
- Bağlantı bitince çizimler cihazdan kalkar. Yeniden bağlandığınızda önceki çizimler gelmez.
- Çizimin görüntünüze girmemesi için cihazda Windows 10 2004 veya sonrası gerekir; daha eski Windows'ta çizimi
  görüntüde iki kez görebilirsiniz.

### Tek bağlantı yolu: cihaz kullanıcısına sorulmaz

Gözetimsiz bağlantının tek bir yolu vardır. Bağlantı cihaz kullanıcısına sorulmadan açılır; kullanıcı durumu (Aktif /
Kilitli / Oturum yok) bunu değiştirmez. Seçilecek bir kip, firma politikası ya da ayrı bir "izin istemeden bağlan"
seçeneği yoktur.

| Ne olur                     | Açıklama                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| Cihazda                     | Onay penceresi çıkmaz; "Uzaktan bağlantı: <teknisyen> — <firma>" göstergesi bağlantı boyunca kalır |
| Konsolda                    | Ekran gelir, kontrol kendiliğinden alınır                                                          |
| Müşterinin bildirim adresi  | Her bağlantıda e-posta gider                                                                       |
| Oturum geçmişi ve audit log | Bağlantı kipi **Onaysız** olarak yazılır                                                           |

Rolünüze göre:

- **User (teknisyen):** Admin **Bağlan** ve cihaz yetkisi verdiyse bağlanır.
- **Admin:** kimin hangi cihaza bağlanabileceğini yetki listesi ve cihaz yetkileriyle belirler. Kendisi bağlanmak için o
  cihazda da yetkili olmalıdır. Çalışanları bilgilendirmek Admin'in (müşteri firmanın) sorumluluğundadır.
- **Super Admin:** firma seçerek o firmanın cihazlarını ve kayıtlarını görür; cihaz yetkisi verilemediği için bağlanamaz.

Her bağlantıda: gösterge görünür, müşterinin bildirim adreslerine e-posta gider, müşteri cihazdaki anahtarla gözetimsiz
erişimi kapatabilir, pano paylaşımı ve uzaktan yazdırma kapalıdır.

### Admin için: KVKK — çalışanları bilgilendirme

Gözetimsiz cihaza bağlantı cihaz kullanıcısına sorulmadan açılır; amaç sunucu ve personel bilgisayarlarına destek ve
müdahaledir.

- **Gizli izleme yoktur:** bağlantı süresince cihazda "Uzaktan bağlantı" göstergesi her zaman görünür ve cihaz kullanıcısı
  bağlantıyı yerel kapatma anahtarıyla sonlandırabilir.
- **KVKK:** firma, çalışanlarını bu bilgisayarlara sorulmadan uzaktan bağlanılabileceği, ekranın görülebileceği, kontrol
  edilebileceği ve (açıksa) kaydedilebileceği konusunda **yazılı olarak bilgilendirmekten sorumludur**. Panelde cihaz
  kullanıcısının durumu (aktif / kilitli / oturum yok) görünür; aydınlatma metniniz bunu da kapsamalıdır.
- Uygulamada bu bilgilendirmeyi onaylatan ayrı bir ekran yoktur. Yalnız gözetimsiz bağlantıları **kaydetmek** için
  **Ayarlar → Oturum kaydı** ekranındaki çalışan bilgilendirme kutusu işaretlenir (bkz. "Admin için: Gözetimsiz
  bağlantıları da kaydet").
- Servisi kurmadan önce bilgisayarı kullanan çalışanlara bu bilgilendirmeyi yapın.

### Teknisyen için: müdahale (oturumu kilitle, oturumu kapat)

Kontrol sizdeyken konsolun **Gözetimsiz müdahale** çubuğunda iki düğme vardır. Kontrol kapalıyken, kontrol isteği
sürerken ya da çok teknisyenli oturumda kontrol sahibi siz değilken düğmeler görünmez.

- **Oturumu kilitle:** cihazdaki Windows oturumunu kilitler, onay sormaz. Bağlantı sürer; kilit ekranını görmeye devam
  edersiniz. Başarıda "Cihazda Windows oturumu kilitlendi." yazar.
- **Kullanıcı oturumunu kapat:** onay penceresi çıkar: "Kaydedilmemiş çalışmalar kaybolur. Oturumu kapatmak istiyor
  musunuz?" Varsayılan düğme **Vazgeç**'tir. **Oturumu kapat** derseniz uygulamalar beklenmeden kapanır.

**Önce kilitlemeyi deneyin.** Amaç ekranı korumaksa (ör. kullanıcı masadan kalktı, şüpheli bir işlem sürüyor) **Oturumu
kilitle** yeterlidir ve veri kaybettirmez. **Kullanıcı oturumunu kapat**'ı yalnız gerçekten gerekiyorsa kullanın.

Oturum kapatıldıktan sonra konsolda "Cihaz yeniden bağlanıyor… Oturum kapandıktan sonra servis bağlantıya yeniden katılır.
En çok 45 sn bekleyin; katılamazsa bağlantı biter." görünür. Servis yeni oturumla bağlantıya katılır ve giriş ekranını
görürsünüz. Konsol kontrolü kendiliğinden yeniden ister.

- Cihazdaki servis eskiyse düğmeler pasiftir: "Cihazdaki servis bu özelliği desteklemiyor — güncelleyin".
- Önceki komut bitmeden yenisi gönderilemez ("Önceki komut henüz tamamlanmadı"); dakikada en çok 6 komut gönderilir.
- Komut uygulanamazsa "Cihaz komutu uygulayamadı" yazar.
- Her komut (başarılı ya da başarısız) audit log'a yazılır; cihazın Windows olay günlüğüne de düşer.

### Geçmiş ve audit log'da bağlantı kipi

Yeni gözetimsiz bağlantıların hepsi **Onaysız** kipindedir. Eski sürümde açılmış bağlantılar kendi etiketleriyle kalır:

| Etiket                        | Anlamı                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- |
| **Onaysız**                   | Cihaz kullanıcısına sorulmadan açılan bağlantı (şimdiki tek yol)             |
| **Kullanıcı onayıyla (eski)** | Eski sürümde cihaz kullanıcısının onay penceresiyle açılan bağlantı          |
| **İzinsiz (eski)**            | Eski sürümde firma politikası ve gerekçeyle "izin istemeden" açılan bağlantı |

- **Oturum geçmişi:** süzgeçte **Bağlantı kipi** vardır (üç etiket). Gözetimsiz bir oturumun ayrıntısında **Gözetimsiz
  bağlantı** bölümü bulunur: bağlantı kipi ve **Müdahale zaman çizelgesi** (Kontrol açıldı; Kontrol bırakıldı; Oturum kilitlendi; Kullanıcı oturumu kapatıldı; Cihaz yeniden katıldı;
  eski kayıtlarda Kullanıcı onayı — İzin verdi / Reddetti / Yanıt vermedi). Müdahale yoksa "Müdahale yok" yazar. Yalnız
  eski "İzinsiz (eski)" kayıtlarda **Gerekçe** de görünür; kişisel veri saklama süresi dolup oturum anonimleştirilince
  gerekçe silinir. Bölümü **Oturum geçmişi → Görüntüle** yetkisi olan görür.
- **Audit log:** süzgeçte **Bağlantı kipi** vardır. Gözetimsiz kayıt türleri: Gözetimsiz bağlantı isteği, Gözetimsiz
  bağlantı başladı / bitti, Gözetimsiz oturumda kontrol değişti, Uzak oturum kilitlendi, Uzak kullanıcı oturumu kapatıldı,
  Gözetimsiz bağlantı yeniden kuruldu, Dört göz e-posta bildirimi (yalnız kayıt politikası e-postası). Eski kayıtlarda
  ayrıca Gözetimsiz bağlantı onayı (cihaz kullanıcısı) ve Gözetimsiz erişim politikası değişti (eski) görünebilir. Cihaz kullanıcısının varlık durumu (aktif/kilitli)
  hiçbir kayda yazılmaz.

### Eski servis: "Servis güncel değil"

Onaysız tek yol **bir sonraki servis sürümü** ile gelir. 0.15–0.19 dahil daha eski servisli cihazlarda listede **Servis
güncel değil** rozeti çıkar, **Bağlan** pasiftir ve üzerine gelince "Cihazdaki servis güncel değil — güncelleyin" yazar.
Eski servise hiçbir gözetimsiz bağlantı açılmaz (eski servisler onay penceresi açabileceği için). Bu ret kimlik doğrulama
kodunuzu harcamaz.

Ne yapmalı:

1. Admin: kayıt kodu penceresindeki **Servis programını indir** ile güncel `NoktaDestekServis.exe`'yi indirin. Dosyayı
   müşteriye e-posta eki ya da mesajla göndermeyin; güncellemeyi müşteri bilgisayarında kendi teknisyeniniz yapsın.
2. Teknisyen: pencerede "Windows 'Bilinmeyen yayıncı' gösterebilir; SHA-256: …" notu görünüyorsa dosyanın özetini bu
   değerle karşılaştırın (bkz. "Müşteri BT için: servisi kurma"), sonra dosyayı çalıştırın; ayar penceresinde **Güncelle…** → yönetici onayı (UAC). Kayıt korunur, yeni kayıt kodu
   gerekmez.
3. Servis yeniden bağlanınca rozet kalkar.

### Admin için: cihazı iptal etme ve yetki geri alma

- **Cihazı iptal et:** cihaz ayrıntısı → **Cihazı iptal et** → onaylayın. İptal edilen cihaza artık bağlanılamaz, açık
  bağlantı en geç 10 saniyede kesilir. Cihazdaki pencere "İptal edildi" der. Yeniden eklemek için servisi kaldırıp yeni
  kayıt koduyla kurun.
- **Tek teknisyenin erişimini kaldırmak:** Teknisyen yetkileri → anahtarı kapatın → Kaydet (en geç 5 sn'de kesilir).
- **Teknisyenin tüm gözetimsiz erişimini kaldırmak:** Kullanıcılar → kullanıcı → **Gözetimsiz erişim → Bağlan** yetkisini kapatın.
- Müşteri pasife alınınca o müşterinin cihazları kendiliğinden iptal edilir ve kullanılmamış kayıt kodları silinir.
  Pasif müşteriye kayıt kodu üretilemez; önce müşteriyi **Yeniden aktif et**.

### Müşteri BT için: servisi kurma

Kurulumu bilgisayarın yöneticisi yapar. Destek firmanız size 16 karakterlik kayıt kodunu ve indirme bağlantısını
e-postayla gönderir. `NoktaDestekServis.exe` dosyasını **yalnız bu e-postadaki bağlantıdan** indirin. E-posta, dosyanın
hangi adresten ineceğini ve özetini (SHA-256) yazar:

> Yalnız destek.ornekfirma.com.tr adresinden indirin. Dosya: NoktaDestekServis.exe · Sürüm: 0.23.0 · SHA-256: 1a2b3c4d…5e6f7a8b
> Size başka yoldan gönderilen dosyayı çalıştırmayın.

Bu satırların anlamı:

- **Adres:** bağlantı tam bu alan adıyla başlamalı. Adı benzeyen ama farklı bir adres (fazladan harf, farklı uzantı)
  sahte olabilir; açmayın.
- **Dosya ve sürüm:** inen dosyanın adı `NoktaDestekServis.exe`'dir. Aynı dosyayı ikinci kez indirirseniz tarayıcı adın
  sonuna `(1)` ekleyebilir; bu sorun değildir.
- **SHA-256:** dosyanın parmak izidir. Tek bir harfi değişen dosyanın özeti tamamen farklı çıkar. E-postanın kurulum
  adımında aynı özetin 64 karakterlik tamamı da yazar.
- **Başka yoldan gelen dosya:** e-posta eki, sohbet ya da mesaj uygulamasıyla gönderilen, başka bir siteden indirilen
  "NoktaDestekServis" dosyasını çalıştırmayın. Böyle bir dosya gelirse destek firmanızı arayın.

Kurulumu destek firmanızın teknisyeni yapıyorsa dosyayı kendi panelinden indirir; aynı kontrolü o yapar.

**Çalıştırmadan önce dosyayı doğrulayın**

Servis kod imzası (yayıncı sertifikası) olmadan dağıtılır. Windows bu yüzden yayıncıyı gösteremez; dosyanın doğru dosya
olduğunu yalnız özetinden anlayabilirsiniz. Bu kontrolü atlamayın.

1. Başlat menüsünde **PowerShell**'i açın (yönetici olarak açmanız gerekmez).
2. İndirilenler klasörüne geçip dosyanın özetini hesaplayın:
   ```powershell
   cd $HOME\Downloads
   Get-FileHash .\NoktaDestekServis*.exe -Algorithm SHA256 | Format-List Path, Hash
   ```
3. **Hash** satırını e-postadaki SHA-256 ile karşılaştırın. PowerShell büyük harf yazar, e-posta küçük harf; harf
   büyüklüğü önemli değildir. E-postadaki kısa biçimde (`1a2b3c4d…5e6f7a8b`) ilk 8 ve son 8 karakter tutmalı; mümkünse
   e-postadaki 64 karakterin tamamıyla karşılaştırın.
4. Birden çok dosya listelenirse (ör. `NoktaDestekServis (1).exe`) **Path** satırına bakarak çalıştıracağınız dosyanın
   özetini karşılaştırın; diğerlerini silin.
5. **Özet eşleşmiyorsa dosyayı çalıştırmayın**, silin ve destek firmanıza bildirin.

**Windows uyarı verirse (SmartScreen)**

Özet eşleştiyse dosyayı açın. Windows "**Windows bilgisayarınızı korudu**" penceresini gösterebilir; servis
imzasız olduğu için bu beklenen bir uyarıdır.

1. **Ek bilgi** yazısına tıklayın.
2. "Yayımcı: Bilinmeyen yayımcı" ve "Uygulama: NoktaDestekServis….exe" satırlarını kontrol edin. Uygulama adı başka bir
   şeyse durun.
3. Özeti yukarıdaki adımlarla doğruladıysanız **Yine de çalıştır**'a tıklayın. Doğrulamadıysanız önce doğrulayın.

**Antivirüs veya EDR servisi engellerse**

Servis imzasız bir Windows hizmetidir; bazı güvenlik yazılımları onu engelleyebilir ya da karantinaya alabilir. İstisna
gerekiyorsa:

- İstisnayı **dosyanın SHA-256 özetiyle** tanımlayın (ör. Microsoft Defender for Endpoint'te **Göstergeler → Dosya
  karmaları → İzin ver**). Ürününüz özet desteklemiyorsa dosyanın tam yolu ile özetini birlikte kullanın.
- Servisin program klasörüne ya da İndirilenler klasörüne **klasör veya joker karakter (`*`) istisnası yazmayın**: o
  klasöre konan her dosyaya izin vermiş olursunuz.
- Özet her sürümde değişir. Servis kendini güncellediğinde (bkz. "İstemcilerin otomatik güncellenmesi") yeni sürümün özetini
  destek firmanızdan alıp istisnayı yenileyin, eski sürümün istisnasını kaldırın. Aksi halde güncellenen servis
  engellenebilir.

**Kurulum**

1. `NoktaDestekServis.exe`'yi çalıştırın. **Nokta Destek — Gözetimsiz Erişim** penceresi "Kurulu değil" der.
2. **Kur…** → Windows yönetici onayı (UAC) → **Evet**.
3. Kayıt kodunu yazın (tire ve boşluk önemsiz) → **Kur**.
4. Pencere "Kuruldu — çevrimiçi." gösterir. Bildirim adreslerinize "yeni cihaz kaydedildi" e-postası gelir.

Servis Windows açılışında kendiliğinden başlar; bilgisayara kimse giriş yapmamışken de çalışır. 0.22.0 ve sonraki servisler
yeni sürüme bağlantı yokken kendiliğinden geçer (bkz. "İstemcilerin otomatik güncellenmesi"). Elle güncellemek için
pencerede **Güncelle…** kullanılır; güncelleme kaydı korur.

**Önemli — yönetici hesabı uyarısı.** Bağlantı sırasında bilgisayarda oturum açmış Windows kullanıcısı **yöneticiyse**,
teknisyen ekrana gelen yönetici onayı (UAC) pencerelerini onaylayabilir. Bu bilgisayarlarda günlük kullanım için
**standart kullanıcı hesabı** öneririz.

### Müşteri BT için: bağlantıyı nasıl anlarım, nasıl kapatırım?

- **Gösterge:** bağlantı süresince her monitörün kenarında kırmızı çerçeve ve üstte "Uzaktan bağlantı: <teknisyen adı> —
  <destek firması>" yazısı durur. Bağlantı size sorulmadan açılır; bu yüzden **gizli izleme yoktur**: gösterge her
  bağlantıda görünür, kapatılamaz, kilit ekranında da görünür. Gösterge çizilemezse bağlantı hiç açılmaz.
- **Teknisyenin çizimleri** (servis 0.23 ve sonrası): teknisyen bir yeri göstermek için ekrana ok, kalem, dikdörtgen ya
  da kısa süreli lazer noktası çizebilir. Çizimler teknisyenin baktığı monitörde görünür, tıklamanızı engellemez
  (tıklama altındaki pencereye gider) ve göstergeyi örtmez. Kilit ekranında ve yönetici onayı (UAC) penceresinde de
  görünebilir. Bağlantı bitince kalkar. Çizimleri cihazda kapatma seçeneği yoktur.
- **E-posta:** her gözetimsiz bağlantıda tanımlı adreslere e-posta gelir. Bağlantı gördüğünüz halde e-posta gelmiyorsa
  destek firmanıza sorun.
- **Tepsi simgesi:** saatin yanındaki simgenin ipucu "Gözetimsiz erişim: Açık / Kapalı / Bağlantı var: <teknisyen>"
  gösterir. Menüde durum, **Gözetimsiz erişimi kapat** (ya da **Gözetimsiz erişimi aç…**) ve **Ayarlar…** vardır. Simgeyi
  kapatma seçeneği yoktur; Windows ayarlarından gizleyebilirsiniz.
- **Kapatma:** tepsi menüsünden veya ayar penceresinden **Gözetimsiz erişimi kapat**. Standart kullanıcı da kapatabilir;
  açık bağlantı en geç 2 saniyede kesilir ve destek firmanız panelde "Yerel olarak kapalı" görür. Destek firması bunu
  uzaktan açamaz.
- **Yeniden açma:** **Gözetimsiz erişimi aç…** → yönetici onayı (UAC). Yalnız yerel yönetici açabilir.

Ayar penceresinde durum (Kurulu değil / Çevrimiçi / Bağlanamıyor / Yerel olarak kapalı / İptal edildi / Bağlantı var),
destek firması, müşteri adı ve cihaz kimliğinin ilk 8 karakteri görünür. Pencere "Servis doğrulanamadı" derse bu
bilgisayardaki servis beklenen servis değildir; bilgisayar yöneticinize başvurun. "Program klasörünün izinleri bozuk" derse
servis güvenlik gereği bağlanmaz; servisi kaldırıp yeniden kurun.

**Gelen dosyalar:** teknisyenin gönderdiği dosyalar `C:\ProgramData\NoktaDestek Servis\Gelen\` klasörüne yazılır. Bu
klasörü bilgisayardaki tüm kullanıcılar okuyabilir; servis kaldırılınca silinir.

**Olay günlüğü:** bağlantı başlangıcı ve bitişi, yerel anahtar değişikliği, reddedilen bağlantılar ve iptal Windows Olay
Görüntüleyicisi → Uygulama günlüğüne **NoktaDestek** kaynağıyla yazılır (1001 başladı, 1002 bitti, 1003 yerel anahtar,
1004 reddedildi, 1005 iptal/kaldırma, 1006 oturum kilitlendi, 1007 kullanıcı oturumu kapatıldı). 1001 kaydında bağlantı
kipi "onaysız" yazar. Eski servislerin yazdığı 1008 (bağlantı onayı) artık yazılmaz. Bu kayıt yardımcı kanıttır; yerel yönetici silebilir. **Yetkili kayıt destek
firmanızın sunucusundaki audit log'dur.**

### Müşteri BT için: servisi kaldırma

1. Windows **Ayarlar → Uygulamalar** → **Nokta Destek — Gözetimsiz Erişim** → **Kaldır** (ya da ayar penceresinde **Kaldır…**).
2. Onaylayın ("Gelen dosyalar klasörü de silinir").

Servis, kayıt defteri girdileri, program ve veri klasörleri iz bırakmadan silinir; cihaz destek firmasının panelinde iptal
edilir (bilgisayar o an çevrimdışıysa cihaz panelde çevrimdışı kalır, Admin iptal eder).

### Ortam bantları: "TEST ortamı", "kod imzası olmadan kullanılamaz" ve risk kabul bandı

- **"Gözetimsiz erişim kod imzası olmadan kullanılamaz"** bandı: özellik bu sunucuda kapalıdır; **Bağlan** ve **Kayıt kodu
  oluştur** pasiftir. Sunucu yöneticisi özelliği açana kadar böyle kalır.
- **"TEST ortamı — imzasız servis. Gerçek müşteri cihazı kaydetmeyin."** bandı: test sunucusundasınız; servis imzasızdır
  ve cihazdaki göstergede "TEST" ibaresi bulunur. Yalnız deneme bilgisayarları kaydedin.

**Super Admin için: risk kabul bandı.** Canlı ortamda servis kod imzası olmadan, risk kabul edilerek çalıştırılıyorsa
Super Admin **Gözetimsiz cihazlar** sayfasında (firma seçmeden de) şu bilgi bandını görür:

> Gözetimsiz servis kod imzasız çalışıyor (risk kabul, ADR-0042). Kurulumda Windows SmartScreen uyarısı görülebilir.

Bant bir hata değildir; sunucunun bu kararla çalıştığını hatırlatır. Admin, teknisyen ve müşteri bu bandı görmez. Bu
modda:

- Cihazdaki göstergede "TEST" ibaresi **yoktur**; gösterge diğer canlı bağlantılardaki gibidir.
- Sunucu yalnız yayımlanmış servis sürümlerini kabul eder. İzin verilmeyen bir sürümle kurulum kayıt kodu aşamasında
  reddedilir; cihaz listeye eklenmez (kayıt kodu harcanmaz). Önceden kayıtlı bir cihazın sürümü izin listesinden
  çıkarılırsa cihaz bağlanamaz ve listede **İzinli sürüm değil** rozeti çıkar.
- Admin kayıt kodu penceresinde "Windows 'Bilinmeyen yayıncı' gösterebilir" notunu ve servisin özetini görür.
- Müşteriye giden kayıt kodu e-postası indirme adresini, dosya adını, sürümü ve özeti yazar (her ortamda).

Kararı geri almak (özelliği kapatmak) sunucu yöneticisinin işidir; ayrıntı teknik işletim belgesindedir (runbook §27.9).

### Sık karşılaşılan mesajlar (Gözetimsiz erişim)

| Mesaj                                                                                | Ne yapmalı                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bildirim e-postası yapılandırılmamış — Ayarlar → SMTP                                | Firmanızın SMTP ayarını kaydedip test edin                                                                                                                                                                   |
| Müşterinin bildirim adresi yok — adres yokken bu müşterinin cihazlarına bağlanılamaz | Müşteri ayrıntısında en az bir bildirim adresi ekleyin                                                                                                                                                       |
| Gözetimsiz erişim kod imzası olmadan kullanılamaz                                    | Sayfanın üstünde bant varsa özellik bu sunucuda kapalıdır; sunucu yöneticinize başvurun. Bant yokken pasif **Bağlan** üzerinde görünüyorsa cihazda **İzinli sürüm değil** rozeti vardır: servisi güncelleyin |
| Cihaz çevrimdışı                                                                     | Bilgisayar kapalı ya da internete bağlı değil; açılınca en geç 2 dk'da çevrimiçi olur                                                                                                                        |
| Cihazda başka bir gözetimsiz bağlantı var                                            | Diğer bağlantı bitince yeniden deneyin                                                                                                                                                                       |
| Yerel olarak kapalı                                                                  | Müşteri cihazda kapattı; açmak için müşterinin bilgisayar yöneticisine başvurun                                                                                                                              |
| Cihaz bulunamadı ya da bu cihaz için yetkiniz yok.                                   | Admin'den o cihaz için teknisyen yetkisi isteyin                                                                                                                                                             |
| Kayıt kodu geçersiz, kullanılmış ya da süresi dolmuş (servis kurulumunda)            | Destek firmasından yeni kod isteyin; kod 24 saat geçerli ve tek kullanımlıktır                                                                                                                               |
| Müşteri pasif; kayıt kodu oluşturulamaz.                                             | Önce müşteriyi **Yeniden aktif et**, sonra kodu yeniden oluşturun                                                                                                                                            |
| Cihazdaki servis güncel değil — güncelleyin                                          | Servisi bir sonraki servis sürümüne güncelleyin (bkz. "Eski servis: Servis güncel değil")                                                                                                                    |
| İzinli sürüm değil (cihaz rozeti)                                                    | Servisi güncelleyin; sürer ise sunucu yöneticisi servisi yeniden yayınlar                                                                                                                                    |
| Dosya özeti (Get-FileHash) e-postadaki SHA-256 ile eşleşmiyor                        | Dosyayı çalıştırmayın, silin, destek firmanıza bildirin                                                                                                                                                      |
| Cihaz güncelleniyor, birazdan tekrar deneyin.                                        | Servis kendini güncelliyor; 2–3 dakika sonra yeniden deneyin                                                                                                                                                 |
| Kullanıcı bağlantıyı reddetti. / Kullanıcı yanıt vermedi.                            | Yalnız eski kayıtlarda görünür (eski onay penceresi); yeni bağlantıda çıkmaz                                                                                                                                 |
| Önceki komut henüz tamamlanmadı                                                      | Kilit/oturum kapatma sonucunu bekleyin                                                                                                                                                                       |
| Cihaz komutu uygulayamadı                                                            | Kontrolün açık olduğunu ve cihazda oturum bulunduğunu kontrol edin; yeniden deneyin                                                                                                                          |

## İstemcilerin otomatik güncellenmesi (Admin, teknisyen, müşteri ve müşteri BT için)

> **Canlı ortamda (2026-11-21):** otomatik güncelleme **0.25.1 ve sonrası** için çalışır; 0.25.1'den eski programlar bir kez
> elle değiştirilir (zaten bağlanamazlar). **Gözetimsiz erişim servisinin otomatik güncellemesi canlıda şimdilik kapalıdır**:
> aşağıdaki "Tam otomatik" satırı servis için sunucu yöneticisi açana kadar geçerli değildir; servis elle güncellenir.

Sürüm **0.22.0** ile destek programları ve gözetimsiz erişim servisi yeni sürüme kendileri geçer. Program yeni sürümü
sunucudan öğrenir, indirir, Nokta Bilişim'in imzasıyla doğrular ve **yalnız destek oturumu yokken** kurar. Oturum
sırasında hiçbir program değişmez, kapanmaz ya da yeniden başlamaz. İmzası tutmayan, bozuk ya da eski bir sürüm kurulmaz;
bu durum denetim kaydına "Güncelleme reddedildi" olarak yazılır.

Programlar yeni sürümü açılışta ve açık kaldıkça yaklaşık 24 saatte bir denetler. İnternet yoksa sessizce sonraki denetimi
bekler; ekrana hata çıkmaz.

### Hangi program nasıl güncellenir?

| Program                             | Ne olur                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gözetimsiz erişim servisi (Windows) | **Tam otomatik.** Bağlantı yokken indirir, doğrular, kendini değiştirir ve yeniden başlar; kesinti yaklaşık 30 saniyedir. Yeni sürüm 60 saniye içinde sunucuya bağlanamazsa servis eski sürüme kendiliğinden döner ve aynı sürümü 24 saat denemez. Kayıt, teknisyen yetkileri ve yerel kapatma anahtarı korunur; cihaz panelde aynı cihaz olarak kalır. Kimsenin bir şey tıklaması gerekmez                       |
| Hızlı Destek (Windows)              | Yeni sürümü arka planda indirir. Oturum bitince dosyayı **aynı klasörde, aynı adla** değiştirir. Yeni sürüm programı bir sonraki açışınızda çalışır; açık program kendini kapatmaz. Ekranda bir kez "Yeni sürüm (x.y.z) hazır — programı sonraki açışınızda kullanılacak" yazar. Tepside çalışan programda bu bilgi balon olarak çıkar                                                                            |
| Hızlı Destek (Linux)                | Windows ile aynı: dosya aynı adla değişir, çalıştırma izni korunur, yeni sürüm sonraki açılışta çalışır. Bilgi oturum sonu ekranında görünür                                                                                                                                                                                                                                                                      |
| Hızlı Destek (macOS)                | **Kendini güncellemez.** Yeni sürüm varsa oturum sonu ekranında "Yeni sürüm var — indirme bağlantısından yeni sürümü alın" yazar. Yeni zip'i teknisyenin verdiği destek sayfasından indirin. Mac'te her yeni sürüm yeni bir indirmedir: Apple Developer ID olmadığı için ilk açılışta "Yine de Aç" onayı ve Ekran Kaydı / Erişilebilirlik izinleri yeniden istenir (döngüye girerse: "Ekran Kaydı izni", 6. adım) |
| Tarayıcıdan katılım                 | Güncellenecek program yoktur                                                                                                                                                                                                                                                                                                                                                                                      |

Dosya yazılamayan bir yerdeyse (ağ sürücüsü, USB bellek, salt okunur klasör, Linux'ta başka kullanıcıya ait dosya) program
dosyaya dokunmaz. Yalnız "Yeni sürüm var — indirme bağlantısından yeni sürümü alın" bilgisini ve destek firmanızın
karşılama sayfası adresini gösterir. Programın yanına kopya dosya bırakılmaz.

Windows'ta güncellemeden sonra klasörde kısa süre `<program adı>.eski` dosyası görünebilir. Program bir sonraki açılışta
bunu siler; isterseniz elle de silebilirsiniz.

### Admin için: Ayarlar > İstemciler (otomatik güncellemeyi açma / kapatma)

1. **Ayarlar** → **İstemciler** sekmesini açın.
2. **İstemcileri otomatik güncelle** anahtarını açın ya da kapatın. Varsayılan **Açık**tır.
3. **Kaydet**'e basın. "İstemci güncelleme ayarı kaydedildi." yazar. Kimlik doğrulama penceresi çıkmaz.

Kaydetmeden sayfadan çıkmaya çalışırsanız uyarı gelir. Ayarı görmek için **Ayarlar → Görüntüle**, değiştirmek için
**Ayarlar → Düzenle** yetkisi gerekir. Değişiklik denetim kaydına "İstemci otomatik güncelleme ayarı değişti" olarak eski →
yeni değeriyle yazılır.

**Kapalıyken:** programlar yeni sürümü indirmez ve kurmaz, yalnız "yeni sürüm var" diye haber verir. Gözetimsiz cihaz
listesinde bu cihazlar **Güncelleme bekliyor** rozetiyle görünür. Değişiklik açık servis bağlantılarına bir dakika içinde,
diğer programlara bir sonraki denetimde (en geç 24 saat) yansır.

Bu ayara uyan programlar: firmanızın gözetimsiz erişim servisleri, firmanıza kayıtlı Windows bilgisayarlar ve firmanızın
müşteri dosyaları (`NoktaDestek-<firma>-….exe`). Bir bilgisayar birden çok firmaya kayıtlıysa ve firmalardan biri ayarı
kapattıysa o bilgisayarda güncelleme kapalı sayılır. Genel bağlantıyla indirilen Windows programı ile Linux programı hangi
firmaya ait olduğunu bilmediği için her zaman günceller; Mac programı zaten yalnız haber verir.

**Önemli — asgari sürüm:** sunucu yöneticisi bir asgari sürüm belirlediyse ve firmanıza kayıtlı bir bilgisayardaki
Hızlı Destek (`NoktaDestek.exe`) bu sürümün altındaysa, program **otomatik güncelleme Kapalı olsa bile kendini günceller**.
Program eski sürümle zaten bağlanamaz; asgari sürüm, yöneticinin "güncellenmeli" kararıdır. Bu istisna gözetimsiz
erişim servisi ve firma müşteri dosyası için geçerli değildir: ayar Kapalıyken asgari sürümün altında kalan servis
kendiliğinden güncellenmez ve listede kırmızı **Asgari sürümün altında** rozetiyle görünür. Böyle bir
durumda ayarı geçici olarak açın ya da servisi elle güncelleyin (bkz. "Eski servis: Servis güncel değil").

### Gözetimsiz cihaz listesinde sürüm ve rozetler

**Gözetimsiz** listesinde **Sürüm** sütunu cihazdaki servis sürümünü ve yanında bir rozet gösterir. Rozet her zaman ikon ve
yazıyla birlikte gelir; yalnız renge bakmanız gerekmez.

| Rozet                         | Anlamı                                                                                                 | Ne yapmalı                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Güncel                        | Cihaz yayındaki sürümde                                                                                | —                                                                                             |
| Güncelleme bekliyor (→ x.y.z) | Yeni sürüm var; henüz kurulmadı (ayar Kapalı, bağlantı sürüyor ya da servis indirme sırasını bekliyor) | Ayar Açıksa bekleyin; servis yeni sürümü gördükten sonra indirmeye 2 saate kadar bekleyebilir |
| Güncelleniyor (→ x.y.z)       | Servis şu an kuruyor                                                                                   | 2–3 dakika sonra bağlanın                                                                     |
| Güncelleme başarısız (neden)  | Son deneme başarısız oldu ya da eski sürüme dönüldü                                                    | Nedene bakın (aşağıdaki "Sık karşılaşılan durumlar")                                          |
| Asgari sürümün altında        | Cihaz sunucu yöneticisinin belirlediği asgari sürümden eski                                            | Ayarı açın ya da servisi elle güncelleyin                                                     |

Neden yazıları: indirme, bütünlük, imza, platform imzası, eski sürüm, süresi dolmuş, ortam, kurulum, sağlık denetimi.
Cihaz ayrıntısındaki sürüm satırında da aynı rozet görünür.

**Sürüm dağılımı:** listenin üstündeki şerit "Yayındaki sürüm: x.y.z" satırını ve her sürümde kaç cihaz olduğunu
gösterir. Bir sürüme tıklayınca liste o sürümdeki cihazlara süzülür; **Süzgeci kaldır** ile geri dönersiniz. Asgari
sürümün altında cihaz varsa "Asgari sürümün altında: n cihaz" satırı çıkar. Şerit yalnız gözetimsiz cihazları sayar;
Hızlı Destek kopyaları burada görünmez (onların güncellemeleri denetim kaydındadır).

- Şerit yüklenemezse "Sürüm dağılımı alınamadı. Cihaz listesi aşağıda." yazar; **Tekrar dene**'ye basın. Liste bundan
  etkilenmez.
- "Yayın bilgisi alınamadı; yalnız cihazlardaki sürümler gösteriliyor." yazıyorsa sunucuda yayında bir sürüm yoktur ya
  da bilgisi okunamadı; cihaz sayıları yine doğrudur.
- **Super Admin:** şeritte **Bu firma / Tüm firmalar** seçimi vardır. "Tüm firmalar" yalnız sayıları gösterir, cihaz adı
  göstermez; alttaki liste seçili firmanındır.

Sütunu ve şeridi gözetimsiz listeyi görebilen herkes (Gözetimsiz erişim **Bağlan** ya da **Yönet** yetkisi) görür.

### Teknisyen için: "Cihaz güncelleniyor, birazdan tekrar deneyin"

**Bağlan**'a bastığınızda bu mesaj çıkıyorsa cihazdaki servis o an kendini güncelliyor. Kurulum en çok birkaç dakika
sürer. 2–3 dakika sonra yeniden deneyin. Bu ret kimlik doğrulama kodunuzu harcamaz.

### Admin için: Audit log'da güncelleme kayıtları

**Audit log** → **İşlem** süzgecinde **İstemci güncelleme** grubunu seçin. Görülen kayıtlar:

| Kayıt                                                                          | Ne zaman yazılır                                                                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| İstemci güncellemesi bulundu                                                   | Program yeni sürümü ilk kez gördü (sürüm başına bir kez)                                                |
| İstemci güncellendi                                                            | Kurulum tamamlandı (eski → yeni sürüm)                                                                  |
| İstemci güncellemesi başarısız                                                 | İndirme ya da kurulum başarısız                                                                         |
| Güncelleme reddedildi (imza / platform imzası / eski sürüm / bütünlük / ortam) | **Güvenlik olayı:** program sahte, bozuk ya da yanlış ortama ait bir sürümü reddetti; kurulum yapılmadı |
| İstemci güncellemesi geri alındı                                               | Servis yeni sürümle açılamadı, eski sürüme döndü                                                        |
| İstemci güncellemesi atlandı                                                   | Ayar Kapalı, dosya yazılamıyor ya da elle güncelleme gerekiyor                                          |
| İstemci otomatik güncelleme ayarı değişti                                      | Ayarlar > İstemciler'de anahtar değişti                                                                 |

"İstemci bildirdi:" ile başlayan kayıtlar kayıtlı bilgisayarın kendi bildirdiği, sunucunun doğrulayamadığı sonuçlardır.
Denetim kaydına yalnız gözetimsiz servislerin ve firmanıza kayıtlı bilgisayarların olayları yazılır; Genel bağlantı, Mac
ve Linux programlarının olayları yalnız sunucu sayaçlarına girer. **Güncelleme reddedildi** kaydı görürseniz sunucu
yöneticinize hemen bildirin.

### Müşteri BT için: servis güncellemesi

- Servis kendini bağlantı yokken günceller; bağlantı sürerken kurulum yapılmaz, bağlantı bitince yapılır.
- Kurulum, geri dönüş ve ret Windows Olay Görüntüleyicisi → Uygulama günlüğüne **NoktaDestek** kaynağıyla yazılır:
  **1010** güncellendi, **1011** eski sürüme dönüldü, **1012** güncelleme reddedildi.
- Tepsi simgesi yeni sürüme geçerken kendini yeniden başlatır; kısa süre kaybolup geri gelebilir.
- Program klasöründe geçici `NoktaDestekServis.exe.eski` dosyası görülebilir; servis sonraki açılışlarında siler.
- Ayar penceresindeki **Güncelle…** düğmesi elle güncelleme için yerinde durur.

### 0.21 ve önceki programlar: bir kez elle güncelleme

Canlı ortamda bu kural **0.25.1'den eski** bütün programlar için geçerlidir: canlı ortamın güncelleme imzası ilk kez
0.25.1'e gömüldü. Bu programlar bir kez elle 0.25.1'e geçirilir; sonraki sürümler (Mac dışında) kendiliğinden gelir.

Otomatik güncelleme 0.22.0 sürümüyle gelir. 0.21 ve önceki programlarda güncelleyici yoktur; bu yüzden her program **bir
kez elle** 0.22.0 ya da sonrasına geçirilir. Sonraki sürümler kendiliğinden gelir.

- **Gözetimsiz servis:** Admin kayıt kodu penceresindeki **Servis programını indir** ile yeni `NoktaDestekServis.exe`'yi
  indirir; teknisyen müşteri bilgisayarında (pencerede SHA-256 notu varsa özeti doğrulayıp) ayar penceresinde **Güncelle…** der (bkz. "Eski
  servis: Servis güncel değil"). Kayıt korunur.
- **Hızlı Destek (Windows, Linux, Mac):** müşteriye yeni bağlantı gönderin (**Müşteriye gönder**) ya da müşteri
  karşılama sayfasından programı yeniden indirsin. Eski dosyayı yenisiyle değiştirmesi yeterlidir; bilgisayar kaydı
  korunur.

### Sık karşılaşılan durumlar (otomatik güncelleme)

| Durum                                                                       | Ne yapmalı                                                                                                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows/Linux programı "Yeni sürüm var — indirme bağlantısından…" diyor     | Dosya yazılamayan bir yerde ya da firma güncellemeyi kapattı. Programı Masaüstü ya da İndirilenler gibi bir klasörden çalıştırın veya yeni sürümü indirin |
| Mac programı her seferinde "Yeni sürüm var…" diyor                          | Normaldir; Mac programı kendini güncellemez. Yeni sürümü indirme bağlantısından alın                                                                      |
| Rozet uzun süredir "Güncelleme bekliyor"                                    | Ayarlar > İstemciler'de anahtar Açık mı bakın. Cihazda bağlantı sürüyorsa kurulum bağlantı bitince yapılır                                                |
| "Güncelleme başarısız (indirme)"                                            | Ağ sorunu; program sonraki denetimde yeniden dener                                                                                                        |
| "Güncelleme başarısız (sağlık denetimi)" ya da "geri alındı"                | Yeni sürüm açılamadı, servis eski sürüme döndü ve çalışmaya devam ediyor. 24 saat sonra yeniden dener. Sunucu yöneticisine bildirin                       |
| "Güncelleme başarısız (imza, platform imzası, bütünlük, ortam, eski sürüm)" | Güvenlik reddi; hiçbir şey kurulmadı. Sunucu yöneticisine hemen bildirin                                                                                  |
| "Cihaz güncelleniyor, birazdan tekrar deneyin"                              | 2–3 dakika sonra yeniden bağlanın                                                                                                                         |
| "Asgari sürümün altında"                                                    | Ayarlar > İstemciler'i açın ya da servisi elle güncelleyin. Cihaz 0.21 ya da öncesindeyse bir kez elle güncelleyin                                        |
| Bir program hiç güncellenmiyor                                              | Sürümü 0.21 ya da önceyse bir kez elle güncelleyin. 0.22 ve sonrasında sunucuda yayında sürüm olmayabilir; sunucu yöneticisine sorun                      |

## Super Admin için: Firmalar ve firma geçişi

Menüde **Firmalar** (bina simgesi) yalnız Süper Yönetici'ye görünür. Diğer roller bu adresi açarsa "Bu sayfa yalnız
Süper Yönetici içindir" uyarısı çıkar.

### Firma seçici (üst menü)

- Üst menüde bina simgesiyle **etkin firma** görünür ("Firma seçilmedi" veya firma adı). Tıklayınca arama kutusu açılır.
- **Firma adı yazın** kutusuna adın bir kısmını yazın; yazmayı bıraktıktan kısa süre sonra uyan en çok **20 aktif firma**
  listelenir (adı yazdığınızla başlayanlar önce). Şu an içinde olduğunuz firmanın yanında "Etkin" yazar.
- Fareyle tıklayarak veya **↓ / ↑** ve **Enter** ile seçin; **Esc** listeyi kapatır. Seçince o firmaya geçersiniz;
  **Firma bağlamından çık** ile çıkarsınız. Pasif firmalar bu listede çıkmaz.
- Firma seçiliyken Kullanıcılar, Talepler, Müşteriler ve Ayarlar o firmanın verisini gösterir. Seçili değilken bu
  ekranlar "Firma seçin" der; Oturum geçmişi ve Oturumlar ise tüm firmaları gösterir (Oturumlar'da işlem yapmak için
  firma seçmek gerekir; bkz. "Teknisyen için: Oturumlar ve bekleme odası").
- Her geçiş denetim kaydına yazılır. Mobilde seçici yalnız simge olarak görünür; işlem yapmadan önce doğru firmada
  olduğunuzu firma listesinden kontrol edin.

### Nasıl firma oluştururum?

1. Önce firmayı doğrulayın: ticari unvan ve vergi no sözleşmeyle eşleşmeli, ilk yöneticinin e-postası firmanın
   alan adında olmalı ve firmanın kayıtlı telefonundan teyit edilmeli (`docs/runbook.md` §14.1).
2. **Firmalar > Yeni firma**'ya tıklayın. **Firma adı**'nı yazın (müşterinin aydınlatma metninde görünür).
3. **Kısa ad** addan önerilir; yalnız küçük harf, rakam ve tire içerir ve giriş adresinde kullanılır. Kullanılıyorsa
   "Bu kısa ad başka bir firmada kullanılıyor" yazar.
4. **Firmayı oluştur**. Firma varsayılan ayarlar ve aydınlatma metniyle açılır.
5. Satırdaki **Bu firmaya geç**'e tıklayın, sonra **Kullanıcılar > Yeni kullanıcı** ile rolü **Yönetici** olan ilk
   kullanıcıyı ekleyin. Geçici şifreyi ayrı bir kanaldan iletin.

### Firmayı düzenleme

**Düzenle** ile adı ve kısa adı değiştirebilirsiniz. Kısa ad değişirse firmanın eski giriş bağlantıları çalışmaz.

### Firmanın sunucu depolama kotası

Düzenleme penceresinde **Sunucu depolama kotası (GB)** alanı vardır (yalnız düzenlemede; yeni firma 20 GB ile açılır).
Alanın altında firmanın güncel kullanımı yazar ("Kullanım: x / y").

1. Firmanın satırında **Düzenle**'ye basın.
2. Kotayı 1–2000 GB arasında girin ve kaydedin.

- Kota, firmanın sunucu üzerinden aktarılan dosyalarının ve oturum kayıtlarının toplamını sınırlar. Kota dolunca yeni yüklemeler "Firma depolama
  kotası doldu" ile reddedilir.
- Kotayı kullanımın altına düşürebilirsiniz: mevcut dosyalar silinmez, yalnız yeni dosyalar kabul edilmez.
- Sunucunun diskinde boş alan %10'un altına inerse kota dolmamış olsa da tüm firmalarda yükleme reddedilir. Firma
  kotalarının toplamını sunucunun boş diskine göre belirleyin.
- Her değişiklik denetim kaydına "Firma depolama kotası değişti" olarak eski → yeni yazılır.

### Firmayı pasife alma ve yeniden etkinleştirme

1. Satırdaki **Pasife al**'a tıklayın. Pencere etkileri listeler: firmanın tüm kullanıcılarının oturumu kapanır ve giriş
   yapamazlar; açık destek oturumları sonlanır; bekleyen destek talepleri iptal edilir; kayıtlı bilgisayarların kayıtları
   geçersiz olur.
2. Onaylamak için firmanın **kısa adını** yazın ve **Firmayı pasife al**'a tıklayın.
3. Pasif firma seçicide görünmez. **Yeniden etkinleştir** ile kullanıcılar tekrar giriş yapabilir; iptal edilen talepler
   ve bilgisayar kayıtları geri gelmez, müşteriler bir sonraki başarılı oturumda yeniden kaydolur.

Firmanın zamanlanmış ya da yarım kalmış bir silme işi varsa yeniden etkinleştirme reddedilir: "Önce silme işini iptal
edin" (zamanlanmış) veya "Firma kısmen silindi; silmeyi tamamlayın" (başlamış/başarısız) yazar.

### Firmayı kalıcı silme

Sözleşmesi biten bir firmanın tüm verisini ve dosyalarını sistemden çıkarır. **Bu işlem geri alınamaz.** Yalnız Super
Admin yapabilir. Yanlışlığa karşı birkaç güvence vardır: firma en az 30 gün pasif olmalı, önce ne silineceği gösterilir,
firma adı yazılarak onaylanır, 2FA kodu istenir ve silme **24 saat sonra** başlar; bu sürede iptal edilebilir.

**Firma ayrıntı sayfası:** **Firmalar** listesinde firma adına tıklayın. Sayfada **Kalıcı silme** bölümü vardır.

**Nasıl kalıcı silerim?**

1. Firmayı pasife alın (bkz. "Firmayı pasife alma ve yeniden etkinleştirme") ve **30 gün** bekleyin. Bu sürede firma
   gerekirse yeniden etkinleştirilebilir.
   - Aktif firmada bölümde "Kalıcı silmek için önce firmayı Firmalar listesinden pasife alın." yazar.
   - 30 gün dolmadıysa düğme soluktur ve "Silinebilir: <tarih>" yazar.
2. **Kalıcı sil**'e tıklayın. Pencerede önizleme hazırlanır:
   - **Silinecek kayıtlar:** adım adım sayılar (oturumlar, talepler, müşteriler, kayıtlı bilgisayarlar, kullanıcılar,
     ayarlar, aydınlatma metinleri vb.);
   - **Dosyalar:** dosya sayısı ve toplam boyut (logo, profil resimleri);
   - "Audit kayıtları (n) silinmez; 730 gün saklanır.";
   - "Silme 24 saat sonra başlar; bu sürede iptal edebilirsiniz."
3. "Onaylamak için adı yazın: …" alanına **firma adını** birebir yazın.
4. **Silmeyi zamanla**'ya basın ve "Kimliğinizi doğrulayın" penceresine 2FA kodunuzu girin.
5. "<firma> için silme zamanlandı" mesajı çıkar. Önizleme 15 dakika geçerlidir; süre dolduysa ya da bu arada firmanın
   durumu değiştiyse "Önizlemenin süresi doldu ya da geçersiz; önizlemeyi yeniden alın." yazar: **Önizlemeyi yenile**'ye
   basıp yeniden onaylayın.

**24 saatlik bekleme ve iptal**

- Firma sayfasında **Silme zamanlandı** kartı, başlama zamanı ve kalan süre görünür.
- Bütün Super Admin'lerin panelinde, her sayfanın üstünde kapatılamayan bir uyarı bandı çıkar: "<firma> <tarih>
  tarihinde kalıcı silinecek." ve **İptal et** bağlantısı. Firmalar listesinde firmanın yanında "Silinecek: <tarih>"
  rozeti görünür. Sunucu yöneticisi de alarm alır.
- Vazgeçmek için banttaki **İptal et**'e ya da firma sayfasındaki **Silmeyi iptal et**'e basın, 2FA kodunuzu girin.
  "<firma> için silme iptal edildi" yazar; hiçbir kayıt silinmez, firma pasif kalır ve yeniden etkinleştirilebilir.
- Silmeyi siz başlatmadıysanız ve bandı görüyorsanız hemen iptal edin ve sunucu yöneticisine bildirin.
- Silme başladıktan sonra iptal edilemez ("Yalnız başlamamış (zamanlanmış) silme işi iptal edilebilir.").

**İlerleme**

- 24 saat dolunca silme kendiliğinden başlar. Kart **Siliniyor** olur, "Adım 5/17: Destek oturumları" gibi bir ilerleme
  çubuğu birkaç saniyede bir güncellenir. Listede rozet "Siliniyor"dur. Sayfayı kapatabilirsiniz; iş sunucuda sürer.
- Sunucu yeniden başlarsa silme kaldığı adımdan devam eder.
- Bitince kart **Firma kalıcı silindi** olur: "Firmanın verileri ve dosyaları silindi. Audit kayıtları saklanıyor." ve
  bitiş zamanı. Firma listeden kalkar; geçmiş kayıtlarda "Silinmiş firma #XXXXXX" olarak görünür.

**Silme başarısız olursa ("Sürdür")**

- Kart **Silme başarısız** olur ve hangi adımda durduğunu yazar (ör. "dosya sistemi hatası"). Bantta "<firma> silme işi
  başarısız; firma kısmen silindi." görünür; listede "Silme başarısız" rozeti vardır. Firma bu durumda yeniden
  etkinleştirilemez.
- Önce sunucu yöneticisine bildirin; hatanın nedeni giderilmelidir (`docs/runbook.md` §23.3). Neden "iş geçersiz" ise
  sürdürmeyin, sunucu yöneticisi inceler.
- Neden giderilince **Sürdür**'e basın, açılan önizlemede firma adını yazın, **Silmeyi sürdür** ve 2FA kodu. Silme
  beklemeden, kaldığı adımdan devam eder ("<firma> için silme sürdürülüyor"). Firma kaydı daha önce silindiyse adı
  "Silinmiş firma #XXXXXX" olarak yazılır.

**Ne silinir, ne kalır?**

| Silinir                                                                                                  | Kalır                                                                                        |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Destek oturumları, dosya ve onay kayıtları, talepler, talep engelleri, müşteriler, kayıtlı bilgisayarlar | Audit kayıtları: 730 gün saklanır, kimlik bilgileri maskeli gösterilir, süre dolunca silinir |
| Firmanın kullanıcıları, yetkileri, giriş oturumları; firma ayarları, aydınlatma metinleri, firma kaydı   | Silme işinin kendi kaydı (kim başlattı, ne zaman, kaç satır): 730 gün                        |
| Firmanın dosya klasörü (logo, profil resimleri)                                                          |                                                                                              |

- Her adım audit log'a yazılır: "Firma silme önizlemesi", "Firma silme zamanlandı", "Firma silme iptal edildi", "Firma
  silme başladı", "Firma silme başarısız", "Firma kalıcı silindi" (yalnız sayılar).
- Silinen veri sunucu yedeklerinden **en geç 14 gün içinde** düşer. Sunucu yedekten geri yüklenirse silinmiş firma,
  sistem açılmadan yeniden silinir (bkz. "Yedekler ve kalıcı silme"). Silinen bir firmanın verisi resmî bir talep
  (mahkeme, KVKK Kurulu) için gerekirse yalnız sunucu yöneticisi, iki kişinin onayıyla, yedekten ayrı bir ortamda
  çıkarabilir (`docs/runbook.md` §23.7).

**Sık karşılaşılan mesajlar (Firma silme)**

| Mesaj                                                             | Ne yapmalı                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| Firma <tarih> tarihinden sonra silinebilir.                       | 30 günlük pasiflik dolmadı; o tarihten sonra deneyin.              |
| Firma henüz kalıcı silinemez (en az 30 gün pasif olmalı).         | Firmayı önce pasife alın.                                          |
| Firma adı eşleşmiyor                                              | Firma adını büyük/küçük harf dahil birebir yazın.                  |
| Önizlemenin süresi doldu ya da geçersiz; önizlemeyi yeniden alın. | **Önizlemeyi yenile**'ye basıp yeniden onaylayın.                  |
| Bu firma için açık bir silme işi var.                             | Başka bir Super Admin silmeyi zamanlamış; sayfa yenilenir.         |
| Önce silme işini iptal edin                                       | Yeniden etkinleştirmeden önce zamanlanmış silmeyi iptal edin.      |
| Firma kısmen silindi; silmeyi tamamlayın                          | Silme başlamış; yeniden etkinleştirilemez, **Sürdür** ile bitirin. |

---

## Super Admin için: Tüm firmaların oturum geçmişi

- Super Admin firma seçmeden **Oturum geçmişi**'ni açtığında tüm firmaların oturumlarını görür. Listede ve CSV'de
  ek **Firma** sütunu, filtrelerde **Firma** seçimi bulunur.
- Üst menüdeki firma seçiciyle bir firmaya geçtiğinizde yalnız o firmanın oturumları görünür.
- **Destek talepleri:** Super Admin firma seçmeden **Talepler** ve **Ayarlar** ekranlarında "Önce firma seçin" uyarısını
  görür. Firma seçiliyken o firmanın kuyruğunu görür ve ayarlarını düzenleyebilir; talep **kabul edemez ve
  reddedemez** (oturum teknisyenin kendi firmasında açılır).

## Super Admin için: Sistem ayarları (MySQL ve TURN)

Kenar menüsünde **Sistem ayarları** (sunucu-dişli simgesi) yalnız Super Admin'e görünür; Admin bu adresi açarsa "Sistem
ayarları yalnız Super Admin içindir." yazar. MySQL, TURN ve WhatsApp ayarlarını kaydederken veya ortam değerine dönerken
son 5 dakika içinde doğrulama yapmadıysanız **Kimliğinizi doğrulayın** penceresi açılır (bkz. "Kritik bir ayarı
değiştirirken 'Kimliğinizi doğrulayın' penceresi"). Bu ayarlar **tüm firmalar için** geçerlidir. Sayfada şu sekmeler vardır:
**MySQL**, **TURN**, **Sistem logosu** (bkz. "Super Admin için: Sistem logosu"), **WhatsApp servisi** (bkz. "Super
Admin için: Sistem ayarları > WhatsApp servisi"), **Virüs tarama (ClamAV)** (bkz. "Super Admin için: Sistem ayarları >
Virüs tarama (ClamAV)") ve **Super Admin'ler**. Her değişiklik audit log'a yazılır (firma alanı boş, "Sistem" kaydı olarak).

Kaynak rozeti: **Ortam değişkenleri (.env)** = panelde kayıt yok, sunucudaki `.env` kullanılıyor; **Panelde kayıtlı** =
bu ekrandan kaydedilmiş değer.

### MySQL: alanlar

| Alan           | Açıklama                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sunucu (host)  | Veritabanı sunucusunun adı veya IP'si (Docker'da genelde `mysql`)                                                                                                                      |
| Port           | Varsayılan 3306                                                                                                                                                                        |
| Veritabanı adı | Harf, rakam, `_ $ -`; en çok 64 karakter                                                                                                                                               |
| Kullanıcı adı  | Uygulamanın kullandığı **`app`** kullanıcısı (root veya migrator değil)                                                                                                                |
| Şifre          | Maskelidir. Kaydedilen şifre forma geri yazılmaz ("Kayıtlı — değiştirmek için yazın"); boş bırakırsanız korunur. Sunucuda şifrelenmiş saklanır                                         |
| TLS gerekli    | **Bağlantı güvenliği** bölümündeki anahtar. Açıkken MySQL'e yalnız şifreli (TLS) bağlantı kurulur ve sunucu sertifikası doğrulanır. İnternet üzerinden erişilen sunucularda açık tutun |

### MySQL: bağlantıyı nasıl test ederim?

1. Alanları doldurun (kaydetmeniz gerekmez; test **formdaki değerlerle** yapılır).
2. **Bağlantıyı Test Et**'e basın. "Test 10 saniyeye kadar sürebilir…" yazar.
3. Sonuç: **Bağlantı başarılı** (süre ms ile) veya **Bağlantı kurulamadı** ve nedeni (sunucuya bağlanılamadı, kimlik
   reddedildi, veritabanı yok, zaman aşımı, TLS kurulamadı, kayıtlı şifre okunamadı). Başarısız testte süre gösterilmez.

- **Şifre kuralı:** Şifre alanı boşsa kayıtlı şifre **yalnız aynı sunucu, port ve kullanıcı için** kullanılır. Başka bir
  sunucu veya kullanıcı deniyorsanız şifreyi yazın; yazmazsanız şifre alanının altında "Farklı sunucu veya kullanıcı için
  şifreyi girin" çıkar. Kayıtlı şifre başka bir sunucuya hiçbir zaman gönderilmez.
- **TLS gerekli açıkken:** Test TLS ile yapılır ve sertifika, yazdığınız sunucu adına göre doğrulanır. Sunucu TLS
  desteklemiyorsa veya sertifikası adla uyuşmuyorsa test "Güvenli (TLS) bağlantı kurulamadı…" hatasıyla biter.
- **TLS gerekli kapalıyken:** Test şifreleme kullanmaz; şifre ağda açık gidebilir. Sarı uyarı kutusu bunu hatırlatır.
  Bu kipte yalnız aynı sunucudaki veya güvenilir iç ağdaki MySQL'i test edin.
- Kişi başına dakikada 5, tüm Super Admin'ler için toplam dakikada 20 test yapılabilir.

### MySQL: kaydetmek neyi değiştirir?

**Kaydet**'e basmak çalışan bağlantıyı **değiştirmez**; değer bilgi ve kontrol amacıyla saklanır. Kayıttan sonra şu uyarı
kalıcı olarak görünür: "Uygulamak için .env güncellenip uygulama yeniden başlatılmalı." Gerçek geçiş sunucuda yapılır:
sistem yöneticisi `deploy/.env` içindeki `DATABASE_URL`'i günceller ve servisi yeniden başlatır (`docs/runbook.md` §15).
Kayıtlı değerler çalışan bağlantıdan farklıysa ekranda "Kayıtlı değerler çalışan bağlantıdan farklı…" uyarısı çıkar; bu,
`.env` güncellenmeden kaldıysa hatırlatıcıdır.

- Kayıtlı şifre varken sunucu, port veya kullanıcıyı değiştirip şifreyi boş bırakırsanız kayıt reddedilir; yeni şifreyi
  yazın.

### TURN: nedir, nasıl ayarlanır?

TURN sunucusu, güvenlik duvarı arkasındaki müşterilerde görüntünün aktarılmasını sağlar (coturn). Varsayılan olarak
sunucudaki `.env` değerleri (`TURN_URLS`, `TURN_SECRET`) kullanılır; bu ekran onları panelden değiştirmek içindir.

1. **Sistem ayarları** → **TURN** sekmesi.
2. **Sunucu adresleri**: her satıra bir adres (ör. `turns:turn.ornek.com:443?transport=tcp`, `stun:turn.ornek.com:3478`).
   **Adres ekle** ile satır ekleyin, satır sonundaki düğmeyle kaldırın. En az 1, en çok 10 adres; `stun:`, `turn:` veya
   `turns:` ile başlamalı, boşluk içermemeli.
3. **Gizli anahtar (static-auth-secret)**: coturn sunucusundaki `static-auth-secret` ile **birebir aynı** olmalı. 32–256
   karakter, boşluk ve `#` içermez. Kayıtlıysa boş bırakın, korunur. `turn:`/`turns:` adresi varken anahtar zorunludur.
4. **Kaydet**. Yeni ayar yeni oturumlara hemen, açık oturumlara bir sonraki kimlik yenilemesinde uygulanır.

**Uyarı:** Anahtar coturn'deki ile uyuşmazsa TURN aktarımı çalışmaz ve güvenlik duvarı arkasındaki müşterilerde ekran
gelmez. coturn'deki anahtarı değiştirdiyseniz bu ekranı da aynı anda güncelleyin (runbook §15).

**Ortam değerlerine dön:** Yalnız panel kaydı varken görünür. Basınca onay sorulur (varsayılan seçim "Vazgeç");
onaylarsanız paneldeki adresler ve anahtar silinir, uygulama yeniden `.env` değerlerini kullanır.

### Sık karşılaşılan mesajlar (Sistem ayarları)

| Mesaj                                                                                       | Ne yapmalı                                                                                                                          |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Farklı sunucu veya kullanıcı için şifreyi girin                                             | Şifre alanını doldurun                                                                                                              |
| Kimlik reddedildi (kullanıcı adı veya şifre hatalı)                                         | Kullanıcı adı/şifreyi kontrol edin                                                                                                  |
| Veritabanı bulunamadı veya bu kullanıcının erişimi yok                                      | Veritabanı adını ve kullanıcının yetkisini kontrol edin                                                                             |
| Sunucuya bağlanılamadı / zaman aşımı                                                        | Sunucu adı, port ve ağ erişimini kontrol edin                                                                                       |
| Kayıtlı şifre okunamadı; şifreyi yeniden girin                                              | Sunucunun şifreleme anahtarı değişmiş olabilir; şifreyi yazıp kaydedin                                                              |
| Güvenli (TLS) bağlantı kurulamadı: sunucu TLS desteklemiyor veya sertifikası doğrulanamadı. | MySQL'de TLS'yi açın, sertifikanın sunucu adıyla eşleştiğini kontrol edin; güvenilir iç ağdaysa **TLS gerekli**'yi kapatabilirsiniz |
| Kimliğinizi doğrulayın (pencere)                                                            | Kaydetmek için doğrulama uygulamanızdaki 6 haneli kodu veya bir kurtarma kodunu girin                                               |
| Gizli anahtar en az 32 karakter olmalı / boşluk ve # içermeyen ASCII olmalı                 | coturn'deki anahtarı kurallara uygun üretin ve iki yerde aynı yapın                                                                 |
| En az bir adres gerekli                                                                     | `.env` değerlerine dönmek için **Ortam değerlerine dön**'ü kullanın                                                                 |
| Çok fazla istek                                                                             | Dakikalık test sınırı (5) ya da kaydetme/geri dönme sınırı (MySQL, TURN ve WhatsApp için toplam 10) doldu; bir dakika bekleyin      |

## Super Admin için: Sistem logosu

Sistem logosu, giriş ekranında firma belli değilken ve logosu olmayan firmaların ekranlarında, müşteri sayfalarında ve
e-postalarında görünür. Yüklenmemişse Nokta Bilişim logosu kullanılır. Ekran: **Sistem ayarları** → **Sistem logosu**
sekmesi (resim simgesi). Admin bu adresi açarsa yetki uyarısı görür.

1. **Logo seç** (varsa **Logoyu değiştir**) ile dosyayı seçin, önizlemeyi kontrol edin.
2. **Logoyu kaydet**'e basın. "Sistem logosu kaydedildi" mesajından sonra giriş ekranında yeni logo görünür.

**Sistem logosunu kaldırmak:**

1. Aynı sekmede **Logoyu kaldır**'a basın.
2. "Sistem logosu kaldırılsın mı?" penceresinde onaylayın.
3. "Sistem logosu kaldırıldı; varsayılan Nokta logosu gösteriliyor" mesajı çıkar. Giriş ekranında, PDF çıktılarında ve
   logosu olmayan firmalarda Nokta Bilişim logosu görünür.

Özel logo yoksa sekmede "Özel sistem logosu yok; varsayılan Nokta Bilişim logosu gösteriliyor." yazar. Yükleme ve
kaldırma audit log'a "Sistem" kaydı olarak yazılır. Dosya kuralları ve hata mesajları için bkz.
"Resim dosyası kuralları". Süper Yönetici kendi profil resmini Hesabım sayfasından yönetir.

## Super Admin için: Sistem ayarları > WhatsApp servisi

Firmaların destek talebi WhatsApp bildirimleri ve WhatsApp test mesajları, Nokta Bilişim'in WhatsApp bildirim servisine
gider. Bu sekme o servisin adresini **tüm firmalar için** tek yerden yönetir. Firma yöneticileri (Admin) adresi görmez ve
değiştiremez; yalnız kendi alıcı numaralarını ayarlar.

Ekran: **Sistem ayarları** → **WhatsApp servisi** sekmesi (konuşma balonu simgesi). Admin bu adresi açarsa yetki uyarısı
görür, sekme listelenmez.

### Ekranda ne görürüm?

- **Etkin adres:** Bildirimlerin şu anda gittiği adres. Hiç adres yoksa "Yapılandırılmamış" yazar.
- **Kaynak rozeti:**
  - **Panel** = adres bu ekrandan kaydedilmiş.
  - **Ortam değişkeni** = panelde kayıt yok; sunucu ayar dosyasındaki adres (`WHATSAPP_SERVICE_URL`) kullanılıyor. Bu
    durumda "Panelde kayıtlı adres yok…" bilgi notu çıkar ve **Servis URL'si** alanı boş gelir.
- **Son güncelleme:** Panel kaydının en son ne zaman değiştiği (ortam değişkeninde "—").
- Hiçbir adres yoksa uyarı kutusu: "WhatsApp servisi yapılandırılmamış: panelde kayıt yok ve WHATSAPP_SERVICE_URL tanımlı
  değil…". Sistemin hazır bir varsayılan adresi yoktur; bu durumda bildirim ve test gönderilemez. Adresi girip kaydedin.
- **Servis anahtarı** bölümü ve anahtar rozeti (aşağıda).

**Önemli:** Rozet **Panel** iken sunucudaki ayar dosyasını değiştirmek işe yaramaz; adres bu ekrandan değiştirilir.

### Servis adresini nasıl değiştiririm?

1. **Servis URL'si** alanına adresi yazın (ör. `https://wa.ornek.com` veya `http://10.0.0.5:3000`).
   - `http://` veya `https://` ile başlamalı.
   - Kullanıcı adı/şifre, `?` ve `#` içermemeli; en çok 200 karakter.
   - Sondaki `/` kendiliğinden silinir.
   - Adres standart biçime çevrilerek kaydedilir: büyük harfle yazılan başlangıç ve sunucu adı küçültülür
     (`HTTPS://WA.Ornek.com/` → `https://wa.ornek.com`). Bu bir hata değildir; adres aynı yere gider.
   - Görünmez karakter (ör. kopyalarken gelen sıfır genişlikli boşluk) içeren adres kabul edilmez; adresi elle yazın.
2. Alt çubuktaki **Kaydet**'e basın. "WhatsApp servis adresi kaydedildi" mesajı çıkar, rozet **Panel** olur.
3. Yeniden başlatma gerekmez. Kayıttan sonraki ilk bildirim ve test yeni adrese gider.

Kaydetmeden sayfadan ayrılmaya çalışırsanız kaydedilmemiş değişiklik uyarısı çıkar. Kural dışı adreste alanın altında
hata yazar ve kayıt yapılmaz. Aynı adresi yeniden kaydederseniz hiçbir şey değişmez ve audit log'a kayıt düşmez.
MySQL, TURN ve WhatsApp ayarlarında kaydetme ve geri dönme işlemleri kişi başına dakikada toplam 10 kez yapılabilir.

### Servis anahtarını nasıl girerim?

WhatsApp servisi bir anahtar (API anahtarı) istiyorsa bu anahtar **Servis anahtarı** bölümüne girilir. Anahtar şifreli
saklanır, ekrana bir daha gelmez ve yalnız kayıtlı servis adresine gönderilir.

Anahtar rozeti:

| Rozet               | Anlamı                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------- |
| **Kayıtlı (panel)** | Anahtar bu ekrandan kaydedilmiş                                                               |
| **Kayıtlı (env)**   | Anahtar sunucu ayar dosyasından (`WHATSAPP_SERVICE_API_KEY`) geliyor; adres de oradan geliyor |
| **Tanımlı değil**   | Anahtar yok; servise anahtarsız istek gider                                                   |

Adımlar:

1. **API anahtarı** alanına anahtarı yazın (16–256 karakter, boşluksuz). Göz simgesiyle yazdığınızı görebilirsiniz.
2. Alt çubuktaki **Kaydet**'e basın. Rozet **Kayıtlı (panel)** olur.
3. Doğrulamak için **Test Mesajı Gönder**'i kullanın.

Bilmeniz gerekenler:

- Alanı boş bırakıp kaydederseniz kayıtlı anahtar **değişmez**.
- Adres panelde kayıtlıysa yalnız paneldeki anahtar kullanılır; sunucu ayar dosyasındaki anahtar bu adrese gönderilmez.
- **Adres değişince anahtarı yeniden girin.** Sunucu adını, portunu veya `http`/`https` kısmını değiştirdiğinizde kayıtlı
  anahtar yeni adrese taşınmaz; anahtar alanının altında "Adres değiştiği için servis anahtarını yeniden girin." yazar ve
  kayıt yapılmaz. Anahtarı yeniden yazın ya da kaldırın, sonra kaydedin. Yalnız adresin yolu değişirse anahtar korunur.
- **Anahtarı kaldır** (yalnız panelde kayıtlı anahtar varken görünür): onay sorusundan sonra anahtar silinir. Servis anahtar
  istiyorsa bundan sonraki bildirimler ve testler reddedilir.
- **Ortam değişkenine dön** paneldeki adresle birlikte paneldeki anahtarı da kaldırır.
- Anahtar değişiklikleri audit log'a anahtarın kendisi yazılmadan, yalnız "var / değişti" bilgisiyle düşer.

### "Güvensiz adres" uyarısı ne demek?

Ekranda "Güvensiz adres: canlı ortamda WhatsApp kanalı kapalı. Kalıcı çözüm TLS veya özel ağ." yazıyorsa:

- Canlı ortamda adres `http://` ile başlıyor ve internete açık bir sunucuyu gösteriyor, ya da adres okunamıyor.
  `169.254.x.x` gibi yerel bağlantı (link-local) adresleri iç ağ sayılmaz; bunlar da bu uyarıyı verir.
- Bu durumda **hiçbir WhatsApp bildirimi gönderilmez**; test de servise gitmez ("Servis güvenli yapılandırılmamış.").
- Çözüm: `https://` ile başlayan bir adres veya iç ağdaki (özel IP) bir adres kaydedin.

Firma yöneticileri de kendi **Ayarlar > Destek talepleri** ekranında aynı durumu uyarı olarak görür.

### Test mesajını nasıl gönderirim?

1. **Test mesajı** bölümünde **Telefon numarası** alanına numarayı yazın (ör. `0532 000 00 00` veya `+49 151 1234 5678`).
2. **Test Mesajı Gönder**'e basın. "Test 8 saniyeye kadar sürebilir…" yazar.
3. Sonuç ekranda görünür: **Test mesajı gönderildi** ya da **Test mesajı gönderilemedi** ve kısa neden.

Bilmeniz gerekenler:

- Test **kayıtlı** adresle yapılır. Formda kaydedilmemiş bir adres varsa "Formda kaydedilmemiş adres var; test kayıtlı
  adresle yapılır." notu çıkar; önce **Kaydet**'e basın.
- Hiç adres kayıtlı değilse test düğmesi pasiftir: "Önce servis adresini kaydedin."
- Kişi başına dakikada 5 test, tüm Super Admin'ler için toplam dakikada 20 test yapılabilir.
- Her test audit log'a "WhatsApp test mesajı" olarak yazılır (numara maskeli, sonuç ve neden).

### Ortam değişkenine nasıl dönerim?

**Ortam değişkenine dön** düğmesi yalnız panel kaydı varken görünür.

1. **Ortam değişkenine dön**'e basın.
2. "Ortam değişkenine dönülsün mü?" sorusunu onaylayın.
3. "WhatsApp servisi ortam değişkenine döndü" mesajı çıkar, rozet **Ortam değişkeni** olur.

Paneldeki adres ve servis anahtarı kaldırılır; bildirimler sunucu ayar dosyasındaki adrese gider. Orada da adres yoksa
WhatsApp bildirimi gönderilmez. Değişiklikler audit log'a "WhatsApp servis adresi güncellendi" ve "WhatsApp servisi ortam değerine döndü"
olarak (eski → yeni adres) yazılır.

### Sık karşılaşılan mesajlar (WhatsApp servisi)

| Mesaj                                                                                                 | Ne yapmalı                                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Adres http:// veya https:// ile başlamalı; kullanıcı adı/şifre, ? ve # içeremez (en çok 200 karakter) | Adresi kurala uygun yazın                                                                                                    |
| Servis yapılandırılmamış.                                                                             | Önce servis adresini kaydedin                                                                                                |
| Servis anahtarı reddetti.                                                                             | Anahtar yok veya yanlış. **Servis anahtarı** bölümüne doğru anahtarı girip kaydedin                                          |
| Adres değiştiği için servis anahtarını yeniden girin.                                                 | Adres değişti; anahtarı yeniden yazın veya kaldırın, sonra kaydedin                                                          |
| Servis anahtarı 16–256 karakter olmalı; boşluk ve kontrol karakteri içeremez.                         | Anahtarı boşluksuz ve doğru uzunlukta yazın                                                                                  |
| Servis güvenli yapılandırılmamış.                                                                     | Güvensiz veya okunamayan adres; `https://` ya da iç ağ adresi kaydedin                                                       |
| Servis 8 saniye içinde yanıt vermedi (zaman aşımı).                                                   | Servis yavaş veya kapalı; sistem yöneticisine bildirin, biraz sonra tekrar deneyin                                           |
| Servise ulaşılamadı veya servis hata döndürdü.                                                        | Adresi kontrol edin; servis çalışıyor mu, güvenlik duvarı izin veriyor mu bakın. Ayrıntılı neden audit log kaydındadır       |
| Çok fazla test denendi. Bir dakika sonra tekrar deneyin.                                              | Dakikalık test sınırı doldu; bir dakika bekleyin                                                                             |
| Çok fazla istek. Lütfen biraz sonra tekrar deneyin. (kaydederken)                                     | Dakikada 10 kaydetme/geri dönme sınırı doldu; bir dakika bekleyin                                                            |
| Kayıtlı adres yeni güvenlik kuralına uymuyor (…); kanal kullanılamıyor. Adresi yeniden kaydedin.      | Eski kayıtta kullanıcı adı, şifre veya sorgu var. Adresi yalın biçimde (`https://sunucu`) yazıp kaydedin; anahtar ayrı alana |

## Super Admin için: Sistem ayarları > Virüs tarama (ClamAV)

Firmalar dosyaları sunucu üzerinden aktarmak istediğinde dosyalar ClamAV ile taranır. Bu sekme (kalkan simgesi) tarayıcının
adresini tutar ve bağlantıyı test eder. Ayar **tüm firmalar** için geçerlidir; yalnız Super Admin görür. Başarılı bir test
olmadan hiçbir firma sunucu üzerinden dosya aktarımını açamaz.

### Ekranda ne görürüm?

- **Virüs tarama sunucusu:** **Sunucu** (ör. `clamav`) ve **Port** (varsayılan 3310). Kaynak rozeti **Ortam değişkeni**
  (sunucudaki `.env`), **Panelde kayıtlı** ya da **Yapılandırılmadı** gösterir.
- Son test sonucu: "Son test başarılı (tarih)" ya da "Son test başarısız (tarih)", imza tarihi.
- **Bağlantı testi** bölümü ve **Bağlantıyı Test Et** düğmesi.

### Bağlantıyı nasıl test ederim?

1. **Bağlantıyı Test Et**'e basın.
2. Sonuç kartında şunlara bakın: **Test imzası (EICAR) yakalandı: evet**, **Şifreli arşiv algılandı: evet**, **Sürüm**,
   **İmza tarihi** (… gün önce).
3. İkisi de "evet" ise test başarılıdır; firmalar artık sunucu modunu açabilir.

Test, tarayıcıya ulaşılabildiğini, zararsız bir test virüsünü (EICAR) yakaladığını ve parolalı arşivi "taranamadı"
olarak ayırdığını denetler. Dakikada en çok 6 test yapılabilir.

### Adresi nasıl değiştiririm?

1. **Sunucu** ve **Port** alanlarını değiştirin, **Kaydet**'e basın. Son 5 dakikada doğrulama yapmadıysanız **Kimliğinizi
   doğrulayın** penceresi açılır.
2. "Virüs tarama ayarı kaydedildi. Bağlantıyı yeniden test edin." yazar. Adres değişince eski test geçersiz olur; yeniden
   test edin.

- Adres yalnız virüs tarama ağındaki bir sunucu olabilir. Başka bir adres girerseniz alan altında "Adres virüs tarama
  ağının dışında" yazar.
- İlk testten sonra adres panelde kayıtlı hâle gelir; sunucudaki `.env` değeri değişse de etkisizdir. Adres değişecekse
  buradan kaydedip yeniden test edin.

### İmza tarihi uyarısı

Virüs imzaları kendiliğinden günde birkaç kez güncellenir. İmza tarihi 3 günden eskiyse ekranda uyarı bandı çıkar. Bu
genelde sunucunun internete çıkamadığını gösterir; sistem yöneticisine bildirin (teknik adımlar: `docs/runbook.md` §28b).

### Tarama servisi çalışmazsa ne olur?

Dosyalar güvenli tarafta kalır: taranamayan dosya teslim edilmez, kullanıcı "Dosya taranamadı, teslim edilmedi: tarama
servisine ulaşılamadı" görür. Doğrudan yolu kullanan firmalar etkilenmez. Servis düzelince yeniden test edin.

Ayar değişiklikleri ve testler denetim kaydına "Virüs tarama (ClamAV) ayarı değişti" ve "Virüs tarama bağlantı testi"
olarak yazılır (firma alanı boş).

## Super Admin için: Başka bir Super Admin'in şifresini sıfırlama

Birden fazla Super Admin varsa, şifresini unutan bir Super Admin'e panelden geçici şifre verebilirsiniz. Ekran:
**Sistem ayarları** → **Super Admin'ler** sekmesi.

1. Listede Super Admin'ler adı, e-postası ve 2FA durumuyla görünür. Kendi satırınızda düğme yoktur; kendi şifrenizi
   Hesabım sayfasından değiştirin.
2. Kişinin satırında **Şifre sıfırla**'ya basın.
3. "<Ad> için şifre sıfırlansın mı?" penceresinde **Şifreyi sıfırla**'ya basın.
4. Son 5 dakikada kimliğinizi doğrulamadıysanız **Kimliğinizi doğrulayın** penceresi açılır; 2FA kodunuzu girin (bkz.
   "Kritik bir ayarı değiştirirken 'Kimliğinizi doğrulayın' penceresi").
5. Geçici şifre **yalnız bir kez** gösterilir. Kopyalayıp kişiye güvenli bir kanaldan (yüz yüze, telefon) iletin.
   Pencerede kaç oturumun kapatıldığı da yazar.

- Kişinin tüm açık oturumları ve yürüttüğü destek oturumları hemen kapanır.
- Geçici şifre **24 saat** geçerlidir; kişi ilk girişte yeni şifre belirlemek zorundadır.
- Kişinin 2FA'sı değişmez. 2FA'sını da kaybettiyse sunucu yöneticisine başvurun (aşağıya bakın).
- Listede tek Super Admin varsa "Başka Super Admin yok" yazar; sıfırlama sunucudaki komut satırı aracıyla yapılır.
- "Bu hesap artık etkin bir Super Admin değil; liste yenilendi." yazarsa hesap bu arada pasife alınmış veya rolü
  değişmiştir.
- Kısa sürede çok fazla sıfırlama yapılırsa (dakikada 5) bir süre beklemeniz istenir.

Sıfırlama audit log'a yazılır (geçici şifre yazılmaz).

## Super Admin için: Şifre veya 2FA kaybı

Super Admin'in bir firması olmadığı için SMTP ayarı da yoktur: "Şifremi unuttum" e-posta göndermez ve kimse panelden
Super Admin'in 2FA'sını sıfırlayamaz. Başka bir Super Admin yalnız şifrenizi sıfırlayabilir (bkz. önceki bölüm). Bu yüzden:

- İlk girişte 2FA'yı kurarken 10 kurtarma kodunu **mutlaka** parola kasasına kaydedin.
- Hem telefon hem kurtarma kodları kaybolduysa veya şifre unutulduysa **sunucu yöneticisine başvurun**. Sunucu yöneticisi
  sunucuda şifrenizi (gerekirse 2FA'nızı da) sıfırlar ve size **geçici bir şifre** verir.

Geçici şifreyle giriş:

1. Geçici şifre **24 saat** geçerlidir. Süre dolarsa giriş ekranında "Geçici şifrenin süresi doldu (24 saat). Sunucu
   yöneticisinden yeniden sıfırlama isteyin." yazar; yöneticiden yeni şifre isteyin.
2. Giriş yapınca yeni şifrenizi belirlemeniz istenir; bu adım atlanamaz.
3. 2FA da sıfırlandıysa ardından 2FA'yı yeniden kurar, yeni 10 kurtarma kodunu parola kasasına kaydedersiniz.
4. Sıfırlama sırasında açık olan bütün oturumlarınız kapatılır.

Sıfırlama audit log'a "Super Admin şifresi sunucudan sıfırlandı" olarak yazılır (şifre yazılmaz). Sizin bilginiz dışında
böyle bir kayıt görürseniz hemen sunucu yöneticisine bildirin.

---

## Sık sorulan sorular (SSS)

**Super Admin olarak bir firmanın destek talebini kabul edebilir miyim?**
Hayır. Super Admin bütün firmaların taleplerini görür ve atama yapabilir, ama talebi kabul edemez ve reddedemez: kabul ve
ret yalnız talebin geldiği firmanın kullanıcılarına açıktır ("Talep yalnız kendi firmanızda kabul edilebilir."). Super
Admin başka firmanın oturumuna yalnız **İzle** ile, o firmayı seçerek katılır. Talep akışını denemek için o firmada bir
teknisyen (User) ya da Admin hesabı açın, "Destek talepleri → Kabul et" yetkisini verin ve o hesapla girin.

**Mac müşterisiyle neden sesli konuşamıyorum?**
Mac uygulamasında sesli görüşme 0.26 ve sonrasında vardır. Müşterinin uygulaması daha eskiyse düğme pasiftir; güncel
uygulamayı destek sayfasından indirmesini isteyin. Müşteri Mikrofon iznini vermediyse bkz. "Sesli görüşme (Mac)".

**Mac'te izin açık görünüyor ama uygulama yine izin istiyor; ne yapmalıyım?**
Uygulamayı ⌘Q ile kapatın, Terminal'de `tccutil reset ScreenCapture net.noktabilisim.destek` ve
`tccutil reset Accessibility net.noktabilisim.destek` komutlarını çalıştırın, Sistem Ayarları'nda kalan kaydı **−** ile
kaldırın, uygulamayı klasörden yeniden açıp izni verin (bkz. "Ekran Kaydı izni", 6. adım).

**Müşterinin programı "güncel sürümü indirin" diyor ve bağlanmıyor.**
Programı 0.25.1'den eski. Müşteriye yeni bağlantı gönderin ya da destek sayfasından programı yeniden indirmesini isteyin.

**Gözetimsiz servisi kurarken Windows "bilgisayarınızı korudu" diyor.**
Canlı ortamda servis kod imzasızdır; bu beklenen uyarıdır. Önce dosyanın özetini e-postadaki ya da paneldeki SHA-256 ile
karşılaştırın, eşleşiyorsa **Ek bilgi** → **Yine de çalıştır** deyin (bkz. "Müşteri BT için: servisi kurma").

**Gözetimsiz servis neden kendini güncellemiyor?**
Canlı ortamda servisin otomatik güncellemesi şimdilik kapalıdır. Yeni servis sürümünü elle kurun (bkz. "Eski servis:
Servis güncel değil").
