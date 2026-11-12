# Test Raporu — P8b-1 (destek talepleri, panel) sayfa testi, Tur 1
DURUM: GEÇTİ (ENGELLEYİCİ/YÜKSEK yok, AC ❌ yok, JS hatası/beklenmeyen 5xx/axe ihlali yok; 1 ORTA + 3 DÜŞÜK bulgu)

Ortam: yerel yığın. Sahte API `apps/web/e2e/mock-api.mjs` + `mock-requests.mjs` (:4217), standalone web (:3217, `NEXT_PUBLIC_RS_E2E=1`, üretim derlemesi, gerçek CSP). Dal `main` @ `a83d122` + commit'lenmemiş P8b-1. Tarih 2026-11-12. Chromium headless. Başlatılan süreçler kapatıldı, `apps/` altında geçici dosya bırakılmadı.
Önceki rapor: `docs/arsiv/p8-test-raporu.md`.

Keşif spec'i (koşarken `apps/web/` altına geçici kopyalandı, sonra silindi): `docs/test-raporu/e2e/p8b-op.spec.ts` + `p8bop.config.ts`.
Ekran görüntüleri ve ham ölçüm: `docs/img/p8b/` (`p8bop.jsonl` ana koşu, `p8bop-tekrar.jsonl` ikinci koşu).

## Özet
| Ölçüt | Sonuç |
|---|---|
| Tam e2e (`pnpm --filter @remote/web e2e`) | **188 geçti / 68 atlandı / 0 kaldı**. `p8b-requests.spec.ts` dahil. Atlananlar, mobil projede "masaüstü akışı" olarak işaretli testler |
| Keşif spec'i | 26 test. 23 geçti. Kalan 3 testin üçü de spec kaynaklı (aşağıda), ikinci koşuda ölçümler tamamlandı |
| Taranan görünüm | 18 sayfa/durum × 6 görünüm (1280/1440/390 × açık/koyu) = 108 yükleme. Kapsam: talepler (dolu, geçmiş, reddedildi filtresi, boş, geçmiş boş, hata, Super Admin, salt okunur, yetkisiz), ayarlar (Admin, yetkisiz, Super Admin), geçmiş (Kaynak=Talep, talep detayı, liste), panel, oturumlar, misafir sayfası |
| Konsol hatası / pageerror | 0 beklenmeyen. Yalnız bilerek tetiklenen 409/426/503/500/abort kayıtları ve headless'ta `AudioContext was not allowed to start` uyarısı görüldü (Gözlem 1) |
| 4xx/5xx (beklenmeyen) | 0. 108 sayfa yüklemesinin hepsi 200 döndü |
| Kırık link | 0 (138 aynı-köken bağlantı, hepsi < 400) |
| axe (wcag2a/aa/21aa) | 109 tarama (ayar doğrulama hataları açıkken yapılan tarama dahil), **0 ihlal** |
| Yatay taşma (sayfa) | 0 px, 390 dahil tüm görünümlerde |
| Yavaş | yok (en yavaş yükleme 884 ms) |
| **AC-149 toast gecikmesi** | 25 örnek: min 1 ms, medyan 2 ms, **p95 5 ms**, en çok 121 ms (ilk örnek). Hedef ≤ 3 sn: ✅ (yerel) |

### AC-149 ölçüm yöntemi ve sınırı
Sayfa `/sessions` iken `/ws/panel` bağlantısı kurulmuştu (`__e2e/rq/sockets` ≥ 1). Her örnekte test, zamanı aldıktan hemen sonra sahte sunucudan `request.new` olayını gönderdi (`__e2e/rq/new`). Sayfaya eklenen bir MutationObserver, "Yeni destek talebi" toast düğümünün DOM'a girdiği anı kaydetti. Gecikme bu iki an arasındaki farktır. Aynı makinede ölçüldüğü için saatler arasında kayma yoktur. Örnekler arasında 150 ms beklendi.
Ham değerler (ms): 121, 2, 2, 3, 2, 2, 5, 1, 1, 2, 2, 1, 2, 2, 2, 5, 2, 5, 4, 3, 5, 3, 2, 1, 1.
**Sınır:** Bu ölçüm yalnız panel tarafını kapsar (WS mesajı → toast). Asıl yol olan istemci `POST /public/requests` → sunucu → `/ws/panel` → toast ölçülmedi, çünkü gerçek sunucu ve ağ yok. AC'nin "staging ölçümü" şartı **P8b-1 staging'e yayınlandıktan sonra** gerçek sunucuda ölçülecek ve bu rapora eklenecek.

Ek ölçümler:
- 4401 ile kapanan soket yeniden bağlandı: kapanıştan yeni açık sokete kadar **1.021 ms**. Sonrasında olaylar yine geliyor (e2e).
- `request.removed` sonrası kartın 3 sn içinde düştüğü e2e'de doğrulandı (`AC-149` testi). 10 örneklik keşif ölçümü spec kaynaklı bir zamanlama sorunu yüzünden tamamlanamadı (aşağıda). Ayrı bir tanı betiğinde `/requests` açıkken `request.new` → `GET /support-requests?tab=pending` → kart sayısı 3'ten 4'e çıktı, yani canlı güncelleme çalışıyor.

## Bulgular
### TEST-P8b-1 [ORTA] Ayarlar: kaydedilmemiş değişiklik varken menü bağlantısı uyarı vermeden sayfadan çıkarıyor
Sayfa/akış: `/settings/support-requests`
Adımlar: 1. Admin (rqadm) ile ayarları aç. 2. Bekleme süresini değiştir. "Kaydedilmemiş değişiklikler var." yazısı çıkar. 3. Kenar menüsünden "Talepler"e tıkla.
Beklenen: Oturum geçmişi notunda (P8, `useLeaveGuard`) olduğu gibi "Sayfadan ayrılınsın mı?" diyaloğu çıkmalı.
Gerçekleşen: Sayfa doğrudan `/requests`'e gidiyor, diyalog yok (`dialog: 0`) ve değişiklik kayboluyor. Yalnız sayfa yenilemede (`beforeunload`) uyarı var, orada değer korunuyor (`45`). `settings-form.tsx` yalnız `beforeunload` dinliyor.
Kanıt: `docs/img/p8b/p8bop-tekrar.jsonl` → `"kind":"dirty-nav","url":"/requests","dialog":0`; `docs/img/p8b/ayarlar-dirty-menu.png`
Atanan: frontend-dev. Öneri: geçmiş detayındaki `useLeaveGuard` (bağlantı tıklaması + `beforeunload`) bu forma da bağlanmalı.

### TEST-P8b-2 [DÜŞÜK] Kabulden sonra geri tuşu, kabul edilmiş talebi kuyrukta yeniden gösteriyor
Sayfa/akış: `/requests` → Kabul et → konsol → tarayıcı Geri
Adımlar: 1. "Can Öz" kartında "Kabul et"e bas. Konsola geçilir. 2. Tarayıcıda Geri'ye bas.
Beklenen: Kuyruk güncel olmalı ve kabul edilen kart görünmemeli.
Gerçekleşen: Liste önbellekten (istemci yönlendirici önbelleği) geliyor. "Can Öz" kartı yeniden görünüyor (`canStillSee: 1`), oysa sunucuda bekleyenler arasında yok. Kart yeniden kabul edilmek istenirse 409 `REQUEST_CLOSED` toast'ı çıkıyor ve kart düşüyor. Zarar yok ama yanıltıcı. 15 sn yoklama veya bir sonraki `request.*` olayı listeyi düzeltir.
Kanıt: `p8bop.jsonl` → `"kind":"accept-back","cards":["Ayşe Yılmaz","Ali Demir","Can Öz"],"canStillSee":1`
Atanan: frontend-dev. Öneri: `RequestQueue` bağlandığında (veya `pageshow`/`visibilitychange` olayında) bir kez `refresh()` çağrılmalı ya da sayfa dinamik/no-store olmalı.

### TEST-P8b-3 [DÜŞÜK] Ayarlar 390 px: yapışkan kaydet çubuğu ekranın yaklaşık %18'ini kaplıyor ve değişiklik yokken de görünüyor
Sayfa/akış: `/settings/support-requests`, 390×844
Adımlar: 1. Ayarları 390 px'te aç.
Beklenen: Mobilde çubuk ince olmalı, ya da yalnız değişiklik varken açılmalı.
Gerçekleşen: Çubuk üç satır yer kaplıyor (durum metni, "Değişiklikleri geri al", tam genişlik "Kaydet"; yaklaşık 150 px). "Tüm değişiklikler kaydedildi." durumunda da açık kalıyor ve içerik bu çubuğun altında kaydırılıyor. İç taşma ölçümü `form[settings-form] +16` çıktı: çubuğun `-mx-4` kenar boşluğundan geliyor. Sayfa taşması yok.
Kanıt: `docs/img/p8b/ayarlar-390-light.png` (tam sayfa görüntüsünde çubuk, sayfanın ortasında görünüyor)
Atanan: frontend-dev

### TEST-P8b-4 [DÜŞÜK] "Bilinen kaynak" rozeti dar sütunda kötü kırılıyor
Sayfa/akış: `/requests`, TRUSTED + knownDevice kartı (Ali Demir), 1280/1440 ve 390
Gerçekleşen: Yeşil rozet "Bilinen / kaynak" diye iki satıra bölünüyor, sağındaki "· Güvenilen ağ · Bu bilgisayar daha önce destek aldı" ayrı bir sütunda akıyor. Okunuyor ama hizası dağınık.
Kanıt: `docs/img/p8b/talepler-1440-light.png`, `talepler-390-dark.png`
Atanan: frontend-dev. Öneri: "Bilinen kaynak" `whitespace-nowrap`, ayrıntılar alt satırda.

### Gözlemler (bulgu değil)
1. Headless'ta tarayıcı sesi engelliyor (`AudioContext was not allowed to start` uyarısı). Bu durumda görsel toast yine çıkıyor (AC-149 "ses engellenirse görsel bildirim" ✅). Ses kapatılınca yeni AudioContext oluşturulmuyor (`audioDelta: 0`) ve tercih yenilemeden sonra korunuyor (e2e). Uyarı, ilk etkileşimden önce gelen olayda bir kez yazılıyor.
2. Güvenilen ağ alanı tek IP'yi (`8.8.8.8`) "CIDR biçiminde olmalı" diye reddediyor. `/32` yazmak gerekiyor. AC-152 "IP/CIDR" diyor. İpucu metninde örnek olarak `/32` gösterilmesi yeterli olabilir (proje-yöneticisi kararı).
3. Ret diyaloğunda "Diğer" alanı `maxLength` ile 200 karakterde kesiliyor. 201 karakter yapıştırılınca 200'e indirilip gönderiliyor, hata gösterilmiyor. Kabul edilebilir.
4. Ret diyaloğunda Tab, "Reddet" düğmesinden sonra `body`'ye, sonra "Diyaloğu kapat"a geçiyor. Bu, yerel `<dialog>` modal davranışı (tarayıcı kabuğuna çıkış). Odak diyalog dışındaki sayfa öğelerine kaçmıyor. Escape diyaloğu kapatıyor ve odak "Reddet: <ad>" düğmesine dönüyor.
5. 390 px kenar menüsü yatay şerit (`scrollWidth 667 / 374`). "Ayarlar" görünür alanın dışında (573–675 px) ama kaydırınca ulaşılıyor. P8'deki durumun aynısı.
6. "Geçmiş" sekmesinde istemci tarafı 500 sonrası `queue-stale` uyarısı bu turda tetiklenemedi: yoklama yalnız soket kopukken çalışıyor. Hata durumu SSR yolunda (`rqbroken` → `load-error`) doğrulandı.

### Keşif spec'inde kalan 3 test (uygulama hatası değil)
- "ret diyaloğu": 201 karakter ve `<script>…` girdileri geçerli sayılıp gönderildi. Bu kartları düşürdü ve döngü kalmayan bir kartı aradı. Ölçülen 9 girdinin sonucu aşağıdaki tabloda. `' OR 1=1` ve çok satırlı girdiler bu döngüde denenemedi. Ret 503 ve çift tıklama da bu yüzden ölçülemedi, ancak e2e geçerli ret akışını kapsıyor.
- "ayarlar": ilk koşuda `type=number` alana `abc` yazılamadı (spec). İkinci koşuda geçti.
- "kaldırma gecikmesi": yük altında (4 paralel işçi) ilk `request.new`'den sonra kart 15 sn içinde görünmedi. Tek başına koşan tanı betiğinde kart 2 sn içinde geldi, e2e'deki `removed` testi de yeşil. Kararsızlık spec'in senkron noktasında olabilir (soket açık, fakat kuyruk aboneliği henüz bağlanmamış olabilir). İzlenmesi önerilir.

## Akış sonuçları
| Akış | Sonuç | Not |
|---|---|---|
| Kuyruk kartı: talep kodu (`123 456`), ad, telefon, e-posta, bekleme, sürüm, ipucu | ✅ | e2e + 6 görünüm ekranı |
| Kaynak işareti NONE / PREFIX / TRUSTED + knownDevice | ✅ | NONE: "İlk kez görülen kaynak" uyarısı. PREFIX: uyarı + "Benzer ağdan önceki oturum var". TRUSTED+knownDevice: yeşil "Bilinen kaynak · Güvenilen ağ · Bu bilgisayar daha önce destek aldı". IP: geçmiş sekmesinde (e2e). Görsel: TEST-P8b-4 |
| Açıklama düz metin (`https://…`, `<b>`) | ✅ | `a, b` öğesi 0, metin aynen |
| Kabul → konsol | ✅ | `/sessions/<id>/console`. Çift tıklama → **1 istek** |
| Kabul hataları | ✅ | QUEUE_FULL → "Şu an çok yoğunuz…". CLIENT_OUTDATED (426) → "Müşterinin Hızlı Destek dosyası eski…". 503 → sunucu mesajı. OPEN_SESSION_LIMIT → sunucu mesajı. Bu dört durumda kart kalıyor ve düğme yeniden etkin. REQUEST_CLOSED → "Talep artık açık değil…" ve kart düşüyor. REQUEST_TAKEN (e2e) aynı şekilde. Ağ kesik → "Sunucuya ulaşılamadı…". Ekranlar `kabul-hata-*.png` |
| Kabul sonrası geri tuşu | ⚠️ | TEST-P8b-2 |
| Ret diyaloğu: hazır mesajlar | ✅ | 4 seçenek: "Şu an müsait değiliz, sizi arayacağız" (varsayılan, odakta), "Mesai saatleri dışındayız…", "Lütfen firmanızı telefonla arayın", "Diğer (kendi mesajım)". Diyalog için axe 0 (e2e) |
| "Diğer" doğrulaması | ✅ | boş / `abcd` → "en az 5 karakter". `www.ornek.com`, `destek@ornek.com`, `+90 532…`, `http://…` → "bağlantı, e-posta veya telefon içeremez". Hiçbirinde istek gitmiyor, `aria-invalid=true`, odak alanda. `<script>…` metni kabul edilip düz metin olarak gönderiliyor (doğru) |
| Ret → kart düşer, geçmişte ret mesajı | ✅ | e2e |
| Geçmiş sekmesi: durum filtresi URL'de, yenileme ve geri tuşunda korunuyor; anonim kayıt "Adı silinmiş müşteri" | ✅ | `status=REJECTED` yenileme ve geri sonrası 1 kart, `aria-current` "Reddedildi" |
| 5 durum | ✅ | yükleniyor (`loading.tsx` iskeleti, e2e), boş ("Bekleyen talep yok" + ayarlara bağlantı), geçmişte boş, hata (`load-error`), kısmi (`queue-stale`, kod incelemesi + Gözlem 6) |
| Yetkisiz | ✅ | Oturumsuz `/requests` ve `/settings/support-requests` → `/login?next=…`. `support_requests.view` yok → menüde öğe yok, sayfada uyarı. rqro (yalnız view): Kabul/Reddet ve Ayarlar menüsü yok. API: accept **403**, settings **403** |
| Super Admin, firma seçmemiş | ✅ | "Önce firma seçin" (talepler ve ayarlar). `/ws/panel` bağlanmıyor |
| Anlık bildirim: toast + "Görüntüle" | ✅ | `/requests#talep-<id>`, hedef kart görünür alanda |
| Ses aç/kapa, tercih saklanıyor | ✅ | e2e + `audioDelta: 0` |
| Menü rozeti ve sekme başlığı (n) | ✅ | `(28) Oturumlar · …`, `(29) Talepler · …`. Bekleyen 0 iken önek yok, rozet yok |
| `queue.alert` bandı | ✅ | "Olağan dışı talep yoğunluğu. … 03:13 saatine kadar geri çevriliyor…". Bant + toast açıkken axe 0 |
| Yeniden bağlanma (4401) | ✅ | 1,0 sn |
| Ayarlar: bağlantı kopyala | ✅ | "Bağlantı kopyalandı." (e2e) |
| Ayarlar: bağlantıyı yenile | ✅ | Escape/Vazgeç → ref değişmiyor. Yenile → yeni ref. Odak "Vazgeç"te |
| Bekleme süresi 10–120 | ✅ | 9 / 121 / -5 / 10.5 → "10 ile 120 arasında bir tam sayı girin." 10 ve 120 kaydediliyor. Sunucu alan hatası e2e'de |
| WhatsApp alıcıları ≤ 5 | ✅ | 5. alıcıdan sonra "Alıcı ekle" pasif. Yinelenen numara → "Bu numara zaten listede." `<script>`, `' OR 1=1`, `12345` → "Telefon numarası geçersiz." `+1 202 555 0143` kabul (E.164). Kaydedince `+90…` biçimine çevriliyor (e2e) |
| WhatsApp test butonu | ✅ | geçersiz numara / başarılı / 502 hata mesajları (e2e). Çift tıklama → 1 istek |
| E-posta kanalı | ✅ | anahtar pasif, "SMTP ayarlarıyla birlikte P10'da gelecek." |
| Güvenilen CIDR ≤ 10 + doğrulama | ✅ | 10 satırdan sonra "Ağ ekle" pasif. `/8` → "IPv4 aralığı en geniş /16". `2001:db8::/31` → "IPv6 … /32". `300.1.1.1/24`, `abc`, `<script>`, `8.8.8.8` → "CIDR biçiminde olmalı". `192.168.1.0/24` → "Özel, yerel veya ayrılmış adres aralığı eklenemez". Üstte form hatası. Hatalı durumda axe 0 |
| Kaydet çift tıklama / 500 | ✅ | 1 PUT. 500 → "Sunucu hatası. Hata kodu: …", değer (60) ve "Kaydedilmemiş değişiklikler var." korunuyor |
| Kaydedilmemiş değişiklik | ⚠️ | yenilemede `beforeunload` ✅, menü bağlantısında ❌ (TEST-P8b-1) |
| Oturum geçmişi: Kaynak filtresi, "Talep" etiketi + bekleme title'ı, detayda "Destek talebi" bölümü (açıklamada link yok) | ✅ | e2e + `gecmis-*` ekranları (6 görünüm, axe 0) |
| CSV yeni sütunlar (Kaynak, Bekleme) | ✅ (dolaylı) | Sunucu entegrasyon testi `requests-p8b-5.test.ts` (AC-158: başlıkta `;Mod;Kaynak;Bekleme;`, talepten gelen müşteri adında formül kaçışı). Bu turda gerçek MySQL ile uçtan uca CSV indirilmedi: P8b test DB konteyneri ayakta değildi. Sahte API CSV'si yeni sütunları üretmiyor |
| Kenar menüsü ikonları | ✅ | Ana sayfa `house`, Oturumlar `monitor-smartphone`, Talepler `inbox`, Oturum geçmişi `history`, Ayarlar `settings`. Hepsi lucide, `size-5`, `aria-hidden` |
| Klavye | ✅ | Tab sırası: İçeriğe geç → Çıkış → menü → breadcrumb → Bildirim sesi → Bekleyenler/Geçmiş → kart başına Reddet → Kabul et. Enter ile ret diyaloğu açılıyor, Escape kapatıyor, odak geri dönüyor. Ayarlarda Kopyala → Yenile → bekleme → WA anahtarı → Alıcı ekle → test → CIDR → Ağ ekle. Odak halkası görünür |
| Regresyon: panel, oturumlar, misafir sayfası, `/history` | ✅ | 6 görünüm, axe 0, taşma 0 + tam e2e (guest, sessions, p8-history yeşil) |
| Regresyon: konsol P7 (Vazgeç → yeniden iste döngüsü) | ✅ | tam e2e `p7-control.spec.ts`: "K2/S7-2: Vazgeç → control.cancel…", "K6: … hemen yeniden istenebilir", "AC-99/116: ret → 30 sn geri sayım ve kalan istek hakkı" yeşil |

## Kabul kriterleri (uçtan uca, panel kapsamı)
| AC | Sonuç | Nasıl doğrulandı |
|---|---|---|
| AC-129 (bağlantı görünür/kopyalanır, yetkisiz 403) | ✅ | e2e + keşif (rqro settings 403, menüde yok) |
| AC-131 (onaylı yenileme) | ✅ (panel) | e2e + keşif (Vazgeç ref'i korur). 404 ve audit sunucu testinde |
| AC-146 (kuyruk, kart, geçmiş, 5 durum) | ✅ | e2e + 18×6 tarama. 1.000 kayıt / 500 ms ölçümü sunucu tarafında (qa) |
| AC-147 (view/accept yetkisi: menü, buton, 403) | ✅ | e2e + keşif API çağrısı |
| AC-148 (Super Admin yalnız seçili firma) | ✅ (panel) | "Önce firma seçin". Tenant izolasyonu sunucu entegrasyon testinde |
| AC-149 (toast + Görüntüle, ses, sekme başlığı, kaldırma ≤ 3 sn, p95 ≤ 3 sn) | ✅ yerel / **staging ölçümü bekliyor** | panel tarafında p95 5 ms (25 örnek). Uçtan uca staging ölçümü P8b-1 yayını sonrası |
| AC-152 (kanallar, alıcılar, bekleme, CIDR, test butonu) | ✅ (panel) | e2e + keşif. Hız sınırı ve audit sunucuda |
| AC-153 (kabul atomik; 409 mesajı; sınır 409) | ✅ (panel) | REQUEST_TAKEN / CLOSED / OPEN_SESSION_LIMIT mesajları, çift tıklama 1 istek |
| AC-157 (ret 5–200, hazır mesaj, link/e-posta/telefon yasak) | ✅ | e2e + keşif girdileri |
| AC-158 (Kaynak filtresi, detay bölümü, CSV sütunları) | ✅ | e2e + tarama. CSV sunucu entegrasyon testiyle (yukarıdaki not) |
| AC-164 (Talepler ekranı axe 0, açık + koyu) | ✅ | 109 tarama 0 ihlal |

## Görsel gözlemler (ekran görüntülerinden)
- `talepler-1440-light`: Kartlar düzenli. Talep kodu büyük ve monospace, solda kişi bilgisi, sağda kod ve kaynak rozeti, altta ipucu ve Reddet/Kabul et. "İlk kez görülen kaynak" sarı zeminde okunaklı. Açıklamadaki `<b>kalın</b>` düz metin. "Bilinen kaynak" rozetinin kırılımı için TEST-P8b-4.
- `talepler-390-dark`: Tek sütun, Kabul et tam genişlik ve birincil renkte, Reddet altında. Kontrast iyi. Kenar menüsünde "Talepler" rozeti kenarda kesiliyor, şerit kaydırılabiliyor.
- `ayarlar-390-light`: Bölümler (bağlantı, bekleme, bildirimler, güvenilen ağlar) sıralı, ikonlu başlıklar var. Uzun URL ve dosya adı `break-all` ile kırılıyor, okunuyor. Kaydet çubuğu için TEST-P8b-3.
- `gecmis-talep-detay-1280-dark`: "Destek talebi" bölümünde talep zamanı, kabul zamanı, bekleme (talep → kabul), ad, telefon, e-posta ve açıklama var. `=HYPERLINK("x")` ve URL düz metin olarak görünüyor.
- `kabul-hata-*`, `ret-diyalog-*`, `queue-alert-1280`, `bildirim-toast-1280`: Toast'lar sağ altta üst üste diziliyor (en çok 3 görünüyor). Yoğunluk bandı sayfa üstünde uyarı renginde.
