# Test Raporu — Tur P12 (marka ve kişiselleştirme: logo, avatar, tema, hesap menüsü)
DURUM: GEÇTİ (ENGELLEYİCİ/YÜKSEK yok; P12 AC'lerinin hepsi ✅, gerçek server ile de doğrulandı; 1 ORTA + 1 DÜŞÜK bulgu var, P13'ten önce düzeltilmesi önerilir)

Ortam: YEREL, iki düzenek kullanıldı.
- **(A) Sahte API:** üretim derlemesi `:3217` ve `e2e/mock-api.mjs` `:4217`. Mevcut e2e takımı burada koşuldu.
- **(B) Gerçek server:** `docs/test-raporu/e2e/p12/setup.sh` ile kuruldu.
  - Geçici MySQL `rs-mysql-p12op:33356` (migrate ve seed yapıldı).
  - `apps/server` `:3333`, `UPLOADS_DIR` geçici klasörde. Web standalone `:3258`.
  - `APP_ENCRYPTION_KEYS`, `TURN_SECRET` ve bütün parolalar koşu başına rastgele üretildi; hiçbiri repoya veya ekrana yazılmadı.

Kod: `main` d359a8d ve çalışma ağacı (P12 commit edilmemiş). Tarih: 2026-11-13. Staging'e bağlanılmadı, ACCESS.txt okunmadı, kod
değiştirilmedi. Ortam kapatıldı: server, web ve mock durduruldu, DB konteyneri silindi; geçici sır klasörü, storageState ve
yüklenen dosyalar silindi.

Betikler `docs/test-raporu/e2e/p12/` altında: `setup.sh`, `common.mjs`, `totp.mjs`, `real-flow.mjs` (R1–R19), `real-scan.mjs`.
Sonuçlar: `real-flow.jsonl` (son koşu), `real-flow-tur1..4.jsonl` (betik düzeltmesinden önceki denemeler), `real-scan.jsonl`.
Ekran görüntüleri `img/` altında (160 adet).

## Özet
| Ölçüt | Değer |
|---|---|
| Mevcut e2e takımı (desktop + mobile) | **262 geçti, 0 kaldı**, 106 atlandı (tasarım gereği). `p12-branding.spec.ts` ve P1–P11 regresyonu dahil |
| Gerçek server taraması | Super Admin 14, Admin 14 ve oturumsuz 6 rota; açık/koyu, 1280/390 px: **136 görünüm**. Ayrıca hesap menüsü açıkken 8 görünüm |
| Açılamayan sayfa / 5xx | 0 / 0. Yalnız bilinçli `/yok-boyle-sayfa` 404 verdi ve 404 sayfası düzgün |
| JS hatası / konsol hatası | 0 / 0 (kasıtlı 404 rotasındaki ağ satırı hariç) |
| Server logu error/fatal | 0. 1 warn var: Windows istemcisi yapılandırılmamış (yerel ortam) |
| axe (WCAG 2.1 AA) | 136 görünüm, 8 açık menü görünümü ve kırpma diyaloğu: **0 ihlal** |
| Yatay taşma (1280/390) | 0 |
| Kırık iç link | 0 (32 farklı iç bağlantı) |
| > 3 sn açılan | 0 (en yavaş 0,89 sn) |
| Gerçek server akışı | 20 adımın 20'si geçti (son koşu). İlk 3 koşudaki "kaldı"lar betik hatasıydı, bkz. Bilgi B-1 |
| P11 Bulgu 1 (Super Admin audit 1280 px taşması) | **Giderildi.** Kap `relative`, tablo 974 px içinde, `scrollWidth=1280` |

## Bulgular (öncelik sırasıyla)

### [ORTA] Logo yüklemede boyut/oran reddi yanlış mesajla gösteriliyor: geçerli PNG'ye "Yalnız PNG, JPG veya WEBP" deniyor
Sayfa/akış: `/settings/logo`. Aynı yükleyici bileşeni `/admin/settings/system-logo` sayfasında da var.
Adımlar: 1. Admin ile `/settings/logo` açın. 2. 3000×40 px geçerli bir PNG seçin; önizleme görünür. 3. "Logoyu kaydet"e basın.
(8×8 px PNG ile de aynı sonuç alınıyor.)
Beklenen: Sunucunun döndürdüğü gerçek neden gösterilir: "Resim boyutları uygun değil: her kenar en az 16 px, en-boy oranı logoda
en çok 20:1…". İdeali, oran ve kenar sınırı önizleme sırasında istemcide denetlenip kaydetmeden önce söylenmesi.
Gerçekleşen: Sunucu `400 INVALID_IMAGE` ve doğru açıklamayı dönüyor (API ile doğrulandı). Arayüz ise `INVALID_IMAGE` koduna sabit
"Yalnız PNG, JPG veya WEBP resim yükleyebilirsiniz." metnini basıyor. Kullanıcı elinde zaten PNG olduğu için ne yapacağını
bilemiyor; dosya biçimini değiştirip tekrar dener.
Avatar akışı bundan etkilenmiyor, çünkü kırpma her resmi kareye çeviriyor (3000×40 kırpılıp kaydedildi). Avatar API'si aynı
durumda aynı kodu dönüyor.
Kanıt: `docs/test-raporu/e2e/p12/img/r-logo-extreme.png`, `real-flow.jsonl` adım "R12b" (uiHata ile api mesajı karşılaştırması).
Öneri: `INVALID_IMAGE` için sunucunun `message` alanı gösterilsin. Ya da sunucu boyut reddini ayrı bir alt kodla dönsün
(ör. `fields.file` veya `reason: "dimensions"`). Ek olarak önizleme sırasında `naturalWidth/Height` ile istemcide ön denetim yapılsın.
Atanan: frontend-dev (gerekirse sözleşme için backend-dev)

### [DÜŞÜK] "Hesabım" sayfasının başlığı hâlâ "Hesap güvenliği"
Sayfa: `/account`. Hesap menüsündeki bağlantının adı "Hesabım"; sayfa artık Profil (avatar) ve Görünüm (tema) bölümlerini de
içeriyor. Buna karşın `h1`, sekme başlığı ve breadcrumb "Hesap güvenliği" diyor.
Adımlar: 1. Üst menüde avatara tıklayın. 2. "Hesabım"ı seçin.
Beklenen: Başlık menüyle tutarlı olmalı ("Hesabım"); güvenlik bölümü sayfanın bir alt başlığı olarak kalabilir.
Kanıt: `img/s-dark-390-ad-account.png`, `img/s-dark-1280-ad-menu.png`. Atanan: frontend-dev

### Bilgi (bulgu değil)
- **B-1 Test düzeneği:** Seed'den gelen Super Admin'in ilk girişinde akış sırası `/change-password` → `/` → `/2fa/setup` şeklinde.
  Arada kısa bir `/` geçişi var. İlk betik bu ara durağı "giriş bitti" sanıyordu; bu yüzden 1–3. koşularda R1/R3/R5/R9/R18
  "kaldı" göründü. Betik düzeltildi; kullanıcı açısından sorun yok (son ekran doğru: 2FA kurulumu).
- **B-2:** `rs_theme` çerezi yerelde `Secure=false` geldi. Ortam `http` ve kod `secure` bayrağını koşula bağlıyor; prod'da
  (`https`) doğrulanmalı. Çerez `httpOnly=false` (ilk boyama betiği okuyor, tasarım gereği), `SameSite=Lax`.
- **B-3:** Firma ve sistem logoları herkese açık sunuluyor (`Cache-Control: public, max-age=300`, oturumsuz istek 200). Login ve
  müşteri sayfası için tasarım gereği. Avatarlar oturumlu (`private, no-cache`); oturumsuz istek 401, başka tenant 404.
- **B-4:** CSV'nin UTF-8 BOM'u tarayıcıdaki `fetch().text()` ile doğrulanamadı (metin okuması BOM'u siliyor). Formül kaçışı
  gerçek veriyle doğrulandı.
- **B-5:** 390 px'te üst bardaki ürün adı "Nokta Uzaktan Des…" diye kısalıyor. Taşma yok, bilgi amaçlı.

## Akış sonuçları (gerçek server: `real-flow.jsonl`)
| # | Akış | Sonuç | Not |
|---|---|---|---|
| R1 | Super Admin ilk giriş: şifre değiştir → 2FA kur → panel | ✅ | |
| R2 | Audit PUT/DELETE/PATCH/POST → 405 | ✅ | 5 çağrının 5'i 405 (P11'den kalan) |
| R3 | Audit CSV gerçek veriyle: formül kaçışı | ✅ | Kullanıcı adı `=hyperlink("http://x")` → hücre `'=hyperlink(...)`. `text/csv`, `attachment`, 154 satır, kaçışsız formül hücresi 0 |
| R4 | `/audit` Super Admin 1280/390 | ✅ | 50 satır, taşma yok, axe 0 |
| R5 | İkinci firma + USER (başka tenant) | ✅ | 201/201 |
| R6 | Admin ilk giriş + 2FA, `/account` Profil/Görünüm | ✅ | Baş harf avatarı "E1" |
| R7 | Avatar reddi (sunucu): SVG, SVG içerikli `.png`, metin `.png`, 2 MB+, GIF | ✅ | 400 INVALID_IMAGE ×4, 413 PAYLOAD_TOO_LARGE |
| R8 | Avatar UI: EXIF'li JPEG → kırp → kaydet → üst menüde | ✅ | Dosya `image/webp` 256×256, EXIF yok (aranan dize de yok), rastgele ad, tenant klasörü, `private, no-cache`; kırpma diyaloğunda axe 0 |
| R9 | Avatar dosyası: başka tenant kullanıcısı / Super Admin / oturumsuz | ✅ | 404 / 200 / 401. Kendi tenant'ının yoluyla tahmin de 404 |
| R10 | Avatar WEBP 200, uç oran API'de reddedildi, kaldırınca eski dosya 404 | ✅ | |
| R11 | Avatar UI uç oranlı resim (3000×40) | ✅ | Kırpma kare üretti, kaydedildi |
| R12 | Logo UI: EXIF'li JPEG 1600×400 → önizle → kaydet → üst menü | ✅ | `image/png` 512×128, EXIF yok; `/login?tenant=demo` → firma logosu; `/login` → sistem logosu; `/api/v1/public/branding` doğru |
| R12b | Logo uç oran / 8 px | ⚠️ | Reddediliyor (doğru) ama mesaj yanlış: Bulgu 1 |
| R13 | Logo SVG (`<script>`) ve sahte uzantı (PDF içerik) | ✅ | 400/400 |
| R14 | Müşteri sayfası `/session/[token]` firma logosu | ✅ | `data-logo=custom`, resim yüklendi |
| R15 | Logo kaldır → sistem logosu, eski dosya 404 | ✅ | |
| R16 | Tema: menüden Koyu → PATCH 200 + `rs_theme=dark`; ilk HTML `class="dark"`; DB `DARK`; çerezsiz başka cihazda girişte koyu | ✅ | İlk boyamada doğru sınıf, flaş yok |
| R17 | Profilden Sistem → `html` sınıfsız, DB `SYSTEM` | ✅ | |
| R18 | Super Admin sistem logosu (WEBP) → `/login`'de yeni sistem logosu | ✅ | |
| R19 | Audit: marka olayları yazılıyor | ✅ | `user.avatar_updated/removed`, `tenant.logo_updated/removed`, `user.theme_changed`, `settings.system_logo.updated` |
| — | Hesap menüsü klavye: aç → Esc kapatır, odak tetikleyiciye döner | ✅ | 8 görünümün 8'i |
| — | Oturumsuz `/audit`, `/settings/logo` → `/login?next=…` | ✅ | |
| — | Admin `/admin/settings/system-logo` → yetkisiz durumu | ✅ | Ekranlar `s-*-ad-admin_settings_system_logo.png` |
| — | reduced-motion, menü ikonları, oturumsuz login tema çerezi, tema kaydı 500 → geri alma, B-P12-1 IP iletimi | ✅ | e2e (sahte API) |

## Kabul kriterleri (uçtan uca)
| AC | Durum | Nasıl doğrulandı |
|---|---|---|
| AC-81 tenant logosu yükle/değiştir/kaldır (önizlemeli); üst menü, karşılama sayfası; kaldırınca sistem logosu | ✅ | Gerçek server R12, R14, R15 ve e2e. E-posta ve Windows istemcisinde görünüm bu turda denenmedi |
| AC-82 login'de her zaman logo (tenant ise tenant, değilse sistem); Super Admin sistem logosu | ✅ | R12, R18, tarama (`/login?tenant=demo`, `yok-firma`) ve e2e |
| AC-83 avatar kare kırpma önizlemeli yükle/kaldır, yoksa baş harf | ✅ | R6, R8, R10, R11 ve e2e |
| AC-84 magic bytes, SVG/sahte uzantı reddi, 2 MB, 512/256 px, EXIF silme, rastgele ad, tenant klasörü, başka tenant 404 | ✅ | R7, R8, R9, R12, R13 |
| AC-85 tema Açık/Koyu/Sistem, menü ve profil, DB, başka cihaz, flaş yok | ✅ | R16, R17 ve e2e |
| AC-86 favicon | ✅ (regresyon) | e2e |
| AC-87 ikonlar, token lint, reduced-motion | ✅ | e2e (ikon ve reduced-motion), lint kuralı birim testi |

## Görsel gözlemler (ekran görüntülerinden)
- `s-dark-1280-ad-menu.png`: Hesap menüsünde başlık, Hesabım, Şifre değiştir, Tema (üç seçenekli grup, seçili olan vurgulu)
  ve Çıkış var; ikonlar anlamlı. Koyu temada logo beyaz zeminli bir kart içinde (std. 1.6).
- `s-dark-390-ad-account.png`: Profil, Görünüm, Şifre, 2FA ve Oturumlar kartları tek sütunda, taşma yok. Başlık sorunu
  Bulgu 2'de.
- `s-dark-390-anon-login_tenant_demo.png`: Koyu temada login logosu açık zeminli kart içinde, okunaklı.
- `r-logo-extreme.png`: Önizlemede uç oranlı logo ince bir çizgi gibi görünüyor ve yanlış hata mesajı çıkıyor (Bulgu 1).
- Koyu tema ve 390 px'te audit, ayarlar ve sistem ayarları ekranları okunaklı; kontrast sorunu yok (axe 0).
