# PT-K7 — Go `internal/{api,input,files,diag}` temizliği (backend-dev)

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §5 K7 (+ §1 kısıtlar) · AC: AC-317, AC-318, AC-320, AC-321, AC-322, AC-323.
Davranış değişmez: yalnız "kopyayı ortak yardımcıya al", "işlev çıkar", "dosyaya taşı" ve test-only işlevleri `export_test.go`'ya
alma yapıldı. Yeni bağımlılık, yeni soyutlama katmanı yok. HTTP uçları/gövdeleri, hata metinleri ve kodları (`BAD_RESPONSE`,
`UNKNOWN`), yeniden deneme politikası, girdi düşürme nedenleri, tanılama log biçimi ve P20 ACL/reparse davranışı aynı.

## Dosyalar (üretim, satır)

| Önce                          | Sonra                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/api.go` 252              | 263 (`withRetry` yeniden deneme yardımcısı, `errorEnvelope` hata zarfı çözümü `do`'dan çıkarıldı)                                                       |
| `api/bindings.go` 68          | 58 (`BindingStatus` → `withRetry`)                                                                                                                      |
| `api/requests.go` 99          | 88 (`TenantInfo` → `withRetry`)                                                                                                                         |
| `api/logo.go` 130             | 140 (`parseLogoRef` biçim denetimi `LogoURL`'den çıkarıldı)                                                                                             |
| `input/applier.go` 360        | 281 (tuş işlevleri `keys.go`'ya; `Limited` → `export_test.go`)                                                                                          |
| `input/keys.go` 61            | 137 (`modHeld`, `blocked`, `key`, `unicodeOf`, `keyEvents` taşındı)                                                                                     |
| `input/scope.go` 374          | 262 (`translateScoped` + `scopedButton`/`scopedWheel`; `ScopeDropped` → `export_test.go`)                                                               |
|                               | `input/scope_keys.go` 135 (`scopedKeyUp`/`scopedKeyDown`, `shellShortcut` + `latchShortcut`/`unlatchedDrop`, erişilebilirlik, Shift sayacı, tuş kovası) |
| `input/host_windows.go` 185   | 200 (`Start` → `Host.run`, `registerHotkey`, `llHooks.dispatch`/`unhook`)                                                                               |
| `input/messages.go` 108       | 110 (`wheelOK`)                                                                                                                                         |
| `files/files.go` 169          | 163 (`IsSanitized` → `files/export_test.go`)                                                                                                            |
| `diag/diag.go` 243            | 254 (`openRotated` `Log.Write`'tan çıkarıldı)                                                                                                           |
| `diag/reparse_windows.go` 313 | 262; `diag/rename_windows.go` 62 (`renameInfo` + `Dir.Rename`, aynı yapı etiketi `windows && (amd64 \|\| arm64)`)                                       |

Yeni test dosyaları: `input/export_test.go` (`Applier.Limited`, `Applier.ScopeDropped`), `files/export_test.go` (`IsSanitized`).
Test dosyalarında tek değişiklik `diag/diag_test.go` S1017. Kapsamda > 300 satırlık üretim dosyası yok (en büyüğü
`applier.go` 281). Test dosyaları (`input_test.go` 442, `scope_test.go` 669) §1/2 gereği bölünmedi.

## İşlev uzunluğu / karmaşıklık (`scripts/pt-olcum/golen.go`; `gocyclo@v0.6.0` docker'da, repoya girmedi)

| İşlev                     | Önce (satır / cx) | Sonra                                                                               |
| ------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `Applier.translateScoped` | 72 / 20           | 21 (+ `scopedButton` 20, `scopedWheel` 11, `scopedKeyUp` 8, `scopedKeyDown` 24)     |
| `input.Start` (windows)   | 62 / 14           | 11 (+ `Host.run` 20, `registerHotkey` 7, `llHooks.dispatch` 21, `llHooks.unhook` 8) |
| `Client.do`               | 47 / 12           | 35 (+ `errorEnvelope` 15)                                                           |
| `Log.Write`               | 43 / 13           | 29 (+ `openRotated` 21)                                                             |
| `Applier.shellShortcut`   | 26 cx             | 12 satır (+ `latchShortcut` 11, `unlatchedDrop` 15); tümü cx ≤ 15                   |
| `Msg.valid`               | 16 cx             | ≤ 15 (`wheelOK`)                                                                    |
| `Client.LogoURL`          | 16 cx             | 20 satır, ≤ 15 (+ `parseLogoRef` 10)                                                |

Kapsamdaki tüm üretim işlevleri ≤ 40 satır (en uzunu `reparse_windows.go` `Dir.Open` 38, değişmedi) ve cx ≤ 15. Test
işlevlerinde cx > 15 kalan `TestAC248S171CoordinatesMapToWindowAndClip` (18) hedef değil; dokunulmadı.

## Davranış eşdeğerliği notları

- `withRetry`: eski üç döngünün birebir aynısı (en çok `resolveAttempts`, yalnız `Retryable` `*Error`, `retryBackoff × deneme`);
  beklemede `ctx` biterse `ctx.Err()` döner, çağıran yine `(nil, ctx.Err())` verir. `Resolve`'da gövde eskisi gibi her denemede
  `post` içinde yeniden kodlanır; `BindingStatus` gövdeyi bir kez kodlar (eskisi gibi). `Join`/`CreateRequest`/`CancelRequest`/
  `RevokeBinding` yine tek deneme.
- `errorEnvelope`: `Status`, `Code: "UNKNOWN"`, `RetryAfter` ve zarf alanları aynı sırada; `do` yalnız 2xx dışında çağırır.
- `translateScoped`: dal sırası ve ara adımlar aynı (`windowState` → `shellShortcut` → ön plan → kova → `key` → Shift sayacı).
  `shellShortcut`'ta `OSModifiers`, `modHeld` ve `accessibility()` (önbellek zamanı güncellemesi dahil) eskisi gibi her çağrıda
  karardan önce çalışır; kilit açan üç durum (`latchShortcut`) eski `switch`'teki ilk üç `case`, kalan beş durum (`unlatchedDrop`)
  sonraki `case`'ler — sıra korunduğundan ilk eşleşen aynı.
- `Start`: iş parçacığı sırası aynı (`LockOSThread` → `defer close(done)` → tid → kısayol kaydı → `ready` → mesaj döngüsü → kısayol
  kaydını sil → kancaları kaldır). `wmHooksOff` nesil denetimi (S7-16) ve `MSG` ofsetleri (8, 16) değişmedi.
- `openRotated`: aç → `Stat` → sınır aşımında kapat → `Rename(FileName, OldName)` → yeniden aç; hata yollarında dosya eskisi gibi
  kapatılır. `Dir`'in açılışı/kapatılışı `Log.Write`'ta kaldı.
- `Dir.Rename` (windows/64 bit) ve `renameInfo` yalnız dosya değiştirdi; içerik, `NtSetInformationFile` boyutu ve hata türleri aynı.
- `Limited`/`ScopeDropped`/`IsSanitized`: üretimde okuyucusu yoktu (baseline `yalnizTestte.windows`); sayaçlar (`limited`,
  `scopeDropped`) üretimde artmaya devam eder, yalnız okuyucular `export_test.go`'da. Başka paketten kullanan yok.

## staticcheck (v0.8.2)

`diag_test.go:48` S1017: `if strings.HasPrefix(line, "--- ") { line = line[4:] }` → `line = strings.TrimPrefix(line, "--- ")`
(eşdeğer). `staticcheck ./internal/{api,input,files,diag}/...` linux ve GOOS=windows: **0 uyarı**.

## deadcode (v0.52.0)

GOOS=windows: kapsamda bulgu yok (önce `IsSanitized`, `Applier.Limited`, `Applier.ScopeDropped`). Linux `-test`'te kalan
`Client.HTTPClient` baseline'daki gibi (Windows yolundan çağrılır; K7 iş listesinde yok, dokunulmadı).

## Doğrulama (golang:1.26, docker; repo kökü bağlı)

- `gofmt -l .`: boş. `go vet ./...` linux ve GOOS=windows temiz; `GOOS=windows GOARCH=386 go vet` (32 bit eş dosyalar) temiz.
- `GOOS=windows go test -c` `api`, `input`, `files`, `diag`: derleniyor (Windows'a özgü testler burada çalıştırılamaz).
- `go test -race -count=1 ./...` (apps/agent-win): 21 paketin hepsi `ok`.
- `go test -list . ./internal/{api,input,files,diag}/...`: önce/sonra **67 test, liste birebir aynı** (diff boş).
- jscpd 4.3.0 (≥ 8 satır, test hariç): baseline'daki `api` üçlü klonu (bindings/requests/api 18 satır) kalktı.
- Değişen dosyalar yalnız `apps/agent-win/internal/{api,input,files,diag}/**` ve bu not.

## PT bulguları

Yok (bölme sırasında hata görülmedi). Bilgi: jscpd, `Dir.Rename`'in ilk 9 satırını (`child(from)`/`child(to)` hazırlığı)
`reparse.go` (`!windows`) eşiyle klon sayıyor; bu iki dosya yapı etiketiyle ayrıktır (aynı derlemede birlikte bulunmaz,
32 bit Windows eşinde `child` yok). Taşımadan önce de aynı kod vardı (blok sınırı değişince görünür oldu); ortak dosyaya
almak yapı etiketi düzenini değiştireceğinden dokunulmadı.
