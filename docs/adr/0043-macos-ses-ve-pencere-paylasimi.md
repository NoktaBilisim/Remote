# ADR-0043 — macOS'ta ses (AudioToolbox Opus + AudioQueue) ve tek pencere paylaşımı (SCK)

Tarih: 2026-11-22 · Durum: Önerildi r1 (güvenlik tasarım turu K0g ve K0s spike'ları bekliyor) · İlgili: AC-534..558, `docs/mimari-p33.md`,
ADR-0036 (m.1 macOS için değişir), ADR-0037 (m.6 entitlement, m.7 ses dalı değişir), ADR-0009, ADR-0010, ADR-0034

## Bağlam

- P28f macOS istemcisi sesi bildirmiyor (A-PF-1, dal (c)). Neden: ADR-0036'nın Opus yolu (libopus 1.6.1 wasm + wazero) Apple Silicon'da
  gerçek zamanlı değil. K0s-6 (`docs/spike-p28f-k0s.md`): wazero arm64 derleyicisi libopus kodlayıcısını karmaşıklık 2 ve 5'te yanlış
  derliyor (tuzak); yorumlayıcı karmaşıklık 0'da bile 20–26 ms/çerçeve. Derleyici ad-hoc imza + hardened runtime'da
  `com.apple.security.cs.allow-unsigned-executable-memory` olmadan SIGKILL alıyor (`allow-jit` yetmiyor).
- 2026-11-22 ek ölçüm (M4 Pro, darwin/arm64, mevcut benchmark): yorumlayıcı kodlama 16,2 ms, çözme 3,27 ms/çerçeve.
- 2026-11-22 doğrulama (macOS 26.3.1): AudioToolbox Opus kodlayıcı ve çözücüsü mevcut (`afconvert -d opus@48000 -b 32000`: 960 çerçeve/paket,
  ≈ 33,9 kbit/s, geri çözüldü). macOS 13/14'te varlığı doğrulanmadı.
- Pencere paylaşımı (AC-248) Windows'ta WGC ile var; Mac'te `WindowCapture` false. Mac tam ekran yakalaması zaten ScreenCaptureKit +
  purego (`objc.NewBlock`) ile çalışıyor. `CGWindowListCreateImage` SDK başlığında `SCREEN_CAPTURE_OBSOLETE(10.5,14.0,15.0)` (14'te deprecated, 15'te obsoleted; 2026-11-22 doğrulandı).
- Konsol pencere modunu `share.state.method === "WGC"` ile tanıyor; şema `strictObject` + `z.enum(["DXGI","GDI","WGC"])`.
- Kısıtlar: `CGO_ENABLED=0`, Linux'ta tekrarlanabilir darwin derlemesi (ADR-0037 m.1), hardened runtime (S-P28f-5), AGPL/GPL yasak,
  sadelik (Windows ile aynı UX, tek yol).

## Karar

1. **Opus (yalnız darwin): AudioToolbox `AudioConverter` (`kAudioFormatOpus`), kodlama ve çözme, purego ile.** darwin ikilisine wazero ve
   `libopus.wasm` bağlanmaz (CI `go list -deps` denetimi). Genel API (`NewEncoder/Encode/Lookahead`, `NewDecoder/Decode/Conceal/DecodeFEC`)
   ve `Decoder` politikası (boyut ≤ 1275, ≤ 100 paket/sn, hata sayacı → 3'te eş düşer) ortak kalır; arka uç build etiketiyle seçilir
   (`opus_wasm.go` `!darwin` davranışsız taşıma, `opus_darwin.go`). Çözmeden önce saf Go **RFC 6716 §3.4 R1–R7** paket doğrulayıcısı.
   PLC/FEC AudioConverter'da yoksa Go PLC (son çerçeve −6 dB adımlarla, 5 adımdan sonra sessizlik), FEC atlanır.
   Mac'te `voice.Supported()` çalışma zamanı yoklamasıdır (kodlayıcı + çözücü kurulur ve 1 çerçeve gidiş-dönüş geçer); false ise
   `rs.cap.voice1` bildirilmez (AC-352 pasif düğme).
2. **Ses aygıtı: AudioQueue** 48 kHz mono Int16, 20 ms × 3 tampon (K0s-6 GEÇTİ). Mix-minus, jitter, talker/gönderim kapıları, K-PD-2
   rıza kuralı ADR-0036 m.3–m.6 ile aynı ortak kod. Yankı giderme yok (kulaklık önerisi); genişleme noktası VoiceProcessingIO AudioUnit.
3. **Mikrofon izni:** `AVCaptureDevice` durum/istek yalnız yerel "Kabul" tıklamasının devamında; izin/aygıt yoksa `voice.end{device}` +
   rehber (Windows V-PD-1 ile aynı; mimari-p28f §5.3 m.4 "dinleme devam eder" taslağı geçersiz).
4. **Entitlement kümesi tam olarak `{com.apple.security.device.audio-input}`**; `Info.plist` `NSMicrophoneUsageDescription`. Hardened
   runtime korunur. `allow-unsigned-executable-memory`, `allow-jit`, `disable-library-validation` **eklenmez**. (ADR-0037 m.6 "liste boş"
   kararını değiştirir.)
5. **Pencere paylaşımı: ScreenCaptureKit `SCContentFilter initWithDesktopIndependentWindow:`** mevcut SCK akış altyapısı üzerinde;
   pencere durumu tek kaynaktan `CGWindowListCopyWindowInfo` (yok → `WINDOW_CLOSED`; ekranda değil → siyah kare + girdi düşer).
   Liste: geçerli Space'te ekranda olan normal pencereler (başka Space/tam ekran yok — S-P33-3; simge durumundakiler varsayılan olarak yok —
   sapma D-P33-1, izinsiz güvenilir işaret yok).
6. **Girdi kapsamı:** ortak `input/scope.go` motoru; Mac `WindowAPI` uygulaması CGWindowList + PID + `NSWorkspace.frontmostApplication`
   ile; kısayollar platform `ShortcutPolicy`'si (Windows kuralları davranışsız taşınır; Mac AC-549 tablosu, Ctrl→⌘ eşlemesinden sonra).
   Fail-closed.
7. **Sözleşme: `SHARE_METHODS` değişmez; Mac pencere modunda `"WGC"` tel değerini gönderir** (anlamı "pencere modu"); konsol etiketi
   nötr "Pencere yakalama". Yeni neden kodu yok. Böylece eski sunucu da yeni Mac istemcisini kabul eder, yayın sırası kısıtı doğmaz.

## Alternatifler

| Alternatif                                                           | Neden seçilmedi                                                                                                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a′) wazero derleyici + karmaşıklık ≤ 1 + JIT entitlement            | Hardened runtime'da `allow-unsigned-executable-memory` zorunlu (ölçüldü); bilinen arm64 yanlış derlemesi sandbox gerekçesini zayıflatır; kalite düşük |
| Hardened runtime'ı kapatmak                                          | S-P28f-5 / AC-554 ihlali; `DYLD_*` savunması kaybolur                                                                                                 |
| wazero yorumlayıcı                                                   | 16,2 + 3,27 ms/çerçeve (M4 Pro) — AC-538 bütçesi tutmaz                                                                                               |
| Apple kodlayıcı + wasm yorumlayıcı çözücü                            | Güvenilmeyen girdi sandbox'ta kalırdı ama konuşan başına ≈ %16 çekirdek; AC-538 CPU bütçesi tutmaz. G-P33-1 reddederse tek yedek                      |
| cgo libopus                                                          | `CGO_ENABLED=0` ve Linux'ta tekrarlanabilir darwin derlemesi bozulur; güvenlik profili AudioToolbox ile aynı, yamayı biz taşırız                      |
| AVAudioEngine                                                        | Daha büyük ObjC/blok yüzeyi; AudioQueue ölçüldü ve yeterli                                                                                            |
| `CGWindowListCreateImage`                                            | Deprecated/obsoleted; yoklama tabanlı; üstteki pencereleri de yakalar                                                                                 |
| `SCContentSharingPicker`                                             | Tek ekran ilkesi: Windows'la aynı kendi listemiz (kapsam dışı 4)                                                                                      |
| Yeni `SHARE_METHODS` değeri (`"SCK"`)                                | Eski sunucu `strictObject` ile tüm `share.state`'i düşürür; yayın sırası bağımlılığı + iki değerli konsol mantığı; kazanç yalnız isimlendirme         |
| Erişilebilirlik iznine göre simge durumundaki pencereleri listelemek | Açılış yoluna/izne göre değişen davranış (sadelik ilkesi)                                                                                             |

**Yeni teknoloji ölçütleri (AudioToolbox Opus):** ekipte bilgi — purego ile C API çağrısı ve `NewCallback` K0s-6/P28f'de kurulu;
bakım — Apple, işletim sistemi güncellemeleriyle; geri dönüş — arka uç tek dosya (`opus_darwin.go`) ve `codecBackend` arayüzü; yoklama
false ile ses kapatılabilir (oturum etkilenmez).

## Sonuçlar

- Olumlu: Mac'te ses ve pencere modu Windows'la aynı akışta; JIT ve yeni bağımlılık yok; darwin ikilisi ≈ 2,5 MiB küçülür; sözleşme
  ve sunucu değişmez; Windows/Linux davranışı değişmez.
- Olumsuz / kabul edilen: Mac'te teknisyenden gelen Opus paketleri sandbox'sız yerel çözücüye gider (R-P33-11; azaltım: talker kapısı,
  boyut/hız, R1–R7, fuzz; güvenlik kararı G-P33-1). PLC/FEC Apple çözücüsünde yoksa kayıplı ağda kalite Windows'tan düşük olabilir.
  macOS 13'te Opus yoksa ses o sürümde pasif. Simge durumundaki pencereler listede yok (D-P33-1). `"WGC"` tel adı Mac'te teknik olarak
  yanıltıcı; yorum ve bu ADR ile kayıtlı.
- Doğrulama sınırı: S-P33-1 kararı yalnız macOS 26'da `afconvert` dosya düzeyi denemesine dayanır. purego ile `AudioConverter`, Chrome ham paketleriyle
  birlikte çalışma, PLC/FEC ve macOS 13–15'te varlık K0s-A1'dedir. Kodlayıcı ölçütü düşerse dal (c) (Mac'te ses kapalı) ya da kullanıcı risk
  kabulüyle (a′); yalnız çözücü/G-P33-1 reddinde (b′).
- AC-554'teki "ADR-0037 revizyonu" bu ADR ile karşılanır.
- İzleme: K0s-A1/A2/W1–W3 sonuçları `docs/spike-p33-k0s.md`'ye; ölçüt düşerse bu ADR r2.
