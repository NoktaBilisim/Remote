# ADR-0037 — macOS istemci: CGO'suz purego/objc, AppKit doğrudan, .app paketi, Linux'ta derleme + macOS'ta imza/notarization

Tarih: 2026-11-17 · Durum: **Kabul r3** — K0s spike (`docs/spike-p28f-k0s.md`) işlendi: m.2, m.7, m.8 değişti (mimari-p28f §14); r2 — güvenlik tasarım turu (`docs/guvenlik-raporu.md` "P28f Tasarım turu", S-P28f-1..17) işlendi: m.3, m.6, m.7, m.8 değişti, ayrıntı `docs/mimari-p28f.md` §13; K0s spike sonucu bekleniyor (FAIL dalı aşağıda) · İlgili: AC-276, AC-389..396,
AC-393 (P28a–e), R39, R44, R49, V52, ADR-0004 (Go istemci), ADR-0009 (izin kapısı istemcide), ADR-0010 (tekrarlanabilir dağıtım),
ADR-0011 (lisans), ADR-0031 (yazdırma), ADR-0035 (ana/düşük iz), ADR-0036 (ses: libopus wasm + wazero), `docs/mimari-p28f.md`

## Bağlam

- Müşteri istemcisi `apps/agent-win` Go 1.26, `CGO_ENABLED=0`, `-trimpath -buildid=`; CI iki derlemenin SHA-256 eşitliğini denetler
  (ADR-0010). Platforma özgü kod `_windows.go` dosyalarında, akış (`internal/flow`, `signal`, `rtc`, `dc`, `control`, `transfer`, `fsrv`)
  platformdan bağımsızdır. Akış arayüzü `flow.UI` + `flow.Deps` işlev alanlarıdır; P28f bu sözleşmeyi değiştirmeden darwin uygulaması
  ekler (mimari-p28 §0 madde 7).
- macOS 13+ (Apple Silicon + Intel) için tek universal paket, ≤ 60 MB, kurulumsuz (AC-389). Prod'da Developer ID + notarization +
  staple zorunlu, yoksa macOS indirmesi görünmez (AC-390, R39). Staging imzasız TEST sürümü. Apple Silicon imzasız Mach-O çalıştırmaz
  (en az ad-hoc imza gerekir).
- TCC izinleri (Ekran Kaydı, Erişilebilirlik, Mikrofon) **kod imzası kimliğine** bağlıdır: Developer ID'de "bundle kimliği + Team ID",
  ad-hoc'ta cdhash. Mikrofon izni için `Info.plist` `NSMicrophoneUsageDescription` olmazsa süreç öldürülür. Yani paket bir `.app`
  olmak zorundadır; çıplak ikili TCC ile güvenilir çalışmaz.
- Gerekli sistem çerçeveleri: ScreenCaptureKit (blok/temsilci API'leri), VideoToolbox (C geri çağrısı), CoreGraphics (CGEvent, olay
  musluğu), Carbon `RegisterEventHotKey`, AppKit (pencereler), AudioToolbox, ApplicationServices (`AXIsProcessTrusted`), Security
  (`SecTranslocate*`).
- Sadelik ilkesi (kullanıcı kararı): tek ekran, tek yol, en az yeni bağımlılık. AGPL/GPL yasak. Ekipte Objective-C/cgo çapraz derleme
  deneyimi yok; WASM + wazero hattı (ADR-0036) var.

## Karar

1. **Sistem çerçevelerine erişim: `github.com/ebitengine/purego` v0.11.3 (+ `purego/objc`), `CGO_ENABLED=0`.**
   - Apache-2.0; Ebitengine ekibi aktif sürdürüyor (son sürüm 2026-11-01). Bağımlılığı yok (yalnız Go standart kitaplığı).
     Mimari §10.4 dışında olduğu için gerekçe burada ve `docs/implementation.md`'de yazılır. Sürüm `go.sum` ile sabit.
   - `purego.Dlopen` izin listesi: `/System/Library/Frameworks/*.framework/*`, `/usr/lib/libobjc.A.dylib`, `/usr/lib/libSystem.B.dylib`, yalnız **mutlak yoldan** (DLL arama sırası sertleştirmesinin,
     G-08, macOS karşılığı: göreli yol yok, `DYLD_*` ortam değişkenleri hardened runtime'da zaten yok sayılır).
   - Bloklar `objc.NewBlock`, temsilci sınıflar `objc.RegisterClass` (ör. `SCStreamOutput`), C geri çağrıları (VideoToolbox çıktı,
     AudioQueue, CGEventTap, Carbon kısayol) `purego.NewCallback` ile. Geri çağrılar **yalnız** kopyala-ve-kanala-bırak işi yapar;
     iş Go goroutine'inde yürür.
   - Böylece darwin ince ikilileri (arm64, amd64) **mevcut Linux Go imajında** (`GO_IMAGE`) çapraz derlenir; iki derleme SHA eşitliği
     Windows'takiyle aynı job kalıbıyla denetlenir. macOS çalıştırıcısı yalnız `lipo`, paketleme, `codesign`, notarization ve
     `go test` için kullanılır.
   - **Geri dönüş:** darwin kodu paket başına `_darwin.go` dosyalarındadır; bir paket (ör. `capture`) cgo + `.m` dosyasına tek başına
     taşınabilir. Bu durumda darwin derlemesi macOS çalıştırıcısına geçer (Xcode sürümü sabitlenir) ve ADR revize edilir.

2. **Yakalama + kodlama: ScreenCaptureKit + VideoToolbox H.264 Baseline.** `SCStream` (tek ekran, `SCContentFilter`
   `excludingApplications: [kendi uygulamamız]` → gösterge/işaretleme pencereleri görüntüye girmez), piksel biçimi NV12
   (`420YpCbCr8BiPlanarVideoRange`), boyut = nokta × `backingScaleFactor` (Retina 2x), üst sınır mevcut `capture/select.go` kuralı.
   `VTCompressionSession` Baseline, `RealTime`, `AllowFrameReordering=false`; bit hızı/anahtar kare `ratectl.go` + `low.go`'dan
   (ADR-0035 ana/düşük iz = iki oturum). AVCC → Annex B mevcut `annexb.go`'ya uyarlanır. İmleç `showsCursor=true` ile karede.

   **r3 (K0s-2):** SCK kaynağı GPU'da uzun kenar ≤ 1920 px'e ölçeklenir (tam Retina 4112 px donanım H.264'e girmiyor; yazılım
   kodlayıcı p95 232 ms). `RealTime` + Baseline korunur; ölçüt "30 fps, kodlama p95 ≤ 33 ms, kare kaybı 0" (1080p ölçülen 12,3 ms).
   `EnableLowLatencyRateControl` reddedildi: p95'i 6,9 ms'ye indiriyor ama ≈ %12 kare ve zorlanan IDR'yi atlıyor → yeni teknisyen
   katılımı ve PLI kurtarması bozulur. App Nap oturum boyunca `NSProcessInfo` etkinliğiyle kapatılır (arka plan yakalama uyutuluyordu).

3. **Girdi: CGEvent + Erişilebilirlik izni.** Fare olayları ekranın nokta (point) koordinatlarında (`CGDisplayBounds`) üretilir, normalize
   (0–1) koordinat Retina'da da ±2 piksel (AC-49). Metin karakterleri (Türkçe Q dahil) `CGEventKeyboardSetUnicodeString` ile düzen
   bağımsız; fiziksel tuşlar DOM `code` → `kVK_*` tablosu. Değiştirici eşlemesi: **Ctrl → ⌘ Command, Win/Meta → Control, Alt → Option**
   (Windows teknisyenin Ctrl+C/V/Z alışkanlığı Mac'te çalışsın). Kapatma kısayolu Control+Shift+F12 (yedek F11) **Carbon
   `RegisterEventHotKey`** ile — ek izin istemez, arka planda çalışır. Yerel girdi algılama (AC-104) ve sentetik tıklama reddi
   (G-03, D-P28a-1) **beyaz listedir, fail-closed** (r2, S-P28f-1): tek tanım `localClick()` (mimari-p28f §5.2a) — sol fare bırakma
   - aynı tıklamanın yerel basışı, `kCGEventSourceStateID == HIDSystemState`, `kCGEventSourceUnixProcessID == 0`, kendi enjekte
     olaylarımıza koyduğumuz `kCGEventSourceUserData` işareti yok; `currentEvent` yok / AX eylemi / klavye etkinleştirmesi = ret. Korunan
     denetim açıkken enjeksiyon durur; Erişilebilirlik kısayolları (Option×5, ⌘F5, ⌘⌥F5) hiç enjekte edilmez. Olay musluğu kurulamazsa
     kontrol verilmez, sistem kapatırsa yeniden açılır, açılamazsa kapı kapanır (S-P28f-10). Gösterge gizlenemez: `canHide=NO`, Gizle menüsü
     yok, 1 sn tik `unhide:`, ekran değişimi bildirimi, görünür kılınamazsa kapı kapanır (S-P28f-2; mimari §5.2b).

4. **Arayüz: AppKit doğrudan (purego/objc), WKWebView değil.** Pencereler programatik `NSStackView` düzeniyle; renkler sistem
   semantik renkleri (`labelColor`, `windowBackgroundColor`) → açık/koyu tema kendiliğinden (AC-247 karşılığı); yalnız tehlike kırmızısı
   ve logo zemini `ui/theme.go` tablosundan. Platformdan bağımsız ekran mantığı (`accept.go`, `voice.go`, `notices.go`, `logo.go`,
   `session_fit.go`, `theme.go`) yeniden kullanılır. Tepsi, firma ana ekranı, talep formu, pencere paylaşımı macOS'ta yoktur (V52).

5. **Paket: `.app` bundle, zip içinde, universal ikili.** Bundle kimliği `net.noktabilisim.destek`, yürütülebilir
   `Contents/MacOS/noktadestek` (`lipo` ile arm64+x86_64), `LSMinimumSystemVersion=13.0`. Zip içinde **iki üst düzey öğe**
   (`Nokta Destek.app` + `OKUBENI.txt`) bulunur; Arşiv İzlencesi bu durumda zip adıyla klasör açar (`Destek-<kod>/`), istemci kodu bu
   klasör adından okur (AC-97 karşılığı; okuyamazsa kod alanı). Zip baytları her kodda aynıdır (Windows'taki gibi yalnız sunulan dosya
   adı değişir) → `SHA256SUMS` ve AC-128 bütünlük denetimi korunur.

6. **İmza ve yayın.** Staging: ad-hoc **+ hardened runtime + prod ile aynı entitlement dosyası** (`codesign -s - --options runtime`,
   S-P28f-5), bundle kimliği `net.noktabilisim.destek.stg`; gizlenemeyen "TEST SÜRÜMÜ — imzasız" bandı **çalışma anında imzadan
   türetilir** (Team ID yok/ad-hoc → bant her durumda; `config.testBuild` yalnız ek koşul — S-P28f-7).
   Prod: Developer ID Application + hardened runtime + `--timestamp`, `notarytool submit --wait`, `stapler staple`,
   `spctl -a -vv -t exec` çıktısında "Notarized Developer ID" şartı. Apple sırları yalnız korumalı `agent-mac-sign` GitHub environment'ında;
   `vars.APPLE_TEAM_ID` yoksa imza job'u atlanır ve **Release'e macOS zip'i hiç girmez** (SignPath kalıbı, AC-252). Sunucu macOS
   indirmesini yalnız `MAC_AGENT_PATH` + `MAC_AGENT_SHA256` dolu ve dosya eşleşiyorsa sunar; prod'da bu değerler yalnız Release'ten
   (attestation doğrulamalı) gelir → imzasız zip prod'a ulaşamaz (AC-390). r2 sertleştirmeleri: platform başına ayrı forward_auth iç
   URI'si ve sabit `MAC_AGENT_PATH` (S-P28f-3); yayın betiğinde `--source-ref` zorunlu, `-stg-` adı ret, "notarized" predicate'li
   attestation ve Team ID denetimi (S-P28f-7); `sign-mac` girdiyi `reproducible-mac` SHA'larıyla doğrular ve bundle'ı kendisi üretir,
   güvenlik sınırı ortam deployment policy'si + zorunlu onaylayıcı + etiket ruleset'idir, keychain/sır kuralları mimari §8.2 (S-P28f-6).
   **Entitlements (r2, S-P28f-4; r3): ses kapalı olduğundan entitlement listesi boş;** `device.audio-input` yalnız A-PF-1 sesi açarsa eklenir. wazero iki dilimde de **yorumlayıcıyla** çalışır;
   JIT için `allow-unsigned-executable-memory` (wazero RW→RX `mprotect` kullandığından `allow-jit` yetmez) varsayılan olarak **yoktur**.
   CI imzalı paketteki entitlement'ları tam eşleşmeyle denetler; fazlası FAIL. `Info.plist`'te URL şeması, belge türü,
   `NSAppleScriptEnabled`, `NSServices` yoktur (S-P28f-14).

7. **r3 — macOS'ta ses yok (varsayılan dal c): `rs.cap.voice1` bildirilmez, entitlement yok, cgo yok.** K0s-6: arm64 wazero
   derleyicisi karmaşıklık 2 ve 5'te tuzak (A-PD-3 sürüyor); yorumlayıcı karmaşıklık 0'da bile 20–26 ms/çerçeve. Kullanıcı kararına
   açık seçenekler (mimari-p28f §12 A-PF-1): (a′) derleyici + karmaşıklık 0/1 (spike'ta bayt eşit, 0,2 ms) + `allow-unsigned-executable-memory`;
   (cgo) libopus. AC-393 ses kısmı karar bekliyor. Aşağıdaki r2 metni, ses açılırsa uygulanacak tasarım olarak kalır.
   r2: **Ses: AudioQueue (AudioToolbox), 48 kHz mono Int16, 20 ms tampon, varsayılan aygıt; mevcut wasm codec + mix-minus.** Yankı giderme
   yok (ADR-0036 ile aynı; kulaklık önerisi). VoiceProcessingIO (AEC) **Sonra** — genişleme noktası `voice/audio_darwin.go`'daki tek
   `openDevice`. r2 (S-P28f-4) K0s-6 karar ağacı: (a) **yorumlayıcı** (iki dilim) kodla + 3 çöz ≤ 10 ms/çerçeve sağlayan en yüksek
   kodlayıcı karmaşıklığıyla (ADR-0036 hedef ayarlarından tek sapma, `implementation.md`'ye yazılır); (b) hiçbir karmaşıklık yetmezse
   kullanıcı kararı (A-PF-1): ses macOS'ta bildirilmez (`rs.cap.voice1` yok, AC-393 kısmi) **ya da** derleyici + JIT entitlement'ı risk
   kabulüyle (ADR revizyonu; arm64'te ADR-0036 m.1 a derleyici hatası ayrıca çözülmüş olmalı) **ya da** cgo libopus.

8. **İz bırakmama (AC-394).** r3: AppKit çizimi `DARWIN_USER_CACHE_DIR/<bundle id>` altında Metal önbelleği oluşturur; kapanışta
   silinir ve iz testi bu dizini tarar. `NSUserDefaults`, pencere geri yükleme (`restorable=NO`), `NSURLSession`, WKWebView kullanılmaz; ağ Go
   `net/http`. Disk yazımı yalnız: (i) İndirilenler'e alınan dosya, (ii) izin sonrası yeniden başlatma için `$TMPDIR` (kullanıcıya özel
   `/var/folders/...`, `~/Library` dışı; dizin `confstr(_CS_DARWIN_USER_TEMP_DIR)`) altında 0600, ≤ 120 sn ömürlü, yalnız
   `--restart <belirteç>` eşleşmesiyle okunan ve okununca silinen kod dosyası (S-P28f-13). Kullanıcı önbellek dizinindeki
   `net.noktabilisim.destek*` kapanışta silinir; birleşik loga içerik yazılmaz (S-P28f-14). Yazdırma PDF'i `lp`'ye stdin'den
   akar (diske yazılmaz). Kapanışta `~/Library/Saved Application State/net.noktabilisim.destek.savedState` varsa silinir (emniyet).
   Tek istisna TCC kayıtları (kılavuzda `tccutil reset ScreenCapture net.noktabilisim.destek` vb.).

8a. **r4 — Yazdırma:** macOS'ta PDF istemcide ayrıştırılmaz; onay diyaloğunda sayfa sayısı "yazıcıda belirlenir", yazıcı "Varsayılan
yazıcı" olarak gösterilir (AC-349 macOS'ta kısmi; alt süreç TCC yetkisini devraldığı için yalıtım sağlamaz) — mimari-p28f K5 r4 notu.

9. **Kapsam dışı (macOS):** gözetimsiz servis (`internal/servis`, P27), tepsi/otomatik başlatma/çoklu firma kaydı (P20), "Bilgilerimi
   hatırla" (E9), firma dosyası ve destek talebi (E9/P19), pencere paylaşımı (AC-248), LG doğrudan indirme bağlantısı (V52).

## Alternatifler

| Seçenek                                               | Neden seçilmedi                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cgo + Objective-C (`.m`) dosyaları                    | En iyi belgelenen yol, blok/temsilci kolay. Ama darwin derlemesi macOS çalıştırıcısına ve Xcode sürümüne bağlanır; Linux'tan tekrarlanabilir çapraz derleme biter; Windows (CGO=0) ve macOS iki ayrı derleme modeli olur. Geri dönüş yolu olarak tutuldu. |
| `progrium/darwinkit` (eski macdriver)                 | MIT ama büyük üretilmiş API yüzeyi, cgo gerektirir, bakım sürekliliği belirsiz.                                                                                                                                                                           |
| Tek pencereli WKWebView + yerel HTML                  | Form ekranları kısalır, ama ikinci UI teknolojisi (HTML/JS köprüsü), G-03 sentetik tıklama denetimi JS'te zayıf, WebKit `~/Library/Caches`/`WebKit` altına iz bırakır (AC-394), gösterge/işaretleme yine yerel pencere ister.                             |
| ScreenCaptureKit `SCContentSharingPicker` (macOS 14+) | Ekran Kaydı TCC'si ve yeniden başlatma gerekmez; ama hedef 13+ ve sistem seçici AC-106'daki kendi monitör seçimimizle iki seçim yapar. Sonra (genişleme noktası: `capture/source_darwin.go` açılışı).                                                     |
| CGDisplayStream / `CGWindowListCreateImage`           | macOS 14/15'te kullanımdan kalktı, 15'te sürekli uyarı; SCK zaten 12.3+.                                                                                                                                                                                  |
| Çıplak ikili (bundle'sız) + tar                       | TCC bundle kimliğine bağlanamaz, mikrofon `Info.plist` ister, notarization/staple bundle'a uygulanır.                                                                                                                                                     |
| `.dmg`                                                | Bağlama/sürükleme adımı ve ayrı imza; zip + Arşiv İzlencesi daha az adım. Kod klasör adından okunamaz.                                                                                                                                                    |
| `rcodesign` (Linux'ta imza + notarization)            | Yeni araç; Apple aracı macOS çalıştırıcısında zaten var. `lipo` için de macOS gerekir.                                                                                                                                                                    |
| AUHAL / VoiceProcessingIO                             | AUHAL giriş/çıkış ayrı birim + aygıt yönetimi; VPIO AEC verir ama diğer uygulamaların sesini kısar ve davranışı Windows'tan ayrılır. AudioQueue en kısa yol; VPIO Sonra.                                                                                  |

## Sonuçlar

- (+) Tek derleme modeli (CGO=0, Linux'ta tekrarlanabilir), tek yeni Go bağımlılığı (purego), Windows yolu değişmez.
- (+) `flow`/`signal`/`rtc`/`dc`/`control` aynen kullanılır; macOS yalnız `flow.Deps` işlevlerini ve `flow.UI`'yi doldurur.
- (−) purego ile ScreenCaptureKit/VideoToolbox/AppKit kodu el yazımı Objective-C çağrısıdır (selector adları, bellek yönetimi
  `retain/release`, ana iş parçacığı kuralı). Riski K0s spike ölçer; geri dönüş cgo.
- (−) Korunan denetimler (onay, pano izni, Çıkar, ses) yalnız gerçek fare tıklamasıyla çalışır; VoiceOver/klavye ile kullanılamaz —
  güvenlik için kabul edilen erişilebilirlik ödünü (S-P28f-1; kılavuzda).
- (−) Ses yorumlayıcıyla çalıştığından kodlayıcı karmaşıklığı Windows'tan düşük olabilir (K0s-6).
- (−) Gerçek Intel donanımı yok; x86_64 dilim Apple Silicon'da Rosetta ile denenir (açık risk A-PF-3).
- (−) Prod R39'a bağlı: Apple Developer Program hesabı (D-U-N-S) olmadan macOS prod'da görünmez.
- Yeni teknoloji ölçütleri: **Ekipte bilgi:** purego yok, ancak API düz C/ObjC çağrısıdır ve spike tek belgede kalır. **Bakım:**
  purego Ebitengine'in kendi oyun motorunda (macOS) üretimde. **Geri dönüş:** paket başına cgo'ya geçiş (Karar m.1).
