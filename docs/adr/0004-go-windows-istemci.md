# ADR-0004 — Windows Hızlı Destek istemcisi: Go + Pion + Win32
Durum: Kabul (kullanıcı kararı S1) · Tarih: 2026-11-10
## Bağlam
Admin'siz, kurulumsuz, tek dosya ≤ 40 MB, açılış ≤ 5 sn, kalıcı iz yok (AC-95..110). RustDesk (AGPL, R8) kullanılmaz.
## Karar
| Konu | Seçim | Gerekçe |
|---|---|---|
| Dil / WebRTC | Go 1.23+, `pion/webrtc/v4` (MIT) | Kullanıcı kararı; olgun, aktif |
| Ekran yakalama | DXGI Desktop Duplication (`x/sys/windows` syscall/COM); başarısızsa GDI BitBlt | Admin gerektirmez, düşük gecikme; Secure Desktop'ta erişim kaybı = AC-105 sinyali |
| Kodlama | H.264 — Windows Media Foundation MFT (donanım tercihli, MS yazılım MFT yedek), `go-ole` | Ek binary yok → boyut küçük; teknisyen tarayıcısı H.264 çözer. Risk K4 (N sürümü): VP8 `libvpx` cgo fallback (cgo gerekirse tekrarlanabilir build için sabit mingw toolchain, ADR-0010) |
| Girdi | `SendInput` (Unicode için `KEYEVENTF_UNICODE`), `WH_*_LL` hook (yerel öncelik + enjekte tespiti) | Admin'siz çalışır; UIPI sınırı kapsam dışı |
| UI | Saf Win32 (`x/sys/windows`): karşılama penceresi, butonlar, topmost layered gösterge penceresi; manifest `asInvoker` + PerMonitorV2 DPI | WebView2 `%LOCALAPPDATA%` yazar (AC-108 riski), `lxn/walk` bakımsız |
| Global kısayol | `RegisterHotKey` **Ctrl+Shift+F12** → kontrolü kapat | Sistem kısayollarıyla çakışmaz, arka planda çalışır (AC-102) |
| WS | `github.com/coder/websocket` | Bakımlı, bağımlılıksız |
| Config | Sunucu URL'si derleme zamanı `-ldflags -X`; binary içine token/kod gömülmez | İmza bozulmaz (V6) |
| TLS | Sistem kök deposu (`crypto/tls` + Windows root), pinning yok | Sertifika yenilemede istemci kırılmaz; MITM kurumsal kökle mümkün → kabul edilen risk, kılavuzda |
| Sözleşme | Go struct'ları elle; `packages/contracts/fixtures/*.json` ile çift yönlü test | Kod üretici (quicktype vb.) ek araç, 20 mesaj için gereksiz |
| Dosyalar | Yalnız `%TEMP%\NoktaDestek-<rand>\` (log yok, yalnız bellek); çıkışta silinir; gelen dosyalar müşterinin seçtiği klasöre | AC-108 |
| Build/imza | GitHub Actions; **imzasız**, tekrarlanabilir build + SHA-256 yayını — ayrıntı ADR-0010 (bu satırı geçersiz kılar) | AC-94, 96 (revize) |
## Alternatifler
Rust (webrtc-rs daha az olgun), Tauri/Electron (boyut, WebView2 iz), RustDesk (AGPL).
## Sonuçlar
Win32 UI kodu elle yazılır (birkaç pencere — kabul). macOS/Linux için `capture`, `input`, `ui` paketleri platform dosyalarıyla (`_darwin.go`) genişler; protokol aynıdır.
