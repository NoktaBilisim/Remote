# Remote Support — Nokta Bilişim Uzaktan Destek Platformu
> Kendi sunucunuzda çalışan, çok firmalı uzaktan destek: teknisyen müşterinin ekranını görür, izinle kontrol eder;
> onaylar ve işlemler kayıt altında kalır.

## Ne işe yarar
Uzaktan destek çoğu zaman dışarıdaki bir hizmete bağlıdır; veriler ve kayıtlar başka yerde tutulur. Remote Support
kurumun kendi sunucusunda çalışır. Teknisyen web konsolundan oturum açar; müşteri tek dosyalık Windows programıyla veya
tarayıcıyla katılır ya da programdan kendisi destek ister. Görüntü iki taraf arasında doğrudan akar; sunucuda yalnız
oturum bilgisi, KVKK onayları ve denetim kayıtları kalır.

## Öne çıkan özellikler
- **Kurulumsuz müşteri programı** — tek dosya, yönetici yetkisi istemez; kod ile bağlanan bilgisayarda iz bırakmaz.
- **Müşteri başlatmalı destek** — müşteri programdan "Destek iste" der; talep canlı kuyruğa düşer, teknisyen tek
  tıkla kabul eder. Bir kez destek alan bilgisayar firmayı hatırlar, yeni link gerekmez.
- **İzinli uzaktan kontrol** — her kontrol isteğini müşteri onaylar, tek tuşla geri alır; uzaktan tıklama izin sayılmaz.
- **Zorlu donanımda da görüntü** — ekran üç farklı yöntemle okunur (HDR ve çift ekran kartlı dizüstüler dahil);
  okunamazsa müşteri ekranında kısa bir neden kodu ve ne yapacağı yazar.
- **Sohbet, dosya, ekran üzerine işaretleme** — dosya içeriği sunucudan geçmez, her dosyayı alıcı onaylar.
- **Müşteri firma yönetimi** — her müşteriye ayrı kalıcı indirme bağlantısı; talep ve oturumlar firmaya göre süzülür.
- **Kullanıcı ve yetki yönetimi** — teknisyen ekleme, modül bazlı aç/kapa yetkileri, pasife alma; değişiklik açık
  oturumlara anında yansır.
- **İki adımlı doğrulama ve e-posta** — yöneticilerde zorunlu, teknisyenlerde firma ayarıyla 2FA; şifremi unuttum,
  tüm cihazlardan çıkış; firmanın kendi SMTP'siyle bildirimler.
- **Oturum geçmişi ve CSV** — filtreli liste, onay ve kontrol kayıtları, ticket/not, Excel uyumlu dışa aktarma.

## Kimler için
- Kurum içi BT destek ekipleri ve yardım masaları
- Birden çok müşteri firmaya hizmet veren BT hizmet sağlayıcıları
- Destek kayıtlarını KVKK kapsamında kendi sunucusunda tutmak isteyen kurumlar

## Modüller
| Modül | Ne yapar |
|---|---|
| Destek oturumları | Tek kullanımlık link ve 8 haneli kod, bekleme odası, teknisyen kabulü, iptal, zorla sonlandırma |
| Teknisyen konsolu | Canlı ekran, uzaktan kontrol, monitör değiştirme, sohbet, dosya, işaretleme, kalite paneli |
| Hızlı Destek (Windows) | Müşteri programı: "Destek iste", "Bağlantı kodum var", "Bu bilgisayarı unut", onay ve izin diyalogları |
| Destek talepleri | Canlı kuyruk, bildirim ve ses, kabul/ret, firma filtresi, son 30 gün geçmişi |
| Müşteriler | Müşteri firma kaydı, firma başına bağlantı (kopyala, yenile), pasife alma, talep ve oturum geçmişi |
| Oturum geçmişi | Filtreli liste, ayrıntı, ticket/not, CSV |
| Kullanıcılar | Kullanıcı ekleme (tek seferlik geçici şifre), rol, yetki tablosu, pasife alma / yeniden etkinleştirme |
| Firmalar (Süper Yönetici) | Firma oluşturma, düzenleme, pasife alma, firmalar arası geçiş |
| Hesap güvenliği | 2FA kurulumu ve kurtarma kodları, şifre değiştirme/sıfırlama, tüm cihazlardan çıkış |
| Ayarlar | Destek talebi bağlantısı, bekleme süresi, WhatsApp ve e-posta bildirimi + test, güvenilen ağlar, SMTP + test maili, teknisyen 2FA zorunluluğu |

## Güvenlik ve yönetim
- Roller (Teknisyen / Yönetici / Süper Yönetici) ve modül bazlı yetki anahtarları; kimse sahip olmadığı yetkiyi veremez.
  Yetki her işlemde sunucuda denetlenir.
- Çoklu firma: bir firmanın kullanıcısı başka firmanın kaydını göremez; firma pasife alınınca oturumları, talepleri
  ve kayıtlı bilgisayarları hemen kapanır.
- Denetim kaydı: giriş/çıkış, oturum olayları, kontrol izinleri, dosya aktarımı, dışa aktarma, kullanıcı/yetki/firma
  değişiklikleri (eski → yeni). Şifre ve anahtarlar maskelenir; müşteri kişisel verisi yazılmaz.
- KVKK: aydınlatma metni firma bazında ve sürümlü; onay, metin sürümüyle saklanır. Talep verisi saklama süresi sonunda
  anonimleştirilir.
- Şifreler argon2id ile saklanır; hatalı girişte kilit (ve kullanıcıya e-posta), ilk girişte şifre değişimi, CSRF
  koruması, süreli oturum (30 dk boşta / 8 sa).
- İki adımlı doğrulama (TOTP; Google/Microsoft Authenticator vb.) ve tek kullanımlık kurtarma kodları; yönetici
  hesaplarında zorunlu. SMTP şifresi ve 2FA sırları şifreli saklanır; e-posta yalnız internetteki SMTP sunucularına,
  sertifika doğrulamalı gönderilir.
- Müşteri programı yalnız kendi sunucusuna bağlanır; bütünlüğü SHA-256 ve tekrarlanabilir derlemeyle doğrulanır.
  Hatırlanan bilgiler Windows hesabına bağlı şifreyle (DPAPI) saklanır, tek tıkla silinir. Tanılama dosyası kişisel
  veri içermez.

## Entegrasyonlar
- TURN sunucusu (coturn): güvenlik duvarı arkasındaki müşteriler için görüntü aktarımı.
- WhatsApp (Nokta Bilişim whatsapp-bildirim servisi): yeni talepte kişisel veri içermeyen bildirim; test butonu.
- E-posta (firmanın kendi SMTP sunucusu): şifre sıfırlama, güvenlik bildirimleri, yeni talep bildirimi, oturum
  bağlantısını müşteriye gönderme; test butonu.
- SMS bildirimi bu sürümde yoktur.

## Teknik özellikler
| Başlık | Değer |
|---|---|
| Çalışma şekli | Web tabanlı teknisyen konsolu; müşteri için Windows programı veya tarayıcı |
| Sunucu / veritabanı | Node.js 22 (Fastify), Next.js arayüz / MySQL 8.4 |
| Kurulum | Docker Compose, kurum sunucusunda; TURN ayrı compose |
| Görüntü | WebRTC, eşler arası; H.264, en çok 1920×1080, hedef 30 fps |
| Müşteri işletim sistemi | Windows 10 / 11 (64 bit); tarayıcı modu için ekran paylaşımı destekleyen masaüstü tarayıcı |
| Teknisyen tarayıcısı | Chrome, Edge (güncel) |
| Dil / tema | Türkçe / açık ve koyu |

## Sistem gereksinimleri (öneri)
| | Minimum | Önerilen |
|---|---|---|
| CPU / RAM | 2 çekirdek / 4 GB | 4 çekirdek / 8 GB |
| Disk | 20 GB | 50 GB (kayıt saklama süresine göre) |
| Ağ | Tek HTTPS portu; TURN için 3478/5349 ve UDP röle aralığı | Genel IP, alan adı ve genel sertifika |

## Destek ve iletişim
Nokta Bilişim Danışmanlık ve Elektronik San. Tic. Ltd. Şti.
