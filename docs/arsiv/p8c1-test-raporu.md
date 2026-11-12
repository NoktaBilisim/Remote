# Test Raporu — P8c-1 (Müşteriler modülü + bilgisayar kaydı, sunucu + panel), Tur 1
DURUM: GEÇTİ (ENGELLEYİCİ/YÜKSEK yok, AC ❌ yok, beklenmeyen 5xx ve JS istisnası yok, axe ihlali 0. 1 ORTA bulgu (ortam: Admin parolası) + 3 DÜŞÜK bulgu. AC-175'in Ayarlar kısmı Admin girişi olmadığı için doğrulanamadı.)

Ortam: staging https://remote.noktabilisim.net, `main` @ `1748d10`, 2026-11-12 (15:15–15:30 TSİ). Yerel Chromium (Playwright 1.65, headless), `@axe-core/playwright` (wcag2a/aa/21aa).
Hesap: **yalnız `teknisyen.user@remote-staging.local` (USER, Demo Firma)**. Yetkileri: sessions.*, remote_control.use, file_transfer.use, session_history.view, support_requests.view/accept, customers.view/create/edit/delete. `settings.edit` ve `session_history.export` **yok**. İlk girişte şifre değişikliği istenmedi.
Admin hesabıyla giriş yapılamadı (bkz. Bulgu 1). Hesabı kilitlememek için 2 denemeden sonra durdum.
Betikler: `docs/test-raporu/e2e/p8c1/` (`common.mjs`, `login.mjs`, `scan.mjs`, `flow1..3.mjs`; parolalar yalnız ortam değişkeninden okunur). Ham ölçüm ve 63 ekran görüntüsü: `/private/tmp/claude-501/-Users-mennan-Projeler-Remote/fa15848a-dcdd-4f1b-abf9-1c72703d5eac/scratchpad/p8c1-test/` (`scan-u.jsonl`, `flow1..3.jsonl`, `img/`).
Önceki rapor: `docs/arsiv/p8b1-test-raporu.md`.

## Özet
| Ölçüt | Sonuç |
|---|---|
| Taranan sayfa | 12 rota × 4 görünüm (1280 açık/koyu, 390 açık/koyu) = 48 yükleme. Kapsam: `/`, `/customers` (varsayılan, `status=all`, `status=passive`, `q=` sonuçsuz), `/requests` (kuyruk, geçmiş, `customer=general`), `/sessions`, `/history` (+`customerFirm=none`), `/settings/support-requests`. Akışlarda ek olarak müşteri detayı (aktif, pasif, sekme hatası), yardım, form, onay diyalogları, Yeni oturum diyaloğu ve `history?customerFirm=<id>` |
| HTTP durumu | 48/48 yükleme 200. En yavaş yükleme 1.040 ms (`/requests?tab=history`); "yavaş" eşiğini aşan sayfa yok |
| Konsol hatası / pageerror | pageerror 0. Bilerek tetiklenen 409 (ad çakışması) ve 500 (sekme hatası simülasyonu) dışında yalnız `/ws/panel` 429 (2 satır; Bulgu 4) |
| 4xx/5xx (beklenmeyen) | 0 |
| Kırık link | 0. 20 aynı-köken bağlantı denendi, hepsi 200 |
| axe | Tarama + akışlarda 56 analiz, **0 ihlal**. Kapsam: liste, yardım (açık/koyu), alan hatalı form, detay (açık/koyu), yenileme diyaloğu, Yeni oturum müşteri seçimi, geçmiş firma filtresi |
| Mobil (390 px) taşma | 0 px. Tüm taranan sayfalar ile müşteri detayı ve geçmiş firma filtresi kontrol edildi |
| İndirme | `request-download` 302 → `/downloads/NoktaDestek-<etiket>-<ref>.exe`. `Range: bytes=0-1` ile 206, ilk baytlar `MZ`, `Content-Disposition: attachment; filename="NoktaDestek-TestMusteriP8c152157-<ref>.exe"`, `application/octet-stream` |

## Bulgular (öncelik sırasıyla)

### [ORTA] Staging Admin hesabının parolası ACCESS.txt'teki değerle uyuşmuyor
Sayfa/akış: `/login`.
Adımlar:
1. `/opt/remote/deploy/ACCESS.txt` içindeki ADMIN satırının parolasıyla `teknisyen.admin@remote-staging.local` olarak giriş yap.

Beklenen: Giriş yapılır (runbook §"Sırlar": parolayı değiştiren kişi ACCESS.txt'i günceller).
Gerçekleşen: `POST /api/v1/auth/login` 401, "E-posta/kullanıcı adı veya şifre hatalı". İki deneme yapıldı, hesap kilitlenmesin diye bırakıldı.
Etki: Ayarlar > Destek talepleri ekranında "Genel bağlantı" adı (AC-175, Ayarlar kısmı) ve Admin'e özgü görünümler bu turda gezilemedi. Super Admin satırı denenmedi.
Kanıt: scratchpad `login.jsonl` (`path: /login`), `POST /auth/login` 401.
Atanan: devops (ACCESS.txt'i güncel parolayla düzeltmek veya `deploy/staging-users.sh` ile parolayı sıfırlamak; parolalar rapora yazılmaz).

### [DÜŞÜK] Var olmayan müşteri detayı HTTP 200 dönüyor
Sayfa/akış: `/customers/[id]`.
Adımlar:
1. Giriş yap.
2. `/customers/01ZZZZZZZZZZZZZZZZZZZZZZZZ` adresine git.

Beklenen: "Müşteri bulunamadı" ekranı ve HTTP 404. Rota tablosu "Yok/başka tenant → 404 sayfası" diyor; AC-172 için API zaten 404 dönüyor (`GET /api/v1/customers/01ZZ…` → 404).
Gerçekleşen: Ekran doğru ("Müşteri bulunamadı"), ancak belge yanıtı **200**. Yanıt Suspense/`loading.tsx` akışıyla başladığı için `notFound()` durum kodunu değiştiremiyor (P2'de `/session/[token]` için aynı neden belgelenmişti).
Kanıt: `flow2.jsonl` `detail-404 {"st":200,"h1":"Müşteri bulunamadı"}`.
Atanan: frontend-dev. Ekran yeterliyse sapma olarak implementation.md'ye yazılmalı.

### [DÜŞÜK] "Tümü" filtresinde boş durum metni yanıltıcı
Sayfa/akış: `/customers?status=all`, firmada hiç müşteri yokken.
Adımlar:
1. Müşterisi olmayan firmada `/customers?status=all` adresine git.

Beklenen: Varsayılan boş durumdaki gibi "Henüz müşteri yok" + "Yeni müşteri" + yardım (AC-166).
Gerçekleşen: Başlık "Henüz müşteri yok", ama gövde "Durum filtresini değiştirerek diğer müşterileri görebilirsiniz." Filtre zaten "Tümü" olduğu için değiştirilecek bir şey yok. Boş durumda "Yeni müşteri" ve yardım düğmesi de yok (üstteki "Yeni müşteri" düğmesi görünüyor).
Kanıt: `img/u_customers_status_all_d-light.png`.
Atanan: frontend-dev.

### [DÜŞÜK] Hızlı sayfa geçişinde `/ws/panel` el sıkışması 429
Sayfa/akış: Panelin tamamı.
Adımlar:
1. Aynı oturumla yaklaşık 1 dakikada 12 sayfayı art arda yükle (tarama, 4. görünüm).

Gerçekleşen: Konsolda 2 kez `WebSocket connection to 'wss://…/ws/panel' failed: … 429` görüldü. Sayfa çalışmaya devam etti; tarama sonrasında yeni talep bildirimi denenmedi.
Değerlendirme: WS bağlantı kovası tasarım gereği olabilir; normal kullanıcı bu hızda gezinmez. Yine de konsola hata düşüyor ve 429 sonrası `Retry-After`'a göre sessiz yeniden bağlanma yapılıp yapılmadığı doğrulanmalı.
Kanıt: `scan-u.jsonl` (`tag: m-dark`, `/settings/support-requests`).
Atanan: backend-dev (kova eşiği) + frontend-dev (429'da sessiz geri çekilme). Gözlem düzeyinde.

## Akış sonuçları
| Akış | Sonuç | Not |
|---|---|---|
| Giriş (USER) / çıkışlı korumalı URL | ✅ | Çerezsiz `/customers/<id>` → `/login?next=%2Fcustomers%2F<id>`; çerezsiz `GET /api/v1/customers` → 401 |
| Giriş (ADMIN) | ❌ ortam | Bulgu 1 |
| Yardım "Müşteriye nasıl gönderilir?" | ✅ | Klavyeyle (Enter) açıldı. 5 adım + SmartScreen notu + "Oturumlar > Yeni Destek Oturumu" ayrımı var. Esc ile kapandı, odak tetikleyiciye döndü. axe açık/koyu 0 |
| Form geçersiz girdiler | ✅ | Boş ad ve tek harf → "Ad en az 2 karakter olmalı". `x@` → "E-posta adresi geçersiz". `abc-123` → "Telefon numarası geçersiz". `Kötü Etiket!` → etiket hatası. Notta sekme karakteri → hata. Ad alanı açılışta odakta |
| Ad 101 karakter | ✅ (davranış) | `maxLength=100` girdiyi 100 karaktere kırpıyor ve kayıt oluşuyor (hata yok). Test sırasında "X×100" müşterisi oluştu, pasife alındı |
| Adda `<script>alert(1)</script>` | ✅ | Ad kuralı (`UNSAFE_NAME_CHARS`) yalnız kontrol karakterlerini yasaklıyor, kayıt oluştu. Başlıkta düz metin olarak görüldü, `dialog` tetiklenmedi (XSS yok). Pasife alındı |
| Notta `<script>…</script> ' OR 1=1 --` | ✅ | Düz metin olarak gösterildi, dialog 0 |
| Oluştur "Test Müşteri P8c 152157" (çift tıklama) | ✅ | `dblclick` → tek `POST /customers` 201 (çift kayıt yok). Detaya yönlendirdi, toast "… eklendi". Ref `[a-z2-7]{16}`, dosya `NoktaDestek-TestMusteriP8c152157-<ref>.exe` |
| Ad çakışması (büyük harf `TEST MÜŞTERİ P8C …`) | ✅ | 409 → alan altında "Bu adla bir müşteri zaten var" |
| Kopyala | ✅ | Pano içeriği = tam indirme bağlantısı. "Kopyalandı" görünüp 2,6 sn sonra temizlendi |
| Arama | ✅ | Küçük harf, büyük harf (`İ`), Türkçe karaktersiz (`musteri`), yetkili kişi (`çağrı öztürk`) ve telefon (`05321112233`) aramalarının hepsi 1 sonuç verdi. 2 karakterden sonra URL `?q=` ile güncellendi |
| Yenileme / geri tuşu | ✅ | `?q=` sayfa yenilemede korundu. Detaydan geri dönünce filtre ve satır korundu |
| İndirme (request-download) | ✅ | 302 + 206/`MZ`. Etiketi yanlış dosya adı (`NoktaDestek-Baska-<ref>.exe`) → 404 |
| Bağlantıyı yenile | ✅ | Diyalog uyarı metnini içeriyor, odak "Vazgeç"te. Vazgeç bağlantıyı değiştirmedi. Onaydan sonra yeni ref ve toast geldi; **eski ref 404**, yeni ref 302 |
| Pasife al | ✅ | Odak Vazgeç'te. Sonrasında "Pasif — bağlantı geçersiz…" yazdı, **ref 404** (geçersiz ref ile aynı yanıt) ve Yeni oturum seçiminde listelenmedi |
| Yeniden aktif et | ✅ | Diyalogda "eski dosyalar ve kayıtlar geçersiz" yazıyor. Yeni ref üretildi; pasif öncesi ref 404 kaldı, yeni ref 302 |
| Detay sekmeleri | ✅ | Talepler boş durumu. `/customers/:id/requests` 500'e zorlanınca `customer-tab-error` + "Tekrar dene" göründü, yeniden deneme toparladı. Oturumlar boş durumu |
| Talepler müşteri filtresi | ✅ | Mod "Müşteri seç…" → combobox (yalnız test müşterisi) → `?customer=<id>`. Mod "Genel" → `?customer=general`. `tab=history&customer=<id>` açıldı |
| Yeni destek oturumu + müşteri | ✅ | Combobox'ta aktif müşteri listelendi, pasifken listelenmedi. Oluşan kartta "Müşteri firma: Test Müşteri P8c 152157" yazdı. Oturum diyalogdan iptal edildi |
| Geçmiş `customerFirm=<id>` | ✅ | 1 satır, "Müşteri firma" sütunu ve değeri doğru. 390 px'de taşma yok |
| Geçmiş CSV "Müşteri firma" sütunu | — | USER'da `session_history.export` yok (403, beklenen). Doğrulanamadı |
| Ayarlar > Destek talepleri "Genel bağlantı" | — | USER'da `settings.edit` yok; sayfa "Firma ayarlarını değiştirme yetkiniz yok" uyarısı veriyor (doğru). Admin olmadan başlık doğrulanamadı |
| Müşteriler sayfasında Genel bağlantı şeridi | ✅ | Salt okunur, Kopyala var, dosya adı görünüyor, yenileme düğmesi yok |
| Var olmayan müşteri | ⚠ | Ekran doğru, HTTP 200 (Bulgu 2). API 404 |
| Temizlik | ✅ | Test turunda oluşan 3 müşterinin üçü de pasife alındı ("Test Müşteri P8c 152157", "X×100", `<script>…`). Aktif liste yine boş, pasif listede 3 kayıt var. Oluşturulan oturum iptal edildi |

## Kabul kriterleri (uçtan uca, staging)
| AC | Durum | Nasıl doğrulandı |
|---|---|---|
| AC-165 | ✅ (kısmi) | USER (customers.* açık) için menü öğesi ve düğmeler göründü. Yetkisiz durum ve Admin varsayılanı staging'de denenmedi (e2e/entegrasyon testleri kapsıyor) |
| AC-166 | ✅ | Menüde Building2 ikonu, sütunlar (ad, Kopyala+dosya, oluşturma, "—", 0, "Aktif" metni), arama (≥ 2 karakter, harf ve Türkçe karakter duyarsız), Aktif/Pasif/Tümü filtresi, boş ve sonuçsuz arama durumları. Boş durum metninde küçük kusur var (Bulgu 3). 1.000 kayıtla performans ölçülmedi |
| AC-167 | ✅ | Alan hataları, 409 çakışma (büyük/küçük harf ve Türkçe karakter duyarsız), etiket önerisi (`TestMusteriP8c152157`) ve etiket biçimi kontrol edildi |
| AC-168 | ✅ | Ref `[a-z2-7]{16}`. Dosya adı biçimi doğru. Pasif ve geçersiz ref aynı 404'ü veriyor. Hash eşitliği (iki müşteri ve Genel dosya) staging'de karşılaştırılmadı; yalnız ilk 2 bayt okundu |
| AC-169 | ✅ | Kopyala ve 2 sn'lik "Kopyalandı" çalışıyor. Pasifken bağlantı yerine "Pasif — bağlantı geçersiz" yazıyor |
| AC-170 | ✅ | Diyalog metni ve Vazgeç odağı doğru. Yeni ref üretildi, eski ref 404 |
| AC-171 | ✅ | Pasife al / yeniden aktif et çalışıyor; pasifken ref 404, Yeni oturumda görünmüyor, aktif etmede yeni ref. Bekleyen talep iptali staging'de denenmedi (test talebi yoktu) |
| AC-172 | ✅ (kısmi) | Var olmayan kimlik için API 404 döndü. Başka tenant'ın kaydı staging'de yoktu; entegrasyon testlerine dayanıldı |
| AC-174 | ✅ | Yardım içeriği, klavyeyle açılma, Esc ile kapanma ve odağın geri dönmesi doğrulandı |
| AC-175 | ✅ (kısmi) | Müşteriler sayfasındaki salt okunur Genel bağlantı doğrulandı. Ayarlar ekranındaki "Genel bağlantı" adı Admin yokluğundan görülemedi |
| AC-176 | ✅ (kısmi) | Talepler ekranındaki Tümü/Genel/müşteri filtresi URL'ye yansıyor. Müşterili gerçek talep (istemci gerekir) ve toast staging'de üretilmedi |
| AC-178 | ✅ | Bilgiler, bağlantı, durum, sekmeler, boş ve hata durumları doğrulandı |
| AC-179 | ✅ (kısmi) | "Müşteri firma" sütunu ve filtresi doğrulandı. CSV için yetki yok |
| AC-180 | ✅ | İsteğe bağlı combobox yalnız aktif müşterileri listeliyor. Seçilen müşteri oluşan kartta görünüyor |
| AC-194 | ✅ | Liste, form (hatalı hâli), detay ve yardımda axe 0 (açık/koyu). Klavye: yardım ve diyalog odakları doğru. 390 px'de taşma 0 |
| AC-181..185, 191, 192 | — | Sunucu kısmı istemci (0.10.0, P8c-2) olmadan uçtan uca sınanamaz. Entegrasyon testlerine dayanıldı |

## Görsel gözlemler (ekran görüntülerinden)
- Liste (1280 açık, `status=all`): başlık, yardım ve Yeni müşteri düğmeleri, Genel bağlantı kartı, arama ve segment filtre düzgün hizalı. Boş durum kartı ortalanmış. Yalnız gövde metni bağlama uymuyor (Bulgu 3).
- Liste (390 koyu): üst menü yatay kayan sekme şeridine dönüşüyor (sağda kesik "Talepler…" kaydırılabilir). Düğmeler alt alta, taşma yok, kontrast okunaklı. Logo koyu temada açık zemin kartı içinde.
- Detay (1280 koyu): uzun indirme URL'si `break-all` ile kendi kutusunda kırılıyor ve taşmıyor. "Bağlantıyı yenile" ve "Pasife al" tehlike tonunda. `<script>` içeren not düz metin. Toast sağ altta sekme şeridiyle hafifçe hizalı, içeriğin üstüne binmiyor.
- Detay (390 açık): breadcrumb iki satıra kırılıyor (kabul edilebilir). Bilgiler tek sütun, dosya adı kırılıyor, taşma yok. Not: "Oturum 1" sayacı Yeni oturum testinden sonra güncellendi.
- Ayarlar (USER): sarı uyarı "Firma ayarlarını değiştirme yetkiniz yok"; boş alan fazla ama yetkisiz durumda beklenen görünüm.
