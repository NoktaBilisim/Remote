# Remote Support — Kullanım Kılavuzu

Bu kılavuz Nokta Bilişim uzaktan destek platformunun kullanıcıya dönük ekranlarını anlatır. Platform paketler hâlinde
geliştirilir (bkz. `README.md` "Yol haritası"); kılavuz da her paketle birlikte büyür. Bu sürümde yer alan bölümler:

- **Müşteri için:** Hızlı Destek uygulaması (Windows), uzaktan kontrol izni
- **Teknisyen için:** Uzaktan kontrol (konsol), Oturum geçmişi
- **Admin için:** Uzaktan kontrol yetkisi ve kayıtlar, Oturum geçmişi yetkileri
- **Super Admin için:** Tüm firmaların oturum geçmişi

Teknisyen konsolunun diğer bölümleri ve yönetim paneli, ilgili ekranlar tamamlandıkça eklenecektir.

---

## Müşteri için: Hızlı Destek uygulaması (Windows)

Hızlı Destek, teknisyenin ekranınızı görmesini sağlayan küçük bir Windows programıdır. Kurulum gerektirmez,
yönetici şifresi sormaz, bilgisayarınızda iz bırakmaz. Program kapandığında hiçbir parçası çalışmaya devam etmez.

**Ne gerekir?**
- Windows 10 veya Windows 11 yüklü bir bilgisayar.
- İnternet bağlantısı.
- Teknisyeninizin size gönderdiği **destek bağlantısı** veya **8 haneli destek kodu**.
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
- Karşılama penceresinin sağ üstünde şimdilik firmanızın değil **Nokta Bilişim'in logosu** görünür. Firma adı ve
  teknisyen adı yazı olarak yine gösterilir.
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

| Ne görürsünüz | Ne kontrol edersiniz |
|---|---|
| **Teknisyen:** ad | Telefondaki kişinin adıyla aynı mı? |
| **Teknisyen doğrulama kodu** | Teknisyen bu kodu telefonda size söylemeli. Söyleyemiyorsa veya farklıysa devam etmeyin. |
| **Bağlanılan sunucu:** adres | Destek sayfasındaki adresle aynı olmalı. Farklıysa pencereyi kapatın. |
| En alt satır: **Sunucu · Sürüm · Parmak izi** | Programın kimlik bilgisi. Şirketinizin BT sorumlusu isterse bu bilgiyi verin. |

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
ekran seçili gelir. İstediğiniz ekranı seçip **Paylaş**'a tıklayın. Tek monitörde bu soru sorulmaz.

Paylaşım başlayınca:
- Paylaşılan ekranın kenarında **kırmızı bir çerçeve** ve üstte **"Ekranınız izleniyor — <teknisyen adı>"** yazısı
  görünür. Bu çerçeve oturum boyunca hep en üstte kalır; teknisyenin görüntüsünde görünmez.
- **Nokta Destek — Oturum** penceresi açılır. Burada bağlantı durumu, sohbet ve **Oturumu bitir** düğmesi bulunur.
- **Sohbet:** alttaki kutuya yazıp **Gönder**'e tıklayın. Pencere arkadayken yeni mesaj gelirse
  pencere başlığında "(1 yeni)" gibi bir sayı çıkar.
- İnternet kısa süre koparsa "Bağlantı koptu, yeniden bağlanılıyor…" yazar. Program 2 dakika içinde kendiliğinden
  yeniden bağlanır; bir şey yapmanız gerekmez.
- Oturumun bitmesine 5 dakika kala durum satırında uyarı çıkar.

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
- Teknisyenin uzaktan yaptığı tıklama bu pencerede **sayılmaz**. İzni yalnız siz verebilirsiniz.
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
| Mesaj | Anlamı |
|---|---|
| Teknisyen kontrolü bıraktı | Teknisyen işini bitirdi; fare ve klavye yeniden yalnız sizde. |
| Teknisyen isteği geri çekti | Teknisyen isteğinden vazgeçti; açık olan izin penceresi kapandı. |
| Uzaktan kontrol kapatıldı. | Kontrolü siz kapattınız. |
| Uzaktan kontrol sunucu tarafından kapatıldı. | Sistem kontrolü kapattı (ör. teknisyenin yetkisi kaldırıldı). |
| Teknisyenin bağlantısı koptu — uzaktan kontrol kapatıldı | Teknisyenin bağlantısı gitti; kontrol güvenlik için kapandı. |
| Seçilen ekran paylaşılamadı; önceki ekran paylaşılıyor. | Yeni ekrana geçilemedi; teknisyen önceki ekranı görmeye devam eder. |

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
| Mesaj | Ne yapmalı |
|---|---|
| Kod 8 rakamdan oluşmalıdır. | Kodu eksiksiz yazın (yalnız rakam). |
| Kod geçersiz | Kodu teknisyeninizden kontrol edip yeniden girin. |
| Bu destek bağlantısının süresi doldu | Bağlantılar kısa süre geçerlidir. Teknisyeninizden yenisini isteyin. |
| Bu bağlantı zaten kullanıldı | Her bağlantı bir kez kullanılır. Teknisyeninizden yenisini isteyin. |
| Oturum iptal edildi | Teknisyen oturumu iptal etti. Gerekirse yeni bağlantı isteyin. |
| Çok fazla deneme | Birkaç dakika bekleyip tekrar deneyin. |
| Sunucuya ulaşılamıyor | İnternet bağlantınızı kontrol edip tekrar deneyin. |
| Bekleme odası dolu | Birkaç dakika sonra tekrar deneyin. |
| Sayfanın süresi doldu; bilgiler yenilendi. Lütfen yeniden onaylayın. | Adınızı ve onay kutusunu yeniden kontrol edip **Bağlan**'a tıklayın. |
| Ekran görüntüsü alınamadı; teknisyen ekranınızı göremiyor. | Teknisyeninize söyleyin. Windows "N" sürümlerinde Media Feature Pack gerekir. Sohbet ve dosya yine çalışır. |
| Bağlantı kesildi | İnternetinizi kontrol edin. Kod hâlâ geçerliyse programı yeniden açın. |
| Bu program hatalı derlenmiş (sunucu adresi yok). | Dosya bozuk veya yanlış. Teknisyeninizden yeni bir indirme bağlantısı isteyin. |
| Program dosyası okunamadı. | Dosyayı yeniden indirip tekrar deneyin. |
| İzin ver düğmesi çalışmıyor | İlk 1,5 saniye beklenir; sonra kendi farenizle tıklayın. Kırmızı "kısayol kaydedilemedi" uyarısı varsa izin verilemez. |
| Teknisyen tıklıyor ama bir pencerede hiçbir şey olmuyor | O pencere yönetici yetkisiyle açılmış olabilir (ör. yönetici komut istemi). Teknisyen bunu konsolda görür; gerekirse işlemi siz yapın. |
| Windows onay ekranı (UAC) açıkken teknisyen ekranı göremiyor | Bu ekran güvenlik gereği paylaşılmaz. Onayı siz verin; görüntü kendiliğinden geri gelir. |

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

### Kontrolün kendiliğinden kapandığı durumlar
| Konsolda gördüğünüz | Ne oldu | Ne yapmalı |
|---|---|---|
| Kontrol müşteri tarafından kapatıldı | Müşteri "Kontrolü kapat"a tıkladı | Müşteriyle konuşun; gerekirse yeniden isteyin |
| Kontrol müşteri tarafından kısayolla kapatıldı | Müşteri Ctrl+Shift+F12 (veya F11) bastı | Aynı |
| Kontrol sistem tarafından kapatıldı (yetki veya kayıt) | Yetkiniz kaldırıldı veya izin kaydı yazılamadı | Yetkiniz varsa yeniden deneyin; tekrarlıyorsa yöneticinize bildirin |
| Uzaktan kontrol yetkiniz yok; kontrol istenemez | Hesabınızda yetki yok veya oturum sırasında kaldırıldı | Yöneticinizden yetki isteyin; yeni oturumda geçerli olur |
| Müşteri bağlantısı koptu; kontrol kapandı | Müşterinin interneti gitti | Yeniden bağlanınca yeniden isteyin |
| Bağlantı yenilendi; kontrol yeniden istenmeli | Sizin bağlantınız koptu veya sekmeyi yenilediniz | Yeniden isteyin |
| Müşteri tarafında bağlantı kesildi; istek kapandı | İstek beklerken müşterinin görüntü bağlantısı koptu | Ret sayılmaz; hemen yeniden isteyebilirsiniz |

### Uyarılar
- **"Yükseltilmiş pencere — kontrol edilemiyor. Müşteriden onaylamasını isteyin."** Müşterinin önündeki pencere yönetici
  yetkisiyle açılmış. Windows bu pencereye uzaktan girdi kabul etmez. İşlemi müşteriye yaptırın.
- **"Müşteri güvenli masaüstünde"** Müşteride Windows onay ekranı (UAC) veya kilit ekranı açık. Bu sırada görüntü
  durur, kontrol uygulanamaz. Müşteri işlemi bitirince görüntü geri gelir.
- **"Müşteri istemcisi yönetici olarak çalışıyor — yükseltilmiş pencereler ve UAC ekranı denetlenebilir"** Müşteri
  Hızlı Destek'i yönetici olarak açmış. Kontrol engellenmez; müşteri de ekranında bir uyarı görür. Gerekmiyorsa
  müşteriden programı normal açmasını isteyin.

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

"Oturum bulunamadı" görürseniz oturum sizin değildir, silinmiştir ya da bağlantı hatalıdır.

### Nasıl ticket numarası ve not eklerim?
1. Oturumun ayrıntısını açın, **Ticket ve not** bölümüne gelin.
2. **Ticket no** (yardım masası kayıt numarası, en çok 50 karakter) ve **Not** (en çok 4.000 karakter) alanlarını
   doldurun. Sayaç sınırı aşınca kırmızı olur.
3. **Kaydet**'e basın. "Ticket ve not kaydedildi" mesajı çıkar. Vazgeçmek için **Değişiklikleri geri al**.
- Alanı boşaltıp kaydederseniz ticket/not silinir. Bitmiş oturumlara da not eklenebilir.
- Kaydetmeden başka sayfaya geçmeye çalışırsanız uyarı çıkar (**Sayfada kal** / **Kaydetmeden ayrıl**). Tarayıcının
  geri tuşu bu uyarıyı her zaman vermez; önce kaydedin.
- Alanlar görünüyor ama düzenlenemiyorsa ("Ticket ve notu düzenleme yetkiniz yok") yöneticinizden yetki isteyin.

### Nasıl CSV olarak dışa aktarırım ve Excel'de açarım?
1. Listede istediğiniz filtreleri uygulayın.
2. Sağ üstteki **Dışa aktar (CSV)**'ye basın. Dosya `oturumlar-YYYYAAGG-SSdd.csv` adıyla iner.
3. Dosyaya çift tıklayın. Türkçe Excel dosyayı doğrudan sütunlara ayırır; Türkçe harfler doğru görünür, saatler
   Türkiye saatidir.
- Dosyada: oturum no, oluşturma/başlangıç/bitiş, süre, durum, mod, teknisyen, müşteri, ticket no, sonlandıran,
  bitiş nedeni, not. E-posta ve onay kayıtları dosyaya girmez.
- `=`, `+`, `-`, `@` ile başlayan değerlerin başında `'` görebilirsiniz. Bu bilerek eklenir; hücre formül olarak
  çalışmaz, metin kalır.
- Sütunlar tek sütunda toplanırsa Excel'in liste ayracı `;` değildir: **Veri → Metni Sütunlara Dönüştür** ile ayraç
  olarak noktalı virgül seçin.
- Düğme görünmüyorsa dışa aktarma yetkiniz yoktur.

| Mesaj | Ne yapmalı |
|---|---|
| En çok 50.000 satır dışa aktarılabilir; tarih aralığını daraltın | Tarih aralığını kısaltın veya filtre ekleyin |
| Kısa sürede çok fazla dışa aktarma yapıldı. N dakika sonra tekrar deneyin. | Dakikada en çok 5 dışa aktarma yapılabilir; bekleyin |
| Dışa aktarılamadı · Sunucuya ulaşılamadı | Bağlantınızı kontrol edip tekrar deneyin |

---

## Admin için: Uzaktan kontrol yetkisi ve kayıtlar

### Yetki
- Uzaktan kontrol **Uzaktan kontrol → Kullan** (`remote_control.use`) yetkisine bağlıdır. Yetkisi olmayan teknisyen
  konsolda kontrol düğmesini görmez; sunucu da isteği reddeder.
- Kullanıcı yetki ekranı (aç/kapa anahtarları) P9 paketiyle gelecektir. O zamana kadar staging hesapları
  `deploy/staging-users.sh` ile oluşturulur ve teknisyen hesabına bu yetki açık gelir (`docs/runbook.md` §6).
- **Yetki kaldırılınca:** teknisyenin bağlantısı her 60 saniyede bir yeniden denetlenir. Yetki kaldırıldıysa açık
  kontrol kapanır, müşteri tarafında "Uzaktan kontrol sunucu tarafından kapatıldı." yazar ve teknisyen yeni istek
  gönderemez. Hesap pasife alınır veya rolü değişirse teknisyenin tüm oturumları sonlanır. Oturum sırasında yetki
  **verilirse** bu yalnız yeni oturumlarda geçerli olur.

### Kayıtlar (audit)
Her uzaktan kontrol adımı denetim kaydına yazılır; klavye ve fare içeriği hiçbir yere yazılmaz. Audit log ekranı P11
paketiyle gelecektir; kayıtlar o zamana kadar veritabanında tutulur.

| Kayıt | Ne zaman |
|---|---|
| `control.requested` | Teknisyen kontrol istedi ve istek müşteriye iletildi |
| `control.granted` | Müşteri izin verdi (istemcinin yönetici olarak çalışıp çalışmadığı da yazılır) |
| `control.denied` | Müşteri reddetti |
| `control.released` | Teknisyen kontrolü bıraktı |
| `control.cancelled` | Teknisyen isteği geri çekti, ya da istek müşteri karar vermeden kapandı |
| `control.revoked` | Kontrol kapandı: müşteri (düğme/kısayol), bağlantı kopması, yetki kaldırılması veya oturum sonu |
| `monitor.requested` / `monitor.granted` / `monitor.denied` | Monitör değiştirme isteği, onayı, reddi |
| `session.caps_changed` | Teknisyenin oturumdaki yetkileri daraldı |

İzin, ret ve kapanışlar ayrıca KVKK onay kanıtı olarak saklanır. **İzin kaydı yazılamazsa kontrol hiç açılmaz**:
müşterinin onayı kaydedilmeden teknisyen bilgisayarı kullanamaz.

---

## Admin için: Oturum geçmişi

- Admin firmasındaki **tüm teknisyenlerin** oturumlarını görür; listede **Teknisyen** sütunu ve filtresi vardır.
  Teknisyen filtresinin seçenekleri şimdilik o sayfadaki kayıtlardan gelir (tam liste kullanıcı yönetimiyle, P9).
- Yetkiler üç ayrı anahtardır: **Oturum geçmişi → Görüntüle** (`session_history.view`), **Düzenle** (ticket/not,
  `session_history.edit`), **Dışa aktar** (CSV, `session_history.export`). Admin'de varsayılan açık, User'da kapalıdır.
  Yetki ekranı P9'da gelir; o zamana kadar staging teknisyen hesabına yalnız görüntüleme açılır.
- Güvenlik gereği bekleyen bir oturumun 8 haneli kodu yalnız oturumu açan teknisyene gösterilir.
- Kayıtlar: not/ticket değişikliği `session.updated` (not metni değil, yalnız uzunluğu), her dışa aktarma
  `session.exported` (filtreler ve satır sayısı; aranan müşteri adı değil) olarak denetim kaydına yazılır.

## Super Admin için: Tüm firmaların oturum geçmişi

- Super Admin firma seçmeden **Oturum geçmişi**'ni açtığında tüm firmaların oturumlarını görür. Listede ve CSV'de
  ek **Firma** sütunu, filtrelerde **Firma** seçimi bulunur.
- Firma seçimi (firma değiştirme) P9 ile gelir; seçili firmada yalnız o firmanın oturumları görünür.
