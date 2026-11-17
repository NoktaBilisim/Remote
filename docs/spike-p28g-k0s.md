# P28g K0s — Linux istemci spike raporu

Kapsam: `docs/mimari-p28g.md` §9.1 ve ADR-0038'deki K0s-1..10. Tarih: 2026-11-17.
Spike kodu repo dışındadır (`Projeler/.remote-spikes/p28g-spike`, yerel makine). Repoda yalnız bu rapor var.
Ortam: Apple Silicon Mac + Docker. amd64 koşular Rosetta emülasyonunda çalıştı; bu sayılar **vekil** (proxy).
Performans ölçütü için arm64 native sayılar esas alındı, onlar da gerçek donanımın vekili.

## Özet

| Madde  | Konu                                                                        | Sonuç                                                                            | Tasarıma etkisi                                                                                                 |
| ------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| K0s-1  | purego + GTK3 açılış, ana döngüye iş gönderme, env, tekrarlanabilir derleme | **GEÇTİ**                                                                        | yok (boyut ≈15 MB, beklenen ≈25 MB)                                                                             |
| K0s-2  | ubuntu-desktop(-minimal) bağımlılık ağacı                                   | **GEÇTİ** (notlu)                                                                | 22.04'te portal-gnome ve cups-client yalnız Recommends ile geliyor                                              |
| K0s-3  | GStreamer ximagesrc→vp8enc, ana+düşük akış, keyframe, bitrate               | 1920'de **KALDI** (yalnız CPU ≤ %60 ölçütü); 1280'de geçer; diğer ölçütler GEÇTİ | **FAIL dalı uygulanır:** çözünürlük basamağı (K2). §4.4 `async=false`; tüketim başlayınca keyframe              |
| K0s-4  | XTest fare/klavye (çoklu monitör, TR), XGrabKey kısayolu                    | **GEÇTİ**                                                                        | yok                                                                                                             |
| K0s-5  | Yerel girdi ile uzak girdiyi ayırma (XI2)                                   | **GEÇTİ** (sentetik %100 ret), ama xgb ile yapılamaz                             | FAIL dalı (§5.2 zaman tabanlı yedek) gerekmez; XI2 xgb yerine purego libX11+libXi ile (ADR r2, §5.1 T5 listesi) |
| K0s-6  | Wayland portal (RemoteDesktop+ScreenCast)                                   | 24.04 **GEÇTİ** (kare, girdi, Closed ≤ 100 ms); 22.04 **DOĞRULANAMADI** (ELLE)   | "Allow Remote Interaction" varsayılan kapalı; klavye ısınması; Durdur metni                                     |
| K0s-7  | HOME'a iz bırakmama                                                         | **GEÇTİ**                                                                        | yok                                                                                                             |
| K0s-8  | Pano (X11 + Wayland/XWayland)                                               | **GEÇTİ** (22.04 Wayland ELLE)                                                   | koltukta klavye olmalı                                                                                          |
| K0s-9  | Kod adı + tek satır başlatma komutu                                         | **GEÇTİ** (komut kısmı)                                                          | yok                                                                                                             |
| K0s-10 | libpulse-simple ses, 300 s                                                  | **GEÇTİ** (kesinti 0)                                                            | 22.04 akış oranı 0.9934, gerçek donanımda bakılmalı                                                             |

Uygulanacak tek FAIL dalı K0s-3'ünkü (§9.1: "ölçüt tutmazsa çözünürlük basamağı düşürülür, K2'ye girdi").
K0s-5 ölçütü (XTEST %100 ret) sağlandı; ancak §9.1'in sorduğu jezek/xgb XI2 desteklemiyor. Bu yüzden §5.2'deki zaman tabanlı
yedek değil, XI2'nin purego libX11+libXi ile yapılması öneriliyor (ADR-0038 r2, karar mimarda). 22.04 Wayland ELLE geçene kadar açık.

## 1. Düzenek

- **İmajlar** (kendi oluşturduklarım): `p28g-spike`, `p28g-spike2`, `p28g-spike3`. Etiketler `{22.04,24.04}-{amd64,arm64}`.
  - Temel: Ubuntu 22.04 / 24.04, `linux/amd64` (Rosetta) ve `linux/arm64` (native).
  - İçerik: Xvfb, Xorg+dummy (`/etc/X11/dummy.conf`, TR klavye için), GTK3, GStreamer base/good/pipewire, xclip, wl-clipboard.
  - Wayland için: gnome-shell headless + xdg-desktop-portal(-gnome) + pipewire/wireplumber + `dbus-run-session`.
- **Go:** 1.26.11. Derleme `CGO_ENABLED=0`, purego v0.11.3. Mac'te `~/sdk/go1.26.11` ve `golang:1.26.11-bookworm` kullanıldı.
  - Modül `remote-support/agent-win/spike/p28g`; `replace` ile repo `apps/agent-win` modülüne bağlı. Repo dosyalarına dokunulmadı.
- **Araçlar** (`src/cmd/`):
  - `probe`: K1, K4, K5, K8; XI2 kodu `xi2.go` içinde.
  - `gst`: K3.
  - `portal`: K6 (godbus).
  - `pulse`: K10.
  - `kodad`: K9.
  - `size`: K1 boyut vekili.
- **Headless gnome-shell 46 için gerekenler** (Docker artefaktı; gerçek masaüstünde gerekmez):
  - `rm /run/systemd/seats` ve bir sistem dbus'ı.
  - `/tmp/.X11-unix` dizini 1777 izinli.
  - Portal için `WAYLAND_DISPLAY`.
  - XWayland için `XAUTHORITY=$XDG_RUNTIME_DIR/.mutter-Xwaylandauth.*`.
  - Mutter D-Bus API'leri (RemoteDesktop/ScreenCast) yalnız diyaloğu onaylamak ve ekran görüntüsü almak için yardımcı olarak kullanıldı. Ürün yolu portaldır.
- **Ses düzeneği:** 24.04'te pipewire-pulse, null sink `pw-cli create-node support.null-audio-sink` ile kuruldu. 22.04'te pulseaudio.
- **Kayıtlar:** komut dosyaları ve günlükler `run/`, ekran görüntüleri `shots/`, apt çıktıları ve ISO manifestleri `k2/`.

## 2. Madde sonuçları

### K0s-1 — purego + GTK3, ana döngüye iş gönderme, env, tekrarlanabilir derleme: GEÇTİ

- **İkili dosya:** dinamik ELF. Yorumlayıcı `/lib64/ld-linux-x86-64.so.2`. NEEDED yalnız `libdl.so.2`, `libpthread.so.0`, `libc.so.6`.
- **Açılış:** 22.04 ve 24.04'te, amd64 ve arm64'te çalıştı.
  - `gtk_init_check` (GTK 3.24, x11 arka ucu): emülasyonda 246–296 ms, arm64'te 36–71 ms.
- **Arayüz:** pencere, giriş kutusu ve düğme çalıştı. `clicked` geri çağrısı `purego.NewCallback` ile tetiklendi.
- **Ana döngüye iş gönderme:** `g_idle_add` ile 4 goroutine'den 1000 iş gönderildi.
  - 1000/1000 ana iş parçacığında koştu, başka iş parçacığında 0.
  - Süre 4.7–9 ms.
- **Ortam değişkeni:** `os.Setenv` ile verilen "evet-çğ", C `getenv` tarafında aynen görüldü (fakecgo). `g_setenv` gerekmez.
  - Ters yön (C `setenv` → `os.Getenv`) yansımıyor; tasarım bu yöne ihtiyaç duymuyor.
- **Tekrarlanabilir derleme:** bayraklar `-trimpath -ldflags "-s -w -buildid="`.
  - Mac'te ve `golang:1.26.11-bookworm` imajında yapılan iki derleme aynı SHA'yı verdi.
  - `size` vekili: `c3c870a6…27b7`. `probe`: `a2764d41…94b9c6`.
- **Boyut:** `size` vekili 15,409,381 B (≈14.7 MiB). 60 MB sınırının altında; tasarım ≈25 MB bekliyordu.
  - Strip edilmiş sürüm probe'u da çalıştı.
  - Kıyas: darwin arm64 noktadestek strip edilmiş derlemesi 12.3 MB.

### K0s-2 — Bağımlılık ağacı: GEÇTİ (notlu)

**Yöntem:**

- `apt-get -s install ubuntu-desktop-minimal` ve `ubuntu-desktop`, Recommends ile ve Recommends'sız.
- Resmi ISO manifestleri: 22.04.5 ve 24.04.5.1.
- `dpkg -S` ile GStreamer eklentilerinin hangi pakette olduğu çıkarıldı.

**Her iki sürümde varsayılan kurulumda (Recommends ile) gelenler:**

- `libgstreamer1.0-0`, `gstreamer1.0-plugins-base`, `gstreamer1.0-plugins-good`, `gstreamer1.0-pipewire`
- `libpulse0`, `libgtk-3-0` (24.04'te `t64`)
- `xdg-desktop-portal-gnome`, `xdg-user-dirs`, `cups-client`
- `libxtst6`, `libxi6`, `xwayland`

**Yalnız Recommends ile gelenler:**

- 22.04: `xdg-desktop-portal-gnome`, `cups-client`.
- 24.04: `cups-client`, `gstreamer1.0-x` (bu sonuncusu gerekmiyor).
- Recommends'sız kurulumda (`--no-install-recommends`) Wayland portalı ve yazdırma yolu eksik olabilir. Kılavuza not düşülmeli.

**Sürüm farkları:**

|                      | 22.04      | 24.04          |
| -------------------- | ---------- | -------------- |
| Ses sunucusu         | pulseaudio | pipewire-pulse |
| libvpx               | libvpx7    | libvpx9        |
| GStreamer (manifest) | 1.20.3     | 1.24.2         |
| portal-gnome         | 42.1       | 46.2           |

- 22.04 manifestinde `pipewire-media-session` de var.

**Eklentinin hangi paketten geldiği (`dpkg -S`):**

- `ximagesrc`, `vpx` → plugins-good.
- `pipewiresrc` → gstreamer1.0-pipewire.
- `app`, `videorate`, `videoconvert`/`videoscale` → plugins-base.
- `tee`, `queue`, `valve` (coreelements) ve `gst-plugin-scanner` → libgstreamer1.0-0.

**Kayıt (registry):** gereken tüm öğeler mevcut. `x264enc` ve `openh264enc` yok; VP8 kararını destekliyor.

### K0s-3 — GStreamer VP8 hattı: 1920'de CPU ölçütü KALDI → FAIL dalı (çözünürlük basamağı); diğer ölçütler GEÇTİ

Ölçüt (mimari §7): 30 fps, kodlama p95 ≤ 33 ms, kare kaybı 0, süreç CPU ≤ %60 (tek çekirdek eşdeğeri), zorlanan keyframe ≤ 2 kare,
ilk kayıt taraması ≤ 3 sn, çözülebilir akış. Kanıt: `run/k3.sh`, `run/k3matrix.sh`, `run/k3-*.log`.

Düzenek: Xvfb 1920×1080. Hareket kaynağı zone-plate (`kx2=20 ky2=20 kt=1`). Ayarlar: `cpu-used=8`, `threads=4`, hedef 3 Mbit/s.

**arm64 native, 60 s (vekil):**

|                            | 24.04                          | 22.04       |
| -------------------------- | ------------------------------ | ----------- |
| Kare                       | 1803 (30.0 fps, PTS boşluğu 0) | —           |
| Kodlama p50 / p95 (tracer) | 6.7 / 11.5 ms                  | p95 10.2 ms |
| CPU                        | %63                            | %67         |

- 24.04'te PTS→appsink p95 49.5 ms. Bu süreye videorate bekletmesi ve dönüştürme dahil.
- Önceki koşularda CPU %60; durağan ekranda %34.

**amd64 Rosetta, 30 s (vekil):** CPU %82–87, kodlama p95 14.5–20 ms.

**Zorunlu keyframe:** her istekte keyframe bir sonraki çekilen karede geldi (0 kare gecikme).

**Bitrate'i çalışırken değiştirme (`gst_util_set_object_arg`):** hedef 3 → 1 Mbit/s.

- arm64'te ölçülen 3.15 → 1.10 Mbit/s.
- amd64'te 2.89 → 0.98 Mbit/s.
- **Açık bulgu:** smpte kayan desen, hedef ne olursa olsun ≈4.2 Mbit/s üretti. Aşırı karmaşık içerikte CBR hedefi tutmayabilir.

**Düşük akış:** 8 fps (50 s'de 401 kare). Valve kapalıyken 0 kare.

**Hata 1 — düşük akış takılması (tasarım bulgusu):**

- `valve drop=true` dalı preroll'u kilitledi; hiç kare akmadı.
- Düzeltme: düşük daldaki appsink'te `async=false`.
- §4.4'teki hat tanımına eklenmeli.

**Kod çözme:**

- arm64'te `vp8dec`, `main.ivf` ve pion loopback `pion.ivf` dosyalarının tüm karelerini çözdü.
- amd64'te yalnız 150/603 ve 450/903 kare çözüldü.
  - Neden: ilk keyframe kaybolmuştu. Emülasyonda pion kurulumu çekme döngüsünü bekletti. Bu sırada `appsink drop=true max-buffers=2` ilk keyframe'i düşürdü. Çözücü sonraki keyframe'e kadar kareleri atar.
  - Akışın kendisi geçerli: bütün karelerde show=1. amd64 matroska gidiş-dönüşünde 300/300 kare çözüldü.

**Hata 2 — ilk keyframe kaybı (tasarım bulgusu):** tüketim (gönderim) başladığında açıkça keyframe istenmeli.

**Registry taraması:**

- Boş özel dizinde: arm64 37–131 ms, amd64 170–268 ms.
- Registry varken: 2–27 ms.

**Matris, 20 s (CPU% amd64 / arm64):**

| Ayar              | amd64 | arm64 |
| ----------------- | ----- | ----- |
| 1920, cpu-used 8  | 75    | 54    |
| 1920, cpu-used 12 | 67    | 51    |
| 1600              | 72    | 56    |
| 1280              | 57    | 44    |
| threads=2         | 71    | 50    |

**Değerlendirme:**

- GEÇTİ: 30 fps, kare kaybı 0, kodlama p95 ≤ 20 ms (≤ 33), keyframe 0 kare, kayıt taraması ≤ 0.3 sn, akış çözülebilir.
- KALDI: 1920×1080'de CPU arm64 60 s koşuda %63/%67, emülasyonda %75–87 (> %60).
  - 1600 sınırda (arm64 %56, emülasyon %72).
  - 1280 her ikisinde de altında kaldı (%44 / %57).
- **FAIL dalı uygulanır (§9.1):** çözünürlük basamağı K2'ye girer. Öneri: varsayılan uzun kenar 1280, ölçülen CPU'ya göre 1600/1920'ye yükselme (veya tersi). Kesin eşik gerçek amd64 donanımda (ELLE) ölçülerek konmalı; buradaki sayılar vekil.

### K0s-4 — XTest girdi ve XGrabKey: GEÇTİ

- **Fare:** Xorg `setmonitor` ile kurulan 3 RandR monitörde 105 nokta denendi, en büyük hata 0 px. Xvfb'de 35 nokta.
- **TR klavye:** evdev+8 tuş kodlarıyla "çğıöşüİ" birebir yazıldı. arm64 Xorg, 22.04 ve 24.04.
  - Xvfb `setxkbmap tr` ayarını yok saydı. amd64 Xorg emülasyonda `setxkbmap` adımında takıldı. Bu yüzden TR klavye yalnız arm64'te doğrulandı.
- **Değiştirici tuşlar:** Ctrl+A, Shift ve AltGr+q=@ sonucunda "aA@" yazıldı.
- **XGrabKey (Ctrl+Shift+F12, ayrı bağlantı):** kısayol yakalandı.
  - Olay geldi: state 0x5; NumLock açıkken 0x15.
  - Giriş kutusu değişmedi.
  - Çakışma BadAccess döndürüyor; F11'e düşme mantığı test edilebilir.

### K0s-5 — Yerel girdi / uzak girdi ayrımı (XI2): GEÇTİ (ölçüt: sentetik %100 ret); xgb ile yapılamaz

Kanıt: `src/cmd/probe/xi2.go`, `run/xvfbprobe*.sh`, `run/k1-*.log`.

**xgb ile yapılamaz:**

- `jezek/xgb` v1.3.1'de `xinput` paketi yok.
- Olay okuyucu her olayı sabit 32 bayt okuyor. XI2 GenericEvent'leri daha uzun olduğu için akış bozulur.
- Sonuç: XI2 olayları xgb ile alınamaz.

**purego ile libX11+libXi XI2: GEÇTİ.**

- Kurulum: GTK'dan önce `XInitThreads`; kendi iş parçacığında ayrı bir `Display`.
- Ham olay kaynakları: 87/87 ve 157/157 olayın kaynağı "Virtual core XTEST pointer/keyboard" oldu (%100 ayrım).
- Cihaz listesinde gerçek cihazlar da görünüyor ("Xvfb mouse/keyboard").
- Gerçek fiziksel cihaz kabulü ELLE listesinde.

**GTK tarafı:**

- XTEST tıklaması GTK'ya `source_device="Virtual core XTEST pointer"`, `send_event=0` olarak ulaştı.
- `XSendEvent` ile gönderilen olayların GTK'ya ulaşan sayısı 0; GTK XI2 kullanıyor.

**Güvenlik bulgusu (pozitif kontrol):** `GDK_CORE_DEVICE_EVENTS=1` verildiğinde:

- SendEvent tıklaması `send_event=1` ile geldi ve sentetik tıklama `clicked`'i tetikledi.
- XTEST kaynağı "Core Pointer" olarak görüldü; ayrım kayboldu.
- Gerekli önlem: istemci `gtk_init`'ten önce `GDK_CORE_DEVICE_EVENTS` (ve benzerlerini) ortamdan silmeli.

**Tasarım değişikliği:**

- ADR-0038 m.6 için r2 gerekli: xgb yerine purego ile libX11+libXi XI2 kullanılmalı (alternatif: XI2 protokolünü kendimiz yazmak).
- `libX11.so.6` ve `libXi.so.6` T5 kütüphane izin listesine eklenmeli.
- §9.1 FAIL dalı (§5.2 "kendi enjeksiyonumuzdan sonra 50 ms dışı yerel" zaman tabanlı yedek) gerekmiyor; ölçüt sağlandı. Mimar r2'de xgb yerine libXi'yi onaylamazsa o dal devreye girer.

### K0s-6 — Wayland portal (RemoteDesktop + ScreenCast)

#### 24.04 (gnome-shell 46 headless, arm64): GEÇTİ

Ölçüt: kare alınıyor, girdi uygulanıyor, `Closed` ≤ 100 ms kapı. Hepsi sağlandı. Kanıt: `src/cmd/portal`, `run/wl-env.sh`, `run/wlexec.sh`, `shots/`.

**Oturum kurulumu:**

- Arayüz sürümleri: RemoteDesktop v2, ScreenCast v5. `AvailableDeviceTypes=7`.
- `CreateSession`, `SelectDevices`, `SelectSources` başarılı.
- Açıkça verilen `persist_mode=0` kabul edildi.

**Onay diyaloğu:**

- `Start` diyaloğu açtı.
- **"Allow Remote Interaction" anahtarı varsayılan KAPALI** geliyor (`shots/s1.png`). Varsayılan onayda `devices=0` dönüyor; yalnız ekran paylaşılıyor.
- Anahtar açılınca: `devices=3`, akış düğümü 1920×1080, `restore_token` yok.

**Görüntü:**

- `OpenPipeWireRemote` fd'si `pipewiresrc fd=3 path=<node>` ile açılınca kareler geldi.
- Durağan ekranda keepalive ile ≈1 fps (48 s'de 60 kare).

**Fare (`NotifyPointer*`):**

- Tıklama XWayland GTK düğmesine ulaştı.
- Kaynak cihaz "xwayland-relative-pointer:14". Beklendiği gibi localClick (§5.2a) bunu yerel tıklamadan ayıramaz.

**Klavye (TR input-sources):**

- `NotifyKeyboardKeycode` ile "çğıöşüİ" doğru yazıldı. `NotifyKeyboardKeysym` ile ş yazıldı.
- İlk tuşlar, sanal klavye oluşana kadar kayboldu.
- Isınma ile düzeldi: Shift bas-bırak ve 1 s bekleme.
- Headless'a özgü olabilir; ELLE'de doğrulanmalı.

**Yetki ve iptal:**

- `devices=0` iken Notify çağrısı "Session is not allowed to call NotifyPointer/Keyboard methods" döndürüyor.
- Diyalogda iptal: `Start` yanıtı code=1.

**Durdurma:**

- Üst çubuktaki paylaşım göstergesinden durdurmak, yardımcının oturumu dahil tüm oturumları kapattı.
- `Session.Closed` sinyali tıklamadan 7.6 ms ve 5.8 ms sonra geldi.
- Closed'dan sonra Notify "Invalid session" döndürüyor.
- Böylece §5.2 AC-102 sütunundaki FAIL dalı ("Durdur oturumu kapatmıyorsa Wayland yalnız görüntü") gerekmiyor.

**Denenmeyenler:**

- Süreç içi `pipewiresrc→vp8enc` hattı koşulmadı; yalnız `gst-launch` alt süreci denendi.
  - Risk: hasar güdümlü (damage-driven) kaynakta videorate davranışı. P28g uygulamasında ölçülmeli.
- Boş parent window ile uyarı veriyor. Tasarım `x11:XID` geçiriyor; bu doğru.

#### 22.04 (gnome-shell 42): kısmi, DOĞRULANAMADI

- Arayüz sürümleri: RemoteDesktop v1, ScreenCast v4.
- Create/Select başarılı, diyalog açıldı, iptal code=1 döndü.
- Ekran görüntüsü yardımcısı takıldı. Kör tuşla onay verilemedi.
- Onay, kare, girdi, Closed ve pano maddeleri **ELLE** listesine taşındı.

### K0s-7 — HOME'a iz bırakmama: GEÇTİ

**X11, amd64 (probe, gst, pulse):**

- Düzenek: boş HOME. `XDG_CACHE_HOME` ve `GST_REGISTRY`, kabuktan `$XDG_RUNTIME_DIR/noktadestek-*` dizinine yönlendirildi.
- HOME'da istemciye ait yeni dosya yok.
- 22.04'te görülen pulse `default-sink`/`default-source` dosyaları düzeneğin `pactl` çağrısından geliyor (daemon).
- Çalışma dizininde (runtime dir) yeni olanlar: `at-spi`, `dconf/user`, `gvfs`, `gvfsd`. Bunlar oturum servisleri ve tmpfs üzerinde.
- `~/.cache/rosetta` bir Docker artefaktı.
- Özel dizinde yalnız registry ve ivf vardı. fontconfig sistem önbelleğini kullandı.
- Yönlendirmeyi spike'ta kabuk yaptı. Ürün istemcisi bunu kendi `os.Setenv` çağrısıyla yapacak; bunun C ortamına yansıdığı K0s-1'de kanıtlandı.
- Wayland yolunda istemci içi GStreamer koşulmadı (yalnız gst-launch alt süreci).

**Wayland 24.04 portal akışı:**

- `~/.local/share/flatpak/db` boş kaldı; `persist_mode=0` ile izin deposuna yazılmıyor.
- HOME farkında yalnız düzenekten gelenler görüldü:
  - gst-launch kaynaklı gstreamer registry.
  - gnome-shell kaynaklı mesa_shader_cache.
  - wireplumber restore-stream.

### K0s-8 — Pano: GEÇTİ (22.04 Wayland ELLE)

- **X11:** GTK CLIPBOARD ile xclip arasında Türkçe metin her iki yönde aktarıldı.
- **Wayland 24.04:**
  - XWayland GTK → wl-paste: çalıştı.
  - wl-copy → GTK: çalıştı.
  - Koşul: koltukta (seat) bir klavye bulunmalı. Yoksa wl-paste "This seat has no keyboard" diyor. Spike'ta sanal klavye oturumu açık tutularak aşıldı.
- `x-kde-passwordManagerHint` hedefi test edilmedi.
- 22.04 Wayland ELLE listesinde.

### K0s-9 — Kod adı ve tek satır komut: GEÇTİ (komut kısmı)

- **Ortamlar:** 22.04 ve 24.04; bash 5.1/5.2 ve dash.
- **Dosya seçimi:** komut, mtime'a göre en yeni `Destek-*` dosyasını çalıştırdı.
- **Kod ayrıştırma:** `Destek-33333333(1)` ve `Destek-22222222 (1)` adlarından kod doğru çıkarıldı.
  - Regex: `^Destek-([0-9]{8})(?: ?\([0-9]{1,3}\)| [0-9]{1,3})?$`.
- **Geçmiş:** `HISTCONTROL=ignoreboth` ile başta boşluklu komut geçmişe yazılmadı.
- **İndirilenler dizini:** `user-dirs.dirs` ile benzetildi (Docker yerelleri sildiği için) ve çalıştı.
- **Dosya yokken:** chmod hatası verip 1 ile çıktı.
- **İzin:** `chmod u+x` tüm `Destek-*` dosyalarına uygulanıyor; zararsız.
- Tarayıcı indirme uyarıları ve Nautilus'ta çift tıklama ELLE listesinde.

### K0s-10 — Ses (libpulse-simple, 48 kHz mono S16LE, 20 ms): GEÇTİ, kesinti 0

**24.04 pipewire-pulse, 300 s, arm64 ve amd64:**

- Giriş/çıkış oranı ≈1.0000; hata 0.
- En uzun aralık 35–46 ms; 60 ms üstü boşluk yok.
- Gecikme 50–56 ms.

**22.04 pulseaudio:**

- 60 ms üstü boşluk yok; en uzun aralık 31–36 ms.
- Akış oranı 0.9934. Muhtemel neden null sink ve resampler (varsayılan 44.1 kHz).
- Gerçek donanımda bakılmalı (ELLE).

## 3. ADR-0038 / mimari-p28g r2 etkisi

| #   | Bulgu                                                                                          | Önerilen değişiklik                                                                                                                                                                                                              | Yer                                                 |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | xgb XI2 GenericEvent desteklemiyor (K0s-5)                                                     | Yerel/uzak girdi ayrımı purego ile libX11+libXi XI2 üzerinden yapılsın: GTK'dan önce `XInitThreads`, ayrı `Display`, ayrı iş parçacığı. `libX11.so.6` ve `libXi.so.6` T5 izin listesine. xgb XTest/RandR/GrabKey için kalabilir. | ADR-0038 (XI2 maddesi), mimari §5.1 T5, §5.2 AC-104 |
| 2   | `GDK_CORE_DEVICE_EVENTS=1` sentetik olayı kabul ettiriyor, XTEST ayrımını siliyor (K0s-5)      | `gtk_init` öncesi `GDK_CORE_DEVICE_EVENTS` (ve GDK_* hata ayıklama değişkenleri) ortamdan silinsin. Güvenlik denetimine madde olarak eklensin.                                                                                   | mimari §5.1 T5 / §5.4                               |
| 3   | Düşük dalda valve preroll'u kilitliyor (K0s-3)                                                 | Düşük akış appsink'ine `async=false`                                                                                                                                                                                             | mimari §4.4                                         |
| 4   | appsink `drop=true` ilk keyframe'i düşürebiliyor (K0s-3)                                       | Gönderim/tüketim başlarken (ve yeni izleyicide) açık `force-key-unit`                                                                                                                                                            | mimari §4.4                                         |
| 5   | Portal diyaloğunda "Allow Remote Interaction" varsayılan kapalı (K0s-6)                        | `devices=0` sonucu "yalnız izleme" olarak ele alınsın. Arayüz ve kılavuz kullanıcıya anahtarı açmasını söylesin. Notify hatası "izin yok" diye eşlensin, çökme olmasın.                                                          | mimari §5.2, kılavuz                                |
| 6   | İlk tuşlar sanal klavye oluşana kadar kaybolabiliyor (K0s-6)                                   | Oturum başında klavye ısınması (Shift bas-bırak + ≈1 s) veya ilk tuştan önce kısa bekleme                                                                                                                                        | mimari §5.2 (Wayland girdi)                         |
| 7   | Üst çubuk göstergesinden durdurmak tüm oturumları kapatıyor; Closed ≈6–8 ms'de geliyor (K0s-6) | Closed → oturumu bitir yolu doğru. "Durdur" metni, GNOME göstergesinin de oturumu bitirdiğini anlatsın.                                                                                                                          | mimari §5.2 AC-102, kılavuz                         |
| 8   | CPU sınırda: arm64 %54–67, emülasyon %75–87 (K0s-3)                                            | Otomatik çözünürlük basamağı (1920 → 1600 → 1280) veya `cpu-used` artışı için eşik kararı verilsin                                                                                                                               | mimari §4.4, §7 — **K0s-3 FAIL dalı**               |
| 9   | Aşırı karmaşık içerikte CBR hedefi tutmuyor (≈4.2 Mbit/s) (K0s-3)                              | Bant tahmini, ölçülen gerçek bitrate'e göre geri beslensin; yalnız hedefe güvenilmesin                                                                                                                                           | mimari §4.4                                         |
| 10  | 22.04 pulseaudio akış oranı 0.9934 (K0s-10)                                                    | Jitter tamponu küçük sapmayı tolere etmeli; gerçek donanımda ölçülsün                                                                                                                                                            | ilgili bölüm (ses, AC-402)                          |
| 11  | 22.04 kurulumda portal-gnome ve cups-client yalnız Recommends ile geliyor (K0s-2)              | Sistem gereksinimine ve kılavuza "minimal / no-recommends kurulumda xdg-desktop-portal-gnome gerekir" notu                                                                                                                       | §12 A-PG-2, DATASHEET, kılavuz                      |
| 12  | Süreç içi pipewiresrc→vp8enc ölçülmedi; videorate + hasar güdümlü kaynak (K0s-6)               | P28g uygulamasında ilk iş olarak ölçülsün; gerekirse videorate yerine son kareyi tekrar                                                                                                                                          | mimari §4.4                                         |

§9.1 FAIL dalları özeti: K0s-1, -2, -4, -6 (24.04), -8 FAIL değil. K0s-3 FAIL dalı (çözünürlük basamağı) **uygulanır**.
K0s-5 FAIL dalı (§5.2 zaman tabanlı yedek) gerekmez, ama #1 kabul edilmezse uygulanır. K0s-6/-8 22.04 Wayland ELLE sonucuna bağlı.
K0s-2: hiçbir paket eksik değil (Recommends ile); A-PG-2 kararı yalnız no-recommends kurulumları için not.

## 4. ELLE listesi (kullanıcı, gerçek makinede)

1. **Ubuntu 24.04 GNOME Wayland:**
   - Portal diyaloğunda "Allow Remote Interaction" varsayılanı.
   - Anahtar açıkken fare ve TR klavye; ilk tuş kaybı var mı.
   - Üst çubuktan durdur.
   - Pano iki yönde.
2. **Ubuntu 22.04 GNOME Wayland:**
   - Onay, görüntü (kare akışı), fare/klavye.
   - Closed sinyali.
   - Pano.
   - Spike'ta doğrulanamadı.
3. **Ubuntu 22.04 ve 24.04 X11 (Xorg oturumu), gerçek amd64 donanım:**
   - CPU% ve kodlama p95 (1920×1080, 30 fps).
   - Zayıf CPU'da çözünürlük basamağı ihtiyacı.
4. **Gerçek fare/klavye ile XI2 ayrımı:** fiziksel tıklama "yerel" olarak görülmeli, XTEST tıklaması "uzak".
5. **amd64 Xorg'da TR klavye düzeni:** emülasyonda koşulamadı.
6. **22.04 pulseaudio gerçek ses kartı:** 300 s akış oranı ve kesinti.
7. **K0s-9 tarayıcı akışı:**
   - Firefox ve Chrome'da `Destek-XXXXXXXX` indirme uyarısı.
   - Nautilus'ta çift tıklama davranışı.
   - Gerçek Türkçe yerelde "İndirilenler" dizini.
8. **Pano parola yöneticisi ipucu:** `x-kde-passwordManagerHint` hedefi.

## 5. Yan etkiler ve temizlik

- **Mac:** sistem ayarlarına dokunulmadı.
- **Konteynerler:** kendi oluşturduğum `p28g` konteynerlerinin hepsi kaldırıldı. `rs-mysql-test` ve `remote-*` konteynerlerine dokunulmadı.
- **İmajlar:** sonraki koşular için bırakıldı. 12 imaj, her biri 1.07–1.53 GB, toplam ≈15.6 GB. Kaldırmak için:
  ```sh
  docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^p28g-spike[23]?:' | xargs docker rmi
  ```
- **Spike kodu ve kayıtları:** repo dışında, `Projeler/.remote-spikes/p28g-spike` (yerel makine).
- **Repo:** yalnız bu dosya eklendi. Commit yapılmadı.
