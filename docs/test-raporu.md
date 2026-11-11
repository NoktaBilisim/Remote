# Test Raporu — P8 (oturum geçmişi) sayfa testi, Tur 1
DURUM: GEÇTİ (engelleyici/yüksek bulgu yok, AC ❌ yok, JS hatası/5xx/axe ihlali yok; 2 DÜŞÜK görsel bulgu + 1 gözlem)

Ortam: yerel yığın. Sahte API `apps/web/e2e/mock-api.mjs` + `mock-history.mjs` (:4217), standalone web (:3217, `NEXT_PUBLIC_RS_E2E=1`, üretim derlemesi ve gerçek CSP). CSV için gerçek sunucu (`apps/server`, Fastify inject) ve gerçek MySQL 8.4 (backend'in P8 test konteyneri) kullanıldı. Dal `main` @ `b93533c` + commit'lenmemiş P8 değişiklikleri. Tarih 2026-11-11. Chromium headless. Başlatılan süreçler kapatıldı.
Önceki rapor: `docs/arsiv/p7-test-raporu.md`.

Keşif spec'leri (koşarken `apps/web/` ve `apps/server/test/integration/` altına geçici kopyalandı, sonra silindi):
- `docs/test-raporu/e2e/p8-op.spec.ts` + `p8op.config.ts`
- `docs/test-raporu/e2e/p8-csv-op.test.ts`

Ekran görüntüleri ve ham ölçüm: `docs/img/p8/` (`p8op.jsonl`, `p8-admin.csv`, `p8-superadmin.csv`, `p8-admin.headers.json`).

## Özet
| Ölçüt | Sonuç |
|---|---|
| Tam e2e paketi (`pnpm --filter @remote/web e2e`) | **174 geçti / 54 atlandı / 0 kaldı**. P8 tarafında 19 geçti; atlananlar mobil projede "masaüstü akışı" olarak işaretli testler |
| Keşif spec'i | 22 test, 21 geçti. Kırılan 1 test spec kaynaklı: odak, hidrasyondan önce verilmişti. Ayrı koşuda klavye akışı doğrulandı (aşağıda) |
| Taranan görünüm | 16 sayfa/durum × 6 görünüm (1280/1440/390 × açık/koyu) = 96 yükleme. Liste (USER, ADMIN, SUPER_ADMIN 100 satır), detay (zengin, tarayıcı, salt okunur), boş, filtrede boş, sayfa dışı, hata, geçersiz URL, yetkisiz, bulunamadı (kapsam dışı ve bozuk id). Regresyon: panel, oturumlar |
| Konsol hatası / pageerror | 0. Yalnız bilerek tetiklenen `route.abort` ve 500 kayıtları görüldü |
| 4xx/5xx (beklenmeyen) | 0. Tüm sayfa yüklemeleri 200 döndü; tek 500, sahte olarak üretilen PATCH 500 |
| Kırık link | 0 (97 farklı aynı-köken bağlantı, hepsi 200) |
| axe (wcag2a/aa/21aa) | 100 tarama (doğrulama hataları dahil), **0 ihlal** |
| Yatay taşma (sayfa) | 0 px, 390 px dahil tüm görünümlerde |
| Yavaş | yok (en yavaş yükleme 881 ms) |

## Bulgular
### TEST-P8-1 [DÜŞÜK] Detay "Dosyalar" tablosu dar: dosya adı harf harf kırılıyor, SHA-256 sütunu kesik
Sayfa/akış: `/history/[id]`, dosya aktarımı olan oturum.
Adımlar: 1. 1440 px'te (aynı şey 1280 ve 390'da da var) `/history/01JHXST0000000000000000000` sayfasını aç. 2. "Dosyalar" bölümüne in.
Beklenen: Dosya adı okunur olmalı. Uzun özet (hash) kısaltılmalı veya kaydırma olduğu belli olmalı.
Gerçekleşen: Tablo yarım genişlikteki sütunda duruyor. "kurulum.msi" üç satıra bölünüyor ("kurul / um. / msi"). SHA-256 sütunu kartın sağ kenarında kesiliyor ("ababab…"), kaydırılabildiğine dair bir işaret yok. 390 px'te Onay kayıtları tablosu da aynı biçimde iç kaydırmaya giriyor ("Kaynak" sütunu kesik).
Kanıt: `docs/img/p8/detay-zengin-1440-dark.png`, `detay-zengin-390-light.png`
Atanan: frontend-dev. Öneriler: dosya adına `break-all` yerine `truncate` + `title`; hash için kısaltma (ilk 8…son 8) + kopyala düğmesi; Dosyalar bölümünü tam genişliğe almak.

### TEST-P8-2 [DÜŞÜK] SUPER_ADMIN listesi 1280 px'te tablo kabını 17 px aşıyor, Ticket sütunu kesik
Sayfa/akış: `/history`, SUPER_ADMIN (Firma sütunu açık).
Adımlar: 1. 1280×800'de `/history?pageSize=100` sayfasını aç.
Beklenen: 1280 px'te tablo sığmalı veya kaydırma olduğu belli olmalı.
Gerçekleşen: Tablo kabının `scrollWidth - clientWidth` değeri 17 px. "INC-1002" sağ kenarda kesiliyor. "Demo Firma" ve "Mehmet Kaya" hücreleri iki satıra iniyor, satır yüksekliği ikiye katlanıyor. Sayfanın kendisi taşmıyor (0 px). ADMIN ve USER listeleri sığıyor.
Kanıt: `docs/img/p8/liste-superadmin-100-1280-light.png`; `p8op.jsonl` → `"label":"sa-100-1280","tableScroll":17`
Atanan: frontend-dev. Öneriler: Firma/Teknisyen hücrelerine `whitespace-nowrap` + `truncate`, ya da Bağlantı sütununun boşluğunu daraltmak.

### Gözlem (bulgu değil)
- Uygulama içi (pushState) geri tuşu kaydedilmemiş değişiklikte uyarı vermiyor. `useLeaveGuard` yalnız `beforeunload` ve bağlantı tıklamasını yakalıyor. Test edilen yolda önceki kayıt tam sayfa yüklemesiydi; orada `beforeunload` çalıştı ve değer korundu. Listeden istemci tarafı gezinmeyle gelinip geri basılırsa uyarı çıkmaz. Kabul kriteri bunu açıkça istemiyorsa P9+ için not.
- Tarih alanları headless Chromium'da `mm/dd/yyyy` gösteriyor. Bu tarayıcı yereline bağlı, tr-TR tarayıcıda `gg.aa.yyyy`. Hata değil.
- Notta yazılan `\r\n`, kayıtta `\n` olarak tutuluyor; CSV'de tırnaklı hücre içinde LF olarak çıkıyor. Ayrıştırma bundan etkilenmiyor.

## QA-P8-1 — CSV kanıtı (gerçek sunucu)
Yöntem: `p8-csv-op.test.ts` gerçek sunucuyu çalıştırdı. Testte 8 oturum oluşturuldu, ticket/not değerleri **PATCH API** üzerinden yazıldı, ardından ADMIN ve SUPER_ADMIN (`tenantId` filtresiyle) için `GET /api/v1/sessions/export.csv` çağrıldı ve ham yanıt diske yazıldı. Firma adı `Örnek; "Lojistik" A.Ş.`, teknisyen adı `Şule Güneş`.

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| UTF-8 BOM | ✅ | ilk baytlar `ef bb bf` (`xxd`) |
| Başlıklar | ✅ | `Content-Type: text/csv; charset=utf-8`, `attachment; filename="oturumlar-YYYYMMDD-HHMM.csv"`, `no-store`, `nosniff` (`p8-admin.headers.json`) |
| Başlık satırı | ✅ | ADMIN: `Oturum No;Oluşturma;Başlangıç;Bitiş;Süre;Durum;Mod;Teknisyen;Müşteri;Ticket No;Sonlandıran;Bitiş nedeni;Not` (13 sütun). SUPER_ADMIN: 2. sütun `Firma` (14 sütun) |
| `;` ayraç, CRLF satır sonu | ✅ | 9 satır, her biri CRLF ile bitiyor. Yalnız LF olanlar tırnaklı not hücresinin içinde |
| Türkçe karakter | ✅ | `Çağrı Işıkoğlu Şükrü İnce`, `ç ğ ı ö ş ü Ç Ğ İ Ö Ş Ü`, `İstemci`, `Tarayıcı`, `Müşteri bitirdi` bayt düzeyinde doğru |
| Formül kaçışı `= + - @` | ✅ | `'=1+1`, `'=SUM(A1:A2)`, `'=HYPERLINK(...)`, `'+905551112233`, `'+cmd\|' /C calc'!A0`, `'-42`, `'-2+3`, `'@SUM(1,2)`. `' OR 1=1` ve `a=b` dokunulmadan kalıyor (doğru) |
| Genişletilmiş kural (S8, güncel `csv.ts`) | ✅ | `csvRow` doğrudan çağrıldı: ` =1+1`→`' =1+1`, NBSP`+90`→`'`…, `　@x`, tam genişlik `＝ ＋ － ＠`, `\t=x`, hepsi `'` önekli |
| RFC 4180 | ✅ | `"Ad; Soyad"`, `"T;1"`, `"Ali ""Baba"""`, `"Q""1"`, çok satırlı not `"çok ""tırnak"" ve ; ayraç␊ikinci satır␊üçüncü"`, Firma `"Örnek; ""Lojistik"" A.Ş."`. Kaçış tırnaklamadan önce uygulanıyor: `"'=HYPERLINK(""http://kotu.example"";""tıkla"")"` |
| Ayrıştırma | ✅ | Python `csv.reader(delimiter=";", strict=True)` + `utf-8-sig` ile her iki dosyada da **tüm satırlar 13 (ADMIN) / 14 (SUPER_ADMIN) sütun**. Değerler girdiyle birebir aynı, yalnız önekler eklenmiş |

**Excel tr-TR:** Makinede Microsoft Excel kurulu ve sistem yereli `tr_TR`. AppleScript ile dosyayı açıp hücre okuma denendi, ancak Excel kullanıcı oturumunda zaten açıktı ve AppleEvent zaman aşımına düştü (-1712). Bu yüzden **Excel'de açılış doğrudan kanıtlanamadı**. Dosya yapısına dayanan kanıt şu: BOM, Excel'in dosyayı UTF-8 okumasını sağlar. tr-TR'de liste ayırıcı `;` olduğundan sütunlar doğru ayrılır. Tüm `;`, `"` ve satır sonu içeren hücreler RFC 4180'e göre tırnaklı, ve aynı kurallarla `;` ayraçlı strict ayrıştırma her satırda sabit sütun sayısı veriyor. LibreOffice kurulu değil. Elle doğrulama için `docs/img/p8/p8-superadmin.csv` dosyasını Excel'de çift tıklayıp açmak yeterli. Not: Excel'de açık kalmışsa `p8-op-test.csv` adlı geçici çalışma kitabını kaydetmeden kapatın; kaynak dosya silindi.
Sınır: Backend'in son CSV düzeltmesinden (S8) sonra uçtan uca dışa aktarma yeniden koşulamadı, çünkü P8 test DB konteyneri kaldırılmıştı. Güncel kural, aynı `csvRow` fonksiyonuyla doğrudan doğrulandı. Sunucu entegrasyon testi de aynı kuralı kapsıyor.

## Akış sonuçları
| Akış | Sonuç | Not |
|---|---|---|
| Liste: 25 varsayılan, 10/50/100 sayfa boyutu URL'de | ✅ | SUPER_ADMIN 100 → 80 satır, "80 oturumdan 1–80 arası" |
| Filtreler (tarih, durum, mod, müşteri, teknisyen/firma) URL'de, yenilemede korunuyor, temizle | ✅ | e2e + keşif |
| Geri tuşu sonrası filtre durumu (liste → detay → geri) | ✅ | `?status=ENDED` ve select değeri korunuyor |
| Geçersiz URL değeri uyarısı | ✅ | `status=BOGUS&from=2026-02-30&pageSize=500&mode=X` → uyarı + varsayılan liste |
| İstemci doğrulaması (bitiş < başlangıç, 1 karakter müşteri) | ✅ | `aria-invalid`, istek gitmiyor; 1280/390'da görsel `filtre-hata-*.png` |
| Dışa aktar: yetkiye göre görünür (hro'da yok), 400 (>50.000), 429, ağ hatası | ✅ | abort → "Dışa aktarılamadı · Sunucuya ulaşılamadı…" |
| Dışa aktar çift tıklama | ✅ | 1 istek, 1 indirme |
| 5 durum: boş (yönlendirici), filtrede boş, sayfa dışı, hata + Tekrar dene, yükleniyor | ✅ | `bos-*`, `filtre-bos-*`, `sayfa-disi-*`, `hata-*` ekranları |
| Geniş tablo / dar kart (390) | ✅ | kartlar okunaklı (`liste-390-kartlar-viewport.png`) |
| Detay: özet, onaylar, kontrol dönemleri + rozetler, zaman çizelgesi, kalite, dosyalar | ✅ | görsel bulgu TEST-P8-1 |
| Ticket/not: sayaç (4.000/4.000 kabul, 4.001 ret), doğrulama, sunucu alan hatası, kaydet toast, kalıcılık | ✅ | |
| Not ağ hatası / 500 | ✅ | hata metni + "Hata kodu", form değeri ve "Kaydedilmemiş değişiklik var" korunuyor |
| Çift tıklama "Kaydet" | ✅ | tek PATCH |
| `<script>`, `' OR 1=1`, `<img onerror>` | ✅ | metin olarak saklanıyor ve gösteriliyor, diyalog 0 |
| Kaydedilmemiş değişiklik: menü bağlantısı → diyalog ("Sayfada kal" odakta); yenileme → `beforeunload` | ✅ | `ayrilma-diyalog-1280.png`; uygulama içi geri tuşu için Gözlem'e bakın |
| Klavye: Tab sırası (İçeriğe geç → Çıkış → menü → breadcrumb → Dışa aktar → filtre alanları), Enter ile filtre uygula, not formunda Tab → Kaydet → Geri al, Enter ile kaydet | ✅ | odak halkası görünür (`outline: solid`) |
| "Oturum bulunamadı" (kapsam dışı id, bozuk id `abc`) | ✅ | |
| Yetkisiz (session_history yok): menüde öğe yok, sayfa uyarısı | ✅ | |
| Kenar menüsü "Oturum geçmişi" (ikon + `aria-current`); 390 px yatay kaydırma | ✅ | `ul` `overflow-x:auto`, scrollWidth 412 > 374. `/sessions`'ta öğe görünür alanın dışında (sağ 420/390) ama kaydırınca ulaşılıyor; `nav-390-*.png` |
| Regresyon: panel, oturumlar, konsol P7 kontrol durumları, misafir sayfası | ✅ | tarama (panel, oturumlar 6 görünüm, axe 0) + tam e2e (P4–P7 ve guest spec'leri yeşil) |

## Kabul kriterleri (uçtan uca)
| AC | Sonuç | Nasıl doğrulandı |
|---|---|---|
| AC-60 (liste, filtre, sayfalama, URL durumu) | ✅ | e2e + keşif (sayfa boyutu, geri tuşu, geçersiz URL, klavye) |
| AC-61 (kapsam: USER/ADMIN/SUPER_ADMIN, IDOR → bulunamadı) | ✅ | e2e + tarama |
| AC-62 (detay bölümleri) | ✅ | e2e + 6 görünüm ekranı (görsel: TEST-P8-1) |
| AC-63 (ticket/not, CSV, yetki) | ✅ | e2e + keşif + gerçek sunucu CSV |
| AC-124 (CSV güvenliği: formül kaçışı, RFC 4180, BOM, `;`) | ✅ | QA-P8-1 bölümü (Excel'de açılış elle doğrulanmalı) |

## Görsel gözlemler (ekran görüntülerinden)
- Liste 1280/1440 (açık/koyu): hizalama düzgün, durum rozetleri renkli ve okunaklı, "Ad kaydı yok" italik ayrışıyor, `=HYPERLINK("x")` düz metin. Dışa aktar düğmesi ve "en çok 50.000 satır" ipucu sağ üstte.
- SUPER_ADMIN 1280: Firma/Teknisyen iki satıra iniyor, Ticket sütunu kesik (TEST-P8-2).
- Detay koyu tema: kontrast iyi. "Müşteri istemcisi yönetici olarak çalışıyordu" rozeti sarı zeminde okunaklı. "Kapanış kaydı yok" uyarı renginde. Zaman çizelgesinde başarısız olay kırmızı noktalı ve "(başarısız)" etiketli. Dosyalar tablosu sıkışık (TEST-P8-1).
- 390 px: kart listesi temiz (ad, rozet, tarih · mod · süre, firma · teknisyen, ok). Filtre formu tek sütun. Detayda özet tanım listesine dönüyor. Onay ve dosya tabloları iç kaydırmaya giriyor ve kaydırma ipucu yok (TEST-P8-1).
- Üst menü 390'da kenar menüsü yatay şerit; son öğe yarım görünüyor, bu da kaydırılabildiğini ima ediyor.
