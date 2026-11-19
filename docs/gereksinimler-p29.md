# Gereksinimler — P29 (İstemci otomatik güncelleme + sürüm bildirimi)

Tarih: 2026-11-19 · Durum: TASLAK (kullanıcı isteği 2026-11-18; ayrıntılar varsayımla dolduruldu, §7 — S-P29-1..5 ana oturum kararı 2026-11-19: gereksinimdeki varsayılanlar geçerli, kullanıcı itiraz ederse değişir; S-P29-6 SignPath kararı kullanıcıda, P29 imzasız ilerler)
Paket sürümü: **0.22.0** (istemci + sunucu). Önceki: P28g (istemci 0.20.0), P21 (müşteri portalı).
Yeni AC'ler: **AC-470..AC-493 (24 AC)** — AC-452..469 paralel P22-G paketine ayrıldı. Hikâyeler: US-P29-1..US-P29-5
(önekli; paralel paketlerle numara çakışmasın diye). Varsayımlar V-P29-1..12, riskler R-P29-1..10, açık sorular S-P29-1..6.
Ön koşul: **yeni ADR (güncelleme güven modeli) + güvenlik tasarım turu** kod yazılmadan önce (mimari-e11 §8d.13 kararını tersine çevirir, §11).

Kullanıcı isteği (kelimesi kelimesine): "ajanlarda otomatik update özelliği olmalı, yeni versiyon için ana sisteme log atmalı".

## 1. Amaç ve iş değeri

Bugün yeni istemci sürümü çıktığında müşteri bilgisayarındaki her kopya elle değiştirilir; tek mekanizma `MIN_AGENT_VERSION` → 426
`CLIENT_OUTDATED` (ve gözetimsizde 409 `DEVICE_OUTDATED`, AC-435) ile **eski sürümü kilitlemektir**. Özellikle gözetimsiz servis
(sunucularda, kimse başında değilken) güncellenmedikçe yeni özelliklerden yararlanamaz ve bağlantı kesilir. P29 istemcilerin yeni
sürümü sunucunun imzaladığı bir manifestle doğrulayarak kendiliğinden kurmasını ve her güncelleme denemesini (başarılı/başarısız)
ana sisteme bildirmesini sağlar. Yönetici panelde hangi cihazın hangi sürümde olduğunu ve başarısız güncellemeleri görür.

## 2. Roller (ek)

| Rol               | P29 ile gelen                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Super Admin       | Yayın durumu ekranı (platform başına yayındaki sürüm, manifest imza durumu); tüm tenant'ların sürüm dağılımı                       |
| Admin             | Tenant ayarı "İstemcileri otomatik güncelle" (Açık/Kapalı); gözetimsiz cihaz listesinde sürüm + güncelleme durumu; sürüm dağılımı |
| User (Teknisyen)  | Değişiklik yok; cihaz satırında sürüm ve "Güncelleniyor" rozetini görür (`unattended.view` ile)                                    |
| Cihaz kullanıcısı | İstemcide "Yeni sürüm hazır — sonraki açılışta kullanılacak" bilgisi; oturum sırasında hiçbir güncelleme yapılmaz                  |
| Yayıncı (devops)  | Etiketli sürümde CI manifest imzalar; imza anahtarı yalnız korumalı GitHub ortamında                                                |

## 3. Kapsam

### 3.1 İkili × çalışma biçimi (belgenin omurgası)

| #   | İkili                                                    | Nerede çalışır                                                          | P29'da beklenen davranış (kullanıcı gözüyle)                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Windows gözetimsiz servis `NoktaDestekServis.exe` (P27)  | `%ProgramFiles%\NoktaDestek Servis\`, SYSTEM, sürekli                   | **Tam otomatik.** Açık bağlantı yokken indirir, doğrular, kendini değiştirir, yeniden başlar, sağlık denetimi geçmezse eski sürüme döner. Kimse bir şey tıklamaz. Asıl değer buradadır (AC-435 kilidi kalkar).                                                                                                                                                                                                                |
| B   | Windows Hızlı Destek `NoktaDestek.exe` / `NoktaDestek-<etiket>-<ref>.exe` | Kullanıcının indirdiği yer (İndirilenler vb.); tek seferlik ya da tepsi/Run (P20) | **Aynı kural, tek yol:** açılışta (tepside 24 sa'te bir) denetler; yeni sürümü oturum yokken arka planda indirir ve doğrular; **dosyayı yerinde, aynı adla** değiştirir; yeni sürüm bir sonraki açılışta çalışır. Tek seferlik çift tık ile tepsi arasında davranış farkı yoktur (sadelik ilkesi). Dosya yazılamıyorsa (salt okunur/ağ/çıkarılabilir konum) yalnız "Yeni sürüm var — indirme sayfası" bilgisi gösterilir. |
| C   | macOS `Nokta Destek.app` (P28f, ADR-0037)                | Kullanıcının açtığı klasör (`Destek-<kod>/`), yalnız katılımlı          | B ile aynı kural (paket yerinde, aynı klasör ve bundle adıyla değiştirilir). App Translocation / yazılamayan konumda yalnız bilgi gösterilir. Ekran Kaydı/Erişilebilirlik izinleri güncellemede korunmalıdır (R-P29-6).                                                                                                                                                                                               |
| D   | Linux tek ELF `Destek-<kod>` (P28g, ADR-0038)            | Kullanıcının çalıştırdığı yer, yalnız katılımlı, imzasız                | **Varsayılan (V-P29-4):** B ile aynı kural — ELF yerinde, aynı adla (kod `/proc/self/exe` adından okunduğu için ad korunur), çalıştırma biti korunur. Seçenekler mimara açık: (i) yerinde değiştirme [varsayılan], (ii) yalnız "yeni sürüm var" bildirimi, (iii) paket yöneticisi/AppImage (kapsam dışı, ADR-0038 m.11). Hangisi seçilirse seçilsin olay bildirimi (§3.2/4) aynıdır.                                     |

Ortak kural: **oturum (katılımlı, gözetimsiz, talep bekleme) sürerken hiçbir ikili değiştirilmez ve yeniden başlatılmaz.**

### 3.2 Kapsamda

1. **İmzalı yayın manifesti:** CI etiketli sürümde platform/mimari başına sürüm, SHA-256, boyut, ortam (`prod`/`staging`), yayın ve
   son geçerlilik zamanı içeren manifesti Ed25519 ile imzalar. Açık anahtar(lar) istemciye derlemede gömülür; özel anahtar repoda yoktur.
2. **İstemcide güncelleyici:** denetle → indir → doğrula (manifest imzası + SHA-256 + düşürme engeli + ortam/platform eşleşmesi +
   varsa platform imzası) → oturum yokken kur → (A'da) sağlık denetimi → başarısızsa geri dön. Doğrulanmayan ikili kurulmaz.
3. **Ana sisteme bildirim ("log"):** her durum değişimi (yeni sürüm bulundu, kuruldu, başarısız, reddedildi, geri dönüldü) sunucuya
   bildirilir; kimlikli istemcide audit'e (`client.update.*`), her durumda metriğe yazılır.
4. **Panel:** gözetimsiz cihaz listesinde sürüm sütunu + güncelleme durumu rozeti; sürüm dağılımı özeti; Audit Log'da filtre.
5. **Politika:** tenant düzeyinde tek anahtar "İstemcileri otomatik güncelle" (varsayılan Açık). Kapalıysa istemci kurmaz, yalnız bildirir.
6. **Yayın süreci:** etiket → imzalı manifest → Release → sunucuya yükleme; P27 `signed` kipte SHA listesi sırası (AC-489).
7. Dokümantasyon: runbook (anahtar üretimi, rotasyon, kaybı, yayın sırası), kılavuz, DATASHEET, CHANGELOG 0.22.0.

### 3.3 Kapsam DIŞI (açıkça)

| #   | Madde                                                                                                  | Durum                           |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------- |
| 1   | Kademeli yayın (yüzde/halka), beta/kararlı kanal seçimi                                                | Sonra (S-P29-3)                 |
| 2   | Delta/yama güncelleme; P2P dağıtım                                                                     | Kapsam dışı                     |
| 3   | Cihaz veya müşteri firma bazında sürüm sabitleme (pin), elle "şimdi güncelle" düğmesi                  | Sonra (S-P29-4)                 |
| 4   | Bakım penceresi (yalnız belirli saatlerde kur)                                                         | Sonra (S-P29-2)                 |
| 5   | MSI / GPO / Intune / SCCM dağıtımı; Linux `.deb`/`.rpm`/Flatpak/AppImage/paket deposu; Mac App Store   | Kapsam dışı (ADR-0010, 0037, 0038) |
| 6   | Sürüm düşürme (downgrade) — acil geri alma dahil; geri alma "daha yüksek numaralı düzeltme sürümü" ile yapılır | Kapsam dışı (V-P29-7)      |
| 7   | Tarayıcı-yalnız mod (güncellenecek ikili yok)                                                          | Konu dışı                       |
| 8   | ≤ 0.21.x istemcilerin uzaktan güncellenmesi (güncelleyici içermezler; son bir elle kurulum gerekir)   | Kapsam dışı (R-P29-5)           |
| 9   | macOS/Linux gözetimsiz servis (yok; P28 kapsam dışı 8)                                                 | Konu dışı                       |
| 10  | Sunucu/panel (Docker yığını) otomatik güncellemesi                                                     | Kapsam dışı                     |

## 4. Kullanıcı hikâyeleri

- US-P29-1: Admin olarak müşteri sunucularındaki gözetimsiz servisin yeni sürüme kendiliğinden geçmesini istiyorum ki tek tek
  bağlanıp elle kurmayayım ve "Servis güncel değil" kilidiyle karşılaşmayayım.
- US-P29-2: Admin olarak hangi cihazın hangi sürümde olduğunu ve hangi güncellemelerin başarısız olduğunu panelde görmek istiyorum
  ki sorunlu cihazı hemen bulayım.
- US-P29-3: Müşteri (cihaz kullanıcısı) olarak destek sırasında programın kendini güncelleyip oturumu kesmemesini istiyorum.
- US-P29-4: Super Admin olarak yalnız bizim imzaladığımız sürümlerin kurulmasını, sahte/eski sürümün reddedilip kaydedilmesini
  istiyorum ki güncelleme kanalı bir saldırı yolu olmasın.
- US-P29-5: Admin olarak değişiklik yönetimi gerektiğinde tenant'ımda otomatik kurulumu kapatabilmek istiyorum (yalnız bildirim kalsın).

## 5. Kabul kriterleri

### 5.1 Manifest ve yayın (CI)

| AC     | Kriter |
| ------ | ------ |
| AC-470 | `v*` etiketinde CI, yayınlanan her ikili için (Windows istemci, Windows servis, macOS zip, Linux ELF) tek bir manifest üretir: `schema`, `env` (`prod`/`staging`), `platform`, `arch`, `component` (`client`/`service`), `version` (semver), `sha256`, `size`, `issuedAt`, `expiresAt` (issuedAt + ≤ 90 gün), `minUpdaterVersion`. Manifest Ed25519 ile imzalanır; imza ayrı dosyadadır. Manifest/imza Release'e SHA256SUMS ve attestation ile birlikte eklenir (CI testi: imza açık anahtarla doğrulanır; alan eksikse iş kırmızı). |
| AC-471 | İmza özel anahtarı repoda, repo secret'ında, log/artifact'ta bulunmaz: yalnız `v*` etiketine sınırlı, onaylı (required reviewer) GitHub ortamında (`agent-sign` kalıbı) ortam secret'ıdır. Anahtar yoksa imza işi atlanır ve **Release'e manifest girmez** (istemci güncelleme bulamaz, fail-closed). gitleaks ve log taraması temiz (CI). |
| AC-472 | Staging derlemesi yalnız staging açık anahtarını, prod derlemesi yalnız prod açık anahtarını gömer; anahtar çifti ortama özeldir. Prod istemci `env=staging` manifesti (geçerli imzalı olsa da) reddeder, tersi de (Go birim testi: 4 kombinasyon). |
| AC-473 | Sunucu manifesti ve imzayı değiştirmeden sunar: `GET /public/agent/update?platform=&arch=&component=` → 200 `{manifest, signature}` (önbellek ≤ 5 dk) veya yayın yoksa 204. Sunucu manifest içeriğini doğrulamaz-üretmez; yalnız açılışta imzayı doğrular ve geçersizse uç 204 döner + açılış logunda uyarı (sunucu ele geçirilse bile istemci kendi doğrular). Uç kimliksizdir, IP başına 60/sa hız sınırlıdır (entegrasyon). |

### 5.2 İstemcide doğrulama (tüm platformlar)

| AC     | Kriter |
| ------ | ------ |
| AC-474 | İstemci yalnız şu koşulların **hepsi** sağlanırsa kurar: manifest imzası gömülü açık anahtarlardan biriyle geçerli; `env`, `platform`, `arch`, `component` kendisiyle eşleşiyor; `expiresAt` geçmemiş; `version` > çalışan sürüm (semver); indirilen dosyanın SHA-256'sı ve boyutu manifestle aynı. Biri sağlanmazsa dosya diske kalıcı yazılmaz/silinir ve kurulmaz (Go birim testi: her koşul için ayrı negatif fikstür — 8 vaka, hepsinde kurulum sayacı 0). |
| AC-475 | Düşürme engeli: manifest sürümü çalışan sürüme eşit veya küçükse kurulmaz; istemci gördüğü en yüksek geçerli manifest sürümünü yerelde saklar ve daha düşük sürümlü (eski ama hâlâ süresi dolmamış) imzalı manifesti "yeniden oynatma" olarak reddeder (Go birim testi: 0.23.0 görülmüşken 0.22.5 manifesti → `DOWNGRADE`). |
| AC-476 | Platform imzası: çalışan ikili platform imzalıysa (Windows Authenticode `WinVerifyTrust` geçerli; macOS Developer ID + notarization `spctl` geçerli), yeni ikili de **aynı yayıncı/Team ID** ile geçerli imzalı olmalıdır; imzasız veya farklı yayıncılı ikili `PLATFORM_SIGNATURE` nedeniyle reddedilir. Çalışan ikili imzasızsa (bugünkü durum, §8 R-P29-1) yalnız manifest doğrulaması uygulanır (Go birim testi: imzalı→imzasız ret; imzasız→imzasız manifest geçerliyse kabul). |
| AC-477 | İndirme yalnız HTTPS ile, istemcinin gömülü sunucu adresinden (veya manifestte aynı köken altındaki yoldan) yapılır; yönlendirme başka kökene giderse iptal. İndirme ≤ 2 kat manifest boyutunu aşarsa kesilir. İndirme geçici dosyaya, yalnız kullanıcının/servisin erişebildiği konuma yapılır (servis: ACL'li `%ProgramData%\NoktaDestek Servis\`, P27 Y-P27-2 klasör kuralı) (Go birim + Windows elle). |
| AC-478 | Denetim sıklığı: açılışta 1 kez + çalışırken 24 saatte 1 (± 2 sa rastgele sapma); 200 istemcinin aynı dakikada denetlemesi beklenmez. Ağ hatasında sessizce sonraki döneme bırakılır; kullanıcıya hata penceresi gösterilmez (Go birim: sahte saat). |

### 5.3 Kurulum davranışı

| AC     | Kriter |
| ------ | ------ |
| AC-479 | Hiçbir istemci, açık oturum (katılımlı, gözetimsiz bağlantı, PENDING bağlantı, bekleyen destek talebi) varken ikiliyi değiştirmez veya yeniden başlamaz. Oturum sürerken bulunan sürüm indirilir-doğrulanır, kurulum oturum bitince yapılır. Kurulum sürerken gelen gözetimsiz bağlantı isteği sunucuda 409 `DEVICE_UPDATING` alır ve panelde "Cihaz güncelleniyor, birazdan tekrar deneyin" görünür; step-up tüketilmez (entegrasyon + Go birim). |
| AC-480 | Servis (A): kurulum sonrası yeni servis ≤ 60 sn içinde sunucuya `device.auth` ile bağlanıp yeni sürümü bildirmezse veya açılışta çökerse eski ikiliye otomatik dönülür, servis eski sürümle ≤ 2 dk'da tekrar çevrimiçi olur ve `client.update.rolled_back` bildirilir. Aynı sürüm 24 sa içinde yeniden denenmez (Windows elle: kasıtlı bozuk sağlık denetimli test sürümü). |
| AC-481 | Servis (A) kurulumunda cihaz kimliği (DPAPI anahtarı), kayıt, yerel kapatma anahtarı durumu (AC-295), servis ACL'leri ve Uninstall kaydı (`DisplayVersion` yeni sürüm) korunur; cihaz panelde yeni kayıt olarak görünmez, grant'lar değişmez (Windows elle + entegrasyon: aynı `deviceId`). |
| AC-482 | Taşınabilir istemcilerde (B, C, D) yeni ikili **aynı yol ve aynı adla** yerleştirilir (dosya adındaki ref/kod, macOS klasör adı korunur); çalıştırma izni (Linux `u+x`) korunur; değiştirme atomiktir (yarım dosya kalmaz). Yeni sürüm bir sonraki açılışta çalışır; çalışan süreç kendini yeniden başlatmaz. Kullanıcıya ana ekranda bir kez "Yeni sürüm (<x.y.z>) hazır — programı sonraki açışınızda kullanılacak" gösterilir (Go birim + üç platformda elle). |
| AC-483 | Taşınabilir istemcinin bulunduğu konum yazılamıyorsa (salt okunur, ağ/çıkarılabilir sürücü, macOS App Translocation) dosya değiştirilmez; ana ekranda "Yeni sürüm var — indirme bağlantısından yeni sürümü alın" ve tenant'ın mevcut indirme bağlantısı gösterilir; olay `skipped(reason=NOT_WRITABLE)` olarak bildirilir. Yan klasöre kopya bırakılmaz (K-P20-2, AV riski) (Go birim + Windows elle). |
| AC-484 | Taşınabilir istemcide güncelleme iz bırakmama kuralını bozmaz: indirme geçici dosyası kurulumdan veya ret sonrasında silinir; AC-108/AC-289 iz testi güncelleme senaryosunda da geçer (yalnız değiştirilen ikili + mevcut kayıt dosyaları kalır). |

### 5.4 Politika

| AC     | Kriter |
| ------ | ------ |
| AC-485 | Admin Ayarlar → İstemciler altında tek anahtar "İstemcileri otomatik güncelle" vardır, varsayılan **Açık**. Kapalıyken tenant'a bağlı istemciler (gözetimsiz servis, kayıtlı bilgisayar, müşteri dosyası) yeni sürümü indirmez/kurmaz, yalnız `available` bildirir ve panelde "Güncelleme bekliyor" görünür. Değişiklik step-up gerektirmez, audit'e eski→yeni yazılır, istemciye bir sonraki denetimde (≤ 24 sa; servis için açık WS'te ≤ 60 sn) yansır (entegrasyon + e2e). |
| AC-486 | `MIN_AGENT_VERSION` ile ilişki: politika kapalı olsa da çalışan sürüm `MIN_AGENT_VERSION`'dan düşükse mevcut 426 `CLIENT_OUTDATED` / 409 `DEVICE_OUTDATED` aynen uygulanır (P29 bu kuralı değiştirmez); panelde ilgili cihaz "Asgari sürümün altında" kırmızı rozetle görünür (entegrasyon). |

### 5.5 Ana sisteme bildirim, audit, panel

| AC     | Kriter |
| ------ | ------ |
| AC-487 | İstemci şu durum değişimlerini sunucuya bildirir: `available` (yeni sürüm bulundu, sürüm başına 1 kez), `installed` (eski→yeni), `failed` (neden kodu: `DOWNLOAD`, `HASH_MISMATCH`, `MANIFEST_SIGNATURE`, `PLATFORM_SIGNATURE`, `DOWNGRADE`, `EXPIRED`, `ENV_MISMATCH`, `INSTALL`), `rolled_back`, `skipped` (`POLICY_OFF`, `NOT_WRITABLE`). Periyodik "denetledim, güncelim" olayı audit'e **yazılmaz**, yalnız metrik `rs_agent_update_total{platform,component,result}` artar. Gönderilemeyen olay yerelde kuyruklanır (≤ 20 olay) ve sonraki bağlantıda gönderilir (Go birim + entegrasyon). |
| AC-488 | Kimlik ve tenant: gözetimsiz servis olayı cihaz anahtarıyla (`device.auth`), kayıtlı bilgisayar/müşteri dosyası olayı kayıt (binding) anahtarıyla kimlik doğrulanır ve ilgili tenant'ın audit'ine `client.update.available/installed/failed/rolled_back/skipped` olarak yazılır (`entity`=cihaz/kayıt, eski→yeni sürüm, neden kodu, IP). Kimliksiz (Genel bağlantı, kayıtsız) istemcinin olayı audit'e yazılmaz, yalnız metriğe girer. Kimlikli istemci başına 10 olay/sa, IP başına 30 olay/sa sınırı; fazlası 429 ve yazılmaz (entegrasyon: sahte olay seli). |
| AC-489 | Doğrulama reddi (`MANIFEST_SIGNATURE`, `PLATFORM_SIGNATURE`, `DOWNGRADE`, `HASH_MISMATCH`, `ENV_MISMATCH`) güvenlik olayıdır: audit satırı `result=fail` ile yazılır, `rs_agent_update_rejected_total{reason}` artar ve runbook'ta "≥ 1 imza reddi → inceleme" alarm notu bulunur. Gözetimsiz servis ayrıca Windows olay günlüğüne yazar (AC-273 kalıbı). |
| AC-490 | Gözetimsiz cihaz listesinde "Sürüm" sütunu ve rozet vardır: "Güncel" / "Güncelleme bekliyor" / "Güncelleniyor" / "Güncelleme başarısız (<neden>)" / "Asgari sürümün altında". Sayfanın üstünde sürüm dağılımı özeti (sürüm → cihaz sayısı, platform ayrımıyla) bulunur; tıklayınca liste o sürüme süzülür. Super Admin aynı özeti tüm tenant'lar için görür. Başka tenant'ın verisi görünmez (IDOR testi 404). 5 durum, iki tema, AC-287 (e2e). |
| AC-491 | Audit Log ekranında "İşlem" filtresinde `client.update.*` olayları Türkçe etiketle ("İstemci güncellendi", "İstemci güncellemesi başarısız", "Güncelleme reddedildi (imza)" …) görünür; ham anahtar görünmez (e2e). |

### 5.6 Yayın sırası ve P27 etkileşimi

| AC     | Kriter |
| ------ | ------ |
| AC-492 | `UNATTENDED_MODE=signed` iken sunucu, yeni servis ikilisinin SHA-256'sı `UNATTENDED_SIGNED_SHA256` listesinde yoksa o servis manifestini **sunmaz** (uç 204) ve açılış logunda "manifest sürümü SHA listesinde yok" uyarısı verir; böylece güncellenen servis listede olmayan hash bildirip kilitlenmez. Runbook yayın sırası: (1) SHA listesine yeni hash eklenir, (2) sunucu yeniden başlatılır, (3) manifest yayınlanır, (4) tüm cihazlar geçince eski hash çıkarılır (entegrasyon: listede olmayan hash → 204). |
| AC-493 | Uyum: 0.22.0 sunucu güncelleyicisiz istemcilerle (≤ 0.21.x) aynen çalışır; 0.22.0 istemci güncelleme ucu olmayan eski sunucuda (404) sessizce güncellemesiz çalışır. 0.22.0'dan itibaren her sürümde güncelleyici bulunur; yayından önce staging'de **0.22.0 → 0.22.1 tam tur** (servis + üç taşınabilir platform) elle doğrulanır ve test raporuna yazılır (test-operatoru). Kılavuz, DATASHEET, CHANGELOG, runbook güncel (AC-288). |

## 6. Fonksiyonel olmayan gereksinimler

- **Güvenlik:** tek güven kökü bugün manifest Ed25519 anahtarıdır (platform imzası yok, §8). Doğrulama istemcide yapılır; sunucuya
  güvenilmez. Fail-closed: şüphede kurulmaz. Yeni ADR + güvenlik tasarım turu (tehdit modeli: sahte sunucu, ele geçirilmiş sunucu,
  ele geçirilmiş CI, yeniden oynatma, düşürme, servis klasörüne yerel yazma, TOCTOU — doğrulanan dosya ≠ kurulan dosya).
- **Performans:** denetim isteği ≤ 2 KB; indirme yalnız oturum yokken; servis kurulum kesintisi ≤ 30 sn (sağlık denetimi hariç).
  200 cihazın aynı gün güncellenmesi sunucu indirme bant genişliğini ≤ %50 doldurur (24 sa sapma, AC-478).
- **Gözlemlenebilirlik:** `rs_agent_update_total`, `rs_agent_update_rejected_total`, sürüm dağılımı gauge'u; JSON log'da manifest
  yayınlandı/reddedildi.
- **Yerelleştirme / a11y:** istemci ve panel metinleri TR, tek ileti tablosu; rozetler yalnız renkle değil metinle.
- **Lisans:** yeni bağımlılık gerekiyorsa (ör. Go güncelleyici kitaplığı) mimari §10.4 dışındaysa gerekçelenir; AGPL/GPL yasak.
- **Veri saklama:** `client.update.*` audit satırları mevcut audit saklama süresine tabidir; kişisel veri içermez (IP hariç, mevcut kural).

## 7. Varsayımlar

- **V-P29-1** Tüm yerel istemciler kapsamdadır (Windows servis + Windows/macOS/Linux taşınabilir); kullanıcı "ajanlar" dedi, proje içinde
  `clientKind=AGENT` hepsini kapsar. Asıl öncelik gözetimsiz servistir.
- **V-P29-2** Taşınabilir istemcide yeni sürüm **sonraki açılışta** devreye girer; çalışan süreç kendini yeniden başlatmaz (oturum
  kesintisi ve "program kendiliğinden kapandı" şaşkınlığı olmaz). Tepside ve tek seferlik çalışmada aynı kural (sadelik).
- **V-P29-3** Politika **tenant düzeyinde tek anahtar** (Açık/Kapalı). "Yalnız bildir" ayrı seçenek değildir: Kapalı = yalnız bildir.
  Tenant'ı bilinmeyen kimliksiz istemci (Genel bağlantı, kayıtsız) her zaman günceller (sistem varsayılanı Açık).
- **V-P29-4** Linux'ta yerinde ELF değiştirme seçilir (kurulum yok, root yok; ADR-0038 tek dosya ilkesi). Mimar aksini seçerse kullanıcı
  açısından fark yalnız "kendiliğinden / indirme bağlantısıyla" olur; bildirim aynı kalır.
- **V-P29-5** Güven kökü Ed25519 manifest imzasıdır (platform imzası beklenmez, çünkü yoktur). Bu, mimari-e11 §8d.13'teki "imza olmadan
  güvenli değil" kaygısını kendi imzamızla karşılar; Authenticode/notarization geldiğinde AC-476 ek kapı olarak devreye girer.
- **V-P29-6** Kimliksiz istemci olayları audit'e yazılmaz (sahte olay ve tenant belirsizliği); yalnız metrik. Kullanıcının "ana sisteme
  log" isteği kimlikli cihazlar (servis, kayıtlı bilgisayar) için audit ile, kalanı için metrik/dağılımla karşılanır.
- **V-P29-7** Downgrade yoktur; hatalı sürüm daha yüksek numaralı düzeltmeyle geri alınır (ör. 0.22.1 bozuksa 0.22.2 = 0.22.0 kodu).
- **V-P29-8** Manifest en çok 90 gün geçerlidir; uzun süre yayın yoksa CI aynı sürümü yeniden imzalayabilir (sürüm artmaz, `issuedAt` artar).
- **V-P29-9** İstemciye **iki** açık anahtar yuvası gömülür (etkin + yedek) ki anahtar rotasyonu bir güncelleme turuyla yapılabilsin;
  yedek anahtar çevrimdışı saklanır (runbook).
- **V-P29-10** Güncelleme ikilisi mevcut indirme yolundan (`/data/downloads`, Caddy) sunulur; yeni depolama yolu açılmaz.
- **V-P29-11** Bakım penceresi yok; servis yalnız açık bağlantı yokken kurar ve kesinti saniyeler sürer (sunucunun kendisi yeniden başlamaz).
- **V-P29-12** Yeni yetki anahtarı yok: politika `settings.edit` (mevcut tenant ayarı yetkisi), liste/dağılım `unattended.view` ile görünür.

## 8. Riskler ve açık sorular

### Mevcut imza durumu (2026-11-19, docs/runbook §24.3, §28f.3)

- **Windows:** SignPath hesabı **yok** → istemci ve servis Authenticode imzasız (ADR-0010). Prod'da gözetimsiz erişim `UNATTENDED_MODE=off`.
- **macOS:** Apple Developer hesabı **yok** → `sign-mac` hiç koşmadı; Release'e macOS zip'i yalnız ad-hoc/TEST olarak girer.
- **Linux:** tasarım gereği imzasız (ADR-0038 m.11).
- Sonuç: AC-476 bugün her platformda "uygulanamaz" dalındadır; tek koruma manifest imzasıdır.

| #        | Risk | Etki | Önlem | Sahibi |
| -------- | ---- | ---- | ----- | ------ |
| R-P29-1  | Platform imzası yok; manifest anahtarı tek güven kökü — sızarsa tüm istemcilere zararlı kod dağıtılabilir | Kritik | Anahtar yalnız onaylı ortam secret'ı (AC-471), etiket ruleset'i, yedek anahtar ve rotasyon (V-P29-9), attestation, alarm (AC-489), güvenlik tasarım turu | devops + guvenlik |
| R-P29-2  | İmzasız exe'nin kendi dosyasını değiştirmesi AV/EDR tarafından "dropper" sayılabilir (R30) | Yüksek | Yan kopya yok (AC-483), AV kapısı (§8d.8) güncelleme senaryosuyla tekrar; WDSI bildirimi | devops |
| R-P29-3  | Servis güncellemesi `signed` kipte SHA listesi dışına çıkıp cihazı kilitler | Yüksek | AC-492 sunucu kapısı + runbook sırası | devops |
| R-P29-4  | Bozuk sürüm servisleri çevrimdışı bırakır; uzaktan düzeltilemez | Yüksek | Sağlık denetimi + otomatik geri dönüş (AC-480); önce staging tam tur (AC-493) | backend-dev (Go) |
| R-P29-5  | ≤ 0.21.x istemciler güncelleyici içermez; son bir elle kurulum şart | Orta | Kılavuz + "Müşteriye gönder" ile yeni bağlantı; `MIN_AGENT_VERSION` zamanlaması | teknik-yazar + devops |
| R-P29-6  | macOS'ta paket değişince TCC (Ekran Kaydı/Erişilebilirlik) izni düşebilir; ad-hoc imzada izin kimliği her derlemede değişir | Orta | Mimar doğrular; düşüyorsa macOS'ta "yalnız bildir" dalı (AC-483 metni) seçilir | mimar |
| R-P29-7  | Staging manifesti prod istemciye veya tersi | Yüksek | Ortama özel anahtar + `env` alanı (AC-472) | guvenlik |
| R-P29-8  | Ele geçirilmiş sunucu eski imzalı manifesti yeniden sunar | Orta | Son geçerlilik + görülen en yüksek sürüm (AC-475) | guvenlik |
| R-P29-9  | Doğrulanan dosya ile kurulan dosyanın farklı olması (TOCTOU), servis geçici klasörüne yerel yazma | Yüksek | Doğrulama kurulumla aynı tutamaçta / ACL'li klasör (AC-477); tasarım turunda ele alınır | mimar + guvenlik |
| R-P29-10 | Paralel P22-G paketiyle `apps/agent-win` ve audit etiket tablosunda çakışma | Düşük | Dosya sınırları mimaride ayrılır; AC numaraları ayrık | mimar |

### Açık sorular (şimdilik varsayımla ilerlenir)

| #       | Soru | Varsayılan | Sahibi |
| ------- | ---- | ---------- | ------ |
| S-P29-1 | Politika tenant'ta mı, yalnız sistemde (Super Admin) mi olsun? | Tenant tek anahtar (V-P29-3) | kullanıcı |
| S-P29-2 | Gözetimsiz servis için bakım penceresi gerekli mi? | Hayır, Sonra (V-P29-11) | kullanıcı |
| S-P29-3 | Kademeli yayın / beta kanal istenir mi? | Hayır, Sonra | kullanıcı |
| S-P29-4 | Cihaz bazında "güncelleme yapma" (pin) istenir mi? | Hayır, Sonra | kullanıcı |
| S-P29-5 | Taşınabilir istemci yeni sürümü hemen yeniden başlayarak mı kullansın? | Hayır, sonraki açılış (V-P29-2) | kullanıcı |
| S-P29-6 | SignPath / Apple Developer başvurusu yapılacak mı (R-P29-1'i hafifletir)? | Bilinmiyor; P29 bunlarsız ilerler | kullanıcı |

## 9. Kontrol listesi kararları

| Madde | Karar | Gerekçe |
| ----- | ----- | ------- |
| 1. Kimlik / API anahtarları | Kapsamda: manifest imza anahtarı (rotasyon, yedek), cihaz/kayıt anahtarıyla olay kimliği | AC-471, 488, V-P29-9 |
| 1. Yetkilendirme / IDOR | Kapsamda: dağılım ve liste tenant kapsamlı, başka tenant 404; yeni yetki yok | AC-490, V-P29-12 |
| 1. Oturum | Kapsamda: oturum sırasında güncelleme yok | AC-479 |
| 5. 5 durum / a11y / tema | Kapsamda: liste, dağılım, ayar ekranı | AC-490 |
| 5. Yıkıcı işlem | Konu dışı: kullanıcı tetiklemez; geri dönüş otomatik | AC-480 |
| 5. Bildirim | İstemcide tek bilgi satırı; e-posta/WhatsApp yok (Sonra: başarısız güncelleme e-postası) | AC-482, Sonra |
| 5. Çevrimdışı / yavaş ağ | Sessiz erteleme, olay kuyruğu | AC-478, 487 |
| 5. Yerelleştirme | TR, tek ileti tablosu | §6 |
| 8. KVKK | Yeni kişisel veri yok (sürüm/hash); IP mevcut audit kuralıyla | §6 |
| 8. Lisans | Yeni bağımlılık gerekçeli, AGPL/GPL yasak | §6 |
| 9. Kapsam dışı | 10 madde (§3.3) | — |
| 9. Ölçülebilir AC | AC-470..493 (24) | — |
| 9. Riskler / sorular | R-P29-1..10, S-P29-1..6 | §8 |
| Sonra | Kademeli yayın/kanal, pin, bakım penceresi, "şimdi güncelle" düğmesi, başarısız güncelleme e-postası, delta güncelleme | Unutulmasın diye |

## 10. Mevcut olanlar (çift iş yok)

| Mevcut | P29'un eklediği |
| ------ | --------------- |
| `UnattendedDevice.agentVersion` (her `device.auth`'ta güncellenir, detay sayfasında görünür), `binarySha256`, `signed` | Liste sütunu, durum rozeti, dağılım özeti (AC-490); yeni alan gerekiyorsa dba |
| `DeviceBinding.clientVersion`, `SupportRequest.clientVersion` | Kayıtlı bilgisayar olaylarının audit'i (AC-488); dağılımda yalnız kimlikli kayıtlar |
| `AGENT_* / MAC_AGENT_* / LINUX_AGENT_* / UNATTENDED_AGENT_*` PATH+SHA256, Caddy indirme uçları | Aynı dosyalar güncelleme ikilisi olarak kullanılır (V-P29-10); yalnız manifest ucu eklenir (AC-473) |
| Release + SHA256SUMS + attestation, `agent-sign` / `agent-mac-sign` ortam kalıbı | Manifest imza işi aynı kalıpta (AC-470, 471) |
| `MIN_AGENT_VERSION` → 426 / AC-435 `DEVICE_OUTDATED` | Değişmez (AC-486); P29 bu kilide düşmeyi önler |

## 11. Tersine çevrilen / değişen kararlar (yeni ADR'de kayda geçmeli)

| Karar | Eski | P29 |
| ----- | ---- | --- |
| mimari-e11 §8d.13 | "Otomatik güncelleme yok (imza olmadan güvenli değil); SignPath sonrası ayrı ADR" | SignPath beklenmeden kendi Ed25519 manifest imzasıyla; ayrı ADR yine zorunlu (V-P29-5) |
| mimari-p27 §1 | "Otomatik güncelleme: Sonra (yeni sürüm elle kurulur)" | Servis kendini günceller (AC-480, 481) |
| mimari-p28f §1 kapsam dışı | macOS otomatik güncelleme yok | Kapsamda (AC-482/483, R-P29-6) |
| ADR-0010 | İmzasız, elle dağıtım | İmzasız kalır; güncelleme bütünlüğü manifest imzasıyla |
| K-P20-2 | Exe kopyalanmaz | Yan kopya yine yok; yalnız aynı yolda yerinde değiştirme (AC-482/483) |
