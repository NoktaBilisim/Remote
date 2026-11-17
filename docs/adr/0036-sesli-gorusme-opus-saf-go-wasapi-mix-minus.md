# ADR-0036 — Sesli görüşme: CGO'suz Opus, ham COM WASAPI, müşteride mix-minus, oda düzeyinde tek görüşme

Tarih: 2026-11-17 · Durum: Kabul r3 (K0s spike sonucu m.1 değişti: opus-go elendi, libopus 1.6.1 → wasm32 + wazero; A-PD-1 kapandı — mimari-p28d §14.1; r2: güvenlik tasarım turu Y-PD-1..3, O-PD-1..4, D-PD-1..5 işlendi — mimari-p28d §14) · İlgili: AC-373..379, R44,
V45, ADR-0004, ADR-0009, ADR-0010, ADR-0011, ADR-0034, ADR-0035, `docs/mimari-p28d.md`

## Bağlam

- P28d, teknisyen ile müşteri arasında WebRTC sesi istiyor (Opus, DTLS-SRTP). Ses tarayıcı modunda ve Windows istemcide aynı akışla çalışacak.
  P28c mesh'inde en çok 3 teknisyen var; izleyici yalnız dinleyebilir.
- Windows istemci CGO'suz derleniyor (`build/build.sh`: `CGO_ENABLED=0 -trimpath -buildid=`). CI iki derlemenin SHA-256'sının eşit
  olduğunu denetliyor (ADR-0010). Video kodlama Media Foundation'a ham COM çağrısıyla yapılıyor (`internal/capture/com_windows.go`).
  Windows'ta yerleşik bir Opus kodlayıcı yok.
- Mesh'te her teknisyenin PeerConnection'ı yalnız müşteriyle kurulu; teknisyenler arasında eş yok. Müşteri yalnız kendi sesini
  gönderirse katılımcılar birbirini duymaz ve izleyici konuşmanın yalnız yarısını duyar. Bu durumda AC-378 fiilen bozulur.
- AGPL/GPL yasak. Ekipte WASM ya da cgo çapraz derleme deneyimi yok (r3: K0s spike'ı WASM hattını kurdu ve belgeledi). Kullanıcı sadelik istiyor.
- r3 (K0s spike; ölçümler `docs/tmp-impl-k0s.md`, K3'te `docs/implementation.md`'ye taşınır): r2 kararı `kazzmir/opus-go` v1.6.0 iki
  bağlayıcı ölçütte KALDI. (a) `go test -race` daha `NewEncoder` çağrısında `checkptr` fatal ile düşüyor
  (`opusccenc.Opus_silk_Get_Encoder_Size`; upstream'in kendi race koşusu da). Bu `recover` ile yakalanamaz, CI `check` kırmızı olur.
  (b) Bozuk paketlerde `celt_fatal` paniği GC'ye bağlı ve deterministik değil (aynı 20 000 paket: `GOGC=off` 0, `GOGC=1` 1–5 panik).
  Kök neden için güçlü gösterge var ama kanıtlanmadı: çevrilmiş kod yığın adreslerini `uintptr` olarak taşıyor ve yığın küçültmede bu adresler bayatlıyor.
  `recover` belirtiyi örter, Go belleğindeki olası bozulmayı önleyemez. r2 sırasındaki birinci yedek (wazero + libopus.wasm) aynı
  spike'ta bağlayıcı ölçütlerin hepsini geçti.

## Karar

1. **Opus (Go) — r3: libopus 1.6.1 → wasm32 + wazero sandbox.**
   - **Kodlayıcı/çözücü:** Xiph libopus **1.6.1** (BSD-3) C kaynağı `wasi-sdk-34` ile wasm32'ye derlenir (reactor, kayan nokta yapı;
     x86/ARM/DNN kaynakları dışarıda). Hat: `apps/agent-win/build/libopus-wasm.sh` + sabit imzalı kabuk `build/libopus-wasm/nk_opus.c`.
     Tarball SHA-256'sı (`6ffcb593…72411a1`) Xiph `SHA256SUMS.txt` ile hem host'ta hem konteynerde denetlenir. wasi-sdk imajı **digest ile**
     sabittir (dizin `sha256:52595085a0ffbaf574d8d678a9aa81305f0b3af81c639291f15bc7713e42848e`). Konteyner `--network none` ile koşar;
     `SOURCE_DATE_EPOCH`, `-ffile-prefix-map`, sıralı kaynak ve `--strip-all` kullanılır. Çıktı tekrarlanabilir: `libopus.wasm` SHA-256
     `715ac5d3911a76bf526267786f469fe2760fdc78a32ad736751bfa41bf7562e2` (amd64 ve arm64 imajda üç derleme eşit). Ürün repoya girer
     (`internal/voice/libopus.wasm` + `.sha256` + `libopus-COPYING.txt`, `//go:embed`). CI aynı betikle yeniden üretip bayt bayt
     karşılaştırır (mimari-p28d §11 K4).
   - **Çalışma zamanı:** `github.com/tetratelabs/wazero` **v1.12.0** (Apache-2.0; commit `2ab480b55fa408d6b35df97fe32a60d08bd6e201`; tek
     bağımlılığı zaten var olan `golang.org/x/sys`). Saf Go + Go assembly olduğundan `CGO_ENABLED=0` ve iki derlemede SHA eşitliği
     (ADR-0010) korunur. Sürüm `go.sum` + `GOFLAGS=-mod=readonly` ile sabittir; hash `implementation.md`'ye yazılır.
   - **Sandbox sözleşmesi (Y-PD-2'nin birincil savunması):** Modülün **0 içe aktarımı** vardır: WASI yok, host işlevi yok. Dışa aktarım
     yalnız `_initialize`, 7 `nk_*` işlevi ve `memory`'dir. Modül config'ine FS/stdout/saat verilmez. İçe aktarım isteyen modülü `opus.go`
     kurulumda reddeder; `TestP28dK0sWasmSandboxSurface` bunu denetler. Doğrusal bellek üst sınırı **256 sayfa = 16 MiB**'dir (yığın 1 MiB,
     `--stack-first`). Çalışma zamanı ve derlenmiş modül süreçte bir kez kurulur. **Her kodlayıcı ve her çözücü ayrı örnektir:** eş başına
     bir kodlayıcı + konuşan tid başına bir çözücü; N ≤ 3 olduğundan en çok 6 örnek, doğrusal bellek tavanı 6 × 16 MiB. Gerçek RSS K3'te
     ölçülür. Bozuk paket en kötü durumda WASM **tuzağı** üretir; C kodu Go belleğine ve komşu örneğe erişemez.
   - **Yalıtım sırası (r2 korunur; yalnız `internal/voice/opus.go`):** talker kapısı → yük ≤ 1275 bayt ve tid başına ≤ 100 paket/sn → çağrı.
     Tuzak `ErrCodecPanic` olur. Çözücüde eski örnek kapatılıp yenisi kurulur; aynı tid için 3. tuzakta `ErrPeerDropped` döner ve o eşin
     sesi görüşme sonuna dek düşer. Kodlayıcı tuzakta kapanır. `recover` yalnız ikinci savunma olarak kalır (Go çalışma zamanı paniği
     için). Örnekler her görüşmede sıfırdan kurulur; süreç ölmez.
   - **Motor seçimi:** amd64'te wazero derleyicisi (JIT) kullanılır; derleyici SSE4.1 ister, yoksa wazero yorumlayıcıya düşer (davranış ölçülmedi; açık karar mimari-p28d A-PD-6); ölçülen kodlama süresi 0,22 ms / 20 ms çerçevedir (Rosetta vekili).
     Diğer mimarilerde yorumlayıcı kullanılır (≈ 22 ms/çerçeve; yalnız geliştirme/test için). Yayın hedefi yalnız windows/amd64'tür.
     Gerekçe açık madde (a).
   - Hedef ayarlar değişmez: 48 kHz, mono, 20 ms, `VOIP`, 32 kbit/s VBR, karmaşıklık 5. Chrome'un bant içi FEC'i çözücüde kullanılır, kayıpta PLC çalışır. FEC/PLC yolu spike'ta kendi kodlayıcımızın paketleriyle doğrulandı; Chrome yükü ertelendi. Genel API: `NewEncoder/Encode/Lookahead/Close`,
     `NewDecoder/Decode/Conceal/DecodeFEC/Close`.
   - **Yeni teknoloji ölçütleri:** **Ekipte bilgi:** API libopus'la aynı; WASM derleme hattı yeni ama tek betikte duruyor ve CI'daki
     yeniden üretim job'uyla kayıt altında. **Bakım:** libopus'u Xiph sürdürüyor; wazero Apache-2.0'dır ve spike'ta dört sürümü (v1.9.0–v1.12.0) denendi. **Geri dönüş:** genel API değişmeden arka uç değiştirilebilir (tek dosya `opus.go`); yedek gopus (Alternatifler).
   - **Ölçülen (K0s-2):** ikili büyümesi +2 667 520 B (**≈ 2,54 MiB**, wasm 328 437 B dahil; sınır 5 MB). İki derlemede SHA eşit.
     `go test -race ./...` temiz (amd64). `FuzzDecode` 31 dk koştu: 91,3 M çalıştırma, 0 tuzak, 0 panik. Önceki 30 dk'lık koşu (0 tuzak,
     crasher yok) kapanışta `context deadline exceeded` ile FAIL verdi; bu Go fuzz koordinatörünün zamanlama hatası olarak değerlendirildi
     ama kanıtlanmadı. 20 000 bozuk paket 0 tuzak verdi. Derleyici ve yorumlayıcı çıktısı bayt bayt eşit. govulncheck ve go-licenses temiz.
     **Ertelenen (geçmiş sayılmaz):** Chrome'un gönderdiği Opus yükünün çözülmesi ve Chrome'dan yakalanmış fuzz tohumları, Windows
     referans makinede kodlama süresi, WASAPI donanım testleri. Bunlar K3/K5'te staging'de elle doğrulanır.
   - **Açık maddeler (r3 kararları):**
     - **(a) wazero arm64 derleyici hatası.** wazero v1.9.0–v1.12.0 arm64 derleyicisi libopus kodlayıcısını yanlış derliyor: ilk
       çerçevede sınır dışı tuzak (`silk_noise_shape_quantizer_del_dec`). Aynı wasm arm64 yorumlayıcıda ve amd64 derleyicide doğru
       çalışıyor. Karar: amd64 dışında yorumlayıcı kullanılır. Risk kaydı (R44'e eklenir): sandbox gerekçesi JIT'in doğruluğuna dayanır.
       Bir arka uçta yanlış derleme görülmesi, amd64'te veriye bağlı gizli bir hatanın olasılığını sıfırlamaz. Azaltım:
       `TestP28dK0sCompilerMatchesInterpreter` (bozuk girdi dahil, derleyici = yorumlayıcı) CI'da amd64'te koşar; fuzz amd64 derleyici
       yolunda yapılır; her wazero yükseltmesinde ikisi yeniden koşulur. Sınır dışı erişim JIT hatası olmadıkça yine tuzak olur.
       Upstream'e hata bildirimi önerilir (wasm ve yeniden üretim adımı hazır; sahibi backend-dev (Go), K3). arm64 derleyicisine dönüş
       ancak upstream düzeltmesi ve eşitlik testiyle, ADR revizyonuyla olur.
     - **(b) O-PD-4 ölçütü wazero için yeniden yazılır.** r2 ölçütü ("modülde `os/exec`, `net`, `syscall` içe aktarımı ve `init()` yan
       etkisi yok") wazero'ya harfiyen uygulanamaz. Bağlanan wazero paketleri `os`, `net`, `syscall` ve `unsafe` içe aktarır (WASI/sysfs/sock
       katmanı). Etkin iki `init` vardır: `internal/platform/time_windows.go` (`QueryPerformanceFrequency`) ve `mmap_linux.go` (`/sys`
       hugepages okur, Windows'ta derlenmez). `wazevoapi/perfmap.go` sabit olarak kapalıdır. JIT ayrıca çalıştırılabilir bellek ayırır
       (mmap `PROT_EXEC` / `VirtualProtect`). Yeni ölçüt: (1) `os/exec` içe aktarımı yok. (2) Modüle WASI ve host işlevi verilmez;
       `libopus.wasm`'ın içe aktarım sayısı **testle 0**'dır (`TestP28dK0sWasmSandboxSurface` + kurulumdaki red). (3) `init` listesi
       yukarıdakilerle sınırlıdır; her wazero yükseltmesinde `go list -deps` + `func init` taramasıyla yeniden denetlenir ve sonuç PR'ye
       yazılır. Bu gevşetme K5 güvenlik denetiminde yeniden onaylanır (mimari-p28d A-PD-4).
     - **(c) Üçüncü taraf bildirimleri.** Şunlar `internal/ui/third_party_notices.txt`'e girer, ikiliye gömülür ve tepsi menüsü
       "Lisanslar"da gösterilir (K3): libopus `COPYING` (BSD-3; Xiph.Org ve katkıcılar), wazero Apache-2.0 `LICENSE` + `NOTICE`, wasm'a
       statik bağlı wasi-libc (MIT / Apache-2.0 WITH LLVM-exception), musl (MIT) ve compiler-rt (Apache-2.0 WITH LLVM-exception). Aynı
       liste `implementation.md` lisans listesine ve kök `NOTICE`'a (K6) eklenir. go-licenses wasm içini görmez; liste el ile tutulur ve
       `libopus-wasm.sh` değiştiğinde güncellenir.
     - **(d) Fuzz kapsam sınırı.** wasm içindeki libopus kodu Go'nun kapsam ölçümüne görünmez, bu yüzden `FuzzDecode` pratikte
       yönlendirmesiz mutasyondur. Kabul edilen risk: birincil savunma sandbox'tır (tuzak Go belleğine dokunamaz), fuzz ikinci katmandır.
       Genişleme noktası (Sonra): native libFuzzer ile kapsam güdümlü libopus fuzz'ı (mimari-p28d A-PD-5).
2. **Ses aygıtı (Go):** WASAPI paylaşımlı kipte, olay güdümlü yakalama ve çalma kullanılır. Erişim mevcut kalıpla, ham COM ve
   `x/sys/windows` üzerinden yapılır; yeni bağımlılık yoktur. `AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | SRC_DEFAULT_QUALITY` ile
   48 kHz mono s16 istenir, bu yüzden yeniden örnekleyici yazılmaz. `IAudioClient2::SetClientProperties` ile
   `AudioCategory_Communications` ayarlanır; bu, sürücüde varsa OEM yankı/gürültü işlemesini açar, ancak bu davranışa güvenilmez.
   Görüşme bitince `Stop` + tüm arayüzler `Release` edilir; Windows mikrofon göstergesi söner (AC-374, ≤ 1 sn).
   r2 (D-PD-4): tüm COM arayüzleri tek sahip yapıda, `Close()` ters sırayla `Release`; COM çağrıları `runtime.LockOSThread` ile kilitli
   iş parçacığında; yakalama goroutine'i olay + `stop` kanalı, 200 ms zaman aşımlı `WaitForMultipleObjects`; `Close` bitişte, WS
   kopmasında, oturum bitişinde ve süreç çıkışında (panic dahil `defer`) çağrılır.
3. **Yankı giderme yok (Go):** Tarayıcı tarafında `getUserMedia` varsayılan olarak AEC/NS/AGC uygular. Windows istemcide AEC yazılmaz.
   Müşteri diyaloğunda ve kılavuzda şu metin gösterilir: "Yankı olmaması için kulaklık kullanmanız önerilir." Genişleme noktası
   (Sonra): Windows'un yerleşik "Voice Capture DSP" (`CLSID_CWMAudioAEC`) MFT'si `internal/voice/wasapi_windows.go` yakalama
   zincirine aynı COM kalıbıyla eklenebilir.
4. **Medya topolojisi — müşteride mix-minus:** Müşteri (hub), her teknisyen eşine **kendi mikrofonu + diğer konuşan teknisyenlerin sesi**
   karışımını gönderir; alıcı teknisyenin kendi sesi bu karışıma girmez. Müşterinin hoparlörüne tüm konuşan teknisyenlerin toplamı gider.
   Tarayıcı misafir bunu WebAudio grafiğiyle yapar: eş başına bir `MediaStreamAudioDestinationNode`. Go misafir eş başına bir toplama
   ve bir Opus kodlayıcı kullanır; N ≤ 3 olduğu için yük önemsizdir. Karışım yalnız sunucunun `voice.state.listeners` listesindeki (bağlı + rol + `sessions.voice`) eşlere gider; diğer eşlerin
   gönderici izi boştur (r2, Y-PD-3). Yetkili izleyici bu karışımla tüm konuşmayı dinler; yeni dinleyici müşteriye duyurulur.
5. **Yeniden müzakere yok:** Teknisyen konsolu, `voice1` destekli misafire giden ilk offer'a izsiz tek bir ses transceiver'ı koyar
   (sahip/katılımcıda `sendrecv`, izleyicide `recvonly`). Görüşme başlayınca `replaceTrack(mic)`, bitince `track.stop()` +
   `replaceTrack(null)` yapılır. Go tarafı her eşte kendi `TrackLocalStaticSample(audio/opus)` izini yanıta bağlar ve yalnız görüşme
   sürerken ve yalnız `listeners` içindeki eşe örnek yazar (r2, Y-PD-3).
6. **Oda düzeyinde tek görüşme:** Sunucu `Room.voice` (bellek, ADR-0005) içinde `idle → pending → active` durumunu tutar. Müşteri
   kabulü görüşme başına bir kez alınır. r2 (Y-PD-1): sunucu her istekte 128 bit `callId` üretir, tüm `voice.*` mesajları taşır.
   Misafir mikrofonu **yalnız** aynı sayfa/süreç içinde o `callId` için yerel "Kabul et" tıklamasıyla açılır; `voice.state`, DC ve SDP
   yalnız kapatabilir. Misafir WS'si koparsa görüşme anında biter, yeniden bağlanma/yenileme yeni istek + kabul ister (O-PD-1). Diğer teknisyenler etkin görüşmeye `voice.join` ile kendi düğmeleriyle katılır.
   İzleyicinin `voice.join` isteği 403 alır. Misafir yalnız sunucunun `voice.state.talkers` listesindeki teknisyenin sesini çalar ve
   karışıma katar. Bu iki katman ADR-0009 kalıbıdır.
7. **Gözetimsiz oturumda ses yoktur (V45, mimari-p28u):** Sunucu gözetimsiz odada `voice1` belirtecini yok sayar
   (`hasVoice = !room.unattended && (voice1 ∨ BROWSER)`). Kip fark etmez (`asked`, `silent`, `no_user`); ayrı davranış kodlanmaz.
   r2 (O-PD-3): ikinci katman istemcide — gözetimsiz (cihaz bileti/servis/yardımcı) bağlantıda `voice1` bildirilmez, `internal/voice`
   kurulmaz. Mikrofon aygıtı açıkken kapatılamaz tepsi göstergesi ("Mikrofon açık"/"Sessizde", "Görüşmeyi bitir") zorunludur.
8. **Permissions-Policy:** Next `proxy.ts` tüm sayfalarda `microphone=(self)`, `/r/*`'de `()` kullanır. Politika belge yüklenirken
   sabitlendiği, konsola da yumuşak gezinmeyle (`Link`/`router.push`) geçildiği için sayfa bazlı ayrım mikrofonu kırar
   (mimari-p28d §7 K-PD-1). Fastify (`/api`, `/ws`) `microphone=()` olarak kalır.
   r2 (D-PD-1): politika tek saf `permissionsPolicyFor(pathname)`; herkese açık yeni sayfa `()` listesine eklenir.
9. **Kayıt:** P28e kaydedicisi yalnız video iziyle `MediaStream` kurar (`apps/web/lib/rec/recorder.ts`). Ses kayda girmez; bu durum
   testle sabitlenir (AC-375).

## Alternatifler

| Alternatif                                                                     | Neden seçilmedi                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cgo + libopus (`hraban/opus`; mingw veya `zig cc`)                             | `CGO_ENABLED=0` ve SHA eşitliği (ADR-0010) bozulur, CI'a C araç zinciri girer, iki ikilinin derlemesi değişir                                                                                                                                                                                                                               |
| `thesyncim/gopus` v0.2.3 (saf Go, BSD-3)                                       | Go ≥ 1.27.3 istiyor; toolchain yükseltmesi (GO_IMAGE, CI) bu paketin kapsamı dışında. **Tek yedek (r3):** toolchain 1.27'ye geçerse ve aynı fuzz + `-race` kapısını geçerse                                                                                                                                                                 |
| `kazzmir/opus-go` v1.6.0 (libopus 1.6.1'in ccgo çevirisi, BSD-3; r2 kararıydı) | r3 K0s'ta KALDI: `go test -race` `checkptr` fatal (`Opus_silk_Get_Encoder_Size`; upstream'de de); bozuk pakette GC'ye bağlı, deterministik olmayan `celt_fatal` paniği. Yığın adresinin `uintptr` olarak taşınıp yığın küçültmede bayatladığına dair güçlü gösterge var (kanıtlanmadı); `recover` Go belleğindeki olası bozulmayı önleyemez |
| opus-go + `GODEBUG=gcshrinkstackoff=1`                                         | Süreç geneli bir ayar; `-race`/checkptr'ı çözmez; yığın büyümesinde de taşınma olduğu için kanıtlanmış bir güvence değil                                                                                                                                                                                                                    |
| `pion/opus` (MIT)                                                              | Yalnız SILK çözücü var, kodlayıcı yok; Chrome'un CELT/hibrit karelerini çözemez                                                                                                                                                                                                                                                             |
| G.711 PCMU (saf Go, birkaç satır)                                              | AC-375 açıkça Opus istiyor; ses kalitesi düşük                                                                                                                                                                                                                                                                                              |
| `gen2brain/malgo` (miniaudio)                                                  | cgo gerektirir                                                                                                                                                                                                                                                                                                                              |
| Teknisyenler birbirini duymasın (müşteri yalnız kendi mikrofonunu göndersin)   | AC-378 bozulur, izleyici konuşmanın yarısını duyar                                                                                                                                                                                                                                                                                          |
| SFU / sunucuda karıştırma                                                      | Sunucu sesi çözmemeli (AC-375); ayrıca yeni bileşen gerekir. > 3 teknisyen gelirse (R43) yeniden değerlendirilir                                                                                                                                                                                                                            |
| Sunucunun SDP'yi ayrıştırıp izleyicinin `sendrecv` offer'ını reddetmesi        | `voice.join` 403 + misafirin talker kapısı yeterli; SDP ayrıştırma kırılgan                                                                                                                                                                                                                                                                 |
| Misafirin WS kopmasında 30 sn pay (r1)                                         | P2P ses sunucudan kesilemez; payda çıkarılan teknisyen dinlemeyi sürdürebilir (O-PD-1). Anında bitiş + yeni kabul daha basit                                                                                                                                                                                                                |
| Görüşme başına yeniden müzakere (ses m-line'ını kabulde eklemek)               | P28c'deki üç eşte offer/answer yarışı ve glare riski; transceiver'ı baştan koymanın maliyeti yok                                                                                                                                                                                                                                            |

## Sonuçlar

- (+) Ana derleme hattı değişmez: CGO=0, iki derlemede SHA eşit, C araç zinciri ve yeni sistem DLL'i yok. İkili ≈ 2,54 MiB büyür.
  Yeni olan: `libopus.wasm` ayrı ve tekrarlanabilir bir hatla (Docker + digest ile sabit wasi-sdk) üretilir, repoya girer, CI yeniden
  üretip karşılaştırır. Lisanslar: libopus BSD-3, wazero Apache-2.0, wasm içi wasi-libc/musl/compiler-rt (MIT, Apache-2.0 WITH
  LLVM-exception). Bildirimler ikiliye gömülür ve tepsi menüsü "Lisanslar"da gösterilir (O-PD-4, m.1 c).
- (+) Y-PD-2 yapısal olarak kapanır: bozuk paket Go belleğine ve komşu örneğe dokunamaz, tuzak örnek başına yalıtılır.
- (+) Katılımcılar birbirini duyar, yetkili (`sessions.voice`) izleyici tüm konuşmayı dinler. Sunucu sesi görmez.
- (−) Çalışma zamanı JIT'tir. Sandbox gerekçesi wazero derleyicisinin doğruluğuna dayanır ve arm64 arka ucunda yanlış derleme görüldü
  (risk R44, m.1 a). Azaltım: wazero commit'i ve wasm digest'i sabit; amd64'te derleyici = yorumlayıcı eşitlik testi CI'da koşar.
  Dependabot `tetratelabs/wazero` için ayrı PR açar, otomatik birleştirme yoktur; her yükseltmede `-race`, ≥ 30 dk fuzz ve eşitlik testi
  yeniden koşulur. libopus sürümü yalnız `libopus-wasm.sh` üzerinden (yeni tarball SHA + yeniden üretim) değişir. Runbook libopus 1.6.1
  güvenlik duyurularını izler, çünkü govulncheck wasm içini görmez. Fuzz wasm içini kapsam güdümlü göremez (m.1 d).
- (−) Chrome'un Opus yükü, Windows referans süresi ve WASAPI donanımı K0s'ta ölçülmedi; K3/K5'te staging'de elle doğrulanır.
- (−) Windows istemcide AEC yok; hoparlörle kullanımda teknisyen kendi yankısını duyabilir. Kulaklık önerisi metni ve Sonra genişleme noktası var.
- (−) Müşteri yüklemesi teknisyen başına ≈ 40 kbit/s artar (≤ 3 eş ≈ 120 kbit/s); AC-371 bütçesinde önemsizdir.
