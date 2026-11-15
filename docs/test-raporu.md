# Test Raporu

Önceki paketlerin sayfa testi raporları `docs/arsiv/*-test-raporu.md` ve `docs/test-raporu/` altındadır.

## P27a + P27 — sayfa testi tur 2

DURUM: GEÇTİ (tur 1 bulgularının tamamı kapandı; yeni bulgu yok)
Ortam: üretim derlemesi (standalone, bu tur yeniden derlendi) `http://localhost:3217` + sahte API `apps/web/e2e/mock-api.mjs` :4217.
Dal `p27-wip`, HEAD `9f12760`, tarih 2026-11-15. Gerçek sunucu ve staging kullanılmadı.
Betikler: `docs/test-raporu/e2e/p27-k12/tur2-dogrulama.spec.ts` (hedefli doğrulama), `tur2-tarama.spec.ts` (tur 1 taramasının
kopyası, ayrı çıktı); ham sonuçlar `dogrulama-tur2.jsonl`, `sonuc-tur2.jsonl`. Seçilmiş ekranlar `docs/img/p27-k12-tur2/`.
Not: betikler `apps/web` altından koşulmalı (`@playwright/test` çözümü); geçici kopya koşu sonrası silindi.

### Özet

| Ölçüt                | Sonuç                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Taranan görünüm      | 116 (29 ekran/durum × açık/koyu × 1440 / 390 px) + 8 konsol (gözetimsiz/katılımlı × 2 × 2) |
| Konsol / JS hatası   | 0 (yalnız `account-td-hata` senaryosunun bilerek döndürülen 500'ü, tur 1'le aynı)          |
| 4xx/5xx              | yalnız beklenen: 3 × `/unattended/<yok/bozuk/yetkisiz>` 404 (artık doğru), `tdbad` 500     |
| axe (wcag2a/aa/21aa) | 0 ihlal, 116/116                                                                           |
| 390 px yatay taşma   | 0                                                                                          |
| Doğrulama spec'i     | 18/18 geçti (desktop + mobile)                                                             |

### Tur 1 bulgularının doğrulaması

| Tur 1 bulgusu                                   | Sonuç | Kanıt                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ORTA] Gözetimsiz konsolda "Müşteri bekleniyor" | ✅    | Gözetimsiz: sahne `stage-unattended-wait` "Cihaz bağlanıyor… Cihazdaki servis oturuma katıldığında…", durum "Cihaz bağlanıyor…", "Müşteri bekleniyor"/doğrulama kodu metni yok, `console-verify-code` 0, `console-left` 0. Katılımlı (gerileme): "Bekliyor", "Müşteri bekleniyor" + doğrulama/oturum kodu, "Kod geçerliliği 15:00" aynen duruyor. 4 kombinasyon × 2 tür, taşma 0. `konsol-gozetimsiz-desktop-dark.png`, `konsol-katilimli-mobile-light.png` |
| [DÜŞÜK] Arama 64 sınırı                         | ✅    | `maxlength=64`; 300 karakter yapıştırma ve 70 tuş → 64; ipucu "2–64 karakter; Enter ile hemen ara."; 64 karakter Enter → URL'de `q`, "Filtreye uyan cihaz yok" boş durumu; `?q=<70>` → kutu boş, 4 cihaz (filtre yok sayıldı, kullanıcı yanılmaz); `?q=<64>` → kutu 64, 0 sonuç; `depo` → 1 sonuç                                                                                                                                                           |
| [DÜŞÜK] `/unattended/<yok>` HTTP 200            | ✅    | Olmayan ULID, `abc`, teknisyene yetkisiz D3 → **404**, tek h1 "Cihaz bulunamadı", açıklama + "Gözetimsiz cihazlara dön"; veri sızmıyor. Var olan D1 → 200; `/unattended`, `/unattended/codes` → 200 (URL değişmedi). `un-detail-yok-404-desktop-dark.png`                                                                                                                                                                                                   |
| [DÜŞÜK] Filtre satırı hizası                    | ✅    | 1440: arama, Müşteri, durum düğmesi üçü de `y=376`, yükseklik 44 (ipucu altta, hizayı bozmuyor). 390: arama ve Müşteri genişliği 358 = 358, durum grubu gerilmiyor. `filtre-desktop.png`, `filtre-mobile.png`                                                                                                                                                                                                                                               |
| [DÜŞÜK] "Hatırlanan cihazları kaldır" 3 satır   | ✅    | Masaüstü ve mobilde düğme yüksekliği 44 (= "2FA'yı sıfırla"), metin taşmıyor (`scrollWidth = clientWidth`), ekran görüntüsünde tek satır, ikon hizalı. `user-edit-td-desktop-light.png`                                                                                                                                                                                                                                                                     |
| [DÜŞÜK] Modül ikonu tutarsız                    | ✅    | Yetki tablosu/kartı ve yan menü aynı ikon: unattended `monitor-cog`, sessions `monitor-smartphone`, customers `building-complex`, session_history `rotate-ccw-clock`, settings `settings`, audit `scroll-text`, users `users` (DOM sınıflarıyla karşılaştırıldı; masaüstü + mobil)                                                                                                                                                                          |
| [DÜŞÜK, test verisi] Çelişkili "Pasif" uyarısı  | ✅    | Acme ve Beta (ACTIVE): "Aktif" rozeti + indirme bağlantısı + dosya adı, "Pasif — bağlantı geçersiz" yok. `customer-beta-mobile-light.png`                                                                                                                                                                                                                                                                                                                   |

### Bulgular

Yok. (Bilgi: 404 sayfasının `<title>`'ı "Cihaz ayrıntısı" kalıyor — implementation.md'de bilinçli sapma olarak yazılmış, h1
doğru; bulgu sayılmadı.)

### Görsel gözlemler

- Gözetimsiz bekleme katmanı `MonitorCog` ikonu + iki satır açıklama; sahne tasarım gereği iki temada koyu (DESIGN.md "Konsol koyu teması").
  Mobilde durum rozeti ile "Oturumu iptal et" aynı satırda, sıkışma yok.
- Liste mobil koyu: filtreler tam genişlik, kartlar ve rozetler okunaklı; TEST bandı ve pasif "Bağlan" nedenleri yerinde.
- 404 sayfası panel düzeni içinde, kesik çizgili boş durum kartı, breadcrumb "Cihaz bulunamadı".
- Kullanıcı düzenleme: "2FA'yı sıfırla" ve "Hatırlanan cihazları kaldır" kendi satırlarında, sol sütun dengeli.

### Test edilmeyenler

- Gerçek sunucu akışı (`real-flow.mts`) bu turda koşulmadı: değişiklikler yalnız `apps/web` + sahte veri; tur 1'de 27/27 PASS.
- Mevcut e2e takımı yeniden koşulmadı (frontend-dev 182 geçti raporladı); Windows elle testi hâlâ bekliyor (tur 1 listesi).

## P27a + P27 — sayfa testi

DURUM: GEÇTİ (web + sunucu kapsamı; Windows elle testi kullanıcıda bekliyor, aşağıda)
Ortam: üretim derlemesi (standalone) `http://localhost:3217` + sahte API `apps/web/e2e/mock-api.mjs` (mock-p27/mock-p27a);
gerçek sunucu `apps/server` :3352 + geçici MySQL 8.4.13 `rs-p27-k12-db` (test-db.sh; `--max-connections=300
--log-bin-trust-function-creators=1`; test sonunda silindi). Dal `p27-wip`, test başında HEAD `c05f8b9` + çalışma ağacı;
test sırasında `81568e5` commit'lendi (web derlemesi testin başında alınan ağaçtan). Tarih 2026-11-15. Staging'e bağlanılmadı.
Test betikleri: `docs/test-raporu/e2e/p27-k12/` (`tarama.spec.ts`, `akis.spec.ts`, `real-flow.mts`, `k12.config.ts`).
Ekran görüntüleri: seçilmiş 14 adet `docs/img/p27-k12/`; tamamı (122) scratch'te.

### Özet

| Ölçüt                                                                              | Sonuç                                                                                     |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Taranan ekran × durum                                                              | 29 (14 sayfa; 5 durumlu senaryolar) × açık/koyu × masaüstü 1440 / mobil 390 = 116 görünüm |
| Konsol hatası / JS hatası                                                          | 0 (yalnız beklenen: hata-durumu senaryosunda bilerek döndürülen 500'ün ağ kaydı)          |
| 4xx/5xx                                                                            | yalnız senaryoya ait beklenen yanıtlar (tdbad 500, step-up 401)                           |
| axe (wcag2a/aa/21aa)                                                               | 0 ihlal, 116/116                                                                          |
| 390 px yatay taşma                                                                 | 0                                                                                         |
| Mevcut e2e (`unattended.spec.ts`, `p27a-trusted-device.spec.ts`, desktop + mobile) | 31 geçti, 3 atlandı (masaüstüne özel testler mobilde)                                     |
| Gerçek sunucu akışı (`real-flow.mts`)                                              | 27/27 PASS                                                                                |
| Yavaş sayfa                                                                        | yok (her görünüm < 1,5 sn, sahte API)                                                     |

### Bulgular (öncelik sırasıyla)

#### [ORTA] Gözetimsiz oturumda konsol sahnesi "Müşteri bekleniyor / linki açıp… telefonda doğrulama kodunu söyleyin" yazıyor

Sayfa/akış: `/sessions/<id>/console`, gözetimsiz oda (`hello.unattended` dolu), ACTIVE öncesi.
Adımlar: 1. Teknisyen olarak konsolu aç. 2. `/ws/tech` hello'suna `unattended:{deviceId, deviceName}` gelsin (testte
`page.routeWebSocket` ile eklendi). 3. Sahneye bak.
Beklenen (mimari-p27 §4.6): ACTIVE öncesi "Cihaz bağlanıyor…"; müşteri etkileşimi gerektiren metin yok.
Gerçekleşen: üst barda rozet "Gözetimsiz" ve durum "Cihaz bağlanıyor…" doğru. Ama sahne katmanı (`components/console/stage-overlay.tsx`
`waitingMsg`) `state.unattended`'a bakmıyor: "Müşteri bekleniyor — Müşteri linki açıp katılım isteği gönderdiğinde burada
görünür. Telefonda doğrulama kodunu söyleyin." + doğrulama kodu yazıyor. Gözetimsiz bağlantıda müşteri yok, metin teknisyeni
yanıltıyor. Üst bardaki "Kod geçerliliği / Doğrulama kodu" alanları da gözetimsiz oturumda anlamsız.
Kanıt: `docs/img/p27-k12/console-unattended-desktop-dark.png`
Atanan: frontend-dev

#### [DÜŞÜK] 64 karakterden uzun aramada filtre sessizce düşüyor, tüm cihazlar listeleniyor

Sayfa: `/unattended`. Adımlar: 1. "Cihaz ara"ya 70+ karakter yaz, Enter (ya da `/unattended?q=<70×x>`).
Beklenen: "Arama en çok 64 karakter olabilir" uyarısı ya da girişin 64 ile sınırlanması. Gerçekleşen: kutu 100 karaktere
kadar alıyor (sözleşme 64), liste filtresiz 4 cihazı gösteriyor; kullanıcı aradığı sonucu görüyormuş gibi sanabilir.
Kanıt: `akis.spec.ts` "arama-girdi" (300×x → değer 100 karakter, 4 satır); SSR yanıtında 4 kart. Atanan: frontend-dev

#### [DÜŞÜK] Cihaz ayrıntısı "bulunamadı" sayfası HTTP 200 dönüyor

Sayfa: `/unattended/<olmayan id>`, `/unattended/abc`, teknisyende yetkisiz cihaz `/unattended/<D3>`.
Beklenen: 404 durum kodu. Gerçekleşen: içerik doğru ("Sayfa bulunamadı", veri sızmıyor) ama durum 200, başlık
"Cihaz ayrıntısı". Neden büyük olasılıkla `[id]/loading.tsx` akışı (Next notFound akış başladıktan sonra). Güvenlik
etkisi yok (API 404). Atanan: frontend-dev

#### [DÜŞÜK] Görsel: filtre satırı hizasız; "Hatırlanan cihazları kaldır" düğmesi sıkışık; modül ikonu tutarsız

1. `/unattended` masaüstü: "Cihaz ara" ile "Müşteri" alanları ve durum düğmesi farklı yükseklikte (arama altındaki yardım
   metni hizayı bozuyor); mobilde Müşteri kutusu arama kutusundan dar. Kanıt: `un-list-admin-desktop-light.png`.
2. `/users/<id>` (masaüstü): "Hatırlanan cihazları kaldır" düğmesi dar sütunda 3 satıra kırılıyor, ikon küçük/kayık.
   Kanıt: `user-edit-td-desktop-light.png`.
3. Yetki tablosunda "Gözetimsiz erişim" satırı kalkan ikonu, yan menüde aynı modül `MonitorCog` (Projeler/CLAUDE.md §1.8:
   aynı anlam için aynı ikon). Kanıt: aynı ekran + `un-list-admin-desktop-light.png`.
   Atanan: frontend-dev

#### [DÜŞÜK, test verisi] Sahte API müşteri kaydı çelişkili

`mock-p27.mjs` `customer()` ACTIVE müşteriye `downloadUrl: null` veriyor; müşteri ayrıntısında "Aktif" rozeti yanında
"Pasif — bağlantı geçersiz" uyarısı çıkıyor (`customer-beta-mobile-light.png`). Ürün hatası değil (sayfa ACTIVE +
downloadUrl ister); sahte veri gerçek sözleşmeye uydurulmalı. Atanan: frontend-dev

### Akış sonuçları

| Akış                                                                       | Sonuç | Not                                                                                                                                                                         |
| -------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hatırla → çıkış → tekrar giriş TOTP'siz (gerçek sunucu)                    | ✅    | verify `deviceRemembered:true`; çerez HttpOnly/Secure/SameSite=Strict/Path=/api/v1/auth/Max-Age=2592000; çıkışta çerez kalır; girişte `mfaRequired:false`, çerez döndürülür |
| Step-up atlanmaz (AC-327, gerçek)                                          | ✅    | hatırlanan oturumda `POST /unattended/registration-codes` → 401 `MFA_STEP_UP_REQUIRED`; step-up sonrası istek ilerliyor                                                     |
| Eski (döndürülmüş) çerezle giriş → yeniden kullanım (AC-335b, gerçek)      | ✅    | TOTP sorulur, açık oturum kapanır (401)                                                                                                                                     |
| Cihaz kaldır → TOTP geri gelir (gerçek)                                    | ✅    | `DELETE` bu cihaz → `currentCleared:true`, çerez silinir; sonraki giriş `mfaRequired:true`; bilinmeyen id 404                                                               |
| Kurtarma kodu + `rememberDevice`                                           | ✅    | 400 VALIDATION                                                                                                                                                              |
| 2FA sayfası kutusu (UI)                                                    | ✅    | varsayılan işaretsiz, kurtarma modunda gizli, Super Admin'de yok; klavyeyle işaretlenebilir                                                                                 |
| Kayıt kodu üret → tek gösterim (UI)                                        | ✅    | step-up sonrası kod + indirme + UAC satırı; kapat → tekrar görünmez; yenilemede yok. Çift tıklamada tek oluşturma (2 POST = 401 + step-up sonrası tekrar)                   |
| Bağlan (step-up) → konsola yönlenme (UI)                                   | ✅    | yanlış kodda "Kod hatalı ya da süresi geçti", connect gitmez; doğru kodla `/sessions/<id>/console`; geri tuşu `/unattended`                                                 |
| SMTP yok → Bağlan ve Kayıt kodu pasif + neden                              | ✅    | sahte API `unsmtp`; gerçek sunucu `status.notifyChannel:false`                                                                                                              |
| Mod off → kırmızı bant, düğmeler pasif                                     | ✅    | sahte API; gerçek sunucuda `status {mode:"off", available:false}`                                                                                                           |
| Yetkisiz kullanıcı                                                         | ✅    | `unnone`: menü öğesi yok, sayfada uyarı; teknisyen (`untech`): sekme/oluştur düğmesi yok, `/unattended/codes` uyarı, yetkisiz cihaz URL'si "bulunamadı"                     |
| Çıkış sonrası korumalı URL                                                 | ✅    | 5 URL → `/login?next=…`                                                                                                                                                     |
| Filtre + yenileme / geri                                                   | ✅    | `?q=depo&state=offline` URL'de kalır, yenilemede korunur                                                                                                                    |
| Arama `<script>`, `' OR 1=1 --`                                            | ✅    | sonuç yok, diyalog/çalışma yok                                                                                                                                              |
| Bildirim adresi geçersiz / 254+ karakter / 5 adres sınırı                  | ✅    | alan hataları, 5'ten sonra "Adres ekle" pasif, taşma yok                                                                                                                    |
| Kod oluşturma 500                                                          | ✅    | diyalogda "Beklenmeyen hata. Hata kodu: …"                                                                                                                                  |
| Liste yoklama hatası (kısmi durum)                                         | ✅    | son veri + "güncellenemedi" bandı (mevcut e2e)                                                                                                                              |
| Hatırlanan cihazlar: boş / hata + Tekrar dene / kısmi (satır kaldırma 500) | ✅    | mevcut e2e + tarama                                                                                                                                                         |

### Kabul kriterleri (uçtan uca, web/sunucu)

| AC                                                  | Durum      | Nasıl doğrulandı                                                                          |
| --------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| AC-325                                              | ✅         | UI (sahte) + gerçek sunucu verify + çerez öznitelikleri                                   |
| AC-326                                              | ✅         | gerçek: TOTP'siz giriş, çerez döndürme                                                    |
| AC-327                                              | ✅         | gerçek: hatırlanan oturumda step-up 401                                                   |
| AC-328                                              | ✅ (kısmi) | gerçek: kaldırma + reuse; diğer olaylar entegrasyon testinde (bu turda koşulmadı)         |
| AC-329                                              | ✅         | UI 5 durum, iki tema, mobil; gerçek: liste/kaldır/404                                     |
| AC-330                                              | ✅         | UI (sahte): sayı + onaylı kaldır                                                          |
| AC-331                                              | ✅         | UI (sahte): anahtar + onay                                                                |
| AC-335b                                             | ✅         | gerçek: eski çerezle reuse                                                                |
| AC-273 (web)                                        | ✅         | kayıt kodu tek gösterim, Bağlan → konsol                                                  |
| AC-275                                              | ✅         | liste: durum, son bağlantı, yerel anahtar, yetkili sayısı; iptal ad yazarak               |
| AC-285 / AC-287                                     | ✅         | yetki anahtarları toggle ekranında; 5 durum, iki tema axe 0, 390 px taşma yok, menü ikonu |
| AC-293 (web)                                        | ✅         | teknisyen yalnız yetkili cihazı görür, diğeri "bulunamadı"                                |
| AC-296 / AC-337 (web)                               | ✅         | adres boş uyarısı, ekle, step-up ile kaydet                                               |
| AC-297 (web)                                        | ✅         | mod off bandı, TEST bandı                                                                 |
| AC-336 (web)                                        | ✅         | düğmeler pasif + neden                                                                    |
| AC-274, 294, 295, 338 (cihaz tarafı), 340, 341, 342 | bekliyor   | yalnız Windows'ta; aşağıdaki liste                                                        |

### Test edilmeyenler

- Web arayüzü gerçek sunucuya karşı koşulmadı (API_INTERNAL_URL derlemeye gömülü; ikinci derleme paylaşılan `.next`'i
  bozacaktı). Gerçek sunucu akışı API düzeyinde, arayüz sahte API'yle doğrulandı.
- Gerçek cihazla `/ws/device`, connect → ACTIVE, iptalde ≤ 10 sn kesilme, e-posta bildirimi (SMTP yok).
- AC-328'in diğer geçersiz kılma olayları ve AC-332/333/334/335a: entegrasyon testlerine bırakıldı.
- Konsol rozeti gerçek sunucu hello'suyla değil, WS yanıtına eklenen alanla doğrulandı.

### Görsel gözlemler

- Liste (masaüstü tablo / mobil kart) iki temada okunaklı; rozetler (Çevrimdışı, Son bildirim gönderilemedi, Yeni —
  doğrulanmadı, Anahtar başka yerden…, Yerel olarak kapalı) renk + ikon + metinle ayrışıyor; pasif "Bağlan" altında neden yazıyor.
- Ayrıntı: kayıt IP'si uyarı bandı, yetki anahtarları, son oturumlar boş durumu, "Cihazı iptal et" sayfanın altında ayrık.
- 2FA sayfası koyu temada logo açık kartta; kutu + yardım metni net.
- Hesabım → Hatırlanan cihazlar: "Bu cihaz" rozeti, IP mono yazı; mobilde satırlar düzgün kırılıyor.
- Güvenlik ayarları: "2FA cihaz hatırlama · Açık" açıklamasıyla; "İki adımlı doğrulama" kart başlığında ikon yok
  (yanındaki "Veri saklama"da var) — küçük tutarsızlık.

### Windows elle test listesi (kullanıcı Windows testi bekliyor)

Bu ortamda Windows yok; adımların tamamı `docs/implementation.md` ilgili bölümlerinde. Staging ikilisiyle gerçek
Windows 10/11'de koşulup sonuç buraya yazılır.

| Kapsam                                    | Adımlar (implementation.md)                                                                                                                                                                                                                                                                                                  | Sonuç |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| P27 K5 — servis                           | 1 klasör squatting (AC-340), 2 yeniden adlandırma yarışı, 3 açılış ACL doğrulaması (olay 1004), 4 `device.key` DPAPI, 5 yardımcı jeton dökümü (AC-341), 6 ImagePath tırnaklı, 7 yerel kapatma ≤ 2 sn (AC-295), 8 boru adı gaspı (AC-338), 9 yeniden başlatmada ≤ 2 dk çevrimiçi (AC-274), 10 iz bırakmadan kaldırma (AC-274) |       |
| P27 K6 — yardımcı + gösterge              | 1 her monitörde gösterge (AC-294), 2 onaysız kontrol + konsol kaynağı "Gözetimsiz", 3 dosya `Gelen` + MOTW, 4 `Gelen` yeniden adlandırma/reparse, 5 monitör ekle/çıkar → yeniden çizim / `indicator_failed`, 6 `--helper` ebeveyn denetimi (çıkış 21), 7 gösterge gizlenince ≤ 2 sn yeniden çizim, 8 yerel "Kapat" ≤ 2 sn    |       |
| P27 K6b — Secure Desktop                  | 1 kilit ekranı, 2 UAC onayı, 3 oturum açılmamış giriş ekranı, 4 oturum kapatma, 5 hızlı kullanıcı değiştirme, 6 parolalı ekran koruyucu, 7 doğrulanamayan gösterge → ≤ 2 sn kesilme (AC-342), 8 ayrıcalık ölçümü, 9 P20 katılımlı gerileme                                                                                   |       |
| P27 K7 — ayar penceresi / tepsi / kurulum | 1 kur (AC-273/274), 2 tepsiden yerel kapatma (AC-295), 3 boru kimliği (AC-338), 4 bağlantı ipucu, 5 tek tepsi, 6 güncelle, 7 kaldır (AC-274), 8 tema/DPI                                                                                                                                                                     |       |

## PT — Windows elle duman testi (istemci yayın kapısı, bekliyor)

**Durum:** istemci yayın kapısı, kullanıcı tarafında bekliyor (koşulmadı). PT-K8 Win32 ekranlarını (`internal/ui`,
`tray/tray.go`, `cmd/noktadestek`) otomatik testsiz böldü (R-PT2); duman testi gerekiyor.

**Karar (mimar, 2026-11-15, `docs/mimari-temizlik.md` §11 K-PT-4):** PT birleştirmesini **engellemez**. Staging deploy'u
sunucu ve web'i günceller, Windows istemci exe'sini yayınlamaz. Bir sonraki istemci sürümü (0.12.0 ve sonrası) bu test
geçmeden yayınlanmaz.

**Liste:** `docs/temizlik/PT-K8.md` "Elle Windows testi" tablosu (değişen kod → kontrol → grup). Adımlar aşağıdaki P20
listesinin **A–H** gruplarıdır (A tepsi ve `--tray`, B Windows açılışında başlat, C çoklu firma ana ekranı, D talep
formu ve bekleme, E başka kullanıcının mutex'i, F logo/tema ve AV, G firma dosyasıyla açılış ve kod oturumu, H kod
oturumu bitince tepsi). Aynı tabloya PT sonrası exe ile koşulur; sonuç, tarih, sürüm ve SHA-256 buraya yazılır.

| Kapsam                                          | Sonuç | Tarih / sürüm / SHA-256 |
| ----------------------------------------------- | ----- | ----------------------- |
| PT-K8 duman testi (P20 A–H, PT sonrası exe ile) |       |                         |

## P20 — Windows elle test listesi (bekliyor)

**Durum:** koşulmadı. test-operatoru Windows'ta koşamıyor; bu liste gerçek Windows 10 ve Windows 11 bilgisayarda (standart
kullanıcı, %100 ve %150 DPI, açık ve koyu tema) bir kişi tarafından uygulanır. Sonuç sütunu doldurulup tarih ve sürüm (`v0.12.0`
staging artifact'ı, SHA-256) yazılır.

**Kaynaklar:** `docs/implementation.md` "P20 K3", "P20 K5", "P20 K6", "P20 K8" elle test maddeleri; `docs/qa-raporu.md` öneri 6
(G-P20-16); runbook §24.9 (tepsi / Windows açılışı iz testi), §24.10 (AV kapısı), §24.11 (elle kaldırma). Otomatik kanıt:
Windows CI `test-windows` (`TestAC253*`, `TestAC254*` zorunlu PASS listesi) — bu liste onların yerine geçmez.

**Ön koşul:** staging sunucusu P20 K1 ekiyle güncel; 0.12.0 staging artifact'ı runbook §24.8 ile indirildi; SHA-256
`SHA256SUMS` ile eşleşiyor. İz testi için `apps/agent-win/test/trace-check.ps1` (runbook §24.9).

### A. Tepsi ve `--tray` (K5, AC-253)

| #   | Adım                                                                                                      | Beklenen                                                                                                                                       | Sonuç |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| A1  | En az bir firmaya kayıtlı, "Tepside çalıştır" açık bilgisayarda `NoktaDestek.exe --tray`                  | Yalnız tepsi simgesi; pencere yok. Kaynak İzleyicisi'nde sürecin ağ bağlantısı yok                                                             |       |
| A2  | Simgeye tıkla; ayrıca klavyeyle seçip Enter                                                               | Firma listeli ana ekran açılır                                                                                                                 |       |
| A3  | Simgeye sağ tık                                                                                           | Menüde yalnız 3 öğe: Destek iste / Aç / Çık                                                                                                    |       |
| A4  | Ana ekranı X ile kapat (oturum yok)                                                                       | Süreç tepside kalır; normal açılıştan tepsiye ilk inişte "Program tepside çalışmaya devam ediyor" balonu                                       |       |
| A5  | Tepsiden talep → oturum → oturumu bitir                                                                   | Son ekran ≈ 2,5 sn görünür, pencere kapanır, süreç tepside kalır                                                                               |       |
| A6  | Oturum sürerken tepsi → Çık → Hayır, sonra Çık → Evet                                                     | Hayır: hiçbir şey değişmez. Evet: teknisyen konsolunda oturum biter, süreç çıkar                                                               |       |
| A7  | Tepsi örneği çalışırken ikinci kez `--tray`                                                               | İkinci simge çıkmaz; ilk örnek öne gelir, ikinci süreç çıkar                                                                                   |       |
| A8  | Görev Yöneticisi'nden Windows Gezgini'ni yeniden başlat                                                   | Tepsi simgesi geri gelir                                                                                                                       |       |
| A9  | Açık ve koyu tema, %150 DPI                                                                               | Simge ve balon okunaklı                                                                                                                        |       |
| A10 | Geçerli `NoktaDestek-<firma>-<ref>.exe` ile aç, X ile kapat ("Tepside çalıştır" açık, bilgisayar kayıtlı) | K-P20-14 (qa tur 2 ile güncellendi): normal açılışla aynı kural — süreç tepsiye iner (ayrıntı G4); eski "bağımsız çalışır" beklentisi geçersiz |       |
| A11 | Programı "Yönetici olarak çalıştır" ile aç                                                                | "Tepside çalıştır" ve "Windows açılışında başlat" pasif; altında "Program yönetici olarak çalışıyor; …"                                        |       |
| A12 | Ana ekranda "Tepside çalıştır" işaretini kaldır, pencereyi kapat                                          | Süreç çıkar; `HKCU\…\Run\NoktaDestek` değeri yok                                                                                               |       |

### B. Windows açılışında başlat (K4/K8, AC-253)

| #   | Adım                                                                                                    | Beklenen                                                                                                                             | Sonuç |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| B1  | İndirilenler'deki exe ile "Tepside çalıştır" + "Windows açılışında başlat" işaretle, oturumu kapatıp aç | `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v NoktaDestek` → REG_SZ `"<yol>" --tray`; girişte yalnız simge        |       |
| B2  | "Tepside çalıştır" kapalıyken                                                                           | "Windows açılışında başlat" pasif, "Windows açılışında başlatmak için önce Tepside çalıştır'ı açın."                                 |       |
| B3  | Exe'yi `C:\Users\Public\` altına kopyalayıp oradan aç                                                   | Kutu pasif, "Bu klasöre başka kullanıcılar yazabiliyor; programı İndirilenler'e veya kendi klasörünüze taşıyın"                      |       |
| B4  | Zip içinden doğrudan çalıştır; USB bellekten çalıştır                                                   | Kutu pasif; sırasıyla "geçici bir klasörden" ve "ağ veya çıkarılabilir bir konumdan" metni                                           |       |
| B5  | Run değeri açıkken exe'yi başka klasöre taşı, programı yeni yerinden aç (S-P20-K1)                      | Run değeri silinmiş; ana ekranda "Windows açılışında başlatma kapatıldı: program bulunamadı; yeniden açmak için kutuyu işaretleyin." |       |
| B6  | B5'in tepsi yolu: değer eski yolu gösterirken başka kopyayla `--tray` başlat, simgeden pencere aç       | Tepside "Windows açılışında başlatma kapatıldı (program bulunamadı)" balonu; "(klasör izinleri)" balonu çıkmaz                       |       |
| B7  | Çalışan exe'nin klasörüne `icacls <klasör> /grant *S-1-5-32-545:(OI)(CI)M`, sonra tepsiden pencere aç   | Run değeri silinir, "Windows açılışında başlatma kapatıldı (klasör izinleri)" balonu                                                 |       |
| B8  | Görev Yöneticisi > Başlangıç uygulamaları > Nokta Destek > Devre dışı bırak, ana ekranı aç              | Altında "Windows ayarlarında devre dışı"                                                                                             |       |
| B9  | Kılavuzdaki elle kaldırma komutu (`reg delete … /v NoktaDestek /f`)                                     | Değer silinir, yönetici gerekmez                                                                                                     |       |
| B10 | Görev Yöneticisi > Başlangıç'ta görünen ad ve simge                                                     | Ad "Nokta Destek"; simge genel (bilinen sınırlama, exe'de simge kaynağı yok) — not düş                                               |       |

### C. Çoklu firma ana ekranı (K3, AC-254)

| #   | Adım                                                                                                         | Beklenen                                                                                                                         | Sonuç |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----- |
| C1  | 0.11 ile kayıt al (`hatirla.bin`), 0.12 aç                                                                   | Kayıt listede; `hatirla.bin` silinmiş, `kayitlar.bin` + `kayitlar.lock` var                                                      |       |
| C2  | 5 ayrı firmayla oturum                                                                                       | Her yenisinde "Bu bilgisayar artık <firma> için de kayıtlı (n/5)."; liste 5 satır, her satırda "(kayıt: GG.AA.YYYY)"             |       |
| C3  | 6. firmayla oturum                                                                                           | Oturum sürer; sonunda "Bu bilgisayar 5 firmaya kayıtlı; <firma> için kayıt alınmadı. …"; panelde başka firmanın kaydı düşmemiş   |       |
| C4  | FirmHome yerleşimi: 5 satır + "Başka sunucu (<host>) — talep için seçilemez" bloğu, açık/koyu tema, %150 DPI | Taşma yok, metinler okunaklı, Tab sırası Destek iste → Bağlantı kodum var → Bu firmayı unut → Bu bilgisayarı unut (tüm firmalar) |       |
| C5  | Firma seç → Destek iste                                                                                      | Talep o firmaya düşer; bekleme penceresi başlığında seçilen firmanın adı                                                         |       |
| C6  | Bu firmayı unut → onay → Evet                                                                                | Yalnız o satır gider; panelde yalnız o firmanın kaydı iptal                                                                      |       |
| C7  | Bu bilgisayarı unut (tüm firmalar) → onay → Evet                                                             | `%LOCALAPPDATA%\NoktaDestek` yok, Run değeri yok, tepsi simgesi kalkar; `trace-check.ps1` temiz                                  |       |
| C8  | Panelde bir firmanın kaydını iptal et, programı aç                                                           | "<firma>: bu bilgisayarın kaydı artık geçerli değil, listeden çıkarıldı."; diğerleri kalır                                       |       |
| C9  | Ağ kapalıyken ana ekranı aç                                                                                  | Hiçbir kayıt silinmez                                                                                                            |       |
| C10 | Onay diyaloglarında Hayır                                                                                    | Hiçbir şey silinmez                                                                                                              |       |

### D. Talep öncesi sohbet (K6, AC-255)

| #   | Adım                                       | Beklenen                                              | Sonuç |
| --- | ------------------------------------------ | ----------------------------------------------------- | ----- |
| D1  | Staging panel ↔ istemci mesaj gidiş-dönüşü | İki yönde görünür; panel kartı "sohbet destekleniyor" |       |
| D2  | Enter ile gönderim                         | Enter = Gönder; "Siz (gönderiliyor…)" sonra onaylı    |       |
| D3  | 200+ mesajlık uzun geçmişte kaydırma       | Kaydırma çalışır, en eski mesajlar düşer              |       |
| D4  | Pencere arka plandayken teknisyen mesajı   | Görev çubuğu simgesi yanıp söner                      |       |
| D5  | Teknisyen talebi kabul eder                | "Talep kabul edildi; sohbet kapandı."; giriş pasif    |       |
| D6  | Açık ve koyu tema                          | Sohbet alanı okunaklı                                 |       |

### E. Başka kullanıcının oluşturduğu tepsi mutex'i / penceresi (G-P20-16, S-P20-K2)

İkinci bir yerel Windows kullanıcısı (B) gerekir; sınama kullanıcısı A.

| #   | Adım                                                                                                                                                          | Beklenen                                                                                                      | Sonuç |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----- |
| E1  | B oturumunda (aynı konsol oturumunda `runas /user:B`) A'nın mutex adını (`Local\NoktaDestek.Tray.<A SID SHA-256 ilk 16 hane>`) önceden oluştur; A'da `--tray` | A'nın tepsisi yine başlar (yabancı sahipli mutex yok sayılır); A'nın `tanilama.log`'unda `tray_mutex_foreign` |       |
| E2  | B, `runas` ile `NoktaDestekTray` sınıflı bir pencere açık tutarken A'da ikinci `--tray`                                                                       | A'nın ikinci örneği B'nin penceresini öne getirmez, ileti göndermez                                           |       |
| E3  | A'da tepsi çalışırken ikinci `--tray`                                                                                                                         | A'nın ilk örneği öne gelir (aynı kullanıcı)                                                                   |       |

### G. Firma dosyasıyla açılış — tek ana ekran (K-P20-14, AC-182, AC-190, AC-253)

| #   | Adım                                                                                                | Beklenen                                                                                                                                                                                                                                             | Sonuç |
| --- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| G1  | Kayıtsız bilgisayarda (`%LOCALAPPDATA%\NoktaDestek` yok) geçerli `NoktaDestek-<firma>-<ref>.exe` aç | ≤ 5 sn'de firma listeli ana ekran; liste yerine tek satır "Bu dosyanın firması: <sunucudaki ad>" (dosya adındaki etiket değil); "Destek iste" etkin ve varsayılan; "Bu firmayı unut" pasif                                                           |       |
| G2  | G1'de "Tepside çalıştır" ve "Windows açılışında başlat" kutularına bak, tıklamayı dene              | İkisi de pasif; altında "Tepside çalıştır, bu bilgisayar bir firmaya kaydolduktan sonra (ilk destek oturumunun ardından) açılabilir."; tıklama hiçbir şey yazmaz (`reg query …\Run /v NoktaDestek` yok, klasör oluşmaz)                              |       |
| G3  | G1'den "Destek iste" → form                                                                         | Form başlığında dosyanın firması; talep panelde o firmaya (ref'in müşterisine/Genel'e) düşer                                                                                                                                                         |       |
| G4  | En az bir firmaya kayıtlı bilgisayarda (başka veya aynı firma) aynı dosyayı aç                      | Liste: 1. satır "Bu dosyanın firması: <ad>" seçili, altında kayıtlı firmalar "(kayıt: GG.AA.YYYY)" ile; dosya satırı seçiliyken "Bu firmayı unut" pasif, kayıtlı satır seçilince etkin; aynı firma kayıtlıysa iki satır görünür (bilinen, gerekçeli) |       |
| G5  | G4'te kutular                                                                                       | Normal açılıştakiyle aynı: "Tepside çalıştır" etkin; işaretleyince "Windows açılışında başlat" etkinleşir (yükseltilmiş süreçte ikisi de pasif)                                                                                                      |       |
| G6  | G4'te "Tepside çalıştır" açıkken X                                                                  | Süreç tepsiye iner, ilk inişte balon; tepsi zaten başka örnekte açıksa ikinci simge çıkmaz, süreç çıkar                                                                                                                                              |       |
| G7  | Ağ kapalıyken G1                                                                                    | Satır "Bu dosyanın firması" (adsız); "Destek iste" bugünkü ağ hata ekranını "Tekrar dene" ile açar; kayıt silinmez                                                                                                                                   |       |
| G8  | Panelde ref'i geçersiz kılınmış dosyayı kayıtsız bilgisayarda aç                                    | Ana ekran satırsız; bilgi satırı "Bu dosya artık geçerli değil. Firmanızdan yenisini isteyin. …"; "Destek iste" pasif, "Bağlantı kodum var" varsayılan                                                                                               |       |
| G9  | Açık/koyu tema, %150 DPI, Tab sırası                                                                | Taşma yok; Tab: liste → Destek iste → Bağlantı kodum var → Bu firmayı unut → Bu bilgisayarı unut (tüm firmalar) → Kapat → kutular                                                                                                                    |       |

### H. Kod oturumu bitince tepsi kuralı (K-P20-14, AC-253, AC-107)

| #   | Adım                                                                        | Beklenen                                                                                                       | Sonuç |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----- |
| H1  | Kayıtlı, "Tepside çalıştır" açık bilgisayarda geçerli `Destek-<kod>.exe` aç | Ana ekran yok; karşılama/lobi doğrudan (kod akışı değişmedi)                                                   |       |
| H2  | H1 oturumunu teknisyen bitirsin                                             | Son ekran ≈ 2,5 sn görünür, pencere kapanır, süreç tepside kalır (ilk inişte balon); simgeden ana ekran açılır |       |
| H3  | Aynı adımlar "Tepside çalıştır" kapalıyken                                  | Oturum sonunda süreç çıkar (AC-107)                                                                            |       |
| H4  | Kayıtsız bilgisayarda kod oturumu, lobide Vazgeç (kayıt alınmaz)            | Süreç çıkar; tepsi yok, `%LOCALAPPDATA%\NoktaDestek` ve Run değeri yok                                         |       |
| H5  | Kod dosyasını "Yönetici olarak çalıştır" ile aç, oturumu bitir              | Tepsiye inmez, süreç çıkar (K-P20-8)                                                                           |       |
| H6  | Tepsi örneği çalışırken kod oturumu bitir                                   | İkinci simge çıkmaz; kod süreci çıkar (G-P20-13)                                                               |       |

### F. AV kapısı ve iz (runbook §24.9–24.10)

| #   | Adım                                                                            | Beklenen                    | Sonuç |
| --- | ------------------------------------------------------------------------------- | --------------------------- | ----- |
| F1  | Defender (W10 + W11) `MpCmdRun -Scan -ScanType 3 -File`; tepsi + Run açık 24 sa | Temiz, Defender geçmişi boş |       |
| F2  | `trace-check.ps1 -Tray on -Autostart on -ExePath <yol>`                         | Yalnız izinli izler         |       |
