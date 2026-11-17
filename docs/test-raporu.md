# Test Raporu — P28d (sesli görüşme; web arayüzü)

DURUM: DÜZELTİLMELİ. Bir YÜKSEK bulgu var: 1280 px konsol başlığında ses yuvası "Uzaktan kontrol" ile "Oturumu bitir" düğmelerini üst üste bindiriyor. Bir ORTA bulgu var: 375 px'te ses bildirimleri 5 px yatay taşma yapıyor. 5xx yok, JS hatası (pageerror) yok, axe ihlali yok, test edilen hiçbir AC ❌ değil.

Ortam: yerel üretim derlemesi (standalone) `http://localhost:3217` + sahte API/WS `e2e/mock-api.mjs` / `e2e/mock-ws.mjs` (:4217), dal `p28d` @ `68222ba`, 2026-11-17, Chromium (Playwright 1.65).

- **Betikler:** `docs/test-raporu/e2e/p28d/zz-p28d-op.spec.ts` (akış + ekranlar), `zz-p28d-olcum.spec.ts` (başlık ölçümü) ve `p28d-op.config.ts`. Koşu için `apps/web/` altına geçici kopyalandı, sonra silindi.
- **Ham sonuç:** `tarama.jsonl`, `olcum.jsonl`. Ekran görüntüleri `docs/img/p28d/` altında (11 dosya, 644 KB).
- **Kapsam dışı:** Windows istemcisi, gerçek mikrofon ve Windows tarafındaki AC-377 elle doğrulanacak (runbook §28d.7). Çok teknisyenli ses görünümleri (`canJoin`, `listening`, `noPerm`, `otherPending`, AC-378) birim testi ve staging ile doğrulanacak; sahte WS tek teknisyen bağlıyor.
- **Temizlik:** başlatılan süreçler kapatıldı, 3217/4217 boş. Çalışma ağacında bu turdan yalnız `docs/` altındaki dosyalar var. `apps/agent-win/.../third_party_notices.txt`, `NOTICE`, `docs/implementation.md` ve `docs/pdf/*` değişiklikleri bu tura ait değil.

## Özet

| Ölçüt                                    | Sonuç                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tüm web e2e (`playwright test`), bir kez | **564 geçti, 0 düştü, 242 atlandı** (2,5 dk). `p28d-voice.spec.ts` desktop'ta 6/6 yeşil. AC-376 @perf (desktop-perf) yeşil. Mobil projede P28d testlerinin hepsi `desktopOnly` olduğu için atlandı; mobil kapsamı bu turda 375 px ile tamamlandı.                                                   |
| Keşif turu                               | 6 senaryo (akış ×2 genişlik, onaysız/aygıt ×2, kopma, Permissions-Policy). 60 görünüm: açık/koyu × 1280/375, konsol + misafir.                                                                                                                                                                      |
| Konsol / pageerror                       | Konsol ve misafir sayfasında hata/uyarı **0**, pageerror **0**. Tek 4xx: `/r/ornek-firma` 404 (sahte API'de ref yok; beklenen).                                                                                                                                                                     |
| 5xx                                      | 0                                                                                                                                                                                                                                                                                                   |
| axe (WCAG 2.1 AA, bölge)                 | 60 görünümde **0 ihlal**. Kapsananlar: konsol boşta / bekleniyor / görüşmede / sessizde / tüm bildirimler, kalite paneli, misafir diyaloğu, çubuk (açık + sessizde), onaysız ve aygıt uyarıları.                                                                                                    |
| Taşma                                    | 375'te konsol bildirim durumlarında **5 px** (ORTA-1). 1280'de belge taşması yok, ancak başlık içinde öğeler üst üste biniyor (YÜKSEK-1).                                                                                                                                                           |
| İkonlar                                  | Anlamlı: Sesli görüşme `Phone`, bekleniyor `PhoneOutgoing`, katıl `PhoneIncoming`, mikrofon `Mic`/`MicOff`, bitir `PhoneOff`, dinleme `Headphones`, duyuru `Ear`, kulaklık önerisi `Headphones`.                                                                                                    |
| Permissions-Policy                       | `/r`, `/r/ornek-firma` → `microphone=()`; `/login`, `/sessions`, `/account`, konsol, misafir `/session/…` → `microphone=(self)`. `camera=()` her yerde. Gerçek gezinmede `document.featurePolicy.allowsFeature("microphone")`: konsol, `/sessions` ve misafir **true**, `/r/ornek-firma` **false**. |

## Bulgular

### [YÜKSEK] Y-1 1280 px konsol başlığı: ses yuvası "Uzaktan kontrol"u "Oturumu bitir"in üstüne taşıyor, müşteri adı okunmuyor

Sayfa/akış: teknisyen konsolu `/sessions/<id>/console`, tarayıcı misafiri bağlı, 1280×900 (TEST-P4-4 tek satır hedefi; `xl:flex-nowrap`).

Adımlar:

1. Ses yetkili teknisyen (`u-p28d-*`) oturum açar ve misafiri kabul eder; durum "Aktif" olur.
2. a) Mikrofon izni reddedilmişken "Sesli görüşme"ye basın (`micDenied` bildirimi), veya b) görüşmeyi başlatın (`talking`: "Mikrofon açık" + iki ikon düğme).

Beklenen: başlık tek satır kalır, düğmeler çakışmaz, müşteri adı ve "Müşteri tarayıcı modunda…" ipucu okunur.

Gerçekleşen:

- (a) "Uzaktan kontrol" sarmalayıcısı 71 px'e sıkışıyor. İçindeki 162 px'lik düğme x=1008–1170 aralığına taşıyor ve "Oturumu bitir"in (x=1091–1235) üstüne çiziliyor.
- `elementFromPoint` ile ölçüldü: "Oturumu bitir"in görünen sol yarısına (x≈1130–1154) tıklama `console-control`'e gidiyor. Bitir düğmesi soluk görünüyor.
- Müşteri adı bloğu 33 px'e iniyor ("A…", 8 satır).
- (b) Görüşmede "Müşteri tarayıcı modunda" ipucu "Oturumu bitir"in altında kalıyor, ad "A…" oluyor.
- Ses yuvası olmayan aynı ekranda (`u-plain`) başlık 74 px yüksek, ad bloğu 150 px ve çakışma yok. Bu fark P28d gerilemesi.
- Boşta durumda (yalnız "Sesli görüşme") bile ipucu 4 satıra kırılıyor ve ad "Ayşe …" diye kesiliyor. 1440 px'te çakışma yok.

Kanıt: `docs/img/p28d/konsol-mikrofon-izni-yok-1280-light.png`, `docs/img/p28d/konsol-gorusmede-1280-light.png`, `docs/test-raporu/e2e/p28d/olcum.jsonl` ("1280 micDenied", "1280 plain"). Mevcut e2e yakalamıyor, çünkü yalnız belge taşmasına bakıyor (0).

Atanan: frontend-dev

### [ORTA] O-1 375 px'te konsol ses bildirimleri belgeyi 5 px yatay taşırıyor

Sayfa/akış: konsol, 375×900.

Adımlar:

1. Mikrofon izni reddi, müşteri reddi, bekleme sürerken yenileme ("Çok fazla istek"), zaman aşımı veya müşteri aygıt hatası durumlarından birini oluşturun.
2. Ardından `scrollWidth - clientWidth` değerini ölçün.

Beklenen: 0.

Gerçekleşen: 5 px. `voice-controls` `shrink-0`, düğme (151 px) + `min-w-20 max-w-48` ipucu = 351 px, başlık iç genişliği ~343 px (sağ kenar 380 > 375). Boşta, bekleniyor ve görüşmede durumlarında taşma yok.

Kanıt: `docs/img/p28d/konsol-reddedildi-375-light.png` (ipucu sağ kenara değiyor), `tarama.jsonl` (`konsol-*-375` overflow 5).

Atanan: frontend-dev

### Gözlemler (bulgu değil)

- Misafir zaman aşımında bilgilendirilmiyor: diyalog sessizce kapanıyor. Konsol "Müşteri yanıt vermedi" gösteriyor. Tasarım gereği görünüyor, kayda geçti.
- Onaysız (unconfirmed) durum: Kabul sonrası sunucu yanıtı gelmezse misafir çubuğu ~5 sn "Mikrofon açık" gösteriyor. 5,4 sn'de mikrofon izi `ended` oluyor, çubuk kalkıyor, bilgi uyarısı çıkıyor (D-PD-K1-2'ye uygun). Uyarı konsol zaman aşımından sonra da kalıyor, yeni istekte kalkıyor.
- Çift tıklamayla "Kabul et"te diyalog kapanınca ikinci tık alttaki metni seçiyor (ekranda "Teknisyen" vurgulu). Zararsız, test kaynaklı.

## Akış sonuçları

| Akış                                                      | Sonuç | Not                                                                            |
| --------------------------------------------------------- | ----- | ------------------------------------------------------------------------------ |
| İzin reddi → istek gitmez, yönerge                        | ✅    | `micDenied`; voice.request 0 (e2e)                                             |
| İstek → misafir diyaloğu, odak Reddet, Kabul 1,5 sn kilit | ✅    | e2e kilit ölçümü; keşifte açılışta `disabled=true`, Tab ile Kabul'e geçilmiyor |
| İkinci istekte kilit yeniden                              | ✅    | açılışta `disabled=true`                                                       |
| Çift tıklama "Sesli görüşme"                              | ✅    | tek `voice.request` (1280 ve 375)                                              |
| Çift tıklama "Kabul et"                                   | ✅    | tek `voice.answer`, tek `getUserMedia`                                         |
| Kabul → iki tarafta "Mikrofon açık"                       | ✅    | konsol + misafir çubuğu                                                        |
| Sessize al (konsol + misafir)                             | ✅    | "Sessizde", iz `enabled=false`                                                 |
| Konsol bitirir → iki taraf mikrofon ≤ 1 sn                | ✅    | e2e; keşifte iki tarafta izler `ended`                                         |
| Müşteri bitirir → konsol `customerEnded`                  | ✅    | e2e                                                                            |
| Ret: Reddet / Esc / X düğmesi                             | ✅    | üçü de `rejected` bildirimi; ret mikrofon açmaz                                |
| Zaman aşımı (60 sn, kanca)                                | ✅    | konsol `timeout`, misafir diyaloğu kapanır                                     |
| Bekleme sürerken konsol yenileme                          | ✅    | düğme etkin; basınca sunucu `RATE_LIMITED` → "Çok fazla istek"                 |
| Onaysız (sunucu yanıtı düşer)                             | ✅    | ~5,4 sn'de mikrofon bırakılır, `voice-unconfirmed` uyarısı                     |
| Kabul sonrası mikrofon açılamaz                           | ✅    | misafir `voice-device` uyarısı, konsol `deviceEnded`                           |
| Görüşmede misafir sayfayı yeniler                         | ✅    | yenileme sonrası `getUserMedia` 0, konsol boşta, konsol mikrofonu bırakıldı    |
| Görüşmede konsol sekmesi kapanır                          | ✅    | misafir mikrofonu 8 ms'de `ended`, çubuk kalktı                                |
| Rızasız `voice.state{active}` (K-PD-2)                    | ✅    | e2e: mikrofon açılmaz, `voice.end{customer}`                                   |
| Eski istemci (voice1 yok)                                 | ✅    | e2e AC-379: pasif + AC-352 metni                                               |
| Kalite paneli "Ses kaybı"                                 | ✅    | "Ses kaybı %0" (1280, açık/koyu axe 0)                                         |
| 1280 başlık düzeni ses durumlarında                       | ❌    | Y-1                                                                            |
| 375 bildirim durumlarında taşma                           | ❌    | O-1                                                                            |

## Kabul kriterleri (uçtan uca, web tarafı; sahte API)

| AC                                              | Durum       | Nasıl doğrulandı                                           |
| ----------------------------------------------- | ----------- | ---------------------------------------------------------- |
| AC-373 istek / diyalog / ret / zaman aşımı      | ✅          | e2e + keşif (Esc/X/çift tık/kilit yenileme)                |
| AC-374 aktif / sessize al / bitir ≤ 1 sn        | ✅          | e2e (ölçülü) + keşif                                       |
| AC-375 Opus + DTLS, kayıtta ses izi 0           | ✅          | e2e (SDP, WebM Tracks)                                     |
| AC-376 gecikme p95 < 325 ms, "Ses kaybı" satırı | ✅          | e2e @perf yeşil + kalite paneli                            |
| AC-377 (tarayıcı) mikrofon bırakma              | ✅          | e2e + kopma senaryoları; Windows yarısı elle (kapsam dışı) |
| AC-378 çoklu teknisyen sesi                     | kapsam dışı | birim + sunucu entegrasyon + staging                       |
| AC-379 eski istemci                             | ✅          | e2e                                                        |
| D-PD-1 Permissions-Policy                       | ✅          | başlık + `featurePolicy` (gerçek gezinme)                  |

Not: Y-1 ve O-1 AC davranışını bozmuyor, ancak 1280 tek satır (TEST-P4-4) ve 375 taşmasız standardını ihlal ediyor.

## Görsel gözlemler (ekran görüntülerinden)

- `konsol-mikrofon-izni-yok-1280-light.png`: "Uzaktan kontrol" düğmesi "Oturumu bitir"in üstüne biniyor, bitir düğmesi soluk. Ad "Tarayıcı · yalnız görüntü" dikey kırılıyor. İpucu başlığın sağ kenarına taşıyor (Y-1).
- `konsol-gorusmede-1280-light.png` / koyu: ad "A…", "Müşteri tarayıcı modunda" metni bitir düğmesinin altında (Y-1). "Mikrofon açık" hapı ve ikon düğmeler iki temada okunaklı.
- `konsol-kalite-1280-dark.png`: "Ses kaybı %0" satırı diğer satırlarla hizalı.
- `konsol-reddedildi-375-light.png`: bildirim metni sağ kenara dayanıyor (O-1). İki toast ("Sesli görüşme bitti · 1 sn", "Müşteri sesli görüşmeyi reddetti") alt kenarda üst üste, okunaklı.
- `misafir-diyalog-375-*.png`: diyalog ekrana sığıyor, başlık iki satır. "Kabul et" (birincil) üstte, "Reddet" altta, tam genişlik. Koyu temada kontrast yeterli (axe 0).
- `misafir-cubuk-375-light.png`, `misafir-cubuk-1280-light.png`, `misafir-cubuk-sessizde-375-dark.png`: çubuk sayfanın üstünde, "Konuşan: Mehmet Kaya". Düğmeler 375'te alt alta tam genişlik, 1280'de yan yana. Sessizde hapı nötr renk.
- `misafir-onaysiz-375-light.png`: bilgi uyarısı ekran paylaşımı şeridinin altında, okunaklı.

---

# Test Raporu — P28c K5 (çoklu teknisyen; web arayüzü)

DURUM: GEÇTİ. ENGELLEYİCİ, YÜKSEK ve ORTA bulgu yok, hiçbir AC ❌ değil. Tarama boyunca 5xx yok (yalnız bilerek enjekte edilenler), JS hatası (pageerror) yok, axe ihlali yok, taşma yok. İki DÜŞÜK bulgu ve birkaç gözlem var.

Ortam: yerel üretim derlemesi (standalone) `http://localhost:3217` + sahte API/WS `e2e/mock-api.mjs` (:4217), dal `p28c` @ `5675c1a`, 2026-11-17, Chromium.

- **Geçmiş katılımcıları için vekil:** sahte API'de katılımcı verisi yok. Sunucu tarafı istekler için geçirgen bir vekil kullanıldı (`docs/test-raporu/e2e/p28c-k5/history-proxy.mjs`, :4219). Vekil yalnız `GET /sessions/<RICH>/history` yanıtına 4 katılımcı ekler; ürün kodu değişmedi.
- **Betik:** `docs/test-raporu/e2e/p28c-k5/zz-k5-p28c.spec.ts` + `k5.config.ts`. Koşu için `apps/web/` altına geçici kopyalandı, sonra silindi.
- **Ham sonuç:** `tarama.jsonl`. Seçilmiş ekran görüntüleri `docs/test-raporu/e2e/p28c-k5/img/` altında.
- **Temizlik:** başlatılan süreçler kapatıldı (3217/4217/4219 boş).

## Özet

| Ölçüt                                                  | Sonuç                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tüm web e2e (`pnpm --filter @remote/web e2e`), bir kez | **556 geçti, 0 düştü, 235 atlandı** (2,2 dk). Atlananlar `desktopOnly` / proje ayrımı. Bilinen kararsız testlerin (S-P19-T12, p9-users, p13bl, AC-261, customers-csv-p19) hiçbiri düşmedi; tekrar koşu gerekmedi. TEST-P8-2 geçti. `p28c-multi.spec.ts` desktop + mobile yeşil.                                                                                                                                                              |
| Sayfa taraması                                         | 14 görünüm × açık/koyu × 1280/375 = **56 görünüm, 56 geçti**.                                                                                                                                                                                                                                                                                                                                                                                |
| Durum / klavye keşifleri                               | 5 senaryonun hepsi koştu. Bulgular aşağıda.                                                                                                                                                                                                                                                                                                                                                                                                  |
| HTTP                                                   | 4xx/5xx yalnız enjekte edilenler: `/sessions/active` 500, `invite-candidates` 500/409, davet POST 500, reddet 500. Panel kabuğunda P28c dışı kullanıcı `/sessions/active` 403 → bölüm gizli (beklenen).                                                                                                                                                                                                                                      |
| Konsol                                                 | Hata/uyarı yalnız enjekte edilen yanıtların "Failed to load resource" kaydı. pageerror 0.                                                                                                                                                                                                                                                                                                                                                    |
| axe (WCAG 2.1 AA)                                      | 56 görünümde bölge + sayfa taraması **0 ihlal**. Kapsananlar: koyu temada sahip rozeti `text-primary`/`bg-primary-surface`, "İzinsiz" çipi, `text-warning` pasiflik nedenleri, davet kartı, misafir listesi. Aktif liste yükleniyor/boş ve aday hata/409 durumları da 0.                                                                                                                                                                     |
| Taşma                                                  | Belge düzeyinde 0. Bölge içinde 0: uzun müşteri/teknisyen adı + `<script>` içeren satırlar `truncate` ile kırpılıyor, 375'te kartta sarılıyor.                                                                                                                                                                                                                                                                                               |
| İkonlar (lucide)                                       | Anlamlı ve tutarlı: Teknisyenler `Users`, Davet et `UserPlus`, Kontrolü ver `MousePointer2`, Oturumu devret `ArrowRightLeft`, Geri al `Undo2`, Ayrıl `LogOut`, Geri çek `X`, bağlantı yok `WifiOff`. Davet kartında Katıl `LogIn`, Reddet `UserX`, gözetimsiz `MonitorCog`. Etkin oturumlarda başlık/İzle `Eye`, izinsiz `EyeOff`, boş `MonitorSmartphone`. Aday arama `Search`, misafir Çıkar `UserX`, geçmişte `Users` / `ArrowRightLeft`. |
| XSS                                                    | `<script>alert(1)</script>` içeren müşteri adı, teknisyen adı ve katılımcı adı düz metin olarak çiziliyor; betik çalışmıyor (pageerror/dialog yok).                                                                                                                                                                                                                                                                                          |

## Bulgular

### [DÜŞÜK] D-1 "Reddet" 500 dönünce kart kayboluyor, sonraki yoklamada geri geliyor

Sayfa/akış: panel → davet bildirimi (`p28cinv`).

Adımlar:

1. `POST /sessions/invites/:id/reject` isteğini 500'e zorla.
2. "Reddet: SUNUCU-01" butonuna bas.
3. 5 sn bekle.

Beklenen: hata toast'ı çıkar, kart yerinde kalır (kullanıcı tekrar deneyebilir) ya da tutarlı biçimde düşer.

Gerçekleşen: "Beklenmeyen bir hata oluştu." toast'ı çıkıyor. Kart hemen düşüyor (2 → 1), sonraki yoklamada (5 sn) geri geliyor (→ 2). Kullanıcı reddettiğini sanır, kart "kendiliğinden" geri döner.

Kanıt: `tarama.jsonl` id `S-reddet-500` (`afterReject:1, afterPoll:2`); `img/durum-davet-reddet-500.png`.

Dosya: `apps/web/components/invite-notifier.tsx:88-90`. `finally { …; drop(i.inviteId) }` ifadesi 410 dışındaki hatalarda da kartı düşürüyor. Öneri: `drop` yalnız başarıda veya 410'da çağrılsın.

Atanan: frontend-dev

### [DÜŞÜK] D-2 Aynı kişiden gelen iki davet aynı toast metnini üretiyor

Sayfa/akış: panel, ilk yoklama. `p28cinv` hesabının Ayşe Sahip'ten iki daveti var.

Adımlar: `/sessions` sayfasını aç.

Beklenen: toast'lar ayırt edilebilir olsun (müşteri adı ya da "2 yeni davet").

Gerçekleşen: iki ayrı toast, ikisi de "Ayşe Sahip sizi bir oturuma davet ediyor". Kart listesi doğru, yani bilgi kaybı yok; yalnız gürültü.

Kanıt: `tarama.jsonl` `S-reddet-500.toastTxt`.

Dosya: `apps/web/components/invite-notifier.tsx:43` (`mt.newInvite` yalnız `from` alıyor).

Atanan: frontend-dev

## Akış sonuçları

| Akış                                                                                                                   | Sonuç        | Not                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Davet kartı → Katıl → katılımcı konsolu → panel (2 satır, sahip rozeti, Ayrıl onayı)                                   | ✅           | e2e + tarama, iki tema × iki genişlik                                                                                |
| Davet kartı → Reddet                                                                                                   | ✅           | 500'de D-1                                                                                                           |
| Süresi dolan davet kartı istemcide düşer                                                                               | ✅           | 3 sn'lik davet 4,5 sn sonra yok; boş bildirim alanı çizilmiyor                                                       |
| Etkin oturumlar → İzle (silent) → gerekçe (kısa → hata) → izleyici konsolu, sohbet salt okunur                         | ✅           |                                                                                                                      |
| Etkin oturumlar pasif nedenler: desteklemiyor / izinli gözetimsiz / dolu                                               | ✅           | `aria-describedby` neden metnine bağlı                                                                               |
| Etkin oturumlar yükleniyor → hata → Tekrar dene → liste; boş; yetkisiz (403) → bölüm gizli                             | ✅           | `img/durum-aktif-*.png`                                                                                              |
| Sahip: Davet et → arama → davet → bekleyen satır → koltuk dolu pasif → Geri çek                                        | ✅           |                                                                                                                      |
| Aday diyaloğu yükleniyor / hata + Tekrar dene / boş / 409 pasif uyarı / eşleşme yok                                    | ✅           | `img/durum-aday-*.png`                                                                                               |
| Davet POST 500 → diyalog açık kalır, FormError "Beklenmeyen bir hata oluştu."                                          | ✅           | `img/durum-davet-post-500.png`                                                                                       |
| Oturumu devret onayı (odak Vazgeç'te, Esc → odak tetikleyiciye döner)                                                  | ✅           |                                                                                                                      |
| Misafir "Bağlı teknisyenler": sahipte Çıkar yok, Çıkar onayı → listeden düşer                                          | ✅           | e2e (masaüstü). Tarama: iki tema × 1280/375, axe 0                                                                   |
| Geçmiş ayrıntısı Katılımcılar: rol, saat aralığı, "Müşteri çıkardı", "Ayrıldı", "Devir"                                | ✅           | Vekil fikstürüyle. Tek teknisyenli oturumda bölüm çizilmiyor ✅                                                      |
| Klavye: panel aç/kapa (Enter/Space), Tab ile Davet et'e erişim, diyalog odak tuzağı (8 Tab içeride), Esc + odak dönüşü | ✅           | Davet kartında Tab sırası Reddet → Katıl (kart başına)                                                               |
| Çevrimdışı teknisyen satırı (`WifiOff`)                                                                                | ⚠ kapsanmadı | Sahte WS'te `connected:false` roster fikstürü yok. Kod incelemesinde `text-danger` + ikon var, ekranda doğrulanmadı. |

## Kabul kriterleri (uçtan uca, arayüz)

| AC                                                  | Durum | Nasıl doğrulandı                                                                                     |
| --------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| AC-364 davet / bildirim / bekleyen davet / geri çek | ✅    | p28c-multi e2e + tarama + durum keşfi                                                                |
| AC-365 koltuk sınırı (Davet et pasif + neden)       | ✅    | e2e + `konsol-sahip` taraması                                                                        |
| AC-366 müşteri teknisyen listesi + Çıkar            | ✅    | e2e + `misafir-*` taraması                                                                           |
| AC-367 kontrol ver / geri al / devret onayı         | ✅    | e2e + `devret-onay` taraması (Kontrolü geri al butonu tetiklenmedi)                                  |
| AC-368 etkin oturumlar + İzle                       | ✅    | e2e + `aktif-*` + durumlar                                                                           |
| AC-369 geçmiş katılımcıları                         | ✅    | Vekil fikstürüyle `gecmis-katilimcilar` (4 görünüm). Not: mevcut e2e takımında bu bölümün testi yok. |
| AC-370 audit seçenek grubu                          | ✅    | e2e (tam takımda yeşil)                                                                              |
| AC-372 desteklemeyen istemci / izinli oda pasifliği | ✅    | e2e + `konsol-desteksiz` taraması + aday 409 uyarısı                                                 |
| AC-287 375 px taşma / axe                           | ✅    | 56 görünüm                                                                                           |

## Görsel gözlemler (ekran görüntülerinden)

- `aktif-uzun-ad-1280-dark.png`:
  - Uzun müşteri adı tek satırda "…" ile kırpılıyor.
  - "İzinsiz" çipi, teknisyen/başlangıç/"Teknisyen: 3/3" meta satırı ve sarı "Oturum dolu" nedeni okunaklı.
  - İzle butonu pasif görünümde.
  - Tablo yok (liste/kart), 1280'de taşma yok.
- `davet-uzun-ad-375-dark.png`: uzun ad ve `<script>` metni kart içinde sarılıyor; Reddet/Katıl butonları hedef boyutunda.
  - Gözlem: davet bildirimi breadcrumb ve h1'in **üstünde** çiziliyor (panel kabuğunda). Kasıtlı olabilir ama sayfa başlığını aşağı itiyor; mobilde ilk ekranı büyük ölçüde kaplıyor.
- `konsol-sahip-375-dark.png`:
  - Panel 2/3. Sahip rozeti mavi çip.
  - Kontrolü ver / Oturumu devret 375'te alt alta.
  - Bekleyen davet kesik çizgili satırda; geri çekme ikon butonu (`X`).
  - Pasif Davet et altında sarı neden metni.
  - "Kerem Yardımcı davet edildi" toast'ı panelin hemen altında; hiçbir kontrolü örtmüyor.
- `gecmis-katilimcilar-375-light.png`:
  - Katılımcılar bölümü düzgün sarılıyor.
  - "Müşteri çıkardı", "Ayrıldı", "Devir: 12:25:00" etiketleri ve "Oturum sonuna kadar" metni okunuyor.
  - Ekran görüntüsündeki ortadaki üst menü şeridi fullPage yapıştırma artefaktıdır (yapışkan başlık), ürün hatası değil.
- Diyaloglarda ilk odak:
  - Davet diyaloğunda kapat (X) butonunda; arama kutusunda olsa daha hızlı olurdu.
  - Gerekçe diyaloğunda bir butonda; gerekçe alanında olsa daha hızlı olurdu.
  - Bulgu değil, öneri.

---

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
