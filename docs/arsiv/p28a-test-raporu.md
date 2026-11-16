# Test Raporu — P28a K9 (pano senkronu + uzaktan yazdırma)

Önceki paketlerin sayfa testi raporları `docs/arsiv/*-test-raporu.md` ve `docs/test-raporu/` altındadır.

DURUM: GEÇTİ (web + staging duman kapsamı; Windows istemcili maddeler kullanıcının elle turunda — aşağıda ⏭)

Ortam:

- Yerel: üretim derlemesi (standalone, bu tur `987b2f1` ağacından derlendi) `http://localhost:3217` + sahte API
  `apps/web/e2e/mock-api.mjs` :4217 (sahte WS + sahte Windows istemci `e2e/fake-agent.ts`). Gerçek sunucu kullanılmadı.
- Staging: `https://remote.noktabilisim.net`, `remote-web:987b2f1` + `remote-server:987b2f1` (sunucuda `docker ps` ile
  salt okunur doğrulandı, ikisi de healthy). Yalnız kimliksiz GET; giriş denemesi yapılmadı (kilit/audit kirliliği yok).
- Dal `main`, HEAD `87ca1fa` (987b2f1'e göre yalnız `docs/runbook.md` farkı; derlenen kod aynı). Tarih 2026-11-16.
- Betikler: `docs/test-raporu/e2e/p28a-k9/` (`k9.config.ts`, `panel.spec.ts`, `tarama.spec.ts`, `staging.mjs`); ham
  sonuçlar `panel.jsonl`, `tarama.jsonl`. Seçilmiş ekranlar `docs/img/p28a-k9/`. Betikler `apps/web` altına geçici
  kopyalanıp koşuldu, kopya silindi; açılan süreçler kapatıldı.

## Özet

| Ölçüt                                                 | Sonuç                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Mevcut e2e `p28a-clip-print.spec.ts`                  | 3/3 geçti (desktop); mobil 3 test spec gereği atlandı ("konsol masaüstü akışı") — geçti sayılmadı         |
| Panel durum testi (`panel.spec.ts`)                   | 24/24 geçti: 8 panel durumu × açık/koyu × 1440/390 = 32 görünüm + kullanıcı düzenleme 4 görünüm           |
| Genel tarama (`tarama.spec.ts`)                       | 100/100 geçti: 25 ekran/durum × açık/koyu × 1440/390                                                      |
| Konsol / JS hatası                                    | 0 (yalnız sahte API artefaktı 404'ler, aşağıda)                                                           |
| 4xx/5xx                                               | 5xx 0. 404: `/yok-boyle-sayfa` (beklenen) ve `usadm` senaryosunda `/api/v1/support-requests*` (sahte API) |
| Kırık iç link (desktop açık, sayfadaki tüm `a[href]`) | 0                                                                                                         |
| axe (wcag2a/aa/21aa)                                  | 0 ihlal (136/136 görünüm; panel durumlarında panel bölgesi, diğerlerinde tüm sayfa)                       |
| 390 px yatay taşma                                    | 0; panel sağ kenarı her durumda görünüm genişliği içinde                                                  |
| Yavaş sayfa                                           | yok (sahte API, her görünüm < 1,5 sn)                                                                     |
| Staging `/login` (1440/390 × açık/koyu)               | 200, konsol 0, başarısız istek 0, taşma 0, CSP + HSTS başlığı var, favicon 3 bağlantı, logo yüklü         |

Not (artefakt, bulgu değil): `usadm` (kullanıcı yönetimi) sahte senaryosu destek talebi uçlarını taklit etmiyor; yan menü
rozeti `/api/v1/support-requests/count` 404 alıyor. Gerçek sunucuda uç var (P8b); önceki turlarda da aynı.

## Bulgular (öncelik sırasıyla)

Yok (ENGELLEYİCİ/YÜKSEK/ORTA/DÜŞÜK bulgu çıkmadı).

Bilgi notları (iş açılmadı):

- **Yetki yok → panel gizli, pasif değil.** `u-p7` (kontrol var, `remote_control.clipboard` ve `file_transfer.print` yok)
  ile "Pano ve yazdırma" bölümü hiç çizilmiyor. Görev metnindeki "yetki yok durumunda pasif + neden" beklentisinden
  farklı, ancak mimari-p28 §6 bunu açıkça kararlaştırıyor ("yetki yok (düğme **gizli**, AC-72 kalıbı)"). AC-348 de
  "yalnız `file_transfer.print` yetkisiyle … görünür" diyor. Tasarıma uygun, bulgu sayılmadı.
- **Konsol açık temada da koyu.** Sahte kullanıcının tema tercihi Sistem olduğu için konsol DESIGN.md §8 "Konsol varsayılan
  koyu" kuralıyla koyu açılıyor (`rs_theme=light` çerezi DB tercihini ezmiyor). Bu nedenle mevcut e2e'deki "390 px açık
  temada axe 0" testi fiilen koyu konsolda koşuyor. Açık tercihli (`Açık`) konsol bu turda ayrıca denenmedi. Koyu
  konsolda bütün durumlar axe 0.
- **Mobilde toast panelin altını örtüyor.** 390 px'te "Müşteri kontrol izni verdi" toast'ı birkaç saniye "Uzaktan yazdır"
  neden metninin üstünde kalıyor (`d2b-eski-istemci-izinli-mobile-light.png`). Toast geçici ve kapatılabilir; bulgu
  sayılmadı.

## Akış sonuçları

| Akış / durum                                                                                                                                                                                                                                                        | Sonuç | Not                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mevcut e2e: neden metinleri → kontrol izni → pano anahtarı → yazdır → yanıtsız → 30 sn bekleme; axe 0                                                                                                                                                               | ✅    | desktop                                                                                                                                                                                                                                     |
| Mevcut e2e: PDF olmayan dosya reddi; Vazgeç → `print.cancel`; kontrol VIEW → "Kontrol izni kapandı, yazdırma iptal edildi"                                                                                                                                          | ✅    | desktop                                                                                                                                                                                                                                     |
| Mevcut e2e: eski istemci → "destek yok" metni, 390 px axe 0                                                                                                                                                                                                         | ✅    | desktop (390 viewport)                                                                                                                                                                                                                      |
| D1 müşteri ayrıldı                                                                                                                                                                                                                                                  | ✅    | Üç düğme pasif; pano ve yazdırma altında "Müşteri bağlı değil". Bekleme ekranında yan panel (dolayısıyla bu bölüm) hiç çizilmiyor; durum, müşteri ayrılınca görünüyor                                                                       |
| D2 0.12 istemci (özellik belirteci yok), izin öncesi ve sonrası                                                                                                                                                                                                     | ✅    | İki durumda da iki neden "Müşterinin uygulaması bu özelliği desteklemiyor — güncel sürümü indirmesini isteyin" (`unsupported`, `noControl`'dan önce gelir). Düğmeler pasif                                                                  |
| D3a kontrol izni yok                                                                                                                                                                                                                                                | ✅    | Pano ve yazdırma pasif; ikisinde de "Önce uzaktan kontrol izni alın"                                                                                                                                                                        |
| D3b kısmi (kontrol izni var, müşteri pano anahtarı kapalı)                                                                                                                                                                                                          | ✅    | Pano pasif, "Müşteri pano paylaşımına izin vermedi". Yazdır etkin, neden yok, "Yalnız PDF, en çok 20 MB…" ipucu var                                                                                                                         |
| D3c tam (anahtar açık)                                                                                                                                                                                                                                              | ✅    | Üç düğme etkin, neden metni yok, pano ipucu görünür                                                                                                                                                                                         |
| D4 yetki yok (`u-p7`)                                                                                                                                                                                                                                               | ✅    | "Kontrol iste" görünür; "Pano ve yazdırma" bölümü yok (tasarım gereği gizli, bkz. bilgi notu)                                                                                                                                               |
| D5 tarayıcı misafir (`join-browser` + kabul + paylaşım)                                                                                                                                                                                                             | ✅    | Pano düğmeleri pasif, "Pano yalnız müşteri uygulamasında ve kontrol izniyle kullanılır"; yazdırma bloğu ve düğmesi DOM'da yok (AC-348)                                                                                                      |
| `aria-describedby` hedefi                                                                                                                                                                                                                                           | ✅    | Neden gösterilen her durumda `clip-push` ve `print-pick` için hedef id DOM'da, metni neden metniyle aynı                                                                                                                                    |
| Kullanıcı düzenleme (admin `usadm` → `/users/<Can>`): "Pano paylaşımı" ve "Uzaktan yazdır" toggle'ları                                                                                                                                                              | ✅    | 1440 tablo ve 390 kart görünümünde görünür. Etiketler: "Uzaktan kontrol — Pano paylaşımı", "Dosya transferi — Uzaktan yazdır". Tıklayınca `aria-checked` false → true (kaydedilmedi). axe 0, taşma 0                                        |
| AC-404 açıklamaları                                                                                                                                                                                                                                                 | ✅    | `PERMISSION_DESCRIPTIONS` iki metni sayfada görünüyor                                                                                                                                                                                       |
| İkonlar (§1.8)                                                                                                                                                                                                                                                      | ✅    | Modül satırı/kartında anlamlı ikon: Uzaktan kontrol `MousePointerClick`, Dosya transferi `Paperclip` (yan menüyle aynı tek kaynak `lib/module-icons.ts`). Eylem anahtarlarında ayrı ikon yok; bu matris kalıbı tüm modüllerde aynı, tutarlı |
| Genel tarama (25 ekran: giriş, şifremi unuttum, ana sayfa, oturumlar dolu/boş/hata, talepler, müşteriler dolu/boş, geçmiş, kullanıcılar dolu/boş, kullanıcı düzenleme, audit dolu/boş, hesabım, ayarlar ×4, firmalar, süper adminler, gözetimsiz liste/kodlar, 404) | ✅    | Tümü beklenen HTTP durumu ve h1; hata durumunda "Bir şeyler ters gitti" + "Tekrar dene"                                                                                                                                                     |
| Staging: `/` ve korumalı URL'ler kimliksiz                                                                                                                                                                                                                          | ✅    | `/` → `/login`; `/sessions`, `/users` → 307 `/login?next=…`                                                                                                                                                                                 |

## Kabul kriterleri (uçtan uca)

| AC                                                | Durum | Nasıl doğrulandı                                                                                                                                                                 |
| ------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-343 (pano düğmeleri etkinlik/neden)            | ✅    | Web tarafı: D1–D5 + mevcut e2e. Sunucu 403 kısmı bu turda koşulmadı (qa/entegrasyon kapsamı)                                                                                     |
| AC-344 (istemci anahtarı varsayılan kapalı)       | ⏭     | İstemci tarafı; Windows elle tur (kullanıcı) / Go testleri                                                                                                                       |
| AC-345 (64 KB, boş pano, SENSITIVE)               | —     | Bu turda koşulmadı (birim/Go testi kapsamı)                                                                                                                                      |
| AC-346 (≤ 1 sn aktarım, müşteri bildirimi)        | ⏭     | Windows elle tur (kullanıcı); staging istemcisi henüz 0.12.x                                                                                                                     |
| AC-347 (audit, içerik loglanmaz)                  | —     | Bu turda koşulmadı (entegrasyon kapsamı). Tarayıcı konsolunda işaretli içerik 0 (mevcut e2e içerik taraması)                                                                     |
| AC-348 (yazdır görünürlük/kapı/PDF denetimi)      | ✅    | Tarayıcı modunda gizli (D5), kontrol izni yokken pasif + metin (D3a), PDF olmayan dosya alan hatası, VIEW'da iptal (mevcut e2e). Sunucu 403 entegrasyon testi bu turda koşulmadı |
| AC-349 (müşteri diyaloğu, 60 sn)                  | ⏭     | Windows elle tur (kullanıcı). Web tarafı "Müşteri yanıt vermedi" metni mevcut e2e'de ✅                                                                                          |
| AC-350 (yazıcıya gönderim, iz testi)              | ⏭     | Windows elle tur (kullanıcı)                                                                                                                                                     |
| AC-351 (print.job audit)                          | —     | Bu turda koşulmadı (entegrasyon kapsamı)                                                                                                                                         |
| AC-352 (eski istemci metni)                       | ✅    | D2 (izin öncesi/sonrası, iki tema, 1440/390). Gözetimsiz oda nedeni sahte yığında yok; yalnız birim testi (`lib/clip/clip-print-p28a.test.ts`)                                   |
| AC-404 (toggle + açıklama, 5 durum, a11y, 390 px) | ✅    | Toggle + açıklama ekranda. Panelde iskelet/boş(neden)/hata/kısmi/başarılı: neden, kısmi ve tam bu turda; hata (alan hatası) ve iskelet mevcut e2e/birim testinde. axe 0, taşma 0 |
| AC-289                                            | ⏭     | Windows elle tur (kullanıcı)                                                                                                                                                     |
| D-P28a-1 enjeksiyon testi                         | ⏭     | Windows elle tur (kullanıcı)                                                                                                                                                     |
| Müşteri diyaloğunda Enter = Reddet                | ⏭     | Windows elle tur (kullanıcı)                                                                                                                                                     |

⏭ bulgu değildir. Gerçek Windows istemcisi gerektirir; staging'de istemci exe'si henüz 0.12.x
(runbook 2026-11-16 kaydı, S13C-13 notu).

## Görsel gözlemler (ekran görüntülerinden)

- `d3a-kontrol-yok-desktop-light.png`: sağ panelde sohbetin altında ayırıcı çizgi, "Pano ve yazdırma" başlığı ve iki
  pano düğmesi yan yana. Altında neden metni, ardından tam genişlik "Uzaktan yazdır" ve onun nedeni. Pasif düğmeler
  soluk ama okunaklı, hizalar düzgün.
- `d3b-kismi-desktop-light-panel.png`: pano pasif + neden; yazdır etkin (beyaz kenarlı), altında sınır ipucu. Kısmi durum
  net ayırt ediliyor.
- `d2b-eski-istemci-izinli-mobile-light.png`: 390 px'te düğmeler alt alta tam genişlik. Uzun "desteklemiyor — güncel
  sürümü…" metni iki satıra düzgün kırılıyor, taşma yok. Alttaki toast bilgi notunda.
- `d5-tarayici-misafir-mobile-dark-panel.png`: yalnız iki pano düğmesi ve tarayıcı nedeni var, yazdırma hiç yok.
- `d4-yetki-yok-mobile-light.png`: konsol "Kontrol iste" ile normal; pano/yazdırma bölümü yok.
- `u1-user-edit-desktop-light-toggle.png`: yetki tablosunda "Diğer" sütununda "Kullan" altında "Pano paylaşımı" ve
  "Uzaktan yazdır". Modül ikonları (imleç-tık, ataş) satır başında.
- `u1-user-edit-mobile-dark-toggle.png`: kart görünümü, modül başlığı ikon + "Tümü" anahtarı, alt anahtarlar etiketli.
  Koyu temada kontrast yeterli.
- `stg-login-390-dark.png`, `stg-login-1440-light.png`: staging giriş ekranı. Logo açık zemin kartında (koyu temada
  okunaklı), taşma yok.

## Test edilmeyenler

- Windows istemcili gerçek pano/yazdırma akışı (yukarıdaki ⏭ maddeleri): kullanıcının elle turu.
- Gerçek sunucu entegrasyonu (403 kapıları, audit, rate limit): backend/qa entegrasyon testleri kapsamında, bu turda
  koşulmadı.
- Staging'de kimlikli tarama: belgelenmiş yerel test hesabı yok; sırlar sunucudan çekilmedi. Kimlikli ekranlar sahte
  yığınla tarandı.
- Konsolun açık (`Açık` tercihli) varyantı.

## Sonuç

DURUM: GEÇTİ

- Düzeltilecek madde yok (ENGELLEYİCİ/YÜKSEK/ORTA/DÜŞÜK 0).
- ⏭ Windows elle tur (kullanıcı, istemci 0.13.0 ile): AC-346, AC-349, AC-350, AC-289, D-P28a-1 enjeksiyon testi,
  müşteri diyaloğunda Enter = Reddet (ayrıca AC-344 istemci anahtarı). Atanan: kullanıcı; sonuç gelince test-operatoru
  raporu günceller.
- İsteğe bağlı (bulgu değil): mevcut e2e'deki "390 px açık temada" testi, kullanıcı tercihi `Açık` olan bir sahte
  senaryoyla gerçekten açık konsolda koşturulabilir. Atanan: frontend-dev.
