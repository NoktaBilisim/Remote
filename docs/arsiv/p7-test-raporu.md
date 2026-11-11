# Test Raporu — P7 (uzaktan kontrol) sayfa testi
DURUM: GEÇTİ (Tur 2, 2026-11-11: TEST-P7-1 ORTA, TEST-P7-2 ve TEST-P7-3 DÜŞÜK ile kopma notu gözlemi kapandı; yeni bulgu yok. Tur 1 ayrıntısı aşağıda, Tur 2 en sonda)

## Tur 1
Tur 1 DURUM: DÜZELTİLMELİ (1 ORTA bulgu; engelleyici/yüksek bulgu yok; JS hatası, 5xx ve axe ihlali yok)
Ortam: yerel yığın — sahte API + sahte WS (`apps/web/e2e/mock-*.mjs`, :4217) + standalone web (:3217, `NEXT_PUBLIC_RS_E2E=1`), sahte Hızlı Destek istemcisi `e2e/fake-agent.ts` (gerçek WebRTC + `input` DC). Dal `main` @ `463efdb` + commit'lenmemiş P7 değişiklikleri. Tarih 2026-11-11. Chromium headless. Süreçler kapatıldı.
Önceki raporlar: `docs/arsiv/p6-test-raporu.md`. Gerçek Windows istemciyle elle test bu ortamda yok; bkz. `docs/gereksinimler.md` "Sonra / açık — P7'den" (Windows elle testi P7, adım 25–42).

Keşif spec'i: `docs/test-raporu/e2e/p7-op.spec.ts` + `p7op.config.ts` (koşarken `apps/web/` altına geçici kopyalandı, sonra silindi). Ekran görüntüleri ve ham ölçüm: `docs/img/p7/` (`p7op.jsonl`).

## Özet
| Ölçüt | Sonuç |
|---|---|
| Tam e2e paketi (`pnpm --filter @remote/web e2e`) | **149 geçti / 41 atlandı / 0 kaldı** (P7 7/7; mobil projede konsol testleri atlanır) |
| Keşif spec'i | 23 test; 19 geçti, 4 kırıldı. Kırılanlardan 3'ü test düzeneği/mock kaynaklı (aşağıda "Koşulamayanlar"), 1'i ürün bulgusu (TEST-P7-1) |
| Taranan sayfa/durum | Konsol: 8 kontrol durumu × 1280/1440 × açık/koyu + 390 px (3 durum). Regresyon: login, panel, oturumlar (dolu/boş/hata), şifre değiştir, misafir (Windows/indir, macOS, süresi doldu, kullanılmış), 404 — her biri 1280/1440/390 × açık/koyu (66 görünüm) |
| Konsol hatası / pageerror | 0 |
| 4xx/5xx (beklenmeyen) | 0 |
| Kırık link | 0 (14 link kontrol edildi) |
| axe (wcag2a/aa/21aa) | 101 tarama, **0 ihlal** (menü açık, ret, güvenli masaüstü, yükseltilmiş pencere dahil) |
| 390 px yatay taşma | 0 px (konsol ve tüm regresyon sayfaları) |
| Yavaş | yok |

## Bulgular
### TEST-P7-1 [ORTA] "%100" görünümünde kontrol tıklaması yanlış koordinata gidiyor
Sayfa/akış: `/sessions/[id]/console`, Hızlı Destek misafir, kontrol izni verilmiş.
Adımlar: 1. Kontrol iste → müşteri izin verir ("Kontrol sizde"). 2. Şeritte "%100" seç (1280×720 görüntü, 1280×800 pencere). 3. Kaydırma kutusunun sol üstünden (50, 50) px içeri tıkla (kaydırma 0,0).
Beklenen: `m.btn` koordinatı ≈ (50/1280, 50/720) = (0,039; 0,069) — AC-49 (±2 px).
Gerçekleşen: `{x: 0.15625, y: 0.27778}` = görüntüde (200, 200) px; iki eksende de ~150 px kayma. "Sığdır" kipinde aynı ölçüm doğru (mevcut e2e ±0,01 içinde). Kök neden belirlenmedi: `use-remote-input` %100 kipinde içerik konumunu (kaydırma/ortalama/`p-4` dolgu) yanlış hesaplıyor olabilir, ya da kutu odakta kendiliğinden kaydırılıyor olabilir.
Kanıt: `docs/img/p7/18-kontrol-yuzde100.png`; `docs/img/p7/p7op.jsonl` → `"label":"actual mode click"`.
Atanan: frontend-dev (%100 kipine kaydırılmış/kaydırılmamış iki durumda koordinat e2e testi eklenmeli).

### TEST-P7-2 [DÜŞÜK] 1280 px'te sahne şeridi üç satıra çıkıyor, uzak ekran küçülüyor
Sayfa/akış: konsol, 1280×800, kontrol sizde.
Adımlar: 1. Kontrol iste → izin ver. 2. Şerit yüksekliğini ölç.
Beklenen: araçlar görüntüyü kapatmadan, makul yükseklikte.
Gerçekleşen: şerit görüntünün üstüne binmiyor (P5 görsel bulgusu kapandı, örtüşme 0 px), ama 580 px genişlikteki sahnede şerit 195–209 px yüksek (işaretleme · kontrol + özel tuşlar + not · monitör + Sığdır/%100/Tam ekran). Görüntü alanı 400 px, video 572×322; `selfElevated` + yükseltilmiş pencere şeritleri açıkken görüntü alanı 92 px daha aşağı iniyor. 1440'ta şerit 185 px.
Kanıt: `docs/img/p7/03-kontrol-sizde-1280-light.png`, `05-yukseltilmis-1280-*.png`.
Atanan: frontend-dev (kontrol sırasında pasif işaretleme grubunu daraltmak, not satırını tooltip/ikinci sıraya almak gibi seçenekler).

### TEST-P7-3 [DÜŞÜK, test altyapısı] Sahte WS sunucusu gerçek sunucudan iki noktada ayrışıyor
- Teknisyen `hello` mesajında `guestKind`/`guestName` yok. Gerçek sunucu bunları gönderiyor (`apps/server/src/signaling/active.ts` `sendHelloTech`). Bu yüzden mock'ta konsol yenilenince AGENT misafiri "Tarayıcı · yalnız görüntü" görünüyor ve "Kontrol iste" kalkıyor. Bu ürün hatası değil, ama "yenileme sonrası kontrol/5 hak" akışı e2e'de doğrulanamıyor.
- Yanıtsız monitör isteği mock'ta hiç düşmüyor. Gerçek sunucu 30 sn sonra `monitorPending`'i temizliyor (`control.ts:215`). Bu yüzden konsol 61. sn'de seçimi yeniden açtığında mock CONFLICT döndürüyor.

Atanan: frontend-dev (`e2e/mock-ws.mjs` sunucuyla hizalanmalı ve iki akış için e2e eklenmeli).

## Akış sonuçları
| Akış | Sonuç | Not |
|---|---|---|
| Kontrol iste → "Kontrol bekleniyor" (pasif) + Vazgeç → izin → "Kontrol sizde" + Kontrolü bırak + Özel tuşlar | ✅ | 4 görünümde (1280/1440 × açık/koyu) |
| Onaydan önce girdi gitmez | ✅ | mevcut e2e |
| Kırmızı çerçeve | ✅ | `stage-view` kenarlığı kontrolde `rgb(217,45,32) 4px`, kapalıyken şeffaf 4 px (kayma yok) |
| İşaretleme araç çubuğu sahne şeridinde, görüntünün üstünde değil | ✅ | şeridin altı = görüntü alanının üstü (örtüşme 0); kontrolde kalem pasif |
| Ret → "Kontrol reddedildi", "Tekrar iste (0:2x)" geri sayımı → 30 sn sonra etkin, yeni istek gider | ✅ | 35 sn beklendi |
| 5 hak: Vazgeç ×5 → düğme pasif, "Bu oturumda kontrol isteği hakkı doldu (5/5)" | ✅ | ekran `13-hak-doldu-1280.png` |
| Çift tıklama "Kontrol iste" → tek `control.request` | ✅ | ws-log |
| Monitör: Ekran 2 isteği → bekleme metni, diğer seçenek pasif → 30 sn yanıtsız "onaylamadı · yeni istek 0:3x sonra" → süre bitince etkin | ✅ | sonraki isteğin iletimi mock nedeniyle ölçülemedi (TEST-P7-3) |
| Monitör reddi → "reddetti · yeni istek 0:3x sonra" | ✅ | |
| `selfElevated` rozeti, yükseltilmiş pencere şeridi | ✅ | ikisi birlikte görünür, axe 0 |
| Güvenli masaüstü paneli; bu sırada yakalama kapanır, tık/tuş gitmez; panel kalkınca kontrol geri açılır | ✅ | |
| Özel tuşlar menüsü: fareyle Alt+Tab; klavyeyle açma; Esc kapatır; Ctrl+Alt+Del yok | ✅ / kısmi | menü 1280/1440/390'da ekranda kalıyor. Klavye bölümü Playwright'ın "ı" tuşunu tanımaması yüzünden kırıldı (Türkçe karakter birim testte doğrulanmış) |
| Ctrl+Alt+Shift → odak "Kontrolü bırak" | ✅ | mevcut e2e |
| Kontrol açıkken müşteri kopar | ✅ | yakalama kapanır (`data-control=off`), "Bağlantı koptu" katmanı görünür; şerit gizlendiği için "Müşteri bağlantısı koptu; kontrol kapandı" notu bu sırada görünmüyor (gözlem) |
| Kontrol açıkken "Oturumu bitir" → bitti ekranı; geri tuşu kontrolü göstermez | ✅ | |
| Teknisyen ağ kesintisi (`setOffline`) | — | Chromium açık WS'i kapatmadı, sonuç alınamadı. Kopma yolu birim testte |
| P4/P5/P6 regresyonu: giriş, oturumlar, misafir, /indir (Windows UA), süresi dolmuş/kullanılmış link, 404 | ✅ | tam e2e + tarama; konsol hatası, 5xx ve taşma yok |

## Kabul kriterleri (uçtan uca, konsol tarafı)
| AC | Sonuç | Nasıl doğrulandı |
|---|---|---|
| AC-43 (monitör, müşteri onayı) | ✅ | e2e + keşif (bekleme, ret, yanıtsızlık, geri sayım) |
| AC-47 | ✅ | "Kontrol bekleniyor" birebir, onaysız girdi 0 |
| AC-48 (konsol tarafı) | ✅ | özel tuşlar listesi, Ctrl+Alt+Del yok. Uzakta uygulanması Windows elle testinde |
| AC-49 | ❌ (%100 kipi) | Sığdır ✅; %100'de ~150 px kayma (TEST-P7-1). DPI ±2 px Windows testinde |
| AC-50 | ✅ | < 1 sn (e2e) |
| AC-51 | ✅ | yetkisiz kullanıcıda düğme yok (e2e) |
| AC-99 / AC-116 (konsol tarafı) | ✅ | ret metni, 30 sn bekleme, hak sayacı |
| AC-105 | ✅ | yükseltilmiş pencere şeridi + güvenli masaüstü paneli |
| AC-115 | ✅ | canlı revoke ≤ 1 sn (e2e) |
| AC-100/101/102/103/104 | — | istemci tarafı; Windows elle testi (gereksinimler "Sonra / açık — P7'den") |

## Görsel gözlemler (ekran görüntülerinden)
- `03-kontrol-sizde-1280-light.png`: kırmızı çerçeve ve "Kontrol sizde" hapı belirgin. "Müşteri kontrol izni verdi" toast'ı sağ altta sohbet giriş alanının üstüne biniyor (geçici, kapatılabilir). Şerit 3 satır (TEST-P7-2).
- Konsol ve panel, açık tema emülasyonunda da koyu görünüyor. Sahne için bu DESIGN §2 `stage` kararıyla uyumlu, panel kabuğu için P5'teki gözlem aynen geçerli (kullanıcı tema tercihi P12).
- 390 px'te (`10..12-mobil-*.png`) taşma yok. Özel tuşlar menüsü x=24..280 aralığında ekranda kalıyor. Şerit mobilde uzun ama düzgün kırılıyor.
- Yükseltilmiş ve `selfElevated` şeritleri sarı `warning-surface` üzerinde okunaklı. Güvenli masaüstü paneli görüntü ortasında, `bg-stage/90`.

## Koşulamayanlar
- Yenileme sonrası hak sayacının korunması ve yanıtsızlıktan sonraki monitör isteğinin iletimi: mock kaynaklı (TEST-P7-3).
- Türkçe karakterli tuş vuruşu: Playwright `keyboard.press("ı")` desteklemiyor. `lib/control/input.test.ts` kapsamında doğrulanıyor.
- Tam ekran Keyboard Lock (headless), gerçek Windows istemcisi (bkz. gereksinimler "Sonra / açık — P7'den").

## Tur 2 (2026-11-11, dar kapsam)
DURUM: GEÇTİ
Kapsam: TEST-P7-1..3, kopma notu gözlemi ve bunlardan etkilenen konsol düzeni (`docs/implementation.md` "Frontend P7 — sayfa testi düzeltmeleri").
Ortam: Tur 1 ile aynı. Sahte API/WS :4217 + standalone web :3217; derleme, tam e2e koşusunun ürettiği güncel derleme.
Spec: `docs/test-raporu/e2e/p7-op2.spec.ts` + `p7op2.config.ts`. Koşarken `apps/web/` altına geçici kopyalandı, sonra silindi.
Ekranlar `docs/img/p7/t2-*.png`, ham ölçüm `docs/img/p7/p7op2.jsonl`. Süreçler kapatıldı.

### Özet
| Ölçüt | Sonuç |
|---|---|
| Tam e2e (`pnpm --filter @remote/web e2e`) | **153 geçti / 45 atlandı / 0 kaldı** |
| Keşif spec'i | 7/7 geçti. TEST-P7-1 testi ilk koşuda kendi hatam yüzünden kırıldı: 330 px dikey kaydırma istendi, en fazla 328 px mümkün. Değer 300'e düzeltilip yeniden koşuldu ve geçti |
| Konsol hatası / pageerror / 4xx-5xx | 0 / 0 / 0 |
| axe | 35 tarama, 0 ihlal (1280/1440/390 × açık/koyu; menüler açık, yükseltilmiş pencere, kopma) |
| Yatay taşma | 0 px (390 px dahil; Görünüm ve Özel tuşlar menüsü açıkken) |

### Doğrulama
| Madde | Sonuç | Ölçüm / kanıt |
|---|---|---|
| TEST-P7-1 %100 tıklama | ✅ kapandı | Tüm sapmalar < 0,005 px (eşik ±1 px). Ölçülen noktalar: Sığdır (123,456); %100 kaydırmasız (50,50); kaydırılmış 300/200 → (350,250); 3 sn sonra 600/300 → (800,340); sağ alt köşe (1270,710). Video CSS boyutu 1280×720, alınan akış 320×180 — düzeltmenin hedeflediği durum tam olarak bu. `t2-01-yuzde100-kaydirilmis-1280.png` |
| TEST-P7-2 şerit | ✅ kapandı | Kontrol modunda şerit 1280 ve 1440'ta **61 px, tek satır**. Tur 1'de bu değer 1280'de 209, 1440'ta 185 px'ti. Görüntü alanı 1280'de 419 px, 1440'ta 479 px. Örtüşme 0. Sahne < 960 px olduğu için "Görünüm" menüsü etkin. `t2-04-kontrol-*.png`, `t2-06-gorunum-menu-*.png` |
| Kopma notu | ✅ kapandı | "Bağlantı koptu" katmanında "Müşteri bağlantısı koptu; kontrol kapandı" yazıyor (`stage-control-ended`). `data-control=off`. 1280/1440/390, açık/koyu. `t2-08-kopma-notu-*.png`, `t2-13-mobil-kopma-*.png` |
| TEST-P7-3 yenileme | ✅ kapandı | Yenilemeden sonra "Hızlı Destek (Windows)" ve "Kontrol iste" görünüyor, not "3 istek hakkı kaldı". 3 istek daha atılınca "hakkı doldu (5/5)" çıkıyor; ikinci yenilemeden sonra da pasif kalıyor. `t2-14-yenileme-hak-doldu.png` |
| TEST-P7-3 yanıtsız monitör | ✅ | Tam e2e'deki yeni "TEST-P7-3: yanıtsız monitör" testi geçti. Bu turda keşifle ayrıca koşulmadı |
| 390 px | ✅ | Kontrol modunda şerit 113 px (iki satır). Özel tuşlar menüsü x=29..275, Görünüm menüsü x=110..366 — ikisi de ekran içinde. `t2-10..12-mobil-*.png` |

### Görsel gözlemler (bulgu değil)
- `t2-04-kontrol-1280-light.png`: şerit "Kontrol sizde · Kontrolü bırak · Özel tuşlar · Görünüm" olarak tek satır, kırmızı çerçeve tam. Görüntü Tur 1'e göre belirgin büyük.
- "Kontrol bekleniyor" durumunda şerit 1280'de 175 px. Bu durum kısa süreli ve görüntüyü örtmüyor, kapsam dışı bırakıldı.
- `t2-08-kopma-notu-1280-dark.png`: eski "Müşteri kontrol izni verdi" toast'ı, kopma toast'ının üstünde hâlâ duruyor. 390 px'te toast görüntünün alt kısmına biniyor. İkisi de geçici ve kapatılabilir; DÜŞÜK gözlem olarak frontend-dev'e bilgi.
- Açık tema emülasyonunda panel kabuğu yine koyu görünüyor (Tur 1 ve P5 gözlemiyle aynı; tema tercihi P12).
