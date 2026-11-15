# Remote Support — Kullanım Kılavuzu

Bu kılavuz Nokta Bilişim uzaktan destek platformunun kullanıcıya dönük ekranlarını anlatır. Platform paketler hâlinde
geliştirilir (bkz. `README.md` "Yol haritası"); kılavuz da her paketle birlikte büyür. Bu sürümde yer alan bölümler:

- **Müşteri için:** Hızlı Destek uygulaması (Windows), yalnız bir pencereyi paylaşma (0.11), "Destek iste" ile talep gönderme,
  birden çok firmaya kayıt, tepside çalıştırma ve Windows açılışında başlatma, beklerken teknisyenle yazışma (0.12),
  program indirmeden tarayıcıdan talep gönderme (web talep formu, durum bildirimi, "sohbete şifre yazmayın"), bilgisayarın hatırlanması
  ("Bağlantı kodum var", "Bu bilgisayarı unut"), uzaktan kontrol izni, ekran görüntüsü alınamazsa ne yapılır,
  bilgisayarda ne kalır (iz ve gizlilik)
- **Teknisyen için:** Oturumlar ve bekleme odası ("Müşteri bekliyor" rozeti, menü sayacı, bildirim), Uzaktan kontrol
  (konsol; "Pencere paylaşımı" rozeti dahil), Oturum geçmişi (dosyalarda "Doğrulanmış / Müşteri bildirimi", talepte SLA satırı), Destek talepleri ("Bu kaynağı engelle"; öncelik, atama,
  SLA rozetleri, kabul öncesi mesajlaşma),
  Engellenenler, web formundan gelen talepler ("Web" rozeti), oturum bağlantısını SMS veya WhatsApp ile gönderme, müşterinin
  ekranı gelmiyorsa (paylaşım hata nedeni)
- **Admin ve teknisyen için:** Müşteriler (müşteri firmalar, bağlantı gönderme, web talep formu bağlantısı, kayıtlı
  bilgisayarlar, CSV dışa/içe aktarma)
- **Herkes için (teknisyen, Admin, Super Admin):** Giriş ve hesap güvenliği — iki adımlı doğrulama (2FA), kurtarma
  kodları ve kurtarma kodlarını yenileme, şifremi unuttum, Hesabım sayfası, tüm cihazlardan çıkış, kritik ayarlarda kimliğinizi yeniden doğrulama;
  hesap menüsü, profil resmi ve tema; giriş ekranında firma logosu
- **Admin için:** Kullanıcılar ve yetkiler (2FA sıfırlama ve kullanıcıyı kalıcı silme dahil), Uzaktan kontrol yetkisi ve kayıtlar, Oturum geçmişi
  yetkileri, Ayarlar > Genel (oturum ve dosya sınırları), Ayarlar > Destek talepleri (web talep formu, form spam'i altında ne yapılır, müşteriye durum bildirimi, e-posta bildirimi, kabul kodu, öncelik ve SLA dahil), Ayarlar > Mesai saatleri ve Tatiller, Ayarlar > E-posta (SMTP), Ayarlar > SMS, Audit log, Ayarlar >
  Aydınlatma metni, Ayarlar > Güvenlik, Ayarlar > Logo, kullanıcının profil resmi, kişisel verilerin saklama süresi ve
  anonimleştirme, kurumsal bilgisayarlarda Hızlı Destek'e izin verme (AppLocker / antivirüs), ağ gereksinimleri
  (güvenlik duvarı izin listesi)
- **Super Admin için:** Firmalar ve aranabilir firma seçici, firmayı kalıcı silme (24 saat iptal penceresi), tüm firmaların oturum geçmişi, destek talepleri, Sistem ayarları
  (MySQL, TURN, sistem logosunu değiştirme/kaldırma, WhatsApp servisi), başka bir Super Admin'in şifresini sıfırlama,
  şifre/2FA kaybı

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
- **Tüm cihazlardan çıkış**.

### Tüm cihazlardan çıkış

Başka bir bilgisayarda oturumunuzu açık unuttuysanız veya şüpheli bir durum varsa kullanın.

1. Hesabım → **Tüm cihazlardan çıkış** → onaylayın.
2. Kaç oturumun kapatıldığı gösterilir. Şu an kullandığınız oturum açık kalır; diğer cihazlar birkaç saniye içinde
   giriş ekranına düşer ve o cihazlardaki açık destek oturumları sonlanır.

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
- Sizinle yazışabilir (sohbet).
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

- Bağlantıyı telefon, tablet, Mac veya Linux bilgisayarda açmış olabilirsiniz. Hızlı Destek yalnız Windows'ta çalışır.
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
4. **Bağlan** düğmesine tıklayın. Ad yazılmadan ve kutu işaretlenmeden bu düğme çalışmaz.

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
- **Sohbet:** alttaki kutuya yazıp **Gönder**'e tıklayın. Pencere arkadayken yeni mesaj gelirse
  pencere başlığında "(1 yeni)" gibi bir sayı çıkar.
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
| Ekran görüntüsü alınamadı (KOD). …                                   | Parantez içindeki kodu teknisyeninize okuyun; bkz. "Ekran görüntüsü alınamadı yazıyor". Sohbet ve dosya yine çalışır.                                                                                                                         |
| Ekran görüntüsü alınamadı; teknisyen ekranınızı göremiyor.           | Eski sürüm (0.10.1 ve öncesi) bu metni kodsuz gösterir. Teknisyeninize söyleyin; Windows "N" sürümlerinde Media Feature Pack gerekir.                                                                                                         |
| Bağlantı kesildi                                                     | İnternetinizi kontrol edin. Kod hâlâ geçerliyse programı yeniden açın.                                                                                                                                                                        |
| Bu program hatalı derlenmiş (sunucu adresi yok).                     | Dosya bozuk veya yanlış. Teknisyeninizden yeni bir indirme bağlantısı isteyin.                                                                                                                                                                |
| Program dosyası okunamadı.                                           | Dosyayı yeniden indirip tekrar deneyin.                                                                                                                                                                                                       |
| İzin ver düğmesi çalışmıyor                                          | İlk 1,5 saniye beklenir; sonra kendi farenizle tıklayın. Kırmızı "kısayol kaydedilemedi" uyarısı varsa izin verilemez. "Bu tıklama uzak bağlantı … kabul edilmedi" uyarısı çıktıysa bilgisayarın başındaki kişi kendi faresiyle tıklamalıdır. |
| Teknisyen tıklıyor ama bir pencerede hiçbir şey olmuyor              | O pencere yönetici yetkisiyle açılmış olabilir (ör. yönetici komut istemi). Teknisyen bunu konsolda görür; gerekirse işlemi siz yapın.                                                                                                        |
| Windows onay ekranı (UAC) açıkken teknisyen ekranı göremiyor         | Bu ekran güvenlik gereği paylaşılmaz. Onayı siz verin; görüntü kendiliğinden geri gelir.                                                                                                                                                      |

### Teknisyeni beklemeden destek isteyebilir miyim? ("Destek iste")

Evet. Firmanız size kendi **firma bağlantısını** verdiyse, teknisyenden kod beklemeden talep gönderebilirsiniz.
Bu bağlantıdan inen dosyanın adı `NoktaDestek-<firma adı>-…exe` biçimindedir (ör. `NoktaDestek-Acme-k3pqxr2mab4cde7f.exe`).
Bu özellik Hızlı Destek **0.9.0** ve sonrasında vardır.

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
   işaretleyin.
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
| Sunucuyla bağlantı kesildi                                     | İnternet uzun süre kopmuş. Bağlantınızı kontrol edip **Yeniden talep oluştur**'a tıklayın; bilgileriniz formda durur.                                                                                                    |
| Talebiniz zaman aşımına uğradı                                 | Firmanız bekleme süresinde yanıt veremedi. **Yeniden talep oluştur** veya firmanızı arayın.                                                                                                                              |
| Firmanız talebinizi yanıtladı / Firmanızın mesajı: …           | Talep reddedildi; ekranınız paylaşılmadı. Mesajdaki yönlendirmeyi izleyin.                                                                                                                                               |
| Talebiniz iptal edildi — Firmanız şu an talep kabul etmiyor.   | Firmanızı telefonla arayın.                                                                                                                                                                                              |
| Bağlantı süresi doldu                                          | Bağlantı isteğine 1 dakika içinde yanıt verilmedi. Gerekirse yeniden talep oluşturun.                                                                                                                                    |
| Bağlantı kurulamadı                                            | Teknisyen kabul etti ama bağlantı kurulamadı. Yeniden talep oluşturun veya firmanızı arayın.                                                                                                                             |
| Talep başka bir pencerede açıldı                               | Aynı talep başka bir pencerede izleniyor; bu pencereyi kapatabilirsiniz.                                                                                                                                                 |

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
  gerekiyorsa aynı sayfadaki "Uzaktan kontrol gerekiyorsa Windows programını indirin" bağlantısını kullanın.
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
- **Silmek için:** ana ekranda **Bu bilgisayarı unut**'a tıklayın; ayar ve kilit dosyaları, tanılama dosyası, boş kalan
  klasör ve Windows açılışı kaydı silinir. Kayıt yokken **Bilgilerimi unut** da aynı şekilde her şeyi siler.

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
**Pencere paylaşımı** rozeti görünür (üzerine gelince "Müşteri yalnız bir pencereyi paylaşıyor (Pencere yakalama (WGC))").

- Yalnız o pencerenin içini görürsünüz. Monitör seçimi gizlenir; ekran değiştirme ve işaretleme yoktur.
- Kontrol izniyle tıklamanız yalnız o pencereye gider. Üstüne başka pencere gelmiş bir bölgeye tıklarsanız hiçbir şey olmaz.
- Klavyeniz yalnız müşteride o pencere öndeyken çalışır; müşteri başka programa geçerse yazdıklarınız gitmez ve sonradan
  da yazılmaz. Pencerenin "Farklı kaydet" gibi küçük pencereleri öndeyken yalnız fare çalışır.
- **Klavye kısayolları kısıtlıdır:** Windows tuşu ve Win+… kısayolları, Alt+Tab, Alt+Esc, Ctrl+Esc, Ctrl+Shift+Esc ve
  Print Screen müşteriye gitmez (**Özel tuşlar** menüsünden gönderseniz de). Müşteride Yapışkan Tuşlar veya Fare Tuşları
  açıksa tek başına Ctrl/Alt sonrası Tab/Esc ve sayısal tuş takımı da gitmez; rakam için üst sırayı kullanın. Ctrl+C,
  Ctrl+V ve Alt+F4 çalışır. Hızlı yazımda saniyede 40 tuştan fazlası düşer.
- Müşteri pencereyi küçültürse siyah ekran ve "Pencere simge durumunda" görürsünüz; girdiniz uygulanmaz. Pencere kapanırsa
  kırmızı uyarı çıkar: **"Neden: Paylaşılan pencere kapatıldı — Pencere yakalama (WGC)"**. Müşteri oturumu yeniden başlatır.
- Tüm ekrana ihtiyacınız varsa müşteriden oturumu bitirip yeniden bağlanırken **Tüm ekran**'ı seçmesini isteyin.

### Kontrolün kendiliğinden kapandığı durumlar

| Konsolda gördüğünüz                                    | Ne oldu                                                | Ne yapmalı                                                          |
| ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------- |
| Kontrol müşteri tarafından kapatıldı                   | Müşteri "Kontrolü kapat"a tıkladı                      | Müşteriyle konuşun; gerekirse yeniden isteyin                       |
| Kontrol müşteri tarafından kısayolla kapatıldı         | Müşteri Ctrl+Shift+F12 (veya F11) bastı                | Aynı                                                                |
| Kontrol sistem tarafından kapatıldı (yetki veya kayıt) | Yetkiniz kaldırıldı veya izin kaydı yazılamadı         | Yetkiniz varsa yeniden deneyin; tekrarlıyorsa yöneticinize bildirin |
| Uzaktan kontrol yetkiniz yok; kontrol istenemez        | Hesabınızda yetki yok veya oturum sırasında kaldırıldı | Yöneticinizden yetki isteyin; yeni oturumda geçerli olur            |
| Müşteri bağlantısı koptu; kontrol kapandı              | Müşterinin interneti gitti                             | Yeniden bağlanınca yeniden isteyin                                  |
| Bağlantı yenilendi; kontrol yeniden istenmeli          | Sizin bağlantınız koptu veya sekmeyi yenilediniz       | Yeniden isteyin                                                     |
| Müşteri tarafında bağlantı kesildi; istek kapandı      | İstek beklerken müşterinin görüntü bağlantısı koptu    | Ret sayılmaz; hemen yeniden isteyebilirsiniz                        |

### Uyarılar

- **"Yükseltilmiş pencere — kontrol edilemiyor. Müşteriden onaylamasını isteyin."** Müşterinin önündeki pencere yönetici
  yetkisiyle açılmış. Windows bu pencereye uzaktan girdi kabul etmez. İşlemi müşteriye yaptırın.
- **"Müşteri güvenli masaüstünde"** Müşteride Windows onay ekranı (UAC) veya kilit ekranı açık. Bu sırada görüntü
  durur, kontrol uygulanamaz. Müşteri işlemi bitirince görüntü geri gelir.
- **"Müşteri istemcisi yönetici olarak çalışıyor — yükseltilmiş pencereler ve UAC ekranı denetlenebilir"** Müşteri
  Hızlı Destek'i yönetici olarak açmış. Kontrol engellenmez; müşteri de ekranında bir uyarı görür. Gerekmiyorsa
  müşteriden programı normal açmasını isteyin.

### Sohbette "Çok hızlı yazıyorsunuz" uyarısı

Konsolda ve müşterinin tarayıcı sayfasında sohbetten saniyede en çok **5 mesaj** gönderilebilir. Daha hızlı gönderirseniz
mesaj **gönderilmez**, yazdığınız metin kutuda kalır ve altında "Çok hızlı yazıyorsunuz. Mesaj gönderilmedi; bir saniye
sonra yeniden gönderin." yazar. Bir saniye bekleyip **Gönder**'e yeniden basın. Sınırın içinde gönderilen mesajlar karşı
tarafa eksiksiz ulaşır.

---

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

1. Listede müşterinin satırındaki (veya detay sayfasındaki) **Kopyala**'ya tıklayın. 2 saniye "Kopyalandı" yazar.
   Tarayıcı panoya izin vermezse bağlantı seçili hâlde gösterilir; Ctrl+C ile kopyalayın.
2. Bağlantıyı e-posta veya mesajla müşteriye gönderin. Sistem müşteriye kendisi göndermez.
3. Müşteri dosyayı bir kez indirip masaüstüne kaydetsin. Destek gerektiğinde dosyayı açıp **Destek iste**'ye bassın.
4. Windows "Bilgisayarınız korundu" uyarısı gösterirse müşteri **Ek bilgi** → **Yine de çalıştır**'a basmalıdır.

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
   yetkiler (Görüntüle, Ekle, Düzenle, Sil, Dışa aktar; "Diğer" sütununda Zorla sonlandır, Kullan, Kabul / ret).
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

Nasıl değiştiririm?

1. **Ayarlar > Genel**'i açın.
2. Değeri değiştirin. Altta "Genel ayarlarda kaydedilmemiş değişiklik var" çubuğu çıkar.
3. **Kaydet**'e basın; "Genel ayarlar kaydedildi" yazar. Vazgeçmek için **Vazgeç**.

- Aralık dışındaki değerde kayıt yapılmaz; hatalı alanın altında neden yazar ve imleç o alana gider.
- Yeni değerler **yeni oturumlarda** geçerli olur; açık oturumlar eski sınırla sürer.
- Her değişiklik denetim kaydına eski → yeni değerle yazılır.
- Kaydetmeden sayfadan ayrılmaya çalışırsanız kaydedilmemiş değişiklik uyarısı çıkar.
- Ayarlar okunamazsa sayfada hata ve **Tekrar dene** düğmesi görünür.

## Admin için: Ayarlar > Destek talepleri

Kenar menüsünde **Ayarlar** (yetki "Ayarlar → Düzenle") açılır. Bu ekran firmanızın destek talebi ayarlarını tutar.
Değişiklikler sayfanın altındaki **Kaydet** ile kaydedilir; kaydetmeden çıkmak isterseniz tarayıcı uyarır.

### Genel bağlantı nasıl paylaşılır?

Bu bağlantı müşteri firmaya atanmamış talepler içindir; bu dosyadan gelen talepler "Genel" görünür. Müşteriye özel
bağlantılar **Müşteriler** ekranındadır (bkz. "Admin ve teknisyen için: Müşteriler").

1. **Genel bağlantı** bölümünde bağlantı ve dosya adı (`NoktaDestek-<firma>-….exe`) görünür.
2. **Kopyala** ile bağlantıyı alın. Müşterilerinize e-posta imzası, web siteniz, sözleşme veya karşılama yazısıyla iletin.
3. Müşteri bağlantıdan dosyayı indirir ve ihtiyaç olduğunda talep gönderir. Dosya her müşteri için aynıdır; kurulum gerekmez.

### Bağlantıyı ne zaman yenilemeliyim?

**Bağlantıyı yenile** eski Genel bağlantıyı, daha önce indirilmiş Genel dosyaları ve Genel olarak kayıtlı bilgisayarları
**hemen geçersiz** kılar; müşteri firmalara ait bağlantılar ve bekleyen talepler etkilenmez. Şu durumlarda yenileyin:

- Bağlantı istemediğiniz yerlere yayıldıysa veya sahte talepler geliyorsa,
- Panelde "Olağan dışı talep yoğunluğu" bandı sık görünüyorsa,
- Firmanızın adı değiştiyse (eski adlı dosyalar zaten çalışmaz).

Yeniledikten sonra yeni bağlantıyı tüm müşterilerinize göndermeniz gerekir. "Son yenileme" alanı tarihi gösterir.

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

**Güvenlik "Yok" seçilirse** kullanıcı adı ve şifre alanları kapanır: şifresiz bağlantıda kimlik bilgisi gönderilmez.
Sağlayıcınız kimlik doğrulaması istiyorsa SSL veya TLS seçin.

**İç ağ adresleri kabul edilmez:** sunucu adresi şirket içi/özel bir IP'ye (ör. 192.168.x.x, 10.x.x.x) çıkıyorsa
"Bu sunucu adresi kullanılamaz." uyarısı çıkar. İnternetten erişilen bir SMTP sunucusu kullanın.

### Test maili nasıl gönderilir?

1. Ayarı **kaydedin** (kaydedilmemiş değişiklik varken test düğmesi pasiftir; test kayıtlı ayarla yapılır).
2. **Test Maili Gönder** → alıcı adresini yazın → gönderin.
3. Sonuç pencerede görünür. Başarısız bir test **12 saniyeye kadar** sürebilir; bu sırada pencerede "Sunucuya bağlanılıyor…" yazar ve
   pencere sonuç gelene kadar kapanmaz.
4. Hata mesajı tek ve geneldir ("E-posta gönderilemedi. Sunucu, port, güvenlik ve kimlik bilgilerini kontrol edin.");
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

## Teknisyen için: Oturum bağlantısını e-postayla gönderme

1. **Oturumlar** → **Yeni destek oturumu** → oturumu oluşturun.
2. Bağlantının gösterildiği pencerede **Linki e-postayla gönder** → müşterinin e-posta adresini yazın → gönderin.
3. "Bağlantı … adresine gönderildi." mesajını görürsünüz. E-postada adınız, firma, bağlantı, 8 haneli kod ve son
   geçerlilik saati bulunur.

- Yalnız bu pencere açıkken gönderilebilir (bağlantı güvenlik gereği sonradan gösterilmez).
- Yalnız bekleyen (müşteri henüz katılmamış) oturum gönderilebilir. Saatte en çok 20 e-posta.
- Firmanın SMTP ayarı yoksa veya gönderim başarısızsa satırda hata görünür; bağlantıyı kopyalayıp başka yolla iletin.

## Teknisyen için: Oturum bağlantısını SMS veya WhatsApp ile gönderme

Yetki: "Oturumlar → Oluştur" ve "Oturumlar → Bağlantı gönder (SMS/WhatsApp)". Admin'de açık, teknisyende kapalı başlar.

1. **Oturumlar** → **Yeni destek oturumu** → oturumu oluşturun.
2. Bağlantının gösterildiği pencerede **SMS / WhatsApp ile gönder**'e basın.
3. Kanalı seçin. Yalnız kullanılabilir kanallar görünür (SMS: Ayarlar > SMS; WhatsApp: sistem WhatsApp servisi). İkisi de
   yoksa "SMS ve WhatsApp şu an kullanılamıyor…" yazar.
4. **Müşterinin cep telefonu** alanına numarayı yazın (ör. `0532 000 00 00`). Altında gönderilecek numara uluslararası
   biçimde görünür. Oturum bir talepten doğduysa alan talepteki numarayla dolu gelir.
5. **Gönder**'e basın. "Bağlantı SMS ile gönderildi: …" ya da "Bağlantı WhatsApp ile gönderildi: …" mesajı çıkar.

Mesajda firma adı, bağlantı, adınız ("Ad S." biçiminde) ve "Bağlantıyı kimseyle paylaşmayın." uyarısı bulunur.

- SMS yalnız Türkiye cep numaralarına gider; yurt dışı numara için WhatsApp'ı seçin.
- Yalnız bekleyen (müşteri henüz katılmamış) oturumun bağlantısı gönderilir.
- Sınırlar: kişi başına saatte 20 gönderim (SMS + WhatsApp), aynı numaraya saatte 5, firma başına saatte 200. Sınıra
  gelince düğme "Bekleyin (…)" geri sayımı gösterir.
- "SMS gönderilemedi…" / "WhatsApp mesajı gönderilemedi…" çıkarsa bağlantıyı kopyalayıp başka yolla iletin ve
  Admin'inize haber verin. Her gönderim denetim kaydına yazılır (numara maskeli).

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

| Veri                                                    | Ne zaman                                     | Ne olur                                                                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bitmiş, süresi dolmuş veya iptal edilmiş destek oturumu | Oluşturulmasından saklama süresi kadar sonra | Müşteri adı, e-postası, not, onay kayıtlarındaki IP/tarayıcı ve dosya kayıtları silinir; oturum "Anonimleştirildi" olur (bkz. "Anonimleştirildi rozeti ne demek?") |
| Destek talebi                                           | Saklama süresi dolunca                       | Ad, telefon, e-posta ve açıklama silinir                                                                                                                           |
| Pasif müşteri                                           | Pasife alındıktan saklama süresi kadar sonra | Yetkili kişi, telefon, e-posta ve not silinir ("Anonimleştirildi")                                                                                                 |
| Kayıtlı bilgisayar                                      | Son kullanımdan saklama süresi kadar sonra   | Kayıt geçersiz olur; müşteri yeni dosya veya kodla bağlanır                                                                                                        |
| Audit log                                               | 730 gün (firmaya göre değişmez)              | Silinir                                                                                                                                                            |
| Giriş oturumları ve şifre sıfırlama bağlantıları        | Süreleri bittikten 7 gün sonra               | Silinir                                                                                                                                                            |

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
değiştirirken 'Kimliğinizi doğrulayın' penceresi"). Bu ayarlar **tüm firmalar için** geçerlidir. Sayfada dört sekme vardır:
**MySQL**, **TURN**, **Sistem logosu** (bkz. "Super Admin için: Sistem logosu") ve **WhatsApp servisi** (bkz. "Super
Admin için: Sistem ayarları > WhatsApp servisi"). Her değişiklik audit log'a yazılır (firma alanı boş, "Sistem" kaydı olarak).

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
