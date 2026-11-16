# Gereksinimler — P28u (Gözetimsiz cihazda izinli / izinsiz bağlantı, müdahale ve ekran kaydı)

Tarih: 2026-11-16 Durum: TASLAK (kullanıcı isteği 2026-11-16; kullanıcı uyurken ayrıntılar varsayımla dolduruldu, §7 — kullanıcı onayı bekler)
Üst doküman: `docs/gereksinimler-p28.md` (P28 alt paketleri), `docs/gereksinimler-kabul-kriterleri-e11-b.md` (P27: AC-273..275, AC-293..297, AC-336..342).
Yeni AC'ler: **AC-429..AC-450 (22 AC)**; bunların AC-447..AC-450 kısmı **P28e eki**dir (P28e'de kodlanır). Yeni hikâyeler: US-76..US-79. Varsayımlar V-PU1..V-PU12. Riskler R-PU1..R-PU7. Açık sorular S-P28u-1..5.
Sıra: P28b → **P28u** → P28e (ayrıntı `docs/gereksinimler-p28.md` §3).

Kullanıcı isteği (kelimesi kelimesine): "gozetimsiz cihazlarda aslinda kullanıcıdan remote isteme olayi ve birde yanında istemedende alma imkani olmasi cok iyi olur. çünkü bazi özel durumlarda girip izlemek gerekebilir. işine son verilecek personelin yanlis yapmasina engel olmak icin izlerken mudahale etmek gerekebilir. ayrica diger bir projemizde observe olarak iyi bir iş cikardik. ekran kaydi alma yeteneginide almak iyi olacaktir."

## 1. Amaç ve iş değeri

Gözetimsiz cihazda (P27) bugün bağlantı her zaman onaysızdır. P28u bunu iki yola ayırır. Varsayılan yolda cihazda oturum açmış kullanıcı varsa ondan izin istenir. İkinci yolda, yalnız firma politikası açıksa ve kişiye ayrıca verilmiş hassas bir yetki varsa, gerekçe yazılarak izin istemeden bağlanılır. Bu yol örneğin işine son verilecek bir personelin zarar vermesini önlemek için izleme ve gerekirse müdahale (oturumu kilitleme veya kapatma) içindir. Ekran kaydı bu bağlantılara P28e altyapısıyla eklenir. Böylece ürün, kullanıcıya saygılı varsayılan davranışı ve işverenin meşru denetim ihtiyacını tek akışta karşılar. Her izinsiz erişim gerekçeli, denetlenebilir ve görünür olur.

## 2. Roller (ek)

| Rol                     | P28u ile gelen                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Super Admin             | Yeni bir şey gelmez. Tenant'lar arası geçişte Admin ile aynı ekranları görür.                                                                                            |
| Admin                   | Tenant ayarı "İzin istemeden bağlanmaya izin ver" (aydınlatma onay kutusu + step-up), `unattended.silent` yetkisini verme. P28e eki: "Gözetimsiz bağlantıları da kaydet" |
| User (Teknisyen)        | İzinli bağlantı isteği. Yetkisi ve politika varsa gerekçeli izinsiz bağlantı, izleme ↔ müdahale geçişi, "Oturumu kilitle", "Kullanıcı oturumunu kapat"                   |
| Cihaz kullanıcısı       | Bağlantı isteğini "İzin ver / Reddet" ile yanıtlar. Her bağlantıda göstergeyi görür (AC-294). Yerel kapatma anahtarı (AC-295) değişmez                                   |
| Müşteri firma yetkilisi | Mevcut bağlantı bildirimini (AC-296) alır. İzinsiz bağlantıda bildirimde "izin istenmeden bağlanıldı" ibaresi bulunur                                                    |

## 3. Kapsam

### Kapsamda

1. **İzinli bağlantı (varsayılan):** cihazda oturum açık ve kilitsiz bir kullanıcı varsa onay diyaloğu gösterilir (İzin ver / Reddet, 60 sn süre aşımı). Kullanıcı yoksa veya oturum kilitliyse bağlantı bugünkü gibi doğrudan açılır.
2. **İzinsiz bağlantı:** tenant politikası, `unattended.silent` yetkisi ve zorunlu gerekçe ile açılır. Bağlantı izleme kipinde başlar, "Müdahale et" ile kontrole geçilir. Gösterge (AC-294) ve bildirim (AC-296) korunur.
3. **Müdahale düğmeleri:** yalnız gözetimsiz oturumda ve kontrol kipinde "Oturumu kilitle" ve "Kullanıcı oturumunu kapat". İkisi de audit'e yazılır.
4. **Audit, bildirim, panel:** izin kararı, bağlantı kipi ve gerekçe kaydedilir. İzinsiz bağlantı diğer yöneticilere e-postayla bildirilir (dört göz). Cihaz satırında kullanıcı durumu gösterilir.
5. **Ekran kaydı (yalnız gereksinim; uygulama P28e):** gözetimsiz bağlantıların tenant politikasıyla kaydedilmesi. AC-447..450 "P28e eki" olarak P28e'de kodlanır. P28u'da kayıt kodu yazılmaz.
6. Platform: yalnız Windows gözetimsiz servis (P27). macOS/Linux'ta gözetimsiz erişim zaten Sonra'dır (P28 kapsam dışı 8).

### Kapsam DIŞI (açıkça)

| #   | Madde                                                                                                                                           | Durum                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | Cihazda **görünmeyen** (göstergesiz) izleme; ekran karartma / gizli mod                                                                         | Kapsam dışı (G-17, AC-294). Bkz. S-P28u-1 |
| 2   | Teknisyen bağlı değilken sürekli kayıt (Observe tarzı "kullanıcı oturum açınca kayıt başlar"), pencere başlığı/klavye-fare olay zaman çizelgesi | Sonra (S-P28u-3)                          |
| 3   | Uzaktan "ağ bağlantısını kes", USB/klavye kilitleme, cihazı kapatma/yeniden başlatma, hesap devre dışı bırakma (AD)                             | Kapsam dışı                               |
| 4   | Gözetimsiz oturumda pano, yazdırma ve ses (izinli bağlantıda bile)                                                                              | Sonra (V45 bu konuda değişmez, V-PU8)     |
| 5   | RDP/terminal sunucu oturumlarında izin isteme veya izleme (yalnız fiziksel konsol, AC-274 notu)                                                 | Sonra (K-P27-13)                          |
| 6   | Bağlantı sonrasında cihaz kullanıcısına "izlendiniz" bildirimi veya rapor                                                                       | Kapsam dışı (V-PU6)                       |
| 7   | Tarayıcı modunda veya katılımlı (kod/link) oturumda izinsiz bağlantı ya da müdahale düğmeleri                                                   | Kapsam dışı                               |
| 8   | Kaydın indirilmesi/dışa aktarılması (V49 aynen)                                                                                                 | Kapsam dışı                               |
| 9   | Müşteri firma bazında ayrı politika (politika tenant düzeyindedir)                                                                              | Sonra (S-P28u-2)                          |

## 4. Kullanıcı hikâyeleri

- US-76: Teknisyen olarak gözetimsiz cihaza bağlanırken başında kullanıcı varsa ondan izin istemek istiyorum ki çalışanın ekranına habersiz girmeyeyim ve kullanıcı kendini güvende hissetsin. (P28u)
- US-77: Firmanın yetkilendirdiği kişi olarak özel durumlarda (ör. işine son verilecek personel) gerekçe yazarak izin istemeden cihaza bağlanmak, izlemek ve gerekirse müdahale etmek (oturumu kilitlemek veya kapatmak) istiyorum ki şirket verisine zarar verilmesini önleyeyim. (P28u)
- US-78: Admin olarak izin istemeden bağlanma yeteneğini yalnız bilinçli olarak açmak, yalnız gereken kişiye vermek ve her kullanımını gerekçesiyle görmek istiyorum ki yetki kötüye kullanılmasın ve KVKK yükümlülüğümü belgeleyebileyim. (P28u)
- US-79: Admin olarak gözetimsiz bağlantıların ekran kaydını tutmak istiyorum ki ihtilafta kanıtım olsun. (P28e eki)

## 5. Kabul kriterleri

### P28u — İzinli bağlantı ve kullanıcı durumu

| AC     | Kriter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-429 | Gözetimsiz servis, konsol oturumunun durumunu sunucuya `active` (oturum açık, kilitsiz), `locked` (kilit ekranı) veya `none` (oturum yok / giriş ekranı) olarak bildirir. Değişiklik panelin gözetimsiz cihazlar listesinde "Kullanıcı: Aktif / Kilitli / Oturum yok" olarak ≤ 10 sn'de görünür (Windows elle test: kilitle → aç → oturumu kapat, üç geçiş de ≤ 10 sn).                                                                                                                       |
| AC-430 | Panelde tek "Bağlan" diyaloğu vardır (step-up dahil, AC-273). Diyalogda "İzin istemeden bağlan" kutusu ve gerekçe alanı yalnız tenant politikası açıkken (AC-436) **ve** kullanıcıda `unattended.silent` varken görünür. Kutu her açılışta işaretsiz başlar. Kutu yoksa veya işaretsizse istek izinli istektir (e2e: politika kapalı / yetki yok / ikisi de var → kutu yalnız sonuncuda görünür).                                                                                             |
| AC-431 | İzinli istekte cihaz durumu `active` ise cihazda, birincil monitörde her zaman üstte bir onay diyaloğu açılır. Diyalog "<teknisyen adı> (<destek firması>) bilgisayarınıza bağlanmak istiyor", "İzin ver / Reddet" düğmeleri ve 60 sn geri sayım gösterir. AC-116 odak ve gecikme kuralı geçerlidir. Diyalog "Bağlan"dan sonra RTT < 100 ms ağda ≤ 3 sn'de görünür. Karar verilene kadar teknisyene hiçbir kare gönderilmez ve hiçbir girdi uygulanmaz (Go birim testi: kare/girdi sayacı 0). |
| AC-432 | "İzin ver"den sonra bağlantı AC-273 tam erişimi ve AC-294 göstergesiyle ≤ 3 sn'de açılır. "Reddet" seçilirse bağlantı açılmaz ve teknisyene "Kullanıcı bağlantıyı reddetti" gösterilir. 60 sn yanıt gelmezse bağlantı açılmaz ve "Kullanıcı yanıt vermedi" gösterilir. Her iki durumda step-up tüketilmiş sayılır; yeni deneme yeni step-up ister (entegrasyon testi).                                                                                                                        |
| AC-433 | İzinli istekte cihaz durumu `locked` veya `none` ise onay sorulmaz, bağlantı P27'deki gibi doğrudan açılır (`consentMode=no_user`). Bağlantı sürerken kullanıcı kilidi açar veya oturum açarsa yeni onay istenmez. AC-294 göstergesi ve AC-295 yerel kapatma anahtarı kullanıcıya görünür ve kullanılabilir kalır (Windows elle test).                                                                                                                                                        |
| AC-434 | Aynı teknisyen aynı cihaza en çok dakikada 1 izinli istek gönderebilir. Fazlası 429 `RATE_LIMITED` alır ve cihazda diyalog açılmaz (entegrasyon testi: 60 sn içinde 2. istek → 429, cihaza giden diyalog mesajı 0). Cihaz başka bir bağlantıda veya bekleyen bir onay diyaloğundayken gelen istek 409 `DEVICE_BUSY` alır (AC-338 kalıbı).                                                                                                                                                     |
| AC-435 | Onay yeteneğini (`rs.cap.consent1`) bildirmeyen eski servise **hiçbir** gözetimsiz bağlantı açılmaz: sunucu 409 `DEVICE_OUTDATED` döner, panelde "Cihazdaki servis güncel değil — güncelleyin" görünür, "Bağlan" pasiftir (entegrasyon testi: yeteneksiz cihaz bileti → 409).                                                                                                                                                                                                                 |

### P28u — İzinsiz bağlantı (politika, yetki, gerekçe, izleme ↔ müdahale)

| AC     | Kriter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-436 | Admin Ayarlar → Gözetimsiz erişim ekranında "İzin istemeden bağlanmaya izin ver" anahtarı vardır ve varsayılan kapalıdır. Anahtarı açmak için iki şart vardır: (a) "Cihaz kullanıcılarını (çalışanları) izin istenmeden izlenebilecekleri ve müdahale edilebileceği konusunda yazılı olarak bilgilendirdik; aydınlatma metnimiz bunu kapsıyor" kutusu işaretlenmelidir, (b) step-up yapılmalıdır. Biri eksikse 422 / 401 `MFA_STEP_UP_REQUIRED` döner. Açma ve kapatma audit'e eski→yeni yazılır. Tenant'taki diğer etkin `unattended.manage` sahiplerine ≤ 60 sn'de e-posta gider (entegrasyon). |
| AC-437 | İzinsiz bağlantı ancak şu koşulların hepsi sağlanırsa açılır: politika açık, `unattended.silent`, `unattended.connect`, cihaz yetkisi (AC-293), step-up ve 20–500 karakterlik gerekçe. Koşullardan biri eksikse sunucu isteği reddeder: politika kapalıysa 409 `SILENT_DISABLED`, yetki eksikse 403, gerekçe geçersizse 422 alan hatası. Arayüzde gizlemek yeterli sayılmaz; bu koşullar sunucuda uygulanır (yetki matrisi entegrasyon testi).                                                                                                                                                    |
| AC-438 | İzinsiz bağlantıda cihazda onay diyaloğu açılmaz ve kullanıcı durumu ne olursa olsun bağlantı açılır. AC-294 göstergesi ve AC-296 müşteri firma bildirimi **aynen** geçerlidir: gösterge çizilemezse bağlantı açılmaz. Bildirime "İzin istenmeden bağlanıldı" ibaresi eklenir, gerekçe eklenmez (e2e + Go birim testi).                                                                                                                                                                                                                                                                           |
| AC-439 | İzinsiz bağlantı **izleme kipinde** başlar. Bu kipte görüntü gelir, girdi ve dosya gönderimi istemcide uygulanmaz ve konsolda pasiftir (Go birim testi: izleme kipinde girdi sayacı 0). Konsoldaki "Müdahale et" düğmesi onay diyaloğundan sonra ≤ 1 sn'de kontrolü açar. "İzlemeye dön" kontrolü kapatır. Cihaz göstergesi kipe göre "Uzaktan izleniyor: <ad> — <firma>" veya "Uzaktan kontrol: <ad> — <firma>" yazar ve ≤ 1 sn'de güncellenir. Her geçiş audit'e `unattended.control_toggle` olarak yazılır. İzinli ve `no_user` bağlantılar P27'deki gibi tam erişimle açılır.                 |
| AC-440 | Politika kapatılırsa veya kullanıcının `unattended.silent` yetkisi geri alınırsa açık izinsiz bağlantılar ≤ 5 sn'de kesilir; anlık kesme çalışmasa bile en geç ≤ 60 sn'de biter (AC-293, AC-338 kalıbı; sahte saatli entegrasyon testi).                                                                                                                                                                                                                                                                                                                                                          |
| AC-441 | Her izinsiz bağlantı başladığında tenant'taki diğer etkin `unattended.manage` sahiplerine ≤ 60 sn'de e-posta gider. E-postada bağlanan kişi, cihaz adı, müşteri firma, saat ve gerekçe bulunur. Gönderim audit'e yazılır. Tenant'ta bağlanan kişiden başka `unattended.manage` sahibi yoksa e-posta, bağlanan kişinin kendisine ve tenant'ın Admin e-posta adreslerine gider (entegrasyon).                                                                                                                                                                                                       |

### P28u — Müdahale düğmeleri

| AC     | Kriter                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-442 | Gözetimsiz oturumda kontrol açıkken (izinli, `no_user` veya izinsizde "Müdahale et" sonrası) konsolda "Oturumu kilitle" ve "Kullanıcı oturumunu kapat" düğmeleri bulunur. Katılımlı oturumda ve izleme kipinde bu düğmeler görünmez. Sunucu ve istemci, bu koşullar dışında gelen komutu reddeder (entegrasyon: katılımlı oturumda `session.lock` → 403).                                                                                        |
| AC-443 | "Oturumu kilitle" onay istemeden çalışır ve cihaz ≤ 2 sn'de Windows kilit ekranına geçer. Bağlantı sürer ve kilit ekranı görüntülenir (AC-274). "Kullanıcı oturumunu kapat" önce "Kaydedilmemiş çalışmalar kaybolur. Oturumu kapatmak istiyor musunuz?" onay diyaloğunu gösterir; onaydan sonra oturum, açık uygulamalar beklenmeden (zorla) ≤ 10 sn'de kapanır ve giriş ekranı görüntülenir (Windows elle test, kaydedilmemiş Not Defteri ile). |
| AC-444 | Audit'e `unattended.lock` ve `unattended.logoff` olayları (teknisyen, cihaz, sonuç) yazılır ve cihazın Windows olay günlüğüne de kaydedilir (AC-273 kalıbı). Eski servis bu komutları desteklemiyorsa düğmeler pasiftir ve AC-352 metni görünür.                                                                                                                                                                                                 |

### P28u — Audit, görünürlük, ortak

| AC     | Kriter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-445 | Gözetimsiz bağlantının başlangıç audit satırı `consentMode` (`asked` / `no_user` / `silent`) içerir. `asked` ise `unattended.consent` olayı karar (`granted` / `denied` / `timeout`) ve yanıt süresiyle (ms) yazılır. `silent` ise gerekçe açık metin olarak yazılır. Bitiş satırında süre (sn) bulunur. Audit Log ekranında "Bağlantı kipi" filtresi vardır (e2e: üç kip ayrı ayrı filtrelenir).                                                                                                                                  |
| AC-446 | Oturum geçmişi detayında gözetimsiz oturumların kipi, gerekçesi (yalnız `silent`), müdahale geçişleri, kilitleme ve oturum kapatma zaman çizelgesi `session_history.view` sahibine görünür; başka tenant 404 döner. Yeni ekranlar AC-287'yi karşılar. Yeni yetki `unattended.silent` yalnız `packages/contracts/src/permissions.ts`'ye eklenir ve toggle ekranında "Hassas — yalnız gerekene verin" açıklamasıyla görünür (AC-404). Kılavuz ve DATASHEET'te üç kip, KVKK uyarısı ve "gizli izleme yoktur" beyanı bulunur (AC-288). |

### P28e eki — Gözetimsiz bağlantılarda ekran kaydı (P28e'de kodlanır)

Bu bölüm P28e'nin AC-380..388'ini genişletir. Uygulama P28e paketinde yapılır ve P28e'nin qa/güvenlik kapısından geçer. Altyapı (şifreli saklama P28b, kota AC-362, saklama/silme AC-386, izleme AC-385, indirme yok V49) aynen kullanılır, yeni bir depolama yolu açılmaz.

| AC     | Kriter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-447 | Admin Ayarlar → Oturum kaydı altında "Gözetimsiz bağlantıları da kaydet" anahtarı vardır ve varsayılan kapalıdır. Anahtar yalnız "Oturum kaydı" (AC-380) açıkken açılabilir. Açmak için AC-436'daki çalışan bilgilendirme kutusu ve step-up gerekir. Audit'e eski→yeni yazılır. "Oturum kaydı" kapatılırsa bu anahtar da kapanır.                                                                                                                                                                                                                        |
| AC-448 | Anahtar açıkken her gözetimsiz bağlantı (`asked`, `no_user`, `silent`) rıza kutusu gösterilmeden ilk kareyle kaydedilmeye başlar. Kayıt kullanıcı rızasına değil tenant politikasına dayanır ve `recording.start` audit'ine `basis=tenant_policy` olarak yazılır. Cihaz göstergesine " — Kayıt yapılıyor" eklenir, konsolda da "Kayıt yapılıyor" görünür. Cihaz kullanıcısı kaydı durduramaz; tek yolu bağlantıyı yerel anahtarla (AC-295) sonlandırmaktır. Anahtar kapalıyken AC-387 aynen geçerlidir ve kayıt yapılmaz (entegrasyon + Go birim testi). |
| AC-449 | İzinli (`asked`) bağlantıda anahtar açıksa onay diyaloğunda (AC-431) "Bu bağlantının ekran kaydı alınacaktır" satırı bulunur; satır olmadan "İzin ver" etkinleşmez (AC-292 kalıbı).                                                                                                                                                                                                                                                                                                                                                                      |
| AC-450 | Gözetimsiz kayıtlar katılımlı kayıtlarla aynı kurallara tabidir: AC-383 (≤ 10 sn parça, AES-256-GCM), AC-384 (kota dolarsa kayıt durur, bağlantı sürer, teknisyende uyarı), AC-385 (yalnız `sessions.view_recording` izler, indirilemez), AC-386 (saklama/silme) ve AC-388. Kayıt listesinde ve oynatıcıda bağlantı kipi ve (`silent` ise) gerekçe görünür (e2e).                                                                                                                                                                                        |

## 6. Fonksiyonel olmayan gereksinimler

- **Performans:** onay diyaloğu ≤ 3 sn'de görünür (AC-431). İzin sonrası bağlantı ≤ 3 sn'de açılır. Kip geçişi ≤ 1 sn sürer. Kilitleme ≤ 2 sn, oturum kapatma ≤ 10 sn sürer. Durum yansıması ≤ 10 sn'dir.
- **Güvenlik:** tüm koşullar sunucuda uygulanır (AC-437, AC-442). Onay diyaloğu öncesinde kare veya girdi gönderilmez (AC-431). Hata durumunda bağlantı açılmaz: gösterge çizilemezse (AC-438) veya eski servis bağlıysa (AC-435). Onay diyaloğunu hangi Windows sürecinin çizeceği mimar kararıdır: AC-341 yardımcıda ileti kutusu yasaklar ve mimari-p27 §5.3 "gösterge dışında pencere yok" der (R-PU3). Güvenlik tasarım turu zorunludur (AC-290, tehdit modeli eki: diyalog sahteciliği, girdi enjeksiyonuyla "İzin ver"e otomatik tıklama).
- **KVKK / iş hukuku:** izinsiz bağlantı ve gözetimsiz kayıt yalnız aydınlatma kutusu ve step-up ile açılır. Gerekçe zorunludur ve dört göz e-postası gider. Gizli izleme yoktur. Gerekçe kişisel veri içerebilir; audit'te açık durur ve audit saklama süresine tabidir.
- **Erişilebilirlik / yerelleştirme:** cihaz diyaloğu klavyeyle kullanılabilir (Tab/Enter/Esc = Reddet). Metinler TR'dir ve tek ileti tablosunda tutulur (P23).
- **Gözlemlenebilirlik:** `rs_unattended_connect_total{mode,result}` ve `rs_unattended_consent_total{decision}` metrikleri tutulur. Runbook'ta izinsiz bağlantı sayısındaki ani artış için alarm notu bulunur.

## 7. Varsayımlar (kullanıcı uyurken en basit güvenli seçenek)

- **V-PU1** "Kullanıcıdan remote isteme" **varsayılan** davranış olur ve kapatılamaz. Kullanıcı varsa her zaman izin istenir; tek istisna AC-437 koşullarıyla yapılan izinsiz bağlantıdır. P27 staging'dedir ve prod'da kapalıdır (AC-297 r3), bu yüzden davranış değişikliği canlı müşteriyi etkilemez.
- **V-PU2** Kullanıcı yoksa veya oturum kilitliyse onay sorulmaz ve bağlantı doğrudan açılır (P27 davranışı). Gerekçe: sorulacak kimse yoktur. Gece bakımı ve sunucu senaryosu bozulmamalıdır. Gösterge kilit ekranında da görünür (AC-294). Kilitli durumda izin istemek teknisyeni kullanıcının dönmesini beklemeye zorlar ve gözetimsiz erişimin amacını ortadan kaldırır.
- **V-PU3** Tek akış: ayrı bir "sessiz bağlan" ekranı yoktur. Aynı "Bağlan" diyaloğuna koşula bağlı bir kutu eklenir (sadelik ilkesi).
- **V-PU4** **Gösterge izinsiz bağlantıda da görünür** (AC-294 değişmez). Görevlendirmede "politika seçeneği, varsayılan görünmez" önerilmişti. Bunun yerine görünür gösterge seçildi, gerekçeleri şunlar: (1) G-17 "gizli mod hiçbir fazda planlanmaz" ve P28 kapsam dışı 6 "gizli süpervizör izlemesi" kullanıcının önceki kararlarıdır. Gizli izleme bu kararları tersine çevirir; böyle bir değişiklik varsayımla yapılmaz. (2) Gizli izleme KVKK ve iş hukukunda en yüksek riskli seçenektir; görünür izleme hukuken çok daha savunulabilirdir. (3) İstenen amaç, personelin zarar vermesini **önlemek** ve gerekirse müdahale etmektir. Görünür gösterge bu amaca engel olmaz, hatta caydırıcıdır. (4) En basit seçenektir: yeni bir politika seçeneği ve iki gösterge kodu yolu gerekmez. Gizli izleme isteniyorsa S-P28u-1 ile kullanıcı karar verir.
- **V-PU5** İzinsiz bağlantı izleme kipinde başlar ve müdahale için bilinçli bir tıklama gerekir (en az yetki). İzinli ve `no_user` bağlantılar P27'deki gibi tam erişimle açılır; P27 davranışı bozulmaz.
- **V-PU6** Bağlantı **sonrasında** cihaz kullanıcısına ayrıca bildirim veya rapor gönderilmez. Gösterge bağlantı süresince zaten görünür ve müşteri firmaya AC-296 bildirimi gider. Ek bir kanal hem karmaşıklık hem de işten çıkarma sürecinde istenmeyen bir uyarı olur.
- **V-PU7** Müdahale düğmeleri yalnız "Oturumu kilitle" ve "Kullanıcı oturumunu kapat"tır. Ağı kesme, kapatma ve USB kilitleme kapsam dışıdır. Bu düğmeler için yeni yetki yoktur: kontrol yetkisi (`unattended.connect` + cihaz yetkisi) zaten klavyeyle aynı işi yapabilir. Oturum kapatma zorla yapılır; amaç zararlı bir işlemi durdurmaktır.
- **V-PU8** V45 değişikliği: V45'in "gözetimsizde müşteri onayı yok" öncülü **yalnız bağlantı onayı ve kayıt için** değişir. Pano, yazdırma ve ses gözetimsizde kapalı kalır (AC-352 sunucu zorlaması aynen). Gerekçe: bağlantı onayı tek seferliktir; özellik başına onay diyaloglarını gözetimsiz servise taşımak ayrı bir iştir ve istenmedi. Kayıt için AC-387, P28e ekinde politika anahtarıyla genişletilir (AC-448). Anahtar kapalıyken AC-387 aynen geçerlidir.
- **V-PU9** Politika tenant düzeyindedir (Admin) ve tek bir anahtardır. Müşteri firma bazında ayrım Sonra'dır (S-P28u-2).
- **V-PU10** `unattended.silent` ortak standarda uyar: Admin rolünde açık, User rolünde kapalı başlar. Asıl kapı politika anahtarıdır ve varsayılan kapalıdır. Kılavuzda "yalnız gerekene verin" uyarısı bulunur (V54 kalıbı).
- **V-PU11** Gerekçe 20–500 karakter serbest metindir. Hazır neden listesi yoktur; sadelik için kategorize edilmez.
- **V-PU12** Gözetimsiz kayıt için ayrı bir anahtar vardır (AC-447). İzinsiz bağlantıda kayıt zorunlu tutulmaz, çünkü P28u, P28e'den önce gelir ve zorunluluk izinsiz bağlantıyı P28e'ye kadar bloklar (S-P28u-4).

## 8. Yetki, audit, ayarlar

### Yetki anahtarları (tek kaynak `permissions.ts`)

| Anahtar             | Paket | Not                                                                                                                                                                  |
| ------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unattended.silent` | P28u  | İzin istemeden bağlanma. `unattended.connect`, cihaz yetkisi ve tenant politikası ayrıca gerekir. Hassastır. P28c'de davetli ve süpervizör için de gerekir (aşağıda) |

P28c etkileşimi (P28c AC-364/368'e not, yeni AC değil): izinsiz (`silent`) bir gözetimsiz oturuma davet edilen veya "İzle" ile katılan kullanıcıda da `unattended.silent` bulunmalıdır. Bulunmuyorsa davet ya da katılım 403 alır. P28c bu koşulu kendi testine ekler.

### Audit olayları

| Olay                                               | İçerik                                                |
| -------------------------------------------------- | ----------------------------------------------------- |
| `unattended.connect` (mevcut, genişler)            | `consentMode`, `reason` (yalnız silent), bitişte süre |
| `unattended.consent`                               | karar `granted/denied/timeout`, yanıt süresi          |
| `unattended.control_toggle`                        | `view → control` / `control → view`                   |
| `unattended.lock`, `unattended.logoff`             | teknisyen, cihaz, sonuç                               |
| Tenant ayarı (silent politikası, gözetimsiz kayıt) | eski → yeni, aydınlatma kutusu onayı                  |
| `unattended.silent.notify`                         | dört göz e-postası gönderimi (alıcı maskeli, sonuç)   |
| `recording.start` (P28e eki)                       | `basis=consent / tenant_policy`                       |

Görüntü içeriği hiçbir audit/log satırına yazılmaz. Gerekçe yazılır, çünkü denetimin konusudur.

### Ayarlar

| Düzey          | Ayar                                         | Varsayılan | Ön koşul                                    |
| -------------- | -------------------------------------------- | ---------- | ------------------------------------------- |
| Tenant (Admin) | İzin istemeden bağlanmaya izin ver           | Kapalı     | Aydınlatma kutusu + step-up (AC-436)        |
| Tenant (Admin) | Gözetimsiz bağlantıları da kaydet (P28e eki) | Kapalı     | Oturum kaydı açık + kutu + step-up (AC-447) |

Yeni dış servis veya env değişkeni yoktur.

## 9. Riskler ve açık sorular

| #     | Risk                                                                                                                            | Etki       | Önlem                                                                                                          | Sahibi                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- | --------------------------- |
| R-PU1 | KVKK / iş hukuku: çalışanın izinsiz izlenmesi ve kaydedilmesi, bilgilendirme yoksa hukuka aykırı olabilir                       | Yüksek     | Varsayılan kapalı, aydınlatma kutusu, gerekçe, dört göz e-postası, görünür gösterge, DATASHEET/kılavuz uyarısı | proje-yoneticisi + guvenlik |
| R-PU2 | `unattended.silent` kötüye kullanımı (yetkili kişinin özel merakla izlemesi)                                                    | Yüksek     | Gerekçe zorunlu, diğer yöneticilere e-posta, audit filtresi, izleme kipinde başlama, isteğe bağlı kayıt        | guvenlik                    |
| R-PU3 | Onay diyaloğu P27 tasarımıyla çelişir: yardımcıda ileti kutusu yasak (AC-341), "gösterge dışında pencere yok" (mimari-p27 §5.3) | Orta       | Mimar diyaloğu çizecek süreci seçer (gösterge bileşeninin genişletilmesi önerilir); güvenlik turu              | mimar                       |
| R-PU4 | Diyalog sahteciliği veya girdi enjeksiyonuyla "İzin ver"e otomatik tıklama                                                      | Orta       | AC-116 gecikme kuralı, onaydan önce girdi uygulanmaz (AC-431), tehdit modeli eki                               | guvenlik + mimar            |
| R-PU5 | Zorla oturum kapatma kullanıcı verisini kaybettirir                                                                             | Orta       | Onay diyaloğu, audit, kılavuz uyarısı; önce "kilitle" önerilir                                                 | frontend-dev + teknik-yazar |
| R-PU6 | Kullanıcı kilitliyken bağlanılıp kullanıcı döndüğünde onay sorulmaması, "izin isteme" beklentisini zayıflatır                   | Düşük–Orta | Gösterge ve yerel kapatma anahtarı görünür; S-P28u-5                                                           | proje-yoneticisi            |
| R-PU7 | Eski servise bağlantı yapılamaması (AC-435) staging cihazlarında kesinti yaratır                                                | Düşük      | Staging-only; runbook'ta servis güncelleme adımı                                                               | devops                      |

### Açık sorular (kullanıcı uyanınca; şimdilik varsayımla ilerlenir)

| #        | Soru                                                                                                                     | Varsayılan                                                                        | Sahibi    |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | --------- |
| S-P28u-1 | İzinsiz bağlantıda cihazdaki gösterge gizlenebilmeli mi (gizli izleme)? G-17 kararının tersine çevrilmesi anlamına gelir | **Kapandı (2026-11-16): gösterge her zaman görünür (V-PU4) — kullanıcı onayladı** | kullanıcı |
| S-P28u-2 | Politika müşteri firma bazında mı olmalı (çalışanı bilgilendirme yükümlülüğü müşteri firmadadır)?                        | Tenant düzeyinde tek anahtar (V-PU9)                                              | kullanıcı |
| S-P28u-3 | "Observe gibi ekran kaydı" teknisyen bağlı değilken de sürekli kayıt mı demek?                                           | Hayır; yalnız bağlantı süresince kayıt (P28e eki)                                 | kullanıcı |
| S-P28u-4 | İzinsiz bağlantı her zaman kaydedilmeli mi (kayıt zorunlu)?                                                              | Hayır; ayrı anahtar (V-PU12)                                                      | kullanıcı |
| S-P28u-5 | Kilitli cihaza bağlanıldıktan sonra kullanıcı kilidi açınca izin sorulsun mu?                                            | Hayır (V-PU2, AC-433)                                                             | kullanıcı |

**Mimari r2 notları (güvenlik tasarım turu, 2026-11-16):** (1) D-P28u-6: AC-436 aydınlatma kutusu metni **değişmez**; ancak
firmanın aydınlatma metninin, panelde cihaz kullanıcısının varlık durumunun (aktif / kilitli / oturum yok) da göründüğünü kapsaması
gerektiği ayar ekranı açıklamasında ve kılavuzda (K11) yazılır. (2) O-P28u-3: `asked` bağlantıda teknisyen kullanıcı oturumunu
kapattıktan sonra konsolda bir kullanıcı oturum açarsa bağlantı sonlandırılır (onay aklama yok; mimari K-P28u-17). AC-433'teki
"yeni onay istenmez" yalnız `no_user` için geçerlidir. A-P28u-2 bununla kapandı. (3) Sonra: S-P28u-6 — örtülme tespitinin P20
katılımlı onay penceresine taşınması.

## 10. Kontrol listesi kararları

| Madde                   | Karar                                                                                                                                                                            | Gerekçe            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1. Yetkilendirme / IDOR | Kapsamda: yeni `unattended.silent`; tüm koşullar sunucuda; başka tenant 404; P28c davet/izleme için de gerekir                                                                   | AC-437, 442, 446   |
| 1. Kimlik doğrulama     | Değişmez; step-up her bağlantıda tüketilir, politika/kayıt ayarı step-up ister                                                                                                   | AC-432, 436, 447   |
| 1. Oturum               | Politika/yetki geri alınınca açık izinsiz bağlantı ≤ 5 sn (en geç 60 sn) kesilir                                                                                                 | AC-440             |
| 5. 5 durum / a11y       | Ayar ekranı, Bağlan diyaloğu, cihaz diyaloğu AC-287; cihaz diyaloğu klavyeyle kullanılır                                                                                         | AC-446, §6         |
| 5. Yıkıcı işlem onayı   | Oturum kapatma ve "Müdahale et" onaylı; kilitleme onaysız (geri alınabilir)                                                                                                      | AC-439, 443        |
| 5. Bildirim             | Müşteri firmaya mevcut bildirim + "izin istenmeden" ibaresi; diğer yöneticilere dört göz e-postası; cihaz kullanıcısına sonradan bildirim yok                                    | AC-438, 441, V-PU6 |
| 5. Yerelleştirme        | TR, tek ileti tablosu                                                                                                                                                            | AC-446             |
| 8. KVKK                 | Varsayılan kapalı politika, aydınlatma kutusu, gerekçe, görünür gösterge, kayıt ayrı anahtar ve saklama süresi P28e'den                                                          | AC-436, 438, 447   |
| 8. Audit                | Kip, karar, gerekçe, kip geçişleri, kilitleme/kapatma; filtrelenebilir                                                                                                           | AC-444, 445        |
| 9. Kapsam dışı          | 9 madde (§3)                                                                                                                                                                     | —                  |
| 9. Ölçülebilir AC       | AC-429..AC-450 (22; 447–450 P28e eki)                                                                                                                                            | —                  |
| 9. Riskler / sorular    | R-PU1..7, S-P28u-1..5                                                                                                                                                            | §9                 |
| Sonra                   | Gizli izleme (kullanıcı kararı gerekirse), sürekli (Observe tarzı) kayıt ve olay zaman çizelgesi, gözetimsizde pano/yazdırma/ses, RDP oturumları, müşteri firma bazında politika | Unutulmasın diye   |

## 11. Mevcut kararlarla ilişki (çift iş yok)

| Mevcut                          | P28u'nun etkisi                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-273 / S24 (onaysız erişim)   | Kullanıcı `active` iken izin istenir. Onaysız erişim yalnız `no_user` durumunda ve AC-437 izinsiz yolunda kalır. Step-up, cihaz yetkisi ve tam erişim değişmez. |
| AC-294 (gösterge)               | Değişmez; izinsiz bağlantıda da geçerlidir. Metin kipe göre değişir (AC-439).                                                                                   |
| AC-295 (yerel kapatma)          | Değişmez; cihaz kullanıcısının her kipte bağlantıyı (ve kaydı) bitirme yoludur.                                                                                 |
| AC-296 (müşteri bildirimi)      | Değişmez; izinsiz bağlantıda ibare eklenir.                                                                                                                     |
| V45 / AC-352                    | Pano, yazdırma ve ses için aynen geçerlidir; yalnız bağlantı onayı ve (P28e eki) kayıt için değişir (V-PU8).                                                    |
| AC-387 (gözetimsizde kayıt yok) | "Gözetimsiz bağlantıları da kaydet" kapalıyken aynen geçerlidir; açıkken AC-448 geçerli olur.                                                                   |
| AC-368 (süpervizör)             | Gizli süpervizör yasağı değişmez; izinsiz oturuma katılım için `unattended.silent` da gerekir.                                                                  |
| AC-116 (diyalog kuralı)         | Cihaz onay diyaloğunda aynen kullanılır; yeni diyalog kuralı yazılmaz.                                                                                          |
