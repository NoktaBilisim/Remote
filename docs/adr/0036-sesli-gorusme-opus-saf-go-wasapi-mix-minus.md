# ADR-0036 — Sesli görüşme: CGO'suz Opus, ham COM WASAPI, müşteride mix-minus, oda düzeyinde tek görüşme

Tarih: 2026-11-17 · Durum: Kabul r2 (güvenlik tasarım turu Y-PD-1..3, O-PD-1..4, D-PD-1..5 işlendi — mimari-p28d §14; K0s spike'ı ile doğrulanacak) · İlgili: AC-373..379, R44,
V45, ADR-0004, ADR-0009, ADR-0010, ADR-0011, ADR-0034, ADR-0035, `docs/mimari-p28d.md`

## Bağlam

- P28d, teknisyen ile müşteri arasında WebRTC sesi istiyor (Opus, DTLS-SRTP). Ses tarayıcı modunda ve Windows istemcide aynı akışla çalışacak.
  P28c mesh'inde en çok 3 teknisyen var; izleyici yalnız dinleyebilir.
- Windows istemci CGO'suz derleniyor (`build/build.sh`: `CGO_ENABLED=0 -trimpath -buildid=`). CI iki derlemenin SHA-256'sının eşit
  olduğunu denetliyor (ADR-0010). Video kodlama Media Foundation'a ham COM çağrısıyla yapılıyor (`internal/capture/com_windows.go`).
  Windows'ta yerleşik bir Opus kodlayıcı yok.
- Mesh'te her teknisyenin PeerConnection'ı yalnız müşteriyle kurulu; teknisyenler arasında eş yok. Müşteri yalnız kendi sesini
  gönderirse katılımcılar birbirini duymaz ve izleyici konuşmanın yalnız yarısını duyar. Bu durumda AC-378 fiilen bozulur.
- AGPL/GPL yasak. Ekipte WASM ya da cgo çapraz derleme deneyimi yok. Kullanıcı sadelik istiyor.

## Karar

1. **Opus (Go):** `github.com/kazzmir/opus-go` v1.6.0 sabitlenir (commit `bc2aa842b45aaa82636296012c04c4782b8df7c3`; v1.7.0 etiketi
   aynı commit'e işaret ettiği için sürüm etiketi değil hash esastır ve `implementation.md`'ye yazılır; `go.sum` + `GOFLAGS=-mod=readonly`). Kütüphane libopus C kaynağının ccgo ile Go'ya çevrilmiş hâlidir:
   kodlayıcı ve çözücü (SILK/CELT/hibrit) içerir. Lisansı BSD-3-Clause, kaynak libopus da BSD-3. Bağımlılığı yoktur ve
   `go 1.24` ister (bizim toolchain'imiz 1.26.11). `CGO_ENABLED=0` ve tekrarlanabilir derleme korunur. Kütüphane yalnız
   `internal/voice/opus.go` içinden çağrılır (ince sarmalayıcı; değiştirmek gerekirse yalnız bu dosya değişir). Doğrulanan v1.6.0 API'si:
   `NewEncoder(rate, ch, app)`, `SetBitrate`, `SetVBR`, `SetComplexity`, `Encode(pcm, frameSize, packet)`; `NewDecoder(rate, ch)`,
   `Decode(packet, pcm, frameSize, decodeFEC)` (ham RTP yükü, Ogg gerekmez). Hedef ayarlar: 48 kHz, mono, 20 ms, `VOIP`, 32 kbit/s VBR,
   karmaşıklık 5. Kodlayıcı tarafında FEC ayarı dışa açık değil; gerekmez. Chrome'un bant içi FEC'i çözücüde `decodeFEC=true` ile
   kullanılır. Kayıpta PLC (`Decode(nil, …)`) davranışı K0s'ta doğrulanır.
   **Yalıtım (r2, Y-PD-2):** Çözücü teknisyen kontrolündeki girdiyi işler ve çevrilmiş kodda `celt_assert`/`celt_fatal` → `panic` ile
   16 bini aşkın `unsafe.Pointer` vardır. Bu yüzden `opus.go` sırası şudur: yalnız `talkers` içindeki tid'in paketi çözülür (diğerleri
   çözülmeden atılır) → yük ≤ 1275 bayt ve tid başına ≤ 100 paket/sn → her `Decode`/`Encode` `defer recover()` ile sarılır; panic'te
   çözücü yeniden kurulur, aynı tid için 3. panic'te o eşin sesi görüşme sonuna dek düşer, süreç ölmez. Çözücü/kodlayıcı her görüşmede
   sıfırdan kurulur. K0s kabulü: `FuzzDecode` ≥ 30 dk, panic sarmalayıcıdan kaçmaz, `-race` temiz; modülde `os/exec`, `net`, `syscall`
   içe aktarımı ve `init()` yan etkisi yok. **Fuzz başarısızsa wazero yedeğine geçilir** (bellek WASM içinde yalıtık).
   Yeni teknoloji ölçütleri: **ekipte bilgi**: Go API'si libopus'la aynı, öğrenme yükü düşük. **Bakım**: v1.6.0 (2026-09-25; r1'deki "2025-09" yanlıştı), tek geliştirici,
   taban libopus 1.6.1. Çeviri libopus'tan yapıldı ancak README LLM destekli düzenleme belirtiyor ve ~4,8 MB üretilmiş kod insan
   incelemesine kapalı; bu yüzden doğruluk varsayılmaz, çözücü yalıtılır (aşağıda). **Geri dönüş**: sarmalayıcı tek dosya; gopus/wazero yedekleri aşağıda.
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

| Alternatif                                                                   | Neden seçilmedi                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cgo + libopus (`hraban/opus`; mingw veya `zig cc`)                           | `CGO_ENABLED=0` ve SHA eşitliği (ADR-0010) bozulur, CI'a C araç zinciri girer, iki ikilinin derlemesi değişir                                                                                           |
| `thesyncim/gopus` v0.2.3 (saf Go, BSD-3)                                     | Go ≥ 1.27.3 istiyor; toolchain yükseltmesi (GO_IMAGE, CI) bu paketin kapsamı dışında. **İkinci yedek (r2):** toolchain 1.27'ye geçerse                                                                  |
| libopus → WASM + `tetratelabs/wazero` (Apache-2.0)                           | CGO'suz ve sağlam, ancak `.wasm` için ayrı tekrarlanabilir derleme hattı (wasi-sdk imajı + hash denetimi) gerekiyor ve ekipte bilgi yok. **Birinci yedek (r2):** bellek yalıtımı Y-PD-2 riskini kapatır |
| `pion/opus` (MIT)                                                            | Yalnız SILK çözücü var, kodlayıcı yok; Chrome'un CELT/hibrit karelerini çözemez                                                                                                                         |
| G.711 PCMU (saf Go, birkaç satır)                                            | AC-375 açıkça Opus istiyor; ses kalitesi düşük                                                                                                                                                          |
| `gen2brain/malgo` (miniaudio)                                                | cgo gerektirir                                                                                                                                                                                          |
| Teknisyenler birbirini duymasın (müşteri yalnız kendi mikrofonunu göndersin) | AC-378 bozulur, izleyici konuşmanın yarısını duyar                                                                                                                                                      |
| SFU / sunucuda karıştırma                                                    | Sunucu sesi çözmemeli (AC-375); ayrıca yeni bileşen gerekir. > 3 teknisyen gelirse (R43) yeniden değerlendirilir                                                                                        |
| Sunucunun SDP'yi ayrıştırıp izleyicinin `sendrecv` offer'ını reddetmesi      | `voice.join` 403 + misafirin talker kapısı yeterli; SDP ayrıştırma kırılgan                                                                                                                             |
| Misafirin WS kopmasında 30 sn pay (r1)                                       | P2P ses sunucudan kesilemez; payda çıkarılan teknisyen dinlemeyi sürdürebilir (O-PD-1). Anında bitiş + yeni kabul daha basit                                                                            |
| Görüşme başına yeniden müzakere (ses m-line'ını kabulde eklemek)             | P28c'deki üç eşte offer/answer yarışı ve glare riski; transceiver'ı baştan koymanın maliyeti yok                                                                                                        |

## Sonuçlar

- (+) Derleme hattı değişmez (CGO=0, SHA eşit), yeni sistem DLL'i ve C araç zinciri gerekmez. Lisanslar BSD-3 (libopus, opus-go);
  `docs/implementation.md` lisans listesine eklenir ve BSD-3 m.2 gereği iki telif bildirimi
  (opus-go, Xiph libopus) ikiliye gömülüp tepsi menüsü "Lisanslar"da gösterilir (O-PD-4).
- (+) Katılımcılar birbirini duyar, yetkili (`sessions.voice`) izleyici tüm konuşmayı dinler. Sunucu sesi görmez.
- (−) `opus-go` tek geliştiricili, çevrilmiş bir kod tabanı (risk R44). Azaltım: commit hash'i sabitlenir; çözücü yalıtılır ve K0s'ta ≥ 30 dk fuzz edilir (Y-PD-2); Dependabot bu modülde ayrı PR açar,
  otomatik birleştirme yoktur, her yükseltmede fuzz yeniden koşulur; runbook libopus 1.6.1 güvenlik duyurularını izler (govulncheck
  libopus CVE'lerini opus-go'ya eşlemez); K0s spike'ı Chrome ile iki yönlü
  birlikte çalışmayı, CPU süresini ve ikili boyutunu ölçer; sarmalayıcı tek dosyadadır; yedekler (gopus, wazero) bu ADR'de yazılıdır.
- (−) Windows istemcide AEC yok; hoparlörle kullanımda teknisyen kendi yankısını duyabilir. Kulaklık önerisi metni ve Sonra genişleme noktası var.
- (−) Müşteri yüklemesi teknisyen başına ≈ 40 kbit/s artar (≤ 3 eş ≈ 120 kbit/s); AC-371 bütçesinde önemsizdir.
