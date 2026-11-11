# Remote Support — Nokta Bilişim Uzaktan Destek Platformu
> Kendi sunucunuzda çalışan, KVKK onayı kayıt altında, çok firmalı uzaktan destek: teknisyen müşterinin ekranını
> görür, izinle kontrol eder, her adım kanıtlı saklanır.

## Ne işe yarar
Destek ekipleri müşteriye uzaktan yardım için çoğu zaman dışarıdaki bir hizmete bağımlıdır; veriler ve kayıtlar başka
yerde tutulur. Remote Support kurumun kendi sunucusunda çalışır. Teknisyen web konsolundan bir oturum açar, müşteri
tek dosyalık Windows programıyla veya tarayıcıyla katılır. Görüntü doğrudan iki taraf arasında akar; sunucuda yalnız
oturum bilgisi, onaylar ve denetim kayıtları kalır.

## Öne çıkan özellikler
- **Kurulumsuz müşteri programı** — tek dosya, yönetici yetkisi istemez, iş bitince iz bırakmaz.
- **Tarayıcıdan katılım** — program indiremeyen müşteri ekranını tarayıcıdan paylaşır (yalnız görüntü).
- **İzinli uzaktan kontrol** — müşteri her kontrol isteğini onaylar, tek tuşla (Ctrl+Shift+F12) geri alır.
- **Dolandırıcılığa karşı korumalar** — teknisyen doğrulama kodu, kabul kodu, kötüye kullanım bildirimi; uzaktan
  tıklama izin sayılmaz.
- **Sohbet, dosya aktarımı, ekran üzerine işaretleme** — dosya içeriği sunucudan geçmez, her dosyayı alıcı onaylar.
- **Kalite paneli** — kare hızı, gecikme, kayıp ve bağlantı yolu anlık izlenir.
- **Oturum geçmişi** — tarih, durum, teknisyen, müşteri ve bağlantı türüne göre filtre; her oturumun onay kayıtları,
  kontrol dönemleri ve olay akışı.
- **Ticket ve not** — oturumu yardım masası kaydıyla eşleştirme.
- **Excel uyumlu CSV dışa aktarma** — Türkçe karakterler ve Türkiye saatiyle; formül enjeksiyonuna karşı korumalı.

## Kimler için
- Kurum içi BT destek ekipleri ve yardım masaları
- Birden çok müşteri firmaya hizmet veren BT hizmet sağlayıcıları
- Destek kayıtlarını KVKK kapsamında kendi sunucusunda tutmak isteyen kurumlar

## Modüller
| Modül | Ne yapar |
|---|---|
| Destek oturumları | Tek kullanımlık link ve 8 haneli kodla oturum açma, bekleme odası, teknisyen kabulü, iptal ve zorla sonlandırma |
| Teknisyen konsolu | Canlı ekran (Sığdır / %100 / tam ekran), sohbet, dosya, işaretleme, kalite paneli |
| Uzaktan kontrol | Fare ve klavye (Türkçe karakter dahil), özel tuşlar, monitör değiştirme; müşteri onaylı |
| Hızlı Destek (Windows) | Müşteri programı: onay, ekran seçimi, sohbet, dosya alma, izin diyaloğu |
| Oturum geçmişi | Filtreli liste, ayrıntı, ticket/not, CSV dışa aktarma |

## Güvenlik ve yönetim
- Rol bazlı yetki (User / Admin / Super Admin) ve modül bazlı yetki anahtarları (görüntüle, düzenle, dışa aktar vb.).
- Çoklu firma (tenant) desteği; bir firmanın kullanıcısı başka firmanın kaydını göremez (sunucuda zorunlu).
- Denetim kaydı (audit log): giriş/çıkış, oturum olayları, kontrol izinleri, dosya aktarımları, dışa aktarmalar;
  şifre ve anahtarlar maskelenir.
- KVKK: aydınlatma metni firma bazında ve sürümlü; müşterinin onayı metin sürümü ve özetiyle saklanır. Not metni ve
  müşteri araması denetim kaydına yazılmaz.
- Şifreler argon2id ile saklanır; hatalı girişte hesap kilidi; CSRF koruması; oturum süresi sınırlı.
- Müşteri programı yalnız kendi sunucusuna bağlanır; bütünlüğü SHA-256 ve tekrarlanabilir derlemeyle doğrulanır.

## Entegrasyonlar
- TURN sunucusu (coturn) — güvenlik duvarı arkasındaki müşteriler için görüntü aktarımı.
- E-posta, SMS ve WhatsApp bildirimleri bu sürümde yoktur.

## Teknik özellikler
| Başlık | Değer |
|---|---|
| Çalışma şekli | Web tabanlı teknisyen konsolu; müşteri için Windows programı veya tarayıcı |
| Sunucu | Node.js 22 (Fastify), Next.js web arayüzü |
| Veritabanı | MySQL 8.4 |
| Kurulum | Docker Compose, kurum sunucusunda (self-hosted); TURN ayrı sunucu/compose |
| Görüntü | WebRTC, eşler arası; H.264, en çok 1920×1080, hedef 30 fps |
| Müşteri işletim sistemi | Windows 10 / 11 (64 bit); tarayıcı modu için ekran paylaşımı destekleyen masaüstü tarayıcı |
| Teknisyen tarayıcısı | Chrome, Edge (güncel; tam ekran tuş yakalama Chromium'da) |
| Dil | Türkçe |
| Tema | Açık / koyu (konsol) |

## Sistem gereksinimleri (öneri)
| | Minimum | Önerilen |
|---|---|---|
| CPU | 2 çekirdek | 4 çekirdek |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB | 50 GB (kayıt saklama süresine göre) |
| Ağ | Tek TCP portu (HTTPS); TURN için 3478/5349 ve UDP röle aralığı | Genel IP ve alan adı + genel sertifika |

## Destek ve iletişim
Nokta Bilişim Danışmanlık ve Elektronik San. Tic. Ltd. Şti.
