# Remote Support — Kullanım Kılavuzu

Bu kılavuz Nokta Bilişim uzaktan destek platformunun kullanıcıya dönük ekranlarını anlatır. Platform paketler hâlinde
geliştirilir (bkz. `README.md` "Yol haritası"); kılavuz da her paketle birlikte büyür. Bu sürümde yer alan bölümler:

- **Müşteri için:** Hızlı Destek uygulaması (Windows), "Destek iste" ile talep gönderme, bilgisayarın hatırlanması
  ("Bağlantı kodum var", "Bu bilgisayarı unut"), uzaktan kontrol izni
- **Teknisyen için:** Uzaktan kontrol (konsol), Oturum geçmişi, Destek talepleri
- **Admin ve teknisyen için:** Müşteriler (müşteri firmalar, bağlantı gönderme, kayıtlı bilgisayarlar)
- **Admin için:** Uzaktan kontrol yetkisi ve kayıtlar, Oturum geçmişi yetkileri, Ayarlar > Destek talepleri
- **Super Admin için:** Tüm firmaların oturum geçmişi, destek talepleri

Teknisyen konsolunun diğer bölümleri ve yönetim paneli, ilgili ekranlar tamamlandıkça eklenecektir.

---

## Müşteri için: Hızlı Destek uygulaması (Windows)

Hızlı Destek, teknisyenin ekranınızı görmesini sağlayan küçük bir Windows programıdır. Kurulum gerektirmez,
yönetici şifresi sormaz, bilgisayarınızda iz bırakmaz. Program kapandığında hiçbir parçası çalışmaya devam etmez.

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
| İzin ver düğmesi çalışmıyor | İlk 1,5 saniye beklenir; sonra kendi farenizle tıklayın. Kırmızı "kısayol kaydedilemedi" uyarısı varsa izin verilemez. "Bu tıklama uzak bağlantı … kabul edilmedi" uyarısı çıktıysa bilgisayarın başındaki kişi kendi faresiyle tıklamalıdır. |
| Teknisyen tıklıyor ama bir pencerede hiçbir şey olmuyor | O pencere yönetici yetkisiyle açılmış olabilir (ör. yönetici komut istemi). Teknisyen bunu konsolda görür; gerekirse işlemi siz yapın. |
| Windows onay ekranı (UAC) açıkken teknisyen ekranı göremiyor | Bu ekran güvenlik gereği paylaşılmaz. Onayı siz verin; görüntü kendiliğinden geri gelir. |

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
9. "Teknisyen bağlanıyor…" yazar ve bağlantı kendiliğinden kurulur. Kabul kodu sorulmaz. Sonrası normal oturumla
   aynıdır: ekran seçimi, kırmızı çerçeve, sohbet ve dosya (bkz. "Ekran seçimi ve oturum"). Teknisyen fare ve
   klavyenizi kullanmak isterse ayrıca izin istenir.

Bağlantı isteği penceresinde **1 dakika** içinde karar vermezseniz "Bağlantı süresi doldu" yazar ve ekranınız
paylaşılmaz. **Vazgeç** derseniz "Ekranınız paylaşılmadı" yazar ve talep iptal olur.

**Beklerken neler yapabilirim?**
- **Talebi iptal et:** talep firmanızın listesinden kalkar ve forma dönersiniz ("Talebiniz iptal edildi").
- Pencereyi sağ üstteki **X** ile kapatmak da talebi iptal eder ve programı kapatır.
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
| Mesaj | Ne yapmalı |
|---|---|
| Bu Hızlı Destek dosyası eski | **Yeni sürümü indir**'e tıklayın. Yeni dosya aynı firma bağlantısından iner; bu pencereyi kapatıp yeni dosyayı açın. (8 haneli kod dosyasında "Teknisyeninizden yeni bağlantı isteyin" yazar.) |
| Bu dosya artık geçerli değil | Firmanız bağlantıyı yenilemiş. Firmanızdan yenisini isteyin. Teknisyen size kod verdiyse **Bağlantı kodum var** ile devam edin. Bilgisayarınız kayıtlıysa ana ekrandan **Destek iste** ile yine talep gönderebilirsiniz. |
| Talebiniz kapatıldı — Firmanız bu talebi şu an kabul edemiyor. | Firmanız müşteri kaydınızı pasife almış veya bu bilgisayarın kaydını iptal etmiş olabilir. Firmanızı telefonla arayın. |
| Sunucuya ulaşılamıyor | İnternet bağlantınızı kontrol edip **Tekrar dene**'ye tıklayın. |
| Sunucu sertifikası doğrulanamadı | Ağınızda araya giren bir cihaz olabilir. Devam etmeyin; firmanızı telefonla arayın. |
| Sunucu şu an yoğun, birkaç saniye içinde yeniden deneniyor… | Bekleyin; program bir kez kendiliğinden yeniden dener. |
| Sunucu şu an yoğun. Lütfen biraz sonra tekrar deneyin. | Biraz bekleyip **Destek iste**'ye yeniden basın. |
| Çok fazla deneme | Birkaç dakika sonra tekrar deneyin. |
| Talep gönderilemedi. Lütfen tekrar deneyin. | **Destek iste**'ye yeniden basın. Sürerse firmanızı telefonla arayın. |
| Bu pencereden gönderilmiş bekleyen bir talebiniz var. | Programı kapatıp yeniden açın. |
| Aydınlatma metni güncellendi; lütfen yeniden okuyup onaylayın. | Metni okuyup kutuyu yeniden işaretleyin, sonra **Destek iste**'ye basın. |
| Sunucuyla bağlantı kesildi | İnternet uzun süre kopmuş. Bağlantınızı kontrol edip **Yeniden talep oluştur**'a tıklayın; bilgileriniz formda durur. |
| Talebiniz zaman aşımına uğradı | Firmanız bekleme süresinde yanıt veremedi. **Yeniden talep oluştur** veya firmanızı arayın. |
| Firmanız talebinizi yanıtladı / Firmanızın mesajı: … | Talep reddedildi; ekranınız paylaşılmadı. Mesajdaki yönlendirmeyi izleyin. |
| Talebiniz iptal edildi — Firmanız şu an talep kabul etmiyor. | Firmanızı telefonla arayın. |
| Bağlantı süresi doldu | Bağlantı isteğine 1 dakika içinde yanıt verilmedi. Gerekirse yeniden talep oluşturun. |
| Bağlantı kurulamadı | Teknisyen kabul etti ama bağlantı kurulamadı. Yeniden talep oluşturun veya firmanızı arayın. |
| Talep başka bir pencerede açıldı | Aynı talep başka bir pencerede izleniyor; bu pencereyi kapatabilirsiniz. |

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
Ana ekran açılır. Üstte firma adı, kırmızı dolandırıcılık uyarısı ve (kayıtlıysa) "Bu bilgisayar <firma>[ – <müşteri
firma>] için kayıtlı" satırı bulunur. Altında dört düğme vardır:

| Düğme | Ne yapar |
|---|---|
| **Destek iste** | Talep formunu açar (bkz. "Teknisyeni beklemeden destek isteyebilir miyim?"). Talep doğrudan firmanıza düşer |
| **Bağlantı kodum var** | Teknisyen size 8 haneli bir kod verdiyse kodu yazıp bağlanırsınız (eski "Teknisyenden kod aldım") |
| **Bu bilgisayarı unut** | Bu bilgisayarın kaydını ve hatırlanan bilgilerinizi siler |
| **Kötüye kullanımı bildir** | Firmanız bir adres tanımladıysa görünür |

Tab tuşu düğmeler arasında bu sırayla gezer; Enter seçili düğmeyi çalıştırır.

**Hangi durumda hangi ekran açılır?**
- Teknisyenin gönderdiği geçerli `Destek-<kod>.exe` → her zamanki karşılama ekranı (kod akışı).
- Süresi dolmuş veya kullanılmış `Destek-<kod>.exe` ve bilgisayar kayıtlıysa → ana ekran, üstte "Bu destek bağlantısının
  süresi doldu." **Destek iste** ile yine talep gönderebilirsiniz.
- Firmanızın verdiği `NoktaDestek-<ad>-….exe` geçerliyse → ana ekran; talep o dosyanın firmasına gider.
- O dosya artık geçerli değilse ve bilgisayar kayıtlıysa → ana ekran, üstte "Bu dosya artık geçerli değil; bu
  bilgisayarın kaydıyla destek isteyebilirsiniz."
- Adı değiştirilmiş dosya (ör. `NoktaDestek.exe`) ve bilgisayar kayıtlı değilse → **Destek iste** pasiftir; altında
  "Destek istemek için firmanızın gönderdiği dosyayı kullanın veya teknisyeninizin verdiği kodu girin" yazar.
  **Bağlantı kodum var** ile devam edin.

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

**Başka bir firmadan destek alırsam?** Bir bilgisayar aynı anda tek firmaya kayıtlıdır. Başka bir firmayla oturum
yaparsanız oturum sonunda "Bu bilgisayar artık <yeni firma> için kayıtlı." yazar.

**Paylaşılan bilgisayardaysanız** işiniz bitince **Bu bilgisayarı unut**'a tıklayın.

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

## Teknisyen için: Destek talepleri

Müşteriler, firmalarına özel Hızlı Destek dosyasından **destek talebi** gönderebilir. Talep, firmanızın kuyruğuna düşer;
müsait olan teknisyen kabul eder ve oturum doğrudan açılır. Müşteriye link veya kod okumanız gerekmez.

Kenar menüsündeki **Talepler** bağlantısını görmüyorsanız "Destek talepleri → Görüntüle" yetkiniz yoktur; yöneticinizden
isteyin. Kabul ve ret için ayrıca "Destek talepleri → Kabul et" yetkisi gerekir.

> **Önemli — her talepte:** Müşteriyi **firmanın kayıtlı numarasından** arayın (talepte yazan numaradan değil) ve
> müşterinin ekranındaki **6 haneli talep kodunu** sorun. Kod, karttaki kodla aynı değilse talebi kabul etmeyin.
> Talep formunu herkes doldurabilir; ad ve telefon müşterinin beyanıdır, doğrulanmış bilgi değildir.

### Kuyruk nasıl çalışır?
1. Kenar menüsünden **Talepler**'i açın. **Bekleyenler** sekmesi en eski talep en üstte olacak şekilde sıralanır.
2. Menüdeki rozet bekleyen talep sayısını gösterir. Sekme arka plandaysa tarayıcı sekmesinin başlığında da sayı görünür.
3. Liste kendiliğinden güncellenir. Bağlantı koparsa sayfanın üstünde "Liste güncellenemedi; gösterilen bilgiler eski
   olabilir." yazar; liste 15 saniyede bir yeniden yoklanır.
4. Talep kartında şunlar bulunur: müşterinin adı, telefonu, e-postası (verdiyse), sorun açıklaması, ne kadar süredir
   beklediği, istemci sürümü ve **Talep kodu**.

### Kaynak işaretleri ne anlama gelir?
| Kartta görünen | Anlamı |
|---|---|
| **Bilinen kaynak** · "Güvenilen ağ" | Talep, yöneticinizin güvenilen olarak eklediği bir ağdan (ör. müşterinin ofisi) geldi |
| **Bilinen kaynak** · "Bu ağdan daha önce oturum yapıldı" | Aynı internet adresinden daha önce destek oturumu yapıldı |
| **Bilinen kaynak** · "Bu bilgisayar daha önce destek aldı" | Aynı bilgisayar daha önce destek aldı |
| "Benzer ağdan önceki oturum var" | Yakın bir adresten önceki oturum var; tek başına güven vermez |
| **"İlk kez görülen kaynak — firmanın kayıtlı numarasından arayıp talep kodunu doğrulayın"** | Bu kaynak ilk kez görülüyor; aramayı mutlaka yapın |

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
için "Sil" yetkisi gerekir. Admin'de hepsi varsayılan açık, teknisyende (User) kapalıdır; yöneticiniz açar.
Super Admin müşterileri bir firma seçtikten sonra görür.

### Nasıl müşteri eklerim?
1. Kenar menüsünden **Müşteriler**'i açın, **Yeni müşteri**'ye tıklayın.
2. Formu doldurun:
   - **Firma adı** (zorunlu): 2–100 karakter. Aynı adla ikinci müşteri eklenemez ("Bu adla bir müşteri zaten var";
     büyük/küçük harf ve Türkçe karakter farkı sayılmaz).
   - **Dosya etiketi:** dosya adında görünen kısa ad (`NoktaDestek-<etiket>-….exe`). Adı yazarken kendiliğinden
     önerilir; yalnız harf ve rakam, en çok 20 karakter.
   - **Yetkili kişi, Telefon, E-posta, Not** (isteğe bağlı): kişisel veridir. Not düz metindir.
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
| Kartta görünen | Anlamı |
|---|---|
| **Müşteri firma: <ad>** veya **Genel** | Talebin geldiği müşteri; müşterisiz dosyadan geldiyse "Genel" |
| **Kayıtlı bilgisayar — <firma \| Genel>** | Talep, daha önce destek almış ve kaydı geçerli bir bilgisayardan geldi. Bu bir kimlik doğrulaması **değildir**; talep kodunu yine telefonla doğrulayın |
| **Kaydı iptal edilmiş bilgisayar** | Talep bir kayıtla açılmış ama kayıt artık geçersiz |
| **Bu talep bağlantı yenilenmeden önce açıldı** | Talep eski bağlantı/kayıtla açıldı; kabul edebilirsiniz ama bilgisayar yeniden kaydedilmez |

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

### Sık karşılaşılan mesajlar (Müşteriler)
| Mesaj | Ne yapmalı |
|---|---|
| Bu adla bir müşteri zaten var | Farklı bir ad yazın veya Pasif filtresinde aynı adlı müşteriyi bulup yeniden aktif edin |
| Müşteri pasif; bağlantı yenilenemez. | Önce **Yeniden aktif et** (zaten yeni bağlantı üretir) |
| Seçilen müşteri artık aktif değil… | Yeni oturumda başka müşteri seçin veya alanı boşaltın |
| Müşteri bulunamadı | Müşteri yok ya da görme yetkiniz yok; **Müşterilere dön** |
| Müşterileri görme yetkiniz yok… | Yöneticinizden "Müşteriler" yetkisini isteyin |
| Kayıtlar alınamadı. | **Tekrar dene**'ye basın |

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
yöneticinize bildirin. **E-posta bildirimi** SMTP ayarlarıyla birlikte (P10) gelecek; şimdilik pasiftir.

### Güvenilen IP / ağlar
Kurumsal ofis gibi bilinen ağlardan gelen talepler "Güvenilen ağ" işaretiyle gelir ve IP sınırlarından muaftır
(ör. aynı ofisten çok sayıda çalışan aynı anda talep gönderebilir).
1. **Ağ ekle** ile müşterinin sabit dış IP'sini (`203.0.113.10/32`) veya ağını (`203.0.113.0/24`) girin.
2. En çok 10 ağ; IPv4 en geniş /16, IPv6 en geniş /32. Özel (192.168.x.x gibi) adresler kabul edilmez.
3. **Kaydet**.

Firma başına toplam bekleyen talep sınırı (50) güvenilen ağlar için de geçerlidir.

### Yetkiler ve kayıtlar
- **Destek talepleri → Görüntüle** (`support_requests.view`) kuyruğu, **Kabul et** (`support_requests.accept`) kabul ve
  reddi açar. Admin'de varsayılan açık, User'da kapalıdır; yetki ekranı P9'da gelir. Staging'de teknisyen (User)
  hesabına bu yetkiler varsayılan olarak verilmez.
- Kabul, ret, iptal, süre dolumu, ayar değişikliği (eski → yeni), bağlantı yenileme, WhatsApp gönderimi ve testi
  denetim kaydına yazılır. Müşteri adı, telefonu ve açıklaması denetim kaydına yazılmaz.

## Super Admin için: Tüm firmaların oturum geçmişi

- Super Admin firma seçmeden **Oturum geçmişi**'ni açtığında tüm firmaların oturumlarını görür. Listede ve CSV'de
  ek **Firma** sütunu, filtrelerde **Firma** seçimi bulunur.
- Firma seçimi (firma değiştirme) P9 ile gelir; seçili firmada yalnız o firmanın oturumları görünür.
- **Destek talepleri:** Super Admin firma seçmeden **Talepler** ve **Ayarlar** ekranlarında "Önce firma seçin" uyarısını
  görür. Firma seçiliyken o firmanın kuyruğunu görür ve ayarlarını düzenleyebilir; talep **kabul edemez ve
  reddedemez** (oturum teknisyenin kendi firmasında açılır).
