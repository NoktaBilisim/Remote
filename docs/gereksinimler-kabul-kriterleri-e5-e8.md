# Kabul Kriterleri — Remote Support — Bölüm 2/2 (E5–E8)
Ana dosya: `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri.md`. Tarih: 2026-11-11. Durum: TASLAK.
Kaynak notu: parantez içindeki kod (G-nn) `docs/guvenlik-raporu.md` bulgusunu, (Kn) `docs/mimari.md` §12 kararını gösterir. Notsuz AC'ler 2026-11-10 metnidir.

## E5 — Oturum geçmişi
- AC-60: Oturum listesi tarih aralığı, teknisyen, durum, müşteri adı ve mod (istemci/tarayıcı) ile filtrelenir; sayfalı (varsayılan 25, üst sınır 100); 10.000 kayıtta ilk sayfa < 500 ms.
- AC-61: User yalnız kendi oturumlarını listeler, detayını görür, düzenler ve dışa aktarır; Admin kendi tenant'ının, Super Admin tüm oturumları görür; başka tenant'ın veya (User için) başka teknisyenin oturum ID'si 404 döner. (G-22)
- AC-62: Detayda başlangıç/bitiş, süre, müşteri adı/e-posta, onay kayıtları, kontrol verilme/geri alınma zamanları, kalite özeti, dosya meta verisi ve sonlandıran taraf görünür.
- AC-63: Teknisyen ticket no (≤ 50 karakter) ve not (≤ 4000 karakter) ekler; filtrelenmiş liste "Dışa aktar" yetkisiyle CSV (UTF-8 BOM) indirilir.
- AC-124: CSV dışa aktarmada `=`, `+`, `-`, `@`, sekme veya satır başı ile başlayan hücreler `'` önekiyle yazılır (oturum ve audit CSV'si; test). (G-16)

## E6 — Ortak platform standartları (/Users/mennan/Projeler/CLAUDE.md)
- AC-64: Giriş e-posta/kullanıcı adı + şifreyle yapılır; şifreler argon2id veya bcrypt (cost ≥ 12) ile hash'lenir; şifre en az 12 karakterdir.
- AC-65: Aynı hesap + IP ikilisi için 5 hatalı denemede o ikili 15 dk kilitlenir; IP'den bağımsız 1 saatte 20 hatalı denemede hesap 15 dk tamamen kilitlenir ve (SMTP ayarlıysa) hesap sahibine bildirim e-postası gider; başarılı/başarısız giriş, kilit ve çıkış audit log'a yazılır. (G-23)
- AC-66: Yeni kullanıcı ilk girişte şifre değiştirmeden başka sayfaya geçemez; şifre değiştirme ve e-posta ile sıfırlama (link 30 dk geçerli, tek kullanımlık) çalışır.
- AC-67: TOTP 2FA Super Admin/Admin için zorunludur; teknisyen için tenant ayarı ile zorunlu kılınır; 10 tek kullanımlık kurtarma kodu üretilir.
- AC-68: Uygulama oturumu 30 dk hareketsizlikte veya 8 saatte sona erer; "Tüm cihazlardan çıkış" diğer oturumları 5 sn içinde geçersiz kılar.
- AC-69: Her tenant verisi `tenant_id` taşır; bir tenant kullanıcısının başka tenant kaydına her API isteği 404 döner (tüm uçlar için otomatik test).
- AC-70: Super Admin tenant oluşturur, düzenler, pasife alır ve tenant'lar arası geçiş yapar; pasif tenant kullanıcıları giriş yapamaz ve açık oturumları sonlanır.
- AC-71: Kullanıcı düzenleme ekranı tüm modül yetkilerini (en az: Oturumlar, Uzaktan kontrol, Dosya transferi, Oturum geçmişi, Kullanıcılar, Ayarlar, Audit log) Görüntüle/Ekle/Düzenle/Sil/Dışa aktar alt anahtarları ve grup bazında "Tümünü aç/kapat" ile toggle olarak listeler.
- AC-72: Yetki listesi koddaki tek `permissions` tanımından üretilir; tanıma eklenen yeni anahtar başka değişiklik yapmadan ekranda görünür (test).
- AC-73: Admin sahip olmadığı yetkiyi başkasına veremez (API 403); Admin varsayılan tümü açık, User tümü kapalı başlar.
- AC-74: Her yetki değişikliği (kim, kime, hangi yetki, eski → yeni) audit log'a yazılır.
- AC-75: Audit log kaydı `id, created_at, tenant_id, user_id, username, action, entity, entity_id, old_value, new_value, ip_address, user_agent, result` alanlarını içerir; şifre/token/anahtar değerleri ile ticket, TURN credential, kurtarma kodu, çerez, Authorization, SDP/ICE ve kabul kodu değerleri `***` olarak maskelenir; yetki anahtarı adı (`perm_key`) açık görünür (test). (G-15)
- AC-76: Audit log ekranı tarih, kullanıcı, işlem ve sonuca göre filtrelenir, sayfalıdır, avatar gösterir; silme/düzenleme ucu yoktur (DELETE/PUT 405).
- AC-77: Super Admin MySQL ayar ekranında host, port (varsayılan 3306), veritabanı, kullanıcı, şifre girer; "Bağlantıyı Test Et" sonucu (başarılı / hata mesajı) 10 sn içinde ekranda gösterilir.
- AC-78: Kayıtlı şifreler/gizli değerler (MySQL, SMTP, TURN secret) forma geri yazılmaz, boş bırakılırsa korunur, DB'de AES-256-GCM ile şifreli saklanır; değişiklik audit log'a yazılır.
- AC-79: Admin SMTP ayar ekranında sunucu, port, güvenlik (Yok/SSL/TLS), kullanıcı, şifre, gönderen adı ve adresi girer; güvenlik seçimi portu 25/465/587 olarak önerir.
- AC-80: "Test Maili Gönder" alıcı adresi sorar, mail gönderir ve sonucu/hata mesajını gösterir; gönderim audit log'a yazılır.
- AC-81: Admin tenant logosunu yükler/değiştirir/kaldırır (önizlemeli); logo üst menüde, karşılama sayfasında, istemcide ve e-postada görünür; kaldırılınca Nokta sistem logosu gösterilir.
- AC-82: Login ekranında her zaman logo bulunur (tenant belliyse tenant logosu, değilse sistem logosu).
- AC-83: Kullanıcı avatarını kare kırpma önizlemesiyle yükler/değiştirir/kaldırır; resim yoksa baş harfli renkli avatar gösterilir.
- AC-84: Logo/avatar yüklemede yalnız PNG/JPG/WEBP magic bytes ile kabul edilir (SVG ve uzantısı değiştirilmiş dosya reddedilir), 2 MB üstü reddedilir, sunucuda 512/256 px'e yeniden boyutlanır, EXIF silinir, `uploads/{tenant_id}/` altında rastgele adla saklanır; başka tenant dosyası 404 döner.
- AC-85: Tema seçimi Açık/Koyu/Sistem (varsayılan Sistem) üst menüde ve profilde yapılır, DB'de saklanır, başka cihazda aynı gelir; sayfa açılışında tema yanıp sönmez.
- AC-86: Favicon `nokta-kucuk.png`'den üretilmiş `favicon.ico` (16/32/48), `favicon-32x32.png`, `apple-touch-icon.png` (180) olarak tüm sayfalarda tanımlıdır.
- AC-87: Tüm menü/link öğelerinde anlamlı `lucide-react` ikonu bulunur; renk/spacing token dışı sabit değer lint kuralıyla yakalanır; `prefers-reduced-motion` açıkken hareket animasyonu yoktur.
- AC-115: Teknisyen hesabı pasife alındığında, "Tüm cihazlardan çıkış" yaptığında, şifresi/MFA'sı yönetici tarafından sıfırlandığında veya tenant pasife alındığında aktif destek oturumları 5 sn içinde sonlanır. "Uzaktan kontrol" yetkisi kaldırılırsa açık kontrol 5 sn içinde kapanır; "Dosya transferi" yetkisi kaldırılırsa yeni transfer başlatılamaz. (G-04, G-09)
- AC-121: Sahte `X-Forwarded-For` başlığı IP tabanlı limitleri atlatamaz; IPv6 istemciler /64 bazında sınırlanır (test). (G-11)
- AC-122: SMTP test ve kayıtta sunucu adresi özel, loopback, link-local, CGNAT veya iç Docker ağı IP'sine çözümlenirse işlem genel bir hata mesajıyla reddedilir; test 5/dk/tenant ile sınırlıdır. (G-12)
- AC-123: Uygulamanın çalıştığı veritabanı kullanıcısı audit_logs üzerinde UPDATE yapamaz, tetikleyiciyi silemez/değiştiremez; migration ayrı kullanıcıyla çalışır (test). (G-15)
- AC-126: Yanıt başlıkları: CSP `connect-src` uygulama portunu içerir, `worker-src`/`manifest-src 'self'`, `upgrade-insecure-requests`, `Cross-Origin-Resource-Policy` bulunur; `Server` ve `X-Powered-By` başlıkları yoktur; CSP'de `'unsafe-inline'` yoktur (e2e). (G-19)

## E7 — Operasyon ve dokümantasyon
- AC-88: `docker compose up -d` temiz sunucuda uygulama, coturn ve MySQL'i ayağa kaldırır; `/ready` 120 sn içinde 200 döner.
- AC-89: `/health`, `/ready`, `/metrics` uçları vardır; `/metrics` aktif oturum, WS bağlantı ve TURN tahsis sayısını verir ve dışarıya kimlik doğrulamasız açık değildir.
- AC-90: Loglar JSON'dur, korelasyon ID içerir; token, nonce, şifre ve TURN secret loglarda görünmez (log tarama testi).
- AC-91: MySQL günlük yedeklenir, 14 gün saklanır; runbook'taki geri yükleme prosedürü staging'de başarıyla uygulanmış olur.
- AC-92: Runbook en az "servis düştü", "TURN çalışmıyor", "sertifika süresi doldu", "istemci sürüm yayını ve köken doğrulama (attestation), indirme bütünlük alarmı", "TURN IP değişimi (denied-peer-ip güncelleme)" ve "kötüye kullanım bildirimi" senaryolarını içerir. (G-25, G-05, G-17)
- AC-93: README, docs/api.md, KULLANIM_KILAVUZU (User/Admin/Super Admin bölümleri, kurumsal AppLocker/AV allowlist rehberi dahil), DATASHEET ve `docs/pdf/` altındaki 3 PDF tek komutla üretilir; PDF'lerde Türkçe karakterler doğru görünür.
- AC-94: CI hattı lint → type-check → test → build → bağımlılık + lisans + gizli bilgi taraması (Kritik/Yüksek 0) → tekrarlanabilir istemci build (iki build hash eşit) + `SHA256SUMS` + GitHub build provenance attestation adımlarını içerir; tüm Action'lar commit SHA ile sabittir, workflow izinleri en azdır, Release yalnız korumalı `v*` etiketinden üretilir. (K8, G-07, G-18)

## E8 — Hızlı Destek istemcisi (Windows)
- AC-95: İstemci standart (admin olmayan) kullanıcıyla Windows 10 22H2 ve Windows 11 x64'te UAC istemi çıkmadan çalışır.
- AC-96: Tek dosyadır, ≤ 40 MB'tır, imzasızdır; SHA-256'sı GitHub Release'deki `SHA256SUMS` ile eşleşir ve `gh attestation verify` başarılıdır; çift tıktan karşılama ekranına ≤ 5 sn. (K8, G-07)
- AC-97: İstemci 8 haneli kısa kodu dosya adından okur; okuyamazsa kod giriş alanı gösterir; geçersiz/süresi dolmuş kodda AC-5/AC-7 mesajlarını gösterir. (G-02)
- AC-98: Karşılama ekranında firma logosu, teknisyen adı, teknisyen doğrulama kodu, bağlanılan sunucu adresi, dolandırıcılık uyarısı (AC-125) ve KVKK onayı gösterilir; onaysız bağlantı başlamaz. (G-01, G-17)
- AC-99: İlk bağlantıda izin seviyesi **yalnız görüntüleme**dir; teknisyenin kontrol talebi müşteriye "İzin ver / Reddet" diyaloğu olarak gelir; reddedilirse teknisyen "Kontrol reddedildi" görür.
- AC-100: "Erişime izin ver", "Kontrolü kapat" ve "Oturumu bitir" butonları istemci penceresinde her zaman görünür ve klavye ile erişilebilirdir.
- AC-101: "Kontrolü kapat" sonrasında gelen girdi olayları 100 ms içinde uygulanmamaya başlar (istemci tarafı uygulanır; sunucu veya teknisyen bunu atlayamaz — otomatik test sahte input enjekte ederek doğrular).
- AC-102: Kontrolü anında kapatan global kısayol Ctrl+Shift+F12'dir; kaydedilemezse Ctrl+Shift+F11 kaydedilir ve ekranda o yazılır; ikisi de kaydedilemezse kontrol izni verilemez ve müşteriye nedeni gösterilir. Kısayol istemci arka plandayken de çalışır. (G-21)
- AC-103: Uzaktan kontrol aktifken ekranın üst kenarında her zaman üstte, gizlenemeyen, kırmızı çerçeveli "Uzaktan kontrol aktif — <teknisyen adı>" göstergesi bulunur; yalnız görüntülemede "Ekranınız izleniyor" göstergesi bulunur. Gösterge her monitörde bulunur ve başka bir pencere üstüne çıksa bile en geç 1 sn içinde yeniden en üste gelir. (G-17)
- AC-104: Müşteri yerel fare/klavye kullandığında uzaktan girdi 1 sn askıya alınır.
- AC-105: Odaktaki pencere yükseltilmiş (elevated) ise teknisyen konsolunda "Yükseltilmiş pencere — kontrol edilemiyor" uyarısı gösterilir; UAC/Secure Desktop sırasında görüntü durursa konsolda "Müşteri güvenli masaüstünde" mesajı gösterilir.
- AC-106: Çoklu monitörde müşteri paylaşılacak monitörü seçer; tek monitör seçimi varsayılandır.
- AC-107: Oturum bittiğinde (her iki taraftan) istemci 3 sn içinde kendini kapatır.
- AC-108: Temiz makine iz testi: istemci çalıştırılıp kapatıldıktan sonra kayıt defterinde (HKCU/HKLM), servislerde, zamanlanmış görevlerde, başlangıç klasöründe ve `%APPDATA%`/`%LOCALAPPDATA%`'da istemciye ait kayıt kalmaz; `%TEMP%` dosyaları silinmiştir (indirilen exe hariç; kılavuzda belirtilir).
- AC-109: İstemci yalnız yapılandırılmış sunucu adresine TLS ile bağlanır; sunucu sertifikası doğrulanamazsa bağlantıyı reddeder. Sunucu adresi yalnız derleme zamanında belirlenir; komut satırı, ortam değişkeni veya kayıt defteri ile değiştirilemez. (G-07)
- AC-110: İstemci arayüzü Türkçedir ve Windows ölçekleme %100/%125/%150'de bozulmadan görüntülenir.
- AC-111: Kontrol verilme, geri alınma, reddetme ve kısayolla kesme olayları zaman damgasıyla audit log'a yazılır. Kontrol verilme kaydı audit log'a yazılamazsa kontrol 1 sn içinde geri alınır ve teknisyene hata gösterilir. (G-15)
- AC-116: Kontrol ve monitör değiştirme izin diyaloğunda varsayılan odak "Reddet"tedir; Enter/Space ve diyalog açıldıktan sonraki ilk 1,5 sn içindeki tıklama "İzin ver"i tetiklemez; diyalog fare imlecinin altında açılmaz. Reddedilen istekten sonra 30 sn yeni istek iletilmez; oturum başına en çok 5 kontrol isteği iletilir. Dosya teklifi diyaloğunda da aynı odak/gecikme kuralı geçerlidir. (G-03)
- AC-118: İstemci DLL'leri yalnız System32'den yükler; indirme klasörüne konan sahte DLL yüklenmez (Procmon kaydında indirme klasöründe DLL araması 0). (G-08)
- AC-128: İstemcinin karşılama/hakkında alanında sürüm, SHA-256'nın ilk 8 hanesi ve bağlı sunucu adresi görünür; günlük otomatik kontrol, indirme adresindeki dosyanın hash'ini GitHub Release ile karşılaştırır ve uyuşmazlıkta alarm üretir. (G-07)
- Bu epiği ayrıca ilgilendiren, Bölüm 1'de duran AC'ler: AC-117 (dosya adı temizleme, MOTW), AC-119 (DataChannel yetki filtresi), AC-125 (dolandırıcılık uyarısı).
