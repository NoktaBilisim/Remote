# P28d K0s — opus-go spike sonuçları (geçici; K3 sonunda implementation.md'ye taşınır)

Tarih: 2026-11-17 · Dal: p28d (111605a + mimari r2 11377c5 ölçütleri) · Yazan: backend-dev (Go)

## Karar

**opus-go v1.6.0: KALDI.** Önerilen yol, ADR-0036 revizyonu ve A-PD-1'dir. r2 sırasına göre önce **wazero + libopus.wasm**,
sonra **gopus** denenir.

Gerekçe (bağlayıcı iki ölçüt kırmızı):

1. **`go test -race` temiz değil (r2 ölçütü b).** `checkptr` daha `opus.NewEncoder` çağrısında süreci düşürüyor:
   `fatal error: checkptr: pointer arithmetic result points to invalid allocation`, `opusccenc.Opus_silk_Get_Encoder_Size`.
   Upstream'in kendi `go test -race github.com/kazzmir/opus-go/opus` koşusu da aynı hatayla düşüyor. CI `check` job'u
   (`go test -race -count=1 ./...`) bu bağımlılıkla kırmızı olur. Bu bir `recover` ile yakalanamaz.
2. **Bellek güvenliği (Y-PD-2; mimari-p28d §11 K0s fuzz ölçütü).** Uzaktan gelen bozuk paketlerde çevrilmiş kod paniğe düşüyor:
   `silk/resampler.c:193 assertion failed: inLen >= S->Fs_in_kHz` (`celt_fatal` → `libcshim.Xabort` → `panic`). Bu panik
   **deterministik değil**: aynı 20 000 paketlik dizi aynı sırayla verildiğinde sonuç değişiyor.

   | Koşul (aynı girdi dizisi)               | Yalıtılan panik / 20 000 paket (koşu başına) |
   | --------------------------------------- | -------------------------------------------- |
   | `GOGC=off`                              | 0 0 0 0 0 0 0 0 0 0                          |
   | `GOGC=100` (varsayılan)                 | 0 1 1 0 0 0 0 0 1 0                          |
   | `GOGC=1`                                | 4 2 5 3 3 1 2 2 3 4                          |
   | `GOGC=1` + `GODEBUG=gcshrinkstackoff=1` | 0 0 0 0 0                                    |

   Aynı panik paketi tek başına ya da taze bir çözücüde 2000 kez çözüldüğünde 0 panik veriyor. **Kök neden için güçlü
   gösterge (kanıtlanmış değil):** Çevrilmiş kod adresleri `uintptr` olarak taşıyor (`opuscc` içinde 575 ham
   `uintptr(unsafe.Pointer(&…))` eşleşmesi var; bunların bir kısmı yığın değil heap adresi). GC goroutine yığınını küçültüp taşıdığında bu adresler bayatlıyor. Kod bundan
   sonra eski yığın belleğini okuyor; sonuç bozuk durum ve assert oluyor. Eski yığına _yazma_ doğrudan gözlenmedi. Upstream `opus/cbuf.go`
   yorumu aynı hata sınıfını kendi API sınırında gördüğünü yazıyor. Düzeltme yalnız o sınırda yapılmış, çevrilmiş iç kodda
   sorun duruyor. Bu yüzden `recover` belirtiyi örter ama yazmanın başka bir goroutine'in belleğine denk gelmesini
   önleyemez.

   `gcshrinkstackoff` ve `GOGC` koşuları linux/arm64'te, panik nedenini yazdıran yamalı bir kopyada yapıldı (davranış
   aynı). Hipotez kontrolü: Shim'in `TLS.Alloc` yığın büyütmesi (yeniden ayırma) hiç tetiklenmedi; büyütmede panik atan
   yamalı kopyada panik sayısı değişmedi. Neden o değil, yığın küçültmedir.

Diğer ölçütler geçti (tablo aşağıda). opus-go'nun ikili boyutu, hızı ve tekrarlanabilir derlemesi sorunsuz. Kırmızı
olanlar güvenlik ve CI kapısı.

## Ölçüm tablosu

| Ölçüt (mimari-p28d §11 K0s, r2)                                                     | Sonuç                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Tür                             |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `CGO_ENABLED=0` derleme                                                             | GEÇTİ (`build.sh`, saf Go, C araç zinciri yok)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ölçüldü                         |
| İki derlemede SHA eşit                                                              | GEÇTİ: a = b = `6d3700c27fa5b157fcc83802ee17820d8d382754a8fd64039b6b3df76a0c82fa`                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ölçüldü                         |
| İkili büyümesi ≤ 5 MB                                                               | GEÇTİ: 13 402 112 → 14 524 928 B, **+1 122 816 B (≈ 1,07 MiB)**                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ölçüldü                         |
| Kodlama 20 ms mono ≤ 2 ms/çerçeve                                                   | GEÇTİ (vekil): arm64 yerel **0,19 ms**, linux/amd64 (Rosetta öykünmesi) **0,25–0,27 ms**                                                                                                                                                                                                                                                                                                                                                                                                                                               | vekil; referans Windows'ta elle |
| Çözme 20 ms                                                                         | arm64 **0,036 ms**, amd64 öykünme **0,046 ms**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | vekil                           |
| Gidiş-dönüş doğruluğu                                                               | GEÇTİ: SNR 4,6 dB (VOIP/SILK, 32k VBR, ölçülen hız 31,0 kbit/s, gecikme 303 örnek); aynı sinyalde AUDIO/CELT 17,5 dB                                                                                                                                                                                                                                                                                                                                                                                                                   | ölçüldü                         |
| PLC (`Decode(nil)`), FEC yolu                                                       | GEÇTİ: 960 örnek döndü, hata yok, gizleme sessiz değil (rms > 100), sonraki paket çözüldü                                                                                                                                                                                                                                                                                                                                                                                                                                              | ölçüldü                         |
| Stereo / 5–10–60 ms paket mono çözücüde                                             | GEÇTİ (opus-go kodlayıcısının ürettiği paketlerle)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ölçüldü                         |
| Chrome'un gönderdiği Opus çözülüyor                                                 | **staging'de elle** (gerçek Chrome WebRTC yükü kullanılmadı)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ertelendi                       |
| WASAPI yakalama/çalma                                                               | İskelet var; `GOOS=windows go vet/build` ve staticcheck temiz. Donanım testi **Windows'ta elle**                                                                                                                                                                                                                                                                                                                                                                                                                                       | ertelendi                       |
| `go test -race` temiz (r2 b)                                                        | **KALDI**: checkptr fatal (`opusccenc.Opus_silk_Get_Encoder_Size`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ölçüldü                         |
| Fuzz `FuzzDecode` ≥ 30 dk (Y-PD-2)                                                  | 30 dk 1 sn, **58 403 993 çalıştırma**, 1565 korpus girdisi, `PASS`/`EXIT=0`. Anlamı: sarmalayıcıdan panik sızmadı, runtime fatal ve zaman aşımı yok. Bu "temiz" demek **değil**: hedef yalıtılmış panikleri yutar, işçi süreçlerinin stderr çıktısı da günlüğe gelmediği için kaç panik yalıtıldığı bilinmiyor (Karar 2). Koşu ilk sarmalayıcı anlık görüntüsüyle (recover + 1275 B sınırı, hız sınırı ve düşürme öncesi), linux/arm64 üzerinde yapıldı. Chrome'dan yakalanmış paket tohumu yok; tohumlar opus-go kodlayıcı paketleri. | ölçüldü                         |
| Bozuk paket, panik yalıtımı                                                         | Sarmalayıcıdan panik sızmıyor; ancak panik GC'ye bağlı (bkz. Karar 2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ölçüldü                         |
| İçe aktarım denetimi (r2, O-PD-4)                                                   | GEÇTİ: bağlanan paketler (`go list -deps`: `opus`, `opuscc`, `opusccenc`, `libcshim`, `ogg`) `os/exec`, `net`, `syscall` içe aktarmıyor ve `func init()` içermiyor. `os` yalnız `os.Stderr` için kullanılıyor (`libcshim` ve `opuscc` içinde birer kez, `celt_fatal` iletisi)                                                                                                                                                                                                                                                          | ölçüldü                         |
| govulncheck v1.7.0 (windows/amd64 + linux)                                          | GEÇTİ: "No vulnerabilities found."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ölçüldü                         |
| go-licenses v2.0.1                                                                  | GEÇTİ (`check` çıkış kodu 0): `github.com/kazzmir/opus-go … BSD-3-Clause`                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ölçüldü                         |
| gofmt, vet (linux + windows), staticcheck v0.8.2 (linux + windows), `go test ./...` | GEÇTİ (`internal/rtc` TestAC367'de bir kez ICE kararsızlığı görüldü, 3 tekrarda geçti; bu değişiklikle ilgisiz)                                                                                                                                                                                                                                                                                                                                                                                                                        | ölçüldü                         |

Ölçüm ortamı: Docker `golang:1.26.11-bookworm@sha256:dc40a13b…`, Apple Silicon (14 çekirdek). Konteyner varsayılanı
`GOARCH=arm64`'tür. amd64 sayıları `--platform linux/amd64` ile alındı (Rosetta, cpu "VirtualApple @ 2.50GHz"). İkisi
de Windows referansı yerine geçmez. Pay yine de geniş: ölçüt 2 ms, ölçülen değer 0,27 ms.

Boyut ölçümü için `opus-go` geçici bir dosyayla ikiliye bağlandı. `cmd/noktadestek/zz_k0s_link_windows.go`,
`NOKTA_K0S_LINK=1` koşulu altında `voice.NewEncoder/Encode/NewDecoder/Decode/Conceal/DecodeFEC` çağırdı. Bağlantı
`go tool nm` ile doğrulandı: 554 `opusccenc.` ve 294 `opuscc.` sembolü. Dosya ölçümden sonra **silindi**. Taban (13 402 112 B),
aynı komutla, aynı sürüm dizesiyle ve opus-go eklenmeden önceki ağaçtan derlendi.

## Modül bilgisi ve lisans

- Hash kaydı (O-PD-4) şimdilik bu dosyada; K3'te `implementation.md`'ye taşınır.
- Sabitlenen sürüm: **`github.com/kazzmir/opus-go v1.6.0`**. Commit **`bc2aa842b45aaa82636296012c04c4782b8df7c3`**
  (go.sum `h1:MRzjz+yqAZbqSuKXY7VOknZBF28MfAweQqeA8CD+wdQ=`). `v1.7.0` aynı commit'i gösteriyor; ADR-0036'ya uyulup v1.6.0
  seçildi. Çevrilen kaynak **libopus 1.6.1**'dir (`PACKAGE_VERSION = "1.6.1"`). Modül `go 1.24.0` istiyor; toolchain
  1.26.11 ile sorun yok.
- Telif bildirimleri (iki BSD-3):
  1. opus-go: `Copyright (c) 2025, Jon Rafkind`, BSD 3-Clause (modül kökünde `LICENSE`).
  2. libopus 1.6.1: Xiph.Org Foundation, Skype Limited, Octasic, Jean-Marc Valin, Timothy B. Terriberry, CSIRO, Gregory
     Maxwell, Mark Borgerding, Erik de Castro Lopo. Lisans BSD 3-Clause (libopus `COPYING`). **Not:** Modülde libopus'un
     `COPYING` dosyası yok; bildirimler yalnız çevrilmiş kaynak yorumlarında duruyor (ör. `opuscc/silk_resampler.go`
     "Copyright (C) 2012 Xiph.Org Foundation", "Copyright (c) 2006-2011, Skype Limited"). İkili dağıtımda libopus
     `COPYING` metni ayrıca eklenmelidir. Seçilecek yedek (wazero + libopus.wasm) için de aynı yükümlülük geçerli.

## Yazılan kod (apps/agent-win)

- `internal/voice/opus.go`: Kütüphaneyi çağıran tek dosya. 48 kHz, mono, 20 ms; VOIP, 32 kbit/s VBR, karmaşıklık 5.
  r2 sırası şöyle uygulandı: konuşma hakkı çağıranda → `admit` (yük ≤ 1275 B → ≤ 100 paket/sn → düşürülmüş eş değil) →
  `guard` (`recover` → `ErrCodecPanic`). Panikten sonra çözücü yeniden kurulur. Aynı eşte 3. panikte `ErrPeerDropped`
  döner ve eş kalıcı olarak düşer. Kodlayıcı paniklerse kapatılır. Yerel PLC (`Conceal`) hız sınırına sayılmaz.
- `internal/voice/opus_test.go`: `TestP28dK0s…` testleri (SNR, PLC/FEC, stereo/çerçeve boyları, 20 000 bozuk paket,
  1276 B reddi, hız sınırı, panik → yeniden kurulum → 3. panikte düşme [sahte codec], kapatma), `FuzzDecode`,
  `BenchmarkP28dK0sEncode20ms`/`Decode20ms`.
- `internal/voice/wasapi_windows.go`: WASAPI iskeleti. Hata yolunda `Close` ile istemci ve olay bırakılır. `OpenCapture`/`OpenRender` (varsayılan `eCommunications` uç
  noktası), `IAudioClient2::SetClientProperties` (Communications kategorisi), `Initialize` (paylaşımlı kip,
  `EVENTCALLBACK | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY`, 48 kHz mono s16, 40 ms), `SetEventHandle`, `GetService`, ayrıca
  `Start`, `Wait`, `Read`, `Write` ve `Close` (Stop + tüm Release + CloseHandle). Vtable dizinleri ve GUID'ler mingw-w64
  10.0.0 başlıklarından alındı.
- `internal/voice/com_windows.go`: COM yardımcıları (`comObj.call` `//go:uintptrescapes`). **Sapma:** mimari dosya planında
  yok. Ayrı dosya olmasının nedeni, `internal/win/unsafeptr_test.go` S6-1 denetiminin `call` istisnasını ve işaret
  zorunluluğunu yalnız `com_windows.go` adlı dosyalarda tanıması. capture/printing'deki kalıbın üçüncü eşi; ortak paket
  K3 kararıdır.
- `go.mod`/`go.sum`: `github.com/kazzmir/opus-go v1.6.0` (doğrudan). **KALDI kararıyla birlikte K3'te kaldırılmalı veya
  yedekle değiştirilmeli.** Spike çıktısı olarak bırakıldı, commit yapılmadı. **Uyarı:** Ağaç bu hâliyle `go test -race ./...` adımında düşer
  (CI `check` kırmızı olur). `go.mod`, `go.sum` ve `internal/voice/opus*.go` bu hâlleriyle commit edilmemeli.
- K3 notu: `admit`, kayıpta `DecodeFEC(next)` ve `Decode(next)` çağrılarını iki ayrı paket sayıyor. Kayıp varken
  100 paket/sn bütçesi fiilen yarıya düşer.

## Windows'ta elle doğrulama listesi (WASAPI, staging)

1. Mikrofonlu ve hoparlörlü bir Windows 10/11 makinede `OpenCapture` → `Start` → `Wait(200)` + `Read` ile 5 sn yakala.
   Paket başına 480–960 örnek gelmeli ve RMS konuşmada > 0 olmalı.
2. Aygıtın yerel biçimi 44,1 kHz veya stereo olduğunda `Initialize` AUTOCONVERTPCM ile başarılı olmalı (hata
   `0x88890008` gelmemeli).
3. `Close` sonrasında görev çubuğundaki mikrofon göstergesi ≤ 1 sn içinde sönmeli (AC-374).
4. `OpenRender` ile 1 kHz ton `Write` edilmeli; bozulma ve takılma olmamalı. `GetCurrentPadding` sonrası boş yer hesabı
   doğru olmalı.
5. Varsayılan iletişim aygıtı yoksa `GetDefaultAudioEndpoint` hatası tipli `HRError` olarak dönmeli (`0x80070490`).
6. Varsa sürücü AEC'si: `SetClientProperties` sonrası hoparlör yankısı azalmalı (yalnız gözlem, ölçüt değil).
7. Chrome ile iki yönlü canlı ses (teknisyen konsolu ↔ istemci): **staging'de elle.** Chrome'un `opus/48000/2` +
   `useinbandfec=1` yükü çözülmeli. Bu ortamda yapılmadı.

## Yedek için öneri (A-PD-1, r2 sırası)

- **wazero + libopus.wasm (önce):** libopus C kodu WASM sanal makinesinde koşar. Bellek doğrusal belleğe hapsolur; bozuk
  paket en kötü durumda WASM trap üretir ve Go yığınına dokunamaz. Bu, Y-PD-2'yi yapısal olarak çözer. Gerekenler:
  tekrarlanabilir `.wasm` derleme hattı (sabit digest'li wasi-sdk imajı, hash denetimi), `go:embed`, ikili boyutu ve
  süre ölçümü. `internal/voice/opus.go` arayüzü (`NewEncoder/Encode/NewDecoder/Decode/Conceal/DecodeFEC/Close`, `admit`,
  `guard`) korunur ve testlerin çoğu yeniden kullanılır. **İstisna (sapma):** `TestP28dK0sDecodesStereoAndOtherFrameSizes`
  stereo ve 5/10/60 ms paket üretmek için opus-go'yu doğrudan içe aktarıyor. Yedekte bu test fikstür paketleriyle yeniden
  yazılmalı; bunun için Chrome'dan yakalanmış paketler de gerekiyor.
- **gopus (sonra):** Go ≥ 1.27.3 ve toolchain yükseltmesi gerektirir. Saf Go (çeviri değil) olduğu için aynı yığın
  sorunu beklenmez. Yine de aynı fuzz + `-race` kapısından geçmeli.
- Mimara bilgi: opus-go'yu `GODEBUG=gcshrinkstackoff=1` ile kurtarmak mümkün görünse de önerilmez. Süreç geneli bir
  ayardır, -race/checkptr'ı çözmez ve yığın _büyümesinde_ de taşınma olduğu için kanıtlanmış bir güvence değildir.

---

# K0s-2 (wazero) — yedek 1: wazero + libopus 1.6.1 WebAssembly

Tarih: 2026-11-17 · Dal: p28d (11377c5 + çalışma ağacı) · Yazan: backend-dev (Go)

## Karar

**wazero v1.12.0 + libopus.wasm: GEÇTİ** (yayın hedefi windows/amd64 için). Bağlayıcı ölçütlerin hepsi yeşil: `-race` temiz,
fuzz ≥ 30 dk 0 tuzak ve 0 panik, iki derlemede SHA eşit, wasm tekrarlanabilir, ikili +2,54 MiB, kodlama 0,22 ms. K0s-1'in iki
kırmızısı yapısal olarak kapandı: C kodu Go belleğine erişemiyor ve `unsafe`/checkptr çevrilmiş kodda kullanılmıyor.

Mimara açık maddeler (ADR-0036 revizyonunda karara bağlanmalı):

1. **arm64 JIT bulgusu.** wazero'nun arm64 derleyicisi v1.9.0–v1.12.0 sürümlerinde libopus kodlayıcısını yanlış derliyor. Bu
   yüzden arm64'te yorumlayıcıya geçildi; yayına etkisi yok. Yine de JIT'in doğruluğu sandbox gerekçesinin parçası. Ayrıntı
   aşağıda.
2. **O-PD-4 içe aktarım/`init` ölçütü wazero için harfiyen sağlanmıyor.** wazero `os`, `net`, `syscall` ve `unsafe` içe aktarıyor
   ve etkin iki `init` içeriyor. Ölçüt "modül bu yetkileri kullanmaz" olarak yeniden yazılmalı. Bunun dayanağı: WASI verilmiyor,
   içe aktarım 0 ve bunu test denetliyor.
3. **Lisans bildirimleri.** wazero Apache-2.0, libopus BSD-3. Bunlara ek olarak wasm içindeki wasi-libc, musl ve compiler-rt
   bildirimleri K3'te `third_party_notices.txt`'e eklenmeli.
4. **Fuzz kapsamı.** WASM içinde koşan kod Go fuzz kapsamına görünmüyor.

## Ölçüm tablosu

| Ölçüt (mimari-p28d §11 K0s, r2)                                                                              | Sonuç                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Tür       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `CGO_ENABLED=0` derleme                                                                                      | GEÇTİ (`build.sh`; wazero saf Go + Go assembly, C araç zinciri yok)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ölçüldü   |
| İki derlemede ikili SHA eşit                                                                                 | GEÇTİ: `scratchpad/k0s2-a` = `k0s2-b` = `d54a42f095d36375784ea549543a03f921387ea3bf15587c4e2668683f4a264d` (arada `go clean -cache`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ölçüldü   |
| libopus.wasm tekrarlanabilir                                                                                 | GEÇTİ: `715ac5d3911a76bf526267786f469fe2760fdc78a32ad736751bfa41bf7562e2` üç derlemede eşit (linux/amd64 imaj ×1, linux/arm64 imaj ×2; her biri ayrı `mktemp` dizininden). Kabuk değişmeden önceki sürüm de amd64 = arm64 idi (`8f2878…`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ölçüldü   |
| libopus tarball doğrulaması                                                                                  | GEÇTİ: `opus-1.6.1.tar.gz` SHA-256 `6ffcb593…72411a1` = Xiph `SHA256SUMS.txt` değeri; betik host'ta ve konteynerde iki kez denetler                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ölçüldü   |
| WASI / içe aktarım                                                                                           | GEÇTİ: **0 içe aktarım** (IMPORT bölümü yok). Dışa aktarım yalnız `_initialize` + 7 `nk_*` + `memory`; bellek üst sınırı 256 sayfa (16 MiB), yığın 1 MiB `--stack-first`. `TestP28dK0sWasmSandboxSurface` denetler                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ölçüldü   |
| İkili büyümesi ≤ 5 MB                                                                                        | GEÇTİ: 13 414 400 → 16 081 920 B, **+2 667 520 B (≈ 2,54 MiB)** (wasm 328 437 B dahil)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ölçüldü   |
| Kodlama 20 ms mono ≤ 2 ms/çerçeve (amd64)                                                                    | GEÇTİ (vekil): linux/amd64 Rosetta, derleyici **0,22 ms** (3 koşu: 0,220–0,230; K0s-1 opus-go 0,25–0,27); yorumlayıcı 22,6 ms (kullanılmaz). auto = compiler → üretimde derleyici seçiliyor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | vekil     |
| Çözme 20 ms                                                                                                  | amd64 Rosetta derleyici **0,041–0,048 ms**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | vekil     |
| Gidiş-dönüş doğruluğu                                                                                        | GEÇTİ: SNR 4,6 dB, 31,0 kbit/s, lookahead 312 / gecikme 303 — opus-go ile birebir aynı (aynı libopus 1.6.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ölçüldü   |
| PLC / FEC yolu                                                                                               | GEÇTİ (`TestP28dK0sPacketLossConcealment`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ölçüldü   |
| Stereo / 5–10–60 ms paket mono çözücüde                                                                      | GEÇTİ: `testdata/opus-fixtures.txt` (5 paket; opus-go v1.6.0 ile üretildi = libopus.wasm'dan bağımsız yapı; Chrome DEĞİL)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ölçüldü   |
| Tuzak yalıtımı (örnek başına)                                                                                | GEÇTİ: `TestP28dK0sTrapIsolatedPerInstance` durum işaretçisini bellek dışına yöneltip gerçek WASM tuzağı üretir → `ErrCodecPanic`; kodlayıcı kapanır, çözücü yeni örnekle kurulur, komşu örnek etkilenmez                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ölçüldü   |
| Derleyici = yorumlayıcı (amd64, yanlış derleme)                                                              | GEÇTİ: `TestP28dK0sCompilerMatchesInterpreter` 200 çerçeve kodlama + 400 çözme (yarısı bozuk) SHA-256 eşit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ölçüldü   |
| `go test -race ./...` (r2 b)                                                                                 | GEÇTİ: linux/amd64 (derleyici yolu) tüm paketler `ok`; linux/arm64 (yorumlayıcı yolu) `internal/voice` `-short` ile `ok` (1720 sn; fuzz ile eşzamanlı koşu). `-short`suz arm64 koşusu varsayılan 10 dk sınırını aştı (yarış raporu değil, zaman aşımı: yorumlayıcı + race yavaş)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ölçüldü   |
| Fuzz `FuzzDecode` ≥ 30 dk (Y-PD-2)                                                                           | GEÇTİ (koşu 2): linux/amd64 derleyici yolu, son kod, 31 dk 0 sn, **91 304 163 çalıştırma**, `PASS`/`EXIT=0`, **0 tuzak** (`NOKTA_K0S_TRAPLOG` O_APPEND sayacı; işçi süreçlerinden bağımsız), 0 panik/fatal, crasher dosyası yok. Koşu 1 (aynı kod, 30 dk, 83 591 329 çalıştırma, 0 tuzak, 0 panik) çıkışta `--- FAIL: FuzzDecode … context deadline exceeded` ile bitti. Crasher yazılmadı ve hız sona kadar ~52 bin/sn sabit kaldı, yani takılan işçi belirtisi yok. İki 60 sn'lik koşu ve 31 dk'lık tekrar koşu temiz `PASS` verdi; bu yüzden hata Go fuzz koordinatörünün kapanıştaki bir zamanlama hatası olarak değerlendirildi, ama bu kanıtlanmadı. **Sınırlama:** libopus kodu JIT içinde koştuğu için Go kapsam ölçümü onu görmüyor ("new interesting" 9/0). Fuzz pratikte yönlendirmesiz mutasyondur (tohumlar: kodlayıcı paketleri + `f8fffe`). Kapsam güdümlü fuzz için ayrıca native libFuzzer gerekir; K3 sonrasına önerilir. | ölçüldü   |
| 20 000 bozuk paket                                                                                           | 4067 opus hatası (`-4` vb.), **0 tuzak**, 0 panik                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ölçüldü   |
| İçe aktarım / `init` denetimi (O-PD-4)                                                                       | **Bulgu (mimara):** wazero'nun bağlanan 31 paketinden bazıları `os`, `net`, `syscall`, `unsafe` içe aktarıyor (WASI/sysfs/sock katmanı; bu modüle WASI verilmediği için çağrılmıyor). `func init()`: `internal/platform/time_windows.go` (QueryPerformanceFrequency), `mmap_linux.go` (/sys hugepages okur, Windows'ta derlenmez), `wazevoapi/perfmap.go` (sabit `PerfMapEnabled=false`, yalnız `wazero_perfmap` etiketiyle açık). `os/exec` yok. opus-go'daki "hiçbiri yok" ölçütü wazero için harfiyen sağlanmaz; yürütme gücü (mmap PROT_EXEC/VirtualProtect) JIT'in doğası                                                                                                                                                                                                                                                                                                                                                              | ölçüldü   |
| govulncheck v1.7.0 (windows/amd64 + linux)                                                                   | GEÇTİ: "No vulnerabilities found." ×2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ölçüldü   |
| go-licenses v2.0.1                                                                                           | GEÇTİ (çıkış 0): `github.com/tetratelabs/wazero` Apache-2.0. libopus.wasm'ı görmez: libopus BSD-3 (`internal/voice/libopus-COPYING.txt`), wasm içinde ayrıca wasi-libc (MIT/Apache-2.0-LLVM, musl MIT) ve compiler-rt (Apache-2.0 WITH LLVM-exception) kodu statik bağlı → bildirim metinleri K3'te `third_party_notices.txt`'e                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ölçüldü   |
| gofmt, `go mod verify`, vet (linux + windows), staticcheck v0.8.2 (linux + windows), `GOOS=windows go build` | GEÇTİ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ölçüldü   |
| Chrome Opus yükü, WASAPI donanım                                                                             | **staging/Windows'ta elle** (K0s-1 listesi aynen geçerli)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ertelendi |

Ölçüm ortamı: Docker `golang:1.26.11-bookworm@sha256:dc40a13b…`, Apple Silicon. amd64 sayıları `--platform linux/amd64`
(Rosetta, "VirtualApple @ 2.50GHz"); Windows referansı yerine geçmez. Boyut ölçümü için `cmd/noktadestek/zz_k0s_link_windows.go`
(`NOKTA_K0S_LINK=1` koşullu `NewEncoder/Encode/NewDecoder/Decode/Conceal/DecodeFEC`) geçici eklendi; bağlantı ikilide
`tetratelabs/wazero` (30) ve `nk_dec_init` (2) dizgileriyle doğrulandı (taban ikilide 0/0), ölçümden sonra **silindi**. Taban
13 414 400 B aynı komut ve sürüm dizesiyle (`build.sh https://destek.example.invalid:4450 0.17.0`) bugünkü ağaçtan alındı
(K0s-1'deki 13 402 112 B'den farkı ağaçtaki başka değişiklikler).

## Bulgu: wazero arm64 derleyicisi (mimara, risk kaydı)

- linux/arm64 (Docker, Apple Silicon) üzerinde wazero **v1.9.0, v1.10.1, v1.11.0, v1.12.0** derleyicisi (wazevo) kodlayıcının
  ilk çerçevesinde `wasm error: out of bounds memory access` veriyor. Adlı (strip edilmemiş) derlemede yığın:
  `silk_noise_shape_quantizer_del_dec ← silk_NSQ_del_dec_c ← silk_NSQ_wrapper_FLP ← silk_encode_frame_FLP ← silk_Encode ←
opus_encode_frame_native ← opus_encode_native ← opus_encode ← nk_enc`.
- Aynı wasm (`715ac5…`) arm64 **yorumlayıcıda** ve amd64 **derleyicide** doğru çalışıyor; amd64 derleyici çıktısı yorumlayıcıyla
  bayt bayt aynı (`TestP28dK0sCompilerMatchesInterpreter`). WASM deterministik olduğundan ayrışma arm64 arka ucunda yanlış
  derleme belirtisidir (kök neden araştırılmadı; yerel macOS/arm64'te yeniden üretilmedi).
- Etki: yayın hedefi yalnız windows/amd64. `runtimeConfig` amd64 dışında yorumlayıcı seçer (yalnız geliştirme/test; ~22 ms/çerçeve
  üretime uygun değil). **Sapma:** görev "compiler (amd64/arm64)" diyordu; arm64 derleyici bu bulgu yüzünden kapalı.
- Güvenlik yorumu: Y-PD-2 sandbox gerekçesi JIT'in doğruluğuna dayanır. Bir arka uçta yanlış derleme görülmesi, amd64 arka
  ucunda da veriye bağlı gizli hata olasılığını sıfırlamaz. Azaltımlar: derleyici = yorumlayıcı eşitlik testi CI'da (amd64),
  fuzz amd64 derleyici yolunda, sınır dışı erişim yine tuzak olur (doğrusal bellek dışına yazma JIT hatası olmadan mümkün
  değil). Upstream'e hata bildirimi önerilir (wasm + yeniden üretim adımı hazır).

## Yazılan / değişen dosyalar (apps/agent-win; commit yok)

- `build/libopus-wasm.sh` (yeni): tekrarlanabilir libopus.wasm hattı (host'ta indir + SHA-256, konteyner `--network none`,
  `--user`, sabit `/tmp/nkwork` yolu, `-O2 -g0 -fno-ident -ffile-prefix-map`, `SOURCE_DATE_EPOCH`, sıralı kaynak, sabit adlı
  nesneler, `--strip-all --stack-first -z stack-size=1MiB --max-memory=16MiB`, reactor). Kaynak listesi libopus'un
  `*_sources.mk` dosyalarından (kayan nokta yapı; x86/ARM/DNN dışarıda). Varsayılan `WASI_SDK_PLATFORM=linux/amd64`.
- `build/libopus-wasm/nk_opus.c` (yeni): sabit imzalı kabuk. **Sapma (daha dar yüz):** `opus_*_ctl` değişken argümanlı
  olduğundan ve host'tan `malloc/free` gerekmediğinden dışa aktarım yalnız `nk_packet_buf, nk_pcm_buf, nk_enc_init, nk_enc,
nk_enc_lookahead, nk_dec_init, nk_dec`. Tamponlar ve durum işaretçileri tek statik yapıda (`_Static_assert` ile sabit yerleşim).
- `internal/voice/libopus.wasm` (328 437 B, `//go:embed`), `libopus.wasm.sha256`, `libopus-COPYING.txt` (libopus BSD-3).
- `internal/voice/opus.go`: genel API aynı (`NewEncoder/Encode/Lookahead/Close`, `NewDecoder/Decode/Conceal/DecodeFEC/Close`,
  `admit` sırası, 1275 B, 100 paket/sn, 3 tuzakta `ErrPeerDropped`). Arka uç wazero: çalışma zamanı + derlenmiş modül süreçte
  bir kez (`sync.Once`), kodlayıcı/çözücü başına ayrı örnek (`WithName("")`, `_initialize`), modül config'ine FS/stdout/saat
  verilmez, içe aktarım varsa kurulum reddedilir. Tuzak → `ErrCodecPanic` (adı korundu, ileti "tuzağa düştü"); çözücüde eski
  örnek kapatılıp yenisi kurulur, kodlayıcı kapanır. Kapalı örnek `errClosed` döner (tuzak sayılmaz, yeniden kurulum yok).
  libopus negatif kodları tipli `opusError`. Çağrılar `CallWithStack` ile ayırmasız.
- `internal/voice/opus_test.go`: opus-go importu kaldırıldı; stereo/çerçeve testi fikstürden; yeni `WasmDigestMatches`,
  `WasmSandboxSurface`, `TrapIsolatedPerInstance`, `CompilerMatchesInterpreter`, `BenchmarkP28dK0sEncode20msEngine`;
  `FuzzDecode` tuzakları `NOKTA_K0S_TRAPLOG` dosyasına O_APPEND ile sayar.
- `internal/voice/testdata/opus-fixtures.txt` (yeni, kaynağı başlıkta).
- `go.mod/go.sum`: `github.com/kazzmir/opus-go` çıktı (`go mod tidy`), `github.com/tetratelabs/wazero v1.12.0` girdi
  (commit `2ab480b55fa408d6b35df97fe32a60d08bd6e201`, `h1:DuWcpNu/FzgEXgGBDp8J1Spc+CWOvvtvVyjKlaZopYU=`; tek bağımlılığı
  `golang.org/x/sys`, zaten var). Sabitlenenler: wasi-sdk-34 imaj dizini `sha256:52595085a0ffbaf574d8d678a9aa81305f0b3af81c639291f15bc7713e42848e`
  (amd64 manifest `sha256:9515a062…`, arm64 `sha256:c91f54df…`).
- `wasapi_windows.go`, `com_windows.go` değişmedi.

## CI taslağı (.github/workflows/agent-win.yml — henüz UYGULANMADI)

`check` job'u Go konteynerinde koşar (Docker yok); libopus.wasm yeniden üretimi ayrı bir job olmalı:

```yaml
  libopus-wasm:
    name: libopus.wasm yeniden üret + SHA karşılaştır
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    defaults:
      run:
        working-directory: apps/agent-win
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with: { persist-credentials: false }
      # Betik: tarball SHA-256 (Xiph) + wasi-sdk imajı digest ile sabit, konteyner ağsız. Çıktı repo'dakiyle bayt bayt aynı olmalı.
      - name: yeniden üret
        run: build/libopus-wasm.sh "$RUNNER_TEMP/wasm"
      - name: karşılaştır
        run: |
          cmp "$RUNNER_TEMP/wasm/libopus.wasm" internal/voice/libopus.wasm
          cmp "$RUNNER_TEMP/wasm/libopus.wasm.sha256" internal/voice/libopus.wasm.sha256
          cmp "$RUNNER_TEMP/wasm/libopus-COPYING.txt" internal/voice/libopus-COPYING.txt
```

Not: `go test` içindeki `TestP28dK0sWasmDigestMatches` gömülü ikilinin `.sha256` ile tutarlılığını her koşuda denetler;
`TestP28dK0sCompilerMatchesInterpreter` `check` job'unda (amd64) derleyici doğruluğunu sınar (~9 sn Rosetta'da; CI'da daha kısa).
`paths` filtresi istenirse `apps/agent-win/build/libopus-wasm*/**` + `internal/voice/libopus*`.
