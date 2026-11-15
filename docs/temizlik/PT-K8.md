# PT-K8 — Go Windows istemci (`internal/ui`, `tray/tray.go`, `cmd/noktadestek`) temizliği (backend-dev)

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §5 K8 (+ §1 kısıtlar) · AC: AC-317, AC-318, AC-320, AC-321, AC-322, AC-323.
Davranış ve görünüm değişmez: yalnız "dosyaya taşı", "işlev çıkar", "kopyayı ortak yardımcıya al" ve test-only işlevleri
`_test.go`'ya alma yapıldı. Metinler, koordinatlar/ölçüler, denetim oluşturma sırası (Tab sırası), Win32 çağrı sırası, pencere
mesajı işleme, çıkış kodları ve bayraklar aynı. P20 düzeltmeleri (tray mutex SID adı `tray.MutexName`, `SignalExisting` sahip
SID denetimi, kilidin süreç ömrü boyunca tutulup `run` dönerken bırakılması) birebir korundu. Yeni bağımlılık yok, `go.mod`
değişmedi. `RequestHome` P20'de kaldırılmıştı (iş listesinde yok).

## Dosyalar (üretim, satır)

| Önce                          | Sonra                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/screens_windows.go` 720   | silindi → ekran başına dosya (hepsi `//go:build windows`):                                                                                                                |
|                               | `ui_windows.go` 157 (`UI`/`sessionWin` tipleri, kimlikler, `New`, `emit`, `ShowError`, `crlf`, `await`, `closeLobby`)                                                     |
|                               | `welcome_windows.go` 105 (`AskCode`, `Welcome` + `welcomeForm` + `welcomeIntro`)                                                                                          |
|                               | `lobby_windows.go` 47 (`Lobby`, `Connecting` + ortak `showLobby`)                                                                                                         |
|                               | `choose_windows.go` 208 (`ChooseShare` + `shareDlg`, `topWindows`, `windowsSelfPID`)                                                                                      |
|                               | `session_windows.go` 158 (`Active` + `newSessionWin`/`sessionCommand`/`confirmEnd`, `Status`, `Chat`, `Annot`, `appendLine`)                                              |
|                               | `transfer_windows.go` 105 (`FileOffer*`, `FileProgress`, `FileResult`, `humanSize`)                                                                                       |
|                               | `ended_windows.go` 58 (`EndedNote`, `Ended`, `teardownSession`)                                                                                                           |
| `ui/form_windows.go` 456      | 249 (form/denetim); `thread_windows.go` 253 (UI iş parçacığı, girdi kaynağı izleme, `dispatch` + 3 mesaj grubu)                                                           |
| `ui/request_windows.go` 462   | 159 (`RequestProblem` + `problemButtons`, `RequestClosed`); `reqform_windows.go` 202; `reqwait_windows.go` 131                                                            |
| `ui/control_windows.go` 307   | 134; `consent_windows.go` 192 (ortak izin diyaloğu, `newConsent` + `consentContent` + `addButtons`, `closeDlg`)                                                           |
| `ui/home_windows.go` 150      | 211 (`FirmHome` → `firmHome` yapısı ve bölüm işlevleri)                                                                                                                   |
| `ui/overlay_windows.go` 211   | 221 (`paint` → `drawStroke`, `drawLaser`)                                                                                                                                 |
| `ui/logo.go` 91               | 87 (`fitBGR` → `tray.AreaSum` + `fitSize`)                                                                                                                                |
| `ui/theme.go` 84              | 45; kontrast yardımcıları → `ui/contrast_test.go` 43                                                                                                                      |
| `tray/tray.go` 126            | 135 (`IconPixels` → `AreaSum`; `AreaSum` yeni dışa açık yardımcı)                                                                                                         |
| `cmd/noktadestek/main.go` 341 | 237 (`run` + `app`, `setup`, `startFailed`, `openStore`, `writeDiag`, `startTray`, `serve`); `deps.go` 181 (`resident`, `scope`, `acquireTray`, `launchDeps`, `flowDeps`) |

Kapsamda > 300 satırlık dosya yok (en büyüğü `thread_windows.go` 253).

## İşlev uzunluğu / karmaşıklık (`scripts/pt-olcum/golen.go`; `gocyclo@v0.6.0` docker'da, repoya girmedi)

| İşlev               | Önce (satır / cx) | Sonra                                                                                                   |
| ------------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| `run`               | 175 / 28          | 14 / 3 + `setup` 4 cx, `openStore`, `startTray` 25, `serve` 34 / 7, `resident` 30, `scope` 35           |
| `UI.FirmHome`       | 132 / 36          | 8 / 1 + `firmHome.build`, `addFirms`, `addNotes`, `addButtons`, `addToggles`, `command` 14 cx, `toggle` |
| `UI.ChooseShare`    | 129 / 32          | 10 / 1 + `shareDlg.build`, `addMonitors` 27, `addWindows`, `fill`, `setMode`, `pick*`, `command` 12 cx  |
| `UI.Active`         | 88 / 20           | 30 / 6 + `newSessionWin` 30, `sessionCommand` 10 cx, `confirmEnd`                                       |
| `UI.newReqForm`     | 81 / 15           | 22 / 2 + `field`, `addFields`, `addConsent`, `reply`, `command` 12 cx                                   |
| `UI.Welcome`        | 66 / 13           | 6 / 1 + `welcomeForm` 31 / 9, `welcomeIntro` 2 cx                                                       |
| `dispatch`          | 65 / 27           | 7 cx + `callbackMsg` 9, `themeMsg` 12, `windowMsg` 4                                                    |
| `fitBGR`            | 56 / 16           | 37 / 11 + `fitSize`, `tray.AreaSum` 3 cx                                                                |
| `launchDeps`        | 52                | `app.launchDeps` 21 + `app.flowDeps` 37                                                                 |
| `UI.RequestWaiting` | 52                | 21 + `newReqWait` 31                                                                                    |
| `UI.newConsent`     | 50                | 29 + `consentContent`, `consentDlg.addButtons`                                                          |
| `UI.RequestProblem` | 49 / 11           | 27 + `problemButtons`                                                                                   |
| `tray.IconPixels`   | 47 / 12           | 35 / 10                                                                                                 |
| `overlay.paint`     | 47                | 3 cx + `drawStroke`, `drawLaser`                                                                        |
| `UI.RequestClosed`  | 44                | 39 (`await`)                                                                                            |

Kapsamdaki tüm üretim işlevleri ≤ 40 satır (en uzunu `RequestClosed` 39) ve cx ≤ 15 (en yükseği `firmHome.command` 14).
Test işlevlerinde `TestAC190AC189FirmHomeSingleScreen` cx 17 hedef değil, dokunulmadı. **İstisna yok.**

## Davranış eşdeğerliği notları

- **Ekran yapıları** (`shareDlg`, `firmHome`, `reqForm` yöntemleri): kapanışlar (closure) yapı alanı + yönteme çevrildi; denetimler
  aynı sırada, aynı koordinatlarla oluşturulur (Tab ve z sırası aynı). `f.command`/`f.close` atamaları ve `show` çağrısı eskisi
  gibi tüm denetimlerden sonra. `switch` dal sırası aynı; `firmHome.command`'da tepsi/açılış onay kutusu dalları `toggle`'a alındı:
  dış `case id == idFirmTray, id == idFirmAutostart` bu kimlikler başka dalla eşleşmediği için eski koşullu dallarla eşdeğer
  (koşul tutmazsa yine hiçbir şey yapılmaz).
- **`await`**: eski `select { case r := <-ch / case <-ctx.Done() }` bloklarının aynısı; bağlam bitince dönen değerler aynı
  (`FirmClose`, `ProblemClose`, `ClosedClose`, `FormClose` + boş form, boş seçim/kod/ad).
- **`orSystemLogo`**: dört "`logo := v.Logo; if logo == nil { systemLogo() }`" kopyası; tüm `Logo` alanları `image.Image`
  arayüzü (tipli nil riski yok). Yalnız `_windows.go`'dan çağrıldığı için `form_windows.go`'da (linux staticcheck U1000 yok).
- **`closeLobby`**: `ChooseShare`, `Active`, `teardownSession`'daki aynı üç satır. `showLobby`: `Lobby`/`Connecting` sonu.
- **`dispatch`**: mesajlar üç ayrık gruba bölündü (geri çağrı / tema / pencere); her mesaj eskisi gibi tek dala düşer, işlenmeyen
  dal (`WM_ACTIVATE`, koyu olmayan `WM_CTLCOLOR*`, `WM_SETTINGCHANGE`, `paint`'siz `WM_PAINT`) yine `DefWindowProc`'a gider.
  `themeMsg`'e `theThread` (`t`) parametre olarak verilir (eskisi gibi `t.theme`, `t.bgBrush`, `t.refreshTheme`).
- **`tray.AreaSum`** (logo çözme klonu): `IconPixels` ve `fitBGR`'ın aynı alan ortalaması iç döngüsü. Hücre sınırları eskiden
  satır başında, şimdi hücre başında hesaplanır (saf aritmetik, aynı değerler). Yön: `ui` → `tray` (yeni içe aktarma). Döngü yok:
  `tray` `ui`'yi içe aktarmaz; `ui`'nin bağımlılıkları zaten `tray`'inkilerin üst kümesi (linux + windows `go list -deps` ile
  doğrulandı), yani `ui`'ye yalnız `tray` eklenir. Ters yön (`tray` → `ui`) `tray`'e `launch`/`request`/`ui` eklerdi.
  `fitBGR`'ın ölçek kararı `fitSize`'a alındı (aynı ifade).
- **`main.go`**: `run` = `setup` → `defer trayLock.Release()` → `startTray` → `serve`. Sıra aynı: `IsTrayLaunch` → `Harden`
  → `config.Load` (hata: `--tray`'de pencere yok, `exitConfig`) → `identity` (`exitIdentity`) → `SelfElevated` → köken → depo +
  göç → tanılama logu → açılış tanılama olayları → (`--tray`) `DecideStart` / `Disable` / `Verify` + balon / `acquireTray`
  (alınamazsa `SignalExisting`, `exitOK`) → `ui.New` (`exitUI`) → `defer u.Close()` → balon işlevi → `api.New` → `Resident`
  → `RunTray`/`RunNormal` → `exitOK`. Kilit `app.trayLock`'ta tutulur; `StartTray` (tepsiye inme) aynı alana yazar; `defer`
  `run`'da kaldığından bırakma yine `u.Close()`'dan sonra ve `run` dönerken. `writeDiag` kapanışı → `app.writeDiag` yöntemi
  (aynı nil denetimi ve alanlar). `launchDeps` parametreleri `app`'ten okunur; `ld.Store` tipli nil koruması aynı.
- **Kontrast yardımcıları** (`colorPair`, `textPairs`, `linear`, `luminance`, `contrastRatio`): baseline'da "yalnız testte 4";
  üretimde okuyucu yok → `contrast_test.go`. Test adları ve iddialar aynı.

## Doğrulama (golang:1.26, docker; repo kökü bağlı)

- `gofmt -l .`: boş. `go vet ./...` linux, `GOOS=windows`, `GOOS=windows GOARCH=386`: temiz.
- `GOOS=windows go test -c` `ui`, `tray`: derleniyor. `GOOS=windows go build ./cmd/noktadestek`: derleniyor.
- `go test -race -count=1 ./...`: 21 paketin hepsi `ok`.
- `staticcheck` v0.8.2 (`go install` ile, `go.mod` değişmez) linux ve `GOOS=windows GOARCH=amd64 CGO_ENABLED=0`, `./...`: **0 uyarı**.
- `deadcode@v0.52.0 -test` (windows): kapsamda bulgu yok.
- Test listesi önce = sonra: linux `go test -list .` (`ui`, `tray`, `cmd`) **33**, windows derlemesinden `go tool nm` ile Test
  sembolleri **36** — iki liste de birebir aynı (diff boş).
- Değişen dosyalar yalnız `apps/agent-win/internal/ui/**`, `internal/tray/tray.go`, `cmd/noktadestek/{main,deps}.go` ve bu not.

## Elle Windows testi (CI kapsamı dışında; `docs/test-raporu.md` P20 grupları)

Win32 ekranlarının otomatik testi yok; aşağıdakiler Windows VM'de duman testi ister:

| Değişen kod                                                                 | Kontrol                                                                                                                                            | Grup    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `main.go` `setup`/`startTray`/`serve`, `deps.go` `resident`                 | `--tray` açılışı, ikinci örnek öne getirir ve çıkar, X ile tepsiye inme, "Çık" onayı, başka kullanıcının mutex'i                                   | A, E, H |
| `startTray` (`Verify`/`Disable` balonları), `FirmHome` toggle               | "Windows açılışında başlat" / "Tepside çalıştır" kutuları, ipucu, gizli açılış kutusu                                                              | B       |
| `firmHome` (liste, düğmeler, unut onayları)                                 | çoklu firma listesi, çift tıklama, seçim değişince "Bu firmayı unut", iki onay diyaloğu, başka sunucu satırları                                    | C, G    |
| `newReqWait`, `reqForm`, `RequestProblem`/`Closed`                          | talep formu (Tab sırası, hatırla kutusu, hata odağı), bekleme penceresi + sohbet, sorun/kapanış ekranları                                          | D       |
| `tray.AreaSum`, `fitBGR`                                                    | tepsi simgesi (16/32 px) ve karşılama/form/onay logosu açık ve koyu temada aynı görünür                                                            | A, F    |
| `choose_windows.go`, `session_windows.go`, `consent_windows.go`, `dispatch` | kod oturumu: karşılama, ekran/pencere seçimi, oturum penceresi, kontrol/dosya izin diyaloğu (1,5 sn kilit, Enter yutulur), DPI değişimi, koyu tema | G, H    |

## PT bulguları

Yok (bölme sırasında hata görülmedi).
