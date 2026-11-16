# Test Raporu — P28e K10 (oturum kaydı; web arayüzü)

DURUM: DÜZELTİLMELİ. İki YÜKSEK bulgu var: "Kayıt yapılıyor" göstergesinde WCAG AA kontrast hatası (müşteri şeridi ve konsol rozeti). Ayrıca bir ORTA ve üç DÜŞÜK bulgu açık. 5xx yok (enjekte edilenler hariç), JS hatası (pageerror) yok, kırık iç link yok, 375 px'te yatay taşma yok. Staging'e dokunulmadı.

Ortam: yerel üretim derlemesi (standalone) `http://localhost:3217` + sahte API/WS `e2e/mock-api.mjs` (:4217), dal `p28e` @ `e911537`, 2026-11-16, yalnız Chromium. Betik: `docs/test-raporu/e2e/p28e-k10/zz-k10-p28e.spec.ts`. Koşu için `apps/web/e2e/` altına geçici olarak kopyalandı, sonra silindi. Ham sonuç: `tarama.jsonl`. Ekranlar scratch'te (136 PNG, kalıcı değil). Başlatılan süreçler kapatıldı (3217/4217 boş).

## Özet

| Ölçüt                                                                                  | Sonuç                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mevcut takım: `p28e-recording` + smoke (`auth`, `sessions`, `guest`), desktop + mobile | **119/119 geçti**, 7 atlandı. Atlananlar spec'te `desktopOnly`: mobilde 390 px tarama, Kaydı izle (MSE), 4 canlı kayıt akışı (rıza/durdur, 2 sn duraklatma, kota, teklif yok). Bir de `sessions` AC-61 testi mobilde atlandı.                                                                            |
| Regresyon `p8-history`, `p17-console`, `p28u-unattended`, `unattended`                 | **Koşulmadı.** Koordinatörün tur sınırı nedeniyle. K11 öncesi koşulmalı.                                                                                                                                                                                                                                 |
| Sayfa taraması: 31 görünüm × açık/koyu × 1440/375 = 124 + keşif E1–E9                  | 108 geçti, 21 kırmızı. Kırmızıların 12'si gerçek axe kontrast ihlali (aşağıda Y-1, Y-2). Kalanları, sıralı 1,2 saatlik koşuda canlı misafir/konsol akışlarındaki tarama betiği zaman aşımları (ürün hatası değil). Aynı akışlar mevcut spec'te yeşil. Bir kırmızı da E5 (O-1).                           |
| HTTP / konsol                                                                          | 31 görünümün hepsinde 200. Konsolda yalnız beklenen kayıtlar var: step-up 401, enjekte edilen 500, oynatıcı 429 ve 401. pageerror 0.                                                                                                                                                                     |
| axe (WCAG 2.1 AA)                                                                      | Ayarlar, geçmiş liste/detay, oynatıcı (hazır/yükleniyor/süresi doldu/hata), sil diyaloğu ve müşteri onay kutusu: 0 ihlal. **Müşteri "Kayıt yapılıyor" ve konsol rozeti: `color-contrast` ihlali.**                                                                                                       |
| 375 px taşma                                                                           | 0 (tüm görünümler)                                                                                                                                                                                                                                                                                       |
| İkonlar (lucide)                                                                       | Ayarlar sekmesi `Video` (aria-current=page), listedeki "Kayıt" işareti `Video` (`aria-label="Kayıtlı"`), Kaydı izle `Play`, Kaydı sil `Trash2`, silindi `Eraser`, gösterge `CircleDot`, Kaydı durdur `CircleStop`, onay kutusu `Video`. Breadcrumb'da `House` + `ChevronRight` var (DESIGN.md'ye uygun). |
| 5 durum                                                                                | Ayarlar: yükleniyor / hata / salt okunur / doğrulama hatası / başarı ✅. Liste (`?recorded=true`): dolu / boş / hata ✅. Detay meta: yükleniyor (iskelet) / hata (Tekrar dene) / silindi / yetkisiz ✅. Oynatıcı: loading / throttled (429) / expired ("Devam et") / error / ready ✅.                   |

## Bulgular

### [YÜKSEK] Y-1 Müşteri şeridinde "Kayıt yapılıyor" metni AA kontrastını karşılamıyor

Sayfa/akış: müşteri sayfası, rızalı kayıt sürerken (ve "Kayıt durdurulamadı, paylaşım duraklatıldı" durumunda).

Adımlar:

1. `p28ec` senaryosuyla oturum aç.
2. Müşteri adı, aydınlatma ve kayıt rızasını işaretle, sonra katıl.
3. Teknisyen kabul etsin, ardından Paylaş.
4. axe çalıştır.

Beklenen: kontrast ≥ 4.5:1 (AC-382'deki gizlenemeyen gösterge; müşteri tarafında en kritik metin).

Gerçekleşen: `color-contrast: .text-control-frame` ihlali çıkıyor. Kırmızı metin açık yeşil "paylaşılıyor" şeridinin üzerinde. Sonuç açık/koyu × 1440/375 dört varyantta da aynı.

Kanıt: `tarama.jsonl` id `musteri-kayit-suruyor`, `musteri-paylasim-duraklatildi`; ekran `musteri-kayit-suruyor-375-light.png` (scratch).

Dosya: `apps/web/components/guest/share-strip.tsx:25` (`text-control-frame`). Token ya da zemin değişmeli.

Not: mevcut e2e'nin axe taraması bu durumu kapsamıyor (yalnız ayar ve detay sayfası).

Atanan: frontend-dev

### [YÜKSEK] Y-2 Konsol "Kayıt yapılıyor" rozeti AA kontrastını karşılamıyor

Sayfa/akış: `/sessions/:id/console`, rızalı kayıt sürerken.

Adımlar: Y-1'deki 1–3. adımlar, ardından konsol sayfasında axe.

Gerçekleşen: `color-contrast: .self-start` (rozet `bg-danger-surface` + `text-control-frame`; içindeki "· Müşteri rızası" `text-fg-muted`). Dört varyantta da var.

Kanıt: `tarama.jsonl` id `konsol-kayit-suruyor`.

Dosya: `apps/web/components/console/rec-indicator.tsx` (rozet `className`).

Atanan: frontend-dev

### [ORTA] O-1 "Kaydı izle" isteği 401 dönünce girişe yönlendirmiyor

Adımlar:

1. `/history/<REC>` sayfasını aç.
2. `POST /sessions/:id/recording/view` isteği 401 dönsün (oturum düşmüş).
3. "Kaydı izle"ye tıkla.

Beklenen: diğer işleyiciler gibi `/login?reason=expired` yönlendirmesi.

Gerçekleşen: sayfada kalınıyor ve sunucu mesajı FormError olarak gösteriliyor. `useWatch` içinde `isUnauthenticated` denetimi yok. `useMeta` ve `DeleteDialog`'da bu denetim var.

Kanıt: `tarama.jsonl` E5 `urlAfter401: /history/01JSSP28E…`.

Dosya: `apps/web/app/(panel)/history/[id]/recording.tsx` `useWatch.start` catch bloğu.

Atanan: frontend-dev

### [DÜŞÜK] D-1 Saklama süresi alanında geçersiz değer sessizce reddediliyor

Adımlar:

1. `p28esole` ile `/settings/recording` sayfasını aç.
2. "Kayıt saklama süresi"ne sırayla boş, `0`, `-5`, `91` gir ve her birinde Kaydet'e bas.

Beklenen: 1–90 aralığı için alan hatası (`fields.*`, mimari §9 "alan hataları").

Gerçekleşen: PUT gitmiyor ama ekranda hiçbir hata metni ya da toast yok. `75` (firma süresini aşan) değeri ise doğru hata veriyor.

Not: `maxLength=2` nedeniyle `<script>` ve `' OR 1=1` girdileri 2 karaktere kesiliyor ve gönderilmiyor (güvenli).

Kanıt: `tarama.jsonl` E2.

Dosya: `apps/web/app/(panel)/settings/recording/recording-form.tsx`.

Atanan: frontend-dev

### [DÜŞÜK] D-2 Meta 404/403 dönerse "Kaydı izle" açıklamasız kayboluyor

Adımlar: `canView=true` olan detay sayfasında `GET /sessions/:id/recording` isteği 404 dönsün.

Gerçekleşen: özet meta ve "Kaydı sil" görünüyor, ama "Kaydı izle" neden yok belli değil.

Beklenen: kısa bir bilgi satırı (ör. "Kayıt bilgisi bulunamadı").

Kanıt: `tarama.jsonl` E6.

Atanan: frontend-dev

### [DÜŞÜK] D-3 Hata metninde sunucu mesajı ham gösteriliyor (doğrulanmalı)

Ayar PUT 500 ve "Kaydı izle" 500 durumlarında FormError'da sunucunun `message` alanı (testte "x") gösteriliyor. Ağ kopmasında ise Türkçe genel metin ("Sunucuya ulaşılamadı…") çıkıyor. Gerçek sunucunun 500 mesajı Türkçe ve genel ise sorun değil. `toUiError` 5xx için genel metne düşmeli mi, frontend-dev doğrulasın.

Kanıt: `tarama.jsonl` E3, E5.

Atanan: frontend-dev

## Akış sonuçları

| Akış                                                                                        | Sonuç | Not                                                               |
| ------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------- |
| Oturumsuz `/settings/recording`, `/history/:id`, `/history?recorded=true` → giriş           | ✅    | `next` parametresi korunuyor                                      |
| Ayar: onaysız açma → hata; gözetimsiz kutu + step-up; tek yönetici uyarısı; salt okunur     | ✅    |                                                                   |
| Ayar PUT 500 / ağ kopması                                                                   | ✅    | Hata gösteriliyor, değer korunuyor (D-3 notu)                     |
| Liste "Kayıtlı" süzgeci: URL'ye yazılıyor, yenilemede korunuyor, geri tuşu önceki URL       | ✅    | `?recorded=xyz` sessizce yok sayılıyor (3 satır)                  |
| Başka/olmayan kayıt `/history/<ULID>`                                                       | ✅    | "Oturum bulunamadı" + geri linki                                  |
| Çift tıklama: Kaydı izle → 1 POST /view; sil onayı → 1 DELETE                               | ✅    | Audit çiftlenmiyor                                                |
| Sil diyaloğu: odak Vazgeç'te; Esc kapatıyor, odak "Kaydı sil"e dönüyor                      | ✅    |                                                                   |
| Oynatıcı: gerçek WebM, 2 bölüm + boşluk, 429 bekleme, indirme yok                           | ✅    | Mevcut spec                                                       |
| Müşteri rıza → kayıt → Kaydı durdur ≤ 2 sn; onaysızda 2000 ms'de duraklama; kota uyarısı    | ✅    | Mevcut spec                                                       |
| Yetkisiz (`view_recording` yok): "Kaydı izle"/"Kaydı sil" yok, "Kaydı izleme yetkiniz yok." | ✅    | Liste "Kayıt" işareti görünür (AC-385 yalnız izlemeyi kısıtlıyor) |
| `POST /view` 401 → giriş                                                                    | ❌    | O-1                                                               |

## Kabul kriterleri (uçtan uca, UI)

| AC           | Sonuç | Nasıl doğrulandı                                                                                     |
| ------------ | ----- | ---------------------------------------------------------------------------------------------------- |
| AC-380       | ✅    | Spec + tarama (ayar ekranı 5 durum, 75 gün hatası). D-1 küçük eksik.                                 |
| AC-381       | ✅    | Onay kutusu varsayılan işaretsiz, teklif yoksa yok                                                   |
| AC-382       | ❌    | İşlev ✅ (≤ 2 sn, sekme başlığı, tüm teknisyenler). Gösterge AA kontrastını karşılamıyor (Y-1, Y-2). |
| AC-383       | ✅    | Spec: parçalar WebM, p>0 EBML ile başlamıyor                                                         |
| AC-384       | ✅    | Kota uyarısı `warning`, yükleme duruyor                                                              |
| AC-385       | ✅    | İzleme yalnız yetkiyle, indirme yok, izleme tıklama başına. 401 davranışı O-1.                       |
| AC-386       | ✅    | Elle silme + onay diyaloğu, silindi nedeni                                                           |
| AC-447 / 450 | ✅    | Gözetimsiz anahtar + step-up; kip ve gerekçe detayda                                                 |

## Görsel gözlemler

- Müşteri şeridi (375 açık): kırmızı "Kayıt yapılıyor" metni açık yeşil zeminde soluk duruyor (Y-1). Düğmeler (Paylaşımı durdur, Oturumu bitir, Kaydı durdur) sığıyor, taşma yok.
- Alt bilgi metni tüm müşteri ekranlarında güncel: "Paylaşımı istediğiniz an durdurabilirsiniz. Ekranınız yalnız izin verirseniz kaydedilir." Gerçek mobil cihazda "Bu cihaz desteklenmiyor" ekranında da aynı.
- Konsol ekranları tasarım gereği iki temada da koyu (`.theme-dark`).
- Sınırlar: yalnız sahte API ve Chromium. Safari/Firefox MSE ve gerçek sunucu kapsam dışı. Görsel incelemede yalnız seçilen birkaç ekrana bakıldı.

# Test Raporu — P28u K10 (gözetimsiz izinli/izinsiz bağlantı + müdahale; web arayüzü)

DURUM: GEÇTİ — engelleyici veya yüksek bulgu yok, 5xx yok, JS hatası yok. Bir ORTA bulgu açık (audit ekranında P28u eylemleri
ham anahtarla görünüyor), K11 öncesinde düzeltilmesi önerilir. Staging'e dokunulmadı (P28u henüz yayında değil).

Ortam: yerel üretim derlemesi (standalone) `http://localhost:3217` + sahte API `e2e/mock-api.mjs` (:4217), dal `p28u` @ `c6a83ff`,
2026-11-16. Betik `docs/test-raporu/e2e/p28u-k10/zz-k10-p28u.spec.ts` (koşu için `apps/web/e2e/` altına geçici kopyalandı, sonra
silindi), ham sonuç `tarama.jsonl`, ekranlar `docs/img/p28u/` (78 PNG). Başlatılan süreçler kapatıldı (3217/4217 boş).

## Özet

| Ölçüt                                                        | Sonuç                                                                                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright test p28u unattended` (mevcut takım)             | **41/41 geçti**, 9 atlandı (spec gereği masaüstüne özel akışlar mobil projede atlanıyor)                                                                                               |
| Sayfa taraması: 17 görünüm × açık/koyu × 1440/375 = 68 ekran | HTTP 200: 68/68. Konsol hatası/uyarısı 0 (yalnız step-up akışında beklenen `401 POST .../connect`). pageerror 0, 5xx 0, axe 0, 375 px yatay taşma 0, kırık iç link 0. En yavaş 1,54 sn |
| Konsolda "açık tema" ekranları koyu                          | Tasarım gereği: konsol `.theme-dark` ile, kullanıcı tercihi Sistem iken koyu açılıyor (DESIGN.md §"Konsol varsayılan koyu"). Bulgu değil; taramadaki 10 "tema" uyumsuzluğu bundan      |
| Keşif turu (E1–E9)                                           | 8/9 beklendiği gibi. E9'da DÜŞÜK bir gözlem var (aşağıda). E1'in son adımı betik hatasıyla zaman aşımına uğradı; ekran görüntüsüyle doğrulandı                                         |

Taranan görünümler: cihaz listesi; cihaz detayı (güncel / eski servis); Bağlan diyaloğu (sor, izinsiz + gerekçe hatası, step-up);
Ayarlar → Gözetimsiz erişim (açık / açma akışı + aydınlatma hatası / salt okunur); geçmiş (filtresiz, `consentMode=silent`, detay);
audit (`consentMode=asked`); konsol (izleme, Müdahale et onayı, kontrol, oturumu kapat onayı, eski servis).

## Bulgular

### [ORTA] Audit ekranı P28u (ve P27) gözetimsiz eylemlerini Türkçe etiket yerine ham anahtarla gösteriyor

Sayfa/akış: `/audit` (masaüstü tablo, mobil kart, ayrıntı diyaloğu başlığı, "İşlem" süzgeci seçenekleri).
Adımlar: 1. `auun` senaryosuyla giriş. 2. `/audit?consentMode=asked` aç (veya `silent`).
Beklenen: "Gözetimsiz bağlantı onayı (cihaz kullanıcısı)", "Gözetimsiz bağlantı isteği" gibi etiketler.
Gerçekleşen: satırda `unattended.consent` düz yazıyor. Aynı eşleme eksikliği `unattended.connect`, `control_toggle`, `lock`,
`logoff`, politika eylemi ve P27 eylemleri (`unattended.code.*`, `device.*`, `grant.changed`...) için de geçerli. Yalnız
`session.started` ve `session.ended` etiketli, çünkü bunlar `TIMELINE_ACTION_LABELS` üzerinden geliyor.
Neden: `apps/web/lib/audit/actions.ts` `AUDIT_ACTION_LABELS`, `@remote/contracts` `UNATTENDED_AUDIT_LABELS`'ı içermiyor.
Etiketler sözleşmede var (`packages/contracts/src/api/unattended.ts:397`).
Kanıt: `docs/img/p28u/audit-izinli-1440-light.png`, `audit-izinli-375-light.png`.
Atanan: frontend-dev

### [DÜŞÜK] Step-up diyaloğu metni bağlanma işleminde yanlış bağlamda

Sayfa/akış: `/unattended` → Bağlan → (izinsiz + gerekçe) → Bağlan.
Beklenen: işleme uygun bir metin, ör. "Bağlanmak için kimliğinizi doğrulayın".
Gerçekleşen: "Bu işlem hassas bir ayarı değiştirir." Bağlanma bir ayar değişikliği değil.
Kanıt: `docs/img/p28u/baglan-stepup-1440-light.png`. Atanan: frontend-dev

### [DÜŞÜK] "Kullanıcı oturumu kapatılsın mı?" onayı Esc ile kapanmıyor

Sayfa/akış: konsol, izinsiz kip → Müdahale et → onay → kontrol → "Kullanıcı oturumunu kapat".
Adımlar: onay diyaloğu açıkken Esc tuşuna bas.
Beklenen: diyalog kapanır (WAI-ARIA alertdialog Esc ile iptal edilir; odak zaten "Vazgeç"te).
Gerçekleşen: diyalog açık kalıyor. Güvenli tarafta: istek gitmiyor (logoff çağrısı 0). Kasıtlıysa DESIGN.md'ye not düşülmeli.
Kanıt: `tarama.jsonl` E9 `{"logoffDialog":1,"logoffCalls":0}`. Atanan: frontend-dev

## Akış sonuçları

| Akış                                                                                              | Sonuç | Not                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Liste: Kullanıcı sütunu (Aktif / Kilitli / —), "Servis güncel değil" rozeti, Bağlan pasif + neden | ✅    | İki tema, 1440/375                                                                                                                  |
| Bağlan diyaloğu "sor" (politika kapalı): bilgi metni, kutu yok                                    | ✅    |                                                                                                                                     |
| İzinsiz: gerekçe < 20, yalnız boşluk, 501 karakter → "Gerekçe 20–500 karakter olmalı"             | ✅    | 501'de sayaç "501 / 500" (girişe izin veriyor, gönderimde engelliyor)                                                               |
| İzinsiz: `<script>alert(1)</script> ' OR 1=1 --` gerekçesi                                        | ✅    | Gövdede düz metin gidiyor; diyalog/alert çalışmadı. Geçmişte gerekçe düz metin (`<b>` kaçışlı görünüyor)                            |
| Çift tıklama Bağlan / Doğrula                                                                     | ✅    | Step-up öncesi 1 POST, toplam 2 (401 + başarılı); çift kayıt yok                                                                    |
| Connect 500 / ağ kopması                                                                          | ✅    | Diyalogda hata metni ("Sunucuya ulaşılamadı..."), düğme yeniden etkin                                                               |
| Liste yoklaması 500                                                                               | ✅    | "Cihaz durumları güncellenemedi; son bilinen durum gösteriliyor" + son veri                                                         |
| Politika: açarken aydınlatma kutusu zorunlu; PUT 500 → hata                                       | ✅    | Hata metni sunucu mesajını gösteriyor                                                                                               |
| Oturumsuz erişim: `/unattended`, cihaz detayı, politika, geçmiş, audit                            | ✅    | Hepsi `/login?next=...` sayfasına yönleniyor. Not: `next` sorgu dizesini (`consentMode`) taşımıyor; mevcut davranış, bulgu değil    |
| Süzgeç: yenileme / geri tuşu / geçersiz `consentMode=xxx`                                         | ✅    | Yenilemede değer korunuyor, geri tuşunda filtresiz liste geliyor. Geçersiz değer yok sayılıyor (geçmiş 30, audit 9 satır), hata yok |
| Geri tuşu (konsol → liste)                                                                        | ✅    | Diyalog DOM'da gizli, ekranda görünmüyor (`keşif-geri-tusu-liste.png`)                                                              |
| Klavye: Esc Bağlan diyaloğunu kapatıyor, odak "Bağlan: AKTIF-PC"ye dönüyor                        | ✅    |                                                                                                                                     |
| Konsol: İzleniyor → Müdahale et onayı (odak Vazgeç) → Vazgeç → izlemede kalıyor, istek yok        | ✅    |                                                                                                                                     |
| Konsol: kontrol → kilitle / oturumu kapat onayı, eski serviste pasif düğme + "güncelleyin"        | ✅    | Mevcut e2e + ekranlar                                                                                                               |

## Kabul kriterleri (uçtan uca, web tarafı; mock API)

| AC                                             | ✅/❌    | Nasıl doğrulandı                                                                                            |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| AC-429                                         | ✅       | Liste Kullanıcı sütunu, iki tema / iki genişlik; e2e AC-429                                                 |
| AC-431                                         | ✅ (web) | "Sor" diyaloğu ve onay bekleme (K4 e2e). Cihazda onay diyaloğu Windows elle listesinde                      |
| AC-433                                         | ✅ (web) | Kip rozeti İzinli / İzinsiz / bekleme. Servis kip kararı ve logoff sonrası davranış Windows elle listesinde |
| AC-443                                         | ✅ (web) | Eski serviste kilitle / oturumu kapat pasif + neden, istek yok (e2e + ekran)                                |
| AC-430, 432, 435, 436, 437, 439, 442, 445, 446 | ✅       | Mevcut 41 e2e + keşif. AC-445 süzgeci doğru çalışıyor; etiket sorunu ORTA bulguda                           |

Windows elle test listesi (cihazda onay diyaloğu, gösterge, kilit / logoff, rejoin) kullanıcıda. Staging dumanı P28u yayınından sonra yapılacak.

## Görsel gözlemler (ekran görüntülerinden)

- Liste (1440 açık/koyu, 375 kart): rozetler ve ikonlu Kullanıcı sütunu okunaklı. Pasif Bağlan'ın altındaki neden metni iki satıra
  sarıyor, taşma yok.
- Bağlan diyaloğu 375 px (izinsiz): uyarı kutusu (sarı) ve hata metni koyu temada okunaklı. Tam sayfa görüntüde alt "Vazgeç"
  görünmüyor. Bu, `fullPage` çekimin sabit konumlu diyaloğu kırpmasından olabilir ("sor" diyaloğunda Vazgeç görünüyor).
  375×812 ekranda elle bir kez kaydırıp bakılması önerilir (`baglan-izinsiz-375-dark.png`).
- Politika 375 px: sabit "Kaydedilmemiş değişiklik" çubuğu tam sayfa görüntüde aydınlatma kutusunun üstüne biniyor. Bu bir çekim
  artefaktı; gerçek ekranda içerik çubuğun altına kaydırılabiliyor.
- Konsol: kip rozeti (İzinsiz: sarı, göz-kapalı ikonu; İzinli: yeşil), "İzleniyor" etiketi, "Müdahale et" düğmesi net. 375 px'te
  logoff onayında "Oturumu kapat" (danger) ve "Vazgeç" alt alta. "Müşteri kontrol izni verdi" toast'ı sahnenin üstünde (fullPage çekim).
- Geçmiş detayı koyu: "Gözetimsiz bağlantı" bölümü, kip, gerekçe ve ikonlu müdahale zaman çizelgesi okunaklı; "(başarısız)" kırmızı.
- Audit: tarih alanları `mm/dd/yyyy` görünüyor. Bunun nedeni headless Chromium'un yerel ayarı; P28u ile ilgisi yok.

---

# Test Raporu — P28b K9 (sunucuda dosya aktarımı + ClamAV + depolama kotası)

Önceki rapor (P28a K9) `docs/arsiv/p28a-test-raporu.md` dosyasına taşındı.

DURUM: DÜZELTİLMELİ. Web ve staging altyapı kapsamı geçti. Kimlikli staging dumanı ise koşulamadı: test hesapları
kullanılamıyor (B1). AC-357 uçtan uca ölçümü bu yüzden yapılamadı. Staging clamd'si eski imza veritabanıyla çalışıyor (B2).

Ortam:

- Yerel: dal `p28b` @ `6f6f7b2`. Staging'deki `ec713f2` ile `apps/` ve `packages/` farkı yok
  (`git diff --stat 6f6f7b2 ec713f2 -- apps packages` boş). Testler üretim derlemesiyle (standalone) koşuldu:
  `http://localhost:3217` + sahte API `e2e/mock-api.mjs` (:4217).
- Staging: `https://185.126.217.99:4450`, yığın `/opt/remote/deploy` (compose `remote`). `server`/`web` imajı
  `remote-server:ec713f2`/`remote-web:ec713f2`, `clamav`/`clamav-update` 1.5.4 (digest sabit). Hepsi healthy; tur
  sırasında yığın 08:48 UTC'de yeniden başlatılmıştı. Tarih 2026-11-16.
- Betikler `docs/test-raporu/e2e/p28b-k9/` altında: `zz-k9-p28b.spec.ts` sayfa taraması, `av-probe.ts` clamd dumanı,
  ham sonuç `tarama.jsonl`, ekranlar `shots/`. Geçici kopyalar silindi. Staging'de konteynere konan betik koşudan sonra
  silindi. Staging'de ayar, firma ve kullanıcı **değiştirilmedi**; sunucu modu açılmadı, geri alınacak test ayarı yok. Tek iz B1'deki giriş denemeleri (audit).

## Özet

| Ölçüt                                                              | Sonuç                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright test p28b p28a`                                        | **17/17 geçti**, 9 atlandı (spec gereği "konsol masaüstü akışı" mobilde atlanıyor; geçti sayılmadı)                                                                                                                         |
| Sayfa taraması (3 ekran + ClamAV-yok durumu, açık/koyu × 1440/390) | 16/16 görünüm: HTTP 200, konsol hata/uyarı 0, 4xx/5xx 0, axe 0, 390 px yatay taşma 0, kırık iç link 0, her biri ≤ 1,7 sn                                                                                                    |
| Hata durumu (API 500)                                              | **Test edilmedi**: üç ekranın verisi sunucu tarafında (SSR) çekiliyor, tarayıcı `route` ile 500'e zorlanamadı (12 "-hata" koşusu artefakt; spec'te `test.skip`). Mevcut e2e'de bu ekranlar için yükleme hatası testi de yok |
| Staging clamd dumanı (server konteynerinden, `ClamdClient` ile)    | PONG ✅, EICAR → `INFECTED Eicar-Test-Signature` ✅, şifreli zip → `SCAN_FAILED ENCRYPTED` ✅, öz-sınama `ok`. İmza: **daily 28177, 2026-11-08 (8 gün)** ❌ (B2)                                                            |
| 50 MB rastgele, yalnız clamd INSTREAM, 5 tekrar                    | 3,60 / 2,96 / 4,09 / 3,23 / 3,26 sn, hepsi `CLEAN`. Tarama payı ≤ 30 sn bütçesinin ~%14'ü. **Uçtan uca AC-357 değil**: yükleme ve şifre çözme dahil değil                                                                   |
| Yalıtım (`ops/check-av-isolation.sh remote`)                       | `SONUÇ: GEÇTİ (uyarı 0)`. D-r2-1 satırı (clamav → server:3001) PASS                                                                                                                                                         |
| Dış port taraması (operatör makinesi → `185.126.217.99:3310`)      | kapalı ✅ (AC-353)                                                                                                                                                                                                          |
| clamd açılış limitleri                                             | `Global size limit 536870912`, `File size limit 268435456`, "Alerting of encrypted archives _and_ documents enabled" ✅ (§28b.6 madde 4)                                                                                    |
| Host kaynak (K6 kapı 6)                                            | `free -m` available 6629 MB, clamav zaten çalışırken ölçüldü (≥ 4,5 GiB ✅); host swap 1803/4095 MB kullanımda; `/` %69 (29 GB boş)                                                                                         |
| clamd bellek (K6 kapı 4, R-P28b-1)                                 | 5 × 50 MB taramadan sonra `remote-clamav-1` 946 MiB / 3 GiB, OOMKilled=false, yeniden başlatma 0 ✅. Eşzamanlı yük tepesi ölçülmedi                                                                                         |
| Log kuralı (AC-361), `logs server --since 30m`                     | 416 satır. 43 karakterlik belirteç deseni ve `fileName`/`file_name` eşleşmesi 0, `fsrv` geçen satır 0. **Pencerede dosya trafiği olmadığı için kanıt değeri düşük**                                                         |

## Bulgular (öncelik sırasıyla)

### [YÜKSEK] B1 — Staging test hesapları kullanılamıyor; kimlikli K9 dumanı engellendi

Sayfa/akış: staging `POST /api/v1/auth/login`, `deploy/ACCESS.txt` hesapları.

Adımlar:

1. Sunucuda `ACCESS.txt`'teki SUPER_ADMIN ve ADMIN satırlarıyla `POST https://185.126.217.99:4450/api/v1/auth/login`
   isteği atılır (`Origin` doğru).
2. USER satırıyla aynı istek atılır.

Beklenen: test hesaplarıyla giriş yapılır, ClamAV testi ve firma sunucu modu API'den denenebilir.

Gerçekleşen:

- SUPER_ADMIN ve ADMIN `401 UNAUTHENTICATED` döndü: dosyadaki şifreler güncel değil. Üç istek turu yapıldı; ilk ikisi kimlik doğrulamaya ulaşmadı (yanlış adres, alan adı), yalnız üçüncüsü ulaştı. Her ayrıcalıklı hesapta 1 başarısız giriş (kilit sınırı 5) ve USER'da MFA kurulumunda bekleyen 1 oturum kaldı; staging'deki tek iz bunlar. 401'in sebebi şifre değişikliği olabileceği gibi kilitli/pasif/adı değişmiş hesap da olabilir
- USER `200` döndü ama `mfaSetupRequired: true`. TOTP kaydı test hesabının durumunu değiştireceği için yapılmadı.
- Sonuç olarak şu adımlar koşulamadı: Super Admin "Bağlantıyı Test Et", TEST firmasında sunucu modunu açma, oturumda EICAR
  yükleme, 50 MB uçtan uca yükleme+tarama ölçümü ve kota/uyarı metni.

Ek (güvenlik): `ACCESS.txt` alanlarını maskelemek için kullandığım `sed` boşlukla ayrılmış satırlarda eşleşmedi. Bu
yüzden üç şifre bu oturumun araç çıktısına (transkript) düştü. Repoya ya da rapora yazılmadı. **Üç hesabın şifresi de döndürülmeli** (USER'ınki hâlâ geçerli).

Öneri: K9 için TOTP'si kasada tutulan ayrı bir staging Super Admin + Admin test hesabı açılmalı (ya da `staging-users.sh`
`ACCESS.txt`'i güncel tutmalı). Ardından bu bölümdeki elle maddeler koşulmalı.

Atanan: devops

### [ORTA] B2 — Staging clamd 8 günlük imza veritabanıyla çalışıyor (ilk açılış yarışı)

Sayfa/akış: staging `clamav` / `clamav-update`, 08:48 UTC yeniden başlatma.

Adımlar:

1. `docker compose logs clamav-update` → `08:48:24 daily.cld updated (version: 28185)`.
2. `docker compose exec clamav sh -c 'printf "zVERSION\0" | nc localhost 3310'` komutu çalıştırılır.

Beklenen: clamd güncel daily'yi (28185) yükler. İmza yaşı ≤ 1–2 gün olur (§28b.3).

Gerçekleşen: `ClamAV 1.5.4/28177/Sun Nov 8 06:23:52 2026`. clamd 08:48:35'te imajdaki eski DB'yi yükledi; 08:58:37 SelfCheck "Database status OK" diyip yine yenisini almadı. 09:01:42 `remote-watch`: `ALERT check=av-signature-age imza yaşı 194 sa > 3 gün`. Bu, runbook §28b.3
"ilk açılış yarışı"dır. Panelde "imza eski" görünür, `av-signature-age` alarmı (> 3 gün) çalar. Yarış her yeniden
başlatmada tekrar edebilir.

Düzeltme: geçici çözüm runbook'taki `docker compose restart clamav`. Kalıcı çözüm için `clamav`'ın ilk freshclam
tamamlanmadan başlamaması düşünülmeli. Bu turda staging'e dokunulmadı.

Atanan: devops

### [DÜŞÜK] B3 — Yeniden başlatmadan sonra `av-up` ALERT (clamd erişilebilirken)

Sayfa/akış: `remote-watch` + server `rs_av_up`.

Adımlar:

1. Yığın 08:48'de yeniden başlatılır.
2. `journalctl -t remote-watch` çıktısına bakılır.

Gerçekleşen: 08:51:37'de `ALERT check=av-up rs_av_up=0 ardışık 2 yoklama`. Oysa 08:55'te server konteynerinden clamd'ye
PONG/EICAR/zip başarılı. Server'ın açılış yoklaması clamd imza yüklemesi (~60 sn) sırasında düştü. Sonraki yoklama 10 dk
sonra; bu sürede `rs_av_up` 0 kalıyor ve watch alarm üretiyor. Yanlış alarm. 08:59:44'te `rs_av_up 1` oldu; 09:01:42 watch turunda `av-up` alarmı tekrarlamadı (yalnız B2 alarmı). Not: "ardışık 2 yoklama"nın ilki 08:41 (yeniden başlatma öncesi örnek) — o anki durumu gözlemlemedim; 08:41 turu "OK (41 kontrol)" demiş.

Atanan: backend-dev (açılışta clamd hazır olana dek kısa aralıklı yoklama) | devops (watch eşiği)

## Akış sonuçları

| Akış                                                                                                     | Sonuç | Not                                                                          |
| -------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------- |
| e2e konsol: yükleme (2 parça) → tarama → müşteri onayı → teslim; belirteç URL'de yok                     | ✅    | desktop                                                                      |
| e2e konsol: virüslü + taranamadı metinleri iki tarafa, teslim yok                                        | ✅    | desktop                                                                      |
| e2e konsol: müşteriden gelen temiz dosya → kabul → indir + SHA-256                                       | ✅    | desktop                                                                      |
| e2e konsol: koyu tema + 390 px SERVER dosya paneli taşmaz, axe 0 (QA madde 8)                            | ✅    | desktop projesinde 390 px viewport ile                                       |
| e2e konsol: fsrv bildirmeyen istemci → dosya alanı kapalı + güncelleme metni                             | ✅    |                                                                              |
| e2e ayarlar: Dosyalar onay zorunlu, kullanım göstergesi; ClamAV testi yoksa anahtar pasif; ClamAV ekranı | ✅    | desktop + mobile                                                             |
| e2e geçmiş: sunucudaki dosyalar listesi + Bearer ile indirme                                             | ✅    | desktop + mobile                                                             |
| e2e misafir web SERVER modu                                                                              | ✅    | desktop                                                                      |
| p28a (pano/yazdırma) 3 test                                                                              | ✅    | regresyon yok                                                                |
| Staging: ClamAV "Bağlantıyı Test Et" (panel/API)                                                         | ⛔    | B1. Aynı denetim (PONG + EICAR + şifreli zip + VERSION) altyapı düzeyinde ✅ |
| Staging: TEST firmasında sunucu modu aç, EICAR yükle → INFECTED                                          | ⛔    | B1 (elle)                                                                    |
| Staging: 50 MB yükleme + tarama ≤ 30 sn (AC-357)                                                         | ⛔    | B1. Yalnız tarama ölçüldü: en çok 4,09 sn                                    |
| Staging: kota/uyarı metni                                                                                | ⛔    | B1. Metin yerelde doğrulandı ("Depolama kotası dolmak üzere…")               |

## Kabul kriterleri (uçtan uca)

| AC     | Durum               | Nasıl doğrulandı                                                                                                     |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| AC-353 | ✅                  | e2e ClamAV ekranı (ağ dışı adres alan hatası). Staging 3310 dışarıya kapalı, yalıtım betiği GEÇTİ. Panel testi ⛔ B1 |
| AC-354 | ✅ web · ⛔ staging | e2e: test yoksa anahtar pasif + neden, açarken onay. Staging'de firma anahtarı denenemedi                            |
| AC-355 | ✅ web              | e2e yükleme → tarama → teslim                                                                                        |
| AC-356 | ✅ web              | e2e belirteç URL'de yok, yalnız `Authorization: Bearer`                                                              |
| AC-357 | ⛔ ölçülemedi       | Uçtan uca staging ölçümü B1 nedeniyle yok. clamd payı 50 MB'ta 2,96–4,09 sn (5 tekrar, amd64)                        |
| AC-358 | ✅ web · altyapı ✅ | e2e virüslü metni. Staging clamd EICAR → `Eicar-Test-Signature`                                                      |
| AC-359 | ✅ web · altyapı ✅ | e2e taranamadı metni. Şifreli zip → `ENCRYPTED`. Fail-closed staging oturumunda denenemedi                           |
| AC-360 | ✅ web              | e2e geçmiş listesi + indirme                                                                                         |
| AC-361 | ⚠️                  | e2e imza eski uyarısı ✅. Staging log taraması temiz ama dosya trafiği yok. Staging imzası gerçekten eski (B2)       |
| AC-362 | ✅ web · ⛔ staging | e2e kullanım göstergesi + kota uyarı metni                                                                           |
| AC-363 | ✅ web · ⏭ Windows  | e2e konsol/misafir bilgi satırı. Windows satırı elle                                                                 |

## Elle kalan maddeler

Bunlar kullanıcıda ya da B1 düzeltilince koşulacak.

- Staging (B1 sonrası):
  - Super Admin "Bağlantıyı Test Et": PONG + EICAR + şifreli zip + imza tarihi. Önce B2 düzeltilmeli, yoksa "imza eski" çıkar.
  - TEST firmasında sunucu modunu aç (step-up TOTP).
  - EICAR yükle → INFECTED.
  - 50 MB × 5 uçtan uca ≤ 30 sn (AC-357).
  - Kota uyarı metni.
  - Sonrasında sunucu modunu kapat. Ardından `logs server --since 30m`'i dosya adı/belirteç için yeniden tara (AC-361).
- Windows (0.13 istemci):
  - SERVER modunda istemcinin dosya alması (kabul → indir → SHA doğrulama).
  - SERVER modunda uzaktan yazdırma (`belge.pdf` taranıp yazıcıya).
  - AC-363 Windows bilgi satırı.
  - 0.13 istemcide AC-352 metni.
  - İz testi.
- PR CI'nin tamamı (Windows `agent-win`, `web e2e`, `test (MySQL 8.4)`): bu turda bakılmadı.

## Görsel gözlemler (ekran görüntülerinden)

`tarama.jsonl`'daki `dark:false` artefakt: kontrol yalnız `dark` sınıfına bakıyor; tema "Sistem" + koyu medya ile koyu açılıyor, ekranlarda doğrulandı. 8 mobil ekrandan 3'üne bakıldı (turlar idareli; kalanlar `shots/` altında). Kullanım çubuğunun renk token'ı kodda denetlenmedi (18,5/20 GB'ta yeşil, uyarı kutusu sarı — renk tutarlılığı frontend'e bilgi notu).

- `shots/dosyalar-mobile-dark.png`: 390 px koyu tema. Alt sekmeler iki satıra düzgün kırılıyor ve hepsinde ikon var. Anahtar
  "Kapalı" ve açıklama okunaklı. Kullanım çubuğu 18,5/20 GB, altında sarı uyarı kutusu ("Depolama kotası dolmak üzere…").
  Kontrast yeterli, taşma yok. Üst sekme çubuğunda solda kaydırma oku "‹fa" kesik görünüyor; bu, yatay kaydırma kalıbının
  beklenen hâli.
- `shots/clamav-mobile-light.png`: "Virüs tarama henüz yapılandırılmadı" bilgi kutusu, "Yapılandırılmadı" rozeti, Sunucu boş,
  Port 3310. "Bağlantıyı Test Et" pasif ve soluk ama okunaklı. Sekme ikonları anlamlı (kalkan = ClamAV).
- `shots/gecmis-dosyalar-mobile-dark.png`: uzun geçmiş sayfasının sonunda "Sunucudaki dosyalar" kartları var. Durumlar
  renkli ve metinli: "Teslim edildi — saklanıyor", "Yazdırma belgesi — saklanmaz", kırmızı "Dosya virüslü bulundu
  (Eicar-Test-Signature)". Yalnız saklanan dosyada "İndir" düğmesi var. Taşma yok.

## Staging ölçüm notu

Zaman çizelgesi, 2026-11-16 UTC:

- 08:48:22 server açıldı.
- 08:48:24 freshclam daily 28185'i indirdi.
- 08:48:35 clamd eski daily 28177'yi yükledi.
- 08:51:37 `remote-watch` `av-up` ALERT verdi (B3).
- 08:55 `av-probe.ts` koşuldu: PONG, EICAR, zip ve 5 × 50 MB tamam.
- 08:57:58 `rs_av_up 0`, `rs_av_signature_age_seconds -1`.
- 08:58:37 clamd `SelfCheck: Database status OK`. Yeni daily'yi **görmedi**, 28177'de kaldı (B2).
- 08:59:44 server'ın ikinci yoklamasından sonra `rs_av_up 1`, `rs_av_selftest_ok 1`,
  `rs_av_signature_age_seconds 700470` (≈ 8,1 gün > 3 gün → `av-signature-age` alarmı beklenir).

B3'teki alarm bu yüzden geçici. Server'ın 10 dakikalık yoklama aralığı açılışta yanlış alarm üretiyor.

- 09:01:42 `remote-watch`: `ALERT check=av-signature-age imza yaşı 194 sa > 3 gün`; `av-up` tekrarlamadı.

## K9 ek — staging uçtan uca (2026-11-16, devops)

B1'in ardından kullanıcı onayıyla staging'de **tek** test hesabı açıldı: `k9-test@staging.invalid`, SUPER_ADMIN, 2FA etkin.
Hesap `deploy/ops/k9-staging-account.sh` ile oluşturuldu (audit `user.created {source:"k9-staging-test"}` 1 satır). Duman testi
`deploy/ops/staging-smoke-p28b.sh` ile yapıldı. Kullanım runbook §28b.8'de. Kimlik yalnız staging host'unda,
`/root/.k9-staging-test.env` (root 600) dosyasında duruyor; rapora ve araç çıktısına değer düşmedi. Mevcut SUPER_ADMIN, ADMIN ve
USER hesaplarına dokunulmadı.

| Adım                                             | Sonuç                                                                                                                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guard                                            | Yerelde (hostname ≠ `develop`) iki betik de "staging değil" diyerek çıktı. Staging'de `develop` + `DEPLOY_ENV=staging` olduğu için guard geçti                                                                         |
| Hesap betiği (2 koşu)                            | 1. koşu: hesap oluşturuldu, 2FA API'den kuruldu (setup → host'ta TOTP → enable, 10 kurtarma kodu dosyada). 2. koşu: "mevcut, parola değişmedi, 2FA tohumla doğrulandı" ✅ idempotent                                   |
| Giriş                                            | SUPER_ADMIN + TOTP, `mfa.stage=ok` ✅                                                                                                                                                                                  |
| (a) ClamAV "Bağlantıyı Test Et"                  | `ok=true`, PONG ✅, EICAR ✅, şifreli zip ✅, `ClamAV 1.5.4/28185`, imza yaşı **0 gün**, `stale=false` (B2 sonrası güncel). Ayar kaynağı `env→panel` oldu (ilk testin beklenen ve kalıcı yan etkisi; runbook §28b.2/7) |
| (b) Demo firmasında sunucu dosya modu            | `false → true` (`consentUpdated=true` ile), saklama süresi 1 gün ✅. Geri alma `true → false` ✅; DB'de `file_server_mode=0` doğrulandı                                                                                |
| (c) Destek oturumu                               | **Koşulamadı**: `POST /sessions` → 403 `FORBIDDEN`. Super Admin oturum açamıyor. Kod `sessions/service.ts:73` "oturum yalnız kendi firmanızda" (tasarım gereği, hata değil)                                            |
| (d) EICAR → INFECTED, (e) 50 MB → CLEAN + AC-357 | **Koşulamadı** (c'ye bağlı). AC-357 uçtan uca ölçümü hâlâ açık. Yalnız clamd dumanı var (yukarıda, 3–4 sn)                                                                                                             |
| (f) Log taraması                                 | **Koşulamadı** (dosya trafiği oluşmadı)                                                                                                                                                                                |
| (g) Temizlik                                     | Oturum açılmadı. Firma modu eski değerinde. Açık K9 oturumu yok, saklanan dosya yok, git ağacı (`/opt/remote`) temiz                                                                                                   |

Kalan iş: (c)–(f) için demo firmasında teknisyen olarak ikinci bir test hesabı gerekiyor (`k9-tech@staging.invalid`, ADMIN). Bu hesap
mevcut onayın dışında. Betikler hazır: `k9-staging-account.sh --tech` hesabı açar, `staging-smoke-p28b.sh` ise (a)–(g)'nin tamamını tek
koşuda yapar. Bunun için kullanıcı onayı gerekiyor.

### K9 ek 2 — teknisyen hesabıyla tam koşu (2026-11-16, koordinatör) — **GEÇTİ**

Kullanıcının ikinci onayıyla `k9-tech@staging.invalid` (ADMIN, demo firması, 2FA) `k9-staging-account.sh --tech` ile açıldı (kimlik yalnız
`/root/.k9-staging-test.env`). `staging-smoke-p28b.sh` ilk iki koşuda `/ws/tech` TLS el sıkışmasında `EPROTO` verdi: `ws` istemcisi SNI
gönderiyordu, Caddy `tls internal` IP sertifikasını SNI'siz seçer. `k9-staging.mjs`'te `servername: ""` (https.request ile aynı) → düzeldi.
Yarıda kalan koşularda geri alma çalıştı (oturum kapandı, `fileServerMode=false`).

| Adım                  | Sonuç                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| (a) ClamAV testi      | ok, PONG, EICAR, şifreli zip, `ClamAV 1.5.4/28185`, imza yaşı 0 gün                                        |
| (b) Sunucu dosya modu | `false → true` (aydınlatma onayı), saklama 1 gün                                                           |
| (c) Oturum            | açıldı, misafir kabul; oda `fileMode=SERVER`, misafir fsrv yeteneği var                                    |
| (d) EICAR             | `INFECTED`, imza `Eicar-Test-Signature`, misafire teklif **yok** ✅                                        |
| (e) 50 MB, 50 × 1 MiB | `CLEAN`; yükleme 0,9 sn, son parça → CLEAN 3,21 sn → **AC-357 (≤ 30 sn) GEÇTİ**                            |
| (f) Log taraması      | 12 iğne (2 dosya adı + belirteç önekleri): server 0, caddy 0 eşleşme; pozitif kontrol 51 satır ✅ (AC-361) |
| (g) Temizlik          | oturum `ENDED`, eicar `INFECTED`, 50 MB `REJECTED` (misafir reddi → disk silindi), `fileServerMode=false`  |

Bu ekle B1 kapandı; P28b K9 staging kapısı **GEÇTİ**. Elle kalan yalnız Windows istemci maddeleri (yukarıda).
