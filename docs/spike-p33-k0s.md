# P33 K0s — macOS ses (AudioToolbox Opus) ve pencere paylaşımı spike'ı

**Özet:** AudioToolbox Opus yolu (K-P33-1) purego ile çalıştı ve ölçütlerin çoğunu büyük farkla geçti. Kodla + çöz p95 değeri
arm64'te 0,136 ms, Rosetta x86_64'te 0,155 ms. Apple ile libopus çapraz çözümünde aynı paketlerin iki çözücü çıktısı arasındaki
SNR ≥ 106 dB; iki çözücü pratikte bit düzeyinde aynı çıktıyı veriyor. PLC var: 0 baytlık paket verilince libopus `Conceal` ile
aynı RMS'te çıktı geliyor. FEC çözme API'si yok. R1–R7'den geçen mutasyonlarla yapılan fuzz'da çökme ve askı 0 (süre ve sayılar
§2). **Kodlayıcı ve çözücü FAIL dalı gerekmiyor.** Tasarımda iki düzeltme gerekiyor: çözücü giriş ASBD'si ve 20 ms dışı
paketlerin sessizce kaybolması (§2.1 Bulgu B1–B3). Güvenlik turunun alt süreç önerisi ölçüldü: AudioConverter, `deny default`
sandbox'ında yalnız `file-read*`, `sysctl-read` ve tek bir `mach-lookup` (`com.apple.audio.AudioComponentRegistrar`) iznine
ihtiyaç duyuyor; süre değişmiyor (§2.2). Mikrofon istemi, SCK pencere akışı ve Yapışkan Tuşlar kilidi GUI ya da ayar değişikliği
gerektirdiği için elle adımlara kaldı. İzin gerektirmeyen, küçültmeyi ayırt eden bir işaret bulunamadı; D-P33-1 sapması geçerli
kalıyor.

| #      | Konu                             | Sonuç                                                              | Kısa gerekçe                                                                                                                                                                        |
| ------ | -------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K0s-A1 | AudioToolbox Opus (purego)       | **GEÇTİ (koşullu)**: (1) yalnız macOS 26, (6) kısa fuzz, (7) vekil | Kurulum, 32 kbit/s, 20 ms/1 paket, çapraz SNR ≥ 106 dB, p95 ≤ 0,16 ms, PLC var, fuzz 0 çökme/0 askı. 3 tasarım bulgusu (B1–B3)                                                      |
| K0s-A2 | Mikrofon TCC (ad-hoc + hardened) | **ELLE-BEKLİYOR** (yalnız durum okuma ölçüldü)                     | İmzalı `.app` (entitlement'lı ve entitlement'sız) kendi kimliğiyle `notDetermined` okudu; istem, örnek gelmesi, turuncu gösterge ve `denied` okuma GUI ister                        |
| K0s-W1 | SCK pencere akışı                | **ELLE-BEKLİYOR** (bu turda koşulmadı)                             | Ekran Kaydı izni sorumlu süreç (Claude uygulaması) için var. Spike kodu bu tura yetişmedi; düzenek ve adımlar §2.5'te                                                               |
| K0s-W2 | İzinsiz küçültülmüş işareti      | **KALDI (işaret yok)** → D-P33-1 kalır                             | Ekran dışındaki 134 katman-0 pencerede `kCGWindowIsOnscreen` dışında ayırt edici bir CG alanı yok. Denetimli küçült/Space örneği alınmadı                                           |
| K0s-W3 | Girdi sorguları                  | **KISMİ**: tercih okuma GEÇTİ, kilit/sıra/panel ELLE               | `com.apple.universalaccess` hem CFPreferences hem `defaults` ile okunuyor (CLI ve `.app` kimliği). `mouseDriver` anahtarı yok. Yapışkan Tuşlar kilidi ayar değiştirmeden ölçülemedi |

Tarih: 2026-11-22 · Dal: `claude/p33-mac-ses-pencere` (commit yok) · Kaynak: `docs/mimari-p33.md` §10.1, ADR-0043 · Makine: Apple M4 Pro,
macOS 26.3.1 (a) 25D771280a. Araçlar: Go 1.26.11, purego v0.11.3, wazero v1.12.0 (yalnız libopus karşılaştırması), `CGO_ENABLED=0`.
**Ürün koduna dokunulmadı.** `apps/agent-win/internal`, `cmd`, `go.mod` ve `go.sum` değişmedi.

## 1. Düzenek

Kod `apps/agent-win/test/spike-p33/` altında, ayrı bir Go modülünde: `module remote-support/agent-win/test/spike-p33`,
`replace remote-support/agent-win => ../..`. Bu, P28f'deki kalıbın aynısı. Modül `internal/darwin/objc` ve `internal/voice`
paketlerini içe aktarıyor, ama ana modülün `./...` kapsamına girmiyor. Yeni bağımlılık yok; `go.sum` üst modülden kopyalandı.
İkililer ve `.app` paketleri oturumun geçici klasöründe üretildi. Kodun repoya girip girmeyeceğine orkestratör karar verecek.

| Paket / komut    | Madde  | Ne yapar                                                                                                                                                                                                                                                       |
| ---------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mac/`           | ortak  | malloc/free (C'nin geri çağrı sonrasında okuduğu tamponlar), CF okuyucuları, CFPreferences, App Nap                                                                                                                                                            |
| `at/`            | A1     | `AudioConverterNew/FillComplexBuffer/Get/SetProperty`, `AudioFormatGetProperty`. Giriş geri çağrısı `init`'te bir kez kuruluyor; C'ye bağlam olarak tamsayı tutamaç gidiyor. "Veri yok" durumu `'nodt'`                                                        |
| `opuspkt/`       | A1     | RFC 6716 §3.4 R1–R7 doğrulayıcısı (saf Go, birim testi var). Ürün sürümü K1'de `internal/voice/opuspkt.go` olarak yazılacak                                                                                                                                    |
| `sig/`           | A1     | `speechLike` (ürün testindekiyle aynı), gecikme aramalı SNR, yüzdelikler, fikstür okuma                                                                                                                                                                        |
| `cmd/k0sa1`      | A1     | `-mode info\|snr\|fixtures\|plc\|corpus`; libopus tarafı `internal/voice` (wasm). Çözme çağrıları 11 ms aralıklı, böylece duvar saatiyle işleyen 100 paket/sn sınırına takılmıyor                                                                              |
| `cmd/k0sa1bench` | A1 (4) | Yalnız Apple kodeği; wazero'ya bağlanmıyor (`go version -m`: 0). Rosetta için `GOARCH=amd64`                                                                                                                                                                   |
| `cmd/k0sa1fuzz`  | A1 (6) | Gözetmen + çocuk süreç. Mutasyon → R1–R7 → Apple çözücü. Son paket mmap dosyasında tutuluyor (yerel çökme izine). > 200 ms çağrılar sayılıyor; > 5 sn süren çağrıda süreç çıkıyor. Her 1000 geçerli pakette bilinen iyi paketle kullanılabilirlik denetleniyor |
| `cmd/k0sprobe`   | A2, W3 | Mikrofon, Ekran Kaydı, Girdi İzleme, Erişilebilirlik durumlarını, `CGEventSourceFlagsState` değerini ve `universalaccess` tercihlerini **yalnız okuyor**. `-request-mic` yalnız elle adım içindir ve koşulmadı                                                 |
| `cmd/k0sw23`     | W2, W3 | `CGWindowListCopyWindowInfo` (All ve OnScreenOnly) üzerinden katman bazında sayısal alan istatistiği. Başlık ve uygulama adı okunmuyor, yazılmıyor                                                                                                             |

Ortak önek: `cd apps/agent-win/test/spike-p33 && export PATH=~/sdk/go1.26.11/bin:$PATH GOTOOLCHAIN=local CGO_ENABLED=0 GOPROXY=off GOFLAGS=-mod=mod`.

**TCC kimliği (P28f notu geçerli):** Terminalden başlatılan ikililer, sorumlu süreç olan Claude uygulamasının izinlerini taşıyor:
Mikrofon `authorized`, Ekran Kaydı, Girdi İzleme, olay gönderme ve Erişilebilirlik `true`. Ad-hoc imzalı `P33Probe.app` paketleri
(`net.noktabilisim.destek.spike33.{ent,noent}`, hardened runtime) `open -W -n` ile kendi kimlikleriyle çalıştırıldı. Bu
paketlerde tüm izinler `false`, mikrofon `notDetermined (0)`. Hiçbir istem açılmadı; `CGRequest…` ve `requestAccess…`
çağrılmadı. Sistem ayarı değiştirilmedi.

## 2. Madde bazında sonuçlar

### 2.1 K0s-A1 — AudioToolbox Opus (GEÇTİ, koşullu)

Komutlar: `k0sa1 -mode info`, `-mode snr -frames 500`, `-mode fixtures [-fpp 0|480|960|2880|5760]`, `-mode plc [-fpp 0|960]`,
`k0sa1bench [-decoders 3]`, `arch -x86_64 k0sa1bench-amd64`, `k0sa1fuzz -corpus … -d 10m -fpp 960|0`.

| Ölçüt (mimari §10.1)       | Ölçülen                                                                                                                                                                                                                                                                   | Sonuç                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| (1) Kurulum                | `kAudioFormatProperty_Encoders/Decoders` Opus: `aenc/adec opus appl` (yazılım). LPCM s16 48k mono ↔ Opus 48k mono/stereo kuruldu. Yalnız macOS 26.3.1'de ölçüldü; 14/15 CI'da, 13 VM'de                                                                                   | GEÇTİ (26) · 14/15 **CI-BEKLİYOR**              |
| (2) 32 kbit/s, 20 ms paket | Varsayılan `brat` = −1000 (OPUS_AUTO); 32000 yazıldı ve geri okundu. `aebr` 6–512 kbit/s. Prime 312/0 (lookahead 312), `cdqu` 10, sihirli çerez 28 bayt. 500 çağrının her biri tam 1 paket üretti; ortalama 32,3–32,6 kbit/s                                              | GEÇTİ                                           |
| (3) SNR ≥ 20 dB            | Aynı paketlerin iki çözücü çıktısı: Apple paketlerinde 105,98 dB, libopus paketlerinde 108,38 dB (Apple çözücü, ilk çerçevede 120 örnek ön atlama yapıyor). Özgün sinyale göre: Apple→Apple 6,85, Apple→libopus 6,85, libopus→libopus 3,62 (taban), libopus→Apple 3,62 dB | GEÇTİ (birlikte çalışma ölçüsüne göre, aşağıda) |
| (3) Fikstürler             | `stereo-voip-20ms` ve `stereo-celt-20ms` mono çıkışa çözüldü (giriş ASBD'si 1 ya da 2 kanal, aynı sonuç). Kod 3 tek çerçeve ve dolgulu paket çözüldü. 1 baytlık TOC → sessizlik                                                                                           | GEÇTİ (20 ms)                                   |
| (4) p95 ≤ 2 ms             | 5000 çerçeve, 200 ısınma. arm64: kodla p95 0,108, çöz 0,028, **kodla+çöz 0,136** (maks 0,905) ms. 3 çözücüyle 0,185 ms. Rosetta x86_64: **0,155** (maks 0,688) ms; 3 çözücüyle 0,227 ms                                                                                   | GEÇTİ                                           |
| (5) PLC/FEC                | PLC **var**: 0 baytlık paket + paket tanımı, çıktı kapasitesi 960 → 960 örnek. RMS libopus `Conceal` ile aynı (4866 = 4866; ikinci adım 3934 = 3934). FEC çözme API'si yok. Apple kodlayıcı paketlerin %97,4'ünü CELT-FB üretiyor (13/500 hibrit), dolayısıyla LBRR yok   | PLC: Apple · FEC: atlanır (V-P33-A2)            |
| (6) Fuzz                   | Bkz. aşağıdaki fuzz tablosu. Ölçüt 30 dk; bu turda 10 dk (arm64) ve 5 dk (Rosetta)                                                                                                                                                                                        | 0 çökme / 0 askı · 30 dk **CI/ELLE**            |
| (7) Chrome yükü            | Chrome yakalaması yapılmadı. Vekil olarak bağımsız bir libopus 1.6.1 yapısının fikstürleri (stereo bayraklı 20 ms, CELT, hibrit) ve kod 1/2/3 yeniden paketleme kullanıldı. Chrome'un varsayılanı olan 20 ms/stereo bayraklı paket çözülüyor                              | **VEKİL** · gerçek Chrome yükü staging'de ELLE  |

**SNR ölçütü hakkında not (mimara):** "≥ 20 dB", özgün sinyale göre dalga biçimi SNR'ı olarak okunursa referans libopus da geçemez
(3,62 dB; depodaki test de ≈ 4,6 dB ölçmüştü). Opus algısal bir kodek olduğu için bu sayı birlikte çalışmayı göstermez. Bu yüzden hüküm,
aynı paketlerin Apple ve libopus çözücülerindeki çıktıları arasındaki SNR'a (≥ 106 dB) dayandırıldı. **Öneri:** §10.1 (3) şöyle
yazılsın: "aynı paketlerin iki çözücü çıktısı arasında SNR ≥ 20 dB; özgün sinyale göre SNR, libopus→libopus tabanından en çok 3 dB düşük".

**Fuzz (R1–R7'den geçen mutasyonlar → Apple çözücü; `MallocScribble=1`, arm64'te ayrıca `MallocGuardEdges=1`):**

| Koşu                          | Süre  | Yineleme / R1–R7'den geçen      | Çökme | > 200 ms | En uzun çağrı | Çözme hatası (`'bada'`) | Sıfır çıktı                | Kullanılamaz durum       |
| ----------------------------- | ----- | ------------------------------- | ----- | -------- | ------------- | ----------------------- | -------------------------- | ------------------------ |
| arm64, ASBD 960 çerçeve/paket | 10 dk | 27 000 900 / 21 533 661 (%79,8) | 0     | 0        | 7,86 ms       | 24 497                  | 3 930 901 (20 ms dışı, B1) | 0 (1076 yeniden kurulum) |
| arm64, ASBD 0 (değişken)      | 10 dk | 20 146 288 / 16 065 656 (%79,7) | 0     | 0        | 5,98 ms       | 0                       | 4                          | 0 (803)                  |
| x86_64 Rosetta, ASBD 960      | 5 dk  | 11 063 055 / 8 820 411 (%79,7)  | 0     | 0        | 6,68 ms       | 10 055                  | 1 610 238 (B1)             | 0 (441)                  |

Mutasyonlar: bit çevirme, rastgele bayt, rastgele TOC, kırpma, ekleme, silme, başka paketle birleştirme, kod 3 sarmalama (CBR/VBR,
dolgu), 0x00/0xFF blokları. Derlem 405 paket: Apple paketleri (3 tohum), libopus paketleri ve 5 fikstür. Çözücü her 20 000 geçerli
pakette yeniden kuruluyor. Geçerli paketlerin süre dağılımı 2,5–120 ms aralığının tamamını kapsıyor (%82'si 20 ms).

**Tasarım bulguları (K1'i bağlar; mimari §2/§6.5 r2):**

- **B1: 20 ms dışı paketler sessizce kayboluyor.** Çözücü giriş ASBD'sinde `mFramesPerPacket = 960` iken toplam süresi 20 ms
  olmayan paket (10, 5, 40 ve 60 ms; kod 2 ve kod 3 ile 40 ms) **hatasız ama 0 örnekle** dönüyor. Fuzz'daki "sıfır çıktı" sütunu bu
  durumu sayıyor. Ürün şunu yapmalı: R1–R7'den sonra `Info.Samples() != 960` ise paketi Apple'a vermeden düşürmeli ve `DecodeErr`
  saymalı (V-P33-A1 ile uyumlu). Ayrıca 0 örnekli dönüş de hata sayılmalı.
- **B2: `mFramesPerPacket = 0` (değişken) tüm süreleri çözüyor ama PLC'yi bozuyor.** Değişken kipte 0 baytlık paket 120 ms (5760
  örnek) PLC üretiyor. Kapasite 960 ile sınırlanınca kalan 4800 örnek bir sonraki gerçek paketin çıktısına ekleniyor. **Öneri:**
  ASBD 960 + B1 süzgeci; Chrome varsayılanı 20 ms olduğu için kayıp kabul edilebilir.
- **B3: Çözücü ilk çerçevede 840 örnek veriyor** (ön atlama 120). Jitter/mikser 960'tan kısa çıktıyı sıfırla doldurmalı ya da
  ilk çerçeveyi atlamalı. Kodlayıcı lookahead'i 312 (`prim`); `Lookahead()` buradan okunmalı.
- `kAudioConverterPropertySettings` Opus kodlayıcıda boş geliyor. Karmaşıklık ya da uygulama (VOIP/AUDIO) seçilemiyor; Apple
  ağırlıkla CELT üretiyor. Kodlayıcı FEC'i de yok; bu sorun değil, çünkü Mac'ten giden sesin kaybı teknisyen tarafında libopus PLC
  ile gizleniyor.

### 2.2 Güvenlik turu önerisi: çözücü `sandbox_init` ile kısıtlı alt süreçte (ölçüm)

`sandbox-exec -p` (aynı SBPL motoru; `sandbox_init` ile eşdeğer profil) altında `k0sa1bench -frames 2000`:

| Profil                                                                                     | Sonuç                                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `(deny default)(allow file-read*)(allow sysctl-read)(allow process-exec <ikili>)`          | `AudioConverterNew` → `'fmt?'` (Opus bileşeni bulunamıyor)                   |
| Yukarıdaki + `(allow mach-lookup (global-name "com.apple.audio.AudioComponentRegistrar"))` | **Çalışıyor.** Kodla+çöz p95 0,123 ms, çöz p95 0,025 ms (sandbox'sızla aynı) |
| `(allow mach-lookup)` (tümü)                                                               | Çalışıyor, p95 0,127 ms                                                      |

- Ağ, dosya yazma, süreç başlatma ve diğer mach hizmetleri kapalıyken Apple Opus çözücüsü çalışıyor. Gereken tek hizmet bileşen
  kayıt servisi.
- Ölçülmeyenler (K0g/K1'e açık):
  - Ana süreçle alt süreç arasındaki IPC'nin (boru, paket başına ≈ 100 bayt ve 1920 bayt) gecikmesi. Tahmin: 10 µs düzeyinde;
    ölçülmedi.
  - `file-read*` kapsamının daraltılması.
  - Çevirici kurulduktan sonra süreç içinde `sandbox_init` çağrılınca kayıt servisine gerek kalıp kalmadığı.
  - `sandbox_init` ve `sandbox-exec` Apple'da deprecated; çalışıyorlar, ama gelecek sürümde kalkma riskini güvenlik tartmalı.
- Sonuç: gecikme bütçesi (≤ 2 ms) alt süreç tasarımını rahatça kaldırır. Engel performans değil, karmaşıklık: süreç yönetimi,
  çöküşte yeniden başlatma, 3 hata sonrası eşin düşürülmesi.

### 2.2a K1 ölçümü: çözücüler sandbox'tan önce kurulunca profil yalnız `(deny default)` (S-P33-T2-1 m.3)

`test/spike-p33/cmd/k1sandbox` (süreç içi `sandbox_init`, 2026-11-23, M4 Pro macOS 26.3.1; arm64 ve Rosetta x86_64): üç çözücü kurulup
gerçek paket + PLC + `AudioConverterReset` ile ısıtıldıktan sonra `(version 1)(deny default)` profiline girildi.

| Profil                                  | Çözme / PLC / Reset                                | Yeni çözücü | Okuma (`/Users`, `/Library/Keychains`, `/private/var/folders`, `/etc/hosts`, `~/.noktatest`) | `/tmp` yazma | TCP connect | `socket()` |
| --------------------------------------- | -------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- | ------------ | ----------- | ---------- |
| `(deny default)`                        | çalışıyor, p95 0,06 ms (arm64) / 0,027 ms (x86_64) | kuruluyor   | EPERM                                                                                        | EPERM        | EPERM       | fd dönüyor |
| + `(deny system-socket)(deny network*)` | aynı                                               | aynı        | EPERM                                                                                        | EPERM        | EPERM       | fd dönüyor |
| spike §2.2 geniş profil (karşılaştırma) | aynı                                               | aynı        | **okunuyor**                                                                                 | EPERM        | EPERM       | fd dönüyor |

Sonuç: `file-read*`, `sysctl-read` ve `AudioComponentRegistrar` mach-lookup'ı gerekmez; ürün profili `(deny default)`. `socket()` SBPL ile
engellenemiyor; ağ çıkışı connect/sendto düzeyinde reddediliyor (test bunu sınar).

### 2.2b Ürün yardımcısı içinde 30 dk fuzz (K0s-A1 madde 6; QA K4 madde 5, düzeltme turu 1)

`internal/voice/opushelper_fuzz_darwin_test.go` (`NOKTA_FUZZ_SURE=30m`, tohum 33; 2026-11-23, M4 Pro macOS 26.3.1 arm64): sandbox'lı
`--opus-cozucu` yardımcısına `opus20ms` süzgecinden geçen 33 396 202 mutasyon paketi (1 073 759 PLC dahil) gönderildi. Çökme/askı **0**,
"çözülemedi" 0, kullanılamaz durum 0, > 200 ms 0, > 15 ms 505 (koşunun bir kısmı derleme/test yükü altında), en uzun çağrı 165,9 ms,
p50 0,043 ms, p99 0,090 ms. Ayrıntı `docs/implementation.md` "P33 düzeltme turu 1".

### 2.3 K0s-A2 — Mikrofon TCC (ELLE-BEKLİYOR)

Ölçülen (istem açmadan):

- CLI (Claude kimliği): `authorizationStatusForMediaType:AVMediaTypeAudio` = 3 (`authorized`).
- `P33Probe.app` entitlement'lı (`com.apple.security.device.audio-input`, hardened runtime, `NSMicrophoneUsageDescription`) ve
  entitlement'sız: ikisinde de `0 (notDetermined)`. Durum sorgusu purego + `AVFoundation` sembolü (`AVMediaTypeAudio`) ile
  çalışıyor; durum okuma entitlement'a bağlı değil.

Elle adımlar (kullanıcı; GUI istemi):

1. `open -W -n <S>/app-ent/P33Probe.app --args -request-mic -o /tmp/p33-ent.txt` → istem çıkmalı. İzin verildikten sonra durum
   `authorized` olmalı.
2. Aynısını `app-noent` için yapın. Beklenen: hardened runtime'da istem **çıkmaz** ya da sessizce reddedilir. Sonucu belgeleyin.
3. İzinli `.app`'te AudioQueue girişini açın (K1'deki `audio_darwin` ile). Örnek gelmeli; `Dispose` sonrası turuncu gösterge
   ≤ 1 sn içinde sönmeli (göz ile ya da ekran kaydıyla).
4. Sistem Ayarları → Mikrofon'dan izni kapatın. Durum `2 (denied)` okunmalı. Temizlik:
   `tccutil reset Microphone net.noktabilisim.destek.spike33.ent` (ve `.noent`).

### 2.4 K0s-W2 — İzinsiz küçültülmüş işareti (KALDI → D-P33-1 kalır)

`k0sw23` (Claude kimliği; başlık okunmadı): All listesinde 2304 pencere, OnScreenOnly'de 40. Katman 0'da 134 pencere var; bunların
9'u ekranda. Ekranda olmayan 125 pencerenin alan imzası tek tip: `kCGWindowIsOnscreen` **anahtarı yok**, `Alpha` = 1 (7'sinde 0),
`SharingState` = 1, `StoreType` = 1, `MemoryUsage` = 2368. Küçültülmüş, gizli (⌘H), başka Space'te ve kapatılmış-ama-yaşayan
pencereleri ayıracak sayısal bir CG alanı görülmedi. Ekranda olmayan pencere `IsOnscreen` taşımıyor; K-P33-5'teki "yok/false →
görünmez" kuralı bununla uyumlu.

- Sınır: denetimli durum örnekleri (yardımcı pencereyi küçültme, ⌘H, tam ekran ile Space değiştirme) bu turda **alınmadı**. Ölçüm
  mevcut pencerelerin istatistiğidir. Hüküm "işaret görülmedi" düzeyinde. ⌘H için `NSRunningApplication.isHidden` aday olarak
  kalıyor (uygulama düzeyinde; küçültmeyi ayırmaz).
- Öneri: D-P33-1 geçerli. K2'de elle test listesine dört durum (küçült, ⌘H, başka Space, kapat) × `IsOnscreen`/`Alpha` eklenmeli.

### 2.5 K0s-W1 — SCK pencere akışı (ELLE-BEKLİYOR)

Ön koşul ölçüldü: `CGPreflightScreenCaptureAccess` = true (Claude kimliği). Spike kodu bu turda yazılmadı (süre). Düzenek önerisi,
P28f K0s-1 kalıbıyla:

1. Ayrı süreçte yardımcı pencere: 480×320, 60 Hz renk değiştiren içerik, App Nap kapalı.
2. `getShareableContent…onScreenWindowsOnly:NO` → `SCContentFilter initWithDesktopIndependentWindow:` → mevcut temsilci ve NV12
   yolu. Ölçüt: Complete kare ≥ 25 fps.
3. Üstüne başka süreçten farklı renkli bir pencere açılır ve merkez piksel yoklanır (örtücü rengi 0 kez görünmeli).
4. Pencere 800×500'e büyütülür; CG yoklamasıyla `updateConfiguration` uygulanır ve yeni boyutta ilk karenin süresi ölçülür
   (≤ 2 sn).
5. Küçült, ⌘H ve kapat programla yapılır, Space geçişi elle. Her durumda SCK kare durumu ile CG `IsOnscreen` kaydedilir (W2
   ile ortak).

### 2.6 K0s-W3 — Girdi sorguları (KISMİ)

| Soru                                       | Ölçülen                                                                                                                                                                                                                                                                 | Sonuç    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `com.apple.universalaccess` okunabilir mi  | `CFPreferencesCopyAppValue`: `stickyKey` = 0, `slowKey` = 0; `mouseDriver` ve `stickyKeyBeepOnModifier` **anahtarı yok**. `defaults read`: `stickyKey` 0, `mouseDriver` "does not exist". CLI (Claude, Tam Disk Erişimi olabilir) ve izinsiz `.app` kimliğinde **aynı** | GEÇTİ    |
| `CGEventSourceFlagsState`                  | Değiştirici basılı değilken combined = 0x0, hid = 0x0 (CLI ve `.app`; izin gerektirmiyor)                                                                                                                                                                               | Okunuyor |
| Yapışkan Tuşlar kilidi bayrağa yansıyor mu | Ölçülmedi: kullanıcı ayarını değiştirmek ve tuş basmak gerekiyor                                                                                                                                                                                                        | **ELLE** |
| CG sırası, sayfa/panel/menü katmanı, PID   | Bu makinede görülen katmanlar: 0, 3, 19–25, 103, 501, 1000, 2005 ve uç değerler. Denetimli sayfa/panel/menü/Kaydet paneli örneği alınmadı                                                                                                                               | **ELLE** |

- Mimariye öneri (§6.4 `Accessibility` satırı): "okunamazsa açık" kuralına **"alan okunabiliyor ama anahtar yok → varsayılan
  (kapalı)"** ayrımı eklenmeli. Bu makinede `mouseDriver` hiç ayarlanmadığı için yok. Yoksa her Mac'te Fare Tuşları "açık" sayılır
  ve `Numpad*` girdisi gereksiz yere düşer. Tercih alanı izinsiz okunabiliyor.
- Elle adımlar: (1) Yapışkan Tuşlar'ı açın, ⇧'a bir kez basın, `k0sprobe` çalıştırın; combined/hid bayrağında `0x20000` görünmeli.
  İki kez basıp (kilit) tekrarlayın. (2) TextEdit'te ⌘S ile Kaydet panelini açın, `k0sw23`'e PID'li bir döküm ekleyin. Panelin
  PID'i TextEdit'ten farklıysa R-P33-4 doğrulanır.

## 3. Mimariye etkisi ve FAIL dalları

- **K-P33-1 (AudioToolbox Opus) geçerli.** Dal (c), (a′) ve (b′) gerekmiyor. AC-538 bütçesine göre CPU payı ihmal edilebilir
  (≈ 0,1 ms / 20 ms ≈ %0,5 çekirdek).
- **ADR-0043 r2 / mimari r2 maddeleri:**
  1. Çözücü ASBD `mFramesPerPacket = 960`; R1–R7'den sonra süre ≠ 20 ms ise paket düşer ve `DecodeErr` sayılır; 0 örnekli dönüş
     hata sayılır (B1, B2).
  2. `Conceal` = 0 baytlık paket + çıktı kapasitesi 960 (Apple PLC, libopus ile aynı). Go PLC'si gerekmiyor (V-P33-A2'nin PLC
     yarısı kalkar). `DecodeFEC` "desteklenmiyor" döner.
  3. İlk çerçeve 840 örnek (B3); `Lookahead` = `prim` leading (312).
  4. §10.1 (3) SNR ölçütünün metni düzeltilmeli (§2.1 not).
  5. §6.4 `Accessibility` "anahtar yok = kapalı" ayrımı (§2.6).
- **G-P33-1 (güvenlik):** Alt süreç sandbox'ı teknik olarak uygulanabilir (§2.2). Karar K0g'nin. Uygulanırsa IPC gecikmesi K1'de
  ölçülmeli.
- **Açık kalanlar:** A1 (1) macOS 14/15 (CI `macos-14`/`macos-15` üzerinde `k0sa1 -mode info` + `k0sa1bench`); A1 (6) 30 dk fuzz;
  A1 (7) gerçek Chrome yükü; A2, W1 ve W3'ün elle maddeleri. W2 KALDI → D-P33-1 sapması kalır.
