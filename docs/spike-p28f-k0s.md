# P28f K0s — macOS istemci purego spike'ı (sonuç ve ADR-0037 etkisi)

**Özet:** purego/objc yolu (ADR-0037 m.1, `CGO_ENABLED=0`) gerçek donanımda çalıştı. Bloklar, temsilci sınıf, Go dışı iş
parçacığından C geri çağrıları ve değerle geçen yapılar (CMTime, CGRect, CGPoint) arm64'te ve x86_64'te (Rosetta) sorunsuz.
**cgo'ya geçiş gerektiren bir bulgu yok.** K0s-2'nin gecikme ölçütü, mimarideki ayarlarla 1080p ve üstünde tutmadı. Aynı
ayarlarla yazılmış saf C kontrol programı aynı gecikmeyi verdi; sorun purego'dan değil, VideoToolbox'tan. Bu nedenle FAIL dalı
(cgo) bu sorunu çözmez. Düşük gecikmeli oran denetimi (`EnableLowLatencyRateControl`) 1080p'de p95'i 6,9 ms'ye indirdi, ama
karelerin ≈ %12'sini attı. ADR-0037 **r2 gerekir**, ama geçiş için değil: dört maddede düzeltme ve karar için (§3).

| #     | Konu                                     | Sonuç                                         | Kısa gerekçe                                                                                                                                   |
| ----- | ---------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| K0s-1 | ScreenCaptureKit 60 sn                   | **GEÇTİ**                                     | 29,4 fps, CPU %1,1, RSS +1,6 MB, kendi pencere 118 yoklamada 0 (pozitif kontrol 7/7)                                                           |
| K0s-2 | VideoToolbox Baseline ana + düşük        | **FAIL (ölçüt)** · Chrome **ELLE**            | Anahtar kare zorlama ve Annex B çözme tam. p95 ≤ 10 ms yalnız 720p'de; 1080p 12,3 ms (C 11,8). Düşük gecikme kipi: 6,9 ms ama %12 kare atlıyor |
| K0s-3 | CGEvent, olay musluğu, Carbon kısayolu   | **GEÇTİ (otomatik kısım)** · 3 alt madde ELLE | Hata 0,00 px, Türkçe metin, Ctrl→⌘, musluk PID ayrımı. Carbon kısayolu paketsiz süreçte sentetik tuşla tetiklenmedi (C'de de); neden belirsiz  |
| K0s-4 | AppKit pencere/düğme/gösterge            | **GEÇTİ (otomatik kısım)** · 4 senaryo ELLE   | Teknisyen yolu sentetik tıklamaların %100'ü reddedildi; PID 0 taşıyan sentetik olay 0. Gösterge katman 1000 ve tüm alanlarda kuruldu           |
| K0s-5 | Paket, zip, klasör adından kod           | **KISMİ GEÇTİ** · tarayıcı/translocation ELLE | Arşiv İzlencesi `Destek-<kod>/` ve `Destek-<kod> (1)/` açtı, kod okundu. `open -n` kod dosyası doğru. Safari, Chrome, "Yine de Aç" elle        |
| K0s-6 | AudioQueue 5 dk + wazero arm64           | Ses **GEÇTİ** · kodek dalı **(c)**, yeni dal  | Kesinti 0. Derleyici karmaşıklık 2 ve 5'te tuzağa düşüyor, 0 ve 1'de eşit ve 0,2 ms. Yorumlayıcı ≥ 20 ms. Karar gerekir (A-PF-1)               |
| K0s-7 | Linux'ta iki darwin derlemesi, boyut, iz | **GEÇTİ** (boyut vekil ikiliyle)              | SHA iki mimaride eşit; universal zip 10,9 MiB. `~/Library` izi 0; `DARWIN_USER_CACHE_DIR` altında 1 Metal önbellek klasörü                     |

Tarih: 2026-11-17 · Branch: `main` (commit yok) · Kaynak: `docs/mimari-p28f.md` §9.1, ADR-0037 · Makine: Apple M4 Pro (14 çekirdek),
macOS 26.3.1 (a) 25D771280a, dahili Liquid Retina XDR. Ekran kipi ölçekli ("daha fazla alan"): 2056×1329 nokta × 2 = 4112×2658
piksel; panel 3456×2234.
Araçlar: Go 1.26.11 (go.dev resmi tarball, `~/sdk/go1.26.11`), purego v0.11.3, wazero v1.12.0 (yayımlanmış en son sürüm),
CI imajı `golang:1.26.11-bookworm@sha256:dc40a13b…` (`GO_IMAGE`), Apple clang 21 (yalnız C kontrol ölçümleri için).
**Üretim koduna dokunulmadı.** `apps/agent-win/go.mod` ve `go.sum` değişmedi; purego yalnız spike modülünde.

## 1. Düzenek

Kod `apps/agent-win/spike/p28f/` altında. Mimari §9.1 `cmd/spike-p28f/` diyordu; görev talimatıyla bu yola alındı.
Burası ayrı bir Go modülü: `module remote-support/agent-win/spike/p28f`, `replace remote-support/agent-win => ../..`.
Modül yolu `remote-support/agent-win` önekini taşıdığı için `internal/*` paketlerini içe aktarabiliyor. Ana modülün `./...`
kapsamına girmiyor; ana `go test`/`vet` ve CI etkilenmiyor. Her komut ayrı `package main`.

| Komut                           | Madde    | Ne yapar                                                                                                                                                                            |
| ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tcc/`                          | ön koşul | TCC durumlarını yalnız okur (diyalog açmaz)                                                                                                                                         |
| `k0s1sck/`                      | K0s-1    | SCShareableContent → SCContentFilter (kendi uygulama hariç) → SCStream NV12. Macenta "kendi pencere" yoklaması, `-noexclude` pozitif kontrol, `-withanim` hareket kaynağı, `-scale` |
| `k0s2vt/`                       | K0s-2    | VTCompressionSession ana (30 fps) + düşük (8 fps, 1 Mbit/s); AVCC→Annex B; Annex B yeniden ayrıştırılıp VTDecompressionSession'a verilir                                            |
| `k0s3input/`                    | K0s-3    | CGEventPost koordinat, CGEventPostToPid metin ve kısayol, CGEventTap PID alanı, Carbon `RegisterEventHotKey`. `-hkwait` fiziksel tuş denemesi için                                  |
| `k0s4appkit/`                   | K0s-4    | NSWindow + NSButton (Go'da kayıtlı ObjC hedef sınıfı) + gösterge. Düğme eyleminde `currentEvent.CGEvent` PID (41) ve stateID (45)                                                   |
| `k0s5app/` + `paketle.sh`       | K0s-5, 7 | `.app` içinde kendi yolu, translocation, klasör adından kod, `$TMPDIR` kod dosyası + `open -n`. `paketle.sh`: lipo, Info.plist, ad-hoc + hardened runtime, iki öğeli zip            |
| `k0s6audio/`                    | K0s-6    | AudioQueue 48 kHz mono Int16, 20 ms × 3 tampon, giriş + çıkış eşzamanlı. Çıkış sessizlik; giriş yalnız sayılır, saklanmaz                                                           |
| `k0s6codec/`                    | K0s-6    | libopus.wasm, wazero derleyici ↔ yorumlayıcı eşitliği (`TestP28dK0sCompilerMatchesInterpreter` yöntemi) ve süre ölçümü                                                              |
| `k0s7size/`                     | K0s-7    | Boyut/SHA **vekili**: flow, signal, rtc/pion, voice/wazero + wasm, fsrv, api ve purego/AppKit gerçekten bağlanır                                                                    |
| `kontrol-c/vtlat.c`, `hotkey.c` | K0s-2, 3 | Saf C kontrol ölçümleri. Ürüne girmez; yalnız "purego mu, platform mu?" ayrımı için                                                                                                 |
| `mac/`                          | ortak    | Çerçeveyi **mutlak yoldan** `Dlopen`, NSString, autorelease havuzu. `init`'te `runtime.LockOSThread`. RSS/CPU ölçümü `ps` ile                                                       |

**TCC notu (önemli):** Terminalden başlatılan süreçlerin izinleri, onları başlatan Claude uygulamasının (sorumlu süreç)
izinleridir. Başlangıç durumu şöyleydi: Erişilebilirlik, olay gönderme, Girdi İzleme ve Mikrofon izinli; Ekran Kaydı **izinsiz**.
Paketsiz `k0s1sck` koşuları da `SCShareableContent`'i bu sorumlu süreç kimliğiyle çağırdı (izin isteme davranışı tetiklenmiş
olabilir). Ekran Kaydı oturum içinde **izinli** duruma geçti (önce x86_64 süreçte, sonra arm64'te). Görünen bu izin
**Claude uygulamasına** ait. Sistem ayarlarına dokunmadım. Ayrıca spike'a özel `.app` kimliğiyle
(`net.noktabilisim.destek.spike`) bir kez `CGRequestScreenCaptureAccess` çağırdım; `false` döndü, yanıt beklenmedi. Bu nedenle
ölçümler gerçek TCC kararıyla yapıldı, ama kararlar uygulamanın **kendi** kimliğine ait değil.
"İzin verilince yeniden başlatmadan çalışma" gibi kimliğe bağlı akışlar ELLE kaldı. Spike kimliğinin TCC kaydını silmek için:
`tccutil reset ScreenCapture net.noktabilisim.destek.spike`.

Ortak komut öneki: `cd apps/agent-win/spike/p28f && export PATH=~/sdk/go1.26.11/bin:$PATH GOTOOLCHAIN=local CGO_ENABLED=0`.
x86_64 dilim: `GOARCH=amd64 go build -o /tmp/x ./<komut> && arch -x86_64 /tmp/x …`.

## 2. Madde bazında sonuçlar

### K0s-1 — ScreenCaptureKit (GEÇTİ)

Komut: `go build -o k1 ./k0s1sck && ./k1 -s 60 -withanim`. Pozitif kontrol: `./k1 -s 6 -noexclude`. x86_64:
`arch -x86_64 … -s 60 -withanim`.

| Koşul                                 | Teslim (Complete)   | CPU (süreç)             | RSS 5. sn → son       | Kendi pencere (macenta)               |
| ------------------------------------- | ------------------- | ----------------------- | --------------------- | ------------------------------------- |
| arm64, 4112×2658 NV12, 60 sn          | 1763 kare, 29,4 fps | 0,7 sn / 60,1 sn = %1,1 | 45,8 → 47,4 MB (+1,6) | 118 yoklamada 0                       |
| x86_64 (Rosetta), 4112×2658, 60 sn    | 1736 kare, 28,9 fps | %2,3                    | 17,3 → 16,5 MB (−0,8) | 116 yoklamada 0                       |
| arm64, `-scale 0.5` → 2056×1328 (GPU) | 29,2 fps (20 sn)    | %1,7                    | +0,6 MB               | 39 yoklamada 0                        |
| Pozitif kontrol: hariç tutma YOK      | —                   | —                       | —                     | 7 yoklamada **7** (Y=105 U=195 V=200) |
| Negatif kontrol: hariç tutma VAR      | —                   | —                       | —                     | 9 yoklamada 0 (Y=235 U=128 V=128)     |

- Blok tamamlayıcı (`getShareableContent…completionHandler:`), `SCStreamOutput` temsilci sınıfı (`objc.RegisterClass` +
  protokol), dispatch kuyruğu ve `setMinimumFrameInterval:` (değerle CMTime) purego ile çalıştı.
- İzin yokken komut bunu açıkça bildirdi: `SCStreamErrorDomain -3801` → çıkış kodu 3, sonuç "ELLE".
- **Bulgu: App Nap.** Arka plandaki (accessory) süreçler uyutuluyor. Hareket kaynağı ve yakalayıcıda App Nap kapatılmadan
  Complete teslim 7,6 fps'te kaldı. İkisinde de `NSProcessInfo beginActivityWithOptions:` (UserInitiated + LatencyCritical)
  açılınca 29 fps'e çıktı. Gerçek istemci oturum süresince bu etkinliği tutmalı (K2'ye not).
- SCK yalnız değişen kareyi "Complete" teslim eder. Ölçüm, ayrı süreçte 60 Hz renk değiştiren 480×320 bir pencereyle yapıldı.
  CPU yalnız süreç CPU'su (`ps`); WindowServer/GPU payı dahil değil.

### K0s-2 — VideoToolbox (ölçüt FAIL; Chrome ELLE)

Komut: `./k2 -s 8 [-w W -h H | -scale S] [-nolow] [-content static|noise] [-lowlat] [-speed]`. C kontrolü:
`clang -O2 -framework VideoToolbox -framework CoreMedia -framework CoreVideo -framework CoreFoundation kontrol-c/vtlat.c -o vtlat && ./vtlat W H 8 [1]`.

**Kaynak sentetik.** IOSurface destekli NV12 `CVPixelBuffer`, 8 tampon dönüşümlü; "static" içerik masaüstüne benzer (metin
deseni + kayan 400×300 kutu). Ana oturum 30 fps; bit hızı `bitrateFor` ile aynı formül (8 Mbit/s tavanlı); GOP 2 sn. Düşük
oturum aynı karelerle ≈ 7,5 fps, `DataRateLimits` 1 Mbit/s. İki oturum eşzamanlı. Ayarlar: `RealTime`, `Baseline_AutoLevel`,
`AllowFrameReordering=false`. Gecikme `EncodeFrame` çağrısından çıktı geri çağrısına kadar ölçüldü.

| Boyut                     | Donanım             | Ana p50 / **p95** / maks    | Düşük p95 | C kontrol p95 (yalnız ana) | Ana yalnız (`-nolow`) p95 |
| ------------------------- | ------------------- | --------------------------- | --------- | -------------------------- | ------------------------- |
| 1280×720                  | evet                | 6,64 / **7,05** / 19,3 ms   | 10,98 ms  | 6,67 ms                    | —                         |
| 1920×1080                 | evet                | 11,43 / **12,32** / 23,4 ms | 20,93 ms  | 11,82 ms                   | 12,31 ms                  |
| 2056×1328 (Retina ÷ 2)    | evet                | 9,54 / **15,51** / 24,4 ms  | 27,10 ms  | 15,03 ms                   | 15,42 ms                  |
| 4070×2630                 | evet                | 112,95 / **135,0** / 202 ms | 145,4 ms  | —                          | —                         |
| 4112×2658 (tam Retina)    | **hayır** (yazılım) | 217,8 / 231,8 / 420 ms      | 62 ms     | —                          | —                         |
| 1920×1080, x86_64 Rosetta | evet                | 6,24 / 32,75 / 272,8 ms     | 23,79 ms  | —                          | —                         |

- **Anahtar kare zorlama:** `kVTEncodeFrameOptionKey_ForceKeyFrame` ile tüm koşullarda zorlanan karelerin tamamı IDR geldi
  (ana 3/3, düşük 1/1), kaçan 0.
- **Annex B:** Anahtar karede SPS/PPS öne eklendi. Akış yeniden NAL'lere ayrıldı, erişim birimlerine bölündü, SPS/PPS'ten biçim
  tanımı kuruldu ve `VTDecompressionSession`'a verildi. 720p, 1080p ve 2056×1328'de çözülen kare sayısı kodlanan kare sayısına
  eşit (ör. 240/240 ve 60/60), çözme hatası 0. Bu, Chrome yerine Apple çözücüsüyle yapılmış bir vekil ölçüm.
- **Ölçüt (p95 ≤ 10 ms) yalnız 720p'de tuttu.** Saf C kontrolü aynı değerleri verdi (fark ≤ 0,6 ms); gecikme purego'dan
  gelmiyor. `VTCompressionSessionEncodeFrame` purego çağrı maliyeti µs düzeyinde.
- **Donanım H.264 genişlik sınırı.** Bu makinenin tam Retina boyutu 4112 piksel. Donanım kodlayıcı bunu kabul etmedi; yazılım
  kodlayıcıya düştü (p95 232 ms). 4070 genişlikte donanım çalıştı ama p95 135 ms. ADR m.2 "üst sınır mevcut `capture/select.go`
  kuralı" diyor, ama `select.go`'da boyut tavanı yok (Windows yerel boyutta kodluyor). **macOS için yeni bir tavan gerekir.**
- **Düşük gecikmeli oran denetimi** (`-lowlat`, `kVTVideoEncoderSpecification_EnableLowLatencyRateControl`, Baseline):

  | Boyut     | Ana p95 (düşükle birlikte) | Ana p95 (yalnız ana) | Atlanan kare (`kVTEncodeInfo_FrameDropped`) | Zorlanan IDR |
  | --------- | -------------------------- | -------------------- | ------------------------------------------- | ------------ |
  | 1920×1080 | 9,98 ms                    | **6,88 ms**          | 29/240 (%12); düşük 20/60                   | 2/3          |
  | 2056×1328 | 9,12 ms                    | **8,99 ms**          | 30/240; düşük 22/60                         | 2/3          |
  - Gecikme ölçütü bu kipte tutuyor.
  - Bedeli: oran denetimi kare atlıyor. Atlanan karelerden biri zorlanan anahtar kareydi.
  - Bu kipte `UsingHardwareAcceleratedVideoEncoder` okunamıyor (−12900), yani donanım kullanımı belirsiz.
  - Çözme hatası 0 (211/211).
  - Bu kip bir aday. Kare atlamanın nedeni (bit hızı, kare zamanlaması) incelenmedi; K3'te gerçek içerikle ölçülmeli.

- **Diğer denemeler:** `PrioritizeEncodingSpeedOverQuality=true` gecikmeyi değiştirmedi (1080p p95 Go 12,15 ms, C 12,00 ms).
  `MaxFrameDelayCount=0` desteklenmiyor (−12900).
- **Bit hızı tavanı tutmadı.** Düşük oturum ölçümü 1,2–2,2 Mbit/s; `DataRateLimits` 1 Mbit/s, pencere 1 sn. Ana oturumda gürültülü
  içerik 10,8 Mbit/s'e çıktı (hedef 6,1). K3'te oran denetimi gerçek içerikle yeniden ölçülmeli.
- **ELLE:** Annex B'nin mevcut `rtc` ile Chrome konsoluna yayını ve Chrome'da çözülmesi (sunucu + konsol gerekir).

### K0s-3 — Girdi (otomatik kısım GEÇTİ; 3 alt madde ELLE)

Komutun kendi son satırı `GEÇTİ=false` yazar, çünkü Carbon alt maddesini de içerir. Aşağıdaki "otomatik kısım" koordinat,
metin, Ctrl→⌘ ve musluk alt maddeleridir.

Komut: `./k3 -tap 3`. Fiziksel kısayol denemesi: `./k3 -hkwait 20s` (bu sürede Control+Shift+F12'ye basılır).

Kullanıcı ölçüm sırasında fareyi kullanıyordu. Musluk her yerel olayı gördü; o pencereye düşen ölçümler geçersiz sayılıp
yinelendi (arm64'te 10, x86_64'te 23 yineleme). İmleç her koşunun sonunda eski yerine kondu.

| Alt madde                                                                                | arm64                                       | x86_64 (Rosetta) |
| ---------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------- |
| 0–1 → nokta → CGEventPost(HID), ±2 px (7 hedef, köşeler dahil; 4112×2658 ölçekli Retina) | en büyük hata **0,00 px**                   | 0,00 px          |
| `çğıöşüİ ÇĞÖŞÜ`, `CGEventKeyboardSetUnicodeString`, yalnız kendi PID'imize               | gönderilen = alınan                         | aynı             |
| Ctrl→⌘ (C, V, Z, A, X → kVK 8, 9, 6, 0, 7 + Command bayrağı)                             | 5/5                                         | 5/5              |
| Musluk: kendi olayımız `kCGEventSourceUnixProcessID` = kendi PID                         | 9–33 olay, başka PID 0                      | aynı             |
| Musluk: yerel (donanım) olay PID 0                                                       | **görüldü** (213, 28, 41 olay)              | görüldü          |
| Carbon `RegisterEventHotKey` Control+Shift+F12, uygulama arka planda                     | kayıt rc=0; sentetik tuşla tetiklenme **0** | —                |

- **Carbon kısayolu:** HID ve oturum musluğuna, HID durum kaynağıyla, değiştirici tuşlarla birlikte gönderildi. Ayrıca ikinci
  bir süreçten gönderildi. Tetiklenme 0; musluk F12 basışını gördü, yani tuş kısayol eşlemesinden geçip uygulamaya ulaştı.
  Saf C kontrolü (`kontrol-c/hotkey.c`, `RunCurrentEventLoop`) da 0 verdi; **purego'yla ilgisi yok.** Neden belirsiz. İki
  açıklama mümkün: (1) sentetik olaylar Carbon kısayolunu tetiklemiyor, (2) paketsiz (bundle'sız) süreçte kısayol kaydı etkisiz.
  İkisi ayrılamadı. Fiziksel tuşla ve `.app` içinden arka planda tetiklenme **ELLE**. Sentetik olayla CI'da sınanabileceği
  varsayılmamalı.
- **ELLE (3 alt madde):**
  1. Carbon kısayolu (yukarıda).
  2. Erişilebilirlik izni sonradan verilince yeniden başlatmadan çalışma (uygulamanın kendi kimliği gerekir).
  3. Başka ölçekli çözünürlük kipleri (yalnız geçerli kip ölçüldü; çözünürlük değiştirmek sistem ayarıdır).

### K0s-4 — AppKit (otomatik kısım GEÇTİ; 4 senaryo ELLE)

Komut: `./k4 -n 20` (ayrıntı için `-v`). ELLE senaryolar: `./k4 -n 0 -wait 60s`.

- `objc.RegisterClass` ile Go'da tanımlanan hedef/eylem (`clicked:`) NSButton'dan çağrıldı. Ret kuralı: eylemde
  `NSApp.currentEvent.CGEvent` → alan 41 (kaynak PID) 0 değilse ret.

| Tıklama kaynağı                                                        | Uygulamaya ulaşan basış | Düğme eylemi | Ret | Kabul |
| ---------------------------------------------------------------------- | ----------------------- | ------------ | --- | ----- |
| Kendi süreç, `CGEventPost(kCGHIDEventTap)` — teknisyen girdisinin yolu | 20 (PID = kendi)        | 19           | 19  | **0** |
| Aynı, temiz koşu (n=6)                                                 | 6                       | 6            | 6   | **0** |
| Kendi süreç, `CGEventPostToPid`                                        | 20 (PID = kendi)        | 0            | —   | **0** |
| Başka süreç, `CGEventPostToPid`                                        | 20 (PID = gönderen)     | 0            | —   | **0** |
| x86_64 (Rosetta), üç yol, n=5                                          | 15                      | 5            | 5   | **0** |

- **PID 0 taşıyan sentetik basış: 0** (60, 18 ve 15 sentetik basışta). Ölçüt "sentetik tıklama %100 reddedilir" otomatik kısımda
  tuttu. `CGEventPostToPid` tıklamaları uygulamaya ulaşıyor, ama NSButton eylemini hiç tetiklemiyor.
- **Gözlem (doğrulanması ELLE):** İki koşuda, sentetik tıklamalardan farklı konumda ve zamanda `stateID=1` (HIDSystemState),
  PID 0 basışlar geldi; düğme bunları KABUL etti (toplam 5). Boş bekleme kontrolünde ve sonraki temiz koşuda hiç görülmediler.
  Bunlar büyük olasılıkla makinedeki kişinin gerçek tıklamaları; spike üretmedi. Beklenen davranışla uyumlu.
- **Öneri (güvenlik turu, T1):** PID'e ek olarak alan 45 (`kCGEventSourceStateID`) = 1 şartı ikinci bir doğrulama olarak
  değerlendirilebilir. Sentetik olaylarda bu alan 0 ölçüldü, ama yalnız NULL olay kaynağıyla. HID durum kaynağıyla
  (`CGEventSourceCreate(kCGEventSourceStateHIDSystemState)`) üretilen tıklamada bu alan sınanmadı; öneri bu nedenle
  doğrulanmamış.
- **Gösterge:** Pencere sunucusunda ekranda, katman 1000 (`NSScreenSaverWindowLevel`), `collectionBehavior` = 0x151
  (canJoinAllSpaces | stationary | ignoresCycle | fullScreenAuxiliary), etkin masaüstünde. Fareyi geçiriyor; 1 sn'de bir öne
  alınıyor.
- **ELLE:** Göstergenin dört senaryoda görünmesi (tüm masaüstleri, tam ekran uygulamanın üstü, Görev Kontrolü sonrası ≤ 1 sn).
  Masaüstü değiştirmek ve tam ekrana geçmek kullanıcı ortamına müdahale olduğu için otomatikleştirilmedi.

### K0s-5 — Paket ve kod (KISMİ GEÇTİ; tarayıcı yolları ve translocation ELLE)

Komut: `GOARCH=arm64 go build … -o a ./k0s5app && GOARCH=amd64 go build … -o x ./k0s5app && ./paketle.sh a x OUT 12345678`,
ardından `open -a "Archive Utility" OUT/Destek-12345678.zip` ve `open -W ".../Destek-12345678/Nokta Destek.app" --args -out sonuc.txt`.

- **Zip:** `ditto -c -k` ile oluşturuldu. İki üst düzey öğe var: `Nokta Destek.app` ve `OKUBENI.txt`. Paket universal
  (x86_64 + arm64), ad-hoc imzalı, hardened runtime açık.
- **Arşiv İzlencesi:** Zip'i yanına `Destek-12345678/` klasörü olarak açtı. Aynı zip `Destek-12345678 (1).zip` adıyla
  verildiğinde (tarayıcının yinelenen indirme adı) `Destek-12345678 (1)/` açıldı. Uygulama her iki durumda da klasör adından
  `kod="12345678"` okudu. Klasör kuralı `pairing.go`'daki `(?: ?\(\d{1,3}\))?` ekinin klasör karşılığı. Finder'da zip'e çift
  tıklamak aynı Arşiv İzlencesi yolunu kullanır.
- **`open -n` ile yeniden başlatma:** İlk örnek kodu `$TMPDIR/nk-*.kod` dosyasına 0600 izinle yazdı. İkinci örnek dosyayı
  denetledi (sembolik bağ değil, 0600, ≤ 120 sn), okudu (`"12345678"`) ve sildi. Dosya geride kalmadı.
- **Translocation:** `SecTranslocateIsTranslocatedURL` bağlaması çalıştı (normal yolda `false`). Translocation yapay olarak
  üretilemedi: `SecTranslocateCreateSecureDirectoryForURL` EPERM döndü. Karantinalı ad-hoc kopyayı `spctl` reddetti
  (`rejected`), yani "Yine de Aç" gerekiyor. **ELLE:** Karantinalı zip'i "Yine de Aç" ile açıp özgün yolun çözülmesi.
- **ELLE:** Safari'nin "güvenli dosyaları aç" ile otomatik açması (klasör adı oluşuyor mu?) ve Chrome indirmesi. Ölçüt "3 yolun en
  az ikisi": çift tık / Arşiv İzlencesi yolu ölçüldü ve geçti; ikinci yol elle doğrulanacak. Klasör adı FAIL olursa kod alanına
  düşülür (AC-97), ek iş yok.

### K0s-6 — Ses (AudioQueue GEÇTİ; kodek dalı belirlendi: literal ağaçta (c), yeni (a′) önerisi)

Komutlar: `./k6a -d 300s` (AudioQueue) ve `./k6c -wasm ../../internal/voice/libopus.wasm -eqframes 1000 -frames 300` (kodek).
x86_64 için aynı komutlar `arch -x86_64` ile.

**AudioQueue:** 48 kHz mono Int16, 20 ms × 3 tampon, varsayılan aygıt, giriş ve çıkış eşzamanlı. Geri çağrılar
`purego.NewCallback` ile AudioQueue'nun kendi (Go dışı) iş parçacığında çalıştı. Kesinti tanımı ölçümden önce yazıldı. Şu
üçünden biri kesinti sayılır: iki geri çağrı arası 60 ms'den uzun; duvar saatine göre 2880'den fazla örnek eksik; API hatası.

| Koşu          | Yön         | Geri çağrı  | En büyük aralık | > 60 ms | Eksik örnek   | Hata | Kesinti |
| ------------- | ----------- | ----------- | --------------- | ------- | ------------- | ---- | ------- |
| arm64, 300 sn | çıkış       | 15004       | 27,3 ms         | 0       | −2023 (fazla) | 0    | **0**   |
| arm64, 300 sn | giriş       | 15002       | 31,4 ms         | 0       | 103           | 0    | **0**   |
| x86_64, 60 sn | çıkış/giriş | 3010 / 3007 | 24,9 / 28,9 ms  | 0       | −2622 / 446   | 0    | **0**   |

RSS 32,6 → 34,9 MB (5 dk). Mikrofon izni sorumlu sürecin (Claude) iznidir.

**wazero v1.12.0 (en son sürüm), libopus.wasm sha256 `715ac5d3…`:** 3 tohum × 1000 çerçeve; kodla, sağlam ve bozuk paketi çöz;
SHA-256 karşılaştır.

| Karmaşıklık | arm64 derleyici = yorumlayıcı                      | amd64 (Rosetta) derleyici = yorumlayıcı | arm64 yorumlayıcı 1 kodla + 3 çöz p95 | arm64 derleyici p95 |
| ----------- | -------------------------------------------------- | --------------------------------------- | ------------------------------------- | ------------------- |
| 0           | **eşit** (3/3)                                     | eşit                                    | 26,05 ms (yalnız koşuda 20,8)         | **0,21 ms**         |
| 1           | **eşit** (3/3)                                     | eşit                                    | 31,5 ms                               | **0,23 ms**         |
| 2           | derleyici **tuzak** (çerçeve 0, sınır dışı bellek) | eşit                                    | 28,17 ms (yalnız koşuda 24,29)        | —                   |
| 5 (hedef)   | derleyici **tuzak** (çerçeve 0)                    | eşit (Rosetta derleyici p95 0,35 ms)    | 32,27 ms (yalnız koşuda 29,16)        | —                   |

- Literal karar ağacı (ADR m.7): (a) hedef karmaşıklık 5'te arm64 derleyicisi eşitlik testini **geçmedi** (A-PD-3 hatası
  sürüyor). (b) Yorumlayıcı karmaşıklık 0'da bile 20–26 ms; ≤ 10 ms bütçesini **tutmadı**. → **(c)**.
- **Yeni bulgu, (a′) dalı:** arm64 derleyicisi karmaşıklık **0 ve 1'de** yorumlayıcıyla bayt bayt eşit ve 0,2 ms/çerçeve.
  - **Çözücü ek eşitliği** (`-fixtures ../../internal/voice/testdata/opus-fixtures.txt -onlyfix`) de **eşit** çıktı. Kapsam:
    5 fikstür (opus-go kaynaklı stereo, CELT ve farklı çerçeve boyları), normal ve FEC çözme, 3'er PLC, kendi kodlayıcımızın
    300 paketinde kayıp + PLC + FEC deseni.
  - Kapsam sınırı: eşitlik bu girdilerle sınandı. Tüm Opus akışları için kanıt değil; Chrome'dan gelen gerçek yük yok.
  - Olası açıklama (libopus kaynağına karşı **doğrulanmadı**): SILK, karmaşıklık < 2'de gecikmeli karar nicemleyicisini
    (`silk_noise_shape_quantizer_del_dec`, A-PD-3'te hatalı derlendiği düşünülen yol) kullanmıyor.
  - Seçenek: arm64'te kodlayıcı karmaşıklığı 1 + derleyici. Bedeli: Windows'taki 5'e göre bir miktar ses kalitesi kaybı
    (ölçülmedi).
  - Bu dal ADR'nin karar ağacında yok; **A-PF-1 kapsamında mimar ve kullanıcı kararı gerekir.**
- **Hardened runtime ve JIT (ADR m.6):** Ad-hoc imza + `--options runtime` ile sınandı.
  - arm64 derleyici, entitlement yokken **SIGKILL (137)** aldı; yalnız `allow-jit` ile de aynı. Yalnız
    `com.apple.security.cs.allow-unsigned-executable-memory` ile çalıştı.
  - x86_64 Rosetta altında üçü de çalıştı. Bu gerçek Intel'i temsil etmez (A-PF-3).
  - Sonuç: (a′) seçilirse bu entitlement universal ikili için **zorunlu**. Güvenlik turu (T10) bunu değerlendirmeli.

### K0s-7 — Tekrarlanabilirlik, boyut, iz (GEÇTİ; boyut vekil)

Komut (iki kez, farklı bağlama yollarıyla):
`docker run --rm --platform linux/amd64 -v "$PWD:/src" -w /src/spike/p28f -e CGO_ENABLED=0 -e GOFLAGS=-mod=mod golang:1.26.11-bookworm@sha256:dc40a13b… sh -c 'GOOS=darwin GOARCH=$a go build -trimpath -ldflags "-s -w -buildid=" -o /out/b$n-$a ./k0s7size'`.
İkinci derlemede `/src` yerine `/baska/yol` kullanıldı.

| İkili (Linux'ta çapraz derleme) | Derleme 1 SHA-256          | Derleme 2 | Boyut                               |
| ------------------------------- | -------------------------- | --------- | ----------------------------------- |
| darwin/arm64                    | `78df6fc5098b106b…2255558` | **eşit**  | 14 078 178 B                        |
| darwin/amd64                    | `00d6b76ed73e3e8d…0822647` | **eşit**  | 15 011 472 B                        |
| universal (`lipo`, macOS'ta)    | —                          | —         | 29 186 656 B                        |
| **zip** (`paketle.sh`, iki öğe) | —                          | —         | **11 400 680 B (10,9 MiB) ≤ 60 MB** |

- Boyut **vekil** ikiliyle ölçüldü. Ağır bağımlılıklar gerçek: pion, wazero + wasm, flow ve purego. UI ve yakalama kodu henüz
  yok; gerçek istemci biraz büyür, ama 60 MB'a yaklaşmaz.
- Aynı kaynak macOS'ta derlenince SHA farklı çıktı (boyut aynı). `go version -m` farkı yalnız VCS damgası: macOS'ta `.git`
  görünüyordu (`vcs.revision`, `vcs.modified=true`), Docker'a yalnız `apps/agent-win` bağlandığı için orada yoktu. Araç zinciri
  farkı değil. ADR m.1'e uygun: kanonik derleme Linux'ta; macOS yalnız `lipo` ve imza için.
- **İz (boş çalıştırma).** Yöntem: `.app` `open -W` ile açıldı; AppKit penceresi 2 sn göründü; `open -n` ile ikinci örnek
  başladı. Öncesi ve sonrası **ad eşleşmesiyle** tarandı. Taranan yerler:
  - `~/Library` altında: Application Support, Caches, Preferences, LaunchAgents, Saved Application State, HTTPStorages,
    WebKit, Containers, Logs, Application Scripts;
  - `getconf DARWIN_USER_CACHE_DIR` ve `$TMPDIR`;
  - ek olarak: `~/Library`'de işaret dosyasından yeni olup adında `noktabilisim` / `noktadestek` geçen dosyalar;
  - **içerik** taraması: `~/Library/Preferences` ve `~/Library/Application Support/com.apple.sharedfilelist` (son kullanılanlar)
    içinde bundle kimliği aranıp bulunmadı.
  - `~/Library`: **0** (`defaults read net.noktabilisim.destek.spike` → alan yok; savedState yok).
  - **1 iz:** `$(getconf DARWIN_USER_CACHE_DIR)/net.noktabilisim.destek.spike/com.apple.metalfe`. AppKit çizimiyle Metal
    gölgelendirici önbelleği klasörü oluşuyor; `/var/folders/…/C/` altında, `~/Library` dışında. Önlem: kapanışta bu klasör
    silinir (savedState emniyetinin yanına). `trace-check-mac.sh` taramasına `DARWIN_USER_CACHE_DIR` eklenmeli; mimari §9 yalnız
    `$TMPDIR` diyor, `C/` kardeş dizini kapsamıyor.
  - `$TMPDIR` kod dosyası okunduktan sonra silindi (`nk-*.kod` 0).
  - Ölçüm sırasında `~/Library/Preferences` içinde sistem plist'leri (HIToolbox ve diğerleri) değişti; uygulamaya özgü dosya yok.
  - Spike'ın oluşturduğu önbellek klasörü ölçümden sonra silindi.

## 3. ADR-0037'ye etkisi — r2 gerekir mi?

**Evet. Ama FAIL dalındaki cgo geçişi için değil.** K0s-1 geçti. K0s-4'ün otomatik kısmı geçti. K0s-2'deki gecikme FAIL'inin
purego'dan gelmediği C kontrolüyle gösterildi. m.1 (purego, `CGO_ENABLED=0`, Linux'ta tekrarlanabilir derleme) **olduğu gibi
kalır.** r2'de düzeltilecek maddeler:

1. **m.2 kodlama boyutu.** "`select.go` üst sınırı" diye bir kural yok. Donanım H.264 bu makinede 4112 genişliği kabul etmiyor;
   ≥ 4070 genişlikte p95 > 130 ms. Önerim: macOS'ta uzun kenar tavanı (ör. Retina ÷ 2 ya da ≤ 1920). SCK bunu GPU'da yapıyor
   (`-scale 0.5` ile 29 fps ölçüldü). Mimarın ayrıca **K0s-2 ölçütü ile kodlayıcı kipini birlikte seçmesi** gerekir. Seçenekler:
   - (i) RealTime + Baseline (mimarideki ayar): kare atlamıyor, 1080p p95 12,3 ms (C'de 11,8). Ölçüt "30 fps sürdürülebilir,
     p95 ≤ 1 kare süresi (33 ms), kare kaybı 0" olarak yazılabilir, ya da 10 ms ölçütü yalnız ≤ 720p için tutulabilir.
   - (ii) `EnableLowLatencyRateControl`: 1080p p95 6,9 ms, ama ≈ %12 kare atlıyor ve bir zorlanan IDR'yi düşürdü. K3'te
     gerçek içerikle incelenmeden seçilmemeli.
2. **m.7 ses dalı.** Literal ağaç (c)'ye düşüyor. Yeni (a′) dalı var: arm64'te derleyici + kodlayıcı karmaşıklığı 1 (eşit,
   0,2 ms). Ağaca eklenmeli; **A-PF-1 kullanıcı kararı** gerekir: (a′) mı, (c) arm64'te ses yok mu, yoksa cgo libopus mu?
3. **m.6 entitlement.** arm64 derleyici yolu `allow-unsigned-executable-memory` olmadan hardened runtime'da öldürülüyor;
   `allow-jit` yetmiyor. (a′) seçilirse entitlement kesinleşir; T10 güvenlik turunda değerlendirilir. (c) seçilirse gerekmez.
4. **m.8 iz.** `DARWIN_USER_CACHE_DIR/<bundle id>` (Metal önbelleği) kapanışta silinir; iz testi bu dizini de tarar.

Ek notlar (r2'ye ya da ilgili K paketine): App Nap'i oturum süresince `NSProcessInfo` etkinliğiyle kapatmak (K0s-1). T1'e
stateID = 1 ikinci denetimi, doğrulanmadı (K0s-4). Carbon kısayolunun paketsiz süreçte sentetik tuşla tetiklenmediği; nedeni
belirsiz, `.app` içinden fiziksel tuşla sınanacak (K0s-3). Düşük izde `DataRateLimits`'in tavanı tutmadığı (K0s-2; K3'te
gerçek içerikle).

## 5. Spike'ın makinede bıraktığı yan etkiler

- **Go 1.26.11:** `~/sdk/go1.26.11` altında. go.dev SHA-256'sı doğrulandı. Modül önbelleği `~/go/pkg/mod`.
- **Ekran Kaydı izni:** Oturum içinde Claude uygulamasına verilmiş durumda görünüyor (§1 TCC notu). Spike bunu değiştirmedi.
- **TCC kaydı:** Spike kimliği `net.noktabilisim.destek.spike` için bir Ekran Kaydı TCC kaydı oluşmuş olabilir. Silmek için:
  `tccutil reset ScreenCapture net.noktabilisim.destek.spike`.
- **Ölçüm sırasında makine kullanımı:**
  - Mikrofon 5 dk açık kaldı (turuncu gösterge). Ses kaydedilmedi; yalnız örnek sayıldı.
  - Hoparlöre sessizlik çalındı.
  - İmleç birkaç kez kısa süre taşındı ve geri kondu.
  - Ekrana kısa süre spike pencereleri açıldı: macenta kare, kırmızı gösterge şeridi, "İzin ver" penceresi, hareket kaynağı.
  - HID'e Control+Shift+F12 gönderildi.
  - Ekran yakalamada kare içeriği saklanmadı; yalnız tek piksel yoklandı.
- **Geçici dosyalar:** Tüm derleme çıktıları ve paketler oturumun scratchpad dizininde. Metal önbellek klasörü silindi.

## 4. ELLE listesi (operatör: Apple Silicon, macOS 26.3; spike `.app` ya da istemcinin kendi kimliği)

| Madde | Yapılacak                                                                                                     | Komut / araç                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| K0s-2 | Annex B'yi `rtc` ile Chrome konsoluna yayınla, Chrome'da çözülüyor mu                                         | K1 iskeleti sonrası (sunucu + konsol)                                    |
| K0s-3 | Erişilebilirlik izni sonradan verilince yeniden başlatmadan girdi; fiziksel Control+Shift+F12 arka planda     | `.app` içinde `k0s3input -hkwait 20s`                                    |
| K0s-3 | Başka ölçekli çözünürlük kipleri ve harici ekran                                                              | `k0s3input` (her kipte)                                                  |
| K0s-4 | Gösterge: tüm masaüstleri, tam ekran uygulama üstü, Görev Kontrolü sonrası ≤ 1 sn; gerçek tıklama KABUL       | `k0s4appkit -n 0 -wait 60s`                                              |
| K0s-5 | Safari otomatik açma ve Chrome indirmesi → `Destek-<kod>/`; karantinalı zip "Yine de Aç" + translocation yolu | `paketle.sh` çıktısını staging'den indir; sonuç `$TMPDIR/k0s5-sonuc.txt` |
| K0s-1 | Ekran Kaydı izni uygulamanın kendi kimliğine verilip yeniden başlatma akışı                                   | `.app` içinde `k0s1sck -request`, izin ver, yeniden aç                   |
