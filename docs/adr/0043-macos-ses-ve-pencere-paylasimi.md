# ADR-0043 — macOS'ta ses (AudioToolbox Opus + AudioQueue) ve tek pencere paylaşımı (SCK)

Tarih: 2026-11-22 · Durum: Önerildi **r2** (güvenlik tasarım turu S-P33-T-1..10 ve K0s spike'ı işlendi — mimari-p33 §13; K0g tur 2 onayı bekliyor) · İlgili: AC-534..558, `docs/mimari-p33.md`, `docs/spike-p33-k0s.md`,
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

1. **Opus (yalnız darwin): AudioToolbox `AudioConverter` (`kAudioFormatOpus`), purego ile. r2: kodlama ana süreçte, çözme `sandbox_init`
   ile kısıtlı alt süreçte** (S-P33-T-1 öneri A). Aynı ikili `--opus-cozucu` kipinde başlar, AudioConverter kurulmadan önce
   `(deny default)(allow file-read*)(allow sysctl-read)(allow mach-lookup (global-name "com.apple.audio.AudioComponentRegistrar"))`
   profiline girer (ölçülen en küçük çalışan profil, p95 değişmedi); ana süreçle boru IPC (uzunluk + paket → 960 örnek). Yardımcının
   çökmesi/askısı `ErrCodecPanic`; 3'te eş düşer. `sandbox_init` başarısızsa ses kapalı (fail-closed). IPC gecikme bütçesi (p95 ≤ 0,5 ms)
   ve `file-read*` daraltması K1'de ölçülür. darwin ikilisine wazero ve `libopus.wasm` bağlanmaz (CI `go list -deps`). Genel API ve
   `Decoder` politikası ortak kalır (`opus_wasm.go` `!darwin` davranışsız taşıma). Paket sırası: talker kapısı → boyut/hız → RFC 6716
   R1–R7 (**çerçevesi geçersiz paket girmez; yük içeriği çözücüye ulaşır** — birincil savunma sandbox) → 20 ms süzgeci (ASBD
   `mFramesPerPacket = 960` sabit; 20 ms dışı paket ve 0 örnekli dönüş = düşür + `DecodeErr`) → yardımcı. PLC Apple'ın (0 baytlık paket);
   FEC yok. İlk çerçeve 840 örnek (sıfırla doldurulur); `Lookahead` = 312.
   Mac'te `voice.Supported()` çalışma zamanı yoklamasıdır (kodlayıcı + yardımcıda 1 çerçeve gidiş-dönüş); **AudioQueue açmaz,
   `AVCaptureDevice` çağırmaz** (S-P33-T-4). false ise `rs.cap.voice1` bildirilmez (AC-352 pasif düğme).
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
6. **Girdi kapsamı:** ortak `input/scope.go` motoru; Mac `WindowAPI` CGWindowList + PID; katman-0 sayfa ve ön plan **AX ile kesin**
   (`AXSheet` + `AXParent`/`AXWindow`; `AXFocusedApplication` → `AXFocusedWindow`), AX okunamazsa düşer (S-P33-T-3). Kısayollar platform
   `ShortcutPolicy`'si: Windows kuralları davranışsız taşınır; Mac'te **önce genel kural** ({⌘,⌥,⌃}'den iki değiştirici basılıysa düş),
   sonra tek değiştirici tablosu (⌃+ok/Space/F/Tab/Esc, ⌥Space, ⌘+Space/Tab/\`/F, ⇧⌘Q, ⇧⌘3–6), ⇧×5/⌥×5 her zaman düşer, ardından **açık
   izinli liste** (varsayılan-ret) (S-P33-T-2). Erişilebilirlik tercih alanı okunamazsa Yapışkan/Fare Tuşları açık sayılır; alan
   okunabiliyor ve anahtar yoksa kapalı (S-P33-T-5, K0s-W3). Eşleme sonrası Mac tuşlarıyla değerlendirilir.
7. **Sözleşme: `SHARE_METHODS` değişmez; Mac pencere modunda `"WGC"` tel değerini gönderir** (anlamı "pencere modu"); konsol etiketi
   nötr "Pencere yakalama". Yeni neden kodu yok. Böylece eski sunucu da yeni Mac istemcisini kabul eder, yayın sırası kısıtı doğmaz. r2 (B-1): `method` ileride audit/metriğe yazılırsa `clientOs` ile birlikte yazılır.

## Alternatifler

| Alternatif                                                           | Neden seçilmedi                                                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a′) wazero derleyici + karmaşıklık ≤ 1 + JIT entitlement            | Hardened runtime'da `allow-unsigned-executable-memory` zorunlu (ölçüldü); bilinen arm64 yanlış derlemesi sandbox gerekçesini zayıflatır; kalite düşük         |
| Hardened runtime'ı kapatmak                                          | S-P28f-5 / AC-554 ihlali; `DYLD_*` savunması kaybolur                                                                                                         |
| wazero yorumlayıcı                                                   | 16,2 + 3,27 ms/çerçeve (M4 Pro) — AC-538 bütçesi tutmaz                                                                                                       |
| Apple kodlayıcı + wasm yorumlayıcı çözücü                            | Güvenilmeyen girdi wasm sandbox'ta kalırdı ama konuşan başına ≈ %16 çekirdek (çözme 3,27 ms); AC-538 CPU bütçesi tutmaz                                       |
| Süreç içi (sandbox'sız) Apple çözücü (r1)                            | S-P33-T-1: ana süreç Ekran Kaydı + Erişilebilirlik + Mikrofon TCC'li; çözücü açığı bu izinlerle kod çalıştırır (CVE-2025-31200 sınıfı). R1–R7 yükü denetlemez |
| cgo libopus                                                          | `CGO_ENABLED=0` ve Linux'ta tekrarlanabilir darwin derlemesi bozulur; güvenlik profili AudioToolbox ile aynı, yamayı biz taşırız                              |
| AVAudioEngine                                                        | Daha büyük ObjC/blok yüzeyi; AudioQueue ölçüldü ve yeterli                                                                                                    |
| `CGWindowListCreateImage`                                            | Deprecated/obsoleted; yoklama tabanlı; üstteki pencereleri de yakalar                                                                                         |
| `SCContentSharingPicker`                                             | Tek ekran ilkesi: Windows'la aynı kendi listemiz (kapsam dışı 4)                                                                                              |
| Yeni `SHARE_METHODS` değeri (`"SCK"`)                                | Eski sunucu `strictObject` ile tüm `share.state`'i düşürür; yayın sırası bağımlılığı + iki değerli konsol mantığı; kazanç yalnız isimlendirme                 |
| Erişilebilirlik iznine göre simge durumundaki pencereleri listelemek | Açılış yoluna/izne göre değişen davranış (sadelik ilkesi)                                                                                                     |

**Yeni teknoloji ölçütleri (AudioToolbox Opus):** ekipte bilgi — purego ile C API çağrısı ve `NewCallback` K0s-6/P28f'de kurulu;
bakım — Apple, işletim sistemi güncellemeleriyle; geri dönüş — arka uç tek dosya (`opus_darwin.go`) ve `codecBackend` arayüzü; yoklama
false ile ses kapatılabilir (oturum etkilenmez).

## Sonuçlar

- Olumlu: Mac'te ses ve pencere modu Windows'la aynı akışta; JIT ve yeni bağımlılık yok; darwin ikilisi ≈ 2,5 MiB küçülür; sözleşme
  ve sunucu değişmez; Windows/Linux davranışı değişmez.
- Olumsuz / kabul edilen: güvenilmeyen Opus yükü yine yerel (kapalı kaynak) çözücüde işlenir, ama sandbox'lı alt süreçte (R-P33-11
  Orta); profil geniş `file-read*` ve kayıt servisi `mach-lookup` içerir; `sandbox_init` Apple'da deprecated (R-P33-15). FEC yok (PLC var).
  macOS 13'te Opus yoksa ses o sürümde pasif. Simge durumundaki pencereler listede yok — **D-P33-1 kalıcı** (K0s-W2 KALDI). Alt süreç
  yönetimi ek karmaşıklıktır. `"WGC"` tel adı Mac'te teknik olarak yanıltıcı; yorum ve bu ADR ile kayıtlı.
- Doğrulama (r2): K0s-A1 GEÇTİ (koşullu) — purego `AudioConverter`, 32 kbit/s, Apple↔libopus çapraz SNR ≥ 106 dB, p95 0,136/0,155 ms,
  PLC, 25 dk fuzz 0 çökme. Açık: macOS 14/15 (CI), 30 dk fuzz, gerçek Chrome yükü; A2 ve W1 elle (K1/K2 ilk adımı). Kodlayıcı ölçütü
  ileride düşerse dal (c) (Mac'te ses kapalı) ya da kullanıcı risk kabulüyle (a′).
- AC-554'teki "ADR-0037 revizyonu" bu ADR ile karşılanır.
- İzleme: kalan ölçümler `docs/implementation.md` (K1/K2) ve `docs/spike-p33-k0s.md`'ye; ölçüt düşerse bu ADR r3.
