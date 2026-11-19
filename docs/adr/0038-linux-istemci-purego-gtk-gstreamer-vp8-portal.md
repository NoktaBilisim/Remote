# ADR-0038 — Linux istemci: CGO'suz purego, GTK3 (X11 arka ucu), GStreamer VP8, xdg-desktop-portal, tek ELF

Tarih: 2026-11-17 · Durum: **Kabul r3** — güvenlik turu 2 (Y-P28g-T2-1, O-P28g-T2-1, D-P28g-T2-1..4) işlendi: m.4, m.5, m.6, m.14 değişti; AC-399 sapması **kullanıcı onayı 2026-11-17** (koordinatör aracılığıyla; mimari-p28g §15). r2: Güvenlik tasarım turu (S-P28g-1..13, tümü kabul) ve K0s spike (`docs/spike-p28g-k0s.md`) işlendi; m.1, m.3, m.5, m.6, m.11 değişti, m.14 eklendi. Ayrıntılar: `docs/mimari-p28g.md` §13–§14 · İlgili: AC-277,
AC-397..403, US-72, R46, V52, ADR-0004, 0009, 0010, 0011, 0031 (r4 yazdırma), 0035, 0036, 0037, `docs/mimari-p28g.md`

## Bağlam

- İstemci Go 1.26, `CGO_ENABLED=0`, tekrarlanabilir derleme (ADR-0010). purego v0.11.3 zaten bağımlılık (ADR-0037).
- Hedef: Ubuntu 22.04/24.04 x86_64, GNOME, X11 ve Wayland; tek dosya ≤ 60 MB, root yok, imza yok (AC-397, AC-403).
- Linux'ta sistem H.264 kodlayıcısı **garanti değil**: `x264enc` GPL (plugins-ugly, varsayılan değil), `openh264enc` Ubuntu'da varsayılan
  gelmez, `vah264enc` GPU/sürücüye bağlı. Windows (MF) ve macOS (VideoToolbox) H.264 kullanıyor.
- Wayland'de ekran yalnız xdg-desktop-portal ScreenCast → PipeWire ile alınabilir. PipeWire akışını saf Go ile tüketmek pratik değil
  (SPA/POD protokolü). Girdi yalnız RemoteDesktop portalıyla mümkün; global kısayol ve global girdi gözlemi hedef GNOME sürümlerinde yok.
- Gerçek Linux masaüstü yok; doğrulama Docker (Xvfb, başsız mutter) + elle (mimari-p28g A-PG-1).
- Sadelik ilkesi: tek yol, en az bağımlılık; AGPL/GPL yasak.

## Karar

1. **Sistem kitaplıkları purego ile, mutlak yoldan.** GLib/GObject/GIO/GTK3/GDK/Pango/Cairo, GStreamer (core, app, video), libpulse-simple, r2: libX11, libXi, libXtst
   `/usr/lib/x86_64-linux-gnu/` altındaki izin listesinden `dlopen` edilir. Paket `init`'inde yükleme yapılmaz; CI Linux'ta derler ve
   test eder, kitaplık yoksa test görünür SKIP verir. **r2 (S-P28g-5):** mutlak yol yalnız birinci düzeyi korur. Bu yüzden açılışta ortam izin listesiyle süzülür; liste dışı değişken varsa `/proc/self/exe` argümansız `syscall.Exec` ile bir kez yeniden başlatılır. `LD_*`, `GTK_MODULES`, `GDK_CORE_DEVICE_EVENTS`, `GIO_*`, `GST_*`, `SSL_CERT_*`, `PULSE_SERVER` gibi değişkenler kaldırılır; GStreamer değişkenleri sonra sabitlenir. Aynı kullanıcı yetkisindeki saldırgan kapsam dışıdır.
2. **C → Go geri çağrısı yalnız ana iş parçacığında.** GStreamer çekme kipinde (appsink pull, bus pop) kullanılır. Pulse engelleyen
   simple API ile, D-Bus saf Go ile kullanılır. GTK sinyalleri `init`'te kayıtlı sabit sayıda `purego.NewCallback` ile alınır. Değerle
   yapı geçirilmez, değişken argümanlı C işlevi çağrılmaz (`gst_util_set_object_arg`, `gst_parse_launch` kullanılır).
3. **Video: GStreamer, tek sabit boru hattı, VP8 (`vp8enc`, plugins-good, libvpx BSD).** Kaynak X11'de `ximagesrc`, Wayland'de
   `pipewiresrc` (portal fd + node). `tee` ile ana + düşük kodlayıcı (ADR-0035), `valve` ile düşük akış aç/kapa, `force-key-unit` olayı,
   çalışırken bit hızı değişimi. Otomatik eklenti seçici yoktur. r2 (S-P28g-4): öğe **beyaz listesi** CI'da ve çalışma anında (`gst_bin_iterate_elements`) denetlenir, dizgiye yalnız tamsayı girer, `display-name` yazılmaz. r2 (K0s-3): varsayılan uzun kenar **1280**, CPU'ya göre 1600/1920 basamağı (eşikler gerçek amd64'te elle). İki appsink `async=false`, tüketim başında açık anahtar kare, oran denetimi ölçülen bit hızıyla. **Linux'ta H.264 yok**
   (Sonra; genişleme noktası tek kodlayıcı dizgisi). `rtc.NewMedia(codec)`: Windows/macOS `H264`, Linux `VP8`. pion varsayılan kodekleri
   VP8'i kaydeder, tarayıcı teklifi VP8 içerir; konsol, kayıt (MediaRecorder) ve sunucu codec varsaymaz.
4. **Arayüz: GTK3, her oturumda X11 arka ucu (`gdk_set_allowed_backends("x11")`; Wayland'de XWayland).** Böylece tek yol olur: pencere
   konumu, override-redirect gösterge, tıklama geçiren giriş şekli, `gdk_event_get_source_device` ile XTEST ayrımı, GTK CLIPBOARD
   (mutter XWayland köprüsü) iki oturumda aynı çalışır. r3 (O-P28g-T2-1): süreç teması **sabit Adwaita** (gömülü; `notify::gtk-theme-name` geri yazılır), açık/koyu yalnız `prefer-dark` bool; kendi CSS sağlayıcımız ekran düzeyinde `GTK_STYLE_PROVIDER_PRIORITY_USER + 1` ile korunan bileşenlerin görünürlüğünü sabitler (kullanıcı `gtk.css`/teması gösterge ve onay diyaloğunu değiştiremez).
5. **Wayland: tek birleşik RemoteDesktop + ScreenCast portal oturumu** (`SelectDevices` KEYBOARD|POINTER, `SelectSources` MONITOR, tek,
   imleç gömülü, `persist_mode=0`). Tek sistem diyaloğu açılır. Kendi monitör seçim ekranımız yoktur (çifte seçim olmaz); teknisyenin monitör
   değiştirme isteği Wayland'de sunulmaz (liste tek öğe). Aygıt izni yoksa (24.04'te "Uzaktan etkileşime izin ver" varsayılan kapalı, K0s-6) `control.state{VIEW, WAYLAND_NO_CONTROL}` (yeni kaynak, yalnız
   `clientOs=linux`). Ret/iptalde "Paylaşım başlatılmadı / Tekrar dene". Portal `Closed` → kapı kapanır, oturum biter. Bu, global
   kısayolun (AC-102) Wayland karşılığıdır (K0s-6: `Closed` 6–8 ms). **r2 (S-P28g-1, koordinatör kararı):** Wayland'de AC-104 yoktur ve müşteri
   fareyle kaçamayabilir. Telafi: kilit ekranı (`ActiveChanged(true)`) → kontrol REVOKED (X11'de de); kilit kısayolu devre dışıysa kontrol
   verilmez, oturumda değişirse kapanır; r3 (Y-P28g-T2-1): değiştirici **bütçesi** — kayan 3 sn'de toplam ≤ 2 sn, bütçe dolu bırakmadan sonra 1 sn soğuma (basış düşer); uyarıda "çalışmazsa önce Super+Esc, sonra Super+L"; E-7 (a) işaretçi, (b) yeniden basılan Ctrl, (c) kipli kabuk diyaloğu, (d) kısayol engelleyici; klavye ısınması yalnız kontrol verildiği anda; `DBUS_SESSION_BUS_ADDRESS` yalnız `unix:path=$XDG_RUNTIME_DIR/bus` (soket, sahip) — uymazsa kontrol yok; diyalogda açık uyarı; a11y tıklama ayarı oturumda açılırsa
   korunan denetimler reddeder (S-P28g-3). Sapma gereksinimde yazılıdır ve **kullanıcı tarafından 2026-11-17'de onaylandı**. Kural: tarihli onay kaydı yoksa prod'da Wayland yalnız
   görüntü. **Tek FAIL dalı:** E-7 (b) ya da (c) gerçek makinede tutmazsa Wayland yalnız görüntü (RemoteDesktop istenmez). Portal yanıt ve sinyalleri gönderen ve değer sınırlarıyla
   doğrulanır (S-P28g-10).
6. **r2 — X11: purego libX11 + libXi + libXtst + GDK (xgb kaldırıldı).** K0s-5: `jezek/xgb` XI2 desteklemiyor. İki X bağlama
   yolu tutmamak için X11'in tamamı purego'ya alındı. GTK'dan önce `XInitThreads`. XTest enjeksiyonu ve XI2 ham olaylar ayrı `Display`'lerde,
   kilitli kendi iş parçacıklarında, engelleyen çağrılarla çalışır (C geri çağrısı yok). XTEST ayrımı aygıt **kimliğiyle** yapılır
   (`XIQueryDevice`, `XIHierarchyChanged`; S-P28g-13); kimlik alınamazsa kontrol verilmez. Zaman tabanlı yedek yoktur (S-P28g-7).
   Kısayol: GDK X bağlantısında `XGrabKey` + `gdk_x11_display_error_trap_push/pop` (eşzamanlı BadAccess) + `gdk_window_add_filter`;
   ana iş parçacığında. Monitörler GDK'dan. Tuş tablosu DOM `code` → evdev; X11 ve portal aynı tabloyu ve aynı `Applier`'ı kullanır.
   `GDK_CORE_DEVICE_EVENTS` silinir (ayrımı bozar). r3 (D-P28g-T2-2) FFI kuralları: XI2 olayında yalnız sabit ofsetli alanlar (CI'da
   `offsetof` karşılaştırması), `XFreeEventData`, X hata işleyicisi yok → Display hatası süreç çıkışı (fail-closed, kabul), C belleği/Pinner,
   `XFreeDeviceInfo`, kapanışta kendi istemci olayıyla uyandırma + aynı iş parçacığında `XCloseDisplay`.
7. **D-Bus: `github.com/godbus/dbus/v5` (BSD-2, saf Go)**: portal, `org.gnome.ScreenSaver` (kilit ekranı).
8. **Ses:** libpulse-simple (PipeWire-pulse / PulseAudio) + mevcut wasm Opus; amd64'te wazero derleyicisi (ADR-0036). `rs.cap.voice1`
   bildirilir.
9. **Yazdırma:** `lp_unix.go` + `printer_unix.go` (ADR-0037 m.8a r4 aynen: `PagesUnknown`, "Varsayılan yazıcı").
10. **Dosya:** MOTW karşılığı yürütme bitinin hiç konmamasıdır (`0644`); Linux başlatıcı türleri tehlike listesine eklenir.
11. **Paket** (r2: komut S-P28g-6 koşullarıyla — tek dosya, `folderCode` deseni, son 30 dk, satır sonu yok, uyarı; `Destek-` önekli alınan dosya `Dosya-` olarak yeniden adlandırılır; staging ikilisinde çalışma anında "TEST" metni, prod yayında `--source-ref` zorunlu — S-P28g-9): tek ELF `NoktaDestek-linux-x86_64-<sürüm>`, `Destek-<kod>` adıyla sunulur (uzantısız; kod `/proc/self/exe` adından, yoksa
    kod alanı). Kurulum yok, yeniden başlatma dosyası yok, tepsi/otomatik başlatma yok. Karşılama sayfası sabit `chmod u+x` + çalıştır
    komutunu kopyalanabilir verir (K0g onayına bağlı). İmza yok; SHA256SUMS + attestation; prod yalnız Release etiketinden.
12. **İz:** `XDG_CACHE_HOME` ve GStreamer kaydı `$XDG_RUNTIME_DIR/noktadestek-<rastgele>`'ye yönlendirilir, kapanışta silinir; tanılama
    logu yok.
13. **Kapsam dışı (Linux):** P27/P28u, P20, E9, talep, pencere paylaşımı, ARM64, Ubuntu GNOME dışı.
14. **r2/r3 — İz ve ortam ayrıntıları (S-P28g-11, D-P28g-T2-1/4):** `XDG_RUNTIME_DIR` `Lstat`/sahip/0700 ile doğrulanır, geçersizse `os.MkdirTemp("")` yedeği; stdout/stderr'e içerik yazılmaz, GLib log işleyicisi sessiz. `setrlimit(RLIMIT_CORE, 0)` koşulsuz; `PR_SET_DUMPABLE=0` açılışta ve portal/PipeWire kurulumu sonrası ölçülür, bozmayan noktada uygulanır. Proxy: `HTTPS_PROXY`/`https_proxy`/`NO_PROXY`/`no_proxy` izinli, `HTTP_PROXY`/`ALL_PROXY` yok; vekil URL'si hiçbir yere yazılmaz.

## Alternatifler

| Seçenek                                                                           | Neden seçilmedi                                                                                                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Saf Go X11 yakalama (xgb `GetImage`/SHM) + libvpx/openh264 wasm (wazero)          | Wayland için yine PipeWire tüketimi gerekir → iki yakalama yığını. SIMD'siz wasm VP8/H.264 1080p30'da yetersiz kalabilir. Ayrıca wasm derleme hattı genişler |
| GStreamer + çalışma anında H.264 seçimi (`vah264enc` → `openh264enc` → `x264enc`) | Test edilemeyen dal matrisi; `x264enc` GPL koda bağlanma riski; sonuç makineye göre değişir. VP8 her yerde aynı                                              |
| Her platformda VP8                                                                | Windows/macOS donanım H.264 yolunu bozar; gereksiz değişiklik                                                                                                |
| cgo + libgtk/gstreamer başlıkları                                                 | Tekrarlanabilir çapraz derleme ve tek derleme modeli kaybolur. Geri dönüş yolu olarak tutulur (K0s-1 FAIL)                                                   |
| GTK native Wayland arka ucu                                                       | Pencere konumlandırma, üstte tutma, tıklama geçiren gösterge ve XTEST aygıt ayrımı kaybolur; iki UI davranışı oluşur                                         |
| GTK4                                                                              | 22.04'te uygulama kitaplığı olarak var, ancak override-redirect/konum API'leri kaldırıldı; GTK3 iki sürümde de kesin                                         |
| purego ile GIO GDBus                                                              | GVariant kurulumu ve sinyal geri çağrıları C üzerinden olur; godbus daha basit ve sahte servisle test edilebilir                                             |
| `jezek/xgb` (r1 kararı)                                                           | r2: XI2 GenericEvent desteklemiyor (K0s-5); XI2 için zaten libXi gerektiğinden ikinci X bağlama yolu tutulmadı. `libxtst6`/`libxi6` varsayılan (K0s-2)       |
| Flatpak / AppImage / .deb                                                         | Kurulum ya da çalışma zamanı gerektirir; AppImage FUSE ister (24.04'te varsayılan değil); .deb root ister                                                    |
| GStreamer ile ses (pulsesrc/pulsesink)                                            | Boru hattı + saat yönetimi; simple API daha kısa                                                                                                             |

## Sonuçlar

- (+) Tek derleme modeli (CGO=0, Linux'ta tekrarlanabilir). Yeni Go bağımlılığı 1 (godbus, saf Go, BSD-2; r2'de xgb çıkarıldı); `flow`/`rtc`/`signal` aynen kullanılır.
- (+) Web ve sunucuda codec değişikliği yok; Windows/macOS yolu değişmez.
- (−) Linux'ta video yazılım VP8: CPU yükü H.264 donanımdan yüksek; çözünürlük basamağı K0s-3'e bağlı.
- (−) Linux pencereleri Yaru değil Adwaita görünür (r3, güvenlik için sabit tema).
- (−) r2: X11 FFI yüzeyi büyüdü (libX11/libXi/libXtst, ayrı Display'ler, XInitThreads).
- (−) Wayland'de AC-102 (sistem "Durdur"u ile), AC-104 (yok; kilit = REVOKED telafisi, kullanıcı onayı bekleniyor) ve AC-103 (en iyi çaba, AC-400) sapmaları var; gösterge ve işaretleme videoya
  giriyor (yakalama hariç tutma yok).
- (−) LGPL sistem kitaplıklarına çalışma anında bağımlıyız; sürüm farkları (22.04 GStreamer 1.20, 24.04 1.24) K0s ve elle testle izlenir.
  Kitaplıklar dağıtılmadığından LGPL yükümlülüğü doğmaz; bildirim dosyasında not edilir.
- (−) Gerçek donanım yok (A-PG-1).
- Yeni teknoloji ölçütleri: **Ekipte bilgi:** purego/FFI kalıbı P28f'ten var; GStreamer/portal yeni ama spike tek belgede kalır.
  **Bakım:** GStreamer, GTK3 (LTS dağıtımlarda bakımda), godbus (Docker/containerd'de kullanılıyor), libX11/libXi/libXtst (X.Org, LTS'de bakımda). **Geri dönüş:** paket başına cgo (m.1), godbus → GDBus.
