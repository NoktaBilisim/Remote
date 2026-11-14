# Test Raporu — P13a (Tur 1)
DURUM: GEÇTİ
Ortam: yerel üretim derlemesi (Next standalone, http://localhost:3217) + sahte API (`apps/web/e2e/mock-api.mjs`, :4217); `main` @ 0f06d7d + commit edilmemiş P13a değişiklikleri; 2026-11-14. Staging'e bağlanılmadı, dind kullanılmadı.

## Tam e2e paketi (son değişiklikten sonraki ilk koşu)
`pnpm --filter @remote/web e2e` (playwright.config.ts, üretim derlemesi + mock): **305 geçti, 120 atlandı, 0 hata** (1,3 dk).
Atlananlar, spec içinde bilinçli olarak tanımlanmış proje filtreleri (`desktopOnly`, mobil/masaüstüne özel akışlar). @perf: AC-41 FPS medyanı 30; AC-57 çizim p95 1,1 ms.

## Özet
| Ölçüt | Sonuç |
|---|---|
| Taranan görünüm | 56 (12 senaryo-rota × açık/koyu × 1280/390) |
| HTTP | 56/56 200; hedef URL'de kaldı |
| Konsol/JS hatası | 0 (tarama). Akışlardaki 3 "Failed to load resource" satırı, bilerek üretilen 409/500 yanıtlarının tarayıcı kaydıdır |
| 4xx/5xx (tarayıcı) | 0 (tarama). Akışlarda yalnız bilerek tetiklenen 409 (anonim PATCH) ve 500 (route ile zorlanan PUT) |
| axe (WCAG 2.1 AA) | 0 ihlal (56 görünüm + onay diyaloğu + audit ayrıntı diyaloğu) |
| 390 px taşma | 0 (belge ve öğe düzeyinde) |
| Kırık iç link | 0/56 (hu, auadm, ausadef oturumlarıyla) |
| Yavaş sayfa (>2 sn) | 0 (en yavaş 963 ms, mock API ile) |

Betikler ve kanıtlar: `docs/test-raporu/e2e/p13a/` (`scan.mjs`, `flows.mjs`, `flows2.mjs`, `scan.jsonl`, `flows.jsonl`, `img/`).

## Bulgular
Engelleyici, yüksek veya orta bulgu yok.

### [DÜŞÜK] Büyük dosya üzerine yazma uyarısı uçtan uca doğrulanamıyor
Sayfa/akış: konsol ve müşteri sayfası, dosya teklifi diyaloğu (S-P5-T2-1).
Adımlar: 1. `lib/dc/files.ts` dosyasında `DISK_MIN_BYTES = 256 MB` sabit, ortamla değişmiyor. 2. e2e ortamında tenant dosya sınırı 1 MB (p5-collab "AC-53: tenant sınırı (1 MB)"). 256 MB üstü teklif arayüzden üretilemiyor.
Beklenen: uyarının (`data-testid="file-big-overwrite"`) en az bir otomatik testle görülmesi. Gerçekleşen: hiçbir e2e testi bu test kimliğine dokunmuyor. Metin `messages/tr.json:372` dosyasında var ve koşul kodda kabul düğmesinden önce çiziliyor; bu yalnız kod okumasıyla doğrulandı.
Öneri: `NEXT_PUBLIC_RS_E2E` kancasıyla eşiği düşürmek ya da `files-panel` için bileşen testi yazmak.
Atanan: frontend-dev

### [DÜŞÜK] 390 px'te ana menü sekmesi kesik görünüyor ("Oturum geç…")
Sayfa/akış: `/history` ve `/history/[id]`, 390 px.
Adımlar: 1. 390 px genişlikte `hu` senaryosuyla `/history` sayfasını açın. 2. Üst yatay menüye bakın.
Beklenen: etkin sekme görünür olmalı ya da kaydırılabilir olduğu anlaşılmalı. Gerçekleşen: menü yatay kaydırılabiliyor (taşma ölçümü 0) ama etkin sekme "Oturum geç" diye kesiliyor ve ipucu yok. Bu P13a'dan önce de vardı.
Kanıt: `img/s-dark-390-hu-history_01JHXSTAN0N000000000000048.png`, `img/s-light-390-hu-history.png`
Atanan: frontend-dev

### [BİLGİ] Ticket no alanı `<script>` ve 300 karakteri istemcide kabul ediyor
`<script>alert(1)</script>` PATCH ile gönderildi, mock 200 döndü ve metin düz olarak gösterildi (betik çalışmadı). Sözleşme (`updateSessionInputSchema`) yalnız kontrol karakterlerini ve en çok 50 karakteri reddediyor; bu tasarım gereği. Alanda `maxLength` yok, sayaç "n / 50" gösteriyor. Bu P13a kapsamı dışında, mevcut davranış.

## Akış sonuçları
| Akış | Sonuç | Not |
|---|---|---|
| Tam e2e paketi | ✅ | 305/0 |
| Geçmiş listesi: anonim rozeti (tablo + 390 kart, açık/koyu) | ✅ | "Anonimleştirildi" + `Eraser` ikonu |
| Anonim detay: bilgi notu, salt okunur, ad/e-posta "Anonimleştirildi", dosya boş durumu | ✅ | 1280/390, açık/koyu, axe 0 |
| Anonim oturuma doğrudan PATCH | ✅ | 409 |
| 409 yarışı (ANON-409), 390 px + koyu | ✅ | kaydet gizlenir, salt okunura geçer; geri/ileri sonrası salt okunur kalır |
| CSV dışa aktarma | ✅ | anonim satırda müşteri boş, ticket `INC-0048` korunuyor (CSV içeriğini mock üretiyor) |
| Ticket no ipucu ("Kişisel veri … yazmayın", aria-describedby) | ✅ | |
| Audit: `retention.run` → "Saklama süresi işi", "Veri saklama — tümü" filtresi | ✅ | yenilemeden sonra filtre ve tek satır korunuyor (390 koyu) |
| Audit: reason Türkçe etiket + ham kod | ✅ | "Servise ulaşılamadı / unreachable" (e2e) |
| Audit: müşteri IP öneki /24 ve /48, UA satırı yok | ✅ | 390 kart + ayrıntı; tam IPv6 sayfada görünmüyor. Personel kayıtlarında tam IP (203.0.113.7) beklenen davranış |
| Audit boş / 500 | ✅ | `auempty`, `aubroken` görünümleri hatasız |
| WhatsApp: "Varsayılan" rozeti + bilgi notu (koyu) | ✅ | |
| WhatsApp: `HTTPS://WA.ORNEK.COM/YOL/` + çift tıklama | ✅ | tek PUT, gövde `https://wa.ornek.com/YOL`: host küçültülüyor, yol korunuyor (WHATWG) |
| Veri saklama: aralık/biçim hataları, sunucu alan hatası, düşürme onayı, Vazgeç/Escape, artırma | ✅ | e2e |
| Veri saklama: "Süreyi düşür" çift tıklama | ✅ | tek PUT |
| Veri saklama: PUT 500 (route ile) | ✅ | hata metni görünüyor, değer (200) ve kirli durum korunuyor |
| Veri saklama: kirli formda menü linki | ✅ | sayfadan çıkılmıyor, değer kalıyor |
| Veri saklama: onay diyaloğu 390 koyu | ✅ | axe 0, taşma 0 |
| Veri saklama: salt okunur (accro) | ✅ | alan pasif |
| Çıkış yapmış kullanıcı korumalı URL'ye gidiyor (4 rota) | ✅ | hepsi `/login` sayfasına yönleniyor |
| USER → WhatsApp / audit | ✅ | "yalnız Super Admin içindir" / "görüntüleme yetkiniz yok" |
| Var olmayan oturum ID | ✅ | "Oturum bulunamadı" |
| Geçmiş boş (hempty) / liste 500 (hbroken) | ✅ | |

## Kabul kriterleri (uçtan uca)
| AC | Sonuç | Nasıl doğrulandı |
|---|---|---|
| AC-197 (anonimleştirme görünümü, 409, saklama süresi ayarı) | ✅ | p13a.spec + tarama + ek akışlar |
| AC-199 (retention.run audit etiketi/filtresi) | ✅ | p13a.spec + 390 koyu akış |
| T-P12b (reason Türkçe etiketleri) | ✅ | p13a.spec |
| P12b sayfa testi (Varsayılan rozeti, büyük harfli adres) | ✅ | p13a.spec + çift tıklama akışı |
| S-P13a-1 / S-P13a-5 (IP öneki, UA yok, ticket ipucu) | ✅ | p13a.spec + 390 akış |
| S-P5-T2-1 (büyük dosya uyarısı) | ⚠ yalnız kodda | eşik 256 MB sabit, test tenant sınırı 1 MB; uçtan uca üretilemedi (DÜŞÜK bulgu) |

## Görsel gözlemler (ekran görüntülerinden)
- Anonim detay (1280 açık, 390 koyu): rozet başlığın yanında, bilgi notu okunaklı, "Anonimleştirildi" italik ve soluk. Ticket/Not salt okunur, dosya boş durumu doğru.
- Geçmiş listesi 390: anonim kart en altta rozetli, `#INC-0048` görünüyor, kart düzeni bozulmuyor.
- Audit 390 koyu: filtre "Veri saklama — tümü", tek "Saklama süresi işi" kartı ve "Başarılı" rozeti. Ayrıntı diyaloğunda IP `2001:db8:1234::/48`, "Tarayıcı" satırı yok.
- WhatsApp koyu: bilgi notu, "Varsayılan" hapı ve etkin adres kutusu kontrastı yeterli.
- Veri saklama onayı 390 koyu: diyalog ekrana sığıyor, "Süreyi düşür" kırmızı, "Vazgeç" ikincil.
- Headless Chromium'da tarih alanları `mm/dd/yyyy` görünüyor. Bu tarayıcının yerel ayarından geliyor, uygulama hatası değil.
- Başlatılan mock API (:4217) ve web sunucusu (:3217) kapatıldı.
