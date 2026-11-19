# Mimari — P30 Gözetimsiz bağlantıda ekrana çizim (AC-494..AC-499)

Tarih: 2026-11-19 · Durum: r1 (güvenlik tasarım turu bekliyor) · Dal: `p30-gozetimsiz-cizim` · Sürüm: istemci + servis **0.23.0**
Girdiler: `docs/gereksinimler.md` §12, `docs/mimari-p27.md` §5.5–5.6 (K6/K6b, AC-294, AC-341, AC-342), `docs/mimari-p28u.md` r3,
AC-37/56 (Hızlı Destek işaretleme). Yeni ADR yok: paylaşılan paket mevcut kalıbın (uicore) taşınmasıdır; AC-341 kuralı değişmez.

## 1. Özet ve kısıtlar

Sorun: `apps/agent-win/internal/unattended/helper/headless.go` `func (h *headless) Annot(dc.Ctl) {}` boştur; `annot.*` iletileri
akıştan (`flow/session_media.go` `onCtl`) yardımcıya ulaşır ama çizilmez.

Çözüm (tek yol): işaretleme katmanı göstergenin (AC-294) **aynı iş parçacığında, aynı pencere sınıfıyla** (`NoktaDestekGosterge`)
kurulan ikinci tür pencere olur. Gösterge her giriş masaüstünde zaten yeniden kurulduğu için katman da masaüstünü bedavaya izler.
Çizim durumu (çizim listesi + lazer) yardımcı süreçte (`liveIndicator`) tutulur; katman yalnız boyar.

Kısıtlar:

- Yardımcı `internal/ui/...` içe aktaramaz (`boundary_test.go`, AC-341) → çizim modeli ve GDI boyama `internal/ui/uicore` ve
  `internal/ui/overlay_windows.go`'dan nötr yeni pakete `internal/annot` taşınır. Hızlı Destek de oradan kullanır (kopya yok).
- Yardımcıda tek pencere sınıfı (`TestAC431HelperWindowClassesOnlyIndicator`) → katman ayrı sınıf kaydetmez.
- Sunucu, `packages/contracts`, web: **değişiklik yok.** Kanıt: `annot` yalnız `contracts/src/dc.ts` (DC şeması) ve web DC katmanında
  geçer; işaretleme WebRTC DataChannel ile eşler arası gider, sunucu iletmez. Web araç çubuğu gözetimsizde de görünür
  (`console-parts.tsx` `ConsoleAnnotTools`; yalnız `isCapturing` ve `seatLock` ile pasif — katılımlıyla aynı).

## 2. Kararlar

| No      | Karar                                                                                                                                                                                                                                          | Gerekçe                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K-P30-1 | **Secure Desktop:** katman her giriş masaüstünde (kullanıcı, kilit/oturum açma, UAC) göstergeyle birlikte kurulur; çizim listesi süreçte tutulur ve yeni masaüstünde **yeniden boyanır**; lazer geçişte düşer. Masaüstü adına göre dal yok.    | Konsol kendi listesini yerel tutar (`use-collab.ts` `sendAnnot` → `setAnnot`, `receiveAnnot:false`); cihaz "sildim" diyemez. Geçişte silmek konsolla cihazı ayrıştırırdı ve web değişikliği isterdi. "Yalnız kullanıcı masaüstü" ise masaüstü adına göre ek dal demektir (sadelik ilkesi: tek yol). Teknisyen zaten tam kontrole sahip; UAC'de "buraya tıkla" oku asıl kullanım. |
| K-P30-2 | Katman, göstergenin `rebind`'ı içinde **gösterge doğrulandıktan sonra** kurulur; göstergenin `wins`/`verifyLayout` kümesine girmez; katman hatası `Failed` kapatmaz.                                                                           | AC-342 (2 sn bütçe, `indicator_failed`) ve AC-294 doğrulaması aynen kalır; çizim güvenlik öğesi değildir.                                                                                                                                                                                                                                                                        |
| K-P30-3 | Gösterge örtülmez: katman boyamasında gösterge kenar + etiket dikdörtgenleri (`layout()` çıktısı, katman yerel koordinatına çevrilmiş) `ExcludeClipRect` ile kırpılır; `tick` önce katmanı, sonra gösterge pencerelerini `HWND_TOPMOST` yapar. | Z-sırası birim testte ölçülemez; kırpma ölçülür (AC-496).                                                                                                                                                                                                                                                                                                                        |
| K-P30-4 | Katman paylaşılan monitörün dikdörtgenine kurulur (Hızlı Destek gibi). `headless.Active` / `MonitorChanged` ve `WM_DISPLAYCHANGE` yüzeyi günceller; çizimler korunur (normalize koordinat).                                                    | Konsolla tutarlı; Hızlı Destek'teki "monitör değişiminde temizle" farkı Sonra.                                                                                                                                                                                                                                                                                                   |
| K-P30-5 | Yetki/audit değişmez: yalnız kontrol sahibi eşin `annot.*`'ı akıştan geçer (`flow/peers.go` `ctlAllowed`). Konsolda "kontrol açıkken işaretleme kapalı" kuralı aynen.                                                                          | Mevcut kapı yeterli; yeni eylem yok.                                                                                                                                                                                                                                                                                                                                             |

## 3. Veri modeli

DB değişikliği yok. Bellek modeli (`internal/annot`): `Stroke{ID, Tool, Color string; Pts [][2]float64}`, `MaxStrokes = 500`,
`Apply(strokes, laser, dc.Ctl) (strokes, laser, laserSet bool)` (bugünkü `uicore.ApplyAnnot` aynen; nil X/Y denetimi + 500 sınırı),
`Color(name)`, `Polylines(...)` (bugünkü `StrokePolylines`). Yardımcıdaki durum: `liveIndicator.annot struct{ strokes []annot.Stroke;
laser *[2]float64; laserAt time.Time; surface int /*monitör id*/ }` — `l.mu` altında.

## 4. API / protokol sözleşmesi

Değişmez. DC iletileri `annot.stroke|laser|undo|clear` (`contracts/src/dc.ts`, Go `dc.ParseCtl`) aynen. Sunucu/WS/REST ucu yok.

## 5. Güvenlik

- Kaynak: yalnız kontrol sahibi teknisyen (K-P30-5); ileti boyutu `dc.ParseCtl` (≤ 500 nokta) + `MaxStrokes` ile sınırlı → bellek/boyama şişmesi yok.
- AC-294: gösterge doğrulaması, metni ve `indicator_failed` değişmez; katman göstergeyi örtemez (K-P30-3).
- AC-341: yeni içe aktarma `internal/annot` (yalnız `dc` + `internal/win`); yasak paket/ad yok; pencere sınıfı tek.
- Katman `WS_EX_TOPMOST|TOOLWINDOW|NOACTIVATE|LAYERED|TRANSPARENT`, `LWA_COLORKEY`, `ExcludeFromCapture`; `WM_CLOSE` yok sayılır (gösterge yordamı).
- Tehdit: teknisyen çizimle kullanıcıyı yanıltabilir (sahte "Evet'e tıkla") → zaten tam kontrol yetkisi var, gösterge ve olay günlüğü
  bağlantıyı belgeler; kabul (R-P30-1).

## 6. Dosya planı

| Dosya                                                                                                  | Değişiklik                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/agent-win/internal/annot/annot.go` (yeni)                                                        | `uicore` işaretleme bölümü taşınır (Stroke, MaxStrokes, Apply, Color, Polylines)                                                                                                                                                                    |
| `apps/agent-win/internal/annot/annot_test.go` (yeni)                                                   | `uicore/session_text_test.go`'daki işaretleme testleri taşınır + undo/clear/sınır/nil lazer                                                                                                                                                         |
| `apps/agent-win/internal/annot/gdi_windows.go` (yeni)                                                  | `ui/overlay_windows.go` `paint/drawStroke/drawLaser/drawHead` + `annotRGB`/`colorKey` taşınır: `Paint(dc uintptr, r win.RECT, strokes []Stroke, laser *[2]float64, scale func(int32) int32, exclude []win.RECT)`; görsel çıktı aynı                 |
| `apps/agent-win/internal/ui/uicore/session_text.go`, `_test.go`                                        | işaretleme bölümü silinir                                                                                                                                                                                                                           |
| `apps/agent-win/internal/ui/mac/overlay_darwin.go`, `ui/gtk/overlay_linux.go`                          | `uicore.ApplyAnnot/AnnotColor/StrokePolylines` → `annot.*`                                                                                                                                                                                          |
| `apps/agent-win/internal/ui/overlay_windows.go`                                                        | `overlay` kendi `stroke`/`apply`/çizim kodunu bırakır; `annot.Apply` + `annot.Paint` (500 sınırı Windows Hızlı Destek'e de gelir)                                                                                                                   |
| `apps/agent-win/internal/unattended/helper/headless.go`                                                | `Annot` → `h.live.Annot(m)`; `Active`/`MonitorChanged` → `h.live.SetSurface(mon.ID)`; tip yorumu güncellenir                                                                                                                                        |
| `apps/agent-win/internal/unattended/helper/follow.go`                                                  | `liveIndicator`: çizim durumu, `Annot`, `SetSurface`; `rebind` ve `watch` yeni göstergeye anlık görüntüyü (`painter` arayüzü) verir                                                                                                                 |
| `apps/agent-win/internal/unattended/helper/helper.go`                                                  | isteğe bağlı arayüz `painter{ Paint(snapshot annotSnap) }`; `Deps.MonitorRect func(id int) (win.RECT,bool)` yerine platform bağımsız `rect`                                                                                                         |
| `apps/agent-win/internal/unattended/helper/indicator_windows.go`                                       | `layer` alanı: aynı sınıf/iş parçacığı penceresi, `wmAnnot` iletisi + `atomic.Pointer[annotSnap]`, boyama (`annot.Paint` + gösterge kırpması), lazer zamanlayıcısı, `tick` en üste alma sırası, `WM_DISPLAYCHANGE`'de taşıma; katman `wins` dışında |
| `apps/agent-win/internal/unattended/helper/main_windows.go`                                            | `Deps.MonitorRect = capture.MonitorRect`                                                                                                                                                                                                            |
| `apps/agent-win/internal/unattended/helper/*_test.go`                                                  | §9'daki testler                                                                                                                                                                                                                                     |
| `docs/mimari-p27.md` §5.6                                                                              | "Sohbet ve işaretleme gösterilmez" → işaretleme P30 notu                                                                                                                                                                                            |
| `docs/KULLANIM_KILAVUZU.md` (~356 ve gözetimsiz bölümü), `CHANGELOG.md` 0.23.0, `docs/api.md` değişmez | teknik-yazar                                                                                                                                                                                                                                        |

Sınıf adı: katman `indicatorClass` ile `CreateWindow` eder; `indicatorProc` `h == ind.layer` ise katmanı boyar.

## 7. Performans

Boyama yalnız ileti geldiğinde (`Invalidate`); ≤ 500 çizim × ≤ 500 nokta çift tamponlu GDI. Lazer 100 ms zamanlayıcı yalnız lazer varken.
`liveIndicator.Annot` akış döngüsünü bloklamaz (kilit + `PostMessage`).

## 8. Operasyon

Yeni env/config/migration yok. Sürüm 0.23.0 (ldflags `config.version`, CI `agent-win.yml` girişi); staging yayın sırası runbook mevcut
akışı; P29 açıksa servis kendini günceller. Geri alma: 0.22.1 ikilisi (işaretleme yok, başka fark yok).

## 9. Test stratejisi

| AC       | Seviye                      | Test                                                                                                                                                    |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 494      | Go birim                    | `annot_test.go`: stroke ekle, undo id/son, clear, 501. çizimde en eski düşer, nil X/Y lazer yok sayılır                                                 |
| 494, 497 | Go birim (tüm platform)     | `follow_test.go`: sahte `painter` gösterge; `Annot` sonrası anlık görüntü; `rebind` sonrası yeni göstergeye aynı liste + yüzey, lazer nil; `SetSurface` |
| 498      | Go birim                    | `flow` mevcut `ctlAllowed` testine `annot.stroke` (sahip olmayan eş → UI'ya ulaşmaz)                                                                    |
| 496      | Go birim                    | kırpma dikdörtgenleri = `layout()` çıktısı (katman yerel koordinatı); katman oluşturma hatası `Failed` kapatmaz                                         |
| 495, 496 | Windows CI (`windows-2025`) | katman stil bayrakları, `wins` dışı, `tick` sırası, `verify` değişmez                                                                                   |
| 499      | Go birim (mevcut)           | `TestAC341HelperDependencyBoundary`, `TestAC431HelperWindowClassesOnlyIndicator` değişmeden yeşil                                                       |
| 494–497  | Elle (staging)              | gözetimsiz oturum: çiz/geri al/temizle/lazer, Win+L ve UAC'de çizim + gösterge üstte, monitör değiştir                                                  |

Komutlar: `cd apps/agent-win && go test ./...` · `GOOS=windows go vet ./...` · CI `agent-win.yml` Windows işi.

## 10. Görev paketleri

| Paket                                                             | Ajan                                 | Bağımlı | Paralel       |
| ----------------------------------------------------------------- | ------------------------------------ | ------- | ------------- |
| P30-1 `internal/annot` taşıma + Hızlı Destek (win/mac/gtk) geçişi | backend-dev (Go)                     | —       | —             |
| P30-2 yardımcı katmanı + testler                                  | backend-dev (Go)                     | P30-1   | —             |
| P30-3 0.23.0 sürüm, CI                                            | devops                               | P30-2   | P30-4 ile     |
| P30-4 kılavuz, CHANGELOG, mimari-p27 notu, PDF                    | teknik-yazar                         | P30-2   | P30-3 ile     |
| qa ‖ güvenlik → staging elle test                                 | qa-denetci, guvenlik, test-operatoru | P30-3   | qa ‖ güvenlik |

dba, frontend-dev: iş yok. Tahmin: P30-1 ~0,5 gün, P30-2 ~1 gün, P30-3/4 ~0,5 gün.

## 11. AC eşlemesi

| AC     | Bileşen                                                                                    |
| ------ | ------------------------------------------------------------------------------------------ |
| AC-494 | `internal/annot`, `helper/headless.go`, `helper/indicator_windows.go`                      |
| AC-495 | `helper/indicator_windows.go` (katman stili, `ExcludeFromCapture`)                         |
| AC-496 | `helper/indicator_windows.go` (kırpma, `tick` sırası, `wins` dışı)                         |
| AC-497 | `helper/follow.go` (`rebind`, durum), `headless.Active/MonitorChanged`, `WM_DISPLAYCHANGE` |
| AC-498 | `flow/peers.go` `ctlAllowed` (değişmez), web `console-parts.tsx` (değişmez)                |
| AC-499 | `internal/annot` paylaşımı, `boundary_test.go`, `windows_test.go`                          |

## 12. Açık kararlar / riskler

- R-P30-1 (kabul): çizim kilit/UAC öğelerinin üstüne düşebilir — tıklama geçirgen, gösterge üstte.
- R-P30-2: Windows < 10 2004'te `ExcludeFromCapture` yok → katman yakalamaya girer (çift çizim); gösterge ile aynı önkoşul (V-P30-1).
- R-P30-3: güvenli masaüstünde (Winlogon) katman `CreateWindow` başarısız olabilir → yalnız çizim görünmez (K-P30-2); elle testte doğrulanır.
- Sonra: Hızlı Destek'te monitör değişiminde çizimlerin korunması (konsolla tutarlılık).
