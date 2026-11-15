# PT-K5 — Go `internal/launch` (home, run) + `internal/remember` bölme (backend-dev)

Tarih: 2026-11-15 · Dal: `pt-wip` · Tasarım: `docs/mimari-temizlik.md` §5 K5 (+ §1 kısıtlar) · AC: AC-317, AC-318, AC-320, AC-321, AC-322, AC-323.
Davranış değişmez: yalnız "işlev çıkar", "dosyaya taşı" ve "kullanılmayanı sil" yapıldı. Yeni bağımlılık, yeni soyutlama
katmanı, dışa açık ad/imza değişikliği (silinen ölü `SameRegistration` dışında) yok. Kayıt dosyası biçimi (`kayitlar.bin`
v3, `hatirla.bin` v1/v2 JSON alanları ve sırası), göç sırası, hata sınıfları ve metinleri (G-P20-17/18), kilit ve sayaç
davranışı (G-P20-2/16/18, P20 Windows CI'nin eklediği paylaşım ihlali yeniden denemesi dahil) aynı. P20 tek ekran
değişikliğinden sonraki güncel kod esas alındı. `launch/keeper.go`, `keeper_test.go` ve `internal/request` dokunulmadı;
test dosyalarına dokunulmadı.

## Dosyalar (üretim, satır)

| Önce                       | Sonra                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `launch/home.go` 565       | `home.go` 291 (akış: ekran tipleri, `Autostart` arayüzü, ağ süreleri, `fileFirm`, `firmHome` + `onFirmAction` + `backNote`, `loadOwn`, `firmView`, `checkStatus`, `rename`, `diag`, `requestFor`, `requestFile`) |
|                            | `home_text.go` 96 (bilgi/ipucu metinleri, `BlockedText`, `InvalidText`, `ForgotOneText`, `joinNotes`, `bindingLabel`, `rowText`, `originHost`, `startupNotes`)                                                   |
|                            | `home_actions.go` 169 (`onBindingInvalid`, `afterRemove`, `forgetOne`, `forgetAll`, `forgetAllNotes`, `toggles` + `toggleHint`, `setTray`, `setAutostart`)                                                       |
|                            | `observed_api.go` 61 (`observedAPI`)                                                                                                                                                                             |
| `launch/run.go` 215        | `run.go` 235 (`Run` 62 → 34; `withDefaults`, `keeperFor`, `openFile` çıkarıldı)                                                                                                                                  |
| `remember/remember.go` 510 | `remember.go` 287 (paket belgesi, sabitler, `Status`, `LoadResult`, `Store`, okuma API'si, `update` + `updateHeld` + `changeErr`, yazma API'si, `ForgetAll`, `NoticeText`)                                       |
|                            | `store_lock.go` 115 (`lockPoll`/`lockWait`, `held`, `acquire`, `tryAcquire`, `unlock`, `close`, sayaç `counter`/`setCounter`/`unreadable`)                                                                       |
|                            | `store_file.go` 140 (`readSealed`, `load`, `dropBroken`, `wipe`, `write`)                                                                                                                                        |
| `remember/data.go` 382     | `data.go` 158 (model tipleri, doğrulama, `countOK`, `sortBindings`, `normalize`)                                                                                                                                 |
|                            | `codec.go` 173 (v3 dosya tipleri, `strictDecode`, `version`, `parseTime`, `decode` + `decodeFileV3` + `decodeBinding`, `encode`)                                                                                 |
| `remember/migrate.go` 130  | `migrate.go` 224 (`Migrate` 61 → 33; `readLegacy`, `mergeLegacy` çıkarıldı; v1/v2 tipleri ve `decodeLegacy` data.go'dan buraya — yalnız göçte okunur)                                                            |
| `remember/origin.go` 84    | `origin.go` 74 (`SameRegistration` silindi)                                                                                                                                                                      |

Dokunulmayan: `launch/decide.go`, `launch/keeper.go`, `launch/autostart_*.go`, `remember/class.go`, `dpapi_windows.go`,
`lock_*.go`. Sonuç: kapsamda > 300 satırlık üretim dosyası yok (en büyüğü `home.go` 291).

## İşlev uzunluğu / karmaşıklık (go/ast `scripts/pt-olcum/golen.go`; `gocyclo@v0.6.0` docker'da, repoya girmedi)

| İşlev           | Önce (satır / cx) | Sonra                                                                  |
| --------------- | ----------------- | ---------------------------------------------------------------------- |
| `launch.Run`    | 62 / 15           | 34 / 9 + `withDefaults` 9 / 3 + `keeperFor` 10 / 3 + `openFile` 22 / 4 |
| `Deps.firmHome` | 47 / 18           | 17 / 4 + `onFirmAction` 25 / 13 + `backNote` 6 / 2                     |
| `Deps.toggles`  | 37 / 18           | 23 / 11 + `toggleHint` 17 / 8                                          |
| `Store.Migrate` | 61 / 19           | 33 / 10 + `readLegacy` 19 / 6 + `mergeLegacy` 18 / 6                   |
| `decode`        | 56 / 16           | 33 / 9 + `decodeFileV3` 22 / 6 + `decodeBinding` 16 / 5                |
| `Store.update`  | 43 / 11           | 19 / 5 + `updateHeld` 21 / 5 + `changeErr` 2                           |
| `Store.load`    | 39 / 10           | 28 / 6 (+ sayaç `held.unreadable` 14 / 4)                              |

Kapsamdaki tüm üretim işlevleri ≤ 40 satır (en uzunu `decodeLegacy` 40, değişmedi); karmaşıklık > 15 olan işlev yok
(en yükseği `CanonicalOrigin` 15, değişmedi). Kapsam dışı kalan tek > 40 işlev `keeper.Issued` (52 / 17) — `keeper.go`
görev gereği hariç.

## İstisnalar

Yok.

## Tasarımdan küçük sapmalar (gerekçeli)

- **`store_file.go` (yeni):** §5 `remember.go`'yu yalnız `store_lock.go`'ya bölüyor; kilit/sayaç çıkınca `remember.go`
  hâlâ ~425 satırdı. Dosya düzeyi işlemler (`readSealed`, `load`, `dropBroken`, `wipe`, `write`) ayrı dosyaya alındı;
  `remember.go` dışa açık depo API'si olarak 287 satırda kaldı.
- **`data.go` → `data.go` + `codec.go` ve v1/v2 çözücüsü `migrate.go`'ya:** §5'te adı geçmiyor ama K5 glob'u
  (`internal/remember/**`) içinde ve 382 satırla dosya hedefinin üstündeydi; `decode` 56 satır / cx 16'ydı. Model ve
  doğrulama `data.go`'da, v3 JSON biçimi `codec.go`'da, yalnız göçte okunan v1/v2 (`legacy`, `fileV1`, `fileV2`,
  `fileBinding`, `decodeLegacy`) `migrate.go`'da (data.go'daki "yalnız göçte okunur (migrate.go)" yorumuyla örtüşür).
  JSON etiketleri ve alan sırası birebir taşındı.
- **Sayaç güncellemesi `held.unreadable`:** `load`'un sınıf-2 dalındaki sayaç okuma/ilerletme bloğu `store_lock.go`'ya
  (§5'teki "sayaç") yöntem olarak alındı; ifade sırası aynı (sınıflandırma → sayaç oku → aynı kod değilse 0 → yalnız
  açılışta artır ve yaz → `n ≥ 3`).
- **"Bu bilgisayarı unut" hata metni:** `firmHome` içindeki satır içi dize `home_text.go`'da `noteForgetAllFailed`
  sabiti oldu (metin birebir aynı).

## Davranış eşdeğerliği notları

- `Run`: sıra aynı — varsayılanlar → `observedAPI` sarmalama → kanonik köken → `startState` → `startupNotes`
  (`Autostart.Verify`) → (depo ve köken varsa) keeper + `touch` → `Flow.API` → dosya adı (ref: `TenantInfo`, kod:
  `Resolve` + `onceResolve`) → `Decide` → `ctx` denetimi → kod akışı / ana ekran. `keeperFor`'un `touch` kapanışı
  `Store`, `Now`, `Diag`'ı yakalar; bunlar `Run`'da sonradan değişmediği için eskiden `Run`'ın `d`'sini yakalamasıyla
  aynıdır. `fileFirm` yalnız ref dosyasında doldurulur; `Decide` `FileRow`'u yalnız ref için verdiğinden eskisiyle aynı.
- `firmHome` / `onFirmAction`: koşul sırası ve dizin hesabı (dosya satırı 0) aynı; uymayan karar (geçersiz dizin)
  eskiden olduğu gibi bilgi satırsız yeniden gösterim. Talep ana ekrana dönerse yalnız talebin notu gösterilir (eskiden
  `notes = nil` sonrası `append`).
- `toggles`: ipucu yalnız çağıranın ipucu boşken hesaplanır; `toggleHint`'in `switch` sırası aynı, hiçbiri uymazsa "".
- `Migrate`: kural 1–4 ve `kayitlar.bin` okunamıyorsa dokunmama aynı; `readLegacy` kesin biçim hatasında `hatirla.bin`'i
  siler, geçici hatada dokunmaz (eskisiyle aynı); `mergeLegacy` önce `personal`, sonra anahtar (yer yoksa `Blocked`).
- `decode`: hata sırası aynı — sürüm → v3 değil → katı çözme → fazladan veri → cihaz anahtarı/kişisel bağı → kişisel
  geçerlilik → öğe zamanları ve geçerlilik (sırayla) → kayıtsız tercih → normalize → boş veri. Hata metinleri birebir.
- `update`: kilit alma, dosya yokken `fn`'i boş veriyle deneme, sınıf-2'de `ErrUnreadable` sarmalama, `errNoChange`
  = yazmadan başarı, kayıt kalmazsa tercih düşer, boşsa `wipe`; `h.close` çağrı yerleri aynı.
- `SameRegistration`: `deadcode` (windows, testler dahil) erişilemez buldu; repoda (Go kaynak + testler) hiç çağrısı yok
  (`grep`); P8c'de `keeper.go` kullanıyordu, P20'de `keeper.Issued` sunucunun `renewed` kararına geçince kullanılmaz
  oldu. Silindi.

## Doğrulama (golang:1.26, docker; repo kökü bağlı)

- `go test -race ./...` (apps/agent-win): 21 paketin hepsi `ok` (launch 1,7 sn, remember 2,1 sn).
- `GOOS=windows go vet ./...`: temiz. `GOOS=windows go test -c ./internal/remember ./internal/launch`: derleniyor.
  `gofmt -l .`: boş.
- `go test -list .` (linux) `./internal/launch/... ./internal/remember/...`: önce/sonra **58 test, liste birebir aynı**.
  Windows derleme listesi (`GOOS=windows go test -c` + `go tool nm` ile Test sembolleri; Windows'a özgü
  `store_windows_test.go`, `reparse_windows_test.go` dahil): önce/sonra **66 test, birebir aynı**. Windows'a özgü
  testler CI'da koşar.
- `staticcheck@v0.8.2` (linux + windows) `launch`, `remember`: 0 uyarı. `deadcode@v0.52.0` (windows, `-test` ile ve
  testsiz): `launch`/`remember`'de 0 (önce 1: `SameRegistration`).
- Değişen dosyalar yalnız `apps/agent-win/internal/launch/{home,run}.go` + yeni `home_text.go`, `home_actions.go`,
  `observed_api.go`; `apps/agent-win/internal/remember/{remember,migrate,data,origin}.go` + yeni `store_lock.go`,
  `store_file.go`, `codec.go`; ve bu not.

## PT bulguları

Yok (bölme sırasında hata görülmedi).
