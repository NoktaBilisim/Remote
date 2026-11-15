# Kabul Kriterleri — Remote Support — Bölüm 1/2 (E1–E4)

Ana dosya: `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri.md`. Tarih: 2026-11-11. Durum: TASLAK.
Kaynak notu: parantez içindeki kod (G-nn) `docs/guvenlik-raporu.md` bulgusunu, (Kn) `docs/mimari.md` §12 kararını gösterir. Notsuz AC'ler 2026-11-10 metnidir.

## E1 — Oturum yaşam döngüsü

- AC-1: Üretilen token CSPRNG'den ≥ 32 bayt entropi taşır, base64url kodludur; link `https://<alan-adı>[:port]/session/{token}` biçimindedir.
- AC-2: Token DB'de yalnızca SHA-256 özeti olarak saklanır; DB dökümünde düz token bulunmaz.
- AC-3: Her oturuma 8 haneli sayısal kısa kod atanır (ekranda `4829 1376` biçiminde); kod yalnız oturum bekleme (PENDING) durumundayken geçerlidir ve bekleyen oturumlar arasında global tekildir. Başarısız kod çözümlemesi IP başına (IPv4 /32, IPv6 /64) 10/dk ve ağ öneki başına (IPv4 /24, IPv6 /56) 30/dk ile sınırlıdır; aşımda yalnız o kaynak 15 dk 429 alır, diğer kaynakların kod girişi etkilenmez. (G-02)
- AC-4: TTL tenant ayarıdır (15–30 dk, varsayılan 15); aralık dışı değer 400 döner.
- AC-5: TTL dolmuş link/kod "Bağlantının süresi doldu" gösterir, HTTP 410 döner, durum `EXPIRED` olur.
- AC-6: Linkin GET ile açılması ve müşterinin katılım isteği (join) tokenı/kodu tüketmez; token/kod yalnız teknisyen katılımcıyı kabul ettiğinde (admit) tüketilir. (G-01)
- AC-7: Kabul edilmiş (tüketilmiş) oturumun token/kodu ile yeni katılım 410 ile reddedilir ve audit log'a `result=fail` yazılır. (G-01)
- AC-8: Bekleyen oturum iptal edildiğinde link ve kod 1 sn içinde geçersiz olur (`CANCELLED`); açık müşteri ekranı "Oturum iptal edildi" gösterir.
- AC-9: "Linki kopyala" tam linki panoya kopyalar ve "Kopyalandı" toast'ı gösterir.
- AC-10: "E-posta ile gönder" tenant logosu, teknisyen adı, link, kısa kod ve son geçerlilik saatini (Europe/Istanbul) içeren mail gönderir; sonuç ekranda ve audit log'da (alıcı, konu, sonuç) görünür. Oturum linki e-postası teknisyen başına saatte 20 ile sınırlıdır; aşımda 429. (G-23)
- AC-11: Teknisyenin açık oturum sayısı tenant ayarı ile sınırlıdır (varsayılan 3); aşımda 409 döner.
- AC-12: Oturum oluşturma teknisyen başına saatte 20 ile sınırlıdır; aşımda 429 döner.
- AC-13: Aktif oturum tenant ayarındaki azami süreyi (varsayılan 4 saat) aşamaz; 5 dk önce iki tarafa uyarı gösterilir, sonra `ENDED` olur.
- AC-114: Admin (aynı tenant, `sessions.terminate` yetkisiyle) ve Super Admin aktif oturumu "Zorla sonlandır" ile bitirir; iki taraf 5 sn içinde "Oturum yönetici tarafından sonlandırıldı" görür, istemci AC-107'ye göre kapanır; işlem audit log'a yazılır. (G-04)

## E2 — Sinyalizasyon ve bağlantı

- AC-14: WS bağlantısı yalnız izinli Origin'den kabul edilir (tarayıcı); farklı Origin 403 alır. Native istemci Origin yerine tek kullanımlık ticket (`kind=AGENT`) ile doğrulanır; ticket ve yeniden bağlanma anahtarı URL'de taşınmaz (URL'de gelirse 403). (G-10, G-20)
- AC-15: Teknisyen WS'i geçerli oturum çerezi + oturum sahipliği ile açılır; başka teknisyenin oturumuna katılma 403 döner (IDOR testi).
- AC-16: Müşteri katılımı token/kod + sunucudan alınan tek kullanımlık nonce (60 sn geçerli) ile yapılır; aynı nonce ikinci kez reddedilir.
- AC-17: Tüm WS mesajları zod şemasıyla doğrulanır; şemaya uymayan veya 64 KB'ı aşan mesaj bağlantıyı 1008 koduyla kapatır.
- AC-18: Bağlantı başına WS mesaj hızı 50/sn ile sınırlıdır; aşım bağlantıyı kapatır ve loglanır.
- AC-19: Sunucu 30 sn'de bir ping gönderir; 2 ping yanıtsız bağlantı kapatılır.
- AC-20: SDP/ICE mesajları yalnız aynı oturumdaki karşı tarafa iletilir (çapraz oturum sızıntısı entegrasyon testiyle yok).
- AC-21: TURN kimlik bilgileri coturn `use-auth-secret` ile oturum başına üretilir; yalnız teknisyen katılımcıyı kabul ettikten sonra verilir; ömrü oturumun kalan süresini ve 60 dk'yı aşmaz, oturum sürerken kesintisiz yenilenir; statik TURN şifresi istemciye gitmez; relay oturum başına 8 Mbps ile sınırlıdır. (G-13)
- AC-22: coturn özel, ayrılmış ve geçiş IP aralıklarına (en az: 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4, ::/128, ::1, ::ffff:0:0/96, 64:ff9b::/96, 100::/64, 2001::/32, 2001:db8::/32, 2002::/16, fc00::/7, fe80::/10, ff00::/8) ve ortam dosyasında tanımlı altyapı IP'lerine relay yapmaz; her aralık için negatif test kaydı bulunur. (G-05)
- AC-23: UDP'nin kapalı olduğu ve yalnız 443/TCP ile 5349/TCP çıkışına izin verilen ağda bağlantı TURN-TLS (5349) ile kurulur; müşteri makinesine kök sertifika kurulmaz (prod ölçümü). Yalnız 443/TCP açık ağlar desteklenmez (ADR-0018 risk kabulü). (rev. 2026-11-14, P13b)
- AC-24: Taraflardan biri koptuktan sonra 120 sn içinde dönerse oturum yeni link/kod gerekmeden sürer; karşı taraf "Bağlantı koptu, yeniden bağlanılıyor" görür. Yeniden bağlanmada kontrol izni **sıfırlanır** (yalnız görüntüleme).
- AC-25: Her iki taraf 120 sn'den uzun süre bağlı değilse oturum otomatik `ENDED` olur ve audit log'a yazılır.
- AC-112: Müşteri katılım isteğinden sonra "Teknisyen onayı bekleniyor" ekranında yalnız kendisine gösterilen 4 haneli kabul kodunu görür; teknisyen konsolunda bekleyen katılımcı (ad, mod) listelenir. Teknisyen müşterinin telefonda okuduğu kodu konsola girip eşleşme sağlanmadan SDP/ICE iletilmez, TURN kimlik bilgisi verilmez ve oturum tüketilmez (entegrasyon testi). (G-01)
- AC-113: Teknisyenin reddettiği katılımcı "Teknisyen bağlantıyı reddetti" görür; kod geçerli kalır ve gerçek müşteri aynı kodla katılabilir; reddedilen kaynak (IP) o oturuma tekrar katılamaz. Lobide en çok 3 katılımcı bekler, bekleme 5 dk ile sınırlıdır; oturum başına 5 hatalı kabul kodu girişinde lobi boşaltılır. Bekleme, kabul, ret ve hatalı kod audit log'a yazılır. (G-01)
- AC-120: Müşteri bağlıyken aynı yeniden bağlanma anahtarıyla gelen ikinci bağlantı reddedilir ve audit log'a yazılır; sunucu ve proxy loglarında ticket/yeniden bağlanma anahtarı bulunmaz (log tarama testi). (G-10)

## E3 — Tarayıcı-yalnız müşteri modu ve karşılama sayfası

- AC-26: Karşılama sayfası tenant logosu, firma adı, teknisyen adı/avatarı ve "Teknisyen doğrulama kodu"nu gösterir; aynı kod teknisyen konsolunda görünür. Bu kod müşterinin teknisyeni teyit etmesi içindir; müşteriyi doğrulamaz (müşteri doğrulaması AC-112). (G-01)
- AC-27: Windows masaüstü tarayıcıda birincil buton "Hızlı Destek uygulamasını indir" (imzasız istemci, dosya adında 8 haneli kod; SmartScreen "Ek bilgi → Yine de çalıştır" rehberi aynı adımda), ikincil seçenek "Uygulama çalışmıyor mu? Tarayıcıdan yalnızca görüntü paylaş"tır; macOS/Linux'ta yalnız tarayıcı modu sunulur. (K8, G-25)
- AC-28: Müşteri ad-soyad (2–100 karakter) girmeden ve KVKK aydınlatma onayını işaretlemeden "Paylaşımı Başlat" pasiftir.
- AC-29: Onay kaydı (UTC zaman, IP, user-agent, aydınlatma metni sürüm özeti, izin seviyesi) oturuma bağlı saklanır ve audit log'a yazılır.
- AC-30: "Paylaşımı Başlat" getDisplayMedia'yı çağırır; seçim iptal edilirse "Paylaşım başlatılmadı" mesajı ve "Tekrar dene" butonu gösterilir.
- AC-31: Müşteri sayfadaki veya tarayıcının durdurma butonuyla paylaşımı kestiğinde teknisyen 2 sn içinde "Müşteri paylaşımı durdurdu" görür; müşteri aynı oturumda yeniden paylaşabilir.
- AC-32: "Oturumu Bitir" oturumu anında sonlandırır; teknisyende video 2 sn içinde kesilir.
- AC-33: getDisplayMedia olmayan veya mobil tarayıcıda "Bu cihaz desteklenmiyor; masaüstü Chrome, Edge veya Firefox kullanın" ekranı gösterilir.
- AC-34: Tarayıcı modunda teknisyen konsolunda "Uzaktan kontrol" butonu pasiftir ve "Müşteri tarayıcı modunda: yalnız görüntüleme" açıklaması gösterilir.
- AC-35: Chat mesajı en fazla 2000 karakterdir ve iki tarafta da düz metin (HTML yorumlanmadan) gösterilir.
- AC-36 (rev. 2026-11-11, QA-P5-5): Gelen dosya müşteri "Kabul et" demeden kaydedilmez; çalıştırılabilir/tehlikeli uzantılarda (ör. .exe .msi .bat .ps1 .js .lnk .hta .scr .iso .docm .html .svg) ve çift uzantıda (`.pdf.exe`) ek uyarı gösterilir. **Uzantı listesinin tek kaynağı koddur:** `packages/contracts/src/files.ts` `DANGEROUS_EXT` (+ test fikstürü `packages/contracts/fixtures/file-names.json`); bu metindeki uzantılar yalnız örnektir, liste genişletildiğinde AC metni değişmez. Go istemci (P6) aynı fikstürü geçer. (G-06, S-P5-7)
- AC-37: Müşteri sayfasında paylaşılan görüntünün önizlemesi üzerinde teknisyen çizimleri ve lazer imleci görünür; Chromium'da "Yüzen pencere" (Document Picture-in-Picture) ile diğer uygulamaların üstünde gösterilebilir, desteklenmeyen tarayıcıda buton gizlenir.
- AC-38: Müşteri sayfası iframe içinde açılamaz (`frame-ancestors 'none'`).
- AC-39: Karşılama ve müşteri sayfaları açık/koyu temada axe taramasında kritik ihlal 0 verir ve klavye ile tam kullanılır.
- AC-125: Karşılama sayfası ve istemci (E8), onaydan önce "Sizi kendiliğinden arayan biri bunu istediyse kapatın; banka veya şifre işlemi yapmayın" uyarısını ve "Kötüye kullanımı bildir" bağlantısını (`mailto:` `ABUSE_EMAIL`, bkz. açık soru K10) gösterir. (G-17)
- AC-127: Katılımda gönderilen aydınlatma metni kimliği oturumun tenant'ına ait güncel sürüm değilse katılım 400 ile reddedilir. (G-24)

## E4 — Teknisyen konsolu

- AC-40: Müşteri paylaşımı onayladıktan sonra teknisyende ilk kare p95 < 5 sn (doğrudan), < 8 sn (TURN) içinde görünür (staging testi).
- AC-41: 1920x1080 kaynak ve ≥ 5 Mbps bağlantıda görüntü ≥ 15 FPS ve 10 pt metin okunur çözünürlükte iletilir.
- AC-42: RTT < 50 ms ağda uçtan uca görüntü gecikmesi (ekran saati karşılaştırma testi) p95 < 400 ms'dir.
- AC-43: Görüntü "Sığdır", "%100" ve tam ekran modlarında gösterilir; çoklu monitörde teknisyen müşteri izniyle monitör değiştirebilir (yalnız istemci modu).
- AC-44: Kalite paneli her 1 sn'de FPS, bitrate (kbps), RTT (ms), paket kaybı (%), çözünürlük ve bağlantı tipini (doğrudan / STUN / TURN) gösterir.
- AC-45: RTT > 300 ms, kayıp > %5 veya FPS < 5 durumu 3 sn sürerse gösterge sarı/kırmızıya döner ve metinle açıklanır.
- AC-46: Oturum sonunda kalite özeti (ortalama/min/maks FPS, bitrate, RTT; bağlantı tipi) oturum kaydına yazılır.
- AC-47: Teknisyen "Kontrol iste" ile talep gönderir; müşteri onaylamadan hiçbir girdi olayı gönderilmez ve konsol "Kontrol bekleniyor" gösterir.
- AC-48: Kontrol verildiğinde fare (hareket, sol/sağ/orta tık, çift tık, sürükle, tekerlek) ve klavye (harf, rakam, Türkçe karakterler ç ğ ı ö ş ü İ, F1–F12, Ctrl/Alt/Shift/Win kombinasyonları, Alt+Tab) müşteri ekranına uygulanır; Ctrl+Alt+Del butonu konsolda yoktur.
- AC-49: Fare koordinatları görüntüye göre normalize (0–1) gönderilir; farklı ölçek ve DPI'da hedef noktaya ±2 piksel içinde düşer.
- AC-50: Müşteri kontrolü kapattığında konsol 1 sn içinde "Kontrol müşteri tarafından kapatıldı" gösterir ve girdi göndermeyi durdurur.
- AC-51: "Uzaktan kontrol" yetkisi olmayan teknisyende "Kontrol iste" butonu görünmez ve sunucu kontrol talebi mesajını 403 ile reddeder.
- AC-52: Chat iki yönlüdür, mesajlar zaman damgalıdır, okunmamış sayaç gösterilir.
- AC-53: Dosya transferi iki yönlüdür; dosya başına üst sınır tenant ayarıdır (varsayılan 100 MB); ilerleme yüzdesi ve iptal vardır.
- AC-54: Alıcı SHA-256 özetini doğrular; uyuşmazlıkta dosya silinir ve "Dosya bozuk" gösterilir.
- AC-55: Dosya içeriği uygulama sunucusundan geçmez; yalnız meta veri (ad, boyut, SHA-256, yön, sonuç) saklanır ve audit log'a yazılır.
- AC-56: İşaretleme araçları: kalem, ok, dikdörtgen, lazer, geri al, temizle; en az 4 renk; koordinatlar normalize gönderilir.
- AC-57: İşaretlemenin müşteri tarafında görünmesi RTT < 100 ms ağda p95 < 200 ms'dir; lazer izi 1 sn içinde söner.
- AC-58: İşaretleme kontrol izni gerektirmez ve müşteri bilgisayarında girdi olayı üretmez.
- AC-59: "Oturumu Sonlandır" onay diyaloğundan sonra oturumu bitirir; müşteri tarafı "Oturum sonlandırıldı" gösterir.
- AC-117: Alınan dosyanın adı temizlenir (yol bileşenleri, `: * ? " < > | /` ve kontrol/Unicode yön karakterleri silinir; ayrılmış Windows adları `_` önekli; ≤ 255 karakter); var olan dosyanın üzerine yazılmaz (`(1)` eklenir); istemcinin (E8) yazdığı dosyaya internet bölgesi işareti (Zone.Identifier, ZoneId=3) eklenir; boyut sınırı alınan bayt sayısıyla uygulanır (test fixture'ı iki istemcide aynı sonucu verir). (G-06)
- AC-119: Teknisyenin sahip olmadığı yetkiye (dosya transferi, uzaktan kontrol) ait DataChannel istekleri müşteri tarafında (istemci ve tarayıcı) reddedilir; kontrol isteği yalnız sunucu kanalından kabul edilir. (G-09)
