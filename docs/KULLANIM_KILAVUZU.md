# Remote Support — Kullanım Kılavuzu

Bu kılavuz Nokta Bilişim uzaktan destek platformunun kullanıcıya dönük ekranlarını anlatır. Platform paketler hâlinde
geliştirilir (bkz. `README.md` "Yol haritası"); kılavuz da her paketle birlikte büyür. Bu sürümde yer alan bölüm:

- **Müşteri için:** Hızlı Destek uygulaması (Windows)

Teknisyen konsolu ve yönetim paneli bölümleri, ilgili ekranlar tamamlandıkça eklenecektir.

---

## Müşteri için: Hızlı Destek uygulaması (Windows)

Hızlı Destek, teknisyenin ekranınızı görmesini sağlayan küçük bir Windows programıdır. Kurulum gerektirmez,
yönetici şifresi sormaz, bilgisayarınızda iz bırakmaz. Program kapandığında hiçbir parçası çalışmaya devam etmez.

**Ne gerekir?**
- Windows 10 veya Windows 11 yüklü bir bilgisayar.
- İnternet bağlantısı.
- Teknisyeninizin size gönderdiği **destek bağlantısı** veya **8 haneli destek kodu**.
- Telefonda teknisyeninizle görüşüyor olmanız (kodları birbirinize okuyacaksınız).

**Bu sürümde teknisyen neler yapabilir?**
- Ekranınızı **görebilir**. Fare ve klavyenizi **kullanamaz**.
- Sizinle yazışabilir (sohbet).
- Ekranınızın üzerine geçici çizimler yapabilir (ok, kalem, dikdörtgen, kısa süreli lazer noktası). Bu çizimler
  tıklamanızı engellemez.
- Size dosya gönderebilir. Her dosyayı siz onaylarsınız.

**Bilmeniz gerekenler**
- Teknisyen **fare imlecinizi göremez**. Ekranda bir yeri göstermek istiyorsanız sohbette yazın veya telefonda tarif edin.
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
