# ADR-0032 — Sunucu üzerinden dosya aktarımı: yerel şifreli depo + ayrı clamd konteyneri

Tarih: 2026-11-16 · Durum: Önerildi r2 (mimar; K9a güvenlik tasarım turu Y-P28b-1, O-P28b-1..3 ve K0 ölçümleri işlendi — `docs/mimari-p28b.md` §r2) · İlgili: AC-284, AC-353..363, V43/V44/V50/V51, R40/R41/R42,
`docs/mimari-p28b.md`, ADR-0005, ADR-0009, ADR-0030

## Bağlam

AC-353..363: tenant ayarıyla oturumdaki tüm dosyalar (yazdırma dahil) sunucudan geçmeli, sunucuda AES-256-GCM ile şifreli saklanmalı, teslimden önce
ClamAV ile taranmalı (fail-closed), ≤ 5 dk bağlantıyla indirilmeli, 1–7 gün saklanmalı, tenant kotası (vars. 20 GB) ve disk %10 koruması olmalı.
Kısıtlar: tek sunucu, tek süreç (ADR-0005); AGPL/GPL kodu bağlanamaz; misafirin REST kimliği yok; Caddy `read_body 30s`, nginx `client_max_body_size 3m`;
eski Go istemcisi yeni WS alanlarını katı ayrıştırır; sadelik ilkesi (tek yol, oturum içinde iki yol karışmaz).

## Karar

1. **Mod oturum açılışında sabitlenir:** `support_sessions.file_mode` (`P2P|SERVER`) tek ekleme noktasında (`insertSession`) tenant ayarından yazılır.
   SERVER odasında DataChannel dosya kanalı iki uçta reddedilir (sunucu caps daraltır + `file.meta`'yı yok sayar; istemci `file.offer`'ı reddeder).
2. **Depo:** yerel Docker volume (`/data/files/{tenantId}/{rastgele}.rsf`), satır `session_stored_files`. Yalnız `CLEAN` dosya diskte kalır; saklama
   yalnız **teslim edilmiş** `FILE` için işler — reddedilen, geri çekilen, oturum sonunda teslim edilmemiş dosya ve yazdırma belgesi hemen silinir (r2,
   O-P28b-2). Oturum başına 2 GiB, dosya başına 256 MiB tavan (r2).
3. **Şifreleme:** dosya başına HKDF-SHA256 anahtarı (`APP_ENCRYPTION_KEYS` sürümü + rastgele tuz + tenant/fid bağlamı), 64 KiB segmentli
   AES-256-GCM (sayaç + son-segment bayrağı nonce'ta, başlık AAD). Düz metin diske yazılmaz.
4. **Aktarım:** WS `fsrv.init` → bellekte tutulan dosyaya bağlı belirteç → sıralı 1 MiB `PUT` parçaları; indirme 5 dk `Bearer` belirteci, yalnız başlıkta.
5. **Tarama:** resmî `clamav/clamav` imajı (sürüm + digest sabit), **aynı imajdan iki ayrı konteyner** (r2, Y-P28b-1): `clamav` yalnız clamd —
   yalnız `av` iç ağı (sabit alt ağ; yalnız server + clamav), çıkış yok, imza DB'si salt okunur; `clamav-update` yalnız freshclam — yalnız `av_egress`,
   DB'yi tek yazan. Yeniden yükleme clamd `SelfCheck` ile (`NotifyClamd` yok). clamd geçici dizini boyutu sınırlı tmpfs; `mem_limit` = imza DB +
   tmpfs + pay. Port yayımlanmaz. Sunucu yalnız `CLAMAV_ALLOWED_CIDR` (= `av` alt ağı) içindeki hedefe bağlanır (O-P28b-1); tarama kuyruğu firma
   başına adildir (O-P28b-3). Sunucu clamd TCP protokolünü (PING/VERSION/INSTREAM) kendi küçük istemcisiyle konuşur; **GPL kodu
   bağlanmaz, npm paketi yok.** Şifreli arşiv ve sınır aşımı heuristikleri "taranamadı" (AC-359) sayılır; 60 sn, erişilemezlik → teslim yok.
6. **Kota:** `tenants.storage_quota_gb` (yalnız Super Admin); `storageUsage()` tek fonksiyon (P28e kayıtları ekler); yükleme başlarken beyan boyutuyla
   rezervasyon, tenant satırı kilidiyle serileştirme; `statfs` ile disk boş < %10 → ret.
7. **Saklama/silme:** 03:30 işi süresi dolanı siler; anonimleştirme, kalıcı silme ve firma silme dosyayı ve satırı siler. Dosyalar **yedeğe girmez**.

## Alternatifler

| Seçenek                                                 | Neden seçilmedi                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Tarayıcıda/istemcide tarama                             | Değiştirilmiş istemci atlar; Windows Defender varlığı/sürümü bilinmez; AC-357 "sunucuda" ister                      |
| clamd + freshclam tek konteynerde (r1)                  | clamd'yi sömüren dosya internete çıkabilir ve imza DB'sine kalıcı beyaz liste yazabilir (Y-P28b-1)                  |
| ClamAV'ı server imajına kurmak / `libclamav` bağlamak   | GPL kod bağlanması (lisans), imaj ~1 GB büyür, clamd çökmesi sunucuyu düşürür, imza güncellemesi uygulama sürecinde |
| `clamscan` npm paketi (MIT)                             | Protokol ~150 satır; ek bağımlılık yüzeyi gereksiz; `clamscan` ikili moduna kayma riski                             |
| S3/MinIO nesne deposu                                   | Kapsam dışı (gereksinim §4 m.10); MinIO AGPL; tek sunucuda ek servis                                                |
| Disk şifrelemesi (LUKS) tek başına                      | AC-356 uygulama düzeyi AES-256-GCM ister; volume/yedek sızıntısında koruma yok                                      |
| Tek GCM akışı (dosya başına tek tag)                    | Doğrulama ancak sonda; indirmede doğrulanmamış düz metin verilir; rastgele erişim yok                               |
| WS üzerinden dosya baytı                                | `maxPayload` 64 KB, sinyalizasyon kanalını tıkar; tek instance bellek baskısı                                       |
| Tek istekte tüm dosyayı yüklemek                        | Caddy 30 sn gövde süresi, nginx 3 MB; kopmada baştan başlama                                                        |
| Dosyaları yedeğe dahil etmek                            | Silinen kişisel verinin geri gelmesi (imha defteri dosyayı oynatmaz), yedek şişmesi (R41), ≤ 7 gün ömür             |
| Oturum içinde yol seçimi (dosya başına P2P veya sunucu) | Sadelik ilkesi ve AC-355 ("iki yol karışmaz")                                                                       |

Yeni teknoloji ölçütleri (ClamAV): ekipte bilgi — orta (standart açık kaynak AV, protokol belgeli; K0 prototipi); bakım — Cisco Talos, düzenli
sürüm + günlük imza; geri dönüş — tenant anahtarı kapatılınca yeni oturumlar P2P'ye döner, clamav servisi kaldırılabilir (veri kaybı yok, dosyalar ≤ 7 gün).

## Sonuçlar

- (+) Zararlı dosya teslim edilmez; fail-closed; sunucu teslimi kendisi kaydettiği için `session_files` sahte raporu (S-P5-T2-4) SERVER modunda kapanır.
- (+) GPL ayrı süreçte; uygulama imajı ve lisansı değişmez. Kota/depo/şifreleme P28e kayıtlarına hazır (genişleme noktaları `storageUsage`, segment erişimi).
- (−) SERVER modunda "uçtan uca" iddiası daralır (AC-363 açık beyan, aydınlatma onayı).
- (−) clamd boşta ~1 GiB (K0), tmpfs dahil tavan 3 GiB/yığın; imza yeniden yüklemesinde ~8 sn tarama kesintisi (bağlantı yeniden denemesiyle örtülür);
  imza indirme için internet çıkışı (yalnız `clamav-update`); heuristik adları imaj sürümüne bağlı (K0 + Dependabot testi).
- (−) Sunucu modunda dosya tavanı 256 MiB (bellek değişmezi); daha büyük dosya P2P modunda kalır.
- (−) Eski istemci ve gözetimsiz oturumda SERVER modunda dosya aktarımı kapalı.
- (−) Yedekten dönüşte saklanan dosyalar kaybolur (bilinçli; satırlar `EXPIRED`).
