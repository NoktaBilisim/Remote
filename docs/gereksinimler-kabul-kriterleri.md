# Kabul Kriterleri — Remote Support
Ana doküman: `/Users/mennan/Projeler/Remote/docs/gereksinimler.md` (bölüm 5). Tarih: 2026-11-11. Durum: TASLAK.
Her AC için adı AC numarasını içeren en az bir otomatik test yazılır (kalite standardı). "Staging testi" ibareli AC'ler gerçek ağda ölçülür ve sonuç `docs/test-raporu.md`'ye yazılır.

## Dosya yapısı
Boyut nedeniyle AC'ler dört parçadadır; bu dosya ile birlikte tek doküman sayılır. AC numaraları `docs/mimari.md` §11 ile birebir aynıdır; numara değiştirilmez, silinen AC numarası yeniden kullanılmaz.

| Parça | Epikler | AC |
|---|---|---|
| `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e1-e4.md` | E1 Oturum yaşam döngüsü, E2 Sinyalizasyon, E3 Tarayıcı modu + karşılama, E4 Teknisyen konsolu | AC-1..AC-59, AC-112, 113, 114, 117, 119, 120, 125, 127 |
| `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e5-e8.md` | E5 Oturum geçmişi, E6 Ortak platform, E7 Operasyon, E8 Windows istemcisi | AC-60..AC-111, AC-115, 116, 118, 121, 122, 123, 124, 126, 128, AC-197..AC-200 (2026-11-14) |
| `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e9.md` | E9 Müşteri destek talebi (2026-11-12) | AC-129..AC-164, AC-196 (2026-11-13) |
| `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e10.md` | E10 Müşteri firmalar ve kalıcı istemci — paket P8c (2026-11-12) | AC-165..AC-195 |
| `/Users/mennan/Projeler/Remote/docs/gereksinimler-kabul-kriterleri-e11.md`, `…-e11-b.md` | E11 Ertelenen ve kapsam dışı işler (2026-11-14) | AC-201..AC-297 |
| `/Users/mennan/Projeler/Remote/docs/gereksinimler-p13b.md` §4 | P13b prod açılışı (2026-11-14; AC-303 2026-11-15) | AC-298..AC-303 |
| `/Users/mennan/Projeler/Remote/docs/gereksinimler-lobi-gostergesi.md` §4 | E4 ek: bekleme odası (lobi) göstergesi ve bildirimi (2026-11-15) | AC-304..AC-316 |

## Epik bazında sayım
| Epik | AC sayısı | Yeni AC'ler (2026-11-11) |
|---|---|---|
| E1 | 14 | AC-114 |
| E2 | 15 | AC-112, AC-113, AC-120 |
| E3 | 16 | AC-125, AC-127 |
| E4 | 22 | AC-117, AC-119 |
| E5 | 5 | AC-124 |
| E6 | 29 | AC-115, AC-121, AC-122, AC-123, AC-126 |
| E7 | 11 | AC-197..AC-200 (2026-11-14, P13a) |
| E8 | 20 | AC-116, AC-118, AC-128 |
| E9 | 37 | AC-129..AC-164 (2026-11-12), AC-196 (2026-11-13) |
| E10 | 31 | AC-165..AC-195 (2026-11-12, P8c) |
| E11 | 97 | AC-201..AC-297 (2026-11-14) |
| E7 (P13b) | 6 | AC-298..AC-302 (2026-11-14), AC-303 (2026-11-15) |
| E4 (lobi göstergesi) | 13 | AC-304..AC-316 (2026-11-15) |
| **Toplam** | **316** | **17 (2026-11-11) + 36 + 31 (2026-11-12) + 1 (2026-11-13) + 4 + 97 + 5 (2026-11-14) + 1 + 13 (2026-11-15)** |

## Değişiklik kaydı
- 2026-11-10: İlk sürüm, AC-1..AC-111.
- 2026-11-11: `docs/mimari.md` §13 AC değişiklik talebi işlendi (kaynak: `docs/guvenlik-raporu.md` Tur 0, kullanıcı kararları K3/K6/K7/K8).
  - 22 revizyon: AC-3, 6, 7, 10, 14, 21, 22, 26, 27, 36, 61, 65, 75, 92, 94, 96, 97, 98, 102, 103, 109, 111.
  - 17 yeni AC: AC-112..AC-128.
  - K8: kod imzalama sertifikası yok; istemci imzasız dağıtılır, güven tekrarlanabilir build + SHA-256 + GitHub build attestation ile sağlanır (ADR-0010). Bu nedenle AC-27, AC-92, AC-94, AC-96 metinlerinde imza ifadesi kaldırıldı.
  - Her revize/yeni AC'nin sonunda kaynak notu vardır (örn. "(G-01)").
- 2026-11-12: E9 Müşteri destek talebi eklendi (kullanıcı kararı, model A): 36 yeni AC (AC-129..AC-164), ayrı dosya `gereksinimler-kabul-kriterleri-e9.md`. AC-108 metni AC-138 ile değişti (hatırlama dosyası tek istisna; ADR-0004 r3). Mimari eşleme `docs/mimari-e9.md` §11.
- 2026-11-12 (r2): Güvenlik tasarım turu E9 (`docs/guvenlik-raporu.md` "Tasarım turu — E9 (P8b)", G-E9-1..14) ve koordinatör kararları işlendi; 11 AC revize edildi: AC-133 (sunucu/sürüm satırı, asgari sürüm), AC-134 (açıklama tek satır), AC-136 (hatırla kutucuğu varsayılan **işaretsiz** — kullanıcı kararı; cihaz anahtarı), AC-139 (6 haneli talep kodu), AC-143 (ağ öneki bekleyen sınırı, 40 sonrası yalnız bilinen kaynak, güvenilen CIDR), AC-144 (IPv6 /48, tenant kilitlenmez), AC-146 (talep kodu, bilinen kaynak, arama ipucu), AC-150 (WhatsApp'ta kişisel veri yok, 30/sa + özet, güvensiz adreste kapalı), AC-152 (güvenilen CIDR ayarı), AC-154 (her kabulde "Ekranımı paylaş" onayı, Vazgeç, iptal yarışı), AC-157 (ret mesajında bağlantı/telefon yasak). AC sayısı değişmedi (164).
- 2026-11-12 (P8c): Kullanıcının sahadan geri bildirimi (madde 1–7) üzerine E10 "Müşteri firmalar ve kalıcı istemci" eklendi: 31 yeni AC (AC-165..AC-195), ayrı dosya `gereksinimler-kabul-kriterleri-e10.md`. Mevcut AC metinlerine dokunulmadı. E10 içindeki değişiklik talepleri: AC-138'in kapsamı AC-188 ile genişler (ayar dosyası yalnız bilgisayar kaydı için de bulunabilir), AC-162'deki "Teknisyenden kod aldım" metni AC-189 ile "Bağlantı kodum var" olur, AC-140'a `CUSTOMER_PASSIVE` iptal nedeni eklenir (AC-171).
- 2026-11-13 (r3): Kullanıcı kararı — Super Admin "Sistem ayarları"na WhatsApp servisi sekmesi (Projeler/CLAUDE.md §2.2 "panelde servis URL'si + Test Mesajı Gönder" sapması kapatıldı): yeni AC-196 (E9 dosyası, E9.6). AC-152'nin son cümlesi revize (URL sistem düzeyi: panel kaydı, yoksa env; tenant göremez). AC-150 ve K13 (güvensiz adreste kanal kapalı) değişmedi. Toplam 196.
- 2026-11-14 (P13a): Kullanıcı kararıyla P13 ikiye bölündü (P13a staging operasyon/saklama/yedek/doküman, P13b prod). Mimar önerisiyle E7'ye 4 yeni AC eklendi (AC-197 oturum anonimleştirme, AC-198 audit/oturum/sıfırlama silme + `created_at` zorlama, AC-199 saklama işi gözlemlenebilirliği, AC-200 şifreli yedek + geri yükleme doğrulaması). Mevcut AC metinleri değişmedi. AC-88 "coturn" yorumu mimari §12 K26'da. Toplam 200.
- 2026-11-14 (P13b): K1 = remote.noktabilisim.net, K3 = aynı sunucu/5349 (ADR-0018/0019/0020). Revize: AC-23 (5349, 443 risk kabulü), AC-91 (prod provası), AC-126 (HSTS includeSubDomains), AC-200 (prod provası). Yeni: AC-298..AC-302 (`gereksinimler-p13b.md`). Toplam 302.
- 2026-11-15 (P13b r2): Güvenlik S-P13b-3 ve kullanıcı kararıyla whatsapp-bildirim servisi `X-API-Key` zorunlu tuttuğu için yeni AC-303 eklendi (Super Admin "Servis anahtarı" alanı, şifreli/maskeli saklama, adres–anahtar eşleşmesi, köken değişiminde `WA_API_KEY_REENTER`, 401'de "Servis anahtarı reddetti." ve yeniden denememe, audit `***`, `WHATSAPP_SERVICE_API_KEY`). Mevcut AC metinleri değişmedi. Toplam 303.
- 2026-11-15 (lobi göstergesi): Staging olayı (müşteri Hızlı Destek ile bekleme odasında 75 sn bekledi; lobi yalnız konsolda göründüğü için teknisyen fark etmedi ve oturumu iptal etti) üzerine kullanıcı kararıyla yeni AC-304..AC-316 eklendi (`gereksinimler-lobi-gostergesi.md`): oturum listesinde "Müşteri bekliyor (n)" rozeti ve konsola tek tık, liste yanıtında bekleyen sayısı, "Oturumlar" menü sayacı (`support_requests.view`'den bağımsız), toast, sekme başlığı, rol/tenant ve firma seçmemiş Super Admin davranışı, yalnız sayı (ad yok, KVKK), a11y/tema/mobil/animasyon, sayım ucu güvenlik ve p95, dayanıklılık, uçtan uca staging testi. OS bildirimi ve ses Sonra. Mevcut AC metinleri değişmedi. Toplam 316.
