# P28u K6s — Windows spike (sonuç ve karar önerileri)

Tarih: 2026-11-16 · Branch: `p28u` · Kaynak: `docs/mimari-p28u.md` §7.3 (örtülme kuralı, O-P28u-1), §7.5 "Doğrulama",
R-P28u-1/2, K-P28u-5b, ADR-0033 · Sahip: backend-dev (Go)

> **Durum: ÖLÇÜM ALTYAPISI HAZIR, SONUÇ YOK.** Bu makinede Windows yok ve commit/push yapılmadı. Testler yalnız
> linux `go test ./...` (Windows testleri derlenmez), `GOOS=windows go vet` / `go build` / `go test -c` ve windows
> staticcheck ile **derleme düzeyinde** doğrulandı; **hiçbiri Windows'ta koşmadı.** Aşağıdaki "Sonuç" sütunları ilk CI
> koşusundan (step summary) ve elle koşudan sonra doldurulur. Karar önerileri bu yüzden koşulludur.

## 1. Eklenen dosyalar

| Dosya                                                     | İçerik                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/agent-win/internal/win/k6s_overlay_windows_test.go` | Soru 4: `TestK6sOverlayZOrderAndWindowFromPoint` (CI, her koşu)                                                                                                                                                                                            |
| `apps/agent-win/internal/servis/k6s_windows_test.go`      | `TestMain` (`--k6s-kilit` çocuk dalı), `TestK6sSessionIDs` (CI, her koşu), `TestK6sLockRestrictedToken` (CI son adımı, `K6S_KILIT=1`), `TestK6sElle` (yalnız `-k6s.elle`, SYSTEM + Session 0)                                                              |
| `apps/agent-win/internal/servis/testdata/k6s-elle.ps1`    | Elle spike'ın tek komutlu betiği                                                                                                                                                                                                                           |
| `.github/workflows/agent-win.yml`                         | `test-windows` işine **en sona** "P28u K6s spike" adımı: önce `-v` ile `TestK6sOverlay` + `TestK6sSessionIDs` (günlükte görünür), sonra `K6S_KILIT=1` ile kilit testi (koşucuyu kilitler). Önceki son adımın yorumu güncellendi. Workflow devops alanıdır. |

Üretim koduna dokunulmadı; yeni bağımlılık yok. Win32 çağrıları (`WTSQuerySessionInformationW`, `WTSLogoffSession`,
`LockWorkStation`, `OpenInputDesktop`, `PeekMessageW`) `x/sys/windows`'ta olmadığından **yalnız test dosyalarında**
`NewLazySystemDLL` ile tanımlıdır; K5/K6 üretim kodu yazılırken `internal/win` / `internal/servis`'e taşınır.
Kısıtlı jetonlu çocuk, üretimdeki `WinLauncher.start` ile aynı `proclimit.Spec`'i kullanır (MitigationImageLoad, alt süreç
yasağı, job, UI kısıtı yok); tek fark test ikilisi konsol alt sistemli olduğundan `Detached: true`. SYSTEM'de koşarsa
jeton üretimdeki `helperToken(session)`'ın kendisidir.

Testler ölçümdür: işletim sistemi davranışı testi kırmızı yapmaz (`t.Log` + `$GITHUB_STEP_SUMMARY` + elle `sonuc.txt`).
Kırmızı yalnız kendi hatamızda: `WTSINFOEXW` yapı düzeni yanlışsa (`Level != 1` ya da `SessionId` uyuşmazsa) `t.Errorf`.
Etkileşimsiz oturumda pencere açılamazsa `t.Skip`.

## 2. Soru soru: CI'da ölçülen / elle kalan

### Soru 1 — `LockWorkStation` kısıtlı SYSTEM jetonlu yardımcıdan Default masaüstünde çalışıyor mu (R-P28u-1, K-P28u-5b)

| Ölçüm                                                                                                                                                                                                                                                                                       | Nerede                                                                      | Sonuç |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----- |
| Koşucu kullanıcısının **kısıtlı** (`DISABLE_MAX_PRIVILEGE`) jetonu + job + mitigation ile çocuk `LockWorkStation`: dönüş, `GetLastError`; çocuk 3 sn içinde **giriş masaüstü = `Winlogon`** görüyor mu (§7.5 ölçütü, asıl kanıt); üst süreç ayrıca `SessionFlags=LOCK` (ayrı sütun, soru 3) | CI son adımı (`TestK6sLockRestrictedToken`, step summary "P28u K6s soru 1") | —     |
| Session 0'dan (servis) doğrudan `LockWorkStation` (beklenen: başarısız/etkisiz; Session 0'dan giriş masaüstü okunamaz, yalnız `SessionFlags`)                                                                                                                                               | Elle, adım `kilit0`                                                         | —     |
| **Üretim jetonu** `helperToken(console)` (kısıtlı SYSTEM, `winsta0\default`) ile çocuk                                                                                                                                                                                                      | Elle, adım `kilit` — **R-P28u-1'in kesin yanıtı**                           | —     |
| K-P28u-5b geri dönüşü: `WTSQueryUserToken` kullanıcı jetonuyla çocuk                                                                                                                                                                                                                        | Elle, adım `kilit5b`                                                        | —     |

CI yalnız **kısmi** yanıttır: CI jetonu SYSTEM değil, koşucu kullanıcısının kısıtlı kopyasıdır (kimlik farkı; ayrıca CI
oturumu etkileşimli konsol olmayabilir — `TestK6sSessionIDs` bunu gösterir). Kesin yanıt elle `kilit` adımıdır.

### Soru 2 — Oturum kapatma sonrası konsol oturum kimliği değişiyor mu, yeni oturum ne kadar sürede görünür (R-P28u-2)

| Ölçüm                                                                                                                                                                        | Nerede                                 | Sonuç |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----- |
| `WTSGetActiveConsoleSessionId` ↔ `ProcessIdToSessionId` eşleşmesi (D-P28u-3 hedef oturum kuralı), oturum listesi                                                             | CI (`TestK6sSessionIDs`, her koşu)     | —     |
| `WTSLogoffSession(bWait=FALSE)` sonrası 60 sn, 500 ms yoklama: etkin konsol kimliği/durumu/`UserName` boş mu, eski oturum ne zaman yok oldu; yalnız değişimler zaman damgalı | Elle, adım `kapat` (SYSTEM, Session 0) | —     |

CI'da ölçülemez: koşucunun oturumunu kapatmak işi öldürür ve servis bağlamı (SYSTEM, Session 0) yoktur.

### Soru 3 — `SessionFlags` Windows 10/11'de doğru mu

| Ölçüm                                                                                          | Nerede                                         | Sonuç |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----- |
| Kilitsiz oturumda `WTSSessionInfoEx.SessionFlags` (beklenen `UNLOCK=1`) + yapı düzeni denetimi | CI (`TestK6sSessionIDs`) — Windows Server 2025 | —     |
| Kilit sonrası `SessionFlags` (beklenen `LOCK=0`)                                               | CI son adımı (kilit başarılıysa)               | —     |
| Windows 10/11 istemci: kilitsiz → kilitli → kilit açık geçişleri (`kilit*` adımları)           | Elle                                           | —     |

Bilinen tarihsel hata: Windows 7 / Server 2008 R2'de `LOCK`/`UNLOCK` ters döner. Server 2025 (CI) istemci sürümüyle aynı
çekirdek ailesidir ama **istemci (10/11) kanıtı elle koşudan gelir.**

### Soru 4 — `GW_HWNDPREV` taraması / `WindowFromPoint` saydam-katmanlı pencereyi görüyor mu (O-P28u-1)

| Ölçüm                                                                                                                                                                                                                                           | Nerede                                                                            | Sonuç |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----- |
| `WS_EX_TOPMOST` taban üstüne 5 örtü türevi (`LAYERED\|TRANSPARENT` alfa 0 / 1 / 255, `+NOACTIVATE\|TOOLWINDOW` alfa 1, yalnız `LAYERED` alfa 1): GW_HWNDPREV zinciri örtüyü "görünür + kesen" buluyor mu; `WindowFromPoint` taban/örtü/belirsiz | CI (`TestK6sOverlayZOrderAndWindowFromPoint`, her koşu) + elle betiğin ilk bölümü | —     |

Beklenen (Win32 belgelerine göre, ölçülene kadar varsayım): z-sırası taraması tüm türevleri bulur (`IsWindowVisible`
WS_VISIBLE'a bakar, alfa/saydamlığa değil); `WindowFromPoint` `WS_EX_LAYERED|WS_EX_TRANSPARENT` örtüyü **atlayıp tabanı**
döndürür. Bu doğrulanırsa §7.3'teki "asıl denetim (1) z-sırası, (3) `WindowFromPoint` yalnız savunma derinliği" kararı aynen
kalır. Sınır: örtü aynı süreç/iş parçacığındadır; saldırgan ayrı süreçtir (z-sırası ve saydam isabet atlaması pencere
yöneticisinde süreçten bağımsızdır, ayrı süreçten örtü Windows VM elle turunda ayrıca denenmelidir).
Paralel testlerin pencereleri araya girerse `WindowFromPoint` "belirsiz" yazılır, test kırmızı olmaz.

## 3. Elle koşu (kullanıcının Windows 10/11 makinesi)

Uyarı: **oturum zorla kapatılır** (açık belgeler kaybolur), ekran üç kez kilitlenir. Yönetici hesabı gerekir. Test ikilileri
imzasız olduğundan SmartScreen/Defender uyarı verebilir.

1. İkilileri üret (bu repoda, macOS/linux; çıktı git-ignored `apps/agent-win/bin/k6s/`):

   ```sh
   docker run --rm -v "$PWD:/src" -w /src/apps/agent-win -e GOOS=windows -e GOARCH=amd64 golang:1.26 sh -c 'mkdir -p bin/k6s && go test -c -o bin/k6s/k6s-servis.test.exe ./internal/servis && go test -c -o bin/k6s/k6s-win.test.exe ./internal/win && cp internal/servis/testdata/k6s-elle.ps1 bin/k6s/'
   ```

2. `bin/k6s/` klasörünü Windows makinesine kopyala; o klasörde **yönetici PowerShell**'de tek komut:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\k6s-elle.ps1
   ```

   Betik: (a) kullanıcı oturumunda soru 4 + oturum kimliği testlerini koşar (`C:\ProgramData\NoktaDestekK6s\kullanici.txt`);
   (b) tek seferlik **SYSTEM** zamanlanmış görev (Session 0 = servis bağlamı) `TestK6sElle`'yi başlatır: 10 sn sonra
   `kilit0` → `kilit` → `kilit5b` (her kilitten sonra kilidi siz açarsınız; en çok 180 sn beklenir) → `kapat`
   (`WTSLogoffSession`, 60 sn ölçüm). Tek adım için `-Adimlar kilit` gibi verilebilir.

3. Yeniden giriş yapıp aynı klasörde: `powershell -ExecutionPolicy Bypass -File .\k6s-elle.ps1 -Sonuc` — sonucu basar ve
   zamanlanmış görevi siler. Çıktı bu belgenin "Sonuç" sütunlarına aktarılır; ardından `C:\ProgramData\NoktaDestekK6s`
   silinir. Sonuç dosyasına kullanıcı adı yazılmaz (yalnız "dolu/boş").

## 4. Karar önerileri (koşullu)

| Konu                               | Ölçüm sonucu                                                                                                                       | Öneri                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K-P28u-5b geri dönüşü              | Elle `kilit`: dönüş ≠ 0 **ve** çocuk çıktısında `giriş masaüstü=Winlogon` (+≤ 2000 ms)                                             | **Gerekmez.** §7.5 tasarımı aynen: kilit yardımcıda (kısıtlı SYSTEM jetonu, Default masaüstü iş parçacığı). `--lock` kipi kodlanmaz.                                                                                                                                                                                                                                                                                                                                                                                                         |
|                                    | Elle `kilit`: dönüş 0 (ör. `ERROR_ACCESS_DENIED`) ya da dönüş ≠ 0 ama 2 sn içinde `Winlogon` görülmedi, **ve** `kilit5b` kilitledi | **Gerekir.** K5'te `NoktaDestekServis.exe --lock` kipi (`WTSQueryUserToken` + `CreateProcessAsUser`, argüman dışı girdi yok, `dllsafe` ilk satır, tam yol); hedef oturum D-P28u-3 kuralıyla yardımcının `SessionId`'si.                                                                                                                                                                                                                                                                                                                      |
|                                    | İkisi de kilitlemedi                                                                                                               | K5/K6 başlamadan mimar'a geri: kilit işlevi (AC-443 kilit kısmı) yeniden tasarlanır.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
|                                    | Yalnız CI ölçümü var (elle yok)                                                                                                    | CI kilitlediyse "jeton kısıtlaması tek başına engellemiyor" kanıtıdır ama SYSTEM kimliği ölçülmemiştir: K-P28u-5b'yi **hazır tutun** (K6 kilit yolunu tek arabirim arkasına yazın), elle sonuçla kesinleştirin. CI kilitlemediyse 5b gerekir sayın.                                                                                                                                                                                                                                                                                          |
| Yeniden katılım bekleme (R-P28u-2) | Elle `kapat`: yeni konsol oturumunun (kimlik değişti ya da eski yok olup yeniden belirdi) görünme süresi T                         | T ≤ 15 sn → 20 sn bekleme bütçesi aynen. 15 < T ≤ 25 sn → bekleme T+5 sn'ye çıkarılır (≤ 30 sn: `REJOIN_TICKET_TTL` 30 sn ve 45 sn pencere aşılmaz; `rejoin-const` tek tanım). T > 25 sn → bütçe değiştirilmez, mimar'a geri (bilet ömrü/pencere tek tanımı yeniden ele alınır); o zamana dek yeniden katılım düşer, oturum kapatma yine başarılı, konsol metni yolu esas. Kimlik **değişmiyorsa** servis "yeni oturum" tespitini kimlik eşitsizliğine değil eski oturumun yok olup yeniden `WTSActive/WTSConnected` belirmesine dayandırır. |
| `SessionFlags` (soru 3)            | Kilitsizde 1, kilitlide 0 (CI + elle)                                                                                              | §7.5 kuralı aynen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
|                                    | Ters ya da `UNKNOWN` (çocuk `Winlogon` gördüğü hâlde `LOCK` değil)                                                                 | Yedek kural: `WTSQuerySessionInformation(WTSSessionInfo)` + yardımcıda `OpenInputDesktop` adı (`Winlogon` = kilitli).                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Örtülme (soru 4)                   | Tarama tüm türevleri buldu, `WindowFromPoint` saydam örtüyü atladı                                                                 | §7.3 aynen (asıl denetim z-sırası).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
|                                    | Tarama bir türevi bulamadı                                                                                                         | K6 başlamadan mimar'a: o türev için ek ölçüt (ör. `EnumWindows` + `GetWindowRect` ile tabandan üstteki tüm üst düzey pencereler) tasarıma eklenir.                                                                                                                                                                                                                                                                                                                                                                                           |

## 5. Komutlar ve son çıktı

```sh
docker run --rm -v "$PWD:/src" -w /src/apps/agent-win golang:1.26 sh -c 'go test ./... && GOOS=windows go vet ./... && GOOS=windows go build ./...'
```

Son çıktı (2026-11-16): linux `go test ./...` tüm paketler `ok`; `gofmt -l` boş; `GOOS=windows go vet ./...`,
`go build ./...`, `go test -c ./internal/servis ./internal/win` hatasız; windows/amd64 `staticcheck` (v0.8.2,
`internal/servis/...`, `internal/win/...`) uyarısız; workflow YAML geçerli ve prettier uyumlu.

## 6. Sonraki adım

1. Branch push edildiğinde `agent-win` → `go test (Windows)` step summary'sindeki "P28u K6s" tablolarını §2'ye aktarın.
2. Elle koşu (§3) — R-P28u-1 ve R-P28u-2'nin kesin yanıtı; sonuç gelmeden K-P28u-5b kararı kesinleşmez.
3. K5/K6 bu belgedeki §4 kararına göre başlar (mimari tabloda K5, K6 → K6s bağımlı).
